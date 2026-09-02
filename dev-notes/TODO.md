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

1. **`.read()` + a way to print a pixel.** First, and not because it's the most
   wanted — because everything else on this list is cheaper to build and verify
   once a number in the graph can be looked at. Right now a field that renders
   black is equally "zero", "negative", "NaN" and "never started", and the only
   way to tell them apart is to re-implement the pass chain outside the app.
2. **`.blur(r)` sampling.** A correctness bug that silently rules out every
   iterated-blur sketch, with no symptom except that the result is wrong.
3. **Alpha-0 buses render black**, and **the papercuts** (non-finite uniform
   warn, `camera()` target). Same class as 2 — cheap, and each one removes a
   failure that currently looks like "my maths is wrong".
4. **`.math()` fused op.** The first non-bug: halves the buffer count of any
   arithmetic chain and stops sketches reaching into `_n()`. Do it before
   sub-stepping, since sub-stepping multiplies whatever the per-frame cost is.
5. **Signal ergonomics** — `hash()`, `.since()`, `perFrame()`, the `kicks()`
   detector fix and `.dyn()`. Small, independent, and each one deletes a
   hand-rolled block that sketches currently get subtly wrong.
6. **Bus sub-stepping**, then **target pooling.** With 2 and 4 done, this is
   what turns simulation from a stunt into a feature.
7. **`.glsl()`.** Deliberately after the above, not before. It would paper over
   2, 4 and 6 — anyone hitting those would be told to drop into a shader — and
   the escape hatch is much more valuable once the ops around it are correct.
8. **Everything else**: generators, filters, deformers, particle collision,
   `prose()`, booleans, SDFs. Real features, all announce themselves when
   missing, none of them blocked on the rest.

