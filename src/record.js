import { warn } from './warn.js';
import { isTouch } from './touch.js';

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

// The containers worth offering, each with the codec strings to try for it.
// mkv and webm stay playable if the writing stops mid-take; mp4 needs a
// trailer, so a take that's cut off is a lost one — but it's the one every
// player opens and the only one a phone will put in the camera roll. Which
// trade is the right one is the user's, so it's a setting.
const CONTAINERS = {
  mkv: ['video/x-matroska;codecs=avc1', 'video/x-matroska;codecs=vp9', 'video/x-matroska'],
  webm: ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'],
  mp4: ['video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1', 'video/mp4'],
};

const LABEL = { mkv: 'Matroska video', webm: 'WebM video', mp4: 'MP4 video' };
const PLAIN = { mkv: 'video/x-matroska', webm: 'video/webm', mp4: 'video/mp4' };

const supported = (mime) => {
  try { return MediaRecorder.isTypeSupported?.(mime) ?? false; } catch { return false; }
};

// how to record into that container here, or null if this browser can't
const mimeFor = (ext) =>
  (typeof MediaRecorder === 'undefined' ? null : CONTAINERS[ext]?.find(supported)) ?? null;

// What this browser can actually record, for the sidebar to offer.
export const recordable = () => Object.keys(CONTAINERS).filter(mimeFor);

// [ext, mime] for everything available, with the one asked for first — the
// rest follow so a browser that can't do the chosen container still records,
// and so the save dialog can list the alternatives.
function formats(want) {
  const order = [...new Set([want, ...Object.keys(CONTAINERS)])];
  return order.map((ext) => [ext, mimeFor(ext)]).filter(([, mime]) => mime);
}

// What the recorder actually produced, which is not always what it was asked
// for. A file named for the wrong container is one nothing will open — and on
// a phone it's the difference between the camera roll and a dead end.
const extFor = (mime) =>
  (/matroska/.test(mime) ? 'mkv' : /mp4/.test(mime) ? 'mp4' : /webm/.test(mime) ? 'webm' : '');

// With nowhere to stream to, the whole take sits in the tab. Stop before that
// kills it — a phone has far less room for this than a laptop does.
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

// --- the recorder ------------------------------------------------------------

