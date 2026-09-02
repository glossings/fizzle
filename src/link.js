import * as THREE from 'three';
import { warn } from './warn.js';
import { setColor, makeColor, isDynamicColor } from './color.js';

// Data: points (and whatever rides with them) as parallel arrays, refreshed
// once per frame. geo.scatter(n) is one with .pos and .normal, particles
// .read() one with .pos/.alpha/.vel/.age/.life, data() adopts the sketch's
// own; a plain array of [x, y, z] is accepted anywhere a Data goes. .pairs()
// finds which points sit near each other, segments() draws lines between
// them, .link() is the one-liner over both.
//
// Channels are lazy: internally everything is flat typed arrays (what the
// spatial hash and the line buffers read), and the array a sketch touches is
// materialized on first access each frame. Readback sources follow .field()'s
// contract — on the CPU one frame behind, read once per frame.
//
// Data is in sketch scope for custom methods, like Texture and Geometry:
// Data.prototype.centroid = function () { … }

const resolve = (v, t) => (typeof v === 'function' ? v(t) : v);
const resolve3 = (v, t) => v.map((c) => resolve(c, t));

const MAX_POINTS = 100000;
const MAX_PAIRS = 65536;

// what a point may be spelled as: [x, y, z], a Vector3/sample(), or garbage;
// components may be fns of t — what a moving curve's points are made of
const comp = (c, t) => {
  if (typeof c !== 'function') return Number(c) || 0;
  try { return Number(c(t)) || 0; } catch (e) { warn(e.message ?? String(e)); return 0; }
};
const readPoint = (v, out, base, t) => {
  if (v == null || typeof v !== 'object') { out[base] = out[base + 1] = out[base + 2] = 0; return; }
  if (Array.isArray(v)) {
    out[base] = comp(v[0], t); out[base + 1] = comp(v[1], t); out[base + 2] = comp(v[2], t);
  } else {
    out[base] = comp(v.x, t); out[base + 1] = comp(v.y, t); out[base + 2] = comp(v.z, t);
  }
};

export class Data {
  constructor(engine) {
    if (engine == null) {
      throw new Error('new Data() is not how a set starts — data(), geo.scatter(n) or particles().read() make one');
    }
    this.engine = engine;
    this._pts = new Float32Array(0);   // xyz, world space
    this._alp = null;                  // per-point 0..1, null = all 1
    this._n = 0;
    this._at = null;
    this._mat = {};                    // materialized channels, keyed by name
  }

  _sync() {
    const t = this.engine.time;
    if (this._at === t) return;
    this._at = t;
    this._fill(t);
  }
  _grow(n) {
    if (this._pts.length < n * 3) this._pts = new Float32Array(n * 3);
  }
  // one JS array per channel per frame, built the first time it's touched
  _chan(name, build) {
    this._sync();
    const m = this._mat;
    if (m[`${name}At`] !== this._at) {
      m[`${name}At`] = this._at;
      m[name] = build();
    }
    return m[name];
  }

  get count() { this._sync(); return this._n; }
  get pos() {
    return this._chan('pos', () => {
      const out = new Array(this._n);
      for (let i = 0; i < this._n; i++) out[i] = [this._pts[i * 3], this._pts[i * 3 + 1], this._pts[i * 3 + 2]];
      return out;
    });
  }
  get alpha() {
    return this._chan('alpha', () => {
      const out = new Array(this._n);
      for (let i = 0; i < this._n; i++) out[i] = this._alp ? this._alp[i] : 1;
      return out;
    });
  }

  // pairs({ within, max }) — pairs within this set; pairs(other, { … }) —
  // each point here to nearby points of the other set
  pairs(other, opts) {
    if (typeof other === 'number') {
      warn("pairs: the other set is the points themselves — sample: n reads n emitter-surface points, in .link() on a particle system");
      other = null;
    } else if (other != null && !(other instanceof Data) && !Array.isArray(other)) { opts = other; other = null; }
    if (Array.isArray(other)) other = new ArrayData(this.engine, other);
    return new Pairs(this.engine, this, other ?? null, opts ?? {});
  }
  // the one-liner: segments between every pair closer than within — within
  // this set, or across to another (.link(other, { … }))
  link(other, o) {
    // a number falls through to pairs(), which says where sample: belongs
    if (typeof other !== 'number' && other != null && !(other instanceof Data) && !Array.isArray(other)) { o = other; other = null; }
    o ??= {};
    return new SegmentsOp(this.engine, this.pairs(other, { within: o.within, max: o.max }), o);
  }
}

