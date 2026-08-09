// GPU particles: a shape dissolving into wind, and a fountain chasing the
// pointer. The swarms live outside the patch — change a force and press
// ctrl+enter, and they keep flying under the new weather rather than starting
// over.

bg('#05060c')

// a torus shedding embers: born on its surface, leaving along the normals
// ('out' is the default from a shape), stirred by turbulence.
// The source shape spins, and its births spin with it — it's never drawn.
torus({ radius: 1.6, tube: 0.55 })
  .rotation(Math.PI / 2, 0, t => t * 0.2)
  .particles({ rate: 20000, life: [1.5, 3], speed: [0.2, 0.6], spread: 0.25 })
  .turbulence({ amp: T.mul(0.3).sin().mul(0.4), period: 2.4, speed: 0.35 })
  .drag(0.4)
  .color("#ee26fd", "#3224ff")
  .evolve((p, life) => p
    .size(0.05 * Math.sin(life * Math.PI))   // swell in, shrink out
    .force(0, 1.5 - life * 8, 0))            // lift young, sink old
  .blend('add')
  .out()

// a fountain from a point, fighting gravity and losing — then pulled off
// course wherever the pointer goes
particles({ rate: 6000, life: [2, 4], pos: [0, -2.4, 0], spread: 0.1, speed: [4, 6.5] })
  .force(0, -2.4, 0)
  .attract([mouse('x').mul(5), mouse('y').mul(3), 0], { strength: 10, radius: 0.7 })
  .size([0.012, 0.035])
  .color('#4fd1c5', '#22557f')
  .blend('add')
  .out()

scene()
  .bloom({ threshold: 0.35, strength: 1 })
  .out()
