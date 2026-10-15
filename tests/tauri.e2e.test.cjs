// vCGE desktop end-to-end test: drives the real Tauri binary through tauri-driver (WebDriver).
// Linux: run via `npm run test:tauri` (tests/run-tauri-e2e.sh sets up Xvfb, D-Bus and an unlocked keyring).
// Needs: a built app (`npx tauri build --debug --no-bundle`), tauri-driver, WebKitWebDriver, secret-tool.
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const jsQR = require('jsqr');

const ROOT = path.resolve(__dirname, '..');
const APP = process.env.VCGE_APP || path.join(ROOT, 'src-tauri/target/debug/vcge');
const DRIVER = 'http://127.0.0.1:4444';
const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log('PASS', n)) : (fail++, console.log('FAIL', n, d)); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function wd(method, url, body) {
  const res = await fetch(DRIVER + url, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  const json = await res.json();
  if (json.value && json.value.error) throw new Error(`${method} ${url}: ${json.value.error} ${json.value.message}`);
  return json.value;
}

function keyringHasDeviceKey() {
  try { return execFileSync('secret-tool', ['search', 'service', 'com.vcge.app'], { stdio: ['ignore', 'pipe', 'pipe'] }).toString().includes('vault-device-key'); }
  catch (e) { return false; }
}

(async () => {
  const driver = spawn('tauri-driver', ['--native-driver', '/usr/bin/WebKitWebDriver'], { stdio: ['ignore', 'pipe', 'pipe'] });
  for (let i = 0; i < 50; i++) { try { await fetch(DRIVER + '/status'); break; } catch (e) { await sleep(200); } }

  const session = await wd('POST', '/session', { capabilities: { alwaysMatch: { 'tauri:options': { application: APP } } } });
  const sid = session.sessionId;
  const S = (p) => `/session/${sid}${p}`;
  const js = (script, ...args) => wd('POST', S('/execute/sync'), { script, args });
  const jsAsync = (script, ...args) => wd('POST', S('/execute/async'), { script, args });
  const el = async (css) => (await wd('POST', S('/element'), { using: 'css selector', value: css }))[ELEMENT];
  const click = async (css) => wd('POST', S(`/element/${await el(css)}/click`), {});
  const type = async (css, text) => { const id = await el(css); await wd('POST', S(`/element/${id}/clear`), {}); await wd('POST', S(`/element/${id}/value`), { text }); };
  const val = (id) => js(`return document.getElementById(arguments[0]).value;`, id);
  const txt = (id) => js(`return document.getElementById(arguments[0]).textContent.trim();`, id);
  const visible = (id) => js(`const e = document.getElementById(arguments[0]); return !e.classList.contains('hidden');`, id);
  const until = async (fn, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(250); } return false; };

  try {
    await until(() => js(`return document.readyState === 'complete' && !!document.getElementById('vaultModal');`));
    ok('desktop app opens straight to an empty card (no passphrase dialog)', !(await visible('vaultModal')) && (await val('firstName')) === '' && (await txt('vaultStateIndicator')) === 'UNLOCKED / memory only');
    ok('Tauri IPC is available (withGlobalTauri)', await js(`return !!(window.__TAURI__ && window.__TAURI__.core);`));
    ok('page is served from the Tauri asset protocol', /^(tauri:|http:\/\/tauri\.localhost)/.test(await js('return location.href;')), await js('return location.href;'));
    ok('keyring starts empty', !keyringHasDeviceKey());

    // Session PIN from the Security panel
    await click('#setSessionPinBtn');
    await type('#sessionPinInput', '2468'); await click('#quickSetupSaveBtn');
    ok('session PIN set in the desktop app', await until(async () => !(await visible('quickSetupModal')) && (await txt('sessionPinStatus')) === 'Session PIN: set', 10000));

    await type('#firstName', 'Desk'); await type('#lastName', 'Top'); await type('#organization', 'Tauri, Inc');
    await sleep(900);
    const stored = await js('return JSON.stringify(localStorage);');
    ok('nothing saved in webview storage (no vault, no card)', !stored.includes('vCGE_secure_vault') && !stored.includes('Desk'), stored.slice(0, 200));
    ok('nothing stored in the OS keyring', !keyringHasDeviceKey());

    // Egress lock inside the desktop webview
    const blocked = await jsAsync(`const done = arguments[arguments.length - 1]; fetch('https://example.com/x').then(() => done('ALLOWED'), () => done('blocked'));`);
    ok('gatekeeper blocks external fetch in the desktop app', blocked === 'blocked');

    // Real OCR inside WebKitGTK (worker + WASM from the tauri:// asset protocol)
    await js(`
      const c = document.createElement('canvas'); c.width = 1050; c.height = 600;
      const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.fillStyle = '#111';
      const lines = [['bold 56px sans-serif', 'Maria Gonzalez'], ['34px sans-serif', 'Director of Engineering'], ['34px sans-serif', 'Northwind Systems'],
        ['30px sans-serif', '+1 (312) 555-0147'], ['30px sans-serif', 'maria.gonzalez@northwind.com'], ['30px sans-serif', 'https://northwind.com']];
      let y = 80; for (const [f, t] of lines) { x.font = f; x.fillText(t, 70, y); y += f.startsWith('bold') ? 80 : 62; }
      const bin = atob(c.toDataURL('image/png').split(',')[1]); const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const dt = new DataTransfer(); dt.items.add(new File([bytes], 'card.png', { type: 'image/png' }));
      const input = document.getElementById('imageUpload'); input.files = dt.files; input.dispatchEvent(new Event('change'));`);
    ok('upload opens review modal', await until(() => visible('cropReviewModal'), 5000));
    await click('#runOcrBtn');
    ok('real OCR runs in the desktop webview and opens the review step', await until(() => visible('ocrStepText'), 90000), await txt('toastMessage'));
    await click('#applyOcrBtn');
    await until(async () => !(await visible('cropReviewModal')), 5000);
    const toast = await txt('toastMessage');
    ok('Fill form fills the form from the review', toast.includes('Form filled'), toast);
    const typedRow = (list, type) => js(`const l = document.getElementById(arguments[0] + 'List');
      for (let i = 0; i < l.children.length; i++) if (document.getElementById(arguments[0] + 'Type' + i).value === arguments[1]) return document.getElementById(arguments[0] + 'Value' + i).value;
      return null;`, list, type);
    ok('OCR fills name, email and phone', (await val('firstName')) === 'Maria' && (await typedRow('email', 'work')) === 'maria.gonzalez@northwind.com' && (await typedRow('phone', 'work')) === '+1 (312) 555-0147',
      [await val('firstName'), await typedRow('email', 'work'), await typedRow('phone', 'work')].join(' | '));

    // Scannable QR
    const qr = await js(`const c = document.getElementById('qrCanvas'); return { w: c.width, h: c.height, d: Array.from(c.getContext('2d').getImageData(0, 0, c.width, c.height).data) };`);
    const decoded = jsQR(Uint8ClampedArray.from(qr.d), qr.w, qr.h);
    ok('QR code in the desktop app decodes to the vCard', decoded && decoded.data.includes('FN:Maria Gonzalez'), decoded && decoded.data.slice(0, 60));
    await sleep(900);

    // Crop & straighten in WebKitGTK: a crooked card, corners dragged with real pointer input, then read
    const corners = await js(`
      const c = document.createElement('canvas'); c.width = 1600; c.height = 1200;
      const x = c.getContext('2d'); x.fillStyle = '#6b7280'; x.fillRect(0, 0, c.width, c.height);
      const m = new DOMMatrix().translate(820, 600).rotate(-24).skewX(-12).translate(-525, -300);
      x.setTransform(m); x.fillStyle = '#fff'; x.fillRect(0, 0, 1050, 600); x.fillStyle = '#111';
      const lines = [['bold 56px sans-serif', 'Maria Gonzalez'], ['34px sans-serif', 'Director of Engineering'], ['34px sans-serif', 'Northwind Systems'],
        ['30px sans-serif', '+1 (312) 555-0147'], ['30px sans-serif', 'maria.gonzalez@northwind.com'], ['30px sans-serif', 'https://northwind.com']];
      let y = 80; for (const [f, t] of lines) { x.font = f; x.fillText(t, 70, y); y += f.startsWith('bold') ? 80 : 62; }
      const bin = atob(c.toDataURL('image/png').split(',')[1]); const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const dt = new DataTransfer(); dt.items.add(new File([bytes], 'crooked.png', { type: 'image/png' }));
      const input = document.getElementById('imageUpload'); input.files = dt.files; input.dispatchEvent(new Event('change'));
      return [[0, 0], [1050, 0], [1050, 600], [0, 600]].map(([px, py]) => { const p = m.transformPoint({ x: px, y: py }); return [p.x, p.y]; });`);
    await until(() => js(`const i = document.getElementById('reviewImage'); return i.naturalWidth === 1600 && !document.getElementById('cropReviewModal').classList.contains('hidden');`), 5000);
    for (let i = 0; i < 4; i++) {
      const g = await js(`const i = document.getElementById('reviewImage').getBoundingClientRect(), h = document.querySelector('[data-corner="${i}"]').getBoundingClientRect();
        return { hx: h.left + h.width / 2, hy: h.top + h.height / 2, ix: i.left, iy: i.top, iw: i.width, ih: i.height };`);
      const tx = Math.round(g.ix + corners[i][0] / 1600 * g.iw), ty = Math.round(g.iy + corners[i][1] / 1200 * g.ih);
      await wd('POST', S('/actions'), { actions: [{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: [
        { type: 'pointerMove', duration: 0, x: Math.round(g.hx), y: Math.round(g.hy), origin: 'viewport' }, { type: 'pointerDown', button: 0 },
        { type: 'pointerMove', duration: 150, x: tx, y: ty, origin: 'viewport' }, { type: 'pointerUp', button: 0 }] }] });
    }
    await wd('DELETE', S('/actions')).catch(() => {});
    const placed = (await js(`return document.getElementById('cropPolygon').getAttribute('points');`)).split(' ').map(p => p.split(',').map(Number));
    ok('desktop: dragged corners land on the card', placed.length === 4 && placed.every(([px, py], i) => Math.hypot(px - corners[i][0], py - corners[i][1]) < 15), JSON.stringify(placed));
    await click('#runOcrBtn');
    await until(() => visible('ocrStepText'), 90000);
    const cropped = await txt('ocrSummary');
    ok('desktop: straightened crooked card is read', cropped.includes('maria.gonzalez@northwind.com') && cropped.includes('Maria'), cropped);
    await click('#ocrCancelBtn');

    // Icon detection in WebKitGTK: a mobile icon instead of a label types the number
    const mobileIcon = require('fs').readFileSync(path.join(ROOT, 'node_modules/@tabler/icons/icons/outline/device-mobile.svg'), 'utf8').replace(/currentColor/g, '#111');
    await jsAsync(`const done = arguments[arguments.length - 1]; (async () => {
      const c = document.createElement('canvas'); c.width = 1050; c.height = 420; const x = c.getContext('2d');
      x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.fillStyle = '#111';
      x.font = 'bold 52px sans-serif'; x.fillText('Kai Takahashi', 60, 90);
      const img = new Image(); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(arguments[0]); await img.decode();
      x.drawImage(img, 60, 191, 34, 34); x.font = '30px sans-serif'; x.fillText('206.555.9876', 115, 220);
      x.fillText('kai@studiocraft.design', 115, 300);
      const bin = atob(c.toDataURL('image/png').split(',')[1]); const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const dt = new DataTransfer(); dt.items.add(new File([bytes], 'icons.png', { type: 'image/png' }));
      const input = document.getElementById('imageUpload'); input.files = dt.files; input.dispatchEvent(new Event('change'));
      done(true); })();`, mobileIcon);
    await until(() => visible('cropReviewModal'), 5000);
    await click('#runOcrBtn');
    await until(async () => (await visible('ocrStepText')) || (await visible('ocrRetakeNotice')), 90000);
    const iconSummary = (await visible('ocrStepText')) ? await txt('ocrSummary') : `review step not shown (retake prompt: ${await visible('ocrRetakeNotice')})`;
    ok('desktop: icon recognised and the unlabelled number typed Mobile', iconSummary.includes('Phone (Mobile)+1 (206) 555-9876')
      && (await js(`return Array.from(document.querySelectorAll('#ocrLines [id^="ocrLineIcon"]')).map(e => e.textContent).join(',');`)).includes('Mobile icon'), iconSummary);
    await click((await visible('ocrStepText')) ? '#ocrCancelBtn' : '#cancelReviewBtn');

    // Idle 2 minutes with a session PIN: the card is hidden and the PIN brings it back (real time, no fake clock here)
    await click('#firstName');
    await sleep(124000);
    ok('desktop: idle lock with a session PIN shows the PIN prompt', await until(async () => (await visible('vaultModal')) && (await visible('vaultPinRow')) && (await val('firstName')) === '', 10000));
    await type('#vaultPin', '2468');   // unlocks on the 4th digit
    ok('desktop: session PIN restores the card', await until(async () => !(await visible('vaultModal')) && (await val('firstName')) === 'Maria', 10000), await val('firstName'));

    // Restart the page: nothing was saved, so it starts empty
    await wd('POST', S('/refresh'), {});
    await until(() => js(`return document.readyState === 'complete' && !!document.getElementById('vaultModal');`));
    ok('after reload: empty card, no unlock dialog', await until(async () => (await val('firstName')) === '' && !(await visible('vaultModal')), 5000));

    // A keychain-bound vault saved by an older build is deleted at startup, with its keychain device key
    await js(`localStorage.setItem('vCGE_secure_vault.dat', JSON.stringify({ v: 2, kdf: 'pbkdf2-sha256+hkdf-device-key', ciphertext: [1, 2, 3] }));`);
    await wd('POST', S('/refresh'), {});
    await until(() => js(`return document.readyState === 'complete' && !!document.getElementById('auditLog');`));
    ok('old keychain-bound vault deleted at startup', await until(async () => (await js(`return localStorage.getItem('vCGE_secure_vault.dat');`)) === null
      && (await txt('auditLog')).includes('copy saved by an older build'), 5000), await txt('auditLog'));
    const ipc = await jsAsync(`const done = arguments[arguments.length - 1]; const inv = window.__TAURI__.core.invoke;
      inv('delete_device_secret').then(() => inv('device_secret', { create: true }).then(() => done('created'), () => done('ok')), e => done('delete failed: ' + e));`);
    ok('desktop: deleting the old device key works and no key can be created any more', ipc === 'ok' && !keyringHasDeviceKey(), ipc);

    // Wipe button
    await js('window.confirm = () => true;');
    await type('#firstName', 'Wipe me');
    await click('#wipeVaultBtn');
    ok('desktop: Wipe empties the card', await until(async () => (await val('firstName')) === '' && (await txt('auditLog')).includes('Vault wiped'), 5000));
  } finally {
    await wd('DELETE', S('')).catch(() => {});
    driver.kill();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})().catch(e => { console.error(e); process.exit(1); });
