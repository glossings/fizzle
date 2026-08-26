import * as THREE from 'three';

// .lines({ dir }) draws a shape as the rows and columns of its vertex grid.
// Every parametric geometry three builds is one or more (cols+1)×(rows+1)
// grids laid out row-major, so the segments are an index buffer over the
// vertices it already has — same positions, uvs and normals, so every
// deformer and map still applies. Shapes with no grid (models, text, icosa)
// fall back to their triangle edges, which is also what .wire() asks for.

// grids as [cols, rows], in vertex order; a cylinder's caps and anything past
// the listed grids are left alone
function grids(g) {
  const p = g.parameters;
  switch (g.type) {
    case 'PlaneGeometry':
    case 'SphereGeometry':
      return [[p.widthSegments, p.heightSegments]];
    case 'TorusGeometry':
      return [[p.tubularSegments, p.radialSegments]];
    case 'TorusKnotGeometry':
      return [[p.radialSegments, p.tubularSegments]];
    case 'CylinderGeometry':
      return [[p.radialSegments, p.heightSegments]];
    case 'CapsuleGeometry':
      return [[p.radialSegments, p.capSegments * 2 + p.heightSegments]];
    case 'BoxGeometry': {
      const { widthSegments: w, heightSegments: h, depthSegments: d } = p;
      return [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    }
    default:
      return null;
  }
}

function gridIndex(gs, dir) {
  const out = [];
  let base = 0;
  for (const [cols, rows] of gs) {
    const c1 = cols + 1;
    if (dir !== 'y') {
      for (let iy = 0; iy <= rows; iy++) {
        for (let ix = 0; ix < cols; ix++) out.push(base + iy * c1 + ix, base + iy * c1 + ix + 1);
      }
    }
    if (dir !== 'x') {
      for (let iy = 0; iy < rows; iy++) {
        for (let ix = 0; ix <= cols; ix++) out.push(base + iy * c1 + ix, base + (iy + 1) * c1 + ix);
      }
    }
    base += c1 * (rows + 1);
  }
  return out;
}

// every triangle edge once
function edgeIndex(g) {
  const n = g.attributes.position.count;
  const idx = g.index ? g.index.array : null;
  const tris = idx ? idx.length : n;
  const seen = new Set();
  const out = [];
  const edge = (a, b) => {
    const k = a < b ? a * n + b : b * n + a;
    if (seen.has(k)) return;
    seen.add(k);
    out.push(a, b);
  };
  for (let i = 0; i + 2 < tris; i += 3) {
    const a = idx ? idx[i] : i, b = idx ? idx[i + 1] : i + 1, c = idx ? idx[i + 2] : i + 2;
    edge(a, b); edge(b, c); edge(c, a);
  }
  return out;
}

// dir: 'x' | 'y' | 'xy' | 'edges'. Returns a geometry sharing g's attributes.
export function lineGeometry(g, dir) {
  const line = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(g.attributes)) line.setAttribute(name, attr);
  if (!g.attributes.position) return line;
  const gs = dir === 'edges' ? null : grids(g);
  line.setIndex(gs ? gridIndex(gs, dir) : edgeIndex(g));
  return line;
}
