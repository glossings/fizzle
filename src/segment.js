// Person segmentation behind person(): MediaPipe segmenters run through
// @mediapipe/tasks-vision. Everything is lazy — engine.ensureSegment
// import()s this module the first time a sketch says person(), and the wasm
// backend (~12 MB) plus the model download then, not at page load. Vite's
// ?url imports keep it all self-hosted, so nothing reaches for a CDN at
// runtime. Two models (both Apache-2.0, committed in src/assets/): the
// 250 KB selfie segmenter for the plain person mask, and the 16 MB
// multiclass one — fetched only when a sketch names a part — for
// hair/face/body/clothes.
//
// Masks are CPU-copied out per camera frame at the models' own working scale
// and uploaded as grayscale DataTextures — small enough that inference and
// readback stay cheap regardless of camera resolution, and linear sampling
// smooths them back up.

import * as THREE from 'three';
import { warn } from './warn.js';
import wasmLoaderPath from '@mediapipe/tasks-vision/vision_wasm_internal.js?url';
import wasmBinaryPath from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url';
import fastModelPath from './assets/selfie_segmenter.tflite?url';
import multiModelPath from './assets/selfie_multiclass_256x256.tflite?url';

const WORK_W = 256;

const MODELS = { fast: fastModelPath, multi: multiModelPath };

// a part is one or more of the multiclass model's labels, summed; 'person'
// is the whole person, which each model spells its own way (see run()).
// It's the default rather than a part you'd ask for, so NAMED_PARTS is what
// the docs list and what a bad part is measured against.
const PART_LABELS = {
  person: null,
  hair: ['hair'],
  face: ['face-skin'],
  body: ['body-skin'],
  skin: ['body-skin', 'face-skin'],
  clothes: ['clothes'],
  other: ['others'],
};

const NAMED_PARTS = Object.keys(PART_LABELS).filter((p) => p !== 'person');

// segmenters by model, shared across cameras; VIDEO mode wants timestamps
// that only go up, so every loop draws from one counter
const segmenters = new Map();
let lastTs = 0;

function segmenter(model) {
  let p = segmenters.get(model);
  if (!p) {
    p = import('@mediapipe/tasks-vision')
      .then(({ ImageSegmenter }) =>
        ImageSegmenter.createFromOptions(
          { wasmLoaderPath, wasmBinaryPath },
          {
            baseOptions: { modelAssetPath: MODELS[model], delegate: 'GPU' },
            runningMode: 'VIDEO',
            outputConfidenceMasks: true,
          }
        )
      )
      .then((seg) => ({ seg, labels: seg.getLabels() }));
    segmenters.set(model, p);
  }
  return p;
}

// One inference loop per camera+model, feeding every part slot registered on
// it — asking for hair and clothes of the same camera segments once. Loops
// run for the life of the page, but inference only happens on frames
// something rendered recently (slots' `wanted` is stamped by the person()
// nodes), so an edited-out person() goes quiet.
const loops = new Map();

export function startSegment(slot, videoSlot, part, camName) {
  // A bad part warns and keeps its own name: renaming it to 'person' would
  // make two typos in one sketch share a slot key, the second evicting the
  // first. PART_LABELS misses either way, which is run()'s whole-person path.
  if (part != null && !(part in PART_LABELS))
    warn(`person: no part "${part}" — the parts are ${NAMED_PARTS.join(', ')}. Using the whole person`);
  // only parts that name labels need the 16 MB model; the rest read background
  const model = PART_LABELS[part] ? 'multi' : 'fast';
  const key = `${model}|${camName}`;
  let loop = loops.get(key);
  if (!loop) {
    loop = { videoSlot, slots: new Map(), seg: null, labels: null };
    loops.set(key, loop);
    segmenter(model).then(
      (s) => { loop.seg = s.seg; loop.labels = s.labels; },
      (e) => warn(`person: segmenter failed to load — ${e.message ?? e}`)
    );
    run(loop);
  }
  // a reaped camera comes back as a fresh slot (engine.reapCaptures) — the
  // loop must read the live one, not the one it was created with
  loop.videoSlot = videoSlot;
  loop.slots.set(part ?? '', slot);
}

