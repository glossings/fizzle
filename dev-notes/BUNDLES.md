# Bundles: the fourth family

Built. `Bundle` in [src/link.js](../src/link.js) is the base; `layout()`,
`track()`, `data()`, `.scatter()` and `particles().read()` are its producers.

Vocabulary: one word everywhere — the class is `Bundle`, the thing is a
**bundle**, the docs chip says *bundle*. Nothing to translate between the prose
and `Bundle.prototype.foo`.

## The thesis

The API has families a user learns once each: **textures** (pictures, chained),
**geometries** (shapes, chained), **signals** (numbers over time, chained). The
things that looked like sprawl — `layout()`, `data()`, `particles().read()`,
`track()` — were never four more families. They are one: **bundles** — data over
a set of points, indexed, refreshed per frame, with a count, per-record readings
and the same consumers. A layout is a built bundle, a tracker a tracked one,
`.read()` a simulated one, `data()` an adopted one. With the family named and the contract
shared, a new producer costs no new vocabulary: the family is what gets learned,
and each producer is one more way of making the thing the user already holds.

There is deliberately no table type beyond this. Free-form records — label maps,
lookup tables, rows from a file — are what the host language's arrays and objects
already are, and `data()` is the adapter that lifts the point-shaped ones into
this family.

## The contract

What every bundle answers, whoever produced it:

```
b.count                  how many records right now
b.slots                  how many indices there are (count, unless slots sit empty)
b.at(i)                  one record as an object of live getters — at(i).pos
b.pos, b.size, …         the keys by name, in whichever spelling the producer has
```

The last line is the one that is not uniform, deliberately: a bare name is this
frame's array where the producer keeps arrays (`data()`, `.scatter()`,
`particles().read()`, a layout's `.pos`), and a reading per record where the
producer's state is per-record (`blobs.pos(i)`, `tree.size(i)`, where a call can
answer a resting value for a slot that is empty). `at(i)` is the one surface that
reads the same on all of them, which is why it carries the contract and the bare
names don't — and why a portable `Bundle.prototype` helper is written through it.

Two keys are the base's own, and every bundle has them: `pos` (where a record is)
and `alpha` (whether and how much it is there). They are not a convention a
producer opts into — the base owns the buffers and the getters, and a producer
fills them in `_fill`. That is deliberate: it is what lets `.instance(b)`,
`link(b)`, `.pairs()` and `curve(b)` take any bundle at all with no capability
check anywhere, and it is what gives an absent record one spelling everywhere
(`pos` resting at zero, `alpha` at 0).

The price is that a producer with nothing spatial to say cannot say so. It would
inherit `pos` and answer zeros, which is data-shaped nonsense rather than an
honest "no position here". No producer is in that spot today — all five are
spatial. The day one isn't (held notes, detected beats), the work is to let a
producer leave `pos` out of its channels and have the spatial consumers say so
when handed such a bundle; until then, enforcing it is the simpler and more honest
of the two.

Everything above those two keys is producer vocabulary — `size` and `depth` on a
layout, `id` on a tracker, `life` on particles — documented per producer, with no
cross-producer promise, the same way op params belong to their op. A bundle delivers
records the same way everywhere; what is in them beyond position and presence is
between the producer and the sketch that chose it.

What a bundle feeds:

```
shape.instance(s, fn)    a copy per record, hidden where absent   (reads pos)
pic.each(s, fn)          a mark per record, comped on             (reads nothing — the fn decides)
link(s) / s.link()       lines between records                    (reads pos)
s.pairs()                who is near whom                         (reads pos)
curve(s)                 the records as a path, where order means travel (reads pos)
```

Every cell of what used to be a scorecard of gaps is filled: all five producers
answer the whole contract and feed all five consumers. Two are deliberately left
unadvertised rather than blocked: `curve(track(…))` works but goes undocumented,
since blob order is by size and not by travel, and `.each()` over a bundle that only
fills later (a swarm read back) loops over the slots it had at build.

## How the base carries it

- **Channels are lazy.** Internally a bundle is flat typed arrays — what the spatial
  hash and the line buffers read — and the array a sketch touches is materialized
  on first access each frame (`_chan`). A bundle nobody reads from fills nothing: a
  tracker that is only ever `.each()`'d never builds a channel array, and when one is
  built, that gathering is the input those consumers need in any implementation.
