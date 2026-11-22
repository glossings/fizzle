// The text side of the controls (widgets.js): where a slider(), knob(),
// toggle(), button() or xy() call sits in a sketch, what its arguments are, and
// the .record() chained onto it. The engine reads this to tie a running control
// to the call that made it; the editor reads it to draw the control and to write
// a drag back into the code.

import { javascriptLanguage } from '@codemirror/lang-javascript';

export const CONTROL_KINDS = ['slider', 'knob', 'toggle', 'button', 'xy'];
export const GRID_KINDS = ['steps', 'sliders', 'matrix'];
export const WIDGET_KINDS = [...CONTROL_KINDS, ...GRID_KINDS, 'plot'];
const KIND_SET = new Set(WIDGET_KINDS);

// how many leading arguments hold the control's value: the ones a drag rewrites
export const VALUE_ARGS = { slider: 1, knob: 1, toggle: 1, button: 0, xy: 2 };

// Every widget call in src, in order: { kind, from } with `from` at the name.
// A control or a grid is a bare name (thing.slider() is someone else's
// method); .plot() is the one that's a method.
export function widgetSites(src) {
  if (!WIDGET_KINDS.some((k) => src.includes(k))) return [];
  const out = [];
  javascriptLanguage.parser.parse(src).iterate({
    enter(n) {
      if (n.name !== 'CallExpression') return;
      const callee = n.node.firstChild;
      let nameNode = null;
      if (callee?.name === 'VariableName') nameNode = callee;
      else if (callee?.name === 'MemberExpression' && callee.lastChild?.name === 'PropertyName') nameNode = callee.lastChild;
      if (!nameNode) return;
      const kind = src.slice(nameNode.from, nameNode.to);
      if (!KIND_SET.has(kind) || (kind === 'plot') !== (callee.name === 'MemberExpression')) return;
      const call = readCall(src, nameNode.from);
      if (call) out.push({ kind, from: nameNode.from, ...call });
    },
  });
  return out;
}

// For a browser whose stacks carry no positions: src with each widget call
// handing its own offset over (widgets.js siteCall), so a control finds its
// call without the stack. `slider(` runs as `__fzSite(12, slider)(`, and
// `.plot(` as `[__fzSite.member(30, 'plot')](`.
export const SITE_HOOK = '__fzSite';

export function tagSites(src) {
  const edits = [];
  for (const s of widgetSites(src)) {
    const end = s.from + s.kind.length;
    if (s.kind !== 'plot') {
      edits.push([s.from, end, `${SITE_HOOK}(${s.from}, ${s.kind})`]);
      continue;
    }
    let dot = s.from - 1;
    while (dot > 0 && /\s/.test(src[dot])) dot--;
    if (src[dot] !== '.' || src[dot - 1] === '?') continue;
    edits.push([dot, end, `[${SITE_HOOK}.member(${s.from}, 'plot')]`]);
  }
  let out = src;
  for (const [a, b, text] of edits.sort((x, y) => y[0] - x[0])) out = out.slice(0, a) + text + out.slice(b);
  return out;
}

// The rows of a matrix({ name: "x . x .", ... }) object: each string-valued
// key, as { name, from, to, text } with from/to around the quoted string.
export function matrixRows(objText, offset = 0) {
  const rows = [];
  const re = /([A-Za-z_$][\w$]*|\d+|"[^"]*"|'[^']*')\s*:\s*(["'`])([^"'`]*)\2/g;
  let m;
  while ((m = re.exec(objText))) {
    const from = offset + m.index + m[0].length - m[3].length - 2;
    rows.push({ name: m[1].replace(/^["']|["']$/g, ''), from, to: offset + m.index + m[0].length, text: m[3] });
  }
  return rows;
}

// A row as written: 'x' (or a number) plays, '.' rests. Kept as tokens, so a
// rewrite keeps whatever the row was spelled with.
export const rowTokens = (text) => (text.trim() ? text.trim().split(/\s+/) : []);
export const isRest = (tok) => tok === '.' || tok === '~' || tok === '-' || tok === '0';

// A string literal's quote and contents, or null.
export function literalString(text) {
  const m = /^(["'`])([^"'`]*)\1$/.exec(String(text ?? '').trim());
  return m ? { quote: m[1], text: m[2] } : null;
}

// The top-level arguments of the call whose '(' is at `open`, each as
// { from, to, text } trimmed of whitespace, plus where its ')' is. Strings and
// comments are skipped, so a comma or a paren inside one doesn't split.
function readArgs(text, open) {
  const args = [];
  let depth = 0;
  let start = open + 1;
  const push = (end) => {
    let a = start, b = end;
    while (a < b && /\s/.test(text[a])) a++;
    while (b > a && /\s/.test(text[b - 1])) b--;
    args.push({ from: a, to: b, text: text.slice(a, b) });
  };
  for (let i = open + 1; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === '`') {
      for (i++; i < text.length && text[i] !== c; i++) if (text[i] === '\\') i++;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? text.length : end + 1;
    } else if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') depth--;
    else if (c === ')') {
      if (depth === 0) {
        push(i);
        // `()` is no arguments, not one empty one
        if (args.length === 1 && !args[0].text) args.length = 0;
        return { args, close: i };
      }
      depth--;
    } else if (c === ',' && depth === 0) {
      push(i);
      start = i + 1;
    }
  }
  return null;
}

