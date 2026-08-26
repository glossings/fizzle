import { warn } from './warn.js';
import { isTouch } from './touch.js';
import { audioTap, audioState } from './audio.js';

// Recording a set to a file.
//
// The picture is the drawing buffer, drawn at the size the sketch asked to be
// seen at rather than the letterboxed rectangle it occupies on screen. The code
// goes over it exactly when it's on screen — the projector's copy while one is
// open, your own editor when there isn't — which means compositing by hand:
// captureStream on the WebGL canvas yields the framebuffer and nothing else.
//
// A WebGL drawing buffer can't be read from a later task, so the composite runs
// inside the render loop (engine.onFrame), with this frame still in the buffer.
//
// The sound needs none of that: audio.js keeps one tap node that every source
// feeds, and its track goes into the same stream as the picture.

// The containers worth offering, each with the codec strings to try for it.
// mkv and webm stay playable at whatever byte they stop at; mp4 isn't promised
// to (Chrome's is fragmented and does, the others are untested) — but it's the
// one every player opens and the only one a phone will put in the camera roll.
// Which trade is the right one is the user's, so it's a setting.
//
// Two lists per container, because a codec string that names only a video
// codec is one some browsers refuse outright when the stream has audio in it.
// The bare container ends both lists: it means "you choose", which is the
// right last resort either way.
const CONTAINERS = {
  mkv: {
    sound: ['video/x-matroska;codecs=avc1,opus', 'video/x-matroska;codecs=vp9,opus', 'video/x-matroska'],
    mute: ['video/x-matroska;codecs=avc1', 'video/x-matroska;codecs=vp9', 'video/x-matroska'],
  },
  webm: {
    sound: ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'],
    mute: ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'],
  },
  mp4: {
    sound: ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4'],
    mute: ['video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1', 'video/mp4'],
  },
};

const LABEL = { mkv: 'Matroska video', webm: 'WebM video', mp4: 'MP4 video' };
const PLAIN = { mkv: 'video/x-matroska', webm: 'video/webm', mp4: 'video/mp4' };

const supported = (mime) => {
  try { return MediaRecorder.isTypeSupported?.(mime) ?? false; } catch { return false; }
};

// how to record into that container here, or null if this browser can't
const mimeFor = (ext, sound) =>
  (typeof MediaRecorder === 'undefined'
    ? null
    : CONTAINERS[ext]?.[sound ? 'sound' : 'mute'].find(supported)) ?? null;

// What this browser can actually record, for the sidebar to offer. A container
// it can only record silent is still a container it can record.
export const recordable = () => Object.keys(CONTAINERS).filter((e) => mimeFor(e, false));

// [ext, mime] for everything available, with the one asked for first — the
// rest follow so a browser that can't do the chosen container still records,
// and so the save dialog can list the alternatives. With sound wanted each
// container is taken at its best: the codec string that carries audio where
// there is one, the silent string where there isn't, rather than dropping the
// container from the list over it.
function formats(want, sound) {
  const order = [...new Set([want, ...Object.keys(CONTAINERS)])];
  return order
    .map((ext) => [ext, (sound && mimeFor(ext, true)) || mimeFor(ext, false)])
    .filter(([, mime]) => mime);
}

// What the recorder actually produced, which is not always what it was asked
// for. A file named for the wrong container is one nothing will open — and on
// a phone it's the difference between the camera roll and a dead end.
const extFor = (mime) =>
  (/matroska/.test(mime) ? 'mkv' : /mp4/.test(mime) ? 'mp4' : /webm/.test(mime) ? 'webm' : '');

// With no storage to spool into, the whole take sits in the tab. Stop before
// that kills it — a phone has far less room for this than a laptop does.
const MEMORY_CAP = (isTouch ? 400 : 1500) * 1024 * 1024;

// h.264 wants even dimensions, and a window is often an odd number of pixels
// wide. Rounding down loses a line nobody will find.
const even = (n) => Math.max(2, Math.floor(n / 2) * 2);

// Bits per pixel per frame. The usual "looks like the source" figure for h.264
// is ~0.1, but that's for camera footage — a visual synth is the hard case for
// an encoder: full-frame change every frame, hard edges, noise, saturated
// colour. 0.15 buys back the mush at a size nobody will notice.
//
// The floor matters more than the rate does. A small frame at a fixed bits-
// per-pixel gets a tiny absolute bitrate — half-scale on a phone worked out at
// 332 kbps, which is why those takes came out blurry and stuttering — and a
// small frame is exactly where the extra bits are cheap. Cap so a 4K sketch
// doesn't ask for a gigabit.
const bitrate = (w, h, fps) =>
  Math.min(60e6, Math.max(2.5e6, Math.round(w * h * fps * 0.15)));

// A phone can't encode sixty frames a second of its own output on top of
// drawing them, and the visuals are what suffer. Half the rate is still
// smooth video and halves both the compositing and the encoding.
const MAX_FPS = isTouch ? 30 : 60;

// How often the code layer is re-rasterized at the outside — during a scroll
// this *is* the code's frame rate in the file, and 80ms here read as staccato:
// a 12fps layer over a 60fps picture. ~30ms is two ticks of the render loop,
// about what the rasterize-decode round trip costs anyway, and `busy` throttles
// it further on a machine that can't keep up. On a touch screen the layer is
// the whole screen and typing dirties it per keystroke, so the leash is short.
const SNAP_MS = isTouch ? 250 : 30;

