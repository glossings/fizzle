import { hoverTooltip } from '@codemirror/view';

// One docs table drives both autocomplete and ctrl+hover tooltips.
// detail = signature shown next to the completion / tooltip header
// info   = one-liner description

export const GLOBALS = {
  sphere: ['sphere({ radius, res })', 'Sphere geometry op. Chain .pos/.rotate/.scale/.noise/.instance/.material, end with .out().'],
  box: ['box({ width, height, depth, res })', 'Box geometry op. res adds subdivisions for .noise displacement.'],
  plane: ['plane({ width, height, res })', 'Plane geometry op (double-sided). Great for noise terrain.'],
  torus: ['torus({ radius, tube, res })', 'Torus geometry op.'],
  torusKnot: ['torusKnot({ radius, tube, res, p, q })', 'Torus knot geometry op.'],
  cylinder: ['cylinder({ radiusTop, radiusBottom, height, res })', 'Cylinder geometry op.'],
  icosa: ['icosa({ radius, detail })', 'Icosahedron geometry op — even triangle distribution, ideal for noise blobs.'],
  model: ["model(name?, { center, fit })", "Geometry op from an imported .obj/.fbx — chain .pos/.rotate/.scale/.noise/.instance/.material/.out() like any other shape. Drag a model into the window to import it (stored in the browser, survives reloads); an empty call opens a file picker. name = filename, exact or case-insensitive substring. All meshes in the file merge into one geometry and the file's own materials are dropped — shade it with .material(). center: true and fit: 2 (scale the longest axis to 2) by default so any file lands at a usable size; fit: 0 keeps the file's units. Parsing is cached across re-runs."],

  ambient: ['ambient(intensity, color?)', 'Ambient light, added immediately (no .out() needed).'],
  directional: ['directional({ color, intensity })', 'Directional light. Chain .pos(x,y,z).out().'],
  point: ['point({ color, intensity, distance, decay })', 'Point light. Chain .pos(x,y,z).out(); pos accepts fns of t.'],
  hemi: ['hemi({ sky, ground, intensity })', 'Hemisphere light. Chain .out().'],

  hdri: ['hdri(name?, { background, intensity, blur, rotation })', "Image-based lighting from an imported .hdr/.exr: the environment lights every material in the scene and shows behind it. An empty hdri() opens the Poly Haven HDRI browser and writes your pick back into that call; you can also drag a file in. Metalness only comes alive with one — a metal surface has nothing to reflect otherwise. background: false keeps bg()/fog; blur (0..1) softens the visible sky without softening the light; rotation turns the light rig and sky together (backgroundRotation moves the sky alone). All but background accept fns of t — hdri('sky_2k.hdr', { rotation: t => t * 0.1 }) drifts the whole sky."],

  camera: ['camera(x, y, z, [tx, ty, tz])', 'Static numbers: place camera, orbit stays live. Any fn of t: sketch drives the camera, orbit disabled.'],
  bg: ['bg(color)', 'Scene background color.'],
  fog: ['fog(color, near, far)', 'Scene fog.'],

  scene: ['scene()', 'TOP source: the lit 3D render of everything sent to a naked .out(), as a texture (tone-mapped display space).'],
  input: ['input(name?)', "TOP source: with no name, last frame's display output (comp it back in for trails). With a name, whatever .out(name) published — a TOP chain (same frame if acyclic, last frame if it loops — a named cycle is a feedback loop) or a geometry layer, rendered on black."],
  feedback: ['feedback(name?)', 'Legacy alias of input().'],
  ramp: ["ramp({ type: 'linear'|'radial'|'angular', a, b, angle, phase })", 'TOP generator: two-color gradient.'],
  circle: ['circle({ radius, soft, center, color, bg })', 'TOP generator: soft-edged disc.'],
  video: ['video(name?)', "TOP generator: live camera. name matches a camera label (case-insensitive substring, e.g. video('facetime')); no name = default camera. The console lists the available sources on start (and when a name doesn't match). Permission prompt on first use; black until the stream is live."],
  videofile: ["videofile(name?, { speed, loop, mute, restart })", "TOP generator: an imported video file, looping. Drag a file into the window to import it (stored in the browser, survives reloads); an empty call opens a file picker and fills the name in. name = filename, exact or substring. speed/loop are fns of t; restart rewinds on a rising edge (e.g. restart: beat(8).sqr(0.05)); mute: false unmutes. ctrl+r / restartMedia() rewinds manually."],
  imagefile: ["imagefile(name?)", 'TOP generator: an imported image file (drag one in, or empty call = picker). An array delegates to imageseq().'],
  imageseq: ["imageseq(['a.png', ...], index?)", 'TOP generator: several imported images with a signal picking the current one (floored, wrapped) — imageseq(names, beat(1).counter()) steps each beat, .counter() of .kicks() steps on kicks. Default index: one per second. Dropping several images at once types this call for you. Empty call = multi-file picker.'],
  noise: ['noise({ freq, octaves, lacunarity, gain, speed, seed, channels, a, b })', 'TOP generator: animated fbm simplex noise shading from color a (low) to b (high). octaves stacks detail layers; lacunarity = frequency step per octave (2 = each layer twice as fine); gain = amplitude falloff per octave (low = smooth blobs, high = rough grain — output is normalized, so gain shapes texture, not brightness; use .contrast()/.mul() for level). seed picks a different field. channels: 2-4 = independent fields in R/G(/B/A) — feed channels: 2 to .displace() for isotropic wobble. (On a geometry chain, .noise() displaces vertices instead.)'],
  text: ["text('hi', { size, color, bg, pos, font, weight, align })", "TOP generator: canvas-rendered text. size = font size in screen px (like CSS; values <= 1 = fraction of screen height). Any CSS font name, 'google:Name', or a font URL; \\n for multiline. Content can be a fn of t; comp over a scene with add/screen."],
  text3d: ["text3d('hi', { size, depth, bevel, res, font, weight, center })", "3D extruded text. font: a name (installed fonts, then Google Fonts), 'google:Name', or a .ttf/.otf/.typeface.json URL. Renders in helvetiker until the font arrives."],

  beat: ['beat(div = 1)', 'Tempo-synced phase ramp 0..1 over div beats (tempo in the sidebar). Shape it: beat(2).sin() two-beat LFO, beat(0.25).sqr() sixteenth gates, rand().beat(1) sample-hold, beat(4).counter().select([...]) walks a list per bar.'],
  audio: ['audio(chan? | name?, chan?)', "Audio input level as a signal — a fn of t, usable in any parameter. audio() = mono mix of the sidebar's device, audio(2) = one channel by index, audio('scarlett') = an input device by name (case-insensitive substring; an unmatched name lists the available inputs in the console), audio('scarlett', 2) = a channel of it. Chain .mul/.add/.pow/.smooth/.kicks/.lowpass/.highpass/.bandpass. First use starts capture."],
  audiofile: ["audiofile(name?, { volume, speed, loop, restart, chan })", 'An imported audio file, played out loud and analysed like audio(): returns its level as a signal — chain .kicks/.lowpass/.smooth/etc. Empty call = picker; drag a file in to import. restart rewinds on a rising edge; ctrl+r / restartMedia() rewinds manually.'],
  restartMedia: ['restartMedia(name?)', 'Rewind imported media files to 0 — all of them, or by name (substring). In a sketch it runs on every execute; ctrl+r does the same from the keyboard.'],
  rand: ['rand({ freq: 1, seed: 0 })', 'Smooth random signal: deterministic value noise of t, 0..1 — the signal cousin of the noise() TOP. freq scales wiggle speed; different seeds are independent — rand({ seed: i }) in a tile/instance fn gives each copy its own. Positional rand(freq, seed) also works. rand().beat(4).mul(4).round() = random 0..4 per bar; rand().hold(audio().kicks()) = per kick.'],
  sig: ['sig(fn)', 'Lift any fn of t into a chainable signal: sig(t => Math.sin(t)).smooth(0.2). Free-running LFOs stay plain fns; this just adds the processing methods.'],

  onFrame: ['onFrame((t, dt) => ...)', 'Register a raw per-frame callback.'],
  THREE: ['THREE', 'The full three.js namespace, for anything the API does not cover.'],
};

