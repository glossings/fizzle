import * as THREE from 'three';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TTFLoader } from 'three/addons/loaders/TTFLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import { applyNoise } from './noise.js';
import { TopOp } from './tops.js';
import { sig, valueNoise } from './audio.js';
import helvetikerRegular from './fonts/helvetiker_regular.typeface.json';
import helvetikerBold from './fonts/helvetiker_bold.typeface.json';

const fontLoader = new FontLoader();
const FONTS = {
  regular: fontLoader.parse(helvetikerRegular),
  bold: fontLoader.parse(helvetikerBold),
};

// 3D text fonts, beyond the bundled helvetiker pair. `font` may be:
//  - a parsed three.js Font (escape hatch)
//  - a URL to .typeface.json, .ttf or .otf (parsed at runtime, no conversion)
//  - a bare name: tried against installed fonts first (Chrome's Local Font
//    Access API — permission prompt, needs a user gesture), then fetched from
//    Google Fonts via the dev-server proxy
//  - 'google:Name' to skip the local lookup
// Loads are async: the mesh builds with helvetiker and swaps when ready.
// Cache persists across re-runs so the swap happens once.
const fontCache = new Map();

// The dev server answers requests for missing files with index.html (SPA
// fallback), so a bad font URL "succeeds" with an HTML body. Catch that and
// name the real problem.
async function fetchFontFile(spec, missingHint = 'is the file actually there?') {
  const res = await fetch(spec);
  if (!res.ok) throw new Error(`${spec}: HTTP ${res.status} ${await res.text().catch(() => '')}`.trim());
  const buf = await res.arrayBuffer();
  const head = new TextDecoder().decode(buf.slice(0, 64)).trimStart().toLowerCase();
  if (head.startsWith('<!doctype') || head.startsWith('<html')) {
    throw new Error(`${spec}: the server returned a page, not a font — ${missingHint}`);
  }
  return buf;
}

async function loadLocalFont(spec, weight) {
  if (!navigator.queryLocalFonts) throw new Error('no local font access in this browser');
  const fonts = await navigator.queryLocalFonts();
  const name = spec.toLowerCase();
  const matches = fonts.filter(
    (f) => f.family.toLowerCase() === name || f.fullName.toLowerCase() === name || f.postscriptName.toLowerCase() === name
  );
  if (!matches.length) throw new Error(`not installed`);
  const style = new RegExp(weight === 'bold' ? 'bold' : 'regular|normal|book|roman', 'i');
  const pick = matches.find((f) => style.test(f.style)) ?? matches[0];
  return fontLoader.parse(new TTFLoader().parse(await (await pick.blob()).arrayBuffer()));
}

async function loadGoogleFont(spec, weight) {
  const buf = await fetchFontFile(
    `/api/gfont/${encodeURIComponent(spec)}?weight=${weight === 'bold' ? 700 : 400}`,
    'the Google Fonts proxy needs the dev server'
  );
  return fontLoader.parse(new TTFLoader().parse(buf));
}

async function loadFontSpec(spec, weight) {
  if (/\.json(\?|$)/i.test(spec)) {
    const buf = await fetchFontFile(spec);
    return fontLoader.parse(JSON.parse(new TextDecoder().decode(buf)));
  }
  if (/\.(ttf|otf)(\?|$)/i.test(spec)) {
    return fontLoader.parse(new TTFLoader().parse(await fetchFontFile(spec)));
  }
  if (/^google:/i.test(spec)) return loadGoogleFont(spec.slice(7), weight);
  // bare name: installed fonts first, then Google Fonts
  let localErr = null;
  try {
    return await loadLocalFont(spec, weight);
  } catch (e) {
    localErr = e;
  }
  try {
    return await loadGoogleFont(spec, weight);
  } catch (gErr) {
    throw new Error(`font "${spec}": ${localErr.message}, and Google Fonts failed (${gErr.message})`);
  }
}

function resolveFont(o) {
  const fallback = o.weight === 'bold' ? FONTS.bold : FONTS.regular;
  const spec = o.font;
  if (!spec) return { font: fallback, pending: null };
  if (typeof spec === 'object' && spec.isFont) return { font: spec, pending: null };
  const key = `${String(spec).toLowerCase()}|${o.weight ?? ''}`;
  let cached = fontCache.get(key);
  if (cached?.isFont) return { font: cached, pending: null };
  if (!cached) {
    cached = loadFontSpec(String(spec), o.weight).then((f) => {
      fontCache.set(key, f);
      return f;
    });
    cached.catch((err) => {
      fontCache.delete(key);
      console.warn(`fizzle: ${err.message}`);
    });
    fontCache.set(key, cached);
  }
  return { font: fallback, pending: cached };
}

