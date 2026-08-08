// Person segmentation behind person(): MediaPipe's selfie segmenter run
// through @mediapipe/tasks-vision. Everything is lazy — engine.ensureSegment
// import()s this module the first time a sketch says person(), and the wasm
// backend (~12 MB) plus the model (~250 KB, Apache-2.0, committed in
// src/assets/) download then, not at page load. Vite's ?url imports keep all
// three self-hosted, so nothing reaches for a CDN at runtime.
//
// The mask is copied out per camera frame at a small working size and
// uploaded as a grayscale DataTexture — 256 px wide is plenty for a mask that
// linear sampling smooths back up, and it keeps inference and readback cheap
// regardless of camera resolution.

import * as THREE from 'three';
import { warn } from './warn.js';
import wasmLoaderPath from '@mediapipe/tasks-vision/vision_wasm_internal.js?url';
import wasmBinaryPath from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url';
import modelAssetPath from './assets/selfie_segmenter.tflite?url';

const WORK_W = 256;

// one segmenter shared by every camera; VIDEO mode wants timestamps that only
// go up, so interleaved loops draw from one counter
let segmenterPromise;
let lastTs = 0;

function segmenter() {
  segmenterPromise ??= import('@mediapipe/tasks-vision').then(({ ImageSegmenter }) =>
    ImageSegmenter.createFromOptions(
      { wasmLoaderPath, wasmBinaryPath },
      {
        baseOptions: { modelAssetPath, delegate: 'GPU' },
        runningMode: 'VIDEO',
        outputConfidenceMasks: true,
      }
    )
  );
  return segmenterPromise;
}

// Feed `slot.texture` (see ensureSegment) from the camera in `videoSlot`.
// The loop runs for the life of the page like the stream itself, but
// inference only happens on frames something rendered recently — slot.wanted
// is stamped by the person() node — so an edited-out person() goes quiet.
export function startSegment(slot, videoSlot) {
  const canvas = document.createElement('canvas');
  const g = canvas.getContext('2d');
  let seg = null;
  let lastVideoTime = -1;
  segmenter().then(
    (s) => { seg = s; },
    (e) => warn(`person: segmenter failed to load — ${e.message ?? e}`)
  );

  const step = () => {
    requestAnimationFrame(step);
    if (!seg) return;
    if (performance.now() - slot.wanted > 1000) return;
    const el = videoSlot.texture?.image;
    if (!el || el.readyState < 2 || !el.videoWidth) return;
    // the camera runs slower than the render loop; only new frames cost
    if (el.currentTime === lastVideoTime) return;
    lastVideoTime = el.currentTime;

    const w = WORK_W;
    const h = Math.max(1, Math.round((w * el.videoHeight) / el.videoWidth));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    g.drawImage(el, 0, 0, w, h);
    lastTs = Math.max(lastTs + 1, performance.now());
    // callback form: the mask is only valid inside it, so copy out
    seg.segmentForVideo(canvas, lastTs, (result) => {
      const mask = result.confidenceMasks?.[0];
      if (!mask) return;
      const mw = mask.width, mh = mask.height;
      const conf = mask.getAsFloat32Array();
      let tex = slot.texture;
      if (!tex || tex.image.width !== mw || tex.image.height !== mh) {
        tex?.dispose();
        tex = new THREE.DataTexture(new Uint8Array(mw * mh * 4), mw, mh);
        tex.magFilter = tex.minFilter = THREE.LinearFilter;
        slot.texture = tex;
      }
      // rows flipped in the copy: the mask is top-down and UVs are y-up, and
      // texture.flipY only applies to DOM-source uploads, not raw data
      const px = tex.image.data;
      for (let y = 0; y < mh; y++) {
        let i = y * mw;
        let j = (mh - 1 - y) * mw * 4;
        for (let x = 0; x < mw; x++, i++, j += 4) {
          const v = (conf[i] * 255 + 0.5) | 0;
          px[j] = px[j + 1] = px[j + 2] = v;
          px[j + 3] = 255;
        }
      }
      tex.needsUpdate = true;
    });
  };
  requestAnimationFrame(step);
}
