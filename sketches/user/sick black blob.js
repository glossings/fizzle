// audio-reactive: grabs the default mic on first run (pick another device in
// the sidebar). audio() returns a signal — fns of t — so they go anywhere
// a fn of t goes. Play some music at your machine.

bg('#ffffff')
ambient(0.25)
point({ color: '#88bbff', intensity: 60 }).pos(4, 4, 3).out()
point({ color: '#ff7f9e', intensity: 40 }).pos(-4, 1, 2).out()

const level = audio().smooth(0.05, 0.25)             // envelope-followed mix
const bass = audio().lowpass(150).smooth(0.03, 0.2)  // low-end energy
const kick = audio().bandpass(30, 160).kicks()       // 1 on each kick, decays

icosa({ radius: 1.1, detail: 10 })
  .noise({ amp: bass.mul(1.4).add(0.08), freq: 2.5, octaves: 4, speed: 0 })
  .scale(level.mul(1.6).add(0.9))
  .rotate(0, t => t * 0.3, 0)
  .material({ color: '#225853', roughness: 0.35, metalness: 0.4 })
  .out()

scene()
  .comp(input().transform({ scale: kick.mul(0.05).add(1.002) }), 'add', 0.55)
  .when(audio().highpass(4000).gte(0.3).smooth(), s => s.kaleido())
  .bloom({ threshold: 0.5, strength: kick.mul(1.2).add(0.6) })
  .out()