// Chainable operator API, synth-flavored:
//
//   sphere({ radius: 1 })
//     .pos(0, t => Math.sin(t), 0)
//     .scale(1, 2, 1)
//     .rotate(0, t => t * 0.3, 0)
//     .noise({ amp: 0.4, freq: 2, octaves: 4, speed: 0.5 })
//     .instance(50, (i, n, t) => ({ pos: [i - n / 2, 0, 0] }))
//     .material({ color: '#4fd1c5', roughness: 0.3 })
//     .out()
//
// Every numeric parameter also accepts a function of time, evaluated per
// frame, so animation falls out of the same syntax.

const resolve = (v, t) => (typeof v === 'function' ? v(t) : v);
const resolve3 = (v, t) => v.map((c) => resolve(c, t));

function buildGeometry(type, o = {}, font3d = null) {
  switch (type) {
    case 'sphere':
      return new THREE.SphereGeometry(o.radius ?? 1, o.res ?? 64, Math.ceil((o.res ?? 64) / 2));
    case 'box': {
      const r = o.res ?? 24;
      return new THREE.BoxGeometry(o.width ?? 1, o.height ?? 1, o.depth ?? 1, r, r, r);
    }
    case 'plane':
      return new THREE.PlaneGeometry(o.width ?? 10, o.height ?? 10, o.res ?? 128, o.res ?? 128);
    case 'torus':
      return new THREE.TorusGeometry(o.radius ?? 1, o.tube ?? 0.35, o.res ?? 48, (o.res ?? 48) * 2);
    case 'torusKnot':
      return new THREE.TorusKnotGeometry(o.radius ?? 1, o.tube ?? 0.3, (o.res ?? 64) * 2, o.res ?? 64, o.p ?? 2, o.q ?? 3);
    case 'cylinder':
      return new THREE.CylinderGeometry(o.radiusTop ?? 0.5, o.radiusBottom ?? 0.5, o.height ?? 1.5, o.res ?? 48, o.res ?? 48);
    case 'icosa':
      return new THREE.IcosahedronGeometry(o.radius ?? 1, o.detail ?? 8);
    case 'text3d': {
      const bevel = o.bevel ?? 0.02;
      const g = new TextGeometry(String(resolve(o.text ?? 'text', 0)), {
        font: font3d ?? (o.weight === 'bold' ? FONTS.bold : FONTS.regular),
        size: o.size ?? 1,
        depth: o.depth ?? 0.25,
        curveSegments: o.res ?? 8,
        bevelEnabled: bevel > 0,
        bevelThickness: bevel,
        bevelSize: bevel * 0.6,
        bevelSegments: 3,
      });
      if (o.center !== false) g.center();
      return g;
    }
    default:
      throw new Error(`unknown geometry: ${type}`);
  }
}

class GeoOp {
  constructor(engine, type, opts) {
    this.engine = engine;
    this.type = type;
    this.opts = opts ?? {};
    this._pos = [0, 0, 0];
    this._rot = [0, 0, 0];
    this._scale = [1, 1, 1];
    this._noise = null;
    this._instance = null;
    this._material = {};
  }

  pos(x = 0, y = 0, z = 0) { this._pos = [x, y, z]; return this; }
  rotate(x = 0, y = 0, z = 0) { this._rot = [x, y, z]; return this; }
  scale(x = 1, y, z) { this._scale = [x, y ?? x, z ?? x]; return this; }

  // amp: displacement amount · freq: spatial frequency · octaves: fbm
  // harmonics (1–8) · lacunarity/gain: per-octave freq/amp multipliers ·
  // speed: how fast the field evolves over time
  noise(o = {}) {
    this._noise = {
      amp: o.amp ?? 0.3,
      freq: o.freq ?? 1.5,
      octaves: o.octaves ?? 3,
      lacunarity: o.lacunarity ?? 2,
      gain: o.gain ?? 0.5,
      speed: o.speed ?? 0.3,
      seed: o.seed ?? 0,
    };
    return this;
  }

  // instance(count, fn) — fn(i, count, t) returns { pos, rot, scale } for
  // each copy and is re-evaluated every frame, so instances can animate.
  instance(count, fn) {
    this._instance = { count, fn: fn ?? ((i) => ({ pos: [i * 2, 0, 0] })) };
    return this;
  }

  material(o = {}) { Object.assign(this._material, o); return this; }
  color(c) { this._material.color = c; return this; }

