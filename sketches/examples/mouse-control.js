// mouse-control — the pointer as a signal, and .range() as the way to aim one
// move the mouse over the picture; hold a button down

// mouse() is -1..1 with 0 at the center, which is already what .pos() wants.
// .smooth() on the way in takes the stutter out of a hand-held move.
const mx = mouse('x').smooth(0.08)
const my = mouse('y').smooth(0.08)
const held = mouse('down').smooth(0.12)   // a 1/0 gate, ramped

bg('#06060c')
ambient({ intensity: 0.25 })
directional({ intensity: 1.3 }).pos(3, 5, 2).out()
// the light chases the cursor, a little further out than the shape does
point({ color: '#ff9f6e', intensity: 45 }).pos(mx.mul(7), my.mul(5), 3).out()

sphere({ radius: 1.1, res: 96 })
  .pos(mx.mul(4), my.mul(2.4), 0)
  // .range() reads its input as 0..1 — the span every shaper, rand() and
  // audio() produce — so `held` maps to a roughness sweep without arithmetic
  .noise({ amp: held.range(0.05, 0.6), freq: 2, octaves: 4, speed: 0.5 })
  .material({ color: '#4fd1c5', roughness: held.range(0.6, 0.1), metalness: 0.4 })
  .out()

plane({ width: 40, height: 40, res: 2 })
  .pos(0, -3, 0)
  .rotate(-Math.PI / 2, 0, 0)
  .material({ color: '#12141f', roughness: 0.95 })
  .out()

// .tint() recolors by brightness: black -> bg, white -> color. The answer to
// "edge() handed me a white image and I want it magenta".
scene()
  .comp(s => s.edge({ strength: 2.5 }).tint('#ff4fd8'), 'add')
  .bloom({ threshold: 0.5, strength: 0.9 })
  .out()

// more to try:
// mouse() is the one signal that isn't 0..1, so ranging it says so:
//   .rotate(0, mouse('x').range(0, Math.PI * 2, { from: [-1, 1] }), 0)
// bare sig() is t as a signal — the seconds-based beat():
//   .scale(sig().sin().range(0.6, 1.4))
// mouse('down').counter() steps a value per click:
//   .color(mouse('down').counter().select(['#4fd1c5', '#ff5f9e', '#ffd166']))
