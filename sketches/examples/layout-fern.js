// Ferns unfurling. The coil is one small turn repeated down thirty segments, so
// animating that single number opens the whole frond. frond(phase) returns a
// rule, which is how each one gets its own timing.

bg('#060906')
ambient({ intensity: 0.3 })
directional({ color: '#e8ffd8', intensity: 2.2 }).position(4, 7, 3).out()
point({ color: '#3fd18c', intensity: 35 }).position(0, 3, 4).out()

// per segment, radians: 0.06 is an open arc, 0.56 a tight coil
const curl = (phase) => (t) => 0.06 + 0.5 * (0.5 + 0.5 * Math.sin(t * 0.4 + phase)) ** 2

const leaflet = (e) => {
  e.span(1, 'leaf')
  if (e.size > 0.045) e.branch((x) => x.turn(0.15).scale(0.72))
}

const frond = (phase) => (e) => {
  e.span(1, 'stem')
  if (e.size < 0.14) { e.place('leaf'); return }
  e.branch((x) => x.turn(1.25).scale(0.42), leaflet)
  e.branch((x) => x.turn(-1.25).scale(0.42), leaflet)
  e.branch((x) => x.turn(curl(phase)).scale(0.94))   // the spine carries on
}

const fern = layout(45, (e) => {
  for (let i = 0; i < 6; i++) {
    e.branch((x) => x.turn(0, 0, i * 1.047).turn(0, 0.55).scale(0.55), frond(i * 1.9))
  }
})

const stem = fern.filter('stem')
const leaf = fern.filter('leaf')

box({ width: 0.09, height: 1, depth: 0.09 })
  .instance(stem)
  .rotation(0, (t) => t * 0.08, 0)
  .material({ color: '#3d5a2e', roughness: 0.8 })
  .out()

box({ width: 0.16, height: 1.05, depth: 0.02 })
  .instance(leaf, (x, i) => x.color(hsl(0.3, 0.55, 0.3 + leaf.depth(i) * 0.008)))
  .rotation(0, (t) => t * 0.08, 0)
  .material({ roughness: 0.55 })
  .out()

camera(0, 4.5, 10, [0, 2.2, 0])

scene().bloom({ threshold: 0.65, strength: 0.5 }).out()
