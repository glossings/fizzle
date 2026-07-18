// programmed camera orbiting an evolving noise terrain

bg('#6d78b6')
fog('#38458f', 6, 45)
ambient(0.85)
directional({ color: '#ffd9a0', intensity: 1.6 }).pos(10, 6, -4).out()

plane({ width: 100, height: 90, res: 500 })
  .pos(0, -2, 0)
  .rotate(-Math.PI / 2, 0, 0)
  .noise({ amp: 2.2, freq: 0.09, octaves: 5, speed: 0.06 })
  .material({ color: '#233247', roughness: 0.4, flatShading: true })
  .out()

// function args -> the sketch drives the camera (orbit controls disabled)
// camera(t => Math.cos(t * 0.07) * 14, 4.5, t => Math.sin(t * 0.07) * 14)

scene()
  .bloom({ threshold: 0.75, strength: 1.7 })
  // .contrast(1.08)
  // .mirror().brightness(0.4)
  .out()
