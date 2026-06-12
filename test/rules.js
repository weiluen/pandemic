'use strict';
// Directed rules tests: rig game states to exercise specific rules.
// Run: node test/rules.js

require('../js/data.js');
require('../js/game.js');
const Game = globalThis.Game;

let passed = 0;
function check(cond, name) {
  if (!cond) throw new Error('FAIL: ' + name);
  passed++;
}
function fresh(roles) {
  return Game.newGame({ names: ['A', 'B'], epidemics: 4, roles });
}
function cityCards(color, n) {
  const D = globalThis.PANDEMIC_DATA;
  return D.cities.filter(c => c.color === color).slice(0, n).map(c => ({ type: 'city', city: c.city || c.name, color }));
}

// --- Win by curing all four diseases ---
{
  const G = fresh(['Scientist', 'Medic']);
  G.cures = { blue: true, yellow: true, black: true, red: false };
  G.players[0].hand = cityCards('red', 4);
  G.players[0].location = 'Atlanta';
  Game.discoverCure('red', [0, 1, 2, 3]); // scientist needs 4
  check(G.result && G.result.win, 'curing 4th disease wins');
}

// --- Scientist needs 4, others need 5 ---
{
  const G = fresh(['Researcher', 'Medic']);
  G.players[0].hand = cityCards('red', 4);
  let threw = false;
  try { Game.discoverCure('red', [0, 1, 2, 3]); } catch (e) { threw = true; }
  check(threw, 'non-scientist cannot cure with 4 cards');
}

// --- Medic treats all cubes; treat removes 1 normally ---
{
  const G = fresh(['Medic', 'Researcher']);
  G.cityCubes.Atlanta.blue = 3; G.cubeSupply.blue -= 3 - G.cityCubes.Atlanta.blue ? 0 : 0;
  G.cubeSupply.blue = 24 - 3 - Object.values(G.cityCubes).reduce((s, c) => s + c.blue, 0) + G.cityCubes.Atlanta.blue;
  // simpler: recompute supply
  G.cubeSupply.blue = 24 - Object.keys(G.cityCubes).reduce((s, k) => s + G.cityCubes[k].blue, 0);
  Game.treat('blue');
  check(G.cityCubes.Atlanta.blue === 0, 'medic treat removes all cubes');
  const G2 = fresh(['Researcher', 'Dispatcher']);
  G2.cityCubes.Atlanta.blue = 3;
  G2.cubeSupply.blue = 24 - Object.keys(G2.cityCubes).reduce((s, k) => s + G2.cityCubes[k].blue, 0);
  Game.treat('blue');
  check(G2.cityCubes.Atlanta.blue === 2, 'normal treat removes one cube');
}

// --- Medic auto-clears cured disease on entering a city ---
{
  const G = fresh(['Medic', 'Researcher']);
  G.cures.blue = true;
  G.cityCubes.Chicago.blue = 2;
  G.cubeSupply.blue = 24 - Object.keys(G.cityCubes).reduce((s, k) => s + G.cityCubes[k].blue, 0);
  Game.performMove(0, 'drive', 'Chicago');
  check(G.cityCubes.Chicago.blue === 0, 'medic auto-clears cured cubes on arrival');
}

// --- Quarantine Specialist blocks infection in city and neighbors ---
{
  const G = fresh(['Quarantine Specialist', 'Researcher']);
  G.players[0].location = 'Paris';
  G.infectionDeck.push({ city: 'Madrid', color: 'blue' }); // adjacent to Paris
  const before = G.cityCubes.Madrid.blue;
  G.phase = 'infect'; G.infectsLeft = 1; G.current = 1;
  Game.flipInfectionCard();
  check(G.cityCubes.Madrid.blue === before, 'QS blocks infection in adjacent city');
}

