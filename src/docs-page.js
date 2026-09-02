// Interactive docs: prose from docs-content.md, every js code block a live
// CodeMirror editor that runs on a real Engine, plus a searchable reference
// generated from the same table that powers autocomplete (docs.js) so it
// can't drift from the app.
//
// There is one engine and one canvas, and playing a block moves them into it —
// so the picture is always directly under the code that made it, and starting
// a second block is how you stop the first. Scroll that block off the screen
// and the picture follows you into a corner (see floatOut).

import { EditorView, basicSetup } from 'codemirror';
import { keymap } from '@codemirror/view';
import { Prec } from '@codemirror/state';
import { acceptCompletion } from '@codemirror/autocomplete';
import { indentMore, indentLess } from '@codemirror/commands';
import { oneDark } from '@codemirror/theme-one-dark';
import { bodyFor, configSections, infoNodes, GLOBALS, METHODS, GLOBAL_CONFIG, METHOD_CONFIG } from './docs.js';
import { sketchLanguage, apiHover } from './complete.js';
import { Engine } from './engine.js';
import { makeApi } from './api.js';
import { initPolyhaven } from './polyhaven.js';
import { mediaPut, pickFiles, nameList } from './media.js';
import { fillCall } from './editor.js';
import { learnMidi, learnPad } from './control.js';
import { ICON } from './icons.js';
import CONTENT from './docs-content.md?raw';

// --- preview engine --------------------------------------------------------

const canvas = document.getElementById('preview-gl');
const engine = new Engine(canvas);
const api = makeApi(engine);

// the engine sizes itself to the window; re-point it at the preview box
engine.resize = function () {
  const w = canvas.clientWidth || 1;
  const h = canvas.clientHeight || 1;
  this.renderer.setSize(w, h, false);
  this.camera.aspect = w / h;
  this.camera.updateProjectionMatrix();
};
canvas.style.width = '';
canvas.style.height = '';
engine.resize();
new ResizeObserver(() => engine.resize()).observe(canvas);

const park = document.getElementById('preview-park');
const statusEl = document.getElementById('preview-status');
const hintEl = document.getElementById('preview-hint');
const pauseBtn = document.getElementById('preview-pause');
pauseBtn.innerHTML = ICON.pause;
const polyhaven = initPolyhaven();
let active = null; // the block holding the canvas, if any

// a tagged Poly Haven asset an example named is on its way (see fetchAsset)
window.addEventListener('fizzle-notice', (e) => {
  statusEl.textContent = e.detail;
  statusEl.className = '';
});

// Keep watching while you read on. The stage is the last thing in its block, so
// `position: sticky` has nowhere to travel to — instead the picture moves to a
// corner once the block it belongs to has scrolled away, and comes back when
// the block does. Wide screens only: a floating box is exactly what a phone
// hasn't got room for.
const floatBox = document.getElementById('preview-float');
const floatSlot = floatBox.querySelector('.ex-slot');
const backBtn = document.getElementById('float-back');
const wide = matchMedia('(min-width: 701px)');
let floating = false;

const away = new IntersectionObserver((entries) => {
  if (!active) return;
  if (!entries[entries.length - 1].isIntersecting && wide.matches) floatOut();
  else floatIn();
});

function floatOut() {
  if (floating || !active) return;
  floating = true;
  // the block holds on to the space the picture had, so the scroll position
  // you're reading at doesn't jump out from under you
  // the fractional height, not offsetHeight: rounding it shifts the page 1px
  active.stage.style.height = `${active.stage.getBoundingClientRect().height}px`;
  active.stage.classList.add('lent');
  floatBox.prepend(canvas);
  floatSlot.append(statusEl, hintEl, pauseBtn);
  floatBox.classList.add('on');
}

function floatIn() {
  if (!floating) return;
  floating = false;
  floatBox.classList.remove('on');
  if (!active) return;
  active.stage.style.height = '';
  active.stage.classList.remove('lent');
  active.stage.appendChild(canvas);
  active.slot.append(statusEl, hintEl, pauseBtn);
}

backBtn.innerHTML = ICON.back;
backBtn.addEventListener('click', () => active?.ex.scrollIntoView({ block: 'nearest' }));
// Crossing the breakpoint — a phone turned sideways, a window dragged wider —
// changes the answer without changing what's on screen, and the observer only
// speaks up when that changes. Re-observing asks it again.
wide.addEventListener('change', () => {
  if (!wide.matches) floatIn();
  if (active) {
    away.disconnect();
    away.observe(active.stage);
  }
});

