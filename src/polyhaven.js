// Poly Haven browser — search CC0 materials, HDRIs and models from inside the
// app and download them into the same IndexedDB store as a dropped file.
//
// The files really are downloaded: nothing in a sketch points at the network.
// A material lands as 'asphalt_02_2k/diff.jpg', 'asphalt_02_2k/nor_gl.jpg', …
// which is exactly the shape a dropped folder has, so the same
// .material({ pbr: 'asphalt_02_2k' }) resolves it — and keeps resolving it
// offline, next week, after the site has moved on.
//
// api.polyhaven.com serves Access-Control-Allow-Origin: * on the index, the
// thumbnails and the downloads alike, so this needs no key and no proxy.

import { mediaPut, mediaList, pickFiles, bareName } from './media.js';
import { commonPrefix } from './pbr.js';
// the browser carries its own styles, so both pages that can open it — the app
// and the docs — get them by importing the module
import './polyhaven.css';

const API = 'https://api.polyhaven.com';
const LS_INDEX = 'td-polyhaven-index'; // asset lists, refetched daily
const TTL = 24 * 60 * 60 * 1000;

// Poly Haven's map keys -> the filename we store them under. pbr.js reads
// these names back, so they double as the slot each map fills. The color map
// isn't in the table because it isn't always called the same thing — see
// colorKey.
const WANTED = [
  ['nor_gl', 'nor_gl'],
  ['arm', 'arm'], // AO + roughness + metalness packed into RGB — one file, three slots
  ['Rough', 'rough'], // only if arm is missing (see pickFiles)
  ['AO', 'ao'],
  ['Metal', 'metal'],
];
const DISPLACEMENT = ['Displacement', 'disp'];

// 'Diffuse' for all but a handful of assets, which publish colorways instead
// ('coll1'/'coll2' on leather_red_02, 'col_01'..'col_03' on fabric_pattern_05)
// or name the format ('diff_png' on church_bricks_02). Missing the key meant
// downloading every map but the color one, and the material came out white
// with all its relief intact. Sorted, so a set of colorways always resolves to
// the same one — there's nowhere in a `pbr:` name to say which you wanted.
const COLOR_KEY = /^(diff|col)/i;
const colorKey = (files) =>
  'Diffuse' in files ? 'Diffuse' : (Object.keys(files).filter((k) => COLOR_KEY.test(k)).sort()[0] ?? null);

// --- api -------------------------------------------------------------------

