// vCGE desktop wrappers smoke test (Windows, macOS, Linux): after `npx tauri build`, checks that the installers were made
// and that the release app starts and keeps running. `node tests/desktop-smoke.mjs` (Linux needs a display: xvfb-run).
// The full click-through runs on Linux in tests/tauri.e2e.test.cjs; this proves the other systems' wrappers open at all.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const REL = path.join(ROOT, 'src-tauri', 'target', 'release');
const BUNDLE = path.join(REL, 'bundle');
const VERSION = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const RUN_MS = Number(process.env.VCGE_SMOKE_MS || 15000);

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => { cond ? (pass++, console.log('PASS', name)) : (fail++, console.log('FAIL', name, detail)); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const files = (dir, re) => existsSync(path.join(BUNDLE, dir)) ? readdirSync(path.join(BUNDLE, dir)).filter(f => re.test(f)) : [];

const os = process.platform;
console.log(`vCGE ${VERSION} desktop smoke test on ${os}`);

// 1. Installers: what a person downloads from the GitHub beta release.
if (os === 'win32') {
  ok('Windows: MSI installer', files('msi', /\.msi$/).some(f => f.includes(VERSION)), files('msi', /./).join(','));
  ok('Windows: setup.exe installer (NSIS)', files('nsis', /-setup\.exe$/).some(f => f.includes(VERSION)), files('nsis', /./).join(','));
} else if (os === 'darwin') {
  ok('macOS: vCGE.app', existsSync(path.join(BUNDLE, 'macos', 'vCGE.app')));
  ok('macOS: disk image (.dmg)', files('dmg', /\.dmg$/).some(f => f.includes(VERSION)), files('dmg', /./).join(','));
  const plist = path.join(BUNDLE, 'macos', 'vCGE.app', 'Contents', 'Info.plist');
  const key = (k) => { try { return execFileSync('plutil', ['-extract', k, 'raw', plist]).toString().trim(); } catch (e) { return null; } };
  ok('macOS: app version matches', key('CFBundleShortVersionString') === VERSION, key('CFBundleShortVersionString'));
  ok('macOS: camera reason present (else macOS stops the app at the camera)', !!key('NSCameraUsageDescription'));
  ok('macOS: no network exceptions in the app', key('NSAppTransportSecurity') === null);
} else {
  ok('Linux: .deb package', files('deb', /\.deb$/).some(f => f.includes(VERSION)), files('deb', /./).join(','));
  ok('Linux: .rpm package', files('rpm', /\.rpm$/).length > 0, files('rpm', /./).join(','));
  ok('Linux: AppImage', files('appimage', /\.AppImage$/).some(f => f.includes(VERSION)), files('appimage', /./).join(','));
}

// 2. The release app opens and stays open (a missing library, a bad config or a crash at start ends it early).
const bin = path.join(REL, os === 'win32' ? 'vcge.exe' : 'vcge');
ok('release app built', existsSync(bin), bin);
if (existsSync(bin)) {
  const app = spawn(bin, [], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  app.stdout.on('data', d => { out += d; });
  app.stderr.on('data', d => { out += d; });
  let exit = null;
  app.on('exit', (code, signal) => { exit = { code, signal }; });
  app.on('error', (e) => { exit = { error: e.message }; });
  await sleep(RUN_MS);
  ok(`release app still running after ${RUN_MS / 1000} s`, exit === null, JSON.stringify(exit) + ' ' + out.slice(-2000));
  ok('release app printed no panic', !/panicked at|error while running vCGE/.test(out), out.slice(-2000));
  if (exit === null) {
    app.kill();
    await Promise.race([new Promise(r => app.once('exit', r)), sleep(5000)]);
    if (os === 'win32') { try { execFileSync('taskkill', ['/F', '/T', '/PID', String(app.pid)], { stdio: 'ignore' }); } catch (e) { /* already closed */ } }
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
