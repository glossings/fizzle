// The frame repeating forever, with every repeat handed to a callback — so
// what slides into shot need not match what slid out. The word and the ink step
// on with the repeat index; the ground drifts the other way with a hue step of
// its own.
//
// i is a signal rather than a number, since the index a pass is holding changes
// as repeats slide through it. So i.mul(0.11), never i * 0.11. It carries
// i.phase too — how far this repeat has crossed — which is what fades each
// word up as it arrives and back down as it leaves.
resolution(1280, 720)

const WORDS = ['ENDLESS', 'BELT', 'NEVER', 'THE', 'SAME', 'TWICE']
const INK = ['#ff5f6d', '#ffc371', '#4fd1c5', '#a06cd5', '#63e2b7']

// treating the source: one chain, hue-stepped per repeat
const ground = noise({ freq: 7, speed: 0.05, a: '#070a16', b: '#22407a' })
  .scroll(0.05, (s, i) => s.hue(i.mul(0.11)))

// building a new one: the callback may return any chain, so each repeat can
// draw its own picture and the belt never runs out of words
const belt = constant(null)
  .scroll(-0.24, (s, i) => text(i.select(WORDS), { size: 0.34, color: i.select(INK), bg: null })
    .alpha(i.phase.tri()))

ground
  .comp(belt, 'over')
  .bloom({ threshold: 0.55, strength: 0.7 })
  .out()
