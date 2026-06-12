#!/usr/bin/env node
// One-time premium voiceover generator for the news-ticker narration.
//
// Reads the fixed narration lines from the engine (Game.narrationManifest())
// and synthesizes one MP3 per line into audio/narration/<id>.mp3 using the
// ElevenLabs text-to-speech API. The browser UI plays these clips when the
// 🎙 Narrator setting is on (and falls back to the free built-in voice for any
// line that has no clip — e.g. the dynamic situation reports).
//
// It is idempotent: clips that already exist are skipped, so re-runs only pay
// for new or changed lines. Use --force to regenerate everything.
//
// ── Usage ──────────────────────────────────────────────────────────────────
//   export ELEVENLABS_API_KEY=sk_...            # required (get from elevenlabs.io)
//   node tools/generate-narration.mjs           # generate all missing clips
//
//   # Audition a voice on just a few lines before committing to the full run:
//   node tools/generate-narration.mjs --only Tokyo,Sydney,open_0 --force
//
// ── Options ────────────────────────────────────────────────────────────────
//   --force            regenerate clips even if the file already exists
//   --only <a,b,c>     only lines whose id contains any of these substrings
//   --list             print the manifest (id + text) and exit, no API calls
//   --dry              show what would be generated without calling the API
//
// ── Environment ────────────────────────────────────────────────────────────
//   ELEVENLABS_API_KEY   (required) your ElevenLabs API key
//   ELEVENLABS_VOICE     voice name to resolve via the API (default "Adam")
//   ELEVENLABS_VOICE_ID  explicit voice id (overrides ELEVENLABS_VOICE)
//   ELEVENLABS_MODEL     model id (default "eleven_multilingual_v2")
//   ELEVENLABS_FORMAT    output_format (default "mp3_44100_128")
//
// Recommended voices for this game (deep, cinematic, exhilarating):
//   Adam    — deep movie-trailer narrator (default, broadly appropriate)
//   Callum  — intense / gravelly / ominous (scarier)
//   George  — warm British storyteller (more tongue-in-cheek)
// Browse/clone more at https://elevenlabs.io/app/voice-library — pass the name
// via ELEVENLABS_VOICE or the id via ELEVENLABS_VOICE_ID.

import { createRequire } from 'node:module';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const OUT_DIR = join(root, 'audio', 'narration');

// Load the zero-dependency engine to get the single source of truth for lines.
require(join(root, 'js', 'data.js'));
require(join(root, 'js', 'game.js'));
const Game = globalThis.Game;

// ── args ──
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const valOf = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
const FORCE = has('--force');
const LIST = has('--list');
const DRY = has('--dry');
const ONLY = (valOf('--only') || '').split(',').map(s => s.trim()).filter(Boolean);

// ── config ──
const API_KEY = process.env.ELEVENLABS_API_KEY;
const VOICE_NAME = process.env.ELEVENLABS_VOICE || 'Adam';
let VOICE_ID = process.env.ELEVENLABS_VOICE_ID || '';
const MODEL = process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2';
const FORMAT = process.env.ELEVENLABS_FORMAT || 'mp3_44100_128';
// Well-known default premade voice ids (used only as a last-resort fallback if
// the name can't be resolved via the API; resolution by name is preferred).
const KNOWN = { adam: 'pNInz6obpgDQGcFmaJgB', callum: 'N2lVS1w4EtoT3dr4eOWO', george: 'JBFqnCBsd6RMkjVDRZzb' };
// Delivery tuned for dramatic, exhilarating narration: lower stability = more
// expressive variation; higher style = more performance.
const VOICE_SETTINGS = {
  stability: numEnv('ELEVENLABS_STABILITY', 0.35),
  similarity_boost: numEnv('ELEVENLABS_SIMILARITY', 0.8),
  style: numEnv('ELEVENLABS_STYLE', 0.6),
  use_speaker_boost: true,
};
function numEnv(k, d) { const v = parseFloat(process.env[k]); return Number.isFinite(v) ? v : d; }

const manifest = Game.narrationManifest()
  .filter(e => !ONLY.length || ONLY.some(s => e.id.toLowerCase().includes(s.toLowerCase())));

