## fizzle

Fizzle is a livecoding environment for visual art: a fullscreen canvas behind a
live code editor, with a two-sided pipeline — 3D **geometry** ops, lights and
cameras on one side, and a **texture** graph of shader passes on the other.
Chains read left to right; re-running a sketch replaces the previous one.

**These docs are live.** Every code block below is a real editor: click into
it, change anything, and press **▶** (or `ctrl+enter` inside the block) to run
it in the preview panel on the right. The **⧉** button opens the example in
the full app in a new tab. Try it:

```js autorun
bg('#05060a')
ambient({ intensity: 0.25 })
directional({ intensity: 1.6 }).pos(4, 6, 3).out()

torusKnot({ radius: 1.1, tube: 0.32, res: 96 })
  .rotate(t => t * 0.4, t => t * 0.23, 0)
  .noise({ amp: 0.18, freq: 2.2, octaves: 4, speed: 0.5 })
  .material({ color: '#4fd1c5', roughness: 0.25, metalness: 0.6 })
  .out()

scene()
  .comp(input().transform({ scale: 1.012, rotate: 0.004 }), 'over', 0.68)
  .bloom({ threshold: 0.55, strength: 0.9 })
  .out()
```

That one sketch touches most of the system: a geometry chain ends in `.out()`
to join the scene, then a texture chain picks that render up, feeds it back on
itself for trails, blooms it, and makes itself the display output with its own
`.out()`.

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
| `F1` | open / close the projector window |
| `Tab` | accept the highlighted completion |
| drag / scroll | orbit / zoom the camera |

**Editor smarts:** autocomplete knows the whole API — globals at the top
level, chain methods after a `.` — and each completion carries its signature
and a doc line. Every `#rgb`/`#rrggbb` in the code gets a clickable swatch
that opens the native color picker; picks write back into the code and
re-render live while you drag.

**Projector (`F1`):** a second window with nothing in it but the visuals and
the code — no sidebar, no status line, no scrollbars — meant to be dragged onto
a projector or second display while you keep working in the main window. It
mirrors: the code follows your typing and scrolls to your cursor, and the
picture is the same framebuffer, so there's no second render to pay for. The
code is laid over the picture and clipped to it, so it can never spill onto a
letterbox bar or off the edge of a recording. Nothing in it is clickable.
`F1` puts it away — from your window or from the projector's, where `escape`
does the same.

Press **`f`** in that window (or double-click it) for fullscreen — a pop-up
always gets a location bar, and fullscreen is the only way to be rid of it.
That's the state you actually want on the projector.

While it's open, `ctrl + h` hides the code **on the projector** rather than in
your window — you're typing on the laptop, so that's the one copy the keyboard
can't otherwise reach, and it's what lets you drop the audience to pure visuals
mid-set without losing your place. With no projector open it hides your own
editor, as before.

**`resolution(width, height)`** pins the render to an exact size and shape
instead of the browser window. Your window shows it letterboxed — scaled to
fit, centered, black around it — and the projector window takes the same aspect
ratio, so full-screening that one on a display of the same shape fills it edge
to edge with nothing cropped and no bars. `resolution(1920, 1080)` before a set
is the whole setup: the projector window opens at exactly that size (shrunk to
fit your screen if it has to). Quality in the sidebar still scales the pixels
underneath without touching the shape, and dropping the call goes back to
filling the window.

**Sketches:** the sidebar (`ctrl + p`) saves sketches as plain `.js` files in
`sketches/user/` via the dev server, so the folder can be committed to git.
Where there's no such server — the hosted site, or a static build — they fall
back to localStorage, saved in this browser only; the sidebar says which of the
two is live. The last opened sketch is restored on reload either way.

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
ambient({ intensity: 0.3 })
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

### colors

Anywhere a color is taken — `.material({ color })`, `.color()`, a light's
`color`, `bg()`, `fog()`, a texture's `color`/`bg`/`a`/`b` — four forms work:

```js
'#4fd1c5'            // hex
'tomato'             // any CSS color name
0x4fd1c5             // number
[0.31, 0.82, 0.77]   // rgb, each channel 0..1
```

The array is the one you can compute, because each channel takes a fn of `t`
like every other parameter — that's how you get a color out of math rather
than out of a list:

```js
ambient({ intensity: 0.4 })
directional({ intensity: 1.4 }).pos(3, 5, 2).out()

sphere({ radius: 1.4, res: 96 })
  .color([t => Math.sin(t) * 0.5 + 0.5, 0.3, t => Math.cos(t * 0.7) * 0.5 + 0.5])
  .material({ roughness: 0.35 })
  .out()
```

`[1, 0, 0]` and `'#ff0000'` are the same red. A whole-color fn still works too,
which is what you want for stepping through fixed palettes:
`.color(kick.counter().select(['#f09', '#0fc']))`.

## errors don't stop the video

This is a livecoding environment, so a mistake never blanks the screen:

- **A run that throws keeps the previous sketch playing.** The error shows in
  the status bar with *(previous sketch still playing)*, and the visuals carry
  on until the next run that works. Half-typed code is a normal state to be in.
