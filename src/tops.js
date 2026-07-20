import * as THREE from 'three';
import { SNOISE_GLSL } from './noise.js';

// Texture operators. Each op is a fragment-shader
// pass rendering into its own target; chains form a DAG evaluated once per
// frame in dependency order. `scene()` is the 3D render, `.out()` marks a
// chain as the display output, `input()` is last frame's display output.
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
`;

// ---------------------------------------------------------------------------
// shader specs — extras: extra uniform defs (JS value infers GLSL type),
// update(): resolve params (numbers or fns of t) into uniform values

const SPECS = {
  copy: {
    frag: `void main() { gl_FragColor = texture2D(tex0, vUv); }`,
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
      u.uColA.value.set(resolve(p.a ?? '#000000', t));
      u.uColB.value.set(resolve(p.b ?? '#ffffff', t));
      u.uAngle.value = resolve(p.angle ?? 0, t);
      u.uPhase.value = resolve(p.phase ?? 0, t);
    },
  },

  circle: {
    extras: { uCenter: [0.5, 0.5], uRadius: 0.25, uSoft: 0.01, uColA: '#ffffff', uColB: '#000000' },
    frag: `
      void main() {
        float d = length((vUv - uCenter) * vec2(uAspect, 1.0));
        float m = 1.0 - smoothstep(uRadius - uSoft, uRadius + uSoft, d);
        gl_FragColor = vec4(mix(uColB, uColA, m), 1.0);
      }`,
    update(u, p, t) {
      const c = p.center ?? [0.5, 0.5];
      u.uCenter.value.set(resolve(c[0], t), resolve(c[1], t));
      u.uRadius.value = resolve(p.radius ?? 0.25, t);
      u.uSoft.value = resolve(p.soft ?? 0.01, t);
      u.uColA.value.set(resolve(p.color ?? '#ffffff', t));
      u.uColB.value.set(resolve(p.bg ?? '#000000', t));
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
      u.uColA.value.set(resolve(p.a ?? '#000000', t));
      u.uColB.value.set(resolve(p.b ?? '#ffffff', t));
    },
  },

  mirror: {
    extras: { uAxis: 0, uFlip: 0 },
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
      u.uFlip.value = p.flip ? 1 : 0;
    },
  },

  kaleido: {
    extras: { uSides: 6, uRot: 0 },
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
      u.uSides.value = resolve(p.sides ?? 6, t);
      u.uRot.value = resolve(p.rotate ?? 0, t);
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
    frag: `
      void main() {
        vec3 c = texture2D(tex0, vUv).rgb;
        c = (c - 0.5) * uContrast + 0.5;
        c = mix(vec3(dot(c, LUMA)), c, uSat);
        if (uHue != 0.0) {
          // rotate around the gray axis (Rodrigues); uHue in radians
          const vec3 k = vec3(0.57735026919);
          float ca = cos(uHue), sa = sin(uHue);
          c = c * ca + cross(k, c) * sa + k * dot(k, c) * (1.0 - ca);
        }
        c = pow(max(c, 0.0), vec3(1.0 / max(uGamma, 0.001)));
        gl_FragColor = vec4(c, 1.0);
      }`,
    update(u, p, t) {
      u.uContrast.value = resolve(p.contrast ?? 1, t);
      u.uSat.value = resolve(p.saturation ?? 1, t);
      u.uGamma.value = resolve(p.gamma ?? 1, t);
      u.uHue.value = resolve(p.hue ?? 0, t) * Math.PI * 2; // turns: 1 = full wheel
    },
  },

  // .mul() then .add(): c * mul + add, per channel. The honest primitives
  // behind "brightness"; scalar or [r,g,b] values, fns of t as usual.
  math: {
    extras: { uMul: [1, 1, 1], uAdd: [0, 0, 0] },
    frag: `
      void main() {
        gl_FragColor = vec4(texture2D(tex0, vUv).rgb * uMul + uAdd, 1.0);
      }`,
    update(u, p, t) {
      setVec3(u.uMul.value, p.mul ?? 1, t);
      setVec3(u.uAdd.value, p.add ?? 0, t);
    },
  },

  posterize: {
    extras: { uSteps: 4 },
    frag: `
      void main() {
        vec3 c = texture2D(tex0, vUv).rgb;
        float n = max(uSteps, 2.0);
        gl_FragColor = vec4(clamp(floor(c * n) / (n - 1.0), 0.0, 1.0), 1.0);
      }`,
    update(u, p, t) { u.uSteps.value = resolve(p.steps ?? 4, t); },
  },

  pixellate: {
    extras: { uCells: [100, 100] },
    frag: `
      void main() {
        gl_FragColor = texture2D(tex0, (floor(vUv * uCells) + 0.5) / uCells);
      }`,
    update(u, p, t, ctx) {
      const x = Math.max(1, resolve(p.x ?? 100, t));
      const y = p.y != null ? Math.max(1, resolve(p.y, t)) : x / ctx.aspect;
      u.uCells.value.set(x, y);
    },
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

  displace: {
    extras: { uAmount: 0.1, uMid: 0.5 },
    frag: `
      void main() {
        vec2 uv = vUv + (texture2D(tex1, vUv).rg - uMid) * uAmount;
        gl_FragColor = texture2D(tex0, uv);
      }`,
    update(u, p, t) {
      u.uAmount.value = resolve(p.amount ?? 0.1, t);
      u.uMid.value = resolve(p.mid ?? 0.5, t);
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

  transform: {
    extras: { uTranslate: [0, 0], uScale: [1, 1], uRot: 0, uWrap: 0 },
    frag: `
      void main() {
        vec2 p = vUv - 0.5;
        float cs = cos(uRot), sn = sin(uRot);
        p = mat2(cs, sn, -sn, cs) * p;
        p /= uScale;
        p += 0.5 - uTranslate;
        if (uWrap > 1.5) { vec2 m = mod(p, 2.0); p = 1.0 - abs(m - 1.0); }
        else if (uWrap > 0.5) p = fract(p);
        else p = clamp(p, 0.0, 1.0);
        gl_FragColor = texture2D(tex0, p);
      }`,
    update(u, p, t) {
      const tr = p.translate ?? [0, 0];
      u.uTranslate.value.set(resolve(tr[0], t), resolve(tr[1], t));
      const s = resolve(p.scale ?? 1, t);
      Array.isArray(s) ? u.uScale.value.set(resolve(s[0], t), resolve(s[1], t)) : u.uScale.value.set(s, s);
      u.uRot.value = resolve(p.rotate ?? 0, t);
      u.uWrap.value = { clamp: 0, repeat: 1, mirror: 2 }[p.wrap ?? 'clamp'] ?? 0;
    },
  },

  threshold: {
    extras: { uLevel: 0.5, uSoft: 0 },
    frag: `
      void main() {
        float l = dot(texture2D(tex0, vUv).rgb, LUMA);
        float m = uSoft > 0.0 ? smoothstep(uLevel - uSoft, uLevel + uSoft, l) : step(uLevel, l);
        gl_FragColor = vec4(vec3(m), 1.0);
      }`,
    update(u, p, t) {
      u.uLevel.value = resolve(p.level ?? 0.5, t);
      u.uSoft.value = resolve(p.soft ?? 0, t);
    },
  },

  invert: {
    frag: `void main() { gl_FragColor = vec4(1.0 - texture2D(tex0, vUv).rgb, 1.0); }`,
  },

  comp: {
    extras: { uMode: 0, uOpacity: 1 },
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
        else               r = 1.0 - min(vec3(1.0), (1.0 - B) / max(L, vec3(0.001)));
        gl_FragColor = vec4(mix(B, clamp(r, 0.0, 1.0), uOpacity), 1.0);
      }`,
    update(u, p, t) {
      u.uMode.value = BLEND_MODES[p.mode ?? 'over'] ?? 0;
      u.uOpacity.value = resolve(p.opacity ?? 1, t);
    },
  },
};

