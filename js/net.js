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

  Net.kick = seat => api(`/api/rooms/${Net.code}/kick`, { token: Net.token, seat });

  // Leave for real: free the seat on the server (lobby only — the server
  // refuses mid-game, where closing the page and rejoining is the model),
  // then tear down local state either way.
  Net.leaveRoom = async function () {
    try { await api(`/api/rooms/${Net.code}/leave`, { token: Net.token }); } catch (e) { /* room gone or game running */ }
    Net.leave();
  };

  function enter(code, token) {
    Net.online = true;
    Net.code = code; Net.token = token; Net.seq = 0;
    localStorage.setItem(SESSION_KEY, JSON.stringify({ code, token }));
    connectStream();
  }

  function connectStream() {
    if (Net.es) Net.es.close();
    Net.es = new EventSource(`/api/rooms/${Net.code}/events?token=${Net.token}`);
    Net.es.onmessage = ev => Net.applyPayload(JSON.parse(ev.data));
    Net.es.onopen = () => { Net.sseUp = true; if (Net.onUpdate) Net.onUpdate(null); };
    Net.es.onerror = () => { Net.sseUp = false; if (Net.onUpdate) Net.onUpdate(null); };
  }

  // Backgrounded tabs (laptop lid, phone switch) can lose their stream without
  // any error event firing. On wake, rebuild it — the hello frame resyncs us.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Net.online) connectStream();
  });

  // Apply a room payload (from SSE or echoed in an action response). Stale or
  // duplicate payloads are dropped by seq, so the SSE event and the POST echo
  // of the same action can race safely.
  Net.applyPayload = function (p) {
    if (!Net.online) return;
    // The server redeployed since this page loaded: reload to pick up matching
    // client code. Harmless — the session in localStorage rejoins the seat.
    if (p.v) {
      if (Net.serverV == null) Net.serverV = p.v;
      else if (p.v !== Net.serverV) { location.reload(); return; }
    }
    // hello = authoritative resync after (re)connect: accept it even if the
    // server's seq went backwards (e.g. restored from a save after a restart).
    if (p.hello) Net.seq = p.seq - 1;
    if (p.seq <= Net.seq) return;
    if (p.kicked || p.closed) {
      const why = p.kicked ? 'You were removed from the room.' : 'The host closed the room.';
      const cb = Net.onClosed;
      Net.leave();
      if (cb) cb(why);
      return;
    }
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
