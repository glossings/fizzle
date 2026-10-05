// Live text from a URL: what feed() hands back, and what text({ url }) draws.
//
// One connection per URL, shared by every call that names it and held on the
// engine across re-runs — so ctrl+enter doesn't blank what's on screen while a
// stream reconnects, and two calls reading the same feed cost one connection.
//
// An event stream pushes; anything else is fetched once, or polled. Which one
// it is comes from the response's Content-Type rather than from the sketch,
// since the sketch shouldn't have to know what a server it's pointed at does.
import { sig } from './audio.js';
import { warn, note } from './warn.js';

const EMPTY = { text: '' };
const MAX_BACKOFF = 10;

// A frame is whatever the producer sent, with `text` and `ranges` being the two
// keys we also know how to draw. A string body is that object's text; a JSON
// object is the object, so anything else it carries stays reachable. Nothing is
// invented: JSON with no text to draw says so (once, naming what it did send)
// rather than stringifying itself into glyphs.
export function parseFrame(body, ct, pick, url) {
  const s = body.trim();
  let v = body;
  // dev servers mislabel JSON as text/plain constantly, so shape gets a vote
  if (/json/i.test(ct) || s.startsWith('{') || s.startsWith('[')) {
    try { v = JSON.parse(s); } catch { v = body; }
  }
  if (typeof v === 'string') return { text: v };
  if (typeof v === 'number' || typeof v === 'boolean') return { text: String(v) };
  if (Array.isArray(v)) return { text: v.map((x) => (typeof x === 'string' ? x : '')).join('\n') };
  if (!v || typeof v !== 'object') return { text: '' };
  const f = { ...v };
  if (pick != null) f.text = v[pick];
  if (typeof f.text !== 'string') {
    if (f.text == null) {
      const keys = Object.keys(v).join(', ');
      warn(
        `feed "${url}": the JSON has no text to draw — pick the field that holds it with pick: 'name'${keys ? ` (it sent: ${keys})` : ''}`
      );
      return f;
    }
    f.text = String(f.text);
  }
  return f;
}

// [start, end) character offsets into the text, as something safe to draw from:
// whole numbers, inside the string, low end first, empties dropped, sorted, and
// overlaps merged — a box drawn twice over one atom reads as a heavier box.
export function normRanges(raw, len) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const r of raw) {
    if (!Array.isArray(r)) continue;
    let a = Math.round(Number(r[0])), b = Math.round(Number(r[1]));
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    if (b < a) [a, b] = [b, a];
    a = Math.max(0, Math.min(len, a));
    b = Math.max(0, Math.min(len, b));
    if (b > a) out.push([a, b]);
  }
  out.sort((x, y) => x[0] - y[0]);
  const merged = [];
  for (const r of out) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push(r);
  }
  return merged;
}

export const frameText = (f) => String(f?.text ?? '');

// How much of the text is marked, 0..1 — by characters, so it tracks how much
// is sounding rather than how many separate atoms are.
export function markedFraction(f) {
  const text = frameText(f);
  if (!text.length) return 0;
  let n = 0;
  for (const [a, b] of normRanges(f?.ranges, text.length)) n += b - a;
  return n / text.length;
}

// slice() and invert() exist because they're the two transforms that have to
// move the offsets with the string: cut the text by hand and every range past
// the cut points at the wrong characters.
export function sliceFrame(f, a, b) {
  const text = frameText(f);
  const n = text.length;
  const at = (v, dflt) => {
    if (v == null) return dflt;
    const i = Math.round(Number(v));
    if (!Number.isFinite(i)) return dflt;
    return i < 0 ? Math.max(0, n + i) : Math.min(n, i);
  };
  const s = at(a, 0);
  const e = Math.max(s, at(b, n));
  return {
    ...f,
    text: text.slice(s, e),
    ranges: normRanges(f?.ranges, n)
      .map(([x, y]) => [Math.max(x, s) - s, Math.min(y, e) - s])
      .filter(([x, y]) => y > x),
  };
}

export function invertFrame(f) {
  const text = frameText(f);
  const n = text.length;
  const out = [];
  let p = 0;
  for (const [a, b] of normRanges(f?.ranges, n)) {
    if (a > p) out.push([p, a]);
    p = b;
  }
  if (p < n) out.push([p, n]);
  return { ...f, text, ranges: out };
}

// --- the connection ---------------------------------------------------------

