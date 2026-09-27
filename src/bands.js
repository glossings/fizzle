// Named audio bands, configured in the audio manager (ctrl+a) and read in
// sketches through band(). Each band is a region of the input spectrum plus a
// pair of meter anchors; 'level' is the mono mix with anchors of its own. The
// anchors normalize: raw values at or below lo read 0, at or above hi read 1,
// between them a 0..1 ramp — so a sketch sees the same 0..1 sweep whatever
// the track's actual loudness.
//
// A set of bands lives in one of two places. The manager's own set is this
// machine's mixer: saved in localStorage, read by every sketch that doesn't say
// otherwise, and retuned live for whatever is playing. A sketch that calls
// bands({ ... }) declares a set of its own instead, which travels with its
// source — so a shared link arrives with the tuning its visuals were built on
// rather than landing on whatever the next machine happens to have. A sketch
// reads one set or the other, never a merge of the two.
//
// Either way the store is plain module state read live by every band() signal,
// so a drag in the manager reaches a running sketch on the next frame.

import { warn } from './warn.js';

const LS_BANDS = 'td-audio-bands';

const newBand = (name) => ({ name, from: 200, to: 2000, lo: 0, hi: 1, sm: 0, auto: false });
const newLevel = () => ({ lo: 0, hi: 1, sm: 0, auto: false });