// a plain [x, y, z][] the sketch owns, viewed live
export class ArrayData extends Data {
  constructor(engine, arr) {
    super(engine);
    this.arr = arr;
  }
  _fill(t) {
    const n = Math.min(this.arr.length, MAX_POINTS);
    this._grow(n);
    this._n = n;
    for (let i = 0; i < n; i++) readPoint(this.arr[i], this._pts, i * 3, t);
  }
  // the source array is already the channel
  get pos() { return this.arr; }
}

// data({ pos, alpha? }) — each channel an array, or a fn of t returning one.
// The whole extension surface: points from a sensor, a model, a feed plug in
// here and come out a first-class set.
export class ChannelData extends Data {
  constructor(engine, spec) {
    super(engine);
    if (Array.isArray(spec)) spec = { pos: spec };
    if (spec === null || typeof spec !== 'object' || (spec.pos == null)) {
      warn('data: an array of [x, y, z], or { pos, alpha } with each channel an array or a fn of t returning one');
      spec = { pos: [] };
    }
    this.spec = spec;
  }
  _fill(t) {
    let pos, alpha = null;
    // a channel that throws shouldn't take the frame down with it
    try {
      pos = resolve(this.spec.pos, t) ?? [];
      if (this.spec.alpha != null) alpha = resolve(this.spec.alpha, t);
    } catch (e) { warn(e.message ?? String(e)); pos = []; }
    if (!Array.isArray(pos)) { warn('data: the pos channel is an array of [x, y, z]'); pos = []; }
    const n = Math.min(pos.length, MAX_POINTS);
    this._grow(n);
    this._n = n;
    this._posArr = pos;
    for (let i = 0; i < n; i++) readPoint(pos[i], this._pts, i * 3, t);
    if (alpha) {
      if (!this._alp || this._alp.length < n) this._alp = new Float32Array(n);
      for (let i = 0; i < n; i++) this._alp[i] = Math.min(Math.max(alpha[i] ?? 1, 0), 1);
    } else this._alp = null;
  }
  get pos() { this._sync(); return this._posArr; }
}

// geo.scatter(n) — the first n of the shape's surface scatter, the same
// deterministic points .sample(i) reads, .noise() and transform applied;
// .normal rides along
export class ScatterData extends Data {
  constructor(engine, geo, n) {
    super(engine);
    this.geo = geo;
    this.len = Math.floor(n);
    if (!(this.len >= 1)) { warn(`scatter: how many points? — got ${JSON.stringify(n)}, using 200`); this.len = 200; }
    if (this.len > MAX_POINTS) { warn(`scatter: capped at ${MAX_POINTS} points`); this.len = MAX_POINTS; }
  }
  _fill() {
    this._grow(this.len);
    this._n = this.len;
    for (let i = 0; i < this.len; i++) {
      const p = this.geo.sample(i);
      this._pts[i * 3] = p.x; this._pts[i * 3 + 1] = p.y; this._pts[i * 3 + 2] = p.z;
    }
  }
  get normal() {
    return this._chan('normal', () => {
      const out = new Array(this._n);
      for (let i = 0; i < this._n; i++) {
        const nm = this.geo.normal(i);
        out[i] = [nm.x, nm.y, nm.z];
      }
      return out;
    });
  }
}

const smoothstep = (a, b, x) => {
  const k = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return k * k * (3 - 2 * k);
};

const _obj = new THREE.Object3D();
const IDENTITY = new THREE.Matrix4();

