// depth haze — depth() is the same render as scene(), read out of the depth
// buffer instead of the color: black up close, white far away, empty space
// white. Its range is in world units and defaults to whatever fog() is set to,
// so the two agree without being told twice.
//
// That makes it a mask, and .mask(m, fn) applies fn where the mask is bright —
// so masking a blur by depth is depth of field, and masking a flat color by
// depth is atmospheric haze. Both are one line.

bg('#06060b')
fog('#06060b', 5, 34)          // depth() picks this range up automatically

ambient(0.1, '#8fa2c8')

// three ceiling lamps sliding toward the camera on a loop, so the corridor
// never ends. Same z fn drives the lights and the fixtures.
const lampZ = (i) => (t) => (((t * 3.5 + i * 12) % 36) - 32)

for (let i = 0; i < 3; i++) {
  point({ color: '#ffe0a8', intensity: 55, distance: 18 }).pos(0, 3.1, lampZ(i)).out()
}

box({ width: 1.8, height: 0.12, depth: 0.5 })
  .instance(3, (x, i, n, t) => x.pos(0, 3.25, lampZ(i)(t)))
  .material({ color: '#fff4de', emissive: '#ffdca0', emissiveIntensity: 4 })
  .out()

// the corridor: floor, ceiling, two walls
plane({ width: 7, height: 90 }).rotate(-Math.PI / 2, 0, 0).pos(0, -2.2, -32)
  .material({ color: '#2a2622', roughness: 0.95 }).out()
plane({ width: 7, height: 90 }).rotate(Math.PI / 2, 0, 0).pos(0, 3.4, -32)
  .material({ color: '#191921', roughness: 1 }).out()

for (const side of [-1, 1]) {
  plane({ width: 90, height: 5.6 }).rotate(0, (side * Math.PI) / 2, 0).pos(side * 3.5, 0.6, -32)
    .material({ color: '#3a3630', roughness: 0.9 }).out()
}

// doorframes receding into the haze — recessed, so the lamps rake across them
box({ width: 0.25, height: 2.6, depth: 1.1 })
  .instance(28, (x, i, n, t) => {
    const side = i % 2 ? 1 : -1
    x.pos(side * 3.3, -0.9, (((Math.floor(i / 2) * 5 + t * 3.5) % 70) - 66))
  })
  .material({ color: '#151319', roughness: 1 })
  .out()

camera(0, 0.3, 7, [0, 0.2, -14])

// The look. depth({ focus, range }) measures distance from a focal plane
// instead — 0 at focus, 1 by focus ± range — so the middle of the corridor
// stays sharp and both ends go soft.
scene()
  .mask(depth({ focus: t => 14 + Math.sin(t * 0.2) * 8, range: 12 }), s => s.blur(7))
  .levels({ contrast: 1.08, saturation: 0.85 })
  .bloom({ threshold: 0.55, strength: 0.9, radius: 1.2 })
  .comp(noise({ freq: 260, speed: 40 }), 'overlay', 0.06)
  .out()

// more to try:
// .mask(depth(), s => s.blur(10))                         // sharp near, soft far
// .mask(depth(), s => s.comp(ramp({ a: '#7d88a6', b: '#7d88a6' }), 'over'))  // haze
// .mask(depth().invert(), s => s.mul(0))                  // silhouette the far end
// depth({ near: 2, far: 12 }).out()                       // just look at the map
