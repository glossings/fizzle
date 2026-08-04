// Audio input as control signals. AudioEngine captures an input device (any
// channel count) and runs one analysis pass per rendered frame: per-channel
// RMS, a mono-mix RMS, and a normalized magnitude spectrum. Signals returned
// by audio() are plain functions of t — they slot into every
// value-or-fn-of-t parameter — with chainable processing methods attached.

import { warn } from './warn.js';

const resolve = (v, t) => (typeof v === 'function' ? v(t) : v);

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.stream = null;
    this.source = null;
    this.analysers = [];      // one per input channel
    this.monoAnalyser = null;
    this.levels = [];         // per-channel RMS, refreshed each frame
    this.level = 0;           // mono-mix RMS
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
      this.ctx ??= new AudioContext();
      this.ctx.resume(); // suspended until the page has had a user gesture
      this.source?.disconnect();
      const src = (this.source = this.ctx.createMediaStreamSource(stream));
      const n =
        stream.getAudioTracks()[0]?.getSettings().channelCount ?? src.channelCount ?? 2;
      this._wire(src, n);
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

  // Analyse (and play) a media element — the audiofile() path. The element
  // routes through the analyser graph and a gain to the speakers.
  startMedia(el, volume = 1) {
    this.ctx ??= new AudioContext();
    this.ctx.resume();
    const src = (this.source = this.ctx.createMediaElementSource(el));
    const out = (this.mediaGain = this.ctx.createGain());
    out.gain.value = volume;
    src.connect(out);
    out.connect(this.ctx.destination);
    this._wire(src, 2);
  }

  setVolume(v) {
    if (this.mediaGain) this.mediaGain.gain.value = Math.max(0, v);
  }

  // Pass the input through to an output device (null disables). Device
  // selection uses AudioContext.setSinkId — Chrome/Edge; elsewhere the
  // passthrough still works but only to the default output.
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

  // one pass per rendered frame, called by the engine (skipped while paused,
  // so audio-driven parameters freeze like everything else)
  update() {
    if (!this.running) return;
    // capture can start before the page's first user gesture (auto-run on
    // load); the context resumes as soon as the browser allows it
    if (this.ctx.state === 'suspended') this.ctx.resume();
    for (let i = 0; i < this.analysers.length; i++) {
      this.analysers[i].getFloatTimeDomainData(this.wave);
      this.levels[i] = AudioEngine.rms(this.wave);
    }
    const ma = this.monoAnalyser;
    ma.getFloatTimeDomainData(this.wave);
    this.level = AudioEngine.rms(this.wave);
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

// tempo for the .beat() signal helper — makeApi points this at the engine
let bpm = () => 120;
export const setBpmSource = (fn) => { bpm = fn; };

// A signal is a callable fn of t with chainable processing. Stateful ops
// (smooth/counter/beat) advance on new t values and cache per t, so one node
// shared by several parameters steps exactly once per frame.
export function sig(fn, ae = null) {
  const f = (t) => fn(t);
  const mk = (g) => sig(g, ae);
  f.add = (v = 0) => mk((t) => f(t) + resolve(v, t));
  f.sub = (v = 0) => mk((t) => f(t) - resolve(v, t));
  f.mul = (v = 1) => mk((t) => f(t) * resolve(v, t));
  // a moving divisor is why this can't be .mul(1 / v); the floor keeps a zero
  // one from handing Infinity to a uniform, the same guard ramp's period uses
  f.div = (v = 1) => mk((t) => {
    const d = resolve(v, t);
    return f(t) / (Math.abs(d) > 1e-6 ? d : (Math.sign(d) || 1) * 1e-6);
  });
  f.pow = (v = 1) => mk((t) => Math.pow(Math.max(f(t), 0), resolve(v, t)));
  // Rescale to a useful span. The input is assumed 0..1 — what every shaper,
  // rand() and audio() already produce — so `from` is only there for the
  // signals that aren't: raw trigonometry (-1..1) and mouse().
  // .range({ from, to }) names both ends when the positional pair reads worse.
  f.range = (min = 0, max = 1, o = {}) => {
    // .range([lo, hi]) is the same span the two positional args name — reading
    // it as an options object instead would make the call a silent no-op
    if (Array.isArray(min)) { o = { ...o, to: min }; }
    else if (min !== null && typeof min === 'object') { o = min; min = 0; max = 1; }
    const [f0, f1] = o.from ?? [0, 1];
    const [t0, t1] = o.to ?? [min, max];
    return mk((t) => {
      const a = resolve(f0, t), span = resolve(f1, t) - a;
      const u = span === 0 ? 0 : (f(t) - a) / span; // a zero-width source maps to the low end
      const lo = resolve(t0, t);
      return lo + u * (resolve(t1, t) - lo);
    });
  };
  // limit without rescaling — .range() is free to overshoot, this is the fence
  f.clamp = (lo = 0, hi = 1) =>
    mk((t) => Math.min(Math.max(f(t), resolve(lo, t)), resolve(hi, t)));
  f.round = () => mk((t) => Math.round(f(t)));
  f.floor = () => mk((t) => Math.floor(f(t)));
  f.ceil = () => mk((t) => Math.ceil(f(t)));
  f.abs = () => mk((t) => Math.abs(f(t)));
  // comparisons -> 1/0 gates, ready for .when()/.counter()
  f.gte = (v) => mk((t) => (f(t) >= resolve(v, t) ? 1 : 0));
  f.lte = (v) => mk((t) => (f(t) <= resolve(v, t) ? 1 : 0));
  // rising-edge counter: +1 each time the value crosses up through threshold
  // (a kicks() hit, a gate opening); wraps at max
  f.counter = (max = Infinity, threshold = 0.5) => {
    let n = 0, prev = Infinity, lastT = null;
    return mk((t) => {
      if (t === lastT) return n;
      lastT = t;
      const x = f(t);
      if (x >= threshold && prev < threshold && Number.isFinite(x)) {
        n = Number.isFinite(max) ? (n + 1) % Math.max(1, Math.round(max)) : n + 1;
      }
      prev = x;
      return n;
    });
  };
  // index an array by the value (floored, wrapped) — items may be fns of t,
  // and non-numeric items (colors, strings) are fine
  f.select = (arr) => mk((t) => {
    const i = ((Math.floor(f(t)) % arr.length) + arr.length) % arr.length;
    return resolve(arr[i], t);
  });
  // waveshapes: treat the value as a phase ramp (beat(), or anything);
  // one cycle per whole unit, all outputs 0..1
  f.sin = () => mk((t) => 0.5 + 0.5 * Math.sin(f(t) * Math.PI * 2));
  f.tri = () => mk((t) => 1 - Math.abs(2 * frac(f(t)) - 1));
  f.saw = () => mk((t) => frac(f(t)));
  f.sqr = (width = 0.5) => mk((t) => (frac(f(t)) < resolve(width, t) ? 1 : 0));
  // tempo-synced sample-and-hold: freeze a new value of this signal at the
  // start of every `div` beats — rand().beat(4) resamples once per bar
  f.beat = (div = 1) => {
    let cycle = null, held = 0, lastT = null;
    return mk((t) => {
      if (t === lastT) return held;
      lastT = t;
      const c = Math.floor((t * bpm()) / 60 / resolve(div, t));
      if (c !== cycle) { cycle = c; held = f(t); }
      return held;
    });
  };
  // sample-and-hold driven by another signal: freeze the current value each
  // time the trigger crosses up through threshold (a kicks() hit, a gate)
  f.hold = (trigger, threshold = 0.5) => {
    let held = null, prev = Infinity, lastT = null;
    return mk((t) => {
      if (t === lastT) return held;
      lastT = t;
      const x = resolve(trigger, t);
      if (held == null || (x >= threshold && prev < threshold)) held = f(t);
      prev = x;
      return held;
    });
  };
  // adaptive onset detector on this signal: fires 1 when the value jumps
  // past threshold × its own moving average (and above floor), then decays
  // exponentially. Feed it a band for percussion: .bandpass(30, 160).kicks()
  f.kicks = ({ threshold = 1.5, decay = 6, floor = 0.05 } = {}) => {
    let avg = 0, env = 0, lastT = null, cool = 0;
    return mk((t) => {
      if (t === lastT) return env;
      const dt = lastT == null ? 0 : Math.max(t - lastT, 0);
      lastT = t;
      const e = f(t);
      avg += (e - avg) * Math.min(1, dt * 2); // ~0.5s adaptive baseline
      cool = Math.max(0, cool - dt);
      if (cool <= 0 && e > floor && e > avg * resolve(threshold, t)) {
        env = 1;
        cool = 0.15; // refractory: one hit can't retrigger itself
      } else {
        env *= Math.exp(-resolve(decay, t) * dt);
      }
      return env;
    });
  };
  // exponential lag (one-pole lowpass on the control value); up/down are
  // attack/release time constants in seconds
  f.smooth = (up = 0.15, down = up) => {
    let s = 0, lastT = null;
    return mk((t) => {
      if (t === lastT) return s;
      const dt = lastT == null ? 0 : Math.max(t - lastT, 0);
      lastT = t;
      const x = f(t);
      const tau = x > s ? resolve(up, t) : resolve(down, t);
      s = tau > 0 ? s + (x - s) * (1 - Math.exp(-dt / tau)) : x;
      return s;
    });
  };
  if (ae) {
    // spectral energy of the audio source (0..1) — reads the input's
    // spectrum, not the chained value
    f.lowpass = (hz = 200) => mk((t) => ae.band(0, resolve(hz, t)));
    f.highpass = (hz = 2000) => mk((t) => ae.band(resolve(hz, t), 20000));
    f.bandpass = (lo = 200, hi = 2000) => mk((t) => ae.band(resolve(lo, t), resolve(hi, t)));
  }
  return f;
}
