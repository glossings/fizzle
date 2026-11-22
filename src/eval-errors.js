// Where in the sketch a run went wrong, as { from, to, line, col, text }.
//
// Syntax errors carry no position from the engine, so the source is parsed
// again with acorn, and an unbalanced bracket is reported at the bracket rather
// than wherever the parser gave up. Runtime errors are found on the stack: the
// sketch is compiled with a //# sourceURL naming the run, so its frames read
// fizzle-sketch-N:line:col. Ported from poptart's eval-errors.mjs.

import { parse, tokenizer, tokTypes as tt } from 'acorn';
import { METHODS } from './docs.js';

const PREFIX = 'fizzle-sketch-';
let serial = 0;

// The tag for one run's compiled source; frames carrying it belong to this run.
export function sketchTag() {
  const id = `${PREFIX}${++serial}`;
  return { id, comment: `\n//# sourceURL=${id}` };
}

// The engine's wrapper, `"use strict";\n{` + src + `\n}`, puts the sketch a
// browser-dependent number of lines down. One probe says how many: `new` sits
// at sketch line 2, column 8.
let shift;
function wrapperShift() {
  if (shift !== undefined) return shift;
  shift = null;
  try {
    const { id, comment } = sketchTag();
    const stack = new Function(`"use strict";\n{\nreturn new Error().stack\n}${comment}`)();
    const m = new RegExp(`${id}:(\\d+):(\\d+)`).exec(stack);
    if (m) shift = { line: Number(m[1]) - 2, col: Number(m[2]) - 8 };
  } catch { /* no positions in this browser */ }
  return shift;
}

const offsetOf = (src, line, col) => {
  let at = 0;
  for (let l = 1; l < line; l++) {
    const nl = src.indexOf('\n', at);
    if (nl < 0) return src.length;
    at = nl + 1;
  }
  return Math.min(src.length, at + Math.max(0, col - 1));
};

export function lineCol(src, at) {
  const before = src.slice(0, Math.max(0, at));
  return { line: before.split('\n').length, col: at - (before.lastIndexOf('\n') + 1) + 1 };
}

// The innermost frame inside the run tagged `id`, as an offset into src.
export function stackOffset(stack, id, src) {
  const s = wrapperShift();
  if (!s || typeof stack !== 'string') return null;
  const m = new RegExp(`${id}:(\\d+):(\\d+)`).exec(stack);
  if (!m) return null;
  const line = Number(m[1]) - s.line;
  // the wrapper's `{` sits in front of the sketch's first line
  const col = Number(m[2]) - s.col - (line === 1 ? 1 : 0);
  if (line < 1) return null;
  return offsetOf(src, line, col);
}

const CLOSER = { '(': ')', '[': ']', '{': '}', '${': '}' };
const OPENERS = new Map([[tt.parenL, '('], [tt.bracketL, '['], [tt.braceL, '{'], [tt.dollarBraceL, '${']]);
const CLOSERS = new Map([[tt.parenR, ')'], [tt.bracketR, ']'], [tt.braceR, '}']]);

// The first bracket that doesn't balance: a closer with nothing open, a closer
// of the wrong kind, or the innermost bracket still open at the end.
export function bracketProblem(src) {
  const open = [];
  try {
    for (const tok of tokenizer(src, { ecmaVersion: 'latest' })) {
      const opener = OPENERS.get(tok.type);
      if (opener) { open.push({ ch: opener, at: tok.start }); continue; }
      const ch = CLOSERS.get(tok.type);
      if (!ch) continue;
      const top = open.pop();
      if (!top) return { at: tok.start, text: `unexpected "${ch}"` };
      if (CLOSER[top.ch] !== ch) return { at: tok.start, text: `missing "${CLOSER[top.ch]}"` };
    }
  } catch { /* stopped early: judge what was read */ }
  const top = open.at(-1);
  return top ? { at: top.at, text: `missing "${CLOSER[top.ch]}"` } : null;
}

