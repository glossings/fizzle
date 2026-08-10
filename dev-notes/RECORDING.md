# Recording

Notes toward recording a set to a video file. Not started; this is a scoping
document, not a plan of record. Tabled deliberately — the cheap 90% is real and
useful on its own, and the expensive 10% is the part that makes it feel finished.

The shape wanted:

1. `ctrl+r` toggles recording on and off.
2. Defaults to a canonical location on disk.
3. Default filename along the lines of `fizzle_recording.mp4`.
4. Never collides — every take gets its own name.
5. Sidebar settings for filename and location; a chosen name still gets
   uniquified rather than overwritten.
6. Video at the requested resolution plus the incoming audio, when there is any.
7. Records what the *projector* would show — code visible when it's shown,
   hidden when it isn't — whether or not a projector window is actually open.
8. An unobtrusive recording indicator that the audience never sees.

## What already exists

`canvas.captureStream()` is proven on the `#gl` canvas: it's how the projector
mirrors the framebuffer today ([projector.js:117](../src/projector.js#L117)),
including the fallback for engines that hand back a stream that never produces a
frame. `MediaRecorder` on top of that stream is the whole mechanism.

Audio capture and device selection are done — [audio.js](../src/audio.js) for the
graph, the `audio in` / `audio out` selects in
[sidebar.js:150-188](../src/sidebar.js#L150-L188) for the picking.

## The easy 90% — points 1, 3, 4, 6, 8

A new `src/record.js` of roughly 200 lines, a keybinding, a settings block and a
little CSS.

Point 8 is nearly free. The indicator lives in the main window's DOM, and the
projector only mirrors the canvas plus its own code pane, so the audience never
sees it — and since the recording captures the framebuffer rather than the page,
neither does the file. A fixed dot at `right: 44px` sits beside
[`#sb-toggle`](../src/style.css#L155) without disturbing anything.

### Audio needs one contained refactor

Every `AudioEngine` currently builds its own `AudioContext`
([audio.js:43](../src/audio.js#L43) and [audio.js:93](../src/audio.js#L93)), so
the mic engine, the named captures in `engine.audios`, and each `audiofile()`
element live in separate contexts. Nodes can't be mixed across contexts, so
capturing all of them into one recording means hoisting a single shared
module-level context. Nothing appears to depend on the separation, so the risk is
low — but there is one behavioral consequence: `setSinkId` is per-context, so
output-device selection would start moving `audiofile()` playback along with the
passthrough. Arguably the right behavior anyway; not free, and worth deciding on
purpose rather than discovering.

With that done, one `MediaStreamAudioDestinationNode` fed by every source node
gives the audio track to hand `MediaRecorder` alongside the video track.

### mp4 is not guaranteed

`MediaRecorder` speaks webm on Firefox, and mp4 support elsewhere is version
dependent. Feature-detect `video/mp4;codecs=avc1.42E01E,mp4a.40.2`, fall back to
`video/webm;codecs=vp9,opus`, and take the file extension from whichever won.
Note that webm out of `MediaRecorder` frequently lands without duration metadata
and won't scrub properly until it's remuxed — so mp4 when we can get it is worth
the detection.

### Resolution caveat

`captureStream` records the drawing buffer, which below high quality is smaller
than what `resolution()` asked for: `resolution(1920, 1080)` at med renders — and
therefore records — 1440×810 ([engine.js:91](../src/engine.js#L91)). Record the
buffer as it is and say so in the settings, rather than upscaling nothing into
something.

There's also a performance question that only a real set will answer: capture
plus encode at 1080p60, on top of the WebGL render and a live projector mirror
stream, is a lot to ask of a laptop mid-performance. Frame rate should be a
setting, defaulting low rather than high.

## Point 7 — the code overlay, and the actual project

This is the hard one, and the reason the rest is worth shipping without it.

`captureStream` yields the WebGL framebuffer and nothing else. The projected code
is CodeMirror DOM layered over the canvas
([projector.js:33](../src/projector.js#L33)), so a canvas recording of a fizzle
set has the visuals and no code, ever.

Getting the code in means compositing by hand: an offscreen 2D canvas,
`drawImage` of the GL canvas each frame, the code layer over the top. Two ways to
raster the code layer, both with teeth:

- **`<svg><foreignObject>` around the CodeMirror DOM**, serialized to a blob and
  loaded as an image. Needs every applicable CSS rule and the editor font inlined
  as data URIs or it silently falls back to something that isn't the projector.
  Chrome handles this; Safari has historically been unreliable at it.
- **Re-implement the highlighted-text renderer** against the 2D canvas API.
  Fully under our control, and guaranteed to drift from what CodeMirror actually
  draws.

The saving grace either way: the code only changes when someone types, so the
raster is cached and rebuilt on doc change, leaving one `drawImage` per frame.
The blinking caret ([projector.js:38-47](../src/projector.js#L38-L47)) is the one
thing that animates independently, and it's cheap to draw directly.

Screen capture via `getDisplayMedia` would get the fidelity for free and is what
most people reach for with OBS — but it can't satisfy point 7 as stated. The
requirement is that the recording show what the projector *would* see even with
the projector closed, and there is no window to capture in that case. Capturing
the current tab instead would pull in the sidebar and status line, which is
exactly wrong.

## Points 2 and 5 — where the file goes

A web page cannot write to a path it chose. Two tiers, and which one you get
depends on the browser:

- **No configured location.** Blob into `<a download>`, landing in the browser's
  download folder — Downloads on both platforms unless the user moved it. The
  browser handles collisions itself with ` (1)` suffixes. The cost is that the
  entire recording sits in memory before it touches disk; a ten-minute 1080p take
  is several hundred megabytes of tab.
- **Configured location.** `showDirectoryPicker()` returns a persistent directory
  handle that can be stashed in IndexedDB and re-permissioned with one click per
  session, and `createWritable()` streams `MediaRecorder` chunks straight to disk
  with no memory growth. Chrome and Edge desktop only; Firefox and Safari fall
  back to the tier above.

### Naming: timestamp, not a counter

Point 4's open question answers itself from that split. A counter needs to
enumerate the target directory to find the next free number, and enumeration only
exists on the tier that has a directory handle — so counters would behave
differently depending on the browser.

A timestamp works everywhere: `fizzle-2026-08-04-105033.mp4`. Sixteen characters,
never collides, and it sorts chronologically, which is the property that actually
matters when there are forty takes from one set to sift through.

## `ctrl+r` is already taken

It's restart-media, bound in both places keys are handled —
[editor.js:31](../src/editor.js#L31) for the editor keymap and
[editor.js:80](../src/editor.js#L80) for when the canvas has focus — and
documented in the header comment at [editor.js:11-13](../src/editor.js#L11-L13).

Recording wants it, so restart-media needs somewhere else to live. `ctrl+shift+r`
reads naturally but collides with hard-reload; `ctrl+;` and `ctrl+0` are both
free and unclaimed by the browser. Undecided.

## Estimate

**Phase one** — everything except the code overlay — is about half a day, and
lands a feature worth having on its own.

**Phase two** — the code overlay — is a day or two by itself, most of it spent on
font and CSS inlining and on deciding how much Safari matters. Worth building
second precisely so the first half isn't held hostage to it.

Plus what any user-facing feature here owes: a section in
[docs-content.md](../src/docs-content.md) and the keybinding listed wherever the
others are.
