// A layout drawn flat: .instance() on a texture chain stamps the picture so
// far once per copy.

bg('#03060f')

const spread = (t) => Math.PI / 3 + Math.sin(t * 0.3) * 0.1

const arm = (e) => {
  e.span(0.26, 'ice')
  if (e.size < 0.05) { e.place('tip'); return }
  e.branch((x) => x.turn(spread).scale(0.45), arm)
  e.branch((x) => x.turn((t) => -spread(t)).scale(0.45), arm)
  e.branch((x) => x.scale(0.78))
}

const flake = layout(40, (e) => {
  // a fn of t in the step turns everything grown past it, so the flake wheels
  for (let i = 0; i < 6; i++) {
    e.branch((x) => x.turn((t) => (i / 6) * Math.PI * 2 + t * 0.06).scale(0.42), arm)
  }
})

const ice = flake.filter('ice')
const tip = flake.filter('tip')

// the stamp has to fade out inside its own frame, or every copy carries a hard
// rectangular edge
const blob = circle({ radius: 0.4, soft: 0.08, color: '#ffffff', bg: null })

blob
  // .span() turned each copy along its branch, so a squashed blob is a needle
  .instance(ice, (x, i) => x
    .scale(ice.size(i) * 0.1, ice.size(i) * 0.27)
    .color(hsl(0.57, 0.68, 0.55 + ice.depth(i) * 0.025))
    .alpha(0.85))
  .comp(blob.instance(tip, (x, i) => x
    .scale(tip.size(i) * 0.39)
    .color(hsl(0.52, 0.28, 0.82))
    .alpha(0.45)), 'add', 0.7)
  .bloom({ threshold: 0.55, strength: 0.8 })
  .out()
