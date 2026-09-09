// Audio input as control signals. AudioEngine captures an input device (any
// channel count) and runs one analysis pass per rendered frame: per-channel
// and mono-mix loudness (RMS on a dB scale, 0..1), and a normalized magnitude
// spectrum. Signals returned by audio() are plain functions of t — they slot
// into every value-or-fn-of-t parameter — with chainable processing methods
// attached.

import { warn } from './warn.js';
import { carried } from './carry.js';

const resolve = (v, t) => (typeof v === 'function' ? v(t) : v);

// One context for every source. Nodes can't be connected across contexts, so
// this is what lets a recording take all of them through a single tap; and
// setSinkId being per-context is what makes the sidebar's output device mean
// where all of fizzle's sound goes rather than the mic passthrough alone.
let ctx = null;
const context = () => (ctx ??= new AudioContext());

// The recording tap. Every source feeds it whether anything is recording or
// not: a MediaRecorder fixes its tracks when it's constructed, so a take that
// started before the sketch called audio() can only pick that audio up if the
// track was already there, silent, waiting for something to arrive on it.
let tapNode = null;
const tap = () => (tapNode ??= context().createMediaStreamDestination());

// for the recording log: a context that isn't running is a recording that
// isn't writing (see record.js)
export const audioState = () => ctx?.state ?? 'none';

