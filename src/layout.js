import * as THREE from 'three';
import { warn } from './warn.js';

// Generative structure: a rule steering a cursor, collected into placed copies.
// See dev-notes/LAYOUT.md for why there is no grammar here.
//
// Two invariants the rest of the file leans on:
//
// Structure is fixed at build (the rule runs once, resolving fns at t=0) while
// pose is live (op arguments that are fns of t re-resolve every frame in
// _replay). So an animated .turn() sways everything grown past it without the
// structure reshuffling underneath.
//
// Nodes expand from a FIFO queue, so a child always has a higher index than its
// parent. _replay walks the node list once in that order and relies on it: a
// parent fills its children's base transforms before they are walked.

const resolve = (v, t) => (typeof v === 'function' ? v(t) : v);

// A runaway rule is the first thing anyone writes, so both budgets truncate and
// say so rather than hanging the tab. Depth only bites a rule that never
// terminates itself; an explicit layout(n, rule) is taken as intent and stays quiet.
const MAX_PLACES = 50000;
const MAX_NODES = 20000;
const DEFAULT_DEPTH = 12;

// heading is local +Y — the axis align()/aim() already treat as a shape's own,
// so a capsule or a box({ height }) points along the branch it's placed on
const AXIS = { turn: new THREE.Vector3(0, 0, 1), pitch: new THREE.Vector3(1, 0, 0), roll: new THREE.Vector3(0, 1, 0) };

const _step = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _walkPos = new THREE.Vector3();
const _walkQuat = new THREE.Quaternion();

// Deterministic in the node's position in the structure, not in call order
// across the build: the same node draws the same value on every re-run, so a
// stochastic rule holds still while the sketch around it is edited.
function hashRand(node, seed, call) {
  let h = Math.imul(node ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ ((seed * 1e6) | 0), 0xc2b2ae35);
  h = Math.imul(h ^ (call + 0x27d4eb2f), 0x165667b1);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

const newNode = (id, depth) => ({
  id,
  depth,
  ops: [],
  // filled by the parent's replay, on the frame it reaches the .branch() that
  // made this node — hence parents before children, which queue order gives
  base: { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), size: 1 },
});

// The `e` a rule is handed: cursor state as live numbers (what the reads answer)
// alongside the op tape (what replay follows). One instance for the whole build,
// re-pointed per node — a rule that branches wide calls this thousands of times.
class Cursor {
  constructor(build) {
    this._b = build;
    this._ops = null;
    this._rule = null;
    this._calls = 0;
    this._node = 0;
    this._depth = 0;
    this._size = 1;
    this._dist = 0;
    this._pos = new THREE.Vector3();
    this._quat = new THREE.Quaternion();
  }

  // --- what the rule can ask ---
  // (getters, so a rule branching on them reads state rather than calling a
  // verb it hasn't got — .position is where the cursor is, .forward() moves it)
  get depth() { return this._depth; }
  get size() { return this._size; }
  get distance() { return this._dist; }
  get position() { return [this._pos.x, this._pos.y, this._pos.z]; }

  // --- what the rule can do ---
  forward(dist = 1) {
    this._ops.push({ k: 0, d: dist });
    if (typeof dist === 'function') this._b.dynamic = true;
    const d = (Number(resolve(dist, 0)) || 0) * this._size;
    this._pos.add(_step.set(0, d, 0).applyQuaternion(this._quat));
    this._dist += Math.abs(d);
    return this;
  }

  // radians, applied in the order given: turn about the cursor's Z, pitch about
  // its X, roll about the heading itself
  turn(angle = 0, pitch = 0, roll = 0) {
    this._ops.push({ k: 1, a: angle, p: pitch, r: roll });
    if (typeof angle === 'function' || typeof pitch === 'function' || typeof roll === 'function') this._b.dynamic = true;
    turnQuat(this._quat, resolve(angle, 0), resolve(pitch, 0), resolve(roll, 0));
    return this;
  }

