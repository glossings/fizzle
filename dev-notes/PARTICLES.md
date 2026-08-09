# GPU particles: how they work and where they go

Stage 1 shipped in [src/particles.js](../src/particles.js). This note records
the design it implements, the constraints that shaped it, and the staged plan
for what comes after — written down because "can we do POP-style particles
without compute shaders" was answered *no* once, and the answer is yes, with
this architecture.

## The core trick: state lives in textures

WebGL has no compute shaders. What it has is float render targets, and that's
enough: particle state is stored one texel per particle across two RGBA32F
textures —

- **pos tex** — `xyz` position, `w` age (seconds into this incarnation;
  negative = waiting to be born)
- **vel tex** — `xyz` velocity, `w` this incarnation's lifespan

Each frame a full-screen fragment shader reads both, integrates one Euler step,
and writes both — a single pass, because the two outputs go through MRT
(`WebGLRenderTarget` with `count: 2`). Two such target pairs ping-pong: read A,
write B, swap. Rendering is a `THREE.Points` whose vertex shader fetches its
texel (`aRef` attribute → texture read) and places `gl_Position` from it. The
CPU never sees a particle; JS only writes uniforms.

Costs, for intuition: 1M particles = two 1024² float MRT pairs = 64 MB of
state, and the sim pass shades a megapixel — comparable to one texture op.
The draw call is one, always.

## The chain compiles to one shader

`sphere().particles({...}).turbulence().attract().out()` mirrors how
[noise.js](../src/noise.js) composes GLSL: each force op contributes a snippet
to the force accumulator plus its uniforms, and `.out()` assembles the one
update shader. Ten forces are ten lines in one pass, not ten passes.
Turbulence is curl noise (central differences over three offset `snoise`
fields) — divergence-free, so it swirls without clumping, and it reuses the
same `SNOISE_GLSL` the rest of the app ships.

Per-frame animation goes through uniforms exactly like everywhere else: every
param resolves `fn(t)` on the way in, so `turbulence({ amp: audio() })` costs
nothing extra.

## Geometry is the emitter

The API deliberately has no emitter-shape vocabulary of its own: a shape *is*
the emitter (`torus().particles({...})`), and bare `particles({ pos })` is the
one shape a chain can't express — a point. At `.out()` the source's surface
scatter ([sample.js](../src/sample.js), the same deterministic points
`.sample()` reads) is baked into a small float texture — 4096 positions in one
row, normals in the other — and the spawn branch picks a random site with
`texelFetch`. Points are baked in *local* space and the source's live
transform rides in as a mat4/mat3 uniform each frame (via the same `_xform()`
its own mesh updater uses), so a moving or spinning emitter carries its births
with it without rebaking. `dir: 'out'` means the baked normal — the default
from a shape.

Known gaps, on purpose: the bake reads the surface undeformed (a `.noise()` on
the source moves the drawn shape, not the births — warned), and a model still
parsing at `.out()` falls back to a point until the next run. Both are
one-re-run problems in practice.

This also sets up stage 2's naming for free: `Texture.prototype.particles` is
the same verb on an image — emit from a texture's bright pixels.

## .evolve(): per-life behavior without per-particle cost

