import { MATERIAL_GROUPS, MATERIAL_DOCS, PRESET_NAMES } from './materials.js';
import { BLEND_MODE_NAMES, COPY_BLEND_NAMES, ASCII_SET_NAMES, WRAP_MODE_NAMES } from './textures.js';

// One docs table drives both autocomplete and ctrl+hover tooltips.
// [0] signature — shown next to the completion, and as the tooltip header
// [1] what the call is
// [2] optional key groups the signature had no room for
//
// An entry says what the call *does*, at the level someone deciding whether to
// reach for it needs, and what they can pass. It does not walk the keys: every
// key has a hover of its own (KEY_DOCS below), and repeating them here is how
// .material() grew to 1380 characters of run-on prose that clipped off the top
// of the screen. If a sentence would fit on a key, it belongs on the key.
// One paragraph, plus a second for the caveat you'd otherwise get bitten by.
// Line breaks and `- ` bullets are yours to place; see the rendering section.

export const GLOBALS = {
  sphere: ['sphere({ radius, res })', 'Sphere geometry op.'],
  box: ['box({ width, height, depth, res })', 'Box geometry op.'],
  plane: ['plane({ width, height, res })', 'Plane geometry op (double-sided).'],
  torus: ['torus({ radius, tube, res })', 'Torus geometry op.'],
  torusKnot: ['torusKnot({ radius, tube, res, p, q })', 'Torus knot geometry op.'],
  cylinder: ['cylinder({ radiusTop, radiusBottom, height, res })', 'Cylinder geometry op.'],
  capsule: ['capsule({ radius, height, res })', 'Capsule geometry op — a cylinder with hemispherical caps, standing along Y. height is the straight middle only.'],
  icosa: ['icosa({ radius, res })', 'Icosahedron geometry op — evenly sized triangles at any res.'],
  model: ["model(name?, { center, fit })", "Geometry op from an imported .obj/.fbx. Empty model() opens the Poly Haven browser; drag a file in to import; name matches by substring.\nEvery mesh in the file merges into one geometry and its own materials are dropped."],

  ambient: ['ambient({ intensity, color })', "Ambient light — an even fill from every direction, so it casts no shadows. The one light that adds itself: .out() is optional. Positional ambient(intensity, color) also works."],
  directional: ['directional({ color, intensity, shadow })', 'Directional light — parallel rays, like the sun, shining from .position() toward .target(). position, target, color and intensity take fns of t.'],
  point: ['point({ color, intensity, distance, decay, shadow })', "Point light — a bare bulb at .position(), throwing light every way at once. position, color and intensity take fns of t."],
  spot: ['spot({ color, intensity, angle, penumbra, distance, decay, shadow })', 'Spot light — a cone from .position() toward .target() (the origin without one).'],
  hemi: ['hemi({ sky, ground, intensity })', 'Hemisphere light — sky color from above, bounce from below; casts no shadows.'],

  hdri: ['hdri(name?, { background, intensity, blur, rotation, backgroundRotation, backgroundIntensity })', "Image-based lighting from an imported .hdr/.exr: lights every material and shows behind the scene — metal has nothing to reflect without one. Empty hdri() opens the Poly Haven browser; drag a file in to import. Every option but background takes a fn of t."],

  camera: ['camera(x, y, z, [tx, ty, tz]) | camera({ pad, fly, speed, look, lift, recenter, deadzone, x, y, z, target })', "Puts the camera at x, y, z looking at the point [tx, ty, tz] — the origin without one. Static numbers: orbit stays live. Any fn of t: sketch drives the camera, orbit disabled.\nThe config form hands the camera to a game controller: { pad: true } drives the orbit rig, { fly: true } flies free."],
  hsl: ['hsl(h, s, l, a?)', 'A color from hue (in turns, 0..1 around the wheel), saturation and lightness — usable in any color slot. Each takes a fn of t or a signal, so hsl(rand(), 0.7, 0.5) is a random hue at a brightness you set, and hsl(rand().beat(1), 0.7, 0.5) re-rolls it every bar.'],
  hsv: ['hsv(h, s, v, a?)', 'The same wheel measured the way a paint program does: v is the brightest channel, so hsv(h) is the vivid hue, hsv(h, 0, 1) is white and hsv(h, 1, 0.5) is a dark version of the hue. Every argument takes a fn of t or a signal.'],
  bg: ['bg(color)', 'Background color, behind the 3D scene and behind the texture stack both — anything a chain leaves transparent lands on it. Hex, CSS name, or [r, g, b] 0..1; a fn of t (or a channel that is one) repaints it every frame. bg(null) leaves the texture stack on black.'],
  resolution: ['resolution(width, height) | resolution({ width, height })', "Pin the render to an exact pixel size instead of the browser window — the main window letterboxes it, and the projector window (F1) takes the same aspect ratio. A single number is a square; drop the call to fill the window again. The sidebar's fixed resolution overrides this."],
  tempo: ['tempo(bpm)', "Tempo for beat() and B, overriding the audio manager's for this sketch. Drop the call to hand it back."],
  speed: ['speed(rate)', "How fast the sketch's clock runs, 1 being real time. Everything follows it: signals read a slower t and the simulations integrate by a smaller dt, so speed(0.25) is a genuinely quarter-speed fluid rather than the same fluid sampled oddly. speed(0) freezes the sims too, which pause doesn't. Takes a fn of t; drop the call to go back to real time."],
  fog: ['fog({ color, near, far })', 'Scene fog: geometry fades to color between near and far. Positional fog(color, near, far) also works.'],

  scene: ['scene({ bg? })', "Texture source: the lit 3D render of the geometry sent to a naked .out() above this call, on the sketch's backdrop (tone-mapped display space). A chain that reads it and goes .out() is drawn in place of that geometry."],
  stack: ['stack({ bg? })', "Texture source: every layer sent to a naked .out() above this call, geometry and texture chains with their .blend() modes, composited on the sketch's backdrop as the display would. A chain that reads it and goes .out() is drawn in place of those layers. bg swaps the backdrop for this read: a color, a chain, or null for none."],
  sky: ['sky()', "Texture source: the sketch's backdrop alone, as the camera sees it. The hdri() sky, or the bg() color without one."],
  depth: ['depth({ near, far }) | depth({ focus, range })', "Texture source: the same 3D render as scene(), as a grayscale distance map — black near, white far. With { focus, range } it measures distance from a focal plane instead — a depth-of-field mask."],
  input: ['input(name?, { reset })', "Texture source: with no name, last frame's display output. With a name, whatever .out(name) published — a texture bus, or a geometry layer rendered on nothing (real alpha, so it comps 'over' as a sprite). reset blanks the held frame on the rising edge of its value — a fn of t cuts a feedback loop from code, true cuts it once per run.\n- Inside a labeled block, input() is the block's own last frame, and a name is looked for in the block first, then in the sketch around it.\n- input('kirb/glow') reads the bus glow out of the block kirb."],
  sketch: ["sketch('name', params?)", "Texture source: everything the block called name sends out, as one texture. A block is name: { ... } with a whole sketch inside: its bg(), fog(), hdri() and camera() are its own, and so are its const names and its buses.\n- With a bg() or an hdri() sky inside, the texture is opaque on it. Without one it is transparent, so it comps over other layers.\n- A block with no camera() is seen through the sketch's camera, so it still orbits.\n- input('name/bus') reads one of the block's .out('bus') buses.\n- A block nothing reads is never run, and one that is not being shown holds still.\n- With no block of that name it is a saved sketch, run the same way: sketch('kirbster v2'). The second argument sets that sketch's param() values.\n- select([sketch('a'), sketch('b')], B) switches between blocks, and sketch('a').comp(sketch('b'), 'over', fade) cross-fades them."],
  param: ["param(name, default)", "A value the sketch using this one can set. Run on its own, a sketch gets the default back. Used as sketch('orb', { speed: 2 }), param('speed', 0.4) returns 2.\n- The value can be anything an argument can: a number, a color, a fn of t, a signal.\n- Only a saved sketch needs it. A block written out in the same sketch reads the names around it."],
  constant: ['constant(color)', "Texture generator: one flat color, whole frame. Any color form, or a fn of t; null, [r, g, b, a] and '#rrggbbaa' carry transparency, like every texture color slot."],
  ramp: ["ramp({ type: 'linear'|'radial'|'angular', a, b, angle, phase, period, freq, shape: 'saw'|'tri'|'sin'|'sqr' })", "Texture generator: a two-color sweep — straight across, out from the center, or around it. period/freq repeat it into bands, shape waveshapes each cycle, phase scrolls."],
  circle: ['circle({ radius, thickness, soft, center, color, bg })', 'Texture generator: a hard-edged disc (soft feathers it), or a ring once thickness cuts the middle out. radius, thickness, soft and center take fns of t, or textures.'],
  ring: ['ring({ inner, outer, soft, center, color, bg })', "Texture generator: an annulus addressed by its two edges — circle() for when the hole is the point. inner and outer take fns of t; everything else is circle()'s."],
  rect: ['rect({ w, h, corner, rotate, thickness, soft, center, color, bg })', 'Texture generator: a rectangle — w/h as fractions of the frame, corner rounds it, thickness keeps only the outline. Most keys take fns of t, or textures.'],
  polygon: ['polygon({ sides, radius, star, rotate, thickness, soft, center, color, bg })', 'Texture generator: a regular n-gon, one vertex up. star pulls the edge midpoints inward, turning it into an n-pointed star; thickness keeps only the outline. Most keys take fns of t, or textures.'],
  checker: ['checker({ period, freq, rotate, a, b })', 'Texture generator: a two-color checkerboard of square cells — a mask, a floor, a displace source. period/freq size the cells like every periodic generator.'],
  video: ['video(name?)', "Texture generator: live camera — permission prompt on first use, black until the stream is live. No name = the default camera (the console lists sources); video('front') / video('back') ask for a facing; any other name matches a camera label by substring."],
  person: ["person(name?, { part: 'hair'|'face'|'body'|'skin'|'clothes'|'other', smooth })", "Texture generator: a person mask from the live camera — white where a person is, black elsewhere. name picks a camera exactly like video()'s: no name = the default camera, 'front'/'back' = a facing, anything else matches a camera label by substring. part masks one region instead. First use fetches the model (~12 MB, +16 MB with a part) and prompts for camera permission; black until ready."],
  videofile: ["videofile(name?, { speed, loop, mute, restart, phase, jump })", "Texture generator: an imported video file, looping. Empty call = picker; drag a file in to import; name matches by substring, or is an https:// URL. ctrl+r or restartMedia() rewinds; phase scrubs it by hand, jump throws it around while it plays."],
  imagefile: ["imagefile(name?)", 'Texture generator: an imported image file (drag one in, or empty call = picker), or an https:// URL, which downloads once. An array delegates to imageseq().'],
  imageseq: ["imageseq(['a.png', ...], index?)", 'Texture generator: several imported images with a signal picking the current one (floored, wrapped). Default index: one per second. Empty call = multi-file picker.'],
  videoseq: ["videoseq(['a.mp4', ...], index?)", 'Texture generator: several imported videos with a signal picking the current one (floored, wrapped) — a clip bank. All of them keep playing, so a switch lands mid-action like cutting between feeds. Default index: one per second. Empty call = multi-file picker.'],
  noise: ['noise({ period, freq, octaves, lacunarity, gain, speed, seed, channels, a, b })', 'Texture generator: animated fbm simplex noise, shading from a to b. Output is normalized — the octave keys change its texture, not its level.'],
  fluid: ["fluid({ res, speed, fade, damping, vorticity, iterations, wrap })", "Texture generator: an incompressible fluid sim. .push(map) drives the field, .ink(chain) pours dye into it, .obstacle(mask) puts solids in its way; the chain itself is the dye, and .velocity()/.curl() read the fields behind it. Contents survive a re-run."],
  glsl: ["glsl(source, uniforms)", "Texture generator: a fragment shader you write. vUv is the pixel (0..1), uTime the clock, uFrame the frame count since the last restart, uDelta the frame's own length, uTexel one pixel across and down, uAspect the frame's width over its height; tex0 is black, nothing having come before it. uniforms is an object of names you choose, each holding a number, a 2/3/4 array, a color, a fn of t, or a texture chain, which arrives as a sampler2D of that name.\nA bare expression is a whole body, or write void main() yourself, or paste a Shadertoy mainImage(), whose globals are all mapped. A shader that doesn't compile warns with the line number and draws nothing."],
  voronoi: ["voronoi({ period, freq, speed, blend, seed, mode: 'cells'|'distance'|'edges', a, b })", "Texture generator: drifting scattered points, every pixel colored by the nearest one. mode picks flat cells, distance shading, or the seams; all three shade from a to b."],
  text: ["text('hi', { size, color, bg, pos, font, weight, align: 'center'|'left'|'right', tracking, leading, wrap, fit, ranges, mark: { mode: 'box'|'fill'|'underline'|'circle'|'dim'|'none', color, on, weight, pad, dim }, url, pick, poll })", "Texture generator: canvas-rendered text — on a solid background, or on nothing with bg: null, ready to comp over anything. Content can be a fn of t; \\n for multiline.\nranges marks parts of the string, fit sizes the type to fill a box, and url reads both from a live feed. .marked() is how much of it is marked, as a signal."],
  feed: ["feed('http://127.0.0.1:4000/api/events', { pick, poll })", "Live text from a url, as a callable frame: f(t) is whatever arrived last — { text, ranges } if the producer sends them, plus anything else it sends. An event stream pushes, anything else is fetched once (poll to keep asking).\n.text and .ranges are the fns of t text() wants, .marked a signal of how much is marked, and .slice()/.invert() hand back the same shape with the offsets moved to match. One connection per url, held across re-runs; a feed that goes down holds its last frame."],
  text3d: ["text3d('hi', { size, depth, bevel, res, font, weight, align: 'left'|'center'|'right', tracking, leading, center })", "Geometry op: 3D extruded text. Renders in helvetiker until the font you named arrives."],

  layout: ['layout(depth?, e => …)', "Generative structure: the rule steers a cursor, placing copies as it goes. .place() records one, .branch() grows a child that runs the rule again one generation deeper, and depth caps the generations; a rule can also stop itself by returning without branching.\n.instance() draws the result, and the placed copies are a bundle like any other — .link() webs them, curve() follows an unbranched trail. Any cursor step takes a fn of t, so the structure can move."],
  track: ['track(chain, { max, threshold, levels, size, dark, res, hold, smooth, gate, scale })', "Follows the bright regions of a chain — a hand against a dark room, a person() mask, whatever the threshold leaves standing — and keeps track of which is which from frame to frame. Produces a bundle, draws nothing: .pos(i), .size(i), .id(i) per slot, .at(i) for a whole blob, and .instance(blobs, fn) is what puts a shape on each one.\nEvery blob holds its slot for as long as it lives, so i is steady enough for per-copy state; .id(i) is the number that is never handed out twice, for a look that mustn't outlive its blob. Read back on the CPU a frame or so behind, like .field()."],
  curve: ["curve(u => [x, y, z], { closed, even }) | curve(bundle)", "Builds a path as a callable value: c(u) is the point a fraction u of the way along. curve(fn) lifts your own function; curve(bundle) runs a polyline through a bundle's records in index order — an unbranched layout's trail, or points of your own in sequence — parameterized by distance along it, so records that bunch up don't bunch the phase."],
  spread: ['spread(n, { jitter, random, seed, end })', "n phases 0..1, evenly spaced — the values a curve takes: spread(12).map(c) is twelve points along it. The values hold still across frames and re-runs."],

  particles: ['particles({ max, rate, life, speed, spread, dir, pos })', "A GPU particle system emitting from a point — .particles() on a shape emits from its surface, on a texture from its bright pixels. Chain forces (.force .turbulence .attract .drag), looks (.size .color .opacity .fade .blend .evolve), then .out().\nThe pool sizes itself from rate × life, and the swarm survives re-runs — tweak a force and the particles keep flying."],
  data: ['data(array) | data({ pos, alpha })', "Your own points as a bundle of points: a live array of [x, y, z], or named channels, each an array or a fn of t. Renders nothing, and takes everything a bundle takes — .count, .at(i), .pairs() and .link() to connect it, .instance() and .each() to draw on it, curve() to read it as a path."],
  segments: ['segments(pairs | points, { within, max, fill, lit, fade, color, opacity, blend })', "Line segments between paired points, redrawn every frame. Takes a .pairs(), a bundle, or a plain array of [x, y, z]. Flat 1px lines unless lit; .material({ color, opacity }), then .out()."],
  link: ['link(points, { within, max, fill, lit, fade, color, opacity, blend })', "segments() over any array or bundle: a line between every pair of points closer than within. Ends in .out()."],

  beat: ['beat(perBar = 4, width = 0.5)', 'Tempo-synced gate: 1 for width of each cycle, 0 the rest. perBar cycles per bar of four beats (tempo in the audio manager), so the number is the note value — beat(4) is quarter notes, beat(16) sixteenths, beat(1) the downbeat.'],
  audio: ['audio(chan? | name?, chan?)', "Audio input loudness (0..1, dB scale) as a signal, usable in any parameter; the first use starts capture. audio() is the mono mix, audio(2) a channel by index, audio('scarlett') a device by name (substring), audio('scarlett', 2) a channel of it."],
  audiofile: ["audiofile(name?, { volume, speed, loop, restart, chan })", 'An imported audio file, played out loud and returning its level as a signal like audio(). Empty call = picker; drag a file in to import; ctrl+r or restartMedia() rewinds.'],
  band: ["band(name? | n?)", 'A named band as a signal, normalized 0..1 by its meter anchors. band() is the global level; bands are named 1, 2, 3 by default, so band(1) reads the first. The names come from the sketch\'s own bands({ ... }) when it has one, and from the audio manager (ctrl+a) when it doesn\'t.'],
  bands: ['bands({ name: { from, to, lo, hi, sm, auto }, level: { lo, hi, sm, auto } })', "The audio bands this sketch reads, written by the audio manager's pin to sketch. In any sketch that contains it, the manager (ctrl+a) is linked to the code: it edits these bands instead of your usual ones, and writes every change back here."],
  restartMedia: ['restartMedia(name?)', "Rewind imported media files to 0 — all of them, or by name (substring). In a sketch it runs on every execute. ctrl+r rewinds media too, and starts a sketch's particles, delays, trails and counters over with it."],
  rand: ['rand({ freq: 1, seed: 0 })', 'Smooth random signal: deterministic value noise of t, 0..1. Positional rand(freq, seed) also works.'],
  select: ['select([a, b, c], index?)', "Pick from a list by index (floored, wrapped) — .select() as a call of its own, and the only form that takes texture chains: values give a signal, chains give a texture showing one of them (switched like .when(), so only the chosen one renders).\nThe index is any signal, so it carries the timing: B steps per bar, rand().mul(3).beat() lands somewhere new each beat. Default: one item per second."],
  sig: ['sig(fn?)', "Lift any fn of t into a chainable signal: sig(t => Math.sin(t)). Bare sig() is t itself."],
  T: ['T', "Bare sig() under a shorter name: t in seconds, with the signal methods on it. A value, not a call — no parentheses."],
  B: ['B', 'T on the tempo grid: bars elapsed, counting up, at the audio manager\'s tempo. A value, not a call — no parentheses.\nRate is set the way T\'s is, so B.mul(2).sin() is a half-bar LFO the way T.mul(2).sin() is a half-second one. The whole part is which bar, so B.select([...]) steps a list on the downbeat and B.mul(4) counts quarter notes.'],
  mouse: ["mouse('x'|'y'|'down')", "Pointer position as a signal, -1..1 with 0 at the center and y up. Default axis is x; mouse('down') is a 1/0 gate while a button is held."],
  midi: ['midi(name?)', "A MIDI controller as signals: .cc(74) a knob or fader 0..1, .note .vel .gate .touch the keys, .key(38) narrowing those to one pad, .bend -1..1. No name reads every connected device at once; a name matches an input by substring.\nAn empty .cc() or .key() learns: move the control and its numbers are written into the call. Safari has no Web MIDI, so the signals read 0 there."],
  gamepad: ['gamepad(index?, { deadzone })', "A game controller as signals: .lx .ly .rx .ry sticks (-1..1, y up), .lt .rt analog triggers, .btn('a') a 1/0 gate. Standard mapping, so the face buttons answer to either brand's names — 'a' or 'cross'.\nAn empty .btn() learns the next button pressed. Browsers hide a pad until it sends something, so press a button if nothing is reading."],

  onFrame: ['onFrame((t, dt) => ...)', 'Register a raw per-frame callback.'],
  THREE: ['THREE', 'The full three.js namespace, for anything the API does not cover.'],
  Texture: ['Texture', "The type every texture chain is one of. Adding to its prototype adds an op to every chain: Texture.prototype.punch = function (n) { return this.pow(n).contrast(2) } — a function, not an arrow, so `this` is the chain. Also what x instanceof Texture asks."],
  Geometry: ['Geometry', 'The type every geometry chain is one of — the sphere()/box() counterpart of Texture. See Texture.'],
  Signal: ['Signal', 'The type every signal is one of — the T/audio()/rand() counterpart of Texture. See Texture.'],
  bufferId: ['bufferId()', "A bus name nothing else will take, one per call site: with b = bufferId(), input(b) / .out(b) is a feedback loop that can't collide. The same call site gets the same id every re-run, so the loop keeps its contents. Mostly you want .feedback(), which is this plus the wiring."],
};

