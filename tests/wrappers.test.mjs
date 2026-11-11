// vCGE app wrappers (Windows, macOS, Linux, Android): checks of the wrapper files themselves, in Node (`npm run test:wrappers`).
// The app inside every wrapper is the same web build; these checks guard what each wrapper adds around it:
// no internet, no extra permissions, the pinned Tauri versions (DESKTOP DEPENDENCIES LOCK), the vCGE icons.
import { readFileSync, existsSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (p) => readFileSync(ROOT + p, 'utf8');
const ANDROID = 'src-tauri/gen/android/app/src/';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('PASS', name); }
  else { fail++; process.stdout.write(`FAIL ${name} ${detail}\n`); }
};
const permissions = (xml) => [...xml.matchAll(/<uses-permission\s+android:name="([^"]+)"/g)].map(m => m[1]);

// --- Android ---
{
  const main = read(ANDROID + 'main/AndroidManifest.xml');
  const perms = permissions(main);
  ok('Android: release manifest asks for no internet', !perms.includes('android.permission.INTERNET'), perms.join(','));
  ok('Android: CAMERA is the only permission', perms.length === 1 && perms[0] === 'android.permission.CAMERA', perms.join(','));
  ok('Android: a phone without a camera can still install it',
    /android:name="android\.hardware\.camera"\s+android:required="false"/.test(main));
  ok('Android: no app backup of settings', /android:allowBackup="false"/.test(main));
  ok('Android: cleartext traffic comes from the build type', /android:usesCleartextTraffic="\$\{usesCleartextTraffic\}"/.test(main));

  const debug = permissions(read(ANDROID + 'debug/AndroidManifest.xml'));
  ok('Android: only debug builds add INTERNET (dev server), nothing else',
    debug.length === 1 && debug[0] === 'android.permission.INTERNET', debug.join(','));
  ok('Android: no other build type adds permissions',
    ['release', 'profile'].every(t => !existsSync(ROOT + ANDROID + t + '/AndroidManifest.xml')));

  const gradle = read('src-tauri/gen/android/app/build.gradle.kts');
  ok('Android: release builds refuse cleartext traffic', /defaultConfig\s*\{[^}]*usesCleartextTraffic"\]\s*=\s*"false"/.test(gradle));
  ok('Android: package id matches the desktop identifier', /applicationId\s*=\s*"app\.vcge\.vcge"/.test(gradle));
  ok('Android: no signing key or password in the repo', !/storePassword|keyPassword|storeFile/.test(gradle));

  for (const d of ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']) {
    ok(`Android: vCGE launcher icons at ${d}`, ['ic_launcher', 'ic_launcher_round', 'ic_launcher_foreground']
      .every(n => existsSync(`${ROOT}${ANDROID}main/res/mipmap-${d}/${n}.png`)));
  }
  ok('Android: the default Tauri launcher art is gone', !existsSync(ROOT + ANDROID + 'main/res/drawable-v24/ic_launcher_foreground.xml'));
  ok('Android: app name is vCGE', /<string name="app_name">"?vCGE"?<\/string>/.test(read(ANDROID + 'main/res/values/strings.xml')));
}

// --- Desktop + Android shared Tauri config ---
{
  const conf = JSON.parse(read('src-tauri/tauri.conf.json'));
  const csp = conf.app.security.csp;
  ok('Tauri: CSP default-src is self', /(^|;)\s*default-src 'self'\s*(;|$)/.test(csp), csp);
  ok('Tauri: CSP connects only to self and the app bridge',
    /connect-src 'self' ipc: http:\/\/ipc\.localhost;/.test(csp), csp);
  ok('Tauri: CSP names no outside site', !/https:\/\/|wss?:/.test(csp), csp);
  ok('Tauri: the app loads the bundled web build', conf.build.frontendDist === '../dist' && conf.build.beforeBuildCommand === 'npm run build');
  ok('Tauri: one window, no remote URL', conf.app.windows.length === 1 && !conf.app.windows[0].url);
  ok('Tauri: installers for every desktop system', conf.bundle.active === true && conf.bundle.targets === 'all');

  const cap = JSON.parse(read('src-tauri/capabilities/default.json'));
  ok('Tauri: only the two app permissions (old key delete, close window)',
    JSON.stringify(cap.permissions) === JSON.stringify(['allow-delete-device-secret', 'core:window:allow-close']), JSON.stringify(cap.permissions));
  ok('Tauri: no plugins that reach out (http, updater, shell, opener)',
    !/tauri-plugin-(http|updater|shell|opener|websocket|upload)/.test(read('src-tauri/Cargo.toml')));
}

// --- macOS: the camera reason the bundler merges into vCGE.app (macOS stops an app that opens the camera without one) ---
{
  const plist = read('src-tauri/Info.plist');
  ok('macOS: Info.plist gives a camera reason', /<key>NSCameraUsageDescription<\/key>\s*<string>[^<]{20,}<\/string>/.test(plist));
  ok('macOS: Info.plist opens no network exceptions', !/NSAppTransportSecurity|NSAllowsArbitraryLoads/.test(plist));
}

// --- DESKTOP DEPENDENCIES LOCK (raven575 2026-10-25): Tauri stays where it is ---
{
  const cargo = read('src-tauri/Cargo.toml');
  ok('Lock: tauri pinned =2.12.0', /tauri = \{ version = "=2\.12\.0"/.test(cargo));
  ok('Lock: tauri-build pinned =2.7.0', /tauri-build = \{ version = "=2\.7\.0"/.test(cargo));
  const pkg = JSON.parse(read('package.json'));
  ok('Lock: Tauri CLI pinned 2.12.0', pkg.devDependencies['@tauri-apps/cli'] === '2.12.0');
  const lock = read('src-tauri/Cargo.lock');
  ok('Lock: glib stays on 0.18.5', /name = "glib"\nversion = "0\.18\.5"/.test(lock));
  ok('Lock: Cargo.lock still has tauri 2.12.0', /name = "tauri"\nversion = "2\.12\.0"/.test(lock));
}

// --- Versions agree, so every wrapper says the same version ---
{
  const v = JSON.parse(read('package.json')).version;
  ok('Version: tauri.conf.json matches package.json', JSON.parse(read('src-tauri/tauri.conf.json')).version === v);
  ok('Version: Cargo.toml matches package.json', read('src-tauri/Cargo.toml').split(/\r?\n/).includes(`version = "${v}"`));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
