import * as THREE from 'three';
import { SNOISE_GLSL } from './noise.js';
import { setColor as writeColor, cssColor } from './color.js';
import { warn, note } from './warn.js';
import { carried, isClaiming } from './carry.js';
import { Bundle, EMPTY_BUNDLE } from './link.js';
import { Blobs, MAX_SLOTS } from './blobs.js';
import { renderFluid, renderFluidView, claimFluidState } from './fluid.js';
import { sig } from './audio.js';
import { normRanges } from './feed.js';
import { site, begin, end, PASS_3D } from './profile.js';

// Texture operators. Each op is a fragment-shader pass rendering into its own
// target; chains form a DAG evaluated once per frame in dependency order.
// `scene()` is the 3D render, `.out()` marks a chain as the display output,
// `input()` is last frame's display output.
// `.out('name')`/`input('name')` route between chains by name: same-frame
// when acyclic, last frame's snapshot when the wiring loops — so a named
// cycle *is* a feedback loop.
//
//   scene()
//     .kaleido(6)
//     .comp(input().transform({ scale: 1.01 }), 'over', 0.9)
//     .bloom({ threshold: 0.6 })
//     .out()

const resolve = (v, t) => (typeof v === 'function' ? v(t) : v);

// A param handed a texture is replaced by a marker (see bindTexParams): the
// shader reads that slot from a texture, so the uniform it would have filled
// isn't in the compiled program. `par` keeps the CPU side on the default
// instead of trying to make a number out of the marker.
const par = (v, d) => (v == null || typeof v.tex === 'number' ? d : v);

// Every periodic generator takes both spellings of the same number: `period` is
// how much of the frame (or, on geometry, how many world units) one cycle spans,
// `freq` is how many fit across it. Neither is the loser — a period reads better
// near 1 and a frequency reads better in the hundreds, and writing `1 / 300` to
// avoid saying `freq` helps nobody. The shaders want the frequency, and a period
// of 0 would hand them Infinity, hence the floor. voronoi's `scale` is the old
// name for its `freq` and still works.
const recip = (n) => 1 / (Math.abs(n) > 1e-5 ? n : 1e-5);
export const reciprocal = (v) => (typeof v === 'function' ? (t) => recip(v(t)) : recip(v));

// period wins when both are named; otherwise the old spelling, then the default
export const periodic = (period, legacy, dflt, t) =>
  resolve(period !== undefined ? reciprocal(period) : legacy ?? dflt, t);

// A color literal has to reach the shader as the numbers it was written as:
// textures work in display space from end to end (that's what the scene
// texture's tonemap pass establishes), and the final pass copies them to the
// canvas
// unencoded. THREE.Color's default set() decodes sRGB into three's linear
// working space, which nothing here re-encodes — so '#4fd1c5' would land on
// screen as (20,164,143) instead of (79,209,197), and differently again from
// the same hex in text(), which is drawn on a 2D canvas. LinearSRGBColorSpace
// means "already in working space": no conversion.
const setColor = (target, v, t) => writeColor(target, v, t, THREE.LinearSRGBColorSpace);

// Alpha convention: buffers hold RGB premultiplied by alpha — "the image over
// nothing" — so an opaque chain (alpha 1 everywhere) is bit-identical to the
// pre-alpha pipeline, resampling passes (blur, transform, delay) are correct
// without special cases, and the display pass needs none either: premultiplied
// RGB over the opaque canvas *is* the image composited on black.
//
// A generator color slot takes the alpha spellings on top of the usual four
// forms: null (or 'transparent') is fully transparent, an [r, g, b, a] array
// and '#rrggbbaa'/'#rgba' hex carry their own alpha. The uniform is a vec4
// premultiplied here, so shader mixes stay in premultiplied space.
const _col4 = new THREE.Color();
const ALPHA_HEX = /^#([0-9a-f]{4}|[0-9a-f]{8})$/i;
function setColor4(target, v, t) {
  v = resolve(v, t);
  if (v == null || v === 'transparent') return target.set(0, 0, 0, 0);
  let a = 1;
  if (Array.isArray(v) && v.length === 4) {
    a = resolve(v[3], t);
    v = v.slice(0, 3);
  } else if (typeof v === 'string' && ALPHA_HEX.test(v)) {
    const hex = v.length === 5 ? [...v.slice(1)].map((c) => c + c).join('') : v.slice(1);
    a = parseInt(hex.slice(6, 8), 16) / 255;
    v = '#' + hex.slice(0, 6);
  }
  setColor(_col4, v, t);
  a = Math.min(1, Math.max(0, Number(a) || 0));
  return target.set(_col4.r * a, _col4.g * a, _col4.b * a, a);
}

// bg (and friends) default per call site, but an explicit null means
// transparent — which ?? would swallow
const orDflt = (v, d) => (v === undefined ? d : v);

// The frame's own pixel grid: resolution()'s numbers when the sketch set them,
// the canvas as displayed otherwise. Neither retina nor quality() moves it,
// unlike the drawing buffer — so a size counted in these stays put when the
// perf dial does.
const frameGrid = (ctx) => {
  const el = ctx.renderer.domElement;
  return ctx.res ?? [el.clientWidth || window.innerWidth, el.clientHeight || window.innerHeight];
};

const lutWarned = new WeakSet();
const lutWarn = (tex, msg) => {
  if (!tex || lutWarned.has(tex)) return;
  lutWarned.add(tex);
  warn(msg);
};

// A plain direction where a map is otherwise expected (.push): [x, y] or
// anything carrying x/y, each component still free to be a fn of t. null when
// the arg isn't one — a chain, a fn of the chain, a bare number.
const asVec2 = (v) => {
  if (v === null || typeof v !== 'object' || v instanceof TextureOp) return null;
  if (Array.isArray(v)) return [v[0] ?? 0, v[1] ?? 0];
  return v.x != null || v.y != null ? [v.x ?? 0, v.y ?? 0] : null;
};

// A per-channel value: one number broadcast to all three, an [r, g, b], or a
// color in any of the forms color.js takes — .mul('#ff00ff') is a tint, and
// without the last branch it would quietly hand the uniform three strings.
// (A hex *number* stays a scalar: .mul(2) has to keep meaning gain.)
const _vecColor = new THREE.Color();
const setVec3 = (target, v, t) => {
  v = resolve(v, t);
  if (Array.isArray(v)) target.set(resolve(v[0], t), resolve(v[1], t), resolve(v[2], t));
  else if (typeof v === 'number') target.set(v, v, v);
  else {
    setColor(_vecColor, v, t); // Vector3 target, Color source — no .copy() between them
    target.set(_vecColor.r, _vecColor.g, _vecColor.b);
  }
};

// JS twin of the chromakey shader's toOklab, for sizing the key's ramps off
// its perceptual saturation. Returns the chroma (length of Oklab a, b).
function oklabChroma(k) {
  const lin = (v) => Math.pow(Math.max(v, 0), 2.2);
  const r = lin(k.x), g = lin(k.y), b = lin(k.z);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return Math.hypot(
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
  );
}

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const HEADER = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tex0;
uniform sampler2D tex1;
uniform sampler2D tex2;
uniform vec2 uTexel;
uniform float uAspect;
uniform float uTime;
// frames and seconds since the last restart (ctrl+r), which is also when the
// buffers blank — so uFrame 0 is the frame everything accumulated is empty on.
// uTime is not reset there: beat() counts bars from it.
uniform float uFrame;
uniform float uDelta;
#define LUMA vec3(0.2126, 0.7152, 0.0722)