const json = async (url) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Poly Haven: HTTP ${r.status}`);
  return r.json();
};

// The full index is a few hundred KB of which we keep a fraction, so it's
// trimmed before caching — localStorage is small and the rest is unused.
const trim = (assets) =>
  Object.fromEntries(
    Object.entries(assets).map(([slug, a]) => [
      slug,
      {
        name: a.name,
        tags: a.tags ?? [],
        categories: a.categories ?? [],
        thumb: a.thumbnail_url,
        authors: Object.keys(a.authors ?? {}),
        downloads: a.download_count ?? 0,
        polys: a.polycount ?? 0, // models only — everything merges into one mesh, so it's worth seeing first
      },
    ])
  );

async function loadIndex(type) {
  const key = `${LS_INDEX}-${type}`;
  try {
    const hit = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (hit && Date.now() - hit.at < TTL) return hit.assets;
  } catch { /* corrupt or unavailable — refetch */ }
  const assets = trim(await json(`${API}/assets?type=${type}`));
  try {
    localStorage.setItem(key, JSON.stringify({ at: Date.now(), assets }));
  } catch { /* over quota — the memory copy still serves this session */ }
  return assets;
}

// Which files to actually pull for one material: the diffuse and normal, then
// either the packed arm map or whatever separate channels exist, plus the
// height map only when asked (it's large, and useless without the geometry
// resolution to displace).
function pickMaps(files, res, displacement) {
  const at = (key) => files[key]?.[res]?.jpg ?? files[key]?.[res]?.png;
  const color = colorKey(files);
  const wanted = files.arm ? WANTED.filter(([k]) => !['Rough', 'AO', 'Metal'].includes(k)) : WANTED;
  const list = [
    ...(color ? [[color, 'diff']] : []),
    ...wanted,
    ...(displacement ? [DISPLACEMENT] : []),
  ];
  const out = [];
  for (const [key, as] of list) {
    const file = at(key);
    if (file?.url) out.push({ url: file.url, as: `${as}.${file.url.split('.').pop()}` });
  }
  return out;
}

// Highest resolution at or below the requested one — not every asset is
// published at every size, and a 1k-only texture shouldn't just fail.
function bestRes(files, key, want) {
  const have = Object.keys(files[key] ?? {}).filter((r) => /^\d+k$/.test(r));
  const n = (r) => parseInt(r, 10);
  const under = have.filter((r) => n(r) <= n(want)).sort((a, b) => n(b) - n(a));
  return under[0] ?? have.sort((a, b) => n(a) - n(b))[0] ?? null;
}

async function download(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.blob();
}

// Fetch one material's maps and store them as 'slug_2k/diff.jpg' etc.
// Returns the prefix a sketch names in .material({ pbr }).
async function importTexture(slug, res, displacement, onProgress) {
  const files = await json(`${API}/files/${slug}`);
  const actual = bestRes(files, colorKey(files), res) ?? res;
  const picks = pickMaps(files, actual, displacement);
  if (!picks.length) throw new Error(`no downloadable maps for "${slug}"`);
  const prefix = `${slug}_${actual}`;
  for (let i = 0; i < picks.length; i++) {
    onProgress?.(i, picks.length);
    const blob = await download(picks[i].url);
    await mediaPut(blob, `${prefix}/${picks[i].as}`);
  }
  return prefix;
}

// HDRIs are a single file, so they keep a flat name like any dropped .hdr
async function importHdri(slug, res, onProgress) {
  const files = await json(`${API}/files/${slug}`);
  const actual = bestRes(files, 'hdri', res) ?? res;
  const url = files.hdri?.[actual]?.hdr?.url ?? files.hdri?.[actual]?.exr?.url;
  if (!url) throw new Error(`no downloadable file for "${slug}"`);
  onProgress?.(0, 1);
  const name = `${slug}_${actual}.${url.split('.').pop()}`;
  await mediaPut(await download(url), name);
  return name;
}

// A model is the mesh plus whatever material the same asset publishes: the
// files endpoint lists both under one slug, and its map keys are the ones a
// texture uses, so pickMaps() reads them unchanged. The .fbx is one
// self-contained binary (models.js drops the materials it names anyway), and
// `res` only sizes the textures — the mesh is the same at every resolution.
// Assets that texture their parts separately ('hull_diff', 'sails_arm') have
// no color map colorKey() will match, and come down as geometry alone.
async function importModel(slug, res, onProgress) {
  const files = await json(`${API}/files/${slug}`);
  const url = files.fbx?.[bestRes(files, 'fbx', res) ?? res]?.fbx?.url;
  if (!url) throw new Error(`no .fbx published for "${slug}"`);
  const texRes = bestRes(files, colorKey(files), res);
  const maps = texRes ? pickMaps(files, texRes, false) : [];
  const name = `${slug}.fbx`;
  onProgress?.(0, maps.length + 1);
  await mediaPut(await download(url), name);
  const prefix = `${slug}_${texRes}`;
  for (let i = 0; i < maps.length; i++) {
    onProgress?.(i + 1, maps.length + 1);
    await mediaPut(await download(maps[i].url), `${prefix}/${maps[i].as}`);
  }
  return { handle: name, pbr: maps.length ? prefix : null };
}

// --- names that fetch themselves -------------------------------------------
//
// A pick from the browser writes its name into the sketch tagged —
// pbr: 'polyhaven:rock_2k' — so the code says where the files came from. Share
// that sketch and the tag is what lets the other machine download the same
// asset rather than render the shape untextured. Nothing else is needed: the
// local name *is* the slug and the resolution, which is all the API wants.

const RES_SUFFIX = /_(\d+k)$/;
const DEFAULT_RES = '2k';

// 'polyhaven:rock_2k' -> { slug: 'rock', res: '2k' }, and the same for an
// HDRI's 'sunset_4k.hdr'. A mesh is published at one size, so 'ship.fbx' keeps
// its whole name as the slug and `res` only sizes the maps that come with it.
export function parseAssetName(name, type) {
  // a map inside a set names the set it belongs to ('rock_2k/diff.jpg')
  const base = bareName(name).split('/')[0].replace(/\.(hdr|exr|fbx|obj)$/i, '');
  if (type === 'models') return { slug: base, res: DEFAULT_RES };
  const res = base.match(RES_SUFFIX);
  return { slug: res ? base.slice(0, -res[0].length) : base, res: res?.[1] ?? DEFAULT_RES };
}

// One download per asset, however many callers want it: a model and the
// material it came with both go missing on the same frame.
const inflight = new Map();

// Downloads the asset a tagged name points at, into the same store a dropped
// file lands in — so the caller's ordinary lookup finds it on the second try.
export function fetchPolyhaven(name, type, onProgress) {
  const key = `${type}:${bareName(name).toLowerCase()}`;
  let job = inflight.get(key);
  if (job) return job;
  const { slug, res } = parseAssetName(name, type);
  job = (async () => {
    if (type === 'hdris') return importHdri(slug, res, onProgress);
    if (type === 'models') return (await importModel(slug, res, onProgress)).handle;
    // the height map comes along here, unlike an interactive download: it's the
    // smallest file in a Poly Haven set (a jpg a fraction of the normal map's
    // size), and leaving it out would quietly flatten someone else's sketch
    return importTexture(slug, res, true, onProgress);
  })();
  inflight.set(key, job);
  // a failure clears the slot too — the next run retries, the file may have
  // only been a dropped connection away
  job.catch(() => {}).finally(() => inflight.delete(key));
  return job;
}

// --- browser ---------------------------------------------------------------

const RESOLUTIONS = { textures: ['1k', '2k', '4k'], hdris: ['1k', '2k', '4k'], models: ['1k', '2k', '4k'] };

// Rendering 800 cards at once is fine; rendering 800 <img> requests is not.
// The images are lazy, and the list is capped until a search narrows it.
const PAGE = 120;

const TITLES = { textures: 'materials', hdris: 'hdris', models: 'models' };
const PLACEHOLDERS = {
  textures: 'search — wood, rusty metal, concrete…',
  hdris: 'search — sunset, studio, forest…',
  models: 'search — chair, rock, plant…',
};

// A merged mesh is as heavy as its file says, so the count goes on the card
const polys = (n) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : `${n}`;

export function initPolyhaven() {
  let el = null;
  let state = { type: 'textures', query: '', category: null, res: '2k', displacement: false };
  const indexes = {}; // type -> assets, kept for the session
  let imported = new Set(); // prefixes already in the media store
  let settle = null; // resolves the open() promise, while one is in flight

  function build() {
    el = document.createElement('div');
    el.id = 'ph-modal';
    el.innerHTML = `
      <div id="ph-panel">
        <header>
          <span class="ph-title"></span>
          <input id="ph-search" type="search" autocomplete="off">
          <label class="ph-opt">res <select id="ph-res"></select></label>
          <label class="ph-opt ph-disp"><input id="ph-disp" type="checkbox"> displacement</label>
          <button id="ph-close" title="cancel (esc)">✕</button>
        </header>
        <div id="ph-cats"></div>
        <div id="ph-grid"></div>
        <footer>
          <span id="ph-status"></span>
          <button id="ph-disk">from disk…</button>
        </footer>
      </div>`;
    document.body.appendChild(el);

    const $ = (sel) => el.querySelector(sel);
    el.addEventListener('click', (e) => { if (e.target === el) cancel(); });
    $('#ph-close').addEventListener('click', cancel);
    $('#ph-disk').addEventListener('click', fromDisk);
    $('#ph-search').addEventListener('input', (e) => {
      state.query = e.target.value.trim().toLowerCase();
      render();
    });
    $('#ph-res').addEventListener('change', (e) => { state.res = e.target.value; });
    $('#ph-disp').addEventListener('change', (e) => { state.displacement = e.target.checked; });
  }

  // The browser opens for one kind of asset — the call that opened it already
  // decided which. displacement is a materials-only option.
  function setType(type) {
    state.type = type;
    state.category = null;
    state.query = '';
    el.querySelector('.ph-title').textContent = TITLES[type];
    const search = el.querySelector('#ph-search');
    search.value = '';
    search.placeholder = PLACEHOLDERS[type];
    el.querySelector('.ph-disp').style.display = type === 'textures' ? '' : 'none';
    fillResolutions();
  }

  function fillResolutions() {
    const sel = el.querySelector('#ph-res');
    sel.innerHTML = '';
    for (const r of RESOLUTIONS[state.type]) sel.append(new Option(r, r));
    sel.value = RESOLUTIONS[state.type].includes(state.res) ? state.res : '2k';
    state.res = sel.value;
  }

  const status = (msg, kind = '') => {
    const s = el.querySelector('#ph-status');
    s.textContent = msg;
    s.className = kind;
  };

  async function refresh() {
    const grid = el.querySelector('#ph-grid');
    if (!indexes[state.type]) {
      grid.innerHTML = '<div class="ph-empty">loading Poly Haven…</div>';
      try {
        indexes[state.type] = await loadIndex(state.type);
      } catch (e) {
        grid.innerHTML = `<div class="ph-empty">couldn't reach Poly Haven — ${e.message}</div>`;
        return;
      }
    }
    imported = new Set((await mediaList()).map((n) => (n.includes('/') ? n.split('/')[0] : n)));
    renderCategories();
    render();
  }

  function renderCategories() {
    const counts = new Map();
    for (const a of Object.values(indexes[state.type])) {
      for (const c of a.categories) counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    const top = [...counts.entries()]
      .filter(([c]) => !c.startsWith('collection:'))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 14);
    const cats = el.querySelector('#ph-cats');
    cats.innerHTML = '';
    for (const [name] of [['all'], ...top]) {
      const btn = document.createElement('button');
      btn.textContent = name;
      btn.className = (state.category ?? 'all') === name ? 'on' : '';
      btn.addEventListener('click', () => {
        state.category = name === 'all' ? null : name;
        renderCategories();
        render();
      });
      cats.appendChild(btn);
    }
  }

  function matches(asset, slug) {
    if (state.category && !asset.categories.includes(state.category)) return false;
    if (!state.query) return true;
    return state.query
      .split(/\s+/)
      .every((word) =>
        slug.includes(word) ||
        asset.name.toLowerCase().includes(word) ||
        asset.tags.some((t) => t.includes(word)) ||
        asset.categories.some((c) => c.includes(word))
      );
  }

  function render() {
    const grid = el.querySelector('#ph-grid');
    const all = Object.entries(indexes[state.type] ?? {});
    const hits = all.filter(([slug, a]) => matches(a, slug)).sort((a, b) => b[1].downloads - a[1].downloads);
    grid.innerHTML = '';
    if (!hits.length) {
      grid.innerHTML = '<div class="ph-empty">nothing matches that</div>';
      return;
    }
    for (const [slug, asset] of hits.slice(0, PAGE)) {
      // built as nodes rather than innerHTML — asset names come off the wire
      const card = document.createElement('button');
      card.className = 'ph-card';
      card.title = `${asset.name}${asset.authors.length ? ` — ${asset.authors.join(', ')}` : ''}`;
      const img = document.createElement('img');
      img.src = asset.thumb;
      img.alt = '';
      img.loading = 'lazy';
      const label = document.createElement('span');
      label.textContent = asset.name;
      card.append(img, label);
      if (state.type === 'models' && asset.polys) {
        const count = document.createElement('em');
        count.className = 'ph-polys';
        count.textContent = `${polys(asset.polys)} polys`;
        card.appendChild(count);
      }
      // a material lands under 'slug_2k/', an HDRI as 'slug_2k.hdr', a mesh as
      // 'slug.fbx' — any of the three means this asset is already here
      if (imported.has(`${slug}.fbx`) || [...imported].some((n) => n.startsWith(`${slug}_`))) {
        const dot = document.createElement('i');
        dot.className = 'ph-have';
        dot.title = 'already imported';
        card.appendChild(dot);
      }
      card.addEventListener('click', () => take(slug, asset));
      grid.appendChild(card);
    }
    const more = hits.length - PAGE;
    if (more > 0) {
      const note = document.createElement('div');
      note.className = 'ph-empty';
      note.textContent = `+${more} more — search to narrow it down`;
      grid.appendChild(note);
    }
  }

  async function take(slug, asset) {
    status(`downloading ${asset.name} at ${state.res}…`);
    el.classList.add('busy');
    try {
      const progress = (i, n) => status(`downloading ${asset.name} — file ${i + 1} of ${n}…`);
      if (state.type === 'models') {
        const got = await importModel(slug, state.res, progress);
        finish(got.handle, got.pbr, true);
      } else if (state.type === 'textures') {
        finish(await importTexture(slug, state.res, state.displacement, progress), null, true);
      } else {
        finish(await importHdri(slug, state.res, progress), null, true);
      }
    } catch (e) {
      status(`${asset.name}: ${e.message ?? e}`, 'err');
    } finally {
      el.classList.remove('busy');
    }
  }

  // The local-file escape hatch, so an empty hdri() / .material() / model() is
  // still a way to reach your own files and not only Poly Haven's. Several
  // images are read as one material, the same way a dropped folder is.
  async function fromDisk() {
    const isTex = state.type === 'textures';
    // the click on this button is the user activation the picker needs
    const files = await pickFiles({ textures: 'image', hdris: 'hdri', models: 'model' }[state.type], isTex);
    if (!files.length) return;
    el.classList.add('busy');
    try {
      for (const f of files) await mediaPut(f);
      const names = files.map((f) => f.name);
      // a material is named by whatever its maps share; one file has only
      // itself to go on, and an HDRI is a single file either way
      finish(isTex ? commonPrefix(names) || names[0] : names[0]);
    } catch (e) {
      status(`${e.message ?? e}`, 'err');
    } finally {
      el.classList.remove('busy');
    }
  }

  // Resolve whoever is awaiting open(), once. `handle` is what the sketch
  // names — a pbr prefix for a material, a filename for an HDRI or a model —
  // or null if the browser was dismissed without choosing anything. `pbr` is
  // the material a model brought down with it, when it had one.
  //
  // A Poly Haven download hands both back tagged, since the sketch can say
  // where they came from and be fetched again elsewhere; files off the local
  // disk have nowhere to be fetched from and stay plain. `label` is the name on
  // this machine either way.
  function finish(handle, pbr = null, tag = false) {
    const done = settle;
    settle = null;
    el?.classList.remove('show');
    window.removeEventListener('keydown', onKey);
    const mark = (n) => (n && tag ? `polyhaven:${n}` : n);
    done?.(handle == null ? null : { type: state.type, handle: mark(handle), pbr: mark(pbr), label: handle });
  }

  const cancel = () => finish(null);
  const onKey = (e) => { if (e.key === 'Escape') cancel(); };

  // Opens the browser and resolves with the caller's pick (or null). Called
  // when a sketch runs a naked hdri() / .material(): main.js fills the choice
  // straight back into that call.
  function open(type = 'textures') {
    if (!el) build();
    finish(null); // a second open supersedes whatever was already waiting
    setType(type);
    status(`pick one — it downloads into this browser · CC0 from polyhaven.com · esc to cancel`);
    el.classList.add('show');
    window.addEventListener('keydown', onKey);
    el.querySelector('#ph-search').focus();
    refresh();
    return new Promise((res) => { settle = res; });
  }

  return { open };
}
