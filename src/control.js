// External control surfaces — MIDI and gamepads — as signals.
//
// Both are the same shape as audio(): something outside the sketch moves, and
// a parameter follows it. So everything here ends in sig(), and the state a
// message left behind lives at module scope rather than in carry.js — a knob
// is at the position you left it whether or not the sketch has been re-run,
// and there's one of it however many calls are reading it.
//
// MIDI is event-driven and gamepads are polled, but that difference doesn't
// reach the sketch: the pad is read lazily, once per t, by whichever signal
// asks first. Nothing here runs at all until a sketch calls midi() or
// gamepad().

import { sig } from './audio.js';
import { warn } from './warn.js';

// --- midi ------------------------------------------------------------------

let access = null;          // MIDIAccess once granted
let accessAsked = false;
const stores = new Map();   // port id -> what that device last sent
const omni = newStore();    // and the merge of every device, for bare midi()
const portNames = new Map(); // port id -> name, for matching and completion

function newStore() {
  return {
    cc: new Map(),      // 'ch:num' -> 0..1
    ccAny: new Map(),   // num -> 0..1, whichever channel sent it last
    keys: new Map(),    // key -> { on, vel, touch }
    held: new Set(),
    lastKey: 0,         // latched: the pitch and velocity stay after the release
    lastVel: 0,
    bend: 0,            // -1..1, centered
    touch: 0,
  };
}

// What a device that has never sent anything reads as. Shared, so a call
// naming a controller that isn't plugged in yet costs nothing per frame.
const EMPTY = newStore();

const keyState = (s, k) => {
  let v = s.keys.get(k);
  if (!v) s.keys.set(k, (v = { on: 0, vel: 0, touch: 0 }));
  return v;
};

// Called for every message on every port, once per store (the device's and the
// omni merge). Anything unrecognised — clock, program change, sysex — falls
// through; a controller sends plenty that no signal here is asking about.
function apply(s, data) {
  const status = data[0];
  if (status < 0x80) return;
  const type = status & 0xf0;
  const ch = (status & 0x0f) + 1;
  const a = data[1] ?? 0, b = data[2] ?? 0;
  switch (type) {
    case 0x90:
    case 0x80: {
      // note on with velocity 0 is the release half the world's gear sends
      const on = type === 0x90 && b > 0;
      const k = keyState(s, a);
      k.on = on ? 1 : 0;
      if (on) {
        k.vel = b / 127;
        s.lastKey = a;
        s.lastVel = k.vel;
        s.held.add(a);
      } else {
        k.touch = 0;
        s.held.delete(a);
      }
      break;
    }
    case 0xb0:
      s.cc.set(`${ch}:${a}`, b / 127);
      s.ccAny.set(a, b / 127);
      break;
    case 0xa0:                    // polyphonic aftertouch: pressure per key
      keyState(s, a).touch = b / 127;
      break;
    case 0xd0:                    // channel pressure: one value for the lot
      s.touch = a / 127;
      for (const k of s.held) keyState(s, k).touch = a / 127;
      break;
    case 0xe0:
      s.bend = (((b << 7) | a) - 8192) / 8192;
      break;
  }
}

let learnHook = null;   // set while main.js has a learn armed

// The port is passed in rather than read off the event: a MIDIMessageEvent
// carries the data and nothing else, and the port it arrived on is only known
// because that's the one this handler was attached to.
function onMessage(port, data) {
  let store = stores.get(port.id);
  if (!store) stores.set(port.id, (store = newStore()));
  apply(store, data);
  apply(omni, data);
  learnHook?.(port, data);
}

// The device list, so you know what to put in midi('name'). Plainly logged, not
// warned: nothing is wrong, this is the reference you look up. Said again only
// when the list actually changes, so hot-plugging reports itself and a
// statechange for anything else stays quiet.
//
// An empty list is the one case worth a warning — a sketch reading midi() with
// nothing connected sits at 0 forever, and this says why.
let portsSaid = null;
function logPorts() {
  const line = [...portNames.values()].join(', ');
  if (line === portsSaid) return;
  portsSaid = line;
  if (line) console.log(`fizzle: midi inputs: ${line}`);
  else warn('midi: no inputs connected — the signals read 0');
}

