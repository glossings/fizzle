import * as THREE from 'three';
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js';

// Points scattered over a geometry's surface, behind geo.sample(i)/.normal(i).
//
// Index-addressed and deterministic: sample(i) is the i-th draw from a seeded
// stream, so it doesn't depend on how many points get asked for or in what
// order, and a re-run puts every copy back where it was. Livecoding a color
// shouldn't reshuffle the scatter.
//
// Draws are area-weighted across triangles, so a long thin face gets its share
// and a sphere's crowded poles don't hoard.

const SEED = 0x5eed;
// a typo'd index (a stray i * n) shouldn't quietly try to allocate for hours
const MAX = 1e6;

function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class PointSet {
  constructor(geometry) {
    this.sampler = new MeshSurfaceSampler(new THREE.Mesh(geometry)).build();
    this.sampler.setRandomGenerator(mulberry32(SEED));
    this.points = [];
    this.normals = [];
  }

  at(i) {
    const n = Math.floor(i);
    if (!(n >= 0)) return 0;
    if (n > MAX) throw new Error(`sample: index ${n} is past the ${MAX} point limit — is the index an i * n rather than an i?`);
    const p = new THREE.Vector3();
    const nm = new THREE.Vector3();
    while (this.points.length <= n) {
      this.sampler.sample(p, nm);
      this.points.push(p.clone());
      this.normals.push(nm.clone());
    }
    return n;
  }

  // clones, because these are the cache: .sample(i).multiplyScalar(2) in a
  // sketch would otherwise move the point for good
  point(i) { return this.points[this.at(i)].clone(); }
  normal(i) { return this.normals[this.at(i)].clone(); }
}

// null for a geometry with nothing on it to sample — an imported model still
// parsing, mostly, which becomes a real point set once the file lands
export function makePointSet(geometry) {
  const pos = geometry.getAttribute('position');
  if (!pos || pos.count < 3) return null;
  // sample() only writes a normal when the attribute exists, and models often
  // arrive without one — better to compute it than hand back a (0,0,0) that
  // silently flattens every .rotate(pts.normal(i))
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
  return new PointSet(geometry);
}
