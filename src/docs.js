import { MATERIAL_GROUPS, MATERIAL_DOCS } from './materials.js';
import { BLEND_MODE_NAMES, ASCII_SET_NAMES, WRAP_MODE_NAMES } from './textures.js';

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

  camera: ['camera(x, y, z, [tx, ty, tz])', 'Static numbers: place camera, orbit stays live. Any fn of t: sketch drives the camera, orbit disabled.'],
  bg: ['bg(color)', 'Background color, behind the 3D scene and behind the texture stack both — anything a chain leaves transparent lands on it. Hex, CSS name, or [r, g, b] 0..1; a fn of t (or a channel that is one) repaints it every frame. bg(null) leaves the texture stack on black.'],
  resolution: ['resolution(width, height) | resolution({ width, height })', "Pin the render to an exact pixel size instead of the browser window — the main window letterboxes it, and the projector window (F1) takes the same aspect ratio. A single number is a square; drop the call to fill the window again."],
  fog: ['fog({ color, near, far })', 'Scene fog: geometry fades to color between near and far. Positional fog(color, near, far) also works.'],

  scene: ['scene()', 'Texture source: the lit 3D render of everything sent to a naked .out(), as a texture (tone-mapped display space).'],
  depth: ['depth({ near, far }) | depth({ focus, range })', "Texture source: the same 3D render as scene(), as a grayscale distance map — black near, white far. With { focus, range } it measures distance from a focal plane instead — a depth-of-field mask."],
  input: ['input(name?)', "Texture source: with no name, last frame's display output. With a name, whatever .out(name) published — a texture bus, or a geometry layer rendered on nothing (real alpha, so it comps 'over' as a sprite)."],
  constant: ['constant(color)', "Texture generator: one flat color, whole frame. Any color form, or a fn of t; null, [r, g, b, a] and '#rrggbbaa' carry transparency, like every texture color slot."],
  ramp: ["ramp({ type: 'linear'|'radial'|'angular', a, b, angle, phase, period, freq, shape: 'saw'|'tri'|'sin'|'sqr' })", "Texture generator: a two-color sweep — straight across, out from the center, or around it. period/freq repeat it into bands, shape waveshapes each cycle, phase scrolls."],
  circle: ['circle({ radius, thickness, soft, center, color, bg })', 'Texture generator: a hard-edged disc (soft feathers it), or a ring once thickness cuts the middle out. radius, thickness, soft and center take fns of t, or textures.'],
  ring: ['ring({ inner, outer, soft, center, color, bg })', "Texture generator: an annulus addressed by its two edges — circle() for when the hole is the point. inner and outer take fns of t; everything else is circle()'s."],
  video: ['video(name?)', "Texture generator: live camera — permission prompt on first use, black until the stream is live. No name = the default camera (the console lists sources); video('front') / video('back') ask for a facing; any other name matches a camera label by substring."],
  person: ["person(name?, { part: 'hair'|'face'|'body'|'skin'|'clothes'|'other', smooth })", "Texture generator: a person mask from the live camera — white where a person is, black elsewhere. name picks a camera exactly like video()'s: no name = the default camera, 'front'/'back' = a facing, anything else matches a camera label by substring. part masks one region instead: 'hair', 'face', 'body', 'skin', 'clothes' or 'other'. First use fetches the model (~12 MB, +16 MB with a part) and prompts for camera permission; black until ready."],
  videofile: ["videofile(name?, { speed, loop, mute, restart, phase, jump })", "Texture generator: an imported video file, looping. Empty call = picker; drag a file in to import; name matches by substring. ctrl+r or restartMedia() rewinds; phase scrubs it by hand, jump throws it around while it plays."],
  imagefile: ["imagefile(name?)", 'Texture generator: an imported image file (drag one in, or empty call = picker). An array delegates to imageseq().'],
  imageseq: ["imageseq(['a.png', ...], index?)", 'Texture generator: several imported images with a signal picking the current one (floored, wrapped). Default index: one per second. Empty call = multi-file picker.'],
  noise: ['noise({ period, freq, octaves, lacunarity, gain, speed, seed, channels, a, b })', 'Texture generator: animated fbm simplex noise, shading from a to b. Output is normalized — the octave keys change its texture, not its level.'],
  voronoi: ["voronoi({ period, freq, speed, blend, seed, mode: 'cells'|'distance'|'edges', a, b })", "Texture generator: drifting scattered points, every pixel colored by the nearest one. mode picks flat cells, distance shading, or the seams; all three shade from a to b."],
  text: ["text('hi', { size, color, bg, pos, font, weight, align })", "Texture generator: canvas-rendered text — on a solid background, or on nothing with bg: null, ready to comp over anything. Content can be a fn of t; \\n for multiline."],
  text3d: ["text3d('hi', { size, depth, bevel, res, font, weight, center })", "Geometry op: 3D extruded text. Renders in helvetiker until the font you named arrives."],

  particles: ['particles({ max, rate, life, speed, spread, dir, pos })', "A GPU particle system emitting from a point — .particles() on a shape emits from its surface, on a texture from its bright pixels. Chain forces (.force .turbulence .attract .drag), looks (.size .color .opacity .fade .blend .evolve), then .out().\nThe pool sizes itself from rate × life, and the swarm survives re-runs — tweak a force and the particles keep flying."],

  beat: ['beat(perBar = 4)', 'Tempo-synced phase, counting up: perBar cycles per bar of four beats (tempo in the sidebar), so the number is the note value — beat(4) is quarter notes, beat(16) sixteenths, beat(1) once a bar.\nWhole part = which cycle, fraction = where inside it, the way sig() counts seconds. Shapers take the fraction (.sin() .tri() .sqr(), and .saw() for the plain 0..1 ramp); anything that floors takes the count, so beat(1).select([...]) steps a list on the downbeat.'],
  audio: ['audio(chan? | name?, chan?)', "Audio input level as a signal, usable in any parameter; the first use starts capture. audio() is the mono mix, audio(2) a channel by index, audio('scarlett') a device by name (substring), audio('scarlett', 2) a channel of it."],
  audiofile: ["audiofile(name?, { volume, speed, loop, restart, chan })", 'An imported audio file, played out loud and returning its level as a signal like audio(). Empty call = picker; drag a file in to import; ctrl+r or restartMedia() rewinds.'],
  restartMedia: ['restartMedia(name?)', "Rewind imported media files to 0 — all of them, or by name (substring). In a sketch it runs on every execute. ctrl+r rewinds media too, and starts a sketch's particles, delays, trails and counters over with it."],
  rand: ['rand({ freq: 1, seed: 0 })', 'Smooth random signal: deterministic value noise of t, 0..1. Positional rand(freq, seed) also works.'],
  select: ['select([a, b, c], index?)', "Pick from a list by index (floored, wrapped) — .select() as a call of its own, and the only form that takes texture chains: values give a signal, chains give a texture showing one of them (switched like .when(), so only the chosen one renders).\nThe index is any signal, so it carries the timing: beat(1) steps per bar, rand().mul(3).beat() lands somewhere new each beat. Default: one item per second."],
  sig: ['sig(fn?)', "Lift any fn of t into a chainable signal: sig(t => Math.sin(t)). Bare sig() is t itself."],
  T: ['T', "Bare sig() under a shorter name: t in seconds, with the signal methods on it. A value, not a call — no parentheses."],
  mouse: ["mouse('x'|'y'|'down')", "Pointer position as a signal, -1..1 with 0 at the center and y up. Default axis is x; mouse('down') is a 1/0 gate while a button is held."],

  onFrame: ['onFrame((t, dt) => ...)', 'Register a raw per-frame callback.'],
  THREE: ['THREE', 'The full three.js namespace, for anything the API does not cover.'],
  Texture: ['Texture', "The type every texture chain is one of. Adding to its prototype adds an op to every chain: Texture.prototype.punch = function (n) { return this.pow(n).contrast(2) } — a function, not an arrow, so `this` is the chain. Also what x instanceof Texture asks."],
  Geometry: ['Geometry', 'The type every geometry chain is one of — the sphere()/box() counterpart of Texture. See Texture.'],
  bufferId: ['bufferId()', "A bus name nothing else will take, one per call site: with b = bufferId(), input(b) / .out(b) is a feedback loop that can't collide. The same call site gets the same id every re-run, so the loop keeps its contents. Mostly you want .feedback(), which is this plus the wiring."],
};

