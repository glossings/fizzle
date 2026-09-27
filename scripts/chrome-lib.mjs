// Where to find a headless Chrome, and the flags to launch it with.
//
// Prefers chrome-headless-shell. The Chrome app bundle checks in with
// LaunchServices even under --headless=new, so every run flashes a tile into
// the Dock and shoves the other icons sideways:
//
//   npx puppeteer browsers install chrome-headless-shell
//
// Override either choice with FIZZLE_CHROME=/path/to/binary.
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const APP = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SHELL_CACHE = join(homedir(), '.cache/puppeteer/chrome-headless-shell');

// "mac_arm-141.0.7390.54" sorts wrong lexically once a major rolls a digit
function byVersion(a, b) {
  const parts = (s) => (s.match(/[\d.]+/)?.[0] ?? '0').split('.').map(Number);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  }
  return 0;
}

function headlessShell() {
  if (!existsSync(SHELL_CACHE)) return null;
  for (const build of readdirSync(SHELL_CACHE).sort(byVersion).reverse()) {
    for (const dir of readdirSync(join(SHELL_CACHE, build))) {
      const bin = join(SHELL_CACHE, build, dir, 'chrome-headless-shell');
      if (existsSync(bin)) return bin;
    }
  }
  return null;
}

export function chromeBin() {
  return process.env.FIZZLE_CHROME ?? headlessShell() ?? APP;
}

export function chromeArgs({ bin, port, profile, size = '960,640' }) {
  const args = [
    '--no-sandbox', '--mute-audio', '--hide-scrollbars',
    `--window-size=${size}`, `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`, 'about:blank',
  ];
  // chrome-headless-shell has no headful mode to switch off
  if (!bin.includes('chrome-headless-shell')) args.unshift('--headless=new');
  return args;
}
