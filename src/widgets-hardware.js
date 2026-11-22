// Hardware moving the controls drawn in the code: a { cc }, { note } or { pad }
// in a control's call makes the knob on the desk (or the stick in the hand) a
// second way to drag it. Every move goes through the same hand as a drag
// (widgets-editor.js), so the code, the drawn control and .record() all follow.
//
// MIDI has no touch or release, so a knob counts as held while it keeps
// sending and is let go after RELEASE_MS of quiet. A pad stick is held while
// it's off center, a trigger while it's pressed in.

import { onMidiMessage, firstPad, padButtonIndex, padButtonName, padDeadzone, PAD_DEADZONE } from './control.js';

const RELEASE_MS = 300;
const PICKUP_NEAR = 0.02; // a pickup knob this close to the control has caught it
const STICK_RATE = 1; // the whole range per second, stick all the way over
const TRIGGER_REST = 0.02;
const STICKS = { left: [0, 1], right: [2, 3] };
const AXES = { lx: 0, ly: 1, rx: 2, ry: 3 };
const TRIGGERS = { lt: 6, rt: 7 };
const isGate = (kind) => kind === 'button' || kind === 'toggle';

// `hand` is the editor's: controls() lists { key, kind, c } with a binding;
// move() sets a control's values without writing them, write() writes them;
// grab(), press() and release() are the pointer's down and up.
export function driveHardware(hand) {
  const states = new Map(); // key -> what this binding has been doing
  const pending = new Map(); // key -> kind, values moved but not yet written
  let unlisten = null;
  let raf = 0;
  let lastFrame = 0;

  const stateOf = (key) => {
    let s = states.get(key);
    if (!s) states.set(key, (s = { grabbed: false, timer: 0, down: false, caught: [], lastP: [], setP: [], pos: null, trig: null }));
    return s;
  };

  const schedule = () => { if (!raf) raf = requestAnimationFrame(tick); };

  const move = (key, kind, values) => {
    hand.move(key, kind, values);
    pending.set(key, kind);
    schedule();
  };

  const grab = (key, kind, s) => {
    if (s.grabbed) return;
    s.grabbed = true;
    hand.grab(key, kind);
  };
  const release = (key, kind, s) => {
    clearTimeout(s.timer);
    if (!s.grabbed) return;
    s.grabbed = false;
    flush();
    hand.release(key, kind);
  };

  // a knob turned: held now, let go once it stops
  const turned = (key, kind, s) => {
    grab(key, kind, s);
    clearTimeout(s.timer);
    s.timer = setTimeout(() => release(key, kind, s), RELEASE_MS);
  };

  // Pickup: nothing moves until the knob reaches where the control is. A
  // control moved some other way since (a drag, the code, a take playing) has
  // to be caught again.
  const pickedUp = (c, s, axis, p) => {
    const cur = c.pos(c.shown[axis]);
    if (s.setP[axis] == null || Math.abs(cur - s.setP[axis]) > 1e-6) s.caught[axis] = false;
    if (!s.caught[axis]) {
      const last = s.lastP[axis];
      s.lastP[axis] = p;
      const crossed = last != null && (last - cur) * (p - cur) <= 0;
      if (Math.abs(p - cur) > PICKUP_NEAR && !crossed) return false;
      s.caught[axis] = true;
    }
    s.setP[axis] = p;
    return true;
  };

  // an absolute position, 0..1, on one axis
  const setAxis = (key, kind, c, axis, p) => {
    const values = c.value.slice();
    values[axis] = c.at(p);
    move(key, kind, values);
  };

  const gate = (key, kind, c, s, on) => {
    if (on === s.down) return;
    s.down = on;
    if (kind === 'toggle') {
      if (on) move(key, kind, [c.value[0] > 0.5 ? 0 : 1]);
    } else if (on) {
      s.grabbed = true;
      hand.press(key, kind);
    } else release(key, kind, s);
  };

  const onMidi = (port, data) => {
    const type = data[0] & 0xf0;
    const ch = (data[0] & 0x0f) + 1;
    const a = data[1] ?? 0, b = data[2] ?? 0;
    const isCC = type === 0xb0, isNote = type === 0x90 || type === 0x80;
    if (!isCC && !isNote) return;
    for (const { key, kind, c } of hand.controls()) {
      const bind = c.bind;
      if (bind.channel && bind.channel !== ch) continue;
      const s = stateOf(key);
      if (isNote) {
        if (bind.note === a) gate(key, kind, c, s, type === 0x90 && b > 0);
        continue;
      }
      const axis = bind.cc ? bind.cc.indexOf(a) : -1;
      if (axis < 0) continue;
      if (isGate(kind)) { gate(key, kind, c, s, b >= 64); continue; }
      const p = b / 127;
      if (bind.pickup && !pickedUp(c, s, axis, p)) continue;
      turned(key, kind, s);
      setAxis(key, kind, c, axis, p);
    }
  };

  // --- pads, once a frame ---

  const padControl = (pad, key, kind, c, s, dt) => {
    const src = c.bind.pad;
    if (isGate(kind)) {
      gate(key, kind, c, s, !!pad?.buttons[padButtonIndex(src)]?.pressed);
      return;
    }
    if (src in TRIGGERS) {
      const b = pad?.buttons[TRIGGERS[src]];
      const v = b ? (b.value || (b.pressed ? 1 : 0)) : 0;
      // the first reading is where it rests, not a move
      if (s.trig == null) { s.trig = v; return; }
      if (v !== s.trig) {
        s.trig = v;
        if (v > TRIGGER_REST) grab(key, kind, s);
        setAxis(key, kind, c, 0, v);
      }
      if (v <= TRIGGER_REST) release(key, kind, s);
      return;
    }
    // sticks: y flipped so up is up, the way the pad's own signals read
    const read = (i) => (pad ? padDeadzone(pad.axes[i] ?? 0, PAD_DEADZONE) * (i % 2 ? -1 : 1) : 0);
    const tilt = kind === 'xy' ? STICKS[src].map(read) : [read(AXES[src])];
    const off = tilt.some((v) => v !== 0);
    if (!off && !s.grabbed) return;
    if (c.bind.spring) {
      // the stick's position is the control's: back to the middle on release
      grab(key, kind, s);
      move(key, kind, tilt.map((v) => c.at(0.5 + v / 2)));
      if (!off) release(key, kind, s);
      return;
    }
    if (!off) { release(key, kind, s); return; }
    // the stick pushes the control along, faster the further over
    if (!s.grabbed) s.pos = c.value.map((v) => c.pos(v));
    grab(key, kind, s);
    s.pos = s.pos.map((p, i) => Math.min(1, Math.max(0, p + tilt[i] * Math.abs(tilt[i]) * STICK_RATE * dt)));
    move(key, kind, s.pos.map((p) => c.at(p)));
  };

  function flush() {
    for (const [key, kind] of pending) hand.write(key, kind);
    pending.clear();
  }

  function tick(now) {
    raf = 0;
    const dt = lastFrame ? Math.min(0.1, (now - lastFrame) / 1000) : 0;
    lastFrame = now;
    let pads = false;
    const list = [...hand.controls()].filter((x) => x.c.bind.pad);
    if (list.length) {
      pads = true;
      const pad = firstPad();
      for (const { key, kind, c } of list) padControl(pad, key, kind, c, stateOf(key), dt);
    }
    flush();
    if (pads) schedule();
    else lastFrame = 0;
  }

  return {
    // after a run: listen for what the code's controls are bound to
    sync() {
      const list = [...hand.controls()];
      const keys = new Set(list.map((x) => x.key));
      for (const [key, s] of states) {
        if (!keys.has(key)) { clearTimeout(s.timer); states.delete(key); }
      }
      if (!unlisten && list.some((x) => x.c.bind.cc || x.c.bind.note != null)) unlisten = onMidiMessage(onMidi);
      if (list.some((x) => x.c.bind.pad)) schedule();
    },
    destroy() {
      unlisten?.();
      cancelAnimationFrame(raf);
      for (const s of states.values()) clearTimeout(s.timer);
    },
  };
}

