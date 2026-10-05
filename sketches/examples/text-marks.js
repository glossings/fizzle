// A line of code with the part that's sounding marked, the way a projector
// feed reads: the marks move, the string sits still, and .marked() hands back
// how much of it is lit as a signal — so the glow follows the playing without
// anyone writing a mapping. Same call a live feed fills in (see live-feed.js).
resolution(1280, 720)

const line = 'kick: bd*4   hat: hh*8   bass: saw*2   pad: warm'
// [start, end) character offsets into that string, end exclusive — one atom each
const atoms = [[0, 10], [13, 22], [25, 36], [39, 47]]

// the kick holds, and one of the other three takes over on every eighth
const lit = (t) => [atoms[0], atoms[1 + (Math.floor(t * 2) % 3)]]

const code = text(line, {
  // fit sizes the type to fill the box, so the line reads at any width
  fit: [0.85, 0.22],
  ranges: lit,
  color: '#e8e4dc',
  bg: null,
  mark: { mode: ['fill', 'underline'], color: '#ffd84f', pad: 0.14 },
})

constant('#0b0b10')
  .comp(ramp({ type: 'radial', a: '#1a1030', b: '#0b0b10' }), 'screen')
  .comp(code, 'over')
  .bloom({ threshold: code.marked().range(0.9, 0.3), strength: 1.2 })
  .out()
