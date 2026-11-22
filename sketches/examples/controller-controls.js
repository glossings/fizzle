// controller controls — the controls in the code, moved by a MIDI controller or a gamepad.
// Press ctrl+l, click a control, then turn a knob or push a stick: the binding
// is written into the call. Learn stays on for the next control; esc ends it.

tempo(120)

bg('#07070d')
ambient({ intensity: 0.3 })
directional({ intensity: 1.4 }).position(3, 5, 2).out()

const where = xy(0.5, 0.5, { pad: 'left' })
const size = knob(1, 0.5, 2, { cc: 74, pickup: true })
const wobble = slider(0.2, 0, 0.8, { pad: 'rt' }).record(2)

torusKnot({ radius: 0.8, tube: 0.25, res: 128 })
  .position(where.range(-3, 3), 0)
  .scale(size)
  .noise({ amp: wobble, period: 0.6, speed: 0.4 })
  .rotation(0, T.mul(0.5), 0)
  .color(toggle(0, { note: 36 }).select(['#4fd1c5', '#ffd166']))
  .out()
