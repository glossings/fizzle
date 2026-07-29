import * as THREE from 'three';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TTFLoader } from 'three/addons/loaders/TTFLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import { applyNoise, applyNoiseDepth } from './noise.js';
import { applyMaps, applyMaterialScalars, applySurface, applyHdri, hasMaps, isPhysical, checkMaterialKeys } from './materials.js';
import { TopOp } from './tops.js';
import { sig, valueNoise, setBpmSource } from './audio.js';
import helvetikerRegular from './fonts/helvetiker_regular.typeface.json';
import helvetikerBold from './fonts/helvetiker_bold.typeface.json';

const fontLoader = new FontLoader();
const FONTS = {
  regular: fontLoader.parse(helvetikerRegular),
  bold: fontLoader.parse(helvetikerBold),
};

// 3D text fonts, beyond the bundled helvetiker pair. `font` may be:
//  - a parsed three.js Font (escape hatch)
//  - a URL to .typeface.json, .ttf or .otf (parsed at runtime, no conversion)
//  - a bare name: tried against installed fonts first (Chrome's Local Font
//    Access API — permission prompt, needs a user gesture), then fetched from
//    Google Fonts via the dev-server proxy
//  - 'google:Name' to skip the local lookup
// Loads are async: the mesh builds with helvetiker and swaps when ready.
// Cache persists across re-runs so the swap happens once.
const fontCache = new Map();

// The dev server answers requests for missing files with index.html (SPA
// fallback), so a bad font URL "succeeds" with an HTML body. Catch that and
// name the real problem.
async function fetchFontFile(spec, missingHint = 'is the file actually there?') {
  const res = await fetch(spec);
  if (!res.ok) throw new Error(`${spec}: HTTP ${res.status} ${await res.text().catch(() => '')}`.trim());
  const buf = await res.arrayBuffer();
  const head = new TextDecoder().decode(buf.slice(0, 64)).trimStart().toLowerCase();
  if (head.startsWith('<!doctype') || head.startsWith('<html')) {
    throw new Error(`${spec}: the server returned a page, not a font — ${missingHint}`);
  }
  return buf;
}

async function loadLocalFont(spec, weight) {
  if (!navigator.queryLocalFonts) throw new Error('no local font access in this browser');
  const fonts = await navigator.queryLocalFonts();
  const name = spec.toLowerCase();
  const matches = fonts.filter(
    (f) => f.family.toLowerCase() === name || f.fullName.toLowerCase() === name || f.postscriptName.toLowerCase() === name
  );
  if (!matches.length) throw new Error(`not installed`);
  const style = new RegExp(weight === 'bold' ? 'bold' : 'regular|normal|book|roman', 'i');
  const pick = matches.find((f) => style.test(f.style)) ?? matches[0];
  return fontLoader.parse(new TTFLoader().parse(await (await pick.blob()).arrayBuffer()));
}

async function loadGoogleFont(spec, weight) {
  const buf = await fetchFontFile(
    `/api/gfont/${encodeURIComponent(spec)}?weight=${weight === 'bold' ? 700 : 400}`,
    'the Google Fonts proxy needs the dev server'
  );
  return fontLoader.parse(new TTFLoader().parse(buf));
}

async function loadFontSpec(spec, weight) {
  if (/\.json(\?|$)/i.test(spec)) {
    const buf = await fetchFontFile(spec);
    return fontLoader.parse(JSON.parse(new TextDecoder().decode(buf)));
  }
  if (/\.(ttf|otf)(\?|$)/i.test(spec)) {
    return fontLoader.parse(new TTFLoader().parse(await fetchFontFile(spec)));
  }
  if (/^google:/i.test(spec)) return loadGoogleFont(spec.slice(7), weight);
  // bare name: installed fonts first, then Google Fonts
  let localErr = null;
  try {
    return await loadLocalFont(spec, weight);
  } catch (e) {
    localErr = e;
  }
  try {
    return await loadGoogleFont(spec, weight);
  } catch (gErr) {
    throw new Error(`font "${spec}": ${localErr.message}, and Google Fonts failed (${gErr.message})`);
  }
}

function resolveFont(o) {
  const fallback = o.weight === 'bold' ? FONTS.bold : FONTS.regular;
  const spec = o.font;
  if (!spec) return { font: fallback, pending: null };
  if (typeof spec === 'object' && spec.isFont) return { font: spec, pending: null };
  const key = `${String(spec).toLowerCase()}|${o.weight ?? ''}`;
  let cached = fontCache.get(key);
  if (cached?.isFont) return { font: cached, pending: null };
  if (!cached) {
    cached = loadFontSpec(String(spec), o.weight).then((f) => {
      fontCache.set(key, f);
      return f;
    });
    cached.catch((err) => {
      fontCache.delete(key);
      console.warn(`fizzle: ${err.message}`);
    });
    fontCache.set(key, cached);
  }
  return { font: fallback, pending: cached };
}

