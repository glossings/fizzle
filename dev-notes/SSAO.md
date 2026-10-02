# SSAO — where we stand

Nowhere, deliberately: fizzle has no ambient-occlusion pass for anything —
not meshes, not particles. What supplies crease darkness today:

- **Shadow-mapped lights.** A low light with `shadow: true` raking a surface
  is where creases on particles actually come from, and since `.lit()`
  particles read the same maps `.shadow()` particles write, a swarm shades
  itself — ridges darken valleys. This covers most of what people reach for
  SSAO to get.
- **`aoMap` on PBR materials.** Baked AO from a Poly Haven set (the `arm`
  map) lands per-material. Static, texture-space, meshes only.
- **Distance falloff + fog** doing tonal depth separation.

## Mimicking it with depth() (works today, sketch-level)

`depth()` is a screen-space distance map, and AO's cheapest cousin is a depth
unsharp mask: a pixel sitting *behind* its neighborhood average is in a
crevice. `.sub()` takes a texture, so the whole estimate is chain math:

```js
const d = depth({ near: 2, far: 16 })
const cavity = d.sub(d.blur(24)).mul(4)   // signed: + in creases, − on ridges

scene().sub(cavity).out()
```

Subtracting the signed map darkens concavities *and* rims convexities with a
little light — the sculpted look. For darkening only, gate it first:
`d.sub(d.blur(24)).threshold(0.01, { soft: 0.04 }).mul(0.5)`. Radius (the
blur) sets the AO's scale; `near`/`far` set contrast — keep them tight around
the subject or the whole estimate compresses into a few gray levels.

Honest caveats, all inherent to the trick:

- **It cannot see `'over'`/`'add'` particles** — those don't write depth
  (transparent, unsorted, `depthWrite: false` by design — see PARTICLES.md),
  so `depth()` doesn't know the swarm exists. `.blend('solid')` dots *do*
  write scene depth, so a solid swarm shows up in `depth()` and this trick
  creases it like geometry. Wisp-blend self-occlusion remains `.lit()` +
  `.shadow()`, full stop.
- Screen-space halos at silhouettes (a background pixel next to a foreground
  edge reads as "in a crevice"). Smaller radius, or keep the strength subtle.
- No normal weighting, so it's cavity detection, not real occlusion — flat
  walls near a corner darken evenly rather than by facing.

## If real SSAO is ever wanted

A depth-only AO (Crytek-style multi-tap around each pixel, at half res, with
a bilateral blur) slots naturally into textures.js as a scene-space generator
— `ao({ radius, strength, samples })` beside `depth()`, sharing its depth
render. No normal buffer exists and adding one means a second scene render or
MRT on the main pass; reconstructing normals from depth derivatives is the
usual dodge and is fine at half res. That's a contained op for geometry.

The particle half splits by blend mode: `.blend('solid')` dots already write
scene depth, so they'd fall out of a depth-only AO for free. Wisp blends
(`'over'`/`'add'`) would need a separate half-res density render treated as
soft depth. Until something demands it, the shadow-map route is the answer to
"creases on particles".
