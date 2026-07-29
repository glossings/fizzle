// dreamcore — a hall you are sure you have been in before, lit through a
// window that isn't in the room.
//
// The shadows are the whole piece. One hard low light rakes down the length of
// the hall so every column throws a stripe across the floor; shadows are what
// turn "a room" into "a room at a particular hour". They're opt-in per light
// (shadow: true) and on by default for geometry — which is why the ceiling has
// to say .shadow(false), or it would cap the room and nothing would ever get in.
//
// The camera never moves. The hall walks past it.

const SPEED = 4.2          // world units per second, drifting toward the camera
const SPAN = 9             // half-width of the hall
const CEIL = 5.2
const TILE = 3             // floor square, world units
const FLOOR_W = 54, FLOOR_L = 198

// A column that reaches z = 16 is behind the camera, so that's where the run
// wraps and it can start again at the far end without anyone seeing it.
const loopZ = (offset, run, t) => ((offset + t * SPEED) % run + run) % run - run + 16

bg('#e7b9d4')
fog('#e7b9d4', 8, 54)

camera(
  t => Math.sin(t * 0.31) * 1.3,
  t => 1.7 + Math.sin(t * 0.47) * 0.07,
  9,
  [t => Math.sin(t * 0.23) * 2.4, 1.9, -14]
)

// --- light ---

// Low and off to one side: a light overhead puts the shadows under the columns
// where nobody can see them. area is the shadowed box's half-width — it has to
// reach as far as the fog leaves visible, and no further, because 2048 texels
// get spread across all of it however wide you make it.
directional({
  color: '#fff1e4',
  intensity: 3.6,
  shadow: { area: 40, soft: 2.5, far: 120, strength: 0.94 },
}).pos(30, 11, 6).target(-4, 0, -18).out()

ambient(0.2, '#cbd8ff')
hemi({ sky: '#ffd6ee', ground: '#5d4f6e', intensity: 0.7 }).out()

// --- room ---

// A checkerboard with no image file in it: two ramps cut in half, differenced.
// |a - b| of two black/white halves is 1 where exactly one is white, which is
// a 2×2 checker — then repeat tiles it down the hall. The last pass slides the
// pattern at exactly the speed the columns move, so the floor comes with them.
const checker = ramp().threshold(0.5)
  .comp(ramp({ angle: Math.PI / 2 }).threshold(0.5), 'difference')
  .mul(0.5).add(0.45)                     // a full black tile eats the light
  .translate(0, t => -t * SPEED / (TILE * 2), { wrap: 'repeat' })

plane({ width: FLOOR_W, height: FLOOR_L, res: 1 })
  .rotate(-Math.PI / 2, 0, 0)
  .material({
    map: checker,
    repeat: [FLOOR_W / (TILE * 2), FLOOR_L / (TILE * 2)],
    color: '#d9c3d2',
    roughness: 0.5,
  })
  .shadow({ cast: false })                // flat: nothing to cast, everything to catch
  .out()

// The lid. It has to be out of the shadow pass entirely — a ceiling that casts
// is a ceiling, and the light is above it, so the room would simply be dark.
plane({ width: FLOOR_W, height: FLOOR_L, res: 1 })
  .rotate(Math.PI / 2, 0, 0)
  .pos(0, CEIL, 0)
  .material({ color: '#f7dcec', roughness: 0.95 })
  .shadow(false)
  .out()

const GAP = 9, COLS = 8
box({ res: 1 })
  .instance(COLS * 2, (x, i, n, t) => {
    // pairs: even index left, odd right, both at the same station down the hall
    const z = loopZ((i >> 1) * GAP, GAP * COLS, t)
    x.pos((i % 2 ? 1 : -1) * SPAN, CEIL / 2, z).scale(1.1, CEIL, 1.1)
  })
  .material({ color: '#f0e5ec', roughness: 0.65 })
  .out()

// Displaced geometry casts a displaced shadow: the shadow pass gets its own
// copy of the .noise() vertex shader, so these read as lumps rather than as
// the spheres they started life as.
const DRIFT = 11, BLOBS = 7
icosa({ radius: 1, detail: 4 })
  .noise({ amp: 0.22, freq: 1.6, octaves: 4, speed: 0.25 })
  .instance(BLOBS, (x, i, n, t) => {
    x.pos(
      Math.sin(i * 2.3) * 4.6,
      2.3 + Math.sin(t * 0.6 + i * 1.7) * 0.55,
      loopZ(i * DRIFT, DRIFT * BLOBS, t)
    ).rotate(0, t * 0.14 + i, 0).scale(0.75 + (i % 3) * 0.22)
  })
  .material({ color: '#ffffff', roughness: 0.3, metalness: 0.1 })
  .out()

// --- grade ---

scene()
  .mask(depth({ near: 16, far: 52 }), s => s.blur(3))   // the far end can't hold focus
  // a 1D luma LUT: shadows land on violet, highlights on pale pink. Blended
  // back at just over half, so the room keeps some of its own color.
  .comp(s => s.lookup(ramp({ a: '#2b1c3f', b: '#fff0f8' })), 'over', 0.55)
  .levels({ saturation: 1.1, gamma: 1.05 })
  .comp(noise({ freq: 400, octaves: 1, speed: 40 }), 'overlay', 0.05)
  .chroma(0.002, { radial: true })
  .bloom({ threshold: 0.6, strength: 0.9, radius: 1.5 })
  .mask(ramp({ type: 'radial', a: '#ffffff', b: '#cdcdcd', phase: -0.12 }))
  .out()

// more to try:
// shadow: { soft: 0 }              // hard-edged — noon instead of late afternoon
// shadow: { strength: 0.5 }        // half-dark shadows, as if the air were lit
// .pos(30, 3, 6)                   // drop the light and the stripes run for miles
// .target(-4, 0, -60)              // aim it away and the shadows swing round
// .shadow(false) on the columns    // the room goes flat — that's what they were doing
// TILE = 1.5                       // smaller squares; watch the far floor shimmer
// SPEED = 0                        // stop, and it's just a room
