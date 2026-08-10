// datamosh — a video decoder built out of texture ops. Drop the keyframes and
// it keeps pushing the last picture around with the new shot's motion.
// Motion vectors are estimated: direction from the gradient, magnitude from
// the frame difference.

const FLY = 6            // tunnel speed, units/sec
const SPAN = 90          // how far the tunnel runs before it wraps
const CUT = 1.9          // seconds per shot
const KEEP = 2.6         // seconds of intact video
const DROP = 6.2         // seconds with every keyframe deleted

const shot = t => Math.floor(t / CUT)
const hash = (n, k = 0) => {
  const x = Math.sin(n * 127.1 + k * 311.7) * 43758.5453
  return x - Math.floor(x)
}

// Stepped on `shot`: jumps at each cut, drifts smoothly in between
const flight = t => t * FLY + hash(shot(t)) * SPAN
const sway = (t, k) => Math.sin(t * (0.5 + k * 0.17) + hash(shot(t), k) * 6.283) * (0.8 + k * 0.5)

const keyframe = t => (t % (KEEP + DROP) < KEEP ? 1 : 0)

// --- the shot ---

bg('#04040a')
fog({ color: '#04040a', near: 4, far: 42 })
ambient({ intensity: 0.2 })

camera(
  t => sway(t, 0),
  t => sway(t, 1) * 0.3,
  6,
  [t => sway(t, 2) * 0.9, t => sway(t, 3) * 0.4, -14],
)

point({ color: '#ff4d6d', intensity: 90 }).position(3, 2.5, 1).out()
point({ color: '#4dd8ff', intensity: 90 }).position(-3, -2, -9).out()
point({ color: '#ffffff', intensity: 40 }).position(0, 0, -20).out()

// A spiral of blocks pulled toward the camera — moving the geometry instead of
// the camera keeps the tunnel endless
box({ width: 1.5, height: 1.5, depth: 1.5, res: 1 })
  .material({ color: '#c8d0e0', roughness: 0.4, metalness: 0.25 })
  .instance(220, (x, i, n, t) => {
    const a = i * 0.55
    const z = ((i * 0.62 + flight(t)) % SPAN) - SPAN + 8
    x.position(Math.cos(a) * 4.4, Math.sin(a) * 4.4, z)
      .rotation(a, a * 0.6, t * 0.2)
      .scale(1 - (i % 5) * 0.09)
  })
  .out()

torusKnot({ radius: 1.5, tube: 0.42, res: 128 })
  .rotation(t => t * 0.6, t => t * 0.45, 0)
  .material({ color: '#ff7a3c', roughness: 0.3, metalness: 0.6 })
  .out()

// --- the decoder ---

const BLOCKS = 40        // macroblocks across the frame
const PUSH = 0.05        // how far one frame of vectors drags a block
const PATCH = 0.11       // residual: how much of the live render leaks back in

scene().out('src')
const live = input('src')

// A running average of the render — reads its own last frame, so it lags
live.comp(input('lag'), 'over', 0.5).out('lag')

// Motion: the live frame against its own history, not against the moshed
// output (which would saturate as the smear diverges)
const motion = live
  .comp(input('lag'), 'diff')
  .saturation(0)
  .mul(9)
  .blur(3)
  .pixellate(BLOCKS)                          // decided per block, like a codec
  .threshold(0.1, { soft: 0.4 })

// Direction, on the same grid — slope() is 0.5-centered, so a flat block
// doesn't move
const vectors = live.blur(2).slope({ strength: 2.4 }).pixellate(BLOCKS)

input('mosh')                                 // the picture being held
  // moving blocks get a vector and a residual; the rest keep last frame's
  // pixels — so the moving parts melt and the still parts freeze
  .mask(motion, s => s
    .displace(vectors, PUSH)
    .comp(live, 'over', PATCH))
  .when(keyframe, () => live)                 // keyframe arrives: whole picture
  .out('mosh')                                // the loop closes here
  .comp(motion.mul([0.05, 0.02, 0.09]), 'add')  // block grid, faintly visible
  .chroma(0.002)
  .bloom({ threshold: 0.7, strength: 0.5 })
  .comp(
    text(t => (keyframe(t) ? 'GOP  I P P P P P' : 'GOP  · P P P P P'), {
      size: 0.035,
      pos: [0.06, 0.92],
      align: 'left',
    }),
    'screen',
  )
  .out()

// more to try:
// KEEP = 0.2                                 // never recovers
// PATCH = 0                                  // no residual — pure smear, dies fast
// BLOCKS = 8                                 // huge blocks, very obviously fake
// PUSH = 0.2                                 // one frame of motion throws it across the screen
// .threshold(0.02, { soft: 0.05 })           // everything counts as moving
