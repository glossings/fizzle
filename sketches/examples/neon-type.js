// text two ways: extruded 3d type + canvas text TOPs
// text3d content can be a fn of t — geometry rebuilds only when the string changes

bg('#0a0a12')
ambient(0.25)
directional({ intensity: 1.6 }).pos(3, 5, 4).out()
point({ color: '#ff5f9e', intensity: 60 }).pos(t => Math.sin(t * 0.7) * 5, 2, 3).out()
point({ color: '#4fd1ff', intensity: 40 }).pos(-4, -1, 4).out()

text3d('FIZZLE', { size: 1.1, depth: 0.35, bevel: 0.03, weight: 'bold' })
  .rotate(0, t => Math.sin(t * 0.4) * 0.4, 0)
  .noise({ amp: 0.03, freq: 4, octaves: 3, speed: 1 })
  .material({ color: '#ffcc55', metalness: 0.7, roughness: 0.25 })
  .out()

// a live counter in 3d, below the headline
text3d(t => `t = ${t.toFixed(0)}`, { size: 0.35, depth: 0.1, bevel: 0.01 })
  .pos(0, -1.6, 0)
  .material({ color: '#4fd1c5', metalness: 0.4, roughness: 0.4 })
  .out()

scene()
  .comp(input().transform({ scale: 1.01 }).mul(0.9), 'lighten')
  .bloom({ threshold: 0.55, strength: 1.2 })
  .comp(text('canvas text: any css font\nmultiline too', {
    size: 0.045, pos: [0.5, 0.09], color: '#8890a8', font: 'Georgia, serif', weight: 400,
  }), 'add')
  .out()
