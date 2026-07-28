// Texture maps on a geometry chain's .material(). Every slot takes the name of
// an imported image (exact filename, else substring, like every other name
// here), a live TOP chain, or a THREE.Texture as an escape hatch:
//
//   .material({ map: 'wood.jpg', normalMap: 'wood_nor.jpg', repeat: 4 })
//   .material({ pbr: 'rock_2k', repeat: 2 })       // a whole set at once
//   .material({ map: video().kaleido(6) })         // a TOP, re-rendered per frame
//
// Loading is async, like fonts and models: the mesh renders untextured for the
// first frames after a fresh import and the maps appear when they land. On a
// re-run they come from the engine's cache and are there on the first frame.

import { MAP_SLOTS, SRGB_SLOTS, ARM_SLOTS } from './pbr.js';
import { TopOp } from './tops.js';

const pair = (v) => (Array.isArray(v) ? [v[0], v[1] ?? v[0]] : [v, v]);
const resolve = (v, t) => (typeof v === 'function' ? v(t) : v);

// The knobs that go with maps and environment lighting. envIntensity is the
// one that means something on a plain colored material too — it scales how
// hard the hdri() environment hits this surface — so this runs for every
// material, not just textured ones; the rest are inert without their map.
export function applyMaterialScalars(material, m) {
  if (m.normalScale != null) material.normalScale.set(...pair(m.normalScale));
  if (m.aoIntensity != null) material.aoMapIntensity = m.aoIntensity;
  if (m.envIntensity != null) material.envMapIntensity = m.envIntensity;
}

// Glass, coatings and blending — the properties three keeps on
// MeshPhysicalMaterial rather than MeshStandardMaterial. Naming any of them on
// a .material() is what upgrades the mesh to a physical material (see
// isPhysical); a sketch that never mentions them pays nothing, since physical
// is the more expensive shader and transmission costs a second scene render.
const PHYSICAL_SCALARS = [
  'transmission',       // 0..1 — how much light passes through (glass, bubbles)
  'thickness',          // volume behind the surface, in world units; 0 = thin shell
  'ior',                // index of refraction, 1.0 (air) .. 2.4 (diamond); glass ~1.5
  'dispersion',         // splits the refraction into rainbow fringes (needs thickness)
  'attenuationDistance',// how far light travels through the volume before it's tinted out
  'clearcoat',          // 0..1 — a second specular lobe over the base, like lacquer
  'clearcoatRoughness',
  'iridescence',        // 0..1 — thin-film interference (soap bubble, oil slick)
  'iridescenceIOR',
  'sheen',              // 0..1 — retroreflective fuzz, for cloth
  'sheenRoughness',
  'specularIntensity',
  'reflectivity',       // dielectric reflection strength when metalness is 0
  'anisotropy',         // 0..1 — stretches highlights (brushed metal, hair)
  'anisotropyRotation',
];
const PHYSICAL_COLORS = ['attenuationColor', 'sheenColor', 'specularColor'];

// three wants iridescence film thickness as a [min, max] nm range that a map
// interpolates across. With no map only the max is ever sampled, so the sketch
// gives one number and keeps three's own 100nm floor.
const IRIDESCENCE_MIN_NM = 100;

const PHYSICAL_KEYS = new Set([...PHYSICAL_SCALARS, ...PHYSICAL_COLORS, 'iridescenceThickness']);

// The rest of .material()'s vocabulary, kept here so there's one list to check
// a sketch against. Nothing reads a key it doesn't recognize and three ignores
// unknown constructor keys, so a misspelling is otherwise perfectly silent —
// the material just quietly isn't what you asked for. These two arrays are read
// in api.js's GeoOp.out(); everything else in the set is read in this file.
const BASE_KEYS = ['color', 'roughness', 'metalness', 'emissive', 'emissiveIntensity'];
const RENDER_KEYS = ['flatShading', 'wireframe', 'doubleSide'];
const MAP_KEYS = [
  'pbr', 'arm',                                         // whole sets at once
  'repeat', 'offset', 'uvRotate',                        // uv transform
  'normalScale', 'aoIntensity', 'envIntensity',          // per-map strength
  'displaceScale', 'displaceBias',
];
const BLEND_KEYS = ['opacity', 'transparent', 'depthWrite'];

const MATERIAL_KEYS = new Set([
  ...BASE_KEYS, ...RENDER_KEYS, ...MAP_KEYS, ...BLEND_KEYS, ...MAP_SLOTS, ...PHYSICAL_KEYS,
]);

// Levenshtein, bailing out once it's further off than we'd ever suggest.
function editDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      row[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j - 1], prev[j], row[j - 1]);
      best = Math.min(best, row[j]);
    }
    if (best > max) return max + 1;
    prev = row;
  }
  return prev[b.length];
}

