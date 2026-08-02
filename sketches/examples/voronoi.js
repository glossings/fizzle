// voronoi() — points scattered one per cell, drifting, every pixel answering to
// its nearest. scale/speed/seed decide where the points are, so three calls
// that agree on those three see the same scatter and line up exactly: the flat
// cells, the distance field inside each one, and the seams between them.

const field = { scale: 7, speed: 0.2, seed: 3 }

// blend is how far past its own cell a pixel listens. A texture in it means
// that distance varies across the frame: molten in the middle where the radial
// ramp is white, hard-edged panes out at the rim.
const glass = voronoi({
  ...field,
  blend: ramp({ type: 'radial', a: '#ffffff', b: '#000000' }).mul(0.3),
  a: '#141046',
  b: '#4fd1ff',
})

// dark at each point, bright out at the walls — the shading that gives a flat
// cell a middle
const depthInCell = voronoi({ ...field, mode: 'distance' })

// black except where the two nearest points are equally close: the leading
const seams = voronoi({ ...field, mode: 'edges', a: '#000000', b: '#ffd9a0' })

glass
  .mul(depthInCell.mul(0.9).add(0.45))
  .comp(seams, 'add', 0.85)
  .hue(t => t * 0.02)
  .bloom({ threshold: 0.55, strength: 0.9 })
  .out()
