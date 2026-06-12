# Online Multiplayer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a server-hosted remote multiplayer mode (2–4 players, separate computers) alongside the existing local hotseat mode.

**Architecture:** A zero-dependency Node server (`server.js`) serves the static files and holds authoritative game state per room, applying actions through the existing untouched `js/game.js` engine and pushing full state to clients over SSE. Clients mirror state read-only; all mutations go through one dispatcher that is synchronous in local mode and POSTs in online mode.

**Tech Stack:** Plain Node built-ins (`http`, `fs`, `crypto`) on the server; vanilla JS + `fetch`/`EventSource` in the browser. No npm, no build step.

**Spec:** `docs/superpowers/specs/2026-06-11-online-multiplayer-design.md`

**Conventions that bind every task:**
- `js/game.js` must NOT be modified.
- Tests are plain Node scripts in the project style (`node test/server.js`), using `assert` from `node:assert` and a small pass/fail counter like `test/rules.js`.
- Commit after every green task.
- The test server binds port `0` (ephemeral) — never a fixed port.

**File map (final state):**
- Create: `server.js` — static serving, rooms, permissions, undo, SSE, persistence (~420 lines)
- Create: `js/net.js` — client online glue (~110 lines)
- Create: `test/server.js` — server integration tests
- Modify: `js/ui.js` — dispatcher, setup/lobby, seat gating, remote animations
- Modify: `index.html` — load `js/net.js`
- Modify: `css/style.css` — connection dot + lobby bits
- Modify: `README.md`, `CLAUDE.md` — document the new mode
- Never modify: `js/game.js`, `js/data.js`, `js/worldmap.js`, `test/rules.js`, `test/fuzz.js`

---

### Task 1: Server skeleton — static files + /api/ping

**Files:**
- Create: `server.js`
- Create: `test/server.js`

- [ ] **Step 1.1: Write the failing test**

Create `test/server.js`:

```js
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

  server.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 1.2: Run it to verify it fails**

Run: `node test/server.js`
Expected: crash with `Cannot find module '../server.js'`

- [ ] **Step 1.3: Implement the server skeleton**

Create `server.js`:

```js
#!/usr/bin/env node
'use strict';
// Pandemic game server: zero-dependency Node. Serves the static game files and
// hosts online rooms (see docs/superpowers/specs/2026-06-11-online-multiplayer-design.md).
// The rules engine is the same js/game.js the browser runs; the server is
// authoritative and clients mirror its state read-only.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

require('./js/data.js');
require('./js/game.js');
const Game = globalThis.Game;

const PORT = +(process.argv[2] || 8421);
const ROOT = __dirname;
const SAVE_FILE = process.env.PANDEMIC_SAVE || path.join(ROOT, 'saves', 'rooms.json');
const ROOM_TTL = 24 * 60 * 60 * 1000;
const MAX_SEATS = 4;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.md': 'text/markdown; charset=utf-8', '.ico': 'image/x-icon',
};

const rooms = new Map(); // code -> room

// ---------------- helpers ----------------

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', ch => {
      data += ch;
      if (data.length > 1e5) { reject(new Error('body too large')); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(new Error('invalid JSON')); }
    });
    req.on('error', reject);
  });
}

// ---------------- static files ----------------

function serveStatic(req, res, pathname) {
  let p = decodeURIComponent(pathname);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT + path.sep) || file.includes(path.sep + '.git' + path.sep)) {
    res.writeHead(404); return res.end('not found');
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('not found'); }
    const headers = {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Last-Modified': st.mtime.toUTCString(),
      'Cache-Control': 'no-cache', // live-reload polls Last-Modified
    };
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

// ---------------- request routing ----------------

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (p === '/api/ping') return sendJSON(res, 200, { ok: true });
    if (p.startsWith('/api/')) return sendJSON(res, 404, { error: 'unknown api route' });
    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, p);
    res.writeHead(405); res.end();
  } catch (e) {
    sendJSON(res, 500, { error: e.message });
  }
}

function createAppServer() {
  return http.createServer((req, res) => {
    handle(req, res).catch(e => { try { sendJSON(res, 500, { error: e.message }); } catch (_) {} });
  });
}

// ---------------- boot ----------------

if (require.main === module) {
  createAppServer().listen(PORT, () => {
    console.log(`Pandemic server: http://localhost:${PORT}`);
  });
} else {
  module.exports = { createAppServer, rooms, SAVE_FILE };
}
```

- [ ] **Step 1.4: Run the test to verify it passes**

Run: `node test/server.js`
Expected: 6 ok, `6 passed, 0 failed`, exit 0.

- [ ] **Step 1.5: Confirm existing tests still pass and commit**

Run: `node test/rules.js && node test/fuzz.js 50`
Expected: both pass (engine untouched).

```bash
git add server.js test/server.js
git commit -m "feat: zero-dep game server skeleton — static files + /api/ping"
```

---

### Task 2: Rooms — create / join / rejoin

**Files:**
- Modify: `server.js`
- Modify: `test/server.js`

- [ ] **Step 2.1: Add failing tests**

In `test/server.js`, after the path-traversal test, add:

```js
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
```

- [ ] **Step 2.2: Run to verify the new tests fail**

Run: `node test/server.js`
Expected: `create room` fails with status 404 (`unknown api route`).

- [ ] **Step 2.3: Implement room creation and joining**

In `server.js`, add below the `rooms` declaration:

```js
function newToken() { return crypto.randomBytes(16).toString('hex'); }

function newRoomCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O — avoids misreads over voice chat
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += A[crypto.randomInt(A.length)];
    if (!rooms.has(c)) return c;
  }
}

function seatName(room, given, idx) {
  return (given || '').trim().slice(0, 24) || `Player ${idx + 1}`;
}

function seatByToken(room, token) {
  return room.seats.findIndex(s => token && s.token === token);
}

function createRoom(body) {
  const room = {
    code: newRoomCode(),
    status: 'lobby',            // lobby | playing | over
    seats: [],                  // [{name, token, connected}] — index = engine player index
    hostToken: null,
    state: null,                // JSON string of engine G
    turnSnapshots: [],          // pre-action snapshots for undo, cleared on turn change
    forecastBy: null,           // seat that played Forecast, may commit it
    seq: 0,
    sseClients: [],             // [{res, seat}]
    lastActivity: Date.now(),
  };
  const token = newToken();
  room.seats.push({ name: seatName(room, body.name, 0), token, connected: 0 });
  room.hostToken = token;
  rooms.set(room.code, room);
  return { room, token };
}
```

Then replace the routing section of `handle` (keep ping and static handling) with:

```js
async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (p === '/api/ping') return sendJSON(res, 200, { ok: true });

    const m = p.match(/^\/api\/rooms(?:\/([A-Z]{4})\/(\w+))?$/);
    if (m) return apiRooms(req, res, url, m[1], m[2]);
    if (p.startsWith('/api/')) return sendJSON(res, 404, { error: 'unknown api route' });
    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, p);
    res.writeHead(405); res.end();
  } catch (e) {
    sendJSON(res, 500, { error: e.message });
  }
}

