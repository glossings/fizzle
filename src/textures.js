import * as THREE from 'three';
import { SNOISE_GLSL } from './noise.js';
import { setColor as writeColor, cssColor } from './color.js';
import { warn } from './warn.js';

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

const setVec3 = (target, v, t) => {
  v = resolve(v, t);
  if (Array.isArray(v)) target.set(resolve(v[0], t), resolve(v[1], t), resolve(v[2], t));
  else target.set(v, v, v);
};

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
// 2 mirror, 3 black. Shared by transform and warp.
vec4 wrapSample(sampler2D tex, vec2 p, float mode) {
  if (mode > 2.5) {
    if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) return vec4(0.0, 0.0, 0.0, 1.0);
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

  ramp: {
    extras: { uMode: 0, uColA: '#000000', uColB: '#ffffff', uAngle: 0, uPhase: 0 },
    frag: `
      void main() {
        vec2 p = vUv - 0.5;
        float f;
        if (uMode < 0.5) { vec2 d = vec2(cos(uAngle), sin(uAngle)); f = dot(p, d) + 0.5; }
        else if (uMode < 1.5) { f = length(p * vec2(uAspect, 1.0)) * 2.0; }
        else { f = fract(atan(p.y, p.x) / 6.2831853 + 0.5 + uAngle / 6.2831853); }
        f = clamp(f + uPhase, 0.0, 1.0);
        gl_FragColor = vec4(mix(uColA, uColB, f), 1.0);
      }`,
    update(u, p, t) {
      u.uMode.value = { linear: 0, radial: 1, angular: 2 }[p.type ?? 'linear'] ?? 0;
      setColor(u.uColA.value, p.a ?? '#000000', t);
      setColor(u.uColB.value, p.b ?? '#ffffff', t);
      u.uAngle.value = resolve(p.angle ?? 0, t);
      u.uPhase.value = resolve(p.phase ?? 0, t);
    },
  },

  circle: {
    extras: { uCenter: [0.5, 0.5], uRadius: 0.25, uSoft: 0.01, uColA: '#ffffff', uColB: '#000000' },
    // a texture in radius perturbs the rim per pixel: the disc stops being one
    // and becomes whatever blob the map describes
    texParams: { radius: 'uRadius', soft: 'uSoft', center: 'uCenter' },
    frag: `
      void main() {
        float d = length((vUv - uCenter) * vec2(uAspect, 1.0));
        float m = 1.0 - smoothstep(uRadius - uSoft, uRadius + uSoft, d);
        gl_FragColor = vec4(mix(uColB, uColA, m), 1.0);
      }`,
    update(u, p, t) {
      const c = par(p.center, [0.5, 0.5]);
      u.uCenter.value.set(resolve(c[0], t), resolve(c[1], t));
      u.uRadius.value = resolve(par(p.radius, 0.25), t);
      u.uSoft.value = resolve(par(p.soft, 0.01), t);
      setColor(u.uColA.value, p.color ?? '#ffffff', t);
      setColor(u.uColB.value, p.bg ?? '#000000', t);
    },
  },

  noiseGen: {
    extras: { uFreq: 4, uOct: 3, uLac: 2, uGain: 0.5, uSpeed: 0.3, uSeed: 0, uChannels: 1, uColA: '#000000', uColB: '#ffffff' },
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
          gl_FragColor = vec4(mix(uColA, uColB, fbm2(p, 0.0)), 1.0);
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
      u.uFreq.value = resolve(p.freq ?? 4, t);
      u.uOct.value = Math.min(8, Math.max(1, resolve(p.octaves ?? 3, t)));
      u.uLac.value = resolve(p.lacunarity ?? 2, t);
      u.uGain.value = resolve(p.gain ?? 0.5, t);
      u.uSpeed.value = resolve(p.speed ?? 0.3, t);
      u.uSeed.value = resolve(p.seed ?? 0, t);
      u.uChannels.value = Math.min(4, Math.max(1, Math.round(resolve(p.channels ?? 1, t))));
      setColor(u.uColA.value, p.a ?? '#000000', t);
      setColor(u.uColB.value, p.b ?? '#ffffff', t);
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
          gl_FragColor = vec4(vec3(length(vec2(gx, gy)) * uStrength), 1.0);
        } else if (uMode < 1.5) {
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
        vec3 c = texture2D(tex0, vUv).rgb;
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
        gl_FragColor = vec4(c, 1.0);
      }`,
    update(u, p, t) {
      u.uContrast.value = resolve(par(p.contrast, 1), t);
      u.uSat.value = resolve(par(p.saturation, 1), t);
      u.uGamma.value = resolve(par(p.gamma, 1), t);
      u.uHue.value = resolve(par(p.hue, 0), t);
    },
  },

  // .mul() then .add(): c * mul + add, per channel. The honest primitives
  // behind "brightness"; scalar or [r,g,b] values, fns of t as usual.
  math: {
    extras: { uMul: [1, 1, 1], uAdd: [0, 0, 0] },
    // the only vec3 slots in the toolkit: a texture here is read as RGB, so a
    // colored map tints per channel rather than scaling all three alike
    texParams: { mul: 'uMul', add: 'uAdd' },
    frag: `
      void main() {
        gl_FragColor = vec4(texture2D(tex0, vUv).rgb * uMul + uAdd, 1.0);
      }`,
    update(u, p, t) {
      setVec3(u.uMul.value, par(p.mul, 1), t);
      setVec3(u.uAdd.value, par(p.add, 0), t);
    },
  },

  posterize: {
    extras: { uSteps: 4 },
    texParams: { steps: 'uSteps' },
    frag: `
      void main() {
        vec3 c = texture2D(tex0, vUv).rgb;
        float n = max(uSteps, 2.0);
        gl_FragColor = vec4(clamp(floor(c * n) / (n - 1.0), 0.0, 1.0), 1.0);
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
    extras: { uGrid: [80, 24], uCount: 10, uPad: [0, 0], uColor: '#ffffff', uBg: '#000000', uTint: 1 },
    frag: `
      void main() {
        vec2 cell = floor(vUv * uGrid);
        vec2 local = fract(vUv * uGrid);
        // average the cell instead of point-sampling it: the glyph stands in
        // for everything under it, and one tap would report whatever detail
        // happened to land on the center
        vec3 src = vec3(0.0);
        for (int y = 0; y < 3; y++) {
          for (int x = 0; x < 3; x++) {
            src += texture2D(tex0, (cell + (vec2(float(x), float(y)) + 0.5) / 3.0) / uGrid).rgb;
          }
        }
        src /= 9.0;
        float l = clamp(dot(src, LUMA), 0.0, 1.0);
        float idx = min(floor(l * uCount), uCount - 1.0);
        vec2 a = vec2((idx + uPad.x + local.x * (1.0 - 2.0 * uPad.x)) / uCount,
                      uPad.y + local.y * (1.0 - 2.0 * uPad.y));
        float g = texture2D(tex1, a).r;
        gl_FragColor = vec4(mix(uBg, uTint > 0.5 ? src : uColor, g), 1.0);
      }`,
  },

  remap: {
    frag: `void main() { gl_FragColor = texture2D(tex0, texture2D(tex1, vUv).rg); }`,
  },

  lookup: {
    frag: `
      void main() {
        float l = clamp(dot(texture2D(tex0, vUv).rgb, LUMA), 0.0, 1.0);
        gl_FragColor = texture2D(tex1, vec2(l, 0.5));
      }`,
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
      u.uWrap.value = WRAP_MODES[p.wrap ?? 'black'] ?? 3;
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
        gl_FragColor = vec4(
          texture2D(tex0, vUv + d).r,
          texture2D(tex0, vUv).g,
          texture2D(tex0, vUv - d).b,
          1.0);
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
        float l = dot(texture2D(tex0, vUv).rgb, LUMA);
        // read once into locals: a texture-driven level/soft is a fetch, and
        // the #define would otherwise repeat it inside the branch
        float lv = uLevel, sf = uSoft;
        float m = sf > 0.0 ? smoothstep(lv - sf, lv + sf, l) : step(lv, l);
        gl_FragColor = vec4(vec3(m), 1.0);
      }`,
    update(u, p, t) {
      u.uLevel.value = resolve(par(p.level, 0.5), t);
      u.uSoft.value = resolve(par(p.soft, 0), t);
    },
  },

  invert: {
    frag: `void main() { gl_FragColor = vec4(1.0 - texture2D(tex0, vUv).rgb, 1.0); }`,
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
    extras: { uMode: 0, uOpacity: 1 },
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
        vec3 B = texture2D(tex0, vUv).rgb;   // base (this chain)
        vec3 L = texture2D(tex1, vUv).rgb;   // layer (composited on top)
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
        gl_FragColor = vec4(mix(B, clamp(r, 0.0, 1.0), uOpacity), 1.0);
      }`,
    update(u, p, t) {
      u.uMode.value = BLEND_MODES[p.mode ?? 'over'] ?? 0;
      u.uOpacity.value = resolve(p.opacity ?? 1, t);
    },
  },
};

