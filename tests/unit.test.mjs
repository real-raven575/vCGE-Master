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
  // FAIL lines go straight to stdout: some sections silence console.log, and a failure must always name itself
  else { fail++; process.stdout.write(`FAIL ${name} ${detail}\n`); }
};

const share = await import(`${R}/share/index.js`);
ok('share barrel exports its public API', ['globalEventBus','EventBus','Events','CONTACT_FIELDS','CONTACT_LIST_FIELDS','escapeVCardText','createEmptyContact','normalizeContact','validateContact','ContactSchemaVersion','CryptoUtils','RegexMatchers','formatVCard','PHONE_TYPES','REGIONS','COUNTRIES','splitStreetUnit','websiteTypeFor'].every(k => k in share));

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
  ok('validateContact accepts valid', share.validateContact({ ...c, firstName: 'A', lastName: 'B', emails: [{ type: 'work', value: 'a@b.co' }] }).isValid);
  ok('validateContact flags bad email', share.validateContact({ ...c, firstName: 'A', lastName: 'B', emails: [{ type: 'work', value: 'nope' }] }).errors.length === 1);
}

// vCard formatter (share)
{
  const v = share.formatVCard({ firstName: 'Jane', lastName: 'Doe', organization: 'Acme', emails: [{ type: 'work', value: 'j@a.com' }] });
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
  ok('formatVCard leaves out a photo contact apps cannot read (SVG)', !share.formatVCard({ firstName: 'A', lastName: 'B', avatarBase64: 'data:image/svg+xml;base64,PHN2Zz4=' }).includes('PHOTO'));
  ok('formatVCard writes a JPEG photo', share.formatVCard({ firstName: 'A', lastName: 'B', avatarBase64: 'data:image/jpeg;base64,/9j/' }).includes('PHOTO;TYPE=JPEG;ENCODING=b:/9j/'));
}

