// A vector: a list of two or three parts, [x, y] or [x, y, z], each a number
// while it holds still and a signal while it moves. Everything that hands back
// a position, a direction or a pad gives one: a curve at a phase, .walk(),
// .sample(i), .normal(i), xy(). vec(x, y, z) makes one.
//
// It's a real array, so [x, y, z] = v, v[0], ...v and every slot that takes an
// [x, y, z] take it as one. On top of that, every signal method works on it one
// axis at a time: .mul(4), .smooth(0.1), .range(-3, 3). The methods aren't
// listed here: a lookup that misses the array's own falls through to
// Signal.prototype and runs there on each part, so a method added to signals
// later works on a vector too. An argument that is itself a vector pairs up
// axis by axis: a.mul(b) is x by x, y by y.
//
// A still vector stays numbers through anything that doesn't keep state, so
// vec(1, 2, 3).mul(2) is [2, 4, 6] and prints as one.

import { sig, Signal } from './audio.js';
import { warn } from './warn.js';

const resolve = (v, t) => (typeof v === 'function' ? v(t) : v);
const asSignal = (p) => (p instanceof Signal ? p : sig((t) => Number(resolve(p, t)) || 0));
const isStill = (p) => typeof p !== 'function';

// methods whose answer depends on what came before, so a still input still
// needs a signal to hold that state
const STATEFUL = new Set(['smooth', 'counter', 'hold', 'beat', 'kicks', 'plot']);

// an argument's part for axis i: a vector's own, a plain { x, y, z } point's,
// or the whole thing for every axis
function partOf(a, i) {
  if (a instanceof Vector || Array.isArray(a)) return a[i] ?? 0;
  if (a && typeof a === 'object' && 'x' in a) return [a.x, a.y, a.z][i] ?? 0;
  return a;
}

export class Vector extends Array {
  // .map(), .slice() and the rest hand back plain arrays
  static get [Symbol.species]() { return Array; }
}

const perAxis = new Proxy(Array.prototype, {
  get(target, name, receiver) {
    if (typeof name === 'symbol' || name in target) return Reflect.get(target, name, receiver);
    const method = Signal.prototype[name];
    if (typeof method !== 'function') return undefined;
    return function (...args) {
      const parts = [...this].map((p, i) => method.apply(asSignal(p), args.map((a) => partOf(a, i))));
      const still = !STATEFUL.has(name) && [...this].every(isStill)
        && args.every((a) => (Array.isArray(a) ? a.every(isStill) : isStill(a)));
      return vec(...(still ? parts.map((s) => s(0)) : parts));
    };
  },
});
Object.setPrototypeOf(Vector.prototype, perAxis);

// .x, .y, .z: a number while that axis holds still, a signal while it moves
['x', 'y', 'z'].forEach((axis, i) => {
  Object.defineProperty(Vector.prototype, axis, {
    get() {
      if (i >= this.length) return undefined;
      const p = this[i];
      return isStill(p) || p instanceof Signal ? p : asSignal(p);
    },
  });
});

const still = (v) => [...v].every(isStill);

// how far from the origin
Vector.prototype.mag = function () {
  const parts = [...this];
  const at = (t) => Math.hypot(...parts.map((p) => Number(resolve(p, t)) || 0));
  return still(this) ? at(0) : sig(at);
};
// how far from b
Vector.prototype.dist = function (b) { return this.sub(b).mag(); };
// the parts at sketch time t, as plain numbers
Vector.prototype.get = function (t = 0) { return [...this].map((p) => Number(resolve(p, t)) || 0); };
// .range(xlo, xhi, ylo, yhi): each axis its own span; two numbers go to every axis
Vector.prototype.range = function (lo, hi, a, b, ...rest) {
  if (typeof a === 'number' && typeof b === 'number' && this.length >= 2) {
    const spans = [[lo, hi], [a, b], ...(rest.length >= 2 ? [[rest[0], rest[1]]] : [])];
    return vec(...[...this].map((p, i) => (spans[i] ? asSignal(p).range(...spans[i]) : p)));
  }
  return vec(...[...this].map((p) => asSignal(p).range(lo, hi, a)));
};

// vec(x, y), vec(x, y, z), or vec([x, y, z]) / vec(someVector3) to wrap one
export function vec(...parts) {
  if (parts.length === 1) {
    const a = parts[0];
    if (Array.isArray(a)) parts = [...a];
    else if (a && typeof a === 'object' && 'x' in a) parts = 'z' in a ? [a.x, a.y, a.z] : [a.x, a.y];
    else {
      warn('vec: takes two or three parts — vec(x, y) or vec(x, y, z)');
      parts = [a ?? 0, 0, 0];
    }
  }
  const v = Reflect.construct(Array, [], Vector);
  v.push(...parts);
  return v;
}