async function apiRooms(req, res, url, code, sub) {
  // POST /api/rooms — create
  if (!code) {
    if (req.method !== 'POST') return sendJSON(res, 405, { error: 'POST required' });
    const body = await readBody(req);
    const { room, token } = createRoom(body);
    touch(room);
    return sendJSON(res, 200, { code: room.code, token, seat: 0 });
  }
  const room = rooms.get(code);
  if (!room) return sendJSON(res, 404, { error: 'no such room' });

  if (sub === 'join' && req.method === 'POST') {
    const body = await readBody(req);
    const rejoin = seatByToken(room, body.token);
    if (rejoin >= 0) { touch(room); return sendJSON(res, 200, { token: room.seats[rejoin].token, seat: rejoin }); }
    if (room.status !== 'lobby') return sendJSON(res, 409, { error: 'game already started' });
    if (room.seats.length >= MAX_SEATS) return sendJSON(res, 409, { error: 'room is full' });
    const token = newToken();
    room.seats.push({ name: seatName(room, body.name, room.seats.length), token, connected: 0 });
    touch(room);
    broadcast(room);
    return sendJSON(res, 200, { token, seat: room.seats.length - 1 });
  }

  return sendJSON(res, 404, { error: 'unknown api route' });
}

function touch(room) { room.lastActivity = Date.now(); }

// Placeholder until Task 4 wires SSE: roster/state changed, notify clients.
function broadcast(room) { room.seq++; }
```

- [ ] **Step 2.4: Run tests**

Run: `node test/server.js`
Expected: all pass (12 so far).

- [ ] **Step 2.5: Commit**

```bash
git add server.js test/server.js
git commit -m "feat(server): room create/join/rejoin with seat tokens"
```

---

### Task 3: Start game, actions, permissions, undo

This is the core: the engine state-swap, the strict-seats permission layer, undo snapshots, and `forecastBy` tracking.

**Files:**
- Modify: `server.js`
- Modify: `test/server.js`

- [ ] **Step 3.1: Add failing tests**

In `test/server.js` add. Note the tests reach into `srv.rooms` (same process) to patch state deterministically — engine shuffles are random, so tests construct the scenarios they need:

```js
  // ---- game flow: start / actions / permissions / undo ----
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
```

- [ ] **Step 3.2: Run to verify the new tests fail**

Run: `node test/server.js`
Expected: `start requires host` fails (404 unknown api route).

- [ ] **Step 3.3: Implement start/action/undo**

In `server.js`, add after `seatByToken`:

```js
// ---------------- permissions & engine application ----------------

// Mutating engine functions a client may invoke. Anything else is rejected.
const CURRENT_ONLY = new Set(['performMove', 'treat', 'build', 'discoverCure', 'shareKnowledge',
  'pass', 'contingencyTake', 'drawPlayerCard', 'intensify', 'flipInfectionCard']);
const ENGINE_FNS = new Set([...CURRENT_ONLY, 'discardForLimit', 'playEvent', 'forecastCommit']);

// Strict seats: who may call what. Returns an error string or null.
function permitted(room, seat, fn, args) {
  const g = JSON.parse(room.state);
  if (CURRENT_ONLY.has(fn)) {
    return seat === g.current ? null : `it is ${g.players[g.current].name}'s turn`;
  }
  if (fn === 'discardForLimit') return seat === args[0] ? null : 'you can only discard your own cards';
  if (fn === 'playEvent') return seat === args[0] ? null : 'you can only play your own event cards';
  if (fn === 'forecastCommit') {
    return seat === room.forecastBy ? null : 'only the player who played Forecast can set the order';
  }
  return 'unknown action';
}

// State-swap application: game.js holds a singleton G, so restore the room's
// state, mutate, snapshot it back. Node is single-threaded — race-free.
function applyAction(room, seat, fn, args) {
  const before = JSON.parse(room.state);
  Game.restore(room.state);
  let ret;
  try { ret = Game[fn](...args); }
  catch (e) { return { error: e.message.replace(/^Illegal: /, '') }; }
  const prev = room.state;
  room.state = Game.snapshot();
  const after = JSON.parse(room.state);

  // Undo bookkeeping (mirrors the hotseat UI: events void undo; a new turn
  // clears the stack so nobody rewinds someone else's turn).
  if (fn === 'playEvent') room.turnSnapshots = [];
  else if (seat === before.current) room.turnSnapshots.push(prev);
  if (after.current !== before.current || after.turn !== before.turn) room.turnSnapshots = [];

  if (fn === 'playEvent' && args[2] === 'Forecast') room.forecastBy = seat;
  if (fn === 'forecastCommit') room.forecastBy = null;
  if (after.result) room.status = 'over';
  return { ret: ret === undefined ? null : ret };
}
```

In `apiRooms`, after the `join` branch, add:

```js
  if (sub === 'start' && req.method === 'POST') {
    const body = await readBody(req);
    if (body.token !== room.hostToken) return sendJSON(res, 403, { error: 'only the host can start the game' });
    if (room.status !== 'lobby') return sendJSON(res, 409, { error: 'game already started' });
    const epidemics = [4, 5, 6].includes(+body.epidemics) ? +body.epidemics : 4;
    const roles = Array.isArray(body.roles) && body.roles.every(Boolean) ? body.roles : null;
    try {
      Game.newGame({ names: room.seats.map(s => s.name), epidemics, roles });
    } catch (e) {
      return sendJSON(res, 400, { error: e.message.replace(/^Illegal: /, '') });
    }
    room.state = Game.snapshot();
    room.status = 'playing';
    room.turnSnapshots = [];
    room.forecastBy = null;
    touch(room);
    broadcast(room);
    return sendJSON(res, 200, { ok: true });
  }

  if (sub === 'action' && req.method === 'POST') {
    const body = await readBody(req);
    const seat = seatByToken(room, body.token);
    if (seat < 0) return sendJSON(res, 403, { error: 'not a player in this room' });
    if (room.status !== 'playing') {
      return sendJSON(res, 409, { error: room.status === 'lobby' ? 'game not started' : 'game is over' });
    }
    if (!ENGINE_FNS.has(body.fn)) return sendJSON(res, 400, { error: 'unknown action' });
    const args = Array.isArray(body.args) ? body.args : [];
    const denied = permitted(room, seat, body.fn, args);
    if (denied) return sendJSON(res, 403, { error: denied });
    const out = applyAction(room, seat, body.fn, args);
    if (out.error) return sendJSON(res, 400, { error: out.error });
    touch(room);
    broadcast(room, seat);
    return sendJSON(res, 200, { ok: true, ret: out.ret, room: payload(room, seat, seat) });
  }

  if (sub === 'undo' && req.method === 'POST') {
    const body = await readBody(req);
    const seat = seatByToken(room, body.token);
    if (seat < 0) return sendJSON(res, 403, { error: 'not a player in this room' });
    if (room.status !== 'playing') return sendJSON(res, 409, { error: 'game not in progress' });
    const g = JSON.parse(room.state);
    if (seat !== g.current) return sendJSON(res, 403, { error: 'only the current player can undo' });
    if (!room.turnSnapshots.length) return sendJSON(res, 400, { error: 'nothing to undo' });
    room.state = room.turnSnapshots.pop();
    touch(room);
    broadcast(room, seat);
    return sendJSON(res, 200, { ok: true, room: payload(room, seat, seat) });
  }