// Chainable operator API, synth-flavored:
//
//   sphere({ radius: 1 })
//     .pos(0, t => Math.sin(t), 0)
//     .scale(1, 2, 1)
//     .rotate(0, t => t * 0.3, 0)
//     .noise({ amp: 0.4, freq: 2, octaves: 4, speed: 0.5 })
//     .instance(50, (x, i, n) => x.pos(i - n / 2, 0, 0))
//     .material({ color: '#4fd1c5', roughness: 0.3 })
//     .out()
//
// Every numeric parameter also accepts a function of time, evaluated per
// frame, so animation falls out of the same syntax.

const resolve = (v, t) => (typeof v === 'function' ? v(t) : v);
const resolve3 = (v, t) => v.map((c) => resolve(c, t));

// extra carries things resolved outside the switch: `font` for text3d, and
// `geometry` for model() — the parsed .obj/.fbx, which arrives asynchronously
function buildGeometry(type, o = {}, extra = {}) {
  switch (type) {
    // an empty geometry renders nothing, which is exactly what a model that
    // hasn't finished parsing (or wasn't found) should do
    case 'model':
      return extra.geometry ? extra.geometry.clone() : new THREE.BufferGeometry();
    case 'sphere':
      return new THREE.SphereGeometry(o.radius ?? 1, o.res ?? 64, Math.ceil((o.res ?? 64) / 2));
    case 'box': {
      const r = o.res ?? 24;
      return new THREE.BoxGeometry(o.width ?? 1, o.height ?? 1, o.depth ?? 1, r, r, r);
    }
    case 'plane':
      return new THREE.PlaneGeometry(o.width ?? 10, o.height ?? 10, o.res ?? 128, o.res ?? 128);
    case 'torus':
      return new THREE.TorusGeometry(o.radius ?? 1, o.tube ?? 0.35, o.res ?? 48, (o.res ?? 48) * 2);
    case 'torusKnot':
      return new THREE.TorusKnotGeometry(o.radius ?? 1, o.tube ?? 0.3, (o.res ?? 64) * 2, o.res ?? 64, o.p ?? 2, o.q ?? 3);
    case 'cylinder':
      return new THREE.CylinderGeometry(o.radiusTop ?? 0.5, o.radiusBottom ?? 0.5, o.height ?? 1.5, o.res ?? 48, o.res ?? 48);
    case 'icosa':
      return new THREE.IcosahedronGeometry(o.radius ?? 1, o.detail ?? 8);
    case 'text3d': {
      const bevel = o.bevel ?? 0.02;
      const g = new TextGeometry(String(resolve(o.text ?? 'text', 0)), {
        font: extra.font ?? (o.weight === 'bold' ? FONTS.bold : FONTS.regular),
        size: o.size ?? 1,
        depth: o.depth ?? 0.25,
        curveSegments: o.res ?? 8,
        bevelEnabled: bevel > 0,
        bevelThickness: bevel,
        bevelSize: bevel * 0.6,
        bevelSegments: 3,
      });
      if (o.center !== false) g.center();
      return g;
    }
    default:
      throw new Error(`unknown geometry: ${type}`);
  }
}

// The stand-in for one copy handed to .instance()'s fn: the chain's transform
// verbs, applied to a single instance. It's the same geometry, so the method
// names are the same — but an InstancedMesh is one mesh with one material, so
// only what lives in the per-instance matrix (plus instanceColor) can differ
// between copies. The rest belongs on the chain and says so rather than
// silently doing nothing. Reused across every instance and every frame, hence
// reset() and the flat fields: this fn runs count times per frame.
class InstanceHandle {
  constructor() { this.reset(); }

  reset() {
    this.px = this.py = this.pz = 0;
    this.rx = this.ry = this.rz = 0;
    this.sx = this.sy = this.sz = 1;
    this.col = null;
  }

  pos(x = 0, y = 0, z = 0) { this.px = x; this.py = y; this.pz = z; return this; }
  rotate(x = 0, y = 0, z = 0) { this.rx = x; this.ry = y; this.rz = z; return this; }
  scale(x = 1, y, z) { this.sx = x; this.sy = y ?? x; this.sz = z ?? x; return this; }
  // tints this copy: multiplied with the chain's .material() color
  color(c) { this.col = c; return this; }

  material(o = {}) {
    const extra = Object.keys(o).filter((k) => k !== 'color');
    if (extra.length) {
      // a misspelling is worth saying so, rather than explaining why the
      // property the sketch didn't actually name belongs on the chain
      checkMaterialKeys(o);
      throw new Error(
        `instance: ${extra.join('/')} is one material for the whole batch, not per-instance — put .material() on the chain (.color() is the exception, it varies per copy)`
      );
    }
    if (o.color !== undefined) this.col = o.color;
    return this;
  }

