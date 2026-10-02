import { ChannelData } from './link.js';
import { carried, isClaiming } from './carry.js';
import { site } from './profile.js';
import { warn } from './warn.js';

// Blob tracking: the bright regions of a chain, found on the CPU and followed
// from frame to frame.
//
// Two halves worth keeping apart. Detection is stateless — one readback,
// connected components, a list of regions. Tracking is all the state: which
// region is the blob that was here last frame, which slot that blob holds, and
// the id it keeps until it dies. .instance() wants the slot, because an instance
// count is fixed up front and per-copy state (a seeded .noise(), a smoothed
// value) only behaves if a blob stays in the copy it started in. A sketch
// coloring blobs wants the id, because a slot outlives its occupant and the
// newcomer shouldn't inherit the dead blob's look.
//
// The readback rides .field()'s pass and inherits its contract: one small
// square buffer a frame, read on the CPU, so what a sketch sees is last frame's
// picture. Everything here is measured in frame units — y spans -0.5..0.5, x
// carries the aspect — which is the space a texture copy already draws in; a 3D
// sketch sizes that up with { scale }.

export const MAX_SLOTS = 64;
const RES_MIN = 16;
const RES_MAX = 256;
// Regions past this in one frame are speckle however the threshold was set, and
// matching them all would cost more than the picture they came from.
const MAX_REGIONS = 256;

// --- connected components ---------------------------------------------------

// Union-find over provisional labels, path-compressed on the way up: the row
// scan below hands out a label per run of bright pixels and only finds out
// later which runs were the same region.
function find(p, a) {
  let r = a;
  while (p[r] !== r) r = p[r];
  while (p[a] !== r) { const next = p[a]; p[a] = r; a = next; }
  return r;
}

// merge b's root into a's, answering the root that survives; -1 is "no label
// here", which is most of what a mask's neighbors are
function join(p, a, b) {
  if (b < 0) return a;
  const rb = find(p, b);
  if (a < 0) return rb;
  const ra = find(p, a);
  if (ra === rb) return ra;
  const lo = ra < rb ? ra : rb;
  p[ra < rb ? rb : ra] = lo;
  return lo;
}

// Scratch sized to the readback and reused every frame: a label per pixel, the
// union-find, and one accumulator per label. Allocated for the worst case (a
// label per pixel) rather than guessed at — 128² of them is 64KB a channel.
function makeScratch(n) {
  const px = n * n;
  return {
    n,
    px,
    luma: new Float32Array(px),
    bins: new Int32Array(258),
    label: new Int32Array(px),
    parent: new Int32Array(px),
    cnt: new Int32Array(px),
    sx: new Float64Array(px),
    sy: new Float64Array(px),
    sxx: new Float64Array(px),
    syy: new Float64Array(px),
    sxy: new Float64Array(px),
    x0: new Int32Array(px),
    x1: new Int32Array(px),
    y0: new Int32Array(px),
    y1: new Int32Array(px),
  };
}