  // one number: it compounds down the branch, which is what makes .size a
  // reading a rule can stop on
  scale(f = 1, y, z) {
    if (y !== undefined || z !== undefined) {
      warn('layout: the cursor scales by one number, compounding down the branch — for a shape that is longer than it is wide, size the shape instead: box({ width, height, depth })');
    }
    this._ops.push({ k: 2, f });
    if (typeof f === 'function') this._b.dynamic = true;
    this._size *= Number(resolve(f, 0)) || 0;
    return this;
  }

  place(label, data) {
    if (label !== null && typeof label === 'object' && data === undefined) { data = label; label = null; }
    const b = this._b;
    if (b.places.length >= MAX_PLACES) { b.full = true; return this; }
    this._ops.push({ k: 3, i: b.places.length });
    b.places.push({
      label: label == null ? '' : String(label),
      data: data ?? null,
      depth: this._depth,
    });
    return this;
  }

  // Move forward, leaving a copy that spans the step. Centering it on the step
  // rather than on the joint is what keeps segments meeting end to end instead
  // of straddling the joint and crossing each other where a branch forks. A
  // shape one unit long (box({ height: 1 }), capsule()) covers the step exactly.
  span(dist = 1, label, data) {
    const half = typeof dist === 'function' ? (t) => resolve(dist, t) / 2 : dist / 2;
    return this.forward(half).place(label, data).forward(half);
  }

  branch(step, rule) {
    const b = this._b;
    if (this._depth + 1 > b.maxDepth) { b.deep = true; return this; }
    if (b.nodes.length >= MAX_NODES) { b.wide = true; return this; }
    const child = newNode(b.nodes.length, this._depth + 1);
    b.nodes.push(child);
    this._ops.push({ k: 4, child });
    // The parent's own cursor carries on from here untouched — the child runs
    // from a copy, once this rule body has finished.
    b.queue.push({
      node: child,
      step,
      rule: rule ?? this._rule,
      pos: this._pos.clone(),
      quat: this._quat.clone(),
      size: this._size,
      dist: this._dist,
    });
    return this;
  }

  rand(seed = 0) {
    return hashRand(this._node, Number(seed) || 0, this._calls++);
  }
}

function turnQuat(q, a, p, r) {
  if (a) q.multiply(_q.setFromAxisAngle(AXIS.turn, a));
  if (p) q.multiply(_q.setFromAxisAngle(AXIS.pitch, p));
  if (r) q.multiply(_q.setFromAxisAngle(AXIS.roll, r));
}

function runBuild(rule, maxDepth, explicitDepth) {
  const b = {
    places: [], nodes: [], queue: [], maxDepth,
    dynamic: false, full: false, wide: false, deep: false,
  };
  const cur = new Cursor(b);
  const root = newNode(0, 0);
  b.nodes.push(root);
  b.queue.push({ node: root, step: null, rule, pos: null, quat: null, size: 1, dist: 0 });

  // an index rather than shift(), so a wide structure isn't quadratic in its
  // own queue
  for (let head = 0; head < b.queue.length; head++) {
    const job = b.queue[head];
    const node = job.node;
    cur._ops = node.ops;
    cur._rule = job.rule;
    cur._node = node.id;
    cur._depth = node.depth;
    cur._calls = 0;
    cur._size = job.size;
    cur._dist = job.dist;
    if (job.pos) cur._pos.copy(job.pos); else cur._pos.set(0, 0, 0);
    if (job.quat) cur._quat.copy(job.quat); else cur._quat.identity();
    try {
      job.step?.(cur);
      job.rule?.(cur);
    } catch (e) {
      // a rule that throws still leaves whatever it placed before the throw —
      // a half-built structure says more about the mistake than an empty scene
      warn(`layout: the rule threw — ${e.message}`);
    }
  }

  if (b.full) {
    warn(`layout: past the ${MAX_PLACES} copy limit, so the structure is cut short — stop the rule sooner (if (e.size < 0.1) return), or branch less at each step`);
  } else if (b.wide) {
    warn(`layout: past the ${MAX_NODES} branch limit, so the structure is cut short — a rule needs a stop (if (e.size < 0.1) return), or fewer .branch() calls per step`);
  } else if (b.deep && !explicitDepth) {
    warn(`layout: still branching at ${maxDepth} generations, so the structure is cut short — a rule needs its own stop (if (e.size < 0.1) return), or a cap: layout(6, e => …)`);
  }
  return b;
}

