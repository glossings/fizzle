import { MATERIAL_GROUPS, MATERIAL_DOCS } from './materials.js';
import { BLEND_MODE_NAMES, ASCII_SET_NAMES } from './tops.js';

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
  sphere: ['sphere({ radius, res })', 'Sphere geometry op. Chain .pos/.rotate/.scale/.noise/.instance/.material, end with .out().'],
  box: ['box({ width, height, depth, res })', 'Box geometry op. res adds subdivisions for .noise displacement.'],
  plane: ['plane({ width, height, res })', 'Plane geometry op (double-sided). Great for noise terrain.'],
  torus: ['torus({ radius, tube, res })', 'Torus geometry op.'],
  torusKnot: ['torusKnot({ radius, tube, res, p, q })', 'Torus knot geometry op.'],
  cylinder: ['cylinder({ radiusTop, radiusBottom, height, res })', 'Cylinder geometry op.'],
  icosa: ['icosa({ radius, detail })', 'Icosahedron geometry op — even triangle distribution, ideal for noise blobs.'],
  model: ["model(name?, { center, fit })", "Geometry op from an imported .obj/.fbx — chain .pos/.rotate/.scale/.noise/.instance/.material/.out() like any other shape.\nDrag a model in to import it (stored in the browser, survives reloads); an empty call opens a picker. name = filename, exact or substring.\nEvery mesh in the file merges into one geometry and its own materials are dropped, so shade it with .material()."],

  ambient: ['ambient({ intensity, color })', "Ambient light — an even fill from every direction at once, so it casts no shadows and has nowhere to be. The one light that adds itself: .out() is optional, and only worth chaining to light a single layer.\nPositional ambient(intensity, color) also works."],
  directional: ['directional({ color, intensity, shadow })', 'Directional light — parallel rays, like the sun. Chain .pos(x,y,z).target(x,y,z).out(); pos, target, color and intensity take fns of t.'],
  point: ['point({ color, intensity, distance, decay, shadow })', "Point light — a bare bulb, throwing light every way at once. Chain .pos(x,y,z).out(); pos, color and intensity take fns of t.\nintensity: t => 30 * (0.8 + 0.2 * rand(13)(t)) is a fluorescent buzz."],
  spot: ['spot({ color, intensity, angle, penumbra, distance, decay, shadow })', 'Spot light — a cone from .pos(x,y,z) toward .target(x,y,z) (the origin without one). The natural partner for shadow: true, since a cone of light is a cone of shadow.'],
  hemi: ['hemi({ sky, ground, intensity })', 'Hemisphere light — sky color from above, bounce from below. Chain .out(). Ambient-ish, so it casts no shadows.'],

  hdri: ['hdri(name?, { background, intensity, blur, rotation, backgroundRotation, backgroundIntensity })', "Image-based lighting from an imported .hdr/.exr: it lights every material in the scene and shows behind it. Metalness only comes alive with one — a metal surface has nothing to reflect otherwise.\nAn empty hdri() opens the Poly Haven browser and writes your pick back into the call; you can also drag a file in. Every option but background takes a fn of t."],

  camera: ['camera(x, y, z, [tx, ty, tz])', 'Static numbers: place camera, orbit stays live. Any fn of t: sketch drives the camera, orbit disabled.'],
  bg: ['bg(color)', 'Scene background color. Hex, CSS name, or [r, g, b] 0..1; a fn of t (or a channel that is one) repaints it every frame.'],
  resolution: ['resolution(width, height)', "Pin the render to an exact pixel size and shape instead of the browser window. The main window letterboxes it — scaled to fit, centered, black around it — while the projector window (F1) takes that same aspect ratio, so full-screening the projector on a display of the same shape fills it edge to edge.\nresolution({ width, height }) and a single number for a square also work; drop the call to go back to filling the window. Sidebar quality scales the pixels underneath without changing the shape, so resolution(1920, 1080) at med renders 1440×810 and still presents 16:9."],
  fog: ['fog({ color, near, far })', 'Scene fog: geometry fades to color between near and far. depth() picks the same range up by default. Positional fog(color, near, far) also works.'],

  scene: ['scene()', 'TOP source: the lit 3D render of everything sent to a naked .out(), as a texture (tone-mapped display space).'],
  depth: ['depth({ near, far }) | depth({ focus, range })', "TOP source: the same 3D render as scene(), as a grayscale distance map — black near, white far, empty space white. Give it a focus instead and it measures distance from that plane, a ready-made depth-of-field mask.\nMostly you hand it to .mask(m, fn) to treat the image by distance: .mask(depth(), s => s.blur(8)) blurs the far, .mask(depth({ focus: 8, range: 5 }), s => s.blur(6)) is DOF, .mask(depth(), s => s.comp(ramp({ a: '#8a97a8', b: '#8a97a8' }), 'over')) is haze."],
  input: ['input(name?)', "TOP source: with no name, last frame's display output (comp it back in for trails). With a name, whatever .out(name) published — a TOP chain (same frame if acyclic, last frame if it loops — a named cycle is a feedback loop) or a geometry layer, rendered on black."],
  ramp: ["ramp({ type: 'linear'|'radial'|'angular', a, b, angle, phase })", 'TOP generator: two-color gradient.'],
  circle: ['circle({ radius, soft, center, color, bg })', 'TOP generator: soft-edged disc.'],
  video: ['video(name?)', "TOP generator: live camera. name matches a camera label (case-insensitive substring, e.g. video('facetime')); no name = default camera, and the console lists the available sources on start. Permission prompt on first use; black until the stream is live."],
  videofile: ["videofile(name?, { speed, loop, mute, restart })", "TOP generator: an imported video file, looping. Drag a file in to import it (stored in the browser, survives reloads); an empty call opens a picker and fills the name in. name = filename, exact or substring.\nctrl+r or restartMedia() rewinds everything by hand."],
  imagefile: ["imagefile(name?)", 'TOP generator: an imported image file (drag one in, or empty call = picker). An array delegates to imageseq().'],
  imageseq: ["imageseq(['a.png', ...], index?)", 'TOP generator: several imported images with a signal picking the current one (floored, wrapped) — imageseq(names, beat(1).counter()) steps each beat, .counter() of .kicks() steps on kicks. Default index: one per second.\nDropping several images at once types this call for you. Empty call = multi-file picker.'],
  noise: ['noise({ freq, octaves, lacunarity, gain, speed, seed, channels, a, b })', 'TOP generator: animated fbm simplex noise, shading from color a to color b — the workhorse source for .displace(), masks and lookups.\nThe output is normalized, so the octave keys change its texture rather than its level; reach for .contrast()/.mul() to set that. On a geometry chain .noise() displaces vertices instead.'],
  text: ["text('hi', { size, color, bg, pos, font, weight, align })", "TOP generator: canvas-rendered text on a solid background — comp it over a scene with add or screen to drop the bg. Content can be a fn of t; \\n for multiline."],
  text3d: ["text3d('hi', { size, depth, bevel, res, font, weight, center })", "Geometry op: 3D extruded text, chainable like any other shape. Renders in helvetiker until the font you named arrives."],

  beat: ['beat(div = 1)', 'Tempo-synced phase ramp 0..1 over div beats (tempo in the sidebar). Shape it: beat(2).sin() two-beat LFO, beat(0.25).sqr() sixteenth gates, rand().beat(1) sample-hold, beat(4).counter().select([...]) walks a list per bar.'],
  audio: ['audio(chan? | name?, chan?)', "Audio input level as a signal — a fn of t, usable in any parameter. Chain .mul/.add/.pow/.smooth/.kicks/.lowpass/.highpass/.bandpass; the first use starts capture.\naudio() is the mono mix of the sidebar's device, audio(2) one channel by index, audio('scarlett') a device by name (substring, and an unmatched one lists the inputs in the console), audio('scarlett', 2) a channel of it."],
  audiofile: ["audiofile(name?, { volume, speed, loop, restart, chan })", 'An imported audio file, played out loud and analysed like audio(): it returns its level as a signal, so chain .kicks/.lowpass/.smooth/etc. Empty call = picker; drag a file in to import. ctrl+r or restartMedia() rewinds by hand.'],
  restartMedia: ['restartMedia(name?)', 'Rewind imported media files to 0 — all of them, or by name (substring). In a sketch it runs on every execute; ctrl+r does the same from the keyboard.'],
  rand: ['rand({ freq: 1, seed: 0 })', 'Smooth random signal: deterministic value noise of t, 0..1 — the signal cousin of the noise() TOP. Positional rand(freq, seed) also works.\nrand().beat(4).mul(4).round() = random 0..4 per bar; rand().hold(audio().kicks()) = a new value per kick.'],
  sig: ['sig(fn)', 'Lift any fn of t into a chainable signal: sig(t => Math.sin(t)).smooth(0.2). Free-running LFOs stay plain fns; this just adds the processing methods.'],

  onFrame: ['onFrame((t, dt) => ...)', 'Register a raw per-frame callback.'],
  THREE: ['THREE', 'The full three.js namespace, for anything the API does not cover.'],
};

