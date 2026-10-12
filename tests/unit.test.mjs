// vCGE unit tests: pure-logic modules in Node 18+ (`npm test`). No browser needed.
import { createRequire } from 'node:module';
const R = new URL('../src', import.meta.url).pathname;
const require = createRequire(import.meta.url);
globalThis.window = globalThis;
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear(),
};

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('PASS', name); }
  else { fail++; console.log('FAIL', name, detail); }
};

const share = await import(`${R}/share/index.js`);
ok('share barrel exports its public API', ['globalEventBus','EventBus','Events','CONTACT_FIELDS','escapeVCardText','createEmptyContact','validateContact','ContactSchemaVersion','CryptoUtils','RegexMatchers','formatVCard'].every(k => k in share));

// EventBus
{
  const bus = new share.EventBus(); let got = null;
  const off = bus.subscribe('x', d => got = d);
  bus.publish('x', 42); ok('EventBus publish delivers', got === 42);
  off(); got = null; bus.publish('x', 1); ok('EventBus unsubscribe works', got === null);
  bus.subscribe('y', () => { throw new Error('boom'); }); let second = false;
  bus.subscribe('y', () => second = true);
  const origErr = console.error; console.error = () => {};
  bus.publish('y'); console.error = origErr;
  ok('EventBus isolates throwing listener', second);
}

// Schema
{
  const c = share.createEmptyContact();
  ok('createEmptyContact has uuid id', typeof c.id === 'string' && c.id.length > 10);
  ok('validateContact rejects empty names', !share.validateContact(c).isValid);
  ok('validateContact accepts valid', share.validateContact({ ...c, firstName: 'A', lastName: 'B', email: 'a@b.co' }).isValid);
  ok('validateContact flags bad email', share.validateContact({ ...c, firstName: 'A', lastName: 'B', email: 'nope' }).errors.length === 1);
}

// vCard formatter (share)
{
  const v = share.formatVCard({ firstName: 'Jane', lastName: 'Doe', organization: 'Acme', email: 'j@a.com' });
  ok('formatVCard BEGIN/END/VERSION', v.startsWith('BEGIN:VCARD\r\nVERSION:3.0') && v.endsWith('END:VCARD'));
  ok('formatVCard N field', v.includes('N:Doe;Jane;;;'));
  const esc = share.formatVCard({ firstName: 'A', lastName: 'B', organization: 'Smith, Jones; Co' });
  ok('formatVCard escapes , and ; (RFC 2426)', esc.includes('ORG:Smith\\, Jones\\; Co'), JSON.stringify(esc.split('\n').find(l => l.startsWith('ORG'))));
  const crlf = share.formatVCard({ firstName: 'A', lastName: 'B' });
  ok('formatVCard uses CRLF line endings (RFC 2425)', crlf.includes('\r\n'));
}

// RegexMatchers (shared constants) + one canonical schema
{
  ok('RegexMatchers no longer duplicates OCR parsing', typeof share.RegexMatchers.parseOCRText === 'undefined' && share.RegexMatchers.email instanceof RegExp);
  const c = share.createEmptyContact();
  ok('schema has every CONTACT_FIELD', share.CONTACT_FIELDS.every(f => f in c));
  ok('formatVCard PHOTO type follows data URL', share.formatVCard({ firstName: 'A', lastName: 'B', avatarBase64: 'data:image/png;base64,AAAA' }).includes('PHOTO;TYPE=PNG;ENCODING=b:AAAA'));
}

// CryptoUtils round-trip
{
  let threw = false;
  try { await share.CryptoUtils.encryptVault({ a: 1 }); } catch (e) { threw = true; }
  ok('CryptoUtils refuses to encrypt without a passphrase (no default key)', threw);
  const enc = await share.CryptoUtils.encryptVault({ a: 1 }, 'correct horse');
  const enc2 = await share.CryptoUtils.encryptVault({ a: 1 }, 'correct horse');
  ok('CryptoUtils uses a fresh random salt per encryption', enc.salt.length === 16 && enc.salt.join() !== enc2.salt.join());
  const dec = await share.CryptoUtils.decryptVault(enc, 'correct horse');
  ok('CryptoUtils round-trip', dec && dec.a === 1);
  const origErr = console.error; console.error = () => {};
  const wrong = await share.CryptoUtils.decryptVault(enc, 'other-key');
  const legacyDefault = await share.CryptoUtils.decryptVault(enc);
  console.error = origErr;
  ok('CryptoUtils rejects wrong key', wrong === null);
  ok('CryptoUtils rejects missing passphrase on decrypt', legacyDefault === null);
}

