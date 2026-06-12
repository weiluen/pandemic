# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A browser-based implementation of the Pandemic board game for 2–4 players sharing one computer. Vanilla JS, no build step, no dependencies, no framework.

## Commands

```sh
node test/rules.js          # directed checks of specific rules
node test/fuzz.js 300       # N random full games, invariant-checked every step

python3 -m http.server 8421 # serve the game (or just `open index.html`)
```

There is no lint/build step. The dev server on localhost gets live-reload: index.html polls source files and refreshes when they change; the game autosaves to localStorage after every action and auto-resumes, so reloads are safe mid-game.

## Architecture

The hard boundary in this codebase: **`js/game.js` is the rules engine and must never touch the DOM** — it runs under plain Node for the tests (`require`d directly; both files attach to `globalThis`). `js/ui.js` is the only file that touches the DOM.

Script load order (see index.html): `worldmap.js` → `data.js` → `game.js` → `ui.js`, communicating via globals `PANDEMIC_WORLD`, `PANDEMIC_DATA`, and `Game`.

- `js/data.js` — static data: 48 cities with adjacency lists and board x/y coords, roles, events, city facts. Adjacency is declared one-directionally per city; game.js symmetrizes it into `ADJ`.
- `js/game.js` — all rules. Single mutable state object `G` (pure JSON, accessed via `Game.state()`), mutated by exported action functions (`performMove`, `treat`, `discoverCure`, `playEvent`, …) that `assert()` legality and throw `Error('Illegal: …')` on violations. Save/undo work by JSON snapshot/restore of `G`.
- `js/ui.js` — renders everything from `Game.state()` on each `refresh()`; holds only transient UI state (selection, undo stack, zoom). Catches engine asserts and shows them as toasts. Also: synthesized audio (no asset files) and localStorage autosave.
- `js/worldmap.js` — generated coastline paths; do not hand-edit.

### Engine details that matter when changing rules

- **Phase machine**: `G.phase` cycles `actions` (4 actions) → `draw` (2 cards, `epidemicPause` interrupts on an epidemic until `intensify()`) → `discard` (hand-limit enforcement) → `infect` → next turn. UI dialogs are driven directly off the phase.
- **Deck convention**: top of every deck is the **end** of the array (`pop()` draws; epidemics take the bottom card with `shift()`).
- **Card conservation is invariant-checked by the fuzz test** — any card leaving play must land in a hand, a discard pile, `G.removed`, `G.contingency`, or `G.forecastPending`, or the fuzzer fails. Same for the 24-cubes-per-color supply (`placeCube`/`removeCubes` keep `cubeSupply` in sync).
- **Narration** (`narrate`/`newsBeat`/`STRAIN`) is pure flavor text in the log. It is wrapped in try/catch so a narration bug can never interrupt the rules engine, and it rotates templates deterministically (no RNG) to keep tests reproducible.
- **Save migration**: fields added to `G` after release must be backfilled in `migrate()` so old localStorage saves still load.

### Deliberate rule deviations

Don't "fix" these to match the official rules:

- Hand limit is enforced only against the current player at the end of their own turn (house rule, commented at `spendAction` in game.js and covered by tests).
- The infection deck reshuffles its discard if it ever empties (official rules have no provision; avoids a dead end).