if (LIST) {
  for (const e of manifest) console.log(`${e.id}\n  ${e.text}\n`);
  console.log(`${manifest.length} lines, ${manifest.reduce((n, e) => n + e.text.length, 0)} characters.`);
  process.exit(0);
}

const fileExists = (p) => access(p).then(() => true, () => false);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Resolve a voice name → id via the ElevenLabs API (so we don't depend on
// hardcoded ids that may drift). Falls back to the known-id table.
async function resolveVoiceId() {
  if (VOICE_ID) return VOICE_ID;
  try {
    const res = await fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': API_KEY } });
    if (res.ok) {
      const { voices = [] } = await res.json();
      const match = voices.find(v => v.name?.toLowerCase() === VOICE_NAME.toLowerCase());
      if (match) return match.voice_id;
      console.warn(`! Voice "${VOICE_NAME}" not found in your account's voice list.`);
      const sample = voices.slice(0, 12).map(v => v.name).join(', ');
      if (sample) console.warn(`  Available: ${sample}${voices.length > 12 ? ', …' : ''}`);
    }
  } catch (e) { console.warn('! Could not query voices:', e.message); }
  const fb = KNOWN[VOICE_NAME.toLowerCase()];
  if (fb) { console.warn(`  Falling back to known id for "${VOICE_NAME}".`); return fb; }
  throw new Error(`Cannot resolve a voice. Set ELEVENLABS_VOICE_ID, or use a voice name present in your account (ELEVENLABS_VOICE).`);
}

async function synth(text) {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=${FORMAT}`;
  const body = JSON.stringify({ text, model_id: MODEL, voice_settings: VOICE_SETTINGS });
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'xi-api-key': API_KEY, 'content-type': 'application/json', accept: 'audio/mpeg' },
      body,
    });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    if (res.status === 429 || res.status >= 500) {
      const wait = 1500 * attempt;
      console.warn(`  rate-limited/${res.status}, retrying in ${wait}ms…`);
      await sleep(wait);
      continue;
    }
    throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  throw new Error('giving up after repeated rate-limit/server errors');
}

async function main() {
  const totalChars = manifest.reduce((n, e) => n + e.text.length, 0);
  console.log(`Narration manifest: ${manifest.length} lines, ${totalChars} characters.`);

  if (DRY) {
    let would = 0;
    for (const e of manifest) {
      const exists = await fileExists(join(OUT_DIR, e.id + '.mp3'));
      if (FORCE || !exists) would++;
    }
    console.log(`[dry run] would generate ${would} clip(s) into ${OUT_DIR} (skip ${manifest.length - would} existing).`);
    return;
  }

  if (!API_KEY) {
    console.error('ERROR: set ELEVENLABS_API_KEY (or use --dry / --list). See the header of this file.');
    process.exit(1);
  }

  await mkdir(OUT_DIR, { recursive: true });
  VOICE_ID = await resolveVoiceId();
  console.log(`Voice: ${VOICE_NAME} (${VOICE_ID}) · model ${MODEL} · format ${FORMAT}`);
  console.log(`Output: ${OUT_DIR}\n`);

  let made = 0, skipped = 0, failed = 0, billedChars = 0;
  let i = 0;
  for (const e of manifest) {
    i++;
    const file = join(OUT_DIR, e.id + '.mp3');
    if (!FORCE && await fileExists(file)) { skipped++; console.log(`[${i}/${manifest.length}] ${e.id} … skip (exists)`); continue; }
    try {
      const audio = await synth(e.text);
      await writeFile(file, audio);
      made++; billedChars += e.text.length;
      console.log(`[${i}/${manifest.length}] ${e.id} … ok (${(audio.length / 1024).toFixed(0)} KB)`);
      await sleep(250); // be gentle with the API
    } catch (err) {
      failed++;
      console.error(`[${i}/${manifest.length}] ${e.id} … FAILED: ${err.message}`);
    }
  }

  console.log(`\nDone. generated=${made} skipped=${skipped} failed=${failed} · billed ≈ ${billedChars} characters this run.`);
  if (made) console.log(`Clips are in ${OUT_DIR}. Toggle 🎙 Narrator in-game to hear them.`);
  if (failed) process.exitCode = 1;
}

main().catch(e => { console.error(e); process.exit(1); });