// --- learn -------------------------------------------------------------------

// Wait for the hardware the control should follow. `step` says what's wanted
// next (an xy pad's second CC); `done` gets the options to write into the call
// as code text, and a label for what was bound. Returns the disarm fn.
export function learnHardware(kind, step, done) {
  let first = null; // an xy's first CC: { n, ch, at }
  let finished = false;
  const finish = (opts, label) => {
    if (finished) return;
    finished = true;
    disarm();
    done(opts, label);
  };
  const withChannel = (opts, ch) => (ch === 1 ? opts : { ...opts, channel: String(ch) });

  const unlisten = onMidiMessage((port, data) => {
    const type = data[0] & 0xf0;
    const ch = (data[0] & 0x0f) + 1;
    const a = data[1] ?? 0, b = data[2] ?? 0;
    if (isGate(kind)) {
      if (type === 0x90 && b > 0) finish(withChannel({ note: String(a) }, ch), `note ${a}`);
      else if (type === 0xb0 && b > 0) finish(withChannel({ cc: String(a) }, ch), `cc ${a}`);
      return;
    }
    if (type !== 0xb0) return;
    if (kind !== 'xy') { finish(withChannel({ cc: String(a) }, ch), `cc ${a}`); return; }
    const at = performance.now();
    if (!first) {
      first = { n: a, ch, at };
      step(`xy: x is cc ${a} — now move the control for y`);
      return;
    }
    if (a === first.n) return;
    // A pad sends both axes from one gesture, interleaved, so which arrived
    // first says nothing: the lower number is x. Two separate knobs come one
    // after the other, in the order asked for.
    const together = at - first.at < 150;
    const pair = together ? [Math.min(first.n, a), Math.max(first.n, a)] : [first.n, a];
    finish(withChannel({ cc: `[${pair[0]}, ${pair[1]}]` }, first.ch), `cc ${pair[0]} and ${pair[1]}`);
  });

  // pads have to be polled: compare each frame with the last
  let prev = null;
  let raf = requestAnimationFrame(function poll() {
    raf = requestAnimationFrame(poll);
    const pad = firstPad();
    if (!pad) return;
    const now = {
      buttons: pad.buttons.map((x) => ({ pressed: x.pressed, value: x.value })),
      axes: pad.axes.map((v) => padDeadzone(v, PAD_DEADZONE)),
    };
    const was = prev;
    prev = now;
    if (!was) return;
    if (isGate(kind)) {
      const i = now.buttons.findIndex((x, j) => x.pressed && !was.buttons[j]?.pressed);
      const name = i >= 0 && padButtonName(i);
      if (name) finish({ pad: `'${name}'` }, `button ${name}`);
      return;
    }
    const far = (i) => Math.abs(now.axes[i] ?? 0) > 0.5;
    if (kind === 'xy') {
      for (const [name, [x, y]] of Object.entries(STICKS)) {
        if (far(x) || far(y)) return finish({ pad: `'${name}'` }, `the ${name} stick`);
      }
      return;
    }
    for (const [name, i] of Object.entries(TRIGGERS)) {
      if ((now.buttons[i]?.value ?? 0) > 0.5) return finish({ pad: `'${name}'` }, `trigger ${name}`);
    }
    for (const [name, i] of Object.entries(AXES)) {
      if (far(i)) return finish({ pad: `'${name}'` }, `stick axis ${name}`);
    }
  });

  function disarm() {
    unlisten();
    cancelAnimationFrame(raf);
  }
  return disarm;
}
