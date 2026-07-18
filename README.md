# td-livecode

A Hydra-style livecoding environment with a synth-flavored 3D pipeline:
geometry → transform → noise displacement → instancing → lit render, all on a
fullscreen canvas behind a live code editor.

```sh
npm install
npm run dev   # then open http://localhost:5173
```

**Keys:** `ctrl + enter` run the sketch · `ctrl + .` pause/play (camera stays live) · `ctrl + h` hide/show the editor · drag to orbit, scroll to zoom.

**Colors:** every `#rgb`/`#rrggbb` in the code gets a swatch — click it (or the
hex itself, or just type `#`) to open the native color picker (wheel,
eyedropper, RGB sliders). Picks write back into the code and re-render live
while you drag.

## The pipeline

Chains read like a patch network, left to right. Nothing appears until
`.out()`:

```js
sphere({ radius: 1.2, res: 96 })
  .pos(0, t => Math.sin(t), 0)          // any number can be a fn of time
  .scale(1, 2, 1)
  .rotate(0, t => t * 0.3, 0)
  .noise({ amp: 0.4, freq: 2, octaves: 4, speed: 0.5 })
  .instance(60, (i, n, t) => ({ pos: [Math.cos(i), 0, Math.sin(i)] }))
  .material({ color: '#4fd1c5', roughness: 0.3, metalness: 0.5 })
  .out()
```

Re-running a sketch replaces the previous one (Hydra semantics). Every numeric
parameter — positions, noise amplitude, light positions — also accepts
`t => ...` and is re-evaluated per frame, so animation uses the same syntax as
static values.

## Geometry (SOPs)

| op | options (defaults) |
|---|---|
| `sphere` | `radius: 1, res: 64` |
| `box` | `width/height/depth: 1, res: 24` |
| `plane` | `width/height: 10, res: 128` |
| `torus` | `radius: 1, tube: 0.35, res: 48` |
| `torusKnot` | `radius: 1, tube: 0.3, res: 64, p: 2, q: 3` |
| `cylinder` | `radiusTop/Bottom: 0.5, height: 1.5, res: 48` |
| `icosa` | `radius: 1, detail: 8` |

`res` matters for `.noise()` — displacement is per-vertex, so more resolution
means finer detail.

## Chain operators

- `.pos(x, y, z)` / `.rotate(x, y, z)` / `.scale(x, y?, z?)` — transforms; `scale(2)` is uniform.
- `.noise({ amp, freq, octaves, lacunarity, gain, speed })` — GPU fbm simplex
  displacement along vertex normals. `amp` is displacement distance, `freq` is
  spatial frequency, `octaves` (1–8) adds harmonic detail, `lacunarity`/`gain`
  control per-octave frequency/amplitude falloff, `speed` animates the field.
  Normals are recomputed in the vertex shader so lighting stays correct.
- `.instance(count, fn)` — renders as a single `InstancedMesh`. `fn(i, count, t)`
  returns `{ pos: [x,y,z], rot: [x,y,z], scale: n | [x,y,z] }` per copy and runs
  every frame, so instances animate. Each instance seeds the noise field from
  its own position, so copies deform differently.
- `.material({ color, roughness, metalness, emissive, emissiveIntensity, flatShading, wireframe })`
  · `.color(c)` shorthand.
- `.out()` — build it and add it to the scene.

## Lights, camera, scene

```js
ambient(0.2)                                            // intensity, color?
directional({ intensity: 1.5 }).pos(4, 6, 3).out()
point({ color: '#ff5f9e', intensity: 60 }).pos(t => Math.sin(t) * 5, 3, 0).out()
hemi({ sky: '#8899ff', ground: '#332211' }).out()

camera(0, 2, 8, [0, 0, 0])   // position, look-at target
bg('#07070c')
fog('#07070c', 8, 40)        // color, near, far
```

## Escape hatches

- `THREE` — the full three.js namespace is in scope.
- `onFrame(fn)` — register your own `(t, dt) => ...` per-frame callback.

## Layout

- [src/engine.js](src/engine.js) — renderer, scene/patch lifecycle, frame loop, sketch eval
- [src/api.js](src/api.js) — the chainable operator API
- [src/noise.js](src/noise.js) — GLSL simplex fbm + shader injection
- [src/editor.js](src/editor.js) — CodeMirror overlay and keybindings
- [src/main.js](src/main.js) — wiring + the default sketch
