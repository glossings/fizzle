# TODO

**When an item is done, delete it from this file.** No "completed" section, no
strikethroughs — a finished item just stops being here. The file is a list of
what's left, not a history of what happened.

Ordered roughly by leverage.

## Suggested order

Sections below are grouped by kind, which is not the order to do them in. The
grouping that matters is: **things that fail invisibly, then things that cost
too much, then things that are merely missing.** A missing feature announces
itself — you go to write it, it isn't there, you write something else. A silent
wrong answer costs an afternoon and teaches you nothing, and this list grew by
several entries that were found exactly that way.

1. **A way to print a number out of the graph.** `.field()` landed the GPU→CPU
   bridge, but it reads 8-bit luma clamped to 0..1 — a field that renders black
   is still equally "zero", "negative", "NaN" and "never started". Everything
   else on this list is cheaper to build and verify once a number in the graph
   can be looked at exactly.
2. **Alpha-0 buses render black**, and **the papercuts** (non-finite uniform
   warn, the six-number `camera()`). Cheap, and each one removes a failure that
   currently looks like "my maths is wrong".
3. **`.math()` fused op.** Halves the buffer count of any arithmetic chain and
   stops sketches reaching into `_n()`. Do it before sub-stepping, since
   sub-stepping multiplies whatever the per-frame cost is.
4. **Signal ergonomics** — `hash()`, `.since()`, `perFrame()`, the `kicks()`
   first-frame fix. Small, independent, and each one deletes a hand-rolled
   block that sketches currently get subtly wrong.
5. **Bus sub-stepping**, then **target pooling.** This is what turns composed
   simulation from a stunt into a feature.
6. **Everything else**: generators, filters, deformers, particle collision,
   `prose()`, booleans, SDFs. Real features, all announce themselves when
   missing, none of them blocked on the rest.

