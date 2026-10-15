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
async function dragCorners(page, corners) {
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

async function decodeQr(page) {
  const qr = await page.evaluate(() => { const c = document.getElementById('qrCanvas'); return { w: c.width, h: c.height, data: Array.from(c.getContext('2d').getImageData(0, 0, c.width, c.height).data) }; });
  const r = jsQR(Uint8ClampedArray.from(qr.data), qr.w, qr.h);
  return r && r.data;
}

// Sets a session PIN from the Security panel.
async function setPin(page, pin) {
  await page.click('#setSessionPinBtn');
  await page.fill('#sessionPinInput', pin); await page.click('#quickSetupSaveBtn');
  await page.waitForSelector('#quickSetupModal', { state: 'hidden' });
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
  const secretBoxes = await page.$$eval('#vaultPin, #sessionPinInput',
    els => els.map(el => ({ type: el.type, masked: getComputedStyle(el).webkitTextSecurity, ac: el.getAttribute('autocomplete'), caps: el.getAttribute('autocapitalize') })));
  ok('PIN boxes are masked text fields, not password fields (no save-password prompt)', secretBoxes.length === 2 && secretBoxes.every(b => b.type === 'text' && b.masked === 'disc'), JSON.stringify(secretBoxes));
  ok('PIN boxes opt out of autofill and keyboard capitalisation', secretBoxes.every(b => b.ac === 'off' && b.caps === 'none'));
  ok('PIN boxes take 4 digits on a number keypad', (await page.$$eval('#vaultPin, #sessionPinInput', els => els.every(el => el.inputMode === 'numeric' && el.maxLength === 4))));
  ok('no password field anywhere on the page', (await page.$$('input[type=password]')).length === 0);

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
  ok('upload opens review modal', await visible('cropReviewModal'));
  await page.evaluate(() => { window.__ocrButtonTexts = []; new MutationObserver(() => window.__ocrButtonTexts.push(document.getElementById('runOcrBtn').textContent)).observe(document.getElementById('runOcrBtn'), { childList: true, characterData: true, subtree: true }); });
  await page.click('#runOcrBtn');
  await page.waitForSelector('#ocrStepText', { state: 'visible', timeout: 90000 });
  const buttonTexts = await page.evaluate(() => window.__ocrButtonTexts);
  ok('first scan says the reader is being prepared, then extracting', buttonTexts.indexOf('Preparing the reader…') >= 0 && buttonTexts.indexOf('Extracting…', buttonTexts.indexOf('Preparing the reader…')) > 0, buttonTexts.join(' | '));
  ok('review step lists the OCR lines with a field picker each', (await page.$$('#ocrLines select')).length >= 8 && (await page.inputValue('#ocrLineRole0')) === 'name', String((await page.$$('#ocrLines select')).length));
  ok('nothing reaches the form before Fill form', !(await rows(page, 'email')).some(r => r.value.includes('northwind')));
  ok('"Will fill" summary shows the mapped fields', (await text('ocrSummary')).includes('maria.gonzalez@northwind.com') && (await text('ocrSummary')).includes('Northwind Systems'));
  await page.click('#applyOcrBtn');
  await page.waitForSelector('#cropReviewModal', { state: 'hidden' });
  const got = {}; for (const f of ['firstName', 'lastName', 'jobTitle', 'organization', 'street', 'city', 'state', 'zip']) got[f] = await val(f);
  got.phoneWork = await rowValue(page, 'phone', 'work'); got.email = await rowValue(page, 'email', 'work'); got.website = await rowValue(page, 'website', 'work');
  ok('real OCR extracts name, title, organization', got.firstName === 'Maria' && got.lastName === 'Gonzalez' && got.jobTitle === 'Director of Engineering' && got.organization === 'Northwind Systems', JSON.stringify(got));
  ok('real OCR extracts phone, email, website', got.phoneWork === '+1 (312) 555-0147' && got.email === 'maria.gonzalez@northwind.com' && got.website === 'https://northwind.com', JSON.stringify(got));
  ok('real OCR extracts street, city, state, zip', got.street === '233 South Wacker Drive' && got.city === 'Chicago' && got.state === 'IL' && got.zip === '60606', JSON.stringify(got));
  ok('user told the form was filled', (await text('toastMessage')).includes('Form filled'));
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

  // Flip & theme
  await page.click('#flipCardBtn');
  ok('card flips', (await page.$eval('#card3DFlipper', el => el.style.transform)) === 'rotateY(180deg)');
  await page.click('#themeToggle');
  ok('theme toggles to light', !(await page.evaluate(() => document.documentElement.classList.contains('dark'))));
  await page.click('#themeToggle');
  await page.waitForTimeout(600);

  // Wipe button
  await page.click('#wipeVaultBtn'); await page.waitForTimeout(200);
  ok('Wipe empties the card, the scan and Reopen last scan', (await val('firstName')) === '' && !(await visible('reopenScanBtn')) && (await text('auditLog')).includes('Vault wiped'));
  ok('Wipe leaves the app usable (no dialog)', !(await visible('vaultModal')) && (await text('vaultBadge')) === 'Vault: UNLOCKED');

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
    await p2.clock.fastForward(60000);
    await p2.fill('#organization', 'Activity resets');
    await p2.clock.fastForward(100000);
    ok('activity restarts the TTL (not purged at 165 s)', (await p2.inputValue('#firstName')) === 'Idle');
    await p2.clock.fastForward(25000);
    ok('idle 120 s without a PIN wipes the card', (await p2.inputValue('#firstName')) === '' && (await p2.textContent('#previewFullName')).trim() === 'New Contact' && !(await p2.isVisible('#vaultModal')));
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
    await p8.click('#setSessionPinBtn');
    await p8.fill('#sessionPinInput', '12'); await p8.click('#quickSetupSaveBtn');
    ok('session PIN: too-short PIN refused', (await t8('quickSetupError')) === 'Use exactly 4 digits.', await t8('quickSetupError'));
    await p8.fill('#sessionPinInput', '2468'); await p8.click('#quickSetupSaveBtn');
    await p8.waitForSelector('#quickSetupModal', { state: 'hidden' });
    ok('session PIN set: Security panel shows it and Lock appears', (await t8('sessionPinStatus')) === 'Session PIN: set' && await p8.isVisible('#lockVaultBtn'));
    await p8.fill('#firstName', 'Quick'); await p8.fill('#lastName', 'Unlock');
    await idle();
    ok('idle with a session PIN: card hidden, PIN prompt', await p8.isVisible('#vaultModal') && (await t8('vaultModalTitle')) === 'Locked' && await p8.isVisible('#vaultPin') && (await p8.inputValue('#firstName')) === '');
    ok('quick lock: badge, indicator and countdown show the 7-minute reset', (await t8('vaultBadge')) === 'Vault: LOCKED' && /^LOCKED \(resets in 4:5\d\)$/.test(await t8('vaultStateIndicator')) && (await t8('quickUnlockCountdown')).includes('everything resets in 4:5'), await t8('vaultStateIndicator'));
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
    await p8.clock.fastForward(301000);
    ok('idle lock, then 7 minutes since the last activity: card and PIN wiped, no dialog', !(await p8.isVisible('#vaultModal')) && (await p8.inputValue('#firstName')) === '' && (await t8('toastMessage')).startsWith('Reset: 7 minutes without activity') && (await t8('sessionPinStatus')) === 'Session PIN: not set', await t8('toastMessage'));

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
    ok('"Wipe and start over" wipes the held card', !(await p8.isVisible('#vaultModal')) && (await p8.inputValue('#firstName')) === '' && (await t8('auditLog')).includes('Vault wiped (start over)'));

    await setPin(p8, '4321');
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
    ok('biometric not offered before a PIN is set', !(await pB.isVisible('#biometricRow')));
    await setPin(pB, '2468');
    ok('biometric offered once a PIN is set', await pB.isVisible('#biometricRow') && (await tB('biometricStatus')) === 'Face ID / fingerprint: off');
    await pB.click('#addBiometricBtn'); await pB.waitForTimeout(500);
    ok('biometric added for this session', (await tB('biometricStatus')) === 'Face ID / fingerprint: on' && (await tB('auditLog')).includes('Face ID / fingerprint added'), await tB('toastMessage'));
    await pB.fill('#firstName', 'Bio'); await pB.click('#lockVaultBtn');
    ok('lock screen offers Face ID / fingerprint', await pB.isVisible('#vaultBiometricBtn') && (await pB.inputValue('#firstName')) === '');
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
    await pB.click('#clearSessionPinBtn');
    ok('removing the PIN removes biometric too', !(await pB.isVisible('#biometricRow')) && !(await pB.isVisible('#lockVaultBtn')));
    ok('biometric: nothing saved to browser storage', !(await pB.evaluate(() => JSON.stringify(localStorage) + JSON.stringify(sessionStorage))).includes('Bio'));
    ok('biometric: no network requests', externalB.length === 0, externalB.join(', '));
    ok('biometric: no page errors', errorsB.length === 0, errorsB.join(' | '));
    await ctxB.close();
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
    await p10.click('#applyOcrBtn');
    ok('restored review fills the form', (await p10.inputValue('#firstName')) === 'Mariah' && await p10.isVisible('#reopenScanBtn'));

    await idle();
    await unlockPin();
    ok('after Fill form, the PIN brings back "Reopen last scan" (dialog stays closed)', await p10.isVisible('#reopenScanBtn') && !(await p10.isVisible('#cropReviewModal')) && (await p10.inputValue('#firstName')) === 'Mariah');
    await p10.click('#reopenScanBtn');
    ok('reopened scan after a PIN unlock shows the edited lines', (await p10.inputValue(`#ocrLineText${roles10.indexOf('name')}`)) === 'Mariah Gonzalez');
    await p10.click('#ocrCancelBtn');

    await idle();
    await p10.clock.fastForward(301000); await p10.waitForTimeout(300);
    ok('7 minutes without activity wipe the card and the kept scan', !(await p10.isVisible('#vaultModal')) && !(await p10.isVisible('#reopenScanBtn')) && !(await p10.isVisible('#cropReviewModal')) && (await p10.inputValue('#firstName')) === '');
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
    // Wide logos: dark text on a transparent background, a light one, an opaque red banner, an SVG with a size and one
    // with only a viewBox; and a small round logo with a wide transparent margin.
    const logo = (kind) => p11.evaluate((kind) => {
      const text = '<text x="10" y="70" font-size="60" fill="#0a6">TeamLogic</text>';
      if (kind === 'svg') return 'data:image/svg+xml;base64,' + btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="100">${text}</svg>`);
      if (kind === 'viewbox') return 'data:image/svg+xml;base64,' + btoa(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 100">${text.replace('#0a6', '#06a')}</svg>`);
      const c = document.createElement('canvas'); c.width = kind === 'round' ? 300 : 400; c.height = kind === 'round' ? 300 : 100;
      const x = c.getContext('2d');
      if (kind === 'round') { x.fillStyle = '#e11'; x.beginPath(); x.arc(150, 150, 40, 0, 7); x.fill(); return c.toDataURL('image/png'); }
      if (kind === 'opaque') { x.fillStyle = '#c00'; x.fillRect(0, 0, 400, 100); }
      x.fillStyle = kind === 'light' ? '#f5f5f5' : kind === 'opaque' ? '#fff' : '#123';
      x.font = 'bold 60px Arial'; x.fillText('TeamLogic', 10, 70);
      return c.toDataURL('image/png');
    }, kind);
    // Uploads a logo; returns the vCard PHOTO (from the .vcf) and what the card shows.
    const upload = async (kind, name) => {
      const url = await logo(kind);
      const before = await p11.evaluate(() => { const i = document.querySelector('#formAvatarPreview img'); return i ? i.src : ''; });
      await p11.setInputFiles('#avatarUpload', { name, mimeType: url.slice(5, url.indexOf(';')), buffer: Buffer.from(url.split(',')[1], 'base64') });
      await p11.waitForFunction((before) => { const i = document.querySelector('#formAvatarPreview img'); return i && i.src !== before && i.complete; }, before);
      await p11.waitForTimeout(300);   // the logo's shape and tone are read, then the card is drawn again
      const [dl] = await Promise.all([p11.waitForEvent('download'), p11.click('#downloadVcfBtn')]);
      const vcf = fs.readFileSync(await dl.path(), 'utf8').replace(/\r\n[ \t]/g, '');
      const m = /\r\nPHOTO;TYPE=(\w+);ENCODING=b:([A-Za-z0-9+/=]+)/.exec(vcf);
      return p11.evaluate(async ([type, b64]) => {
        const img = new Image(); img.src = `data:image/${type.toLowerCase()};base64,${b64}`; await img.decode();
        const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
        const x = c.getContext('2d'); x.drawImage(img, 0, 0);
        const at = (px, py) => Array.from(x.getImageData(px, py, 1, 1).data.slice(0, 3));
        const strip = document.getElementById('previewLogoStrip'), plate = strip.firstElementChild;
        const shown = (strip.querySelector('img') || document.querySelector('#previewAvatar img'));
        return {
          // Fitted, not cropped: the wide logo leaves the top and bottom bands as background.
          photo: { type, w: img.naturalWidth, h: img.naturalHeight, corner: at(2, 2), band: at(128, 40) },
          display: { png: shown.src.startsWith('data:image/png'), w: shown.naturalWidth, h: shown.naturalHeight },
          strip: !strip.classList.contains('hidden') && strip.getBoundingClientRect().height > 0,
          badge: getComputedStyle(document.getElementById('previewAvatar')).display !== 'none',
          plate: plate ? plate.className : document.getElementById('previewAvatar').className
        };
      }, [m[1], m[2]]);
    };
    const near = (rgb, target, tol = 40) => rgb.every((v, k) => Math.abs(v - target[k]) <= tol);
    const dark = await upload('dark', 'logo.png');
    ok('vCard photo is a 256 px square JPEG, fitted (not cropped)', dark.photo.type === 'JPEG' && dark.photo.w === 256 && dark.photo.h === 256 && near(dark.photo.band, [255, 255, 255]), JSON.stringify(dark.photo));
    ok('transparent dark logo: white behind it in the vCard photo', near(dark.photo.corner, [255, 255, 255]), JSON.stringify(dark.photo.corner));
    ok('card keeps the transparency and trims the empty space', dark.display.png && dark.display.w < 400 && dark.display.h < 100, JSON.stringify(dark.display));
    ok('wide logo gets the strip across the card, not the small badge', dark.strip && !dark.badge, JSON.stringify(dark));
    ok('dark transparent logo: white plate in dark mode only', /(^| )dark:bg-white( |$)/.test(dark.plate) && !dark.plate.includes('gradient'), dark.plate);
    const light = await upload('light', 'light.png');
    ok('transparent light logo: dark background in the vCard photo', light.photo.corner.every(v => v < 80), JSON.stringify(light.photo.corner));
    ok('light transparent logo: plate in the palette colour on the card', light.plate.includes('bg-gradient-to-tr'), light.plate);
    const opaque = await upload('opaque', 'banner.png');
    ok('opaque logo is extended with its own edge colour', near(opaque.photo.corner, [204, 0, 0], 50), JSON.stringify(opaque.photo.corner));
    ok('opaque logo: trimmed to the lettering, no plate', !opaque.display.png && opaque.display.w < 360 && !opaque.plate.includes('gradient') && !opaque.plate.includes('dark:bg-white'), JSON.stringify(opaque));
    const svg = await upload('svg', 'logo.svg');
    ok('SVG logo is accepted and converted', svg.photo.w === 256 && near(svg.photo.corner, [255, 255, 255]) && svg.strip, JSON.stringify(svg));
    const viewbox = await upload('viewbox', 'viewbox.svg');
    ok('SVG with only a viewBox keeps its wide shape (not squashed square)', viewbox.strip && viewbox.display.w / viewbox.display.h > 3 && near(viewbox.photo.band, [255, 255, 255]), JSON.stringify(viewbox));
    const round = await upload('round', 'round.png');
    ok('small logo in a wide margin: trimmed, stays in the badge', !round.strip && round.badge && round.display.w < 110 && Math.abs(round.display.w - round.display.h) < 4, JSON.stringify(round));
    // Print: the strip does not fit on a 2 in card, so the printed card shows the logo in the badge, with every line in.
    await upload('dark', 'logo.png');
    await p11.fill('#street', '745 Fifth Avenue'); await p11.fill('#city', 'New York');
    await p11.evaluate(() => { window.print = () => {}; });
    await p11.click('#printCardBtn');
    await p11.emulateMedia({ media: 'print' });
    const printed = await p11.evaluate(() => {
      const card = document.querySelector('#printSheet .print-card'), r = card.getBoundingClientRect();
      const strip = card.querySelector('.basis-full'), badgeImg = [...card.querySelectorAll('img')].find(i => i.getBoundingClientRect().height > 0);
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
    await p11.click('#flipCardBtn');
    await p11.click('#clearFormBtn');
    const cleared = await p11.evaluate(() => ({ font: document.getElementById('cardFontSelect').value, serif: document.getElementById('cardFront').classList.contains('font-serif'), flip: document.getElementById('card3DFlipper').style.transform, logo: !!document.querySelector('#previewLogoStrip img') }));
    ok('Clear form: Sans typeface, front side up, no logo', cleared.font === 'font-sans' && !cleared.serif && cleared.flip === 'rotateY(0deg)' && !cleared.logo, JSON.stringify(cleared));
    await p11.click('#toastAction');
    await p11.waitForTimeout(300);
    const undone = await p11.evaluate(() => ({ font: document.getElementById('cardFontSelect').value, back: document.getElementById('cardBack').classList.contains('font-serif'), logo: !!document.querySelector('#previewLogoStrip img') }));
    ok('Undo brings back the typeface and the logo strip', undone.font === 'font-serif' && undone.back && undone.logo, JSON.stringify(undone));
    ok('round 3: no page errors', errors11.length === 0, errors11.join(' | '));
    await ctx11.close();
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
    await p9.click('#presetButtonsContainer button');
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
    await p9.click('#applyOcrBtn');
    ok('Fill form offers Undo and "Reopen last scan"', (await p9.inputValue('#firstName')) === 'Maria' && await p9.isVisible('#toastAction') && await p9.isVisible('#reopenScanBtn'));
    await p9.click('#toastAction');
    ok('Undo after Fill form restores the card from before the scan', (await p9.inputValue('#firstName')) === 'Typed');
    await p9.click('#reopenScanBtn');
    ok('Reopen last scan shows the review step again (no OCR run)', await p9.isVisible('#ocrStepText') && (await p9.$$('#ocrLines select')).length >= 8 && (await p9.textContent('#ocrSummary')).includes('maria.gonzalez@northwind.com'));
    await p9.click('#applyOcrBtn');
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
    await p7.click('#applyOcrBtn');
    ok('social logo + handle fills the Instagram profile link', (await rowValue(p7, 'website', 'instagram')) === 'https://instagram.com/studiocraft', JSON.stringify(await rows(p7, 'website')));
    ok('typed phone rows reach the form', (await rowValue(p7, 'phone', 'mobile')) === '+1 (206) 555-9876' && (await rowValue(p7, 'phone', 'work')) === '+1 (206) 555-3400', JSON.stringify(await rows(p7, 'phone')));
    ok('audit log notes recognised icons', /icons? recognised/.test(await p7.textContent('#auditLog')), await p7.textContent('#auditLog'));
    await ctx7.close();
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
    ok('blurry photo: retake prompt shown in the review dialog', await p4.isVisible('#ocrRetakeNotice') && await p4.isVisible('#retakePhotoBtn') && !(await p4.isVisible('#runOcrBtn')));
    ok('blurry photo: form left unchanged', (await p4.inputValue('#firstName')) === 'Typed' && (await p4.inputValue('#emailValue0')) === '');
    const chooser = p4.waitForEvent('filechooser', { timeout: 5000 }).then(() => true, () => false);
    await p4.click('#retakePhotoBtn');
    ok('Retake photo opens the photo picker', await chooser && !(await p4.isVisible('#cropReviewModal')));
    await p4.setInputFiles('#imageUpload', await renderCardImage(p4)); await p4.waitForTimeout(300);
    ok('new photo resets the dialog (Extract fields back, prompt hidden)', await p4.isVisible('#runOcrBtn') && !(await p4.isVisible('#ocrRetakeNotice')));
    await p4.click('#runOcrBtn');
    await p4.waitForSelector('#ocrStepText', { state: 'visible', timeout: 90000 });
    await p4.click('#applyOcrBtn');
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
    ok('Back to photo returns to step 1', await p5.isVisible('#ocrStepPhoto') && !(await p5.isVisible('#ocrStepText')));
    await p5.click('#runOcrBtn');
    await p5.waitForSelector('#ocrStepText', { state: 'visible', timeout: 90000 });
    const roles2 = await p5.$$eval('#ocrLines select', s => s.map(x => x.value));
    await p5.fill(`#ocrLineText${roles2.indexOf('name')}`, 'Mariah Gonzalez');
    await p5.selectOption(`#ocrLineRole${roles2.indexOf('website')}`, 'notes');
    await p5.click('#applyOcrBtn');
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
    ok('missing OCR model: extraction ends instead of hanging', settled && (await p3.textContent('#runOcrBtn')).trim() === 'Extract fields');
    ok('missing OCR model: user told the engine could not start', (await p3.textContent('#toastMessage')).includes('OCR engine could not start'), await p3.textContent('#toastMessage'));
    ok('missing OCR model: form left unchanged (no sample text)', (await p3.inputValue('#firstName')) === 'Typed' && (await p3.inputValue('#emailValue0')) === 'typed@example.com' && (await p3.inputValue('#lastName')) === '');
    await ctx3.close();
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

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close(); server.kill();
  process.exitCode = fail ? 1 : 0;
})().catch(e => { console.error(e); process.exit(1); });
