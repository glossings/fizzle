import * as THREE from 'three';
import { runPass, makeMaterial } from './textures.js';
import { carried, isClaiming } from './carry.js';
import { warn } from './warn.js';

// A Stam-style incompressible solver as one texture op. The whole sim lives in
// half-float targets at its own small resolution and steps once per frame:
// advect velocity, add what the sources push in, restore the swirl advection
// ate, then project — a Jacobi solve of the pressure Poisson equation, whose
// gradient subtracted off is what makes the field divergence-free. That last
// part is the only reason this is an op and not a chain: it needs tens of
// iterations *within* a frame, against a velocity field held still, which a
// feedback bus can't express (one bus step is one frame).
//
// Units. Velocity is in frame-heights per second, so a sketch's numbers mean
// the same thing at any `res` and on any window shape — the sim grid keeps
// square cells, so `res` is the long edge and the short one follows the aspect.
// The projection itself is unit-free: divergence and the gradient subtracted
// off are both in cell units, and removing the divergent part of a field is
// linear, so only advection converts (hence the /uAspect on x).
//
// State is carried (carry.js), so editing the sketch doesn't blow the smoke
// away. Resizing the frame does — the grid is reallocated and starts black.

const resolve = (v, t) => (typeof v === 'function' ? v(t) : v);

// Clamped so a dropped frame doesn't advect a step so long it jumps the whole
// grid: semi-Lagrangian advection is unconditionally stable, but the picture
// still lurches, and the tab returning from a background is the usual way in.
const DT_MAX = 1 / 30;

const RES_MAX = 1024;

// ---------------------------------------------------------------------------
// GLSL
//
// Derivatives are in cell units (one texel, central difference), which is what
// makes the Jacobi kernel below the plain 4-neighbour one. `uTexel` is the
// target's, so every pass here reads its neighbours at the sim grid's spacing.

// A solid cell contributes no velocity to its neighbours (no-slip) and mirrors
// their pressure (Neumann), which together are what make flow go *around* an
// obstacle rather than through it.
const SOLID = /* glsl */ `
uniform sampler2D uObs;
float solid(vec2 p) {
  return uHasObs < 0.5 ? 0.0 : step(0.5, dot(texture2D(uObs, p).rgb, LUMA));
}
`;

const FRAG_ADVECT = /* glsl */ `
void main() {
  vec2 v = texture2D(tex1, vUv).rg;
  // frame-heights/sec -> uv: y spans one height, x spans aspect of them
  vec2 p = vUv - v * uDt * vec2(1.0 / uAspect, 1.0);
  gl_FragColor = texture2D(tex0, p) * uDecay;
}
`;

// tex0 = velocity, tex1 = the map being pushed in
const FRAG_PUSH = /* glsl */ `
void main() {
  vec2 f = (texture2D(tex1, vUv).rg - uMod.y) * uMod.x;
  gl_FragColor = vec4(texture2D(tex0, vUv).rg + f * uDt, 0.0, 1.0);
}
`;

// tex0 = dye, tex1 = the chain being poured in. Premultiplied like every other
// buffer here, so an ink chain with holes in it pours nothing through them.
const FRAG_INK = /* glsl */ `
void main() {
  gl_FragColor = texture2D(tex0, vUv) + texture2D(tex1, vUv) * uAmount * uDt;
}
`;

const FRAG_CURL = /* glsl */ `
void main() {
  vec2 ex = vec2(uTexel.x, 0.0), ey = vec2(0.0, uTexel.y);
  vec2 c = texture2D(tex0, vUv).rg;
  float vyl = texture2D(tex0, vUv - ex).g;
  float vxb = texture2D(tex0, vUv - ey).r;
  // compact differences, matching the divergence. A central difference has a
  // null at the one-cell wavelength, so it cannot see the mode most worth
  // seeing — which made this the wrong instrument to debug the solve with.
  gl_FragColor = vec4((c.y - vyl) - (c.x - vxb), 0.0, 0.0, 1.0);
}
`;

