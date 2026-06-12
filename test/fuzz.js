'use strict';
// Fuzz test: plays many random games to completion, checking invariants after every step.
// Run: node test/fuzz.js [games]

require('../js/data.js');
require('../js/game.js');

const Game = globalThis.Game;
const D = globalThis.PANDEMIC_DATA;
const COLORS = Game.COLORS;
const CITIES = D.cities.map(c => c.name);

let stats = { win: 0, lose: 0, reasons: {} };

function rnd(a) { return a[Math.floor(Math.random() * a.length)]; }
function chance(p) { return Math.random() < p; }

function invariants(G, tag) {
  const fail = msg => { throw new Error(`[${tag}] invariant failed: ${msg}`); };
  for (const color of COLORS) {
    let onBoard = 0;
    for (const c of CITIES) {
      const n = G.cityCubes[c][color];
      if (n < 0 || n > 3) fail(`${c} has ${n} ${color} cubes`);
      onBoard += n;
    }
    const total = onBoard + G.cubeSupply[color];
    if (total !== 24) fail(`${color} cube conservation: board ${onBoard} + supply ${G.cubeSupply[color]} = ${total}`);
  }
  // Player card conservation: 48 city + 5 event + E epidemics.
  let count = G.playerDeck.length + G.playerDiscard.length + (G.contingency ? 1 : 0);
  for (const p of G.players) count += p.hand.length;
  count += G.removed.filter(c => c.type).length; // player-side removed cards have .type
  const expected = 48 + 5 + G.epidemics;
  if (count !== expected) fail(`player card conservation: ${count} != ${expected}`);
  // Infection card conservation: 48.
  let icount = G.infectionDeck.length + G.infectionDiscard.length +
    G.removed.filter(c => !c.type).length + (G.forecastPending ? G.forecastPending.length : 0);
  if (icount !== 48) fail(`infection card conservation: ${icount} != 48`);
  if (G.actionsLeft < 0 || G.actionsLeft > 4) fail(`actionsLeft ${G.actionsLeft}`);
  if (G.outbreaks > 8) fail(`outbreaks ${G.outbreaks}`);
  if (!G.result && !['actions', 'draw', 'epidemicPause', 'discard', 'infect'].includes(G.phase)) fail(`bad phase ${G.phase}`);
}

function maybePlayEvent(G) {
  if (!chance(0.25)) return false;
  const holders = [];
  G.players.forEach((p, i) => p.hand.forEach(c => { if (c.type === 'event') holders.push({ i, name: c.event }); }));
  const cp = G.players.findIndex(p => p.role === 'Contingency Planner');
  if (cp >= 0 && G.contingency) holders.push({ i: cp, name: G.contingency, source: 'contingency' });
  if (!holders.length) return false;
  const h = rnd(holders);
  if (!Game.canPlayEvent(h.name)) return false;
  const params = {};
  if (h.name === 'Airlift') {
    params.pawnIdx = Math.floor(Math.random() * G.players.length);
    params.city = rnd(CITIES);
    if (G.players[params.pawnIdx].location === params.city) return false;
  } else if (h.name === 'Government Grant') {
    const open = CITIES.filter(c => !G.stations.includes(c));
    if (!open.length) return false;
    params.city = rnd(open);
    if (G.stations.length >= 6) params.relocateFrom = rnd(G.stations);
  } else if (h.name === 'Resilient Population') {
    if (!G.infectionDiscard.length) return false;
    params.discardIdx = Math.floor(Math.random() * G.infectionDiscard.length);
  } else if (h.name === 'One Quiet Night') {
    if (G.oneQuietNight || G.phase === 'infect') return false;
  } else if (h.name === 'Forecast') {
    if (!G.infectionDeck.length) return false;
  }
  Game.playEvent(h.i, h.source || 'hand', h.name, params);
  if (G.forecastPending) {
    const order = G.forecastPending.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    Game.forecastCommit(order);
  }
  return true;
}