// what happens outside [0,1] after a UV transform — 0 clamp, 1 repeat,
// 2 mirror, 3 transparent, 4 polar. Shared by transform and warp.
vec4 wrapSample(sampler2D tex, vec2 p, float mode) {
  // polar: x is an angle, so it comes back around; y is a radius and doesn't
  if (mode > 3.5) p = vec2(fract(p.x), clamp(p.y, 0.0, 1.0));
  else if (mode > 2.5) {
    // transparent, not opaque black: the emptied region comps as a cutout
    if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) return vec4(0.0);
  }
  else if (mode > 1.5) { vec2 m = mod(p, 2.0); p = 1.0 - abs(m - 1.0); }
  else if (mode > 0.5) p = fract(p);
  else p = clamp(p, 0.0, 1.0);
  return texture2D(tex, p);
}
`;

// ---------------------------------------------------------------------------
// shader specs — extras: extra uniform defs (JS value infers GLSL type),
// update(): resolve params (numbers or fns of t) into uniform values

const SPECS = {
  copy: {
    frag: `void main() { gl_FragColor = texture2D(tex0, vUv); }`,
  },

  // depth() — tex0 is the scene's depth attachment (window-space, non-linear).
  // Undo the projection to get eye-space distance in world units, then map it
  // to 0..1 so the result behaves like every other grayscale texture.
  // uMode 0: near→0, far→1. uMode 1: focus→0, ±range→1 (a DOF blur mask).
  depth: {
    extras: { uRange: [0, 20], uCam: [0.01, 500], uFocus: [8, 6], uMode: 0 },
    frag: `
      void main() {
        float d = texture2D(tex0, vUv).x;
        float ndc = d * 2.0 - 1.0;
        float eye = (2.0 * uCam.x * uCam.y) / (uCam.y + uCam.x - ndc * (uCam.y - uCam.x));
        float v = uMode > 0.5
          ? abs(eye - uFocus.x) / max(uFocus.y, 1e-4)
          : (eye - uRange.x) / max(uRange.y - uRange.x, 1e-4);
        gl_FragColor = vec4(vec3(clamp(v, 0.0, 1.0)), 1.0);
      }`,
  },

  // one color, whole frame — the thing to comp, mask or multiply against when
  // what's wanted is a flat wash rather than an image
  constant: {
    extras: { uColor: [1, 1, 1, 1] },
    frag: `void main() { gl_FragColor = uColor; }`,
    update(u, p, t) {
      setColor4(u.uColor.value, orDflt(p.color, '#ffffff'), t);
    },
  },

  // A sweep across the frame (straight, out from center, or around it), read as
  // a 0..1 phase — so the four waveshapes signals apply to a phase apply here
  // too, and a period shorter than the frame is a band pattern. A ramp is
  // beat() in space.
  ramp: {
    extras: { uMode: 0, uColA: [0, 0, 0, 1], uColB: [1, 1, 1, 1], uAngle: 0, uPhase: 0, uFreq: 1, uShape: 0, uRepeat: 0 },
    frag: `
      void main() {
        vec2 p = vUv - 0.5;
        float f;
        if (uMode < 0.5) { vec2 d = vec2(cos(uAngle), sin(uAngle)); f = dot(p, d) + 0.5; }
        else if (uMode < 1.5) { f = length(p * vec2(uAspect, 1.0)) * 2.0; }
        else { f = fract(atan(p.y, p.x) / 6.2831853 + 0.5 + uAngle / 6.2831853); }
        f = f * uFreq + uPhase;
        // a single sweep holds its end colors past the edges (the flat middle a
        // negative phase gives a radial vignette); cycles wrap instead
        f = uRepeat > 0.5 ? fract(f) : clamp(f, 0.0, 1.0);
        if (uShape > 2.5) f = step(0.5, f);
        else if (uShape > 1.5) f = 0.5 - 0.5 * cos(6.2831853 * f);
        else if (uShape > 0.5) f = 1.0 - abs(2.0 * f - 1.0);
        gl_FragColor = mix(uColA, uColB, f);
      }`,
    update(u, p, t) {
      u.uMode.value = { linear: 0, radial: 1, angular: 2 }[p.type ?? 'linear'] ?? 0;
      setColor4(u.uColA.value, orDflt(p.a, '#000000'), t);
      setColor4(u.uColB.value, orDflt(p.b, '#ffffff'), t);
      u.uAngle.value = resolve(p.angle ?? 0, t);
      u.uPhase.value = resolve(p.phase ?? 0, t);
      u.uFreq.value = periodic(p.period, p.freq, 1, t);
      const shapes = { saw: 0, tri: 1, sin: 2, sqr: 3 };
      const shape = p.shape ?? 'saw';
      if (shapes[shape] == null) warn(`ramp: no shape '${shape}' — saw, tri, sin or sqr; showing saw`);
      u.uShape.value = shapes[shape] ?? 0;
      // Naming either key is what asks for a repeating wave, and with it the
      // wrap — so an untouched ramp keeps clamping, which is what the vignettes
      // built on a negative phase rely on.
      u.uRepeat.value = p.period !== undefined || p.freq !== undefined || p.shape !== undefined ? 1 : 0;
    },
  },

  circle: {
    // uThick < 0 is "no thickness named", i.e. a solid disc — which a width of
    // 0 is not: that's a band with nothing left in it, and it draws nothing.
    // The distinction is what lets ring()'s hole grow into its rim and close.
    extras: { uCenter: [0.5, 0.5], uRadius: 0.25, uSoft: 0, uThick: -1, uColA: [1, 1, 1, 1], uColB: [0, 0, 0, 1] },
    // a texture in radius perturbs the rim per pixel: the disc stops being one
    // and becomes whatever blob the map describes
    texParams: { radius: 'uRadius', soft: 'uSoft', center: 'uCenter', thickness: 'uThick' },
    frag: `
      void main() {
        float d = length((vUv - uCenter) * vec2(uAspect, 1.0));
        // read once into locals: a texture-driven param is a fetch, and the
        // #define would otherwise repeat it at every mention.
        // The floor keeps a hard rim antialiased rather than stepped: under
        // half a texel the smoothstep has no pixels left to fade across. d is
        // measured in aspect-corrected space, where y is the unscaled axis, so
        // uTexel.y is the one that means "a pixel" here.
        float r = uRadius, sf = max(uSoft, uTexel.y * 0.5), th = uThick;
        float m = 1.0 - smoothstep(r - sf, r + sf, d);
        // thickness cuts the middle back out, measured in from the rim — and a
        // thickness past the radius puts the inner edge behind the center,
        // where there is nothing left to cut
        if (th >= 0.0) m *= smoothstep(r - th - sf, r - th + sf, d);
        gl_FragColor = mix(uColB, uColA, m);
      }`,
    update(u, p, t) {
      const c = par(p.center, [0.5, 0.5]);
      u.uCenter.value.set(resolve(c[0], t), resolve(c[1], t));
      u.uRadius.value = resolve(par(p.radius, 0.25), t);
      u.uSoft.value = resolve(par(p.soft, 0), t);
      u.uThick.value = resolve(par(p.thickness, -1), t);
      setColor4(u.uColA.value, orDflt(p.color, '#ffffff'), t);
      setColor4(u.uColB.value, orDflt(p.bg, '#000000'), t);
    },
  },

  // circle's rectangular sibling: a rounded-box distance field, so corner,
  // soft and thickness all come along for free. w/h are fractions of the
  // frame per axis (crop's units — the frame-relative masks people build);
  // corner and soft are UV-height units like circle's radius, and rotation
  // happens in aspect-corrected space so a wide rect turns rigidly.
  rect: {
    extras: { uCenter: [0.5, 0.5], uW: 0.5, uH: 0.5, uRot: 0, uCorner: 0, uSoft: 0, uThick: -1, uColA: [1, 1, 1, 1], uColB: [0, 0, 0, 1] },
    texParams: { w: 'uW', h: 'uH', corner: 'uCorner', soft: 'uSoft', thickness: 'uThick', center: 'uCenter', rotate: 'uRot' },
    frag: `
      void main() {
        vec2 p = (vUv - uCenter) * vec2(uAspect, 1.0);
        float rot = uRot;
        float cs = cos(rot), sn = sin(rot);
        p = mat2(cs, sn, -sn, cs) * p;
        vec2 hf = vec2(uW * uAspect, uH) * 0.5;
        // a corner past the short half-side would eat the whole shape
        float r = min(uCorner, min(hf.x, hf.y));
        vec2 q = abs(p) - hf + r;
        float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
        float sf = max(uSoft, uTexel.y * 0.5), th = uThick;
        float m = 1.0 - smoothstep(-sf, sf, d);
        if (th >= 0.0) m *= smoothstep(-th - sf, -th + sf, d);
        gl_FragColor = mix(uColB, uColA, m);
      }`,
    update(u, p, t) {
      const c = par(p.center, [0.5, 0.5]);
      u.uCenter.value.set(resolve(c[0], t), resolve(c[1], t));
      const w = par(p.w, 0.5);
      u.uW.value = resolve(w, t);
      u.uH.value = resolve(par(p.h, w), t);
      u.uRot.value = resolve(par(p.rotate, 0), t);
      u.uCorner.value = resolve(par(p.corner, 0), t);
      u.uSoft.value = resolve(par(p.soft, 0), t);
      u.uThick.value = resolve(par(p.thickness, -1), t);
      setColor4(u.uColA.value, orDflt(p.color, '#ffffff'), t);
      setColor4(u.uColB.value, orDflt(p.bg, '#000000'), t);
    },
  },

  // Every box of a tracker in one picture: each pixel's luma is how many boxes
  // cover it. The count is written raw into the half-float target — past 1.0
  // where boxes pile up — so .threshold(0.5) is the union, .threshold(1.5) the
  // overlaps, and the number itself can drive any per-pixel knob. One pass
  // whatever the tracker's max; boxes are packed into a uniform array by
  // update() each frame, straight off the slots.
  blobBoxes: {
    extras: { uBoxes: new Float32Array(MAX_SLOTS * 4), uN: 0 },
    pre: `uniform vec4 uBoxes[${MAX_SLOTS}];`,
    frag: `
      void main() {
        float n = 0.0;
        for (int i = 0; i < ${MAX_SLOTS}; i++) {
          if (float(i) >= uN) break;
          vec4 b = uBoxes[i];
          vec2 d = abs(vUv - b.xy);
          if (d.x <= b.z && d.y <= b.w) n += 1.0;
        }
        gl_FragColor = vec4(vec3(n), 1.0);
      }`,
    update(u, p, t) {
      const b = p.blobs;
      const arr = u.uBoxes.value;
      const a = b._aspect;
      const pad = Math.max(0, Number(resolve(p.pad, 0)) || 0);
      let k = 0;
      for (let i = 0; i < b.max; i++) {
        const s = b._slot(i);
        if (!s) continue;
        arr[k * 4] = s.x / a + 0.5;
        arr[k * 4 + 1] = s.y + 0.5;
        arr[k * 4 + 2] = (s.w / 2 + pad) / a;
        arr[k * 4 + 3] = s.h / 2 + pad;
        k++;
      }
      u.uN.value = k;
    },
  },

  // A regular n-gon, one vertex up, radius to the vertices — so it converges
  // on circle() as sides climb. star pulls the edge midpoints toward the
  // center (0 leaves them on the edge, 1 collapses the shape to spikes),
  // turning the same n corners into an n-pointed star. The fold takes the
  // pixel into one half-segment; the distance is exact to the edge segment
  // there, so soft and thickness behave like rect's.
  polygon: {
    extras: { uCenter: [0.5, 0.5], uSides: 6, uRadius: 0.25, uRot: 0, uStar: 0, uSoft: 0, uThick: -1, uColA: [1, 1, 1, 1], uColB: [0, 0, 0, 1] },
    texParams: { sides: 'uSides', radius: 'uRadius', star: 'uStar', soft: 'uSoft', thickness: 'uThick', center: 'uCenter', rotate: 'uRot' },
    frag: `
      void main() {
        vec2 p = (vUv - uCenter) * vec2(uAspect, 1.0);
        float n = max(floor(uSides + 0.5), 3.0);
        // the radius floor keeps a zero (or animated-through-zero) radius as
        // "nothing drawn" — at 0 exactly, every edge vector degenerates and
        // sign(0) would grey the whole frame instead
        float r = max(uRadius, 1e-4), sf = max(uSoft, uTexel.y * 0.5), th = uThick;
        float st = clamp(uStar, 0.0, 1.0);
        float an = 3.1415927 / n;
        float a = mod(atan(p.y, p.x) - 1.5707963 - uRot, 2.0 * an) - an;
        vec2 q = length(p) * vec2(cos(a), abs(sin(a)));
        vec2 O = vec2(r, 0.0);
        vec2 e = (1.0 - st) * r * cos(an) * vec2(cos(an), sin(an)) - O;
        vec2 v = q - O;
        // the floor keeps radius 0 (e collapses to a point) at NaN's door —
        // it draws nothing, like circle's
        vec2 dd = v - e * clamp(dot(v, e) / max(dot(e, e), 1e-12), 0.0, 1.0);
        float d = length(dd) * sign(e.y * v.x - e.x * v.y);
        float m = 1.0 - smoothstep(-sf, sf, d);
        if (th >= 0.0) m *= smoothstep(-th - sf, -th + sf, d);
        gl_FragColor = mix(uColB, uColA, m);
      }`,
    update(u, p, t) {
      const c = par(p.center, [0.5, 0.5]);
      u.uCenter.value.set(resolve(c[0], t), resolve(c[1], t));
      u.uSides.value = resolve(par(p.sides, 6), t);
      u.uRadius.value = resolve(par(p.radius, 0.25), t);
      u.uRot.value = resolve(par(p.rotate, 0), t);
      u.uStar.value = resolve(par(p.star, 0), t);
      u.uSoft.value = resolve(par(p.soft, 0), t);
      u.uThick.value = resolve(par(p.thickness, -1), t);
      setColor4(u.uColA.value, orDflt(p.color, '#ffffff'), t);
      setColor4(u.uColB.value, orDflt(p.bg, '#000000'), t);
    },
  },

  // Two colors on a square grid — a mask, a displace source, a floor. Cells
  // are square (aspect-corrected) with a corner at the frame center, and the
  // pattern is integrated over the pixel's footprint rather than
  // point-sampled, so a fine checker greys out instead of shimmering.
  checker: {
    extras: { uFreq: 8, uRot: 0, uColA: [0, 0, 0, 1], uColB: [1, 1, 1, 1] },
    frag: `
      void main() {
        vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
        float cs = cos(uRot), sn = sin(uRot);
        p = mat2(cs, sn, -sn, cs) * p * uFreq;
        // pixel footprint in cell units — the rotation is rigid, so the
        // magnitude survives it and one height-texel measures both axes
        vec2 w = vec2(max(uTexel.y * abs(uFreq), 1e-5));
        vec2 i = 2.0 * (abs(fract((p - 0.5 * w) * 0.5) - 0.5)
                      - abs(fract((p + 0.5 * w) * 0.5) - 0.5)) / w;
        gl_FragColor = mix(uColA, uColB, 0.5 - 0.5 * i.x * i.y);
      }`,
    update(u, p, t) {
      u.uFreq.value = periodic(p.period, p.freq, 8, t);
      u.uRot.value = resolve(p.rotate ?? 0, t);
      setColor4(u.uColA.value, orDflt(p.a, '#000000'), t);
      setColor4(u.uColB.value, orDflt(p.b, '#ffffff'), t);
    },
  },

  noiseGen: {
    extras: { uFreq: 4, uOct: 3, uLac: 2, uGain: 0.5, uSpeed: 0.3, uSeed: 0, uChannels: 1, uColA: [0, 0, 0, 1], uColB: [1, 1, 1, 1] },
    pre: SNOISE_GLSL,
    frag: `
      float fbm2(vec2 p, float zoff) {
        float s = 0.0, a = 1.0, f = 1.0, n = 0.0;
        for (int i = 0; i < 8; i++) {
          if (float(i) >= uOct) break;
          s += a * snoise(vec3(p * f, uTime * uSpeed + uSeed * 19.19 + zoff + float(i) * 7.31));
          n += a; f *= uLac; a *= uGain;
        }
        return clamp((n > 0.0 ? s / n : 0.0) * 0.5 + 0.5, 0.0, 1.0);
      }
      void main() {
        // from the center, so a moving period zooms rather than slides off a corner
        vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0) * uFreq;
        if (uChannels < 1.5) {
          gl_FragColor = mix(uColA, uColB, fbm2(p, 0.0));
        } else {
          // independent fields per channel (seed-offset); unused stay 0
          vec4 c = vec4(0.0, 0.0, 0.0, 1.0);
          c.r = fbm2(p, 0.0);
          c.g = fbm2(p, 101.7);
          if (uChannels > 2.5) c.b = fbm2(p, 203.9);
          if (uChannels > 3.5) c.a = fbm2(p, 307.1);
          gl_FragColor = c;
        }
      }`,
    update(u, p, t) {
      u.uFreq.value = periodic(p.period, p.freq, 4, t);
      u.uOct.value = Math.min(8, Math.max(1, resolve(p.octaves ?? 3, t)));
      u.uLac.value = resolve(p.lacunarity ?? 2, t);
      u.uGain.value = resolve(p.gain ?? 0.5, t);
      u.uSpeed.value = resolve(p.speed ?? 0.3, t);
      u.uSeed.value = resolve(p.seed ?? 0, t);
      u.uChannels.value = Math.min(4, Math.max(1, Math.round(resolve(p.channels ?? 1, t))));
      setColor4(u.uColA.value, orDflt(p.a, '#000000'), t);
      setColor4(u.uColB.value, orDflt(p.b, '#ffffff'), t);
    },
  },

  // Scattered feature points, one per lattice cell, each pixel answering to its
  // nearest. The three modes differ only in the scalar they pull out of that
  // neighborhood — the a→b color mapping is the same for all of them, so any
  // mode is also a usable mask or displace map.
  voronoi: {
    extras: { uScale: 6, uSpeed: 0.3, uBlend: 0, uSeed: 0, uMode: 0, uColA: [0, 0, 0, 1], uColB: [1, 1, 1, 1] },
    // a texture in blend: hard cells where the map is dark, cells melting into
    // each other where it's bright
    texParams: { blend: 'uBlend' },
    frag: `
      vec2 cellPoint(vec2 c) {
        vec2 h = fract(sin(vec2(dot(c, vec2(127.1, 311.7)), dot(c, vec2(269.5, 183.3))) + uSeed * 17.13) * 43758.5453);
        // the drift never leaves the cell, so the 3x3 search still finds the nearest
        return c + 0.5 + 0.5 * sin(uTime * uSpeed + 6.2831853 * h);
      }
      float cellValue(vec2 c) {
        return fract(sin(dot(c, vec2(419.2, 371.9)) + uSeed * 29.7) * 43758.5453);
      }
      void main() {
        vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0) * uScale;
        vec2 base = floor(p);
        // cells and distance are both an exp(-d/blend) weighted mean over the 9
        // neighbors — blend is how far past its own cell a pixel listens. The
        // floor on it keeps the weights out of float underflow, and at that
        // floor the mean is the nearest cell to within a fiftieth of a cell:
        // hard, but antialiased rather than stair-stepped.
        float k = 1.0 / max(uBlend, 0.02);
        float wsum = 0.0, vsum = 0.0, dsum = 0.0;
        float d1 = 8.0, d2 = 8.0;
        for (int j = -1; j <= 1; j++) {
          for (int i = -1; i <= 1; i++) {
            vec2 c = base + vec2(float(i), float(j));
            float d = distance(cellPoint(c), p);
            float w = exp(-k * d);
            wsum += w; vsum += cellValue(c) * w; dsum += d * w;
            if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
          }
        }
        float f;
        if (uMode < 0.5) f = vsum / wsum;
        else if (uMode < 1.5) f = dsum / wsum;
        else f = 1.0 - smoothstep(0.0, max(uBlend, 0.0) + 0.02, d2 - d1);
        gl_FragColor = mix(uColA, uColB, clamp(f, 0.0, 1.0));
      }`,
    update(u, p, t) {
      u.uScale.value = periodic(p.period, p.freq ?? p.scale, 6, t);
      u.uSpeed.value = resolve(p.speed ?? 0.3, t);
      u.uBlend.value = resolve(par(p.blend, 0), t);
      u.uSeed.value = resolve(p.seed ?? 0, t);
      const modes = { cells: 0, distance: 1, edges: 2 };
      const mode = p.mode ?? 'cells';
      if (modes[mode] == null) warn(`voronoi: no mode '${mode}' — cells, distance or edges; showing cells`);
      u.uMode.value = modes[mode] ?? 0;
      setColor4(u.uColA.value, orDflt(p.a, '#000000'), t);
      setColor4(u.uColB.value, orDflt(p.b, '#ffffff'), t);
    },
  },

  mirror: {
    extras: { uAxis: 0, uFlip: 0 },
    // a texture in flip picks which half survives per pixel — the two mirror
    // images interleaved by the map, which reads as shattered glass
    texParams: { flip: 'uFlip' },
    frag: `
      void main() {
        vec2 uv = vUv;
        if (uAxis < 0.5 || uAxis > 1.5)
          uv.x = uFlip > 0.5 ? 0.5 + abs(uv.x - 0.5) : 0.5 - abs(uv.x - 0.5);
        if (uAxis > 0.5)
          uv.y = uFlip > 0.5 ? 0.5 + abs(uv.y - 0.5) : 0.5 - abs(uv.y - 0.5);
        gl_FragColor = texture2D(tex0, uv);
      }`,
    update(u, p) {
      u.uAxis.value = { x: 0, y: 1, both: 2 }[p.axis ?? 'x'] ?? 0;
      u.uFlip.value = par(p.flip, false) ? 1 : 0;
    },
  },

  kaleido: {
    extras: { uSides: 6, uRot: 0 },
    texParams: { sides: 'uSides', rotate: 'uRot' },
    frag: `
      void main() {
        vec2 p = vUv - 0.5;
        p.x *= uAspect;
        float seg = 6.2831853 / max(uSides, 1.0);
        float a = atan(p.y, p.x) + uRot;
        a = abs(mod(a, seg) - seg * 0.5);
        vec2 uv = vec2(cos(a), sin(a)) * length(p);
        uv.x /= uAspect;
        gl_FragColor = texture2D(tex0, clamp(uv + 0.5, 0.0, 1.0));
      }`,
    update(u, p, t) {
      u.uSides.value = resolve(par(p.sides, 6), t);
      u.uRot.value = resolve(par(p.rotate, 0), t);
    },
  },

  // the coordinate change under .radial(): forward resamples the frame into
  // angle (x) × radius (y), inverse reads such a buffer back onto the screen.
  // Radius 1 is the frame *corner* — anything closer in and a round trip would
  // crop the corners off rather than come back where it started.
  //
  // log: y measures log-radius instead, so equal steps of y are equal *ratios*
  // of radius and the space becomes periodic — one period is the factor
  // 1 / min between the inner radius and the corner. Translating y there is a
  // zoom that never lands anywhere, which is what makes .scroll() under it
  // infinite rather than a slide. Nothing inside min is sampled going out, and
  // coming back that disc holds the next period rather than the clamped edge:
  // the picture nests into itself instead of smearing.
  polar: {
    extras: { uInverse: 0, uLog: 0, uMin: 0.25 },
    frag: `
      void main() {
        // linear stops at the frame corner, so a round trip keeps the corners.
        // log stops at the inscribed circle instead: a period magnified into
        // view would otherwise show the clamped smear outside that circle, and
        // past the edge the tiling just carries on outward anyway.
        float rmax = uLog > 0.5 ? 0.5 : 0.5 * length(vec2(uAspect, 1.0));
        if (uInverse > 0.5) {
          vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
          float r = length(p);
          float a = r > 0.0 ? atan(p.y, p.x) : 0.0;   // atan(0, 0) is undefined
          float y = uLog > 0.5
            ? fract(1.0 - log(max(r, 1e-6) / rmax) / log(uMin))
            : r / rmax;
          gl_FragColor = texture2D(tex0, vec2(fract(a / 6.2831853), y));
        } else {
          float a = vUv.x * 6.2831853;
          float r = uLog > 0.5 ? rmax * pow(uMin, 1.0 - vUv.y) : vUv.y * rmax;
          vec2 p = vec2(cos(a), sin(a)) * r;
          gl_FragColor = texture2D(tex0, clamp(p / vec2(uAspect, 1.0) + 0.5, 0.0, 1.0));
        }
      }`,
    update(u, p, t) {
      u.uInverse.value = resolve(par(p.inverse, false), t) ? 1 : 0;
      u.uLog.value = resolve(par(p.log, false), t) ? 1 : 0;
      // 1 would make the period zero-wide and 0 would make it unbounded, so
      // both ends are held off
      u.uMin.value = Math.min(0.99, Math.max(1e-4, resolve(par(p.min, 0.25), t)));
    },
  },

  // edge / slope / normalMap share one gradient pass; only the output encoding
  // differs (magnitude / centered gradient / tangent-space normal)
  neighbor: {
    extras: { uMode: 0, uStrength: 1, uSpread: 1, uCrisp: 0 },
    frag: `
      float lum(vec2 o) { return dot(texture2D(tex0, vUv + o * uTexel * uSpread).rgb, LUMA); }
      void main() {
        float tl = lum(vec2(-1.0,  1.0)), tc = lum(vec2(0.0,  1.0)), tr = lum(vec2(1.0,  1.0));
        float ml = lum(vec2(-1.0,  0.0)),                            mr = lum(vec2(1.0,  0.0));
        float bl = lum(vec2(-1.0, -1.0)), bc = lum(vec2(0.0, -1.0)), br = lum(vec2(1.0, -1.0));
        // Sobel [1,2,1] under crisp, and Scharr's [3,10,3] for crisp
        // slope/normal: ~10x truer gradient *direction* on smooth sources, the
        // only thing those two encode.
        // classic takes [4,13,4] scaled to Sobel's step response — same numbers
        // on a straight edge, but gain flat to 0.02% across edge angle where
        // Sobel's swings 8%. Nothing sees that once, and a feedback loop sees
        // nothing else: the 8% compounds per frame until the loop locks to the
        // texel grid, which is why edge() fed back on itself used to make only
        // horizontal and vertical lines.
        bool crisp = uCrisp > 0.5;
        bool scharr = crisp && uMode > 0.5;
        float kc = scharr ?  3.0 : (crisp ? 1.0 : 0.7619048);    // corner taps
        float km = scharr ? 10.0 : (crisp ? 2.0 : 2.4761905);    // middle tap
        float gx = (kc * tr + km * mr + kc * br) - (kc * tl + km * ml + kc * bl);
        float gy = (kc * tl + km * tc + kc * tr) - (kc * bl + km * bc + kc * br);
        // classic runs the kernel unnormalized — a ~4x-hot magnitude that clips
        // across its whole 3-texel support, and that fat stepped line is the
        // look. crisp divides by the positive weights, so strength 1 is a full
        // black-to-white step and the source's antialiasing survives.
        if (crisp) { float n = 1.0 / (2.0 * kc + km); gx *= n; gy *= n; }
        if (uMode < 0.5) {
          float m = length(vec2(gx, gy)) * uStrength;
          // coverage is the edge, not the source's: no line, no image. The
          // source's own alpha can't serve — a text() glyph body is opaque and
          // edgeless, and carrying it plates letter-shaped holes in whatever
          // the edges get comped onto. rgb stays unclamped, so strength keeps
          // its headroom for .threshold().
          gl_FragColor = vec4(vec3(m), min(m, 1.0));
        } else if (uMode < 1.5) {
          // slope and normal are data maps read straight by a material slot,
          // not pictures to comp: opaque, and their flat baseline isn't 0
          gl_FragColor = vec4(clamp(vec2(gx, gy) * uStrength * 0.5 + 0.5, 0.0, 1.0), 0.5, 1.0);
        } else {
          vec3 nrm = normalize(vec3(-gx * uStrength, -gy * uStrength, 1.0));
          gl_FragColor = vec4(nrm * 0.5 + 0.5, 1.0);
        }
      }`,
    update(u, p, t) {
      u.uMode.value = { edge: 0, slope: 1, normal: 2 }[p.op] ?? 0;
      const mode = p.mode ?? 'classic';
      if (mode !== 'classic' && mode !== 'crisp') {
        warn(`${p.op === 'normal' ? 'normalMap' : p.op}: no mode '${mode}' — classic or crisp; using classic`);
      }
      u.uCrisp.value = mode === 'crisp' ? 1 : 0;
      u.uStrength.value = resolve(p.strength ?? 1, t);
      u.uSpread.value = resolve(p.spread ?? 1, t);
    },
  },

  adjust: {
    extras: { uContrast: 1, uSat: 1, uGamma: 1, uHue: 0 },
    texParams: { contrast: 'uContrast', saturation: 'uSat', gamma: 'uGamma', hue: 'uHue' },
    frag: `
      void main() {
        vec4 src = texture2D(tex0, vUv);
        vec3 c = src.rgb;
        c = (c - 0.5) * uContrast + 0.5;
        c = mix(vec3(dot(c, LUMA)), c, uSat);
        float hue = uHue * 6.2831853;    // turns: 1 = full wheel
        if (hue != 0.0) {
          // rotate around the gray axis (Rodrigues)
          const vec3 k = vec3(0.57735026919);
          float ca = cos(hue), sa = sin(hue);
          c = c * ca + cross(k, c) * sa + k * dot(k, c) * (1.0 - ca);
        }
        c = pow(max(c, 0.0), vec3(1.0 / max(uGamma, 0.001)));
        gl_FragColor = vec4(c, src.a);
      }`,
    update(u, p, t) {
      u.uContrast.value = resolve(par(p.contrast, 1), t);
      u.uSat.value = resolve(par(p.saturation, 1), t);
      u.uGamma.value = resolve(par(p.gamma, 1), t);
      u.uHue.value = resolve(par(p.hue, 0), t);
    },
  },

  // pow, then × mul ÷ div, then + add − sub, per channel. The honest primitives
  // behind "brightness"; scalar or [r,g,b] values, fns of t as usual.
  //
  // The inverses are uniforms of their own rather than JS negating the value,
  // because the thing being negated may be a fn of t, an [r, g, b] or a whole
  // texture — .sub(map) has no spelling as .add(-map).
  math: {
    extras: { uPow: [1, 1, 1], uMul: [1, 1, 1], uDiv: [1, 1, 1], uAdd: [0, 0, 0], uSub: [0, 0, 0] },
    // the only vec3 slots in the toolkit: a texture here is read as RGB, so a
    // colored map tints per channel rather than scaling all three alike
    texParams: { pow: 'uPow', mul: 'uMul', div: 'uDiv', add: 'uAdd', sub: 'uSub' },
    frag: `
      void main() {
        vec4 src = texture2D(tex0, vUv);
        vec3 raw = src.rgb;
        // pow is undefined for a negative base and for 0 raised to <= 0, and
        // both reach here — the targets are half-float and nothing clamps a
        // chain that has been through .sub(). Only the exponent's own branch
        // takes the floor, though: every other op on this pass has to pass
        // negatives through untouched, since .add(-0.5).mul(2) is how a sketch
        // builds a signed map.
        vec3 c = mix(raw, pow(max(raw, 1e-6), uPow), step(1e-4, abs(uPow - 1.0)));
        // held in a local because a texture-driven slot expands its name into a
        // whole fetch. Floored away from zero on the side it came from, so
        // .div(0) blows out instead of returning Infinity and a negative
        // divisor still flips the image.
        vec3 dv = uDiv;
        vec3 d = mix(max(dv, 1e-3), min(dv, -1e-3), 1.0 - step(vec3(0.0), dv));
        gl_FragColor = vec4(c * uMul / d + uAdd - uSub, src.a);
      }`,
    update(u, p, t) {
      setVec3(u.uPow.value, par(p.pow, 1), t);
      setVec3(u.uMul.value, par(p.mul, 1), t);
      setVec3(u.uDiv.value, par(p.div, 1), t);
      setVec3(u.uAdd.value, par(p.add, 0), t);
      setVec3(u.uSub.value, par(p.sub, 0), t);
    },
  },

  posterize: {
    extras: { uSteps: 4 },
    texParams: { steps: 'uSteps' },
    frag: `
      void main() {
        vec4 src = texture2D(tex0, vUv);
        float n = max(uSteps, 2.0);
        gl_FragColor = vec4(clamp(floor(src.rgb * n) / (n - 1.0), 0.0, 1.0), src.a);
      }`,
    update(u, p, t) { u.uSteps.value = resolve(par(p.steps, 4), t); },
  },

  // ordered dither: quantize like posterize, but add a threshold pattern
  // before the rounding so the error scatters into texture instead of banding.
  // The bayerN ladder is the standard recursive matrix — each coarser level
  // contributes the next-lower bits of the threshold.
  dither: {
    extras: { uLevels: 2, uMode: 2, uCellX: 0, uCellY: 0 },
    texParams: { levels: 'uLevels' },
    frag: `
      float bayer2(vec2 a) { a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
      void main() {
        // cells: dither on that grid instead of the texel grid — the source
        // reads at cell centers and the matrix indexes by cell, so the pattern
        // *is* the visible pixels. Dithering after .pixellate() instead leaves
        // the matrix churning at sub-cell scale under the fat pixels: grain.
        vec2 uv = vUv;
        vec2 px;
        if (uCellX > 0.5) {
          vec2 grid = vec2(uCellX, uCellY > 0.5 ? uCellY : max(uCellX / uAspect, 1.0));
          px = floor(vUv * grid);
          uv = (px + 0.5) / grid;
        } else {
          px = floor(vUv / uTexel);
        }
        vec4 src = texture2D(tex0, uv);
        float d;
        if (uMode < 0.5) d = bayer2(px);
        else if (uMode < 1.5) d = bayer2(px * 0.5) * 0.25 + bayer2(px);
        else if (uMode < 2.5) d = bayer2(px * 0.25) * 0.0625 + bayer2(px * 0.5) * 0.25 + bayer2(px);
        else d = fract(sin(dot(px, vec2(12.9898, 78.233))) * 43758.5453);
        float n = max(uLevels, 2.0);
        vec3 c = floor(src.rgb * (n - 1.0) + d) / (n - 1.0);
        gl_FragColor = vec4(clamp(c, 0.0, 1.0), src.a);
      }`,
    update(u, p, t) {
      u.uLevels.value = resolve(par(p.levels, 2), t);
      const cells = resolve(par(p.cells, 0), t);
      u.uCellX.value = Array.isArray(cells) ? resolve(cells[0], t) : cells;
      u.uCellY.value = Array.isArray(cells) ? resolve(cells[1], t) : 0;
      const modes = { bayer2: 0, bayer4: 1, bayer8: 2, random: 3 };
      const mode = p.mode ?? 'bayer8';
      if (modes[mode] == null) warn(`dither: no mode '${mode}' — bayer2, bayer4, bayer8 or random; using bayer8`);
      u.uMode.value = modes[mode] ?? 2;
    },
  },

  // Photochemical grain: white noise re-rolled every frame. Three things
  // separate it from a high-freq noise(): the noise is white rather than fbm,
  // so it stipples instead of simmering as blobs; the grid is counted in the
  // frame's own pixels, so quality() moves the render's cost and not the
  // grain's size; and the response peaks in the mids, because film has no
  // grain in the blacks and none in the blown highlights.
  grain: {
    extras: { uAmount: 0.1, uGrid: [1920, 1080], uMono: 1 },
    texParams: { amount: 'uAmount' },
    pre: `
      // hash13 (Dave Hoskins) — cell x, cell y and the frame count into one
      // uniform value, without sin()'s per-driver variance.
      float grainHash(vec3 p) {
        p = fract(p * 0.1031);
        p += dot(p, p.zyx + 31.32);
        return fract((p.x + p.y) * p.z);
      }`,
    frag: `
      void main() {
        vec4 src = texture2D(tex0, vUv);
        // the seed wraps rather than growing without bound: past a few million
        // the fract() steps of the hash have no mantissa left to work with
        vec3 cell = vec3(floor(vUv * uGrid), mod(uFrame, 4096.0));
        float n = grainHash(cell);
        vec3 g = uMono > 0.5
          ? vec3(n)
          : vec3(n, grainHash(cell + 37.0), grainHash(cell + 71.0));
        // luma of the image, not of the premultiplied buffer — a half-covered
        // pixel is not a dark one, and would otherwise be graded as one
        float l = clamp(dot(src.rgb / max(src.a, 1e-4), LUMA), 0.0, 1.0);
        // a triangle peaking at mid gray, zero at both ends
        g = (g - 0.5) * 2.0 * uAmount * (1.0 - abs(2.0 * l - 1.0));
        // × alpha to stay premultiplied: grain lands on the image, not on the
        // hole beside it. No ceiling — the response is already 0 by the time a
        // pixel is blown, so an over-1 chain passes through untouched.
        gl_FragColor = vec4(max(src.rgb + g * src.a, 0.0), src.a);
      }`,
    update(u, p, t, ctx) {
      u.uAmount.value = resolve(par(p.amount, 0.1), t);
      const grid = frameGrid(ctx);
      const size = Math.max(resolve(p.size ?? 1, t) || 1, 0.05);
      u.uGrid.value.set(grid[0] / size, grid[1] / size);
      u.uMono.value = p.mono === false ? 0 : 1;
    },
  },

  // the two counts are separate floats rather than one vec2 so either can be
  // texture-driven on its own, and so the no-y case can follow x per pixel
  pixellate: {
    extras: { uCellX: 100, uCellY: 100, uFitY: 1 },
    texParams: { x: 'uCellX', y: 'uCellY' },
    frag: `
      void main() {
        float cx = max(uCellX, 1.0);
        vec2 c = vec2(cx, uFitY > 0.5 ? max(cx / uAspect, 1.0) : max(uCellY, 1.0));
        gl_FragColor = texture2D(tex0, (floor(vUv * c) + 0.5) / c);
      }`,
    update(u, p, t) {
      u.uCellX.value = resolve(par(p.x, 100), t);
      u.uCellY.value = resolve(par(p.y, 100), t);
      u.uFitY.value = p.y == null ? 1 : 0;   // square cells from the aspect
    },
  },

  // ascii() — one glyph per cell, picked by the cell's luma. tex1 is the glyph
  // atlas built in _render: uCount cells in a row, dark→bright, each glyph
  // inset by uPad so a filled one can't bleed into its neighbor.
  ascii: {
    extras: { uGrid: [80, 24], uCount: 10, uPad: [0, 0], uColor: [1, 1, 1, 1], uBg: [0, 0, 0, 1], uTint: 1 },
    frag: `
      void main() {
        vec2 cell = floor(vUv * uGrid);
        vec2 local = fract(vUv * uGrid);
        // average the cell instead of point-sampling it: the glyph stands in
        // for everything under it, and one tap would report whatever detail
        // happened to land on the center
        vec4 src = vec4(0.0);
        for (int y = 0; y < 3; y++) {
          for (int x = 0; x < 3; x++) {
            src += texture2D(tex0, (cell + (vec2(float(x), float(y)) + 0.5) / 3.0) / uGrid);
          }
        }
        src /= 9.0;
        float l = clamp(dot(src.rgb, LUMA), 0.0, 1.0);
        float idx = min(floor(l * uCount), uCount - 1.0);
        vec2 a = vec2((idx + uPad.x + local.x * (1.0 - 2.0 * uPad.x)) / uCount,
                      uPad.y + local.y * (1.0 - 2.0 * uPad.y));
        float g = texture2D(tex1, a).r;
        gl_FragColor = mix(uBg, uTint > 0.5 ? src : uColor, g);
      }`,
  },

  remap: {
    frag: `void main() { gl_FragColor = texture2D(tex0, texture2D(tex1, vUv).rg); }`,
  },

  lookup: {
    frag: `
      void main() {
        vec4 src = texture2D(tex0, vUv);
        float l = clamp(dot(src.rgb, LUMA), 0.0, 1.0);
        gl_FragColor = texture2D(tex1, vec2(l, 0.5)) * src.a;
      }`,
  },

  // A LUT of the wrong shape is the wrong shape every frame, so it says so once
  // per texture rather than filling the console at 60fps.
  // HaldCLUT — a 3D color cube flattened into an ordinary image, which is how
  // film stocks are published. Every color in the cube is written out in order
  // (red fastest, then green, then blue), so a level-8 CLUT is a 64³ cube in a
  // 512×512 PNG and arrives through the plain image path with no parser.
  //
  // This is the remapping .lookup() cannot do: that one indexes by luma, so it
  // tones but cannot make shadows teal while skin stays warm.
  //
  // Eight taps and a manual trilinear rather than leaning on hardware
  // filtering: neighbors in green and blue are a row or a whole slice away in
  // the image, so a bilinear fetch would blend in colors from the wrong part
  // of the cube. The LUT is sampled NEAREST for the same reason (see update).
  lut: {
    extras: { uCube: 64, uWidth: 512, uMix: 1 },
    texParams: { mix: 'uMix' },
    pre: `
      vec3 haldTexel(vec3 i) {
        float run = i.b * uCube * uCube + i.g * uCube;   // start of this (g, b) run
        float y = floor(run / uWidth);
        vec2 px = vec2(run - y * uWidth + i.r, y);
        return texture2D(tex1, (px + 0.5) / uWidth).rgb;
      }`,
    frag: `
      void main() {
        vec4 src = texture2D(tex0, vUv);
        // the cube grades a color, not a coverage — so undo the premultiply,
        // grade, and put it back
        vec3 c = clamp(src.rgb / max(src.a, 1e-4), 0.0, 1.0);
        vec3 p = c * (uCube - 1.0);
        vec3 i0 = floor(p), f = p - i0;
        vec3 i1 = min(i0 + 1.0, uCube - 1.0);
        vec3 c00 = mix(haldTexel(vec3(i0.r, i0.g, i0.b)), haldTexel(vec3(i1.r, i0.g, i0.b)), f.r);
        vec3 c10 = mix(haldTexel(vec3(i0.r, i1.g, i0.b)), haldTexel(vec3(i1.r, i1.g, i0.b)), f.r);
        vec3 c01 = mix(haldTexel(vec3(i0.r, i0.g, i1.b)), haldTexel(vec3(i1.r, i0.g, i1.b)), f.r);
        vec3 c11 = mix(haldTexel(vec3(i0.r, i1.g, i1.b)), haldTexel(vec3(i1.r, i1.g, i1.b)), f.r);
        vec3 graded = mix(mix(c00, c10, f.g), mix(c01, c11, f.g), f.b);
        gl_FragColor = vec4(mix(c, graded, clamp(uMix, 0.0, 1.0)) * src.a, src.a);
      }`,
    update(u, p, t, ctx, ins) {
      u.uMix.value = resolve(par(p.mix, 1), t);
      const tex = ins[1];
      const w = tex?.image?.width ?? 0, h = tex?.image?.height ?? 0;
      // a Hald of level L is L³ wide and holds an (L²)³ cube, so the edge falls
      // out of the width alone — and a width that isn't a cube is not one
      const level = Math.round(Math.cbrt(w));
      // A chain can never be a cube: every node renders at the frame's size, so
      // what arrives here is whatever the window happens to be. Saying that is
      // worth more than reporting its dimensions, which sends you off measuring
      // pixels for a shape you cannot reach from here.
      if (tex?.isRenderTargetTexture) {
        lutWarn(tex, 'lut: a chain renders at the size of the frame, so it can never be a color cube — point .lut() at an image file instead, by name or through imagefile(). The chain passes through ungraded.');
        u.uMix.value = 0;
        return;
      }
      // nothing to read yet: a file still decoding, or the 1×1 black the media
      // layer stands in with when the name matched nothing — and that case has
      // already said so, in the words that name the actual problem
      if (w <= 1 || h <= 1) { u.uMix.value = 0; return; }
      if (level < 2 || level ** 3 !== w || h !== w) {
        lutWarn(tex, `lut: ${w}×${h} is not a color cube — one is square and a whole cube of pixels wide (64×64, 512×512, 1728×1728). The chain passes through ungraded.`);
        u.uMix.value = 0;
        return;
      }
      u.uCube.value = level * level;
      u.uWidth.value = w;
      // A CLUT is addressed, not sampled, so an image loaded for this wants
      // neither of the two conveniences an image loaded as a picture gets.
      // Point sampling and no mips: the taps above hit exact cells, and the
      // derivatives of a chain sweeping the cube across one frame would
      // otherwise pick a mip level averaging unrelated colors — a LUT that
      // mysteriously goes gray. And no flipY: three uploads images bottom-up
      // so that v = 0 is the bottom of the picture, which for a cube laid out
      // in reading order silently reverses blue. Once per texture.
      if (!tex.isRenderTargetTexture && (tex.flipY || tex.magFilter !== THREE.NearestFilter)) {
        tex.magFilter = tex.minFilter = THREE.NearestFilter;
        tex.generateMipmaps = false;
        tex.flipY = false;
        tex.needsUpdate = true;
      }
    },
  },

  // Luma between two colors — the two-stop case of lookup(), which is what a
  // white-on-black source (edge, text, threshold, a mask) always wanted and had
  // to build a ramp to say.
  tint: {
    extras: { uColor: [1, 1, 1, 1], uBg: [0, 0, 0, 1] },
    frag: `
      void main() {
        vec4 src = texture2D(tex0, vUv);
        float l = clamp(dot(src.rgb, LUMA), 0.0, 1.0);
        // × coverage: the recolor happens within the image's own alpha
        gl_FragColor = mix(uBg, uColor, l) * src.a;
      }`,
    update(u, p, t) {
      setColor4(u.uColor.value, orDflt(p.color, '#ffffff'), t);
      setColor4(u.uBg.value, orDflt(p.bg, '#000000'), t);
    },
  },

  // tex0 = dry chain, tex1 = mask (luma), tex2 = wet chain (when blending)
  mask: {
    extras: { uBlend: 0 },
    frag: `
      void main() {
        vec4 dry = texture2D(tex0, vUv);
        float m = clamp(dot(texture2D(tex1, vUv).rgb, LUMA), 0.0, 1.0);
        gl_FragColor = uBlend > 0.5 ? mix(dry, texture2D(tex2, vUv), m) : dry * m;
      }`,
  },

  // also the pass behind .displace(): a texture-driven translate biased by mid
  transform: {
    extras: { uTranslate: [0, 0], uScale: [1, 1], uRot: 0, uWrap: 0 },
    texParams: { translate: 'uTranslate', scale: 'uScale', rotate: 'uRot' },
    frag: `
      void main() {
        vec2 p = vUv - 0.5;
        float rot = uRot;
        float cs = cos(rot), sn = sin(rot);
        p = mat2(cs, sn, -sn, cs) * p;
        p /= uScale;
        p += 0.5 - uTranslate;
        gl_FragColor = wrapSample(tex0, p, uWrap);
      }`,
    update(u, p, t) {
      const tr = par(p.translate, [0, 0]);
      u.uTranslate.value.set(resolve(tr[0], t), resolve(tr[1], t));
      const s = resolve(par(p.scale, 1), t);
      Array.isArray(s) ? u.uScale.value.set(resolve(s[0], t), resolve(s[1], t)) : u.uScale.value.set(s, s);
      u.uRot.value = resolve(par(p.rotate, 0), t);
      u.uWrap.value = WRAP_MODES[p.wrap ?? 'clamp'] ?? 0;
    },
  },

  // Keep a window of the frame and drop the rest. Nothing is resampled: the
  // picture stays exactly where it was and the black closes in around it, the
  // same way resolution()'s letterboxing does. It's .mask() against a white
  // rectangle, with the rectangle written in pixels.
  crop: {
    extras: { uSize: [1, 1], uCenter: [0.5, 0.5] },
    frag: `
      void main() {
        vec2 inside = step(abs(vUv - uCenter), uSize * 0.5);
        gl_FragColor = texture2D(tex0, vUv) * inside.x * inside.y;
      }`,
    update(u, p, t, ctx) {
      // A size > 1 counts pixels of the frame's own grid — resolution()'s
      // numbers when the sketch set them, the canvas as displayed otherwise.
      // Both are what's on screen, and neither retina nor quality() moves them,
      // unlike the drawing buffer. <= 1 is already the fraction the shader wants.
      const grid = frameGrid(ctx);
      const frac = (v, px) => {
        // a size that isn't a number would reach the uniform as NaN, and every
        // comparison against NaN is false — an all-black frame with no clue why
        if (!Number.isFinite(v)) {
          warn('crop: expected a number (or a fn of t) for the size — the crop is skipped');
          return 1;
        }
        return Math.max(0, v > 1 ? v / Math.max(1, px) : v);
      };
      const w = resolve(p.w ?? 1, t);
      u.uSize.value.set(frac(w, grid[0]), frac(resolve(p.h ?? w, t), grid[1]));
      const c = par(p.center, [0.5, 0.5]);
      u.uCenter.value.set(resolve(c[0], t), resolve(c[1], t));
    },
  },

  // radial UV warp — barrel/pincushion, twist, zoom. displace() can't express
  // this: nothing in the toolkit *generates* a radial vector field.
  warp: {
    extras: { uBarrel: 0, uTwist: 0, uZoom: 1, uCenter: [0.5, 0.5], uWrap: 3 },
    texParams: { barrel: 'uBarrel', twist: 'uTwist', zoom: 'uZoom', center: 'uCenter' },
    frag: `
      void main() {
        // square space (x scaled by aspect) so the warp stays circular, with
        // r normalized to 1 at the frame corner
        vec2 ctr = uCenter;
        vec2 p = (vUv - ctr) * vec2(uAspect, 1.0) / max(uZoom, 0.001);
        float r = length(p) / max(0.5 * length(vec2(uAspect, 1.0)), 0.001);
        p *= 1.0 + uBarrel * r * r;   // > 0 bulges outward like a CRT face
        float a = uTwist * r;         // rotation grows with radius
        float cs = cos(a), sn = sin(a);
        p = mat2(cs, sn, -sn, cs) * p;
        gl_FragColor = wrapSample(tex0, p / vec2(uAspect, 1.0) + ctr, uWrap);
      }`,
    update(u, p, t) {
      u.uBarrel.value = resolve(par(p.barrel, 0), t);
      u.uTwist.value = resolve(par(p.twist, 0), t);
      u.uZoom.value = resolve(par(p.zoom, 1), t);
      const c = par(p.center, [0.5, 0.5]);
      u.uCenter.value.set(resolve(c[0], t), resolve(c[1], t));
      u.uWrap.value = WRAP_MODES[p.wrap ?? 'transparent'] ?? 3;
    },
  },

  // per-channel UV offset — chromatic aberration. Every other filter samples
  // all three channels at one UV, so this is the only way to split them.
  chroma: {
    extras: { uAmount: 0.005, uRadial: 0, uAngle: 0, uCenter: [0.5, 0.5] },
    texParams: { amount: 'uAmount', angle: 'uAngle', center: 'uCenter' },
    frag: `
      void main() {
        // radial: a scale about the center — zero split there, growing toward
        // the edges, like a lens. directional: the same offset everywhere.
        // Either way uAmount is roughly the split at the frame edge.
        vec2 d = uRadial > 0.5
          ? (vUv - uCenter) * 2.0 * uAmount
          : vec2(cos(uAngle) / uAspect, sin(uAngle)) * uAmount;
        vec4 c = texture2D(tex0, vUv);
        gl_FragColor = vec4(
          texture2D(tex0, vUv + d).r,
          c.g,
          texture2D(tex0, vUv - d).b,
          c.a);
      }`,
    update(u, p, t) {
      u.uAmount.value = resolve(par(p.amount, 0.005), t);
      u.uRadial.value = resolve(p.radial ?? 0, t) ? 1 : 0;
      u.uAngle.value = resolve(par(p.angle, 0), t);
      const c = par(p.center, [0.5, 0.5]);
      u.uCenter.value.set(resolve(c[0], t), resolve(c[1], t));
    },
  },

  threshold: {
    extras: { uLevel: 0.5, uSoft: 0 },
    texParams: { level: 'uLevel', soft: 'uSoft' },
    frag: `
      void main() {
        vec4 src = texture2D(tex0, vUv);
        float l = dot(src.rgb, LUMA);
        // read once into locals: a texture-driven level/soft is a fetch, and
        // the #define would otherwise repeat it inside the branch
        float lv = uLevel, sf = uSoft;
        float m = sf > 0.0 ? smoothstep(lv - sf, lv + sf, l) : step(lv, l);
        // scaled by coverage, so a cutout thresholds to a cutout mask
        gl_FragColor = vec4(vec3(m), 1.0) * src.a;
      }`,
    update(u, p, t) {
      u.uLevel.value = resolve(par(p.level, 0.5), t);
      u.uSoft.value = resolve(par(p.soft, 0), t);
    },
  },

  // The keys carve alpha rather than paint a picture: what survives stays
  // itself and the rest goes transparent. That's the difference from
  // .threshold(), whose output is a B/W image with full coverage.
  // Nearness is perceptual — distance in Oklab — and the keying radius is
  // auto-sized to the key's saturation, with `tolerance` a multiplier on it.
  // A saturated key (a screen) gets a generous radius measured in chroma
  // alone, lightness factored out, so its lit and shadowed parts key
  // together — chroma space is empty out there. A muted key sits in the
  // crowd around gray, where a screen-sized radius would take most of any
  // real frame with it: the radius tightens, lightness joins the distance,
  // and spill fades out (a neutral key has no cast to scrub). update()
  // resolves the ramps off the key's Oklab chroma (oklabChroma above).
  chromakey: {
    extras: { uKey: [0, 1, 0], uTol: 0.12, uSoft: 0.03, uSpill: 0.5, uLumaW: 0 },
    // Oklab both ways (Björn Ottosson's matrices, public domain). The
    // pipeline's display-space values are linearized by gamma 2.2 — close
    // enough to sRGB for a distance metric.
    pre: `
      vec3 toOklab(vec3 c) {
        c = pow(max(c, vec3(0.0)), vec3(2.2));
        vec3 lms = vec3(
          0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b,
          0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b,
          0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b);
        lms = pow(lms, vec3(1.0 / 3.0));
        return vec3(
          0.2104542553 * lms.x + 0.7936177850 * lms.y - 0.0040720468 * lms.z,
          1.9779984951 * lms.x - 2.4285922050 * lms.y + 0.4505937099 * lms.z,
          0.0259040371 * lms.x + 0.7827717662 * lms.y - 0.8086757660 * lms.z);
      }
      vec3 fromOklab(vec3 lab) {
        vec3 lms = vec3(
          lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z,
          lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z,
          lab.x - 0.0894841775 * lab.y - 1.2914855480 * lab.z);
        lms = lms * lms * lms;
        vec3 c = vec3(
           4.0767416621 * lms.x - 3.3077115913 * lms.y + 0.2309699292 * lms.z,
          -1.2684380046 * lms.x + 2.6097574011 * lms.y - 0.3413193965 * lms.z,
          -0.0041960863 * lms.x - 0.7034186147 * lms.y + 1.7076147010 * lms.z);
        return pow(max(c, vec3(0.0)), vec3(1.0 / 2.2));
      }`,
    frag: `
      void main() {
        vec4 src = texture2D(tex0, vUv);
        vec3 rgb = src.a > 0.0 ? src.rgb / src.a : src.rgb;
        vec3 lab = toOklab(rgb);
        vec3 kl = toOklab(uKey);
        float d = length(vec3((lab.x - kl.x) * uLumaW, lab.yz - kl.yz));
        float keep = uSoft > 0.0 ? smoothstep(uTol - uSoft, uTol + uSoft, d) : step(uTol, d);
        // spill: pull the survivors' chroma off the key's axis, so the green
        // cast on hair and edges goes gray instead of outliving the key
        vec2 kn = normalize(kl.yz + 1e-6); // epsilon: a gray key would normalize 0/0
        lab.yz -= kn * max(0.0, dot(lab.yz, kn)) * uSpill;
        gl_FragColor = vec4(fromOklab(lab), 1.0) * src.a * keep;
      }`,
    update(u, p, t) {
      setVec3(u.uKey.value, orDflt(p.color, '#00ff00'), t);
      const sat = oklabChroma(u.uKey.value);
      const ramp = (lo, hi) => {
        const x = Math.min(1, Math.max(0, (sat - lo) / (hi - lo)));
        return x * x * (3 - 2 * x);
      };
      const tol = (0.04 + 0.08 * ramp(0.03, 0.14)) * resolve(par(p.tolerance, 1), t);
      u.uTol.value = tol;
      u.uSoft.value = tol * resolve(par(p.soft, 0.25), t);
      u.uSpill.value = resolve(par(p.spill, 0.5), t) * ramp(0.02, 0.08);
      u.uLumaW.value = 1 - ramp(0.04, 0.12);
    },
  },

  lumakey: {
    extras: { uLevel: 0.5, uSoft: 0.05, uInvert: 0 },
    frag: `
      void main() {
        vec4 src = texture2D(tex0, vUv);
        float l = src.a > 0.0 ? dot(src.rgb / src.a, LUMA) : 0.0;
        float keep = uSoft > 0.0 ? smoothstep(uLevel - uSoft, uLevel + uSoft, l) : step(uLevel, l);
        gl_FragColor = src * (uInvert > 0.5 ? 1.0 - keep : keep);
      }`,
    update(u, p, t) {
      u.uLevel.value = resolve(par(p.level, 0.5), t);
      u.uSoft.value = resolve(par(p.soft, 0.05), t);
      u.uInvert.value = resolve(p.invert ?? 0, t) >= 0.5 ? 1 : 0;
    },
  },

  // .alpha(v) — scale the image's alpha, rgb with it (premultiplied), so 0 is
  // fully transparent and 1 leaves it alone. A texture in v fades per pixel.
  alpha: {
    extras: { uAlpha: 1 },
    texParams: { alpha: 'uAlpha' },
    frag: `void main() { gl_FragColor = texture2D(tex0, vUv) * clamp(uAlpha, 0.0, 1.0); }`,
    update(u, p, t) { u.uAlpha.value = resolve(par(p.alpha, 1), t); },
  },

  invert: {
    // a - rgb, not 1 - rgb: the premultiplied invert, which flips only within
    // the image's own coverage (transparent stays transparent, opaque is 1-rgb)
    frag: `
      void main() {
        vec4 c = texture2D(tex0, vUv);
        gl_FragColor = vec4(c.a - c.rgb, c.a);
      }`,
  },

  // sRGB -> linear, appended to a chain feeding a *color* map slot. textures work
  // in display space throughout (that's what the scene texture's tonemap pass
  // establishes), while three shades in linear and normally gets the decode
  // for free from the texture's internal format — which a half-float render
  // target can't have. So it happens here instead. Bundle maps (normal,
  // roughness, displacement) are raw numbers either way and skip this.
  toLinear: {
    frag: `
      void main() {
        vec4 c = texture2D(tex0, vUv);
        vec3 lo = c.rgb / 12.92;
        vec3 hi = pow((max(c.rgb, 0.0) + 0.055) / 1.055, vec3(2.4));
        gl_FragColor = vec4(mix(hi, lo, vec3(lessThanEqual(c.rgb, vec3(0.04045)))), c.a);
      }`,
  },

  comp: {
    extras: { uMode: 0, uOpacity: 1, uSwap: 0, uStack: 0 },
    // the non-separable blends (luminosity / color) can't work channel by
    // channel: they move a whole color to a target luminance, then pull it
    // back into gamut along the gray axis so the hue survives the trip. This
    // is the PDF/Photoshop construction — SetLum + ClipColor.
    pre: `
      vec3 clipColor(vec3 c) {
        float l = dot(c, LUMA);
        float n = min(min(c.r, c.g), c.b);
        float x = max(max(c.r, c.g), c.b);
        if (n < 0.0) c = l + (c - l) * (l / max(l - n, 1e-4));
        if (x > 1.0) c = l + (c - l) * ((1.0 - l) / max(x - l, 1e-4));
        return c;
      }
      vec3 setLum(vec3 c, float l) { return clipColor(c + (l - dot(c, LUMA))); }
    `,
    frag: `
      void main() {
        vec4 Bt = texture2D(tex0, vUv);      // base (this chain)
        vec4 Lt = texture2D(tex1, vUv);      // layer (composited on top)
        // the blends take straight color: premultiplied rgb reads a half-covered
        // white as mid gray, and la gates the result again below — coverage
        // counted twice, which quietly squares any partial-alpha layer
        vec3 Bs = Bt.rgb, Ls = Lt.rgb / max(Lt.a, 1e-4);
        // uSwap exchanges the two inputs to the blend function only: the layer
        // is still what alpha and opacity gate, so a swapped feedback still
        // decays last frame rather than this one.
        vec3 B = mix(Bs, Ls, uSwap), L = mix(Ls, Bs, uSwap);
        vec3 r;
        float m = uMode;
        if (m < 0.5)       r = L;
        else if (m < 1.5)  r = B + L;
        else if (m < 2.5)  r = B - L;
        else if (m < 3.5)  r = B * L;
        else if (m < 4.5)  r = 1.0 - (1.0 - B) * (1.0 - L);
        else if (m < 5.5)  r = mix(1.0 - 2.0 * (1.0 - B) * (1.0 - L), 2.0 * B * L, step(B, vec3(0.5)));
        else if (m < 6.5)  r = mix(1.0 - 2.0 * (1.0 - L) * (1.0 - B), 2.0 * L * B, step(L, vec3(0.5)));
        else if (m < 7.5) {
          vec3 d = mix(sqrt(B), ((16.0 * B - 12.0) * B + 4.0) * B, step(B, vec3(0.25)));
          r = mix(B + (2.0 * L - 1.0) * (d - B), B - (1.0 - 2.0 * L) * B * (1.0 - B), step(L, vec3(0.5)));
        }
        else if (m < 8.5)  r = min(B, L);
        else if (m < 9.5)  r = max(B, L);
        else if (m < 10.5) r = abs(B - L);
        else if (m < 11.5) r = B + L - 2.0 * B * L;
        else if (m < 12.5) r = min(vec3(1.0), B / max(1.0 - L, vec3(0.001)));
        else if (m < 13.5) r = 1.0 - min(vec3(1.0), (1.0 - B) / max(L, vec3(0.001)));
        else if (m < 14.5) r = B / max(L, vec3(0.001));
        else if (m < 15.5) r = setLum(B, dot(L, LUMA));   // luminosity: base's color, layer's brightness
        else if (m < 16.5) r = setLum(L, dot(B, LUMA));   // color: layer's color, base's brightness
        else               r = B + L;                     // sum: add, unclamped below
        // The layer's alpha gates the blend per pixel; on opaque inputs la is
        // uOpacity and everything below collapses to the pre-alpha behavior.
        // 'over' is the true premultiplied source-over, so it takes the layer
        // premultiplied; the rest blend straight and are gated back to
        // coverage here. Swapped, source-over becomes destination-over — the
        // layer goes under, showing only where the base leaves room.
        float la = clamp(Lt.a, 0.0, 1.0) * uOpacity;
        vec3 lp = Lt.rgb * uOpacity;
        vec3 over = mix(lp + Bt.rgb * (1.0 - la), Bt.rgb + lp * (1.0 - Bt.a), uSwap);
        // in the display stack the base can be empty (nothing drawn there yet):
        // the layer has nothing to blend with and shows as itself
        r = mix(r, mix(Ls, r, clamp(Bt.a, 0.0, 1.0)), uStack);
        // every blend clamps like an image blend, except sum, whose whole
        // point is the values past 1.0
        vec3 rgb = m < 0.5 ? over : mix(Bt.rgb, m > 16.5 ? r : clamp(r, 0.0, 1.0), la);
        gl_FragColor = vec4(rgb, Bt.a + la - Bt.a * la);
      }`,
    update(u, p, t) {
      const asked = p.mode ?? 'over';
      const mode = SWAPPED_MODES[asked] ?? asked;
      if (BLEND_MODES[mode] == null) warn(`comp: no blend mode '${asked}' — ${BLEND_MODE_NAMES.join(' ')}; using over`);
      u.uMode.value = BLEND_MODES[mode] ?? 0;
      u.uSwap.value = (p.swap || asked in SWAPPED_MODES) ? 1 : 0;
      u.uOpacity.value = resolve(p.opacity ?? 1, t);
    },
  },
};

// 'black' is the pre-alpha name for 'transparent' — same mode, kept for
// existing sketches (displayed on nothing it *is* black; in a comp it's a cutout)
const WRAP_MODES = { clamp: 0, repeat: 1, mirror: 2, transparent: 3, black: 3, polar: 4 };
const SDF_MODES = { direction: 0, distance: 1, step: 2 };

// what docs and completion offer — black is an alias, polar internal plumbing
export const WRAP_MODE_NAMES = ['clamp', 'repeat', 'mirror', 'transparent'];

// First spelling of each mode is the canonical one — that's the set docs and
// completion offer (BLEND_MODE_NAMES); the rest are aliases.
const BLEND_MODES = {
  over: 0, normal: 0,
  add: 1,
  sub: 2, subtract: 2,
  mult: 3, multiply: 3,
  screen: 4,
  overlay: 5,
  hardLight: 6, hardlight: 6,
  softLight: 7, softlight: 7,
  darken: 8,
  lighten: 9,
  difference: 10, diff: 10,
  exclusion: 11,
  dodge: 12, colorDodge: 12,
  burn: 13, colorBurn: 13,
  divide: 14, div: 14,
  luminosity: 15, lum: 15,
  color: 16,
  // add without the clamp: counts survive past 1.0 in the float target, which
  // is what mask arithmetic wants — comping white masks with 'sum' makes each
  // pixel's luma how many masks cover it ('lighten' is their union, 'mult'
  // their intersection, and this is the count)
  sum: 17,
};

// Mode names that are another mode with `swap` already on. 'under' is the one
// input order worth naming — everything else is spelled `{ mode, swap: true }`.
const SWAPPED_MODES = { under: 'over' };

export const BLEND_MODE_NAMES = [
  ...Object.keys(BLEND_MODES).filter(
    (name, i, all) => all.findIndex((n) => BLEND_MODES[n] === BLEND_MODES[name]) === i
  ),
  ...Object.keys(SWAPPED_MODES),
];

// ---------------------------------------------------------------------------
// instanced copies — .instance() on a texture chain, the flat twin of the one
// on geometry. The picture so far becomes the stamp: one instanced quad per
// copy, all of them in a single draw through an ortho camera spanning the
// frame, so a layout() arrives in the texture world as pixels.
//
// Units are the frame's height, y up, origin at the center: a copy at scale 1
// covers the frame exactly, and the frame reaches 0.5 either side of the
// origin. Copies outside it are clipped, so a structure bigger than that is
// sized where it is built — framing it from here would only be the same scale
// applied a step later.

// Blending is fixed-function here rather than a shader pass: every copy lands
// in one draw, so what a copy meets is the destination buffer, which a shader
// can't read. These four are what GL can express; the rest is .comp()'s job.
const COPY_BLEND = {
  add: { eq: THREE.AddEquation, src: THREE.OneFactor, dst: THREE.OneFactor },
  over: { eq: THREE.AddEquation, src: THREE.OneFactor, dst: THREE.OneMinusSrcAlphaFactor },
  screen: { eq: THREE.AddEquation, src: THREE.OneFactor, dst: THREE.OneMinusSrcColorFactor },
  // factors go unread under a min/max equation, but three wants them set
  lighten: { eq: THREE.MaxEquation, src: THREE.OneFactor, dst: THREE.OneFactor },
};
COPY_BLEND.normal = COPY_BLEND.over;

export const COPY_BLEND_NAMES = ['add', 'over', 'screen', 'lighten'];

// What tells two .instance() nodes apart is a count and a fn, neither of which
// survives being stringified — so each gets a serial, or the signature .tile()
// dedupes its variants on would merge two different structures into one.
let copySerial = 0;

const COPY_VERT = /* glsl */ `
attribute vec3 tdColor;
attribute float tdAlpha;
varying vec2 vUv;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vUv = uv;
  vColor = tdColor;
  vAlpha = tdAlpha;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;

const COPY_FRAG = /* glsl */ `
uniform sampler2D tex0;
varying vec2 vUv;
varying vec3 vColor;
varying float vAlpha;
void main() {
  // premultiplied throughout: the fade scales all four channels, the tint only
  // the three that carry color
  vec4 c = texture2D(tex0, vUv) * vAlpha;
  gl_FragColor = vec4(c.rgb * vColor, c.a);
}`;

// The stand-in for one copy handed to a texture .instance()'s fn. Every copy
// is the same picture drawn by the same shader, so what can differ between
// them is where it lands, how big, which way up, and how it's tinted and
// faded — the rest belongs to the chain and says so. Reused across every copy
// and every frame, hence reset() and the flat fields.
class CopyHandle {
  constructor() { this.reset(); }

  reset() {
    this.px = this.py = 0;
    this.rz = 0;
    this.sx = this.sy = 1;
    this.col = null;
    this.a = 1;
    this.hidden = false;
  }

  // Drop this copy, like the geometry handle's — checked after the fn has run,
  // so nothing later in the chain can bring it back. Both the alpha and the
  // scale go, so it costs no blending either.
  hide(v = true) { this.hidden = v !== false; return this; }

  // a third number is a layout placing in 3D; this is the flat view of it, so
  // depth is dropped rather than refused
  position(x = 0, y = 0) {
    if (Array.isArray(x)) [x, y] = [x[0] ?? 0, x[1] ?? 0];
    this.px = x; this.py = y;
    return this;
  }
  // one angle turns the copy. Three is a layout's Euler arriving, whose z is
  // the turn a flat rule made — the other two lean the copy out of the frame,
  // which a stamp has no way to show.
  rotation(x = 0, y, z) {
    this.rz = z === undefined ? x : z;
    return this;
  }
  scale(x = 1, y) {
    if (Array.isArray(x)) [x, y] = [x[0] ?? 1, x[1] ?? 1];
    this.sx = x; this.sy = y ?? x;
    return this;
  }
  // tints this copy: multiplied with the picture's own colors
  color(c) { this.col = c; return this; }
  // fades this copy, 0..1 — the one thing a copy can do that a 3D one can't,
  // since a texture is composited rather than lit
  alpha(v = 1) { this.a = v; return this; }

  // Same bargain as the geometry handle: a verb a copy hasn't got says where
  // the real one lives and carries on, since this fn runs every frame and
  // throwing here would take the video down over a line that only wanted moving.
  align() {
    warn('instance: a copy of a picture has no heading to align — .rotation(angle) turns it');
    return this;
  }
  tile() {
    warn('instance: .tile() picks among a set of maps on geometry — here the chain before .instance() is the picture every copy wears');
    return this;
  }
  material() {
    warn('instance: a copy has no material — .color() tints it and .alpha() fades it, and the rest is the chain before .instance()');
    return this;
  }
  comp() {
    warn('instance: .comp() layers whole pictures — put it on the chain, before .instance() to composite the stamp or after it to composite the result');
    return this;
  }
  instance() {
    warn("instance: a copy can't be instanced — raise the count instead");
    return this;
  }
  out() {
    warn('instance: .out() ends the chain, not a copy — call it after .instance()');
    return this;
  }
}

// The texture side of a tracker, defined here where TextureOp lives: every box
// in one picture, each pixel's luma the number of boxes covering it (see the
// blobBoxes spec). mask(blobs.boxes(), fn) treats inside every box at once —
// and once, where boxes overlap; .threshold(1.5) keeps only the overlaps.
Blobs.prototype.boxes = function (o = {}) {
  return new TextureOp(this.engine, 'blobBoxes', { blobs: this, pad: o.pad ?? 0 });
};


// ---------------------------------------------------------------------------
// pass plumbing

export class Quad {
  constructor() {
    this.scene = new THREE.Scene();
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }
  // `layer` picks the slice of an array target (see renderTileSets); three
  // takes it in the same argument a cube target's face goes in
  render(renderer, material, target, layer = 0) {
    this.mesh.material = material;
    renderer.setRenderTarget(target, layer);
    renderer.render(this.scene, this.cam);
  }
}

function inferUniform(v) {
  if (typeof v === 'number') return { value: v };
  // a uniform array (vec4 uName[n] in the shader), copied so two nodes of the
  // kind never share one buffer; declared in the spec's `pre`, where its
  // length lives, rather than inferred here
  if (v instanceof Float32Array) return { value: new Float32Array(v) };
  if (Array.isArray(v)) {
    return {
      value: v.length === 4 ? new THREE.Vector4(...v)
        : v.length === 3 ? new THREE.Vector3(...v)
        : new THREE.Vector2(...v),
    };
  }
  return { value: new THREE.Color().setStyle(v, THREE.LinearSRGBColorSpace) };
}

function uniformType(init) {
  if (init instanceof Float32Array) return null; // declared by hand in `pre`
  return typeof init === 'number' ? 'float'
    : Array.isArray(init) && init.length === 2 ? 'vec2'
    : Array.isArray(init) && init.length === 4 ? 'vec4'
    : 'vec3';
}

// ---------------------------------------------------------------------------
// texture-driven params — a param handed a texture is read from that texture at vUv
// instead of from a uniform, which makes every slot below per-pixel
// modulatable. The value is `(sample - mid) * amount`, defaulting to the
// sample itself; a vec2 slot takes R/G, a vec3 slot RGB, a scalar slot luma.
//
// Each bound slot becomes one more input on the node plus a `#define` shadowing
// the uniform's name, so the frag body is written once and a node with nothing
// bound compiles exactly the shader it did before.

// The texture may be given bare or as { map, amount, mid } — the latter is what
// .displace() is: a translate with mid 0.5, so an unsigned map wobbles both
// ways instead of pushing one.
const asMap = (v) => (v instanceof TextureOp ? v : v?.map instanceof TextureOp ? v.map : null);

function bindTexParams(kind, params, inputs) {
  if (!Object.values(params).some(asMap)) return { params, inputs, binds: [] };
  const spec = SPECS[kind];
  params = { ...params };
  inputs = [...inputs];
  const binds = [];
  for (const [name, uniform] of Object.entries(spec?.texParams ?? {})) {
    const map = asMap(params[name]);
    if (!map) continue;
    const { amount = 1, mid = 0 } = params[name];
    const i = binds.length;
    binds.push({
      uniform,
      type: uniformType(spec.extras[uniform]),
      tex: `uPTex${i}`,
      mod: `uPMod${i}`,
      slot: inputs.length,
      amount,
      mid,
    });
    // the marker keeps the slot visible to the structural signature tile()
    // dedupes on, and tells the spec's update() to leave the uniform alone
    params[name] = { tex: inputs.length, amount, mid };
    inputs.push(map);
  }
  // a texture left in a slot with no texture form would reach a uniform as NaN
  for (const [name, v] of Object.entries(params)) {
    if (!asMap(v)) continue;
    // scene({ bg: chain }) renders the chain itself, not through a uniform
    if ((kind === 'scene' || kind === 'stack') && name === 'bg') continue;
    warn(`${kind}: ${name} does not take a texture — the default is used instead`);
    delete params[name];
  }
  return { params, inputs, binds };
}

export function makeMaterial(spec, binds = []) {
  const uniforms = {
    tex0: { value: null },
    tex1: { value: null },
    tex2: { value: null },
    uTexel: { value: new THREE.Vector2() },
    uAspect: { value: 1 },
    uTime: { value: 0 },
    uFrame: { value: 0 },
    uDelta: { value: 0 },
  };
  const bound = new Set(binds.map((b) => b.uniform));
  const decls = [];
  for (const [name, init] of Object.entries(spec.extras ?? {})) {
    uniforms[name] = inferUniform(init);
    // still declared as a uniform in JS (update() writes it either way, three
    // skips what the program doesn't use), but in GLSL the #define stands in
    if (bound.has(name)) continue;
    const type = uniformType(init);
    if (type) decls.push(`uniform ${type} ${name};`);
  }
  for (const b of binds) {
    uniforms[b.tex] = { value: null };
    uniforms[b.mod] = { value: new THREE.Vector2(1, 0) };
    const read =
      b.type === 'vec2' ? `texture2D(${b.tex}, vUv).rg`
      : b.type === 'vec3' ? `texture2D(${b.tex}, vUv).rgb`
      : `dot(texture2D(${b.tex}, vUv).rgb, LUMA)`;
    decls.push(
      `uniform sampler2D ${b.tex};`,
      `uniform vec2 ${b.mod};`,
      `#define ${b.uniform} ((${read} - ${b.mod}.y) * ${b.mod}.x)`,
    );
  }
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: HEADER + decls.join('\n') + '\n' + (spec.pre ?? '') + spec.frag,
    uniforms,
    depthTest: false,
    depthWrite: false,
    // These passes do their own color management (MAT_TONEMAP *is* the ACES
    // pass), and three prepends its tone mapping chunk to any toneMapped
    // ShaderMaterial drawn straight to the canvas — where its RRTAndODTFit
    // collides with ours and the shader fails to compile. Rendering to a target
    // skips the chunk, so the same material would compile there and nowhere
    // else: black canvas, no error but the console.
    toneMapped: false,
  });
}

