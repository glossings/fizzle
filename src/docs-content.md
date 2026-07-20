## fizzle

Fizzle is a livecoding environment for visual art: a fullscreen canvas behind a
live code editor, with a synth-flavored pipeline — 3D geometry ops,
lights and cameras on one side, and a **TOP** (texture operator) graph of
shader passes on the other. Chains read left to right like a patch network;
re-running a sketch replaces the previous one, Hydra-style.

**These docs are live.** Every code block below is a real editor: click into
it, change anything, and press **▶** (or `ctrl+enter` inside the block) to run
it in the preview panel on the right. The **⧉** button opens the example in
the full app in a new tab. Try it:

```js autorun
bg('#05060a')
ambient(0.25)
directional({ intensity: 1.6 }).pos(4, 6, 3).out()

torusKnot({ radius: 1.1, tube: 0.32, res: 96 })
  .rotate(t => t * 0.4, t => t * 0.23, 0)
  .noise({ amp: 0.18, freq: 2.2, octaves: 4, speed: 0.5 })
  .material({ color: '#4fd1c5', roughness: 0.25, metalness: 0.6 })
  .out()

scene()
  .comp(input().transform({ scale: 1.012, rotate: 0.004 }), 'over', 0.86)
  .bloom({ threshold: 0.55, strength: 0.9 })
  .out()
```

That one sketch touches most of the system: a geometry chain ends in `.out()`
to join the scene, then a TOP chain picks the rendered scene up as a texture,
feeds it back on itself for trails, blooms it, and makes itself the display
output with its own `.out()`.

## quick start

```sh
npm install
npm run dev   # then open http://localhost:5173
```

The whole screen is the canvas; the code floats on top. Nothing appears until
a chain ends in `.out()`.

| key | action |
|---|---|
| `ctrl + enter` | run the sketch (resumes playback if paused) |
| `ctrl + .` | pause / play (the orbit camera stays live) |
| `ctrl + h` | hide / show the editor |
| `ctrl + p` | toggle the sidebar (settings & sketches) |
| `ctrl + hover` | pop docs for the API name under the cursor |
| `Tab` | accept the highlighted completion |
| drag / scroll | orbit / zoom the camera |

**Editor smarts:** autocomplete knows the whole API — globals at the top
level, chain methods after a `.` — and each completion carries its signature
and a doc line. Every `#rgb`/`#rrggbb` in the code gets a clickable swatch
that opens the native color picker; picks write back into the code and
re-render live while you drag.

**Sketches:** the sidebar (`ctrl + p`) saves sketches as plain `.js` files in
`sketches/user/` via the dev server, so the folder can be committed to git.
Without the dev server (a static build) they fall back to localStorage. The
last opened sketch is restored on reload.

**Sharing:** every run mirrors the code into the URL hash (compressed), so the
address bar is always a shareable link — copy it, or use the sidebar's
*copy link* button to include unsaved edits. Opening a link loads its code
straight into the editor, and a refresh recovers whatever last ran.

## time is a parameter

The core idiom: **every numeric parameter accepts a function of time.**
Positions, radii, amounts, rotations, colors — pass a number for a static
value or `t => ...` for an animated one. Parameters are re-evaluated every
frame, so animation uses the same syntax as static values.

```js
ambient(0.3)
directional({ intensity: 1.5 }).pos(3, 5, 2).out()

sphere({ radius: 1, res: 64 })
  .pos(t => Math.sin(t) * 2, 0, 0)
  .scale(t => 1 + 0.3 * Math.sin(t * 3))
  .color('#8899ff')
  .out()
```

Audio signals and tempo signals (covered below) are themselves functions of
`t`, so they drop into the same slots: `.scale(audio().mul(2))` works anywhere
`.scale(t => ...)` does.

## geometry

Geometry ops start a chain; `.out()` builds the mesh and adds it to the scene.

| op | options (defaults) |
|---|---|
| `sphere` | `radius: 1, res: 64` |
| `box` | `width/height/depth: 1, res: 24` |
| `plane` | `width/height: 10, res: 128` (double-sided) |
| `torus` | `radius: 1, tube: 0.35, res: 48` |
| `torusKnot` | `radius: 1, tube: 0.3, res: 64, p: 2, q: 3` |
| `cylinder` | `radiusTop/Bottom: 0.5, height: 1.5, res: 48` |
| `icosa` | `radius: 1, detail: 8` — even triangles, ideal for noise blobs |