export const METHODS = {
  position: ['.position(x, y, z) | .position(v)', {
    cursor: 'Where the cursor stands, as [x, y, z] — read only, since .forward() is what moves it.',
    '*': 'Position. Each component is a number or fn of t; one vector argument ([x,y,z] or anything with x/y/z) also works.\nShort form: .pos().',
  }],
  rotation: ['.rotation(x, y, z) | .rotation(v)', 'Geometry: rotation in radians. Each component is a number or fn of t, or one vector in the first slot.\nShort form: .rot().'],
  scale: ['.scale(x, y?, z?) | .scale(x, y?, { wrap })', {
    texture: 'Zoom around center: one number = uniform, .scale(x, y) per-axis, negative flips that axis — .scale(-1, 1) mirrors left to right.',
    cursor: 'Shrink by one number, compounding down the branch.',
    '*': 'Scale: one number = uniform, one vector = per-axis.',
  }],
  rotate: ['.rotate(v, { wrap })', 'Texture: rotate the image around center, in radians. v takes a fn of t, or a texture to turn each pixel by its own angle.\nShort form: .rot().'],
  translate: ['.translate(x, y, { wrap }) | .translate(map, { wrap })', "Texture: shift the image in UV space (1 = full frame); a map in the first slot shifts each pixel by its own R and G. Short form: .trans()."],
  noise: ['.noise({ amp, period, freq, octaves, lacunarity, gain, speed, seed })', {
    geo: 'GPU fbm displacement along vertex normals, with the normals recomputed so lighting stays correct. It can only move vertices the shape already has — raise its res if nothing happens.',
    particle: 'Offset each dot by a noise field where it is drawn. Not a force — a held swarm ripples in place, a flying one keeps its path.',
  }],
  points: ['.points({ size })  ·  texture: .points({ res, depth, size, dot })', {
    geo: 'Draw the vertices as dots instead of the surface, size in pixels. .noise() and .displace() still move them, and a color map colors each dot by the pixel at its uv. Lit like the surface; casts no shadow.',
    texture: 'The image as a grid of dots — a plane mapped with it and lifted by its brightness. Hands back the geometry chain.',
  }],
  lines: ['.lines({ dir })  ·  texture: .lines({ dir, res, depth, size })', {
    geo: 'Draw the vertex grid as 1px lines, rows or columns or both. .noise() and .displace() still move them and a color map colors them. A model or text has no grid and draws its triangle edges. Lit like the surface; casts no shadow.',
    texture: 'The image as scanlines — a plane mapped with it and lifted by its brightness. Hands back the geometry chain.',
  }],
  wire: ['.wire()  ·  texture: .wire({ res, depth, size })', "Draw every triangle edge as a 1px line, on any shape. .lines() is the version that follows the vertex grid. On a texture, the image as a mesh of edges."],
  instance: ['.instance(count | bundle, (x, i, n, t) => x.position(...), { blend })', {
    geo: 'Render as one InstancedMesh.',
    texture: 'Stamp the picture so far once per copy, in one draw.',
    note: "The fn places each copy as x, through .position/.rotation/.scale/.color, plus .alpha on a texture copy. i = copy index, n = count.\nA bundle stands in for the count and places each copy on its record: a layout() its pose and scale, a track() a slot per blob with the empty ones hidden, a data() or .scatter() or particles().read() the point alone. A fn alongside it runs after that, for what goes on top.",
  }],
  place: ['.place(label?, data?)', "Layout cursor: record a copy centered where the cursor stands, at its heading and scale, for a tip or a scatter rather than a segment (.span() is the one that runs between joints). The label names what goes there, picked out later by .filter(); data rides along per copy, for .data(i) to read."],
  branch: ['.branch(x => x.turn(0.5), rule?)', "Layout cursor: grow a child. The step shapes it, then the rule runs again from there, one generation deeper. The parent's cursor stays put. A second argument hands the child a different rule."],
  span: ['.span(dist = 1, label?, data?)', 'Layout cursor: move forward, leaving a copy that spans the step. Centered on the step rather than on the joint, so segments meet end to end where a branch forks; a shape one unit long covers the step exactly.'],
  forward: ['.forward(dist = 1)', 'Layout cursor: step along the heading (+Y) without placing anything. The step scales with the cursor, so a shrunken branch takes shorter steps.'],
  turn: ['.turn(angle, pitch?, roll?)', 'Layout cursor: rotate the heading, in radians. angle turns it flat, pitch tilts it out of that plane, roll spins it about the heading itself. A fn of t here sways everything grown past it.'],
  distance: ['.distance', 'Layout cursor: how far it has walked from the root.'],
  filter: [".filter('leaf') | .filter((p, i) => …)", "Layout: some of the copies, as a layout of its own, so each slice can take a shape of its own. A label keeps the copies placed under it; a function keeps the copies it says yes to, handed { label, data, depth } and the copy's index."],
  grow: ['.grow(amount)', 'Layout: open the structure out from the root. amount is 0..1 in place order and takes any signal; copies past that front are scaled away.'],
  apply: ['.apply(x, i)', {
    layout: 'Place copy i on an instance handle and hand the handle back. .instance(l) is this call already made; the long form is for putting more on top of it.',
    blobs: "Put a copy on blob i — its position and its size — and hand the handle back. .instance(blobs) is this call already made. An empty slot hides its copy, and hiding wins over anything the sketch's own fn sets afterward.",
    bundle: "Put a copy on point i and hand the handle back. .instance(bundle) is this call already made; the long form is for a count of your own, which is what a bundle that grows after the sketch runs needs: .instance(64, (x, i) => bundle.apply(x, i)). A point that isn't there (alpha 0) hides its copy.",
  }],
  age: ['.age(i)  ·  particle data: .age', {
    blobs: 'How long blob i has been tracked, in seconds — what a copy fades itself in over so a new blob arrives rather than pops.',
    bundle: 'Seconds into the current life, per slot — negative while the slot waits to be born.',
  }],
  along: ['.along(i)', 'Layout: how far along the structure copy i sits, 0..1 in place order, which runs outward a generation at a time. What .grow() measures against.'],
  data: ['.data(i)', 'Layout: whatever .place() was handed alongside its label, for copy i.'],
  count: ['.count', {
    layout: 'How many copies the rule placed.',
    blobs: 'How many blobs are being tracked right now — the slots with something in them, which is not .max.',
    bundle: 'How many points the bundle holds.',
    pairs: 'How many pairs there are this frame.',
  }],
  slots: ['.slots', "Bundle: how many indices it has, which is how many copies .instance() draws. The same as .count for a bundle that holds only what it has (a layout, a data()); on a tracker it is .max, since a blob keeps the slot it arrived in and an empty one still has an index."],
  at: ['.at(i)', "Bundle: record i as one object — index first, then the key, so .at(i).pos is where it is and the rest is whatever the producer carries: a layout's .size .along .depth .data, a tracker's .id .age .box(), a particle's .vel .life.\nThe properties are live getters reading the record at access time, so one handed to a fn of t follows its point (color: hsl(() => b.id * 0.618, 0.8, 0.6)); destructuring it outside one snapshots the moment instead. One object per index, reused, so reading allocates nothing."],
  read: ['.read()', "Particles: the swarm as a bundle — .pos, .alpha (the fade envelope; 0 in an empty slot), .vel, .age, .life. Read back one frame behind; filled once the system's .out() runs."],

  align: ['.align(v)', "Aim the shape's +Y axis along a direction vector. .rotation() still applies, in the shape's own frame before the aim; components take fns of t."],
  sample: ['.sample(i)', "The i-th point of a fixed scatter over this shape's surface, as {x, y, z}. Points are stable across re-runs; the shape's whole chain applies, and it needn't be in the scene."],
  tangent: ['.tangent(u)', "Curve: the direction of travel a fraction u of the way along, unit length — what .align() wants for a copy pointing along the curve."],
  circle: ['curve.circle(r, { center, axis })', "A closed circle of radius r — flat on the ground plane by default, starting on +X and heading toward +Z. r takes a fn of t."],
  line: ['curve.line(a, b)', "A straight path from a to b, each an [x, y, z]; components take fns of t. Open, so u turns back at the ends."],
  helix: ['curve.helix({ radius, height, turns })', "A helix rising along Y through the origin — u = 0 at the bottom, 1 at the top. Every option takes a fn of t."],
  normal: ['.normal(i)  ·  scatter data: .normal', 'The surface normal at .sample(i), as {x, y, z} — which way the shape faces there. A .scatter() bundle carries them all as .normal.'],
  scatter: ['.scatter(n)', "Geometry: the first n surface scatter points as a bundle — the same points .sample(i) reads, with .noise() and the transform applied. Renders nothing."],
  pairs: ['.pairs({ within, max })  ·  .pairs(other, { within, max })', "Bundle: every pair of points closer than within, at most max per point. Handed another bundle (or plain array) it pairs across the two instead. .list holds the [a, b] index pairs, .tris the trios that are all in reach of one another.\nAny bundle pairs: a tracker's blobs, a layout's placed copies, a swarm read back. Records that aren't there — an empty slot, a particle between lives — are left out."],
  link: ['.link({ within, max, fill, lit, fade, color, opacity, blend })  ·  .link(other, { … })  ·  particles: { sample }  ·  geometry: { count }', "Draw a line between every pair of points closer than within. On a geometry it connects its scatter; on particles, the swarm, drawn by the system's own .out(); on a bundle it ends in its own .out(), and .link(other) pairs across to the other's points.\nAny bundle links: a tracker's blobs, a layout's placed copies, points of your own. Records that aren't there are left out."],
  hide: ['.hide(v = true)', "Instance copy: leave this copy out of the frame. Checked after the fn has run, so nothing later can bring back a copy that asked to go — which is how .instance(track(…)) drops the slots with no blob in them. What a count sized for the most copies a sketch might need does with the rest."],
  between: ['.between(a, b)', "Instance copy: span this copy between two points — midpoint, aimed along the gap, y scaled to the distance. Build the shape unit-height (cylinder({ height: 1 })) so it spans exactly; .scale() before it sets the thickness."],
  pos: ['.pos  ·  tracker: .pos(i)', {
    'bundle layout': 'The points, a live array of [x, y, z], rebuilt each frame — a layout\'s are the copies it placed.\nElsewhere .pos() is short for .position().',
    blobs: "Where blob i is, as [x, y, 0] in frame units — y runs -0.5..0.5 and x carries the aspect, which is the space a texture copy is drawn in. { scale } on the call sizes it up for a 3D scene. [0, 0, 0] for an empty slot.",
  }],
  vel: ['.vel  ·  tracker: .vel(i)', {
    bundle: 'Velocity per slot, as [x, y, z] in world units per second.',
    blobs: 'How fast blob i is moving, in .pos() units per second, as [x, y, 0]. Measured off the smoothed track, so it answers which way a hand is going rather than how noisy the edge is.',
    'midi midikey': 'How hard the last key was struck, 0..1. Latched, so it holds between notes; after .key(38) it follows that pad alone.',
  }],
  id: ['.id(i)', "Tracker: which blob, ever, is in slot i — a count starting at 0 that is never handed out twice. A slot outlives its occupant, so a look keyed off i would be inherited by the next blob through it; keyed off .id(i) it can't be. -1 when the slot is empty.\nhsl(blobs.id(i) * 0.618, 0.7, 0.5) spreads successive blobs around the wheel and holds each one's hue for life."],
  has: ['.has(i)', 'Tracker: whether slot i has a blob in it right now. .instance() hides an empty slot for you — this is for sketch code that wants to know.'],
  max: ['.max', "Tracker: how many slots there are, which is how many copies .instance() draws. Fixed, because an instance count is: set it on the call to the most blobs the sketch should follow at once ({ max: 4 }), and the ones with nothing in them are hidden."],
  box: ['.box(i, { pad })', "Tracker: the blob's box as the config rect() takes — center in UV, w/h as frame fractions, every value a live fn, the whole thing collapsed to nothing while the slot is empty. rect(blobs.box(i)) draws it; { ...blobs.box(i), thickness: 0.004, bg: null } is its outline. Frame units whatever { scale } says, since this is for texture space. pad grows it on every side."],
  boxes: ['.boxes({ pad })', "Tracker: every box in one picture — each pixel's luma is how many boxes cover it, written raw past 1.0 where they pile up. So .threshold(0.5) is the union (mask through it to treat inside every box at once, and once where boxes overlap), .threshold(1.5) keeps only the overlaps, and the raw count can drive any per-pixel knob. One pass whatever max is."],
  largest: ['.largest()', 'Tracker: the slot holding the biggest blob — the subject, when the sketch only wants one. -1 when nothing is being tracked, and every read off -1 comes back resting, so the arithmetic still works on an empty frame.'],
  area: ['.area(i)', 'Tracker: the fraction of the frame blob i covers, 0..1 — the reading that ignores the frame shape. Good for how close someone is, or as a gate on a gesture.'],
  width: ['.width(i)', "Tracker: the width of blob i's bounding box, in .pos() units. Steadier readings come off .size(i); a box is only as tight as its furthest stray pixel."],
  height: ['.height(i)', "Tracker: the height of blob i's bounding box, in .pos() units."],
  angle: ['.angle(i)', "Tracker: the axis blob i lies along, in radians, 0 across the frame. An axis repeats every half turn, so this stays within ±π/2 and stays continuous through the wrap. Worth leaning on for an arm or a stick; a round blob's angle is whatever noise it had."],
  life: ['.life', "Particle data: each slot's lifespan in seconds."],
  list: ['.list', "Pairs: this frame's pairs, as an array of [a, b] point indices — b indexes the second set when the pairing crossed two."],
  tris: ['.tris', 'Pairs: trios of points that are all within reach of one another, as [a, b, c] index triples. Only within one set.'],
  material: [".material('preset', { … }) | .material({ color, roughness, metalness, emissive, opacity, transmission, clearcoat, iridescence, pbr, map, normalMap, repeat, flatShading, wireframe, doubleSide })", "How the surface takes light: standard PBR, upgraded to three's physical material the moment you name a glass or coating key. .material('glass') starts from a named preset, keys beside it overriding. Empty .material() opens the Poly Haven browser."],
  color: ['.color(c) | .color(birth, death)', {
    'particle evolve': 'The dot color — one value, or a second that fades each particle from birth to death.',
    '*': "Shorthand for .material({ color }). Four forms, everywhere a color is taken: '#4fd1c5', a CSS name, 0x4fd1c5, or [r, g, b] 0..1 — the whole color, or each channel of the array, may be a fn of t or a signal.",
  }],
  target: ['.target(x, y, z) | .target(v)', 'Light: where a directional() or spot() points (the origin without one). Components take fns of t, so the beam can sweep, and one vector argument works like .position(v). Point and hemisphere lights have no direction and reject it.'],
  shadow: ['.shadow(false | { cast, receive })  ·  light option: shadow: true | { map, soft, strength, bias, normalBias, near, far, area }', {
    particle: "Makes the swarm cast — off by default, since it's a depth pass per shadow light. Receiving is .lit()'s side.",
    geo: "Geometry casts and receives by default — .shadow(false) is the opt-out, or one side via { cast, receive }. On a light, shadow: true turns casting on and the same object tunes it. Glass (transmission) and blended (opacity < 1) surfaces don't cast unless .shadow(true) insists.",
  }],
  depth: ['.depth · .depth(i)', 'Layout cursor: which generation the rule is running in. On the layout itself, which generation copy i was placed in.'],
  rand: ['.rand(seed = 0)', "Layout cursor: a random 0..1 that holds still. The same node draws the same value on every re-run, so a random structure doesn't reshuffle while you edit. Different seeds are independent draws."],

  cc: ['.cc(num, channel?)', "midi: a knob, fader or button by its CC number, 0..1. Without a channel the number answers to whichever channel sent it last, which is what a controller on its factory setting sends.\nEmpty .cc() learns instead — move a control and the numbers are written into the call."],
  key: ['.key(num?)', 'midi: narrows .note .vel .gate .touch to one key or pad, so a drum pad drives one thing on its own. Empty .key() learns the next key played.'],
  note: ['.note', 'midi: the pitch last played, 0..1 across the MIDI range — .mul(127) for the note number back. Latched: it holds after the key is released.'],
  gate: ['.gate', 'midi: 1 while a key is held, 0 when none is. After .key(38), that pad alone. Feed it .smooth() for a ramp or .counter() to step per press.'],
  touch: ['.touch', 'midi: aftertouch — pressure on a key that is already down, 0..1. Channel pressure or polyphonic, whichever the gear sends; not every controller has it.'],
  bend: ['.bend', 'midi: the pitch wheel, -1..1 with 0 centered. Springs back to 0 on release, like the wheel does.'],
  lx: ['.lx', 'gamepad: left stick, left to right, -1..1. .ly is the same stick up and down, .rx / .ry the right one.'],
  ly: ['.ly', 'gamepad: left stick, down to up, -1..1 with up positive.'],
  rx: ['.rx', 'gamepad: right stick, left to right, -1..1.'],
  ry: ['.ry', 'gamepad: right stick, down to up, -1..1 with up positive.'],
  lt: ['.lt', 'gamepad: left trigger, 0..1 through its travel. .rt is the right one. A pad with digital triggers reports 0 or 1.'],
  rt: ['.rt', 'gamepad: right trigger, 0..1 through its travel.'],
  btn: [".btn('a')", "gamepad: a button as a 1/0 gate. Face buttons by either brand's name ('a'/'cross', 'b'/'circle', 'x'/'square', 'y'/'triangle'), the d-pad as 'up' 'down' 'left' 'right', shoulders 'lb' 'rb', also 'start' 'back' 'l3' 'r3'.\nEmpty .btn() learns the next button pressed."],
  out: [".out(name?)", "Naked: a layer on the display, painted in code order over the ones before it, geometry and texture chains alike. Lights reach every layer. With a name, publishes for input('name') instead."],
  render: ['.render()', "Geometry, particles and segments: the object alone on a transparent layer, as a texture chain. The same as .out('name') then input('name'), without the name."],

  particles: ['.particles({ max, rate, life, speed, spread, dir, size, threshold })', "The source as a particle emitter. On a shape: births scattered over its surface, leaving along the normals — the shape needn't be drawn, its transform applies live, and its .noise() carries through, so births land on the deformed surface. On a texture: births on the bright pixels of the live image, mapped onto a world plane, each particle keeping the color of the pixel it was born from (.color() overrides)."],
  force: ['.force(x, y, z)', 'Particles: a constant acceleration in world units/s² — .force(0, -2, 0) is gravity, .force(1, 0, 0) a crosswind. Components take fns of t; several .force() calls sum.'],
  turbulence: ['.turbulence({ amp, period, freq, speed, seed })', 'Particles: a curl-noise force field — swirling, smoke-like drift. Divergence-free, so the swirl stirs the swarm without bunching it into clumps; several calls layer fields at different scales.'],
  attract: ['.attract([x, y, z], { strength, radius })', 'Particles: pull toward a point with inverse-square falloff — negative strength repels. Position components take fns of t, so the point can orbit, or follow mouse().'],
  drag: ['.drag(v = 1)', 'Particles: exponential velocity damping — higher settles the swarm sooner. Takes a fn of t.'],
  size: ['.size(a, b?) · .size · .size(i)', {
    'particle evolve': 'Point size in world units, shrinking with distance — one value, or birth → death. Where a number goes, a [min, max] pair scatters it per particle. Default 0.05.',
    cursor: 'The scale the cursor has accumulated — the reading a rule stops on, like if (e.size < 0.1) return.',
    layout: '.size(i) is the scale copy i was placed at, which a chain setting its own .scale() has to multiply by.',
    blobs: ".size(i) is how big blob i is — the side of a square of the same area, in .pos() units. Steadier than the bounding box, which one stray pixel can stretch, and the scale .instance() places the copy at.",
  }],
  opacity: ['.opacity(a, b?)', 'Particles: transparency 0..1 — one value, or birth → death. On top of the .fade() ramps; takes fns of t.'],
  fade: ['.fade(in, out) | .fade(false)', "Particles: fade each particle in when it's born and out before it dies, so they don't blink into existence. The numbers are how long each fade takes, as fractions of the lifespan — defaults 0.1 and 0.3. false turns both off."],
  blend: [".blend('over' | 'add' | 'solid')  ·  .blend(mode, opacity) on a texture", {
    texture: "How this chain's naked .out() lands on the layers under it, geometry and backdrop included: .comp()'s modes without naming the base. Ops after it keep the mode, a later .blend() replaces it, and .when(cond, x => x.blend('add')) switches modes live. opacity is how much of the blend mixes in, 0..1, and takes a fn of t. Also .blend({ mode, opacity }).\nModes: over under add sub mult screen overlay hardLight softLight darken lighten difference exclusion dodge burn divide luminosity color sum — sum is add without the clamp, so comped white masks count their overlaps.",
    '*': "Particles: how the dots land on the scene. 'over' is ordinary transparency; 'add' sums light — the glow-swarm look, brightest where particles pile up. 'solid' is opaque cutout dots that write depth and occlude each other, which is what a dense .lit() swarm needs to read as a lit surface. Solid dots pop in and out rather than fade, and depth() sees them.",
  }],
  soft: ['.soft(v)', 'Particles: edge softness of each dot, 0 (hard disc) to 1 (pure falloff). Default 0.5. Takes a fn of t.'],
  lit: ['.lit(amount = 1)', "Particles: take the scene's light — each dot tinted by the color, falloff and cone of the lights, and darkened inside their shadows. A dot has no facing, so what shows is color, distance and shadow. amount 0..1 mixes flat color → fully lit; takes a fn of t."],
  evolve: ['.evolve((p, life, t) => p.size(...).color(...).force(...))', "Particles: looks and forces across each particle's life. life runs 0 (birth) to 1 (death); whatever the fn sets on p (.size/.color/.opacity/.force) applies at that point, starting from the chain's own settings.\nSampled across life each frame rather than run per particle — so it sees life and t, never one particle's position."],

  mirror: [".mirror({ axis: 'x'|'y'|'both', flip })", 'Texture: reflect one half of the image onto the other; for a whole-image flip use .scale(-1, 1). A texture in flip chooses which half survives per pixel, so both reflections come back interleaved by the map.'],
  kaleido: ['.kaleido(sides, { rotate })', 'Texture: polar kaleidoscope fold. Both keys take a fn of t, or a texture for a value that varies across the frame.'],
  radial: ['.radial(s => ..., { log, min })', "Texture: run the fn in polar space — x is the angle around the center, y the distance from it — and come back. x wraps at the seam.\nUnder log, y is log-radius and wraps too, so .scroll(0.1, 0) inside is endless rotation and .scroll(0, 0.1) endless zoom."],
  through: ['.through(s => change, p => ...)', "Texture: run the second fn in the space the first fn moves the frame into, then move it back. .through(s => s.rotate(0.4), p => p.pixellate(40)) lays a tilted grid. The change has to be one that can be undone: a move, a warp, a tone or color adjust. Anything else warns and stays where it went."],
  polar: ['.polar({ inverse, log, min })', "Texture: unroll the frame into angle × radius. inverse: true goes the other way, reading the image as angle × radius and wrapping it into a disc."],
  edge: [".edge({ strength, spread, mode: 'classic'|'crisp' })", 'Texture: edge magnitude (grayscale). Lines on nothing — the gaps are transparent, so edges comp without plating what they sit on. Thick and clipped by default; crisp mode gives thin antialiased ones.'],
  slope: [".slope({ strength, spread, mode })", 'Texture: neighbor-difference gradient, centered on 0.5, in RG.'],
  normalMap: [".normalMap({ strength, spread, mode })", 'Texture: tangent-space normal map from luma height.'],
  levels: ['.levels({ contrast, saturation, gamma, hue })', 'Texture: combined tonal adjust. Every key takes a fn of t, or a texture for a value that varies across the frame.'],
  hue: ['.hue(v)', 'Texture: hue rotation in turns — 0.5 is opposite colors, 1 a full lap. Animate with a fn of t or a signal, or hand it a texture to rotate each pixel by what the map says there.'],
  add: ['.add(v)', 'Texture: add v to every pixel (scalar or [r, g, b]; negative darkens) · audio signal: plain addition/offset. A texture in place of v is read as RGB — per pixel, per channel.'],
  mul: ['.mul(v)', "Texture: multiply every pixel by v (scalar or [r, g, b]) · audio signal: plain gain. A texture in place of v is read as RGB — per pixel, per channel."],
  pow: ['.pow(v)', 'Texture: raise every pixel to the power v (scalar or [r, g, b]) · audio signal: <1 expands quiet detail, >1 emphasizes peaks. A texture in place of v sets it per pixel.'],
  sub: ['.sub(v)', 'Texture: subtract v from every pixel (scalar or [r, g, b]) · signal: subtraction, where v may be a number, a fn of t or another signal. A texture in place of v is read as RGB — per pixel, per channel.'],
  div: ['.div(v)', 'Texture: divide every pixel by v (scalar or [r, g, b]) · signal: division. A texture in place of v divides per pixel; a divisor at 0 blows out to white rather than going black.'],
  range: ['.range(min, max, { from, to })', "Signal: rescale to min..max, taking the input as 0..1; from names a different input span, e.g. [-1, 1]. It doesn't clamp."],
  clamp: ['.clamp(lo = 0, hi = 1)', 'Signal: limit to lo..hi without rescaling. Both bounds take fns of t.'],
  smooth: ['.smooth(up, down?)', 'Audio signal: exponential lag (one-pole lowpass on the value), time constants in seconds. Two args = separate attack/release.'],
  kicks: ['.kicks({ threshold: 1.5, decay: 6, floor: 0.05 })', 'Audio signal: onset detector — 1 when the value jumps past threshold × its own moving average, exponential decay after.'],
  lowpass: ['.lowpass(hz)', "Audio signal: energy below hz (0..1) from the input's spectrum — bass level."],
  highpass: ['.highpass(hz)', "Audio signal: energy above hz (0..1) from the input's spectrum — treble level."],
  bandpass: ['.bandpass(lo, hi)', "Audio signal: energy between lo and hi Hz (0..1) from the input's spectrum."],
  gte: ['.gte(v)', 'Signal: 1 while the value is >= v, else 0.'],
  lte: ['.lte(v)', 'Signal: 1 while the value is <= v, else 0.'],
  counter: ['.counter(max?, threshold = 0.5)', 'Signal: counts rising edges; wraps at max.'],
  select: ['.select([a, b, c, ...])', 'Signal: index the array by the value (floored, wrapped). Items may be numbers, colors, strings, or fns of t.'],
  sin: ['.sin(rate = 1)', 'Signal: sine shape of the value-as-phase (0..1 out, one cycle per whole unit). rate scales the phase on the way in, so T.sin(0.3) is a 0.3 Hz sine — the same thing T.mul(0.3).sin() spells the long way. Takes a fn of t.'],
  cos: ['.cos(rate = 1)', 'Signal: cosine shape of the value-as-phase (0..1 out) — .sin() a quarter cycle ahead, so it starts at 1. rate scales the phase on the way in, like .sin()\'s.'],
  tri: ['.tri(rate = 1)', 'Signal: triangle shape of the value-as-phase (0..1 out). rate scales the phase on the way in, like .sin()\'s.'],
  saw: ['.saw(rate = 1)', 'Signal: fractional part of the value — a ramp per cycle. rate scales the phase on the way in, like .sin()\'s.'],
  sqr: ['.sqr(rate = 1, { width })', 'Signal: 1 for the first width of each cycle, else 0 — square LFO / rhythmic gate. rate scales the phase on the way in, like .sin()\'s; .sqr({ width: 0.2 }) narrows the pulse without touching the rate.'],
  beat: ['.beat(perBar = 4)', 'Signal: tempo-synced sample-and-hold — freezes a new value of the signal perBar times a bar, on the same grid as beat(). Shorthand for .hold(beat(perBar)).'],
  hold: ['.hold(trigger, threshold = 0.5)', 'Signal: sample-and-hold driven by another signal — freezes the current value each time trigger crosses up through threshold. .hold(audio().kicks()) resamples on the drums; for the tempo grid, .beat(n) is the shorthand.'],
  round: ['.round()', 'Signal: round to the nearest integer.'],
  floor: ['.floor()', 'Signal: round down to an integer.'],
  ceil: ['.ceil()', 'Signal: round up to an integer.'],
  abs: ['.abs()', 'Signal: absolute value.'],
  tint: ['.tint(color, { bg })', "Texture: recolor by brightness — black becomes bg, white becomes color, everything between mixes. Both colors take fns of t; bg: null keeps the dark end transparent, which turns a mask into a colored cutout."],
  when: ['.when(cond, s => ...)', 'Texture: per-frame switch — while cond >= 0.5 the chain becomes fn(chain), otherwise it passes through. Only the active branch renders.'],
  contrast: ['.contrast(v)', 'Texture: contrast around mid-gray (1 = unchanged). A texture in place of v sets it per pixel.'],
  saturation: ['.saturation(v)', 'Texture: 0 = grayscale, 1 = unchanged, >1 boosts. A texture in place of v sets it per pixel.'],
  gamma: ['.gamma(v)', 'Texture: gamma curve (1 = unchanged, above 1 lifts the shadows; the exponent is 1/v). A texture in place of v sets it per pixel.'],
  posterize: ['.posterize(steps)', 'Texture: quantize values to n levels per channel. A texture in place of steps sets the count per pixel — scale it first (.mul(8)), since a raw map only ever says 0..1.'],
  dither: [".dither(levels, { mode: 'bayer2'|'bayer4'|'bayer8'|'random', cells })", 'Texture: ordered dither — posterize with a threshold pattern scattering the error, so gradients become texture instead of bands. Default levels 2 with bayer8 is the 1-bit classic; { cells } dithers on a chunky pixel grid instead of the texel grid, which is where the classic look lives. A texture in place of levels sets it per pixel — scale it first, like posterize.'],
  grain: ['.grain(amount, { size, mono })', 'Texture: film grain — per-pixel noise re-rolled every frame, strongest at mid-gray and gone in the blacks and the blown highlights. Default amount 0.1. A texture in place of amount sets it per pixel.'],
  lut: ['.lut(source, { mix })', "Texture: grade through a color cube — a .png holding every color's replacement, which is the form film stocks are published in (the HaldCLUT format). source is an imported image by name, or an imagefile()/imageseq(). Unlike .lookup() it remaps across channels, so shadows can go teal while skin stays warm. Positional .lut(source, 0.5) works too."],
  pixelsort: ['.pixelsort({ threshold, dir, length, size, jitter })', "Texture: spans of pixels brighter than threshold sort into gradient streaks running toward dir. Darker pixels are walls: they stay put and bound each span."],
  jpeg: ['.jpeg(quality, { corrupt, seed })', 'Texture: real DCT compression artifacts — the frame in 8×8 blocks, coefficients quantized harder as quality (0..1, fn of t) falls: flat slabs, ringing, chroma fringing at block edges. Default 0.25. corrupt re-rolls random blocks into garbage for the broken-file look.'],
  flow: ['.flow({ gain, blur, scale })', "Texture: the chain's frame-to-frame motion as a velocity picture, centered on mid-grey like fluid's .velocity() — so .displace(src.flow()) drags the image along its own movement, and .push(f.flow()) stirs a sim with it. Coarse and blurred by design: a look, not measurement."],
  pixellate: ['.pixellate(x, y?)', 'Texture: quantize position into cells (square cells if y omitted). Either count takes a texture, so the cells can be coarse in one part of the frame and fine in another.'],
  ascii: ['.ascii({ chars, cols, rows, color, bg, font, weight })', "Texture: redraw the image as a grid of characters, each cell taking the glyph whose ink matches its brightness. chars is a set name ('ascii', 'dense', 'blocks', ...) or any string of your own, dark→bright. Cells keep the image's color until you name one."],
  scroll: ['.scroll(vx, vy, (src, i, phase) => variant)', "Texture: the frame repeating forever and sliding at vx, vy frames a second, in the UV units .translate() takes. The fn gives each repeat a chain of its own; without it the call is .translate(t => t * vx, t => t * vy, { wrap: 'repeat' }).\ni is the repeat's index, 0 at t = 0 and counting up as repeats arrive; phase is how far that repeat has crossed, 0 to 1, so phase.tri() fades it in and out. Both are signals rather than numbers, so i.mul(0.1), not i * 0.1. Only the repeats on screen render: two passes, or four on a diagonal."],
  transform: [".transform({ translate: [x,y], scale, rotate, wrap: 'clamp'|'repeat'|'mirror'|'transparent' })", "Texture: UV-space transform. Shorthands: .translate(x, y), .rotate(v), .scale(v). Each key takes a texture to go per-pixel; { map, amount, mid } scales and biases what it reads."],
  crop: ['.crop(w, h?, { center })', "Texture: keep the middle w×h of the frame and drop the rest to transparent black — nothing is resampled, the frame closes in, and in a comp the surround is a cutout. Sizes above 1 are pixels of the frame's grid, 0..1 a fraction of the frame; h defaults to w. Sizes and center take fns of t."],
  warp: [".warp({ barrel, twist, zoom, center, wrap })", "Texture: radial UV warp — the CRT/fisheye lens. Radius is 1 at the frame corner, so barrel: 0.3 pulls the corners in by 30%. All params take fns of t, or textures to vary across the frame."],
  chroma: ['.chroma(amount, { radial, angle, center })', "Texture: chromatic aberration — samples R and B at opposite UV offsets, G at center. amount is the split at the frame edge: 0.002-0.01 is subtle, more is glitch. amount, angle and center take fns of t, or textures."],
  each: ['.each(bundle, (b, i, n) => chain, { mode, opacity })', "Texture: a mark per record of a bundle — a tracker's blobs, a layout's copies, points of your own. The fn is handed the record (live getters: b.pos, b.id, b.box()…) and answers a chain to comp on, or nothing to skip that one; marks land in index order, 'over' unless mode says otherwise.\nIt runs once per slot at build, like .instance()'s fn — liveness comes from the fns baked into the mark's params, so read b inside them (color: hsl(() => b.id * 0.618, 0.8, 0.6)) rather than destructuring it outside. Each distinct mark costs a pass, exactly like the comps it stands for."],
  mask: ['.mask(mask, fn?)', 'Texture: without fn, multiply by the mask\'s luma (cutout). With fn, apply it only where the mask is bright. Mask and fn both accept fn-of-chain.'],
  threshold: ['.threshold(level, { soft })', 'Texture: luma threshold to a black/white mask. Both keys take a texture: a per-pixel level cuts the image against another image rather than against one number.'],
  chromaKey: ['.chromaKey(color, { tolerance, soft, spill })', "Texture: make pixels near color transparent, leaving the rest as a cutout. The match radius adapts to the key color, so a green screen's lit and shadowed parts key together; tolerance scales it. All args take fns of t."],
  lumaKey: ['.lumaKey(level, { soft, invert })', 'Texture: make pixels darker than level transparent, leaving the bright part as a cutout; invert keys out the bright side instead. level takes a fn of t.'],
  glsl: ['.glsl(source, uniforms)', "Texture: a fragment pass you write, the chain so far in tex0. Same scope as glsl() — vUv, uTime, uFrame, uDelta, uTexel, uAspect, plus the uniforms you name: numbers, 2/3/4 arrays, colors, fns of t, or a chain, which arrives as a sampler2D of that name — a fn of the chain there, like .comp()'s, hands the pass a copy of its own input.\nA shader that doesn't compile warns with the line number and passes the picture through untouched."],
  invert: ['.invert()', 'Texture: invert colors.'],
  remap: ['.remap(map)', "Texture: absolute UV lookup — sample this chain at the map's RG coordinates. Map can be a fn of the chain so far."],
  lookup: ['.lookup(ramp)', "Texture: recolor by luma — each pixel's luminance indexes the ramp left-to-right. Ramp can be a fn of the chain so far."],
  displace: ['.displace(map, { amount, mid, smooth })', {
    geo: "Move each vertex along its normal by the map's brightness, normals rebuilt so the relief takes light. It only moves vertices the shape already has — raise res if nothing happens; calls stack.",
    texture: "Push each pixel sideways by the map's R and G.",
    note: 'The map is an imported image by name or a texture chain; positional .displace(map, amount) works on either.',
  }],
  comp: [".comp(layer, { mode, opacity, swap })", "Texture: composite layer over this chain. layer may be a fn of the chain so far. Positional .comp(layer, mode, opacity) also works.\nModes: over under add sub mult screen overlay hardLight softLight darken lighten difference exclusion dodge burn divide luminosity color sum — sum is add without the clamp, so comped white masks count their overlaps."],
  alpha: ['.alpha(v)  ·  bundle: .alpha  ·  tracker: .alpha(i)', {
    texture: "Scale the image's alpha — 1 leaves it, 0 is fully transparent, the color dimming with it (premultiplied). A texture in place of v fades per pixel by its luma. Transparency shows wherever the chain is comped or stacked; the display itself sits on black.",
    inst: "Fade this copy alone, 0..1. On a geometry copy it isn't per-copy — opacity is one material for the whole batch.",
    'bundle layout blobs': "Bundle: how present each record is, 0..1 — a particle's fade envelope, 1 or 0 on a tracker's slot by whether a blob is in it, 1 throughout where the producer never says otherwise. An array, except on a tracker, which spells it per slot like its other readings: .alpha(i), or .has(i) for the same answer as a boolean.\nThe one key besides .pos that the machinery reads: a record at 0 is left out of .pairs(), .link() and curve(), and .instance() hides its copy.",
  }],
  blur: ['.blur(radius)', 'Texture: separable gaussian blur, radius in texels. An [x, y] radius blurs per axis — .blur([8, 0]) smears horizontally only; an axis at 0 skips its pass.'],
  bloom: ['.bloom({ threshold, strength, radius, color })', 'Texture: brightpass + half-res gaussian glow.'],
  fluid: ['.fluid({ ink, res, speed, fade, damping, vorticity, iterations, wrap }) | .fluid(ink)', "Texture: the chain becomes dye in an incompressible fluid sim, poured in at the ink rate. What comes back is the sim itself, so .push() and the rest of fluid() carry on from there. Contents survive a re-run."],
  ink: ['.ink(chain, amount)', "Fluid: pour a chain in as dye, where it is bright. Added per second, so it builds while the source is lit rather than replacing what is already floating."],
  push: ['.push(map, { amount, mid }) | .push([x, y], amount)', "Fluid: drive the velocity field from a map, read R and G. Dye with nothing pushing it only sits and fades.\nA plain [x, y] is one steady force over the whole field: [0, -0.3] is gravity. Under wrap: 'clamp' the pressure solve cancels most of it, since a closed box cannot drift."],
  obstacle: ['.obstacle(mask)', 'Fluid: cells brighter than 0.5 are solid. The sim sees them, so flow goes around rather than being clipped by them.'],
  velocity: ['.velocity({ scale })', "Fluid: the velocity field as a picture, centered on mid-grey. Drops into any slot taking a map: .displace(f.velocity()), .transform({ translate: { map: f.velocity(), mid: 0.5 } })."],
  curl: ['.curl({ scale })', 'Fluid: how sharply the field is spinning at each point, centered on mid-grey.'],
  pressure: ['.pressure({ scale })', 'Fluid: the pressure the solve landed on, centered on mid-grey. Mostly worth looking at when a sim is misbehaving.'],
  delay: ['.delay(frames, { scale, max })', "Texture: the chain as it was n frames ago. frames takes a fn of t; history survives a re-run and costs memory per frame — { scale } trades resolution for it.\nA texture in place of frames delays per pixel: its luma picks how far back each pixel looks, black now, white the whole { max } frames — slit-scan from a ramp, melt from noise."],
  marked: ['.marked()', "Text: how much of the string its ranges cover, 0..1 by character — a signal, so it drops into any numeric parameter. Reads the parameters rather than the picture, so it reports whether or not the chain is on screen."],
  slice: ['.slice(start, end?)', "Feed: the frame with its text cut and its ranges moved to match — negative indices count from the end, like a string's own slice(). Cutting the text by hand instead leaves every range past the cut pointing at the wrong characters."],
  invert: ['.invert()', 'Feed: the frame with its ranges complemented — everything *not* marked becomes the marks. The text is untouched.'],
  field: ['.field({ res })', "Texture: end the chain with a sampler instead of a picture — a plain function (u, v) => 0..1 reading the chain's luma at that point, v = 0 at the bottom. Read on the CPU a frame or so behind, so any source can drive an .instance() layout or other sketch code."],
  feedback: ['.feedback(amount, prev => chain, { mode, swap, reset })', "Texture: comp this point's own last frame back over the chain — trails, echoes, video feedback. amount is how much of it returns (a fn of t works); the fn treats last frame on its way round, like p => p.rotate(0.02). A bare mode name stands in for the options in either slot — .feedback(0.9, 'under'). Contents survive a re-run; reset cuts them (see the key)."],
  tile: ['.tile(nx, ny, (src, i, x, y) => variant)  ·  .tile(n) on an instance copy', {
    texture: 'Tile nx×ny with a per-cell chain. fn may return src, a treatment of it, or any texture; identical variants dedupe, each distinct one renders its own pass. x left→right, y bottom→top, i = y*nx + x.',
    inst: 'Which picture this copy wears, out of the set in .material({ map: [a, b, c] }). Counts round, so .tile(i) over a longer grid repeats the set.',
  }],
};

