import { warn } from './warn.js';
import { sig } from './audio.js';
import { Layout } from './layout.js';

// A path through space as a callable value: c(u) is the point a fraction u of
// the way along, so c(T.mul(0.2)) rides it and c(i / n) is the i-th of n
// stations. Direction, start and easing all live in the phase — negate it to
// go the other way, .add() to start elsewhere — so a curve has no knobs of
// its own beyond its geometry. Closed curves wrap u, open ones stop at the
// ends. spread(n) below makes the phase sets a curve eats.

const resolve = (v, t) => (typeof v === 'function' ? v(t) : v);
const isFn = (v) => typeof v === 'function';

// in scope for sketches as `Curve` — same guard as Data and Layout
export function Curve() {
  throw new Error('new Curve() is not how a path starts — curve(u => …), curve.circle(r) or curve(layout) make one');
}
Curve.prototype = Object.create(Function.prototype);
Curve.prototype.constructor = Curve;

// f(u, t) -> [x, y, z] with u already wrapped/clamped; dynamic = t changes
// the answer (an animated radius, a moving layout), which decides between
// plain numbers and signals when the curve is called.
function mk(f, { closed = false, dynamic = false } = {}) {
  const wrap = closed
    ? (u) => u - Math.floor(u)
    : (u) => Math.min(Math.max(u, 0), 1);
  const call = (u) => evaluate(f, wrap, dynamic, u);
  Object.setPrototypeOf(call, Curve.prototype);
  call._f = f;
  call._wrap = wrap;
  call._dynamic = dynamic;
  call.closed = closed;
  return call;
}

// Numbers in, numbers out while nothing moves; a signal phase or an animated
// parameter and the triple comes back as signals instead, which .position()
// and friends resolve per frame. The three share one memoized eval, so a
// frame costs one call, not three.
function evaluate(f, wrap, dynamic, u) {
  if (!isFn(u) && !dynamic) return f(wrap(Number(u) || 0), 0);
  let at = null, v = [0, 0, 0];
  const ev = (t) => {
    if (at !== t) { at = t; v = f(wrap(Number(resolve(u, t)) || 0), t); }
    return v;
  };
  return [sig((t) => ev(t)[0]), sig((t) => ev(t)[1]), sig((t) => ev(t)[2])];
}

// direction of travel at u, unit length — what .align() wants
Curve.prototype.tangent = function (u) {
  const f = this._f, wrap = this._wrap;
  const e = 1e-3;
  const tan = (uu, t) => {
    const a = f(wrap(uu - e), t), b = f(wrap(uu + e), t);
    const x = b[0] - a[0], y = b[1] - a[1], z = b[2] - a[2];
    const len = Math.hypot(x, y, z);
    return len > 1e-9 ? [x / len, y / len, z / len] : [0, 1, 0];
  };
  return evaluate(tan, wrap, this._dynamic, u);
};

const vec3 = (v, d) => (Array.isArray(v) ? [v[0] ?? d[0], v[1] ?? d[1], v[2] ?? d[2]] : d);
const dyn3 = (v) => v.some(isFn);

// closed, on the plane perpendicular to axis; starts on +X heading toward +Z
export function curveCircle(radius = 1, o = {}) {
  if (radius !== null && typeof radius === 'object') { o = radius; radius = o.radius ?? 1; }
  const center = vec3(o.center, [0, 0, 0]);
  let axis = o.axis ?? 'y';
  if (!['x', 'y', 'z'].includes(axis)) { warn(`curve.circle: no axis '${axis}' — x, y or z; using y`); axis = 'y'; }
  const dynamic = isFn(radius) || dyn3(center);
  const f = (u, t) => {
    const r = Number(resolve(radius, t)) || 0;
    const a = u * Math.PI * 2;
    const c = Math.cos(a) * r, s = Math.sin(a) * r;
    const cx = Number(resolve(center[0], t)) || 0;
    const cy = Number(resolve(center[1], t)) || 0;
    const cz = Number(resolve(center[2], t)) || 0;
    return axis === 'y' ? [cx + c, cy, cz + s]
      : axis === 'z' ? [cx + c, cy + s, cz]
        : [cx, cy + c, cz + s];
  };
  return mk(f, { closed: true, dynamic });
}

export function curveLine(a = [0, 0, 0], b = [0, 1, 0]) {
  if ((a != null && !Array.isArray(a)) || (b != null && !Array.isArray(b))) {
    warn('curve.line: two ends — curve.line([x, y, z], [x, y, z])');
  }
  a = vec3(a, [0, 0, 0]);
  b = vec3(b, [0, 1, 0]);
  const dynamic = dyn3(a) || dyn3(b);
  const f = (u, t) => {
    const out = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      const av = Number(resolve(a[k], t)) || 0, bv = Number(resolve(b[k], t)) || 0;
      out[k] = av + (bv - av) * u;
    }
    return out;
  };
  return mk(f, { dynamic });
}

// open, rising along Y through the origin; u = 0 the bottom, 1 the top
export function curveHelix(o = {}) {
  const { radius = 1, height = 2, turns = 3 } = o ?? {};
  const dynamic = isFn(radius) || isFn(height) || isFn(turns);
  const f = (u, t) => {
    const r = Number(resolve(radius, t)) || 0;
    const a = u * (Number(resolve(turns, t)) || 0) * Math.PI * 2;
    return [Math.cos(a) * r, (u - 0.5) * (Number(resolve(height, t)) || 0), Math.sin(a) * r];
  };
  return mk(f, { dynamic });
}