// ---------------------------------------------------------------------------
// glsl() — a pass written by hand
//
// The escape hatch for the op that isn't here, and the texture-side twin of
// THREE being in scope on the 3D side. The string compiles through the same
// machinery every SPECS entry above goes through, so vUv, tex0, uTexel,
// uAspect and uTime already mean here what they mean everywhere else, and the
// result is an ordinary node: it feeds .comp(), .out(), a material map, all of
// it. Uniforms are named by the sketch and take fns of t like any other
// parameter; one handed a chain arrives as a sampler of that name.
//
// Nothing here may throw, and nothing may go quiet either. Three compiles the
// real program lazily, at the draw call, and reports a failure by console.error
// alone — a frame late, into the console, with line numbers counted from the
// top of a prefix the sketch never wrote. So the source is compiled standalone
// first, against the prefix below: that is what buys an error naming a line of
// the sketch's own string, and a broken pass that copies its input through
// instead of drawing a black hole.

// What three puts in front of a ShaderMaterial's fragment shader on WebGL2,
// minus the parts a full-frame quad never reads (see WebGLProgram's GLSL 3.0
// conversion). Only the standalone compile uses it; three builds its own for
// the program that actually draws.
const GLSL3_PRELUDE = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
#define varying in
layout(location = 0) out highp vec4 pc_fragColor;
#define gl_FragColor pc_fragColor
#define texture2D texture
#define textureCube texture
#define texture2DProj textureProj
#define texture2DLodEXT textureLod
#define texture2DGradEXT textureGrad
`;

// Names the pass has already spent — a uniform called uTime would be declared
// twice, which fails to compile for a reason that reads like nothing the
// sketch did
const GLSL_RESERVED = ['tex0', 'tex1', 'tex2', 'uTexel', 'uAspect', 'uTime', 'uFrame', 'uDelta', 'vUv', 'LUMA', 'wrapSample'];

// Half of what an escape hatch is for is pasting a shader in, and Shadertoy is
// where they are. Its globals are all reachable here: these are ours already
// under another name, and SHADERTOY_UNIFORMS below is the rest.
//
// Each is emitted only when the source says the word, so a shader that never
// mentions them compiles exactly what it wrote — and a sketch that names a
// uniform of its own takes the slot instead, which is the escape when our
// reading of one isn't the one it wants.
const SHADERTOY_DEFINES = {
  iTime: 'uTime',
  iTimeDelta: 'uDelta',
  iFrame: 'int(uFrame)',
  iFrameRate: '(uDelta > 0.0 ? 1.0 / uDelta : 60.0)',
  iResolution: 'vec3(1.0 / uTexel, 1.0)',
  iChannel0: 'tex0',
};

// The ones that need a value of their own, [name, GLSL type, initial value].
// iChannel1..3 are declared whether or not a chain was bound to them: an
// unassigned channel reads transparent here the way it reads black there,
// which beats refusing to compile a paste over a channel it never samples.
const SHADERTOY_UNIFORMS = [
  ['iMouse', 'vec4', () => new THREE.Vector4()],
  ['iDate', 'vec4', () => new THREE.Vector4()],
  ['iSampleRate', 'float', () => 44100],
  ['iChannelResolution', 'vec3[4]', () => [0, 0, 0, 0].map(() => new THREE.Vector3())],
  ['iChannelTime', 'float[4]', () => [0, 0, 0, 0]],
  ['iChannel1', 'sampler2D', () => null],
  ['iChannel2', 'sampler2D', () => null],
  ['iChannel3', 'sampler2D', () => null],
];

const declOf = (name, type) => {
  const [, base, size = ''] = /^(\w+)(\[\d+\])?$/.exec(type);
  return `uniform ${base} ${name}${size};`;
};

const mentions = (src, name) => new RegExp(`\\b${name}\\b`).test(src);

// A texture's own pixel size, for iChannelResolution — a render target carries
// it on .image, a video element under another name.
const texSize = (tex) => {
  const im = tex?.image;
  return [im?.width ?? im?.videoWidth ?? 1, im?.height ?? im?.videoHeight ?? 1];
};

// Per-frame values for whichever of the above the shader actually declared.
// `chans` is the four channels as they were bound this frame.
function writeShadertoy(u, ctx, engine, chans) {
  if (u.iMouse) {
    const p = engine.pointer;
    // ours is -1..1 with y up, Shadertoy's is pixels from the bottom left
    const px = (v, n) => (v * 0.5 + 0.5) * n;
    const [x, y] = [px(p.x, ctx.w), px(p.y, ctx.h)];
    const [zx, zy] = [px(p.pressX, ctx.w), px(p.pressY, ctx.h)];
    // zw is where the press landed, negated once the button is up: `iMouse.z >
    // 0.0` is how a shader over there asks whether it is being held
    u.iMouse.value.set(x, y, p.down ? zx : -zx, p.down ? zy : -zy);
  }
  if (u.iDate) {
    const d = new Date();
    u.iDate.value.set(d.getFullYear(), d.getMonth(), d.getDate(),
      d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds() + d.getMilliseconds() / 1000);
  }
  // the rate the analyser is running at, or the usual one when nothing has
  // asked for audio yet — reading it must not be what starts the capture
  if (u.iSampleRate) u.iSampleRate.value = engine.audio?.ctx?.sampleRate ?? 44100;
  // no per-channel playback clock here: a chain is not a clip, so all four
  // report the one clock there is
  if (u.iChannelTime) u.iChannelTime.value = [ctx.t, ctx.t, ctx.t, ctx.t];
  if (u.iChannelResolution) {
    for (let i = 0; i < 4; i++) {
      const [w, h] = texSize(chans[i]);
      u.iChannelResolution.value[i].set(w, h, 1);
    }
  }
}

// Where the sketch's own text begins in the compiled source, so a driver's
// line numbers can be renumbered against the string that was typed
const GLSL_MARK = '// --- sketch ---\n';

// The forms a body can be written in, told apart by shape: a whole shader with
// its own main(), a pasted mainImage(), a block of statements that assigns
// gl_FragColor, or a bare expression. The expression is the form a one-liner
// wants — .glsl('texture2D(tex0, vUv).bgra') is a call worth typing mid-set —
// and its type is the one thing the sketch shouldn't have to spell, so it gets
// tried as a vec4, then as a color with alpha 1, then as one gray level.
function glslForms(src) {
  // shaped by the trimmed text, embedded untrimmed: a template literal usually
  // opens with a newline, and eating it would put every line the compiler
  // reports one off from the line the sketch is looking at
  const shape = src.trim();
  const body = src.replace(/\s+$/, '');
  if (/\bvoid\s+main\s*\(/.test(shape)) return [GLSL_MARK + body];
  if (/\bmainImage\s*\(/.test(shape))
    return [`${GLSL_MARK}${body}\nvoid main() { mainImage(gl_FragColor, vUv / uTexel); }`];
  if (/\bgl_FragColor\b/.test(shape)) return [`void main() {\n${GLSL_MARK}${body}\n}`];
  const e = body.replace(/;\s*$/, '');
  return [
    `void main() {\n${GLSL_MARK}gl_FragColor = ${e};\n}`,
    `void main() {\n${GLSL_MARK}gl_FragColor = vec4(${e}, 1.0);\n}`,
    `void main() {\n${GLSL_MARK}gl_FragColor = vec4(vec3(${e}), 1.0);\n}`,
  ];
}

// One uniform slot: its GLSL type read off the value the sketch put there
// (sampled once, at t = 0), and how to write it every frame after. A number is
// a float, a 2/3/4 array is that vector — resolved a component at a time, so
// [t => …, 0.5] moves — and anything else is a color, which is what lands
// '#ff0044' and hsl(t => t, 1, 0.5) in the same vec3.
function glslSlot(name, v) {
  const probe = resolve(v, 0);
  if (typeof probe === 'number' || typeof probe === 'boolean') {
    return { init: 0, write: (u, t) => { u.value = Number(resolve(v, t)) || 0; } };
  }
  if (Array.isArray(probe) && probe.length >= 2 && probe.length <= 4) {
    const n = probe.length;
    return {
      init: new Array(n).fill(0),
      write: (u, t) => {
        const a = resolve(v, t) ?? [];
        const c = (i) => Number(resolve(a[i], t)) || 0;
        if (n === 2) u.value.set(c(0), c(1));
        else if (n === 3) u.value.set(c(0), c(1), c(2));
        else u.value.set(c(0), c(1), c(2), c(3));
      },
    };
  }
  if (probe == null || (typeof probe === 'object' && !probe.isColor)) {
    warn(`glsl: ${name} is not something a uniform can hold — a number, a 2/3/4 array, a color, a texture chain, or a fn of t returning one`);
    return null;
  }
  return { init: '#ffffff', write: (u, t) => setColor(u.value, v, t) };
}

function compileFrag(gl, source) {
  const sh = gl.createShader(gl.FRAGMENT_SHADER);
  gl.shaderSource(sh, source);
  gl.compileShader(sh);
  const ok = gl.getShaderParameter(sh, gl.COMPILE_STATUS) === true;
  const log = ok ? '' : gl.getShaderInfoLog(sh) || 'it would not compile';
  gl.deleteShader(sh);
  return { ok, log };
}

// The driver's first line, renumbered: everything after the colon is its
// wording, which is the part worth reading, and the number in front of it
// counts from a prefix the sketch never saw.
function glslWhere(log, offset) {
  const line = log.split('\n').find((l) => /\S/.test(l)) ?? 'it would not compile';
  return line.trim().replace(/^(?:ERROR|WARNING):\s*\d+:(\d+):?\s*/i, (m, n) => `line ${Math.max(1, Number(n) - offset)}: `);
}

// { mat, slots } once it compiles, { mat: null } once it doesn't — either way
// an answer, so the caller knows it has already asked.
function buildGlsl(node, renderer) {
  const { src, u: vals, tex: texNames } = node.params;
  const extras = {};
  const slots = [];
  for (const [name, v] of Object.entries(vals)) {
    const slot = glslSlot(name, v);
    if (!slot) continue;
    extras[name] = slot.init;
    slots.push({ name, write: slot.write });
  }
  // a name the sketch bound itself wins over our reading of it
  const taken = new Set([...Object.keys(vals), ...texNames]);
  const wanted = (n) => !taken.has(n) && mentions(src, n);
  const builtins = SHADERTOY_UNIFORMS.filter(([n]) => wanted(n));
  const pre =
    texNames.map((n) => `uniform sampler2D ${n};`).join('\n') + '\n' +
    builtins.map(([n, type]) => declOf(n, type)).join('\n') + '\n' +
    Object.entries(SHADERTOY_DEFINES).filter(([n]) => wanted(n)).map(([n, v]) => `#define ${n} ${v}`).join('\n') + '\n' +
    // only when it's wanted and the sketch hasn't brought its own: a pasted
    // shader with a snoise() of its own would otherwise redefine ours
    (/\bsnoise\s*\(/.test(src) && !/\bsnoise\s*\([^)]*\)\s*\{/.test(src) ? SNOISE_GLSL : '');

  const gl = renderer.getContext();
  let first;
  for (const frag of glslForms(src)) {
    const mat = makeMaterial({ extras, pre, frag });
    for (const n of texNames) mat.uniforms[n] = { value: null };
    for (const [n, , init] of builtins) mat.uniforms[n] = { value: init() };
    const whole = GLSL3_PRELUDE + mat.fragmentShader;
    const offset = whole.slice(0, whole.indexOf(GLSL_MARK) + GLSL_MARK.length).split('\n').length - 1;
    const { ok, log } = compileFrag(gl, whole);
    if (ok) return { mat, slots, builtins: builtins.length > 0 };
    mat.dispose();
    // the first reading is the one the sketch meant; the fallbacks exist to
    // save a `vec4(…, 1.0)`, and their errors would only say so twice
    first ??= glslWhere(log, offset);
  }
  warn(`glsl: ${first} — the pass is skipped`);
  return { mat: null, slots: [] };
}

// Both spellings land here: base is the chain a method was called on, absent
// for the generator, where tex0 is black rather than undefined.
export function glslNode(engine, source, uniforms, base = null) {
  if (typeof source !== 'string' || !source.trim()) {
    warn("glsl: needs a string of GLSL — glsl('vec4(vUv, 0.0, 1.0)')");
    return base ?? new TextureOp(engine, 'constant', { color: null });
  }
  if (source.includes('#include')) {
    // three resolves #include <chunk> itself and *throws* on a name it doesn't
    // know — from inside the render, which is the one place a throw takes the
    // video down. Refused here, where it's only a warning.
    warn('glsl: #include is three.js shader chunks, which a texture pass has none of — paste the function in instead');
    return base ?? new TextureOp(engine, 'constant', { color: null });
  }
  const vals = {};
  const tex = [];
  const maps = [];
  for (const [name, v] of Object.entries(uniforms ?? {})) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || name.startsWith('gl_') || GLSL_RESERVED.includes(name)) {
      warn(`glsl: '${name}' isn't a name a uniform can have here — ${GLSL_RESERVED.join(', ')} are the pass's own`);
      continue;
    }
    if (v instanceof TextureOp) { tex.push(name); maps.push(v); continue; }
    // The one ambiguous slot in the API: everywhere else a fn is a fn of t and
    // a texture slot's fn is a fn of the chain, and here both live in the same
    // object. Told apart by asking — a fn of t handed a chain comes back with
    // a number-shaped nothing, which is the value path anyway.
    if (typeof v === 'function' && base) {
      let asChain;
      try { asChain = v(base); } catch { /* a fn of t that dislikes the argument */ }
      if (asChain instanceof TextureOp) { tex.push(name); maps.push(asChain); continue; }
    }
    vals[name] = v;
  }
  return new TextureOp(
    engine,
    'glsl',
    { src: source, u: vals, tex, chained: !!base },
    base ? [base, ...maps] : maps,
  );
}

// 1×1 transparent: what a generator pass reads for tex0, nothing having come
// before it, and what one that failed to compile draws. Not black — under the
// premultiplied convention an opaque black frame paints over whatever a .comp()
// puts it on, and "no picture" shouldn't.
let CLEAR_TEX;
function clearTex() {
  if (!CLEAR_TEX) {
    CLEAR_TEX = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
    CLEAR_TEX.needsUpdate = true;
  }
  return CLEAR_TEX;
}

// 1×1 black fallback (video() before the camera stream is live)
let BLACK_TEX;
function blackTex() {
  if (!BLACK_TEX) {
    BLACK_TEX = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    BLACK_TEX.needsUpdate = true;
  }
  return BLACK_TEX;
}

// Where a 0..1 phase lands in a clip: wrapped while it loops, clamped when it
// doesn't, and never the exact duration — seeking there ends playback. null
// until the metadata arrives and the duration is known.
function phaseTime(ph, el) {
  const dur = el.duration;
  if (!(dur > 0) || !isFinite(dur)) return null;
  const w = el.loop ? ph - Math.floor(ph) : Math.min(Math.max(ph, 0), 1);
  return Math.min(w * dur, dur - 1e-3);
}

// A trigger slot wants a gate. Hand it a ramp — B, T, anything counting up —
// and it crosses the threshold once and never comes back, which reads as a
// broken jump rather than a wrong signal. The tell is a value parked above 1
// for seconds on end: a gate that fires is back down long before that, and one
// that isn't down isn't triggering anything either way.
function trigger(v, node, key, what) {
  const n = (node[key] = v > 1 ? (node[key] ?? 0) + 1 : 0);
  if (n === 120)
    warn(`${what}: this signal never comes back down, so it fires once and stops — a trigger has to return to 0. beat(4) is the tempo-synced gate; .sqr() shapes any ramp into one`);
  return v;
}

// Browsers only play a media element over a narrow range of rates — Chrome
// throws outside 0.0625..16 rather than clamping, and thrown from a render
// that would take the whole frame down with it. So the clamp happens here, the
// assignment is guarded for browsers with a range of their own, and it's said
// in the console only: a random speed landing out of range is not status-bar
// news. (0 is not a rate but a freeze, and every browser takes it. Backwards
// is not a rate either — no browser plays a media element in reverse.)
//
// Neither message quotes the offending number, unlike most warnings: the whole
// point is a speed that lands out of range on its own, and a value in the text
// would defeat the dedupe and print a line per frame.
const RATE_MIN = 0.0625;
const RATE_MAX = 16;

export function setRate(el, rate, what) {
  let r = rate;
  if (r < 0) {
    note(`${what}: speed can't go backwards — a media element only plays forwards. Freezing instead.`);
    r = 0;
  } else if (r !== 0) {
    r = Math.min(Math.max(r, RATE_MIN), RATE_MAX);
    if (r !== rate) note(`${what}: speed clamped to ${RATE_MIN}..${RATE_MAX}, the range the browser plays.`);
  }
  try {
    el.playbackRate = r;
  } catch {
    /* a narrower range than we know about; the last rate it took stands */
  }
}

function makeRT(w, h) {
  return new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType,
    depthBuffer: false,
  });
}