// Confinement reads this rather than the raw curl. A 3x3 tent has zero
// response at the one-cell wavelength, which is exactly the mode confinement
// would otherwise amplify: it pushes along the gradient of |curl|, and that
// gradient is steepest at single-cell noise, so raw curl makes the force chase
// the speckle it just created. The displayed .curl() stays raw.
const FRAG_SMOOTH = /* glsl */ `
void main() {
  vec2 e = uTexel;
  float c = texture2D(tex0, vUv).r;
  float n = texture2D(tex0, vUv + vec2(e.x, 0.0)).r + texture2D(tex0, vUv - vec2(e.x, 0.0)).r
          + texture2D(tex0, vUv + vec2(0.0, e.y)).r + texture2D(tex0, vUv - vec2(0.0, e.y)).r;
  float d = texture2D(tex0, vUv + e).r + texture2D(tex0, vUv - e).r
          + texture2D(tex0, vUv + vec2(e.x, -e.y)).r + texture2D(tex0, vUv + vec2(-e.x, e.y)).r;
  gl_FragColor = vec4((4.0 * c + 2.0 * n + d) * 0.0625, 0.0, 0.0, 1.0);
}
`;

// Vorticity confinement: push each cell along the vortex it already sits in,
// scaled by how sharply the curl falls off. Advection damps small eddies at
// this grid size and this is what puts them back — without it a low res
// reads as soup rather than as smoke.
const FRAG_VORT = /* glsl */ `
void main() {
  float l = abs(texture2D(tex1, vUv - vec2(uTexel.x, 0.0)).r);
  float r = abs(texture2D(tex1, vUv + vec2(uTexel.x, 0.0)).r);
  float b = abs(texture2D(tex1, vUv - vec2(0.0, uTexel.y)).r);
  float t = abs(texture2D(tex1, vUv + vec2(0.0, uTexel.y)).r);
  vec2 g = 0.5 * vec2(r - l, t - b);
  g /= length(g) + 1e-5;
  float w = texture2D(tex1, vUv).r;
  gl_FragColor = vec4(texture2D(tex0, vUv).rg + vec2(g.y, -g.x) * w * uVort * uDt, 0.0, 1.0);
}
`;

const FRAG_DIV = /* glsl */ `
${SOLID}
void main() {
  vec2 ex = vec2(uTexel.x, 0.0), ey = vec2(0.0, uTexel.y);
  float sc = solid(vUv);
  // Read the stored velocity as living on each cell's *low* faces, so this is
  // the flux in through them minus the flux out through the next cell's. Paired
  // with the backward gradient in FRAG_PROJECT it composes to exactly the
  // five-point Laplacian the Jacobi pass inverts — which is the whole point.
  // Central differences either side would compose to a stencil reaching two
  // cells, splitting the grid into two sublattices that never see each other:
  // the solve would then be inverting a different operator than the projection
  // applies, and the leftover divergence would sit in the one-cell checkerboard
  // mode forever, since nothing in the loop can observe it.
  float xl = texture2D(tex0, vUv).r,      yb = texture2D(tex0, vUv).g;
  float xr = texture2D(tex0, vUv + ex).r, yt = texture2D(tex0, vUv + ey).g;
  xl *= 1.0 - max(sc, solid(vUv - ex));
  yb *= 1.0 - max(sc, solid(vUv - ey));
  xr *= 1.0 - max(sc, solid(vUv + ex));
  yt *= 1.0 - max(sc, solid(vUv + ey));
  gl_FragColor = vec4((xr - xl) + (yt - yb), 0.0, 0.0, 1.0);
}
`;

// One Jacobi iteration of the Poisson solve. tex0 = pressure, tex1 = divergence.
const FRAG_JACOBI = /* glsl */ `
${SOLID}
void main() {
  vec2 ex = vec2(uTexel.x, 0.0), ey = vec2(0.0, uTexel.y);
  float c = texture2D(tex0, vUv).r;
  float l = texture2D(tex0, vUv - ex).r, r = texture2D(tex0, vUv + ex).r;
  float b = texture2D(tex0, vUv - ey).r, t = texture2D(tex0, vUv + ey).r;
  // a solid neighbour reflects this cell's own pressure back: dp/dn = 0
  l = mix(l, c, solid(vUv - ex));  r = mix(r, c, solid(vUv + ex));
  b = mix(b, c, solid(vUv - ey));  t = mix(t, c, solid(vUv + ey));
  gl_FragColor = vec4((l + r + b + t - texture2D(tex1, vUv).r) * 0.25, 0.0, 0.0, 1.0);
}
`;

