# TODO

**When an item is done, delete it from this file.** No "completed" section, no
strikethroughs — a finished item just stops being here. The file is a list of
what's left, not a history of what happened.

Ordered roughly by leverage.

Most of what follows is "add an operator." That's four edits, and the last two
are the ones easy to forget: the implementation (a `SPECS` entry in
[src/textures.js:79](../src/textures.js#L79) for a texture op, a `buildGeometry` case in
[src/api.js:143](../src/api.js#L143) for geometry), the chain method or `api.js`
export, a `DOCS` entry in [src/docs.js](../src/docs.js) (tooltip says what the call
does and which params exist; per-param detail goes on the param), and the
category strings at [src/docs.js:541](../src/docs.js#L541) that drive completion.

---

## General

[ ] Check user-friendliness of the code
[ ] Investigate issue with certain materials appearing pure white
[ ] Console warnings
* docs.js:581 docs: resolution has no config key "width" to document
* docs.js:581 docs: resolution has no config key "height" to document
* THREE.Clock: This module has been deprecated. Please use THREE.Timer instead.
[ ] Add `mul`, `div` (`pow`?)
[ ] How hard is it to add userland code like

```js
Texture.trail = function (amt) {
  return this.comp(input("__buffer"), "add", amt).out("__buffer");
}
```

## Vertex displacement from a texture

[ ] `.displace(texture, { amount, mid })` on a geometry chain — move each vertex
  along its normal by what the texture says at its UV. Textures already feed
  materials as maps ([src/materials.js](../src/materials.js)) but can't move
  vertices. Reuses the `.noise()` vertex machinery — `displacePoint`
  ([src/noise.js:90](../src/noise.js#L90)) and the `NORMAL_CHUNK`/`DEPTH_CHUNK`
  hooks ([src/noise.js:116-134](../src/noise.js#L116-L134)) — with a texture fetch
  replacing the fbm call, and the same finite-difference normal recomputation. Needs the geometry's `res` raised to have vertices to move, same as
  `.noise()`.
[ ] `.sample()`/`.normal()` can't follow this one — the CPU has no cheap way to
  read the texture. Either warn when a displaced chain is used as a layout
  source, or leave the points on the undisplaced surface and say so in the
  docs. Decide which.

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
[ ] `.chromaKey({ color, tolerance, softness })` — alpha out where the pixel is
  within `tolerance` of `color` in hue/chroma, `softness` feathering the edge.
  `.lumaKey({ level, softness })` — same by brightness. Both differ from
  `.threshold()` in that they produce a *cutout* to comp with, not a B/W image.
[ ] `.reorder('bgr')` — permute channels by a 3-or-4 char string of `rgba`.
  Repeats allowed, so `'rrr'` broadcasts red to gray — that's the case
  `.mul([1,0,0])` can't do. No separate r/g/b ops.
[ ] `.hueByLuma(amount)` — rotate hue by the pixel's own brightness × `amount`,
  so a grayscale gradient comes out as a spectrum.
[ ] `.convolve(kernel)` — escape hatch taking a flat 9 or 25 element array as a
  3×3/5×5 kernel, normalized unless it sums to 0.
[ ] `.pixelSort({ threshold, dir })` — cheap per frame (one neighbor fetch, same
  as sharpen), but it's an odd–even transposition sort: it converges over many
  frames and must read its own previous output. Needs a per-node ping-pong
  buffer + frame parity; [src/textures.js](../src/textures.js) only has last-frame via
  named `.out()` cycles today.

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

## `glsl()` escape hatch

[ ] `.glsl(source)` for a custom fragment pass — the texture-side counterpart to
  exposing `THREE` on the 3D side ([src/docs.js:61](../src/docs.js#L61)). Compile
  the string through the same `SPECS` machinery
  ([src/textures.js:640](../src/textures.js#L640)) so `HEADER`, `vUv` and `tex0` are
  already in scope, and allow a uniforms object whose values take fns of `t`.
  A compile error must `warn()` and pass the input through untouched, never
  throw — see the errors-never-block-playback rule.

---

## Someday: external control

MIDI and OSC input as signals — a `midi(cc)` / `osc('/path')` alongside
`audio()` and `beat()`, so hardware can drive parameters directly. Big enough
to need its own design pass; noting it here so it isn't forgotten.

## Someday: alpha through the texture pipeline

There is no transparency in compositing today. `over` is
`r = L` ([src/textures.js:720](../src/textures.js#L720)) — replace the base, scaled
by `opacity` — and every pass writes `vec4(..., 1.0)` (24 sites). Generators
don't produce alpha either; shapes and text take a `bg` color and mix onto it in
the shader ([src/textures.js:502](../src/textures.js#L502),
[src/textures.js:526](../src/textures.js#L526)), so "what's behind this" is a
parameter of the generator rather than a property of the image.

Real alpha would make `.comp(x, 'over')` mean what it says, let a generator draw
a shape on nothing, and make multiple unnamed `.out()`s stack in code order —
that last one keeps coming up as its own feature request, but without alpha it's
a no-op, since stacking opaque layers just shows the last one.

[ ] Scope, if it's ever worth it: decide the alpha each generator produces and
  what `bg` becomes (probably `bg: null` = transparent), premultiplication
  discipline through blur/feedback/tonemap, and what the display pass does with
  a non-opaque final image. Storage is already there — `makeRT`
  ([src/textures.js:917](../src/textures.js#L917)) is RGBA half-float.
[ ] The cheap partial, if the goal is only overlays: `.out({ mode, opacity })`
  taking a blend mode, so multiple outs stack meaningfully with add/screen/mult
  on opaque images. Duplicates `.comp()`, and costs `.out()` its idempotence — a
  stray leftover one composites instead of being harmlessly overridden.

Not a route to replacing `bg()`. That sets the clear color behind
rasterization and interacts with `fog()`/`hdri()`
([src/api.js:1013](../src/api.js#L1013)); nothing in texture-land can express
"behind the geometry."

## Cutout alpha on materials

Unrelated to the pipeline alpha above, and much smaller: `.material()` has no
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

[ ] `line(points | fn)` as drawable stroke geometry, and instancing *along* a
  path — copies distributed by arc length and oriented to the tangent. Ask
  about the API before implementing: how a path is declared, whether `line()`
  and `path()` are one thing or two, and how the layout fn addresses position
  along the curve.

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
