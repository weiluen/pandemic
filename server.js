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

const PORT = +(process.argv[2] || process.env.PORT || 8421);
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

// Changes every boot (so every deploy). Clients compare it across payloads and
// reload themselves when it moves — otherwise a page opened before a deploy
// would run old JS against the new server forever.
const BOOT_ID = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;

// ---------------- rooms ----------------

function newToken() { return crypto.randomBytes(16).toString('hex'); }

function newRoomCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O — avoids misreads over voice chat
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += A[crypto.randomInt(A.length)];
    if (!rooms.has(c)) return c;
  }
}

function seatName(given, idx) {
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
  room.seats.push({ name: seatName(body.name, 0), token, connected: 0 });
  room.hostToken = token;
  rooms.set(room.code, room);
  return { room, token };
}

function touch(room) { room.lastActivity = Date.now(); }

// Everything a client needs to render: full engine state + roster. Identical
// for everyone except mySeat (stamped per connection) and actorSeat (set on
// action-triggered broadcasts so the actor's own UI can skip replaying
// animations it already played locally).
function payload(room, seat, actorSeat) {
  return {
    v: BOOT_ID,
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
  for (const c of room.sseClients.slice()) {
    const seat = seatByToken(room, c.token);
    if (seat < 0) {
      // seat no longer exists (kicked): tell the client, then drop it
      c.res.write(`data: ${JSON.stringify({ seq: room.seq, kicked: true })}\n\n`);
      try { c.res.end(); } catch (e) {}
      room.sseClients = room.sseClients.filter(x => x !== c);
      continue;
    }
    c.res.write(`data: ${JSON.stringify(payload(room, seat, actorSeat))}\n\n`);
  }
  scheduleSave();
}

// Disband a room: notify every connected client, close streams, delete.
function closeRoom(room) {
  room.seq++;
  for (const c of room.sseClients) {
    try {
      c.res.write(`data: ${JSON.stringify({ seq: room.seq, closed: true })}\n\n`);
      c.res.end();
    } catch (e) {}
  }
  room.sseClients = [];
  rooms.delete(room.code);
  scheduleSave();
}

// SSE keepalive: comment frames every 25s so idle connections stay open.
setInterval(() => {
  for (const room of rooms.values()) {
    for (const c of room.sseClients) c.res.write(': ping\n\n');
  }
}, 25000).unref();

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
    room.seats.push({ name: seatName(body.name, room.seats.length), token, connected: 0 });
    touch(room);
    broadcast(room);
    return sendJSON(res, 200, { token, seat: room.seats.length - 1 });
  }

  if (sub === 'leave' && req.method === 'POST') {
    const body = await readBody(req);
    const seat = seatByToken(room, body.token);
    if (seat < 0) return sendJSON(res, 403, { error: 'not a player in this room' });
    if (room.status !== 'lobby') {
      return sendJSON(res, 409, { error: 'cannot leave a running game — close the page; you can rejoin any time' });
    }
    if (seat === 0) { closeRoom(room); return sendJSON(res, 200, { ok: true, closed: true }); }
    room.seats.splice(seat, 1);
    touch(room);
    broadcast(room);
    return sendJSON(res, 200, { ok: true });
  }

  if (sub === 'kick' && req.method === 'POST') {
    const body = await readBody(req);
    if (body.token !== room.hostToken) return sendJSON(res, 403, { error: 'only the host can remove a player' });
    if (room.status !== 'lobby') return sendJSON(res, 409, { error: 'the game has already started' });
    const seat = +body.seat;
    if (!Number.isInteger(seat) || seat <= 0 || seat >= room.seats.length) {
      return sendJSON(res, 400, { error: 'no such seat' });
    }
    room.seats.splice(seat, 1);
    touch(room);
    broadcast(room); // the kicked client's stream gets a {kicked:true} frame here
    return sendJSON(res, 200, { ok: true });
  }

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

  if (sub === 'events' && req.method === 'GET') {
    const seat = seatByToken(room, url.searchParams.get('token'));
    if (seat < 0) return sendJSON(res, 403, { error: 'not a player in this room' });
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    // Track by token, not seat index — seats shift when someone leaves or is
    // kicked. seatObj is a stable reference for the connected counter.
    const token = url.searchParams.get('token');
    const seatObj = room.seats[seat];
    const client = { res, token };
    room.sseClients.push(client);
    seatObj.connected++;
    touch(room);
    res.write(`retry: 1500\n\n`);
    // Hello frame: a full snapshot the client must accept unconditionally.
    // After a server restart the room's seq can be lower than what this client
    // saw before, so plain seq-gating would discard the resync forever.
    room.seq++;
    res.write(`data: ${JSON.stringify({ ...payload(room, seat), hello: true })}\n\n`);
    broadcast(room); // everyone else sees the fresh roster
    req.on('close', () => {
      room.sseClients = room.sseClients.filter(c => c !== client);
      seatObj.connected = Math.max(0, seatObj.connected - 1);
      if (rooms.has(room.code)) broadcast(room);
    });
    return;
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

  return sendJSON(res, 404, { error: 'unknown api route' });
}

function createAppServer() {
  return http.createServer((req, res) => {
    handle(req, res).catch(e => { try { sendJSON(res, 500, { error: e.message }); } catch (_) {} });
  });
}

// ---------------- boot ----------------

if (require.main === module) {
  loadRooms();
  createAppServer().listen(PORT, () => {
    console.log(`Pandemic server: http://localhost:${PORT}`);
    console.log(`Friends connect to your LAN address or tunnel on port ${PORT}.`);
  });
  setInterval(gcRooms, 60 * 60 * 1000).unref();
  // Deploys/restarts send SIGTERM: flush the debounced save so no broadcast
  // (and no seq increment) is ever lost across a restart.
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, () => { saveNow(); process.exit(0); });
  }
} else {
  module.exports = { createAppServer, rooms, loadRooms, saveNow, gcRooms, SAVE_FILE, BOOT_ID };
}
