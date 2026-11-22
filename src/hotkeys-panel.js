// The hotkeys panel (sidebar → hotkeys…): every action with its keys. Click a
// key to change it and press the new one; a key another action had moves here,
// and the line under the list says so.

import {
  HOTKEY_ACTIONS, hotkeysOf, isCustom, setHotkeys, resetHotkeys, comboOf, comboLabel, onHotkeysChange,
} from './hotkeys.js';

let panel = null;
let listening = null; // the action whose key is being picked

const keysText = (id) => {
  const keys = hotkeysOf(id);
  return keys.length ? keys.map(comboLabel).join(' · ') : 'none';
};
const nameOf = (id) => HOTKEY_ACTIONS.find((a) => a.id === id)?.label ?? id;

function build() {
  panel = document.createElement('div');
  panel.className = 'hk-panel';
  panel.hidden = true;
  panel.innerHTML = `
    <div class="hk-head"><h2>hotkeys</h2><button class="hk-close" title="close">×</button></div>
    <p class="hk-hint">Click a key to change it, then press the new one. Backspace leaves an action without a key; esc keeps what it had.</p>
    <div class="hk-list"></div>
    <p class="hk-note"></p>
    <div class="hk-foot"><button class="hk-reset">reset to defaults</button></div>`;
  document.body.append(panel);
  const list = panel.querySelector('.hk-list');
  for (const a of HOTKEY_ACTIONS) {
    const row = document.createElement('div');
    row.className = 'hk-row';
    const label = document.createElement('span');
    label.textContent = a.label;
    const btn = document.createElement('button');
    btn.className = 'hk-key';
    btn.dataset.id = a.id;
    btn.addEventListener('click', () => listen(a.id));
    row.append(label, btn);
    list.append(row);
  }
  panel.querySelector('.hk-close').addEventListener('click', close);
  panel.querySelector('.hk-reset').addEventListener('click', () => {
    resetHotkeys();
    note('');
  });
  // a press on the panel mustn't take the focus out of the editor
  panel.addEventListener('mousedown', (e) => { if (e.target.tagName !== 'BUTTON') e.preventDefault(); });
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('pointerdown', (e) => { if (!panel.hidden && !panel.contains(e.target)) close(); }, true);
  onHotkeysChange(render);
  render();
}

function render() {
  for (const btn of panel.querySelectorAll('.hk-key')) {
    const id = btn.dataset.id;
    btn.textContent = listening === id ? 'press a key…' : keysText(id);
    btn.classList.toggle('listening', listening === id);
    btn.classList.toggle('custom', isCustom(id));
  }
}

const note = (text) => { panel.querySelector('.hk-note').textContent = text; };

function listen(id) {
  listening = listening === id ? null : id;
  render();
}

function onKey(e) {
  if (panel.hidden) return;
  if (!listening) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  const id = listening;
  if (e.key === 'Escape') { listening = null; render(); return; }
  if (e.key === 'Backspace' || e.key === 'Delete') {
    listening = null;
    setHotkeys(id, []);
    note(`${nameOf(id)} has no key now`);
    return;
  }
  const combo = comboOf(e);
  if (!combo) return; // a modifier on its own: wait for the rest of the chord
  listening = null;
  const taken = setHotkeys(id, [combo]);
  note(taken.map((t) => `${comboLabel(combo)} moved here from "${nameOf(t)}", which ${hotkeysOf(t).length ? `keeps ${keysText(t)}` : 'has no key now'}`).join('. '));
}

export function openHotkeys() {
  if (!panel) build();
  listening = null;
  note('');
  render();
  panel.hidden = false;
}

function close() {
  listening = null;
  panel.hidden = true;
}