const pad = (n) => String(n).padStart(2, '0');

// Timestamps rather than a counter: a counter would have to enumerate the
// folder to find the next free number, and nothing here can. This sorts
// chronologically, which is what matters with forty takes from one set.
function stamp() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    + `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

const slug = (name) =>
  String(name || 'untitled').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  || 'untitled';

// --- the code layer, rasterized ---------------------------------------------

const cssCache = new Map();

// An SVG image is its own little browsing context: it has no pointer, no
// hover, and a viewport the size of the picture — so a media query inside it
// answers differently than it does out here, and the recorded code would come
// out styled for a device nobody is using. Ask the real window instead, and
// emit the blocks that matched with the query stripped off.
function collect(rules, out, view) {
  for (const rule of rules) {
    // .media alone would also catch @import, which has no rules to walk
    if (rule.media && rule.cssRules) {
      if (view.matchMedia(rule.media.mediaText).matches) collect(rule.cssRules, out, view);
    } else if (rule.conditionText != null && rule.cssRules) { // @supports
      collect(rule.cssRules, out, view);
    } else {
      out.push(rule.cssText); // @keyframes and the rest, verbatim
    }
  }
}

// Every rule a document has, as one stylesheet the SVG can carry inline —
// nothing external loads inside an <img>, so the CSS has to travel with the
// markup.
function cssOf(doc) {
  const hit = cssCache.get(doc);
  if (hit) return hit;
  const rules = [];
  for (const sheet of doc.styleSheets) {
    try { collect(sheet.cssRules, rules, window); }
    catch { /* cross-origin sheet; nothing of ours is in it */ }
  }
  const css = rules.join('\n');
  if (css) cssCache.set(doc, css); // a sheet still loading gets asked again
  return css;
}

// Media matches and loaded sheets both change over a session, and a closed
// projector's document shouldn't be held past its window. Every take starts
// from the stylesheets as they are.
const forgetCss = () => cssCache.clear();

const xml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const attr = (s) => xml(s).replace(/"/g, '&quot;');

// A clone carries no scroll positions, so anything scrolled is shifted by hand:
// the container clips and its children slide. Walks both trees together — the
// clone is structurally identical, so children line up by index. A transform
// rather than a top/left, since the children being moved are a mix of relative
// and absolute (CodeMirror's selection and cursor layers).
function shiftScroll(src, clone, view) {
  const sx = src.scrollLeft, sy = src.scrollTop;
  const from = src.children, to = clone.children;
  for (let i = 0; i < from.length && i < to.length; i++) {
    if (sx || sy) {
      const t = view.getComputedStyle(from[i]).transform;
      to[i].style.transform =
        `${t && t !== 'none' ? `${t} ` : ''}translate(${-sx}px, ${-sy}px)`;
    }
    // a form control's value is a property, not an attribute, so it doesn't
    // survive being serialized — the touch color swatch is one
    if (to[i].tagName === 'INPUT') to[i].setAttribute('value', from[i].value);
    shiftScroll(from[i], to[i], view);
  }
  if (sx || sy) clone.style.overflow = 'hidden';
}

// The layer as an image the recording can stamp over the picture. foreignObject
// reuses the browser's own layout, so what lands in the file is what's on
// screen — wrapping, highlighting, folds and all — rather than a second
// renderer of our own that would drift from CodeMirror's.
// `k` is how many frame pixels each of the layer's CSS pixels is going to
// occupy. Rasterizing at the layer's own size and letting the composite scale
// it up is how the code came out soft on any display denser than the layout —
// which is every retina laptop, at 2×. The viewBox keeps the layout in CSS
// units while the image is made at the size it's actually drawn.
async function snapshot(el, k) {
  const w = el.clientWidth, h = el.clientHeight;
  if (!w || !h) return null;
  const pw = Math.max(1, Math.round(w * k)), ph = Math.max(1, Math.round(h * k));
  const doc = el.ownerDocument;
  const view = doc.defaultView;
  const clone = el.cloneNode(true);
  shiftScroll(el, clone, view);
  // in here it's a plain box: no fixed positioning, no pinch transform
  clone.style.cssText += `;position:relative;inset:auto;margin:0;transform:none;`
    + `width:${w}px;height:${h}px;overflow:hidden`;
  // the projector's own rules live in its document; everything else is ours
  const css = doc === document ? cssOf(doc) : `${cssOf(document)}\n${cssOf(doc)}`;
  const root = doc.documentElement.style.cssText; // --editor-font, --kb
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${pw}" height="${ph}" viewBox="0 0 ${w} ${h}">`
    + `<foreignObject width="${w}" height="${h}">`
    + `<div xmlns="http://www.w3.org/1999/xhtml" style="${attr(root)};`
    + `width:${w}px;height:${h}px;overflow:hidden">`
    + `<style>${xml(css)}</style>${new XMLSerializer().serializeToString(clone)}`
    + `</div></foreignObject></svg>`;
  const img = new Image(pw, ph);
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  // Flattened onto a plain canvas, so the vector isn't re-rasterized on every
  // frame — and deliberately *not* via createImageBitmap, which in Chrome
  // hands back a bitmap that isn't origin-clean when the source was an SVG.
  // Drawing one of those taints the canvas the recording composites into, and
  // a tainted canvas's captureStream stops producing frames without saying so:
  // the take would end at the first frame with code in it. Drawing the image
  // itself keeps the flag, so this stays clean.
  const flat = document.createElement('canvas');
  flat.width = pw;
  flat.height = ph;
  flat.getContext('2d').drawImage(img, 0, 0, pw, ph);
  return flat;
}

