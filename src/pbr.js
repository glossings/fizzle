// Working out which texture map is which from a filename.
//
// A PBR material arrives as a pile of images with no metadata — the only clue
// to what each one is is its name, and every site names them differently:
//
//   Poly Haven   rock_2k/diff.jpg      nor_gl.jpg   arm.jpg   disp.jpg
//   ambientCG    Rock023_Color.jpg     Rock023_NormalGL.jpg   ..._Roughness.jpg
//   generic      wood_basecolor.png    wood_N.png   wood_R.png
//
// Rather than a wall of regexes, each filename is tokenized (resolution
// markers dropped, camelCase split) and the tokens are matched against a table
// of aliases. A set of maps is then just "the imported files whose names start
// with the same prefix", which is what both the folder drop and the Poly Haven
// download produce.

// three.js material properties, in the order they're tested. `arm` is not a
// three property — it's the packed AO/Rough/Metal texture that expands into
// three of them (see ARM_SLOTS); it goes first so `arm` doesn't read as `ao`.
// `normalDX` is likewise virtual: a DirectX-convention normal map, used only
// when no OpenGL one came with it (three expects OpenGL).
const ALIASES = {
  arm: ['arm', 'orm', 'armmap', 'ormmap', 'occlusionroughnessmetallic'],
  normalDX: ['nordx', 'normaldx', 'nrmdx', 'normdx'],
  normalMap: ['nor', 'norgl', 'normal', 'normalgl', 'nrm', 'norm', 'bump'],
  aoMap: ['ao', 'ambientocclusion', 'occlusion', 'occ'],
  roughnessMap: ['rough', 'roughness', 'rgh'],
  metalnessMap: ['metal', 'metallic', 'metalness', 'met'],
  displacementMap: ['disp', 'displacement', 'height'],
  map: ['diff', 'diffuse', 'color', 'col', 'albedo', 'basecolor', 'base'],
};

// Single-letter suffixes (wood_D / wood_N / wood_R) are common but far too
// greedy to sit in the table above — they only count as the last token.
const LETTERS = { d: 'map', c: 'map', n: 'normalMap', r: 'roughnessMap', m: 'metalnessMap', h: 'displacementMap' };

// one packed texture, three three.js slots: three reads AO from .r, roughness
// from .g and metalness from .b, so the same image serves all three
export const ARM_SLOTS = ['aoMap', 'roughnessMap', 'metalnessMap'];

// every slot a material can actually receive, in a stable order
export const MAP_SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'displacementMap'];

// maps that carry color rather than measurements — the only ones tagged sRGB
export const SRGB_SLOTS = new Set(['map', 'emissiveMap']);

export const IMAGE_RE = /\.(png|jpe?g|webp|avif|bmp|gif|tga)$/i;
export const HDRI_RE = /\.(hdr|exr)$/i;

const baseName = (name) => String(name).split('/').pop().replace(/\.[^.]+$/, '');

// 'Rock023_NormalGL_2K' -> ['rock023', 'normal', 'gl']
function tokenize(name) {
  return baseName(name)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2') // NormalGL -> Normal GL
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((tok) => tok && !/^\d+k$/.test(tok) && !/^\d{3,}$/.test(tok)); // drop 2k / 4096
}

// Which material slot does this file fill? Returns a key of ALIASES, or null
// for a filename that says nothing (in which case the caller decides — a lone
// unlabelled image in a set is almost always the diffuse).
export function classifyMap(name) {
  const tokens = tokenize(name);
  if (!tokens.length) return null;
  // a normal map names its convention in a separate token: nor_gl / NormalDX
  const isNormal = tokens.some((t) => ALIASES.normalMap.includes(t) || ALIASES.normalDX.includes(t));
  if (isNormal && tokens.includes('dx')) return 'normalDX';
  for (const [slot, aliases] of Object.entries(ALIASES)) {
    if (tokens.some((t) => aliases.includes(t))) return slot;
  }
  const last = tokens[tokens.length - 1];
  if (last.length === 1 && LETTERS[last] && tokens.length > 1) return LETTERS[last];
  return null;
}

// The longest leading run of tokens shared by every name — the natural handle
// for a set of maps that arrived together (['rock_diff', 'rock_nor'] -> 'rock').
// Used to name a dropped folder's material; '' when the names have nothing in
// common, which is the signal to fall back to the folder's own name.
export function commonPrefix(names) {
  const parts = names.map((n) => baseName(n).split(/[^a-zA-Z0-9]+/).filter(Boolean));
  if (!parts.length) return '';
  const out = [];
  for (let i = 0; i < parts[0].length; i++) {
    const tok = parts[0][i];
    if (!parts.every((p) => p[i] === tok)) break;
    out.push(tok);
  }
  return out.join('_');
}

// Filenames -> { map: 'rock/diff.jpg', normalMap: ..., arm: ... }. A DirectX
// normal map is only promoted when the OpenGL one is missing, and a single
// unlabelled image is taken as the diffuse. Later files win ties, except that
// an already-filled slot is never overwritten by a worse match.
export function classifySet(names) {
  const set = {};
  const unlabelled = [];
  for (const name of names) {
    if (!IMAGE_RE.test(name)) continue;
    const slot = classifyMap(name);
    if (!slot) unlabelled.push(name);
    else set[slot] ??= name;
  }
  if (set.normalDX && !set.normalMap) set.normalMap = set.normalDX;
  delete set.normalDX;
  if (!set.map && unlabelled.length === 1) set.map = unlabelled[0];
  return set;
}
