// Texture maps on a geometry chain's .material(). Every slot takes the name of
// an imported image (exact filename, else substring, like every other name
// here), a live texture chain, or a THREE.Texture as an escape hatch:
//
//   .material({ map: 'wood.jpg', normalMap: 'wood_nor.jpg', repeat: 4 })
//   .material({ pbr: 'rock_2k', repeat: 2 })       // a whole set at once
//   .material({ map: video().kaleido(6) })         // a texture, re-rendered per frame
//
// Loading is async, like fonts and models: the mesh renders untextured for the
// first frames after a fresh import and the maps appear when they land. On a
// re-run they come from the engine's cache and are there on the first frame.

import * as THREE from 'three';
import { MAP_SLOTS, SRGB_SLOTS, ARM_SLOTS } from './pbr.js';
import { TextureOp } from './textures.js';
import { setColor, isDynamicColor } from './color.js';
import { warn } from './warn.js';

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
// (what each one does is in MATERIAL_DOCS below, which the editor reads out on
// ctrl+hover — the annotations that used to live here, where only I could see
// them, are more use to whoever's typing the key)
const PHYSICAL_SCALARS = [
  'transmission', 'thickness', 'ior', 'dispersion', 'attenuationDistance',
  'clearcoat', 'clearcoatRoughness', 'iridescence', 'iridescenceIOR',
  'sheen', 'sheenRoughness', 'specularIntensity', 'reflectivity',
  'anisotropy', 'anisotropyRotation',
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
  'pbr', 'arm',
  'repeat', 'offset', 'uvRotate', 'tileSize',
  'normalScale', 'aoIntensity', 'envIntensity',
  'displaceScale', 'displaceBias',
];
const BLEND_KEYS = ['opacity', 'transparent', 'depthWrite'];