// One level's regions, pixels brighter than the cut grouped 8-connected.
// Rows run bottom-up out of readPixels, which is already uv's v — so y here is
// the frame's y, no flip.
//
// Second moments ride along with the sums: they're what the long axis comes
// from, and accumulating them costs a multiply per pixel against a second pass
// over the region.
function detect(sc, threshold, aspect, level, out) {
  const { n, px, luma, label, parent, cnt, sx, sy, sxx, syy, sxy, x0, x1, y0, y1 } = sc;
  let next = 0;
  for (let y = 0, i = 0; y < n; y++) {
    for (let x = 0; x < n; x++, i++) {
      if (luma[i] < threshold) { label[i] = -1; continue; }
      // west, north-west, north, north-east: the neighbors already labeled
      let a = x > 0 ? join(parent, -1, label[i - 1]) : -1;
      if (y > 0) {
        if (x > 0) a = join(parent, a, label[i - n - 1]);
        a = join(parent, a, label[i - n]);
        if (x < n - 1) a = join(parent, a, label[i - n + 1]);
      }
      if (a < 0) { a = next; parent[next] = next; cnt[next] = 0; next++; }
      label[i] = a;
    }
  }

  // Second pass: every pixel onto its final root. cnt doubles as "this root has
  // been seen", so only the labels this frame actually handed out are cleared.
  const roots = [];
  for (let y = 0, i = 0; y < n; y++) {
    for (let x = 0; x < n; x++, i++) {
      const l = label[i];
      if (l < 0) continue;
      const r = find(parent, l);
      if (cnt[r] === 0) {
        roots.push(r);
        sx[r] = sy[r] = sxx[r] = syy[r] = sxy[r] = 0;
        x0[r] = x1[r] = x;
        y0[r] = y1[r] = y;
      }
      cnt[r]++;
      sx[r] += x; sy[r] += y;
      sxx[r] += x * x; syy[r] += y * y; sxy[r] += x * y;
      if (x < x0[r]) x0[r] = x; else if (x > x1[r]) x1[r] = x;
      if (y < y0[r]) y0[r] = y; else if (y > y1[r]) y1[r] = y;
    }
  }

  for (const r of roots) {
    const c = cnt[r];
    // left clean for the next call, since a root is recognized as new by
    // cnt === 0 — so this runs for every root the scan found, whatever the
    // loop does with it below
    cnt[r] = 0;
    // under three pixels there is no centroid worth trusting, only noise.
    // The cap is generous here — this list is one cut's worth of a sweep, and
    // the grouping above it does the real narrowing.
    if (c < 3 || out.length >= MAX_REGIONS * 4) continue;
    const cx = sx[r] / c, cy = sy[r] / c;
    // about the centroid, in pixels — scale-free, so the angle doesn't care
    // what res the readback ran at
    const mxx = sxx[r] / c - cx * cx;
    const myy = syy[r] / c - cy * cy;
    const mxy = sxy[r] / c - cx * cy;
    out.push({
      // pixel centers to 0..1, then to frame units: x carries the aspect, both
      // centered. The aspect belongs here because the readback is square — a
      // widescreen frame is squeezed into it and comes back out on read.
      u: (cx + 0.5) / n,
      v: (cy + 0.5) / n,
      area: c / px,
      // the bbox spans pixel edges, hence the +1 — a one-pixel blob is one
      // pixel wide, not zero
      w: (x1[r] - x0[r] + 1) / n,
      h: (y1[r] - y0[r] + 1) / n,
      // The axis the region is longest along. Doubled, because an axis repeats
      // every half turn and this is what stays continuous through the wrap.
      //
      // Stretched back out first: the readback is square, so a widescreen frame
      // reaches these moments squeezed, and an axis measured in that space
      // isn't the angle it has in the frame. Scaling x by a scales mxx by a²
      // and mxy by a.
      c2: mxx * aspect * aspect - myy,
      s2: 2 * mxy * aspect,
      level,
      taken: false,
    });
  }
  return out;
}

