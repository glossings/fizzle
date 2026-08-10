// Livecoding rule: nothing a sketch does should stop the video. Whatever a
// call can't honour is said here — in the console and in the status bar — and
// the frame goes out regardless.
//
// Once per message per patch in the console, because most of these fire from
// inside a per-frame updater and would otherwise say it 60 times a second.
//
// On screen it's once per message, full stop, until it stops being true: a
// warning you've already read and haven't fixed is not news on every
// ctrl+enter, and nagging through a set is worse than useless. Message text
// is what identifies it, which lands in the right place on its own — the
// numbers a warning quotes back ("holding 85 frames") change when you edit the
// call it's about, so that edit speaks up again and an unrelated one doesn't.

const said = new Set();     // in the console this patch
let fired = new Set();      // raised at all since this run began
let shown = new Set();      // put on screen, and still true as far as we know

export function warn(msg) {
  fired.add(msg);
  if (said.has(msg)) return;
  said.add(msg);
  console.warn(`fizzle: ${msg}`);
  if (shown.has(msg)) return;
  shown.add(msg);
  window.dispatchEvent(new CustomEvent('fizzle-warning', { detail: msg }));
}

// Something a sketch asked for that's on its way rather than wrong — a Poly
// Haven asset coming down over the network. Same channel as a warning, minus
// the alarm.
export function notice(msg) {
  if (said.has(msg)) return;
  said.add(msg);
  console.log(`fizzle: ${msg}`);
  window.dispatchEvent(new CustomEvent('fizzle-notice', { detail: msg }));
}

// Console only, same once-per-patch dedupe. For things a call couldn't honour
// exactly but did something reasonable about anyway — a speed clamped to what
// the browser will play is worth being able to look up, not worth a line in
// the status bar every time a random lands out of range.
export function note(msg) {
  if (said.has(msg)) return;
  said.add(msg);
  console.warn(`fizzle: ${msg}`);
}

export const resetWarnings = () => said.clear();

// A new run: anything that went quiet during the last one has been fixed (or
// was never reached), so it gets to speak up again if it comes back.
export function newWarningRun() {
  for (const m of shown) if (!fired.has(m)) shown.delete(m);
  fired = new Set();
}
