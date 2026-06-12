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

// Placeholder until SSE lands: roster/state changed, notify clients.
function broadcast(room) { room.seq++; }

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

  return sendJSON(res, 404, { error: 'unknown api route' });
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