// All the frame's regions: the luma plane once, then detect() at each cut of
// the sweep and the detections grouped across cuts by where they sit.
//
// One cut only sees what crosses it — a dim feature and a bright one never
// share a threshold, which is why a single-threshold tracker needs tuning per
// scene. Sweeping a range and keeping what shows up at two or more cuts finds
// features at every brightness and throws away what only ever flickered at
// one. A sketch that passes `threshold` gets the single exact cut instead —
// right for a mask that is already binary, where every cut agrees anyway.
function detectAll(sc, data, levels, minRep, band, aspect, dark, out) {
  const { n, px, luma, bins } = sc;
  bins.fill(0);
  for (let i = 0, j = 0; i < px; i++, j += 4) {
    // the same luma .field() reads, so a cut here means what it means there
    const l0 = (0.2126 * data[j] + 0.7152 * data[j + 1] + 0.0722 * data[j + 2]) / 255;
    // dark blobs are bright luma flipped on the way in — free, where an
    // .invert() on the chain would cost a full-frame pass
    const l = dark ? 1 - l0 : l0;
    luma[i] = l;
    bins[(l * 255) | 0]++;
  }
  // suffix sums: how many pixels sit at or above each bin. Brightness sets
  // nest as the cut rises, so two cuts selecting the same number of pixels
  // select the same pixels — and the same regions. A mask that is already
  // binary sweeps at the cost of one cut, and a frame with nothing over a cut
  // pays nothing for it or for any cut above.
  for (let b = 255; b >= 0; b--) bins[b] += bins[b + 1];

  const found = [];
  let prev = -1;
  for (let k = 0; k < levels.length; k++) {
    const atLeast = bins[Math.min(255, Math.ceil(levels[k] * 255))];
    if (atLeast < 3) break;
    if (atLeast === prev) continue;
    prev = atLeast;
    detect(sc, levels[k], aspect, k, found);
  }

  // Group across cuts: a detection joins the nearest cluster within reach of
  // its centre, or starts one. The same feature crossed by five cuts lands in
  // one cluster five members deep.
  const reach = Math.max(0.02, 2 / n);
  const clusters = [];
  for (const r of found) {
    const rx = (r.u - 0.5) * aspect, ry = r.v - 0.5;
    let best = null, bd = reach;
    for (const c of clusters) {
      const d = Math.hypot(c.x / c.k - rx, c.y / c.k - ry);
      if (d < bd) { bd = d; best = c; }
    }
    if (best) { best.x += rx; best.y += ry; best.k++; best.members.push(r); }
    else if (clusters.length < MAX_REGIONS * 2) clusters.push({ x: rx, y: ry, k: 1, members: [r] });
  }

  out.length = 0;
  for (const c of clusters) {
    if (c.members.length < minRep) continue;
    // the middle cut's geometry, which is the feature at neither its most
    // swollen nor its most eroded; the centre is the cluster's own mean
    c.members.sort((a, b) => a.level - b.level);
    const m = c.members[c.members.length >> 1];
    const ext = Math.sqrt(Math.max(0, m.area * aspect));
    if (ext < band[0] || ext > band[1]) continue;
    out.push({
      u: c.x / c.k / aspect + 0.5,
      v: c.y / c.k + 0.5,
      area: m.area,
      w: m.w,
      h: m.h,
      c2: m.c2,
      s2: m.s2,
      taken: false,
    });
    if (out.length >= MAX_REGIONS) break;
  }
  // biggest first: when there are more blobs than slots, the slots go to the
  // regions most likely to be what the sketch is about
  out.sort((a, b) => b.area - a.area);
  return out;
}

// --- tracking ---------------------------------------------------------------

const lagK = (tau, dt) => (tau > 0 ? 1 - Math.exp(-dt / tau) : 1);

// A slot's occupant. Position and size are smoothed (measurement is noisy at
// this res and a jittering copy reads as a bug); the axis is smoothed as a
// vector, since averaging the angle itself would fight the wrap.
const newBlob = (id, t, r, aspect) => ({
  id,
  born: t,
  seen: t,
  x: (r.u - 0.5) * aspect,
  y: r.v - 0.5,
  vx: 0,
  vy: 0,
  area: r.area,
  w: r.w * aspect,
  h: r.h,
  c2: r.c2,
  s2: r.s2,
});

// The per-sketch state that has to outlive a re-run: ids, slots and whatever
// each slot has smoothed so far. Editing a threshold mustn't renumber the
// blobs or snap every copy back to where it started.
const newState = () => ({ slots: [], nextId: 0, t: null, live: 0 });

