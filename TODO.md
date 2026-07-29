# TODO

**When an item is done, delete it from this file.** No "completed" section, no
strikethroughs — a finished item just stops being here. The file is a list of
what's left, not a history of what happened.

Ordered roughly by leverage: the first is a small diff that moves the
chain-instancing look from "partly reachable" to "basically there."

---

## General

[ ] Check user-friendliness of the cov
[ ] Are we able to add autocomplete for parameters within the config of a method?

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