- **Anything a call can't honour is a warning, not a stop** — a `.material()`
  property that doesn't exist, `.pos()` on an `ambient()` light, `.noise()` on
  an instance handle. The status bar says what was ignored and the frame goes
  out anyway.
- **A throw inside a per-frame fn doesn't kill the loop.** It's reported once
  (not sixty times a second) and rendering continues; fixing it and re-running
  clears the message.

Warnings also go to the browser console, prefixed `fizzle:`.

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
| `model` | `name, center: true, fit: 2` — an imported `.obj`/`.fbx` |

`res` matters for `.noise()` — displacement is per-vertex, so more resolution
means finer detail.

### model — your own .obj / .fbx

Drag an `.obj` or `.fbx` into the window and it's imported (stored in the
browser, surviving reloads) with the call typed at your cursor. An empty
`model()` opens a file picker instead, and `name` also matches on a
case-insensitive substring, so `model('ship')` finds `ship_final_v2.fbx`.

A model is a geometry op like any other — every chain method works on it,
`.instance()` included. (`ship.obj` below is a starter file that comes with
fizzle, so this runs before you've imported anything of your own — see
**media files**.)

```js
ambient({ intensity: 0.2 })
directional({ intensity: 1.4 }).pos(4, 6, 3).out()

model('ship.obj')
  .instance(40, (x, i, n, t) => {
    const a = (i / n) * Math.PI * 2
    x.pos(Math.cos(a) * 4, 0, Math.sin(a) * 4).rotate(0, t * 0.5 + i, 0).scale(0.4)
  })
  .material({ color: '#ffd166', roughness: 0.4 })
  .out()
```

Everything in the file is merged into a **single** geometry, because a chain
is a single mesh — that's also what makes instancing one draw call. The file's
own materials and textures are dropped; `.material()` shades it.

Model files disagree wildly about units and origin (an FBX authored in
centimetres lands 100× too big), so by default the geometry is centered and
scaled so its longest axis is `fit: 2` — roughly the size of a default
`sphere()`, which keeps `.instance()` layouts predictable. Pass `fit: 0` to
keep the file's own units, `center: false` to keep its own origin.

Parsing happens off to the side and is cached across re-runs: on a fresh
import the mesh is empty for a moment, then the geometry appears — after that
ctrl+enter is instant. Dense scans work with `.noise()` and `.instance()`, but
they carry their own vertex count, so a million-triangle model instanced 500
times is exactly as heavy as it sounds.

### transforms

`.pos(x, y, z)` · `.rotate(x, y, z)` (radians) · `.scale(x, y?, z?)` — one
argument to `.scale` is uniform. Every component takes numbers or fns of `t`.

### .noise — vertex displacement

GPU fbm simplex displacement along vertex normals; normals are recomputed in
the vertex shader so lighting stays correct.

```js
ambient({ intensity: 0.15 })
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
`fn(x, i, count, t)` hands you each copy as `x` and you transform it with the
same verbs as the chain — `.pos` · `.rotate` · `.scale`, chainable, numbers or
fns of `t`. It runs every frame, so instances animate. Each instance seeds the
noise field from its own position, so copies deform differently.

```js
ambient({ intensity: 0.2 })
directional({ intensity: 1.4 }).pos(4, 6, 3).out()

box({ res: 4 })
  .instance(80, (x, i, n, t) => {
    const a = (i / n) * Math.PI * 2
    x.pos(Math.cos(a) * 3, Math.sin(t + i * 0.4) * 0.8, Math.sin(a) * 3)
      .rotate(0, a, 0)
      .scale(0.35)
  })
  .material({ color: '#ffd166', roughness: 0.4 })
  .out()
```

`x.color(c)` tints one copy, multiplied with the chain's material color:
`x.color(i % 2 ? '#ffd166' : '#4fd1c5')`.

The batch is one mesh with one material, so that's where the per-copy story
ends: `.noise()`, the rest of `.material()` and `.out()` are shared by every
instance and belong on the chain — calling them on `x` says so rather than
silently doing nothing.

### materials

`.material({ color, roughness, metalness, emissive, emissiveIntensity,
flatShading, wireframe, doubleSide })` — PBR settings. `doubleSide` renders
back faces too — on by default for `plane()` and `model()`. `.color(c)` is
shorthand for `.material({ color })`; see [colors](#colors) for the four forms
every color slot takes.

`opacity` fades a surface out and switches on blending by itself — name
`transparent` only to override that, and `depthWrite: false` when a pile of
overlapping transparent shapes pops as the camera turns.

A property `.material()` doesn't know is called out rather than shrugged at —
`transmision` would otherwise just quietly do nothing, which looks exactly like
the feature being broken. It's a warning, not a stop: the key is ignored, the
rest of the material is built, and the sketch renders.

### glass & coatings

Naming any of the properties below upgrades the mesh to three's *physical*
material, which is the pricier shader — so a sketch that never mentions them
pays nothing. They all take fns of `t` like every other number here.

- `transmission` (0..1) — light passes through instead of bouncing off. This is
  glass. Add `thickness` (world units) to refract through a *volume* rather than
  a thin shell, `ior` to say how hard it bends (1.0 air · ~1.33 water · ~1.5
  glass · 2.4 diamond), and `dispersion` to split it into rainbow fringes.
  `attenuationColor` + `attenuationDistance` tint what survives the trip.
- `clearcoat` (0..1) + `clearcoatRoughness` — a second specular lobe over the
  base, like lacquer over paint. The cheap way to make anything look wet.
- `iridescence` (0..1) + `iridescenceIOR` + `iridescenceThickness` (film
  thickness in nm, ~100–800) — thin-film interference: soap bubbles, oil
  slicks, beetle shells.
- `sheen` + `sheenColor` + `sheenRoughness` — retroreflective fuzz, for cloth.
- `anisotropy` + `anisotropyRotation` — stretches highlights along one
  direction: brushed metal, hair.
- `specularIntensity`, `specularColor`, `reflectivity` — dielectric reflection
  strength when `metalness` is 0.

Transmission and iridescence both reflect their surroundings, so they need
something to reflect: an `hdri()` environment does far more for them than point
lights do.

```js
hdri('kloofendal_43d_clear_puresky_1k.hdr', { blur: 0.4 })

