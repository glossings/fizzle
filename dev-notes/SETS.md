# Sets: the fourth family

A design sketch, nothing here built yet.

## The thesis

The API has three families a user learns once each: **textures** (pictures,
chained), **geometries** (shapes, chained), **signals** (numbers over time,
chained). Everything added since that feels like sprawl — `layout()`, `data()`,
`particles().read()`, `track()` — is mostly not four new things. It is one
family nobody named: **sets** — indexed records, refreshed per frame, with a
count, per-record readings, and the same consumers. A layout is a built set, a
tracker is a tracked set, `.read()` is a simulated set, `data()` is an adopted
one. Name the family and unify its contract, and a new producer stops costing
new vocabulary: the family is what gets learned, and each producer is one more
way of making the thing the user already knows how to hold.

There is deliberately no table type beyond this. Free-form records — label
maps, lookup tables, rows from a file — are what the host language's arrays
and objects already are, and `data()` is the adapter that lifts the
point-shaped ones into this family.

## The contract

What every set answers, whoever produced it:

```
s.count                  how many records right now
s.pos, s.size, …         a channel: this frame's array, one entry per record
s.at(i)                  one record as an object of live getters — at(i).pos
s.read()                 the set as channels, explicitly — the Data view
```

Channels are whatever the producer knows — `pos`, `size`, `age`, `id`,
`label`, anything. The contract binds the *shape* (count, channels, `at(i)`)
and the meaning of exactly two keys, because machinery reads them: `pos`
(where a record is) and `alpha` (whether and how much it is there). Everything
else is producer vocabulary — `depth` on a layout, `id` on a tracker, `life`
on particles — documented per producer, with no cross-producer promise, the
same way op params belong to their op. A set delivers records the same way
everywhere; what is in them is between the producer and the sketch that chose
it.

Nothing requires `pos`, position included: it is one key among the rest. What
requires it is the *spatial consumers* below, each of which should say so when
handed a set without one. A future set with no geometry at all (held notes,
detected beats) is a legitimate set; it simply has nothing to offer
`.instance()`.

And what a set feeds:

```
shape.instance(s, fn)    a copy per record, hidden where absent   (needs pos)
pic.each(s, fn)          a mark per record, comped on             (needs nothing — the fn decides)
link(s) / s.link()       lines between records                    (needs pos)
s.pairs()                who is near whom                         (needs pos)
curve(s)                 the records as a path, where order means travel (needs pos)
```

Today's scorecard, p = partial:

|                 | layout | track | data() | .scatter | .read() |
| --------------- | ------ | ----- | ------ | -------- | ------- |
| .count          | ✓      | ✓     | ✓      | ✓        | ✓       |
| channel view    | –      | p¹    | ✓      | ✓        | ✓       |
| indexed view    | ✓      | ✓     | –      | –        | –       |
| .instance(s)    | ✓      | ✓     | –      | –        | –       |
| link / pairs    | –      | ✓     | ✓      | ✓        | ✓       |
| curve(s)        | ✓      | –     | –      | –        | –       |

¹ internal only (what `.pairs()` reads); not exposed as `.pos`.

The two conventions that currently disagree, and a proposed ruling:

- **Channels are arrays, readings are calls.** `s.pos` is this frame's array
  (what sketch math and link() want); `s.pos(i)` etc. are per-record calls
  (what an instance fn wants, and what can answer a resting value for an empty
  slot). Both exist on every set; the docs teach them as one idea: "a set has
  channels, and readings per record."
- **`.instance(set)` takes any of them.** A set without pose data (bare
  `data()` points) places position only; layout adds rotation/scale; track adds
  size and hiding. The producer decides what `apply` sets — already true.

## What it would take

Small, mostly additive:

- A shared base (today's `Data`) grows `at(i)` — one reused object of live
  getters per index, which dissolves the `pos` getter-vs-method clash: bare
  names are channels, records live under the index.
- Layout and the tracker extend the base and implement its fill hook ("write
  my records into the arrays"). The base's sync is pull-based and memoized per
  frame: the hook runs only on frames where a channel verb (`pos`, `pairs()`,
  `link()`) is actually read, so a tracker that is only ever `.each()`'d never
  fills anything — and when it does fill, that gathering is the input those
  verbs need in any implementation, not overhead. The price of extension is
  only the hook's coupling to the base's internals, which is ordinary subclass
  hygiene.
- `.instance()` accepts `Data` (place by `pos[i]`), not just layout/track.
- `.read()` on layout and track, returning the Data view (mirrors particles).
- `curve(track)`? Probably not — blob order is by size, not by path. Leave
  curve to sets whose order means travel.
- Naming hygiene while in there, not a requirement: layout's `age(i)` is place
  order, 0..1 — not time — and the word misleads even someone who knows
  exactly what they hold ("the tooltip needs two bodies for one word" is the
  tell). `.along(i)` says what it is. Producer vocabulary is free to differ in
  meaning; it is not free to lie.
- Docs: one **sets** section that every producer's section points back to.

## What to call it

The class name sits beside `Texture`, `Geometry`, `Signal` — users see it in
docs and in `instanceof` checks, rarely type it. Candidates:

- **Data** — the incumbent; honest and plain; already in scope. Weakness:
  sounds like the adapter (`data()`) rather than the family.
- **Cast** — the members of the show; matches the stage/dancers voice the
  docs already use; short, concrete. "layout builds a cast, track() finds one
  in the picture."
- **Crowd** — same register, more anonymous members, less structure.
- **Series** — the data-table lineage (indexed records); pairs well with
  Signal; connotes one-dimensional order it doesn't always have.
- **Marks** — the visualization term (a chart's marks); precise to "things
  placed and styled per record," but obscure outside dataviz.

Leaning: keep `Data` if the family should feel infrastructural; `Cast` if it
should feel like fizzle.

## Curve and Signal, while we're at it

A curve is not a set — it's the other function-of-one-number, and the mirror of
a signal across two axes: a signal maps **time → a number**, a curve maps
**phase → a point**. The domains differ in kind (seconds, unbounded, stateful
things like `.smooth()` make sense there; 0..1, normalized, geometric things
like `.tangent()` make sense here), so merging the classes would force one
side's verbs onto the other where they mean nothing.

The unification that's real and already works is composition: a signal can
drive a curve's phase (`c(T.mul(0.2))`), and a curve component can become a
signal (`sig(t => c(t * 0.2)[1])`). Worth doing: document the two side by side
as "the function-of-one-variable types," one diagram, same breath — and keep
their *conventions* mirrored (both take fns in every slot, both compose with
spread/phases) so learning one teaches the shape of the other. Worth skipping:
`.smooth()` on curves, `.tangent()` on signals.
