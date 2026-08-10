import * as THREE from 'three';
import { SNOISE_GLSL, noiseParamsGlsl, noiseFieldGlsl } from './noise.js';
import { Quad, reciprocal } from './textures.js';
import { carried } from './carry.js';
import { warn } from './warn.js';
import { setColor, makeColor, isDynamicColor } from './color.js';

// GPU particles as a chainable op. A geometry is the emitter —
// sphere().particles({ rate: 20000 }) births particles scattered over the
// surface, leaving along its normals — as is a texture: person().particles()
// births on the bright pixels of the live image, mapped onto a world plane,
// each particle keeping the color of the pixel it was born from. Bare
// particles() emits from a point. Forces chain on (.force/.turbulence/.attract/.drag), looks
// (.size/.color/.opacity/.fade/.blend/.soft), .lit()/.shadow() to join the
// scene's lighting, .evolve() for looks and forces that change across a
// particle's life, .out() to land it in the scene.
//
// The whole simulation lives in two float textures — one texel per particle,
// position+age in one, velocity+lifespan in the other — updated by a fragment
// shader each frame (ping-pong, MRT so both write in one pass) and read back
// by the Points vertex shader. Nothing crosses to the CPU, which is the whole
// reason a hundred thousand particles cost what one mesh does.
//
// The chain compiles to that one update shader: each force op contributes a
// snippet to the force sum, so ten forces are still one pass. The state
// textures are carried (carry.js): a re-run rebuilds the shader but adopts the
// swarm mid-flight, so tweaking a force doesn't restart the show. A texel is a
// particle slot forever — it waits (age < 0), lives (0 <= age < life), and
// wraps back to waiting, with the wait sized so the pool sustains the rate.
//
// dev-notes/PARTICLES.md has the full design and where it goes next.

const resolve = (v, t) => (typeof v === 'function' ? v(t) : v);
const resolve3 = (v, t) => v.map((c) => resolve(c, t));
const asVec = (v) =>
  v === null || typeof v !== 'object' ? null
    : Array.isArray(v) ? [v[0], v[1], v[2]]
      : [v.x, v.y, v.z];
// speed/life/size take a single value or a [min, max] scattered per particle
const resolveRange = (v, t) => {
  if (Array.isArray(v)) return [resolve(v[0], t) ?? 0, resolve(v[1], t) ?? 0];
  const r = resolve(v, t) ?? 0;
  return [r, r];
};

const MAX_COUNT = 1024 * 1024;
const SURF_N = 4096;   // spawn sites baked from a source geometry
const RAMP_N = 128;    // life positions sampled from an .evolve() fn

// ---------------------------------------------------------------------------
// GLSL

// fullscreen pass, raw GLSL3 (the update pass writes two outputs, which needs
// layout(location) — ShaderMaterial's GLSL1 path has nowhere to say that)
const SIM_VERT = /* glsl */ `
in vec3 position;
in vec2 uv;
out vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const HASH_GLSL = /* glsl */ `
vec4 hash43(vec3 p) {
  vec4 p4 = fract(vec4(p.xyzx) * vec4(0.1031, 0.1030, 0.0973, 0.1099));
  p4 += dot(p4, p4.wzxy + 33.33);
  return fract((p4.xxyz + p4.yzzw) * p4.zywx);
}
vec3 randUnit(vec2 r) {
  float z = 1.0 - 2.0 * r.x;
  float a = 6.28318530718 * r.y;
  float s = sqrt(max(1.0 - z * z, 0.0));
  return vec3(cos(a) * s, sin(a) * s, z);
}
`;

// Curl of a vec3 noise field by central differences: divergence-free, so the
// swirl never bunches particles into clumps the way raw noise velocity does.
// (snoise itself is emitted once by simFragment — .turbulence() and a noised
// emitter may both want it in the same shader.)
const CURL_GLSL = /* glsl */ `
vec3 noise3(vec3 p) {
  return vec3(snoise(p), snoise(p + vec3(31.7, 12.3, 74.2)), snoise(p + vec3(9.2, 44.9, 27.1)));
}
vec3 curlNoise(vec3 p) {
  const float e = 0.05;
  vec3 dx = vec3(e, 0.0, 0.0), dy = vec3(0.0, e, 0.0), dz = vec3(0.0, 0.0, e);
  vec3 x0 = noise3(p - dx), x1 = noise3(p + dx);
  vec3 y0 = noise3(p - dy), y1 = noise3(p + dy);
  vec3 z0 = noise3(p - dz), z1 = noise3(p + dz);
  return vec3(
    (y1.z - y0.z) - (z1.y - z0.y),
    (z1.x - z0.x) - (x1.z - x0.z),
    (x1.y - x0.y) - (y1.x - y0.x)
  ) / (2.0 * e);
}
`;

// Everything starts waiting, staggered by index so the stream ramps in at the
// asked-for rate instead of detonating the whole pool on frame one. aux is the
// third state texture a texture emitter carries (birth color).
const seedFragment = (aux) => /* glsl */ `
precision highp float;
uniform vec2 uTexSize;
uniform float uRate;
uniform vec2 uLife;
in vec2 vUv;
layout(location = 0) out vec4 oPos;
layout(location = 1) out vec4 oVel;
${aux ? 'layout(location = 2) out vec4 oAux;' : ''}
${HASH_GLSL}
void main() {
  vec2 cell = floor(vUv * uTexSize);
  float index = cell.y * uTexSize.x + cell.x;
  vec4 h = hash43(vec3(cell, 7.77));
  oPos = vec4(0.0, 0.0, 0.0, -index / max(uRate, 1e-4) - 1e-4);
  oVel = vec4(0.0, 0.0, 0.0, max(mix(uLife.x, uLife.y, h.x), 1e-3));
  ${aux ? 'oAux = vec4(0.0);' : ''}
}
`;

// surf: spawn on a baked surface point, transformed by the source chain's
// live matrix; the normal there is the 'out' direction. tex: spawn on a bright
// pixel of a live texture, mapped onto a world plane, birth color kept in the
// aux state texture. point: at uEmitPos, where 'out' has nowhere to point and
// falls back to a random direction. evolve: the .evolve() ramp's force row, an
// extra acceleration read at the particle's own life fraction. emitNoise: the
// source chain's .noise() — births displaced by the same field the mesh's
// vertices ride, so the swarm sits on the noised surface, not the smooth one.
function simFragment(surf, tex, dirOut, forceLines, forceDecls, hasTurb, hasDrag, evolve, emitNoise) {
  return /* glsl */ `
