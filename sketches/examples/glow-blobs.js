// td-livecode — ctrl+enter run · ctrl+. pause · ctrl+h hide code · ctrl+b sidebar
// every numeric param also takes a function of time: t => ...
// click any color swatch (or type #) for a color picker

bg('#07070c')
fog('#07070c', 8, 40)
ambient(0.15)
directional({ intensity: 1.4 }).pos(4, 6, 3).out()
point({ color: '#ff5f9e', intensity: 60 }).pos(t => Math.sin(t) * 6, 3, -4).out()
point({ color: '#4fd1ff', intensity: 40 }).pos(-5, -2, 5).out()

// center blob: sphere -> noise displacement -> lit render
sphere({ radius: 1.4, res: 128 })
  .noise({ amp: t => 0.35 + 0.2 * Math.sin(t * 0.7), freq: 1.8, octaves: 4, speed: 0.4 })
  .rotate(0, t => t * 0.15, 0)
  .material({ color: '#b48cff', roughness: 0.25, metalness: 0.4 })
  .out()

// orbiting shards: box -> scale -> noise -> instanced
box({ width: 0.5, height: 0.5, depth: 0.5, res: 12 })
  .scale(1, 2.2, 1)
  .noise({ amp: 0.15, freq: 3, octaves: 3, speed: 0.8 })
  .instance(80, (i, n, t) => {
    const a = (i / n) * Math.PI * 2 + t * 0.1
    const r = 4 + Math.sin(i * 7.3) * 1.2
    return {
      pos: [Math.cos(a) * r, Math.sin(a * 3 + t * 0.5) * 1.5, Math.sin(a) * r],
      rot: [t * 0.5 + i, a, 0],
      scale: 0.4 + 0.3 * Math.sin(i + t * 2),
    }
  })
  .material({ color: '#4fd1c5', roughness: 0.4, metalness: 0.6 })
  .out()

// ground: plane -> noise terrain
plane({ width: 60, height: 60, res: 160 })
  .pos(0, -3.5, 0)
  .rotate(-Math.PI / 2, 0, 0)
  .noise({ amp: 1.2, freq: 0.12, octaves: 5, speed: 0.05 })
  .material({ color: '#1a2036', roughness: 0.9, flatShading: true })
  .out()

// TOPs: post-process the rendered scene as a texture
scene()
  .bloom({ threshold: 0.55, strength: 1.1, radius: 1.2 })
  .out()

// more to try — replace the chain above:
// scene().kaleido(6).comp(feedback().transform({ scale: 1.01, rotate: 0.003 }), 'over', 0.88).bloom().out()
// scene().pixellate(140).posterize(5).out()
// scene().edge({ strength: 3 }).comp(scene(), 'add', 0.9).out()
// scene().displace(noise({ freq: 3, speed: 0.5 }), 0.08).bloom().out()
// camera(t => Math.sin(t * 0.2) * 9, 3, t => Math.cos(t * 0.2) * 9)
