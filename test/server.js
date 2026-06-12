'use strict';
// Integration tests for server.js. Boots the real server on an ephemeral port
// and drives it over HTTP. Run: node test/server.js
const assert = require('node:assert');
const http = require('http');

process.env.PANDEMIC_SAVE = require('path').join(__dirname, 'tmp-rooms.json');
try { require('fs').unlinkSync(process.env.PANDEMIC_SAVE); } catch (e) {}

const srv = require('../server.js');

let passed = 0, failed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}

let base; // http://127.0.0.1:<port>
async function post(path, body) {
  const r = await fetch(base + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

// Minimal SSE client: opens the stream, exposes an async next() for events.
function sseOpen(pathWithQuery) {
  const queue = [], waiters = [];
  let buf = '';
  const req = http.get(base + pathWithQuery, res => {
    res.setEncoding('utf8');
    res.on('data', chunk => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, i); buf = buf.slice(i + 2);
        const data = frame.split('\n').filter(l => l.startsWith('data: '))
          .map(l => l.slice(6)).join('');
        if (!data) continue;
        const ev = JSON.parse(data);
        if (waiters.length) waiters.shift()(ev); else queue.push(ev);
      }
    });
  });
  return {
    next(timeoutMs = 2000) {
      if (queue.length) return Promise.resolve(queue.shift());
      return new Promise((resolve, reject) => {
        const to = setTimeout(() => reject(new Error('SSE timeout')), timeoutMs);
        waiters.push(ev => { clearTimeout(to); resolve(ev); });
      });
    },
    close() { req.destroy(); },
  };
}

