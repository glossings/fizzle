import { Transaction } from '@codemirror/state';
import { Engine } from './engine.js';
import { makeApi } from './api.js';
import { makeEditor } from './editor.js';
import { initSidebar } from './sidebar.js';
import { syncHash, adoptHash, codeFromHash } from './share.js';
import { mediaPut, pickFiles, classifyFile, snippetFor } from './media.js';
import { initPolyhaven } from './polyhaven.js';
import { initProjector } from './projector.js';
import DEFAULT_SKETCH from '../sketches/examples/welcome.js?raw';

const engine = new Engine(document.getElementById('gl'));
const projector = initProjector(document.getElementById('gl'), () => engine.resolution, {
  move: (x, y, rect) => engine.setPointer(x, y, rect),
  down: (v) => { engine.pointer.down = v; },
});
const api = makeApi(engine);
const status = document.getElementById('status');
// the asset browser an empty hdri() / .material() opens; builds its DOM lazily
const polyhaven = initPolyhaven();

function flash(msg) {
  status.textContent = msg;
  status.className = 'show ok';
  setTimeout(() => { if (status.classList.contains('ok')) status.className = ''; }, 1200);
}

// Something the sketch asked for that couldn't be honoured — a material
// property that doesn't exist, a throwing updater, a broken texture graph. Shown
// like an error but self-clearing, since the show goes on behind it.
let warned = false;
window.addEventListener('fizzle-warning', (e) => {
  warned = true;
  const msg = `⚠ ${e.detail}`;
  status.textContent = msg;
  status.className = 'show';
  setTimeout(() => { if (status.textContent === msg) status.className = ''; }, 5000);
});

// `push` leaves a history entry behind: true for the runs a person asked for,
// false for the ones the app did on their behalf (page load, live color drag).
function run(code, push = false) {
  syncHash(code, push);
  warned = false;
  const err = engine.run(code, api);
  if (err) {
    const msg = String(err.stack?.split('\n').slice(0, 2).join('\n') ?? err);
    status.textContent = err.restored ? `${msg}\n(previous sketch still playing)` : msg;
    status.className = 'show';
  } else if (!warned) {
    // a warning raised while the sketch was evaluating stays on screen — a ✓
    // over the top of it would be the one thing the run got wrong, hidden
    status.textContent = '✓';
    status.className = 'show ok';
    setTimeout(() => { if (status.classList.contains('ok')) status.className = ''; }, 800);
  }
  handleMediaPick();
}

// Fill the arguments of the first naked `fn()` in the editor and re-run — so
// the name is in the code afterwards, and deleting back down to `fn()` asks
// again. The lookbehind keeps `material()` from matching the tail of someone's
// `myMaterial()`, while still allowing the dot of a chained call; commented-out
// calls are skipped, since a sketch that explains itself ("run videofile() to
// pick a clip") would otherwise have the prose eat the fill and never fill the
// real call at all.
function fillCall(fn, args) {
  const doc = view.state.doc.toString();
  for (const m of doc.matchAll(new RegExp(`(?<![\\w$])${fn}\\(\\s*\\)`, 'g'))) {
    const lineStart = doc.lastIndexOf('\n', m.index) + 1;
    if (doc.slice(lineStart, m.index).includes('//')) continue;
    view.dispatch({ changes: { from: m.index, to: m.index + m[0].length, insert: `${fn}(${args})` } });
    run(view.state.doc.toString(), true);
    return;
  }
  // nothing left to fill: edited away while the picker was open
}

// an empty videofile()/imagefile()/imageseq()/audiofile()/model() in the run
// asked for a file picker: open it (still inside the ctrl+enter's user
// activation) and import the choice. Returns the arguments to fill in.
async function filePick(req) {
  const files = await pickFiles(req.kind, req.multiple);
  if (!files.length) return null;
  for (const f of files) await mediaPut(f);
  const q = (f) => JSON.stringify(f.name);
  return {
    args: req.multiple ? `[${files.map(q).join(', ')}]` : q(files[0]),
    label: files.map((f) => f.name).join(', '),
  };
}

// an empty hdri() / .material() asked for the Poly Haven browser instead —
// the pick is downloaded, then written into the arguments of that same call
async function browsePick(req) {
  const pick = await polyhaven.open(req.browse);
  if (!pick) return null;
  const q = JSON.stringify(pick.handle);
  // a material is a set of maps under one name, an HDRI is just the file
  return {
    args: pick.type === 'textures' ? `{ pbr: ${q}, repeat: 2 }` : q,
    label: pick.handle,
  };
}