// Richer contact fields: typed lists, name parts, units, regions (schema 3.1)
{
  const c = share.createEmptyContact();
  ok('empty contact has typed lists, work address, default country', share.CONTACT_LIST_FIELDS.every(f => Array.isArray(c[f]) && !c[f].length) && c.addressType === 'work' && c.country === 'United States');
  const old = { firstName: 'Ann', lastName: 'Lee', phoneWork: '+1 (555) 201-0001', phoneMobile: '+1 (555) 201-0002', email: 'ann@lee.co', website: 'lee.co', street: '1 Main St', country: 'United States' };
  const n = share.normalizeContact(old);
  ok('schema 3.0 card converted: single fields become typed rows', JSON.stringify(n.phones) === JSON.stringify([{ type: 'work', value: '+1 (555) 201-0001' }, { type: 'mobile', value: '+1 (555) 201-0002' }])
    && JSON.stringify(n.emails) === JSON.stringify([{ type: 'work', value: 'ann@lee.co' }]) && JSON.stringify(n.websites) === JSON.stringify([{ type: 'work', value: 'lee.co' }]), JSON.stringify(n));
  ok('converted card drops the old keys and keeps the rest', !('phoneWork' in n) && !('email' in n) && !('website' in n) && n.street === '1 Main St' && n.firstName === 'Ann' && n.middleName === '' && n.addressType === 'work');
  ok('normalize is idempotent and drops empty rows', JSON.stringify(share.normalizeContact(n)) === JSON.stringify(n) && share.normalizeContact({ phones: [{ type: 'work', value: ' ' }] }).phones.length === 0);

  const v = share.formatVCard({ namePrefix: 'Dr.', firstName: 'Jane', middleName: 'Q.', lastName: 'Roe', nameSuffix: 'PhD',
    phones: [{ type: 'mobile', value: '+1 555 0101' }, { type: 'work', value: '+1 555 0102' }, { type: 'workFax', value: '+1 555 0103' }, { type: 'home', value: '+1 555 0104' }, { type: 'main', value: '+1 555 0105' }, { type: 'pager', value: '+1 555 0106' }],
    emails: [{ type: 'work', value: 'jane@roe.co' }, { type: 'personal', value: 'jane@gmail.com' }],
    websites: [{ type: 'work', value: 'https://roe.co' }, { type: 'personal', value: 'https://jane.me' }, { type: 'linkedin', value: 'https://linkedin.com/in/jane' }, { type: 'x', value: 'https://x.com/jane' }, { type: 'blog', value: 'https://blog.roe.co' }],
    addressType: 'home', street: '100 Queen Street West', unitType: 'Suite', unitNumber: '300', city: 'Toronto', state: 'ON', zip: 'M5H 2N2', country: 'Canada' }).split('\r\n');
  ok('vCard N and FN carry prefix, middle name and suffix', v.includes('N:Roe;Jane;Q.;Dr.;PhD') && v.includes('FN:Dr. Jane Q. Roe\\, PhD'), v.slice(2, 4).join(' | '));
  ok('vCard phone types', ['TEL;TYPE=CELL,VOICE:+1 555 0101', 'TEL;TYPE=WORK,VOICE:+1 555 0102', 'TEL;TYPE=WORK,FAX:+1 555 0103', 'TEL;TYPE=HOME,VOICE:+1 555 0104', 'TEL;TYPE=MAIN:+1 555 0105', 'TEL;TYPE=PAGER:+1 555 0106'].every(l => v.includes(l)), v.filter(l => l.startsWith('TEL')).join(' | '));
  ok('vCard email types', v.includes('EMAIL;TYPE=INTERNET,WORK:jane@roe.co') && v.includes('EMAIL;TYPE=INTERNET,HOME:jane@gmail.com'));
  ok('vCard websites: work/home URL types, plain URL otherwise', v.includes('URL;TYPE=WORK:https://roe.co') && v.includes('URL;TYPE=HOME:https://jane.me') && v.includes('URL:https://blog.roe.co'));
  ok('vCard social profiles: X-SOCIALPROFILE plus URL', v.includes('X-SOCIALPROFILE;TYPE=linkedin:https://linkedin.com/in/jane') && v.includes('URL:https://linkedin.com/in/jane') && v.includes('X-SOCIALPROFILE;TYPE=twitter:https://x.com/jane'));
  ok('vCard address: type, unit joined to the street, region and country', v.includes('ADR;TYPE=HOME:;;100 Queen Street West\\, Suite 300;Toronto;ON;M5H 2N2;Canada'), v.find(l => l.startsWith('ADR')));
  const box = share.formatVCard({ firstName: 'A', lastName: 'B', addressType: 'other', unitType: 'PO Box', unitNumber: '77', city: 'Boise', state: 'ID', zip: '83701', country: 'United States' });
  ok('vCard PO Box in its own ADR slot; Other address has no type', box.includes('ADR:PO Box 77;;;Boise;ID;83701;United States'), box.split('\r\n').find(l => l.startsWith('ADR')));
  ok('vCard has no ADR when only the default country is set', !share.formatVCard({ firstName: 'A', lastName: 'B', country: 'United States' }).includes('ADR'));

  ok('splitStreetUnit: suite, ordinal floor, #, PO Box, not a street named Unit',
    JSON.stringify(share.splitStreetUnit('500 Howard Street, Ste. 400')) === JSON.stringify({ street: '500 Howard Street', unitType: 'Suite', unitNumber: '400' })
    && share.splitStreetUnit('745 Fifth Avenue, 28th Floor').unitNumber === '28' && share.splitStreetUnit('100 Main St #5B').unitType === 'Unit'
    && share.splitStreetUnit('PO Box 1234').unitType === 'PO Box' && share.splitStreetUnit('100 Unit Road').street === '100 Unit Road');
  ok('websiteTypeFor recognises social hosts only', share.websiteTypeFor('https://www.linkedin.com/in/x') === 'linkedin' && share.websiteTypeFor('twitter.com/x') === 'x' && share.websiteTypeFor('mylinkedin.com') === '' && share.websiteTypeFor('northwind.com') === '');
  ok('region lists: 56 US entries (50 states, DC, 5 territories), 13 Canadian, 32 Mexican, 8 Australian; labels per country',
    share.REGIONS['United States'].regions.length === 56 && share.REGIONS['Canada'].regions.length === 13 && share.REGIONS['Mexico'].regions.length === 32 && share.REGIONS['Australia'].regions.length === 8
    && share.regionLabels('Canada').postalLabel === 'Postal code' && share.regionLabels('United Kingdom').label === 'County (optional)' && share.regionLabels('Germany').label === 'Region');
  ok('every region-list country is in the country list', Object.keys(share.REGIONS).every(c => share.COUNTRIES.includes(c)) && new Set(share.COUNTRIES).size === share.COUNTRIES.length);
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

// Temporary vault: memory only, nothing written to storage
{
  const { TemporaryVault, deleteLegacyVault, LEGACY_VAULT_KEY } = await import(`${R}/modules/mod02-vault/vault.js`);
  const before = JSON.stringify(localStorage);
  const v = new TemporaryVault();
  ok('temporary vault starts empty', !v.isHolding() && (await v.release()) === null);
  ok('hold encrypts and keeps the card in memory', await v.hold({ contact: { name: 'Jane' } }) && v.isHolding() && v.key.extractable === false);
  ok('held card is ciphertext, not the plain card', !new TextDecoder().decode(v.sealed.ciphertext).includes('Jane'));
  ok('nothing is written to browser storage', JSON.stringify(localStorage) === before);
  const sealed = v.sealed;
  ok('release returns the card and empties the vault', (await v.release()).contact.name === 'Jane' && !v.isHolding() && v.key === null);
  ok('released ciphertext is zero-filled', new Uint8Array(sealed.ciphertext).every(b => b === 0));
  await v.hold({ contact: { name: 'Again' } });
  const first = v.key;
  await v.hold({ contact: { name: 'Third' } });
  ok('every hold uses a new key', v.key !== first && (await v.release()).contact.name === 'Third');
  await v.hold({ a: 1 });
  ok('wipe drops the key and the ciphertext', v.wipe().status === 'WIPED' && !v.isHolding() && v.key === null && (await v.release()) === null);
  const late = v.hold({ contact: { name: 'Late' } });
  v.wipe();
  ok('a hold that finishes after a wipe is discarded', (await late) === false && !v.isHolding());

  // Vaults saved by older builds are deleted at startup
  ok('no old vault: nothing reported', deleteLegacyVault() === null);
  localStorage.setItem(LEGACY_VAULT_KEY, JSON.stringify({ v: 2, kdf: 'pbkdf2-sha256', ciphertext: [1, 2] }));
  ok('old browser vault deleted (not keychain-bound)', JSON.stringify(deleteLegacyVault()) === '{"keychainBound":false}' && localStorage.getItem(LEGACY_VAULT_KEY) === null);
  localStorage.setItem(LEGACY_VAULT_KEY, JSON.stringify({ v: 2, kdf: 'pbkdf2-sha256+hkdf-device-key' }));
  ok('old desktop vault deleted and reported as keychain-bound', deleteLegacyVault().keychainBound === true && localStorage.getItem(LEGACY_VAULT_KEY) === null);
  localStorage.setItem(LEGACY_VAULT_KEY, 'not json');
  ok('unreadable old vault deleted all the same', deleteLegacyVault().keychainBound === false && localStorage.getItem(LEGACY_VAULT_KEY) === null);
}

// Session PIN (quick unlock after an idle lock)
{
  const { SessionPin, MAX_PIN_ATTEMPTS, PIN_LENGTH, RESET_SECONDS, isValidPin } = await import(`${R}/modules/mod02-vault/sessionPin.js`);
  ok('reset after 7 minutes without activity, PIN is 4 digits', RESET_SECONDS === 420 && PIN_LENGTH === 4);
  {
    const { wipeSecondsFrom } = await import(`${R}/modules/mod02-vault/sessionPin.js`);
    const got = ['7', '10', '15', undefined, '', '0', '20', '99', 'abc', '10.5', '-7'].map(v => wipeSecondsFrom(v)).join();
    ok('wipe time from html[data-wipe]: 7, 10 or 15 minutes; anything else is 7 (never longer than 15)', got === '420,600,900,420,420,420,420,420,420,420,420', got);
  }
  ok('only exactly 4 digits make a PIN', isValidPin('0420') && !isValidPin('123') && !isValidPin('12345') && !isValidPin('12a4') && !isValidPin(' 1234') && !isValidPin(1234));
  const pin = new SessionPin();
  ok('session PIN starts unset', !pin.isSet() && (await pin.verify('1234')).result === 'not_set');
  let short = false; try { await pin.set('12'); } catch (e) { short = e.message === 'PIN_INVALID'; }
  let letters = false; try { await pin.set('abcd'); } catch (e) { letters = e.message === 'PIN_INVALID'; }
  ok('too-short or non-digit PIN refused', short && letters && !pin.isSet());
  await pin.set('2468');
  ok('session PIN stored as a hash, not the PIN', pin.isSet() && !JSON.stringify(Array.from(pin.record.hash)).includes('2468') && pin.record.hash.length === 32);
  ok('right PIN accepted', (await pin.verify('2468')).result === 'ok');
  const w1 = await pin.verify('0000');
  ok('wrong PIN rejected with tries left', w1.result === 'wrong' && w1.attemptsLeft === MAX_PIN_ATTEMPTS - 1);
  ok('right PIN resets the count', (await pin.verify('2468')).result === 'ok' && pin.attempts === 0);
  let last;
  for (let i = 0; i < MAX_PIN_ATTEMPTS; i++) last = await pin.verify('9999');
  ok(`${MAX_PIN_ATTEMPTS} wrong PINs lock out and forget the PIN`, last.result === 'locked_out' && !pin.isSet() && (await pin.verify('2468')).result === 'not_set');
  await pin.set('1357'); pin.clear();
  ok('clear forgets the PIN', !pin.isSet());
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

// Biometric unlock: the WebAuthn assertion check (signature, challenge, origin, site, user verified)
{
  const { verifyAssertion, derToRaw, base64url } = await import(`${R}/modules/mod02-vault/biometric.js`);
  const subtle = globalThis.crypto.subtle;
  const keys = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const rawToDer = (raw) => {
    const int = (b) => { let i = 0; while (i < b.length - 1 && b[i] === 0) i++; b = b.slice(i); if (b[0] & 0x80) b = Uint8Array.of(0, ...b); return Uint8Array.of(0x02, b.length, ...b); };
    const r = int(raw.slice(0, 32)), s = int(raw.slice(32));
    return Uint8Array.of(0x30, r.length + s.length, ...r, ...s);
  };
  const origin = 'https://vcge.app', rpId = 'vcge.app';
  const challenge = globalThis.crypto.getRandomValues(new Uint8Array(32));
  // What a phone's authenticator returns after checking the user's face or fingerprint
  const assertion = async ({ flags = 0x05, site = rpId, ch = challenge, from = origin, type = 'webauthn.get' } = {}) => {
    const authenticatorData = new Uint8Array(37);
    authenticatorData.set(new Uint8Array(await subtle.digest('SHA-256', new TextEncoder().encode(site))), 0);
    authenticatorData[32] = flags;
    const clientDataJSON = new TextEncoder().encode(JSON.stringify({ type, challenge: base64url(ch), origin: from }));
    const signed = new Uint8Array([...authenticatorData, ...new Uint8Array(await subtle.digest('SHA-256', clientDataJSON))]);
    const raw = new Uint8Array(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, signed));
    return { publicKey: keys.publicKey, algorithm: -7, challenge, origin, rpId, authenticatorData, clientDataJSON, signature: rawToDer(raw) };
  };
  const raw = globalThis.crypto.getRandomValues(new Uint8Array(64)); raw[0] = 0x80; raw[32] = 0;
  ok('DER signature converts back to raw r || s', derToRaw(rawToDer(raw)).every((b, i) => b === raw[i]));
  ok('a genuine biometric assertion is accepted', await verifyAssertion(await assertion()));
  ok('user not verified (no face or fingerprint check) is refused', !(await verifyAssertion(await assertion({ flags: 0x01 }))));
  ok('an old challenge (replay) is refused', !(await verifyAssertion({ ...(await assertion({ ch: new Uint8Array(32) })), challenge })));
  ok('another site or origin is refused', !(await verifyAssertion(await assertion({ site: 'evil.example' }))) && !(await verifyAssertion({ ...(await assertion()), origin: 'https://evil.example' })));
  ok('a registration response is not accepted as an unlock', !(await verifyAssertion(await assertion({ type: 'webauthn.create' }))));
  const other = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  ok('a signature from another credential is refused', !(await verifyAssertion({ ...(await assertion()), publicKey: other.publicKey })));
  const tampered = await assertion(); tampered.signature = tampered.signature.slice(); tampered.signature[10] ^= 1;
  ok('a tampered signature is refused', !(await verifyAssertion(tampered)));
}

// Vault store: the hub every module goes through (memory only, per-module rights, no data in notices)
{
  const { VaultStore, SLOTS, MODULE_RIGHTS, READINGS } = await import(`${R}/modules/mod02-vault/vaultStore.js`);
  const before = JSON.stringify(localStorage);
  let gesture = false;
  const s = new VaultStore({ isUserGesture: () => gesture });
  ok('vault store has the pipeline slots and starts empty', SLOTS.join() === 'photo,ocr,review,contact,lastScan,undo,logo,reading1,reading2,reading3' && s.isEmpty() && s.state() === 'open');
  const notices = []; s.onChange('contact', n => notices.push(n));
  const contact = { firstName: 'Jane', phones: [{ type: 'work', value: '555' }] };
  s.put('contact', contact);
  contact.firstName = 'Changed';
  const got = s.get('contact'); got.phones[0].value = 'x';
  ok('values are copied in and out (no shared references)', s.get('contact').firstName === 'Jane' && s.get('contact').phones[0].value === '555');
  ok('change notices name the slot and carry no data', notices.length === 1 && JSON.stringify(notices[0]) === '{"slot":"contact"}');
  let unknown = false; try { s.get('passwords'); } catch (e) { unknown = e.message.startsWith('VAULT_UNKNOWN_SLOT'); }
  ok('unknown slots are refused', unknown);

  // Handles: each module reaches only its own slots
  const denied = (fn) => { try { fn(); return false; } catch (e) { return e.message.startsWith('VAULT_DENIED'); } };
  const cam = s.handle('mod03'), ocrH = s.handle('mod04'), qr = s.handle('mod07'), egress = s.handle('mod08');
  cam.put('photo', 'data:image/png;base64,AAA');
  ok('camera writes the photo; OCR reads it', ocrH.get('photo') === 'data:image/png;base64,AAA');
  ok('camera cannot read the photo back or touch the contact', denied(() => cam.get('photo')) && denied(() => cam.put('contact', {})));
  ok('OCR cannot read the contact', denied(() => ocrH.get('contact')));
  ok('QR reads the contact but cannot write it', qr.get('contact').firstName === 'Jane' && denied(() => qr.put('contact', {})));
  ok('egress has no standing read of the contact', denied(() => egress.get('contact')));
  ok('egress reads the contact only during a user gesture', egress.readForShare('contact') === null && ((gesture = true), egress.readForShare('contact').firstName === 'Jane'));
  gesture = false;
  ok('egress cannot share the photo', denied(() => egress.readForShare('photo')));
  // Logo slot (redesign step 3): Export writes the QR centre logo the person wants on the card; the card view reads it.
  const cardH = s.handle('mod06');
  egress.put('logo', '<svg/>');
  ok('egress writes the logo slot; the card view reads it', cardH.get('logo') === '<svg/>' && denied(() => egress.get('logo')) && denied(() => cardH.put('logo', 'x')));
  ok('no other module reaches the logo', denied(() => cam.get('logo')) && denied(() => ocrH.get('logo')) && denied(() => qr.get('logo')));
  // Photo readings (up to three photos of one card): only OCR deposits and retrieves them
  const reading = (n) => ({ lines: [{ text: `Line ${n}`, role: 'name', confidence: 80 + n, unreadable: false }], at: n });
  ok('there are exactly three reading spots', READINGS.join() === 'reading1,reading2,reading3' && !SLOTS.includes('reading4'));
  ok('OCR deposits and retrieves each reading in its own spot', ocrH.put('reading1', reading(1)) && ocrH.put('reading2', reading(2)) && ocrH.put('reading3', reading(3))
    && ocrH.get('reading1').lines[0].text === 'Line 1' && ocrH.get('reading2').lines[0].text === 'Line 2' && ocrH.get('reading3').at === 3);
  ok('no other module can read or write the readings', ['mod03', 'mod05', 'mod06', 'mod07', 'mod08'].every(m => READINGS.every(r => denied(() => s.handle(m).get(r)) && denied(() => s.handle(m).put(r, {})) && denied(() => s.handle(m).clearReadings()))));
  ok('a fourth reading has nowhere to go', (() => { try { ocrH.put('reading4', reading(4)); return false; } catch (e) { return e.message.startsWith('VAULT_DENIED'); } })());
  ocrH.clearReadings();
  ok('clearing the readings empties all three and nothing else', READINGS.every(r => ocrH.get(r) === null) && ocrH.get('photo').endsWith('AAA'));
  let unknownModule = false; try { s.handle('mod99'); } catch (e) { unknownModule = e.message.startsWith('VAULT_UNKNOWN_MODULE'); }
  ok('unknown modules get no handle', unknownModule);
  ok('every module right names a real slot', Object.values(MODULE_RIGHTS).every(r => [...r.read, ...r.write, ...(r.share || [])].every(x => SLOTS.includes(x))));

  // Lock behind the session PIN, unlock, wipe
  ok('lock without a PIN is refused and keeps the card', s.lock() === false && s.get('contact').firstName === 'Jane');
  await s.setPin('2468');
  const states = []; s.onStateChange(e => states.push(e.state));
  ocrH.put('reading1', reading(1)); ocrH.put('reading2', reading(2));
  ok('a held reading counts as something to lose', !s.isEmpty());
  ok('lock seals every slot and empties them', s.lock() === true && s.state() === 'locked' && s.get('contact') === null && s.get('photo') === null && !s.isEmpty());
  ok('nothing goes in while locked', s.put('contact', { firstName: 'X' }) === false);
  ok('a reading is refused while locked (OCR deposits it again after the PIN)', ocrH.put('reading3', reading(3)) === false && ocrH.get('reading1') === null);
  await s.locking;
  ok('the held copy is ciphertext', s.vault.isHolding() && !new TextDecoder().decode(s.vault.sealed.ciphertext).includes('Jane'));
  const wrong = await s.unlock('0000');
  ok('wrong PIN keeps it locked', wrong.result === 'wrong' && s.state() === 'locked');
  const right = await s.unlock('2468');
  ok('right PIN puts every slot back', right.result === 'ok' && s.state() === 'open' && s.get('contact').firstName === 'Jane' && ocrH.get('photo').endsWith('AAA') && !s.vault.isHolding());
  ok('the PIN puts the readings back unchanged, and the next photo is the filled spots plus one', JSON.stringify(ocrH.get('reading1')) === JSON.stringify(reading(1))
    && ocrH.get('reading2').lines[0].confidence === 82 && ocrH.get('reading3') === null && READINGS.filter(r => ocrH.get(r) !== null).length + 1 === 3);
  s.lock(); await s.locking;
  for (let i = 0; i < 5; i++) await s.unlock('9999');
  ok('5 wrong PINs wipe the card and the PIN', s.state() === 'open' && READINGS.every(r => s.get(r) === null) && s.isEmpty() && !s.hasPin() && !s.vault.isHolding());
  await s.setPin('2468'); s.put('contact', { firstName: 'Lost' });
  s.vault.hold = async () => false;   // the seal fails
  s.lock();
  const lost = await s.unlock('2468');
  ok('a failed seal is reported as lost, not as unlocked', lost.result === 'lost' && s.isEmpty());
  delete s.vault.hold;
  // Biometric unlock (the device check is faked here; the real check is tested above and in the browser suite)
  let deviceSays = false;
  s.biometric = { enrolled: true, isEnrolled() { return this.enrolled; }, verify: async () => deviceSays, clear() { this.enrolled = false; } };
  await s.setPin('2468'); s.put('contact', { firstName: 'Bio' }); s.lock(); await s.locking;
  ok('biometric not confirmed keeps it locked', (await s.unlockBiometric()).result === 'not_confirmed' && s.state() === 'locked');
  deviceSays = true;
  ok('confirmed biometric puts the card back', (await s.unlockBiometric()).result === 'ok' && s.get('contact').firstName === 'Bio');
  s.clearPin();
  ok('removing the PIN removes biometric too', !s.biometric.isEnrolled());
  s.put('review', { lines: [] }); READINGS.forEach((r, i) => ocrH.put(r, reading(i + 1))); s.wipe('test');
  ok('wipe empties every slot, the readings too, and forgets the PIN', READINGS.every(r => s.get(r) === null) && s.isEmpty() && !s.hasPin() && states.at(-1) === 'wiped');
  ok('the store writes nothing to browser storage', JSON.stringify(localStorage) === before);
}

// Wipe policy: idle lock or wipe, screen off locks (PIN) or wipes after 30 s (no PIN), 7-minute reset, leaving the page
{
  const { VaultStore } = await import(`${R}/modules/mod02-vault/vaultStore.js`);
  const { WipePolicy } = await import(`${R}/modules/mod02-vault/wipePolicy.js`);
  const makeEnv = () => {
    const env = { t: 1_000_000, hidden: false, handlers: {}, intervals: 0,
      now: () => env.t, isHidden: () => env.hidden,
      on: (target, type, fn) => { env.handlers[type] = fn; }, off: (target, type) => { delete env.handlers[type]; },
      setInterval: () => ++env.intervals, clearInterval: () => {} };
    return env;
  };
  const setup = async (withPin) => {
    const env = makeEnv(), store = new VaultStore();
    if (withPin) await store.setPin('2468');
    const policy = new WipePolicy(store, { env });
    policy.start();
    store.put('contact', { firstName: 'Jane' });
    const reasons = []; store.onStateChange(e => reasons.push(`${e.state}:${e.reason}`));
    return { env, store, policy, reasons };
  };
  const hide = (env) => { env.hidden = true; env.handlers.visibilitychange(); };
  const show = (env) => { env.hidden = false; env.handlers.visibilitychange(); };

  let { env, store, policy, reasons } = await setup(false);
  ok('wipe policy listens for pagehide and visibility, ticks every second', env.handlers.pagehide && env.handlers.visibilitychange && env.intervals === 1);
  env.t += 119_000; policy.tick();
  ok('idle under 2 minutes keeps the card', store.get('contact').firstName === 'Jane' && policy.remaining().idle === 1);
  policy.activity(); env.t += 119_000; policy.tick();
  ok('activity restarts the idle clock', store.get('contact') !== null);
  env.t += 2_000; policy.tick();
  ok('no PIN: 2 minutes idle wipes', store.isEmpty() && reasons.at(-1) === 'wiped:idle');
  env.t += 600_000; reasons.length = 0; policy.tick();
  ok('an empty store is not wiped again until there is activity', reasons.length === 0);

  ({ env, store, policy, reasons } = await setup(false));
  hide(env); env.t += 29_000; show(env);
  ok('no PIN: back in view within 30 s keeps the card', store.get('contact').firstName === 'Jane');
  hide(env); env.t += 31_000; show(env);
  ok('no PIN: 30 s out of view wipes, checked as the page comes back (frozen timers)', store.isEmpty() && reasons.at(-1) === 'wiped:out of view for 30 s');

  ({ env, store, policy, reasons } = await setup(true));
  env.t += 121_000; policy.tick();
  ok('PIN: 2 minutes idle locks instead of wiping', store.state() === 'locked' && policy.remaining().reset === 299);
  env.t += 299_000; policy.tick();
  ok('PIN: 7 minutes after the last activity the locked card is wiped', store.state() === 'open' && store.isEmpty() && reasons.at(-1) === 'wiped:7 minutes without activity');

  ({ env, store, policy, reasons } = await setup(true));
  env.t += 10_000; hide(env);
  ok('PIN: the screen turning off locks at once (nothing on screen when it wakes)', store.state() === 'locked' && reasons.at(-1) === 'locked:lock');
  env.t += 200_000; show(env);
  ok('PIN: the card survives a screen timeout (still locked, not wiped, after 3+ minutes)', store.state() === 'locked' && !store.isEmpty());
  await store.locking; await store.unlock('2468');
  ok('PIN: unlock brings the card back and restarts both clocks', store.get('contact').firstName === 'Jane' && policy.remaining().idle === 120 && policy.remaining().reset === 420);
  hide(env); env.t += 421_000; show(env);
  ok('PIN: 7 minutes out of view (frozen timers) wipes as the page comes back', store.isEmpty() && store.state() === 'open' && reasons.at(-1) === 'wiped:7 minutes without activity');

  ({ env, store, policy, reasons } = await setup(true));
  policy.expectExternalApp(); env.t += 1_000; hide(env);
  ok('the photo picker or share sheet does not lock', store.state() === 'open');
  env.t += 60_000; show(env);
  ok('back from the picker after 60 s: card kept', store.get('contact').firstName === 'Jane');
  env.t += 6_000; hide(env);
  ok('the picker grace ends after 5 s', store.state() === 'locked');

  ({ env, store, policy, reasons } = await setup(true));
  env.handlers.pagehide();
  ok('leaving the page wipes, PIN or not', store.isEmpty() && !store.hasPin() && reasons.at(-1) === 'wiped:left the page');

  policy.stop();
  ok('stop removes the page listeners', !env.handlers.pagehide && !env.handlers.visibilitychange);
}

// Form mapper (single OCR text -> contact mapper)
{
  const { ContactFormMapper } = await import(`${R}/modules/mod05-form/formMapper.js`);
  const fm = new ContactFormMapper();
  // Value of the first list entry of a type, e.g. typed(d, 'phones', 'work').
  const typed = (d, list, type) => ((d[list] || []).find(e => e.type === type) || {}).value;
  ok('formatPhone US 10-digit', fm.formatPhone('4155550199') === '+1 (415) 555-0199');
  ok('formatPhone UK', fm.formatPhone('442071234567', 'UK') === '+44 20 7123 4567', fm.formatPhone('442071234567', 'UK'));
  const d = fm.parseOCRText('Alex Morgan\nVP of Product Design\nApex Innovations\n+1 (415) 555-0199\n(415) 555-0100\nalex.m@apexinnovations.io\nhttps://apexinnovations.io\n500 Howard Street\nSan Francisco, CA 94105');
  ok('mapper uses canonical names', d.jobTitle === 'VP of Product Design' && d.organization === 'Apex Innovations' && d.firstName === 'Alex' && !('org' in d) && !('title' in d), JSON.stringify(d));
  ok('mapper fills work then mobile phone', /555-0199/.test(typed(d, 'phones', 'work')) && /555-0100/.test(typed(d, 'phones', 'mobile')), JSON.stringify(d.phones));
  ok('mapper parses street and City, ST ZIP', d.street === '500 Howard Street' && d.city === 'San Francisco' && d.state === 'CA' && d.zip === '94105', JSON.stringify(d));
  const keys = Object.keys(d);
  const noisy = fm.parseOCRText('Maria Gonzalez\n+1(312)555-0147\n312.555.0100');
  ok('mapper normalises OCR-noisy US phone numbers', typed(noisy, 'phones', 'work') === '+1 (312) 555-0147' && typed(noisy, 'phones', 'mobile') === '+1 (312) 555-0100', JSON.stringify(noisy.phones));
  ok('mapper output keys are all contact fields or typed lists', keys.every(k => share.CONTACT_FIELDS.includes(k) || share.CONTACT_LIST_FIELDS.includes(k)), keys.join());

  // Context clues. Fictional names and numbers; layout and OCR mistakes copied from real phone-photo scans.
  const eq = (got, want) => Object.entries(want).every(([k, v]) => got[k] === v);
  const labelled = fm.parseOCRText('ya O/\n\nYour Technology Partner\nDana Whitlock\nOwner & General Manager\n4120 Lakeshore Road, Suite 21%\nSpringfield, M\\ 49011\nE dwhitlock@BrightPathlT com\nT 616.555.0142\nM 616.555.0187\n\nw BrightPathlT.com/Holland\\');
  ok('labelled card (E/T/M/W): every field mapped despite OCR slips', eq(labelled, {
    firstName: 'Dana', lastName: 'Whitlock', jobTitle: 'Owner & General Manager',
    street: '4120 Lakeshore Road', unitType: 'Suite', unitNumber: '21%', city: 'Springfield', state: 'MI', zip: '49011' })
    && typed(labelled, 'emails', 'work') === 'dwhitlock@BrightPathlT.com' && typed(labelled, 'websites', 'work') === 'BrightPathlT.com/Holland'
    && typed(labelled, 'phones', 'work') === '+1 (616) 555-0142' && typed(labelled, 'phones', 'mobile') === '+1 (616) 555-0187', JSON.stringify(labelled));
  ok('logo debris and tagline are not the company; domain is used instead', labelled.organization === 'BrightPathlT', labelled.organization);

  const office = fm.parseOCRText('Harbor Point Realty\nSam Ortiz\nLicensed Realtor\nTel: (555) 201-3344  Fax: (555) 201-3345\nCell 555.201.9988\nsortiz © harborpointrealty . com\nharborpointrealty.com\n100 Main St\nSuite 300\nAustin Texas 78701');
  ok('name chosen by email match, not first line', office.firstName === 'Sam' && office.lastName === 'Ortiz', JSON.stringify(office));
  ok('company matched to web domain; title from vocabulary', office.organization === 'Harbor Point Realty' && office.jobTitle === 'Licensed Realtor', JSON.stringify(office));
  ok('Tel/Fax on one line: fax kept as Work fax; Cell is mobile', typed(office, 'phones', 'work') === '+1 (555) 201-3344' && typed(office, 'phones', 'workFax') === '+1 (555) 201-3345' && typed(office, 'phones', 'mobile') === '+1 (555) 201-9988', JSON.stringify(office.phones));
  ok('email repaired from "©" and spaces; website without www', typed(office, 'emails', 'work') === 'sortiz@harborpointrealty.com' && typed(office, 'websites', 'work') === 'harborpointrealty.com', JSON.stringify([office.emails, office.websites]));
  ok('two-line street with Suite, full state name without comma', office.street === '100 Main St' && office.unitType === 'Suite' && office.unitNumber === '300' && office.city === 'Austin' && office.state === 'TX' && office.zip === '78701', JSON.stringify(office));

  const oneLine = fm.parseOCRText('Jane Q. Roe\nAttorney at Law\nRoe & Partners LLC\n88 Elm Avenue, Burlington, VT 05401\njaneroe@gmail.com\n(802) 555-0110');
  ok('whole address on one line', oneLine.street === '88 Elm Avenue' && oneLine.city === 'Burlington' && oneLine.state === 'VT' && oneLine.zip === '05401', JSON.stringify(oneLine));
  ok('company by suffix (LLC); personal mail domain not used as company', oneLine.organization === 'Roe & Partners LLC' && oneLine.jobTitle === 'Attorney at Law', JSON.stringify(oneLine));
  ok('three-word name: first, middle, last', oneLine.firstName === 'Jane' && oneLine.middleName === 'Q.' && oneLine.lastName === 'Roe', JSON.stringify(oneLine));
  ok('personal mail provider email typed Personal', typed(oneLine, 'emails', 'personal') === 'janeroe@gmail.com', JSON.stringify(oneLine.emails));

  const noStreetWord = fm.parseOCRText('20\nAlex Kim\n2 rearmiogere\nakim@kimdesign.co');
  ok('a stray number is not taken as a street', noStreetWord.street === '' && noStreetWord.organization === 'kimdesign', JSON.stringify(noStreetWord));
  ok('IL keeps its L; OCR "Ml" repaired to MI', fm.parseOCRText('Chicago, IL 60606').state === 'IL' && fm.parseOCRText('Lansing Ml 48933').state === 'MI');
  const box = fm.parseOCRText('PO Box 1234\nBoise, ID 83701');
  ok('PO Box goes to the unit fields', box.unitType === 'PO Box' && box.unitNumber === '1234' && box.street === '', JSON.stringify(box));

  const intl = fm.parseOCRText('Dr. Jane Q. Roe, PhD\nChief Scientist\nRoe Labs Inc.\n100 Queen Street West\nSuite 300\nToronto, ON M5H 2N2\nTel: (416) 555-0101  Fax: (416) 555-0102\nHome 416-555-0199\njane@roelabs.ca\njane.roe@gmail.com\nlinkedin.com/in/janeroe\nroelabs.ca');
  ok('prefix, middle name and suffix recognised', eq(intl, { namePrefix: 'Dr.', firstName: 'Jane', middleName: 'Q.', lastName: 'Roe', nameSuffix: 'PhD', jobTitle: 'Chief Scientist' }), JSON.stringify(intl));
  ok('Canadian address: province, postal code, country', eq(intl, { street: '100 Queen Street West', unitType: 'Suite', unitNumber: '300', city: 'Toronto', state: 'ON', zip: 'M5H 2N2', country: 'Canada' }), JSON.stringify(intl));
  ok('Home label gives a Home phone', typed(intl, 'phones', 'home') === '+1 (416) 555-0199' && intl.phones.length === 3, JSON.stringify(intl.phones));
  ok('every email kept, typed Work / Personal', typed(intl, 'emails', 'work') === 'jane@roelabs.ca' && typed(intl, 'emails', 'personal') === 'jane.roe@gmail.com');
  ok('social profile typed and not used as the company', typed(intl, 'websites', 'linkedin') === 'linkedin.com/in/janeroe' && typed(intl, 'websites', 'work') === 'roelabs.ca' && intl.organization === 'Roe Labs Inc.', JSON.stringify(intl.websites));
}

// OCR review steps: classifyLines (roles) + buildFields (fields from roles)
{
  const { ContactFormMapper, LINE_ROLES } = await import(`${R}/modules/mod05-form/formMapper.js`);
  const fm = new ContactFormMapper();
  const text = 'ya O/\nYour Technology Partner\nDana Whitlock\nOwner & General Manager\n4120 Lakeshore Road, Suite 210\nSpringfield, MI 49011\nE dwhitlock@BrightPathIT.com\nT 616.555.0142\nM 616.555.0187\nW BrightPathIT.com/Holland';
  const lines = fm.classifyLines(text);
  ok('classifyLines gives one role per line', lines.length === 10 && lines.every(l => LINE_ROLES.some(([r]) => r === l.role)), JSON.stringify(lines));
  ok('classifyLines roles for a labelled card', JSON.stringify(lines.map(l => l.role)) === JSON.stringify(['ignore', 'notes', 'name', 'jobTitle', 'street', 'cityStateZip', 'email', 'phoneWork', 'phoneMobile', 'website']), lines.map(l => l.role).join());
  // A real phone photo's misreads (fictional details): "I" read as "\" in the domain, the "/" of the web path read as a
  // space, lowercase "w" label, slogan with a company word ("Technology") and no readable company name (logo only).
  const slips = fm.classifyLines('2OO brightpathlogo\nYour Technology Partner\nDana Whitlock\nOwner & General Manager\n4120 Lakeshore Road, Suite 210\nSpringfield, MI 49011\nE dwhitlock@BrightPath\\T.com\nT 616.555.0142\nM 616.555.0187\nw BrightPath\\T.com Holland');
  ok('misread card: roles (slogan to Notes, email and website found, phone types in the picker)', JSON.stringify(slips.map(l => l.role)) === JSON.stringify(['ignore', 'notes', 'name', 'jobTitle', 'street', 'cityStateZip', 'email', 'phoneWork', 'phoneMobile', 'website']), slips.map(l => l.role).join());
  ok('misread card: review shows the repaired email and web address, without labels', slips[6].text === 'dwhitlock@BrightPathIT.com' && slips[9].text === 'BrightPathIT.com/Holland', slips[6].text + ' | ' + slips[9].text);
  ok('misread card: review shows phone numbers without their T / M labels', slips[7].text === '616.555.0142' && slips[8].text === '616.555.0187', slips[7].text + ' | ' + slips[8].text);
  ok('review keeps the labels of a line with several numbers', fm.classifyLines('T 312.555.1111  M 312.555.2222')[0].text === 'T 312.555.1111 M 312.555.2222');
  // The tester's card: the email domain misread by one letter, the web address read correctly.
  const zafer = fm.classifyLines('Nick Zafer\nOwner & General Manager\nE nzafer@TeamlLogiciT.com\nT 269.492.7400\nw TeamLogicIT.com/KalamazooMI');
  ok('email domain one OCR slip from the web address takes its spelling (review and fields)', zafer[2].text === 'nzafer@TeamLogicIT.com' && fm.buildFields(zafer).fields.emails[0].value === 'nzafer@TeamLogicIT.com', zafer[2].text);
  ok('a different email domain is left alone', fm.parseOCRText('Jo Smith\njo@acme.co\nacme.com').emails[0].value === 'jo@acme.co' && fm.parseOCRText('Jo Smith\njo@brightpath.com\nnorthwind.com').emails[0].value === 'jo@brightpath.com' && fm.parseOCRText('Jo Smith\njo@gmail.com\ngmail.co').emails[0].value === 'jo@gmail.com');
  // The same card as the OCR reads its photo: capital I and lowercase l are the same bar in its font, so the OCR's
  // second guesses (MOD04 alts) and the card's state settle them.
  const scanned = [
    { text: 'Portage, Ml 49024', alts: [{ at: 10, chars: ['l', '|', 'I', '\\', 'i'] }] },
    { text: 'Nick Zafer', alts: [] },
    { text: 'E nzafer@TeamlLogic\\T.com', alts: [{ at: 13, chars: ['l', 'L'] }, { at: 14, chars: ['L', 'l'] }] },
    { text: 'w TeamLogiciT.com/Kalamazoom\\', alts: [{ at: 11, chars: ['i', 'I', '!', '|'] }, { at: 27, chars: ['m', 'M'] }, { at: 28, chars: ['\\', 'y', 'l'] }] }
  ];
  const scannedFields = fm.buildFields(fm.classifyLines(scanned)).fields;
  ok('second guesses: TeamLogiciT read with "I" as runner-up becomes TeamLogicIT (company, email, web)', scannedFields.organization === 'TeamLogicIT' && scannedFields.emails[0].value === 'nzafer@TeamLogicIT.com' && scannedFields.websites[0].value === 'TeamLogicIT.com/KalamazooMI', JSON.stringify([scannedFields.organization, scannedFields.emails, scannedFields.websites]));
  const noGuesses = fm.buildFields(fm.classifyLines(scanned.map(l => ({ text: l.text })))).fields;
  ok('without second guesses the OCR pick stands (TeamLogiciT)', noGuesses.organization === 'TeamLogiciT', noGuesses.organization);
  ok('second guesses change only web and email addresses', fm.classifyLines([{ text: 'Owner of iTunes Store', alts: [{ at: 9, chars: ['i', 'I'] }] }])[0].text === 'Owner of iTunes Store');
  ok('a second guess without "I" changes nothing', fm.classifyLines([{ text: 'w shopiT.com', alts: [{ at: 6, chars: ['i', 'l'] }] }])[0].text === 'shopiT.com');
  const pathState = (site, place) => fm.buildFields(fm.classifyLines(`Jo Smith\nw ${site}\n${place}`)).fields.websites[0].value;
  ok('a web path ends in the card\'s state code only when its I was read as a bar', pathState('acme.com/Detroitm\\', 'Detroit, MI 48201') === 'acme.com/DetroitMI' && pathState('acme.com/Detroitm\\', 'Austin, TX 73301') === 'acme.com/Detroitm' && pathState('acme.com/email', 'Chicago, IL 60601') === 'acme.com/email', [pathState('acme.com/Detroitm\\', 'Detroit, MI 48201'), pathState('acme.com/Detroitm\\', 'Austin, TX 73301')].join(' | '));
  // Camera reads of the TeamLogic card (2026-10-16): slash read as a bar, email capitals, title vowels, ZIP vs state
  const camera = fm.classifyLines([{ text: 'Nick Zafer' }, { text: 'Owner & Ganaral Manager' }, { text: '7950 Moorsbridge Road, Suite 405' },
    { text: 'Portage, Mi 42024' }, { text: 'E nzafer@TeamlogicIT.com' }, { text: 'W TeamLogicIT.comIKalamazohhy', unsure: ['TeamLogicIT.comIKalamazohhy'] }]);
  const cameraText = (role) => (camera.find(l => l.role === role) || {}).text;
  ok('a "/" read as a bar after the web ending is a "/" again', cameraText('website') === 'TeamLogicIT.com/Kalamazohhy' && fm.classifyLines('w acme.comlDetroit')[0].text === 'acme.com/Detroit' && fm.classifyLines('w acme.com/Detroit')[0].text === 'acme.com/Detroit', cameraText('website'));
  ok('a bar before a lowercase word is left alone', fm.classifyLines('w acme.comIdetroit')[0].text !== 'acme.com/detroit');
  ok('email domain that differs only in capitals takes the web address spelling', cameraText('email') === 'nzafer@TeamLogicIT.com' && fm.parseOCRText('Jo Smith\njo@Acme.com\nacme.com').emails[0].value === 'jo@Acme.com' && fm.buildFields([{ text: 'jo@acmetools.com', role: 'email' }, { text: 'AcmeTools.com', role: 'website' }]).fields.emails[0].value === 'jo@acmetools.com', cameraText('email'));
  const titleOf = (t) => fm.classifyLines(`Jo Smith\n${t}`)[1].text;
  ok('job-title vowels read wrong are repaired (Ganaral -> General)', cameraText('jobTitle') === 'Owner & General Manager' && titleOf('SALES DIRACTOR') === 'SALES DIRECTOR', cameraText('jobTitle'));
  ok('a job-title word missing one letter is repaired (Manger -> Manager)', titleOf('Sales Manger') === 'Sales Manager', titleOf('Sales Manger'));
  ok('other title words are left alone (Waiter, Painter, Owners)', titleOf('Head Waiter & Painter Manager') === 'Head Waiter & Painter Manager' && titleOf('Owners Manager') === 'Owners Manager', titleOf('Head Waiter & Painter Manager'));
  ok('filled values are what the review box shows', JSON.stringify(fm.buildFields(camera).fields.websites) === JSON.stringify([{ type: 'work', value: 'TeamLogicIT.com/Kalamazohhy' }]) && fm.buildFields(camera).fields.jobTitle === 'Owner & General Manager');
  const zipCheck = (place) => fm.classifyLines(`Jo Smith\n12 Main Street\n${place}`).find(l => l.role === 'cityStateZip').check;
  ok('a ZIP code the state does not use is flagged for checking, not changed', camera.find(l => l.role === 'cityStateZip').check === '42024 is not a Michigan ZIP code. Please check it.' && fm.buildFields(camera).fields.zip === '42024', JSON.stringify(camera.find(l => l.role === 'cityStateZip')));
  ok('a ZIP code that fits its state is not flagged', zipCheck('Portage, MI 49024') === undefined && zipCheck('Boston, MA 02108') === undefined && zipCheck('Austin, TX 73301') === undefined, zipCheck('Boston, MA 02108'));
  ok('a line with words the reader was unsure of is flagged for checking', camera.find(l => l.role === 'website').check === 'The reader was not sure of some letters here. Please check them.');
  ok('unsure phone numbers and ignored lines are not flagged', fm.classifyLines([{ text: 'Jo Smith' }, { text: 'T 269.492.7400', unsure: ['269.492.7400'] }, { text: 'ya O/', unsure: ['ya'] }]).every(l => !('check' in l)));
  ok('a short domain is not matched (too easy to confuse)', fm.parseOCRText('Jo Smith\njo@abd.com\nabc.com').emails[0].value === 'jo@abd.com');
  // The TeamLogic card read from a phone screenshot on the iPad (video review 2026-10-17, finding 53 and 56): the slogan
  // was ignored, the street carried the T of the phone line, and the web path came apart from its domain.
  const shot = fm.classifyLines('N20 weersooen\nYour Technology Advisor\nNick Zafer\nOwner & General Manager\nT 7950 Moorsbridge Road, Suite 405\nPortage, MI 49024\nE nzafer@TeamLogicIT.com\nT 269.492.7400\nM 269.254.5403\nW TeamLogicIT.com KalamazooMl\\');
  const shotFields = fm.buildFields(shot).fields;
  ok('screenshot read: slogan goes to Notes, logo noise stays ignored', shot[0].role === 'ignore' && shot[1].role === 'notes' && shotFields.notes === 'Your Technology Advisor', JSON.stringify(shot.slice(0, 2)));
  ok('screenshot read: a stray label letter in front of the street is dropped', shot[4].role === 'street' && shot[4].text === '7950 Moorsbridge Road, Suite 405' && shotFields.street === '7950 Moorsbridge Road' && shotFields.unitNumber === '405', JSON.stringify(shot[4]));
  ok('a stray letter before a phone number is still that phone\'s label', fm.classifyLines('Jo Smith\nT 269.492.7400')[1].role === 'phoneWork');
  const site = (t, place = 'Portage, MI 49024') => fm.classifyLines(`Jo Smith\n${place}\n${t}`).find(l => l.role === 'website').text;
  ok('screenshot read: the web path split off its domain is joined back and ends in the state code', shot[9].text === 'TeamLogicIT.com/KalamazooMI' && site('W TeamLogicIT.com/ Kalamazoo') === 'TeamLogicIT.com/Kalamazoo' && site('W TeamLogicIT.com /Kalamazoo') === 'TeamLogicIT.com/Kalamazoo' && site('W TeamLogicIT.com KalamazooM\\ |') === 'TeamLogicIT.com/KalamazooMI', [shot[9].text, site('W TeamLogicIT.com KalamazooM\\ |')].join(' | '));
  ok('a lowercase l ends in the state code only after a capital or before a bar', site('W acme.com/KalamazooMl') === 'acme.com/KalamazooMI' && site('W acme.com/email') === 'acme.com/email' && site('W acme.com/Chicagoil', 'Chicago, IL 60601') === 'acme.com/Chicagoil', site('W acme.com/email'));
  const web = t => fm.parseOCRText(t).websites.map(w => w.value).join();
  ok('a web path read with a space inside keeps its end (bench run 2026-10-18)', web('Nick Zafer\nW TeamLogicIT.com/Kalamazoo MI\nPortage, MI 49024') === 'TeamLogicIT.com/KalamazooMI' && web('Jo\nW TeamLogicIT.com/Kalamazoo Ml\nPortage, MI 49024') === 'TeamLogicIT.com/KalamazooMI' && web('Jo Smith\nnorthwind.com/Seattle WA') === 'northwind.com/SeattleWA' && web('Jo Smith\nW northwind.com/Seattle WA') === 'northwind.com/SeattleWA', [web('Nick Zafer\nW TeamLogicIT.com/Kalamazoo MI\nPortage, MI 49024'), web('Jo Smith\nnorthwind.com/Seattle WA')].join(' | '));
  ok('words after an unlabelled web path that are not a state code stay out of it', web('Jo Smith\nacme.com/jobs Apply today') === 'acme.com/jobs' && web('Jo Smith\nacme.com/jobs Now') === 'acme.com/jobs', web('Jo Smith\nacme.com/jobs Apply today'));
  const doubled = fm.parseOCRText('Jo Smith\n12 Main Street\nPortage, M\\| 49024');
  ok('a state code whose I was read as two bars ("M\\|") is still MI', doubled.city === 'Portage' && doubled.state === 'MI' && doubled.zip === '49024' && fm.parseOCRText('Jo Smith\n12 Main Street\nChicago, IL 60606').state === 'IL', JSON.stringify([doubled.city, doubled.state, doubled.zip]));
  ok('two words after a domain are not joined as its path', site('W acme.com Detroit office') === 'acme.com', site('W acme.com Detroit office'));
  const tag = (t) => fm.classifyLines(`Jo Smith\n${t}\njo@acme.com`)[1].role;
  ok('a phrase in quotes goes to Notes; a lone word, a company or a title does not', tag('"Built to last"') === 'notes' && tag('Serving Kalamazoo since 1999') === 'notes' && tag('"Acme"') !== 'notes' && tag('Acme Tools LLC') === 'organization' && tag('Sales Manager') === 'jobTitle', [tag('"Built to last"'), tag('"Acme"'), tag('Acme Tools LLC')].join());
  ok('review text, read again as plain lines, fills the same fields', JSON.stringify(fm.buildFields(slips).fields) === JSON.stringify(fm.parseOCRText(slips.map(l => l.text).join('\n'))));
  const slipFields = fm.buildFields(slips);
  ok('misread card: email, website path and company (case from the domain) repaired', slipFields.fields.emails[0].value === 'dwhitlock@BrightPathIT.com' && slipFields.fields.websites[0].value === 'BrightPathIT.com/Holland' && slipFields.fields.organization === 'BrightPathIT' && slipFields.derived.organization === 'web address', JSON.stringify([slipFields.fields.emails, slipFields.fields.websites, slipFields.fields.organization]));
  const typedPhone = (type) => (slipFields.fields.phones.find(e => e.type === type) || {}).value;
  ok('misread card: T is Work, M is Mobile', typedPhone('work') === '+1 (616) 555-0142' && typedPhone('mobile') === '+1 (616) 555-0187');
  const unlabelledWeb = fm.classifyLines('Dana Whitlock\nbrightpathit.com Holland');
  ok('a word after a domain is only joined as a path on a labelled web line', fm.buildFields(unlabelledWeb).fields.websites[0].value === 'brightpathit.com', JSON.stringify(fm.buildFields(unlabelledWeb).fields.websites));
  ok('a "The ..." company name is still allowed', fm.buildFields(fm.classifyLines('The Home Depot\nDana Whitlock\nStore Manager\ndana@homedepot.com')).fields.organization === 'The Home Depot');
  const built = fm.buildFields(lines);
  ok('buildFields equals parseOCRText', JSON.stringify(built.fields) === JSON.stringify(fm.parseOCRText(text)));
  ok('company derived from the web address is marked as derived', built.fields.organization === 'BrightPathIT' && built.derived.organization === 'web address', JSON.stringify(built.derived));
  const asCompany = lines.map(l => l.text === 'Your Technology Partner' ? { ...l, role: 'organization' } : l);
  const overridden = fm.buildFields(asCompany);
  ok('choosing a line as Company overrides the derived company', overridden.fields.organization === 'Your Technology Partner' && !overridden.derived.organization);
  const edited = fm.buildFields(lines.map(l => l.role === 'email' ? { ...l, text: 'E dana@brightpathit.com' } : l));
  ok('edited line text is used', edited.fields.emails[0].value === 'dana@brightpathit.com', JSON.stringify(edited.fields.emails));
  const swapped = fm.buildFields(lines.map(l => l.role === 'phoneMobile' ? { ...l, role: 'phoneWork' } : l.role === 'phoneWork' ? { ...l, role: 'phoneMobile' } : l));
  const ph = (type) => (swapped.fields.phones.find(p => p.type === type) || {}).value;
  ok('explicit Work/Mobile phone roles win over labels', ph('work') === '+1 (616) 555-0187' && ph('mobile') === '+1 (616) 555-0142', JSON.stringify(swapped.fields.phones));
  const noted = fm.buildFields([{ text: 'Call after 3pm', role: 'notes' }, { text: 'Gate code 42', role: 'notes' }, { text: 'junk', role: 'ignore' }]);
  ok('notes lines are kept in order; ignored lines are dropped', noted.fields.notes === 'Call after 3pm\nGate code 42' && !Object.values(noted.fields).includes('junk'));
  const whole = fm.buildFields([{ text: '88 Elm Avenue, Burlington, VT 05401', role: 'address' }]);
  ok('Whole address role splits street and City/State/ZIP', whole.fields.street === '88 Elm Avenue' && whole.fields.city === 'Burlington' && whole.fields.zip === '05401');
  ok('no name line means no invented name', fm.parseOCRText('+1 (555) 201-3344').firstName === '');

  // Video review 2026-10-17 (#53, #54, #94): the TeamLogic card as the iPad read it, and other card shapes
  const ipad = fm.classifyLines('N20 weersooen\nYour Technology Advisor\nNick Zafer\nOwner & General Manager\nT 7950 Moorsbridge Road, Suite 405\nPortage, MI 49024\nnzafer@TeamLogicIT.com\n269.492.7400\n269.254.5403\nTeamLogicIT.com');
  ok('MOD05 #54: a street with a stray letter in front ("T 7950 ...") is the street, shown and filled without the letter', ipad[4].role === 'street' && ipad[4].text === '7950 Moorsbridge Road, Suite 405'
    && fm.buildFields(ipad).fields.street === '7950 Moorsbridge Road' && fm.buildFields(ipad).fields.unitNumber === '405', JSON.stringify(ipad[4]));
  ok('MOD05 #54: chosen by hand as Street, the stray letter is still dropped; a one-line address too', fm.buildFields([{ text: 'T 7950 Moorsbridge Road', role: 'street' }]).fields.street === '7950 Moorsbridge Road'
    && fm.parseOCRText('Jo Smith\nT 12 Main Street, Springfield, IL 62701').street === '12 Main Street');
  ok('MOD05 #54: a labelled phone number is never taken as a street', fm.classifyLines('Jo Smith\nT 269.492.7400\nPortage, MI 49024')[1].role === 'phoneWork');
  ok('MOD05 #53: the slogan goes to Notes, logo debris stays Ignore', ipad[1].role === 'notes' && ipad[0].role === 'ignore' && fm.buildFields(ipad).fields.notes === 'Your Technology Advisor');
  const quoted = fm.classifyLines('"Your Technology Advisor"\nNick Zafer\nOwner & General Manager');
  ok('MOD05 #53: a quoted phrase is never a job title or company: it goes to Notes', quoted[0].role === 'notes' && quoted[2].role === 'jobTitle', JSON.stringify(quoted));
  const occasion = fm.classifyLines('20th Anniversary\nJo Smith\nSince 1998');
  ok('MOD05 #53: "20th Anniversary" and "Since 1998" go to Notes, not Company', occasion[0].role === 'notes' && occasion[2].role === 'notes' && fm.buildFields(occasion).fields.organization === '', JSON.stringify(occasion));
  ok('MOD05: a "The ..." company name is still the company, not a slogan', fm.classifyLines('The Home Depot\nDana Whitlock\nStore Manager\ndana@homedepot.com')[0].role === 'organization');
  const caps = fm.parseOCRText('JOHN O\'BRIEN\nSALES DIRECTOR\nACME TOOLS INC\njohn@acmetools.com');
  ok('MOD05 #94: a name in capitals is found and filled in name case', caps.firstName === 'John' && caps.lastName === "O'Brien" && caps.jobTitle === 'SALES DIRECTOR' && caps.organization === 'ACME TOOLS INC', JSON.stringify(caps));
  ok('MOD05 #94: a printed "Jane Doe" still beats a line in capitals', fm.parseOCRText('ACME TOOLS\nJane Doe').firstName === 'Jane');
  const cruz = fm.parseOCRText('Maria de la Cruz\nOwner');
  ok('MOD05 #94: family-name particles (de la, van der) stay with the family name', cruz.firstName === 'Maria' && cruz.lastName === 'de la Cruz' && fm.parseOCRText('Jan van der Berg\nOwner').lastName === 'van der Berg', JSON.stringify(cruz));
  const intlPhones = fm.parseOCRText('Jo Smith\nTel +44 20 7946 0958\nM +49 30 1234567\n+1 312 555 0147').phones;
  ok('MOD05 #94: numbers with a country code outside the US are found and typed by their label (an unlabelled US number after work and mobile is Other)', JSON.stringify(intlPhones) === JSON.stringify([{ type: 'work', value: '+44 20 7946 0958' }, { type: 'mobile', value: '+49 30 1234567' }, { type: 'other', value: '+1 (312) 555-0147' }]), JSON.stringify(intlPhones));
  ok('MOD05 #94: a ZIP code or a short number is not an international phone', fm.parseOCRText('Jo Smith\nRoom +12').phones.length === 0 && fm.parseOCRText('Jo Smith\nSpringfield, IL 62701').phones.length === 0);

  // Video review #71: phone styles for US and Canadian numbers (memory only)
  const { PHONE_FORMATS, DEFAULT_PHONE_STYLE } = await import(`${R}/modules/mod05-form/formMapper.js`);
  const styled = new ContactFormMapper();
  const fmt = (style, n = '269.492.7400') => { styled.phoneStyle = style; return styled.formatPhone(n, 'US'); };
  ok('MOD05 #71: the three styles raven575 named, with and without +1', PHONE_FORMATS.map(([k]) => k).join() === 'paren,dots,digits'
    && fmt({ format: 'paren', countryCode: true }) === '+1 (269) 492-7400' && fmt({ format: 'paren', countryCode: false }) === '(269) 492-7400'
    && fmt({ format: 'dots', countryCode: true }) === '+1 269.492.7400' && fmt({ format: 'dots', countryCode: false }) === '269.492.7400'
    && fmt({ format: 'digits', countryCode: true }) === '+12694927400' && fmt({ format: 'digits', countryCode: false }) === '2694927400');
  ok('MOD05 #71: restyling a styled number works both ways, and an extension is kept', fmt({ format: 'dots', countryCode: false }, '+1 (269) 492-7400') === '269.492.7400' && fmt({ format: 'paren', countryCode: true }, '2694927400') === '+1 (269) 492-7400'
    && fmt({ format: 'dots', countryCode: false }, '269 492 7400 x12') === '269.492.7400 x12');
  ok('MOD05 #71: the default style is the one shipped before (+1 (269) 492-7400); other countries keep their own format', new ContactFormMapper().formatPhone('2694927400', 'US') === '+1 (269) 492-7400' && DEFAULT_PHONE_STYLE.format === 'paren' && DEFAULT_PHONE_STYLE.countryCode === true
    && fmt({ format: 'digits', countryCode: false }, '+44 20 7946 0958x') === '+44 20 7946 0958x' && styled.formatPhone('+44 2079460958', 'UK') === '+44 20 7946 0958');
  styled.phoneStyle = { format: 'dots', countryCode: false };
  ok('MOD05 #71: a scan fills phones in the chosen style', styled.parseOCRText('Jo Smith\nT 269.492.7400').phones[0].value === '269.492.7400');
}

// Icon matching (MOD04 iconMatcher: pure shape maths) and icon clues in the mapper
{
  const IM = await import(`${R}/modules/mod04-ocr/iconMatcher.js`);
  // Draw shapes into a greyscale buffer (0 = ink, 255 = paper).
  const canvas = (w, h, paint) => { const g = new Uint8Array(w * h).fill(255); paint((x, y) => { if (x >= 0 && y >= 0 && x < w && y < h) g[y * w + x] = 0; }); return g; };
  const ring = (cx, cy, r, t) => (set) => { for (let y = cy - r - t; y <= cy + r + t; y++) for (let x = cx - r - t; x <= cx + r + t; x++) { const d = Math.hypot(x - cx, y - cy); if (d >= r - t / 2 && d <= r + t / 2) set(x, y); } };
  const square = (x0, y0, s, t) => (set) => { for (let y = y0; y < y0 + s; y++) for (let x = x0; x < x0 + s; x++) if (x - x0 < t || y - y0 < t || x0 + s - 1 - x < t || y0 + s - 1 - y < t) set(x, y); };
  const describe = (g, w, h) => { const ink = IM.inkMask(g, w, { x0: 0, y0: 0, x1: w, y1: h }); return IM.describeShape(ink, IM.unionBox(IM.connectedComponents(ink))); };
  const W = 80;
  const thinRing = describe(canvas(W, W, ring(40, 40, 28, 3)), W, W), thickRing = describe(canvas(W, W, ring(40, 40, 28, 8)), W, W);
  const smallRing = describe(canvas(W, W, ring(40, 40, 12, 2)), W, W), box = describe(canvas(W, W, square(12, 12, 56, 4)), W, W);
  const two = IM.connectedComponents(IM.inkMask(canvas(40, 20, (set) => { for (let x = 2; x < 8; x++) set(x, 5); for (let x = 20; x < 30; x++) set(x, 12); }), 40, { x0: 0, y0: 0, x1: 40, y1: 20 }));
  ok('connected components found with their boxes', two.length === 2 && two[0].x0 === 2 && two[0].x1 === 8 && two[1].area === 10, JSON.stringify(two));
  ok('a shape matches itself exactly', Math.abs(IM.similarity(thinRing, thinRing) - 1) < 1e-6);
  ok('stroke weight matters less than shape (thin ring ~ thick ring > ring ~ square)', IM.similarity(thinRing, thickRing) > IM.similarity(thinRing, box) + 0.15, `${IM.similarity(thinRing, thickRing).toFixed(2)} vs ${IM.similarity(thinRing, box).toFixed(2)}`);
  ok('size does not matter (shapes are normalised)', IM.similarity(thinRing, smallRing) > 0.85, IM.similarity(thinRing, smallRing).toFixed(2));
  const templates = [{ cls: 'web', descriptor: thickRing }, { cls: 'email', descriptor: box }];
  ok('classifyShape picks the closest class', IM.classifyShape(thinRing, templates, { minScore: 0.5, minMargin: 0.05 }).cls === 'web');
  ok('classifyShape reports nothing below the score bar', IM.classifyShape(thinRing, templates, { minScore: 0.999, minMargin: 0 }).cls === null);
  ok('classifyShape reports nothing without a clear lead', IM.classifyShape(thinRing, [{ cls: 'a', descriptor: thickRing }, { cls: 'b', descriptor: thickRing }], { minScore: 0, minMargin: 0.01 }).cls === null);

  const { ContactFormMapper } = await import(`${R}/modules/mod05-form/formMapper.js`);
  const fm = new ContactFormMapper();
  const card = fm.buildFields(fm.classifyLines([
    { text: 'Kai Takahashi', icon: null }, { text: '206.555.9876', icon: 'mobile' }, { text: '206.555.3400', icon: 'phone' },
    { text: '206.555.3401', icon: 'fax' }, { text: '1201 Westlake', icon: 'address' },
    { text: '@studiocraft', icon: 'instagram' }, { text: 'in/kaitakahashi', icon: 'linkedin' }, { text: 'kai@studiocraft.design', icon: 'email' }
  ])).fields;
  const t = (list, type) => (card[list].find(e => e.type === type) || {}).value;
  ok('icons label unlabelled phones: mobile, work, fax', t('phones', 'mobile') === '+1 (206) 555-9876' && t('phones', 'work') === '+1 (206) 555-3400' && t('phones', 'workFax') === '+1 (206) 555-3401', JSON.stringify(card.phones));
  ok('address icon marks a street with no street word and no City/State/ZIP line', card.street === '1201 Westlake', card.street);
  ok('...which without the icon is not taken as a street', fm.parseOCRText('Kai Takahashi\n1201 Westlake').street === '');
  ok('numbered street names are streets ("1201 3rd Avenue")', fm.parseOCRText('Kai Takahashi\n1201 3rd Avenue\nSeattle, WA 98101').street === '1201 3rd Avenue');
  ok('social logo + bare handle becomes the profile link', t('websites', 'instagram') === 'https://instagram.com/studiocraft' && t('websites', 'linkedin') === 'https://www.linkedin.com/in/kaitakahashi', JSON.stringify(card.websites));
  const textWins = fm.buildFields(fm.classifyLines([{ text: 'T 206.555.1111', icon: 'mobile' }, { text: '206.555.2222', icon: 'email' }])).fields;
  ok('a written label beats the icon; an envelope next to a number is still a phone', textWins.phones[0].type === 'work' && textWins.phones.length === 2 && !textWins.emails.length, JSON.stringify(textWins));
  ok('classifyLines keeps each line\'s icon for the review screen', fm.classifyLines([{ text: '206.555.9876', icon: 'mobile' }])[0].icon === 'mobile');
  ok('MOD05 #66: Reddit is a website type; reddit.com and fb.me links are typed; u/handle makes a Reddit link', share.WEBSITE_TYPES.some(([k, l]) => k === 'reddit' && l === 'Reddit')
    && share.websiteTypeFor('https://www.reddit.com/user/kai') === 'reddit' && share.websiteTypeFor('https://fb.me/kai.t') === 'facebook' && share.websiteTypeFor('https://www.facebook.com/profile.php?id=100012345') === 'facebook'
    && share.socialProfileUrl('reddit', 'u/kai_t') === 'https://www.reddit.com/user/kai_t' && share.formatVCard({ firstName: 'K', websites: [{ type: 'reddit', value: 'https://www.reddit.com/user/kai' }] }).includes('X-SOCIALPROFILE;TYPE=reddit:https://www.reddit.com/user/kai'));
  // Categories box on the Fields card (raven575, 2026-10-18): the vCard's CATEGORIES, built only by vcardFormatter.js
  ok('categories: the schema has a categories field, empty by default', share.CONTACT_FIELDS.includes('categories') && share.createEmptyContact().categories === '');
  ok('categories: tags are trimmed; empty and repeated ones (any case) dropped', JSON.stringify(share.categoryTags(' Client, Plumber,, client ;Met  at expo\n')) === JSON.stringify(['Client', 'Plumber', 'Met at expo']) && share.categoryTags('').length === 0 && share.categoryTags(null).length === 0);
  const catCard = share.formatVCard({ firstName: 'K', categories: 'Client, Plumber; R&D' });
  ok('categories: written as one CATEGORIES line, tags joined by plain commas', catCard.includes('\r\nCATEGORIES:Client,Plumber,R&D\r\n'), catCard);
  ok('categories: a backslash in a tag is escaped; no line when there are none', share.formatVCard({ firstName: 'K', categories: 'A\\B' }).includes('CATEGORIES:A\\\\B') && !share.formatVCard({ firstName: 'K', categories: ' , ' }).includes('CATEGORIES'));
  ok('socialProfileUrl builds links only from plausible handles', share.socialProfileUrl('tiktok', '@kai') === 'https://tiktok.com/@kai' && share.socialProfileUrl('youtube', 'studio craft') === '' && share.socialProfileUrl('unknown', 'kai') === '');
}

// Perspective correction (MOD03 crop & straighten)
{
  const { computeHomography, applyHomography, warpPerspective, quadOutputSize } = await import(`${R}/modules/mod03-camera/perspective.js`);
  const quad = [{ x: 30, y: 20 }, { x: 170, y: 40 }, { x: 160, y: 130 }, { x: 20, y: 110 }];
  const rect = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }];
  const h = computeHomography(rect, quad);
  ok('homography maps each corner exactly', rect.every((p, i) => { const q = applyHomography(h, p.x, p.y); return Math.abs(q.x - quad[i].x) < 1e-6 && Math.abs(q.y - quad[i].y) < 1e-6; }));
  const W = 200, H = 150, data = new Uint8ClampedArray(W * H * 4).fill(255);
  const back = computeHomography(quad, rect);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const p = applyHomography(back, x + 0.5, y + 0.5); if (p.x >= 0 && p.x <= 100 && p.y >= 0 && p.y <= 50) { const o = (y * W + x) * 4; data[o] = data[o + 1] = data[o + 2] = 0; } }
  const size = quadOutputSize(quad);
  const flat = warpPerspective({ data, width: W, height: H }, quad, size.width, size.height);
  let dark = 0; for (let i = 0; i < flat.data.length; i += 4) if (flat.data[i] < 128) dark++;
  ok('a skewed shape is flattened into a full rectangle', size.width === 141 && size.height === 91 && dark / (size.width * size.height) > 0.99, `${size.width}x${size.height} ${dark}`);
  const big = quadOutputSize([{ x: 0, y: 0 }, { x: 6000, y: 0 }, { x: 6000, y: 3000 }, { x: 0, y: 3000 }]);
  ok('flattened output capped at 2400 px', big.width === 2400 && big.height === 1200, JSON.stringify(big));
  let threw = false; try { computeHomography(rect, [quad[0], quad[0], quad[0], quad[0]]); } catch (e) { threw = true; }
  ok('collapsed corners are rejected', threw);
}

