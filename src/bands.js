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
  level: { lo: 0, hi: 1 },
  bands: [{ name: '1', from: 30, to: 160, lo: 0, hi: 1 }],
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
  const b = { name: String(n), from: 200, to: 2000, lo: 0, hi: 1 };
  bandStore.bands.push(b);
  saveBands();
  return b;
}

export function removeBand(band) {
  const i = bandStore.bands.indexOf(band);
  if (i >= 0) bandStore.bands.splice(i, 1);
  saveBands();
}

// anchors -> 0..1: clip below lo and above hi, ramp between
export function normalize(raw, { lo, hi }) {
  if (hi <= lo) return raw >= hi ? 1 : 0;
  return Math.min(1, Math.max(0, (raw - lo) / (hi - lo)));
}

export const bandRaw = (ae, b) => ae.band(b.from, b.to);

// what band(name) reads each frame; the lookup is live so bands added or
// dragged in the manager take effect without a re-run
export function bandValue(ae, name) {
  if (name === 'level') return normalize(ae.level, bandStore.level);
  const b = bandStore.bands.find((x) => x.name === name);
  if (!b) {
    warn(`band: no band named "${name}" — add it in the audio manager (ctrl+a)`);
    return 0;
  }
  return normalize(bandRaw(ae, b), b);
}
