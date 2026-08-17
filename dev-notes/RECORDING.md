# Recording

> **Desktop only, by decision.** Everything below works on a phone and none of
> it is exposed there: no record button in the touch bar, no recording rows in
> the sidebar. Even fixed, the files were worse than what iOS records of its own
> screen for free, which makes it a feature competing with a better one. The
> wiring is intact — pass `onRecord` to `initTouchBar` to put it back — and the
> mobile findings below are kept because they were expensive to get.

Shipped in [src/record.js](../src/record.js), bound to `ctrl+e` and to the ●
button on a touch screen. This is what it does, what it deliberately doesn't,
and where the platform fought back.

## What it does

`ctrl+e` opens a save dialog, then composites every frame into an offscreen 2D
canvas whose `captureStream` feeds a `MediaRecorder`.

- **Size** is `engine.outputSize`. A `resolution()` or the sidebar's fixed size
  is a *declared* output format, so that's what comes out whatever quality is
  doing to the buffer underneath — 1920×1080 asked for is 1920×1080 recorded,
  upscaled if need be. Without one there's nothing declared and the buffer
  already is the window at its true size, so the buffer is the answer.
  (The first version used window pixels for both. On a phone that meant
  upscaling a deliberately-reduced buffer back up to a 2× DPR every frame, for
  no picture at all — see the mobile notes below.) The buffer is contain-fit
  into the frame, so a `resolution()` change mid-take letterboxes rather than
  corrupting the stream.
- **The composite runs in `engine.onFrame`**, at the end of `tick()`. It has to:
  the renderer has no `preserveDrawingBuffer`, so the framebuffer can't be read
  from a later task.
- **Frames are pushed, not sampled** — `captureStream(0)` plus
  `track.requestFrame()`, so the file gets exactly the frames the sketch drew.
  Falls back to `captureStream(60)` where `requestFrame` is missing.
- **The code overlay** is the projector's `#proj-code` while a projector is
  open, otherwise `#editor`, and null when whichever one applies is hidden.
  `main.js:codeLayer()` picks; each hands back the element plus the rect of it
  the picture occupies.

## The code overlay, in the end

The scoping doc's two options were `foreignObject` or a hand-written
highlighted-text renderer. `foreignObject` won: reusing the browser's own layout
is the only version that can't drift from what CodeMirror actually draws, and
the drift was the whole objection to the alternative.

The teeth were where they were expected, plus one:

- **All CSS travels inline.** `cssOf()` walks `document.styleSheets` and inlines
  every rule. No external anything loads inside an `<img>`.
- **Media queries are flattened**, not carried. An SVG image is its own
  browsing context with no pointer, no hover and a viewport the size of the
  picture, so `@media (pointer: coarse)` answers *no* inside it — on a phone the
  recorded code would come out styled for a desktop. `collect()` asks the real
  window and emits the blocks that matched with the query stripped off.
- **Scroll positions don't clone.** `shiftScroll()` walks both trees together
  and puts a `translate` on the children of anything scrolled. A transform
  rather than `top`/`left` because the children are a mix of relative and
  absolute — CodeMirror's selection and cursor layers are absolute at `top: 0`.
- **Fonts were a non-issue**: everything here is `ui-monospace` and friends, and
  SVG-as-image can use local system fonts. It's only *external* resources that
  are blocked. No data-URI font embedding was needed.

### The one that cost a day: `createImageBitmap` taints

The first version cached each snapshot as an `ImageBitmap`, to save
re-rasterizing the vector every frame. Every take came out 2 to 4 frames long
and unplayable.

**In Chrome, `createImageBitmap()` on an SVG-sourced `HTMLImageElement` returns
a bitmap that is not origin-clean, even from a `data:` URL.** Drawing it taints
the canvas the recording composites into. And a tainted canvas's
`captureStream` does not throw, does not end the track, does not mute it — it
just stops delivering frames. `track.readyState` still reads `live`. The
recording dies at the first frame with code in it, in complete silence.

