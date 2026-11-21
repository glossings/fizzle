// geo.walk(): a point wandering a shape's surface, as the three signals
// .position() takes. Bug-like by default: constant speed, the heading turning
// a little at random each tick. jitter adds a random nudge on top of each step.
//
// It steps on a fixed tick from t = 0 and keeps only where it is now, so the
// path is the same on every run: a re-run replays to the current time and the
// walker carries on from where it was, and time going backwards (ctrl+r)
// replays from the start.

import { sig } from './audio.js';
import { warn } from './warn.js';
import { autoSeed } from './seeds.js';
import * as THREE from 'three';

const DT = 1 / 60;
const resolve = (v, t) => (typeof v === 'function' ? v(t) : v);

function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// a pair of independent standard normals (Box-Muller)
function gauss2(rnd) {
  const r = Math.sqrt(-2 * Math.log(1 - rnd()));
  const a = 2 * Math.PI * rnd();
  return [r * Math.cos(a), r * Math.sin(a)];
}

// fold v back inside [-h, h], flipping the heading component it crossed
function bounce(v, h) {
  if (h <= 0) return [0, false];
  let flipped = false;
  for (let i = 0; i < 8 && (v > h || v < -h); i++) {
    v = v > h ? 2 * h - v : -2 * h - v;
    flipped = !flipped;
  }
  return [Math.max(-h, Math.min(h, v)), flipped];
}

export function walkOn(geo, o = {}) {
  const { speed = 0.5, turn = 1, jitter = 0 } = o;
  const seed = o.seed ?? autoSeed();
  if (geo.type !== 'plane') {
    warn(`walk: only plane() can be walked so far, not ${geo.type}() — standing at its center`);
  }
  const flat = geo.type === 'plane';
  let rnd, x, y, heading, k, px, py;
  const reset = (t) => {
    rnd = mulberry32((Number(seed) || 0) * 0x9e3779b1 + 0x51ed);
    const [hw, hh] = half(t);
    x = flat ? (rnd() * 2 - 1) * hw : 0;
    y = flat ? (rnd() * 2 - 1) * hh : 0;
    heading = rnd() * Math.PI * 2;
    k = 0;
    px = x; py = y;
  };
  const half = (t) => [resolve(geo.opts.width ?? 10, t) / 2, resolve(geo.opts.height ?? 10, t) / 2];
  const step = () => {
    const t = k * DT;
    const [hw, hh] = half(t);
    const [g0, g1] = gauss2(rnd);
    const [g2] = gauss2(rnd);
    const s = Number(resolve(speed, t)) || 0;
    const j = Number(resolve(jitter, t)) || 0;
    heading += (Number(resolve(turn, t)) || 0) * Math.sqrt(DT) * g0;
    px = x; py = y;
    let fx, fy;
    [x, fx] = bounce(x + s * DT * Math.cos(heading) + j * Math.sqrt(DT) * g1, hw);
    [y, fy] = bounce(y + s * DT * Math.sin(heading) + j * Math.sqrt(DT) * g2, hh);
    if (fx) heading = Math.PI - heading;
    if (fy) heading = -heading;
    k++;
  };

  const p = new THREE.Vector3();
  let at = null;
  let out = [0, 0, 0];
  const ev = (t) => {
    if (at === t) return out;
    at = t;
    const want = Math.max(0, Math.floor(t / DT)) + 1;
    if (rnd === undefined || want < k) reset(t);
    if (flat) while (k < want) step();
    // between ticks, so motion is as smooth as the display rather than the tick
    const f = Math.min(1, Math.max(0, t / DT - (k - 1)));
    p.set(px + (x - px) * f, py + (y - py) * f, 0);
    const m = geo._xform();
    if (m) p.applyMatrix4(m);
    out = [p.x, p.y, p.z];
    return out;
  };
  return [sig((t) => ev(t)[0]), sig((t) => ev(t)[1]), sig((t) => ev(t)[2])];
}
