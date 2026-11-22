// The editor's half of the widgets (widgets.js): each slider(), knob(),
// toggle() and button() the last run made is drawn just before its name, each
// xy() and .plot() under its line, and each steps(), sliders() and matrix() row
// in place of its text. A drag writes the new value into the call and into the
// running widget at once, so it's seen without a re-run; typing into the call
// moves the widget to match.
//
// What's drawn comes from the run, not from the text: a call that hasn't been
// run yet has no control to reach. The sites are the run's offsets, mapped
// through every edit since, and a site whose call has been edited away is
// dropped.

import { StateField, StateEffect, MapMode } from '@codemirror/state';
import { EditorView, Decoration, WidgetType } from '@codemirror/view';
import { foldEffect, foldedRanges } from '@codemirror/language';
import { widgetRun, widgetEntry, captureTakes } from './widgets.js';
import {
  readCall, literalNumber, literalTake, literalString, snapValue, decimalsFor, formatValue, encodeTake,
  VALUE_ARGS, GRID_KINDS, matrixRows, rowTokens, isRest,
} from './widget-calls.js';
import { showMenu } from './context-menu.js';

const SLIDER_SWEEP_PX = 170; // sideways travel for a slider's whole range
const KNOB_SWEEP_PX = 150; // upward travel for a knob's
const FINE = 10; // shift: this many times the travel
const WHEEL_STEP = 0.02; // share of the range per wheel notch

const setSites = StateEffect.define();
const setTextMode = StateEffect.define(); // { key, on }: a grid shown as its text
const GRIDS = new Set(GRID_KINDS);
const WIDGET_EVENT = 'input.widget';

const callAt = (doc, pos, kind) => {
  const text = doc.sliceString(pos, Math.min(doc.length, pos + 4000));
  const call = readCall(text, 0);
  if (!call || call.name !== kind) return null;
  const shift = (r) => r && { ...r, from: r.from + pos, to: r.to + pos };
  return {
    ...call,
    open: call.open + pos,
    close: call.close + pos,
    args: call.args.map(shift),
    record: call.record && {
      open: call.record.open + pos,
      close: call.record.close + pos,
      args: call.record.args.map(shift),
    },
  };
};

const isObject = (a) => /^\{[\s\S]*\}$/.test(a.text);

// the arguments before an options object
const positional = (call) => {
  const i = call.args.findIndex(isObject);
  return i < 0 ? call.args : call.args.slice(0, i);
};

// a control can write its value only where the value is a number, or absent
const writable = (call, kind) => {
  const pos = positional(call);
  for (let i = 0; i < VALUE_ARGS[kind]; i++) {
    if (pos[i] && literalNumber(pos[i].text) == null) return false;
  }
  return true;
};

// --- size --------------------------------------------------------------------
//
// A control's size is written into its call when its corner is dragged:
// { size } for the square ones, { width, height } for the slider and button.

const SQUARE = new Set(['knob', 'toggle', 'xy']);
const DEFAULT_SIZE = {
  slider: [64, 15], knob: [24, 24], toggle: [14, 14], button: [20, 14], xy: [120, 120],
};
const SIZE_MIN = 8, SIZE_MAX = 600;
const clampSize = (v) => Math.round(Math.min(SIZE_MAX, Math.max(SIZE_MIN, v)));

// a matrix's first object is its rows, so its options are the one after
const optionsArg = (call, kind) => (kind === 'matrix' ? (call.args[1] && isObject(call.args[1]) ? call.args[1] : null)
  : call.args.find(isObject));

function optionNumber(call, name, kind) {
  const obj = optionsArg(call, kind);
  const m = obj && new RegExp(`\\b${name}\\s*:\\s*([-+]?[\\d.]+)`).exec(obj.text);
  return m ? literalNumber(m[1]) : null;
}

function sizeOf(call, kind) {
  const [w0, h0] = DEFAULT_SIZE[kind];
  if (SQUARE.has(kind)) {
    const n = clampSize(optionNumber(call, 'size') ?? w0);
    return [n, n];
  }
  return [clampSize(optionNumber(call, 'width') ?? w0), clampSize(optionNumber(call, 'height') ?? h0)];
}

// set keys in the call's options object, adding one if it has none
function writeOptions(view, key, kind, values) {
  const pos = posOf(view, key);
  const call = pos != null && callAt(view.state.doc, pos, kind);
  if (!call) return;
  const obj = optionsArg(call, kind);
  let change;
  if (obj) {
    let text = obj.text;
    for (const [k, v] of Object.entries(values)) {
      const re = new RegExp(`(\\b${k}\\s*:\\s*)[^,}\\s]+`);
      if (re.test(text)) text = text.replace(re, `$1${v}`);
      else {
        const inner = text.slice(1, -1).trim();
        text = inner ? `{ ${inner}, ${k}: ${v} }` : `{ ${k}: ${v} }`;
      }
    }
    change = { from: obj.from, to: obj.to, insert: text };
  } else {
    const fields = Object.entries(values).map(([k, v]) => `${k}: ${v}`).join(', ');
    change = { from: call.close, insert: `${call.args.length ? ', ' : ''}{ ${fields} }` };
  }
  view.dispatch({ changes: change, userEvent: WIDGET_EVENT });
}

