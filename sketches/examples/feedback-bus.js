// Named buses: .out('name') publishes a point in a chain, input('name') reads
// it anywhere. Wiring forward is same-frame; wiring back is a feedback loop.
// Here 'kal' routes between two chains and 'trail' closes a loop.

bg('#000005')
ambient({ intensity: 0.25 })
directional({ intensity: 2 }).position(3, 5, 4).out()
point({ color: '#ff5f9e', intensity: 50 }).position(-4, 2, 3).out()

torusKnot({ radius: 1, tube: 0.3, res: 96 })
  .rotation(t => t * 0.7, t => t, 0)
  .material({ color: '#4fd1c5', roughness: 0.3, metalness: 0.6 })
  .out()

scene().kaleido(3, { rotate: t => t * 0.05 }).out('kal')   // publish, no display

input('kal')
  .comp(input('trail').transform({ scale: 1.04, rotate: 0.015 }), 'add', 0.75)
  .out('trail')            // trail loop closes here, before the bloom
  .bloom({ threshold: 0.6 })
  .out()