export const METHODS = {
  pos: ['.pos(x, y, z)', 'Position. Each component is a number or fn of t.'],
  rotate: ['.rotate(x, y, z)', 'Geometry: rotation in radians (numbers or fns of t) · TOP: .rotate(v, { wrap }) rotates the image around center.'],
  scale: ['.scale(x, y?, z?)', 'Geometry: scale, one argument = uniform · TOP: .scale(v, { wrap }) zooms around center (scalar or [x, y]).'],
  translate: ['.translate(x, y, { wrap })', 'TOP: shift the image in UV space (1 = full frame).'],
  noise: ['.noise({ amp, freq, octaves, lacunarity, gain, speed, seed })', 'GPU fbm displacement along vertex normals; normals recomputed so lighting stays correct. amp = displacement distance, freq = spatial frequency; octaves stacks detail layers, lacunarity = frequency step per octave, gain = amplitude falloff per octave (low = smooth, high = crinkly). seed offsets the field for a different shape.'],
  instance: ['.instance(count, (x, i, n, t) => x.pos(...))', 'Render as one InstancedMesh. The layout fn gets each copy as x and transforms it with the same verbs as the chain — .pos/.rotate/.scale, plus .color() to tint that copy. It runs every frame, so instances animate. i = copy index, n = count.'],
  material: ['.material({ color, roughness, metalness, emissive, opacity, transmission, clearcoat, iridescence, pbr, map, normalMap, repeat, flatShading, wireframe, doubleSide })', "PBR material settings. An empty .material() opens the Poly Haven material browser and writes your pick back into that call. Textures: pbr: 'rock_2k' takes a whole set of maps at once — a browsed material, or a folder dragged in. Individual slots take an imported image by name: map (color), normalMap, roughnessMap, metalnessMap, aoMap, displacementMap, or arm for one packed AO/rough/metal image. repeat tiles them (a number, or [x, y]), offset shifts them, uvRotate turns them. Tuning: normalScale, aoIntensity, displaceScale, envIntensity. roughness/metalness multiply their maps, so name them only to push a material further. doubleSide renders back faces too — on by default for plane() and model(), off for the solid primitives. Blending: opacity (turns on transparency by itself), transparent, depthWrite. Glass and coatings — naming any of these switches to three's physical material: transmission (see-through, 0..1), thickness + ior + dispersion (refraction through a volume), attenuationColor/attenuationDistance (what the volume tints light), clearcoat + clearcoatRoughness (lacquer), iridescence + iridescenceIOR + iridescenceThickness (soap-bubble film, thickness in nm), sheen + sheenColor + sheenRoughness (cloth fuzz), anisotropy + anisotropyRotation (brushed metal), specularIntensity, specularColor, reflectivity. All of them take fns of t like everything else."],
  color: ['.color(c)', 'Shorthand for .material({ color }). Colors may be fns of t or signals — e.g. .color(kickCounter.select(palette)).'],
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
  transform: [".transform({ translate: [x,y], scale, rotate, wrap: 'clamp'|'repeat'|'mirror'|'black' })", 'TOP: UV-space transform. Shorthands: .translate(x, y), .rotate(v), .scale(v).'],
  warp: [".warp({ barrel, twist, zoom, center, wrap })", "Texture: radial UV warp — the CRT/fisheye lens. barrel bulges the image outward like a CRT face (0.2-0.4 is a screen, negative pincushions), twist rotates by radius in radians (spiral), zoom scales about the center. Radius is 1 at the frame corner, so barrel: 0.3 pulls the corners in 30%. Outside the frame goes black by default (wrap: 'clamp'|'repeat'|'mirror' for the alternatives). All params take fns of t."],
  chroma: ['.chroma(amount, { radial, angle, center })', "Texture: chromatic aberration — samples R and B at opposite UV offsets, G at center. amount is the split at the frame edge (0.002-0.01 is subtle, more is glitch). Directional by default; angle turns the split, radial: true makes it lens-like — zero at the center, growing toward the corners. amount and angle take fns of t."],
  mask: ['.mask(maskTop, fn?)', 'TOP: without fn, multiply by the mask\'s luma (cutout). With fn, apply it only where the mask is bright: .mask(circle(), s => s.displace(...)) displaces inside the circle only. Mask and fn both accept fn-of-chain.'],
  threshold: ['.threshold(level, { soft })', 'TOP: luma threshold to a black/white mask.'],
  invert: ['.invert()', 'TOP: invert colors.'],
  remap: ['.remap(mapTop)', "Texture: absolute UV lookup — sample this chain at the map's RG coordinates. Map can be a fn of the chain so far."],
  lookup: ['.lookup(rampTop)', "Texture: recolor by luma — each pixel's luminance indexes the ramp left-to-right. .lookup(ramp({ a: 'black', b: 'red' })). Ramp can be a fn of the chain so far."],
  displace: ['.displace(map, { amount: 0.1, mid: 0.5 })', "Texture: offset UVs by the map's RG minus mid, scaled by amount (0.5 = mid-gray neutral; mid: 0 makes black neutral for dark maps). Positional .displace(map, amount) also works. Grayscale maps move along the diagonal only — use noise({ channels: 2 }) for isotropic. Map can be a fn of the chain so far."],
  comp: [".comp(layer, mode, opacity)", 'TOP: composite layer over this chain. layer may be a fn of the chain so far — .comp(s => s.edge(), \'add\') overlays your own edges. Modes: over add sub mult screen overlay hardLight softLight darken lighten difference exclusion dodge burn.'],
  blur: ['.blur(radius)', 'TOP: separable gaussian blur.'],
  bloom: ['.bloom({ threshold, strength, radius })', 'TOP: brightpass + half-res gaussian glow.'],
  tile: ['.tile(nx, ny, (src, i, x, y) => variant)', 'TOP: tile nx×ny with a per-cell chain. fn may return src, a treatment of it, or any TOP; identical variants dedupe, and each distinct one renders its own pass — like comping that many .out()s. x left→right, y bottom→top, i = y*nx + x.'],
};

