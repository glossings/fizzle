// Snippets (ctrl+j): a piece of a sketch kept for re-use, with the declarations
// it leans on. With code selected, ctrl+j names and tags it; with nothing
// selected it opens the browser: search, read, edit, and put one back at the
// cursor (enter, the row's →, or drag the row into the code). Every sketch is
// in the browser too, under the snippets: read-only, and it goes in as a labeled
// block (sketch-blocks.js) with a sketch('name') line to show it, so its bg,
// camera and the rest stay its own.
//
// A snippet is a plain .js file whose first line may carry its tags:
//
//   // @tags feedback, glow
//   const speed = 0.4
//
//   input().scale(1.01).comp(noise({ speed }), 'add', 0.9)
//
// so the folder reads and hand-edits like the sketches next to it
// (sketches/user/snippets/ via the dev-server API, localStorage without one).

import './snippets.css';
import { EditorView, basicSetup } from 'codemirror';
import { keymap, tooltips } from '@codemirror/view';
import { Compartment, EditorState, Prec } from '@codemirror/state';
import { completionStatus } from '@codemirror/autocomplete';
import { indentMore, indentLess } from '@codemirror/commands';
import { oneDark } from '@codemirror/theme-one-dark';
import { sketchLanguage } from './complete.js';
import { autoTags, isoDay } from './library.js';
import { nameOk, NAME_RULE } from './sketch-name.js';
import { allSketches, sketchSource } from './sidebar.js';
import { carriesFor, planInsert, slotFor, topLevelDecls } from './snippet-deps.js';
import { blockLabels } from './sketch-blocks.js';

const LS_SNIPPETS = 'td-snippets'; // { name: { source, mtime } }
const SNIPPET_DND = 'application/x-fizzle-snippet';

// settled at build time, like the sketch store next door: a failed fetch in a
// dev build is a server restarting, not a reason to write shadow copies
const onDisk = import.meta.env?.DEV ?? false;

const TAGS_LINE = /^\/\/ @tags[ \t]*(.*)\r?\n?/;

const cleanTags = (s) => [...new Set(s.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean))];

export function parseSnippet(source) {
  const m = TAGS_LINE.exec(source);
  return m ? { tags: cleanTags(m[1]), code: source.slice(m[0].length) } : { tags: [], code: source };
}

export const formatSnippet = (code, tags) => {
  const body = code.replace(/\s+$/, '') + '\n';
  return tags.length ? `// @tags ${tags.join(', ')}\n${body}` : body;
};

// --- storage ---------------------------------------------------------------

const lsAll = () => { try { return JSON.parse(localStorage.getItem(LS_SNIPPETS)) ?? {}; } catch { return {}; } };
const lsWrite = (all) => localStorage.setItem(LS_SNIPPETS, JSON.stringify(all));
const url = (name, verb = '') => `/api/snippets/${encodeURIComponent(name)}${verb}`;

async function request(path, init, what) {
  const r = await fetch(path, init);
  if (!r.ok) throw new Error(r.status === 409 ? 'that name is taken' : `${what} failed (${r.status})`);
  return r;
}

// newest first: the one you just kept is the one you're most likely after
async function listSnippets() {
  const raw = onDisk
    ? await (await request('/api/snippets', undefined, 'reading snippets')).json()
    : Object.entries(lsAll()).map(([name, v]) => ({ name, ...v }));
  return raw
    .map(({ name, source, mtime }) => ({ name, mtime: mtime ?? 0, ...parseSnippet(source ?? '') }))
    .sort((a, b) => b.mtime - a.mtime || a.name.localeCompare(b.name));
}

async function writeSnippet(name, source) {
  if (onDisk) return void await request(url(name), { method: 'PUT', body: source }, 'save');
  lsWrite({ ...lsAll(), [name]: { source, mtime: Date.now() } });
}