// a grid draws where its rows are written out (or not yet written: steps(8))
function drawable(call, kind) {
  if (kind === 'plot') return true;
  if (kind === 'matrix') return !!call.args[0] && isObject(call.args[0]);
  if (GRIDS.has(kind)) {
    const a = call.args[0];
    return !a || isObject(a) || literalNumber(a.text) != null || !!literalString(a.text);
  }
  return writable(call, kind);
}

const textModeField = StateField.define({
  create: () => new Set(),
  update(set, tr) {
    let out = set;
    for (const e of tr.effects) {
      if (!e.is(setTextMode)) continue;
      out = new Set(out);
      if (e.value.on) out.add(e.value.key);
      else out.delete(e.value.key);
    }
    for (const e of tr.effects) if (e.is(setSites)) out = new Set();
    return out;
  },
});

const sitesField = StateField.define({
  create: () => [],
  update(sites, tr) {
    for (const e of tr.effects) if (e.is(setSites)) return e.value;
    if (!tr.docChanged) return sites;
    const out = [];
    for (const s of sites) {
      const pos = tr.changes.mapPos(s.pos, 1, MapMode.TrackDel);
      if (pos == null) continue;
      const call = callAt(tr.state.doc, pos, s.kind);
      if (!call || !drawable(call, s.kind)) continue;
      out.push({ ...s, pos });
    }
    return out;
  },
});

const posOf = (view, key) => view.state.field(sitesField).find((s) => s.key === key)?.pos ?? null;

// --- drawing -----------------------------------------------------------------

// While one widget is in the hand, the others don't answer the pointer: a drag
// that passes over a neighbor's corner mustn't light or catch it.
const holding = (on) => document.body.classList.toggle('cm-w-holding', on);

const live = new Set(); // { key, el, draw } for every control on screen
let raf = 0;
function loop() {
  raf = 0;
  if (!live.size) return;
  for (const w of live) w.draw();
  raf = requestAnimationFrame(loop);
}
const watch = (w) => {
  live.add(w);
  if (!raf) raf = requestAnimationFrame(loop);
};

const el = (tag, cls) => {
  const e = document.createElement(tag);
  e.className = cls;
  return e;
};

// how the control's state reads at a glance: playing its take, recording one
function stateClass(dom, c) {
  dom.classList.toggle('playing', !!(c && c.take && !c.held));
  dom.classList.toggle('armed', !!(c && c.bars));
  dom.classList.toggle('held', !!(c && c.held));
  dom.classList.toggle('dead', !c);
}

const TITLES = {
  slider: 'drag sideways; shift for fine steps',
  knob: 'drag up or down; shift for fine steps',
  toggle: 'click to switch',
  button: '1 while held',
  xy: 'drag to move x and y',
};

class Control extends WidgetType {
  constructor(key, kind, size, indent = 0) {
    super();
    this.key = key;
    this.kind = kind;
    this.size = size;
    this.indent = indent;
  }
  eq(o) {
    return o.key === this.key && o.kind === this.kind && o.indent === this.indent
      && o.size[0] === this.size[0] && o.size[1] === this.size[1];
  }
  ignoreEvent(e) { return e.type !== 'contextmenu'; }
  get estimatedHeight() { return this.kind === 'xy' ? this.size[1] + 10 : -1; }

  toDOM(view) {
    const { key, kind } = this;
    const dom = el(kind === 'xy' ? 'div' : 'span', `cm-w cm-w-${kind}`);
    const face = el('span', 'cm-w-face');
    face.title = TITLES[kind];
    const [w, h] = this.size;
    face.style.width = `${w}px`;
    face.style.height = `${h}px`;
    dom.append(face);
    let draw;
    if (kind === 'xy') {
      dom.style.marginLeft = `${this.indent}ch`;
      const dot = el('span', 'cm-w-dot');
      face.append(el('span', 'cm-w-cross-x'), el('span', 'cm-w-cross-y'), dot);
      let last = '';
      draw = () => {
        const c = widgetEntry(key);
        stateClass(dom, c);
        const [x, y] = c ? c.shown : [0.5, 0.5];
        const s = `${x},${y}`;
        if (s === last) return;
        last = s;
        dot.style.left = `${Math.min(1, Math.max(0, x)) * 100}%`;
        dot.style.top = `${(1 - Math.min(1, Math.max(0, y))) * 100}%`;
      };
    } else if (kind === 'slider') {
      const fill = el('span', 'cm-w-fill');
      face.append(fill);
      let last = -1;
      draw = () => {
        const c = widgetEntry(key);
        stateClass(dom, c);
        const p = c ? c.pos(c.shown[0]) : 0;
        if (p === last) return;
        last = p;
        fill.style.width = `${Math.min(1, Math.max(0, p)) * 100}%`;
      };
    } else if (kind === 'knob') {
      let last = -1;
      draw = () => {
        const c = widgetEntry(key);
        stateClass(dom, c);
        const p = c ? Math.min(1, Math.max(0, c.pos(c.shown[0]))) : 0;
        if (p === last) return;
        last = p;
        face.style.setProperty('--p', `${p * 270}deg`);
      };
    } else {
      draw = () => {
        const c = widgetEntry(key);
        stateClass(dom, c);
        dom.classList.toggle('on', !!(c && c.shown[0] > 0.5));
      };
    }
    // keep the caret where it was: a control is not a place in the text
    dom.addEventListener('mousedown', (e) => e.preventDefault());
    bindPointer(view, face, key, kind);
    bindGrip(view, dom, face, key, kind, this.size);
    const wv = { key, el: dom, draw };
    dom._w = wv;
    draw();
    watch(wv);
    return dom;
  }