export function audioTap() {
  const stream = tap().stream;
  context().resume(); // called from the gesture that started the take
  return stream;
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.stream = null;
    this.source = null;
    this.analysers = [];      // one per input channel
    this.monoAnalyser = null;
    this.levels = [];         // per-channel loudness, refreshed each frame
    this.level = 0;           // mono-mix loudness
    this.spectrum = null;     // per-bin magnitude, normalized 0..1
    this.binHz = 1;
    this.channels = 0;
    this.starting = false;
    this.running = false;
    this.monitor = null;      // gain node wiring input -> output (passthrough)
    this.outputId = null;     // null = passthrough off, 'default' or a deviceId
  }

  async start(deviceId) {
    if (this.starting) return;
    this.starting = true;
    try {
      this.stream?.getTracks().forEach((t) => t.stop());
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      this.stream = stream;
      this.ctx = context();
      this.ctx.resume(); // suspended until the page has had a user gesture
      this.source?.disconnect();
      const src = (this.source = this.ctx.createMediaStreamSource(stream));
      const n =
        stream.getAudioTracks()[0]?.getSettings().channelCount ?? src.channelCount ?? 2;
      this._wire(src, n);
      // the input as it arrives, not the analysis mono-mix. More than two
      // channels in and the tap takes the first pair, which on an interface is
      // the main output pair.
      src.connect(tap());
      if (this.outputId != null) this.setOutput(this.outputId); // rewire passthrough
      window.dispatchEvent(new Event('td-audio-started')); // sidebar refreshes labels
    } catch (e) {
      warn(`audio input: ${e.message ?? e}`);
      this.running = false;
    } finally {
      this.starting = false;
    }
  }

  // splitter + per-channel analysers + mono-mix analyser off any source node
  _wire(src, n) {
    this.channels = n;
    const splitter = this.ctx.createChannelSplitter(n);
    src.connect(splitter);
    this.analysers = [];
    for (let i = 0; i < n; i++) {
      const a = this.ctx.createAnalyser();
      a.fftSize = 2048;
      a.smoothingTimeConstant = 0;
      splitter.connect(a, i);
      this.analysers.push(a);
    }
    // mono mix: splitter outputs sum when wired to one input; scale by 1/n
    const mono = this.ctx.createGain();
    mono.gain.value = 1 / n;
    for (let i = 0; i < n; i++) splitter.connect(mono, i, 0);
    const ma = (this.monoAnalyser = this.ctx.createAnalyser());
    ma.fftSize = 2048;
    ma.smoothingTimeConstant = 0.5; // steadies the spectrum; RMS unaffected
    mono.connect(ma);
    this.wave = new Float32Array(ma.fftSize);
    this.freq = new Float32Array(ma.frequencyBinCount);
    this.spectrum = new Float32Array(ma.frequencyBinCount);
    this.levels = new Array(n).fill(0);
    this.binHz = this.ctx.sampleRate / ma.fftSize;
    this.running = true;
  }

  // Analyze (and play) a media element — the audiofile() path. The element
  // routes through the analyser graph and a gain to the speakers.
  startMedia(el, volume = 1) {
    this.ctx = context();
    this.ctx.resume();
    const src = (this.source = this.ctx.createMediaElementSource(el));
    const out = (this.mediaGain = this.ctx.createGain());
    out.gain.value = volume;
    src.connect(out);
    out.connect(this.ctx.destination);
    out.connect(tap()); // after the gain, so the file gets what you hear
    this._wire(src, 2);
  }

  setVolume(v) {
    if (this.mediaGain) this.mediaGain.gain.value = Math.max(0, v);
  }

  // Pass the input through to an output device (null disables). Device
  // selection uses AudioContext.setSinkId — Chrome/Edge; elsewhere the
  // passthrough still works but only to the default output. The context is
  // shared, so the device chosen here is also where audiofile() plays.
  async setOutput(deviceId) {
    this.outputId = deviceId;
    if (!this.ctx || !this.source) return; // applied when capture starts
    if (deviceId == null) {
      this.monitor?.disconnect();
      return;
    }
    this.monitor ??= this.ctx.createGain();
    this.source.connect(this.monitor);
    this.monitor.connect(this.ctx.destination);
    if (this.ctx.setSinkId) {
      try {
        await this.ctx.setSinkId(deviceId === 'default' ? '' : deviceId);
      } catch (e) {
        warn(`audio output: ${e.message ?? e}`);
      }
    } else if (deviceId !== 'default') {
      warn('this browser cannot pick an output device; passing through to the default output');
    }
  }

  stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.source?.disconnect();
    this.running = false;
    this.level = 0;
    this.levels.fill(0);
    this.spectrum?.fill(0);
  }

  static rms(buf) {
    let s = 0;
    for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    return Math.sqrt(s / buf.length);
  }

  // RMS -> 0..1 on a dB scale, -60..0 dBFS — the meter convention, and the
  // same treatment the spectrum gets from the analyser's dB window. Linear
  // RMS puts ordinary music at 0.01-0.1, useless as a control value; in dB
  // it reads mid-scale and the manager's anchors do the rest.
  static loudness(buf) {
    const rms = AudioEngine.rms(buf);
    if (rms <= 1e-3) return 0; // -60 dBFS and below
    return Math.min(1, 1 + (20 * Math.log10(rms)) / 60);
  }

  // one pass per rendered frame, called by the engine (skipped while paused,
  // so audio-driven parameters freeze like everything else)
  update() {
    if (!this.running) return;
    // capture can start before the page's first user gesture (auto-run on
    // load); the context resumes as soon as the browser allows it
    if (this.ctx.state === 'suspended') this.ctx.resume();
    for (let i = 0; i < this.analysers.length; i++) {
      this.analysers[i].getFloatTimeDomainData(this.wave);
      this.levels[i] = AudioEngine.loudness(this.wave);
    }
    const ma = this.monoAnalyser;
    ma.getFloatTimeDomainData(this.wave);
    this.level = AudioEngine.loudness(this.wave);
    ma.getFloatFrequencyData(this.freq);
    const lo = ma.minDecibels, hi = ma.maxDecibels;
    for (let i = 0; i < this.freq.length; i++) {
      this.spectrum[i] = Math.min(1, Math.max(0, (this.freq[i] - lo) / (hi - lo)));
    }
  }

  // average normalized magnitude over [loHz, hiHz]
  band(loHz, hiHz) {
    if (!this.running || !this.spectrum) return 0;
    let b0 = Math.max(0, Math.floor(loHz / this.binHz));
    let b1 = Math.min(this.spectrum.length - 1, Math.ceil(hiHz / this.binHz));
    if (b1 < b0) [b0, b1] = [b1, b0];
    let s = 0;
    for (let i = b0; i <= b1; i++) s += this.spectrum[i];
    return s / (b1 - b0 + 1);
  }
}

