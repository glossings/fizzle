// Playlists and tags for the sketch list. Sketches themselves stay plain .js
// files; everything that groups or describes them lives here, in one
// library.json alongside them (sketches/user/library.json via the dev-server
// API, localStorage when there's no server) so a set travels with the sketches
// it plays.
//
// Auto tags are never stored. They're derived from the source every time it
// changes, so a sketch that grows a particle system starts answering to
// "particles" without anyone re-tagging it.

const LS_LIB = 'td-library';
const LS_AUTO = 'td-autotags'; // derived tags, cached against mtime

export const keyOf = (scope, name) => `${scope}:${name}`;
export const splitKey = (k) => {
  const i = k.indexOf(':');
  return { scope: k.slice(0, i), name: k.slice(i + 1) };
};

const EMPTY = { version: 1, tags: {}, playlists: [] };

// --- storage ---------------------------------------------------------------

let onDisk = true;

export async function loadLibrary() {
  try {
    const r = await fetch('/api/library');
    if (!r.ok) throw new Error();
    onDisk = true;
    return normalize(await r.json());
  } catch {
    onDisk = false;
    try {
      return normalize(JSON.parse(localStorage.getItem(LS_LIB) ?? 'null'));
    } catch {
      return normalize(null);
    }
  }
}

function normalize(lib) {
  if (!lib || typeof lib !== 'object') return structuredClone(EMPTY);
  return {
    version: 1,
    tags: lib.tags && typeof lib.tags === 'object' ? lib.tags : {},
    playlists: Array.isArray(lib.playlists)
      ? lib.playlists
          .filter((p) => p && typeof p.name === 'string')
          .map((p) => ({
            id: String(p.id ?? newId()),
            name: p.name,
            items: Array.isArray(p.items) ? p.items.filter((k) => typeof k === 'string') : [],
          }))
      : [],
  };
}

export const newId = () => Math.random().toString(36).slice(2, 10);

// Writes are coalesced: dragging through a playlist fires one per drop, and
// the file only needs to reflect where the dragging stopped.
let saveTimer;
export function saveLibrary(lib) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const body = JSON.stringify(lib, null, 2);
    if (onDisk) {
      try {
        const r = await fetch('/api/library', { method: 'PUT', body });
        if (r.ok) return;
      } catch { /* server went away mid-session — keep a copy locally */ }
    }
    try { localStorage.setItem(LS_LIB, body); } catch { /* over quota */ }
  }, 200);
}

// --- auto tags -------------------------------------------------------------

// A call to `name(`, not a method `.name(` and not the tail of someone's own
// `myNoise(`. Same lookbehind trick main.js uses to fill an empty call.
const calls = (code, names) => new RegExp(`(?<![\\w$.])(${names.join('|')})\\s*\\(`).test(code);

const GEOMETRY = ['sphere', 'box', 'plane', 'torus', 'torusKnot', 'cylinder', 'capsule', 'icosa', 'text3d', 'model'];
const SOURCES_2D = ['constant', 'ramp', 'circle', 'ring', 'noise', 'voronoi', 'text', 'gradient'];
const AUDIO = ['audio', 'audiofile'];
const CAMERA = ['video', 'person'];
const MEDIA = ['videofile', 'imagefile', 'imageseq'];