  destroy(dom) { if (dom._w) live.delete(dom._w); }
}

// The lower right corner, invisible until hovered. The new size shows while
// dragging and is written into the call on release.
function bindGrip(view, dom, face, key, kind, size) {
  const grip = el('span', 'cm-w-grip');
  grip.title = 'drag to resize';
  dom.append(grip);
  let drag = null;
  const next = (e) => {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (SQUARE.has(kind)) {
      const n = clampSize(size[0] + Math.max(dx, dy));
      return [n, n];
    }
    return [clampSize(size[0] + dx), clampSize(size[1] + dy)];
  };
  grip.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    grip.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY };
    document.body.classList.add('cm-w-resizing');
  });
  grip.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const [w, h] = next(e);
    face.style.width = `${w}px`;
    face.style.height = `${h}px`;
  });
  const end = (e) => {
    if (!drag) return;
    const [w, h] = next(e);
    drag = null;
    document.body.classList.remove('cm-w-resizing');
    if (w === size[0] && h === size[1]) return;
    writeOptions(view, key, kind, SQUARE.has(kind) ? { size: w } : { width: w, height: h });
  };
  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', end);
}

function decorations(state) {
  const ranges = [];
  const textMode = state.field(textModeField);
  for (const s of state.field(sitesField)) {
    if (GRIDS.has(s.kind)) {
      if (!textMode.has(s.key)) gridRanges(state, s, ranges);
      continue;
    }
    if (s.kind === 'plot') {
      const call = callAt(state.doc, s.pos, 'plot');
      if (!call) continue;
      const line = state.doc.lineAt(call.close);
      const indent = /^[ \t]*/.exec(line.text)[0].replace(/\t/g, '  ').length;
      const size = [clampSize(optionNumber(call, 'width') ?? 240), clampSize(optionNumber(call, 'height') ?? 48)];
      ranges.push(Decoration.widget({ widget: new PlotView(s.key, size, indent), block: true, side: 1 }).range(line.to));
      continue;
    }
    if (s.kind === 'xy') {
      const call = callAt(state.doc, s.pos, 'xy');
      if (!call) continue;
      const line = state.doc.lineAt(call.record ? call.record.close : call.close);
      const first = state.doc.lineAt(s.pos);
      const indent = /^[ \t]*/.exec(first.text)[0].replace(/\t/g, '  ').length;
      ranges.push(Decoration.widget({ widget: new Control(s.key, 'xy', sizeOf(call, 'xy'), indent), block: true, side: 1 }).range(line.to));
    } else {
      const call = callAt(state.doc, s.pos, s.kind);
      if (!call) continue;
      ranges.push(Decoration.widget({ widget: new Control(s.key, s.kind, sizeOf(call, s.kind)), side: -1 }).range(s.pos));
    }
  }
  return Decoration.set(ranges, true);
}

const decoField = StateField.define({
  create: (state) => decorations(state),
  update(deco, tr) {
    const sitesMoved = tr.docChanged || tr.effects.some((e) => e.is(setSites) || e.is(setTextMode));
    return sitesMoved ? decorations(tr.state) : deco;
  },
  provide: (f) => [EditorView.decorations.from(f), EditorView.atomicRanges.of((v) => v.state.field(f))],
});

// --- writing -----------------------------------------------------------------

function writeValues(view, key, kind, values) {
  const pos = posOf(view, key);
  const c = widgetEntry(key);
  if (pos == null || !c) return;
  const call = callAt(view.state.doc, pos, kind);
  if (!call) return;
  const dec = kind === 'toggle' ? 0 : decimalsFor(c.min, c.max, c.step);
  const texts = values.map((v) => formatValue(v, dec));
  const pos0 = positional(call);
  const changes = [];
  texts.forEach((insert, i) => {
    if (pos0[i]) changes.push({ from: pos0[i].from, to: pos0[i].to, insert });
  });
  // the values not written yet go after the ones that are, ahead of any options
  const missing = texts.slice(pos0.length);
  if (missing.length) {
    const at = pos0.length ? pos0[pos0.length - 1].to : call.open + 1;
    const lead = pos0.length ? ', ' : '';
    const tail = !pos0.length && call.args.length ? ', ' : '';
    changes.push({ from: at, insert: lead + missing.join(', ') + tail });
  }
  view.dispatch({ changes, userEvent: WIDGET_EVENT });
}

