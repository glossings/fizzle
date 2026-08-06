// Vertex displacement injected into MeshStandardMaterial via onBeforeCompile,
// so displaced geometry stays lit correctly (normals are recomputed on the
// GPU). Two sources, and a chain may use both at once — hence one patch built
// from flags rather than two that would overwrite each other's
// onBeforeCompile:
//   .noise()          an fbm field sampled in object space
//   .displace(map)    a texture read at the vertex's uv
//
// noise-cpu.js is a line-by-line JS twin of snoise/fbm/displacePoint and the
// normal reconstruction below, so geo.sample() can put points on the deformed
// surface. Edit the two together — a change here that isn't mirrored there
// doesn't break anything visibly, it just floats sampled points off the shape.
// dev-notes/NOISE-PARITY.md records the known precision traps and how to re-verify.
// The texture half has no CPU twin: reading a render target back per point is
// not something .sample() can afford, so it warns instead (see api.js).

import * as THREE from 'three';

// Ashima / stegu 3D simplex noise — pure functions, shared with the texture
// noise generator in textures.js
export const SNOISE_GLSL = /* glsl */ `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  // rank a nudged copy: step() answers 1 at equality, so on an exact three-way
  // tie all three comparisons pass, i1 collapses to 0 and i2 to 1, and two
  // corners get counted twice while two are dropped — one garbage value in an
  // otherwise smooth field. The nudge makes that tie unreachable. It moves the
  // sub-simplex boundaries by 1e-5, where the field is continuous anyway.
  vec3 r = x0 + vec3(0.0, 1e-5, 2e-5);
  vec3 g = step(r.yzx, r.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
`;

export const NOISE_GLSL = SNOISE_GLSL + /* glsl */ `
uniform float uTime;
uniform float uAmp;
uniform float uFreq;
uniform float uOctaves;
uniform float uLacunarity;
uniform float uGain;
uniform float uSpeed;
uniform float uSeed;

float fbm(vec3 p) {
  float sum = 0.0;
  float amp = 1.0;
  float freq = 1.0;
  float norm = 0.0;
  for (int i = 0; i < 8; i++) {
    if (float(i) >= uOctaves) break;
    sum += amp * snoise(p * freq);
    norm += amp;
    freq *= uLacunarity;
    amp *= uGain;
  }
  return norm > 0.0 ? sum / norm : 0.0;
}

// snoise ranks the three coordinates against each other to pick a sub-simplex,
// and that ranking is degenerate when all three are exactly equal: i1 collapses
// to 0 and i2 to 1, so two corners get counted twice and two dropped, and the
// point evaluates to garbage while everything around it stays smooth. Offsetting
// by a single scalar cancels out of the ranking's comparisons, which leaves the
// differences at exactly (p.x - p.y) * uFreq * lacunarity^i — so on a unit
// sphere, whose poles and axis vertices sit at differences of exactly 0 and 1,
// any octave landing on an integer scale ties all three and spikes that one
// vertex. These break that: unequal offsets so the differences are never whole,
// a time direction off the diagonal so they can't drift back. Mirrored in
// noise-cpu.js — see dev-notes/NOISE-PARITY.md.
const vec3 DOMAIN_OFFSET = vec3(0.0, 3.7, 8.3);
const vec3 TIME_DIR = vec3(1.0, 0.83, 0.61);

vec3 displacePoint(vec3 p, vec3 n, vec3 seed) {
  float d = fbm((p + seed) * uFreq + uTime * uSpeed * TIME_DIR + DOMAIN_OFFSET + uSeed * 19.19);
  return p + n * d * uAmp;
}
`;

// The texture half. dispDu/dispDv are dP/du and dP/dv, written onto the
// geometry by addUvBasis below — the map is a height field over uv, and turning
// its gradient there into one in world space is exactly what those two are.
// A colored map displaces by its brightness, so any texture chain is usable
// without a grayscale conversion first.
export const DISPLACE_GLSL = /* glsl */ `
uniform sampler2D uDispMap;
uniform float uDispAmount;
uniform float uDispMid;
attribute vec3 dispDu;
attribute vec3 dispDv;

// half a texel of a 1k map: fine enough to read real detail, wide enough that
// the difference isn't all rounding
const float DISP_EPS = 0.002;

float dispHeight(vec2 duv) {
  return dot(texture2D(uDispMap, duv).rgb, vec3(0.2126, 0.7152, 0.0722));
}
`;

