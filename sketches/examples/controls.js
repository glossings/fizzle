// controls — sliders, knobs and a pad drawn in the code.
// Run it, then drag them. Hold the bottom slider and move it to record a loop,
// or move any of them and press ctrl+k to keep what you just did.

tempo(120)

bg('#07070d')
ambient({ intensity: 0.3 })
directional({ intensity: 1.4 }).position(3, 5, 2).out()
point({ color: '#ff9f6e', intensity: 40 }).position(xy(0.7, 0.7).range(-6, 6), 3).out()

const spin = knob(0.3, 0, 2)
const wobble = slider(0.25, 0, 0.8)

icosa({ radius: 1.2, res: 96 })
  .noise({ amp: wobble, period: 0.6, speed: 0.4 })
  .rotation(0, T.mul(spin), 0)
  .scale(slider(1, 0.6, 1.6).record(2))
  .material({ roughness: 0.35, metalness: 0.3 })
  .color(button().select(['#4fd1c5', '#ff5f9e']))   // pink while the button is held
  .out()
