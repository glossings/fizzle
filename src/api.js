import * as THREE from 'three';
import { Font, FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TTFLoader } from 'three/addons/loaders/TTFLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { applyDisplacement, applyDisplacementDepth, addUvBasis } from './noise.js';
import { displacedPoint, displacedNormal } from './noise-cpu.js';
import { applyMaps, applyMaterialScalars, applySurface, applyHdri, hasMaps, isPhysical, checkMaterialKeys, expandMaterial, tileSources, applyTileMap, applyPointSize } from './materials.js';
import { TextureOp, glslNode, reciprocal, autoBuffer, setRate } from './textures.js';
import { claimFluidState } from './fluid.js';
import { ParticleOp } from './particles.js';
import { lineGeometry } from './lines.js';
import { makePointSet } from './sample.js';
import { makeLayout, Layout } from './layout.js';
import { Data, ChannelData, ScatterData, SegmentsOp, asData } from './link.js';
import { Curve, makeCurve, curveCircle, curveLine, curveHelix, spread } from './curve.js';
import { setColor, makeColor, isDynamicColor, hsl, hsv } from './color.js';
import { cameraPad } from './camera-pad.js';
import { warn } from './warn.js';
import { rewriteBlocks } from './sketch-blocks.js';
import { SAVED_BLOCK } from './engine.js';
import { site, tag } from './profile.js';
import { sig, Signal, valueNoise, barPhase, setBpmSource } from './audio.js';
import { bandValue } from './bands.js';
import { midiHandle, gamepadHandle } from './control.js';
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

// a bare curve where a position belongs: it wants a phase
const unphased = (c) => {
  warn('position: a curve wants a phase — .position(c(T.mul(0.2))) rides it; assuming one lap per second');
  return c((t) => t);
};

// three's layout takes no spacing options: it advances by each glyph's `ha` and
// drops a line by the font's bounding box. Both are font data, so tracking and
// leading go in as a derived font and everything downstream lays out as usual.
// Both are in ems, which is what makes the derived font independent of size.
const spacedFonts = new WeakMap();
function spacedFont(font, tracking, leading) {
  const d = font?.data;
  if (!d || (!tracking && leading == null)) return font;
  let byKey = spacedFonts.get(font);
  if (!byKey) spacedFonts.set(font, (byKey = new Map()));
  const key = `${tracking}|${leading}`;
  let spaced = byKey.get(key);
  if (!spaced) {
    const glyphs = {};
    for (const [c, gl] of Object.entries(d.glyphs)) glyphs[c] = { ...gl, ha: gl.ha + tracking * d.resolution };
    const boundingBox = leading == null ? d.boundingBox
      : { ...d.boundingBox, yMax: d.boundingBox.yMin + leading * d.resolution - d.underlineThickness };
    byKey.set(key, (spaced = new Font({ ...d, glyphs, boundingBox })));
  }
  return spaced;
}

// three starts every line at x = 0, so a multiline TextGeometry is always
// ragged right. Anything but 'left' gets laid out a line at a time and shifted
// to the alignment edge of the widest one. Same line spacing three uses, so
// the two paths stack identically.
function textLines(str, opts, align) {
  const lines = str.split('\n');
  if (align === 'left' || lines.length < 2) return new TextGeometry(str, opts);

  // an empty line still pushes the next one down; there's just nothing to shift
  const parts = lines.map((line) => {
    if (!line) return null;
    const g = new TextGeometry(line, opts);
    g.computeBoundingBox();
    return g;
  });
  // the bevel pads every line's box by the same amount, so widths still differ
  // by exactly what the glyphs differ by
  const widths = parts.map((g) => (g ? g.boundingBox.max.x - g.boundingBox.min.x : 0));
  const block = Math.max(...widths);

  const d = opts.font?.data;
  const lineH = d
    ? (d.boundingBox.yMax - d.boundingBox.yMin + d.underlineThickness) * (opts.size / d.resolution)
    : opts.size * 1.2;

  const kept = [];
  parts.forEach((g, i) => {
    if (!g) return;
    g.translate(align === 'right' ? block - widths[i] : (block - widths[i]) / 2, -i * lineH, 0);
    kept.push(g);
  });
  // every line was blank — let three build the same nothing it would have
  return kept.length ? mergeGeometries(kept) : new TextGeometry(str, opts);
}