// Give the canvas back and leave nothing of the sketch behind: paused first so
// the rewind below freezes media rather than playing it on into a page with no
// picture in it.
function stopActive() {
  if (!active) return;
  away.disconnect();
  floatIn();
  disarmLearn?.();
  disarmLearn = null;
  engine.paused = true;
  engine.clearPatch();
  engine.restartSketch();
  // the last good sketch belongs to the block that ran it; a later block
  // whose code throws shouldn't get this one restored under its own editor
  engine._lastGood = null;
  park.append(canvas, statusEl, hintEl, pauseBtn);
  statusEl.textContent = '·';
  statusEl.className = '';
  active.setRunning(false);
  active = null;
}

// A different block is a different sketch, so it takes the canvas and starts
// clean; re-running the one that's already playing is an edit of it, which
// keeps its trails and counters like the app does.
function runBlock(block, { reveal = false } = {}) {
  const fresh = block !== active;
  if (fresh) {
    stopActive();
    block.stage.appendChild(canvas);
    block.slot.append(statusEl, hintEl, pauseBtn);
    active = block;
    block.setRunning(true);
    away.observe(block.stage);
    engine.resize();
  }
  engine.paused = false;
  pauseBtn.innerHTML = ICON.pause;
  const ctx = { view: block.view, rerun: () => runBlock(block) };
  const err = engine.run(block.view.state.doc.toString(), api);
  if (err) {
    statusEl.textContent = String(err.message ?? err);
    statusEl.className = 'err';
  } else {
    statusEl.textContent = '✓ running';
    statusEl.className = 'ok';
  }
  // only on the way in: an update shouldn't pull the page off the caret
  if (reveal && fresh) block.stage.scrollIntoView({ block: 'nearest' });
  if (!err && engine.pendingPick) handlePick(ctx);
  if (!err) handleLearn(ctx);
}

// An empty videofile()/imagefile()/… asks for a file picker, an empty
// hdri()/.material()/model() for the Poly Haven browser — same as in the app, and
// served the same way here, writing the choice back into the block that asked
// for it. A run is always a click or a ctrl+enter, so the user activation a
// file dialog needs is already in hand.
let picking = false;

async function handlePick({ view, rerun }) {
  // a picker already open owns the gesture; the run that queued this one has
  // been superseded anyway
  if (picking) return;
  const req = engine.pendingPick;
  engine.pendingPick = null;
  // a block that autoran on page load has no activation to spend on a dialog
  if (navigator.userActivation && !navigator.userActivation.isActive) {
    statusEl.textContent = `${req.fn}() has nothing to show yet — press ctrl+enter in the block to pick something`;
    statusEl.className = 'err';
    return;
  }
  picking = true;
  let pick = null;
  let suffix = ''; // the .material() a downloaded model brings with it
  try {
    if (req.browse) {
      // handle comes back tagged ('polyhaven:rock_2k') — see fetchPolyhaven
      const chosen = await polyhaven.open(req.browse);
      const q = chosen && JSON.stringify(chosen.handle);
      if (chosen) pick = chosen.type === 'textures' ? `{ pbr: ${q}, repeat: 2 }` : q;
      if (chosen?.pbr) suffix = `.material({ pbr: ${JSON.stringify(chosen.pbr)} })`;
    } else {
      const files = await pickFiles(req.kind, req.multiple);
      for (const f of files) await mediaPut(f);
      const q = (f) => JSON.stringify(f.name);
      if (files.length) pick = req.multiple ? nameList(files.map((f) => f.name)) : q(files[0]);
    }
  } catch (e) {
    statusEl.textContent = String(e.message ?? e);
    statusEl.className = 'err';
  } finally {
    picking = false;
  }
  if (pick == null) return;
  // fill the arguments into the empty call that asked, then run it again
  if (fillCall(view, req.fn, pick, suffix)) rerun();
}

// An empty cc() / key() / btn() asks to be bound to whatever moves next —
// same deal as a picker, and served the same way here: wait for the control,
// write its numbers into the block, run it again. The learn section of the
// docs is a live block like any other, so it should actually learn.
let disarmLearn = null;

function handleLearn({ view, rerun }) {
  disarmLearn?.();
  disarmLearn = null;
  const req = engine.pendingLearn;
  engine.pendingLearn = null;
  if (!req) return;

  const bind = (args, label) => {
    disarmLearn?.();
    disarmLearn = null;
    if (fillCall(view, req.call, args)) rerun();
    statusEl.textContent = `✓ bound to ${label}`;
    statusEl.className = 'ok';
  };
  const prompt = {
    cc: 'move a knob or fader to bind it',
    key: 'play a key or pad to bind it',
    btn: 'press a button on the controller to bind it',
  }[req.call];

  disarmLearn = req.call === 'btn'
    ? learnPad(req.pad, bind)
    : learnMidi(req.call, req.device, bind);
  statusEl.textContent = `${req.call}() — ${prompt}`;
  statusEl.className = '';
}