- **Producers extend, and implement one hook.** `_fill(t)` writes this frame's
  records into the arrays. `Layout._fill` walks its replay; `Blobs._fill` reads
  its slots, carrying alpha 0 for the empty ones so the spatial consumers skip
  them without the bundle having to compact and lose index alignment.
- **Records come off a declared list.** `static channels` on each producer is the
  one place a channel is named; `at(i)` is generated from it.
  `_record(rec, i)` is the hook for the rest of a record — a tracker's `.box()`.
- **Both spellings of a channel work.** A bare name is this frame's array (what
  sketch math and `link()` want); a producer whose state is per-record may spell
  its readings as calls instead (`blobs.pos(i)`, which can answer a resting value
  for an empty slot). `at(i)` follows whichever the producer has, so a tracker
  keeps `.pos(i)` and still answers `.at(i).pos`.

## Decisions worth remembering

- **The family is `Bundle`.** It is what the thing is: data over a set of points,
  which is the fiber-bundle intuition and reads as plain English besides — a bundle
  of records, tied together. It is austere in the way `Texture`, `Geometry` and
  `Signal` are, and it frees `data()` to be what it always was, the adapter rather
  than the family. (`Data` held the name while the family was being built, and its
  weakness was exactly that: the family and its adapter wore one word. `Sheaf` was
  considered and is the better joke but the worse noun — a sheaf assigns data to
  *open sets* with gluing conditions; data over points is a bundle. `Cast`,
  `Crowd`, `Series` and `Marks` were the alternatives with more voice; `Set` was
  disqualified for shadowing the JS global.)
- **No `read()` on the base.** The design sketch gave every producer a `.read()`
  returning "the Data view", because at that point a layout and a tracker were not
  Data and needed converting into one. Once they extend the base, four of the five
  producers would get `read()` as a pure alias of names they already have, the
  tracker would be its only user, and `particles().read()` already means something
  else one hop away (system → bundle, not bundle → arrays). Records are the one
  uniform surface; a second spelling for the same value was dropped before it
  shipped. If a tracker ever needs its channels in bulk, the thing to add is a
  named channel accessor, not a view object.
- **The docs gave up "bundle" where it meant a config object.** "A bundle of
  parameters" — the shared spread-able config — became "a config several ops
  share", and `.box(i)` now hands back "the config `rect()` takes". The family name
  outlives docs phrasing, so the phrasing moved.
- **`.instance(bundle)` takes any of them.** A bundle without pose data places
  position only; a layout adds rotation and scale; a tracker adds size and hiding.
  The producer decides what `apply` sets — and the base's `apply` is the
  position-only default, which is also the escape hatch for a bundle whose size is
  only known later (`.instance(64, (x, i) => b.apply(x, i))`, since an instance
  count is fixed at build).
- **A layout's place order is `.along(i)`, not `.age(i)`.** Producer vocabulary is
  free to differ in meaning; it is not free to lie. `age` means seconds everywhere
  else in the family, and the tooltip needing two bodies for one word was the tell.
- **`alpha` is presence, not opacity.** It is how a record says it isn't there: a
  particle between lives, a tracker's empty slot, a point the sketch wants out.
  Pairing, linking, paths and `.instance()` all read it the same way.

## Curve and Signal, while we're at it

A curve is not a bundle — it's the other function-of-one-number, and the mirror of a
signal across two axes: a signal maps **time → a number**, a curve maps **phase →
a point**. The domains differ in kind (seconds, unbounded, stateful things like
`.smooth()` make sense there; 0..1, normalized, geometric things like `.tangent()`
make sense here), so merging the classes would force one side's verbs onto the
other where they mean nothing.

The unification that's real and already works is composition: a signal can drive a
curve's phase (`c(T.mul(0.2))`), and a curve component can become a signal
(`sig(t => c(t * 0.2)[1])`). Worth doing: document the two side by side as "the
function-of-one-variable types," one diagram, same breath — and keep their
*conventions* mirrored (both take fns in every slot, both compose with
spread/phases) so learning one teaches the shape of the other. Worth skipping:
`.smooth()` on curves, `.tangent()` on signals.
