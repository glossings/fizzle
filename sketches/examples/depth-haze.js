// depth haze — depth() reads the render's depth buffer: black up close, white
// far away. Used as a mask, that makes depth of field (mask a blur) and
// atmospheric haze (mask a color) one-liners.
// Commented-out lines are extras: uncomment one to try it.

bg('#06060b')
fog({ color: '#06060b', near: 5, far: 34 })          // depth() picks this range up automatically

ambient({ intensity: 0.1, color: '#8fa2c8' })

// Three ceiling lamps sliding toward the camera on a loop, so the corridor
// never ends. The same z fn drives the lights and the fixtures.
const lampZ = (i) => (t) => (((t * 3.5 + i * 12) % 36) - 32)

for (let i = 0; i < 3; i++) {
  point({ color: '#ffe0a8', intensity: 55, distance: 18 }).position(0, 3.1, lampZ(i)).out()
}

box({ width: 1.8, height: 0.12, depth: 0.5 })
  .instance(3, (x, i, n, t) => x.position(0, 3.25, lampZ(i)(t)))
  .material({ color: '#fff4de', emissive: '#ffdca0', emissiveIntensity: 4 })
  .out()

// The corridor: floor, ceiling, two walls
plane({ width: 7, height: 90 }).rotation(-Math.PI / 2, 0, 0).position(0, -2.2, -32)
  .material({ color: '#2a2622', roughness: 0.95 }).out()
plane({ width: 7, height: 90 }).rotation(Math.PI / 2, 0, 0).position(0, 3.4, -32)
  .material({ color: '#191921', roughness: 1 }).out()

for (const side of [-1, 1]) {
  plane({ width: 90, height: 5.6 }).rotation(0, (side * Math.PI) / 2, 0).position(side * 3.5, 0.6, -32)
    .material({ color: '#3a3630', roughness: 0.9 }).out()
}

// Doorframes receding into the haze — recessed, so the lamps rake across them
box({ width: 0.25, height: 2.6, depth: 1.1 })
  .instance(28, (x, i, n, t) => {
    const side = i % 2 ? 1 : -1
    x.position(side * 3.3, -0.9, (((Math.floor(i / 2) * 5 + t * 3.5) % 70) - 66))
  })
  .material({ color: '#151319', roughness: 1 })
  .out()

camera(0, 0.3, 7, [0, 0.2, -14])

// depth({ focus, range }) measures distance from a focal plane instead, so the
// middle of the corridor stays sharp and both ends go soft.
scene()
  .mask(depth({ focus: T.mul(0.03).sin().range(6, 22), range: 12 }), s => s.blur(7))
  // other jobs the same map does, in place of the line above:
  // .mask(depth(), s => s.blur(10))                            // sharp near, soft far
  // .mask(depth(), s => s.comp(constant('#7d88a6'), 'over'))   // haze
  // .mask(depth().invert(), s => s.mul(0))                     // silhouette the far end
  .levels({ contrast: 1.08, saturation: 0.85 })
  .bloom({ threshold: 0.55, strength: 0.9, radius: 1.2 })
  .comp(noise({ freq: 260, speed: 40 }), 'overlay', 0.06)
  .out()

// depth({ near: 2, far: 12 }).out()   // swap for the chain above to see the map itself
