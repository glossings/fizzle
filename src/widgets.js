// Controls drawn in the code: slider(), knob(), toggle(), button(), xy().
//
// Each call is a signal like midi().cc() is, with the editor (widgets-editor.js)
// as the controller. The code is the truth: a drag writes the new value into the
// call's arguments, and the running signal reads the same value straight away,
// without a re-run. A run rebuilds every control from what its call says.
//
// A running control finds its call through the stack: the sketch is compiled
// tagged (eval-errors.js), so the frame that called slider() names the line and
// column it was written at. That offset, in the source as it was run, is the
// control's key; the editor keeps the same offsets mapped through later edits.
// Several runs of one call (a loop, a function called twice) share its control.
//
// .record(bars) loops a movement: hold the control and what the hand does is
// written into a loop of that many bars, the stretch from grab to release over
// whatever was there; let go and it plays. The take is written into the call.
//
// { cc }, { note } and { pad } bind a control to hardware: the knob on the desk
// moves the one in the code, the same way a drag does (widgets-hardware.js).

import { sig, barPhase } from './audio.js';
import { vec } from './vecsig.js';
import { warn } from './warn.js';
import { stackOffset } from './eval-errors.js';
import { carried } from './carry.js';
import { padButtonIndex } from './control.js';
import {
  widgetSites, snapValue, takeLength, decodeTake, encodeTake, rowTokens, isRest, TAKE_RATE,
} from './widget-calls.js';

const entries = new Map(); // key -> control, for this run
let handed = null; // the offset a tagged call handed over (tagSites), while it runs
let run = null; // { id, src, sites }
let serial = 0;

// Sketch time for what isn't read by the sketch: a number dragged in the code.
let clock = () => 0;
export const setWidgetClock = (fn) => { clock = fn; };
export const sketchNow = () => clock();

// Called by the engine before each evaluation of the sketch's own source.
export function beginWidgets(id, src) {
  entries.clear();
  run = { id, src, sites: null };
  serial++;
}

// What the editor binds to: the run's source and its controls by key.
export const widgetRun = () => ({ src: run?.src ?? null, entries, serial });
export const widgetEntry = (key) => entries.get(key);

// The site of the call making this control, or null when it isn't in the
// sketch's own source (a saved sketch pulled in by sketch('name')).
function siteFor(kind) {
  if (!run) return null;
  const at = handed ?? stackOffset(new Error().stack, run.id, run.src);
  handed = null;
  if (at == null) return null;
  run.sites ??= widgetSites(run.src);
  let best = null;
  for (const s of run.sites) {
    if (s.kind !== kind || at < s.from || at > s.close) continue;
    if (!best || s.close - s.from < best.close - best.from) best = s;
  }
  if (best) return best;
  // a labeled block's rewrite shifts the columns on its first line
  const line = run.src.lastIndexOf('\n', at - 1);
  const lineEnd = run.src.indexOf('\n', at);
  for (const s of run.sites) {
    if (s.kind !== kind || s.from <= line || (lineEnd >= 0 && s.from > lineEnd)) continue;
    if (!best || Math.abs(s.from - at) < Math.abs(best.from - at)) best = s;
  }
  return best;
}

// What a call tagged by tagSites() runs through: the widget function, called
// with its offset handed over.
export function siteCall(at, fn) {
  return (...args) => {
    handed = at;
    try { return fn(...args); } finally { handed = null; }
  };
}
// .plot(): the offset is handed over while the method's name is looked up
siteCall.member = (at, name) => { handed = at; return name; };

const num = (v, fallback, what) => {
  if (v === undefined || v === null) return fallback;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  warn(`${what}: takes plain numbers, not ${typeof v === 'function' ? 'a signal' : JSON.stringify(v)} — using ${fallback}`);
  return fallback;
};

// What a control's hardware options say, checked: { cc: [n] | [x, y], note,
// channel, pad, pickup, spring }, or null for none.
const PAD_SOURCES = {
  xy: ['left', 'right'],
  slider: ['lt', 'rt', 'lx', 'ly', 'rx', 'ry'],
  knob: ['lt', 'rt', 'lx', 'ly', 'rx', 'ry'],
};
const midiNum = (v) => Number.isInteger(v) && v >= 0 && v <= 127;