// --- Outbreak chain: 3-cube city infected spreads to neighbors, counts once ---
{
  const G = fresh(['Researcher', 'Dispatcher']);
  for (const k of Object.keys(G.cityCubes)) for (const c of Game.COLORS) G.cityCubes[k][c] = 0;
  G.cubeSupply = { blue: 24, yellow: 24, black: 24, red: 24 };
  G.outbreaks = 0;
  G.cityCubes.Santiago.yellow = 3; G.cityCubes.Lima.yellow = 3;
  G.cubeSupply.yellow = 24 - 6;
  G.infectionDeck.push({ city: 'Santiago', color: 'yellow' });
  G.phase = 'infect'; G.infectsLeft = 1;
  G.players[0].location = 'Tokyo'; G.players[1].location = 'Tokyo';
  Game.flipInfectionCard();
  // Santiago outbreak -> Lima gets cube -> Lima at 3 already -> chain outbreak -> back to Santiago blocked
  check(G.outbreaks === 2, `chain outbreak counted twice, not more (got ${G.outbreaks})`);
  check(G.cityCubes.Santiago.yellow === 3 && G.cityCubes.Lima.yellow === 3, 'outbreak cities stay at 3');
  check(G.cityCubes['Mexico City'].yellow === 1 && G.cityCubes.Bogota.yellow === 1, 'neighbors each got a cube');
}

// --- Outbreak cycle: three mutually adjacent 3-cube cities outbreak once each (no ping-pong) ---
{
  const G = fresh(['Researcher', 'Dispatcher']);
  for (const k of Object.keys(G.cityCubes)) for (const c of Game.COLORS) G.cityCubes[k][c] = 0;
  G.cubeSupply = { blue: 24, yellow: 24, black: 24, red: 24 };
  G.outbreaks = 0;
  for (const c of ['London', 'Paris', 'Essen']) G.cityCubes[c].blue = 3; // a triangle on the map
  G.cubeSupply.blue = 24 - 9;
  G.infectionDeck.push({ city: 'London', color: 'blue' });
  G.phase = 'infect'; G.infectsLeft = 1;
  G.players[0].location = 'Tokyo'; G.players[1].location = 'Tokyo';
  Game.flipInfectionCard();
  check(G.outbreaks === 3, `triangle chain outbreaks once per city (got ${G.outbreaks})`);
  check(['London', 'Paris', 'Essen'].every(c => G.cityCubes[c].blue === 3), 'cycle cities stay at 3');
  check(G.cityCubes.Madrid.blue === 2 && G.cityCubes.Milan.blue === 2, 'shared neighbors get one cube per outbreak');
  const onBoard = Object.values(G.cityCubes).reduce((s, c) => s + c.blue, 0);
  check(onBoard + G.cubeSupply.blue === 24, 'cube supply stays conserved through the chain');
}

// --- Epidemic: bottom card, 3 cubes, intensify restacks discard on top ---
{
  const G = fresh(['Researcher', 'Dispatcher']);
  G.phase = 'draw'; G.cardsToDraw = 2; G.actionsLeft = 0;
  G.playerDeck.push({ type: 'epidemic' }); // next draw
  const bottom = G.infectionDeck[0];
  const discardBefore = G.infectionDiscard.length;
  Game.drawPlayerCard();
  check(G.phase === 'epidemicPause', 'epidemic pauses before intensify');
  check(G.rateIndex === 1, 'infection rate marker advanced');
  const target = G.cityCubes[bottom.city][bottom.color];
  check(target === 3 || G.result, 'epidemic city has 3 cubes (or game ended)');
  Game.intensify();
  check(G.infectionDiscard.length === 0, 'discard pile restacked');
  check(G.infectionDeck.slice(-(discardBefore + 1)).some(c => c.city === bottom.city), 'epidemic card back on top section');
}