```

And replace the `broadcast` placeholder with the payload builder (SSE delivery still comes in Task 4):

```js
// Everything a client needs to render: full engine state + roster. Identical
// for everyone except mySeat (stamped per connection) and actorSeat (set on
// action-triggered broadcasts so the actor's own UI can skip replaying
// animations it already played locally).
function payload(room, seat, actorSeat) {
  return {
    seq: room.seq,
    code: room.code,
    status: room.status,
    seats: room.seats.map((s, i) => ({ name: s.name, connected: s.connected > 0, host: i === 0 })),
    mySeat: seat,
    forecastBy: room.forecastBy,
    undoDepth: room.turnSnapshots.length,
    actorSeat: actorSeat === undefined ? null : actorSeat,
    state: room.state,
  };
}

function broadcast(room, actorSeat) {
  room.seq++;
  for (const c of room.sseClients) {
    c.res.write(`data: ${JSON.stringify(payload(room, c.seat, actorSeat))}\n\n`);
  }
}
```

- [ ] **Step 3.4: Run tests**

Run: `node test/server.js`
Expected: all pass (~24).

- [ ] **Step 3.5: Commit**

```bash
git add server.js test/server.js
git commit -m "feat(server): start game, strict-seat action permissions, server-side undo"
```

---

### Task 4: SSE events

**Files:**
- Modify: `server.js`
- Modify: `test/server.js`

- [ ] **Step 4.1: Add failing tests**

In `test/server.js` add an SSE helper near `post`:

```js
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
```

And the tests:

```js
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
```

- [ ] **Step 4.2: Run to verify failure**

Run: `node test/server.js`
Expected: SSE tests fail (`SSE timeout` or 404).

- [ ] **Step 4.3: Implement the SSE route**

In `apiRooms`, add before the final `return sendJSON(res, 404, ...)`:

```js
  if (sub === 'events' && req.method === 'GET') {
    const seat = seatByToken(room, url.searchParams.get('token'));
    if (seat < 0) return sendJSON(res, 403, { error: 'not a player in this room' });
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const client = { res, seat };
    room.sseClients.push(client);
    room.seats[seat].connected++;
    touch(room);
    res.write(`retry: 1500\n\n`);
    broadcast(room); // everyone (incl. this client) sees the fresh roster
    req.on('close', () => {
      room.sseClients = room.sseClients.filter(c => c !== client);
      room.seats[seat].connected = Math.max(0, room.seats[seat].connected - 1);
      broadcast(room);
    });
    return;
  }
```

Also add a keepalive so proxies don't kill idle streams. In the boot section (`require.main === module`), and mirrored in `createAppServer` is wrong — put it at module level instead, right after `broadcast`:

```js
// SSE keepalive: comment frames every 25s so idle connections stay open.
setInterval(() => {
  for (const room of rooms.values()) {
    for (const c of room.sseClients) c.res.write(': ping\n\n');
  }
}, 25000).unref();
```

- [ ] **Step 4.4: Run tests**

Run: `node test/server.js`
Expected: all pass (~28).

- [ ] **Step 4.5: Commit**

```bash
git add server.js test/server.js
git commit -m "feat(server): SSE state push with per-seat stamping and connect tracking"
```

---

### Task 5: Persistence + room GC

**Files:**
- Modify: `server.js`
- Modify: `test/server.js`

- [ ] **Step 5.1: Add failing tests**

```js
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
```

- [ ] **Step 5.2: Run to verify failure**

Run: `node test/server.js`
Expected: `srv.saveNow is not a function`.

- [ ] **Step 5.3: Implement persistence and GC**

In `server.js` after the keepalive interval:

```js
// ---------------- persistence ----------------
// Rooms (tokens included) survive a server restart; SSE clients reconnect on
// their own (EventSource auto-retry) and re-authenticate by token.

let saveTimer = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; saveNow(); }, 500);
}

function saveNow() {
  const data = [...rooms.values()].map(r => ({
    ...r,
    sseClients: undefined,
    seats: r.seats.map(s => ({ ...s, connected: 0 })),
  }));
  try {
    fs.mkdirSync(path.dirname(SAVE_FILE), { recursive: true });
    fs.writeFileSync(SAVE_FILE, JSON.stringify(data));
  } catch (e) {
    console.error('save failed:', e.message);
  }
}

function loadRooms() {
  try {
    for (const r of JSON.parse(fs.readFileSync(SAVE_FILE, 'utf8'))) {
      r.sseClients = [];
      rooms.set(r.code, r);
    }
  } catch (e) { /* first run: no save file yet */ }
}

function gcRooms() {
  for (const [code, room] of rooms) {
    if (Date.now() - room.lastActivity > ROOM_TTL) {
      for (const c of room.sseClients) { try { c.res.end(); } catch (e) {} }
      rooms.delete(code);
    }
  }
  scheduleSave();
}
```

Hook saving into state changes — add `scheduleSave();` as the last line of `broadcast(room, actorSeat)`.

Update the boot/export section:

```js
if (require.main === module) {
  loadRooms();
  createAppServer().listen(PORT, () => {
    console.log(`Pandemic server: http://localhost:${PORT}`);
    console.log(`Friends connect to your LAN address or tunnel on port ${PORT}.`);
  });
  setInterval(gcRooms, 60 * 60 * 1000).unref();
} else {
  module.exports = { createAppServer, rooms, loadRooms, saveNow, gcRooms, SAVE_FILE };
}
```

- [ ] **Step 5.4: Run tests, including a final exit-code check**

Run: `node test/server.js && node test/rules.js && node test/fuzz.js 50`
Expected: all pass. Also confirm `test/tmp-rooms.json` got written, then add it to `.gitignore`:

```bash
printf 'test/tmp-rooms.json\n' >> .gitignore
```

- [ ] **Step 5.5: Commit**

```bash
git add server.js test/server.js .gitignore
git commit -m "feat(server): room persistence to saves/rooms.json and 24h GC"
```

---

### Task 6: Client glue — `js/net.js`

**Files:**
- Create: `js/net.js`
- Modify: `index.html` (load net.js between game.js and ui.js)

No Node test for this file (it's browser-only: `fetch`+`EventSource`+`localStorage`); it gets exercised by the UI tasks and the Task 11 end-to-end check. Keep it logic-light.

- [ ] **Step 6.1: Create `js/net.js`**

```js
'use strict';
// Online-mode client glue: lobby API calls, SSE subscription, session storage.
// Loaded after game.js, before ui.js. In local games this module is dormant
// (Net.online stays false and ui.js calls the engine directly).