`.evolve((p, life, t) => p.size(...).color(...).force(...))` looks like
`.instance()`'s handle pattern, but the fn cannot run per particle — that's
the CPU loop this whole design exists to avoid. The trick: the fn is a pure
curve over `life` (0 birth → 1 death), so it's *sampled* — 128 life positions
per frame, baked into a 128×3 float ramp texture (row 0 color+opacity, row 1
size, row 2 force) read by life fraction: rows 0–1 by the draw shader, row 2
by the *sim* shader as an extra acceleration term, which is how a force gets
to vary over a life. Rebaked every frame so the fn can close over signals; the
bake is ~128 calls and a 6 KB upload, invisible. Each sample's handle starts
at the chain's base look, so the fn only overrides what should change; setting
size anywhere flips a uniform that swaps out the per-particle `[min, max]`
scatter (the shader can't know "the fn would have set it here").

The corollary is honest and documented: `.evolve()` can depend on `life` and
`t` only — never on one particle's position or velocity, which live in
textures the CPU never sees.

(Naming: `.over` was considered and dropped — it reads as the compositing
operator; `modulate` is reserved for hydra-style texture modulation if texture
chains ever grow it.)

## Pool sizing: rate × life, not a count

Sketches say `rate` (births/sec) and `life`; the pool allocates
`ceil(rate × maxLife)` texels — exactly what steady state needs — and `max`
only caps it (default 10k when no rate is given, hard ceiling 1M). A rate the
cap can't sustain warns and caps rather than silently shortening lives.

## Live-coding: the swarm survives re-runs

The state textures are claimed through [carry.js](../src/carry.js)
(`carried('particles', …)`), keyed by call order like every other stateful op.
A re-run disposes and recompiles the update shader (it's cheap, and the chain
may have changed) but adopts the existing textures — so editing `amp: 2` to
`amp: 3` changes the wind mid-flight instead of restarting the show. Changing
`count` resizes the textures, which is necessarily a reset.

The sim step runs inside the mesh's engine updater, which the engine already
skips while paused — pause freezes the swarm for free. `dt` is clamped to
100 ms so a background tab loses time instead of teleporting particles through
one giant force step. Changing the pool size (`rate`/`life`/`max`) reallocates
the textures, which is necessarily a reset.

## Emission without a free list

There is no spawn queue — a texel *is* a particle slot, forever. Each slot
cycles: wait (age < 0, counting up), live (0 ≤ age < life), die (wrap back to
negative). The wait is `max(0, count/rate − life)`, so the pool sustains
exactly the asked-for rate, and the seed pass staggers first births by
`index / rate` so a fresh system ramps in as a stream rather than detonating.
Spawn randomness re-derives from `hash(texel, fract(time))`, so incarnations
differ without storing a seed.

Consequences: a rate past what `max` sustains caps (with a warning), and JS
can't spawn an individual particle at an exact moment — emission is a rate,
not an event. Both are the standard trade of GPU-resident pools.

## Rendering choices

Points with world-unit size (`gl_PointSize` from projection scale / depth),
soft-disc fragment, fade ramps over life. The look verbs share one signature —
one value or two, two meaning birth → death (size, color, opacity all lerp),
with `[min, max]` in a number slot scattering that end per particle.
`depthWrite: false` + unsorted transparency: correct under `'add'`, acceptable
under `'over'`. Dead texels park outside clip space, so they cost zero
fragments. The fragment shader ends with three's tonemapping/colorspace
chunks, which compile to identity when rendering into the linear scene target
— that keeps the dots looking the same whether the sketch is direct-to-canvas
or going through `scene()`.

## What stage 1 deliberately left out

- **Particle–particle forces** (flocking, collision, springs): needs neighbor
  lookup, i.e. spatial hashing in textures. Possible, painful, and field
  forces cover most of the visual vocabulary. Revisit only with real demand —
  or with WebGPU (below).
- **Reading particles back to JS**: a readback stalls the pipeline; the API
  doesn't offer it and shouldn't.
- **Sorting** for correct `'over'` transparency: a GPU bitonic sort is a known
  quantity but multiple passes per frame; `'add'` is the default aesthetic
  anyway.
- **Shadows / lighting / fog** on particles: they're unlit sprites. Lighting
  them (normal from gl_PointCoord, scene lights in the draw shader) is a
  contained stage-3 item if wanted.

## Stage 2 — the video coupling (the differentiator)

This is the differentiator:
every texture the engine already has can drive the sim, because the update
pass can sample anything.

**Shipped: `Texture.prototype.particles`** — the geometry verb on an image:
`person().particles({...})`, births on the texture's bright pixels. How it
lands:

- **Spawn** — rejection sampling in the sim shader: up to 8 hashed-uv taps
  per birth, a tap accepted with probability `luma × alpha` (so brighter
  pixels birth more), gated by `threshold` (default 0.1). All misses — a dark
  frame — re-arms the texel with a short wait instead of spawning, so
  darkness throttles the stream rather than spraying births at random.
- **Mapping** — accepted uvs land on a world-space plane at the origin facing
  +z: `size` (default 4) is its world height, width follows the screen's
  aspect each frame. `dir` defaults to +z (toward the camera) with the usual
  `spread`.
- **Birth color** — the differentiator detail: texture emitters allocate a
  *third* MRT state texture (the aux target; geometry emitters stay at two)
  holding the color of the pixel each particle was born from, written at
  spawn, carried till death. The draw shader uses it unless the chain set
  `.color()` explicitly; under `.evolve()`, the fn's color wins only if it
  actually calls `p.color()` (a flag baked with the ramp). Frozen-at-birth
  rather than live-sampled, so a person stepping away leaves a swarm still
  wearing them.
- **Liveness** — the source chain is registered in `engine.textureMaps`, the
  same registry material-map bindings use, so the texture graph renders every
  frame with no `.out()`. The sim (which runs in the updaters, before the
  texture pass) reads last frame's pixels — one frame of latency nobody sees.

The trap worth remembering: the spawn taps **must** use `textureLod(…, 0.0)`,
never plain `texture()`. Every fragment of the sim pass reads a *random* uv, so
the derivatives between neighbouring fragments are huge and the hardware picks
the top of the mip pyramid — the whole image averaged into a texel. The first
version shipped with `texture()` and rendered a perfectly black screen with no
error: every tap came back at the image's mean brightness, which for text on a
transparent background is ~0.001, so nothing was ever bright enough to be
born. `.displace()` learned the same lesson from the other side (it *wants* a
footprint-matched level, hence `_needsMips`); anything sampling a map at
scattered uvs wants level 0 instead.

Still ahead in stage 2:

- **`.force(texture, { amount })`** — a force field read from a map at the
  particle's projected position: optical-flow pushes (once a flow op exists),
  luma gradients, hand-painted fields.

None of this changes the architecture — it adds sampler uniforms and snippets
to the same compiled shader. The work is in the uv-mapping conventions.

## Stage 3 — richer bodies and motion

- **Trails**: a second, longer ping-pong ring storing recent positions per
  particle; or cheaper, a screen-space `.delay()`-style accumulation, which
  sketches can already fake with `input()` feedback.
- **Mesh particles**: `InstancedMesh` whose instance matrices are built in the
  vertex shader from the state textures (three supports reading textures in
  vertex shaders everywhere we run) — oriented by velocity, lit like geometry.
- **SDF collisions**: floor plane first (`if (pos.y < uFloor) bounce`) — a
  cheap, hugely satisfying `.floor(y, { bounce })` op; then analytic
  primitives matching the geometry API.
- **Velocity-stretched sprites**: classic spark look, needs quads (instanced)
  rather than points.

## The WebGPU question

three's `WebGPURenderer` + TSL has real compute and would express all of this
more directly (TSL node graphs are conceptually POP-like). It's still the
wrong substrate for fizzle today: it means swapping the renderer wholesale,
and Safari/iOS support is only just landing. The chain API above is
renderer-agnostic — if/when the app moves, `particles()` keeps its surface and
swaps its backend. Decision: revisit when three's WebGPU path is the default
for new projects, not before.

## Perf expectations (order of magnitude)

- Desktop dGPU / Apple Silicon: 1M particles fine; turbulence is the heavy op
  (18 snoise per particle per field).
- Laptops/iGPU: 100–300k comfortable.
- Phones: 30–100k; RGBA32F rendering requires `EXT_color_buffer_float`, which
  is effectively universal on WebGL2 hardware.

The no-rate default (a 10k pool) is deliberately conservative; the docs teach
setting `rate` and `life` and letting the pool follow.
