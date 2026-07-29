// geometry layers: .out('name') sends a geometry to its own render layer
// instead of the visible scene; input('name') pulls that layer as a TOP.
// Each layer gets its own treatment before they comp back together.

bg('#000008')
ambient({ intensity: 0.35 })
point({ color: '#ffffff', intensity: 70 }).pos(4, 4, 4).out()
point({ color: '#7788ff', intensity: 40 }).pos(-4, -1, 3).out()

torusKnot({ radius: 1, tube: 0.28, res: 96 })
  .rotate(t => t * 0.4, t => t * 0.3, 0)
  .material({ color: '#ff7f50', roughness: 0.35 })
  .out('knot')

icosa({ radius: 1.5, detail: 12 })
  .noise({ amp: 0.3, freq: 2, octaves: 4, speed: 0.5 })
  .material({ color: '#4fd1c5', roughness: 0.4, metalness: 0.3 })
  .out('blob')

input('knot')
  .edge({ strength: 2.5 })
  .mul([1, 0.55, 0.25])                 // knot becomes amber wireframe-ish edges
  .comp(input('blob').pixellate(80), 'add')  // blob goes chunky, added on top
  .bloom({ threshold: 0.35, strength: 1.2 })
  .out()