// A tainted source poisons the canvas it's drawn into, and a tainted canvas's
// captureStream stops producing frames without throwing — a whole take lost in
// silence. Chrome has handed back a tainted raster here before, so prove the
// first snapshot of a take is clean rather than trust it.
function isClean(src) {
  const probe = document.createElement('canvas');
  probe.width = probe.height = 1;
  const c = probe.getContext('2d');
  try {
    c.drawImage(src, 0, 0, 1, 1);
    c.getImageData(0, 0, 1, 1);
    return true;
  } catch {
    return false;
  }
}

// --- where the bytes go -------------------------------------------------------
//
// Into origin-private storage first, through a worker holding a sync access
// handle, a second at a time; the file the save dialog named only gets the
// take once it has ended. Streaming straight into that file was how it worked
// before, and it lost whole sets: a FileSystemWritableFileStream writes into a
// swap file that Chrome deletes if the tab dies before close(), whatever the
// container. OPFS writes land in place, so a take a crashed tab leaves behind
// is still there on the next load, where it's offered back — and the tab never
// holds more than a second of video on any browser, not only the ones with a
// save dialog.

const OPFS_DIR = 'recordings';

// The last few takes and how they ended, kept across sessions: a take that
// reads `rolling` on the next load is one the tab died in the middle of, and
// what was logged about it is what there is to go on. Inspect with
// localStorage['td-rec-takes'].
const LS_TAKES = 'td-rec-takes';
const readTakes = () => { try { return JSON.parse(localStorage.getItem(LS_TAKES) ?? '[]'); } catch { return []; } };
const writeTakes = (t) => { try { localStorage.setItem(LS_TAKES, JSON.stringify(t.slice(-6))); } catch { /* over quota */ } };
function logTake(take) {
  const all = readTakes().filter((t) => t.name !== take.name);
  all.push(take);
  writeTakes(all);
}

const mb = (n) => `${Math.round(n / 1e6)} MB`;
const dur = (secs) => `${Math.floor(secs / 60)}:${pad(Math.round(secs) % 60)}`;

async function takeDir() {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(OPFS_DIR, { create: true });
}
const takeFile = async (name) => (await (await takeDir()).getFileHandle(name)).getFile();
const dropTake = async (name) => { try { await (await takeDir()).removeEntry(name); } catch { /* already gone */ } };

// Bytes read from the recorder and not yet acknowledged by the disk. Past this
// the disk isn't keeping up at all, and the backlog is the old memory problem
// by another route.
const BACKLOG_CAP = 256 * 1024 * 1024;

