// The audio manager (ctrl+a, or the sidebar's audio manager button): pick the
// input/output devices, carve named bands out of the live spectrum, and set
// each meter's anchors — the two marks that decide what a sketch reads as 0
// and as 1. Spectrum: drag a band's edges to retune it, its middle to slide
// it. Meters: drag the anchors; the bar is the raw value, the readout is what
// band(name) returns right now.
//
// It edits one set of bands at a time, and which one depends on the sketch
// that's running: its own, if it has pinned a set with bands({ ... }), and this
// machine's otherwise. Pinned, every edit in here is written back into that call
// (band-chip.js) instead of to localStorage, so the manager is a pair of hands
// on the sketch's own code and your mixer is left alone. The pin button in the
// header is what moves between the two.
//
// Carries its own styles the way the organize window does.

import './audio-modal.css';
import {
  addBand, bandGen, bandNameOk, BAND_NAME_RULE, bandSpec, bandStore, normalize, removeBand,
  saveBands, smoothed, updateBands,
} from './bands.js';
import { CONF, tempoState, updateTempo } from './tempo.js';

const HZ_MIN = 20, HZ_MAX = 20000;
const SPAN = Math.log(HZ_MAX / HZ_MIN);
const hzToU = (hz) => Math.log(hz / HZ_MIN) / SPAN; // 0..1 across the log axis
const uToHz = (u) => HZ_MIN * Math.exp(u * SPAN);
const clampHz = (hz) => Math.min(HZ_MAX, Math.max(HZ_MIN, hz));

const LEVEL_COLOR = '#7ee787';
const bandColor = (i, a = 1) => `hsla(${(205 + i * 47) % 360}, 75%, 62%, ${a})`;

const fmtHz = (hz) => (hz >= 1000 ? `${(hz / 1000).toFixed(hz < 10000 ? 1 : 0)}k` : String(Math.round(hz)));

