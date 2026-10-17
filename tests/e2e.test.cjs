// vCGE end-to-end tests in headless Chromium (`npm run test:e2e`).
// Needs devDependencies (`npm install`) and a Chromium for Playwright (`npx playwright install chromium`).
// SERVE_DIR=dist runs the same suite against the Vite build (`npm run build` first).
const path = require('path'), fs = require('fs'), { spawn } = require('child_process');
const { chromium } = require('playwright');
const jsQR = require('jsqr');

const ROOT = path.resolve(__dirname, '..');
const PORT = String(18000 + Math.floor(Math.random() * 2000));
const ORIGIN = `http://localhost:${PORT}/`;

// Renders a business card image in the page so OCR runs on real pixels.
// `blur` (px) simulates a shaky or out-of-focus photo.
async function renderCardImage(page, blur = 0) {
  const dataUrl = await page.evaluate((blur) => {
    const c = document.createElement('canvas'); c.width = 1050; c.height = 600;
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.fillStyle = '#111';
    if (blur) x.filter = `blur(${blur}px)`;
    const lines = [['bold 56px Arial', 'Maria Gonzalez'], ['34px Arial', 'Director of Engineering'], ['34px Arial', 'Northwind Systems'],
      ['30px Arial', '+1 (312) 555-0147'], ['30px Arial', 'maria.gonzalez@northwind.com'], ['30px Arial', 'https://northwind.com'],
      ['30px Arial', '233 South Wacker Drive'], ['30px Arial', 'Chicago, IL 60606']];
    let y = 80; for (const [f, t] of lines) { x.font = f; x.fillText(t, 70, y); y += f.startsWith('bold') ? 80 : 62; }
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
const proceed = async (page) => { await page.click('#applyOcrBtn'); await page.waitForSelector('#cropReviewModal', { state: 'hidden', timeout: 5000 }); };

async function decodeQr(page) {
  const qr = await page.evaluate(() => { const c = document.getElementById('qrCanvas'); return { w: c.width, h: c.height, data: Array.from(c.getContext('2d').getImageData(0, 0, c.width, c.height).data) }; });
  const r = jsQR(Uint8ClampedArray.from(qr.data), qr.w, qr.h);
  return r && r.data;
}

// The Security panel is the Vault page, a sheet over the deck: the header padlock icon opens it, its X (or Esc) closes it.
const vaultOpen = (page) => page.isVisible('#vaultPage');
async function openVault(page) { if (!(await vaultOpen(page))) { await page.click('#navVault'); await page.waitForSelector('#vaultPage', { state: 'visible' }); } }
async function closeVault(page) { if (await vaultOpen(page)) { await page.click('#vaultPage [data-sheet-close]'); await page.waitForSelector('#vaultPage', { state: 'hidden' }); } }

// Sets a session PIN from the Security panel (opens the Vault page, and closes it again if it was closed).
async function setPin(page, pin) {
  const wasOpen = await vaultOpen(page);
  await openVault(page);
  await page.click('#setSessionPinBtn');
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
  if (clock) await clock.runFor(ms); else await page.waitForTimeout(ms);
  await page.mouse.up();
  if (ms < 1500) return;
  if (clock) await clock.runFor(600);
  await page.waitForFunction(() => !window.__vcgeOldPage, null, { timeout: 5000 });
  await page.waitForLoadState('load');
}

// Makes the page look hidden (another app in front, screen off) or visible again.
const setVisibility = (page, state) => page.evaluate((state) => {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  Object.defineProperty(document, 'hidden', { value: state === 'hidden', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}, state);

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log('PASS', n)) : (fail++, console.log('FAIL', n, d)); };

(async () => {
  const server = spawn(process.execPath, [path.join(ROOT, 'scripts/serve.mjs')], { env: { ...process.env, PORT } });
  await new Promise((resolve, reject) => { server.stdout.once('data', resolve); server.once('exit', c => reject(new Error(`server exited ${c}`))); });
  const browser = await chromium.launch();
  // The welcome pop-up opens on every start; every test page presses START NOW at once, except the welcome tests below.
  const plainContext = browser.newContext.bind(browser);
  const pressStartNow = () => new MutationObserver((_, o) => {
    const b = document.getElementById('welcomeStartBtn');
    if (b) { o.disconnect(); b.click(); }
  }).observe(document, { childList: true, subtree: true });
  browser.newContext = async (opts) => { const c = await plainContext(opts); await c.addInitScript(pressStartNow); return c; };
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  const external = [], errors = [], notFound = [];
  page.on('request', r => { if (!r.url().startsWith(ORIGIN) && !/^(data|blob):/.test(r.url())) external.push(r.url()); });
  page.on('response', r => { if (r.status() >= 400) notFound.push(`${r.status()} ${r.url()}`); });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('dialog', d => d.accept());
  const base = ORIGIN;
  const val = id => page.$eval('#' + id, el => el.value);
  const text = id => page.$eval('#' + id, el => el.textContent.trim());
  const visible = id => page.isVisible('#' + id);
  const storage = () => page.evaluate(() => JSON.stringify(localStorage));

  await page.goto(base); await page.waitForTimeout(500);
  ok('loads with no 404s', notFound.length === 0, notFound.join(', '));
  ok('opens straight to an empty card (no passphrase dialog)', !(await visible('vaultModal')) && (await val('firstName')) === '');
  ok('header badge reads "Vault: UNLOCKED" and the indicator says memory only', (await text('vaultBadge')) === 'Vault: UNLOCKED' && (await text('vaultStateIndicator')) === 'UNLOCKED / memory only');
  ok('Lock button hidden until a session PIN is set', !(await visible('lockVaultBtn')));
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

  // vCard download through MOD08
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#downloadVcfBtn')]);
  const vcf = fs.readFileSync(await dl.path(), 'utf8');
  ok('.vcf downloaded with escaped ORG and CRLF', vcf.includes('ORG:Smith\\, Jones') && vcf.includes('\r\nFN:Jane Doe\r\n'), JSON.stringify(vcf.slice(0, 120)));
  ok('download filename', dl.suggestedFilename() === 'Jane_Doe.vcf', dl.suggestedFilename());

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
  const vcf2 = fs.readFileSync(await dl2.path(), 'utf8').split('\r\n');
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
  await page.waitForSelector('#ocrStepText', { state: 'visible', timeout: 90000 });
  const bar = await page.evaluate(() => window.__ocrBar);
  ok('OK moves to the Read card, where the photo shimmers while it is read, the label says the reader is being prepared, and the wash is full before the review opens', bar.shown && bar.shimmer && bar.photo && bar.values.includes(100) && bar.labels.includes('Preparing the reader…') && !(await visible('ocrProgress')) && (await visible('ocrStepText')) && (await page.evaluate(() => document.documentElement.dataset.card)) === 'read', JSON.stringify({ shown: bar.shown, shimmer: bar.shimmer, photo: bar.photo, max: Math.max(...bar.values), labels: [...new Set(bar.labels)] }));
  ok('the reading indicator shows no number (no visible digits, screen readers hear text)', !/\d/.test(await page.$eval('#ocrProgress', el => el.innerText)) && (await page.getAttribute('#ocrProgressBar', 'aria-valuetext')) === 'Reading the card', await page.$eval('#ocrProgress', el => el.innerText));
  ok('after the read the photo under the shimmer is dropped', !(await page.getAttribute('#ocrReadPhoto', 'src')));
  ok('first scan says the reader is being prepared, then extracting', bar.labels.indexOf('Preparing the reader…') >= 0 && bar.labels.indexOf('Extracting…', bar.labels.indexOf('Preparing the reader…')) > 0, [...new Set(bar.labels)].join(' | '));
  ok('review step lists the OCR lines with a field picker each', (await page.$$('#ocrLines select')).length >= 8 && (await page.inputValue('#ocrLineRole0')) === 'name', String((await page.$$('#ocrLines select')).length));
  ok('nothing reaches the form before Fill form', !(await rows(page, 'email')).some(r => r.value.includes('northwind')));
  ok('"Will fill" summary shows the mapped fields', (await text('ocrSummary')).includes('maria.gonzalez@northwind.com') && (await text('ocrSummary')).includes('Northwind Systems'));
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
    && (await text('settingsNote')) === 'vCGE keeps one small settings file on this device (hand, colors, theme, font). Nothing you scan, upload or type is ever saved.');
  ok('the font list is the seven fonts, alphabetical, Inter chosen', (await page.$$eval('#fontSelect option', os => os.map(o => o.textContent).join('|'))) === 'Atkinson Hyperlegible|Comic Neue|Inter|Lexend|Macondo|OpenDyslexic|Tinos'
    && (await page.$eval('#fontSelect', s => s.selectedOptions[0].textContent)) === 'Inter');
  ok('every settings control is at least 44 px tall', (await page.$$eval('#handRightBtn, #handLeftBtn, #cbToggle, #themeToggle, #fontSelect', els => els.map(e => e.getBoundingClientRect().height))).every(h => h >= 44));
  await page.click('#themeToggle');
  ok('theme toggles to light and the entry appears, one key, name=number pairs', !(await htmlState()).dark && (await settingsKeys()).join() === 'vcge_settings' && (await htmlState()).entry === 'hand=0;cb=0;theme=1;font=0');
  await page.click('#handLeftBtn');
  const headerOrder = () => page.evaluate(() => ['navSettings', 'navVault', 'navCapture', 'navShare'].map(id => document.getElementById(id).getBoundingClientRect().left));
  const [xSettings, xVault, xCapture, xShare] = await headerOrder();
  const trashSide = () => page.evaluate(() => { const c = document.querySelector('.deck-card.is-current'), t = c.querySelector('.vcge-trash').getBoundingClientRect(), r = c.getBoundingClientRect(); return t.left + t.width / 2 > r.left + r.width / 2 ? 'right' : 'left'; });
  ok('Left hand mirrors the header (Settings far left, Vault beside it, Airlock before Iris) and moves the trash button to the lower right',
    (await htmlState()).hand === 'left' && xSettings < xVault && xVault < xShare && xShare < xCapture && (await trashSide()) === 'right' && (await htmlState()).entry === 'hand=1;cb=0;theme=1;font=0', JSON.stringify([xSettings, xVault, xShare, xCapture, await trashSide()]));
  await page.click('#handRightBtn');
  const [rSettings, rVault, rCapture] = await headerOrder();
  ok('Right hand puts it back: Iris first, Vault then Settings at the far right, trash lower left', rCapture < rVault && rVault < rSettings && (await trashSide()) === 'left' && (await htmlState()).hand === 'right');
  await page.check('#cbToggle');
  ok('colour-blind mode sets html[data-cb="1"] (MOD02 reads it) and the lit icon shows a white bar under it', (await htmlState()).cb === '1' && (await htmlState()).entry === 'hand=0;cb=1;theme=1;font=0'
    && /inset/.test(await page.$eval('.deck-nav button.is-on', b => getComputedStyle(b).boxShadow)));
  await page.selectOption('#fontSelect', { label: 'Lexend' });
  ok('the UI font follows the drop-down (Lexend) and its fixed code is saved', /Lexend/.test((await htmlState()).body) && (await htmlState()).entry === 'hand=0;cb=1;theme=1;font=2');
  await page.click('#settingsSheet [data-sheet-close]');
  // A fresh start in the same browser (a second tab) comes back with the saved choices; the scan in this tab is untouched
  const pS = await context.newPage();
  await pS.goto(base); await pS.waitForTimeout(600);
  const after = await pS.evaluate(() => ({ hand: document.documentElement.dataset.hand, cb: document.documentElement.dataset.cb, dark: document.documentElement.classList.contains('dark'),
    body: getComputedStyle(document.body).fontFamily, entry: localStorage.getItem('vcge_settings'), keys: Object.keys(localStorage).join() }));
  ok('next start: light theme, colour-blind mode and Lexend come back from the one entry; still exactly one key', !after.dark && after.cb === '1' && /Lexend/.test(after.body) && after.hand === 'right' && after.keys === 'vcge_settings', JSON.stringify(after));
  ok('the entry holds four numbers and no text', /^hand=\d;cb=\d;theme=\d;font=\d$/.test(after.entry), after.entry);
  await pS.click('#navSettings');
  ok('the sheet shows the saved choices', await pS.$eval('#cbToggle', c => c.checked) && (await pS.$eval('#fontSelect', s => s.selectedOptions[0].textContent)) === 'Lexend' && (await pS.$eval('#themeToggle', b => b.getAttribute('aria-pressed'))) === 'true');
  await pS.click('#themeToggle'); await pS.uncheck('#cbToggle'); await pS.selectOption('#fontSelect', { label: 'Inter' });
  await pS.waitForTimeout(300);
  ok('back to dark, colour-blind off, Inter', await pS.evaluate(() => document.documentElement.classList.contains('dark') && !document.documentElement.dataset.cb && /Inter/.test(getComputedStyle(document.body).fontFamily) && localStorage.getItem('vcge_settings') === 'hand=0;cb=0;theme=0;font=0'));
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
  ok('a saved setting is in place before the wipe', (await page.evaluate(() => localStorage.getItem('vcge_settings'))) === 'hand=1;cb=0;theme=0;font=0');
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
  await holdYes(page, 1700); await page.waitForTimeout(600);
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
    const ctx2 = await browser.newContext();
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
    await p2.clock.fastForward(5000);
    ok('countdown shows remaining time', /Auto-clear in 11\d s/.test(await p2.textContent('#purgeCountdown')), await p2.textContent('#purgeCountdown'));
    ok('timer strip: without a PIN it reads "Clears in" with the time left', await p2.isVisible('#vaultTimerStrip') && (await p2.textContent('#vaultTimerLabel')) === 'Clears in' && /^1:5\d$/.test(await p2.textContent('#vaultTimerTime')), await p2.textContent('#vaultTimerTime'));
    await p2.clock.fastForward(60000);
    await p2.fill('#organization', 'Activity resets');
    await p2.clock.fastForward(100000);
    ok('activity restarts the TTL (not purged at 165 s)', (await p2.inputValue('#firstName')) === 'Idle');
    await p2.clock.fastForward(25000);
    ok('idle 120 s without a PIN wipes the card', (await p2.inputValue('#firstName')) === '' && (await p2.textContent('#previewFullName')).trim() === 'New Contact' && !(await p2.isVisible('#vaultModal')));
    ok('timer strip gone once the card is wiped', !(await p2.isVisible('#vaultTimerStrip')));
    ok('purge logged in audit log', (await p2.textContent('#auditLog')).includes('RAM purged (idle)'));

    // Out of view: 30 s wipes, a shorter absence keeps the card, and frozen background timers are caught on return
    await p2.fill('#firstName', 'Hidden'); await p2.clock.fastForward(1000);
    await setVisibility(p2, 'hidden'); await p2.clock.fastForward(20000); await setVisibility(p2, 'visible');
    ok('out of view for 20 s: card kept', (await p2.inputValue('#firstName')) === 'Hidden');
    await setVisibility(p2, 'hidden'); await p2.clock.fastForward(31000);
    ok('out of view for 30 s: card wiped', (await p2.inputValue('#firstName')) === '' && (await p2.textContent('#auditLog')).includes('Vault wiped (out of view for 30 s)'));
    await setVisibility(p2, 'visible');
    await p2.fill('#firstName', 'Frozen'); await p2.clock.fastForward(1000);
    await setVisibility(p2, 'hidden');
    await p2.clock.setSystemTime(await p2.evaluate(() => Date.now() + 60000));   // time passes, no timer runs
    ok('frozen timers: card still there while out of view', (await p2.inputValue('#firstName')) === 'Frozen');
    await setVisibility(p2, 'visible');
    ok('frozen timers: wiped as the page comes back', (await p2.inputValue('#firstName')) === '' && (await p2.textContent('#toastMessage')).includes('out of view'));
    // A share the app opened (here: download) may bring another app to the front: the 2-minute rule applies instead
    await p2.fill('#firstName', 'Shared'); await p2.click('#downloadVcfBtn');
    await setVisibility(p2, 'hidden'); await p2.clock.fastForward(60000); await setVisibility(p2, 'visible');
    ok('after a share, 60 s out of view keeps the card', (await p2.inputValue('#firstName')) === 'Shared');
    ok('storage stays empty throughout', !(await p2.evaluate(() => JSON.stringify(localStorage))).includes('vCGE_secure_vault'));
    await ctx2.close();
  }

  // Quick unlock: 4-digit session PIN after a lock (idle, screen off, Lock button); the card is held in memory only,
  // and 7 minutes without activity wipe it
  {
    const ctx8 = await browser.newContext();
    const p8 = await ctx8.newPage();
    const errors8 = [];
    p8.on('pageerror', e => errors8.push(e.message));
    p8.on('console', m => { if (m.type() === 'error') errors8.push('console: ' + m.text()); });
    p8.on('dialog', d => d.accept());
    await p8.clock.install();
    const t8 = id => p8.textContent('#' + id).then(t => t.trim());
    const IDLE_MS = 125000;
    const idle = async () => { await p8.clock.fastForward(1000); await p8.clock.fastForward(IDLE_MS); };
    await p8.goto(ORIGIN); await p8.waitForTimeout(300);

    ok('no session PIN offer on its own', !(await p8.isVisible('#quickSetupModal')) && (await t8('sessionPinStatus')) === 'Session PIN: not set');
    await openVault(p8);
    await p8.click('#setSessionPinBtn');
    await p8.fill('#sessionPinInput', '12'); await p8.click('#quickSetupSaveBtn');
    ok('session PIN: too-short PIN refused', (await t8('quickSetupError')) === 'Use exactly 4 digits.', await t8('quickSetupError'));
    await p8.fill('#sessionPinInput', '2468'); await p8.click('#quickSetupSaveBtn');
    await p8.waitForSelector('#quickSetupModal', { state: 'hidden' });
    ok('session PIN set: Security panel shows it and Lock appears', (await t8('sessionPinStatus')) === 'Session PIN: set' && await p8.isVisible('#lockVaultBtn'));
    await closeVault(p8);
    await p8.fill('#firstName', 'Quick'); await p8.fill('#lastName', 'Unlock');
    await p8.clock.fastForward(1000);
    ok('timer strip: with a PIN it reads "Locks in", calm, no note', await p8.isVisible('#vaultTimerStrip') && (await t8('vaultTimerLabel')) === 'Locks in' && /^1:5\d$/.test(await t8('vaultTimerTime')) && !(await p8.isVisible('#vaultTimerNote')), await t8('vaultTimerTime'));
    await p8.clock.fastForward(102000);
    const warn8 = await p8.evaluate(() => document.getElementById('vaultTimerBand').className + ' ' + document.getElementById('vaultTimerBar').className);
    ok('timer strip: last 20 s turn it amber (never red) with one quiet note', await p8.isVisible('#vaultTimerNote') && /^0:1\d$/.test(await t8('vaultTimerTime')) && warn8.includes('bg-amber-50/95') && warn8.includes('bg-amber-500') && !/red|rose/.test(warn8), warn8);
    await p8.click('#vaultTimerKeepBtn');
    ok('timer strip: Keep open refills it and the note goes away', /^(2:00|1:59)$/.test(await t8('vaultTimerTime')) && !(await p8.isVisible('#vaultTimerNote')) && (await p8.evaluate(() => document.getElementById('vaultTimerBar').className)).includes('bg-brand-500'), await t8('vaultTimerTime'));
    await idle();
    ok('idle with a session PIN: card hidden, PIN prompt', await p8.isVisible('#vaultModal') && (await t8('vaultModalTitle')) === 'Locked' && await p8.isVisible('#vaultPin') && (await p8.inputValue('#firstName')) === '');
    ok('quick lock: badge, indicator and countdown show the 7 minutes that run from the lock', (await t8('vaultBadge')) === 'Vault: LOCKED' && /^LOCKED \(resets in (7:00|6:5\d)\)$/.test(await t8('vaultStateIndicator')) && /everything resets in (7:00|6:5\d)/.test(await t8('quickUnlockCountdown')), await t8('vaultStateIndicator'));
    const ring8 = await p8.evaluate(() => Number(document.getElementById('vaultLockRing').getAttribute('stroke-dashoffset')));
    ok('lock screen: calm green ring shows the time left until it is cleared', /^(7:00|6:5\d)$/.test(await t8('vaultLockRingTime')) && ring8 >= 0 && ring8 < 10 && !(await p8.isVisible('#vaultTimerStrip')), `${await t8('vaultLockRingTime')} ${ring8}`);
    ok('lock screen: no Unlock button (the 4th digit unlocks), PIN box focused when no fingerprint is set', !(await p8.$('#vaultUnlockBtn')) && !(await p8.isVisible('#vaultBiometricBtn')) && (await p8.evaluate(() => document.activeElement && document.activeElement.id)) === 'vaultPin');
    ok('idle lock explains why it locked', (await t8('vaultModalHint')).startsWith('Locked after 2 minutes without activity. Enter your 4-digit PIN'));
    ok('quick lock: the held card is not in storage or the page', !(await p8.evaluate(() => JSON.stringify(localStorage) + document.body.innerText)).includes('Quick'));
    await p8.fill('#vaultPin', '1111'); await p8.waitForTimeout(300);
    ok('wrong session PIN (checked on the 4th digit) rejected with tries left', (await t8('vaultError')) === 'Wrong PIN. 4 tries left.' && (await p8.inputValue('#vaultPin')) === '', await t8('vaultError'));
    await p8.fill('#vaultPin', '2468');
    await p8.waitForSelector('#vaultModal', { state: 'hidden' });
    ok('right session PIN unlocks on the 4th digit, no extra tap', (await p8.inputValue('#firstName')) === 'Quick' && (await t8('auditLog')).includes('Vault unlocked (session PIN)') && (await t8('vaultBadge')) === 'Vault: UNLOCKED');

    // Screen timeout with a PIN: locks at once, the card survives, and the PIN brings it straight back
    await p8.clock.fastForward(1000);
    await setVisibility(p8, 'hidden');
    ok('screen off with a PIN: locked at once, card off the page', await p8.isVisible('#vaultModal') && (await p8.inputValue('#firstName')) === '' && (await t8('auditLog')).includes('hidden behind the PIN (out of view)'));
    await p8.clock.setSystemTime(await p8.evaluate(() => Date.now() + 200000));   // 3+ minutes asleep, timers frozen
    await setVisibility(p8, 'visible');
    ok('screen back on after 3+ minutes: still locked, not wiped', await p8.isVisible('#vaultModal') && (await t8('vaultModalHint')).startsWith('Locked while the screen was off'));
    await p8.fill('#vaultPin', '2468');
    await p8.waitForSelector('#vaultModal', { state: 'hidden' });
    ok('PIN after a screen timeout restores the card', (await p8.inputValue('#firstName')) === 'Quick');
    await p8.clock.fastForward(1000);
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
    await p8.clock.fastForward(301000);
    ok('idle lock: 5 minutes after it the card is still held (the 7 minutes run from the lock)', await p8.isVisible('#vaultModal') && /^(2:0\d|1:5\d)$/.test(await t8('vaultLockRingTime')), await t8('vaultLockRingTime'));
    await p8.clock.fastForward(120000);
    await p8.waitForFunction(() => document.getElementById('toastMessage').textContent.startsWith('Reset: 7 minutes'), null, { timeout: 5000 }).catch(() => {});
    ok('idle lock, then 7 minutes after the lock: card and PIN wiped, no dialog', !(await p8.isVisible('#vaultModal')) && (await p8.inputValue('#firstName')) === '' && (await t8('toastMessage')).startsWith('Reset: 7 minutes without activity') && (await t8('sessionPinStatus')) === 'Session PIN: not set', await t8('toastMessage'));

    await setPin(p8, '1357');
    await p8.fill('#firstName', 'Tries');
    await idle();
    for (let i = 0; i < 5; i++) { await p8.fill('#vaultPin', '0000'); await p8.waitForTimeout(250); }
    ok('5 wrong PINs: card wiped', !(await p8.isVisible('#vaultModal')) && (await p8.inputValue('#firstName')) === '' && (await t8('toastMessage')).startsWith('5 wrong PINs'), await t8('toastMessage'));

    await setPin(p8, '4321');
    await p8.fill('#firstName', 'Locked');
    await p8.click('#lockVaultBtn');
    ok('Lock button hides the card behind the PIN', await p8.isVisible('#vaultPin') && (await p8.inputValue('#firstName')) === '');
    await p8.click('#vaultStartOverBtn');
    ok('"Wipe and start over" on the lock screen asks the hold-to-wipe question above it', await p8.isVisible('#wipeDialog') && await p8.isVisible('#vaultModal'));
    await holdYes(p8, 1700, p8.clock); await p8.waitForTimeout(300);
    ok('"Wipe and start over" (held) wipes the held card and starts fresh', !(await p8.isVisible('#vaultModal')) && !(await p8.isVisible('#wipeDialog')) && (await p8.inputValue('#firstName')) === '' && (await t8('vaultBadge')) === 'Vault: UNLOCKED');

    await setPin(p8, '4321');
    await openVault(p8);
    ok('Security panel: Change and Remove offered', (await t8('setSessionPinBtn')) === 'Change' && await p8.isVisible('#clearSessionPinBtn'));
    await p8.click('#clearSessionPinBtn');
    ok('Security panel: Remove forgets the PIN and hides Lock', (await t8('sessionPinStatus')) === 'Session PIN: not set' && (await t8('auditLog')).includes('Session PIN removed') && !(await p8.isVisible('#lockVaultBtn')));
    ok('quick unlock: no page errors', errors8.length === 0, errors8.join(' | '));
    await ctx8.close();
  }

  // Biometric unlock (Face ID / fingerprint / Windows Hello) through a virtual platform authenticator: on-device only
  {
    const ctxB = await browser.newContext();
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
    await pB.click('#addBiometricBtn'); await pB.waitForTimeout(800);
    ok('a device that cannot confirm the person does not turn biometric on, and the real reason is shown', (await tB('biometricStatus')) === 'Face ID / fingerprint: off' && /was not added \([A-Za-z_]+\)/.test(await tB('toastMessage')) && !(await tB('auditLog')).includes('fingerprint added'), await tB('toastMessage'));
    await cdp.send('WebAuthn.setUserVerified', { authenticatorId, isUserVerified: true });
    await pB.click('#addBiometricBtn'); await pB.waitForTimeout(500);
    ok('biometric added for this session, after a check that passed', (await tB('biometricStatus')) === 'Face ID / fingerprint: on' && (await tB('auditLog')).includes('Face ID / fingerprint added'), await tB('toastMessage'));
    await closeVault(pB);
    await pB.fill('#firstName', 'Bio'); await pB.click('#lockVaultBtn');
    ok('lock screen offers Face ID / fingerprint', await pB.isVisible('#vaultBiometricBtn') && (await pB.inputValue('#firstName')) === '');
    const bioBox = await pB.locator('#vaultBiometricBtn').boundingBox(), pinBox = await pB.locator('#vaultPin').boundingBox();
    ok('lock screen leads with a big fingerprint button above the PIN, focused (no keyboard pops up), no Unlock button', bioBox.height >= 52 && bioBox.y < pinBox.y && (await pB.evaluate(() => document.activeElement && document.activeElement.id)) === 'vaultBiometricBtn' && !(await pB.$('#vaultUnlockBtn')) && await pB.isVisible('#vaultOr'));
    await pB.click('#vaultBiometricBtn');
    await pB.waitForSelector('#vaultModal', { state: 'hidden', timeout: 5000 }).catch(() => {});
    ok('biometric unlocks the card', !(await pB.isVisible('#vaultModal')) && (await pB.inputValue('#firstName')) === 'Bio' && (await tB('auditLog')).includes('Vault unlocked (biometric)'));
    await cdp.send('WebAuthn.setUserVerified', { authenticatorId, isUserVerified: false });
    await pB.click('#lockVaultBtn');
    await pB.click('#vaultBiometricBtn'); await pB.waitForTimeout(800);
    ok('face or fingerprint not confirmed: stays locked, PIN offered', await pB.isVisible('#vaultModal') && (await tB('vaultError')).includes('Use your PIN') && (await pB.inputValue('#firstName')) === '', await tB('vaultError'));
    await pB.fill('#vaultPin', '2468');
    await pB.waitForSelector('#vaultModal', { state: 'hidden' });
    ok('the PIN still works as the fallback', (await pB.inputValue('#firstName')) === 'Bio');
    await openVault(pB);
    await pB.click('#clearSessionPinBtn');
    ok('removing the PIN removes biometric too', !(await pB.isVisible('#biometricRow')) && !(await pB.isVisible('#lockVaultBtn')));
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
    ok('padlock: no page errors', errorsL.length === 0, errorsL.join(' | '));
    await ctxL.close();
  }

  // Back (button or swipe): asks before wiping, Stay keeps the card, leaving wipes it; an empty card just leaves
  {
    const ctx11 = await browser.newContext();
    const p11 = await ctx11.newPage();
    const errors11 = [];
    p11.on('pageerror', e => errors11.push(e.message));
    await p11.goto('about:blank');
    await p11.goto(ORIGIN); await p11.waitForTimeout(300);
    await p11.click('#firstName'); await p11.keyboard.type('Swiped');
    await p11.goBack(); await p11.waitForTimeout(300);
    ok('Back with a card asks first (still on the app)', p11.url() === ORIGIN && await p11.isVisible('#leaveModal') && (await p11.inputValue('#firstName')) === 'Swiped', p11.url());
    await p11.click('#leaveStayBtn');
    ok('Stay keeps the card', !(await p11.isVisible('#leaveModal')) && (await p11.inputValue('#firstName')) === 'Swiped');
    await p11.goBack(); await p11.waitForTimeout(300);
    ok('Back asks again after Stay', await p11.isVisible('#leaveModal'));
    await Promise.all([p11.waitForURL('about:blank'), p11.click('#leaveConfirmBtn')]);
    ok('"Wipe and leave" goes back', p11.url() === 'about:blank', p11.url());
    await p11.goForward(); await p11.waitForTimeout(500);
    ok('coming back forward: the card is gone', (await p11.inputValue('#firstName')) === '');
    await p11.click('#clearFormBtn');
    await p11.goBack(); await p11.waitForTimeout(500);
    ok('Back with an empty card leaves without asking', p11.url() === 'about:blank', p11.url());
    ok('Back guard: no page errors', errors11.length === 0, errors11.join(' | '));
    await ctx11.close();
  }

  // Quick lock keeps the scan in progress: the open review comes back with the session PIN, sealed while locked
  {
    const ctx10 = await browser.newContext();
    const p10 = await ctx10.newPage();
    const errors10 = [];
    p10.on('pageerror', e => errors10.push(e.message));
    p10.on('console', m => { if (m.type() === 'error') errors10.push('console: ' + m.text()); });
    await p10.clock.install();
    const t10 = id => p10.textContent('#' + id).then(t => t.trim());
    const idle = async () => { await p10.clock.fastForward(1000); await p10.clock.fastForward(125000); };
    const unlockPin = async () => { await p10.fill('#vaultPin', '2468'); await p10.waitForSelector('#vaultModal', { state: 'hidden' }); await p10.waitForTimeout(300); };
    await p10.goto(ORIGIN); await p10.waitForTimeout(300);
    await setPin(p10, '2468');

    await p10.setInputFiles('#imageUpload', await renderCardImage(p10)); await p10.waitForTimeout(300);
    await p10.click('#runOcrBtn');
    await p10.waitForSelector('#ocrStepText', { state: 'visible', timeout: 90000 });
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
    await p10.clock.fastForward(421000); await p10.waitForTimeout(300);
    ok('7 minutes after the lock wipe the card and the kept scan', !(await p10.isVisible('#vaultModal')) && !(await p10.isVisible('#reopenScanBtn')) && !(await p10.isVisible('#cropReviewModal')) && (await p10.inputValue('#firstName')) === '');
    ok('kept scan: no page errors', errors10.length === 0, errors10.join(' | '));
    await ctx10.close();
  }

  // Tester feedback round 3: logos fitted square on an opaque background, and a JPEG vCard photo
  {
    const ctx11 = await browser.newContext();
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
      if (kind === 'whitebg' || kind === 'whitebg-colour') { x.fillStyle = '#fff'; x.fillRect(0, 0, 400, 100); }
      x.font = 'bold 60px Arial';
      if (kind === 'rainbow' || kind === 'pastel' || kind === 'whitebg-colour') {
        const colours = kind === 'pastel' ? ['#ffa0a0', '#a0ffa0', '#a0a0ff'] : ['#d00', '#07c', '#fc0'];
        'TeamLogic'.split('').forEach((ch, i) => { x.fillStyle = colours[i % 3]; x.fillText(ch, 10 + i * 40, 70); });
        return c.toDataURL(kind === 'whitebg-colour' ? 'image/jpeg' : 'image/png');
      }
      x.fillStyle = kind === 'light' ? '#f5f5f5' : kind === 'opaque' ? '#fff' : '#123';
      x.fillText('TeamLogic', 10, 70);
      return c.toDataURL(kind === 'whitebg' ? 'image/jpeg' : 'image/png');
    }, kind);
    // Uploads a logo; returns the vCard PHOTO (from the .vcf), what the card shows and what the toast said.
    const upload = async (kind, name) => {
      const url = await logo(kind);
      const before = await p11.evaluate(() => { const i = document.querySelector('#formAvatarPreview img, #formAvatarPreview svg'); return i ? i.outerHTML : ''; });
      await p11.setInputFiles('#avatarUpload', { name, mimeType: url.slice(5, url.indexOf(';')), buffer: Buffer.from(url.split(',')[1], 'base64') });
      await p11.waitForFunction((before) => { const i = document.querySelector('#formAvatarPreview img, #formAvatarPreview svg'); return i && i.outerHTML !== before && (i.tagName === 'svg' || i.complete); }, before);
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
    await p11.click('#printCardBtn');
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

  // A scan filled into a sample preset replaces the sample as a whole (none of its phones, fax or links are left);
  // Undo brings the sample back, and a second fill replaces it again.
  {
    const ctxS = await browser.newContext();
    const pS = await ctxS.newPage();
    const errorsS = [];
    pS.on('pageerror', e => errorsS.push(e.message));
    await pS.goto(ORIGIN); await pS.waitForTimeout(300);
    await pS.selectOption('#fakeContactSelect', '4');   // Pidge: mobile, work and fax numbers
    ok('sample loaded with three phones', (await rows(pS, 'phone')).length === 3 && (await pS.inputValue('#firstName')) === 'Pidge');
    await pS.setInputFiles('#imageUpload', await renderCardImage(pS)); await pS.waitForTimeout(300);
    await pS.click('#runOcrBtn');
    await pS.waitForSelector('#ocrStepText', { state: 'visible', timeout: 90000 });
    await proceed(pS);
    const card = async () => ({ first: await pS.inputValue('#firstName'), middle: await pS.inputValue('#middleName'), suffix: await pS.inputValue('#nameSuffix'),
      unit: await pS.inputValue('#unitNumber'), phones: await rows(pS, 'phone'), front: await pS.$$eval('#previewPhones .card-line-value', els => els.map(e => e.textContent).join('|')) });
    const filled = await card();
    ok('scan into a sample: the sample is replaced, nothing of it left', filled.first === 'Maria' && !filled.middle && !filled.suffix && !filled.unit
      && filled.phones.length === 1 && filled.phones[0].value === '+1 (312) 555-0147' && filled.front === '+1 (312) 555-0147', JSON.stringify(filled));
    await pS.click('#toastAction');
    ok('Undo brings the sample back', (await pS.inputValue('#firstName')) === 'Pidge' && (await rows(pS, 'phone')).length === 3);
    await pS.click('#reopenScanBtn');
    await proceed(pS);
    const again = await card();
    ok('filling the sample again replaces it again', again.first === 'Maria' && again.phones.length === 1, JSON.stringify(again));
    ok('sample then scan: no page errors', errorsS.length === 0, errorsS.join(' | '));
    await ctxS.close();
  }

  // Fields card (MOD05, redesign step 7): the "Insert Fake Contact?" list, the pop-in on arrival, "Everything's correct"
  {
    const ctxF = await browser.newContext();
    const pF = await ctxF.newPage();
    const errorsF = [];
    pF.on('pageerror', e => errorsF.push(e.message));
    pF.on('console', m => { if (m.type() === 'error') errorsF.push('console: ' + m.text()); });
    await pF.goto(ORIGIN); await pF.waitForTimeout(300);
    const pops = () => pF.$eval('#fieldsForm', f => Number(f.dataset.pops || 0));
    const card = () => pF.evaluate(() => document.documentElement.dataset.card);
    ok('fields: the list reads "Insert Fake Contact?" and names each sample by name and company', (await pF.$$eval('#fakeContactSelect option', os => os.map(o => o.textContent).join('|'))) === 'Insert Fake Contact?|Shutout Box Turtle, Team vCGE|Ghost Raccoon, Team vCGE|Iris Lynx, Team vCGE|Glyph Owl, Team vCGE|Pidge Octopus, Team vCGE|Flipside Chameleon, Team vCGE|Checkers Zebra, Team vCGE|Airlock Falcon, Team vCGE|Cornerstone Elephant, Team vCGE'
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
      (await pF.inputValue('#firstName')) === 'Iris' && (await pF.inputValue('#organization')) === 'Team vCGE' && (await pops()) === 2 && pop.names.includes('fields-pop') && pop.steps === 'steps(8)' && pop.ms === '0.32s'
      && await pF.isVisible('#toastAction') && (await pF.$eval('#fakeContactSelect', s => s.value)) === '' && (await card()) === 'fields', JSON.stringify({ pop, pops: await pops(), card: await card() }));
    ok('fields: the list and the green button are at least 44 px tall; the button reads "Everything\'s correct" with the tick icon', (await pF.$$eval('#fakeContactSelect, #fieldsDoneBtn', els => els.map(e => e.getBoundingClientRect().height))).every(h => h >= 44)
      && (await pF.textContent('#fieldsDoneBtn')).trim() === "Everything's correct" && !!(await pF.$('#fieldsDoneBtn svg use[href$="#circle-check"]')), JSON.stringify(await pF.$$eval('#fakeContactSelect, #fieldsDoneBtn', els => els.map(e => e.getBoundingClientRect().height))));
    ok('fields: the pop class is gone once the animation ends', !(await pF.$eval('#fieldsForm', f => f.classList.contains('is-popping'))));
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
      sidesRight.ok === 'right' && sidesRight.trash === 'left' && sidesRight.okBottom && (await card()) === 'card' && (await pF.textContent('#previewFullName')) === 'Iris Lynx' && await pF.isVisible('#vaultHandoff[data-playing]').catch(() => true),
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
    ok('fields: under reduce motion a sample is simply there (no pop class), the arrival still counted', (await pops()) === before + 1 && !(await pF.$eval('#fieldsForm', f => f.classList.contains('is-popping'))) && (await pF.inputValue('#firstName')) === 'Shutout', String(await pops()));
    ok('fields: no page errors', errorsF.length === 0, errorsF.join(' | '));
    await ctxF.close();
  }

  // Tester feedback round 1: Undo after a sample / clear / scan fill, reopen the last scan, readable SMS and email, one-page print
  {
    const ctx9 = await browser.newContext();
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
    await p9.waitForSelector('#ocrStepText', { state: 'visible', timeout: 90000 });
    await proceed(p9);
    ok('Fill form offers Undo and "Reopen last scan"', (await p9.inputValue('#firstName')) === 'Maria' && await p9.isVisible('#toastAction') && await p9.isVisible('#reopenScanBtn'));
    await p9.click('#toastAction');
    ok('Undo after Fill form restores the card from before the scan', (await p9.inputValue('#firstName')) === 'Typed');
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
      ok('SMS carries every detail as readable lines', sms.startsWith('sms:?body=Maria Gonzalez\nDirector of Engineering, Northwind Systems\nWork: +1 (312) 555-0147\nWork email: maria.gonzalez@northwind.com\nWork: https://northwind.com\n233 South Wacker Drive, Chicago, IL 60606, United States'), JSON.stringify(sms));
      ok('email: readable summary plus the vCard text', mail.startsWith('mailto:?subject=Contact: Maria Gonzalez&body=Maria Gonzalez\n') && mail.includes('save the text below as a .vcf file') && mail.includes('BEGIN:VCARD'), JSON.stringify(mail.slice(0, 160)));
    }

    // Print / Save as PDF: one page, front and back at business-card size
    await p9.evaluate(() => { window.print = () => {}; });
    await p9.click('#printCardBtn');
    const sheet = await p9.evaluate(() => ({ cards: document.querySelectorAll('#printSheet .print-card').length, qr: !!document.querySelector('#printSheet .print-back img'), ids: document.querySelectorAll('#printSheet [id]').length, text: document.getElementById('printSheet').textContent }));
    ok('print sheet holds the front and the QR back (no duplicate ids)', sheet.cards === 2 && sheet.qr && sheet.ids === 0 && sheet.text.includes('Maria Gonzalez'), JSON.stringify(sheet));
    await p9.emulateMedia({ media: 'print' });
    const size = await p9.evaluate(() => { const r = document.querySelector('#printSheet .print-card').getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; });
    ok('printed card is 3.5 x 2 inches', size[0] === 336 && size[1] === 192, JSON.stringify(size));
    await p9.emulateMedia({ media: null });
    const pdf = (await p9.pdf({ format: 'Letter', preferCSSPageSize: true, printBackground: true })).toString('latin1');
    const pages = (pdf.match(/\/Type\s*\/Page[^s]/g) || []).length;
    ok('print is one page (no blank pages) and the card is still on the sheet', pages === 1 && (await p9.evaluate(() => document.getElementById('printSheet').children.length)) === 2, `${pages} pages`);
    await p9.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    ok('print copies stay until the next print (afterprint can fire before the PDF is drawn)', (await p9.evaluate(() => document.getElementById('printSheet').children.length)) === 2);
    ok('tester round 1: no page errors', errors9.length === 0, errors9.join(' | '));
    await ctx9.close();
  }

  // Icons instead of labels: unlabelled numbers typed by their icons, a bare handle next to a social logo
  {
    const ctx7 = await browser.newContext();
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
    await p7.waitForSelector('#ocrStepText', { state: 'visible', timeout: 90000 });
    const chips = await p7.$$eval('#ocrLines [id^="ocrLineIcon"]', c => c.map(x => x.textContent));
    ok('review shows the icons seen in front of lines', chips.includes('Mobile icon') && chips.includes('Instagram logo'), chips.join(', '));
    const summary = await p7.textContent('#ocrSummary');
    ok('icons type unlabelled numbers (Mobile vs Work) in the summary', summary.includes('Phone (Mobile)+1 (206) 555-9876') && summary.includes('Phone (Work)+1 (206) 555-3400'), summary);
    await proceed(p7);
    ok('social logo + handle fills the Instagram profile link', (await rowValue(p7, 'website', 'instagram')) === 'https://instagram.com/studiocraft', JSON.stringify(await rows(p7, 'website')));
    ok('typed phone rows reach the form', (await rowValue(p7, 'phone', 'mobile')) === '+1 (206) 555-9876' && (await rowValue(p7, 'phone', 'work')) === '+1 (206) 555-3400', JSON.stringify(await rows(p7, 'phone')));
    ok('audit log notes recognised icons', /icons? recognised/.test(await p7.textContent('#auditLog')), await p7.textContent('#auditLog'));
    await ctx7.close();
  }

  // Lines to check: a ZIP code the card's state doesn't use is flagged under its line; editing the line clears the note
  {
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
    await pZ.waitForSelector('#ocrStepText', { state: 'visible', timeout: 90000 });
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
      window.__ok = { green: false, noteWentFirst: null, amberAtNoteFade: null };
      const box = document.getElementById(`ocrLineOk${row}`), note = document.getElementById(`ocrLineCheck${row}`), text = document.getElementById(`ocrLineText${row}`);
      new MutationObserver(() => {
        if (box.classList.contains('is-ok') && getComputedStyle(box, '::before').backgroundColor === 'rgb(22, 163, 74)') window.__ok.green = true;
        if (note.style.opacity && Number(note.style.opacity) < 1 && window.__ok.noteWentFirst === null) { window.__ok.noteWentFirst = Number(box.style.opacity) > 0; window.__ok.amberAtNoteFade = text.classList.contains('border-amber-500'); }
      }).observe(document.getElementById('ocrLines'), { attributes: true, subtree: true, attributeFilter: ['style', 'class'] });
    }, row);
    await okBox.click();
    await pZ.waitForSelector(`#ocrLineCheck${row}`, { state: 'detached', timeout: 5000 });
    const okSeen = await pZ.evaluate(() => window.__ok);
    ok('ticking Looks right turns the box green, fades the note out a few frames before the box goes, and the field returns to normal with its text unchanged',
      okSeen.green && okSeen.noteWentFirst === true && okSeen.amberAtNoteFade === false && !(await pZ.$(`#ocrLineOk${row}`)) && !(await pZ.getAttribute(`#ocrLineText${row}`, 'aria-describedby'))
      && !(await pZ.$eval(`#ocrLineText${row}`, el => el.classList.contains('border-amber-500'))) && (await pZ.inputValue(`#ocrLineText${row}`)) === lineBefore && (await pZ.textContent('#ocrSummary')).includes('42024'), JSON.stringify(okSeen));
    // Editing a flagged line still clears its note at once (a fresh read of the same photo)
    await pZ.click('#ocrBackBtn');
    await pZ.click('#runOcrBtn');
    await pZ.waitForSelector('#ocrStepText', { state: 'visible', timeout: 90000 });
    const row2 = (await pZ.$$eval('#ocrLines select', s => s.map(x => x.value))).indexOf('cityStateZip');
    await pZ.fill(`#ocrLineText${row2}`, 'Portage, MI 49024');
    ok('editing a flagged line clears its note and box at once', !(await pZ.$(`#ocrLineCheck${row2}`)) && !(await pZ.$(`#ocrLineOk${row2}`)) && (await pZ.textContent('#ocrSummary')).includes('49024'));
    await ctxZ.close();
  }

  // Cancel while reading: the reader stops, the photo step comes back with Retake, and Extract works again
  {
    const ctxS = await browser.newContext();
    const pS = await ctxS.newPage();
    const errorsS = []; pS.on('pageerror', e => errorsS.push(String(e)));
    await pS.goto(ORIGIN); await pS.waitForTimeout(300);
    await pS.setInputFiles('#imageUpload', await renderCardImage(pS)); await pS.waitForTimeout(300);
    await pS.click('#runOcrBtn');
    ok('reading shows the photo under the shimmer with a Cancel button on the Read card, OK held back', await pS.isVisible('#ocrProgress') && (await pS.getAttribute('#ocrReadPhoto', 'src') || '').startsWith('data:image') && await pS.isVisible('#ocrStopBtn') && (await pS.evaluate(() => document.documentElement.dataset.card)) === 'read' && await pS.isDisabled('#runOcrBtn'));
    await pS.click('#ocrStopBtn');
    await pS.waitForSelector('#ocrProgress', { state: 'hidden', timeout: 10000 });
    ok('Cancel drops the photo from the Read card', !(await pS.getAttribute('#ocrReadPhoto', 'src')));
    await pS.waitForFunction(() => document.documentElement.dataset.card === 'capture', null, { timeout: 5000 }).catch(() => {});
    ok('Cancel stops reading and goes back to the photo on the Capture card (Retake or OK again)', (await pS.evaluate(() => document.documentElement.dataset.card)) === 'capture' && await pS.isVisible('#captureReview') && !(await pS.isVisible('#cropReviewModal')) && await pS.isVisible('#retakePhotoBtn') && await pS.isVisible('#runOcrBtn') && !(await pS.isDisabled('#runOcrBtn')));
    await pS.click('#runOcrBtn');
    await pS.waitForSelector('#ocrStepText', { state: 'visible', timeout: 90000 });
    ok('after Cancel, Extract reads the photo with a fresh reader', (await pS.$$('#ocrLines select')).length >= 8);
    ok('Cancel while reading: no page errors', errorsS.length === 0, errorsS.join(' | '));
    await ctxS.close();
  }

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
  {
    const ctx4 = await browser.newContext();
    const p4 = await ctx4.newPage();
    await p4.goto(ORIGIN); await p4.waitForTimeout(300);
    await p4.fill('#firstName', 'Typed');
    await p4.setInputFiles('#imageUpload', await renderCardImage(p4, 6)); await p4.waitForTimeout(300);
    await p4.click('#runOcrBtn');
    await p4.waitForSelector('#ocrRetakeNotice', { state: 'visible', timeout: 90000 }).catch(() => {});
    await p4.waitForFunction(() => document.documentElement.dataset.card === 'capture', null, { timeout: 5000 }).catch(() => {});
    ok('blurry photo: retake prompt shown on the Capture card', await p4.isVisible('#ocrRetakeNotice') && await p4.isVisible('#retakePhotoBtn') && !(await p4.isVisible('#runOcrBtn')) && (await p4.evaluate(() => document.documentElement.dataset.card)) === 'capture');
    ok('blurry photo: form left unchanged', (await p4.inputValue('#firstName')) === 'Typed' && (await p4.inputValue('#emailValue0')) === '');
    const chooser = p4.waitForEvent('filechooser', { timeout: 5000 }).then(() => true, () => false);
    await p4.click('#retakePhotoBtn');
    ok('Retake photo opens the photo picker', await chooser && !(await p4.isVisible('#cropReviewModal')));
    await p4.setInputFiles('#imageUpload', await renderCardImage(p4)); await p4.waitForTimeout(300);
    ok('new photo resets the crop step (OK back, prompt hidden)', await p4.isVisible('#runOcrBtn') && !(await p4.isVisible('#ocrRetakeNotice')));
    await p4.click('#runOcrBtn');
    await p4.waitForSelector('#ocrStepText', { state: 'visible', timeout: 90000 });
    await proceed(p4);
    ok('sharp retake is read normally', (await rowValue(p4, 'email', 'work')) === 'maria.gonzalez@northwind.com', JSON.stringify(await rows(p4, 'email')));
    await ctx4.close();
  }

  // Crooked photo: drag the corners onto the card, extract, fix a line, change a picker, fill the form
  {
    const ctx5 = await browser.newContext();
    const p5 = await ctx5.newPage();
    await p5.goto(ORIGIN); await p5.waitForTimeout(300);
    const crooked = await renderSkewedCard(p5);
    await p5.setInputFiles('#imageUpload', crooked.file); await p5.waitForTimeout(500);
    ok('crop handles shown on the photo', (await p5.$$('#cropStage [data-corner]')).length === 4 && await p5.isVisible('[data-corner="0"]'));
    ok('the handles start at the full edge of the photo, never pushed in', (await p5.getAttribute('#cropPolygon', 'points')) === '0,0 1600,0 1600,1200 0,1200', await p5.getAttribute('#cropPolygon', 'points'));
    await p5.click('#snapCardBtn'); await p5.waitForTimeout(200);
    const snapped = (await p5.getAttribute('#cropPolygon', 'points')).split(' ').map(pt => pt.split(',').map(Number));
    ok('Snap to card moves the handles onto the card\'s corners', snapped.every(([x, y], i) => Math.hypot(x - crooked.corners[i].x, y - crooked.corners[i].y) < 12), JSON.stringify(snapped) + ' vs ' + JSON.stringify(crooked.corners));
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
    ok('straightened crooked card is read (name, email, phone)', summary.includes('Maria') && summary.includes('maria.gonzalez@northwind.com') && summary.includes('555-0147'), summary);
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
    await p5.waitForSelector('#ocrStepText', { state: 'visible', timeout: 90000 });
    const roles2 = await p5.$$eval('#ocrLines select', s => s.map(x => x.value));
    await p5.fill(`#ocrLineText${roles2.indexOf('name')}`, 'Mariah Gonzalez');
    await p5.selectOption(`#ocrLineRole${roles2.indexOf('website')}`, 'notes');
    await proceed(p5);
    ok('Fill form applies the edited review', (await p5.inputValue('#firstName')) === 'Mariah' && (await rows(p5, 'website')).every(r => !r.value) && (await p5.inputValue('#notes')).includes('northwind.com') && (await rowValue(p5, 'email', 'work')) === 'maria.gonzalez@northwind.com',
      [await p5.inputValue('#firstName'), JSON.stringify(await rows(p5, 'website')), await p5.inputValue('#notes')].join(' | '));
    ok('review text cleared from the page after Fill form', (await p5.$$('#ocrLines input')).length === 0 && !(await p5.isVisible('#cropReviewModal')));
    // Rotate: the photo turns 90° and the corners reset
    await p5.setInputFiles('#imageUpload', crooked.file); await p5.waitForTimeout(500);
    const before = await p5.$eval('#reviewImage', i => [i.naturalWidth, i.naturalHeight]);
    await p5.click('#rotatePhotoBtn'); await p5.waitForTimeout(500);
    const rotated = await p5.$eval('#reviewImage', i => [i.naturalWidth, i.naturalHeight]);
    ok('Rotate 90° swaps the photo orientation', rotated[0] === before[1] && rotated[1] === before[0], `${before} -> ${rotated}`);
    await ctx5.close();
  }

  // OCR engine cannot start (language model missing, as on a host that refuses .gz): no hang, clear message, form untouched
  {
    const ctx3 = await browser.newContext();
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
    const ctxV = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    await ctxV.addInitScript(() => {
      // A 640 x 360 test feed: four colours, so the shot can be checked against the window the viewfinder showed
      navigator.mediaDevices.getUserMedia = async () => {
        const c = document.createElement('canvas'); c.width = 640; c.height = 360; const x = c.getContext('2d');
        x.fillStyle = '#ff0000'; x.fillRect(0, 0, 320, 180); x.fillStyle = '#00ff00'; x.fillRect(320, 0, 320, 180);
        x.fillStyle = '#0000ff'; x.fillRect(0, 180, 320, 180); x.fillStyle = '#ffff00'; x.fillRect(320, 180, 320, 180);
        return c.captureStream(5);
      };
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

    // The viewfinder: clean, four thin brackets, upright card frame in portrait, fader left (48 px in), shutter right
    await pV.click('#startCameraBtn'); await pV.waitForTimeout(400);
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
    await pV.waitForFunction(() => document.getElementById('cameraStream').style.transform === 'scale(2)', null, { timeout: 2000 });
    ok('zoom: the fader eases into the change instead of snapping', /^1\.[1-9]x$/.test(midway) && (await pV.textContent('#zoomDisplay')) === '2.0x', midway);

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
    }));
    const expectW = Math.round(view.w / (view.h / 360) / 2), expectH = 180;   // the view measured before the shot (the camera closes after it)
    ok('shot: exactly the window the viewfinder showed (cover crop and 2x zoom), not the whole frame', Math.abs(shot.w - expectW) <= 1 && shot.h === expectH
      && shot.tl.join() === '255,0,0' && shot.tr.join() === '0,255,0' && shot.bl.join() === '0,0,255' && shot.br.join() === '255,255,0', JSON.stringify({ shot, expectW, expectH }));
    ok('shot: the handles start at the full edge of the frame', (await pV.getAttribute('#cropPolygon', 'points')) === `0,0 ${shot.w},0 ${shot.w},${shot.h} 0,${shot.h}`, await pV.getAttribute('#cropPolygon', 'points'));
    ok('shot: no copy of the photo is left in the capture canvas', (await pV.$eval('#captureCanvas', c => c.width + c.height)) === 0);
    await pV.click('#snapCardBtn'); await pV.waitForTimeout(200);
    ok('Snap to card on a photo with no card in it leaves the handles alone and says so', (await pV.textContent('#toastMessage')).includes('No card edges found') && (await pV.getAttribute('#cropPolygon', 'points')) === `0,0 ${shot.w},0 ${shot.w},${shot.h} 0,${shot.h}`, await pV.textContent('#toastMessage'));
    ok('crop step: Rotate, Snap to card, Cancel and a green OK; OK is the only green one', (await pV.$$eval('#captureActions button', bs => bs.filter(b => b.offsetParent).map(b => b.textContent.trim()))).join('|') === 'Rotate 90°|Snap to card|Cancel|OK'
      && await pV.$eval('#runOcrBtn', b => getComputedStyle(b).backgroundColor === 'rgb(22, 163, 74)'));
    // Retake after a camera shot opens the camera again; Cancel drops the photo
    await pV.evaluate(() => document.getElementById('retakePhotoBtn').classList.remove('hidden'));
    await pV.click('#retakePhotoBtn'); await pV.waitForTimeout(300);
    ok('Retake after a camera shot opens the camera again and drops the old photo', await pV.isVisible('#cameraPanel') && !(await pV.isVisible('#captureReview')) && !(await pV.getAttribute('#reviewImage', 'src')));
    await pV.click('#stopCameraBtn');
    ok('Close camera stops the feed', await pV.evaluate(() => document.getElementById('cameraStream').srcObject === null && document.getElementById('cameraPanel').classList.contains('hidden')));
    await pV.setInputFiles('#imageUpload', await renderCardImage(pV)); await pV.waitForTimeout(300);
    ok('upload: the handles start at the full photo', await pV.isVisible('#captureReview') && (await pV.getAttribute('#cropPolygon', 'points')) === '0,0 1050,0 1050,600 0,600');
    await pV.click('#cancelReviewBtn');
    ok('Cancel on the crop step drops the photo and goes back to Take or Upload', !(await pV.isVisible('#captureReview')) && !(await pV.getAttribute('#reviewImage', 'src')) && await pV.isVisible('#startCameraBtn'));

    // Left hand (Settings): the shutter moves to the left and the fader to the right, still 48 px from the edge
    await pV.click('#navSettings'); await pV.click('#handLeftBtn'); await pV.keyboard.press('Escape'); await pV.waitForTimeout(200);
    await pV.click('#startCameraBtn'); await pV.waitForTimeout(400);
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
    ok('capture card: no page errors', errorsV.length === 0, errorsV.join(' | '));
    await ctxV.close();
  }

  // Camera in use by another app: busy at start, a virtual camera, the feed taken or muted mid-scan -> camera off + pop-up
  {
    const ctxC = await browser.newContext();
    await ctxC.addInitScript(() => {
      window.__camMode = 'normal';
      navigator.mediaDevices.getUserMedia = async () => {
        if (window.__camMode === 'busy') throw new DOMException('Could not start video source', 'NotReadableError');
        const c = document.createElement('canvas'); c.width = 640; c.height = 360;
        const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
        const stream = c.captureStream(5), track = stream.getVideoTracks()[0];
        Object.defineProperty(track, 'label', { value: window.__camMode === 'virtual' ? 'OBS Virtual Camera' : 'Integrated Camera' });
        window.__camTrack = track;
        return stream;
      };
    });
    const pC = await ctxC.newPage();
    await pC.goto(ORIGIN); await pC.waitForTimeout(300);
    const popup = () => pC.isVisible('#cameraInUseModal');
    const cameraOff = () => pC.evaluate(() => document.getElementById('cameraStream').srcObject === null && document.getElementById('cameraPanel').classList.contains('hidden'));
    const start = async (mode) => { await pC.evaluate(m => { window.__camMode = m; }, mode); await pC.click('#startCameraBtn'); await pC.waitForTimeout(300); };

    await start('normal');
    ok('ordinary camera starts with no pop-up', await pC.isVisible('#cameraPanel') && !(await popup()) && await pC.evaluate(() => !!document.getElementById('cameraStream').srcObject));
    await pC.click('#stopCameraBtn');

    await start('busy');
    ok('camera held by another app: pop-up shown, camera off', await popup() && await cameraOff());
    ok('pop-up tells the user to close the other app or upload', (await pC.textContent('#cameraInUseMessage')).includes('Another app is using or watching your camera'));
    ok('OK is focused and closes the pop-up', await pC.evaluate(() => document.activeElement && document.activeElement.id === 'cameraInUseOkBtn'));
    await pC.click('#cameraInUseOkBtn');
    ok('pop-up closed after OK', !(await popup()));

    await start('virtual');
    ok('virtual camera: pop-up shown, camera off', await popup() && await cameraOff());
    await pC.click('#cameraInUseOkBtn');

    await start('normal');
    await pC.evaluate(() => window.__camTrack.dispatchEvent(new Event('ended')));
    await pC.waitForTimeout(100);
    ok('feed taken by another app mid-scan: pop-up shown, camera off', await popup() && await cameraOff());
    await pC.click('#cameraInUseOkBtn');

    await start('normal');
    await pC.evaluate(() => { const t = window.__camTrack; Object.defineProperty(t, 'muted', { get: () => true }); t.dispatchEvent(new Event('mute')); });
    await pC.waitForTimeout(300);
    ok('brief mute does not trigger the pop-up', !(await popup()));
    await pC.waitForTimeout(1000);
    ok('feed muted while in view: pop-up shown, camera off', await popup() && await cameraOff());
    await pC.click('#cameraInUseOkBtn');

    await start('normal');
    await pC.click('#stopCameraBtn');
    await pC.evaluate(() => window.__camTrack.dispatchEvent(new Event('ended')));
    await pC.waitForTimeout(100);
    ok('closing the camera ourselves raises no pop-up', !(await popup()));
    await ctxC.close();
  }

  // MOD01 browser gate: block (the app never starts) when a protection is missing; warn and run when only the
  // system or engine outside the app is weak
  {
    ok('a current browser gets no gate banner', !(await page.$('#browserGateBanner')));
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
      await ctxG.close();
      return { shown, url, reasons, links, requested, external, pageErrors };
    };
    const noWasm = await blocked((ctxG) => ctxG.addInitScript(() => { delete window.WebAssembly; }), 'wasm');
    ok('gate: no WebAssembly opens the "cannot run" page with the reason listed', noWasm.shown && noWasm.reasons.includes('wasm'), noWasm.url);
    ok('gate: blocked app never starts (main.js not even requested)', !noWasm.requested.some(u => /\/src\/main\.js|\/assets\/index-/.test(u)), noWasm.requested.filter(u => u.endsWith('.js')).join(' '));
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
    const ctxH = await plainContext();
    const pH = await ctxH.newPage();
    const errorsH = [], externalH = [];
    pH.on('pageerror', e => errorsH.push(e.message));
    pH.on('console', m => { if (m.type() === 'error') errorsH.push('console: ' + m.text()); });
    pH.on('request', r => { if (!r.url().startsWith(ORIGIN) && !/^(data|blob):/.test(r.url())) externalH.push(r.url()); });
    pH.on('dialog', d => d.accept());
    await pH.goto(ORIGIN); await pH.waitForTimeout(400);
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
    ok('welcome: title and the tagline "Operation: Never Lose Contact"', first.title === 'Welcome to vCGE' && first.tagline === 'Operation: Never Lose Contact', JSON.stringify(first));
    ok('welcome: buttons read Set Up PIN/BIO Lock Now, START, Take a Tour, CANCEL', (await pH.textContent('#welcomePinBtn')) === 'Set Up PIN/BIO Lock Now' && (await pH.textContent('#welcomeStartBtn')) === 'START'
      && (await pH.textContent('#welcomeTourBtn')) === 'Take a Tour' && (await pH.textContent('#welcomeCancelBtn')) === 'CANCEL');
    ok('deck: the cards out of view are hidden from assistive tech and covered against taps', await pH.evaluate(() => document.querySelectorAll('.deck-card[aria-hidden="true"]').length === 5 && document.getElementById('cardWelcome').getAttribute('aria-hidden') === 'false'
      && document.querySelectorAll('.deck-card > .deck-cover').length === 6 && getComputedStyle(document.querySelector('#cardWelcome > .deck-cover')).display === 'none'
      && getComputedStyle(document.querySelector('#cardCapture > .deck-cover')).display !== 'none'));
    await pH.click('#welcomeStartBtn'); await pH.waitForTimeout(700);
    ok('welcome: START moves to the Capture card and lights its header icon', (await state()).card === 'capture'
      && await pH.$eval('#navCapture', b => b.classList.contains('is-on') && b.getAttribute('aria-current') === 'page') && await pH.$eval('#navRead', b => !b.classList.contains('is-on')));
    await pH.fill('#firstName', 'Welcomed'); await pH.waitForTimeout(400);
    ok('deck: typing in a field brings its card into view', (await pH.inputValue('#firstName')) === 'Welcomed' && (await state()).card === 'fields', (await state()).card);
    await pH.reload(); await pH.waitForTimeout(400);
    ok('welcome: shows again on the next start (nothing remembers it was seen)', (await state()).welcomeCurrent && (await stored()) === 0);
    await pH.click('#welcomePinBtn');
    ok('welcome: Set Up PIN/BIO Lock Now opens the Vault page', (await state()).vault && await pH.isVisible('#setSessionPinBtn'));
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

    await pH.click('#welcomeTourBtn');
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

    await pH.reload(); await pH.waitForTimeout(400);
    await pH.click('#welcomeTourBtn'); await pH.click('#tourSkipBtn'); await pH.waitForTimeout(700);
    ok('tour: Skip tour closes it', !(await state()).layer && (await state()).card === 'capture');

    // Phone size: one card fills the screen; the tour card sits under (or over) the area and stays on screen at every step
    await pH.setViewportSize({ width: 390, height: 844 });
    await pH.reload(); await pH.waitForTimeout(400);
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
    await pU.goto(ORIGIN); await pU.waitForTimeout(500);
    const tags = await pU.evaluate(async () => {
      await document.fonts.ready;
      // The cards' tags (the Vault page's MOD-02 and the Settings sheet's MOD-01 show only when those sheets are open)
      return Array.from(document.querySelectorAll('.deck-card > .mod-tag')).map(t => {
        const span = t.querySelector('span'), host = t.parentElement.getBoundingClientRect(), r = t.getBoundingClientRect();
        return { text: Array.from(t.children).map(c => c.textContent).join(' '), font: getComputedStyle(span).fontFamily, size: getComputedStyle(span).fontSize,
          inCorner: r.top - host.top > 8 && r.top - host.top < 20 && host.right - r.right > 8 && host.right - r.right < 24 };
      });
    });
    ok('MOD-XX tags: every card shows its module tag, in step order', tags.map(t => t.text).join('|') === 'MOD-01|MOD-03|MOD-04|MOD-05|MOD-06 MOD-07|MOD-08', tags.map(t => t.text).join('|'));
    ok('MOD-XX tags: same spot (inside the top-right corner), same font (Sixtyfour) and size', tags.every(t => t.inCorner && /Sixtyfour/.test(t.font) && t.size === tags[0].size), JSON.stringify(tags));
    await pU.click('#navVault');
    ok('MOD-XX tags: the Vault page carries MOD-02', await pU.$eval('#vaultPage .mod-tag', t => t.textContent.trim() === 'MOD-02' && t.getBoundingClientRect().width > 0));
    await pU.click('#vaultPage [data-sheet-close]');
    ok('MOD-XX tags: the bundled Sixtyfour font loads', await pU.evaluate(async () => { await document.fonts.load('10px Sixtyfour'); return document.fonts.check('10px Sixtyfour'); }));
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
    await pU.mouse.click(flip.x + flip.width / 2, flip.y + 1.5); await settled(pU);
    ok('a mouse click on the edge still works (only fingers get the near-miss guard)', (await turned()) === 'rotateY(0deg)', await turned());
    await pU.setViewportSize({ width: 390, height: 844 });
    ok('phone width: the app reports the phone layout and nothing scrolls sideways', await pU.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--vcge-layout').trim() === 'phone' && document.documentElement.scrollWidth <= innerWidth));
    ok('shared look: no missing files, no page errors', missingU.length === 0 && errorsU.length === 0, missingU.concat(errorsU).join(' | '));
    await ctxU.close();
  }

  // 3D Card (MOD06, redesign step 8): fall themes on the card face, every line with its label, swipe-to-spin, toasts
  // at the top, the pilots as samples with their animal logos, the Logo controls on this card
  {
    const ctx6 = await browser.newContext({ hasTouch: true });
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
    await p6.mouse.move(cx - flipper.width * 0.3, cy); await p6.mouse.down();
    for (let i = 1; i <= 8; i++) await p6.mouse.move(cx - flipper.width * 0.3 + flipper.width * 0.6 * i / 8, cy);
    const midway = await angle();
    await p6.mouse.up(); await settled(p6);
    ok('card: a sideways drag across the card turns it with the finger and it settles on the front', /rotateY\(2[5-9]\d|rotateY\(3[0-5]\d/.test(midway) && (await angle()) === 'rotateY(0deg)', `${midway} -> ${await angle()}`);
    await p6.mouse.move(cx, cy); await p6.mouse.down(); await p6.mouse.move(cx + 3, cy); await p6.mouse.up(); await settled(p6);
    ok('card: a drag shorter than a tap still counts as a tap (flips)', (await angle()) === 'rotateY(180deg)', await angle());
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
    // A sample brings its animal as the logo (a bundled file, drawn on the device, kept in its own colours)
    await p6.click('#navFields'); await p6.waitForTimeout(500);
    await p6.selectOption('#fakeContactSelect', '1');   // Ghost the Raccoon
    await p6.waitForFunction(() => !!document.querySelector('#previewAvatar img'), null, { timeout: 5000 });
    await p6.waitForTimeout(300);
    const ghost = await p6.evaluate(() => ({ name: document.getElementById('previewFullName').textContent, theme: document.getElementById('currentPaletteLabel').textContent, logo: document.querySelector('#previewAvatar img').src.slice(0, 21), badge: getComputedStyle(document.getElementById('previewAvatar')).display !== 'none', remove: getComputedStyle(document.getElementById('removeAvatarBtn')).display !== 'none' }));
    ok('sample: Ghost the Raccoon lands with the Twilight theme and the raccoon as a picture logo in the badge, Remove now shown', ghost.name === 'Ghost Raccoon' && ghost.theme === 'Twilight' && ghost.logo === 'data:image/png;base64' && ghost.badge && ghost.remove, JSON.stringify(ghost));
    const [dl6] = await Promise.all([p6.waitForEvent('download'), p6.click('#downloadVcfBtn')]);
    const vcf6 = fs.readFileSync(await dl6.path(), 'utf8');
    ok('sample: the .vcf carries the animal as a JPEG photo and the 555-01 number', /PHOTO;TYPE=JPEG;ENCODING=b:/.test(vcf6) && vcf6.includes('+1 (202) 555-0102') && vcf6.includes('ghost@example.com'), vcf6.split('\r\n').filter(l => /^(TEL|EMAIL|PHOTO)/.test(l)).map(l => l.slice(0, 40)).join(' | '));
    await p6.click('#navCard'); await p6.waitForTimeout(500);
    const sides = await p6.evaluate(() => { const r = document.getElementById('removeAvatarBtn').getBoundingClientRect(), u = document.getElementById('avatarUpload').parentElement.getBoundingClientRect(); return { gap: u.left - r.right, removeText: document.getElementById('removeAvatarBtn').textContent.trim() }; });
    ok('logo: "Remove logo" sits well away from the upload (on the far left)', sides.removeText === 'Remove logo' && sides.gap > 80, JSON.stringify(sides));
    await p6.click('#removeAvatarBtn');
    ok('logo: Remove takes the logo off and says so; the initials are back', !(await p6.$('#previewAvatar img')) && (await p6.textContent('#previewAvatar')).trim() === 'GR' && (await p6.textContent('#toastMessage')) === 'Logo removed.');
    await p6.click('#toastAction').catch(() => {});
    await p6.click('#navFields'); await p6.waitForTimeout(300);
    await p6.click('#clearFormBtn'); await p6.click('#toastAction');
    await p6.waitForTimeout(300);
    ok('sample: Undo after Clear brings the sample back without its logo (removed before) and with its theme', (await p6.inputValue('#firstName')) === 'Ghost' && (await p6.textContent('#currentPaletteLabel')) === 'Twilight' && !(await p6.$('#previewAvatar img')));
    ok('card: no page errors, nothing fetched from outside, no missing files', errors6.length === 0 && external6.length === 0 && missing6.length === 0, errors6.concat(external6, missing6).join(' | '));
    await ctx6.close();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close(); server.kill();
  process.exitCode = fail ? 1 : 0;
})().catch(e => { console.error(e); process.exit(1); });
