# Online Multiplayer — Design

**Date:** 2026-06-11
**Status:** Approved

## Goal

Add a hosted remote-multiplayer mode to the Pandemic browser game so 2–4 players
can play from separate computers, while keeping the existing local hotseat mode
fully working (including offline via `open index.html`).

## Decisions (settled with the user)

- **Hosting:** a small zero-dependency Node server (`node server.js`), run on the
  host's machine (LAN / Tailscale / ngrok) or any cheap host. No npm packages,
  no build step — preserves the project's zero-dependency property.
- **Transport:** Server-Sent Events for server→client push, `POST` for
  client→server actions. No WebSockets (would require the `ws` dependency).
- **Modes:** Local hotseat stays exactly as-is alongside the new online mode.
- **Architecture:** Server-authoritative. The server runs the existing
  `js/game.js` engine, validates every action, and broadcasts full state.
  Clients never mutate rules state in online mode. (Rejected: action-relay with
  deterministic replay — `shuffle()` uses `Math.random`, so decks would diverge
  without invasive seeded-RNG surgery on the tested engine. Rejected: fully thin
  client — needless rewrite of the UI's read-side logic.)
- **Permissions:** strict seats. You act only on your own turn, discard your own
  cards, play your own event cards. No host override.
- **Undo:** the current player may undo their own actions, back to the start of
  their turn only. Server-enforced.
- **No** spectator mode, no in-game chat. Room codes are 4 letters; max 4 seats.

## Components

| Piece | Status | Responsibility |
|---|---|---|
| `server.js` (repo root) | new | Static file serving, room management, action validation/application via the engine, SSE push, disk persistence |
| `js/net.js` | new | Client online glue: lobby API calls, SSE subscription, action dispatcher |
| `js/ui.js` | modified | Mutating calls routed through one dispatcher; setup screen gains Create/Join room; seat-aware control gating; connection indicator |
| `js/game.js` | **unchanged** | Single source of rules; authoritative on the server, read-only mirror in clients |

## Server

### Process

`node server.js [port]` (default 8421, replacing `python3 -m http.server`).
Serves the repo's static files (with `Last-Modified`, so the dev live-reload
poller keeps working) and the `/api` routes on the same origin — no CORS.
`require`s `js/data.js` and `js/game.js` (both attach to `globalThis`, as the
tests already rely on).

### Rooms

In-memory `Map` keyed by a 4-letter room code.

```
room = {
  code,                         // 4 uppercase letters
  status,                       // 'lobby' | 'playing' | 'over'
  seats: [{ name, token, connected }],   // index = engine player index
  hostToken,                    // seat[0]'s token at creation
  state,                        // JSON string of engine G (null in lobby)
  turnSnapshots: [],            // pre-action snapshots, cleared on turn change
  forecastBy,                   // seat index that played Forecast, else null
  seq,                          // monotonically increasing state version
  sseClients: [],               // open SSE responses
  lastActivity,                 // for GC
}
```

Each joiner gets a random token — the credential on every later request and the
key for rejoining.

### Engine multi-tenancy

`game.js` holds a singleton `G`. The server applies actions with a state swap:

```
Game.restore(room.state)
Game[fn](...args)          // throws Error('Illegal: …') on violation
room.state = Game.snapshot()
```

Node is single-threaded, so this is race-free and requires zero engine changes.

### API (all JSON, same origin)

- `POST /api/rooms` `{name}` → `{code, token, seat: 0}` — create room, creator is host.
- `POST /api/rooms/:code/join` `{name}` → `{token, seat}` — errors if full or
  already playing. `{token}` of an existing seat rejoins it.
- `POST /api/rooms/:code/start` `{token, epidemics, roles?}` — host only, from
  the lobby; calls `Game.newGame` with the seated names.
- `POST /api/rooms/:code/action` `{token, fn, args}` → `200 {ok}` or
  `400 {error}` — see permission model. Engine `Illegal:` messages are passed
  through as the error text (the UI already renders these as toasts).