export function initAudioModal({ engine, settings, persist, applyAudio, chip }) {
  let el = null;
  let raf = 0;
  let rows = []; // [{ band: null for level, anchors, meter, valEl, hzEl }]

  const ae = () => engine.audio; // created by open() / the first audio() call

  // Which bands these controls are on, and where an edit to them goes. The
  // running sketch's set outranks the manager's whenever it has one — that's
  // what pinning means — so this is read fresh everywhere rather than captured.
  const pinned = () => !!engine.root.bandSet;
  const set = () => engine.root.bandSet ?? bandStore;
  const commit = () => (pinned() ? chip?.write(bandSpec(set())) : saveBands());

  // the tracker runs from the engine's frame loop, manager open or not
  tempoState.auto = !!settings.tempoAuto;
  tempoState.apply = (bpm) => {
    if (bpm === settings.bpm) return;
    settings.bpm = bpm;
    engine.defaultBpm = bpm;
    persist();
  };

  function build() {
    el = document.createElement('div');
    el.id = 'au-modal';
    el.innerHTML = `
      <div id="au-panel">
        <header>
          <span class="au-title">audio</span>
          <label>in <select id="au-in"></select></label>
          <label>out <select id="au-out"></select></label>
          <button id="au-pin" class="au-auto"></button>
          <button id="au-close" title="close (esc)">✕</button>
        </header>
        <div id="au-tempo">
          <span class="au-title">tempo</span>
          <input id="au-bpm" type="number" min="20" max="300" step="1"> bpm
          <button id="au-tap" title="tap the beat">tap</button>
          <button id="au-tempo-auto" class="au-auto" title="follow the beat of the input (stays on with the manager closed)">auto</button>
          <span id="au-tempo-note" class="au-hint"></span>
        </div>
        <canvas id="au-spectrum"></canvas>
        <div class="au-addrow">
          <button id="au-add">+ add band</button>
          <span class="au-hint" id="au-hint"></span>
        </div>
        <div id="au-meters"></div>
      </div>`;
    document.body.appendChild(el);

    el.addEventListener('click', (e) => { if (e.target === el) close(); });
    el.querySelector('#au-close').addEventListener('click', close);
    el.querySelector('#au-add').addEventListener('click', () => { addBand(set()); commit(); renderMeters(); });
    el.querySelector('#au-pin').addEventListener('click', togglePin);

    wireDevices();
    wireTempo();
    wireSpectrum(el.querySelector('#au-spectrum'));
    renderMeters();
  }

  // --- pinning --------------------------------------------------------------

  // Pin copies this machine's whole set into the sketch and hands the controls
  // over to it; unpin drops it and gives them back. Neither needs a re-run —
  // band() resolves its set as it reads — so the picture keeps playing through
  // either one.
  function togglePin() {
    if (pinned()) {
      engine.unpinBands();
      chip?.remove();
    } else {
      engine.pinBands(bandSpec(bandStore));
      chip?.write(bandSpec(set()));
    }
    renderMeters();
  }

  function drawPin() {
    const btn = el.querySelector('#au-pin');
    const on = pinned();
    btn.classList.toggle('on', on);
    btn.textContent = on ? 'pinned to sketch' : 'pin to sketch';
    btn.title = on
      ? "these bands are the sketch's own, written into its bands({ … }) — click to hand them back to the manager"
      : 'copy these bands into the sketch, so they travel with it and stop following the manager';
    el.querySelector('#au-hint').textContent = on
      ? "editing this sketch's own bands — every change is written into its bands({ … })"
      : "drag a band's edges on the spectrum · drag a meter's anchors to set what reads as 0 and 1";
  }

  // --- tempo: the bpm beat() and B run at when the sketch doesn't tempo() ---
  let taps = [];
  function wireTempo() {
    const bpmEl = el.querySelector('#au-bpm');
    const autoEl = el.querySelector('#au-tempo-auto');
    const setBpm = (v) => {
      settings.bpm = Math.min(300, Math.max(20, Math.round(v) || 120));
      engine.defaultBpm = settings.bpm;
      persist();
    };
    const setAuto = (on) => {
      settings.tempoAuto = tempoState.auto = on;
      autoEl.classList.toggle('on', on);
      persist();
    };
    bpmEl.value = settings.bpm;
    autoEl.classList.toggle('on', tempoState.auto);
    // typing a tempo is taking it by hand — auto would just move it back
    bpmEl.addEventListener('change', () => { setBpm(Number(bpmEl.value)); setAuto(false); });
    autoEl.addEventListener('click', () => setAuto(!tempoState.auto));
    el.querySelector('#au-tap').addEventListener('click', () => {
      const now = performance.now() / 1000;
      if (taps.length && now - taps[taps.length - 1] > 2.5) taps = [];
      taps.push(now);
      if (taps.length > 12) taps.shift();
      if (taps.length >= 2) setBpm((60 * (taps.length - 1)) / (taps[taps.length - 1] - taps[0]));
      setAuto(false);
    });
  }

  function drawTempo() {
    const bpmEl = el.querySelector('#au-bpm');
    // while auto has a confident read, the box tracks it live — the applied
    // tempo only trails it by the agreement window
    const live = tempoState.auto && tempoState.confidence >= CONF ? tempoState.estimate : 0;
    if (document.activeElement !== bpmEl) bpmEl.value = live || settings.bpm;
    bpmEl.classList.toggle('au-live', !!live);
    const note = el.querySelector('#au-tempo-note');
    note.textContent =
      engine.sketchBpm != null ? `the sketch's tempo(${engine.sketchBpm}) overrides`
      : !tempoState.auto
        ? (taps.length === 1 && performance.now() / 1000 - taps[0] < 2.5 ? 'keep tapping…' : '')
      : !ae()?.running ? 'waiting for audio…'
      : live ? ''
      : tempoState.onsets ? `listening… (${tempoState.onsets} onsets)`
      : 'listening…';
  }

  // --- devices: the same settings the sidebar's selects write ---------------
  async function fillDevices() {
    let devs = [];
    try {
      devs = (await navigator.mediaDevices.enumerateDevices()).filter(
        (d) => d.deviceId && d.deviceId !== 'default'
      );
    } catch { /* no enumeration (http, headless) — keep the basics */ }
    const fill = (sel, kind, defLabel, cur) => {
      sel.innerHTML = '';
      sel.append(
        new Option('off', 'off'),
        new Option(defLabel, 'default'),
        ...devs.filter((d) => d.kind === kind).map((d, i) => new Option(d.label || `${kind === 'audioinput' ? 'input' : 'output'} ${i + 1}`, d.deviceId))
      );
      sel.value = [...sel.options].some((o) => o.value === cur) ? cur : 'default';
    };
    fill(el.querySelector('#au-in'), 'audioinput', 'default mic', settings.audioDevice ?? 'default');
    fill(el.querySelector('#au-out'), 'audiooutput', 'default output', settings.audioOut ?? 'off');
  }

  function wireDevices() {
    el.querySelector('#au-in').addEventListener('change', (e) => {
      settings.audioDevice = e.target.value;
      persist();
      applyAudio();
      window.dispatchEvent(new Event('td-audio-config')); // sidebar selects follow
    });
    el.querySelector('#au-out').addEventListener('change', (e) => {
      settings.audioOut = e.target.value;
      persist();
      applyAudio();
      window.dispatchEvent(new Event('td-audio-config'));
    });
    window.addEventListener('td-audio-config', () => { if (isOpen()) fillDevices(); });
    window.addEventListener('td-audio-started', () => { if (isOpen()) fillDevices(); });
    navigator.mediaDevices?.addEventListener?.('devicechange', () => { if (isOpen()) fillDevices(); });
  }

  // --- spectrum -------------------------------------------------------------
  function wireSpectrum(cv) {
    // hit: which band and which handle ('from' | 'to' | 'move') is under x
    const hit = (x, w) => {
      const px = (hz) => hzToU(hz) * w;
      const bands = set().bands;
      for (let i = bands.length - 1; i >= 0; i--) {
        const b = bands[i];
        if (Math.abs(x - px(b.from)) < 6) return { b, part: 'from' };
        if (Math.abs(x - px(b.to)) < 6) return { b, part: 'to' };
      }
      for (let i = bands.length - 1; i >= 0; i--) {
        const b = bands[i];
        if (x > px(b.from) && x < px(b.to)) return { b, part: 'move' };
      }
      return null;
    };

    let drag = null; // { b, part, grabU } — grabU: pointer offset in log units
    cv.addEventListener('pointerdown', (e) => {
      const r = cv.getBoundingClientRect();
      const x = e.clientX - r.left;
      const h = hit(x, r.width);
      if (!h) return;
      drag = { ...h, grabU: x / r.width - hzToU(h.b.from) };
      cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener('pointermove', (e) => {
      const r = cv.getBoundingClientRect();
      const x = e.clientX - r.left;
      if (!drag) {
        const h = hit(x, r.width);
        cv.style.cursor = h ? (h.part === 'move' ? 'grab' : 'ew-resize') : '';
        return;
      }
      const { b, part } = drag;
      const u = Math.min(1, Math.max(0, x / r.width));
      // edges keep a sliver of band between them; a move keeps the width
      if (part === 'from') b.from = clampHz(Math.min(uToHz(u), b.to / 1.05));
      else if (part === 'to') b.to = clampHz(Math.max(uToHz(u), b.from * 1.05));
      else {
        const width = hzToU(b.to) - hzToU(b.from);
        const from = Math.min(Math.max(u - drag.grabU, 0), 1 - width);
        b.from = uToHz(from);
        b.to = uToHz(from + width);
      }
    });
    const done = () => { if (drag) { drag = null; commit(); } };
    cv.addEventListener('pointerup', done);
    cv.addEventListener('pointercancel', done);
  }

  function drawSpectrum() {
    const cv = el.querySelector('#au-spectrum');
    const r = cv.getBoundingClientRect();
    const dpr = devicePixelRatio || 1;
    if (cv.width !== Math.round(r.width * dpr)) { cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); }
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = r.width, h = r.height;
    g.clearRect(0, 0, w, h);

    // frequency grid
    g.fillStyle = 'rgba(255, 255, 255, 0.06)';
    for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) g.fillRect(hzToU(f) * w, 0, 1, h);
    g.fillStyle = 'rgba(255, 255, 255, 0.3)';
    g.font = '9px system-ui';
    for (const f of [100, 1000, 10000]) g.fillText(fmtHz(f), hzToU(f) * w + 3, h - 4);

    const a = ae();
    if (a?.running && a.spectrum) {
      const { spectrum, binHz } = a;
      g.beginPath();
      g.moveTo(0, h);
      for (let x = 0; x < w; x++) {
        const b0 = Math.floor(uToHz(x / w) / binHz);
        const b1 = Math.max(b0, Math.floor(uToHz((x + 1) / w) / binHz));
        let v = 0;
        for (let b = b0; b <= b1 && b < spectrum.length; b++) v = Math.max(v, spectrum[b]);
        g.lineTo(x, h - v * h);
      }
      g.lineTo(w, h);
      g.closePath();
      g.fillStyle = 'rgba(255, 255, 255, 0.18)';
      g.fill();
      g.strokeStyle = 'rgba(255, 255, 255, 0.45)';
      g.stroke();
    } else {
      g.fillStyle = 'rgba(255, 255, 255, 0.35)';
      g.font = '11px system-ui';
      g.fillText(settings.audioDevice === 'off' ? 'audio is off — pick an input above' : 'waiting for audio…', 10, 16);
    }

    // band regions over the curve, edges emphasized
    set().bands.forEach((b, i) => {
      const x0 = hzToU(b.from) * w, x1 = hzToU(b.to) * w;
      g.fillStyle = bandColor(i, 0.16);
      g.fillRect(x0, 0, x1 - x0, h);
      g.fillStyle = bandColor(i, 0.85);
      g.fillRect(x0 - 1, 0, 2, h);
      g.fillRect(x1 - 1, 0, 2, h);
      g.font = '10px system-ui';
      g.fillText(b.name, Math.max(x0 + 4, 2), 11 + (i % 3) * 11); // stagger overlapping labels
    });
  }

  // --- meters ---------------------------------------------------------------
  function meterRow(band, i) {
    const row = document.createElement('div');
    row.className = 'au-row';
    const color = band ? bandColor(i) : LEVEL_COLOR;
    row.innerHTML = `
      <span class="au-swatch" style="background:${color}"></span>
      ${band
        ? `<input class="au-name" value="${band.name}" title="rename (${BAND_NAME_RULE})" spellcheck="false">`
        : '<span class="au-name au-fixed">level</span>'}
      <span class="au-hz"></span>
      <canvas class="au-meter" height="26"></canvas>
      <span class="au-val">0.00</span>
      <input class="au-sm" type="number" min="0" max="5" step="0.05" title="smoothing (seconds), applied before the anchors">
      <button class="au-auto" title="keep fitting the anchors to the signal (stays on with the manager closed)">auto</button>
      ${band ? '<button class="au-del" title="remove band">✕</button>' : '<span class="au-del"></span>'}`;

    const owner = set(); // the row is rebuilt whenever this changes (renderMeters)

    if (band) {
      const name = row.querySelector('.au-name');
      name.addEventListener('change', () => {
        const v = name.value.trim();
        if (v !== band.name && bandNameOk(owner, v)) { band.name = v; commit(); }
        else name.value = band.name;
      });
      row.querySelector('.au-del').addEventListener('click', () => {
        removeBand(owner, band);
        commit();
        renderMeters();
      });
    }

    const meter = row.querySelector('.au-meter');
    const anchors = band ?? owner.level;

    const sm = row.querySelector('.au-sm');
    sm.value = anchors.sm || 0;
    sm.addEventListener('change', () => {
      anchors.sm = Math.min(5, Math.max(0, Number(sm.value) || 0));
      sm.value = anchors.sm;
      commit();
    });

    const auto = row.querySelector('.au-auto');
    auto.classList.toggle('on', !!anchors.auto);
    auto.addEventListener('click', () => {
      anchors.auto = !anchors.auto;
      auto.classList.toggle('on', anchors.auto);
      commit();
    });

    let drag = null; // 'lo' | 'hi'
    meter.addEventListener('pointerdown', (e) => {
      const r = meter.getBoundingClientRect();
      const u = (e.clientX - r.left) / r.width;
      drag = Math.abs(u - anchors.lo) < Math.abs(u - anchors.hi) ? 'lo' : 'hi';
      // a hand on an anchor overrules auto, which would just move it back
      if (anchors.auto) { anchors.auto = false; auto.classList.remove('on'); }
      meter.setPointerCapture(e.pointerId);
      move(e);
    });
    const move = (e) => {
      if (!drag) return;
      const r = meter.getBoundingClientRect();
      const u = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      if (drag === 'lo') anchors.lo = Math.min(u, anchors.hi - 0.005);
      else anchors.hi = Math.max(u, anchors.lo + 0.005);
    };
    meter.addEventListener('pointermove', move);
    const done = () => { if (drag) { drag = null; commit(); } };
    meter.addEventListener('pointerup', done);
    meter.addEventListener('pointercancel', done);

    return { band, anchors, row, meter, color, valEl: row.querySelector('.au-val'), hzEl: row.querySelector('.au-hz') };
  }

  // Rebuilt when the set the manager is on changes — pin, unpin, or a run whose
  // bands() declared something different. bandGen only moves on a declaration,
  // never on the anchors auto walks, so a drag can't pull the rows out from
  // under itself.
  let shownSet = null;
  let shownGen = -1;

  function renderMeters() {
    const box = el.querySelector('#au-meters');
    box.innerHTML = '';
    shownSet = set();
    shownGen = bandGen;
    rows = [meterRow(null, 0), ...shownSet.bands.map((b, i) => meterRow(b, i))];
    for (const r of rows) box.appendChild(r.row);
    drawPin();
  }

  function drawMeter({ band, anchors, meter, color, valEl, hzEl }) {
    const rect = meter.getBoundingClientRect();
    const dpr = devicePixelRatio || 1;
    if (meter.width !== Math.round(rect.width * dpr)) { meter.width = Math.round(rect.width * dpr); meter.height = Math.round(26 * dpr); }
    const g = meter.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = rect.width, h = 26;
    g.clearRect(0, 0, w, h);

    const a = ae();
    const raw = a?.running ? smoothed(anchors) : 0;
    const norm = normalize(raw, anchors);
    const x = (v) => v * w;

    g.fillStyle = 'rgba(255, 255, 255, 0.07)';
    g.fillRect(0, 6, w, h - 12);
    // the raw bar: dim below lo, full color inside the anchors, hot past hi
    const bar = Math.min(raw, 1);
    g.fillStyle = 'rgba(255, 255, 255, 0.25)';
    g.fillRect(0, 6, x(Math.min(bar, anchors.lo)), h - 12);
    if (bar > anchors.lo) {
      g.fillStyle = color;
      g.fillRect(x(anchors.lo), 6, x(Math.min(bar, anchors.hi)) - x(anchors.lo), h - 12);
    }
    if (bar > anchors.hi) {
      g.fillStyle = '#fff';
      g.fillRect(x(anchors.hi), 6, x(bar) - x(anchors.hi), h - 12);
    }
    // anchors: the marks 0 and 1 sit on
    g.fillStyle = 'rgba(255, 255, 255, 0.9)';
    for (const v of [anchors.lo, anchors.hi]) {
      g.beginPath();
      g.moveTo(x(v) - 4, 0);
      g.lineTo(x(v) + 4, 0);
      g.lineTo(x(v), 6);
      g.closePath();
      g.fill();
      g.fillRect(x(v) - 0.5, 0, 1, h);
    }

    valEl.textContent = norm.toFixed(2);
    if (band) hzEl.textContent = `${fmtHz(band.from)}–${fmtHz(band.to)} Hz`;
  }

  // --- open/close -----------------------------------------------------------
  const isOpen = () => el?.classList.contains('show');

  function loop() {
    if (!isOpen()) return;
    // the engine only analyzes while playing; keep the meters live regardless
    if (engine.paused) {
      ae()?.update();
      updateBands(ae());
      updateTempo(ae());
    }
    // a run in the background may have pinned, unpinned or retuned the set
    // these rows are drawn from
    if (shownSet !== set() || shownGen !== bandGen) renderMeters();
    drawTempo();
    drawSpectrum();
    for (const r of rows) drawMeter(r);
    raf = requestAnimationFrame(loop);
  }

  function open() {
    if (!el) build();
    engine.ensureAudio(); // start capture (no-op while audio is off)
    fillDevices();
    renderMeters(); // bands may have changed since last open
    el.classList.add('show');
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(loop);
  }

  function close() {
    el?.classList.remove('show');
    cancelAnimationFrame(raf);
  }

  const toggle = () => (isOpen() ? close() : open());

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) return close();
    // ctrl+a from anywhere the editor's keymap doesn't reach; skip text
    // fields, where it means select-all / line-start
    if (e.key === 'a' && e.ctrlKey && !e.metaKey && !e.altKey && !e.defaultPrevented
        && !e.target.closest?.('input, textarea, select, .cm-editor')) {
      e.preventDefault();
      toggle();
    }
  });

  return { toggle, open, close };
}