// Viewfinder geometry and the stepped tween (MOD03 Capture card)
{
  const { visibleSourceRect, cardFrameRect, easeSnap, tween, CARD_ASPECT, OVERSHOOT } = await import(`${R}/modules/mod03-camera/viewfinder.js`);
  ok('visible window: a 16:9 view over a 16:9 feed at 1x is the whole frame', JSON.stringify(visibleSourceRect(1600, 900, 1920, 1080)) === JSON.stringify({ x: 0, y: 0, width: 1920, height: 1080 }));
  ok('visible window: a tall phone view over a wide feed shows the middle band (cover crop)', JSON.stringify(visibleSourceRect(390, 520, 1920, 1080)) === JSON.stringify({ x: 555, y: 0, width: 810, height: 1080 }), JSON.stringify(visibleSourceRect(390, 520, 1920, 1080)));
  ok('visible window: 2x digital zoom shows the centre quarter of that band', JSON.stringify(visibleSourceRect(390, 520, 1920, 1080, 2)) === JSON.stringify({ x: 758, y: 270, width: 405, height: 540 }), JSON.stringify(visibleSourceRect(390, 520, 1920, 1080, 2)));
  ok('visible window: zoom below 1 and missing sizes are harmless', visibleSourceRect(390, 520, 1920, 1080, 0.5).width === 810 && visibleSourceRect(0, 0, 640, 360).width === 640);
  const wide = cardFrameRect(800, 450), tall = cardFrameRect(390, 520);
  ok('card frame: landscape in a wide view, upright in a tall one, 3.5:2 either way', wide.orientation === 'landscape' && Math.abs(wide.width / wide.height - CARD_ASPECT) < 1e-9 && tall.orientation === 'portrait' && Math.abs(tall.height / tall.width - CARD_ASPECT) < 1e-9);
  ok('card frame: fills most of the view and sits centred', wide.width === 800 * 0.88 || wide.height === 450 * 0.88, JSON.stringify(wide));
  ok('card frame: centred', Math.abs(wide.x * 2 + wide.width - 800) < 1e-9 && Math.abs(tall.y * 2 + tall.height - 520) < 1e-9);
  ok('ease: starts at 0, ends at 1, overshoots a little late in the move', easeSnap(0) === 0 && Math.abs(easeSnap(1) - 1) < 1e-9 && easeSnap(0.8) > 1 && easeSnap(0.8) < 1 + OVERSHOOT + 1e-9 && Math.abs(easeSnap(0.5) - 0.5) < 1e-9, [easeSnap(0.5), easeSnap(0.8)].join());
  // A fake clock: the tween steps at 26 fps and lands exactly on the target
  let now = 0; const timers = [];
  const schedule = (fn, ms) => { timers.push({ at: now + ms, fn }); return timers.length; };
  const seen = [];
  tween(1, 2, 260, (v) => seen.push(v), { now: () => now, schedule, cancel: () => {} });
  while (timers.length) { const t = timers.shift(); now = t.at; t.fn(); }
  ok('tween: stepped frames about 38 ms apart, ending exactly on the target', seen.length >= 6 && seen.length <= 8 && seen[seen.length - 1] === 2 && seen.slice(0, -1).every(v => v > 1 && v < 2.1), JSON.stringify(seen));
  const instant = []; tween(1, 3, 260, (v) => instant.push(v), { instant: true, schedule, cancel: () => {} });
  ok('tween: under reduce motion the end value applies at once', instant.length === 1 && instant[0] === 3 && timers.length === 0);
}

// The zoom of the photo in the crop step (MOD03): pinch, pan and the zoom onto a snapped card
{
  const { clampView, zoomAbout, viewForCorners, CROP_ZOOM_MAX, SNAP_MARGIN } = await import(`${R}/modules/mod03-camera/cropView.js`);
  ok('crop zoom: never smaller than the whole photo, never past the maximum', clampView({ scale: 0.5, x: 10, y: 10 }, 400, 300).scale === 1 && clampView({ scale: 9, x: 0, y: 0 }, 400, 300).scale === CROP_ZOOM_MAX);
  // Not boxed in (raven575, 2026-10-20): zoomed in, any point of the photo, edges and corners included, can be brought to the
  // middle of the view, and no further. At 2x a 400 x 300 photo may move from x 200 (its left edge in the middle) to -600.
  ok('crop zoom: zoomed in, the photo can move until an edge reaches the middle, no further', JSON.stringify(clampView({ scale: 2, x: 50, y: -900 }, 400, 300)) === JSON.stringify({ scale: 2, x: 50, y: -450 }), JSON.stringify(clampView({ scale: 2, x: 50, y: -900 }, 400, 300)));
  const corner = clampView({ scale: 3, x: 1000, y: 1000 }, 400, 300);
  ok('crop zoom: the photo\'s top-left corner can be brought to the middle of the view (not boxed in)', corner.x === 200 && corner.y === 150, JSON.stringify(corner));
  const far = clampView({ scale: 3, x: -5000, y: -5000 }, 400, 300);
  ok('crop zoom: the bottom-right corner can be brought to the middle too', far.x + 400 * 3 === 200 && far.y + 300 * 3 === 150, JSON.stringify(far));
  ok('crop zoom: at the whole photo it stays in its place', JSON.stringify(clampView({ scale: 1, x: 80, y: -40 }, 400, 300)) === JSON.stringify({ scale: 1, x: 0, y: 0 }));
  ok('crop zoom: zooms in up to 6x', CROP_ZOOM_MAX === 6);
  const z = zoomAbout({ scale: 1, x: 0, y: 0 }, 2, 100, 100, 400, 300);
  ok('crop zoom: a pinch keeps the point under the fingers in place', JSON.stringify(z) === JSON.stringify({ scale: 2, x: -100, y: -100 }), JSON.stringify(z));
  ok('crop zoom: pinching out past the whole photo stops at it', JSON.stringify(zoomAbout({ scale: 2, x: -100, y: -100 }, 0.25, 0, 0, 400, 300)) === JSON.stringify({ scale: 1, x: 0, y: 0 }));
  // A 1600 x 1200 photo shown at 400 x 300; the card's box is 400..1200 by 300..700 in the photo (100..300 by 75..175 on screen)
  const card = [{ x: 400, y: 300 }, { x: 1200, y: 320 }, { x: 1180, y: 700 }, { x: 420, y: 680 }];
  const v = viewForCorners(card, 1600, 1200, 400, 300);
  const onScreen = card.map(c => ({ x: c.x / 4 * v.scale + v.x, y: c.y / 4 * v.scale + v.y }));
  ok('snap zoom: zooms in onto the card', v.scale > 1.5 && v.scale <= CROP_ZOOM_MAX, JSON.stringify(v));
  ok('snap zoom: the whole card is in view with a margin round it', onScreen.every(p => p.x >= 400 * SNAP_MARGIN / 2 && p.x <= 400 * (1 - SNAP_MARGIN / 2) && p.y >= 0 && p.y <= 300), JSON.stringify(onScreen));
  ok('snap zoom: the card sits in the middle', Math.abs((Math.min(...onScreen.map(p => p.x)) + Math.max(...onScreen.map(p => p.x))) / 2 - 200) < 1, JSON.stringify(onScreen));
  ok('snap zoom: a card that fills the photo leaves the whole photo in view', JSON.stringify(viewForCorners([{ x: 0, y: 0 }, { x: 1600, y: 0 }, { x: 1600, y: 1200 }, { x: 0, y: 1200 }], 1600, 1200, 400, 300)) === JSON.stringify({ scale: 1, x: 0, y: 0 }));
  // A portrait photo (300 x 400 on screen) seen through a full-width stage (400 x 400): a wide card can zoom in further
  const wide = [{ x: 0, y: 500 }, { x: 1200, y: 500 }, { x: 1200, y: 1100 }, { x: 0, y: 1100 }];
  const narrowView = viewForCorners(wide, 1200, 1600, 300, 400), wideView = viewForCorners(wide, 1200, 1600, 300, 400, 400, 400);
  ok('snap zoom: a full-width stage lets a snapped card fill more of the window', wideView.scale > narrowView.scale, JSON.stringify({ narrowView, wideView }));
  ok('snap zoom: missing sizes are harmless', viewForCorners(card, 0, 0, 400, 300).scale === 1 && viewForCorners(null, 1600, 1200, 400, 300).scale === 1);
}