// Vault
{
  const { SecureStorageVault } = await import(`${R}/modules/mod02-vault/vault.js`);
  const v = new SecureStorageVault('t');
  ok('vault initialize', (await v.initialize('pw')).success);
  await v.encryptAndStore({ name: 'Jane' });
  ok('vault same-session round-trip', (await v.retrieveAndDecrypt()).name === 'Jane');
  // Simulate app restart: new instance, same passphrase.
  const v2 = new SecureStorageVault('t');
  await v2.initialize('pw');
  let reopened = null;
  const origErr = console.error; console.error = () => {};
  try { reopened = await v2.retrieveAndDecrypt(); } catch (e) { reopened = 'THREW:' + e.message; }
  console.error = origErr;
  ok('vault reopens after restart with same passphrase', reopened && reopened.name === 'Jane', String(reopened));
  const v3 = new SecureStorageVault('t');
  await v3.initialize('not-the-passphrase');
  let wrong = null;
  console.error = () => {};
  try { await v3.retrieveAndDecrypt(); wrong = 'ACCEPTED'; } catch (e) { wrong = e.message; }
  console.error = origErr;
  ok('vault rejects wrong passphrase', wrong === 'ERR_VAULT_DECRYPT_FAIL', wrong);
  ok('vault lock drops key but keeps data', v2.lock().status === 'LOCKED' && v2.masterKey === null && v2.hasStoredVault());
  v.zeroFillWipe();
  ok('vault zeroFillWipe clears storage', localStorage.getItem('t') === null && v.masterKey === null);
}

// TTL manager
{
  const { TTLMemoryStreamManager } = await import(`${R}/modules/mod02-vault/ttlManager.js`);
  let expired = null; const buf = { name: 'Jane', n: 5 };
  const m = new TTLMemoryStreamManager(1, e => expired = e);
  m.startStream(buf);
  await new Promise(r => setTimeout(r, 1300));
  ok('TTL expires and calls back 3001', expired && expired.code === '3001');
  ok('TTL overwrites string fields', buf.name === '0x000000_WIPED');
  ok('TTL reports 0 remaining once expired', m.getRemainingTime() === 0);

  // Deadline-based: a jump in wall-clock time (throttled background timers) still expires on the next tick.
  const realNow = Date.now; let offset = 0; Date.now = () => realNow() + offset;
  let expired2 = false; const m2 = new TTLMemoryStreamManager(120, () => expired2 = true);
  m2.startStream({ a: 'x' });
  ok('TTL starts at full duration', m2.getRemainingTime() === 120);
  offset = 119500; ok('TTL remaining follows wall clock', m2.getRemainingTime() === 1, m2.getRemainingTime());
  offset = 125000; await new Promise(r => setTimeout(r, 1100));
  Date.now = realNow;
  ok('TTL expires on next tick after a clock jump', expired2);
}

// Form mapper (single OCR text -> contact mapper)
{
  const { ContactFormMapper } = await import(`${R}/modules/mod05-form/formMapper.js`);
  const fm = new ContactFormMapper();
  ok('formatPhone US 10-digit', fm.formatPhone('4155550199') === '+1 (415) 555-0199');
  ok('formatPhone UK', fm.formatPhone('442071234567', 'UK') === '+44 20 7123 4567', fm.formatPhone('442071234567', 'UK'));
  const d = fm.parseOCRText('Alex Morgan\nVP of Product Design\nApex Innovations\n+1 (415) 555-0199\n(415) 555-0100\nalex.m@apexinnovations.io\nhttps://apexinnovations.io\n500 Howard Street\nSan Francisco, CA 94105');
  ok('mapper uses canonical names', d.jobTitle === 'VP of Product Design' && d.organization === 'Apex Innovations' && d.firstName === 'Alex' && !('org' in d) && !('title' in d), JSON.stringify(d));
  ok('mapper fills work then mobile phone', /555-0199/.test(d.phoneWork) && /555-0100/.test(d.phoneMobile), d.phoneWork + ' / ' + d.phoneMobile);
  ok('mapper parses street and City, ST ZIP', d.street === '500 Howard Street' && d.city === 'San Francisco' && d.state === 'CA' && d.zip === '94105', JSON.stringify(d));
  const keys = Object.keys(d).filter(k => k !== 'country');
  ok('mapper output keys are all CONTACT_FIELDS', keys.every(k => share.CONTACT_FIELDS.includes(k)), keys.join());
}

