// Sidebar: global settings + sketch palette. User sketches are .js files in
// sketches/user/ (via the dev-server API in vite.config.js) so the folder can
// be git-versioned; when no server API is available (e.g. a static build)
// they fall back to localStorage. Examples are bundled read-only.

import { syncHash } from './share.js';

const exampleFiles = import.meta.glob('../sketches/examples/*.js', { query: '?raw', import: 'default', eager: true });
const EXAMPLES = Object.fromEntries(
  Object.entries(exampleFiles).map(([p, code]) => [p.split('/').pop().replace(/\.js$/, ''), code])
);

const LS_SKETCHES = 'td-user-sketches';
const LS_LAST = 'td-last-sketch';
const LS_SETTINGS = 'td-settings';
const NEW_TEMPLATE = `bg('#07070c')\nambient({ intensity: 0.2 })\ndirectional({ intensity: 1.4 }).position(4, 6, 3).out()\n\nsphere({ radius: 1, res: 96 })\n  .noise({ amp: 0.3, period: 0.5, octaves: 4, speed: 0.4 })\n  .material({ color: '#8899ff', roughness: 0.35 })\n  .out()\n`;

// --- storage (disk API with localStorage fallback) -------------------------

let onDisk = true;
const lsAll = () => { try { return JSON.parse(localStorage.getItem(LS_SKETCHES)) ?? {}; } catch { return {}; } };
const lsWrite = (all) => localStorage.setItem(LS_SKETCHES, JSON.stringify(all));

async function listUser() {
  try {
    const r = await fetch('/api/sketches');
    if (!r.ok) throw new Error();
    onDisk = true;
    return (await r.json()).user;
  } catch {
    onDisk = false;
    return Object.keys(lsAll()).sort();
  }
}
async function loadUser(name) {
  if (onDisk) {
    const r = await fetch(`/api/sketches/user/${encodeURIComponent(name)}`);
    if (r.ok) return r.text();
  }
  return lsAll()[name];
}
async function saveUser(name, code) {
  if (onDisk) {
    const r = await fetch(`/api/sketches/user/${encodeURIComponent(name)}`, { method: 'PUT', body: code });
    if (r.ok) return;
  }
  const all = lsAll();
  all[name] = code;
  lsWrite(all);
}
async function deleteUser(name) {
  if (onDisk) {
    const r = await fetch(`/api/sketches/user/${encodeURIComponent(name)}`, { method: 'DELETE' });
    if (r.ok) return;
  }
  const all = lsAll();
  delete all[name];
  lsWrite(all);
}

// --- sidebar ---------------------------------------------------------------

