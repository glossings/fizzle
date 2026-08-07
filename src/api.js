import * as THREE from 'three';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TTFLoader } from 'three/addons/loaders/TTFLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import { applyNoise, applyNoiseDepth } from './noise.js';
import { displacedPoint, displacedNormal } from './noise-cpu.js';
import { applyMaps, applyMaterialScalars, applySurface, applyHdri, hasMaps, isPhysical, checkMaterialKeys } from './materials.js';
import { TextureOp, reciprocal, autoBuffer } from './textures.js';
import { makePointSet } from './sample.js';
import { setColor, makeColor, isDynamicColor } from './color.js';
import { warn } from './warn.js';
import { sig, valueNoise, setBpmSource } from './audio.js';
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
//    Google Fonts via the dev-server proxy, then from the metric-compatible
//    clone of that face (Arial → Arimo), so system names work off Chrome too
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

// The Local Font Access API is a bare global — there is no
// `navigator.queryLocalFonts`, so guarding on one skips this path everywhere.
async function localFontList() {
  if (typeof window.queryLocalFonts !== 'function') throw new Error('no local font access in this browser');
  try {
    return await window.queryLocalFonts();
  } catch (e) {
    // The permission prompt needs transient user activation and a sketch
    // restored on page load has none. Name the key that supplies one, the way
    // an empty videofile() does (main.js), instead of a bare SecurityError.
    if (e.name === 'SecurityError') {
      const err = new Error('press ctrl+enter to allow font access');
      err.needsGesture = true;
      throw err;
    }
    if (e.name === 'NotAllowedError') throw new Error('font access denied — re-allow it in the site settings');
    throw e;
  }
}

async function loadLocalFont(spec, weight) {
  const fonts = await localFontList();
  const name = spec.toLowerCase();
  const matches = fonts.filter(
    (f) => f.family.toLowerCase() === name || f.fullName.toLowerCase() === name || f.postscriptName.toLowerCase() === name
  );
  if (!matches.length) throw new Error(`not installed`);
  const style = new RegExp(weight === 'bold' ? 'bold' : 'regular|normal|book|roman', 'i');
  const pick = matches.find((f) => style.test(f.style)) ?? matches[0];
  const buf = await (await pick.blob()).arrayBuffer();
  // A .ttc packs several faces into one file — on macOS that's Helvetica,
  // Avenir, Courier, Helvetica Neue and Lucida Grande — and opentype.js stops
  // at the signature. Say which font, not "not installed".
  if (new TextDecoder().decode(buf.slice(0, 4)) === 'ttcf') {
    throw new Error(`"${pick.family}" is installed as a .ttc collection, which can't be read here`);
  }
  return fontLoader.parse(new TTFLoader().parse(buf));
}

// Google's metric-compatible clones: same advance widths and cap heights as
// the system faces they stand in for, so a sketch naming one still sets the
// same way in Firefox/Safari, on a static build, or when the installed file
// turns out to be a .ttc.
const METRIC_FALLBACK = {
  arial: 'Arimo',
  helvetica: 'Arimo',
  times: 'Tinos',
  'times new roman': 'Tinos',
  courier: 'Cousine',
  'courier new': 'Cousine',
  georgia: 'Gelasio',
  calibri: 'Carlito',
  cambria: 'Caladea',
};

async function loadGoogleFont(spec, weight) {
  // /api/gfont is served by the dev server (vite.config.js) and by a
  // serverless function on the hosted build; a bare static build has neither,
  // and answers with a page
  const buf = await fetchFontFile(
    `/api/gfont/${encodeURIComponent(spec)}?weight=${weight === 'bold' ? 700 : 400}`,
    'no Google Fonts proxy here — this build has no /api/gfont'
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
  // bare name: installed fonts first, then Google Fonts under that name, then
  // the metric-compatible clone of the system faces Google doesn't carry
  const stand = METRIC_FALLBACK[spec.toLowerCase()];
  const tries = [() => loadLocalFont(spec, weight), () => loadGoogleFont(spec, weight)];
  if (stand) tries.push(() => loadGoogleFont(stand, weight));
  const errs = [];
  for (const attempt of tries) {
    try {
      return await attempt();
    } catch (e) {
      errs.push(e);
    }
  }
  // a missing gesture is the only one of these the sketch can act on, so it
  // takes the status bar rather than trailing a paragraph of network failures
  const gesture = errs.find((e) => e.needsGesture);
  if (gesture) throw new Error(`font "${spec}": ${gesture.message}`);
  // the stand-in fails the same way its family name did, so say it once
  const remote = [...new Set(errs.slice(1).map((e) => e.message))].join('; ');
  throw new Error(`font "${spec}": ${errs[0].message}, and Google Fonts failed (${remote})`);
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
      warn(err.message);
    });
    fontCache.set(key, cached);
  }
  return { font: fallback, pending: cached };
}

// Chainable operator API:
//
//   sphere({ radius: 1 })
//     .position(0, t => Math.sin(t), 0)
//     .scale(1, 2, 1)
//     .rotation(0, t => t * 0.3, 0)
//     .noise({ amp: 0.4, freq: 2, octaves: 4, speed: 0.5 })
//     .instance(50, (x, i, n) => x.position(i - n / 2, 0, 0))
//     .material({ color: '#4fd1c5', roughness: 0.3 })
//     .out()
//
// Every numeric parameter also accepts a function of time, evaluated per
// frame, so animation falls out of the same syntax.

const resolve = (v, t) => (typeof v === 'function' ? v(t) : v);
const resolve3 = (v, t) => v.map((c) => resolve(c, t));

// .position/.rotation/.scale also take a whole vector in the first slot, so a sampled
// point goes straight in: x.position(pts.sample(i)). Arrays and anything carrying
// x/y/z (a Vector3, a sample()) both count; null = the caller passed components.
const asVec = (v) =>
  v === null || typeof v !== 'object' ? null
    : Array.isArray(v) ? [v[0], v[1], v[2]]
      : [v.x, v.y, v.z];

