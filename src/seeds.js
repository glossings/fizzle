// Seeds for random calls that weren't given one, so two bare rand()s are
// independent and matching them is the opt-in (reuse the value, or write the
// same seed in both places).
//
// Each seed is the next count under the current key, and every count restarts
// where the code restarts: the sketch's run, each frame, each labeled block,
// each .instance() copy. So the nth rand() in the same place gets the same
// seed every time, and a per-frame call doesn't drift. Adding a rand() re-rolls
// the ones after it in the same place.
//
// Auto seeds sit at 100000 and up, apart from the small seeds people write
// (fieldSeed below is the GPU's version).

import { claimInCopy } from './carry.js';

const BASE = 100000;
const RUN = 1;
const FRAME = 2;

let key = FRAME;
let n = 0;

// two ints in, a well-mixed int out
function mix(a, b) {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ b;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

export function strKey(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

export const autoSeed = () => BASE + (mix(key, n++) % 1000000);

// For fields the GPU draws (noise(), voronoi(), .noise(), .turbulence()): their
// shaders add seed × ~19 to a float32 coordinate, which a large seed would
// coarsen. Whole numbers plus a half, under 200: clear of the seeds people
// write, and far enough apart that two fields don't resemble each other.
export const fieldSeed = () => (mix(key, n++) % 200) + 0.5;

export function resetRunSeeds() { key = RUN; n = 0; }
export function resetFrameSeeds() { key = FRAME; n = 0; }

// fn's random calls counted from zero under their own key
export function seedScope(k, fn) {
  const wasKey = key, wasN = n;
  key = k; n = 0;
  try { return fn(); } finally { key = wasKey; n = wasN; }
}

// an .instance() fn whose copies each count from zero, so copy i's rand()s
// are its own and the same every frame, and so are its stateful signals
// (carry.js: a .smooth() written in the fn keeps its level from frame to frame)
export function seededInstance(fn) {
  const base = autoSeed();
  return (x, i, count, t) => seedScope(mix(base, i), () => claimInCopy(base, i, () => fn(x, i, count, t)));
}
