import { Engine } from './engine.js';
import { makeApi } from './api.js';
import { makeEditor } from './editor.js';
import { initSidebar } from './sidebar.js';
import DEFAULT_SKETCH from '../sketches/examples/glow-blobs.js?raw';

const engine = new Engine(document.getElementById('gl'));
const api = makeApi(engine);
const status = document.getElementById('status');

function run(code) {
  const err = engine.run(code, api);
  if (err) {
    status.textContent = String(err.stack?.split('\n').slice(0, 2).join('\n') ?? err);
    status.className = 'show';
  } else {
    status.textContent = '✓';
    status.className = 'show ok';
    setTimeout(() => { if (status.classList.contains('ok')) status.className = ''; }, 800);
  }
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

  const initial = handoff ?? sidebar.initialCode ?? DEFAULT_SKETCH;
  view = makeEditor(document.getElementById('editor'), initial, {
    onRun: runResume,
    onTogglePause: togglePause,
    onLiveChange: (code) => { if (sidebar.settings.liveColor) liveRun(code); },
    onToggleSidebar: sidebar.toggle,
  });
  run(initial);
})();