function randomAction(G) {
  const me = G.players[G.current];
  const choices = [];

  // Moves: try a handful of random destinations for each controllable pawn.
  const pawnIdxs = me.role === 'Dispatcher' ? G.players.map((_, i) => i) : [G.current];
  for (const pi of pawnIdxs) {
    for (let k = 0; k < 6; k++) {
      const dest = rnd(CITIES);
      const opts = Game.moveOptions(pi, dest);
      for (const o of opts) {
        if (o.type === 'opex') {
          const ci = me.hand.findIndex(c => c.type === 'city');
          if (ci >= 0) choices.push(() => Game.performMove(pi, 'opex', dest, ci));
        } else {
          choices.push(() => Game.performMove(pi, o.type, dest));
        }
      }
    }
  }
  // Treat (weighted heavily so games are not instant losses).
  for (const color of COLORS) {
    if (G.cityCubes[me.location][color] > 0) {
      for (let k = 0; k < 5; k++) choices.push(() => Game.treat(color));
    }
  }
  // Build.
  if (!G.stations.includes(me.location)) {
    const hasCard = me.hand.some(c => c.type === 'city' && c.city === me.location);
    if (hasCard || me.role === 'Operations Expert') {
      const reloc = G.stations.length >= 6 ? rnd(G.stations) : undefined;
      choices.push(() => Game.build(reloc));
    }
  }
  // Cure (weighted very heavily — it is the win condition).
  if (G.stations.includes(me.location)) {
    const need = me.role === 'Scientist' ? 4 : 5;
    for (const color of COLORS) {
      if (G.cures[color]) continue;
      const idxs = me.hand.map((c, i) => ({ c, i })).filter(x => x.c.type === 'city' && x.c.color === color).map(x => x.i);
      if (idxs.length >= need) {
        for (let k = 0; k < 20; k++) choices.push(() => Game.discoverCure(color, idxs.slice(0, need)));
      }
    }
  }
  // Share knowledge.
  G.players.forEach((p, i) => {
    if (i === G.current || p.location !== me.location) return;
    for (const [gi, ti] of [[G.current, i], [i, G.current]]) {
      const giver = G.players[gi];
      giver.hand.forEach((c, hi) => {
        if (c.type !== 'city') return;
        if (giver.role === 'Researcher' || c.city === giver.location) {
          choices.push(() => Game.shareKnowledge(gi, ti, hi));
        }
      });
    }
  });
  // Contingency Planner retrieval.
  if (me.role === 'Contingency Planner' && !G.contingency) {
    const ev = G.playerDiscard.find(c => c.type === 'event');
    if (ev) choices.push(() => Game.contingencyTake(ev.event));
  }
  // Pass (rare).
  choices.push(() => Game.pass());

  rnd(choices)();
}

function playGame(gameNum) {
  const nPlayers = 2 + Math.floor(Math.random() * 3);
  const G = Game.newGame({
    names: Array.from({ length: nPlayers }, (_, i) => `P${i + 1}`),
    epidemics: rnd([4, 5, 6]),
  });
  invariants(G, 'setup');

  let steps = 0;
  while (!G.result) {
    if (++steps > 20000) throw new Error('game did not terminate');
    maybePlayEvent(G);
    if (G.result) break;
    switch (G.phase) {
      case 'actions': randomAction(G); break;
      case 'draw': Game.drawPlayerCard(); break;
      case 'epidemicPause': Game.intensify(); break;
      case 'discard': {
        const pi = G.discardQueue[0];
        Game.discardForLimit(pi, Math.floor(Math.random() * G.players[pi].hand.length));
        break;
      }
      case 'infect': Game.flipInfectionCard(); break;
      default: throw new Error('unexpected phase ' + G.phase);
    }
    invariants(G, `game ${gameNum} step ${steps} phase ${G.phase}`);
  }
  if (G.result.win) stats.win++; else stats.lose++;
  stats.reasons[G.result.reason] = (stats.reasons[G.result.reason] || 0) + 1;

  // Serialization round-trip.
  const json = Game.serialize();
  Game.load(json);
  invariants(Game.state(), 'after load');
}

const N = parseInt(process.argv[2] || '300', 10);
for (let g = 1; g <= N; g++) playGame(g);
console.log(`OK: ${N} games completed. wins=${stats.win} losses=${stats.lose}`);
for (const [r, n] of Object.entries(stats.reasons)) console.log(`  ${n}× ${r}`);
