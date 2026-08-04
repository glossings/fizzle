// Sketch code ↔ URL hash, so patches survive a refresh and can be shared as
// plain links (no server, no database). Format: '#z=<base64url>' where the
// payload is deflate-raw compressed UTF-8; '#c=<base64url>' is the uncompressed
// fallback for browsers without CompressionStream.

function toB64url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function fromB64url(s) {
  const bin = atob(s.replaceAll('-', '+').replaceAll('_', '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function pipe(bytes, stream) {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export async function codeToHash(code) {
  const bytes = new TextEncoder().encode(code);
  try {
    return 'z=' + toB64url(await pipe(bytes, new CompressionStream('deflate-raw')));
  } catch {
    return 'c=' + toB64url(bytes);
  }
}

// The address bar mirrors the code, so it's always a shareable link and a
// refresh recovers the last-run sketch. Explicit runs push an entry instead of
// replacing one, which is what makes back/forward step through the sketches you
// actually ran — coarser than the editor's own ctrl+z, and a separate stack.
let current = null; // what the address bar will say once `pending` settles
let pending = Promise.resolve(); // await before reading location.href
let serial = 0; // encoding is async; only the newest result may land

export function syncHash(code, push = false) {
  // unchanged code must not push: it would cost a back-press and land nowhere
  if (code === current) return pending;
  current = code;
  const mine = ++serial;
  pending = codeToHash(code).then((h) => {
    if (mine !== serial) return; // a newer sync overtook this encode
    history[push ? 'pushState' : 'replaceState'](null, '', '#' + h);
  });
  return pending;
}

// A back/forward landed on `code`: adopt it as the address bar's contents
// without writing history, so the run that follows doesn't push the entry we
// just navigated away from straight back on.
export function adoptHash(code) {
  current = code;
  serial++; // and drops any encode still in flight from before the navigation
}

export async function codeFromHash(hash = location.hash) {
  const m = /^#(z|c)=([\w-]+)$/.exec(hash);
  if (!m) return null;
  try {
    let bytes = fromB64url(m[2]);
    if (m[1] === 'z') bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
    return new TextDecoder().decode(bytes);
  } catch {
    return null; // malformed/truncated link — fall back to stored sketch
  }
}