Most of what follows is "add an operator." That's four edits, and the last two
are the ones easy to forget: the implementation (a `SPECS` entry in
[src/textures.js:165](../src/textures.js#L165) for a texture op, a `buildGeometry` case in
[src/api.js:245](../src/api.js#L245) for geometry), the chain method or `api.js`
export, a `DOCS` entry in [src/docs.js](../src/docs.js) (tooltip says what the call
does and which params exist; per-param detail goes on the param), and the
category strings at [src/docs.js:1073](../src/docs.js#L1073) that drive completion.

---

## no way to browse the API without leaving the editor

ctrl+space on an empty word now answers with every global grouped under the
headings in `GLOBAL_SECTIONS` ([src/docs.js](../src/docs.js)), and each row's
icon is colored by what the name makes. That covers *I half-remember the name*.
It doesn't cover *I don't remember what exists*: the gesture is invisible, the
popup is ten lines tall, and reading an entry means arrowing onto it one at a
time. The fallback is the docs page, which is another tab and a lost train of
thought mid-set.

[ ] **A palette: one key, the whole catalog, inserted at the cursor.**

  - Grouped by the same `GLOBAL_SECTIONS` the completion list reads, so there
    is one catalog and not two that drift apart.
  - Typing filters names and opening lines both, so `checker` turns up under
    "grid" — the word you have is rarely the name.
  - The row under the cursor shows its entry beside the list — `docDom()`
    already renders one, badge and all — so browsing *is* reading the docs.
  - Enter inserts the canonical call, `circle(` with the cursor inside it;
    esc leaves the sketch untouched.
  - Globals first. Methods have the dot, which is a better gesture than a
    list of 59.

  Two things to settle before writing it: which key (ctrl+p is the sidebar,
  ctrl+a the audio manager, ctrl+r rewind, ctrl+e record), and whether it
  belongs in [src/sidebar.js](../src/sidebar.js) or gets its own overlay the
  way the Poly Haven browser has one.

## `camera()` has nowhere to put roll or the lens

`camera()` is a position plus a look-at target ([src/api.js:1416](../src/api.js#L1416)),
and the dynamic path re-runs `lookAt` every frame against three's default `up`
of `+Y`. Pan and tilt are therefore reachable by animating the target, and roll
is not reachable at all: anything a sketch writes to `camera.rotation.z` is
overwritten before the next render. A banking camera, a dutch angle, the tilt on
a star-wars crawl — all of it has to be faked by rotating the picture instead
(`scene().rotate(…)`), which swings the frame's own corners in with it.

The config form landed for the gamepad work: `camera({ x, y, z, target, pad,
fly })` patches only the keys it names (each falls back to the camera's current
value, not the default) and can hand the rig over to a controller. So the shape
question is half-settled, and settled *against* the restatement semantics —
`camera({ roll: 0.2 })` banking in place is what the shipped grammar implies.
New properties should ride that form.

[ ] Roll, in radians and a fn of `t` like the rest: set `camera.up` to
  `[sin(roll), cos(roll), 0]` before the `lookAt`. Five lines, but check what
  it does to orbiting before shipping it — OrbitControls builds its orbit frame
  from `object.up`, so on the *static* path a roll would tilt the whole orbit
  sphere rather than bank the view, which is not what anyone means by it.
  Simplest answer is probably that roll implies the programmed path.

[ ] `fov`, `near`, `far` in the same config form, each a fn of `t`
  (`updateProjectionMatrix` per frame is free at this rate). A fn `fov` is the
  dolly zoom, which nothing in the API can express today.

[ ] **`camera(x, y, z, tx, ty, tz)` throws from inside the engine.** The target
  is one argument, an array, and the six-number spelling is the natural guess —
  it dies on `...target` with "target is not iterable" and the previous sketch
  keeps playing, which reads as the edit having done nothing. Take slot-4
  number as `tx, ty, tz`; the existing dispatch (object in slot 1 = config,
  array in slot 4 = target) leaves the branch free. One guard while in there:
  `asVec()` accepts `{x, y, z}` ([src/api.js:197](../src/api.js#L197)), so
  dispatch the config form on the presence of its keys, not on
  `typeof === 'object'`, or `camera(somePosition)` lands in the wrong branch.

## General

[ ] Hand tracking?

## `.edge()` `spread > 1` is a comb under iteration

The balanced kernel fixed the axis lock, but `spread` still moves the taps to
`±spread` texels ([src/textures.js:553](../src/textures.js#L553)) and leaves
everything between them unattenuated — the same comb the big-radius `.blur()`
had before it learned to walk its radius in doubling steps
([src/textures.js:1900](../src/textures.js#L1900)). Harmless as a look; fatal in
feedback, where the loop amplifies whatever the operator's stopband lets
through.

[ ] Scale the tap count (or reuse the blur's multi-pass walk) instead of the
  spacing, so a spread edge stops resonating at its own tap distance.

## `.field()` reads the chain through one tap per texel

`.field()` ends a chain as a CPU sampler ([src/textures.js:2898](../src/textures.js#L2898)),
and the chain lands in its small target through a single copy pass
([src/textures.js:4044](../src/textures.js#L4044)) — one bilinear tap per field
texel. A high-frequency source — raw video, fine voronoi — shimmers between
texels as it moves. Smooth fields, which is what layouts mostly want, don't
notice.

[ ] A mip step in the copy pass (or read the source through its pyramid) so
  each field texel averages its share of the picture instead of picking one
  sample. Generator chains have a better answer: render *at* the field's res,
  which is the per-chain resolution item below.

## `.scroll()` hands the callback a signal for `i` where an integer would do

`i` is a signal ([src/textures.js:3065](../src/textures.js#L3065)) because every
variant is built once, when `.scroll()` is called: one chain per parity slot,
and the repeat a slot holds changes as repeats slide through it. So
`i.mul(0.11)` and `i.select(WORDS)`, where `i * 0.11` and `WORDS[i % 6]`
are what anyone writes first, and `.tile()`'s `i` — a plain number — sits
right beside it looking identical. The signal guard catches the coercion, but
the shape is a consequence of the implementation, not of the problem.

Nothing forces it. Numeric params are uniforms, never baked into GLSL, and
three reuses a compiled program for identical source, so a fresh chain per
repeat costs no compile. `repeatCell()`
([src/textures.js:2402](../src/textures.js#L2402)) already knows which repeat
each slot holds on every frame, and since that is deterministic in `t` it
knows the next one too.

[ ] Rebuild a slot's variant at each handoff: call `fn(src, k, phase)` with
  the real integer `k`, swap the new chain into the slot, dispose the old
  one's targets. `phase` stays a signal — it moves continuously within one
  repeat's life, which is what signals are for.
[ ] Build the incoming repeat's variant a frame or two early (its index is
  known ahead), so target allocation never lands on the handoff frame. Until
  targets are pooled this is what keeps a heavy variant from hitching.
[ ] Keep the old node when the new chain's `sigOf` matches the current one
  — the callback ignored `i` — so its targets and any stateful ops survive.
[ ] Stateful ops inside a variant (`.feedback()`, `.delay()`, `.smooth()`)
  restart per repeat rather than persisting across them. Each repeat is its
  own picture, so that reads as correct; say so in the docs.
[ ] Then `i` reads as an integer because it is one, `.tile()` and
  `.scroll()` agree again, and `i.mul` / `i.select` in the docs and the
  example go back to arithmetic and indexing.

## Alpha 0 buses silently render black

A named bus that only ever does arithmetic never acquires coverage: `input()`
on a cold buffer is alpha 0, `math` preserves the left side's alpha, so the
whole loop stays transparent. Then any op that respects coverage multiplies it
away — `.threshold()` ends `vec4(vec3(m), 1.0) * src.a`
([src/textures.js:945](../src/textures.js#L945)), `.tint()` and the comp modes
likewise — and returns black on a field that is numerically fine. Nothing warns;
the sketch just doesn't light up, and the natural next move is to go and retune
the maths that was never wrong.

The workaround is to head the loop with `constant('#000000').add(input(…))`,
which is a whole extra full-frame pass to say "this is opaque".

[ ] `.opaque()` (or `.alpha()` accepting a *set* rather than the multiply it
  currently does — [src/textures.js:1042](../src/textures.js#L1042)) so there's
  a cheap, findable way to say it.
[ ] Better: `warn()` once when a coverage-respecting op is handed an input whose
  alpha is uniformly 0. Cheap to detect at the node level for the common case
  where the input is a bus that no generator ever fed.

## Papercuts that break a sketch silently

Small, and they matter more here than they would elsewhere: a livecoding sketch
has no stack trace worth reading and no step debugger, so an argument in the
wrong slot has to say so or it costs an hour.

[ ] **An options object in a positional number slot reaches the uniform.**
  `.chroma({ amount: 0.02 })` reads like every other op, but the signature is
  `chroma(amount, o)` ([src/textures.js:2553](../src/textures.js#L2553)), so the
  object lands in `uAmount`, `resolve()` hands it back unchanged and the
  shader gets NaN — the pass then samples at NaN coordinates and the picture
  goes wrong somewhere else entirely, with nothing in the console. (`crop` has
  a local guard for exactly this; it's the only one.) Two halves: make the
  numeric params `warn()` when what resolves isn't a finite number (one guard
  in `resolve`, or in `setVec3`/the uniform writers), and let the ops that
  take a single scalar accept `{ amount }`.

## One world per sketch: view and atmosphere aren't per-read

Every render of a frame — the display, `scene()`, `depth()`, every geometry
layer — is a view of one shared world. Membership is scopable (geometry
`.out('name')`, and a light's `.out('name')` restricts it to one layer), and
`scene({ bg })` made the backdrop per-read; the rest of the world state is
still all-or-nothing. None of these need a multi-scene rewrite — the shape
that fits the API is opt-in per-read overrides, defaults unchanged, like
`scene({ bg })` was.

[ ] **`depth()` only sees the display scene.** The depth texture comes from the
  main render, where the camera's layer mask excludes layered meshes — so
  `input('knot').mask(depth(), ...)` quietly masks with a depth map the knot
  isn't in. Silent-wrong class. Either render depth per layer on request
  (`input('knot', { depth: true })`-ish, or a `depth('knot')`) or warn when a
  layer pull and `depth()` meet in one chain.
[ ] **Fog reaches every layer.** `scene.fog` stays on during layer renders, so
  an overlay layer fogs with the world and can't opt out. A `{ fog: false }`
  on the layer pull (or on `scene({ bg })`'s options, which already exist) is
  the whole feature.
[ ] **One camera.** Every pass looks through the orbit camera, so there's no
  picture-in-picture, no fixed-frame overlay while the main view orbits, no
  rendering a shape head-on as a map for a material. The big one; probably a
  second camera as an op a layer pull can name, and worth waiting for a sketch
  that demands it before designing.
[ ] **Environment lights everything.** `scene.environment` reaches every
  material on every layer; three has no per-layer environment, so a stylized
  unlit layer next to a PBR one takes manual material discipline. Cheapest
  honest fix is a docs note; a real one means per-layer material overrides.

## Simulation in the texture graph

A named bus that reads itself (`.out('a')` + `input('a')`) is already a working
integrator, and the cycle semantics are right — a difference-of-gaussians
feedback loop (feedback, two blurs, subtract, clamp) settles into stable Turing
patterns in about thirty frames. With the blur sampling fixed, two things stand
between that and it being a feature rather than a stunt:

[ ] **Sub-stepping.** A bus advances exactly one step per rendered frame, so the
  timestep is tied to the display and a sim that wants to settle takes minutes
  of wall clock. `.out('a', { steps: 4 })` — run this bus's chain n times before
  the frame is shown — would decouple them, and is the difference between a
  reaction-diffusion or fluid sketch that is watchable and one that is a
  screensaver. Everything needed is already in the bus loop
  ([src/textures.js:4036](../src/textures.js#L4036)); the work is making
  `renderNode`'s per-frame memo advance per *step* instead.

  Pin the nesting semantics first — advancing the memo per step is not enough
  on its own. A solver's inner loop has to iterate against *frozen* upstream
  state: pressure relaxes tens of times per frame while the velocity it was
  computed from stands still. If stepping a bus re-evaluates its upstream, and
  that upstream is itself a feedback bus, thirty pressure steps advance the
  velocity thirty times — a sim that is wrong while still looking plausible,
  which is the worst way to be wrong. So `steps` means "iterate this bus n
  times against every other bus's frame-start snapshot", not "run the subgraph
  n times". `fluid()` sidesteps all of this by keeping its loop in JS, and is
  the reference to check a composed solver against once this lands.

[ ] **Buffer cost.** One persistent full-frame target per node with no pooling
  ([src/textures.js:2947](../src/textures.js#L2947)) means an arithmetic-heavy
  chain is priced per operation: a Gray-Scott sketch at 1080×1920 holds
  ~18 half-float targets, about 300 MB, and the only dial is the quality
  slider. Targets whose contents die within a frame (every intermediate that
  isn't published or fed back) could come from a small pool keyed by size. The
  `.math()` fusion above is the cheaper half of the same problem.

[ ] Neither is blocked on the other, and `.glsl()` (which landed) already buys
  some of the same thing — a hand-written pass fuses arbitrary arithmetic into
  one target. Worth deciding how much pooling and `.math()` are still worth
  now that the escape hatch exists.

## `fluid()` — what hasn't been looked at

Every shader compiles, every uniform the JS writes exists in the shader it
writes to, and the projection is checked numerically: `div(grad(p))` matches the
five-point Laplacian to machine precision, and 30 Jacobi iterations from cold
leave 7.6% of the initial divergence. What is *not* settled is how any of it
looks, and three constants are estimates rather than measurements. (The probe
sketches that were built for this are gone — rebuild from
[src/fluid.js](../src/fluid.js)'s field views if a question below needs
measuring rather than eyeballing.)

**Calibration.** Judge the solver by the dye, not by `.curl()`: curl is a
high-pass with full response at Nyquist, so it shows grid-scale content at full
strength while the dye smooths it away. Keep it for diagnosis; use `fluid` for
whether it looks right.

[ ] The confinement force is `vorticity * 3` ([src/fluid.js](../src/fluid.js)).
  It was 20, which measured out several times stronger than the forces actually
  driving the sim, so it supplied the motion instead of correcting it and the
  field saturated into even foam a few cells across. 3 is sized to make it a
  correction again and is still a guess — sweep the knob to place it.
[ ] `VIEW_SCALE` — velocity 2, curl 50, pressure 50 — was never tested against a
  working field: every run of it happened while the curl was saturated by the
  defects since fixed. Low stakes now that the fields are diagnostics rather
  than the thing being judged, but the numbers are still guesses.
[ ] `damping` moved from 0.1 to 0.3 so the steady speed lands near the `.push()`
  amount, which is the only thing that makes the two numbers guessable together.
  It also shortens how long an eddy survives once you stop pushing. Check that
  a stir still coasts long enough to read as fluid rather than as friction.

**Known approximations.**

[ ] Velocity is read as living on each cell's low faces (which is what makes
  div and grad adjoint), but advection still samples it as though it were
  cell-centred. That is a half-cell offset in the lookup — below the bilinear
  interpolation error already there, and it shifts rather than roughens, so it
  is not urgent. Averaging adjacent faces would cost two taps.
[ ] With velocity on faces, free-slip walls are now the natural thing to write
  (zero the normal component at the boundary face, leave the tangential one)
  rather than the special case they were. Folds into the `wrap: 'clamp'` item
  below.

**Correctness, in rough order of how likely it is to matter.**

[ ] **Obstacle boundaries comb.** A disc obstacle frays into regular teeth
  roughly three cells wide where flow grazes it. Two causes stacked:

  - `solid()` is `step(0.5, luma)` ([src/fluid.js](../src/fluid.js)), so a cell
    is either fully solid or fully fluid. A circle on the grid is a staircase
    and flow separates off every step.
  - The mask is resampled to the grid by one bilinear tap in the `m.copy` pass.
    At `res: 320` against a 1500px frame that is a 5:1 minification through a
    2x2 kernel, so `circle()`'s antialiased rim is discarded before the
    threshold sees it. That is what makes the teeth ragged rather than a clean
    stair.

  `res: 640` halves the tooth size and the sim is nowhere near the frame cost,
  so that is the lever in the meantime.

  The cheap fix is to stop binarizing: have `solid()` return coverage rather
  than 0 or 1, so a half-covered cell blocks half. In `FRAG_DIV` and
  `FRAG_PROJECT` the existing `1.0 - solid(...)` already reads as a partial
  damp on the face, and `FRAG_JACOBI`'s `mix(neighbour, centre, solid(...))`
  already reads as a partial mirror, so the shaders barely change — it is the
  threshold that has to go, together with a box-filtered downsample of the mask
  so coverage means something. Cost is a slightly leaky obstacle: a mask thinner
  than a cell would pass some flow rather than stopping it dead, which argues
  for warning when someone hands `.obstacle()` something that thin.

[ ] **Cut cells — the real answer to the above.** Coverage-as-damping is an
  approximation that happens to look better; this is the thing that is actually
  right, and it is what lets a boundary sit *between* grid lines instead of on
  them. Each face carries an open fraction `a` in 0..1 — how much of that face
  the fluid can pass through — and every pass that touches a face weights by it:

  - **Divergence.** Each flux term scales by its face fraction:
    `(a_r * xr - a_l * xl) + (a_t * yt - a_b * yb)`. Replaces the
    `1.0 - max(sc, solid(...))` masking, which is the same idea at one bit.
  - **Jacobi.** This is the part that is genuinely different rather than a
    reweighting. The stencil stops being uniform: the equation becomes
    `sum(a_k * (p_k - p_c)) = div`, so the denominator is `sum(a_k)` rather
    than a hard 4, and each neighbour is weighted by its own face. A closed
    face drops out on both sides, which is the Neumann condition falling out
    of the algebra instead of being special-cased by the `mix(..., solid)`
    trick. Watch for `sum(a_k)` at or near zero in an isolated cell — needs a
    floor, or those cells excluded.
  - **Projection.** The gradient subtracted at each face scales by whether that
    face is open, so a fully closed face leaves its velocity component alone
    rather than zeroing the whole vector per component the way it does now.

  Where `a` comes from matters as much as the solver change. Computing it
  properly means the distance field of the mask, not the mask: with a signed
  distance you get the exact open fraction of each face by linear interpolation
  along it, which is what makes the boundary sub-cell. Deriving it from the
  binary mask instead gets you back roughly to coverage-as-damping. So this
  probably wants `.obstacle()` to accept (or internally build) a distance field
  — which is its own piece of work, and is also what moving obstacles want, so
  the two items are worth planning together rather than in sequence.

  Bonus once `a` exists: it subsumes the wall handling. `wrap: 'clamp'` becomes
  a frame of closed faces rather than the separate `uWalls` branch in
  `FRAG_PROJECT`, and free-slip falls out for free, since closing a face stops
  the normal component and says nothing about the tangential one.

  Not worth starting before the sim has been driven hard in a real set — the
  current boundary is visibly stepped but it is stable, and everything above is
  a solver rewrite in exchange for a look.

[ ] **Moving obstacles drag nothing.** A solid cell that moves leaves the
  velocity behind it exactly as it was, because the obstacle only ever *zeroes*
  velocity — it never imparts its own. `.obstacle(person())` will part a flow
  but won't push one. The fix is to write the mask's frame-to-frame motion into
  the solid cells instead of zeroing them, which needs last frame's mask kept.
[ ] **`wrap: 'clamp'` is no-slip**, not free-slip: the boundary cell holds still,
  so flow sticks to the walls and a drift piles up against them. Free-slip
  (keep the tangential component, zero the normal one) is almost certainly the
  better default for a visual tool, and is a few lines in `FRAG_PROJECT`.
[ ] **Pressure is warm-started and never cleared.** Last frame's solution is the
  next frame's initial guess, which is worth several iterations — but if the
  solve is under-converged the residual has nowhere to go and could accumulate
  over a long set. Watch a sim run for twenty minutes and look for slow drift
  or a creeping grid pattern. The standard hedge is decaying the guess (`× 0.95`)
  before the loop.
[ ] **Half-float pressure at high res.** Thirty Jacobi iterations at `res: 1024`
  in half float is about three decimal digits of headroom. Look for banding or
  a solve that stalls. If it does, only the pressure pair needs to be float32,
  and only above some res.

**Rough edges.**

[ ] `res` as a fn of `t` reallocates the grid every frame, which blanks the sim
  every frame. Either resolve it once at build time or warn.
[ ] `DT_MAX` is 1/30, so below 30fps the sim runs in slow motion rather than
  lurching. That's the right trade for a dropped frame; it may be the wrong one
  for a sketch that simply runs at 24fps. Check on something heavy.
[ ] `fluid()` inside `.tile()` is untested. Each cell claims its own carried
  state and its own grid at the tile's aspect, so it should work, but nine
  sims is nine sets of nine targets and there is no warning about it (compare
  the one `bufferId()` prints past sixteen buffers).
[ ] Once bus sub-stepping lands, build the same solver as a chain and diff it
  against `fluid()`. That is the regression test the composed path otherwise
  never gets, and the reason to have built the native op first.

## Per-chain resolution

Every node renders at the drawing-buffer size, and the pipeline quietly leans
on that: buses and feedback allocate by frame size, `uAspect` is the frame's,
comp assumes both inputs cover the frame. The alternative model is per-operator
resolution with inheritance, and three current items are this feature in
disguise:

- A texture as a **tile face** wants the face's aspect. A `map: [...]` set
  already gets this: `renderTileSets` renders its sources in a context sized to
  the tile, which is why the train-departures example needs no crop. That's the
  model working, in one private corner — any *ordinary* square material map on
  a square surface still has the problem.
- **`.field()`** renders full-frame and downsamples through one tap (section
  above). A chain rendering *at* 64×64 needs no copy pass, and for generator
  sources no mip fix either — the shader evaluated at 64×64 is the right
  answer by construction. (Image/video sources still want minification
  filtering; the mip note stands for those.)
- **Simulations** ("Buffer cost" above) want a 512×512 bus, not eighteen
  full-frame targets.

[ ] `.res(w, h?)` as a chain operator (maybe `{ aspect }` sugar): sources
  default to the frame, every node inherits its first input's size, `.res()`
  re-targets from that point downstream. Pin before building:
  - `uAspect` becomes the *target's* aspect, so a `circle()` on a square
    target is round on the square — correct, and only reachable by asking, so
    existing sketches don't move.
  - Mismatched comp inputs already sample by uv, and neighbor ops' `uTexel`
    already follows the target — both fall out.
  - The fiddly half is buffers that outlive the graph: feedback targets, named
    buses and delay rings all allocate at frame size, keyed by name — size has
    to travel with the publish, and a re-run that resizes a bus must realloc
    without blanking unrelated loops.
  - `text()` already sizes its canvas from the context it renders in, so it
    needs nothing new — what it needs is for that size to be something a chain
    can ask for rather than something only a tile set can arrange.

Two adjacent costs in the tile-set machinery, same neighborhood:

[ ] **A tile set redraws every layer, every frame.** `.material({ map: [...] })`
  renders each source into its layer of the array texture on every frame
  ([src/textures.js](../src/textures.js), `renderTileSets`), because nothing in
  the graph says whether a source moved. A set of 26 letters is 26 passes and a
  pyramid rebuild for a picture that hasn't changed since the sketch ran. A
  source that can say so — `text()` already knows when its canvas is stale,
  `imagefile()` after the first upload — should skip its layer, leaving live
  chains as the only per-frame cost. The dirty bit has to be per node, not per
  set: one moving chain in a set of stills should redraw only itself.

[ ] **Only render targets follow the context a node is rendered in.** A tile set
  renders its sources at the tile's size, so a chain shared with the main graph
  draws once per size, into a target set per size (`ctx.rtKey`,
  [src/textures.js:2952](../src/textures.js#L2952)). The state that *isn't*
  keyed that way is still single: `.delay()`'s ring, `ascii()`'s atlas,
  `text()`'s canvas. Sharing one of those between a tile set and an `.out()`
  rebuilds it twice a frame. Per-chain resolution (above) is where this gets
  settled for good; until then the honest stopgap is a warning naming the node.

## New texture generators

`SPECS` entries take `frag`, plus `extras`/`update()` to declare and resolve
uniforms (numbers or fns of `t`).

[ ] `brick({ nx, ny, offset, gap, a, b })` — `checker()` landed without it:
  alternating cells with every other row shifted by `offset` (0.5 = running
  bond), `gap` the mortar line width.

[ ] `prose(text, { source, font, minSize })` — fill the bright parts of a
  `source` texture with running text: words laid out in reading order, each
  scaled and tinted by the brightness under it, and **never broken** — a word
  that doesn't fit its remaining run gets scaled down or pushed to the next
  one. ASCII art that stays readable as prose.

  Not a filter and not reachable from the ops we have: `text()` draws one
  string on one canvas and nothing in the graph measures or places words. It
  needs a real layout pass on the 2D canvas — walk the brightness field,
  `measureText` each word against the space left, place, advance — which is
  CPU work per frame, so it wants the same "redraw only when the resolved
  content changes" cache the text generator already has. The brightness field
  has to come back to the CPU too — `.field()` is exactly that bridge.

## New texture filters

[ ] `sharpen`, `emboss`, `erode`, `dilate` — all four are 3×3 neighbor
  operations, so add them as `mode`s of the existing `neighbor` spec
  ([src/textures.js:550](../src/textures.js#L550)) behind
  `.edge()`/`.slope()`/`.normalMap()`, not new specs. Erode/dilate take the
  min/max of the neighborhood; emboss is a directional difference plus 0.5.
[ ] `.math({ pow, mul, div, add, sub })` — expose the `math` spec
  ([src/textures.js:640](../src/textures.js#L640)) as one public op. Every slot
  already takes a texture, so one pass can do `a * b + c - d`; spelled with the
  chain methods that is four passes and four full-frame targets, and there is
  no other way to write it short of `.glsl()`. A sketch doing arithmetic in the
  graph (any simulation, any compositing formula) currently reaches
  `._n('math', {...})` — a private method — to get back to one pass. Cheap:
  the spec exists, this is a method and a docs entry.
[ ] `.reorder('bgr')` — permute channels by a 3-or-4 char string of `rgba`.
  `.glsl('texture2D(tex0, vUv).bgra')` covers it mid-set now; this is the
  discoverable spelling, and what a two-species simulation reaches for —
  without it, each field needs its own grayscale buffer. Repeats allowed, so
  `'rrr'` broadcasts red to gray — the case `.mul([1,0,0])` can't do.
[ ] `.hueByLuma(amount)` — rotate hue by the pixel's own brightness × `amount`,
  so a grayscale gradient comes out as a spectrum.
[ ] `.convolve(kernel)` — a flat 9 or 25 element array as a 3×3/5×5 kernel,
  normalized unless it sums to 0. Mostly subsumed by `.glsl()` now — keep only
  if the no-shader spelling earns its docs entry; otherwise delete this item.
[ ] `.repeat(nx, ny, { mirror, offset })` — `fract(uv * n)`, one texture read,
  identical cells. Distinct from `.tile()`, which renders a pass per distinct
  cell variant so each cell can be its own chain. Document the difference.
[ ] More radial distortions as extra `.warp()` keys rather than new ops — each
  is a different function applied to the radius before resampling: `invert`
  (1/r, turns the frame inside out), `sqrt` (compresses the center, expands
  the edge), `log`, `ripple` (a sine of r, with amplitude and frequency),
  `magnify` (a lens bubble of a given radius over the center).

## New geometry primitives

Each is one `three` constructor wired into `buildGeometry`
([src/api.js:245](../src/api.js#L245)) plus a factory next to `sphere`/`box`.
Keep the `res` convention the existing primitives use, since `.noise()` and the
deformers need the subdivisions.

[ ] `ring({ inner, outer, res })` — `RingGeometry`, a flat annulus. Held: the
  names went to the texture generators instead (`ring()` next to `circle()`,
  which grew a `thickness`), and a *solid* ring — a hoop with depth, not a
  flat washer — falls out of `cylinder` minus `cylinder` if the booleans below
  land. Revisit after those; if they don't, `RingGeometry` is still five lines.
[ ] `tube({ path, radius, res, closed })` — `TubeGeometry` sweeps a circle along
  a curve. Unblocked now that `curve()` settles how a path is declared — the
  work is adapting a `curve()` into the `THREE.Curve` the constructor wants.
[ ] `lathe({ profile, res })` — `LatheGeometry`, surface of revolution. Takes a
  profile as an array of 2-D points or a fn of 0..1 returning `[x, y]`, spun
  about +Y. A wine glass in one call.
[ ] `extrude(path, { depth, bevel, res })` — `ExtrudeGeometry` on a closed 2-D
  outline. `text3d` already drives this, so the pattern is set; the new part is
  accepting a user-supplied outline.
[ ] Open call on `cone()`: three does export `ConeGeometry`, but it's literally
  `class ConeGeometry extends CylinderGeometry` with `radiusTop = 0`, and
  `cylinder({ radiusTop: 0 })` is documented. Primitive by the letter, helper
  by the spirit.

## Booleans: `.union()` / `.subtract()` / `.intersect()`

The Blender move — a hoop is a cylinder minus a cylinder, a bead is a sphere
minus a sphere, a chamfer is a box intersected with an octahedron. Every
primitive we'd otherwise hand-write becomes an expression in the two we have.

First, the thing that isn't in the way: **nothing needs filling in.** A
`sphere()` is a shell of triangles with no interior, and that's fine — booleans
don't read an interior, they compute one. What they need is a *closed,
consistently wound* surface, so that "inside" is answerable by counting how
many times a ray crosses it. Our primitives already qualify (sphere, box,
cylinder with its caps, capsule, icosa, torus, `text3d`); `plane()` and an
imported `model()` are the two that may not, and an open shell gives a boolean
nothing to bite on. So a `fill()` op would have nothing to do — the honest
version of that idea is a *validator* that says "this mesh is open, the
boolean will be garbage" instead of returning garbage.

Two routes, and they are not the same feature:

[ ] **Mesh CSG**, via `three-bvh-csg` (0.0.18, peers `three-mesh-bvh` ≥0.9.7 —
  both current against our three 0.185). `Evaluator` + `Brush` in, a new
  `BufferGeometry` out. Fits the architecture almost suspiciously well: geometry
  is built once in `.out()`, not per frame, so a boolean is just a costlier
  `buildGeometry` and the existing `pointSets` cache keys it the same way.
  Wants a nested-op shape rather than a flat one, since the second operand is a
  whole chain: `cylinder({ radius: 1 }).subtract(cylinder({ radius: 0.8 }))`.

  Two things to get straight before writing it:

  - **It sees the undisplaced mesh.** `.noise()` is a vertex-shader patch
    ([src/noise.js](../src/noise.js)), so the CPU geometry never moves —
    subtracting from a noised sphere cuts the smooth one and the displacement
    then rides over the cut. Either document the order (booleans first, noise
    last) or bake via the `noise-cpu.js` twin before evaluating, which is
    already written and already the thing `.sample()` uses.
  - **It can't animate.** Re-evaluating CSG per frame is off the table above a
    few thousand triangles, so operands are static numbers only — the one
    place in the API where a fn of `t` isn't accepted. Worth saying out loud in
    the tooltip.

  Seams are the known cosmetic cost: the cut edge gets its own vertices and no
  smoothing across them, which reads as a hard crease. Usually what you want on
  a chamfer, never what you want on a blend.

[ ] **SDFs**, the version with a real interior — and the one that would actually
  suit a livecoding tool. A signed distance function is defined at every point
  in space, negative inside, so union is `min`, intersection `max`, difference
  `max(a, -b)`, and *smooth* min gives blends mesh CSG cannot express at all.
  All shader-side, so every operand animates for free. The cost is that it's a
  second renderer: a raymarched SDF shares nothing with the mesh pipeline —
  not `.instance()`, not shadows, not `.sample()`, not the deformers — so it's
  a parallel world with its own versions of everything, or a deliberately small
  island (`sdf(...).out()` as its own layer). Big. Note it, don't start it.

[ ] Cheap consolation prize, worth doing either way: `.clip(plane)` on
  `material.clippingPlanes`, plus a stencil cap pass so the cut face reads
  solid instead of showing the inside of the far shell. That's the "cut a
  sphere in half and it looks like a solid object" trick without any geometry
  work at all, and it's maybe forty lines.

## Geometry deformers

Chainable siblings of `.noise()` — same GPU vertex plumbing
([src/noise.js](../src/noise.js)), and each needs the matching CPU version in
[src/noise-cpu.js](../src/noise-cpu.js) so `.sample()`/`.normal()` still land on
the deformed surface. Normals must be recomputed or lighting goes wrong. All
take fns of `t`. Like `.noise()`, they can only move vertices the geometry
already has, so they want `res`.

[ ] `.twist({ amount, axis })` — rotate each vertex about `axis` by its distance
  along that axis.
[ ] `.bend({ amount, axis })` — arc the shape around an axis.
[ ] `.taper({ amount, axis })` — scale cross-sections by position along `axis`
  (a cylinder becomes a cone).
[ ] `.spherify({ amount, radius })` — lerp each vertex toward the sphere of
  that radius; 1 = fully round.
[ ] `.trail(n, { spacing, decay })` — `n` echo copies of a moving mesh at
  earlier positions, `spacing` in seconds. Needs a short history of the chain's
  resolved transform per frame, so it's the one deformer that isn't a vertex
  shader — closer to `.instance()` reading back in time.

## Signals

Chain methods go next to `.smooth()` at
[src/audio.js:440](../src/audio.js#L440), where each is attached onto the
signal fn.

[ ] **A full-precision read, and a place to print it.** `.field()` is the
  GPU→CPU bridge now, but it reads through an 8-bit unsigned-byte target as
  clamped luma — so a field that renders black is still equally "zero",
  "negative", "NaN" and "never started", and anything numeric built out of
  passes (a simulation, a mask, an accumulator) can only be judged by looking
  at it. Wants a float-precision single-pixel read (a float target, or an
  encode pass) plus a `print()`-shaped way to see the number without leaving
  the sketch. This is the top of the suggested order for a reason.

[ ] `.since(threshold)` — seconds since this signal last crossed up through
  `threshold`, counting up forever until the next hit. `.counter()` already
  does the edge detection ([src/audio.js:350](../src/audio.js#L350)); this is
  the other half, and it's what every "restart an animation on the beat" sketch
  hand-rolls in `onFrame` with a latch, a timer and a `Math.min(1, …)`. With
  it, a crossfade on each kick is `kick.since().div(0.6)` and needs no mutable
  state at all.

[ ] `hash(a, b, …)` — deterministic 0..1 from a few integers, exported next to
  `rand()`. `rand()` is a function of `t`; the thing `.instance()` layout fns
  actually need is a function of *index*, and every sketch that wants stable
  per-copy variation writes its own integer hash inline. They are easy to get
  subtly wrong: fold the arguments together before the mix and neighbouring
  seeds differ by a constant, which shows up as a "random" arrangement that
  alternates between two poses. One good 32-bit mixer in the API removes a
  whole class of that ([src/curve.js:264](../src/curve.js#L264) already has a
  private one to promote or replace).

[ ] `kicks()` fires a free hit on its first frame
  ([src/audio.js:421](../src/audio.js#L421)): `s.avg` starts at 0 and `dt` is 0,
  so anything above `floor` at load triggers. Then the average catches up and a
  quiet or bass-shy source may never cross again — so the sketch flashes once
  at load and looks broken rather than silent. Seed `avg` from the first sample
  instead of firing on it.

[ ] Re-audit `kicks()` against the reworked scales. The analysis that used to
  live here (linear RMS vs normalized-dB bands making `bandpass().kicks()`
  unable to fire) predates the audio overhaul: `audio()` is now dB-mapped
  ([src/audio.js:184](../src/audio.js#L184)) and bands normalize by their meter
  anchors, which also covers the old "`.lowpass()` idles at half scale as a
  control value" complaint. What survives is the principle: the detector tests
  `e > avg × threshold`, which is scale-sensitive, and the scale-free form
  (`e > avg + threshold × deviation`, a running mean absolute deviation being
  two more lines of the same EMA) works on any input. Measure whether
  `.bandpass(30, 160).kicks()` — the spelling the docs recommend — actually
  fires on real percussion before deciding.

## Draw modes

[ ] Fat lines for `.lines()`: WebGL lines are 1px; `LineSegments2` from the
  addons takes a width, but it's a different vertex layout (instanced
  segments), so the deformer patch would need porting. Only if bloom on 1px
  isn't enough.

## Particles

[ ] `.collide(shape, { bounce, friction })` — the one force particles don't
  have. `force`/`turbulence`/`attract`/`drag` all act on the particle alone
  ([src/particles.js:642](../src/particles.js#L642)); nothing in the system has
  a notion of a surface to stop against, so "sand pouring through a room and
  piling up against a hidden shape" — the whole class of sketches where the
  invisible object is revealed by what settles on it — can't be written at all.

  The honest version wants a distance field to test against, which is the SDF
  item above; a cheap first pass could take only the primitives whose distance
  function is a one-liner (sphere, box, plane) and say so in the tooltip.
  Piling also needs particles to be able to come to rest — a velocity floor and
  enough friction that a settled grain stays settled — or everything jitters
  down the slope forever.

[ ] `.particles()` bakes its emitter surface once, at build. A
  `model('polyhaven:…')` resolves later, so on a cold cache the first run emits
  from a point and the arriving model never repopulates it — the sketch is only
  correct on the second ctrl+enter, with nothing on screen saying so. Rebake
  when the geometry a particle system was built from changes.

---

## More asset providers

Poly Haven is the only source the browser searches, and it's about 1500 assets.
Note first, so it doesn't get re-asked: **there is no non-CC0 corner of Poly
Haven to unlock.** The whole site is CC0, the API carries no license field, and
[loadIndex](../src/polyhaven.js#L72) applies no filter — a "search non-CC0 too"
toggle would return the same results. More assets means a second provider.

[ ] **ambientCG** — ~2000 CC0 materials, so no license UI either. Two things
  make it more than a second `loadIndex`, both checked against the live API:

  - **The index has no CORS.** `ambientcg.com/api/v2/full_json?type=Material`
    answers 200 but sends no `access-control-allow-origin`, with or without an
    `Origin` header. Nor does `ambientcg.com/get?file=…`, which 302s to a
    Backblaze host. The CDN it lands on
    (`acg-download.struffelproductions.com`) *does* reflect the origin, so the
    bytes are reachable from a browser — it's the index and the redirect hop
    that aren't. Needs a proxy, which Poly Haven let us skip entirely.
  - **Downloads are zips, not maps.** One archive per resolution holding every
    channel: `Ground108_2K-JPG.zip` is 32 MB, the 4K is 114 MB. Against
    [pickMaps](../src/polyhaven.js#L89), which pulls the five files a material
    actually uses. So this wants an unzip in the browser (fflate is ~10 KB) and
    the transfers are several times larger for the same result.

  Both are tractable; neither is the drop-in the CC0 overlap suggests. The
  naming maps cleanly at least — ambientCG's `_Color`/`_NormalGL`/`_Roughness`
  are our `diff`/`nor_gl`/`rough`, so [WANTED](../src/polyhaven.js#L27) and
  everything downstream of it stays as it is.

[ ] **Sketchfab** — the only reason to reach past CC0, and the one place a
  use-at-your-own-risk toggle would mean something. Big model library, genuinely
  mixed licensing: mostly CC-BY (attribution required), some CC0, some
  royalty-free-but-not-redistributable. Verify before building — an API token is
  needed for downloads, which breaks the "open the browser, click a thing"
  shape; download URLs are short-lived, which is fine since we store the bytes;
  and the attribution obligation lands on whoever shares the sketch, which
  nothing in our media store currently has anywhere to record. That last one is
  the actual design question, not the API work: a `polyhaven:`-style tag says
  where a file came from, but not who must be credited for it.

## Someday: OSC input

`midi()` and `gamepad()` landed; OSC didn't, because a browser can't receive
UDP and so it needs a bridge process running outside the page. Scoped in
[OSC.md](OSC.md) — the sketch-side API is the easy half.

## Cutout alpha on materials

Distinct from the texture pipeline's alpha (which landed — premultiplied
end to end, `bg: null`, alpha-aware comp, stacked outs), and much smaller:
`.material()` has no `alphaMap`/`alphaTest` at all
([src/materials.js](../src/materials.js)). Poly Haven's foliage models publish
an `Alpha` map and come down through the model browser, so every plant renders
as opaque leaf cards — the one class of asset there that can't look right.

[ ] `alphaMap` as another map slot plus `alphaTest` (a number, default 0.5 when
  an alpha map is named), and add `Alpha` to `WANTED`
  ([src/polyhaven.js:27](../src/polyhaven.js#L27)) so the map downloads with the
  rest. Cutout only — a discard needs no sorting, so this doesn't wait on
  anything above.

## See-through shadows

`out()` decides `castShadow` from `transmission > 0 || opacity < 1`
([src/api.js:937](../src/api.js#L937)), because the depth pass ignores both and
would throw a solid black silhouette. Two problems with the rule as written:

[ ] It resolves function-driven values at t=0 only, so `opacity: t => ...` that
  starts at 1 casts a hard shadow forever, even at 0.05. `applyMaterialScalars`
  ([src/materials.js:26](../src/materials.js#L26)) takes the safer line and
  treats any fn opacity as transparent — match it.

[ ] Proportional shadows are reachable: stochastic discard (kill a fragment with
  probability `1 - opacity` from a screen-space hash) in the same
  `customDepthMaterial` hook `.noise()` already uses, letting the PCF blur
  average the holes into a lighter shadow. Grainy at low `soft`, no caustics,
  but a 50% material would finally drop a 50% shadow.

## Layout and instancing helpers

`curve()`/`spread()` and the handle's `.align(v)`/`.between(a, b)` landed, so
riding and orienting along a path works. What's left is the shared-work and
addressing conveniences around them:

[ ] `perFrame(fn)` — run `fn(t)` at most once per frame and hand every caller
  the same result. An `.instance()` layout fn is called n times a frame, so
  anything shared between copies (rebuilding a curve, resampling a set of
  signals, computing a common frame of reference) has to be memoized by hand
  with a `let builtAt = -1` and a `t` comparison in every sketch that does it.
  The signals already have exactly this cache internally — this is that,
  exposed.

[ ] `.uv(i)` to go with `.sample(i)` / `.normal(i)`
  ([src/api.js:503](../src/api.js#L503)) — the mesh's own uv at the scattered
  point, which `MeshSurfaceSampler.sample()` already interpolates through its
  unused fourth argument. It's what lets a `.field()` drive copies scattered
  over *any* surface, not just a grid. Return something neutral and warn when
  the geometry has no uv attribute (some imported models).

[ ] A tangent basis to go with `.sample(i)` / `.normal(i)` — `.basis(i)`
  returning the two perpendiculars, or just letting `.align()` take a roll.
  Scattering anything that isn't rotationally symmetric over a surface (petals
  round a flower, scales, shingles) needs a direction *in* the tangent plane,
  and the normal alone doesn't give one: the sketch has to cross the normal
  with an arbitrary up vector and special-case the poles where that
  degenerates.

[ ] `grid(cols, rows, { pitch })` — an index-addressed layout with `.count`,
  `.pos(i)` (centered, ready for `x.position()`) and `.uv(i)` (0..1 — the
  coordinates a `.field()` sampler wants). `layout()` landed but is
  cursor-driven; every grid sketch still re-derives
  `(col - (cols - 1) / 2) * pitch` and the uv normalization by hand — see
  [sketches/examples/train-departures.js](../sketches/examples/train-departures.js),
  which spends half its layout fn on it. Rings and lines are the same item with
  a different shape; decide whether they're options or siblings before
  building.

[ ] `line(points | fn)` as drawable stroke geometry. `curve()` settles how a
  path is declared and hands out points and tangents; what's missing is drawing
  one directly — today the spelling is `spread(n).map(c)` through
  `data().link()`, which works but says nothing about width or arc length.
  Decide whether this is a geometry op or sugar over that pipeline before
  implementing.

## `box().noise()` comes apart at the edges

Displacement runs along the vertex normal ([src/noise.js](../src/noise.js)).
`BoxGeometry` stores each of the 6 faces separately, so the corner at
(0.5, 0.5, 0.5) is three vertices with normals +X, +Y and +Z. Same position
means the same displacement amount, but three different directions — the faces
slide apart and the box reads as falling to pieces rather than deforming. Gap
size scales with `amp`. Sphere and torus are fine: their duplicated seam
vertices share a normal, so the copies move together.

[ ] Bake an averaged displacement direction at build time — weld by position,
  `computeVertexNormals`, scatter the result back over the original vertex
  order as a `dispNormal` attribute — and displace along that in
  `NORMAL_CHUNK`/`DEPTH_CHUNK` while `normal` stays as-is for the tangent
  basis. Seam copies then share one direction. UVs survive, so texture maps and
  PBR are unaffected, and geometry without split normals is unchanged. (The
  uv-weld machinery `.displace()` grew is the pattern to copy — same problem,
  one attribute over.)

  The cheap alternatives are both worse: `mergeVertices` after stripping
  normals/uvs destroys the texture coordinates, and displacing along
  `normalize(position)` fixes the box but changes what noise feels like on
  everything else.