// The call at `from` (its name): { name, open, close, args, record }, where
// record is the .record(...) chained straight onto it, or null.
export function readCall(text, from) {
  const m = /^([A-Za-z_$][\w$]*)\s*\(/.exec(text.slice(from, from + 64));
  if (!m) return null;
  const open = from + m[0].length - 1;
  const call = readArgs(text, open);
  if (!call) return null;
  let record = null;
  const r = /^\s*\.\s*record\s*\(/.exec(text.slice(call.close + 1, call.close + 200));
  if (r) {
    const rOpen = call.close + r[0].length;
    const rec = readArgs(text, rOpen);
    if (rec) record = { open: rOpen, ...rec };
  }
  return { name: m[1], open, close: call.close, args: call.args, record };
}

// A number literal as written in code, or null for anything else.
export function literalNumber(text) {
  const t = String(text ?? '').trim();
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

// A take as written in .record(bars, '...'): its text, or null.
export function literalTake(text) {
  const m = /^(['"`])([A-Za-z0-9_-]*)\1$/.exec(String(text ?? '').trim());
  return m ? m[2] : null;
}

// `value` clamped to [min, max] and snapped to `step` (counted from min).
export function snapValue(value, min, max, step = null) {
  const lo = Math.min(min, max), hi = Math.max(min, max);
  let v = Math.min(hi, Math.max(lo, Number(value)));
  if (step && step > 0) v = lo + Math.round((v - lo) / step) * step;
  return Math.min(hi, Math.max(lo, v));
}

// Decimals a control writes with: the step's own, else enough to move by about
// a thousandth of the range, so 0..1 writes 0.42 and 0..100 writes 42.
export function decimalsFor(min, max, step = null) {
  if (step && step > 0) {
    const s = String(step);
    if (s.includes('e-')) return Math.min(6, Number(s.split('e-')[1]));
    const dot = s.indexOf('.');
    return dot < 0 ? 0 : Math.min(6, s.length - dot - 1);
  }
  const span = Math.abs(max - min) || 1;
  return Math.max(0, Math.min(4, Math.ceil(-Math.log10(span / 1000)) - 1));
}

// at most `decimals`, without the trailing zeros: 0.5, not 0.50
export function formatValue(v, decimals) {
  let s = v.toFixed(decimals);
  if (s.includes('.')) s = s.replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
}

// --- takes -------------------------------------------------------------------
//
// A take is a loop of positions, 0..1 across the control's range, sampled
// TAKE_RATE times a beat. Written into the code as two base64url characters a
// sample (4096 levels), an xy pad's two axes interleaved.

export const TAKE_RATE = 16;
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64_AT = new Map([...B64].map((c, i) => [c, i]));

export const takeLength = (bars, dims) => Math.max(1, Math.round(bars * 4 * TAKE_RATE)) * dims;

export function encodeTake(samples) {
  let s = '';
  for (const p of samples) {
    const q = Math.round(Math.min(1, Math.max(0, p)) * 4095);
    s += B64[q >> 6] + B64[q & 63];
  }
  return s;
}

// Decoded to `length` samples: a take written for fewer bars than the call now
// asks for is padded with its last frame, a longer one is cut.
export function decodeTake(text, length, dims) {
  const out = new Float32Array(length);
  const n = Math.floor(text.length / 2);
  if (!n) return null;
  for (let i = 0; i < length; i++) {
    let j = i;
    if (j >= n) j = n - dims + (i % dims);
    const hi = B64_AT.get(text[2 * j]) ?? 0, lo = B64_AT.get(text[2 * j + 1]) ?? 0;
    out[i] = ((hi << 6) | lo) / 4095;
  }
  return out;
}