// .delay() is the one op that allocates *per frame of delay*, and a half-float
// frame is 8 bytes a pixel — at a retina 1080p drawing buffer that's ~47 MB
// each, so a second of history at full size would be three gigabytes and take
// the tab with it. Hence a budget; what's interesting is which way it bends.
//
// The frame count is what the sketch says, so it's the resolution that gives:
// a ring too big for the budget is stored smaller, not shorter. Truncating it
// instead would make .delay(30) mean thirty frames on one display and four on
// a retina one — the same sketch, a different length of time. Softer is a look;
// shorter is a different piece.
//
// Raising the budget is a poor lever anyway: the stored frame is two-
// dimensional, so 4× the memory is only 2× the linear resolution. 256 MB is
// what a tab can hold without risking the context, and quality()/resolution()
// are the real answers for a sketch that wants long history *and* detail.
const DELAY_BUDGET = 256 * 1024 * 1024;
// past this the picture is mush and the memory is still gone — cap frames instead
const DELAY_MIN_SCALE = 0.25;

const disposeRing = (hist) => {
  for (const rt of hist.ring ?? []) rt.dispose();
  hist.ring = null;
  hist.array?.dispose();
  hist.array = null;
};

// scratch for ctx.fbClear, which must put the renderer's clear color back
const clearColorTmp = new THREE.Color();
const disposeFlow = (hist) => {
  hist.prev?.dispose();
  hist.cur?.dispose();
  hist.prev = hist.cur = null;
};

// The size to store `frames + 1` of this buffer at, and the count that fits if
// even the floor isn't enough. Fitted against the ring's high-water mark, never
// the current frame count, so an animated delay doesn't rebuild itself hunting
// for a scale.
function delayFit(frames, scale, w, h) {
  const room = DELAY_BUDGET / 8 / (frames + 1);      // pixels a stored frame may have
  const fit = Math.sqrt(room / (w * h));
  if (fit >= scale) return { frames, scale };
  if (fit >= DELAY_MIN_SCALE) {
    warn(`delay(${frames}): history stored at ${Math.round(fit * 100)}% of frame size to fit in memory — set { scale } to choose for yourself`);
    return { frames, scale: fit };
  }
  const max = Math.max(1, Math.floor(DELAY_BUDGET / 8 / (w * h * DELAY_MIN_SCALE ** 2)) - 1);
  warn(`delay(${frames}): too much history even at quarter size — holding ${max} frames. resolution() or quality() is what buys more`);
  return { frames: max, scale: DELAY_MIN_SCALE };
}

// shared single-purpose pass materials (used sequentially, so sharing is safe)
let MAT_COPY, MAT_BRIGHT, MAT_BLUR, MAT_COMBINE, MAT_TONEMAP, MAT_OVER, MAT_STACK, MAT_PLATE, MAT_TOLINEAR, MAT_DELAY_MAP,
  MAT_FLOW, MAT_SWALL, MAT_SSCAN, MAT_SKEY, MAT_SOEM, MAT_SGATHER, MAT_SSHEAR, MAT_JPEG,
  MAT_SDF_SEED, MAT_SDF_STEP, MAT_SDF_OUT;
function ensurePassMaterials() {
  MAT_COPY ??= makeMaterial(SPECS.copy);
  // one Lucas–Kanade step: tex0 this frame, tex1 last, both luma. The estimate
  // v = -It·∇I / (|∇I|² + ε) only sees ~a texel of motion — the coarse buffer
  // it runs in and the blur after it are what make it read as a field.
  MAT_FLOW ??= makeMaterial({
    extras: { uGain: 1 },
    frag: `
      float lum(sampler2D t, vec2 o) { return dot(texture2D(t, vUv + o * uTexel).rgb, LUMA); }
      void main() {
        vec2 g = vec2(lum(tex0, vec2(1.0, 0.0)) - lum(tex0, vec2(-1.0, 0.0)),
                      lum(tex0, vec2(0.0, 1.0)) - lum(tex0, vec2(0.0, -1.0))) * 0.5;
        float it = lum(tex0, vec2(0.0)) - lum(tex1, vec2(0.0));
        vec2 v = -it * g / (dot(g, g) + 1e-4);
        gl_FragColor = vec4(clamp(v * uGain + 0.5, 0.0, 1.0), 0.5, 1.0);
      }`,
  });
  // One axis of an 8-point DCT (orthonormal DCT-II, inverse DCT-III), run
  // rows-then-cols forward and cols-then-rows back — .jpeg() is four of these.
  // The color flags convert to Y'CbCr on the way in and back on the way out,
  // so the quantize step (second forward pass, where both axes are frequency)
  // can hit chroma harder than luma — which is where the color fringing at
  // block edges comes from. uCorrupt re-rolls random blocks' AC coefficients
  // by a random gain: ringing garbage in exactly those blocks.
  MAT_JPEG ??= makeMaterial({
    extras: { uAxis: [1, 0], uInverse: 0, uColorIn: 0, uColorOut: 0, uQuant: 0, uStep: 0.1, uCorrupt: 0, uSeed: 0 },
    frag: `
      vec3 toYCC(vec3 c) {
        float y = dot(c, vec3(0.299, 0.587, 0.114));
        return vec3(y, (c.b - y) * 0.564, (c.r - y) * 0.713);
      }
      vec3 toRGB(vec3 v) {
        return vec3(v.x + 1.403 * v.z, v.x - 0.344 * v.y - 0.714 * v.z, v.x + 1.773 * v.y);
      }
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        // floor first: the index must be exact, because a boundary texel that
        // rounds into the wrong block lands at k = 8, where every basis cosine
        // is ~0 — a black line down every eighth row
        vec2 px = floor(vUv / uTexel);              // integer texel coords
        float along = dot(px, uAxis);
        float block = floor(along / 8.0) * 8.0;
        float k = along - block;                    // 0..7 inside the block
        vec3 acc = vec3(0.0);
        for (int n = 0; n < 8; n++) {
          float fn = float(n);
          vec3 s = texture2D(tex0, (px + (block + fn - along) * uAxis + 0.5) * uTexel).rgb;
          if (uColorIn > 0.5) s = toYCC(s);
          float c, ang;
          if (uInverse < 0.5) { c = k  < 0.5 ? 0.35355339 : 0.5; ang = 3.14159265 * (2.0 * fn + 1.0) * k  / 16.0; }
          else                { c = fn < 0.5 ? 0.35355339 : 0.5; ang = 3.14159265 * (2.0 * k  + 1.0) * fn / 16.0; }
          acc += s * c * cos(ang);
        }
        if (uQuant > 0.5) {
          vec2 loc = mod(px, 8.0);                  // (u, v) inside the block
          float f = loc.x + loc.y;
          vec2 blockId = floor(px / 8.0);
          if (uCorrupt > 0.0 && f > 0.5 && hash(blockId + uSeed) < uCorrupt) {
            acc *= 6.0 * hash(blockId * 7.13 + loc + uSeed) - 3.0;
          }
          // higher frequencies get coarser steps, the JPEG table's shape;
          // chroma twice as coarse as luma
          float stepY = uStep * (1.0 + f * 0.7);
          acc.x  = floor(acc.x  / stepY + 0.5) * stepY;
          acc.yz = floor(acc.yz / (stepY * 2.0) + 0.5) * (stepY * 2.0);
        }
        if (uColorOut > 0.5) acc = toRGB(acc);
        gl_FragColor = vec4(acc, texture2D(tex0, vUv).a);
      }`,
  });
  // Pixel sort, converged every frame. Any *iterated* exchange step shows a
  // partial state — displaced rows interleaved with stayers, the scanline
  // combing and ghost-copy artifacts — so instead: build a per-texel key
  // (span anchor, signed luma, home row), run a full Batcher odd-even merge
  // network over the keys, and gather the picture through the sorted rows
  // once. Only the finished sort is ever visible.
  //
  // Walls anchor at their own row, so the network puts them straight back;
  // span pixels share their span's start row, so they sort within it.
  MAT_SWALL ??= makeMaterial({
    extras: { uAxis: [0, 1], uThresh: 0.35, uJitter: 0, uThMap: 0, uSlope: 0, uOff: 0, uSTexel: [0, 0] },
    frag: `
      float hash(float p) { return fract(sin(p * 127.1) * 43758.5453); }
      void main() {
        vec2 idx = floor(vUv / uTexel);
        float i = dot(idx, uAxis);
        // a texture in the threshold slot sets it per pixel (its luma). The
        // frame may be sheared for an off-axis dir while the map is not, so
        // the map reads through the same shear the frame went through.
        float th = uThresh;
        if (uThMap > 0.5) {
          vec2 idc = idx + 0.5, cross_ = vec2(uAxis.y, uAxis.x);
          float sc = dot(idc, cross_) - uOff + uSlope * dot(idc, uAxis);
          th = dot(texture2D(tex1, uAxis * (dot(idc, uAxis) * dot(uSTexel, uAxis)) + cross_ * (sc * dot(uSTexel, cross_))).rgb, LUMA);
        }
        // jitter scatters the threshold per column either way, so
        // neighboring columns break spans at different lumas
        th += (hash(dot(idx, vec2(uAxis.y, uAxis.x))) - 0.5) * uJitter;
        vec4 c = texture2D(tex0, vUv);
        float lum = dot(c.rgb, LUMA);
        // strictly below: threshold 0 walls nothing, so pure black sorts too
        // (the tonemap crushes dark backgrounds to exact 0). Transparency is
        // always a wall — off-frame shear padding must not pour in as black.
        gl_FragColor = vec4(lum < th || c.a <= 0.0 ? i : -1.0, 0.0, 0.0, 1.0);
      }`,
  });
  // running max along the axis (one jump of 2^k a pass): each texel ends up
  // knowing the nearest wall at or above it
  MAT_SSCAN ??= makeMaterial({
    extras: { uAxis: [0, 1], uJump: 1 },
    frag: `
      void main() {
        float i = dot(floor(vUv / uTexel), uAxis);
        float me = texture2D(tex0, vUv).r;
        float prev = (i - uJump) < 0.0 ? -1.0 : texture2D(tex0, vUv - uAxis * uTexel * uJump).r;
        gl_FragColor = vec4(max(me, prev), 0.0, 0.0, 1.0);
      }`,
  });
  // tex0 = source, tex1 = wall scan. No wall above scans to -1, so the top
  // span anchors at row 0.
  MAT_SKEY ??= makeMaterial({
    extras: { uAxis: [0, 1], uSign: 1, uLen: 0 },
    frag: `
      float hash(float p) { return fract(sin(p * 127.1) * 43758.5453); }
      void main() {
        vec2 idx = floor(vUv / uTexel);
        float i = dot(idx, uAxis);
        float wall = texture2D(tex1, vUv).r;
        float lum = dot(texture2D(tex0, vUv).rgb, LUMA);
        bool isWall = wall == i;
        float anchor = isWall ? i : wall + 1.0;
        // a length cap cuts the span into uLen-long segments that sort
        // separately, the cuts phased per column so they don't line up into
        // a horizontal seam. 0 = uncapped: the span is the streak.
        if (!isWall && uLen > 0.5) {
          float off = floor(hash(dot(idx, vec2(uAxis.y, uAxis.x)) + 7.7) * uLen);
          anchor = max(anchor + floor((i - anchor + off) / uLen) * uLen - off, anchor);
        }
        gl_FragColor = vec4(anchor, isWall ? -2.0 : lum * uSign, i, 1.0);
      }`,
  });
  // one comparator layer of Batcher's odd-even merge sort (stage uP,
  // substage uK). Every comparator sends the min to the lower index, so a
  // column shorter than the padded power of two behaves as if padded with
  // +inf keys that never move — arbitrary heights just work.
  MAT_SOEM ??= makeMaterial({
    extras: { uAxis: [0, 1], uP: 1, uK: 1, uCount: 2 },
    frag: `
      bool lessK(vec4 a, vec4 b) { return a.r < b.r || (a.r == b.r && a.g < b.g); }
      void main() {
        float i = dot(floor(vUv / uTexel), uAxis);
        vec4 me = texture2D(tex0, vUv);
        float k2 = uK * 2.0;
        float base = mod(uK, uP);
        vec2 stepv = uAxis * uTexel;
        float r = mod(i, k2);
        if (r >= base && r < base + uK && i + uK < uCount
            && floor(i / (uP * 2.0)) == floor((i + uK) / (uP * 2.0))) {
          vec4 other = texture2D(tex0, vUv + stepv * uK);
          gl_FragColor = lessK(other, me) ? other : me;   // low side keeps the min
          return;
        }
        float r2 = mod(i - uK, k2);
        if (i - uK >= 0.0 && r2 >= base && r2 < base + uK
            && floor((i - uK) / (uP * 2.0)) == floor(i / (uP * 2.0))) {
          vec4 other = texture2D(tex0, vUv - stepv * uK);
          gl_FragColor = lessK(me, other) ? other : me;   // high side keeps the max
          return;
        }
        gl_FragColor = me;
      }`,
  });
  // tex0 = source, tex1 = sorted keys: each row reads the source row that
  // belongs at it, so payloads (alpha included) move whole
  MAT_SGATHER ??= makeMaterial({
    extras: { uAxis: [0, 1] },
    frag: `
      void main() {
        float row = texture2D(tex1, vUv).b;
        vec2 uv = vUv - uAxis * dot(vUv, uAxis) + uAxis * ((row + 0.5) * dot(uTexel, uAxis));
        gl_FragColor = texture2D(tex0, uv);
      }`,
  });
  // shear resample for off-axis dirs: the requested direction becomes exactly
  // vertical (or horizontal) in a wider buffer, the sort runs on integer
  // texel lines as always, and the inverse shear puts it back. Off-frame
  // reads land transparent black, which the sorter treats as walls.
  MAT_SSHEAR ??= makeMaterial({
    extras: { uAxis: [0, 1], uSlope: 0, uOff: 0, uSTexel: [0, 0] },
    frag: `
      void main() {
        vec2 idx = floor(vUv / uTexel) + 0.5;
        vec2 cross_ = vec2(uAxis.y, uAxis.x);
        float along = dot(idx, uAxis);
        float sc = dot(idx, cross_) - uOff + uSlope * along;
        vec2 suv = uAxis * (along * dot(uSTexel, uAxis)) + cross_ * (sc * dot(uSTexel, cross_));
        gl_FragColor = (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0)
          ? vec4(0.0) : texture2D(tex0, suv);
      }`,
  });
  // per-pixel delay: tex0 is the frames map (luma 0..1 spans 0..uMax frames
  // back), uHist the history ring as one array texture. A fractional depth
  // blends the two frames it straddles, so a smooth map is a smooth smear of
  // time rather than a staircase of them.
  if (!MAT_DELAY_MAP) {
    MAT_DELAY_MAP = makeMaterial({
      extras: { uSlot: 0, uLen: 1, uMax: 0 },
      pre: 'uniform sampler2DArray uHist;\n',
      frag: `
        void main() {
          float f = clamp(dot(texture2D(tex0, vUv).rgb, LUMA), 0.0, 1.0) * uMax;
          float back = floor(f);
          float l0 = mod(uSlot - 1.0 - back + 2.0 * uLen, uLen);
          float l1 = mod(l0 - 1.0 + uLen, uLen);
          gl_FragColor = mix(texture(uHist, vec3(vUv, l0)), texture(uHist, vec3(vUv, l1)), fract(f));
        }`,
    });
    MAT_DELAY_MAP.uniforms.uHist = { value: null };
  }
  // the decode a chain feeding a color map slot ends on — here it's the pass
  // that writes a tile set's layers, which are read as a map (see SPECS.toLinear)
  MAT_TOLINEAR ??= makeMaterial(SPECS.toLinear);
  // premultiplied source-over, for stacking several naked .out()s
  MAT_OVER ??= makeMaterial({
    frag: `
      void main() {
        vec4 a = texture2D(tex0, vUv);   // under
        vec4 b = texture2D(tex1, vUv);   // over
        float ba = clamp(b.a, 0.0, 1.0);
        gl_FragColor = vec4(b.rgb + a.rgb * (1.0 - ba), ba + a.a * (1.0 - ba));
      }`,
  });
  // a stacked .out() that asked for a blend mode: the comp pass, base-aware
  if (!MAT_STACK) {
    MAT_STACK = makeMaterial(SPECS.comp);
    MAT_STACK.uniforms.uStack.value = 1;
  }
  // the same thing with bg() underneath instead of another chain — the last
  // step to the canvas, so whatever the stack left transparent lands on the
  // background rather than on the clear color
  MAT_PLATE ??= makeMaterial({
    extras: { uBg: [0, 0, 0, 1] },
    frag: `
      void main() {
        vec4 c = texture2D(tex0, vUv);
        float ca = clamp(c.a, 0.0, 1.0);
        gl_FragColor = vec4(c.rgb + uBg.rgb * (1.0 - ca), ca + uBg.a * (1.0 - ca));
      }`,
  });
  // three only tone-maps + sRGB-encodes when rendering to the canvas, so the
  // scene lands in its RT linear. This pass replicates the renderer's ACES
  // filmic + sRGB output at the scene→texture boundary; downstream ops then see
  // exactly what a direct render would have shown.
  MAT_TONEMAP ??= makeMaterial({
    extras: { uKeepAlpha: 0 },
    frag: `
      vec3 RRTAndODTFit(vec3 v) {
        vec3 a = v * (v + 0.0245786) - 0.000090537;
        vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
        return a / b;
      }
      void main() {
        const mat3 ACESInputMat = mat3(
          vec3( 0.59719, 0.07600, 0.02840 ),
          vec3( 0.35458, 0.90834, 0.13383 ),
          vec3( 0.04823, 0.01566, 0.83777 )
        );
        const mat3 ACESOutputMat = mat3(
          vec3(  1.60475, -0.10208, -0.00327 ),
          vec3( -0.53108,  1.10813, -0.07276 ),
          vec3( -0.07367, -0.00605,  1.07602 )
        );
        vec4 s = texture2D(tex0, vUv);
        vec3 c = ACESInputMat * (s.rgb / 0.6);
        c = clamp(ACESOutputMat * RRTAndODTFit(c), 0.0, 1.0);
        c = mix(pow(c, vec3(0.41666)) * 1.055 - 0.055, c * 12.92, vec3(lessThanEqual(c, vec3(0.0031308))));
        // uKeepAlpha 1: a geometry layer's real coverage, off its transparent
        // clear. 0: the display scene — it sits on an opaque background, so
        // its honest coverage is 1 even where blended materials smudged the
        // GL destination alpha.
        gl_FragColor = vec4(c, mix(1.0, s.a, uKeepAlpha));
      }`,
  });
  MAT_BRIGHT ??= makeMaterial({
    extras: { uThresh: 0.7 },
    frag: `
      void main() {
        vec4 c = texture2D(tex0, vUv);
        gl_FragColor = vec4(max(c.rgb - uThresh, 0.0) / max(1.0 - uThresh, 0.001), c.a);
      }`,
  });
  MAT_BLUR ??= makeMaterial({
    extras: { uDir: [1, 0] },
    frag: `
      void main() {
        float w[5];
        w[0] = 0.227027; w[1] = 0.1945946; w[2] = 0.1216216; w[3] = 0.054054; w[4] = 0.016216;
        // all four channels: blurring premultiplied rgba is the correct blur
        // of a transparent image, feathered coverage included
        vec4 c = texture2D(tex0, vUv) * w[0];
        for (int i = 1; i < 5; i++) {
          vec2 o = uDir * uTexel * float(i);
          c += texture2D(tex0, vUv + o) * w[i];
          c += texture2D(tex0, vUv - o) * w[i];
        }
        gl_FragColor = c;
      }`,
  });
  // --- jump flood distance field, three passes' worth of material ---------
  // Seed: mark the pixels the boundary runs through. A pixel whose four
  // neighbours don't all agree about being inside straddles the edge, which
  // works on a hard mask and a feathered one alike. rg is the vector to the
  // nearest edge (nothing yet), b says whether one has been found, a
  // remembers which side of the threshold this pixel started on.
  MAT_SDF_SEED ??= makeMaterial({
    extras: { uThreshold: 0.5 },
    frag: `
      float inside(vec2 p) { return step(uThreshold, dot(texture2D(tex0, p).rgb, LUMA)); }
      void main() {
        float c = inside(vUv);
        float n = abs(c - inside(vUv + vec2(uTexel.x, 0.0)))
                + abs(c - inside(vUv - vec2(uTexel.x, 0.0)))
                + abs(c - inside(vUv + vec2(0.0, uTexel.y)))
                + abs(c - inside(vUv - vec2(0.0, uTexel.y)));
        gl_FragColor = vec4(0.0, 0.0, step(0.5, n), c);
      }`,
  });
  // One flood round: look at the eight neighbours uJump texels away, and keep
  // whichever edge point is closest — theirs, offset by the hop, or the one
  // already held. Halving the hop each round spreads every seed across the
  // frame in log2(size) passes rather than a search per pixel. Distances are
  // measured in the aspect-corrected space so "nearest" means nearest on
  // screen, while the offsets stay in UV so a displace can use them as they are.
  MAT_SDF_STEP ??= makeMaterial({
    extras: { uJump: 1 },
    frag: `
      void main() {
        vec4 me = texture2D(tex0, vUv);
        vec2 best = me.rg;
        float bestD = me.b > 0.5 ? length(best * vec2(uAspect, 1.0)) : 1e9;
        for (int j = -1; j <= 1; j++) {
          for (int i = -1; i <= 1; i++) {
            vec2 d = vec2(float(i), float(j)) * uJump * uTexel;
            vec2 suv = vUv + d;
            // outside the frame the sampler clamps, which would hand back the
            // border pixel's offset as if it belonged out there — a seed that
            // isn't, and the streaks and flat far field that come with it
            if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) continue;
            vec4 n = texture2D(tex0, suv);
            if (n.b > 0.5) {
              vec2 cand = n.rg + d;
              float dist = length(cand * vec2(uAspect, 1.0));
              if (dist < bestD) { bestD = dist; best = cand; }
            }
          }
        }
        gl_FragColor = vec4(best, step(bestD, 1e8), me.a);
      }`,
  });
  // The field, in whichever encoding was asked for. 0: unit vector toward the
  // nearest edge, 0.5-neutral, which is what .displace() reads. 1: signed
  // distance as gray, 0.5 at the edge and darker inside. 2: the offset itself,
  // clipped to uStep — a step that lands *on* the edge and never past it.
  MAT_SDF_OUT ??= makeMaterial({
    extras: { uMode: 0, uSpread: 0.25, uStep: 0.1 },
    frag: `
      void main() {
        vec4 f = texture2D(tex0, vUv);
        vec2 off = f.rg;
        float d = length(off * vec2(uAspect, 1.0));
        float spread = max(uSpread, 1e-4);
        if (uMode < 0.5) {
          vec2 dir = d > 1e-6 ? off / d : vec2(0.0);
          gl_FragColor = vec4(dir * 0.5 + 0.5, clamp(d / spread, 0.0, 1.0), 1.0);
        } else if (uMode < 1.5) {
          float sgn = f.a > 0.5 ? -1.0 : 1.0;
          gl_FragColor = vec4(vec3(clamp(sgn * d / spread * 0.5 + 0.5, 0.0, 1.0)), 1.0);
        } else {
          vec2 mv = d > 1e-6 ? off * min(1.0, uStep / d) : vec2(0.0);
          gl_FragColor = vec4(mv + 0.5, 0.0, 1.0);
        }
      }`,
  });
  MAT_COMBINE ??= makeMaterial({
    // uColor tints the glow without touching the picture under it, which is
    // halation: on film the light that scatters back off the base is red, so a
    // warm glow around a highlight reads as an emulsion and a white one as a
    // lens
    extras: { uStrength: 1, uColor: [1, 1, 1] },
    frag: `
      void main() {
        vec4 b = texture2D(tex0, vUv);
        gl_FragColor = vec4(b.rgb + texture2D(tex1, vUv).rgb * uStrength * uColor, b.a);
      }`,
  });
}

export function runPass(ctx, material, tex0, tex1, target, setup, layer = 0) {
  const u = material.uniforms;
  u.tex0.value = tex0 ?? null;
  u.tex1.value = tex1 ?? null;
  const w = target ? target.width : ctx.w, h = target ? target.height : ctx.h;
  u.uTexel.value.set(1 / w, 1 / h);
  u.uAspect.value = ctx.aspect;
  u.uTime.value = ctx.t;
  u.uFrame.value = ctx.runFrame;
  u.uDelta.value = ctx.dt;
  setup?.(u);
  ctx.quad.render(ctx.renderer, material, target, layer);
}

// A 9-tap gaussian pass holds together to a tap spacing of a couple of
// texels; past that the gaps between its taps show up as blocks. A big
// radius is walked in doubling steps instead — each pass reads pixels the
// passes before it already smoothed, so the wide spacings stay smooth. Blur
// widths add in quadrature, so the steps are sized so their squares sum to
// the radius asked for. Ping-pongs between the two targets and returns
// whichever texture holds the result.
function gaussianBlur(ctx, src, a, b, rx, ry) {
  const R = Math.max(rx, ry);
  if (!(R > 0)) return src;
  const steps = [];
  let sum = 0;
  for (let s = 1; sum + s * s < R * R; s *= 2) { steps.push(s); sum += s * s; }
  const rest = Math.sqrt(R * R - sum);
  if (rest > 0.25 || !steps.length) steps.push(rest);
  let cur = src, dst = a;
  for (const s of steps) {
    const fx = (rx / R) * s, fy = (ry / R) * s;
    for (const [dx, dy] of fx > 0 && fy > 0 ? [[fx, 0], [0, fy]] : [[fx, fy]]) {
      runPass(ctx, MAT_BLUR, cur, null, dst, (u) => u.uDir.value.set(dx, dy));
      cur = dst.texture;
      dst = dst === a ? b : a;
    }
  }
  return cur;
}

// Font files for the 2D text generator: a .ttf/.otf/.woff/.woff2 URL is
// registered as a FontFace once; the text node redraws when it finishes
// loading (canvas falls back to the default face until then).
const cssFontCache = new Map();
function cssFont(spec, weight = 400) {
  // bare names hit installed fonts natively via canvas; 'google:Name' fetches
  // from Google Fonts through the dev-server proxy, URLs load as FontFace
  const google = /^google:/i.test(spec);
  if (!google && !/\.(ttf|otf|woff2?)(\?|$)/i.test(spec)) return { family: spec, loaded: true };
  const url = google ? `/api/gfont/${encodeURIComponent(spec.slice(7))}?weight=${weight}` : spec;
  const key = google ? `${spec.toLowerCase()}|${weight}` : spec;
  let entry = cssFontCache.get(key);
  if (!entry) {
    entry = { family: `td-font-${cssFontCache.size}`, loaded: false };
    cssFontCache.set(key, entry);
    new FontFace(entry.family, `url("${url}")`).load()
      .then((f) => { document.fonts.add(f); entry.loaded = true; })
      .catch((e) => warn(`font ${spec}: ${e.message ?? e}`));
  }
  return entry;
}

// --- 2D text layout ---------------------------------------------------------
//
// Wrapping, and the size search behind fit(). A glyph's advance is linear in
// font size, so every run is measured once at a reference size and each
// candidate size is arithmetic from there — which is what makes fitting a
// string that changes thirty times a second affordable.
const REF_PX = 100;

// The string as runs: words, the whitespace between them, and the newlines,
// each carrying where it starts. Line breaking has to keep character offsets,
// because a mark is a range into the string and a line needs to know which
// part of it it is.
function textRuns(g, str, family, weight, trackingEm) {
  g.font = `${weight} ${REF_PX}px ${family}`;
  if ('letterSpacing' in g) g.letterSpacing = `${trackingEm * REF_PX}px`;
  const runs = [];
  for (const m of str.matchAll(/\n|[^\S\n]+|\S+/g)) {
    const text = m[0];
    const br = text === '\n';
    runs.push({
      start: m.index,
      end: m.index + text.length,
      br,
      space: !br && /\s/.test(text[0]),
      w: br ? 0 : g.measureText(text).width,
    });
  }
  return runs;
}

// A word with no box to fit in breaks inside itself rather than running off
// the edge. The proportional guess is exact for a monospace face and within a
// character or two of anything else, which the measured back-off closes.
function breakWord(lines, start, end, maxW, measure) {
  let s = start;
  while (s < end) {
    let w = measure(s, end);
    if (w <= maxW) { lines.push({ start: s, end, w }); return; }
    let n = Math.max(1, Math.floor((end - s) * (maxW / w)));
    w = measure(s, s + n);
    while (n > 1 && w > maxW) w = measure(s, s + --n);
    lines.push({ start: s, end: s + n, w });
    s += n;
  }
}

// Greedy line breaking at run boundaries. A line's trailing spaces stay out of
// what gets drawn but still count toward where the next line starts, so the
// offsets stay true to the original string.
function wrapRuns(runs, scale, maxW, measure) {
  const lines = [];
  let cur = null, pend = 0, endAt = 0, afterBreak = false;
  const flush = () => { if (cur) lines.push(cur); cur = null; pend = 0; };
  for (const r of runs) {
    endAt = r.end;
    if (r.br) {
      // n newlines are n + 1 lines, trailing one included: the block is
      // centered on how many lines it has, so 'a\n' sits a half line high
      lines.push(cur ?? { start: r.start, end: r.start, w: 0 });
      cur = null;
      pend = 0;
      afterBreak = true;
      continue;
    }
    afterBreak = false;
    if (r.space) { if (cur) pend += r.w * scale; continue; }
    const w = r.w * scale;
    if (cur && cur.w + pend + w <= maxW) {
      cur.w += pend + w;
      cur.end = r.end;
      pend = 0;
      continue;
    }
    flush();
    if (w <= maxW) cur = { start: r.start, end: r.end, w };
    else breakWord(lines, r.start, r.end, maxW, measure);
  }
  if (cur) flush();
  else if (afterBreak) lines.push({ start: endAt, end: endAt, w: 0 });
  return lines;
}

