// Contextual autocomplete and ctrl+hover docs — one module, because both come
// down to the same question: what is the cursor pointing at?
//
// The point is live-coding ergonomics: what you can't remember on stage is
// which keys `.material({` takes and what you called that video file, and the
// answer to both is already in the program — the docs table and IndexedDB.
// So the completion source asks where the cursor is (lezer has already parsed
// the buffer for syntax highlighting; resolveInner is a tree walk, not a parse)
// and answers narrowly:
//
//   inside a config's braces  -> only that call's keys
//   after a key's colon       -> its literal values, generators of the right
//                                shape first, then everything (a value can be
//                                any expression, so nothing is hidden)
//   inside a string           -> imported filenames the call can actually use
//   after a dot               -> only the methods that chain's kind has
//
// Falling back to the full list whenever the walk can't tell is deliberate:
// a wrong answer costs a re-run mid-set, a missing one costs a keystroke.

import { hoverTooltip } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { MAP_SLOTS, IMAGE_RE, HDRI_RE } from './pbr.js';
import { mediaList } from './media.js';
import {
  GLOBALS, METHODS, GLOBAL_CONFIG, METHOD_CONFIG, NESTED_CONFIG,
  GLOBAL_KIND, METHOD_KINDS, CALLBACK_KIND, docDom, keyEntry,
} from './docs.js';

// no detail: the info panel's own header is the signature, and printing it on
// the row too just says it twice
const globalOptions = Object.entries(GLOBALS).map(([label, entry]) => ({
  label, type: 'function', info: () => docDom(entry),
}));
const methodOptions = Object.entries(METHODS).map(([label, entry]) => ({
  label, type: 'method', info: () => docDom(entry),
}));

// one filtered method list per chain kind, built once
const methodsByKind = {};
for (const kind of ['geo', 'light', 'top', 'signal', 'inst']) {
  methodsByKind[kind] = methodOptions.filter((o) => METHOD_KINDS[o.label]?.has(kind));
}

// globals grouped by what they produce, for boosting at a value position
const kindGlobals = (kind) => globalOptions.filter((o) => GLOBAL_KIND[o.label] === kind);
const TOP_GLOBALS = kindGlobals('top');
const SIGNAL_GLOBALS = kindGlobals('signal');

// --- tree helpers ----------------------------------------------------------

const textOf = (state, node) => state.doc.sliceString(node.from, node.to);

// the outermost node ending exactly at pos — the expression to the left of a
// dot, whatever its depth
function exprEndingAt(state, pos) {
  let n = syntaxTree(state).resolveInner(pos, -1);
  while (n.parent && n.parent.to === pos) n = n.parent;
  return n;
}

// Walk an expression down its left spine to the call that started it:
// sphere().material({…}).noise() -> sphere. Returns a chain kind, or null when
// the spine runs into something we can't reason about.
function chainKind(state, node, depth = 0) {
  if (!node || depth > 40) return null;
  switch (node.name) {
    case 'CallExpression':
    case 'MemberExpression':
      return chainKind(state, node.firstChild, depth + 1);
    case 'ParenthesizedExpression':
      return chainKind(state, node.firstChild?.nextSibling, depth + 1);
    case 'VariableName':
      return kindOfName(state, node);
    default:
      return null;
  }
}

// A bare name is either a global, a callback parameter, or a variable holding
// one of those.
function kindOfName(state, node) {
  const name = textOf(state, node);
  if (GLOBAL_KIND[name]) return GLOBAL_KIND[name];

  // .instance(20, x => x.…) — x is whatever the method hands its callback
  for (let n = node.parent; n; n = n.parent) {
    if (n.name !== 'ArrowFunction' && n.name !== 'FunctionExpression') continue;
    if (!paramNames(state, n).includes(name)) continue;
    const call = n.parent?.name === 'ArgList' ? n.parent.parent : null;
    const kind = call && CALLBACK_KIND[calleeName(state, call)?.name];
    if (kind) return kind;
  }

  // const s = scene() — the last such binding before this point wins
  const before = state.doc.sliceString(0, node.from);
  const re = new RegExp(`(?:const|let|var)\\s+${name.replace(/\$/g, '\\$')}\\s*=\\s*([A-Za-z_$][\\w$]*)`, 'g');
  let init = null, m;
  while ((m = re.exec(before))) init = m[1];
  return init ? GLOBAL_KIND[init] ?? null : null;
}

function paramNames(state, fn) {
  const head = fn.firstChild;
  if (!head) return [];
  return textOf(state, head).replace(/[()]/g, '').split(',').map((s) => s.trim());
}

// { name, method } for a CallExpression's callee
function calleeName(state, call) {
  const f = call?.firstChild;
  if (!f) return null;
  if (f.name === 'VariableName') return { name: textOf(state, f), method: false };
  if (f.name === 'MemberExpression') {
    const prop = f.lastChild;
    if (prop?.name === 'PropertyName') return { name: textOf(state, prop), method: true };
  }
  return null;
}

