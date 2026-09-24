// A labeled block is a sketch inside the sketch: everything it sends out comes
// back as one texture, sketch('name'), and its bg(), camera(), fog(), hdri()
// and lights are its own. The knot below is lit, framed and backed without
// touching anything outside its braces.
// Commented-out lines are extras: uncomment one to try it.

bg('#05060a')

knot: {
  bg('#2a0a3a')
  camera(T.mul(0.3).sin().mul(3), 1, 5)
  ambient({ intensity: 0.3 })
  point({ color: '#77ddff', intensity: 60 }).position(3, 4, 2).out()
  point({ color: '#ff9955', intensity: 40 }).position(-4, -2, 3).out()

  torusKnot({ radius: 1, tube: 0.3, res: 128 })
    .rotation(T.mul(0.4), T.mul(0.3), 0)
    .material({ color: '#ff7f50', roughness: 0.3, metalness: 0.5 })
    .out()
}

const SET = ['knot', 'voronoi', 'curve-tunnel']

// Cycle between the block above and two sketches from the examples folder, one
// per bar. The ops hang off the select, so they grade all three.
select(SET.map((name) => sketch(name)), B)
  .hue(T.mul(0.05))
  .bloom({ threshold: 0.45, strength: 0.9 })
  .out()

// No bg() in this one, so it comes back transparent and rides over the set.
caption: {
  text(B.select(SET), { size: 0.035, pos: [0.5, 0.07], bg: null, tracking: 0.25 }).out()
}

sketch('caption').out()

// select(SET.map((name) => sketch(name)), B).kaleido(6).out()                        // a harder hand on the whole set
// sketch('knot').comp(sketch('voronoi'), 'over', T.mul(0.5).sin()).out()             // a cross-fade is two of them and a fade
