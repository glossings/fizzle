// pinned-bands: the bands this sketch reads are its own, declared in the
// bands({ ... }) call at the bottom rather than taken from the audio manager —
// so it arrives anywhere tuned the way it was built. Press ctrl+a while it
// plays and the manager is on these bands; every drag in there is written back
// into that call. Play some music at your machine.

bg('#05050a')
ambient({ intensity: 0.22 })
point({ color: '#8fb8ff', intensity: 55 }).position(4, 4, 3).out()
point({ color: '#ff7f9e', intensity: 45 }).position(-4, 1, 2).out()

const kick = band('kick')
const hats = band('hats')

// low end swells the body, the top end roughens its surface
icosa({ radius: 1.1, res: 10 })
  .noise({ amp: hats.range(0.04, 0.4), period: 0.35, octaves: 4, speed: 0.7 })
  .scale(kick.range(0.85, 1.6))
  .rotation(0, T.mul(0.25), 0)
  .material({ color: '#4fd1c5', roughness: 0.3, metalness: 0.45 })
  .out()

// and the whole mix opens the bloom
scene()
  .bloom({ threshold: 0.45, strength: band().range(0.3, 1.5) })
  .out()

bands({
  level: { auto: true },
  kick: { from: 30, to: 160, sm: 0.05, auto: true },
  hats: { from: 6000, to: 12000, sm: 0.08, auto: true },
})
