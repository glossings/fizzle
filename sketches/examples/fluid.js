// .fluid() turns a chain into dye in an incompressible sim. .push() drives the
// field, .obstacle() puts something solid in its way. The flow parts around the
// disc because the solver works out the pressure, not because anything is
// masking the picture afterwards.

const flow = circle({
    center: [0.05, t => 0.5 + Math.sin(t * 0.8) * 0.3],
    radius: 0.028,
    soft: 0.02,
    color: '#4fd1ff',
    bg: null,
  })
  .fluid({ res: 320, fade: 0.12, vorticity: 0.7, ink: 6 })
  .obstacle(circle({ radius: 0.11, center: [0.42, 0.5] }))
  .push([0.25, 0])                                               // steady drift right
  .push(noise({ period: 0.4, channels: 2, speed: 0.3 }), 0.25)   // and some churn

flow
  .comp(circle({ radius: 0.11, center: [0.42, 0.5], color: '#1a1a2e', bg: null }), 'over')
  .bloom({ threshold: 0.35, strength: 1.1 })
  .out()
