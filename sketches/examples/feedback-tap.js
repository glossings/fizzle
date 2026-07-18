// named feedback: .fbend('trail') closes the loop *right there* in the chain,
// so the trail accumulates pre-bloom and the glow never compounds into it.
// Try moving .fbend after .bloom (or switching to plain feedback()) to compare.

bg('#000005')
ambient(0.25)
directional({ intensity: 2 }).pos(3, 5, 4).out()
point({ color: '#ff5f9e', intensity: 50 }).pos(-4, 2, 3).out()

torusKnot({ radius: 1, tube: 0.3, res: 96 })
  .rotate(t => t * 0.7, t => t, 0)
  .material({ color: '#4fd1c5', roughness: 0.3, metalness: 0.6 })
  .out()

scene()
  .comp(feedback('trail').transform({ scale: 1.04, rotate: 0.015 }), 'add', 0.75)
  .fbend('trail')
  .bloom({ threshold: 0.6 })
  .out()