function bindingOf(kind, o, what) {
  if (o.cc == null && o.note == null && o.pad == null) return null;
  const b = { cc: null, note: null, channel: null, pad: null, pickup: !!o.pickup, spring: !!o.spring };
  if (o.cc != null) {
    const list = Array.isArray(o.cc) ? o.cc : [o.cc];
    const want = kind === 'xy' ? 2 : 1;
    if (list.length === want && list.every(midiNum)) b.cc = list;
    else warn(kind === 'xy'
      ? `${what}: cc takes two numbers 0..127, x then y — { cc: [12, 13] }`
      : `${what}: cc takes a number 0..127 — { cc: 74 }`);
  }
  if (o.note != null) {
    if (kind !== 'button' && kind !== 'toggle') warn(`${what}: note is for a button or a toggle — a ${kind} takes { cc }`);
    else if (midiNum(o.note)) b.note = o.note;
    else warn(`${what}: note takes a number 0..127 — { note: 38 }`);
  }
  if (o.channel != null) {
    if (Number.isInteger(o.channel) && o.channel >= 1 && o.channel <= 16) b.channel = o.channel;
    else warn(`${what}: channel is 1..16`);
  }
  if (o.pad != null) {
    const name = String(o.pad).toLowerCase();
    const ok = PAD_SOURCES[kind] ? PAD_SOURCES[kind].includes(name) : padButtonIndex(name) != null;
    if (ok) b.pad = name;
    else warn(`${what}: no pad source '${o.pad}' — try ${PAD_SOURCES[kind]?.join(', ') ?? 'a, b, x, y, lb, rb, up, down, left, right'}`);
  }
  return b;
}

class Control {
  constructor(kind, key, { value, min = 0, max = 1, step = null }, bind = null) {
    this.kind = kind;
    this.bind = bind; // the hardware it follows (bindingOf)
    this.key = key;
    this.dims = kind === 'xy' ? 2 : 1;
    this.min = min;
    this.max = max;
    this.step = step;
    this.value = value; // [v] or [x, y], in the control's units
    this.shown = value.slice(); // what the signal last handed out
    this.held = false;
    this.bars = 0; // 0: not recording
    this.take = null; // Float32Array of positions, dims interleaved
    this.lastT = -1;
    this.lastIdx = -1;
    this.dirty = false; // the take changed under the hand and isn't written yet
    this.takeText = null; // the take as the code has it
    this.seenT = 0; // the last sketch time the signal was read at
    // What the hand did, for capture: [t, ...value] per move, carried across
    // runs by kind and order (carry.js) so a re-run doesn't forget a phrase.
    this.hist = carried(`widget-hist:${kind}`, () => ({ base: value.slice(), moves: [] }));
  }

  // the editor moved the control by hand
  noteHand() {
    const m = this.hist.moves;
    m.push([this.seenT, ...this.value]);
    // a minute is more than any phrase capture looks back over
    while (m.length > 1 && this.seenT - m[0][0] > 60) this.hist.base = m.shift().slice(1);
  }

  pos(v) { return this.max === this.min ? 0 : (v - this.min) / (this.max - this.min); }
  at(p) { return this.min + (this.max - this.min) * p; }

  // the signal's value on channel c at sketch time t
  read(t, c) {
    if (t > this.seenT || t < this.seenT - 1) this.seenT = t;
    if (this.bars) this.tick(t);
    let v;
    if (this.held || !this.take) v = this.value[c];
    else {
      const n = this.take.length / this.dims;
      const f = (((barPhase(t, 1) / this.bars) % 1) + 1) % 1 * n;
      const i = Math.floor(f) % n;
      let p = this.take[i * this.dims + c];
      // a button's presses stay square; everything else glides between frames
      if (this.kind !== 'button') {
        const q = this.take[((i + 1) % n) * this.dims + c];
        p += (q - p) * (f - Math.floor(f));
      }
      v = this.kind === 'button' ? (p > 0.5 ? 1 : 0) : snapValue(this.at(p), this.min, this.max, this.step);
    }
    this.shown[c] = v;
    return v;
  }