// --- arc length ------------------------------------------------------------
// { cum, total, m }: cumulative length over m segments. lutSeg inverts it —
// the fractional segment index where a fraction u of the total length lands —
// which is what keeps equal steps of u covering equal distance.

function lutSeg({ cum, total, m }, u) {
  if (!(total > 0)) return u * m;
  const target = u * total;
  let lo = 0, hi = m;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= target) lo = mid; else hi = mid;
  }
  const seg = cum[lo + 1] - cum[lo];
  return lo + (seg > 0 ? (target - cum[lo]) / seg : 0);
}

// point(s) -> [x, y, z] over m segments' worth of samples (m + 1 asks)
function buildLut(point, m) {
  const cum = new Float32Array(m + 1);
  let total = 0;
  let prev = point(0);
  for (let s = 1; s <= m; s++) {
    const p = point(s);
    total += Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]);
    cum[s] = total;
    prev = p;
  }
  return { cum, total, m };
}

// built once for a still curve, per frame for a moving one
function lutCache(build, dynamic) {
  let at = null, lut = null;
  return (t) => {
    if (lut && (!dynamic || at === t)) return lut;
    at = t;
    lut = build(t);
    return lut;
  };
}

const LUT_N = 256;

// --- the lift and the layout adapter ---------------------------------------

export function makeCurve(src, o = {}) {
  if (src instanceof Layout) return layoutCurve(src, o);
  if (!isFn(src)) {
    warn('curve: takes a u => [x, y, z], or a layout — curve.circle(r), curve.line(a, b) and curve.helix({ … }) are the built-ins');
    return mk(() => [0, 0, 0]);
  }
  const closed = !!o.closed;
  const dynamic = src.length >= 2;   // fn(u, t) declares it moves
  let warned = false;
  const raw = (u, t) => {
    let v = null;
    try { v = src(u, t); } catch (e) {
      if (!warned) { warned = true; warn(`curve: the fn threw — ${e.message ?? e}`); }
    }
    if (v == null || typeof v !== 'object') {
      if (!warned) { warned = true; warn('curve: the fn returns a point — [x, y, z], or anything with x/y/z'); }
      return [0, 0, 0];
    }
    return Array.isArray(v)
      ? [Number(v[0]) || 0, Number(v[1]) || 0, Number(v[2]) || 0]
      : [Number(v.x) || 0, Number(v.y) || 0, Number(v.z) || 0];
  };
  if (!o.even) return mk(raw, { closed, dynamic });
  const lut = lutCache((t) => buildLut((s) => raw(s / LUT_N, t), LUT_N), dynamic);
  return mk((u, t) => raw(lutSeg(lut(t), u) / LUT_N, t), { closed, dynamic });
}

// The trail an unbranched layout walked, as a curve: a polyline through its
// places, parameterized by distance along it so a rule that shrinks its steps
// doesn't bunch the phase. Filtered views follow their own copies.
function layoutCurve(l, o = {}) {
  const root = l._root ?? l;
  const b = root._b;
  if (b.nodes.length > 1) {
    warn("curve: the layout branches, so there's no single path — following the copies in placement order");
  }
  if (l.count < 2) {
    warn(`curve: the layout placed ${l.count === 1 ? 'one copy' : 'no copies'} — a rule builds the path with e.place() each step`);
  }
  const closed = !!o.closed;
  const dynamic = !!b.dynamic;
  const n = l.count;
  const point = (i) => {
    const j = l._srcIndex(i % n) * 3;
    const p = root._pos;
    return [p[j], p[j + 1], p[j + 2]];
  };
  const m = Math.max(n - 1 + (closed ? 1 : 0), 1);
  const lut = lutCache((t) => { root._replay(t); return buildLut(point, m); }, dynamic);
  const f = (u, t) => {
    if (!n) return [0, 0, 0];
    root._replay(t);
    if (n === 1) return point(0);
    const s = lutSeg(lut(t), u);
    const i = Math.min(Math.floor(s), m - 1);
    const fr = s - i;
    const a = point(i), c = point(i + 1);
    return [a[0] + (c[0] - a[0]) * fr, a[1] + (c[1] - a[1]) * fr, a[2] + (c[2] - a[2]) * fr];
  };
  return mk(f, { closed, dynamic });
}

// --- spread ----------------------------------------------------------------
// n phases 0..1, evenly spaced — the values to feed a curve: spread(12).map(c)
// is twelve points along it. Even runs i/n, phase-style, so a closed curve
// gets no duplicate at the seam; end: true runs i/(n-1) instead — fence posts
// on an open curve. jitter roughs the spacing, random scatters it, both
// deterministic by seed.
export function spread(n = 12, o = {}) {
  n = Math.floor(n);
  if (!(n >= 1)) { warn(`spread: how many values? — got ${JSON.stringify(n)}, using 12`); n = 12; }
  if (n > 100000) { warn('spread: capped at 100000 values'); n = 100000; }
  const { jitter = 0, random = false, seed = 0, end = false } = o ?? {};
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    if (random) out[i] = hash(i, seed);
    else {
      const u = end ? (n === 1 ? 0 : i / (n - 1)) : i / n;
      out[i] = jitter ? u + ((hash(i, seed) - 0.5) * jitter) / n : u;
    }
  }
  return out;
}

// deterministic per (i, seed), like layout's hashRand
function hash(i, seed) {
  let x = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
  x = Math.imul(x ^ ((seed * 1e6) | 0), 0xc2b2ae35);
  x = Math.imul(x ^ 0x27d4eb2f, 0x165667b1);
  x ^= x >>> 15;
  return (x >>> 0) / 4294967296;
}
