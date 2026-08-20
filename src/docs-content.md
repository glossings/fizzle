## fizzle

Fizzle is a livecoding environment for visual art: a fullscreen canvas behind a
live code editor, with a two-sided pipeline. 3D **geometry**, lights and
cameras on one side, a **texture** graph of shader passes on the other.

**Every code block below is a real editor.** Change anything and press **▶**
(or `ctrl+enter` inside the block) to run it in the preview; **⧉** opens it in
the full app. Try it:

```js autorun
bg('#05060a')
ambient({ intensity: 0.15 })
directional({ intensity: 1.6 }).position(4, 6, 3).out()

torusKnot({ radius: 1.1, tube: 0.32, res: 96 })
  .rotation(t => t * 0.4, t => t * 0.23, 0)
  .noise({ amp: 0.07, freq: 2.2, octaves: 4, speed: 0.5 })
  .material({ color: '#4fd1c5', roughness: 0.25, metalness: 0.6 })
  .out()

scene()
  .comp(
    input()
      .transform({ scale: 1.2, rotate: 0.05 })
      .hue(0.05)
      .mul(0.9),
    'add',
    0.7
  )
  .bloom({ threshold: 0.65, strength: 0.5 })
  .out()
```

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
| `ctrl + h` | hide / show the editor (the projector's code, while one is open) |
| `ctrl + m` | hide / show the editor in this window, projector or not |
| `ctrl + p` | toggle the sidebar (settings & sketches) |
| `ctrl + ]` / `ctrl + [` | next / previous sketch in the playlist |
| `ctrl + hover` | pop docs for the API name under the cursor |
| `F1` | open / close the projector window |
| `ctrl + e` | start / stop recording |
| `ctrl + r` | restart media and accumulated state |
| drag / scroll | orbit / zoom the camera |

On a phone, the cameras are `video('front')` / `video('back')`.

**Projector (`F1`)** opens a second window with only the visuals and the code
in it, mirroring your typing. Press **`f`** in it (or double-click) for
fullscreen. While it's open `ctrl + h` hides the code **on the projector**;
`ctrl + m` always means your own window.

**Recording (`ctrl + e`)** asks where to put the file and starts rolling; the
same key stops it. Chrome and Edge write to the file as it goes, so a ten
minute take never sits in the tab.

The sidebar's **recording** setting picks the container, and the save dialog's
own format menu opens on it — so change it there for one take, or in the
sidebar for every take after. `.mkv` and `.webm` stay playable even if the
recording is cut off part way, which is what you want mid-set; `.mp4` needs a
clean stop but opens in anything, QuickTime and Premiere included.

Where there's no save dialog the take is held in memory until you stop, and
comes out as a download instead. The counter in the corner shows how much of
the tab it's using, and recording stops on its own before it's enough to lose.

The file is the picture at full size, whatever the window is doing:
`resolution(1920, 1080)` records 1920×1080 from a half-size window, and the
letterbox bars never make it in. Without a `resolution()` there's no size to
hold to, so the file is what the window is really rendering, quality included.

**rec. audio** puts the sound in the file: the audio input as it arrives, plus
any `audiofile()` at the volume you set. It's on by default, and the track is
there from the first frame whether anything is making noise yet or not, so a
take started before the music still gets it.

The code is in the recording exactly when it's on screen, so `ctrl + h` (or
`ctrl + m` with no projector) takes it out of the file too — decided when you
press record, so a take that starts with the code hidden stays that way, and
the status line says so if you show it part way through. Hiding it first also
costs the sketch nothing at all: with nothing to draw over the picture the
canvas is recorded straight. **rec. scale** trades size for speed on the takes
that do carry code.

The `● 0:42` in the corner is yours alone — it's not in the file and not on the
projector.

Recording is desktop-only for now: a phone's own screen recorder does a better
job of a phone than this can.

**Playlists.** The sidebar's **sketches** tab searches names and tags. Every
sketch tags itself with what it uses (`3d`, `2d`, `fx`, `particles`, `audio`,
`cam`, `media`, `hdri`, plus its size when it pins one), so `tag:audio 3d`
narrows to what you meant, and dates are searchable the same way, so `2026-08`
finds that month's work. **organize** opens a window for adding your own tags
and building playlists; the same sketch can sit in as many as you like. Its
**sort** orders every sketch by name, newest, or last edited, and the sidebar's
list follows. Open a
playlist in the **playlists** tab and `ctrl + ]` / `ctrl + [` walk its running
order. With no playlist open they walk the list on screen instead, so a search
is a shortlist you can step through. Playlists and tags are saved in
`sketches/user/library.json`, alongside the sketches they play.

**`resolution(width, height)`** pins the render to an exact size and shape,
letterboxed in your window and matched by the projector's, so
`resolution(1920, 1080)` before a set is the whole setup. Sidebar quality
still scales the pixels underneath. The sidebar's **fixed resolution** sets the
same thing for every sketch and overrides the call while it's on.

Every run mirrors the code into the URL hash, so the address bar is always a
shareable link. The browser's back and forward buttons step through the
sketches you ran. Imported files don't travel with it; Poly Haven names do (see
**media files**).

## time is a parameter

**Every numeric parameter accepts a function of time.** Pass a number for a
static value, `t => ...` for an animated one. Positions, radii, amounts,
rotations, colors, all of it.

```js
ambient({ intensity: 0.3 })
directional({ intensity: 1.5 }).position(3, 5, 2).out()

sphere({ radius: 1, res: 64 })
  .position(t => Math.sin(t) * 2, 0, 0)
  .scale(t => 1 + 0.3 * Math.sin(t * 3))
  .color('#8899ff')
  .out()
```

### colors

Every color slot accepts any of these four forms:

```js static
'#4fd1c5'            // hex
'tomato'             // any CSS color name
0x4fd1c5             // number
[0.31, 0.82, 0.77]   // rgb, each channel 0..1
```

In the array form, each channel may also accept a function of `t`:

```js
ambient({ intensity: 0.4 })
directional({ intensity: 1.4 }).position(3, 5, 2).out()

sphere({ radius: 1.4, res: 96 })
  .color([t => Math.sin(t) * 0.5 + 0.5, 0.3, t => Math.cos(t * 0.7) * 0.5 + 0.5])
  .material({ roughness: 0.35 })
  .out()
```

`hsl(h, s, l)` builds the same array from the wheel instead of from channels.
Hue is in turns, so `rand()` covers the whole circle while the brightness you
picked stays put:

```js
ambient({ intensity: 0.4 })
directional({ intensity: 1.4 }).position(3, 5, 2).out()

sphere({ radius: 1.4, res: 96 })
  .color(hsl(rand(0.2), 0.8, 0.5))   // random hue, lightness fixed at 0.5
  .material({ roughness: 0.35 })
  .out()
```

Every argument takes a signal, so the timing is whatever you drive it with:
`hsl(rand().beat(1), 0.8, 0.5)` re-rolls the color once a bar,
`hsl(t => t * 0.05, 0.8, 0.5)` walks the wheel, and a static
`hsl(0.55, 0.4, 0.15)` is just a color. A fourth argument is alpha.

`hsv(h, s, v)` is the same wheel measured the way a paint program measures it:
`v` is the brightest channel rather than the midpoint, so `hsv(0.55)` on its
own is the vivid hue, `hsv(0.55, 0, 1)` is white and `hsv(0.55, 1, 0.4)` is a
dark version of the same color. Reach for whichever axis you think in.

**Texture** color slots take three more forms that carry transparency: `null`
(nothing at all), `[r, g, b, a]`, and `'#rrggbbaa'`. See **compositing**. 3D
colors stay opaque; a material's transparency is its `opacity`.

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
| `capsule` | `radius: 0.5, height: 1, res: 48` — `height` is the middle only |
| `icosa` | `radius: 1, res: 8` — even triangles, ideal for noise blobs |
| `model` | `name, center: true, fit: 2` — an imported `.obj`/`.fbx` |

`res` matters for `.noise()`: displacement is per-vertex, so more resolution
means finer detail.

### model — an .obj / .fbx, yours or Poly Haven's

Drag an `.obj` or `.fbx` in and it's imported, with the call typed at your
cursor. `name` matches on a case-insensitive substring, so `model('ship')`
finds `ship_final_v2.fbx`. A model is a geometry op like any other. Every
chain method works on it, `.instance()` included.

```js
ambient({ intensity: 0.2 })
directional({ intensity: 1.4 }).position(4, 6, 3).out()

model('ship.obj')
  .instance(40, (x, i, n, t) => {
    const a = (i / n) * Math.PI * 2
    x.position(Math.cos(a) * 4, 0, Math.sin(a) * 4).rotation(0, t * 0.5 + i, 0).scale(0.4)
  })
  .material({ color: '#ffd166', roughness: 0.4 })
  .out()
```

