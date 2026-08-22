// Tempo inference for the audio manager's auto button. Onsets come from
// positive spectral flux with an adaptive threshold (the kicks() idea, on the
// whole spectrum); the estimate scores a comb of candidate periods against
// the recent inter-onset intervals, so a missed beat still votes for the
// right tempo through its double.
//
// Module state like bands.js: the engine steps it every frame, so auto keeps
// tracking with the manager closed, and the manager reads the same tracker
// for its readout.

export const tempoState = {
  auto: false,
  apply: null, // (bpm) => {} — the manager points this at settings + engine
  estimate: 0, // latest estimate, whether or not it was confident enough
  confidence: 0,
  onsets: 0, // how many the window holds — the manager's listening readout
};

const WINDOW = 14; // seconds of onsets an estimate looks at
// the comb searches wide — hats put onsets on the eighth grid, so the raw
// winner is often the doubled tempo — and the answer folds down to a
// danceable octave
const BPM_LO = 55, BPM_HI = 400, BPM_FOLD = 180;
export const CONF = 0.3; // comb score (0..1 of total interval weight) worth acting on

const s = {
  prev: null, // last frame's spectrum, for the flux difference
  avg: 0, // flux baseline
  dev: 0, // flux deviation — the threshold scales with the signal
  lastStep: 0,
  lastOnset: 0,
  times: [], // onset wall-clock times within WINDOW
  lastEst: 0,
  stable: 0, // running blend of agreeing estimates
  agree: 0, // how many in a row agreed
};

const reset = () => {
  s.prev = null;
  s.times.length = 0;
  s.avg = 0;
  s.dev = 0;
  s.agree = 0;
  tempoState.estimate = 0;
  tempoState.confidence = 0;
  tempoState.onsets = 0;
};

// one step per rendered frame, beside updateBands
export function updateTempo(ae) {
  if (!tempoState.auto) {
    if (s.prev) reset();
    return;
  }
  if (!ae?.running || !ae.spectrum) return;
  const now = performance.now() / 1000;
  const dt = s.prev ? Math.min(now - s.lastStep, 0.25) : 0;
  s.lastStep = now;
  const spec = ae.spectrum;
  if (!s.prev || s.prev.length !== spec.length) {
    s.prev = Float32Array.from(spec);
    return;
  }
  // positive flux over the sub-8k bins, where the beat lives; the analyser's
  // smoothing damps the absolute size, so the threshold is the baseline plus
  // deviations rather than any fixed number
  const nb = Math.min(spec.length, Math.ceil(8000 / ae.binHz));
  let flux = 0;
  for (let i = 0; i < nb; i++) {
    const d = spec[i] - s.prev[i];
    if (d > 0) flux += d;
  }
  s.prev.set(spec);
  flux /= nb;
  const k = Math.min(1, dt / 1.5);
  s.avg += (flux - s.avg) * k;
  s.dev += (Math.abs(flux - s.avg) - s.dev) * k;
  // the refractory keeps one hit from counting twice; 0.12s still clears
  // sixteenths at 120
  if (flux > s.avg + Math.max(2 * s.dev, 5e-4) && now - s.lastOnset > 0.12) {
    s.lastOnset = now;
    s.times.push(now);
  }
  while (s.times.length && s.times[0] < now - WINDOW) s.times.shift();
  tempoState.onsets = s.times.length;
  if (now - s.lastEst > 0.5) {
    s.lastEst = now;
    estimate();
  }
}

function estimate() {
  const o = s.times;
  tempoState.confidence = 0;
  if (o.length < 8) return;
  // intervals between neighbors, plus skip-one pairs at half weight to
  // bridge a missed beat
  const ivs = [];
  for (let i = 1; i < o.length; i++) {
    const a = o[i] - o[i - 1];
    if (a > 0.2 && a < 2.5) ivs.push([a, 1]);
    if (i > 1) {
      const b = o[i] - o[i - 2];
      if (b > 0.2 && b < 2.5) ivs.push([b, 0.5]);
    }
  }
  let total = 0;
  for (const [, w] of ivs) total += w;
  if (!total) return;
  // comb score: an interval supports the candidates it's a near-multiple of,
  // higher multiples discounted so the fundamental outranks its halvings
  let bestBpm = 0, bestScore = 0;
  for (let bpm = BPM_LO; bpm <= BPM_HI; bpm += 0.5) {
    const P = 60 / bpm;
    let score = 0;
    for (const [iv, w] of ivs) {
      const m = Math.round(iv / P);
      if (m < 1 || m > 4) continue;
      const err = Math.abs(iv - m * P) / (P * 0.12); // within 12% of a period
      if (err < 1) score += (w * (1 - err)) / Math.sqrt(m);
    }
    // mild pull toward mid tempos, breaking octave ties
    score *= 1 - Math.abs(bpm - 120) / 400;
    if (score > bestScore) {
      bestScore = score;
      bestBpm = bpm;
    }
  }
  if (!bestBpm) return;
  // refine: average the intervals that actually hit the winning comb
  const P = 60 / bestBpm;
  let sw = 0, sp = 0;
  for (const [iv, w] of ivs) {
    const m = Math.round(iv / P);
    if (m >= 1 && m <= 4 && Math.abs(iv - m * P) < P * 0.12) {
      sw += w;
      sp += (iv / m) * w;
    }
  }
  let bpm = sw ? 60 / (sp / sw) : bestBpm;
  while (bpm > BPM_FOLD) bpm /= 2; // an eighth-grid winner lands on its half
  tempoState.estimate = Math.round(bpm);
  tempoState.confidence = bestScore / total;
  if (tempoState.confidence < CONF) {
    s.agree = 0;
    return;
  }
  // act only on an estimate that holds up: three confident readings in a row
  // near each other, so one odd batch of onsets can't yank the tempo
  if (Math.abs(bpm - s.stable) < 2) {
    s.stable += (bpm - s.stable) * 0.3;
    if (++s.agree >= 3) tempoState.apply?.(Math.round(s.stable));
  } else {
    s.stable = bpm;
    s.agree = 1;
  }
}
