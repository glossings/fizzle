import { Engine } from './engine.js';
import { makeApi } from './api.js';
import { makeEditor } from './editor.js';
import { initSidebar } from './sidebar.js';
import { codeToHash, codeFromHash } from './share.js';
import { mediaPut, pickFiles, classifyFile, snippetFor } from './media.js';
import DEFAULT_SKETCH from '../sketches/examples/glow-blobs.js?raw';

const engine = new Engine(document.getElementById('gl'));
const api = makeApi(engine);
const status = document.getElementById('status');

// every run mirrors the code into the URL hash, so the address bar is always a
// shareable link and a refresh recovers the last-run code (even unsaved)
function syncHash(code) {
  codeToHash(code).then((h) => history.replaceState(null, '', '#' + h));
}

function flash(msg) {
  status.textContent = msg;
  status.className = 'show ok';
  setTimeout(() => { if (status.classList.contains('ok')) status.className = ''; }, 1200);
}

function run(code) {
  syncHash(code);
  const err = engine.run(code, api);
  if (err) {
    status.textContent = String(err.stack?.split('\n').slice(0, 2).join('\n') ?? err);
    status.className = 'show';
  } else {
    status.textContent = '✓';
    status.className = 'show ok';
    setTimeout(() => { if (status.classList.contains('ok')) status.className = ''; }, 800);
  }
  handleMediaPick();
}

// an empty videofile()/imagefile()/imageseq()/audiofile() in the run asked
// for a picker: open it (still inside the ctrl+enter's user activation),
// import the choice, fill the empty call in the editor, and re-run
async function handleMediaPick() {
  const req = engine.pendingPick;
  engine.pendingPick = null;
  if (!req) return;
  const files = await pickFiles(req.kind, req.multiple);
  if (!files.length) return;
  for (const f of files) await mediaPut(f);
  const q = (f) => JSON.stringify(f.name);
  const arg = req.multiple ? `[${files.map(q).join(', ')}]` : q(files[0]);
  const doc = view.state.doc.toString();
  const m = doc.match(new RegExp(`${req.fn}\\(\\s*\\)`));
  if (m) {
    view.dispatch({ changes: { from: m.index, to: m.index + m[0].length, insert: `${req.fn}(${arg})` } });
    run(view.state.doc.toString());
  }
  flash(`imported ${files.map((f) => f.name).join(', ')}`);
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
  run(code);
}

// dragging the color wheel fires rapidly; rebuild the patch at most ~8x/sec
// (and doesn't resume — tweaking a color while paused keeps the freeze-frame)
let liveTimer;
function liveRun(code) {
  clearTimeout(liveTimer);
  liveTimer = setTimeout(() => run(code), 120);
}

let view;
const setCode = (code) => {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: code } });
};

// Drag & drop media import: dropped video/image/audio/model files are stored
// in the browser (IndexedDB) and a ready-made call — videofile('clip.mp4'),
// model('ship.obj').out(), imageseq([...], beat(1).counter()) for several
// images — lands at the cursor. Capture phase, so CodeMirror doesn't paste
// the file as text.
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
    const files = [...e.dataTransfer.files].filter(classifyFile);
    if (!files.length) return flash('no video / image / audio / .obj / .fbx files in that drop');
    for (const f of files) await mediaPut(f);
    if (!view) return; // dropped before the editor finished booting
    const snippet = snippetFor(files);
    const at = view.state.selection.main.head;
    const line = view.state.doc.lineAt(at);
    // drop on its own line: after the current line if it has content
    const insert = line.length === 0 ? snippet : `\n${snippet}`;
    const from = line.length === 0 ? at : line.to;
    view.dispatch({
      changes: { from, insert },
      selection: { anchor: from + insert.length },
    });
    flash(`imported ${files.map((f) => f.name).join(', ')} — ctrl+enter to run`);
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
  });
  run(initial);
})();