function foldTake(view, from, to) {
  let folded = false;
  foldedRanges(view.state).between(from, to, () => { folded = true; return false; });
  if (!folded && to > from) view.dispatch({ effects: foldEffect.of({ from, to }) });
}

// the take goes into .record(bars, '...'), folded to a chip
function writeTake(view, key, kind) {
  const pos = posOf(view, key);
  const c = widgetEntry(key);
  if (pos == null || !c?.take) return;
  const call = callAt(view.state.doc, pos, kind);
  if (!call?.record) return;
  const text = encodeTake(c.take);
  c.takeText = text;
  c.dirty = false;
  const bars = call.record.args[0]?.text || String(c.bars);
  const insert = `${bars}, '${text}'`;
  const from = call.record.open + 1;
  view.dispatch({ changes: { from, to: call.record.close, insert }, userEvent: WIDGET_EVENT });
  const at = from + bars.length + 2;
  foldTake(view, at, at + text.length + 2);
}

// --- the hand ----------------------------------------------------------------

function bindPointer(view, dom, key, kind) {
  let drag = null;

  const set = (values) => {
    const c = widgetEntry(key);
    if (!c) return;
    const snapped = values.map((v) => (kind === 'xy' ? Math.min(1, Math.max(0, v)) : snapValue(v, c.min, c.max, c.step)));
    const same = snapped.every((v, i) => v === c.value[i]);
    c.value = snapped;
    c.shown = snapped.slice();
    if (!same) c.noteHand();
    if (!same && kind !== 'button') writeValues(view, key, kind, snapped);
  };

  const padAt = (e) => {
    const r = dom.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, 1 - (e.clientY - r.top) / r.height];
  };

  dom.addEventListener('pointerdown', (e) => {
    const c = widgetEntry(key);
    if (!c || e.button !== 0) return;
    e.preventDefault();
    dom.setPointerCapture(e.pointerId);
    holding(true);
    if (kind === 'toggle') { set([c.value[0] > 0.5 ? 0 : 1]); return; }
    c.grab();
    if (kind === 'button') { c.value[0] = 1; c.shown[0] = 1; c.noteHand(); drag = {}; return; }
    if (kind === 'xy') { drag = {}; set(padAt(e)); return; }
    drag = { x: e.clientX, y: e.clientY, p: c.pos(c.value[0]), shift: e.shiftKey };
  });

  dom.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const c = widgetEntry(key);
    if (!c) return;
    if (kind === 'xy') { set(padAt(e)); return; }
    if (kind === 'button') return;
    // changing shift mid-drag starts the finer travel from where the control is
    if (e.shiftKey !== drag.shift) drag = { x: e.clientX, y: e.clientY, p: c.pos(c.value[0]), shift: e.shiftKey };
    const sweep = (kind === 'knob' ? KNOB_SWEEP_PX : SLIDER_SWEEP_PX) * (e.shiftKey ? FINE : 1);
    const d = kind === 'knob' ? drag.y - e.clientY : e.clientX - drag.x;
    set([c.at(drag.p + d / sweep)]);
  });

  const end = () => {
    holding(false);
    if (!drag) return;
    drag = null;
    const c = widgetEntry(key);
    if (!c) return;
    const recorded = c.held && c.bars && c.take;
    c.release();
    if (kind === 'button') c.noteHand();
    if (recorded) writeTake(view, key, kind);
  };
  dom.addEventListener('pointerup', end);
  dom.addEventListener('pointercancel', end);

  if (kind === 'slider' || kind === 'knob') {
    dom.addEventListener('wheel', (e) => {
      const c = widgetEntry(key);
      if (!c) return;
      e.preventDefault();
      const step = WHEEL_STEP / (e.shiftKey ? FINE : 1) * (e.deltaY > 0 ? -1 : 1);
      set([c.at(c.pos(c.value[0]) + step)]);
    }, { passive: false });
  }
}

// --- the code ----------------------------------------------------------------

// Typing in a call moves its control: the value, the range, the take. The
// control's own writes are skipped, since they already say what it holds.
const followText = EditorView.updateListener.of((u) => {
  if (!u.docChanged || u.transactions.every((tr) => tr.isUserEvent(WIDGET_EVENT))) return;
  for (const s of u.state.field(sitesField)) {
    const c = widgetEntry(s.key);
    const call = c && callAt(u.state.doc, s.pos, s.kind);
    if (!call || c.held) continue;
    if (GRIDS.has(s.kind)) readRows(c, call, s.kind);
    else if (s.kind !== 'plot') readInto(c, call, s.kind);
  }
});