// { fontPx, lines }. Without a fit box the size is the one asked for; with
// one, the largest size whose wrapped lines still fit inside it. The predicate
// is monotone — bigger type wraps to more lines and stands taller — so the
// answer is a bisection, twelve of which lands well inside a pixel.
function layoutText(g, str, o) {
  const runs = textRuns(g, str, o.family, o.weight, o.trackingEm);
  const at = (fontPx) => {
    const scale = fontPx / REF_PX;
    return wrapRuns(runs, scale, o.maxW, (a, b) => g.measureText(str.slice(a, b)).width * scale);
  };
  if (!o.fit) return { fontPx: o.fontPx, lines: at(o.fontPx) };
  let lo = 0, hi = Math.max(1, o.cap), best = null;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    const lines = at(mid);
    if (lines.length * mid * o.leadingEm <= o.maxH + 0.01) {
      lo = mid;
      best = { fontPx: mid, lines };
    } else hi = mid;
  }
  // nothing fit at any size the search tried: draw at the smallest it reached
  return best ?? { fontPx: hi, lines: at(hi) };
}

// The frame, drawn. Lines come from layoutText; ranges are marks to pick out
// of them. Separate from the node mostly because the index math earns being
// readable on its own: a mark has to land on the same glyphs the text does, so
// nothing here lets the canvas align a line — every run is placed by measure.
function paintText(g, str, layout, o) {
  const { fontPx, lines } = layout;
  const lineH = o.leadingEm * fontPx;
  const tracking = o.trackingEm * fontPx;
  if (o.bg == null) g.clearRect(0, 0, o.w, o.h);
  else {
    g.fillStyle = o.bg;
    g.fillRect(0, 0, o.w, o.h);
  }
  g.font = `${o.weight} ${Math.round(fontPx)}px ${o.family}`;
  if ('letterSpacing' in g) g.letterSpacing = `${tracking}px`;
  else if (tracking) warn('text: tracking needs canvas letterSpacing, which this browser lacks — drawing it untracked');
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  const x0 = o.px * o.w;
  const y0 = (1 - o.py) * o.h - ((lines.length - 1) * lineH) / 2;
  const padPx = o.markPadEm * fontPx;
  const dim = o.modes.includes('dim');
  const fill = o.modes.includes('fill');
  const stroked = o.modes.includes('box') || o.modes.includes('underline') || o.modes.includes('circle');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const lineText = str.slice(l.start, l.end);
    if (!lineText) continue;
    const m = g.measureText(lineText);
    // the canvas spaces after the last glyph too, which drags anything but
    // 'left' off its anchor by that trailing gap
    const visual = m.width - tracking;
    const left = o.align === 'center' ? x0 - visual / 2 : o.align === 'right' ? x0 - visual : x0;
    const y = y0 + i * lineH;
    const asc = m.fontBoundingBoxAscent ?? fontPx * 0.72;
    const desc = m.fontBoundingBoxDescent ?? fontPx * 0.28;
    const xAt = (i0) => (i0 <= l.start ? left : left + g.measureText(str.slice(l.start, i0)).width);
    // this line's share of the marks, clipped to it and placed in px
    const spans = [];
    for (const [a, b] of o.ranges) {
      const s = Math.max(a, l.start), e = Math.min(b, l.end);
      // the right edge sits before the trailing letter-space, which the
      // advance width of the run includes
      if (e > s) spans.push([s, e, xAt(s), xAt(e) - tracking]);
    }
    if (fill) {
      g.fillStyle = o.markColor;
      for (const [, , x1, x2] of spans)
        g.fillRect(x1 - padPx, y - asc - padPx, x2 - x1 + padPx * 2, asc + desc + padPx * 2);
    }
    // the glyphs, in runs that alternate unmarked/marked — which is what lets
    // a mark recolor its own characters, or a dim leave them at full strength
    const cuts = [l.start];
    for (const [a, b] of spans) cuts.push(a, b);
    cuts.push(l.end);
    for (let k = 0; k + 1 < cuts.length; k++) {
      const a = cuts[k], b = cuts[k + 1];
      if (b <= a) continue; // kept in the walk, so the parity still holds
      const marked = k % 2 === 1;
      g.globalAlpha = dim && !marked ? o.dimA : 1;
      g.fillStyle = marked ? o.onColor ?? (fill ? o.bg ?? '#000000' : o.color) : o.color;
      g.fillText(str.slice(a, b), xAt(a), y);
    }
    g.globalAlpha = 1;
    if (spans.length && stroked) {
      g.strokeStyle = o.markColor;
      g.lineWidth = Math.max(1, o.markWeightEm * fontPx);
      for (const [, , sx1, sx2] of spans) {
        const x1 = sx1 - padPx, x2 = sx2 + padPx;
        const top = y - asc - padPx, h = asc + desc + padPx * 2;
        if (o.modes.includes('box')) g.strokeRect(x1, top, x2 - x1, h);
        if (o.modes.includes('underline')) {
          g.beginPath();
          g.moveTo(x1, y + desc + padPx);
          g.lineTo(x2, y + desc + padPx);
          g.stroke();
        }
        if (o.modes.includes('circle')) {
          g.beginPath();
          g.ellipse((x1 + x2) / 2, y, (x2 - x1) / 2 + padPx, h / 2 + padPx, 0, 0, Math.PI * 2);
          g.stroke();
        }
      }
    }
  }
}

const MARK_MODES = ['box', 'fill', 'underline', 'circle', 'dim', 'none'];

// ascii() vocabularies, ordered dark→bright — the ordering *is* the mapping,
// so a set that isn't sorted by ink coverage reads as noise. Each starts with
// a space so black stays empty. A `chars` that isn't one of these names is
// taken literally, which is the escape hatch for any set not listed.
const ASCII_SETS = {
  ascii: ' .:-=+*#%@',
  dense: " .'`^\",:;Il!i~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$",
  blocks: ' ░▒▓█',
  numbers: ' 1743256908',
  letters: ' ilcvxsoenaghkbdmwqCXKOBMW',
  binary: ' 01',
  dots: ' .·•',
};
export const ASCII_SET_NAMES = Object.keys(ASCII_SETS);

const ASCII_FONT = 'ui-monospace, Menlo, monospace';
const ASCII_GLYPH_PX = 48;

// The vocabulary drawn once into a strip of equal cells, white on black, for
// the pass to index by luma. The cell is the widest advance in the set by the
// line height — that ratio is what keeps the glyphs unstretched on screen, so
// it comes back out as `aspect` for the row count to use.
function asciiAtlas(chars, font, weight) {
  const canvas = document.createElement('canvas');
  const g = canvas.getContext('2d');
  const face = `${weight} ${ASCII_GLYPH_PX}px ${font}`;
  g.font = face;
  const cw = Math.ceil(Math.max(1, ...chars.map((c) => g.measureText(c).width)));
  const ch = Math.ceil(ASCII_GLYPH_PX * 1.2);
  const pad = 2;
  canvas.width = (cw + pad * 2) * chars.length;
  canvas.height = ch + pad * 2;
  g.font = face;                     // resizing the canvas resets the context
  g.fillStyle = '#000000';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  chars.forEach((c, i) => g.fillText(c, i * (cw + pad * 2) + pad + cw / 2, pad + ch / 2));
  const tex = new THREE.CanvasTexture(canvas);
  // mip levels would blend the whole strip together horizontally, so one glyph
  // would fade into the next as the cells get small
  tex.generateMipmaps = false;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  return {
    tex,
    count: chars.length,
    aspect: cw / ch,
    pad: [pad / (cw + pad * 2), pad / (ch + pad * 2)],
  };
}

// Structural identity for tile-variant dedupe: the fn builds a fresh chain per
// cell, so node identity can't be compared — kind + params (fns by source and
// sampled outputs) + input signatures can. Cached on the node; chains are
// immutable so it's safe.
// Sampling matters: rand(1, i) has the same source for every i — the seed only
// exists in closure state — so source alone would merge cells that differ.
function fnSig(fn) {
  let sampled;
  try { sampled = JSON.stringify([fn(0.7391), fn(2.4173)]); } catch { sampled = '?'; }
  return fn.toString() + '~' + sampled;
}
function sigOf(node) {
  node._sig ??=
    node.kind +
    JSON.stringify(node.params, (k, v) => (typeof v === 'function' ? fnSig(v) : v instanceof Uint8Array ? Array.from(v) : v)) +
    '[' + node.inputs.map(sigOf).join(',') + ']';
  return node._sig;
}

// The merge pass binds the cell map + 15 variants = 16 samplers (the WebGL2
// guaranteed minimum). More variants aren't a limit: they render in batches
// of 15 into the same target, each batch discarding the other batches' cells.
const TILE_MAX = 15;
const TILE_FRAG = /* glsl */ `
varying vec2 vUv;
uniform vec2 uGrid;
uniform float uBase;
uniform sampler2D uMap;
${Array.from({ length: TILE_MAX }, (_, i) => `uniform sampler2D t${i};`).join('\n')}
void main() {
  vec2 cell = floor(vUv * uGrid);
  vec2 local = fract(vUv * uGrid);
  float v = texture2D(uMap, (cell + 0.5) / uGrid).r * 255.0 - uBase;
  if (v < -0.5 || v > ${TILE_MAX - 1}.5) discard; // another batch's cell
  vec4 c;
  if      (v < 0.5) c = texture2D(t0, local);
${Array.from({ length: TILE_MAX - 2 }, (_, i) => `  else if (v < ${i + 1}.5) c = texture2D(t${i + 1}, local);`).join('\n')}
  else              c = texture2D(t${TILE_MAX - 1}, local);
  gl_FragColor = c;
}
`;

// .scroll() — a translate under a periodic wrap, with a hook on the repeat.
// Only two repeats of an axis are ever on screen at once, so a chain that
// differs per repeat costs two passes rather than one per repeat: the copies
// alternate even/odd and each sampler holds whichever index has that parity
// right now. Both axes live is the 2×2 of those parities.
const SCROLL_FRAG = /* glsl */ `
varying vec2 vUv;
uniform vec2 uOff;
uniform vec2 uLive;   // 1 on an axis that scrolls, 0 on one that stands still
uniform sampler2D s0;
uniform sampler2D s1;
uniform sampler2D s2;
uniform sampler2D s3;
void main() {
  vec2 p = vUv - uOff;
  vec2 local = mix(vUv, fract(p), uLive);
  vec2 par = mod(floor(p), 2.0) * uLive;
  float slot = par.x + 2.0 * par.y;
  vec4 c;
  if      (slot < 0.5) c = texture2D(s0, local);
  else if (slot < 1.5) c = texture2D(s1, local);
  else if (slot < 2.5) c = texture2D(s2, local);
  else                 c = texture2D(s3, local);
  gl_FragColor = c;
}
`;

// An axis scrolls if it was given anything but a static zero. A fn counts even
// where it happens to return 0 at the moment we ask: the sketch asked for motion.
const scrollLive = (v) => typeof v === 'function' || (typeof v === 'number' && v !== 0);

// Which cell one sampler is holding at time t: the visible span is one repeat
// wide, so it covers k0 and k0 + 1, and the sampler takes whichever has its
// parity. Returns the cell, the offset, and the travel direction, since the
// index and the phase are both read off those three.
function repeatCell(v, parity, t) {
  const speed = resolve(v, t) || 0;
  const off = speed * t;
  const k0 = Math.floor(-off);
  const k = ((k0 % 2) + 2) % 2 === parity ? k0 : k0 + 1;
  return { k, off, dir: Math.sign(speed) || 1 };
}

// The repeat one sampler is holding, as two signals — what a sampler holds
// changes as repeats slide through it, which is the whole reason the callback
// can't be handed numbers. index: repeat 0 is the frame at t = 0, and the
// count runs in the order repeats *arrive*, so a list read off it comes out
// forwards whichever way the frame is travelling.
//
// phase: where this repeat is in its own crossing, 0 as its far edge reaches
// the frame and 1 as its near edge leaves. A repeat is on screen for two
// frame-widths of travel, and a sampler holds one for exactly that long — the
// handoff to the next lands on the frame it covers no pixels — so the sawtooth
// is continuous everywhere it can be seen.
function repeatIndex(v, parity, live) {
  if (!live) return { index: sig(() => 0), phase: sig(() => 0) };
  const index = sig((t) => {
    const { k, dir } = repeatCell(v, parity, t);
    // cells run against the travel, so the sign puts arrival back the right way
    return -dir * k;
  });
  const phase = sig((t) => {
    const { k, off, dir } = repeatCell(v, parity, t);
    return Math.min(1, Math.max(0, (dir * (off + k) + 1) / 2));
  });
  return { index, phase };
}

// Everything .radial() puts between its two resamples is reading a buffer whose
// x axis is an angle: at the 0/2π seam a blur or a translate has to come around
// the other side, or it pulls in the clamped edge and leaves a hairline crack
// down the frame. Mark the span so its targets repeat horizontally and its UV
// ops default to the matching wrap — neither is something the ops could know on
// their own, which is why the sandwich is one call and not two.
// Under { log: true } the radius axis is periodic too, so its targets repeat
// both ways and the seam where one zoom level meets the next has real pixels
// on both sides of it.
function markPolar(node, src, seen = new Set()) {
  if (node === src) { node._polar = true; return true; }
  if (seen.has(node)) return node._polar === true;
  seen.add(node);
  let inSpan = false;
  for (const n of node.inputs) if (markPolar(n, src, seen)) inSpan = true;
  if (inSpan) {
    node._polar = true;
    if (src.params.log) node._polarLog = true;
    if (node.params.wrap === undefined && (node.kind === 'transform' || node.kind === 'warp'))
      node.params.wrap = 'polar';
  }
  return inSpan;
}

// ---------------------------------------------------------------------------
// inverses — what .through() needs in order to come back
//
// One entry per op that can be undone exactly, returning the nodes that undo
// it in the order they go on the chain. A node holding several knobs undoes
// them in the reverse of its own order: a UV op's sampling maps compose
// backwards and a colour op's stages run forwards, but either way the last
// thing done is the first undone. A missing entry — or a null return — means
// this particular setting throws something away (a blur, a posterize, a scale
// driven by a map, a saturation of 0), and .through() says so rather than
// guessing.

const negp = (v) => (typeof v === 'function' ? (t) => -v(t) : -v);
// undefined counts as untouched: the knob's default is what the shader ran
const untouched = (v, d) => v === undefined || v === d || (Array.isArray(v) && v.every((x) => x === d));
const isMap = (v) => v?.map instanceof TextureOp;
const negAmt = (v) => (isMap(v) ? { ...v, amount: negp(v.amount) } : negp(v));
const recipAmt = (v) => (Array.isArray(v) ? v.map(reciprocal) : reciprocal(v));

// a texture-valued param arrives on a built node as a slot marker; put the map
// back so the inverse node can bind it again with an amount of its own
function unbind(kind, params, inputs) {
  const spec = SPECS[kind];
  if (!spec?.texParams) return params;
  let out = params;
  for (const name of Object.keys(spec.texParams)) {
    const m = params[name];
    if (typeof m?.tex !== 'number') continue;
    if (out === params) out = { ...params };
    out[name] = { map: inputs[m.tex], amount: m.amount ?? 1, mid: m.mid ?? 0 };
  }
  return out;
}

const INVERSES = {
  // every other knob (log, min) has to ride along, or the way back reads a
  // different space than the way out
  polar: (p) => [{ kind: 'polar', params: { ...p, inverse: !p.inverse } }],
  invert: () => [{ kind: 'invert', params: {} }],

  transform(p) {
    if (isMap(p.scale)) return null;            // 1 / a map has no spelling here
    const steps = [];
    const keep = p.wrap !== undefined ? { wrap: p.wrap } : {};
    if (!untouched(p.rotate, 0)) steps.push({ rotate: negAmt(p.rotate) });
    if (!untouched(p.scale, 1)) steps.push({ scale: recipAmt(p.scale) });
    if (isMap(p.translate)) steps.push({ translate: negAmt(p.translate) });
    else if (p.translate && !untouched(p.translate, 0))
      steps.push({ translate: [negp(p.translate[0]), negp(p.translate[1])] });
    return steps.map((s) => ({ kind: 'transform', params: { ...s, ...keep } }));
  },

  adjust(p) {
    // only hue has a texture form that inverts: negating an amount turns the
    // wheel back, while 1/gamma and 1/contrast aren't values a map can carry
    if (isMap(p.gamma) || isMap(p.contrast) || isMap(p.saturation)) return null;
    if (p.saturation === 0) return null;        // grey keeps no way back
    const steps = [];
    if (!untouched(p.gamma, 1)) steps.push({ gamma: recipAmt(p.gamma) });
    if (!untouched(p.hue, 0)) steps.push({ hue: negAmt(p.hue) });
    if (!untouched(p.saturation, 1)) steps.push({ saturation: recipAmt(p.saturation) });
    if (!untouched(p.contrast, 1)) steps.push({ contrast: recipAmt(p.contrast) });
    return steps.map((s) => ({ kind: 'adjust', params: s }));
  },

  math(p) {
    if (isMap(p.pow)) return null;
    const steps = [];
    // swapping the slots is the whole inverse, which is why a map in one of
    // them needs nothing done to it: .mul(map) comes back as .div(map)
    if (!untouched(p.add, 0) || !untouched(p.sub, 0)) steps.push({ add: p.sub ?? 0, sub: p.add ?? 0 });
    if (!untouched(p.mul, 1) || !untouched(p.div, 1)) steps.push({ mul: p.div ?? 1, div: p.mul ?? 1 });
    if (!untouched(p.pow, 1)) steps.push({ pow: recipAmt(p.pow) });
    return steps.map((s) => ({ kind: 'math', params: s }));
  },

  warp(p) {
    if (isMap(p.zoom) || isMap(p.twist) || isMap(p.barrel)) return null;
    if (!untouched(p.barrel, 0)) return null;   // undoing a barrel is a cubic
    const keep = { center: p.center, wrap: p.wrap };
    const z = !untouched(p.zoom, 1), tw = !untouched(p.twist, 0);
    // the twist reads its radius after the zoom, so a node holding both can't
    // be undone by two nodes holding one each
    if (z && tw) return null;
    if (z) return [{ kind: 'warp', params: { ...keep, zoom: recipAmt(p.zoom) } }];
    if (tw) return [{ kind: 'warp', params: { ...keep, twist: negAmt(p.twist) } }];
    return [];
  },

  // the channels never mix, so each one's offset just goes back
  chroma: (p) => [{ kind: 'chroma', params: { ...p, amount: negAmt(p.amount ?? 0.005) } }],
};

// ---------------------------------------------------------------------------
// auto-named buffers
//
// A helper that closes a feedback loop needs a bus name of its own, and a
// literal one would collide the moment the helper is called twice. What it
// can't be is a fresh id per run: the buffer's whole value is that it persists,
// so a new name on every ctrl+enter would blank the loop on every edit (see
// carry.js) and strand a render target each time.
//
// So the name is the carried key itself — call-order identity, stable across
// re-runs, swept when the call it belongs to is edited away. The `#` is what
// keeps it out of the namespace a sketch types by hand.

function releaseBuffer(engine, name) {
  // inside a labeled block the buffer is held under the block's path (busKey),
  // which the name spells with colons: '__kirb:buffer#0' lives at 'kirb/__kirb:buffer#0'
  const at = name.lastIndexOf(':');
  const key = at < 0 ? name : `${name.slice(2, at).replaceAll(':', '/')}/${name}`;
  const rt = engine._textureState.fbRTs?.get(key);
  if (rt) {
    rt.dispose();
    engine._textureState.fbRTs.delete(key);
  }
}

// A buffer is a full frame of video held all the time, so a helper called once
// per cell of a .tile() is how a sketch quietly asks for gigabytes. Said on the
// crossing only: a run with sixty of them wants one warning, not forty-five,
// and warn() identifies a message by its text.
const BUFFER_WARN_AT = 16;

export function autoBuffer(engine) {
  if (!isClaiming()) {
    warn('bufferId(): only meaningful while the sketch is running — a call from onFrame() would mint a new name every frame, so they all share one');
    return '__buffer';
  }
  return carried(
    'buffer',
    (key) => {
      const n = Number(key.slice(key.indexOf('#') + 1));
      if (n === BUFFER_WARN_AT) {
        warn(`bufferId(): more than ${BUFFER_WARN_AT} feedback buffers in this sketch, each holding a full frame of video. A .feedback() per .tile() cell is the usual way to get here.`);
      }
      // a block's key carries its path, and a slash in a bus name means "into that block"
      return `__${key.replaceAll('/', ':')}`;
    },
    (name) => releaseBuffer(engine, name),
  );
}

// ---------------------------------------------------------------------------
// the chainable node

export class TextureOp {
  constructor(engine, kind, params = {}, inputs = []) {
    // sketches have this class in scope as `Texture`, so `new Texture()` is
    // reachable — and would otherwise fail several lines deep in something that
    // reads like an internal bug. A chain starts at a generator; that's what
    // holds the engine.
    if (engine == null) {
      throw new Error('new Texture() is not how a chain starts — begin from a generator like scene(), noise() or circle()');
    }
    const bound = bindTexParams(kind, params, inputs);
    this.engine = engine;
    // the sketch, or the labeled block, this node was built in: what it reads
    // by position (scene(), stack()) or by name (input()) is that one's
    this.scope = engine.scope;
    this.kind = kind;
    this.params = bound.params;
    this.inputs = bound.inputs;
    this.texBinds = bound.binds;
    this.lastFrame = -1;
    this.lastCtx = '';        // which context that frame was rendered in (see renderNode)
    // named after the call that made it, except a sim, which every
    // .push()/.obstacle() on it remakes
    this._site = site(kind, kind !== 'fluid');
    // these read what's drawn above them, so where they were called matters
    if (kind === 'scene' || kind === 'depth' || kind === 'stack') this.upto = engine.stackMark();
    // input('kirb/glow') reads into a block, which has to have been built to
    // have anything in it, and building only happens while the sketch runs
    if (kind === 'in' && typeof this.params.name === 'string' && this.params.name.includes('/')) this._bus();
    engine.textureNodes.push(this);
  }

  // Where a bus name leads: { scope, name }. A plain name is looked for here
  // and then outward, so a block can read what the sketch around it publishes
  // (it can't publish over it: .out('a') inside a block is the block's own).
  // 'kirb/glow' goes into the block called kirb instead.
  _bus() {
    let name = String(this.params.name);
    let sc = this.scope;
    if (name.includes('/')) {
      const parts = name.split('/');
      name = parts.pop();
      for (const part of parts) {
        const block = this.engine.blockIn(sc, part);
        if (!block) {
          warn(`input('${this.params.name}'): there's no block called ${part} above this line`);
          return { scope: this.scope, name };
        }
        if (!block.scope && !block.building) this.engine.buildBlock(block);
        sc = block.scope ?? sc;
      }
      return { scope: sc, name };
    }
    for (let s = sc; s; s = s.parent) {
      if (s.textureBuffers.has(name) || s.geoLayers.has(name)) return { scope: s, name };
    }
    return { scope: sc, name };
  }

  // How far down the stack this chain's scene() reads reach: the geometry
  // above that point is in the chain already, so a naked .out() of it stands in
  // for those groups rather than landing on top of them.
  // Asked about 'stack' instead it's the same question for stack() reads,
  // which stand in for every layer above them, textures too.
  _consumes(seen = new Set(), kind = 'scene') {
    if (seen.has(this)) return 0;
    seen.add(this);
    let n = this.kind === kind ? this.upto : 0;
    // through a bus too: scene().out('a') read back as input('a') is the same read
    // (within one scope: `upto` counts that scope's stack, and means nothing in another's)
    const at = this.kind === 'in' && this.params.name != null && this._bus();
    const bus = at && at.scope === this.scope && at.scope.textureBuffers.get(at.name);
    if (bus) n = Math.max(n, bus._consumes(seen, kind));
    for (const i of this.inputs) n = Math.max(n, i._consumes(seen, kind));
    for (const v of Object.values(this.params)) {
      if (v instanceof TextureOp) n = Math.max(n, v._consumes(seen, kind));
    }
    return n;
  }

  _n(kind, params = {}, extraInputs = []) {
    return new TextureOp(this.engine, kind, params, [this, ...extraInputs]);
  }

  // texture-valued args (comp layer, displace/remap map) may be a fn of the chain
  // so far — .comp(s => s.edge(), 'add') overlays the current node's own edges.
  // null when the arg isn't one: the op then drops out of the chain rather
  // than taking the picture down with it.
  _texture(v, op) {
    if (typeof v === 'function') v = v(this);
    if (v instanceof TextureOp) return v;
    warn(`${op}: expected a texture (or a fn of the chain returning one) — the ${op} is skipped`);
    return null;
  }

  // --- generators-as-filters & filters ---
  mirror(o = {}) { return this._n('mirror', o); }
  kaleido(sides = 6, o = {}) { return this._n('kaleido', { sides, ...o }); }

  // .radial(s => ...) — run the fn in polar space, where x is the angle around
  // the center and y the distance from it, then come back. .translate(0, 0.1)
  // is a tunnel, .translate(0.1, 0) spins the frame, .blur([8, 0]) smears
  // around the ring. Both resamples are ours: an unbalanced pair isn't a look
  // anyone means, and only this end knows the span is angular (see markPolar).
  //
  // { log: true } measures y in log-radius, which makes the space periodic:
  // .scroll(0.1, 0) is then endless rotation and .scroll(0, 0.1) endless zoom,
  // each turn or each zoom level reachable on its own through the callback.
  radial(fn, o = {}) {
    return this.through((s) => s.polar(o), fn);
  }

  // .through(change, fn) — do the work somewhere else and come back:
  // .through(s => s.rotate(0.125), p => p.pixelsort()) sorts along a diagonal,
  // .through(s => s.warp({ twist: 2 }), ...) sorts along curves,
  // .through(s => s.gamma(2.2), p => p.dither()) spends the levels where the
  // eye is. The change has to be undoable — a move, a warp, a curve on the
  // colour — and both halves are ours, since an unbalanced pair is a look
  // nobody means. .radial() is this call with .polar() as the change.
  //
  // What comes back is only different if the two disagree: an op that ignores
  // the change (a blur through a rotate, which is round either way) returns
  // the frame it was given. Anything that measures the frame in its own
  // coordinates — a direction, a grid, a level — is where this pays.
  through(change, fn) {
    const outer = this._texture(change, 'through');
    if (!outer) return this;
    const span = [];                            // outermost first, which is also undo order
    for (let n = outer; n !== this; n = n.inputs[0]) {
      if (!n?.inputs?.length) {
        warn('through: the first fn has to build on the chain it is handed — .through(s => s.rotate(0.1), p => p.pixelsort())');
        return this;
      }
      span.push(n);
    }
    // A frame can't hold its own rotation: what the change pushes past the
    // edge has nowhere to come back from, and left transparent that reads as
    // the round trip cutting a notch out of the picture — 7 degrees takes
    // triangles off all four sides. So the way out fills instead of emptying,
    // and the way back reads real pixels everywhere. The band nearest the edge
    // comes back as a smear of what was nearest the edge, which is the honest
    // price and an invisible one until the change is large. wrap on the op
    // itself overrides, 'transparent' showing exactly what was lost.
    for (const n of span) {
      if ((n.kind === 'transform' || n.kind === 'warp') && n.params.wrap === undefined) n.params.wrap = 'clamp';
    }
    const inner = outer._texture(fn, 'through');
    if (!inner) return this;
    for (const n of span) if (n.kind === 'polar' && !n.params.inverse) markPolar(inner, n);
    let out = inner;
    for (const n of span) {
      const steps = INVERSES[n.kind]?.(unbind(n.kind, n.params, n.inputs), n.inputs);
      if (!steps) {
        warn(`through: ${n.kind} can't be undone as it's set here, so the chain stays in the space it went to`);
        return inner;
      }
      for (const s of steps) out = out._n(s.kind, s.params);
    }
    return out;
  }