// `.noise({` and `noise({` are different calls with different keys, so the
// entry has to come from the same table the keys did.
// `.noise({` and `noise({` are different calls with different keys, so both the
// keys and the label the tooltip prints have to follow which one it was.
const configFor = (state, call) => {
  const callee = calleeName(state, call);
  if (!callee) return null;
  const { name, method } = callee;
  const keys = method ? METHOD_CONFIG[name] : GLOBAL_CONFIG[name] ?? METHOD_CONFIG[name];
  return keys && { label: (method ? '.' : '') + name, keys };
};

// The config object the cursor sits in, the call it belongs to, and the key it
// sits under (null when it's at a key rather than in a value). Handles nesting:
// directional({ shadow: { … } }) resolves to .shadow()'s own options.
function configContext(state, node, pos) {
  let obj = null;
  for (let n = node; n; n = n.parent) {
    // an incomplete `{ col` parses as a destructuring pattern, not an object
    if (n.name === 'ObjectExpression' || n.name === 'ObjectPattern') { obj = n; break; }
    if (n.name === 'Block' || n.name === 'Script') return null;
  }
  if (!obj) return null;

  const parent = obj.parent;
  let found = null;
  if (parent?.name === 'ArgList') found = configFor(state, parent.parent);
  else if (parent?.name === 'Property') {
    const key = propertyKey(state, parent);
    const keys = NESTED_CONFIG[key];
    found = keys && { label: `.${key}`, keys };
  // `{ col` misparses far enough that the ObjectPattern's parent is an
  // AssignmentExpression sitting in the ArgList
  } else if (parent?.name === 'AssignmentExpression' && parent.parent?.name === 'ArgList') {
    found = configFor(state, parent.parent.parent);
  }
  if (!found) return null;

  return { ...found, key: keyUnderCursor(state, obj, pos) };
}

const propertyKey = (state, prop) => {
  const first = prop.firstChild;
  return first ? textOf(state, first) : null;
};

// which property's *value* the cursor is in, or null if it's at a key
function keyUnderCursor(state, obj, pos) {
  for (let n = obj.firstChild; n; n = n.nextSibling) {
    if (n.name !== 'Property' && n.name !== 'PatternProperty') continue;
    if (pos <= n.from || pos > n.to) continue;
    const key = propertyKey(state, n);
    const colon = state.doc.sliceString(n.from, pos).indexOf(':');
    return colon >= 0 ? key : null;
  }
  return null;
}

// --- media -----------------------------------------------------------------

const AUDIO_RE = /\.(mp3|wav|ogg|m4a|flac|aac)$/i;
const VIDEO_RE = /\.(mp4|mov|webm|m4v|mkv)$/i;
const MODEL_RE = /\.(obj|fbx)$/i;
const MEDIA_RE = { image: IMAGE_RE, hdri: HDRI_RE, audio: AUDIO_RE, video: VIDEO_RE, model: MODEL_RE };

// first-argument filename slots
const MEDIA_ARG = {
  imagefile: 'image', imageseq: 'image', videofile: 'video',
  audiofile: 'audio', model: 'model', hdri: 'hdri',
};
const TEXTURE_KEYS = new Set([...MAP_SLOTS, 'arm']);

async function mediaOptions(kind) {
  const all = await mediaList();
  // pbr: names a whole folder of maps, not one file
  if (kind === 'pbr') {
    const dirs = [...new Set(all.filter((n) => n.includes('/')).map((n) => n.split('/')[0]))];
    return dirs.map((label) => ({ label, type: 'constant', detail: 'material' }));
  }
  return all
    .filter((n) => MEDIA_RE[kind].test(n))
    .map((label) => ({ label, type: 'constant', detail: label.includes('/') ? 'set' : 'file' }));
}

// --- completion source -----------------------------------------------------

export function apiCompletions(context) {
  const { state, pos } = context;
  const node = syntaxTree(state).resolveInner(pos, -1);

  if (node.name === 'String') return stringCompletions(context, node);

  // before the config check, so a chain started inside a value
  // (`{ map: video().` ) still completes as a chain
  const dot = context.matchBefore(/\.(\w*)$/);
  const receiver = dot && exprEndingAt(state, dot.from);
  if (receiver && receiver.name !== 'Number') {
    const kind = chainKind(state, receiver);
    return { from: dot.from + 1, options: methodsByKind[kind] ?? methodOptions, validFor: /^\w*$/ };
  }

  const config = configContext(state, node, pos);
  if (config) {
    return config.key
      ? valueCompletions(context, config.keys.get(config.key))
      : keyCompletions(context, config);
  }

  const word = context.matchBefore(/\w+$/);
  if (!word && !context.explicit) return null;
  return { from: word ? word.from : pos, options: globalOptions, validFor: /^\w*$/ };
}

function keyCompletions(context, { label: call, keys }) {
  const word = context.matchBefore(/\w*$/);
  const options = [...keys.values()].map((spec) => ({
    label: spec.key,
    type: 'property',
    detail: spec.hint || undefined,
    section: spec.section,
    info: spec.doc ? () => docDom(keyEntry(call, spec)) : undefined,
  }));
  return { from: word ? word.from : context.pos, options, validFor: /^\w*$/ };
}

