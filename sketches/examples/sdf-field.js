// .sdf() — for every pixel, where the nearest edge of a mask is. A blur only
// approximates this, and melts the shape it was measuring in the process; the
// jump flood behind .sdf() keeps the outline exact at any range.
//
// 'distance' is the signed distance as gray, 0.5 at the edge and darker
// inside. Bands cut out of it are contour rings, so a shape becomes a
// topographic map of itself.

const shape = text('fizzle', { size: 0.22, weight: 700 })

const dist = shape.sdf({ mode: 'distance', spread: 0.3 })

// fract() turns the smooth ramp into repeating bands; the threshold keeps the
// thin part of each one, which is a contour line at a fixed spacing.
dist
  .glsl('vec4(vec3(fract(texture2D(tex0, vUv).r * 14.0)), 1.0)')
  .threshold(0.75)
  .tint('#4fd1c5', { bg: '#06121a' })
  .comp(shape.tint('#ffffff'), 'add')
  .out()

// 'direction' is the other encoding: a unit vector to that edge, 0.5-neutral,
// which is exactly what .displace() reads. That is what .attract() is built
// from — see the attract example.
//
// shape.sdf({ mode: 'direction' }).out()   // the field itself, as color
