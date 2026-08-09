// An image as a particle emitter: .particles() on a texture chain births on
// its bright pixels, and each particle keeps the color of the pixel it was
// born from. The image stays live — swap the text for person() and the camera
// silhouette dissolves into a swarm wearing your colors.

bg('#05060c')

// a word smoldering: born on the letters (threshold keeps the background
// dark and silent), drifting up through gentle turbulence
text('fizzle', { size: 0.32, color: '#ffb347', bg: null })
  .particles({ rate: 30000, life: [1, 2.5], speed: 0.25, threshold: 0.3 })
  .turbulence({ amp: 0.5, period: 1.4, speed: 0.4 })
  .force(0, 0.4, 0)
  .size(0.02, 0.004)
  .blend('add')
  .out()

scene()
  .bloom({ threshold: 0.3, strength: 0.9 })
  .out()
