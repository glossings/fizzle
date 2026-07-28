# TODO

**When an item is done, delete it from this file.** No "completed" section, no
strikethroughs — a finished item just stops being here. The file is a list of
what's left, not a history of what happened.

Ordered roughly by leverage: the first three are small diffs that between them
move CRT/glitch and the chain-instancing look from "partly reachable" to
"basically there."

---

## 1. `chroma()` and `warp()` TOPs

Two missing primitives, ~50 lines of SPEC total in [src/tops.js](src/tops.js).

- **`chroma(amount, { radial })`** — per-channel UV offset. Every filter
  currently samples all channels at one UV, so chromatic aberration is not
  expressible at all. Pays off across CRT, glitch, *and* Frutiger Aero glass.
- **`warp({ barrel, twist, zoom })`** — radial UV warp. `displace` can't do this
  because there's no way to *generate* a radial vector field
  (`noise({ channels: 2 })` gives noise, not a radial gradient). This is the one
  thing standing between the current toolkit and a five-line CRT sketch —
  scanlines (tiled ramp multiply), phosphor (`pixellate`) and glow (`bloom`)
  already work.

## 2. Instance orientation + `path()`

`InstanceHandle` ([src/api.js:177](src/api.js#L177)) exposes only
`pos`/`rotate`/`scale`, and `rotate` is Euler XYZ. Wrapping chain links around a
curve needs a Frenet frame (tangent/normal/binormal), and converting that to
Euler by hand inside a sketch is miserable.

- Add `x.lookAt(x, y, z)` and `x.quat(q)` to the handle — ~15 lines, makes the
  "evil 3D chains" look immediately tractable.
- Add a `path()` helper wrapping `THREE.CatmullRomCurve3`, exposing
  `.getPointAt` / `.getTangentAt`, to make it pleasant rather than merely
  possible.

## 3. TOPs as texture maps on geometry

Current asymmetry: `input('name')` is TOP-only, and geometry can't consume a TOP
at all. [src/materials.js](src/materials.js) already accepts a raw
`THREE.Texture` as an escape hatch, but there's no way to get a TOP's output
texture out of the graph.

Expose it — `.material({ map: scene().kaleido(6) })`. Nearly free given the
existing render-target plumbing, and it opens a whole category: chains wrapping
an actual screen showing video feedback, CRT geometry, textured layers.

## 4. Depth buffer as a TOP source

`makeRT` sets `depthBuffer: false` ([src/tops.js:452](src/tops.js#L452)), so
there's no depth-of-field, no depth-graded haze, no SSAO.

Expose a `depth()` source alongside `scene()`. Serves dreamcore (depth haze in
liminal spaces) and Frutiger Aero (DOF on glass) at once. Medium effort.

## 5. Shadow maps

No `castShadow` anywhere in the codebase — shadows are entirely absent. This is
dreamcore's remaining gap: the dread is largely a harsh light source throwing
long shadows down a corridor.

Enable `renderer.shadowMap`, add opt-in flags on lights and geometry. Medium
effort, mostly because shadows interact with the geometry-layer system in
[src/tops.js](src/tops.js).

## 6. `pixelsort()`

A proper sort is an odd-even transposition network: dozens of full-res ping-pong
passes per frame. The machinery exists (`blur` at
[src/tops.js:855](src/tops.js#L855) is already multi-pass) but there's no way to
express *N iterations of the same pass* from a sketch.

Needs a dedicated op with an internal iteration count —
`.pixelsort({ iterations: 48, threshold, angle })`. At 32–64 passes it's
expensive but viable at reduced resolution. Roughly a focused day.

## 7. GPGPU particles

The one item here that's a project rather than a patch.

`.instance(count, fn)` ([src/api.js:250](src/api.js#L250)) has two hard limits:

1. **CPU-bound.** The callback runs per-instance per-frame in JS, then composes
   a matrix and writes 16 floats — realistically ~5–10k instances before it eats
   the frame budget. native tools do millions.
2. **Stateless.** `fn(x, i, count, t)` is a pure function of time. No
   integration, no velocity, no forces, no birth/death, no collisions. Faking
   state via `onFrame` + a closure runs straight back into limit 1.

The full-scale version means particle state in float textures, a sim pass ping-ponging
position/velocity, and a vertex shader sampling that texture to render.

The encouraging part: **the TOP graph is already the right substrate.**
Ping-pong render targets, named buses, per-frame graph evaluation — it's all
there. The natural design is "particles are a texture": a sim chain publishes
state to a named bus, and a `points('bus')` renderer draws it. Conceptually
clean and idiomatic to what's already built.

Needs RGBA32F targets instead of the current `HalfFloatType`
([src/tops.js:452](src/tops.js#L452)) for position precision, plus a
points/sprite render path that doesn't exist yet.

---

## Notes on things that already work

Kept here so they don't get re-investigated:

- **Datamosh** is closer than it looks. No real codec motion vectors, but the
  perceptual signature — previous frame smeared along a motion estimate — is
  reachable today with the named-bus system:

  ```js
  scene().out('src')
  input().displace(s => s.slope(), 0.03).comp(input('src'), 'over', 0.08).out()
  ```

  A better version would frame-difference to drive the displacement amount; the
  wiring already supports it.

- **Dreamcore is ~80% there** without any of the above: fog, point lights,
  `model()` for low-poly rooms, PBR tiled textures with `repeat` for mismatched
  carpet, the `text` TOP, feedback trails, `pixellate` + `posterize` for a PS1
  look, and high-frequency `noise()` comped over as film grain.

- **`lookup`** ([src/tops.js:262](src/tops.js#L262)) is a 1D luma LUT — i.e. a
  palette grader, which is most of the "look" battle for both Frutiger Aero and
  dreamcore.
