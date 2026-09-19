// glsl — the pass you write yourself, for the op that isn't in the toolkit.
// tex0 is the picture, vUv the pixel, uTime the clock, and the second argument
// names uniforms: numbers, vectors, colors, fns of t, or a chain, which arrives
// as a sampler2D of that name. Commented-out lines are extras: swap one in.

bg('#05060c')
ambient({ intensity: 0.3 })
directional({ intensity: 1.7 }).position(4, 6, 3).out()

torusKnot({ radius: 1.15, tube: 0.3, res: 220, p: 3, q: 4 })
  .rotation(T.mul(0.3), T.mul(0.18), 0)
  .material({ color: '#eef2ff', roughness: 0.18, metalness: 0.75 })
  .out()

// the field the pass reads through, handed over as a uniform
const flow = noise({ period: 0.5, speed: 0.15, channels: 2 })

// Three lookups, one per channel, each at its own distance along the field:
// glass that splits the light. A built-in pass gets one sample of the frame,
// so this is the kind of thing the escape hatch is for.
scene()
  .glsl(`
    vec2 d = (texture2D(field, vUv).rg - 0.5) * amount;
    vec3 c = vec3(
      texture2D(tex0, vUv + d * 1.6).r,
      texture2D(tex0, vUv + d).g,
      texture2D(tex0, vUv + d * 0.5).b
    );
    gl_FragColor = vec4(c + tint * pow(length(d) * 12.0, 2.0), 1.0);
  `, {
    field: flow,
    amount: T.mul(0.11).sin().range(0.04, 0.1),
    tint: '#12203f',
  })
  .bloom({ threshold: 0.55 })
  .out()

// A bare expression is a whole body, which is the form a one-liner wants:
// scene().glsl('texture2D(tex0, vUv).bgra').out()

// And a Shadertoy mainImage() runs too, iTime and iResolution mapped:
// glsl(`
// void mainImage(out vec4 O, in vec2 F) {
//   vec2 p = (F - 0.5 * iResolution.xy) / iResolution.y;
//   float a = length(p - vec2(cos(iTime * 0.9), sin(iTime * 1.3)) * 0.22) - 0.15;
//   float b = length(p + vec2(cos(iTime * 1.1), sin(iTime * 0.7)) * 0.26) - 0.11;
//   float h = clamp(0.5 + 0.5 * (b - a) / 0.12, 0.0, 1.0);
//   float d = mix(b, a, h) - 0.12 * h * (1.0 - h);   // smooth union: the blobs merge
//   O = vec4(vec3(0.31, 0.82, 0.77) * smoothstep(0.01, -0.02, d)
//            + 0.5 * exp(-26.0 * abs(d)), 1.0);
// }
// `).out()
