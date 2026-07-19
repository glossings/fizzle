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

  ambient: ['ambient(intensity, color?)', 'Ambient light, added immediately (no .out() needed).'],
  directional: ['directional({ color, intensity })', 'Directional light. Chain .pos(x,y,z).out().'],
  point: ['point({ color, intensity, distance, decay })', 'Point light. Chain .pos(x,y,z).out(); pos accepts fns of t.'],
  hemi: ['hemi({ sky, ground, intensity })', 'Hemisphere light. Chain .out().'],

  camera: ['camera(x, y, z, [tx, ty, tz])', 'Static numbers: place camera, orbit stays live. Any fn of t: sketch drives the camera, orbit disabled.'],
  bg: ['bg(color)', 'Scene background color.'],
  fog: ['fog(color, near, far)', 'Scene fog.'],

  scene: ['scene()', 'TOP source: the lit 3D render of everything sent to a naked .out(), as a texture (tone-mapped display space).'],
  input: ['input(name?)', "TOP source: with no name, last frame's display output (comp it back in for trails). With a name, whatever .out(name) published — a TOP chain (same frame if acyclic, last frame if it loops — a named cycle is a feedback loop) or a geometry layer, rendered on black."],
  feedback: ['feedback(name?)', 'Legacy alias of input().'],
  ramp: ["ramp({ type: 'linear'|'radial'|'angular', a, b, angle, phase })", 'TOP generator: two-color gradient.'],
  circle: ['circle({ radius, soft, center, color, bg })', 'TOP generator: soft-edged disc.'],
  noise: ['noise({ freq, octaves, lacunarity, gain, speed, a, b })', 'TOP generator: animated fbm simplex noise. (On a geometry chain, .noise() displaces vertices instead.)'],
  text: ["text('hi', { size, color, bg, pos, font, weight, align })", "TOP generator: canvas-rendered text (any CSS font name, 'google:Name', or a font URL; \\n for multiline). Content can be a fn of t; comp over a scene with add/screen."],
  text3d: ["text3d('hi', { size, depth, bevel, res, font, weight, center })", "3D extruded text. font: a name (installed fonts, then Google Fonts), 'google:Name', or a .ttf/.otf/.typeface.json URL. Renders in helvetiker until the font arrives."],

  audio: ['audio(chan?)', 'Audio input level as a signal — a fn of t, usable in any parameter. Mono mix by default, or one channel by index (inputs can be >2ch). Chain .mul/.add/.pow/.smooth/.lowpass/.highpass/.bandpass. First use starts capture; pick the device in the sidebar.'],
  kicks: ['kicks({ band: [30, 160], threshold: 1.5, decay: 6 })', 'Onset detector on the audio input: jumps to 1 on each hit in the band (defaults tuned for kick drums), then decays. Use like any fn of t, e.g. scale(kicks().add(1)).'],

  onFrame: ['onFrame((t, dt) => ...)', 'Register a raw per-frame callback.'],
  THREE: ['THREE', 'The full three.js namespace, for anything the API does not cover.'],
};