// a grid's rows as the text has them now
function rowRanges(call, kind) {
  if (kind === 'matrix') {
    const obj = call.args[0];
    return obj && isObject(obj) ? matrixRows(obj.text, obj.from) : [];
  }
  const a = call.args[0];
  if (!a || isObject(a)) return [{ name: '', from: call.open + 1, to: call.open + 1, text: null, count: 8, insert: true }];
  const str = literalString(a.text);
  if (str) return [{ name: '', from: a.from, to: a.to, text: str.text, quote: str.quote }];
  const n = literalNumber(a.text);
  return n != null ? [{ name: '', from: a.from, to: a.to, text: null, count: Math.max(1, Math.min(64, Math.round(n))) }] : [];
}

function cellsOf(row, g) {
  if (row.text != null) return rowTokens(row.text);
  const fill = g?.kind === 'sliders' ? String((g.min + g.max) / 2) : '.';
  return Array(row.count).fill(fill);
}

function readRows(g, call, kind) {
  if (kind === 'sliders') {
    const n = (i) => (call.args[i] ? literalNumber(call.args[i].text) : null);
    g.min = n(1) ?? g.min;
    g.max = n(2) ?? g.max;
  }
  rowRanges(call, kind).forEach((r, i) => { if (g.rows[i]) g.rows[i].cells = cellsOf(r, g); });
}

function readInto(c, call, kind) {
  const n = (i) => (call.args[i] ? literalNumber(call.args[i].text) : null);
  if (kind === 'slider' || kind === 'knob') {
    c.min = n(1) ?? c.min;
    c.max = n(2) ?? c.max;
    c.step = n(3) ?? c.step;
  }
  for (let i = 0; i < VALUE_ARGS[kind]; i++) {
    const v = n(i);
    if (v == null) continue;
    c.value[i] = kind === 'xy' ? v : kind === 'toggle' ? (v ? 1 : 0) : snapValue(v, c.min, c.max, c.step);
    c.shown[i] = c.value[i];
  }
  if (kind === 'toggle') return;
  const bars = call.record ? (call.record.args[0] ? literalNumber(call.record.args[0].text) : 1) : 0;
  const take = call.record?.args[1] ? literalTake(call.record.args[1].text) : null;
  if (bars == null) return;
  if (bars !== c.bars || (take ?? null) !== (c.takeText ?? null)) c.setRecord(bars, take);
}

// After a run: draw a control for every call it bound. A run that failed and
// put the last good sketch back ran other text than the editor's, so the
// controls on screen stay as they are; they still reach that sketch's controls.
export function syncWidgets(view) {
  const { src, entries } = widgetRun();
  const doc = view.state.doc;
  if (src == null || src !== doc.toString()) return;
  const sites = [];
  const folds = [];
  for (const c of entries.values()) {
    if (typeof c.key !== 'number') continue;
    const call = callAt(doc, c.key, c.kind);
    if (!call || !drawable(call, c.kind)) continue;
    sites.push({ key: c.key, kind: c.kind, pos: c.key });
    const t = call.record?.args[1];
    if (t && literalTake(t.text)) folds.push(t);
  }
  view.dispatch({ effects: setSites.of(sites) });
  for (const t of folds) foldTake(view, t.from, t.to);
}

// whether pos is inside the arguments of a call that has a control
export function isControlArg(view, pos) {
  for (const s of view.state.field(sitesField)) {
    const call = callAt(view.state.doc, s.pos, s.kind);
    if (call && pos > call.open && pos <= (call.record?.close ?? call.close)) return true;
  }
  return false;
}

// --- grids -------------------------------------------------------------------

// One cell's size, from the call's { width, height }: the whole row grows by
// its cells.
const CELL_SIZE = { hits: [14, 14], bars: [12, 32] };
function cellSize(call, kind) {
  const [w0, h0] = CELL_SIZE[kind === 'sliders' ? 'bars' : 'hits'];
  const w = optionNumber(call, 'width', kind), h = optionNumber(call, 'height', kind);
  return [Math.round(Math.min(80, Math.max(6, w ?? w0))), Math.round(Math.min(200, Math.max(6, h ?? h0)))];
}

function gridRanges(state, s, ranges) {
  const call = callAt(state.doc, s.pos, s.kind);
  if (!call) return;
  const size = cellSize(call, s.kind);
  rowRanges(call, s.kind).forEach((r, i) => {
    const widget = new Cells(s.key, s.kind, i, r.text ?? `#${r.count}`, size);
    if (r.insert) ranges.push(Decoration.widget({ widget, side: 1 }).range(r.from));
    else ranges.push(Decoration.replace({ widget }).range(r.from, r.to));
  });
}

