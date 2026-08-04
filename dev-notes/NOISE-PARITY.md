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

**snoise was degenerate at an exact three-way ranking tie.** It picks one of six
sub-simplices with `g = step(x0.yzx, x0.xyz)`. GLSL `step` returns 1 at
equality, so when `x0.x == x0.y == x0.z` every comparison passed, `g` was
`(1,1,1)`, and `i1 = min(g.xyz, l.zxy)` collapsed to `(0,0,0)` while
`i2 = max(...)` became `(1,1,1)`: corner 1 duplicated corner 0, corner 2
duplicated corner 3, and the kernel weights came out `[0.6, 0.517, 0, 0]`
instead of `[0, 0.6, 0, 0]`. The point evaluated to ~0.3–0.4 of nonsense in a
[-1, 1] field while every neighbour was fine — `snoise(0,0,0)` returned -0.412
where the surrounding field is ~0. A lone bad *point*, not a seam: 1e-7 either
way and both sides agreed to 1e-6. Nothing saw it unless a vertex landed
exactly on it, which is why it survived so long.

Both files now rank a nudged copy, `x0 + vec3(0.0, 1e-5, 2e-5)`, so the tie is
unreachable; the corner offsets still use the unnudged `x0`. Worst spike over
2197 exact lattice points went 0.41 → 5.6e-13, and over the sphere's axis
vertices across octaves 1–6, lacunarity 2–5 and period 0.5–16, 0.138 → 4.6e-5
(the smooth vertex-to-vertex background is ~1e-3, so it is 20x below what
anything can show). At octaves 8 / lacunarity 10 it is 1.5e-3, but that samples
|coord| ~ 1e7 where float32 spacing is ~1 and the GPU field is meaningless
regardless. The cost: sub-simplex boundaries move by 1e-5, where the field is
continuous anyway — 7 points in 300k changed at all, by at most 1e-3, so no
sketch looks different. `textures.js` shares `SNOISE_GLSL` and is fixed with
it (worst spike on a texel grid 0.41 → 1.2e-3).

**Why `displacePoint` offsets the domain asymmetrically.** `DOMAIN_OFFSET` and
`TIME_DIR` are what keep vertices off those ties. The ranking compares
coordinates against each other, so a single scalar time/seed offset cancels
out of it: the differences stay exactly `(p.x - p.y) * uFreq * lacunarity^i`,
independent of time and seed, and pinned to *object* space. A unit sphere's
pole fan and its ±X/±Z ring vertices sit at differences of exactly 0 and 1, so
any octave whose scale is a whole number ties all three coordinates there.
With the old scalar offset that made `period` 1, 2, 4, 8 (dyadic, so
`freq * lacunarity^i` hits an integer) spike the pole by 0.14 / 0.072 / 0.027 /
0.013 of displacement against a ~0.001 smooth vertex-to-vertex background —
one puckered vertex, in the same place forever, while periods 3, 5, 6, 4.7
measured ~1e-4. Unequal offsets keep the differences off whole numbers; the
skewed time direction stops them drifting onto one. Verified 0 at every axis
vertex for lacunarity 2/2.5/3/4 across periods 0.5–16.

These offsets are now redundant with the nudge above, and are kept as depth:
the nudge fixes the tie for every caller, the offsets keep an object's vertices
from reaching one in the first place. Note that on their own they were not a
complete fix — the offsets' pairwise differences are 3.7, 4.6 and 8.3, so a
lacunarity that clears their denominator re-ties them (lacunarity 5 gives
`4.6 * 5 = 23`, a 0.004 spike at period 2). Dropping them would restore the
pre-fix look of every noised sketch, which is the only reason to.

Symptom if this regresses: one small dimple at a pole or on the ±X/±Z equator
of a noised sphere, not moving as the noise animates, at dyadic `period`.

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
  what the GPU renders, not a port error. Distinct from the three-way ranking
  tie above, which is ~100x louder and confined to single points.
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

To check vertices are still off the ranking ties, measure the spike directly:
`|d(p) - (d(p-e) + d(p+e)) / 2|` with e ~ 1e-7 along a tangent is immune to
slope and curvature, so anything it reports is the centre point evaluating
differently from its own neighbourhood. Read it at ±X/±Y/±Z over a range of
times, periods and lacunarities; 0 is the expected answer, and the same
measure returns 0.14 on the pre-fix field. Comparing `|d(p-e) - d(p+e)|`
alongside it separates the two failure modes: sides that disagree are a seam,
sides that agree around a wrong centre are a tie. Do *not* judge this by
per-vertex deviation from the neighbour mean — at a pole fan that metric
reports the field's own slope times the ring distance (~0.006 here) whatever
the field does, which is how the tie first got mistaken for a crease. If you
use it anyway, sweep the resolution: smooth content halves as the mesh
doubles, a defect doesn't.

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
