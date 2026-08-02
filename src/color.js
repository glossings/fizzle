import * as THREE from 'three';

// Every color in the API — .material({ color }), .color(), a light's color,
// bg(), fog(), a TOP's color/bg — accepts the same four forms:
//
//   '#4fd1c5'  ·  'tomato'  ·  0x4fd1c5  ·  [0.31, 0.82, 0.77]
//
// The array is rgb with channels 0..1, and it's the one you can compute:
// each component may itself be a fn of t, so a color can be math rather than
// a literal. [1, 0, 0] and '#ff0000' are the same red.
//
//   .color([t => Math.sin(t) * 0.5 + 0.5, 0.2, audio()])
//
// `space` is what the given numbers already are. The 3D scene works in linear
// and three converts sRGB on the way in; TOPs are display-space end to end
// (see the note on tops.js's own pass-through), so they say so here.

const resolve = (v, t) => (typeof v === 'function' ? v(t) : v);

// True if any part of the color moves — the whole array counts, so a static
// hex and a fixed [r, g, b] both stay off the per-frame path.
export const isDynamicColor = (v) =>
  typeof v === 'function' || (Array.isArray(v) && v.some((c) => typeof c === 'function'));

// Write `v` into an existing THREE.Color. Returns the target.
export function setColor(target, v, t = 0, space = THREE.SRGBColorSpace) {
  v = resolve(v, t);
  if (Array.isArray(v)) {
    return target.setRGB(resolve(v[0], t) || 0, resolve(v[1], t) || 0, resolve(v[2], t) || 0, space);
  }
  if (typeof v === 'number') return target.setHex(v, space);
  if (v !== null && typeof v === 'object') return target.copy(v); // a THREE.Color
  return target.setStyle(String(v), space);
}

export const makeColor = (v, t = 0, space = THREE.SRGBColorSpace) =>
  setColor(new THREE.Color(), v, t, space);

// A CSS string, for the color that ends up on a 2D canvas rather than in a
// uniform (the text() TOP). Goes through THREE.Color so an [r, g, b] and a
// hex reach the canvas as the same pixels — hence the linear space, which is
// what the rest of that path already assumes.
const _css = new THREE.Color();
export function cssColor(v, t = 0) {
  setColor(_css, v, t, THREE.LinearSRGBColorSpace);
  const ch = (n) => Math.round(Math.min(1, Math.max(0, n)) * 255);
  return `rgb(${ch(_css.r)}, ${ch(_css.g)}, ${ch(_css.b)})`;
}
