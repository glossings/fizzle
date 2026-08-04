// no geometry at all — texture generators only

ramp({ type: 'angular', a: '#ff5f9e', b: '#1b1040' })
  .displace(noise({ period: 0.4, octaves: 4, speed: 0.4, channels: 2 }), 0.3)
  .kaleido(8, { rotate: t => t * 0.1 })
  .comp(circle({ radius: t => 0.18 + Math.sin(t) * 0.04, soft: 0.2, color: '#4fd1ff', bg: '#000000' }), 'add', 0.6)
  .bloom({ threshold: 0.5, strength: 1.3 })
  .out()