export async function initSidebar({ engine, getCode, setCode, run }) {
  const settings = Object.assign(
    { quality: 1, fontSize: 15, liveColor: true, open: true, bpm: 120 },
    JSON.parse(localStorage.getItem(LS_SETTINGS) ?? '{}')
  );
  const persist = () => localStorage.setItem(LS_SETTINGS, JSON.stringify(settings));

  const el = document.createElement('div');
  el.id = 'sidebar';
  el.innerHTML = `
    <h1>fizzle</h1>
    <section>
      <h2>settings</h2>
      <label>quality
        <select id="sb-quality">
          <option value="0.5">low (0.5×)</option>
          <option value="0.75">med (0.75×)</option>
          <option value="1">high (1×)</option>
        </select>
      </label>
      <label>font size <input id="sb-font" type="number" min="10" max="24" step="1"></label>
      <label>audio in <select id="sb-audio"></select></label>
      <label>audio out <select id="sb-audio-out"></select></label>
      <label>tempo <input id="sb-tempo" type="number" min="20" max="300" step="1"> bpm</label>
      <label><input id="sb-live" type="checkbox"> live color updates</label>
      <div class="sb-row-static">fps <span id="sb-fps">–</span> <span id="sb-store"></span></div>
      <a id="sb-docs" href="docs.html" target="_blank">docs &amp; reference ↗</a>
    </section>
    <section>
      <h2>sketch <span id="sb-current"></span></h2>
      <div class="sb-btns">
        <button id="sb-save">save</button>
        <button id="sb-saveas">save as…</button>
        <button id="sb-new">new</button>
        <button id="sb-share">copy link</button>
      </div>
      <h2>your sketches</h2>
      <ul id="sb-user"><li class="sb-empty">none yet — save one!</li></ul>
      <h2>examples</h2>
      <ul id="sb-examples"></ul>
    </section>`;
  document.body.appendChild(el);

  const toggleBtn = document.createElement('button');
  toggleBtn.id = 'sb-toggle';
  toggleBtn.title = 'settings & sketches (ctrl+p)';
  toggleBtn.textContent = '☰';
  document.body.appendChild(toggleBtn);

  const $ = (id) => el.querySelector(id);
  let current = { scope: null, name: 'untitled' };

  const setOpen = (open) => {
    settings.open = open;
    el.classList.toggle('hidden', !open);
    persist();
  };
  const toggle = () => setOpen(el.classList.contains('hidden'));
  toggleBtn.addEventListener('click', toggle);
  setOpen(settings.open);

  const setCurrent = (scope, name) => {
    current = { scope, name };
    $('#sb-current').textContent = scope === 'examples' ? `${name} (example)` : name;
    localStorage.setItem(LS_LAST, JSON.stringify(current));
  };

  // --- settings wiring ---
  const applySettings = () => {
    engine.setQuality(settings.quality);
    engine.bpm = settings.bpm;
    document.documentElement.style.setProperty('--editor-font', `${settings.fontSize}px`);
    $('#sb-quality').value = String(settings.quality);
    $('#sb-font').value = settings.fontSize;
    $('#sb-live').checked = settings.liveColor;
    $('#sb-tempo').value = settings.bpm;
  };
  $('#sb-quality').addEventListener('change', (e) => { settings.quality = Number(e.target.value); applySettings(); persist(); });
  $('#sb-font').addEventListener('change', (e) => { settings.fontSize = Number(e.target.value); applySettings(); persist(); });
  $('#sb-live').addEventListener('change', (e) => { settings.liveColor = e.target.checked; persist(); });
  $('#sb-tempo').addEventListener('change', (e) => { settings.bpm = Math.max(1, Number(e.target.value) || 120); applySettings(); persist(); });
  applySettings();

  // --- audio input device ---
  // 'default' = system default mic, 'off' = audio disabled, else a deviceId.
  // Labels are empty until mic permission is granted; the td-audio-started
  // event (fired on successful capture) refreshes them.
  const applyAudio = () => {
    const v = settings.audioDevice ?? 'default';
    engine.setAudioDevice(v === 'off' ? null : v === 'default' ? undefined : v);
    const o = settings.audioOut ?? 'off';
    engine.setAudioOutput(o === 'off' ? null : o);
  };
  async function fillAudioDevices() {
    let devs = [];
    try {
      devs = (await navigator.mediaDevices.enumerateDevices()).filter(
        (d) => d.deviceId && d.deviceId !== 'default'
      );
    } catch { /* no device enumeration (http, headless) — keep the basics */ }
    const fill = (sel, kind, defLabel, cur) => {
      sel.innerHTML = '';
      sel.append(
        new Option('off', 'off'),
        new Option(defLabel, 'default'),
        ...devs.filter((d) => d.kind === kind).map((d, i) => new Option(d.label || `${kind === 'audioinput' ? 'input' : 'output'} ${i + 1}`, d.deviceId))
      );
      sel.value = [...sel.options].some((o) => o.value === cur) ? cur : 'default';
    };
    fill($('#sb-audio'), 'audioinput', 'default mic', settings.audioDevice ?? 'default');
    fill($('#sb-audio-out'), 'audiooutput', 'default output', settings.audioOut ?? 'off');
  }
  $('#sb-audio').addEventListener('change', (e) => {
    settings.audioDevice = e.target.value;
    persist();
    applyAudio();
  });
  $('#sb-audio-out').addEventListener('change', (e) => {
    settings.audioOut = e.target.value;
    persist();
    applyAudio();
  });
  window.addEventListener('td-audio-started', fillAudioDevices);
  navigator.mediaDevices?.addEventListener?.('devicechange', fillAudioDevices);
  fillAudioDevices();
  applyAudio();

  let lastFrames = 0;
  setInterval(() => {
    $('#sb-fps').textContent = engine.frames - lastFrames;
    lastFrames = engine.frames;
  }, 1000);

  // --- sketch list wiring ---
  async function refreshList() {
    const names = await listUser();
    $('#sb-store').textContent = onDisk ? '· disk: sketches/user/' : '· localStorage';
    const ul = $('#sb-user');
    ul.innerHTML = names.length ? '' : '<li class="sb-empty">none yet — save one!</li>';
    for (const name of names) {
      const li = document.createElement('li');
      const a = document.createElement('span');
      a.textContent = name;
      a.addEventListener('click', async () => {
        const code = await loadUser(name);
        if (code == null) return refreshList();
        setCode(code);
        setCurrent('user', name);
        run(code);
      });
      const del = document.createElement('button');
      del.textContent = '✕';
      del.title = `delete ${name}`;
      del.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm(`Delete sketch "${name}"?`)) return;
        await deleteUser(name);
        if (current.scope === 'user' && current.name === name) setCurrent(null, name);
        refreshList();
      });
      li.append(a, del);
      ul.appendChild(li);
    }
  }

  const exUl = $('#sb-examples');
  for (const name of Object.keys(EXAMPLES).sort()) {
    const li = document.createElement('li');
    const a = document.createElement('span');
    a.textContent = name;
    a.addEventListener('click', () => {
      setCode(EXAMPLES[name]);
      setCurrent('examples', name);
      run(EXAMPLES[name]);
    });
    li.appendChild(a);
    exUl.appendChild(li);
  }

  async function saveAs(defaultName) {
    const name = prompt('sketch name:', defaultName)?.trim();
    if (!name) return;
    if (!/^[\w][\w -]{0,60}$/.test(name)) return alert('letters, numbers, spaces, - and _ only');
    await saveUser(name, getCode());
    setCurrent('user', name);
    refreshList();
  }
  $('#sb-save').addEventListener('click', async () => {
    if (current.scope === 'user') {
      await saveUser(current.name, getCode());
      refreshList();
    } else {
      saveAs(current.name);
    }
  });
  $('#sb-saveas').addEventListener('click', () => saveAs(current.name));
  $('#sb-share').addEventListener('click', async () => {
    // encode what's in the editor right now (may be newer than the last run);
    // sharing isn't a navigation, so it replaces rather than pushes
    await syncHash(getCode());
    const btn = $('#sb-share');
    try {
      await navigator.clipboard.writeText(location.href);
      btn.textContent = 'copied!';
    } catch {
      btn.textContent = 'link in URL bar';
    }
    setTimeout(() => { btn.textContent = 'copy link'; }, 1200);
  });
  $('#sb-new').addEventListener('click', () => {
    setCode(NEW_TEMPLATE);
    setCurrent(null, 'untitled');
    run(NEW_TEMPLATE);
  });

  await refreshList();

  // --- restore last sketch ---
  let initialCode = null;
  try {
    const last = JSON.parse(localStorage.getItem(LS_LAST) ?? 'null');
    if (last?.scope === 'user') {
      initialCode = (await loadUser(last.name)) ?? null;
      if (initialCode != null) setCurrent('user', last.name);
    } else if (last?.scope === 'examples' && EXAMPLES[last.name]) {
      initialCode = EXAMPLES[last.name];
      setCurrent('examples', last.name);
    }
  } catch { /* fall through to default sketch */ }
  if (initialCode == null) setCurrent('examples', 'welcome');

  return { initialCode, toggle, settings };
}