// --- Researcher can give any card; normal share must match city ---
{
  const G = fresh(['Researcher', 'Dispatcher']);
  G.players[0].location = 'Atlanta'; G.players[1].location = 'Atlanta';
  G.players[0].hand = [{ type: 'city', city: 'Tokyo', color: 'red' }];
  Game.shareKnowledge(0, 1, 0);
  check(G.players[1].hand.some(c => c.city === 'Tokyo'), 'researcher gives any card');
  const G2 = fresh(['Dispatcher', 'Medic']);
  G2.players[0].hand = [{ type: 'city', city: 'Tokyo', color: 'red' }];
  let threw = false;
  try { Game.shareKnowledge(0, 1, 0); } catch (e) { threw = true; }
  check(threw, 'normal share requires matching city card');
}

// --- House rule: over-limit hands are allowed mid-turn, enforced only against the active player ---
{
  // A player handed cards on someone else's turn keeps them until their OWN turn ends.
  const G = fresh(['Researcher', 'Dispatcher']);
  G.players[0].hand = [{ type: 'city', city: 'Tokyo', color: 'red' }];
  G.players[1].hand = Array.from({ length: 7 }, (_, i) => ({ type: 'city', city: 'Paris', color: 'blue' }));
  Game.shareKnowledge(0, 1, 0);
  check(G.phase === 'actions' && G.players[1].hand.length === 8, 'holding 8+ cards mid-turn is allowed');
  G.actionsLeft = 1;
  Game.pass(); // -> draw phase
  G.playerDeck.push({ type: 'city', city: 'Lima', color: 'yellow' }, { type: 'city', city: 'Lima', color: 'yellow' });
  Game.drawPlayerCard();
  Game.drawPlayerCard();
  check(G.phase === 'infect' && G.players[1].hand.length === 8,
    'a player handed cards on someone else\'s turn is NOT forced to discard');
}
{
  // The active player IS forced to discard down at the end of their own turn.
  const G = fresh(['Researcher', 'Dispatcher']);
  G.players[0].hand = Array.from({ length: 6 }, (_, i) => ({ type: 'city', city: 'Paris', color: 'blue' }));
  G.actionsLeft = 1;
  Game.pass(); // -> draw phase
  G.playerDeck.push({ type: 'city', city: 'Lima', color: 'yellow' }, { type: 'city', city: 'Lima', color: 'yellow' });
  Game.drawPlayerCard();
  Game.drawPlayerCard();
  check(G.phase === 'discard' && G.discardQueue.length === 1 && G.discardQueue[0] === 0,
    'the active player must discard down at the end of their own turn');
  Game.discardForLimit(0, 0);
  check(G.phase === 'infect', 'infect step follows the end-of-turn discard');
}

// --- Dispatcher: move pawn to city containing another pawn ---
{
  const G = fresh(['Dispatcher', 'Medic']);
  G.players[1].location = 'Tokyo';
  Game.performMove(1, 'drive', 'Osaka'); // dispatcher drives B's pawn
  check(G.players[1].location === 'Osaka', 'dispatcher drives another pawn');
  G.players[0].location = 'Paris';
  Game.performMove(0, 'dispatch', 'Osaka'); // move own pawn to a city with another pawn
  check(G.players[0].location === 'Osaka', 'dispatch rendezvous works');
}

// --- Operations Expert: free build, special flight once per turn ---
{
  const G = fresh(['Operations Expert', 'Medic']);
  G.players[0].location = 'Chicago';
  const handBefore = G.players[0].hand.length;
  Game.build();
  check(G.stations.includes('Chicago') && G.players[0].hand.length === handBefore, 'opex builds for free');
  G.players[0].hand = [{ type: 'city', city: 'Lima', color: 'yellow' }];
  Game.performMove(0, 'opex', 'Sydney', 0);
  check(G.players[0].location === 'Sydney' && G.opexUsed, 'opex special flight');
  let threw = false;
  G.players[0].hand = [{ type: 'city', city: 'Lima', color: 'yellow' }];
  G.players[0].location = 'Atlanta';
  try { Game.performMove(0, 'opex', 'Paris', 0); } catch (e) { threw = true; }
  check(threw, 'opex flight only once per turn');
}