// The projection proper, plus every boundary the field has: walls at the frame
// edge when the domain doesn't wrap, and solid cells wherever .obstacle() put
// them. tex0 = velocity, tex1 = pressure.
const FRAG_PROJECT = /* glsl */ `
${SOLID}
void main() {
  vec2 ex = vec2(uTexel.x, 0.0), ey = vec2(0.0, uTexel.y);
  float pc = texture2D(tex1, vUv).r;
  float pl = texture2D(tex1, vUv - ex).r;
  float pb = texture2D(tex1, vUv - ey).r;
  // backward, the adjoint of the divergence above
  vec2 v = texture2D(tex0, vUv).rg - vec2(pc - pl, pc - pb);
  // a face with a solid on either side of it carries nothing
  float sc = solid(vUv);
  v.x *= 1.0 - max(sc, solid(vUv - ex));
  v.y *= 1.0 - max(sc, solid(vUv - ey));
  if (uWalls > 0.5) {
    // the outermost cell is the wall itself, so it holds still
    vec2 edge = step(vUv, uTexel) + step(1.0 - uTexel, vUv);
    v *= 1.0 - min(edge.x + edge.y, 1.0);
  }
  gl_FragColor = vec4(v, 0.0, 1.0);
}
`;

// Signed fields leave as pictures, centred on mid-grey the way neighbor()'s
// slope map does — so they read on screen *and* drop into any map slot that
// takes a { map, mid: 0.5 }.
const FRAG_VIEW_VEC = /* glsl */ `
void main() { gl_FragColor = vec4(texture2D(tex0, vUv).rg * uScale * 0.5 + 0.5, 0.5, 1.0); }
`;

const FRAG_VIEW_SCALAR = /* glsl */ `
void main() { gl_FragColor = vec4(vec3(texture2D(tex0, vUv).r * uScale * 0.5 + 0.5), 1.0); }
`;

const FRAG_CLEAR = `void main() { gl_FragColor = vec4(0.0); }`;

// Shared, and safe to share: the passes below run one after another, never
// nested, exactly like textures.js's own MAT_BLUR and friends.
let MATS = null;
function mats() {
  if (MATS) return MATS;
  const obs = { uHasObs: 0 };
  MATS = {
    copy: makeMaterial({ frag: `void main() { gl_FragColor = texture2D(tex0, vUv); }` }),
    advect: makeMaterial({ extras: { uDt: 0, uDecay: 1 }, frag: FRAG_ADVECT }),
    push: makeMaterial({ extras: { uMod: [1, 0], uDt: 0 }, frag: FRAG_PUSH }),
    ink: makeMaterial({ extras: { uAmount: 1, uDt: 0 }, frag: FRAG_INK }),
    curl: makeMaterial({ frag: FRAG_CURL }),
    smooth: makeMaterial({ frag: FRAG_SMOOTH }),
    vort: makeMaterial({ extras: { uVort: 0, uDt: 0 }, frag: FRAG_VORT }),
    div: makeMaterial({ extras: obs, frag: FRAG_DIV }),
    jacobi: makeMaterial({ extras: obs, frag: FRAG_JACOBI }),
    project: makeMaterial({ extras: { ...obs, uWalls: 0 }, frag: FRAG_PROJECT }),
    viewVec: makeMaterial({ extras: { uScale: 1 }, frag: FRAG_VIEW_VEC }),
    viewScalar: makeMaterial({ extras: { uScale: 1 }, frag: FRAG_VIEW_SCALAR }),
    clear: makeMaterial({ frag: FRAG_CLEAR }),
  };
  // `extras` infers a GLSL type from a JS value and has no spelling for a
  // sampler — SOLID declares uObs itself, so only the JS side is added here
  for (const k of ['div', 'jacobi', 'project']) MATS[k].uniforms.uObs = { value: null };
  return MATS;
}

// ---------------------------------------------------------------------------
// state

function makeTarget(w, h, wrap) {
  const rt = new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType,
    depthBuffer: false,
  });
  rt.texture.wrapS = rt.texture.wrapT = wrap;
  rt.texture.minFilter = rt.texture.magFilter = THREE.LinearFilter;
  rt.texture.generateMipmaps = false;
  return rt;
}