export const METHODS = {
  pos: ['.pos(x, y, z) | .pos(v)', 'Position. Each component is a number or fn of t; one vector argument ([x,y,z] or anything with x/y/z) also works, so .pos(pts.sample(i)) goes straight in.'],
  rotate: ['.rotate(x, y, z) | .rotate(v)', 'Geometry: rotation in radians (numbers or fns of t, or one vector) · TOP: .rotate(v, { wrap }) rotates the image around center.'],
  scale: ['.scale(x, y?, z?) | .scale(v)', 'Geometry: scale, one number = uniform, one vector = per-axis · TOP: .scale(v, { wrap }) zooms around center (scalar or [x, y]).'],
  translate: ['.translate(x, y, { wrap })', 'TOP: shift the image in UV space (1 = full frame).'],
  noise: ['.noise({ amp, freq, octaves, lacunarity, gain, speed, seed })', 'GPU fbm displacement along vertex normals, with the normals recomputed so lighting stays correct. It can only move vertices the shape already has — raise its res if nothing happens. .sample()/.normal() on the chain see the same field, so a noised shape works as a layout source.'],
  instance: ['.instance(count, (x, i, n, t) => x.pos(...))', 'Render as one InstancedMesh. The layout fn gets each copy as x and transforms it with the same verbs as the chain — .pos/.rotate/.scale, plus .color() to tint that copy. It runs every frame, so instances animate. i = copy index, n = count.\nFor a layout that follows another shape, .pos(pts.sample(i)) scatters the copies over its surface — see .sample().'],
  align: ['.align(v)', "Aim the shape's +Y axis along a direction vector — the rotation Euler angles can't state without a page of atan2. Its reason to exist is .align(pts.normal(i)), standing each copy up off the surface it was sampled from.\n+Y is the axis because that's where a cylinder() or a cone already points. .rotate() still applies, in the shape's own frame before the aim: a Y-only rotation rolls it about the aimed axis and leaves the aim alone, while an X or Z one leans it off by that angle. Components take fns of t."],
  sample: ['.sample(i)', "The i-th point of a fixed scatter over this shape's surface, as {x, y, z} — a geometry used as a layout source rather than something drawn. The shape needn't be in the scene: an op that never reaches .out() renders nothing, so const pts = icosa({ radius: 3 }) then .instance(400, (x, i) => x.pos(pts.sample(i))) skins one shape onto another.\nPoints are area-weighted across the triangles and stable across re-runs, so editing a sketch doesn't reshuffle them. The source's whole chain applies: its .noise() puts the points on the deformed surface (the same field, re-run on the CPU), then its .pos/.rotate/.scale/.align place them, so a layout can be noised, placed, or spun. Either one makes the points a fn of t, so results can only be worked out ahead of the layout fn while the source is still."],
  normal: ['.normal(i)', 'The surface normal at .sample(i), as {x, y, z} — which way the shape faces there. Hand it to .align() to stand copies up off the surface, or read a component to drive scale or color by facing.'],
  material: ['.material({ color, roughness, metalness, emissive, opacity, transmission, clearcoat, iridescence, pbr, map, normalMap, repeat, flatShading, wireframe, doubleSide })', "How the surface takes light: a standard PBR material, upgraded to three's physical one the moment you name a glass or coating key — so a sketch that never mentions them pays nothing.\nAn empty .material() opens the Poly Haven browser and writes your pick back into the call. Every value takes a fn of t; every map slot takes an imported image by name, or a live TOP chain."],
  color: ['.color(c)', "Shorthand for .material({ color }).\nFour forms, everywhere a color is taken: '#4fd1c5', a CSS name, 0x4fd1c5, or [r, g, b] with channels 0..1. The whole color may be a fn of t or a signal — .color(kickCounter.select(palette)) — and each channel of the array may be its own, which is how you compute a color instead of listing one: .color([t => Math.sin(t) * 0.5 + 0.5, 0.2, audio()])."],
  target: ['.target(x, y, z) | .target(v)', 'Light: where a directional() or spot() points (the origin without one). Components take fns of t, so the beam can sweep, and one vector argument works like .pos(v). Point and hemisphere lights have no direction and reject it.'],
  shadow: ['.shadow(false | { cast, receive })  ·  light option: shadow: true | { map, soft, strength, bias, normalBias, near, far, area }', "Geometry casts and receives by default and costs nothing until some light casts, so on a mesh this is really the opt-out: .shadow(false) for both, or one side of it. On a light, shadow: true turns casting on (directional/spot/point) and the same object tunes it.\nThe one exception to that default: glass (transmission) and blended (opacity < 1) surfaces don't cast, because the depth pass can't tell they're see-through and would throw the solid shadow of their silhouette. .shadow(true) insists."],
  out: [".out(name?)", "Naked: geometry/light joins the visible scene; a TOP chain becomes the display output. With a name, publishes for input('name') instead: a TOP point (passthrough), a geometry as its own render layer, or a light lighting only that layer."],

  mirror: [".mirror({ axis: 'x'|'y'|'both', flip })", 'TOP: reflect one half of the image onto the other.'],
  kaleido: ['.kaleido(sides, { rotate })', 'TOP: polar kaleidoscope fold.'],
  edge: ['.edge({ strength, spread })', 'TOP: Sobel edge magnitude (grayscale).'],
  slope: ['.slope({ strength, spread })', 'TOP: neighbor-difference gradient, centered on 0.5, in RG.'],
  normalMap: ['.normalMap({ strength, spread })', 'TOP: tangent-space normal map from luma height.'],
  levels: ['.levels({ contrast, saturation, gamma, hue })', 'TOP: combined tonal adjust.'],
  hue: ['.hue(v)', 'TOP: hue rotation in turns — 0.5 is opposite colors, 1 a full lap. Animate with a fn of t or a signal.'],
  add: ['.add(v)', 'TOP: add v to every pixel (scalar or [r, g, b]; negative darkens) · audio signal: plain addition/offset.'],
  mul: ['.mul(v)', 'TOP: multiply every pixel by v (scalar or [r, g, b]) · audio signal: plain gain.'],
  pow: ['.pow(v)', 'Audio signal: raise to a power — <1 expands quiet detail, >1 emphasizes peaks.'],
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
  when: ['.when(cond, s => ...)', 'TOP: per-frame switch — while cond >= 0.5 the chain becomes fn(chain), otherwise it passes through. E.g. .when(audio().gte(0.3), s => s.kaleido(6)). Only the active branch renders.'],
  contrast: ['.contrast(v)', 'TOP: contrast around mid-gray (1 = unchanged).'],
  saturation: ['.saturation(v)', 'TOP: 0 = grayscale, 1 = unchanged, >1 boosts.'],
  gamma: ['.gamma(v)', 'TOP: gamma curve (1 = unchanged).'],
  posterize: ['.posterize(steps)', 'TOP: quantize values to n levels per channel.'],
  pixellate: ['.pixellate(x, y?)', 'TOP: quantize position into cells (square cells if y omitted).'],
  ascii: ['.ascii({ chars, cols, rows, color, bg, font, weight })', "Texture: redraw the image as a grid of characters, each cell taking the glyph whose ink matches its brightness. Cells keep the color of the image under them until you name one.\nchars is a set name — 'ascii', 'dense', 'blocks', 'numbers', 'letters', 'binary', 'dots' — or any string of your own, ordered dark→bright. Contrast decides how much of the set gets used, so .levels() ahead of it is the real dial."],
  transform: [".transform({ translate: [x,y], scale, rotate, wrap: 'clamp'|'repeat'|'mirror'|'black' })", 'TOP: UV-space transform. Shorthands: .translate(x, y), .rotate(v), .scale(v).'],
  warp: [".warp({ barrel, twist, zoom, center, wrap })", "Texture: radial UV warp — the CRT/fisheye lens. Radius is 1 at the frame corner, so barrel: 0.3 pulls the corners in by 30%. All params take fns of t."],
  chroma: ['.chroma(amount, { radial, angle, center })', "Texture: chromatic aberration — samples R and B at opposite UV offsets, G at center. amount is the split at the frame edge: 0.002-0.01 is subtle, more is glitch, and it takes a fn of t."],
  mask: ['.mask(maskTop, fn?)', 'TOP: without fn, multiply by the mask\'s luma (cutout). With fn, apply it only where the mask is bright: .mask(circle(), s => s.displace(...)) displaces inside the circle only. Mask and fn both accept fn-of-chain.'],
  threshold: ['.threshold(level, { soft })', 'TOP: luma threshold to a black/white mask.'],
  invert: ['.invert()', 'TOP: invert colors.'],
  remap: ['.remap(mapTop)', "Texture: absolute UV lookup — sample this chain at the map's RG coordinates. Map can be a fn of the chain so far."],
  lookup: ['.lookup(rampTop)', "Texture: recolor by luma — each pixel's luminance indexes the ramp left-to-right. .lookup(ramp({ a: 'black', b: 'red' })). Ramp can be a fn of the chain so far."],
  displace: ['.displace(map, { amount: 0.1, mid: 0.5 })', "Texture: push each pixel sideways by what the map says there, reading the offset from its red and green. Positional .displace(map, amount) also works, and the map can be a fn of the chain so far.\nA grayscale map moves everything along the diagonal — noise({ channels: 2 }) for a wobble that goes both ways."],
  comp: [".comp(layer, { mode, opacity })", 'TOP: composite layer over this chain. layer may be a fn of the chain so far — .comp(s => s.edge(), \'add\') overlays your own edges. Positional .comp(layer, mode, opacity) also works.\nModes: over add sub mult screen overlay hardLight softLight darken lighten difference exclusion dodge burn divide luminosity color. luminosity takes the layer\'s brightness and keeps the base\'s colour (color is the reverse) — how you put a sharp luma back on a blurred chroma.'],
  blur: ['.blur(radius)', 'TOP: separable gaussian blur, radius in texels. An [x, y] radius blurs per axis — .blur([8, 0]) smears horizontally only; an axis at 0 skips its pass.'],
  bloom: ['.bloom({ threshold, strength, radius })', 'TOP: brightpass + half-res gaussian glow.'],
  tile: ['.tile(nx, ny, (src, i, x, y) => variant)', 'TOP: tile nx×ny with a per-cell chain. fn may return src, a treatment of it, or any TOP; identical variants dedupe, and each distinct one renders its own pass — like comping that many .out()s. x left→right, y bottom→top, i = y*nx + x.'],
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
// signature, and tops.js owns the list that resolves them.
METHOD_CONFIG.comp.get('mode').values = BLEND_MODE_NAMES;

// .ascii({ chars }) takes either a named set or a literal vocabulary, so the
// names are a starting point rather than the whole domain — offered from the
// table that resolves them, and free to be typed over.
METHOD_CONFIG.ascii.get('chars').values = ASCII_SET_NAMES;

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
    height: 'Size along Y (the plane starts upright — .rotate(-Math.PI/2, 0, 0) lays it flat). Default 10.',
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
  icosa: {
    radius: 'Radius in world units. Default 1.',
    detail: 'Subdivision level, 0..9. Default 8. Triangles stay evenly sized at any level, which is why this is the shape to .noise() into a blob.',
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
    phase: 'Slides the gradient along itself. Default 0 — animate it for a scrolling wipe.',
  },
  circle: {
    radius: 'Radius in UV units, so 0.5 touches the frame edge. Default 0.25.',
    soft: 'Width of the fade at the rim. Default 0.01, near-hard; 0.2 is a soft glow.',
    center: '[x, y] in UV, 0..1 from bottom-left. Default [0.5, 0.5].',
    color: 'Color inside the disc. Default white.',
    bg: 'Color outside it. Default black.',
  },
  videofile: {
    speed: 'Playback rate: 1 normal, 0.5 half, 0 freezes the frame. Takes a fn of t.',
    loop: 'Start over at the end. Default true.',
    mute: 'Default true. false lets the file\'s own audio play out loud.',
    restart: 'Rewinds whenever this crosses 0.5 upward — restart: beat(8).sqr(0.05) retriggers every 8 beats.',
  },
  noise: {
    freq: 'How many cells of noise span the frame. Default 4 — low is big soft blobs, 30+ is fine grain.',
    octaves: 'Layers of finer detail stacked on top, 1..8. Default 3.',
    lacunarity: 'How much finer each octave is than the last. Default 2, meaning twice.',
    gain: 'How much quieter each octave is than the last. Default 0.5. Near 0 stays smooth and cloudy, near 1 goes rough and grainy.',
    speed: 'How fast the field churns. Default 0.3; 0 freezes it into a still.',
    seed: 'Picks a different field of the same character. Reach for this when the shape is wrong but the settings are right.',
    channels: '1 for grayscale, 2-4 for independent fields in R/G/B/A. Default 1. Feed channels: 2 to .displace() so it wobbles both ways instead of along the diagonal.',
    a: 'Color the low end shades to. Default black.',
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
    font: "A font name, 'google:Name', or a .ttf/.otf/.typeface.json URL. Renders in helvetiker until the real one arrives.",
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
    freq: 'Size of the bumps — how many across the shape. Default 1.5. High freq with low amp is crinkle, the reverse is a slow wobble.',
    octaves: 'Layers of finer detail stacked on top, 1..8. Default 3.',
    lacunarity: 'How much finer each octave is than the last. Default 2.',
    gain: 'How much smaller each octave is than the last. Default 0.5. Low stays smooth, high goes crinkly.',
    speed: 'How fast the surface churns. Default 0.3; 0 freezes it.',
    seed: 'Picks a different field, for a different shape at the same settings.',
  },
  translate: {
    wrap: "What fills the space shifted in from off-frame: 'clamp' smears the edge pixel, 'repeat' tiles, 'mirror' reflects, 'black' leaves it empty. Default 'clamp'.",
  },
  mirror: {
    axis: "'x' folds left onto right, 'y' bottom onto top, 'both' does each in turn. Default 'x'.",
    flip: 'Which half survives. Default false keeps the near side, true keeps the far one.',
  },
  kaleido: {
    rotate: 'Spins the fold pattern, in radians. Animate it for the turning-kaleidoscope look.',
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
    gamma: 'Default 1. Below 1 lifts the shadows, above 1 crushes them.',
    hue: 'Rotation in turns: 0.5 is the opposite color, 1 a full lap. Default 0.',
  },
  kicks: {
    threshold: 'How far above its own moving average the level must jump to fire. Default 1.5 — lower catches more hits, higher only the hardest.',
    decay: 'How fast the 1 falls back to 0, per second. Default 6; lower leaves a longer tail to ride.',
    floor: 'Level below which nothing fires, so a quiet passage stays quiet. Default 0.05.',
  },
  transform: {
    translate: '[x, y] shift in UV, where 1 is a whole frame. Default [0, 0].',
    scale: 'Zoom about the center. A number, or [x, y] to stretch. Default 1.',
    rotate: 'Rotation about the center, in radians. Default 0.',
    wrap: "What fills the space moved in from off-frame: 'clamp', 'repeat', 'mirror' or 'black'. Default 'clamp'.",
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
    angle: 'Direction of the split when it is not radial, in radians. Default 0, horizontal.',
    center: '[x, y] a radial split radiates from, in UV. Default [0.5, 0.5].',
  },
  threshold: {
    soft: 'Width of the ramp either side of the cut. Default 0, a hard black-and-white edge.',
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
// (GeoOp / LightOp / InstanceHandle), tops.js (TopOp) and audio.js (sig).

const names = (s) => s.trim().split(/\s+/);

const globalKinds = {
  geo: 'sphere box plane torus torusKnot cylinder icosa model text3d',
  light: 'ambient directional point spot hemi',
  top: 'scene depth input ramp circle video videofile imagefile imageseq noise text',
  signal: 'beat audio audiofile rand sig',
};

const methodKinds = {
  geo: 'pos rotate scale align shadow noise instance material color sample normal out',
  light: 'pos target out',
  inst: 'pos rotate scale align color material',
  top: `mirror kaleido edge slope normalMap levels add mul contrast saturation gamma hue
        posterize pixellate ascii transform warp chroma translate rotate scale threshold invert
        remap lookup displace comp mask blur bloom when tile out`,
  signal: `add mul pow round floor ceil abs gte lte counter select sin tri saw sqr beat hold
           kicks smooth lowpass highpass bandpass`,
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
// .instance(n, x => …) gives an instance handle, .tile/.mask/.when a TOP.
export const CALLBACK_KIND = {
  instance: 'inst',
  tile: 'top', mask: 'top', when: 'top', comp: 'top',
  displace: 'top', remap: 'top', lookup: 'top',
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
// front of it, so neither "e.g. " nor the ".obj/.fbx " and ".pos/.rotate/"
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
