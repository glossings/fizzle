// tracking spaces the letters, leading spaces the lines — both in ems of size.
// tracking adds to the normal gap, so negative values overlap the letters

ambient({ intensity: 0.35 })
directional({ intensity: 1.8 }).position(2, 4, 6).out()

text('fizzle\nfizzle\nfizzle', {
  size: 0.16,
  color: '#2a2f55',
  bg: '#07080f',
  tracking: T.mul(0.12).sin().range(-0.5, 0.6),
  leading: T.mul(0.12).sin().range(0.3, 2),
}).out()

text3d('ready\nsteady\ngo', { size: 0.6, depth: 0.15, align: 'center', tracking: 0.35, leading: 1.15 })
  .rotation(0, T.mul(0.1).sin().range(-0.3, 0.3), 0)
  .color('#7ee787')
  .out()
