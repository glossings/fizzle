// Named audio bands, configured in the audio manager (ctrl+a) and read in
// sketches through band(). Each band is a region of the input spectrum plus a
// pair of meter anchors; 'level' is the mono mix with anchors of its own. The
// anchors normalize: raw values at or below lo read 0, at or above hi read 1,
// between them a 0..1 ramp — so a sketch sees the same 0..1 sweep whatever
// the track's actual loudness.
//
// The store is module state read live by every band() signal, so a drag in
// the manager reaches a running sketch on the next frame.

import { warn } from './warn.js';

const LS_BANDS = 'td-audio-bands';

const DEFAULT = () => ({
  level: { lo: 0, hi: 1, sm: 0, auto: false },
  bands: [{ name: '1', from: 30, to: 160, lo: 0, hi: 1, sm: 0, auto: false }],
});

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(LS_BANDS));
    if (s && s.level && Array.isArray(s.bands)) return s;
  } catch { /* unreadable — start over */ }
  return DEFAULT();
}

export const bandStore = load();

export const saveBands = () => localStorage.setItem(LS_BANDS, JSON.stringify(bandStore));

export const BAND_NAME_RULE = 'letters, digits, - and _';
export const bandNameOk = (name) =>
  /^[\w-]+$/.test(name) && name !== 'level' && !bandStore.bands.some((b) => b.name === name);

// next free number, so deleting 1 doesn't make a second 2
export function addBand() {
  let n = 1;
  while (bandStore.bands.some((b) => b.name === String(n))) n++;
  const b = { name: String(n), from: 200, to: 2000, lo: 0, hi: 1, sm: 0, auto: false };
  bandStore.bands.push(b);
  saveBands();
  return b;
}

export function removeBand(band) {
  const i = bandStore.bands.indexOf(band);
  if (i >= 0) bandStore.bands.splice(i, 1);
  run.delete(band);
  saveBands();
}

// anchors -> 0..1: clip below lo and above hi, ramp between
export function normalize(raw, { lo, hi }) {
  if (hi <= lo) return raw >= hi ? 1 : 0;
  return Math.min(1, Math.max(0, (raw - lo) / (hi - lo)));
}

export const bandRaw = (ae, b) => ae.band(b.from, b.to);

// Per-band runtime: the smoothed value the meters draw and band() normalizes.
// Keyed 'level' or the band object; stepped once per frame by updateBands so
// every reader sees the same value and smoothing can't double-step.
const run = new Map();
let stamp = 0;
let lastSave = 0;

export const smoothed = (key) => run.get(key)?.v ?? 0;

const ease = (dt, tau) => (tau > 0 ? 1 - Math.exp(-dt / tau) : 1);

// One step per rendered frame, driven alongside ae.update() — smoothing and
// auto anchors keep going with the manager closed. Wall-clock dt: the sketch
// clock freezes on pause but the manager's meters stay live.
export function updateBands(ae) {
  const now = performance.now() / 1000;
  const dt = stamp ? Math.min(now - stamp, 0.25) : 0;
  stamp = now;
  let dirty = false;
  // Auto anchors aim at the bounds of the whole song, not of the moment: an
  // anchor snaps outward the instant the value passes it, but creeps inward
  // only toward the extremes of the last minute, on a slow clock. A quiet
  // passage inside those bounds keeps reading quiet — the window narrows once
  // the peak that set it has aged out, which is a change of song rather than
  // a verse.
  const BUCKET = 3, BUCKETS = 20; // that minute, as 3s min/max buckets
  const step = (key, b, raw) => {
    const s = run.get(key) ?? { v: 0, win: [] };
    run.set(key, s);
    s.v += (raw - s.v) * ease(dt, b.sm || 0);
    if (b.auto && ae?.running) {
      if (s.fit == null) { s.fit = 0; s.win = []; } // auto just came on
      const e = Math.floor(now / BUCKET);
      const w = s.win[e % BUCKETS]?.e === e ? s.win[e % BUCKETS] : (s.win[e % BUCKETS] = { e, lo: s.v, hi: s.v });
      w.lo = Math.min(w.lo, s.v);
      w.hi = Math.max(w.hi, s.v);
      let m = Infinity, M = -Infinity;
      for (const k of s.win) {
        // too old (survived a pause), or pure silence — neither gets a vote
        if (!k || k.e <= e - BUCKETS || k.hi <= 0.02) continue;
        m = Math.min(m, k.lo);
        M = Math.max(M, k.hi);
      }
      // While the window fills with its first minute of actual signal, its
      // extremes only ever widen, so the fit can be quick without chasing
      // dynamics — auto visibly grabs the signal when pressed. After that,
      // the slow song clock. Near-silence advances neither: it carries no
      // information, so the previous fit holds until real signal arrives.
      if (M > 0.02) s.fit += dt;
      const tau = s.fit < BUCKET * BUCKETS ? 1 : 30;
      b.hi += s.v > b.hi ? (s.v - b.hi) * ease(dt, 0.05)
        : M > 0.02 ? (M - b.hi) * ease(dt, tau) : 0;
      b.lo += s.v < b.lo ? (s.v - b.lo) * ease(dt, 0.05)
        : M > 0.02 ? (m - b.lo) * ease(dt, tau) : 0;
      const gap = 0.05 - (b.hi - b.lo); // never collapse to a point
      if (gap > 0) {
        b.hi = Math.min(1, b.hi + gap / 2);
        b.lo = Math.max(0, b.hi - 0.05);
      }
      dirty = true;
    } else {
      s.fit = null; // re-enabling auto starts with the quick fit again
    }
  };
  const live = ae?.running;
  step('level', bandStore.level, live ? ae.level : 0);
  for (const b of bandStore.bands) step(b, b, live ? bandRaw(ae, b) : 0);
  // auto moves anchors every frame; persisting that belongs on a slow clock
  if (dirty && now - lastSave > 3) {
    lastSave = now;
    saveBands();
  }
}

// what band(name) reads each frame; the lookup is live so bands added or
// dragged in the manager take effect without a re-run
export function bandValue(ae, name) {
  if (name === 'level') return normalize(smoothed('level'), bandStore.level);
  const b = bandStore.bands.find((x) => x.name === name);
  if (!b) {
    warn(`band: no band named "${name}" — add it in the audio manager (ctrl+a)`);
    return 0;
  }
  return normalize(smoothed(b), b);
}