  // While held, write the hand into the loop at every frame since the last one.
  // Only forward in time: a delay reading the past mustn't punch in there.
  tick(t) {
    if (t === this.lastT) return;
    if (t < this.lastT || !this.held || !this.take) {
      this.lastT = t;
      this.lastIdx = -1;
      return;
    }
    this.lastT = t;
    const n = this.take.length / this.dims;
    const idx = Math.floor(((((barPhase(t, 1) / this.bars) % 1) + 1) % 1) * n) % n;
    // from the sample after the last one written, up to this one; a frame that
    // lands on the same sample as the last only rewrites it
    let i = this.lastIdx < 0 || this.lastIdx === idx ? idx : (this.lastIdx + 1) % n;
    for (let guard = 0; guard < n; guard++) {
      for (let c = 0; c < this.dims; c++) this.take[i * this.dims + c] = this.pos(this.value[c]);
      if (i === idx) break;
      i = (i + 1) % n;
    }
    this.lastIdx = idx;
    this.dirty = true;
  }

  // the hand takes hold (editor)
  grab() {
    this.held = true;
    this.lastIdx = -1;
    if (this.bars && !this.take) {
      this.take = new Float32Array(takeLength(this.bars, this.dims));
      for (let i = 0; i < this.take.length; i++) this.take[i] = this.pos(this.value[i % this.dims]);
    }
  }

  release() {
    this.held = false;
    this.lastIdx = -1;
    if (this.kind === 'button') this.value[0] = 0;
  }

  setRecord(bars, take) {
    this.takeText = take;
    this.bars = Math.max(0, bars);
    const len = takeLength(this.bars, this.dims);
    this.take = this.bars && take ? decodeTake(take, len, this.dims) : null;
  }
}

function control(kind, args) {
  const o = args.length && args[args.length - 1] && typeof args[args.length - 1] === 'object'
    && !Array.isArray(args[args.length - 1]) ? args.pop() : {};
  const what = `${kind}()`;
  let cfg;
  if (kind === 'xy') {
    cfg = { value: [num(args[0], 0.5, what), num(args[1], 0.5, what)] };
  } else if (kind === 'toggle') {
    cfg = { value: [num(args[0], 0, what) ? 1 : 0] };
  } else if (kind === 'button') {
    cfg = { value: [0] };
  } else {
    const min = num(args[1] ?? o.min, 0, what);
    const max = num(args[2] ?? o.max, 1, what);
    const step = args[3] ?? o.step ?? null;
    const value = num(args[0] ?? o.value, (min + max) / 2, what);
    cfg = { value: [snapValue(value, min, max, step)], min, max, step: num(step, null, what) };
  }
  const site = siteFor(kind);
  const key = site ? site.from : `unbound:${serial}:${entries.size}`;
  let c = entries.get(key);
  if (!c) entries.set(key, (c = new Control(kind, key, cfg, bindingOf(kind, o, what))));
  return c;
}

// A learned binding, live at once; the next run reads it from the call.
export function rebind(key, o) {
  const c = entries.get(key);
  if (c instanceof Control) c.bind = bindingOf(c.kind, o, `${c.kind}()`);
}

function record(c, kind, bars, take) {
  if (kind === 'toggle') {
    warn('toggle(): .record() needs a control you hold — button() records presses');
    return;
  }
  const n = num(bars ?? 1, 1, `${kind}().record`);
  if (n <= 0) return;
  c.setRecord(n, typeof take === 'string' ? take : null);
}

function scalar(kind) {
  return (...args) => {
    const c = control(kind, args);
    const s = sig((t) => c.read(t, 0));
    // an own property: .record() means something only on a control
    s.record = (bars, take) => { record(c, kind, bars, take); return s; };
    return s;
  };
}