// The cells are kept across edits of their own text (updateDOM), so a stroke
// that rewrites the row on every cell it crosses keeps hold of the row.
class Cells extends WidgetType {
  constructor(key, kind, row, text, size) {
    super();
    this.key = key;
    this.kind = kind;
    this.row = row;
    this.text = text;
    this.size = size;
  }
  eq(o) {
    return o.key === this.key && o.row === this.row && o.kind === this.kind && o.text === this.text
      && o.size[0] === this.size[0] && o.size[1] === this.size[1];
  }
  ignoreEvent(e) { return e.type !== 'contextmenu'; }

  tokens() {
    const g = widgetEntry(this.key);
    return this.text.startsWith('#') ? cellsOf({ text: null, count: Number(this.text.slice(1)) }, g) : rowTokens(this.text);
  }

  // the cells for this row's text, into the row's own element
  fill(dom) {
    const { key, kind } = this;
    const g = widgetEntry(key);
    const cells = this.tokens();
    const n = cells.length;
    const [w, h] = this.size;
    dom.querySelectorAll('.cm-w-cell').forEach((c) => c.remove());
    const grip = dom.querySelector('.cm-w-grip');
    cells.forEach((tok, i) => {
      const c = el('span', 'cm-w-cell');
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
      if (i > 0 && n > 4 && n % 4 === 0 && i % 4 === 0) c.classList.add('beat');
      if (kind === 'sliders') {
        const bar = el('span', 'cm-w-bar');
        const lo = g?.min ?? 0, hi = g?.max ?? 1;
        bar.style.height = `${Math.min(1, Math.max(0, (Number(tok) - lo) / ((hi - lo) || 1))) * 100}%`;
        c.append(bar);
      } else if (!isRest(tok)) c.classList.add('on');
      dom.insertBefore(c, grip);
    });
    if (dom._w) dom._w.lastCur = -2;
  }

  toDOM(view) {
    const { key, kind, row } = this;
    const dom = el('span', `cm-w-cells cm-w-cells-${kind === 'sliders' ? 'bars' : 'hits'}`);
    dom.title = kind === 'sliders' ? 'drag across the bars to set them' : 'click a cell, or drag across to paint';
    const grip = el('span', 'cm-w-grip');
    grip.title = 'drag to resize';
    dom.append(grip);
    dom._widget = this;
    this.fill(dom);
    dom.addEventListener('mousedown', (e) => e.preventDefault());
    bindCells(view, dom, key, kind, row);
    bindCellGrip(view, dom, grip, key, kind);
    const w = { key, el: dom, lastCur: -2, draw: null };
    w.draw = () => {
      const entry = widgetEntry(key);
      const cur = entry ? entry.cur : -1;
      if (cur === w.lastCur) return;
      const cells = dom.querySelectorAll('.cm-w-cell');
      cells[w.lastCur]?.classList.remove('now');
      cells[cur]?.classList.add('now');
      w.lastCur = cur;
    };
    dom._w = w;
    watch(w);
    return dom;
  }

  updateDOM(dom) {
    if (!dom._w) return false;
    dom._widget = this;
    this.fill(dom);
    return true;
  }

  destroy(dom) { if (dom._w) live.delete(dom._w); }
}

// The row's corner sets one cell's size: the drag is shared out over the cells.
function bindCellGrip(view, dom, grip, key, kind) {
  let drag = null;
  const next = (e) => {
    const n = Math.max(1, dom.querySelectorAll('.cm-w-cell').length);
    const [w, h] = drag.size;
    return [
      Math.round(Math.min(80, Math.max(6, w + (e.clientX - drag.x) / n))),
      Math.round(Math.min(200, Math.max(6, h + (e.clientY - drag.y)))),
    ];
  };
  grip.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    grip.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, size: dom._widget.size };
    document.body.classList.add('cm-w-resizing');
  });
  grip.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const [w, h] = next(e);
    dom.querySelectorAll('.cm-w-cell').forEach((c) => { c.style.width = `${w}px`; c.style.height = `${h}px`; });
  });
  const end = (e) => {
    if (!drag) return;
    const [w, h] = next(e);
    const [w0, h0] = drag.size;
    drag = null;
    document.body.classList.remove('cm-w-resizing');
    if (w !== w0 || h !== h0) writeOptions(view, key, kind, { width: w, height: h });
  };
  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', end);
}

// The row now, written back: the quote it had, or a double quote for a count.
function writeRow(view, key, kind, row, tokens) {
  const pos = posOf(view, key);
  const call = pos != null && callAt(view.state.doc, pos, kind);
  if (!call) return;
  const r = rowRanges(call, kind)[row];
  if (!r) return;
  const q = r.quote ?? '"';
  const text = `${q}${tokens.join(' ')}${q}`;
  const insert = r.insert ? (call.args.length ? `${text}, ` : text) : text;
  view.dispatch({ changes: { from: r.from, to: r.to, insert }, userEvent: WIDGET_EVENT });
  const g = widgetEntry(key);
  if (g?.rows[row]) g.rows[row].cells = tokens.slice();
}