// Snap to card: the on-device edge finder (MOD03)
{
  const { findCardQuad, convexHull, orderCorners } = await import(`${R}/modules/mod03-camera/cardFinder.js`);
  // A white 1050 x 600 card, rotated and sheared on a grey background, with dark "text" rows on it (the e2e crooked card)
  const deg = Math.PI / 180;
  const mul = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
  const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  const invert = (m) => { const det = m[0] * m[3] - m[1] * m[2]; const a = m[3] / det, b = -m[1] / det, c = -m[2] / det, d = m[0] / det; return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])]; };
  let m = [1, 0, 0, 1, 820, 600];
  m = mul(m, [Math.cos(-24 * deg), Math.sin(-24 * deg), -Math.sin(-24 * deg), Math.cos(-24 * deg), 0, 0]);
  m = mul(m, [1, 0, Math.tan(-12 * deg), 1, 0, 0]);
  m = mul(m, [1, 0, 0, 1, -525, -300]);
  const render = (W, H, bg, card, text = true, mat = m) => {
    const data = new Uint8ClampedArray(W * H * 4), inv = invert(mat);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const [cx, cy] = apply(inv, x + 0.5, y + 0.5);
      let v = bg;
      if (cx >= 0 && cx < 1050 && cy >= 0 && cy < 600) v = text && cy > 40 && cy < 500 && cx > 70 && cx < 900 && Math.floor(cy / 60) % 2 === 0 && Math.floor(cx / 14) % 3 !== 2 ? 255 - card : card;
      const o = (y * W + x) * 4; data[o] = data[o + 1] = data[o + 2] = v; data[o + 3] = 255;
    }
    return { data, width: W, height: H };
  };
  const corners = [[0, 0], [1050, 0], [1050, 600], [0, 600]].map(([x, y]) => apply(m, x, y));
  const close = (q) => !!q && q.length === 4 && q.every((p, i) => Math.hypot(p.x - corners[i][0], p.y - corners[i][1]) < 12);
  const light = findCardQuad(render(1600, 1200, 110, 255));
  ok('finder: a white card on a grey table is found, corners within 12 px, top-left first', close(light), JSON.stringify(light));
  ok('finder: a dark card on a light table is found too', close(findCardQuad(render(1600, 1200, 245, 40))));
  ok('finder: nothing to find in a flat photo', findCardQuad(render(800, 600, 128, 128, false)) === null);
  ok('finder: a photo that already is the card (edges off every side) gives null, so the handles stay at the full edge', findCardQuad({ data: new Uint8ClampedArray(400 * 240 * 4).fill(255), width: 400, height: 240 }) === null);
  const smallBlob = (() => { const W = 400, H = 300, data = new Uint8ClampedArray(W * H * 4).fill(60); for (let y = 140; y < 160; y++) for (let x = 190; x < 210; x++) { const o = (y * W + x) * 4; data[o] = data[o + 1] = data[o + 2] = 255; } return { data, width: W, height: H }; })();
  ok('finder: a patch too small to be a card gives null', findCardQuad(smallBlob) === null);
  // A card photographed from farther away (edge bench, 2026-10-22): the same card at 0.35 scale covers about 4% of the photo
  const far = mul([1, 0, 0, 1, 800, 600], mul([0.35, 0, 0, 0.35, 0, 0], mul([1, 0, 0, 1, -800, -600], m)));
  const farCorners = [[0, 0], [1050, 0], [1050, 600], [0, 600]].map(([x, y]) => apply(far, x, y));
  const farQuad = findCardQuad(render(1600, 1200, 110, 255, true, far));
  ok('finder: a far-away card covering about 4% of the photo is found, every corner "good" on the edge bench (within 2% of the diagonal)', !!farQuad && farQuad.every((p, i) => Math.hypot(p.x - farCorners[i][0], p.y - farCorners[i][1]) < 0.02 * Math.hypot(1600, 1200)), JSON.stringify(farQuad));
  ok('convex hull drops inner points and keeps the corners', convexHull([[0, 0], [10, 0], [10, 10], [0, 10], [5, 5], [2, 3]]).length === 4);
  ok('corners are ordered top-left, top-right, bottom-right, bottom-left', orderCorners([{ x: 9, y: 9 }, { x: 0, y: 10 }, { x: 10, y: 0 }, { x: 1, y: 1 }]).map(p => `${p.x},${p.y}`).join(' ') === '1,1 10,0 9,9 0,10');
}

