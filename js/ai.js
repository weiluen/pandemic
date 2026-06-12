'use strict';
// AI players. No DOM access — runs under Node for tests, like game.js.
//
// Decision model: enumerate every legal engine call for the current phase,
// simulate each one on a snapshot, score the resulting state, restore, and
// pick the best (with skill-dependent randomness). Skill levels differ in how
// much of the scoring function they "see" and how often they blunder:
//   novice    — only reacts to cubes on the board; blunders half the time
//   competent — full strategic scoring; occasional blunders
//   expert    — full scoring, near-greedy, plays events proactively

(function () {
  const Game = globalThis.Game;
  const D = globalThis.PANDEMIC_DATA;
  const COLORS = ['blue', 'yellow', 'black', 'red'];

  const LEVELS = {
    novice:    { eps: 0.5,  strategic: false, events: false },
    competent: { eps: 0.15, strategic: true,  events: false },
    expert:    { eps: 0.02, strategic: true,  events: true },
  };

  // ---------------- Board geometry ----------------

  // All-pairs shortest hops via BFS, computed once.
  const DIST = {};
  for (const c of D.cities) {
    const d = { [c.name]: 0 };
    const q = [c.name];
    while (q.length) {
      const cur = q.shift();
      for (const n of Game.ADJ[cur]) {
        if (d[n] === undefined) { d[n] = d[cur] + 1; q.push(n); }
      }
    }
    DIST[c.name] = d;
  }

  // ---------------- State scoring ----------------

  function cureNeed(p) { return p.role === 'Scientist' ? 4 : 5; }

  function score(g, level) {
    const cfg = LEVELS[level] || LEVELS.competent;
    let s = 0;
    if (g.result) return g.result.win ? 1e9 : -1e9;

    // board pressure (all levels see this)
    let cubes = 0, threes = 0;
    let worst = null, worstN = 0;
    for (const c of D.cities) {
      for (const col of COLORS) {
        const n = g.cityCubes[c.name][col];
        cubes += n;
        if (n === 3) threes++;
        if (n > worstN) { worstN = n; worst = c.name; }
      }
    }
    s -= cubes * 9;
    s -= threes * 60;
    s -= g.outbreaks * 90;

    // being near trouble is good even for the novice
    for (const p of g.players) {
      let near = 9;
      for (const c of D.cities) {
        if (COLORS.some(col => g.cityCubes[c.name][col] > 0)) {
          near = Math.min(near, DIST[p.location][c.name]);
        }
      }
      s -= Math.min(near, 8) * 4;
    }
    if (!cfg.strategic) return s;

    // cures are the win condition
    const cured = COLORS.filter(c => g.cures[c]).length;
    s += cured * 1500;
    for (const col of COLORS) {
      if (g.cures[col] && D.cities.every(c => g.cityCubes[c.name][col] === 0)) s += 220; // eradicated
    }
    // concentration of one color in one hand is progress toward a cure
    for (const col of COLORS) {
      if (g.cures[col]) continue;
      for (const p of g.players) {
        const have = p.hand.filter(c => c.type === 'city' && c.color === col).length;
        const frac = Math.min(1, have / cureNeed(p));
        s += frac * frac * 220;
      }
    }
    // a cure-ready player standing at a station is one action from winning big
    for (const p of g.players) {
      for (const col of COLORS) {
        if (g.cures[col]) continue;
        const have = p.hand.filter(c => c.type === 'city' && c.color === col).length;
        if (have >= cureNeed(p)) s += g.stations.includes(p.location) ? 350 : 200 - DIST[p.location][nearestStation(g, p.location)] * 25;
      }
    }
    // station network: more stations, spread out
    s += Math.min(g.stations.length, 4) * 30;
    return s;
  }

  function nearestStation(g, from) {
    let best = g.stations[0], bd = Infinity;
    for (const st of g.stations) {
      if (DIST[from][st] < bd) { bd = DIST[from][st]; best = st; }
    }
    return best;
  }

  // ---------------- Candidate enumeration ----------------

  // The least cure-useful city card in a hand (used for opex / discards).
  function junkCardIdx(g, p, cityOnly) {
    let worstI = -1, worstV = Infinity;
    p.hand.forEach((c, i) => {
      if (c.type !== 'city') { if (!cityOnly && 8 < worstV) { worstV = 8; worstI = i; } return; }
      const same = p.hand.filter(o => o.type === 'city' && o.color === c.color).length;
      const v = g.cures[c.color] ? 0 : same;
      if (v < worstV) { worstV = v; worstI = i; }
    });
    return worstI;
  }

  function actionCandidates(g, level) {
    const cfg = LEVELS[level] || LEVELS.competent;
    const me = g.players[g.current];
    const out = [];

    // movement (dispatcher may steer everyone)
    const pawns = me.role === 'Dispatcher' ? g.players.map((_, i) => i) : [g.current];
    for (const pi of pawns) {
      for (const c of D.cities) {
        for (const o of Game.moveOptions(pi, c.name)) {
          if (o.type === 'opex') {
            const ci = junkCardIdx(g, me, true);
            if (ci >= 0) out.push({ desc: `opex to ${c.name}`, fn: () => Game.performMove(pi, 'opex', c.name, ci) });
          } else {
            out.push({ desc: `${o.type} ${g.players[pi].name} to ${c.name}`, fn: () => Game.performMove(pi, o.type, c.name) });
          }
        }
      }
    }
    // treat
    for (const col of COLORS) {
      if (g.cityCubes[me.location][col] > 0) {
        out.push({ desc: `treat ${col}`, fn: () => Game.treat(col) });
      }
    }
    // build
    if (!g.stations.includes(me.location) &&
        (me.role === 'Operations Expert' || me.hand.some(c => c.type === 'city' && c.city === me.location))) {
      const reloc = g.stations.length >= Game.MAX_STATIONS
        ? g.stations.slice().sort((a, b) => DIST[me.location][b] - DIST[me.location][a])[0] : undefined;
      out.push({ desc: `build in ${me.location}`, fn: () => Game.build(reloc) });
    }
    // cure
    if (g.stations.includes(me.location)) {
      for (const col of COLORS) {
        if (g.cures[col]) continue;
        const idxs = me.hand.map((c, i) => ({ c, i }))
          .filter(x => x.c.type === 'city' && x.c.color === col).map(x => x.i);
        if (idxs.length >= cureNeed(me)) {
          out.push({ desc: `cure ${col}`, fn: () => Game.discoverCure(col, idxs.slice(0, cureNeed(me))) });
        }
      }
    }
    // share knowledge (both directions with co-located players)
    g.players.forEach((p, i) => {
      if (i === g.current || p.location !== me.location) return;
      for (const [gi, ti] of [[g.current, i], [i, g.current]]) {
        const giver = g.players[gi];
        giver.hand.forEach((c, hi) => {
          if (c.type !== 'city') return;
          if (giver.role === 'Researcher' || c.city === giver.location) {
            out.push({ desc: `share ${c.city}`, fn: () => Game.shareKnowledge(gi, ti, hi) });
          }
        });
      }
    });
    // contingency planner retrieval
    if (me.role === 'Contingency Planner' && !g.contingency) {
      const ev = g.playerDiscard.find(c => c.type === 'event');
      if (ev) out.push({ desc: `retrieve ${ev.event}`, fn: () => Game.contingencyTake(ev.event) });
    }
    // events (free, any holder) — experts only
    if (cfg.events) out.push(...eventCandidates(g));
    // passing is always legal; it scores poorly unless truly nothing helps
    out.push({ desc: 'pass', fn: () => Game.pass(), penalty: 120 });
    return out;
  }

  function worstCity(g) {
    let best = null, bn = -1;
    for (const c of D.cities) {
      const n = COLORS.reduce((s, col) => s + g.cityCubes[c.name][col], 0);
      if (n > bn) { bn = n; best = c.name; }
    }
    return best;
  }

  function eventCandidates(g) {
    const out = [];
    g.players.forEach((p, pi) => {
      const sources = p.hand.filter(c => c.type === 'event').map(c => ({ source: 'hand', name: c.event }));
      if (p.role === 'Contingency Planner' && g.contingency) sources.push({ source: 'contingency', name: g.contingency });
      for (const { source, name } of sources) {
        if (!Game.canPlayEvent(name)) continue;
        if (name === 'Airlift') {
          const target = worstCity(g);
          g.players.forEach((q, qi) => {
            if (q.location !== target) {
              out.push({ desc: `airlift ${q.name} to ${target}`, fn: () => Game.playEvent(pi, source, 'Airlift', { pawnIdx: qi, city: target }) });
            }
          });
        } else if (name === 'Government Grant') {
          const target = worstCity(g);
          if (!g.stations.includes(target)) {
            const reloc = g.stations.length >= Game.MAX_STATIONS ? g.stations[0] : undefined;
            out.push({ desc: `grant station in ${target}`, fn: () => Game.playEvent(pi, source, 'Government Grant', { city: target, relocateFrom: reloc }) });
          }
        } else if (name === 'One Quiet Night') {
          if (!g.oneQuietNight && g.phase !== 'infect' && g.rateIndex >= 2) {
            out.push({ desc: 'one quiet night', fn: () => Game.playEvent(pi, source, 'One Quiet Night', {}) });
          }
        } else if (name === 'Resilient Population') {
          // pull the most dangerous city out of the infection deck's future
          let bi = -1, bn = -1;
          g.infectionDiscard.forEach((c, i) => {
            const n = g.cityCubes[c.city][c.color];
            if (n > bn) { bn = n; bi = i; }
          });
          if (bi >= 0 && bn >= 2) {
            out.push({ desc: 'resilient population', fn: () => Game.playEvent(pi, source, 'Resilient Population', { discardIdx: bi }) });
          }
        }
        // Forecast is handled reactively in step() so the reorder happens immediately
      }
    });
    return out;
  }

  // ---------------- Choosing & stepping ----------------

  function chooseAndPlay(candidates, level) {
    const cfg = LEVELS[level] || LEVELS.competent;
    if (!candidates.length) return null;
    // blunder: pick anything legal
    if (Math.random() < cfg.eps) {
      const pick = candidates[Math.floor(Math.random() * candidates.length)];
      try { pick.fn(); return pick.desc; } catch (e) { /* fall through to scored pick */ }
    }
    let best = null, bestS = -Infinity;
    for (const cand of candidates) {
      const snap = Game.snapshot();
      let s;
      try {
        cand.fn();
        s = score(Game.state(), level) - (cand.penalty || 0) + Math.random() * 4;
      } catch (e) {
        s = -Infinity;
      }
      Game.restore(snap);
      if (s > bestS) { bestS = s; best = cand; }
    }
    if (!best || bestS === -Infinity) return null;
    best.fn();
    return best.desc;
  }

  // Discard the least useful card when over the hand limit.
  function discardSmart(g, playerIdx) {
    const p = g.players[playerIdx];
    const i = junkCardIdx(g, p, false);
    Game.discardForLimit(playerIdx, i >= 0 ? i : 0);
    return `discard for hand limit`;
  }

  // Forecast: put the least dangerous cities on top (drawn first).
  function commitForecast(g) {
    const danger = c => g.cityCubes[c.city][c.color] * 10 + (g.cures[c.color] ? 0 : 1);
    const order = g.forecastPending.map((c, i) => ({ c, i }))
      .sort((a, b) => danger(a.c) - danger(b.c)).map(x => x.i);
    Game.forecastCommit(order);
  }

  // Advance the game by ONE engine call for the current AI player.
  // Returns a short description of what happened, or null if it is not an AI's
  // turn to act (e.g. a human must discard or resolve a forecast).
  function step(level) {
    const g = Game.state();
    if (!g || g.result) return null;
    if (g.forecastPending) { commitForecast(g); return 'forecast resolved'; }

    switch (g.phase) {
      case 'actions':
        return chooseAndPlay(actionCandidates(g, level), level);
      case 'draw':
        Game.drawPlayerCard();
        return 'draw';
      case 'epidemicPause': {
        // last chance to pull the epidemic city back out of the deck
        if ((LEVELS[level] || {}).events) {
          const cands = eventCandidates(g).filter(c => c.desc === 'resilient population');
          if (cands.length) { try { cands[0].fn(); return 'resilient population'; } catch (e) { /* intensify */ } }
        }
        Game.intensify();
        return 'intensify';
      }
      case 'discard': {
        const idx = g.discardQueue[0];
        if (!g.players[idx].ai) return null; // a human must discard — wait
        return discardSmart(g, idx);
      }
      case 'infect':
        Game.flipInfectionCard();
        return 'infect';
      default:
        return null;
    }
  }

  globalThis.AI = { step, LEVELS };
})();
