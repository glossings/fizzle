// The grainy living surface: a plane's .noise() carries through to its
// particles, so births land on the creased terrain rather than the flat
// sheet — the plane itself is never drawn. Near-zero speed and short lives
// keep the dots pinned while the field drifts under them; .lit() + .shadow()
// let a low sun rake the creases, every ridge shading the valley behind it.

bg('#05060a')
fog('#05060a', 14, 40)

// a low warm sun, casting; the small bias keeps near-coplanar dots from
// speckling each other with shadow acne
directional({ color: '#ffc9a0', intensity: 3, shadow: { soft: 2, bias: 0.0004, area: 14 } })
  .position(9, 2.2, 3)
  .out()
ambient({ color: '#30364d', intensity: 0.25 }).out()

plane({ width: 18, height: 18 })
  .rotation(-Math.PI / 2, 0, 0)
  .position(0, -1.5, 0)
  .noise({ amp: 0.9, period: 3.5, speed: 0.12, octaves: 4 })
  .particles({ rate: 100000, life: [1, 2.5], speed: 0.02 })
  .size([0.015, 0.045])
  .color('#d8d2c8')
  .fade(0.25, 0.35)
  .lit()
  .shadow()
  .out()