const DEFAULT = () => ({
  level: newLevel(),
  bands: [{ ...newBand('1'), from: 30, to: 160 }],
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
export const bandNameOk = (set, name) =>
  /^[\w-]+$/.test(name) && name !== 'level' && !set.bands.some((b) => b.name === name);

// next free number, so deleting 1 doesn't make a second 2
export function addBand(set) {
  let n = 1;
  while (set.bands.some((b) => b.name === String(n))) n++;
  const b = newBand(String(n));
  set.bands.push(b);
  return b;
}

export function removeBand(set, band) {
  const i = set.bands.indexOf(band);
  if (i >= 0) set.bands.splice(i, 1);
  run.delete(band);
}

// anchors -> 0..1: clip below lo and above hi, ramp between
export function normalize(raw, { lo, hi }) {
  if (hi <= lo) return raw >= hi ? 1 : 0;
  return Math.min(1, Math.max(0, (raw - lo) / (hi - lo)));
}

export const bandRaw = (ae, b) => ae.band(b.from, b.to);

// --- sketch-declared sets --------------------------------------------------

// Sets are kept by the path of the scope that declared them rather than rebuilt
// per run: the smoothing value and the auto fit below are keyed on these
// objects, and a livecoder re-runs constantly. Re-declaring reconciles the
// code's numbers into the live objects band by band, which for an unchanged
// declaration is a no-op — so ctrl+enter can't drop a fit that took a minute of
// music to settle.
const sets = new Map(); // scope path -> { level, bands }
let live = new Set();   // the sets this run declared; the manager's steps regardless

// Bumped on every declaration, and only there: the audio manager rebuilds its
// rows off this, and must not be rebuilt by the anchors auto moves under a drag.
export let bandGen = 0;

export function resetBandSets() { live = new Set(); }
export const dropBandSet = (set) => live.delete(set);

// the set the sketch in the editor declared, if it did — for the completions,
// which have no engine to ask
export const sketchBandSet = () => {
  const s = sets.get('');
  return s && live.has(s) ? s : null;
};

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// An absent lo/hi leaves the live ones alone, which is what lets an auto band
// declare itself without carrying anchors (see bandSpec): the fit it has made
// here survives the re-run. sm and auto are read as declared, absent meaning off.
function applyAnchors(t, o) {
  const lo = num(o?.lo), hi = num(o?.hi);
  if (lo != null) t.lo = clamp01(lo);
  if (hi != null) t.hi = clamp01(hi);
  if (t.hi < t.lo) [t.lo, t.hi] = [t.hi, t.lo];
  t.sm = Math.min(5, Math.max(0, num(o?.sm) ?? 0));
  t.auto = !!o?.auto;
}

export function declareBandSet(path, spec) {
  let set = sets.get(path);
  if (!set) sets.set(path, (set = { level: newLevel(), bands: [] }));
  if (spec && typeof spec === 'object') {
    applyAnchors(set.level, spec.level);
    const kept = [];
    for (const [name, o] of Object.entries(spec)) {
      if (name === 'level') continue;
      if (!/^[\w-]+$/.test(name)) {
        warn(`bands: "${name}" isn't a usable band name (${BAND_NAME_RULE})`);
        continue;
      }
      const b = set.bands.find((x) => x.name === name) ?? newBand(name);
      const from = num(o?.from), to = num(o?.to);
      if (from != null) b.from = Math.min(20000, Math.max(20, from));
      if (to != null) b.to = Math.min(20000, Math.max(20, to));
      if (b.to <= b.from) b.to = Math.min(20000, b.from * 1.05);
      applyAnchors(b, o);
      kept.push(b);
    }
    for (const b of set.bands) if (!kept.includes(b)) run.delete(b);
    set.bands = kept; // declaration order, which is the order the manager lists
  } else {
    warn('bands({ ... }): takes an object of band names — bands({ kick: { from: 30, to: 160 } })');
  }
  live.add(set);
  bandGen++;
  return set;
}

// What a set serializes to, and so what a shared sketch carries. Auto anchors
// are left out on purpose: they're fitted to whatever is playing into this
// machine, so sending the numbers on would hand the next one a calibration for
// a mix it isn't hearing. The band arrives with auto still on and fits itself
// there instead.
const r3 = (v) => Math.round(v * 1000) / 1000;

export function bandSpec(set) {
  const tail = (b) => ({
    ...(b.auto ? { auto: true } : { lo: r3(b.lo), hi: r3(b.hi) }),
    ...(b.sm ? { sm: r3(b.sm) } : {}),
  });
  const spec = { level: tail(set.level) };
  for (const b of set.bands) spec[b.name] = { from: Math.round(b.from), to: Math.round(b.to), ...tail(b) };
  return spec;
}

// --- per-band runtime -----------------------------------------------------

// The smoothed value the meters draw and band() normalizes, keyed on the
// anchors object it belongs to (a band, or a set's level). Stepped once per
// frame by updateBands so every reader sees the same value and smoothing can't
// double-step.
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
  const LO_BUCKETS = 5; // the bottom anchor's shorter memory: ~15s
  const step = (b, raw, persist) => {
    const s = run.get(b) ?? { v: 0, win: [] };
    run.set(b, s);
    s.v += (raw - s.v) * ease(dt, b.sm || 0);
    if (b.auto && ae?.running) {
      if (s.fit == null) { s.fit = 0; s.win = []; s.floor = s.v; s.quiet = 0; s.below = 0; } // auto just came on
      // Session noise floor: what this band reads when nothing is playing.
      // It follows the value down instantly and creeps up slowly enough that
      // a song can't lift it. "Silence" below means near this floor — an
      // absolute threshold would miss a mic whose room tone sits well above
      // zero on the dB scale.
      s.floor = Math.min(s.v, s.floor + 0.0002 * dt);
      const quiet = s.floor + 0.02;
      // A sustained stretch at the floor is a song boundary. The fade-out
      // that just ended dragged lo down with it (correctly — the fade should
      // read quiet), and the old song's bounds are only a guess about the
      // next one: re-arm the quick fit so the next track calibrates itself
      // in its opening seconds instead of minutes.
      if (s.v <= quiet) {
        if ((s.quiet += dt) > 5 && s.fit !== 0) { s.fit = 0; s.win = []; }
      } else s.quiet = 0;
      const e = Math.floor(now / BUCKET);
      const w = s.win[e % BUCKETS]?.e === e ? s.win[e % BUCKETS] : (s.win[e % BUCKETS] = { e, lo: s.v, hi: s.v });
      w.lo = Math.min(w.lo, s.v);
      w.hi = Math.max(w.hi, s.v);
      // hi aims at the loudest moment of the whole window — the song's peak.
      // lo aims at a low quantile of the low envelope, and only over the last
      // few buckets: the bottom anchor follows the *recent* floor, so when a
      // drop hits, the gap under the signal closes in seconds instead of
      // waiting out the memory of the intro. (The quantile, not the minimum:
      // min–max would hand one quiet dip the whole bottom of the range.)
      let M = -Infinity;
      const los = [];
      for (const k of s.win) {
        // too old (survived a pause), or pure silence — neither gets a vote
        if (!k || k.e <= e - BUCKETS || k.hi <= quiet) continue;
        M = Math.max(M, k.hi);
        if (k.e > e - LO_BUCKETS) los.push(k.lo);
      }
      los.sort((x, y) => x - y);
      const m = los[Math.floor(los.length * 0.25)] ?? Infinity;
      // While the window fills with its first minute of actual signal, its
      // extremes only ever widen, so the fit can be quick without chasing
      // dynamics — auto visibly grabs the signal when pressed. After that,
      // the slow song clock. Near-silence advances neither: it carries no
      // information, so the previous fit holds until real signal arrives.
      const alive = M > quiet;
      if (alive) s.fit += dt;
      const settling = s.fit < BUCKET * BUCKETS;
      b.hi += s.v > b.hi ? (s.v - b.hi) * ease(dt, 0.05)
        : alive ? (M - b.hi) * ease(dt, settling ? 1 : 30) : 0;
      // a dip below lo has to last before it pulls the anchor down: brief
      // troughs between beats clip to 0 instead of ratcheting lo toward the
      // bottom of every dip
      s.below = s.v < b.lo ? s.below + dt : 0;
      b.lo += s.below > 1 ? (s.v - b.lo) * ease(dt, 0.5)
        : alive ? (m - b.lo) * ease(dt, settling ? 1 : 5) : 0;
      const gap = 0.05 - (b.hi - b.lo); // never collapse to a point
      if (gap > 0) {
        b.hi = Math.min(1, b.hi + gap / 2);
        b.lo = Math.max(0, b.hi - 0.05);
      }
      if (persist) dirty = true;
    } else {
      s.fit = null; // re-enabling auto starts with the quick fit again
    }
  };
  const running = ae?.running;
  // persist: only the manager's set has somewhere to be saved to. A sketch
  // set's auto anchors are runtime state by design — bandSpec doesn't carry
  // them, so there's nothing to write and no code to churn.
  const stepSet = (s, persist) => {
    step(s.level, running ? ae.level : 0, persist);
    for (const b of s.bands) step(b, running ? bandRaw(ae, b) : 0, persist);
  };
  stepSet(bandStore, true);
  for (const s of live) if (s !== bandStore) stepSet(s, false);
  // auto moves anchors every frame; persisting that belongs on a slow clock
  if (dirty && now - lastSave > 3) {
    lastSave = now;
    saveBands();
  }
}

// what band(name) reads each frame, from the set the calling scope resolved to
// (engine.bandSetFor). The lookup is live so bands added or dragged in the
// manager take effect without a re-run.
export function bandValue(ae, name, set = bandStore) {
  if (name === 'level') return normalize(smoothed(set.level), set.level);
  const b = set.bands.find((x) => x.name === name);
  if (!b) {
    warn(set === bandStore
      ? `band: no band named "${name}" — add it in the audio manager (ctrl+a)`
      : `band: no band named "${name}" in this sketch's bands({ ... })`);
    return 0;
  }
  return normalize(smoothed(b), b);
}
