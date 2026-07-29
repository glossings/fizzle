// named buses: .out('name') publishes a point in a chain, input('name') reads
// it anywhere. Acyclic wiring is a patch cord (same frame); wiring that loops
// back is a feedback loop (last frame). Here 'kal' routes between two separate
// chains, and 'trail' closes a loop pre-bloom so glow never compounds into it.

bg('#000005')
ambient({ intensity: 0.25 })
directional({ intensity: 2 }).pos(3, 5, 4).out()
point({ color: '#ff5f9e', intensity: 50 }).pos(-4, 2, 3).out()

torusKnot({ radius: 1, tube: 0.3, res: 96 })
  .rotate(t => t * 0.7, t => t, 0)
  .material({ color: '#4fd1c5', roughness: 0.3, metalness: 0.6 })
  .out()

scene().kaleido(3, { rotate: t => t * 0.05 }).out('kal')   // publish, no display

input('kal')
  .comp(input('trail').transform({ scale: 1.04, rotate: 0.015 }), 'add', 0.75)
  .out('trail')            // trail loop closes here, before the bloom
  .bloom({ threshold: 0.6 })
  .out()
