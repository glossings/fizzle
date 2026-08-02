# TODO

**When an item is done, delete it from this file.** No "completed" section, no
strikethroughs — a finished item just stops being here. The file is a list of
what's left, not a history of what happened.

Ordered roughly by leverage.

Most of what follows is "add an operator." That's four edits, and the last two
are the ones easy to forget: the implementation (a `SPECS` entry in
[src/tops.js:72](src/tops.js#L72) for a TOP, a `buildGeometry` case in
[src/api.js:143](src/api.js#L143) for geometry), the chain method or `api.js`
export, a `DOCS` entry in [src/docs.js](src/docs.js) (tooltip says what the call
does and which params exist; per-param detail goes on the param), and the
category strings at [src/docs.js:541](src/docs.js#L541) that drive completion.

---

## General

[ ] Check user-friendliness of the code

## Installed fonts don't work

`{ font: 'arial' }` always fails. `loadLocalFont`
([src/api.js:48](src/api.js#L48)) guards on `navigator.queryLocalFonts`, but the
API is `window.queryLocalFonts()` — a bare global. So the guard is always
`undefined`, the local path never runs, and it falls through to Google Fonts,
which has no Arial. Verified: `Arial.ttf` parses fine through opentype.js 2.0
once the bytes arrive.

[ ] Use the global instead of the `navigator` property.
[ ] Handle the permission prompt's user-activation requirement — reuse the
  pattern at [src/main.js:120](src/main.js#L120) ("press ctrl+enter to allow
  font access") instead of surfacing a bare SecurityError.
[ ] `.ttc` collections throw `Unsupported OpenType signature ttcf` in
  opentype.js — that's Helvetica, Avenir, Courier, HelveticaNeue, LucidaGrande.
  Warn by name, not "not installed".
[ ] Metric-compatible Google fallbacks so named system fonts also work in
  Firefox/Safari and on the deployed build: Arial/Helvetica→Arimo, Times New
  Roman→Tinos, Courier New→Cousine, Georgia→Gelasio, Calibri→Carlito,
  Cambria→Caladea.
[ ] Completion for `font:` — a curated list of the ~20 worth naming live.

## Texture-driven parameters

Every TOP param takes a number or a fn of `t`, never a TOP. Letting a TOP stand
in makes every transform per-pixel modulatable from one change, and makes
`.displace(map, amt)` sugar for `.translate(map)`.

Mechanically: a param that is a TOP becomes an extra input texture on the pass
(`_n(kind, params, extraInputs)`, [src/tops.js:838](src/tops.js#L838), already
does this for `.remap()`/`.displace()`), and the spec's `frag` samples it at
`vUv` instead of reading a uniform.

[ ] Accept a TOP wherever a scalar/vector param is taken — `transform`,
  `kaleido`, `pixellate`, `hue`, `warp`. Each spec needs a uniform-or-texture
  branch; a `#define` per slot keeps the shader from paying for unused ones.
[ ] Settle the channel convention and document it once: two-component slots
  (`translate`) read R/G, scalar slots (`rotate`, `scale`, `hue`) read luma —
  or red, but pick one and apply it everywhere.
[ ] Keep `.displace()` — but as sugar, not its own pass. Point the method at
  the `transform` spec with `mid: 0.5` and delete the `displace` spec
  ([src/tops.js:341](src/tops.js#L341)), which by then is a second shader doing
  what `transform` does. Public name and behavior unchanged, one code path.

  It stays because the API is built this way — `.translate/.rotate/.scale` are
  already sugar over `.transform()`, `.contrast/.saturation/.gamma/.hue` over
  `adjust`, `.edge/.slope/.normalMap` over `neighbor` — and because it is not a
  pure alias: `translate`'s neutral is 0, `displace`'s is `mid: 0.5`. Maps are
  unsigned 0..1, so without the bias a `noise()` map pushes +x/+y only. The
  bias is what makes it wobble both ways.

## Vertex displacement from a TOP

[ ] `.displace(top, { amount, mid })` on a geometry chain — move each vertex
  along its normal by what the texture says at its UV. TOPs already feed
  materials as maps ([src/materials.js](src/materials.js)) but can't move
  vertices. Reuses the `.noise()` vertex machinery — `displacePoint`
  ([src/noise.js:90](src/noise.js#L90)) and the `NORMAL_CHUNK`/`DEPTH_CHUNK`
  hooks ([src/noise.js:116-134](src/noise.js#L116-L134)) — with a texture fetch
  replacing the fbm call, and the same finite-difference normal recomputation. Needs the geometry's `res` raised to have vertices to move, same as
  `.noise()`.
[ ] `.sample()`/`.normal()` can't follow this one — the CPU has no cheap way to
  read the texture. Either warn when a displaced chain is used as a layout
  source, or leave the points on the undisplaced surface and say so in the
  docs. Decide which.

## New TOP generators

`SPECS` entries take `frag`, plus `extras`/`update()` to declare and resolve
uniforms (numbers or fns of `t`).

[ ] `voronoi({ scale, speed, blend, seed, mode })` — scattered feature points,
  each pixel colored by its nearest. `mode`: `'cells'` (flat random color per
  cell), `'distance'` (grayscale by distance to nearest point), `'edges'`
  (bright where the two nearest are equidistant). `blend` softens the cell
  boundaries. `speed` drifts the points over time.
[ ] `constant(color)` — a solid fill, whole frame, one color. Takes a fn of `t`
  like any color slot. The haze recipe at [src/docs.js:41](src/docs.js#L41)
  currently fakes it with a `ramp()` whose two colors are identical.
[ ] `polygon(sides, { radius, smooth, angle, color, bg })` — filled regular
  n-gon, centered. Mirror `circle()`'s options ([src/tops.js:117](src/tops.js#L117))
  so the two are interchangeable; `smooth` is the edge falloff, `angle` spins it.
[ ] `stripes({ freq, shape, speed, polar, a, b })` — a 1-D waveform swept across
  the frame, so it reads as bands. `freq` = bands per frame, `shape` =
  `'sin'|'saw'|'sqr'|'tri'`, `speed` scrolls them, `a`/`b` are the two colors.
  `polar: true` sweeps by angle from center instead of by x, turning the bands
  into a pinwheel.
[ ] `checker({ nx, ny, a, b })` — alternating squares. `brick({ nx, ny, offset,
  gap, a, b })` — same but every other row shifted by `offset` (0.5 = running
  bond), `gap` is the mortar line width.

## New TOP filters

[ ] `sharpen`, `emboss`, `erode`, `dilate` — all four are 3×3 neighbor
  operations, so add them as `mode`s of the existing `neighbor` spec
  ([src/tops.js:213](src/tops.js#L213)) behind
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
  buffer + frame parity; [src/tops.js](src/tops.js) only has last-frame via
  named `.out()` cycles today.

## Coordinates

[ ] `.repeat(nx, ny, { mirror, offset })` — `fract(uv * n)`, one texture read,
  identical cells. Distinct from `.tile()`, which renders a pass per distinct
  cell variant so each cell can be its own chain. Document the difference.
[ ] `.polar()` — resample so x becomes angle and y becomes radius from center.
  `.cartesian()` inverts it. Sandwiching an effect between the two makes it act
  radially: `.polar().translate(0, 0.1).cartesian()` is a tunnel, a `.blur()`
  in between is a radial smear. Keep `.kaleido()` — the mirror fold is the
  effect, not just the coordinate change.
[ ] More radial distortions as extra `.warp()` keys ([src/tops.js:388](src/tops.js#L388))
  rather than new ops — each is a different function applied to the radius
  before resampling: `invert` (1/r, turns the frame inside out), `sqrt`
  (compresses the center, expands the edge), `log`, `ripple` (a sine of r, with
  amplitude and frequency), `magnify` (a lens bubble of a given radius over the
  center).

## New geometry primitives

Each is one `three` constructor wired into `buildGeometry`
([src/api.js:143](src/api.js#L143)) plus a factory next to `sphere`/`box`
([src/api.js:835](src/api.js#L835)). Keep the `res` convention the existing
primitives use, since `.noise()` and the deformers need the subdivisions.

[ ] `capsule({ radius, height, res })` — `CapsuleGeometry`.
[ ] `ring({ inner, outer, res })` — `RingGeometry`, a flat annulus. `disc()` is
  `inner: 0`; decide whether that's worth its own name.
[ ] `tube({ path, radius, res, closed })` — `TubeGeometry` sweeps a circle along
  a curve. Blocked on the `path()` API below — same question, so settle it once.
[ ] `lathe({ profile, res })` — `LatheGeometry`, surface of revolution. Takes a
  profile as an array of 2-D points or a fn of 0..1 returning `[x, y]`, spun
  about +Y. A wine glass in one call.
[ ] `extrude(path, { depth, bevel, res })` — `ExtrudeGeometry` on a closed 2-D
  outline. `text3d` already drives this ([src/api.js:165](src/api.js#L165)), so
  the pattern is set; the new part is accepting a user-supplied outline.
[ ] Open call on `cone()`: three does export `ConeGeometry`, but it's literally
  `class ConeGeometry extends CylinderGeometry` with `radiusTop = 0`. Primitive
  by the letter, helper by the spirit.

## Geometry deformers

Chainable siblings of `.noise()` — same GPU vertex plumbing
([src/noise.js](src/noise.js)), and each needs the matching CPU version in
[src/noise-cpu.js](src/noise-cpu.js) so `.sample()`/`.normal()` still land on
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
[src/audio.js:283](src/audio.js#L283), where each is attached onto the signal fn.

[ ] `.range(lo, hi)` — map 0..1 to lo..hi. `.clamp(lo, hi)` — limit to the
  range, no scaling. Both are `.mul().add()` by hand today, everywhere.
[ ] `mouse()` — pointer position as a signal, normalized -1..1 with 0 at
  center. `mouse('x')` / `mouse('y')` for one axis; also want a `.down` gate.
  Must read from the canvas, and keep working in the projector window
  ([src/projector.js](src/projector.js)).
[ ] `.read(top, x, y)` — sample one pixel of a TOP back down into a signal, so
  an image can drive geometry. `x`/`y` in 0..1, returns luma (or a channel).
  The only GPU→CPU bridge in the app. Real cost: `readRenderTargetPixelsAsync`
  resolves a frame or more late, so the value lags — batch all reads for a
  frame into one call and accept the latency rather than stalling the pipeline.

## `glsl()` escape hatch

[ ] `.glsl(source)` for a custom fragment pass — the TOP-side counterpart to
  exposing `THREE` on the 3D side ([src/docs.js:61](src/docs.js#L61)). Compile
  the string through the same `SPECS` machinery
  ([src/tops.js:599](src/tops.js#L599)) so `HEADER`, `vUv` and `tex0` are
  already in scope, and allow a uniforms object whose values take fns of `t`.
  A compile error must `warn()` and pass the input through untouched, never
  throw — see the errors-never-block-playback rule.

---

## Someday: external control

MIDI and OSC input as signals — a `midi(cc)` / `osc('/path')` alongside
`audio()` and `beat()`, so hardware can drive parameters directly. Big enough
to need its own design pass; noting it here so it isn't forgotten.

## See-through shadows

`out()` ([src/api.js:373](src/api.js#L373)) decides `castShadow` from
`transmission > 0 || opacity < 1`, because the depth pass ignores both and would
throw a solid black silhouette. Two problems with the rule as written:

[ ] It resolves function-driven values at t=0 only, so `opacity: t => ...` that
  starts at 1 casts a hard shadow forever, even at 0.05. `applyMaterialScalars`
  ([src/materials.js:161](src/materials.js#L161)) takes the safer line and treats
  any fn opacity as transparent — match it.

[ ] Proportional shadows are reachable: stochastic discard (kill a fragment with
  probability `1 - opacity` from a screen-space hash) in the same
  `customDepthMaterial` hook `.noise()` already uses, letting the PCF blur
  average the holes into a lighter shadow. Grainy at low `soft`, no caustics,
  but a 50% material would finally drop a 50% shadow.

## Instance orientation + `path()`

`InstanceHandle` ([src/api.js:177](src/api.js#L177)) exposes only
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
([src/noise.js:82](src/noise.js#L82)). `BoxGeometry`
([src/api.js:136](src/api.js#L136)) stores each of the 6 faces separately, so
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