`res` matters for `.noise()` — displacement is per-vertex, so more resolution
means finer detail.

### transforms

`.pos(x, y, z)` · `.rotate(x, y, z)` (radians) · `.scale(x, y?, z?)` — one
argument to `.scale` is uniform. Every component takes numbers or fns of `t`.

### .noise — vertex displacement

GPU fbm simplex displacement along vertex normals; normals are recomputed in
the vertex shader so lighting stays correct.

```js
ambient(0.15)
directional({ intensity: 0.8 }).pos(-3, 4, 5).out()
point({ color: '#ff5f9e', intensity: 80 }).pos(t => Math.sin(t) * 4, 3, 2).out()

icosa({ radius: 1.3, detail: 16 })
  .noise({ amp: 0.35, freq: 2, octaves: 4, speed: 0.4 })
  .material({ color: '#8899ff', roughness: 0.3 })
  .out()
```

- `amp` — displacement distance · `freq` — spatial frequency
- `octaves` (1–8) — how many detail layers get stacked
- `lacunarity` — frequency step per octave (2 = each layer twice as fine)
- `gain` — amplitude falloff per octave: low ≈ only the smooth base layer,
  high = crinkly detail. It shapes roughness, not overall strength — that's `amp`.
- `speed` — animates the field · `seed` — same settings, different shape

### .instance — many copies, one mesh

`.instance(count, fn)` renders the chain as a single `InstancedMesh`.
`fn(i, count, t)` returns `{ pos, rot, scale }` per copy and runs every frame,
so instances animate. Each instance seeds the noise field from its own
position, so copies deform differently.

```js
ambient(0.2)
directional({ intensity: 1.4 }).pos(4, 6, 3).out()

box({ res: 4 })
  .instance(80, (i, n, t) => {
    const a = (i / n) * Math.PI * 2
    return {
      pos: [Math.cos(a) * 3, Math.sin(t + i * 0.4) * 0.8, Math.sin(a) * 3],
      rot: [0, a, 0],
      scale: 0.35,
    }
  })
  .material({ color: '#ffd166', roughness: 0.4 })
  .out()
```

### materials

`.material({ color, roughness, metalness, emissive, emissiveIntensity,
flatShading, wireframe })` — PBR settings. `.color(c)` is shorthand for
`.material({ color })`, and colors may be fns of `t` or signals, so a palette
can be sequenced: `.color(kick.counter().select(['#f09', '#0fc']))`.

## 3d text

`text3d('hi', { size, depth, bevel, res, font, weight, center })` extrudes
real type. `font` takes a bare name — resolved against your installed fonts
first (Chrome/Edge, one-time permission prompt), then fetched from Google
Fonts automatically. Use `'google:Name'` to skip the local lookup, or a
`.ttf`/`.otf`/`.typeface.json` URL for a specific file. Async fonts render as
helvetiker until they arrive, then swap in.

```js
ambient(0.3)
directional({ intensity: 1.6 }).pos(2, 4, 6).out()

text3d('fizzle', { size: 1.2, depth: 0.3, bevel: 0.03 })
  .rotate(0, t => Math.sin(t * 0.6) * 0.4, 0)
  .color('#7ee787')
  .out()
```

Content can be a fn of `t`; the geometry rebuilds only when the string
changes, so clocks and counters are cheap. (The Google Fonts fetch goes
through the dev server, so it needs `npm run dev`, not a static build.)

## lights, camera, scene

```js
bg('#07070c')
fog('#07070c', 6, 30)
ambient(0.1)
hemi({ sky: '#333366', ground: '#221100' }).out()
point({ color: '#4fd1c5', intensity: 70 }).pos(t => Math.cos(t) * 4, 2, t => Math.sin(t) * 4).out()
camera(t => Math.sin(t * 0.15) * 9, 4, t => Math.cos(t * 0.15) * 9)

plane({ width: 24, height: 24, res: 128 })
  .rotate(-Math.PI / 2, 0, 0)
  .noise({ amp: 1.2, freq: 0.35, octaves: 5, speed: 0.15 })
  .material({ color: '#222233', roughness: 0.9, flatShading: true })
  .out()
```