// The known key `key` was most likely meant to be, or null if it's not close
// to anything. The budget scales with length so `ior` can't match `pbr` while
// `iridescenceThicknes` still finds its home.
function nearestKey(key) {
  const budget = Math.max(1, Math.min(4, Math.floor(key.length / 4)));
  const lower = key.toLowerCase();
  let best = null;
  let bestDist = budget + 1;
  for (const known of MATERIAL_KEYS) {
    const d = editDistance(lower, known.toLowerCase(), budget);
    if (d < bestDist) { bestDist = d; best = known; }
  }
  return best;
}

// Throws on anything .material() wouldn't act on. Loud rather than ignored:
// the whole point of a property is the change it makes, so a typo that makes
// no change is indistinguishable from the feature not working.
export function checkMaterialKeys(o) {
  const unknown = Object.keys(o).filter((k) => !MATERIAL_KEYS.has(k));
  if (!unknown.length) return;
  let suggested = false;
  const described = unknown.map((k) => {
    const near = nearestKey(k);
    if (!near) return `"${k}"`;
    suggested = true;
    return `"${k}" — did you mean ${near}?`;
  });
  // nothing close enough to name means it's not a typo but a property that
  // doesn't exist here, and then the list itself is the useful answer
  const hint = suggested ? '' : ' (ctrl+hover .material() for the full list)';
  throw new Error(
    `material: no such ${unknown.length > 1 ? 'properties' : 'property'} ${described.join(', ')}${hint}`
  );
}

// True if the material spec asks for anything only MeshPhysicalMaterial can do.
export function isPhysical(m) {
  for (const k in m) if (PHYSICAL_KEYS.has(k)) return true;
  return false;
}

// Opacity, blending and every physical property named on `m`. Like the rest of
// the API these take fns of t, so the returned updater re-resolves just the
// animated ones per frame (null when nothing here moves).
export function applySurface(material, m) {
  const animated = [];
  // set it now at t=0, and remember it for the updater only if it moves
  const track = (v, apply) => {
    apply(resolve(v, 0));
    if (typeof v === 'function') animated.push((t) => apply(v(t)));
  };

  if (m.opacity != null) {
    track(m.opacity, (v) => { material.opacity = v; });
    // Blending is opt-in in three, and turning it on costs a depth-sort and
    // correctness hazards — so it follows the value rather than the mention.
    // An animated opacity could dip below 1 at any time, hence always on.
    material.transparent = m.transparent ?? (typeof m.opacity === 'function' || resolve(m.opacity, 0) < 1);
  } else if (m.transparent != null) {
    material.transparent = m.transparent;
  }
  // Overlapping transparent surfaces sort per-object, so a stack of bubbles
  // pops as the camera turns. Dropping depth writes trades the sort for
  // order-independent blending, which reads better on exactly that kind of pile.
  if (m.depthWrite != null) material.depthWrite = m.depthWrite;

  if (isPhysical(m)) {
    for (const prop of PHYSICAL_SCALARS) {
      if (m[prop] != null) track(m[prop], (v) => { material[prop] = v; });
    }
    for (const prop of PHYSICAL_COLORS) {
      if (m[prop] != null) track(m[prop], (v) => material[prop].set(v));
    }
    if (m.iridescenceThickness != null) {
      // written in place: three re-reads this array into the uniform every
      // frame, so an animated thickness doesn't need to allocate a new one
      track(m.iridescenceThickness, (v) => {
        material.iridescenceThicknessRange[0] = IRIDESCENCE_MIN_NM;
        material.iridescenceThicknessRange[1] = v;
      });
    }
  }
  return animated.length ? (t) => { for (const fn of animated) fn(t); } : null;
}

// three's displacement is unsigned and defaults to a full world unit, which
// would inflate any shape here past recognition the moment a height map lands.
// A tenth of a unit reads as surface relief at the scale these sketches work
// at, and the negative bias re-centers it on the original surface instead of
// pushing the whole shape outwards.
const DISPLACE_SCALE = 0.1;