(function () {
  const SESSION_KEY = 'pandemic-online-v1';

  const Net = {
    online: false,
    code: null, token: null, seat: null,
    status: null,        // lobby | playing | over (server's room.status)
    seats: [],           // [{name, connected, host}]
    forecastBy: null,
    undoDepth: 0,
    seq: 0,
    sseUp: false,
    es: null,
    onUpdate: null,      // set by ui.js: (payload|null, prevLogLen) after every applied event
  };

  async function api(path, body) {
    let r;
    try {
      r = await fetch(path, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
      });
    } catch (e) { throw new Error('cannot reach the server'); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `server error (${r.status})`);
    return j;
  }

  Net.detect = async function () {
    try {
      const r = await fetch('/api/ping');
      return (await r.json()).ok === true;
    } catch (e) { return false; }
  };

  Net.create = async function (name) {
    const j = await api('/api/rooms', { name });
    enter(j.code, j.token);
    return j;
  };

  Net.join = async function (code, name, token) {
    code = (code || '').trim().toUpperCase();
    const j = await api(`/api/rooms/${code}/join`, { name, token });
    enter(code, j.token);
    return j;
  };

  Net.start = (epidemics, roles) =>
    api(`/api/rooms/${Net.code}/start`, { token: Net.token, epidemics, roles });

  Net.action = (fn, args) =>
    api(`/api/rooms/${Net.code}/action`, { token: Net.token, fn, args });

  Net.undo = () => api(`/api/rooms/${Net.code}/undo`, { token: Net.token });

  function enter(code, token) {
    Net.online = true;
    Net.code = code; Net.token = token; Net.seq = 0;
    localStorage.setItem(SESSION_KEY, JSON.stringify({ code, token }));
    Net.es = new EventSource(`/api/rooms/${code}/events?token=${token}`);
    Net.es.onmessage = ev => Net.applyPayload(JSON.parse(ev.data));
    Net.es.onopen = () => { Net.sseUp = true; if (Net.onUpdate) Net.onUpdate(null); };
    Net.es.onerror = () => { Net.sseUp = false; if (Net.onUpdate) Net.onUpdate(null); };
  }

  // Apply a room payload (from SSE or echoed in an action response). Stale or
  // duplicate payloads are dropped by seq, so the SSE event and the POST echo
  // of the same action can race safely.
  Net.applyPayload = function (p) {
    if (!Net.online || p.seq <= Net.seq) return;
    Net.seq = p.seq;
    Net.status = p.status; Net.seats = p.seats; Net.seat = p.mySeat;
    Net.forecastBy = p.forecastBy; Net.undoDepth = p.undoDepth;
    const prev = Game.state();
    const prevLogLen = prev && p.state ? prev.log.length : -1;
    if (p.state) Game.load(p.state);
    if (Net.onUpdate) Net.onUpdate(p, prevLogLen);
  };

  Net.leave = function () {
    if (Net.es) Net.es.close();
    localStorage.removeItem(SESSION_KEY);
    Object.assign(Net, {
      online: false, code: null, token: null, seat: null, status: null,
      seats: [], forecastBy: null, undoDepth: 0, seq: 0, sseUp: false, es: null,
    });
  };

  Net.session = function () {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch (e) { return null; }
  };

  globalThis.Net = Net;
})();
```

- [ ] **Step 6.2: Load it in `index.html`**

**First re-read `index.html`** (it may have drifted; e.g. a ticker element was added). Insert after the game.js guard `</script>` and before the ui.js tag:

```html
<script src="js/net.js"></script>
```

Also add `'js/net.js'` to the live-reload `files` array at the bottom of `index.html`.

- [ ] **Step 6.3: Syntax check + manual smoke**

Run: `node --check js/net.js`
Run: `node server.js 8421 &` then open `http://localhost:8421` — game loads, console shows no errors, `Net` exists, local hotseat still playable. Kill the server after.

- [ ] **Step 6.4: Commit**

```bash
git add js/net.js index.html
git commit -m "feat(client): Net module — lobby API, SSE subscription, session storage"
```

---

### Task 7: ui.js dispatcher refactor (behavior-preserving for local games)

Convert the closure-based `act(fn)`/`run(fn)` wrappers to name+args dispatch that can route to the server. After this task local play must behave **identically**; online routing is wired but unreachable until Task 8 adds the entry UI.

**Files:**
- Modify: `js/ui.js`

- [ ] **Step 7.1: Replace `run`/`act` (currently `js/ui.js:141-154`) with the dispatcher**

Old:

```js
  function run(fn) {
    let ok = false;
    try { fn(); ok = true; } catch (e) { toast(e.message.replace(/^Illegal: /, '')); sfx('error'); }
    refresh();
    return ok;
  }
  function act(fn) {
    const snap = Game.snapshot();
    let ok = false;
    try { fn(); ui.undoStack.push(snap); ok = true; } catch (e) { toast(e.message.replace(/^Illegal: /, '')); sfx('error'); }
    ui.selectedCity = null;
    refresh();
    return ok;
  }
```

New:

```js
  // Dispatch a mutating engine call by name. Local mode: synchronous, exactly
  // the pre-multiplayer behavior (undo snapshot for `act`, toast on throw).
  // Online mode: POST to the server; the echoed payload updates the mirrored
  // state before the promise resolves. Always returns a Promise of {ok, ret}.
  async function dispatch(fn, args, undoable) {
    if (!globalThis.Net || !Net.online) {
      const snap = undoable ? Game.snapshot() : null;
      let ok = false, ret;
      try {
        ret = Game[fn](...args);
        if (undoable) ui.undoStack.push(snap);
        ok = true;
      } catch (e) { toast(e.message.replace(/^Illegal: /, '')); sfx('error'); }
      if (undoable) ui.selectedCity = null;
      refresh();
      return { ok, ret };
    }
    try {
      const j = await Net.action(fn, args);
      if (undoable) ui.selectedCity = null;
      Net.applyPayload(j.room); // no-op if the SSE echo of this action won the race
      refresh();                // re-render regardless, so cleared selection sticks
      return { ok: true, ret: j.ret };
    } catch (e) {
      toast(e.message); sfx('error');
      refresh();
      return { ok: false };
    }
  }
  const act = (fn, args) => dispatch(fn, args, true);
  const run = (fn, args) => dispatch(fn, args, false);
```

- [ ] **Step 7.2: Convert every call site**

Each conversion: closure → `(name, argsArray)`, and the surrounding handler becomes `async` with `await`. Exact list (line numbers from the pre-edit file; re-locate by content):

1. `renderCityMenu` move button (~line 700):
```js
        onclick: async () => {
          if (o.type === 'opex') { pickOpexCard(name); return; }
          const from = g.players[pawnIdx].location;
          if ((await act('performMove', [pawnIdx, o.type, name])).ok) {
            sfx('move');
            cityPulse(name, '#38bdf8');
            if (o.type !== 'drive') animateFlight(from, name); // a plane for every flight
            const cc = Game.CITY[name];
            animateViewTo(cc.x, cc.y, Math.min(view.w, 980)); // glide in on the pawn
          }
        },
```