- `ambient(intensity, color?)` is added immediately (no `.out()` needed);
  `directional` / `point` / `hemi` chain `.pos(x, y, z).out()`, and `.pos`
  accepts fns of `t` for moving lights.
- `camera(x, y, z, [tx, ty, tz])` with static numbers places the camera and
  leaves orbit controls live. If **any** argument is a function of time, the
  sketch drives the camera and orbiting is disabled until you re-run without it.
- `bg(color)` and `fog(color, near, far)` set the scene backdrop.

## textures: the TOP pipeline

The rendered scene is also a texture. TOP chains are shader passes over
textures, evaluated as a graph each frame; end a chain with `.out()` to make
it the display output. With no TOP `.out()`, the scene renders directly.

```js
ambient(0.3)
directional({ intensity: 1.5 }).pos(4, 6, 3).out()
torus({ radius: 1.2, tube: 0.4, res: 64 }).rotate(t => t * 0.5, t => t * 0.3, 0).color('#ff5f9e').out()

scene()
  .kaleido(6)
  .hue(t => t * 0.05)
  .out()
```

### sources

- `scene()` — the lit 3D render of everything sent to a naked `.out()`.
- `input()` — last frame's display output (Feedback-TOP style; survives
  re-runs, frozen while paused). Comp it back in for trails.
- `input('name')` — a named bus published elsewhere with `.out('name')` — see
  **buses, layers & feedback**.
- `ramp({ type: 'linear'|'radial'|'angular', a, b, angle, phase })` — two-color gradient.
- `circle({ radius, soft, center, color, bg })` — soft-edged disc.
- `noise({ freq, octaves, lacunarity, gain, speed, seed, channels, a, b })` —
  animated fbm noise shading from color `a` (low) to `b` (high). `octaves`
  stacks detail layers; `lacunarity` is the frequency step per octave, `gain`
  the amplitude falloff per octave (low = smooth blobs, high = rough grain —
  the output is normalized, so `gain` shapes texture, not brightness; reach
  for `.contrast()` / `.mul()` to change level). `channels: 2`–`4` puts
  independent fields in R/G(/B/A) instead of the a→b ramp — what you want for
  `.displace()` maps.
- `text('hi', { size, color, bg, pos, font, weight, align })` — canvas-rendered
  text. `size` is a font size in screen px (values ≤ 1 = fraction of screen
  height); any CSS font, `\n` for multiline, content may be a fn of `t`.
- `video(name?)` — live camera (see **video input**).

```js
ramp({ type: 'radial', a: '#1a0533', b: '#ff5f9e' })
  .comp(noise({ freq: 3, octaves: 4, speed: 0.3, a: '#000000', b: '#4fd1c5' }), 'screen', 0.7)
  .comp(text('fizzle'), 'add')
  .out()
```

Every numeric parameter in every TOP takes `t => ...` or a signal, same as
geometry.

## color & filters

- `.add(v)` / `.mul(v)` — per-pixel math; scalar or `[r, g, b]`, negative `add` darkens.
- `.contrast(v)` · `.saturation(v)` · `.gamma(v)` — 1 = unchanged. Or combined: `.levels({ contrast, saturation, gamma, hue })`.
- `.hue(v)` — hue rotation in turns: `.hue(0.5)` flips the palette, `.hue(t => t * 0.1)` drifts it.
- `.posterize(steps)` — quantize values · `.pixellate(x, y?)` — quantize position.
- `.threshold(level, { soft })` — luma → black/white mask · `.invert()`.
- `.blur(radius)` — separable gaussian.
- `.bloom({ threshold, strength, radius })` — brightpass + half-res gaussian glow.
- `.edge({ strength, spread })` · `.slope({...})` · `.normalMap({...})` — one
  Sobel pass, three encodings: edge magnitude (grayscale), centered gradient
  (RG, 0.5-neutral — a ready-made displace map), or tangent-space normal.

```js
noise({ freq: 3, speed: 0.4 })
  .posterize(5)
  .edge({ strength: 2 })
  .mul([0.4, 1.6, 1.2])
  .bloom({ threshold: 0.3, strength: 1.2 })
  .out()
```

## transforms & tiling

