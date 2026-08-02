// Livecoding rule: nothing a sketch does should stop the video. Whatever a
// call can't honour is said here — in the console and in the status bar — and
// the frame goes out regardless.
//
// Once per message per patch, because most of these fire from inside a
// per-frame updater and would otherwise say it 60 times a second. A re-run
// clears the set (see Engine.clearPatch), so a problem that's still there
// after an edit says so again.

const said = new Set();

export function warn(msg) {
  if (said.has(msg)) return;
  said.add(msg);
  console.warn(`fizzle: ${msg}`);
  window.dispatchEvent(new CustomEvent('fizzle-warning', { detail: msg }));
}

export const resetWarnings = () => said.clear();