// A value can be any expression, so this adds rather than restricts: the
// literals the key accepts and the generators of its shape sort to the top,
// with the full global list underneath.
function valueCompletions(context, spec) {
  if (!spec) return null;
  const shaped = spec.values
    ? spec.values.map((v) => ({ label: `'${v}'`, type: 'enum', boost: 99 }))
    : (TEXTURE_KEYS.has(spec.key) ? TOP_GLOBALS : SIGNAL_GLOBALS).map((o) => ({ ...o, boost: 50 }));

  // With nothing typed, only what the key is shaped for — five signal
  // generators over `speed:` is a useful nudge, forty globals is a wall. Once
  // there's a prefix to filter on, everything is fair game again: a value can
  // be any expression and this shouldn't be the thing that hides one.
  const word = context.matchBefore(/\w+$/);
  const options = [...shaped];
  if (word || context.explicit) {
    const seen = new Set(shaped.map((o) => o.label));
    options.push(...globalOptions.filter((o) => !seen.has(o.label)));
  }
  return { from: word ? word.from : context.pos, options, validFor: /^\w*$/ };
}

// Inside quotes: the imported files this slot can use, or the key's literals.
async function stringCompletions(context, node) {
  const { state } = context;
  // imageseq(['a.png', 'b.png']) — the array is the argument, the string is in it
  const parent = node.parent?.name === 'ArrayExpression' ? node.parent.parent : node.parent;
  const inArray = parent !== node.parent;
  let kind = null;

  if (parent?.name === 'ArgList') {
    const callee = calleeName(state, parent.parent);
    // only the first argument names a file
    if (callee && !callee.method && (inArray || node.from === firstArgStart(parent))) {
      kind = MEDIA_ARG[callee.name] ?? null;
    }
  } else if (parent?.name === 'Property') {
    const key = propertyKey(state, parent);
    if (key === 'pbr') kind = 'pbr';
    else if (TEXTURE_KEYS.has(key)) kind = 'image';
    else {
      const spec = configContext(state, node, context.pos)?.keys.get(key);
      if (spec?.values) {
        return {
          from: node.from + 1,
          options: spec.values.map((label) => ({ label, type: 'enum' })),
          validFor: /^[\w-]*$/,
        };
      }
    }
  }
  if (!kind) return null;
  const options = await mediaOptions(kind);
  if (!options.length) return null;
  // the quotes are already typed — replace what's between them
  const raw = textOf(state, node);
  return {
    from: node.from + 1,
    to: Math.max(context.pos, node.to - (raw.length > 1 && /['"]$/.test(raw) ? 1 : 0)),
    options,
    validFor: /^[^'"]*$/,
  };
}

// named grammar nodes start with a letter; punctuation tokens are `(`, `,`, …
function firstArgStart(argList) {
  for (let n = argList.firstChild; n; n = n.nextSibling) {
    if (/^\w/.test(n.name)) return n.from;
  }
  return -1;
}

// --- ctrl+hover docs -------------------------------------------------------

let ctrlHeld = false;
window.addEventListener('keydown', (e) => { if (e.key === 'Control') ctrlHeld = true; });
window.addEventListener('keyup', (e) => { if (e.key === 'Control') ctrlHeld = false; });
window.addEventListener('blur', () => { ctrlHeld = false; });

// The word is a key of the config it sits in, rather than a call of its own —
// hovering `sheen` inside .material({ }) should describe sheen, not fail to
// find a global by that name.
function configKeyAt(state, pos, word) {
  const ctx = configContext(state, syntaxTree(state).resolveInner(pos, 1), pos);
  if (!ctx || ctx.key) return null; // ctx.key set means the cursor is in a value
  const spec = ctx.keys.get(word);
  return spec?.doc ? { label: ctx.label, spec } : null;
}

// What the word at `pos` documents: a config key, a chain method, or a global.
// Returns { range, entry } for docDom, or null if it documents nothing. A key
// gets its own line or nothing — falling back to the owning call's prose just
// answers a question nobody asked.
export function docAt(state, pos) {
  const range = state.wordAt(pos);
  if (!range) return null;
  const word = state.doc.sliceString(range.from, range.to);

  const key = configKeyAt(state, range.from, word);
  if (key) return { range, entry: keyEntry(key.label, key.spec) };

  const isMethod = range.from > 0 && state.doc.sliceString(range.from - 1, range.from) === '.';
  const entry = isMethod ? METHODS[word] : GLOBALS[word] ?? METHODS[word];
  return entry ? { range, entry } : null;
}

export const apiHover = hoverTooltip((view, pos) => {
  if (!ctrlHeld) return null;
  const found = docAt(view.state, pos);
  if (!found) return null;
  return {
    pos: found.range.from,
    end: found.range.to,
    above: true,
    create: () => ({ dom: docDom(found.entry) }),
  };
}, { hoverTime: 120 });