  noise() {
    throw new Error('instance: .noise() is one shader for the whole batch — put it on the chain before .instance() (each copy already seeds the field from its own position)');
  }
  shadow() {
    throw new Error('instance: the batch is one mesh, so it casts and receives as one — put .shadow() on the chain');
  }
  instance() {
    throw new Error("instance: an instance can't be instanced — raise the count instead");
  }
  out() {
    throw new Error('instance: .out() ends the chain, not a copy — call it after .instance()');
  }
}

class GeoOp {
  constructor(engine, type, opts) {
    this.engine = engine;
    this.type = type;
    this.opts = opts ?? {};
    this._pos = [0, 0, 0];
    this._rot = [0, 0, 0];
    this._scale = [1, 1, 1];
    this._noise = null;
    this._instance = null;
    this._material = {};
    this._shadow = null;      // null = whatever the material implies (see out())
  }

  pos(x = 0, y = 0, z = 0) { this._pos = [x, y, z]; return this; }
  rotate(x = 0, y = 0, z = 0) { this._rot = [x, y, z]; return this; }
  scale(x = 1, y, z) { this._scale = [x, y ?? x, z ?? x]; return this; }

  // Every mesh casts and receives by default — it's free until some light is
  // given shadow: true, and "I enabled shadows and nothing happened" is a worse
  // default than a shadow you didn't want. .shadow(false) opts a mesh out of
  // both; { cast, receive } picks one, e.g. a glowing lamp box that lights the
  // room without blocking it, or a floor that only catches. Saying it either
  // way also overrides the see-through exception in out().
  shadow(v = true) {
    if (v !== null && typeof v === 'object') {
      this._shadow = { cast: v.cast ?? true, receive: v.receive ?? true };
    } else {
      this._shadow = { cast: !!v, receive: !!v };
    }
    return this;
  }

  // amp: displacement amount · freq: spatial frequency · octaves: fbm
  // harmonics (1–8) · lacunarity/gain: per-octave freq/amp multipliers ·
  // speed: how fast the field evolves over time
  noise(o = {}) {
    this._noise = {
      amp: o.amp ?? 0.3,
      freq: o.freq ?? 1.5,
      octaves: o.octaves ?? 3,
      lacunarity: o.lacunarity ?? 2,
      gain: o.gain ?? 0.5,
      speed: o.speed ?? 0.3,
      seed: o.seed ?? 0,
    };
    return this;
  }

  // instance(count, fn) — fn(x, i, count, t) transforms copy `i` through the
  // same verbs as the chain (x.pos/.rotate/.scale/.color). It runs every
  // frame, so instances animate.
  instance(count, fn) {
    this._instance = { count, fn: fn ?? ((x, i) => x.pos(i * 2, 0, 0)) };
    return this;
  }

  // A naked .material() means "I want a material and haven't got one yet":
  // it opens the Poly Haven browser and fills the pick back into this very
  // call, the same way an empty videofile() opens a picker. .material({})
  // is still an explicit no-op.
  material(o) {
    if (o === undefined) this.engine.requestBrowse('material', 'textures');
    else {
      // checked here rather than at .out() so the error lands on the line that
      // wrote the typo, and before a half-configured material is ever built
      checkMaterialKeys(o);
      Object.assign(this._material, o);
    }
    return this;
  }
  color(c) { this._material.color = c; return this; }

