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
[ ] Some tooltips (like `material`) are really long and a little out of hand. It should be very fast for the user to grok them and understand what they need to type (and if they are going to be super long, they should be scrollable)
[ ] Do we expect `text3d('Glossing', { font: "arial" }).out()` (or "Arial"?) to work?

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