- `POST /api/rooms/:code/undo` `{token}` — current player only; pops a turn snapshot.
- `GET /api/rooms/:code/events?token=…` — SSE stream. On connect and after every
  state change, sends the room snapshot: `{seq, status, seats (sans tokens),
  mySeat, state}`. The payload is identical for all clients except `mySeat`,
  which is stamped per connection from the token. In the lobby, `state` is null
  and the event serves as the roster update.

### Permission model (strict seats)

`fn` must be on the whitelist of mutating engine functions. Then:

| Function | Allowed caller |
|---|---|
| `performMove`, `treat`, `build`, `discoverCure`, `shareKnowledge`, `pass`, `contingencyTake`, `drawPlayerCard`, `intensify`, `flipInfectionCard` | seat == `G.current` |
| `discardForLimit(playerIdx, …)` | seat == `playerIdx` |
| `playEvent(playerIdx, …)` | seat == `playerIdx` (events playable any time per the rules; engine gates the phase) |
| `forecastCommit` | seat == `room.forecastBy` (server records it when the Forecast `playEvent` succeeds; cleared on commit) |
| undo | seat == `G.current`, snapshots from this turn only |

Everything else about legality (phases, adjacency, card ownership, …) is the
engine's job — the server adds only the "who may call this" layer.

### Undo

Before each successful action by the current player, push `room.state` onto
`turnSnapshots`. When `G.current` changes after an action, clear the stack.
Undo pops one snapshot and broadcasts. (Snapshots include draw results — that's
accepted; it matches the hotseat undo and Pandemic is co-op.)

### Resilience

- Rooms persist to `saves/rooms.json` (debounced write after each change,
  tokens included) and are reloaded on boot — a server restart doesn't kill games.
- SSE disconnect marks the seat `connected: false` in the roster (shown in the
  UI); the game never blocks on a disconnect. Rejoin by token restores the seat.
- Rooms idle for 24h are GC'd.

## Client

### Setup screen

Three paths: **Local game** (today's flow, engine in-browser, no server),
**Create room**, **Join room** (code + name). Online options are shown only if
a ping to `/api` succeeds (i.e. the page is served by `server.js`, not
`file://` or a dumb static server). Create/Join lead to a lobby listing seats
as they fill; the host picks epidemic count (and optionally roles) and starts.

### Action dispatcher

All mutating call sites in `ui.js` (~20) go through one function:

- `act(fn, ...args)` —
  - **Local mode:** `Game[fn](...args)` directly, synchronous, then `refresh()`;
    throws caught and toasted, exactly today's behavior.
  - **Online mode:** `POST /action`; the UI re-renders when the SSE echo arrives
    (`Game.load(state); refresh()`); a `400` response is toasted.

Read-only helpers (`moveOptions`, `cardName`, legality hints, log rendering)
keep calling the local engine against the mirrored state — unchanged.

### Seat gating

When online and it isn't your turn, action controls are disabled with a
"Waiting for ⟨name⟩…" hint. All hands are visible (co-op, open information),
but only your own event cards are clickable. The Undo button renders only for
the active player. A connection indicator shows SSE status and any
disconnected teammates.

### Reconnect & storage

`{code, token, name}` for the active online game lives in localStorage; a page
refresh silently rejoins. The existing localStorage autosave applies to local
games only.

## Error handling

- Server: 404 unknown room, 400 bad/forbidden action (engine message passed
  through), 409 join on full/started room. All become toasts client-side.
- SSE: `EventSource` auto-reconnects; every event carries the full state with a
  `seq` number, and the client ignores anything ≤ the seq it has, so missed or
  reordered events self-heal on the next push.
- Server crash: state is on disk; restart and clients' EventSource reconnects
  resume the game.

## Testing

- `test/rules.js` and `test/fuzz.js` run unchanged — the engine is untouched.
- New `test/server.js` (run: `node test/server.js`): boots the server on an
  ephemeral port, drives it with Node's built-in `fetch`:
  - create / join / start happy path
  - scripted action sequence advancing a turn
  - wrong-seat action rejected with 400
  - undo: allowed for current player within turn, cleared on turn change
  - rejoin by token after dropping the SSE connection
  - SSE delivery: state event received after an action, seq increases
- Manual test path: `node server.js`, open two browser windows, play a round.
