# Pandemic — Hotseat & Online

A faithful implementation of the classic cooperative disease-fighting board game for 2–4 players — sharing one computer, or each on their own over the network. Original code, text, and visuals; the rules follow the standard base game. No build step, no dependencies.

## How to run

```sh
node server.js             # serves the game AND hosts online rooms
# then open http://localhost:8421
```

For local-hotseat-only play you can still skip the server entirely:

```sh
open index.html            # straight from the filesystem
# or: python3 -m http.server 8421   (online options won't appear)
```

## Play online

1. One person runs `node server.js` somewhere all players can reach: a LAN,
   a [Tailscale](https://tailscale.com) network, an `ngrok`/`cloudflared`
   tunnel, or any cheap host.
2. Everyone opens that address in a browser. Enter a name, one player clicks
   **Create Room**, the rest **Join Room** with the 4-letter code.
3. The host picks the difficulty and starts. Each player controls their own
   pawn on their own turn; event cards are played from your own hand any time.

Resilient by design: the page rejoins your seat automatically after a reload,
disconnected players show in the top bar and can come back any time, and games
survive a server restart (state persists to `saves/rooms.json`). Idle rooms are
cleaned up after 24 hours.

## How to play

- **Goal:** cure all four diseases. You lose if 8 outbreaks occur, any disease runs out of cubes, or the player deck runs out.
- **Each turn:** take 4 actions → draw 2 player cards → flip infection cards equal to the infection rate.
- **Moving:** click any city on the map to see every legal way to get there (drive, direct flight, charter flight, shuttle).
- **Other actions** (treat, build, cure, share knowledge, role powers) are in the sidebar.
- **Event cards** can be played from any player's hand at almost any time — click "Play" on the card (online: your own hand only).
- Hover a role chip or event card for what it does. The "Rules" button has a full summary.
- Local games autosave to your browser after every move; "Resume saved game" appears on the start screen. Online games live on the server.

## What's implemented

- All 48 cities and the full connection network, 4 diseases, cube supply limits
- Infection deck / player deck, epidemics (increase → infect → intensify), outbreak chains
- All 7 roles: Medic, Scientist, Researcher, Dispatcher, Operations Expert, Quarantine Specialist, Contingency Planner
- All 5 events: Airlift, Government Grant, One Quiet Night, Forecast, Resilient Population (playable mid-epidemic, as per the rules)
- Eradication, hand limit (7) with forced discards, 6-station limit with relocation
- Difficulty: 4 / 5 / 6 epidemics; 2–4 players; undo for actions (online: your own turn, server-enforced)
- Online multiplayer: rooms with 4-letter codes, strict seats, live state push (SSE), reconnect & restart resilience

## Tests

```sh
node test/rules.js    # directed checks of specific rules
node test/fuzz.js 300 # 300 random full games, invariant-checked every step
node test/server.js   # online server: rooms, permissions, undo, SSE, persistence
```

## Files

- `js/data.js` — the city network, roles, events
- `js/game.js` — rules engine (no DOM; runs in the browser, under Node for tests, and on the server)
- `js/ui.js` — board rendering and interaction
- `js/net.js` — online-mode client: lobby calls, SSE subscription
- `server.js` — zero-dependency Node server: static files + authoritative game rooms