const KEYWORDS = ['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'new', 'true', 'false', 'null', 'undefined', 'typeof'];

const tokenAt = (src, at) => {
  const m = /^(?:[A-Za-z_$][\w$]*|\d[\w.]*)/.exec(src.slice(at));
  return m ? m[0] : src.charAt(at);
};

// `cosnt x = 1`: the parser stops at `x`, but the mistake is the word before.
function keywordTypo(src, at) {
  const m = /([A-Za-z_$][\w$]*)[ \t]+$/.exec(src.slice(0, at));
  if (!m || KEYWORDS.includes(m[1])) return null;
  const suggest = nearestName(m[1], KEYWORDS);
  return suggest ? { from: m.index, to: m.index + m[1].length, text: `unexpected "${m[1]}"`, suggest } : null;
}

const STRICT = '"use strict";';

function syntaxProblem(src) {
  let perr = null;
  try {
    // strict and allowed to return, like the function body it runs as
    parse(STRICT + src, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true });
  } catch (e) { perr = e; }
  if (!perr || typeof perr.pos !== 'number') return null;
  const at = Math.max(0, Math.min(src.length, perr.pos - STRICT.length));
  const raw = String(perr.message ?? '').replace(/\s*\(\d+:\d+\)\s*$/, '');
  const span = (from, text) => ({ from, to: from + (tokenAt(src, from).length || 1), text });

  let m = /^Unterminated (string|template|comment|regular expression)/.exec(raw);
  if (m) return span(at, `unclosed ${m[1] === 'template' ? 'template string' : m[1]}`);
  if (/^Unexpected token/.test(raw)) {
    const bracket = bracketProblem(src);
    if (bracket) return span(bracket.at, bracket.text);
    const typo = keywordTypo(src, at);
    if (typo) return typo;
    if (!src.slice(at).trim()) return span(Math.max(0, src.trimEnd().length - 1), 'unexpected end of code');
    return span(at, `unexpected "${tokenAt(src, at)}"`);
  }
  if ((m = /^Unexpected (?:character|keyword) '(.+)'$/.exec(raw))) return span(at, `unexpected "${m[1]}"`);
  if ((m = /^The keyword '(.+)' is reserved$/.exec(raw))) return span(at, `"${m[1]}" is a reserved word`);
  if ((m = /^Identifier '(.+)' has already been declared$/.exec(raw))) return span(at, `"${m[1]}" is declared twice`);
  return span(at, raw.charAt(0).toLowerCase() + raw.slice(1));
}

// The closest of `candidates` to a misspelled `name`, or null: one edit for a
// short name, two for a long one, a swap of neighbors counting as one; a
// difference of case alone always counts.
export function nearestName(name, candidates) {
  const word = String(name ?? '');
  if (word.length < 2) return null;
  const list = [...candidates].filter((c) => typeof c === 'string' && c && !c.startsWith('_'));
  if (list.includes(word)) return null;
  const lower = word.toLowerCase();
  const caseOnly = list.find((c) => c.toLowerCase() === lower);
  if (caseOnly) return caseOnly;
  const limit = word.length <= 4 ? 1 : 2;
  let best = null;
  let bestD = Infinity;
  for (const c of list) {
    if (Math.abs(c.length - word.length) > limit) continue;
    const d = editDistance(lower, c.toLowerCase());
    if (d < bestD || (d === bestD && best && c[0] === word[0] && best[0] !== word[0])) { best = c; bestD = d; }
  }
  return bestD <= limit ? best : null;
}

// Damerau-Levenshtein (optimal string alignment)
function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

const identAt = (src, at) => /^[A-Za-z_$][\w$]*/.exec(src.slice(at))?.[0] ?? '';

// A runtime error about a name, reworded around the name as typed.
function namedFailure(err, src, from, globals) {
  const msg = String(err?.message ?? '');
  let m = /^([A-Za-z_$][\w$]*) is not defined$/.exec(msg) ?? /^Can't find variable: ([A-Za-z_$][\w$]*)$/.exec(msg);
  if (m) return { text: `"${m[1]}" is not defined`, suggest: nearestName(m[1], globals) };
  m = /^(?:(.*)\.)?([A-Za-z_$][\w$]*) is not a function/.exec(msg);
  if (!m) return null;
  const name = m[2];
  // V8 points a failed method call at the method's name; step onto it
  const at = from == null ? -1 : src.indexOf(name, from);
  const span = at >= 0 && at - from < 200 ? { from: at, to: at + name.length } : null;
  return m[1] !== undefined
    ? { text: `"${name}" is not a method`, suggest: nearestName(name, Object.keys(METHODS)), span }
    : { text: `"${name}" is not a function`, suggest: nearestName(name, globals), span };
}

// What went wrong running `src` (tagged `id`) and where: { from, to, line,
// col, text } with editor offsets, or null when no position is known.
// `globals` are the names a sketch can call, for "did you mean".
export function locateError(err, src, id, globals) {
  if (!err || typeof err !== 'object') return null;
  let from = null;
  let to = null;
  let text = null;
  let suggest = null;
  const at = stackOffset(err.stack, id, src);
  if (err instanceof SyntaxError && at == null) {
    const p = syntaxProblem(src);
    if (p) ({ from, to, text } = p), (suggest = p.suggest ?? null);
  } else if (at != null) {
    from = at;
    to = from + (identAt(src, from).length || 1);
    const named = namedFailure(err, src, from, globals);
    if (named) {
      text = named.text;
      suggest = named.suggest;
      if (named.span) ({ from, to } = named.span);
    } else {
      text = String(err.message ?? err);
    }
  }
  if (from == null) return null;
  const full = suggest ? `${text}, did you mean "${suggest}"?` : text;
  return { from, to: Math.max(to, from + 1), ...lineCol(src, from), text: full };
}