// --- config keys -----------------------------------------------------------
//
// The `{ ... }` groups in a signature are the config objects a call accepts, so
// the table above already holds the key lists — no second copy to drift. What
// rides along inside comes free too: `wrap: 'clamp'|'repeat'` is both the hint
// shown beside the key and the values offered after typing `wrap:`, and
// `freq: 1` is the default. Two groups mean two forms of the same call
// (`.shadow()` on a mesh vs. `shadow:` on a light), so they're unioned.

// split on `sep` at brace/bracket/paren depth 0
function splitTop(s, sep) {
  const out = [];
  let cur = '', depth = 0;
  for (const ch of s) {
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    if (ch === sep && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map((p) => p.trim()).filter(Boolean);
}

function braceGroups(detail) {
  const groups = [];
  for (let i = 0; i < detail.length; i++) {
    if (detail[i] !== '{') continue;
    let depth = 0, j = i;
    for (; j < detail.length; j++) {
      if (detail[j] === '{') depth++;
      else if (detail[j] === '}' && !--depth) break;
    }
    groups.push(detail.slice(i + 1, j));
    i = j;
  }
  return groups;
}

// 'linear'|'radial' -> the literal values a key or argument slot accepts
const literalValues = (s) =>
  /^'[^']*'(\s*\|\s*'[^']*')*$/.test(s) ? splitTop(s, '|').map((v) => v.replace(/'/g, '')) : null;

function parseConfig(detail) {
  const keys = new Map();
  for (const group of braceGroups(detail)) {
    for (const part of splitTop(group, ',')) {
      const colon = part.indexOf(':');
      // a trailing ? marks an optional key in the signature — scene({ bg? })
      const key = (colon < 0 ? part : part.slice(0, colon)).trim().replace(/\?$/, '');
      if (!/^\w+$/.test(key) || keys.has(key)) continue;
      const hint = colon < 0 ? '' : part.slice(colon + 1).trim();
      keys.set(key, { key, hint, values: literalValues(hint) });
    }
  }
  return keys.size ? keys : null;
}

// The same trick one level out: a signature that spells its argument's values
// in the slot itself — mouse('x'|'y'|'down') — is offering them to completion
// too. Returns values per argument index, or null when no slot names any.
//
// Two alternatives at least: a lone quoted argument is an example of what goes
// there (text('hi', …)), not the list of what may.
function parseArgs(detail) {
  const open = detail.indexOf('(');
  if (open < 0) return null;
  let depth = 0, close = open;
  for (; close < detail.length; close++) {
    if (detail[close] === '(') depth++;
    else if (detail[close] === ')' && !--depth) break;
  }
  const slots = splitTop(detail.slice(open + 1, close), ',')
    .map((s) => literalValues(s))
    .map((v) => (v && v.length > 1 ? v : null));
  return slots.some(Boolean) ? slots : null;
}

const configTable = (table) => {
  const out = {};
  for (const [name, [detail]] of Object.entries(table)) {
    const keys = parseConfig(detail);
    if (keys) out[name] = keys;
  }
  return out;
};

export const GLOBAL_CONFIG = configTable(GLOBALS);
export const METHOD_CONFIG = configTable(METHODS);

const argTable = (table) => {
  const out = {};
  for (const [name, [detail]] of Object.entries(table)) {
    const slots = parseArgs(detail);
    if (slots) out[name] = slots;
  }
  return out;
};

export const GLOBAL_ARGS = argTable(GLOBALS);
export const METHOD_ARGS = argTable(METHODS);

// .material() is the exception: its signature names the sixteen keys worth
// showing in a tooltip header, but the material understands 45. materials.js
// owns that list (it's what rejects a typo), so take it from there instead.
METHOD_CONFIG.material = new Map(
  MATERIAL_GROUPS.flatMap(([section, keys]) =>
    keys.map((key) => [key, { key, hint: '', values: null, section, doc: MATERIAL_DOCS[key] }])
  )
);

// Same escape hatch for .comp({ mode }): eighteen blend modes don't fit in a
// signature, and textures.js owns the list that resolves them. .feedback()
// hands its mode straight to a comp, so it offers the same set.
METHOD_CONFIG.comp.get('mode').values = BLEND_MODE_NAMES;
METHOD_CONFIG.feedback.get('mode').values = BLEND_MODE_NAMES;
// and the positional spellings of the same slot: .comp(layer, 'add'), and
// .feedback()'s mode name, which stands in for the options in either slot
METHOD_ARGS.comp = [null, BLEND_MODE_NAMES];
METHOD_ARGS.feedback = [null, BLEND_MODE_NAMES, BLEND_MODE_NAMES];
// a texture's .blend() takes the same set; particles' three are among the names
METHOD_ARGS.blend = [[...new Set(['over', 'add', 'solid', ...BLEND_MODE_NAMES])]];

// Copies blend in one draw, so they get the four modes fixed-function blending
// can express rather than .comp()'s eighteen — the list textures.js checks the
// key against.
METHOD_CONFIG.instance.get('blend').values = COPY_BLEND_NAMES;

// preset names complete in both spellings: .material('… and { preset: '…
METHOD_CONFIG.material.get('preset').values = PRESET_NAMES;
METHOD_ARGS.material = [PRESET_NAMES];

// These signatures spell `{ wrap }` bare — the value list lives in each key's
// doc line, where completion can't parse it — so it's wired from the table
// textures.js resolves it with. (.transform names the values inline already.)
for (const call of ['scale', 'rotate', 'translate', 'warp']) {
  METHOD_CONFIG[call].get('wrap').values = WRAP_MODE_NAMES;
}

// .ascii({ chars }) takes either a named set or a literal vocabulary, so the
// names are a starting point rather than the whole domain — offered from the
// table that resolves them, and free to be typed over.
METHOD_CONFIG.ascii.get('chars').values = ASCII_SET_NAMES;

// `font:` accepts any installed family, any Google family and any URL — far
// too many to list, and none of them nameable from memory mid-set. So this is
// a shortlist rather than a domain: the seven system faces that resolve
// everywhere (api.js keeps metric-compatible stand-ins for exactly these) and
// a spread of Google families worth reaching for — mono, display, pixel,
// serif — one of which is usually closer than whatever you'd have typed.
const FONT_NAMES = [
  'arial', 'helvetica', 'times new roman', 'courier new', 'georgia', 'calibri', 'cambria',
  'google:Inter', 'google:Roboto Mono', 'google:Space Mono', 'google:VT323',
  'google:Press Start 2P', 'google:Silkscreen', 'google:Major Mono Display',
  'google:Anton', 'google:Bebas Neue', 'google:Archivo Black', 'google:Orbitron',
  'google:Rubik Glitch', 'google:Playfair Display', 'google:DM Serif Display',
];
for (const keys of [GLOBAL_CONFIG.text, GLOBAL_CONFIG.text3d, METHOD_CONFIG.ascii]) {
  keys.get('font').values = FONT_NAMES;
}

// --- what each config key does ---------------------------------------------
//
// A line per key, because a name and a default tell you nothing about whether
// this is the knob you want. These are read out on ctrl+hover and in the
// completion popup, so the standard is: what it visibly does, what shape of
// value it takes, and a number worth typing. One or two sentences — anything
// longer is something you'd read between sets, not during one.
//
// Keyed by call. `noise({ })` and `.noise({ })` are different calls with
// different keys, hence two tables. .material()'s 46 live in materials.js,
// next to the list that validates them.

const GLOBAL_KEY_DOCS = {
  scene: {
    bg: "Swap the backdrop for this read only: a color stands in for bg(), a texture chain shows through behind the geometry, and null leaves it transparent so whatever sits below in the stack shows through.",
  },
  stack: {
    bg: "Swap the backdrop for this read only: a color stands in for bg(), a texture chain goes under the layers, and null leaves it transparent, which is what a feedback loop wants.",
  },
  input: {
    reset: 'Blanks the buffer on the rising edge of its value — a loop reading it starts from black again. A fn of t fires it from code (reset: t => t % 4 < 0.1 cuts every four seconds; a kick trigger cuts on the beat); true cuts once per run, a clean start on every ctrl+enter.',
  },
  curve: {
    closed: "Loop u instead of turning back at the ends — for a lifted fn whose end meets its start. curve.circle() is already closed.",
    even: "Measures the curve's length and remaps u to a fraction of it, so equal steps of u cover equal distance. Built-in curves are already even. Measured once, or per frame when the fn takes t.",
  },
  spread: {
    jitter: 'How far a value may leave its even slot, 0..1 of half a step. Deterministic by seed.',
    random: 'Scatter the values instead of spacing them evenly. Deterministic by seed.',
    seed: 'Reroll for jitter and random.',
    end: 'Include both endpoints — i/(n-1) instead of i/n. Fence posts on an open curve; a closed one would double its seam.',
  },
  track: {
    max: "How many blobs to follow at once, which is also how many copies .instance() draws — so it's the most the sketch might need, not the most it expects. Extra slots cost a hidden copy each; blobs past the last free slot are ignored, biggest first. Default 8, up to 64.",
    threshold: "Where the cut between blob and background falls, 0..1 on the chain's luma. Unset, detection sweeps a range of cuts (0.2..0.84) and keeps what shows up at two or more, so features at every brightness are found without tuning; [lo, hi] sweeps that range instead. One number is one exact cut — right for a mask that is already binary, like a person() or a thresholded difference, where every cut agrees anyway.",
    levels: 'How many cuts the sweep makes across its range. Default 9. More finds features whose brightness sits between cuts, at CPU cost per frame; ignored when threshold is one number.',
    size: "How big a blob may be and still count, as [smallest, biggest] in the units .size(i) answers — fractions of the frame's height. Default [0.01, ∞]. A number alone is the floor. The floor is the speckle filter; the ceiling is what keeps a bright wall or a whole room from taking the slots when the subject is its features.",
    dark: "Detect dark regions instead of bright — the luma is flipped on its way into detection, which is free, where .invert() on the chain costs a pass per frame. The features of a face are the usual customers; this is also the polarity classical trackers default to.",
    res: 'Readback size, pixels per side. Default 128. Finer finds smaller blobs and costs a bigger read plus a longer sweep every frame; the readback is square, so a widescreen frame is squeezed into it and comes back out on read.',
    hold: "How long a blob's slot coasts on its last known pose after it stops being detected, in seconds. Default 0.25. A detection dropping out for a frame or two is usually the threshold flickering on an edge, and this is what keeps the copy from blinking out and back.",
    smooth: "Time constant in seconds for the lag on position, size and axis — the same kind of number .smooth() on a signal takes. Default 0.05. Raise it for a steadier read that trails the movement; 0 is the raw measurement, which at this res visibly jitters.",
    gate: "How far a blob may move between frames and still be recognized as the same blob, in .pos() units before { scale }. Default 0.2. Measured from where it was heading rather than where it was, so a fast hand doesn't need a wide gate; too wide and two blobs passing each other swap.",
    scale: 'Multiplies every position and size on the way out. Default 1, which is frame units — y spans -0.5..0.5, the space a texture copy draws in. A 3D scene wants the frame sized to the scene: { scale: 6 }.',
  },
  data: {
    pos: 'The points: an array of [x, y, z], or a fn of t returning one.',
    alpha: 'Optional visibility per point, 0..1 — an array or fn of t. 0 drops a point from pairing and fades its lines out; confidence from a tracker goes here.',
  },
  segments: {
    within: 'When handed points rather than pairs: the connection distance. Default 1.',
    max: 'When handed points: at most this many pairs per point. Default 6.',
    fill: 'Shade every trio of paired points as a triangle, at this alpha. true is 0.12. Default off.',
    lit: "Shade the lines and fills with the scene's lights instead of the flat color. Default false.",
    fade: 'Fade each line out as its ends drift apart, gone at the pairing distance. Default true.',
    color: 'Line color. Default #8899ff. Takes a fn of t.',
    opacity: 'Line opacity, 0..1, on top of the fade. Default 1.',
    blend: "'over' (default) or 'add' — additive stacks crossings into glow.",
  },
  link: {
    within: 'Connection distance in world units. Default 1. Takes a fn of t.',
    max: 'At most this many links per point. Default 6.',
    fill: 'Shade every trio of linked points as a triangle, at this alpha. true is 0.12. Default off.',
    lit: "Shade the lines and fills with the scene's lights instead of the flat color. Default false.",
    fade: 'Fade each line out as its ends drift apart, gone at within. Default true.',
    color: 'Line color. Default #8899ff. Takes a fn of t.',
    opacity: 'Line opacity, 0..1, on top of the fade. Default 1.',
    blend: "'over' (default) or 'add' — additive stacks crossings into glow.",
  },
  sphere: {
    radius: 'Radius in world units. Default 1.',
    res: 'Segments around the equator, half that pole to pole. Default 64. Raise it only when .noise() needs finer vertices to push around.',
  },
  box: {
    width: 'Size along X. Default 1.',
    height: 'Size along Y. Default 1.',
    depth: 'Size along Z. Default 1.',
    res: 'Subdivisions per face. Default 24. A low res leaves .noise() almost nothing to displace.',
  },
  plane: {
    width: 'Size along X. Default 10.',
    height: 'Size along Y (the plane starts upright — .rotation(-Math.PI/2, 0, 0) lays it flat). Default 10.',
    res: 'Grid subdivisions per side, or [across, down]. Default 128 — this is the vertex budget .noise() turns into terrain, and the rows .lines() draws.',
  },
  torus: {
    radius: 'Center of the ring to the center of the tube. Default 1.',
    tube: 'Thickness of the tube itself. Default 0.35.',
    res: 'Segments around the tube, twice that around the ring. Default 48.',
  },
  torusKnot: {
    radius: 'Overall size of the knot. Default 1.',
    tube: 'Thickness of the strand. Default 0.3.',
    res: 'Segments around the tube, twice that along the strand. Default 64.',
    p: 'How many times the strand winds around the axis. Default 2.',
    q: 'How many times it winds through the hole. Default 3. Keep p and q coprime or the knot collapses into a plain ring.',
  },
  cylinder: {
    radiusTop: 'Radius of the top face. Default 0.5 — set 0 for a cone.',
    radiusBottom: 'Radius of the bottom face. Default 0.5.',
    height: 'Length along Y. Default 1.5.',
    res: 'Segments around and along. Default 48.',
  },
  capsule: {
    radius: 'Radius of the tube and of both caps. Default 0.5.',
    height: 'Length of the straight middle section along Y. Default 1 — the whole capsule measures height + 2 * radius, so height: 0 is a sphere.',
    res: 'Segments around the circumference. Default 48; the caps and the middle each get a quarter of it, which keeps the vertices evenly spaced for .noise().',
  },
  icosa: {
    radius: 'Radius in world units. Default 1.',
    res: 'Subdivision level, 0..9 — a level, not a segment count, so it climbs fast. Default 8. Triangles stay evenly sized at any level, which is why this is the shape to .noise() into a blob.',
  },
  model: {
    center: "Sit the geometry's bounding box on the origin. Default true; false keeps the file's own placement.",
    fit: "Scale the longest axis to this many world units. Default 2, so anything lands usable. fit: 0 keeps the file's units, whatever they turn out to be.",
  },
  particles: {
    max: "Ceiling on the pool: how many particles may exist at once. Only needed to cap memory — set rate and life and the pool sizes itself. Default 10,000 when no rate is given; the hard ceiling is ~1M.",
    rate: 'Particles born per second. Default: whatever cycles the pool once per life. This is the density dial — rate × life is how many are alive at once.',
    life: 'Seconds each particle lives. A [min, max] pair varies it per particle, which reads far more natural than one exact age. Default 3.',
    speed: 'Starting speed, units/s. A [min, max] pair varies it per particle. Default 2.',
    spread: 'How far off dir a particle may aim: 0 keeps every one on it, 1 forgets it entirely — a full sphere. Default 0.25.',
    dir: "Which way particles leave: a vector, or 'out' for any direction at all. Default [0, 1, 0], up. (From a shape's .particles(), 'out' means along the surface normal, and is the default.)",
    pos: 'Where the point emitter sits, [x, y, z]. Components take fns of t — a moving emitter draws trails through the air. Default the origin.',
  },
  ambient: {
    color: 'Light color. Default white. Hex, CSS name, or [r, g, b] 0..1 — any of them, or a channel of the array, may be a fn of t.',
    intensity: "Brightness. Default 0.3 — this is the floor everything sits at, so it's the dial between a lit room and a single lamp in the dark.",
  },
  resolution: {
    width: 'Render width in pixels. No call at all = the browser window.',
    height: 'Render height in pixels. Defaults to width, i.e. a square.',
  },
  camera: {
    pad: 'Give the camera to a game controller: right stick orbits, left stick moves in and out, triggers and bumpers pan (d-pad too, for a controller without them). The mouse still works. A number picks a pad by slot.',
    fly: 'Navigate instead of orbiting: left stick moves where you look, right stick looks, triggers rise and fall. Orbiting is off while a sketch flies.',
    speed: "How fast the left stick moves the camera. Default 5 units/sec flying, 0.7 for the orbit rig, where it scales the in-and-out and the pan together. Negative inverts.",
    look: 'How fast the right stick turns, in radians/sec. Default 0.9 flying, 1.6 on the orbit rig. Negative inverts.',
    lift: 'How fast the triggers rise and fall, in units/sec. Flying only. Default 3, under the travel speed, since altitude is usually the finer adjustment.',
    recenter: "Button that puts the pan back to the center, undoing it without moving the view off its angle. Default 'r3', the right stick clicked in; false turns it off. Orbit rig only.",
    deadzone: "How far a stick must leave center before it reads. Default 0.12, wider than gamepad()'s, since a drifting camera shows.",
    x: 'Starting position along X, before the pad takes over. Left where it is without one.',
    y: 'Starting position along Y.',
    z: 'Starting position along Z.',
    target: 'Starting point to look at, [x, y, z].',
  },
  fog: {
    color: 'What distant geometry fades to. Default #0a0a0f. Usually the same as bg().',
    near: 'World distance at which the fade starts. Default 5.',
    far: 'World distance at which geometry is fully fog. Default 30.',
  },
  directional: {
    color: 'Light color. Default white. Hex, CSS name, or [r, g, b] 0..1 — any of them, or a channel of the array, may be a fn of t.',
    intensity: 'Brightness. Default 1.5. Takes a fn of t.',
    shadow: 'true to cast shadows, or an object to tune them: { map, soft, strength, area, near, far, bias, normalBias }.',
  },
  point: {
    color: 'Light color. Default white. Hex, CSS name, or [r, g, b] 0..1 — any of them, or a channel of the array, may be a fn of t.',
    intensity: 'Brightness. Default 20 — a point light needs far more than a directional to read the same.',
    distance: 'Radius at which the light reaches zero. Default 0, meaning it never fully stops.',
    decay: 'Falloff exponent. Default 2, the physical inverse-square, which reads like a bare bulb. Around 1.3 pushes light further down a corridor.',
    shadow: 'true to cast. This is the expensive one — a cube map, so six renders. { map: 512 } wins some back.',
  },
  spot: {
    color: 'Light color. Default white. Hex, CSS name, or [r, g, b] 0..1 — any of them, or a channel of the array, may be a fn of t.',
    intensity: 'Brightness. Default 60.',
    angle: 'Half-width of the cone, in radians. Default ~0.52 (a desk lamp); 0.1 is a searchlight.',
    penumbra: '0 is a hard-edged circle of light, 1 fades from the rim all the way to the center. Default 0.4.',
    distance: 'Distance at which the beam reaches zero. Default 0 = no cutoff.',
    decay: 'Falloff exponent along the beam. Default 2.',
    shadow: 'true to cast. A cone of light is a cone of shadow, so this is the light shadows read best on.',
  },
  hemi: {
    sky: 'Color arriving from above. Default #8899ff.',
    ground: 'Color bounced up from below. Default #332211.',
    intensity: 'Brightness. Default 0.6. Fills shadows without casting any of its own.',
  },
  hdri: {
    background: 'Show the HDRI behind the scene. Default true; false keeps your bg() and fog while still lighting with it.',
    intensity: 'How hard the environment lights everything. Default 1.',
    blur: '0..1, softens the visible sky only — the light it casts stays sharp. Default 0.',
    rotation: 'Turns the sky and the light rig together, in radians. Animate it to sweep reflections across metal.',
    backgroundRotation: 'Turns the visible sky alone, leaving the lighting where it is — the sky slides behind a scene that stays lit the same way.',
    backgroundIntensity: 'Brightness of the visible sky alone. Default 1; drop it to sit the background back behind the subject without dimming the light.',
  },
  depth: {
    near: "World distance that comes out black. Defaults to the sketch's fog near, or 0.",
    far: 'World distance that comes out white. Defaults to the fog far, or 20.',
    focus: 'Distance of the sharp plane — output is 0 there and rises either side. Default 8. Naming it switches to depth-of-field mode.',
    range: 'How far from focus it takes to reach white. Default 6. Smaller is a shallower, more cinematic falloff.',
  },
  ramp: {
    type: "'linear' straight across, 'radial' out from the center, 'angular' swept around it. Default 'linear'.",
    a: 'Color at the low end. Default black; null fades from transparent — a radial ramp to null is a vignette that comps over anything.',
    b: 'Color at the high end. Default white; null fades to transparent.',
    angle: 'Direction of a linear ramp, or where an angular one starts, in radians. Default 0.',
    phase: 'Slides the sweep along itself, in cycles. Default 0. With period or shape named it wraps, so animating it scrolls the bands forever.',
    period: 'How much of the frame one cycle of the sweep spans. Default 1, a single gradient; below that it repeats into bands — 0.5 is two, and with type angular or radial that gives a pinwheel or rings. The useful range is 0..1, so a bare signal drops in.',
    freq: 'How many cycles span the frame — the reciprocal of period, and the easier spelling for fine bands: freq: 80 is scanlines. Naming either one is what makes phase wrap.',
    shape: "Waveshape of each period, as on signals: 'saw' (default — plain ramp, hard seam), 'tri' (seamless, what soft stripes want), 'sin' (smoother still), 'sqr' (hard bands).",
  },
  circle: {
    radius: 'Radius in UV units, so 0.5 touches the frame edge. Default 0.25. A texture here is the radius at that pixel — noise({ freq: 3 }).mul(0.1).add(0.25) is a wobbling blob.',
    soft: 'Width of the fade at the rim, in UV units. Default 0 — a hard edge, antialiased to a pixel rather than left stepped. 0.05 is a visible feather, 0.2 a soft glow. A texture makes the rim crisp in places and vague in others.',
    center: '[x, y] in UV, 0..1 from bottom-left. Default [0.5, 0.5]. A texture takes x from red and y from green.',
    color: 'Color inside the disc. Default white.',
    bg: 'Color outside it. Default black; null leaves it transparent, so the disc comps over another chain as a sprite.',
    thickness: 'Width of the band, measured inward from the rim, leaving a hole. Unnamed is a solid disc; an explicit 0 draws nothing. A texture thins and fattens the band around its circumference.',
  },
  ring: {
    inner: 'Radius of the hole, in UV units. Default 0.15. At or past outer the band has no width left and nothing is drawn, so animating inner up to outer closes the ring rather than filling it.',
    outer: 'Radius of the rim, in UV units, so 0.5 touches the frame edge. Default 0.25.',
    soft: "Width of the fade, applied to both edges. Default 0 — hard, antialiased to a pixel. A soft big enough to swallow the band is how a ring becomes a glowing hoop. Takes circle()'s texture too.",
    center: '[x, y] in UV, 0..1 from bottom-left. Default [0.5, 0.5]. A texture takes x from red and y from green.',
    color: 'Color of the band. Default white.',
    bg: 'Color of the hole and everything outside. Default black; null leaves both transparent, so the base shows through the hole.',
  },
  rect: {
    w: 'Width as a fraction of the frame, so 1 spans it. Default 0.5. A texture here is the width at that pixel.',
    h: 'Height as a fraction of the frame. Defaults to w.',
    corner: "Corner radius in UV units (circle's radius scale). Default 0 — square corners; half the short side is a stadium shape.",
    rotate: 'Rotation about the center, in radians. Default 0. The rect turns rigidly, keeping its shape on any frame.',
    thickness: 'Width of the outline, measured inward from the edge, leaving a hole. Unnamed is a solid fill; an explicit 0 draws nothing.',
    soft: 'Width of the fade at the edge, in UV units. Default 0 — hard, antialiased to a pixel. A texture makes the edge crisp in places and vague in others.',
    center: '[x, y] in UV, 0..1 from bottom-left. Default [0.5, 0.5]. A texture takes x from red and y from green.',
    color: 'Fill color. Default white.',
    bg: 'Color outside it. Default black; null leaves it transparent, so the rect comps over another chain.',
  },
  polygon: {
    sides: 'How many corners, 3 up. Default 6. A texture here reshapes per pixel.',
    radius: 'Center to the corners, in UV units — so it converges on circle() as sides climb. Default 0.25.',
    star: 'Pulls the edge midpoints toward the center, 0..1: 0 leaves the polygon alone, 0.5 is a clear star, 1 collapses it to spikes. Default 0.',
    rotate: 'Rotation in radians. Default 0 — one vertex points up.',
    thickness: 'Width of the outline, measured inward from the edge, leaving a hole. Unnamed is a solid fill; an explicit 0 draws nothing.',
    soft: 'Width of the fade at the edge, in UV units. Default 0 — hard, antialiased to a pixel.',
    center: '[x, y] in UV, 0..1 from bottom-left. Default [0.5, 0.5]. A texture takes x from red and y from green.',
    color: 'Fill color. Default white.',
    bg: 'Color outside it. Default black; null leaves it transparent, so the shape comps over another chain.',
  },
  checker: {
    period: 'How much of the frame one cell spans. Default 1/8. Same 0..1 range every period key has.',
    freq: 'How many cells span the frame — the reciprocal of period. Default 8. Cells stay square on any aspect.',
    rotate: 'Rotation about the frame center, in radians. Default 0.',
    a: 'One of the two colors. Default black; null is transparent, so half the board is a cutout.',
    b: 'The other. Default white; null is transparent.',
  },
  person: {
    part: "One region instead of the whole person: 'hair', 'face', 'body', 'skin' (face + body), 'clothes' or 'other' (accessories). Uses a larger model, fetched on first use.",
    smooth: 'How much of the previous frame each new mask keeps, 0..0.95 — steadies flicker at the cost of a trailing edge. Default 0.4; 0 is the model raw. Takes a fn of t.',
  },
  videofile: {
    speed: 'Playback rate: 1 normal, 0.5 half, 0 freezes the frame. Takes a fn of t. Rates past 16 clamp; negative freezes, since no browser plays a video backwards.',
    loop: 'Start over at the end. Default true.',
    mute: 'Default true. false lets the file\'s own audio play out loud.',
    restart: 'Rewinds whenever this crosses 0.5 upward — restart: beat(1) retriggers every bar.',
    phase: 'Where in the clip to sit: 0 the start, 1 the end. Setting it stops playback and hands the position to the signal, so phase: rand().beat(4) jumps around each beat. Wraps while looping, and is silent on its own — add jump to keep the sound.',
    jump: 'Seeks to phase whenever this crosses 0.5 upward, then plays on from there. Unlike phase alone it leaves the clip running, so mute: false stays audible: { mute: false, phase: rand(), jump: beat(4) } re-cues picture and sound every beat.',
  },
  noise: {
    period: "How much of the frame one blob of noise spans. Default 0.25, four across — 0.5 is big soft shapes, 0.03 is fine grain. The useful range lives in 0..1 like ramp's, so a bare signal drops in: period: audio() churns the grain with the level.",
    freq: 'How many blobs span the frame — the reciprocal of period, so freq: 4 is period: 0.25. Naming both is period.',
    octaves: 'Layers of finer detail stacked on top, 1..8. Default 3.',
    lacunarity: 'How much finer each octave is than the last. Default 2, meaning twice.',
    gain: 'How much quieter each octave is than the last. Default 0.5. Near 0 stays smooth and cloudy, near 1 goes rough and grainy.',
    speed: 'How fast the field churns. Default 0.3; 0 freezes it into a still.',
    seed: 'Picks a different field of the same character — a reroll for when the settings are right but the shape is wrong.',
    channels: '1 for grayscale, 2-4 for independent fields in R/G/B/A. Default 1. Feed channels: 2 to .displace() so it wobbles both ways instead of along the diagonal.',
    a: 'Color the low end shades to. Default black; null shades from transparent, so the clouds float over whatever is under the comp.',
    b: 'Color the high end shades to. Default white; null shades to transparent.',
  },
  fluid: {
    res: 'Grid size along the long edge, 16..1024. Default 256. The short edge follows the window so cells stay square. Changing it starts the sim over.',
    speed: 'Multiplies the timestep. Default 1; 0 freezes the field without freezing the sketch.',
    fade: 'Dye lost per second, 0..1. Default 0.4. 0 never fades, so ink keeps building until the frame is solid.',
    damping: 'Velocity lost per second, 0..1. Default 0.3. Raise it for a field that settles quickly once you stop pushing.',
    vorticity: 'How much of the swirl the grid rounds off gets put back. Default 0.3. 0 is soupy, high is wispy and turbulent.',
    iterations: 'Pressure solve steps per frame, 1..120. Default 30. Fewer is cheaper and leaks; more is stiffer and slower.',
    wrap: "'repeat' (default) flows off one edge and back in the other, 'clamp' puts walls around the frame.",
  },
  voronoi: {
    period: 'How much of the frame one cell spans. Default 1/6 — 0.5 is a few big plates, 0.025 is fine crazing. Same 0..1 range every period key has.',
    freq: 'How many cells span the frame — the reciprocal of period. Default 6: 2 is a few big plates, 40 is fine crazing. scale is the old name for this key and still works.',
    speed: 'How fast the points drift inside their cells. Default 0.3; 0 freezes the pattern into a still.',
    blend: "How far past its own cell each pixel samples, in cell widths. Default 0 — hard edges. Raising it blends neighboring cells into each other ('cells'), rounds the wells ('distance') and fattens the seams ('edges'). A texture here makes the pattern crisp in some places and blended in others.",
    seed: 'Picks a different scatter of the same character. Default 0.',
    mode: "'cells' (default) fills each cell flat, 'distance' shades by how far the pixel is from its point — dark at the points, bright at the walls — and 'edges' lights only the seams, where the two nearest points are equally close.",
    a: 'Color the low end shades to. Default black; null is transparent. In cells mode each cell picks its own point on the a→b ramp, so two different colors give a scatter of tints; .lookup() a grayscale one through a gradient for a wider palette.',
    b: 'Color the high end shades to. Default white; null is transparent.',
  },
  text: {
    size: 'Values above 1 are screen pixels, like CSS; 0..1 is a fraction of frame height. Default 0.15.',
    color: 'Text color. Default white.',
    bg: 'Background fill. Default black; null paints nothing, so the text comps straight over another chain.',
    pos: '[x, y] in UV, 0..1 from bottom-left. Default [0.5, 0.5].',
    font: "Any CSS family name, 'google:Name', or a font URL. Default a monospace stack.",
    weight: 'CSS weight, 100..900. Default 700.',
    align: "Which end of the line pos anchors. Default 'center'.",
    tracking: 'Extra space after every letter, in ems: 0.1 adds a tenth of the font size. Negative tightens, and far enough negative piles the letters on top of each other. Default 0.',
    leading: 'Distance from one line to the next, in ems: 1 sets lines a font size apart, 2 double-spaces. Default 1.2.',
    wrap: 'Break long lines at this width — above 1 screen pixels, 0..1 a fraction of frame width. Default: no wrapping, so only \\n breaks a line. A word with no room to fit breaks inside itself.',
    fit: "[w, h] — the box the type is sized to fill, so two words come out huge and a whole file comes out small. Same units as size; wraps at w. A size, not a position: pos and align still place it. With no size to cap it the type may grow until h stops it.",
    ranges: 'Which parts of the string to mark: [[start, end], ...] character offsets, end exclusive. A fn of t for marks that move — a feed is exactly this. Out-of-range pairs are clipped and overlaps merged, so a mark never doubles up.',
    mark: "How the ranges look, one style for all of them: { mode, color, on, weight, pad, dim }. Shape and color are separate, so on: '#ff0' recolors the marked glyphs under any mode.",
    url: "Read the text — and its ranges, if it sends them — from a live feed instead of the sketch. Sugar for text({ text: f.text, ranges: f.ranges }) over feed(url), which is what to write when you want to cut the text or invert the marks first. Shares one connection with every other call on the same url.",
    pick: "Which field of a JSON frame holds the text, when the producer doesn't call it text. Passed through to feed().",
    poll: 'Seconds between fetches, for a url that only answers once. Default: fetched once and left alone. An event stream ignores it — it pushes.',
  },
  feed: {
    pick: "Which field holds the text, when the producer doesn't call it text: pick: 'lyrics'. Without it a JSON frame needs a text key to draw, and says so if it hasn't got one.",
    poll: 'Seconds between fetches, for a url that only answers once. Default: fetched once and left alone. An event stream pushes instead, and ignores this.',
  },
  text3d: {
    size: 'Cap height in world units. Default 1.',
    depth: 'How far the letters extrude along Z. Default 0.25.',
    bevel: 'Rounding on the front edge. Default 0.02; 0 gives a hard flat extrude.',
    res: 'Curve segments per glyph. Default 8 — raise it for large smooth type.',
    font: "A font name, 'google:Name', or a .ttf/.otf/.typeface.json URL; renders in helvetiker until the real one arrives. A bare name tries installed fonts (Chrome/Edge, one-time prompt), then Google Fonts; the seven common system faces have stand-ins that work in any browser.",
    weight: "'bold' selects the bold built-in when no font is named.",
    align: "How multiline text justifies against its widest line. Default 'left'.",
    tracking: 'Extra space after every letter, in ems: 0.1 adds a tenth of size. Negative tightens, and far enough negative piles the letters on top of each other. Default 0.',
    leading: "Distance from one line to the next, in ems: 1 sets lines one size apart, 2 double-spaces. Default is the font's own line height.",
    center: 'Center the text on the origin. Default true.',
  },
  // The outer keys of bands() are band names, so there's nothing to complete
  // there; these are the keys of one band's object, one level in.
  bands: {
    from: 'Bottom of the band, in Hz. A kick lives around 30–160, a snare 200–400, hats 6k up.',
    to: 'Top of the band, in Hz. Below from it swaps with it; a band narrower than a twentieth is widened to one.',
    lo: 'What the band has to read before this band reports anything above 0, 0..1. Anything quieter clips to 0, which is how a band ignores the rest of the mix bleeding into it. Default 0.',
    hi: 'What the band has to read for this band to report 1, 0..1. Anything louder clips to 1. Default 1 — bring it down to the loudest the band actually gets and the sketch sees the full 0..1 sweep.',
    sm: 'Seconds of smoothing before the anchors, so the value eases instead of snapping. Default 0. A kick wants 0.05 to stay punchy, a pad 0.3 or more.',
    auto: "Fit lo and hi to whatever is playing, continuously, instead of holding the numbers above. Default false. The one setting worth carrying between machines, since it calibrates itself to the input it finds — which is also why a band with auto on is written without lo and hi.",
  },
  audiofile: {
    volume: '0..1 playback level. Only how loud it plays — the signal it returns is unaffected.',
    speed: 'Playback rate: 1 normal, 0.5 half. Takes a fn of t. Rates past 16 clamp; negative freezes.',
    loop: 'Start over at the end. Default true.',
    restart: 'Rewinds whenever this crosses 0.5 upward.',
    chan: 'Analyze one channel by index instead of the mix.',
  },
  rand: {
    freq: 'How fast the value wanders. Default 1.',
    seed: 'Picks an independent stream. Default 0 — rand({ seed: i }) inside .instance() gives every copy its own wander.',
  },
  gamepad: {
    deadzone: 'How far a stick must leave center before it reads at all, 0..1. Default 0.08, which covers the drift on a worn stick; the travel past it is rescaled so the full reach is still there.',
  },
};

const METHOD_KEY_DOCS = {
  circle: {
    center: 'Where the circle sits, [x, y, z]. Components take fns of t. Default the origin.',
    axis: "The axis the circle rings: 'y' (default — flat on the ground), 'x' or 'z'.",
  },
  helix: {
    radius: 'Radius. Takes a fn of t.',
    height: 'The rise along Y, centered on the origin. Takes a fn of t.',
    turns: 'How many times it wraps on the way up. Takes a fn of t.',
  },
  // the same sim, so the same knobs — plus the pour rate the chain form folds in
  fluid: {
    ...GLOBAL_KEY_DOCS.fluid,
    ink: "How much dye the chain pours in per second. Default 1. Same as .ink()'s amount.",
  },
  pairs: {
    within: 'Connection distance in world units — two points closer than this pair up. Default 1. Takes a fn of t, so the web can breathe.',
    max: 'At most this many pairs per point. Default 6. Keeps a dense clump from turning into a solid mass, and bounds the cost.',
  },
  link: {
    count: 'Geometry only: how many scatter points to connect. Default 200.',
    within: 'Connection distance in world units. Default 1. Takes a fn of t.',
    max: 'At most this many links per point. Default 6.',
    sample: 'Particles only: link each particle to the emitter surface instead of to other particles, read at this many points.',
    fill: 'Shade every trio of linked points as a triangle, at this alpha. true is 0.12. Default off.',
    lit: "Shade the lines and fills with the scene's lights instead of the flat color. Default false.",
    fade: 'Fade each line out as its ends drift apart, gone at within. Default true; false holds full opacity to the cutoff.',
    color: 'Line color. Defaults to the dot color on particles, #8899ff elsewhere.',
    opacity: 'Line opacity, 0..1, on top of the fade. Default 1.',
    blend: "'over' or 'add'. Particle links follow the system's blend.",
  },
  each: {
    mode: "How each mark lands on the picture — any .comp() mode. Default 'over'. 'add' lets overlapping marks build up, 'sum' counts them.",
    opacity: 'Opacity for every mark, 0..1, on top of whatever the mark sets itself. Default 1.',
  },
  box: {
    pad: "Grow the box on every side, in frame-height units — room for an outline to sit clear of the blob, or slack so a wobbling edge stays inside. Default 0.",
  },
  boxes: {
    pad: 'Grow every box on every side, in frame-height units. Default 0.',
  },
  push: {
    amount: 'How hard the map pushes, in frame-heights per second. Default 1. Takes a fn of t; it scales an [x, y] direction too.',
    mid: 'The value in the map that means no push. Default 0.5, so an unsigned map pushes both ways around its midpoint; 0 for a map that is already signed. Nothing to do with an [x, y] direction.',
  },
  velocity: {
    scale: 'Multiplies the field before it is centered on mid-grey. Default 2. Raise it to see a slow field, lower it when a fast one clips.',
  },
  curl: {
    scale: 'Multiplies the field before it is centered on mid-grey. Default 50 — spin is a difference across one cell, so it reads two orders below velocity.',
  },
  pressure: {
    scale: 'Multiplies the field before it is centered on mid-grey. Default 50, for the same reason curl is.',
  },
  noise: {
    amp: 'How far vertices move along their normals, in world units. Default 0.3.',
    period: 'Size of the bumps, in world units between peaks — not a fraction of the frame like every other period, so it scales with the shape. Default 2/3. A short period with a low amp is crinkle, the reverse is a slow wobble.',
    freq: 'Bumps per world unit — the reciprocal of period, whichever reads better. Default 1.5.',
    octaves: 'Layers of finer detail stacked on top, 1..8. Default 3.',
    lacunarity: 'How much finer each octave is than the last. Default 2.',
    gain: 'How much smaller each octave is than the last. Default 0.5. Low stays smooth, high goes crinkly.',
    speed: 'How fast the surface churns. Default 0.3; 0 freezes it.',
    seed: 'Picks a different field, for a different shape at the same settings.',
  },
  translate: {
    wrap: "What fills the space shifted in from off-frame: 'clamp' smears the edge pixel, 'repeat' tiles, 'mirror' reflects, 'transparent' leaves it empty — a cutout in a comp. Default 'clamp'.",
  },
  scale: {
    wrap: "What fills the space around a zoomed-out image: 'clamp' smears the edge pixel, 'repeat' tiles, 'mirror' reflects, 'transparent' leaves it empty — a cutout in a comp. Default 'clamp'. 'transparent' is what leaves .scale(0.5) as a small picture on nothing, ready to comp over another chain.",
  },
  rotate: {
    wrap: "What fills the corners swung in from off-frame: 'clamp' smears the edge pixel, 'repeat' tiles, 'mirror' reflects, 'transparent' leaves it empty — a cutout in a comp. Default 'clamp'.",
  },
  mirror: {
    axis: "'x' folds left onto right, 'y' bottom onto top, 'both' does each in turn. Default 'x'.",
    flip: 'Which half survives. Default false keeps the near side, true keeps the far one. A texture decides per pixel — anything above mid-gray takes the far side, so noise here shatters the two reflections together.',
  },
  kaleido: {
    rotate: 'Spins the fold pattern, in radians. Animate it for the turning-kaleidoscope look.',
  },
  radial: {
    log: 'Measures y in log-radius, so equal steps of y are equal ratios of radius and the space becomes periodic. .scroll(0, 0.1) inside it is then an endless zoom rather than a slide. Default false.',
    min: 'Under log, the inner radius as a fraction of the frame, and so the size of one period: 0.25 (default) means each zoom level is 4x the one inside it.',
  },
  polar: {
    inverse: 'false (default) unrolls the frame into angle × radius. true goes the other way, reading the image as angle × radius and wrapping it into a disc. Takes a fn of t, so it can flip mid-set.',
    log: 'Measures y in log-radius, so equal steps of y are equal ratios of radius. That makes the space periodic — one period is the factor 1 / min — so a translate along y is a zoom that never lands, and .scroll() along it repeats forever. Default false.',
    min: 'Under log, the inner radius as a fraction of the frame, and so the size of one period: 0.25 (default) means each zoom level is 4x the one inside it. Smaller nests fewer, larger levels; nothing inside it is sampled on the way out.',
  },
  edge: {
    strength: "Multiplies the detected edges. Default 1. Push to 3-4 before .threshold() for clean line art. In 'crisp' mode 1 means a full black-to-white step reads as white, so the same look wants roughly 4x the number.",
    spread: 'How many pixels apart the samples sit. Default 1; larger finds chunkier, softer edges.',
    mode: "'classic' (default) runs the kernel hot, so edges clip into thick stepped lines — the original look. 'crisp' normalizes it: thin antialiased lines that keep their falloff, at about a quarter the brightness.",
  },
  slope: {
    strength: 'Multiplies the gradient. Default 1.',
    spread: 'How many pixels apart the samples sit. Default 1.',
    mode: "'classic' (default) or 'crisp', which normalizes the gradient and switches to a Scharr kernel — truer direction on smooth sources, at a quarter the amplitude.",
  },
  normalMap: {
    strength: 'How steep the generated normals are. Default 1 — this is the relief depth.',
    spread: 'How many pixels apart the samples sit. Default 1; larger reads bigger, softer forms.',
    mode: "'classic' (default) or 'crisp', which normalizes the gradient and switches to a Scharr kernel — truer surface direction, at about a quarter the relief depth.",
  },
  levels: {
    contrast: 'Pushes values away from mid-gray. Default 1 unchanged, 0 flattens to gray, 2 is hard.',
    saturation: '0 grayscale, 1 unchanged, above 1 boosts. Default 1.',
    gamma: 'Default 1. Above 1 lifts the shadows, below 1 crushes them — the exponent is 1/gamma, which is the levels-control convention rather than the arithmetic one. .pow(v) is the same curve uninverted: .gamma(1 / v).',
    hue: 'Rotation in turns: 0.5 is the opposite color, 1 a full lap. Default 0.',
  },
  range: {
    from: 'The span the incoming signal actually covers, as [lo, hi]. Default [0, 1], which is what every shaper, rand() and audio() produce. Raw trigonometry and mouse() are [-1, 1].',
    to: 'The span to map onto, as [lo, hi] — the same thing the two positional arguments say, for when naming both ends reads better. Default [min, max].',
  },
  tint: {
    bg: "What black in the source becomes. Default '#000000', so a white-on-black image keeps its background and only the marks take the color. null leaves the dark end transparent — a mask becomes a colored cutout.",
  },
  kicks: {
    threshold: 'How far above its own moving average the level must jump to fire. Default 1.5 — lower catches more hits, higher only the hardest.',
    decay: 'How fast the 1 falls back to 0, per second. Default 6; lower leaves a longer tail to ride.',
    floor: 'Level below which nothing fires, so a quiet passage stays quiet. Default 0.05.',
  },
  transform: {
    translate: "[x, y] shift in UV, where 1 is a whole frame. Default [0, 0]. A texture here shifts each pixel by its own R and G; { map, amount, mid } scales and biases what it reads, which is all .displace() is.",
    scale: 'Zoom about the center. A number, or [x, y] to stretch. Default 1. Negative flips that axis, so [-1, 1] mirrors left to right. A texture here takes x from red and y from green, so a grayscale map zooms uniformly.',
    rotate: 'Rotation about the center, in radians. Default 0. A texture here turns each pixel by its own angle, so pixels slide around the center without moving toward or away from it.',
    wrap: "What fills the space moved in from off-frame: 'clamp', 'repeat', 'mirror' or 'transparent' (a cutout in a comp; 'black' is its old name and still works). Default 'clamp'.",
  },
  crop: {
    center: '[x, y] the window sits on, in UV, 0..1 from bottom-left. Default [0.5, 0.5]. Takes a fn of t, which slides the window over a picture that stays put — the pan of a locked-off camera.',
  },
  warp: {
    barrel: 'Bulges the image outward like a CRT face. Default 0; 0.2-0.4 reads as a screen, negative pinches inward.',
    twist: 'Rotates by distance from center, in radians — the middle holds still and the edges spiral. Default 0.',
    zoom: 'Scales about the center. Default 1.',
    center: '[x, y] the warp radiates from, in UV. Default [0.5, 0.5].',
    wrap: "What fills outside the frame: 'clamp', 'repeat', 'mirror' or 'transparent' (a cutout in a comp; 'black' is its old name and still works). Default 'transparent'.",
  },
  chroma: {
    radial: 'true splits along the radius like a real lens — none at the center, most at the corners. Default false, a uniform split in one direction.',
    angle: 'Direction of the split when it is not radial, in radians. Default 0, horizontal. A texture here swings the split around per pixel; .mul(6.28) on the map covers the full turn.',
    center: '[x, y] a radial split radiates from, in UV. Default [0.5, 0.5]. A texture takes x from red and y from green.',
  },
  threshold: {
    soft: 'Width of the ramp either side of the cut. Default 0, a hard black-and-white edge. A texture makes the cut hard in some places and feathered in others.',
  },
  chromaKey: {
    tolerance: 'Scales the match radius, which adapts to the key color. Default 1; 2 is looser, 0.5 tighter. Takes a fn of t.',
    soft: 'Width of the fade either side of the cut, as a fraction of the radius. Default 0.25; 0 is a hard edge.',
    spill: "How much of the key color's cast is removed from the pixels that survive — a green fringe goes gray. 0..1, default 0.5; 0 leaves color untouched.",
  },
  lumaKey: {
    soft: 'Width of the fade either side of the cut. Default 0.05; 0 is a hard edge.',
    invert: 'true keys out the bright side and keeps the dark. Takes a fn of t.',
  },
  ascii: {
    chars: "The vocabulary, ordered dark→bright — an unsorted set reads as noise. A set name, or any string of your own, which is what an unrecognized one is taken as. Default 'ascii' ( .:-=+*#%@).",
    cols: 'How many characters across the frame. Default 80.',
    rows: 'How many down. Default: whatever keeps each cell the same shape as the glyph in it, so the characters come out unstretched — set it yourself and they stretch to fit.',
    color: 'One ink color for every character — a green here is the terminal look. Default: none, so each cell takes the color of the image under it.',
    bg: 'What fills a cell where the glyph has no ink. Default black; null leaves it transparent, so only the characters land in a comp.',
    font: "Any CSS family name, 'google:Name', or a font URL. Default a monospace stack. A proportional face works, but every glyph is fitted to the widest in the set.",
    weight: 'CSS weight, 100..900. Default 400. Heavier ink brightens the whole image, since every glyph carries more of it.',
  },
  points: {
    size: 'Geometry: dot size in pixels, default 1, a fn of t. Texture: world height of the picture, default 4 (dot sets the pixel size there).',
    dot: 'Texture only: dot size in pixels. Default 1.',
    res: 'Texture only: dots across and down, or [across, down]. Default 256.',
    depth: 'Texture only: how far a white pixel lifts off the picture, in world units. Default 0.5; 0 keeps it flat.',
  },
  lines: {
    dir: "'x' draws the rows of the vertex grid (across a plane, around a sphere), 'y' the columns, 'xy' both. Default 'x'.",
    res: "Texture only: grid across and down, or [across, down]. Default [256, 64] for 'x', [64, 256] for 'y', 256 for 'xy'.",
    depth: 'Texture only: how far a white pixel lifts off the picture, in world units. Default 0.5; 0 keeps it flat.',
    size: 'Texture only: world height of the picture. Default 4; width follows the screen.',
  },
  wire: {
    res: 'Texture only: grid across and down, or [across, down]. Default 256.',
    depth: 'Texture only: how far a white pixel lifts off the picture, in world units. Default 0.5.',
    size: 'Texture only: world height of the picture. Default 4; width follows the screen.',
  },
  displace: {
    amount: 'How far it moves: on geometry, world units along the normal (default 0.2); on a texture, UV (default 0.1). Negative pulls the other way, and it takes a fn of t.',
    mid: 'The map value that means no movement. Default 0.5 for mid-gray maps; use 0 for a dark map you only want to push one way.',
    smooth: 'Geometry only: how wide each vertex reads the map, in vertex spacings. Default 1 turns a busy map into relief rather than grit; 0 reads a single point (jagged, sparkling), 2-4 is doughy and rounded. Takes a fn of t.',
  },
  instance: {
    blend: "Texture only: how copies land on each other. Default 'add', which drops a generator's opaque black background; 'over' stacks them instead and wants a stamp with transparency (bg: null). 'screen' and 'lighten' also drop black. The rest of .comp()'s modes need to read what's underneath, which one draw can't.",
  },
  comp: {
    mode: "Blend mode. Default 'over', which lands the layer only where its alpha says so — a transparent-bg generator comps as a sprite. 'under' puts it behind instead. add and screen are the ones that drop an opaque black background; luminosity/color are the non-separable pair that split luma from chroma.",
    opacity: 'How much of the blended result mixes back in, 0..1. Default 1. Takes a fn of t.',
    swap: "Feed the two images to the mode in the other order. Default false. Turns sub into layer-minus-chain, divide and burn likewise, and 'over' into 'under'.",
  },
  bloom: {
    threshold: 'How bright a pixel must be before it glows. Default 0.7. Drop it to bloom the whole image.',
    strength: 'How much glow is added back on top. Default 1.',
    radius: 'Blur radius of the glow, in texels. Default 1 — the pass runs at half resolution, so it spreads twice as far as the number suggests.',
    color: 'Tints the glow without touching the picture under it: a hex, a CSS name or [r, g, b]. Default white, which adds the highlight back as it is. A warm one is halation.',
  },
  lut: {
    mix: 'How far toward the graded picture, 0..1. Default 1. Takes a fn of t, or a texture to set it per pixel.',
  },
  grain: {
    size: 'Width of one grain, in the frame\u2019s own pixels. Default 1. Counted on that grid rather than on the drawing buffer, so quality() and a scaled recording leave the grain the size it looked.',
    mono: 'One value into all three channels. Default true, which is film. false rolls each channel separately: color speckle, which is video noise.',
  },
  delay: {
    scale: 'Fraction of the frame size the history is stored at — a ceiling: a delay too long to hold shrinks further rather than shortening. Default 1. Halving it quarters the memory per stored frame.',
    max: 'Only with a texture in the frames slot: how many frames back a full-white pixel reads. It sizes the history, so it is a plain number, not a fn of t. Default 30.',
  },
  dither: {
    mode: "The threshold pattern: 'bayer2' | 'bayer4' | 'bayer8' are ordered matrices, coarse to fine; 'random' is a per-pixel hash. Default 'bayer8'.",
    cells: 'Dither on this grid instead of the texel grid: the source reads at cell centers and the matrix indexes by cell, so the pattern is the visible pixels. One count makes square cells, [x, y] sets both. Use this rather than .pixellate() before it, which leaves the matrix churning at sub-cell scale — grain, not pattern.',
  },
  pixelsort: {
    threshold: 'Luma a pixel must exceed to join a sortable span; darker is a wall that stays put and bounds the sort. Default 0.35. Below the background’s luma the streaks run out across the background, and at 0 nothing walls at all. Unlit shadows tone-map to exactly 0 luma, so they wall at any positive threshold, however tiny. Takes a fn of t, or a texture to set it per pixel.',
    dir: "Which edge the bright pixels sort toward: 'up', 'down', 'left' or 'right', or an [x, y] vector for any angle — [1, 1] is down-right, and the components take fns of t, so the direction can swing live. Default 'down'.",
    length: 'Longest streak, in screen pixels — spans longer than this are cut into segments that sort separately, the cuts phased per column so they don’t line up. Default 0: uncapped, the span is the streak. Takes a fn of t.',
    size: 'Screen pixels per sorted chunk — the sort runs on a grid this coarse, hard-edged. Default 2. Chunkier is cheaper twice over: fewer pixels per pass, and shorter columns take a smaller sorting network. A plain number, not a fn of t.',
    jitter: 'Per-column scatter on the threshold — columns break their spans at different lumas, so streak ends go ragged instead of tracing the content’s outline. Default 0, the clean geometric sort; ~0.3 is distinctly ragged. Near a threshold of 0 or 1 the scatter turns binary — sliced, not ragged. Takes a fn of t.',
  },
  jpeg: {
    corrupt: 'Chance per 8×8 block of its coefficients being re-rolled into garbage — ringing static in exactly those blocks. 0..1, default 0; takes a fn of t.',
    seed: 'Re-deals which blocks corrupt. A fn of t makes the damage flicker; leave it and the same blocks stay broken. Default 0.',
  },
  flow: {
    gain: 'How much grey one texel of motion writes — output is 0.5 ± gain × texels. Default 1; what reads the map usually scales anyway (.displace amount).',
    blur: 'Regularizer radius, in texels of the coarse buffer. Motion is only measurable on edges; the blur spreads it across the surfaces between them. Default 4. 0 is the raw estimate.',
    scale: 'Fraction of the frame the flow is computed at. Default 0.25 — one step of the estimate only sees about a texel of motion, so coarser sees faster movement.',
  },
  feedback: {
    mode: "How last frame comes back in. Default 'add', which piles light up; 'over' stacks it in front, 'under' leaves it behind this frame's drawing.",
    swap: "Feed last frame and this one to the mode in the other order. Default false.",
    reset: 'Blanks the held frame on the rising edge of its value — trails cut to black and rebuild. A fn of t fires it from code (reset: t => t % 4 < 0.1 cuts every four seconds; a kick trigger cuts on the beat); true cuts once per run, a clean start on every ctrl+enter.',
  },
  field: {
    res: 'Readback size, pixels per side. Default 64 — plenty for a layout, cheap to read. The sampler interpolates between texels.',
  },
  shadow: {
    cast: 'This mesh casts shadows. On by default — { cast: false } for a ceiling that has to let light through, or a lamp that should not block itself.',
    receive: 'This mesh receives shadows. On by default; false keeps it lit no matter what is in front of the light.',
    map: 'Shadow map resolution in pixels. Default 2048, or 1024 for a point light, which renders six faces.',
    soft: 'Blur radius in texels. Default 0, a hard edge; around 8 is an overcast day.',
    strength: '0..1, how dark the shadow lands. Below 1 fakes bounced light filling it in.',
    bias: 'Nudges the depth compare, for acne that survives normalBias. Small values — 0.0001 is a lot.',
    normalBias: 'Offsets the compare along the surface normal. The first thing to reach for when surfaces self-stripe.',
    near: "Nearest distance the light's own shadow camera can see.",
    far: 'Furthest it can see. Anything beyond casts nothing, and a far much larger than the scene stripes flat surfaces with acne.',
    area: 'Directional only: half-width of the shadowed box around the pos→target axis. Too big spreads the texels thin, too small cuts the shadow off mid-floor.',
  },
  particles: {
    max: "Ceiling on the pool: how many particles may exist at once. Only needed to cap memory — set rate and life and the pool sizes itself. Default 10,000 when no rate is given; the hard ceiling is ~1M.",
    rate: 'Particles born per second. Default: whatever cycles the pool once per life. This is the density dial — rate × life is how many are alive at once.',
    life: 'Seconds each particle lives. A [min, max] pair varies it per particle, which reads far more natural than one exact age. Default 3.',
    speed: 'Starting speed, units/s. A [min, max] pair varies it per particle. Default 2.',
    spread: 'How far off dir a particle may aim: 0 keeps every one on it, 1 forgets it entirely — a full sphere. Default 0.25.',
    dir: "Which way particles leave: a vector, or 'out' — along the surface normal from a shape, toward the camera from a texture, any direction at all from a point. Default: 'out' from a shape or texture, [0, 1, 0] from a point.",
    size: 'Texture emitters: world height of the plane the image maps onto — width follows the screen. Default 4.',
    threshold: 'Texture emitters: how bright a pixel must be to give birth, 0–1. Darker pixels birth fewer particles; below this, none. Default 0.1.',
  },
  turbulence: {
    amp: 'Strength of the swirl, units/s². Default 1. Takes a fn of t — audio here is the classic move.',
    period: 'World units from one swirl to the next — bigger is broader weather. Default 2.',
    freq: 'Spatial frequency, 1/period — the other spelling, matching noise(). Default 0.5.',
    speed: 'How fast the field itself drifts, so the weather changes. Default 0.5.',
    seed: 'Different seeds give independent fields. Default 0.',
  },
  sqr: {
    width: 'How much of each cycle reads 1, 0..1. Default 0.5, a square wave; 0.1 is a click and 0.9 a gap. Takes a fn of t.',
  },
  attract: {
    strength: 'Pull in units/s² at distance 1, falling with the square of distance. Negative pushes away. Default 3.',
    radius: 'Softening floor: inside it the pull stops growing, so a close pass slingshots instead of exploding. Default 0.5.',
  },
};

for (const [docs, config] of [[GLOBAL_KEY_DOCS, GLOBAL_CONFIG], [METHOD_KEY_DOCS, METHOD_CONFIG]]) {
  for (const [call, keys] of Object.entries(docs)) {
    for (const [key, doc] of Object.entries(keys)) {
      const spec = config[call]?.get(key);
      if (spec) spec.doc = doc;
      else if (import.meta.env?.DEV) console.warn(`docs: ${call} has no config key "${key}" to document`);
    }
  }
}

// Config values that are themselves configs — `directional({ shadow: { ... } })`
// wants the light-option half of .shadow()'s signature.
export const NESTED_CONFIG = { shadow: METHOD_CONFIG.shadow, mark: markKeys() };

// text({ mark: { ... } }) — its own little config, documented on the keys
// rather than in the one line text()'s signature can spare for it.
function markKeys() {
  const keys = parseConfig(GLOBALS.text[0]).get('mark').hint;
  const map = parseConfig(keys);
  const docs = {
    mode: "The shape of a mark: 'box' (default) outlines it, 'fill' lays a block behind it, 'underline' rules under it, 'circle' rings it, 'dim' drops everything *not* marked to dim instead, 'none' draws no shape at all. An array stacks them: ['fill', 'underline'].",
    color: "The mark's own color — the box, the fill, the rule, the ring. Default: the text color.",
    on: "What the marked glyphs themselves are drawn in. Default: the text color, except under 'fill', where it's the background so the block reads as a highlighter. This is the knob for 'the lit atoms are yellow' with no shape at all: mode: 'none', on: '#ff0'.",
    weight: 'Stroke width for box, underline and circle, in ems. Default 0.06.',
    pad: 'How far a mark sits outside its characters, in ems. Default 0.08.',
    dim: "Under mode: 'dim', the alpha everything unmarked drops to. Default 0.25.",
  };
  for (const [k, doc] of Object.entries(docs)) {
    const spec = map.get(k);
    if (spec) spec.doc = doc;
    else if (import.meta.env?.DEV) console.warn(`docs: text({ mark }) has no key "${k}" to document`);
  }
  return map;
}

// A config key rendered like any other entry: `.material({ pbr })` over its
// line. `label` carries the leading dot for methods, so the two noise() calls
// don't produce the same header.
export function keyEntry(label, spec) {
  return [`${label}({ ${spec.key}${spec.hint ? `: ${spec.hint}` : ''} })`, spec.doc ?? ''];
}

// The signatures are load-bearing now, and a malformed one fails silently:
// completion just stops offering that call's keys. Say so while editing.
if (import.meta.env?.DEV) {
  for (const [table, config] of [[GLOBALS, GLOBAL_CONFIG], [METHODS, METHOD_CONFIG]]) {
    for (const [name, [detail]] of Object.entries(table)) {
      if (detail.includes('{') && !config[name]) console.warn(`docs: no config keys parsed from ${detail}`);
    }
    // every key gets a line of its own; the hover shows nothing without one
    for (const [call, keys] of Object.entries(config)) {
      for (const [key, spec] of keys) {
        if (!spec.doc) console.warn(`docs: ${call}({ ${key} }) has no description`);
      }
    }
  }
}

// --- chain kinds -----------------------------------------------------------
//
// Which chain a global starts, and which chains a method belongs to. Without
// this a `.` offers all 59 methods, so a geometry chain is asked to choose
// between `bandpass` and `kaleido` when nine verbs apply — the wrong question
// to put in front of someone mid-set. Kinds mirror the classes in api.js
// (GeoOp / LightOp / InstanceHandle), textures.js (TextureOp) and audio.js (Signal).

const names = (s) => s.trim().split(/\s+/);

const globalKinds = {
  geo: 'sphere box plane torus torusKnot cylinder capsule icosa model text3d',
  particle: 'particles',
  light: 'ambient directional point spot hemi',
  layout: 'layout',
  blobs: 'track',
  curvens: 'curve',
  bundle: 'data',
  segments: 'segments link',
  texture: 'scene depth input sketch constant ramp circle ring rect polygon checker video person videofile videoseq imagefile imageseq noise voronoi text fluid glsl',
  signal: 'beat audio audiofile band rand select sig T B mouse',
  feed: 'feed',
  midi: 'midi',
  gamepad: 'gamepad',
};

const methodKinds = {
  curve: 'tangent',
  curvens: 'circle line helix',
  geo: 'position rotation scale align shadow noise displace points lines wire instance material color sample normal scatter link particles render out',
  particle: 'force turbulence attract drag noise evolve size color opacity fade blend soft lit shadow position rotation scale read link render out',
  // the handle .evolve() gives its fn — what a life point can set
  evolve: 'size color opacity force',
  light: 'position target out',
  inst: 'position rotation scale align between color alpha tile hide material',
  // The bundle family: what every producer answers (count slots at pairs link
  // apply), plus the channels a data(), a .scatter() or a particles
  // .read() carries. A layout and a tracker are bundles too, with their own
  // vocabulary on top — see their kinds below.
  bundle: 'pos alpha normal vel age life count slots at apply pairs link',
  pairs: 'list tris count',
  segments: 'material blend position rotation scale render out',
  // the cursor a layout rule steers, and the structure it hands back
  cursor: 'span forward turn scale place branch rand depth size distance position',
  layout: 'filter grow along depth data size pos alpha count slots at apply pairs link',
  // what track() hands back: a slot's blob, read per slot
  blobs: 'pos vel size area width height angle id age has alpha max largest box boxes count slots at apply pairs link',
  // (.noise/.displace/.shadow/.out belong to the chain, not a copy — the handle
  // has them only to say so; offering them here would invite the mistake)
  texture: `mirror kaleido radial through polar edge slope normalMap levels add sub mul div pow contrast saturation gamma hue each
        posterize dither pixelsort jpeg pixellate ascii transform warp chroma translate rotate scale crop threshold chromaKey lumaKey invert
        remap lookup lut grain tint alpha displace comp blend mask glsl blur bloom delay feedback flow when scroll tile instance particles points lines wire out
        fluid ink push obstacle velocity curl pressure field marked`,
  signal: `add sub mul div pow range clamp round floor ceil abs gte lte counter select
           sin cos tri saw sqr beat hold kicks smooth lowpass highpass bandpass`,
  // what a midi()/gamepad() handle carries — signals, plus the two calls that
  // take a number. midikey is what .key(38) narrows to: the same key signals,
  // minus the device-wide ones.
  // what feed() hands back: the frame's two drawable parts, how much of it
  // is marked, and the two transforms that move the offsets with the text
  feed: 'text ranges marked slice invert',
  midi: 'cc key note vel gate touch bend',
  midikey: 'note vel gate touch',
  gamepad: 'lx ly rx ry lt rt btn',
};

export const GLOBAL_KIND = {};
for (const [kind, list] of Object.entries(globalKinds)) {
  for (const n of names(list)) GLOBAL_KIND[n] = kind;
}

export const METHOD_KINDS = {};
for (const [kind, list] of Object.entries(methodKinds)) {
  for (const n of names(list)) (METHOD_KINDS[n] ??= new Set()).add(kind);
}

// The badge a tooltip prints: what the thing you're looking at is. The name
// alone doesn't say — noise() is a texture and .noise() a deformer.
export const KIND_LABEL = {
  geo: 'geometry', particle: 'particles', evolve: 'particle', light: 'light',
  texture: 'texture', signal: 'signal', repeat: 'signal', midi: 'midi', midikey: 'midi',
  gamepad: 'gamepad', hand: 'hand', layout: 'layout', blobs: 'tracker', cursor: 'cursor', inst: 'copy',
  curve: 'curve', curvens: 'curve', bundle: 'bundle', pairs: 'pairs', segments: 'segments', feed: 'feed',
};

// The globals as a catalog, for a completion popup opened with nothing typed:
// 68 names in table order is a wall, the same names under seven headings is a
// menu. The sections run in the order to meet them; inside one the names are
// alphabetical, so a list you come back to keeps every name where you last
// found it.
export const GLOBAL_SECTIONS = [
  ['geometry', 'box capsule cylinder icosa model particles plane sphere text3d torus torusKnot'],
  ['textures', 'checker circle constant depth fluid imagefile imageseq input noise person polygon ramp rect ring scene sketch sky stack text video videofile videoseq voronoi'],
  ['signals', 'audio audiofile B band bands beat feed gamepad midi mouse rand restartMedia select sig T tempo'],
  ['structure', 'curve data layout link segments spread track'],
  ['lights', 'ambient directional hdri hemi point spot'],
  ['scene', 'bg camera fog hsl hsv param resolution'],
  ['escape hatches', 'bufferId Geometry glsl onFrame Signal Texture THREE'],
].map(([name, list]) => [name, names(list)]);

export const GLOBAL_SECTION = {};
for (const [name, list] of GLOBAL_SECTIONS) for (const n of list) GLOBAL_SECTION[n] = name;

// A global left out of the catalog is missing from the one list that claims to
// show everything, and nothing else would say so.
if (import.meta.env?.DEV) {
  for (const n of Object.keys(GLOBALS)) {
    if (!GLOBAL_SECTION[n]) console.warn(`docs: ${n} is in no catalog section`);
  }
  for (const n of Object.keys(GLOBAL_SECTION)) {
    if (!GLOBALS[n]) console.warn(`docs: the catalog lists ${n}, which no longer exists`);
  }
  // A body keyed by a kind the method never runs on is one no tooltip can
  // reach — a typo that shows as a missing paragraph rather than an error.
  for (const [table, kindOf] of [[GLOBALS, (n) => new Set([GLOBAL_KIND[n]])], [METHODS, (n) => METHOD_KINDS[n]]]) {
    for (const [name, [, info]] of Object.entries(table)) {
      if (typeof info === 'string') continue;
      for (const key of Object.keys(info)) {
        if (key === '*' || key === 'note') continue;
        for (const k of key.split(' ')) {
          if (!kindOf(name)?.has(k)) console.warn(`docs: ${name} has a body for '${k}', which it is never called on`);
        }
      }
    }
  }
}

// A callback parameter's kind, by the method that hands it over:
// .instance(n, x => …) gives an instance handle, .tile/.mask/.when a texture.
// An array is one kind per position, for a callback whose parameters differ.
export const CALLBACK_KIND = {
  instance: 'inst',
  layout: 'cursor', branch: 'cursor',
  evolve: 'evolve',
  tile: 'texture', mask: 'texture', when: 'texture', comp: 'texture', radial: 'texture', through: 'texture',
  scroll: ['texture', 'signal', 'signal'],
  displace: 'texture', remap: 'texture', lookup: 'texture', feedback: 'texture',
};

// --- rendering -------------------------------------------------------------
//
// Shared by the ctrl+hover tooltip, the completion popup's info panel and the
// reference table. An entry is what the call *is* — one paragraph of it — and
// what you can pass; what each key does belongs on the key, which is a hover
// of its own. So the shape here is: signature, then the opening paragraph at
// full size, then anything else dimmed underneath.
//
// Markup is one line per block, `- ` for a bullet. An entry that uses it says
// where its own breaks go; one that doesn't gets its first sentence promoted,
// which is how the short entries have always read.

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text) n.textContent = text;
  return n;
};

// A sentence ends in [.!?] + space with two non-abbreviation characters in
// front of it, so neither "e.g. " nor the ".obj/.fbx " and ".position/.rotation/"
// the prose is full of reads as one. Failing that, the clause before an
// em-dash — the other way these entries open.
const SENTENCE = /^([\s\S]{0,150}?[^.\s][a-z0-9)\]][.!?])\s+/;
const DASH = /^([\s\S]{0,150}?)\s+—\s+/;

