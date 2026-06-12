'use strict';
// Rules engine. No DOM access — also runs under Node for testing.

(function () {
  const D = globalThis.PANDEMIC_DATA;
  const COLORS = ['blue', 'yellow', 'black', 'red'];
  const INFECTION_RATES = [2, 2, 2, 3, 3, 4, 4];
  const HAND_LIMIT = 7;
  const MAX_STATIONS = 6;
  const CUBES_PER_COLOR = 24;
  const MAX_OUTBREAKS = 8;
  const START_CITY = 'Atlanta';

  // ---------------- Narration (world-events storyline) ----------------
  // Pure flavor text layered on top of the mechanical log. Each disease gets a
  // named strain and a home region so news bulletins read like a developing
  // global story rather than a list of rule triggers.
  const STRAIN = {
    blue:   { name: 'the Pale Cough',        region: 'across North America and Europe' },
    yellow: { name: 'the Sweating Sickness', region: 'through South America and Africa' },
    black:  { name: 'the Black Veil',        region: 'across the Middle East and South Asia' },
    red:    { name: 'the Crimson Fever',     region: 'across East Asia and the Pacific' },
  };

  const EPIDEMIC_NEWS = [
    (s, c) => `BREAKING — A superspreader event in ${c} sends ${s.name} racing out of control. Health ministries scramble.`,
    (s, c) => `ALERT — ${c} reports a catastrophic surge of ${s.name}. Hospitals overflow and borders slam shut ${s.region}.`,
    (s, c) => `${s.name} appears to be mutating. The flare-up in ${c} is spreading faster than any model predicted.`,
    (s, c) => `Panic empties the markets as ${s.name} erupts in ${c}. The global infection rate ticks upward.`,
    (s, c) => `Field dispatch: ${c} has become the new epicenter of ${s.name}. Aid convoys are turned back at checkpoints.`,
  ];

  const OUTBREAK_NEWS = [
    (s, c) => `${c} is overrun — ${s.name} spills into the surrounding cities. Quarantine lines buckle.`,
    (s, c) => `Martial law is declared in ${c} as ${s.name} breaches every containment cordon.`,
    (s, c) => `Refugees stream out of ${c}; ${s.name} rides the roads outward ${s.region}.`,
    (s, c) => `${c} goes dark. Communications fail as ${s.name} sweeps the region in hours.`,
  ];

  const CURE_NEWS = [
    s => `HOPE — Researchers announce a working cure for ${s.name}. Production lines spin up ${s.region}.`,
    s => `A second breakthrough: ${s.name} now has a cure. Morale lifts on the front lines ${s.region}.`,
    s => `The tide turns. With a cure for ${s.name} in hand, three of four strains are now treatable.`,
  ];

  let G = null;

  const CITY = {};
  for (const c of D.cities) CITY[c.name] = c;

  // Build symmetric adjacency from the declared lists.
  const ADJ = {};
  for (const c of D.cities) ADJ[c.name] = new Set(c.adj);
  for (const c of D.cities) for (const n of c.adj) ADJ[n].add(c.name);
  for (const k in ADJ) ADJ[k] = [...ADJ[k]];

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function log(msg, cls) {
    G.log.push({ msg, cls: cls || '', turn: G.turn });
    if (G.log.length > 500) G.log.splice(0, G.log.length - 500);
  }

  // A world-news bulletin in the log: storyline flavor, no mechanical effect.
  function narrate(msg) {
    G.log.push({ msg: '📰 ' + msg, cls: 'news', turn: G.turn });
    if (G.log.length > 500) G.log.splice(0, G.log.length - 500);
  }

  // Narration counters, lazily created so saves written before the storyline
  // existed (which have no `story` field) still work after loading.
  function story() {
    if (!G.story) G.story = { epidemics: 0, outbreaks: 0, cures: 0, milestones: {} };
    return G.story;
  }

  // Emit a news beat. The message is built inside a try/catch because narration
  // is pure decoration — a bug here must NEVER interrupt the rules engine
  // (an unhandled throw mid-epidemic/outbreak would skip infection steps).
  function newsBeat(build) {
    try { const msg = build(); if (msg) narrate(msg); } catch (e) { /* flavor only */ }
  }

  // Deterministic rotation through a template list so repeated beats vary
  // without ever depending on RNG (keeps tests reproducible).
  function rotate(arr, i) { return arr[((i % arr.length) + arr.length) % arr.length]; }

  function assert(cond, msg) {
    if (!cond) throw new Error('Illegal: ' + msg);
  }

  // ---------------- Setup ----------------

  function newGame(cfg) {
    const n = cfg.names.length;
    assert(n >= 2 && n <= 4, 'player count must be 2-4');
    let roleNames = cfg.roles && cfg.roles.every(Boolean)
      ? cfg.roles.slice()
      : shuffle(D.roles.map(r => r.name)).slice(0, n);
    assert(new Set(roleNames).size === n, 'duplicate roles');

    G = {
      players: cfg.names.map((name, i) => ({
        name: name || `Player ${i + 1}`, role: roleNames[i], location: START_CITY, hand: [],
      })),
      current: 0,
      turn: 1,
      actionsLeft: 4,
      phase: 'actions', // actions | draw | epidemicPause | discard | infect | over
      cardsToDraw: 0,
      infectsLeft: 0,
      discardQueue: [],
      afterDiscard: 'actions',
      playerDeck: [],
      playerDiscard: [],
      infectionDeck: [],
      infectionDiscard: [],
      removed: [],
      cityCubes: {},
      cubeSupply: { blue: CUBES_PER_COLOR, yellow: CUBES_PER_COLOR, black: CUBES_PER_COLOR, red: CUBES_PER_COLOR },
      stations: [START_CITY],
      cures: { blue: false, yellow: false, black: false, red: false },
      outbreaks: 0,
      rateIndex: 0,
      oneQuietNight: false,
      opexUsed: false,
      contingency: null, // event name stored by Contingency Planner
      forecastPending: null, // array of infection cards lifted off the deck
      epidemics: cfg.epidemics,
      lastDrawn: [],
      result: null, // {win:bool, reason}
      log: [],
      story: { epidemics: 0, outbreaks: 0, cures: 0, milestones: {} }, // narration counters
    };
    for (const c of D.cities) G.cityCubes[c.name] = { blue: 0, yellow: 0, black: 0, red: 0 };

    // Player deck: 48 city cards + 5 events, deal hands, then layer in epidemics.
    let deck = D.cities.map(c => ({ type: 'city', city: c.name, color: c.color }));
    for (const e of D.events) deck.push({ type: 'event', event: e.name });
    shuffle(deck);
    const handSize = 6 - n; // 2p:4, 3p:3, 4p:2
    for (const p of G.players) p.hand = deck.splice(0, handSize);

    const piles = [];
    const e = cfg.epidemics;
    const base = Math.floor(deck.length / e);
    let extra = deck.length % e;
    for (let i = 0; i < e; i++) {
      const size = base + (extra-- > 0 ? 1 : 0);
      const pile = deck.splice(0, size);
      pile.push({ type: 'epidemic' });
      shuffle(pile);
      piles.push(pile);
    }
    // Top of deck = end of array. piles[0] should be drawn first.
    G.playerDeck = piles.reverse().flat();

    // Infection deck + initial infections: 3/3/3 cities at 3/2/1 cubes.
    G.infectionDeck = shuffle(D.cities.map(c => ({ city: c.name, color: c.color })));
    log(`— Setup: initial infections —`);
    for (const count of [3, 3, 3, 2, 2, 2, 1, 1, 1]) {
      const card = G.infectionDeck.pop();
      G.infectionDiscard.push(card);
      G.cityCubes[card.city][card.color] = count; // setup ignores role protections
      G.cubeSupply[card.color] -= count;
      log(`${card.city} starts with ${count} ${card.color} cube${count > 1 ? 's' : ''}.`);
    }
    log(`Research station built in ${START_CITY}. All pawns start there.`);
    narrate('GENEVA — The WHO declares a Public Health Emergency of International Concern. Four novel pathogens have emerged at once.');
    narrate(`${STRAIN.blue.name} stirs ${STRAIN.blue.region}; ${STRAIN.yellow.name} spreads ${STRAIN.yellow.region}; ${STRAIN.black.name} takes hold ${STRAIN.black.region}; ${STRAIN.red.name} surges ${STRAIN.red.region}.`);
    narrate('A field team mobilizes from CDC Atlanta. The world is watching.');
    log(`${G.players[0].name}'s turn begins.`, 'good');
    return G;
  }

  // ---------------- Queries ----------------

  function isErad(color) {
    return G.cures[color] && D.cities.every(c => G.cityCubes[c.name][color] === 0);
  }

  function infectionRate() {
    return INFECTION_RATES[Math.min(G.rateIndex, INFECTION_RATES.length - 1)];
  }

  function protectedFrom(city, color) {
    for (const p of G.players) {
      if (p.role === 'Quarantine Specialist' && (p.location === city || ADJ[p.location].includes(city))) return p;
      if (p.role === 'Medic' && p.location === city && G.cures[color]) return p;
    }
    return null;
  }

  function playersOverLimit() {
    const out = [];
    G.players.forEach((p, i) => { if (p.hand.length > HAND_LIMIT) out.push(i); });
    return out;
  }

  function cardName(card) {
    if (card.type === 'city') return card.city;
    if (card.type === 'event') return card.event;
    return 'EPIDEMIC';
  }

  // Movement options for a pawn to reach `dest`, funded by the current player's hand.
  function moveOptions(pawnIdx, dest) {
    if (G.phase !== 'actions' || G.result) return [];
    const me = G.players[G.current];
    const controlled = pawnIdx === G.current || me.role === 'Dispatcher';
    if (!controlled) return [];
    const pawn = G.players[pawnIdx];
    if (pawn.location === dest) return [];
    const opts = [];
    if (ADJ[pawn.location].includes(dest)) opts.push({ type: 'drive', label: 'Drive / Ferry' });
    if (G.stations.includes(pawn.location) && G.stations.includes(dest)) opts.push({ type: 'shuttle', label: 'Shuttle Flight' });
    if (me.hand.some(c => c.type === 'city' && c.city === dest)) opts.push({ type: 'direct', label: `Direct Flight (discard ${dest})` });
    if (me.hand.some(c => c.type === 'city' && c.city === pawn.location)) opts.push({ type: 'charter', label: `Charter Flight (discard ${pawn.location})` });
    if (me.role === 'Dispatcher' && G.players.some((p, i) => i !== pawnIdx && p.location === dest)) {
      opts.push({ type: 'dispatch', label: 'Dispatch (move to a city with another pawn)' });
    }
    if (pawnIdx === G.current && me.role === 'Operations Expert' && !G.opexUsed &&
        G.stations.includes(pawn.location) && me.hand.some(c => c.type === 'city')) {
      opts.push({ type: 'opex', label: 'Operations Flight (discard any city card)' });
    }
    return opts;
  }

  // ---------------- Cube placement / outbreaks ----------------

  function gameOver(win, reason) {
    if (G.result) return;
    G.result = { win, reason };
    G.phase = 'over';
    log(win ? `VICTORY — ${reason}` : `DEFEAT — ${reason}`, win ? 'good' : 'bad');
    newsBeat(() => win
      ? 'THE WORLD EXHALES — with every disease cured, the pandemic is declared over. The field team is hailed across every front page.'
      : `SILENCE FALLS — ${reason}. The campaign is lost, and the world goes dark.`);
  }

  function removeCubes(city, color, count) {
    const cc = G.cityCubes[city];
    const n = Math.min(count, cc[color]);
    cc[color] -= n;
    G.cubeSupply[color] += n;
    return n;
  }

  function placeCube(city, color, chain) {
    if (G.result) return;
    const guard = protectedFrom(city, color);
    if (guard) { log(`${guard.role} prevents infection in ${city}.`, 'good'); return; }
    const cc = G.cityCubes[city];
    if (cc[color] >= 3) { outbreak(city, color, chain); return; }
    if (G.cubeSupply[color] === 0) {
      gameOver(false, `the ${color} disease spread beyond control (no cubes left in supply)`);
      return;
    }
    G.cubeSupply[color]--;
    cc[color]++;
  }

  function outbreak(city, color, chain) {
    if (chain.has(city) || G.result) return;
    chain.add(city);
    G.outbreaks++;
    log(`OUTBREAK of ${color} in ${city}! (${G.outbreaks}/${MAX_OUTBREAKS})`, 'bad');
    newsBeat(() => rotate(OUTBREAK_NEWS, story().outbreaks++)(STRAIN[color], city));
    if (G.outbreaks === 4) newsBeat(() => {
      if (story().milestones.half) return null;
      story().milestones.half = true;
      return 'World leaders convene an emergency summit as the global outbreak tally hits four. The public mood turns to dread.';
    });
    if (G.outbreaks === 6) newsBeat(() => {
      if (story().milestones.brink) return null;
      story().milestones.brink = true;
      return 'Six outbreaks and counting. Society teeters — two more and there will be no coming back.';
    });
    if (G.outbreaks >= MAX_OUTBREAKS) {
      gameOver(false, 'worldwide panic — the 8th outbreak occurred');
      return;
    }
    for (const n of ADJ[city]) {
      placeCube(n, color, chain);
      if (G.result) return;
    }
  }

  function infectCity(card) {
    if (isErad(card.color)) {
      log(`${card.city} drawn, but ${card.color} is eradicated — no effect.`, 'good');
      return;
    }
    const before = G.cityCubes[card.city][card.color];
    placeCube(card.city, card.color, new Set());
    const after = G.cityCubes[card.city][card.color];
    if (after > before) log(`${card.city} infected (${card.color}: ${after}).`);
  }

  // ---------------- Phase flow ----------------

  function startDiscard(playerIdxs, after) {
    G.discardQueue = playerIdxs;
    G.afterDiscard = after;
    G.phase = 'discard';
    log(`${playerIdxs.map(i => G.players[i].name).join(', ')} must discard down to ${HAND_LIMIT} cards.`);
  }

  function routeAfterDiscard() {
    const after = G.afterDiscard;
    if (after === 'draw') toDraw();
    else if (after === 'infect') toInfect();
    else G.phase = 'actions';
  }

  function recheckDiscardQueue() {
    if (G.phase !== 'discard') return;
    G.discardQueue = G.discardQueue.filter(i => G.players[i].hand.length > HAND_LIMIT);
    if (G.discardQueue.length === 0) routeAfterDiscard();
  }

  // House rule: holding more than 7 cards is fine DURING a turn (it makes
  // sharing knowledge toward a cure practical); the limit is only enforced
  // at the end of the turn, after the draw step (see afterDraw). And it is
  // enforced ONLY against the player whose turn it is — a player handed cards
  // on someone else's turn keeps them until the end of their OWN next turn,
  // so they have a chance to use them first.
  function spendAction() {
    G.actionsLeft--;
    if (G.actionsLeft === 0) toDraw();
  }

  function toDraw() {
    G.phase = 'draw';
    G.cardsToDraw = 2;
    G.lastDrawn = [];
  }

  function afterDraw() {
    // Only the current player must reconcile their hand at end of turn; other
    // players who are over the limit wait until their own turn ends.
    if (G.players[G.current].hand.length > HAND_LIMIT) startDiscard([G.current], 'infect');
    else toInfect();
  }

  function toInfect() {
    if (G.oneQuietNight) {
      G.oneQuietNight = false;
      log('One Quiet Night: the Infect Cities step is skipped.', 'good');
      nextTurn();
      return;
    }
    G.phase = 'infect';
    G.infectsLeft = infectionRate();
  }

  function nextTurn() {
    if (G.result) return;
    G.current = (G.current + 1) % G.players.length;
    G.turn++;
    G.actionsLeft = 4;
    G.opexUsed = false;
    G.phase = 'actions';
    log(`${G.players[G.current].name}'s turn begins.`, 'good');
  }

  // ---------------- Player actions ----------------

  function requireActions() {
    assert(!G.result, 'game is over');
    assert(G.phase === 'actions', 'not in the action phase');
    assert(G.actionsLeft > 0, 'no actions left');
  }

  function discardFromHand(playerIdx, handIdx) {
    const p = G.players[playerIdx];
    const [card] = p.hand.splice(handIdx, 1);
    G.playerDiscard.push(card);
    return card;
  }

  function findCityCard(hand, cityName) {
    return hand.findIndex(c => c.type === 'city' && c.city === cityName);
  }

  function performMove(pawnIdx, type, dest, cardIdx) {
    requireActions();
    const me = G.players[G.current];
    const pawn = G.players[pawnIdx];
    assert(CITY[dest], 'unknown city');
    assert(pawnIdx === G.current || me.role === 'Dispatcher', 'you cannot move that pawn');
    assert(pawn.location !== dest, 'pawn is already there');

    switch (type) {
      case 'drive':
        assert(ADJ[pawn.location].includes(dest), 'cities are not connected');
        break;
      case 'shuttle':
        assert(G.stations.includes(pawn.location) && G.stations.includes(dest), 'shuttle needs stations at both ends');
        break;
      case 'direct': {
        const i = findCityCard(me.hand, dest);
        assert(i >= 0, `you do not hold the ${dest} card`);
        discardFromHand(G.current, i);
        break;
      }
      case 'charter': {
        const i = findCityCard(me.hand, pawn.location);
        assert(i >= 0, `you do not hold the ${pawn.location} card`);
        discardFromHand(G.current, i);
        break;
      }
      case 'dispatch':
        assert(me.role === 'Dispatcher', 'only the Dispatcher can do that');
        assert(G.players.some((p, i) => i !== pawnIdx && p.location === dest), 'no other pawn in that city');
        break;
      case 'opex': {
        assert(pawnIdx === G.current && me.role === 'Operations Expert', 'only the Operations Expert can do that');
        assert(!G.opexUsed, 'operations flight already used this turn');
        assert(G.stations.includes(pawn.location), 'must be at a research station');
        const card = me.hand[cardIdx];
        assert(card && card.type === 'city', 'choose a city card to discard');
        discardFromHand(G.current, cardIdx);
        G.opexUsed = true;
        break;
      }
      default:
        assert(false, 'unknown move type');
    }
    pawn.location = dest;
    log(`${me.name} ${pawnIdx === G.current ? 'moves' : `moves ${pawn.name}`} to ${dest} (${type}).`);
    medicSweep(pawnIdx);
    spendAction();
  }

  function medicSweep(pawnIdx) {
    const p = G.players[pawnIdx];
    if (p.role !== 'Medic') return;
    for (const color of COLORS) {
      if (G.cures[color] && G.cityCubes[p.location][color] > 0) {
        const n = removeCubes(p.location, color, 3);
        log(`Medic automatically clears ${n} ${color} cube${n > 1 ? 's' : ''} in ${p.location}.`, 'good');
      }
    }
  }

  function treat(color) {
    requireActions();
    const me = G.players[G.current];
    const cc = G.cityCubes[me.location];
    assert(cc[color] > 0, `no ${color} cubes here`);
    const all = G.cures[color] || me.role === 'Medic';
    const n = removeCubes(me.location, color, all ? 3 : 1);
    log(`${me.name} treats ${color} in ${me.location} (removed ${n}).`);
    if (isErad(color)) {
      log(`The ${color} disease has been ERADICATED!`, 'good');
      newsBeat(() => `${STRAIN[color].name} is gone for good — the last known case has been cleared. A genuine victory for the campaign.`);
    }
    spendAction();
  }

  function build(relocateFrom) {
    requireActions();
    const me = G.players[G.current];
    assert(!G.stations.includes(me.location), 'a station is already here');
    if (me.role !== 'Operations Expert') {
      const i = findCityCard(me.hand, me.location);
      assert(i >= 0, `you must hold the ${me.location} card`);
      discardFromHand(G.current, i);
    }
    if (G.stations.length >= MAX_STATIONS) {
      assert(relocateFrom && G.stations.includes(relocateFrom), 'all 6 stations are built — choose one to move');
      G.stations.splice(G.stations.indexOf(relocateFrom), 1);
      log(`The research station in ${relocateFrom} is dismantled.`);
    }
    G.stations.push(me.location);
    log(`${me.name} builds a research station in ${me.location}.`, 'good');
    spendAction();
  }

  function discoverCure(color, handIdxs) {
    requireActions();
    const me = G.players[G.current];
    assert(G.stations.includes(me.location), 'must be at a research station');
    assert(!G.cures[color], `${color} is already cured`);
    const need = me.role === 'Scientist' ? 4 : 5;
    assert(handIdxs.length === need, `select exactly ${need} cards`);
    assert(new Set(handIdxs).size === need, 'duplicate card selection');
    for (const i of handIdxs) {
      const c = me.hand[i];
      assert(c && c.type === 'city' && c.color === color, `all cards must be ${color} city cards`);
    }
    for (const i of handIdxs.slice().sort((a, b) => b - a)) discardFromHand(G.current, i);
    G.cures[color] = true;
    log(`${me.name} discovers a CURE for the ${color} disease!`, 'good');
    const curesFound = COLORS.filter(c => G.cures[c]).length;
    if (curesFound < 4) newsBeat(() => rotate(CURE_NEWS, curesFound - 1)(STRAIN[color]));
    for (let i = 0; i < G.players.length; i++) medicSweep(i);
    if (isErad(color)) {
      log(`The ${color} disease has been ERADICATED!`, 'good');
      newsBeat(() => `${STRAIN[color].name} is gone for good — the last known case has been cleared. A genuine victory for the campaign.`);
    }
    if (COLORS.every(c => G.cures[c])) { gameOver(true, 'all four diseases have been cured'); return; }
    spendAction();
  }

  function shareKnowledge(giverIdx, takerIdx, handIdx) {
    requireActions();
    assert(giverIdx !== takerIdx, 'choose two different players');
    assert(giverIdx === G.current || takerIdx === G.current, 'the current player must take part');
    const giver = G.players[giverIdx], taker = G.players[takerIdx];
    assert(giver.location === taker.location, 'both players must be in the same city');
    const card = giver.hand[handIdx];
    assert(card && card.type === 'city', 'choose a city card');
    assert(giver.role === 'Researcher' || card.city === giver.location,
      'the card must match the city you are both in (unless the giver is the Researcher)');
    giver.hand.splice(handIdx, 1);
    taker.hand.push(card);
    log(`${giver.name} gives the ${card.city} card to ${taker.name}.`);
    spendAction();
  }

  function pass() {
    requireActions();
    log(`${G.players[G.current].name} passes (${G.actionsLeft} action${G.actionsLeft > 1 ? 's' : ''} forfeited).`);
    G.actionsLeft = 0;
    toDraw();
  }

  function contingencyTake(eventName) {
    requireActions();
    const me = G.players[G.current];
    assert(me.role === 'Contingency Planner', 'only the Contingency Planner can do that');
    assert(!G.contingency, 'an event is already stored');
    const i = G.playerDiscard.findIndex(c => c.type === 'event' && c.event === eventName);
    assert(i >= 0, 'that event is not in the discard pile');
    G.playerDiscard.splice(i, 1);
    G.contingency = eventName;
    log(`${me.name} retrieves ${eventName} from the discard pile.`, 'good');
    spendAction();
  }

  // ---------------- Drawing & epidemics ----------------

  function drawPlayerCard() {
    assert(!G.result, 'game is over');
    assert(G.phase === 'draw' && G.cardsToDraw > 0, 'not in the draw phase');
    if (G.playerDeck.length === 0) {
      gameOver(false, 'the player deck ran out — time has run out');
      return null;
    }
    const card = G.playerDeck.pop();
    G.cardsToDraw--;
    G.lastDrawn.push(card);
    if (card.type === 'epidemic') {
      G.removed.push(card);
      G.rateIndex = Math.min(G.rateIndex + 1, INFECTION_RATES.length - 1);
      log(`EPIDEMIC! Infection rate rises to ${infectionRate()}.`, 'bad');
      if (G.infectionDeck.length === 0) reshuffleInfectionDeck();
      const ic = G.infectionDeck.shift(); // bottom card
      G.infectionDiscard.push(ic);
      log(`Epidemic strikes ${ic.city}.`, 'bad');
      newsBeat(() => rotate(EPIDEMIC_NEWS, story().epidemics++)(STRAIN[ic.color], ic.city));
      epidemicInfect(ic);
      if (!G.result) G.phase = 'epidemicPause';
    } else {
      G.players[G.current].hand.push(card);
      log(`${G.players[G.current].name} draws ${cardName(card)}.`);
      if (G.cardsToDraw === 0) afterDraw();
    }
    return card;
  }

  function epidemicInfect(ic) {
    if (isErad(ic.color)) { log(`${ic.color} is eradicated — the epidemic fizzles.`, 'good'); return; }
    if (protectedFrom(ic.city, ic.color)) { log(`${ic.city} is protected — the epidemic is contained.`, 'good'); return; }
    const cc = G.cityCubes[ic.city];
    const had = cc[ic.color];
    while (cc[ic.color] < 3) {
      if (G.cubeSupply[ic.color] === 0) {
        gameOver(false, `the ${ic.color} disease spread beyond control (no cubes left in supply)`);
        return;
      }
      G.cubeSupply[ic.color]--;
      cc[ic.color]++;
    }
    if (had > 0) outbreak(ic.city, ic.color, new Set());
  }

  function intensify() {
    assert(G.phase === 'epidemicPause', 'no epidemic to intensify');
    shuffle(G.infectionDiscard);
    G.infectionDeck.push(...G.infectionDiscard);
    G.infectionDiscard = [];
    log('The infection discard pile is shuffled and placed back on top of the deck.');
    if (G.cardsToDraw > 0) G.phase = 'draw';
    else afterDraw();
  }

  function reshuffleInfectionDeck() {
    // Not in the official rules (the deck practically never empties); avoids a dead end.
    shuffle(G.infectionDiscard);
    G.infectionDeck.push(...G.infectionDiscard);
    G.infectionDiscard = [];
    log('Infection deck was empty — discard pile reshuffled.');
  }

  function flipInfectionCard() {
    assert(!G.result, 'game is over');
    assert(G.phase === 'infect' && G.infectsLeft > 0, 'not in the infect phase');
    if (G.infectionDeck.length === 0) reshuffleInfectionDeck();
    const card = G.infectionDeck.pop();
    G.infectionDiscard.push(card);
    infectCity(card);
    G.infectsLeft--;
    if (G.infectsLeft === 0 && !G.result) nextTurn();
    return card;
  }

  // ---------------- Hand-limit discards ----------------

  function discardForLimit(playerIdx, handIdx) {
    assert(G.phase === 'discard', 'no discard is required');
    assert(G.discardQueue.includes(playerIdx), 'that player does not need to discard');
    const card = discardFromHand(playerIdx, handIdx);
    log(`${G.players[playerIdx].name} discards ${cardName(card)} (hand limit).`);
    recheckDiscardQueue();
  }

  // ---------------- Events ----------------

  function canPlayEvent(eventName) {
    if (G.result || G.forecastPending) return false;
    if (G.phase === 'epidemicPause') return eventName === 'Resilient Population';
    return ['actions', 'draw', 'infect', 'discard'].includes(G.phase);
  }

  function takeEventCard(playerIdx, source, eventName) {
    const p = G.players[playerIdx];
    if (source === 'contingency') {
      assert(p.role === 'Contingency Planner' && G.contingency === eventName, 'no such stored event');
      G.contingency = null;
      G.removed.push({ type: 'event', event: eventName });
      log(`${p.name} plays the stored ${eventName} (removed from the game).`);
    } else {
      const i = p.hand.findIndex(c => c.type === 'event' && c.event === eventName);
      assert(i >= 0, 'you do not hold that event');
      const [card] = p.hand.splice(i, 1);
      G.playerDiscard.push(card);
      log(`${p.name} plays ${eventName}.`);
    }
  }

  function playEvent(playerIdx, source, eventName, params) {
    assert(!G.result, 'game is over');
    assert(canPlayEvent(eventName), 'events cannot be played right now');
    params = params || {};

    switch (eventName) {
      case 'Airlift': {
        const pawn = G.players[params.pawnIdx];
        assert(pawn && CITY[params.city], 'choose a pawn and a city');
        assert(pawn.location !== params.city, 'pawn is already there');
        takeEventCard(playerIdx, source, eventName);
        pawn.location = params.city;
        log(`Airlift: ${pawn.name} flies to ${params.city}.`, 'good');
        medicSweep(params.pawnIdx);
        break;
      }
      case 'Government Grant': {
        assert(CITY[params.city], 'choose a city');
        assert(!G.stations.includes(params.city), 'a station is already there');
        if (G.stations.length >= MAX_STATIONS) {
          assert(params.relocateFrom && G.stations.includes(params.relocateFrom), 'all 6 stations are built — choose one to move');
        }
        takeEventCard(playerIdx, source, eventName);
        if (G.stations.length >= MAX_STATIONS) {
          G.stations.splice(G.stations.indexOf(params.relocateFrom), 1);
          log(`The research station in ${params.relocateFrom} is dismantled.`);
        }
        G.stations.push(params.city);
        log(`Government Grant: a research station is built in ${params.city}.`, 'good');
        break;
      }
      case 'One Quiet Night': {
        assert(!G.oneQuietNight, 'One Quiet Night is already in effect');
        assert(G.phase !== 'infect', 'too late — infection is already underway');
        takeEventCard(playerIdx, source, eventName);
        log('One Quiet Night: the next Infect Cities step will be skipped.', 'good');
        G.oneQuietNight = true;
        break;
      }
      case 'Resilient Population': {
        const i = params.discardIdx;
        assert(Number.isInteger(i) && G.infectionDiscard[i], 'choose a card from the infection discard pile');
        takeEventCard(playerIdx, source, eventName);
        const [card] = G.infectionDiscard.splice(i, 1);
        G.removed.push(card);
        log(`Resilient Population: ${card.city} is removed from the infection deck forever.`, 'good');
        break;
      }
      case 'Forecast': {
        assert(G.infectionDeck.length > 0, 'the infection deck is empty');
        takeEventCard(playerIdx, source, eventName);
        const n = Math.min(6, G.infectionDeck.length);
        G.forecastPending = G.infectionDeck.splice(G.infectionDeck.length - n, n).reverse();
        // forecastPending[0] is what would have been drawn next.
        log(`Forecast: looking at the top ${n} infection cards.`, 'good');
        break;
      }
      default:
        assert(false, 'unknown event');
    }
    recheckDiscardQueue();
  }

  function forecastCommit(order) {
    assert(G.forecastPending, 'no forecast in progress');
    const cards = G.forecastPending;
    assert(order.length === cards.length && new Set(order).size === order.length, 'invalid order');
    // order[0] will be drawn next, so push it last (top of deck = end of array).
    for (let i = order.length - 1; i >= 0; i--) G.infectionDeck.push(cards[order[i]]);
    G.forecastPending = null;
    log('Forecast: the cards are returned to the top of the infection deck.');
  }

  // ---------------- Save / load / undo ----------------

  // Backfill fields added after a save was written, so older saves/snapshots
  // (e.g. from before narration existed) load without crashing the engine.
  function migrate(g) {
    if (!g.story) g.story = { epidemics: 0, outbreaks: 0, cures: 0, milestones: {} };
    return g;
  }

  function serialize() { return JSON.stringify(G); }
  function load(json) { G = migrate(JSON.parse(json)); return G; }
  function snapshot() { return JSON.stringify(G); }
  function restore(snap) { G = migrate(JSON.parse(snap)); }

  globalThis.Game = {
    COLORS, INFECTION_RATES, HAND_LIMIT, MAX_STATIONS, CUBES_PER_COLOR, MAX_OUTBREAKS,
    CITY, ADJ,
    newGame, state: () => G,
    isErad, infectionRate, moveOptions, cardName, playersOverLimit, protectedFrom,
    performMove, treat, build, discoverCure, shareKnowledge, pass, contingencyTake,
    drawPlayerCard, intensify, flipInfectionCard, discardForLimit,
    canPlayEvent, playEvent, forecastCommit,
    serialize, load, snapshot, restore,
  };
})();
