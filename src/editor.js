import { EditorView, basicSetup } from 'codemirror';
import { keymap } from '@codemirror/view';
import { Prec } from '@codemirror/state';
import { javascript, javascriptLanguage } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';
import { colorPicker } from './colorpicker.js';
import { apiCompletions, apiHover } from './docs.js';

// Ctrl (not Cmd) on every platform, so the bindings match livecoding habit:
//   ctrl+enter run · ctrl+. pause/play · ctrl+h hide/show editor · ctrl+b sidebar
export function makeEditor(parent, initialCode, { onRun, onTogglePause, onLiveChange, onToggleSidebar }) {
  const toggleEditor = () => {
    parent.classList.toggle('hidden');
    if (!parent.classList.contains('hidden')) view.focus();
  };

  const keys = Prec.highest(
    keymap.of([
      { key: 'Ctrl-Enter', run: (v) => { onRun(v.state.doc.toString()); return true; } },
      { key: 'Shift-Enter', run: (v) => { onRun(v.state.doc.toString()); return true; } },
      { key: 'Ctrl-.', run: () => { onTogglePause(); return true; } },
      { key: 'Ctrl-h', run: () => { toggleEditor(); return true; } },
      { key: 'Ctrl-b', run: () => { onToggleSidebar?.(); return true; } },
    ])
  );

  const view = new EditorView({
    doc: initialCode,
    parent,
    extensions: [
      keys,
      basicSetup,
      javascript(),
      javascriptLanguage.data.of({ autocomplete: apiCompletions }),
      apiHover,
      oneDark,
      EditorView.lineWrapping,
      colorPicker(onLiveChange),
    ],
  });

  // same bindings when the canvas has focus; skip anything the editor already
  // handled (its keymap calls preventDefault before this bubbles up)
  window.addEventListener('keydown', (e) => {
    if (!e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
    if (e.key === 'Enter') { e.preventDefault(); onRun(view.state.doc.toString()); }
    else if (e.key === '.') { e.preventDefault(); onTogglePause(); }
    else if (e.key === 'h') { e.preventDefault(); toggleEditor(); }
    else if (e.key === 'b') { e.preventDefault(); onToggleSidebar?.(); }
  });

  view.focus();
  return view;
}