// Attach every map named on `m` to `material`. `isAlive` is checked before an
// async load assigns anything, so a texture that arrives after its patch was
// cleared is dropped instead of mutating a disposed material.
export function applyMaps(engine, material, m, isAlive) {
  const repeat = m.repeat != null ? pair(m.repeat) : null;
  const offset = m.offset != null ? pair(m.offset) : null;
  const uvRotation = m.uvRotate ?? null;

  const tiled = repeat || offset || uvRotation != null;
  const configure = (tex) => {
    if (repeat) tex.repeat.set(repeat[0], repeat[1]);
    if (offset) tex.offset.set(offset[0], offset[1]);
    if (uvRotation != null) {
      tex.center.set(0.5, 0.5);
      tex.rotation = uvRotation;
    }
    return tex;
  };

  // three multiplies these maps by the matching scalar, whose plain-material
  // default would crush the map's range. Only a sketch that named a value
  // keeps it — .material({ pbr: 'x', roughness: 0.4 }) still polishes it.
  const slotDefaults = (slot) => {
    if (slot === 'roughnessMap' && m.roughness == null) material.roughness = 1;
    if (slot === 'metalnessMap' && m.metalness == null) material.metalness = 1;
    if (slot === 'displacementMap') {
      material.displacementScale = m.displaceScale ?? DISPLACE_SCALE;
      material.displacementBias = m.displaceBias ?? -material.displacementScale / 2;
    }
  };

  const assign = (slot, tex) => {
    if (!tex || !isAlive()) return;
    // clone so tiling belongs to this material — the cached original is shared
    material[slot] = configure(tex.clone());
    slotDefaults(slot);
    // a slot appearing after first compile changes the shader's defines
    material.needsUpdate = true;
  };

  // A TOP in a map slot is a live chain, not a file: it re-renders every frame,
  // so the binding is handed to the engine and tops.js writes the current
  // texture in ahead of each 3D pass.
  //
  // It always ends in one more pass, which is what makes the texture in the
  // slot a render target *this binding owns*. A chain can end in a node that
  // hands back someone else's texture — input('bus') forwards its producer's,
  // videofile() the shared decoder's — and the uv transform below writes onto
  // the texture itself, which would otherwise reach into every other user of
  // it. Owning it also means two materials can tile one chain differently.
  // For a color slot that pass is the sRGB decode it needed anyway.
  const bindTop = (slot, chain) => {
    slotDefaults(slot);
    const node = new TopOp(engine, SRGB_SLOTS.has(slot) ? 'toLinear' : 'copy', {}, [chain]);
    // tiling past the edge only wraps if the target says so, and it has to say
    // so before it's allocated — hence a flag on the node rather than on the
    // texture the way an imported image does it
    if (repeat) node._tiled = true;
    engine.topMaps.push({ node, material, slot, isAlive, configure: tiled ? configure : null, tex: null });
  };

  const setSlot = (slot, spec) => {
    if (spec == null || spec === false) return;
    if (spec instanceof TopOp) return bindTop(slot, spec);
    if (spec.isTexture) return assign(slot, spec);
    const t = engine.ensureTexture(spec, SRGB_SLOTS.has(slot));
    if (t.texture) assign(slot, t.texture);
    else t.pending.then((tex) => assign(slot, tex));
  };

  // slots named outright — these win over anything pbr: resolves
  const explicit = {};
  for (const slot of MAP_SLOTS) if (m[slot] != null) explicit[slot] = m[slot];
  // arm: one packed AO/Rough/Metal image standing in for three slots
  if (m.arm != null) for (const slot of ARM_SLOTS) explicit[slot] ??= m.arm;
  for (const [slot, spec] of Object.entries(explicit)) setSlot(slot, spec);

  if (m.pbr == null) return;
  // pbr: names a set of files on disk; a chain is one image and has to say
  // which slot it fills
  if (m.pbr instanceof TopOp) {
    throw new Error('material: pbr: names an imported set of maps — a TOP goes in one slot, e.g. { map: ... }');
  }
  engine.ensurePbrSet(m.pbr).pending.then((maps) => {
    if (!maps || !isAlive()) return;
    const resolved = { ...maps };
    if (resolved.arm) for (const slot of ARM_SLOTS) resolved[slot] ??= resolved.arm;
    delete resolved.arm;
    for (const [slot, name] of Object.entries(resolved)) {
      if (explicit[slot] == null) setSlot(slot, name);
    }
  });
}

// True if the material spec asks for anything textured at all — lets the
// caller skip the whole path (and its defaults) for a plain colored material.
export function hasMaps(m) {
  return m.pbr != null || m.arm != null || MAP_SLOTS.some((slot) => m[slot] != null);
}

// Image-based lighting from an imported .hdr/.exr. The prefiltered cubemap
// lights every material in the scene; the raw equirect texture is what you
// actually see behind them. Anything animatable is read per frame by the
// updater the caller registers.
export function applyHdri(engine, h, o) {
  const scene = engine.scene;
  scene.environment = h.env;
  if (o.background !== false) scene.background = h.texture;
  return (t, resolve) => {
    scene.environmentIntensity = resolve(o.intensity ?? 1, t);
    scene.backgroundIntensity = resolve(o.backgroundIntensity ?? o.intensity ?? 1, t);
    scene.backgroundBlurriness = resolve(o.blur ?? 0, t);
    const rot = resolve(o.rotation ?? 0, t);
    // one control turns the light rig and the visible sky together, or the sky
    // slides under fixed lighting when only backgroundRotation is given
    scene.environmentRotation.set(0, rot, 0);
    scene.backgroundRotation.set(0, resolve(o.backgroundRotation ?? rot, t), 0);
  };
}
