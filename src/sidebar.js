// Sidebar: global settings + sketch palette. User sketches are .js files in
// sketches/user/ (via the dev-server API in vite.config.js) so the folder can
// be git-versioned; when no server API is available (e.g. a static build)
// they fall back to localStorage. Examples are bundled read-only.

import { syncHash } from './share.js';
import { nameOk, NAME_RULE } from './sketch-name.js';
import { isTouch, forPlatform, exampleApplies } from './touch.js';
import { initAudioModal } from './audio-modal.js';
import { recordable } from './record.js';
import { initOrganize } from './organize.js';
import {
  autoTags, autoTagsFor, forgetSketch, isoDay, keyOf, loadLibrary, manualTags, matches,
  noteCreated, sortSketches, splitKey, SORTS,
} from './library.js';

const exampleFiles = import.meta.glob('../sketches/examples/*.js', { query: '?raw', import: 'default', eager: true });
const EXAMPLES = Object.fromEntries(
  Object.entries(exampleFiles)
    .map(([p, code]) => [p.split('/').pop().replace(/\.js$/, ''), forPlatform(code)])
    .filter(([name]) => exampleApplies(name))
);

const LS_SKETCHES = 'td-user-sketches';
const LS_LAST = 'td-last-sketch';
const LS_SETTINGS = 'td-settings';
const LS_ACTIVE = 'td-active-playlist';
const NEW_TEMPLATE = `bg('#07070c')\nambient({ intensity: 0.2 })\ndirectional({ intensity: 1.4 }).position(4, 6, 3).out()\n\nsphere({ radius: 1, res: 96 })\n  .noise({ amp: 0.3, period: 0.5, octaves: 4, speed: 0.4 })\n  .material({ color: '#8899ff', roughness: 0.35 })\n  .out()\n`;

// --- storage (disk API with localStorage fallback) -------------------------

// The sketch API is the dev server's (see vite.config.js), so a built site has
// nothing to ask — hence starting from the build flag rather than finding out
// through a 404 in the console on every load. It can still drop to false later
// if the dev server goes away mid-session.
let onDisk = import.meta.env?.DEV ?? false;
const lsAll = () => { try { return JSON.parse(localStorage.getItem(LS_SKETCHES)) ?? {}; } catch { return {}; } };
const lsWrite = (all) => localStorage.setItem(LS_SKETCHES, JSON.stringify(all));

