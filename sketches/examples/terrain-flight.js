// programmed camera orbiting an evolving noise terrain

bg('#0a0c18')
fog({ color: '#0a0c18', near: 6, far: 45 })
ambient({ intensity: 0.25 })
directional({ color: '#ffd9a0', intensity: 1.6 }).pos(10, 6, -4).out()

plane({ width: 90, height: 90, res: 220 })
  .pos(0, -2, 0)
  .rotate(-Math.PI / 2, 0, 0)
  .noise({ amp: 2.2, freq: 0.09, octaves: 5, speed: 0.06 })
  .material({ color: '#233247', roughness: 0.9, flatShading: true })
  .out()

// function args -> the sketch drives the camera (orbit controls disabled)
camera(t => Math.cos(t * 0.07) * 14, 4.5, t => Math.sin(t * 0.07) * 14)

scene()
  .bloom({ threshold: 0.75, strength: 0.7 })
  .contrast(1.08)
  .out()