const BLEND_MODES = {
  over: 0, normal: 0,
  add: 1,
  sub: 2, subtract: 2,
  mult: 3, multiply: 3,
  screen: 4,
  overlay: 5,
  hardlight: 6, hardLight: 6,
  softlight: 7, softLight: 7,
  darken: 8,
  lighten: 9,
  diff: 10, difference: 10,
  exclusion: 11,
  dodge: 12, colorDodge: 12,
  burn: 13, colorBurn: 13,
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
  return { value: new THREE.Color(v) };
}

function makeMaterial(spec) {
  const uniforms = {
    tex0: { value: null },
    tex1: { value: null },
    tex2: { value: null },
    uTexel: { value: new THREE.Vector2() },
    uAspect: { value: 1 },
    uTime: { value: 0 },
  };
  const decls = [];
  for (const [name, init] of Object.entries(spec.extras ?? {})) {
    uniforms[name] = inferUniform(init);
    const type =
      typeof init === 'number' ? 'float'
      : Array.isArray(init) && init.length === 2 ? 'vec2'
      : 'vec3';
    decls.push(`uniform ${type} ${name};`);
  }
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: HEADER + decls.join('\n') + '\n' + (spec.pre ?? '') + spec.frag,
    uniforms,
    depthTest: false,
    depthWrite: false,
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
  // filmic + sRGB output at the scene→TOP boundary; downstream ops then see
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
      .catch((e) => console.warn(`fizzle: font ${spec}: ${e.message ?? e}`));
  }
  return entry;
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