// [{ name, mtime }] — mtime is what the auto-tag cache is keyed on. The
// localStorage side has no timestamps, so it hands back 0 and the tags are
// derived from the source in hand instead of cached.
async function listUser() {
  if (onDisk) {
    try {
      const r = await fetch('/api/sketches');
      if (r.ok) return (await r.json()).user.map((f) => (typeof f === 'string' ? { name: f, mtime: 0 } : f));
    } catch { /* no server after all — storage has it */ }
    onDisk = false;
  }
  return Object.keys(lsAll()).sort().map((name) => ({ name, mtime: 0 }));
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
    // A phone opens with the sidebar shut: 264px of it is a third of the
    // screen, and none of what's in there is the reason you opened fizzle.
    // It also opens at 0.75×, which on a 3× display is still more pixels than
    // a laptop renders and is the difference between the heavier examples
    // playing and stuttering. Both are only defaults; the sidebar owns them.
    // recFormat: mp4 on a phone, where the recording's destination is the
    // share sheet and nothing else there will reach the camera roll. On a
    // laptop a container that survives an interrupted take is worth more.
    { quality: isTouch ? 0.75 : 1, fontSize: 15, liveColor: true, open: !isTouch, bpm: 120,
      resFixed: false, resWidth: 1920, resHeight: 1080, sort: 'name',
      // recScale: only takes with the code in them are composited, and only
      // those pay for it. Full size costs a phone two thirds of its frame rate
      // doing that; half costs it nothing measurable. A laptop doesn't notice
      // either way, so it keeps every pixel.
      recFormat: isTouch ? 'mp4' : 'mkv', recScale: isTouch ? 0.5 : 1, recAudio: true },
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
      <label><input id="sb-res-on" type="checkbox"> fixed resolution</label>
      <label class="sb-res">size
        <span><input id="sb-res-w" type="number" min="1" max="7680" step="1"> ×
        <input id="sb-res-h" type="number" min="1" max="7680" step="1"></span>
      </label>
      <label>font size <input id="sb-font" type="number" min="9" max="40" step="1"></label>
      <label>audio in <select id="sb-audio"></select></label>
      <label>audio out <select id="sb-audio-out"></select></label>
      <button id="sb-audio-manage" title="devices, bands & levels (ctrl+a)">audio manager…</button>
      <label>tempo <input id="sb-tempo" type="number" min="20" max="300" step="1"> bpm</label>
      <label class="sb-rec">recording <select id="sb-recfmt"></select></label>
      <label class="sb-rec">rec. audio
        <select id="sb-recaudio">
          <option value="1">on</option>
          <option value="0">off</option>
        </select>
      </label>
      <label class="sb-rec">rec. scale
        <select id="sb-recscale">
          <option value="1">full</option>
          <option value="0.75">¾</option>
          <option value="0.5">half</option>
          <option value="0.25">quarter</option>
        </select>
      </label>
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
      <div class="sb-tabs">
        <button id="sb-tab-sketches" class="on">sketches</button>
        <button id="sb-tab-playlists">playlists</button>
      </div>
      <div class="sb-find">
        <input id="sb-search" type="search" placeholder="search…" autocomplete="off">
        <button id="sb-organize" title="playlists & tags">organize</button>
      </div>
      <div id="sb-pane-sketches">
        <h2 id="sb-h-user">your sketches</h2>
        <ul id="sb-user"><li class="sb-empty">none yet — save one!</li></ul>
        <h2 id="sb-h-examples">examples</h2>
        <ul id="sb-examples"></ul>
      </div>
      <div id="sb-pane-playlists" hidden>
        <ul id="sb-playlists"></ul>
      </div>
    </section>
    <footer id="sb-footer">© 2026 <a href="https://glossing.dev" target="_blank" rel="noopener">Glossing</a></footer>`;
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
    render(); // the list marks what's playing
  };

  // --- settings wiring ---
  // 16 rather than 9 on a touch screen: below that Safari zooms the whole page
  // in when the editor takes focus and won't reliably put it back. Clamped
  // here rather than at the setter so a size saved before this rule, or one
  // typed into the box, is brought up to it too.
  const MIN_FONT = isTouch ? 16 : 9;
  const dim = (n, fallback) => Math.min(7680, Math.max(1, Math.round(Number(n) || fallback)));

  // Only what this browser can actually record — offering mp4 where the
  // recorder can't write one is a setting that silently does nothing. On a
  // desktop this is the *default* the save dialog opens on, since the dialog
  // has a format menu of its own; where there's no dialog it's the whole
  // answer. The note is why you'd pick the other one.
  const REC_NOTE = { mkv: 'survives a crash', webm: 'survives a crash', mp4: 'opens anywhere' };
  const formats = recordable();
  // there's no way to start a recording on a touch screen, so there's nothing
  // for these to configure — see initTouchBar
  if (isTouch) for (const row of el.querySelectorAll('.sb-rec')) row.remove();
  else {
    $('#sb-recfmt').innerHTML = formats.length
      ? formats.map((f) => `<option value="${f}">.${f} — ${REC_NOTE[f]}</option>`).join('')
      : '<option value="">not supported here</option>';
  }

  const applySettings = () => {
    settings.fontSize = Math.min(40, Math.max(MIN_FONT, settings.fontSize || 15));
    settings.resWidth = dim(settings.resWidth, 1920);
    settings.resHeight = dim(settings.resHeight, 1080);
    engine.setQuality(settings.quality);
    // the default a sketch's tempo() overrides, not the last word
    engine.defaultBpm = settings.bpm;
    // a fixed size here beats the sketch's own resolution(), so one setting
    // retargets every sketch
    engine.setResolutionOverride(settings.resFixed ? [settings.resWidth, settings.resHeight] : null);
    document.documentElement.style.setProperty('--editor-font', `${settings.fontSize}px`);
    $('#sb-quality').value = String(settings.quality);
    $('#sb-font').value = settings.fontSize;
    $('#sb-live').checked = settings.liveColor;
    $('#sb-tempo').value = settings.bpm;
    $('#sb-res-on').checked = settings.resFixed;
    $('#sb-res-w').value = settings.resWidth;
    $('#sb-res-h').value = settings.resHeight;
    el.querySelector('.sb-res').classList.toggle('sb-off', !settings.resFixed);
    // a format saved on another machine may not be recordable on this one
    if (formats.length && !formats.includes(settings.recFormat)) [settings.recFormat] = formats;
    const fmt = $('#sb-recfmt'); // gone on a touch screen
    if (fmt) {
      fmt.value = settings.recFormat ?? '';
      $('#sb-recscale').value = String(settings.recScale ?? 1);
      $('#sb-recaudio').value = settings.recAudio ? '1' : '0';
    }
  };
  const setFontSize = (px) => {
    settings.fontSize = Math.round(px);
    applySettings(); // clamps
    persist();
  };
  $('#sb-quality').addEventListener('change', (e) => { settings.quality = Number(e.target.value); applySettings(); persist(); });
  $('#sb-font').addEventListener('change', (e) => setFontSize(Number(e.target.value) || 15));
  $('#sb-res-on').addEventListener('change', (e) => { settings.resFixed = e.target.checked; applySettings(); persist(); });
  for (const [id, key, fallback] of [['#sb-res-w', 'resWidth', 1920], ['#sb-res-h', 'resHeight', 1080]]) {
    $(id).addEventListener('change', (e) => {
      settings[key] = dim(e.target.value, fallback);
      // typing a size is also how you ask for it
      settings.resFixed = true;
      applySettings();
      persist();
    });
  }
  $('#sb-recfmt')?.addEventListener('change', (e) => { settings.recFormat = e.target.value; persist(); });
  $('#sb-recscale')?.addEventListener('change', (e) => { settings.recScale = Number(e.target.value) || 1; persist(); });
  $('#sb-recaudio')?.addEventListener('change', (e) => { settings.recAudio = e.target.value === '1'; persist(); });
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
    window.dispatchEvent(new Event('td-audio-config')); // audio manager follows
  });
  $('#sb-audio-out').addEventListener('change', (e) => {
    settings.audioOut = e.target.value;
    persist();
    applyAudio();
    window.dispatchEvent(new Event('td-audio-config'));
  });
  // the audio manager writes the same two settings; keep these selects true
  window.addEventListener('td-audio-config', fillAudioDevices);
  const audioModal = initAudioModal({ engine, settings, persist, applyAudio });
  $('#sb-audio-manage').addEventListener('click', audioModal.open);
  window.addEventListener('td-audio-started', fillAudioDevices);
  navigator.mediaDevices?.addEventListener?.('devicechange', fillAudioDevices);
  fillAudioDevices();
  applyAudio();

  let lastFrames = 0;
  setInterval(() => {
    $('#sb-fps').textContent = engine.frames - lastFrames;
    lastFrames = engine.frames;
  }, 1000);

  // --- sketch list, search & playlists ---

  const lib = await loadLibrary();
  const exampleNames = Object.keys(EXAMPLES).sort();
  let userList = [];   // [{ name, mtime }]
  let auto = {};       // key -> tags read out of the sketch itself
  let query = '';
  let tab = 'sketches';
  let openList = null; // the playlist unfolded in the playlists pane
  // what ctrl+[ / ctrl+] walks, and where in it we are. Survives a reload, so
  // reopening the tab mid-set puts you back in the same running order.
  let active = (() => {
    try { return JSON.parse(localStorage.getItem(LS_ACTIVE) ?? 'null'); } catch { return null; }
  })();
  const setActive = (v) => {
    active = v;
    if (v) localStorage.setItem(LS_ACTIVE, JSON.stringify(v));
    else localStorage.removeItem(LS_ACTIVE);
  };

  // Everything on offer, in the order the panes show it: your sketches in the
  // chosen order, then the examples by name. Sorting an example by date would
  // be sorting it by when the app was built.
  const allSketches = () => [
    ...sortSketches(userList.map((f) => sketchAt('user', f)), settings.sort),
    ...exampleNames.map((name) => sketchAt('examples', { name })),
  ];
  const sketchAt = (scope, { name, mtime = 0, birthtime = 0 }) => {
    const key = keyOf(scope, name);
    return {
      key, scope, name,
      tags: auto[key] ?? [],
      // the recorded date wins: it's the one that survived a clone
      created: lib.created[key] ?? birthtime,
      modified: mtime,
    };
  };
  const tagsOf = (s) => [...s.tags, ...manualTags(lib, s.key)];
  const datesOf = (s) => `${isoDay(s.created)} ${isoDay(s.modified)}`;
  const hits = () => allSketches().filter((s) => matches(query, s.name, tagsOf(s), datesOf(s)));
  const currentKey = () => (current.scope ? keyOf(current.scope, current.name) : null);

  // Tags are read from the source, so they need the source. Examples are
  // bundled and free; user sketches are files, and only the ones whose mtime
  // has moved are re-read (see autoTagsFor).
  async function refreshTags() {
    for (const name of exampleNames) auto[keyOf('examples', name)] = autoTags(EXAMPLES[name]);
    if (!onDisk) {
      const all = lsAll();
      for (const { name } of userList) auto[keyOf('user', name)] = autoTags(all[name] ?? '');
      return;
    }
    Object.assign(auto, await autoTagsFor(
      userList.map(({ name, mtime }) => ({
        key: keyOf('user', name),
        stamp: mtime,
        read: () => loadUser(name),
      }))
    ));
  }

  // Load a sketch by key and start it. Null if it's gone — a playlist can
  // outlive the sketches in it.
  async function play(key) {
    const { scope, name } = splitKey(key);
    const code = scope === 'examples' ? EXAMPLES[name] : await loadUser(name);
    if (code == null) return null;
    setCode(code);
    setCurrent(scope, name);
    run(code);
    return name;
  }

  function row(text, { on = false, muted = false } = {}) {
    const li = document.createElement('li');
    if (on) li.classList.add('sb-on');
    const span = document.createElement('span');
    span.textContent = text;
    if (muted) span.className = 'sb-missing';
    li.appendChild(span);
    return li;
  }

  // Only while a search is running: the chips are there to show why a sketch
  // came up, and the rest of the time they'd just be noise down the sidebar.
  function chips(tags) {
    const box = document.createElement('span');
    box.className = 'sb-tags';
    for (const t of tags.slice(0, 4)) {
      const chip = document.createElement('i');
      chip.textContent = t;
      box.appendChild(chip);
    }
    return box;
  }

  // A null emptyMsg leaves the list blank rather than saying so — under a
  // search, one "nothing matches" for the pane beats one per heading.
  function fillList(ul, list, emptyMsg) {
    ul.innerHTML = '';
    if (!list.length) {
      if (emptyMsg) ul.innerHTML = `<li class="sb-empty">${emptyMsg}</li>`;
      return;
    }
    for (const s of list) {
      const li = row(s.name, { on: s.key === currentKey() });
      li.title = tagsOf(s).join(' · ');
      if (query) li.appendChild(chips(tagsOf(s)));
      // clicking outside a playlist is leaving it — the arrows follow what
      // you're actually looking at
      li.addEventListener('click', async () => {
        setActive(null);
        // gone from disk since the list was drawn — show what's really there
        if ((await play(s.key)) == null) refreshList();
      });
      if (s.scope === 'user') {
        const del = document.createElement('button');
        del.textContent = '✕';
        del.title = `delete ${s.name}`;
        del.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (!confirm(`Delete sketch "${s.name}"?`)) return;
          await deleteUser(s.name);
          forgetSketch(lib, s.key);
          if (current.scope === 'user' && current.name === s.name) setCurrent(null, s.name);
          refreshList();
        });
        li.appendChild(del);
      }
      ul.appendChild(li);
    }
  }

  // Under a search the headings follow their lists: a query that only matches
  // examples shouldn't leave "your sketches" standing over an empty gap.
  const renderSketches = () => {
    const shown = hits();
    const mine = shown.filter((s) => s.scope === 'user');
    const theirs = shown.filter((s) => s.scope === 'examples');
    fillList($('#sb-user'), mine, query ? (shown.length ? null : 'nothing matches that') : 'none yet — save one!');
    fillList($('#sb-examples'), theirs, null);
    $('#sb-h-user').hidden = Boolean(query) && !mine.length && theirs.length > 0;
    $('#sb-h-examples').hidden = Boolean(query) && !theirs.length;
  };

  // A playlist answers to its own name or to anything in it, so searching for
  // a sketch finds the sets it plays in.
  const listMatches = (p) => {
    if (!query) return true;
    if (matches(query, p.name, [])) return true;
    const known = new Map(allSketches().map((s) => [s.key, s]));
    return p.items.some((k) => {
      const s = known.get(k);
      return s && matches(query, s.name, tagsOf(s), datesOf(s));
    });
  };

  function renderPlaylists() {
    const ul = $('#sb-playlists');
    ul.innerHTML = '';
    const shown = lib.playlists.filter(listMatches);
    if (!shown.length) {
      ul.innerHTML = `<li class="sb-empty">${
        lib.playlists.length ? 'nothing matches that' : 'no playlists yet — press organize'
      }</li>`;
      return;
    }
    const known = new Map(allSketches().map((s) => [s.key, s]));
    for (const p of shown) {
      const li = row(p.name, { on: p.id === active?.id });
      li.classList.add('sb-list');
      const count = document.createElement('em');
      count.textContent = p.items.length;
      li.appendChild(count);
      li.addEventListener('click', () => {
        // Opening a playlist starts it: the set plays from the top, and ctrl+]
        // carries on from there. Clicking the open one again just folds it up.
        if (openList === p.id) {
          openList = null;
          setActive(null);
          return render();
        }
        openList = p.id;
        setActive({ id: p.id, index: -1 });
        render();
        step(1); // the first sketch it can actually load
      });
      ul.appendChild(li);
      if (openList !== p.id) continue;
      p.items.forEach((key, i) => {
        const s = known.get(key);
        const item = row(s ? s.name : `${splitKey(key).name} (missing)`, {
          on: active?.id === p.id && active.index === i,
          muted: !s,
        });
        item.classList.add('sb-item');
        const n = document.createElement('i');
        n.className = 'sb-n';
        n.textContent = i + 1;
        item.prepend(n);
        item.addEventListener('click', () => {
          setActive({ id: p.id, index: i });
          if (s) play(key);
          else render();
        });
        ul.appendChild(item);
      });
    }
  }

  function render() {
    $('#sb-pane-sketches').hidden = tab !== 'sketches';
    $('#sb-pane-playlists').hidden = tab !== 'playlists';
    $('#sb-tab-sketches').classList.toggle('on', tab === 'sketches');
    $('#sb-tab-playlists').classList.toggle('on', tab === 'playlists');
    if (tab === 'sketches') renderSketches();
    else renderPlaylists();
  }

  async function refreshList() {
    userList = await listUser();
    // The first time a sketch is seen its age is whatever the filesystem says;
    // from then on the library's own record is what's asked, so a clone onto
    // another machine doesn't reset everything to the day you cloned it.
    noteCreated(lib, userList.map((f) => ({
      key: keyOf('user', f.name),
      // localStorage has no timestamps at all, and not every filesystem keeps
      // a birthtime — first seen is a fair answer when nothing better exists
      at: f.birthtime || f.mtime || Date.now(),
    })));
    $('#sb-store').textContent = onDisk ? '· disk: sketches/user/' : '· localStorage';
    render();          // names first: reading every sketch for its tags can wait
    await refreshTags();
    render();
  }

  // The order is chosen in the organize window; this list follows it, so the
  // sidebar stays a list of sketches and nothing else.
  if (!SORTS[settings.sort]) settings.sort = 'name';
  const organize = initOrganize({
    lib,
    sketches: allSketches,
    getSort: () => settings.sort,
    setSort: (v) => { settings.sort = SORTS[v] ? v : 'name'; persist(); render(); },
    onChange: render,
  });
  $('#sb-organize').addEventListener('click', () => organize.open());
  $('#sb-search').addEventListener('input', (e) => { query = e.target.value.trim(); render(); });
  for (const which of ['sketches', 'playlists']) {
    $(`#sb-tab-${which}`).addEventListener('click', () => { tab = which; render(); });
  }

  // --- ctrl+[ / ctrl+] : walk the set ---

  const wrap = (i, n) => ((i % n) + n) % n;

  // Inside a playlist those keys walk its running order; outside one they walk
  // whatever the list is currently showing, so a search is also a shortlist
  // you can step through. Returns what to say about the move, or null.
  async function step(delta) {
    const p = active && lib.playlists.find((x) => x.id === active.id);
    if (p?.items.length) {
      // a playlist can hold sketches that have since been deleted; skip past
      // them rather than stopping the set on one
      // an armed playlist nobody has played yet starts at either end
      let i = active.index >= 0 ? active.index : (delta > 0 ? -1 : 0);
      for (let tries = 0; tries < p.items.length; tries++) {
        i = wrap(i + delta, p.items.length);
        const name = await play(p.items[i]);
        if (name == null) continue;
        setActive({ id: p.id, index: i });
        render();
        return `▶ ${p.name} ${i + 1}/${p.items.length} · ${name}`;
      }
      return `${p.name}: nothing left to play`;
    }
    const list = hits();
    if (!list.length) return null;
    const at = list.findIndex((s) => s.key === currentKey());
    const next = list[wrap(at < 0 ? (delta > 0 ? 0 : -1) : at + delta, list.length)];
    const name = await play(next.key);
    return name ? `▶ ${name}` : null;
  }

  async function saveAs(defaultName) {
    const name = prompt('sketch name:', defaultName)?.trim();
    if (!name) return;
    if (!nameOk(name)) return alert(NAME_RULE);
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
      // On a phone the share sheet is the thing you actually want, and it's
      // also the reliable one: Safari wants the clipboard written inside the
      // gesture, and encoding the link above has already left it.
      if (isTouch && navigator.share) {
        await navigator.share({ url: location.href });
        btn.textContent = 'shared';
      } else {
        await navigator.clipboard.writeText(location.href);
        btn.textContent = 'copied!';
      }
    } catch (e) {
      // dismissing the share sheet isn't a failure worth reporting
      if (e?.name !== 'AbortError') btn.textContent = 'link in URL bar';
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

  // the playlist the last session left open is the one this one steps through
  if (active && !lib.playlists.some((p) => p.id === active.id)) setActive(null);
  else if (active) openList = active.id;
  render();

  // sketchName: what's loaded, which is what a recording names its file after
  return { initialCode, toggle, settings, step, audioModal, sketchName: () => current.name };
}
