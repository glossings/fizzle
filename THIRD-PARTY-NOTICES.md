# Third-party notices

Third-party components redistributed with fizzle (as opposed to ordinary npm
dependencies, whose licenses ship in `node_modules/`):

## MediaPipe Selfie Segmenter (person())

- `src/assets/selfie_segmenter.tflite` and
  `src/assets/selfie_multiclass_256x256.tflite` — the segmentation models,
  committed here so builds don't depend on Google's servers. From the
  [MediaPipe image segmenter model card](https://ai.google.dev/edge/mediapipe/solutions/vision/image_segmenter#selfie-model).
- `@mediapipe/tasks-vision` — the wasm/JS runtime that runs it, copied into
  build output by Vite.

Both are Copyright Google LLC, licensed under the Apache License, Version 2.0:
<https://www.apache.org/licenses/LICENSE-2.0>. Apache-2.0 is a permissive
license and is one-way compatible with this project's AGPL-3.0-only license.
