// Texture maps on a geometry chain's .material(). Every slot takes the name of
// an imported image (exact filename, else substring, like every other name
// here), or a THREE.Texture as an escape hatch:
//
//   .material({ map: 'wood.jpg', normalMap: 'wood_nor.jpg', repeat: 4 })
//   .material({ pbr: 'rock_2k', repeat: 2 })   // a whole set at once
//
// Loading is async, like fonts and models: the mesh renders untextured for the
// first frames after a fresh import and the maps appear when they land. On a
// re-run they come from the engine's cache and are there on the first frame.

import { MAP_SLOTS, SRGB_SLOTS, ARM_SLOTS } from './pbr.js';

const pair = (v) => (Array.isArray(v) ? [v[0], v[1] ?? v[0]] : [v, v]);

// The knobs that go with maps and environment lighting. envIntensity is the
// one that means something on a plain colored material too — it scales how
// hard the hdri() environment hits this surface — so this runs for every
// material, not just textured ones; the rest are inert without their map.
export function applyMaterialScalars(material, m) {
  if (m.normalScale != null) material.normalScale.set(...pair(m.normalScale));
  if (m.aoIntensity != null) material.aoMapIntensity = m.aoIntensity;
  if (m.envIntensity != null) material.envMapIntensity = m.envIntensity;
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

  const configure = (tex) => {
    if (repeat) tex.repeat.set(repeat[0], repeat[1]);
    if (offset) tex.offset.set(offset[0], offset[1]);
    if (uvRotation != null) {
      tex.center.set(0.5, 0.5);
      tex.rotation = uvRotation;
    }
    return tex;
  };

  const assign = (slot, tex) => {
    if (!tex || !isAlive()) return;
    // clone so tiling belongs to this material — the cached original is shared
    material[slot] = configure(tex.clone());
    // three multiplies these maps by the matching scalar, whose plain-material
    // default would crush the map's range. Only a sketch that named a value
    // keeps it — .material({ pbr: 'x', roughness: 0.4 }) still polishes it.
    if (slot === 'roughnessMap' && m.roughness == null) material.roughness = 1;
    if (slot === 'metalnessMap' && m.metalness == null) material.metalness = 1;
    if (slot === 'displacementMap') {
      material.displacementScale = m.displaceScale ?? DISPLACE_SCALE;
      material.displacementBias = m.displaceBias ?? -material.displacementScale / 2;
    }
    // a slot appearing after first compile changes the shader's defines
    material.needsUpdate = true;
  };

  const setSlot = (slot, spec) => {
    if (spec == null || spec === false) return;
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