2. `pickOpexCard` (~line 731):
```js
          onclick: async () => {
            closeModal();
            const from = g.players[g.current].location;
            if ((await act('performMove', [g.current, 'opex', dest, i])).ok) {
              sfx('move');
              cityPulse(dest, '#38bdf8');
              animateFlight(from, dest); // operations flight
              const cc = Game.CITY[dest];
              animateViewTo(cc.x, cc.y, Math.min(view.w, 980));
            }
          },
```

3. `renderActions` End Actions (~line 797):
```js
      grid.append(el('button', {
        class: 'wide', onclick: async () => { if ((await act('pass', [])).ok) sfx('click'); },
      }, `End Actions (forfeit ${g.actionsLeft})`));
```

4. `renderActions` Draw Player Card (~line 809):
```js
      grid.append(el('button', {
        class: 'primary wide', onclick: async () => {
          const logMark = G().log.length;
          const r = await run('drawPlayerCard', []);
          if (r.ok && r.ret) {
            sfx(r.ret.type === 'epidemic' ? 'epidemic' : 'draw');
            animatePlayerDraw(r.ret);
            animateOutbreaks(logMark);
          }
        },
      }, `Draw Player Card (${g.cardsToDraw} left)`));
```

5. `renderActions` Flip Infection Card (~line 822):
```js
      grid.append(el('button', {
        class: 'primary wide', onclick: async () => {
          const logMark = G().log.length;
          const r = await run('flipInfectionCard', []);
          if (r.ok && r.ret) {
            sfx('infect');
            animateInfection(r.ret);
            animateOutbreaks(logMark);
          }
        },
      }, `Flip Infection Card (${g.infectsLeft} left)`));
```

6. `doTreat` (~line 952):
```js
    const treated = async c => {
      const before = G().cityCubes[loc][c];
      if ((await act('treat', [c])).ok) {
        sfx('treat');
        cityPulse(loc, '#4ade80');
        floatText(loc, `−${before - G().cityCubes[loc][c]} ${c}`, HEX[c]);
        const cc = Game.CITY[loc];
        animateViewTo(cc.x, cc.y, Math.min(view.w, 1000));
      }
    };
```

7. `doBuild` (~line 979):
```js
    const built = async from => {
      if ((await act('build', from ? [from] : [])).ok) { sfx('build'); cityPulse(loc, '#f8fafc'); }
    };
```

8. `doCure` confirm button (~line 1017):
```js
            onclick: async () => {
              closeModal();
              if ((await act('discoverCure', [color, [...selected]])).ok) {
                sfx('cure');
                cureBanner(color);
              }
            },
```

9. `doShare` (~line 1060):
```js
          onclick: async () => { closeModal(); if ((await act('shareKnowledge', [o.gi, o.ti, o.hi])).ok) sfx('share'); },
```

10. `doContingency` (~line 1074):
```js
          onclick: async () => { closeModal(); if ((await act('contingencyTake', [c.event])).ok) sfx('event'); },
```

11. `playEventFlow` — all five branches (~lines 1089-1141). The pattern, applied to each:
   - One Quiet Night: `if ((await run('playEvent', [playerIdx, source, name, {}])).ok) sfx('event');` (handler becomes `async function playEventFlow(...)`; this branch awaits directly)
   - Forecast: keep `ui.forecastOrder = null;` first, then same as One Quiet Night
   - Resilient Population button: `onclick: async () => { closeModal(); if ((await run('playEvent', [playerIdx, source, name, { discardIdx: i }])).ok) { sfx('event'); cityPulse(c.city, '#4ade80'); } },`
   - Airlift pick: `if ((await run('playEvent', [playerIdx, source, name, { pawnIdx: i, city }])).ok) { sfx('event'); cityPulse(city, '#4ade80'); animateFlight(from, city); }` (the `startSelectMode` callback becomes `async city => {...}`)
   - Government Grant (both sub-branches): `await run('playEvent', [playerIdx, source, name, { city, relocateFrom: s }])` and `await run('playEvent', [playerIdx, source, name, { city }])`, handlers async

12. Forecast confirm (~line 1494):
```js
          class: 'primary', onclick: async () => {
            const o = ui.forecastOrder || g.forecastPending.map((_, i) => i);
            ui.forecastOrder = null;
            if ((await run('forecastCommit', [o])).ok) sfx('click');
          },
```

13. Epidemic Intensify (~line 1525):
```js
      btns.append(el('button', {
        class: 'primary', onclick: async () => { if ((await run('intensify', [])).ok) sfx('draw'); },
      }, 'Intensify (shuffle discard on top)'));
```

14. Discard modal card clicks (~lines 1541-1550) — both the event-card and city-card chips:
```js
            onclick: () => run('discardForLimit', [pi, i]),
```
(fire-and-forget is fine here: refresh happens inside dispatch)

- [ ] **Step 7.3: Verify nothing else calls engine mutators directly**

Run: `grep -n 'Game\.\(performMove\|treat\|build\|discoverCure\|shareKnowledge\|pass\|contingencyTake\|drawPlayerCard\|intensify\|flipInfectionCard\|discardForLimit\|playEvent\|forecastCommit\)' js/ui.js`
Expected: zero matches. (`Game.newGame`, `Game.load`, `Game.restore`, `Game.snapshot`, and read-only helpers remain — those are correct.)

Run: `node --check js/ui.js`
Expected: no output.

- [ ] **Step 7.4: Full local regression**

Run: `node test/rules.js && node test/fuzz.js 100`
Then `node server.js &`, open `http://localhost:8421`, and play a local hotseat round covering: a drive move, a flight (plane animation), treat, build, share, pass, draw 2, flip infections, undo, an event card, hand-limit discard. Everything must look and sound exactly as before.
Kill the server.

- [ ] **Step 7.5: Commit**

```bash
git add js/ui.js
git commit -m "refactor(ui): route all engine mutations through a name+args dispatcher"
```

---

### Task 8: Setup screen — online entry + lobby

**Files:**
- Modify: `js/ui.js` (showSetup, new showLobby, Net.onUpdate, boot)
- Modify: `css/style.css`

- [ ] **Step 8.1: Add the online section to `showSetup`**

In `showSetup()`, after `box.append(dlg);` (end of the function), append:

```js
    // Online play: only offered when the page is served by server.js.
    Net.detect().then(up => {
      if (!up) return;
      const odlg = el('div', { class: 'dialog', style: 'margin-top:14px' });
      odlg.append(el('p', { class: 'boxtitle' }, '🌐 Play online'));
      odlg.append(el('p', { class: 'sub' }, 'Host a room and share its 4-letter code, or join a friend’s room. Everyone plays from their own computer.'));
      const nameIn = el('input', { type: 'text', id: 'onlinename', placeholder: 'Your name', value: localStorage.getItem('pandemic-name') || '' });
      odlg.append(el('div', { class: 'setuprow' }, el('label', {}, 'Name'), nameIn));
      const codeIn = el('input', { type: 'text', id: 'joincode', placeholder: 'CODE', maxlength: 4, style: 'text-transform:uppercase;width:90px' });
      const oerr = el('div', { style: 'color:var(--bad);font-weight:600;min-height:18px;margin-top:6px' });
      const myName = () => {
        const n = nameIn.value.trim();
        if (n) localStorage.setItem('pandemic-name', n);
        return n;
      };
      odlg.append(el('div', { class: 'btnrow', style: 'justify-content:flex-start' },
        el('button', {
          class: 'primary', onclick: async () => {
            try { await Net.create(myName()); } catch (e) { oerr.textContent = e.message; }
          },
        }, 'Create Room'),
        el('span', { style: 'margin-left:14px' }),
        codeIn,
        el('button', {
          onclick: async () => {
            try { await Net.join(codeIn.value, myName()); } catch (e) { oerr.textContent = e.message; }
          },
        }, 'Join Room')));
      odlg.append(oerr);
      dlg.append(odlg);
    });
```

(Note: `odlg` is appended to `dlg`, inside the existing setup dialog, so it scrolls with it.)

- [ ] **Step 8.2: Add `showLobby` (place it after `showSetup`)**

```js
  // Online lobby: roster fills in live via SSE; the host configures and starts.
  function showLobby() {
    const box = $('#setup');
    box.hidden = false;
    box.innerHTML = '';
    $('#app').hidden = true;
    const isHost = Net.seats.length && Net.seat === 0;
    const dlg = el('div', { class: 'dialog' });
    dlg.append(el('p', { class: 'bigtitle' }, 'PANDEMIC'));
    dlg.append(el('p', { class: 'subtitle' }, 'Online lobby — share the room code. The game starts for everyone at once.'));
    dlg.append(el('div', { class: 'roomcode' }, ...Net.code.split('').map(ch => el('span', {}, ch))));

    const list = el('div');
    Net.seats.forEach((s, i) => {
      list.append(el('div', { class: 'setuprow' },
        el('span', { class: 'connDot', style: `background:${s.connected ? 'var(--good)' : 'var(--bad)'}` }),
        el('label', {}, `${i + 1}. ${s.name}${i === 0 ? ' (host)' : ''}${i === Net.seat ? ' — you' : ''}`)));
    });
    for (let i = Net.seats.length; i < 4; i++) {
      list.append(el('div', { class: 'setuprow', style: 'opacity:.45' },
        el('span', { class: 'connDot', style: 'background:var(--dim)' }),
        el('label', {}, `${i + 1}. waiting for a player…`)));
    }
    dlg.append(list);

    const errLine = el('div', { style: 'color:var(--bad);font-weight:600;min-height:18px;margin-top:8px' });
    if (isHost) {
      const epiSel = el('select', {},
        el('option', { value: 4 }, '4 epidemics — Introductory'),
        el('option', { value: 5 }, '5 epidemics — Standard'),
        el('option', { value: 6 }, '6 epidemics — Heroic'));
      epiSel.value = String(ui.lobbyEpidemics || 4);
      epiSel.onchange = () => { ui.lobbyEpidemics = +epiSel.value; };
      dlg.append(el('div', { class: 'setuprow' }, el('label', {}, 'Difficulty'), epiSel));
      dlg.append(errLine);
      dlg.append(el('div', { class: 'btnrow' },
        el('button', { onclick: leaveOnline }, 'Leave'),
        el('button', {
          class: 'primary', disabled: Net.seats.length < 2,
          onclick: async () => {
            try { await Net.start(+epiSel.value, null); } catch (e) { errLine.textContent = e.message; }
          },
        }, Net.seats.length < 2 ? 'Waiting for players…' : 'Start Game')));
    } else {
      dlg.append(errLine);
      dlg.append(el('div', { class: 'btnrow' },
        el('button', { onclick: leaveOnline }, 'Leave'),
        el('span', { class: 'sub', style: 'align-self:center' }, 'Waiting for the host to start…')));
    }
    box.append(dlg);
  }

  function leaveOnline() {
    Net.leave();
    $('#app').hidden = true;
    ui.turnKey = null;
    showSetup();
  }
```

(Roles in online games are dealt randomly by the engine — the lobby keeps only the difficulty choice. The spec allowed roles as optional; dropping the per-seat role picker is a deliberate YAGNI cut: random roles are the common way to play, and the lobby stays one screen.)

- [ ] **Step 8.3: Wire `Net.onUpdate` and boot-time session resume**

Add after the `refresh()` function definition:

```js
  // Online: every applied server payload lands here.
  Net.onUpdate = (p, prevLogLen) => {
    if (!Net.online) return;
    if (Net.status === 'lobby') { showLobby(); return; }
    $('#setup').hidden = true;
    $('#app').hidden = false;
    refresh();
    if (p && p.state && prevLogLen >= 0 && p.actorSeat !== Net.seat) animateRemote(prevLogLen);
  };
```

(`animateRemote` arrives in Task 10 — until then add a stub right above: `function animateRemote(logMark) {}`.)

Replace the boot block at the bottom of the file (from `initMapControls();` through `if (!resumed) showSetup();`) with:

```js
  initMapControls();

  (async function boot() {
    // 1) an online session resumes first (room code + token in localStorage)
    const sess = Net.session();
    if (sess && await Net.detect()) {
      try {
        await Net.join(sess.code, null, sess.token);
        toast('Rejoined online game.');
        return; // SSE payload will route to lobby or board via Net.onUpdate
      } catch (e) {
        Net.leave(); // room gone or token stale — fall through to local flow
      }
    }
    // 2) an unfinished local game picks up exactly where it left off
    const autosave = localStorage.getItem(SAVE_KEY);
    if (autosave) {
      try {
        const g = Game.load(autosave);
        if (g && g.players && !g.result) {
          $('#app').hidden = false;
          ui.undoStack = [];
          refresh();
          toast('Saved game resumed.');
          return;
        }
      } catch (e) {
        localStorage.removeItem(SAVE_KEY);
      }
    }
    showSetup();
  })();
```

Also in `save()` add online guard as the first line:

```js
  function save() {
    if (globalThis.Net && Net.online) return; // online games live on the server
    if (G() && !G().result) localStorage.setItem(SAVE_KEY, Game.serialize());
    else localStorage.removeItem(SAVE_KEY);
  }
```

- [ ] **Step 8.4: CSS for the lobby**

Append to `css/style.css`:

```css
/* ---- online lobby & connection ---- */
.connDot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; flex: none; }
.roomcode { display: flex; gap: 8px; justify-content: center; margin: 10px 0 16px; }
.roomcode span {
  font-size: 34px; font-weight: 800; letter-spacing: 1px;
  background: #0b1220; border: 1px solid #2b3a55; border-radius: 10px;
  padding: 6px 14px; color: var(--accent, #38bdf8);
}
```

- [ ] **Step 8.5: Verify in two browser windows**