Most of what follows is "add an operator." That's four edits, and the last two
are the ones easy to forget: the implementation (a `SPECS` entry in
[src/textures.js:79](../src/textures.js#L79) for a texture op, a `buildGeometry` case in
[src/api.js:143](../src/api.js#L143) for geometry), the chain method or `api.js`
export, a `DOCS` entry in [src/docs.js](../src/docs.js) (tooltip says what the call
does and which params exist; per-param detail goes on the param), and the
category strings at [src/docs.js:541](../src/docs.js#L541) that drive completion.

---

## `camera()` has nowhere to put roll or the lens

`camera()` is a position plus a look-at target ([src/api.js:1159](../src/api.js#L1159)),
and the dynamic path re-runs `lookAt` every frame against three's default `up`
of `+Y`. Pan and tilt are therefore reachable by animating the target, and roll
is not reachable at all: anything a sketch writes to `camera.rotation.z` is
overwritten before the next render. A banking camera, a dutch angle, the tilt on
a star-wars crawl — all of it has to be faked by rotating the picture instead
(`scene().rotate(…)`), which swings the frame's own corners in with it.

Roll is the smallest part of this. `fov`, `near` and `far` are missing for the
same reason: the signature is four positional slots with no room left, so every
new camera property would want a call of its own. The engine's camera is a
singleton the sketch aims rather than constructs, which is why it's a bare call
next to `bg()`/`fog()`/`resolution()` and not an op with `.position()` — that
part is right, and a chainable handle would put the API's most-retyped line
(`camera(0, 2, 8)`) behind a constructor. What it needs is a fifth thing to
say, not a different shape.

[ ] **Widen the parse before adding anything to it.** All four spellings
  dispatch on the JS type of a single slot, so they collapse into one flat
  branch and no two can be confused:

  ```
  slot 1 object  -> fully named, camera({ position, target, roll, fov })
  slot 4 array   -> target (what ships today)
  slot 4 number  -> tx, ty, tz, closing the papercut under "Papercuts" below
  slot 4 object  -> options, camera(x, y, z, { target, roll })
  ```

  This is the house style already — `resolution()` and `fog()` are both
  documented as taking either grammar, and `hdri`/`ring`/`constant` all sniff
  slot 1. Note `camera(0, 0.3, 7, [0, 0.2, -14])` has an in-tree caller
  ([sketches/examples/depth-haze.js:43](../sketches/examples/depth-haze.js#L43)),
  so the array form is added to, never replaced.

  Three things to pin before writing it:

  - **The object form is a complete restatement, not a partial patch.** Every
    omitted value takes its default, exactly as the positional form does, so
    `camera({ roll: 0.2 })` snaps back to the default position rather than
    banking in place. Surprising once; the alternative is two grammars with
    different semantics, which is worse. Re-aiming without moving is a real
    gap and genuinely unexpressible today, but it needs its own spelling and
    must not ride in on this.
  - **A Vector3 in slot 1 collides with the config form.** `asVec()` already
    accepts `{x, y, z}` ([src/api.js:190](../src/api.js#L190)), so
    `camera(somePosition)` is a plausible thing to type. Dispatch on the
    presence of `position`/`target`/`roll` keys, not on `typeof === 'object'` —
    the same guard `fog()` uses for `isColor`.
  - **Tolerant parser, narrow docs.** Accept all four, teach one per use case.
    A tooltip that lists every grammar makes a one-line call look like it has
    four modes.

[ ] Then `roll`, in radians and a fn of `t` like the rest: set `camera.up` to
  `[sin(roll), cos(roll), 0]` before the `lookAt`. Five lines, but check what
  it does to orbiting before shipping it — OrbitControls builds its orbit frame
  from `object.up`, so on the *static* path a roll would tilt the whole orbit
  sphere rather than bank the view, which is not what anyone means by it.
  Simplest answer is probably that roll implies the programmed path.

[ ] `fov`, `near`, `far` in the same options object once it exists, each a fn
  of `t` (`updateProjectionMatrix` per frame is free at this rate). A fn `fov`
  is the dolly zoom, which nothing in the API can express today.

## General

[ ] L systems
[ ] Hand tracking?
[x] Fluid solver — `fluid()`, [src/fluid.js](../src/fluid.js). Built as a native
  op rather than out of buses, which is why none of the three simulation items
  below blocked it: the Jacobi loop is a `for` around `runPass` like bloom's
  passes, and the grid is four small targets it owns rather than eighteen
  full-frame ones. Open questions and how to probe them: `fluid()` below.

## `.blur(r)` is only a gaussian at r = 1

The kernel is five fixed gaussian weights whose taps sit at `±r, ±2r, ±3r, ±4r`
texels ([src/textures.js:1298](../src/textures.js#L1298)). At `r = 1` that's a
proper 9-tap gaussian. At `r = 3` it's a *comb*: it samples every third texel
and leaves everything between the taps completely unattenuated. As a look
that's fine — a big soft blur still reads as blurry, because the eye doesn't
audit the stopband. In anything that **iterates** on the blur it is fatal, and
the failure is silent: measured on a difference-of-gaussians feedback loop,
`blur(1)` gives lag-1 pixel correlation +0.81 (smooth labyrinths), `blur(2)`
gives −0.09 and `blur(3)` gives ~0.00 — the loop converges to a one-texel
checkerboard, because "diffusion" that doesn't attenuate high frequencies
amplifies them instead.

That makes every simulation in the graph — reaction-diffusion, fluid, anything
with a laplacian — quietly unbuildable above radius 1, and the workaround
(stacking `blur(1)` calls, since variance adds) costs two full-frame targets per
stack step.

[ ] Scale the tap *count* with the radius rather than the spacing, or run wide
  blurs as a mip pyramid (downsample, blur small, upsample) which is what a
  large-radius blur should be doing anyway and is cheaper than the current pass
  at big radii. Either way `blur(8)` stops being a comb.
[ ] Whatever the fix, say the sampling rule in the tooltip. "Radius in pixels"
  is what it reads as now, and that is not what it does.

## `.edge()` in feedback locked to the texel grid (fixed)

Same disease as the blur comb above, in a different operator: a loop audits its
operator's frequency response, and whatever the operator likes best is all you
get to see. `.feedback(0.4, s => s.edge())` is `source + 0.4 × edge(last)`,
which amplifies exponentially, so the pattern with the highest gain outgrows
everything else within a couple of seconds. Sobel's peak gain varies 8.14% with
edge angle, always favouring the axes, so that pattern was fine horizontal and
vertical stripes at the kernel's 4-texel resonance — every time, on any source.

Classic now runs [4,13,4] scaled by 1/5.25 instead of Sobel's [1,2,1]
([src/textures.js:550](../src/textures.js#L550)). The ratio 2a/b = 8/13
equalizes on-axis and on-diagonal peak gain; the scale is chosen so the response
to a straight edge is exactly Sobel's old 4.0, and peak gain stays 8.0. Measured
across 0–45°, orientation spread goes 8.14% → 0.022%. So a single pass renders
as it always did (diagonals differ by up to 8.9% at most, under a mode that
clips 4x hot), and only iterated loops change: stripes now follow whatever
seeded them, in patches at content angles rather than one global grid.

Deliberately not done: no new mode name. "Use this one inside feedback" is a
defect notice, not a look, and the visible menu stays fat-or-clean. Crisp keeps
Sobel — it normalizes, so the diagonal difference would survive to screen, and
it has no feedback story to fix. Classic slope/normal move to the balanced
weights too, which lands them nearer Scharr's direction accuracy at identical
amplitude.

[ ] `spread > 1` under iteration is still haunted, and no weighting fixes it:
  the taps move to `±spread` texels ([src/textures.js:553](../src/textures.js#L553))
  and leave everything between them unattenuated, exactly the blur comb. Wants
  the same tap-count treatment.

## `.field()` reads the chain through point sampling

The readback copy samples the full-res chain once per field texel
([src/textures.js:2470](../src/textures.js#L2470)), so a high-frequency source —
raw video, fine voronoi — shimmers between texels as it moves. Smooth fields,
which is what layouts mostly want, don't notice.

[ ] A mip step in the copy pass (or read the source through its pyramid) so
  each field texel averages its share of the picture instead of picking one
  sample. Same family as the blur fix above.

## Alpha 0 buses silently render black

A named bus that only ever does arithmetic never acquires coverage: `input()`
on a cold buffer is alpha 0, `math` preserves the left side's alpha, so the
whole loop stays transparent. Then any op that respects coverage multiplies it
away — `.threshold()` ends `vec4(vec3(m), 1.0) * src.a`
([src/textures.js:755](../src/textures.js#L755)), `.tint()` and the comp modes
likewise — and returns black on a field that is numerically fine. Nothing warns;
the sketch just doesn't light up, and the natural next move is to go and retune
the maths that was never wrong.

The workaround is to head the loop with `constant('#000000').add(input(…))`,
which is a whole extra full-frame pass to say "this is opaque".

[ ] `.opaque()` (or `.alpha()` accepting a *set* rather than the multiply it
  currently does — [src/textures.js:852](../src/textures.js#L852)) so there's a
  cheap, findable way to say it.
[ ] Better: `warn()` once when a coverage-respecting op is handed an input whose
  alpha is uniformly 0. Cheap to detect at the node level for the common case
  where the input is a bus that no generator ever fed.

## Papercuts that break a sketch silently

Small, and they matter more here than they would elsewhere: a livecoding sketch
has no stack trace worth reading and no step debugger, so an argument in the
wrong slot has to say so or it costs an hour.

[ ] **An options object in a positional number slot reaches the uniform.**
  `.chroma({ amount: 0.02 })` reads like every other op, but the signature is
  `chroma(amount, o)` ([src/textures.js:1595](../src/textures.js#L1595)), so the
  object lands in `uAmount`, `resolve()` hands it back unchanged and the
  shader gets NaN — the pass then samples at NaN coordinates and the picture
  goes wrong somewhere else entirely, with nothing in the console. Two halves:
  make the numeric params `warn()` when what resolves isn't a finite number
  (one guard in `resolve`, or in `setVec3`/the uniform writers), and let the
  ops that take a single scalar accept `{ amount }` the way `.displace()`
  already does ([src/textures.js:1641](../src/textures.js#L1641)).

[ ] **`camera(x, y, z, tx, ty, tz)` throws from inside the engine.** The target
  is one argument, an array ([src/api.js:1159](../src/api.js#L1159)), and the
  six-number spelling is the natural guess — it dies on `...target` with
  "target is not iterable" and the previous sketch keeps playing, which reads
  as the edit having done nothing. Fixed by the widened parse under
  "`camera()` has nowhere to put roll or the lens" near the top, which takes
  the six-number form as one of its four branches; kept here because it's a
  silent failure today and that's what this section is for.

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
  isn't in ([src/textures.js:2884](../src/textures.js#L2884) allocates it, the
  camera mask does the excluding). Silent-wrong class. Either render depth per
  layer on request (`input('knot', { depth: true })`-ish, or a `depth('knot')`)
  or warn when a layer pull and `depth()` meet in one chain.
[ ] **Fog reaches every layer.** `scene.fog` stays on during layer renders, so
  an overlay layer fogs with the world and can't opt out. A `{ fog: false }`
  on the layer pull (or on `scene({ bg })`'s options, which already exist) is
  the whole feature.
[ ] **One camera.** Every pass looks through the orbit camera
  ([src/textures.js:2935](../src/textures.js#L2935) and the shared pass), so
  there's no picture-in-picture, no fixed-frame overlay while the main view
  orbits, no rendering a shape head-on as a map for a material. The big one;
  probably a second camera as an op a layer pull can name, and worth waiting
  for a sketch that demands it before designing.
[ ] **Environment lights everything.** `scene.environment` reaches every
  material on every layer; three has no per-layer environment, so a stylized
  unlit layer next to a PBR one takes manual material discipline. Cheapest
  honest fix is a docs note; a real one means per-layer material overrides.

## Simulation in the texture graph

A named bus that reads itself (`.out('a')` + `input('a')`) is already a working
integrator, and the cycle semantics are right — a difference-of-gaussians
feedback loop (the classic shape: feedback, two blurs, subtract, clamp)
settles into stable Turing patterns in about thirty frames. Three things stand
between that and it being a feature rather than a stunt, and the blur sampling
above is the first of them:

[ ] **Sub-stepping.** A bus advances exactly one step per rendered frame, so the
  timestep is tied to the display and a sim that wants to settle takes minutes
  of wall clock. `.out('a', { steps: 4 })` — run this bus's chain n times before
  the frame is shown — would decouple them, and is the difference between a
  reaction-diffusion or fluid sketch that is watchable and one that is a
  screensaver. Everything needed is already in the bus loop
  ([src/textures.js:2411](../src/textures.js#L2411)); the work is making
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
  ([src/textures.js:1803](../src/textures.js#L1803)) means an arithmetic-heavy
  chain is priced per operation: a Gray-Scott sketch at 1080×1920 holds
  ~18 half-float targets, about 300 MB, and the only dial is the quality
  slider. Targets whose contents die within a frame (every intermediate that
  isn't published or fed back) could come from a small pool keyed by size. The
  `.math()` fusion above is the cheaper half of the same problem.

[ ] Neither is blocked on the other, and `.glsl()` below is a third way to buy
  the same thing — worth deciding which one lands first rather than doing all
  three.

## `fluid()` — what hasn't been looked at

Every shader compiles, every uniform the JS writes exists in the shader it
writes to, and the projection is checked numerically: `div(grad(p))` matches the
five-point Laplacian to machine precision, and 30 Jacobi iterations from cold
leave 7.6% of the initial divergence. What is *not* settled is how any of it
looks, and three constants are estimates rather than measurements. Two probe
sketches ask about them directly and should be deleted once answered:
`fluid-probe-vorticity`, `fluid-probe-fields`.

**Calibration.**

[ ] The confinement force is `vorticity * 3` ([src/fluid.js](../src/fluid.js)).
  It was 20, which measured out several times stronger than the forces actually
  driving the sim: at `vorticity: 0.5` the confinement force came to ~0.5
  heights/s² against a `.push()` of at most 0.2, so it supplied the motion
  instead of correcting it and the field saturated into even foam a few cells
  across. 3 is sized to make it a correction again and is still a guess.
  `fluid-probe-vorticity` sweeps the knob to place it.
[ ] `VIEW_SCALE` — velocity 2, curl 50, pressure 50 — was never tested against a
  working field: every run of it happened while the curl was dominated first by
  the null space and then by runaway confinement, both of which saturated the
  view. Low stakes now that the fields are diagnostics rather than the thing
  being judged, but the numbers are still guesses.
[ ] `damping` moved from 0.1 to 0.3 so the steady speed lands near the `.push()`
  amount, which is the only thing that makes the two numbers guessable together.
  It also shortens how long an eddy survives once you stop pushing. Check that
  a stir still coasts long enough to read as fluid rather than as friction.

**Fixed, but worth knowing about.**

[x] **The projection had a null space.** div and grad both used central
  differences (straight out of GPU Gems 38), which compose to a stencil reaching
  two cells, while the Jacobi pass inverts the compact five-point Laplacian.
  Solving one operator and applying another leaves the difference in the
  one-cell checkerboard mode, which the loop cannot observe and therefore never
  removes — measured on a 32x32 periodic grid, 4000 Jacobi iterations removed
  only 34% of the initial divergence and then stopped improving. Both operators
  are now compact and adjoint (forward div, backward grad), which composes to
  the Laplacian exactly and removes 98.9%. At the default 30 iterations from
  cold the residual is 7.6%, better in practice because the solve warm-starts.
  Found by `fluid-probe-fields`: the dye never showed it, because bilinear
  advection smooths the mode away, but curl is a high-pass and displayed it at
  full strength. `curl(grad(p))` is 0 for the same stencils, also to machine
  precision, so the projection cannot disturb the curl — which is what makes it
  legitimate for `.curl()` to display the field before the solve rather than
  after.

[ ] Confinement now reads a 3x3 tent-smoothed curl rather than the raw field,
  since it pushes along the gradient of |curl| and that gradient is steepest at
  single-cell noise — raw curl made the force chase the speckle it had just
  created. The displayed `.curl()` stays raw.
[ ] Judge the solver by the dye, not by `.curl()`. Curl is a high-pass with full
  response at Nyquist, so it shows grid-scale content at full strength while the
  dye smooths it away — three rounds of calibration went into an instrument that
  exaggerates the one thing being calibrated. Keep it for diagnosis; use
  `fluid` for whether it looks right.
[x] The one-cell speckle was confinement dominance, not a numerical defect. With
  that and the null space both fixed the dye reads as fluid, which is the bar
  that matters. `fluid-probe-fields` is deleted; what it was measuring is
  settled.

[ ] Velocity is now read as living on each cell's low faces, which is what makes
  the two operators adjoint, but advection still samples it as though it were
  cell-centred. That is a half-cell offset in the lookup — below the bilinear
  interpolation error already there, and it shifts rather than roughens, so it
  is not urgent. Averaging adjacent faces would cost two taps.
[ ] With velocity on faces, free-slip walls are now the natural thing to write
  (zero the normal component at the boundary face, leave the tangential one)
  rather than the special case they were. Folds into the `wrap: 'clamp'` item
  above.

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
on that: buses and feedback allocate by frame size
([src/textures.js:2345](../src/textures.js#L2345)), `uAspect` is the frame's
([src/textures.js:1331](../src/textures.js#L1331)), comp assumes both inputs
cover the frame. One model is per-operator resolution with inheritance, and
three current items are this feature in disguise:

- A texture as a **tile face** wants the face's aspect. A `map: [...]` set
  already gets this: `renderTileSets` renders its sources in a context sized to
  the tile, which is why the train-departures example needs no crop. That's the
  model working, in one private corner — any *ordinary* square material map on
  a square surface still has the problem.
- **`.field()`** renders full-frame and downsamples by point sampling (section
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

## New texture generators

`SPECS` entries take `frag`, plus `extras`/`update()` to declare and resolve
uniforms (numbers or fns of `t`).

[ ] `polygon(sides, { radius, smooth, angle, color, bg })` — filled regular
  n-gon, centered. Mirror `circle()`'s options ([src/textures.js:123](../src/textures.js#L123))
  so the two are interchangeable; `smooth` is the edge falloff, `angle` spins it.
  Measure in the same aspect-corrected space `circle` does (`(vUv - center) *
  vec2(uAspect, 1.0)`), so `polygon(4)` is a true pixel square on any window
  shape — the thing sketches currently can't get without `resolution()` or a
  hand-computed per-axis scale. That also means no separate `rect`: a
  non-uniform `.scale([2, 1], { wrap: 'black' })` stretches the square into any
  rectangle, and with `bg` already black there's no seam at the wrap.
  Pin the `angle` convention before building: 0 should mean flat-bottom, not a
  vertex on +x, so `polygon(4)` lands axis-aligned and `polygon(3)` points up —
  the two orientations sketches actually reach for, with no `Math.PI / 4` in
  the call.
[ ] `checker({ nx, ny, a, b })` — alternating squares. `brick({ nx, ny, offset,
  gap, a, b })` — same but every other row shifted by `offset` (0.5 = running
  bond), `gap` is the mortar line width. Two `ramp({ shape: 'sqr' })` at right
  angles differenced is already a checker (`ramp({ shape: 'sqr' }).comp(ramp({
  angle: Math.PI / 2, shape: 'sqr' }), 'difference')`), so what these buy is
  `nx`/`ny` separately plus the brick offset and mortar.

[ ] `prose(text, { source, font, minSize })` — fill the bright parts of a
  `source` texture with running text: words laid out in reading order, each
  scaled and tinted by the brightness under it, and **never broken** — a word
  that doesn't fit its remaining run gets scaled down or pushed to the next
  one. ASCII art that stays readable as prose.

  Not a filter and not reachable from the ops we have: `text()` draws one
  string on one canvas ([src/textures.js:1875](../src/textures.js#L1875)) and
  nothing in the graph measures or places words. It needs a real layout pass on
  the 2D canvas — walk the brightness field, `measureText` each word against
  the space left, place, advance — which is CPU work per frame, so it wants the
  same "redraw only when the resolved content changes" cache the text generator
  already has. The brightness field has to come back to the CPU too, so it
  either shares whatever `.read()` builds or draws the source into a small
  offscreen canvas itself.

## New texture filters

[ ] `sharpen`, `emboss`, `erode`, `dilate` — all four are 3×3 neighbor
  operations, so add them as `mode`s of the existing `neighbor` spec
  ([src/textures.js:220](../src/textures.js#L220)) behind
  `.edge()`/`.slope()`/`.normalMap()`, not new specs. Erode/dilate take the
  min/max of the neighborhood; emboss is a directional difference plus 0.5.
[ ] `.dither({ mode, levels })` — quantize to `levels` steps per channel, but
  add a threshold offset before rounding so the error scatters instead of
  banding. `mode`: `'bayer2'|'bayer4'|'bayer8'` (ordered, from a constant
  matrix indexed by `gl_FragCoord`), `'random'` (hash of the pixel). Pairs with
  `.posterize()`; `levels: 2` plus a bayer matrix is the classic look.
[ ] `.math({ pow, mul, div, add, sub })` — expose the `math` spec
  ([src/textures.js:495](../src/textures.js#L495)) as one public op. Every slot
  already takes a texture, so one pass can do `a * b + c - d`; spelled with the
  chain methods that is four passes and four full-frame targets, and there is
  no other way to write it. A sketch doing arithmetic in the graph (any
  simulation, any compositing formula) currently reaches
  `._n('math', {...})` — a private method — to get back to one pass. Cheap:
  the spec exists, this is a method and a docs entry.
[ ] `.reorder('bgr')` — permute channels by a 3-or-4 char string of `rgba`.
  Also what a two-species simulation needs: without it, each field needs its
  own grayscale buffer, so "two reaction-diffusion sims competing in R and G"
  costs four full-frame buffers instead of two.
  Repeats allowed, so `'rrr'` broadcasts red to gray — that's the case
  `.mul([1,0,0])` can't do. No separate r/g/b ops.
[ ] `.hueByLuma(amount)` — rotate hue by the pixel's own brightness × `amount`,
  so a grayscale gradient comes out as a spectrum.
[ ] `.convolve(kernel)` — escape hatch taking a flat 9 or 25 element array as a
  3×3/5×5 kernel, normalized unless it sums to 0.
[ ] `.pixelSort({ threshold, dir })` — cheap per frame (one neighbor fetch, same
  as sharpen), but it's an odd–even transposition sort: it converges over many
  frames and must read its own previous output. `bufferId()` supplies the
  self-reference (one call site, one auto-named buffer — `.feedback()` itself is
  no use here, since it comps last frame in rather than handing it over), so
  what's left is the sort pass plus frame parity, which no buffer carries.

## Coordinates

[ ] `.repeat(nx, ny, { mirror, offset })` — `fract(uv * n)`, one texture read,
  identical cells. Distinct from `.tile()`, which renders a pass per distinct
  cell variant so each cell can be its own chain. Document the difference.
[ ] More radial distortions as extra `.warp()` keys ([src/textures.js:392](../src/textures.js#L392))
  rather than new ops — each is a different function applied to the radius
  before resampling: `invert` (1/r, turns the frame inside out), `sqrt`
  (compresses the center, expands the edge), `log`, `ripple` (a sine of r, with
  amplitude and frequency), `magnify` (a lens bubble of a given radius over the
  center).

## New geometry primitives

Each is one `three` constructor wired into `buildGeometry`
([src/api.js:143](../src/api.js#L143)) plus a factory next to `sphere`/`box`
([src/api.js:835](../src/api.js#L835)). Keep the `res` convention the existing
primitives use, since `.noise()` and the deformers need the subdivisions.

[ ] `ring({ inner, outer, res })` — `RingGeometry`, a flat annulus. Held: the
  names went to the texture generators instead (`ring()` next to `circle()`,
  which grew a `thickness`), and a *solid* ring — a hoop with depth, not a
  flat washer — falls out of `cylinder` minus `cylinder` if the booleans below
  land. Revisit after those; if they don't, `RingGeometry` is still five lines.
[ ] `tube({ path, radius, res, closed })` — `TubeGeometry` sweeps a circle along
  a curve. Blocked on the `path()` API below — same question, so settle it once.
[ ] `lathe({ profile, res })` — `LatheGeometry`, surface of revolution. Takes a
  profile as an array of 2-D points or a fn of 0..1 returning `[x, y]`, spun
  about +Y. A wine glass in one call.
[ ] `extrude(path, { depth, bevel, res })` — `ExtrudeGeometry` on a closed 2-D
  outline. `text3d` already drives this ([src/api.js:165](../src/api.js#L165)), so
  the pattern is set; the new part is accepting a user-supplied outline.
[ ] Open call on `cone()`: three does export `ConeGeometry`, but it's literally
  `class ConeGeometry extends CylinderGeometry` with `radiusTop = 0`. Primitive
  by the letter, helper by the spirit.

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
  is built once in `.out()` ([src/api.js:582](../src/api.js#L582)), not per
  frame, so a boolean is just a costlier `buildGeometry` and the existing
  `pointSets` cache keys it the same way. Wants a nested-op shape rather than a
  flat one, since the second operand is a whole chain:
  `cylinder({ radius: 1 }).subtract(cylinder({ radius: 0.8 }))`.

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
[src/audio.js:283](../src/audio.js#L283), where each is attached onto the signal fn.

[ ] `.read(texture, x, y)` — sample one pixel of a texture back down into a signal, so
  an image can drive geometry. `x`/`y` in 0..1, returns luma (or a channel).
  The only GPU→CPU bridge in the app. Real cost: `readRenderTargetPixelsAsync`
  resolves a frame or more late, so the value lags — batch all reads for a
  frame into one call and accept the latency rather than stalling the pipeline.

  Second reason to want it, maybe the bigger one: **there is currently no way
  to find out what a number in the texture graph is.** Anything numeric built
  out of passes — a simulation, a mask, an accumulator — can only be judged by
  looking at it, and a field that reads as black is equally "zero", "negative",
  "NaN" or "never nucleated". One pixel readback plus a `print()` would turn
  that from guesswork into debugging.

[ ] `.since(threshold)` — seconds since this signal last crossed up through
  `threshold`, counting up forever until the next hit. `.counter()` already
  does the edge detection ([src/audio.js:249](../src/audio.js#L249)); this is
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
  whole class of that.

[ ] **`.bandpass(…).kicks()` can never fire, and that's the natural way to
  write a kick detector.** The two signals are on incompatible scales: a bare
  `audio()` is the waveform's linear RMS ([src/audio.js:159](../src/audio.js#L159)),
  while `lowpass`/`highpass`/`bandpass` return the mean of the *normalized dB*
  spectrum ([src/audio.js:168](../src/audio.js#L168)) — with the analyser's
  default −100/−30 dB window that's `(dB + 100) / 70`, which idles near half
  scale whenever anything is playing and moves a few hundredths on a hit.
  `kicks()` tests `e > average × threshold` ([src/audio.js:311](../src/audio.js#L311)),
  and 1.5× of a logarithmic quantity means about +35 dB over the running mean.
  So it triggers on `audio().kicks()` and is silent on
  `audio().bandpass(30, 160).kicks()` — the spelling the docs' own comment
  recommends ("Feed it a band for percussion").

  Fix the detector rather than the band: test `e > avg + threshold × deviation`
  (a running mean absolute deviation is two more lines of the same EMA), which
  is scale-free and works on either input. Worth checking the same question for
  `.counter()` and `.hold()`, which take a threshold in whatever units they're
  handed.

  Same mismatch bites continuous use: `.lowpass(160)` as a control parameter
  idles around 0.5 rather than near 0, so `bass.mul(x)` is a constant offset
  plus a wiggle. A `.dyn()` / `.normalize(window)` chain method — the value's
  distance above its own slow average, rescaled — would be the general answer,
  and every audio-reactive sketch currently hand-rolls it.

[ ] `kicks()` fires a free hit on its first frame
  ([src/audio.js:302](../src/audio.js#L302)): `s.avg` starts at 0 and `dt` is 0,
  so the `e > avg * threshold` test is `e > 0` and any input at all triggers.
  Then the average catches up and a quiet or bass-shy source may never cross
  again — so the sketch flashes once at load and looks broken rather than
  silent. Seed `avg` from the first sample instead of firing on it.

## Draw modes

`.points()`, `.lines()`, `.wire()` and their texture-chain forms shipped; the
line and point shaders take the depth-pass displacement patch
(`applyDisplacementDepth`), which is the one that fits a shader with no
normal chunk.

[ ] Fat lines for `.lines()`: WebGL lines are 1px; `LineSegments2` from the
  addons takes a width, but it's a different vertex layout (instanced
  segments), so the deformer patch would need porting. Only if bloom on 1px
  isn't enough.

## Particles

[ ] `.collide(shape, { bounce, friction })` — the one force particles don't
  have. `force`/`turbulence`/`attract`/`drag` all act on the particle alone
  ([src/particles.js:630](../src/particles.js#L630)); nothing in the system has
  a notion of a surface to stop against, so "sand pouring through a room and
  piling up against a hidden shape" — the whole class of sketches where the
  invisible object is revealed by what settles on it — can't be written at all.

  The honest version wants a distance field to test against, which is the SDF
  item below; a cheap first pass could take only the primitives whose distance
  function is a one-liner (sphere, box, plane) and say so in the tooltip.
  Piling also needs particles to be able to come to rest — a velocity floor and
  enough friction that a settled grain stays settled — or everything jitters
  down the slope forever.

[ ] `.particles()` bakes its emitter surface once, at build
  ([src/particles.js:953](../src/particles.js#L953)). A `model('polyhaven:…')`
  resolves later, so on a cold cache the first run emits from a point and the
  arriving model never repopulates it — the sketch is only correct on the
  second ctrl+enter, with nothing on screen saying so. Rebake when the geometry
  a particle system was built from changes.

## `glsl()` escape hatch

[ ] `.glsl(source)` for a custom fragment pass — the texture-side counterpart to
  exposing `THREE` on the 3D side ([src/docs.js:61](../src/docs.js#L61)). Compile
  the string through the same `SPECS` machinery
  ([src/textures.js:640](../src/textures.js#L640)) so `HEADER`, `vUv` and `tex0` are
  already in scope, and allow a uniforms object whose values take fns of `t`.
  A compile error must `warn()` and pass the input through untouched, never
  throw — see the errors-never-block-playback rule.

  This is where a JS-flavoured `expr((r, g, b) => [...])` went: a closure can't
  run per pixel, so the only honest versions are a CPU-built LUT (1-D per
  channel, or a static 3-D one) or a string of GLSL. The LUT is a smaller
  feature that this one mostly swallows, so it's not worth having both —
  reconsider only if `.glsl()` proves too sharp an edge for sketches.

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
`.material()` has no
`alphaMap`/`alphaTest` at all ([src/materials.js:63](../src/materials.js#L63)).
Poly Haven's foliage models publish an `Alpha` map and now come down through the
model browser, so every plant renders as opaque leaf cards — the one class of
asset there that can't look right.

[ ] `alphaMap` as another map slot plus `alphaTest` (a number, default 0.5 when
  an alpha map is named), and add `Alpha` to `WANTED`
  ([src/polyhaven.js:25](../src/polyhaven.js#L25)) so the map downloads with the
  rest. Cutout only — a discard needs no sorting, so this doesn't wait on
  anything above.

## See-through shadows

`out()` ([src/api.js:373](../src/api.js#L373)) decides `castShadow` from
`transmission > 0 || opacity < 1`, because the depth pass ignores both and would
throw a solid black silhouette. Two problems with the rule as written:

[ ] It resolves function-driven values at t=0 only, so `opacity: t => ...` that
  starts at 1 casts a hard shadow forever, even at 0.05. `applyMaterialScalars`
  ([src/materials.js:161](../src/materials.js#L161)) takes the safer line and treats
  any fn opacity as transparent — match it.

[ ] Proportional shadows are reachable: stochastic discard (kill a fragment with
  probability `1 - opacity` from a screen-space hash) in the same
  `customDepthMaterial` hook `.noise()` already uses, letting the PCF blur
  average the holes into a lighter shadow. Grainy at low `soft`, no caustics,
  but a 50% material would finally drop a 50% shadow.

## Instance orientation + `path()`

`InstanceHandle` ([src/api.js:177](../src/api.js#L177)) exposes only
`pos`/`rotate`/`scale`, and `rotate` is Euler XYZ. Wrapping chain links around a
curve needs a Frenet frame (tangent/normal/binormal), and converting that to
Euler by hand inside a sketch is miserable.

[ ] Add `x.lookAt(x, y, z)` and `x.quat(q)` to the handle — ~15 lines, makes the
  "evil 3D chains" look immediately tractable.

[ ] Add a `path()` helper wrapping `THREE.CatmullRomCurve3`, exposing
  `.getPointAt` / `.getTangentAt`, to make it pleasant rather than merely
  possible.

[ ] `perFrame(fn)` — run `fn(t)` at most once per frame and hand every caller
  the same result. An `.instance()` layout fn is called n times a frame, so
  anything shared between copies (rebuilding a curve, resampling a set of
  signals, computing a common frame of reference) has to be memoized by hand
  with a `let builtAt = -1` and a `t` comparison in every sketch that does it.
  The signals already have exactly this cache internally
  ([src/audio.js:200](../src/audio.js#L200)) — this is that, exposed.

[ ] `.uv(i)` to go with `.sample(i)` / `.normal(i)` — the mesh's own uv at the
  scattered point, which `MeshSurfaceSampler.sample()` already interpolates
  through its unused fourth argument. It's the same "where does copy i live,
  0..1" contract as `grid(...).uv(i)` above, and what lets a `.field()` drive
  copies scattered over *any* surface, not just a grid. Return something
  neutral and warn when the geometry has no uv attribute (some imported
  models).

[ ] A tangent basis to go with `.sample(i)` / `.normal(i)`
  ([src/api.js:419](../src/api.js#L419)) — `.basis(i)` returning the two
  perpendiculars, or just letting `.align()` take a roll. Scattering anything
  that isn't rotationally symmetric over a surface (petals round a flower,
  scales, shingles) needs a direction *in* the tangent plane, and the normal
  alone doesn't give one: the sketch has to cross the normal with an arbitrary
  up vector and special-case the poles where that degenerates.

[ ] `line(points | fn)` as drawable stroke geometry, and instancing *along* a
  path — copies distributed by arc length and oriented to the tangent. Ask
  about the API before implementing: how a path is declared, whether `line()`
  and `path()` are one thing or two, and how the layout fn addresses position
  along the curve.

[ ] `grid(cols, rows, { pitch })` — the structured counterpart of `.sample(i)`'s
  scatter: an index-addressed layout with `.count`, `.pos(i)` (centered, ready
  for `x.position()`) and `.uv(i)` (0..1 — the coordinates a `.field()` sampler
  wants). Every grid sketch re-derives `(col - (cols - 1) / 2) * pitch` and the
  uv normalization by hand — see
  [sketches/examples/train-departures.js](../sketches/examples/train-departures.js), which
  spends half its layout fn on it. Rings and lines are the same item with a
  different shape; decide whether they're options or siblings before building.

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
  now draws once per size, into a target set per size (`ctx.rtKey`,
  [src/textures.js](../src/textures.js) `_rt`/`renderNode`). The state that
  *isn't* keyed that way is still single: `.delay()`'s ring, `ascii()`'s atlas,
  `text()`'s canvas. Sharing one of those between a tile set and an `.out()`
  rebuilds it twice a frame. Per-chain resolution (below) is where this gets
  settled for good; until then the honest stopgap is a warning naming the node.

## `box().noise()` comes apart at the edges

Displacement is `p + n * d * uAmp` along the vertex normal
([src/noise.js:82](../src/noise.js#L82)). `BoxGeometry`
([src/api.js:136](../src/api.js#L136)) stores each of the 6 faces separately, so
the corner at (0.5, 0.5, 0.5) is three vertices with normals +X, +Y and +Z.
Same position means the same `d`, but three different directions — the faces
slide apart and the box reads as falling to pieces rather than deforming. Gap
size scales with `amp`. Sphere and torus are fine: their duplicated seam
vertices share a normal, so the copies move together.

[ ] Bake an averaged displacement direction at build time — weld by position,
  `computeVertexNormals`, scatter the result back over the original vertex
  order as a `dispNormal` attribute — and displace along that in
  `NORMAL_CHUNK`/`DEPTH_CHUNK` while `normal` stays as-is for the tangent
  basis. Seam copies then share one direction. UVs survive, so texture maps and
  PBR are unaffected, and geometry without split normals is unchanged.

  The cheap alternatives are both worse: `mergeVertices` after stripping
  normals/uvs destroys the texture coordinates, and displacing along
  `normalize(position)` fixes the box but changes what noise feels like on
  everything else.
