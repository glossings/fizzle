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
import { chromeBin, chromeArgs } from './chrome-lib.mjs';

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
const CHROME = chromeBin();
// FIZZLE_SIZE=1080,1920 to shoot a portrait sketch without letterboxing it
const chrome = spawn(CHROME, chromeArgs({ bin: CHROME, port: 9333, profile, size: process.env.FIZZLE_SIZE ?? '960,640' }), { stdio: 'ignore' });

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

  // The editor and the sidebar sit on top of the render, so a shot meant for
  // eyeballing the visuals is mostly code. ctrl+m hides one, ctrl+p the other;
  // FIZZLE_UI=1 keeps them for shots about the interface itself.
  let elapsed = 0;
  if (!process.env.FIZZLE_UI) {
    await sleep(600);
    elapsed = 600;
    for (const [key, code, vk] of [['m', 'KeyM', 77], ['p', 'KeyP', 80]]) {
      for (const type of ['keyDown', 'keyUp']) {
        await cmd('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: vk, modifiers: 2 });
      }
    }
  }

  for (const t of shots) {
    await sleep(t - elapsed);
    elapsed = t;
    const shot = await cmd('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`${prefix}-${t}ms.png`, Buffer.from(shot.result.data, 'base64'));
    console.log(`${prefix}-${t}ms.png`);
  }
  ws.close();
} finally {
  // a browser that never launched never exits, and one wedged on shutdown
  // would hold the script open past its last shot — either way, SIGKILL after
  // a moment and move on
  const gone = new Promise((r) => {
    chrome.once('exit', r);
    chrome.once('error', r);
    setTimeout(() => { chrome.kill('SIGKILL'); r(); }, 3000).unref();
  });
  chrome.kill();
  await gone;
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* chrome litter */ }
}
