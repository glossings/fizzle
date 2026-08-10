// geo.sample(i): a shape used as a layout rather than drawn. `shell` never
// reaches .out(), so it only says where the copies go; .normal(i) says which
// way they face.

bg('#05060c')
ambient({ intensity: 0.3 })
directional({ color: '#ffe8c0', intensity: 2.2 }).position(5, 6, 3).out()
point({ color: '#4fd1c5', intensity: 60 }).position(-4, -2, 3).out()

const shell = torusKnot({ radius: 2.2, tube: 0.7, res: 64 })

// The points don't move, so a color per copy can be worked out once up front
// instead of 900 times a frame.
const tint = Array.from({ length: 900 }, (_, i) => {
  const p = shell.normal(i)
  return `hsl(${Math.round(180 + 80 * p.y)}, 70%, ${Math.round(45 + 20 * p.x)}%)`
})

// Spikes standing off the surface — .align() aims each cone along the normal
cylinder({ radiusTop: 0, radiusBottom: 0.09, height: 0.5, res: 8 })
  .instance(900, (x, i, n, t) => x
    .position(shell.sample(i))
    .align(shell.normal(i))
    .scale(1, 1 + 0.6 * Math.sin(t * 2 + i), 1)
    .color(tint[i]))
  .material({ roughness: 0.3, metalness: 0.4 })
  .out()

// The same point set, indexed from the far end — sample(i) is stable per
// index, so these beads never land on a spike.
sphere({ radius: 0.05, res: 8 })
  .instance(120, (x, i) => x.position(shell.sample(2000 + i)).scale(1 + (i % 3)))
  .material({ color: '#fff2cc', emissive: '#ffcc66', roughness: 0.5 })
  .out()

camera(0, 1, 9)

scene()
  .bloom({ threshold: 0.5, strength: 0.9 })
  .out()
