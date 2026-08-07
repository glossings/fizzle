import { EditorView, basicSetup } from 'codemirror';
import { keymap, tooltips } from '@codemirror/view';
import { Prec } from '@codemirror/state';
import { acceptCompletion, completionStatus, closeCompletion } from '@codemirror/autocomplete';
import { insertNewlineAndIndent, indentMore, indentLess } from '@codemirror/commands';
import { javascript, javascriptLanguage } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';
import { colorPicker } from './colorpicker.js';
import { apiCompletions, apiHover } from './complete.js';
import { isTouch, pinchZoom, keyboardInset } from './touch.js';

// Ctrl (not Cmd) on every platform, so the bindings match livecoding habit:
//   ctrl+enter run · ctrl+. pause/play · ctrl+h hide/show code · ctrl+p sidebar
//   ctrl+r restart media files · F1 projector window
// Returns the view plus toggleCode, which the touch controls press too.
export function makeEditor(parent, initialCode, { onRun, onTogglePause, onLiveChange, onToggleSidebar, onRestartMedia, onToggleProjector, onToggleProjectorCode, onChange }) {
  // With the projector up, ctrl+h is about what the *audience* sees: you're
  // typing on the laptop, so the projector is the one window whose code you
  // can't reach any other way. Without one it hides your own editor, as ever.
  const toggleCode = () => {
    if (onToggleProjectorCode?.()) return;
    parent.classList.toggle('hidden');
    if (!parent.classList.contains('hidden') && !isTouch) view.focus();
  };

  const keys = Prec.highest(
    keymap.of([
      { key: 'Ctrl-Enter', run: (v) => { onRun(v.state.doc.toString()); return true; } },
      { key: 'Shift-Enter', run: (v) => { onRun(v.state.doc.toString()); return true; } },
      { key: 'Ctrl-.', run: () => { onTogglePause(); return true; } },
      { key: 'Ctrl-h', run: () => { toggleCode(); return true; } },
      { key: 'Ctrl-p', run: () => { onToggleSidebar?.(); return true; } },
      { key: 'Ctrl-r', run: () => { onRestartMedia?.(); return true; } },
      { key: 'F1', run: () => { onToggleProjector?.(); return true; } },
      // completions accept with Tab, not Enter; Enter just newlines through
      // an open popup. Tab indents when no popup is showing.
      { key: 'Tab', run: acceptCompletion },
      { key: 'Tab', run: indentMore, shift: indentLess },
      {
        key: 'Enter',
        run: (v) => {
          if (completionStatus(v.state) !== 'active') return false;
          closeCompletion(v);
          return insertNewlineAndIndent(v);
        },
      },
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
      // Completion popups and doc tooltips fit themselves into the space the
      // window has, and the on-screen keyboard isn't part of the window — so
      // without this the list of completions opens underneath it.
      tooltips({
        tooltipSpace: () => ({
          left: 0, top: 0, right: innerWidth, bottom: innerHeight - keyboardInset(),
        }),
        // A pinch transforms #editor, and a position: fixed tooltip inside a
        // transformed ancestor is positioned against that ancestor rather than
        // the window — so it lands somewhere else entirely once you've zoomed.
        // (CodeMirror already forces this on iOS; touch is where the transform
        // is, so this is the same rule applied to the rest of it.)
        ...(isTouch ? { position: 'absolute' } : {}),
      }),
      colorPicker(onLiveChange),
      // the projector window replays these to stay in step with what's typed
      EditorView.updateListener.of((u) => {
        if (u.docChanged || u.selectionSet) onChange?.(u);
      }),
    ],
  });

  // same bindings when the canvas has focus; skip anything the editor already
  // handled (its keymap calls preventDefault before this bubbles up)
  window.addEventListener('keydown', (e) => {
    if (e.defaultPrevented) return;
    if (e.key === 'F1' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      return onToggleProjector?.();
    }
    if (!e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Enter') { e.preventDefault(); onRun(view.state.doc.toString()); }
    else if (e.key === '.') { e.preventDefault(); onTogglePause(); }
    else if (e.key === 'h') { e.preventDefault(); toggleCode(); }
    else if (e.key === 'p') { e.preventDefault(); onToggleSidebar?.(); }
    else if (e.key === 'r') { e.preventDefault(); onRestartMedia?.(); }
  });

  // two fingers zoom the code; no-op unless the screen is one
  const zoom = pinchZoom(parent);

  // Focusing on a phone throws the on-screen keyboard up over the sketch that
  // just loaded, before anyone has asked to type — there, the first tap on the
  // code is the ask.
  if (!isTouch) view.focus();
  return { view, toggleCode, resetZoom: () => zoom?.reset() };
}