function splitLead(info) {
  const m = SENTENCE.exec(info) ?? DASH.exec(info);
  return m ? [m[1], info.slice(m[0].length)] : [info, ''];
}

const blocksOf = (info) =>
  info.includes('\n') ? info.split('\n').filter(Boolean) : splitLead(info).filter(Boolean);

// An entry's body is a string, or one body per chain kind — `.alpha` on a
// texture and `.alpha` on a copy are different calls wearing one name, and the
// popup knows which receiver you're on (complete.js reads the chain). Narrowed
// to a kind you get that body alone; with no kind to go on (the reference
// table, a name typed on its own) you get all of them, each labelled. '*' is
// the part that holds whatever the receiver.
export function bodyFor(info, kind) {
  if (typeof info === 'string') return info;
  const { note, '*': dflt, ...rest } = info;
  // a key is one kind or several sharing a body — 'particle evolve' is the
  // same call on the system and on the life handle
  const groups = Object.entries(rest).map(([k, text]) => [k.split(' '), text]);
  const out = [];
  const own = kind && groups.find(([ks]) => ks.includes(kind));
  if (own) out.push(own[1]);
  else if (kind && dflt) out.push(dflt);
  else {
    // no receiver to go on: every body, each labelled, the way the entries
    // used to read as one paragraph per kind
    for (const [ks, text] of groups) out.push(`${KIND_LABEL[ks[0]] ?? ks[0]}: ${text}`);
    if (dflt) out.push(dflt);
  }
  if (note) out.push(note);
  return out.join('\n');
}

