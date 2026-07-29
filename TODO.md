# TODO

**When an item is done, delete it from this file.** No "completed" section, no
strikethroughs — a finished item just stops being here. The file is a list of
what's left, not a history of what happened.

Ordered roughly by leverage: the first is a small diff that moves the
chain-instancing look from "partly reachable" to "basically there."

---

## General

[ ] Check user-friendliness of the code
[ ] Do we expect `text3d('Glossing', { font: "arial" }).out()` (or "Arial"?) to work?
  Completion can't help here yet — `font:` is the one string slot with no list
  behind it (installed fonts need `queryLocalFonts` permission, Google Fonts a
  network call). A curated list of the ~20 fonts worth naming live would do it.

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
