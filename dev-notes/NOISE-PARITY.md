# GPU/CPU noise parity

`geo.sample()` on a `.noise()`d chain re-runs the shader's displacement on the
CPU ([src/noise-cpu.js](../src/noise-cpu.js), a deliberate line-by-line twin of
[src/noise.js](../src/noise.js)). This file records what was verified, what still
differs, and how to re-verify after touching either file.

## Findings

**The one real bug class: float32 `floor()` ties.** The shader's constant
`n_ = 0.142857142857` rounds *up* past 1/7 in float32 but sits *below* 1/7 as a
double. The gradient indexing (`floor(j * ns.z)` etc.) feeds `floor()` values
that land exactly on integers, so the same source picks different gradients per
precision: on the GPU `floor(7.0 * ns.z)` is 1, in doubles it's 0. Symptom: a
field spiking to ±4.2 (out-of-range gradient indices hit `taylorInvSqrt` far
from its accuracy window) where the GPU stays in ~[-1, 1]. Fix: the gradient
section of `snoise` runs in emulated float32 — `Math.fround` after every op,
because GLSL rounds after every op. Everything else (skew, corner offsets,
falloff) is safe in doubles: those paths are continuous, so a knife-edge
rounding difference costs ~1e-7, not a wrong branch.

**Everything else transliterated cleanly**, including the parts easy to get
subtly wrong: `NORMAL_CHUNK` displaces the two tangent neighbours along the
*centre's* normal (not their own), tangent choice is `cross(n, +Y)` with a +X
fallback at `|n.y| ≥ 0.99`, eps is 0.08, and the fbm octave loop breaks on
`float(i) >= uOctaves` (fractional octaves round up, not down).

## Remaining discrepancies (all verified benign)

- **Input quantization.** The GPU sees float32 coordinates; error between the
  implementations tracks float32 spacing: ~2e-6 at |coord| < 2.5, ~1e-3 at
  ~150. Real sketches (`freq × radius` ≲ 20) sit at ~1e-5. Scaled by `amp`,
  invisible.
- **Exact floor ties.** At points whose *skewed* coordinates land exactly on a
  lattice plane (e.g. coords like n ± 1/3), float32 and float64 resolve the tie
  differently — a measure-zero set; ±1e-9 off the tie the two agree. Surface-
  sampled points hit one with probability zero.
- **The field's own seams.** Stegu's 0.6 falloff radius overreaches the
  simplex, so the *true* field has ~4e-3 value discontinuities at cell
  boundaries. Both implementations have them, same size, same places — this is
  what the GPU renders, not a port error.
- **Instanced noised sources.** An instanced draw seeds the field per copy from
  `instanceMatrix[3]`; sampling computes the seed-zero field, which matches a
  non-instanced draw of the same chain. Sampling a chain that is *itself*
  rendered via `.instance()` has no single surface to match.

## How it was tested (reproduce after editing noise.js / noise-cpu.js)

The method that caught the bug: **a second, independent transliteration.**
Write `SNOISE_GLSL` as literal vec4 math (arrays + swizzle helpers, one line
per GLSL line) with `Math.fround` after every operation, then compare against
production at scale. Agreement bar: ~1e-4 in |coord| < 20 over 200k random
points; a wrong branch or gradient is O(0.1–1), three orders louder. Also
worth asserting: range ⊂ [-1.05, 1.05] and actually filling ±0.7 (range
blowout was the bug's loudest symptom), periodicity on the 289 lattice
(mod289 survival), continuity under 1e-2 (above the true seams, below a
wrong-cell tear), mean ≈ 0. Probe boundaries deliberately — lattice points and
1/6-grid corners — but nudged off exact ties by an *asymmetric* (1, 2, 4)e-3
so no coordinate or sum cancels back onto a plane; symmetric ±ε nudges
recreated exact ties through the skew sum and produced false positives.

For the displacement layer, emulate `NOISE_GLSL`/`NORMAL_CHUNK` from the
shader text in the test itself and require < 1e-9 agreement, plus properties:
displacement exactly along the smooth normal with |d| ≤ amp, amp→0 convergence
of points and normals, pole tangent fallback, fractional octaves, and through
the api: compose order (displace, then source transform), evolution with
`engine.time`, per-frame config caching.

Tests run standalone in node (`node t7.mjs`) from any directory with a
`node_modules` symlink to this repo. api.js needs its relative imports
rewritten to absolute paths and the TTFLoader stubbed (it imports opentype
from a CDN, which node won't load); a `sed` one-liner into a scratch copy
does it. Do **not** verify by screenshotting the canvas.

Perf reference: 900 sample+normal pairs on a noised source = 3,600 fbm
evaluations ≈ 2ms, recomputed per frame only when the source is noised or its
transform is a fn of t.
