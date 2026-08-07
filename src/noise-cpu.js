// A CPU twin of the vertex displacement in noise.js, so geo.sample() can land
// points on a .noise()'d surface instead of the smooth shape underneath it.
//
// This is a transliteration, not a reimplementation: every line below has a
// counterpart in SNOISE_GLSL / NOISE_GLSL / NOISE_NORMAL, in the same order,
// and the two must be edited together. A near-miss is worse than nothing here —
// another simplex variant (three's bundled SimplexNoise, say) uses a different
// gradient table, so it would produce a field that looks about the same and
// puts every point in the wrong place.
//
// It agrees with the GPU to float precision: the lattice half is integer math
// small enough to be exact in both (the permute chain peaks around 2.8e6, well
// under float32's 2^24), and the smooth half differs only in the last bits of a
// float32. Nothing renders from this — it runs a few thousand times a frame for
// sampled points, not per vertex. dev-notes/NOISE-PARITY.md records what was verified,
// the known benign discrepancies, and how to re-test after editing.

// --- snoise: Ashima / stegu 3D simplex, SNOISE_GLSL ------------------------

const mod289 = (x) => x - Math.floor(x * (1 / 289)) * 289;
const permute = (x) => mod289((x * 34 + 1) * x);
const taylorInvSqrt = (r) => 1.79284291400159 - 0.85373472095314 * r;
// GLSL step(edge, x): 0 below the edge, 1 at or above it
const step = (edge, x) => (x >= edge ? 1 : 0);

const C_X = 1 / 6;
const C_Y = 1 / 3;

// Gradient from the shader's 7x7 octahedron grid, one per corner index p.
//
// This part runs in emulated float32 (fr = Math.fround after every op, as GLSL
// rounds after every op), because it is a chain of floor()s whose inputs land
// exactly on integer boundaries: the shader's truncated n_ = 0.142857142857
// rounds *up* past 1/7 in float32, so on the GPU floor(7.0 * ns.z) is 1 —
// while the same constant held as a double sits *below* 1/7 and floors to 0.
// Different floor, different gradient, a field that spikes to |4| where the
// real one stays in [-1, 1]. p itself is an exact integer (< 2^24) either way.
const fr = Math.fround;
const N_ = fr(0.142857142857);
const NS_X = fr(N_ * 2);          // ns = n_ * D.wyz - D.xzx
const NS_Y = fr(fr(N_ * 0.5) - 1);
const NS_Z = N_;

function gr(p) {
  const j = p - 49 * Math.floor(fr(fr(p * NS_Z) * NS_Z));
  const xf = Math.floor(fr(j * NS_Z));
  const yf = j - 7 * xf;          // exact integers; floor() is a no-op
  const x = fr(fr(xf * NS_X) + NS_Y);
  const y = fr(fr(yf * NS_X) + NS_Y);
  const h = fr(fr(1 - Math.abs(x)) - Math.abs(y));
  // pull the two lower-hemisphere lobes back onto the octahedron; the grid
  // has cells where |x| + |y| is exactly 1, so h = 0 must side with the GLSL
  // step(h, 0), which it does: -step means sh = -1 at h <= 0
  const sh = h <= 0 ? -1 : 0;
  const ax = fr(x + (Math.floor(x) * 2 + 1) * sh);
  const ay = fr(y + (Math.floor(y) * 2 + 1) * sh);
  const n = taylorInvSqrt(ax * ax + ay * ay + h * h);
  return [ax * n, ay * n, h * n];
}

