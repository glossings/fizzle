// GLSL simplex-noise displacement injected into MeshStandardMaterial via
// onBeforeCompile, so displaced geometry stays lit correctly (normals are
// recomputed by sampling two tangent-offset neighbors on the GPU).

// Ashima / stegu 3D simplex noise — pure functions, shared with the TOP
// noise generator in tops.js
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
  vec3 g = step(x0.yzx, x0.xyz);
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

vec3 displacePoint(vec3 p, vec3 n, vec3 seed) {
  float d = fbm((p + seed) * uFreq + uTime * uSpeed);
  return p + n * d * uAmp;
}
`;

// Replaces <beginnormal_vertex>: displaces the vertex and two tangent
// neighbors, rebuilds the normal from the cross product, and stashes the
// displaced position for the <begin_vertex> replacement below. When the mesh
// is instanced, the noise field is seeded per-instance from the instance
// matrix translation so copies don't all deform identically.
export const NORMAL_CHUNK = /* glsl */ `
vec3 objectNormal = vec3(normal);
#ifdef USE_TANGENT
  vec3 objectTangent = vec3(tangent.xyz);
#endif

vec3 nrm = normalize(normal);
vec3 tangentA = normalize(abs(nrm.y) < 0.99 ? cross(nrm, vec3(0.0, 1.0, 0.0)) : cross(nrm, vec3(1.0, 0.0, 0.0)));
vec3 tangentB = normalize(cross(nrm, tangentA));

vec3 noiseSeed = vec3(0.0);
#ifdef USE_INSTANCING
  noiseSeed = instanceMatrix[3].xyz;
#endif

float eps = 0.08;
vec3 displaced = displacePoint(position, nrm, noiseSeed);
vec3 displacedA = displacePoint(position + tangentA * eps, nrm, noiseSeed);
vec3 displacedB = displacePoint(position + tangentB * eps, nrm, noiseSeed);
objectNormal = normalize(cross(displacedA - displaced, displacedB - displaced));
`;

export const POSITION_CHUNK = /* glsl */ `
vec3 transformed = displaced;
`;

// Patches a MeshStandardMaterial in place; `uniforms` must contain the
// uTime/uAmp/... uniform objects so the engine can animate them per frame.
export function applyNoise(material, uniforms) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + NOISE_GLSL)
      .replace('#include <beginnormal_vertex>', NORMAL_CHUNK)
      .replace('#include <begin_vertex>', POSITION_CHUNK);
  };
  // make sure three treats each noise config as a distinct shader program
  material.customProgramCacheKey = () => 'td-noise';
  material.needsUpdate = true;
}
