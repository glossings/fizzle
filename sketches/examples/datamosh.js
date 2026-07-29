// Datamosh — the decoder rebuilt out of TOPs.
//
// A compressed frame is one of two things: a keyframe, which is a whole
// picture, or a P-frame, which is only per-block motion vectors plus a small
// residual patch. Delete the keyframes and the decoder has no picture to draw
// onto, so it keeps shoving the last one it had around using the new shot's
// motion — pixels from one scene, movement from another.
//
// There are no real motion vectors here (no codec), so they're estimated:
// direction from the image gradient, magnitude from frame difference. The
// rest is literally a decoder — 'mosh' is the picture it's holding.

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

// stepped on `shot`, so every value that reads it jumps at the cut and drifts
// smoothly in between — a hard discontinuity is exactly what a keyframe is for
const flight = t => t * FLY + hash(shot(t)) * SPAN
const sway = (t, k) => Math.sin(t * (0.5 + k * 0.17) + hash(shot(t), k) * 6.283) * (0.8 + k * 0.5)

const keyframe = t => (t % (KEEP + DROP) < KEEP ? 1 : 0)

// --- the shot ---

bg('#04040a')
fog('#04040a', 4, 42)
ambient(0.2)

camera(
  t => sway(t, 0),
  t => sway(t, 1) * 0.3,
  6,
  [t => sway(t, 2) * 0.9, t => sway(t, 3) * 0.4, -14],
)

point({ color: '#ff4d6d', intensity: 90 }).pos(3, 2.5, 1).out()
point({ color: '#4dd8ff', intensity: 90 }).pos(-3, -2, -9).out()
point({ color: '#ffffff', intensity: 40 }).pos(0, 0, -20).out()

// a spiral of blocks pulled toward the camera. Moving the geometry rather than
// the camera keeps the tunnel endless, and puts the cut in the same expression
box({ width: 1.5, height: 1.5, depth: 1.5, res: 1 })
  .material({ color: '#c8d0e0', roughness: 0.4, metalness: 0.25 })
  .instance(220, (x, i, n, t) => {
    const a = i * 0.55
    const z = ((i * 0.62 + flight(t)) % SPAN) - SPAN + 8
    x.pos(Math.cos(a) * 4.4, Math.sin(a) * 4.4, z)
      .rotate(a, a * 0.6, t * 0.2)
      .scale(1 - (i % 5) * 0.09)
  })
  .out()

torusKnot({ radius: 1.5, tube: 0.42, res: 128 })
  .rotate(t => t * 0.6, t => t * 0.45, 0)
  .material({ color: '#ff7a3c', roughness: 0.3, metalness: 0.6 })
  .out()

// --- the decoder ---

const BLOCKS = 40        // macroblocks across the frame
const PUSH = 0.05        // how far one frame of vectors drags a block
const PATCH = 0.11       // residual: how much of the live render leaks back in

scene().out('src')
const live = input('src')

// An exponential average of the render. It reads its own last frame, so this
// chain is a loop and 'lag' is genuinely behind — the only way to get a
// delayed copy of anything (an acyclic bus is a patch cord, same frame).
live.comp(input('lag'), 'over', 0.5).out('lag')

// Motion, estimated from the render alone: the live frame against its own
// history. Deliberately *not* measured against the moshed output — that would
// saturate as the smear diverges, and every block would think it was moving.
const motion = live
  .comp(input('lag'), 'diff')
  .saturation(0)
  .mul(9)
  .blur(3)
  .pixellate(BLOCKS)                          // decided per block, like a codec
  .threshold(0.1, { soft: 0.4 })

// Direction. slope() is 0.5-centred, which is the neutral displace() wants, so
// a block with no gradient doesn't move. Quantized to the same grid.
const vectors = live.blur(2).slope({ strength: 2.4 }).pixellate(BLOCKS)

input('mosh')                                 // the picture being held
  // blocks with motion get a vector and a residual; the rest are skipped, and
  // a skipped block is simply last frame's pixels, untouched. That asymmetry
  // is the whole look: the moving parts melt, the still parts freeze.
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
