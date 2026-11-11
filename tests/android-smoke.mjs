// vCGE Android wrapper test: installs the APK on a running emulator or phone (adb) and runs it through its paces.
// `node tests/android-smoke.mjs <app.apk> [screenshot folder]`. Needs adb (and aapt2 or aapt) on PATH.
// It reads the screen through Android's own accessibility tree (uiautomator), so it works on a release build, which has
// no WebView debugging. Checks: no INTERNET permission, the app opens on Welcome (not the "cannot run" page), a tap moves
// it to Capture, it is still running afterwards, and nothing crashed.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [APK, OUT = 'android-smoke'] = process.argv.slice(2);
const PKG = 'app.vcge.vcge';
if (!APK) { console.error('usage: node tests/android-smoke.mjs <app.apk> [screenshot folder]'); process.exit(2); }
mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => { cond ? (pass++, console.log('PASS', name)) : (fail++, console.log('FAIL', name, detail)); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: opts.binary ? 'buffer' : 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'pipe'] });
const adb = (...args) => run('adb', args);
const shell = (cmd) => { try { return adb('shell', cmd); } catch (e) { return (e.stdout || '') + (e.stderr || ''); } };
const shot = (name) => { try { writeFileSync(path.join(OUT, `${name}.png`), run('adb', ['exec-out', 'screencap', '-p'], { binary: true })); } catch (e) { /* screenshot is a bonus */ } };

/** The screen's accessibility nodes: text, description, package and the centre of each one's bounds. */
function screen() {
  shell('uiautomator dump /sdcard/vcge-ui.xml >/dev/null 2>&1');
  const xml = shell('cat /sdcard/vcge-ui.xml');
  const nodes = [...xml.matchAll(/<node [^>]*>/g)].map(([n]) => {
    const a = (k) => { const m = n.match(new RegExp(` ${k}="([^"]*)"`)); return m ? m[1] : ''; };
    const b = a('bounds').match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
    return { text: a('text'), desc: a('content-desc'), pkg: a('package'), x: b ? (+b[1] + +b[3]) >> 1 : 0, y: b ? (+b[2] + +b[4]) >> 1 : 0 };
  });
  return { xml, nodes, find: (re) => nodes.find(n => re.test(n.text) || re.test(n.desc)) };
}
async function waitFor(re, ms) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(1500)) { const s = screen(); const n = s.find(re); if (n) return n; }
  return null;
}
const tap = (n) => shell(`input tap ${n.x} ${n.y}`);
const pid = () => shell(`pidof ${PKG}`).trim();

// 1. The APK itself: what it asks Android for.
let perms = '';
for (const tool of ['aapt2', 'aapt']) { try { perms = run(tool, ['dump', 'permissions', APK]); break; } catch (e) { /* try the next tool */ } }
ok('APK permissions could be read', perms.length > 0);
ok('APK asks for no INTERNET permission', !/android\.permission\.INTERNET/.test(perms), perms);
ok('APK asks for CAMERA', /android\.permission\.CAMERA/.test(perms), perms);

// 2. Install and open it.
try { adb('uninstall', PKG); } catch (e) { /* not installed yet */ }
let installed = '';
try { installed = adb('install', '-r', APK); } catch (e) { installed = (e.stdout || '') + (e.stderr || ''); }
ok('APK installs', /Success/.test(installed), installed);
const dump = shell(`dumpsys package ${PKG}`);
ok('installed app holds no INTERNET permission', !/android\.permission\.INTERNET/.test(dump));

shell('logcat -c');
shell('input keyevent KEYCODE_WAKEUP'); shell('wm dismiss-keyguard');
shell(`am start -W -n ${PKG}/.MainActivity`);
const welcome = await waitFor(/Hello there|cannot run|isn.t supported/i, 90000);
shot('1-welcome');
ok('app opens on Welcome ("Hello there")', welcome && /Hello there/i.test(welcome.text + welcome.desc), welcome ? welcome.text + welcome.desc : 'nothing within 90 s');
if (!welcome) {
  // What Android does see, for the log: the on-screen nodes and the app's WebView and crash lines.
  const seen = screen();
  console.log('on screen:', seen.nodes.map(n => `[${n.pkg}] ${n.text || n.desc || '-'}`).slice(0, 60).join(' | '));
  console.log(shell('logcat -d').split('\n').filter(l => /chromium|Console|vcge|Tauri|wry|WebView|ERR_|AndroidRuntime/i.test(l)).slice(-80).join('\n'));
}
ok('browser gate passed (no "cannot run" page)', !screen().find(/cannot run in this browser/i));

// 3. Paces: Skip the tour if it is up, then "Scan a card" moves to step 2 (Capture).
const skip = screen().find(/^Skip tour$/i);
if (skip) { tap(skip); await sleep(1500); }
const scan = await waitFor(/^Scan a card$/i, 15000);
ok('"Scan a card" button is on screen', !!scan);
if (scan) {
  tap(scan);
  // Opening Capture may start the camera: Android then asks the person once. Allow it, as a person scanning would.
  const allow = await waitFor(/^(While using the app|Only this time|Allow)$/i, 8000);
  if (allow) { console.log('note: Android asked for the camera; allowing'); shot('2-camera-ask'); tap(allow); }
  const capture = await waitFor(/Step 2 of 5/i, 20000);
  shot('3-capture');
  ok('tap moves to Capture (step 2 of 5)', !!capture, screen().nodes.filter(n => n.text || n.desc).slice(0, 40).map(n => n.text || n.desc).join(' | '));
}

// 4. Still alive, and nothing crashed.
await sleep(5000);
ok('app is still running', pid() !== '');
const log = shell('logcat -d -b crash,main');
// A Java crash: a FATAL EXCEPTION block that names the app within its first lines.
ok('no Java crash', !log.split('FATAL EXCEPTION').slice(1).some(block => block.slice(0, 400).includes(PKG)));
ok('no Rust panic', !/panicked at/.test(log));
writeFileSync(path.join(OUT, 'logcat.txt'), log.split('\n').filter(l => /vcge|Tauri|wry|chromium|AndroidRuntime/i.test(l)).join('\n'));
shot('4-end');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
