// geo.sample(i): a shape used as a layout, not as something drawn. `shell`
// never reaches .out(), so it renders nothing — it only says where the copies
// go, and .normal(i) says which way they face there.

bg('#05060c')
ambient({ intensity: 0.3 })
directional({ color: '#ffe8c0', intensity: 2.2 }).position(5, 6, 3).out()
point({ color: '#4fd1c5', intensity: 60 }).position(-4, -2, 3).out()

const shell = torusKnot({ radius: 2.2, tube: 0.7, res: 64 })

// the points don't move, so anything derived only from i is worth working out
// once rather than 900 times a frame — here, a color per copy from its facing
const tint = Array.from({ length: 900 }, (_, i) => {
  const p = shell.normal(i)
  return `hsl(${Math.round(180 + 80 * p.y)}, 70%, ${Math.round(45 + 20 * p.x)}%)`
})

// spikes standing off the surface: .align() aims each cone along the normal
cylinder({ radiusTop: 0, radiusBottom: 0.09, height: 0.5, res: 8 })
  .instance(900, (x, i, n, t) => x
    .position(shell.sample(i))
    .align(shell.normal(i))
    .scale(1, 1 + 0.6 * Math.sin(t * 2 + i), 1)
    .color(tint[i]))
  .material({ roughness: 0.3, metalness: 0.4 })
  .out()

// the same point set, indexed from the far end: a sparse dusting of beads that
// can't collide with the spikes, since sample(i) is stable per index
sphere({ radius: 0.05, res: 8 })
  .instance(120, (x, i) => x.position(shell.sample(2000 + i)).scale(1 + (i % 3)))
  .material({ color: '#fff2cc', emissive: '#ffcc66', roughness: 0.5 })
  .out()

camera(0, 1, 9)

scene()
  .bloom({ threshold: 0.5, strength: 0.9 })
  .out()