// particles.read() — filled by the system's updater, not on demand: the state
// lives on the GPU, and the read lands here one frame behind. A slot between
// lives keeps its index with alpha 0, so indices are stable across frames.
export class ParticleData extends Data {
  _sync() {}   // pushed by _ingest, never pulled
  _ingest(pos, vel, n, p3, r3, s3, fade) {
    this._grow(n);
    if (!this._alp || this._alp.length < n) this._alp = new Float32Array(n);
    this._n = n;
    this._at = this.engine.time;
    this._raw = { pos, vel };
    _obj.position.set(...p3);
    _obj.rotation.set(...r3);
    _obj.scale.set(...s3);
    _obj.updateMatrix();
    const e = _obj.matrix.elements;
    const ident = _obj.matrix.equals(IDENTITY);
    this._e = ident ? null : e.slice();
    for (let i = 0; i < n; i++) {
      const age = pos[i * 4 + 3];
      const life = Math.max(vel[i * 4 + 3], 1e-6);
      if (age < 0 || age >= life) { this._alp[i] = 0; continue; }
      // the draw shader's envelope (particles.js drawVert), point for point
      const frac = age / life;
      let env = 1;
      if (fade.in > 0) env *= smoothstep(0, fade.in, frac);
      if (fade.out > 0) env *= 1 - smoothstep(1 - fade.out, 1, frac);
      this._alp[i] = env;
      const x = pos[i * 4], y = pos[i * 4 + 1], z = pos[i * 4 + 2];
      if (ident) {
        this._pts[i * 3] = x; this._pts[i * 3 + 1] = y; this._pts[i * 3 + 2] = z;
      } else {
        this._pts[i * 3] = e[0] * x + e[4] * y + e[8] * z + e[12];
        this._pts[i * 3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
        this._pts[i * 3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
      }
    }
  }
  _w(buf) {
    const out = new Array(this._n);
    for (let i = 0; i < this._n; i++) out[i] = buf ? buf[i * 4 + 3] : 0;
    return out;
  }
  // seconds into the current life; negative while the slot waits to be born
  get age() { return this._chan('age', () => this._w(this._raw?.pos)); }
  get life() { return this._chan('life', () => this._w(this._raw?.vel)); }
  get vel() {
    return this._chan('vel', () => {
      const out = new Array(this._n);
      const v = this._raw?.vel, e = this._e;
      for (let i = 0; i < this._n; i++) {
        if (!v) { out[i] = [0, 0, 0]; continue; }
        const x = v[i * 4], y = v[i * 4 + 1], z = v[i * 4 + 2];
        // the system's rotation and scale turn velocities too; its position doesn't
        out[i] = e
          ? [e[0] * x + e[4] * y + e[8] * z, e[1] * x + e[5] * y + e[9] * z, e[2] * x + e[6] * y + e[10] * z]
          : [x, y, z];
      }
      return out;
    });
  }
}

// anything point-shaped, upgraded: a Data as itself, a plain array wrapped
export const asData = (engine, v) =>
  v instanceof Data ? v : Array.isArray(v) ? new ArrayData(engine, v) : null;

// Which points sit near each other, as data: every pair closer than within,
// at most max per point — .list is [a, b] index pairs, rebuilt each frame.
// Spatial-hashed, so the cost is the points plus the pairs actually found,
// not the N² of checking everyone against everyone.
export class Pairs {
  constructor(engine, a, b, opts) {
    this.engine = engine;
    this.a = a;
    this.b = b;             // null = pairs within a
    this.within = opts.within ?? 1;
    this.max = opts.max ?? 6;
    this._pa = [];
    this._pb = [];
    this._pd = [];
    this._live = 0;
    this._at = null;
    this._listAt = null;
    this._counts = null;
    this._grid = new Map();
  }

  _ensure() {
    const t = this.engine.time;
    if (this._at === t) return;
    this._at = t;
    this._build(t);
  }

  _build(t) {
    const a = this.a, b = this.b;
    a._sync();
    b?._sync();
    this._live = 0;
    const within = Math.max(resolve(this.within, t), 0);
    const max = Math.max(Math.floor(resolve(this.max, t)), 1);
    const na = a._n, nb = b ? b._n : na;
    if (!within || !na || !nb) return;
    const w2 = within * within;
    const inv = 1 / within;
    const src = b ?? a;   // the set that goes into the grid

    const grid = this._grid;
    grid.clear();
    const sp = src._pts, sa = src._alp;
    for (let i = 0; i < (b ? nb : na); i++) {
      if (sa && sa[i] <= 0) continue;
      const key = `${Math.floor(sp[i * 3] * inv)},${Math.floor(sp[i * 3 + 1] * inv)},${Math.floor(sp[i * 3 + 2] * inv)}`;
      const cell = grid.get(key);
      if (cell) cell.push(i); else grid.set(key, [i]);
    }

    if (!this._counts || this._counts.length < na + (b ? nb : 0)) {
      this._counts = new Uint16Array(na + (b ? nb : 0));
    }
    const counts = this._counts;
    counts.fill(0, 0, na + (b ? nb : 0));

    const ap = a._pts, aa = a._alp;
    let full = false;
    for (let i = 0; i < na && !full; i++) {
      if (aa && aa[i] <= 0) continue;
      if (counts[i] >= max) continue;
      const x = ap[i * 3], y = ap[i * 3 + 1], z = ap[i * 3 + 2];
      const cx = Math.floor(x * inv), cy = Math.floor(y * inv), cz = Math.floor(z * inv);
      for (let ox = -1; ox <= 1 && !full; ox++) for (let oy = -1; oy <= 1 && !full; oy++) for (let oz = -1; oz <= 1; oz++) {
        const cell = grid.get(`${cx + ox},${cy + oy},${cz + oz}`);
        if (!cell) continue;
        for (const j of cell) {
          if (!b && j <= i) continue;   // within one set, each pair once
          if (counts[i] >= max) break;
          if (!b && counts[j] >= max) continue;
          const dx = sp[j * 3] - x, dy = sp[j * 3 + 1] - y, dz = sp[j * 3 + 2] - z;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 > w2 || (!b && d2 === 0)) continue;
          if (this._live >= MAX_PAIRS) {
            warn(`pairs: hit the ${MAX_PAIRS}-pair cap — shrink within, or lower max`);
            full = true;
            break;
          }
          this._pa[this._live] = i;
          this._pb[this._live] = j;
          this._pd[this._live] = Math.sqrt(d2);
          this._live++;
          counts[i]++;
          if (!b) counts[j]++;
        }
      }
    }
    this._within = within;
  }

  get count() { this._ensure(); return this._live; }
  // this frame's pairs as [a, b] index pairs — b indexes the other set when
  // the pairing crossed two
  get list() {
    this._ensure();
    if (this._listAt !== this._at) {
      this._listAt = this._at;
      const out = new Array(this._live);
      for (let i = 0; i < this._live; i++) out[i] = [this._pa[i], this._pb[i]];
      this._list = out;
    }
    return this._list;
  }

  // Triangles closed by the pairs: every trio whose three edges all made the
  // cut, as [a, b, c]. A post-pass over the graph, not a wider search — max
  // caps each point's neighbors, so the cost stays the pairs already found.
  _triBuild() {
    this._ensure();
    if (this._triAt === this._at) return;
    this._triAt = this._at;
    this._tn = 0;
    if (this.b) {
      warn('pairs: triangles need one set — a pairing across two has no third corner');
      return;
    }
    const n = this.a._n;
    const edge = new Set();
    const nbr = this._nbr ??= [];
    if (nbr.length < n) nbr.length = n;
    nbr.fill(null, 0, n);
    // adjacency upward only, so each triangle turns up once, at its lowest corner
    for (let k = 0; k < this._live; k++) {
      const a = this._pa[k], b = this._pb[k];
      const lo = a < b ? a : b, hi = a < b ? b : a;
      edge.add(lo * n + hi);
      (nbr[lo] ??= []).push(hi);
    }
    const ta = this._ta ??= [], tb = this._tb ??= [], tc = this._tc ??= [], td = this._td ??= [];
    const p = this.a._pts;
    for (let i = 0; i < n; i++) {
      const ns = nbr[i];
      if (!ns || ns.length < 2) continue;
      for (let x = 0; x < ns.length; x++) for (let y = x + 1; y < ns.length; y++) {
        const j = ns[x] < ns[y] ? ns[x] : ns[y], k = ns[x] < ns[y] ? ns[y] : ns[x];
        if (!edge.has(j * n + k)) continue;
        if (this._tn >= MAX_PAIRS) {
          warn(`pairs: hit the ${MAX_PAIRS}-triangle cap — shrink within, or lower max`);
          return;
        }
        // the longest edge is what the fill fades by
        const djk = Math.hypot(p[j * 3] - p[k * 3], p[j * 3 + 1] - p[k * 3 + 1], p[j * 3 + 2] - p[k * 3 + 2]);
        const dij = Math.hypot(p[i * 3] - p[j * 3], p[i * 3 + 1] - p[j * 3 + 1], p[i * 3 + 2] - p[j * 3 + 2]);
        const dik = Math.hypot(p[i * 3] - p[k * 3], p[i * 3 + 1] - p[k * 3 + 1], p[i * 3 + 2] - p[k * 3 + 2]);
        ta[this._tn] = i; tb[this._tn] = j; tc[this._tn] = k;
        td[this._tn] = Math.max(djk, dij, dik);
        this._tn++;
      }
    }
  }
  get tris() {
    this._triBuild();
    if (this._trisAt !== this._at) {
      this._trisAt = this._at;
      const out = new Array(this._tn);
      for (let i = 0; i < this._tn; i++) out[i] = [this._ta[i], this._tb[i], this._tc[i]];
      this._tris = out;
    }
    return this._tris;
  }
}

const BLENDS = { over: THREE.NormalBlending, normal: THREE.NormalBlending, add: THREE.AdditiveBlending };
const SEG_KEYS = ['fade', 'color', 'opacity', 'blend', 'within', 'max', 'count', 'sample', 'fill', 'lit'];

// segments(pairs, { fade, color, opacity, blend, fill, lit }) — line
// segments between paired points, rebuilt every frame; fill: alpha also
// shades every trio of mutually-near points as a triangle. Flat-colored by
// default (glow comes from .bloom()); lit hands lines and fills to the
// scene's lights instead.
export class SegmentsOp {
  constructor(engine, pairs, opts = {}) {
    if (engine == null) {
      throw new Error('new Segments() is not how a chain starts — call segments(pairs), or .link() on a data set');
    }
    this.engine = engine;
    if (Array.isArray(pairs)) pairs = new ArrayData(engine, pairs);
    if (pairs instanceof Data) {
      // a set instead of its pairs: pair it with the given (or default) rules
      pairs = pairs.pairs({ within: opts.within, max: opts.max });
    } else if (pairs != null && !(pairs instanceof Pairs)) {
      warn('segments: the first argument is a .pairs() of a data set, the set itself, or a plain array of [x, y, z]');
      pairs = null;
    }
    this.pairs = pairs;
    for (const k of Object.keys(opts)) {
      if (!SEG_KEYS.includes(k)) warn(`segments: no option '${k}' — fade, color, opacity and blend are the knobs`);
    }
    this._color = opts.color ?? '#8899ff';
    this._opacity = opts.opacity ?? 1;
    this._blend = opts.blend ?? 'over';
    this._fade = opts.fade ?? true;
    this._fillA = opts.fill === true ? 0.12 : opts.fill || 0;
    this._lit = !!opts.lit;
    this._pos = [0, 0, 0];
    this._rot = [0, 0, 0];
    this._scale = [1, 1, 1];
    this._built = false;
  }