// --- Contingency Planner: retrieve event, replay removes from game ---
{
  const G = fresh(['Contingency Planner', 'Medic']);
  G.playerDiscard.push({ type: 'event', event: 'Airlift' });
  Game.contingencyTake('Airlift');
  check(G.contingency === 'Airlift', 'CP stores event');
  Game.playEvent(0, 'contingency', 'Airlift', { pawnIdx: 1, city: 'Tokyo' });
  check(G.players[1].location === 'Tokyo', 'stored airlift works');
  check(G.removed.some(c => c.event === 'Airlift'), 'replayed event removed from game');
  check(!G.contingency, 'CP slot cleared');
}

// --- One Quiet Night skips infect step ---
{
  const G = fresh(['Medic', 'Researcher']);
  G.players[0].hand.push({ type: 'event', event: 'One Quiet Night' });
  Game.playEvent(0, 'hand', 'One Quiet Night', {});
  G.phase = 'draw'; G.cardsToDraw = 2; G.actionsLeft = 0;
  G.playerDeck.push({ type: 'city', city: 'Paris', color: 'blue' });
  G.playerDeck.push({ type: 'city', city: 'Milan', color: 'blue' });
  G.players[0].hand = []; // avoid hand limit
  Game.drawPlayerCard(); Game.drawPlayerCard();
  check(G.current === 1 && G.phase === 'actions', 'OQN skipped straight to next turn');
}

// --- Resilient Population during epidemic pause ---
{
  const G = fresh(['Medic', 'Researcher']);
  G.players[1].hand = [{ type: 'event', event: 'Resilient Population' }];
  G.phase = 'draw'; G.cardsToDraw = 2; G.actionsLeft = 0;
  G.playerDeck.push({ type: 'epidemic' });
  Game.drawPlayerCard();
  check(G.phase === 'epidemicPause', 'epidemic pause');
  check(Game.canPlayEvent('Resilient Population') && !Game.canPlayEvent('Airlift'), 'only RP playable during pause');
  const n = G.infectionDiscard.length;
  Game.playEvent(1, 'hand', 'Resilient Population', { discardIdx: 0 });
  check(G.infectionDiscard.length === n - 1, 'RP removes an infection card');
  Game.intensify();
}

// --- Forecast reorders top of infection deck ---
{
  const G = fresh(['Medic', 'Researcher']);
  G.players[0].hand = [{ type: 'event', event: 'Forecast' }];
  const top6 = G.infectionDeck.slice(-6).reverse().map(c => c.city);
  Game.playEvent(0, 'hand', 'Forecast', {});
  check(G.forecastPending.map(c => c.city).join() === top6.join(), 'forecast shows next-to-draw order');
  Game.forecastCommit([5, 4, 3, 2, 1, 0]);
  const newTop = G.infectionDeck[G.infectionDeck.length - 1].city;
  check(newTop === top6[5], 'forecast reorder applied');
}

// --- Player deck exhaustion loses ---
{
  const G = fresh(['Medic', 'Researcher']);
  G.playerDeck = [];
  G.phase = 'draw'; G.cardsToDraw = 2; G.actionsLeft = 0;
  Game.drawPlayerCard();
  check(G.result && !G.result.win, 'empty player deck loses');
}

// --- Eradicated disease: infection card has no effect ---
{
  const G = fresh(['Medic', 'Researcher']);
  for (const k of Object.keys(G.cityCubes)) G.cityCubes[k].blue = 0;
  G.cubeSupply.blue = 24;
  G.cures.blue = true;
  G.infectionDeck.push({ city: 'Paris', color: 'blue' });
  G.phase = 'infect'; G.infectsLeft = 1;
  Game.flipInfectionCard();
  check(G.cityCubes.Paris.blue === 0, 'eradicated disease places no cubes');
}

console.log(`OK: ${passed} checks passed.`);
