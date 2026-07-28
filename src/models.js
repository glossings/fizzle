// Imported 3D model files (.obj / .fbx). Files arrive by drag & drop and live
// in IndexedDB like the other imported media; parsing collapses whatever
// hierarchy the file has into ONE BufferGeometry, because a geometry chain in
// this API is a single mesh (and a single InstancedMesh once instanced).
// Materials and textures from the file are dropped — the chain's .material()
// is what shades it.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// An FBX names texture files that were never part of the drop. We only keep
// geometry, so send every external request to a 1x1 transparent GIF rather
// than let a pile of 404s through.
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const manager = new THREE.LoadingManager();
manager.setURLModifier(() => BLANK);

// merging needs every part to carry the same attributes, and the shaders only
// ever read these three
const KEEP = ['position', 'normal', 'uv'];

function prepare(mesh) {
  const src = mesh.geometry;
  if (!src?.attributes?.position) return null;
  const g = src.index ? src.toNonIndexed() : src.clone();
  for (const name of Object.keys(g.attributes)) {
    if (!KEEP.includes(name)) g.deleteAttribute(name);
  }
  g.morphAttributes = {};
  g.clearGroups();
  g.applyMatrix4(mesh.matrixWorld); // bake the file's own transform hierarchy
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) {
    const uv = new Float32Array(g.attributes.position.count * 2);
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }
  return g;
}

function flatten(root) {
  root.updateMatrixWorld(true);
  const parts = [];
  root.traverse((child) => {
    if (!child.isMesh) return;
    const g = prepare(child);
    if (g) parts.push(g);
  });
  // the loader's own geometries/materials are dead to us — prepare() copied
  // everything it needs
  root.traverse((child) => {
    child.geometry?.dispose?.();
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    for (const m of mats) m?.dispose?.();
  });
  if (!parts.length) throw new Error('no meshes found in the file');
  if (parts.length === 1) return parts[0];
  const merged = mergeGeometries(parts);
  for (const g of parts) g.dispose();
  if (!merged) throw new Error('could not merge the meshes in the file');
  return merged;
}

// Model files come in wildly different units (an FBX is often authored in
// centimetres, so it lands 100x too big) and rarely sit at the origin. By
// default we center the geometry and scale it to `fit` across its longest
// axis, which puts every model in the same ballpark as sphere()/box() and
// makes .instance() layouts predictable. fit: 0 keeps the file's own units.
function normalize(g, { center, fit }) {
  g.computeBoundingBox();
  const size = g.boundingBox.getSize(new THREE.Vector3());
  const mid = g.boundingBox.getCenter(new THREE.Vector3());
  if (center) g.translate(-mid.x, -mid.y, -mid.z);
  const longest = Math.max(size.x, size.y, size.z);
  if (fit > 0 && longest > 0) {
    const s = fit / longest;
    g.scale(s, s, s); // about the origin — with center: false this also moves it
  }
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

// the FBX parser is a big dependency for a feature most sketches never touch —
// pulled in on the first model import instead of at page load
export async function loadModelGeometry(blob, filename, o = {}) {
  const ext = String(filename).split('.').pop()?.toLowerCase();
  let root;
  if (ext === 'obj') {
    const { OBJLoader } = await import('three/addons/loaders/OBJLoader.js');
    root = new OBJLoader(manager).parse(await blob.text());
  } else if (ext === 'fbx') {
    const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js');
    root = new FBXLoader(manager).parse(await blob.arrayBuffer(), '');
  } else {
    throw new Error(`unsupported model format ".${ext}" — use .obj or .fbx`);
  }
  return normalize(flatten(root), o);
}
