# layout() — generative structure (L-systems without the DSL)

Design notes from an API discussion (2026-08-19), built the same day.
Shipped in [src/layout.js](../src/layout.js), wired into `.instance()` in
[api.js](../src/api.js), documented under "layout" in
[docs-content.md](../src/docs-content.md), example in
[layout-fern.js](../sketches/examples/layout-fern.js). (Tree and spiral
example sketches shipped first and were then cut in favor of the fern — the
docs section carries live tree and spiral snippets already, so standalone
files added nothing.)

What follows is the design discussion as it happened; **As built** at the
bottom records where the implementation moved.

## Where it landed

The ask was L-systems. The answer is a more general primitive they fall out of:
`layout(rule)` — user code steering a transform cursor and placing copies,
collected into an indexed set of oriented transforms that `.instance()` draws.

The reasoning chain, in case it's revisited:

1. An L-system is two separable ideas: string rewriting and turtle
   interpretation. The string (`'FF[+F][-F]'`) is 1968 notation for things JS
   has natively — `[`/`]` are push/pop of transform state, i.e. the call stack;
   a rewrite rule is a function calling itself. So no grammar API at all.
   Classic L-systems become a ten-line helper in a sketch, or a docs example.
2. First draft: explicit recursion with `e.scope(() => { ... branch(depth-1) })`.
3. Simplification (Aria's): the callback only describes the step —
   `e.branch(x => x.turn(0.55).scale(0.75))` — and the framework re-runs the
   same rule at the result, one generation deeper. Kills the depth threading,
   the termination check, and the manual recursion. The callback signature is
   exactly the `.instance()` layout-fn idiom.
4. Queryable state on `e` (also Aria's) then dissolves the depth argument:
   rules terminate themselves (`if (e.scale < 0.15) return`), so depth is only
   a safety cap with a generous default, next to a hard node budget.
5. `emit` renamed `place`, taking a label — the layout is a *plan*, geometry is
   assigned per label at instancing time via `tree.filter('leaf')` (named
   `only` at first; see **As built**).

Precedents: Processing's pushMatrix/popMatrix (same muscle memory), Structure
Synth / Context Free (same model, wrapped in DSLs because they predated
running user JS).

## The API

```js
const tree = layout(e => {
  e.place('wood')
  e.forward(1)
  if (e.scale < 0.15) { e.place(e.rand() > 0.5 ? 'leaf' : 'berry'); return }
  e.branch(x => x.turn(0.55).scale(0.7))
  e.branch(x => x.turn(-0.5).scale(0.8))   // asymmetry → lopsided crowns, free
})

box({ width: 0.1, height: 1, depth: 0.1 }).instance(tree.filter('wood')).out()
sphere({ radius: 0.12 }).instance(tree.filter('leaf')).out()
sphere({ radius: 0.05 }).instance(tree.filter('berry')).out()
```

One structure, several meshes, each still a single instanced draw.

Cursor verbs: `forward(dist)`, `turn(angle, pitch?, roll?)`, `scale(f)` —
chainable, every argument may be a fn of t. Loops work without any recursion
(spirals, rings, scatters); `branch()` is what recurses.

Builder-side reads on `e` — keep it to four, each with a distinct idiom:

- `e.depth` — generation ("place iff depth > 10", parity tricks)
- `e.scale` — accumulated shrink; the natural stop condition (adaptive depth:
  the branch that shrank fastest stops first)
- `e.distance` — path length from root; gradients along growth
- `e.position` — `[x, y, z]`; spatial pruning (`if (e.position[1] < 0) return`
  = nothing grows underground). Environmentally-sensitive L-systems were a
  research extension; here it's an `if`.

Skipped deliberately: "overall angle" (not a scalar in 3D — `e.heading` as a
unit vector if a need ever shows), label query semantics (no wildcard/set
strings — superseded by the predicate form of `.filter()`, see **As built**).

`place(label?, data?)`: label picked out by `.filter()`, data rides along per
copy. Unlabeled = the default group; unfiltered `tree` is everything.
`only(label)` returns a **full sub-layout** (own count, apply, emit-order
indices), so grow-in and per-copy color work on the slice.

Consumption: `.instance(layoutOrSub)` is the direct form; the explicit
`(count, fn)` form stays for post-processing via `sub.apply(x, i)`.

## Semantics that must hold

- **`branch()` queues; children run after the parent rule body finishes.** The
  parent's cursor never moves — that's what the old bracket bought, now true
  without caveats. `branch(step, rule?)`: second arg = different rule for the
  child (mutual recursion); a closure there is the escape hatch for threading
  custom values down a branch.
- **Op-tape replay for animation.** The builder runs once to capture structure;
  cursor-op arguments that are fns of t re-evaluate per frame inside placement.
  Structure fixed, pose live — `turn(t => a + Math.sin(t) * 0.05)` sways every
  branch downstream, compounding down the hierarchy. No fn-of-t anywhere →
  replay once and cache. ~50k ops/frame is fine.
- **`e.rand(seed)` is per-node, not per-call** — same node, same value, every
  frame and every re-run. This is what makes stochastic structure hold still
  instead of rerolling. Different seeds independent. (Matches the
  `rand(freq, seed)` house convention.)
- **Budgets, never throws.** Depth cap (default, generous) + hard place/op
  budget, `warn()` and truncate — the sample.js MAX precedent. A truncated
  tree still renders (errors-never-block-playback), and truncation is also how
  you debug a runaway rule.
- **Order is age.** Place order gives `age(i)` free — clamp visible instances
  for grow-in animation. Scope nesting gives depth per copy for coloring.

## Later / out of scope for v1

- `tube({ radius, taper })` — connected mesh along the path. Forces
  rebuild-on-animate, so hold until the layout concept settles.
- Particles emitting from a layout (`particles({ from: tree })`).
- Sibling generators once the layout currency exists: grid, phyllotaxis,
  attractors — anything producing indexed transforms plugs into the same
  socket.
- Temporal use: pure `rewrite()` (symbol expansion) driving `select()` /
  `imageseq()` for generative sequencing. Separate tiny function if ever;
  don't couple it to the turtle.

Examples to ship with it: swaying tree, spiral, recursive city block — the
example is the documentation.

## As built

Four things the implementation settled that the design above left open or got wrong.

**`e.scale` the read had to become `e.size`.** It collided head-on with
`.scale(f)` the verb — one name can't be both a getter and a method. The verb
kept its name (it matches GeoOp/InstanceHandle), and the read is `e.size`:
`if (e.size < 0.3) return`. Cursor scale is a single number, which is what makes
that read meaningful; `.scale(x, y, z)` warns and points at sizing the shape
instead.

**Node expansion is a FIFO queue, so place order is generation order.** This was
listed as a semantic to preserve; it turned out to also be the simplest
implementation (a flat array with a head index, no recursion, no stack depth
limit) *and* the better one. Depth-first would make `.grow()` finish one limb
before starting the next; breadth-first opens the whole structure outward at
once, which is both what a plant does and what parallel L-system rewriting
means. Replay relies on it too: children always have a higher index than their
parent, so one linear pass over the node list fills every child's base
transform before that child is walked.

**`.size(i)` joined the metadata family.** Writing the spiral example exposed
the gap: `.scale()` on an instance handle *replaces*, so any chain adding its
own scale silently threw away the structure's taper. `.size(i)` (grow included)
is what you multiply back in. It rounds out the set of things the structure
knows about copy i: `.depth` `.age` `.data` `.size`.

**`only()` became `filter(label | fn)`.** `only` was the one name in the API
that's an adverb rather than a verb or noun; `select`/`pick` were rejected for
colliding with fizzle's existing single-choice meanings. `filter` won *because*
it promises a predicate: the design refused wildcard label strings (a
mini-language), but a JS function is the opposite of a mini-language — it's the
layout thesis applied to slicing. Both forms shipped together so the contract
was settled before push: a string keeps a label's copies (cached per label on
the root), a function keeps copies it says yes to, handed `{ label, data,
depth }` and the copy's index. Filters compose; label views of views are built
on the spot rather than cached.

**`.span(dist, label?, data?)` had to be added.** The design had `.place()`
(a copy here) and `.forward()` (move), and assumed a segment was the two in
sequence. It isn't: `.place()` centers the copy on the cursor, so a segment
straddles its joint instead of running from it, and at a fork both children
straddle the same joint and cross each other. Aria caught it as "a bunch of Xs
up the length of the tree". `.span()` is the turtle's `F`: center the copy on
the step, then take the step. It needs no new op kind or replay case, being
`forward(d/2).place().forward(d/2)`, and it closes every joint to zero gap.
`.place()` stays for tips and scatters, where centering on the point is right.

**`.instance(layout, fn)` is the general consumption form.** Cleaner than the
`(sub.count, (x, i) => sub.apply(x, i))` spelling the note assumed: the layout
brings its own count, and the fn runs after placement for the tint or wobble on
top. `.apply()` stayed public for chains that want the call explicit.

Budgets as shipped: 50 000 copies, 20 000 nodes, 12 generations by default.

## Drafted tooltips

As lifted into docs.js (`e.scale` → `e.size` aside, these shipped close to
verbatim):

- `layout(depth?, rule)` — A set of placed copies, built by steering a cursor:
  the rule moves it (.forward .turn .scale), .place() records a copy,
  .branch() grows a child that runs the rule again. `.instance()` draws it:
  `box().instance(l)`. Any step can be a fn of t, and the whole structure
  moves.
- `.place(label?, data?)` — Record a copy where the cursor stands, at its
  heading and scale. The label names what goes there, picked out later by
  .only(); data rides along per copy. Copies number off in place order, so an
  index clamp grows the structure in.
- `.branch(step, rule?)` — Grow a child: step shapes it
  (`x => x.turn(0.55).scale(0.75)`), then the rule runs again from there, one
  generation deeper. The parent's cursor stays put. A second argument hands
  the child a different rule.
- `.only(label)` — (shipped as `.filter(label | fn)`, see **As built**) The
  layout narrowed to one label's copies, a full layout of its own: copies
  keep their own count and order, so growth and per-copy color work on the
  slice.
- `.forward(dist = 1)` — Step the cursor along its heading. The step scales
  with the cursor, so a shrunken branch takes shorter steps.
- `.turn(angle, pitch?, roll?)` — Rotate the cursor's heading, in radians: one
  angle turns it flat, pitch and roll steer it in 3D. A fn of t here sways
  everything grown past this point.
- `.rand(seed = 0)` — A random 0..1 that holds still: each node draws the same
  value every frame and every re-run, so a stochastic structure doesn't reroll
  while you watch. Different seeds are independent draws.

---

## The 2D bridge — `.instance()` on a texture chain (2026-08-19, same day)

A layout had exactly one consumer, `GeoOp.instance()`. This is the second:
`TextureOp.instance(count | layout, fn?, { blend })`, shipped in
[textures.js](../src/textures.js), documented under "the same structure, flat",
example in [layout-2d.js](../sketches/examples/layout-2d.js).

### Why a bridge at all, given feedback already does 2D fractals

Video feedback (a frame comped with scaled/rotated copies of itself) *is* an
IFS run by the screen, and it covers a surprising amount of the 2D fractal
space for free. A Sierpinski gasket falls out of a seed plus three half-scale
copies of `input()`, and a fractal tree out of a trunk plus two shrunk turned
ones; both were written first to test exactly that claim. What it can't do:

- Only contractive maps, and only their *attractor*. A Hilbert curve or a
  dragon is a path, not an attractor; feedback can't draw either.
- Resolution-bound and emergent over frames, so nothing is addressable: no
  labels, no `data`, no per-copy color, no exact count.

So feedback and layout overlap in look, not in kind. The bridge stays.

### Naming: `instance`, not `stamp`

Candidates were `stamp`, `copy`, `at`, and reusing `instance`. `instance` won
because the operation genuinely *is* the same one — copies of one source placed
by a layout, in a single draw — and one verb across both chains means a layout
reads the same wherever it lands. `box().instance(tree)` and
`circle().instance(tree)` differ only in what a copy is made of.

The cost is that `CALLBACK_KIND` in docs.js keys callback kinds by method name
alone, so both handles have to share the `inst` kind for completion. That
forced the honest fix rather than a fudge: the 2D handle's `.alpha()` was added
to the `inst` list, and `InstanceHandle.alpha()` on the geometry side became a
guard pointing at `.material({ opacity })` — which is the pattern its
`.noise()`/`.displace()`/`.shadow()` siblings already use.

### Decisions the implementation forced

**Units: 1 = the frame's height, y up, origin centered.** A copy at scale 1
covers the frame exactly. That identity is what lets a layout's own coordinates
arrive unscaled, and it matches the house convention elsewhere in textures.js
(y unscaled, x aspect-corrected — see circle's shader). The quad is therefore
`aspect × 1` and the matrix is T·R·S in that order, so a rotated copy turns
rigidly instead of shearing.

**There is no camera, and `{ zoom }` was a mistake.** The frame is one unit tall
and copies outside it are clipped, so a structure has to be built at a size that
fits. A `{ zoom }` option shipped first, scaling the ortho camera's extent. It
was cut the same day: zooming out by k is a similarity transform of the drawing,
which is to say it is exactly what scaling the structure already does, one step
later and in a second place. Aria's call, and correct — a framing helper, if one
is ever wanted, belongs on Layout where the coordinates live, not on the
consumer that draws them.

The argument that kept it alive too long was that shrinking a rule trips its own
`e.size` stop sooner and builds a simpler structure (measured: the flake goes
from 2742 copies over 10 generations to 192 over 5). True, but it is a property
of one idiom, not of layouts — a depth-based stop has no such coupling, and
`.forward()`/`.span()` distances carry the positions while leaving `e.size`
alone, so shrinking those is already a pure scale. Both examples were resized
that way when zoom came out, structure untouched.

**Blending is fixed-function, not a shader pass.** Every copy lands in one
draw, so what a copy meets is the destination buffer, which no shader can read.
That admits exactly `add`/`over`/`screen`/`lighten`; anything else warns and
points at `.comp()`. Default is `add`, because the generators default to an
opaque black background — under `over` the copies would hide each other behind
black rectangles. Alpha blends as source-over regardless of what the color is
doing, so an additive stack still ends on a composable coverage.

**The stamp is read through a mip pyramid.** Copies are small by nature; without
mips a copy at 1/64 scale samples one pixel in fifty and sparkles. `.instance()`
sets `_needsMips` on its source, the same lever `.displace()` pulls.

**Fill rate is the one thing a sketch can get wrong.** A quad is always the
whole frame, so N copies at scale s cost N·s²·aspect frames of fill. The
guidance that falls out — draw the stamp to fill its frame, then scale the
copies down — is also just the 2D reading of how a shape's own dimensions size
a 3D copy, so it costs nothing to teach.

**A serial in `params`.** `sigOf()` dedupes `.tile()` variants by stringifying
params, and neither the count nor the fn survives that — two different
structures in two cells would have merged into one. Each node gets an `id`.

### Not done

- Per-copy shader effects. Same line the geometry side already drew with "one
  material for the whole batch"; keeping both `.instance()`s identical in what
  they refuse is part of what makes sharing the name honest.
- A square stamp. Copies inherit the frame's aspect, so a copy is never square
  and grid-aligned tiling can't be expressed. `.tile()` is what tiles; this
  only bit when a Sierpinski *carpet* was briefly considered for the docs
  example (a gasket of dots doesn't care, since a circle stays a circle).
- Reading a copy's placed position back inside the fn. `l.apply()` sets it and
  the handle has no getter, so recentering a structure has to happen in the
  rule or through `zoom`. Worth adding if a sketch ever wants it — it's the one
  gap `zoom` doesn't cover.
