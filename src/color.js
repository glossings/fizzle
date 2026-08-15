import * as THREE from 'three';

// Every color in the API — .material({ color }), .color(), a light's color,
// bg(), fog(), a texture's color/bg — accepts the same four forms:
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
// and three converts sRGB on the way in; textures are display-space end to end
// (see the note on textures.js's own pass-through), so they say so here.

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

// hsl() builds one of those [r, g, b] arrays from the wheel instead of from
// channels: hue in turns (the unit .hue() already rotates by), saturation and
// lightness 0..1. What that buys is a color whose brightness you set and whose
// hue you don't — hsl(rand(), 0.7, 0.5) is a random color at a fixed
// lightness, which per-channel randomness can't express.
const clamp01 = (v) => (v > 1 ? 1 : v < 0 ? 0 : v || 0);

// standard hsl -> rgb, written out rather than borrowed from THREE.Color:
// setHSL() converts into the working space on the way in, and what belongs in
// a color array is the sRGB numbers a hex would have given.
function toRgb(h, s, l, out) {
  h = h - Math.floor(h);                    // wrap, so a hue that counts up spins
  s = clamp01(s);
  l = clamp01(l);
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h * 6) % 2) - 1));
  const m = l - c / 2;
  const seg = Math.floor(h * 6) % 6;
  const [r, g, b] = seg === 0 ? [c, x, 0] : seg === 1 ? [x, c, 0] : seg === 2 ? [0, c, x]
    : seg === 3 ? [0, x, c] : seg === 4 ? [x, 0, c] : [c, 0, x];
  out[0] = r + m; out[1] = g + m; out[2] = b + m;
  return out;
}

// The same wheel with the other vertical axis: v is how bright the *most* lit
// channel gets, so hsv(h, 1, 1) is the vivid hue and white is s = 0 rather than
// l = 1. It's the spelling paint programs use; hsl's is the
// symmetric one, where the vivid hue lives halfway up at l = 0.5. Converted
// rather than written out again — the two describe the same colors.
function toRgbV(h, s, v, out) {
  s = clamp01(s);
  v = clamp01(v);
  const l = v * (1 - s / 2);
  const m = Math.min(l, 1 - l);
  return toRgb(h, m === 0 ? 0 : (v - l) / m, l, out);
}

// Both wheels resolve the same way: a plain array when nothing moves, and one
// fn per channel when something does.
const wheel = (conv, dflt) => (h = 0, s = 0.7, y = dflt, a) => {
  const rgb = [0, 0, 0];
  const dyn = [h, s, y].some((v) => typeof v === 'function');
  if (!dyn) {
    conv(h, s, y, rgb);
    return a == null ? rgb : [...rgb, a];
  }
  // One conversion per t however many channels ask — the array is read
  // component by component, and all three come out of the same math.
  let lastT = NaN;
  const at = (t) => {
    if (t !== lastT) { lastT = t; conv(resolve(h, t), resolve(s, t), resolve(y, t), rgb); }
    return rgb;
  };
  const out = [(t) => at(t)[0], (t) => at(t)[1], (t) => at(t)[2]];
  return a == null ? out : [...out, a];
};

export const hsl = wheel(toRgb, 0.5);
// full value by default: the vivid hue is what hsv(h) should hand back
export const hsv = wheel(toRgbV, 1);

// A CSS string, for the color that ends up on a 2D canvas rather than in a
// uniform (the text() texture). Goes through THREE.Color so an [r, g, b] and a
// hex reach the canvas as the same pixels — hence the linear space, which is
// what the rest of that path already assumes.
const _css = new THREE.Color();
export function cssColor(v, t = 0) {
  setColor(_css, v, t, THREE.LinearSRGBColorSpace);
  const ch = (n) => Math.round(Math.min(1, Math.max(0, n)) * 255);
  return `rgb(${ch(_css.r)}, ${ch(_css.g)}, ${ch(_css.b)})`;
}
