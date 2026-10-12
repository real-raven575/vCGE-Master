// vCGE end-to-end tests in headless Chromium (`npm run test:e2e`).
// Needs devDependencies (`npm install`) and a Chromium for Playwright (`npx playwright install chromium`).
const path = require('path'), fs = require('fs'), { spawn } = require('child_process');
const { chromium } = require('playwright');
const jsQR = require('jsqr');

const ROOT = path.resolve(__dirname, '..');
const PORT = String(18000 + Math.floor(Math.random() * 2000));
const ORIGIN = `http://localhost:${PORT}/`;

// Renders a business card image in the page so OCR runs on real pixels.
async function renderCardImage(page) {
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 1050; c.height = 600;
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.fillStyle = '#111';
    const lines = [['bold 56px Arial', 'Maria Gonzalez'], ['34px Arial', 'Director of Engineering'], ['34px Arial', 'Northwind Systems'],
      ['30px Arial', '+1 (312) 555-0147'], ['30px Arial', 'maria.gonzalez@northwind.com'], ['30px Arial', 'https://northwind.com'],
      ['30px Arial', '233 South Wacker Drive'], ['30px Arial', 'Chicago, IL 60606']];
    let y = 80; for (const [f, t] of lines) { x.font = f; x.fillText(t, 70, y); y += f.startsWith('bold') ? 80 : 62; }
    return c.toDataURL('image/png');
  });
  return { name: 'card.png', mimeType: 'image/png', buffer: Buffer.from(dataUrl.split(',')[1], 'base64') };
}

async function decodeQr(page) {
  const qr = await page.evaluate(() => { const c = document.getElementById('qrCanvas'); return { w: c.width, h: c.height, data: Array.from(c.getContext('2d').getImageData(0, 0, c.width, c.height).data) }; });
  const r = jsQR(Uint8ClampedArray.from(qr.data), qr.w, qr.h);
  return r && r.data;
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
  await page.waitForSelector('#cropReviewModal', { state: 'hidden', timeout: 90000 });
  const got = {}; for (const f of ['firstName', 'lastName', 'jobTitle', 'organization', 'phoneWork', 'email', 'website', 'street', 'city', 'state', 'zip']) got[f] = await val(f);
  ok('real OCR extracts name, title, organization', got.firstName === 'Maria' && got.lastName === 'Gonzalez' && got.jobTitle === 'Director of Engineering' && got.organization === 'Northwind Systems', JSON.stringify(got));
  ok('real OCR extracts phone, email, website', got.phoneWork === '+1 (312) 555-0147' && got.email === 'maria.gonzalez@northwind.com' && got.website === 'https://northwind.com', JSON.stringify(got));
  ok('real OCR extracts street, city, state, zip', got.street === '233 South Wacker Drive' && got.city === 'Chicago' && got.state === 'IL' && got.zip === '60606', JSON.stringify(got));
  ok('user told fields were extracted (not simulated)', (await text('toastMessage')).includes('Fields extracted'));
  ok('audit log records OCR (not simulated)', (await text('auditLog')).includes('OCR text extracted') && !(await text('auditLog')).includes('simulated'));
  const qrAfter = await decodeQr(page);
  ok('QR follows OCR result', qrAfter && qrAfter.includes('FN:Maria Gonzalez'), qrAfter);

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
    await p2.fill('#firstName', 'Kept'); await p2.clock.fastForward(1000);
    await p2.clock.fastForward(125000);
    ok('idle purge locks vault and re-prompts', await p2.isVisible('#vaultModal') && (await p2.inputValue('#firstName')) === '');
    await p2.fill('#vaultPassphrase', 'idle passphrase'); await p2.click('#vaultUnlockBtn');
    await p2.waitForSelector('#vaultModal', { state: 'hidden' });
    ok('encrypted card survives idle purge', (await p2.inputValue('#firstName')) === 'Kept');
    await ctx2.close();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close(); server.kill();
  process.exitCode = fail ? 1 : 0;
})().catch(e => { console.error(e); process.exit(1); });
