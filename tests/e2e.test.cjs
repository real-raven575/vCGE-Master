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

// After a full unlock the app offers a session PIN; most tests decline it.
async function skipQuickSetup(page) {
  await page.waitForSelector('#quickSetupModal', { state: 'visible', timeout: 5000 });
  await page.click('#quickSetupSkipBtn');
}

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
  ok('vault modal shown on first run (create mode)', await visible('vaultModal') && (await text('vaultModalTitle')).includes('Create'));

  // Create vault
  await page.fill('#vaultPassphrase', 'short'); await page.fill('#vaultPassphraseConfirm', 'short'); await page.click('#vaultUnlockBtn');
  ok('rejects passphrase shorter than 8', (await text('vaultError')).includes('8'));
  await page.fill('#vaultPassphrase', 'correct horse 42'); await page.fill('#vaultPassphraseConfirm', 'correct horse 42'); await page.click('#vaultUnlockBtn');
  await page.waitForTimeout(300);
  ok('vault created and modal closed', !(await visible('vaultModal')));
  ok('session PIN offered after unlocking', await visible('quickSetupModal'));
  await skipQuickSetup(page);
  ok('indicator shows unlocked', (await text('vaultStateIndicator')).startsWith('UNLOCKED'));

  // Edit contact -> preview + encrypted save
  await page.fill('#firstName', 'Jane'); await page.fill('#lastName', 'Doe'); await page.fill('#organization', 'Smith, Jones');
  await page.waitForTimeout(800);
  ok('preview updates from form', (await text('previewFullName')) === 'Jane Doe' && (await text('previewOrg')) === 'Smith, Jones');
  const st = await storage();
  ok('vault blob saved', st.includes('vCGE_secure_vault.dat'));
  ok('no plaintext contact data in storage', !st.includes('Jane') && !st.includes('Smith'), st.slice(0, 200));
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

  // OCR flow: bundled Tesseract.js reads a rendered card offline
  await page.setInputFiles('#imageUpload', await renderCardImage(page)); await page.waitForTimeout(300);
  ok('upload opens review modal', await visible('cropReviewModal'));
  await page.click('#runOcrBtn');
  await page.waitForSelector('#ocrStepText', { state: 'visible', timeout: 90000 });
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

  // Flip & theme
  await page.click('#flipCardBtn');
  ok('card flips', (await page.$eval('#card3DFlipper', el => el.style.transform)) === 'rotateY(180deg)');
  await page.click('#themeToggle');
  ok('theme toggles to light', !(await page.evaluate(() => document.documentElement.classList.contains('dark'))));
  await page.click('#themeToggle');
  await page.waitForTimeout(600);

  // Reload: unlock with wrong then right passphrase
  await page.reload(); await page.waitForTimeout(500);
  ok('after reload: unlock mode', (await text('vaultModalTitle')).includes('Unlock') && !(await visible('vaultConfirmRow')));
  ok('after reload: form empty while locked', (await val('firstName')) === '');
  await page.fill('#vaultPassphrase', 'wrong passphrase'); await page.click('#vaultUnlockBtn'); await page.waitForTimeout(300);
  ok('wrong passphrase rejected', (await text('vaultError')) === 'Wrong passphrase.' && await visible('vaultModal'));
  await page.fill('#vaultPassphrase', 'correct horse 42'); await page.click('#vaultUnlockBtn'); await page.waitForTimeout(300);
  ok('right passphrase restores saved card', (await val('firstName')) === 'Maria' && (await val('city')) === 'Chicago');
  await skipQuickSetup(page);

  // Lock, then wipe
  await page.click('#lockVaultBtn'); await page.waitForTimeout(200);
  ok('lock clears form and re-prompts', (await val('firstName')) === '' && await visible('vaultModal'));
  ok('lock keeps encrypted vault', (await storage()).includes('vCGE_secure_vault.dat'));
  await page.click('#vaultSkipBtn'); await page.waitForTimeout(100);
  ok('continue without saving -> memory mode', (await text('vaultStateIndicator')).startsWith('NOT SAVED'));
  await page.click('#wipeVaultBtn'); await page.waitForTimeout(200);
  ok('wipe deletes vault and re-prompts in create mode', !(await storage()).includes('vCGE_secure_vault.dat') && (await text('vaultModalTitle')).includes('Create'));

  // Bundled card fonts load locally
  const fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    const fams = ['Inter', 'Playfair Display', 'Fira Code'];
    for (const f of fams) await document.fonts.load(`700 16px "${f}"`);
    return fams.map(f => document.fonts.check(`700 16px "${f}"`));
  });
  ok('bundled fonts (Inter, Playfair Display, Fira Code) load', fonts.every(Boolean), JSON.stringify(fonts));

  ok('no external requests during whole session', external.length === 0, external.join(', '));
  // The vault logs ERR 2001 when the deliberately wrong passphrase is tried; any other error fails the test.
  const unexpected = errors.filter(e => !e.includes('[ERR 2001] Decryption failed'));
  ok('no page errors (besides the expected wrong-passphrase ERR 2001)', unexpected.length === 0 && errors.length === 1, errors.join(' | '));
  // Startup residue check + 120 s idle purge (fresh context with a controllable clock)
  {
    const ctx2 = await browser.newContext();
    await ctx2.addInitScript(() => {
      if (!sessionStorage.getItem('seeded')) {
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem('vcge_contact_state', '{"name":"Old Plaintext"}');
        localStorage.setItem('vcge_state', '{"firstName":"Old"}');
      }
    });
    const p2 = await ctx2.newPage();
    p2.on('dialog', d => d.accept());
    await p2.clock.install();
    await p2.goto(ORIGIN); await p2.waitForTimeout(300);
    const st2 = await p2.evaluate(() => JSON.stringify(localStorage));
    ok('startup purges legacy plaintext keys', !st2.includes('Old Plaintext') && !st2.includes('vcge_state'), st2);
    await p2.click('#vaultSkipBtn');
    await p2.fill('#firstName', 'Idle'); await p2.fill('#lastName', 'Tester');
    await p2.clock.fastForward(5000);
    ok('countdown shows remaining time', /Auto-clear in 11\d s/.test(await p2.textContent('#purgeCountdown')), await p2.textContent('#purgeCountdown'));
    await p2.clock.fastForward(60000);
    await p2.fill('#organization', 'Activity resets');
    await p2.clock.fastForward(100000);
    ok('activity restarts the TTL (not purged at 165 s)', (await p2.inputValue('#firstName')) === 'Idle');
    await p2.clock.fastForward(25000);
    ok('idle 120 s purges in-memory card', (await p2.inputValue('#firstName')) === '' && (await p2.textContent('#previewFullName')).trim() === 'New Contact');
    ok('purge logged in audit log', (await p2.textContent('#auditLog')).includes('RAM purged (idle)'));

    // Vault mode: purge locks the vault, encrypted data survives
    await p2.click('#wipeVaultBtn'); await p2.waitForTimeout(100);
    await p2.fill('#vaultPassphrase', 'idle passphrase'); await p2.fill('#vaultPassphraseConfirm', 'idle passphrase'); await p2.click('#vaultUnlockBtn');
    await p2.waitForSelector('#vaultModal', { state: 'hidden' });
    await skipQuickSetup(p2);
    await p2.fill('#firstName', 'Kept'); await p2.clock.fastForward(1000);
    await p2.click('#setSessionPinBtn');
    await p2.clock.fastForward(125000);
    ok('idle lock closes an open PIN dialog', !(await p2.isVisible('#quickSetupModal')));
    ok('idle purge without a session PIN locks the vault fully (passphrase prompt)', await p2.isVisible('#vaultModal') && (await p2.inputValue('#firstName')) === '' && await p2.isVisible('#vaultPassphrase') && !(await p2.isVisible('#vaultPin')));
    await p2.fill('#vaultPassphrase', 'idle passphrase'); await p2.click('#vaultUnlockBtn');
    await p2.waitForSelector('#vaultModal', { state: 'hidden' });
    ok('encrypted card survives idle purge', (await p2.inputValue('#firstName')) === 'Kept');
    await ctx2.close();
  }

  // Quick unlock: session PIN after an idle lock (5-minute window) and passkeys (virtual authenticator with PRF)
  {
    const ctx8 = await browser.newContext();
    const p8 = await ctx8.newPage();
    const errors8 = [];
    p8.on('pageerror', e => errors8.push(e.message));
    p8.on('console', m => { if (m.type() === 'error') errors8.push('console: ' + m.text()); });
    p8.on('dialog', d => d.accept());
    await p8.clock.install();
    const cdp = await ctx8.newCDPSession(p8);
    await cdp.send('WebAuthn.enable');
    const authOptions = { protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true };
    let { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { ...authOptions, hasPrf: true } });
    const t8 = id => p8.textContent('#' + id).then(t => t.trim());
    const idle = async () => { await p8.clock.fastForward(1000); await p8.clock.fastForward(IDLE_MS); };
    const IDLE_MS = 125000;
    await p8.goto(ORIGIN); await p8.waitForTimeout(300);

    await p8.fill('#vaultPassphrase', 'quick passphrase 1'); await p8.fill('#vaultPassphraseConfirm', 'quick passphrase 1'); await p8.click('#vaultUnlockBtn');
    await p8.waitForSelector('#quickSetupModal', { state: 'visible' });
    await p8.fill('#sessionPinInput', '12'); await p8.click('#quickSetupSaveBtn');
    ok('session PIN: too-short PIN refused', (await t8('quickSetupError')).includes('4'));
    await p8.fill('#sessionPinInput', '2468'); await p8.click('#quickSetupSaveBtn');
    await p8.waitForSelector('#quickSetupModal', { state: 'hidden' });
    ok('session PIN set: Security panel shows it', (await t8('sessionPinStatus')) === 'Session PIN: set' && await p8.isVisible('#quickUnlockPanel'));
    await p8.fill('#firstName', 'Quick'); await p8.fill('#lastName', 'Unlock');
    await idle();
    ok('idle with a session PIN: card hidden, PIN prompt (no passphrase box)', await p8.isVisible('#vaultModal') && (await t8('vaultModalTitle')) === 'Locked' && await p8.isVisible('#vaultPin') && !(await p8.isVisible('#vaultPassphrase')) && (await p8.inputValue('#firstName')) === '');
    ok('quick lock: indicator and countdown show the 5-minute window', /^LOCKED \(PIN for [45]:/.test(await t8('vaultStateIndicator')) && (await t8('quickUnlockCountdown')).includes('PIN unlock available for'), await t8('vaultStateIndicator'));
    ok('quick lock: no plaintext in storage', !(await p8.evaluate(() => JSON.stringify(localStorage))).includes('Quick'));
    await p8.fill('#vaultPin', '1111'); await p8.click('#vaultUnlockBtn'); await p8.waitForTimeout(300);
    ok('wrong session PIN rejected with tries left', (await t8('vaultError')) === 'Wrong PIN. 4 tries left.', await t8('vaultError'));
    await p8.fill('#vaultPin', '2468'); await p8.click('#vaultUnlockBtn');
    await p8.waitForSelector('#vaultModal', { state: 'hidden' });
    ok('right session PIN restores the card', (await p8.inputValue('#firstName')) === 'Quick' && (await t8('auditLog')).includes('Vault unlocked (session PIN)'));
    ok('no PIN offer after a PIN unlock', !(await p8.isVisible('#quickSetupModal')));
    await idle();
    await p8.clock.fastForward(301000);
    ok('after 5 minutes the PIN expires: full lock, passphrase needed', (await t8('vaultModalTitle')) === 'Unlock your vault' && await p8.isVisible('#vaultPassphrase') && !(await p8.isVisible('#vaultPin')) && (await t8('auditLog')).includes('quick unlock expired'));
    await p8.fill('#vaultPassphrase', 'quick passphrase 1'); await p8.click('#vaultUnlockBtn');
    await p8.waitForSelector('#quickSetupModal', { state: 'visible' });
    ok('PIN was forgotten with the full lock (offered again)', (await p8.inputValue('#firstName')) === 'Quick');
    await p8.fill('#sessionPinInput', '1357'); await p8.click('#quickSetupSaveBtn'); await p8.waitForSelector('#quickSetupModal', { state: 'hidden' });
    await idle();
    for (let i = 0; i < 5; i++) { await p8.fill('#vaultPin', '0000'); await p8.click('#vaultUnlockBtn'); await p8.waitForTimeout(250); }
    ok('5 wrong PINs: full lock, passphrase needed', (await t8('vaultError')).startsWith('5 wrong PINs') && await p8.isVisible('#vaultPassphrase') && !(await p8.isVisible('#vaultPin')), await t8('vaultError'));
    await p8.fill('#vaultPassphrase', 'quick passphrase 1'); await p8.click('#vaultUnlockBtn');
    await skipQuickSetup(p8);
    await p8.click('#lockVaultBtn');
    ok('Lock button locks fully (passphrase prompt)', await p8.isVisible('#vaultPassphrase') && !(await p8.isVisible('#vaultPasskeyBtn')));
    await p8.fill('#vaultPassphrase', 'quick passphrase 1'); await p8.click('#vaultUnlockBtn');
    await p8.waitForSelector('#vaultModal', { state: 'hidden' });
    ok('declined PIN offer is not repeated in the same session', !(await p8.isVisible('#quickSetupModal')));
    await p8.click('#setSessionPinBtn');
    ok('Security panel: Set PIN opens the PIN dialog', await p8.isVisible('#quickSetupModal'));
    await p8.fill('#sessionPinInput', '4321'); await p8.click('#quickSetupSaveBtn');
    await p8.waitForSelector('#quickSetupModal', { state: 'hidden' });
    ok('Security panel: PIN set, Change and Remove offered', (await t8('sessionPinStatus')) === 'Session PIN: set' && (await t8('setSessionPinBtn')) === 'Change' && await p8.isVisible('#clearSessionPinBtn'));
    await p8.click('#clearSessionPinBtn');
    ok('Security panel: Remove forgets the PIN', (await t8('sessionPinStatus')) === 'Session PIN: not set' && (await t8('auditLog')).includes('Session PIN removed'));

    // Passkeys
    ok('passkeys offered in the Security panel', await p8.isVisible('#addPasskeyBtn') && !(await p8.isVisible('#passkeyUnsupported')));
    await p8.click('#addPasskeyBtn');
    ok('add passkey asks for the passphrase, with a device name', await p8.isVisible('#passkeyModal') && (await p8.inputValue('#passkeyLabel')).endsWith('passkey'));
    await p8.fill('#passkeyPassphrase', 'not it'); await p8.click('#passkeySaveBtn'); await p8.waitForTimeout(300);
    ok('add passkey: wrong passphrase refused, and the message says it is not the session PIN', (await t8('passkeyError')).includes('not the vault passphrase') && (await t8('passkeyError')).includes('session PIN'));
    await p8.fill('#passkeyLabel', 'Test fingerprint'); await p8.fill('#passkeyPassphrase', 'quick passphrase 1'); await p8.click('#passkeySaveBtn');
    await p8.waitForSelector('#passkeyModal', { state: 'hidden' });
    ok('passkey enrolled and listed', (await t8('passkeyList')).includes('Test fingerprint') && (await t8('auditLog')).includes('Passkey added (Test fingerprint)'));
    const blob8 = JSON.parse(await p8.evaluate(() => localStorage.getItem('vCGE_secure_vault.dat')));
    ok('vault stores a passkey slot (wrapped key only)', blob8.v === 2 && blob8.passkeys.length === 1 && blob8.passkeys[0].wrapped.length > 0 && !JSON.stringify(blob8).includes('Quick'));
    await p8.click('#lockVaultBtn');
    ok('unlock screen offers the passkey', await p8.isVisible('#vaultPasskeyBtn') && (await t8('vaultModalHint')).includes('passkey'));
    await p8.click('#vaultPasskeyBtn');
    await p8.waitForSelector('#vaultModal', { state: 'hidden' });
    ok('passkey unlocks the vault (no passphrase typed)', (await p8.inputValue('#firstName')) === 'Quick' && (await t8('auditLog')).includes('Vault unlocked (passkey)'));
    await p8.reload(); await p8.waitForTimeout(300);
    ok('after reload the passkey still unlocks', await p8.isVisible('#vaultPasskeyBtn'));
    await p8.click('#vaultPasskeyBtn');
    await p8.waitForSelector('#vaultModal', { state: 'hidden' });
    ok('passkey unlock after reload restores the card', (await p8.inputValue('#firstName')) === 'Quick');
    await p8.fill('#sessionPinInput', '8642'); await p8.click('#quickSetupSaveBtn'); await p8.waitForSelector('#quickSetupModal', { state: 'hidden' });
    await idle();
    ok('quick lock offers PIN and passkey', await p8.isVisible('#vaultPin') && await p8.isVisible('#vaultPasskeyBtn'));
    await p8.click('#vaultPasskeyBtn');
    await p8.waitForSelector('#vaultModal', { state: 'hidden' });
    ok('passkey resumes from a quick lock', (await p8.inputValue('#firstName')) === 'Quick');
    await idle();
    await p8.click('#vaultUsePassphraseBtn');
    ok('"Use the passphrase instead" switches the prompt', await p8.isVisible('#vaultPassphrase') && !(await p8.isVisible('#vaultPin')));
    await p8.fill('#vaultPassphrase', 'quick passphrase 1'); await p8.click('#vaultUnlockBtn');
    await p8.waitForSelector('#vaultModal', { state: 'hidden' });
    ok('passphrase works from a quick lock', (await p8.inputValue('#firstName')) === 'Quick');

    // A passkey provider without PRF cannot unlock an encrypted vault: refused, nothing stored
    await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });
    ({ authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { ...authOptions, hasPrf: false } }));
    await p8.click('#addPasskeyBtn');
    await p8.fill('#passkeyPassphrase', 'quick passphrase 1'); await p8.click('#passkeySaveBtn');
    await p8.waitForFunction(() => document.getElementById('passkeyError').textContent.length > 0, null, { timeout: 10000 }).catch(() => {});
    ok('passkey without PRF refused with an explanation', (await t8('passkeyError')).includes('PRF') && JSON.parse(await p8.evaluate(() => localStorage.getItem('vCGE_secure_vault.dat'))).passkeys.length === 1, await t8('passkeyError'));
    await p8.click('#passkeyCancelBtn');
    await p8.click('#passkeyRemove0');
    ok('passkey removed', (await p8.$$('#passkeyList li')).length === 0 && (await t8('auditLog')).includes('Passkey removed'));
    await p8.click('#lockVaultBtn');
    ok('removed passkey no longer offered', !(await p8.isVisible('#vaultPasskeyBtn')));
    await p8.fill('#vaultPassphrase', 'quick passphrase 1'); await p8.click('#vaultUnlockBtn');
    await p8.waitForSelector('#vaultModal', { state: 'hidden' });

    // Continue without saving from a quick lock drops the retained vault key
    await p8.waitForSelector('#quickSetupModal', { state: 'visible' });
    await p8.fill('#sessionPinInput', '9753'); await p8.click('#quickSetupSaveBtn');
    await p8.waitForSelector('#quickSetupModal', { state: 'hidden' });
    await idle();
    await p8.click('#vaultSkipBtn');
    const keyDropped = process.env.SERVE_DIR ? true : await p8.evaluate(async () => !(await import('/src/modules/mod02-vault/vault.js')).secureVault.isUnlocked);
    ok('continue without saving from a quick lock drops the vault key', (await t8('vaultStateIndicator')).startsWith('NOT SAVED') && keyDropped && (await p8.inputValue('#firstName')) === '');
    const unexpected8 = errors8.filter(e => !e.includes('[ERR 2001]'));
    ok('quick unlock: no page errors', unexpected8.length === 0, unexpected8.join(' | '));
    await ctx8.close();
  }

  // Tester feedback round 1: Undo after a sample / clear / scan fill, reopen the last scan, readable SMS and email, one-page print
  {
    const ctx9 = await browser.newContext();
    const p9 = await ctx9.newPage();
    const errors9 = [];
    p9.on('pageerror', e => errors9.push(e.message));
    p9.on('console', m => { if (m.type() === 'error') errors9.push('console: ' + m.text()); });
    await p9.goto(ORIGIN); await p9.waitForTimeout(300);
    await p9.click('#vaultSkipBtn');
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
    await p7.click('#vaultSkipBtn');
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

  // A card saved in the old layout (schema 3.0) is converted when the vault is unlocked
  if (!process.env.SERVE_DIR) {
    const ctx6 = await browser.newContext();
    const p6 = await ctx6.newPage();
    await p6.goto(ORIGIN); await p6.waitForTimeout(300);
    await p6.fill('#vaultPassphrase', 'migration passphrase'); await p6.fill('#vaultPassphraseConfirm', 'migration passphrase'); await p6.click('#vaultUnlockBtn');
    await p6.waitForSelector('#vaultModal', { state: 'hidden' });
    await skipQuickSetup(p6);
    await p6.evaluate(async () => {
      const { secureVault } = await import('/src/modules/mod02-vault/vault.js');
      await secureVault.encryptAndStore({ firstName: 'Old', lastName: 'Layout', phoneWork: '+1 (555) 201-0001', phoneMobile: '+1 (555) 201-0002', email: 'old@layout.co', website: 'layout.co', street: '1 Main St', city: 'Boise', state: 'ID', zip: '83701', country: 'United States', themePalette: 'ocean' });
    });
    await p6.reload(); await p6.waitForTimeout(300);
    await p6.fill('#vaultPassphrase', 'migration passphrase'); await p6.click('#vaultUnlockBtn');
    await p6.waitForSelector('#vaultModal', { state: 'hidden' });
    ok('old-layout saved card opens with typed rows', (await p6.inputValue('#firstName')) === 'Old' && (await rowValue(p6, 'phone', 'work')) === '+1 (555) 201-0001' && (await rowValue(p6, 'phone', 'mobile')) === '+1 (555) 201-0002'
      && (await rowValue(p6, 'email', 'work')) === 'old@layout.co' && (await rowValue(p6, 'website', 'work')) === 'layout.co' && (await p6.inputValue('#stateSelect')) === 'ID',
      JSON.stringify([await rows(p6, 'phone'), await rows(p6, 'email'), await rows(p6, 'website')]));
    await ctx6.close();
  }

  // Blurry photo: OCR runs but the result is unreadable -> retake prompt, form untouched
  {
    const ctx4 = await browser.newContext();
    const p4 = await ctx4.newPage();
    await p4.goto(ORIGIN); await p4.waitForTimeout(300);
    await p4.click('#vaultSkipBtn');
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
    await p5.click('#vaultSkipBtn');
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
    await p3.click('#vaultSkipBtn');
    await p3.fill('#firstName', 'Typed'); await p3.fill('#emailValue0', 'typed@example.com');
    await p3.setInputFiles('#imageUpload', await renderCardImage(p3)); await p3.waitForTimeout(300);
    await p3.click('#runOcrBtn');
    const settled = await p3.waitForSelector('#cropReviewModal', { state: 'hidden', timeout: 30000 }).then(() => true, () => false);
    ok('missing OCR model: extraction ends instead of hanging', settled && (await p3.textContent('#runOcrBtn')).trim() === 'Extract fields');
    ok('missing OCR model: user told the engine could not start', (await p3.textContent('#toastMessage')).includes('OCR engine could not start'), await p3.textContent('#toastMessage'));
    ok('missing OCR model: form left unchanged (no sample text)', (await p3.inputValue('#firstName')) === 'Typed' && (await p3.inputValue('#emailValue0')) === 'typed@example.com' && (await p3.inputValue('#lastName')) === '');
    await ctx3.close();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close(); server.kill();
  process.exitCode = fail ? 1 : 0;
})().catch(e => { console.error(e); process.exit(1); });