// getSize: [w, h] the file should be — resolution(), the sidebar's fixed size,
//   or the window's own pixels. Quality scales the buffer underneath, not this.
// codeLayer: { el, clip } | null — the element to draw over the picture and
//   which part of it the picture occupies, in the element's own coordinates.
// getFormat: the container the sidebar is set to — the default the save
//   dialog opens on, and the whole answer where there's no dialog.
export function initRecorder({ canvas, getSize, getName, getFormat, getScale, codeLayer, flash, onChange }) {
  let rec = null;          // the live MediaRecorder, or null
  let out = null, ctx = null, stream = null, track = null;
  let outW = 0, outH = 0;  // the frame size, with or without a compositing canvas
  let writable = null;     // streaming to a chosen file
  let queue = Promise.resolve(); // writes, kept in order
  let chunks = null;       // ...or held in memory, for browsers without a picker
  let held = 0;            // how much of the tab that's taken up
  let recMime = '';        // what this take was asked to record in
  let writeError = null;   // the first write that didn't land, if any
  let saveName = '';
  let startedAt = 0, timer = 0;

  // the code layer, cached: it only changes when someone types or scrolls
  let shot = null, shotEl = null, dirty = true, busy = false, noOverlay = false;
  let checked = false;     // this take's first snapshot has been proved clean
  let shotScale = 0;       // frame px per CSS px the snapshot was made at
  let lastFrame = 0, lastSnap = 0;
  let observer = null, watched = null;

  const dot = document.createElement('div');
  dot.id = 'rec-dot';
  document.body.appendChild(dot);

  // A take that's finished and waiting to be handed somewhere, and the button
  // that does it. Sits where the recording indicator was, so the take ending
  // swaps one for the other in the same corner.
  let pending = null;
  const saveBtn = document.createElement('button');
  saveBtn.id = 'rec-save';
  saveBtn.hidden = true;
  saveBtn.textContent = '⤴ save video';
  saveBtn.addEventListener('click', () => {
    const file = pending;
    if (!file) return;
    pending = null;
    saveBtn.hidden = true;
    // Called straight out of the tap with nothing awaited in front of it —
    // an await here is exactly what loses the gesture and closes this door.
    navigator.share({ files: [file], title: file.name }).catch((e) => {
      // dismissing the sheet isn't a decision to throw the take away
      if (e?.name === 'AbortError') {
        pending = file;
        saveBtn.hidden = false;
        return;
      }
      warn(`recording: the share sheet refused the file (${e.message ?? e})`);
      download(file);
      flash?.(`⏹ downloaded ${file.name} instead`);
    });
  });
  document.body.appendChild(saveBtn);

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
    const s = Math.floor((performance.now() - startedAt) / 1000);
    // with the take piling up in the tab rather than going to disk, how much
    // of it there is now is worth knowing before it's a problem
    const size = chunks ? ` · ${Math.round(held / 1e6)} MB` : '';
    dot.textContent = `${Math.floor(s / 60)}:${pad(s % 60)}${size}`;
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

  // Ask where it goes, and in what. Chrome/Edge hand back a handle we can
  // stream into; everywhere else the take is held in memory and handed over at
  // the end. Returns the [ext, mime] to record in, or null if it isn't going
  // to happen.
  async function openFile(want) {
    const avail = formats(want);
    if (!avail.length) {
      warn('recording: this browser has no video recorder');
      return null;
    }
    let [ext, mime] = avail[0];
    saveName = `fizzle-${slug(getName?.())}-${stamp()}.${ext}`;
    if (!window.showSaveFilePicker) {
      chunks = [];
      return [ext, mime];
    }

    // The save dialog has a format menu of its own, so that's where the choice
    // lives rather than in a second dialog of ours: the setting is what's
    // selected in it, and picking another one there changes this take only.
    const types = avail.map(([e]) => ({
      description: LABEL[e],
      accept: { [PLAIN[e]]: [`.${e}`] },
    }));
    let handle = null;
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

    try {
      writable = await handle.createWritable();
      queue = Promise.resolve();
    } catch {
      chunks = []; // no handle, or no permission to write through it
    }
    return [ext, mime];
  }

  async function start() {
    // a take left un-tapped isn't a take meant to be thrown away; put it
    // somewhere before this one starts piling up behind it
    if (pending) {
      download(pending);
      pending = null;
      saveBtn.hidden = true;
    }
    // inside the gesture that asked for it — a file picker needs one
    const picked = await openFile(getFormat?.() ?? 'mkv');
    if (!picked) return;
    const [, mime] = picked;
    recMime = mime;

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
        stream.getTracks().forEach((t) => t.stop());
        stream = out.captureStream(MAX_FPS);
        track = stream.getVideoTracks()[0];
      }
    }

    lastFrame = lastSnap = 0;
    try {
      rec = new MediaRecorder(stream, {
        mimeType: mime,
        videoBitsPerSecond: bitrate(outW, outH, MAX_FPS),
      });
    } catch (e) {
      stream.getTracks().forEach((t) => t.stop());
      chunks = null;
      await writable?.abort().catch(() => {});
      writable = null;
      warn(`recording: ${e.message ?? e}`);
      return;
    }
    writeError = null;
    held = 0;
    // an encoder that gives up mid-take (a size it won't take, a codec that
    // fails late) does it through this event and nowhere else
    rec.onerror = (e) => warn(`recording: ${e.error?.message ?? 'the encoder failed mid-take'}`);
    rec.ondataavailable = (e) => {
      if (!e.data?.size) return;
      if (!chunks) {
        // one failed write mustn't break the chain, but it has to be said at
        // the end — a set that didn't reach the disk should not report as saved
        queue = queue.then(() => writable.write(e.data)).catch((err) => { writeError ??= err; });
        return;
      }
      chunks.push(e.data);
      held += e.data.size;
      // ending it here at least hands over what there is; a tab that runs out
      // of room takes the whole take with it
      if (held > MEMORY_CAP) {
        warn(`recording: stopped at ${Math.round(held / 1e6)} MB — nothing here can stream to a file, so the take has to fit in the tab`);
        toggle();
      }
    };
    noOverlay = false;
    checked = false;
    dirty = true;
    forgetCss();
    frame(); // a first frame, so the recorder starts on a picture
    // a second at a time: with a handle that's a second of disk lag and no
    // memory growth, and without one it's how often the ceiling gets checked
    rec.start(1000);

    startedAt = performance.now();
    dot.classList.add('show');
    tickDot();
    timer = setInterval(tickDot, 500);
    flash?.(`● recording ${outW}×${outH} → ${saveName}`);
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
  function offer(file, dur) {
    if (isTouch && navigator.canShare?.({ files: [file] })) {
      pending = file;
      saveBtn.hidden = false;
      return `⏹ ${dur} recorded — tap ⤴ to save it`;
    }
    download(file);
    if (!isTouch) return `⏹ downloaded ${file.name} — ${dur}`;
    // A phone that won't offer the sheet has three ways of not offering it,
    // and they want different things done about them. The share API is
    // secure-context only, so a dev server reached over the network by its IP
    // hasn't got one at all — which looks identical to a refusal from here.
    const why = !window.isSecureContext ? 'sharing needs https'
      : !navigator.canShare ? 'no share sheet in this browser'
      : `sheet refused ${file.type || 'a file with no type'}, ${Math.round(file.size / 1e6)} MB`;
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
    stream.getTracks().forEach((t) => t.stop());
    const secs = Math.round((performance.now() - startedAt) / 1000);
    const dur = `${Math.floor(secs / 60)}:${pad(secs % 60)}`;
    let msg;

    if (chunks) {
      // Safari has been known to leave mimeType empty; a File with no type is
      // one the share sheet can't identify and won't take
      const type = (r.mimeType || recMime || '').split(';')[0];
      const ext = extFor(type);
      if (ext) saveName = saveName.replace(/\.[^.]+$/, `.${ext}`);
      const file = new File(chunks, saveName, { type });
      chunks = null;
      msg = offer(file, dur);
    } else {
      try {
        await queue;
        await writable.close();
      } catch (e) {
        writeError ??= e;
      }
      writable = null;
      msg = `⏹ saved ${saveName} — ${dur}`;
    }
    if (writeError) {
      warn(`recording: ${saveName} didn't finish writing (${writeError.message ?? writeError})`);
      return;
    }
    flash?.(msg);
  }

  // Closing the tab mid-take: stop() is async and nothing here can be awaited,
  // but the recorder flushes what it has and the container is a streaming one,
  // so what reached disk stays playable.
  window.addEventListener('pagehide', () => { if (rec) stop(); });

  return { frame, recording, toggle };
}