// A built structure, and any label-narrowed view of one: same arrays, same
// replay, different index map.
class Layout {
  constructor(engine, build, root, idx) {
    // in scope for sketches as `Layout` — see the same guard on TextureOp
    if (engine == null) {
      throw new Error('new Layout() is not how a structure starts — layout(e => …) builds one');
    }
    this.engine = engine;
    this._b = build;
    this._root = root ?? this;
    this._idx = idx ?? null;
    this.count = idx ? idx.length : build.places.length;
    this._grow = null;
    if (!root) {
      const n = build.places.length;
      this._pos = new Float32Array(n * 3);
      this._rot = new Float32Array(n * 3);
      this._scl = new Float32Array(n);
      this._at = null;
      this._views = new Map();
    }
  }

  // one walk of the tape per frame, not one per copy: .instance() asks count
  // times and every ask wants the same answer
  _replay(t) {
    const b = this._b;
    if (this._at === t || (this._at !== null && !b.dynamic)) return;
    this._at = t;
    const pos = this._pos;
    const rot = this._rot;
    const scl = this._scl;
    for (const node of b.nodes) {
      const p = _walkPos.copy(node.base.pos);
      const q = _walkQuat.copy(node.base.quat);
      let size = node.base.size;
      for (const op of node.ops) {
        switch (op.k) {
          case 0:
            p.add(_step.set(0, (Number(resolve(op.d, t)) || 0) * size, 0).applyQuaternion(q));
            break;
          case 1:
            turnQuat(q, resolve(op.a, t), resolve(op.p, t), resolve(op.r, t));
            break;
          case 2:
            size *= Number(resolve(op.f, t)) || 0;
            break;
          case 3: {
            const i = op.i;
            pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
            _euler.setFromQuaternion(q, 'XYZ');
            rot[i * 3] = _euler.x; rot[i * 3 + 1] = _euler.y; rot[i * 3 + 2] = _euler.z;
            scl[i] = size;
            break;
          }
          default:
            op.child.base.pos.copy(p);
            op.child.base.quat.copy(q);
            op.child.base.size = size;
        }
      }
    }
  }

  // a view's i, as an index into the arrays the root owns
  _srcIndex(i) { return this._idx ? this._idx[i] : i; }

  // Sets a copy's position, rotation and scale from the structure, and hands the
  // handle back so a sketch can carry on with it: .instance(tree, (x, i) =>
  // x.color(…)) is the same thing with the call already made.
  apply(handle, i, t) {
    const r = this._root;
    const now = t ?? this.engine.time;
    r._replay(now);
    const j = this._srcIndex(Math.floor(i));
    if (!(j >= 0) || j >= r._scl.length) return handle;
    handle.position(r._pos[j * 3], r._pos[j * 3 + 1], r._pos[j * 3 + 2]);
    handle.rotation(r._rot[j * 3], r._rot[j * 3 + 1], r._rot[j * 3 + 2]);
    handle.scale(this.size(i, now));
    return handle;
  }

  // The scale the structure placed copy i at, .grow() included — what a chain
  // adding its own scale has to multiply, since .scale() on the handle replaces
  // rather than compounds.
  size(i, t) {
    const r = this._root;
    const now = t ?? this.engine.time;
    r._replay(now);
    const j = this._srcIndex(Math.floor(i));
    if (!(j >= 0) || j >= r._scl.length) return 1;
    const g = this._grow ?? r._grow;
    return g == null ? r._scl[j] : r._scl[j] * growFactor(g, this.ageAt(j), now);
  }

