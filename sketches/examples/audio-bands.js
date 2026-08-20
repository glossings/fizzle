// audio-bands: named bands from the audio manager (ctrl+a). Open it, play
// some music, and drag band 1's meter anchors until the bar sweeps its full
// width — the sketch then sees a clean 0..1 whatever the track's loudness.

bg('#06060b')
ambient({ intensity: 0.25 })
point({ color: '#88bbff', intensity: 60 }).position(4, 4, 3).out()
point({ color: '#ff7f9e', intensity: 40 }).position(-4, 1, 2).out()

const level = band().smooth(0.05, 0.25)   // global meter, anchored 0..1
const bass = band(1).smooth(0.03, 0.2)    // band 1 defaults to 30-160 Hz
const kick = band(1).kicks()

torusKnot({ radius: 0.8, tube: 0.25 })
  .noise({ amp: bass.mul(0.5).add(0.05), period: 0.5, octaves: 3, speed: 0.5 })
  .scale(level.range(0.9, 1.5))
  .rotation(0, t => t * 0.4, 0)
  .material({ color: '#a78bfa', roughness: 0.3, metalness: 0.5 })
  .out()

scene()
  .bloom({ threshold: 0.5, strength: kick.mul(1.1).add(0.5) })
  .out()