const WRAP_MODES = { clamp: 0, repeat: 1, mirror: 2, black: 3 };

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

export const BLEND_MODE_NAMES = Object.keys(BLEND_MODES).filter(
  (name, i, all) => all.findIndex((n) => BLEND_MODES[n] === BLEND_MODES[name]) === i
);

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
    return { value: v.length === 3 ? new THREE.Vector3(...v) : new THREE.Vector2(...v) };
  }
  return { value: new THREE.Color().setStyle(v, THREE.LinearSRGBColorSpace) };
}

function uniformType(init) {
  return typeof init === 'number' ? 'float'
    : Array.isArray(init) && init.length === 2 ? 'vec2'
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

const LAYER_BG = new THREE.Color(0x000000);

// 1×1 black fallback (video() before the camera stream is live)
let BLACK_TEX;
function blackTex() {
  if (!BLACK_TEX) {
    BLACK_TEX = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    BLACK_TEX.needsUpdate = true;
  }
  return BLACK_TEX;
}

function makeRT(w, h) {
  return new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType,
    depthBuffer: false,
  });
}

// shared single-purpose pass materials (used sequentially, so sharing is safe)
let MAT_COPY, MAT_BRIGHT, MAT_BLUR, MAT_COMBINE, MAT_TONEMAP;
function ensurePassMaterials() {
  MAT_COPY ??= makeMaterial(SPECS.copy);
  // three only tone-maps + sRGB-encodes when rendering to the canvas, so the
  // scene lands in its RT linear. This pass replicates the renderer's ACES
  // filmic + sRGB output at the scene→texture boundary; downstream ops then see
  // exactly what a direct render would have shown.
  MAT_TONEMAP ??= makeMaterial({
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
        vec3 c = texture2D(tex0, vUv).rgb;
        c = ACESInputMat * (c / 0.6);
        c = clamp(ACESOutputMat * RRTAndODTFit(c), 0.0, 1.0);
        c = mix(pow(c, vec3(0.41666)) * 1.055 - 0.055, c * 12.92, vec3(lessThanEqual(c, vec3(0.0031308))));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  MAT_BRIGHT ??= makeMaterial({
    extras: { uThresh: 0.7 },
    frag: `
      void main() {
        vec3 c = texture2D(tex0, vUv).rgb;
        gl_FragColor = vec4(max(c - uThresh, 0.0) / max(1.0 - uThresh, 0.001), 1.0);
      }`,
  });
  MAT_BLUR ??= makeMaterial({
    extras: { uDir: [1, 0] },
    frag: `
      void main() {
        float w[5];
        w[0] = 0.227027; w[1] = 0.1945946; w[2] = 0.1216216; w[3] = 0.054054; w[4] = 0.016216;
        vec3 c = texture2D(tex0, vUv).rgb * w[0];
        for (int i = 1; i < 5; i++) {
          vec2 o = uDir * uTexel * float(i);
          c += texture2D(tex0, vUv + o).rgb * w[i];
          c += texture2D(tex0, vUv - o).rgb * w[i];
        }
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  MAT_COMBINE ??= makeMaterial({
    extras: { uStrength: 1 },
    frag: `
      void main() {
        gl_FragColor = vec4(texture2D(tex0, vUv).rgb + texture2D(tex1, vUv).rgb * uStrength, 1.0);
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

// ---------------------------------------------------------------------------
// the chainable node

export class TextureOp {
  constructor(engine, kind, params = {}, inputs = []) {
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
  edge(o = {}) { return this._n('neighbor', { mode: 'edge', ...o }); }
  slope(o = {}) { return this._n('neighbor', { mode: 'slope', ...o }); }
  normalMap(o = {}) { return this._n('neighbor', { mode: 'normal', ...o }); }
  levels(o = {}) { return this._n('adjust', o); }
  add(v = 0) { return this._n('math', { add: v }); }
  mul(v = 1) { return this._n('math', { mul: v }); }
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
  scale(v = 1, o = {}) { return this._n('transform', { scale: v, ...o }); }
  threshold(level = 0.5, o = {}) { return this._n('threshold', { level, ...o }); }
  invert() { return this._n('invert'); }
  remap(map) {
    const m = this._texture(map, 'remap');
    return m ? this._n('remap', {}, [m]) : this;
  }
  lookup(ramp) {
    const r = this._texture(ramp, 'lookup');
    return r ? this._n('lookup', {}, [r]) : this;
  }
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
  // options object in the mode slot: .comp(layer, { mode, opacity })
  comp(layer, mode = 'over', opacity = 1) {
    if (typeof mode === 'object' && mode !== null) ({ mode = 'over', opacity = 1 } = mode);
    const l = this._texture(layer, 'comp');
    return l ? this._n('comp', { mode, opacity }, [l]) : this;
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

  // .out() — make this chain the display output. .out('name') — publish this
  // point of the chain as a named buffer instead: input('name') reads it, same
  // frame when the wiring is acyclic, last frame's snapshot when it loops
  // (which is what makes a cycle a feedback loop). Both are passthrough.
  out(name) {
    if (name != null) this.engine.textureBuffers.set(String(name), this);
    else this.engine.textureOutput = this;
    return this;
  }

  _rt(ctx, key = 'main', scale = 1) {
    const w = Math.max(1, Math.round(ctx.w * scale));
    const h = Math.max(1, Math.round(ctx.h * scale));
    let rt = this[`_tgt_${key}`];
    if (!rt || rt.width !== w || rt.height !== h) {
      rt?.dispose();
      rt = this[`_tgt_${key}`] = makeRT(w, h);
      // three reads a render target's wrap mode once, when it first sets the
      // target up — so a node feeding a tiled material map has to be marked
      // before that happens, and re-marked whenever the size forces a realloc
      if (this._tiled) rt.texture.wrapS = rt.texture.wrapT = THREE.RepeatWrapping;
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
      runPass(ctx, MAT_TONEMAP, ctx.sceneTex, null, out);
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
      if (producer && !producer._evaluating) return producer.renderNode(ctx);
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
      // color has to come back out as CSS
      const color = cssColor(p.color ?? '#ffffff', ctx.t);
      const bg = cssColor(p.bg ?? '#000000', ctx.t);
      const pos = p.pos ?? [0.5, 0.5];
      const px = resolve(pos[0], ctx.t), py = resolve(pos[1], ctx.t);
      const ff = cssFont(String(p.font ?? 'ui-monospace, Menlo, monospace'), p.weight ?? 700);
      const font = ff.family;
      const weight = p.weight ?? 700;
      const align = p.align ?? 'center';
      // ff.loaded flips when a URL font finishes loading, forcing a redraw
      const sig = [str, fontPx, color, bg, px, py, font, ff.loaded, weight, align, ctx.w, ctx.h].join('\x1f');
      if (sig !== this._textSig) {
        this._textSig = sig;
        if (!this._canvas) {
          this._canvas = document.createElement('canvas');
          this._ctex = new THREE.CanvasTexture(this._canvas);
        }
        const c = this._canvas;
        c.width = ctx.w;
        c.height = ctx.h;
        const g = c.getContext('2d');
        g.fillStyle = bg;
        g.fillRect(0, 0, c.width, c.height);
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
      return this.inputs[resolve(this.params.cond, ctx.t) >= 0.5 ? 1 : 0].renderNode(ctx);
    }

    // camera capture (stream owned by the engine, black until it's live)
    if (this.kind === 'video') {
      return this.engine.ensureVideo(this.params.name).texture ?? blackTex();
    }

    // imported media files (drag-drop / picker); black until loaded, and
    // black for a nameless call while its picker is still open
    if (this.kind === 'videofile') {
      const p = this.params;
      if (p.name == null) return blackTex();
      const m = this.engine.ensureMedia('video', p.name);
      const el = m.el;
      if (el) {
        if (p.speed != null) el.playbackRate = Math.max(0, resolve(p.speed, ctx.t));
        if (p.loop != null) el.loop = resolve(p.loop, ctx.t) >= 0.5;
        if (p.mute != null) el.muted = !!p.mute;
        // restart: fn of t (or signal); a rising edge through 0.5 rewinds
        // (a trigger already high on the first frame doesn't fire)
        if (p.restart != null) {
          const v = resolve(p.restart, ctx.t);
          if (v >= 0.5 && (this._restartPrev ?? Infinity) < 0.5) el.currentTime = 0;
          this._restartPrev = v;
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
      const i = Math.floor(resolve(this.params.index ?? ((t) => t), ctx.t));
      const tex = this.engine.ensureMedia('image', names[((i % names.length) + names.length) % names.length]).texture;
      // warm the rest so switching is seamless
      for (const n of names) this.engine.ensureMedia('image', n);
      return tex ?? blackTex();
    }

    const ins = this.inputs.map((n) => n.renderNode(ctx));

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
        if (p.color != null) setColor(u.uColor.value, p.color, ctx.t);
        setColor(u.uBg.value, p.bg ?? '#000000', ctx.t);
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
    for (const key of ['_tgt_main', '_tgt_auxA', '_tgt_auxB']) this[key]?.dispose();
    this._lut?.dispose();
    this._ctex?.dispose();
    this._atlas?.tex.dispose();
    this.mat?.dispose();
  }
}

// ---------------------------------------------------------------------------
// textures bound to material map slots — .material({ map: scene().kaleido(6) }).
// materials.js registers { node, material, slot } on the engine; these render
// at the top of the frame, before the 3D pass that samples them, and the
// current texture is written into the slot.

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
  const needsScene = !engine.textureOutput || needsDepth || engine.textureNodes.some((n) => n.kind === 'scene');
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
  // layer, on black (so layers comp cleanly with add/screen), then tonemap —
  // same display-space boundary as scene(). Memoized per frame per name.
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
      engine.scene.background = LAYER_BG;
      cam.layers.mask = 1 << bit;
      renderer.setRenderTarget(e.lin);
      renderer.render(engine.scene, cam);
      cam.layers.mask = mask;
      engine.scene.background = bg;
      runPass(ctx, MAT_TONEMAP, e.lin.texture, null, e.out);
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

  if (engine.textureOutput) {
    const outTex = engine.textureOutput.renderNode(ctx);
    runPass(ctx, MAT_COPY, outTex, null, null);
    // snapshot for next frame's input(); frozen while paused so trails hold
    if (!engine.paused && outTex !== st.feedbackRT.texture) {
      runPass(ctx, MAT_COPY, outTex, null, st.feedbackRT);
    }
  } else {
    // no texture .out() — the sketch is 3D that merely feeds a chain into a
    // material, so what's on screen is the scene, reaching the canvas through
    // the same tonemap the scene texture uses (and snapshot for next frame's
    // input(), which is otherwise the one thing this path would break)
    runPass(ctx, MAT_TONEMAP, st.sceneRT.texture, null, null);
    if (!engine.paused) runPass(ctx, MAT_TONEMAP, st.sceneRT.texture, null, st.feedbackRT);
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
