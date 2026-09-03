#!/usr/bin/env node
// Every sketch in sketches/examples/ has to survive API changes it never asked
// for. Two passes:
//
// Static (always): compile each sketch the way the engine does — as a Function
// whose parameters are the API globals — so shadowing an API name (const
// spread = ...) fails here the way it fails live. Then flag identifiers the
// sketch reads but nothing defines: an API call that got renamed away.
//
// Live (needs the dev server + Chrome): load each sketch headless, give it a
// few seconds, and read back the status bar and the console. Eval errors and
// uncaught exceptions fail; fizzle warnings are listed for eyes.
//
//   node scripts/check-examples.mjs [--static]
//
// FIZZLE_PORT picks the server (default 5173); no server means the live pass
// is skipped with a note, not a failure.

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { root, GLOBALS, freeNames } from './lint-lib.mjs';

const dir = path.join(root, 'sketches/examples');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort();
const sketches = files.map((f) => ({ name: f, code: fs.readFileSync(path.join(dir, f), 'utf8') }));

let failed = false;
const report = (name, level, why) => {
  if (level === 'ERROR') failed = true;
  console.log(`${level.padEnd(5)} ${name}  ${why}`);
};

// --- static -----------------------------------------------------------------

const names = [...GLOBALS];
for (const s of sketches) {
  try {
    new Function(...names, `"use strict";\n${s.code}`);
  } catch (e) {
    report(s.name, 'ERROR', `won't compile in the engine's scope — ${e.message}`);
  }
  const free = freeNames(s.code);
  if (free.length) report(s.name, 'ERROR', `uses ${free.join(', ')} — not defined here, not API`);
}

// --- live -------------------------------------------------------------------

const port = process.env.FIZZLE_PORT ?? '5173';
const up = await fetch(`http://localhost:${port}/`).then((r) => r.ok, () => false);

if (process.argv.includes('--static') || !up) {
  if (!up && !process.argv.includes('--static')) {
    console.log(`\nno dev server on :${port} — static checks only (npm run dev for the live pass)`);
  }
  summary();
} else {
  await livePass();
  summary();
}

function summary() {
  console.log(`\n${sketches.length} examples · ${failed ? 'FAIL' : 'ok'}`);
  process.exit(failed ? 1 : 0);
}

// Load each sketch in one headless Chrome page over CDP, the way
// headless-shot.mjs does, and ask the page how the run went.
async function livePass() {
  const profile = fs.mkdtempSync(path.join(tmpdir(), 'fizzle-check-'));
  const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--mute-audio', '--hide-scrollbars',
    '--window-size=960,640', '--remote-debugging-port=9334',
    `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: 'ignore' });
  // resolves on exit or on failure to launch at all, so cleanup can't hang
  const gone = new Promise((r) => { chrome.once('exit', r); chrome.once('error', r); });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  try {
    let target;
    for (let i = 0; i < 50 && !target; i++) {
      try {
        const list = await (await fetch('http://localhost:9334/json')).json();
        target = list.find((t) => t.type === 'page');
      } catch { /* not up yet */ }
      if (!target) await sleep(200);
    }
    if (!target) throw new Error('no CDP page target');

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let id = 0;
    const pending = new Map();
    let warnings = [];
    let exceptions = [];
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'warning') {
        const text = m.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
        if (text.startsWith('fizzle:')) warnings.push(text.slice(7).trim());
      }
      if (m.method === 'Runtime.exceptionThrown') {
        exceptions.push(m.params.exceptionDetails.exception?.description
          ?? m.params.exceptionDetails.text);
      }
    };
    const cmd = (method, params = {}) => new Promise((res) => {
      const mid = ++id;
      pending.set(mid, res);
      ws.send(JSON.stringify({ id: mid, method, params }));
    });

    await cmd('Page.enable');
    await cmd('Runtime.enable');

    console.log('');
    for (const s of sketches) {
      warnings = [];
      exceptions = [];
      // the query string differs per sketch, so each navigate is a real load
      // rather than a hash move the app may not notice
      const hash = Buffer.from(s.code, 'utf8').toString('base64url');
      await cmd('Page.navigate', { url: `http://localhost:${port}/?check=${s.name}#c=${hash}` });
      await sleep(3000);
      const status = await cmd('Runtime.evaluate', {
        expression: `(() => { const el = document.getElementById('status');
          return JSON.stringify({ cls: el?.className ?? '', text: el?.textContent ?? '' }); })()`,
        returnByValue: true,
      });
      const { cls, text } = JSON.parse(status.result?.result?.value ?? '{"cls":"","text":""}');
      if (cls.includes('err')) report(s.name, 'ERROR', text.split('\n')[0]);
      for (const ex of new Set(exceptions)) report(s.name, 'ERROR', `uncaught: ${ex.split('\n')[0]}`);
      for (const w of new Set(warnings)) report(s.name, 'WARN', w);
      if (!cls.includes('err') && !exceptions.length && !warnings.length) {
        console.log(`ok    ${s.name}`);
      }
    }
    ws.close();
  } finally {
    chrome.kill();
    await gone;
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* chrome litter */ }
  }
}
