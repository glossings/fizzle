// alpha out of footage: person() is a live mask of wherever the camera sees
// somebody, so masking the video with it lifts you off the room — no green
// screen. The naked .out()s stack in code order, later over earlier.

// an animated backdrop to land on, vignetted at the edges
noise({ period: 0.6, speed: 0.12, octaves: 4, a: '#03102a', b: '#155a8a' })
  .comp(ramp({ type: 'radial', a: null, b: '#02060f' }), 'over')
  .out()

// the cutout: the camera masked by its own person mask, softened a touch
video()
  .mask(person().blur(3))
  .out()

// the noise field's bright specks, luma-keyed into a snow overlay — the dark
// rest goes transparent while the survivors keep their color
noise({ freq: 7, speed: 0.6 })
  .lumaKey(0.87, { soft: 0.06 })
  .alpha(0.6)
  .out()

// with a real green screen the key is one filter:
// video().chromaKey('#00ff00').out()