  out(name) {
    let pendingFont = null;
    if (this.type === 'text3d') {
      const resolved = resolveFont(this.opts);
      this._font = resolved.font;
      pendingFont = resolved.pending;
    }
    const geometry = buildGeometry(this.type, this.opts, this._font);
    const m = this._material;
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(resolve(m.color ?? '#8899ff', 0)),
      roughness: m.roughness ?? 0.5,
      metalness: m.metalness ?? 0.1,
      flatShading: m.flatShading ?? false,
      wireframe: m.wireframe ?? false,
      side: this.type === 'plane' ? THREE.DoubleSide : THREE.FrontSide,
    });
    if (m.emissive) {
      material.emissive = new THREE.Color(resolve(m.emissive, 0));
      material.emissiveIntensity = m.emissiveIntensity ?? 1;
    }

    let noiseUniforms = null;
    if (this._noise) {
      noiseUniforms = {
        uTime: { value: 0 },
        uAmp: { value: 0 },
        uFreq: { value: 0 },
        uOctaves: { value: 0 },
        uLacunarity: { value: 0 },
        uGain: { value: 0 },
        uSpeed: { value: 0 },
        uSeed: { value: 0 },
      };
      applyNoise(material, noiseUniforms);
    }

    let mesh;
    const inst = this._instance;
    if (inst) {
      mesh = new THREE.InstancedMesh(geometry, material, inst.count);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    } else {
      mesh = new THREE.Mesh(geometry, material);
    }

    const dummy = new THREE.Object3D();
    // text3d with a fn for content rebuilds its geometry when the string
    // changes (e.g. a clock) — not every frame
    let lastText = this.type === 'text3d' ? String(resolve(this.opts.text ?? 'text', 0)) : null;
    const rebuildText = (s) => {
      mesh.geometry.dispose();
      mesh.geometry = buildGeometry('text3d', { ...this.opts, text: s }, this._font);
    };
    // async font arrived: swap the geometry in place (unless the patch was
    // cleared in the meantime)
    pendingFont?.then((f) => {
      this._font = f;
      if (mesh.parent) rebuildText(lastText);
    }).catch(() => { /* already warned in resolveFont */ });
    const updater = (t) => {
      // colors as fns of t (e.g. a .select() signal cycling a palette)
      if (typeof m.color === 'function') material.color.set(m.color(t));
      if (typeof m.emissive === 'function') material.emissive.set(m.emissive(t));
      if (lastText !== null && typeof this.opts.text === 'function') {
        const s = String(this.opts.text(t));
        if (s !== lastText) {
          lastText = s;
          rebuildText(s);
        }
      }
      mesh.position.set(...resolve3(this._pos, t));
      mesh.rotation.set(...resolve3(this._rot, t));
      mesh.scale.set(...resolve3(this._scale, t));

      if (noiseUniforms) {
        const n = this._noise;
        noiseUniforms.uTime.value = t;
        noiseUniforms.uAmp.value = resolve(n.amp, t);
        noiseUniforms.uFreq.value = resolve(n.freq, t);
        noiseUniforms.uOctaves.value = Math.min(8, Math.max(1, resolve(n.octaves, t)));
        noiseUniforms.uLacunarity.value = resolve(n.lacunarity, t);
        noiseUniforms.uGain.value = resolve(n.gain, t);
        noiseUniforms.uSpeed.value = resolve(n.speed, t);
        noiseUniforms.uSeed.value = resolve(n.seed, t);
      }

      if (inst) {
        for (let i = 0; i < inst.count; i++) {
          const d = inst.fn(i, inst.count, t) ?? {};
          dummy.position.set(...(d.pos ?? [0, 0, 0]));
          const r = d.rot ?? [0, 0, 0];
          dummy.rotation.set(r[0] ?? 0, r[1] ?? 0, r[2] ?? 0);
          const s = d.scale ?? 1;
          if (Array.isArray(s)) dummy.scale.set(...s); else dummy.scale.set(s, s, s);
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
        }
        mesh.instanceMatrix.needsUpdate = true;
      }
    };

    updater(0);
    // .out('name'): render into a named layer (pulled as a TOP by
    // input('name')) instead of the visible scene
    if (name != null) mesh.layers.set(this.engine.geoLayer(String(name)));
    this.engine.add(mesh, updater);
    return this;
  }
}

class LightOp {
  constructor(engine, light) {
    this.engine = engine;
    this.light = light;
    this._pos = [3, 4, 2];
  }
  pos(x, y, z) { this._pos = [x, y, z]; return this; }
  out(name) {
    // lights hit every layer by default (three culls lights by camera layer
    // mask); .out('name') restricts one to a single named geometry layer
    if (name != null) this.light.layers.set(this.engine.geoLayer(String(name)));
    else this.light.layers.enableAll();
    const updater = (t) => this.light.position.set(...resolve3(this._pos, t));
    updater(0);
    this.engine.add(this.light, updater);
    return this;
  }
}