  // one way, as an effect rather than a coordinate change: forward unrolls the
  // frame into a ring chart, `inverse` wraps it into a disc (a horizon becomes
  // a little planet). The round trip is .radial().
  polar(o = {}) { return this._n('polar', o); }
  edge(o = {}) { return this._n('neighbor', { ...o, op: 'edge' }); }
  slope(o = {}) { return this._n('neighbor', { ...o, op: 'slope' }); }
  normalMap(o = {}) { return this._n('neighbor', { ...o, op: 'normal' }); }
  levels(o = {}) { return this._n('adjust', o); }
  add(v = 0) { return this._n('math', { add: v }); }
  sub(v = 0) { return this._n('math', { sub: v }); }
  mul(v = 1) { return this._n('math', { mul: v }); }
  div(v = 1) { return this._n('math', { div: v }); }
  pow(v = 1) { return this._n('math', { pow: v }); }
  contrast(v = 1) { return this._n('adjust', { contrast: v }); }
  saturation(v = 1) { return this._n('adjust', { saturation: v }); }
  gamma(v = 1) { return this._n('adjust', { gamma: v }); }
  hue(v = 0) { return this._n('adjust', { hue: v }); }
  posterize(steps = 4) { return this._n('posterize', { steps }); }
  // .dither(2) / .dither(3, 'bayer4') / .dither({ levels, mode })
  dither(levels = 2, o = {}) {
    if (levels !== null && typeof levels === 'object' && !(levels instanceof TextureOp)) { o = levels; levels = o.levels ?? 2; }
    if (typeof o === 'string') o = { mode: o };
    return this._n('dither', { ...o, levels });
  }
  // .grain(0.15) / .grain({ amount, size, mono })
  grain(amount = 0.1, o = {}) {
    if (amount !== null && typeof amount === 'object' && !(amount instanceof TextureOp)) { o = amount; amount = o.amount ?? 0.1; }
    const { amount: _a, ...rest } = o;
    return this._n('grain', { ...rest, amount });
  }
  // .pixelsort({ threshold, dir, size, jitter }) — interval pixel sort:
  // spans of pixels brighter than `threshold` sort into monotonic gradient
  // streaks toward `dir`; darker pixels are walls that stay put and bound
  // each span. Fully sorted every frame — a pure function of the frame, so
  // it's stable on video. Sorted twice is sorted, so a bare feedback loop
  // settles; the melting-over-time treatment needs a nudge in the loop:
  // .feedback(0.92, p => p.pixelsort({ length: 200 }).translate(0, -0.004), 'over')
  pixelsort(o = {}) {
    // a texture in the threshold slot sets it per pixel — a field deciding
    // where streaks may happen
    if (o.threshold instanceof TextureOp) {
      const { threshold, ...rest } = o;
      return this._n('pixelsort', { ...rest, byThMap: true }, [threshold]);
    }
    return this._n('pixelsort', o);
  }
  // .jpeg(0.1) / .jpeg({ quality, corrupt, seed }) — real DCT-domain
  // compression: the frame in 8×8 blocks, coefficients quantized by a
  // quality-scaled table. corrupt re-rolls random blocks for the broken-file
  // look; seed re-deals which ones (a fn of t makes them flicker).
  jpeg(quality = 0.25, o = {}) {
    if (quality instanceof TextureOp) {
      warn('jpeg: quality is one number for the whole frame — a fn of t animates it, but a texture cannot vary it per pixel');
      quality = 0.25;
    } else if (quality !== null && typeof quality === 'object') {
      o = quality;
      quality = o.quality ?? 0.25;
    }
    return this._n('jpeg', { ...o, quality });
  }
  pixellate(x = 100, y) { return this._n('pixellate', { x, y }); }
  ascii(o = {}) { return this._n('ascii', o); }
  transform(o = {}) { return this._n('transform', o); }
  warp(o = {}) { return this._n('warp', o); }
  // .chroma(amount) splits horizontally; { radial: true } makes it lens-like
  chroma(amount = 0.005, o = {}) { return this._n('chroma', { amount, ...o }); }
  // transform shorthands (same pass; wrap etc. via the trailing options)
  translate(x = 0, y = 0, o = {}) {
    // .translate(map) — a texture fills the whole slot rather than one component,
    // so the options land in the second argument
    const map = asMap(x) != null;
    if (map && typeof y === 'object' && y !== null) o = y;
    return this._n('transform', { translate: map ? x : [x, y], ...o });
  }
  rotate(v = 0, o = {}) { return this._n('transform', { rotate: v, ...o }); }
  // .scale(2) zooms both axes, .scale(1, 4) stretches y on its own
  scale(x = 1, y, o = {}) {
    // options object in the y slot: .scale(2, { wrap: 'repeat' })
    if (typeof y === 'object' && y !== null && asMap(y) == null) { o = y; y = undefined; }
    const map = asMap(x) != null;
    return this._n('transform', { scale: map || y === undefined ? x : [x, y], ...o });
  }
  // .crop(400, 300) — keep the middle 400×300 pixels, black around it. A size
  // <= 1 is a fraction of the frame instead, and one size alone squares it.
  crop(w = 1, h, o = {}) {
    // options object in the height slot: .crop(400, { center })
    if (h !== null && typeof h === 'object') { o = h; h = undefined; }
    return this._n('crop', { w, h, ...o });
  }
  threshold(level = 0.5, o = {}) { return this._n('threshold', { level, ...o }); }
  // the keys make cutouts, not masks: alpha drops where the color (or the
  // darkness) matches, and what survives keeps its own color
  chromaKey(color = '#00ff00', o = {}) { return this._n('chromakey', { color, ...o }); }
  lumaKey(level = 0.5, o = {}) { return this._n('lumakey', { level, ...o }); }
  invert() { return this._n('invert'); }
  // The op that isn't here, written by hand: a fragment pass over the chain so
  // far. tex0 is the picture, vUv the pixel, and the second argument names
  // uniforms — a number, a vector, a color or a fn of t, or a chain, which
  // arrives as a sampler2D of that name.
  //   .glsl('texture2D(tex0, vUv).bgra')
  //   .glsl('vec4(texture2D(tex0, vUv).rgb * gain, 1.0)', { gain: t => 1 + Math.sin(t) })
  glsl(source, uniforms) { return glslNode(this.engine, source, uniforms, this); }
  remap(map) {
    const m = this._texture(map, 'remap');
    return m ? this._n('remap', {}, [m]) : this;
  }
  lookup(ramp) {
    const r = this._texture(ramp, 'lookup');
    return r ? this._n('lookup', {}, [r]) : this;
  }
  tint(color = '#ffffff', o = {}) { return this._n('tint', { color, ...o }); }
  // A whole 3D color cube in one square image — the HaldCLUT format, which is
  // what film stocks are published as. A string is an imported file's name,
  // resolved exactly as imagefile() does (exact filename, else
  // case-insensitive substring).
  //
  // The other thing that fits here is an image source: imageseq() switches
  // stock over time, and imagefile() spells out what the string is sugar for.
  // A *chain* does not, and cannot until per-chain resolution lands — every
  // node renders at frame size, so it would be a cube only if the window
  // happened to be 512×512, and nothing here can draw the cube's contents
  // anyway. update() says so rather than reporting the dimensions.
  //   .lut('portra 400 2')            .lut(imagefile('velvia.png'))
  //   .lut('portra 400 2', { mix: 0.5 })    half strength, either spelling
  //   .lut('portra 400 2', 0.5)
  lut(source, mix = 1) {
    // options object in the scalar slot, the same as .displace()'s amount
    if (mix !== null && typeof mix === 'object') mix = mix.mix ?? 1;
    const src = typeof source === 'string'
      ? new TextureOp(this.engine, 'imagefile', { name: source })
      : this._texture(source, 'lut');
    return src ? this._n('lut', { mix }, [src]) : this;
  }
  // .alpha(0.5) is a half-faded image; .alpha(map) fades per pixel by the
  // map's luma. Fading is premultiplied, so the color dims with the coverage.
  alpha(v = 1) { return this._n('alpha', { alpha: v }); }
  // Sugar over .transform({ translate: map }): the only thing displace adds is
  // the mid 0.5 bias, without which an unsigned map only ever pushes one way.
  displace(map, amount = 0.1, o = {}) {
    // options object in the amount slot: .displace(map, { amount, mid })
    if (amount !== null && typeof amount === 'object') { o = amount; amount = o.amount ?? 0.1; }
    const m = this._texture(map, 'displace');
    if (!m) return this;
    const { amount: _a, mid = 0.5, ...rest } = o;
    // translate moves the image, displace moves the lookup — opposite signs
    const negated = typeof amount === 'function' ? (t) => -amount(t) : -amount;
    return this._n('transform', { ...rest, translate: { map: m, amount: negated, mid } });
  }
  // Where the nearest edge of this mask is, for every pixel at once — the
  // distance field a blur can only approximate, and only by melting the shape
  // it was measuring. 'direction' points at that edge (RG, 0.5-neutral, so
  // .displace() reads it), 'distance' is the signed distance as gray. spread
  // is the distance that saturates either encoding, in frame heights.
  sdf(o = {}) {
    const { mode = 'direction', ...rest } = typeof o === 'string' ? { mode: o } : o;
    if (!Object.hasOwn(SDF_MODES, mode))
      warn(`sdf: no mode '${mode}' — direction, distance or step; using direction`);
    return this._n('sdf', { mode: Object.hasOwn(SDF_MODES, mode) ? mode : 'direction', ...rest });
  }
  // Pull the picture toward the outline of a shape. Every pixel takes its own
  // shortest path to that edge and steps up to `amount` along it, so the
  // inside and the outside both converge on the outline instead of piling into
  // the middle. A negative amount pushes away from it.
  attract(shape, amount = 0.1, o = {}) {
    if (amount !== null && typeof amount === 'object') { o = amount; amount = o.amount ?? 0.1; }
    const m = this._texture(shape, 'attract');
    if (!m) return this;
    const { amount: _a, threshold, ...rest } = o;
    // the step is baked into the field, so what reaches the transform is a
    // ready-made offset per pixel rather than a direction to scale
    const field = m._n('sdf', { mode: 'step', step: amount, threshold });
    const away = typeof amount === 'function' ? (t) => (amount(t) < 0 ? 1 : -1) : amount < 0 ? 1 : -1;
    return this._n('transform', { ...rest, translate: { map: field, amount: away, mid: 0.5 } });
  }
  // options object in the mode slot: .comp(layer, { mode, opacity, swap })
  comp(layer, mode = 'over', opacity = 1, swap = false) {
    if (typeof mode === 'object' && mode !== null) {
      ({ mode = 'over', opacity = 1, swap = false } = mode);
    }
    const l = this._texture(layer, 'comp');
    return l ? this._n('comp', { mode, opacity, swap }, [l]) : this;
  }

  // instance(count, fn) — the picture so far, stamped count times, fn(x, i, n, t)
  // placing each copy through the flat verbs (x.position/.rotation/.scale/
  // .color/.alpha). It runs every frame, so copies animate.
  //
  // instance(bundle) instead takes the copies from a bundle — a layout(), a
  // track(), any bundle of points — which brings its own count and places each
  // copy on its record; a fn alongside it runs once the bundle has placed the
  // copy. Same call as on geometry, and a bundle reads the same either way —
  // this one draws it
  // flat, in the frame's own units (1 = the frame's height, origin at the
  // center).
  //
  // Copies are drawn small, so the stamp is read through a mip pyramid or a
  // shrunken copy would sample one pixel in fifty and sparkle.
  instance(count, fn, o = {}) {
    if (typeof fn === 'object' && fn !== null) { o = fn; fn = undefined; }
    let n = count;
    if (count instanceof Bundle) {
      const l = count;
      if (!l.slots) warn(EMPTY_BUNDLE);
      n = l.slots;
      // the user's fn is captured before fn is reassigned, or the wrapper
      // closes over itself
      const after = fn;
      fn = after
        ? (x, i, k, t) => after(l.apply(x, i, t), i, k, t)
        : (x, i, k, t) => l.apply(x, i, t);
    } else {
      fn ??= (x, i, k) => x.position((i - (k - 1) / 2) * 0.25, 0).scale(0.2);
    }
    const blend = o.blend ?? 'add';
    if (!COPY_BLEND[blend]) {
      warn(`instance: '${blend}' isn't a blend copies can land in — ${COPY_BLEND_NAMES.join(', ')} are what one draw can do, and .comp() has the rest. Using add.`);
    }
    this._needsMips = true;
    const node = this._n('instance', { blend: COPY_BLEND[blend] ? blend : 'add', id: copySerial++ });
    node._inst = { count: Math.max(0, Math.floor(Number(n) || 0)), fn };
    return node;
  }
  // .each(bundle, fn, { mode }) — a mark per record, comped on in index order:
  // fn is handed the record (bundle.at(i), live getters) and answers a chain, or
  // nothing to skip it. The fn runs once per record at build, like .instance()'s —
  // what moves per frame is the fns it baked into its chain's params:
  //
  //   feed.each(blobs, (b) => rect({ ...b.box({ pad: 0.02 }), thickness: 0.004,
  //     bg: null, color: hsl(() => b.id * 0.618, 0.8, 0.6) }))
  //
  // Each distinct mark is a layer with a pass of its own, so this costs what the
  // same comps written out one per slot would — it only owns the loop.
  each(bundle, fn, o = {}) {
    if (!bundle || typeof bundle.at !== 'function' || typeof fn !== 'function') {
      warn('each: takes a bundle and a mark — pic.each(track(…), (b) => rect({ ...b.box(), thickness: 0.004, bg: null }))');
      return this;
    }
    let node = this;
    const n = bundle.slots ?? bundle.count ?? 0;
    for (let i = 0; i < n; i++) {
      const rec = bundle.at(i);
      if (!rec) continue;
      const made = fn(rec, i, n);
      if (made instanceof TextureOp) node = node.comp(made, { mode: o.mode ?? 'over', opacity: o.opacity });
      else if (made != null) warn('each: the mark fn answers a texture chain (or nothing, to skip the slot) — it was handed back something else');
    }
    return node;
  }

  // .mask(m) — multiply by the mask's luma (cutout). .mask(m, s => ...) —
  // apply fn only where the mask is bright: dry→wet blend by mask luma.
  // Both the mask and the fn's return may be fns of the chain so far.
  mask(maskSrc, fn) {
    const m = this._texture(maskSrc, 'mask');
    if (!m) return this;
    const ins = [m];
    if (fn != null) {
      const wet = this._texture(fn, 'mask');
      if (wet) ins.push(wet);
    }
    return this._n('mask', {}, ins);
  }
  // .blur(r) — isotropic. .blur([rx, ry]) — one radius per axis, which is the
  // separable pass's natural shape: [8, 0] smears along the scanline only.
  // An axis at 0 skips its pass entirely.
  blur(radius = 1) { return this._n('blur', { radius }); }
  bloom(o = {}) { return this._n('bloom', o); }

  // .delay(n) — the chain as it was n frames ago, held in a ring of buffers.
  // The frame count takes a fn of t like any other number; `scale` stores the
  // history smaller, which is how a long delay stays affordable.
  //
  // The ring outlives the patch (see carry.js): a re-run rebuilds the node but
  // adopts the frames the last one had collected, so editing the sketch doesn't
  // punch a delay-length hole of black through the show.
  delay(frames = 1, o = {}) {
    const scale = Math.min(1, Math.max(0.05, o.scale ?? 1));
    // A texture in the frames slot delays per pixel: its luma picks how far
    // back each pixel looks — 0 is now, 1 the whole { max } frames (default
    // 30). A fn in that slot stays a fn of t, as it always was; only an actual
    // chain switches modes.
    if (frames instanceof TextureOp) {
      // ring size is an allocation, so max is a plain number — not a fn of t
      const max = Math.max(1, Math.round(Number(o.max)) || 30);
      const node = this._n('delay', { ...o, frames: max, byMap: true, scale }, [frames]);
      node.hist = carried('delay', () => ({ ring: null, array: null, slot: 0, cap: 0 }), disposeRing);
      return node;
    }
    const node = this._n('delay', { ...o, frames, scale });
    node.hist = carried('delay', () => ({ ring: null, array: null, slot: 0, cap: 0 }), disposeRing);
    return node;
  }

  // .flow() — the chain's frame-to-frame motion as a velocity picture,
  // mid-grey centered like fluid().velocity(), so it drops into the same
  // slots: .displace(src.flow()) drags the image along its own movement, and
  // it feeds .push() or a feedback treatment the same way. One Lucas–Kanade
  // step against last frame, computed coarse and blurred — a look, not
  // measurement.
  flow(o = {}) {
    const node = this._n('flow', { ...o, scale: Math.min(1, Math.max(0.05, o.scale ?? 0.25)) });
    node.hist = carried('flow', () => ({ prev: null, cur: null }), disposeFlow);
    return node;
  }

  // .feedback(0.9) — comp this point's own last frame back over the chain: the
  // amount is how much of it returns, so trails fade at that rate and 1 never
  // lets go. .feedback(0.9, p => p.rotate(0.02)) treats last frame on its way
  // round, which is where the drift of a real feedback loop comes from.
  //
  // Exactly the .out('name')/input('name') cycle written by hand, minus the
  // name: each call site claims its own (see autoBuffer), so a helper built on
  // this can be used twice in a sketch without the two loops colliding.
  feedback(amount = 0.9, fn, o = {}) {
    // The treatment fn is skippable, and a bare mode name stands in for the
    // options: .feedback(0.9, 'under'), .feedback(0.9, p => …, 'under'),
    // .feedback(0.9, { mode: 'screen' }) all reach the same place.
    if (typeof fn === 'string' || (fn !== null && typeof fn === 'object' && !(fn instanceof TextureOp))) {
      o = fn;
      fn = undefined;
    }
    o = typeof o === 'string' ? { mode: o } : o ?? {};
    const name = autoBuffer(this.engine);
    // { reset } rides on the loop's input: a truthy edge blanks the held
    // frame, cutting the trails to black
    let prev = new TextureOp(this.engine, 'in', o != null && typeof o === 'object' && o.reset != null ? { name, reset: o.reset } : { name });
    if (fn != null) {
      const treated = typeof fn === 'function' ? fn(prev) : fn;
      if (treated instanceof TextureOp) prev = treated;
      else warn('feedback: the second argument treats last frame — a fn of it returning a chain, like p => p.rotate(0.02). Last frame comes back untreated.');
    }
    return this.comp(prev, { mode: o.mode ?? 'add', opacity: amount, swap: o.swap }).out(name);
  }

  // --- fluid ---------------------------------------------------------------
  //
  // The sources and the outputs of a fluid() sim, plus .fluid() itself, which
  // starts one from the dye. Each source call returns a *new* fluid node
  // carrying one more input, so the chain reads the way every other chain here
  // does — but all of them share the one carried sim, so .ink().push() is a
  // single solver and not three.

  _fluidSource(role, map, o) {
    if (this.kind !== 'fluid') {
      warn(`${role}: only a fluid() takes sources — .${role}() has to sit directly on the fluid(), before anything else in the chain`);
      return this;
    }
    // a bare number (or fn of t) in the options slot is the amount, which is
    // the only thing most calls want to say
    if (typeof o === 'number' || typeof o === 'function') o = { amount: o };
    o ??= {};
    const vec = role === 'push' ? asVec2(map) : null;
    const src = vec ? null : this._texture(map, role);
    if (!src && !vec) return this;
    if (vec && o.mid != null) warn('push: mid is for reading an unsigned map — a plain direction is already signed');
    const source = {
      role,
      amount: o.amount ?? 1,
      // unsigned maps push both ways around their midpoint, the same
      // convention (and the same default) as .displace()
      mid: o.mid ?? 0.5,
      // which of the node's inputs this source reads; a direction reads none
      in: vec ? -1 : this.inputs.length,
    };
    if (vec) source.vec = vec;
    const node = new TextureOp(this.engine, 'fluid', {
      ...this.params,
      sources: [...(this.params.sources ?? []), source],
    }, vec ? [...this.inputs] : [...this.inputs, src]);
    node.sim = this.sim;
    return node;
  }

  // chain.fluid(o) — the same sim entered from the dye side: this chain is the
  // ink and what comes back is the fluid, so .push() and the rest carry on
  // from there. `ink` is the pour rate, i.e. .ink()'s amount.
  fluid(o = {}) {
    // a bare number (or fn of t) is the rate, as in .ink(map, 6)
    if (typeof o === 'number' || typeof o === 'function') o = { ink: o };
    const { ink = 1, ...knobs } = o;
    const node = new TextureOp(this.engine, 'fluid', knobs);
    node.sim = claimFluidState();
    return node._fluidSource('ink', this, ink);
  }

  // .ink(chain, amount) — pour a chain in as dye. Added per second, so the
  // amount is a rate: it builds while the source is bright and stops when it
  // goes dark, rather than replacing what is already floating.
  ink(map, o) { return this._fluidSource('ink', map, o); }

  // .push(map, { amount, mid }) — drive the velocity field from a vec2 map,
  // read R/G. This is the one that makes anything happen: dye with nothing
  // pushing it just sits and fades.
  // .push([x, y]) instead of a map is one steady force over the whole field —
  // wind, or gravity at [0, -0.3].
  push(map, o) { return this._fluidSource('push', map, o); }

  // .obstacle(mask) — cells brighter than 0.5 are solid. The projection sees
  // them, so flow goes *around* rather than being clipped by them.
  obstacle(map) { return this._fluidSource('obstacle', map, {}); }

  _fluidView(field, o = {}) {
    if (this.kind !== 'fluid') {
      warn(`${field}: only a fluid() has a ${field} field to read`);
      return this;
    }
    const node = new TextureOp(this.engine, 'fluidView', { field, scale: o.scale }, [this]);
    node.sim = this.sim;
    return node;
  }

  // The sim's fields as pictures, centred on mid-grey like neighbor()'s slope
  // map — so they read on screen and drop straight into any slot taking a
  // { map, mid: 0.5 }: .displace(), transform({ translate }), .push().
  velocity(o) { return this._fluidView('velocity', o); }
  curl(o) { return this._fluidView('curl', o); }
  pressure(o) { return this._fluidView('pressure', o); }

  // .when(cond, fn) — per-frame switch: while cond(t) >= 0.5 the chain
  // becomes fn(chain), otherwise it passes through untouched. Both branches
  // are built once; only the active one renders each frame.
  when(cond, fn) {
    // a static cond can never change — resolve the branch now. (Also keeps
    // tile dedupe tight: cells that skip the fn don't drag its chain along
    // in their structural signature.)
    if (typeof cond !== 'function') return cond >= 0.5 ? (this._texture(fn, 'when') ?? this) : this;
    const branch = this._texture(fn, 'when');
    return branch ? new TextureOp(this.engine, 'switch', { cond }, [this, branch]) : this;
  }

  // .scroll(vx, vy, (src, i, phase) => variant) — the frame repeating forever
  // and sliding at vx, vy frames a second, in the UV units .translate() takes,
  // with each repeat handed to a callback. Without the callback it is exactly
  // .translate(t => t * vx, t => t * vy, { wrap: 'repeat' }).
  //
  // i is the repeat's index: 0 for the frame at t = 0, counting up as new
  // repeats arrive. phase is where that repeat is in its own crossing, 0 to 1,
  // a phase in the sense the waveshapers mean — phase.tri() is a fade in and
  // out across the frame. Both are *signals*, not numbers, because what a
  // given pass is holding changes as repeats slide through it — so i.mul(0.05)
  // and i.select([...]), not i * 0.05. On a diagonal scroll i is the sum of
  // the two axes' indices, the anti-diagonal band the repeat sits in, and
  // phase their mean.
  //
  // Cost is at most one pass per parity — two for a straight scroll, four for
  // a diagonal one — however far the sketch scrolls, and identical variants
  // dedupe down from there.
  scroll(vx = 0.2, vy = 0, fn) {
    // .scroll([vx, vy], fn) and .scroll(vx, fn) — the callback is the last
    // argument in every spelling
    if (Array.isArray(vx)) { fn = typeof vy === 'function' ? vy : fn; [vx, vy] = [vx[0] ?? 0, vx[1] ?? 0]; }
    // a Signal is a function too, so a speed in the callback's slot is only a
    // callback if nothing was passed after it
    else if (typeof vy === 'function' && fn === undefined) { fn = vy; vy = 0; }
    const live = [scrollLive(vx), scrollLive(vy)];
    const axes = (live[0] ? 1 : 0) + (live[1] ? 1 : 0) || 1;
    const variants = [];
    const bySig = new Map();
    const slots = [0, 0, 0, 0];
    let complained = false;
    // an axis standing still has one parity, not two — so a straight scroll
    // runs the callback twice, not four times
    for (let py = 0; py < (live[1] ? 2 : 1); py++) {
      for (let px = 0; px < (live[0] ? 2 : 1); px++) {
        const rx = repeatIndex(vx, px, live[0]);
        const ry = repeatIndex(vy, py, live[1]);
        // a still axis contributes nothing to either, so a straight scroll's
        // index and phase are just the moving axis's own
        const i = sig((t) => rx.index(t) + ry.index(t));
        const phase = sig((t) => (rx.phase(t) + ry.phase(t)) / axes);
        let v = (fn ? fn(this, i, phase) : this) ?? this;
        if (!(v instanceof TextureOp)) {
          // the near miss worth naming: a fn in the y slot is read as the
          // callback, so an animated y speed has to say which slot it is in
          if (!complained) warn(typeof v === 'number'
            ? 'scroll: a fn in the second slot is the per-repeat callback — for an animated y speed write .scroll([vx, vy]) instead'
            : 'scroll: fn must return a texture chain — the repeats show the source untreated');
          complained = true;
          v = this;
        }
        const key = sigOf(v);
        let idx = bySig.get(key);
        if (idx == null) bySig.set(key, (idx = variants.push(v) - 1));
        for (let s = 0; s < 4; s++) {
          if ((live[0] ? s & 1 : 0) === px && (live[1] ? s >> 1 : 0) === py) slots[s] = idx;
        }
      }
    }
    return new TextureOp(this.engine, 'scroll', { vx, vy, live, slots }, variants);
  }