  // Some of the copies as a layout of their own — its own count and order, so
  // each slice wears a chain of its own. A label keeps the copies placed under
  // it; a function keeps the copies it says yes to, handed { label, data,
  // depth } and the copy's index. Composes: tree.filter('leaf').filter(fn)
  // narrows the leaves.
  filter(by) {
    const r = this._root;
    const places = r._b.places;
    const mine = (k) => this._srcIndex(k);
    const n = this.count;
    if (typeof by === 'function') {
      const idx = [];
      for (let k = 0; k < n; k++) {
        const j = mine(k);
        const pl = places[j];
        // a fresh object per ask, so the function can't reach the build's own
        // records; runs once per .filter() call, not per frame
        if (by({ label: pl.label, data: pl.data, depth: pl.depth }, k)) idx.push(j);
      }
      if (!idx.length) warn(`layout: the filter matched none of the ${n} copies`);
      return new Layout(this.engine, r._b, r, idx);
    }
    if (by == null) {
      warn("layout: .filter() takes a label or a function — .filter('leaf'), or .filter(p => p.depth > 3)");
      return this;
    }
    const key = String(by);
    // label views off the whole structure are the common case and are asked
    // for per re-run, so they're kept; a view of a view is built on the spot
    const cache = this === r ? r._views : null;
    let view = cache?.get(key);
    if (!view) {
      const idx = [];
      for (let k = 0; k < n; k++) if (places[mine(k)].label === key) idx.push(mine(k));
      if (!idx.length) {
        const found = [...new Set(Array.from({ length: n }, (_, k) => places[mine(k)].label).filter(Boolean))];
        warn(`layout: nothing placed as '${key}' — ${found.length ? `the labels here are ${found.join(', ')}` : "the rule places copies without a label, so .filter('name') has nothing to keep"}`);
      }
      view = new Layout(this.engine, r._b, r, idx);
      cache?.set(key, view);
    }
    return view;
  }

  // 0..1 by place order, which runs outward a generation at a time
  age(i) { return this.ageAt(this._srcIndex(Math.floor(i))); }
  ageAt(j) {
    const n = this._root._b.places.length;
    return n > 1 ? j / (n - 1) : 0;
  }
  // which generation the copy was placed in
  depth(i) { return this._root._b.places[this._srcIndex(Math.floor(i))]?.depth ?? 0; }
  // whatever .place() was handed alongside its label
  data(i) { return this._root._b.places[this._srcIndex(Math.floor(i))]?.data ?? null; }

  // 0..1 across the whole structure, in place order: copies past the front are
  // scaled away, so a signal here opens it out over time
  grow(amount) {
    this._grow = amount ?? null;
    return this;
  }
}

// A short ramp rather than a hard edge, so copies open out instead of popping.
// The front is stretched by the ramp's own width, so 1 means fully grown — the
// last copy finishes ramping as the amount reaches 1, instead of just past it.
const growFactor = (amount, age, t) => {
  const g = Number(resolve(amount, t));
  if (!Number.isFinite(g)) return 1;
  return Math.min(1, Math.max(0, (g * 1.04 - age) * 25));
};

export function makeLayout(engine, depth, rule) {
  if (typeof depth === 'function') { rule = depth; depth = undefined; }
  const explicitDepth = depth != null;
  const cap = explicitDepth ? Math.max(0, Math.floor(Number(depth) || 0)) : DEFAULT_DEPTH;
  if (typeof rule !== 'function') {
    warn('layout: takes a rule to run — layout(6, e => e.place().forward(1).branch(x => x.turn(0.4).scale(0.7)))');
    rule = () => {};
  }
  const build = runBuild(rule, cap, explicitDepth);
  return new Layout(engine, build, null, null);
}

export { Layout };
