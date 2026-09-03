// .through(change, fn) — do the work somewhere else and come back. The first
// fn bends the frame, the second works in that bent space, and the bend is
// undone afterwards: the effect keeps the shape of the space, the picture
// doesn't. Commented-out lines are extras: swap one in to try it.

bg('#0d0d18')
ambient({ intensity: 0.25 })
directional({ intensity: 1.6 }).position(4, 6, 3).out()

torusKnot({ radius: 1.1, tube: 0.34, res: 200, p: 2, q: 3 })
  .rotation(t => t * 0.35, t => t * 0.2, 0)
  .material({ color: '#ffd08a', roughness: 0.3, metalness: 0.35 })
  .out()

scene()
  .through(s => s.rotate(t => t * 0.2), p => p.pixellate(72))   // a grid that turns
  // .through(s => s.warp({ twist: 2.2 }), p => p.pixelsort({ threshold: 0.25, length: 300 }))   // streaks rake along the curve
  // .through(s => s.gamma(2.6), p => p.dither(3))               // levels spent in the shadows
  // .through(s => s.displace(noise({ freq: 3, speed: 0.1 }), 0.06), p => p.pixelsort({ length: 200 }))  // streaks follow a field
  .out()