function togglePause() {
  if (!active) return;
  pauseBtn.innerHTML = engine.togglePause() ? ICON.play : ICON.pause;
}
pauseBtn.addEventListener('click', togglePause);
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey && !e.metaKey && !e.altKey && e.key === '.' && !e.defaultPrevented) {
    e.preventDefault();
    togglePause();
  }
});

// --- live example blocks ---------------------------------------------------

const HANDOFF_KEY = 'fizzle-handoff';

// the press landing, for a button whose effect might look like nothing
function flash(btn) {
  btn.classList.add('flash');
  setTimeout(() => btn.classList.remove('flash'), 260);
}

function button(label, icon, onClick) {
  const b = document.createElement('button');
  b.innerHTML = icon;
  b.title = label;
  b.setAttribute('aria-label', label);
  b.addEventListener('click', onClick);
  return b;
}

function makeExample(code, autorun) {
  const ex = document.createElement('div');
  ex.className = 'ex';

  // the block runs itself: also how a filled-in pick re-runs (see handlePick)
  const start = (reveal) => runBlock(block, { reveal });

  const runKeys = Prec.highest(
    keymap.of([
      { key: 'Ctrl-Enter', run: () => { start(true); return true; } },
      { key: 'Shift-Enter', run: () => { start(true); return true; } },
      { key: 'Tab', run: acceptCompletion },
      { key: 'Tab', run: indentMore, shift: indentLess },
    ])
  );
  const view = new EditorView({
    doc: code,
    parent: ex,
    extensions: [
      runKeys,
      basicSetup,
      sketchLanguage,
      apiHover,
      oneDark,
      EditorView.lineWrapping,
    ],
  });

  const playBtn = button('play (ctrl+enter)', ICON.play, () =>
    block === active ? stopActive() : start(true)
  );
  playBtn.className = 'ex-play';
  // a re-run of the sketch already playing looks like nothing happened unless
  // the edit changed something, so the button says it landed
  const updBtn = button('update with your edits (ctrl+enter)', ICON.run, () => {
    start(false);
    flash(updBtn);
  });
  updBtn.hidden = true;
  const openBtn = button('open in the app editor', ICON.open, () => {
    localStorage.setItem(HANDOFF_KEY, view.state.doc.toString());
    window.open('/', '_blank');
  });
  const slot = document.createElement('span');
  slot.className = 'ex-slot';

  const bar = document.createElement('div');
  bar.className = 'ex-bar';
  bar.append(playBtn, updBtn, slot, openBtn);
  const stage = document.createElement('div');
  stage.className = 'ex-stage';
  ex.append(bar, stage);

  const block = {
    ex,
    view,
    slot,
    stage,
    setRunning(on) {
      ex.classList.toggle('running', on);
      playBtn.innerHTML = on ? ICON.stop : ICON.play;
      playBtn.title = on ? 'stop' : 'play (ctrl+enter)';
      playBtn.setAttribute('aria-label', playBtn.title);
      updBtn.hidden = !on;
    },
  };

  if (autorun) queueMicrotask(() => start(false));
  return ex;
}

// --- tiny markdown renderer (the subset docs-content.md uses) --------------

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const slug = (s) => s.toLowerCase().replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '');

function inline(s) {
  // protect code spans so bold/link markup inside them stays literal
  const spans = [];
  s = esc(s).replace(/`([^`]+)`/g, (_, c) => `\x00${spans.push(c) - 1}\x00`);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  return s.replace(/\x00(\d+)\x00/g, (_, i) => `<code>${spans[i]}</code>`);
}

const FENCE = /^\s*```/;

