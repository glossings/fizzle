// Imported media files (video / image / audio / 3D model). The browser never
// exposes a real filesystem path for a dropped file, so files live as blobs in
// IndexedDB keyed by filename — sketches reference them by name
// (videofile('clip.mp4')) and the imports survive reloads. Names match
// exact-first, then case-insensitive substring, like camera/audio labels.

const DB_NAME = 'td-media';
const STORE = 'files';

let dbPromise;
function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'name' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const r = fn(d.transaction(STORE, mode).objectStore(STORE));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export const mediaPut = (file) =>
  tx('readwrite', (s) => s.put({ name: file.name, type: file.type, blob: file }));
export const mediaDelete = (name) => tx('readwrite', (s) => s.delete(name));
export const mediaList = () => tx('readonly', (s) => s.getAllKeys());

// `accept` narrows the search to filenames it approves of, so a substring
// lookup for a model can't land on the image of the same name
export async function mediaGet(name, accept) {
  const ok = (n) => !accept || accept(n);
  const exact = await tx('readonly', (s) => s.get(String(name)));
  if (exact && ok(exact.name)) return exact;
  const n = String(name).toLowerCase();
  const match = (await mediaList()).find((k) => k.toLowerCase().includes(n) && ok(k));
  return match ? tx('readonly', (s) => s.get(match)) : null;
}

export function classifyFile(file) {
  const ext = file.name.split('.').pop()?.toLowerCase();
  // models by extension first: .obj/.fbx arrive with an empty or made-up type
  if (['obj', 'fbx'].includes(ext)) return 'model';
  const t = file.type ?? '';
  if (t.startsWith('video/')) return 'video';
  if (t.startsWith('image/')) return 'image';
  if (t.startsWith('audio/')) return 'audio';
  // extension fallback — .mov/.mkv sometimes arrive with an empty type
  if (['mp4', 'mov', 'webm', 'm4v', 'mkv'].includes(ext)) return 'video';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp'].includes(ext)) return 'image';
  if (['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'].includes(ext)) return 'audio';
  return null;
}

// programmatic file picker (used by an empty videofile() etc.) — needs the
// transient user activation of the ctrl+enter that ran the sketch
export function pickFiles(kind, multiple = false) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept =
      { video: 'video/*', image: 'image/*', audio: 'audio/*', model: '.obj,.fbx' }[kind] ?? '';
    input.multiple = multiple;
    input.style.display = 'none';
    document.body.appendChild(input);
    const done = () => { resolve([...input.files]); input.remove(); };
    input.addEventListener('change', done);
    input.addEventListener('cancel', done);
    input.click();
  });
}

// editor snippet for a set of just-imported files; several images become an
// imageseq stepping once per beat, ready to retrigger with any counter
export function snippetFor(files) {
  const q = (f) => JSON.stringify(f.name);
  const imgs = files.filter((f) => classifyFile(f) === 'image');
  const parts = [];
  if (imgs.length > 1) parts.push(`imageseq([${imgs.map(q).join(', ')}], beat(1).counter())`);
  else if (imgs.length === 1) parts.push(`imagefile(${q(imgs[0])})`);
  for (const f of files) {
    const kind = classifyFile(f);
    if (kind === 'video') parts.push(`videofile(${q(f)})`);
    else if (kind === 'audio') parts.push(`audiofile(${q(f)})`);
    // a model is a geometry op, so it needs its .out() to show up at all
    else if (kind === 'model') parts.push(`model(${q(f)}).out()`);
  }
  return parts.join('\n');
}
