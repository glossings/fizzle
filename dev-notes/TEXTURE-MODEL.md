# What a texture actually is

Written down because the obvious mental model — a texture is a function of
`(x, y, t)` — is wrong in ways that matter, and everyone arrives with it.
Nothing here is a proposal; it's a description of what
[src/textures.js](../src/textures.js) already does.

## A chain is a graph of passes, not a function and not an image

`scene().kaleido(6).blur(4)` builds three small JS objects. Each one
([`TextureOp`](../src/textures.js#L1248)) records which shader spec to run
([`SPECS`](../src/textures.js#L106)), the params it was handed, and which nodes
feed it. That's all that happens at `ctrl+enter`: no pixels, no GPU work.

Every frame, [`renderTextures`](../src/textures.js#L1866) walks the graph
backwards from whatever reached `.out()`, and each node
([`_render`](../src/textures.js#L1515)) renders its inputs, binds them as
`tex0`/`tex1`, and draws **one full-screen quad** into a buffer of its own
([`_rt`](../src/textures.js#L1491)). Results are memoized per frame
([`renderNode`](../src/textures.js#L1502)), so a node feeding two consumers
still renders once.

The consequences worth internalising:

- **One pass per op.** A twenty-op chain is twenty full-frame draws, each
  writing a complete RGBA-half-float image. Nothing fuses:
  `.translate(0.1, 0).translate(0.1, 0)` is two passes and two buffers, not one
  combined offset. Ops are cheap individually and the count is what costs.
- **Cost is per frame, not per interesting pixel.** A `.blur()` under a mask
  still shades every pixel; the mask picks which result survives. `.tile()` is
  the exception that proves it — it renders a pass per *distinct* cell variant,
  which is why it bothers to dedupe them.
- **Intermediates aren't clamped.** Targets are half-float
  ([`makeRT`](../src/textures.js#L939)), so values leave the 0..1 range between
  passes and come back. `.add(-0.5).mul(2)` carrying negatives is load-bearing,
  not incidental — it's how a signed map gets built.

## Alpha is premultiplied, end to end

Buffers are RGBA and the RGB is stored premultiplied — "the image over
nothing." That one convention is why alpha costs almost nothing: an opaque
chain is bit-identical to the pre-alpha pipeline, resampling passes (blur,
transform, delay) are correct on transparency without special cases, and the
display pass is unchanged, since premultiplied RGB over the opaque canvas *is*
the image on black. Generators premultiply at the uniform
([`setColor4`](../src/textures.js#L64)); `bg: null` is how a shape gets drawn
on nothing; filters preserve coverage; `.comp(x, 'over')` is true source-over,
and the other modes take the layer's alpha as a per-pixel gate. Multiple naked
`.out()`s stack in code order through the same over pass. The two straight-alpha
imports — `text()`'s canvas and `imagefile()` PNGs — premultiply on upload.

## The two levels, and why `t` is on the surprising one

This is the part the `(x, y, t)` model gets wrong.

**`t` is CPU-side and per-frame.** Every `t => ...` in the API — every param of
every op — is a plain JS function called *once per frame* by that node's
`update()`, and the result is written into a uniform
([`resolve`](../src/textures.js#L21)). It never sees a pixel. `noise({ speed: t
=> Math.sin(t) })` has the same speed everywhere on screen for the duration of
that frame.

**Per-pixel variation is GPU-side and can't be written in JS.** It comes from
either the shader body (which knows `vUv`) or from handing a *texture* into a
param slot ([texture-driven params](../src/textures.js#L832)), which compiles
the uniform's name into a `#define` that fetches from a bound sampler instead.
`circle({ radius: noise() })` varies across the frame precisely because the
value arrives as an image rather than a closure.

So the honest shape is closer to `t => image`, where the `image` half is
assembled out of prebuilt shader passes. There is no user-facing `(x, y) => ...`
anywhere in the language, and there can't be one without a compiler: a JS
closure has no way to run per fragment. That's the wall a JS-flavoured
`expr((r, g, b) => [...])` hits, and why the escape hatch on the TODO is
`.glsl(source)` — a string — rather than a function.

Two smaller things the pure-function model also mispredicts:

- **Ops read their neighbors.** `.blur()`, `.edge()`, `.pixellate()`,
  `.chroma()` all sample *other* pixels of their input. The graph composes whole
  images, not per-pixel values, and a per-pixel function couldn't express any of
  them.
- **Time isn't an index.** There's no asking for the frame at `t - 0.5`. You get
  now, plus whatever was deliberately stored: `input()` (last frame's display
  output), `input('name')` in a cycle, `.delay(n)` (a ring of n frames),
  `.feedback()` (a node's own last output). Those buffers are the only memory
  the pipeline has, and each one costs a frame of video held permanently.

## Why a node needs an engine

Because a node isn't a value — it's a claim on GPU resources belonging to a
particular renderer. The engine holds the renderer and the drawing-buffer size a
node sizes its target to, the 3D scene `scene()`/`depth()` read, the state that
must outlive a re-run (feedback and named-bus targets, delay rings), and the
registry of live nodes that makes disposal possible: a node adds itself to
`engine.textureNodes` in its constructor, and
[`clearPatch`](../src/engine.js#L618) walks that list to free GPU memory on the
next run.

Hence the constructor's first argument, and hence `new Texture()` being
unreachable from a sketch: the generators are closures `makeApi(engine)` built,
and the bare class has no engine to hand a `new` call. There's no ambient one to
fall back on either — `makeApi` runs twice, once for the canvas and once for the
docs page's live preview, both sharing this module.

## What survives a re-run

Worth stating alongside the above, because it's the one place the "recipe"
framing leaks: the *nodes* are rebuilt from scratch every `ctrl+enter`, but the
*buffers* aren't. Feedback targets and named buses live on the engine keyed by
name, and delay rings live in [carry.js](../src/carry.js) keyed by call order.
That's what lets a trail survive the edit that changed it — and it's why
`.feedback()` names its buffer after a carried key rather than a fresh id, since
a new name per run would blank the loop on every keystroke.

## scene() is not a no-op on an HDR frame

`scene().out()` is meant to show what a direct render would have: three only
tone-maps at the canvas, so the scene lands in its RT linear and
[`MAT_TONEMAP`](../src/textures.js#L1550) replicates the renderer's ACES +
sRGB at the boundary. On an LDR scene the two paths match. Push the lights
into HDR (an `intensity: 20` directional, say) and they visibly diverge, for
two reasons:

- **Antialiasing resolves on opposite sides of the tone map.** Direct: the
  canvas MSAA averages *display-space* values, so a half-covered pixel of a
  hot 1px line is `avg(1.0, 0.02)` — mid-grey. Through `scene()`: the HalfFloat
  RT resolves its 4× MSAA in *linear HDR* — `avg(20, 0.02)` is still far past
  white — and tone-maps after. Edge pixels stay blown out, so thin lit
  geometry (`.link({ lit })`, wires, dots) reads brighter and fatter, a free
  bloom-adjacent glow. This is the physically correct resolve (AA should
  average light, not encoded values); the direct path is the standard-but-
  wrong one.

- **Raw ShaderMaterials skip renderer tone mapping.** Particle sprites reach
  the canvas untouched on the direct path, but through `scene()` they sit in
  the HDR buffer and get ACES'd with everything else — slightly dimmer,
  slightly warmer.

So "adding any texture op changed the lighting" is expected under HDR, and
mostly for the better. Making the paths match would mean routing the no-chain
render through the same RT — an extra pass, and a look change to every
existing sketch — so the divergence is documented rather than fixed.