  material(o = {}) {
    if (typeof o === 'string') {
      warn('segments: presets shade surfaces — color and opacity are the material on a line');
      return this;
    }
    for (const k of Object.keys(o)) {
      if (k === 'color') this._color = o.color;
      else if (k === 'opacity') this._opacity = o.opacity;
      else warn(`segments: color and opacity are the material here — '${k}' does nothing on a line`);
    }
    return this;
  }
  blend(mode = 'over') {
    if (!BLENDS[mode]) { warn(`segments: blend is 'over' or 'add' — got ${JSON.stringify(mode)}`); return this; }
    this._blend = mode;
    return this;
  }
  position(x = 0, y = 0, z = 0) { this._pos = [x, y, z]; return this; }
  rotation(x = 0, y = 0, z = 0) { this._rot = [x, y, z]; return this; }
  scale(x = 1, y, z) { this._scale = [x, y ?? x, z ?? x]; return this; }

  out(name) {
    if (this._built) {
      warn('segments: already in the scene — one .out() per segments()');
      return this;
    }
    this._built = true;
    const engine = this.engine;
    const pairs = this.pairs;
    const lit = this._lit;
    const geometry = new THREE.BufferGeometry();
    const flat = {
      color: makeColor(this._color),
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: BLENDS[this._blend],
    };
    // lit: the scene's lights shade the lines and fills instead of a flat
    // color. A line vertex takes a radial normal off the cloud's centroid —
    // a web wrapping a volume faces outward — and a fill takes its face's.
    const material = lit
      ? new THREE.MeshStandardMaterial({ ...flat, roughness: 0.5, metalness: 0 })
      : new THREE.LineBasicMaterial(flat);
    const mesh = new THREE.LineSegments(geometry, material);
    // positions change every frame; three can't know the bounds
    mesh.frustumCulled = false;
    let cap = 0;
    const color = this._color, opacity = this._opacity, fade = this._fade, fillA = this._fillA;

    // fill: the triangles, as their own soft mesh — drawn first so the
    // lines stay crisp over it
    let fill = null;
    if (fillA) {
      const g = new THREE.BufferGeometry();
      const side = { side: THREE.DoubleSide };
      const m = lit
        ? new THREE.MeshStandardMaterial({ ...flat, ...side, roughness: 0.5, metalness: 0 })
        : new THREE.MeshBasicMaterial({ ...flat, ...side });
      fill = { mesh: new THREE.Mesh(g, m), g, m, cap: 0 };
      // one Color between the two materials, so an animated color moves both
      fill.m.color = material.color;
      fill.mesh.frustumCulled = false;
      fill.mesh.renderOrder = -1;
      mesh.add(fill.mesh);
    }
    // lit with nothing to light is an invisible sketch — checked on the
    // first real frame, when the whole patch is in the scene
    let litChecked = !lit;
    const t0 = engine.time;

    const updater = (t) => {
      if (isDynamicColor(color)) setColor(material.color, color, t);
      material.opacity = resolve(opacity, t);
      const live = pairs ? pairs.count : 0;
      if (live > cap) {
        cap = Math.max(live, cap * 2, 256);
        geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cap * 6), 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(cap * 8), 4));
        if (lit) geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(cap * 6), 3));
        for (const attr of Object.values(geometry.attributes)) attr.setUsage(THREE.DynamicDrawUsage);
      }
      if (cap) {
        const pp = geometry.attributes.position.array;
        const pc = geometry.attributes.color.array;
        const pn = lit ? geometry.attributes.normal.array : null;
        const a = pairs.a, b = pairs.b ?? pairs.a;
        const doFade = resolve(fade, t);
        // centroid of the living cloud, for the radial line normals
        let cx = 0, cy = 0, cz = 0;
        if (pn) {
          let cn = 0;
          for (const s of b === a ? [a] : [a, b]) {
            for (let i = 0; i < s._n; i++) {
              if (s._alp && s._alp[i] <= 0) continue;
              cx += s._pts[i * 3]; cy += s._pts[i * 3 + 1]; cz += s._pts[i * 3 + 2];
              cn++;
            }
          }
          if (cn) { cx /= cn; cy /= cn; cz /= cn; }
        }
        for (let k = 0; k < live; k++) {
          const i = pairs._pa[k], j = pairs._pb[k];
          pp[k * 6] = a._pts[i * 3]; pp[k * 6 + 1] = a._pts[i * 3 + 1]; pp[k * 6 + 2] = a._pts[i * 3 + 2];
          pp[k * 6 + 3] = b._pts[j * 3]; pp[k * 6 + 4] = b._pts[j * 3 + 1]; pp[k * 6 + 5] = b._pts[j * 3 + 2];
          // each end fades with its own point, both with the distance
          const d = doFade ? 1 - pairs._pd[k] / pairs._within : 1;
          pc[k * 8] = pc[k * 8 + 1] = pc[k * 8 + 2] = 1;
          pc[k * 8 + 3] = d * (a._alp ? a._alp[i] : 1);
          pc[k * 8 + 4] = pc[k * 8 + 5] = pc[k * 8 + 6] = 1;
          pc[k * 8 + 7] = d * (b._alp ? b._alp[j] : 1);
          if (pn) {
            for (let c = 0; c < 2; c++) {
              const vb = k * 6 + c * 3;
              let nx = pp[vb] - cx, ny = pp[vb + 1] - cy, nz = pp[vb + 2] - cz;
              const len = Math.hypot(nx, ny, nz);
              if (len > 1e-9) { nx /= len; ny /= len; nz /= len; } else { nx = 0; ny = 1; nz = 0; }
              pn[vb] = nx; pn[vb + 1] = ny; pn[vb + 2] = nz;
            }
          }
        }
        for (const attr of Object.values(geometry.attributes)) attr.needsUpdate = true;
      }
      geometry.setDrawRange(0, live * 2);
      if (fill && pairs) {
        pairs._triBuild();
        const tn = pairs._tn;
        if (tn > fill.cap) {
          fill.cap = Math.max(tn, fill.cap * 2, 256);
          fill.g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(fill.cap * 9), 3));
          fill.g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(fill.cap * 12), 4));
          if (lit) fill.g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(fill.cap * 9), 3));
          for (const attr of Object.values(fill.g.attributes)) attr.setUsage(THREE.DynamicDrawUsage);
        }
        if (fill.cap) {
          const fp = fill.g.attributes.position.array;
          const fc = fill.g.attributes.color.array;
          const fn = lit ? fill.g.attributes.normal.array : null;
          const a = pairs.a, fa = resolve(fillA, t);
          const doFade = resolve(fade, t);
          for (let k = 0; k < tn; k++) {
            // each corner fades with its own point, the face with its widest edge
            const w = fa * (doFade ? 1 - pairs._td[k] / pairs._within : 1);
            for (let c = 0; c < 3; c++) {
              const i = c === 0 ? pairs._ta[k] : c === 1 ? pairs._tb[k] : pairs._tc[k];
              const vb = k * 9 + c * 3, cb = k * 12 + c * 4;
              fp[vb] = a._pts[i * 3]; fp[vb + 1] = a._pts[i * 3 + 1]; fp[vb + 2] = a._pts[i * 3 + 2];
              fc[cb] = fc[cb + 1] = fc[cb + 2] = 1;
              fc[cb + 3] = w * (a._alp ? a._alp[i] : 1);
            }
            if (fn) {
              const vb = k * 9;
              const ux = fp[vb + 3] - fp[vb], uy = fp[vb + 4] - fp[vb + 1], uz = fp[vb + 5] - fp[vb + 2];
              const vx = fp[vb + 6] - fp[vb], vy = fp[vb + 7] - fp[vb + 1], vz = fp[vb + 8] - fp[vb + 2];
              let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
              const len = Math.hypot(nx, ny, nz);
              if (len > 1e-12) { nx /= len; ny /= len; nz /= len; } else { nx = 0; ny = 1; nz = 0; }
              for (let c = 0; c < 3; c++) { fn[vb + c * 3] = nx; fn[vb + c * 3 + 1] = ny; fn[vb + c * 3 + 2] = nz; }
            }
          }
          for (const attr of Object.values(fill.g.attributes)) attr.needsUpdate = true;
        }
        fill.g.setDrawRange(0, tn * 3);
        fill.m.opacity = material.opacity;
      }
      if (!litChecked && t !== t0) {
        litChecked = true;
        let any = false;
        engine.scene.traverse((o) => { any ||= o.isLight; });
        if (!any) warn('link: lit finds no lights in the scene, so the lines render black — add directional()/point()/spot()/ambient(), or drop lit');
      }
      mesh.position.set(...resolve3(this._pos, t));
      mesh.rotation.set(...resolve3(this._rot, t));
      mesh.scale.set(...resolve3(this._scale, t));
    };

    updater(engine.time);
    if (name != null) {
      const layer = engine.geoLayer(String(name));
      mesh.layers.set(layer);
      fill?.mesh.layers.set(layer);
    }
    engine.add(mesh, updater);
    return this;
  }
}

SegmentsOp.prototype.pos = SegmentsOp.prototype.position;
SegmentsOp.prototype.rot = SegmentsOp.prototype.rotation;
