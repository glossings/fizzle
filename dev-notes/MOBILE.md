# The touch layer

Everything gated on `isTouch` in `src/touch.js` — `(hover: none) and
(pointer: coarse)`, so a trackpad iPad and every laptop are unaffected.

The governing idea is **one surface at a time**. A mouse can point at the code
and the picture at once; a finger can't. With the code up, `#editor` covers the
window, takes every pointer event, and the camera is switched off outright
(`engine.orbitAllowed`). Hidden, it's `display: none` and the canvas has the
lot. Nothing has to guess which of the two a gesture meant.

## The bug that cost four rounds

**Symptom:** on iPhone Safari the app ends up zoomed a few percent, shifted, a
sliver off screen, and nothing in the app can undo it.

**Cause:** iOS Safari zooms the page in when a focusable element with a
computed `font-size` under 16px takes focus, and does not reliably zoom back
out when the keyboard goes. The editor is a contenteditable and the default
`--editor-font` was 15px. It is *Safari's* zoom, not ours, which is why no
gesture, reset or clamp of ours could touch it.

**Fix:** 16px floor on `.cm-editor` for coarse pointers, plus `MIN_FONT` in
`sidebar.js` so a size saved before the rule is brought up to it too.

**The tell we should have followed sooner:** it only happened after typing, and
hiding/showing the code (which resets our own transform) didn't clear it.
Either fact alone says the scale isn't ours.

## What was added chasing it, and what that's worth

Several changes were made on wrong theories. Reassessed after the fact:

| change | added for | verdict |
|---|---|---|
| Safari `GestureEvent` zoom path | theory that canceling `gesturestart` starves `touchmove` | **reverted** — disproved: pinch was working, just outrun by the page zoom |
| `SNAP_BACK` (release under 1.1× → 1×) | "stuck" zoom | **reverted** — the premise was false, see below |
| `decideGesture` biased 1.8× toward zoom | "stuck" zoom | **reverted** — never saved a case, and broke one, see below |
| rebase on every finger-count change | "stuck" zoom | **keep** — not a hack; a stale baseline after a third finger or a lift-and-replace is a real defect, verified separately |
| `resetZoom()` on ⟨/⟩ | escape hatch for the above | keep — optional, but "the code you bring back is the code you left" stands on its own |

**Why `SNAP_BACK` was pointless.** The claim was that escaping ~1.05× needs
two fingers almost touching. It doesn't: `rebase` re-takes `k0` *and* `gap0` at
the start of every gesture, so escaping 1.05× only wants a ~5% squeeze from
wherever the fingers happen to land. The smallest squeeze that registers at all
is `LOCK_SLOP` (12px), which gives `k × (1 − 12/gap0)` — reaching 1× as long as
`gap0 ≤ 12k/(k−1)`, i.e. 252px at k=1.05, wider than the phone. So the minimum
possible gesture already overshoots to 1×. Measured from both a 200px and a
60px finger spread: both land on exactly 1×.

**Why the 1.8× bias was worse than nothing.** It was meant to stop a pinch with
a drifting midpoint reading as a pan. Measured: the plain "whichever changed
more" tiebreaker already gets those right (20px and 30px of drift both still
read as zoom, because a pinch changes the gap far more than it moves the
center). Meanwhile the bias misread a genuine pan — 45px of travel with 30px of
incidental squeeze — as a zoom, since 45 < 30 × 1.8. It never saved a case and
it broke one.

`blockPageZoom()` stays: it stops a *deliberate* page pinch, which is still
worth stopping. It never had anything to do with the focus zoom.

Fixed requirements, not up for reassessment: the one-surface model, the
three buttons, one-finger horizontal pan, zoom/pan non-blending on both
surfaces, and the camera lock.

## Things that bite on touch, for next time

- **16px minimum on anything focusable** — the above. Applies to the sidebar
  selects and number inputs and to `#ph-search` as well.
- **`mousedown` is not a tap.** A synthesized `mousedown` only arrives once the
  browser has ruled out a pan. Use `click`.
- **Safari won't open a picker for a control it thinks isn't there.** The
  color swatch *is* an `<input type="color">` on touch rather than a span that
  calls `showPicker()` on a hidden one.
- **Don't replace a widget's DOM while a finger is in it.** Every drag through
  the color picker rewrites the hex, which mints a new widget;
  `updateDOM` returning true keeps the node so the picker stays open.
- **CodeMirror only scrolls a scroller you gave an overflow to.** Without
  `.cm-scroller { overflow-y: auto }` the spilled overflow was scrolled by
  `#editor` instead — fine for a wheel, useless for a finger, since `#editor`
  is `pointer-events: none` on a mouse.
- **`clearPatch()` resets renderer state on every run.** It set
  `controls.enabled = true`, so anything the UI turned off came back the next
  time you pressed run. Hence `orbitAllowed`.
- **CodeMirror measures through a CSS transform** (`getScale` in
  `@codemirror/view`), so the pinch zoom doesn't break hit-testing. But
  `position: fixed` tooltips inside a transformed ancestor position against
  that ancestor — hence `tooltips({ position: 'absolute' })` on touch.
