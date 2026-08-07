import { MATERIAL_GROUPS, MATERIAL_DOCS } from './materials.js';
import { BLEND_MODE_NAMES, ASCII_SET_NAMES } from './textures.js';

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
  sphere: ['sphere({ radius, res })', 'Sphere geometry op. Chain .position/.rotation/.scale/.noise/.instance/.material, end with .out().'],
  box: ['box({ width, height, depth, res })', 'Box geometry op. res adds subdivisions for .noise displacement.'],
  plane: ['plane({ width, height, res })', 'Plane geometry op (double-sided). Great for noise terrain.'],
  torus: ['torus({ radius, tube, res })', 'Torus geometry op.'],
  torusKnot: ['torusKnot({ radius, tube, res, p, q })', 'Torus knot geometry op.'],
  cylinder: ['cylinder({ radiusTop, radiusBottom, height, res })', 'Cylinder geometry op.'],
  capsule: ['capsule({ radius, height, res })', 'Capsule geometry op — a cylinder with hemispherical caps, standing along Y. height is the straight middle only, so the shape is height + 2 * radius end to end.'],
  icosa: ['icosa({ radius, res })', 'Icosahedron geometry op — even triangle distribution, ideal for noise blobs.'],
  model: ["model(name?, { center, fit })", "Geometry op from an imported .obj/.fbx — chain .position/.rotation/.scale/.noise/.instance/.material/.out() like any other shape.\nAn empty model() opens the Poly Haven browser and writes your pick back into the call — the mesh downloads with its material, when it has one. You can also drag a model in (stored in the browser, survives reloads). name = filename, exact or substring.\nEvery mesh in the file merges into one geometry and its own materials are dropped, so shade it with .material()."],

  ambient: ['ambient({ intensity, color })', "Ambient light — an even fill from every direction at once, so it casts no shadows and has nowhere to be. The one light that adds itself: .out() is optional, and only worth chaining to light a single layer.\nPositional ambient(intensity, color) also works."],
  directional: ['directional({ color, intensity, shadow })', 'Directional light — parallel rays, like the sun. Chain .position(x,y,z).target(x,y,z).out(); position, target, color and intensity take fns of t.'],
  point: ['point({ color, intensity, distance, decay, shadow })', "Point light — a bare bulb, throwing light every way at once. Chain .position(x,y,z).out(); position, color and intensity take fns of t.\nintensity: t => 30 * (0.8 + 0.2 * rand(13)(t)) is a fluorescent buzz."],
  spot: ['spot({ color, intensity, angle, penumbra, distance, decay, shadow })', 'Spot light — a cone from .position(x,y,z) toward .target(x,y,z) (the origin without one). The natural partner for shadow: true, since a cone of light is a cone of shadow.'],
  hemi: ['hemi({ sky, ground, intensity })', 'Hemisphere light — sky color from above, bounce from below. Chain .out(). Ambient-ish, so it casts no shadows.'],

  hdri: ['hdri(name?, { background, intensity, blur, rotation, backgroundRotation, backgroundIntensity })', "Image-based lighting from an imported .hdr/.exr: it lights every material in the scene and shows behind it. Metalness only comes alive with one — a metal surface has nothing to reflect otherwise.\nAn empty hdri() opens the Poly Haven browser and writes your pick back into the call; you can also drag a file in. Every option but background takes a fn of t."],

  camera: ['camera(x, y, z, [tx, ty, tz])', 'Static numbers: place camera, orbit stays live. Any fn of t: sketch drives the camera, orbit disabled.'],
  bg: ['bg(color)', 'Scene background color. Hex, CSS name, or [r, g, b] 0..1; a fn of t (or a channel that is one) repaints it every frame.'],
  resolution: ['resolution(width, height) | resolution({ width, height })', "Pin the render to an exact pixel size and shape instead of the browser window. The main window letterboxes it — scaled to fit, centered, black around it — while the projector window (F1) takes that same aspect ratio, so full-screening the projector on a display of the same shape fills it edge to edge.\nA single number is a square; drop the call to go back to filling the window. Sidebar quality scales the pixels underneath without changing the shape, so resolution(1920, 1080) at med renders 1440×810 and still presents 16:9."],
  fog: ['fog({ color, near, far })', 'Scene fog: geometry fades to color between near and far. depth() picks the same range up by default. Positional fog(color, near, far) also works.'],

  scene: ['scene()', 'Texture source: the lit 3D render of everything sent to a naked .out(), as a texture (tone-mapped display space).'],
  depth: ['depth({ near, far }) | depth({ focus, range })', "Texture source: the same 3D render as scene(), as a grayscale distance map — black near, white far, empty space white. Give it a focus instead and it measures distance from that plane, a ready-made depth-of-field mask.\nMostly you hand it to .mask(m, fn) to treat the image by distance: .mask(depth(), s => s.blur(8)) blurs the far, .mask(depth({ focus: 8, range: 5 }), s => s.blur(6)) is DOF, .mask(depth(), s => s.comp(constant('#8a97a8'), 'over')) is haze."],
  input: ['input(name?)', "Texture source: with no name, last frame's display output (comp it back in for trails). With a name, whatever .out(name) published — a texture chain (same frame if acyclic, last frame if it loops — a named cycle is a feedback loop) or a geometry layer, rendered on black."],
  constant: ['constant(color)', "Texture generator: one flat color, whole frame. Hex, CSS name or [r, g, b], and a fn of t like any other color slot.\nThe thing to comp with when a wash is wanted rather than an image: .mask(depth(), s => s.comp(constant('#8a97a8'), 'over')) is haze."],
  ramp: ["ramp({ type: 'linear'|'radial'|'angular', a, b, angle, phase, period, freq, shape: 'saw'|'tri'|'sin'|'sqr' })", "Texture generator: a two-color sweep — straight across, out from the center, or around it.\nperiod is how much of the frame one cycle spans, so anything under 1 repeats it into bands, and shape waveshapes each cycle — the same four shapes signals have. ramp({ angle: Math.PI / 2, freq: 80, shape: 'tri' }) is scanlines, shape: 'sqr' is hard stripes, type: 'angular' a pinwheel, type: 'radial' rings. Animate phase to scroll them."],
  circle: ['circle({ radius, thickness, soft, center, color, bg })', 'Texture generator: a hard-edged disc (antialiased, not feathered — soft is what feathers it), or a ring once thickness cuts the middle back out. radius, thickness, soft and center each take a fn of t, or a texture for a value that varies across the frame — a texture in radius bends the rim into a blob.'],
  ring: ['ring({ inner, outer, soft, center, color, bg })', "Texture generator: a hard-edged annulus — circle() addressed by its two edges, for when the hole is the point rather than the band. Everything else is circle()'s.\ninner and outer take fns of t; a texture belongs on circle({ radius, thickness }), since a map can't be subtracted into a width."],
  video: ['video(name?)', "Texture generator: live camera. No name = the default camera, and the console lists the available sources on start. Permission prompt on first use; black until the stream is live.\nvideo('front') / video('back') ask for a facing — the way to name a phone's cameras, whose labels don't exist until permission has been granted. Any other name matches a camera label by case-insensitive substring, e.g. video('facetime')."],
  videofile: ["videofile(name?, { speed, loop, mute, restart })", "Texture generator: an imported video file, looping. Drag a file in to import it (stored in the browser, survives reloads); an empty call opens a picker and fills the name in. name = filename, exact or substring.\nctrl+r or restartMedia() rewinds everything by hand."],
  imagefile: ["imagefile(name?)", 'Texture generator: an imported image file (drag one in, or empty call = picker). An array delegates to imageseq().'],
  imageseq: ["imageseq(['a.png', ...], index?)", 'Texture generator: several imported images with a signal picking the current one (floored, wrapped) — imageseq(names, beat(1).counter()) steps each beat, .counter() of .kicks() steps on kicks. Default index: one per second.\nDropping several images at once types this call for you. Empty call = multi-file picker.'],
  noise: ['noise({ period, freq, octaves, lacunarity, gain, speed, seed, channels, a, b })', 'Texture generator: animated fbm simplex noise, shading from color a to color b — the workhorse source for .displace(), masks and lookups.\nThe output is normalized, so the octave keys change its texture rather than its level; reach for .contrast()/.mul() to set that. On a geometry chain .noise() displaces vertices instead.'],
  voronoi: ["voronoi({ period, freq, speed, blend, seed, mode: 'cells'|'distance'|'edges', a, b })", "Texture generator: scattered points drifting over the frame, every pixel colored by the nearest one — cracked glass, cell walls, stained glass, water caustics.\nmode picks what's drawn (flat cells, distance to the nearest point, or the seams between cells); all three shade from a to b, so any of them also works as a mask or a .displace() map. blend softens the boundaries and takes a texture."],
  text: ["text('hi', { size, color, bg, pos, font, weight, align })", "Texture generator: canvas-rendered text on a solid background — comp it over a scene with add or screen to drop the bg. Content can be a fn of t; \\n for multiline."],
  text3d: ["text3d('hi', { size, depth, bevel, res, font, weight, center })", "Geometry op: 3D extruded text, chainable like any other shape. Renders in helvetiker until the font you named arrives."],

  beat: ['beat(div = 1)', 'Tempo-synced phase ramp 0..1 over div beats (tempo in the sidebar). Shape it: beat(2).sin() two-beat LFO, beat(0.25).sqr() sixteenth gates, rand().beat(1) sample-hold, beat(4).counter().select([...]) walks a list per bar.'],
  audio: ['audio(chan? | name?, chan?)', "Audio input level as a signal — a fn of t, usable in any parameter. Chain .mul/.add/.pow/.smooth/.kicks/.lowpass/.highpass/.bandpass; the first use starts capture.\naudio() is the mono mix of the sidebar's device, audio(2) one channel by index, audio('scarlett') a device by name (substring, and an unmatched one lists the inputs in the console), audio('scarlett', 2) a channel of it."],
  audiofile: ["audiofile(name?, { volume, speed, loop, restart, chan })", 'An imported audio file, played out loud and analysed like audio(): it returns its level as a signal, so chain .kicks/.lowpass/.smooth/etc. Empty call = picker; drag a file in to import. ctrl+r or restartMedia() rewinds by hand.'],
  restartMedia: ['restartMedia(name?)', 'Rewind imported media files to 0 — all of them, or by name (substring). In a sketch it runs on every execute; ctrl+r does the same from the keyboard.'],
  rand: ['rand({ freq: 1, seed: 0 })', 'Smooth random signal: deterministic value noise of t, 0..1 — the signal cousin of the noise() texture. Positional rand(freq, seed) also works.\nrand().beat(4).mul(4).round() = random 0..4 per bar; rand().hold(audio().kicks()) = a new value per kick.'],
  sig: ['sig(fn?)', "Lift any fn of t into a chainable signal: sig(t => Math.sin(t)).smooth(0.2). Free-running LFOs stay plain fns; this just adds the processing methods.\nBare sig() is t itself — the seconds-based phase source beat() is the tempo-synced version of. sig().sin() is a 1 Hz LFO over 0..1, sig().mul(0.5).sin().range(0, 10) a slower one over 0..10."],
  T: ['T', "Bare sig() under a shorter name: t in seconds, with the signal methods on it. T.mul(0.3).sin() is an LFO every 3.3 seconds, T.sin().range(0, 10) a 1 Hz one over 0..10.\nA value, not a call — no parentheses, and none of the sources take it as an argument. sig(fn) is still how a fn of your own gets lifted."],
  mouse: ["mouse('x'|'y'|'down')", "Pointer position as a signal, -1..1 with 0 at the center and y up — the range .position() wants, so .position(mouse('x'), mouse('y'), 0) tracks the cursor directly. Default axis is x.\nmouse('down') is a 1/0 gate: .smooth(0.2) ramps it, .counter() steps on clicks, and it drives .when() like any other gate. Reads the picture rather than the page, so the letterbox bars and the projector window both land where you'd expect.\nIt's the one signal that isn't 0..1 — .range(0, 10, { from: [-1, 1] }) rescales it."],

  onFrame: ['onFrame((t, dt) => ...)', 'Register a raw per-frame callback.'],
  THREE: ['THREE', 'The full three.js namespace, for anything the API does not cover.'],
  Texture: ['Texture', "The type every texture chain is one of. Adding to its prototype adds an op to every chain: Texture.prototype.punch = function (n) { return this.pow(n).contrast(2) } and then scene().punch(3) works.\n`this` is the chain, so a helper returns this.something(...) like any other op — which means a function rather than an arrow, since an arrow would take `this` from the sketch. It's also what x instanceof Texture asks, for a helper that takes either a texture or a number. Geometry is the same for geometry chains; chains themselves start at a generator, never at new Texture().\nMethods stay defined until the tab is reloaded rather than until the next run, so a helper you have stopped editing keeps working while you edit around it — and a renamed one leaves the old name behind."],
  Geometry: ['Geometry', 'The type every geometry chain is one of — the sphere()/box() counterpart of Texture. See Texture.'],
  bufferId: ['bufferId()', "A bus name nothing else will take, one per call site: with b = bufferId(), input(b) / .out(b) is a feedback loop that can't collide with anyone else's. It hands back the id, not a buffer — the buffer is whatever .out(b) publishes to it.\nWhat it isn't is a fresh id each run: the same call gets the same one back every re-run, which is what lets the loop keep its contents while you edit the sketch. Call it once and hold it in a variable, since both ends of the loop need the same id and calling it twice is two buffers. Mostly you want .feedback(), which is this plus the wiring."],
};

