// programmed camera orbiting an evolving noise terrain

bg('#8e93af')
fog({ color: '#686e92', near: 6, far: 45 })
ambient({ intensity: 0.95 })
directional({ color: '#ce933b', intensity: 4.6 }).position(10, 6, -4).out()

plane({ width: 90, height: 90, res: 220 })
  .position(0, -2, 0)
  .rotation(-Math.PI / 2, 0, 0)
  .noise({ amp: 2.2, period: 11, octaves: 5, speed: 0.06 })
  .material({ color: '#364963', roughness: 0.9, flatShading: true })
  .out()

// function args -> the sketch drives the camera (orbit controls disabled)
camera(t => Math.cos(t * 0.07) * 14, 4.5, t => Math.sin(t * 0.07) * 14)

scene()
  .bloom({ threshold: 0.75, strength: 0.7 })
  .contrast(1.08)
  .out()