// Loopback and private addresses are the case worth recognising: since Chrome
// 142 an https page reaching one is a Local Network Access request, which the
// browser gates behind a permission. A refused fetch then looks exactly like a
// server that isn't running, and the fix is nothing to do with the sketch.
const LOCAL_RE = /^(localhost|127\.|\[?::1\]?|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i;

async function localNetworkBlocked(url) {
  let host;
  try { host = new URL(url, location.href).hostname; } catch { return false; }
  if (!LOCAL_RE.test(host)) return false;
  if (location.protocol !== 'https:') return false;
  for (const name of ['loopback-network', 'local-network']) {
    try {
      const p = await navigator.permissions.query({ name });
      if (p.state === 'granted') return false;
    } catch { /* a browser without the permission doesn't gate on it */ }
  }
  return true;
}

async function failed(f, e) {
  if (f.stop) return;
  const why = e?.message ?? String(e);
  if (await localNetworkBlocked(f.url)) {
    warn(
      `feed "${f.url}": the browser is blocking this page from reaching a local address — allow local network access for this site (the address has to be an IP literal like 127.0.0.1, not localhost)`
    );
  } else {
    // a feed that was up and went down is the ordinary case mid-set (the
    // server got restarted), so it's a note, not a warning on screen
    if (f.frame) note(`feed "${f.url}": ${why} — holding the last frame`);
    else warn(`feed "${f.url}": ${why}`);
  }
  if (f.stop) return;
  const wait = Math.min(MAX_BACKOFF, 2 ** f.tries++);
  f.timer = setTimeout(() => open(f), wait * 1000);
}

function take(f, body, ct) {
  const frame = parseFrame(body, ct, f.pick, f.url);
  if (frame) f.frame = frame;
}

function stream(f) {
  const es = new EventSource(f.url);
  f.es = es;
  es.onmessage = (e) => {
    try { take(f, e.data, 'application/json'); } catch (err) { note(`feed "${f.url}": ${err.message}`); }
  };
  es.onopen = () => { f.tries = 0; };
  es.onerror = () => {
    // EventSource reconnects on its own while it stays open; a closed one
    // failed in a way it won't retry (CORS, a 404), which is ours to retry
    if (f.stop || es.readyState !== EventSource.CLOSED) return;
    f.es = null;
    failed(f, new Error('the stream closed'));
  };
}

async function open(f) {
  if (f.stop) return;
  f.timer = null;
  try {
    // no custom headers: an Accept of our own would turn this into a
    // preflighted request for no gain
    const r = await fetch(f.url, { cache: 'no-store' });
    if (f.stop) return;
    if (!r.ok) {
      r.body?.cancel();
      throw new Error(`HTTP ${r.status}`);
    }
    const ct = r.headers.get('content-type') ?? '';
    if (/event-stream/i.test(ct)) {
      // headers are all this fetch was for; EventSource opens the real one and
      // owns the reconnecting from here
      r.body?.cancel();
      stream(f);
      return;
    }
    take(f, await r.text(), ct);
    f.tries = 0;
    if (f.poll) f.timer = setTimeout(() => open(f), f.poll * 1000);
  } catch (e) {
    await failed(f, e);
  }
}

export function closeFeed(f) {
  f.stop = true;
  if (f.timer) clearTimeout(f.timer);
  f.es?.close();
}

// Shared per URL. `gen` is the run that last asked for it, which is what lets
// the engine drop a connection the sketch no longer names (see reapCaptures).
export function ensureFeed(engine, url, o = {}) {
  const key = String(url);
  let f = engine.feeds.get(key);
  if (!f) {
    f = { url: key, frame: null, pick: null, poll: 0, es: null, timer: null, tries: 0, stop: false };
    engine.feeds.set(key, f);
    f.pick = o.pick != null ? String(o.pick) : null;
    f.poll = Number(o.poll) > 0 ? Number(o.poll) : 0;
    open(f);
  } else {
    // one connection, so the live call's reading of it wins — editing pick
    // mid-set re-reads the frame already in hand
    if (o.pick != null) f.pick = String(o.pick);
    if (o.poll != null) f.poll = Number(o.poll) > 0 ? Number(o.poll) : 0;
  }
  f.gen = engine.patchGen;
  return f;
}

// feed(url) — the frame as a callable: f(t) is whatever arrived last, with
// .text/.ranges as the fns of t a parameter wants and .marked as a signal.
// .slice()/.invert() hand back the same shape, so they compose and go straight
// into text({ text, ranges }).
export function makeFeed(engine, url, o = {}) {
  if (url != null && typeof url === 'object' && !Array.isArray(url)) { o = url; url = o.url; }
  if (typeof url === 'function') {
    warn('feed: the url is a string, not a fn of t — one feed is one connection. select() switches between two of them.');
    url = null;
  }
  if (url == null || !String(url).trim()) {
    warn("feed: needs a url — feed('http://127.0.0.1:4000/api/events')");
    return frameView(() => EMPTY);
  }
  const rec = ensureFeed(engine, url, o);
  return frameView(() => rec.frame ?? EMPTY);
}

export function frameView(get) {
  const f = (t) => get();
  f.text = () => frameText(get());
  f.ranges = () => {
    const frame = get();
    return normRanges(frame?.ranges, frameText(frame).length);
  };
  f.marked = sig(() => markedFraction(get()));
  f.slice = (a, b) => frameView(() => sliceFrame(get(), a, b));
  f.invert = () => frameView(() => invertFrame(get()));
  return f;
}