let picking = false;

async function handleMediaPick() {
  // The browser can stay open as long as it takes to choose. A re-run in the
  // meantime must not stack a second one on top of it — and since every run
  // clears the request first, the one left standing is always the live one.
  if (picking || !engine.pendingPick) return;
  const req = engine.pendingPick;
  engine.pendingPick = null;
  // A file dialog can only open off a user gesture, and not every run is one:
  // restoring the last sketch on page load runs it with no activation at all,
  // and the browser rejects the click with nothing to show for it. A sketch
  // whose whole point is an empty call — the vhs example — lands here on every
  // reload, so name the key that turns the next run into a gesture.
  if (navigator.userActivation && !navigator.userActivation.isActive) {
    const what = req.browse === 'textures' ? 'material' : req.browse ? 'HDRI' : req.kind;
    status.textContent = `${req.fn}() has nothing to show yet — press ctrl+enter to open the ${what} picker`;
    status.className = 'show';
    return;
  }
  picking = true;
  let pick = null;
  try {
    pick = req.browse ? await browsePick(req) : await filePick(req);
  } catch (e) {
    status.textContent = `fizzle: ${e.message ?? e}`;
    status.className = 'show';
  } finally {
    // released before the re-run below, so a sketch with several empty calls
    // works through them one pick at a time
    picking = false;
  }
  if (!pick) return;
  fillCall(req.fn, pick.args);
  flash(`imported ${pick.label}`); // after the re-run, so it isn't overwritten
}

// F1: a second window with only the visuals and the code, for the projector
function toggleProjector() {
  const state = projector.toggle(view.state);
  if (state === 'open') flash('📽 projector open — f there for fullscreen, ctrl+h hides its code, not yours');
  else if (state === 'closed') flash('projector closed');
  else {
    status.textContent = 'the browser blocked the projector window — allow pop-ups for this site';
    status.className = 'show';
  }
}

// ctrl+h: the projector's code while there is one, otherwise the local editor
function toggleProjectorCode() {
  const state = projector.toggleCode();
  if (state) flash(state === 'hidden' ? '📽 code hidden on the projector' : '📽 code shown on the projector');
  return !!state;
}

function togglePause() {
  if (engine.togglePause()) {
    status.textContent = '⏸ paused — ctrl+. to resume';
    status.className = 'show ok';
  } else {
    status.className = '';
  }
}

// explicit runs (ctrl+enter, loading a sketch) resume playback if paused
function runResume(code) {
  engine.paused = false;
  run(code, true);
}

// dragging the color wheel fires rapidly; rebuild the patch at most ~8x/sec
// (and doesn't resume — tweaking a color while paused keeps the freeze-frame)
let liveTimer;
function liveRun(code) {
  clearTimeout(liveTimer);
  liveTimer = setTimeout(() => run(code), 120);
}

let view;
// `undoable` false keeps the swap out of the editor's own undo stack — after a
// back/forward, ctrl+z should undo your last edit, not the navigation.
const setCode = (code, undoable = true) => {
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: code },
    annotations: undoable ? [] : [Transaction.addToHistory.of(false)],
  });
};

// Back/forward walk the sketches that were actually run. The URL is the whole
// state, so there's nothing to restore but the code — but adopting it first is
// what stops the run below from pushing the entry we just left back on.
window.addEventListener('popstate', async () => {
  const code = await codeFromHash();
  if (code == null || !view) return;
  adoptHash(code);
  setCode(code, false);
  runResume(code);
});

// Drop a snippet on its own line at the cursor and leave the cursor after it.
// Shared by media drops and the material browser.
function insertAtCursor(snippet) {
  if (!view || !snippet) return;
  const at = view.state.selection.main.head;
  const line = view.state.doc.lineAt(at);
  const insert = line.length === 0 ? snippet : `\n${snippet}`;
  const from = line.length === 0 ? at : line.to;
  view.dispatch({
    changes: { from, insert },
    selection: { anchor: from + insert.length },
  });
}

// A dropped folder arrives as a directory entry rather than a file, so it has
// to be walked. Files keep a 'folder/name.jpg' key, which is what makes a
// dropped material folder addressable as one thing (.material({ pbr: 'rock' }))
// and keeps a dozen materials' worth of identically-named maps apart.
const MAX_DROP = 200; // a stray Downloads folder shouldn't lock up the tab

