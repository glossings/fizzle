#!/usr/bin/env node
// Every ```js fence in docs-content.md becomes a live editor on the docs page,
// so a block that can't run on its own is a play button that does nothing.
// Those belong in a ```js static fence. This finds them.
//
//   node scripts/check-docs.mjs [file]
//
// ERROR is broken for certain. REVIEW needs eyes: it can't tell a Poly Haven
// asset name, which downloads itself, from a file only you have.

import fs from 'node:fs';
import path from 'node:path';
import { root, MESH, UNLIT, LIGHT, TEXTURE, calls, methodCalls, freeNames } from './lint-lib.mjs';

const file = process.argv[2] ?? path.join(root, 'src/docs-content.md');
const src = fs.readFileSync(file, 'utf8');

// --- parse the fences the way docs-page.js does, indent and all -------------

function blocks(md) {
  const lines = md.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)```(\S*)\s*(.*)$/);
    if (!m) continue;
    const [, indent, lang, flags] = m;
    const body = [];
    const fence = i + 1;
    for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) {
      body.push(lines[i].startsWith(indent) ? lines[i].slice(indent.length) : lines[i]);
    }
    out.push({ fence, lang, flags, code: body.join('\n') });
  }
  return out;
}

// --- the checks -------------------------------------------------------------

const findings = [];
const all = blocks(src);
const live = all.filter((b) => b.lang === 'js' && !b.flags.includes('static'));

for (const b of live) {
  const at = (level, why) => findings.push({ level, line: b.fence, why, code: b.code });
  const c = calls(b.code);
  const mc = methodCalls(b.code);
  const has = (names) => names.some((n) => c.has(n));
  // a source can be spelled as a method — .particles(), person().lines() — but
  // geometry can't: box() the shape and b.box() a tracker's box are different
  const hasM = (names) => names.some((n) => c.has(n) || mc.has(n));

  try {
    new Function(b.code);
  } catch (e) {
    at('ERROR', `not valid on its own — ${e.message}`);
  }

  const free = freeNames(b.code);
  if (free.length) at('ERROR', `uses ${free.join(', ')}, defined in some other block`);

  const source = has(MESH) || hasM(TEXTURE) || hasM(UNLIT);
  if (!source) at('ERROR', 'no geometry and no texture source — nothing to show');
  else if (!/\.out\s*\(/.test(b.code)) at('ERROR', 'nothing is sent to .out()');
  else if (c.has('scene') && !has(MESH) && !hasM(UNLIT)) {
    at('ERROR', 'scene() post-processes a 3D scene this block never puts anything in');
  } else if (has(MESH) && !hasM(UNLIT) && !has(LIGHT)) {
    at('ERROR', 'lit geometry with no light — renders black');
  }

  const device = b.code.match(/\bmidi\(\s*['"]([^'"]+)/);
  if (device) at('ERROR', `names the controller '${device[1]}' — only you have it`);

  for (const [, lit] of b.code.matchAll(/['"]([^'"]*)['"]/g)) {
    if (/^https?:/.test(lit) && /\/(you|yourname|username)\/|example\.(com|org)/.test(lit)) {
      at('ERROR', `${lit} is a placeholder URL`);
    } else if (/\.(jpg|jpeg|png|mp4|mov|webm|wav|mp3|hdr|exr|glb|gltf|obj|fbx)$/i.test(lit)
               && !lit.startsWith('polyhaven:') && !/^https?:/.test(lit)
               // Poly Haven names carry the resolution they were cut at, and
               // fetch themselves whether or not they're tagged
               && !/_(1|2|4|8)k(\/|\.)/i.test(lit)) {
      at('REVIEW', `names the file '${lit}' — a Poly Haven asset downloads itself, yours does not`);
    }
  }
}

// --- report -----------------------------------------------------------------

const errors = findings.filter((f) => f.level === 'ERROR');
const review = findings.filter((f) => f.level === 'REVIEW');
const rel = path.relative(process.cwd(), file);

for (const f of [...errors, ...review]) {
  console.log(`${f.level}  ${rel}:${f.line}  ${f.why}`);
  console.log(f.code.split('\n').slice(0, 3).map((l) => `        ${l}`).join('\n'));
}
console.log(
  `\n${live.length} live · ${all.filter((b) => b.lang === 'js' && b.flags.includes('static')).length} static · ` +
  `${errors.length} error${errors.length === 1 ? '' : 's'} · ${review.length} to review`
);
if (errors.length) console.log('\nFence these as ```js static, or give them what they need to run.');
process.exit(errors.length ? 1 : 0);