- `.transform({ translate: [x, y], scale, rotate, wrap: 'clamp'|'repeat'|'mirror' })`
  — UV-space transform. Or the shorthands `.translate(x, y)`, `.rotate(v)`,
  `.scale(v)` — each takes `{ wrap }` as a trailing option. Translation is in
  UV units (1 = a full frame); scale zooms around center.
- `.mirror({ axis: 'x'|'y'|'both', flip })` — reflect one half onto the other.
- `.kaleido(sides, { rotate })` — polar kaleidoscope fold.
- `.tile(nx, ny, (src, i, x, y) => variant)` — tile the image with a per-cell
  chain: return `src`, a treatment of it, or any other TOP. `x` runs
  left→right, `y` bottom→top, `i = y * nx + x`. Cells with structurally
  identical variants share one render; each *distinct* variant renders its
  own full pass per frame — the cost of `.tile(10, 10, (s, i) => s.hue(i / 100))`
  is 100 renders, same as comping 100 `.out()`s.

```js
circle({ radius: 0.2, soft: 0.04, color: '#4fd1c5' })
  .translate(t => Math.sin(t) * 0.25, 0, { wrap: 'repeat' })
  .kaleido(6, { rotate: t => t * 0.1 })
  .tile(3, 2, (src, i, x, y) => (x + y) % 2 ? src.invert() : src)
  .out()
```

## compositing

`.comp(layer, mode, opacity)` composites `layer` over the chain. Modes:
`over` `add` `sub` `mult` `screen` `overlay` `hardLight` `softLight` `darken`
`lighten` `difference` `exclusion` `dodge` `burn`.

`layer` may also be a **function of the chain so far**, for self-referencing
composites — `.comp(s => s.edge(), 'add')` overlays the chain's own edges.
(`.displace(map)`, `.remap(map)` and `.mask(m, fn)` accept the same fn form.)

```js
ramp({ type: 'angular', a: '#000000', b: '#334455' })
  .comp(circle({ radius: 0.25, soft: 0.1, color: '#ff5f9e' }), 'screen')
  .comp(s => s.edge({ strength: 1.5 }), 'add')
  .out()
```

`text()` renders as an opaque image (black bg by default), so overlay it with
`'add'` / `'screen'`, or `.threshold()` it into a mask.

## masking & switching

`.mask(maskTop, fn?)` — spatial masking by the mask's luma:

- `.mask(m)` — cutout: multiply the chain by the mask.
- `.mask(m, s => ...)` — apply the fn **only where the mask is bright**: a
  dry→wet blend by mask luma, untouched where the mask is black.

```js
noise({ freq: 3, speed: 0.3, a: '#031018', b: '#4fd1c5' })
  .mask(circle({ radius: 0.32, soft: 0.15 }), s => s.displace(noise({ channels: 2, freq: 2, speed: 0.5 }), { amount: 0.2 }).invert())
  .out()
```

`.when(cond, s => ...)` — a **temporal** switch: while the condition signal is
≥ 0.5 the chain becomes `fn(chain)`, otherwise it passes through untouched.
Unlike `.mask`, only the active branch renders.

```js
noise({ freq: 3, speed: 0.5, b: '#7ee787' })
  .when(beat(1).sqr(0.25), s => s.invert())
  .out()
```

## warping

`.displace(map, { amount: 0.1, mid: 0.5 })` offsets each pixel's UV lookup by
the map's RG channels minus `mid`, scaled by `amount` — the classic
displacement map. (`.displace(map, amount)` works as a positional shorthand.)

- **`mid` is the neutral value.** By default mid-gray (0.5) means "don't
  move": brighter than mid pushes one way, darker
  pushes the other. For dark maps where black should be neutral (`edge()`
  output, text on black), set `mid: 0`.
- **Grayscale maps are diagonal-locked** — R = G, so x and y always move
  together. For isotropic wobble, use `noise({ channels: 2 })`: independent
  fields in R and G.
- `.slope()` output is centered on 0.5 by construction — the workflow of
  displacing by a Slope TOP works verbatim.

```js
text('fizzle')
  .displace(noise({ channels: 2, freq: 2, speed: 0.4 }), { amount: t => 0.04 + 0.03 * Math.sin(t) })
  .out()
```

With `mid: 0` and a hefty amount, a dark map cuts shapes out of the source —
the classic circle-displaced-by-text trick:

```js
circle({ radius: 0.35, color: '#ffd166' })
  .displace(text('glossing'), { amount: 0.7, mid: 0 })
  .out()
```

`.remap(mapTop)` is the absolute version: sample the chain at the map's RG
coordinates directly (the map **is** the UV space).

## buses, layers & feedback

`.out('name')` publishes instead of displaying, and `input('name')` reads the
bus anywhere — including in a completely separate chain, so networks don't
have to be a single expression.

```js
ambient(0.3)
directional({ intensity: 1.5 }).pos(4, 6, 3).out()
icosa({ radius: 1.2 }).noise({ amp: 0.3, freq: 2, speed: 0.4 }).color('#8899ff').out()

scene().kaleido(6).out('kal')
noise({ freq: 3, channels: 2, speed: 0.4 }).out('warp')
input('kal').displace(input('warp'), { amount: 0.08 }).bloom().out()
```

When the wiring is acyclic, `input` pulls the producer fresh the same frame —
it's just a patch cord. When the wiring **loops back on itself**, `input`
reads last frame's snapshot instead — which is exactly what makes a cycle a
feedback loop, closable anywhere in the chain:

```js
circle({ radius: 0.1, soft: 0.05, color: '#7ee787' })
  .translate(t => Math.sin(t * 1.3) * 0.3, t => Math.sin(t * 0.9) * 0.3)
  .comp(input('trail').transform({ scale: 0.985, rotate: 0.01 }), 'add', 0.75)
  .out('trail')
  .bloom({ threshold: 0.4 })
  .out()
```

The loop closes at `.out('trail')` — pre-bloom, so the glow doesn't compound
into the trail. Multiple buses coexist, and published chains render even if
they never reach a naked `.out()` (as long as something does).

### geometry layers

`.out('name')` on a **geometry** publishes it under the same namespace: the
object renders into its own layer (not the visible scene), and `input('name')`
pulls that layer as a TOP — same camera, lit, on a black background, so layers
comp cleanly with `add`/`screen`/`lighten`. Lights hit every layer by default;
a light's own `.out('name')` restricts it to one layer.

```js
ambient(0.3)
directional({ intensity: 1.4 }).pos(4, 6, 3).out()

torusKnot({ res: 96 }).rotate(0, t => t * 0.5, 0).color('#8899ff').out('knot')
icosa({ radius: 1.2 }).noise({ amp: 0.3, speed: 0.4 }).color('#ff5f9e').out('blob')

input('knot').edge({ strength: 2 })
  .comp(input('blob').pixellate(90), 'add')
  .out()
```

## video input

`video(name?)` is a live camera as a TOP generator. No name = the default
camera; a name matches a camera label by case-insensitive substring
(`video('facetime')`). The browser console lists the available sources when
the stream starts — and when a name doesn't match anything. First use asks
for camera permission; the stream survives re-runs (livecoding doesn't
re-prompt) and renders black until it's live. It's a texture like any other —
displace it, mask it, feed it back.

```js
video()
  .pixellate(90)
  .posterize(4)
  .hue(t => t * 0.03)
  .out()
```

## audio signals

`audio()` turns the mic (or any input device — pick it in the sidebar) into a
**signal**: a function of time with processing methods, so it drops straight
into any parameter. First use starts capture (browser permission prompt).

```js
const kick = audio().bandpass(30, 160).kicks()
const bass = audio().lowpass(150).smooth(0.03, 0.2)

ambient(0.2)
directional({ intensity: 1.5 }).pos(4, 6, 3).out()

icosa({ radius: 1 })
  .noise({ amp: bass.mul(1.2).add(0.1), freq: 2.5, speed: 0.4 })
  .scale(kick.mul(0.5).add(1))
  .color(kick.counter().select(['#ff5f9e', '#4fd1c5', '#ffd166']))
  .out()
```

- `audio()` — mono mix level (RMS). `audio(2)` — one channel by index; inputs
  with more than 2 channels are fully addressable.
- `audio('scarlett')` — a specific input device by name (case-insensitive
  label substring), independent of the sidebar's selection — so two interfaces
  can drive different parameters. `audio('scarlett', 2)` picks a channel of
  it. An unmatched name lists the available inputs in the console.
