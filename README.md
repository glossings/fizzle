# fizzle

A Hydra-style livecoding environment with a synth-flavored 3D pipeline:
geometry → transform → noise displacement → instancing → lit render, all on a
fullscreen canvas behind a live code editor.

```sh
npm install
npm run dev   # then open http://localhost:5173
```

**Interactive docs** live at `/docs.html` (the "docs & reference ↗" link in
the sidebar): every example is a live editor running on a real engine in a
preview panel, plus a searchable reference generated from the same table
that powers autocomplete.

**Keys:** `ctrl + enter` run the sketch (resumes if paused) · `ctrl + .` pause/play (camera stays live) · `ctrl + h` hide/show the editor · `ctrl + p` toggle the sidebar · `ctrl + hover` a command for docs · drag to orbit, scroll to zoom.

**Editor smarts:** autocomplete knows the whole API (globals at the top level,
chain methods after a `.`), each completion carries its signature and a doc
line — accept with `Tab` (`Enter` inserts a newline as usual). Holding `ctrl`
while hovering any API name pops the same docs.

**Sidebar** (`ctrl + p` or the ☰ button): render quality, editor font size,
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
| `model('ship.obj', …)` | an imported `.obj`/`.fbx` — `center: true, fit: 2` |
| `text3d('hi', …)` | `size: 1, depth: 0.25, bevel: 0.02, res: 8, font, weight: 'regular'\|'bold', center: true` |

`model` takes a file you dragged into the window (an empty `model()` opens a
picker). Every mesh in the file merges into one geometry — so `.noise()`,
`.instance()` and the rest work on it exactly like on a primitive — and the
file's own materials are dropped in favour of `.material()`. Since model files
disagree about units and origin, the geometry is centered and scaled to `fit`
across its longest axis by default; `fit: 0` keeps the file's own units.

