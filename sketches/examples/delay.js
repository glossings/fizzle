// delay — the picture as it was n frames ago.
//
// A feedback loop only ever reaches back one frame, and blending it into
// itself gives a smear with no definite age. .delay(n) hands back a specific
// past frame, which makes two things easy: diffing against your own past
// (what moved), and echoes with real spacing between the ghosts.

const GAP = 6         // frames between ghosts
const GHOSTS = 4

bg('#04040a')
ambient({ intensity: 0.25 })
directional({ intensity: 1.5 }).position(3, 5, 2).out()
point({ color: '#ff4d6d', intensity: 60 }).position(-3, -2, 3).out()

torusKnot({ radius: 1.2, tube: 0.34, res: 200, p: 2, q: 3 })
  .rotation(t => t * 0.7, t => t * 0.45, 0)
  .position(t => Math.sin(t * 0.9) * 1.6, t => Math.sin(t * 1.4) * 0.5, 0)
  .material({ color: '#7ee787', roughness: 0.3, metalness: 0.5 })
  .out()

scene().out('src')

// Each ghost is one delay, further back and fainter. Stored at half size:
// they're behind the live frame and softened by the comp, so the resolution
// is never on show — and it makes the whole stack a quarter of the memory.
let echo = input('src')
for (let i = 1; i <= GHOSTS; i++) {
  echo = echo.comp(
    input('src').delay(GAP * i, { scale: 0.5 }).mul(1 - i / (GHOSTS + 1)),
    'lighten',
  )
}

// ...and the motion mask: the live frame against itself two frames back. Still
// pixels cancel to black, moving edges survive — here tinted and added on top.
const motion = input('src')
  .comp(s => s.delay(2), 'diff')
  .saturation(0)
  .mul(6)
  .threshold(0.15, { soft: 0.3 })

echo
  .comp(motion.mul([1, 0.2, 0.5]), 'add')
  .bloom({ threshold: 0.5 })
  .out()

// more to try:
// GAP = 1                                   // ghosts too close to separate — a trail
// GAP = 25                                  // a beat behind, one shape at a time
// .delay(t => 20 + Math.sin(t) * 18, { scale: 0.5 })       // the lag animates
// input('src').comp(s => s.delay(1), 'diff').mul(8).out()   // motion alone
