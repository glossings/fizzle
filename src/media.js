// Imported media files (video / image / audio / 3D model / HDRI). The browser
// never exposes a real filesystem path for a dropped file, so files live as
// blobs in IndexedDB keyed by filename — sketches reference them by name
// (videofile('clip.mp4')) and the imports survive reloads. Names match
// exact-first, then case-insensitive substring, like camera/audio labels.
//
// A file dropped as part of a folder keeps a "folder/file.jpg" key, so the
// dozen identically-named maps of a dozen PBR materials don't collide and one
// prefix names the whole set — see pbr.js.

import { classifySet, commonPrefix, IMAGE_RE } from './pbr.js';

const DB_NAME = 'td-media';
const STORE = 'files';

let dbPromise;
function db() {
  // Imported media only exists here — without persistence the browser may
  // quietly evict the whole store under disk pressure, after which sketches
  // say their files were never imported. Grant is silent; denial changes nothing.
  if (!dbPromise) navigator.storage?.persist?.().catch(() => {});
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

// Safari can't serialize a Blob that came from fetch() into IndexedDB — the
// put fails with "Error preparing Blob/File data to be stored in object store",
// which takes out every download on iOS. Anything that isn't a File is stored
// as its bytes instead and rebuilt on the way out. A dropped File stays a File:
// that's the case WebKit handles, and reading a 500 MB video into memory to
// dodge a bug it doesn't have would be its own problem.
const readable = (rec) =>
  !rec || rec.blob
    ? rec
    : { name: rec.name, type: rec.type, blob: new Blob([rec.data], { type: rec.type }) };

// `name` overrides the key — used for folder drops ('rock_2k/diff.jpg') and
// for downloads, which arrive as bare blobs with no name of their own
export async function mediaPut(file, name = file.name) {
  const rec =
    file instanceof File
      ? { name: String(name), type: file.type, blob: file }
      : { name: String(name), type: file.type, data: await file.arrayBuffer() };
  return tx('readwrite', (s) => s.put(rec));
}
export const mediaDelete = (name) => tx('readwrite', (s) => s.delete(name));

// A name can also say where the file came from: 'polyhaven:rock_2k'. Every
// lookup here uses the bare name, so on a machine that has the file the tag
// changes nothing — and on one that doesn't, it's enough to download the same
// asset instead of rendering untextured (see fetchPolyhaven). Which is how a
// shared sketch heals: URLs carry code, not files.
const PH_TAG = /^\s*polyhaven\s*:\s*/i;
export const isPolyhaven = (name) => PH_TAG.test(String(name));
// only a tagged name is trimmed — an untagged one is matched as typed, spaces
// and all, because a dropped file is allowed to have them
export const bareName = (name) => (isPolyhaven(name) ? String(name).replace(PH_TAG, '').trim() : String(name));

// A name can also be a URL, which heals the same way for any host instead of
// one API: imagefile('https://…/cat.jpg') sends the picture along with the
// code. The file is downloaded once and kept under the URL as its key, so
// later runs read it back like anything else that was dropped in — offline
// included.
const URL_RE = /^https?:\/\//i;
export const isUrl = (name) => URL_RE.test(String(name).trim());

// Types the download may have to supply itself: a host that answers
// application/octet-stream leaves the blob untyped, and an untyped blob URL
// won't play as a video or decode as an image.
const MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4',
};

// Memoized like bundledGet, so one URL used in two slots downloads once rather
// than racing itself.
const urlCache = new Map();
function urlGet(url) {
  let rec = urlCache.get(url);
  if (!rec) {
    rec = fetchUrl(url);
    rec.catch(() => urlCache.delete(url)); // a failed download retries next run
    urlCache.set(url, rec);
  }
  return rec;
}

