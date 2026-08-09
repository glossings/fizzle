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
//   ctrl+enter run · ctrl+. pause/play · ctrl+h hide/show code · ctrl+m hide
//   this window's code · ctrl+p sidebar · ctrl+r restart · F1 projector window
// Returns the view plus toggleCode, which the touch controls press too.
export function makeEditor(parent, initialCode, { onRun, onTogglePause, onLiveChange, onToggleSidebar, onRestartMedia, onToggleProjector, onToggleProjectorCode, onChange, onScroll }) {
  const toggleLocalCode = () => {
    parent.classList.toggle('hidden');
    if (!parent.classList.contains('hidden') && !isTouch) view.focus();
  };

  // With the projector up, ctrl+h is about what the *audience* sees: you're
  // typing on the laptop, so the projector is the one window whose code you
  // can't reach any other way. Without one it hides your own editor, as ever —
  // and ctrl+m always means this window, projector or no.
  const toggleCode = () => {
    if (onToggleProjectorCode?.()) return;
    toggleLocalCode();
  };

  const keys = Prec.highest(
    keymap.of([
      { key: 'Ctrl-Enter', run: (v) => { onRun(v.state.doc.toString()); return true; } },
      { key: 'Shift-Enter', run: (v) => { onRun(v.state.doc.toString()); return true; } },
      { key: 'Ctrl-.', run: () => { onTogglePause(); return true; } },
      { key: 'Ctrl-h', run: () => { toggleCode(); return true; } },
      { key: 'Ctrl-m', run: () => { toggleLocalCode(); return true; } },
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
    else if (e.key === 'm') { e.preventDefault(); toggleLocalCode(); }
    else if (e.key === 'p') { e.preventDefault(); onToggleSidebar?.(); }
    else if (e.key === 'r') { e.preventDefault(); onRestartMedia?.(); }
  });

  // Where the view is scrolled to, as the projector can use it: the line at the
  // top, plus how far into that line the top edge falls. A raw pixel offset is
  // no use over there — that pane is a different width, so the same line wraps
  // to a different height — but the fraction carries across, and it's what
  // keeps the mirrored scroll smooth rather than jumping a line at a time.
  //
  // Everything here is client coordinates, deliberately: a pinch puts a
  // transform on #editor, and a ratio of two transformed lengths is the same
  // ratio the untransformed pair would give.
  const scrollAnchor = () => {
    if (parent.classList.contains('hidden')) return null;
    const box = parent.getBoundingClientRect();
    if (!box.height) return null;
    const pos = view.posAtCoords({ x: box.left + 1, y: box.top + 1 }, false);
    const line = view.state.doc.lineAt(pos);
    const from = view.coordsAtPos(line.from);
    const to = view.coordsAtPos(line.to);
    const height = from && to ? to.bottom - from.top : 0;
    const frac = height > 0 ? (box.top - from.top) / height : 0;
    return { line: line.number, frac: Math.min(Math.max(frac, 0), 1) };
  };

  // Scrolling isn't a transaction, so it never reaches onChange — read it off
  // the DOM instead. Capture, because which element actually scrolls differs:
  // #editor's own overflow on a mouse, .cm-scroller's under a finger. Coalesced
  // to a frame; scroll fires several times per frame on a trackpad.
  let scrollQueued = false;
  parent.addEventListener('scroll', () => {
    if (scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(() => {
      scrollQueued = false;
      const anchor = scrollAnchor();
      if (anchor) onScroll?.(anchor);
    });
  }, true);

  // two fingers zoom the code; no-op unless the screen is one
  const zoom = pinchZoom(parent);

  // Focusing on a phone throws the on-screen keyboard up over the sketch that
  // just loaded, before anyone has asked to type — there, the first tap on the
  // code is the ask.
  if (!isTouch) view.focus();
  return { view, toggleCode, scrollAnchor, resetZoom: () => zoom?.reset() };
}
