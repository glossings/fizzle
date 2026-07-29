# TODO

**When an item is done, delete it from this file.** No "completed" section, no
strikethroughs — a finished item just stops being here. The file is a list of
what's left, not a history of what happened.

Ordered roughly by leverage: the first is a small diff that moves the
chain-instancing look from "partly reachable" to "basically there."

---

## 1. Instance orientation + `path()`

`InstanceHandle` ([src/api.js:177](src/api.js#L177)) exposes only
`pos`/`rotate`/`scale`, and `rotate` is Euler XYZ. Wrapping chain links around a
curve needs a Frenet frame (tangent/normal/binormal), and converting that to
Euler by hand inside a sketch is miserable.

- Add `x.lookAt(x, y, z)` and `x.quat(q)` to the handle — ~15 lines, makes the
  "evil 3D chains" look immediately tractable.
- Add a `path()` helper wrapping `THREE.CatmullRomCurve3`, exposing
  `.getPointAt` / `.getTangentAt`, to make it pleasant rather than merely
  possible.

## 2. `pixelsort()`

A proper sort is an odd-even transposition network: dozens of full-res ping-pong
passes per frame. The machinery exists (`blur` at
[src/tops.js:788](src/tops.js#L788) is already multi-pass) but there's no way to
express *N iterations of the same pass* from a sketch.

Needs a dedicated op with an internal iteration count —
`.pixelsort({ iterations: 48, threshold, angle })`. At 32–64 passes it's
expensive but viable at reduced resolution. Roughly a focused day.

## 3. GPGPU particles

The one item here that's a project rather than a patch.

`.instance(count, fn)` ([src/api.js:272](src/api.js#L272)) has two hard limits:

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
([src/tops.js:571](src/tops.js#L571)) for position precision, plus a
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

- **Dreamcore is there** — see `examples/dreamcore.js`. Shadows (`shadow: true`
  on a light, `.shadow()` to opt geometry out) were the missing piece; the rest
  was already fog, point lights, `model()` for low-poly rooms, PBR tiled
  textures with `repeat` for mismatched carpet, the `text` TOP, feedback trails,
  `pixellate` + `posterize` for a PS1 look, and high-frequency `noise()` comped
  over as film grain.

- **`lookup`** ([src/tops.js:292](src/tops.js#L292)) is a 1D luma LUT — i.e. a
  palette grader, which is most of the "look" battle for both Frutiger Aero and
  dreamcore.