// One access request for the page, shared by every call. Not awaited anywhere:
// signals read 0 until it lands, which is the same handful of frames a sketch
// spends waiting for the first knob move anyway.
function ensureMidi() {
  if (access || accessAsked) return;
  accessAsked = true;
  if (!navigator.requestMIDIAccess) {
    warn('midi: this browser has no Web MIDI (Safari) — the signals read 0');
    return;
  }
  navigator.requestMIDIAccess({ sysex: false }).then(
    (a) => {
      access = a;
      // Rebuilt rather than added to, so a device that has been unplugged stops
      // being offered and stops matching a name — its store keeps the values it
      // sent, in case it comes back on the same id.
      const listen = () => {
        portNames.clear();
        for (const port of a.inputs.values()) {
          portNames.set(port.id, port.name ?? 'midi');
          port.onmidimessage = (e) => onMessage(port, e.data);
        }
        logPorts();
      };
      listen();
      // a controller plugged in mid-set is the normal case, not an edge one
      a.onstatechange = listen;
    },
    () => warn('midi: access refused — the signals read 0')
  );
}

// Which device a call is reading. No name = the merge of all of them, which is
// what one controller on the desk wants; a name matches a port by
// case-insensitive substring, so two of them can drive different parameters.
function storeFor(name) {
  ensureMidi();
  if (name == null) return omni;
  const want = String(name).toLowerCase();
  for (const [id, n] of portNames) {
    if (n.toLowerCase().includes(want)) return stores.get(id) ?? EMPTY;
  }
  // Only once the ports are known: before that a miss says nothing.
  if (access) warn(`midi('${name}'): no input matching that name — the signals read 0`);
  return EMPTY;
}

export const midiPortNames = () => {
  ensureMidi();
  return [...portNames.values()];
};

// A whole-number 0..127. The guard is really for `midi().key` used without its
// argument: resolve() would call it with t, and a fractional key is the tell.
function midiKey(k, call) {
  const n = Math.round(k);
  if (!Number.isFinite(n) || n !== k || n < 0 || n > 127) {
    warn(`midi: ${call}(${k}) — a key is a whole number 0..127; using the last one played`);
    return null;
  }
  return n;
}

// The per-key handle: midi().key(38) is one pad, with the same signals the
// device-wide ones carry. An empty key() asks main.js to learn which pad.
function keyHandle(read, k) {
  return {
    note: sig(() => (k == null ? read().lastKey : k) / 127),
    vel: sig(() => (k == null ? read().lastVel : keyState(read(), k).vel)),
    gate: sig(() => (k == null ? (read().held.size ? 1 : 0) : keyState(read(), k).on)),
    touch: sig(() => (k == null ? read().touch : keyState(read(), k).touch)),
  };
}

export function midiHandle(name, onLearn) {
  const read = () => storeFor(name);
  const any = keyHandle(read, null);
  return {
    ...any,
    // cc(num, channel) — channel is 1-based and optional; without one the
    // number answers to whichever channel sent it last, which is what a
    // controller left on its factory setting wants. Empty cc() learns.
    cc(num, channel) {
      if (num == null) {
        onLearn?.('cc');
        return sig(() => 0);
      }
      return sig(() => {
        const s = read();
        const n = Math.round(num);
        return (channel == null ? s.ccAny.get(n) : s.cc.get(`${Math.round(channel)}:${n}`)) ?? 0;
      });
    },
    key(k) {
      if (k == null) {
        onLearn?.('key');
        return keyHandle(() => EMPTY, 0);
      }
      const n = midiKey(k, 'key');
      return n == null ? any : keyHandle(read, n);
    },
    bend: sig(() => read().bend),
  };
}

// --- gamepad ---------------------------------------------------------------

// Buttons by the names on the plastic, in standard-mapping order. Both label
// sets point at the same index — the mapping is what makes an Xbox pad and a
// DualShock agree — so a sketch can say whichever it's holding.
const BUTTONS = {
  a: 0, cross: 0,
  b: 1, circle: 1,
  x: 2, square: 2,
  y: 3, triangle: 3,
  lb: 4, l1: 4,
  rb: 5, r1: 5,
  lt: 6, l2: 6,
  rt: 7, r2: 7,
  back: 8, select: 8, share: 8,
  start: 9, options: 9,
  l3: 10, r3: 11,
  up: 12, down: 13, left: 14, right: 15,
  home: 16, ps: 16,
};