// extra carries things resolved outside the switch: `font` for text3d, and
// `geometry` for model() — the parsed .obj/.fbx, which arrives asynchronously
function buildGeometry(type, o = {}, extra = {}) {
  switch (type) {
    // an empty geometry renders nothing, which is exactly what a model that
    // hasn't finished parsing (or wasn't found) should do
    case 'model':
      return extra.geometry ? extra.geometry.clone() : new THREE.BufferGeometry();
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
    // a quarter of res on the caps and the middle keeps the vertex spacing
    // even all the way round, which is what .noise() wants to displace
    case 'capsule': {
      const r = o.res ?? 48;
      return new THREE.CapsuleGeometry(o.radius ?? 0.5, o.height ?? 1, Math.ceil(r / 4), r, Math.ceil(r / 4));
    }
    case 'icosa':
      return new THREE.IcosahedronGeometry(o.radius ?? 1, o.res ?? o.detail ?? 8);
    case 'text3d': {
      const bevel = o.bevel ?? 0.02;
      const g = new TextGeometry(String(resolve(o.text ?? 'text', 0)), {
        font: extra.font ?? (o.weight === 'bold' ? FONTS.bold : FONTS.regular),
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

// .align(v) turns a direction into a rotation, which .rotation()'s Euler angles
// can't do without a page of atan2 — the point of it is .align(pts.normal(i)),
// standing a copy up off the surface it was sampled from. +Y is the axis that
// gets aimed, being which way a cylinder/cone already points. Premultiplied, so
// .rotation() lands first in the shape's own frame: a Y-only rotation rolls the
// copy about the aimed axis and leaves the aim alone, X/Z lean it off by that
// much. Every frame re-sets .rotation before this runs, so nothing accumulates.
const UP = new THREE.Vector3(0, 1, 0);
const _aim = new THREE.Vector3();
const _quat = new THREE.Quaternion();
function aim(obj, dir, t) {
  const v = asVec(dir);
  if (!v) return;
  _aim.set(resolve(v[0], t) || 0, resolve(v[1], t) || 0, resolve(v[2], t) || 0);
  // a zero vector points nowhere; setFromUnitVectors would hand back garbage
  if (_aim.lengthSq() < 1e-12) return;
  obj.quaternion.premultiply(_quat.setFromUnitVectors(UP, _aim.normalize()));
}

// scratch for GeoOp._xform(), which composes a source's transform through the
// same Object3D the renderer would to keep the two from drifting apart
const IDENTITY = new THREE.Matrix4();
const _src = new THREE.Object3D();

// Two ops that describe the same shape share one set of sampled points. Sizes
// are resolved at t=0 (an animated radius scatters over the shape it starts
// as) and a parsed font stands in as an id, being megabytes of glyph outlines.
let fontSeq = 0;
const fontIds = new WeakMap();
const pointSetKey = (type, opts) =>
  `${type}:${JSON.stringify(opts, (k, v) => {
    if (typeof v === 'function') return v(0);
    if (k === 'font' && v !== null && typeof v === 'object') {
      if (!fontIds.has(v)) fontIds.set(v, ++fontSeq);
      return `font${fontIds.get(v)}`;
    }
    return v;
  })}`;

// The stand-in for one copy handed to .instance()'s fn: the chain's transform
// verbs, applied to a single instance. It's the same geometry, so the method
// names are the same — but an InstancedMesh is one mesh with one material, so
// only what lives in the per-instance matrix (plus instanceColor) can differ
// between copies. The rest belongs on the chain and says so rather than
// silently doing nothing. Reused across every instance and every frame, hence
// reset() and the flat fields: this fn runs count times per frame.
class InstanceHandle {
  constructor() { this.reset(); }

  reset() {
    this.px = this.py = this.pz = 0;
    this.rx = this.ry = this.rz = 0;
    this.sx = this.sy = this.sz = 1;
    this.col = null;
    this.dir = null;
  }

  position(x = 0, y = 0, z = 0) {
    const v = asVec(x);
    if (v) [x, y, z] = [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0];
    this.px = x; this.py = y; this.pz = z;
    return this;
  }
  rotation(x = 0, y = 0, z = 0) {
    const v = asVec(x);
    if (v) [x, y, z] = [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0];
    this.rx = x; this.ry = y; this.rz = z;
    return this;
  }
  scale(x = 1, y, z) {
    const v = asVec(x);
    if (v) [x, y, z] = [v[0] ?? 1, v[1] ?? 1, v[2] ?? 1];
    this.sx = x; this.sy = y ?? x; this.sz = z ?? x;
    return this;
  }
  align(v) { this.dir = v; return this; }
  // tints this copy: multiplied with the chain's .material() color
  color(c) { this.col = c; return this; }

  // The verbs a copy hasn't got say where the real one lives and carry on —
  // this fn runs every frame, so throwing here would take the video down for a
  // line that only ever needed moving.
  material(o = {}) {
    const extra = Object.keys(o).filter((k) => k !== 'color');
    if (extra.length) {
      // a misspelling is worth saying so, rather than explaining why the
      // property the sketch didn't actually name belongs on the chain
      const bad = checkMaterialKeys(o);
      warn(bad ?? `instance: ${extra.join('/')} is one material for the whole batch, not per-instance — put .material() on the chain (.color() is the exception, it varies per copy)`);
    }
    if (o.color !== undefined) this.col = o.color;
    return this;
  }

  noise() {
    warn('instance: .noise() is one shader for the whole batch — put it on the chain before .instance() (each copy already seeds the field from its own position)');
    return this;
  }
  shadow() {
    warn('instance: the batch is one mesh, so it casts and receives as one — put .shadow() on the chain');
    return this;
  }
  instance() {
    warn("instance: an instance can't be instanced — raise the count instead");
    return this;
  }
  out() {
    warn('instance: .out() ends the chain, not a copy — call it after .instance()');
    return this;
  }
}

class GeoOp {
  constructor(engine, type, opts) {
    // in scope for sketches as `Geometry` — see the same guard on TextureOp
    if (engine == null) {
      throw new Error('new Geometry() is not how a chain starts — begin from a shape like sphere(), box() or model()');
    }
    this.engine = engine;
    this.type = type;
    this.opts = opts ?? {};
    this._pos = [0, 0, 0];
    this._rot = [0, 0, 0];
    this._scale = [1, 1, 1];
    this._noise = null;
    this._instance = null;
    this._material = {};
    this._shadow = null;      // null = whatever the material implies (see out())
    this._align = null;       // a direction to aim +Y at, on top of _rot
    this._pointSet = null;    // sampled surface points, built on the first .sample()
    this._xformAt = null;     // clock reading _mat/_nmat were composed at
    this._mat = null;
    this._nmat = null;
    this._ncAt = null;        // ditto for the resolved noise config
    this._nc = null;
    this._sentOut = null;     // transform as of the last .out(), to catch a reused op
  }

  position(x = 0, y = 0, z = 0) {
    const v = asVec(x);
    this._pos = v ? [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0] : [x, y, z];
    return this;
  }
  rotation(x = 0, y = 0, z = 0) {
    const v = asVec(x);
    this._rot = v ? [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0] : [x, y, z];
    return this;
  }
  scale(x = 1, y, z) {
    const v = asVec(x);
    this._scale = v ? [v[0] ?? 1, v[1] ?? 1, v[2] ?? 1] : [x, y ?? x, z ?? x];
    return this;
  }
  align(v) { this._align = v; return this; }

  // sample(i) — the i-th point of a fixed scatter over this shape's surface,
  // and normal(i) the surface normal there. The shape needn't be in the scene:
  // an op that never reaches .out() is just a description of a geometry, so it
  // works as a layout source and renders nothing.
  //
  //   const pts = icosa({ radius: 3 });
  //   sphere({ radius: 0.08 })
  //     .instance(400, (x, i) => x.position(pts.sample(i)))
  //     .out();
  //
  // The source's whole chain applies: its .noise() moves the points onto the
  // deformed surface (noise-cpu.js re-runs the shader's field on the CPU), then
  // its .position/.rotation/.scale/.align place them. The shape is never drawn, so its
  // transform has no other job, and spinning a layout should carry the copies.
  //
  // Both are functions of t once the source has a .noise() or a fn transform,
  // so results can only be precomputed outside the layout fn while it's still.
  sample(i) {
    const set = this._points();
    const p = set ? set.point(i) : new THREE.Vector3();
    const c = set && this._noiseCfg();
    if (c) displacedPoint(p, set.normal(i), c, p);
    const m = this._xform();
    return m ? p.applyMatrix4(m) : p;
  }
  normal(i) {
    const set = this._points();
    const n = set ? set.normal(i) : new THREE.Vector3(0, 1, 0);
    const c = set && this._noiseCfg();
    if (c) displacedNormal(set.point(i), n, c, n);
    return this._xform() ? n.applyMatrix3(this._nmat).normalize() : n;
  }

  // The uniforms the mesh updater would set this frame, as plain numbers. Held
  // per frame like _xform, and for the same reason: one .instance() asks for
  // hundreds of points and they all read the same config.
  _noiseCfg() {
    if (!this._noise) return null;
    const t = this.engine.time;
    if (this._ncAt !== t) {
      this._ncAt = t;
      const n = this._noise;
      this._nc = {
        time: t,
        amp: resolve(n.amp, t),
        freq: resolve(n.freq, t),
        octaves: Math.min(8, Math.max(1, resolve(n.octaves, t))),
        lacunarity: resolve(n.lacunarity, t),
        gain: resolve(n.gain, t),
        speed: resolve(n.speed, t),
        seed: resolve(n.seed, t),
      };
    }
    return this._nc;
  }

  // Composed the same way the mesh updater does it, so a source that is also
  // drawn scatters onto itself. Held until the clock moves rather than rebuilt
  // per call, since one .instance() asks hundreds of times a frame; null for
  // the common untransformed source, to skip the multiply per point entirely.
  _xform() {
    const t = this.engine.time;
    if (this._xformAt !== t) {
      this._xformAt = t;
      _src.position.set(...resolve3(this._pos, t));
      _src.rotation.set(...resolve3(this._rot, t));
      if (this._align) aim(_src, this._align, t);
      _src.scale.set(...resolve3(this._scale, t));
      _src.updateMatrix();
      if (_src.matrix.equals(IDENTITY)) {
        this._mat = null;
      } else {
        this._mat = (this._mat ?? new THREE.Matrix4()).copy(_src.matrix);
        // normals drop the translation and need the inverse-transpose, or a
        // non-uniform .scale() tilts every one of them off its surface
        this._nmat = (this._nmat ?? new THREE.Matrix3()).getNormalMatrix(this._mat);
      }
    }
    return this._mat;
  }

  // Cached on the engine as well as on the op, because a source written inline
  // inside a layout fn — .instance(400, (x, i) => x.position(icosa().sample(i))) —
  // is a fresh op per copy per frame. Sharing by shape makes that merely
  // wasteful rather than fatal.
  _points() {
    if (this._pointSet) return this._pointSet;
    const opts = { ...this.opts };
    const extra = {};
    if (this.type === 'text3d') {
      if (!this._font) {
        const r = resolveFont(this.opts);
        this._font = r.font;
        // the real font swaps every glyph outline, so the points move with it
        r.pending?.then((f) => { this._font = f; this._pointSet = null; }).catch(() => {});
      }
      extra.font = opts.font = this._font;
    }
    if (this.type === 'model') {
      if (this.opts.name == null) return null;
      extra.geometry = this.engine.ensureModel(this.opts.name, this.opts).geometry;
      if (!extra.geometry) return null;   // still parsing — retried next frame
    }
    const key = pointSetKey(this.type, opts);
    let set = this.engine.pointSets.get(key);
    if (!set) {
      set = makePointSet(buildGeometry(this.type, opts, extra));
      if (!set) return null;
      this.engine.pointSets.set(key, set);
    }
    this._pointSet = set;
    return set;
  }

  // Every mesh casts and receives by default — it's free until some light is
  // given shadow: true, and "I enabled shadows and nothing happened" is a worse
  // default than a shadow you didn't want. .shadow(false) opts a mesh out of
  // both; { cast, receive } picks one, e.g. a glowing lamp box that lights the
  // room without blocking it, or a floor that only catches. Saying it either
  // way also overrides the see-through exception in out().
  shadow(v = true) {
    if (v !== null && typeof v === 'object') {
      this._shadow = { cast: v.cast ?? true, receive: v.receive ?? true };
    } else {
      this._shadow = { cast: !!v, receive: !!v };
    }
    return this;
  }

  // amp: displacement amount · freq: spatial frequency · octaves: fbm
  // harmonics (1–8) · lacunarity/gain: per-octave freq/amp multipliers ·
  // speed: how fast the field evolves over time
  noise(o = {}) {
    this._noise = {
      amp: o.amp ?? 0.3,
      // here a period is world units between peaks, not a fraction of the frame
      freq: o.period !== undefined ? reciprocal(o.period) : o.freq ?? 1.5,
      octaves: o.octaves ?? 3,
      lacunarity: o.lacunarity ?? 2,
      gain: o.gain ?? 0.5,
      speed: o.speed ?? 0.3,
      seed: o.seed ?? 0,
    };
    return this;
  }

  // instance(count, fn) — fn(x, i, count, t) transforms copy `i` through the
  // same verbs as the chain (x.position/.rotation/.scale/.color). It runs every
  // frame, so instances animate.
  instance(count, fn) {
    this._instance = { count, fn: fn ?? ((x, i) => x.position(i * 2, 0, 0)) };
    return this;
  }

  // A naked .material() means "I want a material and haven't got one yet":
  // it opens the Poly Haven browser and fills the pick back into this very
  // call, the same way an empty videofile() opens a picker. .material({})
  // is still an explicit no-op.
  material(o) {
    if (o === undefined) this.engine.requestBrowse('material', 'textures');
    else {
      // checked here rather than at .out() so the error lands on the line that
      // wrote the typo, and before a half-configured material is ever built
      const bad = checkMaterialKeys(o);
      if (bad) warn(bad);
      Object.assign(this._material, o);
    }
    return this;
  }
  color(c) { this._material.color = c; return this; }

  out(name) {
    // Each mesh re-reads this op every frame, so an op moved between two
    // .out() calls leaves both meshes on the last transform, stacked. Sending
    // one op to two layers is fine, though — only a moved one is a mistake.
    // position/rotation/scale always assign a fresh array, so identity is the test.
    if (this._sentOut && (this._pos !== this._sentOut.pos || this._rot !== this._sentOut.rot || this._scale !== this._sentOut.scale)) {
      warn('this shape is already in the scene — moving it after .out() moves every copy of it. Use .instance(n, fn) for copies, or a function that builds the shape fresh each time.');
    }
    this._sentOut = { pos: this._pos, rot: this._rot, scale: this._scale };

    let pendingFont = null;
    if (this.type === 'text3d') {
      const resolved = resolveFont(this.opts);
      this._font = resolved.font;
      pendingFont = resolved.pending;
    }
    // an imported .obj/.fbx: cached across re-runs, so this is usually
    // already parsed and `pending` resolves on the spot
    let pendingModel = null;
    if (this.type === 'model' && this.opts.name != null) {
      const m = this.engine.ensureModel(this.opts.name, this.opts);
      this._modelGeo = m.geometry;
      if (!m.geometry) pendingModel = m.pending;
    }
    const geometry = buildGeometry(this.type, this.opts, {
      font: this._font,
      geometry: this._modelGeo,
    });
    const m = this._material;
    const textured = hasMaps(m);
    // Glass, clearcoat, iridescence and friends live on the physical material,
    // which is the pricier shader — so the sketch opts in simply by naming one
    // of those properties, and everything else stays on standard.
    const Material = isPhysical(m) ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;
    const material = new Material({
      // A color map is tinted by material.color, so a textured chain that
      // didn't ask for a color starts white and shows the map as authored.
      // Transmission multiplies the light coming *through* the surface the same
      // way, so glass starts white too — the default tint would otherwise turn
      // every unpainted pane periwinkle. attenuationColor is how you tint it.
      color: makeColor(m.color ?? (textured || m.transmission != null ? '#ffffff' : '#8899ff')),
      // the roughness/metalness scalars multiply their maps, so they're reset
      // to 1 if and when one actually lands (see applyMaps)
      roughness: m.roughness ?? 0.5,
      metalness: m.metalness ?? 0.1,
      flatShading: m.flatShading ?? false,
      wireframe: m.wireframe ?? false,
      // imported models often have open shells or inconsistent winding, so
      // they get both sides by default like planes do; .material({ doubleSide })
      // overrides either way
      side: (m.doubleSide ?? (this.type === 'plane' || this.type === 'model'))
        ? THREE.DoubleSide
        : THREE.FrontSide,
    });
    if (m.emissive) {
      material.emissive = makeColor(m.emissive);
      material.emissiveIntensity = m.emissiveIntensity ?? 1;
    }
    applyMaterialScalars(material, m);
    const surfaceUpdate = applySurface(material, m);

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
    // The depth pass has no idea a surface is see-through, so glass and blended
    // shapes would throw the solid black shadow of their silhouette. They stay
    // out of it unless the sketch asks for them by name.
    const seeThrough =
      (m.transmission != null && resolve(m.transmission, 0) > 0) ||
      (m.opacity != null && resolve(m.opacity, 0) < 1);
    const sh = this._shadow ?? { cast: !seeThrough, receive: true };
    mesh.castShadow = sh.cast;
    mesh.receiveShadow = sh.receive;
    // A shadow pass renders its own depth material, which knows nothing about
    // the displacement patched into the one above — so it gets the same patch,
    // or the shape's shadow is the shadow of the sphere it started as.
    if (noiseUniforms && mesh.castShadow) {
      mesh.customDepthMaterial = new THREE.MeshDepthMaterial();
      applyNoiseDepth(mesh.customDepthMaterial, noiseUniforms);
      mesh.customDistanceMaterial = new THREE.MeshDistanceMaterial();
      applyNoiseDepth(mesh.customDistanceMaterial, noiseUniforms);
    }

    const dummy = new THREE.Object3D();
    const handle = inst ? new InstanceHandle() : null;
    const instColor = inst ? new THREE.Color() : null;
    // Replace a live mesh's geometry (async font/model, changed text3d
    // string). An InstancedMesh caches bounds of its own for frustum culling,
    // which have to be invalidated or the mesh stays culled at the old size —
    // and a geometry that started out empty would never be drawn at all. Only
    // an InstancedMesh, though: three picks that path by testing whether
    // `boundingSphere` is defined at all, so giving a plain Mesh a null one
    // sends it down a branch calling a method it doesn't have.
    const swapGeometry = (g) => {
      mesh.geometry.dispose();
      mesh.geometry = g;
      if (mesh.isInstancedMesh) {
        mesh.boundingSphere = null;
        mesh.boundingBox = null;
      }
    };
    // text3d with a fn for content rebuilds its geometry when the string
    // changes (e.g. a clock) — not every frame
    let lastText = this.type === 'text3d' ? String(resolve(this.opts.text ?? 'text', 0)) : null;
    const rebuildText = (s) => {
      swapGeometry(buildGeometry('text3d', { ...this.opts, text: s }, { font: this._font }));
    };
    // async font arrived: swap the geometry in place (unless the patch was
    // cleared in the meantime)
    pendingFont?.then((f) => {
      this._font = f;
      if (mesh.parent) rebuildText(lastText);
    }).catch(() => { /* already warned in resolveFont */ });
    // same deal for a model file: the mesh (instanced or not) starts empty and
    // picks up the real geometry once the file is parsed
    pendingModel?.then((g) => {
      if (!g || !mesh.parent) return;
      this._modelGeo = g;
      swapGeometry(g.clone());
    }).catch(() => { /* already warned in ensureModel */ });
    const updater = (t) => {
      // colors as fns of t (e.g. a .select() signal cycling a palette), or an
      // [r, g, b] with a fn in any channel
      if (isDynamicColor(m.color)) setColor(material.color, m.color, t);
      if (isDynamicColor(m.emissive)) setColor(material.emissive, m.emissive, t);
      // opacity + any physical property given as a fn of t
      surfaceUpdate?.(t);
      if (lastText !== null && typeof this.opts.text === 'function') {
        const s = String(this.opts.text(t));
        if (s !== lastText) {
          lastText = s;
          rebuildText(s);
        }
      }
      mesh.position.set(...resolve3(this._pos, t));
      mesh.rotation.set(...resolve3(this._rot, t));
      if (this._align) aim(mesh, this._align, t);
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
          handle.reset();
          const d = inst.fn(handle, i, inst.count, t);
          // the pre-handle signature was fn(i, n, t) returning { pos, rot,
          // scale }: under this one its `i` is the handle, so the math quietly
          // goes NaN. Name it instead of rendering nothing. (A concise arrow —
          // x => x.position(...) — hands the handle itself back, which is fine.)
          if (i === 0 && d && d !== handle && (d.pos || d.rot || d.scale)) {
            warn('instance: the layout fn is now (x, i, n, t) and transforms x directly — x.position(...).rotation(...).scale(...) instead of returning { pos, rot, scale }');
          }
          dummy.position.set(resolve(handle.px, t), resolve(handle.py, t), resolve(handle.pz, t));
          dummy.rotation.set(resolve(handle.rx, t), resolve(handle.ry, t), resolve(handle.rz, t));
          if (handle.dir) aim(dummy, handle.dir, t);
          dummy.scale.set(resolve(handle.sx, t), resolve(handle.sy, t), resolve(handle.sz, t));
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
          // setColorAt allocates instanceColor (all white) on first use, so
          // copies that never tint keep the material's own color, and three
          // rebuilds the program itself once the attribute shows up. Once the
          // buffer exists every copy writes every frame, or a tint set on one
          // frame would stick around after it stops being set.
          if (handle.col !== null) mesh.setColorAt(i, setColor(instColor, handle.col, t));
          else if (mesh.instanceColor) mesh.setColorAt(i, instColor.setRGB(1, 1, 1));
        }
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    };

    updater(0);
    // .out('name'): render into a named layer (pulled as a texture by
    // input('name')) instead of the visible scene
    if (name != null) mesh.layers.set(this.engine.geoLayer(String(name)));
    this.engine.add(mesh, updater);
    // after add(), so mesh.parent is already set: a cached map attaches on the
    // spot, and mesh.parent is also the liveness test for one that arrives
    // later — a patch cleared in the meantime has nowhere to put it
    if (textured) applyMaps(this.engine, material, m, () => !!mesh.parent);
    return this;
  }
}

// shadow: true on a light, or shadow: { ... } to tune it. Every option below
// is one three.js property; only the defaults are ours, sized for the 10–30
// unit scenes these sketches work at rather than three's own.
//   map        shadow map resolution in px (2048, 1024 for a point light —
//              that one is a cube, so it costs six renders)
//   soft       PCF sample spread in texels: 0 is hard-edged, ~8 is overcast
//   strength   0..1, how dark the shadow gets
//   bias       depth offset that kills self-shadowing acne (negative)
//   normalBias same, along the normal — the one that helps on flat floors
//   near/far   the light's own view range; anything outside casts nothing
//   area       directional only: half-width of the shadowed box around the
//              .position() → .target() axis. Too big blurs detail away, too small
//              clips the shadow off mid-floor.
function applyShadow(light, o) {
  if (!o) return;
  if (!light.shadow) {
    warn(`${light.type}: this light has no direction to cast from — shadows come from directional(), spot() or point()`);
    return;
  }
  const c = o === true ? {} : o;
  const s = light.shadow;
  light.castShadow = true;
  const map = c.map ?? (light.isPointLight ? 1024 : 2048);
  s.mapSize.set(map, map);
  s.radius = c.soft ?? 3;
  s.intensity = c.strength ?? 1;
  s.bias = c.bias ?? -0.0005;
  s.normalBias = c.normalBias ?? 0.02;
  s.camera.near = c.near ?? 0.5;
  // three's own far is 500, which spends most of the depth buffer on empty
  // space and stripes the floor with acne
  s.camera.far = c.far ?? (light.isPointLight ? 60 : 120);
  if (light.isDirectionalLight) {
    const a = c.area ?? 15;
    s.camera.left = -a;
    s.camera.right = a;
    s.camera.top = a;
    s.camera.bottom = -a;
  }
  // a spot light re-derives fov (and far, from distance) from the light itself
  s.camera.updateProjectionMatrix();
}

class LightOp {
  constructor(engine, light, opts = {}) {
    this.engine = engine;
    this.light = light;
    this.opts = opts;
    this._pos = [3, 4, 2];
    this._target = null;
  }
  position(x, y, z) {
    if (this.light.isAmbientLight) {
      warn('ambient: arrives evenly from every direction, so it has nowhere to be — hemi(), directional() or point() light from somewhere');
      return this;
    }
    const v = asVec(x);
    this._pos = v ? [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0] : [x, y, z];
    return this;
  }
  // Where a directional or spot light points; both aim at the origin without
  // it. Components take fns of t like .position, so the beam can sweep.
  target(x = 0, y = 0, z = 0) {
    if (!this.light.target) {
      warn(`${this.light.type}: shines every way at once — .target() is for directional() and spot()`);
      return this;
    }
    const v = asVec(x);
    this._target = v ? [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0] : [x, y, z];
    return this;
  }
  out(name) {
    // lights hit every layer by default (three culls lights by camera layer
    // mask); .out('name') restricts one to a single named geometry layer
    if (name != null) this.light.layers.set(this.engine.geoLayer(String(name)));
    else this.light.layers.enableAll();
    // ambient() adds itself, so calling .out() on one only re-layers it
    if (this._added) return this;
    this._added = true;
    // intensity and colour animate like everything else in the API. They have
    // to be driven from here: three folds intensity into the light's colour
    // uniform with multiplyScalar(), so a raw fn left on light.intensity gives
    // NaN — and a NaN light uniform blacks out every surface it touches rather
    // than merely failing to animate.
    const o = this.opts;
    applyShadow(this.light, o.shadow);
    // colors test differently: an [r, g, b] with a fn in one channel animates
    // too, while a plain array is as static as a hex
    const dyn = ['intensity', 'angle', 'penumbra', 'distance', 'decay']
      .filter((k) => typeof o[k] === 'function');
    const dynCol = ['color', 'sky', 'ground'].filter((k) => isDynamicColor(o[k]));
    // an ambient light has no position to write, so a static one needs no
    // updater at all
    const placed = !this.light.isAmbientLight;
    const updater = (t) => {
      if (placed) this.light.position.set(...resolve3(this._pos, t));
      if (this._target) {
        this.light.target.position.set(...resolve3(this._target, t));
        // the target isn't in the scene graph, so nothing else refreshes it —
        // and both the light's direction and its shadow camera read matrixWorld
        this.light.target.updateMatrixWorld();
      }
      for (const k of dyn) this.light[k] = o[k](t);
      for (const k of dynCol) {
        setColor(k === 'ground' ? this.light.groundColor : this.light.color, o[k], t);
      }
    };
    updater(0);
    this.engine.add(this.light, placed || dyn.length || dynCol.length ? updater : undefined);
    return this;
  }
}

// position/rotation are the names the docs teach; the short ones are what you
// actually type mid-set. .rotate stays for the geometry sketches written before
// the split — on a texture chain it's still the real method, over in textures.js.
for (const C of [GeoOp, InstanceHandle]) {
  C.prototype.pos = C.prototype.position;
  C.prototype.rot = C.prototype.rotate = C.prototype.rotation;
}
LightOp.prototype.pos = LightOp.prototype.position;

export function makeApi(engine) {
  setBpmSource(() => engine.bpm);
  const geo = (type) => (opts) => new GeoOp(engine, type, opts);

  const api = {
    sphere: geo('sphere'),
    box: geo('box'),
    plane: geo('plane'),
    torus: geo('torus'),
    torusKnot: geo('torusKnot'),
    cylinder: geo('cylinder'),
    capsule: geo('capsule'),
    icosa: geo('icosa'),
    text3d: (text, opts) => new GeoOp(engine, 'text3d', { ...opts, text }),

    // An imported .obj/.fbx as a geometry op — chain .position/.rotation/.scale/
    // .noise/.instance/.material/.out() exactly like sphere() or box().
    // Drag a model into the window to import it (the drop types the call), or
    // run an empty model() to browse Poly Haven's. name = filename, exact or
    // case-insensitive substring. Every mesh in the file is merged into one
    // geometry; its materials/textures are dropped in favour of .material().
    // Options: center (default true) and fit (default 2 — scale the longest
    // axis to this, so any file lands at a usable size; fit: 0 keeps the
    // file's own units). Parsing is async and cached across re-runs: the
    // mesh is empty for the first frames after a fresh import.
    model(name, opts = {}) {
      if (name !== null && typeof name === 'object') { opts = name; name = opts.name; }
      if (name == null) engine.requestBrowse('model', 'models');
      return new GeoOp(engine, 'model', { ...opts, name: name != null ? String(name) : null });
    },

    // Every light arg below may be a fn of t; they're resolved once here so the
    // constructor sees a number, and again per frame by LightOp's updater.
    // directional/spot/point also take shadow: true (see applyShadow), and
    // directional/spot aim with .target(x, y, z).
    //
    // ambient is the one with nowhere to be and nothing to aim at, so it adds
    // itself rather than waiting for an .out() that would have nothing to say;
    // .out('name') still works, to light a single layer. Positional
    // ambient(intensity, color) predates the config form.
    ambient(intensity = 0.3, color = 0xffffff) {
      if (typeof intensity === 'object' && intensity !== null) ({ intensity = 0.3, color = 0xffffff } = intensity);
      const light = new THREE.AmbientLight(makeColor(color), resolve(intensity, 0));
      return new LightOp(engine, light, { intensity, color }).out();
    },
    directional(o = {}) {
      return new LightOp(engine, new THREE.DirectionalLight(
        makeColor(o.color ?? 0xffffff), resolve(o.intensity ?? 1.5, 0)), o);
    },
    point(o = {}) {
      return new LightOp(engine, new THREE.PointLight(
        makeColor(o.color ?? 0xffffff), resolve(o.intensity ?? 20, 0),
        resolve(o.distance ?? 0, 0), resolve(o.decay ?? 2, 0)), o);
    },
    // a cone from .position() toward .target(): angle is its half-width in radians,
    // penumbra (0..1) how soft the rim is
    spot(o = {}) {
      return new LightOp(engine, new THREE.SpotLight(
        makeColor(o.color ?? 0xffffff), resolve(o.intensity ?? 60, 0),
        resolve(o.distance ?? 0, 0), resolve(o.angle ?? Math.PI / 6, 0),
        resolve(o.penumbra ?? 0.4, 0), resolve(o.decay ?? 2, 0)), o);
    },
    hemi(o = {}) {
      return new LightOp(engine, new THREE.HemisphereLight(
        makeColor(o.sky ?? 0x8899ff), makeColor(o.ground ?? 0x332211), resolve(o.intensity ?? 0.6, 0)), o);
    },

    // static args: place the camera, orbit controls stay live.
    // any function arg: the sketch drives the camera and orbiting is disabled
    // until the next re-run without a programmed camera.
    camera(x = 0, y = 2, z = 8, target = [0, 0, 0]) {
      const dynamic = [x, y, z, ...target].some((v) => typeof v === 'function');
      engine.cameraTouched = true;
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
    // Image-based lighting from an imported .hdr/.exr: the environment lights
    // every material in the scene (and is the only thing a metal surface has
    // to reflect, so metalness only really comes alive with one) and shows
    // behind it as the background. Run an empty hdri() to browse Poly Haven's
    // HDRIs (the pick fills itself into the call), or drag a file in.
    // Options: background (false keeps bg()/fog), intensity, blur (0..1, soft
    // sky without softening the lighting), rotation (radians, turns the light
    // rig and the sky together), backgroundRotation / backgroundIntensity to
    // move the sky alone. All but `background` accept fns of t.
    hdri(name, o = {}) {
      if (name !== null && typeof name === 'object') { o = name; name = o.name; }
      if (name == null) return engine.requestBrowse('hdri', 'hdris');
      const h = engine.ensureHdri(String(name));
      // the sketch's own intensity/rotation animate from the first frame even
      // while the file is still decoding; applyHdri hands back the per-frame
      // half so both paths share one updater
      let tick = null;
      const gen = engine.patchGen;
      const attach = (loaded) => {
        // a re-run since the load started owns the scene now — don't light it
        if (loaded && engine.patchGen === gen) tick = applyHdri(engine, loaded, o);
      };
      if (h.env) attach(h);
      else h.pending.then(attach);
      engine.updaters.push((t) => tick?.(t, resolve));
    },
    // The updater writes into the Color, not into scene.background — so an
    // hdri() that takes the background slot afterwards keeps it, and this
    // quietly animates a color nothing is showing.
    bg(color) {
      const c = makeColor(color);
      engine.scene.background = c;
      if (isDynamicColor(color)) engine.updaters.push((t) => setColor(c, color, t));
    },
    // Pins the render to an exact pixel size and shape. The main window shows
    // it letterboxed — scaled to fit, centered, black around it — while the
    // projector window (F1) takes the same aspect ratio, so full-screening
    // that one on a display of the same shape fills it edge to edge. Without
    // a call the render fills the browser window, as it always has.
    // resolution(1920, 1080), resolution({ width, height }), or one number for
    // a square. Sidebar quality still scales the pixels underneath.
    resolution(width, height) {
      if (width !== null && typeof width === 'object') ({ width, height } = width);
      const px = (n) => Math.max(1, Math.round(n));
      engine.resolution = width == null ? null : [px(width), px(height ?? width)];
    },
    // positional fog(color, near, far) predates the config form; a THREE.Color
    // in the first slot is still a color, not a config
    fog(color = 0x0a0a0f, near = 5, far = 30) {
      // an [r, g, b] is a color, not a config — same exception a THREE.Color
      // already got
      if (typeof color === 'object' && color !== null && !color.isColor && !Array.isArray(color)) {
        ({ color = 0x0a0a0f, near = 5, far = 30 } = color);
      }
      const fog = new THREE.Fog(makeColor(color), near, far);
      engine.scene.fog = fog;
      if (isDynamicColor(color)) engine.updaters.push((t) => setColor(fog.color, color, t));
    },

    // textures — texture operators (see textures.js). Chains render only with .out()
    scene: () => new TextureOp(engine, 'scene'),
    // the same render as scene(), as a grayscale distance map: black near,
    // white far. depth({ near, far }) sets the world-space range it spans
    // (defaulting to the sketch's fog, else 0..20); depth({ focus, range })
    // instead measures distance from a focal plane, which is a DOF blur mask.
    // Pairs with .mask(m, fn): scene().mask(depth(), s => s.blur(8)).
    depth: (o) => new TextureOp(engine, 'depth', o ?? {}),
    // input() = last frame's display output; input('name') = the buffer
    // published by .out('name'). ('in' is a JS reserved word, hence 'input'.)
    input: (name) => new TextureOp(engine, 'in', name != null ? { name: String(name) } : {}),
    // constant('#f0f') — a flat fill. The object form is tolerated so that
    // constant({ color }) behaves like every other generator's signature.
    constant: (color) => new TextureOp(engine, 'constant', color?.color !== undefined ? color : { color }),
    ramp: (o) => new TextureOp(engine, 'ramp', o ?? {}),
    circle: (o) => new TextureOp(engine, 'circle', o ?? {}),
    // the same shader as circle(), addressed by its two edges instead of by a
    // radius and a thickness in from it — inner/outer is how you think about an
    // annulus when the hole is the point
    ring(o = {}) {
      let outer = o.outer ?? 0.25;
      let inner = o.inner ?? 0.15;
      // the shader wants a width, which a texture in an edge can't be turned
      // into — that pairing is what circle({ radius, thickness }) is for
      if (outer instanceof TextureOp || inner instanceof TextureOp) {
        warn('ring: inner/outer take numbers or fns of t — for a map, drive circle({ radius, thickness }) instead');
        if (outer instanceof TextureOp) outer = 0.25;
        if (inner instanceof TextureOp) inner = 0.15;
      }
      const width = (t) => Math.max(0, resolve(outer, t) - resolve(inner, t));
      const { inner: _i, outer: _o, ...rest } = o;
      return new TextureOp(engine, 'circle', {
        ...rest,
        radius: outer,
        // a fn either side means the width moves, so it stays a fn of t
        thickness: typeof outer === 'function' || typeof inner === 'function' ? width : width(0),
      });
    },
    noise: (o) => new TextureOp(engine, 'noiseGen', o ?? {}),
    voronoi: (o) => new TextureOp(engine, 'voronoi', o ?? {}),
    text: (text, o) => new TextureOp(engine, 'textGen', { ...o, text }),
    // camera capture as a texture; name matches a camera label (substring,
    // case-insensitive), no name = default camera. Permission prompt on
    // first use; the stream survives re-runs.
    video: (name) => new TextureOp(engine, 'video', name != null ? { name: String(name) } : {}),

    // Imported media files: drag a file into the window to import it (the
    // drop also types the call for you), or run an empty call for a picker.
    // name = filename, exact or case-insensitive substring; files persist
    // in the browser across reloads and keep playing through re-runs.
    videofile(name, o = {}) {
      if (name !== null && typeof name === 'object') { o = name; name = o.name; }
      if (name == null) engine.requestMediaPick('videofile', 'video');
      return new TextureOp(engine, 'videofile', { ...o, name: name != null ? String(name) : null });
    },
    imagefile(name) {
      if (Array.isArray(name)) return api.imageseq(name);
      if (name == null) engine.requestMediaPick('imagefile', 'image');
      return new TextureOp(engine, 'imagefile', { name: name != null ? String(name) : null });
    },
    // several images with an index picking the current one — any fn of t or
    // signal (floored, wrapped): imageseq([...], beat(1).counter()) steps on
    // the beat, .hold(audio().kicks()).counter() on kicks. Default: 1/sec.
    imageseq(names, index) {
      if (names == null || !names.length) {
        engine.requestMediaPick('imageseq', 'image', true);
        names = [];
      }
      return new TextureOp(engine, 'imageseq', { names: names.map(String), index });
    },

    // audio input as signals — fns of t with chainable processing, so they
    // drop into any parameter. audio() = mono mix of the sidebar's device,
    // audio(2) = one channel by index, audio('scarlett') = a device by label
    // (case-insensitive substring), audio('scarlett', 2) = a channel of it.
    // First use starts capture. See audio.js / engine.ensureAudio.
    audio(chan, chan2) {
      let name;
      if (typeof chan === 'string') { name = chan; chan = chan2; }
      const ae = audioIn(name);
      return sig((t) => (chan == null ? ae.level : ae.levels[chan] ?? 0), ae);
    },
    // An imported audio file, played out loud and analysed like audio():
    // returns its level as a signal with the same chainable methods
    // (.kicks/.lowpass/...). Empty call = file picker. Options: volume,
    // speed, loop (default true), restart (fn of t, rising edge rewinds),
    // chan (analyse one channel). Numeric second arg = chan.
    audiofile(name, o = {}) {
      if (typeof o === 'number') o = { chan: o };
      if (name !== null && typeof name === 'object') { o = name; name = o.name; }
      if (name == null) {
        engine.requestMediaPick('audiofile', 'audio');
        return sig(() => 0);
      }
      const m = engine.ensureMedia('audio', String(name));
      let restartPrev = Infinity; // Infinity: a trigger already high at t0 doesn't fire
      engine.updaters.push((t) => {
        if (o.volume != null) m.ae.setVolume(resolve(o.volume, t));
        if (!m.el) return;
        if (o.speed != null) m.el.playbackRate = Math.max(0, resolve(o.speed, t));
        if (o.loop != null) m.el.loop = resolve(o.loop, t) >= 0.5;
        if (o.restart != null) {
          const v = resolve(o.restart, t);
          if (v >= 0.5 && restartPrev < 0.5) m.el.currentTime = 0;
          restartPrev = v;
        }
      });
      return sig((t) => (o.chan == null ? m.ae.level : m.ae.levels[o.chan] ?? 0), m.ae);
    },
    // rewind imported media files (all, or by name substring) — also on ctrl+r
    restartMedia: (name) => engine.restartMedia(name),
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
    // signal-space cousin of the noise() texture. freq in Hz-ish wiggles/sec;
    // different seeds give independent signals. Pairs with .beat()/.hold():
    // rand().beat(4) freezes a new random value each bar,
    // rand().hold(audio().kicks()) one on every kick.
    // rand({ freq, seed }) and positional rand(freq, seed) both work.
    rand(freq = 1, seed = 0) {
      if (typeof freq === 'object' && freq !== null) ({ freq = 1, seed = 0 } = freq);
      return sig((t) => valueNoise(t * resolve(freq, t) + seed * 137.31));
    },
    // Pointer position as a signal, -1..1 with 0 at the center — the range a
    // .position() wants, so mouse() drops straight into one. 'down' is a 1/0 gate
    // (feed it .smooth() for a ramp, .counter() to step on clicks). The
    // projector window reports its own pointer, so this follows the visuals.
    mouse(axis = 'x') {
      const key = String(axis).toLowerCase();
      if (!['x', 'y', 'down'].includes(key)) {
        warn(`mouse: no axis '${axis}' — x, y or down; using x`);
        return sig(() => engine.pointer.x);
      }
      return sig(() => engine.pointer[key]);
    },
    // lift any fn of t into a chainable signal: sig(t => Math.sin(t)).smooth().
    // Bare sig() is t itself — the seconds-based phase source, so
    // sig().sin().range(0, 10) is a 1 Hz oscillation over 0..10.
    sig: (fn = (t) => t) => sig((t) => resolve(fn, t)),
    // sig() already spelled out — T.mul(0.3).sin() rather than sig().mul(0.3).sin().
    // Stateless (it only reads t), so one shared instance is safe: everything
    // chained off it is built fresh by the sketch that chains it.
    T: sig((t) => t),
    // escape hatches
    THREE,
    onFrame(fn) { engine.updaters.push(fn); },

    // The chain types themselves, so a sketch can extend them:
    // `Texture.prototype.trail = function (amt) { ... }` and every texture
    // chain has .trail(). The class rather than its prototype, so that
    // `x instanceof Texture` works — the check a helper taking either a texture
    // or a number needs, and the reason the longer spelling is worth its
    // characters. Methods live until the tab is closed rather than until the
    // next run: a helper you defined and then deleted from the sketch is still
    // there, which is the point when the helper is the part you aren't editing.
    Texture: TextureOp,
    Geometry: GeoOp,

    // A bus name nothing else will take, one per call site — what a helper
    // closing a feedback loop by hand needs, since a literal name would collide
    // with the second call. It hands back the id, not the buffer: the buffer is
    // whatever .out(id) publishes to it. .feedback() is this plus the wiring.
    bufferId: () => autoBuffer(engine),
  };

  function audioIn(name) {
    return engine.ensureAudio(name);
  }

  return api;
}