const frac = (x) => x - Math.floor(x);

// deterministic smooth value noise of x, 0..1 — the signal-space cousin of
// the noise() texture (exposed in sketches as rand())
const hash = (i) => frac(Math.sin(i * 127.1 + 311.7) * 43758.5453);
export function valueNoise(x) {
  const i = Math.floor(x), u = x - i, s = u * u * (3 - 2 * u);
  return hash(i) * (1 - s) + hash(i + 1) * s;
}

// tempo for beat(), B and .beat() — makeApi points this at the engine
let bpm = () => 120;
export const setBpmSource = (fn) => { bpm = fn; };

// Tempo position counted in note values: perBar cycles per bar of four beats,
// so 4 is quarter notes and 16 sixteenths. Whole part = which cycle, fraction
// = where in it. Shared by beat(), B and .beat().
const BEATS_PER_BAR = 4;
export const barPhase = (t, perBar) => (t * bpm() * perBar) / (60 * BEATS_PER_BAR);

// A signal is a callable fn of t with chainable processing. Stateful ops
// (smooth/counter/beat) advance on new t values and cache per t, so one node
// shared by several parameters steps exactly once per frame.
//
// That state lives in carry.js rather than in the closure, so it survives the
// re-run: a counter keeps its place in the palette and a smoothed level keeps
// its level while you edit the numbers around them.
//
// The methods live on Signal.prototype rather than on each signal, so a sketch
// can add one — `Signal.prototype.punch = function (n) { ... }` — the way it
// can with Texture and Geometry, and so `x instanceof Signal` answers. A
// signal is still a plain function underneath: typeof is 'function' and s(t)
// calls it, which is what every value-or-fn-of-t parameter is duck-typing on.
export function Signal() {}
Signal.prototype = Object.create(Function.prototype);
Signal.prototype.constructor = Signal;

// The audio engine a signal came from, for the spectral ops. A symbol so it
// stays off the enumerable surface a sketch (or a for..in) sees.
const AE = Symbol('audioEngine');

export function sig(fn, ae = null) {
  const f = (t) => fn(t);
  Object.setPrototypeOf(f, Signal.prototype);
  f[AE] = ae;
  return f;
}

// `s * 0.1` on a signal is NaN, and a NaN uniform is a black frame with no
// clue why. Say so, and hand back the value at t = 0 so the frame still
// renders — just without the motion. A string hint keeps the source text,
// which is what the dedupe keys read.
Signal.prototype[Symbol.toPrimitive] = function (hint) {
  if (hint === 'string') return Function.prototype.toString.call(this);
  warn('a signal is not a number — write s.mul(0.1), not s * 0.1');
  try { return this(0); } catch { return 0; }
};

// Chain onto this signal: same audio source, so .bandpass() still reads the
// spectrum however many ops down the chain it sits.
function mk(self, g) {
  return sig(g, self[AE]);
}