Measured in Chrome, 180 rAF frames drawn per run, overlay first drawn at frame
10, frames counted with `ffprobe -count_frames`:

| overlay cached as | canvas | frames in file |
|---|---|---|
| `createImageBitmap(img)` | TAINTED | 10 |
| the `<img>` drawn directly | clean | 179 |
| `<img>` flattened onto a 2D canvas | clean | 178 |

So the raster cache is an ordinary `<canvas>`: it keeps the origin-clean flag
that `createImageBitmap` loses, and still avoids re-rasterizing the vector per
frame. `isClean()` now probes the first snapshot of every take through a 1×1
canvas, so if anything ever taints again it degrades to a picture-only take
with a warning instead of dying quietly.

Two other things that run confirmed, both worth not re-litigating:

- **The compositing canvas does not need to be in the DOM.** Detached and
  attached captured identically. No off-screen 1px canvas hack required.
- **`captureStream(0)` + `requestFrame()` beats `captureStream(60)`** by a lot:
  179 frames against 90 over the same three seconds. The push-based path is the
  one to keep.

Cost is one rasterize per change, not per frame: a `MutationObserver` on the
layer plus scroll and resize listeners set a dirty flag, and the frame loop
kicks a snapshot when one is pending and none is in flight. The overlay
therefore lands a frame or two behind the keystroke, which nobody can see. If
rasterizing ever throws, `noOverlay` latches and the take continues as picture
only — a recording without the code beats no recording.

## Where the file goes

`showSaveFilePicker` + `createWritable()`, with `MediaRecorder.start(1000)`, so
chunks stream to disk a second at a time and a long take never sits in the tab.
Firefox and Safari have no picker: those buffer in memory and download on stop.

**The container is the user's choice, in two places that are the same place.**
mkv and webm stay playable at whatever byte they stop at; mp4 needs a trailer,
so a take that's cut off is a lost take, but it's the one QuickTime, Premiere
and a phone's camera roll will take. Neither is right for everyone.

The first version hard-coded one ordering, and iOS Safari duly recorded webm: a
file the phone can't play, can't preview, and above all can't put in the camera
roll. Hard-coding the *other* way would only have moved the problem.

So `settings.recFormat` is the default — mp4 on a touch screen, mkv elsewhere —
and rather than a second dialog on top of the save dialog, the save dialog's own
format menu carries the alternatives. `openFile()` passes every recordable
container in `types` with the chosen one first, then reads back which one won
from `handle.name`, since the dialog renames the file to match the type picked
in it. Change it there for one take, change the setting for every take after.
Where there's no dialog the setting is simply the whole answer.

The sidebar only lists what `recordable()` says this browser can actually
write, and `applySettings()` clamps a format saved on another machine to
something this one can do.

Two guards around the same failure. `supported()` swallows a missing or
throwing `isTypeSupported`, and `extFor()` re-derives the extension from
`rec.mimeType` after the fact, since what a recorder produces isn't always what
it was asked for and a file named for the wrong container is one nothing opens.

### The camera roll

`<a download>` on iOS lands the file in Files, not Photos, whatever it's named.
The share sheet is the only route: `navigator.share({ files })` on an mp4 offers
**Save Video**, which is the camera roll.

**Stopping a recording costs the gesture that would open it.** The first version
called `share()` at the end of `stop()`, and iOS silently declined every time —
it downloaded instead, and looked for all the world like the share code wasn't
running. `navigator.share()` needs *transient activation*, and `stop()` awaits
the recorder's `onstop` before it gets there. That await is a task boundary, not
a microtask, so by the time there's a file to share the tap that ended the take
is spent. The five-second window is a red herring: WebKit wants the call inside
the gesture's turn, not merely soon after it.

So it's two taps, and it has to be. The finished take is parked in `pending`,
`#rec-save` appears where the recording indicator was, and its click handler
calls `share()` with **nothing awaited in front of it** — that ordering is the
whole fix, and anything inserted before that call will break it again.