// --- grids ---------------------------------------------------------------------
//
// steps(), sliders() and matrix() are rows of cells, one row across a bar (or
// { bars } bars), drawn in place of their text. A hit is a gate, 1 for the first
// half of its step, so two hits in a row are two rising edges; a number plays as
// itself for its whole step.

class Grid {
  constructor(kind, key, rows, { bars = 1, min = 0, max = 1 } = {}) {
    this.kind = kind;
    this.key = key;
    this.rows = rows; // { name, cells } — cells are tokens, rewritten by the editor
    this.bars = bars;
    this.min = min;
    this.max = max;
    this.cur = -1; // the step playing, for the editor to light
  }
  read(t, row) {
    const cells = this.rows[row]?.cells;
    const n = cells?.length;
    if (!n) return 0;
    const f = ((((barPhase(t, 1) / this.bars) % 1) + 1) % 1) * n;
    const i = Math.floor(f) % n;
    this.cur = i;
    const tok = cells[i];
    if (this.kind === 'sliders') return Number(tok) || 0;
    if (isRest(tok)) return 0;
    const v = Number(tok);
    if (Number.isFinite(v)) return v;
    return f - Math.floor(f) < 0.5 ? 1 : 0;
  }
}

const rowOf = (v, what) => {
  if (v == null) return Array(8).fill('.');
  if (typeof v === 'number') return Array(Math.max(1, Math.min(64, Math.round(v)))).fill('.');
  if (typeof v === 'string') return rowTokens(v);
  warn(`${what}: takes a row as a string ("x . x .") or a count`);
  return [];
};

function grid(kind, rows, o) {
  const site = siteFor(kind);
  const key = site ? site.from : `unbound:${serial}:${entries.size}`;
  let g = entries.get(key);
  if (!g) entries.set(key, (g = new Grid(kind, key, rows, o)));
  return g;
}

const optsOf = (args) => (args.length && args[args.length - 1] && typeof args[args.length - 1] === 'object'
  ? args.pop() : {});

// --- plot ----------------------------------------------------------------------

class Plot {
  constructor(key, o) {
    this.kind = 'plot';
    this.key = key;
    this.seconds = num(o.seconds, 4, '.plot');
    this.min = o.min ?? null;
    this.max = o.max ?? null;
    this.t = new Float64Array(1024);
    this.v = new Float32Array(1024);
    this.n = 0; // samples written, ever
  }
  push(t, v) {
    const last = this.n ? this.t[(this.n - 1) % 1024] : -Infinity;
    if (t <= last) return;
    this.t[this.n % 1024] = t;
    this.v[this.n % 1024] = v;
    this.n++;
  }
}

// .plot(): the signal's value over the last few seconds, drawn under its line.
// `frame` is how the engine reads it every frame, used or not.
export function plotSignal(self, o, frame) {
  const site = siteFor('plot');
  const key = site ? site.from : `unbound:${serial}:${entries.size}`;
  let p = entries.get(key);
  if (!p) entries.set(key, (p = new Plot(key, o ?? {})));
  frame((t) => {
    const v = Number(self(t));
    p.push(t, Number.isFinite(v) ? v : 0);
  });
  return self;
}

// --- capture -------------------------------------------------------------------
//
// Every control keeps what the hand did (Control.noteHand). Capture takes the
// last phrase: the moves back to the last stillness of PHRASE_GAP bars, rounded
// out to whole bars, and makes each moved control's take of it, so it plays
// from then on as if .record() had been there all along.

const PHRASE_GAP = 4;
const CAPTURE_MAX_BARS = 16;

