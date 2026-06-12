'use strict';
// AI sanity tests: full games per skill level — every step must be legal,
// games must terminate, final states must pass the integrity census, and
// higher skill must clearly outperform lower skill.
// Run: node test/ai.js [games-per-level]

require('../js/data.js');
require('../js/game.js');
require('../js/ai.js');

const Game = globalThis.Game;
const AI = globalThis.AI;

const N = parseInt(process.argv[2] || '40', 10);
const results = {};

for (const level of Object.keys(AI.LEVELS)) {
  results[level] = { wins: 0, cures: 0, turns: 0 };
  for (let i = 0; i < N; i++) {
    Game.newGame({
      names: ['Bot A', 'Bot B'], epidemics: 4,
      ais: [level, level],
    });
    // NOTE: the AI's simulation uses Game.restore(), which replaces the
    // engine's state object — always re-fetch via Game.state(), never hold on
    // to the object newGame returned.
    let steps = 0;
    while (!Game.state().result) {
      if (++steps > 30000) throw new Error(`${level}: game did not terminate`);
      const did = AI.step(level);
      if (did === null && !Game.state().result) {
        throw new Error(`${level}: AI stalled in phase ${Game.state().phase}`);
      }
    }
    const G = Game.state();
    const v = Game.validate(G);
    if (!v.ok) throw new Error(`${level}: integrity failed — ${v.problems[0]}`);
    if (G.result.win) results[level].wins++;
    results[level].cures += ['blue', 'yellow', 'black', 'red'].filter(c => G.cures[c]).length;
    results[level].turns += G.turn;
  }
}

console.log(`${N} two-bot games per level (4 epidemics):`);
for (const [level, r] of Object.entries(results)) {
  console.log(`  ${level.padEnd(10)} wins ${String(r.wins).padStart(2)}/${N}   avg cures ${(r.cures / N).toFixed(2)}   avg turns ${(r.turns / N).toFixed(1)}`);
}

// Skill must separate: experts should average meaningfully more cure progress.
const nov = results.novice.cures / N, exp = results.expert.cures / N;
if (!(exp > nov + 0.3)) {
  throw new Error(`skill levels do not separate: novice ${nov.toFixed(2)} vs expert ${exp.toFixed(2)} avg cures`);
}
console.log('OK: levels separate (novice ' + nov.toFixed(2) + ' < expert ' + exp.toFixed(2) + ' avg cures).');