export const METHODS = {
  pos: ['.pos(x, y, z)', 'Position. Each component is a number or fn of t.'],
  rotate: ['.rotate(x, y, z)', 'Rotation in radians (numbers or fns of t). On TOPs, use .transform({ rotate }).'],
  scale: ['.scale(x, y?, z?)', 'Scale; one argument scales uniformly.'],
  noise: ['.noise({ amp, freq, octaves, lacunarity, gain, speed })', 'GPU fbm displacement along vertex normals; normals recomputed so lighting stays correct.'],
  instance: ['.instance(count, (i, n, t) => ({ pos, rot, scale }))', 'Render as one InstancedMesh; the layout fn runs every frame so instances animate.'],
  material: ['.material({ color, roughness, metalness, emissive, flatShading, wireframe })', 'PBR material settings.'],
  color: ['.color(c)', 'Shorthand for .material({ color }).'],
  out: [".out(name?)", "Naked: geometry/light joins the visible scene; a TOP chain becomes the display output. With a name, publishes for input('name') instead: a TOP point (passthrough), a geometry as its own render layer, or a light lighting only that layer."],

  mirror: [".mirror({ axis: 'x'|'y'|'both', flip })", 'TOP: reflect one half of the image onto the other.'],
  kaleido: ['.kaleido(sides, { rotate })', 'TOP: polar kaleidoscope fold.'],
  edge: ['.edge({ strength, spread })', 'TOP: Sobel edge magnitude (grayscale).'],
  slope: ['.slope({ strength, spread })', 'TOP: neighbor-difference gradient, centered on 0.5, in RG.'],
  normalMap: ['.normalMap({ strength, spread })', 'TOP: tangent-space normal map from luma height.'],
  levels: ['.levels({ contrast, saturation, gamma })', 'TOP: combined tonal adjust.'],
  add: ['.add(v)', 'TOP: add v to every pixel (scalar or [r, g, b]; negative darkens) · audio signal: plain addition/offset.'],
  mul: ['.mul(v)', 'TOP: multiply every pixel by v (scalar or [r, g, b]) · audio signal: plain gain.'],
  pow: ['.pow(v)', 'Audio signal: raise to a power — <1 expands quiet detail, >1 emphasizes peaks.'],
  smooth: ['.smooth(up, down?)', 'Audio signal: exponential lag (one-pole lowpass on the value), time constants in seconds. Two args = separate attack/release — fast up + slow down makes a nice envelope.'],
  lowpass: ['.lowpass(hz)', "Audio signal: energy below hz (0..1) from the input's spectrum — bass level."],
  highpass: ['.highpass(hz)', "Audio signal: energy above hz (0..1) from the input's spectrum — treble level."],
  bandpass: ['.bandpass(lo, hi)', "Audio signal: energy between lo and hi Hz (0..1) from the input's spectrum."],
  contrast: ['.contrast(v)', 'TOP: contrast around mid-gray (1 = unchanged).'],
  saturation: ['.saturation(v)', 'TOP: 0 = grayscale, 1 = unchanged, >1 boosts.'],
  gamma: ['.gamma(v)', 'TOP: gamma curve (1 = unchanged).'],
  posterize: ['.posterize(steps)', 'TOP: quantize values to n levels per channel.'],
  pixellate: ['.pixellate(x, y?)', 'TOP: quantize position into cells (square cells if y omitted).'],
  transform: [".transform({ translate: [x,y], scale, rotate, wrap: 'clamp'|'repeat'|'mirror' })", 'TOP: UV-space transform.'],
  threshold: ['.threshold(level, { soft })', 'TOP: luma threshold to a black/white mask.'],
  invert: ['.invert()', 'TOP: invert colors.'],
  remap: ['.remap(mapTop)', "Texture: absolute UV lookup — sample this chain at the map's RG coordinates. Map can be a fn of the chain so far."],
  displace: ['.displace(mapTop, amount)', "Texture: offset UVs by the map's RG (centered on 0.5). Map can be a fn of the chain so far."],
  comp: [".comp(layer, mode, opacity)", 'TOP: composite layer over this chain. layer may be a fn of the chain so far — .comp(s => s.edge(), \'add\') overlays your own edges. Modes: over add sub mult screen overlay hardLight softLight darken lighten difference exclusion dodge burn.'],
  blur: ['.blur(radius)', 'TOP: separable gaussian blur.'],
  bloom: ['.bloom({ threshold, strength, radius })', 'TOP: brightpass + half-res gaussian glow.'],
  tile: ['.tile(nx, ny, (src, i, x, y) => variant)', 'TOP: tile nx×ny with a per-cell chain. fn may return src, a treatment of it, or any TOP; identical variants dedupe (max 8 distinct). x left→right, y bottom→top, i = y*nx + x.'],
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
