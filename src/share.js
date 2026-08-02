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