precision highp float;
uniform sampler2D uPosTex;
uniform sampler2D uVelTex;
uniform float uDt;
uniform float uTime;
uniform float uCount;
uniform float uRate;
uniform vec2 uLife;
uniform vec2 uSpeed;
uniform vec3 uEmitPos;
uniform vec3 uEmitDir;
uniform float uEmitSpread;
${surf ? `uniform sampler2D uSurf;
uniform float uSurfN;
uniform mat4 uEmitMat;
uniform mat3 uEmitNMat;` : ''}
${tex ? `uniform sampler2D uAuxTex;
uniform sampler2D uSpawnTex;
uniform vec2 uPlane;
uniform float uThresh;` : ''}
${evolve ? `uniform sampler2D uRamp;
uniform float uRampForce;` : ''}
${hasDrag ? 'uniform float uDrag;' : ''}
${forceDecls.join('\n')}
in vec2 vUv;
layout(location = 0) out vec4 oPos;
layout(location = 1) out vec4 oVel;
${tex ? 'layout(location = 2) out vec4 oAux;' : ''}
${HASH_GLSL}
${hasTurb || emitNoise ? SNOISE_GLSL : ''}
${hasTurb ? CURL_GLSL : ''}
${emitNoise ? noiseParamsGlsl('uEmit') + noiseFieldGlsl('uEmit') : ''}
void main() {
  vec4 P = texture(uPosTex, vUv);
  vec4 V = texture(uVelTex, vUv);
  ${tex ? 'vec4 aux = texture(uAuxTex, vUv);' : ''}
  vec3 pos = P.xyz;
  vec3 vel = V.xyz;
  float age = P.w;
  float life = max(V.w, 1e-3);
  bool wasAlive = age >= 0.0;
  age += uDt;

  if (wasAlive && age >= life) {
    // died — sit out the wait that makes the pool's cycle match the rate.
    // Zero wait leaves the remainder >= 0, which respawns this same frame.
    age -= life + max(uCount / max(uRate, 1e-4) - life, 0.0);
    wasAlive = false;
  }

  if (!wasAlive && age >= 0.0) {
    // born. hash43 wants inputs at integer scale — handed uv in 0..1 its first
    // fract() never wraps, and neither neighbouring texels nor consecutive
    // frames come out different enough, which draws spawn positions in bands
    // that sweep as births cycle through the pool. gl_FragCoord is the texel;
    // the key counts frames, wrapped so it keeps float precision all set.
    float hk = floor(mod(uTime * 61.0, 8192.0));
    vec4 h1 = hash43(vec3(gl_FragCoord.xy, hk));
    vec4 h2 = hash43(vec3(gl_FragCoord.yx + 117.0, hk + 31.0));
    vec3 rdir = randUnit(h2.xy);
    ${surf
      ? `int si = int(min(h1.x, 0.999999) * uSurfN);
    vec3 sp = texelFetch(uSurf, ivec2(si, 0), 0).xyz;${emitNoise ? `
    // local space, before the emitter's matrix — where the mesh displaces too
    vec3 sn = texelFetch(uSurf, ivec2(si, 1), 0).xyz;
    float snl = length(sn);
    if (snl > 1e-5) sp = displacePoint(sp, sn / snl, vec3(0.0));` : ''}
    pos = (uEmitMat * vec4(sp, 1.0)).xyz;
    ${dirOut
      ? `vec3 base = uEmitNMat * texelFetch(uSurf, ivec2(si, 1), 0).xyz;
    float bl = length(base);
    base = bl > 1e-5 ? base / bl : rdir;`
      : `vec3 base = uEmitDir;`}`
      : tex
        ? `// hunt for a bright pixel: taps accepted in proportion to their
    // brightness, so dense areas birth more. All misses = a dark frame —
    // wait a beat and try again, throttling the stream instead of spraying.
    vec2 suv = h1.xy;
    float rj = h1.z;
    float found = 0.0;
    vec3 mapc = vec3(1.0);
    for (int j = 0; j < 8; j++) {
      // textureLod, not texture: neighbouring fragments here read unrelated
      // uvs, so derivative-picked mips would sample the whole image averaged
      // down to a texel — every pixel dim, nothing ever bright enough to birth
      vec4 mc = textureLod(uSpawnTex, suv, 0.0);
      float wgt = dot(mc.rgb, vec3(0.2126, 0.7152, 0.0722)) * mc.a;
      if (wgt >= uThresh && rj <= wgt) { found = 1.0; mapc = mc.rgb; break; }
      vec4 hj = hash43(vec3(suv * 1024.0, hk + float(j) * 7.0));
      suv = hj.xy;
      rj = hj.z;
    }
    pos = vec3((suv - 0.5) * uPlane, 0.0);
    vec3 base = uEmitDir;`
        : `pos = uEmitPos;
    ${dirOut ? `vec3 base = rdir;` : `vec3 base = uEmitDir;`}`}
    vec3 d = mix(base, rdir, clamp(uEmitSpread, 0.0, 1.0));
    float dl = length(d);
    vel = (dl > 1e-4 ? d / dl : rdir) * mix(uSpeed.x, uSpeed.y, h2.z);
    life = max(mix(uLife.x, uLife.y, h2.w), 1e-3);
    age = min(age, uDt);
    ${tex ? `if (found > 0.5) aux = vec4(mapc, 1.0);
    else { pos = P.xyz; vel = V.xyz; age = -0.02 - 0.1 * h2.x; }` : ''}
  } else if (wasAlive) {
    vec3 f = vec3(0.0);
    ${forceLines.join('\n    ')}
    ${evolve ? `if (uRampForce > 0.5) {
      float lfrac = clamp(age / life, 0.0, 1.0);
      f += texelFetch(uRamp, ivec2(int(lfrac * ${RAMP_N - 1}.0 + 0.5), 2), 0).xyz;
    }` : ''}
    vel += f * uDt;
    ${hasDrag ? 'vel *= exp(-uDrag * uDt);' : ''}
    pos += vel * uDt;
  }

  oPos = vec4(pos, age);
  oVel = vec4(vel, life);
  ${tex ? 'oAux = aux;' : ''}
}
`;
}

// ---------------------------------------------------------------------------
// draw shaders — an ordinary ShaderMaterial on THREE.Points, position fetched
// from the state texture per vertex. Dead texels park outside clip space, so
// they cost no fragments. With .evolve(), size/color/opacity come from the
// ramp texture the fn was baked into, addressed by life fraction. The
// tonemapping/colorspace chunks keep the dots matching the rest of the scene
// on both render paths (direct to canvas, and through scene()'s linear target
// where both compile out).
//
// With .lit(), the material compiles with lights: true and three's own light
// and shadow chunks: each dot multiplies its color by the light arriving at
// its position. A dot has no facing, so there's no N·L — what shows is each
// light's color, falloff, cone and shadow, which is the usual read of
// lit particles. RECIPROCAL_PI matches how a mesh's diffuse term scales the
// same irradiance, so a lit swarm sits tonally with lit geometry.

const drawVert = (evolve, mapColor, lit) => /* glsl */ `
${lit ? `#include <common>
#include <shadowmap_pars_vertex>
varying vec3 vViewPosition;` : ''}
uniform sampler2D uPosTex;
uniform sampler2D uVelTex;
uniform float uPixScale;
uniform vec2 uSizeA;
uniform vec2 uSizeB;
${evolve ? `uniform sampler2D uRamp;
uniform float uRampSize;` : ''}
${mapColor ? `uniform sampler2D uAuxTex;
varying vec3 vColor;` : ''}
attribute vec2 aRef;
varying float vFrac;
varying float vRand;
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
void main() {
  vec4 P = texture2D(uPosTex, aRef);
  vec4 V = texture2D(uVelTex, aRef);
  ${mapColor ? 'vColor = texture2D(uAuxTex, aRef).rgb;' : ''}
  if (P.w < 0.0) {
    gl_Position = vec4(2e5, 2e5, 2e5, 1.0);
    gl_PointSize = 1.0;
    vFrac = 0.0;
    vRand = 0.0;
    return;
  }
  vFrac = clamp(P.w / max(V.w, 1e-4), 0.0, 1.0);
  vRand = hash12(aRef * 913.7);
  vec4 mv = modelViewMatrix * vec4(P.xyz, 1.0);
  gl_Position = projectionMatrix * mv;
  ${lit ? `vViewPosition = -mv.xyz;
  vec4 worldPosition = modelMatrix * vec4(P.xyz, 1.0);
  #include <shadowmap_vertex>` : ''}
  // each end scatters by the same per-particle draw, then birth lerps to death
  float size = mix(mix(uSizeA.x, uSizeA.y, vRand), mix(uSizeB.x, uSizeB.y, vRand), vFrac);
  ${evolve ? `if (uRampSize > 0.5) size = texture2D(uRamp, vec2(vFrac, 0.5)).r;` : ''}
  gl_PointSize = clamp(size * uPixScale / max(-mv.z, 1e-3), 0.0, 512.0);
}
`;

// The light loops mirror three's lights_fragment_begin — same structs, same
// unroll pragmas, same shadowed-lights-sorted-first index bookkeeping — minus
// every term that needs a surface normal.
const LIT_GLSL = /* glsl */ `
  vec3 geometryPosition = - vViewPosition;
  vec3 irradiance = getAmbientLightIrradiance( ambientLightColor );
  IncidentLight directLight;

  #if NUM_HEMI_LIGHTS > 0
    #pragma unroll_loop_start
    for ( int i = 0; i < NUM_HEMI_LIGHTS; i ++ ) {
      irradiance += mix( hemisphereLights[ i ].groundColor, hemisphereLights[ i ].skyColor, 0.5 );
    }
    #pragma unroll_loop_end
  #endif

  #if NUM_DIR_LIGHTS > 0
    DirectionalLight directionalLight;
    #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
    DirectionalLightShadow directionalLightShadow;
    #endif
    #pragma unroll_loop_start
    for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
      directionalLight = directionalLights[ i ];
      getDirectionalLightInfo( directionalLight, directLight );
      #if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )
      directionalLightShadow = directionalLightShadows[ i ];
      directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
      #endif
      irradiance += directLight.color;
    }
    #pragma unroll_loop_end
  #endif

  #if NUM_POINT_LIGHTS > 0
    PointLight pointLight;
    #if defined( USE_SHADOWMAP ) && NUM_POINT_LIGHT_SHADOWS > 0
    PointLightShadow pointLightShadow;
    #endif
    #pragma unroll_loop_start
    for ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {
      pointLight = pointLights[ i ];
      getPointLightInfo( pointLight, geometryPosition, directLight );
      #if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_POINT_LIGHT_SHADOWS ) && ( defined( SHADOWMAP_TYPE_PCF ) || defined( SHADOWMAP_TYPE_BASIC ) )
      pointLightShadow = pointLightShadows[ i ];
      directLight.color *= ( directLight.visible && receiveShadow ) ? getPointShadow( pointShadowMap[ i ], pointLightShadow.shadowMapSize, pointLightShadow.shadowIntensity, pointLightShadow.shadowBias, pointLightShadow.shadowRadius, vPointShadowCoord[ i ], pointLightShadow.shadowCameraNear, pointLightShadow.shadowCameraFar ) : 1.0;
      #endif
      irradiance += directLight.color;
    }
    #pragma unroll_loop_end
  #endif

  #if NUM_SPOT_LIGHTS > 0
    SpotLight spotLight;
    #if defined( USE_SHADOWMAP ) && NUM_SPOT_LIGHT_SHADOWS > 0
    SpotLightShadow spotLightShadow;
    #endif
    #pragma unroll_loop_start
    for ( int i = 0; i < NUM_SPOT_LIGHTS; i ++ ) {
      spotLight = spotLights[ i ];
      getSpotLightInfo( spotLight, geometryPosition, directLight );
      #if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
      spotLightShadow = spotLightShadows[ i ];
      directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( spotShadowMap[ i ], spotLightShadow.shadowMapSize, spotLightShadow.shadowIntensity, spotLightShadow.shadowBias, spotLightShadow.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
      #endif
      irradiance += directLight.color;
    }
    #pragma unroll_loop_end
  #endif

  col *= mix( vec3( 1.0 ), irradiance * RECIPROCAL_PI, uLit );
`;

const drawFrag = (evolve, mapColor, lit) => /* glsl */ `
${lit ? `#include <common>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>
uniform float uLit;
varying vec3 vViewPosition;` : ''}
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec2 uOpacity;
uniform vec2 uFade;
uniform float uSoft;
${evolve ? 'uniform sampler2D uRamp;' : ''}
${evolve && mapColor ? 'uniform float uRampColor;' : ''}
${mapColor ? 'varying vec3 vColor;' : ''}
varying float vFrac;
varying float vRand;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  float edge = 1.0 - smoothstep(max(1.0 - uSoft, 0.0), 1.0, r);
  if (edge <= 0.003) discard;
  float env = 1.0;
  if (uFade.x > 0.0) env *= smoothstep(0.0, uFade.x, vFrac);
  if (uFade.y > 0.0) env *= 1.0 - smoothstep(1.0 - uFade.y, 1.0, vFrac);
  ${evolve
    ? `vec4 rc = texture2D(uRamp, vec2(vFrac, 0.1666667));
  vec3 col = ${mapColor ? '(uRampColor > 0.5 ? rc.rgb : vColor)' : 'rc.rgb'};
  float alpha = edge * env * rc.a;`
    : `vec3 col = ${mapColor ? 'vColor' : 'mix(uColorA, uColorB, vFrac)'};
  float alpha = edge * env * mix(uOpacity.x, uOpacity.y, vFrac);`}
  ${lit ? LIT_GLSL : ''}
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ---------------------------------------------------------------------------
// shadow-cast shaders — what .shadow() hands the shadow pass in place of the
// mesh depth material three would guess (which reads the all-zero position
// attribute and piles every dot at the origin). Same state fetch, the light's
// own matrices from the pass, and the sprite's edge/fade deciding which dots
// are solid enough to block light. Hardware depth does the actual occlusion;
// the color written out is only read by the unfiltered point-light path,
// which wants world distance to the light instead.

const castVert = (evolve) => /* glsl */ `
uniform sampler2D uPosTex;
uniform sampler2D uVelTex;
uniform vec2 uSizeA;
uniform vec2 uSizeB;
uniform float uShadowPix;
${evolve ? `uniform sampler2D uRamp;
uniform float uRampSize;` : ''}
attribute vec2 aRef;
varying float vFrac;
varying float vRand;
varying vec3 vWorldPosition;
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
void main() {
  vec4 P = texture2D(uPosTex, aRef);
  vec4 V = texture2D(uVelTex, aRef);
  if (P.w < 0.0) {
    gl_Position = vec4(2e5, 2e5, 2e5, 1.0);
    gl_PointSize = 1.0;
    vFrac = 0.0;
    vRand = 0.0;
    vWorldPosition = vec3(0.0);
    return;
  }
  vFrac = clamp(P.w / max(V.w, 1e-4), 0.0, 1.0);
  vRand = hash12(aRef * 913.7);
  vWorldPosition = (modelMatrix * vec4(P.xyz, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(P.xyz, 1.0);
  float size = mix(mix(uSizeA.x, uSizeA.y, vRand), mix(uSizeB.x, uSizeB.y, vRand), vFrac);
  ${evolve ? `if (uRampSize > 0.5) size = texture2D(uRamp, vec2(vFrac, 0.5)).r;` : ''}
  // pixels of the shadow map, not the screen: projectionMatrix[1][1] covers
  // the ortho (directional) and perspective (spot, cube face) cameras alike,
  // with gl_Position.w carrying the perspective divide
  gl_PointSize = clamp(size * projectionMatrix[1][1] * 0.5 * uShadowPix / max(gl_Position.w, 1e-3), 0.0, 512.0);
}
`;

const castFrag = (evolve, dist) => /* glsl */ `
uniform vec2 uOpacity;
uniform vec2 uFade;
uniform float uSoft;
${evolve ? 'uniform sampler2D uRamp;' : ''}
${dist ? `uniform vec3 referencePosition;
uniform float nearDistance;
uniform float farDistance;
varying vec3 vWorldPosition;` : ''}
varying float vFrac;
varying float vRand;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  float edge = 1.0 - smoothstep(max(1.0 - uSoft, 0.0), 1.0, r);
  float env = 1.0;
  if (uFade.x > 0.0) env *= smoothstep(0.0, uFade.x, vFrac);
  if (uFade.y > 0.0) env *= 1.0 - smoothstep(1.0 - uFade.y, 1.0, vFrac);
  float alpha = edge * env * ${evolve ? 'texture2D(uRamp, vec2(vFrac, 0.1666667)).a' : 'mix(uOpacity.x, uOpacity.y, vFrac)'};
  if (alpha < 0.35) discard;
  ${dist
    ? `gl_FragColor = vec4(clamp((length(vWorldPosition - referencePosition) - nearDistance) / (farDistance - nearDistance), 0.0, 1.0), 0.0, 0.0, 1.0);`
    : 'gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);'}
}
`;

// ---------------------------------------------------------------------------
// plumbing

let quad = null;
const seedMats = {};

function stateRT(w, h, mrt) {
  const rt = new THREE.WebGLRenderTarget(w, h, {
    count: mrt,
    type: THREE.FloatType,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: false,
  });
  for (const tex of rt.textures) tex.generateMipmaps = false;
  return rt;
}

function dataTex(data, w, h) {
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

const freeState = (s) => {
  s.rtA?.dispose();
  s.rtB?.dispose();
  s.simMat?.dispose();
  s.surfTex?.dispose();
  s.rtA = s.rtB = s.simMat = s.surfTex = null;
};

const BLENDS = { over: THREE.NormalBlending, normal: THREE.NormalBlending, add: THREE.AdditiveBlending };

// The stand-in .evolve() hands its fn: the verbs a life point can set, applied
// to one sampled position of a particle's life. The fn runs RAMP_N times per
// frame at life fractions 0..1 and the results bake into a small ramp texture
// — rows: color+opacity, size, force — that the draw and sim shaders read per
// particle. So it reads as per-particle code but costs a hundred calls, not a
// hundred thousand.
class EvolveHandle {
  constructor() {
    this._color = new THREE.Color();
    this._opacity = 1;
    this._size = null;
    this._force = null;
  }
  reset(color, opacity) {
    this._color.copy(color);
    this._opacity = opacity;
    this._size = null;
    this._force = null;
    this._colorSet = false;
    return this;
  }
  size(v) { this._size = v; return this; }
  color(c) { setColor(this._color, c, this._t); this._colorSet = true; return this; }
  opacity(v) { this._opacity = v; return this; }
  // an extra acceleration at this life point, on top of the chain's forces
  force(x = 0, y = 0, z = 0) {
    const v = asVec(x);
    this._force = v ? [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0] : [x, y, z];
    return this;
  }
  // the verbs that belong to the whole system, named rather than ignored
  fade() { warn('evolve: .fade() is the whole envelope — set opacity per life point here instead, or .fade() on the chain'); return this; }
  blend() { warn('evolve: .blend() is one mode for the whole system — set it on the chain'); return this; }
  soft() { warn('evolve: .soft() is one edge for the whole system — set it on the chain'); return this; }
}

export class ParticleOp {
  // source: a GeoOp whose surface is the emitter, a TextureOp whose bright
  // pixels are, or null for a point
  constructor(engine, opts = {}, source = null) {
    if (engine == null) {
      throw new Error('new Particles() is not how a system starts — call particles(), or .particles() on a shape');
    }
    if (typeof opts === 'number') opts = { max: opts };
    this.engine = engine;
    this.opts = opts ?? {};
    this.source = source;
    this._forces = [];      // { kind: 'force'|'turb'|'attract', ... } in chain order
    this._drags = [];
    this._evolve = null;
    this._sizeA = 0.05;
    this._sizeB = null;
    this._colorA = null;
    this._colorB = null;
    this._opA = 1;
    this._opB = null;
    this._fade = { in: 0.1, out: 0.3 };
    this._soft = 0.5;
    this._blend = 'over';
    this._lit = null;       // null = unlit; a number/fn of t is the lit mix
    this._cast = false;
    this._pos = [0, 0, 0];
    this._rot = [0, 0, 0];
    this._scale = [1, 1, 1];
    this._built = false;
  }

  force(x = 0, y = 0, z = 0) {
    const v = asVec(x);
    this._forces.push({ kind: 'force', vec: v ? [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0] : [x, y, z] });
    return this;
  }

  // amp: swirl strength · period/freq: spatial scale · speed: field drift ·
  // seed: independent fields
  turbulence(o = {}) {
    this._forces.push({
      kind: 'turb',
      amp: o.amp ?? 1,
      freq: o.period !== undefined ? reciprocal(o.period) : o.freq ?? 0.5,
      speed: o.speed ?? 0.5,
      seed: o.seed ?? 0,
    });
    return this;
  }

  // inverse-square pull toward a point; negative strength repels. radius is
  // the softening floor that keeps a close pass a slingshot, not an explosion.
  attract(pos = [0, 0, 0], o = {}) {
    if (pos !== null && typeof pos === 'object' && !Array.isArray(pos) && pos.x === undefined) {
      o = pos;
      pos = o.pos ?? o.position ?? [0, 0, 0];
    }
    const v = asVec(pos) ?? [pos, 0, 0];
    this._forces.push({
      kind: 'attract',
      pos: [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0],
      strength: o.strength ?? 3,
      radius: o.radius ?? 0.5,
    });
    return this;
  }

  drag(v = 1) { this._drags.push(v); return this; }

  // .evolve((p, life, t) => ...) — looks and forces across each particle's
  // life. life runs 0 (birth) to 1 (death); whatever the fn sets on p
  // (.size/.color/.opacity/.force) applies at that point, starting from the
  // chain's own settings.
  evolve(fn) {
    if (typeof fn !== 'function') {
      warn('.evolve() takes a fn: .evolve((p, life) => p.size(0.1 * (1 - life)))');
      return this;
    }
    if (this._evolve) warn('particles: a second .evolve() replaces the first — one fn owns the whole life');
    this._evolve = fn;
    return this;
  }

  // Every look verb reads the same way: one value, or two meaning
  // birth → death. Where a number goes, a [min, max] pair scatters it per
  // particle instead.
  size(a, b) {
    this._sizeA = a ?? 0.05;
    this._sizeB = b ?? null;
    return this;
  }
  color(a, b) {
    this._colorA = a;
    this._colorB = b ?? null;
    return this;
  }
  opacity(a, b) {
    this._opA = a ?? 1;
    this._opB = b ?? null;
    return this;
  }
  soft(v = 0.5) { this._soft = v; return this; }

  // .lit(amount) — dots colored by the scene's lights and darkened inside
  // their shadows. amount 0..1 mixes flat color → fully lit; a fn of t works.
  lit(v = 1) {
    this._lit = v === false ? null : v === true ? 1 : v;
    return this;
  }

  // .shadow() — the swarm casts. Off by default: unlike a mesh it isn't free,
  // it's a depth pass per shadow light per frame. Receiving is .lit()'s side.
  shadow(v = true) {
    if (v !== null && typeof v === 'object') {
      if (v.receive !== undefined) warn('particles: dots take shadows through .lit() — .shadow() is about casting them');
      v = v.cast ?? true;
    }
    this._cast = !!v;
    return this;
  }

  // .fade(in, out) — fade each particle in at birth and out before death, so
  // it doesn't blink into existence. The numbers are how long each fade
  // takes, as fractions of the lifespan; false turns both off.
  fade(a = 0.1, b = 0.3) {
    if (a === false) this._fade = { in: 0, out: 0 };
    else if (a === true) this._fade = { in: 0.1, out: 0.3 };
    else if (a !== null && typeof a === 'object') this._fade = { in: a.in ?? 0.1, out: a.out ?? 0.3 };
    else this._fade = { in: a, out: b };
    return this;
  }

  blend(mode = 'over') {
    if (!BLENDS[mode]) {
      warn(`particles: no blend '${mode}' — over or add; using over`);
      mode = 'over';
    }
    this._blend = mode;
    return this;
  }

  position(x = 0, y = 0, z = 0) {
    const v = asVec(x);
    this._pos = v ? [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0] : [x, y, z];
    return this;
  }
  rotation(x = 0, y = 0, z = 0) {
    const v = asVec(x);
    this._rot = v ? [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0] : [x, y, z];
    return this;
  }
  scale(x = 1, y, z) {
    const v = asVec(x);
    this._scale = v ? [v[0] ?? 1, v[1] ?? 1, v[2] ?? 1] : [x, y ?? x, z ?? x];
    return this;
  }

  // the habit from geometry chains, caught rather than crashed
  material(o = {}) {
    if (o && o.color !== undefined) this.color(o.color);
    const rest = o ? Object.keys(o).filter((k) => k !== 'color') : [];
    if (rest.length) {
      warn(`particles: no .material() here — .color()/.size()/.opacity()/.blend() are the looks, .lit() takes the scene's light (${rest.join('/')} ignored)`);
    }
    return this;
  }
  noise() {
    warn('particles: .noise() displaces surfaces — .turbulence() is the force that stirs a swarm');
    return this;
  }
  instance() {
    warn('particles: already many — raise the rate instead of .instance()');
    return this;
  }

  out(name) {
    if (this._built) {
      warn('particles: this system is already in the scene — one .out() per particles() call');
      return this;
    }
    this._built = true;
    const engine = this.engine;
    quad ??= new Quad();

    // --- the pool: sized by rate × life, capped by max --------------------
    const o = this.opts;
    const life = o.life ?? 3;
    const life0 = resolveRange(life, 0);
    const maxLife = Math.max(life0[0], life0[1], 1e-3);
    let rate = o.rate ?? null;
    let count;
    if (rate != null) {
      const need = Math.ceil(Math.max(resolve(rate, 0), 1) * maxLife);
      count = Math.min(need, o.max ?? MAX_COUNT, MAX_COUNT);
      if (count < need) {
        warn(`particles: rate × life wants ${need} alive at once and the pool holds ${count} — the stream caps there. Raise max, or shorten the life.`);
      }
    } else {
      count = Math.min(Math.floor(resolve(o.max, 0) ?? 10000), MAX_COUNT);
      if (!(count >= 1)) count = 10000;
      rate = count / maxLife;
    }
    this.count = count;

    // --- resolve the emitter ----------------------------------------------
    const src = this.source;
    // a texture chain quacks renderNode; a geometry chain quacks _points
    const texEmit = !!src && typeof src.renderNode === 'function';
    let surfPts = null;
    if (src && !texEmit) {
      if (o.pos != null) warn("particles: the emitter is the shape — move it with the source chain's .position()");
      surfPts = src._points?.();
      if (!surfPts) {
        warn("particles: the source has nothing to sample yet (a model still parsing?) — emitting from a point until the next run");
      }
      if (src._displaces?.length) {
        warn("particles: .displace() maps don't reach the emitter — spawn points sit on the un-displaced shape (.noise() does carry through)");
      }
    }
    if (texEmit && o.pos != null) warn('particles: the emitter is the image — move the system with .position()');
    const surf = !!surfPts;
    // births ride the same noise field as the source's vertices — a particle
    // lands where the surface is at its birth, so short lives track a moving
    // field and long ones remember where it was
    const emitNoise = (surf && src._noise) || null;
    const emitPos = asVec(o.pos ?? o.position) ?? [0, 0, 0];
    // on a surface the natural exit is along the normal; from an image, off
    // the plane toward the camera; from a point, up
    const dirOut = !texEmit && (o.dir === 'out' || (surf && o.dir == null));
    const emitDir = texEmit
      ? (o.dir == null || o.dir === 'out' ? [0, 0, 1] : (asVec(o.dir) ?? [0, 0, 1]))
      : dirOut ? [0, 1, 0] : (asVec(o.dir) ?? [0, 1, 0]);
    const spread = o.spread ?? 0.25;
    const speed = o.speed ?? 2;
    // texture emitters: births land on a world plane at the origin — height in
    // world units, width following the screen; only pixels past the luma
    // threshold give birth. Unless .color() says otherwise, each particle
    // keeps the color of the pixel it was born from.
    const planeSize = o.size ?? 4;
    const thresh = o.threshold ?? 0.1;
    const mapColor = texEmit && this._colorA == null;
    const mrt = texEmit ? 3 : 2;

    // --- compile the update pass -------------------------------------------
    const uniforms = {
      uPosTex: { value: null },
      uVelTex: { value: null },
      uDt: { value: 0 },
      uTime: { value: 0 },
      uCount: { value: count },
      uRate: { value: Math.max(resolve(rate, 0), 1e-4) },
      uLife: { value: new THREE.Vector2(...life0) },
      uSpeed: { value: new THREE.Vector2(...resolveRange(speed, 0)) },
      uEmitPos: { value: new THREE.Vector3(...resolve3(emitPos, 0)) },
      uEmitDir: { value: new THREE.Vector3(...resolve3(emitDir, 0)).normalize() },
      uEmitSpread: { value: resolve(spread, 0) },
    };
    // per-frame writers for every animatable param, built once at compile
    const setters = [
      (u, t) => {
        u.uRate.value = Math.max(resolve(rate, t), 1e-4);
        u.uLife.value.set(...resolveRange(life, t));
        u.uSpeed.value.set(...resolveRange(speed, t));
        u.uEmitPos.value.set(...resolve3(emitPos, t));
        u.uEmitSpread.value = resolve(spread, t);
        if (!dirOut) {
          u.uEmitDir.value.set(...resolve3(emitDir, t));
          if (u.uEmitDir.value.lengthSq() < 1e-10) u.uEmitDir.value.set(0, 1, 0);
          u.uEmitDir.value.normalize();
        }
      },
    ];
    if (texEmit) {
      Object.assign(uniforms, {
        uAuxTex: { value: null },
        uSpawnTex: { value: null },
        uPlane: { value: new THREE.Vector2(1, 1) },
        uThresh: { value: resolve(thresh, 0) },
      });
      setters.push((u, t) => { u.uThresh.value = resolve(thresh, t); });
    }

    const forceDecls = [];
    const forceLines = [];
    let hasTurb = false;
    this._forces.forEach((op, i) => {
      if (op.kind === 'force') {
        forceDecls.push(`uniform vec3 uForce${i};`);
        forceLines.push(`f += uForce${i};`);
        uniforms[`uForce${i}`] = { value: new THREE.Vector3() };
        setters.push((u, t) => u[`uForce${i}`].value.set(...resolve3(op.vec, t)));
      } else if (op.kind === 'turb') {
        hasTurb = true;
        forceDecls.push(`uniform vec4 uTurb${i};`); // amp, freq, speed, seed
        forceLines.push(
          `f += curlNoise((pos + vec3(uTurb${i}.w * 19.19)) * uTurb${i}.y + uTime * uTurb${i}.z * vec3(1.0, 0.83, 0.61)) * uTurb${i}.x;`
        );
        uniforms[`uTurb${i}`] = { value: new THREE.Vector4() };
        setters.push((u, t) =>
          u[`uTurb${i}`].value.set(resolve(op.amp, t), resolve(op.freq, t), resolve(op.speed, t), resolve(op.seed, t))
        );
      } else {
        forceDecls.push(`uniform vec3 uAttPos${i};`, `uniform vec2 uAtt${i};`); // strength, radius²
        forceLines.push(
          `{ vec3 ad = uAttPos${i} - pos;
      float ar2 = max(dot(ad, ad), uAtt${i}.y);
      f += ad * (uAtt${i}.x / (ar2 * sqrt(ar2))); }`
        );
        uniforms[`uAttPos${i}`] = { value: new THREE.Vector3() };
        uniforms[`uAtt${i}`] = { value: new THREE.Vector2() };
        setters.push((u, t) => {
          u[`uAttPos${i}`].value.set(...resolve3(op.pos, t));
          const r = Math.max(resolve(op.radius, t), 0.05);
          u[`uAtt${i}`].value.set(resolve(op.strength, t), r * r);
        });
      }
    });
    const drags = this._drags;
    if (drags.length) {
      uniforms.uDrag = { value: 0 };
      setters.push((u, t) => {
        u.uDrag.value = Math.max(drags.reduce((s, v) => s + resolve(v, t), 0), 0);
      });
    }

    // the .evolve() ramp: one texture both shaders read by life fraction —
    // row 0 color+opacity, row 1 size, row 2 force. Rebaked every frame
    // (RAMP_N fn calls and a 6 KB upload), so the fn can close over signals.
    const evolve = this._evolve;
    let rampTex = null;
    let rampData = null;
    let handle = null;
    if (evolve) {
      rampData = new Float32Array(RAMP_N * 3 * 4);
      rampTex = dataTex(rampData, RAMP_N, 3);
      handle = new EvolveHandle();
      uniforms.uRamp = { value: rampTex };
      uniforms.uRampForce = { value: 0 };
    }

    // --- state, carried across re-runs -------------------------------------
    const w = Math.ceil(Math.sqrt(count));
    const h = Math.ceil(count / w);
    const state = carried('particles', () => ({}), freeState);
    if (state.w !== w || state.h !== h || state.mrt !== mrt) {
      freeState(state);
      state.w = w;
      state.h = h;
      state.mrt = mrt;
      state.rtA = stateRT(w, h, mrt);
      state.rtB = stateRT(w, h, mrt);
      state.read = state.rtA;
      state.write = state.rtB;
      // seed once, straight into the read target
      const seedMat = seedMats[mrt] ??= new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: SIM_VERT,
        fragmentShader: seedFragment(mrt > 2),
        uniforms: {
          uTexSize: { value: new THREE.Vector2() },
          uRate: { value: 1 },
          uLife: { value: new THREE.Vector2() },
        },
      });
      seedMat.uniforms.uTexSize.value.set(w, h);
      seedMat.uniforms.uRate.value = Math.max(resolve(rate, 0), 1e-4);
      seedMat.uniforms.uLife.value.set(...life0);
      quad.render(engine.renderer, seedMat, state.read);
      engine.renderer.setRenderTarget(null);
    }

    // spawn sites baked from the source's surface scatter (sample.js — the
    // same deterministic points geo.sample() reads). Local space: the source
    // chain's transform rides in as a matrix each frame, so a moving or
    // spinning emitter carries its births with it for free.
    state.surfTex?.dispose();
    state.surfTex = null;
    if (surf) {
      const n = SURF_N;
      const data = new Float32Array(n * 2 * 4);
      for (let i = 0; i < n; i++) {
        const p = surfPts.point(i);
        const nm = surfPts.normal(i);
        data.set([p.x, p.y, p.z, 0], i * 4);
        data.set([nm.x, nm.y, nm.z, 0], (n + i) * 4);
      }
      state.surfTex = dataTex(data, n, 2);
      Object.assign(uniforms, {
        uSurf: { value: state.surfTex },
        uSurfN: { value: n },
        uEmitMat: { value: new THREE.Matrix4() },
        uEmitNMat: { value: new THREE.Matrix3() },
      });
      setters.push((u) => {
        // _xform composes the source's transform at the current clock, the
        // same way its own mesh updater would — null means identity
        const m = src._xform();
        if (m) {
          u.uEmitMat.value.copy(m);
          u.uEmitNMat.value.copy(src._nmat);
        } else {
          u.uEmitMat.value.identity();
          u.uEmitNMat.value.identity();
        }
      });
      if (emitNoise) {
        // 'uEmit'-prefixed: the sim's own uSpeed is a vec2, so the field's
        // dials can't take the mesh path's bare names here
        Object.assign(uniforms, {
          uEmitAmp: { value: 0 }, uEmitFreq: { value: 0 }, uEmitOctaves: { value: 0 },
          uEmitLacunarity: { value: 0 }, uEmitGain: { value: 0 },
          uEmitSpeed: { value: 0 }, uEmitSeed: { value: 0 },
        });
        // same resolution as the mesh's own updater (api.js), same clock
        setters.push((u, t) => {
          u.uEmitAmp.value = resolve(emitNoise.amp, t);
          u.uEmitFreq.value = resolve(emitNoise.freq, t);
          u.uEmitOctaves.value = Math.min(8, Math.max(1, resolve(emitNoise.octaves, t)));
          u.uEmitLacunarity.value = resolve(emitNoise.lacunarity, t);
          u.uEmitGain.value = resolve(emitNoise.gain, t);
          u.uEmitSpeed.value = resolve(emitNoise.speed, t);
          u.uEmitSeed.value = resolve(emitNoise.seed, t);
        });
      }
    }

    // the compiled chain changes per run; the swarm it steps does not
    state.simMat?.dispose();
    state.simMat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: SIM_VERT,
      fragmentShader: simFragment(surf, texEmit, dirOut, forceLines, forceDecls, hasTurb, drags.length > 0, !!evolve, !!emitNoise),
      uniforms,
    });

    // --- the drawn points ---------------------------------------------------
    const geometry = new THREE.BufferGeometry();
    // position is required plumbing; aRef is the texel this vertex reads
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    const ref = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      ref[i * 2] = ((i % w) + 0.5) / w;
      ref[i * 2 + 1] = (Math.floor(i / w) + 0.5) / h;
    }
    geometry.setAttribute('aRef', new THREE.BufferAttribute(ref, 2));

    const colorA = this._colorA ?? '#8899ff';
    const colorB = this._colorB ?? colorA;
    const sizeA = this._sizeA, sizeB = this._sizeB ?? this._sizeA;
    const opA = this._opA, opB = this._opB ?? this._opA;
    const drawUniforms = {
      uPosTex: { value: state.read.textures[0] },
      uVelTex: { value: state.read.textures[1] },
      uPixScale: { value: 1 },
      uSizeA: { value: new THREE.Vector2(...resolveRange(sizeA, 0)) },
      uSizeB: { value: new THREE.Vector2(...resolveRange(sizeB, 0)) },
      uColorA: { value: makeColor(colorA) },
      uColorB: { value: makeColor(colorB) },
      uOpacity: { value: new THREE.Vector2(resolve(opA, 0), resolve(opB, 0)) },
      uFade: { value: new THREE.Vector2(this._fade.in, this._fade.out) },
      uSoft: { value: resolve(this._soft, 0) },
    };
    if (evolve) {
      drawUniforms.uRamp = { value: rampTex };
      drawUniforms.uRampSize = { value: 0 };
      if (mapColor) drawUniforms.uRampColor = { value: 0 };
    }
    if (mapColor) drawUniforms.uAuxTex = { value: state.read.textures[2] };
    // lights: true makes three fill the cloned light/shadow uniforms from the
    // scene each frame and recompile when the light count changes
    const litV = this._lit;
    if (litV != null) {
      Object.assign(drawUniforms, THREE.UniformsUtils.clone(THREE.UniformsLib.lights), {
        uLit: { value: resolve(litV, 0) },
      });
    }
    const material = new THREE.ShaderMaterial({
      vertexShader: drawVert(!!evolve, mapColor, litV != null),
      fragmentShader: drawFrag(!!evolve, mapColor, litV != null),
      uniforms: drawUniforms,
      transparent: true,
      depthWrite: false,
      blending: BLENDS[this._blend],
      lights: litV != null,
    });
    const points = new THREE.Points(geometry, material);
    // the vertex shader places everything; three can't know the bounds
    points.frustumCulled = false;
    // the gate on the shadow-map define and the receiveShadow uniform — on a
    // Points it costs nothing until some light casts
    if (litV != null) points.receiveShadow = true;

    let castUniforms = null;
    if (this._cast) {
      points.castShadow = true;
      castUniforms = {
        uPosTex: drawUniforms.uPosTex,
        uVelTex: drawUniforms.uVelTex,
        uSizeA: drawUniforms.uSizeA,
        uSizeB: drawUniforms.uSizeB,
        uOpacity: drawUniforms.uOpacity,
        uFade: drawUniforms.uFade,
        uSoft: drawUniforms.uSoft,
        uShadowPix: { value: 1024 },
      };
      if (evolve) {
        castUniforms.uRamp = drawUniforms.uRamp;
        castUniforms.uRampSize = drawUniforms.uRampSize;
      }
      points.customDepthMaterial = new THREE.ShaderMaterial({
        vertexShader: castVert(!!evolve),
        fragmentShader: castFrag(!!evolve, false),
        uniforms: castUniforms,
      });
      const distMat = new THREE.ShaderMaterial({
        vertexShader: castVert(!!evolve),
        fragmentShader: castFrag(!!evolve, true),
        uniforms: {
          ...castUniforms,
          opacity: { value: 1 },
          referencePosition: { value: new THREE.Vector3() },
          nearDistance: { value: 1 },
          farDistance: { value: 1000 },
        },
      });
      // a lie three is told on purpose: the shadow pass and the uniform
      // refresh both check this flag to hand a distance material the point
      // light's position and range — the only route a custom material has
      distMat.isMeshDistanceMaterial = true;
      points.customDistanceMaterial = distMat;
    }
    // the ramp is per-run (clearPatch disposes the material, not its textures)
    material.addEventListener('dispose', () => rampTex?.dispose());
    if (texEmit) {
      // the source chain renders through the same registry material maps use,
      // so the image stays live; the sim samples last frame's pixels, one
      // frame nobody can see
      engine.textureMaps.push({
        node: src,
        uniform: uniforms.uSpawnTex,
        isAlive: () => !!points.parent,
        tex: null,
      });
    }

    const soft = this._soft;
    const baseColor = new THREE.Color();
    const drawSize = new THREE.Vector2();
    // shadow point size wants the map's height, and the pass doesn't say whose
    // map it's rendering — the largest casting light's is the least wrong
    let shadowPix = 0;
    const measurePix = (o) => {
      if (o.isLight && o.castShadow && o.shadow) shadowPix = Math.max(shadowPix, o.shadow.mapSize.y);
    };
    // checked on the first real frame, when the whole patch is in the scene
    let litChecked = litV == null;
    let anyLight = false;
    const findLight = (o) => { anyLight ||= o.isLight; };
    const bakeRamp = (t) => {
      const opa = resolve(opA, t), opb = resolve(opB, t);
      let sizeSet = false;
      let forceSet = false;
      let colorSet = false;
      for (let k = 0; k < RAMP_N; k++) {
        const lf = k / (RAMP_N - 1);
        // start each sample at the chain's own look for that life point
        baseColor.copy(drawUniforms.uColorA.value).lerp(drawUniforms.uColorB.value, lf);
        handle._t = t;
        handle.reset(baseColor, opa + (opb - opa) * lf);
        try {
          evolve(handle, lf, t);
        } catch (e) {
          warn(e.message ?? String(e));
        }
        const c = handle._color;
        rampData[k * 4] = c.r;
        rampData[k * 4 + 1] = c.g;
        rampData[k * 4 + 2] = c.b;
        rampData[k * 4 + 3] = resolve(handle._opacity, t);
        if (handle._size != null) {
          sizeSet = true;
          rampData[(RAMP_N + k) * 4] = resolve(handle._size, t);
        }
        if (handle._colorSet) colorSet = true;
        if (handle._force) {
          forceSet = true;
          const fbase = (RAMP_N * 2 + k) * 4;
          rampData[fbase] = resolve(handle._force[0], t) || 0;
          rampData[fbase + 1] = resolve(handle._force[1], t) || 0;
          rampData[fbase + 2] = resolve(handle._force[2], t) || 0;
        }
      }
      drawUniforms.uRampSize.value = sizeSet ? 1 : 0;
      state.simMat.uniforms.uRampForce.value = forceSet ? 1 : 0;
      if (drawUniforms.uRampColor) drawUniforms.uRampColor.value = colorSet ? 1 : 0;
      rampTex.needsUpdate = true;
    };
    const updater = (t, dt) => {
      // colors first: the ramp bake starts from them, and the sim reads the
      // ramp's force row, so the bake has to land before the step
      if (isDynamicColor(colorA)) setColor(drawUniforms.uColorA.value, colorA, t);
      if (isDynamicColor(colorB)) setColor(drawUniforms.uColorB.value, colorB, t);
      if (evolve) bakeRamp(t);
      const u = state.simMat.uniforms;
      u.uTime.value = t;
      // a background tab hands back one giant dt; a clamped step loses time
      // instead of teleporting every particle through its forces
      u.uDt.value = Math.min(Math.max(dt, 0), 0.1);
      for (const set of setters) set(u, t);
      if (texEmit) {
        // spawn plane: asked-for world height, width from the screen's aspect
        engine.renderer.getDrawingBufferSize(drawSize);
        const ph = Math.max(resolve(planeSize, t), 1e-3);
        u.uPlane.value.set(ph * (drawSize.x / Math.max(drawSize.y, 1)), ph);
      }
      if (dt > 0) {
        u.uPosTex.value = state.read.textures[0];
        u.uVelTex.value = state.read.textures[1];
        if (texEmit) u.uAuxTex.value = state.read.textures[2];
        quad.render(engine.renderer, state.simMat, state.write);
        engine.renderer.setRenderTarget(null);
        const swap = state.read;
        state.read = state.write;
        state.write = swap;
      }
      drawUniforms.uPosTex.value = state.read.textures[0];
      drawUniforms.uVelTex.value = state.read.textures[1];
      if (mapColor) drawUniforms.uAuxTex.value = state.read.textures[2];
      // world-size points: px = size * (proj scale * bufferHeight / 2) / depth
      engine.renderer.getDrawingBufferSize(drawSize);
      drawUniforms.uPixScale.value = 0.5 * drawSize.y * engine.camera.projectionMatrix.elements[5];
      drawUniforms.uSizeA.value.set(...resolveRange(sizeA, t));
      drawUniforms.uSizeB.value.set(...resolveRange(sizeB, t));
      drawUniforms.uOpacity.value.set(resolve(opA, t), resolve(opB, t));
      drawUniforms.uSoft.value = resolve(soft, t);
      if (litV != null) drawUniforms.uLit.value = resolve(litV, t);
      if (!litChecked && dt > 0) {
        litChecked = true;
        engine.scene.traverse(findLight);
        if (!anyLight) warn("particles: .lit() finds no lights in the scene, so the dots render black — add directional()/point()/spot()/ambient(); hdri() lighting doesn't reach particles");
      }
      if (castUniforms) {
        shadowPix = 0;
        engine.scene.traverse(measurePix);
        castUniforms.uShadowPix.value = shadowPix || 1024;
      }
      points.position.set(...resolve3(this._pos, t));
      points.rotation.set(...resolve3(this._rot, t));
      points.scale.set(...resolve3(this._scale, t));
    };

    updater(engine.time, 0);
    if (name != null) points.layers.set(engine.geoLayer(String(name)));
    engine.add(points, updater);
    return this;
  }
}

ParticleOp.prototype.pos = ParticleOp.prototype.position;
ParticleOp.prototype.rot = ParticleOp.prototype.rotation;
