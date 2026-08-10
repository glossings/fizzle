// A dense dust ball under one hard side light: dots shadow each other, so the
// cloud gets a lit hemisphere and a dark core.

bg('#06070c')

directional({ color: '#ffe2c4', intensity: 3.2, shadow: { soft: 1, area: 4, far: 40 } })
  .position(6, 2.5, 1)
  .out()
ambient({ color: '#333344', intensity: 0.2 }).out()

// Floor to catch the cast shadow
plane({ width: 16, height: 16 })
  .rotation(-Math.PI / 2, 0, 0)
  .position(0, -2, 0)
  .material({ color: '#454a55', roughness: 0.95 })
  .out()

// Dust drifting out of a small sphere. 'solid' writes depth, so the lit
// surface of the cloud reads — 'add' or 'over' would wash the shading out.
sphere({ radius: 0.6 })
  .particles({ rate: 120000, life: [1.5, 3], speed: [0.05, 0.35], spread: 1 })
  .turbulence({ amp: 0.25, period: 1.5, speed: 0.2 })
  .drag(0.8)
  .color('#e6e2da')
  .size([0.02, 0.05])
  .blend('solid')
  .lit()
  .shadow()
  .out()