sphere({ radius: 1.3, res: 96 })
  .material({
    transmission: 1,
    thickness: 1.2,
    ior: 1.45,
    roughness: 0.05,
    iridescence: 1,
    iridescenceThickness: t => 300 + Math.sin(t * 0.5) * 180,
  })
  .out()
```

### textured materials

The same `.material()` takes texture maps. `pbr:` is the shorthand for a whole
set of them at once:

```js
hdri('kloofendal_43d_clear_puresky_1k.hdr', { blur: 0.3 })

sphere({ radius: 1.4, res: 128 })
  .material({ pbr: 'cobblestone_floor_08_1k', repeat: 2 })
  .out()
```

Two ways to get a set in:

- **Run an empty `.material()`** — like an empty `videofile()`, it asks for
  what's missing. It opens a browser onto [Poly Haven](https://polyhaven.com):
  a few hundred CC0 materials, searchable by name and category. Pick one and
  its maps download into this browser, then the `pbr:` lands **in that same
  call** and the sketch re-runs. Nothing points at the network afterwards —
  the files are local, so it keeps rendering offline and after the site
  changes. `esc` cancels; **from disk…** picks your own files instead.
- **Drag a folder of maps in** from anywhere else (ambientCG, cgbookcase, a
  Substance export). Files keep a `folder/file.jpg` name, and the folder is
  the handle: `.material({ pbr: 'rock_wall' })`.

```js
ambient({ intensity: 0.35 })
directional({ intensity: 1.6 }).pos(4, 6, 3).out()

sphere({ radius: 1.4, res: 128 })
  .material()   // ctrl+enter -> browse -> .material({ pbr: 'moss_2k', repeat: 2 })
  .out()
```

Which image is which map is worked out from filenames, so the usual
conventions all land — `diff`/`albedo`/`Color`/`_D` for color, `nor_gl` /
`NormalGL` / `_N` for normals, `Roughness`/`_R`, `AmbientOcclusion`,
`Displacement`/`height`, and `arm`/`orm` for the packed AO+roughness+metalness
image. DirectX-convention normals (`NormalDX`) are used only when no OpenGL
one shipped alongside.

Individual slots take an imported image by name (exact, or case-insensitive
substring, like every other file here), or mix with a set:

```js
ambient({ intensity: 0.3 })
directional({ intensity: 1.6 }).pos(4, 8, 6).out()
camera(0, 3, 9)

plane({ width: 20, height: 20, res: 200 })
  .rotate(-Math.PI / 2, 0, 0)
  .pos(0, -1.5, 0)
  .material({ pbr: 'cobblestone_floor_08_1k', repeat: 8, displaceScale: 0.4 })
  .out()

box({ res: 2 })
  .scale(2)
  .rotate(0, t => t * 0.3, 0)
  .material({
    map: 'cobblestone_floor_08_1k/diff.jpg',
    normalMap: 'cobblestone_floor_08_1k/nor_gl.jpg',
    roughness: 0.4,
  })
  .out()
```

- **slots** — `map` (color), `normalMap`, `roughnessMap`, `metalnessMap`,
  `aoMap`, `displacementMap`, and `arm` for one packed image filling the
  middle three. A slot named outright wins over whatever `pbr:` resolved.
  Any slot also takes a live texture chain instead of a filename — see
  **texture chains as material maps**.
- **tiling** — `repeat` (a number, or `[x, y]`), `offset`, `uvRotate`
  (radians). These apply to every map on the material.
- **tuning** — `normalScale` (relief strength), `aoIntensity`,
  `displaceScale` / `displaceBias`, `envIntensity` (how hard the HDRI hits
  this material).
- `roughness` and `metalness` **multiply** their maps, so they default to 1
  once one lands — name them only to push a material further
  (`{ pbr: 'wood_2k', roughness: 0.3 }` for a varnished version).

Displacement moves real vertices, so it needs vertices to move: `res: 128` or
more on the shape, or nothing visible happens. It stacks with `.noise()` —
the fbm displaces the surface and the height map roughens what it produces.

Loading is asynchronous, like fonts and models: the first frames after a fresh
import render untextured and the maps appear as they arrive. Re-runs come from
cache and are textured immediately.

### hdri — environment lighting

`hdri(name?, { background, intensity, blur, rotation })` lights the scene with
an imported `.hdr`/`.exr` panorama, which also becomes the backdrop. Run an
empty `hdri()` to browse Poly Haven's HDRIs — the pick downloads and fills
itself into that call — or drag a file in.

This is what makes `metalness` mean anything: a metal surface is almost
entirely reflection, and without an environment there is nothing to reflect —
crank metalness under plain lights and you get black.

```js
hdri('kloofendal_43d_clear_puresky_1k.hdr', {
  blur: 0.4,                    // soft sky, unchanged lighting
  rotation: t => t * 0.05,      // drift the whole rig
})

