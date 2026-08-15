// backrooms — a generated maze, walked on a loop by a camcorder
// The constants carry their own alternatives; commented-out lines are extras:
// uncomment one to try it.

// --- maze ---

const W = 16, H = 16
const C = 3.4                 // cell size
const WALL_H = 2.7
const TH = 0.26               // wall thickness

let seed = 8087               // any other number is a different maze
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)

// vw[i + j*(W+1)]: wall between cells (i-1,j) and (i,j), running along z at
// x = (i - 0.5)C.  hw[i + j*W]: between (i,j-1) and (i,j), along x.
const vw = new Array((W + 1) * H).fill(true)
const hw = new Array(W * (H + 1)).fill(true)
const parent = new Array(W * H).fill(-2)   // -2 unvisited, -1 root

const stack = [[0, 0]]
parent[0] = -1
while (stack.length) {
  const [i, j] = stack[stack.length - 1]
  const opts = []
  if (i > 0 && parent[(i - 1) + j * W] === -2) opts.push([-1, 0])
  if (i < W - 1 && parent[(i + 1) + j * W] === -2) opts.push([1, 0])
  if (j > 0 && parent[i + (j - 1) * W] === -2) opts.push([0, -1])
  if (j < H - 1 && parent[i + (j + 1) * W] === -2) opts.push([0, 1])
  if (!opts.length) { stack.pop(); continue }
  const [di, dj] = opts[Math.floor(rnd() * opts.length)]
  if (di) vw[(i + (di > 0 ? 1 : 0)) + j * (W + 1)] = false
  if (dj) hw[i + (j + (dj > 0 ? 1 : 0)) * W] = false
  parent[(i + di) + (j + dj) * W] = i + j * W
  stack.push([i + di, j + dj])
}

// Braiding: knock out interior walls to turn the tree into loops.
// The 0.25 is how many: 0.05 is claustrophobic, 0.8 an empty hall.
const braids = []
for (let k = 0; k < W * H * 0.25; k++) {
  const i = 1 + Math.floor(rnd() * (W - 1)), j = Math.floor(rnd() * H)
  if (vw[i + j * (W + 1)]) { vw[i + j * (W + 1)] = false; braids.push([(i - 1) + j * W, i + j * W]) }
  const a = Math.floor(rnd() * W), b = 1 + Math.floor(rnd() * (H - 1))
  if (hw[a + b * W]) { hw[a + b * W] = false; braids.push([a + (b - 1) * W, a + b * W]) }
}

// --- geometry ---

const walls = []   // [x, z, alongZ?]
for (let j = 0; j < H; j++)
  for (let i = 0; i <= W; i++) if (vw[i + j * (W + 1)]) walls.push([(i - 0.5) * C, j * C, 1])
for (let j = 0; j <= H; j++)
  for (let i = 0; i < W; i++) if (hw[i + j * W]) walls.push([i * C, (j - 0.5) * C, 0])

box({ res: 1 })
  .instance(walls.length, (x, i) => {
    const w = walls[i]
    // scale happens before rotation, so one unit box makes both orientations
    x.position(w[0], WALL_H / 2, w[1]).rotation(0, w[2] ? Math.PI / 2 : 0, 0).scale(C + TH, WALL_H, TH)
  })
  .material({ color: '#d9c47e', roughness: 0.92 })
  .out()

const SPAN = Math.max(W, H) * C + C * 2
const MID = [(W - 1) * C / 2, (H - 1) * C / 2]

plane({ width: SPAN, height: SPAN, res: 1 }).rotation(-Math.PI / 2, 0, 0).position(MID[0], 0, MID[1])
  .material({ color: '#7d6b3c', roughness: 1 }).out()
plane({ width: SPAN, height: SPAN, res: 1 }).rotation(Math.PI / 2, 0, 0).position(MID[0], WALL_H, MID[1])
  .material({ color: '#ddd2a6', roughness: 1 }).out()

const lamps = []
for (let j = 0; j < H; j++)
  for (let i = 0; i < W; i++) if (rnd() < 0.55) lamps.push([i * C, j * C])

// Hung clear of the ceiling — flush against it they z-fight down long sightlines
box({ res: 1 })
  .instance(lamps.length, (x, i) => x.position(lamps[i][0], WALL_H - 0.14, lamps[i][1]).scale(2.3, 0.1, 1.2))
  .material({ color: '#fffdf2', emissive: '#fff3cc', emissiveIntensity: 7 })
  .out()

