// Arguments to .position(), .rotation() and .scale() fill the slots left to
// right, and a vector fills as many as it has, the way GLSL builds a vec3:
// .position(xy(), 2) is the pad's x and y with z at 2, .position(2, xy()) is x
// at 2 with the pad on y and z. A three-part one (a vec(), an array, a
// Vector3) fills the lot, as it always has.

// the parts of a vector argument, or null for a plain value (a number, a signal)
export function vecParts(v) {
  if (v === null || typeof v !== 'object') return null;
  if (Array.isArray(v)) return v;
  if (!('z' in v)) return [v.x, v.y];
  return [v.x, v.y, v.z];
}

// `defaults` says how many slots there are and what an empty one holds
export function fillSlots(args, defaults) {
  const out = [];
  for (const a of args) {
    if (out.length >= defaults.length) break;
    const parts = vecParts(a);
    if (parts) out.push(...parts);
    else out.push(a);
  }
  return defaults.map((d, i) => (out[i] === undefined ? d : out[i]));
}

// .scale(): one plain number is all three axes, and scale(x, y) leaves z at x,
// as before; with a vector in the mix, the empty slots are 1
export function scaleSlots(args) {
  if (args.some((a) => vecParts(a))) return fillSlots(args, [1, 1, 1]);
  const [x = 1, y, z] = args;
  return [x, y ?? x, z ?? x];
}