// Sticks drift, so a raw axis is never quite zero and anything it drives never
// quite settles. Past the threshold the rest of the travel is rescaled to keep
// the full 0..1 reach.
const dead = (v, dz) => {
  const m = Math.abs(v);
  return m < dz ? 0 : Math.sign(v) * ((m - dz) / (1 - dz));
};

const poll = () => navigator.getGamepads?.() ?? [];

// getGamepads() builds a fresh snapshot on every call, so it's read once per
// frame however many signals are looking at it. NaN starts the cache cold —
// no real t can match it.
let padFrame = { t: NaN, pads: [] };
function pads(t) {
  if (t !== padFrame.t) padFrame = { t, pads: poll() };
  return padFrame.pads;
}

let warnedNoPad = false;
// The slots are sparse and one empties when a pad sleeps, so a bare gamepad()
// takes the first pad actually there rather than slot 0.
function padAt(t, index) {
  const list = pads(t);
  const p = index == null ? [...list].filter(Boolean)[0] : list[index];
  if (!p && !warnedNoPad) {
    warnedNoPad = true;
    warn('gamepad: none connected — press a button on it (browsers hide a pad until it sends something)');
  }
  return p ?? null;
}

export function gamepadHandle(index, o = {}, onLearn) {
  const dz = o.deadzone ?? 0.08;
  const axis = (i, flip) => sig((t) => {
    const p = padAt(t, index);
    return p ? dead(p.axes[i] ?? 0, dz) * (flip ? -1 : 1) : 0;
  });
  const trigger = (i) => sig((t) => {
    const p = padAt(t, index);
    // triggers report analog travel in .value; a digital pad only has .pressed
    const b = p?.buttons[i];
    return b ? (b.value || (b.pressed ? 1 : 0)) : 0;
  });
  return {
    // y flipped so up is positive, the way mouse('y') reads
    lx: axis(0, false), ly: axis(1, true),
    rx: axis(2, false), ry: axis(3, true),
    lt: trigger(6), rt: trigger(7),
    btn(name) {
      if (name == null) {
        onLearn?.('btn');
        return sig(() => 0);
      }
      const i = typeof name === 'number' ? Math.round(name) : BUTTONS[String(name).toLowerCase()];
      if (i == null) {
        warn(`gamepad: no button '${name}' — try a, b, x, y, up, down, left, right, lb, rb, start`);
        return sig(() => 0);
      }
      return sig((t) => {
        const b = padAt(t, index)?.buttons[i];
        return b?.pressed ? 1 : 0;
      });
    },
  };
}

// --- learn -----------------------------------------------------------------
//
// The editor writes the numbers into the call, so what's bound is visible in
// the sketch and travels with it. Everything below only reports what moved;
// main.js owns the rewrite.

// Watch for the next control the named device sends, and hand back the
// arguments the call should be given. Returns a disarm fn.
export function learnMidi(kind, device, done) {
  ensureMidi();
  const want = device == null ? null : String(device).toLowerCase();
  learnHook = (port, data) => {
    if (want && !(port.name ?? '').toLowerCase().includes(want)) return;
    const status = data[0];
    const type = status & 0xf0;
    const ch = (status & 0x0f) + 1;
    if (kind === 'cc') {
      // a knob at rest sends nothing, so the first CC to arrive is the one
      // being turned — no threshold needed
      if (type !== 0xb0) return;
      done(`${data[1]}, ${ch}`, `cc ${data[1]} on channel ${ch}`);
    } else {
      if (type !== 0x90 || (data[2] ?? 0) === 0) return;
      done(`${data[1]}`, `key ${data[1]}`);
    }
  };
  return () => { learnHook = null; };
}

// Same for a pad, which has to be polled: hold the frame's button states and
// fire on the first one that goes down.
export function learnPad(index, done) {
  let prev = null;
  let raf = 0;
  const tick = () => {
    raf = requestAnimationFrame(tick);
    const list = poll();
    const p = index == null ? [...list].filter(Boolean)[0] : list[index];
    if (!p) return;
    const now = p.buttons.map((b) => (b.pressed ? 1 : 0));
    if (prev) {
      const i = now.findIndex((v, j) => v && !prev[j]);
      if (i >= 0) {
        // the index is what the pad reports; the name is what reads back
        const name = Object.keys(BUTTONS).find((k) => BUTTONS[k] === i);
        done(name ? `'${name}'` : `${i}`, name ? `button ${name}` : `button ${i}`);
        return;
      }
    }
    prev = now;
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}