icosa({ radius: 1.2, detail: 6 })
  .noise({ amp: 0.15, freq: 2.5, speed: 0.3 })
  .material({ color: '#ffffff', roughness: 0.15, metalness: 1 })
  .out()
```

- `background: false` keeps the environment lighting but leaves `bg()`/`fog()`
  in charge of what you see.
- `blur` (0..1) softens the visible sky only; `intensity` scales the light,
  `backgroundIntensity` just the sky.
- `rotation` (radians) turns the lighting and the sky together;
  `backgroundRotation` slides the sky under fixed lighting.
- Everything but `background` takes a fn of `t` or a signal.

Prefiltering an HDRI is slow, so it happens once per file and is cached across
re-runs — the first `ctrl+enter` after importing one hitches, the rest don't.

## 3d text

`text3d('hi', { size, depth, bevel, res, font, weight, center })` extrudes
real type. `font` takes a bare name — resolved against your installed fonts
first (Chrome/Edge, one-time permission prompt), then fetched from Google
Fonts automatically. Use `'google:Name'` to skip the local lookup, or a
`.ttf`/`.otf`/`.typeface.json` URL for a specific file. Async fonts render as
helvetiker until they arrive, then swap in.

The permission prompt only opens off a keypress, so a sketch restored on page
load says `press ctrl+enter to allow font access` rather than failing quietly.
Where the local lookup can't answer — Firefox and Safari have no such API, and
macOS ships Helvetica, Avenir, Courier and Lucida Grande as `.ttc` collections
that can't be parsed — the common system faces fall back to their
metric-compatible Google twins: Arial and Helvetica to Arimo, Times New Roman
to Tinos, Courier New to Cousine, Georgia to Gelasio, Calibri to Carlito,
Cambria to Caladea. Same widths, so the line breaks land in the same places.

```js
ambient({ intensity: 0.3 })
directional({ intensity: 1.6 }).pos(2, 4, 6).out()

text3d('fizzle', { size: 1.2, depth: 0.3, bevel: 0.03 })
  .rotate(0, t => Math.sin(t * 0.6) * 0.4, 0)
  .color('#7ee787')
  .out()
```

Content can be a fn of `t`; the geometry rebuilds only when the string
changes, so clocks and counters are cheap. (The Google Fonts fetch is proxied
by `/api/gfont` — the dev server serves it under `npm run dev`, the hosted site
serves it as a function. A plain static build has neither, so `font:` there is
limited to installed fonts and font URLs.)

## lights, camera, scene

```js
bg('#07070c')
fog({ color: '#07070c', near: 6, far: 30 })
ambient({ intensity: 0.1 })
hemi({ sky: '#333366', ground: '#221100' }).out()
point({ color: '#4fd1c5', intensity: 70 }).pos(t => Math.cos(t) * 4, 2, t => Math.sin(t) * 4).out()
camera(t => Math.sin(t * 0.15) * 9, 4, t => Math.cos(t * 0.15) * 9)

plane({ width: 24, height: 24, res: 128 })
  .rotate(-Math.PI / 2, 0, 0)
  .noise({ amp: 1.2, freq: 0.35, octaves: 5, speed: 0.15 })
  .material({ color: '#222233', roughness: 0.9, flatShading: true })
  .out()
```

- Every light is configured the same way — `ambient({ intensity })`,
  `directional({ intensity, color })`, `point({ intensity, distance, decay })`
  — and every value takes a fn of `t`.
- `directional` / `point` / `spot` / `hemi` chain `.pos(x, y, z).out()`, and
  `.pos` accepts fns of `t` for moving lights. `ambient` is the exception: it
  arrives evenly from everywhere, so it has no position and adds itself without
  an `.out()`.
- `spot({ angle, penumbra })` is a cone from `.pos()` toward `.target()` —
  `angle` is its half-width in radians, `penumbra` (0..1) how soft the rim is.
  `directional` takes a `.target(x, y, z)` too; both aim at the origin without
  one, and both animate.
- `camera(x, y, z, [tx, ty, tz])` with static numbers places the camera and
  leaves orbit controls live. If **any** argument is a function of time, the
  sketch drives the camera and orbiting is disabled until you re-run without it.
- `bg(color)` and `fog({ color, near, far })` set the scene backdrop.

### shadows

Off until a light asks for them, on for every mesh once one does:

```js
directional({ intensity: 3, shadow: true }).pos(12, 8, 6).target(0, 0, -8).out()
spot({ intensity: 90, angle: 0.5, shadow: { soft: 5 } }).pos(0, 6, 4).out()

