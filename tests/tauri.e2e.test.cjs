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

/** Stops tauri-driver and everything it started (its process group): SIGTERM, then SIGKILL after 3 s. */
async function stopDriver(driver) {
  const signalGroup = (sig) => { try { process.kill(-driver.pid, sig); } catch (e) { /* already gone */ } };
  const exited = new Promise(r => (driver.exitCode !== null || driver.signalCode !== null) ? r() : driver.once('exit', r));
  signalGroup('SIGTERM');
  await Promise.race([exited, sleep(3000)]);
  signalGroup('SIGKILL');
}

(async () => {
  // Own process group and no pipes: nothing the driver starts (WebKitWebDriver, the app) can keep this process alive.
  const driver = spawn('tauri-driver', ['--native-driver', '/usr/bin/WebKitWebDriver'], { stdio: 'ignore', detached: true });
  for (let i = 0; i < 50; i++) { try { await fetch(DRIVER + '/status'); break; } catch (e) { await sleep(200); } }

  const session = await wd('POST', '/session', { capabilities: { alwaysMatch: { 'tauri:options': { application: APP } } } });
  const sid = session.sessionId;
  const S = (p) => `/session/${sid}${p}`;
  const js = (script, ...args) => wd('POST', S('/execute/sync'), { script, args });
  const jsAsync = (script, ...args) => wd('POST', S('/execute/async'), { script, args });
  const el = async (css) => (await wd('POST', S('/element'), { using: 'css selector', value: css }))[ELEMENT];
  // The deck settles on a card a moment after any scroll (a smooth move, an element scrolled into view); a WebDriver
  // click computes its point first and lands on whatever is there, so every click and keystroke waits for a still deck.
  const deckState = () => js(`const t = document.getElementById('deck'), c = document.querySelector('.deck-card.is-current');
    return JSON.stringify({ card: document.documentElement.dataset.card, deck: t && t.dataset.deck, scrollLeft: t && t.scrollLeft, centre: c && c.offsetLeft + c.offsetWidth / 2 - t.clientWidth / 2 });`);
  const deckSettled = async () => {
    const still = await until(() => js(`const t = document.getElementById('deck'), c = document.querySelector('.deck-card.is-current');
      if (!t || !c) return true; const left = c.offsetLeft + c.offsetWidth / 2 - t.clientWidth / 2;
      if (t.dataset.deck === 'moving' || Math.abs(t.scrollLeft - left) > 1.5 || t.scrollLeft !== t.__lastSeen) { t.__lastSeen = t.scrollLeft; return false; } return true;`), 5000);
    if (!still) console.log('deck did not settle:', await deckState());
    return still;
  };
  // Brings the card that holds an element into view first: WebDriver scrolls an element in and acts at once, before
  // the deck has settled on that card and lifted its cover.
  const onCard = async (css) => {
    const wanted = await js(`const el = document.querySelector(arguments[0]), card = el && el.closest('.deck-card');
      return card ? card.dataset.card : null;`, css);
    const current = () => js(`return document.documentElement.dataset.card;`);
    // The header icon brings the card in, as a person would. A move that a late scroll (a focus, a closing dialog)
    // undid is asked for once more.
    for (let attempt = 0; wanted && attempt < 3 && (await current()) !== wanted; attempt++) {
      await deckSettled();
      // Nothing over the header first: a sheet that is still closing, or the padlock hand-off that follows setting a PIN
      // (a header click right after closeVaultPage was "intercepted" once on Linux CI)
      await until(() => js(`const h = document.getElementById('vaultHandoff');
        return (!h || h.classList.contains('hidden')) && !document.querySelector('.vcge-sheet:not(.hidden)');`), 3000);
      await wd('POST', S(`/element/${await el(`.deck-nav [data-card="${wanted}"]:not([data-qr])`)}/click`), {});
      await deckSettled();
      await until(async () => (await current()) === wanted, 3000);
    }
    await deckSettled();
    // The Vault's padlock plays in the middle of the screen for 1.4 s after a hand-off; WebDriver acts once it has gone.
    await until(() => js(`const h = document.getElementById('vaultHandoff'); return !h || h.classList.contains('hidden');`), 3000);
    if (wanted && (await current()) !== wanted) console.log('onCard: still not on', wanted, await deckState());
  };
  const click = async (css) => {
    await onCard(css);
    // WebKitWebDriver scrolls only the page before a click, not the card's own scrolling body, so a button low on a
    // long card is scrolled into view first, as a person would. It must still be the element under the tap.
    await js(`document.querySelector(arguments[0]).scrollIntoView({ block: 'nearest', inline: 'nearest' });`, css);
    try { return await wd('POST', S(`/element/${await el(css)}/click`), {}); } catch (e) {
      // Say what sat in the way (the card in view, the deck position, the element under the target's centre).
      const where = await jsAsync(`const done = arguments[arguments.length - 1], css = arguments[0];
        const el = document.querySelector(css), r = el && el.getBoundingClientRect(), t = document.getElementById('deck');
        const hit = r && document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        const out = { card: document.documentElement.dataset.card, scrollLeft: t && t.scrollLeft, rect: r && [r.left, r.top, r.width, r.height],
          hit: hit && (hit.id || hit.className || hit.tagName), hitParent: hit && hit.parentElement && (hit.parentElement.id || hit.parentElement.className),
          hidden: document.hidden, inner: [innerWidth, innerHeight], cards: Array.from(document.querySelectorAll('.deck-card')).map(c => c.offsetLeft + '/' + c.offsetWidth).join(' ') };
        // Does the deck settle at all? (a) after a synthetic release, (b) after a nudge of the track
        document.dispatchEvent(new Event('pointerup', { bubbles: true }));
        setTimeout(() => { out.afterRelease = document.documentElement.dataset.card + '@' + t.scrollLeft;
          let n = 0; const count = () => n++; t.addEventListener('scroll', count); t.scrollLeft += 3;
          setTimeout(() => { t.removeEventListener('scroll', count); out.afterNudge = document.documentElement.dataset.card + '@' + t.scrollLeft + ' scrollEvents=' + n; done(JSON.stringify(out)); }, 600); }, 400);`, css).catch(() => '?');
      e.message += ` (${css}: ${where})`;
      throw e;
    }
  };
  const type = async (css, text) => { await onCard(css); const id = await el(css); await wd('POST', S(`/element/${id}/clear`), {}); await wd('POST', S(`/element/${id}/value`), { text }); };
  const val = (id) => js(`return document.getElementById(arguments[0]).value;`, id);
  const txt = (id) => js(`return document.getElementById(arguments[0]).textContent.trim();`, id);
  const visible = (id) => js(`const e = document.getElementById(arguments[0]); return !e.classList.contains('hidden');`, id);
  // A check that throws (the page is mid-reload, e.g. right after a wipe) counts as not yet, and is tried again.
  const until = async (fn, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (await fn()) return true; } catch { /* not yet */ } await sleep(250); } return false; };
  // The deck opens on the Welcome card every start: press START to reach the Capture card.
  const startNow = async () => {
    await until(() => js(`return !!document.getElementById('welcomeStartBtn');`), 5000);
    await js(`const b = document.getElementById('welcomeStartBtn'); if (b) b.click();`);
  };
  // The Security panel is the Vault page, a sheet over the deck: open it from the header, close it with its X.
  const openVaultPage = async () => { await click('#navVault'); await until(() => visible('vaultPage'), 5000); };
  const closeVaultPage = async () => { await click('#vaultPage [data-sheet-close]'); await until(async () => !(await visible('vaultPage')), 5000); };

  try {
    await until(() => js(`return document.readyState === 'complete' && !!document.getElementById('vaultModal');`));
    ok('desktop app opens on the Welcome card (START / Take a Tour)', await until(() => js(`return document.getElementById('cardWelcome').classList.contains('is-current') && !!document.getElementById('welcomeTourBtn');`), 5000));
    await click('#welcomeStartBtn');
    ok('START moves the deck to the Capture card', await until(() => js(`return document.documentElement.dataset.card === 'capture' && document.getElementById('cardCapture').classList.contains('is-current');`), 5000));
    ok('desktop app opens straight to an empty card (no passphrase dialog)', !(await visible('vaultModal')) && (await val('firstName')) === '' && (await txt('vaultStateIndicator')) === 'UNLOCKED / memory only');
    ok('Tauri IPC is available (withGlobalTauri)', await js(`return !!(window.__TAURI__ && window.__TAURI__.core);`));
    ok('page is served from the Tauri asset protocol', /^(tauri:|http:\/\/tauri\.localhost)/.test(await js('return location.href;')), await js('return location.href;'));
    ok('desktop: the header logo loads from the bundled file', await until(() => js(`const i = document.querySelector('.deck-logo'); return !!i && i.complete && i.naturalWidth > 0;`), 5000));
    ok('keyring starts empty', !keyringHasDeviceKey());

    // Session PIN from the Security panel (the Vault page)
    await openVaultPage();
    await click('#pinSwitch');
    await type('#sessionPinInput', '2468'); await click('#quickSetupSaveBtn');
    ok('session PIN set in the desktop app', await until(async () => !(await visible('quickSetupModal')) && (await txt('sessionPinStatus')) === 'Session PIN: set', 10000));
    await closeVaultPage();

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
    ok('upload opens the crop step on the Capture card', await until(() => visible('captureReview'), 5000));
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
    await until(() => js(`const i = document.getElementById('reviewImage'); return i.naturalWidth === 1600 && !document.getElementById('captureReview').classList.contains('hidden');`), 5000);
    await onCard('#reviewImage');
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
    await until(() => visible('captureReview'), 5000);
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
    await startNow();
    ok('after reload: empty card, no unlock dialog', await until(async () => (await val('firstName')) === '' && !(await visible('vaultModal')), 5000));

    // A keychain-bound vault saved by an older build is deleted at startup, with its keychain device key
    await js(`localStorage.setItem('vCGE_secure_vault.dat', JSON.stringify({ v: 2, kdf: 'pbkdf2-sha256+hkdf-device-key', ciphertext: [1, 2, 3] }));`);
    await wd('POST', S('/refresh'), {});
    await until(() => js(`return document.readyState === 'complete' && !!document.getElementById('auditLog');`));
    await startNow();
    ok('old keychain-bound vault deleted at startup', await until(async () => (await js(`return localStorage.getItem('vCGE_secure_vault.dat');`)) === null
      && (await txt('auditLog')).includes('copy saved by an older build'), 5000), await txt('auditLog'));
    const ipc = await jsAsync(`const done = arguments[arguments.length - 1]; const inv = window.__TAURI__.core.invoke;
      inv('delete_device_secret').then(() => inv('device_secret', { create: true }).then(() => done('created'), () => done('ok')), e => done('delete failed: ' + e));`);
    ok('desktop: deleting the old device key works and no key can be created any more', ipc === 'ok' && !keyringHasDeviceKey(), ipc);

    // Hold-to-wipe: the Vault page's wipe button opens the question; Yes held 1.5 s wipes and reloads
    await type('#firstName', 'Wipe me');
    await openVaultPage();
    await click('#wipeVaultBtn');
    ok('desktop: the wipe button asks the hold-to-wipe question', await until(async () => visible('wipeDialog'), 5000));
    await js(`document.getElementById('wipeYesBtn').dispatchEvent(new PointerEvent('pointerdown', { button: 0, pointerId: 1, pointerType: 'mouse', bubbles: true }));`);
    await new Promise(r => setTimeout(r, 400));
    await js(`document.getElementById('wipeYesBtn').dispatchEvent(new PointerEvent('pointerup', { button: 0, pointerId: 1, pointerType: 'mouse', bubbles: true }));`);
    ok('desktop: letting go of Yes early keeps the card', (await val('firstName')) === 'Wipe me' && await visible('wipeDialog'));
    await js(`document.getElementById('wipeYesBtn').dispatchEvent(new PointerEvent('pointerdown', { button: 0, pointerId: 1, pointerType: 'mouse', bubbles: true }));`);
    await new Promise(r => setTimeout(r, 1700));
    await js(`document.getElementById('wipeYesBtn').dispatchEvent(new PointerEvent('pointerup', { button: 0, pointerId: 1, pointerType: 'mouse', bubbles: true }));`);
    ok('desktop: Yes held 1.5 s wipes the card and the app starts fresh', await until(async () => (await val('firstName')) === '' && !(await visible('wipeDialog')) && !(await visible('vaultModal')), 8000));

    // Text size in the system webview (WebKitGTK, WKWebView: the Safari engine, video #6): the text grows, the header
    // and its icons keep their size. CSS zoom did not hold the header in WebKit.
    const sizes = () => js(`const r = e => e.getBoundingClientRect();
      return { root: parseFloat(getComputedStyle(document.documentElement).fontSize), note: parseFloat(getComputedStyle(document.getElementById('settingsNote')).fontSize),
        header: r(document.querySelector('.deck-header')).height, icon: r(document.querySelector('#navSettings .vcge-icon')).width };`);
    const pickSize = (code) => js(`const s = document.getElementById('sizeSelect'); s.value = arguments[0]; s.dispatchEvent(new Event('change', { bubbles: true }));`, code);
    const sizeNormal = await sizes();
    await pickSize('2'); await sleep(200);
    const sizeLarger = await sizes();
    ok('desktop: Larger text grows the text by a quarter, the header and its icons keep their size', Math.abs(sizeLarger.root / sizeNormal.root - 1.25) < 0.01 && Math.abs(sizeLarger.note / sizeNormal.note - 1.25) < 0.03
      && Math.abs(sizeLarger.header - sizeNormal.header) < 0.6 && Math.abs(sizeLarger.icon - sizeNormal.icon) < 0.6, JSON.stringify([sizeNormal, sizeLarger]));
    await pickSize('0'); await js(`localStorage.removeItem('vcge_settings');`);

    // Left hand at tablet width in the system webview (WebKit, as on the iPad): the mirrored nav spills to its left,
    // where WebKit's scrollWidth does not look, so the header kept the names, squeezed (raven575, 2026-10-18).
    const navFit = () => js(`const h = document.querySelector('.deck-header'), box = h.querySelector('.deck-nav').getBoundingClientRect();
      const out = Array.from(h.querySelectorAll('.deck-nav button')).filter(b => { const r = b.getBoundingClientRect(); return r.left < box.left - 0.5 || r.right > box.right + 0.5; }).map(b => b.id);
      return { hand: document.documentElement.dataset.hand, compact: h.classList.contains('is-compact'), names: getComputedStyle(document.querySelector('#navCapture span')).display !== 'none', out };`);
    const winRect = await wd('GET', S('/window/rect'));
    await wd('POST', S('/window/rect'), { width: 820, height: winRect.height });
    await until(async () => (await js('return innerWidth;')) <= 820, 5000);
    await js(`document.getElementById('handLeftBtn').click();`);
    const leftFits = await until(async () => { const f = await navFit(); return f.hand === 'left' && f.compact && !f.names && f.out.length === 0; }, 5000);
    ok('desktop: left hand at tablet width shows icons only, like right hand, every button inside the header', leftFits, JSON.stringify(await navFit()));
    await js(`document.getElementById('handRightBtn').click(); localStorage.removeItem('vcge_settings');`);
    await wd('POST', S('/window/rect'), { width: winRect.width, height: winRect.height });
  } finally {
    await wd('DELETE', S('')).catch(() => {});
    await stopDriver(driver);
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