export const METHODS = {
  position: ['.position(x, y, z) | .position(v)', 'Position. Each component is a number or fn of t; one vector argument ([x,y,z] or anything with x/y/z) also works.\nShort form: .pos().'],
  rotation: ['.rotation(x, y, z) | .rotation(v)', 'Geometry: rotation in radians. Each component is a number or fn of t, or one vector in the first slot.\nShort form: .rot().'],
  scale: ['.scale(x, y?, z?) | .scale(x, y?, { wrap })', 'Geometry: scale, one number = uniform, one vector = per-axis · Texture: zoom around center, one number = uniform, .scale(x, y) per-axis.'],
  rotate: ['.rotate(v, { wrap })', 'Texture: rotate the image around center, in radians. v takes a fn of t, or a texture to turn each pixel by its own angle.\nShort form: .rot().'],
  translate: ['.translate(x, y, { wrap }) | .translate(map, { wrap })', "Texture: shift the image in UV space (1 = full frame); a map in the first slot shifts each pixel by its own R and G. Short form: .trans()."],
  noise: ['.noise({ amp, period, freq, octaves, lacunarity, gain, speed, seed })', 'GPU fbm displacement along vertex normals, with the normals recomputed so lighting stays correct. It can only move vertices the shape already has — raise its res if nothing happens.'],
  instance: ['.instance(count, (x, i, n, t) => x.position(...))', 'Render as one InstancedMesh. The layout fn gets each copy as x and transforms it with .position/.rotation/.scale/.color; it runs every frame, so instances animate. i = copy index, n = count.'],
  align: ['.align(v)', "Aim the shape's +Y axis along a direction vector. .rotation() still applies, in the shape's own frame before the aim; components take fns of t."],
  sample: ['.sample(i)', "The i-th point of a fixed scatter over this shape's surface, as {x, y, z}. Points are stable across re-runs; the shape's whole chain applies, and it needn't be in the scene."],
  normal: ['.normal(i)', 'The surface normal at .sample(i), as {x, y, z} — which way the shape faces there.'],
  material: ['.material({ color, roughness, metalness, emissive, opacity, transmission, clearcoat, iridescence, pbr, map, normalMap, repeat, flatShading, wireframe, doubleSide })', "How the surface takes light: standard PBR, upgraded to three's physical material the moment you name a glass or coating key. Empty .material() opens the Poly Haven browser. Every value takes a fn of t; every map slot takes an imported image by name, or a live texture chain."],
  color: ['.color(c) | .color(birth, death)', "Shorthand for .material({ color }). Four forms, everywhere a color is taken: '#4fd1c5', a CSS name, 0x4fd1c5, or [r, g, b] 0..1 — the whole color, or each channel of the array, may be a fn of t or a signal.\nOn particles a second color fades each particle from birth to death."],
  target: ['.target(x, y, z) | .target(v)', 'Light: where a directional() or spot() points (the origin without one). Components take fns of t, so the beam can sweep, and one vector argument works like .position(v). Point and hemisphere lights have no direction and reject it.'],
  shadow: ['.shadow(false | { cast, receive })  ·  light option: shadow: true | { map, soft, strength, bias, normalBias, near, far, area }', "Geometry casts and receives by default — .shadow(false) is the opt-out, or one side via { cast, receive }. On a light, shadow: true turns casting on and the same object tunes it. Glass (transmission) and blended (opacity < 1) surfaces don't cast unless .shadow(true) insists.\nParticles: .shadow() makes the swarm cast — off by default, since it's a depth pass per shadow light. Receiving is .lit()'s side."],
  out: [".out(name?)", "Naked: geometry/light joins the visible scene; a texture chain becomes the display output — several naked .out()s stack in code order, later over earlier, showing through where a chain is transparent. With a name, publishes for input('name') instead — a texture bus, a geometry render layer, or a light lighting only that layer.\nAn op is mutable, so two .out() calls share one op — use .instance() for repeats, or wrap the shape in a function for copies that differ."],

  particles: ['.particles({ max, rate, life, speed, spread, dir, size, threshold })', "The source as a particle emitter. On a shape: births scattered over its surface, leaving along the normals — the shape needn't be drawn, its transform applies live, and its .noise() carries through, so births land on the deformed surface. On a texture: births on the bright pixels of the live image, mapped onto a world plane, each particle keeping the color of the pixel it was born from (.color() overrides)."],
  force: ['.force(x, y, z)', 'Particles: a constant acceleration in world units/s² — .force(0, -2, 0) is gravity, .force(1, 0, 0) a crosswind. Components take fns of t; several .force() calls sum.'],
  turbulence: ['.turbulence({ amp, period, freq, speed, seed })', 'Particles: a curl-noise force field — the swirling, smokey drift. Divergence-free, so the swirl stirs the swarm without bunching it into clumps; several calls layer fields at different scales.'],
  attract: ['.attract([x, y, z], { strength, radius })', 'Particles: pull toward a point with inverse-square falloff — negative strength repels. Position components take fns of t, so the point can orbit, or follow mouse().'],
  drag: ['.drag(v = 1)', 'Particles: exponential velocity damping — higher settles the swarm sooner. Takes a fn of t.'],
  size: ['.size(a, b?)', 'Particles: point size in world units, shrinking with distance — one value, or birth → death. Where a number goes, a [min, max] pair scatters it per particle. Default 0.05.'],
  opacity: ['.opacity(a, b?)', 'Particles: transparency 0..1 — one value, or birth → death. On top of the .fade() ramps; takes fns of t.'],
  fade: ['.fade(in, out) | .fade(false)', "Particles: fade each particle in when it's born and out before it dies, so they don't blink into existence. The numbers are how long each fade takes, as fractions of the lifespan — defaults 0.1 and 0.3. false turns both off."],
  blend: [".blend('over' | 'add' | 'solid')", "Particles: how the dots land on the scene. 'over' is ordinary transparency; 'add' sums light — the glow-swarm look, brightest where particles pile up. 'solid' is opaque cutout dots that write depth and occlude each other — what a dense .lit() swarm needs, or the visible dots are a depth-scrambled mix instead of the lit skin. Solid dots pop in and out rather than fade, and depth() sees them."],
  soft: ['.soft(v)', 'Particles: edge softness of each dot, 0 (hard disc) to 1 (pure falloff). Default 0.5. Takes a fn of t.'],
  lit: ['.lit(amount = 1)', "Particles: take the scene's light — each dot tinted by the color, falloff and cone of the lights, and darkened inside their shadows. A dot has no facing, so what shows is color, distance and shadow. amount 0..1 mixes flat color → fully lit; takes a fn of t."],
  evolve: ['.evolve((p, life, t) => p.size(...).color(...).force(...))', "Particles: looks and forces across each particle's life. life runs 0 (birth) to 1 (death); whatever the fn sets on p (.size/.color/.opacity/.force) applies at that point, starting from the chain's own settings.\nSampled across life each frame rather than run per particle — so it sees life and t, never one particle's position."],

  mirror: [".mirror({ axis: 'x'|'y'|'both', flip })", 'Texture: reflect one half of the image onto the other. A texture in flip chooses which half survives per pixel, so both reflections come back interleaved by the map.'],
  kaleido: ['.kaleido(sides, { rotate })', 'Texture: polar kaleidoscope fold. Both keys take a fn of t, or a texture for a value that varies across the frame.'],
  radial: ['.radial(s => ...)', "Texture: run the fn in polar space — x is the angle around the center, y the distance from it — and come back. x wraps at the seam."],
  polar: ['.polar({ inverse })', "Texture: unroll the frame into angle × radius. inverse: true goes the other way, reading the image as angle × radius and wrapping it into a disc."],
  edge: ['.edge({ strength, spread })', 'Texture: Sobel edge magnitude (grayscale). Lines on nothing — the gaps are transparent, so edges comp without plating what they sit on.'],
  slope: ['.slope({ strength, spread })', 'Texture: neighbor-difference gradient, centered on 0.5, in RG.'],
  normalMap: ['.normalMap({ strength, spread })', 'Texture: tangent-space normal map from luma height.'],
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
  sin: ['.sin()', 'Signal: sine shape of the value-as-phase (0..1 out, one cycle per whole unit).'],
  tri: ['.tri()', 'Signal: triangle shape of the value-as-phase (0..1 out).'],
  saw: ['.saw()', 'Signal: fractional part of the value — a ramp per cycle.'],
  sqr: ['.sqr(width = 0.5)', 'Signal: 1 while the phase is below width, else 0 — square LFO / rhythmic gate.'],
  beat: ['.beat(perBar = 4)', 'Signal: tempo-synced sample-and-hold — freezes a new value of the signal perBar times a bar, on the same grid as beat().'],
  hold: ['.hold(trigger, threshold = 0.5)', 'Signal: sample-and-hold driven by another signal — freezes the current value each time trigger crosses up through threshold.'],
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
  pixellate: ['.pixellate(x, y?)', 'Texture: quantize position into cells (square cells if y omitted). Either count takes a texture, so the cells can be coarse in one part of the frame and fine in another.'],
  ascii: ['.ascii({ chars, cols, rows, color, bg, font, weight })', "Texture: redraw the image as a grid of characters, each cell taking the glyph whose ink matches its brightness. chars is a set name ('ascii', 'dense', 'blocks', ...) or any string of your own, dark→bright. Cells keep the image's color until you name one."],
  transform: [".transform({ translate: [x,y], scale, rotate, wrap: 'clamp'|'repeat'|'mirror'|'transparent' })", "Texture: UV-space transform. Shorthands: .translate(x, y), .rotate(v), .scale(v). Each key takes a texture to go per-pixel; { map, amount, mid } scales and biases what it reads."],
  crop: ['.crop(w, h?, { center })', "Texture: keep the middle w×h of the frame and drop the rest to transparent black — nothing is resampled, the frame closes in, and in a comp the surround is a cutout. Sizes above 1 are pixels of the frame's grid, 0..1 a fraction of the frame; h defaults to w. Sizes and center take fns of t."],
  warp: [".warp({ barrel, twist, zoom, center, wrap })", "Texture: radial UV warp — the CRT/fisheye lens. Radius is 1 at the frame corner, so barrel: 0.3 pulls the corners in by 30%. All params take fns of t, or textures to vary across the frame."],
  chroma: ['.chroma(amount, { radial, angle, center })', "Texture: chromatic aberration — samples R and B at opposite UV offsets, G at center. amount is the split at the frame edge: 0.002-0.01 is subtle, more is glitch. amount, angle and center take fns of t, or textures."],
  mask: ['.mask(mask, fn?)', 'Texture: without fn, multiply by the mask\'s luma (cutout). With fn, apply it only where the mask is bright. Mask and fn both accept fn-of-chain.'],
  threshold: ['.threshold(level, { soft })', 'Texture: luma threshold to a black/white mask. Both keys take a texture: a per-pixel level cuts the image against another image rather than against one number.'],
  chromaKey: ['.chromaKey(color, { tolerance, soft, spill })', "Texture: make pixels near color transparent, leaving the rest as a cutout. The match radius adapts to the key color, so a green screen's lit and shadowed parts key together; tolerance scales it. All args take fns of t."],
  lumaKey: ['.lumaKey(level, { soft, invert })', 'Texture: make pixels darker than level transparent, leaving the bright part as a cutout; invert keys out the bright side instead. level takes a fn of t.'],
  invert: ['.invert()', 'Texture: invert colors.'],
  remap: ['.remap(map)', "Texture: absolute UV lookup — sample this chain at the map's RG coordinates. Map can be a fn of the chain so far."],
  lookup: ['.lookup(ramp)', "Texture: recolor by luma — each pixel's luminance indexes the ramp left-to-right. Ramp can be a fn of the chain so far."],
  displace: ['.displace(map, { amount, mid, smooth })', "Geometry: move each vertex along its normal by the map's brightness, normals rebuilt so the relief takes light. It only moves vertices the shape already has — raise res if nothing happens; calls stack.\nTexture: push each pixel sideways by the map's R and G. The map is an imported image by name or a texture chain; positional .displace(map, amount) works on either."],
  comp: [".comp(layer, { mode, opacity, swap })", "Texture: composite layer over this chain. The layer's alpha gates it per pixel — 'over' is true source-over, so a transparent-bg shape lands only where it's drawn. layer may be a fn of the chain so far. Positional .comp(layer, mode, opacity) also works.\nModes: over under add sub mult screen overlay hardLight softLight darken lighten difference exclusion dodge burn divide luminosity color."],
  alpha: ['.alpha(v)', "Texture: scale the image's alpha — 1 leaves it, 0 is fully transparent, the color dimming with it (premultiplied). A texture in place of v fades per pixel by its luma. Transparency shows wherever the chain is comped or stacked; the display itself sits on black."],
  blur: ['.blur(radius)', 'Texture: separable gaussian blur, radius in texels. An [x, y] radius blurs per axis — .blur([8, 0]) smears horizontally only; an axis at 0 skips its pass.'],
  bloom: ['.bloom({ threshold, strength, radius })', 'Texture: brightpass + half-res gaussian glow.'],
  delay: ['.delay(frames, { scale })', "Texture: the chain as it was n frames ago. frames takes a fn of t; history survives a re-run and costs memory per frame — { scale } trades resolution for it."],
  feedback: ['.feedback(amount, prev => chain, { mode, swap })', "Texture: comp this point's own last frame back over the chain — trails, echoes, video feedback. amount is how much of it returns (a fn of t works); the fn treats last frame on its way round, like p => p.rotate(0.02). Default mode is 'add'; 'under' leaves the trail behind whatever is drawn this frame. A bare mode name stands in for the options in either slot — .feedback(0.9, 'under'). Contents survive a re-run."],
  tile: ['.tile(nx, ny, (src, i, x, y) => variant)', 'Texture: tile nx×ny with a per-cell chain. fn may return src, a treatment of it, or any texture; identical variants dedupe, each distinct one renders its own pass. x left→right, y bottom→top, i = y*nx + x.'],
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
      const key = (colon < 0 ? part : part.slice(0, colon)).trim();
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

// ...so the tooltip owes you the other thirty. Third slot of an entry: named
// groups listed under the prose, derived from the same set that rejects a typo
// rather than typed out again beside it.
const inSignature = new Set(METHODS.material[0].match(/\w+/g));
METHODS.material[2] = MATERIAL_GROUPS
  .map(([section, keys]) => [section, keys.filter((k) => !inSignature.has(k))])
  .filter(([, keys]) => keys.length);

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
    res: 'Grid subdivisions per side. Default 128 — this is the vertex budget .noise() turns into terrain.',
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
    shape: "Waveshape of each period, the same four signals have: 'saw' (default — plain ramp, hard seam), 'tri' (seamless, what soft stripes want), 'sin' (smoother still), 'sqr' (hard bands).",
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
  person: {
    part: "One region instead of the whole person: 'hair', 'face', 'body', 'skin' (face + body), 'clothes' or 'other' (accessories). Uses a larger model, fetched on first use.",
    smooth: 'How much of the previous frame each new mask keeps, 0..0.95 — steadies flicker at the cost of a trailing edge. Default 0.4; 0 is the model raw. Takes a fn of t.',
  },
  videofile: {
    speed: 'Playback rate: 1 normal, 0.5 half, 0 freezes the frame. Takes a fn of t. Rates past 16 clamp; negative freezes, since no browser plays a video backwards.',
    loop: 'Start over at the end. Default true.',
    mute: 'Default true. false lets the file\'s own audio play out loud.',
    restart: 'Rewinds whenever this crosses 0.5 upward — restart: beat(1).sqr(0.05) retriggers every bar.',
    phase: 'Where in the clip to sit: 0 the start, 1 the end. Setting it stops playback and hands the position to the signal, so phase: rand().beat(4) jumps around each beat. Wraps while looping, and is silent on its own — add jump to keep the sound.',
    jump: 'Seeks to phase whenever this crosses 0.5 upward, then plays on from there. Unlike phase alone it leaves the clip running, so mute: false stays audible: { mute: false, phase: rand(), jump: beat(4).sqr(0.05) } re-cues picture and sound every beat.',
  },
  noise: {
    period: "How much of the frame one blob of noise spans. Default 0.25, four across — 0.5 is big soft shapes, 0.03 is fine grain. The useful range lives in 0..1 like ramp's, so a bare signal drops in: period: audio() churns the grain with the level.",
    freq: 'The same number said the other way: how many blobs span the frame, so freq: 4 is period: 0.25. Reach for whichever avoids a fraction — a period reads better near 1, a frequency better in the hundreds. Naming both is period.',
    octaves: 'Layers of finer detail stacked on top, 1..8. Default 3.',
    lacunarity: 'How much finer each octave is than the last. Default 2, meaning twice.',
    gain: 'How much quieter each octave is than the last. Default 0.5. Near 0 stays smooth and cloudy, near 1 goes rough and grainy.',
    speed: 'How fast the field churns. Default 0.3; 0 freezes it into a still.',
    seed: 'Picks a different field of the same character. Reach for this when the shape is wrong but the settings are right.',
    channels: '1 for grayscale, 2-4 for independent fields in R/G/B/A. Default 1. Feed channels: 2 to .displace() so it wobbles both ways instead of along the diagonal.',
    a: 'Color the low end shades to. Default black; null shades from transparent, so the clouds float over whatever is under the comp.',
    b: 'Color the high end shades to. Default white; null shades to transparent.',
  },
  voronoi: {
    period: 'How much of the frame one cell spans. Default 1/6 — 0.5 is a few big plates, 0.025 is fine crazing. Same 0..1 range every period key has.',
    freq: 'How many cells span the frame — the reciprocal of period, and usually the easier of the two here, since cells are things you can count. Default 6: 2 is a few big plates, 40 is fine crazing. scale is the old name for this key and still works.',
    speed: 'How fast the points drift inside their cells. Default 0.3; 0 freezes the pattern into a still.',
    blend: "How far past its own cell a pixel listens, in cell widths. Default 0 — hard edges. Raising it melts neighboring cells into each other ('cells'), rounds the wells ('distance') and fattens the seams ('edges'). A texture here makes the pattern crisp in some places and molten in others.",
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
    align: "'center', 'left' or 'right'. Default 'center'.",
  },
  text3d: {
    size: 'Cap height in world units. Default 1.',
    depth: 'How far the letters extrude along Z. Default 0.25.',
    bevel: 'Rounding on the front edge. Default 0.02; 0 gives a hard flat extrude.',
    res: 'Curve segments per glyph. Default 8 — raise it for large smooth type.',
    font: "A font name, 'google:Name', or a .ttf/.otf/.typeface.json URL; renders in helvetiker until the real one arrives. A bare name tries installed fonts (Chrome/Edge, one-time prompt), then Google Fonts; the seven common system faces have stand-ins that work in any browser.",
    weight: "'bold' selects the bold built-in when no font is named.",
    center: 'Center the text on the origin. Default true.',
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
};

const METHOD_KEY_DOCS = {
  noise: {
    amp: 'How far vertices move along their normals, in world units. Default 0.3.',
    period: 'Size of the bumps, in world units between peaks — so unlike every other period this one is not a fraction of the frame, and it scales with the shape rather than the picture. Default 2/3. A short period with a low amp is crinkle, the reverse is a slow wobble.',
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
    wrap: "What fills the space around a zoomed-out image: 'clamp' smears the edge pixel, 'repeat' tiles, 'mirror' reflects, 'transparent' leaves it empty — a cutout in a comp. Default 'clamp' — invisible on a flat source; 'transparent' is what turns .scale(0.5) into a small picture on nothing, ready to comp over another chain.",
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
  polar: {
    inverse: 'false (default) unrolls the frame into angle × radius. true goes the other way, reading the image as angle × radius and wrapping it into a disc. Takes a fn of t, so it can flip mid-set.',
  },
  edge: {
    strength: 'Multiplies the detected edges. Default 1. Push to 3-4 before .threshold() for clean line art.',
    spread: 'How many pixels apart the samples sit. Default 1; larger finds chunkier, softer edges.',
  },
  slope: {
    strength: 'Multiplies the gradient. Default 1.',
    spread: 'How many pixels apart the samples sit. Default 1.',
  },
  normalMap: {
    strength: 'How steep the generated normals are. Default 1 — this is the relief depth.',
    spread: 'How many pixels apart the samples sit. Default 1; larger reads bigger, softer forms.',
  },
  levels: {
    contrast: 'Pushes values away from mid-gray. Default 1 unchanged, 0 flattens to gray, 2 is hard.',
    saturation: '0 grayscale, 1 unchanged, above 1 boosts. Default 1.',
    gamma: 'Default 1. Above 1 lifts the shadows, below 1 crushes them — the exponent is 1/gamma, which is the levels-control convention rather than the arithmetic one. .pow() is the same curve said the other way round.',
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
    scale: 'Zoom about the center. A number, or [x, y] to stretch. Default 1. A texture here takes x from red and y from green, so a grayscale map zooms uniformly.',
    rotate: 'Rotation about the center, in radians. Default 0. A texture here turns each pixel by its own angle, and since a rotation keeps the radius, everything slides along concentric circles — the map decides how far around, never how far out.',
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
  displace: {
    amount: 'How far it moves: on geometry, world units along the normal (default 0.2); on a texture, UV (default 0.1). Negative pulls the other way, and it takes a fn of t.',
    mid: 'The map value that means no movement. Default 0.5 for mid-gray maps; use 0 for a dark map you only want to push one way.',
    smooth: 'Geometry only: how wide each vertex reads the map, in vertex spacings. Default 1 turns a busy map into relief rather than grit; 0 reads a single point (jagged, sparkling), 2-4 is doughy and rounded. Takes a fn of t.',
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
  },
  delay: {
    scale: 'Fraction of the frame size the history is stored at — a ceiling: a delay too long to hold shrinks further rather than shortening. Default 1. Halving it quarters the memory per stored frame.',
  },
  feedback: {
    mode: "How last frame comes back in. Default 'add', which piles light up; 'over' stacks it in front, 'under' leaves it behind this frame's drawing.",
    swap: "Feed last frame and this one to the mode in the other order. Default false.",
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
export const NESTED_CONFIG = { shadow: METHOD_CONFIG.shadow };

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
// (GeoOp / LightOp / InstanceHandle), textures.js (TextureOp) and audio.js (sig).

const names = (s) => s.trim().split(/\s+/);

const globalKinds = {
  geo: 'sphere box plane torus torusKnot cylinder capsule icosa model text3d',
  particle: 'particles',
  light: 'ambient directional point spot hemi',
  texture: 'scene depth input constant ramp circle ring video person videofile imagefile imageseq noise voronoi text',
  signal: 'beat audio audiofile rand select sig T mouse',
};

const methodKinds = {
  geo: 'position rotation scale align shadow noise displace instance material color sample normal particles out',
  particle: 'force turbulence attract drag evolve size color opacity fade blend soft lit shadow position rotation scale out',
  // the handle .evolve() gives its fn — what a life point can set
  evolve: 'size color opacity force',
  light: 'position target out',
  inst: 'position rotation scale align color material',
  // (.noise/.displace/.shadow/.out belong to the chain, not a copy — the handle
  // has them only to say so; offering them here would invite the mistake)
  texture: `mirror kaleido radial polar edge slope normalMap levels add sub mul div pow contrast saturation gamma hue
        posterize pixellate ascii transform warp chroma translate rotate scale crop threshold chromaKey lumaKey invert
        remap lookup tint alpha displace comp mask blur bloom delay feedback when tile particles out`,
  signal: `add sub mul div pow range clamp round floor ceil abs gte lte counter select
           sin tri saw sqr beat hold kicks smooth lowpass highpass bandpass`,
};

export const GLOBAL_KIND = {};
for (const [kind, list] of Object.entries(globalKinds)) {
  for (const n of names(list)) GLOBAL_KIND[n] = kind;
}

export const METHOD_KINDS = {};
for (const [kind, list] of Object.entries(methodKinds)) {
  for (const n of names(list)) (METHOD_KINDS[n] ??= new Set()).add(kind);
}

// A callback parameter's kind, by the method that hands it over:
// .instance(n, x => …) gives an instance handle, .tile/.mask/.when a texture.
export const CALLBACK_KIND = {
  instance: 'inst',
  evolve: 'evolve',
  tile: 'texture', mask: 'texture', when: 'texture', comp: 'texture', radial: 'texture',
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

// blocks after the lead, plus the extra-key groups, as elements
function tailNodes(blocks, extra) {
  const out = [];
  for (const block of blocks) {
    const bullet = block.startsWith('- ');
    if (!bullet) { out.push(el('p', null, block)); continue; }
    if (out.at(-1)?.tagName !== 'UL') out.push(el('ul', 'td-doc-list'));
    out.at(-1).append(el('li', null, block.slice(2)));
  }
  if (extra?.length) {
    const ul = el('ul', 'td-doc-list td-doc-keys');
    for (const [section, keys] of extra) {
      const li = el('li');
      li.append(el('span', 'td-doc-sec', section), keys.join(' '));
      ul.append(li);
    }
    out.push(ul);
  }
  return out;
}

export function docDom([sig, info, extra]) {
  const dom = el('div', 'td-doc');
  dom.append(el('div', 'td-doc-sig', sig));
  const [lead, ...rest] = blocksOf(info);
  dom.append(el('div', 'td-doc-lead', lead));
  const tail = tailNodes(rest, extra);
  if (tail.length) {
    const more = el('div', 'td-doc-more');
    more.append(...tail);
    dom.append(more);
  }
  return dom;
}

// The same body without the signature, for the reference table's own layout.
export function infoNodes(info, extra) {
  const [lead, ...rest] = blocksOf(info);
  return [el('p', null, lead), ...tailNodes(rest, extra)];
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