// blocks after the lead, as elements
function tailNodes(blocks) {
  const out = [];
  for (const block of blocks) {
    const bullet = block.startsWith('- ');
    if (!bullet) { out.push(el('p', null, block)); continue; }
    if (out.at(-1)?.tagName !== 'UL') out.push(el('ul', 'td-doc-list'));
    out.at(-1).append(el('li', null, block.slice(2)));
  }
  return out;
}

export function docDom([sig, info], kind) {
  const dom = el('div', 'td-doc');
  // the kind rides on the signature line: which chain this belongs to is the
  // one thing the signature never says
  const head = el('div', 'td-doc-sig');
  head.append(el('span', null, sig));
  if (KIND_LABEL[kind]) head.append(el('span', 'td-doc-kind', KIND_LABEL[kind]));
  dom.append(head);
  const [lead, ...rest] = blocksOf(bodyFor(info, kind));
  dom.append(el('div', 'td-doc-lead', lead));
  const tail = tailNodes(rest);
  if (tail.length) {
    const more = el('div', 'td-doc-more');
    more.append(...tail);
    dom.append(more);
  }
  return dom;
}

// The same body without the signature, for the reference table's own layout.
export function infoNodes(info) {
  const [lead, ...rest] = blocksOf(bodyFor(info));
  return [el('p', null, lead), ...tailNodes(rest)];
}

// Every key, grouped, for the reference page — which scrolls, so it can afford
// the full list where the tooltip only names the ones the signature left out.
export function configSections(keys) {
  if (!keys) return null;
  const sections = new Map();
  for (const { key, section } of keys.values()) {
    if (!section) return null;
    if (!sections.has(section)) sections.set(section, []);
    sections.get(section).push(key);
  }
  return sections.size > 1 ? [...sections] : null;
}

// The ctrl+hover tooltip itself lives in complete.js, which knows how to tell a
// call from a config key sitting inside one.
