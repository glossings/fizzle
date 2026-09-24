// State that survives a re-run.
//
// Livecoding rule, alongside "errors never stop the video": editing the code
// must not restart the show. A patch is torn down and rebuilt on every
// ctrl+enter, so anything a node accumulates over time — a delay's frames of
// history, a counter's position in a palette, a smoothed level — would snap
// back to zero every time you touched a number, which the audience sees and
// you didn't ask for.
//
// Identity is `kind` plus the order the call was built in: the third .smooth()
// in the sketch keeps being the third .smooth(). Arguments are deliberately
// not part of it, because tweaking them live is the whole point — .smooth(0.2)
// edited to .smooth(0.3) has to keep its level, not jump to 0. The cost is
// that inserting a new stateful call above others shifts what they inherit,
// which is a blip on one run rather than a reset on every run.
//
// Claiming only happens while a sketch is evaluating. A signal built inside a
// per-frame callback would otherwise mint a new entry every frame and never
// stop.

const store = new Map();
const ordinals = new Map();
// A named block counts its own claims, under its name: editing one block can't
// shift what another inherits, and adding a block doesn't renumber the sketch.
let prefix = '';
export function claimUnder(path, fn) {
  const was = prefix;
  prefix = `${path}/`; // where the block is written, not who asked for it first
  try { return fn(); } finally { prefix = was; }
}
let claiming = false;
let gen = 0;

// make() is handed the key so a claim can *be* its identity rather than merely
// have one — that's what bufferId() names itself after.
export function carried(kind, make, free) {
  if (!claiming) return make();
  const slot = prefix + kind;
  const n = ordinals.get(slot) ?? 0;
  ordinals.set(slot, n + 1);
  const key = `${slot}#${n}`;
  let e = store.get(key);
  if (!e) store.set(key, (e = { value: make(key), free }));
  e.gen = gen;
  return e.value;
}

// Whether a sketch is evaluating — i.e. whether a claim made now will be the
// same claim next run. Anything minting a resource per call has to ask, or a
// call from inside onFrame() mints a new one every frame forever.
export const isClaiming = () => claiming;

// Run the sketch, with the claims it makes counted from zero. A run that
// throws is followed by a second one restoring the last good code — both
// count from zero, so the restored sketch claims the state it had before.
export function claimDuring(fn) {
  ordinals.clear();
  claiming = true;
  try {
    return fn();
  } finally {
    claiming = false;
  }
}

// Between runs: whatever the last one didn't claim belongs to a call that has
// been edited away, and its buffers are worth real memory.
export function sweepCarried() {
  for (const [key, e] of store) {
    if (e.gen < gen) {
      e.free?.(e.value);
      store.delete(key);
    }
  }
  gen++;
}

// A different sketch entirely, rather than an edit of this one — nothing it
// builds has any claim on what the last one accumulated.
export function resetCarried() {
  for (const e of store.values()) e.free?.(e.value);
  store.clear();
}
