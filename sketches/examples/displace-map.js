// .displace(map) — vertices moved along their normals by a texture's brightness
// at their own uv, with the normals rebuilt from the map's gradient so the
// relief actually catches the light.
//
// The map is a live texture chain, so the geometry animates because the picture
// does. The same chain goes into .material({ map }) as color, which is what
// makes the ridges and the light on them agree.
//
// Every vertex is a pin: it reads the average of the map over its own share of
// the picture (a mip level matched to the mesh, so the average is real at any
// width), which is why a map far busier than the mesh comes out as relief and
// not as grit. `smooth` is how wide it reads — down for crackle, up for dough.

bg('#05060c')
fog({ color: '#05060c', near: 8, far: 40 })
camera(0, 3.4, 9.5)

ambient({ intensity: 0.2 })
directional({ color: '#ffd9a8', intensity: 2.6 }).position(6, 7, 4).out()
point({ color: '#4fd1c5', intensity: 60 }).position(-4, 1.6, 3).out()

// cracked cells drifting under a slow twist — one height field, two shapes.
// No .blur() to tame it: the footprint is the filter, and blurring first would
// only throw away detail the vertices were going to average anyway.
const relief = voronoi({ period: 0.22, speed: 0.15, mode: 'edges' })
  .warp({ twist: t => Math.sin(t * 0.2) * 0.6 })

// res is where the detail comes from, not the map — a default plane has
// nothing like enough vertices to show this. mid: 0 pushes one way only, so
// the ridges stand up off a flat floor instead of straddling it.
plane({ width: 40, height: 40, res: 260 })
  .rotation(-Math.PI / 2, 0, 0)
  .position(0, -2.2, 0)
  .displace(relief, { amount: 1.6, mid: 0 })
  .material({ map: relief, roughness: 0.8 })
  .out()

// Three deformers, one sum: the fbm shapes the form, the cells cut into it,
// and a fine noise read narrow (smooth: 0.5) puts a rough skin on top of both.
sphere({ radius: 1.6, res: 220 })
  .position(0, 0.6, 0)
  .rotation(0, t => t * 0.15, 0)
  .noise({ amp: 0.22, period: 1.4, octaves: 3, speed: 0.25 })
  .displace(relief, { amount: 0.35 })
  .displace(noise({ period: 0.06, speed: 0.4 }), { amount: 0.04, smooth: 0.5 })
  .material({ color: '#8f9bd6', roughness: 0.35, metalness: 0.4 })
  .out()

scene()
  .bloom({ threshold: 0.6, strength: 0.6 })
  .contrast(1.05)
  .out()
