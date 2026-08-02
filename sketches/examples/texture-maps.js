// texture chains as material maps: any chain can go where a filename goes in
// .material(), and it re-renders every frame — so the surface is live.
//
// The screen's color map is a texture feedback loop, published on a bus so the
// material can read it. The floor's relief and roughness are noise textures, one
// of them moving real vertices. Map chains render before the 3D pass that
// samples them, so all of this is the current frame, not a frame behind.

bg('#04040a')
fog({ color: '#04040a', near: 9, far: 34 })
camera(0, 1.2, 8)

ambient({ intensity: 0.15 })
point({ color: '#ffffff', intensity: 90 }).pos(0, 2.2, 3.2).out()
point({ color: '#7fd7ff', intensity: 40 }).pos(-4, 1.5, 2).out()

// a self-contained feedback loop — no 3D in it at all. On a bus so the panel
// below can read it (and so the cycle has somewhere to close).
circle({ radius: 0.07, soft: 0.05, color: '#7ee787' })
  .translate(t => Math.sin(t * 1.3) * 0.36, t => Math.sin(t * 0.9) * 0.3)
  .comp(input('screen').transform({ scale: 0.985, rotate: 0.012 }), 'add', 0.9)
  .out('screen')

plane({ width: 5.4, height: 3.2 })
  .pos(0, 0.7, -1.6)
  .material({ map: input('screen'), roughness: 0.35, metalness: 0.1 })
  .out()

// displacementMap moves real vertices, so the plane needs vertices to move
plane({ width: 40, height: 40, res: 220 })
  .rotate(-Math.PI / 2, 0, 0)
  .pos(0, -1.6, 0)
  .material({
    color: '#2b2540',
    displacementMap: noise({ freq: 4, octaves: 4, speed: 0.12 }),
    displaceScale: 0.7,
    roughnessMap: noise({ freq: 14, speed: 0.5, seed: 3 }),
    repeat: 3,
    metalness: 0.3,
  })
  .out()

torusKnot({ radius: 0.7, tube: 0.2, res: 96 })
  .pos(t => Math.sin(t * 0.5) * 2.6, 0.3, 2.2)
  .rotate(t => t * 0.5, t => t * 0.35, 0)
  .material({ color: '#ffd166', roughness: 0.3, metalness: 0.5 })
  .out()

scene()
  .bloom({ threshold: 0.5, strength: 0.8 })
  .out()
