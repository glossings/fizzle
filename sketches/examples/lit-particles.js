// Particles in the scene's light: .lit() tints each dot by the lights and
// darkens it inside their shadows, .shadow() makes the swarm cast its own.

bg('#04050a')
fog('#04050a', 12, 45)

// Two colored spots crossing over the swarm, both casting
spot({ color: '#66bbff', intensity: 140, angle: 0.6, penumbra: 0.5, shadow: true })
  .position(t => Math.sin(t * 0.3) * 5, 7, 4)
  .out()
spot({ color: '#ff7744', intensity: 110, angle: 0.55, penumbra: 0.5, shadow: true })
  .position(t => Math.cos(t * 0.23) * -5, 6, -2)
  .out()
ambient({ color: '#222233', intensity: 0.15 }).out()

// Floor to catch the swarm's shadow
plane({ width: 40, height: 40 })
  .rotation(-Math.PI / 2, 0, 0)
  .position(0, -2.5, 0)
  .material({ color: '#3a3f4a', roughness: 0.9 })
  .out()

// A near-white swarm, so the lights own the color
torusKnot({ radius: 1.3, tube: 0.4 })
  .particles({ rate: 25000, life: [2.5, 5], speed: [0.1, 0.35] })
  .turbulence({ amp: 0.5, period: 2, speed: 0.3 })
  .drag(0.6)
  .color('#e9e9f2')
  .size([0.02, 0.06])
  .lit()
  .shadow()
  .out()
