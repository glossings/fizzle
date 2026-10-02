// Shared between check-docs and check-examples: the API surface, and the
// static reading of a sketch — what it calls, what it reads without defining.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Globals straight from the completion table, so the two can't drift.
const docs = fs.readFileSync(path.join(root, 'src/docs.js'), 'utf8');
export const API = new Set(
  [...docs.matchAll(/export const (GLOBALS|METHODS) = \{([\s\S]*?)\n\};/g)]
    .flatMap((m) => [...m[2].matchAll(/^ {2}'?([A-Za-z_$][\w$]*)'?:/gm)].map((x) => x[1]))
);
export const GLOBALS = new Set(
  [...docs.matchAll(/export const GLOBALS = \{([\s\S]*?)\n\};/g)]
    .flatMap((m) => [...m[1].matchAll(/^ {2}'?([A-Za-z_$][\w$]*)'?:/gm)].map((x) => x[1]))
);

// geometry that needs a light to be anything but black; the unlit paths draw
// through Points/LineBasicMaterial and carry their own color
export const MESH = 'sphere box plane torus torusKnot cylinder capsule icosa model text3d'.split(' ');
export const UNLIT = 'particles link lines segments'.split(' ');
export const LIGHT = 'ambient directional point spot hemi hdri'.split(' ');
export const TEXTURE = `scene depth input constant ramp circle ring rect polygon checker video person
  videofile imagefile imageseq noise fluid voronoi text glsl data layout`.split(/\s+/).filter(Boolean);

export const JS_GLOBALS = `Math JSON Date Array Object String Number Boolean console window document
  Promise Set Map performance parseInt parseFloat isNaN structuredClone requestAnimationFrame
  innerWidth innerHeight devicePixelRatio`.split(/\s+/);

// code with comments and string bodies blanked, so words inside them don't count
export const bare = (code) =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '').replace(/'[^']*'|"[^"]*"|`[^`]*`/g, "''");

// a method call is not a global: b.box() builds no geometry, curve.circle()
// is a curve's own verb — only free-standing names count
export const calls = (code) => new Set([...bare(code).matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]));
export const methodCalls = (code) => new Set([...bare(code).matchAll(/\.\s*([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]));

// identifiers the code reads but never defines — free-standing, so they had
// better be API or JS globals
export function freeNames(code) {
  const c = bare(code);
  const declared = new Set();
  const add = (s) => (s.match(/[A-Za-z_$][\w$]*/g) ?? []).forEach((n) => declared.add(n));
  for (const m of c.matchAll(/\b(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) declared.add(m[1]);
  for (const m of c.matchAll(/\b(?:const|let|var)\s*[[{]([^\]}]*)[\]}]/g)) add(m[1]);
  for (const m of c.matchAll(/\(([^()]*)\)\s*=>/g)) add(m[1]);
  for (const m of c.matchAll(/(?:^|[^.\w])([A-Za-z_$][\w$]*)\s*=>/g)) declared.add(m[1]);
  for (const m of c.matchAll(/function\s*\w*\s*\(([^()]*)\)/g)) add(m[1]);
  const used = c.replace(/\.\s*[A-Za-z_$][\w$]*/g, '').replace(/([A-Za-z_$][\w$]*)\s*:/g, '');
  return [...new Set([...used.matchAll(/\b([A-Za-z_$][\w$]*)\b/g)].map((m) => m[1]))]
    .filter((n) => !API.has(n) && !declared.has(n) && !JS_GLOBALS.includes(n) && !/^[A-Z]/.test(n))
    .filter((n) => !/^(true|false|null|undefined|new|typeof|of|in|return|if|else|for|while|const|let|var|function|async|await|class|extends|do|break|continue|try|catch|finally|throw|switch|case|default|delete|void|instanceof|yield|this)$/.test(n));
}