function bindCells(view, dom, key, kind, row) {
  let drag = null;
  const tokensNow = () => {
    const pos = posOf(view, key);
    const call = pos != null && callAt(view.state.doc, pos, kind);
    const r = call && rowRanges(call, kind)[row];
    return r ? cellsOf(r, widgetEntry(key)) : null;
  };
  // by x alone, nearest cell, so a stroke that wanders off the row keeps going
  const cellAt = (e) => {
    const cells = [...dom.querySelectorAll('.cm-w-cell')];
    let best = null;
    cells.forEach((c, i) => {
      const b = c.getBoundingClientRect();
      const d = e.clientX < b.left ? b.left - e.clientX : e.clientX > b.right ? e.clientX - b.right : 0;
      if (!best || d < best.d) best = { i, b, d };
    });
    return best;
  };
  const hitTok = (tokens) => tokens.find((t) => !isRest(t) && Number.isNaN(Number(t))) ?? 'x';
  const apply = (e) => {
    const hit = cellAt(e);
    const tokens = tokensNow();
    if (!hit || !tokens) return;
    if (kind === 'sliders') {
      const g = widgetEntry(key);
      const lo = g?.min ?? 0, hi = g?.max ?? 1;
      const p = Math.min(1, Math.max(0, (hit.b.bottom - e.clientY) / hit.b.height));
      const v = formatValue(lo + (hi - lo) * p, decimalsFor(lo, hi));
      if (tokens[hit.i] === v) return;
      tokens[hit.i] = v;
    } else {
      const want = drag.on ? hitTok(tokens) : '.';
      if ((!isRest(tokens[hit.i])) === drag.on) return;
      tokens[hit.i] = want;
    }
    writeRow(view, key, kind, row, tokens);
  };
  dom.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.classList.contains('cm-w-grip')) return;
    e.preventDefault();
    dom.setPointerCapture(e.pointerId);
    holding(true);
    const hit = cellAt(e);
    const tokens = tokensNow();
    if (!hit || !tokens) return;
    // a stroke paints what the first cell became, so dragging across sets them all
    drag = { on: isRest(tokens[hit.i]) };
    apply(e);
  });
  dom.addEventListener('pointermove', (e) => { if (drag) apply(e); });
  const end = () => { drag = null; holding(false); };
  dom.addEventListener('pointerup', end);
  dom.addEventListener('pointercancel', end);
}

// --- plot --------------------------------------------------------------------

class PlotView extends WidgetType {
  constructor(key, size, indent) {
    super();
    this.key = key;
    this.size = size;
    this.indent = indent;
  }
  eq(o) { return o.key === this.key && o.indent === this.indent && o.size[0] === this.size[0] && o.size[1] === this.size[1]; }
  ignoreEvent(e) { return e.type !== 'contextmenu'; }
  get estimatedHeight() { return this.size[1] + 10; }

  toDOM(view) {
    const { key } = this;
    const [w, h] = this.size;
    const dom = el('div', 'cm-w cm-w-plot');
    dom.style.marginLeft = `${this.indent}ch`;
    const face = el('span', 'cm-w-face');
    face.style.width = `${w}px`;
    face.style.height = `${h}px`;
    const canvas = document.createElement('canvas');
    const label = el('span', 'cm-w-plot-range');
    face.append(canvas, label);
    dom.append(face);
    bindGrip(view, dom, face, key, 'plot', this.size);
    let lastN = -1;
    const draw = () => {
      const p = widgetEntry(key);
      if (!p || p.n === lastN) return;
      lastN = p.n;
      drawPlot(canvas, face, label, p);
    };
    const wv = { key, el: dom, draw };
    dom._w = wv;
    watch(wv);
    return dom;
  }

  destroy(dom) { if (dom._w) live.delete(dom._w); }
}

function drawPlot(canvas, face, label, p) {
  const dpr = window.devicePixelRatio || 1;
  const w = face.clientWidth, h = face.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const count = Math.min(p.n, p.t.length);
  if (count < 2) return;
  const last = (p.n - 1) % p.t.length;
  const tEnd = p.t[last], tStart = tEnd - p.seconds;
  let lo = p.min, hi = p.max;
  if (lo == null || hi == null) {
    let a = Infinity, b = -Infinity;
    for (let k = 0; k < count; k++) {
      const i = (p.n - 1 - k) % p.t.length;
      if (p.t[i] < tStart) break;
      a = Math.min(a, p.v[i]);
      b = Math.max(b, p.v[i]);
    }
    lo ??= a;
    hi ??= b;
    if (hi - lo < 1e-9) { lo -= 0.5; hi += 0.5; }
  }
  const pad = 3;
  const y = (v) => pad + (1 - (v - lo) / (hi - lo)) * (h - 2 * pad);
  ctx.strokeStyle = getComputedStyle(face).getPropertyValue('--w-fill') || '#61afef';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let k = 0; k < count; k++) {
    const i = (p.n - 1 - k) % p.t.length;
    if (p.t[i] < tStart) break;
    const x = ((p.t[i] - tStart) / p.seconds) * w;
    if (k === 0) ctx.moveTo(x, y(p.v[i]));
    else ctx.lineTo(x, y(p.v[i]));
  }
  ctx.stroke();
  const f = (v) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(1) : v.toFixed(2));
  label.textContent = `${f(lo)} … ${f(hi)}`;
}