An empty `model()` browses [Poly Haven](https://polyhaven.com)'s CC0 models.
It's searchable, with the polygon count on each card. The pick downloads as an
`.fbx`, plus its material when the asset publishes one texture set, so the call
fills in already shaded:

```js static
model('polyhaven:BarberShopChair_01.fbx')
  .material({ pbr: 'polyhaven:BarberShopChair_01_2k' })
  .out()
```

**from disk…** picks a local file instead. Foliage is the one thing that can't
look right yet: materials have no alpha cutout and leaves are modelled as cards.

Everything in the file merges into a single geometry. Its own materials are
dropped, so `.material()` shades it. By default the geometry is centered and
scaled so its longest axis is `fit: 2`, about the size of a default `sphere()`.
Pass `fit: 0` to keep the file's units, `center: false` to keep its origin.
Parsing is cached across re-runs, so only a fresh import is briefly empty.

### transforms

`.position(x, y, z)` · `.rotation(x, y, z)` (radians) · `.scale(x, y?, z?)` —
one argument to `.scale` is uniform. Every component takes numbers or
functions of `t`.

`.pos` and `.rot` are short forms of the first two, and textures have `.trans`
and `.rot`.

### .noise — vertex displacement

fbm simplex displacement along vertex normals, with normals recomputed so
lighting follows the new surface.

```js
ambient({ intensity: 0.15 })
directional({ intensity: 0.8 }).position(-3, 4, 5).out()
point({ color: '#ff5f9e', intensity: 80 }).position(t => Math.sin(t) * 4, 3, 2).out()

icosa({ radius: 1.3, res: 16 })
  .noise({ amp: 0.35, period: 0.5, octaves: 4, speed: 0.4 })
  .material({ color: '#8899ff', roughness: 0.3 })
  .out()
```

- `amp` — displacement distance · `period` — world units between peaks (or
  `freq`, bumps per unit — the same number the other way up)
- `octaves` (1–8) — how many detail layers get stacked
- `lacunarity` — frequency step per octave (2 = each layer twice as fine)
- `gain` — amplitude falloff per octave: low ≈ only the smooth base layer,
  high = crinkly detail. It shapes roughness, not overall strength. That's `amp`.
- `speed` — animates the field · `seed` — same settings, different shape

### .displace — vertex displacement from a texture

The same thing driven by a picture: each vertex moves along its normal by the
map's brightness at its uv, normals rebuilt from the map's gradient. The map is
an imported image by name, or a whole live texture chain. A chain animates, so
the geometry does too.

```js
ambient({ intensity: 0.3 })
directional({ intensity: 2 }).position(4, 6, 3).out()

const height = voronoi({ freq: 5, speed: 0.2 }).blur(2)

sphere({ radius: 1.4, res: 200 })
  .displace(height, { amount: 0.5 })
  .material({ color: '#8899ff', roughness: 0.4 })
  .out()
```

- `amount` — how far a vertex moves, in world units. Negative pulls inward.
- `mid` — the map value that means no movement. The default 0.5 lets a
  mid-gray map push both ways; `mid: 0` only ever pushes out.
- `smooth` — how wide each vertex reads the map. See below.
- All three take functions of `t`.

Detail comes from `res`, not from the map. A `sphere()` at the default
`res: 64` has nowhere near enough vertices to show a photo.

**Several `.displace()` calls stack**. `.noise()` joins the same sum: one
wide map for the form, one fine map for the texture on it.

```js
ambient({ intensity: 0.25 })
directional({ intensity: 1.8 }).position(4, 6, 3).out()

sphere({ radius: 1.4, res: 260 })
  .displace(noise({ period: 1.2, speed: 0.1 }), { amount: 0.5 })
  .displace(voronoi({ freq: 14, mode: 'edges' }), { amount: 0.06, smooth: 0.6 })
  .material({ color: '#c2b8a3', roughness: 0.7 })
  .out()
```

### .instance — many copies, one mesh

`.instance(count, fn)` renders the chain as one `InstancedMesh`.
`fn(x, i, count, t)` hands you each copy as `x`, transformed with the same
verbs as the chain: `.position` · `.rotation` · `.scale`. It runs every frame,
so instances animate. Each copy seeds `.noise()` from its own position, so
copies deform differently.

```js
ambient({ intensity: 0.2 })
directional({ intensity: 1.4 }).position(4, 6, 3).out()

box({ res: 4 })
  .instance(80, (x, i, n, t) => {
    const a = (i / n) * Math.PI * 2
    x.position(Math.cos(a) * 3, Math.sin(t + i * 0.4) * 0.8, Math.sin(a) * 3)
      .rotation(0, a, 0)
      .scale(0.35)
  })
  .material({ color: '#ffd166', roughness: 0.4 })
  .out()
```

`x.color(c)` tints one copy, multiplied with the chain's material color:
`x.color(i % 2 ? '#ffd166' : '#4fd1c5')`.

The batch is one mesh with one material, so `.noise()`, the rest of
`.material()` and `.out()` are shared and belong on the chain, not on `x`.

A texture can drive the layout: `.field()` reads a chain back as numbers the
fn can sample. See **a texture read back as numbers**.

### a picture per copy

`map:` also takes a list. Every entry renders into one layer of a texture the
whole batch shares, and `x.tile(n)` picks the layer a copy wears. Counts round,
so `.tile(i)` across more copies than there are pictures repeats the set.

```js
ambient({ intensity: 0.4 })
directional({ intensity: 1.4 }).position(3, 5, 4).out()

const cards = 'FIZZLE'.split('').map((c) => text(c, { size: 0.7, bg: '#1b1b22' }))

plane({ width: 0.9, height: 0.9, res: 1 })
  .instance(24, (x, i, n, t) => {
    x.position((i % 6) * 1.1 - 2.75, ((i / 6) | 0) * 1.1 - 1.65, 0)
      .rotation(0, Math.sin(t + i * 0.3) * 0.5, 0)
      .tile(i)
  })
  .material({ map: cards, roughness: 0.6 })
  .out()
```

Entries are ordinary sources: `text()`, an imported image by name, `imagefile()`,
or any chain, and a live one keeps moving in the slot. They share one size,
`tileSize: 256` square by default, and draw at that size's aspect rather than
the frame's, so a square tile gets a square `text()` instead of a widescreen one.

Only `map:` takes a list. The other slots are one texture for the whole batch.

### a shape as a function — copies that differ

`.out()` doesn't copy the op, so sending one out twice gives two meshes reading
the same transform. Both land wherever the last call left it:

```js
ambient({ intensity: 0.3 })
directional({ intensity: 1.5 }).position(3, 5, 4).out()

const ball = sphere({ radius: 0.5 }).material({ color: '#4fd1c5' })
ball.position(-3).out()
ball.position(3).out()          // one op, so both meshes sit at x = 3
```

`.instance()` covers copies that share a material. When they need their own
color, their own `.noise()`, or a different shape entirely, make the shape a
function. Each call builds a fresh op:

```js
ambient({ intensity: 0.3 })
directional({ intensity: 1.5 }).position(3, 5, 4).out()

const ball = (color) => sphere({ radius: 0.5 }).material({ color })

ball('#4fd1c5').position(-3).out()
ball('#7ee787').position(3).out()
```

### materials

`.material({ color, roughness, metalness, emissive, emissiveIntensity,
flatShading, wireframe, doubleSide })` — PBR settings. `doubleSide` renders
back faces too. It's on by default for `plane()` and `model()`. `.color(c)` is
shorthand for `.material({ color })`; see [colors](#colors) for the four forms
every color slot takes.

`opacity` fades a surface out and switches on blending by itself. Name
`transparent` only to override that, and `depthWrite: false` when a pile of
overlapping transparent shapes pops as the camera turns. A misspelled property
warns in the console rather than silently doing nothing.

### glass & coatings

Naming any of these upgrades the mesh to a physical material. That's the
pricier shader, so a sketch that never mentions them pays nothing. All take
functions of `t`.

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

Transmission and iridescence reflect their surroundings, so they need an
`hdri()` environment far more than they need point lights.

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

- **Run an empty `.material()`** to browse [Poly Haven](https://polyhaven.com)'s
  CC0 materials. Your pick downloads locally and the `pbr:` lands in that same
  call, tagged `polyhaven:` so it downloads itself on someone else's machine.
  `esc` cancels; **from disk…** picks your own files.
- **Drag a folder of maps in** from anywhere else (ambientCG, cgbookcase, a
  Substance export). Files keep a `folder/file.jpg` name, and the folder is
  the handle: `.material({ pbr: 'rock_wall' })`.

```js
ambient({ intensity: 0.35 })
directional({ intensity: 1.6 }).position(4, 6, 3).out()

sphere({ radius: 1.4, res: 128 })
  .material()   // ctrl+enter -> browse -> .material({ pbr: 'moss_2k', repeat: 2 })
  .out()
```

Filenames decide which image is which map, so the usual conventions all land:
`diff`/`albedo`/`Color`/`_D` for color, `nor_gl`/`NormalGL`/`_N` for normals,
`Roughness`/`_R`, `AmbientOcclusion`, `Displacement`/`height`, and `arm`/`orm`
for the packed AO+roughness+metalness image. `NormalDX` is used only when no
OpenGL normal shipped alongside.

Individual slots take an imported image by name, or mix with a set:

```js
ambient({ intensity: 0.3 })
directional({ intensity: 1.6 }).position(4, 8, 6).out()
camera(0, 3, 9)

plane({ width: 20, height: 20, res: 200 })
  .rotation(-Math.PI / 2, 0, 0)
  .position(0, -1.5, 0)
  .material({ pbr: 'cobblestone_floor_08_1k', repeat: 8, displaceScale: 0.4 })
  .out()

box({ res: 2 })
  .scale(2)
  .rotation(0, t => t * 0.3, 0)
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
  Any slot also takes a live texture chain instead of a filename. See
  **texture chains as material maps**.
- **tiling** — `repeat` (a number, or `[x, y]`), `offset`, `uvRotate`
  (radians). These apply to every map on the material.
- **tuning** — `normalScale` (relief strength), `aoIntensity`,
  `displaceScale` / `displaceBias`, `envIntensity` (how hard the HDRI hits
  this material).
- `roughness` and `metalness` **multiply** their maps, so they default to 1
  once one lands. Name them only to push a material further
  (`{ pbr: 'wood_2k', roughness: 0.3 }` for a varnished version).

Displacement moves real vertices, so give the shape `res: 128` or more or
nothing happens. It stacks with `.noise()`. Maps load asynchronously: a fresh
import renders untextured for a frame or two, re-runs come from cache.

### hdri — environment lighting

`hdri(name?, { background, intensity, blur, rotation })` lights the scene with
an imported `.hdr`/`.exr` panorama, which also becomes the backdrop. Run an
empty `hdri()` to browse Poly Haven's HDRIs, or drag a file in.

It's what makes `metalness` mean anything: metal is almost entirely reflection,
so crank it under plain lights and you get black.

```js
hdri('kloofendal_43d_clear_puresky_1k.hdr', {
  blur: 0.4,                    // soft sky, unchanged lighting
  rotation: t => t * 0.05,      // drift the whole rig
})

icosa({ radius: 1.2, res: 6 })
  .noise({ amp: 0.15, period: 0.4, speed: 0.3 })
  .material({ color: '#ffffff', roughness: 0.15, metalness: 1 })
  .out()
```

- `background: false` keeps the environment lighting but leaves `bg()`/`fog()`
  in charge of what you see.
- `blur` (0..1) softens the visible sky only; `intensity` scales the light,
  `backgroundIntensity` just the sky.
- `rotation` (radians) turns the lighting and the sky together;
  `backgroundRotation` slides the sky under fixed lighting.
- Everything but `background` takes a function of `t` or a signal.

Prefiltering is cached per file, so only the first run after importing hitches.

## layout

`layout(depth, rule)` runs your rule with a cursor. `.span()` moves the cursor
forward and leaves a copy spanning the step, `.branch()` grows children that run
the same rule again, and it keeps going until `depth` generations are up.
`.instance()` draws the result.

```js
ambient({ intensity: 0.35 })
directional({ intensity: 2.4 }).position(5, 8, 4).out()

const tree = layout(12, (e) => {
  e.span(1)
  e.branch((x) => x.turn(0.5).scale(0.72))
  e.branch((x) => x.turn(-0.5).scale(0.72))
})

box({ width: 0.16, height: 1, depth: 0.16 })
  .instance(tree)
  .material({ color: '#a8834f', roughness: 0.8 })
  .out()

camera(0, 2, 7, [0, 1.9, 0])
```

### the cursor

The rule moves the cursor and asks it where it is. Heading is `+Y`, and a shape
one unit long (`box({ height: 1 })`, `capsule()`) spans one `.span(1)` exactly.

| verb | what it does |
|---|---|
| `.span(dist, label, data)` | move forward, leaving a copy that spans the step, so segments meet end to end |
| `.forward(dist)` | step along the heading without placing anything, scaled by the cursor |
| `.turn(angle, pitch, roll)` | radians: `angle` turns flat, `pitch` tilts out of that plane, `roll` spins about the heading |
| `.scale(f)` | shrink, compounding down the branch |
| `.place(label, data)` | record a copy centered on the cursor, for a tip or a scatter rather than a segment |
| `.branch(step, rule)` | grow a child: `step` shapes it, then the rule runs again one generation deeper |
| `.rand(seed)` | a random 0..1 that holds still |

| read | what it says |
|---|---|
| `.size` | the scale it has accumulated |
| `.depth` | which generation the rule is in |
| `.distance` | how far it has walked from the root |
| `.position` | `[x, y, z]`, where it stands |

A rule can also end a limb by returning without branching, which is how a
structure gets uneven. That is what the reads are for: `if (e.size < 0.3)
return` stops thin twigs before fat ones; `if (e.position[1] < 0) return` keeps
it above ground.

`.rand()` gives each node its own value and keeps it, so a random structure
holds still across re-runs instead of reshuffling while you edit.

### labels — one structure, several shapes

`.place(label)` names what belongs at a copy, and `.filter(label)` narrows the
layout to those copies, a layout of its own with its own chain. `.depth(i)` and
`.data(i)` say which generation a copy came from and whatever `.place()`
recorded alongside its label.

```js
bg('#0a0d12')
ambient({ intensity: 0.35 })
directional({ color: '#ffe9c4', intensity: 2.6 }).position(5, 8, 4).out()

const tree = layout((e) => {
  e.span(1, 'wood')
  if (e.size < 0.3) { e.place('leaf', { hue: e.rand() }); return }
  const spin = e.rand(1) * 6.28
  e.branch((x) => x.turn(0.55, 0, spin).scale(0.72))
  e.branch((x) => x.turn(-0.5, 0, spin + 2.2).scale(0.78))
})

const wood = tree.filter('wood')
const leaf = tree.filter('leaf')

box({ width: 0.17, height: 1, depth: 0.17 })
  .instance(wood, (x, i) => x.color(hsl(0.08, 0.4, 0.14 + wood.depth(i) * 0.035)))
  .material({ roughness: 0.85 })
  .out()

icosa({ radius: 0.2, res: 1 })
  .instance(leaf, (x, i) => x.color(hsl(0.24 + leaf.data(i).hue * 0.1, 0.65, 0.45)))
  .material({ roughness: 0.5 })
  .out()

camera(0, 2, 6.5, [0.15, 1.85, 0])
```

`.instance(layout)` brings its own count. A function alongside it runs after the
structure has placed the copy, which is where a tint or a wobble goes.

`.filter()` also takes a function, handed `{ label, data, depth }` per copy:

```js static
const ripe = tree.filter((p) => p.label === 'leaf' && p.data.hue > 0.5)
const crown = tree.filter((p) => p.depth > 3)
```

Filters compose: `tree.filter('leaf').filter(fn)` narrows the leaves.

### moving

The structure is fixed when the rule runs, but the steps stay live: any cursor
argument takes a function of `t`. A `.turn()` that moves sways everything grown
past it, compounding down the hierarchy.

```js
bg('#0a0d12')
ambient({ intensity: 0.35 })
directional({ intensity: 2.4 }).position(5, 8, 4).out()

const sway = (a) => (t) => a + Math.sin(t * 0.6 + a * 6) * 0.08

const tree = layout(10, (e) => {
  e.span(1)
  e.branch((x) => x.turn(sway(0.55)).scale(0.72))
  e.branch((x) => x.turn(sway(-0.5)).scale(0.72))
})

capsule({ radius: 0.09, height: 0.8, res: 8 })
  .instance(tree)
  .material({ color: '#9fd67f', roughness: 0.6 })
  .out()

camera(0, 2, 6.5, [0, 1.9, 0])
```

Copies are numbered in the order they were placed, which runs outward a
generation at a time. `.age(i)` is that order as 0..1, and `.grow(amount)` uses
it to open the structure out from the root. `tree.grow(t => t * 0.3)` fills it
in over about three seconds; any signal works, so `.grow(audio().smooth())`
grows it on the music.

`.size(i)` is the scale a copy was placed at. A chain that sets its own
`.scale()` replaces that rather than compounding with it, so multiply it back in:

```js static
.instance(tree, (x, i, n, t) => x.scale(tree.size(i) * (1 + 0.2 * Math.sin(t * 3 + i))))
```

### without branching

A loop walks the cursor just as well, which is where spirals, rings and
scatters come from:

```js
bg('#06070d')
ambient({ intensity: 0.3 })
directional({ color: '#fff0d0', intensity: 2.2 }).position(4, 5, 6).out()

const shell = layout((e) => {
  for (let i = 0; i < 360; i++) {
    e.turn(0.065, 0, 0.03)
    e.forward(0.08)
    e.scale(0.994)
    e.place()
  }
})

box({ width: 0.8, height: 0.1, depth: 0.45 })
  .instance(shell, (x, i, n) => x.color(hsl(0.55 + (i / n) * 0.35, 0.7, 0.55)))
  .position(0.9, -1.1, -2.2)
  .rotation(0, (t) => t * 0.2, 0)
  .material({ roughness: 0.3, metalness: 0.5 })
  .out()

camera(5, 2, 5.5)
```

A structure grows from the origin, so `.position()` recenters this one before
`.rotation()` spins it in place.

### the same structure, flat

`.instance()` is also a texture verb: it takes the picture so far as a stamp and
draws it once per copy, so a structure lands in the pipeline as pixels.

```js
const gasket = layout((e) => {
  if (e.size < 0.06) { e.place(); return }
  for (const a of [0, 2.094, -2.094])
    e.branch((x) => x.turn(a).forward(0.25).turn(-a).scale(0.5))
})

circle({ radius: 0.4, soft: 0.08, color: '#ffd75f', bg: null })
  .instance(gasket, (x, i, n) => x.scale(0.025).color(hsl(0.05 + (i / n) * 0.3, 0.85, 0.6)))
  .bloom({ threshold: 0.3, strength: 1 })
  .out()
```

Everything a layout knows still applies: `.filter()` slices it, `.grow()` opens
it out, `.size()`/`.age()`/`.depth()`/`.data()` answer per copy, and a `.turn()`
that is a fn of t still sways it.

- The copy verbs are the flat ones: `.position(x, y)`, `.rotation(angle)`,
  `.scale(s)` or `(x, y)`, `.color(c)`, and `.alpha(v)`. A layout placing in 3D
  still lands; depth is dropped.
- A copy arrives at the structure's own scale already, so `.scale(l.size(i))`
  changes nothing. Multiply it — `l.size(i) * 0.4` — to keep the taper, or pass
  your own number to ignore it.
- Units are the frame's height, origin at the center: a copy at scale 1 covers
  the frame. So the stamp is what sizes a copy: draw it to fill its own frame,
  then scale the copies down.
- The stamp has to fade out inside its own frame, or every copy carries a hard
  rectangular edge. `circle({ radius: 0.4, soft: 0.08 })` reaches zero at 0.48;
  the frame's edge is 0.5.
- The frame reaches 0.5 either side of the origin and copies outside it are
  clipped, so a structure has to be built at a size that fits — there is no
  camera here. Step distances (`.forward()`, `.span()`) carry the positions and
  leave `e.size` alone, so shrinking those scales the figure without disturbing
  a size-based stop; scaling the cursor moves both.
- `{ blend }` is how copies land on each other, `'add'` by default: generators
  come with an opaque black background, which adds nothing. `'over'` wants a
  transparent stamp (`bg: null`).

The count form works too, and the stamp is a chain, so it can be anything —
`text()`, a `videofile()`, a `person()` cutout, or the 3D render itself:

```js
bg('#04050b')
ambient({ intensity: 0.4 })
directional({ intensity: 2.5 }).position(3, 5, 4).out()

torusKnot({ radius: 1, tube: 0.3 })
  .rotation((t) => t * 0.4, (t) => t * 0.3, 0)
  .material({ color: '#4fd1c5', roughness: 0.3, metalness: 0.6 })
  .out()

scene()
  .instance(12, (x, i, n, t) => {
    const a = (i / n) * 6.283 + t * 0.2
    return x.position(Math.cos(a) * 0.33, Math.sin(a) * 0.33).scale(0.22).rotation(a)
  })
  .bloom({ threshold: 0.5, strength: 0.7 })
  .out()
```

## 3d text

`text3d('hi', { size, depth, bevel, res, font, weight, align, center })` extrudes
real type. `font` takes a bare name, resolved against your installed fonts first
(Chrome/Edge, one-time permission prompt) and then fetched from Google Fonts.
Use `'google:Name'` to skip the local lookup, or a `.ttf`/`.otf`/
`.typeface.json` URL for a specific file. Fonts render as helvetiker until they
arrive.

Where the local lookup can't answer — Firefox and Safari have no such API, and
macOS ships Helvetica, Courier and friends as unparseable `.ttc` collections —
system faces fall back to their metric-compatible Google twins (Arial and
Helvetica to Arimo, Times New Roman to Tinos, Courier New to Cousine, Georgia
to Gelasio, Calibri to Carlito, Cambria to Caladea), so line breaks land in the
same places.

```js
ambient({ intensity: 0.3 })
directional({ intensity: 1.6 }).position(2, 4, 6).out()

text3d('fizzle', { size: 1.2, depth: 0.3, bevel: 0.03 })
  .rotation(0, t => Math.sin(t * 0.6) * 0.4, 0)
  .color('#7ee787')
  .out()
```

Content can be a function of `t`. The geometry rebuilds only when the string
changes, so clocks and counters are cheap.

`\n` breaks lines, and `align` justifies them against the widest one:
`'left'` (the default), `'center'` or `'right'`. `center` is a separate
question, whether the whole block sits on the origin, and stays `true` unless
you turn it off.

```js
ambient({ intensity: 0.3 })
directional({ intensity: 1.6 }).position(2, 4, 6).out()

text3d('ready\nsteady\ngo', { size: 0.9, depth: 0.2, align: 'center' })
  .color('#7ee787')
  .out()
```

## particles

`.particles()` on any geometry chain dissolves the shape into a swarm: births
scattered over its surface, leaving along the normals. It all runs on the GPU,
so tens of thousands cost what one mesh does. Forces chain on.

```js
bg('#05060c')

sphere({ radius: 1.6 })
  .particles({ rate: 15000, life: [1.5, 3], speed: [0.3, 0.9], spread: 0.3 })
  .turbulence({ amp: 1.8, period: 2.2, speed: 0.4 })
  .drag(0.3)
  .color('#7ee8ff', '#2b3f8f')
  .blend('add')
  .out()

scene().bloom({ threshold: 0.4, strength: 0.9 }).out()
```

`particles({ rate, life, speed, spread, dir, pos, max })` on its own is a
fountain from a point. Either way `rate × life` is how many are alive at once
and `max` only caps it. `speed` and `life` take `[min, max]` pairs to vary per
particle; `dir` is a vector or `'out'` (the surface normal, the default from a
shape) and `spread` how far off it a particle may aim. A source shape needn't
be in the scene, and its transform applies live.

Forces stack in any combination. Every parameter takes a function of `t` or a
signal, so audio can drive the wind:

- `.force(x, y, z)` — constant acceleration: `.force(0, -2, 0)` is gravity,
  `.force(1, 0, 0)` a crosswind.
- `.turbulence({ amp, period, speed, seed })` — a curl-noise field: swirling,
  smoke-like drift. Layer two at different periods for weather inside weather.
- `.attract([x, y, z], { strength, radius })` — inverse-square pull, negative
  to repel. Aim it at `mouse()` and the swarm follows the pointer.
- `.drag(v)` — velocity damping, the difference between embers and snow.

The looks all take **one value, or two meaning birth → death**: `.size(a, b)`
in world units, `.color(a, b)`, `.opacity(a, b)`. Wherever a number goes, a
`[min, max]` pair scatters it per particle instead, so `.size(0.01, [0.03,
0.08])` is born small and dies at a size of its own. `.fade(in, out)` fades
each particle in at birth and out before death, as fractions of its lifespan
(defaults `0.1`, `0.3`; `.fade(false)` turns both off). `.soft(v)` shapes the
dot's edge, and `.blend('add')` sums light where the swarm piles up.

### images into particles

`.particles()` on a texture chain makes the image the emitter: births land on
its bright pixels (brighter births more, black none) on a plane facing the
camera. Each particle keeps the color it was born from unless `.color()` says
otherwise.

```js
bg('#05060c')

text('fizzle', { size: 0.3, bg: null })
  .particles({ rate: 30000, life: [1, 2.5], speed: 0.25, threshold: 0.3 })
  .turbulence({ amp: 0.5, period: 1.4 })
  .force(0, 0.4, 0)
  .size(0.02, 0.004)
  .blend('add')
  .out()
```

Any texture chain works — `person().particles()` dissolves the camera's
silhouette into a swarm wearing its colors — and the image stays live, so a
video keeps feeding new pixels to be born from while particles already flying
hold the frame that made them. Two texture-only keys: `size` is the world
height of the plane the image maps onto (default 4), and `threshold` how bright
a pixel must be to give birth (default 0.1).

### light and shadow

Dots are flat-colored by default. `.lit()` hands them to the scene's lights
instead. Each dot takes the color, falloff and cone of the light arriving
where it flies and darkens inside shadows. `.shadow()` makes the swarm cast
its own.

```js
bg('#04050a')

spot({ color: '#66bbff', intensity: 140, angle: 0.6, penumbra: 0.5, shadow: true })
  .position(t => Math.sin(t * 0.3) * 5, 7, 4).out()
spot({ color: '#ff7744', intensity: 110, angle: 0.55, penumbra: 0.5, shadow: true })
  .position(-5, 6, -2).out()

plane({ width: 40, height: 40 }).rotation(-Math.PI / 2, 0, 0)
  .position(0, -2.5, 0).material({ color: '#3a3f4a' }).out()

torusKnot({ radius: 1.3 })
  .particles({ rate: 25000, life: [2.5, 5], speed: 0.2 })
  .turbulence({ amp: 0.5, period: 2 })
  .drag(0.6)
  .color('#e9e9f2')
  .lit()
  .shadow()
  .out()
```

A dot has no facing, so there's no shading across it. What shows is each
light's color, distance and shadow. `.lit(0.5)` mixes flat color back in. The
amount takes a function of `t`. Casting is off by default (it's a depth render
per shadow light); the solid core of each sprite blocks light, so a dense
swarm lands on the floor as one drifting mass. Since lit dots read the same
shadow maps, it also shadows itself: ridges shade valleys. Both work on
texture emitters too, lighting the birth colors the image left on the swarm.

A dense lit swarm also wants `.blend('solid')`. The default `'over'` never
sorts, so overlapping dots show a depth-scrambled mix. An optically thick
cloud reads as its shadowed interior from every angle, lit skin and all.
`'solid'` dots are opaque cutouts that write depth: the z-buffer picks the
visible skin. Looking from the light, you see exactly the dots the light
reaches. They pop in and out rather than fade. That hardness is what lets
them occlude.

`.noise()` on the source shape carries through to the births, which is the
classic grainy-terrain move. A plane the sketch never draws, dissolved into
dots pinned to its creases, a low casting light raking them:

```js
directional({ color: '#ffc9a0', intensity: 3, shadow: { soft: 2, area: 8, far: 40 } })
  .position(8, 1.6, 2).out()
ambient({ color: '#30364d', intensity: 0.25 }).out()

plane({ width: 10, height: 10 })
  .rotation(-Math.PI / 2, 0, 0)
  .noise({ amp: 1.1, period: 2.5, speed: 0.1 })
  .particles({ rate: 150000, life: [1, 2], speed: 0.02 })
  .size([0.03, 0.06])
  .color('#d8d2c8')
  .blend('solid')
  .lit()
  .shadow()
  .out()
```

Each birth lands where the surface is at that moment, so short lives track a
drifting field and long ones remember where it was. Self-shadowing lives or
dies on density: a shadow is invisible unless it lands on another dot, so keep
the spacing (√(area ÷ alive)) under the dot size or the creases have nothing
to catch them. A tight shadow `far` helps dot-scale depth gaps survive the
compare; the dense side-lit ball in the dust-ball example is the clearest
proof the swarm shades itself.

### .evolve — across a life

`.evolve()` hands you each particle's life as a function: `life` runs 0 at
birth to 1 at death. Whatever the function sets applies at that point, the
looks and even an extra force, so a particle can rise young and sink old.

```js
bg('#05060c')

sphere({ radius: 2 })
  .particles({ rate: 8000, life: [2, 4], speed: 0.6 })
  .evolve((p, life) => p
    .size(0.08 * Math.sin(life * Math.PI))
    .color([1, 1 - life, 0.2])
    .force(0, 2 - life * 5, 0))
  .blend('add')
  .out()
```

Each look starts from the chain's own (`.size()`/`.color()`/`.opacity()`), so
set only what should change. The function is baked into a ramp rather than run
per particle, so it costs the same at ten particles or a million. It can only
depend on `life` and `t`, not on one particle's position.

`.position/.rotation/.scale` move the whole system like any shape, and
`.out('name')` sends it to a [geometry layer](#geometry-layers).

The swarm keeps flying across a re-run rather than restarting; changing the
pool size (`rate`, `life`, `max`) is the exception.

Particles draw as camera-facing dots that scale with distance, flat-colored
unless `.lit()` says otherwise, casting nothing unless `.shadow()` does. They
test against scene depth, so geometry occludes them; `'over'` and `'add'` dots
don't write it (no fog, invisible to `depth()`), while `.blend('solid')` dots
do: they occlude each other and show up in `depth()`. `.noise()` on the
source shape carries through to the births; `.displace()` maps don't. The
ceiling is ~1M; phones are happiest under ~100k alive.

## lights, camera, scene

```js
bg('#07070c')
fog({ color: '#07070c', near: 6, far: 30 })
ambient({ intensity: 0.1 })
hemi({ sky: '#333366', ground: '#221100' }).out()
point({ color: '#4fd1c5', intensity: 70 }).position(t => Math.cos(t) * 4, 2, t => Math.sin(t) * 4).out()
camera(t => Math.sin(t * 0.15) * 9, 4, t => Math.cos(t * 0.15) * 9)

plane({ width: 24, height: 24, res: 128 })
  .rotation(-Math.PI / 2, 0, 0)
  .noise({ amp: 1.2, period: 2.9, octaves: 5, speed: 0.15 })
  .material({ color: '#222233', roughness: 0.9, flatShading: true })
  .out()
```

- Every light is configured the same way — `ambient({ intensity })`,
  `directional({ intensity, color })`, `point({ intensity, distance, decay })`
  — and every value takes a function of `t`.
- `directional` / `point` / `spot` / `hemi` chain `.position(x, y, z).out()`,
  with functions of `t` for moving lights. `ambient` has no position and adds
  itself without an `.out()`.
- `spot({ angle, penumbra })` is a cone from `.position()` toward `.target()`.
  `angle` is its half-width in radians, `penumbra` (0..1) how soft the rim is.
  `directional` takes a `.target(x, y, z)` too; both aim at the origin without
  one, and both animate.
- `camera(x, y, z, [tx, ty, tz])` puts the camera at `x, y, z` and aims it at
  the target point `[tx, ty, tz]`, the origin without one. Static numbers leave
  orbit controls live. If **any** argument is a function of time the sketch
  drives the camera and orbiting is off; drop the call and the next run hands
  back the view you last orbited to. A game controller can steer it instead:
  see **gamepads**.
- `bg(color)` and `fog({ color, near, far })` set the scene backdrop. `bg()`
  sits under the texture stack too, so a chain with transparency in it shows
  the background through the gaps rather than black.

### shadows

Off until a light asks for them, on for every mesh once one does:

```js
directional({ intensity: 3, shadow: true }).position(12, 8, 6).target(0, 0, -8).out()
spot({ intensity: 90, angle: 0.5, shadow: { soft: 5 } }).position(0, 6, 4).out()

plane({ width: 40, height: 40, res: 1 }).rotation(-Math.PI / 2, 0, 0)
  .shadow({ cast: false })                     // flat — only catches
  .material({ color: '#8d879b', roughness: 0.8 }).out()
torus({ radius: 1.4, tube: 0.4 }).position(0, 2, 0).rotation(t => t * 0.4, 0, 0).out()
```

- `shadow: true` on `directional` / `spot` / `point`. `ambient` and `hemi`
  come from everywhere at once, so neither can cast.
- Geometry **casts and receives by default**. `.shadow(false)` opts out of
  both; `.shadow({ cast: false })` or `{ receive: false }` picks one. A
  ceiling needs `cast: false` or the light never reaches the room. Glass
  (`transmission`) and blended (`opacity` < 1) surfaces don't cast unless
  `.shadow(true)` insists, since they'd throw the solid shadow of their outline.
- Tuning, on the light's `shadow` object: `soft` (blur radius in texels: 0
  hard-edged, ~8 overcast), `strength` (0..1, how dark), `map` (resolution,
  2048 default), `near`/`far` (the light's view range; a `far` much larger
  than the scene stripes flat surfaces), and for `directional` only, `area`:
  half the width of the box it shadows. Too big and the texels spread thin,
  too small and the shadow stops mid-floor.
- A `point` light shadows a whole cube map: six renders, the expensive one.
- `.noise()` and `.displace()` are shadowed as displaced. Geometry sent to
  `.out('name')` casts within its own layer.

## textures: the shader pipeline

The rendered scene is also a texture. Texture chains are shader passes
evaluated as a graph each frame; end one with `.out()` to make it the display
output. With no texture `.out()`, the scene renders directly.

```js
ambient({ intensity: 0.3 })
directional({ intensity: 1.5 }).position(4, 6, 3).out()
torus({ radius: 1.2, tube: 0.4, res: 64 }).rotation(t => t * 0.5, t => t * 0.3, 0).color('#ff5f9e').out()

scene()
  .kaleido(6)
  .hue(t => t * 0.05)
  .out()
```

### sources

- `scene()` — the lit 3D render of everything sent to a naked `.out()`.
- `input()` — last frame's display output (a feedback loop; survives re-runs,
  frozen while paused). Comp it back in for trails.
- `input('name')` — a named bus published elsewhere with `.out('name')`. See
  **buses, layers & feedback**.
- `constant(color)` — one flat color over the whole frame, in any of the color
  forms and a function of `t` like any of them.
- `ramp({ type: 'linear'|'radial'|'angular', a, b, angle, phase, period, freq, shape })`
  — a two-color sweep: straight across (`angle` aims it), out from the center,
  or around it. `period` is how much of the frame one cycle spans (1 by
  default; under that it repeats into bands) and `shape` waveshapes each
  cycle: `'saw'` (the plain ramp), `'tri'` (up then back down, seamless),
  `'sin'`, `'sqr'` (two flat colors). `phase` slides the sweep along itself,
  in cycles.
- `circle({ radius, thickness, soft, center, color, bg })` — a disc,
  hard-edged until `soft` feathers it. `thickness` cuts the middle back out,
  measured inward from the rim. `bg: null` draws it on nothing.
- `ring({ inner, outer, soft, center, color, bg })` — the same shape addressed
  by its two edges instead.
- `noise({ period, freq, octaves, lacunarity, gain, speed, seed, channels, a, b })`
  — animated fbm noise shading from color `a` (low) to `b` (high). `octaves`
  stacks detail layers, `lacunarity` is the frequency step per octave, `gain`
  the amplitude falloff (low = smooth blobs, high = rough grain). Output is
  normalized, so use `.contrast()` / `.mul()` to change level.
  `channels: 2`–`4` puts independent fields in R/G(/B/A) instead of the a→b
  ramp, which is what `.displace()` maps want.
- `voronoi({ period, freq, speed, blend, seed, mode, a, b })` — scattered
  points drifting over the frame, each pixel colored by the nearest. `mode`
  picks what gets drawn: `'cells'` fills each cell flat, `'distance'` shades
  by distance to its point, `'edges'` lights only the seams. `blend` is how
  far past its own cell a pixel listens, in cell widths. 0 is hard, higher
  melts the cells together. All three shade `a`→`b`, so any of them is also a
  mask or a `.displace()` map.
- `text('hi', { size, color, bg, pos, font, weight, align })` —
  canvas-rendered text. `size` is a font size in screen px (values ≤ 1 =
  fraction of screen height); any CSS font, `\n` for multiline, content may be
  a function of `t`. `bg: null` puts the letters on nothing.
- `video(name?)` — live camera (see **video input**).
- `person(name?)` — a live person mask cut from that same camera (see **video
  input**).
- `videofile(name?)` / `imagefile(name?)` / `imageseq([names], index?)` —
  imported media files (see **media files**).

```js
ramp({ type: 'radial', a: '#1a0533', b: '#ff5f9e' })
  .comp(noise({ freq: 3, octaves: 4, speed: 0.3, a: '#000000', b: '#4fd1c5' }), 'screen', 0.7)
  .comp(text('fizzle'), 'add')
  .out()
```

`period` and `shape` make `ramp()` a band generator. Scanlines, hard stripes,
a pinwheel, concentric rings, all the same call:

```js
ambient({ intensity: 0.3 })
directional({ intensity: 1.5 }).position(4, 6, 3).out()
torusKnot({ res: 96 }).rotation(t => t * 0.3, 0, 0).color('#4fd1c5').out()

scene()
  .comp(ramp({ angle: Math.PI / 2, freq: 80, shape: 'tri', a: '#585858' }), 'mult')
  .comp(ramp({ type: 'angular', period: rand({ freq: 0.5 }), shape: 'sqr', phase: t => t * 0.1 }), 'add', 0.1)
  .out()
```

`period`'s useful range is 0..1, which is exactly what a signal hands you, so
`rand()`, `audio()` or `beat().saw()` go straight in and sweep from one gradient
to a dense grating.

**`period` or `freq`, whichever avoids a fraction.** Every periodic generator —
`ramp()`, `noise()`, `voronoi()` and geometry `.noise()` — takes both spellings:
`period` is how much of the frame one cycle spans, `freq` how many fit across
it, so `freq: 80` and `period: 1 / 80` are the same scanlines.

Naming `period`, `freq` or `shape` puts `phase` into wrapping mode, so animating
it scrolls the bands indefinitely. Left alone, a ramp clamps its end colors past
the edges. `ramp({ type: 'radial', phase: -0.15 })` is a vignette with a flat
center.

Two `voronoi()` calls agreeing on `freq`, `speed` and `seed` see the same
points, so their modes line up and can be layered:

```js
voronoi({ freq: 9, speed: 0.4, blend: 0.05, a: '#0d1030', b: '#7ee8ff' })
  .comp(voronoi({ freq: 9, speed: 0.4, mode: 'edges', b: '#ffd9a0' }), 'add')
  .bloom({ threshold: 0.6, strength: 0.8 })
  .out()
```

Every numeric parameter in every texture op takes `t => ...` or a signal, same as
geometry.

## color & filters

- `.add(v)` / `.sub(v)` / `.mul(v)` / `.div(v)` / `.pow(v)` — per-pixel math;
  scalar, `[r, g, b]` or a color (`.mul('#ff00ff')` is a multiply tint).
  `.pow(v)` is the curve for shaping a mask. `.pow(3)` pushes a soft falloff
  toward the dark end without moving black or white; `.gamma()` is the same
  curve inverted (`.pow(v)` is `.gamma(1 / v)`).
- `.tint(color, { bg })` — recolor by brightness: black becomes `bg`, white
  becomes `color`. Reach for it whenever a pass hands you a white-on-black
  image, like `edge()`, `text()`, `.threshold()` or a mask:

  ```js
  ambient({ intensity: 0.3 })
  directional({ intensity: 1.5 }).position(4, 6, 3).out()
  torusKnot({ res: 96 }).rotation(0, t => t * 0.4, 0).out()

  scene().edge({ strength: 2 }).tint('#ff00ff', { bg: '#120018' }).out()
  ```

  Both colors take signals, so `.tint(beat(1).select(palette))` recolors on the
  bar. More than two stops is `.lookup(ramp)`.
- `.contrast(v)` · `.saturation(v)` · `.gamma(v)` — 1 = unchanged. Or combined: `.levels({ contrast, saturation, gamma, hue })`.
- `.hue(v)` — hue rotation in turns: `.hue(0.5)` flips the palette, `.hue(t => t * 0.1)` drifts it.
- `.posterize(steps)` — quantize values · `.pixellate(x, y?)` — quantize position.
- `.ascii({ chars, cols, rows, color, bg, font, weight })` — quantize *both*:
  the frame becomes a grid of characters, each cell drawn with the glyph whose
  ink matches its brightness. `chars` is the vocabulary, ordered dark→bright.
  Use a set name (`'ascii'`, `'dense'`, `'blocks'`, `'numbers'`, `'letters'`,
  `'binary'`, `'dots'`) or any string of your own. Cells keep the color
  underneath unless you pass a `color`, and `rows` follows from `cols` so
  glyphs stay unstretched. Cells are picked by luma, so
  `.levels({ contrast: 1.6 })` first if the set looks unused.
- `.threshold(level, { soft })` — luma → black/white mask · `.invert()`.
- `.blur(radius)` — separable gaussian, radius in texels. `[x, y]` gives a
  radius per axis. `.blur([8, 0])` smears along the scanline and nowhere else
  (an axis at 0 skips its pass, so it's cheaper too, not just narrower).
- `.bloom({ threshold, strength, radius })` — brightpass + half-res gaussian glow.
- `.edge({ strength, spread })` · `.slope({...})` · `.normalMap({...})` — one
  Sobel pass, three encodings: edge magnitude (grayscale), centered gradient
  (RG, 0.5-neutral — a ready-made displace map), or tangent-space normal.
- `mode: 'crisp'` on any of the three — the kernel runs hot by default, so edges
  clip into thick stepped lines. Crisp normalizes it: thin antialiased lines
  that keep their falloff, about four times dimmer, so raise `strength` to match.

  ```js
  scene()
    .edge({ mode: 'crisp', strength: 4 })
    .threshold(0.4)
    .out()
  ```

```js
noise({ freq: 3, speed: 0.4 })
  .posterize(5)
  .edge({ strength: 2 })
  .mul([0.4, 1.6, 1.2])
  .bloom({ threshold: 0.3, strength: 1.2 })
  .out()
```

```js
ambient({ intensity: 0.2 })
directional({ intensity: 1.6 }).position(4, 6, 3).out()
torusKnot({ radius: 1.2, tube: 0.4, res: 96 })
  .rotation(t => t * 0.4, t => t * 0.25, 0)
  .color('#ffffff')
  .out()

scene()
  .levels({ contrast: 1.5 })
  .ascii({ cols: 110, chars: ' .:-=+*#%@', color: '#33ff66' })
  .out()
```

## transforms & tiling

- `.transform({ translate: [x, y], scale, rotate, wrap: 'clamp'|'repeat'|'mirror'|'transparent' })`
  — UV-space transform. Or the shorthands `.translate(x, y)`, `.rotate(v)`,
  `.scale(x, y?)`. Each takes `{ wrap }` as a trailing option. Translation is
  in UV units (1 = a full frame); scale zooms around center, one number
  uniform, `.scale(1, 4)` stretching y alone. A negative scale flips that
  axis: `.scale(-1, 1)` mirrors the whole image left to right.
- `.crop(w, h?, { center })` — keep the middle `w`×`h` and drop the rest to
  transparent black. Nothing is resampled; the picture stays put and the
  emptiness closes in around it. Sizes above 1 count pixels of the frame's
  grid (unaffected by retina or `quality()`), 0..1 is a fraction of the frame,
  and `h` follows `w` when left out. All take functions of `t`. Keep an
  animated size on one side of 1, since crossing it swaps which reading
  applies.
- `.mirror({ axis: 'x'|'y'|'both', flip })` — reflect one half onto the other.
  For a whole-image flip instead, use a negative `.scale(-1, 1)`.
- `.kaleido(sides, { rotate })` — polar kaleidoscope fold.
- `.radial(s => ...)` — run the function in polar space (see below).
- `.polar({ inverse })` — the one-way coordinate change, as an effect.
- `.tile(nx, ny, (src, i, x, y) => variant)` — tile the image with a per-cell
  chain: return `src`, a treatment of it, or any other texture chain. `x` runs
  left→right, `y` bottom→top, `i = y * nx + x`. Identical variants share one
  render, but each *distinct* one costs a full pass per frame, so
  `.tile(10, 10, (s, i) => s.hue(i / 100))` is 100 renders.

```js
circle({ radius: 0.2, soft: 0.04, color: '#4fd1c5' })
  .translate(t => Math.sin(t) * 0.25, 0, { wrap: 'repeat' })
  .kaleido(6, { rotate: t => t * 0.1 })
  .tile(3, 2, (src, i, x, y) => (x + y) % 2 ? src.invert() : src)
  .out()
```

## compositing

`.comp(layer, { mode, opacity })` composites `layer` over the chain (positional
`.comp(layer, mode, opacity)` works too and is the shorter one to type mid-set).
Modes:
`over` `under` `add` `sub` `mult` `divide` `screen` `overlay` `hardLight`
`softLight` `darken` `lighten` `difference` `exclusion` `dodge` `burn`
`luminosity` `color`.

`under` is `over` upside down. The layer goes **behind** the chain, showing
only where the chain is transparent. A background slid in under what's already
drawn:

```js
text('fizzle', { size: 0.3, bg: null })
  .comp(noise({ freq: 2, channels: 3, speed: 0.2 }), 'under')
  .out()   // noise fills the page, the letters stay on top
```

`swap: true` does the same to any other mode. It feeds the two images to the
blend in the other order, which is what turns `sub` into layer-minus-chain, and
the same for `divide`, `dodge` and `burn`:

```js
noise({ freq: 4, speed: 0.2 })
  .comp(ramp({ type: 'radial' }), { mode: 'sub', swap: true })
  .out()   // ramp − noise, not noise − ramp
```

`luminosity` and `color` move whole colors rather than channels: `luminosity` keeps the
**base's** color and takes the **layer's** brightness, `color` does the reverse.

```js
noise({ freq: 3, channels: 3, speed: 0.3 })
  .blur([20, 6])
  .comp(text('fizzle', { color: '#dddddd', bg: '#222222' }), 'luminosity')
  .out()   // the noise's colors, the text's brightness
```

Keep the layer off pure black and white: only one color sits at each extreme,
so asking for either takes the base's hue with it. Hence the grays above.

Together they're a luma/chroma split: blur a picture into mush, comp the
original back over it in `luminosity`, and only the color stayed blurred. That's
what composite video does to color, and most of why VHS looks like VHS (see the
**vhs** example).

`layer` may also be a **function of the chain so far**.
`.comp(s => s.edge(), 'add')` overlays the chain's own edges.
`.displace(map)`, `.remap(map)` and `.mask(m, fn)` take the same function
form.

```js
ramp({ type: 'angular', a: '#000000', b: '#334455' })
  .comp(circle({ radius: 0.25, soft: 0.1, color: '#ff5f9e' }), 'screen')
  .comp(s => s.edge({ strength: 1.5 }), 'add')
  .out()
```

### alpha — drawing on nothing

Every buffer is RGBA and `'over'` means it. The shape generators (`circle`,
`ring`, `text`, `ascii`) take `bg: null` to draw on nothing, and `null` works
in `ramp`/`noise`/`voronoi`'s `a`/`b` too. A radial ramp to `null` is a
vignette that comps over anything. Picture-in-picture is one `transform` and
one `comp`; swap these generators for two `videofile()`s and it's real:

```js
voronoi({ freq: 7, speed: 0.4, a: '#0d1030', b: '#3a7f8f' })
  .comp(noise({ period: 0.5, a: '#200933', b: '#ff9f5f' }).transform({ scale: 0.35, translate: [0.28, 0.24], wrap: 'transparent' }), 'over')
  .comp(text('LIVE', { size: 0.07, pos: [0.88, 0.9], color: '#ff4f4f', bg: null }), 'over')
  .out()
```

- `wrap: 'transparent'` empties the off-frame region; the default `'clamp'`
  would smear the small picture's edge pixels across the base.
- Every blend mode reads alpha, so a `mult` or `overlay` through a
  transparent-bg shape only lands inside the shape.
- `.alpha(v)` fades a whole chain toward nothing; a texture in `v` fades per
  pixel by its luma. `.tint(color, { bg: null })` turns any mask into a
  colored cutout.
- Several naked `.out()`s stack in code order, later over earlier.
- What's behind the bottom of that stack is `bg()`, so transparency reads as
  the background color; `bg(null)` puts it back to black.

### keying — alpha from the picture itself

Footage arrives opaque; the keys carve transparency into it, dropping alpha
where the test matches and leaving the rest untouched. The result is a cutout
ready to `.comp('over')`, where `.threshold()` would have painted a
black-and-white picture *of* the test instead.

- `.chromaKey(color, { tolerance, soft, spill })` — transparent where the pixel
  is perceptually near `color`. A saturated key like a green screen keys
  loosely and ignores brightness, catching the screen's lit and shadowed parts
  together; a muted key near gray tightens up so only its real neighbors go.
  `tolerance` scales that radius (default 1), `soft` is the fade at the cut
  (default 0.25), and `spill` (default 0.5) scrubs the key color's cast off
  what survives.
- `.lumaKey(level, { soft, invert })` — transparent below `level`; `invert`
  keys the bright side instead. Unlike `.threshold()`, what survives keeps the
  picture's own colors.
- `person()` — a mask source rather than a filter: white where the camera sees
  somebody, so `.mask(person())` is a key with no screen at all.

```js
// you, cut out of the room and put somewhere better
noise({ period: 0.5, speed: 0.15, a: '#03102a', b: '#155a8a' })
  .comp(video().mask(person().blur(3)), 'over')
  .out()
```

## masking & switching

`.mask(maskTop, fn?)` — spatial masking by the mask's luma:

- `.mask(m)` — cutout: multiply the chain by the mask.
- `.mask(m, s => ...)` — apply the function **only where the mask is bright**:
  a dry→wet blend by mask luma, untouched where the mask is black.

```js
noise({ freq: 3, speed: 0.3, a: '#031018', b: '#4fd1c5' })
  .mask(circle({ radius: 0.32, soft: 0.15 }), s => s.displace(noise({ channels: 2, period: 0.5, speed: 0.5 }), { amount: 0.2 }).invert())
  .out()
```

`.when(cond, s => ...)` — a **temporal** switch: while the condition signal is
≥ 0.5 the chain becomes `fn(chain)`, otherwise it passes through untouched.
Unlike `.mask`, only the active branch renders.

```js
noise({ freq: 3, speed: 0.5, b: '#7ee787' })
  .when(beat(4).sqr(0.25), s => s.invert())
  .out()
```

`select([a, b, c], index)` is the same switch with more than two ways to go and
an index instead of a condition. See
[select — the list as the subject](#select-the-list-as-the-subject).

## warping

`.displace(map, { amount: 0.1, mid: 0.5 })` offsets each pixel's UV lookup by
the map's RG channels minus `mid`, scaled by `amount`. That's the classic
displacement map. (`.displace(map, amount)` works as a positional shorthand.)

- **`mid` is the neutral value.** Mid-gray (0.5) by default: brighter pushes
  one way, darker the other. For dark maps where black should be neutral
  (`edge()` output, text on black), set `mid: 0`.
- **Grayscale maps are diagonal-locked.** R = G, so x and y move together.
  For isotropic wobble use `noise({ channels: 2 })`.
- `.slope()` output is already centered on 0.5, so it needs no bias.

```js
text('fizzle')
  .displace(noise({ channels: 2, period: 0.5, speed: 0.4 }), { amount: t => 0.04 + 0.03 * Math.sin(t) })
  .out()
```

With `mid: 0` and a hefty amount, a dark map cuts shapes out of the source.
A circle displaced by text:

```js
circle({ radius: 0.35, color: '#ffd166' })
  .displace(text('glossing'), { amount: 0.7, mid: 0 })
  .out()
```

`.remap(map)` is the absolute version. Sample the chain at the map's RG
coordinates directly (the map **is** the UV space).

### radial

`.radial(s => ...)` runs the function in **polar space** — x is the angle
around the center, y the distance from it — and resamples back afterwards, so
every ordinary op acts radially:

```js
noise({ freq: 4, speed: 0.3, a: '#0b0f2a', b: '#7ee8ff' })
  .radial(s => s.translate(0, 0.1))   // a tunnel: pull everything outward
  .out()
```

| inside `.radial()` | on screen |
| --- | --- |
| `.translate(0, y)` | tunnel — outward for `y > 0`, drain inward for `y < 0` |
| `.translate(x, 0)` | spins the frame (x is the angle) |
| `.blur([8, 0])` | smears **around** the ring |
| `.blur([0, 8])` | smears **along** the radius — a zoom streak |
| `.mirror()` | fold the angle: a kaleidoscope without `.kaleido()` |
| `.pixellate(24, 8)` | 24 wedges × 8 rings |

Two details it handles for you: the seam **wraps**, so a `.blur([8, 0])` comes
around the other side instead of cracking the frame (pass an explicit
`{ wrap }` to override; `'transparent'` leaves a tunnel's middle empty), and
**radius 1 is the frame corner**, so a round trip covers the whole frame.
Expect a starburst at the center, where one source pixel stretches across a
whole row.

`.polar({ inverse })` is the one-way half: naked it unrolls the frame into a
ring, and `inverse: true` wraps an image into a disc. A horizon becomes a
little planet.

```js
ambient({ intensity: 0.25 })
directional({ intensity: 1.5 }).position(4, 6, 3).out()
camera(0, 0, 7)

box({ res: 2 })
  .instance(24, (x, i, n, t) => x
    .position(((i / n) * 12 - 6 + t * 0.6) % 12 - 6, Math.sin(i) * 1.5, 0)
    .rotation(0, t * 0.4 + i, 0)
    .scale(0.5))
  .material({ color: '#ffd166', roughness: 0.4 })
  .out()

scene().polar({ inverse: true }).out()
```

## a texture where a number goes

Hand a texture to any of the parameters below and it stops being one number for
the whole frame. Each pixel reads its own value out of that map, at the same UV.

```js
voronoi({ freq: 6, speed: 0.3, a: '#1a0533', b: '#4fd1c5' })
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
| `.add()` / `.sub()` / `.mul()` / `.div()` / `.pow()` | the value itself |
| `circle()` | `radius`, `thickness`, `soft`, `center` |
| `voronoi()` | `blend` |

Two rules cover the set:

- **Which channels.** Two-component slots (`translate`, `scale`, `center`) read
  **R and G**, three-component ones (the arithmetic) read **RGB**, and scalar
  slots (`rotate`, `sides`, `hue`, `barrel`, `level`, …) read **luma**. A
  grayscale map drives a two-component slot along the diagonal. Reach for
  `noise({ channels: 2 })` when the axes should be independent.
- **What the number is.** The sample *is* the value, in the units the number
  would have had: `.rotate(map)` turns each pixel by 0..1 radians. `.mul()` /
  `.add()` on the map is how you set a range and reaches past 0..1 either way.

Slots also take `{ map, amount, mid }`, resolving to `(sample - mid) * amount`,
for when the range has to be set after the map is read:

```js static
scene().transform({ translate: { map: noise({ channels: 2 }), amount: 0.1, mid: 0.5 } })
```

That line **is** `.displace(noise({ channels: 2 }), 0.1)`. Without `mid: 0.5` a
`noise()` map only ever pushes +x/+y, since it never goes negative.

A texture in a slot with no per-pixel form (`.blur()`, `.bloom()`, …) warns and
falls back to the default.

`circle()` and `voronoi()` are generators whose shape a texture decides:
`circle({ radius: noise({ freq: 3 }).mul(0.1).add(0.25) })` is a disc with a
wandering rim. `voronoi({ blend: ramp({ type: 'radial' }) })` is cracked
glass at the center melting to wax at the rim.

### .field — a texture read back as numbers

`.field()` ends a chain with a sampler instead of a picture: a plain function
`(u, v) => 0..1` reading the chain's luma at that point (`v = 0` at the
bottom, like a geometry uv). The chain renders to a small buffer once a frame
and is read back on the CPU, one frame behind, so any texture can drive plain
sketch code. `.instance()` layouts are the natural customer. Here a wave rolls
out from the center and every tile it crosses turns over to its blank back,
timetable style. Two grids share each cell, one facing away, so a half turn
swaps which face shows. Spelling is a lookup: the set of cards is a string, so
a character's place in it is the number `.tile()` wants:

```js
resolution(1280, 720)
bg('#08080a')
camera(0, 0, 8.5)

ambient({ intensity: 0.5 })
directional({ intensity: 1.6 }).position(2, 4, 6).out()

// well under one cycle across the board, so it sweeps rather than ripples
const wave = ramp({ type: 'radial', freq: 0.12, shape: 'sin', phase: t => -t * 0.07 })
  .threshold(0.5, { soft: 0.15 })
  .field()

const COLS = 16, ROWS = 7, PITCH = 0.62

const GLYPHS = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const cards = GLYPHS.split('').map(c => text(c, { size: 0.7, color: '#14110d', bg: '#e8e4dc' }))

const lines = ['   DEPARTURES', '', 'BERLIN     1405', 'LISBON     1420', 'TOKYO      1512']

// lines run top down, row 0 is the bottom row, anything unlisted comes out blank
const glyph = (col, row) => Math.max(0, GLYPHS.indexOf((lines[ROWS - 1 - row] ?? '')[col] ?? ' '))

const board = (turn, lettered) => (x, i) => {
  const col = i % COLS, row = (i / COLS) | 0
  const flip = wave(col / (COLS - 1), row / (ROWS - 1))
  x.position((col - (COLS - 1) / 2) * PITCH, (row - (ROWS - 1) / 2) * PITCH, 0)
    .rotation(flip * Math.PI + turn, 0, 0)
  if (lettered) x.tile(glyph(col, row))
}

const card = () => plane({ width: 0.55, height: 0.55, res: 1 })

card().material({ map: cards, roughness: 0.8, doubleSide: false })
  .instance(COLS * ROWS, board(0, true)).out()

// every back is the same, so it needs no set — just a color
card().material({ color: '#14110d', roughness: 0.8, doubleSide: false })
  .instance(COLS * ROWS, board(Math.PI)).out()
```

The sampler is just a function, so it drops into a `.position()`, an
`onFrame`, anywhere sketch code runs. Any source feeds it: noise, `video()`,
an audio-reactive chain, a feedback bus. `.field({ res: 128 })` reads finer
than the default 64 when a grid is dense enough to need it.

## buses, layers & feedback

`.out('name')` publishes instead of displaying. `input('name')` reads the
bus anywhere, including in a completely separate chain, so networks don't
have to be a single expression.

```js
ambient({ intensity: 0.3 })
directional({ intensity: 1.5 }).position(4, 6, 3).out()
icosa({ radius: 1.2 }).noise({ amp: 0.3, period: 0.5, speed: 0.4 }).color('#8899ff').out()

scene().kaleido(6).out('kal')
noise({ freq: 3, channels: 2, speed: 0.4 }).out('warp')
input('kal').displace(input('warp'), { amount: 0.08 }).bloom().out()
```

Acyclic wiring pulls the producer fresh the same frame, like a patch cord. A
cycle reads last frame's snapshot instead, which is what makes it a feedback
loop, closable anywhere in the chain:

```js
circle({ radius: 0.1, soft: 0.05, color: '#7ee787' })
  .translate(t => Math.sin(t * 1.3) * 0.3, t => Math.sin(t * 0.9) * 0.3)
  .comp(input('trail').transform({ scale: 0.985, rotate: 0.01 }), 'add', 0.75)
  .out('trail')
  .bloom({ threshold: 0.4 })
  .out()
```

The loop closes at `.out('trail')`, pre-bloom, so the glow doesn't compound
into the trail. Multiple buses coexist. Published chains render even if
they never reach a naked `.out()` (as long as something does).

### .feedback — the same loop in one call

`.feedback(amount)` is that cycle with the bus name handled for you: last frame
comes back over the chain at the amount you name.

```js
circle({ radius: 0.1, soft: 0.05, color: '#7ee787' })
  .translate(t => Math.sin(t * 1.3) * 0.3, t => Math.sin(t * 0.9) * 0.3)
  .feedback(0.75, p => p.transform({ scale: 0.985, rotate: 0.01 }))
  .bloom({ threshold: 0.4 })
  .out()
```

The amount is how much of last frame returns: 1 never lets go, and a function
of `t` opens and closes the loop live. The function treats last frame on its
way round: scaled up it smears outward, rotated it spirals. Each call site
gets its own buffer, so a helper built on `.feedback()` can be used twice
without the loops colliding.

The mode is how last frame comes back, `add` by default. A bare mode name
stands in for the options, in whichever slot is free:

```js
.feedback(0.9, 'screen')                       // no treatment
.feedback(0.9, p => p.rotate(0.01), 'screen')  // with one
.feedback(0.9, { mode: 'screen', swap: true }) // the long form
```

`{ mode: 'under' }` is the one worth knowing: the trail is laid down *behind*
what the chain draws this frame, so the source stays crisp on top of its own
smear instead of blowing out where the two pile up.

```js
circle({ radius: 0.08, soft: 0.02, color: '#ff5f9e', bg: null })
  .translate(t => Math.sin(t * 1.7) * 0.4, t => Math.cos(t * 1.1) * 0.4)
  .feedback(0.96, p => p.transform({ scale: 1.01 }), { mode: 'under' })
  .out()
```

### custom methods

`Texture` and `Geometry` are in scope. Adding to a prototype adds an op to
every chain of that kind:

```js
Texture.prototype.trail = function (amt = 0.9) {
  return this.feedback(amt, p => p.transform({ scale: 1.01 }))
}

circle({ radius: 0.08, soft: 0.04, color: '#7ee787' })
  .translate(t => Math.sin(t * 1.3) * 0.3, t => Math.sin(t * 0.9) * 0.3)
  .trail(0.92)
  .bloom()
  .out()
```

`this` is the chain, so write helpers the way the built-in ops are written. Use
a `function`, not an arrow, or `this` comes from the sketch. `Geometry` works
the same way:

```js
ambient({ intensity: 0.3 })
directional({ intensity: 1.5 }).position(4, 6, 3).out()

Geometry.prototype.spin = function (rate = 0.3) {
  return this.rotation(0, t => t * rate, 0)
}

torus({ radius: 1.2, tube: 0.4 }).spin(0.5).color('#4fd1c5').out()
```

The types themselves are in scope, so a helper can branch on what it was given:

```js static
Texture.prototype.over = function (x) {
  return this.comp(x instanceof Texture ? x : constant(x), 'over')
}
```

These methods live until the tab reloads rather than until the next run, so
renaming one leaves the old name behind and a deleted helper still answers.

To wire a loop by hand instead of using `.feedback()`, `bufferId()` hands back
a bus name nobody else will take:

```js static
Texture.prototype.trail = function (amt = 0.9) {
  const b = bufferId()
  return this.comp(input(b), 'add', amt).out(b)
}
```

Call it once and keep it in a variable. Both ends of the loop need the same
name. The same call site gets the same name on every run, so buffers survive
`ctrl + enter`. The buffer is freed when you delete the call.

### delay — a fixed number of frames back

Where feedback only reaches back one frame, `.delay(n)` is the chain exactly as
it was `n` frames ago, kept in a ring of buffers.

```js
ambient({ intensity: 0.3 })
directional({ intensity: 1.5 }).position(4, 6, 3).out()
torusKnot({ res: 96 }).rotation(t => t * 0.8, t => t * 0.5, 0).color('#ffffff').out()

scene()
  .comp(s => s.delay(2), 'diff')   // what moved in the last two frames
  .mul(4)
  .out()
```

A `diff` against your own past is a motion mask: still parts go black, moving
edges light up. Comping several delays at falling opacity is an echo rather
than a trail, each ghost a definite age.

The count takes a function of `t` (`.delay(beat(1).select([1, 6, 20]))`), and
the ring grows to the longest delay asked for.

Frames are expensive — ~47 MB each at a retina 1080p buffer — so past a budget
history is stored **smaller** rather than shorter and says so. `{ scale }`
sets that size yourself: 0.5 is a quarter of the memory per frame, nearly
always right when the delayed copy is being diffed, masked or blurred rather
than looked at. Leave it at 1 for a short delay you want exact, since a diff
against a downscaled past leaves residue on fine detail.

The history outlives a re-run, so editing doesn't punch a delay-length hole of
black through the show.

### geometry layers

`.out('name')` on a **geometry** publishes it the same way: the object renders
into its own layer instead of the visible scene. `input('name')` pulls that
layer as a texture: same camera, lit, on nothing. The layer carries real
coverage alpha, so it comps `'over'` like a sprite. Lights hit every layer by
default; a light's own `.out('name')` restricts it to one.

```js
ambient({ intensity: 0.3 })
directional({ intensity: 1.4 }).position(4, 6, 3).out()

torusKnot({ res: 96 }).rotation(0, t => t * 0.5, 0).color('#8899ff').out('knot')
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
directional({ intensity: 2.4 }).position(3, 5, 4).out()

box({ width: 4.4, height: 2.8, depth: 0.25, res: 2 })
  .rotation(0, t => Math.sin(t * 0.4) * 0.6, 0)
  .material({
    map: noise({ freq: 3, octaves: 4, speed: 0.3, a: '#1a0533', b: '#4fd1c5' })
      .kaleido(6)
      .levels({ contrast: 1.3 }),
    roughnessMap: noise({ freq: 6, speed: 0.2 }),
    metalness: 0.2,
  })
  .out()
```

Any source works — generators, `video()`, `imagefile()`, a bus — and so does
any slot: `map`, `normalMap`, `roughnessMap`, `displacementMap`, `aoMap`,
`metalnessMap`, `arm`. `noise({ period: 0.125 }).normalMap()` is a live bumpy
surface; `noise()` into `displacementMap` on a high-`res` shape is moving
terrain.

`repeat` / `offset` / `uvRotate` work as usual. Each binding gets its own
mipmapped copy of the chain's output, so two materials can tile one chain
differently without shimmer in the distance.

A bus lets you build a chain once and hang it on several surfaces:

```js
ambient({ intensity: 0.4 })
directional({ intensity: 1.4 }).position(3, 5, 6).out()

ramp({ type: 'angular', a: '#1a0533', b: '#ff5f9e' })
  .rotate(t => t * 0.3)
  .posterize(6)
  .out('feed')

plane({ width: 4, height: 2.5 }).position(-2.5, 0, 0)
  .material({ map: input('feed') })
  .out()

box({ res: 2 }).scale(2).position(2.5, 0, 0)
  .material({ map: input('feed').invert(), roughness: 0.3 })
  .out()
```

A map is a surface, not a light: a mapped shape in an unlit scene is as black
as an unmapped one.

These chains are a **pre-pass**, rendering before the 3D render that samples
them, so everything they show is this frame's. The exception is `scene()`,
which can only be last frame's. That's a feedback loop worth having, since it
puts a screen inside the scene showing the scene:

```js
bg('#101a2e')
ambient({ intensity: 0.35 })
directional({ intensity: 1.5 }).position(3, 5, 6).out()

plane({ width: 4, height: 3 })
  .position(0, 1, -2)
  .material({ map: scene().transform({ scale: 0.98 }).hue(0.02) })
  .out()

torus({ radius: 0.6, tube: 0.22, res: 48 })
  .position(t => Math.sin(t) * 1.6, 1, 0.6)
  .rotation(t => t * 0.7, t => t * 0.4, 0)
  .color('#ffd166')
  .out()
```

The screen needs something to show, hence the torus in front of it. A scene
whose only object *is* the screen stays black forever.

## fluid

`fluid()` is an incompressible fluid sim. `.push()` drives the velocity field,
`.ink()` pours dye into it, and the chain itself is the dye.

```js
fluid({ res: 320, fade: 0.12 })
  .push(noise({ period: 0.4, channels: 2, speed: 0.3 }), 0.4)
  .ink(circle({ radius: 0.03, soft: 0.02, color: '#4fd1ff', bg: null }), 6)
  .out()
```

Dye with nothing pushing it only sits and fades, so `.push()` is the call that
makes anything happen. It reads R and G of a map as a direction, around `mid`
(0.5 by default, so an unsigned map like `noise({ channels: 2 })` pushes both
ways). The amount is roughly the speed it settles at, in frame-heights per
second.

`.push([x, y])` takes a plain direction instead of a map: one steady force over
the whole field, in the same frame-heights per second. `[0.3, 0]` is a wind
blowing right, `[0, -0.3]` is gravity. Each component takes a fn of `t`, so
`.push([audio(), 0])` blows on the beat. There is no `mid` here, since a
direction is already signed.

```js
fluid({ res: 320, fade: 0.12 })
  .push([0.3, 0])
  .push(noise({ period: 0.4, channels: 2, speed: 0.3 }), 0.25)
  .ink(circle({ radius: 0.03, soft: 0.02, color: '#4fd1ff', bg: null }), 6)
  .out()
```

One caveat, and it is the solver's rather than the call's: a force that is the
same everywhere only moves the fluid if the fluid has somewhere to go. Under
the default `wrap: 'repeat'` it does, and the whole field drifts. Under
`wrap: 'clamp'` the frame is a closed box, the pressure solve cancels the
force almost entirely, and little happens beyond a stir near the walls and
obstacles. Use a map there.

`.ink()` adds per second rather than replacing, so dye builds while the source
is lit and drifts once it goes dark. Several of either call stack.

### obstacles

`.obstacle(mask)` makes every cell brighter than 0.5 solid. The solver sees
them, so flow goes around rather than being clipped afterwards.

```js
const disc = circle({ radius: 0.12, center: [0.45, 0.5], bg: null })

fluid({ res: 320, fade: 0.1 })
  .obstacle(disc)
  .push([0.25, 0])
  .ink(circle({ center: [0.05, t => 0.5 + Math.sin(t) * 0.3], radius: 0.03, color: '#7ee787', bg: null }), 6)
  .comp(disc, 'over')
  .out()
```

A mask only tells the solver where the solid is. Nothing puts it on screen, so
that last `.comp()` draws the same disc back over the dye. Any chain works as
one: `.obstacle(person())` parts the flow around whoever is on camera.

### the fields behind it

The sim carries more than the picture. `.velocity()`, `.curl()` and
`.pressure()` come back as maps centered on mid-grey, so they read on screen
and drop into any slot that takes one.

```js
ambient({ intensity: 0.25 })
directional({ intensity: 1.8 }).position(4, 6, 3).out()

const flow = fluid({ res: 256 })
  .push(noise({ period: 0.35, channels: 2, speed: 0.35 }), 0.4)

// the field as relief, with none of the fluid itself on screen
plane({ width: 16, height: 16, res: 280 })
  .rotation(-Math.PI / 2, 0, 0)
  .displace(flow.curl(), { amount: 1.6 })
  .material({ color: '#2a3a6b', roughness: 0.45 })
  .out()
```

Hold the sim in a variable to read it more than once. Two separate `fluid()`
calls are two separate sims.

`{ scale }` on any of the three is the dial when a field looks flat: it
multiplies the values before they are centered.

### knobs

`res` is the grid along the long edge (default 256, 16..1024); the short edge
follows the window so cells stay square. `iterations` is how many pressure
steps run per frame (default 30): fewer is cheaper and leaks, more is stiffer.
`vorticity` puts back the swirl the grid rounds off, `fade` and `damping` are
how fast dye and motion die away, and `speed` scales the timestep. `wrap`
defaults to `'repeat'`, where flow leaving one edge returns at the other;
`'clamp'` puts walls around the frame instead.

The sim survives a re-run, so editing a knob does not blow the smoke away.
Changing `res` or resizing the window starts it over.

## video input

`video(name?)` is a live camera as a texture generator. No name is the default
camera; a name matches a camera label by case-insensitive substring
(`video('facetime')`), and the console lists what's available. First use asks
for permission, the stream survives re-runs, and it renders black until live.
It's a texture like any other: displace it, mask it, feed it back.

**`video('front')` and `video('back')`** ask for a facing rather than a name,
which is the pair to use on a phone, where labels are blank until permission
is granted. Cameras need a secure page: `https` or `localhost`, not a bare LAN
address.

```js
video()
  .pixellate(90)
  .posterize(4)
  .hue(t => t * 0.03)
  .out()
```

**`person(name?)`** reads the same camera as a person mask: white where a
segmentation model sees somebody, black elsewhere, gray at the uncertain edge.
It shares `video(name)`'s stream and permission, and fetches its model on first
use (~12 MB, cached), so it starts black a beat longer than the camera does.
It's a texture, so `.blur()` feathers it, `.threshold()` re-cuts it, `.edge()`
outlines it, and `.mask(person())` on the video removes the background. The one
built-in knob is `smooth` (0..0.95, default 0.4). It's how much of the previous
frame's mask each new one keeps, steadying flicker at the cost of a trailing
edge on fast movement.

`person({ part: 'hair' })` narrows the mask to one region — also `'face'`,
`'body'`, `'skin'` (face + body), `'clothes'` and `'other'` — via a larger
model (~16 MB more, fetched on first use). Every part of one camera comes out
of a single pass, so tinting hair over recolored clothes costs one inference.

## media files

Drag a video, image, audio, model or HDRI file (or a folder of them) into the
window: it's imported into the browser — no upload, survives reloads — and a
ready-made call lands at your cursor. Files are referenced by filename, exact
or case-insensitive substring, so `videofile('clip')` finds `clip.mp4`. An
unmatched name lists what's imported in the console. A name can also be an
`https://` URL (below).

Running an **empty** call (`videofile()`, `imagefile()`, `audiofile()`,
`imageseq()`) opens a file picker and fills the name in; an empty `hdri()`,
`.material()` or `model()` opens the Poly Haven browser. Delete the name back
out and run again to pick something else.

**Starter files.** Three imports ship with fizzle so the examples above run
before you've dropped anything in: `ship.obj`, the HDRI
`kloofendal_43d_clear_puresky_1k.hdr`, and the material
`cobblestone_floor_08_1k`. An import of the same name shadows them.

**`polyhaven:` names fetch themselves.** A pick from the browser lands tagged —
`pbr: 'polyhaven:rock_wall_02_2k'`, `hdri('polyhaven:lilienstein_2k.hdr')` — and
a tagged name that isn't imported downloads itself, so a sketch you send someone
runs on their machine. Files you drop in yourself stay untagged.

**URLs fetch themselves too.** Any filename here can be an `https://` link
instead, which is the easy way to send someone a sketch that just runs:

```js
imagefile('https://raw.githubusercontent.com/you/art/main/cat.jpg')
  .out()
```

The file downloads once and is kept, so re-runs and offline runs read it
straight back out of the browser. The catch is that the host has to allow other
sites to load its files. `raw.githubusercontent.com` and `upload.wikimedia.org`
do; most results you'd right-click out of an image search do not, and those say
so in the console instead of loading. To put your own images behind a URL, push
them to a public GitHub repo and copy the **Raw** link.

- `videofile(name?, { speed, loop, mute, restart, phase, jump })` — a looping
  video as a texture. `speed` and `loop` take functions of `t`; `mute: false`
  unmutes its soundtrack; `phase` and `jump` move it around (below).
- `imagefile(name?)` — a still image as a texture.
- `imageseq([names], index?)` — several images with a signal choosing the
  current one (floored, wrapped). Dropping multiple images at once types
  `imageseq([...], beat(4))` for you. Swap the index for any counter:
  `.counter()` of `.kicks()` steps on kicks, `rand().beat(4).mul(9)` jumps
  randomly each beat. Default: one image per second.
- `audiofile(name?, { volume, speed, loop, restart, chan })` — an audio file,
  played out loud and analyzed like `audio()`: it returns a level **signal**,
  so `.kicks()`, `.lowpass()`, `.smooth()` all work on it.
- `model(name?, { center, fit })` — an `.obj`/`.fbx` as a geometry op that
  starts a chain like `sphere()` does (see **model**).
- `hdri(name?, { ... })` — an `.hdr`/`.exr` panorama as environment lighting
  (see **hdri**). An empty call browses Poly Haven; **from disk…** there is
  the file picker.
- A **folder** of images that read as maps of one material is imported as a
  material rather than a pile of pictures (see **textured materials**). Files
  keep a `folder/file.jpg` name, so a dozen identically-named `Color.jpg`s
  stay apart.

Files keep playing through re-runs, so livecoding doesn't restart your clip.
To rewind:

- `ctrl+r` — media files rewind and everything a sketch has accumulated
  (particle swarms, `.delay()` frames, `.feedback()` trails, `counter()`
  positions) starts over. The clock keeps running; a paused sketch stays
  paused.
- `restartMedia(name?)` — in a sketch; runs on every execute. No name = all.
- `restart:` option — a function of `t` or signal; a rising edge through 0.5
  rewinds. `videofile('clip.mp4', { restart: beat(1).sqr(0.05) })` restarts
  every bar; `{ restart: audio().kicks() }` on every kick.

Or take the position yourself. `phase` is where in the clip to sit — 0 the
start, 1 the end — and setting it stops playback, so the frame goes wherever
the signal puts it and stays there:

```js static
videofile('clip.mp4', { phase: rand().beat(4) })          // a new spot each beat
videofile('clip.mp4', { phase: audio().smooth(0.2) })     // loudness scrubs it
videofile('clip.mp4', { phase: (t) => t * 0.05 })         // a 20-second crawl
```

Values outside 0..1 wrap while the clip loops and clamp when `loop: false`.
Scrubbing is a seek per changed value, so a file with sparse keyframes
stutters. Re-encode with a short keyframe interval if that bites.

**Keeping the sound.** `mute: false` plays the file's own audio, but `phase`
stops the clip to hold a frame, and a stopped clip is silent. `jump` is a
trigger like `restart`, except it lands on `phase` and lets the clip **play on**
from there:

```js static
videofile('clip.mp4', { mute: false, phase: rand(), jump: beat(4).sqr(0.05) })
videofile('clip.mp4', { mute: false, phase: rand(), jump: audio().kicks() })
```

Picture and sound re-cue together, so a clip with dialogue or music becomes an
instrument you play with the trigger. Each jump costs a seek and the audio
gaps for its duration. That gap is part of the sound.

**Speed.** `speed` is the playback rate: `1` normal, `0.5` half, `0` a freeze,
and a function of `t` like anything else. Browsers only play roughly 1/16× to
16× and only forwards, so a negative speed freezes and out-of-range values are
brought to what will play (noted once in the console). To run a clip
backwards, drive `phase` down instead: `phase: (t) => -t * 0.05`.

No video or audio ships with fizzle, so this is a template rather than a live
block. Drop your own files in and the names write themselves:

```js static
const kick = audiofile('drums.mp3').bandpass(30, 160).kicks()

videofile('clip.mp4', { speed: 1, restart: beat(0.25).sqr(0.05) })
  .comp(imageseq(['a.png', 'b.png', 'c.png'], kick.counter()), 'screen', 0.5)
  .scale(kick.mul(0.1).add(1))
  .out()
```

## audio signals

`audio()` turns the mic (or any input device; pick it in the sidebar) into a
**signal**: a function of time with processing methods, so it drops straight
into any parameter. First use starts capture (browser permission prompt).

```js
const kick = audio().bandpass(30, 160).kicks()
const bass = audio().lowpass(150).smooth(0.03, 0.2)

ambient({ intensity: 0.2 })
directional({ intensity: 1.5 }).position(4, 6, 3).out()

icosa({ radius: 1 })
  .noise({ amp: bass.mul(1.2).add(0.1), period: 0.4, speed: 0.4 })
  .scale(kick.mul(0.5).add(1))
  .color(kick.counter().select(['#ff5f9e', '#4fd1c5', '#ffd166']))
  .out()
```

- `audio()` — mono mix level (RMS). `audio(2)` — one channel by index; inputs
  with more than 2 channels are fully addressable.
- `audio('scarlett')` — a specific input device by name, independent of the
  sidebar's selection, so two interfaces can drive different parameters.
  `audio('scarlett', 2)` picks a channel of it.
- `.lowpass(hz)` / `.highpass(hz)` / `.bandpass(lo, hi)` — energy (0..1) in a
  region of the spectrum: bass level, treble level, a drum's band.
- `.smooth(up, down?)` — exponential lag in seconds; two args = separate
  attack/release (fast up + slow down = envelope follower).
- `.kicks({ threshold: 1.5, decay: 6, floor: 0.05 })` — onset detector: jumps
  to 1 when the value leaps past `threshold ×` its own moving average, then
  decays. Chain after a band: `.bandpass(30, 160).kicks()` for kick drums,
  `.highpass(5000).kicks()` for hats.
- `.add` `.sub` `.mul` `.div` `.pow` — arithmetic (`pow < 1` lifts quiet
  detail). Each takes a number, a function of `t` or another signal, so the
  operand can move.
- `.range(min, max)` — rescale, and the method that removes most of that
  arithmetic. Signals are 0..1 by convention, so `audio().range(1, 4)` beats
  `.mul(3).add(1)`. `.clamp(lo, hi)` fences a value without rescaling;
  `.range()` deliberately lets an out-of-span input overshoot. For signals
  that aren't 0..1 — `mouse()`, raw trigonometry — name the input span:
  `.range(0, 10, { from: [-1, 1] })`.

The sidebar's **audio out** passes the captured input through to an output
device, handy for monitoring an interface channel. It's where `audiofile()`
plays too, so picking a device moves all of fizzle's sound at once. Mind the
feedback: mic → speakers will howl.

## tempo & sequencing

`beat(perBar)` is the tempo as a rising phase. `perBar` cycles per bar at the
current tempo, counting up as the pulse gets faster:

| call | pulse |
|---|---|
| `beat(1)` | once a bar |
| `beat(4)` | quarter notes — once a beat, and the default |
| `beat(8)` | eighths |
| `beat(16)` | sixteenths |
| `beat(0.5)` | once every two bars |

Shape it into an LFO with `.sin()` / `.tri()` / `.saw()`, into a gate with
`.sqr()`, or use it bare as a list index. The whole part is which cycle you're
in, the fraction is where inside it.

The tempo itself comes from the sidebar, and **`tempo(bpm)`** overrides it for
one sketch:

```js
tempo(174)
circle({ radius: beat(4).saw().mul(-0.3).add(0.4), color: '#ff5f9e' })
  .out()
```

A sketch that names its own tempo keeps it wherever it's played, which is what
you want for one built around a specific track. Drop the call and it follows
the sidebar again.

```js
circle({
  radius: beat(4).saw().mul(-0.2).add(0.4),
  soft: 0.06,
  color: beat(1).select(['#ff5f9e', '#4fd1c5', '#ffd166', '#a78bfa']),
}).out()
```

`.sqr()` is the form the trigger slots want:

```js static
videofile('clip.mp4', { restart: beat(1).sqr(0.05) })   // narrower = tighter pulse
scene().when(beat(4).sqr(), s => s.invert())            // half of every beat
```

- `.sin()` `.tri()` `.saw()` `.sqr(width)` — waveshapes of value-as-phase (one
  cycle per whole unit, 0..1 out). `beat(2).sin()` = two-beat LFO,
  `beat(16).sqr(0.3)` = sixteenth-note gates, `.saw()` = the ramp itself.
- `.beat(perBar?)` — tempo-synced sample-and-hold. `rand().beat(1)` = a new
  random value per bar.
- `.counter(max?, threshold?)` — counts rising edges, wrapping at `max`. For
  event streams like kicks and clicks; `beat()` already counts itself.
- `.select([...])` — index a list by the value (floored, wrapped); items can
  be numbers, colors, strings, or functions of `t`.
- `.gte(v)` / `.lte(v)` — comparison gates, mainly for `.when()` and
  `.counter()`.
- `.hold(trigger, threshold?)` — sample-and-hold driven by **another** signal.
- `.round()` `.floor()` `.ceil()` `.abs()` — the usual math, chainable.

### select — the list as the subject

`select([...], index)` is `.select()` with the list first. Unlike the
method, it can switch between whole **texture chains**:

```js static
select([video(), noise({ freq: 3 }), voronoi()], beat(1)).out()
```

Branches are built once and only the chosen one renders. The index is an
ordinary signal, so it carries the timing:

```js static
select(CHAINS, beat(1))                        // next one each bar, in order
select(CHAINS, audio().kicks().counter())      // advance on every kick
select(CHAINS, rand().mul(3).beat())           // somewhere new each beat
select(CHAINS, mouse('down').counter())        // click to advance
```

It floors and wraps, so a climbing `.counter()` can't index off the end. With
no index it steps one item per second, like `imageseq()`.

## random & custom signals

`rand({ freq, seed })` is a smooth random signal, 0..1, the signal cousin of
the `noise()` texture. Different seeds are independent, so `rand({ seed: i })`
inside a `.tile()` or `.instance()` function gives every copy its own.
`.beat(perBar)` snaps it to the grid, `.hold` samples a new value per trigger:

```js
const hit = beat(4).sqr(0.1)   // stand-in trigger: fires each beat (try audio().kicks())

ambient({ intensity: 0.25 })
directional({ intensity: 1.5 }).position(4, 6, 3).out()

sphere({ res: 96 })
  .noise({ amp: 0.35, freq: 3, seed: rand().hold(hit).mul(4).round() })
  .color('#4fd1c5')
  .out()
```

**A random pick** is `rand()` scaled to the length of a list and used as an
index. Both forms of `select` floor what they're given:

```js static
const color = rand().mul(3).beat(1).select(PALETTE)   // a new color each bar
select(CHAINS, rand().mul(3).beat())                  // a new chain each beat
```

`rand()` is *smooth*, so its values cluster toward the middle and a pick built
on it favors the middle of the list. Over four items, 19 / 31 / 31 / 19 rather
than 25 each. For an even walk, use `.counter()` on a trigger, which remembers
where it is:

```js static
select(CHAINS, audio().kicks().counter())   // every kick advances one, in order
```

`sig(fn)` lifts any `t => ...` into a chainable signal when you want the
processing methods on it: `sig(t => Math.sin(t)).smooth(0.2)`. Free-running
LFOs don't need it.

Bare `sig()` is `t` itself, the seconds-based counterpart to `beat()`. It's
usually the shortest road to a shaped oscillation, since the shapers already
land in 0..1:

```js static
sig().sin().range(0, 10)              // 0..10, once a second
sig().mul(0.25).sin().range(0, 10)    // the same, every four seconds
```

`T` is bare `sig()` as a value rather than a call, so `T.mul(0.25).sin()` is
the second line without the empty parentheses.

## mouse

`mouse()` is the pointer as a signal: **-1..1 with 0 at the center**, y up.
That's the range a `.position()` wants, so it goes straight in:

```js
ambient({ intensity: 0.3 })
directional({ intensity: 1.4 }).position(3, 5, 2).out()

sphere({ radius: 0.6, res: 48 })
  .position(mouse('x').mul(4), mouse('y').mul(2.5), 0)
  .color('#4fd1c5')
  .out()
```

- `mouse('x')` / `mouse('y')` — one axis; bare `mouse()` is x.
- `mouse('down')` — a 1/0 gate while a button is held. `.smooth(0.2)` turns it
  into a ramp, `.counter()` steps a value per click, and it drives `.when()`
  like any other gate.

It reads the *picture*, not the page, so `resolution()`'s letterbox bars don't
skew it and the projector window reports its own pointer.

It's the one signal that isn't 0..1, so `.range()` needs telling:
`mouse('x').range(0, 10, { from: [-1, 1] })`. `.smooth(0.08)` on the way in
takes the stutter out of a hand-held move.

## midi

`midi()` is a controller as signals. `.cc(num)` is one knob or fader, 0..1, so
it goes straight into a parameter:

```js
const m = midi()

bg('#06060c')
ambient({ intensity: 0.25 })
directional({ intensity: 1.4 }).position(3, 5, 2).out()

icosa({ radius: 1.2, res: 96 })
  .noise({ amp: m.cc(74).range(0.05, 0.9), period: 0.5, speed: 0.4 })
  .material({ color: '#4fd1c5', roughness: m.cc(71).range(0.9, 0.05) })
  .out()
```

### learn

You don't have to know the numbers. Leave the call empty, run, then move the
control you want:

```js
ambient({ intensity: 0.3 })
directional({ intensity: 1.4 }).position(3, 5, 2).out()
sphere({ radius: 1, res: 64 }).scale(midi().cc().range(0.5, 2)).color('#ff5f9e').out()
```

The next knob you turn writes itself in (`cc(74, 1)`) and the sketch re-runs
bound to it. The numbers end up in the code rather than in a settings file, so
the binding is visible, editable, and still there when you send the sketch to
someone else.

Empty `.key()` learns the same way from the next key or pad you play. One
empty call is learned per run; with several, run again after each one and work
down the sketch. Deleting the empty call and running is how you cancel.

### keys

`.note`, `.vel`, `.gate` and `.touch` follow the keyboard or the pads:

| signal | is |
|---|---|
| `.note` | pitch of the last key played, 0..1 across the MIDI range |
| `.vel` | how hard it was struck, 0..1 |
| `.gate` | 1 while any key is held, 0 when none is |
| `.touch` | aftertouch: pressure on a key already down, 0..1 |
| `.bend` | the pitch wheel, -1..1 with 0 centered |

`.note` and `.vel` latch, so they hold their value after the release. `.gate`
is the one that drops.

`.bend` is the one here that isn't 0..1, so `.range()` has to be told what
it's reading: `m.bend.range(-Math.PI, Math.PI, { from: [-1, 1] })` is a half
turn either side of the wheel's rest position.

```js
const m = midi()

ambient({ intensity: 0.2 })
directional({ intensity: 1.5 }).position(4, 6, 3).out()

torusKnot({ radius: 1, tube: 0.3, res: 128 })
  // higher notes ride higher and shift toward red, harder hits swell it
  .position(0, m.note.range(-1.5, 1.5), 0)
  .scale(m.vel.smooth(0.01, 0.4).range(0.7, 1.5))
  .color([m.note, 0.45, m.note.sub(1).abs()])
  .rotation(0, t => t * 0.4, 0)
  .out()
```

`.key(38)` narrows all four to one pad, which is what a drum controller wants:
one pad per parameter, each with its own gate.

```js
const pad = midi().key(38)
scene().feedback(pad.gate.smooth(0.02, 0.5).range(0, 0.9)).out()
```

### devices

Bare `midi()` reads every connected device at once, which is what one
controller on the desk wants. A name picks one input by case-insensitive
substring, so two of them can drive different things:

```js
const knobs = midi('launchkey')
const pads = midi('maschine')
```

Typing a quote inside `midi('')` completes on the devices actually plugged in.
The console lists them on the first run.

Safari has no Web MIDI at all. The calls still work there, they just read 0.

## gamepads

`gamepad()` is an Xbox, PlayStation or generic controller as signals. Sticks
are -1..1 with up positive, triggers and buttons are 0..1:

```js
const g = gamepad()

bg('#04060a')
ambient({ intensity: 0.3 })
directional({ intensity: 1.4 }).position(3, 5, 2).out()

sphere({ radius: 0.8, res: 96 })
  .position(g.lx.mul(4), g.ly.mul(2.4), 0)
  .noise({ amp: g.rt.range(0.02, 0.7), period: 0.4, speed: 0.6 })
  .color(g.btn('a').counter().select(['#4fd1c5', '#ff5f9e', '#ffd166']))
  .out()
```

| signal | is |
|---|---|
| `.lx` `.ly` | left stick, -1..1, y up |
| `.rx` `.ry` | right stick |
| `.lt` `.rt` | triggers, 0..1 through their travel |
| `.btn('a')` | a button as a 1/0 gate |

Sticks are the signals that aren't 0..1, so `.range()` needs the input span
named: `g.lx.range(0, 10, { from: [-1, 1] })`. Often `.mul()` is all you want,
since it keeps the sign and the center where they are.

Buttons answer to either brand's names, since the standard mapping puts them
at the same place: `'a'`/`'cross'`, `'b'`/`'circle'`, `'x'`/`'square'`,
`'y'`/`'triangle'`. The d-pad is `'up'`, `'down'`, `'left'`, `'right'`, the
shoulders `'lb'`/`'rb'`, and `'start'`, `'back'`, `'l3'`, `'r3'` are there too.

Empty `.btn()` learns, exactly like `.cc()`: run it, press the button you want,
and the name is written into the call.

Sticks get a small deadzone (0.08) so a worn stick doesn't drift, with the
travel past it rescaled to keep the full reach. `gamepad({ deadzone: 0 })`
turns that off; `gamepad(1)` picks a second pad by slot.

Browsers hide a controller until it sends something, so if nothing reads,
press a button.

### driving the camera

`camera({ pad: true })` hands the orbit rig to the controller. The mouse keeps
working next to it:

```js
camera({ pad: true, x: 0, y: 3, z: 9 })

bg('#04060a')
ambient({ intensity: 0.3 })
directional({ intensity: 1.4 }).position(3, 5, 2).out()

torusKnot({ radius: 1.2, tube: 0.34, res: 220 })
  .material({ color: '#4fd1c5', roughness: 0.3, metalness: 0.5 })
  .out()
```

| control | does |
|---|---|
| right stick | orbits, the way a click-drag does |
| left stick | up and down moves in and out along the view |
| triggers | pan down and up, through their travel |
| bumpers | pan left and right |
| d-pad | pans either way, for a controller with no shoulders |
| right stick click | puts the pan back to the center |

The two pan sources add up rather than one replacing the other, so nothing has
to work out which controller you are holding: a pad without shoulder buttons
reads 0 there and pans on the d-pad alone, and a pad with them gets the
triggers' analog travel, which the d-pad can't give.

Panning is easy to lose your place in, so `r3` undoes it in one press. It moves
the camera along with the target, leaving the angle and the distance where you
had them. `recenter: 'y'` puts it on another button and `recenter: false` turns
it off. Center means the point the call named, not wherever you panned to, so
it keeps meaning the same thing however far you get.

`camera({ fly: true })` navigates instead of orbiting. The left stick moves you
where you are looking, the right stick looks around, and the triggers rise and
fall:

```js
camera({ fly: true, speed: 8 })

bg('#04060a')
ambient({ intensity: 0.3 })
directional({ intensity: 1.4 }).position(3, 5, 2).out()

// something to fly through: a grid of pillars, 12 by 12
box({ width: 0.8, height: 6, depth: 0.8 })
  .instance(144, (x, i) => {
    x.position(((i % 12) - 5.5) * 6, 0, (Math.floor(i / 12) - 5.5) * 6)
  })
  .material({ color: '#8d879b', roughness: 0.6 })
  .out()
```

Orbiting is off while a sketch flies. Flight picks up from wherever the camera
already is, so re-running mid-flight carries on rather than starting over, and
the view you flew to is where the next run without `fly` begins.

`speed` is units per second (default 5), `look` is radians per second (default
0.9 flying, 1.6 on the orbit rig), and either one takes a negative to invert
that axis: `camera({ fly: true, look: -2 })`. `lift` is the triggers on their
own (default 3), sitting under the travel speed because altitude is usually the
finer adjustment:

```js static
camera({ fly: true, speed: 12, lift: 5 })
```

`pad: 1` picks a second controller by slot, and `deadzone` works as it does on
`gamepad()`.

## escape hatches

- `THREE` — the full three.js namespace is in scope for anything the API
  doesn't cover.
- `onFrame((t, dt) => ...)` — register a raw per-frame callback.
- `Texture` / `Geometry` — the types the chains are built from. Adding to a
  prototype adds an op of your own to every chain; see [custom methods](#custom-methods).

```js
ambient({ intensity: 0.3 })
directional({ intensity: 1.5 }).position(4, 6, 3).out()

// THREE for math the API doesn't wrap: lerp between two colors over time
const c1 = new THREE.Color('#ff5f9e')
const c2 = new THREE.Color('#4fd1c5')
const blend = t => '#' + c1.clone().lerp(c2, 0.5 + 0.5 * Math.sin(t)).getHexString()

let spin = 0
onFrame((t, dt) => { spin += dt * (1.5 + Math.sin(t)) })   // custom integrator

torus({ radius: 1.2, tube: 0.4, res: 64 })
  .rotation(0, () => spin, 0)
  .color(blend)
  .out()
```
