# Profiling — how the sidebar's profile panel measures

Dev server only (the checkbox under fps). `src/profile.js` keeps a stack of
scopes and charges time to the innermost one, so a row is an op's own cost,
not its inputs'. Scopes are opened by:

- `TextureOp.renderNode` — one row per texture op, named after the call the
  sketch made and the line it made it on
- `Engine.add` — one row per mesh / particle system / link, charged both its
  updater (instance callbacks, the particle sim pass) and its draws, shadow
  pass included, through three's `onBeforeRender` / `onBeforeShadow` hooks
- `pass3d` and the plain render — `3d render`: clears, backdrop, the
  tonemap pass, whatever three does outside a draw
- `onFrame` callbacks; every other updater lands in `camera, fog…`
- the rest of `tick()` — `everything else`: display fold, feedback copies,
  audio analysis, recorder

GPU ms come from `EXT_disjoint_timer_query_webgl2`. Only one query can be
open, so entering a scope ends the outer one's and leaving starts it a new one.

## The Metal catch

Chrome on macOS (ANGLE's Metal backend) times a query by the command buffers
it touched, each counted whole. Left alone, every op in a frame reads about
the same number (the whole buffer's) and the total comes to several frames.
Measured on an M5 Pro with one heavy and one trivial draw in separate queries:

| between the two draws            | heavy | trivial |
| -------------------------------- | ----- | ------- |
| nothing                          | 11.7  | 7.8     |
| `gl.flush()`                     | 11.7  | 8.6     |
| `gl.finish()`                    | 11.6  | 11.5    |
| `readPixels` of an untouched fbo | 11.9  | 7.4     |
| clear own 1×1 fbo, then read it  | 11.7  | 0.02    |

Chrome defers flush and finish, and a read only waits on work the target it
reads was part of. So `sync()` clears a private pixel (which lands in the
current buffer, behind everything so far) and reads it back. That ends the
buffer at every scope boundary.

What that costs while the panel is open:

- CPU and GPU stop overlapping, so fps can drop a little. The wait itself is
  kept out of the cpu column.
- A boundary inside a 3D pass ends the render pass, so each object pays an
  MSAA store and reload it doesn't pay normally (about 0.06 ms at 1280×800).
  A sketch with hundreds of separate meshes reads high by that much per mesh;
  one instanced mesh doesn't.

The GPU also clocks down when it has slack, so a light sketch's milliseconds
are not the same milliseconds as a heavy one's. Compare rows within a
sketch, not across sketches.

Not seen at all: person() segmentation (its own loop, off the render), video
decode, the browser's compositor.
