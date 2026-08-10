// kaleidoscope + video feedback trails over a noisy torus knot

bg('#050508')
ambient({ intensity: 0.2 })
point({ color: '#77ddff', intensity: 50 }).position(3, 4, 2).out()
point({ color: '#ff9955', intensity: 35 }).position(-4, -2, -3).out()

torusKnot({ radius: 1, tube: 0.28, res: 96 })
  .noise({ amp: 0.12, period: 0.4, octaves: 3, speed: 0.6 })
  .rotation(t => t * 0.3, t => t * 0.2, 0)
  .material({ color: '#ff7f50', roughness: 0.3, metalness: 0.5 })
  .out()

// .feedback(amount, fn) comps last frame back over the chain — scaled and
// turned a little each time, so the trail spirals outward as it fades
scene()
  .kaleido(6, { rotate: t => t * 0.02 })
  .feedback(0.95, p => p.transform({ scale: 1.012, rotate: 0.004 }), { mode: 'over' })
  .bloom({ threshold: 0.2, strength: 1.2 })
  .out()
