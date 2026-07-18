# td-livecode

A Hydra-style livecoding environment with a synth-flavored 3D pipeline:
geometry → transform → noise displacement → instancing → lit render, all on a
fullscreen canvas behind a live code editor.

```sh
npm install
npm run dev   # then open http://localhost:5173
```

**Keys:** `ctrl + enter` run the sketch · `ctrl + .` pause/play (camera stays live) · `ctrl + h` hide/show the editor · `ctrl + b` toggle the sidebar · `ctrl + hover` a command for docs · drag to orbit, scroll to zoom.

**Editor smarts:** autocomplete knows the whole API (globals at the top level,
chain methods after a `.`), each completion carries its signature and a doc
line, and holding `ctrl` while hovering any API name pops the same docs.

**Sidebar** (`ctrl + b` or the ☰ button): render quality, editor font size,
live-color-update toggle, fps — plus the sketch palette. User sketches are
saved as plain `.js` files in `sketches/user/` via the dev server, so the
folder can be committed to git like any other source; bundled read-only
examples live in `sketches/examples/`. (Without the dev server — e.g. a static
build — user sketches fall back to localStorage.) The last opened sketch is
restored on reload.

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

`camera()` with static numbers places the camera and leaves orbit controls
live. If **any** argument is a function of time, the sketch drives the camera
and orbiting is disabled until you re-run without it:

```js
camera(t => Math.sin(t * 0.2) * 9, 3, t => Math.cos(t * 0.2) * 9)
```

## TOPs — texture operators

The rendered scene is also a texture. TOP chains are shader passes over
textures, evaluated as a graph each frame; end a chain with `.out()` to make
it the display output (with no TOP `.out()`, the scene renders directly).

```js
scene()
  .kaleido(6)
  .comp(feedback().transform({ scale: 1.01, rotate: 0.003 }), 'over', 0.88)
  .bloom({ threshold: 0.6 })
  .out()
```

**Sources**

- `scene()` — the lit 3D render.
- `feedback()` — last frame's final output (a feedback bus; survives
  re-runs, frozen while paused). Comp it back in for trails and video feedback.
- `ramp({ type: 'linear'|'radial'|'angular', a, b, angle, phase })`
- `circle({ radius, soft, center, color, bg })`
- `noise({ freq, octaves, lacunarity, gain, speed, a, b })` — animated fbm.

**Filters** (chain on any TOP; every numeric param takes `t => ...`)

- `.mirror({ axis: 'x'|'y'|'both', flip })` · `.kaleido(sides, { rotate })`
- `.transform({ translate: [x,y], scale, rotate, wrap: 'clamp'|'repeat'|'mirror' })`
- `.add(v)` `.mul(v)` — per-pixel math, scalar or `[r, g, b]`
- `.contrast(v)` `.saturation(v)` `.gamma(v)` — or combined: `.levels({...})`
- `.tile(nx, ny, (src, i, x, y) => variant)` — tile the image with a per-cell
  chain: return `src`, a treatment of it, or any other TOP. Cells with
  structurally identical variants share one render (max 8 distinct).

  ```js
  scene().tile(4, 3, (src, i, x, y) => (x + y) % 2 ? src.saturation(0) : src).out()
  ```
- `.posterize(steps)` — quantize value · `.pixellate(x, y?)` — quantize position
- `.threshold(level, { soft })` · `.invert()` · `.blur(radius)`
- `.edge({ strength, spread })` · `.slope({...})` · `.normalMap({...})` — one
  Sobel pass, three encodings: edge magnitude, centered gradient (RG), or
  tangent-space normal.
- `.displace(mapTop, amount)` — offset UVs by a map's RG · `.remap(mapTop)` —
  absolute UV lookup from the map.
- `.comp(layer, mode, opacity)` — composite `layer` over the chain. Modes:
  `over add sub mult screen overlay hardLight softLight darken lighten
  difference exclusion dodge burn`.
- `.bloom({ threshold, strength, radius })` — brightpass + half-res gaussian.

## Escape hatches

- `THREE` — the full three.js namespace is in scope.
- `onFrame(fn)` — register your own `(t, dt) => ...` per-frame callback.

## Layout

- [src/engine.js](src/engine.js) — renderer, scene/patch lifecycle, frame loop, sketch eval
- [src/api.js](src/api.js) — the chainable operator API
- [src/tops.js](src/tops.js) — TOP shader passes, graph evaluation, feedback
- [src/noise.js](src/noise.js) — GLSL simplex fbm + shader injection
- [src/editor.js](src/editor.js) — CodeMirror overlay, keybindings, completions
- [src/docs.js](src/docs.js) — API docs table → autocomplete + ctrl+hover tooltips
- [src/colorpicker.js](src/colorpicker.js) — inline hex swatches + native picker
- [src/sidebar.js](src/sidebar.js) — settings + sketch palette
- [src/main.js](src/main.js) — wiring
- [vite.config.js](vite.config.js) — dev-server API for `sketches/user/`
- [sketches/examples/](sketches/examples/) — bundled example sketches