const pair = (w, h, wrap) => ({
  read: makeTarget(w, h, wrap),
  write: makeTarget(w, h, wrap),
  swap() { const t = this.read; this.read = this.write; this.write = t; },
});

export function makeFluidState() {
  return { w: 0, h: 0, wrap: null, frame: -1,
           vel: null, dye: null, prs: null, div: null, curl: null, curlS: null, obs: null };
}

export function disposeFluidState(s) {
  for (const f of [s.vel, s.dye, s.prs]) { f?.read.dispose(); f?.write.dispose(); }
  s.div?.dispose();
  s.curl?.dispose();
  s.curlS?.dispose();
  s.obs?.dispose();
  s.vel = s.dye = s.prs = s.div = s.curl = s.curlS = s.obs = null;
  s.w = s.h = 0;
}

// The grid: `res` is the long edge, the short one follows the frame so cells
// stay square — an anisotropic cell would make the Laplacian anisotropic too,
// and vortices would come out as ellipses.
function fit(res, aspect) {
  res = Math.max(16, Math.min(RES_MAX, Math.round(res) || 256));
  return aspect >= 1
    ? { w: res, h: Math.max(16, Math.round(res / aspect)) }
    : { w: Math.max(16, Math.round(res * aspect)), h: res };
}

function ensure(ctx, s, res, wrapMode) {
  const { w, h } = fit(res, ctx.aspect);
  const wrap = wrapMode === 'repeat' ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  if (s.w === w && s.h === h && s.wrap === wrap) return false;
  disposeFluidState(s);
  s.w = w; s.h = h; s.wrap = wrap;
  s.vel = pair(w, h, wrap);
  s.dye = pair(w, h, wrap);
  s.prs = pair(w, h, wrap);
  s.div = makeTarget(w, h, wrap);
  s.curl = makeTarget(w, h, wrap);
  s.curlS = makeTarget(w, h, wrap);
  s.obs = makeTarget(w, h, wrap);
  // a target's contents are undefined until something renders into it, and the
  // first frame reads all of these before it writes them
  const m = mats();
  for (const rt of [s.vel.read, s.vel.write, s.dye.read, s.dye.write,
                    s.prs.read, s.prs.write, s.div, s.curl, s.curlS, s.obs]) {
    runPass(ctx, m.clear, null, null, rt);
  }
  return true;
}

// ---------------------------------------------------------------------------
// the step

