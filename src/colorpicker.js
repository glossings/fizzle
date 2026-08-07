import { EditorView, ViewPlugin, Decoration, MatchDecorator, WidgetType } from '@codemirror/view';
import { Annotation } from '@codemirror/state';
import { isTouch } from './touch.js';

// Inline color picking for hex codes:
//  - every #rgb / #rrggbb in the doc gets a clickable swatch
//  - clicking the swatch or the hex text itself opens the native color picker
//    (on macOS that's the system panel: wheel, eyedropper, RGB sliders)
//  - typing '#' opens the picker immediately and writes the picked color in
//  - picks update the document live; `onChange` fires with the new source so
//    the sketch can be re-run while dragging

const HEX_RE = /#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;
const pickerChange = Annotation.define();

function normalizeHex(s) {
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(s)) {
    const [r, g, b] = s.slice(1);
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return null;
}

function matchAt(state, pos, requireStart = false) {
  const line = state.doc.lineAt(pos);
  HEX_RE.lastIndex = 0;
  let m;
  while ((m = HEX_RE.exec(line.text))) {
    const from = line.from + m.index;
    const to = from + m[0].length;
    if (requireStart ? from === pos : pos >= from && pos <= to) return { from, to, text: m[0] };
    if (from > pos) break;
  }
  return null;
}

export function colorPicker(onChange) {
  // one hidden <input type=color> shared by all triggers; `active` tracks the
  // doc range the open picker is editing
  let input = null;
  let active = null;

  function ensureInput() {
    if (input) return input;
    input = document.createElement('input');
    input.type = 'color';
    // Not pointer-events: none, and not zero-sized: Safari won't open a picker
    // for a control it considers unreachable. It's parked under the swatch and
    // transparent, so it's never something you can hit by accident either.
    input.style.cssText = 'position:fixed;opacity:0;width:1px;height:1px;border:0;padding:0;';
    document.body.appendChild(input);
    input.addEventListener('input', () => {
      if (!active) return;
      const { view } = active;
      const current = view.state.doc.sliceString(active.from, active.to);
      if (!/^#[0-9a-fA-F]{0,6}$/.test(current)) { active = null; return; }
      view.dispatch({
        changes: { from: active.from, to: active.to, insert: input.value },
        annotations: pickerChange.of(true),
      });
      active.to = active.from + input.value.length;
      onChange?.(view.state.doc.toString());
    });
    return input;
  }

  function openPicker(view, from, to) {
    const inp = ensureInput();
    const coords = view.coordsAtPos(from);
    if (coords) {
      inp.style.left = `${coords.left}px`;
      inp.style.top = `${coords.bottom}px`;
    }
    inp.value = normalizeHex(view.state.doc.sliceString(from, to)) ?? '#22ccff';
    active = { view, from, to };
    try { inp.showPicker(); } catch { inp.click(); }
  }

  class SwatchWidget extends WidgetType {
    constructor(color) { super(); this.color = color; }
    eq(other) { return other.color === this.color; }

    toDOM(view) {
      // On a touch screen the swatch *is* the colour input rather than a span
      // that asks one to open. Everything about the indirect route is fragile
      // there: showPicker() needs an activation a tap doesn't always carry
      // past the browser's pan/tap decision, and Safari won't open a picker
      // for a control that isn't really on screen. A native input has none of
      // those problems — the tap is on the control, so it just opens.
      if (isTouch) return this.inputDOM(view);
      const el = document.createElement('span');
      el.className = 'cm-color-swatch';
      el.style.backgroundColor = this.color;
      el.title = 'pick color';
      // mousedown only keeps the caret from jumping into the swatch; the open
      // is on click, which is the one both a mouse and a finger produce
      el.addEventListener('mousedown', (e) => e.preventDefault());
      el.addEventListener('click', () => {
        const m = matchAt(view.state, view.posAtDOM(el), true);
        if (m) openPicker(view, m.from, m.to);
      });
      return el;
    }

    inputDOM(view) {
      const el = document.createElement('input');
      el.type = 'color';
      el.className = 'cm-color-swatch';
      el.value = normalizeHex(this.color) ?? '#22ccff';
      el.setAttribute('aria-label', 'pick color');
      // the range is looked up per event, not captured: the doc has moved on
      // by the second drag of the picker, and this widget outlives each one
      const range = () => matchAt(view.state, view.posAtDOM(el), true);
      el.addEventListener('input', () => {
        const m = range();
        if (!m) return;
        view.dispatch({
          changes: { from: m.from, to: m.to, insert: el.value },
          annotations: pickerChange.of(true),
        });
        onChange?.(view.state.doc.toString());
      });
      return el;
    }

    // Every drag inside the picker rewrites the hex, which makes a new widget
    // for the same spot — and replacing the DOM would tear the <input> out
    // from under the finger that's dragging in it, closing the picker and
    // dropping the touch onto the code underneath. Updating in place instead
    // keeps the node, so the picker stays open for the whole gesture. (The
    // desktop span has nothing live in it: returning false there lets
    // CodeMirror rebuild it as before.)
    updateDOM(dom) {
      if (dom.tagName !== 'INPUT') return false;
      const v = normalizeHex(this.color);
      // equal whenever the change came from this input, so a drag never has
      // its own value written back over it mid-gesture
      if (v && dom.value !== v) dom.value = v;
      return true;
    }

    ignoreEvent() { return true; }
  }

  const swatches = new MatchDecorator({
    regexp: HEX_RE,
    decorate: (add, from, _to, match) => {
      add(from, from, Decoration.widget({ widget: new SwatchWidget(match[0]), side: -1 }));
    },
  });

  const swatchPlugin = ViewPlugin.fromClass(
    class {
      constructor(view) { this.decorations = swatches.createDeco(view); }
      update(u) { this.decorations = swatches.updateDeco(u, this.decorations); }
    },
    {
      decorations: (v) => v.decorations,
      eventHandlers: {
        // click, not mousedown: it fires for a tap as well as a press, and it
        // already comes after the cursor has landed — which is what the old
        // mousedown had to defer through a timeout to get.
        click(e, view) {
          // On touch the swatch is a real input and tapping it is the way in;
          // opening from the text as well would mean a tap anywhere near a
          // colour puts a picker over the code you were trying to edit.
          if (isTouch) return;
          if (e.target.classList?.contains('cm-color-swatch')) return;
          const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
          if (pos == null) return;
          const m = matchAt(view.state, pos);
          if (m) openPicker(view, m.from, m.to);
        },
      },
    }
  );

  // typing '#' drops the hash in and opens the picker right there
  const hashHandler = EditorView.inputHandler.of((view, from, to, text) => {
    if (text !== '#') return false;
    view.dispatch({
      changes: { from, to, insert: '#' },
      selection: { anchor: from + 1 },
      userEvent: 'input.type',
    });
    openPicker(view, from, from + 1);
    return true;
  });

  // keep the active range in sync when the doc changes under the open picker
  const trackChanges = EditorView.updateListener.of((u) => {
    if (!active || u.view !== active.view || !u.docChanged) return;
    if (u.transactions.some((tr) => tr.annotation(pickerChange))) return;
    active.from = u.changes.mapPos(active.from, -1);
    active.to = u.changes.mapPos(active.to, 1);
    if (active.to < active.from) active = null;
  });

  return [swatchPlugin, hashHandler, trackChanges];
}