export function snoise(vx, vy, vz) {
  const s = (vx + vy + vz) * C_Y;
  const ix = Math.floor(vx + s);
  const iy = Math.floor(vy + s);
  const iz = Math.floor(vz + s);

  const t0 = (ix + iy + iz) * C_X;
  const x0x = vx - ix + t0;
  const x0y = vy - iy + t0;
  const x0z = vz - iz + t0;

  // rank the components to pick which of the six simplices we're in, on a
  // nudged copy — see the same nudge in SNOISE_GLSL for why
  const r0 = x0x, r1 = x0y + 1e-5, r2 = x0z + 2e-5;
  const gx = step(r1, r0);
  const gy = step(r2, r1);
  const gz = step(r0, r2);
  const lx = 1 - gx;
  const ly = 1 - gy;
  const lz = 1 - gz;
  const i1x = Math.min(gx, lz);
  const i1y = Math.min(gy, lx);
  const i1z = Math.min(gz, ly);
  const i2x = Math.max(gx, lz);
  const i2y = Math.max(gy, lx);
  const i2z = Math.max(gz, ly);

  const x1x = x0x - i1x + C_X;
  const x1y = x0y - i1y + C_X;
  const x1z = x0z - i1z + C_X;
  const x2x = x0x - i2x + C_Y;
  const x2y = x0y - i2y + C_Y;
  const x2z = x0z - i2z + C_Y;
  const x3x = x0x - 0.5;
  const x3y = x0y - 0.5;
  const x3z = x0z - 0.5;

  const mx = mod289(ix);
  const my = mod289(iy);
  const mz = mod289(iz);

  // gradient indices for the four corners
  let p0 = permute(mz);
  let p1 = permute(mz + i1z);
  let p2 = permute(mz + i2z);
  let p3 = permute(mz + 1);
  p0 = permute(p0 + my);
  p1 = permute(p1 + my + i1y);
  p2 = permute(p2 + my + i2y);
  p3 = permute(p3 + my + 1);
  p0 = permute(p0 + mx);
  p1 = permute(p1 + mx + i1x);
  p2 = permute(p2 + mx + i2x);
  p3 = permute(p3 + mx + 1);

  const g0 = gr(p0);
  const g1 = gr(p1);
  const g2 = gr(p2);
  const g3 = gr(p3);

  // radial falloff, quartic, clipped where a corner is out of range
  let m0 = Math.max(0.6 - (x0x * x0x + x0y * x0y + x0z * x0z), 0);
  let m1 = Math.max(0.6 - (x1x * x1x + x1y * x1y + x1z * x1z), 0);
  let m2 = Math.max(0.6 - (x2x * x2x + x2y * x2y + x2z * x2z), 0);
  let m3 = Math.max(0.6 - (x3x * x3x + x3y * x3y + x3z * x3z), 0);
  m0 *= m0; m0 *= m0;
  m1 *= m1; m1 *= m1;
  m2 *= m2; m2 *= m2;
  m3 *= m3; m3 *= m3;

  return 42 * (
    m0 * (g0[0] * x0x + g0[1] * x0y + g0[2] * x0z)
    + m1 * (g1[0] * x1x + g1[1] * x1y + g1[2] * x1z)
    + m2 * (g2[0] * x2x + g2[1] * x2y + g2[2] * x2z)
    + m3 * (g3[0] * x3x + g3[1] * x3y + g3[2] * x3z));
}

// --- fbm and displacePoint, NOISE_GLSL -------------------------------------

function fbm(x, y, z, c) {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < 8; i++) {
    if (i >= c.octaves) break;
    sum += amp * snoise(x * freq, y * freq, z * freq);
    norm += amp;
    freq *= c.lacunarity;
    amp *= c.gain;
  }
  return norm > 0 ? sum / norm : 0;
}

// DOMAIN_OFFSET and TIME_DIR from NOISE_GLSL, which keep an object's own
// vertices off snoise's degenerate three-way ranking ties (the reasoning is
// there) — change them here and there together
const OFF = [0.0, 3.7, 8.3];
const TDIR = [1.0, 0.83, 0.61];

// how far along the normal the surface moves at p — the scalar the GPU adds
const offset = (px, py, pz, c) => {
  const k = c.time * c.speed;
  const s = c.seed * 19.19;
  return fbm(px * c.freq + k * TDIR[0] + OFF[0] + s,
    py * c.freq + k * TDIR[1] + OFF[1] + s,
    pz * c.freq + k * TDIR[2] + OFF[2] + s, c) * c.amp;
};

// --- the surface, NOISE_NORMAL ---------------------------------------------

// Both of these take an already-normalized n, and write into `out` so a layout
// fn calling them per copy doesn't allocate.

export function displacedPoint(p, n, c, out) {
  const d = offset(p.x, p.y, p.z, c);
  return out.set(p.x + n.x * d, p.y + n.y * d, p.z + n.z * d);
}

// The shader rebuilds the normal by displacing two tangent-offset neighbours
// and crossing the result, rather than differentiating the field — same three
// taps here, same eps, or a .align() would aim at a surface nobody can see.
const EPS = 0.08;

export function displacedNormal(p, n, c, out) {
  // any tangent pair would do, as long as it's the pair the shader picks:
  // cross(n, +Y), or cross(n, +X) where that one would collapse
  let tax, tay, taz;
  if (Math.abs(n.y) < 0.99) {
    tax = -n.z; tay = 0; taz = n.x;
  } else {
    tax = 0; tay = n.z; taz = -n.y;
  }
  const l = Math.sqrt(tax * tax + tay * tay + taz * taz) || 1;
  tax /= l; tay /= l; taz /= l;
  // tangentB = cross(n, tangentA), unit already: both are, and they're square
  const tbx = n.y * taz - n.z * tay;
  const tby = n.z * tax - n.x * taz;
  const tbz = n.x * tay - n.y * tax;

  // every neighbour moves along n, not along its own normal — the shader has
  // only the one normal to hand at that point, and so do we
  const d0 = offset(p.x, p.y, p.z, c);
  const da = offset(p.x + tax * EPS, p.y + tay * EPS, p.z + taz * EPS, c);
  const db = offset(p.x + tbx * EPS, p.y + tby * EPS, p.z + tbz * EPS, c);

  const ax = tax * EPS + n.x * (da - d0);
  const ay = tay * EPS + n.y * (da - d0);
  const az = taz * EPS + n.z * (da - d0);
  const bx = tbx * EPS + n.x * (db - d0);
  const by = tby * EPS + n.y * (db - d0);
  const bz = tbz * EPS + n.z * (db - d0);
  out.set(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx);
  // a flat patch of field can cross to nothing; the smooth normal is the answer
  return out.lengthSq() < 1e-20 ? out.copy(n) : out.normalize();
}
