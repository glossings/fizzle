// Every naked .out() is a layer, painted in code order: geometry and textures
// interleave. The knot sits under the rings and the moons orbit over them,
// even on the far side of the knot.
// Commented-out lines are extras: uncomment one to try it.

bg('#0b1020')
ambient({ intensity: 0.3 })
directional({ intensity: 1.6 }).position(4, 6, 3).out()
point({ color: '#ff5f9e', intensity: 40 }).position(-4, -2, 3).out()

torusKnot({ radius: 1.1, tube: 0.32, res: 160 })
  .rotation(T.mul(0.3), T.mul(0.2), 0)
  .material({ color: '#4fd1c5', roughness: 0.3, metalness: 0.5 })
  .out()

ring({ inner: 0.3, outer: 0.31, color: '#ffe066', bg: null })
  .comp(ring({ inner: 0.36, outer: 0.365, color: '#ffe066', bg: null }), 'over')
  .scale(T.mul(0.16).sin().range(1, 1.08))
  .out()

const orbit = curve.circle(2.4)

sphere({ radius: 0.22, res: 32 })
  .instance(3, (x, i, n, t) => x.position(orbit(t * 0.13 + i / n)))
  .material({ color: '#ff9f5f', roughness: 0.4 })
  .out()

// scene().bloom({ threshold: 0.4, strength: 0.8 }).out()   // scene() reads all the geometry above it, rings left out
// noise({ period: 0.4, speed: 0.1, a: null, b: '#ffffff' }).alpha(0.15).out()   // one more layer, over everything