function run(loop) {
  const canvas = document.createElement('canvas');
  const g = canvas.getContext('2d');
  let lastVideoTime = -1;

  const step = () => {
    requestAnimationFrame(step);
    if (!loop.seg) return;
    const now = performance.now();
    let wanted = false;
    for (const s of loop.slots.values()) wanted ||= now - s.wanted < 1000;
    if (!wanted) return;
    const el = loop.videoSlot.texture?.image;
    if (!el || el.readyState < 2 || !el.videoWidth) return;
    // the camera runs slower than the render loop; only new frames cost
    if (el.currentTime === lastVideoTime) return;
    lastVideoTime = el.currentTime;

    const w = WORK_W;
    const h = Math.max(1, Math.round((w * el.videoHeight) / el.videoWidth));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    g.drawImage(el, 0, 0, w, h);
    lastTs = Math.max(lastTs + 1, now);
    // callback form: the masks are only valid inside it, so copy out
    loop.seg.segmentForVideo(canvas, lastTs, (result) => {
      const masks = result.confidenceMasks;
      if (!masks?.length) return;
      // labels index the masks, and the two models label nothing alike: the
      // multiclass one opens with 'background', the fast one's whole labelmap
      // is a single 'selfie' (see the labels.txt inside each .tflite)
      const conf = new Map();
      const byLabel = (l) => {
        const i = loop.labels.indexOf(l);
        if (i < 0 || !masks[i]) return null;
        if (!conf.has(i)) conf.set(i, masks[i].getAsFloat32Array());
        return conf.get(i);
      };
      // so the whole person is 'background' inverted on one and 'selfie' taken
      // straight on the other — asking either for the other's name gets null
      const bg = byLabel('background');
      const whole = bg ?? byLabel('selfie');
      for (const [part, slot] of loop.slots) {
        const names = PART_LABELS[part];
        const a = names ? byLabel(names[0]) : whole;
        if (!a) continue;
        writeSlot(slot, masks[0].width, masks[0].height, a, names ? byLabel(names[1]) : null, !names && bg != null);
      }
    });
  };
  requestAnimationFrame(step);
}

// One part's confidences -> the slot's texture: a = the mask (inverted for
// 'person', which is defined as not-background), b = an optional second mask
// summed in ('skin' is body + face). Rows are flipped in the copy — the mask
// is top-down and UVs are y-up, and texture.flipY only applies to DOM-source
// uploads, not raw data. Each pixel gets an S-curve on the confidence (firms
// the halo of half-sure pixels around the silhouette) and then keeps
// `smooth` of its previous value (the person() node writes slot.smooth per
// frame), trading edge lag for the model's frame-to-frame flicker.
function writeSlot(slot, mw, mh, a, b, invert) {
  const keep = slot.smooth ?? 0.4;
  let tex = slot.texture;
  if (!tex || tex.image.width !== mw || tex.image.height !== mh) {
    tex?.dispose();
    tex = new THREE.DataTexture(new Uint8Array(mw * mh * 4), mw, mh);
    tex.magFilter = tex.minFilter = THREE.LinearFilter;
    slot.texture = tex;
  }
  const px = tex.image.data;
  for (let y = 0; y < mh; y++) {
    let i = y * mw;
    let j = (mh - 1 - y) * mw * 4;
    for (let x = 0; x < mw; x++, i++, j += 4) {
      let c = invert ? 1 - a[i] : b ? a[i] + b[i] : a[i];
      const s = Math.min(1, Math.max(0, (c - 0.2) / 0.6));
      const v = s * s * (3 - 2 * s) * 255;
      const o = (px[j] + (1 - keep) * (v - px[j]) + 0.5) | 0;
      px[j] = px[j + 1] = px[j + 2] = o;
      px[j + 3] = 255;
    }
  }
  tex.needsUpdate = true;
}