The rest is about not losing takes. A dismissed sheet (`AbortError`) puts the
file back on the button rather than throwing it away; a refused one downloads;
and starting a new recording downloads whatever was still sitting there. On a
laptop, and anywhere `canShare` says no, the download stays the whole story —
and there the status line names the file size, since a sheet that turns a file
down is most likely turning down its size.

### The composite is the cost, so the fast path skips it

Measured on a phone: 60fps idle, **20fps recording, code shown or hidden alike**.
Identical either way, which rules the code layer out completely — it's the
capture path. (It also showed the `MAX_FPS` limiter to be self-defeating: once
the loop is at 20fps every frame is already past a 30fps threshold, so the limit
only bites while you don't need it.)

A benchmark in desktop Safari — same engine as iOS — said `drawImage(glCanvas)`
costs nothing there, and that compositing from a `<video>` fed by
`captureStream` (the projector's trick, and the fix I was about to ship) is
*worse*: 2ms a frame against 0. That change would have been a regression on a
plausible-sounding theory. Desktop WebKit is not iOS WebKit — a tile-based GPU
can pay for a mid-frame framebuffer read in a way a desktop one doesn't — but it
was enough to stop guessing at the copy's mechanism and start removing it.

So: **when the composite has nothing to do, don't have one.** With no code layer
and a frame that's the drawing buffer at its own size, `out` would be a
pixel-for-pixel copy of a canvas that can feed `MediaRecorder` by itself. In
that case `start()` hands `canvas.captureStream()` straight to the recorder,
`out` and `ctx` stay null, and `frame()` returns immediately — the compositor
does the work off the main thread, exactly as it does for the projector mirror.

The cost is that it's decided once: a `MediaRecorder` can't change source
mid-take, so showing the code during a direct take can't retroactively put it in
the file. It warns rather than silently omitting, and so does a resize, which a
stream nobody is compositing can't be letterboxed into.

Confirmed on the device: direct capture holds 60fps where compositing gave 20.

### The composite is per-pixel, and it isn't on the main thread

Measured on the device, code shown, same sketch:

| rec. scale | pixels | render |
|---|---|---|
| full | 0.74 Mpx | 20fps |
| half | 0.18 Mpx | 60fps |

Four times fewer pixels, three times the frame rate and into the vsync cap. So
the cost is **per-pixel**, and `recScale` is a real fix rather than a knob that
moves nothing. Touch defaults to half for that reason; desktop keeps every pixel
because it was never paying.

The other half of that measurement matters more for anyone debugging this next.
A timer wrapped around the whole composite block read **0ms in every case** —
including the 20fps one. `drawImage` queues GPU work and returns; the bill
arrives later, in the compositor, when the frame is presented and captured.
Main-thread timing cannot see any of it.

Which means **the earlier desktop Safari benchmark proved nothing**. It reported
0.00ms for `drawImage(glCanvas)` and I read that as "the copy is free" — it only
ever showed that the copy doesn't block the caller, which is true and
uninteresting. Its one real finding stands (the `<video>` path costs 2ms of
actual main-thread time that the direct path doesn't), but the comparison it was
built to make was never made. **To measure this class of cost, watch the frame
rate, not the clock.**

Untried, if a phone ever needs more resolution than half: compositing into a
*WebGL* canvas via `texImage2D` rather than a 2D one, in case WebKit has an
IOSurface path for canvas-to-texture that `drawImage` doesn't.

### Three things were making it look worse than the screen

Reported as "blurry, jumpy", and it was three separate causes stacked, two of
them introduced by the performance work above.

**The bitrate was 332 kbps.** `bitrate()` was bits-per-pixel with no floor, so
shrinking the frame shrank the bitrate quadratically — half scale on a phone
came out at a third of a megabit. Worse, the touch coefficient had been dropped
to 0.06 as a guess at relieving the *encoder*, which we now know was never the
bottleneck: it bought nothing and cost the picture. Now 0.15 bpp everywhere,
because a visual synth is the encoder's hard case — full-frame change every
frame, hard edges, saturated colour, none of which the camera-footage 0.1 rule
of thumb anticipates — with a **2.5 Mbps floor**, since a small frame is exactly
where a fixed bits-per-pixel starves and also where extra bits are cheapest.

**Downscaling was point-sampled.** Any `recScale` below full resamples every
frame, and high-frequency generative detail crawls and fizzes frame to frame
when it isn't filtered — which reads as a bad encode rather than as aliasing.
`imageSmoothingQuality = 'high'` on the compositing context.

**The code layer was rasterized at CSS pixels and scaled up.** `snapshot()` used
`clientWidth`/`clientHeight`, so on any display denser than the layout — every
retina laptop, at 2× — the code went into the file at half the frame's
resolution and was upscaled. It now takes a `k` (frame pixels per CSS pixel,
measured from the composite's own geometry and clamped to 0.5–3) and rasterizes
at that, keeping layout in CSS units via the SVG `viewBox`. On a phone at half
scale `k` works out under 1, so this is *cheaper* there as well as sharper on a
laptop.

Still true and not a bug: phones record at 30fps (`MAX_FPS`) against a 60fps
screen. Raising it would double the composite work that `recScale` just bought
back, so it stays until someone asks.

None of it was enough, which is what settled the desktop-only decision at the
top: half resolution and 30fps against a screen recorder that gives you native
resolution at 60 for nothing.

### The code was clipped to the wrong origin

`#editor` is `inset: 0`, so it spans the window, while a `resolution()` canvas
is a letterboxed rectangle centred inside it. `codeLayer()` took the region of
the editor *under the canvas* — anchored at `box.left` — but the code starts at
the window's own left edge, 8px in. Everything between the two got cut, which is
16px on one window shape and 64px on another, off the start of every line.

The region is now anchored at the editor's own top left, `box.width × box.height`
of it. Same scale, nothing lost on the left, and it matches what the projector
gets for free — its code pane is built the size of the picture, so this question
never arises over there.

### The code scrolled at 12fps in a 60fps file

Reported as scrolling that's "staccato and jittery" in the file against smooth
scrolling live. The video itself was fine — ffprobe put a real take at
59.3fps average — but `SNAP_MS` capped code re-rasterization at 80ms, so
during a scroll the picture updated at 60 while the code layer over it updated
at 12. Desktop `SNAP_MS` is now 30ms (~2 render ticks, roughly the
rasterize-decode round trip), with `busy` still the governor when the round
trip runs longer. Scrolling code in the file now moves at ~30fps; per-frame
would mean rasterizing faster than the async decode can finish, so this is the
practical ceiling for the SVG approach.

### The "desaturated" code is not in the file

Measured, not guessed: a throwaway harness recorded a canvas of known sRGB
patches through MediaRecorder in this machine's Chrome, once through each
pipeline, then ffmpeg-decoded a frame under both color matrices
(`-vf scale=in_color_matrix=bt709|smpte170m`) and compared pixel values
against the source colors.

- **Composite path** (2D canvas, `captureStream(0)` + `requestFrame` — every
  take with code in it): converted *and* tagged bt709. Decoded per its tags,
  worst error was **Δ2/255**. The colors in the file are essentially exact.
- **Direct path** (`captureStream(fps)` straight off a canvas): converted
  *and* tagged bt601 (`smpte170m`). Also self-consistent, also accurate in any
  player that honors tags.
- The scary third case — converted 601 but tagged 709, which really would
  desaturate reds and greens by ~15% (Δ40 on pure green) — is what headless
  Chrome's software encoder does *tag-consistently*, and what we confirmed the
  real pipelines don't do inconsistently.

So what's left, and unfixable from here:

1. **4:2:0 chroma subsampling.** Every consumer codec MediaRecorder offers
   stores color at half resolution in both axes. A syntax-colored glyph stroke
   is 2–4px wide; its chroma gets averaged with the dark background, which
   reads as exactly "slightly desaturated" — on the code specifically, because
   thin saturated strokes are the worst case and big soft visuals hide it.
   Only 4:4:4 would fix it and MediaRecorder doesn't offer it. Bigger font or
   higher recording resolution dilutes it.
2. **The player.** QuickTime's handling of bt709-tagged video lifts it
   slightly (the well-known QT gamma shift); Chrome playing the same file
   matches the live screen much more closely. Judge a take's color by playing
   it in the browser before blaming the encode.

### A phone is compositing and encoding its own render

Recording on a phone dragged the visuals badly, and it was three costs stacked
on one chip, all of them avoidable:

1. **Upscaling for nothing.** `outputSize` was window pixels at 2× DPR while the
   buffer, at the touch default of 0.75 quality, was well under that. Every
   frame was a scale-up to a resolution with no more picture in it. Taking the
   buffer instead cut the composited pixels by nearly half.
2. **Sixty frames a second of it.** `MAX_FPS` is 30 on touch, and the rate limit
   returns *before* compositing rather than merely skipping `requestFrame` —
   the point is the work not done. Bitrate is asked for at 0.06 bpp there
   rather than 0.1, since the encoder is sharing the chip with the render.
3. **A full-screen rasterization per keystroke.** With the code up, the layer on
   a touch screen is the entire screen, and every character dirtied it.
   `SNAP_MS` floors that at 250ms on touch, 80 elsewhere. A video does not need
   the code updated more often than four times a second.

Together roughly 3.5× less compositing work. Hiding the code (`⟨/⟩`) removes
the overlay cost entirely, which is the usual way to record on a phone anyway.

### The memory path has a ceiling

No handle means the whole take is Blobs in the tab. At the bitrates here that's
hundreds of megabytes for a few minutes, and a tab that runs out of room takes
the take with it. `MEMORY_CAP` stops recording first — 400 MB on a touch screen,
1.5 GB otherwise — and the indicator shows the running total, so it's visible
before it's a decision.

**The one caveat that survives.** Chrome's `createWritable()` writes through a
swap file and renames it on `close()`. A graceful interruption is covered — stop,
navigation and `pagehide` all flush — but a hard tab crash leaves the bytes in a
`.crswap` file beside the target rather than at the target. They're recoverable
by renaming, and being matroska they play. There is no API that writes in place
to a user-chosen path; OPFS `createSyncAccessHandle` does, but only inside
origin-private storage, which is not a location anyone can pick.

## Not done: audio

The one part of the original scope left out, and the reason is the one the
scoping doc named. Every `AudioEngine` builds its own `AudioContext`
([audio.js:44](../src/audio.js#L44), [audio.js:93](../src/audio.js#L93)), nodes
can't be mixed across contexts, and capturing the lot means hoisting one shared
module-level context. That's cheap to do and it changes behaviour:
`setSinkId` is per-context, so the output-device select would start moving
`audiofile()` playback along with the mic passthrough. Arguably right, but it's
a decision about how the audio graph behaves during a set, not a detail of
recording — worth taking on purpose rather than discovering.

Once that's done it's one `MediaStreamAudioDestinationNode` fed by every source,
and its track handed to `MediaRecorder` alongside the video one.

## Also not done

- **Frame rate is not a setting.** Push-based capture means the encoder only
  sees frames the sketch actually drew, so there's no sampling cost to dial
  down. Whether encoding at 1080p60 on top of a live projector mirror holds up
  mid-set is still a question only a real set answers.
- **No settings block.** The save dialog remembers its last directory itself, and
  the filename is `fizzle-<sketch>-<timestamp>.<ext>`, which never collides and
  sorts chronologically. A stashed directory handle in IndexedDB would skip the
  dialog per take; nobody has asked yet.
- **The pinch transform on a touch screen is ignored** — the snapshot is of the
  untransformed layout. Zooming in to read is not a framing choice.