plane({ width: 40, height: 40, res: 1 }).rotate(-Math.PI / 2, 0, 0)
  .shadow({ cast: false })                     // flat — only catches
  .material({ color: '#8d879b', roughness: 0.8 }).out()
torus({ radius: 1.4, tube: 0.4 }).pos(0, 2, 0).rotate(t => t * 0.4, 0, 0).out()
```

- `shadow: true` on `directional` / `spot` / `point`. Ambient and hemisphere
  light comes from everywhere at once, so neither can cast.
- Geometry **casts and receives by default**, because it's free until a light
  casts. `.shadow(false)` opts a mesh out of both; `.shadow({ cast: false })`
  or `{ receive: false }` picks one — a ceiling has to say `cast: false` or the
  light never reaches the room, and a glowing lamp usually shouldn't block
  itself. Glass (`transmission`) and blended (`opacity` < 1) surfaces are the
  exception and don't cast by default: the depth pass can't tell they're
  see-through, so they'd throw the solid black shadow of their outline.
  `.shadow(true)` insists.
- Tuning, all on the light's `shadow` object: `soft` (blur radius in texels —
  0 hard-edged, ~8 overcast), `strength` (0..1, how dark), `map` (resolution,
  2048 by default), `near`/`far` (the light's own view range — a `far` far
  larger than the scene wastes depth precision and stripes flat surfaces),
  and for `directional` only, `area`: half the width of the box it shadows,
  measured around the `.pos()` → `.target()` axis. Too big and the map's
  texels spread thin, too small and the shadow stops mid-floor.
- A `point` light shadows in every direction at once — a cube map, so six
  renders. It's the expensive one.
- `.noise()` displacement is shadowed as displaced, not as the shape it started
  from. Geometry sent to `.out('name')` casts within its own layer.

## textures: the shader pipeline

The rendered scene is also a texture. Texture chains are shader passes over
textures, evaluated as a graph each frame; end a chain with `.out()` to make
it the display output. With no texture `.out()`, the scene renders directly.

```js
ambient({ intensity: 0.3 })
directional({ intensity: 1.5 }).pos(4, 6, 3).out()
torus({ radius: 1.2, tube: 0.4, res: 64 }).rotate(t => t * 0.5, t => t * 0.3, 0).color('#ff5f9e').out()

scene()
  .kaleido(6)
  .hue(t => t * 0.05)
  .out()
```

### sources

- `scene()` — the lit 3D render of everything sent to a naked `.out()`.
- `input()` — last frame's display output (a feedback loop; survives
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
- `voronoi({ scale, speed, blend, seed, mode, a, b })` — scattered points
  drifting over the frame, each pixel colored by the nearest one. `mode` is
  what gets drawn: `'cells'` fills each cell flat (its own point on the a→b
  ramp), `'distance'` shades by distance to the nearest point, `'edges'` lights
  only the seams. `blend` is how far past its own cell a pixel listens, in cell
  widths — 0 is hard, and raising it melts the cells together / rounds the
  wells / fattens the seams. All three modes shade `a`→`b`, so any of them is
  also a mask or a `.displace()` map.
- `text('hi', { size, color, bg, pos, font, weight, align })` — canvas-rendered
  text. `size` is a font size in screen px (values ≤ 1 = fraction of screen
  height); any CSS font, `\n` for multiline, content may be a fn of `t`.
- `video(name?)` — live camera (see **video input**).
- `videofile(name?)` / `imagefile(name?)` / `imageseq([names], index?)` —
  imported media files (see **media files**).

```js
ramp({ type: 'radial', a: '#1a0533', b: '#ff5f9e' })
  .comp(noise({ freq: 3, octaves: 4, speed: 0.3, a: '#000000', b: '#4fd1c5' }), 'screen', 0.7)
  .comp(text('fizzle'), 'add')
  .out()
```

Two `voronoi()` calls that agree on `scale`, `speed` and `seed` see the same
scatter of points, so their modes line up exactly and can be layered — cells
with their own seams lit on top:

```js
voronoi({ scale: 9, speed: 0.4, blend: 0.05, a: '#0d1030', b: '#7ee8ff' })
  .comp(voronoi({ scale: 9, speed: 0.4, mode: 'edges', b: '#ffd9a0' }), 'add')
  .bloom({ threshold: 0.6, strength: 0.8 })
  .out()