async function renameSnippet(from, to) {
  if (onDisk) return void await request(url(from, '/rename'), { method: 'POST', body: to }, 'rename');
  const all = lsAll();
  if (to in all) throw new Error('that name is taken');
  all[to] = all[from];
  delete all[from];
  lsWrite(all);
}

async function removeSnippet(name) {
  if (onDisk) return void await request(url(name), { method: 'DELETE' }, 'delete');
  const all = lsAll();
  delete all[name];
  lsWrite(all);
}

// --- what the editor hands over, and takes back ------------------------------

// The selection with its common indentation taken off, so a chain lifted from
// inside a callback doesn't carry that callback's margin into the next sketch.
export function dedent(code) {
  const lines = code.replace(/^\n+|\s+$/g, '').split('\n');
  const margins = lines.filter((l) => l.trim()).map((l) => /^[ \t]*/.exec(l)[0].length);
  const cut = margins.length ? Math.min(...margins) : 0;
  return lines.map((l) => l.slice(cut)).join('\n');
}

// Buses the snippet publishes that the sketch already does: the insert still
// happens, since renaming one is a two-second edit, but silently it would look
// like the snippet or the sketch had stopped working.
const busesIn = (code) => new Set([...code.matchAll(/\.out\(\s*(['"`])([^'"`]+)\1/g)].map((m) => m[2]));
export function busClashes(code, doc) {
  const taken = busesIn(doc);
  return [...busesIn(code)].filter((b) => taken.has(b));
}

// What the selection calls itself, if anything: the bus it sends out, or the
// name it declares.
const suggestedName = (code) => [...busesIn(code)][0] ?? topLevelDecls(code)[0]?.names[0] ?? '';

// A sketch's name as a label: 'kirbster v2' -> kirbster_v2, numbered when the
// sketch already has a block called that.
const RESERVED = new Set('break case catch class const continue debugger default delete do else export extends finally for function if import in instanceof new return super switch this throw try typeof var void while with yield let static await enum null true false'.split(' '));
function labelFor(name, doc) {
  let base = name.trim().replace(/[^\w$]+/g, '_').replace(/^_+|_+$/g, '') || 'sketch';
  if (/^\d/.test(base) || RESERVED.has(base)) base = `_${base}`;
  const taken = new Set(blockLabels(doc).map((b) => b.name));
  let label = base;
  for (let n = 2; taken.has(label); n++) label = `${base}_${n}`;
  return label;
}

// every word has to land somewhere; tag:x only looks at tags
function matches(query, s) {
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((w) => (
    w.startsWith('tag:') ? s.allTags.some((t) => t.includes(w.slice(4))) : s.hay.includes(w)
  ));
}

// A small editor that looks and highlights like the main one. Enter is a
// newline in here; ctrl/cmd+s and ctrl/cmd+enter are `onSave`.
function codePane(parent, { onSave, onEscape, onShiftTab, onEdit }) {
  const lock = new Compartment();
  const locked = (on) => [EditorState.readOnly.of(on), EditorView.editable.of(!on)];
  let setting = false;
  const save = () => { onSave(); return true; };
  const view = new EditorView({
    parent,
    extensions: [
      Prec.highest(keymap.of([
        { key: 'Mod-s', run: save },
        { key: 'Ctrl-s', run: save },
        { key: 'Mod-Enter', run: save },
        { key: 'Ctrl-Enter', run: save },
        // an open completion list gets the first esc
        { key: 'Escape', run: (v) => (completionStatus(v.state) ? false : (onEscape(), true)) },
        { key: 'Tab', run: indentMore, shift: (v) => (onShiftTab ? (onShiftTab(), true) : indentLess(v)) },
      ])),
      basicSetup,
      sketchLanguage,
      oneDark,
      EditorView.lineWrapping,
      // the panel clips its overflow, and a completion list is taller than it
      tooltips({ parent: document.body }),
      lock.of(locked(false)),
      EditorView.updateListener.of((u) => { if (u.docChanged && !setting) onEdit?.(); }),
    ],
  });
  return {
    view,
    get value() { return view.state.doc.toString(); },
    set(text) {
      setting = true;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
      setting = false;
    },
    lock(on) { view.dispatch({ effects: lock.reconfigure(locked(on)) }); },
    focusEnd() {
      view.focus();
      view.dispatch({ selection: { anchor: view.state.doc.length }, scrollIntoView: true });
    },
  };
}

// --- the window --------------------------------------------------------------

export function initSnippets({ getView, flash }) {
  let el = null;
  let mode = null;      // 'save' | 'browse'
  let savePane = null;
  let browsePane = null;
  // save
  let carries = [];     // [{ names, code, off }] declarations the selection leans on
  let names = new Set();
  // browse
  let all = [];         // every snippet
  let shown = [];       // the ones the search leaves
  let sel = null;       // key: 'snippet:name', or a sketch's 'user:name' / 'examples:name'
  let listing = 0;      // bumps per open, so a slow source load knows it's stale
  let pinned = false;   // a click or the arrows chose this row; hover stops swapping it
  let dirty = false;    // its code has been edited and not yet saved
  let at = 0;           // where an insert lands, taken on the way in

  const $ = (q) => el.querySelector(q);
  const current = () => shown.find((s) => s.key === sel) ?? null;

  function build() {
    el = document.createElement('div');
    el.id = 'sn-modal';
    el.innerHTML = `
      <div id="sn-panel">
        <header>
          <span class="sn-title"></span>
          <span class="sn-hint"></span>
          <button id="sn-close" title="close (esc)">✕</button>
        </header>
        <div class="sn-save">
          <div class="sn-fields">
            <input id="sn-name" placeholder="snippet name" maxlength="60" spellcheck="false" autocomplete="off">
            <input id="sn-tags" placeholder="tags, comma separated" spellcheck="false" autocomplete="off">
          </div>
          <div id="sn-save-code" class="sn-code"></div>
          <div id="sn-carries"></div>
        </div>
        <div class="sn-browse">
          <input id="sn-search" placeholder="search names, tags and code · tag:glow" spellcheck="false" autocomplete="off">
          <div class="sn-body">
            <div id="sn-list" tabindex="0"></div>
            <div id="sn-browse-code" class="sn-code"></div>
          </div>
        </div>
        <footer>
          <span id="sn-note"></span>
          <button id="sn-cancel" class="sn-when-editing">cancel</button>
          <button id="sn-keep" class="sn-when-editing sn-primary" title="ctrl+s">save</button>
          <button id="sn-go" class="sn-when-idle sn-primary"></button>
        </footer>
      </div>`;
    document.body.appendChild(el);

    savePane = codePane($('#sn-save-code'), { onSave: save, onEscape: close });
    browsePane = codePane($('#sn-browse-code'), {
      onSave: saveEdit,
      onEdit: () => setDirty(true),
      onShiftTab: () => $('#sn-search').focus(),
      // out of an edit first, then out of the code, then (from the search) out
      onEscape: () => {
        if (dirty) return cancelEdit();
        unpin();
        $('#sn-search').focus();
      },
    });

    el.addEventListener('mousedown', (e) => { if (e.target === el) close(); });
    $('#sn-close').addEventListener('click', close);
    $('#sn-go').addEventListener('click', () => (mode === 'save' ? save() : insertCurrent()));
    $('#sn-keep').addEventListener('click', saveEdit);
    $('#sn-cancel').addEventListener('click', cancelEdit);
    $('#sn-name').addEventListener('input', syncSave);
    $('#sn-search').addEventListener('input', () => { unpin(); renderList(); });
    el.addEventListener('keydown', onKey);
  }

  // Nothing typed in here reaches the editor's or the canvas's bindings,
  // except the ctrl+j that closes the window it opened.
  function onKey(e) {
    if (e.ctrlKey && e.key === 'j') return;
    e.stopPropagation();
    // the code panes and the rename field own their keys
    if (e.target.closest?.('.cm-editor') || e.target.classList?.contains('sn-rename')) return;
    if (e.key === 'Escape') { e.preventDefault(); return close(); }
    if (mode === 'save') {
      if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); save(); }
      return;
    }
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      editCurrent();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (dirty || !shown.length) return;
      const i = shown.findIndex((s) => s.key === sel);
      select(shown[Math.max(0, Math.min(shown.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]);
      pin(); // the arrows are as deliberate as a click
    } else if (e.key === 'Enter') {
      e.preventDefault();
      insertCurrent();
    }
  }

  const note = (text, bad = false) => {
    const n = $('#sn-note');
    n.textContent = text;
    n.classList.toggle('bad', bad);
  };

  function show(next) {
    if (!el) build();
    mode = next;
    $('#sn-panel').className = `sn-${mode}-mode`;
    $('.sn-title').textContent = mode === 'save' ? 'save snippet' : 'snippets';
    $('.sn-hint').textContent = mode === 'save'
      ? 'enter in a field, or ctrl+s in the code, saves'
      : '↑↓ choose · enter inserts · tab edits · drag a row into the code';
    $('#sn-go').textContent = mode === 'save' ? 'save' : 'insert';
    note('');
    el.classList.add('show');
  }

  function close() {
    if (!el?.classList.contains('show')) return;
    el.classList.remove('show', 'editing', 'dragging');
    mode = null;
    dirty = false;
    getView().focus();
  }

  // --- save ---

  function openSave(doc, from, to) {
    show('save');
    const body = dedent(doc.slice(from, to));
    carries = carriesFor(doc, from, to).map((c) => ({ ...c, off: false }));
    names = new Set();
    $('#sn-name').value = suggestedName(body);
    $('#sn-tags').value = '';
    savePane.set([...carries.map((c) => c.code), ...(carries.length ? [''] : []), body].join('\n'));
    drawCarries();
    $('#sn-name').focus();
    $('#sn-name').select();
    syncSave();
    // only for the overwrite warning, so a list that won't load doesn't block a save
    listSnippets().then((l) => { names = new Set(l.map((s) => s.name)); syncSave(); }).catch(() => {});
  }

  // One chip per declaration that came along. ✕ takes its lines back out of the
  // code above, + puts them back; the code is what gets saved either way, so
  // anything done to it by hand wins.
  function drawCarries() {
    const box = $('#sn-carries');
    box.innerHTML = '';
    if (!carries.length) return;
    const lead = document.createElement('span');
    lead.className = 'sn-carries-lead';
    lead.textContent = 'included:';
    box.append(lead);
    for (const c of carries) {
      const chip = document.createElement('span');
      chip.className = `sn-chip${c.off ? ' off' : ''}`;
      chip.textContent = c.names.join(', ');
      chip.title = c.code.length > 300 ? `${c.code.slice(0, 300)}…` : c.code;
      const x = document.createElement('button');
      x.type = 'button';
      x.textContent = c.off ? '+' : '✕';
      x.title = c.off ? 'include this definition' : 'leave this definition out';
      x.addEventListener('click', () => toggleCarry(c));
      chip.append(x);
      box.append(chip);
    }
  }

  function toggleCarry(c) {
    const text = savePane.value;
    if (c.off) {
      // back where it was: after the nearest one above it that's still there,
      // since a declaration has to come before whatever reads it
      const above = carries.slice(0, carries.indexOf(c)).reverse().find((o) => !o.off && text.includes(o.code));
      if (above) {
        const i = text.indexOf(above.code) + above.code.length;
        savePane.set(`${text.slice(0, i)}\n${c.code}${text.slice(i)}`);
      } else savePane.set(`${c.code}\n${carries.some((o) => !o.off) ? '' : '\n'}${text}`);
    } else {
      const i = text.indexOf(c.code);
      if (i < 0) return note(`${c.names.join(', ')} isn't in the code any more`);
      savePane.set((text.slice(0, i) + text.slice(i + c.code.length).replace(/^[ \t]*\n/, '')).replace(/^\n+/, ''));
    }
    c.off = !c.off;
    note('');
    drawCarries();
  }

  function syncSave() {
    if (mode !== 'save') return;
    const name = $('#sn-name').value.trim();
    const bad = name && !nameOk(name);
    const exists = names.has(name);
    $('#sn-go').disabled = !name || bad;
    $('#sn-go').textContent = exists ? 'overwrite' : 'save';
    if (bad) note(NAME_RULE, true);
    else if (exists) note(`"${name}" already exists, saving replaces it`);
    else note('');
  }

  async function save() {
    const name = $('#sn-name').value.trim();
    if (!name || !nameOk(name)) return $('#sn-name').focus();
    if (!savePane.value.trim()) return note('nothing to save', true);
    try {
      await writeSnippet(name, formatSnippet(savePane.value, cleanTags($('#sn-tags').value)));
    } catch (e) {
      return note(e.message, true);
    }
    close();
    flash(`snippet saved: ${name}`);
  }

  // --- browse ---

  async function openBrowse(cursor) {
    show('browse');
    at = cursor;
    all = shown = [];
    sel = null;
    pinned = false;
    setDirty(false);
    $('#sn-search').value = '';
    $('#sn-list').innerHTML = '';
    browsePane.set('');
    browsePane.lock(true);
    $('#sn-go').disabled = true;
    $('#sn-search').focus();
    await refresh();
  }

  async function refresh() {
    let listed;
    try {
      listed = await listSnippets();
    } catch (e) {
      return note(e.message, true);
    }
    if (mode !== 'browse') return;
    let sketches = [];
    try { sketches = await allSketches(); } catch { /* the snippets are still worth showing */ }
    if (mode !== 'browse') return;
    // what was kept on purpose first, then your sketches newest first, then the examples
    const rank = (f) => (f.scope === 'user' ? 0 : 1);
    sketches.sort((x, y) => rank(x) - rank(y) || y.mtime - x.mtime || x.name.localeCompare(y.name));
    all = [
      ...listed.map((s) => index({ ...s, key: `snippet:${s.name}`, kind: 'snippet' })),
      ...sketches.map((f) => index({
        key: `${f.scope}:${f.name}`, kind: 'sketch', scope: f.scope, name: f.name, mtime: f.mtime,
        tags: f.scope === 'examples' ? ['sketch', 'example'] : ['sketch'], code: null,
      })),
    ];
    renderList();
    loadSources(++listing);
  }

  // derived tags answer a search ("particles") without anyone typing them in
  function index(s) {
    s.allTags = [...s.tags, ...(s.code ? autoTags(s.code) : [])];
    s.hay = [s.name, ...s.allTags, s.code ?? ''].join('\n').toLowerCase();
    return s;
  }

  function fill(s) {
    return (s.loading ??= (async () => {
      let src = '';
      try { src = (await sketchSource(s.scope, s.name)) ?? ''; } catch { /* shows empty */ }
      s.code = src;
      index(s);
      if (s.key === sel && mode === 'browse' && !dirty) select(s);
    })());
  }

  // In the background, so a search reaches inside sketches nobody has hovered.
  async function loadSources(gen) {
    const queue = all.filter((s) => s.kind === 'sketch');
    const worker = async () => {
      for (let s; (s = queue.shift());) {
        if (gen !== listing || mode !== 'browse') return;
        await fill(s);
      }
    };
    await Promise.all(Array.from({ length: 8 }, worker));
    if (gen === listing && mode === 'browse' && !dirty && $('#sn-search').value.trim()) renderList();
  }

  function renderList() {
    if (mode !== 'browse') return;
    const q = $('#sn-search').value;
    shown = all.filter((s) => matches(q, s));
    const list = $('#sn-list');
    list.innerHTML = '';
    if (!shown.length) {
      const empty = document.createElement('div');
      empty.className = 'sn-empty';
      empty.textContent = q.trim() ? 'no snippets match' : 'nothing kept yet: select some code in the editor, then ctrl+j';
      list.append(empty);
    }
    for (const s of shown) {
      if (s.kind === 'sketch' && shown[shown.indexOf(s) - 1]?.kind !== 'sketch') {
        const div = document.createElement('div');
        div.className = 'sn-divider';
        div.textContent = 'sketches';
        list.append(div);
      }
      list.append(row(s));
    }
    select(current() ?? shown[0] ?? null);
    if (pinned && current()) pin(); else unpin();
  }

  function row(s) {
    const r = document.createElement('div');
    const kept = s.kind === 'snippet';
    r.className = `sn-row${kept ? '' : ' sn-row-sketch'}`;
    r.dataset.key = s.key;
    r.draggable = true;
    r.title = kept
      ? 'hover to preview, click to edit it on the right · enter or → inserts at the cursor, or drag it into the code'
      : "a whole sketch: inserts as a labeled block with a sketch('name') line · enter or → inserts at the cursor, or drag it into the code";

    const main = document.createElement('div');
    main.className = 'sn-row-main';
    const label = document.createElement('span');
    label.className = 'sn-row-name';
    label.textContent = s.name;
    if (kept) {
      label.title = 'click to rename';
      label.addEventListener('click', (e) => { e.stopPropagation(); renameInline(s, label); });
    }
    const meta = document.createElement('span');
    meta.className = 'sn-row-meta';
    meta.textContent = [...s.tags.map((t) => `#${t}`), ...(s.mtime ? [isoDay(s.mtime)] : [])].join(' · ');
    main.append(label, meta);
    r.append(main);

    const put = document.createElement('button');
    put.textContent = '→';
    put.title = 'insert at the cursor';
    put.addEventListener('click', (e) => { e.stopPropagation(); if (!dirty) { select(s); insertCurrent(); } });
    // two presses, the second one on a button that says what it will do
    const del = document.createElement('button');
    del.textContent = '✕';
    del.title = 'delete';
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (dirty) return;
      if (!del.classList.contains('armed')) {
        del.classList.add('armed');
        del.textContent = 'delete?';
        return;
      }
      try {
        await removeSnippet(s.name);
      } catch (err) {
        return note(err.message, true);
      }
      if (sel === s.key) { sel = null; pinned = false; }
      refresh();
    });
    del.addEventListener('mouseleave', () => { del.classList.remove('armed'); del.textContent = '✕'; });
    r.append(put, ...(kept ? [del] : []));

    // hover peeks, click pins: once a row is pinned the pointer can cross the
    // others on its way to the code without the preview changing under it
    r.addEventListener('mouseenter', () => { if (!pinned && !dirty) select(s); });
    r.addEventListener('click', () => {
      if (dirty) return;
      select(s);
      pin();
    });
    // text/plain too, so the editor draws its drop cursor as the pointer crosses
    // the code; the private type is how the drop knows to re-indent and check
    r.addEventListener('dragstart', (e) => {
      if (dirty || s.code == null) return e.preventDefault();
      e.dataTransfer.setData('text/plain', s.code);
      e.dataTransfer.setData(SNIPPET_DND, s.key);
      e.dataTransfer.effectAllowed = 'copy';
      // out of the way so the drop lands on the code, but only hidden: a drag
      // let go anywhere else leaves the browser where it was. Deferred, since
      // hiding the dragged element inside its own dragstart cancels the drag.
      setTimeout(() => el.classList.add('dragging'));
    });
    r.addEventListener('dragend', () => el.classList.remove('dragging'));
    return r;
  }

  function renameInline(s, label) {
    if (dirty || label.querySelector('input')) return;
    const input = document.createElement('input');
    input.className = 'sn-rename';
    input.value = s.name;
    input.maxLength = 60;
    input.spellcheck = false;
    label.textContent = '';
    label.append(input);
    let done = false;
    const finish = async (commit) => {
      if (done) return;
      done = true;
      const to = input.value.trim();
      label.textContent = s.name;
      if (!commit || !to || to === s.name) return;
      if (!nameOk(to)) return note(NAME_RULE, true);
      try {
        await renameSnippet(s.name, to);
      } catch (e) {
        return note(e.message, true);
      }
      if (sel === s.key) sel = `snippet:${to}`;
      refresh();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('click', (e) => e.stopPropagation());
    input.focus();
    input.select();
  }

  function select(s) {
    sel = s?.key ?? null;
    for (const r of $('#sn-list').querySelectorAll('.sn-row')) {
      const on = r.dataset.key === sel;
      r.classList.toggle('current', on);
      if (on) r.scrollIntoView({ block: 'nearest' });
    }
    browsePane.set(s?.code ?? '');
    browsePane.lock(!(s?.kind === 'snippet' && pinned));
    $('#sn-go').disabled = !s;
    if (s?.kind !== 'sketch') return note('');
    if (s.code == null) { note('loading…'); return void fill(s); }
    note(`a whole sketch, read-only here · goes in as ${labelFor(s.name, '')}: { ... } with its own bg, camera and the rest`);
  }

  function pin() {
    if (!sel) return;
    pinned = true;
    browsePane.lock(current()?.kind !== 'snippet');
    for (const r of $('#sn-list').querySelectorAll('.sn-row')) r.classList.toggle('pinned', r.dataset.key === sel);
  }

  function unpin() {
    pinned = false;
    if (el) for (const r of $('#sn-list').querySelectorAll('.sn-row.pinned')) r.classList.remove('pinned');
  }

  function editCurrent() {
    if (dirty || !sel) return;
    pin();
    if (current()?.kind === 'sketch') return note('a sketch is edited by opening it; from here it can only be put in');
    browsePane.focusEnd();
  }

  // An edit under way: the footer offers save and cancel, and the list goes
  // quiet so a hover can't swap the code out from under it.
  function setDirty(on) {
    dirty = on;
    el.classList.toggle('editing', on);
    note(on ? `editing "${current()?.name}" · ctrl+s saves, esc cancels` : '');
  }

  function cancelEdit() {
    if (!dirty) return;
    setDirty(false);
    select(current());
  }

  async function saveEdit() {
    const s = current();
    if (!dirty || !s) return;
    const code = browsePane.value;
    if (code === s.code) return cancelEdit();
    try {
      await writeSnippet(s.name, formatSnippet(code, s.tags));
    } catch (e) {
      return note(e.message, true);
    }
    // in place, not a refresh: the list is newest first, and a save would
    // send the row you were on to the top
    s.code = formatSnippet(code, []);
    index(s);
    setDirty(false);
    note(`saved "${s.name}"`);
  }

  // --- putting one back ---

  // A whole sketch goes in as a labeled block, untouched, and a sketch('name')
  // to show it. On an empty line that's the block and then `.out()` under it.
  // Anywhere else the cursor is in the middle of something, so the block goes
  // above that statement and the cursor gets the bare sketch('name'), which is
  // what a .comp( or a select([ was waiting for.
  function insertSketch(s, pos) {
    const view = getView();
    const doc = view.state.doc.toString();
    const label = labelFor(s.name, doc);
    const line = view.state.doc.lineAt(pos);
    const open = !line.text.trim();
    const slot = open ? line.from : slotFor(doc, pos);
    const above = slot ? view.state.doc.lineAt(slot - 1).text : '';
    const body = s.code.replace(/\s+$/, '').replace(/^(?=.)/gm, '  ');
    const block = `${above.trim() ? '\n' : ''}${label}: {\n${body}\n}\n`;
    const use = open ? `sketch('${label}').out()` : `sketch('${label}')`;
    view.dispatch({
      changes: [{ from: slot, insert: open ? block : `${block}\n` }, { from: open ? line.from : pos, to: open ? line.to : pos, insert: use }],
      selection: { anchor: (open ? line.from : pos) + block.length + (open ? 0 : 1) + use.length },
      scrollIntoView: true,
      userEvent: 'input.paste',
    });
    close();
    flash(`inserted ${s.name} as ${label}`);
  }

  // The selected code goes in at `pos`; what it brought along goes above the
  // statement `pos` is in, where a declaration belongs.
  function insert(s, pos) {
    if (s.kind === 'sketch') return insertSketch(s, pos);
    const view = getView();
    const doc = view.state.doc.toString();
    // a declaration the sketch already has word for word isn't landed twice
    const plan = planInsert(s.code, doc);
    if (!plan.needs && !plan.body) {
      close();
      return flash(`${s.name}: already in this sketch`);
    }
    const buses = busClashes(`${plan.needs}\n${plan.body}`, doc);
    // the body takes on the margin of the line it lands in
    const line = view.state.doc.lineAt(pos);
    const indent = /^[ \t]*/.exec(line.text)[0].slice(0, pos - line.from);
    const body = plan.body.replace(/\n(?=[^\n])/g, `\n${indent}`); // blank lines stay blank
    const slot = slotFor(doc, pos);
    // a blank line above too, unless it's joining declarations already there
    const above = slot ? view.state.doc.lineAt(slot - 1).text : '';
    const gap = above.trim() && !/^\s*(const|let|var|function|class)\b/.test(above) ? '\n' : '';
    const needs = plan.needs ? `${gap}${plan.needs}\n\n` : '';
    view.dispatch({
      // same position when the cursor is between statements: in array order
      changes: [{ from: slot, insert: needs }, { from: pos, insert: body }],
      selection: { anchor: pos + needs.length + body.length },
      scrollIntoView: true,
      userEvent: 'input.paste',
    });
    close();
    const said = [
      ...(plan.clashes.length ? [`already declares ${plan.clashes.join(', ')}`] : []),
      ...(buses.length ? [`already sends out '${buses.join("', '")}'`] : []),
    ];
    if (!said.length) return flash(`inserted ${s.name}`);
    // amber and slow to clear, like a sketch warning: it needs reading
    window.dispatchEvent(new CustomEvent('fizzle-warning', { detail: `inserted ${s.name}: this sketch ${said.join(' and ')}` }));
  }

  async function insertCurrent() {
    const s = current();
    if (!s || dirty) return;
    if (s.code == null) await fill(s);
    if (mode === 'browse') insert(s, Math.min(at, getView().state.doc.length));
  }

  // A row let go over the code. Capture, so this gets there before the
  // editor's own drop (which would paste the text as it stands).
  let dropWired = false;
  function wireDrop() {
    if (dropWired) return;
    dropWired = true;
    const view = getView();
    view.dom.addEventListener('drop', (e) => {
      const key = e.dataTransfer?.getData(SNIPPET_DND);
      const s = key && all.find((x) => x.key === key);
      if (!s) return;
      e.preventDefault();
      e.stopPropagation();
      insert(s, view.posAtCoords({ x: e.clientX, y: e.clientY }, false));
    }, true);
  }

  function toggle() {
    if (el?.classList.contains('show')) return close();
    const view = getView();
    wireDrop();
    let { from, to, head } = view.state.selection.main;
    const doc = view.state.doc.toString();
    if (!doc.slice(from, to).trim()) return openBrowse(head);
    // a selection that starts after its line's margin still owns that margin,
    // or dedent() would measure the first line at 0 and leave the rest alone
    const line = view.state.doc.lineAt(from);
    if (!line.text.slice(0, from - line.from).trim()) from = line.from;
    openSave(doc, from, to);
  }

  return { toggle, close };
}