function update(st, regions, max, t, aspect, o) {
  const dt = st.t == null ? 0 : Math.max(0, Math.min(0.25, t - st.t));
  st.t = t;
  const slots = st.slots;
  slots.length = max;
  for (let i = 0; i < max; i++) if (slots[i] === undefined) slots[i] = null;

  // Every slot-to-region distance under the gate, nearest pair first — a greedy
  // pass over that is enough at these counts and, unlike nearest-region-wins,
  // two blobs crossing don't both grab the same region.
  //
  // Measured against where the blob was heading rather than where it was, so a
  // fast hand is matched by its own speed instead of needing a gate wide enough
  // to catch anything on the other side of the frame.
  const pairs = [];
  const gate = o.gate;
  for (let i = 0; i < max; i++) {
    const b = slots[i];
    if (!b) continue;
    const px = b.x + b.vx * dt;
    const py = b.y + b.vy * dt;
    for (let k = 0; k < regions.length; k++) {
      const r = regions[k];
      const dx = (r.u - 0.5) * aspect - px;
      const dy = r.v - 0.5 - py;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d <= gate) pairs.push({ i, k, d });
    }
  }
  pairs.sort((a, b) => a.d - b.d);

  const matched = new Uint8Array(max);
  for (const p of pairs) {
    if (matched[p.i] || regions[p.k].taken) continue;
    matched[p.i] = 1;
    regions[p.k].taken = true;
    const b = slots[p.i];
    const r = regions[p.k];
    const k = lagK(o.smooth, dt);
    const tx = (r.u - 0.5) * aspect;
    const ty = r.v - 0.5;
    const wasX = b.x, wasY = b.y;
    b.x += (tx - b.x) * k;
    b.y += (ty - b.y) * k;
    if (dt > 0) {
      // from the smoothed track, not the raw measurement: velocity off noisy
      // centroids divided by a small dt is mostly noise, and this is what the
      // gate above steers by
      const vk = lagK(Math.max(o.smooth, 0.08), dt);
      b.vx += ((b.x - wasX) / dt - b.vx) * vk;
      b.vy += ((b.y - wasY) / dt - b.vy) * vk;
    }
    b.area += (r.area - b.area) * k;
    b.w += (r.w * aspect - b.w) * k;
    b.h += (r.h - b.h) * k;
    b.c2 += (r.c2 - b.c2) * k;
    b.s2 += (r.s2 - b.s2) * k;
    b.seen = t;
  }

  // A detection dropping out for a frame or two is the threshold flickering on
  // an edge, not the blob leaving. Its slot coasts on the last known pose for
  // `hold` seconds before the slot is free again — the copy holds still instead
  // of blinking out and back.
  for (let i = 0; i < max; i++) {
    const b = slots[i];
    if (!b || matched[i]) continue;
    if (t - b.seen > o.hold) slots[i] = null;
  }

  // Whatever is left over is new. The lowest free slot, so a sketch reading
  // slot 0 gets the blob that has been there longest rather than a shuffle.
  for (const r of regions) {
    if (r.taken) continue;
    let slot = -1;
    for (let i = 0; i < max; i++) if (!slots[i]) { slot = i; break; }
    if (slot < 0) break;
    slots[slot] = newBlob(st.nextId++, t, r, aspect);
  }

  let live = 0;
  for (let i = 0; i < max; i++) if (slots[i]) live++;
  st.live = live;
}

// --- the producer -----------------------------------------------------------