// One line per key, because 45 names in a tooltip tell you nothing about which
// one you want. Read out on ctrl+hover and in the completion popup, so this is
// the documentation — keep it to a sentence that fits over the cursor.
export const MATERIAL_DOCS = {
  color: 'Base color: hex, CSS name, 0xrrggbb, or [r, g, b] 0..1. The color, or any one channel of the array, may be a fn of t.',
  roughness: '0 mirror-smooth .. 1 fully diffuse. Multiplies roughnessMap if there is one.',
  metalness: '0 dielectric .. 1 metal. Metal has nothing to reflect without an hdri().',
  emissive: 'Color the surface gives off on its own — unlit, so it glows in shadow.',
  emissiveIntensity: 'How hard emissive glows. Push past 1 to feed bloom().',

  map: 'Base color texture: an imported image name, a live texture chain, or a THREE.Texture. A list of them is a set the copies of an .instance() pick from with x.tile(n).',
  normalMap: 'Tangent-space normals (OpenGL convention) — surface detail without geometry.',
  roughnessMap: 'Per-pixel roughness, read from green. roughness multiplies it.',
  metalnessMap: 'Per-pixel metalness, read from blue. metalness multiplies it.',
  aoMap: 'Baked contact shadow, read from the red channel — darkens creases and corners. Scale it with aoIntensity.',
  displacementMap: 'Moves vertices for real — needs res on the geometry to have vertices to move.',
  pbr: "Fills every map slot at once — color, normal, roughness, metal, displacement — from one imported set. The value is the folder name: pbr: 'rock_2k'. An empty .material() opens a browser to download one.",
  arm: 'One packed image feeding aoMap/roughnessMap/metalnessMap from its R/G/B channels.',
  repeat: 'Tile every map. A number, or [x, y].',
  offset: 'Shift every map in UV space. A number, or [x, y].',
  uvRotate: 'Rotate every map about its center, in radians.',
  tileSize: 'Pixels a map: [a, b, c] set draws each of its pictures at. A number, or [w, h]. Default 256, square.',
  normalScale: 'Strength of normalMap. A number, or [x, y] to skew the relief.',
  aoIntensity: 'Strength of aoMap.',
  envIntensity: 'How hard the hdri() environment hits this surface. Works with no maps at all.',
  displaceScale: 'World-unit distance displacementMap moves a vertex.',
  displaceBias: 'The map value that counts as no displacement (mid-gray is 0.5).',

  opacity: '0..1. Turns transparency on by itself, and stops the mesh casting a shadow.',
  transparent: 'Force blending on or off, overriding what opacity implies.',
  depthWrite: 'false trades the depth sort for order-independent blending — for a pile of bubbles.',

  transmission: '0..1 — light passes through (glass, water). Costs a second scene render.',
  thickness: 'Volume behind the surface, in world units. 0 is a thin shell with no refraction.',
  ior: 'Index of refraction: 1.0 air, ~1.5 glass, 2.4 diamond.',
  dispersion: 'Splits the refraction into rainbow fringes. Needs thickness to have anything to split.',
  attenuationDistance: "How far light travels through the volume before it's tinted out.",
  attenuationColor: 'What the volume tints light on the way through — the color of thick glass.',
  clearcoat: '0..1 — a second specular lobe over the base, like lacquer on a car.',
  clearcoatRoughness: 'How blurred the clearcoat reflection is, independent of the base roughness.',
  iridescence: '0..1 — thin-film interference: soap bubble, oil slick, beetle shell.',
  iridescenceIOR: 'Refractive index of the iridescent film.',
  iridescenceThickness: 'Film thickness in nanometres; ~100..800 walks the whole hue cycle.',
  sheen: '0..1 — retroreflective fuzz at grazing angles, for cloth and velvet.',
  sheenColor: 'Color of that fuzz, often the opposite of the base color.',
  sheenRoughness: 'How tight the sheen lobe is.',
  specularIntensity: 'Strength of the dielectric reflection.',
  specularColor: 'Tints that reflection.',
  reflectivity: 'Dielectric reflection strength when metalness is 0.',
  anisotropy: '0..1 — stretches highlights in one direction: brushed metal, hair, vinyl.',
  anisotropyRotation: 'Direction of that stretch, in radians.',

  flatShading: 'Face normals instead of smoothed ones — faceted, low-poly look.',
  wireframe: 'Draw edges only.',
  doubleSide: 'Render back faces too. On by default for plane() and model(), off for solids.',
};

// Grouped, because 45 keys is too many to read as one list: the sections are
// what autocomplete shows after `.material({`, and the flattened set is what
// checkMaterialKeys tests against — so offering and checking can't disagree.
export const MATERIAL_GROUPS = [
  ['base', BASE_KEYS],
  ['maps', [...MAP_SLOTS, ...MAP_KEYS]],
  ['blending', BLEND_KEYS],
  ['glass & coatings', [...PHYSICAL_KEYS]],
  ['render', RENDER_KEYS],
];

const MATERIAL_KEYS = new Set(MATERIAL_GROUPS.flatMap(([, keys]) => keys));

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