// Replaces <beginnormal_vertex>: displaces the vertex, rebuilds the normal, and
// stashes the displaced position for the <begin_vertex> replacement below.
const NORMAL_HEAD = /* glsl */ `
vec3 objectNormal = vec3(normal);
#ifdef USE_TANGENT
  vec3 objectTangent = vec3(tangent.xyz);
#endif
vec3 nrm = normalize(normal);
vec3 displaced = position;
`;

// Finite differences along two tangent neighbors, so the normal follows the
// field rather than the shape it started as. When the mesh is instanced, the
// noise field is seeded per-instance from the instance matrix translation so
// copies don't all deform identically.
const NOISE_NORMAL = /* glsl */ `
vec3 tangentA = normalize(abs(nrm.y) < 0.99 ? cross(nrm, vec3(0.0, 1.0, 0.0)) : cross(nrm, vec3(1.0, 0.0, 0.0)));
vec3 tangentB = normalize(cross(nrm, tangentA));

vec3 noiseSeed = vec3(0.0);
#ifdef USE_INSTANCING
  noiseSeed = instanceMatrix[3].xyz;
#endif

float eps = 0.08;
displaced = displacePoint(position, nrm, noiseSeed);
vec3 displacedA = displacePoint(position + tangentA * eps, nrm, noiseSeed);
vec3 displacedB = displacePoint(position + tangentB * eps, nrm, noiseSeed);
objectNormal = normalize(cross(displacedA - displaced, displacedB - displaced));
`;

// A height field over a parameterized surface tilts the normal by its surface
// gradient: n' = n - grad(h), with the uv-space gradient carried into world
// space by the dP/du, dP/dv basis. Applied to whatever objectNormal already is,
// so .noise().displace(map) tilts the noised normal rather than replacing it.
// A degenerate uv triangle (a sphere's poles) has no basis to carry anything,
// and leaves the normal alone rather than dividing by zero.
const DISPLACE_NORMAL = /* glsl */ `
float dispH = dispHeight(uv);
float dispHu = (dispHeight(uv + vec2(DISP_EPS, 0.0)) - dispH) / DISP_EPS;
float dispHv = (dispHeight(uv + vec2(0.0, DISP_EPS)) - dispH) / DISP_EPS;
displaced += nrm * ((dispH - uDispMid) * uDispAmount);

float dispDet = dot(cross(dispDu, dispDv), nrm);
if (abs(dispDet) > 1e-6) {
  vec3 dispGrad = (dispHu * cross(dispDv, nrm) + dispHv * cross(nrm, dispDu)) / dispDet;
  objectNormal = normalize(objectNormal - dispGrad * uDispAmount);
}
`;

export const POSITION_CHUNK = /* glsl */ `
vec3 transformed = displaced;
`;

// The same displacement for the shadow pass. Depth and distance materials shade
// nothing, so only the position has to move — and their vertex shaders only
// reach <beginnormal_vertex> under USE_DISPLACEMENTMAP, so this hangs off
// <begin_vertex> (which is what it replaces: `vec3 transformed = position`).
const DEPTH_HEAD = /* glsl */ `
vec3 depthNrm = normalize(normal);
vec3 transformed = position;
`;

const NOISE_DEPTH = /* glsl */ `
vec3 depthNoiseSeed = vec3(0.0);
#ifdef USE_INSTANCING
  depthNoiseSeed = instanceMatrix[3].xyz;
#endif
transformed = displacePoint(position, depthNrm, depthNoiseSeed);
`;

const DISPLACE_DEPTH = /* glsl */ `
transformed += depthNrm * ((dispHeight(uv) - uDispMid) * uDispAmount);
`;

const join = (...parts) => parts.filter(Boolean).join('\n');

// `flags` is { noise, displace } — which sources this material actually uses.
// Both patch the same two chunks, so they're assembled together or the second
// one silently wins.
function chunks(flags) {
  return {
    common: join(flags.noise && NOISE_GLSL, flags.displace && DISPLACE_GLSL),
    normal: join(NORMAL_HEAD, flags.noise && NOISE_NORMAL, flags.displace && DISPLACE_NORMAL),
    depth: join(DEPTH_HEAD, flags.noise && NOISE_DEPTH, flags.displace && DISPLACE_DEPTH),
    // one program per combination, or three would share whichever compiled first
    key: `td-vd-${flags.noise ? 'n' : ''}${flags.displace ? 'd' : ''}`,
  };
}

