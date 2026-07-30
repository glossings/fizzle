# Blob tracking

Notes toward a blob-tracking operator. Not started; this is a
scoping document, not a plan of record.

Blob tracking is two separable things with very different costs, and the first
decision is which one you actually want:

- **Blob visuals** — the segmented/labeled blob image. Pure GPU, no readback, no
  tracking. Jump-flood label propagation in a fragment shader, fits the existing
  `SPECS` pattern in [tops.js:71](src/tops.js#L71) with no new machinery. Half a
  day.
- **Blob data** — positions and sizes driving other parameters. Needs everything
  below.

The rest of this file is about the data path.

## What already exists

Webcam capture is done: [engine.js:197](src/engine.js#L197) handles
`getUserMedia` and case-insensitive device-label matching for the `video()` TOP.
The RT pipeline already renders nodes at arbitrary scale
([tops.js:953](src/tops.js#L953)), so thresholding and downsampling need no new
code. And [`sig()`](src/audio.js#L193) is the precedent for a live external
signal chained into parameters.

## What's missing

### 1. GPU→CPU readback — easy, ~30 lines

Nothing in `src/` calls `readPixels` today. `readRenderTargetPixelsAsync()`
exists in three 0.185 (`node_modules/three/src/renderers/WebGLRenderer.js`) and
handles the PBO round-trip, so there's no pipeline stall. Threshold and
downsample to ~160×120 on the GPU, read back one small buffer per frame.

Costs one to two frames of latency. Irrelevant for visuals; worth remembering if
anything ever wants blob data to line up exactly with a specific frame.

### 2. Connected-component labeling — easy, ~80 lines

Two-pass union-find over the binary image. 160×120 is 19k pixels, well under a
millisecond in plain JS — no workers, no WASM. Accumulate area, centroid and
bbox during label resolution so blob stats come out of the same pass.

### 3. Frame-to-frame ID tracking — medium, ~60 lines

Greedy nearest-neighbour match against the previous frame's blobs within a
max-distance gate, plus birth/death hysteresis: persist N frames to be born,
survive M missing frames before dying. Hungarian matching is overkill — greedy
is what the big native tools effectively feel like in practice.

The algorithm is trivial. The tuning is where the time actually goes.

### 4. API shape — the real problem

A design question, not an engineering one. `sig()` is scalar-only and blobs are
a variable-length array of structs. Two options:

- **Fixed slots** — `blobs(video(), { max: 8 })` gives 8 always-present slots,
  each exposing `.x` / `.y` / `.size` as sigs, unoccupied ones zeroed. Very
  Familiar, needs no changes to the parameter system, and plays well with the
  per-instance fan-out already in [tops.js:919](src/tops.js#L919).
- **Dynamic array** — more honest about what blobs are, but every consumer has
  to handle variable length and it doesn't fit `fn(t) => number` at all.

Fixed slots is the recommendation, on the grounds that it requires changing
nothing else.

## Estimate

About a day for a working data path. Another day or two for what every operator
here owes: doc entries in [docs.js](src/docs.js), autocomplete in
[complete.js](src/complete.js), a section in
[docs-content.md](src/docs-content.md), and an example sketch.

The core 80% is genuinely cheap. The last 20% — motion prediction, merge/split
heuristics, aspect-ratio filtering — is where the fiddly time hides, and most of
it is skippable.