export class TopOp {
  constructor(engine, kind, params = {}, inputs = []) {
    this.engine = engine;
    this.kind = kind;
    this.params = params;
    this.inputs = inputs;
    this.lastFrame = -1;
    engine.topNodes.push(this);
  }

  _n(kind, params = {}, extraInputs = []) {
    return new TopOp(this.engine, kind, params, [this, ...extraInputs]);
  }

  // TOP-valued args (comp layer, displace/remap map) may be a fn of the chain
  // so far — .comp(s => s.edge(), 'add') overlays the current node's own edges
  _top(v, op) {
    if (typeof v === 'function') v = v(this);
    if (!(v instanceof TopOp)) throw new Error(`${op}: expected a TOP (or a fn of the chain returning one)`);
    return v;
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
  transform(o = {}) { return this._n('transform', o); }
  // transform shorthands (same pass; wrap etc. via the trailing options)
  translate(x = 0, y = 0, o = {}) { return this._n('transform', { translate: [x, y], ...o }); }
  rotate(v = 0, o = {}) { return this._n('transform', { rotate: v, ...o }); }
  scale(v = 1, o = {}) { return this._n('transform', { scale: v, ...o }); }
  threshold(level = 0.5, o = {}) { return this._n('threshold', { level, ...o }); }
  invert() { return this._n('invert'); }
  remap(map) { return this._n('remap', {}, [this._top(map, 'remap')]); }
  lookup(rampTop) { return this._n('lookup', {}, [this._top(rampTop, 'lookup')]); }
  displace(map, amount = 0.1, o = {}) {
    // options object in the amount slot: .displace(map, { amount, mid })
    if (amount !== null && typeof amount === 'object') { o = amount; amount = o.amount ?? 0.1; }
    return this._n('displace', { ...o, amount }, [this._top(map, 'displace')]);
  }
  comp(layer, mode = 'over', opacity = 1) { return this._n('comp', { mode, opacity }, [this._top(layer, 'comp')]); }
  // .mask(m) — multiply by the mask's luma (cutout). .mask(m, s => ...) —
  // apply fn only where the mask is bright: dry→wet blend by mask luma.
  // Both the mask and the fn's return may be fns of the chain so far.
  mask(maskTop, fn) {
    const ins = [this._top(maskTop, 'mask')];
    if (fn != null) ins.push(this._top(fn, 'mask'));
    return this._n('mask', {}, ins);
  }
  blur(radius = 1) { return this._n('blur', { radius }); }
  bloom(o = {}) { return this._n('bloom', o); }

  // .when(cond, fn) — per-frame switch: while cond(t) >= 0.5 the chain
  // becomes fn(chain), otherwise it passes through untouched. Both branches
  // are built once; only the active one renders each frame.
  when(cond, fn) {
    // a static cond can never change — resolve the branch now. (Also keeps
    // tile dedupe tight: cells that skip the fn don't drag its chain along
    // in their structural signature.)
    if (typeof cond !== 'function') return cond >= 0.5 ? this._top(fn, 'when') : this;
    return new TopOp(this.engine, 'switch', { cond }, [this, this._top(fn, 'when')]);
  }

  // .tile(nx, ny, (src, i, x, y) => variant) — tile the image nx×ny, with a
  // per-cell choice of TOP. The fn runs once per cell at eval time and may
  // return src itself, a treatment of it, or any other chain. Structurally
  // identical variants are deduped (so `src.saturation(0)` per call is fine);
  // up to 8 distinct variants. x runs left→right, y bottom→top, i = y*nx + x.
  tile(nx = 2, ny = nx, fn) {
    nx = Math.max(1, Math.round(nx));
    ny = Math.max(1, Math.round(ny));
    const variants = [];
    const bySig = new Map();
    const map = new Uint8Array(nx * ny);
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const i = y * nx + x;
        const v = (fn ? fn(this, i, x, y) : this) ?? this;
        if (!(v instanceof TopOp)) throw new Error('tile: fn must return a TOP chain');
        const sig = sigOf(v);
        let idx = bySig.get(sig);
        if (idx == null) {
          // the cell map is a Uint8 texture, so indices top out at 255
          if (variants.length >= 256) throw new Error('tile: more than 256 distinct variants');
          idx = variants.length;
          variants.push(v);
          bySig.set(sig, idx);
        }
        map[i] = idx;
      }
    }
    return new TopOp(this.engine, 'tile', { nx, ny, map }, variants);
  }

  // .out() — make this chain the display output. .out('name') — publish this
  // point of the chain as a named buffer instead: input('name') reads it, same
  // frame when the wiring is acyclic, last frame's snapshot when it loops
  // (which is what makes a cycle a feedback loop). Both are passthrough.
  out(name) {
    if (name != null) this.engine.topBuffers.set(String(name), this);
    else this.engine.topOutput = this;
    return this;
  }

  _rt(ctx, key = 'main', scale = 1) {
    const w = Math.max(1, Math.round(ctx.w * scale));
    const h = Math.max(1, Math.round(ctx.h * scale));
    let rt = this[`_tgt_${key}`];
    if (!rt || rt.width !== w || rt.height !== h) {
      rt?.dispose();
      rt = this[`_tgt_${key}`] = makeRT(w, h);
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
    if (this.kind === 'in') {
      const { name } = this.params;
      if (name == null) return ctx.feedbackTex;   // last frame's display output
      const producer = this.engine.topBuffers.get(name);
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
      const fontPx = size <= 1 ? size * ctx.h : size * (ctx.h / window.innerHeight);
      const color = String(resolve(p.color ?? '#ffffff', ctx.t));
      const bg = String(resolve(p.bg ?? '#000000', ctx.t));
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

    const ins = this.inputs.map((n) => n.renderNode(ctx));

    if (this.kind === 'blur') {
      const radius = resolve(this.params.radius ?? 1, ctx.t);
      const a = this._rt(ctx, 'auxA'), out = this._rt(ctx);
      runPass(ctx, MAT_BLUR, ins[0], null, a, (u) => u.uDir.value.set(radius, 0));
      runPass(ctx, MAT_BLUR, a.texture, null, out, (u) => u.uDir.value.set(0, radius));
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
    if (!spec) throw new Error(`unknown TOP: ${this.kind}`);
    this.mat ??= makeMaterial(spec);
    const out = this._rt(ctx);
    runPass(ctx, this.mat, ins[0], ins[1], out, (u) => spec.update?.(u, this.params, ctx.t, ctx));
    return out.texture;
  }

  dispose() {
    for (const key of ['_tgt_main', '_tgt_auxA', '_tgt_auxB']) this[key]?.dispose();
    this._lut?.dispose();
    this._ctex?.dispose();
    this.mat?.dispose();
  }
}

// ---------------------------------------------------------------------------
// per-frame evaluation, called by the engine when a TOP chain has .out()

export function renderTops(engine) {
  const renderer = engine.renderer;
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const st = engine._topState;
  st.quad ??= new Quad();
  st.frame = (st.frame ?? 0) + 1;

  // pure-TOP sketches (generators/feedback only) skip the 3D pass entirely
  const needsScene = engine.topNodes.some((n) => n.kind === 'scene');
  if (needsScene && (!st.sceneRT || st.sceneRT.width !== size.x || st.sceneRT.height !== size.y)) {
    st.sceneRT?.dispose();
    // linear HDR; the scene TOP's tonemap pass converts to display space
    st.sceneRT = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: 4,
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

  if (needsScene) {
    renderer.setRenderTarget(st.sceneRT);
    renderer.render(engine.scene, engine.camera);
  }

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
    feedbackTex: st.feedbackRT.texture,
    fbTex: (name) => fbRT(name).texture,
    layerTex,
  };

  const outTex = engine.topOutput.renderNode(ctx);
  ensurePassMaterials();
  runPass(ctx, MAT_COPY, outTex, null, null);
  // snapshot for next frame's input(); frozen while paused so trails hold
  if (!engine.paused && outTex !== st.feedbackRT.texture) {
    runPass(ctx, MAT_COPY, outTex, null, st.feedbackRT);
  }
  // named buffers: render each published chain (memoized if it was already
  // pulled this frame) and snapshot it for next frame's cyclic input(name)
  if (!engine.paused) {
    for (const [name, node] of engine.topBuffers) {
      const tex = node.renderNode(ctx);
      const rt = fbRT(name);
      if (tex !== rt.texture) runPass(ctx, MAT_COPY, tex, null, rt);
    }
  }
  renderer.setRenderTarget(null);
}
