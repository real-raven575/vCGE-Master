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

  // raven575's phone run (2026-11-14): the top of the app was under the status bar, and Save .vcf added no contact
  const activity = read(ANDROID + 'main/java/app/vcge/vcge/MainActivity.kt');
  ok('Android: the app is padded clear of the status bar, navigation bar and camera cut-out (edge to edge draws under them)',
    /enableEdgeToEdge\(\)/.test(activity) && /setOnApplyWindowInsetsListener/.test(activity)
      && /Type\.systemBars\(\)\s+or\s+WindowInsetsCompat\.Type\.displayCutout\(\)/.test(activity) && /setPadding\(bars\.left,\s*bars\.top,\s*bars\.right/.test(activity));
  ok('Android: the open keyboard pads the bottom too, so a field being typed in stays in view', /Type\.ime\(\)/.test(activity) && /maxOf\(bars\.bottom,\s*keyboard\.bottom\)/.test(activity));
  ok('Android: Save .vcf hands the card to Contacts (vcgeAndroid.addContact opens a text/x-vcard through the FileProvider)',
    /addJavascriptInterface\(ContactBridge\(\),\s*"vcgeAndroid"\)/.test(activity) && /@JavascriptInterface\s+fun addContact\(vcard: String, fileName: String\): Boolean/.test(activity)
      && /Intent\.ACTION_VIEW/.test(activity) && /"text\/x-vcard"/.test(activity) && /FileProvider\.getUriForFile/.test(activity) && /FLAG_GRANT_READ_URI_PERMISSION/.test(activity));
  ok('Android: the handed-over card is kept only in the app cache and deleted on return to vCGE and at start',
    /File\(cacheDir,\s*"contact"\)/.test(activity) && /override fun onResume\(\)\s*\{\s*super\.onResume\(\)\s*clearContactFiles\(\)/.test(activity)
      && (activity.match(/clearContactFiles\(\)/g) || []).length >= 5);
  // raven575's second phone run (2026-11-14 22:2x UTC): Email, Text message, Share, Save QR image and Print failed in the WebView
  ok('Android: Email and Text message open the phone\'s apps (SENDTO mailto:/smsto:), never a link in the WebView',
    /fun email\(subject: String, body: String\): Boolean/.test(activity) && /ACTION_SENDTO,\s*Uri\.parse\("mailto:"\)/.test(activity) && /EXTRA_SUBJECT/.test(activity)
      && /fun sms\(body: String\): Boolean/.test(activity) && /ACTION_SENDTO,\s*Uri\.parse\("smsto:"\)\)\.putExtra\("sms_body"/.test(activity));
  ok('Android: Share hands the .vcf to the share menu through the FileProvider, with read permission',
    /fun shareContact\(vcard: String, fileName: String, title: String\): Boolean/.test(activity) && /Intent\.ACTION_SEND\)/.test(activity)
      && /EXTRA_STREAM/.test(activity) && /Intent\.createChooser/.test(activity) && /File\(cacheDir,\s*"share"\)/.test(activity));
  ok('Android: shared cards are cleared at start and before the next share (not on return: the app may still be reading)',
    /clearContactFiles\(\)\s*clearShareFiles\(\)/.test(activity) && !/onResume\(\)\s*\{[^}]*clearShareFiles/.test(activity));
  ok('Android: Save QR image writes the PNG to Downloads through MediaStore (no storage permission), Android 10 and later',
    /fun savePng\(base64: String, fileName: String\): Boolean/.test(activity) && /MediaStore\.Downloads\.EXTERNAL_CONTENT_URI/.test(activity)
      && /VERSION_CODES\.Q/.test(activity) && /IS_PENDING, 0/.test(activity) && !/WRITE_EXTERNAL_STORAGE/.test(main));
  ok('Android: Print opens Android\'s print screen for the page on the UI thread, named by the page',
    /fun print\(jobName: String\): Boolean/.test(activity) && /runOnUiThread/.test(activity) && /PrintManager/.test(activity) && /createPrintDocumentAdapter\(name\)/.test(activity));
  ok('Android: the bridge still never loads a page or opens a web link (no ACTION_VIEW on http)', !/https?:\/\//.test(activity.replace(/\/\/.*$/gm, '')));
  const paths = read(ANDROID + 'main/res/xml/file_paths.xml');
  ok('Android: the FileProvider shares the app cache, where the card is written', /<cache-path\s+name="[^"]+"\s+path="\."/.test(paths) && /\$\{applicationId\}\.fileprovider/.test(main));
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

// Download names (raven575, 2026-11-15): version, platform letter and build number on every test download
{
  const { downloadName, buildTag } = await import('../scripts/name-downloads.mjs');
  ok('Downloads: Tauri installer names become vCGE-<version>-<platform><build>, keeping the chip and kind',
    downloadName('vCGE_0.8.1_x64-setup.exe', '0.8.1', 'W', 417) === 'vCGE-0.8.1-W417_x64-setup.exe'
      && downloadName('vCGE_0.8.1_x64_en-US.msi', '0.8.1', 'W', 417) === 'vCGE-0.8.1-W417_x64_en-US.msi'
      && downloadName('vCGE_0.8.1_aarch64.dmg', '0.8.1', 'M', 417) === 'vCGE-0.8.1-M417_aarch64.dmg'
      && downloadName('vCGE_0.8.1_amd64.deb', '0.8.1', 'L', 417) === 'vCGE-0.8.1-L417_amd64.deb');
  ok('Downloads: another file gets the tag and keeps its ending; a named file is left alone',
    downloadName('vcge.AppImage', '0.8.1', 'L', 9) === 'vCGE-0.8.1-L9.AppImage' && downloadName('vCGE-0.8.1-L9_amd64.deb', '0.8.1', 'L', 9) === 'vCGE-0.8.1-L9_amd64.deb');
  let bad = 0;
  for (const [p, b] of [['X', 1], ['W', 'abc']]) { try { buildTag('0.8.1', p, b); } catch (e) { bad++; } }
  ok('Downloads: only the letters A, I, W, L, M and a whole build number are taken', bad === 2 && buildTag('0.8.1', 'I', 3) === '0.8.1-I3');
  const ci = read('.github/workflows/ci.yml');
  ok('Downloads: CI names the desktop installers and the APK, and the artifacts carry the same tag',
    /name-downloads\.mjs src-tauri\/target\/release\/bundle "\$P" "\$\{\{ github\.run_number \}\}"/.test(ci) && /Windows\) P=W ;; macOS\) P=M ;; \*\) P=L/.test(ci)
      && /name: vCGE-\$\{\{ steps\.names\.outputs\.tag \}\}/.test(ci) && /-A\$\{\{ github\.run_number \}\}/.test(ci) && /--out "apk\/vCGE-\$TAG\.apk"/.test(ci) && /name: vCGE-\$\{\{ env\.APK_TAG \}\}/.test(ci));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
