// tempo: the two ways the clock reaches a sketch. beat() is the gate — a pulse
// on the grid, for anything that triggers. B is the moving value — bars
// elapsed, T on the tempo grid instead of in seconds. Set the bpm in the
// sidebar, or with tempo() as below.

tempo(120)

bg('#08080e')
ambient({ intensity: 0.3 })
directional({ intensity: 1.6 }).position(3, 5, 4).out()

// B moves, so it shapes. .mul() sets the rate the way it does on T:
// B.mul(4) is quarter notes, B.mul(2) half a bar, bare B one cycle per bar.
const pump = B.mul(4).saw().mul(-1).add(1)   // snaps up on the beat, falls off

icosa({ radius: 1 })
  .noise({ amp: pump.mul(0.3).add(0.05), period: 0.6, speed: 0.4 })
  .scale(pump.range(0.9, 1.15))
  .rotation(0, B.mul(0.5), 0)
  .material({ color: B.select(['#ff5f9e', '#4fd1c5', '#ffd166']), roughness: 0.35 })
  .out()

// beat() pulses, so it triggers. Trigger slots fire on the rising edge and
// ignore the width; .when() is the one that sees it, holding the branch open
// for as long as the gate stays up.
scene()
  .when(beat(4, 0.08), s => s.invert())
  .bloom({ threshold: 0.6, strength: 0.7 })
  .out()
