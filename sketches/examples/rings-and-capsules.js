// rings-and-capsules — capsule() geometry under ring() texture overlays
// a capsule is a cylinder with hemispherical caps, standing along +Y, so
// .align() aims it the same way. ring() and circle({ radius, thickness })
// draw the same annulus from opposite sides — two edges, or a rim and a width.

bg('#05060c')
fog({ color: '#05060c', near: 10, far: 34 })
ambient({ intensity: 0.18 })
directional({ intensity: 1.3 }).position(4, 7, 5).out()
point({ color: '#ffb066', intensity: 45 }).position(0, 0.5, 0).out()
point({ color: '#4fd1ff', intensity: 30 }).position(-6, -2, 4).out()

camera(0, 4.5, 9)

plane({ width: 30, height: 30, res: 160 })
  .rotation(-Math.PI / 2, 0, 0)
  .position(0, -3, 0)
  .noise({ amp: 0.45, freq: 0.35, octaves: 3, speed: 0.15 })
  .material({ color: '#161d38', roughness: 0.85 })
  .out()

// the core: noise rolls over the hemispherical caps without the crease a
// cylinder's flat lid would leave
capsule({ radius: 0.75, height: 1.5, res: 96 })
  .noise({ amp: 0.1, freq: 2.5, octaves: 3, speed: 0.6 })
  .rotation(0, t => t * 0.4, 0)
  .material({ color: '#ffd08a', roughness: 0.25, metalness: 0.6 })
  .out()

// a ring of little capsules, each one aimed outward off the circle
capsule({ radius: 0.08, height: 0.45, res: 16 })
  .instance(56, (x, i, n, t) => {
    const a = (i / n) * Math.PI * 2 + t * 0.2
    const r = 4.7
    x.position(Math.cos(a) * r, -0.9 + Math.sin(a * 5 + t) * 0.2, Math.sin(a) * r)
      .align([Math.cos(a), 0.35, Math.sin(a)])
      .color(i % 2 ? '#ff5f9e' : '#8affc1')
  })
  .material({ color: '#ffffff', roughness: 0.3, metalness: 0.8 })
  .out()

// two spellings of the same hoop: ring() by its edges, breathing on t...
scene()
  .comp(ring({
    inner: t => 0.30 + 0.02 * Math.sin(t * 0.8),
    outer: 0.33,
    soft: 0.02,               // hard by default; this is a deliberate glow
    color: '#4fd1ff',
  }), 'screen')
  // ...and circle() by its rim and a width, with a noise map thinning the band
  // as it goes round — the pairing ring() leaves to circle()
  .comp(circle({
    radius: 0.42,
    thickness: noise({ freq: 2.5, speed: 0.3 }).mul(0.03).add(0.012),
    color: '#ff5f9e',
  }), 'screen')
  .bloom({ threshold: 0.5, strength: 0.9 })
  .out()
