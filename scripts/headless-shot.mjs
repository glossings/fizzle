#!/usr/bin/env node
// Render a sketch headless and screenshot it at real-time intervals — for
// eyeballing texture ops and examples without a screen. Needs a dev server
// running (FIZZLE_PORT, default 5173) and Chrome.
//
//   node scripts/headless-shot.mjs sketch.js out 1000,3000,6000
//
// writes out-1000ms.png, out-3000ms.png, out-6000ms.png
import { readFileSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [, , sketchFile, prefix, times] = process.argv;
if (!times) {
  console.error('usage: node scripts/headless-shot.mjs <sketch.js> <prefix> <ms,ms,...>');
  process.exit(1);
}
const port = process.env.FIZZLE_PORT ?? '5173';
const code = readFileSync(sketchFile, 'utf8');
const url = `http://localhost:${port}/#c=${Buffer.from(code, 'utf8').toString('base64url')}`;
const shots = times.split(',').map(Number);

const profile = mkdtempSync(join(tmpdir(), 'fizzle-shot-'));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--mute-audio', '--hide-scrollbars',
  '--window-size=960,640', '--remote-debugging-port=9333',
  `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    try {
      const list = await (await fetch('http://localhost:9333/json')).json();
      target = list.find((t) => t.type === 'page');
    } catch { /* not up yet */ }
    if (!target) await sleep(200);
  }
  if (!target) throw new Error('no CDP page target');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const cmd = (method, params = {}) => new Promise((res) => {
    const mid = ++id;
    pending.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

  await cmd('Page.enable');
  await cmd('Page.navigate', { url });

  let elapsed = 0;
  for (const t of shots) {
    await sleep(t - elapsed);
    elapsed = t;
    const shot = await cmd('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`${prefix}-${t}ms.png`, Buffer.from(shot.result.data, 'base64'));
    console.log(`${prefix}-${t}ms.png`);
  }
  ws.close();
} finally {
  const gone = new Promise((r) => chrome.once('exit', r));
  chrome.kill();
  await gone;
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* chrome litter */ }
}
