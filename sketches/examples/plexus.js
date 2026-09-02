// Classic plexus: a drifting particle system, a line wherever two come near, a
// triangle wherever three do.

bg('#05060b')

ambient({ intensity: 0.15 })
directional({ color: '#7df', intensity: 20 }).position(5, 3, 4).out()
directional({ color: '#f7a', intensity: 20 }).position(-5, -2, 3).out()

sphere({ radius: 1 })
  .particles({ rate: 20, life: 10, speed: 0.15 })
  .turbulence({ amp: 0.1, freq: 0.4 })
  .drag(0.2)
  .size(0.06).color('#cfe8ff')
  .link({ within: 0.7, fill: 0.4, lit: true })
  .out()

scene().out()
