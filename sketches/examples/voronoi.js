// voronoi() — drifting points, every pixel colored by its nearest. freq, speed
// and seed decide where the points are, so calls that agree on those three
// line up exactly: cells, the distance field inside them, and the seams.

const field = { freq: 7, speed: 0.2, seed: 3 }

// blend is how far past its own cell a pixel listens. Driven by a radial ramp
// here: molten in the middle, hard-edged panes at the rim.
const glass = voronoi({
  ...field,
  blend: ramp({ type: 'radial', a: '#ffffff', b: '#000000' }).mul(0.3),
  a: '#141046',
  b: '#4fd1ff',
})

// Dark at each point, bright at the cell walls — shading for the flat cells
const depthInCell = voronoi({ ...field, mode: 'distance' })

// Black except where two points are equally close: the seams
const seams = voronoi({ ...field, mode: 'edges', a: '#000000', b: '#ffd9a0' })

glass
  .mul(depthInCell.mul(0.9).add(0.45))
  .comp(seams, 'add', 0.85)
  .hue(t => t * 0.02)
  .bloom({ threshold: 0.55, strength: 0.9 })
  .out()
