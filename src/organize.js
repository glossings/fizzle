// The organize window — three panes: your playlists, the contents of the one
// you've selected, and every sketch you have. Drag a sketch into a playlist,
// drag inside a playlist to reorder, and tag anything at the bottom.
//
// It carries its own styles the way the Poly Haven browser does, so importing
// the module is all it takes to get them.

import './organize.css';
import {
  addPlaylist, addToPlaylist, manualTags, matches, moveItem, removeAt,
  removePlaylist, renamePlaylist, setManualTags,
} from './library.js';

// What's in the hand between dragstart and drop. The DataTransfer carries the
// same thing as text, but only this survives a dragover, which is where the
// drop target has to decide whether it wants it.
let held = null;

// sketches: () => [{ key, scope, name, tags }] — the auto tags come with it.
// onChange runs after anything is edited, so the sidebar can redraw.
export function initOrganize({ lib, sketches, onChange }) {
  let el = null;
  let selectedList = null; // playlist id
  let selectedSketch = null; // key, for the tag editor
  let query = '';

  function build() {
    el = document.createElement('div');
    el.id = 'org-modal';
    el.innerHTML = `
      <div id="org-panel">
        <header>
          <span class="org-title">organize</span>
          <input id="org-search" type="search" placeholder="filter sketches…" autocomplete="off">
          <button id="org-close" title="close (esc)">✕</button>
        </header>
        <div id="org-cols">
          <section class="org-col">
            <h3>playlists <button id="org-add" title="new playlist">+</button></h3>
            <ul id="org-lists"></ul>
          </section>
          <section class="org-col">
            <h3 id="org-items-title">contents</h3>
            <ul id="org-items"></ul>
          </section>
          <section class="org-col">
            <h3>all sketches</h3>
            <ul id="org-all"></ul>
          </section>
        </div>
        <footer id="org-tagbar">
          <span class="org-tagfor">select a sketch to tag it</span>
        </footer>
      </div>`;
    document.body.appendChild(el);

    el.addEventListener('click', (e) => { if (e.target === el) close(); });
    el.querySelector('#org-close').addEventListener('click', close);
    el.querySelector('#org-add').addEventListener('click', newList);
    el.querySelector('#org-search').addEventListener('input', (e) => {
      query = e.target.value.trim();
      renderAll();
    });
    // a drag that ends anywhere lets go of what it was holding
    el.addEventListener('dragend', () => { held = null; });

    // The empty space under the rows appends. Bound to the list rather than
    // rebuilt with it — the rows come and go on every render, the <ul> doesn't.
    const items = el.querySelector('#org-items');
    items.addEventListener('dragover', (e) => { if (held) e.preventDefault(); });
    items.addEventListener('drop', (e) => {
      const p = lib.playlists.find((x) => x.id === selectedList);
      if (!held || !p) return;
      e.preventDefault();
      if (held.from === 'items') moveItem(lib, p.id, held.index, p.items.length);
      else addToPlaylist(lib, p.id, held.key);
      held = null;
      render();
      onChange?.();
    });
  }

  function newList() {
    const name = prompt('playlist name:')?.trim();
    if (!name) return;
    selectedList = addPlaylist(lib, name).id;
    render();
    onChange?.();
  }

  // --- pane 1: the playlists ---

  function renderLists() {
    const ul = el.querySelector('#org-lists');
    ul.innerHTML = '';
    if (!lib.playlists.length) {
      ul.innerHTML = '<li class="org-empty">no playlists yet — + to start one</li>';
      return;
    }
    for (const p of lib.playlists) {
      const li = document.createElement('li');
      li.className = p.id === selectedList ? 'on' : '';
      const name = document.createElement('span');
      name.textContent = p.name;
      const count = document.createElement('em');
      count.textContent = p.items.length;
      const rename = iconButton('✎', `rename ${p.name}`, () => {
        const next = prompt('playlist name:', p.name)?.trim();
        if (!next) return;
        renamePlaylist(lib, p.id, next);
        render();
        onChange?.();
      });
      const del = iconButton('✕', `delete ${p.name}`, () => {
        if (!confirm(`Delete playlist "${p.name}"? The sketches themselves stay.`)) return;
        removePlaylist(lib, p.id);
        if (selectedList === p.id) selectedList = lib.playlists[0]?.id ?? null;
        render();
        onChange?.();
      });
      del.classList.add('org-del');
      li.append(name, count, rename, del);
      li.addEventListener('click', () => { selectedList = p.id; render(); });

      // dropping a sketch on a playlist adds it to the end, whichever
      // playlist is currently open in the middle pane
      li.addEventListener('dragover', (e) => {
        if (held?.from !== 'all') return;
        e.preventDefault();
        li.classList.add('org-over');
      });
      li.addEventListener('dragleave', () => li.classList.remove('org-over'));
      li.addEventListener('drop', (e) => {
        li.classList.remove('org-over');
        if (held?.from !== 'all') return;
        e.preventDefault();
        e.stopPropagation();
        addToPlaylist(lib, p.id, held.key);
        held = null;
        render();
        onChange?.();
      });
      ul.appendChild(li);
    }
  }

  // --- pane 2: what's in the selected playlist ---

  function renderItems() {
    const title = el.querySelector('#org-items-title');
    const ul = el.querySelector('#org-items');
    const p = lib.playlists.find((x) => x.id === selectedList);
    title.textContent = p ? p.name : 'contents';
    ul.innerHTML = '';
    if (!p) {
      ul.innerHTML = '<li class="org-empty">pick a playlist on the left</li>';
      return;
    }
    if (!p.items.length) {
      ul.innerHTML = '<li class="org-empty">empty — drag sketches in from the right</li>';
    }
    const known = new Map(sketches().map((s) => [s.key, s]));
    p.items.forEach((key, i) => {
      const s = known.get(key);
      const li = document.createElement('li');
      li.draggable = true;
      li.dataset.index = i;
      const n = document.createElement('i');
      n.className = 'org-n';
      n.textContent = i + 1;
      const name = document.createElement('span');
      // a sketch can be deleted out from under a playlist that still plays it
      name.textContent = s ? s.name : `${key.split(':').slice(1).join(':')} (missing)`;
      if (!s) name.className = 'org-missing';
      const up = iconButton('↑', 'move up', () => { moveItem(lib, p.id, i, i - 1); render(); onChange?.(); });
      const down = iconButton('↓', 'move down', () => { moveItem(lib, p.id, i, i + 2); render(); onChange?.(); });
      up.disabled = i === 0;
      down.disabled = i === p.items.length - 1;
      const del = iconButton('✕', 'remove from playlist', () => { removeAt(lib, p.id, i); render(); onChange?.(); });
      del.classList.add('org-del');
      li.append(n, name, up, down, del);
      li.addEventListener('click', () => selectSketch(key));
      li.addEventListener('dragstart', (e) => {
        held = { from: 'items', key, index: i };
        e.dataTransfer.setData('text/plain', key); // Firefox won't start a drag without it
      });
      li.addEventListener('dragover', (e) => {
        if (!held) return;
        e.preventDefault();
        // above or below the midline decides which side of this row it lands
        const box = li.getBoundingClientRect();
        li.classList.toggle('org-before', e.clientY < box.top + box.height / 2);
        li.classList.toggle('org-after', e.clientY >= box.top + box.height / 2);
      });
      li.addEventListener('dragleave', () => li.classList.remove('org-before', 'org-after'));
      li.addEventListener('drop', (e) => {
        const after = li.classList.contains('org-after');
        li.classList.remove('org-before', 'org-after');
        if (!held) return;
        e.preventDefault();
        e.stopPropagation();
        const at = i + (after ? 1 : 0);
        if (held.from === 'items') moveItem(lib, p.id, held.index, at);
        else addToPlaylist(lib, p.id, held.key, at);
        held = null;
        render();
        onChange?.();
      });
      ul.appendChild(li);
    });
  }

  // --- pane 3: everything you have ---

  function renderAll() {
    const ul = el.querySelector('#org-all');
    ul.innerHTML = '';
    const hits = sketches().filter((s) => matches(query, s.name, [...s.tags, ...manualTags(lib, s.key)]));
    if (!hits.length) {
      ul.innerHTML = '<li class="org-empty">nothing matches that</li>';
      return;
    }
    for (const s of hits) {
      const li = document.createElement('li');
      li.draggable = true;
      li.className = s.key === selectedSketch ? 'on' : '';
      const name = document.createElement('span');
      name.textContent = s.name;
      if (s.scope === 'examples') {
        const badge = document.createElement('em');
        badge.className = 'org-badge';
        badge.textContent = 'ex';
        name.appendChild(badge);
      }
      const add = iconButton('+', 'add to the open playlist', () => {
        if (!selectedList) return;
        addToPlaylist(lib, selectedList, s.key);
        render();
        onChange?.();
      });
      add.disabled = !selectedList;
      li.append(name, tagChips([...s.tags, ...manualTags(lib, s.key)]), add);
      li.addEventListener('click', () => selectSketch(s.key));
      li.addEventListener('dragstart', (e) => {
        held = { from: 'all', key: s.key };
        e.dataTransfer.setData('text/plain', s.key);
      });
      ul.appendChild(li);
    }
  }

  // --- the tag editor ---

  function selectSketch(key) {
    selectedSketch = key;
    renderAll();
    renderTagbar();
  }

  function renderTagbar() {
    const bar = el.querySelector('#org-tagbar');
    bar.innerHTML = '';
    const s = sketches().find((x) => x.key === selectedSketch);
    if (!s) {
      bar.innerHTML = '<span class="org-tagfor">select a sketch to tag it</span>';
      return;
    }
    const label = document.createElement('span');
    label.className = 'org-tagfor';
    label.textContent = `tags for ${s.name}`;
    const auto = tagChips(s.tags, 'auto');
    auto.title = 'read from the sketch itself';
    const input = document.createElement('input');
    input.id = 'org-tagin';
    input.type = 'text';
    input.placeholder = 'your tags, comma separated';
    input.value = manualTags(lib, s.key).join(', ');
    const commit = () => {
      setManualTags(lib, s.key, input.value.split(','));
      renderAll();
      onChange?.();
    };
    input.addEventListener('change', commit);
    input.addEventListener('blur', commit);
    // enter shouldn't have to reach for the mouse to confirm
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
    bar.append(label, auto, input);
  }

  // --- shared bits ---

  function tagChips(tags, cls = '') {
    const wrap = document.createElement('span');
    wrap.className = `org-tags ${cls}`;
    for (const t of tags) {
      const chip = document.createElement('i');
      chip.textContent = t;
      wrap.appendChild(chip);
    }
    return wrap;
  }

  function iconButton(glyph, title, onClick) {
    const b = document.createElement('button');
    b.textContent = glyph;
    b.title = title;
    b.addEventListener('click', (e) => {
      e.stopPropagation(); // the row underneath is a selection, not this
      onClick();
    });
    return b;
  }

  function render() {
    renderLists();
    renderItems();
    renderAll();
    renderTagbar();
  }

  const onKey = (e) => {
    // esc closes, unless it's dismissing the text field you're typing in
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    close();
  };

  function close() {
    held = null;
    el?.classList.remove('show');
    window.removeEventListener('keydown', onKey);
    onChange?.();
  }

  function open() {
    if (!el) build();
    if (!selectedList) selectedList = lib.playlists[0]?.id ?? null;
    el.classList.add('show');
    window.addEventListener('keydown', onKey);
    render();
    el.querySelector('#org-search').focus();
  }

  return { open, close };
}
