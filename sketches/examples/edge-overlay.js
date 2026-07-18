// self-referencing comp: the layer can be a fn of the chain so far, so a node
// overlays its *own* edges — here tinted magenta and added on top

bg('#04040a')
ambient(0.3)
point({ color: '#88aaff', intensity: 60 }).pos(4, 3, 3).out()
point({ color: '#ffaa66', intensity: 40 }).pos(-3, -2, 4).out()

icosa({ radius: 1.3, detail: 12 })
  .noise({ amp: 0.35, freq: 1.8, octaves: 4, speed: 0.4 })
  .rotate(0, t => t * 0.25, 0)
  .material({ color: '#223355', roughness: 0.4, metalness: 0.3 })
  .out()

scene()
  .kaleido(4, { rotate: t => t * 0.03 })
  .comp(s => s.edge({ strength: 2.5 }).mul([1, 0.35, 0.8]), 'add')
  .bloom({ threshold: 0.55 })
  .out()
