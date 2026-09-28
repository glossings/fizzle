// The bands({ ... }) call in a sketch's source, as the audio manager sees it:
// written, rewritten and removed here rather than typed. It lands at the bottom
// of the sketch folded to a chip — the whole call, not just its braces, because
// nobody typed it and nobody has to read it. What's on screen says the sketch
// carries its own bands and leaves the numbers to the manager. Open the chip and
// they're ordinary code, editable by hand like anything else.
//
// The call itself is found by bandsCall (sketch-blocks.js), which parses for it:
// its argument spans lines and is full of braces, a bands() in a comment or a
// string isn't one, and one inside a labeled block belongs to that block rather
// than to the sketch. Serializing is the other half of bands.js's bandSpec().

import { foldEffect, foldedRanges } from '@codemirror/language';
import { bandsCall } from './sketch-blocks.js';

const IDENT = /^[A-Za-z_$][\w$]*$/;
// the default band names are numbers, and '1' reads more like a name than 1 does
const asKey = (name) => (IDENT.test(name) ? name : `'${name}'`);

export function chipText(spec) {
  const line = (name) => {
    const fields = Object.entries(spec[name]).map(([k, v]) => `${k}: ${v}`).join(', ');
    return `  ${asKey(name)}: { ${fields} },`;
  };
  // level first, as the manager lists it: JS puts the numeric keys of an object
  // ahead of its named ones, and the default band names are numbers, so reading
  // the order off the spec would bury it under them
  const names = Object.keys(spec).filter((n) => n !== 'level');
  const lines = [...(spec.level ? [line('level')] : []), ...names.map(line)];
  return `bands({\n${lines.join('\n')}\n})`;
}

// the chip stands in for the call itself; fold.js draws it, and knows which fold
// this is from the text under it
const fold = (view, from, to) => view.dispatch({ effects: foldEffect.of({ from, to }) });

const foldedWithin = (state, from, to) => {
  let hit = false;
  foldedRanges(state).between(from, to, () => { hit = true; return false; });
  return hit;
};

// Write the set into the sketch: replacing the call that's there, or adding one
// at the end. A rewrite keeps the chip folded if it was folded, so retuning a
// band under a drag doesn't flip the code open mid-performance.
export function writeChip(view, spec) {
  const src = view.state.doc.toString();
  const at = bandsCall(src);
  const text = chipText(spec);
  if (at) {
    const wasFolded = foldedWithin(view.state, at.from, at.to);
    view.dispatch({ changes: { from: at.from, to: at.to, insert: text } });
    if (wasFolded) fold(view, at.from, at.from + text.length);
    return;
  }
  const from = view.state.doc.length;
  const lead = /\n[ \t]*$/.test(src) ? '\n' : '\n\n'; // a blank line between it and the sketch
  view.dispatch({ changes: { from, insert: `${lead}${text}\n` } });
  fold(view, from + lead.length, from + lead.length + text.length);
}

// Close the chip: on the sketch a page opened on, on a swap, and on every
// execute, so opening it to read or edit the set by hand lasts until the next
// run rather than for the rest of the session (main.js).
export function foldChip(view) {
  const at = bandsCall(view.state.doc.toString());
  if (!at || foldedWithin(view.state, at.from, at.to)) return;
  // A caret inside the call would be left under the chip, where the next
  // keystroke edits a set nobody can see. Park it after the chip instead.
  const head = view.state.selection.main.head;
  view.dispatch({
    effects: foldEffect.of({ from: at.from, to: at.to }),
    ...(head > at.from && head < at.to ? { selection: { anchor: at.to } } : {}),
  });
}

export function removeChip(view) {
  const src = view.state.doc.toString();
  const at = bandsCall(src);
  if (!at) return;
  // take the blank line it was given with it, leaving the line break that ends
  // whatever statement came before
  const before = /\s*$/.exec(src.slice(0, at.from))[0];
  const from = at.from - before.length + (before.includes('\n') ? 1 : 0);
  const to = src[at.to] === '\n' ? at.to + 1 : at.to;
  view.dispatch({ changes: { from, to } });
}