  // .tile(nx, ny, (src, i, x, y) => variant) — tile the image nx×ny, with a
  // per-cell choice of texture. The fn runs once per cell at eval time and may
  // return src itself, a treatment of it, or any other chain. Structurally
  // identical variants are deduped (so `src.saturation(0)` per call is fine);
  // up to 256 distinct variants. x runs left→right, y bottom→top, i = y*nx + x.
  tile(nx = 2, ny = nx, fn) {
    nx = Math.max(1, Math.round(nx));
    ny = Math.max(1, Math.round(ny));
    const variants = [];
    const bySig = new Map();
    const map = new Uint8Array(nx * ny);
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const i = y * nx + x;
        let v = (fn ? fn(this, i, x, y) : this) ?? this;
        if (!(v instanceof TextureOp)) {
          warn('tile: fn must return a texture chain — that cell shows the source untreated');
          v = this;
        }
        const sig = sigOf(v);
        let idx = bySig.get(sig);
        if (idx == null) {
          // the cell map is a Uint8 texture, so indices top out at 255
          if (variants.length >= 256) {
            warn('tile: more than 256 distinct variants — the rest reuse the first');
            map[i] = 0;
            continue;
          }
          idx = variants.length;
          variants.push(v);
          bySig.set(sig, idx);
        }
        map[i] = idx;
      }
    }
    return new TextureOp(this.engine, 'tile', { nx, ny, map }, variants);
  }

  // .blend(mode, opacity) — how this chain's naked .out() lands on the layers
  // under it, geometry included: the .comp() modes without the bus. Also
  // .blend({ mode, opacity }). The ops after it keep the mode, a later
  // .blend() replaces it, and a .when() follows whichever branch it took.
  blend(mode = 'over', opacity = 1) {
    if (mode != null && typeof mode === 'object' && !Array.isArray(mode)) {
      ({ mode = 'over', opacity = 1 } = mode);
    }
    return this._n('blend', { mode, opacity });
  }

  // the nearest .blend() up the chain, through the branch a switch took this
  // frame (so: after renderNode); null when the chain never asked
  _blendMode() {
    for (let n = this; n; n = n.kind === 'switch' ? n.inputs[n._taken ?? 0] : n.inputs[0]) {
      if (n.kind === 'blend') return n.params;
    }
    return null;
  }

  // whether any branch could: what decides if the backdrop goes under the stack
  _blends() {
    return (this._canBlend ??= this.kind === 'blend'
      || (this.kind === 'switch' ? this.inputs.some((n) => n._blends()) : !!this.inputs[0]?._blends()));
  }

  // .out() — send this chain to the display; several naked .out()s stack in
  // code order, each composited over the ones before it (premultiplied over,
  // so only where a later chain is transparent do the earlier ones show).
  // .out('name') — publish this point of the chain as a named buffer instead:
  // input('name') reads it, same frame when the wiring is acyclic, last
  // frame's snapshot when it loops (which is what makes a cycle a feedback
  // loop). Both are passthrough.
  out(name) {
    if (name != null) this.engine.textureBuffers.set(String(name), this);
    else if (!this.engine.textureOutputs.includes(this)) {
      this.engine.textureOutputs.push(this);
      this.engine.stack.push({ kind: 'tex', node: this });
    }
    return this;
  }

  // .field({ res }) — end the chain with a sampler instead of a picture: a
  // plain function (u, v) => 0..1, the chain's luma at that point, v = 0 at
  // the bottom like a geometry uv. The chain lands in a small target once a
  // frame and is read back (see renderTextures), so the value is a frame or
  // so behind — and 0 until the first frame arrives, so a layout fn reading it
  // on the settle after a re-run gets a number, not a crash.
  field(o = {}) {
    const res = Math.min(256, Math.max(2, Math.round(o.res ?? 64) || 64));
    const rec = { node: this, res, rt: null, data: null, site: site('field') };
    this.engine.textureFields.push(rec);
    return (u, v) => {
      const d = rec.data;
      if (!d) return 0;
      const n = rec.res;
      // clamp written so a NaN falls through to 0 instead of poisoning a layout
      const fx = (u > 1 ? 1 : u > 0 ? u : 0) * (n - 1);
      const fy = (v > 1 ? 1 : v > 0 ? v : 0) * (n - 1);
      const x0 = fx | 0, y0 = fy | 0;
      const x1 = x0 < n - 1 ? x0 + 1 : x0, y1 = y0 < n - 1 ? y0 + 1 : y0;
      const tx = fx - x0, ty = fy - y0;
      // readPixels rows run bottom-up, which is exactly uv's v — no flip
      const L = (x, y) => {
        const i = (y * n + x) * 4;
        return (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
      };
      const a = L(x0, y0) + (L(x1, y0) - L(x0, y0)) * tx;
      const b = L(x0, y1) + (L(x1, y1) - L(x0, y1)) * tx;
      return a + (b - a) * ty;
    };
  }

  // .marked() — how much of a text() is marked, 0..1 by character, as a
  // signal. Read from the parameters rather than from what was drawn, so it
  // reports whether or not the chain is on screen, and reads a sketch's own
  // ranges as readily as a feed's.
  marked() {
    if (this.kind !== 'textGen') {
      warn('.marked() belongs to text() — it reports how much of the text its ranges cover');
      return sig(() => 0);
    }
    const p = this.params;
    return sig((t) => {
      const str = String(resolve(p.text ?? '', t));
      if (!str.length) return 0;
      let n = 0;
      for (const [a, b] of normRanges(resolve(p.ranges, t), str.length)) n += b - a;
      return n / str.length;
    });
  }

  // three reads a render target's wrap mode once, when it first sets the target
  // up — so a node feeding a tiled material map has to be marked before that
  // happens, and re-marked whenever a resize forces a realloc
  _wrap(rt) {
    if (this._tiled) rt.texture.wrapS = rt.texture.wrapT = THREE.RepeatWrapping;
    // inside .radial(): x is an angle, y a radius (see markPolar)
    else if (this._polar) {
      rt.texture.wrapS = THREE.RepeatWrapping;
      rt.texture.wrapT = this._polarLog ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    }
    // A node feeding .displace() or a material map slot carries a mip pyramid.
    // For displacement the vertex shader reads it through textureLod at the
    // level matching the mesh's vertex spacing, which is what turns a busy map
    // into relief instead of grit; on a surface it's ordinary minification
    // filtering, so the map doesn't shimmer in the distance. Marked after
    // allocation too (.displace() added to a chain that already rendered),
    // which _rt's realloc condition catches.
    if (this._needsMips) {
      rt.texture.generateMipmaps = true;
      rt.texture.minFilter = THREE.LinearMipmapLinearFilter;
    }
    return rt;
  }

  _rt(ctx, key = 'main', scale = 1) {
    const w = Math.max(1, Math.round(ctx.w * scale));
    const h = Math.max(1, Math.round(ctx.h * scale));
    // a target per context as well as per slot, so a chain rendered at two
    // sizes in one frame doesn't reallocate one target back and forth
    const slot = `_tgt_${key}${ctx.rtKey ?? ''}`;
    let rt = this[slot];
    if (!rt || rt.width !== w || rt.height !== h
        || (this._needsMips && !rt.texture.generateMipmaps)) {
      rt?.dispose();
      rt = this[slot] = this._wrap(makeRT(w, h));
    }
    return rt;
  }

  renderNode(ctx) {
    // Once a frame — and once per context, since a tile set renders its sources
    // at the tile's size rather than the frame's. A chain used both ways draws
    // twice, into two sets of targets, instead of handing one size's picture to
    // the other.
    const key = ctx.rtKey ?? '';
    if (this.lastFrame === ctx.frame && this.lastCtx === key) return this._outTex;
    this.lastFrame = ctx.frame;
    this.lastCtx = key;
    // _evaluating marks this node's subtree as in progress, so an input() of a
    // buffer we're currently producing falls back to last frame's snapshot
    this._evaluating = true;
    begin(this._site);
    try {
      return (this._outTex = this._render(ctx));
    } finally {
      end();
      this._evaluating = false;
    }
  }

  _render(ctx) {
    ensurePassMaterials();

    // scene(): the geometry sent out above the call, on the sketch's
    // backdrop. scene({ bg }) swaps that backdrop for this read: a color, a
    // chain, or null for none — real coverage alpha, like a geometry layer,
    // with the same tradeoff (glass has nothing behind it to refract).
    // stack() is the same read of every layer above the call, textures and
    // their blend modes included.
    // sketch('name') is the same fold again: everything a block sent out, on
    // the block's own backdrop when it set one and on nothing when it didn't.
    if (this.kind === 'scene' || this.kind === 'stack' || this.kind === 'sketch') {
      let bg = this.params.bg;
      if (bg != null && typeof bg === 'object' && !(bg instanceof TextureOp)
          && !bg.isColor && !Array.isArray(bg)) {
        warn(`${this.kind}: bg is a color, a texture chain, or null for transparent`);
        bg = null;
      }
      const tex = this.kind === 'sketch'
        ? ctx.scopeTex(ctx, this.target, this)
        : (this.kind === 'scene' ? ctx.sceneTex : ctx.stackTex)(ctx, this.upto, bg, this);
      // a map slot reads mips, and a lone layer comes back as its own target
      const k = ctx.rtKey ?? '';
      if (!this._needsMips || [`_tgt_auxA${k}`, `_tgt_auxB${k}`, `_tgt_self${k}`].some((t) => tex === this[t]?.texture)) return tex;
      const out = this._rt(ctx);
      runPass(ctx, MAT_COPY, tex, null, out);
      return out.texture;
    }

    // .blend(): the picture is the chain's; the mode is read by the stack
    if (this.kind === 'blend') {
      if (this._needsMips) this.inputs[0]._needsMips = true;
      return this.inputs[0].renderNode(ctx);
    }

    // sky(): the sketch's backdrop on its own, as the camera sees it
    if (this.kind === 'sky') {
      const sky = ctx.skyTex(this.scope);
      if (sky) return sky;
      const out = this._rt(ctx);
      runPass(ctx, MAT_PLATE, clearTex(), null, out, (u) => setColor4(u.uBg.value, this.scope.bg, ctx.t));
      return out.texture;
    }

    // the same 3D render as scene(), read out of its depth attachment instead
    // of its color. Range defaults follow the sketch's fog when it has one —
    // depth() then lines up with what the fog is already doing.
    if (this.kind === 'depth') {
      const p = this.params;
      const cam = this.engine.cameraOf(this.scope);
      const fog = (this.scope.world ?? this.engine.scene).fog;
      const out = this._rt(ctx);
      this.mat ??= makeMaterial(SPECS.depth);
      runPass(ctx, this.mat, ctx.depthTex(this.upto, this.scope) ?? blackTex(), null, out, (u) => {
        u.uCam.value.set(cam.near, cam.far);
        u.uRange.value.set(resolve(p.near ?? fog?.near ?? 0, ctx.t), resolve(p.far ?? fog?.far ?? 20, ctx.t));
        u.uMode.value = p.focus != null ? 1 : 0;
        u.uFocus.value.set(resolve(p.focus ?? 8, ctx.t), resolve(p.range ?? 6, ctx.t));
      });
      return out.texture;
    }

    if (this.kind === 'in') {
      const { name, reset } = this.params;
      // reset fires on the rising edge of its value — reset: true blanks
      // once per run (a clean start on every ctrl+enter), a fn of t cuts
      // the loop whenever it goes truthy
      let firing = false;
      if (reset != null) {
        const v = !!resolve(reset, ctx.t);
        firing = v && !this._resetPrev;
        this._resetPrev = v;
      }
      if (name == null) {
        if (firing) ctx.fbClear(null, this.scope);
        return ctx.feedbackOf(this.scope);   // last frame's output: the display's, or inside a block the block's
      }
      const at = this._bus();
      // reading into a block counts as looking at it: it keeps running
      if (at.scope !== this.scope) at.scope.pulled = ctx.frame;
      const producer = at.scope.textureBuffers.get(at.name);
      // acyclic: pull the producer fresh this frame (plain routing between
      // chains); cyclic or unpublished: last frame's snapshot (feedback)
      if (producer && !producer._evaluating) {
        // whoever renders the texture owns the mip pyramid — see _rt
        if (this._needsMips) producer._needsMips = true;
        return producer.renderNode(ctx);
      }
      // a geometry layer published with geometry .out('name')
      const bit = at.scope.geoLayers.get(at.name);
      if (bit != null) return ctx.layerTex(at.name, bit, at.scope);
      if (firing) ctx.fbClear(at.name, at.scope);
      return ctx.fbTex(at.name, at.scope);
    }

    // text generator: drawn on a 2D canvas (any CSS font, or a font file by
    // URL), re-rendered only when the resolved content/params change — so
    // fn-of-t content is cheap
    if (this.kind === 'textGen') {
      const p = this.params;
      const str = String(resolve(p.text ?? '', ctx.t));
      // size: CSS-pixel font size (size: 100 looks like 100px on screen,
      // whatever the retina/quality scale); <= 1 = fraction of screen height.
      // Under fit it's the cap instead — the size the type may not exceed.
      const size = resolve(p.size ?? 0.15, ctx.t);
      // > 1 is CSS pixels, so it measures against how tall the canvas is
      // *displayed* — which resolution() decouples from the window height
      const shownH = ctx.renderer.domElement.clientHeight || window.innerHeight;
      const pxScale = ctx.h / shownH;
      const span = (v, of) => (v <= 1 ? v * of : v * pxScale);
      const fontPx = span(size, ctx.h);
      // this one paints on a 2D canvas rather than into a uniform, so the
      // color has to come back out as CSS; a null bg paints nothing at all
      const color = cssColor(p.color ?? '#ffffff', ctx.t);
      const bgRaw = orDflt(p.bg, '#000000');
      const bg = bgRaw == null || bgRaw === 'transparent' ? null : cssColor(bgRaw, ctx.t);
      const pos = p.pos ?? [0.5, 0.5];
      const px = resolve(pos[0], ctx.t), py = resolve(pos[1], ctx.t);
      const ff = cssFont(String(p.font ?? 'ui-monospace, Menlo, monospace'), p.weight ?? 700);
      const family = ff.family;
      const weight = p.weight ?? 700;
      const align = p.align ?? 'center';
      // both in ems, so they hold their look across sizes
      const trackingEm = resolve(p.tracking ?? 0, ctx.t);
      const leadingEm = resolve(p.leading ?? 1.2, ctx.t);

      // fit: [w, h] — the box the type is sized to fill, so two words come out
      // huge and a whole file comes out small. A size, not a position: where
      // the text sits is still pos and align.
      // fit: 0.8 is the square box, the same shorthand a bare size would read as
      const fitBox = p.fit == null ? null : Array.isArray(p.fit) ? p.fit : [p.fit, p.fit];
      const fit = fitBox ? [resolve(fitBox[0] ?? 1, ctx.t), resolve(fitBox[1] ?? 1, ctx.t)] : null;
      const wrapAt = p.wrap != null ? resolve(p.wrap, ctx.t) : null;
      const maxW = fit ? span(fit[0], ctx.w) : wrapAt != null ? span(wrapAt, ctx.w) : Infinity;
      const maxH = fit ? span(fit[1], ctx.h) : Infinity;
      // with no size to cap it, the type may grow until the box's height stops
      // it — one line filling the box is the point of asking for a fit
      const cap = fit ? (p.size != null ? fontPx : maxH) : fontPx;

      // ranges: [[start, end), ...] into the string, drawn as marks. mark says
      // how they look; the geometry and the color are separate, so recoloring
      // the marked glyphs (on) composes with any of the shapes.
      const ranges = normRanges(resolve(p.ranges, ctx.t), str.length);
      const mk = p.mark ?? {};
      const modes = (Array.isArray(mk.mode) ? mk.mode : [mk.mode ?? 'box']).map(String);
      for (const m of modes) {
        if (!MARK_MODES.includes(m)) warn(`text: mark mode "${m}" isn't one of ${MARK_MODES.join(', ')}`);
      }
      const markColor = cssColor(mk.color ?? p.color ?? '#ffffff', ctx.t);
      const onColor = mk.on != null ? cssColor(mk.on, ctx.t) : null;
      const markWeightEm = resolve(mk.weight ?? 0.06, ctx.t);
      const markPadEm = resolve(mk.pad ?? 0.08, ctx.t);
      const dimA = Math.min(1, Math.max(0, resolve(mk.dim ?? 0.25, ctx.t)));

      // Two signatures: the marks move every frame a feed changes, the layout
      // only when the string or the box does. Keeping them apart means a live
      // feed re-wraps and re-fits its text once per edit instead of once per
      // frame — and ff.loaded flips when a URL font lands, forcing both.
      const layoutSig = [str, family, ff.loaded, weight, trackingEm, leadingEm, maxW, maxH, cap, ctx.w, ctx.h].join('\x1f');
      const paintSig = [
        layoutSig, color, bg ?? '', px, py, align, ranges.join(';'),
        modes.join('+'), markColor, onColor ?? '', markWeightEm, markPadEm, dimA,
      ].join('\x1f');
      if (paintSig !== this._textSig) {
        this._textSig = paintSig;
        if (!this._canvas) {
          this._canvas = document.createElement('canvas');
          this._ctex = new THREE.CanvasTexture(this._canvas);
          // the canvas holds straight alpha; the pipeline is premultiplied.
          // With an opaque bg this is the identity it always was.
          this._ctex.premultiplyAlpha = true;
        }
        const c = this._canvas;
        // A CanvasTexture whose canvas changed size needs its GPU storage
        // thrown away: the update path re-uploads into the storage it already
        // has, so a smaller canvas lands in one corner of the old one and the
        // previous frame stays around it — two copies of the text, the live
        // one shrunk into a corner. Reachable from browser zoom past 200%,
        // where the renderer's pixel-ratio clamp starts shrinking the buffer.
        if (c.width !== ctx.w || c.height !== ctx.h) this._ctex.dispose();
        c.width = ctx.w;
        c.height = ctx.h;
        const g = c.getContext('2d');
        if (this._layoutSig !== layoutSig) {
          this._layoutSig = layoutSig;
          this._layout = layoutText(g, str, { family, weight, trackingEm, leadingEm, fontPx, maxW, maxH, cap, fit: !!fit });
        }
        paintText(g, str, this._layout, {
          w: c.width, h: c.height, bg, color, family, weight, trackingEm, leadingEm,
          align, px, py, ranges, modes, markColor, onColor, markWeightEm, markPadEm, dimA,
        });
        this._ctex.needsUpdate = true;
      }
      return this._ctex;
    }

    if (this.kind === 'switch') {
      // all of them, not just the taken branch — the others allocate on a flip
      if (this._needsMips) for (const n of this.inputs) n._needsMips = true;
      // cond picks between two (.when), index picks among any number (select)
      const { cond, index } = this.params;
      let i;
      if (cond != null) i = resolve(cond, ctx.t) >= 0.5 ? 1 : 0;
      else {
        const n = this.inputs.length;
        i = Math.floor(resolve(index, ctx.t)) % n;
        if (!Number.isFinite(i)) i = 0;
        else if (i < 0) i += n;
      }
      this._taken = i;
      return this.inputs[i].renderNode(ctx);
    }

    // camera capture (stream owned by the engine, black until it's live)
    if (this.kind === 'video') {
      return this.engine.ensureVideo(this.params.name).texture ?? blackTex();
    }
    // person(): the segmenter's mask, black until the model and stream are
    // live. The stamp tells the inference loop someone is still reading, so
    // an edited-out person() stops costing (see segment.js).
    if (this.kind === 'segment') {
      const s = this.engine.ensureSegment(this.params.name, this.params.part);
      s.wanted = performance.now();
      // capped short of 1, where the mask would freeze and never recover
      if (this.params.smooth != null)
        s.smooth = Math.min(0.95, Math.max(0, resolve(this.params.smooth, ctx.t)));
      return s.texture ?? blackTex();
    }

    // imported media files (drag-drop / picker); black until loaded, and
    // black for a nameless call while its picker is still open
    if (this.kind === 'videofile') {
      const p = this.params;
      if (p.name == null) return blackTex();
      const m = this.engine.ensureMedia('video', p.name);
      const el = m.el;
      if (el) {
        if (p.loop != null) el.loop = resolve(p.loop, ctx.t) >= 0.5;
        if (p.mute != null) el.muted = !!p.mute;
        // restart: fn of t (or signal); a rising edge through 0.5 rewinds
        // (a trigger already high on the first frame doesn't fire)
        if (p.restart != null) {
          const v = trigger(resolve(p.restart, ctx.t), this, '_restartHigh', `videofile "${p.name}" restart`);
          if (v >= 0.5 && (this._restartPrev ?? Infinity) < 0.5) el.currentTime = 0;
          this._restartPrev = v;
        }
        // phase says where in the clip to sit, jump says when to go there.
        // Alone, phase scrubs continuously, which means stopping playback so
        // the signal can hold a frame still — and a stopped element is silent.
        // A jump trigger instead seeks and lets the clip run on from where it
        // lands, so with mute: false the sound jumps around with the picture.
        // The flag lives on the media record, not the node, so dropping phase
        // from the call and re-running hands the clip back to playback.
        const scrubbing = p.jump == null && p.phase != null;
        if (m.scrubbing && !scrubbing) {
          m.scrubbing = false;
          if (!this.engine.paused) el.play().catch(() => {});
        }
        if (scrubbing) {
          if (!el.paused) el.pause();
          m.scrubbing = true;
          const to = phaseTime(resolve(p.phase, ctx.t) || 0, el);
          // only a moved target seeks, so a held phase decodes its frame once
          if (to != null && Math.abs(to - (this._seekTo ?? -1)) > 1e-4) el.currentTime = this._seekTo = to;
        } else {
          if (p.speed != null) setRate(el, resolve(p.speed, ctx.t) || 0, `videofile "${p.name}"`);
          // a rising edge through 0.5, like restart — but landing on phase
          if (p.jump != null) {
            const v = trigger(resolve(p.jump, ctx.t), this, '_jumpHigh', `videofile "${p.name}" jump`);
            if (v >= 0.5 && (this._jumpPrev ?? Infinity) < 0.5) {
              const to = phaseTime(resolve(p.phase ?? 0, ctx.t) || 0, el);
              if (to != null) el.currentTime = to;
            }
            this._jumpPrev = v;
          }
        }
      }
      return m.texture ?? blackTex();
    }
    if (this.kind === 'imagefile') {
      if (this.params.name == null) return blackTex();
      return this.engine.ensureMedia('image', this.params.name).texture ?? blackTex();
    }
    if (this.kind === 'imageseq' || this.kind === 'videoseq') {
      const media = this.kind === 'imageseq' ? 'image' : 'video';
      const { names } = this.params;
      if (!names.length) return blackTex();
      // a NaN index (a signal fed something it couldn't resolve) would index
      // past the list and ask for a file called 'undefined' — hold on the first
      const raw = Math.floor(resolve(this.params.index ?? ((t) => t), ctx.t));
      const i = Number.isFinite(raw) ? raw : 0;
      const tex = this.engine.ensureMedia(media, names[((i % names.length) + names.length) % names.length]).texture;
      // warm the rest so switching is seamless — videos keep playing while
      // unselected, so a switch lands mid-action like cutting between feeds
      for (const n of names) this.engine.ensureMedia(media, n);
      return tex ?? blackTex();
    }

    // One instanced draw of the picture so far, into a target cleared to
    // transparent — so what comes out is the copies over nothing, and the chain
    // carries on comping it like any other layer.
    if (this.kind === 'instance') {
      const inst = this._inst;
      const src = this.inputs[0].renderNode(ctx);
      const out = this._rt(ctx);
      const n = inst.count;
      const renderer = ctx.renderer;
      let c = this._copy;
      if (!c) {
        const geo = new THREE.PlaneGeometry(1, 1);
        const colors = new THREE.InstancedBufferAttribute(new Float32Array(n * 3).fill(1), 3);
        const alphas = new THREE.InstancedBufferAttribute(new Float32Array(n).fill(1), 1);
        colors.setUsage(THREE.DynamicDrawUsage);
        alphas.setUsage(THREE.DynamicDrawUsage);
        geo.setAttribute('tdColor', colors);
        geo.setAttribute('tdAlpha', alphas);
        const blend = COPY_BLEND[this.params.blend];
        const mat = new THREE.ShaderMaterial({
          vertexShader: COPY_VERT,
          fragmentShader: COPY_FRAG,
          uniforms: { tex0: { value: null } },
          depthTest: false,
          depthWrite: false,
          toneMapped: false,
          transparent: true,
          blending: THREE.CustomBlending,
          blendEquation: blend.eq,
          blendSrc: blend.src,
          blendDst: blend.dst,
          // Coverage accumulates as source-over whatever the color is doing, so
          // an additive stack still ends on an alpha the pipeline can composite
          // — and a copy's own alpha can't push the buffer's past 1.
          blendEquationAlpha: THREE.AddEquation,
          blendSrcAlpha: THREE.OneFactor,
          blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
        });
        const mesh = new THREE.InstancedMesh(geo, mat, n);
        // every copy is placed by hand and the camera sees the whole frame, so
        // three's own bounds would only ever be wrong about it
        mesh.frustumCulled = false;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        const scene = new THREE.Scene();
        scene.add(mesh);
        c = this._copy = {
          scene, mesh, mat, geo, colors, alphas,
          // y spans -0.5..0.5 (one frame height); x is set per frame, since the
          // window's aspect is what makes the space isotropic
          cam: new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0, 1),
          dummy: new THREE.Object3D(),
          handle: new CopyHandle(),
          col: new THREE.Color(),
        };
      }
      c.mat.uniforms.tex0.value = src;
      const t = ctx.t;
      // only x moves, with the window's aspect: the frame is one unit tall by
      // definition, and a structure that doesn't fit is sized in its own rule
      c.cam.left = -0.5 * ctx.aspect;
      c.cam.right = 0.5 * ctx.aspect;
      c.cam.updateProjectionMatrix();
      for (let i = 0; i < n; i++) {
        const h = c.handle;
        h.reset();
        inst.fn(h, i, n, t);
        c.dummy.position.set(resolve(h.px, t), resolve(h.py, t), 0);
        c.dummy.rotation.set(0, 0, resolve(h.rz, t));
        // x carries the frame's aspect, so a copy keeps the picture's own shape
        // and a copy at scale 1 covers the frame exactly. T·R·S in that order,
        // so the wider-than-tall copy turns rigidly rather than shearing.
        if (h.hidden) c.dummy.scale.set(0, 0, 1);
        else c.dummy.scale.set(resolve(h.sx, t) * ctx.aspect, resolve(h.sy, t), 1);
        c.dummy.updateMatrix();
        c.mesh.setMatrixAt(i, c.dummy.matrix);
        if (h.col !== null) setColor(c.col, h.col, t);
        else c.col.setRGB(1, 1, 1);
        c.colors.array[i * 3] = c.col.r;
        c.colors.array[i * 3 + 1] = c.col.g;
        c.colors.array[i * 3 + 2] = c.col.b;
        const a = h.hidden ? 0 : Number(resolve(h.a, t));
        c.alphas.array[i] = Number.isFinite(a) ? Math.min(1, Math.max(0, a)) : 1;
      }
      c.mesh.instanceMatrix.needsUpdate = true;
      c.colors.needsUpdate = true;
      c.alphas.needsUpdate = true;
      // the copies land on nothing, not on the renderer's clear color — and
      // on a target cleared this frame, whatever the pass before us was doing
      const prevAlpha = renderer.getClearAlpha();
      const prevAutoClear = renderer.autoClear;
      renderer.setClearAlpha(0);
      renderer.autoClear = true;
      renderer.setRenderTarget(out);
      renderer.render(c.scene, c.cam);
      renderer.autoClear = prevAutoClear;
      renderer.setClearAlpha(prevAlpha);
      return out.texture;
    }

    const ins = this.inputs.map((n) => n.renderNode(ctx));

    // A ring of targets written one a frame: the slot n back holds the frame n
    // back, so a delay of any length costs the same single copy. The ring grows
    // to the longest delay asked for (frames takes a fn of t like any other
    // number) and never shrinks, so a moving delay only pays the reallocation
    // the first time it reaches a new high — and loses its history when it does.
    // It advances only on the frames this node renders, so a delay behind an
    // inactive .when() branch holds rather than skips.
    //
    // Size comes from delayFit, which may store the history smaller than asked
    // to keep the count the sketch wrote.
    if (this.kind === 'delay') {
      const p = this.params;
      const hist = this.hist;
      const want = p.byMap ? p.frames : Math.max(0, Math.round(resolve(p.frames, ctx.t) || 0));
      // the ring is sized for the longest delay asked for so far, so a moving
      // frame count settles instead of rebuilding every time it changes
      hist.cap = Math.max(hist.cap, want);
      const fit = delayFit(hist.cap, p.scale, ctx.w, ctx.h);
      const n = Math.min(want, fit.frames);
      const w = Math.max(1, Math.round(ctx.w * fit.scale));
      const h = Math.max(1, Math.round(ctx.h * fit.scale));

      // Per-pixel mode: the same ring, but as one array target with a layer
      // per frame, because only a layered texture lets the read pass pick a
      // different frame for every pixel (ins[1] is the map).
      if (p.byMap) {
        const layers = fit.frames + 1;
        let arr = hist.array;
        if (!arr || hist.layers !== layers || arr.width !== w || arr.height !== h) {
          disposeRing(hist);
          arr = hist.array = new THREE.WebGLArrayRenderTarget(w, h, layers, {
            type: THREE.HalfFloatType,
            depthBuffer: false,
          });
          hist.layers = layers;
          // a layer's pixels are undefined until something renders into it, and
          // the whole ring is readable before it has been written round once.
          // Seeded with the current frame, not black: a delay with no history
          // yet answers "the past looked like now", so a diff starts at zero
          // and echoes don't pop in from a black hole
          for (let i = 0; i < layers; i++) runPass(ctx, MAT_COPY, ins[0], null, arr, null, i);
          hist.slot = 0;
        }
        if (!this.engine.paused) {
          runPass(ctx, MAT_COPY, ins[0], null, arr, null, hist.slot);
          hist.slot = (hist.slot + 1) % layers;
        }
        const out = this._rt(ctx);
        runPass(ctx, MAT_DELAY_MAP, ins[1], null, out, (u) => {
          u.uHist.value = arr.texture;
          u.uSlot.value = hist.slot;
          u.uLen.value = layers;
          u.uMax.value = n;
        });
        return out.texture;
      }
      let ring = hist.ring;
      if (!ring || ring.length !== fit.frames + 1 || ring[0].width !== w || ring[0].height !== h) {
        disposeRing(hist);
        ring = hist.ring = Array.from({ length: fit.frames + 1 }, () => this._wrap(makeRT(w, h)));
        // a target's pixels are undefined until something renders into it, and
        // the whole ring is readable before it has been written round once.
        // Seeded with the current frame, not black: a delay with no history
        // yet answers "the past looked like now", so a diff starts at zero
        // and echoes don't pop in from a black hole
        for (const rt of ring) runPass(ctx, MAT_COPY, ins[0], null, rt);
        hist.slot = 0;
      }
      const len = ring.length;
      // paused holds the ring where it is, like the feedback snapshot: keeping
      // the pointer moving would march the delay back through its own history
      // while the picture stands still
      if (!this.engine.paused) {
        runPass(ctx, MAT_COPY, ins[0], null, ring[hist.slot]);
        hist.slot = (hist.slot + 1) % len;
      }
      // slot is where the next write goes, so the frame just written is behind
      // it and each older frame one further back
      return ring[(hist.slot - 1 - n + len) % len].texture;
    }

    // .flow() — this frame against the held previous one, at a coarse size of
    // its own (the held frame too, so the pair always matches), then blurred:
    // motion is only measurable on edges, and the blur spreads it across the
    // surfaces between them.
    if (this.kind === 'flow') {
      const p = this.params;
      const hist = this.hist;
      const w = Math.max(1, Math.round(ctx.w * p.scale));
      const h = Math.max(1, Math.round(ctx.h * p.scale));
      if (!hist.prev || hist.prev.width !== w || hist.prev.height !== h) {
        disposeFlow(hist);
        hist.prev = makeRT(w, h);
        hist.cur = makeRT(w, h);
        // seeded with this frame, so the first estimate is zero, not garbage
        runPass(ctx, MAT_COPY, ins[0], null, hist.prev);
      }
      if (!this.engine.paused) runPass(ctx, MAT_COPY, ins[0], null, hist.cur);
      const a = this._rt(ctx, 'auxA', p.scale);
      runPass(ctx, MAT_FLOW, hist.cur.texture, hist.prev.texture, a, (u) => {
        u.uGain.value = resolve(p.gain ?? 1, ctx.t);
      });
      // paused holds the pair where it is, like the delay ring: the estimate
      // stands still with the picture
      if (!this.engine.paused) { const held = hist.prev; hist.prev = hist.cur; hist.cur = held; }
      const r = resolve(p.blur ?? 4, ctx.t);
      if (r <= 0) return a.texture;
      const b = this._rt(ctx, 'auxB', p.scale);
      const out = this._rt(ctx, 'main', p.scale);
      runPass(ctx, MAT_BLUR, a.texture, null, b, (u) => u.uDir.value.set(r, 0));
      runPass(ctx, MAT_BLUR, b.texture, null, out, (u) => u.uDir.value.set(0, r));
      return out.texture;
    }

    // .pixelsort() — keys built from the current frame, run through the full
    // Batcher network, one gather out (see the MAT_S* materials). Stateless
    // and fully converged: only the finished sort ever shows.
    if (this.kind === 'pixelsort') {
      const p = this.params;
      const dirs = { up: [0, 1, 1], down: [0, 1, -1], right: [1, 0, 1], left: [1, 0, -1] };
      // a vector dir ([1, 1] is down-right, screen-wise) splits into its
      // dominant axis plus a slope; the shear passes make that direction an
      // exact texel line
      let dir = dirs[p.dir ?? 'down'], slope = 0;
      if (Array.isArray(p.dir)) {
        const vx = Number(resolve(p.dir[0], ctx.t)) || 0, vy = Number(resolve(p.dir[1], ctx.t)) || 0;
        if (!vx && !vy) dir = dirs.down;
        else if (Math.abs(vy) >= Math.abs(vx)) { dir = [0, 1, vy > 0 ? -1 : 1]; slope = -vx / vy; }
        else { dir = [1, 0, vx > 0 ? 1 : -1]; slope = -vy / vx; }
      } else if (!dir) {
        warn(`pixelsort: no dir '${p.dir}' — up, down, left, right, or an [x, y] vector; sorting down`);
        dir = dirs.down;
      }
      const th = resolve(p.threshold ?? 0.35, ctx.t);
      const thMap = p.byThMap ? ins[1] : null;
      const rawJitter = resolve(p.jitter ?? 0, ctx.t);
      const jitter = Number.isFinite(rawJitter) ? Math.min(1, Math.max(0, rawJitter)) : 0;
      const rawSize = Number(p.size ?? 2);
      const size = Number.isFinite(rawSize) ? Math.min(20, Math.max(1, rawSize)) : 2;
      const scale = 1 / size;
      const out = this._rt(ctx, 'main', scale);
      // hard-edged chunks on the way back up — linear magnification reads
      // as a translucent blur over the input rather than sorted pixels
      out.texture.magFilter = THREE.NearestFilter;
      const w = out.width, h = out.height;
      const n = dir[0] ? w : h;    // length along the sort axis
      const sheared = Math.abs(slope) > 1e-6;
      // the sheared buffer widens to keep every source texel covered; the
      // width quantizes so an animated dir isn't reallocating every frame
      const grow = sheared ? Math.min(n, Math.ceil((Math.abs(slope) * n) / 64) * 64) : 0;
      const off = Math.max(0, slope * n);
      const ww = dir[0] ? w : w + grow, wh = dir[0] ? h + grow : h;
      const slotRT = (slot, sw, sh, float) => {
        let rt = this[slot];
        if (!rt || rt.width !== sw || rt.height !== sh) {
          rt?.dispose();
          rt = this[slot] = new THREE.WebGLRenderTarget(sw, sh, { type: float ? THREE.FloatType : THREE.HalfFloatType, depthBuffer: false });
          if (float) rt.texture.minFilter = rt.texture.magFilter = THREE.NearestFilter;
        }
        return rt;
      };
      // key buffers hold exact row indices, which half floats stop
      // representing past 2048 — so full float, ping-ponged
      let src = slotRT('_tgt_skeyA', ww, wh, true), dst = slotRT('_tgt_skeyB', ww, wh, true);
      const axis = (u) => u.uAxis.value.set(dir[0], dir[1]);
      const shearU = (u, s, o, tw, thh) => { u.uSlope.value = s; u.uOff.value = o; u.uSTexel.value.set(1 / tw, 1 / thh); };
      let pic = ins[0];
      if (sheared) {
        const sh = slotRT('_tgt_sshear', ww, wh, false);
        runPass(ctx, MAT_SSHEAR, ins[0], null, sh, (u) => { axis(u); shearU(u, slope, off, w, h); });
        pic = sh.texture;
      }
      // walls → running max (each texel learns its nearest wall above) → keys
      runPass(ctx, MAT_SWALL, pic, thMap, src, (u) => {
        axis(u);
        u.uThresh.value = th;
        u.uJitter.value = jitter;
        u.uThMap.value = thMap ? 1 : 0;
        shearU(u, sheared ? slope : 0, sheared ? off : 0, w, h);
      });
      for (let j = 1; j < n; j *= 2) {
        runPass(ctx, MAT_SSCAN, src.texture, null, dst, (u) => { axis(u); u.uJump.value = j; });
        [src, dst] = [dst, src];
      }
      const rawLen = resolve(p.length ?? 0, ctx.t);
      const len = Number.isFinite(rawLen) && rawLen > 0
        ? Math.max(1, Math.round(rawLen / (size * Math.sqrt(1 + slope * slope)))) : 0;
      runPass(ctx, MAT_SKEY, pic, src.texture, dst, (u) => { axis(u); u.uSign.value = dir[2]; u.uLen.value = len; });
      [src, dst] = [dst, src];
      // the full merge network, then one gather through the sorted rows
      for (let pp = 1; pp < n; pp *= 2) {
        for (let k = pp; k >= 1; k >>= 1) {
          runPass(ctx, MAT_SOEM, src.texture, null, dst, (u) => {
            axis(u);
            u.uP.value = pp;
            u.uK.value = k;
            u.uCount.value = n;
          });
          [src, dst] = [dst, src];
        }
      }
      if (sheared) {
        const so = slotRT('_tgt_sshearOut', ww, wh, false);
        so.texture.magFilter = THREE.NearestFilter;
        runPass(ctx, MAT_SGATHER, pic, src.texture, so, (u) => axis(u));
        runPass(ctx, MAT_SSHEAR, so.texture, null, out, (u) => { axis(u); shearU(u, -slope, -off, ww, wh); });
      } else {
        runPass(ctx, MAT_SGATHER, pic, src.texture, out, (u) => axis(u));
      }
      return out.texture;
    }

    // .jpeg() — rows-forward (RGB→Y'CbCr), cols-forward (+ quantize/corrupt,
    // both axes frequency there), cols-inverse, rows-inverse (back to RGB).
    if (this.kind === 'jpeg') {
      const p = this.params;
      const rawQ = resolve(p.quality ?? 0.25, ctx.t);
      const q = Number.isFinite(rawQ) ? Math.min(1, Math.max(0, rawQ)) : 0.25;
      // gradient-block AC coefficients run ~0.03..0.9 (orthonormal basis), so
      // this spans invisible at quality 1 to slabs-and-ringing at 0
      const step = 0.002 + (1 - q) * (1 - q) * 0.45;
      const corrupt = Math.min(1, Math.max(0, resolve(p.corrupt ?? 0, ctx.t)));
      const seed = resolve(p.seed ?? 0, ctx.t);
      const a = this._rt(ctx, 'auxA'), b = this._rt(ctx, 'auxB'), out = this._rt(ctx);
      const pass = (src, dst, [inverse, colorIn, colorOut, quant], axis) =>
        runPass(ctx, MAT_JPEG, src, null, dst, (u) => {
          u.uAxis.value.set(axis[0], axis[1]);
          u.uInverse.value = inverse;
          u.uColorIn.value = colorIn;
          u.uColorOut.value = colorOut;
          u.uQuant.value = quant;
          u.uStep.value = step;
          u.uCorrupt.value = corrupt;
          u.uSeed.value = seed;
        });
      pass(ins[0], a, [0, 1, 0, 0], [1, 0]);
      pass(a.texture, b, [0, 0, 0, 1], [0, 1]);
      pass(b.texture, a, [1, 0, 0, 0], [0, 1]);
      pass(a.texture, out, [1, 0, 1, 0], [1, 0]);
      return out.texture;
    }

    if (this.kind === 'sdf') {
      const p = this.params;
      const a = this._rt(ctx, 'auxA'), b = this._rt(ctx, 'auxB');
      runPass(ctx, MAT_SDF_SEED, ins[0], null, a, (u) => {
        u.uThreshold.value = resolve(p.threshold ?? 0.5, ctx.t);
      });
      // largest hop first, at half the frame, then halving to one texel
      let src = a, dst = b;
      for (let jump = 2 ** Math.ceil(Math.log2(Math.max(ctx.w, ctx.h, 2)) - 1); jump >= 1; jump /= 2) {
        const j = jump;
        runPass(ctx, MAT_SDF_STEP, src.texture, null, dst, (u) => { u.uJump.value = j; });
        const prev = src; src = dst; dst = prev;
      }
      const out = this._rt(ctx);
      const mode = SDF_MODES[p.mode] ?? 0;
      runPass(ctx, MAT_SDF_OUT, src.texture, null, out, (u) => {
        u.uMode.value = mode;
        u.uSpread.value = resolve(p.spread ?? 0.25, ctx.t);
        u.uStep.value = Math.abs(resolve(p.step ?? 0.1, ctx.t));
      });
      return out.texture;
    }

    if (this.kind === 'blur') {
      const r = resolve(this.params.radius ?? 1, ctx.t);
      const rx = Array.isArray(r) ? resolve(r[0], ctx.t) : r;
      const ry = Array.isArray(r) ? resolve(r[1], ctx.t) : r;
      // a zero axis is a pass that would only copy — with both zero the blur
      // is a no-op, so hand back the input untouched
      if (rx <= 0 && ry <= 0) return ins[0];
      return gaussianBlur(ctx, ins[0], this._rt(ctx), this._rt(ctx, 'auxA'), rx, ry);
    }

    if (this.kind === 'bloom') {
      const p = this.params;
      const radius = resolve(p.radius ?? 1, ctx.t);
      const a = this._rt(ctx, 'auxA', 0.5), b = this._rt(ctx, 'auxB', 0.5), out = this._rt(ctx);
      runPass(ctx, MAT_BRIGHT, ins[0], null, a, (u) => { u.uThresh.value = resolve(p.threshold ?? 0.7, ctx.t); });
      const glow = gaussianBlur(ctx, a.texture, b, a, radius, radius);
      runPass(ctx, MAT_COMBINE, ins[0], glow, out, (u) => {
        u.uStrength.value = resolve(p.strength ?? 1, ctx.t);
        setVec3(u.uColor.value, p.color ?? 1, ctx.t);
      });
      return out.texture;
    }

    // the atlas is rebuilt only when the vocabulary or face changes, so a
    // chars/font of t costs nothing on the frames it stays put
    if (this.kind === 'ascii') {
      const p = this.params;
      const set = resolve(p.chars ?? 'ascii', ctx.t);
      const chars = Array.isArray(set)
        ? set.map(String)
        : Array.from(Object.hasOwn(ASCII_SETS, set) ? ASCII_SETS[set] : String(set));
      if (!chars.length) chars.push(' ');
      const weight = p.weight ?? 400;
      const ff = cssFont(String(p.font ?? ASCII_FONT), weight);
      const sig = [chars.join(''), ff.family, ff.loaded, weight].join('\x1f');
      if (sig !== this._atlasSig) {
        this._atlasSig = sig;
        this._atlas?.tex.dispose();
        this._atlas = asciiAtlas(chars, ff.family, weight);
      }
      const atlas = this._atlas;
      const cols = Math.max(1, Math.round(resolve(p.cols ?? 80, ctx.t)));
      // no rows given: pick the count that leaves each cell the same shape as
      // the glyph in it, so the characters come out unstretched
      const rows = p.rows != null
        ? Math.max(1, Math.round(resolve(p.rows, ctx.t)))
        : Math.max(1, Math.round((cols * atlas.aspect) / ctx.aspect));
      this.mat ??= makeMaterial(SPECS.ascii);
      const out = this._rt(ctx);
      runPass(ctx, this.mat, ins[0], atlas.tex, out, (u) => {
        u.uGrid.value.set(cols, rows);
        u.uCount.value = atlas.count;
        u.uPad.value.set(atlas.pad[0], atlas.pad[1]);
        u.uTint.value = p.color == null ? 1 : 0;
        if (p.color != null) setColor4(u.uColor.value, p.color, ctx.t);
        setColor4(u.uBg.value, orDflt(p.bg, '#000000'), ctx.t);
      });
      return out.texture;
    }

    if (this.kind === 'scroll') {
      const { vx, vy, live, slots } = this.params;
      if (!this.mat) {
        const uniforms = {
          uOff: { value: new THREE.Vector2() },
          uLive: { value: new THREE.Vector2(live[0] ? 1 : 0, live[1] ? 1 : 0) },
        };
        for (let s = 0; s < 4; s++) uniforms[`s${s}`] = { value: null };
        this.mat = new THREE.ShaderMaterial({
          vertexShader: VERT,
          fragmentShader: SCROLL_FRAG,
          uniforms,
          depthTest: false,
          depthWrite: false,
          toneMapped: false,
        });
      }
      const u = this.mat.uniforms;
      // speed × t, the way every animated generator reads its own speed — so a
      // fn of t in the slot warps the scroll rather than integrating into it
      u.uOff.value.set(
        live[0] ? (resolve(vx, ctx.t) || 0) * ctx.t : 0,
        live[1] ? (resolve(vy, ctx.t) || 0) * ctx.t : 0);
      for (let s = 0; s < 4; s++) u[`s${s}`].value = ins[slots[s]] ?? null;
      const out = this._rt(ctx);
      ctx.quad.render(ctx.renderer, this.mat, out);
      return out.texture;
    }

    if (this.kind === 'tile') {
      const { nx, ny, map } = this.params;
      if (!this._lut) {
        this._lut = new THREE.DataTexture(map, nx, ny, THREE.RedFormat, THREE.UnsignedByteType);
        this._lut.minFilter = this._lut.magFilter = THREE.NearestFilter;
        this._lut.needsUpdate = true;
      }
      if (!this.mat) {
        const uniforms = { uGrid: { value: new THREE.Vector2(nx, ny) }, uBase: { value: 0 }, uMap: { value: this._lut } };
        for (let i = 0; i < TILE_MAX; i++) uniforms[`t${i}`] = { value: null };
        this.mat = new THREE.ShaderMaterial({
          vertexShader: VERT,
          fragmentShader: TILE_FRAG,
          uniforms,
          depthTest: false,
          depthWrite: false,
          toneMapped: false,
        });
      }
      const out = this._rt(ctx);
      const renderer = ctx.renderer;
      const prevAutoClear = renderer.autoClear;
      for (let base = 0; base < ins.length; base += TILE_MAX) {
        this.mat.uniforms.uBase.value = base;
        for (let i = 0; i < TILE_MAX; i++) this.mat.uniforms[`t${i}`].value = ins[base + i] ?? null;
        renderer.autoClear = base === 0; // later batches add their cells to the same target
        ctx.quad.render(renderer, this.mat, out);
      }
      renderer.autoClear = prevAutoClear;
      return out.texture;
    }

    if (this.kind === 'mask') {
      this.mat ??= makeMaterial(SPECS.mask);
      const out = this._rt(ctx);
      runPass(ctx, this.mat, ins[0], ins[1], out, (u) => {
        u.tex2.value = ins[2] ?? null;
        u.uBlend.value = ins[2] ? 1 : 0;
      });
      return out.texture;
    }

    // The sim owns its own targets at its own grid size, so it neither uses
    // _rt nor returns a frame-size texture — what comes back is the dye at
    // sim resolution, which the next node upscales the way it samples anything.
    if (this.kind === 'fluid') return renderFluid(this, ctx, ins);
    // ins[0] is the sim node, already rendered: the graph's ordering is what
    // guarantees the fields this reads are this frame's
    if (this.kind === 'fluidView') return renderFluidView(this, ctx) ?? ins[0];

    // A pass the sketch wrote. Compiled on the first frame it draws, because
    // that is the first moment there is a GL context to compile against; the
    // node is rebuilt on every run, so an edit to the source is a new compile.
    if (this.kind === 'glsl') {
      const out = this._rt(ctx);
      const src = this.params.chained ? ins[0] : clearTex();
      this._glsl ??= buildGlsl(this, ctx.renderer);
      const { mat, slots, builtins } = this._glsl;
      // a shader that didn't compile passes its input through: the warning is
      // the report, and the rest of the chain keeps its picture
      if (!mat) {
        runPass(ctx, MAT_COPY, src, null, out);
        return out.texture;
      }
      this.mat = mat;                           // so dispose() frees it
      const first = this.inputs.length - this.params.tex.length;
      runPass(ctx, mat, src, null, out, (u) => {
        // channel 0 is the chain; the rest are whatever was bound to their
        // names, and transparent where nothing was
        const chans = [src, clearTex(), clearTex(), clearTex()];
        // the auto-declared channels first, so a name the sketch bound itself
        // overwrites the empty one rather than the other way round
        for (const n of ['iChannel1', 'iChannel2', 'iChannel3']) if (u[n]) u[n].value = clearTex();
        this.params.tex.forEach((n, i) => {
          const tex = ins[first + i] ?? clearTex();
          u[n].value = tex;
          const c = /^iChannel([0-3])$/.exec(n);
          if (c) chans[Number(c[1])] = tex;
        });
        for (const s of slots) s.write(u[s.name], ctx.t);
        if (builtins) writeShadertoy(u, ctx, this.engine, chans);
      });
      return out.texture;
    }

    const spec = SPECS[this.kind];
    // unreachable from a sketch — every kind here comes from a method above
    if (!spec) throw new Error(`unknown texture: ${this.kind}`);
    this.mat ??= makeMaterial(spec, this.texBinds);
    const out = this._rt(ctx);
    runPass(ctx, this.mat, ins[0], ins[1], out, (u) => {
      for (const b of this.texBinds) {
        u[b.tex].value = ins[b.slot];
        u[b.mod].value.set(resolve(b.amount, ctx.t), resolve(b.mid, ctx.t));
      }
      spec.update?.(u, this.params, ctx.t, ctx, ins);
    });
    return out.texture;
  }

  dispose() {
    // .delay()'s ring is deliberately not here — it outlives the patch, and
    // carry.js frees it when the call it belongs to is gone from the sketch
    // every context this node rendered in has a target set of its own, hence
    // the scan rather than the three names (see _rt)
    for (const key in this) if (key.startsWith('_tgt_')) this[key]?.dispose();
    this._lin?.dispose();
    this._lut?.dispose();
    this._ctex?.dispose();
    this._atlas?.tex.dispose();
    this.mat?.dispose();
    this._copy?.geo.dispose();
    this._copy?.mat.dispose();
    this._copy?.mesh.dispose();
  }
}