// QR engine (ESM, delegates to shared formatter)
{
  const { VCGEQREngine, qrPalette } = await import(`${R}/modules/mod07-qr/qrGenerator.js`);
  const q = new VCGEQREngine();
  const contact = { firstName: 'Jane', lastName: 'Doe', organization: 'Smith, Jones', birthday: '1990-01-02' };
  ok('MOD07 output identical to shared formatter', q.generateVCard30(contact) === share.formatVCard(contact));
  ok('MOD07 escapes ORG comma', q.generateVCard30(contact).includes('ORG:Smith\\, Jones'));

  // Render with the bundled qrcode-generator onto an in-memory canvas, then decode with jsQR.
  const jsQR = require('jsqr');
  globalThis.qrcode = require('../src/vendor/qrcode-generator/qrcode.js');
  // A tiny canvas: fillRect, arc + fill (round dots, circle frame) and drawImage (a grey block) paint real colours
  // into an RGBA buffer, so jsQR decodes the same pixels a browser would. stroke draws nothing: a frame sits
  // outside the quiet zone and must not matter to the decoder.
  const makeCanvas = () => {
    const c = { width: 0, height: 0, _px: null };
    const rgb = (style) => { const h = style.replace('#', ''); const n = parseInt(h.length === 3 ? h.split('').map(x => x + x).join('') : h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
    // clip('evenodd') over two rects (a frame's band) is honoured: paint lands only between them
    let rects = [], band = null;
    const inRect = (x, y, [rx, ry, rw, rh]) => x >= rx && y >= ry && x < rx + rw && y < ry + rh;
    const put = (x, y, [r, g, b]) => { if (x < 0 || y < 0 || x >= c.width || y >= c.height) return; if (band && (!inRect(x, y, band[0]) || inRect(x, y, band[1]))) return; const o = (y * c.width + x) * 4; c._px[o] = r; c._px[o + 1] = g; c._px[o + 2] = b; c._px[o + 3] = 255; };
    const ensure = () => { if (!c._px || c._px.length !== c.width * c.height * 4) c._px = new Uint8ClampedArray(c.width * c.height * 4); };
    let path = [];
    const ctx = {
      fillStyle: '#000000', strokeStyle: '#000000', lineWidth: 1, font: '', textAlign: '',
      fillRect(x, y, w, h) { ensure(); const col = rgb(this.fillStyle); for (let j = Math.round(y); j < Math.round(y + h); j++) for (let i = Math.round(x); i < Math.round(x + w); i++) put(i, j, col); },
      beginPath() { path = []; rects = []; },
      arc(cx, cy, r) { path.push({ cx, cy, r }); },
      rect(x, y, w, h) { rects.push([x, y, w, h]); }, roundRect() {}, stroke() {}, save() {}, restore() { band = null; }, clip() { if (rects.length === 2) band = rects.slice(); }, moveTo() {}, lineTo() {}, closePath() {},
      fill() { ensure(); const col = rgb(this.fillStyle); for (const { cx, cy, r } of path) for (let j = Math.floor(cy - r); j <= Math.ceil(cy + r); j++) for (let i = Math.floor(cx - r); i <= Math.ceil(cx + r); i++) if ((i + 0.5 - cx) ** 2 + (j + 0.5 - cy) ** 2 <= r * r) put(i, j, col); },
      drawImage(img, x, y, w, h) { const keep = this.fillStyle; this.fillStyle = '#777777'; this.fillRect(x, y, w, h); this.fillStyle = keep; },
      fillText() {}
    };
    c.getContext = () => ctx;
    return c;
  };
  const decodes = (cv) => { const d = jsQR(cv._px, cv.width, cv.height); return d && d.data; };
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
  const { createEmptyContact } = await import(`${R}/share/cardSchema.js`);
  ok('MOD07 empty card has no details (default country and address type do not count)', q.hasDetails(createEmptyContact()) === false);
  ok('MOD07 a name, company, phone or city counts as details', [{ firstName: 'A' }, { organization: 'B' }, { phones: [{ type: 'work', value: '555' }] }, { city: 'Boise' }].every(c => q.hasDetails(c)));
  ok('MOD07 blank rows and spaces do not count', q.hasDetails({ firstName: '  ', phones: [{ type: 'work', value: '' }] }) === false);
  const blank = makeCanvas();
  q.renderPlaceholder(blank, 320);
  const px = (x, y) => blank._px[(y * blank.width + x) * 4];
  ok('MOD07 placeholder is a white square on a black square', blank.width === 320 && px(5, 5) === 0 && px(160, 160) === 255 && px(314, 314) === 0);
  ok('MOD07 placeholder never decodes as a QR code', jsQR(blank._px, blank.width, blank.height) === null);

  // Step 9: themed colours with a contrast check, and the export styles drawn from the same matrix.
  const themes = { pumpkin: '#e8792b', maple: '#8f2318', harvest: '#dea52c', cranberry: '#6a1030', spruce: '#1f4b3a', sage: '#b9c6a8', slateblue: '#3e5572', twilight: '#2a2450' };
  const text = q.generateVCard30(utf8Contact);
  const themedAll = Object.values(themes).every((card) => { const p = qrPalette({ card }); return p.themed && p.ratio >= 4 && p.dark !== '#000000' && p.light !== '#ffffff'; });
  ok('MOD07 every fall theme tints the QR (dark shade on a pale tint, contrast at least 4:1)', themedAll, JSON.stringify(Object.fromEntries(Object.entries(themes).map(([k, c]) => [k, qrPalette({ card: c }).ratio.toFixed(1)]))));
  const weak = qrPalette({ card: '#808080' }, { darkMix: 0.1, lightMix: 0.1 });
  ok('MOD07 a tint under 4:1 falls back to black on white', weak.themed === false && weak.dark === '#000000' && weak.light === '#ffffff' && weak.ratio < 4, weak.ratio);
  ok('MOD07 a missing or malformed theme is black on white', qrPalette(null).themed === false && qrPalette({ card: 'teal' }).themed === false);
  const themedOk = Object.values(themes).every((card) => { const cv = makeCanvas(); return q.renderQRCode(cv, text, { size: 320, theme: { card } }) && q.lastRender.themed && decodes(cv) === text; });
  ok('MOD07 the themed QR decodes to the exact vCard for all eight themes', themedOk);
  const plain = makeCanvas(); q.renderQRCode(plain, text, { size: 320, theme: null });
  ok('MOD07 without a theme the QR is black on white and reports themed=false', q.lastRender.themed === false && q.lastRender.dark === '#000000' && decodes(plain) === text);
  const round = makeCanvas();
  ok('MOD07 round dots decode (finder squares stay square)', q.renderQRCode(round, text, { size: 320, dots: 'round', theme: { card: themes.spruce } }) && q.lastRender.dots === 'round' && decodes(round) === text);
  const framed = ['square', 'rounded', 'circle', 'stripes', 'checkers', 'polka'].every((frame) => { const cv = makeCanvas(); return q.renderQRCode(cv, text, { size: 320, frame, dots: 'round' }) && q.lastRender.frame === frame && cv.width > 0 && decodes(cv) === text; });
  ok('MOD07 square, rounded, circle, stripes, checkers and polka frames keep the code scannable', framed);
  const circle = makeCanvas(); q.renderQRCode(circle, text, { size: 200, frame: 'circle' });
  const square = makeCanvas(); q.renderQRCode(square, text, { size: 200, frame: 'square' });
  ok('MOD07 a circle frame gets a larger canvas than a square one, so it clears the corners', circle.width > square.width);
  const striped = makeCanvas(); q.renderQRCode(striped, text, { size: 200, frame: 'stripes' });
  ok('MOD07 the stripes frame is a wider band than the square frame, outside the quiet zone', striped.width > square.width && q.lastRender.frame === 'stripes');
  const wide = makeCanvas(), drawnAt = [];
  q.renderQRCode(wide, text, { size: 320, logo: { width: 200, height: 50 } });
  const wctx = wide.getContext('2d'), keepDraw = wctx.drawImage; wctx.drawImage = function (...a) { drawnAt.push(a.slice(3)); return keepDraw.apply(this, a); };
  q.renderQRCode(wide, text, { size: 320, logo: { width: 200, height: 50 } }); wctx.drawImage = keepDraw;
  ok('MOD07 a wide logo keeps its shape in the centre (4:1 stays 4:1, never squeezed square) and the code still decodes', drawnAt.length === 1 && Math.abs(drawnAt[0][0] / drawnAt[0][1] - 4) < 0.2 && decodes(wide) === text, JSON.stringify(drawnAt));
  const logoed = makeCanvas();
  ok('MOD07 a centre logo forces level H and the code still decodes around it', q.renderQRCode(logoed, text, { size: 320, logo: {} }) && q.lastRender.level === 'H' && q.lastRender.logo === true && decodes(logoed) === text);
  ok('MOD07 logo option is offered when the contact fits at level H', q.logoOption(text).ok === true && q.fits(text, 'H') === true);
  const big = 'x'.repeat(1700); // fits at level M (2953 bytes max) but not at level H (1273 bytes max)
  ok('MOD07 logo option is greyed out with a reason when the contact no longer fits at level H', q.fits(big, 'M') === true && q.fits(big, 'H') === false && q.logoOption(big).ok === false && /Too much/.test(q.logoOption(big).reason));
  ok('MOD07 an unknown dots or frame value falls back to square and none', q.renderQRCode(makeCanvas(), text, { dots: 'hex', frame: 'oval' }) && q.lastRender.dots === 'square' && q.lastRender.frame === 'none');
  q.renderPlaceholder(makeCanvas(), 320);
  ok('MOD07 the placeholder clears lastRender, so nothing claims a themed code is on screen', q.lastRender === null);
  delete globalThis.qrcode;
}

// OCR second guesses (MOD04 glyphChoices: pure)
{
  const g = await import(`${R}/modules/mod04-ocr/glyphChoices.js`);
  const sym = (text, x0, x1, confidence, choices) => ({ text, bbox: { x0, x1, y0: 0, y1: 40 }, confidence, choices: choices.map(([t, c]) => ({ text: t, confidence: c })) });
  // The "m" of "Kalamazoo" read as "rm": the "r" box lies inside the "m" box and "m" was one of its guesses.
  const kala = { text: 'Kalarmazoo', symbols: [sym('K', 0, 44, 99, [['K', 94]]), sym('a', 42, 74, 99, [['a', 88]]), sym('l', 71, 89, 99, [['l', 94]]),
    sym('a', 89, 122, 99, [['a', 95]]), sym('r', 128, 149, 95, [['r', 92], ['m', 76]]), sym('m', 123, 182, 96, [['m', 92], ['n', 48]]),
    sym('a', 181, 215, 98, [['a', 93]]), sym('z', 212, 248, 99, [['z', 95]]), sym('o', 245, 278, 99, [['o', 94]]), sym('o', 281, 314, 98, [['o', 90]])] };
  ok('a letter read twice (the "r" inside an "m") is dropped', g.refineWord(kala).text === 'Kalamazoo', g.refineWord(kala).text);
  const rn = { text: 'rn', symbols: [sym('r', 0, 20, 90, [['r', 90], ['m', 70]]), sym('n', 22, 50, 92, [['n', 92]])] };
  ok('letters side by side are both kept ("rn")', g.refineWord(rn).text === 'rn');
  const logic = { text: 'LogiciT', symbols: [sym('L', 0, 30, 95, [['L', 89]]), sym('o', 30, 60, 99, [['o', 94]]), sym('g', 60, 90, 98, [['g', 95]]),
    sym('i', 90, 100, 98, [['i', 89], ['j', 18]]), sym('c', 100, 130, 99, [['c', 95]]), sym('i', 132, 142, 87, [['i', 82], ['I', 78], ['!', 76], ['/', 60], ['l', 59], ['?', 40]]), sym('T', 142, 172, 99, [['T', 93]])] };
  const refined = g.refineWord(logic);
  ok('close second guesses are kept (within 20 points, at least 50); far ones are not', JSON.stringify(refined.alts) === JSON.stringify([{ at: 5, chars: ['i', 'I', '!'] }]), JSON.stringify(refined.alts));
  ok('a word whose letters do not spell it is left alone', g.refineWord({ text: 'abc', symbols: [sym('a', 0, 9, 90, [['a', 90], ['o', 85]])] }).text === 'abc');
  ok('second guesses follow the words into the final line text (label added, icon debris dropped)', JSON.stringify(g.altsForText('E jo@LogiciT.com', [{ text: 'Q', alts: [] }, { text: 'jo@LogiciT.com', alts: [{ at: 8, chars: ['i', 'I'] }] }])) === JSON.stringify([{ at: 10, chars: ['i', 'I'] }]));
}

// OCR worker (ESM): returns raw text, publishes on the shared bus, and fails loudly (never with made-up text)
{
  globalThis.document = { baseURI: 'http://localhost/', createElement: () => ({ getContext: () => ({ drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray(4) }), putImageData() {} }), toDataURL: () => 'data:image/png;base64,' }) };
  globalThis.Image = class { set src(v) { this.width = 10; this.height = 10; setTimeout(() => this.onload && this.onload(), 0); } };
  const origLog = console.log, origErr = console.error; console.log = () => {}; console.error = () => {};
  const ocr = await import(`${R}/modules/mod04-ocr/ocrWorker.js`);
  let evt = null; share.globalEventBus.subscribe(share.Events.OCR_TEXT_EXTRACTED, e => evt = e);
  const failure = (p) => p.then(() => null, e => e);

  delete globalThis.Tesseract;
  const missing = await failure(ocr.executeOCRScan('data:image/png;base64,x'));
  ok('OCR without Tesseract.js rejects with OCR_UNAVAILABLE', missing && missing.code === 'OCR_UNAVAILABLE' && missing instanceof ocr.OcrUnavailableError, missing && missing.message);

  // Tesseract.js 5 behaviour when the language model 404s: errorHandler fires, createWorker never settles
  globalThis.Tesseract = { createWorker: (l, o, opts) => { setTimeout(() => opts.errorHandler('Network error while fetching eng.traineddata.gz. Response code: 404'), 5); return new Promise(() => {}); } };
  const t0 = Date.now();
  const broken = await failure(ocr.executeOCRScan('data:image/png;base64,x'));
  ok('OCR start-up error rejects promptly instead of hanging', broken && broken.code === 'OCR_UNAVAILABLE' && broken.message.includes('404') && Date.now() - t0 < 2000, broken && broken.message);

  globalThis.Tesseract = { createWorker: () => new Promise(() => {}) };
  const slow = await failure(ocr.executeOCRScan('data:image/png;base64,x', { initTimeoutMs: 50 }));
  ok('OCR start-up that never finishes times out', slow && slow.code === 'OCR_UNAVAILABLE' && slow.message.includes('longer than'), slow && slow.message);
  // WebKit stall (2026-10-19): a worker that started but never answers setParameters hung the scan with no time limit
  let mute = 0;
  globalThis.Tesseract = { createWorker: async () => ({ setParameters: () => new Promise(() => {}), recognize: async () => ({ data: {} }), terminate() { mute++; } }) };
  const deaf = await failure(ocr.executeOCRScan('data:image/png;base64,x', { initTimeoutMs: 50 }));
  await new Promise(r => setTimeout(r, 0));
  ok('a worker that never answers its start-up settings times out like start-up, and is stopped', deaf && deaf.code === 'OCR_UNAVAILABLE' && deaf.message.includes('longer than') && mute === 1, deaf && deaf.message);
  const NormalImage = globalThis.Image;
  globalThis.Image = class { set src(v) {} };
  globalThis.Tesseract = { createWorker: async () => { throw new Error('not reached'); } };
  const undecoded = await failure(ocr.executeOCRScan('data:image/png;base64,x', { initTimeoutMs: 50 }));
  globalThis.Image = NormalImage;
  ok('a photo the browser never finishes preparing ends at the start-up limit instead of hanging', undecoded && undecoded.code === 'OCR_UNAVAILABLE' && undecoded.message.includes('preparing the photo'), undecoded && undecoded.message);
  // The engine stopping in its last start-up step after its files loaded (WebKit, CI run 39702174014): one fresh start,
  // then OCR_START_FAILED ("stopped while starting"), never "files couldn't be reached"; a file that fails is not retried
  {
    let starts = 0, failFirst = 0, stopped = 0;
    globalThis.Tesseract = { createWorker: (l, o, opts) => {
      starts++;
      if (starts <= failFirst) { setTimeout(() => { opts.logger({ status: 'initializing api', progress: 0 }); opts.errorHandler('RuntimeError: Out of bounds memory access'); }, 1); return new Promise(() => {}); }
      return Promise.resolve({ setParameters: async () => {}, recognize: async () => ({ data: { text: 'Jane Doe\njane@example.com', confidence: 88, words: Array.from({ length: 8 }, () => ({ text: 'word', confidence: 90 })) } }), terminate() { stopped++; } });
    } };
    failFirst = 1;
    const second = await ocr.executeOCRScan('data:image/png;base64,x');
    ok('the engine stopping while starting gets one fresh start, and the photo is read', second.text.startsWith('Jane Doe') && starts === 2, String(starts));
    evt = null;   // that read published as it should; the checks below are failures again
    share.globalEventBus.publish(share.Events.VAULT_WIPED, { reason: 'test' });
    await new Promise(r => setTimeout(r, 0));
    starts = 0; failFirst = 2;
    const stoppedTwice = await failure(ocr.executeOCRScan('data:image/png;base64,x'));
    ok('stopping again ends the scan as OCR_START_FAILED after two starts', stoppedTwice && stoppedTwice.code === 'OCR_START_FAILED' && stoppedTwice instanceof ocr.OcrStartFailedError && !ocr.isEngineCrash(stoppedTwice) && stoppedTwice.message.includes('Out of bounds') && starts === 2, stoppedTwice && `${stoppedTwice.code} ${starts}`);
    starts = 0;
    globalThis.Tesseract = { createWorker: (l, o, opts) => { starts++; setTimeout(() => opts.errorHandler('Network error while fetching eng.traineddata.gz. Response code: 404'), 1); return new Promise(() => {}); } };
    const notLoaded = await failure(ocr.executeOCRScan('data:image/png;base64,x'));
    ok('a file that could not be loaded is still OCR_UNAVAILABLE, with no second start', notLoaded && notLoaded.code === 'OCR_UNAVAILABLE' && starts === 1, notLoaded && `${notLoaded.code} ${starts}`);
  }
  ok('failed OCR publishes nothing to the form pipeline', evt === null);

  let created = 0, terminated = 0, psm = null, params = null, result = null, hold = false, psms = [];
  const words = (n, conf) => Array.from({ length: n }, (_, i) => ({ text: `word${i}`, confidence: conf }));
  globalThis.Tesseract = { createWorker: async () => { created++; return {
    setParameters: async (p) => { params = p; psm = p.tessedit_pageseg_mode; psms.push(psm); },
    recognize: async (image) => (hold ? new Promise(() => {}) : { data: typeof result === 'function' ? result(image) : result }), terminate() { terminated++; } }; } };
  result = { text: 'Jane Doe\njane@example.com', confidence: 88, words: words(8, 90) };
  const r = await ocr.executeOCRScan('data:image/png;base64,x');
  ok('OCR returns raw text and confidence, publishes OCR_TEXT_EXTRACTED', r.text === 'Jane Doe\njane@example.com' && r.confidence === 88 && evt && evt.confidence === 88 && !('simulated' in r));
  ok('OCR_TEXT_EXTRACTED is a signal: no text on the bus', !('text' in evt) && !JSON.stringify(evt).includes('Jane'), JSON.stringify(evt));
  ok('OCR uses sparse-text page segmentation', psm === ocr.OCR_PAGE_SEG_MODE && psm === '11', String(psm));
  evt = null;
  result = { text: 'py A Year op WW es', confidence: 46, words: words(12, 70) };
  const blurry = await failure(ocr.executeOCRScan('data:image/png;base64,x'));
  ok('low-confidence photo rejected as unreadable (retake)', blurry && blurry.code === 'OCR_UNREADABLE' && blurry.confidence === 46 && evt === null, blurry && blurry.message);
  result = { text: 'Kai Takahashi 206.555.9876 kai@studiocraft.design', confidence: 84, words: words(4, 90) };
  const minimal = await ocr.executeOCRScan('data:image/png;base64,x');
  ok('a sharp minimal card (4 words) is accepted, not sent back for a retake', minimal.confidence === 84, JSON.stringify(minimal));
  result = { text: 'Jo', confidence: 80, words: words(2, 90) };
  const sparse = await failure(ocr.executeOCRScan('data:image/png;base64,x'));
  ok('photo with too few readable words rejected as unreadable', sparse && sparse.code === 'OCR_UNREADABLE' && sparse.readableWords === 2, sparse && sparse.message);
  ok('OCR worker is started once and reused after a failure', created === 1, String(created));
  ok('OCR asks the engine for second guesses', params && params.lstm_choice_mode === '2', JSON.stringify(params));
  const word = (text, confidence) => ({ text, confidence, symbols: [] });
  result = { text: 'W acme.comlKala\nJane Doe', confidence: 80, words: words(6, 90),
    lines: [{ text: 'W acme.comlKala', words: [word('W', 10), word('acme.comlKala', 20)] }, { text: 'Jane Doe', words: [word('Jane', 95), word('Doe', 30)] }] };
  const shaky = await ocr.executeOCRScan('data:image/png;base64,x');
  ok('OCR passes on the words it was unsure of (2+ characters, below the limit)', JSON.stringify(shaky.lines.map(l => l.unsure)) === JSON.stringify([['acme.comlKala'], ['Doe']]) && ocr.OCR_UNSURE_WORD_CONFIDENCE === 50, JSON.stringify(shaky.lines));

  // Second look (bench run 2026-10-18): a line with unsure words is read again as a strip, straight and with its lean
  // corrected, and the surest reading replaces it only when clearly surer
  {
    const box = (x0, y0, x1, y1) => ({ x0, y0, x1, y1 });
    const sym = (text) => text.split('').map(t => ({ text: t, choices: [] }));
    const firstRead = { text: 'W acme.comlKala\nJane Doe', confidence: 80, words: words(6, 90), lines: [
      { text: 'W acme.comlKala', bbox: box(40, 300, 700, 340), words: [{ text: 'W', confidence: 95, bbox: box(40, 300, 70, 340), symbols: sym('W') }, { text: 'acme.comlKala', confidence: 20, bbox: box(90, 300, 700, 340), symbols: sym('acme.comlKala') }] },
      { text: 'Jane Doe', bbox: box(40, 40, 400, 90), words: [{ text: 'Jane', confidence: 95, bbox: box(40, 40, 200, 90), symbols: sym('Jane') }, { text: 'Doe', confidence: 92, bbox: box(220, 40, 400, 90), symbols: sym('Doe') }] }] };
    const strip = (text, confidence) => ({ text, confidence, lines: [{ text, words: [{ text, confidence, bbox: box(0, 0, 10, 10), symbols: sym(text) }] }] });
    const savedImage = globalThis.Image, savedCreate = globalThis.document.createElement;
    const drawn = [];
    globalThis.Image = class { constructor() { this.naturalWidth = this.width = 900; this.naturalHeight = this.height = 520; } set src(v) { setTimeout(() => this.onload && this.onload(), 0); } decode() { return Promise.resolve(); } };
    globalThis.document.createElement = () => ({ width: 0, height: 0, getContext: () => ({ drawImage(...a) { drawn.push(a); }, getImageData: () => ({ data: new Uint8ClampedArray(4) }), putImageData() {}, fillRect() {}, setTransform(...t) { drawn.push(['shear', t[2]]); } }), toDataURL: () => 'data:image/png;base64,strip' });
    // Each read answers by call: first the whole card, then each strip in turn
    const reads = (...strips) => { let n = 0; return () => (n++ === 0 ? firstRead : strips[Math.min(n - 2, strips.length - 1)]); };

    psms = []; drawn.length = 0;
    result = reads(strip('acme.com/KalamazooMI', 40), strip('acme.com/KalamazooMI', 88));
    const looked = await ocr.executeOCRScan('data:image/png;base64,x');
    const web = looked.lines.find(l => l.text.startsWith('W '));
    ok('second look: an unsure line read clearly surer as a straightened strip takes the new reading, its unsure words cleared', web && web.text === 'W acme.com/KalamazooMI' && web.unsure.length === 0, JSON.stringify(looked.lines));
    ok('second look: the sweep stops at the first reading that is sure enough (straight, then leaning backwards)', JSON.stringify(drawn.filter(d => d[0] === 'shear').map(d => d[1])) === JSON.stringify(ocr.SECOND_LOOK_SHEARS.slice(0, 2)) && ocr.SECOND_LOOK_SHEARS[0] === 0 && ocr.SECOND_LOOK_SHEARS[1] < 0, JSON.stringify(drawn.filter(d => d[0] === 'shear')));
    ok('second look: re-reads one line of text, then the engine goes back to sparse text', psms.join() === '7,11', psms.join());
    ok('second look: the first reading\'s letter stays as a runner-up where the readings disagree ("l" under the "/")', web && web.alts.some(a => a.at === 'W acme.com'.length && a.chars[0] === '/' && a.chars.includes('l')), JSON.stringify(web && web.alts));
    ok('second look: a line read right the first time is not read again, and nothing extra is returned', looked.lines.find(l => l.text === 'Jane Doe').unsure.length === 0 && looked.lines.every(l => !('look' in l)), JSON.stringify(looked.lines));

    drawn.length = 0;
    result = reads(strip('acme.c0m/Kaiamaz', 25));
    const kept = await ocr.executeOCRScan('data:image/png;base64,x');
    ok('second look: a strip reading that is not clearly surer changes nothing (the line stays flagged)', kept.lines[0].text === 'W acme.comlKala' && kept.lines[0].unsure.join() === 'acme.comlKala', JSON.stringify(kept.lines[0]));
    ok('second look: with no sure reading every lean is tried', drawn.filter(d => d[0] === 'shear').length === ocr.SECOND_LOOK_SHEARS.length, String(drawn.filter(d => d[0] === 'shear').length));

    let calls = 0;
    result = () => (calls++ === 0 ? firstRead : (() => { throw new Error('engine hiccup'); })());
    psms = [];
    const failed = await ocr.executeOCRScan('data:image/png;base64,x');
    ok('second look: a failing strip read keeps the first reading and puts the engine back to sparse text', failed.lines[0].text === 'W acme.comlKala' && psms[psms.length - 1] === '11', JSON.stringify({ lines: failed.lines, psms }));
    globalThis.Image = savedImage; globalThis.document.createElement = savedCreate;

    ok('second look: only clearly surer readings win', ocr.secondLookWins(20, { text: 'x', confidence: 60 }) && !ocr.secondLookWins(50, { text: 'x', confidence: 60 }) && !ocr.secondLookWins(10, { text: 'x', confidence: 59 }) && !ocr.secondLookWins(10, { text: '', confidence: 90 }) && !ocr.secondLookWins(10, null));
    ok('second look: the new reading replaces the line from its first unsure word on', ocr.joinSecondLook('E jo@acme.c0m', 'jo@acme.c0m', 'jo@acme.com') === 'E jo@acme.com' && ocr.joinSecondLook('W a.com b', 'a.com', 'a.com/b') === 'W a.com/b' && ocr.joinSecondLook('W a.com', 'zzz', 'q') === null);
    ok('second look: the target starts at the first unsure word and spans to the line\'s end', JSON.stringify(ocr.secondLookTarget(firstRead.lines[0], ['acme.comlKala']).box) === JSON.stringify(box(90, 300, 700, 340)) && ocr.secondLookTarget(firstRead.lines[0], []) === null && ocr.secondLookTarget({ text: 'a b', words: [{ text: 'ab', confidence: 9 }] }, ['ab']) === null);
    const merged = ocr.mergeReadingAlts('w TeamLogiciT.com/Kalamazoom\\', [{ at: 11, chars: ['i', 'I', '!', '|'] }], 'w TeamLogiclT.com/KalamazooM\\', []);
    ok('second look: where the readings disagree, the first reading\'s letter and its runner-ups are kept as second guesses', JSON.stringify(merged.find(a => a.at === 11)) === JSON.stringify({ at: 11, chars: ['l', 'i', 'I', '!', '|'] }), JSON.stringify(merged));
    const fm = new (await import(`${R}/modules/mod05-form/formMapper.js`)).ContactFormMapper();
    const straightened = fm.buildFields(fm.classifyLines([{ text: 'Nick Zafer' }, { text: 'Portage, MI 49024' }, { text: 'w TeamLogiclT.com/KalamazooM\\', alts: merged }])).fields;
    ok('second look + field mapping: the straightened "TeamLogiclT" becomes TeamLogicIT from the first reading\'s "I"', straightened.websites[0].value === 'TeamLogicIT.com/KalamazooMI' && straightened.organization === 'TeamLogicIT', JSON.stringify([straightened.websites, straightened.organization]));

    // Garbage check and up to three readings (raven575, 2026-10-20: a light green name read as garbage reached the form)
    const rq = await import(`${R}/modules/mod04-ocr/readingQuality.js`);
    const garbage = ['~: ;\' |_ ,', 'lIlIlI WwWnN', 'Rhtkp Qwxzt', '—_= ~ ^', 'ﬁ{ ,'].filter(text => !rq.isGarbage({ text, confidence: 45 }));
    ok('garbage check: noise, letter-soup and symbol lines are garbage', garbage.length === 0, JSON.stringify(garbage));
    const real = [['Nick Zafer', 45], ['Al Wu', 40], ['TeamLogicIT', 70], ['Chief Technology Officer', 52], ['nzafer@TeamlLogic\\T.com', 20], ['TeamLogiciT.com/Kalarmazoom\\', 25], ['(269) 492-7400', 15],
        ['5875 Moorsbridge Rd Ste 3', 48], ['Portage, MI 49024', 44], ['Ngozi Schwartz', 55], ['LLC', 30]].filter(([text, confidence]) => rq.isGarbage({ text, confidence }));
    ok('garbage check: real names, titles, unsure lines and slipped emails, web addresses and phones are text', real.length === 0, JSON.stringify(real));
    ok('garbage check: a line the engine was barely sure of is garbage unless it is shaped like a field', rq.isGarbage({ text: 'Ihre Aeh Hes', confidence: 22 }) && !rq.isGarbage({ text: 'Ihre Aeh Hes' }) && !rq.isGarbage({ text: '269 492 7400', confidence: 5 }));
    const classified = fm.classifyLines([{ text: 'Nick Zafer' }, { text: 'nzafer@teamlogicit.com' }]);
    ok('what is missing: nothing when the name and a phone or email are there; name and reach otherwise',
        rq.missingParts(classified).length === 0 && rq.missingParts(fm.classifyLines([{ text: 'nzafer@teamlogicit.com' }])).join() === 'name'
        && rq.missingParts(fm.classifyLines([{ text: 'Nick Zafer' }, { text: 'Fax (269) 492-7401' }])).join() === 'reach' && rq.missingParts([]).join() === 'name,reach',
        JSON.stringify(classified));
    ok('what is missing: said in words', rq.describeMissing(['name']) === 'the name' && rq.describeMissing(['name', 'reach']) === 'the name or a phone number or email');
    const first = [{ text: 'Rhtkp Qwxzt', confidence: 21 }, { text: 'nzafer@teamlogicit.com', confidence: 80 }, { text: '(269) 492-7400', confidence: 85 }];
    const one = rq.mergeReadings([first]);
    ok('one reading: garbage lines are kept as unreadable, in place, so the review can show them', one.length === 3 && one[0].unreadable && !one[1].unreadable && !('reading' in one[0]) && !('garbage' in one[1]), JSON.stringify(one));
    const second = [{ text: 'Nick Zafer', confidence: 82 }, { text: 'nzafer@teamlogicit.com', confidence: 70 }, { text: '(269) 492-7400', confidence: 90 }];
    const two = rq.mergeReadings([first, second]);
    ok('two readings: the second photo fills in the name, the first\'s garbage is dropped, and each line is read once', two.map(l => l.text).join('|') === 'Nick Zafer|nzafer@teamlogicit.com|(269) 492-7400' && two.every(l => !l.unreadable) && two[2].confidence === 90, JSON.stringify(two));
    const three = rq.mergeReadings([[{ text: 'Nick Zafer', confidence: 50 }], [{ text: 'Nick Zafar', confidence: 58 }], [{ text: 'Nick Zafer', confidence: 52 }]]);
    ok('three readings: two that agree outvote a surer third, with no "please check"', three.length === 1 && three[0].text === 'Nick Zafer' && three[0].confidence === 52 && !(three[0].unsure || []).length, JSON.stringify(three));
    const split = rq.mergeReadings([[{ text: 'Nick Zafer', confidence: 50, alts: [] }], [{ text: 'Nick Zafar', confidence: 55, alts: [] }]]);
    ok('two readings that disagree, neither sure: the surer is kept, marked unsure, with the other\'s letter as a second guess', split.length === 1 && split[0].text === 'Nick Zafar' && split[0].unsure.length === 2
        && JSON.stringify(split[0].alts.find(a => a.at === 8)) === JSON.stringify({ at: 8, chars: ['a', 'e'] }), JSON.stringify(split));
    const sureOne = rq.mergeReadings([[{ text: 'Nick Zafer', confidence: 50 }], [{ text: 'Nick Zafar', confidence: 75 }]]);
    ok('two readings that disagree, one sure: the sure one is kept as it is', sureOne[0].text === 'Nick Zafar' && !(sureOne[0].unsure || []).length, JSON.stringify(sureOne));
    const stillBad = rq.mergeReadings([[{ text: 'Rhtkp Qwxzt', confidence: 21 }], [{ text: 'Qwrtz Bkkgh', confidence: 18 }, { text: 'jo@acme.com', confidence: 90 }]]);
    ok('garbage in every reading: shown once, from the latest photo, as unreadable; garbage only in an older photo is dropped',
        stillBad.length === 2 && stillBad[0].unreadable && stillBad[0].text === 'Qwrtz Bkkgh' && rq.mergeReadings([[{ text: 'Rhtkp Qwxzt', confidence: 21 }], [{ text: 'jo@acme.com', confidence: 90 }]]).length === 1, JSON.stringify(stillBad));
    ok('photos per card: three at most', rq.MAX_PHOTOS === 3);
    // raven575, 2026-10-22 (base card): a symbol-only logo line was listed, and "Suite 405" came back "Suite 40%"
    const debris = rq.mergeReadings([[{ text: '. {) ——', confidence: 10 }, { text: 'Nick Zafer', confidence: 80 }, { text: 'A', confidence: 20 }]]);
    ok('a line with no letter or digit is dropped, not listed; a stray letter is still listed as unreadable', debris.length === 2 && debris[0].text === 'Nick Zafer' && debris[1].unreadable, JSON.stringify(debris));
    const suite = 'Moorsbridge Road, Suite 40%';
    const mended = rq.mergeReadings([[{ text: suite, confidence: 70, alts: [{ at: 26, chars: '5' }], unsure: [] }]])[0];
    const flagged = rq.fixNumberPercent({ text: suite, alts: [{ at: 26, chars: 'x' }], unsure: [] });
    ok('a "%" after a suite number takes the reader\'s digit guess; without one its word is flagged to check',
        mended.text === 'Moorsbridge Road, Suite 405' && !mended.alts.some(a => a.at === 26) && flagged.text === suite && flagged.unsure.join() === '40%', JSON.stringify({ mended, flagged }));
    ok('a "%" after a house number on a street line or after #, too; any other "%" is left alone',
        rq.fixNumberPercent({ text: '795% Main Street', alts: [{ at: 3, chars: '0' }] }).text === '7950 Main Street' && rq.fixNumberPercent({ text: 'Unit #12%' }).unsure.join() === '#12%'
        && rq.fixNumberPercent({ text: '20% off your first visit' }).text === '20% off your first visit' && !rq.fixNumberPercent({ text: '20% off your first visit' }).unsure);
  }

  // "Preparing the reader…": reported only when the engine has to start first
  result = { text: 'Jane Doe\njane@example.com', confidence: 88, words: words(8, 90) };
  let statuses = [];
  await ocr.executeOCRScan('data:image/png;base64,x', { onStatus: s => statuses.push(s) });
  ok('a scan with the engine running reports only "reading"', statuses.join() === 'reading', statuses.join());

  // Every wipe shuts the engine down; the next scan starts a fresh one
  share.globalEventBus.publish(share.Events.VAULT_WIPED, { reason: 'test' });
  await new Promise(res => setTimeout(res, 0));
  ok('a wipe terminates the OCR engine', terminated === 1, String(terminated));
  statuses = [];
  await ocr.executeOCRScan('data:image/png;base64,x', { onStatus: s => statuses.push(s) });
  ok('the first scan after a wipe starts a new engine and says so', created === 2 && statuses.join() === 'starting,reading', `${created} ${statuses.join()}`);
  share.globalEventBus.publish(share.Events.MEMORY_PURGED, { reason: 'idle' });
  await new Promise(res => setTimeout(res, 0));
  ok('an idle purge terminates the OCR engine too', terminated === 2, String(terminated));
  // The engine crashing inside Recognize (WebKit, CI run 160): one more read with a fresh reader; other errors are not retried
  {
    const before = { created, terminated };   // the engine was purged just above: it starts, crashes, and a fresh one is started
    let reads = 0;
    result = () => { if (reads++ === 0) { const e = new Error("Out of bounds memory access (evaluating 'Recognize')"); e.name = 'RuntimeError'; throw e; } return { text: 'Jane Doe\njane@example.com', confidence: 88, words: words(8, 90) }; };
    const again = await ocr.executeOCRScan('data:image/png;base64,x');
    await new Promise(r => setTimeout(r, 0));
    ok('an engine crash while reading: the crashed reader is stopped and a fresh one reads the photo once more', again.text.startsWith('Jane Doe') && reads === 2 && created - before.created === 2 && terminated - before.terminated === 1, JSON.stringify({ reads, created: created - before.created, terminated: terminated - before.terminated }));
    reads = 0;
    result = () => { reads++; const e = new Error('Out of bounds memory access'); e.name = 'RuntimeError'; throw e; };
    const twice = await failure(ocr.executeOCRScan('data:image/png;base64,x'));
    ok('a second crash is not retried again: the scan fails after two reads', !!twice && reads === 2, String(reads));
    reads = 0;
    result = () => { reads++; throw new Error('some other failure'); };
    const other = await failure(ocr.executeOCRScan('data:image/png;base64,x'));
    ok('other errors are not retried', !!other && reads === 1 && !ocr.isEngineCrash(new Error('x')) && ['unreachable executed', 'Out of bounds memory access', 'Division by zero', 'access to a null reference'].every(m => ocr.isEngineCrash(Object.assign(new Error(m), { name: 'RuntimeError' }))), String(reads));
    result = { text: 'Jane Doe\njane@example.com', confidence: 88, words: words(8, 90) };
  }

  // A wipe during a scan ends it quietly, and nothing is published
  hold = true; evt = null;
  const running = failure(ocr.executeOCRScan('data:image/png;base64,x'));
  await new Promise(res => setTimeout(res, 20));
  share.globalEventBus.publish(share.Events.VAULT_WIPED, { reason: 'left the page' });
  const stopped = await running;
  ok('a wipe during a scan ends it with OCR_CANCELLED and publishes nothing', stopped && stopped.code === 'OCR_CANCELLED' && evt === null, stopped && stopped.message);
  hold = false;

  // A read that never answers (a phone stopped the engine) times out, and the next scan gets a fresh engine
  await ocr.executeOCRScan('data:image/png;base64,x');
  const before = { created, terminated };
  hold = true; evt = null;
  const hung = await failure(ocr.executeOCRScan('data:image/png;base64,x', { readTimeoutMs: 50 }));
  await new Promise(res => setTimeout(res, 0));
  ok('a read that never finishes times out with OCR_TIMEOUT and stops the engine', hung && hung.code === 'OCR_TIMEOUT' && terminated === before.terminated + 1 && evt === null && ocr.OCR_READ_TIMEOUT_MS === 55000, hung && hung.message);
  hold = false; statuses = [];
  await ocr.executeOCRScan('data:image/png;base64,x', { onStatus: s => statuses.push(s) });
  ok('the scan after a timeout starts a fresh engine', created === before.created + 1 && statuses.join() === 'starting,reading', `${created} ${statuses.join()}`);
  const curve = [0, 2000, 10000, 27500, 50000, 55000, 90000].map(t => ocr.readProgress(t));
  ok('the read wash fills fast, then slower than real time, full exactly at the 55 s read limit', curve[0] === 0 && curve[3] === 0.75 && curve[5] === 1 && curve[6] === 1 && curve.every((v, i) => i === 0 || v >= curve[i - 1]) && curve[2] > 10000 / 55000, curve.join());
  ok('OCR no longer exposes a duplicate parser', !('parseExtractedTextToSchema' in ocr));

  // The Read card (readCard.js): stepped fades, the Looks right timings, the lane
  const read = await import(`${R}/modules/mod04-ocr/readCard.js`);
  ok('read card: motion stepped at 26 fps, blink-out and Looks right fade are quick (under 300 ms each)', read.STEP_FPS === 26 && read.BLINK_MS > 0 && read.BLINK_MS < 300 && read.CHECK_FADE_MS > 0 && read.CHECK_FADE_MS < 300 && read.CHECK_NOTE_AT > 0 && read.CHECK_NOTE_AT < 1);
  ok('read card: ease in and out starts at 0, passes 0.5 halfway, lands at 1', read.easeInOut(0) === 0 && read.easeInOut(0.5) === 0.5 && read.easeInOut(1) === 1 && read.easeInOut(0.25) < 0.25 && read.easeInOut(0.75) > 0.75);
  const steps = [0, 10, 40, 80, 120, 220, 500].map(t => read.fadeAt(1, 0, t, 220));
  ok('read card: a fade moves in frame steps and lands exactly on its target', steps[0] === 1 && steps[1] === 1 && steps.every((v, i) => i === 0 || v <= steps[i - 1]) && steps[5] === 0 && steps[6] === 0, steps.join());
  const faded = { style: {} };
  await read.fade(faded, 1, 0, 220, { instant: true });
  ok('read card: under reduce motion a fade is instant', faded.style.opacity === '0');
  const quick = { style: {} }; let t = 0;
  const p = read.fade(quick, 1, 0, 100, { instant: false, now: () => (t += 60) });
  await p;
  ok('read card: a fade lands on its target when its time is up', quick.style.opacity === '0');
  ok('read card: the reader-files message says the files could not be reached and the form was not changed', /files couldn't be reached/.test(read.READER_UNAVAILABLE_MESSAGE) && /form was not changed/.test(read.READER_UNAVAILABLE_MESSAGE));
  const readCode = (await import('node:fs')).readFileSync(`${R}/modules/mod04-ocr/readCard.js`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  ok('read card: stays in its lane (imports only the bus and its own reader, stores nothing, publishes nothing, no HTML strings, no fetch)',
    (readCode.match(/^import .* from '([^']+)'/gm) || []).every(l => l.includes('share/eventBus.js') || l.includes("'./ocrWorker.js'"))
    && !/localStorage|sessionStorage|indexedDB|document\.cookie|innerHTML|fetch\(|publish\(/.test(readCode));
  console.log = origLog; console.error = origErr; delete globalThis.Tesseract;
}

// MOD01 worker network lock (workerGuard.js) in a fake worker scope
{
  const vm = await import('node:vm'); const fs = await import('node:fs');
  const code = fs.readFileSync(`${R}/modules/mod01-shell/workerGuard.js`, 'utf8');
  const run = (hash) => {
    const loaded = [], fetched = [];
    class XHR { open(m, u) { this.url = u; } }
    const self = { location: { href: `http://localhost/src/modules/mod01-shell/workerGuard.js${hash}` }, fetch: async (u) => { fetched.push(u); return 'ok'; },
      importScripts: (...u) => loaded.push(...u), XMLHttpRequest: XHR, WebSocket: class {} };
    const ctx = vm.createContext({ self, XMLHttpRequest: XHR, Request: class {}, URL, console: { warn() {} }, Promise, TypeError, Error, decodeURIComponent });
    let error = null;
    try { vm.runInContext(code, ctx); } catch (e) { error = e; }
    return { self, ctx, loaded, fetched, error };
  };
  const good = run('#' + encodeURIComponent('http://localhost/src/vendor/tesseract/worker.min.js'));
  ok('worker lock loads the same-origin Tesseract worker', !good.error && good.loaded.join() === 'http://localhost/src/vendor/tesseract/worker.min.js', String(good.error));
  const local = await good.self.fetch('http://localhost/src/vendor/tesseract/lang/eng.traineddata.gz');
  const remote = await good.self.fetch('https://example.com/x').then(() => 'ALLOWED', () => 'blocked');
  ok('worker lock allows same-origin fetch and blocks other hosts', local === 'ok' && remote === 'blocked' && good.fetched.length === 1);
  let xhr = 'ALLOWED'; try { new good.ctx.XMLHttpRequest().open('GET', 'https://example.com/'); } catch (e) { xhr = 'blocked'; }
  let imp = 'ALLOWED'; try { good.self.importScripts('https://cdn.example.com/x.js'); } catch (e) { imp = 'blocked'; }
  let ws = 'ALLOWED'; try { new good.self.WebSocket('wss://example.com'); } catch (e) { ws = 'blocked'; }
  ok('worker lock blocks XHR, importScripts and WebSocket to other hosts', xhr === 'blocked' && imp === 'blocked' && ws === 'blocked', [xhr, imp, ws].join());
  const evil = run('#' + encodeURIComponent('https://example.com/evil.js'));
  ok('worker lock refuses to load a worker script from another host', evil.error && evil.loaded.length === 0);
}

// MOD06 3D Card: logo trimming and tone (pure pixel logic), and the card look kept in the contact
{
  const card = await import(`${R}/modules/mod06-gui/card3dView.js`);
  const c = share.createEmptyContact();
  ok('empty contact: no logo, Sans typeface', c.logoDisplay === null && c.avatarBase64 === null && c.cardFont === 'font-sans');
  const n = share.normalizeContact({ ...c, logoDisplay: 'data:image/png;base64,AAAA', cardFont: 'font-serif' });
  ok('normalize keeps the card logo and typeface', n.logoDisplay === 'data:image/png;base64,AAAA' && n.cardFont === 'font-serif');
  ok('the card-only logo never goes into the vCard', !share.formatVCard({ firstName: 'A', lastName: 'B', logoDisplay: 'data:image/png;base64,AAAA' }).includes('PHOTO'));

  // A 20 x 10 image with a 4 x 2 block at (8, 4).
  const image = (bg, ink) => {
    const px = new Uint8ClampedArray(20 * 10 * 4);
    for (let i = 0; i < 200; i++) px.set(bg, i * 4);
    for (let y = 4; y < 6; y++) for (let x = 8; x < 12; x++) px.set(ink, (y * 20 + x) * 4);
    return px;
  };
  const clear = card.logoBounds(image([0, 0, 0, 0], [10, 20, 30, 255]), 20, 10);
  ok('transparent logo trimmed to what is not see-through (2 px margin)', clear.transparent && clear.x === 6 && clear.y === 2 && clear.w === 8 && clear.h === 6, JSON.stringify(clear));
  const solid = card.logoBounds(image([255, 0, 0, 255], [255, 255, 255, 255]), 20, 10);
  ok('opaque logo trimmed to what differs from its edge colour', !solid.transparent && solid.edge === 'rgb(255,0,0)' && solid.x === 6 && solid.w === 8 && solid.h === 6, JSON.stringify(solid));
  const blank = card.logoBounds(image([255, 255, 255, 255], [255, 255, 255, 255]), 20, 10);
  ok('plain image is kept whole', blank.x === 0 && blank.y === 0 && blank.w === 20 && blank.h === 10, JSON.stringify(blank));

  const all = { x: 0, y: 0, w: 20, h: 10 };
  ok('tone: mostly light, mostly dark, mixed, see-through',
    card.toneOf(image([250, 250, 250, 255], [250, 250, 250, 255]), 20, all) === 'light'
    && card.toneOf(image([10, 10, 10, 255], [10, 10, 10, 255]), 20, all) === 'dark'
    && card.toneOf(image([128, 128, 128, 255], [128, 128, 128, 255]), 20, all) === null
    && card.toneOf(image([0, 0, 0, 0], [0, 0, 0, 0]), 20, all) === null);

  // Redesign step 8: the eight fall themes, each a card colour, an ink and an accent that read well together
  const themes = Object.values(card.THEMES);
  ok('eight fall palettes in the order of the plan', themes.map(t => t.label).join('|') === 'Pumpkin|Maple|Harvest Gold|Cranberry|Spruce|Sage|Slate Blue|Twilight');
  ok('every theme: ink on the card reads at 4.5:1 or better, the initials (card colour on the accent) at 3:1 or better',
    themes.every(t => card.contrastRatio(t.ink, t.card) >= 4.5 && card.contrastRatio(t.card, t.accent) >= 3), themes.map(t => `${t.label} ${card.contrastRatio(t.ink, t.card).toFixed(1)}/${card.contrastRatio(t.card, t.accent).toFixed(1)}`).join(', '));
  ok('contrast ratio: white on black is 21, a colour on itself 1', Math.abs(card.contrastRatio('#fff', '#000') - 21) < 0.01 && card.contrastRatio('#e8792b', '#e8792b') === 1);
  ok('an old palette key (a card held through a lock) and an unknown one land on a fall theme', card.themeKeyOf('ocean') === 'slateblue' && card.themeKeyOf('sunset') === 'pumpkin' && card.themeKeyOf('nope') === card.DEFAULT_THEME && card.themeKeyOf('maple') === 'maple' && card.THEMES[card.DEFAULT_THEME]);

  // The ten pilots as sample contacts (raven575, 2026-10-22): "Name the Animal", fictional numbers, a vCGE.APP Gmail
  // plus-address, a vcge.app team page and a bench at Hangar 01, a bundled animal logo each, licence kept
  const fs6 = await import('node:fs');
  ok('ten samples, one per pilot plus the Banker and the PM, all at Team vCGE as "Name the Animal"', card.PRESETS.length === 10 && card.PRESETS.every(p => p.organization === 'Team vCGE' && p.firstName && /^the [A-Z]/.test(p.lastName))
    && card.PRESETS.map(p => `${p.firstName} ${p.lastName}`).join(',') === 'Shutout the Box Turtle,Ghost the Raccoon,Iris the Lynx,Glyph the Owl,Pidge the Octopus,Flipside the Chameleon,Checkers the Zebra,Airlock the Falcon,Tally the Hamster,Cornerstone the Elephant');
  ok('samples use only the reserved 555-01xx numbers, a vcge.app+name Gmail address and their vcge.app team page', card.PRESETS.every(p => p.phones.every(ph => /^\+1 \(202\) 555-01\d\d$/.test(ph.value))
    && p.emails.length === 1 && p.emails[0].value === `vcge.app+${p.firstName.toLowerCase()}@gmail.com`
    && /^https:\/\/vcge\.app\/team_members\/(mod0[1-8]|bnk01|pm-vcge-00)-[a-z]+$/.test(p.websites[0].value) && p.websites[0].value.endsWith(`-${p.firstName.toLowerCase()}`)
    && p.websites.slice(1).every(w => /^https:\/\/instagram\.com\/example$/.test(w.value)))
    && card.PRESETS.find(p => p.firstName === 'Glyph').websites[0].value === 'https://vcge.app/team_members/mod04-glyph'
    && card.PRESETS.find(p => p.firstName === 'Cornerstone').websites[0].value === 'https://vcge.app/team_members/pm-vcge-00-cornerstone', JSON.stringify(card.PRESETS.map(p => [p.phones, p.emails, p.websites])));
  ok('each sample lives at its own bench on Flight Deck Way, Hangar 01, Herd of Helpers HEADQUARTERS', card.PRESETS.every(p => /^\d Flight Deck Way, [A-Z][A-Za-z ]+$/.test(p.street) && p.unitType === 'Hangar' && p.unitNumber === '01'
    && p.city === 'Herd of Helpers HEADQUARTERS' && p.state === 'OH' && p.zip === '44101') && new Set(card.PRESETS.map(p => p.street)).size === 10
    && card.PRESETS.find(p => p.firstName === 'Glyph').street === '4 Flight Deck Way, Reading Room', card.PRESETS.map(p => p.street).join(' | '));
  ok('every sample names a fall theme and a bundled animal logo that exists, with the Noto licence beside it',
    card.PRESETS.every(p => card.THEMES[p.themePalette] && /^src\/vendor\/icons\/animals\/[a-z]+\.svg$/.test(p.logo) && fs6.existsSync(`${R}/../${p.logo}`))
    && fs6.existsSync(`${R}/vendor/icons/animals/LICENSE-noto-emoji.txt`) && fs6.readFileSync(`${R}/vendor/icons/animals/LICENSE-noto-emoji.txt`, 'utf8').includes('Apache License'), card.PRESETS.map(p => p.logo).join(' '));
  ok('plain edition: ten made-up people with no logo, the same fields and extras as the pilots, reserved numbers and example.com only',
    card.PLAIN_PRESETS.length === 10 && card.PLAIN_PRESETS.every(p => !p.logo && p.firstName && p.lastName && p.organization && p.jobTitle && card.THEMES[p.themePalette]
      && p.phones.every(ph => /^\+1 \(202\) 555-01\d\d$/.test(ph.value)) && p.emails.every(e => /@example\.com$/.test(e.value)) && p.websites.every(w => /^https:\/\/(example\.com|instagram\.com\/example)/.test(w.value)))
    && card.PLAIN_PRESETS.map(p => p.phones.length + p.websites.length + (p.namePrefix || '') + (p.nameSuffix ? 'S' : '')).join() === card.PRESETS.map(p => p.phones.length + p.websites.length + (p.namePrefix || '') + (p.nameSuffix ? 'S' : '')).join()
    && card.PLAIN_PRESETS.map(p => p.themePalette).join() === card.PRESETS.map(p => p.themePalette).join()
    && !JSON.stringify(card.PLAIN_PRESETS).match(/vCGE|Shutout|Ghost|Iris|Glyph|Pidge|Flipside|Checkers|Airlock|Tally|Cornerstone|pilot|Herd|Flight Deck|gmail/i), card.PLAIN_PRESETS.map(p => p.label).join());
  ok('initials: first name and last name, a leading "the" skipped (Ghost the Raccoon is GR, Shutout the Box Turtle SB)',
    card.initialsOf({ firstName: 'Ghost', lastName: 'the Raccoon' }) === 'GR' && card.initialsOf({ firstName: 'Shutout', lastName: 'the Box Turtle' }) === 'SB'
    && card.initialsOf({ firstName: 'jane', lastName: 'doe' }) === 'JD' && card.initialsOf({ firstName: 'Ana', lastName: 'Theron' }) === 'AT'
    && card.initialsOf({ firstName: 'Tom', lastName: 'The' }) === 'TT' && card.initialsOf({ firstName: 'Ana' }) === 'VC' && card.initialsOf() === 'VC'
    && card.PRESETS.map(card.initialsOf).join() === 'SB,GR,IL,GO,PO,FC,CZ,AF,TH,CE');
  ok('the sample logo files are plain SVG drawings (no scripts, no links out)', card.PRESETS.every(p => { const t = fs6.readFileSync(`${R}/../${p.logo}`, 'utf8'); return t.startsWith('<svg') && !/<script|<a[\s>]|href=|on[a-z]+=|url\((?!#)|http(?!:\/\/www\.w3\.org\/)/i.test(t); }));

  // White background removal: the white joined to the edge goes see-through, white inside the logo stays
  const white = () => {
    const px = new Uint8ClampedArray(8 * 8 * 4).fill(255);                         // all white, opaque
    for (let y = 2; y < 6; y++) for (let x = 2; x < 6; x++) px.set([200, 0, 0, 255], (y * 8 + x) * 4);   // a red block
    px.set([255, 255, 255, 255], (3 * 8 + 3) * 4);                                 // a white hole in it
    px.set([230, 230, 230, 255], (0 * 8 + 7) * 4);                                 // a light grey corner pixel
    return px;
  };
  const w8 = white();
  const cleared = card.removeWhite(w8, 8, 8);
  ok('the white around the logo is removed, with a soft edge for near-white', cleared === 48 && w8[3] === 0 && w8[(0 * 8 + 7) * 4 + 3] > 0 && w8[(0 * 8 + 7) * 4 + 3] < 255, `${cleared} ${w8[3]} ${w8[(0 * 8 + 7) * 4 + 3]}`);
  ok('the logo and the white inside it are untouched', w8[(2 * 8 + 2) * 4 + 3] === 255 && w8[(3 * 8 + 3) * 4 + 3] === 255);
  ok('isWhite reads an edge colour', card.isWhite('rgb(255,255,255)') && card.isWhite('rgb(240, 238, 236)') && !card.isWhite('rgb(200,0,0)') && !card.isWhite(''));

  // The trace: outlines of a cell mask as closed loops, a hole as a second loop, touching corners kept apart
  const one = new Uint8Array(9); one[4] = 1;
  ok('one cell: one square loop', JSON.stringify(card.outlines(one, 3, 3)) === '[[[1,1],[2,1],[2,2],[1,2]]]');
  const ring = new Uint8Array([1, 1, 1, 1, 0, 1, 1, 1, 1]);
  ok('a ring: the outside and the hole, the hole the other way round', JSON.stringify(card.outlines(ring, 3, 3)) === '[[[0,0],[3,0],[3,3],[0,3]],[[2,1],[1,1],[1,2],[2,2]]]');
  ok('two cells touching at a corner stay two loops', card.outlines(new Uint8Array([1, 0, 0, 1]), 2, 2).length === 2);
  ok('soften cuts each corner back half a cell, so a long side stays straight', JSON.stringify(card.soften([[0, 0], [4, 0], [4, 4], [0, 4]])) === '[[0,0.5],[0.5,0],[3.5,0],[4,0.5],[4,3.5],[3.5,4],[0.5,4],[0,3.5]]');
  const box = { x: 0, y: 0, w: 20, h: 10, transparent: false, edge: 'rgb(255,255,255)' };
  const traced = card.traceLogo(image([255, 255, 255, 255], [20, 20, 20, 255]), 20, box);
  ok('a dark mark on white traces to one path filled with currentColor, marked as the module\'s own', /^<svg [^>]*data-vcge-trace="1"[^>]*viewBox="0 0 20 10"><path fill="currentColor" fill-rule="evenodd" d="M[^"]+Z"\/><\/svg>$/.test(traced.svg || ''), traced.svg || traced.reason);
  const mixed = image([255, 255, 255, 255], [20, 20, 20, 255]);
  for (let x = 8; x < 10; x++) for (let y = 4; y < 6; y++) mixed.set([250, 240, 30, 255], (y * 20 + x) * 4);   // half the mark yellow
  ok('a mark of two colours is not traced (kept as is)', card.traceLogo(mixed, 20, box).reason === 'colours');
  ok('colour distance to the ink-to-background line: on it 0, off it the gap', card.distanceToInkLine([128, 128, 128], [0, 0, 0], [255, 255, 255]) === 0 && Math.round(card.distanceToInkLine([255, 0, 0], [0, 0, 0], [255, 255, 255])) === 208 && card.distanceToInkLine([10, 10, 10], [0, 0, 0], [0, 0, 0]) > 17);
  ok('the line runs on past the ink\'s average: the solid ink, darker than the average, is on it; nothing is on it behind the background', card.distanceToInkLine([17, 34, 51], [59, 72, 84], [255, 255, 255]) < 15 && Math.round(card.distanceToInkLine([255, 255, 255], [59, 72, 84], [255, 255, 255])) === 0 && card.distanceToInkLine([0, 0, 0], [255, 255, 255], [128, 128, 128]) > 200);
  // D1: the rim's tint, from the vCard photo (the corner is the background the logo was laid on)
  const photo = (back, mark, share = 0.25) => { const px = new Uint8ClampedArray(100 * 4); for (let i = 0; i < 100; i++) px.set(i >= 100 * (1 - share) ? mark : back, i * 4); return px; };
  ok('rim tint: a red mark on white gives red', card.logoTint(photo([255, 255, 255, 255], [220, 20, 20, 255]), 100) === 'rgb(220, 20, 20)');
  ok('rim tint: a blue mark on the dark slate behind a light logo gives blue, not the slate', card.logoTint(photo([30, 41, 59, 255], [29, 78, 216, 255]), 100) === 'rgb(29, 78, 216)');
  ok('rim tint: white lettering on an opaque red logo gives the red', card.logoTint(photo([200, 0, 0, 255], [255, 255, 255, 255]), 100) === 'rgb(200, 0, 0)');
  ok('rim tint: a grey logo on white gives its grey; a photo of its background only gives none', card.logoTint(photo([255, 255, 255, 255], [90, 90, 90, 255]), 100) === 'rgb(90, 90, 90)' && card.logoTint(photo([255, 255, 255, 255], [250, 250, 250, 255]), 100) === null);
  ok('a hold on a toast is 0.4 s or longer', card.TOAST_HOLD_MS === 400);
  ok('a blank image is too faint to trace', card.traceLogo(image([255, 255, 255, 255], [255, 255, 255, 255]), 20, box).reason === 'faint');
  const half = new Uint8ClampedArray(20 * 10 * 4).fill(255);
  for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) half.set([20, 20, 20, 255], (y * 20 + x) * 4);   // the left half black
  const small = card.traceLogo(half, 20, box, { max: 4 });
  ok('the trace is downscaled to the grid limit (a 20 x 10 mark on a 4 x 2 grid)', /viewBox="0 0 4 2"/.test(small.svg || '') && /M0 0\.5L0\.5 0L1\.5 0L2 0\.5L2 1\.5L1\.5 2L0\.5 2L0 1\.5Z/.test(small.svg || ''), small.svg || small.reason);
  ok('the toast says what was done to the logo', card.logoMessage({ traced: true, whiteRemoved: true }).includes('white background removed') && card.logoMessage({ traced: false, whiteRemoved: false, reason: 'colours' }).includes('more than two colours'));

  // Motion: the shared ease (26 fps steps, 5 percent snap), the spin and the toast timings
  ok('ease starts at 0, ends at 1, snaps past 1 on the way', card.easeSnap(0) === 0 && card.easeSnap(1) === 1 && Math.max(...Array.from({ length: 101 }, (_, i) => card.easeSnap(i / 100))) > 1.03);
  {
    let t = 0; const frames = []; const timers = [];
    const stop = card.tween(0, 180, 400, v => frames.push(v), { now: () => t, schedule: (fn, ms) => { timers.push([fn, ms]); return timers.length; }, cancel: () => {} });
    while (timers.length) { const [fn, ms] = timers.shift(); t += ms; fn(); }
    ok('a spin is stepped at 26 fps and lands exactly on the target', frames.length >= 9 && frames.length <= 12 && frames[frames.length - 1] === 180 && Math.max(...frames) > 180, JSON.stringify(frames.map(Math.round)));
    stop();
  }
  ok('spin, edge and toast numbers follow the plan: 26 fps, 5 percent, 48 px edge, 3 s toast', card.STEP_FPS === 26 && card.OVERSHOOT === 0.05 && card.EDGE_PX === 48 && card.TOAST_MS === 3000 && card.PRINT_LINES_EACH === 2);

  // iPad test video, 2026-10-17 (#74, #85, #86): the logo inset, the typefaces and sizes, the line icons and labels
  const css6 = fs6.readFileSync(`${R}/modules/mod06-gui/cardStyles.css`, 'utf8'), uiCss = fs6.readFileSync(`${R}/modules/mod01-shell/ui.css`, 'utf8');
  const px = (cls) => parseFloat(/^p-(\d+(?:\.\d+)?)$/.exec(cls)[1]) * 4;
  ok('#74 the logo inset is more than the rounding takes off (0.29 of the radius): 16 px tile corners, 12 px strip corners',
    px(card.LOGO_INSET) > 16 * (1 - Math.SQRT1_2) && px(card.LOGO_INSET_STRIP) > 12 * (1 - Math.SQRT1_2), `${card.LOGO_INSET} ${card.LOGO_INSET_STRIP}`);
  const families = card.CARD_FONTS.map(([cls]) => (new RegExp(`\\.${cls} \\{ font-family: '?([^',;]+)`).exec(css6) || [])[1]);
  ok('#85 eleven card typefaces, the original Sans, Serif and Mono first, each with its own rule', card.CARD_FONTS.length === 11 && card.CARD_FONTS.slice(0, 3).map(([c]) => c).join() === 'font-sans,font-serif,font-mono' && families.every(Boolean), JSON.stringify(families));
  const bundled = families.filter(f => !/^(system-ui|Georgia)$/.test(f));
  ok('#85 every bundled card typeface has its @font-face (here or in the app\'s font setting), no font host', bundled.length === 9 && bundled.every(f => new RegExp(`@font-face \\{ font-family: '${f}';[^}]*url\\('\\.\\./\\.\\./vendor/fonts/`).test(css6 + uiCss)) && !/https?:/.test(css6), bundled.join(','));
  ok('#85 four text sizes, medium by default, each scale defined', card.CARD_SIZES.map(([k]) => k).join() === 'sm,md,lg,xl' && card.DEFAULT_CARD_SIZE === 'md' && ['sm', 'lg', 'xl'].every(k => css6.includes(`.card-face.card-size-${k} { --card-scale:`)) && /@media screen \{\s*\.card-face \.text-2xl/.test(css6));
  ok('#86 line icons by kind: handset, mobile, fax, envelope, globe, house or building',
    card.lineIcon('phones', 'work') === 'phone' && card.lineIcon('phones', 'mobile') === 'device-mobile' && card.lineIcon('phones', 'pager') === 'device-mobile' && card.lineIcon('phones', 'workFax') === 'printer'
    && card.lineIcon('phones', 'homeFax') === 'printer' && card.lineIcon('phones', '') === 'phone' && card.lineIcon('emails', 'work') === 'mail' && card.lineIcon('websites', 'linkedin') === 'world'
    && card.lineIcon('address', 'home') === 'home' && card.lineIcon('address', 'work') === 'building' && card.lineIcon('address', 'other') === 'building');
  const sprite = fs6.readFileSync(`${R}/vendor/icons/app/sprite.svg`, 'utf8');
  ok('#86 every line icon is in the bundled sprite', ['phone', 'device-mobile', 'printer', 'mail', 'world', 'home', 'building'].every(id => sprite.includes(`<symbol id="${id}" viewBox="0 0 24 24">`)));
  ok('#86 labels: with icons the type alone; without, the line\'s noun joins a plain type, a telling one stays',
    card.lineLabel('phones', 'work', 'Work', true) === 'Work' && card.lineLabel('phones', 'work', 'Work', false) === 'Work phone' && card.lineLabel('phones', 'mobile', 'Mobile', false) === 'Mobile phone'
    && card.lineLabel('phones', 'workFax', 'Work fax', false) === 'Work fax' && card.lineLabel('emails', 'personal', 'Personal', false) === 'Personal email'
    && card.lineLabel('websites', 'linkedin', 'LinkedIn', false) === 'LinkedIn' && card.lineLabel('address', 'home', 'Home', false) === 'Home address' && card.lineLabel('emails', '', '', false) === '');
}

// MOD01 browser gate (browserGate.js, ES5): which missing feature blocks the app and which only warns
{
  const fs = await import('node:fs');
  const gate = require(`${R}/modules/mod01-shell/browserGate.js`);
  const lockedFetch = () => {}; lockedFetch[Symbol.for('vcge.netLock')] = true;
  const env = (over = {}) => Object.assign({
    document: { createElement: () => ({ noModule: false }) }, SecurityPolicyViolationEvent: function () {}, isSecureContext: true,
    crypto: { subtle: {} }, WebAssembly: {}, Worker: function () {}, Symbol, fetch: lockedFetch,
    navigator: { userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36', mediaDevices: { getUserMedia() {} } },
    CSS: { supports: () => true }
  }, over);
  ok('gate: a current browser is neither blocked nor warned', gate.blockReasons(env()).length === 0 && gate.warnReasons(env()).length === 0);
  const cases = [['modules', { document: { createElement: () => ({}) } }], ['csp', { SecurityPolicyViolationEvent: undefined }], ['https', { isSecureContext: false }],
    ['crypto', { crypto: {} }], ['wasm', { WebAssembly: undefined }], ['worker', { Worker: undefined }], ['netlock', { fetch: () => {} }], ['netlock', { Symbol: undefined }]];
  ok('gate: each missing protection blocks with its own reason', cases.every(([code, over]) => gate.blockReasons(env(over)).join() === code), cases.map(([c, o]) => c + '=' + gate.blockReasons(env(o)).join('+')).join(' '));
  const ie11 = env({ document: { createElement: () => ({}) }, SecurityPolicyViolationEvent: undefined, crypto: undefined, WebAssembly: undefined, Symbol: undefined, fetch: undefined });
  ok('gate: an Internet Explorer 11-like browser is blocked for every missing protection', gate.blockReasons(ie11).join() === 'modules,csp,crypto,wasm,netlock', gate.blockReasons(ie11).join());
  const win7 = env({ navigator: { userAgent: 'Mozilla/5.0 (Windows NT 6.1; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36', mediaDevices: { getUserMedia() {} } } });
  ok('gate: Windows 7 with Chromium 109 warns (system and engine) but is not blocked', gate.warnReasons(win7).join() === 'oldos,oldengine' && gate.blockReasons(win7).length === 0, gate.warnReasons(win7).join());
  ok('gate: Firefox on Windows 8.1 warns about the system only', gate.warnReasons(env({ navigator: { userAgent: 'Mozilla/5.0 (Windows NT 6.3; Win64; x64; rv:115.0) Gecko/20100101 Firefox/115.0', mediaDevices: { getUserMedia() {} } } })).join() === 'oldos');
  ok('gate: no camera or no 3D flip only warns', gate.warnReasons(env({ navigator: { userAgent: 'x' }, CSS: { supports: () => false } })).join() === 'nocamera,no3d');
  ok('gate: every warning has its text', ['oldos', 'oldengine', 'nocamera', 'no3d'].every(k => typeof gate.WARNINGS[k] === 'string'));
  // The gate starts the app itself, after the page has been read, and never once it has blocked
  const fakeDoc = (state, meta) => {
    const added = [], waiting = [];
    return { added, waiting, readyState: state, createElement: () => ({}), body: { appendChild: (el) => added.push(el) },
      querySelector: (sel) => (sel === 'meta[name="vcge-app"]' && meta ? { getAttribute: (a) => (a === 'content' ? meta : null) } : null),
      addEventListener: (type, fn) => waiting.push([type, fn]) };
  };
  ok('gate: the app entry is src/main.js, or the bundle the built page names', gate.APP_ENTRY === 'src/main.js' && gate.appEntry(fakeDoc('complete')) === 'src/main.js'
    && gate.appEntry(fakeDoc('complete', './assets/index-Ab1_c.js')) === './assets/index-Ab1_c.js');
  const docL = fakeDoc('loading', './assets/index-Ab1_c.js');
  gate.startApp({ document: docL });
  const waited = docL.added.length === 0 && docL.waiting.length === 1 && docL.waiting[0][0] === 'DOMContentLoaded';
  docL.waiting[0][1]();
  ok('gate: the app loads as an ES module only after the page has been read', waited && docL.added.length === 1 && docL.added[0].type === 'module' && docL.added[0].src === './assets/index-Ab1_c.js', JSON.stringify(docL.added));
  const docB = fakeDoc('loading'); const envB = { document: docB };
  gate.startApp(envB); envB.__vcgeGateBlocked = true; docB.waiting[0][1]();
  const docC = fakeDoc('complete'); gate.startApp({ document: docC, __vcgeGateBlocked: true });
  ok('gate: once blocked, the app is never loaded', docB.added.length === 0 && docC.added.length === 0);
  const page = fs.readFileSync(`${R}/../index.html`, 'utf8');
  ok('index.html has no script tag for the app, only the one entry the gate reads, after the gate',
    !/<script[^>]*type="module"/.test(page) && !/<script[^>]*main\.js/.test(page) && page.split('<meta name="vcge-app" content="src/main.js">').length === 2
    && page.indexOf('mod01-shell/browserGate.js') < page.indexOf('name="vcge-app"'));
  // Both gate scripts must parse in very old browsers: no ES2015+ syntax (comments and strings stripped first)
  const es5 = (file) => {
    const code = fs.readFileSync(`${R}/modules/mod01-shell/${file}`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/'(?:\\.|[^'\\])*'/g, "''");
    return !/=>|`|\.\.\.|\?\.|\?\?|\b(?:const|let|class|async|await|of)\b/.test(code);
  };
  ok('gate scripts use ES5 syntax only (browserGate.js, unsupported/unsupported.js)', es5('browserGate.js') && es5('unsupported/unsupported.js'));
}

// MOD01 welcome pop-up and tour (welcome.js): six steps, the card placed beside or under the area, nothing stored
{
  const fs = await import('node:fs');
  const welcome = await import(`${R}/modules/mod01-shell/welcome.js`);
  ok('welcome: six tour steps, each with a title, text and an area (a card, the Vault page or the header)', welcome.TOUR_STEPS.length === 6 && welcome.TOUR_STEPS.every(s => s.title && s.body && (s.card || s.sheet || s.header)));
  const deck = await import(`${R}/modules/mod01-shell/deck.js`);
  ok('deck: six cards in step order, the Welcome card first', deck.CARDS.join('|') === 'welcome|capture|read|fields|card|share');
  ok('deck: tour steps name real cards', welcome.TOUR_STEPS.every(s => !s.card || deck.CARDS.includes(s.card)));
  const welcomeCode = fs.readFileSync(`${R}/modules/mod01-shell/welcome.js`, 'utf8'), mainCode = fs.readFileSync(`${R}/main.js`, 'utf8');
  ok('welcome: START OVER goes through the deck hook to the Vault\'s startFresh, never a reload', /thankYouStartOverBtn'\)\.addEventListener\('click', \(\) => requestStartOver\(\)\)/.test(welcomeCode)
    && !/location\.reload/.test(welcomeCode) && /startOver: startFresh/.test(mainCode));
  ok('deck: a sideways swipe of 80 px closes a sheet; 48 px edge kept for the browser back gesture', deck.SWIPE_PX === 80 && deck.EDGE_PX === 48);
  const deckCode = fs.readFileSync(`${R}/modules/mod01-shell/deck.js`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  ok('deck: stores nothing, imports only the bus, and publishes only CARD_CHANGED', !/localStorage|sessionStorage|indexedDB|document\.cookie|innerHTML|fetch\(/.test(deckCode)
    && (deckCode.match(/^import .* from '([^']+)'/gm) || []).every(l => l.includes('share/eventBus.js')) && (deckCode.match(/publish\(Events\.(\w+)/g) || []).every(m => m === 'publish(Events.CARD_CHANGED'));
  // A swipe goes one card on from where the deck rested, in the direction it moved, however far it was flung
  const names = ['a', 'b', 'c', 'd'], centres = [0, 700, 1400, 2100];
  ok('deck: a swipe longer than 24 px goes on one card; a shorter one goes back', deck.INTENT_PX === 24
    && deck.pickCard(names, centres, 700 - 30, 700) === 'a' && deck.pickCard(names, centres, 700 + 30, 700) === 'c'
    && deck.pickCard(names, centres, 700 - 20, 700) === 'b' && deck.pickCard(names, centres, 700 + 20, 700) === 'b');
  ok('deck: a fling past two cards still stops at the next one, either way', deck.pickCard(names, centres, 1950, 700) === 'c'
    && deck.pickCard(names, centres, 300, 1400) === 'b' && deck.pickCard(names, centres, 2050, 2100) === 'c' && deck.pickCard(names, centres, 40.5, 0) === 'b');
  ok('deck: a scroll that ends on a card\'s centre (a card scrolled into view) keeps that card', deck.pickCard(names, centres, 2100, 700) === 'd' && deck.pickCard(names, centres, 1, 1400) === 'a');
  // Layers: the tour sits over the sheets but under the padlock, the lock screen and every pop-up
  const z = (file, sel) => Number(new RegExp(sel.replace(/[.]/g, '\\.') + '\\s*\\{[^}]*z-index:\\s*(\\d+)').exec(fs.readFileSync(`${R}/modules/${file}`, 'utf8'))[1]);
  const tourZ = z('mod01-shell/welcome.css', '.vcge-welcome'), sheetZ = z('mod01-shell/deck.css', '.vcge-sheet'), padlockZ = z('mod02-vault/vault.css', '.vault-handoff'), wipeZ = z('mod02-vault/vault.css', '.wipe-dialog');
  const indexHtml = fs.readFileSync(`${R}/../index.html`, 'utf8');
  const vaultCss = fs.readFileSync(`${R}/modules/mod02-vault/vault.css`, 'utf8');
  // A pop-up's layer is set either by its Tailwind class in index.html or by its own rule in vault.css
  const modalZ = ['vaultModal', 'quickSetupModal', 'leaveModal', 'ocrTimeoutModal'].map(id => Number((new RegExp(`#${id}\\s*\\{[^}]*z-index:\\s*(\\d+)`).exec(vaultCss) || new RegExp(`id="${id}"[^>]*\\bz-\\[?(\\d+)`).exec(indexHtml) || [])[1]));
  ok('welcome: the tour layer is over the sheets and under the padlock, the lock screen and every pop-up', tourZ > sheetZ && tourZ < padlockZ && tourZ < wipeZ && modalZ.every(m => tourZ < m), JSON.stringify({ tourZ, sheetZ, padlockZ, wipeZ, modalZ }));
  ok('welcome: the tour leaves keys typed into the lock screen or a pop-up alone', /e\.target !== document\.body && !layer\.contains\(e\.target\)/.test(fs.readFileSync(`${R}/modules/mod01-shell/welcome.js`, 'utf8')));
  ok('welcome: the tour gives no exact lock or wipe minutes (Vault owns the timers)', welcome.TOUR_STEPS.every(s => !/\d+\s*(min|minute|s\b|sec)/i.test(s.body)));
  const area = { left: 100, top: 100, right: 500, bottom: 300 };
  ok('welcome: on a wide screen the card goes beside the area', welcome.placeTip(area, 330, 200, 1440, 900).side === 'right' && welcome.placeTip({ left: 1000, top: 100, right: 1400, bottom: 300 }, 330, 200, 1440, 900).side === 'left');
  const phone = welcome.placeTip({ left: 16, top: 80, right: 374, bottom: 300 }, 358, 220, 390, 844);
  ok('welcome: on a phone the card goes under the area, inside the screen', phone.side === 'below' && phone.left >= 16 && phone.left + 358 <= 390 - 16 + 0.5 && phone.top === 316, JSON.stringify(phone));
  ok('welcome: a tall area puts the card above it, or over it as a last resort', welcome.placeTip({ left: 16, top: 600, right: 374, bottom: 830 }, 358, 220, 390, 844).side === 'above'
    && welcome.placeTip({ left: 16, top: 0, right: 374, bottom: 844 }, 358, 220, 390, 844).side === 'over');
  const code = fs.readFileSync(`${R}/modules/mod01-shell/welcome.js`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  ok('welcome: stores nothing and publishes nothing (no storage, cookies or bus)', !/localStorage|sessionStorage|indexedDB|document\.cookie|globalEventBus|innerHTML/.test(code));
}

// MOD01 shared look (ui.js / ui.css): breakpoints, the near-miss rim, bundled fonts and icons with their licences
{
  const fs = await import('node:fs');
  const ui = await import(`${R}/modules/mod01-shell/ui.js`);
  ok('ui: Settings font list is alphabetical with Inter as the default', JSON.stringify(ui.UI_FONTS) === JSON.stringify([...ui.UI_FONTS].sort((x, y) => x.localeCompare(y))) && ui.UI_FONTS.length === 7 && ui.DEFAULT_UI_FONT === 'Inter' && ui.UI_FONTS.includes('Inter'));
  ok('ui: 599 px is a phone, 600-1199 a tablet, 1200 and up a desktop', ui.layoutFor(599) === 'phone' && ui.layoutFor(600) === 'tablet' && ui.layoutFor(1199) === 'tablet' && ui.layoutFor(1200) === 'desktop' && ui.layoutFor(3840) === 'desktop');
  const box = { left: 100, top: 100, right: 200, bottom: 144 };
  ok('ui: a tap within 4 px of a button edge is a near miss, the middle is not', ui.onRim(box, 101, 120) && ui.onRim(box, 150, 143) && !ui.onRim(box, 150, 122) && !ui.onRim(box, 104, 104) && !ui.onRim(box, 90, 120));
  const css = fs.readFileSync(`${R}/modules/mod01-shell/ui.css`, 'utf8');
  const fontUrls = [...css.matchAll(/url\('\.\.\/\.\.\/vendor\/fonts\/([^']+)'\)/g)].map(m => m[1]);
  ok('ui: every declared font is bundled (Sixtyfour plus the Settings fonts)', fontUrls.length === 12 && fontUrls.every(f => fs.existsSync(`${R}/vendor/fonts/${f}`)), fontUrls.join(' '));
  ok('ui: each new font ships with its SIL Open Font License', ['sixtyfour', 'atkinson-hyperlegible', 'lexend', 'opendyslexic', 'tinos', 'comic-neue', 'macondo'].every(n => /SIL OPEN FONT LICENSE/i.test(fs.readFileSync(`${R}/vendor/fonts/LICENSE-${n}.txt`, 'utf8'))));
  const icons = ['aperture', 'radar-2', 'lock', 'forms', 'id', 'qrcode', 'send', 'settings', 'trash', 'camera', 'upload', 'circle-check', 'home-shield'];
  ok('ui: every MOD tag names its pilot (the roster)', Object.entries(ui.PILOTS).map(([m, n]) => `${m} ${n}`).join() === 'MOD-01 Shutout,MOD-02 Ghost,MOD-03 Iris,MOD-04 Glyph,MOD-05 Pidge,MOD-06 Flipside,MOD-07 Checkers,MOD-08 Airlock');
  ok('ui: the tag is drawn at Sixtyfour\'s own stroke (SCAN 0, no bleed) with a crisp 27% shadow, from the full Sixtyfour file', /font-variation-settings:\s*'BLED' 0,\s*'SCAN' 0;/.test(css)
    && /text-shadow:\s*1px 1px 0 rgba\(0, 0, 0, 0\.27\)/.test(css) && css.includes('sixtyfour-latin-full.woff2') && /\.mod-tag\.is-faded\s*\{\s*opacity:\s*0\.36/.test(css));
  ok('ui: the thirteen app icons are bundled as SVG with the Tabler MIT licence', icons.every(n => fs.readFileSync(`${R}/vendor/icons/app/${n}.svg`, 'utf8').includes('<svg')) && /MIT License/.test(fs.readFileSync(`${R}/vendor/icons/app/LICENSE-tabler.txt`, 'utf8')));
  ok('ui: icon stroke 2.3 and buttons at least 44 px with a 2 px outline', /--vcge-icon-stroke:\s*2\.3;/.test(css) && /--vcge-tap:\s*2\.75rem;/.test(css) && /border-width:\s*2px/.test(css));
  ok('ui: no font or icon comes from a host (only bundled files)', !/https?:/.test(css.replace(/\/\*[\s\S]*?\*\//g, '')));
  const html = fs.readFileSync(`${R}/../index.html`, 'utf8');
  const logos = [...html.matchAll(/(?:href|src)="(src\/assets\/brand\/[^"]+)"/g)].map(m => m[1]);
  ok('logo: the tab and home-screen icons use the bundled brand files, every one present', logos.length === 3 && logos.every(f => fs.existsSync(`${R}/../${f}`))
    && /rel="icon"[^>]*sizes="32x32"[^>]*href="src\/assets\/brand\/vcge-32\.png"/.test(html));
  // The header, Welcome and Thank You logos are one CSS background, drawn only in the branded edition (edition.js)
  const marks = [...html.matchAll(/<span class="([^"]*vcge-logo-mark[^"]*)" role="img" aria-label="vCGE"><\/span>/g)].map(m => m[1]);
  const markRule = css.match(/html:not\(\[data-edition="plain"\]\) \.vcge-logo-mark \{ background: url\('\.\.\/\.\.\/(assets\/brand\/[^']+)'\)/);
  ok('logo: the header and the Thank You page carry the logo, named vCGE for screen readers, from the bundled file (branded edition only)',
    marks.join() === 'deck-logo vcge-logo-mark,vcge-welcome-logo vcge-logo-mark' && !!markRule && fs.existsSync(`${R}/${markRule[1]}`), marks.join());
  ok('logo: the Welcome card draws the same mark, and leaves it and the tagline out in plain',
    /isPlain\(\) \? \[\] : \[el\('span', \{ className: 'vcge-welcome-logo vcge-logo-mark', role: 'img', 'aria-label': 'vCGE' \}\)\]/.test(fs.readFileSync(`${R}/modules/mod01-shell/welcome.js`, 'utf8'))
    && /isPlain\(\) \? \[\] : \[el\('p', \{ id: 'welcomeTagline'/.test(fs.readFileSync(`${R}/modules/mod01-shell/welcome.js`, 'utf8')));
  ok('plain edition: no rule fetches the logo there, and the tags (with their Sixtyfour font) are not shown',
    /html\[data-edition="plain"\] \.vcge-logo-mark, html\[data-edition="plain"\] \.mod-tag \{ display: none; \}/.test(css)
    && [...css.matchAll(/url\('\.\.\/\.\.\/assets\//g)].length === 1);
  const ed = await import(`${R}/modules/mod01-shell/edition.js`);
  const docOf = (edition) => ({ documentElement: { dataset: edition ? { edition } : {} } });
  ok('edition: branded unless index.html says data-edition="plain"', ed.isPlain(docOf('plain')) && !ed.isPlain(docOf()) && !ed.isPlain(docOf('branded')) && !ed.isPlain(null));
  ok('edition: plain names every header card instead of its pilot, and the Thank You page says "Session ended."',
    Object.values(ed.PLAIN_NAV).join() === 'Start,Capture,Read,Fields,Card,QR,Share' && ed.PLAIN_THANKS === 'Session ended.'
    && (html.match(/id="nav(?:Welcome|Capture|Read|Fields|Card|Qr|Share)"/g) || []).map(m => m.slice(4, -1)).join() === Object.keys(ed.PLAIN_NAV).join());
  ok('logo: no icon link points at a host', ![...html.matchAll(/<link[^>]+rel="(?:icon|apple-touch-icon)"[^>]*>/g)].some(m => /https?:/.test(m[0])));
  // Shutout's touches (shellArt.js, the "make it cute" round): the turtle and the plates are pictures only, branded only
  const art = await import(`${R}/modules/mod01-shell/shellArt.js`);
  ok('shell art: the turtle is centred under a button, whatever the header\'s own left edge',
    art.turtleX({ left: 100, width: 44 }, { left: 0 }, 24) === 110 && art.turtleX({ left: 130, width: 44 }, { left: 30 }, 24) === 110);
  ok('shell art: the plate of the card in view is current, cards already seen are visited, the rest new',
    art.plateStates(['welcome', 'capture', 'read'], new Set(['welcome', 'read']), 'read').join() === 'visited,new,current'
    && art.plateStates(['welcome', 'capture'], new Set(), 'welcome').join() === 'current,new');
  let artTouched = false;
  art.initShellArt({ querySelector: () => { artTouched = true; return null; }, getElementById: () => null, documentElement: { dataset: { edition: 'plain' } } });
  art.initShellArt({ addEventListener() {} });
  ok('shell art: does nothing in the plain edition, or without a page', !artTouched);
  const deckCss = fs.readFileSync(`${R}/modules/mod01-shell/deck.css`, 'utf8');
  const turtleTag = (html.match(/<span id="deckTurtle"[^>]*>/) || [''])[0], platesTag = html.match(/<span id="deckPlates"[^>]*>([\s\S]*?)<\/span>/);
  ok('shell art: the turtle and the six plates (one per card, in order) are hidden from screen readers, and hidden in plain',
    / aria-hidden="true"/.test(turtleTag) && !!platesTag && / aria-hidden="true"/.test(platesTag[0])
    && [...platesTag[1].matchAll(/data-card="(\w+)"/g)].map(m => m[1]).join() === 'welcome,capture,read,fields,card,share'
    && /html\[data-edition="plain"\] \.deck-turtle, html\[data-edition="plain"\] \.deck-plates \{ display: none; \}/.test(deckCss));
  ok('shell art: the turtle walks only when motion is allowed, and the sheets\' grab bar and pebble are branded only',
    /@media \(prefers-reduced-motion: no-preference\) \{ \.deck-turtle\.is-placed \{ transition: top 0\.3s ease-out; \} \}/.test(deckCss)
    && !/\.deck-turtle[^{]*\{[^}]*transition: (?!none)/.test(deckCss.replace(/@media \(prefers-reduced-motion: no-preference\) \{[^\n]*\n/g, ''))
    && /html:not\(\[data-edition="plain"\]\) \.vcge-sheet-panel::before \{/.test(deckCss) && /html:not\(\[data-edition="plain"\]\) \.vcge-sheet-close \{/.test(deckCss));
  // The walk (raven575's test report 2026-10-22): a capped spring, simulated at 60 frames a second
  const walkFor = (from, to, seconds = 8) => {
    let st = { x: from, v: 0 }, t = 0, top = 0, past = 0, at01 = null, settledAt = null;
    while (t < seconds && settledAt === null) {
      st = art.stepWalk(st, to, 1 / 60); t += 1 / 60;
      top = Math.max(top, Math.abs(st.v)); past = Math.max(past, (st.x - to) * Math.sign(to - from));
      if (at01 === null && t >= 0.1) at01 = Math.abs(st.x - from) / Math.abs(to - from);
      if (st.settled) settledAt = t;
    }
    return { top, past, at01, settledAt, x: st.x };
  };
  const hop = walkFor(0, 120), far = walkFor(900, 0);
  ok('shell art: the turtle gains speed slowly, runs a little past the icon, eases back and stops exactly on it',
    hop.at01 < 0.1 && hop.past > 2 && hop.past < 0.2 * 120 && hop.settledAt !== null && hop.settledAt < 3 && hop.x === 120, JSON.stringify(hop));
  ok('shell art: the turtle has a top speed, so a long way takes him a while, and he still gets there',
    far.top <= art.WALK.maxSpeed && far.settledAt > 2 && far.settledAt < 6 && far.x === 0, JSON.stringify(far));
  // Layout step 1 (tier.js): the screen tier is the width over the text size; 21:9 from monitor width is wide
  const tier = await import(`${R}/modules/mod01-shell/tier.js`);
  const tiers = (pairs, size) => pairs.map(([w, h]) => tier.tierFor(w, h, size)).join();
  ok('layout: each tier starts at its width (600, 900, 1200, 1600, 2200)',
    tiers([[320, 640], [599, 800], [600, 800], [899, 800], [900, 800], [1199, 800], [1200, 800], [1599, 1000], [1600, 1000], [2199, 1200], [2200, 1200]])
    === 'phone,phone,small-tablet,small-tablet,large-tablet,large-tablet,laptop,laptop,monitor,monitor,wide');
  ok('layout: larger text lays out like a smaller screen, smaller text like a bigger one',
    tier.tierFor(1000, 800, 1.25) === 'small-tablet' && tier.tierFor(1100, 800, 0.875) === 'laptop' && tier.tierFor(1000, 800, 0) === 'large-tablet');
  ok('layout: a 21:9 window counts as wide from monitor width on, not below it',
    tier.tierFor(2560, 1080) === 'wide' && tier.tierFor(1680, 720) === 'wide' && tier.tierFor(1400, 600) === 'laptop' && tier.tierFor(1920, 1080) === 'monitor');
  let fakeRaf = [], fakeObs = null, fakeRo = null, fakeRoOn = null;
  const fakeRoot = { dataset: {}, style: { getPropertyValue: () => '1.25' } };
  const fakeWin = { innerWidth: 1000, innerHeight: 450, document: { documentElement: fakeRoot }, addEventListener() {},
    requestAnimationFrame: (f) => fakeRaf.push(f), MutationObserver: class { constructor(f) { fakeObs = f; } observe() {} },
    ResizeObserver: class { constructor(f) { fakeRo = f; } observe(el) { fakeRoOn = el; } } };
  tier.initTier(fakeWin);
  const firstTier = `${fakeRoot.dataset.tier}/${fakeRoot.dataset.short}`;
  fakeWin.innerHeight = 800; fakeRoot.style.getPropertyValue = () => '1'; fakeObs(); fakeRaf.forEach(f => f());
  ok('layout: html gets its tier and the short mark at once, and both follow a new text size or window', firstTier === 'small-tablet/1'
    && fakeRoot.dataset.tier === 'large-tablet' && !('short' in fakeRoot.dataset), firstTier);
  fakeWin.innerWidth = 1366; fakeRo();
  ok('layout: a new page size seen by the resize observer updates the tier at once (WebKit can be late with the resize event)',
    fakeRoOn === fakeRoot && fakeRoot.dataset.tier === 'laptop', fakeRoot.dataset.tier);
  const uiCssL = fs.readFileSync(`${R}/modules/mod01-shell/ui.css`, 'utf8');
  ok('layout: cards measure their own width, sizes stay today\'s up to a 52rem card, drop-downs are 44 px, short screens free the height',
    /@supports \(container-type: inline-size\) \{\s*\.deck-card \{ container: deck-card \/ inline-size; \}/.test(deckCss)
    && /padding: clamp\(1\.25rem, 1\.25rem \+ \(100cqi - 52rem\)/.test(deckCss) && /font-size: clamp\(1\.125rem, 1\.125rem \+ \(100cqi - 52rem\)/.test(deckCss)
    && /\nselect \{ min-height: var\(--vcge-tap\); \}/.test(uiCssL)
    && /@media \(max-height: 499\.98px\) \{ :root \{ --vcge-header-h: calc\(2\.75 \* var\(--vcge-hu\)\); --vcge-strip-h: var\(--vcge-vault-strip, 0px\); \} \}/.test(deckCss));
}

// MOD01 saved settings (settings.js): the one localStorage entry, `name=number` pairs, preferences only
{
  const fs = await import('node:fs');
  const st = await import(`${R}/modules/mod01-shell/settings.js`);
  const ui = await import(`${R}/modules/mod01-shell/ui.js`);
  localStorage.clear();
  ok('settings: one key, defaults right hand, colour-blind off, dark theme, Inter, normal text size', st.SETTINGS_KEY === 'vcge_settings' && JSON.stringify(st.DEFAULTS) === '{"hand":0,"cb":0,"theme":0,"font":0,"size":0,"wipe":0}' && st.fontFor(0) === 'Inter' && st.scaleFor(0) === 1);
  ok('settings: the wipe after the lock is 7, 10 or 15 minutes, codes 0, 1, 2; 7 is the default and an unknown code is 7', st.WIPE_TIMES.map(t => `${t.code}:${t.minutes}`).join() === '0:7,1:10,2:15'
    && st.wipeMinutesFor(0) === 7 && st.wipeMinutesFor(1) === 10 && st.wipeMinutesFor(2) === 15 && st.wipeMinutesFor(9) === 7);
  {
    const root = { dataset: {}, classList: { toggle() {} }, style: { setProperty() {} } };
    const minutes = [0, 1, 2, 7].map(w => { st.applySettings({ wipe: w }, root); return root.dataset.wipe; }).join();
    ok('settings: applySettings puts the wipe time on html as data-wipe in minutes (7, 10, 15; out of range is 7)', minutes === '7,10,15,7', minutes);
  }
  ok('settings: wipe=3 or more is out of range and reads as 7 minutes', st.parseSettings('wipe=3').wipe === 0 && st.parseSettings('wipe=2').wipe === 2 && st.parseSettings('wipe=-1').wipe === 0);
  ok('settings: text sizes Small, Normal, Large, Larger, smallest first, each with its own fixed code; an unknown code is Normal', st.TEXT_SIZES.map(t => t.name).join() === 'Small,Normal,Large,Larger'
    && st.TEXT_SIZES.every((t, i) => i === 0 || t.scale > st.TEXT_SIZES[i - 1].scale) && new Set(st.TEXT_SIZES.map(t => t.code)).size === 4 && st.scaleFor(2) === 1.25 && st.scaleFor(9) === 1);
  ok('settings: every Settings font has its own fixed code, Inter 0, no code shared', ui.UI_FONTS.every(n => Number.isInteger(st.FONT_CODES[n])) && new Set(Object.values(st.FONT_CODES)).size === ui.UI_FONTS.length && Object.keys(st.FONT_CODES).length === ui.UI_FONTS.length);
  ok('settings: a line of name=number pairs reads back', JSON.stringify(st.parseSettings('hand=1;cb=1;theme=1;font=3;size=2;wipe=1')) === '{"hand":1,"cb":1,"theme":1,"font":3,"size":2,"wipe":1}');
  ok('settings: an entry saved before the text size and wipe time existed reads as Normal and 7 minutes', JSON.stringify(st.parseSettings('hand=1;cb=0;theme=0;font=2')) === '{"hand":1,"cb":0,"theme":0,"font":2,"size":0,"wipe":0}');
  ok('settings: missing or unreadable means the defaults', JSON.stringify(st.parseSettings(null)) === JSON.stringify(st.DEFAULTS) && JSON.stringify(st.parseSettings('garbage')) === JSON.stringify(st.DEFAULTS) && JSON.stringify(st.parseSettings('')) === JSON.stringify(st.DEFAULTS));
  ok('settings: an unknown name, an out-of-range or non-numeric value falls back to its default, the rest is kept', JSON.stringify(st.parseSettings('hand=1;name=Maria;cb=7;theme=x;font=99;size=4')) === '{"hand":1,"cb":0,"theme":0,"font":0,"size":0,"wipe":0}');
  ok('settings: serialises every name in a fixed order and clamps', st.serializeSettings({ font: 2, hand: 1, size: 3 }) === 'hand=1;cb=0;theme=0;font=2;size=3;wipe=0' && st.serializeSettings({ cb: 5 }) === 'hand=0;cb=0;theme=0;font=0;size=0;wipe=0');
  st.saveSettings({ hand: 1, font: 2 });
  ok('settings: save writes the one key and nothing else', localStorage.getItem('vcge_settings') === 'hand=1;cb=0;theme=0;font=2;size=0;wipe=0' && store.size === 1);
  ok('settings: load reads it back', JSON.stringify(st.loadSettings()) === '{"hand":1,"cb":0,"theme":0,"font":2,"size":0,"wipe":0}');
  st.clearSettings();
  ok('settings: clear removes it', store.size === 0 && JSON.stringify(st.loadSettings()) === JSON.stringify(st.DEFAULTS));
  localStorage.setItem('vcge_theme_preference', 'light');
  ok('settings: the old theme key is carried over once and removed', JSON.stringify(st.loadSettings()) === '{"hand":0,"cb":0,"theme":1,"font":0,"size":0,"wipe":0}' && localStorage.getItem('vcge_theme_preference') === null && store.size === 0);
  const code = fs.readFileSync(`${R}/modules/mod01-shell/settings.js`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  ok('settings: subscribes to SETTINGS_WIPE_REQUESTED, imports only the bus and ui.js, no network, cookies or markup', /subscribe\(Events\.SETTINGS_WIPE_REQUESTED/.test(code)
    && (code.match(/^import .* from '([^']+)'/gm) || []).every(l => l.includes('share/eventBus.js') || l.includes("'./ui.js'")) && !/fetch\(|document\.cookie|sessionStorage|indexedDB|innerHTML|publish\(/.test(code));
  ok('settings: the only storage key named in the code is the settings key (plus the old theme key it removes)', [...code.matchAll(/(?:getItem|setItem|removeItem)\((\w+)/g)].every(m => m[1] === 'SETTINGS_KEY' || m[1] === 'OLD_THEME_KEY'));
  ok('settings: the Settings sheet and the Welcome card carry the one-file disclaimer', fs.readFileSync(`${R}/../index.html`, 'utf8').includes('vCGE keeps one small settings file on this device (hand, colors, theme, font, text size, wipe time). Nothing you scan, upload or type is ever saved.')
    && /remembers none of your sensitive data/.test(fs.readFileSync(`${R}/modules/mod01-shell/welcome.js`, 'utf8')) && !fs.existsSync(`${R}/modules/mod01-shell/themeManager.js`));
  localStorage.clear();
}

// MOD02 padlock hand-off: pure frame maths (the drawing itself is checked in the browser suite)
{
  const h = await import(`${R}/modules/mod02-vault/lockHandoff.js`);
  ok('hand-off cycle is 1.25 to 1.5 s, stepped at 24 to 30 fps', h.HANDOFF_MS >= 1250 && h.HANDOFF_MS <= 1500 && h.HANDOFF_FPS >= 24 && h.HANDOFF_FPS <= 30);
  ok('a hand-off is a move between step cards, never from or onto Welcome or at boot', h.isHandoff('read', 'fields') && h.isHandoff('card', 'share') && !h.isHandoff(null, 'capture') && !h.isHandoff('welcome', 'capture') && !h.isHandoff('share', 'welcome') && !h.isHandoff('read', 'read'));
  let max = 0; for (let x = 0; x <= 1; x += 0.0005) max = Math.max(max, h.easeOvershoot(x));
  ok('the shackle lands with a 4 to 6 percent overshoot and settles', h.easeOvershoot(0) === 0 && h.easeOvershoot(1) === 1 && max >= 1.04 && max <= 1.06, max.toFixed(4));
  const start = h.frameAt(0), mid = h.frameAt(0.5), end = h.frameAt(1);
  ok('starts unlocked and orange, invisible', !start.locked && start.colour === 0 && start.opacity === 0 && start.shackle < 0);
  ok('mid-cycle it is locked and green: the shackle is down, the dial has turned', mid.locked && mid.colour === 1 && mid.shackle === 0 && mid.dial > 0 && mid.opacity === 1);
  ok('ends unlocked and orange again, faded out', !end.locked && end.colour === 0 && end.opacity === 0 && end.shackle === start.shackle && end.dial > mid.dial);
  ok('the shackle position changes with the colour, so colour is never the only cue', h.frameAt(0.2).locked === (h.frameAt(0.2).colour > 0) || h.frameAt(0.3).locked);
  ok('frames snap to the grid', h.quantize(0.5) === Math.floor(0.5 * Math.round(h.HANDOFF_MS / 1000 * h.HANDOFF_FPS)) / Math.round(h.HANDOFF_MS / 1000 * h.HANDOFF_FPS) && h.quantize(1) === 1 && h.quantize(0) === 0);
  ok('end state under reduce motion is the open orange lock, shown still', !h.END_STATE.locked && h.END_STATE.colour === 0 && h.END_STATE.opacity === 1);
  ok('orange to green mix', h.mixColour(0) === 'rgb(249, 115, 22)' && h.mixColour(1) === 'rgb(34, 197, 94)');
}

// MOD02 hold-to-wipe: hold timing (the dialog itself is checked in the browser suite)
{
  const w = await import(`${R}/modules/mod02-vault/wipeDialog.js`);
  ok('Yes must be held 1.5 s', w.HOLD_MS === 1500);
  ok('hold progress runs 0 to 1 and clamps', w.holdProgress(0, 1000) === 0 && w.holdProgress(1000, 1000) === 0 && w.holdProgress(1000, 1750) === 0.5 && w.holdProgress(1000, 2500) === 1 && w.holdProgress(1000, 9000) === 1);
  ok('the settings-wipe signal exists and carries no data by name', share.Events.SETTINGS_WIPE_REQUESTED === 'SETTINGS_WIPE_REQUESTED');
}

// MOD05 Fields card (fieldsCard.js): the pop-in timing and the "Insert Fake Contact?" labels
{
  const fc = await import(`${R}/modules/mod05-form/fieldsCard.js`);
  ok('the pop-in is 320 ms stepped at 26 fps (8 steps), like the padlock and the shimmer', fc.POP_MS === 320 && fc.POP_FPS === 26 && fc.POP_STEPS === 8);
  ok('the list prompt and the green button read as raven575 asked (#61: "Sample vCGE pilot contact")', fc.SAMPLE_PROMPT === 'Sample vCGE pilot contact' && fc.DONE_LABEL === "Everything's correct");
  ok('#61: a pilot is listed by name with their animal in front', fc.sampleLabel({ firstName: 'Pidge', lastName: 'the Octopus', organization: 'Team vCGE', logo: 'src/vendor/icons/animals/octopus.svg' }) === '🐙 Pidge the Octopus'
    && fc.sampleLabel({ firstName: 'Iris', lastName: 'the Lynx', logo: 'src/vendor/icons/animals/cat.svg' }) === '🐈 Iris the Lynx'
    && fc.sampleLabel({ firstName: 'Tally', lastName: 'the Hamster', logo: 'src/vendor/icons/animals/hamster.svg' }) === '🐹 Tally the Hamster' && Object.keys(fc.ANIMAL_EMOJI).length === 10);
  const { PRESETS } = await import(`${R}/modules/mod06-gui/card3dView.js`).catch(() => ({ PRESETS: null }));
  ok('#61: every pilot sample has an animal in the list', !PRESETS || PRESETS.every(p => /^\p{Extended_Pictographic} \S+(?: \S+)+$/u.test(fc.sampleLabel(p))), PRESETS && PRESETS.map(fc.sampleLabel).join('|'));
  ok('plain edition: the list reads "Sample contact" and names each person with their company', fc.PLAIN_SAMPLE_PROMPT === 'Sample contact'
    && (await import(`${R}/modules/mod06-gui/card3dView.js`)).PLAIN_PRESETS.map(fc.sampleLabel)[0] === 'Avery Collins, Northwind Design');
  ok('a sample without an animal is listed by name and company, never by its emoji label', fc.sampleLabel({ label: '🤖 AI Research Lead', firstName: 'Elena', lastName: 'Rostova', organization: 'NeuralShift AI' }) === 'Elena Rostova, NeuralShift AI'
    && fc.sampleLabel({ label: '🎨 Solo', firstName: 'Kai' }) === 'Kai' && fc.sampleLabel({ label: ' Plain label ' }) === 'Plain label' && fc.sampleLabel({}) === 'Sample contact');
  // Make it cute (2026-10-21): the "Unknown" tray (F4, video review #53), the pigeonhole tabs (F1), the FILED stamp (F2)
  ok('F4: the tray takes the Ignore lines only, trimmed, each once, in card order', JSON.stringify(fc.unplacedLines([
    { text: 'Jane Doe', role: 'name' }, { text: '  Ask about the  spring promo ', role: 'ignore' }, { text: 'Since 1998', role: 'notes' },
    { text: 'yr. O/ NE', role: 'ignore' }, { text: 'Ask about the spring promo', role: 'ignore' }, { text: '   ', role: 'ignore' }, { text: 'no role' }
  ])) === JSON.stringify(['Ask about the spring promo', 'yr. O/ NE', 'no role']) && fc.unplacedLines(null).length === 0);
  ok('F4: a line filed into an empty box fills it; a filled box gets it added (Notes on a new line)', fc.fileText('', 'Suite 405') === 'Suite 405' && fc.fileText('  ', 'x') === 'x'
    && fc.fileText('4120 Lakeshore Rd ', 'Suite 405') === '4120 Lakeshore Rd Suite 405' && fc.fileText('Met at expo', 'Ask about the spring promo', true) === 'Met at expo\nAsk about the spring promo');
  ok('F1: every vest pocket has a tab (NAME, TITLE, CO., TEL, MAIL, WEB, ADDR, NOTE)', [...new Set(Object.values(fc.SLOT_OF))].sort().join() === 'addr,co,mail,name,note,tel,title,web');
  const fieldsCss = (await import('node:fs')).readFileSync(`${R}/modules/mod05-form/fields.css`, 'utf8');
  ok('F2: the stamp press is 180 ms in the code and the style sheet, and reduce motion turns it off', fc.STAMP_MS === 180 && /\.fields-ok\.is-stamping \.fields-stamp \{ animation: fields-stamp 180ms/.test(fieldsCss)
    && /prefers-reduced-motion: reduce\) \{\s*\.fields-ok\.is-stamping \.fields-stamp \{ animation: none; \}/.test(fieldsCss));
  ok('F1/F2: the plain edition hides the tabs and the stamp', fieldsCss.includes('html[data-edition="plain"] .fields-slot, html[data-edition="plain"] .fields-stamp { display: none; }'));
  ok('the tray titles read as approved', fc.UNKNOWN_TITLE === 'Unknown: tap to file' && /Tap one, then tap the box it belongs in\./.test(fc.UNKNOWN_HELP));
}

// MOD08 Export (Airlock), redesign step 10: file names from the contact, the QR pop-up's choices, the logo through the Vault
{
  const { EgressController, safeFileName, FILE_NAME_MAX } = await import(`${R}/modules/mod08-egress/egressController.js`);
  const { cleanChoices, defaultChoices, previewNote, QR_FRAMES, QR_DOTS } = await import(`${R}/modules/mod08-egress/exportDialogs.js`);
  const { QR_FRAMES: MOD07_FRAMES, QR_DOTS: MOD07_DOTS } = await import(`${R}/modules/mod07-qr/qrGenerator.js`);
  ok('MOD08 safe file names keep spaces and drop what Windows, macOS and Linux forbid', safeFileName('Jane Doe') === 'Jane Doe' && safeFileName(' Smith / Jones: "Co" <*?> |x| ') === 'Smith Jones Co x' && safeFileName('a\u0000b\u001fc') === 'abc');
  ok('MOD08 leading and trailing dots and spaces go; an empty name gives the fallback', safeFileName('.. hidden ..') === 'hidden' && safeFileName('   ') === 'Contact' && safeFileName('///', 'Card') === 'Card');
  ok('MOD08 very long names are cut', safeFileName('x'.repeat(200)).length === FILE_NAME_MAX);
  const e = new EgressController();
  e.setPayload('BEGIN:VCARD', { namePrefix: 'Dr.', firstName: 'Jane', middleName: 'Q.', lastName: 'Doe', nameSuffix: 'PhD', organization: 'Acme' }, { hasDetails: true });
  ok('MOD08 files are named after the full name', e.baseName() === 'Dr. Jane Q. Doe, PhD' && e.fileName('.vcf') === 'Dr. Jane Q. Doe, PhD.vcf' && e.fileName(' QR.png') === 'Dr. Jane Q. Doe, PhD QR.png');
  e.setPayload('BEGIN:VCARD', { organization: 'Smith, Jones & Co', firstName: '  ' }, { hasDetails: true });
  ok('MOD08 without a name the company names the files', e.baseName() === 'Smith, Jones & Co' && e.fileName('.vcf') === 'Smith, Jones & Co.vcf');
  e.setPayload('BEGIN:VCARD', { phones: [{ type: 'work', value: '555' }] }, { hasDetails: true });
  ok('MOD08 with neither, "Contact"', e.baseName() === 'Contact' && e.fileName('.vcf') === 'Contact.vcf' && e.fileName(' QR.png') === 'Contact QR.png');
  e.setPayload('BEGIN:VCARD', { firstName: 'A/B', lastName: 'C:D' }, { hasDetails: true });
  ok('MOD08 a name with path characters still makes a safe file name', e.fileName('.vcf') === 'AB CD.vcf');
  ok('MOD08 the share-sheet File carries the same name', typeof File === 'undefined' || e.vcfFile().name === 'AB CD.vcf');
  // The logo for the card goes through the Vault's logo slot (mod08 writes, mod06 reads), never to the card view.
  const { VaultStore } = await import(`${R}/modules/mod02-vault/vaultStore.js`);
  const store = new VaultStore({ isUserGesture: () => false });
  const seen = []; store.handle('mod06').onChange('logo', (n) => seen.push(n));
  ok('MOD08 no Vault handle: the logo is not offered anywhere', e.offerLogoToCard({ photo: 'data:image/jpeg;base64,AAA', display: 'data:image/png;base64,BBB' }) === false);
  e.setVault(store.handle('mod08'));
  ok('MOD08 "Also use this logo on my card" writes the Vault logo slot; the card view sees the change by slot name only', e.offerLogoToCard({ photo: 'data:image/jpeg;base64,AAA', display: 'data:image/png;base64,BBB' }) === true
    && JSON.stringify(seen) === '[{"slot":"logo"}]' && store.handle('mod06').get('logo').display === 'data:image/png;base64,BBB');
  ok('MOD08 a logo without a photo is refused; the display falls back to the photo', e.offerLogoToCard({ display: 'x' }) === false && e.offerLogoToCard({ photo: 'p' }) === true && store.handle('mod06').get('logo').display === 'p');
  store.clear('logo');
  ok('MOD08 Export still has no standing read of the contact through its handle', (() => { try { store.handle('mod08').get('contact'); return false; } catch (err) { return err.message.startsWith('VAULT_DENIED'); } })());
  // The pop-up's choices: themed, square, no frame, no logo by default; anything unknown falls back
  ok('MOD08 QR pop-up defaults: Themed, square dots, no frame, no logo, not on the card', JSON.stringify(defaultChoices()) === '{"colour":"themed","dots":"square","frame":"none","logo":"none","useOnCard":false}');
  ok('MOD08 QR pop-up: every frame and dot style MOD07 draws is offered', QR_FRAMES.join() === 'none,square,rounded,circle,stripes,checkers,polka' && QR_DOTS.join() === 'square,round,diamond' && QR_FRAMES.join() === MOD07_FRAMES.join() && QR_DOTS.join() === MOD07_DOTS.join());
  const { readyLights, readyLightsText } = await import(`${R}/modules/mod08-egress/airlockTouches.js`);
  ok('MOD08 runway lights: none for an empty card, then a name, a way to reach them and a scannable code', readyLights({}, false).join() === 'false,false,false' && readyLights({ organization: 'B' }, true).join() === 'true,false,true' && readyLights({ firstName: ' ', emails: [{ value: 'a@b.c' }] }, false).join() === 'false,true,false');
  ok('MOD08 runway lights read the same in words', readyLightsText([false, false, false]) === 'Lit: none yet.' && readyLightsText([true, true, true]) === 'Lit: a name, a way to reach them, a scannable QR code.' && readyLightsText([true, false, true]) === 'Lit: a name, a scannable QR code.');
  ok('MOD08 QR pop-up: unknown choices fall back to the defaults, known ones stay', JSON.stringify(cleanChoices({ colour: 'neon', dots: 'round', frame: 'circle', logo: 'upload', useOnCard: 'yes' })) === '{"colour":"themed","dots":"round","frame":"circle","logo":"upload","useOnCard":false}');
  ok('MOD08 QR pop-up note: a code that does not fit, a theme that is not scannable, or nothing to say', /Too much contact data/.test(previewNote({ ok: false, themed: false }, defaultChoices()))
    && /Black & White is used/.test(previewNote({ ok: true, themed: false }, defaultChoices())) && previewNote({ ok: true, themed: true }, defaultChoices()) === '' && previewNote({ ok: true, themed: false }, { ...defaultChoices(), colour: 'bw' }) === '');
}

// MOD08 Export, video review 2026-10-17 (#76, #77, #98, Commandment 6): folded .vcf files, the share sheet, the readable summary, signal-only audit events
{
  const { EgressController, withoutPhoto } = await import(`${R}/modules/mod08-egress/egressController.js`);
  const { foldVCardLines, VCARD_LINE_OCTETS } = await import(`${R}/share/vcardFormatter.js`);
  const octets = (l) => new TextEncoder().encode(l).length;
  const unfold = (t) => t.replace(/\r\n[ \t]/g, '');
  ok('vCard folding: short lines stay as they are and the file ends with CRLF', foldVCardLines('BEGIN:VCARD\r\nFN:A\r\nEND:VCARD') === 'BEGIN:VCARD\r\nFN:A\r\nEND:VCARD\r\n');
  const photo = share.formatVCard({ firstName: 'A', lastName: 'B', avatarBase64: `data:image/jpeg;base64,/9j/${'Q'.repeat(5000)}` });
  const folded = foldVCardLines(photo);
  ok('vCard folding: no line is longer than 75 octets (RFC 2425 §5.8.1), continuations start with a space', folded.split('\r\n').every(l => octets(l) <= VCARD_LINE_OCTETS) && folded.split('\r\n').filter(l => l.startsWith(' ')).length > 60, String(Math.max(...folded.split('\r\n').map(octets))));
  ok('vCard folding: unfolding gives back the vCard exactly', unfold(folded) === `${photo}\r\n`);
  const accents = foldVCardLines(`NOTE:${'é'.repeat(100)}`);
  ok('vCard folding never splits a UTF-8 character', accents.split('\r\n').every(l => octets(l) <= VCARD_LINE_OCTETS && !l.includes('�')) && unfold(accents) === `NOTE:${'é'.repeat(100)}\r\n`);
  ok('vCard folding: folding twice changes nothing', foldVCardLines(folded) === folded);
  ok('the QR text (formatVCard) stays unfolded', !share.formatVCard({ firstName: 'A', lastName: 'B', notes: 'x'.repeat(200) }).includes('\r\n '));

  const contact = { firstName: 'Nick', lastName: 'Zafer', jobTitle: 'Owner & General Manager', organization: 'TeamLogicIT',
    phones: [{ type: 'work', value: '+1 (269) 492-7400' }, { type: 'mobile', value: '+1 (269) 254-5403' }, { type: 'workFax', value: '555' }],
    emails: [{ type: 'work', value: 'nzafer@TeamLogicIT.com' }], websites: [{ type: 'work', value: 'TeamLogicIT.com/KalamazooMI' }, { type: 'linkedin', value: 'linkedin.com/in/nz' }],
    addressType: 'work', street: '7950 Moorsbridge Road', unitType: 'Suite', unitNumber: '405', city: 'Portage', state: 'MI', zip: '49024', country: 'United States' };
  const e = new EgressController();
  e.setPayload(share.formatVCard(contact), contact, { hasDetails: true, qrReal: true });
  ok('MOD08 the payload is the folded vCard', e.currentVCard === foldVCardLines(share.formatVCard(contact)) && e.currentVCard.endsWith('END:VCARD\r\n'));
  ok('MOD08 summary: name, title and company on their own lines, labelled details, two spaces after each colon (#98)', e.contactSummary() === [
    'Nick Zafer', 'Owner & General Manager', 'TeamLogicIT', 'Work phone:  +1 (269) 492-7400', 'Mobile phone:  +1 (269) 254-5403', 'Work fax:  555',
    'Work email:  nzafer@TeamLogicIT.com', 'Work website:  TeamLogicIT.com/KalamazooMI', 'LinkedIn:  linkedin.com/in/nz',
    'Work address:  7950 Moorsbridge Road, Suite 405, Portage, MI 49024, United States'].join('\n'), JSON.stringify(e.contactSummary()));
  const withLogo = new EgressController();
  withLogo.setPayload(share.formatVCard({ ...contact, avatarBase64: `data:image/jpeg;base64,/9j/${'Q'.repeat(10000)}` }), contact, { hasDetails: true, qrReal: true });
  const mailBody = decodeURIComponent(withLogo.mailtoUrl().split('&body=')[1]);
  ok('MOD08 email: the .vcf keeps the logo, the email body leaves the PHOTO out and stays short (Android drops long mailto: links)',
    withLogo.currentVCard.includes('PHOTO') && !mailBody.includes('PHOTO') && !mailBody.includes('QQQQ') && mailBody.includes('BEGIN:VCARD') && mailBody.includes('END:VCARD')
      && mailBody.includes('TEL;TYPE=WORK') && withLogo.mailtoUrl().length < 2000, String(withLogo.mailtoUrl().length));
  ok('MOD08 email: without a logo the vCard text is unchanged', withoutPhoto(e.currentVCard) === e.currentVCard);
  const homeOnly = new EgressController();
  homeOnly.setPayload('BEGIN:VCARD', { firstName: 'Kai', addressType: 'other', city: 'Boise', websites: [{ type: 'other', value: 'kai.dev' }] }, { hasDetails: true });
  ok('MOD08 summary: an "Other" website and address read "Website" and "Address"', homeOnly.contactSummary() === 'Kai\nWebsite:  kai.dev\nAddress:  Boise', JSON.stringify(homeOnly.contactSummary()));

  // The share sheet and the audit events, with a stand-in navigator
  const realNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const setNavigator = (nav) => Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true, writable: true });
  const events = [];
  const off = share.globalEventBus.subscribe(share.Events.EXPORT_DISPATCHED, (d) => events.push(d));
  const shared = [];
  setNavigator({ share: async (data) => { shared.push(data); }, canShare: () => true, clipboard: { writeText: async () => {} } });
  const fileShare = await e.triggerQuickShare();
  ok('MOD08 file share (iOS): the .vcf goes alone, no text that arrives as a stray ".txt" file (#77)', fileShare.method === 'native_file' && shared[0].files.length === 1 && shared[0].files[0].name === 'Nick Zafer.vcf' && !('text' in shared[0]), JSON.stringify(Object.keys(shared[0])));
  ok('MOD08 the shared .vcf holds the folded vCard', await shared[0].files[0].text() === e.currentVCard);
  setNavigator({ share: async (data) => { shared.push(data); }, canShare: () => false, clipboard: { writeText: async () => {} } });
  const textShare = await e.triggerQuickShare();
  ok('MOD08 no file sharing (Android Chrome): the readable summary goes as text, never the raw vCard (#76)', textShare.method === 'native_text' && shared[1].text === e.contactSummary() && !shared[1].text.includes('BEGIN:VCARD') && shared[1].title === 'Contact: Nick Zafer', JSON.stringify(shared[1]).slice(0, 120));
  await e.copyVCard();
  e.navigate = () => {};
  e.triggerSmsShare();
  await e.triggerEmailShare();
  if (realNavigator) Object.defineProperty(globalThis, 'navigator', realNavigator); else delete globalThis.navigator;
  off();
  const methods = events.map(d => d.method).join();
  const leaks = ['Nick', 'Zafer', 'TeamLogic', '269', 'nzafer', 'Moorsbridge', '.vcf', '.png'];
  const { printPageHeight, PRINT_PAGE_IN } = await import(`${R}/modules/mod08-egress/egressController.js`);
  ok('MOD08 print page: 3.5 in for a sheet that fits, taller (rounded up to 0.01 in) for a card that grows', PRINT_PAGE_IN.height === 3.5 && printPageHeight(278) === 3.5 && printPageHeight(0) === 3.5
    && printPageHeight(450) === 5.29 && printPageHeight(451) === 5.3, [printPageHeight(278), printPageHeight(450), printPageHeight(451)].join());
  ok('MOD08 audit events name what happened: share_file, share_text, clipboard, sms, email', methods === 'share_file,share_text,clipboard,sms,email', methods);
  ok('MOD08 audit events carry signals only: no file name, name, number or address (Commandment 6)', events.every(d => Object.keys(d).every(k => ['module', 'method', 'timestamp', 'themed'].includes(k)))
    // the timestamp is left out of the search: its digits are never contact data, and "269" turned up in one now and then
    && !leaks.some(w => JSON.stringify(events.map(({ timestamp, ...signal }) => signal)).includes(w)), JSON.stringify(events));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
