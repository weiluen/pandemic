# Pandemic — Local Hotseat

A faithful implementation of the classic cooperative disease-fighting board game for 2–4 players sharing one computer. Original code, text, and visuals; the rules follow the standard base game.

## How to run

No build step, no dependencies. Either:

```sh
open index.html            # straight from the filesystem
```

or serve it (nicer URLs, same result):

```sh
python3 -m http.server 8421
# then open http://localhost:8421
```

## How to play

- **Goal:** cure all four diseases. You lose if 8 outbreaks occur, any disease runs out of cubes, or the player deck runs out.
- **Each turn:** take 4 actions → draw 2 player cards → flip infection cards equal to the infection rate.
- **Moving:** click any city on the map to see every legal way to get there (drive, direct flight, charter flight, shuttle).
- **Other actions** (treat, build, cure, share knowledge, role powers) are in the sidebar.
- **Event cards** can be played from either player's hand at almost any time — click "Play" on the card.
- Hover a role chip or event card for what it does. The "Rules" button has a full summary.
- The game autosaves to your browser after every move; "Resume saved game" appears on the start screen.

## What's implemented

- All 48 cities and the full connection network, 4 diseases, cube supply limits
- Infection deck / player deck, epidemics (increase → infect → intensify), outbreak chains
- All 7 roles: Medic, Scientist, Researcher, Dispatcher, Operations Expert, Quarantine Specialist, Contingency Planner
- All 5 events: Airlift, Government Grant, One Quiet Night, Forecast, Resilient Population (playable mid-epidemic, as per the rules)
- Eradication, hand limit (7) with forced discards, 6-station limit with relocation
- Difficulty: 4 / 5 / 6 epidemics; 2–4 players; undo for actions

## Tests

```sh
node test/rules.js    # 35 directed checks of specific rules
node test/fuzz.js 300 # 300 random full games, invariant-checked every step
```

## Files

- `js/data.js` — the city network, roles, events
- `js/game.js` — rules engine (no DOM; also runs under Node for tests)
- `js/ui.js` — board rendering and interaction