// What a sketch holds. Reads are per slot and answer a resting value when the
// slot is empty, rather than null — a sketch doing arithmetic on a blob that
// just left gets a number, which is the same bargain .field() makes.
export class Blobs {
  constructor(engine, node, o = {}) {
    if (engine == null) {
      throw new Error('new Blobs() is not how tracking starts — track(video()) follows the bright regions of a chain');
    }
    this.engine = engine;
    this._max = clampInt(o.max, 8, 1, MAX_SLOTS);
    this._scale = num(o.scale, 1);
    this._aspect = 1;
    this._set = null;
    this._st = carried('blobs', newState);
    const res = clampInt(o.res, 128, RES_MIN, RES_MAX);
    const opts = {
      smooth: Math.max(0, num(o.smooth, 0.05)),
      hold: Math.max(0, num(o.hold, 0.25)),
      gate: Math.max(0.001, num(o.gate, 0.2)),
    };

    // The cuts. No threshold = sweep the default range; a [lo, hi] sweeps that
    // range instead; one number is one exact cut, for a mask that is already
    // binary. A sweep demands a feature show up at two cuts, a single cut has
    // only itself.
    const clamp01 = (v, d) => Math.min(1, Math.max(0, num(v, d)));
    let levels;
    if (Array.isArray(o.threshold)) {
      const lo = clamp01(o.threshold[0], 0.2), hi = Math.max(lo, clamp01(o.threshold[1], 0.84));
      const k = clampInt(o.levels, 9, 2, 32);
      levels = Array.from({ length: k }, (_, i) => lo + ((hi - lo) * i) / (k - 1));
    } else if (o.threshold != null) {
      levels = [clamp01(o.threshold, 0.5)];
    } else {
      const k = clampInt(o.levels, 9, 2, 32);
      levels = Array.from({ length: k }, (_, i) => 0.2 + ((0.84 - 0.2) * i) / (k - 1));
    }
    const minRep = levels.length > 1 ? 2 : 1;

    // how big a blob may be and still count, in the units .size(i) answers —
    // a number is the floor alone
    const dark = !!o.dark;
    const rawBand = Array.isArray(o.size) ? o.size : [o.size, undefined];
    const band = [Math.max(0, num(rawBand[0], 0.01)), Math.max(0, num(rawBand[1], Infinity)) || Infinity];

    // nothing to read back (the call was handed something that isn't a chain):
    // the slots stay empty and every read answers resting, rather than the
    // sketch going down over one bad argument
    if (node == null) return;

    // Tracking is state over time, so it has to be the same tracker every
    // frame. Built inside onFrame() it would be a new one each frame — a
    // readback and a fresh set of ids per frame, forever — and could never
    // follow anything anyway. Inert rather than leaking, and said out loud.
    if (!isClaiming()) {
      warn('track: build the tracker in the sketch, not inside onFrame() — one made per frame would register a readback per frame and could never follow a blob from one to the next. const blobs = track(…) at the top level, then read it in the callback.');
      return;
    }

    const sc = makeScratch(res);
    const regions = [];
    // Alongside the .field() readbacks, so tracking costs the one pass they
    // already pay for and the graph runs with no .out() in the sketch.
    engine.textureFields.push({
      node,
      res,
      rt: null,
      data: null,
      // its own row in the profile panel: the readback stall and the sweep
      // both land here, which is where to look when a fan spins up
      site: site('track'),
      after: (data, n, ctx) => {
        this._aspect = ctx.aspect;
        detectAll(sc, data, levels, minRep, band, ctx.aspect, dark, regions);
        update(this._st, regions, this._max, ctx.t, ctx.aspect, opts);
      },
    });
  }

  // how many copies tracking needs: fixed, because an instance count is, and
  // because a blob holding its slot is what keeps per-copy state honest
  get max() { return this._max; }
  get slots() { return this._max; }
  // how many of them have a blob in them right now
  get count() { return this._st.live; }

  _at(i) {
    const k = Math.floor(i);
    return k >= 0 && k < this._max ? this._st.slots[k] ?? null : null;
  }

  has(i) { return this._at(i) != null; }
  // Which blob, ever: a count that starts at 0 and never comes round again, so
  // a look keyed off it can't be inherited by the next blob through the slot.
  // -1 for an empty slot, which no blob has, so it reads as absent in arithmetic.
  id(i) { const b = this._at(i); return b ? b.id : -1; }
  pos(i) {
    const b = this._at(i);
    return b ? [b.x * this._scale, b.y * this._scale, 0] : [0, 0, 0];
  }
  // per second, in the same units as .pos()
  vel(i) {
    const b = this._at(i);
    return b ? [b.vx * this._scale, b.vy * this._scale, 0] : [0, 0, 0];
  }
  // the fraction of the frame it covers, 0..1 — the reading that doesn't care
  // about the frame's shape
  area(i) { const b = this._at(i); return b ? b.area : 0; }
  // its extent, as the side of a square of the same area: steadier than the
  // bounding box, which one stray pixel can stretch
  size(i) {
    const b = this._at(i);
    return b ? Math.sqrt(Math.max(0, b.area * this._aspect)) * this._scale : 0;
  }
  width(i) { const b = this._at(i); return b ? b.w * this._scale : 0; }
  height(i) { const b = this._at(i); return b ? b.h * this._scale : 0; }
  // The axis it lies along, radians, 0 = across the frame. An axis repeats
  // every half turn, so this stays within ±π/2 and a round blob's is whatever
  // noise it had — worth leaning on for an arm, not for a face.
  angle(i) {
    const b = this._at(i);
    return b ? 0.5 * Math.atan2(b.s2, b.c2) : 0;
  }
  // seconds since it arrived — a blob can fade itself in over its first moments
  age(i) {
    const b = this._at(i);
    return b ? Math.max(0, this.engine.time - b.born) : 0;
  }