function renderMarkdown(md, root) {
  const lines = md.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    // a fence written under a list item is indented; it's still a code block,
    // and the block's own indentation is what's left after that one is taken off
    const fence = line.match(/^(\s*)```(\S*)\s*(.*)$/);
    if (fence) {
      const [, indent, lang, flags] = fence;
      const codeLines = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i])) codeLines.push(lines[i++]);
      i++; // closing fence
      const code = codeLines.map((l) => (l.startsWith(indent) ? l.slice(indent.length) : l)).join('\n');
      // ```js — a live editor; ```js static — a snippet that can't run here
      // (it names files only you have), so it renders as plain code
      if (lang === 'js' && !flags.includes('static')) {
        root.appendChild(makeExample(code, flags.includes('autorun')));
      } else {
        const pre = document.createElement('pre');
        pre.className = 'static';
        pre.textContent = code;
        root.appendChild(pre);
      }
      continue;
    }

    const h = line.match(/^(#{2,3}) (.+)$/);
    if (h) {
      const el = document.createElement(h[1].length === 2 ? 'h2' : 'h3');
      el.id = slug(h[2]);
      el.innerHTML = inline(h[2]);
      root.appendChild(el);
      i++;
      continue;
    }

    if (/^\|/.test(line)) {
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) rows.push(lines[i++]);
      const table = document.createElement('table');
      const cells = (r) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      rows.forEach((r, ri) => {
        if (ri === 1 && /^[\s|:-]+$/.test(r)) return; // header separator
        const tr = table.insertRow();
        for (const c of cells(r)) {
          const cell = document.createElement(ri === 0 ? 'th' : 'td');
          cell.innerHTML = inline(c);
          tr.appendChild(cell);
        }
      });
      root.appendChild(table);
      continue;
    }

    if (/^- /.test(line)) {
      const ul = document.createElement('ul');
      let item = null;
      while (i < lines.length && !FENCE.test(lines[i])
             && (/^- /.test(lines[i]) || /^ {2,}\S/.test(lines[i]))) {
        if (/^- /.test(lines[i])) {
          item = document.createElement('li');
          item.innerHTML = inline(lines[i].slice(2));
          ul.appendChild(item);
        } else if (item) {
          item.innerHTML += ' ' + inline(lines[i].trim());
        }
        i++;
      }
      root.appendChild(ul);
      continue;
    }

    // paragraph: gather until a blank line or a new block form
    const para = [];
    while (i < lines.length && lines[i].trim()
           && !FENCE.test(lines[i]) && !/^(#{2,3} |\| |- )/.test(lines[i])) {
      para.push(lines[i++]);
    }
    const p = document.createElement('p');
    p.innerHTML = inline(para.join(' '));
    root.appendChild(p);
  }
}

// --- reference (generated from docs.js so it can't drift) ------------------

function referenceSection(root) {
  const h2 = document.createElement('h2');
  h2.id = 'reference';
  h2.textContent = 'reference';
  root.appendChild(h2);

  const p = document.createElement('p');
  p.innerHTML = inline(
    'The full API, straight from the table that powers autocomplete. ' +
    'The same text pops up in the app on `ctrl + hover`.'
  );
  root.appendChild(p);

  const search = document.createElement('input');
  search.id = 'ref-search';
  search.type = 'search';
  search.placeholder = 'filter… (name, signature, or description)';
  root.appendChild(search);

  const groups = [
    ['globals', GLOBALS, GLOBAL_CONFIG],
    ['chain methods', METHODS, METHOD_CONFIG],
  ];
  const rows = [];
  for (const [title, table, config] of groups) {
    const h3 = document.createElement('h3');
    h3.id = slug(`ref ${title}`);
    h3.textContent = title;
    root.appendChild(h3);
    const t = document.createElement('table');
    t.className = 'ref';
    for (const [name, [sig, info]] of Object.entries(table)) {
      const tr = t.insertRow();
      // the keys the signature is too short to list, so the page and the
      // completion popup describe the same call
      const sections = configSections(config[name]);
      const keys = sections?.map(([s, list]) => `${s}: ${list.join(' ')}`).join('\n') ?? '';
      tr.dataset.text = `${name} ${sig} ${bodyFor(info)} ${keys}`.toLowerCase();
      const td1 = tr.insertCell();
      td1.innerHTML = `<code class="ref-sig">${esc(sig)}</code>`;
      const td2 = tr.insertCell();
      td2.append(...infoNodes(info));
      if (sections) {
        const dl = document.createElement('div');
        dl.className = 'ref-keys';
        for (const [section, list] of sections) {
          dl.innerHTML += `<span>${esc(section)}</span><code>${esc(list.join(' '))}</code>`;
        }
        td2.appendChild(dl);
      }
      rows.push(tr);
    }
    root.appendChild(t);
  }
  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    for (const r of rows) r.hidden = q !== '' && !r.dataset.text.includes(q);
  });
}

// --- assemble --------------------------------------------------------------

const content = document.getElementById('content');
renderMarkdown(CONTENT, content);
referenceSection(content);

// table of contents from the rendered h2s, with scrollspy
const tocLinks = document.getElementById('toc-links');
const h2s = [...content.querySelectorAll('h2')];
const linkFor = new Map();
for (const h of h2s) {
  const a = document.createElement('a');
  a.href = `#${h.id}`;
  a.textContent = h.textContent;
  tocLinks.appendChild(a);
  linkFor.set(h.id, a);
}
const spy = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      for (const a of linkFor.values()) a.classList.remove('here');
      linkFor.get(e.target.id)?.classList.add('here');
    }
  },
  { rootMargin: '0px 0px -70% 0px' }
);
h2s.forEach((h) => spy.observe(h));
