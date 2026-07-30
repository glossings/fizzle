import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

// Dev-server API for sketch files. User sketches live in sketches/user/ as
// plain .js files so the folder can be version controlled; examples ship in
// sketches/examples/ (bundled into the client, read-only here).
//
//   GET    /api/sketches            -> { user: [...], examples: [...] }
//   GET    /api/sketches/user/:name -> sketch source
//   PUT    /api/sketches/user/:name -> save
//   DELETE /api/sketches/user/:name -> delete

const ROOT = path.resolve('sketches');
const DIRS = { user: path.join(ROOT, 'user'), examples: path.join(ROOT, 'examples') };
const nameOk = (s) => /^[\w][\w -]{0,60}$/.test(s);

const listDir = (dir) => {
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => f.slice(0, -3)).sort();
  } catch {
    return [];
  }
};

function sketchApi() {
  return {
    name: 'sketch-api',
    configureServer(server) {
      fs.mkdirSync(DIRS.user, { recursive: true });
      server.middlewares.use('/api/sketches', (req, res) => {
        const send = (code, body, type = 'application/json') => {
          res.statusCode = code;
          res.setHeader('Content-Type', type);
          res.end(body);
        };
        try {
          const parts = (req.url ?? '/').split('?')[0].split('/').filter(Boolean).map(decodeURIComponent);
          if (req.method === 'GET' && parts.length === 0) {
            return send(200, JSON.stringify({ user: listDir(DIRS.user), examples: listDir(DIRS.examples) }));
          }
          const [scope, name] = parts;
          const dir = DIRS[scope];
          if (!dir || !nameOk(name ?? '')) return send(400, '{"error":"bad path"}');
          const file = path.join(dir, name + '.js');
          if (req.method === 'GET') {
            return fs.existsSync(file)
              ? send(200, fs.readFileSync(file, 'utf8'), 'text/plain')
              : send(404, '{"error":"not found"}');
          }
          if (scope !== 'user') return send(403, '{"error":"examples are read-only"}');
          if (req.method === 'PUT') {
            let body = '';
            req.on('data', (c) => (body += c));
            req.on('end', () => {
              fs.writeFileSync(file, body);
              send(200, '{"ok":true}');
            });
            return;
          }
          if (req.method === 'DELETE') {
            fs.rmSync(file, { force: true });
            return send(200, '{"ok":true}');
          }
          send(405, '{"error":"unsupported method"}');
        } catch (e) {
          send(500, JSON.stringify({ error: String(e) }));
        }
      });
    },
  };
}

// Google Fonts proxy: GET /api/gfont/:family?weight=700 -> raw .ttf bytes.
// Needed because Google's css2 endpoint only serves .ttf URLs to non-browser
// user agents — real browsers get woff2, which opentype.js can't decompress.
const gfontCache = new Map();

function gfontApi() {
  return {
    name: 'gfont-api',
    configureServer(server) {
      server.middlewares.use('/api/gfont', async (req, res) => {
        try {
          const u = new URL(req.url ?? '/', 'http://local');
          const family = decodeURIComponent(u.pathname.split('/').filter(Boolean)[0] ?? '');
          const w = u.searchParams.get('weight') ?? '';
          const weight = /^[1-9]00$/.test(w) ? w : '400';
          if (!/^[\w .+-]{1,60}$/.test(family)) {
            res.statusCode = 400;
            return res.end('bad family name');
          }
          const key = `${family.toLowerCase()}|${weight}`;
          if (!gfontCache.has(key)) {
            const css = async (fam) => {
              const r = await fetch(`https://fonts.googleapis.com/css2?family=${encodeURIComponent(fam)}`, {
                headers: { 'User-Agent': 'curl/8' },
              });
              return r.ok ? r.text() : null;
            };
            // exact weight first; fonts missing that weight 400 out, so retry plain
            const text = (await css(`${family}:wght@${weight}`)) ?? (await css(family));
            const ttf = text?.match(/url\((https:[^)]+\.ttf)\)/)?.[1];
            if (!ttf) {
              res.statusCode = 404;
              return res.end(`no font "${family}" on Google Fonts`);
            }
            gfontCache.set(key, Buffer.from(await (await fetch(ttf)).arrayBuffer()));
          }
          res.setHeader('Content-Type', 'font/ttf');
          res.end(gfontCache.get(key));
        } catch (e) {
          res.statusCode = 500;
          res.end(String(e));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [sketchApi(), gfontApi()],
  build: {
    rollupOptions: {
      // two pages: the app itself and the interactive docs
      input: {
        main: path.resolve('index.html'),
        docs: path.resolve('docs.html'),
      },
      output: {
        // Both pages use both libraries, so they'd share one chunk anyway —
        // but Rollup names a shared chunk after whichever module pulled it in
        // (giving a 1.7 MB file called `polyhaven`) and folds our own shared
        // source into it, so editing one app module re-hashes the whole thing.
        // Split by library instead: the names say what they are, and a code
        // change no longer invalidates three.js in every visitor's cache.
        manualChunks(id) {
          // core three only: the addons under examples/ include the .exr/.fbx
          // loaders, which are dynamically imported and should stay that way
          if (id.includes('node_modules/three/') && !id.includes('/examples/')) return 'three';
          if (/node_modules\/(@?codemirror|@lezer)\//.test(id)) return 'codemirror';
        },
      },
    },
  },
  resolve: {
    alias: {
      // three's TTFLoader imports opentype from a CDN; serve the local copy
      // instead so the app works offline
      'https://cdn.jsdelivr.net/npm/opentype.js@1.3.4/+esm': 'opentype.js',
    },
  },
});