async function main() {
  const server = srv.createAppServer();
  await new Promise(res => server.listen(0, '127.0.0.1', res));
  base = `http://127.0.0.1:${server.address().port}`;

  await t('ping responds ok', async () => {
    const r = await fetch(base + '/api/ping');
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true });
  });

  await t('serves index.html at / with Last-Modified', async () => {
    const r = await fetch(base + '/');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /text\/html/);
    assert.ok(r.headers.get('last-modified'));
    assert.match(await r.text(), /PANDEMIC|pandemic/i);
  });

  await t('serves js/game.js with js mime', async () => {
    const r = await fetch(base + '/js/game.js');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /javascript/);
  });

  await t('HEAD request gets headers only', async () => {
    const r = await fetch(base + '/index.html', { method: 'HEAD' });
    assert.equal(r.status, 200);
    assert.ok(r.headers.get('last-modified'));
    assert.equal(await r.text(), '');
  });

  await t('404 on missing file', async () => {
    const r = await fetch(base + '/nope.xyz');
    assert.equal(r.status, 404);
  });

  await t('blocks path traversal', async () => {
    // raw request: fetch normalizes "..", so speak HTTP directly
    const status = await new Promise((resolve, reject) => {
      const req = http.request({
        host: '127.0.0.1', port: server.address().port,
        path: '/../../etc/hosts', method: 'GET',
      }, res => { res.resume(); resolve(res.statusCode); });
      req.on('error', reject); req.end();
    });
    assert.ok(status === 404 || status === 400, `got ${status}`);
  });

  // ---- rooms: create / join / rejoin ----
  let room; // {code, token, seat}

  await t('create room', async () => {
    const r = await post('/api/rooms', { name: 'Alice' });
    assert.equal(r.status, 200);
    assert.match(r.body.code, /^[A-Z]{4}$/);
    assert.ok(r.body.token.length >= 16);
    assert.equal(r.body.seat, 0);
    room = r.body;
  });

  await t('join room', async () => {
    const r = await post(`/api/rooms/${room.code}/join`, { name: 'Bob' });
    assert.equal(r.status, 200);
    assert.equal(r.body.seat, 1);
    room.bob = r.body.token;
  });

  await t('join unknown room is 404', async () => {
    const r = await post('/api/rooms/ZZZZ/join', { name: 'Eve' });
    assert.equal(r.status, 404);
  });

  await t('rejoin by token returns same seat, no new seat', async () => {
    const r = await post(`/api/rooms/${room.code}/join`, { token: room.bob });
    assert.equal(r.status, 200);
    assert.equal(r.body.seat, 1);
    assert.equal(srv.rooms.get(room.code).seats.length, 2);
  });

  await t('room is full after 4 seats', async () => {
    await post(`/api/rooms/${room.code}/join`, { name: 'Cara' });
    await post(`/api/rooms/${room.code}/join`, { name: 'Dan' });
    const r = await post(`/api/rooms/${room.code}/join`, { name: 'Eve' });
    assert.equal(r.status, 409);
  });

  await t('name defaults when blank', async () => {
    const r2 = await post('/api/rooms', {});
    assert.equal(srv.rooms.get(r2.body.code).seats[0].name, 'Player 1');
  });

  // ---- game flow: start / actions / permissions / undo ----
  // These reach into srv.rooms (same process) to patch state deterministically —
  // engine shuffles are random, so tests construct the scenarios they need.
  function patchState(code, fn) {
    const r = srv.rooms.get(code);
    const g = JSON.parse(r.state);
    fn(g);
    r.state = JSON.stringify(g);
    return g;
  }
  const stateOf = code => JSON.parse(srv.rooms.get(code).state);

  let g2; // 2-player game: {code, alice, bob}
  await t('start requires host', async () => {
    const c = await post('/api/rooms', { name: 'Alice' });
    const j = await post(`/api/rooms/${c.body.code}/join`, { name: 'Bob' });
    g2 = { code: c.body.code, alice: c.body.token, bob: j.body.token };
    const r = await post(`/api/rooms/${g2.code}/start`, { token: g2.bob, epidemics: 4 });
    assert.equal(r.status, 403);
  });

  await t('host starts the game', async () => {
    const r = await post(`/api/rooms/${g2.code}/start`, { token: g2.alice, epidemics: 4 });
    assert.equal(r.status, 200);
    const g = stateOf(g2.code);
    assert.equal(g.players.length, 2);
    assert.equal(g.players[0].name, 'Alice');
    assert.equal(g.phase, 'actions');
    assert.equal(srv.rooms.get(g2.code).status, 'playing');
  });

  await t('start twice is rejected', async () => {
    const r = await post(`/api/rooms/${g2.code}/start`, { token: g2.alice, epidemics: 4 });
    assert.equal(r.status, 409);
  });

  await t('action by wrong seat is 403', async () => {
    const r = await post(`/api/rooms/${g2.code}/action`, { token: g2.bob, fn: 'pass', args: [] });
    assert.equal(r.status, 403);
    assert.match(r.body.error, /turn/);
  });

  await t('non-whitelisted fn is rejected', async () => {
    const r = await post(`/api/rooms/${g2.code}/action`, { token: g2.alice, fn: 'newGame', args: [{}] });
    assert.equal(r.status, 400);
  });

  await t('current player moves; state advances', async () => {
    const r = await post(`/api/rooms/${g2.code}/action`,
      { token: g2.alice, fn: 'performMove', args: [0, 'drive', 'Chicago'] });
    assert.equal(r.status, 200);
    assert.equal(stateOf(g2.code).players[0].location, 'Chicago');
    assert.equal(stateOf(g2.code).actionsLeft, 3);
  });

  await t('illegal engine move is 400 with engine message', async () => {
    const r = await post(`/api/rooms/${g2.code}/action`,
      { token: g2.alice, fn: 'performMove', args: [0, 'drive', 'Tokyo'] });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /not connected/);
  });

  await t('undo restores pre-move state, current player only', async () => {
    const deny = await post(`/api/rooms/${g2.code}/undo`, { token: g2.bob });
    assert.equal(deny.status, 403);
    const r = await post(`/api/rooms/${g2.code}/undo`, { token: g2.alice });
    assert.equal(r.status, 200);
    assert.equal(stateOf(g2.code).players[0].location, 'Atlanta');
    assert.equal(stateOf(g2.code).actionsLeft, 4);
    const empty = await post(`/api/rooms/${g2.code}/undo`, { token: g2.alice });
    assert.equal(empty.status, 400); // nothing left to undo
  });

  await t('drawPlayerCard returns the drawn card', async () => {
    // burn alice's actions deterministically, then stack the deck with two
    // city cards so no epidemic interrupts the draw phase
    await post(`/api/rooms/${g2.code}/action`, { token: g2.alice, fn: 'pass', args: [] });
    patchState(g2.code, g => {
      g.playerDeck.push({ type: 'city', city: 'Lima', color: 'yellow' },
                        { type: 'city', city: 'Paris', color: 'blue' });
    });
    const r = await post(`/api/rooms/${g2.code}/action`, { token: g2.alice, fn: 'drawPlayerCard', args: [] });
    assert.equal(r.status, 200);
    assert.equal(r.body.ret.city, 'Paris'); // top of deck = end of array
    const r2 = await post(`/api/rooms/${g2.code}/action`, { token: g2.alice, fn: 'drawPlayerCard', args: [] });
    assert.equal(r2.body.ret.city, 'Lima');
    assert.equal(stateOf(g2.code).phase, 'infect');
  });

  await t('turn handoff clears undo snapshots', async () => {
    const room = srv.rooms.get(g2.code);
    const flips = stateOf(g2.code).infectsLeft;
    for (let i = 0; i < flips; i++) {
      const r = await post(`/api/rooms/${g2.code}/action`, { token: g2.alice, fn: 'flipInfectionCard', args: [] });
      assert.equal(r.status, 200);
    }
    assert.equal(stateOf(g2.code).current, 1); // bob's turn now
    assert.equal(room.turnSnapshots.length, 0);
    const r = await post(`/api/rooms/${g2.code}/undo`, { token: g2.bob });
    assert.equal(r.status, 400); // bob has done nothing yet
  });

  await t('events: own-seat only, and playEvent voids undo', async () => {
    // give alice an Airlift, have bob (current) move once, then alice plays it
    patchState(g2.code, g => { g.players[0].hand.push({ type: 'event', event: 'Airlift' }); });
    await post(`/api/rooms/${g2.code}/action`, { token: g2.bob, fn: 'performMove', args: [1, 'drive', 'Chicago'] });
    assert.equal(srv.rooms.get(g2.code).turnSnapshots.length, 1);
    const wrong = await post(`/api/rooms/${g2.code}/action`,
      { token: g2.bob, fn: 'playEvent', args: [0, 'hand', 'Airlift', { pawnIdx: 0, city: 'Miami' }] });
    assert.equal(wrong.status, 403);
    const r = await post(`/api/rooms/${g2.code}/action`,
      { token: g2.alice, fn: 'playEvent', args: [0, 'hand', 'Airlift', { pawnIdx: 0, city: 'Miami' }] });
    assert.equal(r.status, 200);
    assert.equal(stateOf(g2.code).players[0].location, 'Miami');
    assert.equal(srv.rooms.get(g2.code).turnSnapshots.length, 0); // events void undo
  });

  await t('forecastCommit allowed only for the player who played Forecast', async () => {
    patchState(g2.code, g => { g.players[0].hand.push({ type: 'event', event: 'Forecast' }); });
    const r = await post(`/api/rooms/${g2.code}/action`,
      { token: g2.alice, fn: 'playEvent', args: [0, 'hand', 'Forecast', {}] });
    assert.equal(r.status, 200);
    const n = stateOf(g2.code).forecastPending.length;
    const order = Array.from({ length: n }, (_, i) => i);
    const wrong = await post(`/api/rooms/${g2.code}/action`,
      { token: g2.bob, fn: 'forecastCommit', args: [order] });
    assert.equal(wrong.status, 403);
    const ok = await post(`/api/rooms/${g2.code}/action`,
      { token: g2.alice, fn: 'forecastCommit', args: [order] });
    assert.equal(ok.status, 200);
    assert.equal(stateOf(g2.code).forecastPending, null);
  });

  await t('action on a lobby room is 409', async () => {
    const c = await post('/api/rooms', { name: 'Solo' });
    const r = await post(`/api/rooms/${c.body.code}/action`, { token: c.body.token, fn: 'pass', args: [] });
    assert.equal(r.status, 409);
  });

  // ---- SSE ----
  let g3;
  await t('SSE: snapshot on connect, stamped with mySeat', async () => {
    const c = await post('/api/rooms', { name: 'Alice' });
    const j = await post(`/api/rooms/${c.body.code}/join`, { name: 'Bob' });
    g3 = { code: c.body.code, alice: c.body.token, bob: j.body.token };
    g3.es = sseOpen(`/api/rooms/${g3.code}/events?token=${g3.bob}`);
    const ev = await g3.es.next();
    assert.equal(ev.status, 'lobby');
    assert.equal(ev.mySeat, 1);
    assert.equal(ev.seats.length, 2);
    assert.equal(ev.seats[1].connected, true);
  });

  await t('SSE: bad token is rejected', async () => {
    const r = await fetch(base + `/api/rooms/${g3.code}/events?token=nope`);
    assert.equal(r.status, 403);
    r.body && r.body.cancel && r.body.cancel().catch(() => {});
  });

  await t('SSE: start and actions push state with rising seq', async () => {
    await post(`/api/rooms/${g3.code}/start`, { token: g3.alice, epidemics: 4 });
    const started = await g3.es.next();
    assert.equal(started.status, 'playing');
    assert.ok(started.state);
    await post(`/api/rooms/${g3.code}/action`, { token: g3.alice, fn: 'pass', args: [] });
    const acted = await g3.es.next();
    assert.ok(acted.seq > started.seq);
    assert.equal(acted.actorSeat, 0);
    assert.equal(JSON.parse(acted.state).phase, 'draw');
  });

  await t('SSE: disconnect flips connected flag for others', async () => {
    const es2 = sseOpen(`/api/rooms/${g3.code}/events?token=${g3.alice}`);
    await es2.next();             // alice's hello
    await g3.es.next();           // bob sees alice connect
    g3.es.close();                // bob drops
    let ev;
    for (let i = 0; i < 3; i++) { ev = await es2.next(); if (ev.seats[1].connected === false) break; }
    assert.equal(ev.seats[1].connected, false);
    es2.close();
  });

  // ---- lobby leave & kick ----
  await t('non-host leave frees the seat', async () => {
    const c = await post('/api/rooms', { name: 'Host' });
    const j = await post(`/api/rooms/${c.body.code}/join`, { name: 'Quitter' });
    const r = await post(`/api/rooms/${c.body.code}/leave`, { token: j.body.token });
    assert.equal(r.status, 200);
    assert.equal(srv.rooms.get(c.body.code).seats.length, 1);
    const again = await post(`/api/rooms/${c.body.code}/join`, { name: 'Next' });
    assert.equal(again.body.seat, 1); // freed seat is reusable
  });

  await t('host leave disbands the room', async () => {
    const c = await post('/api/rooms', { name: 'Host' });
    const r = await post(`/api/rooms/${c.body.code}/leave`, { token: c.body.token });
    assert.equal(r.status, 200);
    const j = await post(`/api/rooms/${c.body.code}/join`, { name: 'Late' });
    assert.equal(j.status, 404);
  });

  await t('leave mid-game is rejected (disconnect/rejoin instead)', async () => {
    const c = await post('/api/rooms', { name: 'A' });
    const j = await post(`/api/rooms/${c.body.code}/join`, { name: 'B' });
    await post(`/api/rooms/${c.body.code}/start`, { token: c.body.token, epidemics: 4 });
    const r = await post(`/api/rooms/${c.body.code}/leave`, { token: j.body.token });
    assert.equal(r.status, 409);
  });

  await t('host can kick a lobby seat; kicked SSE client is told', async () => {
    const c = await post('/api/rooms', { name: 'Host' });
    const j = await post(`/api/rooms/${c.body.code}/join`, { name: 'Ghost' });
    const es = sseOpen(`/api/rooms/${c.body.code}/events?token=${j.body.token}`);
    await es.next(); // hello
    const deny = await post(`/api/rooms/${c.body.code}/kick`, { token: j.body.token, seat: 0 });
    assert.equal(deny.status, 403); // only the host kicks
    const r = await post(`/api/rooms/${c.body.code}/kick`, { token: c.body.token, seat: 1 });
    assert.equal(r.status, 200);
    assert.equal(srv.rooms.get(c.body.code).seats.length, 1);
    let kicked = null;
    for (let i = 0; i < 3; i++) { const ev = await es.next(); if (ev.kicked) { kicked = ev; break; } }
    assert.ok(kicked, 'kicked client should receive a kicked event');
    es.close();
    const self = await post(`/api/rooms/${c.body.code}/kick`, { token: c.body.token, seat: 0 });
    assert.equal(self.status, 400); // host cannot kick themselves
  });

  // ---- persistence ----
  await t('rooms persist to disk and reload', async () => {
    srv.saveNow();
    const onDisk = JSON.parse(require('fs').readFileSync(process.env.PANDEMIC_SAVE, 'utf8'));
    assert.ok(onDisk.some(r => r.code === g2.code));
    const live = srv.rooms.get(g2.code);
    srv.rooms.clear();
    srv.loadRooms();
    const back = srv.rooms.get(g2.code);
    assert.ok(back);
    assert.equal(back.state, live.state);
    assert.equal(back.seats[0].token, live.seats[0].token);
    assert.deepEqual(back.sseClients, []);
  });

  await t('GC removes idle rooms', async () => {
    const r = srv.rooms.get(g2.code);
    r.lastActivity = Date.now() - 25 * 60 * 60 * 1000;
    srv.gcRooms();
    assert.ok(!srv.rooms.get(g2.code));
  });

  server.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
