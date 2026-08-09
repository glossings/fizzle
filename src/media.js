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

// `name` overrides the key — used for folder drops ('rock_2k/diff.jpg') and
// for downloads, which arrive as bare blobs with no name of their own
export const mediaPut = (file, name = file.name) =>
  tx('readwrite', (s) => s.put({ name: String(name), type: file.type, blob: file }));
export const mediaDelete = (name) => tx('readwrite', (s) => s.delete(name));

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
  return [...keys, ...BUNDLED.filter((n) => !keys.includes(n))];
};

// `accept` narrows the search to filenames it approves of, so a substring
// lookup for a model can't land on the image of the same name
export async function mediaGet(name, accept) {
  const ok = (n) => !accept || accept(n);
  const get = (key) => tx('readonly', (s) => s.get(key));
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
  if (loose.length > 1) parts.push(`imageseq([${loose.map(q).join(', ')}], beat(4))`);
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
