// An image as a particle emitter: .particles() on a texture chain births on
// its bright pixels, each dot keeping the color it was born from.

bg('#05060c')

// size is a fraction of height, so we scale if necessary to fit
const em = Math.min(0.3, 0.24 * (innerWidth / innerHeight))
const s = em / 0.3 // scales amplitudes relative to size

const amt = T.mul(0.2).sin().pow(2);
text('fizzle', { size: em, bg: null })
  .particles({ rate: 10000, life: [1, 2.5], speed: 0.25 * s, threshold: 0.3 })
  .turbulence({ amp: amt.mul(s), period: 1.4 * s, speed: 0.4 })
  .color("#0fffef", "#de18ec")
  .force(0, amt.mul(0.4 * s), 0)
  .size(0.02 * s, 0.004 * s)
  .blend("add")
  .out()

scene()
  .saturation(4)
  .bloom({ threshold: 0.3, strength: 0.9 })
  .out()