  out(name) {
    let pendingFont = null;
    if (this.type === 'text3d') {
      const resolved = resolveFont(this.opts);
      this._font = resolved.font;
      pendingFont = resolved.pending;
    }
    // an imported .obj/.fbx: cached across re-runs, so this is usually
    // already parsed and `pending` resolves on the spot
    let pendingModel = null;
    if (this.type === 'model' && this.opts.name != null) {
      const m = this.engine.ensureModel(this.opts.name, this.opts);
      this._modelGeo = m.geometry;
      if (!m.geometry) pendingModel = m.pending;
    }
    const geometry = buildGeometry(this.type, this.opts, {
      font: this._font,
      geometry: this._modelGeo,
    });
    const m = this._material;
    const textured = hasMaps(m);
    // Glass, clearcoat, iridescence and friends live on the physical material,
    // which is the pricier shader — so the sketch opts in simply by naming one
    // of those properties, and everything else stays on standard.
    const Material = isPhysical(m) ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;
    const material = new Material({
      // A color map is tinted by material.color, so a textured chain that
      // didn't ask for a color starts white and shows the map as authored.
      // Transmission multiplies the light coming *through* the surface the same
      // way, so glass starts white too — the default tint would otherwise turn
      // every unpainted pane periwinkle. attenuationColor is how you tint it.
      color: new THREE.Color(
        resolve(m.color ?? (textured || m.transmission != null ? '#ffffff' : '#8899ff'), 0)
      ),
      // the roughness/metalness scalars multiply their maps, so they're reset
      // to 1 if and when one actually lands (see applyMaps)
      roughness: m.roughness ?? 0.5,
      metalness: m.metalness ?? 0.1,
      flatShading: m.flatShading ?? false,
      wireframe: m.wireframe ?? false,
      // imported models often have open shells or inconsistent winding, so
      // they get both sides by default like planes do; .material({ doubleSide })
      // overrides either way
      side: (m.doubleSide ?? (this.type === 'plane' || this.type === 'model'))
        ? THREE.DoubleSide
        : THREE.FrontSide,
    });
    if (m.emissive) {
      material.emissive = new THREE.Color(resolve(m.emissive, 0));
      material.emissiveIntensity = m.emissiveIntensity ?? 1;
    }
    applyMaterialScalars(material, m);
    const surfaceUpdate = applySurface(material, m);

    let noiseUniforms = null;
    if (this._noise) {
      noiseUniforms = {
        uTime: { value: 0 },
        uAmp: { value: 0 },
        uFreq: { value: 0 },
        uOctaves: { value: 0 },
        uLacunarity: { value: 0 },
        uGain: { value: 0 },
        uSpeed: { value: 0 },
        uSeed: { value: 0 },
      };
      applyNoise(material, noiseUniforms);
    }

    let mesh;
    const inst = this._instance;
    if (inst) {
      mesh = new THREE.InstancedMesh(geometry, material, inst.count);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    } else {
      mesh = new THREE.Mesh(geometry, material);
    }
    // The depth pass has no idea a surface is see-through, so glass and blended
    // shapes would throw the solid black shadow of their silhouette. They stay
    // out of it unless the sketch asks for them by name.
    const seeThrough =
      (m.transmission != null && resolve(m.transmission, 0) > 0) ||
      (m.opacity != null && resolve(m.opacity, 0) < 1);
    const sh = this._shadow ?? { cast: !seeThrough, receive: true };
    mesh.castShadow = sh.cast;
    mesh.receiveShadow = sh.receive;
    // A shadow pass renders its own depth material, which knows nothing about
    // the displacement patched into the one above — so it gets the same patch,
    // or the shape's shadow is the shadow of the sphere it started as.
    if (noiseUniforms && mesh.castShadow) {
      mesh.customDepthMaterial = new THREE.MeshDepthMaterial();
      applyNoiseDepth(mesh.customDepthMaterial, noiseUniforms);
      mesh.customDistanceMaterial = new THREE.MeshDistanceMaterial();
      applyNoiseDepth(mesh.customDistanceMaterial, noiseUniforms);
    }

    const dummy = new THREE.Object3D();
    const handle = inst ? new InstanceHandle() : null;
    const instColor = inst ? new THREE.Color() : null;
    // Replace a live mesh's geometry (async font/model, changed text3d
    // string). An InstancedMesh caches bounds of its own for frustum culling,
    // which have to be invalidated or the mesh stays culled at the old size —
    // and a geometry that started out empty would never be drawn at all. Only
    // an InstancedMesh, though: three picks that path by testing whether
    // `boundingSphere` is defined at all, so giving a plain Mesh a null one
    // sends it down a branch calling a method it doesn't have.
    const swapGeometry = (g) => {
      mesh.geometry.dispose();
      mesh.geometry = g;
      if (mesh.isInstancedMesh) {
        mesh.boundingSphere = null;
        mesh.boundingBox = null;
      }
    };
    // text3d with a fn for content rebuilds its geometry when the string
    // changes (e.g. a clock) — not every frame
    let lastText = this.type === 'text3d' ? String(resolve(this.opts.text ?? 'text', 0)) : null;
    const rebuildText = (s) => {
      swapGeometry(buildGeometry('text3d', { ...this.opts, text: s }, { font: this._font }));
    };
    // async font arrived: swap the geometry in place (unless the patch was
    // cleared in the meantime)
    pendingFont?.then((f) => {
      this._font = f;
      if (mesh.parent) rebuildText(lastText);
    }).catch(() => { /* already warned in resolveFont */ });
    // same deal for a model file: the mesh (instanced or not) starts empty and
    // picks up the real geometry once the file is parsed
    pendingModel?.then((g) => {
      if (!g || !mesh.parent) return;
      this._modelGeo = g;
      swapGeometry(g.clone());
    }).catch(() => { /* already warned in ensureModel */ });
    const updater = (t) => {
      // colors as fns of t (e.g. a .select() signal cycling a palette)
      if (typeof m.color === 'function') material.color.set(m.color(t));
      if (typeof m.emissive === 'function') material.emissive.set(m.emissive(t));
      // opacity + any physical property given as a fn of t
      surfaceUpdate?.(t);
      if (lastText !== null && typeof this.opts.text === 'function') {
        const s = String(this.opts.text(t));
        if (s !== lastText) {
          lastText = s;
          rebuildText(s);
        }
      }
      mesh.position.set(...resolve3(this._pos, t));
      mesh.rotation.set(...resolve3(this._rot, t));
      mesh.scale.set(...resolve3(this._scale, t));

      if (noiseUniforms) {
        const n = this._noise;
        noiseUniforms.uTime.value = t;
        noiseUniforms.uAmp.value = resolve(n.amp, t);
        noiseUniforms.uFreq.value = resolve(n.freq, t);
        noiseUniforms.uOctaves.value = Math.min(8, Math.max(1, resolve(n.octaves, t)));
        noiseUniforms.uLacunarity.value = resolve(n.lacunarity, t);
        noiseUniforms.uGain.value = resolve(n.gain, t);
        noiseUniforms.uSpeed.value = resolve(n.speed, t);
        noiseUniforms.uSeed.value = resolve(n.seed, t);
      }

      if (inst) {
        for (let i = 0; i < inst.count; i++) {
          handle.reset();
          const d = inst.fn(handle, i, inst.count, t);
          // the pre-handle signature was fn(i, n, t) returning { pos, rot,
          // scale }: under this one its `i` is the handle, so the math quietly
          // goes NaN. Name it instead of rendering nothing. (A concise arrow —
          // x => x.pos(...) — hands the handle itself back, which is fine.)
          if (i === 0 && d && d !== handle && (d.pos || d.rot || d.scale)) {
            throw new Error('instance: the layout fn is now (x, i, n, t) and transforms x directly — x.pos(...).rotate(...).scale(...) instead of returning { pos, rot, scale }');
          }
          dummy.position.set(resolve(handle.px, t), resolve(handle.py, t), resolve(handle.pz, t));
          dummy.rotation.set(resolve(handle.rx, t), resolve(handle.ry, t), resolve(handle.rz, t));
          dummy.scale.set(resolve(handle.sx, t), resolve(handle.sy, t), resolve(handle.sz, t));
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
          // setColorAt allocates instanceColor (all white) on first use, so
          // copies that never tint keep the material's own color, and three
          // rebuilds the program itself once the attribute shows up. Once the
          // buffer exists every copy writes every frame, or a tint set on one
          // frame would stick around after it stops being set.
          if (handle.col !== null) mesh.setColorAt(i, instColor.set(resolve(handle.col, t)));
          else if (mesh.instanceColor) mesh.setColorAt(i, instColor.setRGB(1, 1, 1));
        }
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    };

    updater(0);
    // .out('name'): render into a named layer (pulled as a TOP by
    // input('name')) instead of the visible scene
    if (name != null) mesh.layers.set(this.engine.geoLayer(String(name)));
    this.engine.add(mesh, updater);
    // after add(), so mesh.parent is already set: a cached map attaches on the
    // spot, and mesh.parent is also the liveness test for one that arrives
    // later — a patch cleared in the meantime has nowhere to put it
    if (textured) applyMaps(this.engine, material, m, () => !!mesh.parent);
    return this;
  }
}

// shadow: true on a light, or shadow: { ... } to tune it. Every option below
// is one three.js property; only the defaults are ours, sized for the 10–30
// unit scenes these sketches work at rather than three's own.
//   map        shadow map resolution in px (2048, 1024 for a point light —
//              that one is a cube, so it costs six renders)
//   soft       PCF sample spread in texels: 0 is hard-edged, ~8 is overcast
//   strength   0..1, how dark the shadow gets
//   bias       depth offset that kills self-shadowing acne (negative)
//   normalBias same, along the normal — the one that helps on flat floors
//   near/far   the light's own view range; anything outside casts nothing
//   area       directional only: half-width of the shadowed box around the
//              .pos() → .target() axis. Too big blurs detail away, too small
//              clips the shadow off mid-floor.
function applyShadow(light, o) {
  if (!o) return;
  if (!light.shadow) {
    throw new Error(`${light.type}: this light has no direction to cast from — shadows come from directional(), spot() or point()`);
  }
  const c = o === true ? {} : o;
  const s = light.shadow;
  light.castShadow = true;
  const map = c.map ?? (light.isPointLight ? 1024 : 2048);
  s.mapSize.set(map, map);
  s.radius = c.soft ?? 3;
  s.intensity = c.strength ?? 1;
  s.bias = c.bias ?? -0.0005;
  s.normalBias = c.normalBias ?? 0.02;
  s.camera.near = c.near ?? 0.5;
  // three's own far is 500, which spends most of the depth buffer on empty
  // space and stripes the floor with acne
  s.camera.far = c.far ?? (light.isPointLight ? 60 : 120);
  if (light.isDirectionalLight) {
    const a = c.area ?? 15;
    s.camera.left = -a;
    s.camera.right = a;
    s.camera.top = a;
    s.camera.bottom = -a;
  }
  // a spot light re-derives fov (and far, from distance) from the light itself
  s.camera.updateProjectionMatrix();
}

class LightOp {
  constructor(engine, light, opts = {}) {
    this.engine = engine;
    this.light = light;
    this.opts = opts;
    this._pos = [3, 4, 2];
    this._target = null;
  }
  pos(x, y, z) {
    if (this.light.isAmbientLight) {
      throw new Error('ambient: arrives evenly from every direction, so it has nowhere to be — hemi(), directional() or point() light from somewhere');
    }
    this._pos = [x, y, z];
    return this;
  }
  // Where a directional or spot light points; both aim at the origin without
  // it. Components take fns of t like .pos, so the beam can sweep.
  target(x = 0, y = 0, z = 0) {
    if (!this.light.target) {
      throw new Error(`${this.light.type}: shines every way at once — .target() is for directional() and spot()`);
    }
    this._target = [x, y, z];
    return this;
  }
  out(name) {
    // lights hit every layer by default (three culls lights by camera layer
    // mask); .out('name') restricts one to a single named geometry layer
    if (name != null) this.light.layers.set(this.engine.geoLayer(String(name)));
    else this.light.layers.enableAll();
    // ambient() adds itself, so calling .out() on one only re-layers it
    if (this._added) return this;
    this._added = true;
    // intensity and colour animate like everything else in the API. They have
    // to be driven from here: three folds intensity into the light's colour
    // uniform with multiplyScalar(), so a raw fn left on light.intensity gives
    // NaN — and a NaN light uniform blacks out every surface it touches rather
    // than merely failing to animate.
    const o = this.opts;
    applyShadow(this.light, o.shadow);
    const dyn = ['intensity', 'color', 'sky', 'ground', 'angle', 'penumbra', 'distance', 'decay']
      .filter((k) => typeof o[k] === 'function');
    // an ambient light has no position to write, so a static one needs no
    // updater at all
    const placed = !this.light.isAmbientLight;
    const updater = (t) => {
      if (placed) this.light.position.set(...resolve3(this._pos, t));
      if (this._target) {
        this.light.target.position.set(...resolve3(this._target, t));
        // the target isn't in the scene graph, so nothing else refreshes it —
        // and both the light's direction and its shadow camera read matrixWorld
        this.light.target.updateMatrixWorld();
      }
      for (const k of dyn) {
        if (k === 'ground') this.light.groundColor.set(o.ground(t));
        else if (k === 'color' || k === 'sky') this.light.color.set(o[k](t));
        else this.light[k] = o[k](t);
      }
    };
    updater(0);
    this.engine.add(this.light, placed || dyn.length ? updater : undefined);
    return this;
  }
}

export function makeApi(engine) {
  setBpmSource(() => engine.bpm);
  const geo = (type) => (opts) => new GeoOp(engine, type, opts);

  const api = {
    sphere: geo('sphere'),
    box: geo('box'),
    plane: geo('plane'),
    torus: geo('torus'),
    torusKnot: geo('torusKnot'),
    cylinder: geo('cylinder'),
    icosa: geo('icosa'),
    text3d: (text, opts) => new GeoOp(engine, 'text3d', { ...opts, text }),

    // An imported .obj/.fbx as a geometry op — chain .pos/.rotate/.scale/
    // .noise/.instance/.material/.out() exactly like sphere() or box().
    // Drag a model into the window to import it (the drop types the call),
    // or run an empty model() for a file picker. name = filename, exact or
    // case-insensitive substring. Every mesh in the file is merged into one
    // geometry; its materials/textures are dropped in favour of .material().
    // Options: center (default true) and fit (default 2 — scale the longest
    // axis to this, so any file lands at a usable size; fit: 0 keeps the
    // file's own units). Parsing is async and cached across re-runs: the
    // mesh is empty for the first frames after a fresh import.
    model(name, opts = {}) {
      if (name !== null && typeof name === 'object') { opts = name; name = opts.name; }
      if (name == null) engine.requestMediaPick('model', 'model');
      return new GeoOp(engine, 'model', { ...opts, name: name != null ? String(name) : null });
    },

    // Every light arg below may be a fn of t; they're resolved once here so the
    // constructor sees a number, and again per frame by LightOp's updater.
    // directional/spot/point also take shadow: true (see applyShadow), and
    // directional/spot aim with .target(x, y, z).
    //
    // ambient is the one with nowhere to be and nothing to aim at, so it adds
    // itself rather than waiting for an .out() that would have nothing to say;
    // .out('name') still works, to light a single layer. Positional
    // ambient(intensity, color) predates the config form.
    ambient(intensity = 0.3, color = 0xffffff) {
      if (typeof intensity === 'object' && intensity !== null) ({ intensity = 0.3, color = 0xffffff } = intensity);
      const light = new THREE.AmbientLight(resolve(color, 0), resolve(intensity, 0));
      return new LightOp(engine, light, { intensity, color }).out();
    },
    directional(o = {}) {
      return new LightOp(engine, new THREE.DirectionalLight(
        resolve(o.color ?? 0xffffff, 0), resolve(o.intensity ?? 1.5, 0)), o);
    },
    point(o = {}) {
      return new LightOp(engine, new THREE.PointLight(
        resolve(o.color ?? 0xffffff, 0), resolve(o.intensity ?? 20, 0),
        resolve(o.distance ?? 0, 0), resolve(o.decay ?? 2, 0)), o);
    },
    // a cone from .pos() toward .target(): angle is its half-width in radians,
    // penumbra (0..1) how soft the rim is
    spot(o = {}) {
      return new LightOp(engine, new THREE.SpotLight(
        resolve(o.color ?? 0xffffff, 0), resolve(o.intensity ?? 60, 0),
        resolve(o.distance ?? 0, 0), resolve(o.angle ?? Math.PI / 6, 0),
        resolve(o.penumbra ?? 0.4, 0), resolve(o.decay ?? 2, 0)), o);
    },
    hemi(o = {}) {
      return new LightOp(engine, new THREE.HemisphereLight(
        resolve(o.sky ?? 0x8899ff, 0), resolve(o.ground ?? 0x332211, 0), resolve(o.intensity ?? 0.6, 0)), o);
    },

    // static args: place the camera, orbit controls stay live.
    // any function arg: the sketch drives the camera and orbiting is disabled
    // until the next re-run without a programmed camera.
    camera(x = 0, y = 2, z = 8, target = [0, 0, 0]) {
      const dynamic = [x, y, z, ...target].some((v) => typeof v === 'function');
      if (!dynamic) {
        engine.camera.position.set(x, y, z);
        engine.controls.target.set(...target);
        return;
      }
      engine.cameraProgrammed = true;
      engine.controls.enabled = false;
      engine.updaters.push((t) => {
        engine.camera.position.set(resolve(x, t), resolve(y, t), resolve(z, t));
        const tg = resolve3(target, t);
        engine.controls.target.set(...tg);
        engine.camera.lookAt(...tg);
      });
    },
    // Image-based lighting from an imported .hdr/.exr: the environment lights
    // every material in the scene (and is the only thing a metal surface has
    // to reflect, so metalness only really comes alive with one) and shows
    // behind it as the background. Run an empty hdri() to browse Poly Haven's
    // HDRIs (the pick fills itself into the call), or drag a file in.
    // Options: background (false keeps bg()/fog), intensity, blur (0..1, soft
    // sky without softening the lighting), rotation (radians, turns the light
    // rig and the sky together), backgroundRotation / backgroundIntensity to
    // move the sky alone. All but `background` accept fns of t.
    hdri(name, o = {}) {
      if (name !== null && typeof name === 'object') { o = name; name = o.name; }
      if (name == null) return engine.requestBrowse('hdri', 'hdris');
      const h = engine.ensureHdri(String(name));
      // the sketch's own intensity/rotation animate from the first frame even
      // while the file is still decoding; applyHdri hands back the per-frame
      // half so both paths share one updater
      let tick = null;
      const gen = engine.patchGen;
      const attach = (loaded) => {
        // a re-run since the load started owns the scene now — don't light it
        if (loaded && engine.patchGen === gen) tick = applyHdri(engine, loaded, o);
      };
      if (h.env) attach(h);
      else h.pending.then(attach);
      engine.updaters.push((t) => tick?.(t, resolve));
    },
    bg(color) { engine.scene.background = new THREE.Color(color); },
    // positional fog(color, near, far) predates the config form; a THREE.Color
    // in the first slot is still a color, not a config
    fog(color = 0x0a0a0f, near = 5, far = 30) {
      if (typeof color === 'object' && color !== null && !color.isColor) {
        ({ color = 0x0a0a0f, near = 5, far = 30 } = color);
      }
      engine.scene.fog = new THREE.Fog(color, near, far);
    },

    // TOPs — texture operators (see tops.js). Chains render only with .out()
    scene: () => new TopOp(engine, 'scene'),
    // the same render as scene(), as a grayscale distance map: black near,
    // white far. depth({ near, far }) sets the world-space range it spans
    // (defaulting to the sketch's fog, else 0..20); depth({ focus, range })
    // instead measures distance from a focal plane, which is a DOF blur mask.
    // Pairs with .mask(m, fn): scene().mask(depth(), s => s.blur(8)).
    depth: (o) => new TopOp(engine, 'depth', o ?? {}),
    // input() = last frame's display output; input('name') = the buffer
    // published by .out('name'). ('in' is a JS reserved word, hence 'input'.)
    input: (name) => new TopOp(engine, 'in', name != null ? { name: String(name) } : {}),
    ramp: (o) => new TopOp(engine, 'ramp', o ?? {}),
    circle: (o) => new TopOp(engine, 'circle', o ?? {}),
    noise: (o) => new TopOp(engine, 'noiseGen', o ?? {}),
    text: (text, o) => new TopOp(engine, 'textGen', { ...o, text }),
    // camera capture as a TOP; name matches a camera label (substring,
    // case-insensitive), no name = default camera. Permission prompt on
    // first use; the stream survives re-runs.
    video: (name) => new TopOp(engine, 'video', name != null ? { name: String(name) } : {}),

    // Imported media files: drag a file into the window to import it (the
    // drop also types the call for you), or run an empty call for a picker.
    // name = filename, exact or case-insensitive substring; files persist
    // in the browser across reloads and keep playing through re-runs.
    videofile(name, o = {}) {
      if (name !== null && typeof name === 'object') { o = name; name = o.name; }
      if (name == null) engine.requestMediaPick('videofile', 'video');
      return new TopOp(engine, 'videofile', { ...o, name: name != null ? String(name) : null });
    },
    imagefile(name) {
      if (Array.isArray(name)) return api.imageseq(name);
      if (name == null) engine.requestMediaPick('imagefile', 'image');
      return new TopOp(engine, 'imagefile', { name: name != null ? String(name) : null });
    },
    // several images with an index picking the current one — any fn of t or
    // signal (floored, wrapped): imageseq([...], beat(1).counter()) steps on
    // the beat, .hold(audio().kicks()).counter() on kicks. Default: 1/sec.
    imageseq(names, index) {
      if (names == null || !names.length) {
        engine.requestMediaPick('imageseq', 'image', true);
        names = [];
      }
      return new TopOp(engine, 'imageseq', { names: names.map(String), index });
    },

    // audio input as signals — fns of t with chainable processing, so they
    // drop into any parameter. audio() = mono mix of the sidebar's device,
    // audio(2) = one channel by index, audio('scarlett') = a device by label
    // (case-insensitive substring), audio('scarlett', 2) = a channel of it.
    // First use starts capture. See audio.js / engine.ensureAudio.
    audio(chan, chan2) {
      let name;
      if (typeof chan === 'string') { name = chan; chan = chan2; }
      const ae = audioIn(name);
      return sig((t) => (chan == null ? ae.level : ae.levels[chan] ?? 0), ae);
    },
    // An imported audio file, played out loud and analysed like audio():
    // returns its level as a signal with the same chainable methods
    // (.kicks/.lowpass/...). Empty call = file picker. Options: volume,
    // speed, loop (default true), restart (fn of t, rising edge rewinds),
    // chan (analyse one channel). Numeric second arg = chan.
    audiofile(name, o = {}) {
      if (typeof o === 'number') o = { chan: o };
      if (name !== null && typeof name === 'object') { o = name; name = o.name; }
      if (name == null) {
        engine.requestMediaPick('audiofile', 'audio');
        return sig(() => 0);
      }
      const m = engine.ensureMedia('audio', String(name));
      let restartPrev = Infinity; // Infinity: a trigger already high at t0 doesn't fire
      engine.updaters.push((t) => {
        if (o.volume != null) m.ae.setVolume(resolve(o.volume, t));
        if (!m.el) return;
        if (o.speed != null) m.el.playbackRate = Math.max(0, resolve(o.speed, t));
        if (o.loop != null) m.el.loop = resolve(o.loop, t) >= 0.5;
        if (o.restart != null) {
          const v = resolve(o.restart, t);
          if (v >= 0.5 && restartPrev < 0.5) m.el.currentTime = 0;
          restartPrev = v;
        }
      });
      return sig((t) => (o.chan == null ? m.ae.level : m.ae.levels[o.chan] ?? 0), m.ae);
    },
    // rewind imported media files (all, or by name substring) — also on ctrl+r
    restartMedia: (name) => engine.restartMedia(name),
    // tempo-synced phase ramp: 0..1 over `div` beats (tempo set in the
    // sidebar). Shape it — beat(2).sin() is a two-beat LFO, beat(0.25).sqr()
    // gates on sixteenths, beat(4).counter().select([...]) walks a list per bar
    beat(div = 1) {
      return sig((t) => {
        const phase = (t * engine.bpm) / 60 / resolve(div, t);
        return phase - Math.floor(phase);
      });
    },
    // smooth random signal (deterministic value noise of t, 0..1) — the
    // signal-space cousin of the noise() TOP. freq in Hz-ish wiggles/sec;
    // different seeds give independent signals. Pairs with .beat()/.hold():
    // rand().beat(4) freezes a new random value each bar,
    // rand().hold(audio().kicks()) one on every kick.
    // rand({ freq, seed }) and positional rand(freq, seed) both work.
    rand(freq = 1, seed = 0) {
      if (typeof freq === 'object' && freq !== null) ({ freq = 1, seed = 0 } = freq);
      return sig((t) => valueNoise(t * resolve(freq, t) + seed * 137.31));
    },
    // lift any fn of t into a chainable signal: sig(t => Math.sin(t)).smooth()
    sig: (fn) => sig((t) => resolve(fn, t)),
    // escape hatches
    THREE,
    onFrame(fn) { engine.updaters.push(fn); },
  };

  function audioIn(name) {
    return engine.ensureAudio(name);
  }

  return api;
}
