// Rasterizes public/favicon.svg's mark into the PNG/ICO fallbacks that browsers
// and iOS still ask for. Kept as code rather than checked-in binaries alone so
// the raster icons can be regenerated when the palette moves: `node scripts/make-icons.mjs`.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const OUT = path.resolve('public');
const BG = [0x0b, 0x0d, 0x13];
const G0 = [0x7e, 0xe7, 0x87]; // --accent
const G1 = [0x4f, 0xd1, 0xc5]; // --accent2
const BUBBLES = [
  { x: 10.5, y: 21.5, r: 6.5 },
  { x: 21, y: 13.5, r: 4 },
  { x: 26.5, y: 7.5, r: 2.2 },
];

const inRound = (x, y, inset, r) =>
  x >= inset && y >= inset && x <= 32 - inset && y <= 32 - inset &&
  // corners: only the quarter-disc region can fall outside
  Math.hypot(Math.max(inset + r - x, 0, x - (32 - inset - r)),
             Math.max(inset + r - y, 0, y - (32 - inset - r))) <= r;

// gradient runs bottom-left -> top-right, matching the SVG's userSpaceOnUse axis
const grad = (x, y) => {
  const t = Math.min(1, Math.max(0, ((x - 4) * 24 + (y - 28) * -24) / (24 * 24 * 2)));
  return G0.map((c, i) => Math.round(c + (G1[i] - c) * t));
};

// 4x4 supersampling is enough: the mark is all discs and one rounded rect
function render(size, { rounded = true } = {}) {
  const px = new Uint8Array(size * size * 4);
  const S = 4, step = 32 / size / S;
  for (let py = 0; py < size; py++) {
    for (let pxi = 0; pxi < size; pxi++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const x = (pxi * S * step) + (sx + 0.5) * step;
          const y = (py * S * step) + (sy + 0.5) * step;
          if (rounded && !inRound(x, y, 0, 7)) continue;
          let c = BG;
          if (rounded && !inRound(x, y, 1, 6)) c = BG.map((v) => Math.round(v + (255 - v) * 0.12));
          if (BUBBLES.some((o) => Math.hypot(x - o.x, y - o.y) <= o.r)) c = grad(x, y);
          r += c[0]; g += c[1]; b += c[2]; a += 255;
        }
      }
      const n = S * S, i = (py * size + pxi) * 4;
      // un-premultiply so partially covered edge pixels keep full-strength colour
      const cov = a / (n * 255) || 1;
      px[i] = r / n / cov; px[i + 1] = g / n / cov; px[i + 2] = b / n / cov; px[i + 3] = a / n;
    }
  }
  return px;
}

const CRC = Int32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc32 = (buf) => {
  let c = -1;
  for (const byte of buf) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};

const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

function png(size, px) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    Buffer.from(px.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// .ico may hold PNG payloads directly, which every ico-reading browser accepts
function ico(entries) {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(1, 2); head.writeUInt16LE(entries.length, 4);
  let offset = 6 + entries.length * 16;
  const dir = entries.map(({ size, data }) => {
    const e = Buffer.alloc(16);
    e[0] = size % 256; e[1] = size % 256;
    e[4] = 1; e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8); e.writeUInt32LE(offset, 12);
    offset += data.length;
    return e;
  });
  return Buffer.concat([head, ...dir, ...entries.map((e) => e.data)]);
}

const icoSizes = [16, 32, 48].map((size) => ({ size, data: png(size, render(size)) }));
fs.writeFileSync(path.join(OUT, 'favicon.ico'), ico(icoSizes));
fs.writeFileSync(path.join(OUT, 'favicon-32.png'), icoSizes[1].data);
// iOS ignores transparency and rounds the corners itself, so ship it full-bleed
fs.writeFileSync(path.join(OUT, 'apple-touch-icon.png'), png(180, render(180, { rounded: false })));
console.log('wrote favicon.ico, favicon-32.png, apple-touch-icon.png');