// `extra` are stand-ins shaped like a control ({ key, kind, dims, pos, hist }),
// for movements made outside one: the numbers dragged in the code.
export function captureTakes(extra = []) {
  const controls = [...entries.values()].filter((c) => c instanceof Control && c.kind !== 'toggle').concat(extra);
  const moves = controls.flatMap((c) => c.hist.moves.map((m) => m[0])).sort((a, b) => a - b);
  if (!moves.length) return null;
  const bar = (t) => barPhase(t, 1);
  let start = moves.length - 1;
  while (start > 0 && bar(moves[start]) - bar(moves[start - 1]) < PHRASE_GAP) start--;
  const t0 = moves[start], t1 = moves[moves.length - 1];
  const from = Math.floor(bar(t0));
  const bars = Math.min(CAPTURE_MAX_BARS, Math.max(1, Math.ceil(bar(t1) + 1e-9) - from));
  const out = [];
  for (const c of controls) {
    const m = c.hist.moves;
    if (!m.some((e) => e[0] >= t0)) continue;
    const n = takeLength(bars, c.dims) / c.dims;
    const take = new Float32Array(n * c.dims);
    let k = 0;
    let value = c.hist.base;
    const perBar = 4 * TAKE_RATE;
    for (let j = 0; j < n; j++) {
      const b = from + j / perBar;
      while (k < m.length && bar(m[k][0]) <= b) value = m[k++].slice(1);
      // where this sample sits in a loop `bars` long, which is what playback
      // reads; counted in whole samples, since a fractional bar rounds two
      // samples onto one slot and leaves another empty
      const i = (((from * perBar + j) % n) + n) % n;
      for (let d = 0; d < c.dims; d++) take[i * c.dims + d] = c.pos(value[d]);
    }
    c.bars = bars;
    c.take = take;
    c.takeText = encodeTake(take);
    c.held = false;
    out.push({ key: c.key, kind: c.kind, bars, text: c.takeText });
  }
  for (const c of controls) c.hist.moves.length = 0;
  return out.length ? { bars, controls: out } : null;
}

export const widgetApi = {
  slider: scalar('slider'),
  knob: scalar('knob'),
  toggle: scalar('toggle'),
  button: scalar('button'),
  // A two-part vector (vecsig.js), x and y, 0..1 with y up: every signal
  // method works on both axes, .x and .y are one each, and .position(xy())
  // fills two slots, so .position(xy(), 2) or .position(2, xy()) fixes the third.
  xy(...args) {
    const c = control('xy', args);
    const v = vec(sig((t) => c.read(t, 0)), sig((t) => c.read(t, 1)));
    v.record = (bars, take) => { record(c, 'xy', bars, take); return v; };
    return v;
  },
  // steps("x . x .", { bars }): a row of cells, 1 on a hit
  steps(...args) {
    const o = optsOf(args);
    const g = grid('steps', [{ name: '', cells: rowOf(args[0], 'steps') }], { bars: num(o.bars, 1, 'steps') });
    return sig((t) => g.read(t, 0));
  },
  // sliders("0.2 0.8", min, max, { bars }): a bar per step, its value held
  sliders(...args) {
    const o = optsOf(args);
    const min = num(args[1] ?? o.min, 0, 'sliders'), max = num(args[2] ?? o.max, 1, 'sliders');
    const cells = typeof args[0] === 'number' || args[0] == null
      ? Array(args[0] == null ? 8 : Math.max(1, Math.min(64, Math.round(args[0])))).fill(String((min + max) / 2))
      : rowOf(args[0], 'sliders');
    const g = grid('sliders', [{ name: '', cells }], { bars: num(o.bars, 1, 'sliders'), min, max });
    return sig((t) => g.read(t, 0));
  },
  // matrix({ kick: "x...", hat: "x.x." }, { bars }): a row per name, each a
  // steps() signal under that name
  matrix(rows = {}, o = {}) {
    if (!rows || typeof rows !== 'object') {
      warn('matrix: takes rows by name — matrix({ kick: "x . . .", hat: "x x x x" })');
      rows = {};
    }
    const list = Object.entries(rows).map(([name, v]) => ({ name, cells: rowOf(v, `matrix ${name}`) }));
    const g = grid('matrix', list, { bars: num(o.bars, 1, 'matrix') });
    const out = {};
    list.forEach((r, i) => { out[r.name] = sig((t) => g.read(t, i)); });
    return out;
  },
};
