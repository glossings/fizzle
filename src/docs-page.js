// Interactive docs: prose from docs-content.md, every js code block a live
// CodeMirror editor that runs on a real Engine in the preview panel, plus a
// searchable reference generated from the same table that powers
// autocomplete (docs.js) so it can't drift from the app.

import { EditorView, basicSetup } from 'codemirror';
import { keymap } from '@codemirror/view';
import { Prec } from '@codemirror/state';
import { acceptCompletion } from '@codemirror/autocomplete';
import { indentMore, indentLess } from '@codemirror/commands';
import { javascript, javascriptLanguage } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';
import { configSections, infoNodes, GLOBALS, METHODS, GLOBAL_CONFIG, METHOD_CONFIG } from './docs.js';
import { apiCompletions, apiHover } from './complete.js';
import { Engine } from './engine.js';
import { makeApi } from './api.js';
import { initPolyhaven } from './polyhaven.js';
import { mediaPut, pickFiles } from './media.js';
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

const statusEl = document.getElementById('preview-status');
const pauseBtn = document.getElementById('preview-pause');
const polyhaven = initPolyhaven();
let activeEx = null;

function runExample(code, exEl, ctx) {
  engine.paused = false;
  pauseBtn.textContent = '⏸';
  const err = engine.run(code, api);
  activeEx?.classList.remove('running');
  activeEx = exEl ?? null;
  activeEx?.classList.add('running');
  if (err) {
    statusEl.textContent = String(err.message ?? err);
    statusEl.className = 'err';
  } else {
    statusEl.textContent = '✓ running';
    statusEl.className = 'ok';
  }
  if (!err && engine.pendingPick && ctx) handlePick(ctx);
}

// An empty videofile()/model()/… asks for a file picker, an empty
// hdri()/.material() for the Poly Haven browser — same as in the app, and
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
  try {
    if (req.browse) {
      const chosen = await polyhaven.open(req.browse);
      const q = chosen && JSON.stringify(chosen.handle);
      if (chosen) pick = chosen.type === 'textures' ? `{ pbr: ${q}, repeat: 2 }` : q;
    } else {
      const files = await pickFiles(req.kind, req.multiple);
      for (const f of files) await mediaPut(f);
      const q = (f) => JSON.stringify(f.name);
      if (files.length) pick = req.multiple ? `[${files.map(q).join(', ')}]` : q(files[0]);
    }
  } catch (e) {
    statusEl.textContent = String(e.message ?? e);
    statusEl.className = 'err';
  } finally {
    picking = false;
  }
  if (pick == null) return;
  // fill the arguments into the empty call that asked, then run it again
  const doc = view.state.doc.toString();
  for (const m of doc.matchAll(new RegExp(`(?<![\\w$])${req.fn}\\(\\s*\\)`, 'g'))) {
    const lineStart = doc.lastIndexOf('\n', m.index) + 1;
    if (doc.slice(lineStart, m.index).includes('//')) continue;
    view.dispatch({ changes: { from: m.index, to: m.index + m[0].length, insert: `${req.fn}(${pick})` } });
    rerun();
    return;
  }
}

function togglePause() {
  pauseBtn.textContent = engine.togglePause() ? '▶' : '⏸';
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

function makeExample(code, autorun) {
  const ex = document.createElement('div');
  ex.className = 'ex';

  // the block runs itself: also how a filled-in pick re-runs (see handlePick)
  const rerun = () => runExample(view.state.doc.toString(), ex, { view, rerun });

  const runKeys = Prec.highest(
    keymap.of([
      { key: 'Ctrl-Enter', run: () => { rerun(); return true; } },
      { key: 'Shift-Enter', run: () => { rerun(); return true; } },
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
      javascript(),
      javascriptLanguage.data.of({ autocomplete: apiCompletions }),
      apiHover,
      oneDark,
      EditorView.lineWrapping,
    ],
  });

  const btns = document.createElement('div');
  btns.className = 'ex-btns';
  const runBtn = document.createElement('button');
  runBtn.textContent = '▶';
  runBtn.title = 'run in the preview (ctrl+enter)';
  runBtn.addEventListener('click', rerun);
  const openBtn = document.createElement('button');
  openBtn.textContent = '⧉';
  openBtn.title = 'open in the app editor';
  openBtn.addEventListener('click', () => {
    localStorage.setItem(HANDOFF_KEY, view.state.doc.toString());
    window.open('/', '_blank');
  });
  btns.append(runBtn, openBtn);
  ex.appendChild(btns);

  if (autorun) queueMicrotask(rerun);
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

function renderMarkdown(md, root) {
  const lines = md.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    const fence = line.match(/^```(\S*)\s*(.*)$/);
    if (fence) {
      const codeLines = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) codeLines.push(lines[i++]);
      i++; // closing fence
      const code = codeLines.join('\n');
      // ```js — a live editor; ```js static — a snippet that can't run here
      // (it names files only you have), so it renders as plain code
      if (fence[1] === 'js' && !fence[2].includes('static')) {
        root.appendChild(makeExample(code, fence[2].includes('autorun')));
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
      while (i < lines.length && (/^- /.test(lines[i]) || /^ {2,}\S/.test(lines[i]))) {
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
    while (i < lines.length && lines[i].trim() && !/^(#{2,3} |```|\| |- )/.test(lines[i])) {
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
    for (const [name, [sig, info, extra]] of Object.entries(table)) {
      const tr = t.insertRow();
      // the keys the signature is too short to list, so the page and the
      // completion popup describe the same call
      const sections = configSections(config[name]);
      const keys = sections?.map(([s, list]) => `${s}: ${list.join(' ')}`).join('\n') ?? '';
      tr.dataset.text = `${name} ${sig} ${info} ${keys}`.toLowerCase();
      const td1 = tr.insertCell();
      td1.innerHTML = `<code class="ref-sig">${esc(sig)}</code>`;
      const td2 = tr.insertCell();
      // the grid below lists every key, so the tooltip's "and these others too"
      // summary is just the same names twice here
      td2.append(...infoNodes(info, sections ? null : extra));
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