export const METHODS = {
  position: ['.position(x, y, z) | .position(v)', 'Position. Each component is a number or fn of t; one vector argument ([x,y,z] or anything with x/y/z) also works, so .position(pts.sample(i)) goes straight in.\nShort form: .position().'],
  rotation: ['.rotation(x, y, z) | .rotation(v)', 'Geometry: rotation in radians. Each component is a number or fn of t, or one vector in the first slot like .position(v).\nShort form: .rot(). A texture chain rotates with .rotate() instead, which is a UV transform rather than a placement.'],
  scale: ['.scale(x, y?, z?) | .scale(v, { wrap })', 'Geometry: scale, one number = uniform, one vector = per-axis · Texture: .scale(v, { wrap }) zooms around center (scalar or [x, y]).'],
  rotate: ['.rotate(v, { wrap })', 'Texture: rotate the image around center, in radians. v takes a fn of t, or a texture to turn each pixel by its own angle.\nShort form: .rot(). Geometry is placed with .rotation() instead.'],
  translate: ['.translate(x, y, { wrap }) | .translate(map, { wrap })', "Texture: shift the image in UV space (1 = full frame). Short form: .trans().\nA texture fills the whole slot rather than one component — the shift at each pixel is that map's R and G there, which is what .displace() is built on."],
  noise: ['.noise({ amp, period, freq, octaves, lacunarity, gain, speed, seed })', 'GPU fbm displacement along vertex normals, with the normals recomputed so lighting stays correct. It can only move vertices the shape already has — raise its res if nothing happens. .sample()/.normal() on the chain see the same field, so a noised shape works as a layout source.'],
  instance: ['.instance(count, (x, i, n, t) => x.position(...))', 'Render as one InstancedMesh. The layout fn gets each copy as x and transforms it with the same verbs as the chain — .position/.rotation/.scale, plus .color() to tint that copy. It runs every frame, so instances animate. i = copy index, n = count.\nFor a layout that follows another shape, .position(pts.sample(i)) scatters the copies over its surface — see .sample().'],
  align: ['.align(v)', "Aim the shape's +Y axis along a direction vector — the rotation Euler angles can't state without a page of atan2. Its reason to exist is .align(pts.normal(i)), standing each copy up off the surface it was sampled from.\n+Y is the axis because that's where a cylinder() or a cone already points. .rotation() still applies, in the shape's own frame before the aim: a Y-only rotation rolls it about the aimed axis and leaves the aim alone, while an X or Z one leans it off by that angle. Components take fns of t."],
  sample: ['.sample(i)', "The i-th point of a fixed scatter over this shape's surface, as {x, y, z} — a geometry used as a layout source rather than something drawn. The shape needn't be in the scene: an op that never reaches .out() renders nothing, so const pts = icosa({ radius: 3 }) then .instance(400, (x, i) => x.position(pts.sample(i))) skins one shape onto another.\nPoints are area-weighted across the triangles and stable across re-runs, so editing a sketch doesn't reshuffle them. The source's whole chain applies: its .noise() puts the points on the deformed surface (the same field, re-run on the CPU), then its .position/.rotation/.scale/.align place them, so a layout can be noised, placed, or spun. Either one makes the points a fn of t, so results can only be worked out ahead of the layout fn while the source is still."],
  normal: ['.normal(i)', 'The surface normal at .sample(i), as {x, y, z} — which way the shape faces there. Hand it to .align() to stand copies up off the surface, or read a component to drive scale or color by facing.'],
  material: ['.material({ color, roughness, metalness, emissive, opacity, transmission, clearcoat, iridescence, pbr, map, normalMap, repeat, flatShading, wireframe, doubleSide })', "How the surface takes light: a standard PBR material, upgraded to three's physical one the moment you name a glass or coating key — so a sketch that never mentions them pays nothing.\nAn empty .material() opens the Poly Haven browser and writes your pick back into the call. Every value takes a fn of t; every map slot takes an imported image by name, or a live texture chain."],
  color: ['.color(c)', "Shorthand for .material({ color }).\nFour forms, everywhere a color is taken: '#4fd1c5', a CSS name, 0x4fd1c5, or [r, g, b] with channels 0..1. The whole color may be a fn of t or a signal — .color(kickCounter.select(palette)) — and each channel of the array may be its own, which is how you compute a color instead of listing one: .color([t => Math.sin(t) * 0.5 + 0.5, 0.2, audio()])."],
  target: ['.target(x, y, z) | .target(v)', 'Light: where a directional() or spot() points (the origin without one). Components take fns of t, so the beam can sweep, and one vector argument works like .position(v). Point and hemisphere lights have no direction and reject it.'],
  shadow: ['.shadow(false | { cast, receive })  ·  light option: shadow: true | { map, soft, strength, bias, normalBias, near, far, area }', "Geometry casts and receives by default and costs nothing until some light casts, so on a mesh this is really the opt-out: .shadow(false) for both, or one side of it. On a light, shadow: true turns casting on (directional/spot/point) and the same object tunes it.\nThe one exception to that default: glass (transmission) and blended (opacity < 1) surfaces don't cast, because the depth pass can't tell they're see-through and would throw the solid shadow of their silhouette. .shadow(true) insists."],
  out: [".out(name?)", "Naked: geometry/light joins the visible scene; a texture chain becomes the display output. With a name, publishes for input('name') instead: a texture chain (passthrough), a geometry as its own render layer, or a light lighting only that layer.\nAn op is mutable and its mesh re-reads it every frame, so .out() doesn't take a copy: moving one op between two .out() calls leaves both meshes on the last transform, stacked. Repeats want .instance(n, fn); copies that differ want the shape as a function — const ball = (color) => sphere({ radius: 0.5 }).material({ color }), then ball('#4fd1c5').position(-3).out() builds a fresh op each call."],

  mirror: [".mirror({ axis: 'x'|'y'|'both', flip })", 'Texture: reflect one half of the image onto the other. A texture in flip chooses which half survives per pixel, so both reflections come back interleaved by the map.'],
  kaleido: ['.kaleido(sides, { rotate })', 'Texture: polar kaleidoscope fold. Both keys take a fn of t, or a texture for a value that varies across the frame.'],
  radial: ['.radial(s => ...)', "Texture: run the fn in polar space — x is the angle around the center, y the distance from it — and come back. Ordinary ops then act radially: .radial(s => s.translate(0, 0.1)) is a tunnel, .translate(0.1, 0) spins the whole frame, .blur([8, 0]) smears around the ring and .blur([0, 8]) along it.\nBoth resamples belong to the call, so the span between them knows x is an angle and wraps at the seam — a hand-rolled .polar() pair can't. The center is one pixel stretched across a whole row, so expect a starburst there."],
  polar: ['.polar({ inverse })', "Texture: the one-way coordinate change, as an effect. Naked, it unrolls the frame into angle × radius (a ring chart, rings become bands). With inverse: true it reads the image as if it already were angle × radius and wraps it into a disc — a horizon becomes a little planet.\nFor treating an image radially you want .radial(s => ...), which is this pass either side of your fn."],
  edge: ['.edge({ strength, spread })', 'Texture: Sobel edge magnitude (grayscale).'],
  slope: ['.slope({ strength, spread })', 'Texture: neighbor-difference gradient, centered on 0.5, in RG.'],
  normalMap: ['.normalMap({ strength, spread })', 'Texture: tangent-space normal map from luma height.'],
  levels: ['.levels({ contrast, saturation, gamma, hue })', 'Texture: combined tonal adjust. Every key takes a fn of t, or a texture for a value that varies across the frame.'],
  hue: ['.hue(v)', 'Texture: hue rotation in turns — 0.5 is opposite colors, 1 a full lap. Animate with a fn of t or a signal, or hand it a texture to rotate each pixel by what the map says there.'],
  add: ['.add(v)', 'Texture: add v to every pixel (scalar or [r, g, b]; negative darkens) · audio signal: plain addition/offset.\nA texture in place of v is read as RGB, so the offset is per pixel and per channel — .add(map) is an additive comp with the range under your control.'],
  mul: ['.mul(v)', "Texture: multiply every pixel by v (scalar or [r, g, b]) · audio signal: plain gain.\nA texture in place of v is read as RGB, so the gain is per pixel and per channel — .mul(circle({ soft: 0.3 })) is a vignette, .mul(map) a colored mask."],
  pow: ['.pow(v)', 'Texture: raise every pixel to the power v (scalar or [r, g, b]) · audio signal: <1 expands quiet detail, >1 emphasizes peaks.\nOn a texture this is the curve for shaping a mask: .pow(3) pushes a soft falloff toward the dark end without moving black or white, below 1 lifts it. .gamma() is the same curve inverted — .pow(v) is .gamma(1 / v) — and lives with the other tonal controls in .levels(); pow is the one to reach for when the frame is arithmetic rather than a picture.'],
  sub: ['.sub(v)', 'Texture: subtract v from every pixel (scalar or [r, g, b]) · signal: subtraction/offset, where v may be a number, a fn of t or another signal.\nA texture in place of v is read as RGB, so the amount is per pixel and per channel — .sub(map) is a difference comp with the range under your control. Worth having over .add(-v), which has no spelling once v is a fn of t, an [r, g, b] or a map.'],
  div: ['.div(v)', 'Texture: divide every pixel by v (scalar or [r, g, b]) · signal: division, worth having over .mul(1 / v) because v can move — .div(audio().add(1)) ducks with the level.\nA texture in place of v divides per pixel and per channel, which is how a map becomes an exposure rather than a mask. A divisor at 0 is floored rather than returning Infinity, so .div(0) blows out to white instead of going black; a negative one still flips the sign.'],
  range: ['.range(min, max, { from, to })', "Signal: rescale to min..max. The input is taken as 0..1 — what the shapers, rand() and audio() all produce — so audio().range(1, 4) is the usual .mul(3).add(1) said once.\nGive from for the signals that aren't 0..1: mouse().range(0, 10, { from: [-1, 1] }), sig(t => Math.sin(t)).range(0, 10, { from: [-1, 1] }). .range({ from, to }) names both spans instead of the positional pair. Every bound takes a fn of t.\nIt doesn't clamp — an input past its from span lands past min..max. Follow with .clamp() to fence it."],
  clamp: ['.clamp(lo = 0, hi = 1)', 'Signal: limit to lo..hi without rescaling — the fence .range() deliberately leaves off. Both bounds take fns of t.'],
  smooth: ['.smooth(up, down?)', 'Audio signal: exponential lag (one-pole lowpass on the value), time constants in seconds. Two args = separate attack/release — fast up + slow down makes a nice envelope.'],
  kicks: ['.kicks({ threshold: 1.5, decay: 6, floor: 0.05 })', 'Audio signal: onset detector — 1 when the value jumps past threshold × its own moving average, exponential decay after. audio().bandpass(30, 160).kicks() for kick drums; move the band for snares/hats.'],
  lowpass: ['.lowpass(hz)', "Audio signal: energy below hz (0..1) from the input's spectrum — bass level."],
  highpass: ['.highpass(hz)', "Audio signal: energy above hz (0..1) from the input's spectrum — treble level."],
  bandpass: ['.bandpass(lo, hi)', "Audio signal: energy between lo and hi Hz (0..1) from the input's spectrum."],
  gte: ['.gte(v)', 'Signal: 1 while the value is >= v, else 0 — a gate for .when()/.counter().'],
  lte: ['.lte(v)', 'Signal: 1 while the value is <= v, else 0.'],
  counter: ['.counter(max?, threshold = 0.5)', 'Signal: counts rising edges (kicks, gates); wraps at max. Pair with .select to cycle through values on every hit.'],
  select: ['.select([a, b, c, ...])', 'Signal: index the array by the value (floored, wrapped). Items may be numbers, colors, strings, or fns of t. E.g. .kicks().counter().select([1, 2, 4]).'],
  sin: ['.sin()', 'Signal: sine shape of the value-as-phase (0..1 out, one cycle per whole unit). beat(2).sin() = two-beat LFO.'],
  tri: ['.tri()', 'Signal: triangle shape of the value-as-phase (0..1 out).'],
  saw: ['.saw()', 'Signal: fractional part of the value — a ramp per cycle.'],
  sqr: ['.sqr(width = 0.5)', 'Signal: 1 while the phase is below width, else 0 — square LFO / rhythmic gate.'],
  beat: ['.beat(div = 1)', 'Signal: tempo-synced sample-and-hold — freezes a new value of the signal at the start of every div beats (tempo in the sidebar). rand().beat(4) = a new random value each bar.'],
  hold: ['.hold(trigger, threshold = 0.5)', 'Signal: sample-and-hold driven by another signal — freezes the current value each time trigger crosses up through threshold. rand().hold(audio().kicks()) = new random per kick.'],
  round: ['.round()', 'Signal: round to the nearest integer. rand().mul(4).round() picks 0..4.'],
  floor: ['.floor()', 'Signal: round down to an integer.'],
  ceil: ['.ceil()', 'Signal: round up to an integer.'],
  abs: ['.abs()', 'Signal: absolute value.'],
  tint: ['.tint(color, { bg })', "Texture: recolor by brightness — black becomes bg, white becomes color, everything between mixes. The answer to \"I have a white image and I want it in my color\": edge().tint('#ff00ff') is magenta line art on black.\ncolor and bg take every color form, fns of t included, so .tint(beat(4).counter().select(palette)) recolors on the bar. For more than two stops it's .lookup(ramp) — this is that with the ramp spelled inline."],
  when: ['.when(cond, s => ...)', 'Texture: per-frame switch — while cond >= 0.5 the chain becomes fn(chain), otherwise it passes through. E.g. .when(audio().gte(0.3), s => s.kaleido(6)). Only the active branch renders.'],
  contrast: ['.contrast(v)', 'Texture: contrast around mid-gray (1 = unchanged). A texture in place of v sets it per pixel.'],
  saturation: ['.saturation(v)', 'Texture: 0 = grayscale, 1 = unchanged, >1 boosts. A texture in place of v sets it per pixel.'],
  gamma: ['.gamma(v)', 'Texture: gamma curve (1 = unchanged, above 1 lifts the shadows). A texture in place of v sets it per pixel.\nThe color-correction spelling of .pow(), inverted the way a levels control is: .gamma(v) is .pow(1 / v).'],
  posterize: ['.posterize(steps)', 'Texture: quantize values to n levels per channel. A texture in place of steps sets the count per pixel — scale it first (.mul(8)), since a raw map only ever says 0..1.'],
  pixellate: ['.pixellate(x, y?)', 'Texture: quantize position into cells (square cells if y omitted). Either count takes a texture, so the cells can be coarse in one part of the frame and fine in another.'],
  ascii: ['.ascii({ chars, cols, rows, color, bg, font, weight })', "Texture: redraw the image as a grid of characters, each cell taking the glyph whose ink matches its brightness. Cells keep the color of the image under them until you name one.\nchars is a set name — 'ascii', 'dense', 'blocks', 'numbers', 'letters', 'binary', 'dots' — or any string of your own, ordered dark→bright. Contrast decides how much of the set gets used, so .levels() ahead of it is the real dial."],
  transform: [".transform({ translate: [x,y], scale, rotate, wrap: 'clamp'|'repeat'|'mirror'|'black' })", "Texture: UV-space transform. Shorthands: .translate(x, y), .rotate(v), .scale(v).\ntranslate, scale and rotate each take a texture in place of a number and become per-pixel: two-component slots read the map's R and G, scalar ones its luma, and { map, amount, mid } scales and biases what comes back. .displace() is this pass with mid: 0.5."],
  crop: ['.crop(w, h?, { center })', "Texture: keep the middle w×h of the frame and drop the rest to black. Nothing is resampled — the picture stays the size it was and the black closes in around it, so this is .mask() against a white rectangle, with the rectangle written in pixels.\nSizes above 1 are pixels of the frame's own grid: the numbers resolution() was given, or the canvas as displayed when a sketch didn't set one. Neither retina nor quality() moves the count. 0..1 is a fraction of the frame instead, and h defaults to w — .crop(400) is a 400px square, .crop(0.5) the middle half either way. Sizes and center all take fns of t, so the window can breathe and pan; keep an animated pixel size above 1, since crossing it hands the number to the other reading."],
  warp: [".warp({ barrel, twist, zoom, center, wrap })", "Texture: radial UV warp — the CRT/fisheye lens. Radius is 1 at the frame corner, so barrel: 0.3 pulls the corners in by 30%. All params take fns of t.\nbarrel, twist, zoom and center also take a texture, which makes the lens vary across the frame — luma for the scalars, R/G for center."],
  chroma: ['.chroma(amount, { radial, angle, center })', "Texture: chromatic aberration — samples R and B at opposite UV offsets, G at center. amount is the split at the frame edge: 0.002-0.01 is subtle, more is glitch, and it takes a fn of t.\namount, angle and center also take a texture, which makes the split vary across the frame — luma for the scalars, R/G for center."],
  mask: ['.mask(mask, fn?)', 'Texture: without fn, multiply by the mask\'s luma (cutout). With fn, apply it only where the mask is bright: .mask(circle(), s => s.displace(...)) displaces inside the circle only. Mask and fn both accept fn-of-chain.'],
  threshold: ['.threshold(level, { soft })', 'Texture: luma threshold to a black/white mask. Both keys take a texture: a per-pixel level cuts the image against another image rather than against one number.'],
  invert: ['.invert()', 'Texture: invert colors.'],
  remap: ['.remap(map)', "Texture: absolute UV lookup — sample this chain at the map's RG coordinates. Map can be a fn of the chain so far."],
  lookup: ['.lookup(ramp)', "Texture: recolor by luma — each pixel's luminance indexes the ramp left-to-right. .lookup(ramp({ a: 'black', b: 'red' })). Ramp can be a fn of the chain so far."],
  displace: ['.displace(map, { amount: 0.1, mid: 0.5 })', "Texture: push each pixel sideways by what the map says there, reading the offset from its red and green. Positional .displace(map, amount) also works, and the map can be a fn of the chain so far.\nA grayscale map moves everything along the diagonal — noise({ channels: 2 }) for a wobble that goes both ways. It is .transform({ translate: map }) with the mid bias, so the two share a pass."],
  comp: [".comp(layer, { mode, opacity })", 'Texture: composite layer over this chain. layer may be a fn of the chain so far — .comp(s => s.edge(), \'add\') overlays your own edges. Positional .comp(layer, mode, opacity) also works.\nModes: over add sub mult screen overlay hardLight softLight darken lighten difference exclusion dodge burn divide luminosity color. luminosity takes the layer\'s brightness and keeps the base\'s colour (color is the reverse) — how you put a sharp luma back on a blurred chroma.'],
  blur: ['.blur(radius)', 'Texture: separable gaussian blur, radius in texels. An [x, y] radius blurs per axis — .blur([8, 0]) smears horizontally only; an axis at 0 skips its pass.'],
  bloom: ['.bloom({ threshold, strength, radius })', 'Texture: brightpass + half-res gaussian glow.'],
  delay: ['.delay(frames, { scale })', "Texture: the chain as it was n frames ago. .comp(s => s.delay(1), 'diff') is a motion mask — what changed since last frame — and comping a few at falling opacity is an echo.\nThis is the fixed-length counterpart to a feedback loop: input('name') in a cycle gives you last frame only, and blending it into itself gives a smear with no definite age. frames takes a fn of t, so the lag can move; the buffer grows to the longest delay asked for and keeps that size.\nHistory is frames of video, so it costs memory per frame of delay — a long one is stored at reduced size to fit (and says so), which keeps the count you wrote meaning the same length of time on any display. { scale } sets that size yourself. History survives a re-run — editing the sketch doesn't punch a delay-length hole of black through the show — and holds (rather than skips) on frames where the chain doesn't render, e.g. inside an inactive .when() branch."],
  feedback: ['.feedback((prev, src) => chain)', "Texture: a feedback loop with the bus name managed for you. prev is this point's own output last frame, src the chain so far, and what the fn returns is both what renders now and what prev will be next frame.\n.feedback(prev => prev.transform({ scale: 1.02 }).comp(src, 'add')) is a trail; .feedback((prev, src) => src.comp(prev.blur(2), 'lighten')) a bloom that accumulates. Same thing as closing an input('name')/.out('name') cycle by hand, minus the name — which matters when the loop lives inside a helper of your own, since each call site claims a buffer of its own and two calls can't collide. Contents survive a re-run like any other feedback buffer, and hold while paused.",
  ],
  tile: ['.tile(nx, ny, (src, i, x, y) => variant)', 'Texture: tile nx×ny with a per-cell chain. fn may return src, a treatment of it, or any texture; identical variants dedupe, and each distinct one renders its own pass — like comping that many .out()s. x left→right, y bottom→top, i = y*nx + x.'],
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

function parseConfig(detail) {
  const keys = new Map();
  for (const group of braceGroups(detail)) {
    for (const part of splitTop(group, ',')) {
      const colon = part.indexOf(':');
      const key = (colon < 0 ? part : part.slice(0, colon)).trim();
      if (!/^\w+$/.test(key) || keys.has(key)) continue;
      const hint = colon < 0 ? '' : part.slice(colon + 1).trim();
      // 'linear'|'radial' -> the literal values this key accepts
      const values = /^'[^']*'(\s*\|\s*'[^']*')*$/.test(hint)
        ? splitTop(hint, '|').map((v) => v.replace(/'/g, ''))
        : null;
      keys.set(key, { key, hint, values });
    }
  }
  return keys.size ? keys : null;
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

// .material() is the exception: its signature names the sixteen keys worth
// showing in a tooltip header, but the material understands 45. materials.js
// owns that list (it's what rejects a typo), so take it from there instead.
METHOD_CONFIG.material = new Map(
  MATERIAL_GROUPS.flatMap(([section, keys]) =>
    keys.map((key) => [key, { key, hint: '', values: null, section, doc: MATERIAL_DOCS[key] }])
  )
);

// Same escape hatch for .comp({ mode }): seventeen blend modes don't fit in a
// signature, and textures.js owns the list that resolves them.
METHOD_CONFIG.comp.get('mode').values = BLEND_MODE_NAMES;

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
    a: 'Color at the low end. Default black.',
    b: 'Color at the high end. Default white.',
    angle: 'Direction of a linear ramp, or where an angular one starts, in radians. Default 0.',
    phase: 'Slides the sweep along itself, in cycles. Default 0. With period or shape named it wraps, so animating it scrolls the bands forever; on a plain ramp it runs into the clamped ends instead — which is the point of a negative phase on a radial one, giving a vignette with a flat center.',
    period: 'How much of the frame one cycle of the sweep spans. Default 1, a single gradient across it. Below that it repeats into bands — 0.5 is two, and with type angular or radial the same number gives a pinwheel or rings. The whole useful range lives in 0..1, so a bare signal drops in: period: rand({ freq: 2 }) or audio() rewrites the pattern without a .mul() in front of it. Naming it also makes phase wrap; freq says the same thing upside down, for the band counts that would otherwise be fractions.',
    freq: 'How many cycles span the frame — the reciprocal of period, and the easier spelling for fine bands: freq: 80 is scanlines. Naming either one is what makes phase wrap.',
    shape: "Waveshape of each period, the same four signals have: 'saw' (default, the plain ramp, hard seam where it wraps), 'tri' (up then back down — the seamless one, and what soft stripes want), 'sin' (smoother still), 'sqr' (flat a, flat b — hard bands). Threshold a tri to make the bands thin.",
  },
  circle: {
    radius: 'Radius in UV units, so 0.5 touches the frame edge. Default 0.25. A texture here is the radius at that pixel — noise({ freq: 3 }).mul(0.1).add(0.25) is a wobbling blob.',
    soft: 'Width of the fade at the rim, in UV units. Default 0 — a hard edge, antialiased to a pixel rather than left stepped. 0.05 is a visible feather, 0.2 a soft glow. A texture makes the rim crisp in places and vague in others.',
    center: '[x, y] in UV, 0..1 from bottom-left. Default [0.5, 0.5]. A texture takes x from red and y from green.',
    color: 'Color inside the disc. Default white.',
    bg: 'Color outside it. Default black.',
    thickness: 'Width of the band, measured inward from the rim, leaving a hole in the middle. Unnamed is a solid disc, and so is any thickness at or past the radius; an explicit 0 is the other end — a band with no width left, which draws nothing. A texture here thins and fattens the band around its circumference, closing it where the map goes black.',
  },
  ring: {
    inner: 'Radius of the hole, in UV units. Default 0.15. At or past outer the band has no width left and nothing is drawn, so animating inner up to outer closes the ring rather than filling it.',
    outer: 'Radius of the rim, in UV units, so 0.5 touches the frame edge. Default 0.25.',
    soft: "Width of the fade, applied to both edges. Default 0 — hard, antialiased to a pixel. A soft big enough to swallow the band is how a ring becomes a glowing hoop. Takes circle()'s texture too.",
    center: '[x, y] in UV, 0..1 from bottom-left. Default [0.5, 0.5]. A texture takes x from red and y from green.',
    color: 'Color of the band. Default white.',
    bg: 'Color of the hole and everything outside. Default black.',
  },
  videofile: {
    speed: 'Playback rate: 1 normal, 0.5 half, 0 freezes the frame. Takes a fn of t.',
    loop: 'Start over at the end. Default true.',
    mute: 'Default true. false lets the file\'s own audio play out loud.',
    restart: 'Rewinds whenever this crosses 0.5 upward — restart: beat(8).sqr(0.05) retriggers every 8 beats.',
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
    a: 'Color the low end shades to. Default black.',
    b: 'Color the high end shades to. Default white.',
  },
  voronoi: {
    period: 'How much of the frame one cell spans. Default 1/6 — 0.5 is a few big plates, 0.025 is fine crazing. Same 0..1 range every period key has.',
    freq: 'How many cells span the frame — the reciprocal of period, and usually the easier of the two here, since cells are things you can count. Default 6: 2 is a few big plates, 40 is fine crazing. scale is the old name for this key and still works.',
    speed: 'How fast the points drift inside their cells. Default 0.3; 0 freezes the pattern into a still.',
    blend: "How far past its own cell a pixel listens, in cell widths. Default 0 — hard edges. Raising it melts neighbouring cells into each other ('cells'), rounds the wells ('distance') and fattens the seams ('edges'). A texture here makes the pattern crisp in some places and molten in others.",
    seed: 'Picks a different scatter of the same character. Default 0.',
    mode: "'cells' (default) fills each cell flat, 'distance' shades by how far the pixel is from its point — dark at the points, bright at the walls — and 'edges' lights only the seams, where the two nearest points are equally close.",
    a: 'Color the low end shades to. Default black. In cells mode each cell picks its own point on the a→b ramp, so two different colors give a scatter of tints; .lookup() a grayscale one through a gradient for a wider palette.',
    b: 'Color the high end shades to. Default white.',
  },
  text: {
    size: 'Values above 1 are screen pixels, like CSS; 0..1 is a fraction of frame height. Default 0.15.',
    color: 'Text color. Default white.',
    bg: 'Background fill. Default black — comp the result with add or screen to drop it.',
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
    font: "A font name, 'google:Name', or a .ttf/.otf/.typeface.json URL. Renders in helvetiker until the real one arrives. A bare name tries your installed fonts first — Chrome and Edge only, behind a one-time permission prompt — then Google Fonts; arial, helvetica, times new roman, courier new, georgia, calibri and cambria also have metric-compatible stand-ins, so they set the same way in any browser.",
    weight: "'bold' selects the bold built-in when no font is named.",
    center: 'Center the text on the origin. Default true.',
  },
  audiofile: {
    volume: '0..1 playback level. Only how loud it plays — the signal it returns is unaffected.',
    speed: 'Playback rate: 1 normal, 0.5 half. Takes a fn of t.',
    loop: 'Start over at the end. Default true.',
    restart: 'Rewinds whenever this crosses 0.5 upward.',
    chan: 'Analyse one channel by index instead of the mix.',
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
    wrap: "What fills the space shifted in from off-frame: 'clamp' smears the edge pixel, 'repeat' tiles, 'mirror' reflects, 'black' leaves it empty. Default 'clamp'.",
  },
  scale: {
    wrap: "What fills the space around a zoomed-out image: 'clamp' smears the edge pixel, 'repeat' tiles, 'mirror' reflects, 'black' leaves it empty. Default 'clamp'.\nOn a flat source clamp looks like nothing happened — every edge pixel is the same color, so constant('red').scale(0.5) is still a full red frame. 'black' is what makes it a shape: .scale(0.5, { wrap: 'black' }) is a rectangle on an empty background, and [x, y] sets its proportions.",
  },
  rotate: {
    wrap: "What fills the corners swung in from off-frame: 'clamp' smears the edge pixel, 'repeat' tiles, 'mirror' reflects, 'black' leaves it empty. Default 'clamp'.",
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
    bg: "What black in the source becomes. Default '#000000', so a white-on-black image keeps its background and only the marks take the color.",
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
    wrap: "What fills the space moved in from off-frame: 'clamp', 'repeat', 'mirror' or 'black'. Default 'clamp'.",
  },
  crop: {
    center: '[x, y] the window sits on, in UV, 0..1 from bottom-left. Default [0.5, 0.5]. Takes a fn of t, which slides the window over a picture that stays put — the pan of a locked-off camera.',
  },
  warp: {
    barrel: 'Bulges the image outward like a CRT face. Default 0; 0.2-0.4 reads as a screen, negative pinches inward.',
    twist: 'Rotates by distance from center, in radians — the middle holds still and the edges spiral. Default 0.',
    zoom: 'Scales about the center. Default 1.',
    center: '[x, y] the warp radiates from, in UV. Default [0.5, 0.5].',
    wrap: "What fills outside the frame: 'clamp', 'repeat', 'mirror' or 'black'. Default 'black'.",
  },
  chroma: {
    radial: 'true splits along the radius like a real lens — none at the center, most at the corners. Default false, a uniform split in one direction.',
    angle: 'Direction of the split when it is not radial, in radians. Default 0, horizontal. A texture here swings the split around per pixel; .mul(6.28) on the map covers the full turn.',
    center: '[x, y] a radial split radiates from, in UV. Default [0.5, 0.5]. A texture takes x from red and y from green.',
  },
  threshold: {
    soft: 'Width of the ramp either side of the cut. Default 0, a hard black-and-white edge. A texture makes the cut hard in some places and feathered in others.',
  },
  ascii: {
    chars: "The vocabulary, ordered dark→bright — an unsorted set reads as noise. A set name, or any string of your own, which is what an unrecognized one is taken as. Default 'ascii' ( .:-=+*#%@).",
    cols: 'How many characters across the frame. Default 80.',
    rows: 'How many down. Default: whatever keeps each cell the same shape as the glyph in it, so the characters come out unstretched — set it yourself and they stretch to fit.',
    color: 'One ink color for every character — a green here is the terminal look. Default: none, so each cell takes the color of the image under it.',
    bg: 'What fills a cell where the glyph has no ink. Default black.',
    font: "Any CSS family name, 'google:Name', or a font URL. Default a monospace stack. A proportional face works, but every glyph is fitted to the widest in the set.",
    weight: 'CSS weight, 100..900. Default 400. Heavier ink brightens the whole image, since every glyph carries more of it.',
  },
  displace: {
    amount: 'How far pixels move, in UV. Default 0.1. Negative pulls the other way.',
    mid: 'The map value that means no movement. Default 0.5 for mid-gray maps; use 0 for a dark map you only want to push one way.',
  },
  comp: {
    mode: "Blend mode. Default 'over'. add and screen are the ones that drop a black background; luminosity/color are the non-separable pair that split luma from chroma.",
    opacity: 'How much of the blended result mixes back in, 0..1. Default 1. Takes a fn of t.',
  },
  bloom: {
    threshold: 'How bright a pixel must be before it glows. Default 0.7. Drop it to bloom the whole image.',
    strength: 'How much glow is added back on top. Default 1.',
    radius: 'Blur radius of the glow, in texels. Default 1 — the pass runs at half resolution, so it spreads twice as far as the number suggests.',
  },
  delay: {
    scale: 'Fraction of the frame size the history is stored at. Default 1, and a ceiling rather than a promise: a delay too long to hold at that size is stored smaller anyway, down to a quarter, rather than being shortened. Halving it quarters the memory per stored frame, so it is worth setting deliberately whenever the delayed copy is diffed, masked or blurred rather than looked at — and worth leaving at 1 for a short delay you want exact. Fixed when the chain is built.',
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
  light: 'ambient directional point spot hemi',
  texture: 'scene depth input constant ramp circle ring video videofile imagefile imageseq noise voronoi text',
  signal: 'beat audio audiofile rand sig T mouse',
};

const methodKinds = {
  geo: 'position rotation scale align shadow noise instance material color sample normal out',
  light: 'position target out',
  inst: 'position rotation scale align color material',
  texture: `mirror kaleido radial polar edge slope normalMap levels add sub mul div pow contrast saturation gamma hue
        posterize pixellate ascii transform warp chroma translate rotate scale crop threshold invert
        remap lookup tint displace comp mask blur bloom delay feedback when tile out`,
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
