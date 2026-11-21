// The editor's mark for where the last run failed: a wavy underline on the
// span, its line tinted red, the message on hover. It goes when the next
// run succeeds, or when an edit touches its line, since the text it was about
// isn't there any more.

import { StateField, StateEffect } from '@codemirror/state';
import { EditorView, Decoration } from '@codemirror/view';

const setMark = StateEffect.define();

function build(doc, where) {
  if (!doc.length) return Decoration.none;
  const from = Math.max(0, Math.min(where.from, doc.length - 1));
  const to = Math.max(from + 1, Math.min(where.to, doc.length));
  const line = doc.lineAt(from);
  return Decoration.set([
    Decoration.line({ class: 'cm-eval-error-line' }).range(line.from),
    Decoration.mark({ class: 'cm-eval-error', attributes: { title: where.text } }).range(from, to),
  ], true);
}

const marks = StateField.define({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) if (e.is(setMark)) return e.value ? build(tr.state.doc, e.value) : Decoration.none;
    if (!tr.docChanged || deco.size === 0) return deco;
    const old = tr.startState.doc;
    let touched = false;
    deco.between(0, old.length, (from, to) => {
      const a = old.lineAt(from).from;
      const b = old.lineAt(to).to;
      tr.changes.iterChangedRanges((fromA, toA) => { if (fromA <= b && toA >= a) touched = true; });
    });
    return touched ? Decoration.none : deco.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

export const errorMarks = marks;

// `where` is { from, to, text } in the editor's offsets, or null to clear.
export function showErrorMark(view, where) {
  view.dispatch({ effects: setMark.of(where ?? null) });
}