// extra carries things resolved outside the switch: `font` for text3d, and
// `geometry` for model() — the parsed .obj/.fbx, which arrives asynchronously
function buildGeometry(type, o = {}, extra = {}) {
  // A shape is built once, so a signal in a size param can't animate it —
  // and passed through raw it would NaN every vertex. Take its current value
  // and point at .scale(), which is the moving version. `text` stays: it has
  // its own per-frame rebuild and resolves below.
  for (const [k, v] of Object.entries(o)) {
    if (typeof v !== 'function' || k === 'text') continue;
    const val = v(0);
    o = { ...o, [k]: typeof val === 'number' && !Number.isFinite(val) ? 0 : val };
    warn(`${type}: ${k} is fixed when the shape is built — using the signal's current value; animate size with .scale()`);
  }
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
    // res: [across, down] — scanlines want many columns and few rows
    case 'plane': {
      const [rx, ry] = Array.isArray(o.res) ? o.res : [o.res ?? 128, o.res ?? 128];
      return new THREE.PlaneGeometry(o.width ?? 10, o.height ?? 10, rx, ry);
    }
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
      const g = textLines(String(resolve(o.text ?? 'text', 0)), {
        font: spacedFont(extra.font ?? (o.weight === 'bold' ? FONTS.bold : FONTS.regular), o.tracking ?? 0, o.leading),
        size: o.size ?? 1,
        depth: o.depth ?? 0.25,
        curveSegments: o.res ?? 8,
        bevelEnabled: bevel > 0,
        bevelThickness: bevel,
        bevelSize: bevel * 0.6,
        bevelSegments: 3,
      }, o.align ?? 'left');
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
    this.tileIdx = null;
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
  // between(a, b) — span this copy from a to b: midpoint, aimed along the
  // gap, y scaled to its length. A unit-height shape (cylinder({ height: 1 }))
  // spans exactly; .scale() before it still sets the thickness.
  between(a, b) {
    const va = asVec(a), vb = asVec(b);
    if (!va || !vb) {
      warn('instance: .between(a, b) takes two points — [x, y, z] arrays or Vector3s');
      return this;
    }
    const dx = (vb[0] ?? 0) - (va[0] ?? 0), dy = (vb[1] ?? 0) - (va[1] ?? 0), dz = (vb[2] ?? 0) - (va[2] ?? 0);
    this.px = (va[0] ?? 0) + dx / 2;
    this.py = (va[1] ?? 0) + dy / 2;
    this.pz = (va[2] ?? 0) + dz / 2;
    this.dir = [dx, dy, dz];
    this.sy = Math.sqrt(dx * dx + dy * dy + dz * dz);
    return this;
  }
  // tints this copy: multiplied with the chain's .material() color
  color(c) { this.col = c; return this; }
  // which picture this copy wears, out of the set in .material({ map: [...] }).
  // Counts round like select() does, so .tile(i) over a long grid cycles.
  tile(n) {
    if (!this._tiles) {
      warn('instance: .tile() picks out of a set of maps — .material({ map: [a, b, ...] }) on the chain is what it picks from');
    }
    this.tileIdx = n;
    return this;
  }

  // The verbs a copy hasn't got say where the real one lives and carry on —
  // this fn runs every frame, so throwing here would take the video down for a
  // line that only ever needed moving.
  material(o = {}) {
    if (typeof o === 'string') {
      warn(`instance: a preset is one material for the whole batch — .material('${o}') goes on the chain`);
      return this;
    }
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
  displace() {
    warn('instance: .displace() is one map for the whole batch — put it on the chain before .instance() (every copy reads the map at its own uv, so they deform alike)');
    return this;
  }
  shadow() {
    warn('instance: the batch is one mesh, so it casts and receives as one — put .shadow() on the chain');
    return this;
  }
  alpha() {
    warn('instance: the batch is one material, so it fades as one — put .material({ opacity }) on the chain. (A copy of a texture chain fades on its own: .instance() there takes .alpha().)');
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

// .render(): the object alone on a layer of its own, handed back as a texture
// chain — .out('name') and input('name') without the name
function renderAsTexture() {
  const name = this.engine.anonLayer();
  this.out(name);
  return new TextureOp(this.engine, 'in', { name });
}

class GeoOp {
  constructor(engine, type, opts) {
    // in scope for sketches as `Geometry` — see the same guard on TextureOp
    if (engine == null) {
      throw new Error('new Geometry() is not how a chain starts — begin from a shape like sphere(), box() or model()');
    }
    this.engine = engine;
    this.type = type;
    this._site = site(type);
    this.opts = opts ?? {};
    this._pos = [0, 0, 0];
    this._rot = [0, 0, 0];
    this._scale = [1, 1, 1];
    this._noise = null;
    this._displaces = [];   // every .displace() in the chain, summed in one patch
    this._instance = null;
    this._material = {};
    this._draw = null;        // null = triangles; { mode: 'points' | 'lines', ... } draws the vertices or their grid instead
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
    if (x instanceof Curve) x = unphased(x);
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
    if (this._displaces.length) this._warnDisplacedSource();
    const m = this._xform();
    return m ? p.applyMatrix4(m) : p;
  }
  normal(i) {
    const set = this._points();
    const n = set ? set.normal(i) : new THREE.Vector3(0, 1, 0);
    const c = set && this._noiseCfg();
    if (c) displacedNormal(set.point(i), n, c, n);
    if (this._displaces.length) this._warnDisplacedSource();
    return this._xform() ? n.applyMatrix3(this._nmat).normalize() : n;
  }

  // scatter(n) — the first n scatter points as a data set: .pos is .sample(i)
  // said all at once, .normal rides along, .pairs()/.link() connect it. Like
  // a layout source, the shape needn't be in the scene.
  scatter(n = 200) {
    return new ScatterData(this.engine, this, n);
  }

  // link({ count, within, max, fill, fade, color, opacity, blend }) —
  // segments between every pair of scatter points closer than within; fill
  // shades the triangles they close. With .noise() on the chain the points
  // move and the connections follow: the plexus look. Ends in its own
  // .out(): icosa().noise().link({ within: 1 }).out()
  link(o = {}) {
    return this.scatter(o.count ?? 200).link(o);
  }

  // The shape as a particle emitter: births scattered over the surface (the
  // same fixed points .sample() reads), leaving along the normals unless dir
  // says otherwise. Like a layout source, the shape needn't be in the scene —
  // and its transform still applies live, so a spinning source spins its
  // births. See particles.js.
  particles(opts) {
    return new ParticleOp(this.engine, opts, this);
  }

  // .noise() has a CPU twin, so sampled points follow it. .displace() can't:
  // its map lives in a render target, and reading one back per point would cost
  // a pipeline stall per copy per frame. The points stay on the undisplaced
  // surface — usable, but say so, since a layout silently ignoring half the
  // chain is indistinguishable from the map being wrong. (warn() is once per
  // patch, so a layout fn calling this 400 times a frame says it once.)
  _warnDisplacedSource() {
    warn('.sample()/.normal() see the shape before .displace() — the map is only read on the GPU, so the points sit on the undisplaced surface. .noise() is the deformer a layout can follow.');
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

  // displace(map, { amount, mid, smooth }) — move each vertex along its normal
  // by what the map says at its uv, with the normals rebuilt from the map's
  // gradient so the relief takes light as relief. The map is an imported image
  // by name, a live texture chain, or a THREE.Texture, and displaces by its
  // brightness.
  //
  // Like .noise(), it can only move vertices the shape already has: res is
  // where the detail comes from, not the map's resolution.
  //
  // Chainable — several calls stack, so a wide map can carry the form and a
  // fine one roughen it. They're summed in one shader (see noise.js), and
  // .noise() joins the same sum.
  displace(map, o = {}) {
    if (map == null) {
      warn('.displace() needs a map — an imported image by name, or a texture chain: .displace(noise({ period: 0.3 }))');
      return this;
    }
    // a bare amount in the options slot, matching the texture .displace()
    if (typeof o !== 'object' || o === null) o = o == null ? {} : { amount: o };
    this._displaces.push({
      map,
      amount: o.amount ?? 0.2,
      mid: o.mid ?? 0.5,
      // how wide each vertex reads the map, in vertex spacings. 1 is the pin:
      // it averages exactly its own share of the picture and nothing finer,
      // which is what makes an impression rather than grit. 0 reads a single
      // point and the detail the mesh can't hold comes back as noise — a look,
      // so it's a number and not a flag. Wider keeps softening: the map is
      // read through its mip pyramid, so the average is real at any width.
      smooth: o.smooth ?? 1,
    });
    return this;
  }

  // instance(count, fn) — fn(x, i, count, t) transforms copy `i` through the
  // same verbs as the chain (x.position/.rotation/.scale/.color). It runs every
  // frame, so instances animate.
  //
  // instance(layout) instead takes the copies from a layout() (or one of its
  // .filter() views), which brings its own count; a fn alongside it runs after the
  // structure has placed the copy, for the tint or wobble on top of it.
  instance(count, fn) {
    if (count instanceof Layout) {
      const l = count;
      if (!l.count) warn('instance: the layout placed no copies — a rule builds them with e.place()');
      this._instance = {
        count: l.count,
        fn: fn
          ? (x, i, n, t) => fn(l.apply(x, i, t), i, n, t)
          : (x, i, n, t) => l.apply(x, i, t),
      };
      return this;
    }
    this._instance = { count, fn: fn ?? ((x, i) => x.position(i * 2, 0, 0)) };
    return this;
  }

  // points({ size }) — draw the vertices as dots instead of the surface, size
  // in pixels. Every deformer still applies, and a color map colors each dot
  // by the pixel under it, so plane({ res: 300 }).material({ map: person() })
  // .displace(person()).points() is the camera as a relief of dots.
  points(o = {}) {
    if (typeof o !== 'object' || o === null) o = { size: o };
    this._draw = { mode: 'points', size: o.size ?? 1 };
    return this;
  }

  // lines({ dir }) — draw the rows ('x'), columns ('y') or both ('xy') of the
  // vertex grid as 1px lines. A shape with no grid (model, text3d, icosa)
  // draws its triangle edges, which is what .wire() asks for outright.
  lines(o = {}) {
    if (typeof o !== 'object' || o === null) o = { dir: o };
    const dir = o.dir ?? 'x';
    if (!['x', 'y', 'xy', 'edges'].includes(dir)) {
      warn(`.lines(): dir is 'x', 'y' or 'xy' — got ${JSON.stringify(dir)}, drawing 'x'`);
      this._draw = { mode: 'lines', dir: 'x' };
    } else this._draw = { mode: 'lines', dir };
    return this;
  }
  wire() { return this.lines({ dir: 'edges' }); }

  // A naked .material() means "I want a material and haven't got one yet":
  // it opens the Poly Haven browser and fills the pick back into this very
  // call, the same way an empty videofile() opens a picker. .material({})
  // is still an explicit no-op.
  material(o, overrides) {
    if (o === undefined) this.engine.requestBrowse('material', 'textures');
    else {
      // .material('glass') and .material({ preset: 'glass' }) expand to the
      // preset's keys with the caller's on top, so from here down a preset is
      // indistinguishable from having typed the keys
      const { spec, warn: unknown } = expandMaterial(o, overrides);
      if (unknown) warn(unknown);
      // checked here rather than at .out() so the error lands on the line that
      // wrote the typo, and before a half-configured material is ever built
      const bad = checkMaterialKeys(spec);
      if (bad) warn(bad);
      Object.assign(this._material, spec);
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
    // .displace() reads a height field over uv, so it needs the surface basis
    // written onto the geometry — and a geometry swapped in later (an async
    // font or model) needs it too, hence a step rather than a call site. An
    // empty one is the model that hasn't parsed yet, not a failure; it comes
    // back through here when the real thing lands.
    let dispOk = true;
    const prepare = (g) => {
      if (!this._displaces.length || !g.attributes.position) return g;
      dispOk = addUvBasis(g);
      if (!dispOk) {
        warn('.displace(): this geometry has no uv coordinates, so there is nowhere on the map to read — displacement skipped (an imported model may have been exported without them)');
      }
      return g;
    };
    const geometry = prepare(buildGeometry(this.type, this.opts, {
      font: this._font,
      geometry: this._modelGeo,
    }));
    const m = this._material;
    const textured = hasMaps(m);
    const draw = this._draw;
    const asPoints = draw?.mode === 'points';
    const asLines = draw?.mode === 'lines';
    // dots and lines: lit like the surface, but nothing to cast a shadow with
    const flat = asPoints || asLines;
    if (flat && this._instance) {
      warn(`.${asPoints ? 'points' : 'lines'}() draws one shape — .instance() is skipped. Raise res for more detail.`);
      this._instance = null;
    }
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
      roughness: resolve(m.roughness ?? 0.5, 0),
      metalness: resolve(m.metalness ?? 0.1, 0),
      // flat shading takes the normal from screen derivatives, which a dot or
      // a line has none of — so those keep the vertex normal
      flatShading: flat ? false : (m.flatShading ?? false),
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
      material.emissiveIntensity = resolve(m.emissiveIntensity ?? 1, 0);
    }
    applyMaterialScalars(material, m);
    const surfaceUpdate = applySurface(material, m);

    // .material({ map: [a, b, c] }): one array texture the copies pick out of.
    // Nothing to pick with on a single mesh, so there it's the first picture and
    // a word about how to get the rest.
    let tiles = tileSources(m);
    if (tiles && !this._instance) {
      warn('material: a set of maps is picked from per copy, by .instance(n, (x, i) => x.tile(i)) — on one mesh it takes select(i, a, b) to choose a picture, so the first of the set is used here');
      m.map = tiles[0];
      tiles = null;
    }
    const tileUniforms = tiles ? applyTileMap(material, m) : null;

    // One vertex patch carries every deformer, since they replace the same two
    // shader chunks — a chain with .noise().displace(a).displace(b) gets the sum.
    const dispFlags = { noise: !!this._noise, displace: this._displaces.length };
    let dispUniforms = null;
    if (dispFlags.noise || dispFlags.displace) {
      dispUniforms = {};
      if (dispFlags.noise) {
        Object.assign(dispUniforms, {
          uTime: { value: 0 },
          uAmp: { value: 0 },
          uFreq: { value: 0 },
          uOctaves: { value: 0 },
          uLacunarity: { value: 0 },
          uGain: { value: 0 },
          uSpeed: { value: 0 },
          uSeed: { value: 0 },
        });
      }
      this._displaces.forEach((d, i) => {
        // null reads as three's empty texture until the map lands, which
        // displaces by -mid * amount — hence amount 0 until then, so an async
        // image doesn't shrink the shape for its first frames
        Object.assign(dispUniforms, {
          [`uDispMap${i}`]: { value: null },
          [`uDispAmount${i}`]: { value: 0 },
          [`uDispMid${i}`]: { value: resolve(d.mid, 0) },
          [`uDispWidth${i}`]: { value: resolve(d.smooth, 0) },
        });
      });
      applyDisplacement(material, dispFlags, dispUniforms);
    }
    // pixels, like PointsMaterial without attenuation: size times the ratio
    const pointSize = asPoints ? { value: resolve(draw.size, 0) * this.engine.renderer.getPixelRatio() } : null;
    if (pointSize) applyPointSize(material, pointSize);

    let mesh;
    const inst = this._instance;
    if (inst) {
      mesh = new THREE.InstancedMesh(geometry, material, inst.count);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    } else if (asPoints) {
      mesh = new THREE.Points(geometry, material);
    } else if (asLines) {
      mesh = new THREE.LineSegments(lineGeometry(geometry, draw.dir), material);
    } else {
      mesh = new THREE.Mesh(geometry, material);
    }
    // The depth pass has no idea a surface is see-through, so glass and blended
    // shapes would throw the solid black shadow of their silhouette. They stay
    // out of it unless the sketch asks for them by name.
    const seeThrough =
      (m.transmission != null && resolve(m.transmission, 0) > 0) ||
      (m.opacity != null && resolve(m.opacity, 0) < 1);
    // dots and lines receive but never cast: a pixel throws no usable shadow
    const sh = this._shadow ?? { cast: !seeThrough && !flat, receive: true };
    if (flat) sh.cast = false;
    mesh.castShadow = sh.cast;
    mesh.receiveShadow = sh.receive;
    // A shadow pass renders its own depth material, which knows nothing about
    // the displacement patched into the one above — so it gets the same patch,
    // or the shape's shadow is the shadow of the sphere it started as.
    if (dispUniforms && mesh.castShadow) {
      mesh.customDepthMaterial = new THREE.MeshDepthMaterial();
      applyDisplacementDepth(mesh.customDepthMaterial, dispFlags, dispUniforms);
      mesh.customDistanceMaterial = new THREE.MeshDistanceMaterial();
      applyDisplacementDepth(mesh.customDistanceMaterial, dispFlags, dispUniforms);
    }

    const dummy = new THREE.Object3D();
    const handle = inst ? new InstanceHandle() : null;
    const instColor = inst ? new THREE.Color() : null;
    // the layer of the map set each copy reads, written per frame like the
    // matrix. It rides on the geometry, so a swapped-in one takes it along.
    const tileAttr = tiles ? new THREE.InstancedBufferAttribute(new Float32Array(inst.count), 1) : null;
    const attachTile = (g) => {
      if (tileAttr) g.setAttribute('tdTile', tileAttr);
      return g;
    };
    if (handle) handle._tiles = !!tiles;
    if (tileAttr) {
      tileAttr.setUsage(THREE.DynamicDrawUsage);
      attachTile(geometry);
    }
    // Replace a live mesh's geometry (async font/model, changed text3d
    // string). An InstancedMesh caches bounds of its own for frustum culling,
    // which have to be invalidated or the mesh stays culled at the old size —
    // and a geometry that started out empty would never be drawn at all. Only
    // an InstancedMesh, though: three picks that path by testing whether
    // `boundingSphere` is defined at all, so giving a plain Mesh a null one
    // sends it down a branch calling a method it doesn't have.
    const swapGeometry = (g) => {
      mesh.geometry.dispose();
      g = attachTile(prepare(g));
      mesh.geometry = asLines ? lineGeometry(g, draw.dir) : g;
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
      // the standard-material scalars are constructor keys, so a fn in one is
      // re-read here; applySurface covers opacity and the physical ones
      if (typeof m.roughness === 'function') material.roughness = m.roughness(t);
      if (typeof m.metalness === 'function') material.metalness = m.metalness(t);
      if (typeof m.emissiveIntensity === 'function') material.emissiveIntensity = m.emissiveIntensity(t);
      surfaceUpdate?.(t);
      if (pointSize) pointSize.value = resolve(draw.size, t) * this.engine.renderer.getPixelRatio();
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

      if (dispFlags.noise) {
        const n = this._noise;
        dispUniforms.uTime.value = t;
        dispUniforms.uAmp.value = resolve(n.amp, t);
        dispUniforms.uFreq.value = resolve(n.freq, t);
        dispUniforms.uOctaves.value = Math.min(8, Math.max(1, resolve(n.octaves, t)));
        dispUniforms.uLacunarity.value = resolve(n.lacunarity, t);
        dispUniforms.uGain.value = resolve(n.gain, t);
        dispUniforms.uSpeed.value = resolve(n.speed, t);
        dispUniforms.uSeed.value = resolve(n.seed, t);
      }
      for (let i = 0; i < dispFlags.displace; i++) {
        const d = this._displaces[i];
        // no map yet, or no uvs to read it at: amount 0 leaves the shape alone
        const live = dispOk && dispUniforms[`uDispMap${i}`].value;
        dispUniforms[`uDispAmount${i}`].value = live ? resolve(d.amount, t) : 0;
        dispUniforms[`uDispMid${i}`].value = resolve(d.mid, t);
        // negatives would flip the gradient and light the relief inside out
        dispUniforms[`uDispWidth${i}`].value = Math.max(0, resolve(d.smooth, t));
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
          // counts round rather than clamp, so .tile(i) over more copies than
          // there are pictures repeats the set; a NaN would sample nothing at
          // all, so it holds on the first
          if (tileAttr) {
            const raw = Math.floor(resolve(handle.tileIdx ?? 0, t));
            tileAttr.array[i] = Number.isFinite(raw) ? ((raw % tiles.length) + tiles.length) % tiles.length : 0;
          }
        }
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        if (tileAttr) tileAttr.needsUpdate = true;
      }
    };

    updater(0);
    // .out('name'): render into a named layer (pulled as a texture by
    // input('name')) instead of the display stack
    mesh.layers.set(name != null ? this.engine.geoLayer(String(name)) : this.engine.stackGeo());
    this.engine.add(mesh, updater, this._site);
    // after add(), so mesh.parent is already set: a cached map attaches on the
    // spot, and mesh.parent is also the liveness test for one that arrives
    // later — a patch cleared in the meantime has nowhere to put it
    if (textured) applyMaps(this.engine, material, m, () => !!mesh.parent, tileUniforms);
    this._displaces.forEach((d, i) => this._bindDisplaceMap(d.map, dispUniforms[`uDispMap${i}`], () => !!mesh.parent));
    return this;
  }

  // A height map into its uniform. Unlike a material map slot the chain isn't
  // wrapped in a pass of its own — nothing here writes to the texture, it's only
  // read in the vertex shader, so forwarding another node's target is harmless.
  _bindDisplaceMap(spec, uniform, isAlive) {
    if (spec instanceof TextureOp) {
      // read through textureLod at a footprint-matched level, so the node's
      // targets need a mip pyramid — marked before it allocates them (see _rt)
      spec._needsMips = true;
      this.engine.textureMaps.push({ node: spec, uniform, isAlive, tex: null, needsMips: true });
      return;
    }
    if (spec?.isTexture) {
      // same pyramid for a caller's own texture — unless it's a render target,
      // whose sampler state was fixed at setup and can't be flipped from here
      if (!spec.isRenderTargetTexture && !spec.generateMipmaps) {
        spec.generateMipmaps = true;
        spec.minFilter = THREE.LinearMipmapLinearFilter;
        spec.needsUpdate = true;
      }
      uniform.value = spec;
      return;
    }
    if (typeof spec !== 'string') {
      warn('.displace(): the map is an imported image by name, a texture chain, or a THREE.Texture');
      return;
    }
    // height is data, not color — decoded raw, the way a displacementMap is
    const t = this.engine.ensureTexture(spec, false);
    if (t.texture) uniform.value = t.texture;
    else t.pending.then((tex) => { if (tex && isAlive()) uniform.value = tex; });
  }
}

for (const Op of [GeoOp, SegmentsOp, ParticleOp]) Op.prototype.render = renderAsTexture;

// The same verb on an image: person().particles() births on the bright pixels
// of the live texture, each particle keeping the color of the pixel it was
// born from. Defined here rather than in textures.js so particles.js and
// textures.js don't import each other.
TextureOp.prototype.particles = function (opts) {
  return new ParticleOp(this.engine, opts, this);
};

// person().points() / .lines() / .wire(): the image as a grid of dots or
// scanlines. Builds the plane the long form would — a color map of the
// image, displaced by its brightness — and hands back the geometry chain, so
// .noise()/.rotation()/.color() carry on from it. size is the plane's world
// height (4, like a texture emitter), width follows the screen's aspect;
// depth is how far a white pixel lifts, 0 for a flat picture.
function imageGeo(tex, o, mode) {
  const size = o.size ?? 4;
  const depth = o.depth ?? 0.5;
  const res = o.res ?? (mode === 'lines' ? (o.dir === 'y' ? [64, 256] : o.dir === 'xy' ? 256 : [256, 64]) : 256);
  const dsz = new THREE.Vector2();
  const aspect = () => {
    tex.engine.renderer.getDrawingBufferSize(dsz);
    return dsz.x / Math.max(dsz.y, 1);
  };
  const a0 = aspect();
  const g = new GeoOp(tex.engine, 'plane', { width: size * a0, height: size, res })
    .material({ map: tex })
    // keeps the picture's aspect through a resize without a re-run
    .scale(() => aspect() / a0, 1, 1);
  if (depth !== 0) g.displace(tex, { amount: depth, mid: o.mid ?? 0, smooth: o.smooth ?? 1 });
  return g;
}
TextureOp.prototype.points = function (o = {}) {
  return imageGeo(this, o, 'points').points({ size: o.dot ?? 1 });
};
TextureOp.prototype.lines = function (o = {}) {
  return imageGeo(this, o, 'lines').lines({ dir: o.dir ?? 'x' });
};
TextureOp.prototype.wire = function (o = {}) {
  return imageGeo(this, o, 'lines').wire();
};

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
    if (x instanceof Curve) x = unphased(x);
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
    // (every layer of the sketch or block it's sent out in, that is: see
    // engine.settleLights, which narrows this once the layers are known)
    const mine = this.engine.scope.lights;
    if (name != null) {
      this.light.layers.set(this.engine.geoLayer(String(name)));
      if (mine.includes(this.light)) mine.splice(mine.indexOf(this.light), 1);
    } else {
      this.light.layers.enableAll();
      if (!mine.includes(this.light)) mine.push(this.light);
    }
    // ambient() adds itself, so calling .out() on one only re-layers it
    if (this._added) return this;
    this._added = true;
    // intensity and color animate like everything else in the API. They have
    // to be driven from here: three folds intensity into the light's color
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
  // sketch('kirbster v2'): a saved sketch run as a block. One per name, so two
  // reads share a build, unless it's handed params, which make it its own.
  // 'pending' while the source is on its way (the sketch re-runs when it lands).
  const savedBlock = (name, params) => {
    const src = engine.sketchSources.get(name);
    if (src == null) {
      if (engine.sketchMissing.has(name) || !engine.onNeedSketch) return null;
      engine.onNeedSketch(name);
      return 'pending';
    }
    const key = SAVED_BLOCK + name;
    let block = params ? null : engine.root.blocks.get(key);
    if (!block) {
      const names = Object.keys(api);
      const fn = () => new Function(...names, `"use strict";\n{${rewriteBlocks(src)}\n}`)(...names.map((n) => api[n]));
      block = { name, fn, home: engine.root, scope: null, node: null, building: false, saved: true, params: params ?? null };
      if (!params) engine.root.blocks.set(key, block);
    }
    return block;
  };
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

    // Generative structure: a rule steering a cursor, placing copies as it goes
    // (see layout.js). .branch() re-runs the rule one generation deeper, so a
    // few lines make a tree; loops in the rule make spirals and scatters.
    // .instance() draws the result: box().instance(l).out().
    layout: (depth, rule) => makeLayout(engine, depth, rule),

    // A path through space as a callable value — c(u) is the point a fraction
    // u of the way along, so c(T.mul(0.2)) rides it, c(i / n) is the i-th of
    // n stations, spread(n).map(c) is the whole set (see curve.js). curve(fn)
    // lifts a u => [x, y, z] of your own; curve(layout) follows an unbranched
    // layout's trail.
    curve: Object.assign((src, o) => makeCurve(src, o), {
      circle: curveCircle,
      line: curveLine,
      helix: curveHelix,
    }),
    // n phases 0..1, evenly spaced — what a curve (or anything phase-shaped) eats
    spread,

    // The sketch's own points as a data set: data(array) views a live
    // [x, y, z][] the sketch moves in onFrame(), data({ pos, alpha }) adopts
    // any source — each channel an array or a fn of t returning one. Renders
    // nothing; .pairs()/.link() connect it, geo .instance() places onto it.
    data: (spec) => new ChannelData(engine, spec),

    // Line segments between paired points, rebuilt every frame — see link.js.
    // Takes a .pairs(), a data set, or a plain array of [x, y, z] (paired
    // with the given within/max); link() is the same call said quicker.
    segments: (pairs, o) => new SegmentsOp(engine, pairs, o),

    // link(points, { within, max, fill, … }) — the plexus one-liner over any
    // array or data set; .link() on shapes, particles and sets is the same.
    link(pts, o = {}) {
      const d = asData(engine, pts);
      if (!d) {
        warn('link: points first — a plain array of [x, y, z], a data set, or .link() on a shape or particle system');
        return new SegmentsOp(engine, null, o);
      }
      return d.link(o);
    },

    // A GPU particle system emitting from a point — see particles.js, and
    // GeoOp.particles() for the form that emits from a shape's surface.
    // The pool sizes itself from rate × life (capped by max); forces chain on
    // (.force/.turbulence/.attract/.drag), then looks (.size/.color/.opacity/
    // .fade/.blend/.soft, .over() for looks that evolve across a life).
    particles: (opts) => new ParticleOp(engine, opts),

    // An imported .obj/.fbx as a geometry op — chain .position/.rotation/.scale/
    // .noise/.instance/.material/.out() exactly like sphere() or box().
    // Drag a model into the window to import it (the drop types the call), or
    // run an empty model() to browse Poly Haven's. name = filename, exact or
    // case-insensitive substring. Every mesh in the file is merged into one
    // geometry; its materials/textures are dropped in favor of .material().
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
    //
    // The config form is the third way to move it: a game controller, either
    // feeding the orbit rig (pad) or flying free (fly) — see camera-pad.js. It
    // takes x/y/z/target too, so one call can place the camera and then hand
    // it over.
    camera(x = 0, y = 2, z = 8, target = [0, 0, 0]) {
      // Inside a block the camera is the block's own: it frames that block's
      // picture and nothing you orbit moves it. (A block that never calls this
      // is seen through the sketch's camera, so it can still be orbited.)
      if (engine.scope.parent) {
        if (x !== null && typeof x === 'object' && !Array.isArray(x)) {
          if (x.pad || x.fly) warn("camera({ pad / fly }) inside a block: a controller drives the sketch's own camera. The block keeps the position it's given");
          ({ x = 0, y = 2, z = 8, target = [0, 0, 0] } = x);
        }
        const cam = engine.ownCamera();
        const place = (t) => {
          cam.position.set(resolve(x, t), resolve(y, t), resolve(z, t));
          cam.lookAt(...resolve3(target, t));
        };
        place(0);
        if ([x, y, z, ...target].some((v) => typeof v === 'function')) engine.updaters.push(place);
        return;
      }
      if (x !== null && typeof x === 'object' && !Array.isArray(x)) {
        const o = x;
        engine.cameraTouched = true;
        if (o.x != null || o.y != null || o.z != null || o.target) {
          engine.camera.position.set(o.x ?? engine.camera.position.x,
            o.y ?? engine.camera.position.y, o.z ?? engine.camera.position.z);
          engine.controls.target.set(...(o.target ?? engine.controls.target.toArray()));
        }
        // no pad asked for = the config form of the plain call, already done
        if (o.pad == null && !o.fly) return;
        if (o.pad === false) return;
        engine.updaters.push(cameraPad(engine, o));
        return;
      }
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
      const world = engine.world; // the scene's, or the block's this was called in
      const attach = (loaded) => {
        // a re-run since the load started owns the scene now — don't light it
        if (loaded && engine.patchGen === gen) tick = applyHdri(world, loaded, o);
      };
      if (h.env) attach(h);
      else h.pending.then(attach);
      engine.updaters.push((t) => tick?.(t, resolve));
    },
    // A color from hue/saturation/lightness, for every slot that takes one —
    // the [r, g, b] form spelled the way a palette is picked. Any argument
    // takes a fn of t or a signal, so hsl(rand(), 0.7, 0.5) is a random hue at
    // a brightness you chose. Optional fourth argument is alpha, which the
    // texture color slots read.
    hsl,
    // The same wheel measured the other way: s and v as a paint program spells
    // them, so hsv(h) alone is the vivid hue and hsv(h, 0, 1) is white.
    hsv,

    // The updater writes into the Color, not into scene.background — so an
    // hdri() that takes the background slot afterwards keeps it, and this
    // quietly animates a color nothing is showing.
    bg(color) {
      const c = makeColor(color);
      engine.world.background = c; // the scene's, or the block's
      // and behind the texture stack, so a chain with transparency in it shows
      // the background rather than the black the canvas happens to be cleared
      // to. Kept as the value, not the Color: the texture side resolves a fn
      // of t itself, on the frame it draws.
      engine.bg = color;
      if (isDynamicColor(color)) engine.updaters.push((t) => setColor(c, color, t));
    },
    // Pins the render to an exact pixel size and shape. The main window shows
    // it letterboxed — scaled to fit, centered, black around it — while the
    // projector window (F1) takes the same aspect ratio, so full-screening
    // that one on a display of the same shape fills it edge to edge. Without
    // a call the render fills the browser window, as it always has.
    // resolution(1920, 1080), resolution({ width, height }), or one number for
    // a square. Sidebar quality still scales the pixels underneath, and the
    // sidebar's fixed resolution, when on, outranks this entirely.
    resolution(width, height) {
      if (engine.scope.parent) return warn(`resolution() inside ${engine.scope.name}: a block renders at the sketch's size for now, so this does nothing`);
      if (width !== null && typeof width === 'object') ({ width, height } = width);
      const px = (n) => Math.max(1, Math.round(n));
      engine.sketchRes = width == null ? null : [px(width), px(height ?? width)];
    },
    // Tempo for beat() and B, overriding the audio manager's for this sketch;
    // dropping the call hands it back. Deliberately not a fn of t: barPhase
    // counts t * bpm, so a moving tempo jumps the beat instead of easing it.
    tempo(bpm) {
      if (engine.scope.parent) return warn(`tempo() inside ${engine.scope.name}: there is one clock, and it's the sketch's, so this does nothing`);
      if (bpm == null) {
        engine.sketchBpm = null;
        return;
      }
      const n = Number(bpm);
      // a NaN here would spread into every beat() phase at once, freezing the lot
      if (!Number.isFinite(n) || n <= 0) {
        warn(`tempo: ${bpm} isn't a tempo — staying at ${engine.bpm}`);
        return;
      }
      engine.sketchBpm = n;
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
      engine.world.fog = fog;
      if (isDynamicColor(color)) engine.updaters.push((t) => setColor(fog.color, color, t));
    },

    // A labeled block is a sketch inside the sketch (sketch-blocks.js rewrites
    // `kirb: { ... }` into the first of these), and sketch('kirb') is everything
    // it sends out as one texture: on its own bg() when it has one, transparent
    // when it doesn't. Its fog, hdri and camera are its own. Built the first
    // time something asks for it, so a block nothing reads costs nothing.
    __sketch: (name, fn) => engine.defineBlock(String(name), fn),
    sketch(name, params) {
      const nothing = () => new TextureOp(engine, 'constant', { color: null });
      let block = engine.findBlock(String(name));
      // a written-out block reads the names around it, so it has nowhere to
      // put these — quietly doing nothing with them is the confusing version
      if (block && params) warn(`sketch('${name}', { ... }): ${name} is a block in this sketch, and a block reads the names declared above it rather than params`);
      block ??= savedBlock(String(name), params);
      if (block === 'pending') return nothing();
      if (!block) {
        const known = [];
        for (let sc = engine.scope; sc; sc = sc.parent) known.push(...sc.blocks.keys());
        warn(`sketch('${name}'): there's no block called ${name} above this line, and no saved sketch by that name${known.length ? ` (there is ${known.join(', ')})` : ''}`);
        return nothing();
      }
      if (block.building || engine.savedStack.includes(block.name)) {
        warn(`sketch('${name}') inside ${name}: a sketch can't hold itself. input() is its own last frame`);
        return nothing();
      }
      if (!block.scope) {
        if (block.saved) engine.savedStack.push(block.name);
        try { engine.buildBlock(block); } finally { if (block.saved) engine.savedStack.pop(); }
      }
      if (!block.node) {
        // made where the block is written, whoever asked first
        const was = engine.scope;
        engine.scope = block.home;
        try {
          block.node = new TextureOp(engine, 'sketch');
          block.node.target = block.scope;
        } finally {
          engine.scope = was;
        }
      }
      return block.node;
    },

    // Inside a saved sketch: a value the sketch using it can set.
    // sketch('kirbster v2', { speed: 2 }) makes param('speed', 1) return 2; run
    // on its own it returns the 1. A written-out block doesn't need this, since
    // it can read the names around it.
    param(name, dflt) {
      for (let sc = engine.scope; sc; sc = sc.parent) {
        if (!sc.params) continue;
        sc.paramsRead.add(name);
        return name in sc.params ? sc.params[name] : dflt;
      }
      return dflt;
    },

    // textures — texture operators (see textures.js). Chains render only with .out()
    // scene({ bg }): a backdrop for this read only — null renders it transparent
    // (comps 'over' like a layer), a chain shows through behind the geometry,
    // a color stands in for bg()
    scene: (o) => new TextureOp(engine, 'scene', o ?? {}),
    // stack({ bg }): every layer above the call, textures and blends included
    stack: (o) => new TextureOp(engine, 'stack', o ?? {}),
    // the sketch's backdrop alone, as the camera sees it: the hdri() sky, or
    // the bg() color when there isn't one
    sky: () => new TextureOp(engine, 'sky', {}),
    // the same render as scene(), as a grayscale distance map: black near,
    // white far. depth({ near, far }) sets the world-space range it spans
    // (defaulting to the sketch's fog, else 0..20); depth({ focus, range })
    // instead measures distance from a focal plane, which is a DOF blur mask.
    // Pairs with .mask(m, fn): scene().mask(depth(), s => s.blur(8)).
    depth: (o) => new TextureOp(engine, 'depth', o ?? {}),
    // input() = last frame's display output; input('name') = the buffer
    // published by .out('name'). ('in' is a JS reserved word, hence 'input'.)
    // input('name', { reset }) blanks the held frame when reset's value goes
    // truthy — a code-driven cut of the loop.
    input: (name, o) => {
      if (name != null && typeof name === 'object') { o = name; name = undefined; }
      return new TextureOp(engine, 'in', {
        ...(name != null ? { name: String(name) } : {}),
        ...(o?.reset != null ? { reset: o.reset } : {}),
      });
    },
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
    // h defaults to w (see textures.js for the units: w/h are fractions of
    // the frame per axis, corner/soft UV-height like circle's radius)
    rect: (o) => new TextureOp(engine, 'rect', o ?? {}),
    polygon: (o) => new TextureOp(engine, 'polygon', o ?? {}),
    checker: (o) => new TextureOp(engine, 'checker', o ?? {}),
    // An incompressible fluid sim as a generator: dye poured in with .ink(),
    // the field driven by .push(), solids marked by .obstacle(). The node
    // itself is the dye; .velocity()/.curl() read the fields behind it.
    //   fluid().push(noise({ period: 0.4 })).ink(text('hi'), 2).out()
    // chain.fluid() is the same thing said from the dye's side, and is the
    // shorter way in when there is one ink source. This form is for a sim with
    // none — a field read only through .velocity()/.curl().
    // The sim carries across re-runs, so editing a knob doesn't blow it away.
    fluid(o) {
      const node = new TextureOp(engine, 'fluid', o ?? {});
      node.sim = claimFluidState();
      return node;
    },
    noise: (o) => new TextureOp(engine, 'noiseGen', o ?? {}),
    // A fragment pass written by hand, as a source: vUv is the pixel, tex0 is
    // black (nothing came before it), and the second argument names uniforms.
    // chain.glsl() is the same call with the picture so far in tex0.
    glsl: (source, uniforms) => glslNode(engine, source, uniforms),
    voronoi: (o) => new TextureOp(engine, 'voronoi', o ?? {}),
    text: (text, o) => new TextureOp(engine, 'textGen', { ...o, text }),
    // camera capture as a texture; name matches a camera label (substring,
    // case-insensitive), no name = default camera. Permission prompt on
    // first use; the stream survives re-runs.
    video: (name) => new TextureOp(engine, 'video', name != null ? { name: String(name) } : {}),
    // person mask from the same camera stream video(name) uses; the
    // segmentation models load on first use (see segment.js). Naming a part
    // switches to the multiclass model; options may ride the first argument
    person(name, o = {}) {
      if (name !== null && typeof name === 'object') { o = name; name = o.name; }
      const p = {};
      if (name != null) p.name = String(name);
      if (o.part != null) p.part = String(o.part);
      if (o.smooth != null) p.smooth = o.smooth;
      return new TextureOp(engine, 'segment', p);
    },

    // Imported media files: drag a file into the window to import it (the
    // drop also types the call for you), or run an empty call for a picker.
    // name = filename, exact or case-insensitive substring; files persist
    // in the browser across reloads and keep playing through re-runs.
    videofile(name, o = {}) {
      if (Array.isArray(name)) return api.videoseq(name);
      if (name !== null && typeof name === 'object') { o = name; name = o.name; }
      if (name == null) engine.requestMediaPick('videofile', 'video');
      return new TextureOp(engine, 'videofile', { ...o, name: name != null ? String(name) : null });
    },
    // several videos with an index picking the current one, like imageseq() —
    // a clip bank. All of them keep playing, so a switch lands mid-action, the
    // way cutting between live feeds does.
    videoseq(names, index) {
      if (names == null || !names.length) {
        engine.requestMediaPick('videoseq', 'video', true);
        names = [];
      }
      return new TextureOp(engine, 'videoseq', { names: names.map(String), index });
    },
    imagefile(name) {
      if (Array.isArray(name)) return api.imageseq(name);
      if (name == null) engine.requestMediaPick('imagefile', 'image');
      return new TextureOp(engine, 'imagefile', { name: name != null ? String(name) : null });
    },
    // several images with an index picking the current one — any fn of t or
    // signal (floored, wrapped): imageseq([...], beat(4)) steps on
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
    // A named band from the audio manager (ctrl+a), normalized 0..1 by its
    // meter anchors. band() = the global level, band(1) = the band named "1"
    // (the default names are numbers). The lookup is live: dragging in the
    // manager retunes a running sketch.
    band(name) {
      const key = name == null ? 'level' : String(name);
      const ae = audioIn();
      return sig(() => bandValue(ae, key), ae);
    },
    // An imported audio file, played out loud and analyzed like audio():
    // returns its level as a signal with the same chainable methods
    // (.kicks/.lowpass/...). Empty call = file picker. Options: volume,
    // speed, loop (default true), restart (fn of t, rising edge rewinds),
    // chan (analyze one channel). Numeric second arg = chan.
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
        if (o.speed != null) setRate(m.el, resolve(o.speed, t) || 0, `audiofile "${name}"`);
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
    // Tempo-synced gate: 1 for `width` of each cycle, `perBar` cycles per bar
    // of four beats at the manager's tempo — so the number is the note value.
    // beat(4) is quarter notes, beat(16) sixteenths, beat(1) the downbeat.
    //
    // This is the shape every trigger slot wants (restart, jump, .when(),
    // .hold()), which is why it's the plain name: they fire on the rising edge
    // and don't care how wide the gate is, so width only really matters to
    // .when(), where it's how long the branch stays up. For a value that moves
    // on the tempo grid rather than a pulse, reach for B.
    beat(perBar = 4, width = 0.5) {
      return sig((t) => barPhase(t, resolve(perBar, t))).sqr(width);
    },
    // pick from a list by index — .select() standing on its own, and the only
    // form that works for texture chains: hand it values and it gives back a
    // signal, hand it chains and it gives back a texture showing one of them,
    // switched the way .when() does (all built once, only the chosen one
    // rendering). The index is any fn of t or signal, floored and wrapped, so
    // the timing is whatever drives it — beat(1) walks the list a step per
    // bar, rand().mul(3).beat() lands somewhere new each beat.
    // Default: one item per second, like imageseq().
    select(items, index = (t) => t) {
      if (!Array.isArray(items)) items = [items];
      const textures = items.filter((v) => v instanceof TextureOp);
      if (textures.length && textures.length !== items.length) {
        warn('select: textures mixed with other values — only the textures are in the list');
        items = textures;
      }
      if (items.some((v) => v instanceof GeoOp)) {
        warn('select: a shape is built once, not per frame — select between its parameters instead');
      }
      if (!items.length) {
        warn('select: nothing to select from — using 0');
        return sig(() => 0);
      }
      const n = items.length;
      const at = (t) => {
        const i = Math.floor(resolve(index, t));
        return Number.isFinite(i) ? ((i % n) + n) % n : 0;
      };
      if (textures.length) {
        // a fixed index can never change — take that branch now, as .when() does
        return typeof index === 'function'
          ? new TextureOp(engine, 'switch', { index }, items)
          : items[at(0)];
      }
      return sig((t) => resolve(items[at(t)], t));
    },
    // smooth random signal (deterministic value noise of t, 0..1) — the
    // signal-space cousin of the noise() texture. freq in Hz-ish wiggles/sec;
    // different seeds give independent signals. Pairs with .beat()/.hold():
    // rand().beat(1) freezes a new random value each bar,
    // rand().hold(audio().kicks()) one on every kick.
    // rand({ freq, seed }) and positional rand(freq, seed) both work, and both
    // take signals — a moving seed jumps between independent randoms.
    rand(freq = 1, seed = 0) {
      if (typeof freq === 'object' && freq !== null) ({ freq = 1, seed = 0 } = freq);
      return sig((t) => valueNoise(t * resolve(freq, t) + resolve(seed, t) * 137.31));
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
    // A MIDI controller's knobs, pads and keys as signals. midi() reads every
    // connected device at once; midi('launchkey') one of them by name
    // (case-insensitive substring), so two controllers can drive different
    // parameters. .cc(num, channel?) is a knob or fader, 0..1 — an empty cc()
    // learns instead, binding to the next control you move and writing its
    // numbers into the call. .note/.vel/.gate/.touch follow the keys (see
    // keyHandle), .key(38) narrows them to one pad, .bend is -1..1.
    // No Web MIDI in Safari; the signals read 0 there.
    midi(name) {
      return midiHandle(name, (call) => engine.requestLearn({ call, device: name }));
    },
    // A game controller as signals: .lx/.ly/.rx/.ry sticks (-1..1, y up),
    // .lt/.rt analog triggers, .btn('a') a 1/0 gate — and an empty .btn()
    // learns, writing in whichever button you press next. gamepad() is the
    // first pad connected, gamepad(1) one by slot. Browsers hide a pad until
    // it sends something, so press a button if nothing is reading.
    gamepad(index, o = {}) {
      if (index !== null && typeof index === 'object') { o = index; index = undefined; }
      return gamepadHandle(index, o, (call) => engine.requestLearn({ call, pad: index }));
    },
    // lift any fn of t into a chainable signal: sig(t => Math.sin(t)).smooth().
    // Bare sig() is t itself — the seconds-based phase source, so
    // sig().sin().range(0, 10) is a 1 Hz oscillation over 0..10.
    sig: (fn = (t) => t) => sig((t) => resolve(fn, t)),
    // sig() already spelled out — T.mul(0.3).sin() rather than sig().mul(0.3).sin().
    // Stateless (it only reads t), so one shared instance is safe: everything
    // chained off it is built fresh by the sketch that chains it.
    T: sig((t) => t),
    // The same idea on the tempo grid: bars elapsed, counting up, at the
    // manager's tempo. Rate is set the way T's is — B.mul(2).sin() is a
    // half-bar LFO the way T.mul(2).sin() is a half-second one — and the whole
    // part is which bar, so B.select([...]) steps a list on the downbeat.
    // Stateless like T, so one shared instance is safe.
    B: sig((t) => barPhase(t, 1)),
    // escape hatches
    THREE,
    onFrame(fn) {
      tag(fn, site('onFrame'));
      engine.updaters.push(fn);
    },

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
    Signal,
    Layout,
    Data,
    Curve,

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
