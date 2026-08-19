# layout() — generative structure (L-systems without the DSL)

Design notes from an API discussion (2026-08-19). Not started; this records the
agreed shape so it doesn't get lost.

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
   assigned per label at instancing time via `tree.only('leaf')`.

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

box({ width: 0.1, height: 1, depth: 0.1 }).instance(tree.only('wood')).out()
sphere({ radius: 0.12 }).instance(tree.only('leaf')).out()
sphere({ radius: 0.05 }).instance(tree.only('berry')).out()
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
unit vector if a need ever shows), label query semantics on `only()` (plain
string lookup only, no wildcards/sets).

`place(label?, data?)`: label picked out by `.only()`, data rides along per
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

## Drafted tooltips

Ready to lift into docs.js when implementation starts (signature, then body):

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
- `.only(label)` — The layout narrowed to one label's copies, a full layout of
  its own: `box().instance(tree.only('wood'))` draws just the wood. Copies
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