// What's wrong with a .material()'s keys, as a message, or null if nothing is.
// Said out loud rather than ignored — the whole point of a property is the
// change it makes, so a typo that makes no change is indistinguishable from
// the feature not working — but said, not thrown: the rest of the material is
// perfectly good and the sketch keeps rendering with it.
export function checkMaterialKeys(o) {
  const unknown = Object.keys(o).filter((k) => !MATERIAL_KEYS.has(k));
  if (!unknown.length) return null;
  // shadows are a property of the object, not of its surface, so they'd never
  // be found by the spell-checker below — and three's own names invite the try
  if (unknown.some((k) => /^(cast|receive)?[Ss]hadow$/.test(k))) {
    return 'material: shadows are per-mesh, not per-material — .shadow(false) or .shadow({ cast, receive }) on the chain (both are on by default)';
  }
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
  return `material: no such ${unknown.length > 1 ? 'properties' : 'property'} ${described.join(', ')}${hint} — ignored`;
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
      // colors carry their own animation test — an [r, g, b] moves if any one
      // channel is a fn, which `track` (looking for a fn outright) would miss
      if (m[prop] == null) continue;
      setColor(material[prop], m[prop], 0);
      if (isDynamicColor(m[prop])) animated.push((t) => setColor(material[prop], m[prop], t));
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

// ---------------------------------------------------------------------------
// a set of pictures in the map slot: .material({ map: [a, b, c] })

// The set a map slot names, or null for the ordinary one-picture slot. Only the
// color map takes a set: one draw call binds one set of samplers, and the rest
// of the slots have nothing to pick with.
export function tileSources(m) {
  for (const slot of MAP_SLOTS) {
    if (slot !== 'map' && Array.isArray(m[slot])) {
      warn(`material: ${slot} is one map for the whole batch — a set to pick from goes in map:`);
    }
  }
  if (!Array.isArray(m.map)) return null;
  if (!m.map.length) {
    warn('material: map: [] is an empty set — nothing to pick from');
    return null;
  }
  return m.map;
}

// Every picture in the set is drawn at this one size, since they share a
// texture. The sources render into it at its aspect rather than the frame's, so
// a square tile gets a square text() instead of a widescreen one cropped down.
const TILE_MIN = 8, TILE_LIMIT = 1024;
function tileDims(m) {
  const [w, h] = m.tileSize != null ? pair(m.tileSize) : [256, 256];
  const fit = (v) => Math.min(TILE_LIMIT, Math.max(TILE_MIN, Math.round(v) || 256));
  return { w: fit(w), h: fit(h) };
}

// GLSL can't index a set of samplers per instance, but it can index the layers
// of one — so the set becomes a 2D array texture and each copy carries the
// layer it wants as an instanced attribute (written in api.js's updater).
//
// Layered on top of whatever else patched this material: .noise() and
// .displace() replace chunks of their own and have to survive, so the previous
// hook is called rather than dropped.
export function applyTileMap(material, m) {
  const uniforms = {
    tdTiles: { value: null },
    tdTileRepeat: { value: new THREE.Vector2(...pair(m.repeat ?? 1)) },
    tdTileOffset: { value: new THREE.Vector2(...pair(m.offset ?? 0)) },
  };
  const prevCompile = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey;
  // no slot is filled, so nothing else asks for the uv varying this reads
  material.defines = { ...material.defines, USE_UV: '' };
  material.onBeforeCompile = (shader, renderer) => {
    prevCompile?.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <uv_pars_vertex>', `#include <uv_pars_vertex>
        attribute float tdTile;
        varying float vTdTile;`)
      .replace('#include <uv_vertex>', `#include <uv_vertex>
        vTdTile = tdTile;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <uv_pars_fragment>', `#include <uv_pars_fragment>
        uniform sampler2DArray tdTiles;
        uniform vec2 tdTileRepeat;
        uniform vec2 tdTileOffset;
        varying float vTdTile;`)
      // the slot is empty, so map_fragment itself expands to nothing
      .replace('#include <map_fragment>', `#include <map_fragment>
        diffuseColor *= texture(tdTiles, vec3(vUv * tdTileRepeat + tdTileOffset, vTdTile));`);
  };
  material.customProgramCacheKey = () => `${prevKey ? prevKey.call(material) : ''}-tdtiles`;
  material.needsUpdate = true;
  return uniforms;
}

// A lit material on THREE.Points: the mesh shader never writes gl_PointSize,
// so this adds it. Chained after the deformers' hook like applyTileMap.
export function applyPointSize(material, uniform) {
  const prevCompile = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    prevCompile?.call(material, shader, renderer);
    shader.uniforms.tdPointSize = uniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n uniform float tdPointSize;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\n gl_PointSize = tdPointSize;');
  };
  material.customProgramCacheKey = () => `${prevKey ? prevKey.call(material) : ''}-tdpoints`;
  material.needsUpdate = true;
}

// Attach every map named on `m` to `material`. `isAlive` is checked before an
// async load assigns anything, so a texture that arrives after its patch was
// cleared is dropped instead of mutating a disposed material.
export function applyMaps(engine, material, m, isAlive, tileUniforms) {
  // a set of pictures rather than one: the layers are rendered elsewhere (see
  // renderTileSets), and the slot itself stays empty — .tile() reads them
  if (tileUniforms) {
    engine.textureTiles.push({
      nodes: tileSources(m).map((s) => {
        if (s instanceof TextureOp) return s;
        // a name is the imported image of that name, like any other slot; an
        // empty one is the black a missing picture already renders as
        if (typeof s === 'string') return new TextureOp(engine, 'imagefile', { name: s });
        warn('material: a set of maps takes texture chains or imported image names — that entry comes out black');
        return new TextureOp(engine, 'imagefile', { name: null });
      }),
      uniform: tileUniforms.tdTiles,
      ...tileDims(m),
      rt: null,
      isAlive,
    });
  }
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

  // A texture in a map slot is a live chain, not a file: it re-renders every frame,
  // so the binding is handed to the engine and textures.js writes the current
  // texture in ahead of each 3D pass.
  //
  // It always ends in one more pass, which is what makes the texture in the
  // slot a render target *this binding owns*. A chain can end in a node that
  // hands back someone else's texture — input('bus') forwards its producer's,
  // videofile() the shared decoder's — and the uv transform below writes onto
  // the texture itself, which would otherwise reach into every other user of
  // it. Owning it also means two materials can tile one chain differently.
  // For a color slot that pass is the sRGB decode it needed anyway.
  const bindTexture = (slot, chain) => {
    slotDefaults(slot);
    const node = new TextureOp(engine, SRGB_SLOTS.has(slot) ? 'toLinear' : 'copy', {}, [chain]);
    // tiling past the edge only wraps if the target says so, and it has to say
    // so before it's allocated — hence a flag on the node rather than on the
    // texture the way an imported image does it
    if (repeat) node._tiled = true;
    // A surface samples the map at whatever density perspective gives it, not
    // the map's own — so the owned target carries a mip pyramid, or the map
    // shimmers in the distance the way any unmipped texture does. Imported
    // images get theirs from three's defaults; a chain's target has to ask
    // (same before-allocation rule as _tiled above). For a color slot the
    // pyramid is built after the toLinear pass, so filtering happens in
    // linear light, which is where averaging colors is correct.
    node._needsMips = true;
    engine.textureMaps.push({ node, material, slot, isAlive, configure: tiled ? configure : null, tex: null });
  };

  const setSlot = (slot, spec) => {
    if (spec == null || spec === false) return;
    if (spec instanceof TextureOp) return bindTexture(slot, spec);
    if (spec.isTexture) return assign(slot, spec);
    const t = engine.ensureTexture(spec, SRGB_SLOTS.has(slot));
    if (t.texture) assign(slot, t.texture);
    else t.pending.then((tex) => assign(slot, tex));
  };

  // slots named outright — these win over anything pbr: resolves
  const explicit = {};
  for (const slot of MAP_SLOTS) if (m[slot] != null && !Array.isArray(m[slot])) explicit[slot] = m[slot];
  // arm: one packed AO/Rough/Metal image standing in for three slots
  if (m.arm != null) for (const slot of ARM_SLOTS) explicit[slot] ??= m.arm;
  for (const [slot, spec] of Object.entries(explicit)) setSlot(slot, spec);

  if (m.pbr == null) return;
  // pbr: names a set of files on disk; a chain is one image and has to say
  // which slot it fills
  if (m.pbr instanceof TextureOp) {
    warn('material: pbr: names an imported set of maps — a texture goes in one slot, e.g. { map: ... }');
    return;
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