  // Everything about slot i as one object — index first, then the key, the way
  // a JS reader expects. The properties are live getters reading the slot at
  // access time, so `b.pos` inside any fn of t follows the blob; the one trap
  // is destructuring outside one, which snapshots the moment instead. Views
  // are made once per slot and reused, so reading one allocates nothing.
  at(i) {
    const k = Math.floor(i);
    if (!(k >= 0) || k >= this._max) return null;
    this._atViews ??= [];
    if (!this._atViews[k]) {
      const s = this;
      this._atViews[k] = {
        get has() { return s.has(k); },
        get id() { return s.id(k); },
        get pos() { return s.pos(k); },
        get vel() { return s.vel(k); },
        get size() { return s.size(k); },
        get area() { return s.area(k); },
        get width() { return s.width(k); },
        get height() { return s.height(k); },
        get angle() { return s.angle(k); },
        get age() { return s.age(k); },
        box(o) { return s.box(k, o); },
      };
    }
    return this._atViews[k];
  }

  // The blob's box, as the bundle rect() takes — center in UV, w and h as
  // fractions of the frame — every value a live fn, and the whole thing
  // collapsed to nothing while the slot is empty. rect(blobs.box(i)) draws it;
  // { ...blobs.box(i), thickness: 0.004, bg: null } is its outline. Answered
  // in the frame's own units whatever { scale } says, since this is for
  // texture space, where the frame is the unit. pad grows it on every side,
  // in frame-height units.
  box(i, o = {}) {
    const pad = Math.max(0, num(o.pad, 0));
    return {
      center: [
        () => { const b = this._at(i); return b ? b.x / this._aspect + 0.5 : 0.5; },
        () => { const b = this._at(i); return b ? b.y + 0.5 : 0.5; },
      ],
      w: () => { const b = this._at(i); return b ? (b.w + pad * 2) / this._aspect : 0; },
      h: () => { const b = this._at(i); return b ? b.h + pad * 2 : 0; },
    };
  }

  // The slot holding the biggest blob — the subject, when a sketch only wants
  // one. -1 when nothing is being tracked, so reads off it come back resting.
  largest() {
    let best = -1, area = 0;
    for (let i = 0; i < this._max; i++) {
      const b = this._st.slots[i];
      if (b && b.area > area) { area = b.area; best = i; }
    }
    return best;
  }

  // Places a copy on blob i and hands the handle back, like a layout's .apply()
  // — .instance(blobs) is this call already made. An empty slot hides its copy,
  // and hiding wins over whatever the sketch's own fn does afterward: a copy
  // with no blob in it has no position worth drawing at.
  apply(handle, i, t) {
    const b = this._at(i);
    if (!b) return handle.hide();
    handle.position(b.x * this._scale, b.y * this._scale, 0);
    handle.scale(this.size(i));
    return handle;
  }

  // The blobs as a data set — the slots with something in them, in slot order,
  // so a plexus between them doesn't run lines to the empties. One set per
  // tracker, since the channel it reads is rebuilt per frame anyway.
  _data() {
    this._set ??= new ChannelData(this.engine, { pos: () => {
      const out = [];
      for (let i = 0; i < this._max; i++) if (this._st.slots[i]) out.push(this.pos(i));
      return out;
    } });
    return this._set;
  }

  pairs(other, o) { return this._data().pairs(other, o); }
  link(other, o) { return this._data().link(other, o); }
}

const num = (v, dflt) => (Number.isFinite(Number(v)) ? Number(v) : dflt);
const clampInt = (v, dflt, lo, hi) => Math.min(hi, Math.max(lo, Math.round(num(v, dflt)) || dflt));

export function makeBlobs(engine, src, o = {}) {
  // Any chain, because what counts as a blob is the sketch's call: a brightness
  // threshold on video(), a person() mask, the difference between now and a
  // .delay() of itself. Tracking only ever asks which parts are bright.
  const node = src != null && typeof src.renderNode === 'function' ? src : null;
  if (!node) {
    warn('track: takes a texture chain to follow — track(video().threshold(0.6)), or any chain whose bright parts are the blobs');
  }
  return new Blobs(engine, node, o);
}
