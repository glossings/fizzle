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
import { syntaxTree, LanguageSupport } from '@codemirror/language';
import { javascriptLanguage, localCompletionSource } from '@codemirror/lang-javascript';
import { MAP_SLOTS, IMAGE_RE, HDRI_RE } from './pbr.js';
import { mediaList } from './media.js';
import { midiPortNames } from './control.js';
import { bandStore } from './bands.js';
import {
  GLOBALS, METHODS, GLOBAL_CONFIG, METHOD_CONFIG, NESTED_CONFIG,
  GLOBAL_ARGS, METHOD_ARGS,
  GLOBAL_KIND, METHOD_KINDS, CALLBACK_KIND, docDom, keyEntry,
} from './docs.js';

// no detail: the info panel's own header is the signature, and printing it on
// the row too just says it twice
// T and B are values you read rather than calls — same rule as the methods below
const globalOptions = Object.entries(GLOBALS).map(([label, entry]) => ({
  label, type: entry[0].includes('(') ? 'function' : 'variable', info: () => docDom(entry),
}));
// a midi()/gamepad() member that takes no argument is a signal you read, not a
// call — the signature says which, and the icon in the list should agree
const methodOptions = Object.entries(METHODS).map(([label, entry]) => ({
  label, type: entry[0].includes('(') ? 'method' : 'property', info: () => docDom(entry),
}));

// one filtered method list per chain kind, built once
const methodsByKind = {};
for (const kind of ['geo', 'particle', 'evolve', 'light', 'texture', 'signal', 'inst', 'cursor', 'layout', 'midi', 'midikey', 'gamepad']) {
  methodsByKind[kind] = methodOptions.filter((o) => METHOD_KINDS[o.label]?.has(kind));
}

// globals grouped by what they produce, for boosting at a value position
const kindGlobals = (kind) => globalOptions.filter((o) => GLOBAL_KIND[o.label] === kind);
const TEXTURE_GLOBALS = kindGlobals('texture');
// midi() and gamepad() aren't signals themselves, but what a parameter wants
// from them is — so they belong in the same nudge
const SIGNAL_GLOBALS = [...kindGlobals('signal'), ...kindGlobals('midi'), ...kindGlobals('gamepad')];

