// a noised layout source: .sample() re-runs the .noise() field on the CPU, so
// the points land on the same deformed surface the GPU draws — the spikes ride
// the swells instead of hovering over a smooth sphere nobody can see.

bg('#04070d')
ambient({ intensity: 0.25 })
directional({ color: '#ffd9b0', intensity: 2 }).pos(5, 7, 4).out()
point({ color: '#6bb8ff', intensity: 50 }).pos(-5, -2, 4).out()

// drawn and sampled from the same chain
const blob = sphere({ radius: 2, res: 96 })
  .noise({ amp: 0.5, freq: 1.2, octaves: 3, speed: 0.25 })

blob.material({ color: '#152238', roughness: 0.35, metalness: 0.6 }).out()

// the surface moves, so everything derives inside the layout fn — sample(i)
// and normal(i) track the swell under each copy every frame
cylinder({ radiusTop: 0, radiusBottom: 0.07, height: 0.45, res: 8 })
  .instance(700, (x, i) => {
    const n = blob.normal(i)
    return x.pos(blob.sample(i)).align(n).scale(1, 1 + 0.6 * n.y, 1)
  })
  .material({ color: '#9fd8ff', emissive: '#2e5f8f', roughness: 0.4 })
  .out()

camera(0, 1, 8)

scene()
  .bloom({ threshold: 0.55, strength: 0.8 })
  .out()