```

Every numeric parameter in every texture op takes `t => ...` or a signal, same as
geometry.

## color & filters

- `.add(v)` / `.mul(v)` — per-pixel math; scalar or `[r, g, b]`, negative `add` darkens.
- `.contrast(v)` · `.saturation(v)` · `.gamma(v)` — 1 = unchanged. Or combined: `.levels({ contrast, saturation, gamma, hue })`.
- `.hue(v)` — hue rotation in turns: `.hue(0.5)` flips the palette, `.hue(t => t * 0.1)` drifts it.
- `.posterize(steps)` — quantize values · `.pixellate(x, y?)` — quantize position.
- `.ascii({ chars, cols, rows, color, bg, font, weight })` — quantize *both*:
  the frame becomes a grid of characters, each cell drawn with the glyph whose
  ink matches its average brightness. `chars` is the vocabulary, ordered
  dark→bright — a set name (`'ascii'`, `'dense'`, `'blocks'`, `'numbers'`,
  `'letters'`, `'binary'`, `'dots'`) or any string of your own, since anything
  unrecognized is taken literally. Cells keep the color underneath them unless
  you pass a `color`, and `rows` follows from `cols` so the glyphs stay
  unstretched. What lands in which cell is a luma lookup, so contrast is the
  real control: `.levels({ contrast: 1.6 })` first if the set looks unused.
- `.threshold(level, { soft })` — luma → black/white mask · `.invert()`.
- `.blur(radius)` — separable gaussian, radius in texels. `[x, y]` gives a
  radius per axis — `.blur([8, 0])` smears along the scanline and nowhere else
  (an axis at 0 skips its pass, so it's cheaper too, not just narrower).
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

```js
scene()
  .levels({ contrast: 1.5 })
  .ascii({ cols: 110, chars: ' .:-=+*#%@', color: '#33ff66' })
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
  chain: return `src`, a treatment of it, or any other texture chain. `x` runs
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

`.comp(layer, { mode, opacity })` composites `layer` over the chain (positional
`.comp(layer, mode, opacity)` works too, and is the shorter one to type mid-set).
Modes:
`over` `add` `sub` `mult` `divide` `screen` `overlay` `hardLight` `softLight`
`darken` `lighten` `difference` `exclusion` `dodge` `burn` `luminosity`
`color`.

The last two are the non-separable pair — they move whole colors rather than
channels. `luminosity` keeps the **base's** color and takes the **layer's**
brightness; `color` does the reverse.

```js
noise({ freq: 3, channels: 3, speed: 0.3 })
  .blur([20, 6])
  .comp(text('fizzle', { color: '#dddddd', bg: '#222222' }), 'luminosity')
  .out()   // the noise's colors, the text's brightness
```

The layer contributes brightness *only*, so its own extremes are worth
avoiding: there is exactly one color at luminance 1 and one at 0, and asking
for either takes the base's hue with it. A layer of pure white text on pure
black comes back as pure white text on pure black — hence the grays above.

Between them they're a luma/chroma split with no dedicated op: blur a picture
into mush, comp the untouched original back over it in `luminosity`, and only
the color stayed blurred — which is what a composite video signal does to
color for real, and most of why VHS looks like VHS (see the **vhs** example).

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
  move": brighter than mid pushes one way, darker pushes the other. For dark
  maps where black should be neutral (`edge()` output, text on black), set
  `mid: 0`.
- **Grayscale maps are diagonal-locked** — R = G, so x and y always move
  together. For isotropic wobble, use `noise({ channels: 2 })`: independent
  fields in R and G.
- `.slope()` output is centered on 0.5 by construction, so displacing by a
  slope map needs no bias.

```js
text('fizzle')
  .displace(noise({ channels: 2, freq: 2, speed: 0.4 }), { amount: t => 0.04 + 0.03 * Math.sin(t) })
  .out()
```

With `mid: 0` and a hefty amount, a dark map cuts shapes out of the source —
a circle displaced by text:

```js
circle({ radius: 0.35, color: '#ffd166' })
  .displace(text('glossing'), { amount: 0.7, mid: 0 })
  .out()
```

`.remap(map)` is the absolute version: sample the chain at the map's RG
coordinates directly (the map **is** the UV space).

## a texture where a number goes

`.displace()` is not a special case. Hand a texture to any of the parameters below
and it stops being one number for the whole frame: each pixel reads its own
value out of that map, sampled at the same UV.

```js
scene()
  .kaleido(noise({ freq: 1.5, speed: 0.2 }).mul(10).add(3))   // fold count by region
  .hue(noise({ freq: 3, speed: 0.3 }))                        // spectrum by region
  .out()
```

The slots that take one:

| call | keys |
| --- | --- |
| `.transform()` | `translate`, `scale`, `rotate` |
| `.warp()` | `barrel`, `twist`, `zoom`, `center` |
| `.kaleido()` | `sides`, `rotate` |
| `.levels()` (and `.contrast/.saturation/.gamma/.hue`) | `contrast`, `saturation`, `gamma`, `hue` |
| `.pixellate()` | `x`, `y` |
| `.threshold()` | `level`, `soft` |
| `.posterize()` | `steps` |
| `.chroma()` | `amount`, `angle`, `center` |
| `.mirror()` | `flip` |
| `.mul()` / `.add()` | the value itself |
| `circle()` | `radius`, `soft`, `center` |
| `voronoi()` | `blend` |

Two rules cover the whole set:

- **Which channels.** A two-component slot (`translate`, `scale`, `center`)
  reads **R and G**, a three-component one (`.mul()`, `.add()`) reads **RGB**,
  and a scalar slot (`rotate`, `sides`, `hue`, `barrel`, `level`, …) reads
  **luma**. So a grayscale map drives a two-component slot along the
  diagonal — `noise({ channels: 2 })` when you want the axes independent.
- **What the number is.** By default the sample *is* the value, in the units
  the number would have been: `.rotate(map)` turns each pixel by 0..1 radians.
  Render targets are half-float, so `.mul()`/`.add()` on the map itself reach
  past 0..1 in either direction and are the normal way to set a range.