// Patches a MeshStandardMaterial in place; `uniforms` must contain the
// uTime/uAmp/uDisp... uniform objects so the engine can animate them per frame.
export function applyDisplacement(material, flags, uniforms) {
  const c = chunks(flags);
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + c.common)
      .replace('#include <beginnormal_vertex>', c.normal)
      .replace('#include <begin_vertex>', POSITION_CHUNK);
  };
  material.customProgramCacheKey = () => c.key;
  material.needsUpdate = true;
}

// Same, for the MeshDepth/MeshDistanceMaterial a shadow pass renders with —
// share the uniform objects with applyDisplacement's and the shadow tracks the
// displacement instead of being cast by the undeformed shape.
export function applyDisplacementDepth(material, flags, uniforms) {
  const c = chunks(flags);
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + c.common)
      .replace('#include <begin_vertex>', c.depth);
  };
  material.customProgramCacheKey = () => `${c.key}-depth`;
  material.needsUpdate = true;
}

// dP/du and dP/dv per vertex, averaged over the faces the vertex belongs to.
// Deliberately not normalized: their magnitudes are the uv-to-world scale, so
// the shader can read a gradient in uv space and get one in world units —
// which is what makes .displace() light correctly on a sphere (where u covers
// 2*pi*r and v only pi*r) and on a plane alike. Written once, at .out().
//
// Returns false when there are no uvs to differentiate, which is the honest
// answer for an imported model that never had any: there is no map lookup to
// do either, so the caller drops the whole patch.
export function addUvBasis(geometry) {
  if (geometry.attributes.dispDu) return true;
  const pos = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  if (!pos || !uv || !pos.count) return false;

  const n = pos.count;
  const du = new Float32Array(n * 3);
  const dv = new Float32Array(n * 3);
  const faces = new Uint32Array(n);
  const index = geometry.index;
  const corners = index ? index.count : n;
  const tri = [0, 0, 0];

  for (let f = 0; f + 2 < corners; f += 3) {
    const a = tri[0] = index ? index.getX(f) : f;
    const b = tri[1] = index ? index.getX(f + 1) : f + 1;
    const c = tri[2] = index ? index.getX(f + 2) : f + 2;
    const s1 = uv.getX(b) - uv.getX(a), t1 = uv.getY(b) - uv.getY(a);
    const s2 = uv.getX(c) - uv.getX(a), t2 = uv.getY(c) - uv.getY(a);
    const det = s1 * t2 - s2 * t1;
    // a triangle that is a point in uv (a pole, a seam artefact) says nothing
    // about the mapping; skipping it leaves those vertices at zero, which the
    // shader reads as "no basis here" and steps over
    if (Math.abs(det) < 1e-12) continue;
    const r = 1 / det;
    const e1x = pos.getX(b) - pos.getX(a), e1y = pos.getY(b) - pos.getY(a), e1z = pos.getZ(b) - pos.getZ(a);
    const e2x = pos.getX(c) - pos.getX(a), e2y = pos.getY(c) - pos.getY(a), e2z = pos.getZ(c) - pos.getZ(a);
    const ux = (e1x * t2 - e2x * t1) * r, uy = (e1y * t2 - e2y * t1) * r, uz = (e1z * t2 - e2z * t1) * r;
    const vx = (e2x * s1 - e1x * s2) * r, vy = (e2y * s1 - e1y * s2) * r, vz = (e2z * s1 - e1z * s2) * r;
    for (let k = 0; k < 3; k++) {
      const i = tri[k] * 3;
      du[i] += ux; du[i + 1] += uy; du[i + 2] += uz;
      dv[i] += vx; dv[i + 1] += vy; dv[i + 2] += vz;
      faces[tri[k]]++;
    }
  }
  // the average, not the sum — a sum would scale the basis by how many faces
  // happen to meet at the vertex, and with it the normal's strength
  for (let i = 0; i < n; i++) {
    const k = faces[i];
    if (k < 2) continue;
    du[i * 3] /= k; du[i * 3 + 1] /= k; du[i * 3 + 2] /= k;
    dv[i * 3] /= k; dv[i * 3 + 1] /= k; dv[i * 3 + 2] /= k;
  }
  geometry.setAttribute('dispDu', new THREE.BufferAttribute(du, 3));
  geometry.setAttribute('dispDv', new THREE.BufferAttribute(dv, 3));
  return true;
}
