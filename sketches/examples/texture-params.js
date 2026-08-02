// texture-driven parameters — hand a texture where a number goes and the parameter
// stops being one value for the whole frame: every pixel reads its own out of
// the map, sampled at the same spot. The sample *is* the value, in whatever
// units the number would have been, so .mul()/.add() on the map sets the range.

bg('#04050a')
ambient({ intensity: 0.25 })
point({ color: '#7fd7ff', intensity: 45 }).pos(3, 3, 4).out()
point({ color: '#ff5f9e', intensity: 30 }).pos(-4, -1, -2).out()

torusKnot({ radius: 1.1, tube: 0.3, res: 128 })
  .rotate(t => t * 0.3, t => t * 0.2, 0)
  .material({ color: '#e8e8f0', roughness: 0.25, metalness: 0.6 })
  .out()

// a radial ramp read as a cell count: 324 in the middle falling to 24 at the
// rim, so the image is sharp where you're looking and coarse everywhere else
const detail = ramp({ type: 'radial', a: '#ffffff', b: '#000000' }).mul(300).add(24)

// one slow field, reused for four unrelated slots — each reads it in its own units
const field = noise({ freq: 1.2, octaves: 2, speed: 0.15 })

// circle() takes one too, and it is the odd case: a generator whose shape a
// texture decides. Radius per pixel means the rim wanders — a blob, not a disc.
// Here it ends up as a gain map: 0.35 outside, 1.1 in the middle.
const vignette = circle({ radius: field.mul(0.15).add(0.35), soft: 0.25 }).mul(0.75).add(0.35)

scene()
  // { map, amount, mid } scales and biases what the map says. This is exactly
  // .displace(map, 0.03): a translate biased so mid-gray means no movement,
  // without which an unsigned map would only ever push +x/+y.
  .transform({ translate: { map: noise({ channels: 2, freq: 3, speed: 0.4 }), amount: 0.03, mid: 0.5 } })
  .pixellate(detail)
  .hue(field.mul(0.4))                                  // 0..0.4 turns, by region
  .posterize(field.mul(6).add(2))                       // 2..8 levels, by region
  .warp({ barrel: 0.2, zoom: field.mul(0.3).add(0.9) }) // 0.9..1.2 — rippling glass
  // .mul() is both ends of this at once: the way you set a map's range, and
  // itself a slot taking one — read as RGB, so a colored map tints per channel
  .mul(vignette)
  .bloom({ threshold: 0.5, strength: 1.0 })
  .out()