For the case where the range has to be set *after* the map is read — a bias, so
an unsigned map swings both ways — the slot also takes `{ map, amount, mid }`,
which resolves to `(sample - mid) * amount`:

```js
scene().transform({ translate: { map: noise({ channels: 2 }), amount: 0.1, mid: 0.5 } })
```

That line **is** `.displace(noise({ channels: 2 }), 0.1)` — same pass, same
pixels. `mid: 0.5` is the whole difference between `translate` and `displace`:
without it a `noise()` map only ever pushes +x/+y, because it never goes
negative. `amount` and `mid` take fns of `t` like anything else.

A texture in a slot that has no per-pixel form (`.blur()`, `.bloom()`, …)
warns and falls back to the default rather than taking the picture down.

`circle()` and `voronoi()` are on the list too, and they are the odd ones —
*generators* whose shape a texture decides.
`circle({ radius: noise({ freq: 3 }).mul(0.1).add(0.25) })` is a disc whose rim
wanders: a blob, and a mask that no longer looks stamped on. `voronoi({ blend:
ramp({ type: 'radial' }) })` is a pattern that is cracked glass at the center
and melted wax at the rim.

## buses, layers & feedback

`.out('name')` publishes instead of displaying, and `input('name')` reads the
bus anywhere — including in a completely separate chain, so networks don't
have to be a single expression.

```js
ambient({ intensity: 0.3 })
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
pulls that layer as a texture — same camera, lit, on a black background, so
layers comp cleanly with `add`/`screen`/`lighten`. Lights hit every layer by default;
a light's own `.out('name')` restricts it to one layer.

```js
ambient({ intensity: 0.3 })
directional({ intensity: 1.4 }).pos(4, 6, 3).out()

torusKnot({ res: 96 }).rotate(0, t => t * 0.5, 0).color('#8899ff').out('knot')
icosa({ radius: 1.2 }).noise({ amp: 0.3, speed: 0.4 }).color('#ff5f9e').out('blob')

input('knot').edge({ strength: 2 })
  .comp(input('blob').pixellate(90), 'add')
  .out()
```

### texture chains as material maps

The other direction: any texture chain can be a **map on a material**, wherever a
filename goes. The chain re-renders every frame, so the surface is live.

```js
ambient({ intensity: 0.5 })
directional({ intensity: 2.4 }).pos(3, 5, 4).out()

box({ width: 4.4, height: 2.8, depth: 0.25, res: 2 })
  .rotate(0, t => Math.sin(t * 0.4) * 0.6, 0)
  .material({
    map: noise({ freq: 3, octaves: 4, speed: 0.3, a: '#1a0533', b: '#4fd1c5' })
      .kaleido(6)
      .levels({ contrast: 1.3 }),
    roughnessMap: noise({ freq: 6, speed: 0.2 }),
    metalness: 0.2,
  })
  .out()
```

Any source works — generators as above, `video()`, `imagefile()`, a bus. Every
slot takes one too: `map` for color, but also `normalMap`, `roughnessMap`,
`displacementMap`, `aoMap`, `metalnessMap`, and `arm` to feed the packed three
at once. `noise({ freq: 8 }).normalMap()` is a live bumpy surface; `noise()`
into `displacementMap` on a high-`res` shape is a moving terrain.

`repeat` / `offset` / `uvRotate` work as usual, and each binding gets its own
copy of the chain's output, so two materials can tile one chain differently.

A bus works here like anywhere else, which is how you build a chain once and
hang it on several surfaces — or just keep the wiring readable:

```js
ambient({ intensity: 0.4 })
directional({ intensity: 1.4 }).pos(3, 5, 6).out()

ramp({ type: 'angular', a: '#1a0533', b: '#ff5f9e' })
  .rotate(t => t * 0.3)
  .posterize(6)
  .out('feed')

plane({ width: 4, height: 2.5 }).pos(-2.5, 0, 0)
  .material({ map: input('feed') })
  .out()

box({ res: 2 }).scale(2).pos(2.5, 0, 0)
  .material({ map: input('feed').invert(), roughness: 0.3 })
  .out()
```

A map is a surface, not a light: these are lit like anything else, and a
mapped shape in an unlit scene is as black as an unmapped one.

Chains this way are a **pre-pass**: they render at the top of the frame, before
the 3D render that samples them. Anything that doesn't depend on the 3D render
is therefore current — a video, a generator, a bus like the one above, all
this frame's. The single exception is `scene()`, which can only be last frame's
render, since this frame's is the thing waiting on the texture. That's the same
rule `input()` follows, and it's a feedback loop worth having — a screen inside
the scene showing the scene, one frame behind:

```js
bg('#101a2e')
ambient({ intensity: 0.35 })
directional({ intensity: 1.5 }).pos(3, 5, 6).out()

plane({ width: 4, height: 3 })
  .pos(0, 1, -2)
  .material({ map: scene().transform({ scale: 0.98 }).hue(0.02) })
  .out()

