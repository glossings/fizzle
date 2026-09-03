import { defineConfig } from 'vite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { nameOk } from './src/sketch-name.js';

// Dev-server API for sketch files. User sketches live in sketches/user/ as
// plain .js files so the folder can be version controlled; examples ship in
// sketches/examples/ (bundled into the client, read-only here).
//
//   GET    /api/sketches            -> { user: [{ name, mtime, birthtime }], examples: [...] }
//   GET    /api/sketches/user/:name -> sketch source
//   PUT    /api/sketches/user/:name -> save
//   DELETE /api/sketches/user/:name -> delete

const ROOT = path.resolve('sketches');
const DIRS = { user: path.join(ROOT, 'user'), examples: path.join(ROOT, 'examples') };

// The times ride along so the client can cache what it derived from a sketch's
// source (its auto tags) and only re-read the files that have moved since, and
// so the list can be sorted by age.
const listDir = (dir) => {
  try {
    return fs
      .readdirSync(dir)
      // only names the GET/PUT endpoints will accept — a file that lists but
      // 400s on load would look like a sketch that can't be found
      .filter((f) => f.endsWith('.js') && nameOk(f.slice(0, -3)))
      .map((f) => ({ name: f.slice(0, -3), ...stat(path.join(dir, f)) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
};

// birthtime isn't recorded by every filesystem, and a `git clone` gives every
// file the same fresh one either way — so it's a starting point the client
// keeps hold of (see `created` in library.json), not the last word.
const stat = (file) => {
  try {
    const s = fs.statSync(file);
    return { mtime: s.mtimeMs, birthtime: s.birthtimeMs || s.mtimeMs };
  } catch {
    return { mtime: 0, birthtime: 0 };
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

// Playlists and tags: GET/PUT /api/library -> sketches/user/library.json.
// It sits with the sketches rather than in the app's own storage, so a set and
// the sketches it plays are one folder you can version or copy to another
// machine. A missing file is an empty library, not an error.
const LIBRARY = path.join(DIRS.user, 'library.json');
const MAX_LIBRARY = 4 * 1024 * 1024;

function libraryApi() {
  return {
    name: 'library-api',
    configureServer(server) {
      server.middlewares.use('/api/library', (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        try {
          if (req.method === 'GET') {
            res.end(fs.existsSync(LIBRARY) ? fs.readFileSync(LIBRARY, 'utf8') : '{}');
            return;
          }
          if (req.method === 'PUT') {
            let body = '';
            req.on('data', (c) => {
              body += c;
              if (body.length > MAX_LIBRARY) req.destroy();
            });
            req.on('end', () => {
              // parsed before it's written: a half-sent body would otherwise
              // land as a corrupt file and lose every playlist at once
              try {
                JSON.parse(body);
              } catch {
                res.statusCode = 400;
                return res.end('{"error":"not json"}');
              }
              fs.mkdirSync(DIRS.user, { recursive: true });
              fs.writeFileSync(LIBRARY, body);
              res.end('{"ok":true}');
            });
            return;
          }
          res.statusCode = 405;
          res.end('{"error":"unsupported method"}');
        } catch (e) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: String(e) }));
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

// Codec rescue: POST /api/transcode?kind=video|audio with the raw file bytes
// -> the same media as H.264/AAC mp4 (or AAC m4a) via this machine's ffmpeg.
// The browser can only play what it can decode, but the dev server can run
// anything installed next to it — so a ProRes/HEVC .mov dropped into a local
// session gets rewritten instead of refused (see mediaTranscode in media.js).
// Deployed there is no server and the route 404s; the client falls back to
// asking for a manual convert. The input goes through a temp file because a
// .mov with its moov atom at the end can't be demuxed from a pipe.
const FFMPEGS = ['ffmpeg', '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'];
const FF_ARGS = {
  // yuv420p because browsers won't take 4:2:2/4:4:4 H.264; even dimensions
  // because yuv420p requires them
  video: ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18',
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-movflags', '+faststart', '-f', 'mp4'],
  audio: ['-vn', '-c:a', 'aac', '-b:a', '192k', '-f', 'ipod'], // ipod = .m4a
};

const runFfmpeg = (args, i = 0) =>
  new Promise((resolve, reject) => {
    if (i >= FFMPEGS.length) return reject(Object.assign(new Error('no ffmpeg'), { code: 'ENOENT' }));
    execFile(FFMPEGS[i], args, { timeout: 10 * 60_000, maxBuffer: 1 << 24 }, (err, _out, stderr) => {
      if (err?.code === 'ENOENT') return resolve(runFfmpeg(args, i + 1));
      err ? reject(Object.assign(err, { stderr })) : resolve();
    });
  });

function transcodeApi() {
  return {
    name: 'transcode-api',
    configureServer(server) {
      server.middlewares.use('/api/transcode', (req, res) => {
        const fail = (code, msg) => {
          res.statusCode = code;
          res.setHeader('Content-Type', 'text/plain');
          res.end(msg);
        };
        const kind = new URL(req.url ?? '/', 'http://local').searchParams.get('kind');
        if (req.method !== 'POST') return fail(405, 'POST only');
        if (!FF_ARGS[kind]) return fail(400, 'kind must be video or audio');
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fizzle-tc-'));
        const inFile = path.join(dir, 'in');
        const outFile = path.join(dir, kind === 'video' ? 'out.mp4' : 'out.m4a');
        const done = () => fs.rmSync(dir, { recursive: true, force: true });
        const sink = fs.createWriteStream(inFile);
        req.pipe(sink);
        req.on('error', () => { sink.destroy(); done(); });
        sink.on('finish', async () => {
          try {
            await runFfmpeg(['-y', '-i', inFile, ...FF_ARGS[kind], outFile]);
            res.setHeader('Content-Type', kind === 'video' ? 'video/mp4' : 'audio/mp4');
            const out = fs.createReadStream(outFile);
            out.pipe(res);
            out.on('close', done);
          } catch (e) {
            done();
            if (e.code === 'ENOENT') return fail(501, 'no ffmpeg on this machine — install it (brew install ffmpeg) and re-run the sketch');
            // the tail of stderr is where ffmpeg says what it couldn't do
            fail(500, `ffmpeg couldn't convert it: ${String(e.stderr ?? e).trim().split('\n').pop()}`);
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [sketchApi(), libraryApi(), gfontApi(), transcodeApi()],
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
