// Departures board: a texture drives an instanced grid, and every tile picks its
// own letter out of a set of maps. A wave rolls out from the center and each
// tile it crosses turns over to its blank dark back, the way a station board
// clears itself. Two grids share every cell, one facing away, so a half turn
// swaps which face the camera sees.
resolution(1280, 720)
bg('#08080a')
camera(0, 0, 8.5)

ambient({ intensity: 0.5 })
directional({ intensity: 1.6 }).position(2, 4, 6).out()

// the wave, read back as numbers a layout fn can sample. freq is well under
// one cycle across the board, so a single front sweeps out rather than a set
// of rings, and the slow phase leaves the board readable between passes.
const wave = ramp({ type: 'radial', freq: 0.12, shape: 'sin', phase: (t) => -t * 0.07 })
  .threshold(0.5, { soft: 0.15 })
  .field()

const COLS = 16, ROWS = 7, PITCH = 0.62

// one card per character, in this order — so a character's place in the string
// is the number .tile() wants
const GLYPHS = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const cards = GLYPHS.split('').map((c) => text(c, { size: 0.7, color: '#14110d', bg: '#e8e4dc' }))

const lines = [
  '   DEPARTURES',
  '',
  'BERLIN     1405',
  'LISBON     1420',
  'TOKYO      1512',
  'OSLO       1530',
]

// what this cell reads: lines run top down, row 0 is the bottom row, and
// anything the set hasn't got a card for comes out blank
const glyph = (col, row) => Math.max(0, GLYPHS.indexOf((lines[ROWS - 1 - row] ?? '')[col] ?? ' '))

// turn: which way this grid starts facing, so the pair shows one face at a time
const board = (turn, lettered) => (x, i) => {
  const col = i % COLS, row = (i / COLS) | 0
  const flip = wave(col / (COLS - 1), row / (ROWS - 1))
  x.position((col - (COLS - 1) / 2) * PITCH, (row - (ROWS - 1) / 2) * PITCH, 0)
    .rotation(flip * Math.PI + turn, 0, 0)
  if (lettered) x.tile(glyph(col, row))
}

const card = () => plane({ width: 0.55, height: 0.55, res: 1 })

// the lettered face: a set of maps, one card per copy
card().material({ map: cards, roughness: 0.8, doubleSide: false })
  .instance(COLS * ROWS, board(0, true)).out()

// the back: every copy the same, so no set — one-sided, so it only shows once
// its grid has turned around
card().material({ color: '#14110d', roughness: 0.8, doubleSide: false })
  .instance(COLS * ROWS, board(Math.PI)).out()
