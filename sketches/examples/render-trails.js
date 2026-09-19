// .render() — one object as a texture chain, alone on a transparent layer.
// Here the sphere feeds a trail loop while the box and the backdrop stay sharp.
// Commented-out lines are extras: swap one in to try it.

bg('#101828')
ambient({ intensity: 0.3 })
directional({ intensity: 1.5 }).position(4, 6, 3).out()

box({ radius: 0.2, res: 48 })
  .position(2, 0, -1)
  .rotation(T.mul(0.3), T.mul(0.4), 0)
  .material({ color: '#66ccff', roughness: 0.3 })
  .out()

const path = curve.circle(1.4, { axis: 'z', center: [-0.8, 0, 0] })

sphere({ radius: 0.7, res: 48 })
  .position(path(T.mul(0.3)))
  .material({ color: '#ff5f9e', roughness: 0.35 })
  .render()
  .feedback(0.93, x => x.scale(1.02), 'under')
  // .feedback(0.95, x => x.transform({ scale: 1.03, rotate: 0.02 }).hue(0.02), 'under')   // a spiral that drifts through the wheel
  .out()