// --- capture -----------------------------------------------------------------

// Every control moved in the last phrase gains .record(bars, take) and plays
// it from now on. Returns what was captured, or null.
export function captureWidgets(view) {
  const got = captureTakes();
  if (!got) return null;
  for (const c of got.controls) {
    const pos = posOf(view, c.key);
    const call = pos != null && callAt(view.state.doc, pos, c.kind);
    if (!call) continue;
    const args = `${c.bars}, '${c.text}'`;
    const change = call.record
      ? { from: call.record.open + 1, to: call.record.close, insert: args }
      : { from: call.close + 1, insert: `.record(${args})` };
    view.dispatch({ changes: change, userEvent: WIDGET_EVENT });
    const after = callAt(view.state.doc, posOf(view, c.key), c.kind);
    const t = after?.record?.args[1];
    if (t) foldTake(view, t.from, t.to);
  }
  return got;
}

// --- the menu ----------------------------------------------------------------

// The number under pos, when it isn't already a widget's: { from, to, value }.
function numberAt(state, pos) {
  const line = state.doc.lineAt(pos);
  const re = /-?(?:\d+\.?\d*|\.\d+)/g;
  let m;
  while ((m = re.exec(line.text))) {
    const from = line.from + m.index, to = from + m[0].length;
    if (/[\w$#.]/.test(line.text[m.index - 1] ?? '') && !m[0].startsWith('.')) continue;
    if (pos >= from && pos <= to) return { from, to, value: Number(m[0]) };
  }
  return null;
}

// a range for a number that isn't 0..1: up to the next 1, 2 or 5 past twice it
function rangeFor(v) {
  if (v >= 0 && v <= 1) return '';
  const r = Math.abs(v) * 2;
  const p = 10 ** Math.floor(Math.log10(r));
  const nice = [1, 2, 5, 10].map((k) => k * p).find((k) => k >= r);
  return v < 0 ? `, ${-nice}, ${nice}` : `, 0, ${nice}`;
}

function codeMenu(view, e, { onRun, onCapture }) {
  const items = [];
  const cellsDom = e.target.closest?.('.cm-w-cells');
  const sites = view.state.field(sitesField);
  if (cellsDom) {
    const pos = view.posAtDOM(cellsDom);
    const s = sites.find((x) => GRIDS.has(x.kind) && pos >= x.pos && pos <= (callAt(view.state.doc, x.pos, x.kind)?.close ?? -1));
    if (s) items.push({ label: 'edit as text', run: () => view.dispatch({ effects: setTextMode.of({ key: s.key, on: true }) }) });
  } else if (!e.target.closest?.('.cm-w')) {
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
    if (pos == null) return false;
    const grid = sites.find((x) => GRIDS.has(x.kind) && view.state.field(textModeField).has(x.key)
      && pos >= x.pos && pos <= (callAt(view.state.doc, x.pos, x.kind)?.close ?? -1));
    if (grid) items.push({ label: grid.kind === 'sliders' ? 'show as bars' : 'show as cells', run: () => view.dispatch({ effects: setTextMode.of({ key: grid.key, on: false }) }) });
    const num = !isControlArg(view, pos) && numberAt(view.state, pos);
    if (num) {
      for (const kind of ['slider', 'knob']) {
        items.push({
          label: `${kind} from ${num.value}`,
          run: () => {
            view.dispatch({ changes: { from: num.from, to: num.to, insert: `${kind}(${num.value}${rangeFor(num.value)})` } });
            onRun?.(view.state.doc.toString());
          },
        });
      }
    }
  }
  // on a control, capture is the menu: it's what a right-click there is for
  const onControl = !cellsDom && !!e.target.closest?.('.cm-w');
  if (!items.length && !onControl) return false;
  items.push({ label: 'capture movements', run: () => onCapture?.() });
  e.preventDefault();
  showMenu(e.clientX, e.clientY, items);
  return true;
}

export function widgetsEditor({ onRun, onChange, onCapture } = {}) {
  // the address bar follows a widget's writes once they stop (main.js)
  const settle = EditorView.updateListener.of((u) => {
    if (u.docChanged && u.transactions.some((tr) => tr.isUserEvent(WIDGET_EVENT) || tr.isUserEvent('input.scrub'))) {
      onChange?.(u.state.doc.toString());
    }
  });
  const menu = EditorView.domEventHandlers({ contextmenu: (e, view) => codeMenu(view, e, { onRun, onCapture }) });
  return [textModeField, sitesField, decoField, followText, settle, menu];
}