`text3d`'s `font` takes a bare font name — resolved against your installed
fonts first (Chrome/Edge, one-time permission prompt; needs a user gesture, so
it may kick in on the next ctrl+enter rather than page load), then fetched
from Google Fonts automatically (`font: 'Orbitron'` just works). Use
`'google:Name'` to skip the local lookup, or a `.ttf`/`.otf`/`.typeface.json`
URL to load a specific file. Async fonts render as helvetiker until they
arrive, then swap in; loads are cached across re-runs. The 2D `text()` TOP
takes any CSS font name directly (installed fonts work natively), plus the
same `'google:Name'` and URL forms. The Google Fonts fetch goes through the
dev server (Google won't serve parseable `.ttf` to browsers), so it needs
`npm run dev`, not a static build.

`res` matters for `.noise()` — displacement is per-vertex, so more resolution
means finer detail. (`text3d` faces are sparsely triangulated, so `.noise()`
on it mostly ripples the outline/bevel.) `text3d` content can be a fn of `t`;
the geometry rebuilds only when the string changes, so clocks/counters are
cheap.

## Chain operators

- `.pos(x, y, z)` / `.rotate(x, y, z)` / `.scale(x, y?, z?)` — transforms; `scale(2)` is uniform.
- `.noise({ amp, freq, octaves, lacunarity, gain, speed, seed })` — GPU fbm simplex
  displacement along vertex normals. `amp` is displacement distance, `freq` is
  spatial frequency, `octaves` (1–8) adds harmonic detail, `lacunarity`/`gain`
  control per-octave frequency/amplitude falloff, `speed` animates the field,
  `seed` offsets it (same settings, different shape).
  Normals are recomputed in the vertex shader so lighting stays correct.
- `.instance(count, fn)` — renders as a single `InstancedMesh`. `fn(i, count, t)`
  returns `{ pos: [x,y,z], rot: [x,y,z], scale: n | [x,y,z] }` per copy and runs
  every frame, so instances animate. Each instance seeds the noise field from
  its own position, so copies deform differently.
- `.material({ color, roughness, metalness, emissive, emissiveIntensity, flatShading, wireframe })`
  · `.color(c)` shorthand.
- `.out()` — build it and add it to the scene. `.out('name')` builds it into
  its own named render layer instead — see **Geometry layers** below.

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
  .comp(input().transform({ scale: 1.01, rotate: 0.003 }), 'over', 0.88)
  .bloom({ threshold: 0.6 })
  .out()
```

**Sources**

- `scene()` — the lit 3D render.
- `input()` — last frame's final output (a feedback bus; survives
  re-runs, frozen while paused). Comp it back in for trails and video
  feedback. (`feedback()` still works as a legacy alias.)
- `.out('name')` + `input('name')` — named buses. `.out('name')` is a
  passthrough that publishes that point of the chain as a named buffer, and
  `input('name')` reads it anywhere — including in a completely separate
  chain, so networks don't have to be a single expression:

  ```js
  scene().kaleido(6).out('kal')                 // publish (no display)
  noise({ freq: 3, channels: 2 }).out('warp')
  input('kal').displace(input('warp'), 0.08).bloom().out()
  ```

  When the wiring is acyclic (as above) `input` pulls the producer fresh the
  same frame — it's just a patch cord. When the wiring loops back on itself,
  `input` reads last frame's snapshot instead, which is exactly what makes a
  cycle a feedback loop — closable anywhere, e.g. pre-bloom so glow doesn't
  compound into the trail:

  ```js
  scene()
    .comp(input('trail').transform({ scale: 0.97, rotate: 0.01 }), 'add', 0.6)
    .out('trail')            // loop closes here, pre-bloom
    .bloom({ threshold: 0.5 })
    .out()
  ```

  Multiple buses coexist, and published chains render even if they never
  reach a naked `.out()` (as long as something does).
- **Geometry layers** — `.out('name')` on a geometry publishes it under the
  same namespace: the object renders into its own layer (not the visible
  scene), and `input('name')` pulls that layer as a TOP — same camera, lit,
  tone-mapped, on a black background so layers comp cleanly with
  `add`/`screen`/`lighten`. Lights hit every layer by default; a light's own
  `.out('name')` restricts it to one layer. `scene()` stays what it always
  was: the render of everything sent to a naked `.out()`.

  ```js
  torusKnot().rotate(0, t => t, 0).out('knot')     // not in the visible scene
  icosa({ radius: 1.4 }).noise({ amp: 0.3 }).out('blob')

  input('knot').edge({ strength: 2 })
    .comp(input('blob').pixellate(90), 'add')      // separate looks, comped
    .out()
  ```
- `ramp({ type: 'linear'|'radial'|'angular', a, b, angle, phase })`
- `circle({ radius, soft, center, color, bg })`
- `noise({ freq, octaves, lacunarity, gain, speed, seed, channels, a, b })` —
  animated fbm. `channels: 2`–`4` puts *independent* fields in R/G(/B/A)
  instead of the a→b grayscale ramp — what you want for `.displace()` maps.
- `text('hi', { size, color, bg, pos, font, weight, align })` — canvas-rendered
  text; any CSS font, `\n` for multiline, content may be a fn of `t`. It's an
  opaque image (black bg by default), so overlay with `comp(…, 'add')` /
  `'screen'`, or `.threshold()` it into a mask.
- `video(name?)` — live camera. `name` matches a camera label
  (case-insensitive substring: `video('facetime')`); no name = the default
  camera. Permission prompt on first use; the stream survives re-runs and
  shows black until it's live.

**Filters** (chain on any TOP; every numeric param takes `t => ...`)

- `.mirror({ axis: 'x'|'y'|'both', flip })` · `.kaleido(sides, { rotate })`
- `.transform({ translate: [x,y], scale, rotate, wrap: 'clamp'|'repeat'|'mirror' })`
  — or the shorthands `.translate(x, y)`, `.rotate(v)`, `.scale(v)` (each
  takes `{ wrap }` as a trailing option).
- `.add(v)` `.mul(v)` — per-pixel math, scalar or `[r, g, b]`
- `.contrast(v)` `.saturation(v)` `.gamma(v)` `.hue(v)` — or combined:
  `.levels({...})`. Hue is in turns: `.hue(t => t * 0.1)` drifts the palette,
  `.hue(0.5)` flips it.
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
- `.displace(mapTop, amount, { mid: 0.5 })` — offset UVs by the map's RG
  minus `mid`. Mid-gray is neutral by default; `mid: 0` makes black neutral
  (use for dark maps like `edge()` output). Grayscale maps push along the
  diagonal only — `noise({ channels: 2 })` displaces isotropically.
  `.remap(mapTop)` — absolute UV lookup from the map.
- `.comp(layer, mode, opacity)` — composite `layer` over the chain. Modes:
  `over add sub mult screen overlay hardLight softLight darken lighten
  difference exclusion dodge burn`. `layer` may also be a **function of the
  chain so far**, for self-referencing composites:

  ```js
  scene().kaleido(6).comp(s => s.edge(), 'add').out()   // overlay own edges
  ```

  (`.displace(map)` and `.remap(map)` accept the same fn form.)
- `.mask(maskTop, fn?)` — without `fn`, multiply by the mask's luma (cutout).
  With `fn`, apply it **only where the mask is bright** — a dry→wet blend by
  mask luma:

  ```js
  scene()
    .mask(circle({ radius: 0.3, soft: 0.15 }), s => s.displace(noise({ channels: 2 }), 0.2))
    .out()   // displaced inside the circle, untouched outside
  ```
- `.bloom({ threshold, strength, radius })` — brightpass + half-res gaussian.
- `.when(cond, s => ...)` — per-frame switch: while the condition signal is
  ≥ 0.5 the chain becomes `fn(chain)`, otherwise it passes through untouched
  (only the active branch renders):

  ```js
  scene().when(audio().gte(0.3), s => s.kaleido(6)).out()   // kaleido on loud
  scene().when(beat(1).sqr(0.25), s => s.invert()).out()    // strobe on the beat
  ```

## Audio

`audio()` turns the mic (or any input device — pick it in the sidebar) into a
**signal**: a function of time with processing methods, so it drops straight
into any parameter that takes a `t => ...`:

```js
const level = audio().smooth(0.05, 0.25)        // mono mix, fast up / slow down
const bass  = audio().lowpass(150).smooth(0.03, 0.2)
const kick  = audio().bandpass(30, 160).kicks() // 1 on each kick, then decays

icosa({ radius: 1.2 })
  .noise({ amp: bass.mul(1.5).add(0.1), freq: 2.5 })
  .scale(kick.mul(0.5).add(1))
  .out()
```

- `audio()` — mono mix level (RMS). `audio(2)` — one channel by index;
  inputs with more than 2 channels are fully addressable.
- `.add(v)` `.mul(v)` `.pow(v)` — arithmetic (`pow < 1` lifts quiet detail).
- `.smooth(up, down?)` — exponential lag, in seconds; with two args, attack
  and release differ (fast up + slow down = envelope follower). This *is*
  a lowpass filter, just applied to the control value rather than the audio.
- `.lowpass(hz)` / `.highpass(hz)` / `.bandpass(lo, hi)` — energy (0..1) in
  a region of the input's spectrum: bass level, treble level, etc.
- `.kicks({ threshold: 1.5, decay: 6, floor: 0.05 })` — onset detector on
  whatever signal it's chained onto: jumps to 1 when the value leaps past
  `threshold ×` its own moving average, decays exponentially. Chain it after
  a band for percussion — `.bandpass(30, 160).kicks()` for kick drums,
  `.highpass(5000).kicks()` for hats.

Capture starts on first use (browser permission prompt; the AudioContext may
stay silent until the page has had a click or keypress — re-running with
ctrl+enter counts). Signals freeze while paused, like everything else.

### Tempo, gates, counters

`beat(div)` is a phase ramp — 0..1 over `div` beats at the sidebar's tempo —
and any signal can be shaped, gated, counted, or used to pick from a list:

```js
const wob  = beat(2).sin()                       // two-beat sine LFO, 0..1
const gate = beat(0.25).sqr(0.3)                 // rhythmic 1/0 on sixteenths
const drift = beat(1).rand().smooth(0.2)         // new random target per beat
const step = audio().bandpass(30, 160).kicks()
  .counter(4)                                    // 0,1,2,3,0,... one per kick
const col  = step.select(['#ff5f9e', '#4fd1c5', '#ffd166', '#a78bfa'])
sphere().color(col).scale(wob.mul(0.5).add(1)).out()
```

- `.sin()` `.tri()` `.saw()` `.sqr(width)` — waveshapes of value-as-phase
  (one cycle per whole unit, 0..1 out). They work on anything ramp-like.
- `.rand()` — sample-and-hold: fresh random each time the integer part
  advances (`beat(4).rand()` = new value per bar).
- `.counter(max?, threshold?)` — counts rising edges (kick hits, gates),
  wrapping at `max`.
- `.select([...])` — index a list by the value (floored, wrapped); items can
  be numbers, colors, strings, or fns of t.
- `.gte(v)` / `.lte(v)` — comparison gates, mainly for `.when(...)` and
  `.counter()`.
- `.hold(trigger, threshold?)` — sample-and-hold driven by *another* signal:
  freezes the current value each time the trigger crosses up through
  threshold.
- `.round()` `.floor()` `.ceil()` `.abs()` — the usual math, chainable.
- `rnd(freq?, seed?)` — smooth random signal (deterministic value noise of
  t, 0..1); the signal cousin of the `noise()` TOP. Different seeds give
  independent signals.
- `sig(fn)` — lift any `t => ...` fn into a chainable signal when you want
  the processing methods on it.

```js
const kick = audio().bandpass(30, 160).kicks()
sphere()
  .noise({ amp: 0.4, freq: 3, seed: rnd().hold(kick).mul(4).round() })
  .out()                                         // new noise shape per kick
```

Free-running (non-tempo) LFOs don't need any of this — `t => Math.sin(t)` is
already idiomatic everywhere.

The sidebar's **audio out** setting passes the captured input through to an
output device (off by default) — handy for monitoring, or when the input is
an interface channel you also want to hear. Picking a specific device needs
Chrome/Edge (`AudioContext.setSinkId`); elsewhere passthrough goes to the
default output. Mind feedback: mic → speakers will howl.

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
- [src/docs-page.js](src/docs-page.js) + [src/docs-content.md](src/docs-content.md) + [src/docs.css](src/docs.css) — the interactive docs page ([docs.html](docs.html))
- [src/colorpicker.js](src/colorpicker.js) — inline hex swatches + native picker
- [src/sidebar.js](src/sidebar.js) — settings + sketch palette
- [src/main.js](src/main.js) — wiring
- [vite.config.js](vite.config.js) — dev-server API for `sketches/user/`
- [sketches/examples/](sketches/examples/) — bundled example sketches