async function fetchUrl(url) {
  const hit = await tx('readonly', (s) => s.get(url));
  if (hit) return readable(hit);
  let r;
  try {
    r = await fetch(url);
  } catch {
    // A cross-origin fetch that the host didn't opt into fails identically to
    // a dead network — the browser withholds which on purpose — and CORS is
    // overwhelmingly the one that's actually happening. WebGL can't sample a
    // texture the page wasn't allowed to read, so there's no lenient path.
    throw new Error(
      "couldn't download it — the host may not let other sites load its files (CORS). raw.githubusercontent.com and upload.wikimedia.org do; most image search results don't. Otherwise save the file and drop it in."
    );
  }
  if (!r.ok) throw new Error(`the host answered HTTP ${r.status}`);
  const data = await r.arrayBuffer();
  let type = r.headers.get('content-type')?.split(';')[0].trim() ?? '';
  if (!type || type === 'application/octet-stream') {
    const ext = url.split(/[?#]/)[0].split('.').pop()?.toLowerCase();
    if (MIME[ext]) type = MIME[ext];
  }
  const rec = { name: url, type, data };
  // the download already worked, so a store that won't take it (private
  // browsing, quota) costs a re-download next session and nothing else
  try {
    await tx('readwrite', (s) => s.put(rec));
  } catch { /* urlCache still holds it for the rest of this session */ }
  return readable(rec);
}

// The starter files served from public/media/. They're named and looked up
// exactly like imported ones, so a fresh install can run the examples with
// nothing dropped in yet — and an import of the same name shadows them.
// The material keeps Poly Haven's own 'slug_1k/map.jpg' layout, which is what
// a download through the asset browser produces, so a sketch reads the same
// either way.
const BUNDLED = [
  'ship.obj',
  'kloofendal_43d_clear_puresky_1k.hdr',
  'cobblestone_floor_08_1k/diff.jpg',
  'cobblestone_floor_08_1k/nor_gl.jpg',
  'cobblestone_floor_08_1k/arm.jpg',
  'cobblestone_floor_08_1k/disp.jpg',
];

const bundledCache = new Map();
function bundledGet(name) {
  let rec = bundledCache.get(name);
  if (!rec) {
    rec = fetch(`${import.meta.env.BASE_URL}media/${name}`).then(async (r) => {
      if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
      const blob = await r.blob();
      return { name, type: blob.type, blob };
    });
    rec.catch(() => bundledCache.delete(name)); // a failed fetch retries next run
    bundledCache.set(name, rec);
  }
  return rec;
}

// Imported files first, so a name that exists both ways resolves to the one
// that was dropped in.
export const mediaList = async () => {
  const keys = await tx('readonly', (s) => s.getAllKeys());
  // downloaded URLs share the store but aren't imports: listing them would pad
  // the completions and the "nothing imported" warnings with full URLs, and
  // let a bare name substring-match one
  const local = keys.filter((k) => !isUrl(k));
  return [...local, ...BUNDLED.filter((n) => !local.includes(n))];
};

// `accept` narrows the search to filenames it approves of, so a substring
// lookup for a model can't land on the image of the same name
export async function mediaGet(name, accept) {
  name = bareName(name);
  // a URL names one exact file, so there's no ambiguity for `accept` to settle
  // — and a query string would defeat its extension test anyway
  if (isUrl(name)) return urlGet(name.trim());
  const ok = (n) => !accept || accept(n);
  const get = async (key) => readable(await tx('readonly', (s) => s.get(key)));
  const exact = await get(String(name));
  if (exact && ok(exact.name)) return exact;
  const n = String(name).toLowerCase();
  const match = (await mediaList()).find((k) => k.toLowerCase().includes(n) && ok(k));
  if (!match) return null;
  // mediaList() also lists the bundled files, which have no IndexedDB record —
  // those are fetched from public/media/ instead
  return (await get(match)) ?? bundledGet(match);
}

export function classifyFile(file) {
  const ext = file.name.split('.').pop()?.toLowerCase();
  // models by extension first: .obj/.fbx arrive with an empty or made-up type
  if (['obj', 'fbx'].includes(ext)) return 'model';
  // .hdr/.exr likewise, and .hdr in particular is sometimes typed image/vnd.radiance
  if (['hdr', 'exr'].includes(ext)) return 'hdri';
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
      { video: 'video/*', image: 'image/*', audio: 'audio/*', model: '.obj,.fbx', hdri: '.hdr,.exr' }[kind] ?? '';
    input.multiple = multiple;
    input.style.display = 'none';
    document.body.appendChild(input);
    const done = () => { resolve([...input.files]); input.remove(); };
    input.addEventListener('change', done);
    input.addEventListener('cancel', done);
    input.click();
  });
}

const dirOf = (name) => (name.includes('/') ? name.slice(0, name.lastIndexOf('/')) : '');

// Images that came in together and classify into several different maps are a
// PBR material, not a pile of pictures. Grouped by folder, so dropping four
// material folders at once yields four materials. Returns
// [{ handle, names }, ...] plus the images that weren't part of any set.
function findMaterials(names) {
  const groups = new Map();
  for (const name of names) {
    if (!IMAGE_RE.test(name)) continue;
    const dir = dirOf(name);
    groups.set(dir, [...(groups.get(dir) ?? []), name]);
  }
  const materials = [];
  const loose = [];
  for (const [dir, group] of groups) {
    const set = classifySet(group);
    // one map alone is just an image; two or more is somebody's material
    if (Object.keys(set).length < 2) {
      loose.push(...group);
      continue;
    }
    // a folder names its own material; loose files fall back to whatever
    // their filenames share ('rock_diff.jpg' + 'rock_nor.jpg' -> 'rock')
    materials.push({ handle: dir || commonPrefix(group) || group[0], names: group });
  }
  return { materials, loose };
}

// A dropped folder's worth of names on one line is a wall of text you have to
// scroll past to reach the rest of the call — one per line reads, and the
// editor folds it away to a … on import (see foldLists).
export function nameList(names) {
  const q = (s) => JSON.stringify(String(s));
  if (names.length < 3) return `[${names.map(q).join(', ')}]`;
  return `[\n${names.map((n) => `  ${q(n)},`).join('\n')}\n]`;
}

// editor snippet for a set of just-imported files; several images become an
// imageseq stepping once per beat, ready to retrigger with any counter
export function snippetFor(files) {
  const q = (s) => JSON.stringify(typeof s === 'string' ? s : s.name);
  const { materials, loose } = findMaterials(
    files.filter((f) => classifyFile(f) === 'image').map((f) => f.name)
  );
  const parts = [];
  // a material is a whole lit object, so it comes with the shape to put it on
  for (const mat of materials) {
    parts.push(
      `sphere({ radius: 1.4, res: 128 })\n  .material({ pbr: ${q(mat.handle)}, repeat: 2 })\n  .out()`
    );
  }
  if (loose.length > 1) parts.push(`imageseq(${nameList(loose)}, beat(4))`);
  else if (loose.length === 1) parts.push(`imagefile(${q(loose[0])})`);
  for (const f of files) {
    const kind = classifyFile(f);
    if (kind === 'video') parts.push(`videofile(${q(f)})`);
    else if (kind === 'audio') parts.push(`audiofile(${q(f)})`);
    // a model is a geometry op, so it needs its .out() to show up at all
    else if (kind === 'model') parts.push(`model(${q(f)}).out()`);
    else if (kind === 'hdri') parts.push(`hdri(${q(f)})`);
  }
  return parts.join('\n');
}