// --- walk ---

// The route has to be a simple cycle, so the camera can always aim at a point
// further along it. Take the longest loop closed by a braided wall.
const toRoot = (c) => { const out = []; for (let x = c; x !== -1; x = parent[x]) out.push(x); return out }
const loopThrough = (a, b) => {
  const A = toRoot(a), B = toRoot(b)
  const rank = new Map(B.map((c, i) => [c, i]))
  let i = 0
  while (!rank.has(A[i])) i++           // A[i] is the lowest common ancestor
  return [...A.slice(0, i + 1), ...B.slice(0, rank.get(A[i])).reverse()]
}

let best = []
for (const [a, b] of braids) {
  const loop = loopThrough(a, b)
  if (loop.length > best.length) best = loop
}
const path = best.map((c) => [c % W, Math.floor(c / W)])

// Midpoints keep the curve on the corridor axis, so it doesn't cut corners
// through walls
const pts = []
for (let k = 0; k < path.length; k++) {
  const a = path[k], b = path[(k + 1) % path.length]
  pts.push(new THREE.Vector3(a[0] * C, 0, a[1] * C))
  pts.push(new THREE.Vector3((a[0] + b[0]) / 2 * C, 0, (a[1] + b[1]) / 2 * C))
}
const route = new THREE.CatmullRomCurve3(pts, true, 'centripetal', 0.5)
route.arcLengthDivisions = pts.length * 6   // default 200 is far too coarse here
route.updateArcLengths()

const LEN = route.getLength()
const LOOP = LEN / 2.3          // seconds per lap; a smaller divisor walks slower

// Cached per t — camera() and the lights each ask for this separately
const along = (meters) => {
  let last = -1
  const v = new THREE.Vector3()
  return (t) => {
    if (t !== last) { last = t; route.getPointAt(((t / LOOP + meters / LEN) % 1 + 1) % 1, v) }
    return v
  }
}
const eye = along(0), aim = along(2.6), ahead = along(9)
// route.getTangentAt(u) is the other way to aim: the curve knows which way
// you're facing, without a second point further along it

camera(
  (t) => eye(t).x,
  (t) => 1.62 + Math.sin(t * 2.4) * 0.025,      // handheld sway
  (t) => eye(t).z,
  [(t) => aim(t).x, () => 1.66, (t) => aim(t).z]   // level, so the ceiling stays in frame
)

// --- light ---

// Fluorescent light is flat, so most of it is ambient. Two points shape the
// corridor: one at the camera, one further along the route.
ambient({ intensity: 0.58, color: '#d8c98f' })   // the main dial for how lit the place is

// The 12 and the 9 trade the two off: higher is more torch beam, less office
const buzz = rand(13, 4)
point({ color: '#fff6d6', intensity: (t) => 12 * (0.82 + 0.24 * buzz(t)), distance: 26, decay: 1.3 })
  .position((t) => eye(t).x, WALL_H - 0.35, (t) => eye(t).z).out()
point({ color: '#ffeec4', intensity: (t) => 9 * (0.8 + 0.28 * buzz(t + 3.1)), distance: 22, decay: 1.3 })
  .position((t) => ahead(t).x, WALL_H - 0.35, (t) => ahead(t).z).out()

// --- tape ---

scene()
  // Masking a color by depth is fog in texture space — yellow, so the haze
  // brightens with distance
  .mask(depth({ near: 8, far: 42 }), s => s.comp(constant('#cbb877'), 'over'))
  .mask(depth({ near: 22, far: 46 }), s => s.blur(4))                   // far end goes soft
  .levels({ contrast: 1.02, saturation: 0.9, gamma: 1.12 })
  .comp(noise({ freq: 300, octaves: 1, speed: 55 }), 'overlay', 0.07)   // tape grain
  .chroma(0.0022, { radial: true })
  .warp({ barrel: 0.11 })
  .mask(ramp({ type: 'radial', a: '#ffffff', b: '#b4b4b4', phase: -0.15 }))   // vignette
  .bloom({ threshold: 0.78, strength: 0.6, radius: 1.2 })
  // .comp(text('CAM 01', { size: 26, pos: [0.08, 0.92], align: 'left', bg: '#000000' }), 'screen')
  .out()