const readEntries = (reader) => new Promise((res, rej) => reader.readEntries(res, rej));

async function walkEntry(entry, prefix, out) {
  if (out.length >= MAX_DROP) return;
  if (entry.isFile) {
    const file = await new Promise((res, rej) => entry.file(res, rej));
    // re-wrap rather than carry a parallel name: everything downstream reads
    // File.name, so the qualified name has to be the file's own
    out.push(prefix ? new File([file], prefix + file.name, { type: file.type }) : file);
    return;
  }
  if (!entry.isDirectory) return;
  const reader = entry.createReader();
  // readEntries hands back at most 100 per call — keep asking until it's empty
  for (let batch = await readEntries(reader); batch.length; batch = await readEntries(reader)) {
    for (const child of batch) await walkEntry(child, `${prefix}${entry.name}/`, out);
  }
}

async function filesFromDrop(dataTransfer) {
  // webkitGetAsEntry has to be called before the handler yields — the
  // DataTransfer is emptied the moment the event finishes dispatching
  const entries = [...(dataTransfer.items ?? [])]
    .map((item) => item.webkitGetAsEntry?.())
    .filter(Boolean);
  if (!entries.length) return [...dataTransfer.files];
  const out = [];
  for (const entry of entries) await walkEntry(entry, '', out);
  return out;
}

// Drag & drop media import: dropped video/image/audio/model/HDRI files are
// stored in the browser (IndexedDB) and a ready-made call — videofile('clip.mp4'),
// model('ship.obj').out(), imageseq([...], beat(1).counter()) for several
// images — lands at the cursor. A folder of PBR maps becomes a textured shape.
// Capture phase, so CodeMirror doesn't paste the file as text.
function initDrop() {
  const overlay = document.createElement('div');
  overlay.id = 'drop-overlay';
  overlay.textContent = 'drop to import';
  document.body.appendChild(overlay);
  const hasFiles = (e) => e.dataTransfer?.types?.includes('Files');
  let depth = 0;
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth++;
    overlay.classList.add('show');
  });
  window.addEventListener('dragleave', () => {
    if (--depth <= 0) { depth = 0; overlay.classList.remove('show'); }
  });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); }, true);
  window.addEventListener('drop', async (e) => {
    depth = 0;
    overlay.classList.remove('show');
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    const files = (await filesFromDrop(e.dataTransfer)).filter(classifyFile);
    if (!files.length) return flash('nothing importable in that drop — video / image / audio / .obj / .fbx / .hdr');
    for (const f of files) await mediaPut(f);
    if (!view) return; // dropped before the editor finished booting
    insertAtCursor(snippetFor(files));
    // a material folder is a dozen files; name the folders, not every map
    const names = [...new Set(files.map((f) => (f.name.includes('/') ? f.name.split('/')[0] : f.name)))];
    const listed = names.slice(0, 4).join(', ') + (names.length > 4 ? `, +${names.length - 4} more` : '');
    flash(`imported ${listed} — ctrl+enter to run`);
  }, true);
}
initDrop();

(async () => {
  const sidebar = await initSidebar({
    engine,
    getCode: () => view.state.doc.toString(),
    setCode,
    run: runResume,
  });

  // "open in editor" from the docs page hands a sketch over via localStorage
  let handoff = null;
  try {
    handoff = localStorage.getItem('fizzle-handoff');
    if (handoff != null) localStorage.removeItem('fizzle-handoff');
  } catch { /* storage unavailable — fall through */ }

  // a shared link's hash beats everything; docs handoff beats the last sketch
  const fromUrl = await codeFromHash();
  const initial = fromUrl ?? handoff ?? sidebar.initialCode ?? DEFAULT_SKETCH;
  view = makeEditor(document.getElementById('editor'), initial, {
    onRun: runResume,
    onTogglePause: togglePause,
    onLiveChange: (code) => { if (sidebar.settings.liveColor) liveRun(code); },
    onToggleSidebar: sidebar.toggle,
    onRestartMedia: () => { engine.restartMedia(); flash('⏮ media restarted'); },
    onToggleProjector: toggleProjector,
    onToggleProjectorCode: toggleProjectorCode,
    onChange: (u) => projector.sync(u),
  });
  run(initial);
})();
