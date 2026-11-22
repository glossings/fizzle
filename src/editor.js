import { EditorView, basicSetup } from 'codemirror';
import { keymap, tooltips } from '@codemirror/view';
import { Prec } from '@codemirror/state';
import { acceptCompletion, completionStatus, closeCompletion } from '@codemirror/autocomplete';
import { insertNewlineAndIndent, indentMore, indentLess } from '@codemirror/commands';
import { foldEffect } from '@codemirror/language';
import { oneDark } from '@codemirror/theme-one-dark';
import { colorPicker } from './colorpicker.js';
import { widgetsEditor, isControlArg, toggleLearn, noteScrub } from './widgets-editor.js';
import { numberScrub } from './scrub.js';
import { hotkeyFor } from './hotkeys.js';
import { sketchLanguage, apiHover } from './complete.js';
import { sketchFolding, foldsChanged } from './fold.js';
import { errorMarks } from './error-mark.js';
import { isTouch, pinchZoom, keyboardInset } from './touch.js';

// Fold the bracketed lists inside a just-inserted range, so an import of forty
// images doesn't push the sketch off the screen. The names stay in the document
// — the link still carries them — they're only rolled up to a … you can click
// open (ctrl+shift+[ / cmd+alt+[ rolls it back up).
export function foldLists(view, from, to) {
  const effects = [];
  for (const m of view.state.doc.sliceString(from, to).matchAll(/\[\n[\s\S]*?\n[ \t]*\]/g)) {
    effects.push(foldEffect.of({ from: from + m.index + 1, to: from + m.index + m[0].length - 1 }));
  }
  if (effects.length) view.dispatch({ effects });
}

// Fill the arguments of the first naked `fn()` in the document — so what was
// picked or learned ends up in the code, and deleting back down to `fn()` asks
// again. The lookbehind keeps `material()` from matching the tail of someone's
// `myMaterial()`, while still allowing the dot of a chained call; commented-out
// calls are skipped, since a sketch that explains itself ("run videofile() to
// pick a clip") would otherwise have the prose eat the fill and never reach the
// real call at all.
//
// `suffix` is chained onto the filled call — a model that came down with its
// own maps gets the .material() naming them. Returns false when there's nothing
// left to fill: edited away while the picker was open. The caller re-runs.
export function fillCall(view, fn, args, suffix = '') {
  const doc = view.state.doc.toString();
  for (const m of doc.matchAll(new RegExp(`(?<![\\w$])${fn}\\(\\s*\\)`, 'g'))) {
    const lineStart = doc.lastIndexOf('\n', m.index) + 1;
    if (doc.slice(lineStart, m.index).includes('//')) continue;
    // a filled-in list is several lines; it keeps the indentation of the call
    // it's landing in, which the args themselves know nothing about
    const indent = /^[ \t]*/.exec(doc.slice(lineStart))[0];
    const insert = `${fn}(${args.replaceAll('\n', `\n${indent}`)})${suffix}`;
    view.dispatch({ changes: { from: m.index, to: m.index + m[0].length, insert } });
    foldLists(view, m.index, m.index + insert.length);
    return true;
  }
  return false;
}

// The app's shortcuts live in hotkeys.js, where they can be rebound; this
// file only says what each one does. The editor checks them before its own
// keymap, and the window checks them for when the canvas has focus.
export function makeEditor(parent, initialCode, { onRun, onTogglePause, onLiveChange, onWidgetChange, onCapture, onLearnStatus, onToggleSidebar, onToggleAudio, onRestartMedia, onToggleProjector, onToggleProjectorCode, onRecord, onSnippets, onStep, onFontSize, onChange, onScroll }) {
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

  const actions = {
    run: () => onRun(view.state.doc.toString()),
    pause: () => onTogglePause(),
    hideCode: () => toggleCode(),
    hideCodeHere: () => toggleLocalCode(),
    sidebar: () => onToggleSidebar?.(),
    audio: () => onToggleAudio?.(),
    restart: () => onRestartMedia?.(),
    record: () => onRecord?.(),
    snippets: () => onSnippets?.(),
    capture: () => onCapture?.(),
    learn: () => toggleLearn(view, onLearnStatus),
    prev: () => onStep?.(-1),
    next: () => onStep?.(1),
    projector: () => onToggleProjector?.(),
  };
  const dispatch = (e) => {
    const id = hotkeyFor(e);
    if (!id || !actions[id]) return false;
    e.preventDefault();
    actions[id]();
    return true;
  };
  const hotkeys = Prec.highest(EditorView.domEventHandlers({ keydown: (e) => dispatch(e) }));

  const keys = Prec.highest(
    keymap.of([
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
      hotkeys,
      keys,
      basicSetup,
      sketchLanguage,
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
      sketchFolding(), // the projected copy folds with the same hands (fold.js)
      errorMarks,
      colorPicker(onLiveChange),
      widgetsEditor({ onRun, onChange: onWidgetChange, onCapture, onLearnStatus }),
      numberScrub({ onChange: onLiveChange, isControl: isControlArg, onScrub: noteScrub }),
      // the projector window replays these to stay in step with what's typed
      EditorView.updateListener.of((u) => {
        if (u.docChanged || u.selectionSet || foldsChanged(u)) onChange?.(u);
      }),
    ],
  });

  // same bindings when the canvas has focus; skip anything the editor already
  // handled (its keymap calls preventDefault before this bubbles up)
  window.addEventListener('keydown', (e) => {
    if (e.defaultPrevented) return;
    // the hotkeys panel is listening for keys to bind, and in a text field the
    // audio manager's ctrl+a is select-all
    if (e.target.closest?.('.hk-panel')) return;
    if (hotkeyFor(e) === 'audio' && e.target.closest?.('input, textarea, select, .cm-editor')) return;
    if (dispatch(e)) return;
    // Zoom the code, not the page. Browser zoom is the wrong tool here: past
    // 200% the renderer's pixel-ratio clamp stops compensating and the drawing
    // buffer — and so every recording made from it — silently shrinks. These
    // are the only bindings that take cmd as well as ctrl, because cmd+/- is
    // what the zoom is actually on.
    if ((e.ctrlKey || e.metaKey) && !e.altKey && onFontSize
        && ['=', '+', '-', '_', '0'].includes(e.key)) {
      e.preventDefault();
      return onFontSize(e.key === '0' ? 0 : e.key === '-' || e.key === '_' ? -1 : 1);
    }
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