export function makeApi(engine) {
  const geo = (type) => (opts) => new GeoOp(engine, type, opts);

  const api = {
    sphere: geo('sphere'),
    box: geo('box'),
    plane: geo('plane'),
    torus: geo('torus'),
    torusKnot: geo('torusKnot'),
    cylinder: geo('cylinder'),
    icosa: geo('icosa'),
    text3d: (text, opts) => new GeoOp(engine, 'text3d', { ...opts, text }),

    ambient(intensity = 0.3, color = 0xffffff) {
      const light = new THREE.AmbientLight(color, intensity);
      light.layers.enableAll();
      engine.add(light);
    },
    directional(o = {}) {
      return new LightOp(engine, new THREE.DirectionalLight(o.color ?? 0xffffff, o.intensity ?? 1.5));
    },
    point(o = {}) {
      return new LightOp(engine, new THREE.PointLight(o.color ?? 0xffffff, o.intensity ?? 20, o.distance ?? 0, o.decay ?? 2));
    },
    hemi(o = {}) {
      return new LightOp(engine, new THREE.HemisphereLight(o.sky ?? 0x8899ff, o.ground ?? 0x332211, o.intensity ?? 0.6));
    },

    // static args: place the camera, orbit controls stay live.
    // any function arg: the sketch drives the camera and orbiting is disabled
    // until the next re-run without a programmed camera.
    camera(x = 0, y = 2, z = 8, target = [0, 0, 0]) {
      const dynamic = [x, y, z, ...target].some((v) => typeof v === 'function');
      if (!dynamic) {
        engine.camera.position.set(x, y, z);
        engine.controls.target.set(...target);
        return;
      }
      engine.cameraProgrammed = true;
      engine.controls.enabled = false;
      engine.updaters.push((t) => {
        engine.camera.position.set(resolve(x, t), resolve(y, t), resolve(z, t));
        const tg = resolve3(target, t);
        engine.controls.target.set(...tg);
        engine.camera.lookAt(...tg);
      });
    },
    bg(color) { engine.scene.background = new THREE.Color(color); },
    fog(color = 0x0a0a0f, near = 5, far = 30) {
      engine.scene.fog = new THREE.Fog(color, near, far);
    },

    // TOPs — texture operators (see tops.js). Chains render only with .out()
    scene: () => new TopOp(engine, 'scene'),
    // input() = last frame's display output; input('name') = the buffer
    // published by .out('name'). ('in' is a JS reserved word, hence 'input';
    // feedback() is a legacy alias kept for older sketches.)
    input: (name) => new TopOp(engine, 'in', name != null ? { name: String(name) } : {}),
    feedback: (name) => new TopOp(engine, 'in', name != null ? { name: String(name) } : {}),
    ramp: (o) => new TopOp(engine, 'ramp', o ?? {}),
    circle: (o) => new TopOp(engine, 'circle', o ?? {}),
    noise: (o) => new TopOp(engine, 'noiseGen', o ?? {}),
    text: (text, o) => new TopOp(engine, 'textGen', { ...o, text }),
    // camera capture as a TOP; name matches a camera label (substring,
    // case-insensitive), no name = default camera. Permission prompt on
    // first use; the stream survives re-runs.
    video: (name) => new TopOp(engine, 'video', name != null ? { name: String(name) } : {}),

    // audio input as signals — fns of t with chainable processing, so they
    // drop into any parameter. First use starts capture (device from the
    // sidebar; system default until picked). See audio.js.
    audio(chan) {
      const ae = audioIn();
      return sig((t) => (chan == null ? ae.level : ae.levels[chan] ?? 0), ae);
    },
    // tempo-synced phase ramp: 0..1 over `div` beats (tempo set in the
    // sidebar). Shape it — beat(2).sin() is a two-beat LFO, beat(0.25).sqr()
    // gates on sixteenths, beat(4).counter().select([...]) walks a list per bar
    beat(div = 1) {
      return sig((t) => {
        const phase = (t * engine.bpm) / 60 / resolve(div, t);
        return phase - Math.floor(phase);
      });
    },
    // smooth random signal (deterministic value noise of t, 0..1) — the
    // signal-space cousin of the noise() TOP. freq in Hz-ish wiggles/sec;
    // different seeds give independent signals. Pairs with .hold():
    // rnd().hold(audio().kicks()) freezes a new random value on every kick.
    rnd(freq = 1, seed = 0) {
      return sig((t) => valueNoise(t * resolve(freq, t) + seed * 137.31));
    },
    // lift any fn of t into a chainable signal: sig(t => Math.sin(t)).smooth()
    sig: (fn) => sig((t) => resolve(fn, t)),
    // escape hatches
    THREE,
    onFrame(fn) { engine.updaters.push(fn); },
  };

  function audioIn() {
    return engine.ensureAudio();
  }

  return api;
}
