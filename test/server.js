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