// A member whose kind doesn't depend on what it was called on: the signals a
// controller handle carries, and .particles(). .key(38) keeps a handle, but a
// narrower one — only the four key signals are on it.
const MEMBER_KIND = {
  particles: 'particle',
  // .apply(x, i) hands the copy handle back, so the chain past it is the
  // handle's — the layout is where it came from, not what it is now
  apply: 'inst',
  key: 'midikey',
  ...Object.fromEntries(
    'cc note vel gate touch bend lx ly rx ry lt rt btn'.split(' ').map((n) => [n, 'signal'])
  ),
};

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
      return chainKind(state, node.firstChild, depth + 1);
    case 'MemberExpression': {
      // Some members change what the chain is mid-spine: .particles() turns
      // whatever it was called on into a particle system, and a midi() or
      // gamepad() member is where the handle ends and a signal begins. The
      // walk stops at those instead of running on down to what started it.
      const prop = node.lastChild;
      const kind = prop?.name === 'PropertyName' ? MEMBER_KIND[textOf(state, prop)] : null;
      if (kind) return kind;
      return chainKind(state, node.firstChild, depth + 1);
    }
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

  // select() is whichever kind it was handed, so read the arguments: a texture
  // source among them makes a texture, anything else a signal. (A chain that
  // reached it through a variable reads as a signal — the common spellings
  // name the source inline.)
  if (name === 'select') {
    const args = node.nextSibling ? textOf(state, node.nextSibling) : '';
    const names = args.match(/[A-Za-z_$][\w$]*/g) ?? [];
    return names.some((w) => GLOBAL_KIND[w] === 'texture') ? 'texture' : 'signal';
  }

  if (GLOBAL_KIND[name]) return GLOBAL_KIND[name];

  // .instance(20, x => x.…) — x is whatever the method hands its callback
  for (let n = node.parent; n; n = n.parent) {
    if (n.name !== 'ArrowFunction' && n.name !== 'FunctionExpression') continue;
    if (!paramNames(state, n).includes(name)) continue;
    const call = n.parent?.name === 'ArgList' ? n.parent.parent : null;
    const kind = call && CALLBACK_KIND[calleeName(state, call)?.name];
    if (kind) return kind;
  }

  // const s = scene() — the last such binding before this point wins. The
  // whole initializer line is read, since a .particles() anywhere in it makes
  // the variable a particle system rather than whatever started the chain.
  const before = state.doc.sliceString(0, node.from);
  const re = new RegExp(`(?:const|let|var)\\s+${name.replace(/\$/g, '\\$')}\\s*=\\s*([^\\n]*)`, 'g');
  let init = null, m;
  while ((m = re.exec(before))) init = m[1];
  if (!init) return null;
  if (/\.particles\s*\(/.test(init)) return 'particle';
  const first = init.match(/[A-Za-z_$][\w$]*/);
  return first ? GLOBAL_KIND[first[0]] ?? null : null;
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

// javascript() ships its own completions — `break`, `case`, `const`, and a set
// of snippets — which crowd the list with things you already know how to type.
// The same language without that source: names declared in the sketch still
// complete, the API list is the rest.
export const sketchLanguage = new LanguageSupport(javascriptLanguage, [
  javascriptLanguage.data.of({ autocomplete: localCompletionSource }),
  javascriptLanguage.data.of({ autocomplete: apiCompletions }),
]);

export function apiCompletions(context) {
  const { state, pos } = context;
  const node = syntaxTree(state).resolveInner(pos, -1);

  // a slot whose values are known answers straight away; only the file lists
  // behind mediaList() are worth waiting on
  if (node.name === 'String') {
    return stringValues(state, node, pos)
      ?? deviceValues(state, node, pos)
      ?? bandValues(state, node, pos)
      ?? mediaCompletions(context, node);
  }

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
    : (TEXTURE_KEYS.has(spec.key) ? TEXTURE_GLOBALS : SIGNAL_GLOBALS).map((o) => ({ ...o, boost: 50 }));

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

// The span between the quotes. An unterminated string runs to the end of the
// line, and its closing quote is missing rather than at `to` — so replacing
// this range swaps the whole value out either way, and filtering matches on
// exactly what's been typed rather than on the quote too.
function stringBody(state, pos, node) {
  const raw = textOf(state, node);
  const closed = raw.length > 1 && /['"]$/.test(raw);
  return { from: node.from + 1, to: Math.max(pos, node.to - (closed ? 1 : 0)) };
}

// Literal values, wherever the cursor is: they're the whole domain of the slot,
// so they replace what's between the quotes and survive typing into it (only a
// quote ends the value, which is what validFor says).
const valueResult = (state, pos, node, values) => ({
  ...stringBody(state, pos, node),
  options: values.map((label) => ({ label, type: 'enum' })),
  validFor: /^[^'"]*$/,
});

// which argument slot a node sits in; punctuation tokens are `(`, `,`, `)` and
// named grammar nodes start with a letter, so only the arguments are counted
function argIndex(argList, node) {
  let i = 0;
  for (let n = argList.firstChild; n; n = n.nextSibling) {
    if (!/^\w/.test(n.name)) continue;
    if (n.from === node.from && n.to === node.to) return i;
    i++;
  }
  return -1;
}

// Inside quotes, the values the slot names — as a config value (`wrap: '…'`)
// or as an argument of the call itself (`mouse('…')`). Both spellings read the
// same signature, so neither goes quiet just because the other was used.
function stringValues(state, node, pos) {
  const parent = node.parent;
  if (parent?.name === 'Property') {
    const spec = configContext(state, node, pos)?.keys.get(propertyKey(state, parent));
    return spec?.values ? valueResult(state, pos, node, spec.values) : null;
  }
  if (parent?.name === 'ArgList') {
    const callee = calleeName(state, parent.parent);
    const slots = callee && (callee.method ? METHOD_ARGS : GLOBAL_ARGS)[callee.name];
    const values = slots?.[argIndex(parent, node)];
    return values ? valueResult(state, pos, node, values) : null;
  }
  return null;
}

// Inside midi('…'): the controllers actually plugged in. Asking is what
// requests MIDI access, which is the right moment for it — typing a device
// name into midi() is as clear a statement of intent as running the sketch.
// Before access lands there's nothing to offer, and typing the name by hand
// works the same as picking it.
function deviceValues(state, node, pos) {
  const parent = node.parent;
  if (parent?.name !== 'ArgList') return null;
  const callee = calleeName(state, parent.parent);
  if (!callee || callee.method || callee.name !== 'midi') return null;
  if (argIndex(parent, node) !== 0) return null;
  const names = midiPortNames();
  return names.length ? valueResult(state, pos, node, names) : null;
}

// Inside band('…'): what the audio manager has right now, 'level' first.
function bandValues(state, node, pos) {
  const parent = node.parent;
  if (parent?.name !== 'ArgList') return null;
  const callee = calleeName(state, parent.parent);
  if (!callee || callee.method || callee.name !== 'band') return null;
  if (argIndex(parent, node) !== 0) return null;
  return valueResult(state, pos, node, ['level', ...bandStore.bands.map((b) => b.name)]);
}

// Inside quotes: the imported files this slot can use.
async function mediaCompletions(context, node) {
  const { state } = context;
  // imageseq(['a.png', 'b.png']) — the array is the argument, the string is in it
  const inArray = node.parent?.name === 'ArrayExpression';
  const slot = inArray ? node.parent : node;
  const parent = slot.parent;
  let kind = null;

  if (parent?.name === 'ArgList') {
    const callee = calleeName(state, parent.parent);
    // only the first argument names a file
    if (callee && !callee.method && argIndex(parent, slot) === 0) {
      kind = MEDIA_ARG[callee.name] ?? null;
    }
  } else if (parent?.name === 'Property') {
    const key = propertyKey(state, parent);
    if (key === 'pbr') kind = 'pbr';
    else if (TEXTURE_KEYS.has(key)) kind = 'image';
  }
  if (!kind) return null;
  const options = await mediaOptions(kind);
  if (!options.length) return null;
  // the quotes are already typed — replace what's between them
  return { ...stringBody(state, context.pos, node), options, validFor: /^[^'"]*$/ };
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
