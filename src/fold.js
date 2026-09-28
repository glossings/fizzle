// Folding, shared by the editor and by the projected copy of it. basicSetup
// already folds; this only names what's hidden, since the gutter arrows are off
// and a bare … next to an import says nothing.

import { codeFolding, foldEffect, foldedRanges, unfoldEffect } from '@codemirror/language';

// the lines actually out of sight: a fold starts just inside the bracket, so its
// first and last lines are still half on screen
function preparePlaceholder(state, range) {
  // The audio manager's bands, folded whole (band-chip.js). It names itself
  // instead of counting lines, because the count is the one thing nobody wants
  // to know about a call they didn't write.
  if (/^bands\s*\(/.test(state.doc.sliceString(range.from, range.from + 8))) return 'bands';
  let n = 0;
  for (let l = state.doc.lineAt(range.from).number; l <= state.doc.lineAt(range.to).number; l++) {
    const line = state.doc.line(l);
    const from = Math.max(line.from, range.from);
    const to = Math.min(line.to, range.to);
    if (from < to && state.doc.sliceString(from, to).trim()) n++;
  }
  return n;
}

function placeholderDOM(view, onclick, prepared) {
  const el = document.createElement('span');
  const named = typeof prepared === 'string';
  el.textContent = named ? ` ⋯ ${prepared} ` : prepared > 0 ? ` … ${prepared} lines ` : ' … ';
  el.className = 'cm-foldPlaceholder';
  el.title = named ? 'kept by the audio manager — click to open' : 'click to expand';
  el.onclick = onclick;
  return el;
}

export const sketchFolding = () => codeFolding({ preparePlaceholder, placeholderDOM });

// Whether an update carried a fold or an unfold. Neither shows up as a doc or a
// selection change, and those are what the projector is driven off, so without
// this the chip opens on the laptop and stays shut in front of the audience.
export const foldsChanged = (update) => update.transactions.some(
  (tr) => tr.effects.some((e) => e.is(foldEffect) || e.is(unfoldEffect))
);

const ranges = (state) => {
  const out = [];
  foldedRanges(state).between(0, state.doc.length, (from, to) => { out.push({ from, to }); });
  return out;
};

// Bring one view's folds in line with another's. The projector replays the
// editor's transactions, and a fold rides on none of them: it lives in a state
// field of its own, so what is chipped on the laptop stays open in front of the
// audience unless it is sent across separately. Nothing over there can be
// clicked, so this is the whole of what folds in that window.
export function mirrorFolds(view, srcState) {
  const key = (r) => `${r.from}:${r.to}`;
  const want = ranges(srcState);
  const have = ranges(view.state);
  const wanted = new Set(want.map(key));
  const held = new Set(have.map(key));
  const effects = [
    ...want.filter((r) => !held.has(key(r))).map((r) => foldEffect.of(r)),
    ...have.filter((r) => !wanted.has(key(r))).map((r) => unfoldEffect.of(r)),
  ];
  if (effects.length) view.dispatch({ effects });
}
