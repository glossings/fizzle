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

export default defineConfig({
  plugins: [sketchApi()],
});
