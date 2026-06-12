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

  server.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
