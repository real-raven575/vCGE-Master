// vCGE end-to-end tests in a headless browser (`npm run test:e2e`).
// Needs devDependencies (`npm install`) and the browser for Playwright (`npx playwright install chromium`).
// SERVE_DIR=dist runs the same suite against the Vite build (`npm run build` first).
// VCGE_BROWSER picks the browser: chromium (default), firefox, webkit, or the branded chrome / msedge.
// VCGE_DEVICE makes it a phone, by Playwright device name (e.g. "iPhone 15" with webkit, "Galaxy S24" with chromium).
// The edition is read from the served index.html (the plain branch sets <html data-edition="plain">); VCGE_EDITION=plain
// runs the plain edition from the working branch by adding that attribute to every page load (test only).
const path = require('path'), fs = require('fs'), { spawn } = require('child_process');
const playwright = require('playwright');
const jsQR = require('jsqr');

const ROOT = path.resolve(__dirname, '..');
const PORT = String(18000 + Math.floor(Math.random() * 2000));
const ORIGIN = `http://localhost:${PORT}/`;
const FORCE_PLAIN = process.env.VCGE_EDITION === 'plain';
let EDITION_PLAIN = FORCE_PLAIN;   // settled once the server is up

// The sample contacts as the edition under test lists them (card3dView.js PRESETS / PLAIN_PRESETS): first, last, company
const SAMPLES_BRANDED = [['Shutout', 'the Box Turtle'], ['Ghost', 'the Raccoon'], ['Iris', 'the Lynx'], ['Glyph', 'the Owl'], ['Pidge', 'the Octopus'], ['Flipside', 'the Chameleon'],
  ['Checkers', 'the Zebra'], ['Airlock', 'the Falcon'], ['Tally', 'the Hamster'], ['Cornerstone', 'the Elephant']].map(n => [...n, 'Team vCGE']);
const SAMPLES_PLAIN = [['Avery', 'Collins', 'Northwind Design'], ['Jordan', 'Patel', 'Brightline Legal'], ['Maya', 'Rivera', 'Rivera Photography'],
  ['Samuel', 'Okafor', 'Lakeside Clinic'], ['Priya', 'Nair', 'Harbor Logistics'], ['Lena', 'Fischer', 'Fischer and Co.'], ['Marcus', 'Chen', 'Summit Realty'],
  ['Grace', 'Thompson', 'Oakridge Bank'], ['Rosa', 'Delgado', 'Delgado Bookkeeping'], ['Daniel', 'Brooks', 'Brooks Consulting']];
const ANIMALS = ['🐢', '🦝', '🐈', '🦉', '🐙', '🦎', '🦓', '🦅', '🐹', '🐘'];
const samples = () => (EDITION_PLAIN ? SAMPLES_PLAIN : SAMPLES_BRANDED);
const samplePrompt = () => (EDITION_PLAIN ? 'Sample contact' : 'Sample vCGE pilot contact');
const sampleList = () => [samplePrompt(), ...samples().map(([f, l, o], i) => (EDITION_PLAIN ? `${f} ${l}, ${o}` : `${ANIMALS[i]} ${f} ${l}`))].join('|');

// Renders a business card image in the page so OCR runs on real pixels.
// `blur` (px, the Gaussian's standard deviation) simulates a shaky or out-of-focus photo. The blur is computed here
// (three box blurs) rather than with the canvas `filter`, which WebKit ignores, so every engine gets the same photo.
async function renderCardImage(page, blur = 0) {
  const dataUrl = await page.evaluate((blur) => {
    const c = document.createElement('canvas'); c.width = 1050; c.height = 600;
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.fillStyle = '#111';
    const lines = [['bold 56px Arial', 'Maria Gonzalez'], ['34px Arial', 'Director of Engineering'], ['34px Arial', 'Northwind Systems'],
      ['30px Arial', '+1 (312) 555-0147'], ['30px Arial', 'maria.gonzalez@northwind.com'], ['30px Arial', 'https://northwind.com'],
      ['30px Arial', '233 South Wacker Drive'], ['30px Arial', 'Chicago, IL 60606']];
    let y = 80; for (const [f, t] of lines) { x.font = f; x.fillText(t, 70, y); y += f.startsWith('bold') ? 80 : 62; }
    if (blur) {
      const w = c.width, h = c.height, img = x.getImageData(0, 0, w, h);
      let g = new Float32Array(w * h).map((_, i) => img.data[i * 4]);
      const at = (a, i, n) => a[Math.min(n - 1, Math.max(0, i))];
      const box = (a, r) => {   // separable running-sum box blur, edges clamped
        const t = new Float32Array(a.length), o = new Float32Array(a.length), n = 2 * r + 1;
        for (let yy = 0; yy < h; yy++) {
          const row = a.subarray(yy * w, yy * w + w); let s = 0;
          for (let k = -r; k <= r; k++) s += at(row, k, w);
          for (let xx = 0; xx < w; xx++) { t[yy * w + xx] = s / n; s += at(row, xx + r + 1, w) - at(row, xx - r, w); }
        }
        for (let xx = 0; xx < w; xx++) {
          const col = (i) => t[Math.min(h - 1, Math.max(0, i)) * w + xx]; let s = 0;
          for (let k = -r; k <= r; k++) s += col(k);
          for (let yy = 0; yy < h; yy++) { o[yy * w + xx] = s / n; s += col(yy + r + 1) - col(yy - r); }
        }
        return o;
      };
      // Box widths whose three passes approximate a Gaussian of this standard deviation.
      let wl = Math.floor(Math.sqrt(4 * blur * blur + 1)); if (wl % 2 === 0) wl--;
      const m = Math.round((12 * blur * blur - 3 * wl * wl - 12 * wl - 9) / (-4 * wl - 4));
      for (let i = 0; i < 3; i++) g = box(g, ((i < m ? wl : wl + 2) - 1) / 2);
      for (let i = 0; i < w * h; i++) img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = g[i];
      x.putImageData(img, 0, 0);
    }
    return c.toDataURL('image/png');
  }, blur);
  return { name: 'card.png', mimeType: 'image/png', buffer: Buffer.from(dataUrl.split(',')[1], 'base64') };
}

// Renders the same card rotated and sheared on a grey background (a crooked photo) and returns the card's corners.
async function renderSkewedCard(page) {
  const { dataUrl, corners } = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 1600; c.height = 1200;
    const x = c.getContext('2d'); x.fillStyle = '#6b7280'; x.fillRect(0, 0, c.width, c.height);
    const m = new DOMMatrix().translate(820, 600).rotate(-24).skewX(-12).translate(-525, -300);
    x.setTransform(m);
    x.fillStyle = '#fff'; x.fillRect(0, 0, 1050, 600); x.fillStyle = '#111';
    const lines = [['bold 56px Arial', 'Maria Gonzalez'], ['34px Arial', 'Director of Engineering'], ['34px Arial', 'Northwind Systems'],
      ['30px Arial', '+1 (312) 555-0147'], ['30px Arial', 'maria.gonzalez@northwind.com'], ['30px Arial', 'https://northwind.com'],
      ['30px Arial', '233 South Wacker Drive'], ['30px Arial', 'Chicago, IL 60606']];
    let y = 80; for (const [f, t] of lines) { x.font = f; x.fillText(t, 70, y); y += f.startsWith('bold') ? 80 : 62; }
    const corners = [[0, 0], [1050, 0], [1050, 600], [0, 600]].map(([px, py]) => { const p = m.transformPoint({ x: px, y: py }); return { x: p.x, y: p.y }; });
    return { dataUrl: c.toDataURL('image/png'), corners };
  });
  return { file: { name: 'crooked.png', mimeType: 'image/png', buffer: Buffer.from(dataUrl.split(',')[1], 'base64') }, corners };
}

// Drags each crop handle onto a point given in the photo's own pixels.
// Waits until the deck has finished scrolling and the card in view sits centred (positions measured after this hold).
const deckSettled = (page) => page.waitForFunction(() => {
  const t = document.getElementById('deck'), c = document.querySelector('.deck-card.is-current');
  return !!c && Math.abs(t.scrollLeft - (c.offsetLeft + c.offsetWidth / 2 - t.clientWidth / 2)) < 1.5;
});

async function dragCorners(page, corners) {
  await deckSettled(page);
  const box = await page.locator('#reviewImage').boundingBox();
  const natural = await page.$eval('#reviewImage', i => ({ w: i.naturalWidth, h: i.naturalHeight }));
  for (let i = 0; i < 4; i++) {
    const h = await page.locator(`[data-corner="${i}"]`).boundingBox();
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2); await page.mouse.down();
    await page.mouse.move(box.x + corners[i].x / natural.w * box.width, box.y + corners[i].y / natural.h * box.height, { steps: 5 });
    await page.mouse.up();
  }
}

// Typed rows of a list ('phone' | 'email' | 'website') as [{ type, value }].
const rows = (page, id) => page.evaluate((id) => Array.from(document.getElementById(`${id}List`).children)
  .map((_, i) => ({ type: document.getElementById(`${id}Type${i}`).value, value: document.getElementById(`${id}Value${i}`).value })), id);
const rowValue = async (page, id, type) => ((await rows(page, id)).find(r => r.type === type) || {}).value;
// Proceed on the Read card: the review text blinks out first (MOD04), then the deck moves to Fields and the form fills.
// The card's spin runs in JS (26 fps steps); waits for it to settle on a face.
const settled = (page) => page.waitForFunction(() => !/moving|drag/.test(document.getElementById('card3DFlipper').dataset.spin || ''), null, { timeout: 3000 });
// Where a read stopped (the Read card's label, the wash, which dialog, prompt or toast is up, and the reader's last log
// lines), for the message of a check that waited for a read in vain.
const readStage = (page) => page.evaluate(() => {
  const v = (id) => { const e = document.getElementById(id); return !!e && !!(e.offsetWidth || e.offsetHeight); };
  const bar = document.getElementById('ocrProgressBar'), toast = document.getElementById('toastMessage');
  return 'read stopped at ' + JSON.stringify({ card: document.documentElement.dataset.card, label: (document.getElementById('ocrProgressLabel') || {}).textContent,
    wash: bar && bar.getAttribute('aria-valuenow'), reading: v('ocrProgress'), review: v('ocrStepText'), timeoutPrompt: v('ocrTimeoutModal'), retakePrompt: v('ocrRetakeNotice'),
    toast: toast && toast.textContent, log: (window.__readerLog || []).slice(-8) });
}).catch(e => 'read stage unknown: ' + e.message);
// Waits up to 90 s for a read to end at `sel`; if it does not, the error says where the read stopped.
async function readEnds(page, sel = '#ocrStepText') {
  try { await page.waitForSelector(sel, { state: 'visible', timeout: 90000 }); }
  catch (e) { throw new Error(`${e.message}\n${await readStage(page)}`); }
}
const proceed = async (page) => { await page.click('#applyOcrBtn'); await page.waitForSelector('#cropReviewModal', { state: 'hidden', timeout: 5000 }); };

async function decodeQr(page) {
  const qr = await page.evaluate(() => { const c = document.getElementById('qrCanvas'); return { w: c.width, h: c.height, data: Array.from(c.getContext('2d').getImageData(0, 0, c.width, c.height).data) }; });
  const r = jsQR(Uint8ClampedArray.from(qr.data), qr.w, qr.h);
  return r && r.data;
}

// The Security panel is the Vault page, a sheet over the deck: the header padlock icon opens it, its X (or Esc) closes it.
const vaultOpen = (page) => page.isVisible('#vaultPage');
// The logo (a CSS background, edition.js): in the branded edition drawn from the bundled file and named vCGE for screen
// readers; in plain not shown, with no background to fetch.
async function logoMarkShown(page, sel) {
  return page.$eval(sel, async (el) => {
    // (Its size is checked by the caller: on a phone the header's brand is hidden by design, deck.css)
    const m = /url\("?([^")]+)"?\)/.exec(getComputedStyle(el).backgroundImage);
    if (!m || !m[1].startsWith(location.origin) || el.getAttribute('role') !== 'img' || el.getAttribute('aria-label') !== 'vCGE') return false;
    const img = new Image(); img.src = m[1];
    return img.decode().then(() => img.naturalWidth > 0, () => false);
  });
}
async function logoMarkGone(page, sel) {
  return page.$$eval(sel, els => els.every(el => getComputedStyle(el).display === 'none' && getComputedStyle(el).backgroundImage === 'none'));
}
async function openVault(page) { if (!(await vaultOpen(page))) { await page.click('#navVault'); await page.waitForSelector('#vaultPage', { state: 'visible' }); } }
async function closeVault(page) { if (await vaultOpen(page)) { await page.click('#vaultPage [data-sheet-close]'); await page.waitForSelector('#vaultPage', { state: 'hidden' }); } }

// On phones the header has no room for the Lock button, so Lock lives on the Vault page ("Lock now") instead.
const isPhone = () => !!(deviceOptions.viewport && deviceOptions.viewport.width < 600);
// Presses the lock control this layout shows (on a phone: on the Vault page, which closes itself on Lock now).
async function pressLock(page) {
  if (!isPhone()) return page.click('#lockVaultBtn');
  await openVault(page);
  await page.click('#vaultLockNowBtn');
  await page.waitForSelector('#vaultPage', { state: 'hidden' });
}
// Whether a lock control is offered: the header button, or on a phone the Vault page's Lock now (looked at and closed again).
async function lockOffered(page) {
  if (!isPhone()) return page.isVisible('#lockVaultBtn');
  const wasOpen = await vaultOpen(page);
  await openVault(page);
  const offered = await page.isVisible('#vaultLockNowBtn');
  if (!wasOpen) await closeVault(page);
  return offered;
}

// Sets a session PIN from the Security panel (opens the Vault page, and closes it again if it was closed).
async function setPin(page, pin) {
  const wasOpen = await vaultOpen(page);
  await openVault(page);
  await page.click('#pinSwitch');
  await page.fill('#sessionPinInput', pin); await page.click('#quickSetupSaveBtn');
  await page.waitForSelector('#quickSetupModal', { state: 'hidden' });
  if (!wasOpen) await closeVault(page);
}

// Holds the green Yes of the hold-to-wipe dialog for `ms` (real time, or fake-clock time when `clock` is given).
// A full hold (1.5 s or more) wipes and reloads the page: the call returns once the new page has loaded.
async function holdYes(page, ms, clock = null) {
  await page.evaluate(() => { window.__vcgeOldPage = true; });
  const box = await page.locator('#wipeYesBtn').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  if (clock) await clock.runFor(ms);
  else if (ms < 1500) await page.waitForTimeout(ms);
  // A full hold: let go as soon as the dialog says the hold is complete (data-hold="done"), as a person does when the
  // sweep shows. Letting go later would race the page reload that follows the sweep (WebKit stalls on a mouse event
  // sent while the page is replaced). If the hold never completes the wait fails, so nothing is loosened.
  else await page.waitForFunction(() => document.getElementById('wipeDialog').dataset.hold === 'done', null, { timeout: ms + 1500 });
  await page.mouse.up();
  if (ms < 1500) return;
  if (clock) await clock.runFor(600);
  await page.waitForFunction(() => !window.__vcgeOldPage, null, { timeout: 5000 });
  await page.waitForLoadState('load');
}

// Moves the page's fake clock forward by `ms` and makes sure the time really moved.
// Playwright 1.56's clock keeps running in real time, and a real-time tick that is still finishing when fastForward runs
// winds the clock back to where that tick began, so a whole jump can be lost (seen about 1 time in 15 in a busy page;
// a lost 2-minute jump left the card locked when it should have been wiped). After a short settle it moves on any time lost.
async function fastForward(page, ms) {
  const start = await page.evaluate(() => Date.now());
  let left = ms;
  for (let i = 0; i < 5 && left > 0; i++) {
    await page.clock.fastForward(left);
    await page.waitForTimeout(100);
    left = ms - ((await page.evaluate(() => Date.now())) - start);
  }
}

// Makes the page look hidden (another app in front, screen off) or visible again.
const setVisibility = (page, state) => page.evaluate((state) => {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  Object.defineProperty(document, 'hidden', { value: state === 'hidden', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}, state);

const BROWSER = process.env.VCGE_BROWSER || 'chromium';
const CHANNELS = { chrome: 'chrome', msedge: 'msedge' };
const ENGINE = CHANNELS[BROWSER] ? 'chromium' : BROWSER;
if (!['chromium', 'firefox', 'webkit'].includes(ENGINE)) throw new Error(`unknown VCGE_BROWSER "${BROWSER}"`);
const DEVICE = process.env.VCGE_DEVICE ? playwright.devices[process.env.VCGE_DEVICE] : {};
if (!DEVICE) throw new Error(`unknown VCGE_DEVICE "${process.env.VCGE_DEVICE}"`);
const { defaultBrowserType, ...deviceOptions } = DEVICE;
const RUN = BROWSER + (process.env.VCGE_DEVICE ? ` (${process.env.VCGE_DEVICE})` : '');

let pass = 0, fail = 0, notRun = 0, crashReruns = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log('PASS', n)) : (fail++, console.log('FAIL', n, d)); };
// A check whose test tool exists only in some engines: reported and counted, never silently dropped.
const notRunHere = (n, why) => { notRun++; console.log('NOT RUN', n, `(${why})`); };
// The camera checks hand the app a canvas stream as its camera. An engine build without canvas streams cannot do that,
// so there those checks are reported as not run, with what is missing, instead of failing on a camera that never starts.
const cameraFeedMissing = (page) => page.evaluate(() => [typeof HTMLCanvasElement.prototype.captureStream === 'function' ? '' : 'canvas.captureStream',
  typeof MediaStream === 'function' ? '' : 'MediaStream'].filter(Boolean).join(' and '));

(async () => {
  const server = spawn(process.execPath, [path.join(ROOT, 'scripts/serve.mjs')], { env: { ...process.env, PORT } });
  await new Promise((resolve, reject) => { server.stdout.once('data', resolve); server.once('exit', c => reject(new Error(`server exited ${c}`))); });
  EDITION_PLAIN = FORCE_PLAIN || /<html[^>]*\sdata-edition="plain"/.test(await (await fetch(ORIGIN)).text());
  console.log(`Browser: ${RUN}, ${EDITION_PLAIN ? 'plain' : 'branded'} edition`);
  const browser = await playwright[ENGINE].launch(CHANNELS[BROWSER] ? { channel: CHANNELS[BROWSER] } : {});
  // Every context takes the chosen device (if any), and the welcome pop-up that opens on every start is pressed
  // through (START NOW) at once, except in the welcome tests below.
  const plainContext = browser.newContext.bind(browser);
  const pressStartNow = () => new MutationObserver((_, o) => {
    const b = document.getElementById('welcomeStartBtn');
    if (b) { o.disconnect(); b.click(); }
  }).observe(document, { childList: true, subtree: true });
  // VCGE_EDITION=plain: every load of the app's page gets <html data-edition="plain">, as the plain branch's index.html has
  const editionRoute = (c) => (FORCE_PLAIN ? c.route(u => u.origin + u.pathname === ORIGIN || u.origin + u.pathname === ORIGIN + 'index.html',
    async (route) => { const r = await route.fetch(); await route.fulfill({ response: r, body: (await r.text()).replace('<html lang="en"', '<html lang="en" data-edition="plain"') }); }) : null);
  // The reader's own log lines ([vCGE-MOD04]) are kept on the page, so a read that never ends can say how far it got
  const keepReaderLog = () => ['log', 'error'].forEach(k => { const f = console[k]; console[k] = (...a) => {
    // The reader's own lines, and the error behind "Could not read that image." (an iPhone run, 2026-10-20, ended there
    // with no way to tell which error it was). WebKit's stack leaves the message out, so both are kept (CI run 39702174014).
    if (typeof a[0] === 'string' && (a[0].startsWith('[vCGE-MOD04]') || a[0].startsWith('[vCGE] OCR failed'))) (window.__readerLog = window.__readerLog || []).push(`${Math.round(performance.now())} ms ${a[0].slice(0, 160)}${a[1] ? ` ${String(a[1] && [a[1].message, a[1].stack].filter(Boolean).join(' | ') || a[1]).slice(0, 400)}` : ''}`);
    return f.apply(console, a); }; });
  browser.newContext = async (opts = {}) => { const c = await plainContext({ ...deviceOptions, ...opts }); await c.addInitScript(pressStartNow); await c.addInitScript(keepReaderLog); await editionRoute(c);
    c.on('page', p => p.once('crash', () => { pageCrashed = true; })); opened.push(c); return c; };
  const newContext = (options) => browser.newContext(options);
  // raven575, 2026-10-22: Playwright's WebKit sometimes loses a whole page process while it reads a card ("Target
  // crashed", the F4 block on 2026-10-21); no code in the page can catch that. A block that reads cards then runs once
  // more on fresh pages, said in the log and counted in the summary. A FAIL from the crashed try still counts; a second
  // crash, any other engine, or any other error fails the run as before.
  let pageCrashed = false;
  const opened = [];
  const rerunIfPageCrashed = async (name, block) => {
    const mark = { pass, notRun, opened: opened.length };
    pageCrashed = false;
    try { await block(); }
    catch (e) {
      if (ENGINE !== 'webkit' || !pageCrashed) throw e;
      crashReruns++;
      console.log(`PAGE CRASHED in "${name}": WebKit's page process died (${String(e.message).split('\n')[0]}); running the block once more on fresh pages`);
      await Promise.all(opened.splice(mark.opened).map(c => c.close().catch(() => {})));
      pass = mark.pass; notRun = mark.notRun;
      pageCrashed = false;
      await block();
    }
  };
  const context = await newContext({ acceptDownloads: true });
  const page = await context.newPage();
  const external = [], errors = [], notFound = [];
  page.on('request', r => { if (!r.url().startsWith(ORIGIN) && !/^(data|blob):/.test(r.url())) external.push(r.url()); });
  page.on('response', r => { if (r.status() >= 400) notFound.push(`${r.status()} ${r.url()}`); });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('dialog', d => d.accept());
  // The plain edition fetches none of the branded files: logo, Sixtyfour, the animal logos. The tab and home-screen icons
  // are the page's own <link> icons (plain ones on the plain branch), which a browser may fetch at any size (Firefox: 192)
  const brandRequests = [];
  page.on('request', r => { if (/\/assets\/brand\/|sixtyfour|\/icons\/animals\//.test(r.url())) brandRequests.push(r.url()); });
  const brandFetches = async () => { const icons = await page.$$eval('link[rel~="icon"], link[rel="apple-touch-icon"]', ls => ls.map(l => l.href)); return brandRequests.filter(u => !icons.includes(u)); };
  const base = ORIGIN;
  const val = id => page.$eval('#' + id, el => el.value);
  const text = id => page.$eval('#' + id, el => el.textContent.trim());
  const visible = id => page.isVisible('#' + id);
  const storage = () => page.evaluate(() => JSON.stringify(localStorage));

  await page.goto(base); await page.waitForTimeout(500);
  ok('loads with no 404s', notFound.length === 0, notFound.join(', '));
  const favicon = await page.evaluate(() => { const l = document.querySelector('link[rel="icon"][sizes="32x32"]'); return l ? l.href : null; });
  ok('the tab icon is a bundled file on the same origin', !!favicon && favicon.startsWith(base) && (await page.request.get(favicon)).status() === 200 && (await page.request.get(favicon)).headers()['content-type'].includes('image/png'), favicon);
  // On a phone the header's brand is hidden by design (deck.css); wider, the logo shows
  if (!EDITION_PLAIN) ok('the header shows the logo (bundled, loaded, named vCGE for screen readers; hidden on a phone)', await logoMarkShown(page, '.deck-logo')
    && await page.$eval('.deck-logo', el => (innerWidth < 600 ? el.getBoundingClientRect().width === 0 : el.getBoundingClientRect().width > 0)));
  else ok('plain edition: the header shows no logo and never fetched one, and "vCard Generator Engine" stays as text', await logoMarkGone(page, '.deck-logo')
    && !(await brandFetches()).length && (await page.textContent('.deck-brand-text')).trim() === 'vCard Generator Engine', (await brandFetches()).join(' '));
  if (EDITION_PLAIN && FORCE_PLAIN) notRunHere('plain edition: every tab and home-screen icon is the plain icon', 'VCGE_EDITION=plain runs the working branch, whose icons are the branded ones; the plain branch swaps them');
  else if (EDITION_PLAIN) {
    // The plain icon is a white contact card on slate: the card's top edge, the head, slate above and inside the card.
    // The branded logo matches none of the four spots, so a branded icon slipping into plain fails here.
    const icons = await page.$$eval('link[rel~="icon"], link[rel="apple-touch-icon"]', ls => ls.map(l => l.href));
    const plainIcon = await Promise.all(icons.map(href => page.evaluate(async (href) => {
      const i = new Image(); i.src = href; await i.decode().catch(() => {}); if (!i.naturalWidth) return false;
      const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); x.drawImage(i, 0, 0, 64, 64);
      const at = (u, v) => Array.from(x.getImageData(Math.floor(u * 64), Math.floor(v * 64), 1, 1).data);
      const light = q => q[0] > 150 && q[1] > 150 && q[2] > 150, slate = q => Math.abs(q[0] - 51) < 20 && Math.abs(q[1] - 65) < 20 && Math.abs(q[2] - 85) < 20;
      return light(at(0.5, 0.29)) && light(at(0.35, 0.44)) && slate(at(0.5, 0.5)) && slate(at(0.5, 0.12));
    }, href)));
    ok('plain edition: every tab and home-screen icon is the plain icon', icons.length === 3 && plainIcon.every(Boolean), JSON.stringify(icons.map((h, i) => [h, plainIcon[i]])));
  }
  if (EDITION_PLAIN) {
    const navNames = await page.$$eval('.deck-header button', bs => bs.map(b => [b.id, b.getAttribute('aria-label') || '', b.title || '', (b.querySelector(':scope > span') || {}).textContent || '']));
    ok('plain edition: the header names each card, never a pilot, in its labels and beside its icon', navNames.every(n => !/Shutout|Ghost|Iris|Glyph|Pidge|Flipside|Checkers|Airlock/.test(n.join(' ')))
      && navNames.filter(n => n[3]).map(n => n[3]).join('|') === 'Start|Capture|Read|Fields|Card|QR|Share', JSON.stringify(navNames));
    ok('plain edition: nothing on screen names a pilot, a MOD tag or the tagline', !/Shutout|Ghost|Iris|Glyph|Pidge|Flipside|Checkers|Airlock|Cornerstone|MOD-0|Never Lose Contact|Team vCGE/.test(await page.evaluate(() => document.body.innerText)));
  }
  // Shutout's touches (shellArt.js): the turtle under the lit icon, the shell plates, the sheets' grab bar and pebble
  const shellArt = () => page.evaluate(() => {
    const t = document.getElementById('deckTurtle'), on = document.querySelector('.deck-nav button.is-on');
    const tr = t.getBoundingClientRect(), br = on.getBoundingClientRect(), hr = document.querySelector('.deck-header').getBoundingClientRect();
    return { shown: getComputedStyle(t).display !== 'none' && getComputedStyle(t).visibility === 'visible', off: Math.abs((tr.left + tr.width / 2) - (br.left + br.width / 2)),
      onEdge: tr.top < hr.bottom && tr.bottom > hr.bottom, walk: getComputedStyle(t).transitionDuration,
      plates: Array.from(document.querySelectorAll('#deckPlates [data-card]')).map(p => p.dataset.state || '').join(),
      platesShown: getComputedStyle(document.getElementById('deckPlates')).display !== 'none', hidden: t.getAttribute('aria-hidden') + document.getElementById('deckPlates').getAttribute('aria-hidden') };
  });
  if (EDITION_PLAIN) {
    const a0 = await shellArt();
    ok('plain edition: no turtle and no shell plates', !a0.shown && !a0.platesShown, JSON.stringify(a0));
  } else {
    // The page opens on the Capture card: Shutout walks to Start and back (not Fields: its form pops in once, later)
    await page.waitForFunction(() => document.getElementById('deckTurtle').classList.contains('is-placed'), null, { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(300);
    const a0 = await shellArt();
    ok('shell art: the turtle stands on the header\'s edge under the lit icon, and only that card\'s plate is current', a0.shown && a0.off <= 2 && a0.onEdge && a0.platesShown
      && a0.plates === 'new,current,new,new,new,new' && a0.hidden === 'truetrue', JSON.stringify(a0));
    await page.click('#navWelcome'); await page.waitForTimeout(900);
    const a1 = await shellArt();
    ok('shell art: the turtle walks (0.4 s) to the Start icon; Capture is now a visited plate, Start the current one', a1.shown && a1.off <= 2 && a1.walk === '0.4s'
      && a1.plates === 'current,visited,new,new,new,new', JSON.stringify(a1));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.click('#navCapture'); await page.waitForTimeout(600);
    const a2 = await shellArt();
    ok('shell art: under reduced motion the turtle does not walk, it is simply under the new icon', a2.shown && a2.off <= 2 && a2.walk === '0s'
      && a2.plates === 'visited,current,new,new,new,new', JSON.stringify(a2));
    await page.emulateMedia({ reducedMotion: null });
  }
  await page.click('#navSettings'); await page.waitForSelector('#settingsSheet', { state: 'visible' });
  const sheetArt = await page.evaluate(() => {
    const panel = document.querySelector('#settingsSheet .vcge-sheet-panel'), bar = getComputedStyle(panel, '::before'), x = getComputedStyle(document.querySelector('#settingsSheet .vcge-sheet-close'));
    return { bar: bar.content !== 'none' && bar.content !== '' && parseFloat(bar.width) > 0, radius: getComputedStyle(panel).borderTopLeftRadius, pebble: x.backgroundColor !== 'rgba(0, 0, 0, 0)' && parseFloat(x.borderRadius) >= 22 };
  });
  ok(EDITION_PLAIN ? 'plain edition: sheets keep the plain frame (no grab bar, no pebble)' : 'shell art: a sheet has a rounder top with a grab bar, and its close button is a round pebble',
    EDITION_PLAIN ? !sheetArt.bar && sheetArt.radius === '20px' && !sheetArt.pebble : sheetArt.bar && sheetArt.radius === '28px' && sheetArt.pebble, JSON.stringify(sheetArt));
  await page.keyboard.press('Escape'); await page.waitForSelector('#settingsSheet', { state: 'hidden' });
  ok('opens straight to an empty card (no passphrase dialog)', !(await visible('vaultModal')) && (await val('firstName')) === '');
  ok('header badge reads "Vault: UNLOCKED" and the indicator says memory only', (await text('vaultBadge')) === 'Vault: UNLOCKED' && (await text('vaultStateIndicator')) === 'UNLOCKED / memory only');
  ok('Lock button hidden until a session PIN is set', !(await lockOffered(page)));
  ok('timer strip hidden while the card is empty', !(await visible('vaultTimerStrip')));
  const secretBoxes = await page.$$eval('#vaultPin, #sessionPinInput',
    els => els.map(el => ({ type: el.type, masked: getComputedStyle(el).webkitTextSecurity, ac: el.getAttribute('autocomplete'), caps: el.getAttribute('autocapitalize') })));
  ok('PIN boxes are masked text fields, not password fields (no save-password prompt)', secretBoxes.length === 2 && secretBoxes.every(b => b.type === 'text' && b.masked === 'disc'), JSON.stringify(secretBoxes));
  ok('PIN boxes opt out of autofill and keyboard capitalisation', secretBoxes.every(b => b.ac === 'off' && b.caps === 'none'));
  ok('PIN boxes take 4 digits on a number keypad', (await page.$$eval('#vaultPin, #sessionPinInput', els => els.every(el => el.inputMode === 'numeric' && el.maxLength === 4))));
  ok('no password field anywhere on the page', (await page.$$('input[type=password]')).length === 0);
  ok('empty card shows the blank QR placeholder, not a scannable code', (await decodeQr(page)) === null && !(await visible('qrNotice')));

  // Edit contact -> preview (nothing saved)
  await page.fill('#firstName', 'Jane'); await page.fill('#lastName', 'Doe'); await page.fill('#organization', 'Smith, Jones');
  await page.waitForTimeout(800);
  ok('preview updates from form', (await text('previewFullName')) === 'Jane Doe' && (await text('previewOrg')) === 'Smith, Jones');
  const st = await storage();
  ok('nothing saved to browser storage (no vault, no card)', !st.includes('vCGE_secure_vault') && !st.includes('Jane') && !st.includes('Smith'), st.slice(0, 200));
  ok('QR rendered with bundled library (no notice)', !(await visible('qrNotice')));
  const qrText = await decodeQr(page);
  ok('on-screen QR decodes to the current vCard', qrText && qrText.includes('FN:Jane Doe\r\n') && qrText.includes('ORG:Smith\\, Jones'), qrText);
  // Step 9 (Checkers): the code is tinted to the card's theme, never pure black on pure white, and floats on a deeper shadow.
  const tint = await page.evaluate(() => {
    const c = document.getElementById('qrCanvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const seen = new Set(); for (let i = 0; i < d.length; i += 4) seen.add(`${d[i]},${d[i + 1]},${d[i + 2]}`);
    return { colours: [...seen], shadow: [...c.classList].filter(k => k.startsWith('shadow-')) };
  });
  ok('on-screen QR is tinted to the theme (two colours, neither pure black nor pure white)', tint.colours.length === 2 && !tint.colours.includes('0,0,0') && !tint.colours.includes('255,255,255'), JSON.stringify(tint.colours));
  ok('QR canvas carries the deeper drop shadow', tint.shadow.includes('shadow-xl'), JSON.stringify(tint.shadow));

  // vCard download through MOD08
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#downloadVcfBtn')]);
  const vcf = fs.readFileSync(await dl.path(), 'utf8');
  ok('.vcf downloaded with escaped ORG and CRLF', vcf.includes('ORG:Smith\\, Jones') && vcf.includes('\r\nFN:Jane Doe\r\n'), JSON.stringify(vcf.slice(0, 120)));
  ok('download filename: the full name, with its space (step 10)', dl.suggestedFilename() === 'Jane Doe.vcf', dl.suggestedFilename());

  // Richer contact fields: name parts, typed rows, unit, country-driven region picker -> preview, vCard, QR
  ok('prefix/suffix/unit suggestion lists filled', (await page.$$eval('#namePrefixOptions option', o => o.map(x => x.value))).includes('Dr.') && (await page.$$eval('#nameSuffixOptions option', o => o.length)) === 10 && (await page.$$eval('#unitTypeOptions option', o => o.map(x => x.value))).includes('Suite'));
  ok('US state picker shown with 56 states and territories', await visible('stateSelect') && !(await visible('stateText')) && (await page.$$eval('#stateSelect option', o => o.length)) === 57 && (await text('stateLabel')) === 'State');
  await page.fill('#namePrefix', 'Dr.'); await page.fill('#middleName', 'Q.'); await page.fill('#nameSuffix', 'PhD');
  await page.selectOption('#phoneType0', 'mobile'); await page.fill('#phoneValue0', '4155550101'); await page.press('#phoneValue0', 'Tab');
  ok('phone number formatted on leaving the box', (await val('phoneValue0')) === '+1 (415) 555-0101', await val('phoneValue0'));
  await page.click('#addPhoneBtn');
  ok('+ Add phone adds a row with the next unused type', (await page.$$('#phoneList > div')).length === 2 && (await val('phoneType1')) === 'work', await val('phoneType1'));
  await page.selectOption('#phoneType1', 'workFax'); await page.fill('#phoneValue1', '4155550109');
  await page.click('#addPhoneBtn'); await page.fill('#phoneValue2', '4155550199');
  await page.click('#phoneRemove2');
  ok('remove deletes just that row', (await rows(page, 'phone')).length === 2 && (await rows(page, 'phone'))[1].type === 'workFax');
  await page.fill('#emailValue0', 'jane@smithjones.co'); await page.click('#addEmailBtn'); await page.selectOption('#emailType1', 'personal'); await page.fill('#emailValue1', 'jane.doe@gmail.com');
  await page.fill('#websiteValue0', 'https://smithjones.co'); await page.click('#addWebsiteBtn'); await page.fill('#websiteValue1', 'https://www.linkedin.com/in/janedoe'); await page.press('#websiteValue1', 'Tab');
  ok('social link recognised: website type switches to LinkedIn', (await val('websiteType1')) === 'linkedin', await val('websiteType1'));
  await page.fill('#street', '233 South Wacker Drive'); await page.fill('#unitType', 'Suite'); await page.fill('#unitNumber', '4100'); await page.fill('#city', 'Chicago');
  await page.selectOption('#stateSelect', 'IL'); await page.fill('#zip', '60606'); await page.selectOption('#addressType', 'work');
  ok('state picker sets the stored state', (await val('state')) === 'IL');
  await page.waitForTimeout(700);
  ok('preview shows full name with prefix/suffix and the unit', (await text('previewFullName')) === 'Dr. Jane Q. Doe, PhD' && (await text('previewAddress')).includes('Suite 4100'), (await text('previewFullName')) + ' | ' + (await text('previewAddress')));
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#downloadVcfBtn')]);
  const vcf2raw = fs.readFileSync(await dl2.path(), 'utf8');
  ok('.vcf lines are folded at 75 octets and the file ends with CRLF (RFC 2425)', vcf2raw.split('\r\n').every(l => Buffer.byteLength(l) <= 75) && vcf2raw.includes('\r\n ') && vcf2raw.endsWith('END:VCARD\r\n'), JSON.stringify(vcf2raw.slice(-40)));
  const vcf2 = vcf2raw.replace(/\r\n[ \t]/g, '').split('\r\n');
  ok('.vcf has name parts, typed phones and emails', vcf2.includes('N:Doe;Jane;Q.;Dr.;PhD') && vcf2.includes('TEL;TYPE=CELL,VOICE:+1 (415) 555-0101') && vcf2.includes('TEL;TYPE=WORK,FAX:+1 (415) 555-0109')
    && vcf2.includes('EMAIL;TYPE=INTERNET,WORK:jane@smithjones.co') && vcf2.includes('EMAIL;TYPE=INTERNET,HOME:jane.doe@gmail.com'), vcf2.join(' | '));
  ok('.vcf has social profile and unit address', vcf2.includes('X-SOCIALPROFILE;TYPE=linkedin:https://www.linkedin.com/in/janedoe') && vcf2.includes('ADR;TYPE=WORK:;;233 South Wacker Drive\\, Suite 4100;Chicago;IL;60606;United States'), vcf2.filter(l => /^(X-SOCIAL|ADR)/.test(l)).join(' | '));
  const qrRich = await decodeQr(page);
  ok('QR carries the richer vCard', qrRich && qrRich.includes('N:Doe;Jane;Q.;Dr.;PhD') && qrRich.includes('X-SOCIALPROFILE;TYPE=linkedin'), qrRich && qrRich.slice(0, 120));
  await page.selectOption('#country', 'Canada');
  ok('Canada: province picker and postal-code label; US state cleared', (await text('stateLabel')) === 'Province / territory' && (await text('zipLabel')) === 'Postal code' && (await page.$$eval('#stateSelect option', o => o.length)) === 14 && (await val('state')) === '');
  await page.selectOption('#country', 'Germany'); await page.fill('#stateText', 'Berlin');
  ok('other countries: free-text region box', await visible('stateText') && !(await visible('stateSelect')) && (await text('stateLabel')) === 'Region' && (await val('state')) === 'Berlin');
  await page.selectOption('#country', 'United States'); await page.selectOption('#stateSelect', 'IL');
  await page.waitForTimeout(700);
  ok('audit log records MOD08 egress', (await text('auditLog')).includes('MOD08 egress: download_vcf'));

  // Local address suggestions
  await page.fill('#street', 'Howard'); await page.waitForTimeout(200);
  ok('local address suggestions appear', await visible('addressAutocompleteList') && (await text('addressAutocompleteList')).includes('500 Howard Street'));
  await page.click('#addressAutocompleteList button'); await page.waitForTimeout(100);
  ok('choosing a suggestion fills city/zip', (await val('city')) === 'San Francisco' && (await val('zip')) === '94105');

  // OCR flow: bundled Tesseract.js reads a rendered card offline (through MOD01's worker network lock)
  // Bus payloads are signals only (source tree only: in the build the bus is bundled and cannot be imported from here)
  if (!process.env.SERVE_DIR) await page.evaluate(async () => {
    const { globalEventBus, Events } = await import('/src/share/eventBus.js');
    window.__busSeen = [];
    [Events.IMAGE_CAPTURED, Events.OCR_TEXT_EXTRACTED].forEach(ev => globalEventBus.subscribe(ev, d => window.__busSeen.push(JSON.stringify(d))));
  });
  await page.setInputFiles('#imageUpload', await renderCardImage(page)); await page.waitForTimeout(300);
  ok('upload opens the crop step on the Capture card', await visible('captureReview') && (await page.evaluate(() => document.documentElement.dataset.card)) === 'capture' && !(await visible('cropReviewModal')));
  await page.evaluate(() => {
    window.__ocrBar = { shown: false, shimmer: false, photo: false, values: [], labels: [] };
    const bar = document.getElementById('ocrProgressBar'), box = document.getElementById('ocrProgress'), label = document.getElementById('ocrProgressLabel'), photo = document.getElementById('ocrReadPhoto');
    new MutationObserver(() => {
      if (!box.classList.contains('hidden')) window.__ocrBar.shown = true;
      if (bar.classList.contains('is-reading') && getComputedStyle(bar.querySelector('.read-shimmer')).animationName === 'read-shimmer') window.__ocrBar.shimmer = true;
      if ((photo.getAttribute('src') || '').startsWith('data:image')) window.__ocrBar.photo = true;
      window.__ocrBar.values.push(Number(bar.getAttribute('aria-valuenow'))); window.__ocrBar.labels.push(label.textContent);
    }).observe(box, { attributes: true, subtree: true, childList: true, characterData: true });
  });
  await page.click('#runOcrBtn');
  await readEnds(page);
  const bar = await page.evaluate(() => window.__ocrBar);
  ok('OK moves to the Read card, where the photo shimmers while it is read, the label says the reader is being prepared, and the wash is full before the review opens', bar.shown && bar.shimmer && bar.photo && bar.values.includes(100) && bar.labels.includes('Preparing the reader…') && !(await visible('ocrProgress')) && (await visible('ocrStepText')) && (await page.evaluate(() => document.documentElement.dataset.card)) === 'read', JSON.stringify({ shown: bar.shown, shimmer: bar.shimmer, photo: bar.photo, max: Math.max(...bar.values), labels: [...new Set(bar.labels)] }));
  ok('the reading indicator shows no number (no visible digits, screen readers hear text)', !/\d/.test(await page.$eval('#ocrProgress', el => el.innerText)) && (await page.getAttribute('#ocrProgressBar', 'aria-valuetext')) === 'Reading the card', await page.$eval('#ocrProgress', el => el.innerText));
  ok('after the read the photo under the shimmer is dropped', !(await page.getAttribute('#ocrReadPhoto', 'src')));
  ok('first scan says the reader is being prepared, then extracting', bar.labels.indexOf('Preparing the reader…') >= 0 && bar.labels.indexOf('Extracting…', bar.labels.indexOf('Preparing the reader…')) > 0, [...new Set(bar.labels)].join(' | '));
  ok('review step lists the OCR lines with a field picker each', (await page.$$('#ocrLines select')).length >= 8 && (await page.inputValue('#ocrLineRole0')) === 'name', String((await page.$$('#ocrLines select')).length));
  ok('nothing reaches the form before Fill form', !(await rows(page, 'email')).some(r => r.value.includes('northwind')));
  ok('"Will fill" summary shows the mapped fields', (await text('ocrSummary')).includes('maria.gonzalez@northwind.com') && (await text('ocrSummary')).includes('Northwind Systems'));
  const readGap = await page.evaluate(() => {
    const label = document.querySelector('#cardRead > .deck-card-body > h2').getBoundingClientRect();
    const head = document.querySelector('#ocrStepText > h2').getBoundingClientRect();
    return Math.round(head.top - label.bottom);
  });
  ok('the review heading sits close under the "Read the card" label', readGap >= 0 && readGap <= 8, String(readGap));
  ok('the review reminds that more fields can be added on the next card', (await visible('ocrMoreFields')) && /more fields on the next card/.test(await text('ocrMoreFields')), await text('ocrMoreFields'));
  await page.evaluate(() => {
    window.__blink = { opacities: [], cardAtClear: null };
    const step = document.getElementById('ocrStepText');
    new MutationObserver(() => { window.__blink.opacities.push(step.style.opacity); if (step.classList.contains('hidden') && window.__blink.cardAtClear === null) window.__blink.cardAtClear = document.documentElement.dataset.card; })
      .observe(step, { attributes: true, attributeFilter: ['style', 'class'] });
  });
  await proceed(page);
  const blink = await page.evaluate(() => window.__blink);
  ok('Proceed: the review text blinks out (opacity steps down to 0) before the deck moves to Fields, then it is cleared', blink.opacities.some(o => o !== '' && Number(o) < 1) && blink.opacities.includes('0') && blink.cardAtClear === 'fields' && (await page.evaluate(() => document.documentElement.dataset.card)) === 'fields', JSON.stringify(blink));
  const got = {}; for (const f of ['firstName', 'lastName', 'jobTitle', 'organization', 'street', 'city', 'state', 'zip']) got[f] = await val(f);
  got.phoneWork = await rowValue(page, 'phone', 'work'); got.email = await rowValue(page, 'email', 'work'); got.website = await rowValue(page, 'website', 'work');
  ok('real OCR extracts name, title, organization', got.firstName === 'Maria' && got.lastName === 'Gonzalez' && got.jobTitle === 'Director of Engineering' && got.organization === 'Northwind Systems', JSON.stringify(got));
  ok('real OCR extracts phone, email, website', got.phoneWork === '+1 (312) 555-0147' && got.email === 'maria.gonzalez@northwind.com' && got.website === 'https://northwind.com', JSON.stringify(got));
  ok('real OCR extracts street, city, state, zip', got.street === '233 South Wacker Drive' && got.city === 'Chicago' && got.state === 'IL' && got.zip === '60606', JSON.stringify(got));
  ok('user told the form was filled', (await text('toastMessage')).includes('Form filled'));
  ok('Fields card: the form popped in once on the hand-off (all boxes together, after the text was in them)', (await page.getAttribute('#fieldsForm', 'data-pops')) === '1', await page.getAttribute('#fieldsForm', 'data-pops'));
  if (!process.env.SERVE_DIR) {
    const seen = await page.evaluate(() => window.__busSeen);
    ok('bus carries no photo or OCR text, only signals', seen.length === 2 && !seen.some(d => /data:image|Gonzalez|northwind/i.test(d)), seen.join(' | ').slice(0, 300));
  }
  ok('audit log records OCR (not simulated)', (await text('auditLog')).includes('OCR text extracted') && !(await text('auditLog')).includes('simulated'));
  const qrAfter = await decodeQr(page);
  ok('QR follows OCR result', qrAfter && qrAfter.includes('FN:Maria Gonzalez\r\n') && qrAfter.includes('N:Gonzalez;Maria;;;\r\n'), qrAfter);
  ok('scanned name and address replace the previous ones whole (no leftover prefix, suite)', (await val('namePrefix')) === '' && (await val('nameSuffix')) === '' && (await val('middleName')) === '' && (await val('unitNumber')) === '', [await val('namePrefix'), await val('unitNumber')].join('|'));

  // Gatekeeper
  const blocked = await page.evaluate(() => fetch('https://example.com/x').then(() => 'ALLOWED', () => 'blocked'));
  await page.waitForTimeout(100);
  ok('gatekeeper blocks external fetch and logs it', blocked === 'blocked' && (await text('auditLog')).includes('Blocked fetch'));

  const other = await page.evaluate(() => {
    const r = {};
    try { const x = new XMLHttpRequest(); x.open('GET', 'https://example.com/'); r.xhr = 'ALLOWED'; } catch (e) { r.xhr = 'blocked'; }
    try { new WebSocket('wss://example.com'); r.ws = 'ALLOWED'; } catch (e) { r.ws = 'blocked'; }
    try { new EventSource('https://example.com/s'); r.es = 'ALLOWED'; } catch (e) { r.es = 'blocked'; }
    r.beacon = navigator.sendBeacon('https://example.com/b', 'x') ? 'ALLOWED' : 'blocked';
    return r;
  });
  ok('gatekeeper blocks XHR, WebSocket, EventSource, sendBeacon', Object.values(other).every(v => v === 'blocked'), JSON.stringify(other));
  const sameOrigin = await page.evaluate(() => fetch('/index.html').then(r => r.status, () => 'blocked'));
  ok('same-origin fetch still allowed', sameOrigin === 200, String(sameOrigin));
  await page.evaluate(() => fetch('https://example.com/secret-path?name=Maria').catch(() => {})); await page.waitForTimeout(100);
  const log = await text('auditLog');
  ok('audit log names only the blocked host, never the path or query', log.includes('https://example.com') && !log.includes('secret-path') && !log.includes('Maria'), log.slice(0, 200));
  ok('event bus is not exposed on window', await page.evaluate(() => typeof window.vCGE === 'undefined'));
  ok('network lock is the first script and installed', await page.evaluate(() => document.scripts[0].src.endsWith('/src/modules/mod01-shell/netLock.js') && !!fetch[Symbol.for('vcge.netLock')]));
  const guardRefuses = await page.evaluate(() => new Promise(resolve => {
    const w = new Worker(`src/modules/mod01-shell/workerGuard.js#${encodeURIComponent('https://example.com/evil.js')}`);
    w.onerror = (e) => { e.preventDefault(); w.terminate(); resolve('refused'); };
    setTimeout(() => { w.terminate(); resolve('loaded'); }, 2000);
  }));
  ok('OCR worker lock refuses a script from another host', guardRefuses === 'refused', guardRefuses);

  // Flip, and the Settings sheet (MOD01 step 4): hand, colour-blind mode, theme and font, saved as one small entry
  await page.click('#flipCardBtn'); await settled(page);
  ok('card flips', (await page.$eval('#card3DFlipper', el => el.style.transform)) === 'rotateY(180deg)');
  const settingsKeys = () => page.evaluate(() => Object.keys(localStorage));
  const htmlState = () => page.evaluate(() => ({ hand: document.documentElement.dataset.hand, cb: document.documentElement.dataset.cb, font: document.documentElement.dataset.font,
    dark: document.documentElement.classList.contains('dark'), body: getComputedStyle(document.body).fontFamily, entry: localStorage.getItem('vcge_settings') }));
  ok('before any change: nothing is stored, right hand, Inter, dark', (await settingsKeys()).length === 0 && (await htmlState()).hand === 'right' && (await htmlState()).dark && /Inter/.test((await htmlState()).body), JSON.stringify(await htmlState()));
  await page.click('#navSettings');
  ok('the cog opens Settings: hand, colour-blind switch, theme, font, language "coming later", PIN button and the disclaimer', await page.isVisible('#settingsSheet') && await page.isVisible('#handRightBtn') && await page.isVisible('#cbToggle') && await page.isVisible('#themeToggle')
    && await page.isVisible('#fontSelect') && /coming later/.test(await page.textContent('#settingsSheet')) && await page.isVisible('#settingsVaultBtn')
    && (await text('settingsNote')) === 'vCGE keeps one small settings file on this device (hand, colors, theme, font, text size, wipe time). Nothing you scan, upload or type is ever saved.');
  ok('the font list is the seven fonts, alphabetical, Inter chosen', (await page.$$eval('#fontSelect option', os => os.map(o => o.textContent).join('|'))) === 'Atkinson Hyperlegible|Comic Neue|Inter|Lexend|Macondo|OpenDyslexic|Tinos'
    && (await page.$eval('#fontSelect', s => s.selectedOptions[0].textContent)) === 'Inter');
  ok('every settings control is at least 44 px tall', (await page.$$eval('#handRightBtn, #handLeftBtn, #cbToggle, #themeToggle, #fontSelect, #sizeSelect, #wipeSelect', els => els.map(e => e.getBoundingClientRect().height))).every(h => h >= 44));
  await page.click('#themeToggle');
  ok('theme toggles to light and the entry appears, one key, name=number pairs', !(await htmlState()).dark && (await settingsKeys()).join() === 'vcge_settings' && (await htmlState()).entry === 'hand=0;cb=0;theme=1;font=0;size=0;wipe=0');
  await page.click('#handLeftBtn');
  const headerOrder = () => page.evaluate(() => ['navSettings', 'navVault', 'navCapture', 'navShare'].map(id => document.getElementById(id).getBoundingClientRect().left));
  const [xSettings, xVault, xCapture, xShare] = await headerOrder();
  const trashSide = () => page.evaluate(() => { const c = document.querySelector('.deck-card.is-current'), t = c.querySelector('.vcge-trash').getBoundingClientRect(), r = c.getBoundingClientRect(); return t.left + t.width / 2 > r.left + r.width / 2 ? 'right' : 'left'; });
  ok('Left hand mirrors the header (Settings far left, Vault beside it, Airlock before Iris) and moves the trash button to the lower right',
    (await htmlState()).hand === 'left' && xSettings < xVault && xVault < xShare && xShare < xCapture && (await trashSide()) === 'right' && (await htmlState()).entry === 'hand=1;cb=0;theme=1;font=0;size=0;wipe=0', JSON.stringify([xSettings, xVault, xShare, xCapture, await trashSide()]));
  await page.click('#handRightBtn');
  const [rSettings, rVault, rCapture] = await headerOrder();
  ok('Right hand puts it back: Iris first, Vault then Settings at the far right, trash lower left', rCapture < rVault && rVault < rSettings && (await trashSide()) === 'left' && (await htmlState()).hand === 'right');
  await page.check('#cbToggle');
  ok('colour-blind mode sets html[data-cb="1"] (MOD02 reads it) and the lit icon shows a white bar under it', (await htmlState()).cb === '1' && (await htmlState()).entry === 'hand=0;cb=1;theme=1;font=0;size=0;wipe=0'
    && /inset/.test(await page.$eval('.deck-nav button.is-on', b => getComputedStyle(b).boxShadow)));
  await page.selectOption('#fontSelect', { label: 'Lexend' });
  ok('the UI font follows the drop-down (Lexend) and its fixed code is saved', /Lexend/.test((await htmlState()).body) && (await htmlState()).entry === 'hand=0;cb=1;theme=1;font=2;size=0;wipe=0');
  // Settings polish from raven575's iPad video: the cog by the title (#13) and a text size that leaves the header alone (#6)
  ok('Settings shows the cog left of its title', (await page.$eval('#settingsTitle use', u => u.getAttribute('href'))).endsWith('#settings')
    && await page.$eval('#settingsTitle', h => h.firstElementChild.tagName.toLowerCase() === 'svg'));
  ok('the text size list is Small, Normal, Large, Larger, Normal chosen', (await page.$$eval('#sizeSelect option', os => os.map(o => o.textContent).join('|'))) === 'Small|Normal|Large|Larger'
    && (await page.$eval('#sizeSelect', s => s.selectedOptions[0].textContent)) === 'Normal');
  const sizes = () => page.evaluate(() => { const r = e => e.getBoundingClientRect();
    return { root: parseFloat(getComputedStyle(document.documentElement).fontSize), note: parseFloat(getComputedStyle(document.getElementById('settingsNote')).fontSize),
      header: r(document.querySelector('.deck-header')).height, icon: r(document.querySelector('#navSettings .vcge-icon')).width }; });
  const sizeNormal = await sizes();
  await page.selectOption('#sizeSelect', { label: 'Larger' }); await page.waitForTimeout(200);
  const sizeLarger = await sizes();
  ok('Larger: the text grows by a quarter, the header and its icons keep their size, and its code is saved', Math.abs(sizeLarger.root / sizeNormal.root - 1.25) < 0.01 && Math.abs(sizeLarger.note / sizeNormal.note - 1.25) < 0.03
    && Math.abs(sizeLarger.header - sizeNormal.header) < 0.6 && Math.abs(sizeLarger.icon - sizeNormal.icon) < 0.6 && (await htmlState()).entry === 'hand=0;cb=1;theme=1;font=2;size=2;wipe=0', JSON.stringify([sizeNormal, sizeLarger]));
  await page.selectOption('#sizeSelect', { label: 'Normal' }); await page.waitForTimeout(200);
  ok('Normal puts the text back', (await sizes()).root === sizeNormal.root && (await htmlState()).entry === 'hand=0;cb=1;theme=1;font=2;size=0;wipe=0');
  // Wipe after the lock (raven575, 2026-10-18, #68): 7 (default), 10 or 15 minutes, on html for MOD02; the 2-minute lock stays
  ok('the wipe list is 7, 10, 15 minutes, 7 chosen, and html says 7', (await page.$$eval('#wipeSelect option', os => os.map(o => o.textContent).join('|'))) === '7 minutes|10 minutes|15 minutes'
    && (await page.$eval('#wipeSelect', s => s.selectedOptions[0].textContent)) === '7 minutes' && (await page.evaluate(() => document.documentElement.dataset.wipe)) === '7');
  await page.selectOption('#wipeSelect', { label: '15 minutes' });
  ok('15 minutes: html[data-wipe="15"] and its code 2 is saved', (await page.evaluate(() => document.documentElement.dataset.wipe)) === '15' && (await htmlState()).entry === 'hand=0;cb=1;theme=1;font=2;size=0;wipe=2');
  await page.selectOption('#wipeSelect', { label: '7 minutes' });
  ok('back to 7 minutes', (await page.evaluate(() => document.documentElement.dataset.wipe)) === '7' && (await htmlState()).entry === 'hand=0;cb=1;theme=1;font=2;size=0;wipe=0');
  await page.click('#settingsSheet [data-sheet-close]');
  // A fresh start in the same browser (a second tab) comes back with the saved choices; the scan in this tab is untouched
  const pS = await context.newPage();
  await pS.goto(base); await pS.waitForTimeout(600);
  const after = await pS.evaluate(() => ({ hand: document.documentElement.dataset.hand, cb: document.documentElement.dataset.cb, dark: document.documentElement.classList.contains('dark'),
    body: getComputedStyle(document.body).fontFamily, entry: localStorage.getItem('vcge_settings'), keys: Object.keys(localStorage).join() }));
  ok('next start: light theme, colour-blind mode and Lexend come back from the one entry; still exactly one key', !after.dark && after.cb === '1' && /Lexend/.test(after.body) && after.hand === 'right' && after.keys === 'vcge_settings', JSON.stringify(after));
  ok('the entry holds six numbers and no text', /^hand=\d;cb=\d;theme=\d;font=\d;size=\d;wipe=\d$/.test(after.entry), after.entry);
  await pS.click('#navSettings');
  ok('the sheet shows the saved choices', await pS.$eval('#cbToggle', c => c.checked) && (await pS.$eval('#fontSelect', s => s.selectedOptions[0].textContent)) === 'Lexend' && (await pS.$eval('#themeToggle', b => b.getAttribute('aria-pressed'))) === 'true');
  await pS.click('#themeToggle'); await pS.uncheck('#cbToggle'); await pS.selectOption('#fontSelect', { label: 'Inter' });
  await pS.waitForTimeout(300);
  ok('back to dark, colour-blind off, Inter', await pS.evaluate(() => document.documentElement.classList.contains('dark') && !document.documentElement.dataset.cb && /Inter/.test(getComputedStyle(document.body).fontFamily) && localStorage.getItem('vcge_settings') === 'hand=0;cb=0;theme=0;font=0;size=0;wipe=0'));
  await pS.close();
  await page.bringToFront();
  await page.click('#navSettings'); await page.click('#themeToggle'); await page.uncheck('#cbToggle'); await page.selectOption('#fontSelect', { label: 'Inter' }); await page.click('#settingsSheet [data-sheet-close]');
  await page.waitForTimeout(300);
  ok('this tab follows too once its own controls are used: dark, Inter, scan still here', (await htmlState()).dark && /Inter/.test((await htmlState()).body) && await visible('reopenScanBtn'));

  // Hold-to-wipe (MOD02): the red trash button on the card in view, and the Vault page's wipe button, open the same question
  const nameBefore = await val('firstName');
  await page.click('.deck-card.is-current .vcge-trash');
  ok('trash button opens the wipe question, No focused, settings box unticked', await visible('wipeDialog') && (await text('wipeTitle')) === 'Are you sure you want to wipe everything and start over?'
    && (await page.evaluate(() => document.activeElement && document.activeElement.id)) === 'wipeNoBtn' && !(await page.isChecked('#wipeSettingsBox')) && !(await visible('wipeSettingsConfirm')));
  const yesBox = await page.locator('#wipeYesBtn').boundingBox();
  ok('Yes and No sit side by side, both at least 44 px tall, No is red and Yes is green', yesBox.height >= 44 && (await page.locator('#wipeNoBtn').boundingBox()).height >= 44
    && /rgb\(220, 38, 38\)/.test(await page.$eval('#wipeNoBtn', b => getComputedStyle(b).backgroundColor)) && /rgb\(187, 247, 208\)|rgb\(20, 83, 45\)/.test(await page.$eval('#wipeYesBtn', b => getComputedStyle(b).backgroundColor)));
  await holdYes(page, 500);
  await page.waitForTimeout(100);
  ok('letting go of Yes early cancels: still open, nothing wiped, fill back to 0', await visible('wipeDialog') && (await val('firstName')) === nameBefore && (await page.$eval('#wipeYesFill', f => f.style.width)) === '0%' && !(await page.evaluate(() => document.getElementById('wipeDialog').dataset.hold)));
  await page.check('#wipeSettingsBox');
  ok('ticking "Also delete my saved settings" asks "Are you sure?" first', await visible('wipeSettingsConfirm') && (await text('wipeSettingsConfirmText')).startsWith('Are you sure?'));
  await page.click('#wipeSettingsNoBtn');
  ok('"Keep them" unticks the box', !(await page.isChecked('#wipeSettingsBox')) && !(await visible('wipeSettingsConfirm')));
  await page.check('#wipeSettingsBox'); await page.click('#wipeSettingsYesBtn');
  ok('"Yes, delete them" keeps the box ticked and closes the question', await page.isChecked('#wipeSettingsBox') && !(await visible('wipeSettingsConfirm')));
  await page.click('#wipeNoBtn');
  ok('No closes the dialog and keeps everything', !(await visible('wipeDialog')) && (await val('firstName')) === nameBefore && await visible('reopenScanBtn'));
  // "Also delete my saved settings" for real: Vault publishes the signal, Shell clears its one entry (MOD01 step 4)
  await page.click('#navSettings'); await page.click('#handLeftBtn'); await page.click('#settingsSheet [data-sheet-close]');
  ok('a saved setting is in place before the wipe', (await page.evaluate(() => localStorage.getItem('vcge_settings'))) === 'hand=1;cb=0;theme=0;font=0;size=0;wipe=0');
  await page.click('.deck-card.is-current .vcge-trash');
  await page.check('#wipeSettingsBox'); await page.click('#wipeSettingsYesBtn');
  await holdYes(page, 1700); await page.waitForTimeout(700);
  ok('wiping with the settings box ticked deletes the settings entry too: storage empty, right hand again', (await page.evaluate(() => localStorage.length + sessionStorage.length)) === 0
    && (await page.evaluate(() => document.documentElement.dataset.hand)) === 'right' && (await val('firstName')) === '' && !(await visible('wipeDialog')));
  await page.fill('#firstName', nameBefore); await page.waitForTimeout(300);
  await openVault(page);
  await page.click('#wipeVaultBtn');
  ok('the Vault page wipe button opens the same question, above the page', await visible('wipeDialog') && (await page.evaluate(() => { const a = document.elementFromPoint(innerWidth / 2, innerHeight / 2); return !!a && !!a.closest('#wipeDialog'); })));
  await page.keyboard.press('Escape');
  ok('Esc is No', !(await visible('wipeDialog')) && await vaultOpen(page));
  await closeVault(page);
  // Colour-blind mode (Shell's settings set html[data-cb="1"]): words and a bar say what the colours say
  await page.evaluate(() => { document.documentElement.dataset.cb = '1'; });
  await page.click('.deck-card.is-current .vcge-trash');
  ok('colour-blind mode: Yes reads "Hold to wipe" and a fill bar shows', (await text('wipeYesText')) === 'Hold to wipe' && await visible('wipeHoldBar'));
  await page.click('#wipeNoBtn');
  await page.evaluate(() => { delete document.documentElement.dataset.cb; });
  await page.click('.deck-card.is-current .vcge-trash');
  const hist0 = await page.evaluate(() => ({ len: history.length, guard: !!(history.state && history.state.vcgeLeaveGuard) }));
  await holdYes(page, 1700); await page.waitForTimeout(600);
  // The fresh start replaces the history entry in place (location.replace, not reload: a second reload of the guard's
  // entry hangs WebKit). Firefox drops a replaced entry's state, so the app puts the guard back from the ?guard mark;
  // a tap afterwards then adds no Back step, and the mark is gone from the address.
  const hist1 = await page.evaluate(() => ({ len: history.length, guard: !!(history.state && history.state.vcgeLeaveGuard), url: location.href }));
  await page.click('#firstName');
  const hist2 = await page.evaluate(() => ({ len: history.length, guard: !!(history.state && history.state.vcgeLeaveGuard) }));
  ok('the wipe starts fresh in place: same history length, the Back guard entry kept, and a tap adds no Back step', hist0.guard && hist1.guard && hist1.len === hist0.len
    && hist2.guard && hist2.len === hist0.len && !hist1.url.includes('guard'), JSON.stringify([hist0, hist1, hist2]));
  ok('holding Yes 1.5 s wipes everything and the page starts fresh', (await val('firstName')) === '' && !(await visible('reopenScanBtn')) && !(await visible('wipeDialog')) && !(await visible('vaultModal')) && (await text('vaultBadge')) === 'Vault: UNLOCKED');
  ok('after the wipe: nothing in storage', !(await storage()).includes(nameBefore));

  // Reload: the card is gone (nothing was saved), and no unlock dialog
  await page.fill('#firstName', 'Before'); await page.fill('#lastName', 'Reload');
  await page.reload(); await page.waitForTimeout(500);
  ok('reload starts empty, with no unlock dialog', (await val('firstName')) === '' && !(await visible('vaultModal')));
  ok('reload: still nothing in storage', !(await storage()).includes('Before'));

  // Bundled card fonts load locally
  const fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    const fams = ['Inter', 'Playfair Display', 'Fira Code'];
    for (const f of fams) await document.fonts.load(`700 16px "${f}"`);
    return fams.map(f => document.fonts.check(`700 16px "${f}"`));
  });
  ok('bundled fonts (Inter, Playfair Display, Fira Code) load', fonts.every(Boolean), JSON.stringify(fonts));

  ok('no external requests during whole session', external.length === 0, external.join(', '));
  ok('no page errors', errors.length === 0, errors.join(' | '));
  // Startup residue check + 120 s idle purge (fresh context with a controllable clock)
  {
    // No file is saved from this context: the one download in it (a share) only has to be dispatched. Edge keeps a
    // blank helper page open for every saved download, and the fake clock, which ticks every page, stalls on it.
    const ctx2 = await newContext({ acceptDownloads: false });
    await ctx2.addInitScript(() => {
      if (!sessionStorage.getItem('seeded')) {
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem('vcge_contact_state', '{"name":"Old Plaintext"}');
        localStorage.setItem('vcge_state', '{"firstName":"Old"}');
        localStorage.setItem('vCGE_secure_vault.dat', '{"v":2,"kdf":"pbkdf2-sha256","ciphertext":[1,2,3]}');
      }
    });
    const p2 = await ctx2.newPage();
    p2.on('dialog', d => d.accept());
    await p2.clock.install();
    await p2.goto(ORIGIN); await p2.waitForTimeout(300);
    const st2 = await p2.evaluate(() => JSON.stringify(localStorage));
    ok('startup purges legacy plaintext keys', !st2.includes('Old Plaintext') && !st2.includes('vcge_state'), st2);
    ok('startup deletes a vault saved by an older build', !st2.includes('vCGE_secure_vault') && (await p2.textContent('#auditLog')).includes('Vault wiped (copy saved by an older build)'), st2);
    await p2.fill('#firstName', 'Idle'); await p2.fill('#lastName', 'Tester');
    await fastForward(p2, 5000);
    ok('countdown shows remaining time', /Auto-clear in 11\d s/.test(await p2.textContent('#purgeCountdown')), await p2.textContent('#purgeCountdown'));
    const strip2 = await p2.evaluate(() => ({ v: document.documentElement.style.getPropertyValue('--vcge-vault-strip'), h: document.getElementById('vaultTimerBand').offsetHeight }));
    ok('timer strip: while shown, its height is published as --vcge-vault-strip (so the cards can sit below it)', strip2.h > 0 && strip2.v === `${strip2.h}px`, JSON.stringify(strip2));
    ok('timer strip: without a PIN it reads "Clears in" with the time left', await p2.isVisible('#vaultTimerStrip') && (await p2.textContent('#vaultTimerLabel')) === 'Clears in' && /^1:5\d$/.test(await p2.textContent('#vaultTimerTime')), await p2.textContent('#vaultTimerTime'));
    await fastForward(p2, 60000);
    await p2.fill('#organization', 'Activity resets');
    await fastForward(p2, 100000);
    ok('activity restarts the TTL (not purged at 165 s)', (await p2.inputValue('#firstName')) === 'Idle');
    await fastForward(p2, 25000);
    ok('idle 120 s without a PIN wipes the card', (await p2.inputValue('#firstName')) === '' && (await p2.textContent('#previewFullName')).trim() === 'New Contact' && !(await p2.isVisible('#vaultModal')));
    ok('timer strip gone once the card is wiped', !(await p2.isVisible('#vaultTimerStrip')));
    ok('timer strip: its height is published for Shell\'s layout, 0px once it is gone', (await p2.evaluate(() => document.documentElement.style.getPropertyValue('--vcge-vault-strip'))) === '0px');
    ok('purge logged in audit log', (await p2.textContent('#auditLog')).includes('RAM purged (idle)'));

    // Out of view: 30 s wipes, a shorter absence keeps the card, and frozen background timers are caught on return
    await p2.fill('#firstName', 'Hidden'); await fastForward(p2, 1000);
    await setVisibility(p2, 'hidden'); await fastForward(p2, 20000); await setVisibility(p2, 'visible');
    ok('out of view for 20 s: card kept', (await p2.inputValue('#firstName')) === 'Hidden');
    await setVisibility(p2, 'hidden'); await fastForward(p2, 31000);
    ok('out of view for 30 s: card wiped', (await p2.inputValue('#firstName')) === '' && (await p2.textContent('#auditLog')).includes('Vault wiped (out of view for 30 s)'));
    await setVisibility(p2, 'visible');
    await p2.fill('#firstName', 'Frozen'); await fastForward(p2, 1000);
    await setVisibility(p2, 'hidden');
    await p2.clock.setSystemTime(await p2.evaluate(() => Date.now() + 60000));   // time passes, no timer runs
    ok('frozen timers: card still there while out of view', (await p2.inputValue('#firstName')) === 'Frozen');
    await setVisibility(p2, 'visible');
    ok('frozen timers: wiped as the page comes back', (await p2.inputValue('#firstName')) === '' && (await p2.textContent('#toastMessage')).includes('out of view'));
    // A share the app opened (here: download) may bring another app to the front: the 2-minute rule applies instead
    await p2.fill('#firstName', 'Shared'); await p2.click('#downloadVcfBtn');
    await setVisibility(p2, 'hidden'); await fastForward(p2, 60000); await setVisibility(p2, 'visible');
    ok('after a share, 60 s out of view keeps the card', (await p2.inputValue('#firstName')) === 'Shared');
    ok('storage stays empty throughout', !(await p2.evaluate(() => JSON.stringify(localStorage))).includes('vCGE_secure_vault'));
    await ctx2.close();
  }

  // Quick unlock: 4-digit session PIN after a lock (idle, screen off, Lock button); the card is held in memory only,
  // and 7 minutes without activity wipe it
  {
    const ctx8 = await newContext();
    const p8 = await ctx8.newPage();
    const errors8 = [];
    p8.on('pageerror', e => errors8.push(e.message));
    p8.on('console', m => { if (m.type() === 'error') errors8.push('console: ' + m.text()); });
    p8.on('dialog', d => d.accept());
    await p8.clock.install();
    const t8 = id => p8.textContent('#' + id).then(t => t.trim());
    const IDLE_MS = 125000;
    const idle = async () => { await fastForward(p8, 1000); await fastForward(p8, IDLE_MS); };
    await p8.goto(ORIGIN); await p8.waitForTimeout(300);

    ok('no session PIN offer on its own', !(await p8.isVisible('#quickSetupModal')) && (await t8('sessionPinStatus')) === 'Session PIN: not set');
    await openVault(p8);
    const sw8 = (id) => p8.evaluate((id) => { const b = document.getElementById(id); return { on: b.getAttribute('aria-checked'), word: b.textContent.trim(), bg: getComputedStyle(b).backgroundColor }; }, id);
    const pinOff8 = await sw8('pinSwitch');
    ok('Vault page: the PIN is a switch, red with "Off" and a note to turn it on, no green button while it is off', pinOff8.on === 'false' && pinOff8.word === 'Off' && ['rgb(254, 226, 226)', 'rgba(127, 29, 29, 0.45)'].includes(pinOff8.bg)
      && await p8.isVisible('#pinOffNote') && !(await p8.isVisible('#setSessionPinBtn')) && !(await p8.isVisible('#vaultLockNowBtn')), JSON.stringify(pinOff8));
    ok('Vault page: the title has its lock icon on the left', await p8.$eval('#vaultPageTitle', h => h.firstElementChild && h.firstElementChild.tagName === 'svg' && h.textContent.trim() === 'Vault'));
    await p8.click('#pinSwitch');
    await p8.fill('#sessionPinInput', '12'); await p8.click('#quickSetupSaveBtn');
    ok('session PIN: too-short PIN refused', (await t8('quickSetupError')) === 'Use exactly 4 digits.', await t8('quickSetupError'));
    await p8.fill('#sessionPinInput', '2468'); await p8.click('#quickSetupSaveBtn');
    await p8.waitForSelector('#quickSetupModal', { state: 'hidden' });
    ok('session PIN set: Security panel shows it and Lock appears', (await t8('sessionPinStatus')) === 'Session PIN: set' && await lockOffered(p8));
    const pinOn8 = await sw8('pinSwitch');
    ok('Vault page: the PIN switch turns green with "On", Change and Lock now appear, the note goes', pinOn8.on === 'true' && pinOn8.word === 'On' && pinOn8.bg === 'rgb(22, 163, 74)'
      && (await t8('setSessionPinBtn')) === 'Change' && await p8.isVisible('#vaultLockNowBtn') && !(await p8.isVisible('#pinOffNote')), JSON.stringify(pinOn8));
    ok('Vault page: with a PIN the countdown reads "Auto-lock" (it locks before it clears)', /^Auto-lock (idle|in \d+ s)$/.test(await t8('purgeCountdown')), await t8('purgeCountdown'));
    await closeVault(p8);
    await p8.fill('#firstName', 'Quick'); await p8.fill('#lastName', 'Unlock');
    await fastForward(p8, 1000);
    ok('timer strip: with a PIN it reads "Locks in", calm, no note', await p8.isVisible('#vaultTimerStrip') && (await t8('vaultTimerLabel')) === 'Locks in' && /^1:5\d$/.test(await t8('vaultTimerTime')) && !(await p8.isVisible('#vaultTimerNote')), await t8('vaultTimerTime'));
    await fastForward(p8, 102000);
    const warn8 = await p8.evaluate(() => document.getElementById('vaultTimerBand').className + ' ' + document.getElementById('vaultTimerBar').className);
    ok('timer strip: last 20 s turn it amber (never red) with one quiet note', await p8.isVisible('#vaultTimerNote') && /^0:1\d$/.test(await t8('vaultTimerTime')) && warn8.includes('bg-amber-50/95') && warn8.includes('bg-amber-500') && !/red|rose/.test(warn8), warn8);
    await p8.click('#vaultTimerKeepBtn');
    ok('timer strip: Keep open refills it and the note goes away', /^(2:00|1:59)$/.test(await t8('vaultTimerTime')) && !(await p8.isVisible('#vaultTimerNote')) && (await p8.evaluate(() => document.getElementById('vaultTimerBar').className)).includes('bg-brand-500'), await t8('vaultTimerTime'));
    await idle();
    ok('idle with a session PIN: card hidden, PIN prompt', await p8.isVisible('#vaultModal') && (await t8('vaultModalTitle')) === 'Locked' && await p8.isVisible('#vaultPin') && (await p8.inputValue('#firstName')) === '');
    ok('lock screen: the title has its lock icon on the left', await p8.$eval('#vaultModalTitle', h => h.firstElementChild && h.firstElementChild.tagName === 'svg'));
    ok('quick lock: badge, indicator and countdown show the 7 minutes that run from the lock', (await t8('vaultBadge')) === 'Vault: LOCKED' && /^LOCKED \(resets in (7:00|6:5\d)\)$/.test(await t8('vaultStateIndicator')) && /everything resets in (7:00|6:5\d)/.test(await t8('quickUnlockCountdown')), await t8('vaultStateIndicator'));
    const ring8 = await p8.evaluate(() => Number(document.getElementById('vaultLockRing').getAttribute('stroke-dashoffset')));
    ok('lock screen: calm green ring shows the time left until it is cleared', /^(7:00|6:5\d)$/.test(await t8('vaultLockRingTime')) && ring8 >= 0 && ring8 < 10 && !(await p8.isVisible('#vaultTimerStrip')), `${await t8('vaultLockRingTime')} ${ring8}`);
    ok('lock screen: no Unlock button (the 4th digit unlocks), PIN box focused when no fingerprint is set', !(await p8.$('#vaultUnlockBtn')) && !(await p8.isVisible('#vaultBiometricBtn')) && (await p8.evaluate(() => document.activeElement && document.activeElement.id)) === 'vaultPin');
    ok('idle lock explains why it locked', (await t8('vaultModalHint')).startsWith('Locked after 2 minutes without activity. Enter your 4-digit PIN'));
    ok('quick lock: the held card is not in storage or the page', !(await p8.evaluate(() => JSON.stringify(localStorage) + document.body.innerText)).includes('Quick'));
    // Ghost on the lock screen (cute round V1-V3, raven575 2026-10-21): drawing only, branded edition only
    const face8 = () => p8.evaluate(() => {
      const shown = (id) => { const el = document.getElementById(id); return !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0; };
      return { peek: document.getElementById('vaultModal').dataset.peek, filled: document.getElementById('vaultPinPaws').dataset.filled,
        ghost: shown('vaultGhost'), paws: shown('vaultPinPaws'), bands: shown('vaultTailBands'),
        pawsCovered: getComputedStyle(document.querySelector('#vaultGhost .vg-paws')).opacity,
        filledPaws: [...document.querySelectorAll('#vaultPinPaws .vault-paw')].filter(s => getComputedStyle(s).fill !== 'none').length,
        pinColor: getComputedStyle(document.getElementById('vaultPin')).color,
        ring: document.getElementById('vaultLockRing').getAttribute('stroke-dashoffset'), tail: document.getElementById('vaultTailMaskRing').getAttribute('stroke-dashoffset') };
    });
    const f0 = await face8();
    if (EDITION_PLAIN) ok('plain edition: no Ghost, no paw prints and no tail bands on the lock screen; the PIN box shows its own dots', !f0.ghost && !f0.paws && !f0.bands && f0.pinColor !== 'rgba(0, 0, 0, 0)', JSON.stringify(f0));
    else ok('lock screen: Ghost peeks with eyes open and four empty paw prints sit in the PIN box', f0.ghost && f0.paws && f0.peek === 'open' && f0.filled === '0' && f0.filledPaws === 0 && f0.pawsCovered === '0', JSON.stringify(f0));
    ok('lock screen: the tail\'s bands follow the ring\'s countdown', f0.tail === f0.ring, JSON.stringify(f0));
    await p8.type('#vaultPin', '13'); await p8.waitForTimeout(500);
    const f2 = await face8();
    ok('typing a PIN: Ghost covers its eyes and one paw print fills per digit', f2.peek === 'covered' && f2.filled === '2' && (EDITION_PLAIN || (f2.filledPaws === 2 && f2.pawsCovered === '1')), JSON.stringify(f2));
    const box8 = await p8.evaluate(() => { const i = document.getElementById('vaultPin'); return { type: i.type, mask: i.style.webkitTextSecurity, max: i.maxLength, labels: i.labels.length, pawsHidden: document.getElementById('vaultPinPaws').getAttribute('aria-hidden'), ghostHidden: document.getElementById('vaultGhost').getAttribute('aria-hidden') }; });
    ok('the paw prints are drawing only: the PIN box is still a masked 4-digit field', (box8.type === 'password' || (box8.type === 'text' && box8.mask === 'disc')) && box8.max === 4 && box8.labels > 0 && box8.pawsHidden === 'true' && box8.ghostHidden === 'true', JSON.stringify(box8));
    await p8.fill('#vaultPin', ''); await p8.waitForTimeout(100);
    const fx = await face8();
    ok('PIN box emptied: the paws come down and the prints empty', fx.peek === 'open' && fx.filled === '0', JSON.stringify(fx));
    await p8.fill('#vaultPin', '1111'); await p8.waitForTimeout(300);
    ok('wrong session PIN (checked on the 4th digit) rejected with tries left', (await t8('vaultError')) === 'Wrong PIN. 4 tries left.' && (await p8.inputValue('#vaultPin')) === '', await t8('vaultError'));
    const fw = await face8();
    ok('wrong PIN: Ghost uncovers its eyes and the paw prints empty again', fw.peek === 'open' && fw.filled === '0', JSON.stringify(fw));
    await p8.fill('#vaultPin', '2468');
    await p8.waitForSelector('#vaultModal', { state: 'hidden' });
    ok('right session PIN unlocks on the 4th digit, no extra tap', (await p8.inputValue('#firstName')) === 'Quick' && (await t8('auditLog')).includes('Vault unlocked (session PIN)') && (await t8('vaultBadge')) === 'Vault: UNLOCKED');

    // Screen timeout with a PIN: locks at once, the card survives, and the PIN brings it straight back
    await fastForward(p8, 1000);
    await setVisibility(p8, 'hidden');
    ok('screen off with a PIN: locked at once, card off the page', await p8.isVisible('#vaultModal') && (await p8.inputValue('#firstName')) === '' && (await t8('auditLog')).includes('hidden behind the PIN (out of view)'));
    await p8.clock.setSystemTime(await p8.evaluate(() => Date.now() + 200000));   // 3+ minutes asleep, timers frozen
    await setVisibility(p8, 'visible');
    ok('screen back on after 3+ minutes: still locked, not wiped', await p8.isVisible('#vaultModal') && (await t8('vaultModalHint')).startsWith('Locked while the screen was off'));
    await p8.fill('#vaultPin', '2468');
    await p8.waitForSelector('#vaultModal', { state: 'hidden' });
    ok('PIN after a screen timeout restores the card', (await p8.inputValue('#firstName')) === 'Quick');
    await fastForward(p8, 1000);
    await setVisibility(p8, 'hidden');
    await p8.clock.setSystemTime(await p8.evaluate(() => Date.now() + 425000));   // 7+ minutes asleep
    await setVisibility(p8, 'visible');
    ok('7 minutes without activity: wiped as the screen comes back on', !(await p8.isVisible('#vaultModal')) && (await p8.inputValue('#firstName')) === '' && (await t8('auditLog')).includes('7 minutes without activity') && (await t8('sessionPinStatus')) === 'Session PIN: not set');

    await setPin(p8, '2468');
    await p8.fill('#firstName', 'Seven');
    await idle();
    // The lock finishes its (real-time) async work before the clock moves on, and the wipe gets a moment to land.
    await p8.waitForSelector('#vaultModal', { state: 'visible' });
    await p8.waitForFunction(() => document.getElementById('toastMessage').textContent.startsWith('Hidden after'), null, { timeout: 5000 }).catch(() => {});
    await fastForward(p8, 301000);
    ok('idle lock: 5 minutes after it the card is still held (the 7 minutes run from the lock)', await p8.isVisible('#vaultModal') && /^(2:0\d|1:5\d)$/.test(await t8('vaultLockRingTime')), await t8('vaultLockRingTime'));
    const f5 = await face8();
    ok('ringed tail: 5 minutes in, the tail has lost most of its bands with the ring', f5.tail === f5.ring && Number(f5.ring) > 200, JSON.stringify(f5));
    await fastForward(p8, 120000);   // 7 min 7 s after the lock was due
    await p8.waitForFunction(() => document.getElementById('toastMessage').textContent.startsWith('Reset: 7 minutes'), null, { timeout: 5000 }).catch(() => {});
    // A slow runner can still be closing the lock screen here; the next step needs the header, which it covers.
    await p8.waitForSelector('#vaultModal', { state: 'hidden', timeout: 5000 }).catch(() => {});
    ok('idle lock, then 7 minutes after the lock: card and PIN wiped, no dialog', !(await p8.isVisible('#vaultModal')) && (await p8.inputValue('#firstName')) === '' && (await t8('toastMessage')).startsWith('Reset: 7 minutes without activity') && (await t8('sessionPinStatus')) === 'Session PIN: not set', await t8('toastMessage'));

    await setPin(p8, '1357');
    await p8.fill('#firstName', 'Tries');
    await idle();
    for (let i = 0; i < 5; i++) { await p8.fill('#vaultPin', '0000'); await p8.waitForTimeout(250); }
    ok('5 wrong PINs: card wiped', !(await p8.isVisible('#vaultModal')) && (await p8.inputValue('#firstName')) === '' && (await t8('toastMessage')).startsWith('5 wrong PINs'), await t8('toastMessage'));

    await setPin(p8, '4321');
    await p8.fill('#firstName', 'Locked');
    await pressLock(p8);
    ok('Lock button hides the card behind the PIN', await p8.isVisible('#vaultPin') && (await p8.inputValue('#firstName')) === '');
    ok('Lock button: the lock screen says the Lock button locked it (not "2 minutes without activity")', (await t8('vaultModalHint')).startsWith('Locked with the Lock button.'), await t8('vaultModalHint'));
    await p8.click('#vaultStartOverBtn');
    ok('"Wipe and start over" on the lock screen asks the hold-to-wipe question above it', await p8.isVisible('#wipeDialog') && await p8.isVisible('#vaultModal'));
    await holdYes(p8, 1700, p8.clock); await p8.waitForTimeout(300);
    ok('"Wipe and start over" (held) wipes the held card and starts fresh', !(await p8.isVisible('#vaultModal')) && !(await p8.isVisible('#wipeDialog')) && (await p8.inputValue('#firstName')) === '' && (await t8('vaultBadge')) === 'Vault: UNLOCKED');

    // A lock noticed late (timers frozen while the photo picker had the screen): the 7 minutes run from when the 2 idle
    // minutes ran out, not from when the page came back.
    await setPin(p8, '4321');
    await p8.fill('#firstName', 'Picker'); await fastForward(p8, 1000);
    await p8.evaluate(() => document.getElementById('imageUpload').dispatchEvent(new MouseEvent('click')));   // the app opens the photo picker
    await p8.evaluate(() => document.getElementById('imageUpload').blur());
    await setVisibility(p8, 'hidden');
    await p8.clock.setSystemTime(await p8.evaluate(() => Date.now() + 360000));   // 6 minutes in the picker, timers frozen
    await setVisibility(p8, 'visible'); await fastForward(p8, 1000);
    await p8.waitForSelector('#vaultModal', { state: 'visible' });
    ok('idle lock noticed late: about 3 minutes left (7 from when it was due), not a fresh 7', await p8.isVisible('#vaultModal') && /^(3:0\d|2:5\d)$/.test(await t8('vaultLockRingTime')), await t8('vaultLockRingTime'));
    await p8.fill('#vaultPin', '4321'); await p8.waitForSelector('#vaultModal', { state: 'hidden' });
    await p8.fill('#firstName', 'Picker2'); await fastForward(p8, 1000);
    await p8.evaluate(() => { const u = document.getElementById('imageUpload'); u.dispatchEvent(new MouseEvent('click')); u.blur(); });
    await setVisibility(p8, 'hidden');
    await p8.clock.setSystemTime(await p8.evaluate(() => Date.now() + 400000));   // 6 min 40 s: under 7 since activity, but 2 + 7 is not over either
    await setVisibility(p8, 'visible'); await fastForward(p8, 1000);
    ok('idle lock noticed late but within its 7 minutes: locked, not wiped', await p8.isVisible('#vaultModal') && /^(2:2\d|2:1\d)$/.test(await t8('vaultLockRingTime')), await t8('vaultLockRingTime'));
    await p8.fill('#vaultPin', '4321'); await p8.waitForSelector('#vaultModal', { state: 'hidden' });

    // Unlocking goes back to the card that was in view, and to the Vault page when its Lock now locked it
    await p8.click('#navShare'); await deckSettled(p8);
    // On a phone the header Lock is hidden, so a lock that starts on a card is the idle lock: the same button, pressed by the app
    if (isPhone()) await p8.evaluate(() => document.getElementById('lockVaultBtn').click()); else await p8.click('#lockVaultBtn');
    await p8.evaluate(() => document.getElementById('navCard').click());   // the deck moved while locked
    await deckSettled(p8);
    await p8.fill('#vaultPin', '4321'); await p8.waitForSelector('#vaultModal', { state: 'hidden' }); await deckSettled(p8);
    ok('unlock returns to the card that was in view when it locked', (await p8.$eval('.deck-card.is-current', c => c.dataset.card)) === 'share' && !(await vaultOpen(p8)));
    await openVault(p8);
    await p8.click('#vaultLockNowBtn');
    ok('Lock now on the Vault page closes it and locks', await p8.isVisible('#vaultModal') && !(await vaultOpen(p8)));
    await p8.fill('#vaultPin', '4321'); await p8.waitForSelector('#vaultModal', { state: 'hidden' });
    ok('unlock after Lock now opens the Vault page again (close it to carry on)', await vaultOpen(p8) && (await p8.$eval('.deck-card.is-current', c => c.dataset.card)) === 'share');
    await closeVault(p8);

    // The lock is the top layer: it comes down during the welcome tour and its PIN box can still be pressed
    await p8.evaluate(() => document.getElementById('welcomeTourBtn').click());
    await p8.waitForSelector('#tourTip', { state: 'visible' });
    await p8.evaluate(() => document.getElementById('lockVaultBtn').click());
    const onTop8 = await p8.evaluate(() => {
      const pick = (id) => { const r = document.getElementById(id).getBoundingClientRect(), e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!e && !!e.closest('#vaultModal'); };
      return { pin: pick('vaultPin'), start: pick('vaultStartOverBtn'), z: [getComputedStyle(document.getElementById('vaultModal')).zIndex, getComputedStyle(document.getElementById('welcomeLayer')).zIndex] };
    });
    ok('lock during the tour: the lock screen is on top and its controls take the tap', onTop8.pin && onTop8.start && Number(onTop8.z[0]) > Number(onTop8.z[1]), JSON.stringify(onTop8));
    await p8.click('#vaultStartOverBtn');
    const wipeOnTop8 = await p8.evaluate(() => { const r = document.getElementById('wipeYesBtn').getBoundingClientRect(), e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!e && !!e.closest('#wipeDialog'); });
    ok('lock during the tour: hold-to-wipe opens above the lock screen', wipeOnTop8);
    await p8.click('#wipeNoBtn');
    await p8.fill('#vaultPin', '4321'); await p8.waitForSelector('#vaultModal', { state: 'hidden' });
    // Unlocking leaves the tour as it was, on the step it was on; then Skip closes it. (This used to skip only when
    // Skip happened to be visible at one instant, so a Firefox run once went on with the tour still covering the page.)
    const tourState8 = () => p8.evaluate(() => {
      const box = (id) => { const e = document.getElementById(id); if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; };
      return { layer: !!document.getElementById('welcomeLayer'), step: (document.getElementById('tourStep') || {}).textContent || null, tip: box('tourTip'), skip: box('tourSkipBtn'), focus: document.activeElement && document.activeElement.id };
    });
    const skipShown8 = await p8.waitForSelector('#tourSkipBtn', { state: 'visible', timeout: 5000 }).then(() => true, () => false);
    const afterUnlock8 = await tourState8();
    ok('unlock during the tour: the tour is still there, on the step it was on', skipShown8 && afterUnlock8.step === 'Step 1 of 6', JSON.stringify(afterUnlock8));
    // The unlock slides the deck back to the card it locked on, and the tour card rides along for about 0.4 s (Skip was
    // seen at x -311, 486, 95, 234, then 243). A tap in that slide can land where Skip just was, which is how a Firefox run
    // clicked Skip and the tour stayed (job 117737262324). Tap only once the deck and the tour card have stopped.
    if (skipShown8) {
      await deckSettled(p8);
      await p8.waitForFunction(() => {
        const r = document.getElementById('tourSkipBtn').getBoundingClientRect(), at = `${Math.round(r.left)},${Math.round(r.top)}`;
        const same = window.__vcgeSkipAt === at; window.__vcgeSkipAt = at; return same;
      }, null, { polling: 150 });
      await p8.click('#tourSkipBtn');
    }
    else { await p8.evaluate(() => document.activeElement && document.activeElement.blur()); await p8.keyboard.press('Escape'); }   // close it anyway so the checks after this one still run
    const tourGone8 = await p8.waitForSelector('#welcomeLayer', { state: 'detached', timeout: 5000 }).then(() => true, () => false);
    ok('unlock during the tour: Skip closes the tour', tourGone8, JSON.stringify(await tourState8()));
    await p8.waitForTimeout(700);

    // Settings > Wipe after the lock (raven575, 2026-10-18): 10 or 15 minutes instead of 7; the 2-minute lock stays
    const wipeChoice = async (label) => {
      if (await vaultOpen(p8)) await closeVault(p8);   // on a phone, unlocking after Lock now reopens the Vault page
      await p8.click('#navSettings'); await p8.waitForSelector('#settingsSheet', { state: 'visible' });
      await p8.selectOption('#wipeSelect', { label });
      await p8.click('#settingsSheet [data-sheet-close]'); await p8.waitForSelector('#settingsSheet', { state: 'hidden' });
    };
    await wipeChoice('10 minutes');
    await openVault(p8);
    ok('wipe 10: the Vault page says 10 minutes after the lock', (await t8('vaultWipeMinutes')) === '10', await t8('vaultWipeMinutes'));
    await closeVault(p8);
    await p8.fill('#firstName', 'Ten'); await pressLock(p8);
    ok('wipe 10: the lock ring starts at 10:00', /^(10:00|9:5\d)$/.test(await t8('vaultLockRingTime')) && /resets in (10:00|9:5\d)/.test(await t8('quickUnlockCountdown')), await t8('vaultLockRingTime'));
    await p8.evaluate(() => { const s = document.getElementById('wipeSelect'); s.value = '2'; s.dispatchEvent(new Event('change', { bubbles: true })); });
    await fastForward(p8, 1000);
    ok('wipe: a change made while locked applies from the next lock (this one stays 10)', (await p8.evaluate(() => document.documentElement.dataset.wipe)) === '15' && /^9:5\d$/.test(await t8('vaultLockRingTime')), await t8('vaultLockRingTime'));
    await fastForward(p8, 430000);   // 7 min 11 s after the lock
    ok('wipe 10: still held 7 minutes after the lock', await p8.isVisible('#vaultModal') && /^2:\d\d$/.test(await t8('vaultLockRingTime')), await t8('vaultLockRingTime'));
    await fastForward(p8, 170000);   // 10 min 1 s after the lock
    ok('wipe 10: wiped 10 minutes after the lock', !(await p8.isVisible('#vaultModal')) && (await p8.inputValue('#firstName')) === '' && (await t8('toastMessage')).startsWith('Reset: 10 minutes without activity'), await t8('toastMessage'));
    await setPin(p8, '4321');
    await p8.fill('#firstName', 'Fifteen'); await pressLock(p8);
    ok('wipe 15: the next lock runs 15 minutes', /^(15:00|14:5\d)$/.test(await t8('vaultLockRingTime')), await t8('vaultLockRingTime'));
    await p8.fill('#vaultPin', '4321'); await p8.waitForSelector('#vaultModal', { state: 'hidden' });
    await p8.evaluate(() => { document.documentElement.dataset.wipe = '99'; });
    await pressLock(p8);
    ok('wipe: a value that is not 7, 10 or 15 means 7', /^(7:00|6:5\d)$/.test(await t8('vaultLockRingTime')), await t8('vaultLockRingTime'));
    await p8.fill('#vaultPin', '4321'); await p8.waitForSelector('#vaultModal', { state: 'hidden' });
    await wipeChoice('7 minutes');

    await openVault(p8);
    ok('Security panel: Change offered and the switch is on', (await t8('setSessionPinBtn')) === 'Change' && (await sw8('pinSwitch')).on === 'true');
    await p8.click('#pinSwitch');
    ok('Security panel: Remove forgets the PIN and hides Lock', (await t8('sessionPinStatus')) === 'Session PIN: not set' && (await t8('auditLog')).includes('Session PIN removed') && !(await lockOffered(p8)));
    ok('quick unlock: no page errors', errors8.length === 0, errors8.join(' | '));
    await ctx8.close();
  }

  // Biometric unlock (Face ID / fingerprint / Windows Hello) through a virtual platform authenticator: on-device only.
  // The virtual authenticator is a Chromium DevTools tool; Firefox and WebKit have none.
  if (ENGINE !== 'chromium') notRunHere('biometric unlock (11 checks)', 'the virtual authenticator exists only in Chromium');
  else {
    const ctxB = await newContext();
    const pB = await ctxB.newPage();
    const errorsB = [], externalB = [];
    pB.on('pageerror', e => errorsB.push(e.message));
    pB.on('console', m => { if (m.type() === 'error') errorsB.push('console: ' + m.text()); });
    pB.on('request', r => { if (!r.url().startsWith(ORIGIN) && !/^(data|blob):/.test(r.url())) externalB.push(r.url()); });
    const cdp = await ctxB.newCDPSession(pB);
    await cdp.send('WebAuthn.enable');
    const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: {
      protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
    const tB = id => pB.textContent('#' + id).then(t => t.trim());
    await pB.goto(ORIGIN); await pB.waitForTimeout(300);
    await openVault(pB);
    ok('biometric not offered before a PIN is set', !(await pB.isVisible('#biometricRow')));
    await setPin(pB, '2468');
    ok('biometric offered once a PIN is set', await pB.isVisible('#biometricRow') && (await tB('biometricStatus')) === 'Face ID / fingerprint: off');
    await cdp.send('WebAuthn.setUserVerified', { authenticatorId, isUserVerified: false });
    ok('biometric: the switch is off (red) with a note, and the page says a passkey is saved on the device and holds no contact details',
      (await pB.getAttribute('#biometricSwitch', 'aria-checked')) === 'false' && await pB.isVisible('#biometricOffNote') && /saves? a passkey[\s\S]*no contact details[\s\S]*after a wipe you turn it on again/.test(await tB('biometricNotes')), await tB('biometricNotes'));
    await pB.click('#biometricSwitch'); await pB.waitForTimeout(800);
    ok('a device that cannot confirm the person does not turn biometric on, and the real reason is shown', (await tB('biometricStatus')) === 'Face ID / fingerprint: off' && /was not added \([A-Za-z_]+\)/.test(await tB('toastMessage')) && !(await tB('auditLog')).includes('fingerprint added'), await tB('toastMessage'));
    await cdp.send('WebAuthn.setUserVerified', { authenticatorId, isUserVerified: true });
    await pB.click('#biometricSwitch'); await pB.waitForTimeout(500);
    ok('biometric added for this session, after a check that passed', (await tB('biometricStatus')) === 'Face ID / fingerprint: on' && (await tB('auditLog')).includes('Face ID / fingerprint added'), await tB('toastMessage'));
    ok('biometric: the switch is green with "On" and the turn-on note goes', (await pB.getAttribute('#biometricSwitch', 'aria-checked')) === 'true' && (await tB('biometricSwitch')) === 'On' && !(await pB.isVisible('#biometricOffNote')));
    await closeVault(pB);
    await pB.fill('#firstName', 'Bio'); await pressLock(pB);
    ok('lock screen offers Face ID / fingerprint', await pB.isVisible('#vaultBiometricBtn') && (await pB.inputValue('#firstName')) === '');
    const bioBox = await pB.locator('#vaultBiometricBtn').boundingBox(), pinBox = await pB.locator('#vaultPin').boundingBox();
    ok('lock screen leads with a big fingerprint button above the PIN, focused (no keyboard pops up), no Unlock button', bioBox.height >= 52 && bioBox.y < pinBox.y && (await pB.evaluate(() => document.activeElement && document.activeElement.id)) === 'vaultBiometricBtn' && !(await pB.$('#vaultUnlockBtn')) && await pB.isVisible('#vaultOr'));
    await pB.click('#vaultBiometricBtn');
    await pB.waitForSelector('#vaultModal', { state: 'hidden', timeout: 5000 }).catch(() => {});
    ok('biometric unlocks the card', !(await pB.isVisible('#vaultModal')) && (await pB.inputValue('#firstName')) === 'Bio' && (await tB('auditLog')).includes('Vault unlocked (biometric)'));
    await cdp.send('WebAuthn.setUserVerified', { authenticatorId, isUserVerified: false });
    await pressLock(pB);
    await pB.click('#vaultBiometricBtn'); await pB.waitForTimeout(800);
    ok('face or fingerprint not confirmed: stays locked, PIN offered, and the device\'s reason is shown', await pB.isVisible('#vaultModal') && /^Face or fingerprint not confirmed \([A-Za-z ]+\)\. Use your PIN\.$/.test(await tB('vaultError')) && (await pB.inputValue('#firstName')) === '', await tB('vaultError'));
    await pB.fill('#vaultPin', '2468');
    await pB.waitForSelector('#vaultModal', { state: 'hidden' });
    ok('the PIN still works as the fallback', (await pB.inputValue('#firstName')) === 'Bio');
    await openVault(pB);
    await pB.click('#pinSwitch');
    ok('removing the PIN removes biometric too', !(await pB.isVisible('#biometricRow')) && !(await lockOffered(pB)));
    ok('biometric: nothing saved to browser storage', !(await pB.evaluate(() => JSON.stringify(localStorage) + JSON.stringify(sessionStorage))).includes('Bio'));
    ok('biometric: no network requests', externalB.length === 0, externalB.join(', '));
    ok('biometric: no page errors', errorsB.length === 0, errorsB.join(' | '));
    await ctxB.close();
  }

  // Padlock hand-off (MOD02): plays at every move between step cards, says nothing, cannot be tapped
  {
    const ctxL = await browser.newContext();
    const pL = await ctxL.newPage();
    const errorsL = [];
    pL.on('pageerror', e => errorsL.push(e.message));
    await pL.goto(ORIGIN); await pL.waitForTimeout(500);
    const padlock = () => pL.evaluate(() => { const r = document.getElementById('vaultHandoff'); return { hidden: r.classList.contains('hidden'), playing: r.dataset.playing || '', state: r.dataset.state || '', pe: getComputedStyle(r).pointerEvents, live: document.getElementById('vaultHandoffLive').textContent }; });
    ok('no padlock at boot or after START (Welcome hands nothing to the vault)', (await padlock()).hidden && (await pL.$eval('.deck-card.is-current', c => c.dataset.card)) === 'capture');
    await pL.click('#navRead');
    await pL.waitForSelector('#vaultHandoff[data-playing="cycle"]', { timeout: 2000 });
    const first = await padlock();
    const seen = new Set([first.state]);
    const t0 = Date.now();
    while (Date.now() - t0 < 2500 && !(await padlock()).hidden) { seen.add((await padlock()).state); await pL.waitForTimeout(40); }
    const took = Date.now() - t0;
    ok('moving to the next card plays the padlock: unlocked, locked, unlocked again, then gone', first.playing === 'cycle' && seen.has('locked') && seen.has('unlocked') && (await padlock()).hidden, JSON.stringify([...seen]) + ' ' + took);
    ok('the cycle takes about 1.25 to 1.5 s', took >= 900 && took <= 2000, String(took));
    ok('it cannot be tapped, has no words and is announced once', first.pe === 'none' && first.live === 'Details locked in the vault, moving on.' && (await padlock()).live === '' && (await pL.$eval('#vaultHandoff', r => r.textContent.trim())) === '' && (await pL.getAttribute('#vaultHandoff', 'aria-hidden')) === 'true');
    const padlockGone = () => pL.waitForFunction(() => document.getElementById('vaultHandoff').classList.contains('hidden'), null, { timeout: 3000 });
    // Every frame of one cycle, recorded as it is drawn (a slow runner must not miss the locked middle of it).
    const frames = await pL.evaluate(() => new Promise(resolve => {
      const r = document.getElementById('vaultHandoff'), seen = [];
      const sample = () => seen.push({ fill: getComputedStyle(r.querySelector('.vh-body')).fill, shackle: r.querySelector('.vh-shackle').style.transform, dial: r.querySelector('.vh-dial').style.transform, state: r.dataset.state });
      const o = new MutationObserver(() => { if (r.classList.contains('hidden')) { o.disconnect(); resolve(seen); } else sample(); });
      o.observe(r, { attributes: true, subtree: true });
      setTimeout(() => { o.disconnect(); resolve(seen); }, 4000);
      document.getElementById('navFields').click();
    }));
    const lockedFrame = frames.find(f => f.fill === 'rgb(34, 197, 94)' && f.shackle === 'translateY(0px)' && /rotate\(150/.test(f.dial) && f.state === 'locked');
    const openFrame = frames.find(f => f.state === 'unlocked' && f.shackle === 'translateY(-7px)');
    ok('locked is green with the shackle down and the dial turned; unlocked has the shackle up (colour is never the only cue)', !!lockedFrame && !!openFrame, JSON.stringify(frames.slice(0, 6)) + ` of ${frames.length}`);
    await padlockGone();
    await pL.emulateMedia({ reducedMotion: 'reduce' });
    await pL.click('#navCard');
    await pL.waitForSelector('#vaultHandoff[data-playing]', { timeout: 2000 });
    const still = await padlock();
    const stillLook = await pL.evaluate(() => ({ fill: getComputedStyle(document.querySelector('.vh-body')).fill, shackle: document.querySelector('.vh-shackle').style.transform }));
    await padlockGone();
    ok('reduce motion: the end state (open, orange) shows still, then goes', still.playing === 'still' && still.state === 'unlocked' && stillLook.fill === 'rgb(249, 115, 22)' && stillLook.shackle === 'translateY(-7px)', JSON.stringify(stillLook));
    const glow = await pL.evaluate(() => { const r = document.getElementById('vaultHandoff'), g = r.querySelector('.vault-handoff-glow'), svg = r.querySelector('.vault-handoff-lock');
      return { glow: !!g && g.nextElementSibling === svg && getComputedStyle(g).backgroundImage.startsWith('radial-gradient') && getComputedStyle(g).pointerEvents === 'none', filter: getComputedStyle(svg).filter }; });
    ok('the glow is its own layer behind the lock; the moving lock carries no filter (no cut-outs)', glow.glow && glow.filter === 'none', JSON.stringify(glow));
    ok('padlock: no page errors', errorsL.length === 0, errorsL.join(' | '));
    await ctxL.close();
  }

  // Back (button or swipe): asks before wiping, Stay keeps the card, leaving wipes it; an empty card just leaves
  {
    const ctx11 = await newContext();
    const p11 = await ctx11.newPage();
    const errors11 = [];
    p11.on('pageerror', e => errors11.push(e.message));
    // Start from a page of our own, not about:blank: in Firefox, Back from the app found no page to go back to.
    const START = ORIGIN + '?start';
    await p11.goto(START);
    await p11.goto(ORIGIN); await p11.waitForTimeout(300);
    await p11.click('#firstName'); await p11.keyboard.type('Swiped');
    await p11.goBack(); await p11.waitForTimeout(300);
    ok('Back with a card asks first (still on the app)', p11.url() === ORIGIN && await p11.isVisible('#leaveModal') && (await p11.inputValue('#firstName')) === 'Swiped', p11.url());
    await p11.click('#leaveStayBtn');
    ok('Stay keeps the card', !(await p11.isVisible('#leaveModal')) && (await p11.inputValue('#firstName')) === 'Swiped');
    await p11.goBack(); await p11.waitForTimeout(300);
    ok('Back asks again after Stay', await p11.isVisible('#leaveModal'));
    await Promise.all([p11.waitForURL(START), p11.click('#leaveConfirmBtn')]);
    ok('"Wipe and leave" goes back', p11.url() === START, p11.url());
    await p11.goForward(); await p11.waitForTimeout(500);
    ok('coming back forward: the card is gone', (await p11.inputValue('#firstName')) === '');
    await p11.click('#clearFormBtn');
    await p11.goBack(); await p11.waitForTimeout(500);
    ok('Back with an empty card leaves without asking', p11.url() === START, p11.url());
    // A reload keeps the guard entry: no second one is added, and Back still asks first
    await p11.goto(ORIGIN); await p11.waitForTimeout(300);
    await p11.click('#firstName'); await p11.keyboard.type('One');
    const len11 = await p11.evaluate(() => history.length);
    // The page's own reload, as the browser's reload button does it. Playwright's page.reload in Firefox is a fresh
    // navigation instead (a new history entry, no state; probe on PR #2, CI job 117624384771), which no user can do.
    await Promise.all([p11.waitForEvent('load'), p11.evaluate(() => location.reload())]); await p11.waitForTimeout(300);
    ok('Back guard: the reload is a real reload', (await p11.evaluate(() => performance.getEntriesByType('navigation')[0].type)) === 'reload');
    await p11.click('#firstName'); await p11.keyboard.type('Reloaded');
    ok('Back guard: a reload and another tap add no second guard entry', (await p11.evaluate(() => history.length)) === len11, `${len11} -> ${await p11.evaluate(() => history.length)}`);
    await p11.goBack(); await p11.waitForTimeout(300);
    ok('Back guard: after a reload, Back with a card still asks first', p11.url() === ORIGIN && await p11.isVisible('#leaveModal') && (await p11.inputValue('#firstName')) === 'Reloaded', p11.url());
    await p11.click('#leaveStayBtn');
    await p11.goBack(); await p11.waitForTimeout(300);
    ok('Back guard: after a reload, Back asks again after Stay', await p11.isVisible('#leaveModal'));
    ok('Back guard: no page errors', errors11.length === 0, errors11.join(' | '));
    await ctx11.close();
  }

  // Quick lock keeps the scan in progress: the open review comes back with the session PIN, sealed while locked
  await rerunIfPageCrashed('quick lock with a scan open', async () => {
    const ctx10 = await newContext();
    const p10 = await ctx10.newPage();
    const errors10 = [];
    p10.on('pageerror', e => errors10.push(e.message));
    p10.on('console', m => { if (m.type() === 'error') errors10.push('console: ' + m.text()); });
    await p10.clock.install();
    const t10 = id => p10.textContent('#' + id).then(t => t.trim());
    const idle = async () => { await fastForward(p10, 1000); await fastForward(p10, 125000); };
    const unlockPin = async () => { await p10.fill('#vaultPin', '2468'); await p10.waitForSelector('#vaultModal', { state: 'hidden' }); await p10.waitForTimeout(300); };
    await p10.goto(ORIGIN); await p10.waitForTimeout(300);
    await setPin(p10, '2468');

    await p10.setInputFiles('#imageUpload', await renderCardImage(p10)); await p10.waitForTimeout(300);
    await p10.click('#runOcrBtn');
    await readEnds(p10);
    const roles10 = await p10.$$eval('#ocrLines select', s => s.map(x => x.value));
    await p10.fill(`#ocrLineText${roles10.indexOf('name')}`, 'Mariah Gonzalez');
    await idle();
    ok('quick lock hides the open review and photo', !(await p10.isVisible('#cropReviewModal')) && (await p10.$$('#ocrLines input')).length === 0 && !(await p10.getAttribute('#reviewImage', 'src')) && (await t10('auditLog')).includes('Card and scan hidden'));
    ok('quick lock: held scan is not in storage or the page', !(await p10.evaluate(() => JSON.stringify(localStorage) + document.body.innerText)).includes('Mariah'));
    await unlockPin();
    ok('session PIN brings the review back as edited', await p10.isVisible('#cropReviewModal') && await p10.isVisible('#ocrStepText') && (await p10.inputValue(`#ocrLineText${roles10.indexOf('name')}`)) === 'Mariah Gonzalez' && (await p10.textContent('#ocrSummary')).includes('maria.gonzalez@northwind.com'));
    ok('restored review keeps the photo (Back to photo offered)', await p10.isVisible('#ocrBackBtn') && (await p10.getAttribute('#reviewImage', 'src') || '').startsWith('data:image/'));
    await proceed(p10);
    ok('restored review fills the form', (await p10.inputValue('#firstName')) === 'Mariah' && await p10.isVisible('#reopenScanBtn'));

    await idle();
    await unlockPin();
    ok('after Fill form, the PIN brings back "Reopen last scan" (dialog stays closed)', await p10.isVisible('#reopenScanBtn') && !(await p10.isVisible('#cropReviewModal')) && (await p10.inputValue('#firstName')) === 'Mariah');
    await p10.click('#reopenScanBtn');
    ok('reopened scan after a PIN unlock shows the edited lines', (await p10.inputValue(`#ocrLineText${roles10.indexOf('name')}`)) === 'Mariah Gonzalez');
    await p10.click('#ocrCancelBtn');

    await idle();
    await fastForward(p10, 421000); await p10.waitForTimeout(300);
    ok('7 minutes after the lock wipe the card and the kept scan', !(await p10.isVisible('#vaultModal')) && !(await p10.isVisible('#reopenScanBtn')) && !(await p10.isVisible('#cropReviewModal')) && (await p10.inputValue('#firstName')) === '');
    ok('kept scan: no page errors', errors10.length === 0, errors10.join(' | '));
    await ctx10.close();
  });

  // Tester feedback round 3: logos fitted square on an opaque background, and a JPEG vCard photo
  {
    const ctx11 = await newContext();
    const p11 = await ctx11.newPage();
    const errors11 = [];
    p11.on('pageerror', e => errors11.push(e.message));
    p11.on('console', m => { if (m.type() === 'error') errors11.push('console: ' + m.text()); });
    await p11.goto(ORIGIN); await p11.waitForTimeout(300);
    await p11.fill('#firstName', 'Logo'); await p11.fill('#lastName', 'Tester');
    // Logos as uploaded (redesign step 8): a one-colour logo is traced into the card's ink colour; one of many colours
    // is kept as a picture; a white background is removed first. Wide ones get the strip, small ones the badge.
    const logo = (kind) => p11.evaluate((kind) => {
      const text = '<text x="10" y="70" font-size="60" fill="#0a6">TeamLogic</text>';
      if (kind === 'svg') return 'data:image/svg+xml;base64,' + btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="100">${text}</svg>`);
      if (kind === 'viewbox') return 'data:image/svg+xml;base64,' + btoa(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 100">${text.replace('#0a6', '#06a')}</svg>`);
      const c = document.createElement('canvas'); c.width = kind === 'round' ? 300 : 400; c.height = kind === 'round' ? 300 : 100;
      const x = c.getContext('2d');
      if (kind === 'round') { x.fillStyle = '#e11'; x.beginPath(); x.arc(150, 150, 40, 0, 7); x.fill(); return c.toDataURL('image/png'); }
      if (kind === 'opaque') { x.fillStyle = '#c00'; x.fillRect(0, 0, 400, 100); }
      if (kind.startsWith('whitebg')) { x.fillStyle = '#fff'; x.fillRect(0, 0, 400, 100); }
      x.font = 'bold 60px Arial';
      if (kind === 'rainbow' || kind === 'pastel' || kind === 'whitebg-colour') {
        const colours = kind === 'pastel' ? ['#ffa0a0', '#a0ffa0', '#a0a0ff'] : ['#d00', '#07c', '#fc0'];
        'TeamLogic'.split('').forEach((ch, i) => { x.fillStyle = colours[i % 3]; x.fillText(ch, 10 + i * 40, 70); });
        return c.toDataURL(kind === 'whitebg-colour' ? 'image/jpeg' : 'image/png');
      }
      x.fillStyle = kind === 'light' ? '#f5f5f5' : kind === 'opaque' ? '#fff' : '#123';
      x.fillText('TeamLogic', 10, 70);
      // 'whitebg-rough': a heavily compressed photo of a logo (the colour fringes JPEG leaves around dark lettering).
      return kind === 'whitebg-rough' ? c.toDataURL('image/jpeg', 0.4) : c.toDataURL(kind === 'whitebg' ? 'image/jpeg' : 'image/png');
    }, kind);
    // Uploads a logo; returns the vCard PHOTO (from the .vcf), what the card shows and what the toast said.
    const upload = async (kind, name) => {
      const url = await logo(kind);
      // The preview is rebuilt from new nodes on every upload, so the old node is marked and the wait is for a node
      // without the mark. (Comparing the markup was not enough: two logos that trace to the same drawing, as the
      // viewBox-only SVG and the sized one do in Firefox, give the same markup twice.)
      await p11.evaluate(() => { const i = document.querySelector('#formAvatarPreview img, #formAvatarPreview svg'); if (i) i.__vcgeSeen = true; });
      await p11.setInputFiles('#avatarUpload', { name, mimeType: url.slice(5, url.indexOf(';')), buffer: Buffer.from(url.split(',')[1], 'base64') });
      await p11.waitForFunction(() => { const i = document.querySelector('#formAvatarPreview img, #formAvatarPreview svg'); return i && !i.__vcgeSeen && (i.tagName === 'svg' || i.complete); });
      await p11.waitForTimeout(300);   // the logo's shape and tone are read, then the card is drawn again
      const toast = await p11.textContent('#toastMessage');
      const [dl] = await Promise.all([p11.waitForEvent('download'), p11.click('#downloadVcfBtn')]);
      const vcf = fs.readFileSync(await dl.path(), 'utf8').replace(/\r\n[ \t]/g, '');
      const m = /\r\nPHOTO;TYPE=(\w+);ENCODING=b:([A-Za-z0-9+/=]+)/.exec(vcf);
      const shown = await p11.evaluate(async ([type, b64]) => {
        const img = new Image(); img.src = `data:image/${type.toLowerCase()};base64,${b64}`; await img.decode();
        const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
        const x = c.getContext('2d'); x.drawImage(img, 0, 0);
        const at = (px, py) => Array.from(x.getImageData(px, py, 1, 1).data.slice(0, 3));
        const strip = document.getElementById('previewLogoStrip'), plate = strip.firstElementChild, badge = document.getElementById('previewAvatar');
        const el = strip.querySelector('img, svg') || badge.querySelector('img, svg');
        const traced = el.tagName === 'svg';
        const vb = traced ? el.getAttribute('viewBox').split(' ').map(Number) : null;
        return {
          // Fitted, not cropped: the wide logo leaves the top and bottom bands as background.
          photo: { type, w: img.naturalWidth, h: img.naturalHeight, corner: at(2, 2), band: at(128, 40) },
          traced, fill: traced ? getComputedStyle(el).fill : null, ink: getComputedStyle(document.getElementById('cardFront')).color,
          display: traced ? { w: vb[2], h: vb[3] } : { png: el.src.startsWith('data:image/png'), w: el.naturalWidth, h: el.naturalHeight },
          strip: !strip.classList.contains('hidden') && strip.getBoundingClientRect().height > 0,
          badge: getComputedStyle(badge).display !== 'none',
          plate: (plate || badge).style.background || ''
        };
      }, [m[1], m[2]]);
      return { ...shown, toast };
    };
    const near = (rgb, target, tol = 40) => rgb.every((v, k) => Math.abs(v - target[k]) <= tol);
    const dark = await upload('dark', 'logo.png');
    ok('vCard photo is a 256 px square JPEG, fitted (not cropped)', dark.photo.type === 'JPEG' && dark.photo.w === 256 && dark.photo.h === 256 && near(dark.photo.band, [255, 255, 255]), JSON.stringify(dark.photo));
    ok('transparent dark logo: white behind it in the vCard photo', near(dark.photo.corner, [255, 255, 255]), JSON.stringify(dark.photo.corner));
    ok('a one-colour logo is traced: a drawing in the card\'s ink colour, trimmed to the lettering, and the toast says so', dark.traced && dark.fill === dark.ink && dark.display.w <= 160 && dark.display.w / dark.display.h > 3 && /traced in the card's ink colour/.test(dark.toast), JSON.stringify(dark));
    ok('wide logo gets the strip across the card, not the small badge, with no plate', dark.strip && !dark.badge && !dark.plate, JSON.stringify(dark));
    const rainbow = await upload('rainbow', 'rainbow.png');
    ok('a logo of many colours is kept as a picture (PNG with its transparency), and the toast says why', !rainbow.traced && rainbow.display.png && rainbow.display.w < 400 && /kept as is \(it has more than two colours\)/.test(rainbow.toast), JSON.stringify(rainbow));
    ok('mixed-tone transparent logo: no plate', !rainbow.plate, rainbow.plate);
    await p11.click('#paletteDropdownBtn'); await p11.click('#paletteListContainer [data-theme="sage"]');
    const pastel = await upload('pastel', 'pastel.png');
    ok('a light picture on a light card (Sage) gets a plate in the accent colour; dark slate behind it in the vCard photo', !pastel.traced && pastel.plate === 'rgb(63, 90, 54)' && pastel.photo.corner.every(v => v < 80), JSON.stringify({ plate: pastel.plate, corner: pastel.photo.corner }));
    await p11.click('#paletteDropdownBtn'); await p11.click('#paletteListContainer [data-theme="twilight"]');
    ok('on a dark card (Twilight) the same light picture needs no plate', (await p11.$eval('#previewLogoStrip', s => s.firstElementChild.style.background)) === '');
    const opaque = await upload('opaque', 'banner.png');
    ok('opaque logo is extended with its own edge colour in the vCard photo', near(opaque.photo.corner, [204, 0, 0], 50), JSON.stringify(opaque.photo.corner));
    ok('opaque banner: the one-colour lettering is traced, no plate', opaque.traced && !opaque.plate && opaque.display.w / opaque.display.h > 3, JSON.stringify(opaque));
    const whitebg = await upload('whitebg', 'scan.jpg');
    ok('a JPEG on white: the white is removed, then the logo is traced; the toast says both', whitebg.traced && /white background removed, traced/.test(whitebg.toast) && near(whitebg.photo.corner, [255, 255, 255]), JSON.stringify({ toast: whitebg.toast, traced: whitebg.traced }));
    const rough = await upload('whitebg-rough', 'scan-rough.jpg');
    ok('a heavily compressed JPEG of a one-colour logo on white is still traced (its solid ink is not taken for a third colour)', rough.traced && /white background removed, traced/.test(rough.toast), JSON.stringify({ toast: rough.toast, traced: rough.traced }));
    const whiteColour = await upload('whitebg-colour', 'scan-colour.jpg');
    ok('a colour JPEG on white: the white is removed and the picture kept with transparency (PNG), toast says both', !whiteColour.traced && whiteColour.display.png && /white background removed, kept as is/.test(whiteColour.toast), JSON.stringify({ toast: whiteColour.toast, display: whiteColour.display }));
    const svg = await upload('svg', 'logo.svg');
    ok('SVG logo is accepted and converted', svg.photo.w === 256 && near(svg.photo.corner, [255, 255, 255]) && svg.strip && svg.traced, JSON.stringify(svg));
    const viewbox = await upload('viewbox', 'viewbox.svg');
    ok('SVG with only a viewBox keeps its wide shape (not squashed square)', viewbox.strip && viewbox.display.w / viewbox.display.h > 3 && near(viewbox.photo.band, [255, 255, 255]), JSON.stringify(viewbox));
    const round = await upload('round', 'round.png');
    ok('small logo in a wide margin: trimmed, traced, stays in the badge', !round.strip && round.badge && round.traced && Math.abs(round.display.w - round.display.h) <= 2, JSON.stringify(round));
    // Print: the strip does not fit on a 2 in card, so the printed card shows the logo in the badge, with every line in.
    await upload('dark', 'logo.png');
    await p11.fill('#street', '745 Fifth Avenue'); await p11.fill('#city', 'New York');
    await p11.evaluate(() => { window.print = () => {}; });
    await p11.click('#printCardBtn'); await p11.click('#printBwBtn');
    await p11.emulateMedia({ media: 'print' });
    const printed = await p11.evaluate(() => {
      const card = document.querySelector('#printSheet .print-card'), r = card.getBoundingClientRect();
      const strip = card.querySelector('.basis-full'), badgeImg = [...card.querySelectorAll('img, svg')].find(i => i.getBoundingClientRect().height > 0);
      const bottoms = [...card.querySelectorAll('p,h3')].map(e => e.getBoundingClientRect().bottom - r.top);
      return { stripShown: !!strip && getComputedStyle(strip).display !== 'none', badge: !!badgeImg && Math.round(badgeImg.getBoundingClientRect().height), last: Math.round(Math.max(...bottoms)), h: Math.round(r.height) };
    });
    await p11.emulateMedia({ media: 'screen' });
    ok('printed card: logo in the badge, no strip, every line inside the card', !printed.stripShown && printed.badge > 0 && printed.last <= printed.h, JSON.stringify(printed));
    const [dl11] = await Promise.all([p11.waitForEvent('download'), p11.click('#downloadVcfBtn')]);
    const vcf11 = fs.readFileSync(await dl11.path(), 'utf8');
    ok('.vcf carries the logo as a JPEG photo', /\r\nPHOTO;TYPE=JPEG;ENCODING=b:\/9j\//.test(vcf11) && !vcf11.includes('svg') && !vcf11.includes('image/png'), vcf11.slice(vcf11.indexOf('PHOTO'), vcf11.indexOf('PHOTO') + 40));
    // Typeface and side are part of the card's look: Clear goes back to Sans and the front; Undo brings the typeface back.
    await p11.selectOption('#cardFontSelect', 'font-serif');
    await p11.click('#flipCardBtn'); await settled(p11);
    await p11.click('#clearFormBtn');
    const cleared = await p11.evaluate(() => ({ font: document.getElementById('cardFontSelect').value, serif: document.getElementById('cardFront').classList.contains('font-serif'), flip: document.getElementById('card3DFlipper').style.transform, logo: !!document.querySelector('#previewLogoStrip img, #previewLogoStrip svg') }));
    ok('Clear form: Sans typeface, front side up, no logo', cleared.font === 'font-sans' && !cleared.serif && cleared.flip === 'rotateY(0deg)' && !cleared.logo, JSON.stringify(cleared));
    await p11.click('#toastAction');
    await p11.waitForTimeout(300);
    const undone = await p11.evaluate(() => ({ font: document.getElementById('cardFontSelect').value, back: document.getElementById('cardBack').classList.contains('font-serif'), logo: !!document.querySelector('#previewLogoStrip img, #previewLogoStrip svg') }));
    ok('Undo brings back the typeface and the logo strip', undone.font === 'font-serif' && undone.back && undone.logo, JSON.stringify(undone));
    ok('round 3: no page errors', errors11.length === 0, errors11.join(' | '));
    await ctx11.close();
  }

  // Make it cute (MOD05, raven575 2026-10-21): the "Unknown" tray takes the scan lines nothing claimed (F4, video review #53,
  // both editions); the pigeonhole tabs (F1) and the FILED stamp (F2) are branded only.
  await rerunIfPageCrashed('Fields make it cute (F4 tray)', async () => {
    const ctxU = await browser.newContext();
    const pU = await ctxU.newPage();
    const errorsU = [];
    pU.on('pageerror', e => errorsU.push(e.message));
    await pU.goto(ORIGIN); await pU.waitForTimeout(300);
    const tabs = await pU.$$eval('#fieldsForm .fields-slot:not(.fields-hole)', ts => ts.map(t => t.dataset.slot + (t.getAttribute('aria-hidden') === 'true' ? '' : '!')));
    const stamp = await pU.$('#fieldsDoneBtn .fields-stamp');
    if (EDITION_PLAIN) ok('plain edition: no pigeonhole tabs and no FILED stamp; the button still reads "Everything\'s correct"', tabs.length === 0 && !stamp && (await pU.textContent('#fieldsDoneBtn')).trim() === "Everything's correct", JSON.stringify(tabs));
    else {
      ok('F1: every box group carries a pigeonhole tab, hidden from screen readers (8 kinds, 14 tabs)', tabs.length === 14 && new Set(tabs).size === 8 && tabs.every(t => !t.endsWith('!'))
        && (await pU.textContent('#fieldsForm label:has(#firstName) .field-label')).trim() === 'First name', JSON.stringify(tabs));
      ok('F2: the FILED stamp sits on the green button, hidden from screen readers, and the label reads as before', (await pU.$eval('#fieldsDoneBtn .fields-stamp', s => s.textContent === 'FILED' && s.getAttribute('aria-hidden') === 'true'))
        && (await pU.$eval('#fieldsDoneBtn', b => b.querySelector('span:not(.fields-stamp)').textContent)) === "Everything's correct");
      await pU.click('#navFields'); await pU.waitForTimeout(600);
      await pU.dispatchEvent('#fieldsDoneBtn', 'pointerdown');
      const pressed = await pU.$eval('#fieldsDoneBtn', b => b.classList.contains('is-stamping') && getComputedStyle(b.querySelector('.fields-stamp')).animationName);
      const pressEnded = await pU.waitForFunction(() => !document.getElementById('fieldsDoneBtn').classList.contains('is-stamping'), null, { timeout: 3000 }).then(() => true, () => false);
      await pU.emulateMedia({ reducedMotion: 'reduce' });
      await pU.dispatchEvent('#fieldsDoneBtn', 'pointerdown');
      const stillUnderReduce = !(await pU.$eval('#fieldsDoneBtn', b => b.classList.contains('is-stamping')));
      await pU.emulateMedia({ reducedMotion: 'no-preference' });
      ok('F2: a press gives one stamp press that ends by itself; under reduce motion nothing moves', pressed === 'fields-stamp' && pressEnded && stillUnderReduce, JSON.stringify({ pressed, pressEnded, stillUnderReduce }));
    }
    ok('F4: the tray is hidden while there is nothing unplaced', await pU.$eval('#fieldsUnknown', t => t.classList.contains('hidden')));
    await pU.setInputFiles('#imageUpload', await renderCardImage(pU)); await pU.waitForTimeout(300);
    await pU.click('#runOcrBtn');
    await readEnds(pU);
    // Two lines set to Ignore in the review step, as a line the reader could not place would be
    const lineIndex = (text) => pU.$$eval('#ocrLines input[id^="ocrLineText"]', (ins, text) => ins.findIndex(i => i.value.includes(text)), text);
    const iTitle = await lineIndex('Director'), iOrg = await lineIndex('Northwind Systems');
    await pU.selectOption(`#ocrLineRole${iTitle}`, 'ignore'); await pU.selectOption(`#ocrLineRole${iOrg}`, 'ignore');
    await proceed(pU);
    const trayLines = () => pU.$$eval('#fieldsUnknownList .fields-unknown-line', ls => ls.map(l => l.textContent));
    const listed = await trayLines();
    ok('F4: the lines nothing claimed wait in the "Unknown: tap to file" tray instead of being dropped', iTitle >= 0 && iOrg >= 0 && await pU.isVisible('#fieldsUnknown')
      && listed.includes('Director of Engineering') && listed.includes('Northwind Systems') && (await pU.inputValue('#jobTitle')) === ''
      && (await pU.textContent('#fieldsUnknownTitle')).trim() === 'Unknown: tap to file', JSON.stringify(listed));
    ok(EDITION_PLAIN ? 'plain edition: the tray has no pigeonhole art' : 'F4: the tray title carries the empty pigeonhole', EDITION_PLAIN ? !(await pU.$('#fieldsUnknown .fields-hole')) : !!(await pU.$('#fieldsUnknown .fields-hole[aria-hidden="true"] svg')));
    const titleLine = pU.locator('#fieldsUnknownList .fields-unknown-line', { hasText: 'Director of Engineering' });
    await pU.waitForFunction(() => !document.getElementById('fieldsForm').classList.contains('is-popping'), null, { timeout: 3000 }).catch(() => {});   // measured at rest, not mid-pop
    const lineBox = await titleLine.boundingBox();
    await titleLine.click();
    ok('F4: tapping a line picks it (pressed, with a dot) and says what to do next', (await titleLine.getAttribute('aria-pressed')) === 'true'
      && (await pU.textContent('#fieldsUnknownHelp')).includes('Now tap the box for "Director of Engineering"') && lineBox.height >= 44, JSON.stringify(lineBox));
    await pU.click('#jobTitle');
    ok('F4: tapping a box files the line there, the card shows it, and the line leaves the tray', (await pU.inputValue('#jobTitle')) === 'Director of Engineering'
      && (await pU.textContent('#previewTitle')) === 'Director of Engineering' && !(await trayLines()).includes('Director of Engineering')
      && (await pU.textContent('#fieldsUnknownHelp')).trim() === 'Filed in Job title.', await pU.textContent('#fieldsUnknownHelp'));
    // Keyboard: pick a line, then Enter in a box files it there (Notes is a text area: a click files into it)
    const orgLine = pU.locator('#fieldsUnknownList .fields-unknown-line', { hasText: 'Northwind Systems' });
    await orgLine.click(); await pU.keyboard.press('Escape');
    ok('F4: Escape puts a picked line back', (await orgLine.getAttribute('aria-pressed')) === 'false');
    await orgLine.click(); await pU.focus('#nickname'); await pU.keyboard.press('Enter');
    ok('F4: Enter in a box files the picked line there', (await pU.inputValue('#nickname')) === 'Northwind Systems' && !(await trayLines()).includes('Northwind Systems'));
    await pU.fill('#nickname', '');
    // Leave out: every line still in the tray goes, then the tray hides
    for (const n of await trayLines()) await pU.click(`#fieldsUnknownList [aria-label="Leave out: ${n}"]`);
    ok('F4: Leave out drops a line; an empty tray hides', (await trayLines()).length === 0 && await pU.$eval('#fieldsUnknown', t => t.classList.contains('hidden')));
    // The scan's Undo goes back to the lines and empties the tray; Proceed again refills it
    await pU.click('#reopenScanBtn');
    await proceed(pU);
    ok('F4: proceeding again refills the tray from the lines', (await trayLines()).includes('Northwind Systems'));
    await pU.click('#toastAction');
    ok('F4: the scan\'s Undo empties the tray', (await trayLines()).length === 0 && await pU.$eval('#fieldsUnknown', t => t.classList.contains('hidden')));
    ok('make it cute: no page errors', errorsU.length === 0, errorsU.join(' | '));
    await ctxU.close();
  });

  // A scan filled into a sample preset replaces the sample as a whole (none of its phones, fax or links are left);
  // Undo brings the sample back, and a second fill replaces it again.
  await rerunIfPageCrashed('sample then scan', async () => {
    const ctxS = await browser.newContext();
    const pS = await ctxS.newPage();
    const errorsS = [];
    pS.on('pageerror', e => errorsS.push(e.message));
    await pS.goto(ORIGIN); await pS.waitForTimeout(300);
    await pS.selectOption('#fakeContactSelect', '4');   // Pidge (plain: Priya Nair): mobile, work and fax numbers
    ok('sample loaded with three phones', (await rows(pS, 'phone')).length === 3 && (await pS.inputValue('#firstName')) === samples()[4][0]);
    await pS.setInputFiles('#imageUpload', await renderCardImage(pS)); await pS.waitForTimeout(300);
    await pS.click('#runOcrBtn');
    await readEnds(pS);
    await proceed(pS);
    const card = async () => ({ first: await pS.inputValue('#firstName'), middle: await pS.inputValue('#middleName'), suffix: await pS.inputValue('#nameSuffix'),
      unit: await pS.inputValue('#unitNumber'), phones: await rows(pS, 'phone'), front: await pS.$$eval('#previewPhones .card-line-value', els => els.map(e => e.textContent).join('|')) });
    const filled = await card();
    ok('scan into a sample: the sample is replaced, nothing of it left', filled.first === 'Maria' && !filled.middle && !filled.suffix && !filled.unit
      && filled.phones.length === 1 && filled.phones[0].value === '+1 (312) 555-0147' && filled.front === '+1 (312) 555-0147', JSON.stringify(filled));
    await pS.click('#toastAction');
    ok('Undo brings the sample back', (await pS.inputValue('#firstName')) === samples()[4][0] && (await rows(pS, 'phone')).length === 3);
    await pS.click('#reopenScanBtn');
    await proceed(pS);
    const again = await card();
    ok('filling the sample again replaces it again', again.first === 'Maria' && again.phones.length === 1, JSON.stringify(again));
    ok('sample then scan: no page errors', errorsS.length === 0, errorsS.join(' | '));
    await ctxS.close();
  });

  // Fields card (MOD05, redesign step 7): the "Sample vCGE pilot contact" list, the pop-in on arrival, "Everything's correct"
  {
    const ctxF = await browser.newContext();
    const pF = await ctxF.newPage();
    const errorsF = [];
    pF.on('pageerror', e => errorsF.push(e.message));
    pF.on('console', m => { if (m.type() === 'error') errorsF.push('console: ' + m.text()); });
    await pF.goto(ORIGIN); await pF.waitForTimeout(300);
    const pops = () => pF.$eval('#fieldsForm', f => Number(f.dataset.pops || 0));
    const card = () => pF.evaluate(() => document.documentElement.dataset.card);
    ok(EDITION_PLAIN ? 'plain edition: the list reads "Sample contact" and names each person with their company' : 'fields: the list reads "Sample vCGE pilot contact" and names each pilot with their animal (video review #61)',
      (await pF.$$eval('#fakeContactSelect option', os => os.map(o => o.textContent).join('|'))) === sampleList()
      && (await pF.getAttribute('#fakeContactSelect', 'aria-label')) === samplePrompt()
      && (await pF.$eval('#fakeContactSelect', s => s.value)) === '' && !(await pF.$('#presetButtonsContainer')), await pF.$$eval('#fakeContactSelect option', os => os.map(o => o.textContent).join('|')));
    ok('fields: nothing has popped yet (the Welcome START lands on Capture)', (await pops()) === 0);
    // A header icon is a move of the deck's own: the form pops on arrival (a swipe, below, does not)
    await pF.click('#navFields'); await pF.waitForTimeout(600);
    ok('fields: arriving by the header icon pops the form in', (await pops()) === 1 && (await card()) === 'fields', String(await pops()));
    await pF.evaluate(() => {
      window.__pop = { names: [], steps: null };
      const f = document.getElementById('fieldsForm');
      new MutationObserver(() => { const cs = getComputedStyle(f); if (f.classList.contains('is-popping')) { window.__pop.names.push(cs.animationName); window.__pop.steps = cs.animationTimingFunction; window.__pop.ms = cs.animationDuration; } })
        .observe(f, { attributes: true, attributeFilter: ['class'] });
    });
    await pF.selectOption('#fakeContactSelect', '2');
    await pF.waitForTimeout(500);
    const pop = await pF.evaluate(() => window.__pop);
    ok('fields: choosing a sample fills the form, pops it in (one animation, 8 steps over 0.32 s), offers Undo, and the list reads the prompt again',
      (await pF.inputValue('#firstName')) === samples()[2][0] && (await pF.inputValue('#organization')) === samples()[2][2] && (await pops()) === 2 && pop.names.includes('fields-pop') && pop.steps === 'steps(8)' && pop.ms === '0.32s'
      && await pF.isVisible('#toastAction') && (await pF.$eval('#fakeContactSelect', s => s.value)) === '' && (await card()) === 'fields', JSON.stringify({ pop, pops: await pops(), card: await card() }));
    ok('fields: the list and the green button are at least 44 px tall; the button reads "Everything\'s correct" (its name for screen readers too; the FILED stamp is hidden from them) with the tick icon', (await pF.$$eval('#fakeContactSelect, #fieldsDoneBtn', els => els.map(e => e.getBoundingClientRect().height))).every(h => h >= 44)
      && (await pF.$eval('#fieldsDoneBtn', b => b.querySelector(':scope > span:not(.fields-stamp)').textContent)) === "Everything's correct"
      && (await pF.getByRole('button', { name: "Everything's correct", exact: true }).count()) === 1 && !!(await pF.$('#fieldsDoneBtn svg use[href$="#circle-check"]')), JSON.stringify(await pF.$$eval('#fakeContactSelect, #fieldsDoneBtn', els => els.map(e => e.getBoundingClientRect().height))));
    // The class goes on animationend, which a slow phone engine on CI can deliver well after 0.32 s: wait for it (3 s cap)
    const popEnded = await pF.waitForFunction(() => !document.getElementById('fieldsForm').classList.contains('is-popping'), null, { timeout: 3000 }).then(() => true, () => false);
    ok('fields: the pop class is gone once the animation ends', popEnded && !(await pF.$eval('#fieldsForm', f => f.classList.contains('is-popping'))));
    // A swipe is not a move of the deck's own: the form was in view the whole way, so it does not pop
    await pF.evaluate(() => document.getElementById('cardRead').scrollIntoView({ inline: 'center', block: 'nearest' })); await pF.waitForTimeout(400);
    await pF.evaluate(() => document.getElementById('cardFields').scrollIntoView({ inline: 'center', block: 'nearest' })); await pF.waitForTimeout(400);
    ok('fields: arriving by a swipe does not pop (no flash of a form that was already in view)', (await pops()) === 2 && (await card()) === 'fields', String(await pops()) + ' ' + (await card()));
    // "Everything's correct": the details go on to the 3D Card (the padlock hand-off follows the deck's signal)
    const footSides = () => pF.evaluate(() => { const c = document.getElementById('cardFields').getBoundingClientRect(), t = document.querySelector('#cardFields .vcge-trash').getBoundingClientRect(), b = document.getElementById('fieldsDoneBtn').getBoundingClientRect();
      const side = (r) => (r.left + r.width / 2 > c.left + c.width / 2 ? 'right' : 'left'); return { trash: side(t), ok: side(b), okBottom: b.bottom <= c.bottom + 1 && b.top > c.top + c.height / 2 }; });
    const sidesRight = await footSides();
    await pF.click('#fieldsDoneBtn'); await pF.waitForTimeout(700);
    ok('fields: "Everything\'s correct" sits lower right (the trash lower left) and moves on to the 3D Card with the details on it',
      sidesRight.ok === 'right' && sidesRight.trash === 'left' && sidesRight.okBottom && (await card()) === 'card' && (await pF.textContent('#previewFullName')) === `${samples()[2][0]} ${samples()[2][1]}` && await pF.isVisible('#vaultHandoff[data-playing]').catch(() => true),
      JSON.stringify({ sidesRight, card: await card() }));
    await pF.click('#navSettings'); await pF.click('#handLeftBtn'); await pF.keyboard.press('Escape'); await pF.waitForTimeout(200);
    await pF.click('#navFields'); await pF.waitForTimeout(600);
    const sidesLeft = await footSides();
    ok('fields: left hand puts "Everything\'s correct" lower left and the trash lower right', sidesLeft.ok === 'left' && sidesLeft.trash === 'right', JSON.stringify(sidesLeft));
    await pF.click('#navSettings'); await pF.click('#handRightBtn'); await pF.click('#cbToggle'); await pF.keyboard.press('Escape'); await pF.waitForTimeout(200);
    ok('fields: colour-blind mode turns the green button blue', (await pF.$eval('#fieldsDoneBtn', b => getComputedStyle(b).backgroundColor)) === 'rgb(37, 99, 235)');
    await pF.click('#navSettings'); await pF.click('#cbToggle'); await pF.keyboard.press('Escape');
    // Reduce motion: the arrival counts, nothing moves
    await pF.emulateMedia({ reducedMotion: 'reduce' });
    const before = await pops();
    await pF.selectOption('#fakeContactSelect', '0'); await pF.waitForTimeout(300);
    ok('fields: under reduce motion a sample is simply there (no pop class), the arrival still counted', (await pops()) === before + 1 && !(await pF.$eval('#fieldsForm', f => f.classList.contains('is-popping'))) && (await pF.inputValue('#firstName')) === samples()[0][0], String(await pops()));
    // Phone style (video review #71): the format list and the +1 switch restyle every number on the card at once,
    // and a number typed afterwards follows the style. Memory only: nothing about it is saved.
    await pF.emulateMedia({ reducedMotion: 'no-preference' });
    ok('fields: the phone style list offers the three styles raven575 named, +1 on by default', (await pF.$$eval('#phoneFormatSelect option', os => os.map(o => o.textContent).join('|'))) === '(269) 492-7400|269.492.7400|2694927400'
      && (await pF.$eval('#phoneCountryCode', c => c.checked)) && (await pF.inputValue('#phoneValue0')) === '+1 (202) 555-0101', await pF.inputValue('#phoneValue0'));
    await pF.selectOption('#phoneFormatSelect', 'dots');
    ok('fields: choosing dots restyles every number', JSON.stringify((await rows(pF, 'phone')).map(r => r.value)) === JSON.stringify(['+1 202.555.0101', '+1 202.555.0111']), JSON.stringify(await rows(pF, 'phone')));
    await pF.click('#phoneCountryCode');
    ok('fields: turning +1 off drops the country code from every number, and the card shows the same', JSON.stringify((await rows(pF, 'phone')).map(r => r.value)) === JSON.stringify(['202.555.0101', '202.555.0111'])
      && (await pF.textContent('#previewPhones')).includes('202.555.0101'), JSON.stringify(await rows(pF, 'phone')));
    await pF.click('#addPhoneBtn'); await pF.fill('#phoneValue2', '(616) 555 0199'); await pF.press('#phoneValue2', 'Tab');
    ok('fields: a number typed afterwards follows the style', (await pF.inputValue('#phoneValue2')) === '616.555.0199', await pF.inputValue('#phoneValue2'));
    await pF.selectOption('#phoneFormatSelect', 'paren'); await pF.click('#phoneCountryCode');
    ok('fields: back to the first style, the numbers read as before', (await pF.inputValue('#phoneValue0')) === '+1 (202) 555-0101' && (await pF.inputValue('#phoneValue2')) === '+1 (616) 555-0199');
    ok('fields: the phone style is not saved anywhere', !(await pF.evaluate(() => JSON.stringify(Object.assign({}, localStorage)))).includes('dots'));
    // Reddit is a website type; a pasted Facebook profile link is typed as Facebook (video review #66)
    await pF.click('#addWebsiteBtn');
    const lastSite = (await rows(pF, 'website')).length - 1;
    ok('fields: Reddit is offered as a website type', (await pF.$$eval(`#websiteType${lastSite} option`, os => os.map(o => o.textContent))).includes('Reddit'));
    await pF.fill(`#websiteValue${lastSite}`, 'https://www.facebook.com/profile.php?id=100012345'); await pF.press(`#websiteValue${lastSite}`, 'Tab');
    ok('fields: a pasted Facebook profile link is typed Facebook', (await pF.inputValue(`#websiteType${lastSite}`)) === 'facebook');
    // Categories box (raven575, 2026-10-18): typed by the person, carried in the .vcf and the QR, wiped with the card
    await pF.fill('#categories', 'Client, Plumber, client');
    await pF.waitForTimeout(200);
    const catVcf = process.env.SERVE_DIR ? '' : await pF.evaluate(async () => (await import('/src/modules/mod08-egress/egressController.js')).egressController.currentVCard);
    const catQr = await decodeQr(pF);
    ok('fields: there is a Categories box under Notes with a hint', await pF.isVisible('#categories') && (await pF.textContent('#categoriesHint')).includes('commas'));
    ok('fields: the categories go into the .vcf and the QR as one CATEGORIES line, repeats dropped', /CATEGORIES:Client,Plumber\r?\n/.test(catQr || '') && (process.env.SERVE_DIR || /CATEGORIES:Client,Plumber\r\n/.test(catVcf)), String(catQr).slice(-160));
    await pF.click('#clearFormBtn');
    ok('fields: Clear form empties the Categories box', (await pF.inputValue('#categories')) === '');
    ok('fields: no page errors', errorsF.length === 0, errorsF.join(' | '));
    await ctxF.close();
  }

  // Video review #62: on an iPad in portrait the Fields card's green button and trash are on the screen, below a
  // long form, with the timer strip showing. iOS sizes 100vh to the page with the browser bars tucked away, so the
  // page's height must come from 100dvh (checked in the stylesheet: desktop Chromium has no such gap to measure).
  {
    const ctxN = await browser.newContext({ viewport: { width: 820, height: 1180 }, hasTouch: true });
    const pN = await ctxN.newPage();
    await pN.goto(ORIGIN); await pN.waitForTimeout(300);
    await pN.click('#navFields'); await pN.waitForTimeout(600);
    await pN.selectOption('#fakeContactSelect', '3'); await pN.click('#notes');
    await pN.waitForFunction(() => !document.getElementById('vaultTimerStrip').classList.contains('hidden'), null, { timeout: 3000 });
    const inView = await pN.evaluate(() => {
      const h = window.innerHeight, r = (sel) => document.querySelector(sel).getBoundingClientRect();
      return { h, strip: !document.getElementById('vaultTimerStrip').classList.contains('hidden'), ok: r('#fieldsDoneBtn').bottom, trash: r('#cardFields .vcge-trash').bottom, deck: r('#deck').bottom, scrolls: document.querySelector('#cardFields .deck-card-body').scrollHeight > document.querySelector('#cardFields .deck-card-body').clientHeight };
    });
    ok('#62: iPad portrait, long form: "Everything\'s correct" and the trash are on the screen', inView.strip && inView.scrolls && inView.ok <= inView.h && inView.trash <= inView.h && inView.deck <= inView.h + 0.5, JSON.stringify(inView));
    const heightRule = await pN.evaluate(() => [...document.styleSheets].flatMap(sh => { try { return [...sh.cssRules]; } catch (e) { return []; } })
      .filter(r => r.selectorText === 'body.h-screen').map(r => r.style.height).join());
    ok('#62: the page height is the height in view (100dvh), not 100vh', heightRule === '100dvh' && (await pN.evaluate(() => Math.round(document.body.getBoundingClientRect().height) === window.innerHeight)), heightRule);
    await pN.click('#fieldsDoneBtn'); await pN.waitForTimeout(700);
    ok('#62: the button is tappable there and moves on to the 3D Card', (await pN.evaluate(() => document.documentElement.dataset.card)) === 'card');
    await ctxN.close();
  }

  // Tester feedback round 1: Undo after a sample / clear / scan fill, reopen the last scan, readable SMS and email, one-page print
  await rerunIfPageCrashed('tester round 1', async () => {
    const ctx9 = await newContext();
    const p9 = await ctx9.newPage();
    const errors9 = [];
    p9.on('pageerror', e => errors9.push(e.message));
    p9.on('console', m => { if (m.type() === 'error') errors9.push('console: ' + m.text()); });
    await p9.goto(ORIGIN); await p9.waitForTimeout(300);
    await p9.fill('#firstName', 'Typed'); await p9.fill('#emailValue0', 'typed@example.com');
    await p9.selectOption('#fakeContactSelect', '0');
    ok('sample preset replaces the form and offers Undo', (await p9.inputValue('#firstName')) !== 'Typed' && await p9.isVisible('#toastAction') && (await p9.textContent('#toastAction')).trim() === 'Undo');
    await p9.click('#toastAction');
    ok('Undo brings the typed card back', (await p9.inputValue('#firstName')) === 'Typed' && (await p9.inputValue('#emailValue0')) === 'typed@example.com' && (await p9.textContent('#toastMessage')).includes('Undone'));
    await p9.click('#clearFormBtn');
    ok('Clear form empties the form, with Undo', (await p9.inputValue('#firstName')) === '' && await p9.isVisible('#toastAction'));
    await p9.click('#toastAction');
    ok('Undo after Clear form restores it', (await p9.inputValue('#firstName')) === 'Typed');

    // Scan, fill, then reopen the last scan without new OCR
    ok('no "Reopen last scan" before a scan', !(await p9.isVisible('#reopenScanBtn')));
    await p9.setInputFiles('#imageUpload', await renderCardImage(p9)); await p9.waitForTimeout(300);
    await p9.click('#runOcrBtn');
    await readEnds(p9);
    await proceed(p9);
    ok('Fill form offers Undo and "Reopen last scan"', (await p9.inputValue('#firstName')) === 'Maria' && await p9.isVisible('#toastAction') && await p9.isVisible('#reopenScanBtn'));
    await p9.click('#toastAction'); await p9.waitForTimeout(600);
    ok('Undo after Fill form restores the card from before the scan', (await p9.inputValue('#firstName')) === 'Typed');
    // Video review #59, #60: Undo never ends on an empty form: it reopens the scan's lines on the Read card, as edited
    ok('Undo after Fill form reopens the lines on the Read card, nothing lost, no new OCR', (await p9.evaluate(() => document.documentElement.dataset.card)) === 'read' && await p9.isVisible('#ocrStepText')
      && (await p9.$$('#ocrLines select')).length >= 8 && (await p9.textContent('#ocrSummary')).includes('maria.gonzalez@northwind.com') && (await p9.textContent('#toastMessage')).includes('Back to the lines'), await p9.textContent('#toastMessage'));
    await proceed(p9);
    ok('...and Proceed fills the form again from those lines', (await p9.inputValue('#firstName')) === 'Maria');
    await p9.click('#reopenScanBtn');
    ok('Reopen last scan shows the review step again (no OCR run)', await p9.isVisible('#ocrStepText') && (await p9.$$('#ocrLines select')).length >= 8 && (await p9.textContent('#ocrSummary')).includes('maria.gonzalez@northwind.com'));
    await proceed(p9);
    ok('reopened scan fills the form again', (await p9.inputValue('#firstName')) === 'Maria' && (await rowValue(p9, 'email', 'work')) === 'maria.gonzalez@northwind.com');

    // SMS and email carry a readable summary (source tree only: the module instance is imported directly)
    if (!process.env.SERVE_DIR) {
      const urls = await p9.evaluate(async () => {
        const { egressController } = await import('/src/modules/mod08-egress/egressController.js');
        const sent = [];
        egressController.navigate = (url) => sent.push(url);
        egressController.triggerSmsShare();
        await egressController.triggerEmailShare();
        return sent.map(u => decodeURIComponent(u));
      });
      const sms = urls[0] || '', mail = urls[1] || '';
      ok('SMS carries every detail as readable lines', sms.startsWith('sms:?body=Maria Gonzalez\nDirector of Engineering\nNorthwind Systems\nWork phone:  +1 (312) 555-0147\nWork email:  maria.gonzalez@northwind.com\nWork website:  https://northwind.com\nWork address:  233 South Wacker Drive, Chicago, IL 60606, United States'), JSON.stringify(sms));
      ok('email: readable summary plus the vCard text', mail.startsWith('mailto:?subject=Contact: Maria Gonzalez&body=Maria Gonzalez\n') && mail.includes('save the text below as a .vcf file') && mail.includes('BEGIN:VCARD'), JSON.stringify(mail.slice(0, 160)));
    }

    // Print / Save as PDF (step 10): Themed or Black & White, then one 6 x 3.5 in page with the front at business-card size and the QR beside it
    await p9.evaluate(() => { window.print = () => {}; });
    await p9.click('#printCardBtn');
    ok('Print / PDF asks only Themed or Black & White', await p9.isVisible('#printChoiceSheet') && await p9.isVisible('#printThemedBtn') && await p9.isVisible('#printBwBtn') && (await p9.evaluate(() => document.activeElement && document.activeElement.id)) === 'printThemedBtn');
    await p9.keyboard.press('Escape');
    ok('Esc cancels the print choice (a sheet: a swipe would too) and nothing is printed', !(await p9.isVisible('#printChoiceSheet')) && (await p9.evaluate(() => document.getElementById('printSheet').children.length)) === 0);
    await p9.click('#printCardBtn'); await p9.click('#printThemedBtn');
    const printFalcon = await p9.evaluate(() => ({ toast: document.getElementById('toastMessage').textContent, hidden: document.getElementById('toastFalcon').classList.contains('hidden') }));
    ok('Airlock E2: after a print the toast says so and the falcon is on it', printFalcon.toast === 'Sent to the print dialog.' && !printFalcon.hidden, JSON.stringify(printFalcon));
    const sheet = await p9.evaluate(() => {
      const card = document.querySelector('#printSheet .print-card'), flipper = document.getElementById('card3DFlipper');
      return { cards: document.querySelectorAll('#printSheet .print-card').length, qr: !!document.querySelector('#printSheet .print-qr img'), ids: document.querySelectorAll('#printSheet [id]').length,
        text: document.getElementById('printSheet').textContent, themed: card.classList.contains('print-themed'),
        vars: ['--card-bg', '--card-ink', '--card-accent'].map(v => card.style.getPropertyValue(v) === flipper.style.getPropertyValue(v) && card.style.getPropertyValue(v) !== ''), theme: card.dataset.theme === flipper.dataset.theme };
    });
    ok('print sheet holds the front and the QR beside it (no duplicate ids)', sheet.cards === 1 && sheet.qr && sheet.ids === 0 && sheet.text.includes('Maria Gonzalez'), JSON.stringify(sheet));
    ok('themed print copy carries the card\'s theme variables and theme name itself', sheet.themed && sheet.vars.every(Boolean) && sheet.theme, JSON.stringify(sheet));
    await p9.emulateMedia({ media: 'print' });
    const size = await p9.evaluate(() => {
      const c = document.querySelector('#printSheet .print-card'), q = document.querySelector('#printSheet .print-qr img'), r = c.getBoundingClientRect(), qr = q.getBoundingClientRect();
      const leaves = [...c.querySelectorAll('*')].filter(e => !e.children.length && e.textContent.trim() && e.getBoundingClientRect().height > 0);
      const cut = leaves.filter(e => { const b = e.getBoundingClientRect(); return b.bottom > r.bottom + 0.5 || b.right > r.right + 0.5; }).map(e => e.textContent.trim());
      return { cut, card: [Math.round(r.width), Math.round(r.height)], qr: [Math.round(qr.width), Math.round(qr.height)], qrRight: qr.left > r.right, bg: getComputedStyle(c).backgroundColor, ink: getComputedStyle(c).color, cardBg: getComputedStyle(document.getElementById('cardFront')).backgroundColor };
    });
    ok('printed card is 3.5 in wide and at least 2 in tall, with the 1.5 in QR to its right', size.card[0] === 336 && size.card[1] >= 192 && size.qr[0] === 144 && size.qr[1] === 144 && size.qrRight, JSON.stringify(size));
    ok('printed card cuts nothing off: every line sits inside the card (raven575 2026-10-18)', size.cut.length === 0, JSON.stringify(size.cut));
    ok('themed print keeps the card\'s own colours', size.bg === size.cardBg && size.bg !== 'rgb(255, 255, 255)', JSON.stringify(size));
    await p9.emulateMedia({ media: null });
    if (ENGINE !== 'chromium') notRunHere('print is one 6 x 3.5 in page (no blank pages)', 'saving a page as PDF exists only in Chromium');
    else {
      const pdf = (await p9.pdf({ preferCSSPageSize: true, printBackground: true })).toString('latin1');
      const pages = (pdf.match(/\/Type\s*\/Page[^s]/g) || []).length;
      const box = /\/MediaBox\s*\[\s*0\s+0\s+(\d+)\s+(\d+)\s*\]/.exec(pdf);
      ok('print is one 6 x 3.5 in page (no blank pages) and the card is still on the sheet', pages === 1 && box && box[1] === '432' && box[2] === '252' && (await p9.evaluate(() => document.getElementById('printSheet').children.length)) === 2, `${pages} pages, box ${box && box.slice(1)}`);
    }
    await p9.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    ok('print copies stay until the next print (afterprint can fire before the PDF is drawn)', (await p9.evaluate(() => document.getElementById('printSheet').children.length)) === 2);
    await p9.click('#printCardBtn'); await p9.click('#printBwBtn');
    await p9.emulateMedia({ media: 'print' });
    const bw = await p9.evaluate(() => {
      const c = document.querySelector('#printSheet .print-card'), q = document.querySelector('#printSheet .print-qr img');
      return { bg: getComputedStyle(c).backgroundColor, ink: getComputedStyle(c).color, bw: c.classList.contains('print-bw'), src: q.src.slice(0, 21) };
    });
    await p9.emulateMedia({ media: null });
    ok('Black & White print: white card, dark ink, a PNG QR', bw.bw && bw.bg === 'rgb(255, 255, 255)' && bw.ink === 'rgb(15, 23, 42)' && bw.src === 'data:image/png;base64', JSON.stringify(bw));
    // The B&W QR on the sheet is black on white; the themed one above was tinted
    const qrColours = await p9.evaluate(async () => {
      const img = document.querySelector('#printSheet .print-qr img'); await img.decode();
      const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
      const x = c.getContext('2d'); x.drawImage(img, 0, 0); const d = x.getImageData(0, 0, c.width, c.height).data;
      const seen = new Set(); for (let i = 0; i < d.length; i += 4) seen.add(`${d[i]},${d[i + 1]},${d[i + 2]}`); return [...seen];
    });
    ok('Black & White QR is pure black on pure white', qrColours.length === 2 && qrColours.includes('0,0,0') && qrColours.includes('255,255,255'), JSON.stringify(qrColours));
    // A card taller than 2 in (here: larger text) grows instead of clipping, and the page grows with it: still one page
    await p9.evaluate(() => { document.documentElement.style.fontSize = '24px'; });
    await p9.click('#printCardBtn'); await p9.click('#printBwBtn');
    await p9.emulateMedia({ media: 'print' });
    const tall = await p9.evaluate(() => {
      const c = document.querySelector('#printSheet .print-card'), r = c.getBoundingClientRect();
      const cut = [...c.querySelectorAll('*')].filter(e => !e.children.length && e.textContent.trim() && e.getBoundingClientRect().height > 0)
        .filter(e => e.getBoundingClientRect().bottom > r.bottom + 0.5).map(e => e.textContent.trim());
      return { h: Math.round(r.height), sheet: Math.round(document.getElementById('printSheet').getBoundingClientRect().height), cut };
    });
    await p9.emulateMedia({ media: null });
    // The page is as tall as the card needs (sheet plus 0.3 in margins): the controller sets it in every browser
    const setIn = await p9.evaluate(() => Number((/size:\s*6in\s+([\d.]+)in/.exec(document.adoptedStyleSheets.map(sh => [...sh.cssRules].map(r => r.cssText).join(' ')).join(' ')) || [])[1]));
    ok('a tall card grows (nothing cut) and the page is set tall enough to hold it', tall.h > 192 && tall.cut.length === 0 && setIn >= tall.sheet / 96 + 0.6 - 0.01, `${JSON.stringify(tall)} set ${setIn} in`);
    if (ENGINE !== 'chromium') notRunHere('the tall card prints as one taller page, then a normal card on 6 x 3.5 in again', 'saving a page as PDF exists only in Chromium');
    else {
      const tallPdf = (await p9.pdf({ preferCSSPageSize: true, printBackground: true })).toString('latin1');
      const tallPages = (tallPdf.match(/\/Type\s*\/Page[^s]/g) || []).length;
      const tallBox = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(tallPdf);
      const boxIn = tallBox ? Number(tallBox[2]) / 72 : 0;
      ok('the tall card prints as one 6 in wide page of the height the controller set', tallPages === 1 && tallBox && tallBox[1] === '432' && Math.abs(boxIn - setIn) < 0.01, `${tallPages} pages, box ${tallBox && tallBox.slice(1)}, set ${setIn} in`);
    }
    await p9.evaluate(() => { document.documentElement.style.fontSize = ''; });
    await p9.click('#printCardBtn'); await p9.click('#printBwBtn');
    if (ENGINE === 'chromium') {
      const backPdf = (await p9.pdf({ preferCSSPageSize: true, printBackground: true })).toString('latin1');
      ok('a normal card prints on the 6 x 3.5 in page again', (/\/MediaBox\s*\[\s*0\s+0\s+(\d+)\s+(\d+)/.exec(backPdf) || []).slice(1).join() === '432,252');
    }
    // PDF name (raven575 2026-10-18): opt-in each print. Unticked, the title (and so the PDF name) stays the app's;
    // ticked, the title is the contact's file name only until printing ends or the next tap
    const appTitle = await p9.title();
    await p9.click('#printCardBtn');
    const boxOff = await p9.isChecked('#printNameFile');
    await p9.click('#printBwBtn');
    ok('PDF name: the "Name the PDF after the contact" box starts unticked, and unticked the title stays the app\'s', !boxOff && (await p9.title()) === appTitle && appTitle === 'vCard Generator Engine (vCGE)', appTitle);
    await p9.click('#printCardBtn'); await p9.check('#printNameFile'); await p9.click('#printBwBtn');
    const named = await p9.title();
    await p9.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    ok('PDF name: ticked, the title is the contact\'s file name while printing, then goes back on afterprint', named === 'Maria Gonzalez' && (await p9.title()) === appTitle, `${named} / ${await p9.title()}`);
    await p9.click('#printCardBtn');
    const boxAgain = await p9.isChecked('#printNameFile');
    await p9.check('#printNameFile'); await p9.click('#printThemedBtn');
    const namedAgain = await p9.title();
    await p9.mouse.click(5, 5);
    ok('PDF name: the box is unticked again on the next print, and a tap also puts the title back', !boxAgain && namedAgain === 'Maria Gonzalez' && (await p9.title()) === appTitle, `${boxAgain} ${namedAgain} / ${await p9.title()}`);
    ok('tester round 1: no page errors', errors9.length === 0, errors9.join(' | '));
    await ctx9.close();
  });

  // Icons instead of labels: unlabelled numbers typed by their icons, a bare handle next to a social logo
  await rerunIfPageCrashed('icons instead of labels', async () => {
    const ctx7 = await newContext();
    const p7 = await ctx7.newPage();
    await p7.goto(ORIGIN); await p7.waitForTimeout(300);
    const icon = (f) => fs.readFileSync(path.join(ROOT, 'node_modules/@tabler/icons/icons/outline', f), 'utf8').replace(/currentColor/g, '#111');
    const dataUrl = await p7.evaluate(async (rows) => {
      const c = document.createElement('canvas'); c.width = 1050; c.height = 620; const x = c.getContext('2d');
      x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.fillStyle = '#111';
      x.font = 'bold 52px Arial'; x.fillText('Kai Takahashi', 60, 80); x.font = '32px Arial'; x.fillText('Lead Design Architect', 60, 130);
      let y = 210;
      for (const [svg, text] of rows) {
        const img = new Image(); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); await img.decode();
        x.drawImage(img, 60, y - 29, 34, 34); x.font = '30px Arial'; x.fillText(text, 115, y); y += 72;
      }
      return c.toDataURL('image/png');
    }, [[icon('device-mobile.svg'), '206.555.9876'], [icon('phone.svg'), '206.555.3400'], [icon('mail.svg'), 'kai@studiocraft.design'],
        [icon('brand-instagram.svg'), '@studiocraft'], [icon('map-pin.svg'), '1201 3rd Avenue, Seattle, WA 98101']]);
    await p7.setInputFiles('#imageUpload', { name: 'icons.png', mimeType: 'image/png', buffer: Buffer.from(dataUrl.split(',')[1], 'base64') }); await p7.waitForTimeout(300);
    await p7.click('#runOcrBtn');
    await readEnds(p7);
    const chips = await p7.$$eval('#ocrLines [id^="ocrLineIcon"]', c => c.map(x => x.textContent));
    ok('review shows the icons seen in front of lines', chips.includes('Mobile icon') && chips.includes('Instagram logo'), chips.join(', '));
    const summary = await p7.textContent('#ocrSummary');
    ok('icons type unlabelled numbers (Mobile vs Work) in the summary', summary.includes('Phone (Mobile)+1 (206) 555-9876') && summary.includes('Phone (Work)+1 (206) 555-3400'), summary);
    await proceed(p7);
    ok('social logo + handle fills the Instagram profile link', (await rowValue(p7, 'website', 'instagram')) === 'https://instagram.com/studiocraft', JSON.stringify(await rows(p7, 'website')));
    ok('typed phone rows reach the form', (await rowValue(p7, 'phone', 'mobile')) === '+1 (206) 555-9876' && (await rowValue(p7, 'phone', 'work')) === '+1 (206) 555-3400', JSON.stringify(await rows(p7, 'phone')));
    ok('audit log notes recognised icons', /icons? recognised/.test(await p7.textContent('#auditLog')), await p7.textContent('#auditLog'));
    await ctx7.close();
  });

  // Lines to check: a ZIP code the card's state doesn't use is flagged under its line; editing the line clears the note
  await rerunIfPageCrashed('lines to check', async () => {
    const ctxZ = await browser.newContext();
    const pZ = await ctxZ.newPage();
    await pZ.goto(ORIGIN); await pZ.waitForTimeout(300);
    const dataUrl = await pZ.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 1050; c.height = 600; const x = c.getContext('2d');
      x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.fillStyle = '#111';
      x.font = 'bold 52px Arial'; x.fillText('Nora Lindqvist', 60, 90); x.font = '32px Arial'; x.fillText('General Manager', 60, 145);
      ['7950 Harbor Road', 'Portage, MI 42024', 'nora@harborworks.com', 'T 269.555.0142'].forEach((t, i) => x.fillText(t, 60, 250 + i * 70));
      return c.toDataURL('image/png');
    });
    await pZ.setInputFiles('#imageUpload', { name: 'zip.png', mimeType: 'image/png', buffer: Buffer.from(dataUrl.split(',')[1], 'base64') }); await pZ.waitForTimeout(300);
    await pZ.click('#runOcrBtn');
    await readEnds(pZ);
    const roles = await pZ.$$eval('#ocrLines select', s => s.map(x => x.value));
    const row = roles.indexOf('cityStateZip');
    const note = row >= 0 && await pZ.$(`#ocrLineCheck${row}`);
    ok('a ZIP code the state does not use is flagged under its line', !!note && (await note.textContent()) === '42024 is not a Michigan ZIP code. Please check it.' && (await pZ.getAttribute(`#ocrLineText${row}`, 'aria-describedby')) === `ocrLineCheck${row}`, roles.join());
    const okBox = await pZ.$(`#ocrLineOk${row}`);
    const okRect = okBox && await okBox.boundingBox(), fieldRect = await (await pZ.$(`#ocrLineText${row}`)).boundingBox();
    ok('a flagged line carries a "Looks right" box inside its text field, on the right, vertically centred, 44 px to tap', !!okBox && (await okBox.getAttribute('aria-label')).includes('looks right') && okRect.width >= 44 && okRect.height >= 44
      && okRect.x + okRect.width <= fieldRect.x + fieldRect.width + 1 && okRect.x > fieldRect.x + fieldRect.width / 2 && Math.abs((okRect.y + okRect.height / 2) - (fieldRect.y + fieldRect.height / 2)) < 2, JSON.stringify({ okRect, fieldRect }));
    ok('an unflagged line has no box', !(await pZ.$(`#ocrLineOk${roles.indexOf('name')}`)));
    const lineBefore = await pZ.inputValue(`#ocrLineText${row}`);
    await pZ.evaluate((row) => {
      window.__ok = { green: false, noteWentFirst: null, amberAtNoteFade: null, mark: null };
      const box = document.getElementById(`ocrLineOk${row}`), note = document.getElementById(`ocrLineCheck${row}`), text = document.getElementById(`ocrLineText${row}`);
      new MutationObserver(() => {
        if (box.classList.contains('is-ok') && getComputedStyle(box, '::before').backgroundColor === 'rgb(22, 163, 74)') {
          window.__ok.green = true;
          const mark = getComputedStyle(box, '::before'); window.__ok.mark = { content: mark.content, image: mark.backgroundImage.slice(0, 40) };
        }
        if (note.style.opacity && Number(note.style.opacity) < 1 && window.__ok.noteWentFirst === null) { window.__ok.noteWentFirst = Number(box.style.opacity) > 0; window.__ok.amberAtNoteFade = text.classList.contains('border-amber-500'); }
      }).observe(document.getElementById('ocrLines'), { attributes: true, subtree: true, attributeFilter: ['style', 'class'] });
    }, row);
    await okBox.click();
    await pZ.waitForSelector(`#ocrLineCheck${row}`, { state: 'detached', timeout: 5000 });
    const okSeen = await pZ.evaluate(() => window.__ok);
    ok('ticking Looks right turns the box green, fades the note out a few frames before the box goes, and the field returns to normal with its text unchanged',
      okSeen.green && okSeen.noteWentFirst === true && okSeen.amberAtNoteFade === false && !(await pZ.$(`#ocrLineOk${row}`)) && !(await pZ.getAttribute(`#ocrLineText${row}`, 'aria-describedby'))
      && !(await pZ.$eval(`#ocrLineText${row}`, el => el.classList.contains('border-amber-500'))) && (await pZ.inputValue(`#ocrLineText${row}`)) === lineBefore && (await pZ.textContent('#ocrSummary')).includes('42024'), JSON.stringify(okSeen));
    // Cute round O2 (raven575, 2026-10-21): the tick is a feather check in the branded edition, the plain tick in plain
    ok(EDITION_PLAIN ? 'plain edition: a ticked Looks right box shows the plain tick' : 'a ticked Looks right box shows Glyph\'s feather check, drawn inline (still a check mark, not just a colour)',
      !!okSeen.mark && (EDITION_PLAIN ? okSeen.mark.content === '"\u2713"' && okSeen.mark.image === 'none' : okSeen.mark.content === '""' && okSeen.mark.image.startsWith('url("data:image/svg+xml')), JSON.stringify(okSeen.mark));
    // Editing a flagged line still clears its note at once (a fresh read of the same photo)
    await pZ.click('#ocrBackBtn');
    await pZ.click('#runOcrBtn');
    await readEnds(pZ);
    const row2 = (await pZ.$$eval('#ocrLines select', s => s.map(x => x.value))).indexOf('cityStateZip');
    await pZ.fill(`#ocrLineText${row2}`, 'Portage, MI 49024');
    ok('editing a flagged line clears its note and box at once', !(await pZ.$(`#ocrLineCheck${row2}`)) && !(await pZ.$(`#ocrLineOk${row2}`)) && (await pZ.textContent('#ocrSummary')).includes('49024'));
    await ctxZ.close();
  });

  // Second look (bench run 2026-10-18): a web line leaning backwards was read as "noriinvind.comiSeat\e" and flagged;
  // re-read as a straightened strip it comes back right and sure. Text rendering differs between engines, so the
  // reading itself is checked in Chromium, where it was measured.
  if (ENGINE === 'chromium') {
    const ctxL = await browser.newContext();
    const pL = await ctxL.newPage();
    const looks = [];
    pL.on('console', m => { if (m.text().includes('Second look:')) looks.push(m.text()); });
    await pL.goto(ORIGIN); await pL.waitForTimeout(300);
    const dataUrl = await pL.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 900; c.height = 520; const x = c.getContext('2d');
      x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.fillStyle = '#111';
      x.font = '44px Arial'; x.fillText('Jane Rivera', 40, 70); x.font = '30px Arial'; x.fillText('Studio Manager', 40, 115);
      x.fillText('jane@northwind.com', 40, 200); x.fillText('206.555.0142', 40, 250);
      // Leaning backwards: the top of each letter sits further left than its foot
      x.setTransform(1, 0, 0.3, 1, -0.3 * 330, 0); x.font = '36px Arial'; x.fillText('northwind.com/Seattle', 40, 330);
      return c.toDataURL('image/png');
    });
    await pL.setInputFiles('#imageUpload', { name: 'lean.png', mimeType: 'image/png', buffer: Buffer.from(dataUrl.split(',')[1], 'base64') }); await pL.waitForTimeout(300);
    await pL.click('#runOcrBtn');
    await readEnds(pL);
    const lines = await pL.$$eval('#ocrLines input[id^="ocrLineText"]', els => els.map(e => e.value));
    const row = lines.findIndex(t => t.includes('northwind.com/'));
    ok('second look: a web line leaning backwards is read again straightened, and comes back right without a "please check" note',
      looks.length >= 1 && row >= 0 && lines[row] === 'northwind.com/Seattle' && !(await pL.$(`#ocrLineCheck${row}`)), JSON.stringify({ looks, lines }));
    ok('second look: lines read right the first time are left as they were', lines.includes('Jane Rivera') && lines.some(t => t.endsWith('jane@northwind.com')) && lines.some(t => t.endsWith('206.555.0142')), JSON.stringify(lines));
    await ctxL.close();
  }

  // Cancel while reading: the reader stops, the photo step comes back with Retake, and Extract works again
  await rerunIfPageCrashed('Cancel while reading', async () => {
    const ctxS = await browser.newContext();
    const pS = await ctxS.newPage();
    const errorsS = []; pS.on('pageerror', e => errorsS.push(String(e)));
    await pS.goto(ORIGIN); await pS.waitForTimeout(300);
    // The first reader is held until Cancel is pressed: a fast run once finished reading before the press landed
    // (iPhone build run, 2026-10-19). Extract afterwards gets a fresh, real reader.
    await pS.evaluate(() => { const real = window.Tesseract.createWorker; let first = true;
      window.Tesseract.createWorker = async (...args) => { const w = await real(...args); if (first) { first = false; w.recognize = () => new Promise(() => {}); } return w; }; });
    await pS.setInputFiles('#imageUpload', await renderCardImage(pS)); await pS.waitForTimeout(300);
    await pS.click('#runOcrBtn');
    ok('reading shows the photo under the shimmer with a Cancel button on the Read card, OK held back', await pS.isVisible('#ocrProgress') && (await pS.getAttribute('#ocrReadPhoto', 'src') || '').startsWith('data:image') && await pS.isVisible('#ocrStopBtn') && (await pS.evaluate(() => document.documentElement.dataset.card)) === 'read' && await pS.isDisabled('#runOcrBtn'));
    await pS.click('#ocrStopBtn');
    await pS.waitForSelector('#ocrProgress', { state: 'hidden', timeout: 10000 });
    ok('Cancel drops the photo from the Read card', !(await pS.getAttribute('#ocrReadPhoto', 'src')));
    await pS.waitForFunction(() => document.documentElement.dataset.card === 'capture', null, { timeout: 5000 }).catch(() => {});
    ok('Cancel stops reading and goes back to the photo on the Capture card (Retake or OK again)', (await pS.evaluate(() => document.documentElement.dataset.card)) === 'capture' && await pS.isVisible('#captureReview') && !(await pS.isVisible('#cropReviewModal')) && await pS.isVisible('#retakePhotoBtn') && await pS.isVisible('#runOcrBtn') && !(await pS.isDisabled('#runOcrBtn')),
      JSON.stringify(await pS.evaluate(() => { const v = (id) => { const e = document.getElementById(id); return !!e && !!(e.offsetWidth || e.offsetHeight); };
        return { card: document.documentElement.dataset.card, review: v('captureReview'), crop: v('cropReviewModal'), retake: v('retakePhotoBtn'), run: v('runOcrBtn'), runDisabled: document.getElementById('runOcrBtn').disabled, progress: v('ocrProgress') }; })));
    await pS.click('#runOcrBtn');
    await readEnds(pS);
    ok('after Cancel, Extract reads the photo with a fresh reader', (await pS.$$('#ocrLines select')).length >= 8);
    ok('Cancel while reading: no page errors', errorsS.length === 0, errorsS.join(' | '));
    await ctxS.close();
  });

  // Cancel pressed just as the reader finishes (the wash fills, the review is a moment away) still cancels: it used to
  // be ignored and the review opened anyway (Shutout's local run, 2026-10-19)
  {
    const ctxF = await browser.newContext();
    const pF = await ctxF.newPage();
    await pF.goto(ORIGIN); await pF.waitForTimeout(300);
    await pF.setInputFiles('#imageUpload', await renderCardImage(pF)); await pF.waitForTimeout(300);
    await pF.evaluate(() => { const bar = document.getElementById('ocrProgressBar');
      new MutationObserver((_, o) => { if (bar.getAttribute('aria-valuenow') === '100') { o.disconnect(); window.__pressedAtFull = true; document.getElementById('ocrStopBtn').click(); } })
        .observe(bar, { attributes: true, attributeFilter: ['aria-valuenow'] }); });
    await pF.click('#runOcrBtn');
    await pF.waitForFunction(() => window.__pressedAtFull === true, null, { timeout: 90000 }).catch(() => {});
    await pF.waitForFunction(() => document.documentElement.dataset.card === 'capture', null, { timeout: 5000 }).catch(() => {});
    await pF.waitForTimeout(400);
    ok('Cancel pressed as the reading finishes still cancels: back to the photo with Retake, no review opened', await pF.evaluate(() => window.__pressedAtFull === true)
      && (await pF.evaluate(() => document.documentElement.dataset.card)) === 'capture' && !(await pF.isVisible('#cropReviewModal')) && !(await pF.isVisible('#ocrStepText')) && await pF.isVisible('#retakePhotoBtn'),
      await readStage(pF));
    await ctxF.close();
  }

  // One more photo (raven575, 2026-10-20): a reading without the name asks for another photo; the two readings are put
  // together, and Fix it by hand opens the review with what the first photo got
  await rerunIfPageCrashed('one more photo', async () => {
    const card = (page, lines) => page.evaluate((lines) => {
      const c = document.createElement('canvas'); c.width = 900; c.height = 420; const x = c.getContext('2d');
      x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.fillStyle = '#111';
      lines.forEach(([text, size], i) => { x.font = `${size}px Arial`; x.fillText(text, 40, 80 + i * 90); });
      return { name: 'card.png', mimeType: 'image/png', buffer: c.toDataURL('image/png').split(',')[1] };
    }, lines).then(f => ({ ...f, buffer: Buffer.from(f.buffer, 'base64') }));
    const noName = [['Seattle, WA 98101', 34], ['jane@northwind.com', 34], ['206.555.0142', 34]];
    const ctxM = await browser.newContext();
    const pM = await ctxM.newPage();
    const errorsM = []; pM.on('pageerror', e => errorsM.push(String(e)));
    await pM.goto(ORIGIN); await pM.waitForTimeout(300);
    await pM.setInputFiles('#imageUpload', await card(pM, noName)); await pM.waitForTimeout(300);
    await pM.click('#runOcrBtn');
    await readEnds(pM, '#ocrMorePhotoModal');
    ok('one more photo: a reading with no name asks for another photo, saying what is missing and that it would be photo 2 of 3',
      /but not the name/.test(await pM.textContent('#ocrMorePhotoText')) && (await pM.textContent('#ocrMorePhotoCount')).includes('photo 2 of 3') && await pM.isVisible('#ocrAnotherPhotoBtn') && await pM.isVisible('#ocrFixByHandBtn'),
      await readStage(pM));
    await pM.waitForTimeout(500);   // the owl's eyes settle (0.4 s)
    // The reading box is hidden once the read ends, and a hidden SVG has no transform to read: show it for the measurement
    const owlM = await pM.evaluate(() => { const cs = (sel) => getComputedStyle(document.querySelector(sel)); const more = document.getElementById('ocrMorePhotoOwl');
      const box = document.getElementById('ocrProgress'); box.classList.remove('hidden'); const pupils = cs('#ocrReadOwl .owl-pupils').transform; box.classList.add('hidden');
      return { pupilsShown: pupils, read: cs('#ocrReadOwl').display, more: cs('#ocrMorePhotoOwl').display !== 'none' && more.getBoundingClientRect().width > 0, hidden: [document.getElementById('ocrReadOwl'), more].every(o => o.getAttribute('aria-hidden') === 'true'),
        pupils: cs('#ocrReadOwl .owl-pupils').transform, closed: cs('#ocrReadOwl .owl-closed').display, progress: document.getElementById('ocrProgress').style.getPropertyValue('--read-progress') }; });
    // Cute round O1 and O3 (raven575, 2026-10-21): Glyph the owl reads along and asks for the next photo; never in plain
    ok(EDITION_PLAIN ? 'plain edition: no owl on the Read card or on "One more photo?"' : 'the owl follows the wash to the end and closes its eyes when the read is done; it holds a magnifying glass on "One more photo?"; screen readers skip it',
      EDITION_PLAIN ? owlM.read === 'none' && !owlM.more
        : owlM.read !== 'none' && owlM.more && owlM.hidden && owlM.progress === '1' && owlM.pupilsShown === 'matrix(1, 0, 0, 1, 1.5, 0)' && owlM.closed === 'inline', JSON.stringify(owlM));
    ok('one more photo: the first photo is dropped once read; only its text is held, in OCR\'s vault slot', !(await pM.getAttribute('#reviewImage', 'src')) && !(await pM.evaluate(() => JSON.stringify(localStorage)).then(s => s.includes('northwind'))));
    pM.once('filechooser', () => {});
    await pM.click('#ocrAnotherPhotoBtn');
    await pM.setInputFiles('#imageUpload', await card(pM, [['Jane Rivera', 44], ['jane@northwind.com', 34], ['Seattle, WA 98101', 34]])); await pM.waitForTimeout(300);
    ok('one more photo: the Capture card says this is photo 2 of 3 of the card', await pM.isVisible('#photoCountNote') && (await pM.textContent('#photoCountNote')).startsWith('Photo 2 of 3'));
    const pawDots = await pM.$eval('#photoCountNote', n => ({ photo: n.dataset.photo, of: n.dataset.of, dots: getComputedStyle(n, '::before').content }));
    ok(EDITION_PLAIN ? 'one more photo (plain): no paw dots by the count' : 'one more photo: Iris\'s paw dots show by the count (photo 2 of 3)',
      pawDots.photo === '2' && pawDots.of === '3' && (EDITION_PLAIN ? pawDots.dots === 'none' : pawDots.dots !== 'none'), JSON.stringify(pawDots));
    await pM.click('#runOcrBtn');
    await readEnds(pM);
    const merged = await pM.$$eval('#ocrLines input[id^="ocrLineText"]', els => els.map(e => e.value));
    const roles = await pM.$$eval('#ocrLines select', els => els.map(e => e.value));
    ok('one more photo: the two readings are put together: the name from photo 2, the phone only photo 1 had, each line once',
      merged.includes('Jane Rivera') && roles[merged.indexOf('Jane Rivera')] === 'name' && merged.some(t => t.endsWith('206.555.0142')) && merged.filter(t => t.endsWith('jane@northwind.com')).length === 1,
      JSON.stringify({ merged, roles }));
    ok('one more photo: once the review opens, the held readings are let go and the photo count is gone', !(await pM.isVisible('#photoCountNote')));
    ok('one more photo: no page errors', errorsM.length === 0, errorsM.join(' | '));
    await ctxM.close();

    const ctxH = await browser.newContext();
    const pH = await ctxH.newPage();
    await pH.emulateMedia({ reducedMotion: 'reduce' });
    await pH.goto(ORIGIN); await pH.waitForTimeout(300);
    await pH.setInputFiles('#imageUpload', await card(pH, noName)); await pH.waitForTimeout(300);
    await pH.click('#runOcrBtn');
    await readEnds(pH, '#ocrMorePhotoModal');
    const owlH = await pH.evaluate(() => { const cs = (sel) => getComputedStyle(document.querySelector(sel));
      const box = document.getElementById('ocrProgress'); box.classList.remove('hidden'); const pupils = cs('#ocrReadOwl .owl-pupils').transform; box.classList.add('hidden');
      return { pupils, move: cs('#ocrReadOwl .owl-pupils').transitionDuration, closed: cs('#ocrReadOwl .owl-closed').display, eyes: cs('#ocrReadOwl .owl-eye').display, done: document.getElementById('ocrProgress').classList.contains('is-done') }; });
    ok('reduce motion: the owl is one still picture: its eyes never move or close, even when the read is done', owlH.done && owlH.pupils === 'none' && owlH.move === '0s' && owlH.closed === 'none' && owlH.eyes !== 'none', JSON.stringify(owlH));
    await pH.click('#ocrFixByHandBtn');
    await readEnds(pH);
    const byHand = await pH.$$eval('#ocrLines input[id^="ocrLineText"]', els => els.map(e => e.value));
    ok('Fix it by hand: the review opens with what the photo got, and no second photo is asked for', byHand.some(t => t.endsWith('jane@northwind.com')) && byHand.some(t => t.endsWith('206.555.0142')) && !(await pH.isVisible('#ocrMorePhotoModal')) && !(await pH.isVisible('#photoCountNote')),
      JSON.stringify(byHand));
    await ctxH.close();

    // Between photos only the readings are held (the photo is dropped): that still counts as something to lose, so
    // with a PIN, going out of view locks, and the PIN brings the readings back (Ghost's review, 2026-10-20)
    const ctxK = await browser.newContext();
    const pK = await ctxK.newPage();
    await pK.goto(ORIGIN); await pK.waitForTimeout(300);
    await setPin(pK, '2468');
    await pK.setInputFiles('#imageUpload', await card(pK, noName)); await pK.waitForTimeout(300);
    await pK.click('#runOcrBtn');
    await readEnds(pK, '#ocrMorePhotoModal');
    await pK.waitForTimeout(5200);   // past any picker grace (5 s), so out of view counts as leaving
    await setVisibility(pK, 'hidden');
    ok('between photos with a PIN: out of view locks, though only the readings are held', await pK.isVisible('#vaultModal') && !(await pK.isVisible('#ocrMorePhotoModal')));
    await setVisibility(pK, 'visible');
    await pK.fill('#vaultPin', '2468');
    await pK.waitForSelector('#vaultModal', { state: 'hidden' });
    ok('between photos: the PIN brings the readings back, and the Capture card says photo 2 of 3', await pK.isVisible('#photoCountNote') && (await pK.textContent('#photoCountNote')).startsWith('Photo 2 of 3'),
      await pK.textContent('#photoCountNote'));
    await ctxK.close();
  });

  // Reading that never finishes (a phone stopped the engine): the wash is full at 55 s, then Try Again or Cancel
  {
    const ctxT = await browser.newContext();
    const pT = await ctxT.newPage();
    await pT.clock.install();
    await pT.goto(ORIGIN); await pT.waitForTimeout(300);
    await pT.evaluate(() => { window.Tesseract.createWorker = async () => ({ setParameters: async () => {}, recognize: () => new Promise(() => {}), terminate() { window.__terminated = (window.__terminated || 0) + 1; } }); });
    await pT.setInputFiles('#imageUpload', await renderCardImage(pT)); await pT.waitForTimeout(300);
    await pT.click('#runOcrBtn');
    await pT.waitForFunction(() => document.getElementById('ocrProgressLabel').textContent === 'Extracting…' && !document.getElementById('ocrProgress').classList.contains('hidden'));
    await pT.clock.runFor(30000);
    const half = Number(await pT.getAttribute('#ocrProgressBar', 'aria-valuenow'));
    ok('the wash fills faster than real time at first (about 79% at 30 s of 55)', half >= 75 && half <= 83, String(half));
    await pT.clock.runFor(26000);
    await pT.waitForSelector('#ocrTimeoutModal', { state: 'visible', timeout: 10000 });
    ok('at 55 s the wash is full and Try Again / Cancel pops up; the stuck reader is stopped', (await pT.getAttribute('#ocrProgressBar', 'aria-valuenow')) === '100' && await pT.isVisible('#ocrTryAgainBtn') && await pT.isVisible('#ocrTimeoutCancelBtn') && (await pT.evaluate(() => window.__terminated)) === 1 && /55 seconds/.test(await pT.textContent('#ocrTimeoutText')));
    await pT.click('#ocrTryAgainBtn');
    ok('Try Again reads the same photo again', !(await pT.isVisible('#ocrTimeoutModal')) && await pT.isVisible('#ocrProgress'));
    await pT.waitForFunction(() => document.getElementById('ocrProgressLabel').textContent === 'Extracting…');
    await pT.clock.runFor(56000);
    await pT.waitForSelector('#ocrTimeoutModal', { state: 'visible', timeout: 10000 });
    await pT.click('#ocrTimeoutCancelBtn');
    ok('Cancel after a timeout goes back to the photo on the Capture card', !(await pT.isVisible('#ocrTimeoutModal')) && (await pT.evaluate(() => document.documentElement.dataset.card)) === 'capture' && await pT.isVisible('#captureReview') && await pT.isVisible('#retakePhotoBtn') && !(await pT.isVisible('#ocrProgress')));
    await ctxT.close();
  }

  // Blurry photo: OCR runs but the result is unreadable -> retake prompt, form untouched
  await rerunIfPageCrashed('blurry photo', async () => {
    const ctx4 = await newContext();
    const p4 = await ctx4.newPage();
    await p4.goto(ORIGIN); await p4.waitForTimeout(300);
    await p4.fill('#firstName', 'Typed');
    await p4.setInputFiles('#imageUpload', await renderCardImage(p4, 6)); await p4.waitForTimeout(300);
    await p4.click('#runOcrBtn');
    await p4.waitForSelector('#ocrRetakeNotice', { state: 'visible', timeout: 90000 }).catch(() => {});
    await p4.waitForFunction(() => document.documentElement.dataset.card === 'capture', null, { timeout: 5000 }).catch(() => {});
    ok('blurry photo: retake prompt shown on the Capture card', await p4.isVisible('#ocrRetakeNotice') && await p4.isVisible('#retakePhotoBtn') && !(await p4.isVisible('#runOcrBtn')) && (await p4.evaluate(() => document.documentElement.dataset.card)) === 'capture', await readStage(p4));
    ok('blurry photo: form left unchanged', (await p4.inputValue('#firstName')) === 'Typed' && (await p4.inputValue('#emailValue0')) === '');
    const chooser = p4.waitForEvent('filechooser', { timeout: 5000 }).then(() => true, () => false);
    await p4.click('#retakePhotoBtn');
    ok('Retake photo opens the photo picker', await chooser && !(await p4.isVisible('#cropReviewModal')));
    await p4.setInputFiles('#imageUpload', await renderCardImage(p4)); await p4.waitForTimeout(300);
    ok('new photo resets the crop step (OK back, prompt hidden)', await p4.isVisible('#runOcrBtn') && !(await p4.isVisible('#ocrRetakeNotice')));
    await p4.click('#runOcrBtn');
    await readEnds(p4);
    await proceed(p4);
    ok('sharp retake is read normally', (await rowValue(p4, 'email', 'work')) === 'maria.gonzalez@northwind.com', JSON.stringify(await rows(p4, 'email')));
    await ctx4.close();
  });

  // Crooked photo: drag the corners onto the card, extract, fix a line, change a picker, fill the form
  await rerunIfPageCrashed('crooked photo', async () => {
    const ctx5 = await newContext();
    const p5 = await ctx5.newPage();
    await p5.goto(ORIGIN); await p5.waitForTimeout(300);
    const crooked = await renderSkewedCard(p5);
    await p5.setInputFiles('#imageUpload', crooked.file); await p5.waitForTimeout(500);
    ok('crop handles shown on the photo', (await p5.$$('#cropStage [data-corner]')).length === 4 && await p5.isVisible('[data-corner="0"]'));
    ok('the handles start at the full edge of the photo, never pushed in', (await p5.getAttribute('#cropPolygon', 'points')) === '0,0 1600,0 1600,1200 0,1200', await p5.getAttribute('#cropPolygon', 'points'));
    await p5.click('#snapCardBtn'); await p5.waitForTimeout(200);
    const snapped = (await p5.getAttribute('#cropPolygon', 'points')).split(' ').map(pt => pt.split(',').map(Number));
    ok('Snap to card moves the handles onto the card\'s corners', snapped.every(([x, y], i) => Math.hypot(x - crooked.corners[i].x, y - crooked.corners[i].y) < 12), JSON.stringify(snapped) + ' vs ' + JSON.stringify(crooked.corners));
    // Finding 51: the snapped area has a clear edge (bold outline, the rest of the photo dimmed)
    const edge = await p5.evaluate(() => { const o = getComputedStyle(document.getElementById('cropPolygon')), sh = getComputedStyle(document.getElementById('cropShade'));
      return { stroke: o.strokeWidth, fill: o.fill, shadeFill: sh.fill, shadeRule: sh.fillRule, shadeD: document.getElementById('cropShade').getAttribute('d') }; });
    ok('Snap to card: a bold edge round the card and the rest of the photo dimmed', edge.stroke === '3px' && edge.fill === 'none' && /rgba\(2, 6, 23, 0\.5\)/.test(edge.shadeFill) && edge.shadeRule === 'evenodd' && /^M0,0H1600V1200H0Z M/.test(edge.shadeD), JSON.stringify(edge));
    await p5.waitForTimeout(600);
    await dragCorners(p5, crooked.corners);
    const outline = await p5.getAttribute('#cropPolygon', 'points');
    const placed = outline.split(' ').map(pt => pt.split(',').map(Number));
    ok('dragged corners land on the card corners', placed.every(([x, y], i) => Math.hypot(x - crooked.corners[i].x, y - crooked.corners[i].y) < 12), outline);
    await p5.focus('[data-corner="0"]'); await p5.keyboard.press('ArrowRight');
    const nudged = (await p5.getAttribute('#cropPolygon', 'points')).split(' ')[0].split(',').map(Number);
    ok('arrow key nudges the focused corner', nudged[0] > placed[0][0]);
    await p5.keyboard.press('ArrowLeft');
    await p5.click('#runOcrBtn');
    await p5.waitForSelector('#ocrStepText', { state: 'visible', timeout: 90000 }).catch(() => {});
    const summary = await p5.textContent('#ocrSummary').catch(() => '');
    ok('straightened crooked card is read (name, email, phone)', summary.includes('Maria') && summary.includes('maria.gonzalez@northwind.com') && summary.includes('555-0147'), summary || await readStage(p5));
    const roles = await p5.$$eval('#ocrLines select', s => s.map(x => x.value));
    const nameRow = roles.indexOf('name'), siteRow = roles.indexOf('website');
    await p5.fill(`#ocrLineText${nameRow}`, 'Mariah Gonzalez');
    await p5.selectOption(`#ocrLineRole${siteRow}`, 'notes');
    const after = await p5.textContent('#ocrSummary');
    ok('summary follows edits and picker changes live', after.includes('Mariah') && !/Website/.test(after) && /Notes/.test(after), after);
    await p5.click('#ocrBackBtn');
    await p5.waitForFunction(() => document.documentElement.dataset.card === 'capture', null, { timeout: 5000 }).catch(() => {});
    ok('Back to photo returns to the crop step on the Capture card', (await p5.evaluate(() => document.documentElement.dataset.card)) === 'capture' && await p5.isVisible('#captureReview') && !(await p5.isVisible('#cropReviewModal')));
    await p5.click('#runOcrBtn');
    await readEnds(p5);
    const roles2 = await p5.$$eval('#ocrLines select', s => s.map(x => x.value));
    await p5.fill(`#ocrLineText${roles2.indexOf('name')}`, 'Mariah Gonzalez');
    await p5.selectOption(`#ocrLineRole${roles2.indexOf('website')}`, 'notes');
    await proceed(p5);
    ok('Fill form applies the edited review', (await p5.inputValue('#firstName')) === 'Mariah' && (await rows(p5, 'website')).every(r => !r.value) && (await p5.inputValue('#notes')).includes('northwind.com') && (await rowValue(p5, 'email', 'work')) === 'maria.gonzalez@northwind.com',
      [await p5.inputValue('#firstName'), JSON.stringify(await rows(p5, 'website')), await p5.inputValue('#notes')].join(' | '));
    ok('review text cleared from the page after Fill form', (await p5.$$('#ocrLines input')).length === 0 && !(await p5.isVisible('#cropReviewModal')));
    // Rotate left and Rotate right (finding 49): each turns the photo 90° its own way and the corners reset. The test
    // photo is white with a red top-left corner, so where the red lands shows the direction.
    const marked = await p5.evaluate(() => { const c = document.createElement('canvas'); c.width = 400; c.height = 200; const x = c.getContext('2d');
      x.fillStyle = '#fff'; x.fillRect(0, 0, 400, 200); x.fillStyle = '#f00'; x.fillRect(0, 0, 100, 50); return c.toDataURL('image/png'); });
    await p5.setInputFiles('#imageUpload', { name: 'marked.png', mimeType: 'image/png', buffer: Buffer.from(marked.split(',')[1], 'base64') }); await p5.waitForTimeout(500);
    const redCorner = () => p5.evaluate(() => { const i = document.getElementById('reviewImage'), c = document.createElement('canvas'); c.width = i.naturalWidth; c.height = i.naturalHeight;
      const x = c.getContext('2d'); x.drawImage(i, 0, 0); const red = (fx, fy) => x.getImageData(Math.floor(c.width * fx), Math.floor(c.height * fy), 1, 1).data[1] < 100;
      return { size: `${c.width}x${c.height}`, at: red(0.05, 0.05) ? 'tl' : red(0.95, 0.05) ? 'tr' : red(0.95, 0.95) ? 'br' : red(0.05, 0.95) ? 'bl' : 'none' }; });
    await p5.click('#rotateRightBtn'); await p5.waitForTimeout(500);
    const right = await redCorner();
    ok('Rotate right turns the photo 90° clockwise', right.size === '200x400' && right.at === 'tr', JSON.stringify(right));
    ok('Rotate right: the corners reset to the full edge of the turned photo', (await p5.getAttribute('#cropPolygon', 'points')) === '0,0 200,0 200,400 0,400', await p5.getAttribute('#cropPolygon', 'points'));
    await p5.click('#rotateLeftBtn'); await p5.waitForTimeout(500);
    await p5.click('#rotateLeftBtn'); await p5.waitForTimeout(500);
    const left = await redCorner();
    ok('Rotate left turns the photo 90° counter-clockwise (right then left twice: one quarter turn back)', left.size === '200x400' && left.at === 'bl', JSON.stringify(left));
    // Finding 51: after a snap the view zooms onto the card. A card in the middle of a big photo (a card in a screenshot, as on the iPad).
    const smallCard = await p5.evaluate(() => { const c = document.createElement('canvas'); c.width = 1600; c.height = 1200; const x = c.getContext('2d');
      x.fillStyle = '#6b7280'; x.fillRect(0, 0, 1600, 1200); x.fillStyle = '#fff'; x.fillRect(420, 383, 760, 434); x.fillStyle = '#111';
      for (let i = 0; i < 6; i++) x.fillRect(470, 430 + i * 60, 520 - i * 50, 26); return c.toDataURL('image/png'); });
    await p5.setInputFiles('#imageUpload', { name: 'small.png', mimeType: 'image/png', buffer: Buffer.from(smallCard.split(',')[1], 'base64') }); await p5.waitForTimeout(500);
    await deckSettled(p5);
    await p5.click('#snapCardBtn'); await p5.waitForTimeout(600);
    const snapView = await p5.evaluate(() => {
      const stage = document.getElementById('cropStage').getBoundingClientRect(), view = document.getElementById('cropView');
      const handles = Array.from(document.querySelectorAll('#cropStage [data-corner]')).map(h => { const r = h.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width }; });
      return { transform: view.style.transform, scale: Number(view.style.getPropertyValue('--crop-scale')), stage: { l: stage.left, t: stage.top, r: stage.right, b: stage.bottom }, handles,
        points: document.getElementById('cropPolygon').getAttribute('points') };
    });
    ok('Snap to card: the view zooms in onto the card, all four corners still in view', snapView.scale > 1.6 && /scale\(/.test(snapView.transform)
      && snapView.handles.every(h => h.x >= snapView.stage.l && h.x <= snapView.stage.r && h.y >= snapView.stage.t && h.y <= snapView.stage.b), JSON.stringify(snapView));
    ok('Snap to card: the handles keep their size when zoomed', snapView.handles.every(h => Math.abs(h.w - 24) < 1), JSON.stringify(snapView.handles));
    ok('Snap to card: the corners land on the card in the middle', snapView.points.split(' ').map(pt => pt.split(',').map(Number)).every(([x, y], i) => Math.hypot(x - [420, 1180, 1180, 420][i], y - [383, 383, 817, 817][i]) < 12), snapView.points);
    // A double click (a double tap on a phone) goes back to the whole photo; the corners stay put
    const img5 = await p5.locator('#reviewImage').boundingBox();
    await p5.mouse.dblclick(img5.x + img5.width / 2, img5.y + img5.height / 2); await p5.waitForTimeout(600);
    ok('a double click on the photo goes back to the whole photo, the corners stay put', (await p5.$eval('#cropView', v => v.style.transform)) === '' && (await p5.getAttribute('#cropPolygon', 'points')) === snapView.points, await p5.$eval('#cropView', v => v.style.transform));
    await ctx5.close();
  });

  // OCR engine cannot start (language model missing, as on a host that refuses .gz): no hang, clear message, form untouched
  {
    const ctx3 = await newContext();
    await ctx3.route('**/eng.traineddata.gz', r => r.fulfill({ status: 404, body: 'not found' }));
    const p3 = await ctx3.newPage();
    await p3.goto(ORIGIN); await p3.waitForTimeout(300);
    await p3.fill('#firstName', 'Typed'); await p3.fill('#emailValue0', 'typed@example.com');
    await p3.setInputFiles('#imageUpload', await renderCardImage(p3)); await p3.waitForTimeout(300);
    await p3.click('#runOcrBtn');
    const settled = await p3.waitForSelector('#cropReviewModal', { state: 'hidden', timeout: 30000 }).then(() => true, () => false);
    ok('missing OCR model: extraction ends instead of hanging', settled && (await p3.textContent('#runOcrBtn')).trim() === 'OK' && !(await p3.isDisabled('#runOcrBtn')));
    ok("missing OCR model: user told the reader's files could not be reached", (await p3.textContent('#toastMessage')).includes("reader's files couldn't be reached"), await p3.textContent('#toastMessage'));
    ok('missing OCR model: form left unchanged (no sample text)', (await p3.inputValue('#firstName')) === 'Typed' && (await p3.inputValue('#emailValue0')) === 'typed@example.com' && (await p3.inputValue('#lastName')) === '');
    await ctx3.close();
  }

  // MOD03 Capture card (redesign step 5): Take / Upload buttons, the viewfinder with corner brackets, the zoom fader 48 px
  // from the screen edge, the green shutter that sinks and pops back, a shot that is exactly what the viewfinder showed,
  // handles at the full edge, Snap to card, bad uploads turned away with a toast, the left-hand mirror
  {
    // Playwright's Firefox sends no pointer events for the mouse in a page with touch turned on (only mousedown, mouseup
    // and click), so the presses below would never reach the app there. The app never looks for touch, so Firefox runs
    // this page without it.
    const ctxV = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: ENGINE !== 'firefox' });
    await ctxV.addInitScript(() => {
      // A 640 x 360 test feed: four colours, so the shot can be checked against the window the viewfinder showed
      // The app is handed a camera object of the test's own: WebKit kept its own getUserMedia both when it was assigned and
      // when it was redefined on its camera object ("Invalid constraint"). __camFake says whether the stand-in took.
      const fake = async () => {
        window.__camCalls = (window.__camCalls || 0) + 1;
        const c = document.createElement('canvas'); c.width = 640; c.height = 360; const x = c.getContext('2d');
        const draw = () => {
          x.fillStyle = '#ff0000'; x.fillRect(0, 0, 320, 180); x.fillStyle = '#00ff00'; x.fillRect(320, 0, 320, 180);
          x.fillStyle = '#0000ff'; x.fillRect(0, 180, 320, 180); x.fillStyle = '#ffff00'; x.fillRect(320, 180, 320, 180);
        };
        // Drawn again five times a second like a real camera's frames: WebKit's canvas stream sends a frame only when the
        // canvas is drawn, so a feed drawn once gave the video no frame at all (a black shot sized for no video)
        draw(); setInterval(draw, 200);
        return c.captureStream(5);
      };
      try { Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: fake } });
        window.__camFake = navigator.mediaDevices.getUserMedia === fake ? 'in place' : 'not taken'; } catch (e) { window.__camFake = 'refused: ' + e.message; }
    });
    const pV = await ctxV.newPage();
    const errorsV = [];
    pV.on('pageerror', e => errorsV.push(e.message));
    pV.on('console', m => { if (m.type() === 'error') errorsV.push('console: ' + m.text()); });
    await pV.goto(ORIGIN); await pV.waitForTimeout(500);
    const card = () => pV.evaluate(() => document.documentElement.dataset.card);
    const box = (sel) => pV.evaluate((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; }, sel);
    const choice = await pV.$$eval('#captureChoice > *', els => els.map(e => ({ text: e.textContent.trim(), h: e.offsetHeight, left: e.getBoundingClientRect().left })));
    ok('capture: Take a photo first (left), Upload a photo second (right), both medium buttons side by side', choice.length === 2 && choice[0].text === 'Take a photo' && choice[1].text === 'Upload a photo' && choice[0].left < choice[1].left && choice.every(c => c.h >= 44), JSON.stringify(choice));
    ok('capture: the upload button opens the device\'s own image picker (any image type, no pop-up of our own)', (await pV.getAttribute('#imageUpload', 'accept')) === 'image/*' && (await pV.getAttribute('#imageUpload', 'type')) === 'file');

    // A file that is not a photo is turned away with a toast, the crop step never opens
    await pV.setInputFiles('#imageUpload', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') }); await pV.waitForTimeout(300);
    ok('capture: a non-image upload is rejected with a toast and nothing opens', (await pV.textContent('#toastMessage')).includes('not a photo') && !(await pV.isVisible('#captureReview')) && !(await pV.getAttribute('#reviewImage', 'src')), await pV.textContent('#toastMessage'));

    const noFeed = await cameraFeedMissing(pV);
    if (noFeed) notRunHere('viewfinder, zoom, shutter, shot, Snap on a card-less shot, Retake, an early shutter press and Close camera (18 checks)', `this engine has no ${noFeed} for a test camera`);
    else {
    // The viewfinder: clean, four thin brackets, upright card frame in portrait, fader left (48 px in), shutter right
    await pV.click('#startCameraBtn'); await pV.waitForTimeout(400);
    const started = await pV.isVisible('#cameraPanel');
    ok('viewfinder: the camera starts and the viewfinder shows', started, (await pV.textContent('#eventLog')) + ' | test camera: ' + await pV.evaluate(() => `${window.__camFake || 'script never ran'}, called ${window.__camCalls || 0} times`));
    // The checks below all need a running camera; without one they are failed together, and the run goes on
    if (!started) ok('viewfinder, zoom, shutter, shot, Snap on a card-less shot, Retake, an early shutter press and Close camera (17 checks)', false, 'not tried: the camera never started (the check above says why)');
    else {
    const view = await box('#viewfinderArea'), frame = await box('#cardFrame'), fader = await box('.cap-fader'), shutter = await box('#captureBtn');
    const overlay = await pV.evaluate(() => Array.from(document.querySelectorAll('#viewfinderArea > *')).map(e => e.id || e.className));
    ok('viewfinder: only the video, the corner brackets, the fader and the shutter sit over the picture', overlay.length === 4 && (await pV.$$('#cardFrame .cap-corner')).length === 4 && !(await pV.$('#focusRing')), JSON.stringify(overlay));
    ok('viewfinder: the card frame is upright in portrait, centred and fills most of the view', (await pV.getAttribute('#cardFrame', 'data-orientation')) === 'portrait' && frame.h > frame.w && Math.abs(frame.w / frame.h - 2 / 3.5) < 0.02
      && frame.h > view.h * 0.8 && Math.abs((frame.l + frame.r) / 2 - (view.l + view.r) / 2) < 2, JSON.stringify({ view, frame }));
    ok('viewfinder: the brackets are thin lines (2 px) with nothing filled in', await pV.$eval('#cardFrame .cap-corner.tl', c => { const s = getComputedStyle(c); return s.borderTopWidth === '2px' && s.borderLeftWidth === '2px' && s.borderRightWidth === '0px' && s.backgroundColor === 'rgba(0, 0, 0, 0)'; }));
    ok('viewfinder: the zoom fader is vertical, on the left, at least 48 px from the screen edge', fader.l >= 48 && fader.h > fader.w && fader.l < view.l + view.w / 3 && (await pV.getAttribute('#zoomSlider', 'aria-orientation')) === 'vertical' && (await pV.textContent('#zoomDisplay')) === '1.0x', JSON.stringify(fader));
    ok('viewfinder: the shutter is a round green button on the right, in the middle of the height', shutter.l > view.l + view.w / 2 && Math.abs((shutter.t + shutter.b) / 2 - (view.t + view.b) / 2) < 4 && shutter.w === shutter.h && shutter.w >= 64
      && await pV.$eval('#captureBtn', b => getComputedStyle(b).borderRadius.startsWith('999') && /22, 163, 74|74, 222, 128|21, 128, 61/.test(getComputedStyle(b).backgroundImage)), JSON.stringify(shutter));
    ok('viewfinder: the shutter sits in the middle 60 percent of the screen height', (shutter.t + shutter.b) / 2 > 844 * 0.2 && (shutter.t + shutter.b) / 2 < 844 * 0.8, String((shutter.t + shutter.b) / 2));

    // The fader eases into a change: the readout passes through a value between 1 and 2 before landing on 2.0x
    await pV.evaluate(() => { const s = document.getElementById('zoomSlider'); s.value = '2'; s.dispatchEvent(new Event('input', { bubbles: true })); });
    await pV.waitForTimeout(120);
    const midway = await pV.textContent('#zoomDisplay');
    // The ease takes ZOOM_EASE_MS (320 ms); 5 s only absorbs a slow test machine (an iPhone CI run missed 2 s once). A miss is
    // a failed check that says where the zoom and the camera stood, not a thrown wait that stops the whole run.
    const landed = await pV.waitForFunction(() => document.getElementById('cameraStream').style.transform === 'scale(2)', null, { timeout: 5000 }).then(() => true, () => false);
    const zoomState = landed ? '' : await pV.evaluate(() => { const v = document.getElementById('cameraStream');
      return `transform "${v.style.transform}", readout ${document.getElementById('zoomDisplay').textContent}, camera ${v.srcObject ? 'on' : 'off'}, viewfinder ${document.getElementById('cameraPanel').classList.contains('hidden') ? 'hidden' : 'shown'}, log: ${document.getElementById('eventLog').textContent.trim()}`; });
    ok('zoom: the fader eases into the change instead of snapping', landed && /^1\.[1-9]x$/.test(midway) && (await pV.textContent('#zoomDisplay')) === '2.0x', `midway ${midway}${zoomState ? ' | did not land on 2x within 5 s: ' + zoomState : ''}`);

    // The shutter sinks on the press and pops back after the release; the shot is the window the viewfinder showed
    await pV.mouse.move(shutter.l + shutter.w / 2, shutter.t + shutter.h / 2); await pV.mouse.down(); await pV.waitForTimeout(60);
    const sunk = await pV.$eval('#captureBtn', b => b.style.transform);
    await pV.mouse.up(); await pV.waitForTimeout(500);
    const popped = await pV.$eval('#captureBtn', b => b.style.transform);
    ok('shutter: sinks while pressed and pops back on release', sunk === 'scale(0.9)' && popped === '', `${sunk} -> ${popped}`);
    ok('shutter: the shot opens the crop step and the camera closes', await pV.isVisible('#captureReview') && (await pV.evaluate(() => document.getElementById('cameraPanel').classList.contains('hidden') && document.getElementById('cameraStream').srcObject === null)) && (await card()) === 'capture');
    // The 390 x 464-ish portrait view covers the 640 x 360 feed (scale by height), zoomed 2x: the window is the middle of it
    const shot = await pV.evaluate(() => new Promise(resolve => {
      const i = document.getElementById('reviewImage');
      const read = () => { const c = document.createElement('canvas'); c.width = i.naturalWidth; c.height = i.naturalHeight; const x = c.getContext('2d'); x.drawImage(i, 0, 0);
        const px = (fx, fy) => Array.from(x.getImageData(Math.floor(c.width * fx), Math.floor(c.height * fy), 1, 1).data).slice(0, 3);
        resolve({ w: c.width, h: c.height, tl: px(0.1, 0.1), tr: px(0.9, 0.1), bl: px(0.1, 0.9), br: px(0.9, 0.9) }); };
      if (i.complete && i.naturalWidth) read(); else i.onload = read;
      setTimeout(() => resolve({ w: 0, h: 0, tl: [], tr: [], bl: [], br: [], none: 'no photo was taken' }), 5000);   // never wait forever
    }));
    const expectW = Math.round(view.w / (view.h / 360) / 2), expectH = 180;   // the view measured before the shot (the camera closes after it)
    ok('shot: exactly the window the viewfinder showed (cover crop and 2x zoom), not the whole frame', Math.abs(shot.w - expectW) <= 1 && shot.h === expectH
      && shot.tl.join() === '255,0,0' && shot.tr.join() === '0,255,0' && shot.bl.join() === '0,0,255' && shot.br.join() === '255,255,0', JSON.stringify({ shot, expectW, expectH }));
    ok('shot: the handles start at the full edge of the frame', (await pV.getAttribute('#cropPolygon', 'points')) === `0,0 ${shot.w},0 ${shot.w},${shot.h} 0,${shot.h}`, await pV.getAttribute('#cropPolygon', 'points'));
    ok('shot: no copy of the photo is left in the capture canvas', (await pV.$eval('#captureCanvas', c => c.width + c.height)) === 0);
    await pV.click('#snapCardBtn'); await pV.waitForTimeout(200);
    ok('Snap to card on a photo with no card in it leaves the handles alone and says so', (await pV.textContent('#toastMessage')).includes('No card edges found') && (await pV.getAttribute('#cropPolygon', 'points')) === `0,0 ${shot.w},0 ${shot.w},${shot.h} 0,${shot.h}`, await pV.textContent('#toastMessage'));
    // Retake after a camera shot opens the camera again; Cancel drops the photo
    await pV.evaluate(() => document.getElementById('retakePhotoBtn').classList.remove('hidden'));
    await pV.click('#retakePhotoBtn'); await pV.waitForTimeout(300);
    ok('Retake after a camera shot opens the camera again and drops the old photo', await pV.isVisible('#cameraPanel') && !(await pV.isVisible('#captureReview')) && !(await pV.getAttribute('#reviewImage', 'src')));
    // A press before the camera's first picture (the video has no size yet) waits for it instead of taking a black photo
    await pV.evaluate(() => Object.defineProperty(document.getElementById('cameraStream'), 'videoWidth', { configurable: true, get: () => 0 }));
    await pV.click('#captureBtn'); await pV.waitForTimeout(1800);
    ok('shutter before the first picture: no photo, the camera stays open and a toast says it is still starting', await pV.isVisible('#cameraPanel') && !(await pV.isVisible('#captureReview'))
      && (await pV.textContent('#toastMessage')).includes('still starting'), await pV.textContent('#toastMessage'));
    await pV.click('#captureBtn'); await pV.waitForTimeout(200);
    const heldBack = await pV.isVisible('#cameraPanel') && !(await pV.isVisible('#captureReview'));
    await pV.evaluate(() => { const v = document.getElementById('cameraStream'); delete v.videoWidth; v.dispatchEvent(new Event('loadeddata')); });
    await pV.waitForTimeout(300);
    ok('shutter before the first picture: the shot is taken as soon as the picture comes', heldBack && await pV.isVisible('#captureReview') && !(await pV.isVisible('#cameraPanel')));
    await pV.evaluate(() => document.getElementById('retakePhotoBtn').classList.remove('hidden'));
    await pV.click('#retakePhotoBtn'); await pV.waitForTimeout(300);
    await pV.click('#stopCameraBtn');
    ok('Close camera stops the feed', await pV.evaluate(() => document.getElementById('cameraStream').srcObject === null && document.getElementById('cameraPanel').classList.contains('hidden')));
    }
    }
    await pV.setInputFiles('#imageUpload', await renderCardImage(pV)); await pV.waitForTimeout(300);
    ok('upload: the handles start at the full photo', await pV.isVisible('#captureReview') && (await pV.getAttribute('#cropPolygon', 'points')) === '0,0 1050,0 1050,600 0,600');
    ok('crop step: Rotate left, Rotate right, Snap to card, Cancel and a green OK; OK is the only green one', (await pV.$$eval('#captureActions button', bs => bs.filter(b => b.offsetParent).map(b => b.textContent.trim()))).join('|') === 'Left|Right|Snap to card|Cancel|OK'
      && (await pV.getAttribute('#rotateLeftBtn', 'aria-label')).includes('counter-clockwise') && (await pV.getAttribute('#rotateRightBtn', 'aria-label')).includes(', clockwise')
      && await pV.$eval('#runOcrBtn', b => getComputedStyle(b).backgroundColor === 'rgb(22, 163, 74)'));
    // Finding 52: a two-finger pinch on the photo zooms the photo like a camera; the page, the buttons and the handles keep
    // their size; the corners do not move. At the whole photo a swipe is still the deck's (touch-action pan-x pan-y).
    await deckSettled(pV);
    const okBefore = await box('#runOcrBtn');
    const actionAtFit = await pV.$eval('#cropStage', s => getComputedStyle(s).touchAction);
    const pinch = await pV.evaluate(() => {
      const img = document.getElementById('reviewImage'), r = img.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const fire = (type, id, x, y) => img.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: id === 1, clientX: x, clientY: y, bubbles: true, cancelable: true }));
      fire('pointerdown', 1, cx - 20, cy); fire('pointerdown', 2, cx + 20, cy);
      for (let d = 25; d <= 40; d += 5) { fire('pointermove', 1, cx - d, cy); fire('pointermove', 2, cx + d, cy); }
      const v = document.getElementById('cropView');
      const out = { scale: Number(v.style.getPropertyValue('--crop-scale')), zoomed: document.getElementById('cropStage').dataset.zoomed, action: getComputedStyle(document.getElementById('cropStage')).touchAction,
        handle: document.querySelector('#cropStage [data-corner="0"]').getBoundingClientRect().width, page: window.visualViewport ? window.visualViewport.scale : 1 };
      fire('pointerup', 1, cx - 40, cy); fire('pointerup', 2, cx + 40, cy);
      return out;
    });
    const okAfter = await box('#runOcrBtn');
    ok('pinch on the photo zooms the photo (two fingers 40 px apart -> 80 px: twice the size)', Math.abs(pinch.scale - 2) < 0.01 && pinch.zoomed === '1', JSON.stringify(pinch));
    ok('pinch on the photo: the page does not zoom and the buttons and handles keep their size', pinch.page === 1 && Math.abs(pinch.handle - 24) < 1 && okAfter.w === okBefore.w && okAfter.h === okBefore.h, JSON.stringify({ pinch, okBefore, okAfter }));
    ok('pinch on the photo: the corners stay where they were', (await pV.getAttribute('#cropPolygon', 'points')) === '0,0 1050,0 1050,600 0,600');
    ok('the photo takes every touch only while zoomed; at the whole photo a swipe still moves the deck', actionAtFit === 'pan-x pan-y' && pinch.action === 'none', `${actionAtFit} / ${pinch.action}`);
    // One finger pans the zoomed photo
    const panned = await pV.evaluate(() => {
      const img = document.getElementById('reviewImage'), r = img.getBoundingClientRect(), v = document.getElementById('cropView'), before = v.style.transform;
      const fire = (type, x, y) => img.dispatchEvent(new PointerEvent(type, { pointerId: 3, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, bubbles: true, cancelable: true }));
      fire('pointerdown', r.left + r.width / 2, r.top + r.height / 2); fire('pointermove', r.left + r.width / 2 + 30, r.top + r.height / 2 + 10); fire('pointerup', r.left + r.width / 2 + 30, r.top + r.height / 2 + 10);
      return { before, after: v.style.transform };
    });
    ok('one finger pans the zoomed photo', panned.before !== panned.after && /scale\(2\)/.test(panned.after), JSON.stringify(panned));
    await pV.click('#cancelReviewBtn');
    ok('Cancel on the crop step drops the photo and goes back to Take or Upload', !(await pV.isVisible('#captureReview')) && !(await pV.getAttribute('#reviewImage', 'src')) && await pV.isVisible('#startCameraBtn'));

    if (noFeed) notRunHere('left-hand viewfinder and reduce-motion zoom (2 checks)', `this engine has no ${noFeed} for a test camera`);
    else {
    // Left hand (Settings): the shutter moves to the left and the fader to the right, still 48 px from the edge
    await pV.click('#navSettings'); await pV.click('#handLeftBtn'); await pV.keyboard.press('Escape'); await pV.waitForTimeout(200);
    await pV.click('#startCameraBtn'); await pV.waitForTimeout(400);
    if (!(await pV.isVisible('#cameraPanel'))) ok('left-hand viewfinder and reduce-motion zoom (2 checks)', false, `not tried: the camera never started: ${await pV.textContent('#eventLog')}`);
    else {
    const faderL = await box('.cap-fader'), shutterL = await box('#captureBtn');
    ok('left hand: the shutter is on the left and the fader on the right, 48 px from the screen edge', shutterL.l < faderL.l && 390 - faderL.r >= 48 && shutterL.l >= 48, JSON.stringify({ faderL, shutterL }));
    await pV.click('#navSettings'); await pV.click('#handRightBtn'); await pV.keyboard.press('Escape');
    await pV.evaluate(() => localStorage.clear());
    // Reduce motion: zoom applies at once
    await pV.emulateMedia({ reducedMotion: 'reduce' });
    await pV.evaluate(() => { const s = document.getElementById('zoomSlider'); s.value = '3'; s.dispatchEvent(new Event('input', { bubbles: true })); });
    ok('reduce motion: the zoom lands at once', (await pV.textContent('#zoomDisplay')) === '3.0x');
    await pV.emulateMedia({ reducedMotion: null });
    await pV.click('#stopCameraBtn');
    }
    }
    ok('capture card: no page errors', errorsV.length === 0, errorsV.join(' | '));
    await ctxV.close();
  }

  // MOD03 cute touches (approved 2026-10-21): paw crop handles with a corner dot (C1), the lynx-eye shutter (C2), Iris
  // peeking on the empty Capture card with one wink (C3), paw dots by MOD04's "Photo 2 of 3" (C9). Branded only.
  {
    const ctxI = await newContext({ viewport: { width: 390, height: 844 } });
    const pI = await ctxI.newPage();
    const errorsI = [];
    pI.on('pageerror', e => errorsI.push(e.message));
    await pI.goto(ORIGIN); await pI.waitForTimeout(400);
    const pseudo = (sel, which, prop) => pI.$eval(sel, (el, [w, p]) => getComputedStyle(el, w)[p], [which, prop]);
    const winking = () => pI.$eval('#capIris', el => el.classList.contains('wink'));
    if (EDITION_PLAIN) {
      ok('plain: no Iris on the Capture card', !(await pI.isVisible('#capIris')));
      ok('plain: the shutter keeps its plain white dot (no lynx eye)', (await pseudo('#captureBtn .cap-shutter-dot', '::after', 'content')) === 'none'
        && /255, 255, 255/.test(await pseudo('#captureBtn .cap-shutter-dot', null, 'backgroundColor')));
      await pI.evaluate(() => { const n = document.getElementById('photoCountNote'); n.dataset.photo = '2'; n.dataset.of = '3'; });
      ok('plain: no paw dots by the photo count', (await pseudo('#photoCountNote', '::before', 'content')) === 'none');
    } else {
      const irisBox = await pI.$eval('#capIris', el => { const r = el.getBoundingClientRect(), c = document.getElementById('captureChoice').getBoundingClientRect(); return { h: r.height, above: r.bottom <= c.top + 1 }; });
      ok('Iris peeks over a card above Take a photo / Upload a photo', await pI.isVisible('#capIris') && irisBox.h > 30 && irisBox.above, JSON.stringify(irisBox));
      await pI.click('#capIris');
      const wunk = await winking();
      await pI.waitForTimeout(900);
      ok('a tap on Iris winks one eye once, then she is still again', wunk && !(await winking()));
      await pI.emulateMedia({ reducedMotion: 'reduce' });
      await pI.click('#capIris');
      ok('reduce motion: no wink', !(await winking()));
      await pI.emulateMedia({ reducedMotion: 'no-preference' });

      // C2: the shutter's eye; pressing narrows the pupil to a slit (a shape change, set while camera.js holds data-pressed)
      const pupil = () => pseudo('#captureBtn .cap-shutter-dot', '::after', 'width').then(parseFloat);
      const open = await pupil();
      await pI.$eval('#captureBtn', b => { b.dataset.pressed = '1'; });
      const slit = await pupil();
      await pI.$eval('#captureBtn', b => { delete b.dataset.pressed; });
      ok('the shutter is an amber lynx eye whose pupil narrows to a slit while pressed', /245, 158, 11/.test(await pseudo('#captureBtn .cap-shutter-dot', null, 'backgroundImage')) && open > 6 && slit < open / 2, JSON.stringify({ open, slit }));

      // C9: the dots wait for MOD04's attributes, then fill one per photo already taken
      ok('paw dots stay off until the photo count carries its numbers', (await pseudo('#photoCountNote', '::before', 'content')) === 'none');
      const dots = async (photo) => { await pI.evaluate((ph) => { const n = document.getElementById('photoCountNote'); n.dataset.photo = ph; n.dataset.of = '3'; }, photo);
        return (await pseudo('#photoCountNote', '::before', 'backgroundImage')).split('radial-gradient').length - 1; };
      await dots('1'); const bg1 = await pseudo('#photoCountNote', '::before', 'backgroundImage');
      await dots('2'); const bg2 = await pseudo('#photoCountNote', '::before', 'backgroundImage');
      await dots('3'); const bg3 = await pseudo('#photoCountNote', '::before', 'backgroundImage');
      ok('paw dots: three, the taken photos filled (photo 2 of 3: one, photo 3 of 3: two)', (await dots('3')) === 3 && new Set([bg1, bg2, bg3]).size === 3, JSON.stringify([bg1, bg2, bg3]));
      await pI.evaluate(() => { const n = document.getElementById('photoCountNote'); delete n.dataset.photo; delete n.dataset.of; });

      // A second photo is under way: Iris steps away while the count shows
      await pI.evaluate(() => document.getElementById('photoCountNote').classList.remove('hidden'));
      ok('Iris steps away while the photo count shows', !(await pI.isVisible('#capIris')));
      await pI.evaluate(() => document.getElementById('photoCountNote').classList.add('hidden'));
    }

    // C1: the crop step's handles (upload a card photo); the corner dot and paw are branded only
    await pI.setInputFiles('#imageUpload', await renderCardImage(pI)); await pI.waitForTimeout(400);
    const handles = await pI.$$eval('.crop-handle', hs => hs.map(h => { const b = getComputedStyle(h, '::before'), a = getComputedStyle(h, '::after'), r = h.getBoundingClientRect();
      return { corner: h.dataset.corner, w: r.width, toes: b.backgroundImage.split('radial-gradient').length - 1, turn: b.transform, dot: a.content !== 'none' && a.content !== '' ? a.width : null }; }));
    ok('crop step: the Iris peek is gone once there is a photo', await pI.isVisible('#captureReview') && !(await pI.isVisible('#capIris')));
    if (EDITION_PLAIN) ok('plain: the crop handles stay plain circles (no paws, no corner dot)', handles.length === 4 && handles.every(h => h.toes === 0 && !h.dot), JSON.stringify(handles));
    else ok('crop handles are paw prints (four toes and a pad), turned out from each corner, with a fine dot on the corner, same size as before',
      handles.length === 4 && handles.every(h => h.toes === 5 && h.dot === '6px' && h.turn !== 'none' && h.w >= 23) && new Set(handles.map(h => h.turn)).size === 4, JSON.stringify(handles));
    ok('cute touches: no page errors', errorsI.length === 0, errorsI.join(' | '));
    await ctxI.close();
  }

  // Camera in use by another app: busy at start, a virtual camera, the feed taken or muted mid-scan -> camera off + pop-up
  {
    const ctxC = await newContext();
    // Firefox never delivers an 'ended' or 'mute' event that a page sends to a camera track (the engine probe showed
    // neither the app's listener nor the test's own one hearing it), so there the stream hands the app a stand-in
    // track: the real one's properties and methods, with events the test can send.
    await ctxC.addInitScript((standIn) => {
      window.__camMode = 'normal';
      // A camera object of the test's own, as on the Capture card above (WebKit kept its own getUserMedia)
      const fake = async () => {
        window.__camCalls = (window.__camCalls || 0) + 1;
        if (window.__camMode === 'busy') throw new DOMException('Could not start video source', 'NotReadableError');
        const c = document.createElement('canvas'); c.width = 640; c.height = 360;
        const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
        const stream = c.captureStream(5), real = stream.getVideoTracks()[0];
        let track = real;
        if (standIn) {
          track = new EventTarget();
          for (const k of ['kind', 'id', 'readyState', 'enabled', 'muted', 'contentHint']) Object.defineProperty(track, k, { configurable: true, get: () => real[k] });
          for (const m of ['stop', 'clone', 'getSettings', 'getConstraints', 'getCapabilities', 'applyConstraints']) if (typeof real[m] === 'function') track[m] = (...a) => real[m](...a);
          stream.getVideoTracks = () => [track];
        }
        Object.defineProperty(track, 'label', { configurable: true, value: window.__camMode === 'virtual' ? 'OBS Virtual Camera' : 'Integrated Camera' });
        window.__camTrack = track;
        return stream;
      };
      try { Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: fake } });
        window.__camFake = navigator.mediaDevices.getUserMedia === fake ? 'in place' : 'not taken'; } catch (e) { window.__camFake = 'refused: ' + e.message; }
    }, ENGINE === 'firefox');
    const pC = await ctxC.newPage();
    await pC.goto(ORIGIN); await pC.waitForTimeout(300);
    const noFeedC = await cameraFeedMissing(pC);
    if (noFeedC) notRunHere('camera in use by another app (12 checks)', `this engine has no ${noFeedC} for a test camera`);
    else {
    const popup = () => pC.isVisible('#cameraInUseModal');
    const cameraOff = () => pC.evaluate(() => document.getElementById('cameraStream').srcObject === null && document.getElementById('cameraPanel').classList.contains('hidden'));
    const start = async (mode) => { await pC.evaluate(m => { window.__camMode = m; }, mode); await pC.click('#startCameraBtn'); await pC.waitForTimeout(300); };
    // What the camera module logged, and whether the test's fake track is the one the app is showing (failure details).
    const camState = () => pC.evaluate(() => { const s = document.getElementById('cameraStream').srcObject;
      return `${document.getElementById('eventLog').textContent.trim()} | app shows test track: ${!!s && s.getVideoTracks()[0] === window.__camTrack} | test camera: ${window.__camFake || 'script never ran'}, called ${window.__camCalls || 0} times`; });
    // A missing pop-up is reported by the check before it; closing it must not stop the rest of the section.
    const closePopup = () => pC.click('#cameraInUseOkBtn', { timeout: 2000 }).catch(() => {});

    await start('normal');
    const startedC = await pC.isVisible('#cameraPanel');
    ok('ordinary camera starts with no pop-up', startedC && !(await popup()) && await pC.evaluate(() => !!document.getElementById('cameraStream').srcObject), await camState());
    if (!startedC) ok('camera in use by another app (11 checks)', false, 'not tried: the camera never started (the check above says why)');
    else {
    await pC.click('#stopCameraBtn');

    await start('busy');
    ok('camera held by another app: pop-up shown, camera off', await popup() && await cameraOff(), await camState());
    ok('pop-up tells the user to close the other app or upload', ((await pC.textContent('#cameraInUseMessage', { timeout: 2000 }).catch(() => '')) || '').includes('Another app is using or watching your camera'));
    ok('OK is focused and closes the pop-up', await pC.evaluate(() => document.activeElement && document.activeElement.id === 'cameraInUseOkBtn'));
    await closePopup();
    ok('pop-up closed after OK', !(await popup()));

    await start('virtual');
    ok('virtual camera: pop-up shown, camera off', await popup() && await cameraOff(), await camState());
    await closePopup();

    await start('normal');
    await pC.evaluate(() => window.__camTrack && window.__camTrack.dispatchEvent(new Event('ended')));   // no test track: the check below fails
    await pC.waitForSelector('#cameraInUseModal', { state: 'visible', timeout: 2000 }).catch(() => {});
    ok('feed taken by another app mid-scan: pop-up shown, camera off', await popup() && await cameraOff(), await camState());
    await closePopup();

    await start('normal');
    const muted = await pC.evaluate(() => { const t = window.__camTrack; if (!t) return false; Object.defineProperty(t, 'muted', { get: () => true }); t.dispatchEvent(new Event('mute')); return true; });
    await pC.waitForTimeout(300);
    ok('brief mute does not trigger the pop-up', muted && !(await popup()), muted ? '' : 'not tried: no test track to mute > ' + await camState());
    await pC.waitForSelector('#cameraInUseModal', { state: 'visible', timeout: 3000 }).catch(() => {});   // MUTE_GRACE_MS after the mute
    ok('feed muted while in view: pop-up shown, camera off', await popup() && await cameraOff(), await camState());
    await closePopup();

    await start('normal');
    const startedLast = await pC.isVisible('#cameraPanel');
    if (startedLast) {
      await pC.click('#stopCameraBtn');
      await pC.evaluate(() => window.__camTrack.dispatchEvent(new Event('ended')));
      await pC.waitForTimeout(100);
    }
    ok('closing the camera ourselves raises no pop-up', startedLast && !(await popup()), startedLast ? '' : 'not tried: the camera did not start again > ' + await camState());

    // Upload while the camera is live (raven575, Android Chrome, 2026-10-20): the camera turns off before the picker
    // opens, so the picker pausing the feed (a mute, with the page still in view) raises no pop-up and nothing jumps.
    await start('normal');
    const startedUp = await pC.isVisible('#cameraPanel');
    const [chooser] = startedUp ? await Promise.all([pC.waitForEvent('filechooser', { timeout: 3000 }).catch(() => null), pC.click('#uploadPhotoBtn')]) : [null];
    if (chooser) {
      await pC.evaluate(() => { const t = window.__camTrack; Object.defineProperty(t, 'muted', { configurable: true, get: () => true }); t.dispatchEvent(new Event('mute')); });
      await pC.waitForTimeout(1400);   // past MUTE_GRACE_MS
    }
    ok('Upload with the camera live: the camera turns off first, and the picker pausing the feed raises no pop-up', !!chooser && await cameraOff() && !(await popup()),
      startedUp ? `picker opened: ${!!chooser} > ${await camState()}` : 'not tried: the camera did not start > ' + await camState());
    if (chooser) { await chooser.setFiles(await renderCardImage(pC)); await pC.waitForTimeout(400); }
    ok('the picked photo opens the crop step with the camera still off', !!chooser && await pC.isVisible('#captureReview') && await cameraOff() && !(await popup()), await camState());
    }
    }
    await ctxC.close();
  }

  // MOD01 browser gate: block (the app never starts) when a protection is missing; warn and run when only the
  // system or engine outside the app is weak
  {
    ok('a current browser gets no gate banner', !(await page.$('#browserGateBanner')));
    // The page has no script tag for the app (so the browser cannot fetch it ahead of the checks); the gate added it
    const served = await (await page.request.get(base)).text();
    const appTags = await page.$$eval('script[type="module"]', els => els.map(el => el.getAttribute('src')));
    ok('gate: the page has no script tag for the app; the gate loaded it once, after its checks', !/<script[^>]*type="module"/.test(served) && !/<script[^>]*(?:main\.js|assets\/index-)/.test(served)
      && appTags.length === 1 && (process.env.SERVE_DIR ? /^\.\/assets\/index-[\w-]+\.js$/ : /^src\/main\.js$/).test(appTags[0]), appTags.join(' '));
    const blocked = async (setup, reason) => {
      const ctxG = await browser.newContext();
      const pG = await ctxG.newPage();
      const requested = [], pageErrors = [];
      pG.on('request', r => requested.push(r.url()));
      pG.on('pageerror', e => pageErrors.push(e.message));
      pG.on('console', m => { if (m.type() === 'error' && !/SyntaxError|Unexpected/.test(m.text())) pageErrors.push(m.text()); });
      await setup(ctxG, pG);
      await pG.goto(base); await pG.waitForTimeout(800);
      const url = pG.url();
      const shown = url.includes('src/modules/mod01-shell/unsupported/index.html#') && url.includes(reason);
      const reasons = shown ? await pG.$$eval('#reasonList li', els => els.map(el => el.getAttribute('data-reason'))) : [];
      const links = shown ? await pG.$$eval('.links a', els => els.map(a => ({ href: a.href, target: a.target, rel: a.rel }))) : [];
      const external = requested.filter(u => !u.startsWith(ORIGIN));
      const ranMain = await pG.evaluate(() => window.name === 'vcge-main-ran').catch(() => null);
      await ctxG.close();
      return { shown, url, reasons, links, requested, external, pageErrors, ranMain };
    };
    // The app's entry script is swapped for a one-line marker: if the browser ever runs it, the tab's name says so
    const isMain = (u) => /\/src\/main\.js|\/assets\/index-[^/]*\.js/.test(u);
    const noWasm = await blocked((ctxG) => Promise.all([ctxG.addInitScript(() => { delete window.WebAssembly; }),
      ctxG.route((u) => isMain(u.href), (r) => r.fulfill({ contentType: 'text/javascript', body: "window.name = 'vcge-main-ran';" }))]), 'wasm');
    ok('gate: no WebAssembly opens the "cannot run" page with the reason listed', noWasm.shown && noWasm.reasons.includes('wasm'), noWasm.url);
    ok('gate: blocked app never starts (main.js never runs)', noWasm.ranMain === false, String(noWasm.ranMain));
    ok('gate: blocked app never starts (main.js not even requested)', !noWasm.requested.some(u => /\/src\/main\.js|\/assets\/index-[\w-]+\.js/.test(u)), noWasm.requested.filter(u => u.endsWith('.js')).join(' '));
    ok('gate: free & open source browsers are listed first (Firefox, Firefox ESR, Brave)', noWasm.links.slice(0, 3).map(l => new URL(l.href).hostname).join() === 'www.firefox.com,support.mozilla.org,brave.com', noWasm.links.map(l => l.href).join(' '));
    ok('gate: links open in a new tab with no opener, no referrer and no query data', noWasm.links.length === 6 && noWasm.links.every(l => l.target === '_blank' && /noopener/.test(l.rel) && /noreferrer/.test(l.rel) && !new URL(l.href).search && !new URL(l.href).hash));
    ok('gate: the "cannot run" page makes no outside request and draws without errors', noWasm.external.length === 0 && noWasm.pageErrors.length === 0, noWasm.external.concat(noWasm.pageErrors).join(' | '));
    const noLock = await blocked((ctxG, pG) => pG.route('**/src/modules/mod01-shell/netLock.js', r => r.fulfill({ contentType: 'text/javascript', body: '' })), 'netlock');
    ok('gate fails closed: without vCGE\'s own network lock the app does not start', noLock.shown && noLock.reasons.includes('netlock'), noLock.url);
    const noCsp = await blocked((ctxG) => ctxG.addInitScript(() => { delete window.SecurityPolicyViolationEvent; }), 'csp');
    ok('gate: no Content-Security-Policy support blocks the app', noCsp.shown && noCsp.reasons.includes('csp'), noCsp.url);
    if (!process.env.SERVE_DIR) {
      const badCode = await blocked((ctxG, pG) => pG.route('**/src/main.js', r => r.fulfill({ contentType: 'text/javascript', body: 'let let = 1;' })), 'script');
      ok('gate: code the browser cannot read opens the "cannot run" page, not a blank one', badCode.shown && badCode.reasons.includes('script'), badCode.url);
    }

    const ctxW = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 6.1; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36' });
    const pW = await ctxW.newPage();
    await pW.goto(base); await pW.waitForTimeout(600);
    const bannerText = await pW.$eval('#browserGateBanner', el => el.textContent).catch(() => '');
    ok('gate: Windows 7 with Chromium 109 runs the app with a warning banner', bannerText.includes('operating system no longer gets security updates') && bannerText.includes('browser engine no longer gets security updates')
      && (await pW.$eval('#vaultBadgeText', el => el.textContent)) === 'Vault: UNLOCKED', bannerText);
    await pW.click('#browserGateDismiss');
    ok('gate: the warning banner can be dismissed (nothing stored)', !(await pW.$('#browserGateBanner')) && (await pW.evaluate(() => localStorage.length + sessionStorage.length)) === 0);
    await ctxW.close();
  }

  // MOD01 postcard deck, Welcome card, CANCEL / Thank You page and the tour: on every start, nothing stored, six steps
  {
    const ctxH = await plainContext(); await editionRoute(ctxH);
    const errorsH = [], externalH = [];
    const openH = async () => {
      const p = await ctxH.newPage();
      p.on('pageerror', e => errorsH.push(e.message));
      p.on('console', m => { if (m.type() === 'error') errorsH.push('console: ' + m.text()); });
      p.on('request', r => { if (!r.url().startsWith(ORIGIN) && !/^(data|blob):/.test(r.url())) externalH.push(r.url()); });
      p.on('dialog', d => d.accept());
      await p.goto(ORIGIN); await p.waitForTimeout(400);
      return p;
    };
    let pH = await openH();
    const state = () => pH.evaluate(() => ({
      card: document.documentElement.dataset.card, layer: !!document.getElementById('welcomeLayer'),
      welcomeCurrent: document.getElementById('cardWelcome').classList.contains('is-current'),
      thanks: !document.getElementById('thankYouPage').classList.contains('hidden'),
      vault: !document.getElementById('vaultPage').classList.contains('hidden'),
      focus: document.activeElement && document.activeElement.id,
      title: (document.getElementById('welcomeTitle') || {}).textContent, tagline: (document.getElementById('welcomeTagline') || {}).textContent
    }));
    const stored = () => pH.evaluate(() => localStorage.length + sessionStorage.length + document.cookie.length);
    const first = await state();
    ok('welcome: the deck opens on the Welcome card', first.welcomeCurrent && first.card === 'welcome' && !first.thanks && !first.vault, JSON.stringify(first));
    if (!EDITION_PLAIN) {
      ok('welcome: title and the tagline "Operation: Never Lose Contact"', first.title === 'Welcome to vCGE' && first.tagline === 'Operation: Never Lose Contact', JSON.stringify(first));
      ok('welcome: the logo sits above the title, loaded from the bundled file', await logoMarkShown(pH, '#cardWelcome .vcge-welcome-logo')
        && await pH.$eval('#cardWelcome .vcge-welcome-logo', i => i.getBoundingClientRect().height >= 60 && i.getBoundingClientRect().bottom <= document.getElementById('welcomeTitle').getBoundingClientRect().top));
      ok('Thank You page: the logo is drawn from the bundled file', await pH.$eval('#thankYouPage .vcge-welcome-logo', el => /url\(/.test(getComputedStyle(el).backgroundImage) && el.getAttribute('aria-label') === 'vCGE'));
    } else {
      ok('plain edition: the Welcome card says "Welcome to vCGE" with no tagline and no logo', first.title === 'Welcome to vCGE' && first.tagline === undefined
        && !(await pH.$('#cardWelcome .vcge-welcome-logo')) && !(await pH.$('#welcomeTagline')), JSON.stringify(first));
      ok('plain edition: the Thank You page has no logo and reads "Session ended."', await logoMarkGone(pH, '#thankYouPage .vcge-welcome-logo')
        && (await pH.textContent('#thankYouText')) === 'Session ended.');
    }
    ok('welcome: buttons read Set Up PIN/BIO Lock Now, START, Take a Tour, CANCEL', (await pH.textContent('#welcomePinBtn')) === 'Set Up PIN/BIO Lock Now' && (await pH.textContent('#welcomeStartBtn')) === 'START'
      && (await pH.textContent('#welcomeTourBtn')) === 'Take a Tour' && (await pH.textContent('#welcomeCancelBtn')) === 'CANCEL');
    ok('deck: the cards out of view are hidden from assistive tech and covered against taps', await pH.evaluate(() => document.querySelectorAll('.deck-card[aria-hidden="true"]').length === 5 && document.getElementById('cardWelcome').getAttribute('aria-hidden') === 'false'
      && document.querySelectorAll('.deck-card > .deck-cover').length === 6 && getComputedStyle(document.querySelector('#cardWelcome > .deck-cover')).display === 'none'
      && getComputedStyle(document.querySelector('#cardCapture > .deck-cover')).display !== 'none'));
    await pH.click('#welcomeStartBtn'); await pH.waitForTimeout(700);
    ok('welcome: START moves to the Capture card and lights its header icon', (await state()).card === 'capture'
      && await pH.$eval('#navCapture', b => b.classList.contains('is-on') && b.getAttribute('aria-current') === 'page') && await pH.$eval('#navRead', b => !b.classList.contains('is-on')));
    // A slow webview (frames 100 ms apart, under the deck's 150 ms watchdog) must not strand a two-card move on the
    // card in between: the settle waits for the deck's own move to finish (seen on the Linux desktop CI: Read).
    await pH.evaluate(() => {
      const raf = window.requestAnimationFrame.bind(window), caf = window.cancelAnimationFrame.bind(window), late = new Map(), t0 = performance.now();
      window.requestAnimationFrame = (cb) => {
        const since = performance.now() - t0;
        if (since < 60 || since > 320) return raf(cb);
        const id = -late.size - 1 - Math.random(); late.set(id, setTimeout(() => { late.delete(id); cb(performance.now()); }, 100)); return id;
      };
      window.cancelAnimationFrame = (id) => { if (late.has(id)) { clearTimeout(late.get(id)); late.delete(id); } else caf(id); };
    });
    await pH.click('#navFields'); await pH.waitForTimeout(1200);
    ok('deck: a two-card move through slow frames still lands on the card asked for, not the one in between', (await state()).card === 'fields'
      && await pH.evaluate(() => { const t = document.getElementById('deck'), c = document.getElementById('cardFields'); return t.dataset.deck === 'still' && Math.abs(t.scrollLeft - (c.offsetLeft + c.offsetWidth / 2 - t.clientWidth / 2)) <= 1; }), JSON.stringify(await state()));
    await pH.fill('#firstName', 'Welcomed'); await pH.waitForTimeout(400);
    ok('deck: typing in a field brings its card into view', (await pH.inputValue('#firstName')) === 'Welcomed' && (await state()).card === 'fields', (await state()).card);
    // The next start is a new tab in the same browser profile, not a reload: in Playwright's WebKit (Safari's engine, desktop
    // and iPhone) any navigation after reloading a page that pushed a history entry (the Back guard) hangs or crashes,
    // even on a plain page with no vCGE code (Ghost's probe, 2026-10-19), and START OVER below navigates. The old tab's
    // own session storage is checked before it closes, so nothing a reload would have kept goes unchecked.
    const lastTab = await stored();
    const oldH = pH; pH = await openH(); await oldH.close();
    ok('welcome: shows again on the next start (nothing remembers it was seen)', lastTab === 0 && (await state()).welcomeCurrent && (await stored()) === 0, String(lastTab));
    await pH.click('#welcomePinBtn');
    ok('welcome: Set Up PIN/BIO Lock Now opens the Vault page', (await state()).vault && await pH.isVisible('#pinSwitch'));
    await pH.keyboard.press('Escape');
    ok('deck: Esc closes a sheet', !(await state()).vault);
    await pH.click('#welcomeSampleBtn'); await pH.waitForTimeout(700);
    ok('welcome: "Play with sample fields" goes to the Fields card', (await state()).card === 'fields', (await state()).card);
    await pH.keyboard.press('ArrowLeft'); await pH.waitForTimeout(700);
    ok('deck: the arrow keys move one card at a time', (await state()).card === 'read', (await state()).card);
    await pH.click('#navCard'); await pH.waitForTimeout(700);
    ok('deck: a header icon jumps to its card', (await state()).card === 'card', (await state()).card);
    await deckSettled(pH);
    await pH.focus('#firstName'); await pH.waitForTimeout(400);
    await pH.keyboard.press('ArrowLeft'); await pH.waitForTimeout(300);
    ok('deck: the arrow keys leave the deck alone while typing', (await state()).card === 'fields', (await state()).card);
    await pH.evaluate(() => document.getElementById('cardCapture').scrollIntoView({ inline: 'center', block: 'nearest' })); await pH.waitForTimeout(400);
    ok('deck: a swipe (scroll) settles on the nearest card', (await state()).card === 'capture', (await state()).card);
    await pH.evaluate(() => document.getElementById('cardWelcome').scrollIntoView({ inline: 'center', block: 'nearest' })); await pH.waitForTimeout(400);
    await pH.click('#welcomeCancelBtn'); await pH.waitForTimeout(300);
    const cancelled = await state();
    ok('welcome: CANCEL wipes the card and shows the Thank You page with START OVER focused', cancelled.thanks && cancelled.focus === 'thankYouStartOverBtn' && (await pH.inputValue('#firstName')) === ''
      && (await pH.textContent('#thankYouStartOverBtn')) === 'START OVER' && (await pH.textContent('#thankYouCloseBtn')) === 'CLOSE WINDOW', JSON.stringify(cancelled));
    await pH.evaluate(() => { window.close = () => {}; });   // a tab the user opened cannot be closed by the page; the note covers that
    await pH.click('#thankYouCloseBtn'); await pH.waitForTimeout(500);
    ok('thank you: CLOSE WINDOW in a browser tab says the tab can be closed', (await pH.textContent('#thankYouNote')).includes('close this tab'));
    await pH.click('#thankYouStartOverBtn'); await pH.waitForTimeout(600);
    ok('thank you: START OVER starts fresh on the Welcome card', (await state()).welcomeCurrent && !(await state()).thanks && (await stored()) === 0);
    // A second round: START OVER opens vCGE afresh the way a wipe does, in place of the page's history entry. A reload
    // of the Back guard's entry hung WebKit (Safari's engine) on the second time round.
    await pH.click('#welcomeCancelBtn'); await pH.waitForTimeout(300);
    await pH.click('#thankYouStartOverBtn'); await pH.waitForTimeout(600);
    ok('thank you: START OVER a second time starts fresh again', (await state()).welcomeCurrent && !(await state()).thanks && (await stored()) === 0);

    await pH.click('#welcomeTourBtn');
    await pH.waitForTimeout(700);
    // Bigger tour text in a wider panel (#33), and Skip tour a full button like Back and Next, only quieter (#34)
    const tipLook = await pH.evaluate(() => { const tip = document.getElementById('tourTip'), skip = document.getElementById('tourSkipBtn'), next = document.getElementById('tourNextBtn'), s = getComputedStyle(skip);
      return { w: tip.getBoundingClientRect().width, vw: document.documentElement.clientWidth, title: parseFloat(getComputedStyle(document.getElementById('tourTitle')).fontSize),
        body: parseFloat(getComputedStyle(document.getElementById('tourBody')).fontSize), skipH: skip.getBoundingClientRect().height, nextH: next.getBoundingClientRect().height,
        pad: parseFloat(s.paddingLeft), bg: s.backgroundColor, border: s.borderTopStyle }; });
    ok('tour: the panel is up to 30rem wide with bigger type', Math.abs(tipLook.w - Math.min(480, tipLook.vw - 32)) < 1 && tipLook.title >= 22 && tipLook.body >= 16.5, JSON.stringify(tipLook));
    ok('tour: Skip tour is a full button (padding, fill and edge) as tall as Next', tipLook.pad >= 16 && tipLook.bg !== 'rgba(0, 0, 0, 0)' && tipLook.border !== 'none' && Math.abs(tipLook.skipH - tipLook.nextH) < 1, JSON.stringify(tipLook));
    const titles = [];
    for (let i = 0; i < 6; i++) {
      await pH.waitForTimeout(700);
      const s = await pH.evaluate((i) => {
        const spot = document.getElementById('tourSpot').getBoundingClientRect(), tip = document.getElementById('tourTip').getBoundingClientRect();
        const area = (i < 4 ? document.getElementById(['cardCapture', 'cardFields', 'cardCard', 'cardShare'][i])
          : i === 4 ? document.querySelector('#vaultPage .vcge-sheet-panel') : document.querySelector('header')).getBoundingClientRect();
        // The spotlight surrounds the area as far as it is on screen (its outline is pulled 4 px in at the screen edge)
        const covers = spot.left <= Math.max(area.left, 4) + 1 && spot.top <= Math.max(area.top, 4) + 1 && spot.right >= Math.min(area.right, innerWidth - 4) - 1 && spot.bottom >= Math.min(area.bottom, innerHeight - 4) - 1;
        return { covers, step: document.getElementById('tourStep').textContent, title: document.getElementById('tourTitle').textContent, next: document.getElementById('tourNextBtn').textContent,
          spot: [spot.left, spot.top, spot.right, spot.bottom], tip: [tip.left, tip.top, tip.right, tip.bottom], vw: document.documentElement.clientWidth, vh: innerHeight,
          focus: document.activeElement && document.activeElement.id, card: document.documentElement.dataset.card, vault: !document.getElementById('vaultPage').classList.contains('hidden') };
      }, i);
      titles.push(s);
      if (i < 5) await pH.click('#tourNextBtn');
    }
    ok('tour: six steps in order, "Step N of 6", Next focused', titles.map(t => t.title).join('|') === 'Scan a business card|Check the details|Your 3D card|Share when you choose|Your card stays private|You’re ready'
      && titles.every((t, i) => t.step === `Step ${i + 1} of 6` && t.focus === 'tourNextBtn'), titles.map(t => t.title + ' ' + t.step).join(' | '));
    ok('tour: the deck moves to each step\'s card and the Vault page opens for its step only', titles.map(t => t.card).join('|') === 'capture|fields|card|share|share|share'
      && titles.map(t => t.vault ? 1 : 0).join('') === '000010', titles.map(t => t.card + (t.vault ? '+vault' : '')).join('|'));
    ok('tour: each step spotlights its area (scan, fields, card, share, Vault page, header)', titles.every(t => t.covers), JSON.stringify(titles.map(t => t.spot)));
    ok('tour: the last step\'s button is START NOW', titles[5].next === 'START NOW' && titles.slice(0, 5).every(t => t.next === 'Next'));
    // The tip sits beside a small area (the Vault page, the header); a whole card leaves no room beside it, so there it sits over the card
    const beside = (t) => t.tip[0] >= t.spot[2] || t.tip[2] <= t.spot[0] || t.tip[1] >= t.spot[3] || t.tip[3] <= t.spot[1];
    const noRoom = (t) => { const w = t.tip[2] - t.tip[0] + 32, h = t.tip[3] - t.tip[1] + 32; return t.spot[0] < w && t.vw - t.spot[2] < w && t.spot[1] < h && t.vh - t.spot[3] < h; };
    ok('tour: every card fits on screen and covers its spotlight only when there is no room beside it', titles.every(t => t.tip[0] >= 0 && t.tip[1] >= 0 && t.tip[2] <= t.vw && t.tip[3] <= t.vh
      && (beside(t) || noRoom(t))) && beside(titles[4]) && beside(titles[5]), JSON.stringify(titles.map(t => [t.spot, t.tip])));
    await pH.click('#tourBackBtn');
    ok('tour: Back goes to the previous step', (await pH.textContent('#tourTitle')) === 'Your card stays private' && (await state()).vault);
    await pH.keyboard.press('ArrowRight');
    await pH.click('#tourNextBtn'); await pH.waitForTimeout(700);
    const ended = await state();
    ok('tour: START NOW on the last step closes it on the Capture card', !ended.layer && !ended.vault && ended.card === 'capture', JSON.stringify(ended));

    { const oldH = pH; pH = await openH(); await oldH.close(); }     // a new tab, not a reload (WebKit: see above)
    await pH.click('#welcomeTourBtn'); await pH.click('#tourSkipBtn'); await pH.waitForTimeout(700);
    ok('tour: Skip tour closes it', !(await state()).layer && (await state()).card === 'capture');

    // Phone size: one card fills the screen; the tour card sits under (or over) the area and stays on screen at every step
    { const oldH = pH; pH = await openH(); await oldH.close(); }
    await pH.setViewportSize({ width: 390, height: 844 }); await pH.waitForTimeout(400);
    const phoneDeck = await pH.evaluate(() => { const r = document.getElementById('cardWelcome').getBoundingClientRect(); return { l: r.left, r: r.right, w: innerWidth, sw: document.documentElement.scrollWidth, side: document.documentElement.scrollWidth <= innerWidth }; });
    ok('phone: the Welcome card fills the width and the page does not scroll sideways', phoneDeck.l >= 0 && phoneDeck.r <= 390 && phoneDeck.r - phoneDeck.l >= 370 && phoneDeck.side, JSON.stringify(phoneDeck));
    await pH.click('#welcomeTourBtn');
    const phone = [];
    for (let i = 0; i < 6; i++) {
      await pH.waitForTimeout(700);
      phone.push(await pH.evaluate(() => { const r = document.getElementById('tourTip').getBoundingClientRect(); return { side: document.getElementById('tourTip').dataset.side, l: r.left, t: r.top, r: r.right, b: r.bottom }; }));
      if (i < 5) await pH.click('#tourNextBtn');
    }
    ok('tour on a phone: every card stays on screen, never beside the area', phone.every(p => p.l >= 0 && p.t >= 0 && p.r <= 390 && p.b <= 844 && p.side !== 'right' && p.side !== 'left'), JSON.stringify(phone));
    await pH.click('#tourNextBtn');
    ok('welcome: nothing stored, no outside requests, no page errors', (await stored()) === 0 && externalH.length === 0 && errorsH.length === 0,
      externalH.concat(errorsH).join(' | '));
    await ctxH.close();
  }

  // MOD01 shared look: MOD-XX tags in Sixtyfour on every panel, 44 px buttons with 2 px outlines, the near-miss rim for taps
  {
    const ctxU = await browser.newContext({ hasTouch: true, viewport: { width: 1280, height: 800 } });
    const pU = await ctxU.newPage();
    const errorsU = [], missingU = [];
    pU.on('pageerror', e => errorsU.push(e.message));
    pU.on('response', r => { if (r.status() >= 400) missingU.push(`${r.status()} ${r.url()}`); });
    const sixtyfourU = [];
    pU.on('request', r => { if (/sixtyfour/i.test(r.url())) sixtyfourU.push(r.url()); });
    await pU.goto(ORIGIN); await pU.waitForTimeout(500);
    if (EDITION_PLAIN) {
      // The plain edition shows no MOD tag anywhere, names no pilot, gives the 3D Card the tags' room back, and never
      // fetches the tags' Sixtyfour font
      ok('plain edition: no MOD tag is shown on any card or sheet, and none names a pilot', await pU.evaluate(() => Array.from(document.querySelectorAll('.mod-tag'))
        .every(t => getComputedStyle(t).display === 'none' && t.getBoundingClientRect().width === 0 && !t.querySelector('[data-pilot]'))));
      await pU.click('#navVault');
      ok('plain edition: the Vault page shows no tag', await pU.isVisible('#vaultPage') && await pU.$eval('#vaultPage .mod-tag', t => t.getBoundingClientRect().width === 0));
      await pU.click('#vaultPage [data-sheet-close]');
      ok('plain edition: the 3D Card\'s content starts where every other card\'s does (no room kept for tags)',
        await pU.evaluate(() => getComputedStyle(document.querySelector('#cardCard > .deck-card-body')).paddingTop === getComputedStyle(document.querySelector('#cardFields > .deck-card-body')).paddingTop));
      ok('plain edition: the Sixtyfour font is never fetched', !sixtyfourU.length && await pU.evaluate(() => !Array.from(document.fonts).some(f => f.family.includes('Sixtyfour') && f.status !== 'unloaded')), sixtyfourU.join(' '));
    } else {
      const tags = await pU.evaluate(async () => {
        await document.fonts.ready;
        // The cards' tags (the Vault page's MOD-02 shows only when that sheet is open; Settings has none)
        return Array.from(document.querySelectorAll('.deck-card > .mod-tag')).map(t => {
          const span = t.querySelector('span'), host = t.parentElement.getBoundingClientRect(), r = t.getBoundingClientRect();
          // On the card's top edge (half above it, so over none of the card's own content), near the right corner
          return { text: Array.from(t.children).map(c => c.textContent).join(' '), font: getComputedStyle(span).fontFamily, size: getComputedStyle(span).fontSize,
            onEdge: Math.abs((r.top + r.bottom) / 2 - host.top) <= 2 && host.right - r.right > 8 && host.right - r.right < 24 };
        });
      });
      ok('MOD-XX tags: every card shows its module tag, in step order', tags.map(t => t.text).join('|') === 'MOD-01|MOD-03|MOD-04|MOD-05|MOD-06 MOD-07|MOD-08', tags.map(t => t.text).join('|'));
      ok('MOD-XX tags: same spot (on the top edge by the right corner), same font (Sixtyfour) and size', tags.every(t => t.onEdge && /Sixtyfour/.test(t.font) && t.size === tags[0].size), JSON.stringify(tags));
      // One block per tag: the pilot's name, then the number, in solid pixels (#2, #3, #45, #96)
      const drawnText = (content) => (content.match(/"(?:[^"\\]|\\.)*"/g) || []).map(q => q.slice(1, -1)).join('');
      const look = await pU.evaluate(() => Array.from(document.querySelectorAll('.deck-card > .mod-tag span')).map(s => ({ pilot: s.dataset.pilot,
        before: getComputedStyle(s, '::before').content, axes: getComputedStyle(s).fontVariationSettings, shadow: getComputedStyle(s).textShadow })));
      ok('MOD-XX tags: each names its pilot before the number ("GLYPH:  MOD-04"), at the font\'s own stroke (not bold), no bleed, a crisp 27% shadow', look.map(l => l.pilot).join('|') === 'Shutout|Iris|Glyph|Pidge|Flipside|Checkers|Airlock'
        // Firefox reports the rule itself (attr(data-pilot) then the colon), not the text it draws; WebKit reports the name and
        // the colon as two quoted strings ("Glyph" ":  "), Chromium as one. Either way the name comes first, then the colon.
        && look.every(l => (drawnText(l.before).startsWith(l.pilot + ':') || /^attr\(data-pilot\) ":/.test(l.before)) && /"BLED" 0/.test(l.axes) && /"SCAN" 0\b/.test(l.axes) && /rgba\(0, 0, 0, 0\.27\) 1px 1px 0px|1px 1px 0px rgba\(0, 0, 0, 0\.27\)/.test(l.shadow)), JSON.stringify(look));
      await pU.click('#navFields'); await pU.waitForTimeout(600);
      // The fade is a 0.2 s transition: wait up to 3 s for it to come to rest (a fixed 450 ms caught the iPhone run mid-fade, at 0.43)
      const tagFade = async (y) => { await pU.$eval('#cardFields > .deck-card-body', (b, y) => { b.scrollTop = y; }, y); await pU.waitForTimeout(450);
        await pU.waitForFunction(() => document.getElementById('cardFields').querySelector(':scope > .mod-tag').getAnimations().length === 0, null, { timeout: 3000 }).catch(() => {});
        return pU.$eval('#cardFields > .mod-tag', t => ({ faded: t.classList.contains('is-faded'), opacity: parseFloat(getComputedStyle(t).opacity) })); };
      const fadedDown = await tagFade(120), fadedTop = await tagFade(0);
      ok('MOD-XX tags: a card\'s tag fades to 36% while its content is scrolled up under it, and comes back at the top', fadedDown.faded && Math.abs(fadedDown.opacity - 0.36) < 0.02 && !fadedTop.faded && fadedTop.opacity === 1,
        JSON.stringify([fadedDown, fadedTop]));
      // No tag ever sits on something that can be pressed (video review #9, #10, #87): every card, and each sheet
      const tagOverControl = () => pU.evaluate(() => {
        const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom && a.width > 0 && b.width > 0;
        return Array.from(document.querySelectorAll('.mod-tag')).filter(t => t.offsetParent).flatMap(t => {
          const r = t.getBoundingClientRect();
          return Array.from(t.parentElement.querySelectorAll('button, input, select, textarea, label, a[href]')).filter(c => c.offsetParent && hit(r, c.getBoundingClientRect())).map(c => `${t.textContent.trim()} on ${c.id || c.textContent.trim().slice(0, 20)}`);
        });
      });
      const covered = [];
      for (const nav of ['#navWelcome', '#navCapture', '#navRead', '#navFields', '#navCard', '#navShare']) { await pU.click(nav); await pU.waitForTimeout(600); covered.push(...await tagOverControl()); }
      ok('MOD-XX tags: none sits on a button or a field of its card (Flip card included)', covered.length === 0, covered.join(' | '));
      await pU.click('#navVault');
      ok('MOD-XX tags: the Vault page carries MOD-02, in its title row clear of the close button', await pU.$eval('#vaultPage .mod-tag', t => t.textContent.trim() === 'MOD-02' && t.getBoundingClientRect().width > 0)
        && (await tagOverControl()).length === 0 && await pU.$eval('#vaultPage .mod-tag', t => { const r = t.getBoundingClientRect(), p = t.parentElement.getBoundingClientRect(); return r.top >= p.top && r.right <= p.right; }));
      await pU.click('#vaultPage [data-sheet-close]');
      await pU.click('#navSettings');
      ok('MOD-XX tags: the Settings sheet carries none (raven575, video review #9)', await pU.$$eval('#settingsSheet .mod-tag', t => t.length) === 0 && await pU.isVisible('#settingsSheet'));
      await pU.click('#settingsSheet [data-sheet-close]');
      ok('MOD-XX tags: the bundled Sixtyfour font loads', await pU.evaluate(async () => { await document.fonts.load('10px Sixtyfour'); return document.fonts.check('10px Sixtyfour'); }));
    }
    const small = await pU.evaluate(() => Array.from(document.querySelectorAll('button:not(.crop-handle), label'))
      .filter(b => (b.tagName === 'BUTTON' || b.querySelector(':scope > input[type=file]')) && b.offsetParent)
      .map(b => { const cs = getComputedStyle(b); return { id: b.id || b.textContent.trim().slice(0, 20), h: b.offsetHeight, w: b.offsetWidth, border: cs.borderTopWidth }; })   // layout size: cards out of view are drawn smaller
      .filter(b => b.h < 43.5 || b.w < 43.5 || b.border !== '2px'));
    ok('buttons: every visible button is at least 44 px with a 2 px outline', small.length === 0, JSON.stringify(small));
    // A finger tap on the outer 4 px of a button is ignored; in the middle it works; a mouse click on the edge still works
    await pU.click('#navCard'); await pU.waitForTimeout(700);
    const flip = await pU.locator('#flipCardBtn').boundingBox();
    const turned = () => pU.$eval('#card3DFlipper', el => el.style.transform);
    await pU.touchscreen.tap(flip.x + flip.width / 2, flip.y + 1.5); await settled(pU);
    ok('near miss: a tap on a button\'s edge does nothing', (await turned()) !== 'rotateY(180deg)', await turned());
    await pU.touchscreen.tap(flip.x + flip.width / 2, flip.y + flip.height / 2); await settled(pU);
    ok('a tap in the middle of the button works', (await turned()) === 'rotateY(180deg)', await turned());
    if (ENGINE === 'firefox') {
      // Playwright's Firefox sends no pointer events for the mouse in a page with touch turned on, so the app would never
      // see this click start. The mouse click runs in a mouse-only page instead.
      const ctxM = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const pM = await ctxM.newPage();
      await pM.goto(ORIGIN); await pM.waitForTimeout(500);
      await pM.click('#navCard'); await pM.waitForTimeout(700);
      const flipM = await pM.locator('#flipCardBtn').boundingBox();
      await pM.mouse.click(flipM.x + flipM.width / 2, flipM.y + 1.5); await settled(pM);
      const turnedM = await pM.$eval('#card3DFlipper', el => el.style.transform);
      ok('a mouse click on the edge still works (only fingers get the near-miss guard)', turnedM === 'rotateY(180deg)', `${turnedM} (mouse-only page)`);
      await ctxM.close();
    } else {
      await pU.mouse.click(flip.x + flip.width / 2, flip.y + 1.5); await settled(pU);
      ok('a mouse click on the edge still works (only fingers get the near-miss guard)', (await turned()) === 'rotateY(0deg)', await turned());
    }
    await pU.setViewportSize({ width: 390, height: 844 });
    // Read after two frames, as the header checks do: the header drops its names on its resize observer's frame.
    await pU.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    ok('phone width: the app reports the phone layout and nothing scrolls sideways', await pU.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--vcge-layout').trim() === 'phone' && document.documentElement.scrollWidth <= innerWidth));
    ok('shared look: no missing files, no page errors', missingU.length === 0 && errorsU.length === 0, missingU.concat(errorsU).join(' | '));
    await ctxU.close();
  }

  // MOD01 fixes from raven575's iPad video (2026-10-17): the header never overlaps, the swipe waits for the finger and
  // goes one card, the tablet's first card centres, Shutout's own icon, one lit icon for the 3D card, the timer strip
  // never covers a card's title, and the tour stays under the lock screen
  {
    // Playwright's Firefox has no mobile mode (isMobile); the iPad size and touch still apply there
    const ctxV = await browser.newContext({ hasTouch: true, ...(ENGINE === 'firefox' ? {} : { isMobile: true }), viewport: { width: 1024, height: 1366 } });
    const pV = await ctxV.newPage();
    const errorsV = [];
    pV.on('pageerror', e => errorsV.push(e.message));
    pV.on('console', m => { if (m.type() === 'error') errorsV.push('console: ' + m.text()); });
    await pV.goto(ORIGIN); await pV.waitForTimeout(500);
    const deckState = () => pV.evaluate(() => ({ left: Math.round(document.getElementById('deck').scrollLeft), deck: document.getElementById('deck').dataset.deck, card: document.documentElement.dataset.card }));
    // Every header button is clear of its neighbours (as far as each shows), with or without the pilot names
    const header = () => pV.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => {
      const h = document.querySelector('.deck-header'), nav = h.querySelector('.deck-nav').getBoundingClientRect();
      const boxes = Array.from(h.querySelectorAll('button')).filter(b => b.offsetParent).map(b => {
        const r = b.getBoundingClientRect(), inNav = !!b.closest('.deck-nav');
        return { id: b.id, l: inNav ? Math.max(r.left, nav.left) : r.left, r: inNav ? Math.min(r.right, nav.right) : r.right, spill: b.scrollWidth > b.clientWidth + 0.5 };
      }).filter(b => b.r > b.l).sort((a, b) => a.l - b.l);   // in screen order: left hand mirrors the header
      const overlaps = boxes.slice(1).filter((b, i) => b.l < boxes[i].r - 0.5).map(b => b.id);
      done({ compact: h.classList.contains('is-compact'), names: getComputedStyle(h.querySelector('#navCapture span')).display !== 'none', overlaps, spills: boxes.filter(b => b.spill).map(b => b.id), wide: document.documentElement.scrollWidth > innerWidth });
    }))));
    await pV.setViewportSize({ width: 1366, height: 1024 });
    const land = await header();
    ok('header (iPad landscape): pilot names beside the icons, nothing overlapping', land.names && !land.compact && land.overlaps.length === 0 && land.spills.length === 0 && !land.wide, JSON.stringify(land));
    await setPin(pV, '1357');
    await pV.setViewportSize({ width: 1024, height: 1366 });
    const port = await header();
    ok('header (iPad portrait, Lock button showing): icons only, nothing overlapping (video #16)', await pV.isVisible('#lockVaultBtn') && port.compact && !port.names && port.overlaps.length === 0 && port.spills.length === 0 && !port.wide, JSON.stringify(port));
    // Left hand mirrors the header (row-reverse), so the nav spills to its left; it must drop to icons only exactly like
    // right hand (raven575, 2026-10-18: on the iPad the names came back, squeezed). Every button stays inside the nav.
    const inNav = () => pV.evaluate(() => { const box = document.querySelector('.deck-nav').getBoundingClientRect();
      return Array.from(document.querySelectorAll('.deck-nav button')).filter(b => { const r = b.getBoundingClientRect(); return r.left < box.left - 0.5 || r.right > box.right + 0.5; }).map(b => b.id); });
    await pV.evaluate(() => document.getElementById('handLeftBtn').click());
    const portLeft = await header(), outLeft = await inNav();
    ok('header (iPad portrait, left hand): icons only like right hand, every button inside the header', await pV.evaluate(() => document.documentElement.dataset.hand) === 'left'
      && portLeft.compact && !portLeft.names && portLeft.overlaps.length === 0 && outLeft.length === 0 && !portLeft.wide, JSON.stringify({ portLeft, outLeft }));
    await pV.evaluate(() => document.getElementById('handRightBtn').click());
    for (const w of [900, 390, 360]) {
      await pV.setViewportSize({ width: w, height: 800 });
      const hw = await header();
      ok(`header at ${w} px: no button runs into another, nothing scrolls sideways`, hw.overlaps.length === 0 && hw.spills.length === 0 && !hw.wide, JSON.stringify(hw));
    }
    await pV.setViewportSize({ width: 1024, height: 1366 }); await pV.waitForTimeout(300);
    await pV.click('#navWelcome'); await pV.waitForTimeout(700);
    const centred = await pV.evaluate(() => { const r = document.getElementById('cardWelcome').getBoundingClientRect(); return { l: r.left, r: innerWidth - r.right }; });
    ok('tablet: the Welcome card comes to the middle like every other card (it sat against the left edge)', Math.abs(centred.l - centred.r) <= 1.5 && centred.l > 20, JSON.stringify(centred));
    ok('header: Shutout\'s own icon brings back the start page and is lit there (video #30, #91)', (await deckState()).card === 'welcome'
      && await pV.$eval('#navWelcome', (b, plain) => b.classList.contains('is-on') && b.getAttribute('aria-current') === 'page' && (plain ? b.getAttribute('aria-label') === 'Start page: welcome and the tour' : /Shutout/.test(b.getAttribute('aria-label'))), EDITION_PLAIN));

    // A finger swipe: the deck never moves under a finger that pauses, and on release goes one card in the swipe's direction
    // The finger is sent through the Chrome DevTools Protocol, which only Chromium has. Real Chrome and Edge on a desktop
    // turn that sent touch into the browser's back-swipe instead of scrolling the deck (the page gets the same touch
    // events; the deck never scrolls and the tab goes back), so the deck swipes run in Playwright's Chromium only.
    const cdp = ENGINE === 'chromium' ? await ctxV.newCDPSession(pV) : null;
    if (cdp && !CHANNELS[BROWSER]) {
      const touch = async (from, to, holdMs = 0) => {
        const y = 900; let x = from;
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
        const step = (to - from) / 12;
        for (let i = 0; i < 12; i++) { x += step; await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] }); await pV.waitForTimeout(16); }
        if (holdMs) await pV.waitForTimeout(holdMs);
        const during = await deckState();
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await pV.waitForTimeout(150);
        await deckSettled(pV); await pV.waitForTimeout(150);
        return during;
      };
      await pV.click('#navCapture'); await pV.waitForTimeout(700);
      const rest = (await deckState()).left;
      const paused = await touch(300, 600, 400);
      ok('swipe: a finger that pauses mid-swipe keeps the deck where it put it (it snapped back under the finger, video #11)', paused.deck === 'held' && paused.left < rest - 200 && paused.card === 'capture', JSON.stringify({ rest, paused }));
      ok('swipe: on release the deck eases to the card it was heading for, the start page (video #30)', (await deckState()).card === 'welcome' && (await deckState()).left === 0, JSON.stringify(await deckState()));
      await touch(600, 580);
      ok('swipe: a nudge shorter than 24 px goes back to the same card', (await deckState()).card === 'welcome', JSON.stringify(await deckState()));
      await touch(700, 500);
      ok('swipe: a short swipe goes on to the next card', (await deckState()).card === 'capture', JSON.stringify(await deckState()));
      await touch(1000, 20);
      ok('swipe: a long fling still stops at the next card, not two on', (await deckState()).card === 'read', JSON.stringify(await deckState()));
      // raven575 (2026-10-18): on the iPad a fling kept the deck sliding past the card, then it turned back. The deck now
      // settles as the finger lifts and stops the fling. The sent finger above cannot fling the way Safari does, so this
      // one plays it out on the page: touch events, the finger's scroll, then a fling that coasts on after the lift
      // (well past the next card) unless the track is made unscrollable, as Safari's fling is.
      await pV.click('#navWelcome'); await pV.waitForTimeout(700);
      const fling = await pV.evaluate(() => new Promise(done => {
        const t = document.getElementById('deck'), at = (x) => [new Touch({ identifier: 1, target: t, clientX: x, clientY: 900 })];
        const send = (type, touches) => t.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches, targetTouches: touches, changedTouches: at(500) }));
        const xs = [];
        t.addEventListener('scroll', () => xs.push(t.scrollLeft), { passive: true });
        send('touchstart', at(700));
        let i = 0;
        const drag = () => {
          if (++i <= 12) { t.scrollLeft += 16; send('touchmove', at(700 - 16 * i)); requestAnimationFrame(drag); return; }
          send('touchend', []);
          const lifted = document.documentElement.dataset.card;
          let v = 40, stopped = false, n = 0;
          const coast = () => {
            if (t.style.overflowX === 'hidden') stopped = true;
            if (!stopped && n < 60) t.scrollLeft += v;
            v *= 0.95;
            if (++n < 90) requestAnimationFrame(coast);
            else done({ lifted, xs });
          };
          requestAnimationFrame(coast);
        };
        requestAnimationFrame(drag);
      }));
      await deckSettled(pV); await pV.waitForTimeout(150);
      const flung = await deckState(), from = fling.xs.indexOf(Math.max(...fling.xs));
      const turnedBack = fling.xs.slice(from + 1).some(x => x < Math.max(...fling.xs) - 2);
      ok('swipe: a fling stops as the finger lifts and the deck eases on to the next card, never sliding past it and turning back',
        fling.lifted === 'capture' && flung.card === 'capture' && !turnedBack, JSON.stringify({ lifted: fling.lifted, flung, turnedBack, peak: Math.max(...fling.xs) }));
    } else notRunHere('swipe: the deck under a finger (6 checks)', cdp ? 'real Chrome and Edge on a desktop turn a sent touch into the back-swipe, not a scroll' : 'touch is sent through the Chrome DevTools Protocol, which only Chromium has');

    // The 3D card's two header icons: only the one for the side that is up is lit, and Flipside turns it back
    // Each waits up to 3 s for its icon to light (a fixed 800 ms wait flaked under load), then checks the same thing
    const lit = () => pV.$$eval('.deck-nav button.is-on', b => b.map(x => x.id).join(','));
    const litOnly = (id) => pV.waitForFunction((id) => Array.from(document.querySelectorAll('.deck-nav button.is-on')).map(x => x.id).join(',') === id, id, { timeout: 3000 }).catch(() => {});
    await pV.click('#navQr'); await litOnly('navQr');
    ok('header: on the QR side only Checkers is lit (video #82)', (await lit()) === 'navQr', await lit());
    await pV.click('#navCard'); await litOnly('navCard'); await pV.waitForTimeout(800);
    ok('header: Flipside turns the card back to its front and only Flipside is lit', (await lit()) === 'navCard' && (await pV.$eval('#card3DFlipper', el => el.style.transform)) === 'rotateY(0deg)', await lit());

    // The timer strip under the header never covers a card's title (video #95): the deck keeps its height free
    await pV.click('#navFields'); await pV.waitForTimeout(700);
    await pV.fill('#firstName', 'Shutout'); await pV.waitForTimeout(1300);
    const strip = await pV.evaluate(() => {
      const band = document.getElementById('vaultTimerBand').getBoundingClientRect();
      const tops = Array.from(document.querySelectorAll('.deck-card')).map(c => { const t = c.querySelector('.mod-tag').getBoundingClientRect(); return t.width ? Math.min(c.getBoundingClientRect().top, t.top) : c.getBoundingClientRect().top; });   // plain: no tags shown
      return { shown: !document.getElementById('vaultTimerStrip').classList.contains('hidden'), bottom: band.bottom, top: Math.min(...tops) };
    });
    ok('timer strip: shown with a card in progress, and every card and its MOD tag start below it', strip.shown && strip.top >= strip.bottom, JSON.stringify(strip));

    // The tour stays under the lock screen: a lock that comes down mid-tour is on top, its PIN box takes the keys
    await pV.click('#navWelcome'); await pV.waitForTimeout(700);
    await pV.click('#welcomeTourBtn'); await pV.waitForTimeout(700);
    await pV.evaluate(() => document.getElementById('lockVaultBtn').click());     // as the idle timer would
    await pV.waitForSelector('#vaultModal', { state: 'visible' });
    const onTop = await pV.evaluate(() => { const r = document.getElementById('vaultPin').getBoundingClientRect(); const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!el && !!el.closest('#vaultModal'); });
    ok('tour: the lock screen comes down on top of it and its PIN box can be reached (video #35)', onTop);
    await pV.focus('#vaultPin'); await pV.keyboard.press('ArrowRight');
    ok('tour: keys typed into the lock screen do not move the tour', (await pV.textContent('#tourStep')) === 'Step 1 of 6');
    await pV.fill('#vaultPin', '1357'); await pV.waitForSelector('#vaultModal', { state: 'hidden' }); await pV.waitForTimeout(300);
    // A sideways swipe on the tour goes to the next step, and back
    const swipeTour = async (from, to) => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from, y: 300 }] });
      for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from + (to - from) * i / 8, y: 300 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await pV.waitForTimeout(500);
      return pV.textContent('#tourStep');
    };
    if (cdp) ok('tour: a swipe right to left goes to the next step, left to right back to the first (video #36)', (await swipeTour(800, 300)) === 'Step 2 of 6' && (await swipeTour(300, 800)) === 'Step 1 of 6');
    else notRunHere('tour: a swipe right to left goes to the next step, left to right back to the first (video #36)', 'touch is sent through the Chrome DevTools Protocol, which only Chromium has');
    await pV.click('#tourSkipBtn');
    ok('video fixes: no page errors', errorsV.length === 0, errorsV.join(' | '));
    await ctxV.close();
  }

  // 3D Card (MOD06, redesign step 8): fall themes on the card face, every line with its label, swipe-to-spin, toasts
  // at the top, the pilots as samples with their animal logos, the Logo controls on this card
  {
    // Playwright's Firefox sends no pointer events for the mouse in a page with touch turned on (only mousedown, mouseup
    // and click), so the presses below would never reach the app there. The app never looks for touch, so Firefox runs
    // this page without it.
    const ctx6 = await browser.newContext({ hasTouch: ENGINE !== 'firefox' });
    const p6 = await ctx6.newPage();
    const errors6 = [], external6 = [], missing6 = [];
    p6.on('pageerror', e => errors6.push(e.message));
    p6.on('console', m => { if (m.type() === 'error') errors6.push('console: ' + m.text()); });
    p6.on('request', r => { if (!r.url().startsWith(ORIGIN) && !/^(data|blob):/.test(r.url())) external6.push(r.url()); });
    p6.on('response', r => { if (r.status() >= 400) missing6.push(`${r.status()} ${r.url()}`); });
    await p6.goto(ORIGIN); await p6.waitForTimeout(300);
    await p6.click('#navCard'); await p6.waitForTimeout(700);
    const rgb = (hex) => `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`;
    const face = () => p6.$eval('#cardFront', el => { const cs = getComputedStyle(el); return { bg: cs.backgroundColor, ink: cs.color }; });
    ok('card: the default theme is Slate Blue, on the card face and in the picker', (await face()).bg === rgb('#3e5572') && (await face()).ink === rgb('#eef3f9') && (await p6.textContent('#currentPaletteLabel')) === 'Slate Blue', JSON.stringify(await face()));
    // The make-it-cute touches (D2, D3): still pictures, hidden from screen readers, gone in the plain edition
    const cute = await p6.evaluate(() => {
      const peek = document.querySelector('#cardBack .card-peek'), tail = document.querySelector('#flipCardBtn .flip-tail'), btn = document.getElementById('flipCardBtn');
      const back = document.getElementById('cardBack').getBoundingClientRect(), qr = document.getElementById('qrCanvas').getBoundingClientRect(), pk = peek.getBoundingClientRect();
      return { peekShown: getComputedStyle(peek).display !== 'none', tailShown: getComputedStyle(tail).display !== 'none', hidden: peek.getAttribute('aria-hidden') === 'true' && tail.getAttribute('aria-hidden') === 'true',
        label: btn.textContent.trim(), noPress: getComputedStyle(peek).pointerEvents === 'none', moving: peek.getAnimations().length + tail.getAnimations().length,
        onEdge: Math.abs(pk.bottom - back.bottom) <= 2 && pk.right <= back.right - 16, clearOfQr: pk.top >= qr.bottom || pk.left >= qr.right };
    });
    if (EDITION_PLAIN) ok('plain edition: no chameleon on the card\'s back and no tail on Flip card; the button still reads "Flip card"', !cute.peekShown && !cute.tailShown && cute.label === 'Flip card', JSON.stringify(cute));
    else ok('card: Flipside peeks up over the bottom edge of the back, clear of the QR code, still and untouchable; Flip card has its curled tail and still reads "Flip card"; both hidden from screen readers',
      cute.peekShown && cute.tailShown && cute.hidden && cute.label === 'Flip card' && cute.noPress && cute.moving === 0 && cute.onEdge && cute.clearOfQr, JSON.stringify(cute));
    ok('card: with no logo the card has no rim', await p6.$eval('#card3DFlipper', el => !('rim' in el.dataset) && getComputedStyle(document.getElementById('cardFront'), '::after').opacity === '0'));
    ok('card: the picker lists the eight fall palettes in order', (await p6.$$eval('#paletteListContainer button', bs => bs.map(b => b.textContent.trim()).join('|'))) === 'Pumpkin|Maple|Harvest Gold|Cranberry|Spruce|Sage|Slate Blue|Twilight');
    await p6.click('#paletteDropdownBtn'); await p6.click('#paletteListContainer [data-theme="pumpkin"]');
    ok('card: Pumpkin colours the whole face, front and back, with dark ink; the back too', (await face()).bg === rgb('#e8792b') && (await face()).ink === rgb('#2a1407') && (await p6.$eval('#cardBack', el => getComputedStyle(el).backgroundColor)) === rgb('#e8792b') && (await p6.textContent('#toastMessage')) === 'Applied palette: Pumpkin', JSON.stringify(await face()));
    ok('card: the initials badge is the accent with the card colour on it', (await p6.$eval('#previewAvatar', el => [el.style.background, el.style.color].join('|'))) === `${rgb('#7a3309')}|${rgb('#e8792b')}`, await p6.$eval('#previewAvatar', el => el.style.background));
    // Every phone, email and site, each with its label; the third of a kind is left off the printed card
    await p6.click('#navFields'); await p6.waitForTimeout(500);
    await p6.fill('#firstName', 'Many'); await p6.fill('#lastName', 'Lines');
    for (const n of [0, 1]) { await p6.click('#addPhoneBtn'); await p6.click('#addEmailBtn'); }
    await p6.fill('#phoneValue0', '+1 (312) 555-0101'); await p6.fill('#phoneValue1', '+1 (312) 555-0102'); await p6.fill('#phoneValue2', '+1 (312) 555-0103');
    await p6.selectOption('#phoneType0', 'work'); await p6.selectOption('#phoneType1', 'mobile'); await p6.selectOption('#phoneType2', 'workFax');
    await p6.fill('#emailValue0', 'a@example.com'); await p6.fill('#emailValue1', 'b@example.com'); await p6.fill('#emailValue2', 'c@example.com');
    await p6.fill('#websiteValue0', 'https://example.com');
    const lines = await p6.evaluate(() => {
      const read = (id) => [...document.querySelectorAll(`#${id} .card-line`)].map(p => ({ label: p.querySelector('.card-line-label').textContent, value: p.querySelector('.card-line-value').textContent, printHidden: p.classList.contains('print:hidden') }));
      return { phones: read('previewPhones'), emails: read('previewEmails'), sites: read('previewWebsites') };
    });
    ok('card: every phone and email is on the card with its label (Work, Mobile, Work fax)', lines.phones.length === 3 && lines.phones.map(l => l.label).join('|') === 'Work|Mobile|Work fax' && lines.phones[2].value === '+1 (312) 555-0103' && lines.emails.length === 3 && lines.sites.length === 1 && lines.sites[0].value === 'https://example.com', JSON.stringify(lines));
    ok('card: past two of a kind a line is left off the printed card (no room on 2 in)', !lines.phones[0].printHidden && !lines.phones[1].printHidden && lines.phones[2].printHidden && lines.emails[2].printHidden && !lines.sites[0].printHidden, JSON.stringify(lines));
    ok('card: an empty list reads as before', (await p6.evaluate(() => { document.getElementById('websiteValue0').value = ''; document.getElementById('websiteValue0').dispatchEvent(new Event('input')); return document.querySelector('#previewWebsites .card-line').textContent; })) === 'No website');
    // The spin: a tap flips (26 fps steps with a small snap, settling exactly on the face); a sideways drag on the card
    // turns it and it settles on the nearest face; a drag from the screen edge is the browser's; the deck stays put.
    await p6.click('#navCard'); await p6.waitForTimeout(700);
    const flipper = await p6.locator('#card3DFlipper').boundingBox();
    const angle = () => p6.$eval('#card3DFlipper', el => el.style.transform);
    const frames = [];
    await p6.evaluate(() => { window.__spin = []; new MutationObserver(() => window.__spin.push(document.getElementById('card3DFlipper').style.transform)).observe(document.getElementById('card3DFlipper'), { attributes: true, attributeFilter: ['style'] }); });
    await p6.click('#flipCardBtn'); await settled(p6);
    frames.push(...await p6.evaluate(() => window.__spin));
    const degs = frames.map(f => parseFloat(/rotateY\(([-\d.]+)deg\)/.exec(f)[1]));
    ok('card: a flip is stepped (about 10 frames over 0.42 s), snaps a little past 180 and settles exactly on 180', (await angle()) === 'rotateY(180deg)' && degs.length >= 7 && degs.length <= 14 && Math.max(...degs) > 181 && (await p6.$eval('#card3DFlipper', el => el.dataset.spin)) === 'still', JSON.stringify(degs));
    const cx = flipper.x + flipper.width / 2, cy = flipper.y + flipper.height / 2;
    // Which events reach the card (for the failure detail: desktop WebKit sent neither a lift nor a click after a drag).
    await p6.evaluate(() => {
      window.__cardEvents = [];
      const el = document.getElementById('card3DFlipper');
      for (const t of ['pointerdown', 'pointerup', 'pointercancel', 'gotpointercapture', 'lostpointercapture', 'mousedown', 'mouseup', 'click']) {
        el.addEventListener(t, (e) => window.__cardEvents.push(`${t}:${e.pointerId ?? ''}:${e.target === el ? 'card' : e.target.tagName}`), true);
      }
    });
    const cardEvents = () => p6.evaluate(() => window.__cardEvents.splice(0).join(' '));
    await p6.mouse.move(cx - flipper.width * 0.3, cy); await p6.mouse.down();
    for (let i = 1; i <= 8; i++) await p6.mouse.move(cx - flipper.width * 0.3 + flipper.width * 0.6 * i / 8, cy);
    const midway = await angle();
    await p6.mouse.up(); await settled(p6);
    ok('card: a sideways drag across the card turns it with the finger and it settles on the front', /rotateY\(2[5-9]\d|rotateY\(3[0-5]\d/.test(midway) && (await angle()) === 'rotateY(0deg)', `${midway} -> ${await angle()}`);
    const dragEvents = await cardEvents();
    const noSelect = await p6.evaluate(() => { const st = getComputedStyle(document.getElementById('card3DFlipper')); return { select: st.userSelect || st.webkitUserSelect, picked: String(getSelection()) }; });
    ok('card: a drag across the card selects none of its text (no text drag can take the next press)', noSelect.select === 'none' && noSelect.picked === '', JSON.stringify(noSelect));
    await p6.mouse.move(cx, cy); await p6.mouse.down(); await p6.mouse.move(cx + 3, cy); await p6.mouse.up(); await settled(p6);
    ok('card: a drag shorter than a tap still counts as a tap (flips)', (await angle()) === 'rotateY(180deg)', `${await angle()} | drag: ${dragEvents} | tap: ${await cardEvents()}`);
    // WebKit sends no click after a drag: a drag with no click after it must not eat the next tap.
    await p6.evaluate(([x, y]) => {
      const el = document.getElementById('card3DFlipper'), o = { pointerId: 41, pointerType: 'mouse', button: 0, bubbles: true, cancelable: true, clientY: y };
      el.dispatchEvent(new PointerEvent('pointerdown', { ...o, clientX: x }));
      el.dispatchEvent(new PointerEvent('pointermove', { ...o, clientX: x + 60 }));
      el.dispatchEvent(new PointerEvent('pointerup', { ...o, clientX: x + 60 }));
    }, [cx - 30, cy]);
    await settled(p6);
    const afterDrag = await angle();
    await p6.mouse.click(cx + flipper.width * 0.25, cy); await settled(p6);
    const faceNow = await p6.$eval('#card3DFlipper', el => el.dataset.face);
    ok('card: after a drag the browser sent no click for (WebKit), the next tap still flips', afterDrag === 'rotateY(180deg)' && (await angle()) !== afterDrag && faceNow === 'front', `${afterDrag} -> ${await angle()} ${faceNow}`);
    await p6.click('#flipCardBtn'); await settled(p6);
    // A tap is taken on the lift, not from a click: a press and lift with no click after it (as WebKit sends after a
    // drag) flips the card, and el.click() with no press behind it flips it too, the short way.
    const faceBefore = await p6.$eval('#card3DFlipper', el => el.dataset.face);
    await p6.evaluate(([x, y]) => {
      const el = document.getElementById('card3DFlipper'), o = { pointerId: 42, pointerType: 'mouse', button: 0, bubbles: true, cancelable: true, clientX: x, clientY: y };
      el.dispatchEvent(new PointerEvent('pointerdown', o));
      el.dispatchEvent(new PointerEvent('pointerup', o));
    }, [cx + flipper.width * 0.25, cy]);
    await settled(p6);
    const faceLifted = await p6.$eval('#card3DFlipper', el => el.dataset.face);
    await p6.$eval('#card3DFlipper', el => el.click()); await settled(p6);
    const faceClicked = await p6.$eval('#card3DFlipper', el => el.dataset.face);
    ok('card: a press and lift with no click after it flips the card; a click with no press behind it flips it back', faceLifted !== faceBefore && faceClicked === faceBefore, `${faceBefore} -> ${faceLifted} -> ${faceClicked}`);
    // A click with no pointer events before it (an older browser; Playwright's mouse in Firefox with touch on) still flips.
    await p6.waitForTimeout(700);
    await p6.evaluate(([x, y]) => document.getElementById('card3DFlipper').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1, clientX: x, clientY: y })), [cx + flipper.width * 0.25, cy]);
    await settled(p6);
    const faceMouseOnly = await p6.$eval('#card3DFlipper', el => el.dataset.face);
    ok('card: a click with no pointer events before it flips the card', faceMouseOnly !== faceBefore, `${faceBefore} -> ${faceMouseOnly}`);
    await p6.click('#flipCardBtn'); await settled(p6);
    // From the keyboard the card turns with its Flip card button (the card itself is not a stop in the tab order).
    const faceUp = () => p6.$eval('#card3DFlipper', el => el.dataset.face);
    await p6.focus('#flipCardBtn'); await p6.keyboard.press('Enter'); await settled(p6);
    const faceEnter = await faceUp();
    await p6.keyboard.press('Space'); await settled(p6);
    const faceSpace = await faceUp();
    ok('card: from the keyboard, Enter and then Space on Flip card each turn the card over', faceEnter !== faceBefore && faceSpace === faceBefore && (await p6.$eval('#card3DFlipper', el => el.tabIndex)) < 0, `${faceBefore} -> ${faceEnter} -> ${faceSpace}`);
    const cardName = () => p6.evaluate(() => document.documentElement.dataset.card);
    await p6.mouse.move(cx, cy); await p6.mouse.down();
    for (let i = 1; i <= 6; i++) await p6.mouse.move(cx + flipper.width * 0.2 * i / 6, cy);
    await p6.mouse.up(); await settled(p6); await p6.waitForTimeout(400);
    ok('card: a short drag settles back on the same face and the deck stays on this card', (await angle()) === 'rotateY(180deg)' && (await cardName()) === 'card', `${await angle()} ${await cardName()}`);
    await p6.mouse.move(20, cy); await p6.mouse.down(); await p6.mouse.move(200, cy); await p6.mouse.up(); await settled(p6);
    ok('card: a drag that starts within 48 px of the screen edge does not spin the card', (await angle()) === 'rotateY(180deg)', await angle());
    await p6.emulateMedia({ reducedMotion: 'reduce' });
    await p6.evaluate(() => { window.__spin = []; });
    await p6.click('#flipCardBtn');
    ok('card: under reduce motion the flip is instant (one frame)', (await angle()) === 'rotateY(0deg)' && (await p6.evaluate(() => window.__spin.length)) === 1, JSON.stringify(await p6.evaluate(() => window.__spin)));
    await p6.emulateMedia({ reducedMotion: 'no-preference' });
    // Toasts: at the top, 3 s, a tap dismisses, a hold keeps it until 3 s after the release
    await p6.click('#paletteDropdownBtn'); await p6.click('#paletteListContainer [data-theme="sage"]');
    await p6.waitForTimeout(400);   // it slides in over 0.3 s
    const toastBox = await p6.locator('#toast').boundingBox();
    ok('toast: shows at the top of the screen, under the header, not the bottom', toastBox.y > 40 && toastBox.y < 120 && await p6.isVisible('#toast'), JSON.stringify(toastBox));
    await p6.waitForTimeout(2200);
    ok('toast: still there at 2.6 s', !(await p6.$eval('#toast', t => t.classList.contains('opacity-0'))));
    await p6.waitForTimeout(700);
    ok('toast: gone after 3 s', await p6.$eval('#toast', t => t.classList.contains('opacity-0')));
    await p6.click('#paletteDropdownBtn'); await p6.click('#paletteListContainer [data-theme="maple"]');
    await p6.click('#toastMessage');
    ok('toast: a tap dismisses it at once', await p6.$eval('#toast', t => t.classList.contains('opacity-0')));
    await p6.click('#paletteDropdownBtn'); await p6.click('#paletteListContainer [data-theme="spruce"]');
    await p6.waitForTimeout(400);   // measured after the slide-in, or the press lands where the toast was, not where it is
    const tb = await p6.locator('#toast').boundingBox();
    await p6.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2); await p6.mouse.down();
    await p6.waitForTimeout(3600);
    ok('toast: held, it stays past 3 s', !(await p6.$eval('#toast', t => t.classList.contains('opacity-0'))));
    await p6.mouse.up();
    await p6.waitForTimeout(2500);
    ok('toast: still there 2.5 s after the release', !(await p6.$eval('#toast', t => t.classList.contains('opacity-0'))));
    await p6.waitForTimeout(800);
    ok('toast: gone 3 s after the release', await p6.$eval('#toast', t => t.classList.contains('opacity-0')));
    // The Logo controls live on this card: upload on the right by its preview, Remove on the far left once there is a logo
    const ctl = await p6.evaluate(() => { const r = (id) => document.getElementById(id).getBoundingClientRect(); const card = r('cardCard'); return { upload: r('avatarUpload').width === 0 ? document.getElementById('avatarUpload').parentElement.getBoundingClientRect().left : 0, remove: r('removeAvatarBtn'), preview: r('formAvatarPreview'), inCard: document.getElementById('cardCard').contains(document.getElementById('avatarUpload')) && !document.getElementById('cardFields').contains(document.getElementById('avatarUpload')), cardLeft: card.left, cardW: card.width, label: document.getElementById('avatarUpload').parentElement.textContent.trim() }; });
    ok('logo: the upload reads "Logo", sits on the 3D Card (not the Fields card), on the right with its preview', ctl.inCard && ctl.label === 'Logo' && ctl.upload > ctl.cardLeft + ctl.cardW / 2 && ctl.preview.left < ctl.upload, JSON.stringify(ctl));
    ok('logo: no Remove button while there is no logo', !(await p6.isVisible('#removeAvatarBtn')));
    // A sample brings its animal as the logo (a bundled file, drawn on the device, kept in its own colours). Plain samples
    // have no logo: the badge shows the initials, and an uploaded logo stands in for the rest of these checks.
    const [s1First, s1Last] = samples()[1];
    const LOGO6 = '#previewAvatar img, #previewAvatar svg';   // a sample's own logo is a picture, an uploaded one is traced to a drawing
    await p6.click('#navFields'); await p6.waitForTimeout(500);
    await p6.selectOption('#fakeContactSelect', '1');   // Ghost the Raccoon (plain: Jordan Patel)
    if (EDITION_PLAIN) {
      await p6.waitForTimeout(500);
      ok('plain edition: a sample brings no logo; the badge shows the initials and there is no Remove button', !(await p6.$(LOGO6))
        && (await p6.textContent('#previewAvatar')).trim() === s1First[0] + s1Last[0] && !(await p6.isVisible('#removeAvatarBtn')));
      const mark = await p6.evaluate(() => { const c = document.createElement('canvas'); c.width = c.height = 96; const x = c.getContext('2d');
        x.fillStyle = '#fff'; x.fillRect(0, 0, 96, 96); x.fillStyle = '#1d4ed8'; x.beginPath(); x.arc(48, 48, 34, 0, Math.PI * 2); x.fill(); return c.toDataURL('image/png'); });
      await p6.setInputFiles('#avatarUpload', { name: 'mark.png', mimeType: 'image/png', buffer: Buffer.from(mark.split(',')[1], 'base64') });
    }
    await p6.waitForFunction((sel) => !!document.querySelector(sel), LOGO6, { timeout: 5000 });
    await p6.waitForTimeout(300);
    const ghost = await p6.evaluate(() => ({ name: document.getElementById('previewFullName').textContent, theme: document.getElementById('currentPaletteLabel').textContent, logo: (document.querySelector('#previewAvatar img') || { src: document.querySelector('#previewAvatar svg') ? 'svg' : '' }).src.slice(0, 21), badge: getComputedStyle(document.getElementById('previewAvatar')).display !== 'none', remove: getComputedStyle(document.getElementById('removeAvatarBtn')).display !== 'none' }));
    ok(`sample: ${s1First} ${s1Last} lands with the Twilight theme and ${EDITION_PLAIN ? 'an uploaded' : 'the raccoon as a'} picture logo in the badge, Remove now shown`, ghost.name === `${s1First} ${s1Last}` && ghost.theme === 'Twilight' && ghost.logo === (EDITION_PLAIN ? 'svg' : 'data:image/png;base64') && ghost.badge && ghost.remove, JSON.stringify(ghost));
    // D1: the logo gives the card's rim its tint, once; grey in colour-blind mode, none in the plain edition
    await p6.waitForFunction(() => 'rim' in document.getElementById('card3DFlipper').dataset, null, { timeout: 5000 }).catch(() => {});
    await p6.waitForTimeout(700);   // the one fade-in
    const rim = () => p6.evaluate(() => { const f = document.getElementById('card3DFlipper'), st = getComputedStyle(document.getElementById('cardFront'), '::after');
      return { set: 'rim' in f.dataset, tint: f.style.getPropertyValue('--card-rim'), colour: st.borderTopColor, width: st.borderTopWidth, opacity: st.opacity, display: st.display }; });
    const rim6 = await rim();
    if (EDITION_PLAIN) ok('plain edition: the logo gives the card no rim', rim6.display === 'none', JSON.stringify(rim6));
    else ok('card: the logo tints the card\'s rim (3 px, in the logo\'s colour) and it holds still', rim6.set && /^rgb\(/.test(rim6.tint) && rim6.colour === rim6.tint && rim6.width === '3px' && rim6.opacity === '1', JSON.stringify(rim6));
    if (!EDITION_PLAIN) {
      await p6.evaluate(() => { document.documentElement.dataset.cb = '1'; });
      const cbRim = await rim();
      await p6.evaluate(() => { delete document.documentElement.dataset.cb; });
      ok('colour-blind mode: the card\'s rim is a neutral grey', cbRim.colour === 'rgb(148, 163, 184)', JSON.stringify(cbRim));
    }
    // Typing on the card does not read the logo again, so the rim never fades out and back in
    await p6.evaluate(() => { window.__rimOff = 0; new MutationObserver(() => { if (!('rim' in document.getElementById('card3DFlipper').dataset)) window.__rimOff++; }).observe(document.getElementById('card3DFlipper'), { attributes: true, attributeFilter: ['data-rim'] }); });
    await p6.click('#navFields'); await p6.fill('#jobTitle', 'Night Owl'); await p6.click('#navCard'); await p6.waitForTimeout(300);
    ok('card: editing the contact keeps the rim as it is (no second fade)', (await p6.evaluate(() => window.__rimOff)) === 0 && (await rim()).set);
    const [dl6] = await Promise.all([p6.waitForEvent('download'), p6.click('#downloadVcfBtn')]);
    const vcf6 = fs.readFileSync(await dl6.path(), 'utf8');
    const email6 = EDITION_PLAIN ? `${s1First}.${s1Last}@example.com`.toLowerCase() : 'vcge.app+ghost@gmail.com';
    ok(`sample: the .vcf carries the ${EDITION_PLAIN ? 'logo' : 'animal'} as a JPEG photo and the 555-01 number`, /PHOTO;TYPE=JPEG;ENCODING=b:/.test(vcf6) && vcf6.includes('+1 (202) 555-0102') && vcf6.includes(email6), vcf6.split('\r\n').filter(l => /^(TEL|EMAIL|PHOTO)/.test(l)).map(l => l.slice(0, 40)).join(' | '));
    await p6.click('#navCard'); await p6.waitForTimeout(500);
    const sides = await p6.evaluate(() => { const r = document.getElementById('removeAvatarBtn').getBoundingClientRect(), u = document.getElementById('avatarUpload').parentElement.getBoundingClientRect(); return { gap: u.left - r.right, removeText: document.getElementById('removeAvatarBtn').textContent.trim() }; });
    ok('logo: "Remove logo" sits well away from the upload (on the far left)', sides.removeText === 'Remove logo' && sides.gap > 80, JSON.stringify(sides));
    // Remove logo asks first (video finding #83): No keeps the logo, Yes removes it
    await p6.click('#removeAvatarBtn');
    const asked = await p6.evaluate(() => ({ question: !document.getElementById('removeLogoConfirm').classList.contains('hidden') && document.getElementById('removeLogoConfirm').textContent.includes('Remove the logo?'), button: !document.getElementById('removeAvatarBtn').classList.contains('hidden'), focus: document.activeElement.id, logo: !!document.querySelector('#previewAvatar img, #previewAvatar svg') }));
    ok('logo: Remove logo asks "Remove the logo?" first, focus on No, the logo still on', asked.question && !asked.button && asked.focus === 'removeLogoNo' && asked.logo, JSON.stringify(asked));
    await p6.click('#removeLogoNo');
    ok('logo: No keeps the logo and brings the Remove logo button back', !!(await p6.$(LOGO6)) && await p6.isVisible('#removeAvatarBtn') && !(await p6.isVisible('#removeLogoConfirm')));
    await p6.click('#removeAvatarBtn'); await p6.click('#removeLogoYes');
    ok('logo: Remove takes the logo off and says so; the initials are back', !(await p6.$(LOGO6)) && (await p6.textContent('#previewAvatar')).trim() === (s1First[0] + s1Last[0]).toUpperCase() && (await p6.textContent('#toastMessage')) === 'Logo removed.');
    ok('card: with the logo removed the rim goes too', await p6.$eval('#card3DFlipper', el => !('rim' in el.dataset) && !el.style.getPropertyValue('--card-rim')));
    await p6.click('#toastAction').catch(() => {});
    await p6.click('#navFields'); await p6.waitForTimeout(300);
    await p6.click('#clearFormBtn'); await p6.click('#toastAction');
    await p6.waitForTimeout(300);
    ok('sample: Undo after Clear brings the sample back without its logo (removed before) and with its theme', (await p6.inputValue('#firstName')) === s1First && (await p6.textContent('#currentPaletteLabel')) === 'Twilight' && !(await p6.$(LOGO6)));
    ok('card: no page errors, nothing fetched from outside, no missing files', errors6.length === 0 && external6.length === 0 && missing6.length === 0, errors6.concat(external6, missing6).join(' | '));
    await ctx6.close();
  }

  // 3D Card (MOD06), the iPad test video of 2026-10-17: the header lights one side of the card and takes it back to the
  // front (#82), a tap turns the card the way a push there would and a sideways finger drag is the card's (#73), a logo
  // never clipped by its rounded tile (#74), more typefaces and a text size (#85), line icons with every value lined
  // up (#86), and the MOD tags clear of the card's controls (#87)
  {
    const ctxV = await browser.newContext({ hasTouch: true, viewport: { width: 1280, height: 900 } });
    const pV = await ctxV.newPage();
    const errorsV = [], externalV = [], missingV = [];
    pV.on('pageerror', e => errorsV.push(e.message));
    pV.on('console', m => { if (m.type() === 'error') errorsV.push('console: ' + m.text()); });
    pV.on('request', r => { if (!r.url().startsWith(ORIGIN) && !/^(data|blob):/.test(r.url())) externalV.push(r.url()); });
    pV.on('response', r => { if (r.status() >= 400) missingV.push(`${r.status()} ${r.url()}`); });
    await pV.goto(ORIGIN); await pV.waitForTimeout(300);
    const lit = () => pV.evaluate(() => ['navCard', 'navQr'].filter(id => document.getElementById(id).classList.contains('is-on')).join(','));
    const turn = () => pV.$eval('#card3DFlipper', el => el.style.transform);

    // #82: Flipside lights the front, Checkers the QR back, never both; Flipside turns the card back to its front
    await pV.click('#navCard'); await pV.waitForTimeout(700);
    ok('#82 header: on the 3D card only Flipside is lit while the front is up', (await lit()) === 'navCard' && (await pV.getAttribute('#navCard', 'aria-current')) === 'page', await lit());
    await pV.click('#navQr'); await settled(pV);
    ok('#82 header: Checkers turns the card to its QR side and only Checkers is lit', (await turn()) === 'rotateY(180deg)' && (await lit()) === 'navQr' && (await pV.getAttribute('#navQr', 'aria-current')) === 'page' && !(await pV.getAttribute('#navCard', 'aria-current')), `${await turn()} ${await lit()}`);
    await pV.click('#navCard'); await settled(pV);
    ok('#82 header: Flipside turns the card back to its front and only Flipside is lit', (await turn()) === 'rotateY(0deg)' && (await lit()) === 'navCard', `${await turn()} ${await lit()}`);
    await pV.click('#flipCardBtn'); await settled(pV);
    ok('#82 header: the Flip card button moves the light with the card', (await lit()) === 'navQr', await lit());
    await pV.click('#navFields'); await pV.waitForTimeout(600);
    ok('#82 header: away from the 3D card neither Flipside nor Checkers is lit', (await lit()) === '', await lit());
    await pV.click('#navCard'); await settled(pV); await pV.waitForTimeout(300);
    ok('#82 header: Flipside from another card arrives on the front', (await turn()) === 'rotateY(0deg)' && (await lit()) === 'navCard', `${await turn()} ${await lit()}`);

    // #73: a tap on the right half turns the card to the right (its right edge goes away: the angle rises), on the left
    // half the other way; the card still settles exactly on a face
    const fl = await pV.locator('#card3DFlipper').boundingBox();
    const spinFrames = async (x) => {
      await pV.evaluate(() => { window.__turn = []; window.__turnObs = new MutationObserver(() => window.__turn.push(parseFloat(/rotateY\(([-\d.]+)deg\)/.exec(document.getElementById('card3DFlipper').style.transform)[1]))); window.__turnObs.observe(document.getElementById('card3DFlipper'), { attributes: true, attributeFilter: ['style'] }); });
      await pV.mouse.click(x, fl.y + fl.height / 2); await settled(pV);
      return pV.evaluate(() => { window.__turnObs.disconnect(); return window.__turn; });
    };
    const right = await spinFrames(fl.x + fl.width * 0.8);
    ok('#73 tap: on the right half the card turns to the right (angles rise past 90 on the way to 180)', right.slice(0, -1).every(a => a >= 0) && right.some(a => a > 90 && a < 180) && (await turn()) === 'rotateY(180deg)', JSON.stringify(right));
    const left = await spinFrames(fl.x + fl.width * 0.2);
    ok('#73 tap: on the left half it turns the other way (the angle falls from 180 to 0) and settles on the front', left.slice(0, -1).every(a => a <= 180) && left.some(a => a > 0 && a < 90) && (await turn()) === 'rotateY(0deg)', JSON.stringify(left));
    const left2 = await spinFrames(fl.x + fl.width * 0.2);
    ok('#73 tap: on the left half from the front the angles go below 0 (the left edge goes away)', left2.slice(0, -1).some(a => a < -90) && (await turn()) === 'rotateY(180deg)', JSON.stringify(left2));
    await pV.click('#flipCardBtn'); await settled(pV);
    // A finger drag that starts sideways is held back from the deck's scroll (iOS gives it to the deck otherwise); one
    // that starts upright is left to scroll
    // WebKit has TouchEvent but no Touch constructor ("Illegal constructor"), so there the touches are plain points on a
    // cancelable event of the same type: the card's handlers read only touches[].clientX/clientY and preventDefault.
    const touchMove = (dx, dy) => pV.evaluate(([dx, dy]) => {
      const el = document.getElementById('card3DFlipper'), r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      let real = true;
      try { new Touch({ identifier: 7, target: el, clientX: x, clientY: y }); } catch { real = false; }
      const t = (cx, cy) => (real ? new Touch({ identifier: 7, target: el, clientX: cx, clientY: cy }) : { identifier: 7, target: el, clientX: cx, clientY: cy });
      const ev = (type, touches, changed) => {
        if (real) return new TouchEvent(type, { touches, changedTouches: changed, bubbles: true, cancelable: true });
        const e = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperties(e, { touches: { value: touches }, changedTouches: { value: changed } });
        return e;
      };
      el.dispatchEvent(ev('touchstart', [t(x, y)], [t(x, y)]));
      const move = ev('touchmove', [t(x + dx, y + dy)], [t(x + dx, y + dy)]);
      el.dispatchEvent(move);
      el.dispatchEvent(ev('touchend', [], [t(x + dx, y + dy)]));
      return move.defaultPrevented;
    }, [dx, dy]);
    ok('#73 swipe: a sideways finger drag on the card is kept from the deck (its first move is held back)', await touchMove(12, 3));
    ok('#73 swipe: an upright finger drag is left alone, so the page still scrolls', !(await touchMove(3, 12)));
    ok('#73 swipe: the card is still on its front and the deck on the 3D card', (await turn()) === 'rotateY(0deg)' && (await pV.evaluate(() => document.documentElement.dataset.card)) === 'card');
    // A real finger drag (the browser's own touch input, so the pointer starts captured by the line of text under the
    // finger, as on the iPad): it turns the card with the finger and settles on the far face (2026-10-18 iPad retest:
    // the capture handed over to the card ended the drag after the first few pixels)
    if (browser.browserType().name() === 'chromium') {
      const cdpV = await ctxV.newCDPSession(pV);
      const fr = await pV.locator('#card3DFlipper').boundingBox();
      const fx = fr.x + fr.width * 0.3, fy = fr.y + fr.height / 2;
      await cdpV.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: fx, y: fy }] });
      for (let i = 1; i <= 10; i++) await cdpV.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: fx + fr.width * 0.05 * i, y: fy }] });
      const halfway = await turn();
      await cdpV.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await settled(pV);
      ok('#73 swipe: a finger drag over the card\'s text turns it with the finger (half a card width, a quarter turn and more) and it settles on the back', /rotateY\((8[5-9]|9\d)(\.\d+)?deg\)/.test(halfway) && (await turn()) === 'rotateY(180deg)' && (await pV.evaluate(() => document.documentElement.dataset.card)) === 'card', `${halfway} -> ${await turn()}`);
      await pV.click('#flipCardBtn'); await settled(pV);
    }

    // #87: neither MOD tag lies on any of the card's controls
    const overlaps = await pV.evaluate(() => {
      const tags = Array.from(document.querySelectorAll('#cardCard > .mod-tag span')).map(t => t.getBoundingClientRect());
      const controls = Array.from(document.querySelectorAll('#cardCard button, #cardCard select, #cardCard label')).filter(c => c.offsetParent).map(c => [c.id || c.textContent.trim(), c.getBoundingClientRect()]);
      const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      return controls.filter(([, r]) => tags.some(t => hit(t, r))).map(([id]) => id);
    });
    ok('#87 tags: the MOD-06 / MOD-07 tags lie on none of the 3D Card\'s buttons (Flip card included)', overlaps.length === 0, JSON.stringify(overlaps));
    await pV.setViewportSize({ width: 390, height: 844 }); await pV.waitForTimeout(500);
    const overlapsPhone = await pV.evaluate(() => {
      const tags = Array.from(document.querySelectorAll('#cardCard > .mod-tag span')).map(t => t.getBoundingClientRect());
      const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      return Array.from(document.querySelectorAll('#cardCard button, #cardCard select, #cardCard label')).filter(c => c.offsetParent && tags.some(t => hit(t, c.getBoundingClientRect()))).map(c => c.id);
    });
    ok('#87 tags: on a phone too', overlapsPhone.length === 0, JSON.stringify(overlapsPhone));
    await pV.setViewportSize({ width: 1280, height: 900 }); await pV.waitForTimeout(500);

    // #86: an icon in front of every line (handset, mobile, fax, envelope, globe, building or house), every value lined up
    await pV.click('#navFields'); await pV.waitForTimeout(500);
    await pV.fill('#firstName', 'Line'); await pV.fill('#lastName', 'Up');
    await pV.click('#addPhoneBtn'); await pV.click('#addPhoneBtn');
    await pV.selectOption('#phoneType0', 'work'); await pV.fill('#phoneValue0', '+1 (312) 555-0101');
    await pV.selectOption('#phoneType1', 'mobile'); await pV.fill('#phoneValue1', '+1 (312) 555-0102');
    await pV.selectOption('#phoneType2', 'workFax'); await pV.fill('#phoneValue2', '+1 (312) 555-0103');
    await pV.fill('#emailValue0', 'line@example.com'); await pV.fill('#websiteValue0', 'https://example.com');
    await pV.fill('#street', '233 South Wacker Drive'); await pV.fill('#city', 'Chicago');
    await pV.click('#navCard'); await pV.waitForTimeout(700);
    const readLines = () => pV.evaluate(() => Array.from(document.querySelectorAll('#cardFront .card-line')).map(p => {
      const icon = p.querySelector('.card-line-icon'), v = p.querySelector('.card-line-value');
      return { icon: icon ? icon.querySelector('use').getAttribute('href').split('#')[1] : null, iconShown: !!icon && getComputedStyle(icon).display !== 'none' && icon.getBoundingClientRect().width > 0,
        label: p.querySelector('.card-line-label').textContent, value: v.textContent, left: Math.round(v.getBoundingClientRect().left) };
    }));
    const withIcons = await readLines();
    ok('#86 lines: each line has the icon of its kind (handset, mobile, fax, envelope, globe, building for a work address)', withIcons.map(l => l.icon).join(',') === 'phone,device-mobile,printer,mail,world,building' && withIcons.every(l => l.iconShown), JSON.stringify(withIcons));
    ok('#86 lines: every value starts at the same place, the address too (it has its own label now)', new Set(withIcons.map(l => l.left)).size === 1 && withIcons[5].label === 'Work' && withIcons[5].value.startsWith('233 South Wacker Drive'), JSON.stringify(withIcons.map(l => [l.label, l.left])));
    ok('#86 lines: the icons are the header\'s own set, bundled (the sprite has every one)', await pV.evaluate(async () => { const t = await (await fetch('src/vendor/icons/app/sprite.svg')).text(); return ['phone', 'device-mobile', 'printer', 'mail', 'world', 'home', 'building'].every(id => t.includes(`<symbol id="${id}"`)); }));
    await pV.click('#cardIconsBtn');
    const noIcons = await readLines();
    ok('#86 lines: Icons off hides them and the labels name the line instead ("Work phone", "Mobile phone", "Work email")', noIcons.every(l => !l.iconShown) && noIcons.map(l => l.label).join('|') === 'Work phone|Mobile phone|Work fax|Work email|Work website|Work address' && (await pV.getAttribute('#cardIconsBtn', 'aria-pressed')) === 'false', JSON.stringify(noIcons.map(l => l.label)));
    ok('#86 lines: without icons the values still line up', new Set(noIcons.map(l => l.left)).size === 1, JSON.stringify(noIcons.map(l => l.left)));
    await pV.click('#cardIconsBtn');
    await pV.selectOption('#addressType', 'home').catch(() => {});
    await pV.evaluate(() => { const s = document.getElementById('addressType'); s.value = 'home'; s.dispatchEvent(new Event('change', { bubbles: true })); document.getElementById('street').dispatchEvent(new Event('input')); });
    ok('#86 lines: a home address gets the house', (await readLines())[5].icon === 'home');

    // #85: more typefaces (bundled ones the app already loads, and system fonts) and a text size, both on screen only
    const fontOptions = await pV.$$eval('#cardFontSelect option', os => os.map(o => o.value));
    ok('#85 fonts: eleven typefaces, the original three first', fontOptions.length === 11 && fontOptions.slice(0, 3).join(',') === 'font-sans,font-serif,font-mono', fontOptions.join(','));
    await pV.selectOption('#cardFontSelect', 'card-font-lexend');
    const lexend = await pV.evaluate(async () => { await document.fonts.load('16px Lexend'); return { family: getComputedStyle(document.getElementById('previewFullName')).fontFamily, loaded: document.fonts.check('16px Lexend'), back: document.getElementById('cardBack').classList.contains('card-font-lexend') }; });
    ok('#85 fonts: Lexend sets the card face and back, from the bundled file', /^"?Lexend/.test(lexend.family) && lexend.loaded && lexend.back, JSON.stringify(lexend));
    const sizeOf = () => pV.$eval('#previewFullName', el => parseFloat(getComputedStyle(el).fontSize));
    const medium = await sizeOf();
    await pV.selectOption('#cardSizeSelect', 'lg');
    const large = await sizeOf();
    await pV.selectOption('#cardSizeSelect', 'sm');
    const smallText = await sizeOf();
    ok('#85 size: Large and Small scale the card text (name 20 px medium)', medium === 20 && Math.abs(large - 23) < 0.1 && Math.abs(smallText - 17.5) < 0.1, `${medium} ${large} ${smallText}`);
    await pV.selectOption('#cardSizeSelect', 'xl');
    await pV.emulateMedia({ media: 'print' });
    const printed = await sizeOf();
    await pV.emulateMedia({ media: 'screen' });
    ok('#85 size: the printed card keeps its own size (a big setting cannot push lines off 3.5 x 2 in)', printed === 20, String(printed));
    await pV.click('#navFields'); await pV.waitForTimeout(400);
    await pV.click('#clearFormBtn');
    const clearedLook = await pV.evaluate(() => ({ font: document.getElementById('cardFontSelect').value, size: document.getElementById('cardSizeSelect').value }));
    await pV.click('#toastAction'); await pV.waitForTimeout(200);
    const undoneLook = await pV.evaluate(() => ({ font: document.getElementById('cardFontSelect').value, size: document.getElementById('cardSizeSelect').value, icons: document.getElementById('cardIconsBtn').getAttribute('aria-pressed') }));
    ok('#85 Clear goes back to Sans and medium text; Undo brings back the typeface and the size', clearedLook.font === 'font-sans' && clearedLook.size === 'md' && undoneLook.font === 'card-font-lexend' && undoneLook.size === 'xl' && undoneLook.icons === 'true', JSON.stringify([clearedLook, undoneLook]));
    await pV.selectOption('#cardSizeSelect', 'md');

    // #74: a logo that fills its square (an opaque, many-coloured picture reaching its edges) sits inside the tile's
    // rounded corners: every corner of the picture is within the corner's arc, and the tile around it is the logo's edge colour
    await pV.click('#navCard'); await pV.waitForTimeout(600);
    const busy = await pV.evaluate(() => { const c = document.createElement('canvas'); c.width = c.height = 300; const x = c.getContext('2d'); x.fillStyle = '#16213a'; x.fillRect(0, 0, 300, 300);
      for (let i = 10; i < 290; i += 12) { x.fillStyle = ['#38d6f0', '#f5d020', '#e0287a', '#7a3cf0'][(i - 10) / 12 % 4]; x.fillRect(i, 10, 6, 280); }
      return c.toDataURL('image/png'); });
    await pV.setInputFiles('#avatarUpload', { name: 'striped.png', mimeType: 'image/png', buffer: Buffer.from(busy.split(',')[1], 'base64') });
    // The tile is drawn again once the logo's shape is read: wait for the picture with its tile colour (not the initials)
    await pV.waitForFunction(() => ['previewAvatar', 'formAvatarPreview'].every(id => { const b = document.getElementById(id); return b.querySelector('img') && b.style.background !== ''; }), null, { timeout: 5000 });
    const fit = await pV.evaluate(() => ['previewAvatar', 'formAvatarPreview'].map(id => {
      const box = document.getElementById(id), r = box.getBoundingClientRect(), i = box.firstElementChild.getBoundingClientRect(), rad = parseFloat(getComputedStyle(box).borderTopLeftRadius);
      const inArc = (x, y) => { const cx = x < r.left + rad ? r.left + rad : x > r.right - rad ? r.right - rad : x, cy = y < r.top + rad ? r.top + rad : y > r.bottom - rad ? r.bottom - rad : y; return Math.hypot(x - cx, y - cy) <= rad + 0.01; };
      return { id, inside: [[i.left, i.top], [i.right, i.top], [i.left, i.bottom], [i.right, i.bottom]].every(([x, y]) => inArc(x, y)), rad, inset: i.left - r.left, bg: box.style.background };
    }));
    ok('#74 logo: the picture\'s corners stay inside the rounded corners of the card tile and the small preview', fit.every(f => f.inside && f.rad >= 12), JSON.stringify(fit));
    ok('#74 logo: around an opaque logo the tile takes the logo\'s own edge colour (#16213a, within rounding)', fit.every(f => { const c = (/rgb\((\d+), (\d+), (\d+)\)/.exec(f.bg) || []).slice(1).map(Number); return c.length === 3 && [22, 33, 58].every((v, i) => Math.abs(c[i] - v) <= 2); }), JSON.stringify(fit.map(f => f.bg)));
    ok('3D Card video fixes: no page errors, nothing fetched from outside, no missing files', errorsV.length === 0 && externalV.length === 0 && missingV.length === 0, errorsV.concat(externalV, missingV).join(' | '));
    await ctxV.close();
  }

  // Step 10 (Airlock): the Share card, Ready to share, file names, the Export QR pop-up (styles, logo, Vault hand-off)
  {
    const ctxA = await browser.newContext({ acceptDownloads: true });
    const pA = await ctxA.newPage();
    const errorsA = [], externalA = [];
    pA.on('pageerror', e => errorsA.push(e.message));
    pA.on('console', m => { if (m.type() === 'error') errorsA.push('console: ' + m.text()); });
    pA.on('request', r => { if (!r.url().startsWith(ORIGIN) && !/^(data|blob):/.test(r.url())) externalA.push(r.url()); });
    await pA.goto(ORIGIN); await pA.waitForTimeout(300);
    const decodeCanvas = (id) => pA.evaluate((id) => { const c = document.getElementById(id); if (!c.width) return null; return { w: c.width, h: c.height, data: Array.from(c.getContext('2d').getImageData(0, 0, c.width, c.height).data) }; }, id)
      .then(q => { if (!q) return null; const r = jsQR(Uint8ClampedArray.from(q.data), q.w, q.h); return r && r.data; });
    const coloursOf = (id) => pA.evaluate((id) => { const c = document.getElementById(id), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; const seen = new Set(); for (let i = 0; i < d.length; i += 4) seen.add(`${d[i]},${d[i + 1]},${d[i + 2]}`); return [...seen]; }, id);
    const tA = (id) => pA.$eval('#' + id, el => el.textContent.trim());
    // Each style choice is a 1 px hidden radio inside a 44 px label (export.css): tap the label as a person does, then report whether it took
    const tapChoice = async (name, value) => { const input = `input[name="${name}"][value="${value}"]`; await pA.click(`label:has(> ${input})`); return pA.isChecked(input); };

    // An empty card: the Share card says so instead of opening the pop-up or printing
    await pA.click('#navShare'); await pA.waitForTimeout(400);
    const shareCard = await pA.evaluate(() => {
      const ids = ['downloadVcfBtn', 'shareNativeBtn', 'copyVcardBtn', 'exportQrBtn', 'printCardBtn', 'emailBtn', 'smsBtn'];
      const rects = ids.map(id => document.getElementById(id).getBoundingClientRect());
      return { current: document.querySelector('.deck-card.is-current').id, heights: rects.map(r => Math.round(r.height)), allInside: rects.every(r => r.width > 0 && r.height > 0), tag: document.querySelector('#cardShare .mod-tag').textContent.trim(), hint: document.getElementById('shareFileExample').textContent };
    });
    ok('Share card: all seven ways out on one card, each at least 44 px tall, tagged MOD-08', shareCard.current === 'cardShare' && shareCard.heights.every(h => h >= 44) && shareCard.allInside && shareCard.tag === 'MOD-08', JSON.stringify(shareCard));
    ok('Share card names the files after the contact; an empty card is "Contact"', shareCard.hint === 'Contact.vcf, Contact QR.png', shareCard.hint);
    await pA.click('#exportQrBtn'); await pA.waitForTimeout(200);
    ok('empty card: QR PNG says to add a contact first, no pop-up', !(await pA.isVisible('#exportQrSheet')) && (await tA('toastMessage')) === 'Add a contact first.');
    await pA.click('#printCardBtn'); await pA.waitForTimeout(200);
    ok('empty card: Print / PDF says to add a contact first, no choice sheet', !(await pA.isVisible('#printChoiceSheet')));

    const lightsOff = await pA.evaluate(() => ({ lit: document.querySelectorAll('#readyToShareBtn .ready-light.is-lit').length, dots: document.querySelectorAll('#readyToShareBtn .ready-light').length, words: document.getElementById('readyLightsText').textContent, described: document.getElementById('readyToShareBtn').getAttribute('aria-describedby'), label: document.getElementById('readyToShareBtn').textContent.trim(), hint: document.getElementById('qrHint').classList.contains('hidden') }));
    ok('Airlock E3: an empty card has three unlit runway lights, said in words too; the button still reads "Ready to share"; no QR hint', lightsOff.dots === 3 && lightsOff.lit === 0 && lightsOff.words === 'Lit: none yet.' && lightsOff.described === 'readyLightsText' && lightsOff.label === 'Ready to share' && lightsOff.hint, JSON.stringify(lightsOff));

    // Ready to share on the 3D Card moves the deck to the Share card
    await pA.click('#navFields'); await pA.waitForTimeout(400);
    await pA.fill('#firstName', 'Jane'); await pA.fill('#lastName', 'Doe'); await pA.fill('#organization', 'Smith, Jones'); await pA.fill('#emailValue0', 'jane@example.com');
    await pA.waitForTimeout(400);
    await pA.click('#navCard'); await pA.waitForTimeout(500);
    const lightsOn = await pA.evaluate(() => {
      const dots = [...document.querySelectorAll('#readyToShareBtn .ready-light')].map(d => getComputedStyle(d));
      return { lit: document.querySelectorAll('#readyToShareBtn .ready-light.is-lit').length, words: document.getElementById('readyLightsText').textContent, fills: dots.map(d => d.backgroundColor), borders: dots.map(d => d.borderTopWidth) };
    });
    ok('Airlock E3: a name, an email and a scannable code light all three, each filled (not just a colour change)', lightsOn.lit === 3 && lightsOn.words === 'Lit: a name, a way to reach them, a scannable QR code.' && lightsOn.fills.every(f => f !== 'rgba(0, 0, 0, 0)') && lightsOn.borders.every(b => b === '2px'), JSON.stringify(lightsOn));
    const unlitFill = await pA.evaluate(() => { const d = document.createElement('span'); d.className = 'ready-light'; document.getElementById('readyToShareBtn').append(d); const f = getComputedStyle(d).backgroundColor; d.remove(); return f; });
    ok('Airlock E3: an unlit light is only an outline (no fill)', unlitFill === 'rgba(0, 0, 0, 0)', unlitFill);
    const qrBack = await pA.evaluate(() => { const c = document.getElementById('qrCanvas'), h = document.getElementById('qrHint'), tail = h.querySelector('.qr-tail'); return { reveal: c.classList.contains('qr-reveal'), anim: getComputedStyle(c).animationName, hint: !h.classList.contains('hidden') && h.textContent.trim(), tail: getComputedStyle(tail).display }; });
    ok('Checkers Q1: the first real code fills in with the stripe reveal', qrBack.reveal && qrBack.anim === 'qr-stripes', JSON.stringify(qrBack));
    ok(`Checkers Q3: "Point a phone camera here" under the code, ${EDITION_PLAIN ? 'without the tail (plain edition)' : 'with the zebra\'s tail'}`, qrBack.hint === 'Point a phone camera here' && (EDITION_PLAIN ? qrBack.tail === 'none' : qrBack.tail !== 'none'), JSON.stringify(qrBack));
    await pA.evaluate(() => { const e = document.getElementById('jobTitle'); e.value = 'Editor'; e.dispatchEvent(new Event('input', { bubbles: true })); }); await pA.waitForTimeout(50);
    ok('Checkers Q1: the reveal plays once, not again on the next keystroke', (await pA.evaluate(() => document.getElementById('qrCanvas').getAnimations().length)) === 0);
    await pA.emulateMedia({ reducedMotion: 'reduce' });
    ok('Checkers Q1: under reduce motion the code shows at once', (await pA.$eval('#qrCanvas', c => getComputedStyle(c).animationName)) === 'none');
    await pA.emulateMedia({ reducedMotion: 'no-preference' });
    const ready = await pA.evaluate(() => { const b = document.getElementById('readyToShareBtn'), r = b.getBoundingClientRect(), c = document.getElementById('cardCard').getBoundingClientRect(); return { inFoot: r.top > c.top + c.height / 2, h: Math.round(r.height), bg: getComputedStyle(b).backgroundColor }; });
    await pA.click('#readyToShareBtn'); await pA.waitForTimeout(700);
    ok('Ready to share (green, in the 3D Card\'s foot) takes the person to the Share card', ready.inFoot && ready.h >= 44 && ready.bg === 'rgb(22, 163, 74)' && (await pA.evaluate(() => document.querySelector('.deck-card.is-current').id)) === 'cardShare', JSON.stringify(ready));
    ok('the file hint follows the contact', (await tA('shareFileExample')) === 'Jane Doe.vcf, Jane Doe QR.png', await tA('shareFileExample'));

    // Export QR pop-up: a live preview from the same code as the card back, Themed by default
    await pA.click('#exportQrBtn');
    const hatch = await pA.evaluate(() => { const h = document.querySelector('#exportQrBtn .hatch'); return { open: h.classList.contains('is-open'), shown: getComputedStyle(h).display, all: document.querySelectorAll('#cardShare button.share-btn .hatch').length }; });
    ok(`Airlock E1: ${EDITION_PLAIN ? 'the plain edition has no hatch doors' : 'every Share button has a hatch door, and it opens on a press'}`, hatch.all === 7 && (EDITION_PLAIN ? hatch.shown === 'none' : hatch.shown !== 'none' && hatch.open), JSON.stringify(hatch));
    await pA.waitForSelector('#exportQrSheet', { state: 'visible' });
    await pA.waitForFunction(() => document.getElementById('exportQrPreview').width > 0);
    const expected = await decodeQr(pA);
    const previewed = await decodeCanvas('exportQrPreview');
    ok('Export QR: the preview decodes to the same vCard as the card back', previewed && previewed === expected && previewed.includes('FN:Jane Doe'), previewed && previewed.slice(0, 60));
    const themedColours = await coloursOf('exportQrPreview');
    ok('Export QR: Themed by default (tinted, not pure black on white), Save PNG enabled, file name shown', themedColours.length === 2 && !themedColours.includes('0,0,0') && !(await pA.isDisabled('#exportQrSaveBtn')) && (await tA('exportQrFileName')) === 'Jane Doe QR.png', JSON.stringify(themedColours));
    const logoState = await pA.evaluate(() => ({ scanned: document.querySelector('input[name="qrLogo"][value="scanned"]').disabled, upload: document.querySelector('input[name="qrLogo"][value="upload"]').disabled, reason: document.getElementById('exportQrLogoReason').textContent }));
    ok('no logo on the card yet: "Scanned logo" is greyed out with a reason, Upload stays open', logoState.scanned && !logoState.upload && /No logo on the card yet/.test(logoState.reason), JSON.stringify(logoState));
    const bwPicked = await tapChoice('qrColour', 'bw'); await pA.waitForTimeout(150);
    const bwColours = await coloursOf('exportQrPreview');
    ok('Black & White: pure black on pure white, still the same code', bwPicked && bwColours.length === 2 && bwColours.includes('0,0,0') && bwColours.includes('255,255,255') && (await decodeCanvas('exportQrPreview')) === expected, JSON.stringify(bwColours));
    const squareW = await pA.$eval('#exportQrPreview', c => c.width);
    const roundPicked = await tapChoice('qrDots', 'round') && await tapChoice('qrFrame', 'circle'); await pA.waitForTimeout(200);
    const circleW = await pA.$eval('#exportQrPreview', c => c.width);
    ok('round dots in a circle frame still decode, on a larger canvas that clears the corners', roundPicked && (await decodeCanvas('exportQrPreview')) === expected && circleW > squareW, `${squareW} -> ${circleW}`);
    const stripesPicked = await tapChoice('qrFrame', 'stripes'); await pA.waitForTimeout(200);
    ok('Checkers Q2: the zebra-stripe frame still decodes to the same vCard', stripesPicked && (await decodeCanvas('exportQrPreview')) === expected);
    ok('the note is empty when there is nothing to say', (await tA('exportQrNote')) === '');
    // Esc (a Shell sheet: a sideways swipe or the X do the same) cancels; the next opening starts fresh
    await pA.keyboard.press('Escape');
    ok('Esc cancels the pop-up', !(await pA.isVisible('#exportQrSheet')));
    await pA.click('#exportQrBtn'); await pA.waitForSelector('#exportQrSheet', { state: 'visible' }); await pA.waitForTimeout(200);
    ok('the pop-up opens fresh: Themed, square, no frame, no logo', await pA.isChecked('input[name="qrColour"][value="themed"]') && await pA.isChecked('input[name="qrDots"][value="square"]') && await pA.isChecked('input[name="qrFrame"][value="none"]') && await pA.isChecked('input[name="qrLogo"][value="none"]'));

    // Upload a logo for the centre: made ready on the device (traced into a drawing), drawn as an image; the code still decodes around it
    const logoPng = await pA.evaluate(() => { const c = document.createElement('canvas'); c.width = 320; c.height = 80; const x = c.getContext('2d'); x.fillStyle = '#1d4ed8'; x.font = 'bold 56px Arial'; x.fillText('ACME', 20, 62); return c.toDataURL('image/png'); });
    const roundedPicked = await tapChoice('qrFrame', 'rounded');
    await pA.setInputFiles('#exportQrLogoFile', { name: 'acme.png', mimeType: 'image/png', buffer: Buffer.from(logoPng.split(',')[1], 'base64') });
    await pA.waitForFunction(() => document.querySelector('input[name="qrLogo"][value="upload"]').checked && !document.getElementById('exportQrUseOnCardRow').classList.contains('hidden'), null, { timeout: 5000 });
    await pA.waitForTimeout(300);
    const withLogo = await pA.evaluate(() => { const c = document.getElementById('exportQrPreview'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; const seen = new Set(); for (let i = 0; i < d.length; i += 4) seen.add(`${d[i]},${d[i + 1]},${d[i + 2]}`); return { colours: seen.size, w: c.width, hasPhoto: !!document.querySelector('#previewAvatar img, #previewAvatar svg') }; });
    ok('uploaded logo: drawn in the centre (more than the two code colours), the code still decodes; the card is untouched until asked', roundedPicked && withLogo.colours > 2 && (await decodeCanvas('exportQrPreview')) === expected && !withLogo.hasPhoto, JSON.stringify(withLogo));
    ok('"Also use this logo on my card" is offered, unticked', await pA.isVisible('#exportQrUseOnCardRow') && !(await pA.isChecked('#exportQrUseOnCard')));
    // Save PNG: the file is the preview, named after the contact; with the box ticked the logo reaches the card through the Vault
    await pA.check('#exportQrUseOnCard');
    const [dlQr] = await Promise.all([pA.waitForEvent('download'), pA.click('#exportQrSaveBtn')]);
    ok('Save PNG downloads "Jane Doe QR.png" and closes the pop-up', dlQr.suggestedFilename() === 'Jane Doe QR.png' && !(await pA.isVisible('#exportQrSheet')), dlQr.suggestedFilename());
    const falconOf = () => pA.evaluate(() => { const f = document.getElementById('toastFalcon'), cs = getComputedStyle(f); return { hidden: f.classList.contains('hidden'), shown: cs.display, anim: cs.animationName, parcel: f.classList.contains('with-parcel') && getComputedStyle(f.querySelector('.falcon-parcel')).display !== 'none' }; });
    const pngFalcon = await falconOf();
    ok(`Airlock E2 + Checkers Q8: ${EDITION_PLAIN ? 'the plain edition shows no falcon' : 'after Save PNG the falcon glides over the toast carrying the striped parcel'}`, !pngFalcon.hidden && (EDITION_PLAIN ? pngFalcon.shown === 'none' : pngFalcon.shown !== 'none' && pngFalcon.anim === 'falcon-glide' && pngFalcon.parcel), JSON.stringify(pngFalcon));
    const pngBytes = fs.readFileSync(await dlQr.path());
    ok('the saved file is a PNG', pngBytes.slice(1, 4).toString() === 'PNG');
    await pA.waitForFunction(() => !!document.querySelector('#previewAvatar img, #previewAvatar svg, #previewLogoStrip img, #previewLogoStrip svg'), null, { timeout: 5000 });
    ok('the logo is on the card too, and the toast says both', !!(await pA.$('#previewAvatar img, #previewAvatar svg, #previewLogoStrip img, #previewLogoStrip svg')) && /Saved Jane Doe QR\.png\. The logo is on your card too\./.test(await tA('toastMessage')), await tA('toastMessage'));
    ok('audit log records the PNG export by name of the action only', (await tA('auditLog')).includes('MOD08 egress: export_png') && !(await tA('auditLog')).includes('Jane Doe'));
    const [dlV] = await Promise.all([pA.waitForEvent('download'), pA.click('#downloadVcfBtn')]);
    const vcfA = fs.readFileSync(await dlV.path(), 'utf8');
    ok('the .vcf now carries that logo as its photo', /\r\nPHOTO;TYPE=JPEG;ENCODING=b:/.test(vcfA), vcfA.slice(0, 80));
    const vcfFalcon = await falconOf();
    ok('Airlock E2: Save .vcf says "Saved Jane Doe.vcf." and the falcon flies again, this time without the parcel', (await tA('toastMessage')) === 'Saved Jane Doe.vcf.' && !vcfFalcon.hidden && !vcfFalcon.parcel, JSON.stringify(vcfFalcon));
    await pA.emulateMedia({ reducedMotion: 'reduce' });
    ok('Airlock E2: under reduce motion the falcon does not glide', (await falconOf()).anim === 'none');
    await pA.emulateMedia({ reducedMotion: 'no-preference' });
    // Now the card has a logo: "Scanned logo" is offered and draws the card's own logo in the centre
    await pA.click('#exportQrBtn'); await pA.waitForSelector('#exportQrSheet', { state: 'visible' });
    await pA.waitForFunction(() => document.getElementById('exportQrPreview').width > 0);
    ok('with a logo on the card, "Scanned logo" is offered', !(await pA.isDisabled('input[name="qrLogo"][value="scanned"]')) && (await tA('exportQrLogoReason')) === '');
    const scannedPicked = await tapChoice('qrLogo', 'scanned'); await pA.waitForTimeout(400);
    const scannedColours = await coloursOf('exportQrPreview');
    ok('scanned logo in the centre, the code still decodes (level H)', scannedPicked && scannedColours.length > 2 && (await decodeCanvas('exportQrPreview')) === expected, JSON.stringify(scannedColours.length));
    await pA.click('#exportQrCancelBtn');
    ok('Cancel closes the pop-up', !(await pA.isVisible('#exportQrSheet')));
    // The toast's next message (written the way showToast writes it) sends the falcon away
    await pA.evaluate(() => { document.getElementById('toastMessage').textContent = 'Something else.'; }); await pA.waitForTimeout(50);
    ok('Airlock E2: the falcon leaves with the toast\'s next message', (await falconOf()).hidden);

    // A contact too big for level H: the logo options are greyed out with MOD07's reason; the code itself still fits
    await pA.click('#navFields'); await pA.waitForTimeout(400);
    await pA.fill('#notes', 'x'.repeat(1500)); await pA.waitForTimeout(500);
    await pA.click('#navShare'); await pA.waitForTimeout(400);
    await pA.click('#exportQrBtn'); await pA.waitForSelector('#exportQrSheet', { state: 'visible' }); await pA.waitForTimeout(300);
    const big = await pA.evaluate(() => ({ scanned: document.querySelector('input[name="qrLogo"][value="scanned"]').disabled, upload: document.querySelector('input[name="qrLogo"][value="upload"]').disabled, reason: document.getElementById('exportQrLogoReason').textContent, none: document.querySelector('input[name="qrLogo"][value="none"]').checked, w: document.getElementById('exportQrPreview').width, save: document.getElementById('exportQrSaveBtn').disabled }));
    ok('too much data for a logo: both logo options greyed out with the reason, Nothing chosen, the plain code still previews', big.scanned && big.upload && /Too much contact data for a QR code with a logo/.test(big.reason) && big.none && big.w > 0 && !big.save, JSON.stringify(big));
    await pA.keyboard.press('Escape');
    // Wipe: the uploaded logo, the preview and the print sheet are gone (the page reloads too)
    await pA.click('#navCard'); await pA.waitForTimeout(400);
    ok('Export: no page errors, nothing fetched from outside', errorsA.length === 0 && externalA.length === 0, errorsA.concat(externalA).join(' | '));
    await ctxA.close();
  }

  console.log(`\n${RUN}: ${pass} passed, ${fail} failed` + (notRun ? `, ${notRun} not run in this engine` : '')
    + (crashReruns ? `, ${crashReruns} block${crashReruns > 1 ? 's' : ''} run again after a WebKit page crash` : ''));
  await browser.close(); server.kill();
  process.exitCode = fail ? 1 : 0;
})().catch(e => { console.error(e); process.exit(1); });
