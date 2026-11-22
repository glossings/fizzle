// Alt-drag (option on a Mac) up or down on any number in the code to change it.
// The rate follows the number's size, so 0.4 moves by about 0.0025 a pixel and
// 40 by about 0.25; a whole number stays whole. Shift is ten times finer. The
// sketch re-runs as it changes, the way a color drag does, unless the number
// belongs to a control (widgets.js), which already hears its own code.

import { Prec } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

const NUM_RE = /-?(?:\d+\.?\d*|\.\d+)/g;
const PX_PER_DIGIT = 40; // pixels to move the number by its leading digit's place
const FINE = 10;

// the number literal under pos, as { from, to, text }
function numberAt(state, pos) {
  const line = state.doc.lineAt(pos);
  NUM_RE.lastIndex = 0;
  let m;
  while ((m = NUM_RE.exec(line.text))) {
    let start = m.index;
    let text = m[0];
    const before = line.text[start - 1] ?? '';
    // part of a name (x2, #ff00aa)
    if (/[\w$#]/.test(before)) continue;
    // `a-1` is a subtraction, not a negative one
    if (text[0] === '-' && /[\w)\]]\s*$/.test(line.text.slice(0, start))) { start++; text = text.slice(1); }
    const from = line.from + start;
    const to = from + text.length;
    if (/[\w$]/.test(line.text[to - line.from] ?? '')) continue;
    if (pos >= from && pos <= to) return { from, to, text };
    if (from > pos) break;
  }
  return null;
}

const decimalsOf = (text) => (text.includes('.') ? text.length - text.indexOf('.') - 1 : 0);

// how much one pixel moves this number, and how many decimals that needs
function rate(text, fine) {
  const v = Number(text);
  const whole = !text.includes('.');
  const place = v === 0 ? 10 ** -Math.max(1, decimalsOf(text)) : 10 ** Math.floor(Math.log10(Math.abs(v)));
  let perPx = place / PX_PER_DIGIT / (fine ? FINE : 1);
  if (whole) perPx = Math.max(perPx, fine ? 0.05 : 0.2);
  const dec = whole ? 0 : Math.max(decimalsOf(text), Math.ceil(-Math.log10(perPx)));
  return { perPx, dec };
}

const format = (v, dec) => {
  let s = v.toFixed(dec);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '.0');
  return Number(s) === 0 ? s.replace('-', '') : s;
};

export function numberScrub({ onChange, isControl }) {
  return Prec.highest(EditorView.domEventHandlers({
    mousedown(e, view) {
      if (!e.altKey || e.button !== 0) return false;
      const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
      if (pos == null) return false;
      const hit = numberAt(view.state, pos);
      if (!hit) return false;
      e.preventDefault();
      let range = { from: hit.from, to: hit.to };
      // the rate is fixed at the grab, so it doesn't speed up as the number grows
      const coarse = rate(hit.text, false);
      const fine = rate(hit.text, true);
      let base = { v: Number(hit.text), y: e.clientY, shift: e.shiftKey };
      const control = isControl?.(view, hit.from);
      document.body.classList.add('scrubbing');

      const move = (ev) => {
        // shift changes the rate from where the number is now
        if (ev.shiftKey !== base.shift) {
          base = { v: Number(view.state.doc.sliceString(range.from, range.to)), y: ev.clientY, shift: ev.shiftKey };
        }
        const { perPx, dec } = ev.shiftKey ? fine : coarse;
        const text = format(base.v + (base.y - ev.clientY) * perPx, dec);
        if (text === view.state.doc.sliceString(range.from, range.to)) return;
        view.dispatch({ changes: { from: range.from, to: range.to, insert: text }, userEvent: 'input.scrub' });
        range = { from: range.from, to: range.from + text.length };
        if (!control) onChange?.(view.state.doc.toString());
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        document.body.classList.remove('scrubbing');
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      return true;
    },
  }));
}
