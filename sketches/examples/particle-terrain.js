// A plane's .noise() carries through to its particles, so births land on the
// creased terrain rather than the flat sheet — the plane itself is never
// drawn. Dots have to be dense enough to overlap, or their shadows land on
// nothing and no shading shows.

bg('#05060a')
fog('#05060a', 10, 30)

// A low sun, grazing. Keep `far` tight so dot-scale depth gaps survive the
// shadow compare.
directional({ color: '#ffc9a0', intensity: 3, shadow: { soft: 2, area: 8, far: 40 } })
  .position(8, 1.6, 2)
  .out()
ambient({ color: '#30364d', intensity: 0.25 }).out()

plane({ width: 10, height: 10 })
  .rotation(-Math.PI / 2, 0, 0)
  .position(0, -1.5, 0)
  .noise({ amp: 1.1, period: 2.5, speed: 0.1, octaves: 4 })
  .particles({ rate: 150000, life: [1, 2], speed: 0.02 })
  .size([0.03, 0.06])
  .color('#d8d2c8')
  .blend('solid')
  .lit()
  .shadow()
  .out()