// QR engine (ESM, delegates to shared formatter)
{
  const { VCGEQREngine } = await import(`${R}/modules/mod07-qr/qrGenerator.js`);
  const q = new VCGEQREngine();
  const contact = { firstName: 'Jane', lastName: 'Doe', organization: 'Smith, Jones', birthday: '1990-01-02' };
  ok('MOD07 output identical to shared formatter', q.generateVCard30(contact) === share.formatVCard(contact));
  ok('MOD07 escapes ORG comma', q.generateVCard30(contact).includes('ORG:Smith\\, Jones'));

  // Render with the bundled qrcode-generator onto an in-memory canvas, then decode with jsQR.
  const jsQR = require('jsqr');
  globalThis.qrcode = require('../src/vendor/qrcode-generator/qrcode.js');
  const makeCanvas = () => {
    const c = { width: 0, height: 0, _px: null };
    const ctx = {
      fillStyle: '#000000', font: '', textAlign: '',
      fillRect(x, y, w, h) {
        if (!c._px || c._px.length !== c.width * c.height * 4) c._px = new Uint8ClampedArray(c.width * c.height * 4);
        const v = this.fillStyle.toLowerCase() === '#ffffff' ? 255 : 0;
        for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) { const o = (j * c.width + i) * 4; c._px[o] = c._px[o + 1] = c._px[o + 2] = v; c._px[o + 3] = 255; }
      },
      fillText() {}
    };
    c.getContext = () => ctx;
    return c;
  };
  const utf8Contact = { firstName: 'José', lastName: 'Müller', organization: 'Café Zürich' };
  const canvas = makeCanvas();
  ok('QR renders with bundled library', q.renderQRCode(canvas, q.generateVCard30(utf8Contact), { size: 320 }) === true && canvas.width <= 320);
  const decoded = jsQR(canvas._px, canvas.width, canvas.height);
  ok('QR decodes to the exact vCard, UTF-8 intact', decoded && decoded.data === q.generateVCard30(utf8Contact), decoded && decoded.data);
  const huge = makeCanvas();
  const origWarn = console.warn; console.warn = () => {};
  const hugeOk = q.renderQRCode(huge, 'x'.repeat(5000));
  console.warn = origWarn;
  ok('QR falls back (labelled) when data exceeds capacity', hugeOk === false);
  delete globalThis.qrcode;
}

// OCR worker (ESM): returns raw text, flags simulation, publishes on the shared bus
{
  globalThis.document = { createElement: () => ({ getContext: () => ({ drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray(4) }), putImageData() {} }), toDataURL: () => 'data:image/png;base64,' }) };
  globalThis.Image = class { set src(v) { this.width = 10; this.height = 10; setTimeout(() => this.onload(), 0); } };
  const origLog = console.log, origWarn = console.warn; console.log = () => {}; console.warn = () => {};
  const ocr = await import(`${R}/modules/mod04-ocr/ocrWorker.js`);
  let evt = null; share.globalEventBus.subscribe(share.Events.OCR_TEXT_EXTRACTED, e => evt = e);
  const r = await ocr.executeOCRScan('data:image/png;base64,x');
  console.log = origLog; console.warn = origWarn;
  ok('OCR returns raw text and simulated flag', typeof r.text === 'string' && r.simulated === true);
  ok('OCR publishes OCR_TEXT_EXTRACTED on shared bus', evt && evt.simulated === true && evt.text === r.text);
  ok('OCR no longer exposes a duplicate parser', !('parseExtractedTextToSchema' in ocr));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
