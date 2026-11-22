// Every app shortcut in one list: what it does, its default keys, and the keys
// the user has picked instead (kept in localStorage). The editor, the window,
// the projector, the hints in messages and the hotkeys panel all ask here, so a
// rebound key is the key everywhere at once.
//
// A combo is written the way it's shown: 'ctrl+enter', 'ctrl+shift+s', 'f1',
// 'ctrl+['. Modifiers come first, in the order ctrl alt shift cmd. ctrl means
// ctrl on every platform, the livecoding habit, not cmd on a Mac.
//
// Code zoom (cmd/ctrl with + - 0) isn't in the list: it's taking those keys
// back from the browser's own zoom, so it stays where the browser put it.

const LS_KEY = 'td-hotkeys';

export const HOTKEY_ACTIONS = [
  { id: 'run', label: 'run the sketch', keys: ['ctrl+enter'] },
  { id: 'pause', label: 'pause / play', keys: ['ctrl+.'] },
  { id: 'hideCode', label: 'hide the code (the projector\'s, while one is open)', keys: ['ctrl+h'] },
  { id: 'hideCodeHere', label: 'hide the code in this window', keys: ['ctrl+m'] },
  { id: 'sidebar', label: 'settings & sketches', keys: ['ctrl+p'] },
  { id: 'audio', label: 'audio manager', keys: ['ctrl+a'] },
  { id: 'restart', label: 'restart media and state', keys: ['ctrl+r'] },
  { id: 'record', label: 'start / stop recording', keys: ['ctrl+e'] },
  { id: 'snippets', label: 'snippets', keys: ['ctrl+j'] },
  { id: 'capture', label: 'capture the controls\' movements', keys: ['ctrl+k'] },
  { id: 'learn', label: 'learn a control from MIDI or a gamepad', keys: ['ctrl+l'] },
  { id: 'prev', label: 'previous sketch in the playlist', keys: ['ctrl+['] },
  { id: 'next', label: 'next sketch in the playlist', keys: ['ctrl+]'] },
  { id: 'projector', label: 'projector window', keys: ['f1'] },
];
const BY_ID = new Map(HOTKEY_ACTIONS.map((a) => [a.id, a]));

let custom = {};
try { custom = JSON.parse(localStorage.getItem(LS_KEY)) ?? {}; } catch { custom = {}; }

const listeners = new Set();
export const onHotkeysChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

export const hotkeysOf = (id) => custom[id] ?? BY_ID.get(id)?.keys ?? [];
export const isCustom = (id) => id in custom;

function save() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(custom)); } catch { /* storage off: this session only */ }
  for (const fn of listeners) fn();
}

// Give an action these keys. Any other action holding one of them gives it up,
// and is returned, so the panel can say what moved.
export function setHotkeys(id, keys) {
  const taken = [];
  for (const a of HOTKEY_ACTIONS) {
    if (a.id === id) continue;
    const mine = hotkeysOf(a.id);
    const left = mine.filter((k) => !keys.includes(k));
    if (left.length !== mine.length) {
      custom[a.id] = left;
      taken.push(a.id);
    }
  }
  custom[id] = keys;
  save();
  return taken;
}

export function resetHotkeys() {
  custom = {};
  save();
}

// --- matching ------------------------------------------------------------------

// Letters and digits by the character typed, so a layout that moves them still
// finds them; everything else by the physical key, so shift doesn't turn ctrl+.
// into ctrl+>.
const CODES = {
  enter: 'Enter', space: 'Space', tab: 'Tab', escape: 'Escape', backspace: 'Backspace', delete: 'Delete',
  '.': 'Period', ',': 'Comma', '/': 'Slash', ';': 'Semicolon', "'": 'Quote', '`': 'Backquote',
  '[': 'BracketLeft', ']': 'BracketRight', '\\': 'Backslash', '-': 'Minus', '=': 'Equal',
  up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
};
const NAME_OF_CODE = Object.fromEntries(Object.entries(CODES).map(([k, v]) => [v, k]));

function parse(combo) {
  const parts = combo.toLowerCase().split('+');
  const key = parts.pop() || '+';
  return { key, ctrl: parts.includes('ctrl'), alt: parts.includes('alt'), shift: parts.includes('shift'), meta: parts.includes('cmd') };
}

function keyMatches(key, e) {
  if (/^[a-z0-9]$/.test(key)) return e.key.toLowerCase() === key;
  if (/^f\d{1,2}$/.test(key)) return e.key.toLowerCase() === key;
  return e.code === CODES[key];
}

export function comboMatches(combo, e) {
  const c = parse(combo);
  return c.ctrl === e.ctrlKey && c.alt === e.altKey && c.shift === e.shiftKey && c.meta === e.metaKey
    && keyMatches(c.key, e);
}

// which action a keydown is, or null
export function hotkeyFor(e) {
  for (const a of HOTKEY_ACTIONS) if (hotkeysOf(a.id).some((k) => comboMatches(k, e))) return a.id;
  return null;
}
export const hotkeyMatches = (id, e) => hotkeysOf(id).some((k) => comboMatches(k, e));

// A keydown as a combo, for the panel to bind; null for a modifier on its own.
export function comboOf(e) {
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return null;
  let key;
  if (/^[a-z0-9]$/i.test(e.key)) key = e.key.toLowerCase();
  else if (/^F\d{1,2}$/.test(e.key)) key = e.key.toLowerCase();
  else key = NAME_OF_CODE[e.code];
  if (!key) return null;
  const mods = [e.ctrlKey && 'ctrl', e.altKey && 'alt', e.shiftKey && 'shift', e.metaKey && 'cmd'].filter(Boolean);
  return [...mods, key].join('+');
}

// --- labels --------------------------------------------------------------------

const KEY_LABEL = { f1: 'F1', enter: 'enter', escape: 'esc' };
const fmt = (combo) => combo.split('+').map((p) => KEY_LABEL[p] ?? (/^f\d+$/.test(p) ? p.toUpperCase() : p)).join('+');

// an action's first key, as a message would write it: 'ctrl+enter'
export const hotkeyLabel = (id) => {
  const k = hotkeysOf(id)[0];
  return k ? fmt(k) : 'no key';
};
export const comboLabel = fmt;
