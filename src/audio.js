// Audio input as control signals. AudioEngine captures an input device (any
// channel count) and runs one analysis pass per rendered frame: per-channel
// RMS, a mono-mix RMS, and a normalized magnitude spectrum. Signals returned
// by audio()/kicks() are plain functions of t — they slot into every
// value-or-fn-of-t parameter — with chainable processing methods attached.

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
      const n = (this.channels =
        stream.getAudioTracks()[0]?.getSettings().channelCount ?? src.channelCount ?? 2);
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
      if (this.outputId != null) this.setOutput(this.outputId); // rewire passthrough
      window.dispatchEvent(new Event('td-audio-started')); // sidebar refreshes labels
    } catch (e) {
      console.warn(`td-livecode: audio input: ${e.message ?? e}`);
      this.running = false;
    } finally {
      this.starting = false;
    }
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
        console.warn(`td-livecode: audio output: ${e.message ?? e}`);
      }
    } else if (deviceId !== 'default') {
      console.warn('td-livecode: this browser cannot pick an output device; passing through to the default output');
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

// A signal is a callable fn of t with chainable processing. Stateful ops
// (smooth) advance on new t values and cache per t, so one node shared by
// several parameters steps exactly once per frame.
export function sig(fn, ae = null) {
  const f = (t) => fn(t);
  const mk = (g) => sig(g, ae);
  f.add = (v = 0) => mk((t) => f(t) + resolve(v, t));
  f.mul = (v = 1) => mk((t) => f(t) * resolve(v, t));
  f.pow = (v = 1) => mk((t) => Math.pow(Math.max(f(t), 0), resolve(v, t)));
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