export function renderFluid(node, ctx, ins) {
  const p = node.params;
  const s = node.sim;
  const m = mats();
  ensure(ctx, s, resolve(p.res ?? 256, ctx.t), p.wrap ?? 'repeat');

  // Frozen like .delay()'s ring: pausing holds the picture, and stepping the
  // sim behind a still frame would land somewhere else when it resumes.
  if (node.engine.paused) return s.dye.read.texture;

  // renderNode memoizes per frame *per context*, so a chain pulled at two
  // sizes in one frame renders twice — which for an op that integrates would
  // be two steps, at whichever aspect asked last. The sim steps once.
  if (s.frame === ctx.frame) return s.dye.read.texture;
  s.frame = ctx.frame;

  const dt = Math.min(ctx.dt ?? 0, DT_MAX) * resolve(p.speed ?? 1, ctx.t);
  if (dt <= 0) return s.dye.read.texture;

  const sources = p.sources ?? [];
  const obsIdx = sources.findIndex((src) => src.role === 'obstacle');
  const hasObs = obsIdx >= 0 && ins[obsIdx];
  // resampled to the grid once, rather than read at frame size by every one
  // of the tens of Jacobi iterations below
  if (hasObs) runPass(ctx, m.copy, ins[obsIdx], null, s.obs);
  const bindObs = (u) => {
    u.uObs.value = hasObs ? s.obs.texture : null;
    u.uHasObs.value = hasObs ? 1 : 0;
  };

  // 1. velocity carries itself downstream
  const damp = Math.pow(Math.max(0, 1 - resolve(p.damping ?? 0.3, ctx.t)), dt);
  runPass(ctx, m.advect, s.vel.read.texture, s.vel.read.texture, s.vel.write, (u) => {
    u.uDt.value = dt;
    u.uDecay.value = damp;
  });
  s.vel.swap();

  // 2. what the sketch pushes in
  for (let i = 0; i < sources.length; i++) {
    const src = sources[i];
    if (src.role !== 'push' || !ins[i]) continue;
    runPass(ctx, m.push, s.vel.read.texture, ins[i], s.vel.write, (u) => {
      u.uMod.value.set(resolve(src.amount, ctx.t), resolve(src.mid, ctx.t));
      u.uDt.value = dt;
    });
    s.vel.swap();
  }

  // 3. put back the swirl advection rounded off
  // unconditionally, cheap, and .curl() reads it whether or not confinement
  // is switched on
  runPass(ctx, m.curl, s.vel.read.texture, null, s.curl);
  const vort = resolve(p.vorticity ?? 0.3, ctx.t);
  if (vort > 0) {
    runPass(ctx, m.smooth, s.curl.texture, null, s.curlS);
    runPass(ctx, m.vort, s.vel.read.texture, s.curlS.texture, s.vel.write, (u) => {
      // The sketch's 0..1 knob against the scale the force wants. At 20 this
      // came out several times stronger than the forces driving the sim, so
      // confinement stopped being a correction and became the flow: the field
      // saturated into even foam a few cells across whatever else was set.
      // Confinement should restore the swirl advection rounded off, not supply
      // the motion.
      u.uVort.value = vort * 3;
      u.uDt.value = dt;
    });
    s.vel.swap();
  }

  // 4. project: solve for the pressure whose gradient cancels the divergence.
  // Last frame's pressure is the starting guess — the field moves a little per
  // frame, so a warm start is worth several iterations of a cold one.
  runPass(ctx, m.div, s.vel.read.texture, null, s.div, bindObs);
  const iters = Math.max(1, Math.min(120, Math.round(resolve(p.iterations ?? 30, ctx.t)) || 30));
  for (let i = 0; i < iters; i++) {
    runPass(ctx, m.jacobi, s.prs.read.texture, s.div.texture, s.prs.write, bindObs);
    s.prs.swap();
  }
  runPass(ctx, m.project, s.vel.read.texture, s.prs.read.texture, s.vel.write, (u) => {
    bindObs(u);
    u.uWalls.value = (p.wrap ?? 'repeat') === 'repeat' ? 0 : 1;
  });
  s.vel.swap();

  // 5. the dye rides the field it just made
  const fade = Math.pow(Math.max(0, 1 - resolve(p.fade ?? 0.4, ctx.t)), dt);
  runPass(ctx, m.advect, s.dye.read.texture, s.vel.read.texture, s.dye.write, (u) => {
    u.uDt.value = dt;
    u.uDecay.value = fade;
  });
  s.dye.swap();

  for (let i = 0; i < sources.length; i++) {
    const src = sources[i];
    if (src.role !== 'ink' || !ins[i]) continue;
    runPass(ctx, m.ink, s.dye.read.texture, ins[i], s.dye.write, (u) => {
      u.uAmount.value = resolve(src.amount, ctx.t);
      u.uDt.value = dt;
    });
    s.dye.swap();
  }

  return s.dye.read.texture;
}

// A view is its own node so the sim runs once however many fields are read:
// the sim node is its input, so the graph's ordering and renderNode's per-frame
// memo do the work, and this pass only re-encodes what's already there.
// Defaults that put each field somewhere visible: velocity is in heights per
// second and reads around a few tenths, while curl and pressure are differences
// across one cell and read two orders smaller.
const VIEW_SCALE = { velocity: 2, curl: 50, pressure: 50 };

export function renderFluidView(node, ctx) {
  const s = node.sim;
  if (!s.vel) return null;
  const m = mats();
  const field = node.params.field;
  const src = field === 'curl' ? s.curl
    : field === 'pressure' ? s.prs.read
    : s.vel.read;
  const out = node._rt(ctx);
  runPass(ctx, field === 'velocity' ? m.viewVec : m.viewScalar, src.texture, null, out, (u) => {
    u.uScale.value = resolve(node.params.scale ?? VIEW_SCALE[field], ctx.t);
  });
  return out.texture;
}

// Built once per fluid() call and shared by every node the chain derives from
// it, so .ink().push() is one sim rather than three.
export function claimFluidState() {
  if (!isClaiming()) {
    warn('fluid(): only meaningful while the sketch is running — a call from onFrame() would build a new sim every frame');
    return makeFluidState();
  }
  return carried('fluid', makeFluidState, disposeFluidState);
}
