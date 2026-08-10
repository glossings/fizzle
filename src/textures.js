import * as THREE from 'three';
import { SNOISE_GLSL } from './noise.js';
import { setColor as writeColor, cssColor } from './color.js';
import { warn, note } from './warn.js';
import { carried, isClaiming } from './carry.js';

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
        vec2 p = vUv * vec2(uAspect, 1.0) * uFreq;
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
  // neighbourhood — the a→b color mapping is the same for all of them, so any
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
        vec2 p = vUv * vec2(uAspect, 1.0) * uScale;
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
  polar: {
    extras: { uInverse: 0 },
    frag: `
      void main() {
        float rmax = 0.5 * length(vec2(uAspect, 1.0));
        if (uInverse > 0.5) {
          vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
          float r = length(p);
          float a = r > 0.0 ? atan(p.y, p.x) : 0.0;   // atan(0, 0) is undefined
          gl_FragColor = texture2D(tex0, vec2(fract(a / 6.2831853), r / rmax));
        } else {
          float a = vUv.x * 6.2831853;
          vec2 p = vec2(cos(a), sin(a)) * (vUv.y * rmax);
          gl_FragColor = texture2D(tex0, clamp(p / vec2(uAspect, 1.0) + 0.5, 0.0, 1.0));
        }
      }`,
    update(u, p, t) {
      u.uInverse.value = resolve(par(p.inverse, false), t) ? 1 : 0;
    },
  },

  // edge / slope / normalMap share one Sobel pass; only the output encoding
  // differs (magnitude / centered gradient / tangent-space normal)
  neighbor: {
    extras: { uMode: 0, uStrength: 1, uSpread: 1 },
    frag: `
      float lum(vec2 o) { return dot(texture2D(tex0, vUv + o * uTexel * uSpread).rgb, LUMA); }
      void main() {
        float tl = lum(vec2(-1.0,  1.0)), tc = lum(vec2(0.0,  1.0)), tr = lum(vec2(1.0,  1.0));
        float ml = lum(vec2(-1.0,  0.0)),                            mr = lum(vec2(1.0,  0.0));
        float bl = lum(vec2(-1.0, -1.0)), bc = lum(vec2(0.0, -1.0)), br = lum(vec2(1.0, -1.0));
        float gx = (tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl);
        float gy = (tl + 2.0 * tc + tr) - (bl + 2.0 * bc + br);
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
      u.uMode.value = { edge: 0, slope: 1, normal: 2 }[p.mode] ?? 0;
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
      const el = ctx.renderer.domElement;
      const grid = ctx.res ?? [el.clientWidth || window.innerWidth, el.clientHeight || window.innerHeight];
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
  // target can't have. So it happens here instead. Data maps (normal,
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
    extras: { uMode: 0, uOpacity: 1, uSwap: 0 },
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
        else               r = setLum(L, dot(B, LUMA));   // color: layer's color, base's brightness
        // The layer's alpha gates the blend per pixel; on opaque inputs la is
        // uOpacity and everything below collapses to the pre-alpha behavior.
        // 'over' is the true premultiplied source-over, so it takes the layer
        // premultiplied; the rest blend straight and are gated back to
        // coverage here. Swapped, source-over becomes destination-over — the
        // layer goes under, showing only where the base leaves room.
        float la = clamp(Lt.a, 0.0, 1.0) * uOpacity;
        vec3 lp = Lt.rgb * uOpacity;
        vec3 over = mix(lp + Bt.rgb * (1.0 - la), Bt.rgb + lp * (1.0 - Bt.a), uSwap);
        vec3 rgb = m < 0.5 ? over : mix(Bt.rgb, clamp(r, 0.0, 1.0), la);
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
// pass plumbing

export class Quad {
  constructor() {
    this.scene = new THREE.Scene();
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }
  render(renderer, material, target) {
    this.mesh.material = material;
    renderer.setRenderTarget(target);
    renderer.render(this.scene, this.cam);
  }
}

function inferUniform(v) {
  if (typeof v === 'number') return { value: v };
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
    warn(`${kind}: ${name} does not take a texture — the default is used instead`);
    delete params[name];
  }
  return { params, inputs, binds };
}

function makeMaterial(spec, binds = []) {
  const uniforms = {
    tex0: { value: null },
    tex1: { value: null },
    tex2: { value: null },
    uTexel: { value: new THREE.Vector2() },
    uAspect: { value: 1 },
    uTime: { value: 0 },
  };
  const bound = new Set(binds.map((b) => b.uniform));
  const decls = [];
  for (const [name, init] of Object.entries(spec.extras ?? {})) {
    uniforms[name] = inferUniform(init);
    // still declared as a uniform in JS (update() writes it either way, three
    // skips what the program doesn't use), but in GLSL the #define stands in
    if (bound.has(name)) continue;
    decls.push(`uniform ${uniformType(init)} ${name};`);
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
let MAT_COPY, MAT_BRIGHT, MAT_BLUR, MAT_COMBINE, MAT_TONEMAP, MAT_OVER, MAT_PLATE;
function ensurePassMaterials() {
  MAT_COPY ??= makeMaterial(SPECS.copy);
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
  MAT_COMBINE ??= makeMaterial({
    extras: { uStrength: 1 },
    frag: `
      void main() {
        vec4 b = texture2D(tex0, vUv);
        gl_FragColor = vec4(b.rgb + texture2D(tex1, vUv).rgb * uStrength, b.a);
      }`,
  });
}

function runPass(ctx, material, tex0, tex1, target, setup) {
  const u = material.uniforms;
  u.tex0.value = tex0 ?? null;
  u.tex1.value = tex1 ?? null;
  const w = target ? target.width : ctx.w, h = target ? target.height : ctx.h;
  u.uTexel.value.set(1 / w, 1 / h);
  u.uAspect.value = ctx.aspect;
  u.uTime.value = ctx.t;
  setup?.(u);
  ctx.quad.render(ctx.renderer, material, target);
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

// Everything .radial() puts between its two resamples is reading a buffer whose
// x axis is an angle: at the 0/2π seam a blur or a translate has to come around
// the other side, or it pulls in the clamped edge and leaves a hairline crack
// down the frame. Mark the span so its targets repeat horizontally and its UV
// ops default to the matching wrap — neither is something the ops could know on
// their own, which is why the sandwich is one call and not two.
function markPolar(node, src, seen = new Set()) {
  if (node === src) { node._polar = true; return true; }
  if (seen.has(node)) return node._polar === true;
  seen.add(node);
  let inSpan = false;
  for (const n of node.inputs) if (markPolar(n, src, seen)) inSpan = true;
  if (inSpan) {
    node._polar = true;
    if (node.params.wrap === undefined && (node.kind === 'transform' || node.kind === 'warp'))
      node.params.wrap = 'polar';
  }
  return inSpan;
}

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
  const rt = engine._textureState.fbRTs?.get(name);
  if (rt) {
    rt.dispose();
    engine._textureState.fbRTs.delete(name);
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
      return `__${key}`;
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
    this.kind = kind;
    this.params = bound.params;
    this.inputs = bound.inputs;
    this.texBinds = bound.binds;
    this.lastFrame = -1;
    engine.textureNodes.push(this);
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
  radial(fn) {
    const src = this._n('polar');
    const inner = src._texture(fn, 'radial');   // fn's arg is the chain *in* polar space
    if (!inner) return this;
    markPolar(inner, src);
    return inner._n('polar', { inverse: true });
  }

  // one way, as an effect rather than a coordinate change: forward unrolls the
  // frame into a ring chart, `inverse` wraps it into a disc (a horizon becomes
  // a little planet). The round trip is .radial().
  polar(o = {}) { return this._n('polar', o); }
  edge(o = {}) { return this._n('neighbor', { mode: 'edge', ...o }); }
  slope(o = {}) { return this._n('neighbor', { mode: 'slope', ...o }); }
  normalMap(o = {}) { return this._n('neighbor', { mode: 'normal', ...o }); }
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
  remap(map) {
    const m = this._texture(map, 'remap');
    return m ? this._n('remap', {}, [m]) : this;
  }
  lookup(ramp) {
    const r = this._texture(ramp, 'lookup');
    return r ? this._n('lookup', {}, [r]) : this;
  }
  tint(color = '#ffffff', o = {}) { return this._n('tint', { color, ...o }); }
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
  // options object in the mode slot: .comp(layer, { mode, opacity, swap })
  comp(layer, mode = 'over', opacity = 1, swap = false) {
    if (typeof mode === 'object' && mode !== null) {
      ({ mode = 'over', opacity = 1, swap = false } = mode);
    }
    const l = this._texture(layer, 'comp');
    return l ? this._n('comp', { mode, opacity, swap }, [l]) : this;
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
    const node = this._n('delay', { ...o, frames, scale: Math.min(1, Math.max(0.05, o.scale ?? 1)) });
    node.hist = carried('delay', () => ({ ring: null, slot: 0, cap: 0 }), disposeRing);
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
    let prev = new TextureOp(this.engine, 'in', { name });
    if (fn != null) {
      const treated = typeof fn === 'function' ? fn(prev) : fn;
      if (treated instanceof TextureOp) prev = treated;
      else warn('feedback: the second argument treats last frame — a fn of it returning a chain, like p => p.rotate(0.02). Last frame comes back untreated.');
    }
    return this.comp(prev, { mode: o.mode ?? 'add', opacity: amount, swap: o.swap }).out(name);
  }

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

  // .out() — send this chain to the display; several naked .out()s stack in
  // code order, each composited over the ones before it (premultiplied over,
  // so only where a later chain is transparent do the earlier ones show).
  // .out('name') — publish this point of the chain as a named buffer instead:
  // input('name') reads it, same frame when the wiring is acyclic, last
  // frame's snapshot when it loops (which is what makes a cycle a feedback
  // loop). Both are passthrough.
  out(name) {
    if (name != null) this.engine.textureBuffers.set(String(name), this);
    else if (!this.engine.textureOutputs.includes(this)) this.engine.textureOutputs.push(this);
    return this;
  }

  // three reads a render target's wrap mode once, when it first sets the target
  // up — so a node feeding a tiled material map has to be marked before that
  // happens, and re-marked whenever a resize forces a realloc
  _wrap(rt) {
    if (this._tiled) rt.texture.wrapS = rt.texture.wrapT = THREE.RepeatWrapping;
    // inside .radial(): x is an angle, y a radius (see markPolar)
    else if (this._polar) {
      rt.texture.wrapS = THREE.RepeatWrapping;
      rt.texture.wrapT = THREE.ClampToEdgeWrapping;
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
    let rt = this[`_tgt_${key}`];
    if (!rt || rt.width !== w || rt.height !== h
        || (this._needsMips && !rt.texture.generateMipmaps)) {
      rt?.dispose();
      rt = this[`_tgt_${key}`] = this._wrap(makeRT(w, h));
    }
    return rt;
  }

  renderNode(ctx) {
    if (this.lastFrame === ctx.frame) return this._outTex;
    this.lastFrame = ctx.frame;
    // _evaluating marks this node's subtree as in progress, so an input() of a
    // buffer we're currently producing falls back to last frame's snapshot
    this._evaluating = true;
    try {
      return (this._outTex = this._render(ctx));
    } finally {
      this._evaluating = false;
    }
  }

  _render(ctx) {
    ensurePassMaterials();

    if (this.kind === 'scene') {
      const out = this._rt(ctx);
      runPass(ctx, MAT_TONEMAP, ctx.sceneTex, null, out, (u) => { u.uKeepAlpha.value = 0; });
      return out.texture;
    }

    // the same 3D render as scene(), read out of its depth attachment instead
    // of its color. Range defaults follow the sketch's fog when it has one —
    // depth() then lines up with what the fog is already doing.
    if (this.kind === 'depth') {
      const p = this.params;
      const cam = this.engine.camera;
      const fog = this.engine.scene.fog;
      const out = this._rt(ctx);
      this.mat ??= makeMaterial(SPECS.depth);
      runPass(ctx, this.mat, ctx.sceneDepthTex ?? blackTex(), null, out, (u) => {
        u.uCam.value.set(cam.near, cam.far);
        u.uRange.value.set(resolve(p.near ?? fog?.near ?? 0, ctx.t), resolve(p.far ?? fog?.far ?? 20, ctx.t));
        u.uMode.value = p.focus != null ? 1 : 0;
        u.uFocus.value.set(resolve(p.focus ?? 8, ctx.t), resolve(p.range ?? 6, ctx.t));
      });
      return out.texture;
    }

    if (this.kind === 'in') {
      const { name } = this.params;
      if (name == null) return ctx.feedbackTex;   // last frame's display output
      const producer = this.engine.textureBuffers.get(name);
      // acyclic: pull the producer fresh this frame (plain routing between
      // chains); cyclic or unpublished: last frame's snapshot (feedback)
      if (producer && !producer._evaluating) {
        // whoever renders the texture owns the mip pyramid — see _rt
        if (this._needsMips) producer._needsMips = true;
        return producer.renderNode(ctx);
      }
      // a geometry layer published with geometry .out('name')
      const bit = this.engine.geoLayers.get(name);
      if (bit != null) return ctx.layerTex(name, bit);
      return ctx.fbTex(name);
    }

    // text generator: drawn on a 2D canvas (any CSS font, or a font file by
    // URL), re-rendered only when the resolved content/params change — so
    // fn-of-t content is cheap
    if (this.kind === 'textGen') {
      const p = this.params;
      const str = String(resolve(p.text ?? '', ctx.t));
      // size: CSS-pixel font size (size: 100 looks like 100px on screen,
      // whatever the retina/quality scale); <= 1 = fraction of screen height
      const size = resolve(p.size ?? 0.15, ctx.t);
      // > 1 is CSS pixels, so it measures against how tall the canvas is
      // *displayed* — which resolution() decouples from the window height
      const shownH = ctx.renderer.domElement.clientHeight || window.innerHeight;
      const fontPx = size <= 1 ? size * ctx.h : size * (ctx.h / shownH);
      // this one paints on a 2D canvas rather than into a uniform, so the
      // color has to come back out as CSS; a null bg paints nothing at all
      const color = cssColor(p.color ?? '#ffffff', ctx.t);
      const bgRaw = orDflt(p.bg, '#000000');
      const bg = bgRaw == null || bgRaw === 'transparent' ? null : cssColor(bgRaw, ctx.t);
      const pos = p.pos ?? [0.5, 0.5];
      const px = resolve(pos[0], ctx.t), py = resolve(pos[1], ctx.t);
      const ff = cssFont(String(p.font ?? 'ui-monospace, Menlo, monospace'), p.weight ?? 700);
      const font = ff.family;
      const weight = p.weight ?? 700;
      const align = p.align ?? 'center';
      // ff.loaded flips when a URL font finishes loading, forcing a redraw
      const sig = [str, fontPx, color, bg ?? '', px, py, font, ff.loaded, weight, align, ctx.w, ctx.h].join('\x1f');
      if (sig !== this._textSig) {
        this._textSig = sig;
        if (!this._canvas) {
          this._canvas = document.createElement('canvas');
          this._ctex = new THREE.CanvasTexture(this._canvas);
          // the canvas holds straight alpha; the pipeline is premultiplied.
          // With an opaque bg this is the identity it always was.
          this._ctex.premultiplyAlpha = true;
        }
        const c = this._canvas;
        c.width = ctx.w;
        c.height = ctx.h;
        const g = c.getContext('2d');
        if (bg == null) g.clearRect(0, 0, c.width, c.height);
        else {
          g.fillStyle = bg;
          g.fillRect(0, 0, c.width, c.height);
        }
        g.fillStyle = color;
        g.font = `${weight} ${Math.round(fontPx)}px ${font}`;
        g.textAlign = align;
        g.textBaseline = 'middle';
        const lines = str.split('\n');
        const lineH = fontPx * 1.2;
        const y0 = (1 - py) * c.height - ((lines.length - 1) * lineH) / 2;
        lines.forEach((line, i) => g.fillText(line, px * c.width, y0 + i * lineH));
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
          const v = resolve(p.restart, ctx.t);
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
            const v = resolve(p.jump, ctx.t);
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
    if (this.kind === 'imageseq') {
      const { names } = this.params;
      if (!names.length) return blackTex();
      // a NaN index (a signal fed something it couldn't resolve) would index
      // past the list and ask for an image called 'undefined' — hold on the first
      const raw = Math.floor(resolve(this.params.index ?? ((t) => t), ctx.t));
      const i = Number.isFinite(raw) ? raw : 0;
      const tex = this.engine.ensureMedia('image', names[((i % names.length) + names.length) % names.length]).texture;
      // warm the rest so switching is seamless
      for (const n of names) this.engine.ensureMedia('image', n);
      return tex ?? blackTex();
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
      const want = Math.max(0, Math.round(resolve(p.frames, ctx.t) || 0));
      // the ring is sized for the longest delay asked for so far, so a moving
      // frame count settles instead of rebuilding every time it changes
      hist.cap = Math.max(hist.cap, want);
      const fit = delayFit(hist.cap, p.scale, ctx.w, ctx.h);
      const n = Math.min(want, fit.frames);
      const w = Math.max(1, Math.round(ctx.w * fit.scale));
      const h = Math.max(1, Math.round(ctx.h * fit.scale));
      let ring = hist.ring;
      if (!ring || ring.length !== fit.frames + 1 || ring[0].width !== w || ring[0].height !== h) {
        disposeRing(hist);
        ring = hist.ring = Array.from({ length: fit.frames + 1 }, () => this._wrap(makeRT(w, h)));
        // a target's pixels are undefined until something renders into it, and
        // the whole ring is readable before it has been written round once
        for (const rt of ring) runPass(ctx, MAT_COPY, blackTex(), null, rt);
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

    if (this.kind === 'blur') {
      const r = resolve(this.params.radius ?? 1, ctx.t);
      const rx = Array.isArray(r) ? resolve(r[0], ctx.t) : r;
      const ry = Array.isArray(r) ? resolve(r[1], ctx.t) : r;
      // a zero axis is a pass that would only copy — with both zero the blur
      // is a no-op, so hand back the input untouched
      if (rx <= 0 && ry <= 0) return ins[0];
      const out = this._rt(ctx);
      if (rx <= 0 || ry <= 0) {
        runPass(ctx, MAT_BLUR, ins[0], null, out, (u) => u.uDir.value.set(rx, ry));
        return out.texture;
      }
      const a = this._rt(ctx, 'auxA');
      runPass(ctx, MAT_BLUR, ins[0], null, a, (u) => u.uDir.value.set(rx, 0));
      runPass(ctx, MAT_BLUR, a.texture, null, out, (u) => u.uDir.value.set(0, ry));
      return out.texture;
    }

    if (this.kind === 'bloom') {
      const p = this.params;
      const radius = resolve(p.radius ?? 1, ctx.t);
      const a = this._rt(ctx, 'auxA', 0.5), b = this._rt(ctx, 'auxB', 0.5), out = this._rt(ctx);
      runPass(ctx, MAT_BRIGHT, ins[0], null, a, (u) => { u.uThresh.value = resolve(p.threshold ?? 0.7, ctx.t); });
      runPass(ctx, MAT_BLUR, a.texture, null, b, (u) => u.uDir.value.set(radius, 0));
      runPass(ctx, MAT_BLUR, b.texture, null, a, (u) => u.uDir.value.set(0, radius));
      runPass(ctx, MAT_COMBINE, ins[0], a.texture, out, (u) => { u.uStrength.value = resolve(p.strength ?? 1, ctx.t); });
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
      spec.update?.(u, this.params, ctx.t, ctx);
    });
    return out.texture;
  }

  dispose() {
    // .delay()'s ring is deliberately not here — it outlives the patch, and
    // carry.js frees it when the call it belongs to is gone from the sketch
    for (const key of ['_tgt_main', '_tgt_auxA', '_tgt_auxB']) this[key]?.dispose();
    this._lut?.dispose();
    this._ctex?.dispose();
    this._atlas?.tex.dispose();
    this.mat?.dispose();
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

function renderMaterialMaps(engine, ctx) {
  const binds = engine.textureMaps;
  if (!binds.length) return;
  // a mesh whose patch was cleared takes its bindings with it
  let live = 0;
  for (const b of binds) {
    if (!b.isAlive()) continue;
    binds[live++] = b;
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

  // depth() reads the 3D pass's depth attachment, which is only allocated when
  // a sketch asks for it (and stays once allocated — a re-run that drops
  // depth() isn't worth a realloc)
  const needsDepth = engine.textureNodes.some((n) => n.kind === 'depth');
  // pure-texture sketches (generators/feedback only) skip the 3D pass entirely.
  // With no texture .out() the display *is* the scene (we're only here to feed a
  // material map) — it still goes through the offscreen render, so that
  // scene() and input() mean the same thing they always do.
  const outs = engine.textureOutputs;
  const needsScene = !outs.length || needsDepth || engine.textureNodes.some((n) => n.kind === 'scene');
  if (needsScene && (!st.sceneRT || st.sceneRT.width !== size.x || st.sceneRT.height !== size.y
      || (needsDepth && !st.sceneRT.depthTexture))) {
    st.sceneRT?.depthTexture?.dispose();
    st.sceneRT?.dispose();
    // linear HDR; the scene texture's tonemap pass converts to display space
    st.sceneRT = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: 4,
      // MSAA resolves depth alongside color, so the 4× scene render is unchanged
      depthTexture: needsDepth ? new THREE.DepthTexture(size.x, size.y) : null,
    });
  }
  if (!st.feedbackRT || st.feedbackRT.width !== size.x || st.feedbackRT.height !== size.y) {
    st.feedbackRT?.dispose();
    st.feedbackRT = makeRT(size.x, size.y);
  }

  // named buffers (.out('x') / input('x')); persist across
  // re-runs like the unnamed one, created black on first use
  st.fbRTs ??= new Map();
  const fbRT = (name) => {
    let rt = st.fbRTs.get(name);
    if (!rt || rt.width !== size.x || rt.height !== size.y) {
      rt?.dispose();
      rt = makeRT(size.x, size.y);
      st.fbRTs.set(name, rt);
    }
    return rt;
  };

  // named geometry layers: render the scene with the camera masked to one
  // layer, on a transparent clear — the layer carries real coverage alpha, so
  // it comps 'over' as a sprite and still adds/screens exactly as it did on
  // black — then tonemap, same display-space boundary as scene(). Memoized
  // per frame per name.
  st.layerRTs ??= new Map();
  const layerTex = (name, bit) => {
    let e = st.layerRTs.get(name);
    if (!e || e.lin.width !== size.x || e.lin.height !== size.y) {
      e?.lin.dispose();
      e?.out.dispose();
      e = {
        lin: new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 }),
        out: makeRT(size.x, size.y),
        frame: -1,
      };
      st.layerRTs.set(name, e);
    }
    if (e.frame !== st.frame) {
      e.frame = st.frame;
      const cam = engine.camera;
      const mask = cam.layers.mask;
      const bg = engine.scene.background;
      const clearAlpha = renderer.getClearAlpha();
      engine.scene.background = null;
      renderer.setClearAlpha(0);
      cam.layers.mask = 1 << bit;
      renderer.setRenderTarget(e.lin);
      renderer.render(engine.scene, cam);
      cam.layers.mask = mask;
      engine.scene.background = bg;
      renderer.setClearAlpha(clearAlpha);
      runPass(ctx, MAT_TONEMAP, e.lin.texture, null, e.out, (u) => { u.uKeepAlpha.value = 1; });
    }
    return e.out.texture;
  };

  const ctx = {
    renderer,
    quad: st.quad,
    frame: st.frame,
    t: engine.time,
    w: size.x,
    h: size.y,
    // the grid a sketch counts in when it set one — the drawing buffer above is
    // that times quality(), which is a perf dial and must not move a framing
    res: engine.resolution,
    aspect: size.x / size.y,
    sceneTex: needsScene ? st.sceneRT.texture : null,
    sceneDepthTex: needsDepth ? st.sceneRT.depthTexture : null,
    feedbackTex: st.feedbackRT.texture,
    fbTex: (name) => fbRT(name).texture,
    layerTex,
  };

  // Material maps first: the 3D render is about to sample them, so they have
  // to be this frame's. The trade is that sceneTex is still *last* frame's
  // here — a chain that maps scene() onto geometry inside that same scene is a
  // one-frame feedback loop, for the same reason input() is.
  renderMaterialMaps(engine, ctx);

  if (needsScene) {
    renderer.setRenderTarget(st.sceneRT);
    renderer.render(engine.scene, engine.camera);
  }

  if (outs.length) {
    let outTex = outs[0].renderNode(ctx);
    // stacked outs fold left to right through the premultiplied-over pass, so
    // the last .out() in the sketch lands on top; a single out skips all this
    if (outs.length > 1) {
      for (const key of ['stackA', 'stackB']) {
        if (!st[key] || st[key].width !== size.x || st[key].height !== size.y) {
          st[key]?.dispose();
          st[key] = makeRT(size.x, size.y);
        }
      }
      let flip = false;
      for (let i = 1; i < outs.length; i++) {
        const target = flip ? st.stackB : st.stackA;
        runPass(ctx, MAT_OVER, outTex, outs[i].renderNode(ctx), target);
        outTex = target.texture;
        flip = !flip;
      }
    }
    runPass(ctx, MAT_PLATE, outTex, null, null, (u) => setColor4(u.uBg.value, engine.bg, ctx.t));
    // snapshot for next frame's input(); frozen while paused so trails hold.
    // Unplated on purpose — the background is a display step, and folding it in
    // here would hand every feedback loop an opaque last frame to work with.
    if (!engine.paused && outTex !== st.feedbackRT.texture) {
      runPass(ctx, MAT_COPY, outTex, null, st.feedbackRT);
    }
  } else {
    // no texture .out() — the sketch is 3D that merely feeds a chain into a
    // material, so what's on screen is the scene, reaching the canvas through
    // the same tonemap the scene texture uses (and snapshot for next frame's
    // input(), which is otherwise the one thing this path would break)
    const opaque = (u) => { u.uKeepAlpha.value = 0; };
    runPass(ctx, MAT_TONEMAP, st.sceneRT.texture, null, null, opaque);
    if (!engine.paused) runPass(ctx, MAT_TONEMAP, st.sceneRT.texture, null, st.feedbackRT, opaque);
  }
  // named buffers: render each published chain (memoized if it was already
  // pulled this frame) and snapshot it for next frame's cyclic input(name)
  if (!engine.paused) {
    for (const [name, node] of engine.textureBuffers) {
      const tex = node.renderNode(ctx);
      const rt = fbRT(name);
      if (tex !== rt.texture) runPass(ctx, MAT_COPY, tex, null, rt);
    }
  }
  renderer.setRenderTarget(null);
}