const globalOptions = Object.entries(GLOBALS).map(([label, [detail, info]]) => ({
  label, type: 'function', detail, info,
}));
const methodOptions = Object.entries(METHODS).map(([label, [detail, info]]) => ({
  label, type: 'method', detail, info,
}));

// completion source, registered via javascriptLanguage.data
export function apiCompletions(context) {
  const dot = context.matchBefore(/\.(\w*)$/);
  if (dot) {
    return { from: dot.from + 1, options: methodOptions, validFor: /^\w*$/ };
  }
  const word = context.matchBefore(/\w+$/);
  if (!word && !context.explicit) return null;
  return { from: word ? word.from : context.pos, options: globalOptions, validFor: /^\w*$/ };
}

// ctrl+hover docs
let ctrlHeld = false;
window.addEventListener('keydown', (e) => { if (e.key === 'Control') ctrlHeld = true; });
window.addEventListener('keyup', (e) => { if (e.key === 'Control') ctrlHeld = false; });
window.addEventListener('blur', () => { ctrlHeld = false; });

export const apiHover = hoverTooltip((view, pos) => {
  if (!ctrlHeld) return null;
  const range = view.state.wordAt(pos);
  if (!range) return null;
  const word = view.state.doc.sliceString(range.from, range.to);
  const isMethod = range.from > 0 && view.state.doc.sliceString(range.from - 1, range.from) === '.';
  const entry = isMethod ? METHODS[word] : GLOBALS[word] ?? METHODS[word];
  if (!entry) return null;
  return {
    pos: range.from,
    end: range.to,
    above: true,
    create() {
      const dom = document.createElement('div');
      dom.className = 'td-doc';
      const sig = document.createElement('div');
      sig.className = 'td-doc-sig';
      sig.textContent = entry[0];
      const body = document.createElement('div');
      body.textContent = entry[1];
      dom.append(sig, body);
      return { dom };
    },
  };
}, { hoverTime: 120 });
