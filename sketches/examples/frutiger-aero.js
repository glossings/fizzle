// frutiger aero — transmission glass, clearcoat gloss and iridescent film over
// a bright aqua sky. bubbles, blobs, unearned optimism.
//
// naming transmission/clearcoat/iridescence on .material() switches the mesh to
// three's physical material; everything else stays on the cheaper standard one.

bg('#6fd3ec')
ambient({ intensity: 0.5, color: '#d6f2ff' })
hemi({ sky: '#bfefff', ground: '#3fae7a', intensity: 1.1 }).out()
directional({ intensity: 2.2 }).pos(5, 8, 4).out()
point({ color: '#7fffd4', intensity: 90 }).pos(-6, -2, 4).out()
point({ color: '#ffd8f0', intensity: 70 }).pos(6, 3, -3).out()

// Glass reflects and refracts its surroundings, so it lives or dies on what's
// around it — with only the flat bg to bend, this is the dim version. Run an
// empty hdri() to browse Poly Haven, pick any bright sky, and the orb below
// suddenly has something worth looking at:
// hdri()

// hero orb: thick dispersive glass under a drifting iridescent film
icosa({ radius: 1.5, detail: 24 })
  .noise({ amp: 0.06, freq: 1.4, octaves: 3, speed: 0.25 })
  .rotate(0, t => t * 0.12, 0)
  .material({
    roughness: 0.03,
    transmission: 1,
    thickness: 1.8,          // refract through a volume, not a shell
    ior: 1.45,
    dispersion: 0.4,         // rainbow fringing at the edges
    iridescence: 1,
    iridescenceThickness: t => 320 + Math.sin(t * 0.4) * 200,
    attenuationColor: '#8ff0e0',
    attenuationDistance: 3,  // what the glass tints light on its way through
    clearcoat: 1,
    clearcoatRoughness: 0.05,
  })
  .out()

// bubbles: no thickness, so they refract as thin shells — cheaper, and soapier
sphere({ radius: 0.5, res: 40 })
  .instance(28, (x, i, n, t) => {
    const a = (i / n) * Math.PI * 2 + i * 1.7
    const r = 3.2 + (i % 5) * 0.9
    x.pos(
      Math.cos(a + t * 0.08) * r,
      ((i * 0.9 + t * 0.35) % 9) - 4.5,      // slow rise, wrapping
      Math.sin(a + t * 0.08) * r
    ).scale(0.35 + (i % 4) * 0.28)
  })
  .material({
    roughness: 0,
    transmission: 1,
    ior: 1.2,
    iridescence: 1,
    iridescenceThickness: 420,
    clearcoat: 1,
  })
  .out()

// lush blob below — clearcoat over green is the whole "wet leaf" trick
icosa({ radius: 2.4, detail: 16 })
  .pos(0, -4.3, 0)
  .noise({ amp: 0.45, freq: 1.1, octaves: 4, speed: 0.15 })
  .material({ color: '#37d67a', roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.1 })
  .out()

camera(0, 0.5, 8)

// bright, hazy, over-lit: white lift through the middle, aqua in the corners
scene()
  .comp(ramp({ type: 'radial', a: '#ffffff', b: '#2aa8d8' }), 'screen', 0.28)
  .levels({ contrast: 1.06, saturation: 1.2 })
  .bloom({ threshold: 0.62, strength: 1.3, radius: 1.4 })
  .out()

// more to try:
// .material({ transmission: 1, thickness: 2, ior: 2.4, dispersion: 1 })  // diamond
// .material({ color: '#c8d0d8', roughness: 0.15, metalness: 1, anisotropy: 1 })  // brushed chrome
// .material({ color: '#ff8ec7', roughness: 0.9, sheen: 1, sheenColor: '#fff0f8' })  // felt
// .material({ color: '#ffffff', opacity: t => 0.3 + 0.2 * Math.sin(t), depthWrite: false })
