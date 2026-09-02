// The camera rides the curve: one phase says where it is, the same phase a
// little ahead says what it looks at. The rings sit on the same path.

bg('#04030a')
fog({ color: '#04030a', near: 3, far: 20 })
ambient({ intensity: 0.1 })

// a circle nine across, with a rise and fall on top of it
const road = curve((u) => {
  const a = u * Math.PI * 2
  return [Math.cos(a) * 9, Math.sin(a * 2) * 2.5, Math.sin(a) * 9]
}, { closed: true })

const at = T.mul(0.03)
const eye = road(at)
const ahead = road(at.add(0.02))

torus({ radius: 1.5, tube: 0.07, res: 20 })
  .instance(120, (x, i, n) => {
    const u = i / n
    x.position(road(u))
      .rotation(Math.PI / 2, 0, 0)     // a torus lies flat; tip it into a gate
      .align(road.tangent(u))
      .color(hsl(u))                   // one trip round the color wheel per lap
  })
  .material({ roughness: 0.35 })
  .out()

point({ color: '#ffd9f0', intensity: 16 }).position(ahead).out()

camera(...eye, ahead)

scene().bloom({ threshold: 0.45, strength: 0.8 }).out()