// the worker, started on the first take and kept
let worker = null, rpcId = 0;
const rpc = new Map();
function spooler() {
  if (worker) return worker;
  worker = new Worker(new URL('./rec-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data: { id, ok, value, error } }) => {
    const p = rpc.get(id);
    if (!p) return;
    rpc.delete(id);
    ok ? p.resolve(value) : p.reject(new Error(error));
  };
  worker.onerror = (e) => {
    for (const p of rpc.values()) p.reject(new Error(e.message || 'the recording worker failed'));
    rpc.clear();
  };
  return worker;
}
// A worker that never comes up never answers either, so the open has a clock
// on it; a write is answered as soon as the disk takes it.
function call(op, payload = {}, transfer = [], timeout = 0) {
  return new Promise((resolve, reject) => {
    const id = ++rpcId;
    let t = 0;
    if (timeout) t = setTimeout(() => { rpc.delete(id); reject(new Error('the recording worker did not start')); }, timeout);
    rpc.set(id, { resolve: (v) => { clearTimeout(t); resolve(v); }, reject: (e) => { clearTimeout(t); reject(e); } });
    try { spooler().postMessage({ id, op, ...payload }, transfer); }
    catch (e) { clearTimeout(t); rpc.delete(id); reject(e); }
  });
}

// --- the recorder ------------------------------------------------------------

// getSize: [w, h] the file should be — resolution(), the sidebar's fixed size,
//   or the window's own pixels. Quality scales the buffer underneath, not this.
// codeLayer: { el, clip } | null — the element to draw over the picture and
//   which part of it the picture occupies, in the element's own coordinates.
// getFormat: the container the sidebar is set to — the default the save
//   dialog opens on, and the whole answer where there's no dialog.
// getAudio: whether the file gets a sound track. What's on it is everything
//   audio.js is carrying: the input, and audiofile() playback at its volume.
export function initRecorder({ canvas, getSize, getName, getFormat, getScale, getAudio, codeLayer, flash, onChange }) {
  let rec = null;          // the live MediaRecorder, or null
  let out = null, ctx = null, stream = null, track = null;
  let outW = 0, outH = 0;  // the frame size, with or without a compositing canvas
  let handle = null;       // the file the take goes into at the end, when a dialog named one
  let spool = '';          // the take's name in origin-private storage while it's going there
  let queue = Promise.resolve(); // reads and writes, kept in order
  let backlog = 0;         // bytes read from the recorder the disk hasn't taken yet
  let chunks = null;       // ...or held in memory, where there's no storage to spool into
  let held = 0;            // bytes on disk (or in the tab)
  let recMime = '';        // what this take was asked to record in
  let writeError = null;   // the first write that didn't land, if any
  let saveName = '';
  let startedAt = 0, timer = 0;
  let take = null;         // this take's log entry
  let frames = 0, snaps = 0;
  let lastHeld = 0, lastHeldAt = 0, framesAtHeld = 0, stalled = false;
  let recent = [];         // the last few warnings, for the log
  window.addEventListener('fizzle-warning', (e) => { recent = [...recent.slice(-4), e.detail]; });

  // the code layer, cached: it only changes when someone types or scrolls
  let shot = null, shotEl = null, dirty = true, busy = false, noOverlay = false;
  let checked = false;     // this take's first snapshot has been proved clean
  let shotScale = 0;       // frame px per CSS px the snapshot was made at
  let lastFrame = 0, lastSnap = 0;
  let observer = null, watched = null;

  const dot = document.createElement('div');
  dot.id = 'rec-dot';
  document.body.appendChild(dot);

  // A take waiting to be handed somewhere, and the button that does it: one
  // that finished on a phone, where the share sheet wants a tap of its own, or
  // one a dead tab left behind, which needs the destination it never got.
  // Sits where the recording indicator was, so the take ending swaps one for
  // the other in the same corner.
  let pending = null;      // { file, opfs, take } — opfs: its name in storage, to drop once it's out
  const saveBtn = document.createElement('button');
  saveBtn.id = 'rec-save';
  saveBtn.hidden = true;
  saveBtn.addEventListener('click', () => {
    const p = pending;
    if (!p) return;
    pending = null;
    saveBtn.hidden = true;
    // Every branch here is called straight out of the tap with nothing awaited
    // in front of it — an await is exactly what loses the gesture and closes
    // both the share sheet and the save dialog.
    if (!isTouch && window.showSaveFilePicker) {
      const ext = extFor(p.file.type) || /\.([a-z0-9]+)$/i.exec(p.file.name)?.[1];
      const types = ext && LABEL[ext] ? [{ description: LABEL[ext], accept: { [PLAIN[ext]]: [`.${ext}`] } }] : undefined;
      window.showSaveFilePicker({ suggestedName: p.file.name, types }).then(
        (h) => deliver(h, p).then((ok) => { if (!ok) { download(p.file); finish(p, 'downloaded'); } }),
        (e) => { if (e?.name === 'AbortError') park(p); else { download(p.file); finish(p, 'downloaded'); } },
      );
      return;
    }
    if (isTouch && navigator.canShare?.({ files: [p.file] })) {
      navigator.share({ files: [p.file], title: p.file.name }).then(() => finish(p, 'shared'), (e) => {
        // dismissing the sheet isn't a decision to throw the take away
        if (e?.name === 'AbortError') return park(p);
        warn(`recording: the share sheet refused the file (${e.message ?? e})`);
        download(p.file);
        finish(p, 'downloaded');
        flash?.(`⏹ downloaded ${p.file.name} instead`);
      });
      return;
    }
    download(p.file);
    finish(p, 'downloaded');
  });
  document.body.appendChild(saveBtn);

  function park(p) {
    pending = p;
    saveBtn.textContent = p.take?.recovered ? `⤴ save last take (${mb(p.file.size)})` : '⤴ save video';
    saveBtn.hidden = false;
  }

  // The take is out of our hands. A file that went to a chosen path is copied
  // and can go from storage now; one that went out as a download or a share
  // is still being read from storage, so it stays until the next load.
  function finish(p, how) {
    if (p.take) {
      p.take.state = 'done';
      p.take.how = how;
      logTake(p.take);
    }
    if (how === 'saved' && p.opfs) dropTake(p.opfs);
  }

  // The take, complete in origin-private storage, written out to the file the
  // dialog named. The browser streams it, so a multi-gigabyte take doesn't pass
  // through the tab — but it is a copy, and a long one takes a moment.
  async function deliver(h, p) {
    flash?.(`⏳ writing ${h.name} (${mb(p.file.size)})…`);
    try {
      const w = await h.createWritable();
      await w.write(p.file);
      await w.close();
    } catch (e) {
      warn(`recording: couldn't write ${h.name} (${e.message ?? e}) — downloading instead`);
      return false;
    }
    finish(p, 'saved');
    flash?.(`⏹ saved ${h.name} — ${p.take ? dur(p.take.secs) : mb(p.file.size)}`);
    return true;
  }

  // On load: takes a dead tab left in storage are offered back, and the ones
  // already handed over are cleared out. What the log has on how the last one
  // ended goes to the console, since that's the only trace a crash leaves.
  async function recover() {
    if (!navigator.storage?.getDirectory) return;
    const takes = readTakes();
    if (!takes.length) return;
    let crashed = null;
    for (const t of takes) {
      if (t.state === 'rolling' || t.state === 'ended') {
        let file = null;
        try { file = await takeFile(t.name); } catch { /* never got a byte */ }
        if (file?.size) crashed = { file, take: t };
        else { t.state = 'lost'; await dropTake(t.name); }
      } else if (t.state === 'done') {
        await dropTake(t.name);
      }
    }
    writeTakes(takes);
    if (!crashed) return;
    const t = crashed.take;
    t.recovered = true;
    console.warn('fizzle: the last recording did not end cleanly', t);
    warn(`recording: the last take didn't end — ${dur(t.secs)} and ${mb(crashed.file.size)} written when the tab went`
      + (t.backlog ? `, ${mb(t.backlog)} still waiting for disk` : '')
      + (t.heap ? `, heap ${mb(t.heap)}` : '')
      + ' — ⤴ in the corner saves what there is');
    park({ file: new File([crashed.file], t.file, { type: t.type }), opfs: t.name, take: t });
  }
  recover().catch(() => {});

  const recording = () => !!rec;

  const markDirty = () => { dirty = true; };

  function unwatch() {
    observer?.disconnect();
    watched?.removeEventListener('scroll', markDirty, true);
    watched?.ownerDocument.defaultView?.removeEventListener('resize', markDirty);
    observer = watched = null;
  }

  // Anything that changes the code's appearance is a DOM change, a scroll or a
  // resize — typing, selection, folding, the active-line highlight — so
  // watching the element covers it without wiring into the editor.
  function watch(el) {
    unwatch();
    watched = el;
    const view = el.ownerDocument.defaultView;
    observer = new view.MutationObserver(markDirty);
    observer.observe(el, { subtree: true, childList: true, characterData: true, attributes: true });
    el.addEventListener('scroll', markDirty, true);
    view.addEventListener('resize', markDirty);
  }

  async function refresh(el, k) {
    busy = true;
    dirty = false;
    snaps++;
    try {
      const next = await snapshot(el, k);
      if (next && !checked) {
        checked = true;
        if (!isClean(next)) {
          noOverlay = true;
          warn('recording: the code layer came back tainted — recording the picture only');
          return;
        }
      }
      if (next && shotEl === el) {
        if (shot) shot.width = 0; // free the backing store now, not at GC
        shot = next;
        shotScale = k;
      }
    } catch (e) {
      // the recording is still worth having without it
      noOverlay = true;
      warn(`recording: the code couldn't be drawn into the video (${e.message ?? e})`);
    } finally {
      busy = false;
    }
  }

  function dropOverlay() {
    if (!shot && !shotEl) return;
    if (shot) shot.width = 0;
    shot = shotEl = null;
    shotScale = 0;
    unwatch();
  }

  // One composited frame, from inside the render loop.
  function frame() {
    if (!rec || !canvas.width || !canvas.height) return;
    // Direct capture: the compositor is feeding the recorder the frames this
    // canvas draws, and there's nothing for the loop to do. Just notice if the
    // code turns up, since it can't be let in now. Not every frame — asking
    // costs a layout flush, which is the sort of thing this path exists to
    // stop doing sixty times a second.
    if (!out) {
      frames++; // render ticks: a stand-in for the frames the compositor took
      const now = performance.now();
      if (now - lastFrame < 500) return;
      lastFrame = now;
      if (codeLayer()) {
        warn('recording: this take started with no code on screen, so it records the picture only — stop and start again to put the code in');
      }
      // nothing here can letterbox a stream it isn't compositing
      if (outW !== canvas.width || outH !== canvas.height) {
        warn('recording: the render changed size mid-take, which this one can\'t follow — stop and start again');
      }
      return;
    }
    // Frames the file isn't going to get are frames not worth compositing —
    // the early return is the point of the rate limit, not the requestFrame
    // below it. A couple of ms of tolerance, or a 60Hz loop aliases to 20.
    const now = performance.now();
    if (now - lastFrame < 1000 / MAX_FPS - 2) return;
    lastFrame = now;
    frames++;

    const W = out.width, H = out.height;
    // contain-fit: the buffer can change shape mid-take (a resize, a new
    // resolution(), a quality change) and the file's frame size can't
    const fit = Math.min(W / canvas.width, H / canvas.height);
    const dw = Math.round(canvas.width * fit), dh = Math.round(canvas.height * fit);
    const dx = Math.round((W - dw) / 2), dy = Math.round((H - dh) / 2);
    // only when there are bars to paint — usually the picture covers the frame
    if (dw !== W || dh !== H) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
    }
    try { ctx.drawImage(canvas, dx, dy, dw, dh); } catch { /* context lost */ }

    const layer = noOverlay ? null : codeLayer();
    if (!layer) dropOverlay();
    else {
      if (layer.el !== shotEl) {
        dropOverlay();
        shotEl = layer.el;
        watch(layer.el);
        dirty = true; // a snapshot in flight for the old one will be discarded
      }
      // Frame pixels per CSS pixel of the layer, which is what the snapshot
      // should be rasterized at. Rounded so it doesn't jitter a re-snapshot out
      // of a sub-pixel rect, and clamped: past 3× there's no more detail in the
      // text, and under 0.5× the rasterizer costs more than the pixels are
      // worth.
      const k = Math.round(Math.min(3, Math.max(0.5, dw / layer.clip.w)) * 100) / 100;
      // shows a frame or two late, and no more often than SNAP_MS; fine
      if ((dirty || k !== shotScale) && !busy && now - lastSnap > SNAP_MS) {
        lastSnap = now;
        refresh(layer.el, k);
      }
      if (shot) {
        const c = layer.clip;
        const s = shotScale;
        try { ctx.drawImage(shot, c.x * s, c.y * s, c.w * s, c.h * s, dx, dy, dw, dh); }
        catch (e) {
          noOverlay = true;
          warn(`recording: the code couldn't be drawn into the video (${e.message ?? e})`);
        }
      }
    }
    track.requestFrame?.();
  }

  function tickDot() {
    const now = performance.now();
    const secs = (now - startedAt) / 1000;
    // how much there is so far is worth seeing either way: on disk it's what a
    // crash would leave, in the tab it's what there's room for
    dot.textContent = `${dur(secs)} · ${mb(held)}`;

    // Frames going in and nothing coming out: the recorder is holding them,
    // and it holds them in memory. Chrome's muxer writes nothing until it has
    // audio to interleave with the picture, so a sound track that has gone
    // quiet — a context that never resumed, an output device that went away,
    // an AAC encoder that failed — stalls the picture with it, and a stalled
    // take grows at the video bitrate until the tab dies. mp4 also only emits
    // at a keyframe past the timeslice, one per hundred frames, which is why
    // the frame count is part of the test and not the clock alone.
    if (held !== lastHeld || !lastHeldAt) {
      lastHeld = held;
      lastHeldAt = now;
      framesAtHeld = frames;
      stalled = false;
    } else {
      const quiet = Math.round((now - lastHeldAt) / 1000), pushed = frames - framesAtHeld;
      if (!stalled && pushed > 150 && quiet >= 10) {
        stalled = true;
        warn(`recording: nothing has reached the disk for ${quiet} s while frames go in — the recorder is holding them (has the sound stopped arriving?)`);
      }
      if (rec && pushed > 450 && quiet >= 30) {
        warn(`recording: stopped — the recorder held everything for ${quiet} s; what it had is being saved. Start a new take, without rec. audio if it happens again`);
        toggle();
      }
    }
    if (take) {
      Object.assign(take, {
        secs: Math.round(secs), bytes: held, backlog, frames, snaps, stalled,
        heap: performance.memory?.usedJSHeapSize ?? 0, audio: audioState(), warnings: recent,
        hidden: document.visibilityState === 'hidden', at: new Date().toISOString(),
      });
      logTake(take);
    }
  }

  // Both halves have an await in them — the file picker on the way in, the
  // recorder's last chunk on the way out — and a second press landing inside
  // either would open a second picker or start a take over the top of one.
  let switching = false;

  async function toggle() {
    if (switching) return;
    switching = true;
    try { await (rec ? stop() : start()); } finally { switching = false; }
  }

  // Ask where it goes, and in what. Chrome/Edge hand back a handle the take is
  // written into at the end; everywhere else it's handed over as a download
  // or a share. Returns the [ext, mime] to record in, or null if it isn't
  // going to happen.
  async function openFile(want, sound) {
    const avail = formats(want, sound);
    if (!avail.length) {
      warn('recording: this browser has no video recorder');
      return null;
    }
    let [ext, mime] = avail[0];
    saveName = `fizzle-${slug(getName?.())}-${stamp()}.${ext}`;
    handle = null;
    if (!window.showSaveFilePicker) return [ext, mime];

    // The save dialog has a format menu of its own, so that's where the choice
    // lives rather than in a second dialog of ours: the setting is what's
    // selected in it, and picking another one there changes this take only.
    const types = avail.map(([e]) => ({
      description: LABEL[e],
      accept: { [PLAIN[e]]: [`.${e}`] },
    }));
    try {
      handle = await window.showSaveFilePicker({ suggestedName: saveName, types });
    } catch (e) {
      if (e?.name === 'AbortError') return null; // changed their mind
      // a browser that won't take that accept map still takes a bare ask
      try {
        handle = await window.showSaveFilePicker({ suggestedName: saveName });
      } catch (e2) {
        if (e2?.name === 'AbortError') return null;
      }
    }
    // what they settled on: the dialog names the file after the type they
    // chose in it, so the extension it came back with is the answer
    const chosen = /\.([a-z0-9]+)$/i.exec(handle?.name ?? '')?.[1]?.toLowerCase();
    const hit = avail.find(([e]) => e === chosen);
    if (hit) [ext, mime] = hit;
    if (handle?.name) saveName = handle.name;
    return [ext, mime];
  }

  // Only the video tracks are ours to end. The audio one is the tap's, shared
  // by every take there will be, and a stopped track never comes back.
  const release = () => stream?.getVideoTracks().forEach((t) => t.stop());

  // Couldn't start: hand back everything start() had already taken.
  async function fail(e) {
    release();
    chunks = null;
    handle = null;
    if (spool) {
      await call('close').catch(() => {});
      dropTake(spool);
      spool = '';
    }
    if (take) { take.state = 'failed'; logTake(take); take = null; }
    warn(`recording: ${e.message ?? e}`);
  }

  async function start() {
    // a take left un-tapped isn't a take meant to be thrown away; put it
    // somewhere before this one starts piling up behind it
    if (pending) {
      const p = pending;
      pending = null;
      saveBtn.hidden = true;
      download(p.file);
      finish(p, 'downloaded');
    }
    // inside the gesture that asked for it — a file picker needs one
    const wantSound = getAudio?.() ?? false;
    const picked = await openFile(getFormat?.() ?? 'mkv', wantSound);
    if (!picked) return;
    const [ext] = picked;
    let [, mime] = picked;
    recMime = mime;

    // Where the bytes go while it rolls. Storage is the answer wherever there
    // is any; memory is the fallback, with its ceiling, for where there isn't
    // (an insecure context has no storage and no dialog either).
    spool = '';
    chunks = null;
    held = backlog = 0;
    take = { name: `take-${Date.now()}.${ext}`, file: saveName, type: PLAIN[ext], mime, started: new Date().toISOString(), state: 'rolling', secs: 0, bytes: 0 };
    if (navigator.storage?.getDirectory && typeof Worker !== 'undefined') {
      try {
        await call('open', { dir: OPFS_DIR, name: take.name }, [], 8000);
        spool = take.name;
      } catch (e) {
        warn(`recording: the browser's storage wouldn't take the recording (${e.message ?? e}) — holding it in memory instead`);
      }
    }
    if (!spool) chunks = [];
    take.where = spool ? 'storage' : 'memory';
    take.dest = handle ? 'file' : isTouch ? 'share' : 'download';

    // The tap's own track, which lives as long as the page does: every source
    // is already feeding it, including ones that start after this take does.
    // Not stopped with the rest at the end, since stopping it would end it for
    // every take after this one too.
    let audioTrack = null;
    if (wantSound) {
      if (!mimeFor(ext, true)) {
        warn(`recording: this browser can't put audio in .${ext} — recording silent`);
      } else {
        // opening the audio graph is not a reason to lose the picture
        try { audioTrack = audioTap().getAudioTracks()[0] ?? null; }
        catch (e) { warn(`recording: no audio in this one (${e.message ?? e})`); }
      }
    }

    // Compositing exists to put the code over the picture. With no code to put
    // there, and a frame that's the drawing buffer at its own size, the copy
    // would be pixel-for-pixel identical to what the canvas already has — so
    // hand the recorder that canvas instead and take a full-frame readback per
    // frame back out of the render loop. It's the same trick the projector
    // mirror uses, and on a phone that readback is most of what recording
    // costs: the compositor does it off the main thread or not at all.
    //
    // Decided once, because a MediaRecorder can't change source mid-take.
    const [w, h] = getSize();
    const direct = !codeLayer() && w === canvas.width && h === canvas.height;

    if (direct) {
      out = ctx = null;
      outW = canvas.width;
      outH = canvas.height;
      stream = canvas.captureStream(MAX_FPS);
      track = stream.getVideoTracks()[0];
    } else {
      // Scale only bites here. Direct capture is already costing the render
      // nothing at full size, so shrinking it would trade quality for a saving
      // that isn't there.
      const k = getScale?.() ?? 1;
      out = document.createElement('canvas');
      out.width = outW = even(w * k);
      out.height = outH = even(h * k);
      ctx = out.getContext('2d', { alpha: false });
      // Below full scale every frame is a downscale, and generative work is all
      // high-frequency detail — point-sampled, it crawls and fizzes from frame
      // to frame, which reads as a bad encode rather than as aliasing.
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      // 0 = the canvas only yields a frame when asked, so the file gets exactly
      // the frames composited for it. Without requestFrame, sample instead.
      stream = out.captureStream(0);
      track = stream.getVideoTracks()[0];
      if (!track?.requestFrame) {
        release();
        stream = out.captureStream(MAX_FPS);
        track = stream.getVideoTracks()[0];
      }
    }
    if (audioTrack) stream.addTrack(audioTrack);

    lastFrame = lastSnap = 0;
    frames = snaps = 0;
    lastHeld = lastHeldAt = framesAtHeld = 0;
    stalled = false;
    const video = bitrate(outW, outH, MAX_FPS);
    const make = () =>
      new MediaRecorder(stream, {
        mimeType: mime,
        videoBitsPerSecond: video,
        ...(audioTrack ? { audioBitsPerSecond: 128e3 } : {}),
      });
    try {
      rec = make();
    } catch (e) {
      // Which pairs of codecs a container will actually take is a matrix
      // nothing here can predict, and isTypeSupported answers for the string
      // rather than for the stream it's about to be handed. Where that lands
      // wrong, drop the audio: a take of the picture beats no take at all.
      if (!audioTrack) return fail(e);
      warn(`recording: no audio in this one (${e.message ?? e})`);
      stream.removeTrack(audioTrack);
      audioTrack = null;
      recMime = mime = mimeFor(ext, false) ?? mime;
      try { rec = make(); } catch (e2) { return fail(e2); }
    }
    Object.assign(take, { mime, size: `${outW}x${outH}`, direct, audio: !!audioTrack, bitrate: video });
    writeError = null;
    queue = Promise.resolve();
    // an encoder that gives up mid-take (a size it won't take, a codec that
    // fails late) does it through this event and nowhere else
    rec.onerror = (e) => warn(`recording: ${e.error?.message ?? 'the encoder failed mid-take'}`);
    // ...and one that then ends on its own leaves a take that thinks it's
    // rolling; stop() replaces this handler, so it only fires for that
    const r0 = rec;
    rec.onstop = () => { if (rec === r0) { warn('recording: the recorder stopped on its own — saving what it wrote'); toggle(); } };
    rec.ondataavailable = (e) => {
      if (!e.data?.size) return;
      if (spool) {
        // Read and written one blob at a time, in order. A disk that can't keep
        // up shows as bytes waiting here, and a disk that says no — out of
        // room, most likely — ends the take with what's written kept.
        const blob = e.data;
        backlog += blob.size;
        queue = queue
          .then(async () => {
            const buf = await blob.arrayBuffer();
            held = await call('write', { buf }, [buf]);
          })
          .catch((err) => {
            if (writeError) return;
            writeError = err;
            if (rec) {
              warn(`recording: the disk stopped taking the take (${err.message ?? err}) — stopping, what's written is kept`);
              toggle();
            }
          })
          .finally(() => { backlog -= blob.size; });
        if (backlog > BACKLOG_CAP && rec) {
          warn(`recording: stopped at ${dur((performance.now() - startedAt) / 1000)} — the disk is ${mb(backlog)} behind the recorder`);
          toggle();
        }
        return;
      }
      chunks.push(e.data);
      held += e.data.size;
      // ending it here at least hands over what there is; a tab that runs out
      // of room takes the whole take with it
      if (held > MEMORY_CAP) {
        warn(`recording: stopped at ${mb(held)} — nothing here can stream to a file, so the take has to fit in the tab`);
        toggle();
      }
    };
    noOverlay = false;
    checked = false;
    dirty = true;
    forgetCss();
    frame(); // a first frame, so the recorder starts on a picture
    // a second at a time: a second of video is all the tab holds, and the
    // write behind it is what a crash can't take back
    rec.start(1000);

    startedAt = performance.now();
    dot.classList.add('show');
    tickDot();
    timer = setInterval(tickDot, 500);
    flash?.(`● recording ${outW}×${outH}${audioTrack ? ' + audio' : ''} → ${saveName}`);
    onChange?.();
  }

  function download(file) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }

  // The share sheet is the only route to a phone's camera roll — a download
  // lands in Files, where a video is a file you need an app to open. But
  // navigator.share() wants a *live* user gesture, and stopping a recording
  // spends one: by the time the recorder has handed over its last chunk, the
  // tap that ended the take is long gone and iOS refuses the sheet. That's why
  // the first version quietly downloaded instead.
  //
  // So the finished take waits behind a button of its own, and the sheet opens
  // from that tap. Anywhere without a share sheet — a laptop, or a browser
  // that won't take files — the download is the whole story, as before.
  function offer(p, d) {
    const { file } = p;
    if (isTouch && navigator.canShare?.({ files: [file] })) {
      park(p);
      return `⏹ ${d} recorded — tap ⤴ to save it`;
    }
    download(file);
    finish(p, 'downloaded');
    if (!isTouch) return `⏹ downloaded ${file.name} — ${d}`;
    // A phone that won't offer the sheet has three ways of not offering it,
    // and they want different things done about them. The share API is
    // secure-context only, so a dev server reached over the network by its IP
    // hasn't got one at all — which looks identical to a refusal from here.
    const why = !window.isSecureContext ? 'sharing needs https'
      : !navigator.canShare ? 'no share sheet in this browser'
      : `sheet refused ${file.type || 'a file with no type'}, ${mb(file.size)}`;
    return `⏹ downloaded ${file.name} — ${why}`;
  }

  async function stop() {
    const r = rec;
    rec = null;
    clearInterval(timer);
    dot.classList.remove('show');
    dropOverlay();
    onChange?.();

    // an already-inactive recorder throws rather than firing onstop, and a
    // promise that never settles would leave ctrl+e dead for the session
    await new Promise((done) => {
      r.onstop = done;
      try { r.stop(); } catch { done(); }
    });
    release();
    const secs = Math.round((performance.now() - startedAt) / 1000);
    const d = dur(secs);
    const t = take;
    take = null;
    if (t) { t.secs = secs; t.state = 'ended'; logTake(t); }
    // Safari has been known to leave mimeType empty; a File with no type is
    // one the share sheet can't identify and won't take
    const type = (r.mimeType || recMime || '').split(';')[0];
    const ext = extFor(type);
    if (ext) saveName = saveName.replace(/\.[^.]+$/, `.${ext}`);
    if (t) { t.file = saveName; t.type = type; }
    let msg;

    if (chunks) {
      const file = new File(chunks, saveName, { type });
      chunks = null;
      msg = offer({ file, opfs: '', take: t }, d);
    } else {
      const name = spool;
      spool = '';
      await queue; // every blob read and acknowledged, or the error that ended it
      let file = null;
      try {
        await call('close');
        file = new File([await takeFile(name)], saveName, { type });
      } catch (e) {
        writeError ??= e;
      }
      if (!file?.size) {
        warn(`recording: ${saveName} has nothing in it (${writeError?.message ?? writeError ?? 'no data'})`);
        if (t) { t.state = 'lost'; logTake(t); }
        dropTake(name);
        handle = null;
        return;
      }
      const p = { file, opfs: name, take: t };
      if (handle) {
        const h = handle;
        handle = null;
        const ok = await deliver(h, p);
        if (!ok) {
          download(file);
          finish(p, 'downloaded');
          msg = `⏹ downloaded ${saveName} instead — ${d}`;
        }
      } else {
        msg = offer(p, d);
      }
    }
    if (writeError) {
      warn(`recording: ${saveName} didn't finish writing (${writeError.message ?? writeError})`);
    }
    if (msg) flash?.(msg);
  }

  // Closing the tab mid-take: the worker dies with the page, and what it had
  // flushed is on disk under a take still logged as rolling — which is the
  // state the next load offers back.
  window.addEventListener('pagehide', () => { if (rec) stop(); });

  return { frame, recording, toggle };
}
