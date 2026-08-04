// CRT: phosphor cells, scanlines, colour fringing, and a barrel-warped tube face

bg('#04060a')
ambient({ intensity: 0.25 })
point({ color: '#66ffcc', intensity: 45 }).position(3, 3, 4).out()
point({ color: '#ff4488', intensity: 25 }).position(-3, -2, 2).out()

torusKnot({ radius: 1, tube: 0.3, res: 128 })
  .rotation(t => t * 0.4, t => t * 0.25, 0)
  .material({ color: '#22ddaa', roughness: 0.35, metalness: 0.4 })
  .out()

// a triangle wave up the frame = 80 soft stripes, dark trough to bright crest
const scanlines = ramp({ angle: Math.PI / 2, freq: 80, shape: 'tri', a: '#585858', b: '#ffffff' })

const vignette = ramp({ type: 'radial', a: '#ffffff', b: '#303030' })

scene()
  .pixellate(360)                      // phosphor cells
  .comp(scanlines, 'mult')
  .comp(vignette, 'mult')
  .chroma(0.004, { radial: true })     // lens fringing: none at center, most at the corners
  .warp({ barrel: 0.28, zoom: 1.04 })  // the glass tube face — corners go black
  .bloom({ threshold: 0.45, strength: 0.9 })
  .out()