`node server.js`, then:
1. Window A `http://localhost:8421`: enter a name, Create Room → lobby shows code, you as host.
2. Window B (incognito) same URL: Join Room with the code → both lobbies show 2 seats with green dots.
3. A clicks Start → both windows land on the board simultaneously.
4. Reload window B mid-lobby or mid-game → silently rejoins.
5. Window A still offers local play when you leave the room; start a quick local game to confirm no regression.

Run `node --check js/ui.js` before opening the browser.

- [ ] **Step 8.6: Commit**

```bash
git add js/ui.js css/style.css
git commit -m "feat(ui): online setup path, live lobby, session resume on reload"
```

---

### Task 9: Seat gating, online undo, leave/indicator

**Files:**
- Modify: `js/ui.js`

- [ ] **Step 9.1: Add the seat helpers** (next to the `G` helper near the top):

```js
  // Online: you are exactly one seat. Local hotseat: you are whoever's turn it is.
  const myTurn = () => !Net.online || Net.seat === G().current;
  const mySeatIs = i => !Net.online || Net.seat === i;
```

- [ ] **Step 9.2: Gate the action box.** In `renderActions`, right after `const me = g.players[g.current];` add:

```js
    if (Net.online && !myTurn() && ['actions', 'draw', 'infect', 'epidemicPause'].includes(g.phase)) {
      grid.append(el('div', { class: 'wide', style: 'grid-column:1/-1;font-size:13px;color:var(--dim)' },
        `⏳ Waiting for ${me.name} (${me.role})…`));
      return;
    }
```

- [ ] **Step 9.3: Online undo.** Replace the Undo button in `renderActions`:

```js
      grid.append(el('button', {
        class: 'wide', disabled: Net.online ? !Net.undoDepth : !ui.undoStack.length,
        onclick: async () => {
          if (Net.online) {
            try { const j = await Net.undo(); Net.applyPayload(j.room); sfx('click'); }
            catch (e) { toast(e.message); sfx('error'); }
          } else {
            Game.restore(ui.undoStack.pop()); ui.selectedCity = null; sfx('click'); refresh();
          }
        },
      }, '↩ Undo Action'));
```

- [ ] **Step 9.4: Gate map interaction.** In `onCityClick`, change the guard line to:

```js
    if (G().phase !== 'actions' || G().result || !myTurn()) return;
```
(The `ui.selectMode` short-circuit above it stays first — Airlift/Government Grant city-picks must work for the event player even off-turn.)

In `renderCityMenu`, change the bail-out guard to:

```js
    if (!name || g.phase !== 'actions' || g.result || !myTurn()) { menu.hidden = true; return; }
```

- [ ] **Step 9.5: Gate event cards.** In `renderPlayers`, the event-chip branch becomes:

```js
        if (c.type === 'event') {
          hand.append(cardChip(c, {
            onPlay: () => playEventFlow(i, 'hand', c.event),
            playDisabled: !Game.canPlayEvent(c.event) || !mySeatIs(i),
          }));
        } else hand.append(cardChip(c));
```

And the contingency chip:

```js
        hand.append(cardChip({ type: 'event', event: g.contingency }, {
          onPlay: () => playEventFlow(i, 'contingency', g.contingency),
          playDisabled: !Game.canPlayEvent(g.contingency) || !mySeatIs(i),
        }));
```

- [ ] **Step 9.6: Gate the state-driven dialogs** in `renderStateModal`:

a) Discard dialog — after `const p = g.players[pi];` add:

```js
      if (Net.online && pi !== Net.seat) {
        const dlg = el('div', { class: 'dialog' });
        dlg.append(el('h2', {}, `${p.name}: hand limit exceeded`));
        dlg.append(el('p', { class: 'sub' }, `Waiting for ${p.name} to discard down to ${Game.HAND_LIMIT} cards…`));
        box.append(dlg);
        return;
      }
```

b) Epidemic pause — Resilient Population buttons only for your own seat; Intensify only for the current player. Replace the buttons block:

```js
      const btns = el('div', { class: 'btnrow' });
      for (const h of rpHolders) {
        if (!mySeatIs(h.i)) continue;
        btns.append(el('button', {
          onclick: () => playEventFlow(h.i, h.source, 'Resilient Population'),
        }, `${g.players[h.i].name}: play Resilient Population now`));
      }
      if (myTurn()) {
        btns.append(el('button', {
          class: 'primary', onclick: async () => { if ((await run('intensify', [])).ok) sfx('draw'); },
        }, 'Intensify (shuffle discard on top)'));
      } else {
        btns.append(el('span', { class: 'sub' }, `Waiting for ${g.players[g.current].name} to intensify…`));
      }
      dlg.append(btns);
```

c) Forecast — only the player who played it reorders. At the top of the `if (g.forecastPending)` block, after `box.hidden = false;` add:

```js
      if (Net.online && Net.forecastBy !== Net.seat) {
        const who = Net.forecastBy != null ? g.players[Net.forecastBy].name : 'Another player';
        const dlg = el('div', { class: 'dialog' });
        dlg.append(el('h2', {}, '🔮 Forecast'));
        dlg.append(el('p', { class: 'sub' }, `${who} is rearranging the top of the infection deck…`));
        const row = el('div', { class: 'handpick' });
        g.forecastPending.forEach(c => row.append(cardChip({ type: 'city', city: c.city, color: c.color })));
        dlg.append(row);
        box.append(dlg);
        return;
      }
```

d) Game-over dialog — the New Game button leaves the room when online:

```js
      dlg.append(el('div', { class: 'btnrow', style: 'justify-content:center' },
        el('button', {
          class: 'primary', onclick: () => {
            if (Net.online) { leaveOnline(); return; }
            localStorage.removeItem(SAVE_KEY); $('#app').hidden = true; showSetup();
          },
        }, Net.online ? 'Leave Room' : 'New Game')));
```

- [ ] **Step 9.7: Topbar — connection indicator + Leave Game.** In `renderTopbar`, after the infection-deck stat, add:

```js
    if (Net.online) {
      const offline = Net.seats.filter(s => !s.connected).map(s => s.name);
      bar.append(el('span', {
        class: 'stat',
        title: Net.sseUp ? (offline.length ? `Disconnected: ${offline.join(', ')}` : 'Connected') : 'Reconnecting…',
      }, `Room ${Net.code}`,
        el('span', { class: 'connDot', style: `margin-left:6px;background:${Net.sseUp ? 'var(--good)' : 'var(--bad)'}` }),
        offline.length ? el('span', { style: 'color:var(--bad);margin-left:6px' }, `⚠ ${offline.join(', ')}`) : null));
    }
```

And make the danger button mode-aware:

```js
    bar.append(el('button', {
      class: 'danger', onclick: () => {
        openModal(Net.online ? 'Leave this game?' : 'Start a new game?', dlg => {
          dlg.append(el('p', { class: 'sub' }, Net.online
            ? 'You can rejoin with the room code as long as the game is running.'
            : 'The current game will be abandoned.'));
          dlg.append(el('div', { class: 'btnrow' },
            el('button', { onclick: closeModal }, 'Cancel'),
            el('button', {
              class: 'primary', onclick: () => {
                closeModal();
                if (Net.online) { leaveOnline(); return; }
                localStorage.removeItem(SAVE_KEY); $('#app').hidden = true; showSetup();
              },
            }, Net.online ? 'Leave Game' : 'New game')));
        });
      },
    }, Net.online ? 'Leave Game' : 'New Game'));
```

- [ ] **Step 9.8: Turn banner personalization.** In `showTurnBanner`, change the name line:

```js
      el('span', {}, Net.online && Net.seat === g.current ? 'Your turn' : `${me.name}'s turn`));
```

- [ ] **Step 9.9: Verify with two windows**

`node --check js/ui.js`, then `node server.js`, two windows, start a 2-player game:
- Window of the non-current player: actions box shows "Waiting for …", city clicks do nothing, their event cards' ▶ disabled in the other player's hand but enabled in their own.
- Current player acts → both windows update within ~100ms.
- Undo works for the current player only; the button is disabled for the other.
- Draw to an epidemic (or force one by playing several turns): only the current player gets the Intensify button.
- Kill window B entirely → window A's topbar shows `⚠ Bob`. Reopen B → rejoined, warning clears.
- Click Leave Game in B → B returns to setup; A keeps playing.

Run: `node test/rules.js && node test/fuzz.js 50 && node test/server.js`

- [ ] **Step 9.10: Commit**

```bash
git add js/ui.js
git commit -m "feat(ui): strict-seat gating, server undo, connection indicator, leave game"
```

---

### Task 10: Remote animations (observers see the action)

When another player acts, your window currently just re-renders. Derive the big moments from the log diff so remote players see/hear them too. The actor's own window skips this (it already animated at the call site) via the `actorSeat` stamp.

**Files:**
- Modify: `js/ui.js`

- [ ] **Step 10.1: Replace the `animateRemote` stub** (added in Task 8) with:

```js
  // Replay the visual beats of someone else's action from the log entries the
  // new state added. Pure flavor — never touches game state. The 25-entry cap
  // skips bulk catch-ups (fresh joins, reconnects after a long gap).
  function animateRemote(logMark) {
    const entries = G().log.slice(logMark);
    if (!entries.length || entries.length > 25) return;
    let infected = false, epidemic = false;
    for (const e of entries) {
      let m;
      if ((m = e.msg.match(/^Epidemic strikes (.+)\.$/))) { epidemic = true; epicenter(m[1]); }
      else if ((m = e.msg.match(/^(.+?) infected \((blue|yellow|black|red):/))) { infected = true; cityPulse(m[1], HEX[m[2]]); }
      else if ((m = e.msg.match(/ moves(?: .+?)? to (.+?) \((drive|shuttle|direct|charter|dispatch|opex)\)\.$/))) { cityPulse(m[1], '#38bdf8'); }
      else if ((m = e.msg.match(/^Airlift: .+? flies to (.+?)\.$/))) { cityPulse(m[1], '#4ade80'); }
      else if ((m = e.msg.match(/discovers a CURE for the (blue|yellow|black|red) disease/))) { sfx('cure'); cureBanner(m[1]); }
    }
    if (epidemic) sfx('epidemic');
    else if (entries.some(e => /^OUTBREAK/.test(e.msg))) { /* outbreakBlast plays its own sfx */ }
    else if (infected) sfx('infect');
    animateOutbreaks(logMark); // chains outbreak blasts exactly like local play
  }
```

- [ ] **Step 10.2: Verify**

`node --check js/ui.js`, two windows: player A treats/moves/draws while watching window B — B should pulse cities, play infection pings, and on an outbreak run the full blast sequence. A's own window must NOT double-animate. A cure discovered by A shows the banner+confetti in B too.

Run: `node test/server.js && node test/rules.js && node test/fuzz.js 50`

- [ ] **Step 10.3: Commit**

```bash
git add js/ui.js
git commit -m "feat(ui): replay action animations for remote players from the log diff"
```

---

### Task 11: Docs + end-to-end verification

**Files:**
- Modify: `README.md`, `CLAUDE.md`, `index.html` (title)

- [ ] **Step 11.1: Update docs**

`index.html`: change `<title>Pandemic — Local Two-Player</title>` to `<title>Pandemic</title>`.

`README.md`: update the run instructions — `node server.js` is now the primary way to serve (still zero dependencies), `python3 -m http.server` / `open index.html` still work for local-only play. Add a short "Play online" section: start the server, share your address (LAN IP, Tailscale, or an ngrok/cloudflared tunnel), create a room, share the 4-letter code; games survive server restarts (`saves/rooms.json`) and page reloads (rejoin by token).

`CLAUDE.md`: under Commands add `node test/server.js` and `node server.js`. Under Architecture add two lines: `server.js` — zero-dep Node server: serves static files, hosts online rooms, applies actions through the engine via `restore()`/`snapshot()` state-swap, pushes full state over SSE; strict-seat permission layer lives here. `js/net.js` — client online glue; `ui.js` dispatches all engine mutations through `act`/`run` which POST in online mode. Note that `game.js` remains DOM-free AND server-shared: it must stay free of browser *and* room-specific concerns.

- [ ] **Step 11.2: Full test suite**

Run: `node test/rules.js && node test/fuzz.js 300 && node test/server.js`
Expected: all green.

- [ ] **Step 11.3: End-to-end two-player game**

`node server.js`, two browser windows (one normal, one incognito). Play a full short game online (4 epidemics, intentionally lose fast by ignoring outbreaks if needed) verifying: lobby → start → alternating turns with gating → events from the off-turn player → epidemic + intensify → hand-limit discard → game-over screen in both windows → Leave Room. Then reload one window mid-game and confirm rejoin. Then restart the server mid-game (`Ctrl-C`, `node server.js`) and confirm both clients reconnect and play continues (room restored from `saves/rooms.json`).

- [ ] **Step 11.4: Final commit**

```bash
git add README.md CLAUDE.md index.html
git commit -m "docs: online multiplayer — server usage, architecture notes"
```

---

## Plan self-review notes

- **Spec coverage:** hosting/transport/architecture (Tasks 1–5), both modes (7–8), strict seats (3, 9), undo (3, 9), reconnect/persistence (5, 8), SSE payload incl. mySeat/forecastBy/undoDepth (3–4), setup/lobby (8), dispatcher (7), seat gating incl. forecast/discard/epidemic dialogs (9), connection indicator (9), docs/tests (11). Deviation from spec, deliberate: the lobby drops the optional per-seat role picker (random roles only) — YAGNI; noted in Task 8.2.
- **Addition beyond spec:** Task 10 (remote animations) — without it, remote players get silent state jumps; `actorSeat` in the payload exists to support it.
- **Undo semantics implemented as written in the spec** (snapshots cleared on turn change, events void undo), not as the hotseat's stricter phase-based clearing.