// The short forms of the two long transform verbs, so a texture chain types as
// fast as a geometry one. (.rot is .rotation's short form over there — same
// three letters mean rotation on either chain.)
TextureOp.prototype.trans = TextureOp.prototype.translate;
TextureOp.prototype.rot = TextureOp.prototype.rotate;

// ---------------------------------------------------------------------------
// textures bound to material map slots — .material({ map: scene().kaleido(6) }).
// materials.js registers { node, material, slot } on the engine; these render
// at the top of the frame, before the 3D pass that samples them, and the
// current texture is written into the slot. A geometry .displace() registers
// { node, uniform } here too: same timing, same liveness, but the texture goes
// into a uniform the vertex shader reads rather than into a material slot.

// A set of pictures in a map slot — .material({ map: [a, b, c] }) — as one 2D
// array texture, a layer per source, so a copy of an instanced mesh can pick
// among them with x.tile(n). The layers are rendered here, every frame, so a
// live chain in the set animates like any other map.
//
// The sources render in a context of their own, sized to the tile rather than
// the frame: text() then draws at the tile's aspect instead of a widescreen
// glyph waiting to be cropped, and the intermediate targets of a chain in the
// set are tile-sized too. That context has a name (rtKey), which is what lets a
// chain used here *and* in the main graph keep a target set of either size.
function renderTileSets(engine, ctx) {
  const sets = engine.textureTiles;
  if (!sets.length) return;
  let live = 0;
  for (const s of sets) {
    if (!s.isAlive()) {
      s.rt?.dispose();
      continue;
    }
    sets[live++] = s;
    const n = s.nodes.length;
    if (!s.rt) {
      s.rt = new THREE.WebGLArrayRenderTarget(s.w, s.h, n, {
        type: THREE.HalfFloatType,
        depthBuffer: false,
      });
      s.rt.texture.minFilter = THREE.LinearMipmapLinearFilter;
      s.uniform.value = s.rt.texture;
    }
    // rtKey names this context: a source shared with the main graph keeps a set
    // of targets per size instead of reallocating one every frame
    const sub = { ...ctx, w: s.w, h: s.h, res: [s.w, s.h], aspect: s.w / s.h, rtKey: `_tile${s.w}x${s.h}` };
    for (let i = 0; i < n; i++) {
      // three regenerates the pyramid after every render to the target, so only
      // the last layer of the frame asks for one
      s.rt.texture.generateMipmaps = i === n - 1;
      runPass(sub, MAT_TOLINEAR, s.nodes[i].renderNode(sub), null, s.rt, null, i);
    }
  }
  sets.length = live;
}

function renderMaterialMaps(engine, ctx) {
  const binds = engine.textureMaps;
  if (!binds.length) return;
  // a mesh whose patch was cleared takes its bindings with it
  let live = 0;
  for (const b of binds) {
    if (!b.isAlive()) continue;
    binds[live++] = b;
    // a block nobody is looking at keeps the map it last had
    if (b.tex && !engine.scopeLive(b.node.scope)) continue;
    const tex = b.node.renderNode(ctx);
    // the texture object only changes when the node reallocates its target
    // (first frame, and on resize) — the pixels change under it every frame
    if (tex === b.tex) continue;
    b.tex = tex;
    // A displacement bind whose node hands over a texture it doesn't render —
    // a camera VideoTexture, text()'s canvas — rather than one of its own
    // targets (those get their pyramid at allocation, in _rt). These re-upload
    // on needsUpdate, which re-applies sampler state, so the flip can happen
    // any time; a video bumps its version every frame and regenerates its
    // pyramid with it.
    if (b.needsMips && !tex.isRenderTargetTexture && !tex.generateMipmaps) {
      tex.generateMipmaps = true;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.needsUpdate = true;
    }
    if (b.uniform) {
      b.uniform.value = tex;
      continue;
    }
    b.configure?.(tex);
    const first = b.material[b.slot] == null;
    b.material[b.slot] = tex;
    // a slot appearing after first compile changes the shader's defines
    if (first) b.material.needsUpdate = true;
  }
  binds.length = live;
}

// A different sketch, rather than an edit of this one: every frame held
// anywhere in the stack belongs to the last one. Named buffers and layers go
// entirely, since their names were that sketch's; the ones that get
// reallocated on the next frame are dropped rather than cleared, because a
// fresh render target reads as transparent black and clearing one wouldn't
// (the renderer's clear alpha is 1, and the feedback snapshot is unplated).
export function resetTextureBuffers(engine) {
  const st = engine._textureState;
  if (!st) return;
  st.frameBase = (st.frame ?? 0) + 1;   // the next frame is this run's frame 0
  for (const rt of st.fbRTs?.values() ?? []) rt.dispose();
  st.fbRTs?.clear();
  for (const e of st.layerRTs?.values() ?? []) { e.lin.depthTexture?.dispose(); e.lin.dispose(); e.out.dispose(); }
  st.layerRTs?.clear();
  st.feedbackRT?.dispose();
  st.feedbackRT = null;
  for (const key of ['auxA', 'auxB']) {
    st.display?.[key]?.dispose();
    if (st.display) st.display[key] = null;
  }
}

// ---------------------------------------------------------------------------
// per-frame evaluation, called by the engine when a texture chain has .out() (or
// feeds a material map)

export function renderTextures(engine) {
  const renderer = engine.renderer;
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const st = engine._textureState;
  st.quad ??= new Quad();
  st.frame = (st.frame ?? 0) + 1;
  ensurePassMaterials();

  // depth() reads a 3D pass's depth attachment, which is only allocated when
  // a sketch asks for it (and stays once allocated — a re-run that drops
  // depth() isn't worth a realloc)
  const needsDepth = engine.textureNodes.some((n) => n.kind === 'depth');
  const root = engine.root;
  const stack = root.stack;

  if (!st.feedbackRT || st.feedbackRT.width !== size.x || st.feedbackRT.height !== size.y) {
    st.feedbackRT?.dispose();
    st.feedbackRT = makeRT(size.x, size.y);
  }

  // named buffers (.out('x') / input('x')); persist across
  // re-runs like the unnamed one, created black on first use
  st.fbRTs ??= new Map();
  // a block's buses are its own: 'glow' in kirb and 'glow' in the sketch are
  // two buffers. The \0 entries are each block's unnamed input().
  const busKey = (name, sc) => (sc?.parent ? `${sc.path}/${name ?? '\0self'}` : name);
  const fbRT = (name, sc) => {
    const key = busKey(name, sc);
    let rt = st.fbRTs.get(key);
    if (!rt || rt.width !== size.x || rt.height !== size.y) {
      rt?.dispose();
      rt = makeRT(size.x, size.y);
      st.fbRTs.set(key, rt);
    }
    return rt;
  };

  // A block's fog, environment and backdrop, on the scene for as long as one
  // pass draws that block's layers. Each mesh only ever renders under its own
  // block's settings, so no material sees them change.
  const WORLD = ['background', 'fog', 'environment', 'environmentIntensity', 'backgroundBlurriness', 'backgroundIntensity'];
  const withWorld = (sc, fn) => {
    const w = sc?.world;
    if (!w) return fn();
    const scene = engine.scene;
    const kept = WORLD.map((k) => scene[k]);
    const envRot = scene.environmentRotation.clone();
    const bgRot = scene.backgroundRotation.clone();
    for (const k of WORLD) scene[k] = w[k];
    scene.environmentRotation.copy(w.environmentRotation);
    scene.backgroundRotation.copy(w.backgroundRotation);
    try {
      return fn();
    } finally {
      WORLD.forEach((k, i) => { scene[k] = kept[i]; });
      scene.environmentRotation.copy(envRot);
      scene.backgroundRotation.copy(bgRot);
    }
  };

  // One 3D pass as a display-space texture: the camera masked to `mask` (none
  // draws the backdrop alone), tonemapped at the same boundary scene() always
  // had. bg undefined keeps the sketch's backdrop and comes back opaque; null
  // clears transparent, so the pass carries real coverage alpha and comps
  // 'over' as a sprite; a Color paints this pass only. Memoized per frame per key.
  st.layerRTs ??= new Map();
  let inMaps = false;
  const pass3d = (key, mask, bg, hold = false, sc = root) => {
    let e = st.layerRTs.get(key);
    // material maps render before the geometry that wears them, so a scene()
    // inside one reads last frame's pass — a one-frame loop, like input()
    if (hold && inMaps && e) {
      e.wanted = st.frame;
      e.redo = () => pass3d(key, mask, bg, false, sc);
      return e;
    }
    if (!e || e.lin.width !== size.x || e.lin.height !== size.y || (needsDepth && !e.lin.depthTexture)) {
      e?.lin.depthTexture?.dispose();
      e?.lin.dispose();
      e?.out.dispose();
      e = {
        // linear HDR; MSAA resolves depth alongside color
        lin: new THREE.WebGLRenderTarget(size.x, size.y, {
          type: THREE.HalfFloatType,
          samples: 4,
          depthTexture: needsDepth ? new THREE.DepthTexture(size.x, size.y) : null,
        }),
        out: makeRT(size.x, size.y),
        frame: -1,
      };
      st.layerRTs.set(key, e);
    }
    if (e.frame !== st.frame) {
      e.frame = st.frame;
      const cam = engine.cameraOf(sc);
      if (cam !== engine.camera && cam.aspect !== engine.camera.aspect) {
        cam.aspect = engine.camera.aspect;
        cam.updateProjectionMatrix();
      }
      const prevMask = cam.layers.mask;
      withWorld(sc, () => {
        const prevBg = engine.scene.background;
        const clearAlpha = renderer.getClearAlpha();
        if (bg !== undefined) engine.scene.background = bg;
        if (bg === null) renderer.setClearAlpha(0);
        // the backdrop is a mesh three unshifts into the render list with
        // every layer enabled, so it draws in whichever pass asks for it —
        // and the backdrop *alone* is that mesh in a scene with nothing else
        let scene = engine.scene;
        if (mask == null) {
          scene = st.skyScene ??= new THREE.Scene();
          scene.background = engine.scene.background;
          scene.backgroundBlurriness = engine.scene.backgroundBlurriness;
          scene.backgroundIntensity = engine.scene.backgroundIntensity;
          scene.backgroundRotation.copy(engine.scene.backgroundRotation);
        } else cam.layers.mask = mask;
        begin(PASS_3D);
        renderer.setRenderTarget(e.lin);
        // the engine falls back to a plain render when this throws, and that
        // render needs its camera back
        try {
          renderer.render(scene, cam);
        } finally {
          cam.layers.mask = prevMask;
          engine.scene.background = prevBg;
          renderer.setClearAlpha(clearAlpha);
        }
      });
      runPass(ctx, MAT_TONEMAP, e.lin.texture, null, e.out, (u) => { u.uKeepAlpha.value = bg === null ? 1 : 0; });
      end();
    }
    return e;
  };
  const layerTex = (name, bit, sc = root) => pass3d(sc.parent ? `${sc.path}/${name}` : name, 1 << bit, null, false, sc).out.texture;
  // a group of naked geometry .out()s. The \0 keeps these keys clear of any
  // name a sketch can give a layer.
  const groupPass = (g, bg, owner, sc = root) => pass3d(
    `\0g${g.bit}${bg === undefined ? 'bd' : bg === null ? 'a' : `c${engine.textureNodes.indexOf(owner)}`}`,
    1 << g.bit, bg, true, sc,
  );
  // only an hdri() backdrop is a picture; a bg() color is plated instead,
  // since a clear color through the tonemap wouldn't come out the color asked for
  const skyTex = (sc = root) => ((sc.world ?? engine.scene).background?.isTexture
    ? pass3d(`\0sky${sc.path}`, null, undefined, false, sc).out.texture : null);

  // Entries folded bottom to top through premultiplied over. bg as in
  // scene({ bg }): undefined is the sketch's backdrop, null none, else a color
  // or a chain. The first geometry group at the very bottom renders with its
  // backdrop in the same 3D pass, so glass has it to refract and edges
  // antialias against it (three draws the backdrop as a mesh on layer 0, so
  // only that group can); any other group goes in as a transparent layer.
  // `owner` lends the two targets the fold ping-pongs between.
  // The backdrop sits behind the bottom geometry group, so that group is the
  // only one that can render *on* it — which is what gives glass something to
  // refract and edges something to antialias against. At the sketch's top
  // level that group is the one on layer 0; in a block it's whichever group
  // came first, since layer 0 belongs to the display.
  const onBackdrop = (e, sc = root) => e?.kind === 'geo' && e === sc.stack.find((x) => x.kind === 'geo');
  // whether there's a picture back there at all, without rendering it to find out
  const hasSky = (sc = root) => !!(sc.world ?? engine.scene).background?.isTexture;
  const blended = (e) => e.kind === 'tex' && e.node._blends();
  const compose = (c, entries, bg, owner, sc = root) => {
    let i = 0;
    const texs = [];
    let plate = null;
    // a blend mode wants the backdrop under it, not slid in afterwards. On a
    // bg() color that means the plate goes first and the bottom group lands on
    // it as a layer (rendered on the color it would come out a different one)
    const mixed = entries.some(blended);
    if (bg instanceof TextureOp) texs.push(bg.renderNode(c));
    else if (bg !== null) {
      if (onBackdrop(entries[0], sc) && !(mixed && !hasSky(sc))) {
        const color = bg === undefined ? undefined : writeColor(owner._bgColor ??= new THREE.Color(), bg, c.t);
        texs.push(groupPass(entries[i++], color, owner, sc).out.texture);
      } else if (bg === undefined && hasSky(sc)) texs.push(skyTex(sc));
      else plate = bg === undefined ? sc.bg : bg;
    }
    const modes = texs.map(() => null);
    for (; i < entries.length; i++) {
      const e = entries[i];
      texs.push(e.kind === 'geo' ? groupPass(e, null, undefined, sc).out.texture : e.node.renderNode(c));
      modes.push(blended(e) ? e.node._blendMode() : null);
    }
    let flip = false;
    const next = () => ((flip = !flip) ? owner._rt(c, 'auxA') : owner._rt(c, 'auxB'));
    const plated = (tex) => {
      const target = next();
      runPass(c, MAT_PLATE, tex, null, target, (u) => setColor4(u.uBg.value, plate, c.t));
      return target.texture;
    };
    let acc = null;
    if (mixed && plate != null) {
      acc = plated(clearTex());
      plate = null;
    }
    for (let k = 0; k < texs.length; k++) {
      if (acc == null && !modes[k]) { acc = texs[k]; continue; }
      const target = next();
      if (modes[k]) runPass(c, MAT_STACK, acc ?? clearTex(), texs[k], target, (u) => SPECS.comp.update(u, modes[k], c.t));
      else runPass(c, MAT_OVER, acc, texs[k], target);
      acc = target.texture;
    }
    acc ??= clearTex();
    if (plate != null) acc = plated(acc);
    return acc;
  };
  // scene(): the geometry sent out above the call, and only the geometry —
  // texture .out()s in between stay where they are in the stack
  const sceneTex = (c, n, bg, owner) => compose(c, owner.scope.stack.slice(0, n).filter((e) => e.kind === 'geo'), bg, owner, owner.scope);
  // What of the stack is drawn on its own. Geometry a chain took in through
  // scene() isn't, or it would show twice through any transparency, and
  // neither is any layer a chain took in through stack().
  const visible = (entries) => {
    let taken = 0, cut = 0;
    for (const e of entries) {
      if (e.kind !== 'tex') continue;
      taken = Math.max(taken, e.taken);
      cut = Math.max(cut, e.cut);
    }
    return entries.filter((e, i) => i >= cut && (e.kind === 'tex' || i >= taken));
  };
  // stack(): every layer sent out above the call, folded as the display would
  const stackTex = (c, n, bg, owner) => compose(c, visible(owner.scope.stack.slice(0, n)), bg, owner, owner.scope);

  // sketch('name'): a block's whole stack, folded exactly the way the display
  // folds the sketch's own — the block's hdri() sky rendered behind its bottom
  // geometry group (so glass in a block refracts it, like glass in a sketch),
  // its bg() color plated at the end (a clear color through the tonemap
  // wouldn't come out the color asked for), and with neither one it comes back
  // transparent, which is what lets it comp.
  const scopeTex = (c, sc, owner) => {
    sc.pulled = c.frame;
    const shown = visible(sc.stack);
    // a block reading its own last frame wants it unbacked, for the same
    // reason the display's snapshot is: an opaque frame would end the loop
    const clean = !!sc.readsSelf;
    const based = !clean && (shown.some(blended) || (onBackdrop(shown[0], sc) && hasSky(sc)));
    const out = compose(c, shown, based ? undefined : null, owner, sc);
    if (clean && !engine.paused) runPass(c, MAT_COPY, out, null, fbRT(null, sc));
    if (based) return out;              // the backdrop is already in the fold
    const sky = hasSky(sc) ? skyTex(sc) : null;
    if (!sky && sc.bg == null) return out;
    const target = owner._rt(c, 'self');
    if (sky) runPass(c, MAT_OVER, sky, out, target);
    else runPass(c, MAT_PLATE, out, null, target, (u) => setColor4(u.uBg.value, sc.bg, c.t));
    return target.texture;
  };

  // depth() reads the nearest geometry group above it, off whichever of its
  // passes this frame already has
  const depthTex = (n, sc = root) => {
    for (let i = n - 1; i >= 0; i--) {
      const g = sc.stack[i];
      if (g.kind !== 'geo') continue;
      for (const mode of ['bd', 'a']) {
        const e = st.layerRTs.get(`\0g${g.bit}${mode}`);
        if (e?.frame === st.frame && e.lin.depthTexture) return e.lin.depthTexture;
      }
      return groupPass(g, g.bit === 0 ? undefined : null, undefined, sc).lin.depthTexture;
    }
    return null;
  };

  // the display's own pair of fold targets, handed to compose() like a node's
  st.display ??= {
    _rt(c, key) {
      let rt = this[key];
      if (!rt || rt.width !== c.w || rt.height !== c.h) {
        rt?.dispose();
        rt = this[key] = makeRT(c.w, c.h);
      }
      return rt;
    },
  };

  const ctx = {
    renderer,
    quad: st.quad,
    frame: st.frame,
    // st.frame is absolute (renderNode memoizes on it); this is the one a
    // sketch counts, zeroed by restartSketch along with the buffers
    runFrame: st.frame - (st.frameBase ??= st.frame),
    t: engine.time,
    // seconds since the last frame, for the ops that integrate rather than
    // evaluate; 0 while paused, and clamped by whoever steps on it
    dt: engine.dt ?? 0,
    w: size.x,
    h: size.y,
    // the grid a sketch counts in when it set one — the drawing buffer above is
    // that times quality(), which is a perf dial and must not move a framing
    res: engine.resolution,
    aspect: size.x / size.y,
    feedbackOf: (sc) => (sc.parent ? fbRT(null, sc) : st.feedbackRT).texture,
    fbTex: (name, sc) => fbRT(name, sc).texture,
    // a reset trigger fired: blank the held frame, so the loop starts over
    fbClear: (name, sc) => {
      const rt = name == null && !sc?.parent ? st.feedbackRT : st.fbRTs.get(busKey(name, sc));
      if (!rt) return;
      const prev = renderer.getRenderTarget();
      const alpha = renderer.getClearAlpha();
      renderer.getClearColor(clearColorTmp);
      renderer.setClearColor(0x000000, 0);
      renderer.setRenderTarget(rt);
      renderer.clear(true, false, false);
      renderer.setRenderTarget(prev);
      renderer.setClearColor(clearColorTmp, alpha);
    },
    layerTex,
    sceneTex,
    stackTex,
    scopeTex,
    skyTex,
    depthTex,
  };

  // scene() is read top to bottom like everything else, so one written above
  // the geometry it means to show reads an empty frame
  if (st.checkedGen !== engine.patchGen) {
    st.checkedGen = engine.patchGen;
    // once the whole sketch has run, so a bus published further down counts
    for (const sc of engine.scopes) {
      for (const e of sc.stack) {
        if (e.kind !== 'tex') continue;
        e.taken = e.node._consumes();
        e.cut = e.node._consumes(new Set(), 'stack');
      }
      sc.readsSelf = engine.textureNodes.some((n) => n.scope === sc && n.kind === 'in' && n.params.name == null);
    }
    for (const n of engine.textureNodes) {
      const geoAt = (from, to) => n.scope.stack.slice(from, to).some((e) => e.kind === 'geo');
      if ((n.kind === 'scene' || n.kind === 'depth') && !geoAt(0, n.upto) && geoAt(n.upto)) {
        warn(`${n.kind}(): reads what's drawn above it, and the geometry here is sent out below it, so it reads an empty frame. Move ${n.kind}() under the geometry`);
      }
      if (n.kind === 'stack' && n.upto === 0 && n.scope.stack.length) {
        warn("stack(): reads the layers sent out above it, and there are none, so it reads an empty frame. Move stack() under them");
      }
    }
  }

  // Material maps first: the 3D passes are about to sample them, so they have
  // to be this frame's.
  inMaps = true;
  renderMaterialMaps(engine, ctx);
  renderTileSets(engine, ctx);
  inMaps = false;

  if (stack.length > 1 || stack[0]?.kind === 'tex') {
    // An unnamed input() wants the frame without its backdrop (the backdrop is
    // a display step, and folding it in would hand every feedback loop an
    // opaque last frame), so the whole stack folds over nothing and the
    // backdrop goes under at the end. With nobody reading it, a bottom
    // geometry group renders on the sky instead — see compose(). Never on a
    // bg() color: through the tonemap it comes out a different color than the
    // plate paints, and which line comes first shouldn't pick between them.
    const clean = !!root.readsSelf;
    const shown = visible(stack);
    // (a blend mode does want it under: see compose())
    const based = !clean && (shown.some(blended) || (onBackdrop(shown[0], root) && hasSky(root)));
    const outTex = compose(ctx, shown, based ? undefined : null, st.display);
    const sky = based ? null : (hasSky(root) ? skyTex(root) : null);
    if (sky) runPass(ctx, MAT_OVER, sky, outTex, null);
    else runPass(ctx, MAT_PLATE, outTex, null, null, (u) => setColor4(u.uBg.value, engine.bg, ctx.t));
    // snapshot for next frame's input(); frozen while paused so trails hold
    if (!engine.paused && outTex !== st.feedbackRT.texture) {
      runPass(ctx, MAT_COPY, outTex, null, st.feedbackRT);
    }
  } else {
    // one geometry group and no texture .out() — the sketch is 3D that merely
    // feeds a chain into a material, so what's on screen is that group on its backdrop
    // (and the snapshot for next frame's input(), which is otherwise the one
    // thing this path would break)
    const tex = groupPass(stack[0] ?? { bit: 0 }, undefined).out.texture;
    runPass(ctx, MAT_COPY, tex, null, null);
    if (!engine.paused) runPass(ctx, MAT_COPY, tex, null, st.feedbackRT);
  }
  // a pass only a material map read still owes next frame its picture
  for (const e of st.layerRTs.values()) {
    if (e.wanted === st.frame && e.frame !== st.frame) e.redo();
  }
  // a pass nothing asked for lately (a renamed layer, a stack that changed
  // shape) gives its targets back
  for (const [key, e] of st.layerRTs) {
    if (st.frame - e.frame < 120) continue;
    e.lin.depthTexture?.dispose();
    e.lin.dispose();
    e.out.dispose();
    st.layerRTs.delete(key);
  }
  // named buffers: render each published chain (memoized if it was already
  // pulled this frame) and snapshot it for next frame's cyclic input(name)
  if (!engine.paused) {
    for (const sc of engine.scopes) {
      // a block nobody looked at this frame isn't run just to keep its buses warm
      if (sc.parent && sc.pulled !== st.frame) continue;
      for (const [name, node] of sc.textureBuffers) {
        const tex = node.renderNode(ctx);
        const rt = fbRT(name, sc);
        if (tex !== rt.texture) runPass(ctx, MAT_COPY, tex, null, rt);
      }
    }
    // fields: each .field() chain lands in its small unsigned-byte target and
    // is read back for the CPU samplers. Updaters ran before this, so what a
    // layout fn reads is last frame's — the one-frame latency .field()
    // promises. Frozen while paused, like the rest of the graph.
    for (const f of engine.textureFields) {
      if (f.rt && !engine.scopeLive(f.node.scope)) continue;
      const tex = f.node.renderNode(ctx);
      begin(f.site);
      if (!f.rt) {
        f.rt = new THREE.WebGLRenderTarget(f.res, f.res, { depthBuffer: false });
        f.data = new Uint8Array(f.res * f.res * 4);
      }
      runPass(ctx, MAT_COPY, tex, null, f.rt);
      // Read back without draining the pipeline: a synchronous read forces the
      // GPU to finish everything queued — a stall paid once per field per
      // frame, which is most of what track() used to cost and what a laptop
      // pays in fan noise. The async read lands a frame or so later, within
      // the latency .field() already promises. One read in flight per field,
      // so a slow GPU thins the readback rate instead of queueing behind it.
      //
      // When the pixels arrive, whoever asked gets to read them before the
      // sketch does: track() finds its blobs there (see blobs.js), which is
      // why tracking costs the same single readback a .field() does.
      if (renderer.readRenderTargetPixelsAsync) {
        if (!f.flight) {
          f.flight = true;
          const at = { t: ctx.t, aspect: ctx.aspect };
          renderer.readRenderTargetPixelsAsync(f.rt, 0, 0, f.res, f.res, f.data).then(
            () => {
              f.flight = false;
              if (f.after) {
                const t0 = performance.now();
                f.after(f.data, f.res, at);
                // charged by hand: this runs between frames, where begin/end
                // and their GPU timer queries have no frame to nest in
                f.site.cpu += performance.now() - t0;
              }
            },
            () => { f.flight = false; },
          );
        }
      } else {
        renderer.readRenderTargetPixels(f.rt, 0, 0, f.res, f.res, f.data);
        f.after?.(f.data, f.res, ctx);
      }
      end();
    }
  }
  renderer.setRenderTarget(null);
}