torus({ radius: 0.6, tube: 0.22, res: 48 })
  .pos(t => Math.sin(t) * 1.6, 1, 0.6)
  .rotate(t => t * 0.7, t => t * 0.4, 0)
  .color('#ffd166')
  .out()
```

The screen has to have something to show, hence the torus in front of it: the
loop only ever hands back what the camera saw last frame, so a scene whose
only object *is* the screen stays black forever.

A sketch can be entirely 3D and still use this — with no texture `.out()`
anywhere, the scene still displays as normal and only the map chains run.

## video input

`video(name?)` is a live camera as a texture generator. No name = the default
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

## media files

Drag a video, image, audio, model or HDRI file (or a handful, or a whole
folder) into the window: it's imported into the browser (IndexedDB — no
upload, survives reloads) and a ready-made call lands at your cursor. Files
are referenced by filename —
exact, or case-insensitive substring, so `videofile('clip')` finds
`clip.mp4`. Running an **empty** call (`videofile()`, `imagefile()`,
`audiofile()`, `imageseq()`, `model()`) opens a file picker and fills the name
in for you; an empty `hdri()` or `.material()` opens the Poly Haven browser
the same way. Since the name ends up in the code, deleting it back down to an
empty call and running again is how you pick something else.

The picker rides the ctrl+enter that ran the sketch — browsers only open file
dialogs off a keypress or click. A sketch that runs on page load (the last one
you had open, restored) has no such gesture, so it says which key to press in
the status bar and waits. An unmatched name lists what's imported in the
console.

**Starter files.** Three imports come with fizzle, so the examples above run
before you've dropped anything in: `ship.obj`, the HDRI
`kloofendal_43d_clear_puresky_1k.hdr`, and the material
`cobblestone_floor_08_1k` (the latter two from Poly Haven, CC0). They resolve
by name like anything else, and an import of the same name shadows them.

- `videofile(name?, { speed, loop, mute, restart })` — a looping video as a
  texture. `speed` and `loop` take fns of `t`; `mute: false` unmutes its
  soundtrack.
- `imagefile(name?)` — a still image as a texture.
- `imageseq([names], index?)` — several images with a signal choosing the
  current one (floored, wrapped). Dropping multiple images at once types
  `imageseq([...], beat(1).counter())` for you — swap the index for any
  counter: `.counter()` of `.kicks()` steps on kicks, `rand().beat(1).mul(9)`
  jumps randomly each beat. Default: one image per second.
- `audiofile(name?, { volume, speed, loop, restart, chan })` — an audio file,
  played out loud and analysed like `audio()`: it returns a level **signal**
  (see below), so `.kicks()`, `.lowpass()`, `.smooth()` all work on it.
- `model(name?, { center, fit })` — an `.obj`/`.fbx` as a geometry op, not a
  texture: it starts a chain like `sphere()` does (see **geometry**).
- `hdri(name?, { ... })` — an `.hdr`/`.exr` panorama as environment lighting
  (see **hdri**). An empty call browses Poly Haven rather than opening a file
  picker, since there's no local file to point at yet; **from disk…** in that
  browser is the file picker.
- A **folder** of images whose names read as different maps of one material is
  imported as a material rather than a pile of pictures, and typed out as a
  textured shape (see **textured materials**). Files dropped inside a folder
  keep a `folder/file.jpg` name, so a dozen materials' worth of
  identically-named `Color.jpg`s stay apart.

Files keep playing through re-runs (like camera streams), so livecoding
doesn't restart your clip. To rewind:

- `ctrl+r` — restart all media files, from the keyboard.
- `restartMedia(name?)` — in a sketch; runs on every execute. No name = all,
  a name matches by substring.
- `restart:` option — a fn of `t` or signal; a rising edge through 0.5
  rewinds. `videofile('clip.mp4', { restart: beat(8).sqr(0.05) })` restarts
  every 8 beats; `{ restart: audio().kicks() }` on every kick.

No video or audio ships with fizzle, so this one is a template rather than a
live block — drop your own files in and the names write themselves:

```js static
const kick = audiofile('drums.mp3').bandpass(30, 160).kicks()

videofile('clip.mp4', { speed: 1, restart: beat(16).sqr(0.05) })
  .comp(imageseq(['a.png', 'b.png', 'c.png'], kick.counter()), 'screen', 0.5)
  .scale(kick.mul(0.1).add(1))
  .out()
```

## audio signals

`audio()` turns the mic (or any input device — pick it in the sidebar) into a
**signal**: a function of time with processing methods, so it drops straight
into any parameter. First use starts capture (browser permission prompt).

```js
const kick = audio().bandpass(30, 160).kicks()
const bass = audio().lowpass(150).smooth(0.03, 0.2)

ambient({ intensity: 0.2 })
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
`t`, 0..1 — the signal cousin of the `noise()` texture (positional
`rand(freq, seed)` works too). Different seeds give independent signals —
`rand({ seed: i })` inside a `.tile()` or `.instance()` fn gives every copy its
own. `.beat(div)` snaps it to the grid, and `.hold` samples a new random value
per trigger:

```js
const hit = beat(1).sqr(0.1)   // stand-in trigger: fires each beat (try audio().kicks())

ambient({ intensity: 0.25 })
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
ambient({ intensity: 0.3 })
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