// Sketch source in, searchable words out. Deliberately coarse: these are for
// finding a sketch in a hurry, not for describing it.
export function autoTags(code) {
  if (typeof code !== 'string') return [];
  // comments would tag a sketch for the API names it merely talks about
  const src = code.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const tags = [];
  if (calls(src, GEOMETRY)) tags.push('3d');
  if (calls(src, SOURCES_2D)) tags.push('2d');
  if (calls(src, ['scene', 'input', 'depth'])) tags.push('fx');
  if (calls(src, ['particles']) || /\.particles\s*\(/.test(src)) tags.push('particles');
  if (calls(src, AUDIO)) tags.push('audio');
  if (calls(src, CAMERA)) tags.push('cam');
  if (calls(src, MEDIA)) tags.push('media');
  if (calls(src, ['hdri'])) tags.push('hdri');
  const res = resolutionOf(src);
  if (res) tags.push(res);
  return tags;
}

// resolution(1920, 1080) / resolution(600) / resolution({ width, height }).
// A sketch that computes its size gets no tag rather than a wrong one.
function resolutionOf(src) {
  const pair = /(?<![\w$.])resolution\s*\(\s*(\d+)\s*(?:,\s*(\d+)\s*)?\)/.exec(src);
  if (pair) return `${pair[1]}x${pair[2] ?? pair[1]}`;
  const obj = /(?<![\w$.])resolution\s*\(\s*\{[^}]*?\bwidth\s*:\s*(\d+)[^}]*?\bheight\s*:\s*(\d+)/.exec(src);
  return obj ? `${obj[1]}x${obj[2]}` : null;
}

// --- auto tag cache --------------------------------------------------------

// Deriving tags means reading every sketch, which on a first load is sixty-odd
// fetches. They're cached against the file's mtime, so a later load only reads
// what changed.
const readCache = () => {
  try { return JSON.parse(localStorage.getItem(LS_AUTO) ?? '{}'); } catch { return {}; }
};
const writeCache = (c) => {
  try { localStorage.setItem(LS_AUTO, JSON.stringify(c)); } catch { /* over quota */ }
};

// entries: [{ key, stamp, read }] — `read` fetches the source, and is only
// called for entries whose stamp has moved. Returns { key: [tags] }.
export async function autoTagsFor(entries, concurrency = 8) {
  const cache = readCache();
  const out = {};
  const stale = [];
  for (const e of entries) {
    const hit = cache[e.key];
    if (hit && hit.stamp === e.stamp) out[e.key] = hit.tags;
    else stale.push(e);
  }
  let i = 0;
  const worker = async () => {
    while (i < stale.length) {
      const e = stale[i++];
      try {
        const code = await e.read();
        const tags = autoTags(code);
        out[e.key] = tags;
        cache[e.key] = { stamp: e.stamp, tags };
      } catch {
        out[e.key] = [];
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, stale.length) }, worker));
  // sketches that are gone shouldn't keep a row forever
  for (const k of Object.keys(cache)) if (!(k in out)) delete cache[k];
  writeCache(cache);
  return out;
}

// --- tags ------------------------------------------------------------------

export const manualTags = (lib, key) => lib.tags[key] ?? [];

export function setManualTags(lib, key, tags) {
  const clean = [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))];
  if (clean.length) lib.tags[key] = clean;
  else delete lib.tags[key];
  saveLibrary(lib);
}

// --- search ----------------------------------------------------------------

// Every word has to match something — the name or one of the tags — so
// "kaleido audio" narrows rather than widens. `tag:x` demands a tag.
export function matches(query, name, tags) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = name.toLowerCase();
  const tl = tags.map((t) => t.toLowerCase());
  return words.every((w) => {
    if (w.startsWith('tag:')) return tl.some((t) => t.includes(w.slice(4)));
    return hay.includes(w) || tl.some((t) => t.includes(w));
  });
}

// --- playlists -------------------------------------------------------------

export function addPlaylist(lib, name) {
  const p = { id: newId(), name, items: [] };
  lib.playlists.push(p);
  saveLibrary(lib);
  return p;
}

export function removePlaylist(lib, id) {
  lib.playlists = lib.playlists.filter((p) => p.id !== id);
  saveLibrary(lib);
}

export function renamePlaylist(lib, id, name) {
  const p = lib.playlists.find((x) => x.id === id);
  if (p) p.name = name;
  saveLibrary(lib);
}

// The same sketch may appear in a playlist more than once — a set that comes
// back to a piece is a real set — so this appends without deduping. `at` is
// where to drop it in.
export function addToPlaylist(lib, id, key, at = -1) {
  const p = lib.playlists.find((x) => x.id === id);
  if (!p) return;
  if (at < 0 || at > p.items.length) p.items.push(key);
  else p.items.splice(at, 0, key);
  saveLibrary(lib);
}

export function removeAt(lib, id, index) {
  const p = lib.playlists.find((x) => x.id === id);
  if (!p) return;
  p.items.splice(index, 1);
  saveLibrary(lib);
}

export function moveItem(lib, id, from, to) {
  const p = lib.playlists.find((x) => x.id === id);
  if (!p) return;
  const [item] = p.items.splice(from, 1);
  if (item == null) return;
  p.items.splice(from < to ? to - 1 : to, 0, item);
  saveLibrary(lib);
}

// A deleted sketch leaves its slots behind everywhere it played.
export function forgetSketch(lib, key) {
  delete lib.tags[key];
  for (const p of lib.playlists) p.items = p.items.filter((k) => k !== key);
  saveLibrary(lib);
}