Signal.prototype.add = function (v = 0) {
  const self = this;
  return mk(self, (t) => self(t) + resolve(v, t));
};
Signal.prototype.sub = function (v = 0) {
  const self = this;
  return mk(self, (t) => self(t) - resolve(v, t));
};
Signal.prototype.mul = function (v = 1) {
  const self = this;
  return mk(self, (t) => self(t) * resolve(v, t));
};
// a moving divisor is why this can't be .mul(1 / v); the floor keeps a zero
// one from handing Infinity to a uniform, the same guard ramp's period uses
Signal.prototype.div = function (v = 1) {
  const self = this;
  return mk(self, (t) => {
    const d = resolve(v, t);
    return self(t) / (Math.abs(d) > 1e-6 ? d : (Math.sign(d) || 1) * 1e-6);
  });
};
Signal.prototype.pow = function (v = 1) {
  const self = this;
  return mk(self, (t) => Math.pow(Math.max(self(t), 0), resolve(v, t)));
};
// Rescale to a useful span. The input is assumed 0..1 — what every shaper,
// rand() and audio() already produce — so `from` is only there for the
// signals that aren't: raw trigonometry (-1..1) and mouse().
// .range({ from, to }) names both ends when the positional pair reads worse.
Signal.prototype.range = function (min = 0, max = 1, o = {}) {
  const self = this;
  // .range([lo, hi]) is the same span the two positional args name — reading
  // it as an options object instead would make the call a silent no-op
  if (Array.isArray(min)) { o = { ...o, to: min }; }
  else if (min !== null && typeof min === 'object') { o = min; min = 0; max = 1; }
  const [f0, f1] = o.from ?? [0, 1];
  const [t0, t1] = o.to ?? [min, max];
  return mk(self, (t) => {
    const a = resolve(f0, t), span = resolve(f1, t) - a;
    const u = span === 0 ? 0 : (self(t) - a) / span; // a zero-width source maps to the low end
    const lo = resolve(t0, t);
    return lo + u * (resolve(t1, t) - lo);
  });
};
// limit without rescaling — .range() is free to overshoot, this is the fence
Signal.prototype.clamp = function (lo = 0, hi = 1) {
  const self = this;
  return mk(self, (t) => Math.min(Math.max(self(t), resolve(lo, t)), resolve(hi, t)));
};
Signal.prototype.round = function () {
  const self = this;
  return mk(self, (t) => Math.round(self(t)));
};
Signal.prototype.floor = function () {
  const self = this;
  return mk(self, (t) => Math.floor(self(t)));
};
Signal.prototype.ceil = function () {
  const self = this;
  return mk(self, (t) => Math.ceil(self(t)));
};
Signal.prototype.abs = function () {
  const self = this;
  return mk(self, (t) => Math.abs(self(t)));
};
// comparisons -> 1/0 gates, ready for .when()/.counter()
Signal.prototype.gte = function (v) {
  const self = this;
  return mk(self, (t) => (self(t) >= resolve(v, t) ? 1 : 0));
};
Signal.prototype.lte = function (v) {
  const self = this;
  return mk(self, (t) => (self(t) <= resolve(v, t) ? 1 : 0));
};
// rising-edge counter: +1 each time the value crosses up through threshold
// (a kicks() hit, a gate opening); wraps at max
Signal.prototype.counter = function (max = Infinity, threshold = 0.5) {
  const self = this;
  const s = carried('counter', () => ({ n: 0, prev: Infinity, lastT: null }));
  return mk(self, (t) => {
    if (t === s.lastT) return s.n;
    s.lastT = t;
    const x = self(t);
    if (x >= threshold && s.prev < threshold && Number.isFinite(x)) {
      s.n = Number.isFinite(max) ? (s.n + 1) % Math.max(1, Math.round(max)) : s.n + 1;
    }
    s.prev = x;
    return s.n;
  });
};
// index an array by the value (floored, wrapped) — items may be fns of t,
// and non-numeric items (colors, strings) are fine
Signal.prototype.select = function (arr) {
  const self = this;
  return mk(self, (t) => {
    const i = ((Math.floor(self(t)) % arr.length) + arr.length) % arr.length;
    return resolve(arr[i], t);
  });
};
// waveshapes: treat the value as a phase ramp (beat(), or anything);
// one cycle per whole unit, all outputs 0..1
Signal.prototype.sin = function () {
  const self = this;
  return mk(self, (t) => 0.5 + 0.5 * Math.sin(self(t) * Math.PI * 2));
};
Signal.prototype.cos = function () {
  const self = this;
  return mk(self, (t) => 0.5 + 0.5 * Math.cos(self(t) * Math.PI * 2));
};
Signal.prototype.tri = function () {
  const self = this;
  return mk(self, (t) => 1 - Math.abs(2 * frac(self(t)) - 1));
};
Signal.prototype.saw = function () {
  const self = this;
  return mk(self, (t) => frac(self(t)));
};
Signal.prototype.sqr = function (width = 0.5) {
  const self = this;
  return mk(self, (t) => (frac(self(t)) < resolve(width, t) ? 1 : 0));
};
// tempo-synced sample-and-hold: freeze a new value of this signal perBar
// times a bar — rand().beat(4) resamples on every beat, .beat(1) once a bar.
// Shorthand for .hold(beat(perBar)), and the same code path, so the two
// can't drift; .hold() is there for a trigger that isn't the tempo.
Signal.prototype.beat = function (perBar = 4) {
  return this.hold(sig((t) => barPhase(t, resolve(perBar, t))).sqr(0.5));
};
// sample-and-hold driven by another signal: freeze the current value each
// time the trigger crosses up through threshold (a kicks() hit, a gate)
Signal.prototype.hold = function (trigger, threshold = 0.5) {
  const self = this;
  const s = carried('hold', () => ({ held: null, prev: Infinity, lastT: null }));
  return mk(self, (t) => {
    if (t === s.lastT) return s.held;
    s.lastT = t;
    const x = resolve(trigger, t);
    if (s.held == null || (x >= threshold && s.prev < threshold)) s.held = self(t);
    s.prev = x;
    return s.held;
  });
};
// adaptive onset detector on this signal: fires 1 when the value jumps
// past threshold × its own moving average (and above floor), then decays
// exponentially. Feed it a band for percussion: .bandpass(30, 160).kicks()
Signal.prototype.kicks = function ({ threshold = 1.5, decay = 6, floor = 0.05 } = {}) {
  const self = this;
  const s = carried('kicks', () => ({ avg: 0, env: 0, lastT: null, cool: 0 }));
  return mk(self, (t) => {
    if (t === s.lastT) return s.env;
    const dt = s.lastT == null ? 0 : Math.max(t - s.lastT, 0);
    s.lastT = t;
    const e = self(t);
    s.avg += (e - s.avg) * Math.min(1, dt * 2); // ~0.5s adaptive baseline
    s.cool = Math.max(0, s.cool - dt);
    if (s.cool <= 0 && e > floor && e > s.avg * resolve(threshold, t)) {
      s.env = 1;
      s.cool = 0.15; // refractory: one hit can't retrigger itself
    } else {
      s.env *= Math.exp(-resolve(decay, t) * dt);
    }
    return s.env;
  });
};
// exponential lag (one-pole lowpass on the control value); up/down are
// attack/release time constants in seconds
Signal.prototype.smooth = function (up = 0.15, down = up) {
  const self = this;
  const s = carried('smooth', () => ({ v: 0, lastT: null }));
  return mk(self, (t) => {
    if (t === s.lastT) return s.v;
    const dt = s.lastT == null ? 0 : Math.max(t - s.lastT, 0);
    s.lastT = t;
    const x = self(t);
    const tau = x > s.v ? resolve(up, t) : resolve(down, t);
    s.v = tau > 0 ? s.v + (x - s.v) * (1 - Math.exp(-dt / tau)) : x;
    return s.v;
  });
};

// Spectral energy of the audio source (0..1) — reads the input's spectrum,
// not the chained value. On the prototype like everything else, so a signal
// with no audio behind it says so rather than throwing.
function band(self, lo, hi) {
  const ae = self[AE];
  if (!ae) {
    warn('signal: .lowpass/.highpass/.bandpass need an audio source — try audio().lowpass(200)');
    return self;
  }
  return mk(self, (t) => ae.band(resolve(lo, t), resolve(hi, t)));
}
Signal.prototype.lowpass = function (hz = 200) { return band(this, 0, hz); };
Signal.prototype.highpass = function (hz = 2000) { return band(this, hz, 20000); };
Signal.prototype.bandpass = function (lo = 200, hi = 2000) { return band(this, lo, hi); };
