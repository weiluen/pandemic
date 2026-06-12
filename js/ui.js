'use strict';
// UI layer: renders the board from Game.state() and drives all interactions.

(function () {
  const Game = globalThis.Game;
  const D = globalThis.PANDEMIC_DATA;
  const COLORS = Game.COLORS;
  const HEX = { blue: '#3b82f6', yellow: '#eab308', black: '#64748b', red: '#ef4444' };
  const ROLE = {}; D.roles.forEach(r => ROLE[r.name] = r);
  const EVENT = {}; D.events.forEach(e => EVENT[e.name] = e);
  const SAVE_KEY = 'pandemic-save-v1';
  const SVGNS = 'http://www.w3.org/2000/svg';

  // One landmark emoji per city, shown on the map and in menus/cards.
  const EMOJI = {
    'San Francisco': '🌉', 'Chicago': '🌭', 'Atlanta': '🍑', 'Montreal': '🍁',
    'New York': '🗽', 'Washington': '🏛️', 'London': '💂', 'Madrid': '🥘',
    'Paris': '🗼', 'Essen': '⚙️', 'Milan': '👠', 'St. Petersburg': '❄️',
    'Los Angeles': '🎬', 'Mexico City': '🌮', 'Miami': '🏖️', 'Bogota': '☕',
    'Lima': '🦙', 'Santiago': '⛰️', 'Buenos Aires': '💃', 'Sao Paulo': '⚽',
    'Lagos': '🌴', 'Kinshasa': '🦍', 'Johannesburg': '💎', 'Khartoum': '🐪',
    'Algiers': '🕌', 'Istanbul': '🧿', 'Cairo': '🏺', 'Moscow': '🪆',
    'Baghdad': '🧞', 'Riyadh': '🛢️', 'Tehran': '🏔️', 'Karachi': '⚓',
    'Mumbai': '🎥', 'Delhi': '🛺', 'Chennai': '🛕', 'Kolkata': '🐅',
    'Beijing': '🐉', 'Seoul': '🎤', 'Tokyo': '🍣', 'Shanghai': '🏙️',
    'Osaka': '🏯', 'Taipei': '🧋', 'Hong Kong': '🥟', 'Bangkok': '🍜',
    'Ho Chi Minh City': '🛵', 'Manila': '🌺', 'Jakarta': '🌋', 'Sydney': '🦘',
  };

  // Real Natural Earth coastlines, warped to the board layout (see js/worldmap.js, generated).
  const WORLD = globalThis.PANDEMIC_WORLD || [];

  const ui = {
    selectedCity: null,   // city menu open for this city
    selectMode: null,     // {label, onPick(city), onCancel}
    pawnSel: null,        // dispatcher: which pawn to move
    undoStack: [],
    forecastOrder: null,
    lastCityClick: null,  // {px, py} for menu placement
    turnKey: null,        // "<turn>:<player>" last seen, to animate turn changes
    resultPlayed: false,  // win/lose stinger fired for the current game
  };

  const $ = s => document.querySelector(s);
  const G = () => Game.state();

  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'onclick') n.onclick = v;
      else if (k === 'style') n.style.cssText = v;
      else if (k === 'disabled') { if (v) n.disabled = true; }
      else n.setAttribute(k, v);
    }
    for (const k of kids.flat(9)) {
      if (k == null || k === false) continue;
      n.append(k.nodeType ? k : document.createTextNode(k));
    }
    return n;
  }
  function svg(tag, attrs, ...kids) {
    const n = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') n.setAttribute('class', v);
      else if (k === 'onclick') n.onclick = v;
      else n.setAttribute(k, v);
    }
    for (const k of kids.flat(9)) if (k != null) n.append(k);
    return n;
  }

  // ================= Sound effects (synthesized, no assets) =================

  let actx = null;
  let muted = localStorage.getItem('pandemic-muted') === '1';
  function audio() {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    return actx;
  }
  function tone(freq, at, dur, type, vol, slideTo) {
    const ctx = audio(), t = ctx.currentTime + at;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ctx.destination);
    o.start(t); o.stop(t + dur + 0.05);
  }
  function whoosh(at, dur, vol, cutoff) {
    const ctx = audio(), t = ctx.currentTime + at;
    const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff || 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(ctx.destination);
    src.start(t);
  }
  const SFX = {
    move: () => { whoosh(0, 0.28, 0.22, 1400); tone(280, 0, 0.22, 'sine', 0.14, 620); },
    treat: () => { tone(880, 0, 0.09, 'triangle', 0.2); tone(1318, 0.09, 0.14, 'triangle', 0.2); },
    build: () => { tone(150, 0, 0.18, 'square', 0.22, 95); whoosh(0.03, 0.12, 0.18, 520); },
    cure: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.13, 0.34, 'triangle', 0.22)),
    share: () => { whoosh(0, 0.16, 0.16, 2600); tone(520, 0.02, 0.12, 'sine', 0.12, 760); },
    draw: () => { whoosh(0, 0.13, 0.18, 3000); tone(700, 0.04, 0.09, 'sine', 0.1, 950); },
    event: () => { tone(660, 0, 0.13, 'sine', 0.18); tone(990, 0.11, 0.17, 'sine', 0.18); },
    infect: () => { tone(220, 0, 0.32, 'sawtooth', 0.13, 110); whoosh(0, 0.3, 0.1, 420); },
    epidemic: () => { [0, 0.22, 0.44].forEach(at => tone(165, at, 0.2, 'sawtooth', 0.26, 82)); whoosh(0, 0.8, 0.22, 300); },
    outbreak: () => { tone(90, 0, 0.5, 'sawtooth', 0.3, 45); whoosh(0, 0.5, 0.3, 240); },
    turn: () => { tone(587, 0, 0.12, 'sine', 0.14); tone(880, 0.11, 0.18, 'sine', 0.14); },
    error: () => tone(170, 0, 0.16, 'square', 0.1, 120),
    click: () => tone(430, 0, 0.06, 'sine', 0.1),
    win: () => [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => tone(f, i * 0.15, 0.5, 'triangle', 0.2)),
    lose: () => [392, 330, 262, 196].forEach((f, i) => tone(f, i * 0.32, 0.5, 'sawtooth', 0.14)),
  };
  function sfx(name) {
    if (muted) return;
    try { SFX[name] && SFX[name](); } catch (e) { /* audio blocked until first gesture */ }
  }

  let toastTimer = null;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
  }

  // run engine call with error toast; both return whether the call succeeded
  // so call sites can fire sounds/animations only on success.
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

  // Expanding rings at a city — feedback for actions that land on the map.
  function cityPulse(city, color) {
    const c = Game.CITY[city];
    if (!c) return;
    const map = $('#map');
    [0, 200].forEach(delay => {
      const ring = svg('circle', {
        class: 'actionring', cx: c.x, cy: c.y,
        style: `stroke:${color};animation-delay:${delay}ms`,
      });
      map.append(ring);
      setTimeout(() => ring.remove(), 1300 + delay);
    });
  }

  // Floating score-style text at a city (e.g. "−3 red" when treating).
  function floatText(city, text, color) {
    const c = Game.CITY[city];
    if (!c) return;
    const t = svg('text', { class: 'floatup', x: c.x, y: c.y - 18, 'text-anchor': 'middle', style: `fill:${color}` }, text);
    $('#map').append(t);
    setTimeout(() => t.remove(), 1600);
  }

  // The big one: cure discovered. Banner with progress, screen flash in the
  // disease color, pulses at every research station, and a confetti burst.
  function cureBanner(color) {
    const g = G(), wrap = $('#mapwrap');
    const n = COLORS.filter(c => g.cures[c]).length;
    const sub = n === 4 ? 'ALL FOUR DISEASES CURED!'
      : n === 3 ? '3/4 cured — ONE MORE TO WIN!' : `${n}/4 diseases cured`;
    const b = el('div', { class: 'curebanner', style: `border-color:${HEX[color]}` },
      el('div', { class: 'ifname', style: `text-shadow:0 0 24px ${HEX[color]}` }, `💉 ${color.toUpperCase()} CURE DISCOVERED!`),
      el('div', { class: 'ifsub' }, sub));
    wrap.append(b);
    setTimeout(() => b.remove(), 3400);
    const flash = el('div', { class: 'cureflash', style: `background:${HEX[color]}` });
    wrap.append(flash);
    setTimeout(() => flash.remove(), 1400);
    for (const s of g.stations) cityPulse(s, HEX[color]);
    const palette = [HEX[color], '#f8fafc', '#4ade80'];
    for (let i = 0; i < 60; i++) {
      const sp = el('span', {
        class: 'confetti',
        style: `left:${Math.random() * 100}%;background:${palette[i % palette.length]};` +
          `width:${5 + Math.random() * 5}px;height:${7 + Math.random() * 6}px;` +
          `animation-duration:${2 + Math.random() * 1.8}s;animation-delay:${Math.random() * 0.5}s;animation-iteration-count:1`,
      });
      wrap.append(sp);
      setTimeout(() => sp.remove(), 4600);
    }
  }

  function save() {
    if (G() && !G().result) localStorage.setItem(SAVE_KEY, Game.serialize());
    else localStorage.removeItem(SAVE_KEY);
  }

  // ================= Setup screen =================

  function showSetup() {
    const box = $('#setup');
    box.hidden = false;
    box.innerHTML = '';
    const saved = localStorage.getItem(SAVE_KEY);

    let count = 2;
    const dlg = el('div', { class: 'dialog' });
    dlg.append(
      el('p', { class: 'bigtitle' }, 'PANDEMIC'),
      el('p', { class: 'subtitle' }, 'Cooperative board game — local hotseat. Cure all four diseases before the world succumbs.'),
    );

    const nameInputs = el('div');
    const roleSelects = el('div');
    function renderPlayerRows() {
      nameInputs.innerHTML = ''; roleSelects.innerHTML = '';
      for (let i = 0; i < count; i++) {
        nameInputs.append(el('div', { class: 'setuprow' },
          el('label', {}, `Player ${i + 1} name`),
          el('input', { type: 'text', id: `pname${i}`, value: `Player ${i + 1}` })));
        const sel = el('select', { id: `prole${i}` }, el('option', { value: '' }, 'Random role'));
        for (const r of D.roles) sel.append(el('option', { value: r.name }, r.name));
        const desc = el('div', { class: 'setupdesc' });
        sel.onchange = () => { desc.textContent = sel.value ? ROLE[sel.value].desc : ''; };
        roleSelects.append(el('div', { class: 'setuprow' }, el('label', {}, `Player ${i + 1} role`), sel), desc);
      }
    }
    const countSel = el('select', {},
      ...[2, 3, 4].map(n => el('option', { value: n, selected: n === 2 ? '' : undefined }, `${n} players`)));
    countSel.value = '2';
    countSel.onchange = () => { count = +countSel.value; renderPlayerRows(); };

    const epiSel = el('select', {},
      el('option', { value: 4 }, '4 epidemics — Introductory'),
      el('option', { value: 5 }, '5 epidemics — Standard'),
      el('option', { value: 6 }, '6 epidemics — Heroic'));
    epiSel.value = '4';

    renderPlayerRows();
    const errLine = el('div', { style: 'color:var(--bad);font-weight:600;min-height:18px;margin-top:8px' });
    const showErr = msg => { errLine.textContent = msg; };
    dlg.append(
      el('div', { class: 'setuprow' }, el('label', {}, 'Players'), countSel),
      nameInputs,
      roleSelects,
      el('div', { class: 'setuprow' }, el('label', {}, 'Difficulty'), epiSel),
      errLine,
      el('div', { class: 'btnrow' },
        saved ? el('button', {
          onclick: () => {
            try {
              Game.load(saved);
              box.hidden = true; $('#app').hidden = false; ui.undoStack = []; ui.resultPlayed = false; refresh();
            } catch (e) {
              showErr('Could not load the saved game: ' + e.message);
              localStorage.removeItem(SAVE_KEY);
            }
          },
        }, 'Resume saved game') : null,
        el('button', {
          class: 'primary', onclick: () => {
            showErr('');
            try {
              const names = [], roles = [];
              for (let i = 0; i < count; i++) {
                names.push($(`#pname${i}`).value.trim() || `Player ${i + 1}`);
                roles.push($(`#prole${i}`).value);
              }
              const chosen = roles.filter(Boolean);
              if (new Set(chosen).size !== chosen.length) {
                showErr('Each player needs a different role — two players have the same one selected.');
                return;
              }
              if (chosen.length && chosen.length < count) {
                // fill blanks with random roles not already taken
                const pool = D.roles.map(r => r.name).filter(r => !chosen.includes(r));
                for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
                for (let i = 0; i < count; i++) if (!roles[i]) roles[i] = pool.pop();
              }
              Game.newGame({ names, epidemics: +epiSel.value, roles: chosen.length ? roles : null });
              ui.undoStack = [];
              ui.resultPlayed = false;
              ui.turnKey = null;
              box.hidden = true;
              $('#app').hidden = false;
              refresh();
            } catch (e) {
              showErr('Could not start: ' + e.message + ' — try a hard refresh (Cmd+Shift+R).');
            }
          },
        }, 'Start Game')),
    );
    box.append(dlg);
  }

  // On-demand viewer for the infection discard pile (public knowledge in Pandemic).
  function showInfectionPile() {
    const g = G();
    openModal('🦠 Infection pile', dlg => {
      dlg.append(el('p', { class: 'sub' },
        `${g.infectionDeck.length} cards face down in the deck. The discard pile below is shuffled back on top after an epidemic — these cities WILL come back.`));
      dlg.append(el('div', { class: 'boxtitle' }, `Discard pile (${g.infectionDiscard.length}) — most recent first`));
      const pile = el('div', { class: 'handpick' });
      g.infectionDiscard.slice().reverse().forEach(c => pile.append(cardChip({ type: 'city', city: c.city, color: c.color })));
      if (!g.infectionDiscard.length) pile.append(el('span', { class: 'sub' }, 'Empty.'));
      dlg.append(pile);
      const removed = g.removed.filter(c => c.city);
      if (removed.length) {
        dlg.append(el('div', { class: 'boxtitle', style: 'margin-top:10px' }, 'Removed from the game forever'));
        const rm = el('div', { class: 'handpick' });
        removed.forEach(c => rm.append(cardChip({ type: 'city', city: c.city, color: c.color })));
        dlg.append(rm);
      }
      dlg.append(el('div', { class: 'btnrow' }, el('button', { class: 'primary', onclick: closeModal }, 'Close')));
    });
  }

  // Player discard history: every card played or discarded, most recent first.
  function showPlayerPile() {
    const g = G();
    openModal('🃏 Player discard pile', dlg => {
      dlg.append(el('p', { class: 'sub' },
        `${g.playerDeck.length} cards left to draw. Below is everything discarded so far — city cards spent on travel, builds and cures, plus played events.`));
      dlg.append(el('div', { class: 'boxtitle' }, `Discard pile (${g.playerDiscard.length}) — most recent first`));
      const pile = el('div', { class: 'handpick' });
      g.playerDiscard.slice().reverse().forEach(c => pile.append(cardChip(c)));
      if (!g.playerDiscard.length) pile.append(el('span', { class: 'sub' }, 'Empty.'));
      dlg.append(pile);
      const epis = g.removed.filter(c => c.type === 'epidemic').length;
      const events = g.removed.filter(c => c.type === 'event');
      if (epis || events.length) {
        dlg.append(el('div', { class: 'boxtitle', style: 'margin-top:10px' }, 'Removed from the game'));
        const rm = el('div', { class: 'handpick' });
        for (let i = 0; i < epis; i++) rm.append(el('span', { class: 'card red' }, el('span', { class: 'cardname' }, '☣ EPIDEMIC')));
        events.forEach(c => rm.append(cardChip(c)));
        dlg.append(rm);
      }
      dlg.append(el('div', { class: 'btnrow' }, el('button', { class: 'primary', onclick: closeModal }, 'Close')));
    });
  }

  // ================= Top bar =================

  function renderTopbar() {
    const g = G();
    const bar = $('#topbar');
    bar.innerHTML = '';
    bar.append(el('span', { class: 'title' }, 'PANDEMIC'));

    const track = el('span', { class: 'ratetrack' });
    Game.INFECTION_RATES.forEach((r, i) => track.append(el('span', { class: i === g.rateIndex ? 'cur' : '' }, r)));
    bar.append(el('span', { class: 'stat' }, 'Infection rate', track));

    bar.append(el('span', { class: 'stat outbreakmeter' }, 'Outbreaks',
      el('b', { class: g.outbreaks >= 5 ? 'warn' : '' }, ` ${g.outbreaks} / 8`)));

    const cures = el('span', { style: 'display:flex;gap:4px' });
    for (const c of COLORS) {
      const cured = g.cures[c], erad = Game.isErad(c);
      cures.append(el('span', {
        class: 'cure' + (cured ? ' cured' : ''),
        style: `border-color:${HEX[c]};background:${cured ? HEX[c] : 'transparent'}`,
        title: `${c}: ${erad ? 'eradicated' : cured ? 'cured' : 'active'}`,
      }, erad ? '✕' : cured ? '✓' : ''));
    }
    bar.append(el('span', { class: 'stat' }, 'Cures', cures));
    bar.append(el('span', {
      class: 'stat statbtn', title: 'Click to inspect the player discard pile',
      onclick: showPlayerPile,
    }, 'Player deck', el('b', {}, ` ${g.playerDeck.length}`), el('span', { class: 'peek' }, '🔍')));
    bar.append(el('span', {
      class: 'stat statbtn', title: 'Click to inspect the infection discard pile',
      onclick: showInfectionPile,
    }, 'Infection deck', el('b', {}, ` ${g.infectionDeck.length}`), el('span', { class: 'peek' }, '🔍')));
    bar.append(el('span', { class: 'spacer' }));
    bar.append(el('button', {
      title: muted ? 'Unmute sound effects' : 'Mute sound effects',
      onclick: () => { muted = !muted; localStorage.setItem('pandemic-muted', muted ? '1' : '0'); renderTopbar(); },
    }, muted ? '\u{1F507}' : '\u{1F50A}'));
    bar.append(el('button', { onclick: showHelp }, 'Rules'));
    bar.append(el('button', {
      class: 'danger', onclick: () => {
        openModal('Start a new game?', dlg => {
          dlg.append(el('p', { class: 'sub' }, 'The current game will be abandoned.'));
          dlg.append(el('div', { class: 'btnrow' },
            el('button', { onclick: closeModal }, 'Cancel'),
            el('button', {
              class: 'primary', onclick: () => { closeModal(); localStorage.removeItem(SAVE_KEY); $('#app').hidden = true; showSetup(); },
            }, 'New game')));
        });
      },
    }, 'New Game'));
  }

  // ================= Map view (zoom & pan) =================

  const BASE_W = 1500, BASE_H = 780;
  const view = { x: 0, y: 0, w: BASE_W, h: BASE_H };

  function applyView() {
    $('#map').setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);
  }
  function clampView() {
    view.w = Math.max(BASE_W / 8, Math.min(BASE_W, view.w));
    view.h = view.w * BASE_H / BASE_W;
    view.x = Math.max(0, Math.min(BASE_W - view.w, view.x));
    view.y = Math.max(0, Math.min(BASE_H - view.h, view.y));
  }
  // px-per-board-unit, accounting for the letterboxing of preserveAspectRatio="meet"
  function mapScale() {
    const r = $('#map').getBoundingClientRect();
    return Math.min(r.width / view.w, r.height / view.h);
  }
  function mapPoint(clientX, clientY) {
    const r = $('#map').getBoundingClientRect();
    const s = mapScale();
    const ox = (r.width - view.w * s) / 2, oy = (r.height - view.h * s) / 2;
    return { x: view.x + (clientX - r.left - ox) / s, y: view.y + (clientY - r.top - oy) / s };
  }
  function zoomAt(px, py, factor) {
    const w0 = view.w;
    view.w = Math.max(BASE_W / 8, Math.min(BASE_W, view.w * factor));
    const k = view.w / w0;
    view.x = px - (px - view.x) * k;
    view.y = py - (py - view.y) * k;
    clampView();
    applyView();
  }

  // Smoothly fly the camera to center on a board point at the given zoom width.
  let viewAnim = null;
  function animateViewTo(cx, cy, w) {
    const w1 = Math.max(BASE_W / 8, Math.min(BASE_W, w));
    const h1 = w1 * BASE_H / BASE_W;
    const from = { ...view };
    const to = {
      x: Math.max(0, Math.min(BASE_W - w1, cx - w1 / 2)),
      y: Math.max(0, Math.min(BASE_H - h1, cy - h1 / 2)),
      w: w1, h: h1,
    };
    cancelAnimationFrame(viewAnim);
    const t0 = performance.now();
    const ease = t => 1 - Math.pow(1 - t, 3);
    (function step(now) {
      const t = Math.min(1, (now - t0) / 700), e = ease(t);
      view.x = from.x + (to.x - from.x) * e;
      view.y = from.y + (to.y - from.y) * e;
      view.w = from.w + (to.w - from.w) * e;
      view.h = from.h + (to.h - from.h) * e;
      applyView();
      if (t < 1) viewAnim = requestAnimationFrame(step);
    })(t0);
  }

  function initMapControls() {
    const wrap = $('#mapwrap');
    let drag = null, suppressClick = false;
    wrap.addEventListener('wheel', e => {
      e.preventDefault();
      const p = mapPoint(e.clientX, e.clientY);
      // smooth, delta-proportional zoom; trackpad pinches arrive as ctrlKey
      // wheel events in rapid small increments, so they get a gentler rate
      const rate = e.ctrlKey ? 0.0085 : 0.0022;
      const factor = Math.min(1.22, Math.max(0.82, Math.exp(e.deltaY * rate)));
      zoomAt(p.x, p.y, factor);
    }, { passive: false });
    wrap.addEventListener('pointerdown', e => {
      if (e.button !== 0 || e.target.closest('#citymenu, #banner, #mapcontrols')) return;
      drag = { x: e.clientX, y: e.clientY, moved: false };
    });
    window.addEventListener('pointermove', e => {
      if (!drag) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5) return;
      drag.moved = true;
      wrap.classList.add('panning');
      const s = mapScale();
      view.x -= (e.clientX - drag.x) / s;
      view.y -= (e.clientY - drag.y) / s;
      drag.x = e.clientX; drag.y = e.clientY;
      clampView();
      applyView();
    });
    window.addEventListener('pointerup', () => {
      if (drag && drag.moved) suppressClick = true;
      drag = null;
      wrap.classList.remove('panning');
    });
    // a drag that ends over a city must not register as a click
    wrap.addEventListener('click', e => {
      if (suppressClick) { suppressClick = false; e.stopPropagation(); }
    }, true);
    $('#zoomin').onclick = () => zoomAt(view.x + view.w / 2, view.y + view.h / 2, 1 / 1.35);
    $('#zoomout').onclick = () => zoomAt(view.x + view.w / 2, view.y + view.h / 2, 1.35);
    $('#zoomreset').onclick = () => { view.x = 0; view.y = 0; view.w = BASE_W; view.h = BASE_H; applyView(); };
    applyView();
  }

  // ================= Map =================

  // sphere shading for city nodes: [highlight, base, shadow]
  const SPHERE = {
    blue: ['#8fc0ff', '#3b82f6', '#1e40af'],
    yellow: ['#ffe089', '#eab308', '#8f6c06'],
    black: ['#c3cfdf', '#64748b', '#3b4759'],
    red: ['#ff9d8f', '#ef4444', '#991b1b'],
  };

  function worldLayer() {
    const g = svg('g', { class: 'world' });
    const defs = svg('defs', {});
    const landg = svg('linearGradient', { id: 'landg', x1: 0, y1: 0, x2: 0, y2: 1 });
    landg.append(svg('stop', { offset: '0%', 'stop-color': '#243759' }));
    landg.append(svg('stop', { offset: '100%', 'stop-color': '#16233f' }));
    defs.append(landg);
    for (const c of COLORS) {
      // 3D sphere gradient for city nodes
      const cg = svg('radialGradient', { id: `cg-${c}`, cx: '35%', cy: '28%', r: '80%' });
      cg.append(svg('stop', { offset: '0%', 'stop-color': SPHERE[c][0] }));
      cg.append(svg('stop', { offset: '55%', 'stop-color': SPHERE[c][1] }));
      cg.append(svg('stop', { offset: '100%', 'stop-color': SPHERE[c][2] }));
      defs.append(cg);
      // radial halo for infection-intensity glows
      const gl = svg('radialGradient', { id: `glow-${c}` });
      gl.append(svg('stop', { offset: '0%', 'stop-color': HEX[c], 'stop-opacity': 0.85 }));
      gl.append(svg('stop', { offset: '55%', 'stop-color': HEX[c], 'stop-opacity': 0.32 }));
      gl.append(svg('stop', { offset: '100%', 'stop-color': HEX[c], 'stop-opacity': 0 }));
      defs.append(gl);
    }
    // research-station building face + shared cyan halo (also under the active pawn)
    const stg = svg('linearGradient', { id: 'stationg', x1: 0, y1: 0, x2: 0, y2: 1 });
    stg.append(svg('stop', { offset: '0%', 'stop-color': '#ffffff' }));
    stg.append(svg('stop', { offset: '100%', 'stop-color': '#bfd3ea' }));
    defs.append(stg);
    const sgl = svg('radialGradient', { id: 'glow-station' });
    sgl.append(svg('stop', { offset: '0%', 'stop-color': '#38bdf8', 'stop-opacity': 0.65 }));
    sgl.append(svg('stop', { offset: '60%', 'stop-color': '#38bdf8', 'stop-opacity': 0.25 }));
    sgl.append(svg('stop', { offset: '100%', 'stop-color': '#38bdf8', 'stop-opacity': 0 }));
    defs.append(sgl);
    g.append(defs);
    for (let x = 125; x < BASE_W; x += 125) g.append(svg('line', { class: 'grat', x1: x, y1: 0, x2: x, y2: BASE_H }));
    for (let y = 130; y < BASE_H; y += 130) g.append(svg('line', { class: 'grat', x1: 0, y1: y, x2: BASE_W, y2: y }));
    const land = svg('g', { class: 'landlayer' });
    for (const d of WORLD) land.append(svg('path', { class: 'land', d, 'fill-rule': 'evenodd' }));
    g.append(land);
    return g;
  }

  function renderMap() {
    const g = G();
    const map = $('#map');
    map.innerHTML = '';
    map.append(worldLayer());
    const wrapSet = new Set(D.wrapEdges.map(([a, b]) => [a, b].sort().join('|')));

    // edges
    const drawn = new Set();
    for (const c of D.cities) {
      for (const n of Game.ADJ[c.name]) {
        const key = [c.name, n].sort().join('|');
        if (drawn.has(key)) continue;
        drawn.add(key);
        const a = Game.CITY[c.name], b = Game.CITY[n];
        if (wrapSet.has(key)) {
          const [west, east] = a.x < b.x ? [a, b] : [b, a];
          const midY = (a.y + b.y) / 2;
          map.append(svg('line', { class: 'edge wrap', x1: west.x, y1: west.y, x2: 0, y2: midY }));
          map.append(svg('line', { class: 'edge wrap', x1: east.x, y1: east.y, x2: 1500, y2: midY }));
        } else {
          map.append(svg('line', { class: 'edge', x1: a.x, y1: a.y, x2: b.x, y2: b.y }));
        }
      }
    }
    // cities
    for (const c of D.cities) {
      const node = svg('g', {
        class: 'cityNode',
        onclick: ev => { ev.stopPropagation(); onCityClick(c.name, ev); },
      });
      // infection-intensity halo: invisible at 0 cubes, blazing at 3
      for (const col of COLORS) {
        const n = g.cityCubes[c.name][col];
        if (!n) continue;
        node.append(svg('circle', {
          class: 'infglow' + (n === 3 ? ' hot' : ''),
          cx: c.x, cy: c.y, r: 22 + n * 11,
          fill: `url(#glow-${col})`, opacity: [0, 0.3, 0.55, 0.95][n],
        }));
      }
      // current player's location ring
      if (g.players[g.current].location === c.name && !g.result) {
        node.append(svg('circle', { class: 'pulse', cx: c.x, cy: c.y, r: 20, fill: 'none', stroke: '#38bdf8', 'stroke-width': 3 }));
      }
      if (ui.selectedCity === c.name) {
        node.append(svg('circle', { cx: c.x, cy: c.y, r: 15, fill: 'none', stroke: '#ffffff', 'stroke-width': 2 }));
      }
      node.append(svg('circle', {
        class: 'cityCircle', cx: c.x, cy: c.y, r: 10,
        fill: `url(#cg-${c.color})`, stroke: c.color === 'black' ? '#cbd5e1' : '#0a101f', 'stroke-width': 1.8,
      }));
      node.append(svg('text', { class: 'citylabel', x: c.x, y: c.y + 24, 'text-anchor': 'middle' },
        `${EMOJI[c.name] ? EMOJI[c.name] + ' ' : ''}${c.name}`));

      // research station: a glowing lab building with a medical cross
      if (g.stations.includes(c.name)) {
        const sx = c.x - 24, sy = c.y - 2;
        const st = svg('g', { class: 'station' });
        st.append(svg('circle', { class: 'stationglow', cx: sx, cy: sy, r: 19, fill: 'url(#glow-station)' }));
        st.append(svg('path', {
          class: 'stationicon',
          d: `M ${sx - 9} ${sy + 8} h 18 v -12 l -9 -8 l -9 8 z`,
          fill: 'url(#stationg)', stroke: '#0e4f7a', 'stroke-width': 1.6, 'stroke-linejoin': 'round',
        }));
        st.append(svg('path', {
          d: `M ${sx - 1.8} ${sy - 3} h 3.6 v 3.2 h 3.2 v 3.6 h -3.2 v 3.2 h -3.6 v -3.2 h -3.2 v -3.6 h 3.2 z`,
          fill: '#0891b2', style: 'pointer-events:none',
        }));
        node.append(st);
      }
      // cubes: one badge per color present
      const present = COLORS.filter(col => g.cityCubes[c.name][col] > 0);
      present.forEach((col, i) => {
        const bx = c.x + (i - (present.length - 1) / 2) * 19;
        const by = c.y - 19;
        node.append(svg('rect', {
          x: bx - 8, y: by - 8, width: 16, height: 16, rx: 4,
          fill: HEX[col], stroke: '#0b1220', 'stroke-width': 1.5,
        }));
        node.append(svg('rect', { // bevel highlight
          x: bx - 6, y: by - 6.5, width: 12, height: 6, rx: 3, fill: '#fff', opacity: 0.22,
          style: 'pointer-events:none',
        }));
        node.append(svg('text', {
          x: bx, y: by + 4, 'text-anchor': 'middle', 'font-size': 11, 'font-weight': 800,
          fill: col === 'yellow' ? '#1c1917' : '#fff',
        }, g.cityCubes[c.name][col]));
      });
      // pawns (board-game style)
      const PAWN = 'M 0 -8 C 2.4 -8 4 -6.4 4 -4.4 C 4 -3 3.2 -1.8 2 -1.2 C 4.4 -0.2 5.4 2.6 5.4 6 L -5.4 6 C -5.4 2.6 -4.4 -0.2 -2 -1.2 C -3.2 -1.8 -4 -3 -4 -4.4 C -4 -6.4 -2.4 -8 0 -8 Z';
      const offsets = [[15, -9], [20, 4], [15, 15], [-17, 12]];
      g.players.forEach((p, i) => {
        if (p.location !== c.name) return;
        const [dx, dy] = offsets[i];
        const isMe = i === g.current && !g.result;
        if (isMe) { // halo under the active player's pawn
          node.append(svg('circle', {
            class: 'pawnhalo', cx: c.x + dx, cy: c.y + dy, r: 14, fill: 'url(#glow-station)',
          }));
        }
        node.append(svg('path', {
          class: 'pawnicon' + (isMe ? ' me' : ''),
          d: PAWN, transform: `translate(${c.x + dx} ${c.y + dy}) scale(${isMe ? 1.8 : 1.45})`,
          fill: ROLE[p.role].color, stroke: isMe ? '#fff' : '#0b1220', 'stroke-width': isMe ? 1.7 : 1.4,
          'stroke-linejoin': 'round',
        }));
        node.append(svg('text', {
          x: c.x + dx, y: c.y + dy + 6, 'text-anchor': 'middle', 'font-size': isMe ? 10 : 9, 'font-weight': 800, fill: '#0b1220',
          style: 'pointer-events:none',
        }, i + 1));
      });
      map.append(node);
    }
    map.onclick = () => { ui.selectedCity = null; renderCityMenu(); renderMap(); };
  }

  function onCityClick(name, ev) {
    if (ui.selectMode) { const m = ui.selectMode; ui.selectMode = null; m.onPick(name); return; }
    if (G().phase !== 'actions' || G().result) return;
    const rect = $('#mapwrap').getBoundingClientRect();
    ui.lastCityClick = { px: ev.clientX - rect.left, py: ev.clientY - rect.top };
    ui.selectedCity = ui.selectedCity === name ? null : name;
    renderMap();
    renderCityMenu();
  }

  function renderCityMenu() {
    const g = G();
    const menu = $('#citymenu');
    const name = ui.selectedCity;
    if (!name || g.phase !== 'actions' || g.result) { menu.hidden = true; return; }
    menu.hidden = false;
    menu.innerHTML = '';
    const city = Game.CITY[name];
    const me = g.players[g.current];
    if (ui.pawnSel == null || me.role !== 'Dispatcher') ui.pawnSel = g.current;

    menu.append(el('button', { class: 'closex', onclick: () => { ui.selectedCity = null; renderCityMenu(); renderMap(); } }, '✕'));
    menu.append(el('h3', {},
      el('span', { class: 'cubedot', style: `background:${HEX[city.color]};width:12px;height:12px;border-radius:50%` }),
      `${EMOJI[name] ? EMOJI[name] + ' ' : ''}${name}`));
    const cubeTxt = COLORS.filter(c => g.cityCubes[name][c] > 0).map(c => `${g.cityCubes[name][c]} ${c}`).join(', ') || 'no cubes';
    menu.append(el('div', { class: 'menuline' },
      cubeTxt + (g.stations.includes(name) ? ' · research station' : '')));

    if (me.role === 'Dispatcher') {
      const sel = el('select', { style: 'width:100%;margin-bottom:4px' });
      g.players.forEach((p, i) => sel.append(el('option', { value: i }, `Move: ${p.name} (${p.role})`)));
      sel.value = ui.pawnSel;
      sel.onchange = () => { ui.pawnSel = +sel.value; renderCityMenu(); };
      menu.append(sel);
    }

    const pawnIdx = ui.pawnSel;
    const opts = Game.moveOptions(pawnIdx, name);
    if (g.players[pawnIdx].location === name) {
      menu.append(el('div', { class: 'menuline' }, `${g.players[pawnIdx].name} is here.`));
    } else if (!opts.length) {
      menu.append(el('div', { class: 'menuline' }, 'No way to move there (1 action). Fly using a city card, drive to a connected city, or shuttle between stations.'));
    }
    for (const o of opts) {
      menu.append(el('button', {
        onclick: () => {
          if (o.type === 'opex') { pickOpexCard(name); return; }
          const from = g.players[pawnIdx].location;
          if (act(() => Game.performMove(pawnIdx, o.type, name))) {
            sfx('move');
            cityPulse(name, '#38bdf8');
            if (o.type === 'drive') animateDrive(from, name); // a car for the road
            else animateFlight(from, name); // a plane for every flight
            const cc = Game.CITY[name];
            animateViewTo(cc.x, cc.y, Math.min(view.w, 980)); // glide in on the pawn
          }
        },
      }, o.label));
    }
    // position near click
    const wrap = $('#mapwrap').getBoundingClientRect();
    let x = (ui.lastCityClick ? ui.lastCityClick.px : 40) + 14;
    let y = (ui.lastCityClick ? ui.lastCityClick.py : 40) - 20;
    x = Math.min(x, wrap.width - 266); y = Math.max(8, Math.min(y, wrap.height - 240));
    menu.style.left = x + 'px'; menu.style.top = y + 'px';
  }

  function pickOpexCard(dest) {
    const g = G();
    const me = g.players[g.current];
    openModal('Operations Flight', dlg => {
      dlg.append(el('p', { class: 'sub' }, `Discard any city card to fly from ${me.location} to ${dest}.`));
      const list = el('div', { class: 'list' });
      me.hand.forEach((c, i) => {
        if (c.type !== 'city') return;
        list.append(el('button', {
          onclick: () => {
            closeModal();
            const from = g.players[g.current].location;
            if (act(() => Game.performMove(g.current, 'opex', dest, i))) {
              sfx('move');
              cityPulse(dest, '#38bdf8');
              animateFlight(from, dest); // operations flight
              const cc = Game.CITY[dest];
              animateViewTo(cc.x, cc.y, Math.min(view.w, 980));
            }
          },
        }, `Discard ${c.city} (${c.color})`));
      });
      dlg.append(list, el('div', { class: 'btnrow' }, el('button', { onclick: closeModal }, 'Cancel')));
    });
  }

  // ================= Sidebar =================

  function renderTurnbox() {
    const g = G();
    const box = $('#turnbox');
    box.innerHTML = '';
    const me = g.players[g.current];
    const pips = el('span', { class: 'pips' });
    for (let i = 0; i < 4; i++) pips.append(el('span', { class: 'pip' + (i < 4 - g.actionsLeft ? ' spent' : '') }));
    box.append(el('div', { class: 'who' },
      el('span', { class: 'rolechip', style: `background:${ROLE[me.role].color}` }, me.role),
      `${me.name}`, pips));
    const phaseText = {
      actions: `Take actions (${g.actionsLeft} left) — click a city to move, or use the buttons below.`,
      draw: `Draw ${g.cardsToDraw} player card${g.cardsToDraw > 1 ? 's' : ''}.`,
      epidemicPause: 'Epidemic in progress…',
      discard: 'Hand limit exceeded — discard required.',
      infect: `Infect cities: flip ${g.infectsLeft} infection card${g.infectsLeft > 1 ? 's' : ''}.`,
      over: 'Game over.',
    }[g.phase];
    box.append(el('div', { class: 'phaseline' }, `Turn ${g.turn} · ${phaseText}`));
  }

  function renderActions() {
    const g = G();
    const box = $('#actionsbox');
    box.innerHTML = '';
    box.append(el('div', { class: 'boxtitle' }, 'Actions'));
    const grid = el('div', { class: 'grid' });
    box.append(grid);
    const me = g.players[g.current];

    if (g.phase === 'actions') {
      const cubesHere = COLORS.filter(c => g.cityCubes[me.location][c] > 0);
      grid.append(el('button', { disabled: !cubesHere.length, onclick: () => doTreat(cubesHere) }, 'Treat Disease'));
      grid.append(el('button', { disabled: g.stations.includes(me.location), onclick: doBuild }, 'Build Station'));
      grid.append(el('button', { onclick: doCure, disabled: !g.stations.includes(me.location) }, 'Discover Cure'));
      grid.append(el('button', {
        disabled: !g.players.some((p, i) => i !== g.current && p.location === me.location),
        onclick: doShare,
      }, 'Share Knowledge'));
      if (me.role === 'Contingency Planner') {
        grid.append(el('button', {
          class: 'wide',
          disabled: !!g.contingency || !g.playerDiscard.some(c => c.type === 'event'),
          onclick: doContingency,
        }, g.contingency ? `Stored: ${g.contingency}` : 'Retrieve Event Card'));
      }
      grid.append(el('button', {
        class: 'wide', onclick: () => { if (act(() => Game.pass())) sfx('click'); },
      }, `End Actions (forfeit ${g.actionsLeft})`));
      grid.append(el('button', {
        class: 'wide', disabled: !ui.undoStack.length,
        onclick: () => { Game.restore(ui.undoStack.pop()); ui.selectedCity = null; sfx('click'); refresh(); },
      }, '↩ Undo Action'));
    } else if (g.phase === 'draw') {
      const drawn = g.lastDrawn.filter(c => c.type !== 'epidemic');
      if (drawn.length) {
        grid.append(el('div', { class: 'wide', style: 'grid-column:1/-1;font-size:12px;color:var(--dim)' },
          'Drawn: ', drawn.map(c => cardChip(c)).flat()));
      }
      grid.append(el('button', {
        class: 'primary wide', onclick: () => {
          let card;
          const logMark = G().log.length;
          run(() => { card = Game.drawPlayerCard(); });
          if (card) {
            sfx(card.type === 'epidemic' ? 'epidemic' : 'draw');
            animatePlayerDraw(card);
            animateOutbreaks(logMark);
          }
        },
      }, `Draw Player Card (${g.cardsToDraw} left)`));
    } else if (g.phase === 'infect') {
      grid.append(el('button', {
        class: 'primary wide', onclick: () => {
          let card;
          const logMark = G().log.length;
          run(() => { card = Game.flipInfectionCard(); });
          if (card) {
            sfx('infect');
            animateInfection(card);
            animateOutbreaks(logMark);
          }
        },
      }, `Flip Infection Card (${g.infectsLeft} left)`));
    } else {
      grid.append(el('div', { style: 'grid-column:1/-1;font-size:12px;color:var(--dim)' }, 'See dialog…'));
    }
  }

  // Only one card-info popover open at a time; any outside click dismisses it.
  let openTip = null;
  function closeTip() {
    if (openTip) { openTip.classList.remove('open'); openTip = null; }
  }
  document.addEventListener('click', closeTip);

  // Uniform card chip with an ⓘ button that opens a floating description
  // popover (positioned fixed via JS so the sidebar can't clip it).
  function cardChip(card, opts) {
    opts = opts || {};
    const isEvent = card.type === 'event';
    const label = isEvent ? card.event
      : `${EMOJI[card.city] ? EMOJI[card.city] + ' ' : ''}${card.city}`;
    const desc = isEvent ? EVENT[card.event].desc
      : `${card.color[0].toUpperCase() + card.color.slice(1)} city card — use it to fly here, ` +
        `charter from ${card.city}, build a station there, or cure ${card.color}.`;
    const chip = el('span', {
      class: `card ${isEvent ? 'event' : card.color}` + (opts.selected ? ' selected' : '') + (opts.onclick ? ' clickable' : ''),
    }, el('span', { class: 'cardname' }, label));
    const tip = el('span', { class: 'cardtip', onclick: ev => ev.stopPropagation() }, desc);
    const fact = !isEvent && (D.cityFacts || {})[card.city];
    if (fact && fact.fact) tip.append(el('span', { class: 'tipfact' }, ` 💡 ${fact.fact}`));
    // tapping the card expands its info — unless this context gives the card
    // its own click action (discarding, selecting cards for a cure, ...)
    chip.onclick = opts.onclick || (ev => {
      ev.stopPropagation();
      if (openTip === tip) { closeTip(); return; }
      closeTip();
      const r = chip.getBoundingClientRect();
      tip.style.left = Math.max(8, Math.min(window.innerWidth - 232, r.left + r.width / 2 - 110)) + 'px';
      tip.classList.add('open');
      // measure after display so the popover sits fully above (or below) the card
      const h = tip.offsetHeight;
      tip.style.top = (r.top - h - 8 < 50 ? r.bottom + 8 : r.top - h - 8) + 'px';
      openTip = tip;
    });
    if (!opts.onclick) chip.classList.add('infotap');
    if (isEvent && opts.onPlay) {
      const play = ev => { ev.stopPropagation(); closeTip(); opts.onPlay(ev); };
      chip.append(el('button', { class: 'playmini', onclick: play, disabled: opts.playDisabled, title: 'Play event' }, '▶'));
      tip.append(el('button', { class: 'play', onclick: play, disabled: opts.playDisabled }, 'Play'));
    }
    chip.append(tip);
    return chip;
  }

  function renderPlayers() {
    const g = G();
    const box = $('#playersbox');
    box.innerHTML = '';
    box.append(el('div', { class: 'boxtitle' }, 'Players'));
    g.players.forEach((p, i) => {
      const pc = el('div', { class: 'playercard' + (i === g.current ? ' active' : '') });
      pc.append(el('div', { class: 'phead' },
        `${i + 1}. ${p.name}`,
        el('span', { class: 'rolechip', style: `background:${ROLE[p.role].color}`, title: ROLE[p.role].desc }, p.role)));
      pc.append(el('div', { class: 'roledesc' }, ROLE[p.role].desc));
      const over = p.hand.length > Game.HAND_LIMIT;
      pc.append(el('div', { class: 'ploc' },
        `📍 ${EMOJI[p.location] ? EMOJI[p.location] + ' ' : ''}${p.location} · `,
        el('span', { class: over ? 'overlimit' : '' },
          `${p.hand.length}/${Game.HAND_LIMIT} cards${over ? ' — discard at end of turn' : ''}`)));
      const hand = el('div', { class: 'hand' });
      p.hand.forEach(c => {
        if (c.type === 'event') {
          hand.append(cardChip(c, {
            onPlay: () => playEventFlow(i, 'hand', c.event),
            playDisabled: !Game.canPlayEvent(c.event),
          }));
        } else hand.append(cardChip(c));
      });
      if (p.role === 'Contingency Planner' && g.contingency) {
        hand.append(cardChip({ type: 'event', event: g.contingency }, {
          onPlay: () => playEventFlow(i, 'contingency', g.contingency),
          playDisabled: !Game.canPlayEvent(g.contingency),
        }));
      }
      pc.append(hand);
      box.append(pc);
    });
  }

  function renderStatus() {
    const g = G();
    const box = $('#statusbox');
    box.innerHTML = '';
    box.append(el('div', { class: 'boxtitle' }, 'Status'));
    const supply = el('div', { class: 'srow' }, el('span', {}, 'Cube supply'),
      el('span', {}, COLORS.map(c => el('span', { style: 'margin-left:8px' },
        el('span', { class: 'cubedot', style: `background:${HEX[c]}` }), `${g.cubeSupply[c]}`))));
    box.append(supply);
    box.append(el('div', { class: 'srow' }, el('span', {}, 'Research stations'),
      el('b', {}, `${g.stations.length}/${Game.MAX_STATIONS}: ${g.stations.join(', ')}`)));
    const recent = g.infectionDiscard.slice(-4).reverse().map(c => c.city).join(', ') || '—';
    box.append(el('div', { class: 'srow' }, el('span', {}, 'Recent infections'), el('span', {}, recent)));
    if (g.oneQuietNight) box.append(el('div', { class: 'srow' }, el('b', { style: 'color:var(--good)' }, '🌙 One Quiet Night active')));
  }

  function renderLog() {
    const g = G();
    const logEl = $('#log');
    logEl.innerHTML = '';
    for (const e of g.log.slice(-120)) {
      logEl.append(el('div', { class: 'entry ' + e.cls }, e.msg));
    }
    logEl.scrollTop = logEl.scrollHeight;
  }

  // ================= Action flows =================

  function doTreat(cubesHere) {
    const loc = G().players[G().current].location;
    const treated = c => {
      const before = G().cityCubes[loc][c];
      if (act(() => Game.treat(c))) {
        sfx('treat');
        cityPulse(loc, '#4ade80');
        floatText(loc, `−${before - G().cityCubes[loc][c]} ${c}`, HEX[c]);
        const cc = Game.CITY[loc];
        animateViewTo(cc.x, cc.y, Math.min(view.w, 1000));
      }
    };
    if (cubesHere.length === 1) { treated(cubesHere[0]); return; }
    openModal('Treat Disease', dlg => {
      dlg.append(el('p', { class: 'sub' }, 'Choose which disease to treat.'));
      const list = el('div', { class: 'list' });
      const g = G(), me = g.players[g.current];
      for (const c of cubesHere) {
        const all = g.cures[c] || me.role === 'Medic';
        list.append(el('button', { onclick: () => { closeModal(); treated(c); } },
          `${c} — remove ${all ? 'ALL' : '1'} (${g.cityCubes[me.location][c]} present)`));
      }
      dlg.append(list, el('div', { class: 'btnrow' }, el('button', { onclick: closeModal }, 'Cancel')));
    });
  }

  function doBuild() {
    const g = G();
    const loc = g.players[g.current].location;
    const built = from => { if (act(() => Game.build(from))) { sfx('build'); cityPulse(loc, '#f8fafc'); } };
    if (g.stations.length < Game.MAX_STATIONS) { built(); return; }
    openModal('Build Research Station', dlg => {
      dlg.append(el('p', { class: 'sub' }, 'All 6 stations are on the board. Choose one to move here.'));
      const list = el('div', { class: 'list' });
      for (const s of g.stations) {
        list.append(el('button', { onclick: () => { closeModal(); built(s); } }, `Move station from ${s}`));
      }
      dlg.append(list, el('div', { class: 'btnrow' }, el('button', { onclick: closeModal }, 'Cancel')));
    });
  }

  function doCure() {
    const g = G(), me = g.players[g.current];
    const need = me.role === 'Scientist' ? 4 : 5;
    const eligible = COLORS.filter(color => !g.cures[color] &&
      me.hand.filter(c => c.type === 'city' && c.color === color).length >= need);
    if (!eligible.length) {
      toast(`You need ${need} city cards of one color (you are ${me.role === 'Scientist' ? 'the Scientist' : 'not the Scientist'}) at a research station.`);
      return;
    }
    openModal('Discover a Cure', dlg => {
      dlg.append(el('p', { class: 'sub' }, `Discard ${need} city cards of one color.`));
      for (const color of eligible) {
        dlg.append(el('h2', { style: `font-size:14px;color:${HEX[color]};margin:10px 0 2px;text-transform:capitalize` }, color));
        const idxs = me.hand.map((c, i) => ({ c, i })).filter(x => x.c.type === 'city' && x.c.color === color).map(x => x.i);
        const selected = new Set(idxs.slice(0, need));
        const pickRow = el('div', { class: 'handpick' });
        function redraw() {
          pickRow.innerHTML = '';
          for (const i of idxs) {
            pickRow.append(cardChip(me.hand[i], {
              selected: selected.has(i),
              onclick: () => { selected.has(i) ? selected.delete(i) : selected.add(i); redraw(); },
            }));
          }
          pickRow.append(el('button', {
            class: 'primary', disabled: selected.size !== need,
            onclick: () => {
              closeModal();
              if (act(() => Game.discoverCure(color, [...selected]))) {
                sfx('cure');
                cureBanner(color);
              }
            },
          }, `Cure ${color} (${selected.size}/${need})`));
        }
        redraw();
        dlg.append(pickRow);
      }
      dlg.append(el('div', { class: 'btnrow' }, el('button', { onclick: closeModal }, 'Cancel')));
    });
  }

  function doShare() {
    const g = G(), cur = g.current, me = g.players[cur];
    const options = [];
    g.players.forEach((p, i) => {
      if (i === cur || p.location !== me.location) return;
      for (const [gi, ti] of [[cur, i], [i, cur]]) {
        const giver = g.players[gi], taker = g.players[ti];
        giver.hand.forEach((c, hi) => {
          if (c.type !== 'city') return;
          if (giver.role === 'Researcher' || c.city === giver.location) {
            options.push({
              label: gi === cur ? `Give ${c.city} to ${taker.name}` : `Take ${c.city} from ${giver.name}`,
              gi, ti, hi,
            });
          }
        });
      }
    });
    if (!options.length) {
      toast('No legal trade: the card must match the city you are both standing in (unless the giver is the Researcher).');
      return;
    }
    openModal('Share Knowledge', dlg => {
      dlg.append(el('p', { class: 'sub' }, 'Transfer one city card between players in the same city.'));
      const list = el('div', { class: 'list' });
      for (const o of options) {
        list.append(el('button', {
          onclick: () => { closeModal(); if (act(() => Game.shareKnowledge(o.gi, o.ti, o.hi))) sfx('share'); },
        }, o.label));
      }
      dlg.append(list, el('div', { class: 'btnrow' }, el('button', { onclick: closeModal }, 'Cancel')));
    });
  }

  function doContingency() {
    const g = G();
    openModal('Retrieve Event Card', dlg => {
      dlg.append(el('p', { class: 'sub' }, 'Take an event card from the player discard pile and store it (1 action).'));
      const list = el('div', { class: 'list' });
      for (const c of g.playerDiscard.filter(c => c.type === 'event')) {
        list.append(el('button', {
          onclick: () => { closeModal(); if (act(() => Game.contingencyTake(c.event))) sfx('event'); },
        }, `${c.event} — ${EVENT[c.event].desc}`));
      }
      dlg.append(list, el('div', { class: 'btnrow' }, el('button', { onclick: closeModal }, 'Cancel')));
    });
  }

  // ================= Event flows =================

  function playEventFlow(playerIdx, source, name) {
    const g = G();
    if (!Game.canPlayEvent(name)) { toast('That event cannot be played right now.'); return; }
    ui.undoStack = []; // events can be played by either player; keep undo simple & honest
    closeModal();

    if (name === 'One Quiet Night') {
      if (run(() => Game.playEvent(playerIdx, source, name, {}))) sfx('event');
    } else if (name === 'Forecast') {
      ui.forecastOrder = null; // must be cleared BEFORE run(): refresh() seeds it from the new forecast
      if (run(() => Game.playEvent(playerIdx, source, name, {}))) sfx('event');
    } else if (name === 'Resilient Population') {
      openModal('Resilient Population', dlg => {
        dlg.append(el('p', { class: 'sub' }, 'Remove one card from the infection discard pile — that city can never be drawn again (until reshuffled cards run out).'));
        const list = el('div', { class: 'list' });
        g.infectionDiscard.forEach((c, i) => {
          list.append(el('button', {
            onclick: () => { closeModal(); if (run(() => Game.playEvent(playerIdx, source, name, { discardIdx: i }))) { sfx('event'); cityPulse(c.city, '#4ade80'); } },
          }, `Remove ${EMOJI[c.city] ? EMOJI[c.city] + ' ' : ''}${c.city} (${c.color})`));
        });
        if (g.infectionDiscard.length) dlg.append(list);
        else dlg.append(el('p', { class: 'sub' }, 'The infection discard pile is empty.'));
        dlg.append(el('div', { class: 'btnrow' }, el('button', { onclick: closeModal }, 'Cancel')));
      });
    } else if (name === 'Airlift') {
      openModal('Airlift', dlg => {
        dlg.append(el('p', { class: 'sub' }, 'Choose a pawn, then click its destination city on the map.'));
        const list = el('div', { class: 'list' });
        g.players.forEach((p, i) => {
          list.append(el('button', {
            onclick: () => {
              closeModal();
              startSelectMode(`Airlift: click a destination for ${p.name}`, city => {
                const from = G().players[i].location;
                if (run(() => Game.playEvent(playerIdx, source, name, { pawnIdx: i, city }))) { sfx('event'); cityPulse(city, '#4ade80'); animateFlight(from, city); }
              });
            },
          }, `${p.name} (${p.role}) — currently in ${p.location}`));
        });
        dlg.append(list, el('div', { class: 'btnrow' }, el('button', { onclick: closeModal }, 'Cancel')));
      });
    } else if (name === 'Government Grant') {
      startSelectMode('Government Grant: click a city to build a research station', city => {
        const g2 = G();
        if (g2.stations.includes(city)) { toast('A station is already there.'); refresh(); return; }
        if (g2.stations.length >= Game.MAX_STATIONS) {
          openModal('All stations built', dlg => {
            dlg.append(el('p', { class: 'sub' }, `Choose a station to move to ${city}.`));
            const list = el('div', { class: 'list' });
            for (const s of g2.stations) {
              list.append(el('button', {
                onclick: () => { closeModal(); if (run(() => Game.playEvent(playerIdx, source, name, { city, relocateFrom: s }))) { sfx('event'); cityPulse(city, '#f8fafc'); } },
              }, `Move station from ${s}`));
            }
            dlg.append(list, el('div', { class: 'btnrow' }, el('button', { onclick: closeModal }, 'Cancel')));
          });
        } else {
          if (run(() => Game.playEvent(playerIdx, source, name, { city }))) { sfx('event'); cityPulse(city, '#f8fafc'); }
        }
      });
    }
  }

  // Sweeping banner when a new player's turn begins.
  function showTurnBanner() {
    const g = G(), me = g.players[g.current];
    $('#mapwrap').querySelectorAll('.turnbanner').forEach(n => n.remove());
    const b = el('div', { class: 'turnbanner' },
      el('span', { class: 'rolechip', style: `background:${ROLE[me.role].color}` }, me.role),
      el('span', {}, `${me.name}'s turn`));
    $('#mapwrap').append(b);
    sfx('turn');
    setTimeout(() => b.remove(), 2100);
  }

  // City photos for postcards, via the Wikipedia summary API (CORS-friendly),
  // cached in localStorage; the postcard falls back to an emoji scene offline.
  const WIKI_TITLE = { 'Washington': 'Washington, D.C.', 'St. Petersburg': 'Saint Petersburg' };
  const thumbCache = JSON.parse(localStorage.getItem('pandemic-thumbs') || '{}');
  async function cityThumb(name) {
    if (thumbCache[name] !== undefined) return thumbCache[name];
    try {
      const title = WIKI_TITLE[name] || name;
      const r = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
      const j = await r.json();
      thumbCache[name] = (j.thumbnail && j.thumbnail.source) || null;
    } catch (e) {
      return null; // offline: don't cache, retry next time
    }
    localStorage.setItem('pandemic-thumbs', JSON.stringify(thumbCache));
    return thumbCache[name];
  }

  // Postcard reveal for a drawn city card: photo, fun fact, must-see spot.
  function showPostcard(card) {
    const wrap = $('#mapwrap');
    const stack = wrap.querySelectorAll('.postcard').length;
    const f = (D.cityFacts || {})[card.city] || {};
    const img = el('div', { class: 'pcimg' }, el('span', { class: 'pcemoji' }, EMOJI[card.city] || '🏙'));
    const pc = el('div', {
      class: `postcard ${card.color}`, style: `margin-top:${stack * 30}px`,
      onclick: () => pc.remove(),
    },
      img,
      el('div', { class: 'pcbody' },
        el('div', { class: 'pcname' }, `${EMOJI[card.city] || ''} ${card.city}`),
        f.fact ? el('div', { class: 'pcfact' }, `💡 ${f.fact}`) : null,
        f.see ? el('div', { class: 'pcfact' }, `📸 Don't miss: ${f.see}`) : null,
        el('div', { class: 'pcsub' }, `${card.color} city card · tap to dismiss`)));
    wrap.append(pc);
    cityThumb(card.city).then(url => {
      if (url && pc.isConnected) {
        img.style.backgroundImage = `url('${url}')`;
        img.firstChild.hidden = true;
      }
    });
    setTimeout(() => pc.remove(), 5600);
  }

  // Animated reveal of a drawn player card (city, event, or EPIDEMIC).
  function animatePlayerDraw(card) {
    if (card.type === 'city') { showPostcard(card); return; }
    const wrap = $('#mapwrap');
    const stack = wrap.querySelectorAll('.drawflip').length;
    const epi = card.type === 'epidemic';
    const struck = epi ? G().infectionDiscard[G().infectionDiscard.length - 1] : null;
    const cls = epi ? 'epidemic' : 'event';
    const title = epi ? '☣ EPIDEMIC!' : `✨ ${card.event}`;
    const sub = epi ? (struck ? `strikes ${struck.city}` : 'the disease surges') : 'event card';
    const chip = el('div', { class: `drawflip ${cls}`, style: `margin-top:${stack * 86}px` },
      el('div', { class: 'ifname' }, title),
      el('div', { class: 'ifsub' }, sub));
    wrap.append(chip);
    setTimeout(() => chip.remove(), epi ? 2600 : 2000);
    if (struck) epicenter(struck.city);
  }

  // Outbreaks logged since `logMark` play one after another — each blast
  // finishes its city-by-city spread before the next outbreak begins.
  function animateOutbreaks(logMark) {
    const entries = G().log.slice(logMark);
    let at = 800;
    for (const e of entries) {
      const m = e.msg.match(/^OUTBREAK of (\w+) in (.+?)!/);
      if (m) at += outbreakBlast(m[2], m[1], at);
    }
  }

  // A glowing dot races along an edge from one city to another.
  function travelDot(from, to, color, delay, dur) {
    setTimeout(() => {
      const map = $('#map');
      const line = svg('line', {
        class: 'spreadline', x1: from.x, y1: from.y, x2: to.x, y2: to.y,
        style: `stroke:${color}`,
      });
      map.append(line);
      setTimeout(() => line.remove(), dur + 700);
      const dot = svg('circle', { class: 'traveldot', r: 6.5, fill: color, cx: from.x, cy: from.y });
      map.append(dot);
      const t0 = performance.now();
      (function step(now) {
        const t = Math.min(1, (now - t0) / dur);
        dot.setAttribute('cx', from.x + (to.x - from.x) * t);
        dot.setAttribute('cy', from.y + (to.y - from.y) * t);
        if (t < 1 && dot.isConnected) requestAnimationFrame(step);
        else {
          dot.remove();
          const hit = svg('circle', { class: 'actionring', cx: to.x, cy: to.y, style: `stroke:${color}` });
          map.append(hit);
          setTimeout(() => hit.remove(), 1200);
        }
      })(t0);
    }, delay);
  }

  // A swept jet silhouette pointing along +x, centered on the origin.
  const PLANE_PATH = 'M15,0 L-9,-9 L-4,0 L-9,9 Z M-4,0 L-13,-4.5 L-10,0 L-13,4.5 Z';

  // An airplane arcs from one city to another along a drawn-in contrail.
  // Pure flourish for flight-type moves; never touches game state.
  function animateFlight(fromCity, toCity) {
    const a = Game.CITY[fromCity], b = Game.CITY[toCity];
    if (!a || !b || (a.x === b.x && a.y === b.y)) return;
    const map = $('#map');
    const dx = b.x - a.x, dy = b.y - a.y;
    const dist = Math.hypot(dx, dy) || 1;
    const nx = -dy / dist, ny = dx / dist;          // perpendicular, for a gentle arc
    const lift = Math.min(120, dist * 0.2);
    const cx = (a.x + b.x) / 2 + nx * lift, cy = (a.y + b.y) / 2 + ny * lift;

    const trail = svg('path', { class: 'planetrail', d: `M${a.x},${a.y} Q${cx},${cy} ${b.x},${b.y}` });
    map.append(trail);
    const len = trail.getTotalLength();
    trail.style.strokeDasharray = `${len}`;
    trail.style.strokeDashoffset = `${len}`;

    const plane = svg('path', { class: 'planeicon', d: PLANE_PATH });
    map.append(plane);

    const dur = Math.max(650, Math.min(1700, dist * 2));
    const t0 = performance.now();
    (function step(now) {
      const t = Math.min(1, (now - t0) / dur);
      const u = 1 - t;
      const px = u * u * a.x + 2 * u * t * cx + t * t * b.x;
      const py = u * u * a.y + 2 * u * t * cy + t * t * b.y;
      const ang = Math.atan2(2 * u * (cy - a.y) + 2 * t * (b.y - cy),
                             2 * u * (cx - a.x) + 2 * t * (b.x - cx)) * 180 / Math.PI;
      plane.setAttribute('transform', `translate(${px},${py}) rotate(${ang})`);
      trail.style.strokeDashoffset = `${len * (1 - t)}`;
      if (t < 1 && plane.isConnected) requestAnimationFrame(step);
      else {
        plane.remove();
        trail.classList.add('fade');
        setTimeout(() => trail.remove(), 700);
      }
    })(t0);
  }

  // A compact car silhouette pointing along +x, centered on the origin.
  const CAR_PATH = 'M13,3 L13,0 Q13,-2 10,-2 L6,-2 L3,-6 L-5,-6 L-8,-2 L-11,-2 Q-13,-2 -13,0 L-13,3 Z ' +
    'M-7,0.4 a2.6,2.6 0 1,0 0.001,5.2 Z M7,0.4 a2.6,2.6 0 1,0 0.001,5.2 Z';
  // A little ferry pointing along +x: hull, cabin, and funnel.
  const BOAT_PATH = 'M-14,1 L14,1 L9,7 L-10,7 Z M-7,1 L-7,-4 L5,-4 L5,1 Z M-2,-4 L-2,-8 L1,-8 L1,-4 Z';

  // Is this board point over land? Tests the generated coastline polygons that
  // worldLayer() renders, in the same board coordinate space the cities use.
  let landPaths = null;
  function overLand(x, y) {
    if (!landPaths || !landPaths[0] || !landPaths[0].isConnected) {
      landPaths = [...document.querySelectorAll('#map .world .land')];
    }
    const pt = $('#map').createSVGPoint();
    pt.x = x; pt.y = y;
    return landPaths.some(p => p.isPointInFill(pt));
  }

  const WRAP_EDGE = new Set(D.wrapEdges.map(([a, b]) => [a, b].sort().join('|')));

  // Drive vs ferry: a route is a ferry when it wraps around the Pacific or a
  // meaningful stretch of the straight line between the cities is open water.
  function isFerryRoute(fromCity, toCity) {
    if (WRAP_EDGE.has([fromCity, toCity].sort().join('|'))) return true;
    const a = Game.CITY[fromCity], b = Game.CITY[toCity];
    let water = 0;
    for (let i = 1; i <= 7; i++) {
      const t = i / 8;
      if (!overLand(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)) water++;
    }
    return water >= 3;
  }

  // A little car putters down the road between adjacent cities (or a ferry
  // chugs across the water), leaving brief tracks/wake. Pure flourish for
  // drive/ferry moves; never touches game state.
  function animateDrive(fromCity, toCity) {
    const a = Game.CITY[fromCity], b = Game.CITY[toCity];
    if (!a || !b || (a.x === b.x && a.y === b.y)) return;
    const ferry = isFerryRoute(fromCity, toCity);
    const map = $('#map');
    const dx = b.x - a.x, dy = b.y - a.y;
    const dist = Math.hypot(dx, dy) || 1;
    const deg = Math.atan2(dy, dx) * 180 / Math.PI;
    // mirror instead of rotating past vertical, so it never travels on its roof
    const heading = dx < 0 ? `rotate(${deg - 180}) scale(-1,1)` : `rotate(${deg})`;

    const road = svg('line', {
      class: ferry ? 'drivetrail wake' : 'drivetrail',
      x1: a.x, y1: a.y, x2: b.x, y2: b.y,
    });
    map.append(road);
    const vehicle = svg('path', {
      class: ferry ? 'boaticon' : 'caricon',
      d: ferry ? BOAT_PATH : CAR_PATH,
    });
    map.append(vehicle);

    const dur = Math.max(550, Math.min(1500, dist * 3.2));
    const t0 = performance.now();
    (function step(now) {
      const t = Math.min(1, (now - t0) / dur);
      // cars jitter on a bumpy road; boats ride a slow swell and roll a little
      const bob = ferry ? Math.sin(t * Math.PI * 3) * 1.4 : Math.sin(t * Math.PI * 8) * 0.9;
      const roll = ferry ? ` rotate(${Math.sin(t * Math.PI * 4) * 4})` : '';
      vehicle.setAttribute('transform', `translate(${a.x + dx * t},${a.y + dy * t + bob}) ${heading}${roll}`);
      if (t < 1 && vehicle.isConnected) requestAnimationFrame(step);
      else {
        vehicle.remove();
        road.classList.add('fade');
        setTimeout(() => road.remove(), 700);
      }
    })(t0);
  }

  // Outbreak at a city: zoom in, shake, detonate, then send the disease down
  // each edge to its neighbors ONE BY ONE so the spread can be watched.
  // Returns the total duration so chained outbreaks can queue up after it.
  function outbreakBlast(city, color, delay) {
    const c = Game.CITY[city];
    if (!c) return 0;
    const neighbors = Game.ADJ[city];
    const SPREAD_GAP = 480, SPREAD_DUR = 420, LEAD = 950;
    const total = LEAD + neighbors.length * SPREAD_GAP + SPREAD_DUR + 500;
    setTimeout(() => {
      sfx('outbreak');
      animateViewTo(c.x, c.y, 520);
      const wrap = $('#mapwrap');
      wrap.classList.add('shake');
      setTimeout(() => wrap.classList.remove('shake'), 600);
      const map = $('#map');
      for (let i = 0; i < 3; i++) {
        const ring = svg('circle', {
          class: 'shockwave', cx: c.x, cy: c.y,
          style: `stroke:${HEX[color]};animation-delay:${i * 280}ms`,
        });
        map.append(ring);
        setTimeout(() => ring.remove(), 2100 + i * 280);
      }
      const lbl = svg('text', {
        class: 'epilabel', x: c.x, y: c.y - 36, 'text-anchor': 'middle',
        style: `fill:${HEX[color]}`,
      }, `💥 OUTBREAK — ${city}`);
      map.append(lbl);
      setTimeout(() => lbl.remove(), total - delay > 2800 ? total : 2800);
      neighbors.forEach((n, i) => {
        const t = Game.CITY[n];
        travelDot(c, t, HEX[color], LEAD + i * SPREAD_GAP, SPREAD_DUR);
        setTimeout(() => sfx('infect'), LEAD + i * SPREAD_GAP);
      });
    }, delay);
    return total;
  }

  // Epidemic ground zero: zoom in hard, then a huge multi-ring detonation.
  function epicenter(city) {
    const c = Game.CITY[city];
    animateViewTo(c.x, c.y, 440);
    const map = $('#map');
    setTimeout(() => { // detonate once the camera has arrived
      for (let i = 0; i < 4; i++) {
        const ring = svg('circle', {
          class: 'shockwave mega', cx: c.x, cy: c.y,
          style: `animation-delay:${i * 340}ms`,
        });
        map.append(ring);
        setTimeout(() => ring.remove(), 2700 + i * 340);
      }
      const flash = svg('circle', { class: 'epiflash', cx: c.x, cy: c.y, r: 95 });
      map.append(flash);
      setTimeout(() => flash.remove(), 3400);
      const lbl = svg('text', {
        class: 'epilabel', x: c.x, y: c.y - 42, 'text-anchor': 'middle',
        style: 'font-size:30px',
      }, `☣ ${city}`);
      map.append(lbl);
      setTimeout(() => lbl.remove(), 4200);
      const wrap = $('#mapwrap');
      wrap.classList.add('shake');
      setTimeout(() => wrap.classList.remove('shake'), 600);
    }, 650);
  }

  // Animated reveal of a flipped infection card: a flying card chip + pings on the struck city.
  function animateInfection(card) {
    const c = Game.CITY[card.city];
    const wrap = $('#mapwrap');
    const stack = wrap.querySelectorAll('.infectflip').length;
    const chip = el('div', { class: `infectflip ${card.color}`, style: `margin-top:${stack * 86}px` },
      el('div', { class: 'ifname' }, `${EMOJI[card.city] || ''} ${card.city}`),
      el('div', { class: 'ifsub' }, `${card.color} infection`));
    wrap.append(chip);
    setTimeout(() => chip.remove(), 3200);
    animateViewTo(c.x, c.y, Math.min(view.w, 620)); // zoom to the infected city
    const map = $('#map');
    [0, 300, 600].forEach(delay => {
      const ring = svg('circle', {
        class: 'ping', cx: c.x, cy: c.y, r: 12, fill: 'none',
        stroke: HEX[card.color], style: `animation-delay:${delay}ms`,
      });
      map.append(ring);
      setTimeout(() => ring.remove(), 2300 + delay);
    });
    const flash = svg('circle', { class: 'cityflash', cx: c.x, cy: c.y, r: 46, fill: HEX[card.color] });
    map.append(flash);
    setTimeout(() => flash.remove(), 2400);
  }

  function startSelectMode(label, onPick) {
    ui.selectedCity = null;
    ui.selectMode = { label, onPick };
    refresh();
  }

  function renderBanner() {
    const b = $('#banner');
    if (!ui.selectMode) { b.hidden = true; return; }
    b.hidden = false;
    b.innerHTML = '';
    b.append(ui.selectMode.label,
      el('button', { onclick: () => { ui.selectMode = null; refresh(); } }, 'Cancel'));
  }

  // ================= State-driven dialogs =================

  function renderStateModal() {
    const g = G();
    const box = $('#stateModal');
    box.hidden = true;
    box.innerHTML = '';
    box.classList.remove('docked', 'winlay', 'losslay');

    if (g.result) {
      box.hidden = false;
      box.classList.add(g.result.win ? 'winlay' : 'losslay');
      if (!ui.resultPlayed) { ui.resultPlayed = true; sfx(g.result.win ? 'win' : 'lose'); }
      const dlg = el('div', { class: 'dialog gameover' });
      dlg.append(el('div', { class: 'gobig' }, g.result.win ? '🌍' : '☣'));
      dlg.append(el('h2', { class: g.result.win ? 'win' : 'loss' },
        g.result.win ? 'THE WORLD IS SAVED' : 'THE WORLD HAS FALLEN'));
      dlg.append(el('p', { class: 'sub goreason' },
        (g.result.win ? 'Victory: ' : 'Defeat: ') + g.result.reason + '.'));
      const stats = el('div', { class: 'gostats' });
      stats.append(el('div', { class: 'gostat' }, el('b', {}, `${g.turn}`), 'turns'));
      stats.append(el('div', { class: 'gostat' }, el('b', {}, `${g.outbreaks}`), 'outbreaks'));
      stats.append(el('div', { class: 'gostat' }, el('b', {}, `${COLORS.filter(c => g.cures[c]).length}/4`), 'cures found'));
      dlg.append(stats);
      dlg.append(el('div', { class: 'btnrow', style: 'justify-content:center' },
        el('button', { class: 'primary', onclick: () => { localStorage.removeItem(SAVE_KEY); $('#app').hidden = true; showSetup(); } }, 'New Game')));
      box.append(dlg);
      if (g.result.win) {
        const palette = [HEX.blue, HEX.yellow, HEX.red, '#4ade80', '#f8fafc'];
        for (let i = 0; i < 110; i++) {
          box.append(el('span', {
            class: 'confetti',
            style: `left:${Math.random() * 100}%;background:${palette[i % palette.length]};` +
              `width:${6 + Math.random() * 5}px;height:${8 + Math.random() * 7}px;` +
              `animation-duration:${2.6 + Math.random() * 2.6}s;animation-delay:${Math.random() * 2.2}s`,
          }));
        }
      }
      return;
    }

    if (g.forecastPending) {
      box.hidden = false;
      if (!ui.forecastOrder || ui.forecastOrder.length !== g.forecastPending.length) {
        ui.forecastOrder = g.forecastPending.map((_, i) => i);
      }
      const dlg = el('div', { class: 'dialog' });
      dlg.append(el('h2', {}, '🔮 Forecast'));
      dlg.append(el('p', { class: 'sub' }, 'These are the next infection cards, top first. Drag the rows to reorder them, then confirm.'));
      const listBox = el('div');
      let dragFrom = null;
      function redraw() {
        listBox.innerHTML = '';
        ui.forecastOrder.forEach((cardIdx, pos) => {
          const c = g.forecastPending[cardIdx];
          const row = el('div', { class: 'fcrow', draggable: 'true' },
            el('span', { class: 'grip' }, '⠿'),
            el('span', { class: 'pos' }, `${pos + 1}.`),
            cardChip({ type: 'city', city: c.city, color: c.color }),
            el('span', { class: 'fchint' }, pos === 0 ? 'drawn first' : ''));
          row.addEventListener('dragstart', ev => {
            dragFrom = pos;
            ev.dataTransfer.effectAllowed = 'move';
            row.classList.add('dragging');
          });
          row.addEventListener('dragend', () => { dragFrom = null; redraw(); });
          row.addEventListener('dragover', ev => {
            ev.preventDefault();
            if (dragFrom === null || dragFrom === pos) return;
            // reorder live as the row is dragged across others
            const [moved] = ui.forecastOrder.splice(dragFrom, 1);
            ui.forecastOrder.splice(pos, 0, moved);
            dragFrom = pos;
            redraw();
            listBox.children[pos].classList.add('dragging');
          });
          listBox.append(row);
        });
      }
      redraw();
      dlg.append(listBox);
      dlg.append(el('div', { class: 'btnrow' },
        el('button', {
          class: 'primary', onclick: () => {
            const o = ui.forecastOrder || g.forecastPending.map((_, i) => i);
            ui.forecastOrder = null;
            if (run(() => Game.forecastCommit(o))) sfx('click');
          },
        }, 'Confirm order')));
      box.append(dlg);
      return;
    }

    if (g.phase === 'epidemicPause') {
      box.hidden = false;
      box.classList.add('docked'); // keep the map (and the shockwave at ground zero) visible
      const struck = g.infectionDiscard[g.infectionDiscard.length - 1];
      const dlg = el('div', { class: 'dialog epidlg' });
      dlg.append(el('h2', { class: 'epi' }, '☣ EPIDEMIC!'));
      dlg.append(el('p', { class: 'sub' },
        `The infection rate rises to ${Game.infectionRate()}. ${struck.city} is struck from the bottom of the infection deck. ` +
        `Next: the infection discard pile is shuffled and stacked back on top — those cities are coming back.`));
      const rpHolders = [];
      g.players.forEach((p, i) => {
        if (p.hand.some(c => c.type === 'event' && c.event === 'Resilient Population')) rpHolders.push({ i, source: 'hand' });
        if (p.role === 'Contingency Planner' && g.contingency === 'Resilient Population') rpHolders.push({ i, source: 'contingency' });
      });
      const btns = el('div', { class: 'btnrow' });
      for (const h of rpHolders) {
        btns.append(el('button', {
          onclick: () => playEventFlow(h.i, h.source, 'Resilient Population'),
        }, `${g.players[h.i].name}: play Resilient Population now`));
      }
      btns.append(el('button', {
        class: 'primary', onclick: () => { if (run(() => Game.intensify())) sfx('draw'); },
      }, 'Intensify (shuffle discard on top)'));
      dlg.append(btns);
      box.append(dlg);
      return;
    }

    if (g.phase === 'discard') {
      box.hidden = false;
      box.classList.add('docked'); // map stays visible & pannable behind this one
      const pi = g.discardQueue[0];
      const p = g.players[pi];
      const dlg = el('div', { class: 'dialog' });
      dlg.append(el('h2', {}, `${p.name}: hand limit exceeded`));
      dlg.append(el('p', { class: 'sub' }, `Discard down to ${Game.HAND_LIMIT} cards (${p.hand.length} in hand). Click a card to discard it — or play an event instead. You can still pan and zoom the map behind this panel.`));
      const hand = el('div', { class: 'handpick' });
      p.hand.forEach((c, i) => {
        if (c.type === 'event') {
          hand.append(cardChip(c, {
            onclick: () => run(() => Game.discardForLimit(pi, i)),
            onPlay: () => playEventFlow(pi, 'hand', c.event),
            playDisabled: !Game.canPlayEvent(c.event),
          }));
        } else {
          hand.append(cardChip(c, { onclick: () => run(() => Game.discardForLimit(pi, i)) }));
        }
      });
      dlg.append(hand);
      box.append(dlg);
    }
  }

  // ================= Help =================

  function showHelp() {
    openModal('How to play', dlg => {
      const h = (t) => el('h2', { style: 'font-size:14px;margin:12px 0 4px' }, t);
      const p = (t) => el('p', { class: 'sub', style: 'margin:0 0 4px' }, t);
      dlg.append(
        p('Work together. Win by curing all 4 diseases. Lose if: 8 outbreaks occur, a disease runs out of cubes, or the player deck runs out.'),
        h('Your turn'),
        p('1) Take 4 actions. 2) Draw 2 player cards (epidemics resolve immediately). 3) Flip infection cards equal to the infection rate.'),
        h('Actions (1 each)'),
        p('Move — Drive to a connected city; Direct Flight (discard a city card to go there); Charter Flight (discard the card of the city you are IN to go anywhere); Shuttle Flight (between research stations).'),
        p('Treat — remove 1 cube here (all cubes if the disease is cured). Build — discard the card of your current city to place a research station. Share Knowledge — give/take the card matching the city both pawns are in. Discover Cure — at a station, discard 5 city cards of one color.'),
        h('Outbreaks'),
        p('A city never holds more than 3 cubes of a color. A 4th infection causes an outbreak: every connected city gets 1 cube instead — which can chain.'),
        h('Epidemics'),
        p('Increase the infection rate, infect the BOTTOM city of the infection deck with 3 cubes, then shuffle the infection discard pile back on top of the deck.'),
        h('Roles & Events'),
        p('Tap a card or hover a role chip to see its power. House rule: you may hold any number of cards during a turn \u2014 discard down to 7 only at the end of your turn.'),
      );
      dlg.append(el('div', { class: 'btnrow' }, el('button', { class: 'primary', onclick: closeModal }, 'Close')));
    });
  }

  // ================= Generic modal =================

  function openModal(title, build) {
    const box = $('#modal');
    box.hidden = false;
    box.innerHTML = '';
    const dlg = el('div', { class: 'dialog' });
    dlg.append(el('h2', {}, title));
    build(dlg);
    box.append(dlg);
  }
  function closeModal() {
    const box = $('#modal');
    box.hidden = true;
    box.innerHTML = '';
  }

  // ================= News ticker =================
  // The storyline (log entries with cls 'news') scrolls across the bottom of
  // the screen like a broadcast ticker: new headlines enter from the right as
  // they happen, and the most recent ones stay in rotation.

  const TICKER_KEEP = 6;    // headlines kept in rotation
  const TICKER_SPEED = 80;  // px per second

  const ticker = { seen: 0, items: [], ri: 0, x: null, last: 0, raf: 0 };

  function tickerItem(msg) {
    return el('span', { class: 'tickeritem' }, el('span', { class: 'tickersep' }, '✦'), msg);
  }

  function syncTicker() {
    const bar = $('#ticker');
    const g = G();
    if (!g) { bar.hidden = true; return; }
    bar.hidden = false;
    const news = g.log.filter(e => e.cls === 'news').map(e => e.msg.replace(/^📰 /, ''));
    if (news.length < ticker.seen) {
      // New game, undo, or trimmed log: restart from what's there, replaying
      // at most one rotation's worth so a fresh game shows its intro beats.
      ticker.items = []; ticker.ri = 0; ticker.x = null; ticker.raf = 0;
      $('#tickertrack').innerHTML = '';
      ticker.seen = Math.max(0, news.length - TICKER_KEEP);
    }
    const track = $('#tickertrack');
    for (const msg of news.slice(ticker.seen)) {
      ticker.items.push(msg);
      if (ticker.items.length > TICKER_KEEP) ticker.items.shift();
      track.append(tickerItem(msg)); // enters from the right as it happens
    }
    ticker.seen = news.length;
    if (track.children.length && !ticker.raf) {
      if (ticker.x === null) ticker.x = $('#tickerwrap').clientWidth + 20;
      ticker.last = performance.now();
      ticker.raf = requestAnimationFrame(tickerStep);
    }
  }

  function tickerStep(now) {
    const track = $('#tickertrack');
    const wrapW = $('#tickerwrap').clientWidth;
    const dt = Math.min(0.1, (now - ticker.last) / 1000); // clamp background-tab gaps
    ticker.last = now;
    ticker.x -= TICKER_SPEED * dt;
    // Drop headlines that have fully scrolled off the left edge.
    while (track.firstElementChild) {
      const w = track.firstElementChild.getBoundingClientRect().width;
      if (ticker.x + w < -10) { track.firstElementChild.remove(); ticker.x += w; }
      else break;
    }
    // Keep the stream continuous: when the tail nears the right edge, feed in
    // the next headline from the rotation.
    if (ticker.items.length && ticker.x + track.getBoundingClientRect().width < wrapW + 30) {
      track.append(tickerItem(ticker.items[ticker.ri++ % ticker.items.length]));
    }
    track.style.transform = `translateX(${ticker.x}px)`;
    if (track.children.length) ticker.raf = requestAnimationFrame(tickerStep);
    else { ticker.raf = 0; ticker.x = null; }
  }

  // ================= Main refresh =================

  function refresh() {
    const g = G();
    if (!g) return;
    // undo is only honest during the action phase
    if (!['actions', 'discard'].includes(g.phase) || (g.phase === 'discard' && g.afterDiscard === 'infect')) {
      ui.undoStack = [];
    }
    if (g.phase !== 'actions') ui.selectedCity = null;
    renderTopbar();
    renderMap();
    renderCityMenu();
    renderBanner();
    renderTurnbox();
    renderActions();
    renderPlayers();
    renderStatus();
    renderLog();
    syncTicker();
    renderStateModal();
    save();
    // animate turn hand-offs
    const key = `${g.turn}:${g.current}`;
    if (ui.turnKey !== key && g.phase === 'actions' && !g.result) {
      ui.turnKey = key;
      showTurnBanner();
    }
  }

  // ================= Boot =================

  window.addEventListener('error', e => {
    toast('Unexpected error: ' + e.message);
  });

  window.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeModal();
      if (ui.selectMode) { ui.selectMode = null; refresh(); }
      if (ui.selectedCity) { ui.selectedCity = null; renderCityMenu(); renderMap(); }
    }
  });

  initMapControls();

  // Auto-resume: an unfinished game in localStorage picks up exactly where it left off.
  const autosave = localStorage.getItem(SAVE_KEY);
  let resumed = false;
  if (autosave) {
    try {
      const g = Game.load(autosave);
      if (g && g.players && !g.result) {
        $('#app').hidden = false;
        ui.undoStack = [];
        refresh();
        toast('Saved game resumed.');
        resumed = true;
      }
    } catch (e) {
      localStorage.removeItem(SAVE_KEY);
    }
  }
  if (!resumed) showSetup();
})();