- `.lowpass(hz)` / `.highpass(hz)` / `.bandpass(lo, hi)` — energy (0..1) in a
  region of the spectrum: bass level, treble level, a drum's band.
- `.smooth(up, down?)` — exponential lag in seconds; two args = separate
  attack/release (fast up + slow down = envelope follower).
- `.kicks({ threshold: 1.5, decay: 6, floor: 0.05 })` — onset detector: jumps
  to 1 when the value leaps past `threshold ×` its own moving average, then
  decays. Chain after a band — `.bandpass(30, 160).kicks()` for kick drums,
  `.highpass(5000).kicks()` for hats.
- `.add` `.mul` `.pow` — arithmetic (`pow < 1` lifts quiet detail).

The sidebar's **audio out** setting passes the captured input through to an
output device — handy for monitoring an interface channel. Mind feedback:
mic → speakers will howl.

## tempo & sequencing

`beat(div)` is a tempo-synced phase ramp — 0..1 over `div` beats at the
sidebar's bpm. Any signal can be shaped, gated, counted, or used to pick from
a list:

```js
const step = beat(1).counter(4)

circle({
  radius: beat(1).mul(-0.2).add(0.4),
  soft: 0.06,
  color: step.select(['#ff5f9e', '#4fd1c5', '#ffd166', '#a78bfa']),
}).out()
```

- `.sin()` `.tri()` `.saw()` `.sqr(width)` — waveshapes of value-as-phase (one
  cycle per whole unit, 0..1 out). `beat(2).sin()` = two-beat LFO,
  `beat(0.25).sqr(0.3)` = sixteenth-note gates.
- `.beat(div?)` — tempo-synced sample-and-hold: freezes a new value of the
  signal at the start of every `div` beats. `rand().beat(4)` = new random
  value per bar.
- `.counter(max?, threshold?)` — counts rising edges (kick hits, gates),
  wrapping at `max`.
- `.select([...])` — index a list by the value (floored, wrapped); items can
  be numbers, colors, strings, or fns of `t`.
- `.gte(v)` / `.lte(v)` — comparison gates, mainly for `.when()` and `.counter()`.
- `.hold(trigger, threshold?)` — sample-and-hold driven by **another** signal:
  freezes the current value each time the trigger crosses up through threshold.
- `.round()` `.floor()` `.ceil()` `.abs()` — the usual math, chainable.

## random & custom signals

`rand({ freq, seed })` is a smooth random signal — deterministic value noise of
`t`, 0..1 — the signal cousin of the `noise()` TOP (positional
`rand(freq, seed)` works too). Different seeds give independent signals —
`rand({ seed: i })` inside a `.tile()` or `.instance()` fn gives every copy its
own. `.beat(div)` snaps it to the grid, and `.hold` samples a new random value
per trigger:

```js
const hit = beat(1).sqr(0.1)   // stand-in trigger: fires each beat (try audio().kicks())

ambient(0.25)
directional({ intensity: 1.5 }).pos(4, 6, 3).out()

sphere({ res: 96 })
  .noise({ amp: 0.35, freq: 3, seed: rand().hold(hit).mul(4).round() })
  .color('#4fd1c5')
  .out()
```

`sig(fn)` lifts any `t => ...` into a chainable signal when you want the
processing methods on it: `sig(t => Math.sin(t)).smooth(0.2)`. Free-running
LFOs don't need it — `t => Math.sin(t)` is already idiomatic everywhere.

## escape hatches

- `THREE` — the full three.js namespace is in scope for anything the API
  doesn't cover.
- `onFrame((t, dt) => ...)` — register a raw per-frame callback.

```js
ambient(0.3)
directional({ intensity: 1.5 }).pos(4, 6, 3).out()

// THREE for math the API doesn't wrap: lerp between two colors over time
const c1 = new THREE.Color('#ff5f9e')
const c2 = new THREE.Color('#4fd1c5')
const blend = t => '#' + c1.clone().lerp(c2, 0.5 + 0.5 * Math.sin(t)).getHexString()

let spin = 0
onFrame((t, dt) => { spin += dt * (1.5 + Math.sin(t)) })   // custom integrator

torus({ radius: 1.2, tube: 0.4, res: 64 })
  .rotate(0, () => spin, 0)
  .color(blend)
  .out()
```
