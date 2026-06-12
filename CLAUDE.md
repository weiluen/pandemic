# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A browser-based implementation of the Pandemic board game for 2–4 players — local hotseat on one computer, or online multiplayer via the bundled server. Vanilla JS, no build step, no dependencies, no framework (the server is zero-dependency Node too).

## Commands

```sh
node test/rules.js          # directed checks of specific rules
node test/fuzz.js 300       # N random full games, invariant-checked every step
node test/server.js         # online server: rooms, permissions, undo, SSE, persistence

node server.js              # serve the game + host online rooms (port 8421)
python3 -m http.server 8421 # local-only alternative (no online options)
```

There is no lint/build step. The dev server on localhost gets live-reload: index.html polls source files and refreshes when they change; local games autosave to localStorage after every action and auto-resume, so reloads are safe mid-game. Online games rejoin their room automatically on reload (room code + token in localStorage).

## Architecture

The hard boundary in this codebase: **`js/game.js` is the rules engine and must never touch the DOM or anything browser- or room-specific** — it runs in the browser, under plain Node for the tests, and inside `server.js` as the authoritative rules for online rooms (`require`d directly; the files attach to `globalThis`). `js/ui.js` is the only file that touches the DOM.

Script load order (see index.html): `worldmap.js` → `data.js` → `game.js` → `net.js` → `ai.js` → `ui.js`, communicating via globals `PANDEMIC_WORLD`, `PANDEMIC_DATA`, `Game`, and `Net`.

- `js/data.js` — static data: 48 cities with adjacency lists and board x/y coords, roles, events, city facts. Adjacency is declared one-directionally per city; game.js symmetrizes it into `ADJ`.
- `js/game.js` — all rules. Single mutable state object `G` (pure JSON, accessed via `Game.state()`), mutated by exported action functions (`performMove`, `treat`, `discoverCure`, `playEvent`, …) that `assert()` legality and throw `Error('Illegal: …')` on violations. Save/undo work by JSON snapshot/restore of `G`. `Game.validate(g)` is an integrity census used to reject corrupted saves.
- `js/ui.js` — renders everything from `Game.state()` on each `refresh()`; holds only transient UI state (selection, undo stack, zoom). **Every engine mutation goes through the `act`/`run` dispatcher** (`dispatch(fn, args)`): local mode calls `Game[fn]` synchronously; online mode POSTs to the server and renders from the echoed state. Catches engine asserts and shows them as toasts. Also: synthesized audio (no asset files) and localStorage autosave.
- `js/net.js` — online-mode client glue: lobby API calls, the SSE subscription (`Net.applyPayload` → `Game.load` → `Net.onUpdate`), and session storage for rejoin. Dormant (`Net.online === false`) in local games.
- `js/ai.js` — AI players (separate workstream; see its header comments).
- `js/worldmap.js` — generated coastline paths; do not hand-edit.
- `server.js` — zero-dependency Node server: serves the static files and hosts online rooms. Authoritative state per room as a JSON string, applied through the engine with a `Game.restore(state) → Game[fn](...) → Game.snapshot()` state-swap (single-threaded, race-free). Adds the strict-seats permission layer (who may call what; the engine itself stays seat-agnostic), per-turn undo snapshots, SSE push (`payload()` identical for all clients except `mySeat`/`actorSeat`), persistence to `saves/rooms.json`, and 24h room GC.

### Engine details that matter when changing rules

- **Phase machine**: `G.phase` cycles `actions` (4 actions) → `draw` (2 cards, `epidemicPause` interrupts on an epidemic until `intensify()`) → `discard` (hand-limit enforcement) → `infect` → next turn. UI dialogs are driven directly off the phase.
- **Deck convention**: top of every deck is the **end** of the array (`pop()` draws; epidemics take the bottom card with `shift()`).
- **Card conservation is invariant-checked by the fuzz test** — any card leaving play must land in a hand, a discard pile, `G.removed`, `G.contingency`, or `G.forecastPending`, or the fuzzer fails. Same for the 24-cubes-per-color supply (`placeCube`/`removeCubes` keep `cubeSupply` in sync).
- **Narration** (`narrate`/`newsBeat`/`STRAIN`) is pure flavor text in the log. It is wrapped in try/catch so a narration bug can never interrupt the rules engine, and it rotates templates deterministically (no RNG) to keep tests reproducible.
- **Save migration**: fields added to `G` after release must be backfilled in `migrate()` so old localStorage saves still load.

### Online-mode details that matter when changing the UI

- Read-only rendering can keep calling `Game.*` helpers — the client mirrors the full authoritative state. Mutations MUST go through `act`/`run` (never `Game.performMove(...)` directly), or they will desync online games.
- Seat gating: `myTurn()` / `mySeatIs(i)` are the helpers; in local mode they are always true. The server enforces permissions regardless — UI gating is UX, not security.
- The engine's `playerDeck`/`infectionDeck` arrays are visible in the mirrored client state. That's accepted (co-op game, same as hotseat); don't build UI that reveals them.

### Deliberate rule deviations

Don't "fix" these to match the official rules:

- Hand limit is enforced only against the current player at the end of their own turn (house rule, commented at `spendAction` in game.js and covered by tests).
- The infection deck reshuffles its discard if it ever empties (official rules have no provision; avoids a dead end).
