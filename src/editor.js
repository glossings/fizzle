import { EditorView, basicSetup } from 'codemirror';
import { keymap } from '@codemirror/view';
import { Prec } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';

export function makeEditor(parent, initialCode, onRun) {
  const runKeys = Prec.highest(
    keymap.of([
      { key: 'Mod-Enter', run: (view) => { onRun(view.state.doc.toString()); return true; } },
      { key: 'Shift-Enter', run: (view) => { onRun(view.state.doc.toString()); return true; } },
    ])
  );

  const view = new EditorView({
    doc: initialCode,
    parent,
    extensions: [runKeys, basicSetup, javascript(), oneDark, EditorView.lineWrapping],
  });

  // handled at the window level so it works whether the editor or canvas has focus
  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === '.') {
      e.preventDefault();
      parent.classList.toggle('hidden');
      if (!parent.classList.contains('hidden')) view.focus();
    }
  });

  view.focus();
  return view;
}
