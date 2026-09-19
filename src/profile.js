// Per-op frame cost, for the sidebar's profile panel. Scopes nest and time is
// charged to the innermost one, so a row is an op's own cost and not its
// inputs'. GPU time comes from timer queries where the browser has them; only
// one can be open at a time, so entering a scope closes the outer one's and
// leaving reopens it.

const WINDOW = 30; // frames averaged into each report

let gl = null;
let ext = null;
let want = false;
let on = false;
let cur = null;      // the site being charged right now
let cpuT = 0;
let frames = 0;
const stack = [];
const free = [];     // timer queries to reuse
const pending = [];  // { q, site }, oldest first
const live = new Set();
const tags = new WeakMap();

export const profile = { rows: [], gpu: false };

// A thing that costs time. `at` is where in the sketch it was made, read off
// the stack only once a report wants it.
export const site = (label, named = false) => ({ label, named, at: new Error(), gpu: 0, cpu: 0 });
const fixed = (label) => ({ label, at: null, gpu: 0, cpu: 0 });

export const PASS_3D = fixed('3d render');
const REST = fixed('everything else');
const UPDATERS = fixed('camera, fog…');

export const tag = (fn, s) => { tags.set(fn, s); };
export const tagOf = (fn) => tags.get(fn) ?? UPDATERS;

// Sketch code runs inside new Function (Engine.run), whose frames read
// <anonymous>:line in Chrome and "> Function:line" in Firefox, counted from a
// wrapper that differs by browser. The same wrapper around a probe says which
// line is the sketch's first.
const FRAME = /(?:<anonymous>|> Function):(\d+)/;
let firstLine;
function locate(s) {
  if (s.line !== undefined || !s.at) return;
  s.line = null;
  if (firstLine === undefined) {
    try {
      firstLine = Number(FRAME.exec(new Function('"use strict";\n{return new Error().stack\n}')())?.[1]) || null;
    } catch { firstLine = null; }
  }
  const lines = String(s.at.stack ?? '').split('\n');
  const i = lines.findIndex((l) => FRAME.test(l));
  s.at = null;
  if (i < 0 || firstLine == null) return;
  s.line = Number(FRAME.exec(lines[i])[1]) - firstLine + 1;
  // several methods share a kind (.mul() is 'math'), so the name comes from
  // the call the sketch made: the frame just under its own
  if (s.named) {
    const m = /^\s*at (?:new )?(?:[\w$]+\.)*([\w$]+) \(|^([\w$]+)@/.exec(lines[i - 1] ?? '');
    const name = m?.[1] ?? m?.[2];
    if (name && !name.startsWith('_') && name !== 'TextureOp') s.label = name;
  }
}

// Chrome on Metal times a query by the command buffers it touched, whole, so
// scopes sharing a buffer would each be charged all of it. What ends a buffer
// is reading back something it wrote (flush and finish are deferred, and a
// read of an untouched target waits for nothing), so: clear a pixel of our
// own, read it, and put the bindings back under three's cache.
let syncFb = null;
const px = new Uint8Array(4);
const zero = new Float32Array(4);
function sync() {
  const draw = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING);
  const read = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
  if (!syncFb) {
    syncFb = gl.createFramebuffer();
    const rb = gl.createRenderbuffer();
    const prevRb = gl.getParameter(gl.RENDERBUFFER_BINDING);
    gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, 1, 1);
    gl.bindRenderbuffer(gl.RENDERBUFFER, prevRb);
    gl.bindFramebuffer(gl.FRAMEBUFFER, syncFb);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, rb);
  } else gl.bindFramebuffer(gl.FRAMEBUFFER, syncFb);
  gl.clearBufferfv(gl.COLOR, 0, zero);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, draw);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, read);
}

function mark(next) {
  if (cur) cur.cpu += performance.now() - cpuT;
  if (ext) {
    if (cur) {
      sync();
      gl.endQuery(ext.TIME_ELAPSED_EXT);
    }
    if (next) {
      const q = free.pop() ?? gl.createQuery();
      gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
      pending.push({ q, site: next });
    }
  }
  cpuT = performance.now(); // after the sync, whose wait is nobody's cost
  cur = next;
}

export function begin(s) {
  if (!on) return;
  stack.push(cur);
  live.add(s);
  mark(s);
}

export function end() {
  if (!on || !stack.length) return;
  mark(stack.pop());
}

export function setProfiling(v) { want = v; }

export function frameStart(renderer) {
  if (want !== on) {
    mark(null);
    on = want;
    if (on && !gl) {
      gl = renderer.getContext();
      ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
      profile.gpu = !!ext;
    }
    frames = 0;
    live.clear();
    profile.rows = [];
  }
  if (!on) return;
  // a throw between a begin and its end leaves the stack wrong for one frame
  stack.length = 0;
  mark(null);
  live.add(REST);
  mark(REST);
}

export function frameEnd() {
  if (!on) return;
  mark(null);
  stack.length = 0;
  if (ext) {
    // a disjoint (the GPU was reset or throttled mid-query) voids what's waiting
    const bad = gl.getParameter(ext.GPU_DISJOINT_EXT);
    let n = 0;
    while (n < pending.length && gl.getQueryParameter(pending[n].q, gl.QUERY_RESULT_AVAILABLE)) {
      const p = pending[n++];
      if (!bad) p.site.gpu += gl.getQueryParameter(p.q, gl.QUERY_RESULT) / 1e6;
      free.push(p.q);
    }
    pending.splice(0, n);
  }
  if (++frames < WINDOW) return;
  profile.rows = [...live].map((s) => {
    locate(s);
    const row = { label: s.label, line: s.line ?? null, gpu: s.gpu / frames, cpu: s.cpu / frames };
    s.gpu = s.cpu = 0;
    return row;
  }).sort((a, b) => (b.gpu + b.cpu) - (a.gpu + a.cpu));
  live.clear();
  frames = 0;
}
