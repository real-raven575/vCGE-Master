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
  const { VaultStore, SLOTS, MODULE_RIGHTS } = await import(`${R}/modules/mod02-vault/vaultStore.js`);
  const before = JSON.stringify(localStorage);
  let gesture = false;
  const s = new VaultStore({ isUserGesture: () => gesture });
  ok('vault store has the pipeline slots and starts empty', SLOTS.join() === 'photo,ocr,review,contact,lastScan,undo,logo' && s.isEmpty() && s.state() === 'open');
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
  let unknownModule = false; try { s.handle('mod99'); } catch (e) { unknownModule = e.message.startsWith('VAULT_UNKNOWN_MODULE'); }
  ok('unknown modules get no handle', unknownModule);
  ok('every module right names a real slot', Object.values(MODULE_RIGHTS).every(r => [...r.read, ...r.write, ...(r.share || [])].every(x => SLOTS.includes(x))));

  // Lock behind the session PIN, unlock, wipe
  ok('lock without a PIN is refused and keeps the card', s.lock() === false && s.get('contact').firstName === 'Jane');
  await s.setPin('2468');
  const states = []; s.onStateChange(e => states.push(e.state));
  ok('lock seals every slot and empties them', s.lock() === true && s.state() === 'locked' && s.get('contact') === null && s.get('photo') === null && !s.isEmpty());
  ok('nothing goes in while locked', s.put('contact', { firstName: 'X' }) === false);
  await s.locking;
  ok('the held copy is ciphertext', s.vault.isHolding() && !new TextDecoder().decode(s.vault.sealed.ciphertext).includes('Jane'));
  const wrong = await s.unlock('0000');
  ok('wrong PIN keeps it locked', wrong.result === 'wrong' && s.state() === 'locked');
  const right = await s.unlock('2468');
  ok('right PIN puts every slot back', right.result === 'ok' && s.state() === 'open' && s.get('contact').firstName === 'Jane' && ocrH.get('photo').endsWith('AAA') && !s.vault.isHolding());
  s.lock(); await s.locking;
  for (let i = 0; i < 5; i++) await s.unlock('9999');
  ok('5 wrong PINs wipe the card and the PIN', s.state() === 'open' && s.isEmpty() && !s.hasPin() && !s.vault.isHolding());
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
  s.put('review', { lines: [] }); s.wipe('test');
  ok('wipe empties every slot and forgets the PIN', s.isEmpty() && !s.hasPin() && states.at(-1) === 'wiped');
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
  ok('classifyLines roles for a labelled card', JSON.stringify(lines.map(l => l.role)) === JSON.stringify(['ignore', 'ignore', 'name', 'jobTitle', 'street', 'cityStateZip', 'email', 'phoneWork', 'phoneMobile', 'website']), lines.map(l => l.role).join());
  // A real phone photo's misreads (fictional details): "I" read as "\" in the domain, the "/" of the web path read as a
  // space, lowercase "w" label, slogan with a company word ("Technology") and no readable company name (logo only).
  const slips = fm.classifyLines('2OO brightpathlogo\nYour Technology Partner\nDana Whitlock\nOwner & General Manager\n4120 Lakeshore Road, Suite 210\nSpringfield, MI 49011\nE dwhitlock@BrightPath\\T.com\nT 616.555.0142\nM 616.555.0187\nw BrightPath\\T.com Holland');
  ok('misread card: roles (slogan ignored, email and website found, phone types in the picker)', JSON.stringify(slips.map(l => l.role)) === JSON.stringify(['ignore', 'ignore', 'name', 'jobTitle', 'street', 'cityStateZip', 'email', 'phoneWork', 'phoneMobile', 'website']), slips.map(l => l.role).join());
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
  const render = (W, H, bg, card, text = true) => {
    const data = new Uint8ClampedArray(W * H * 4), inv = invert(m);
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
  ok('convex hull drops inner points and keeps the corners', convexHull([[0, 0], [10, 0], [10, 10], [0, 10], [5, 5], [2, 3]]).length === 4);
  ok('corners are ordered top-left, top-right, bottom-right, bottom-left', orderCorners([{ x: 9, y: 9 }, { x: 0, y: 10 }, { x: 10, y: 0 }, { x: 1, y: 1 }]).map(p => `${p.x},${p.y}`).join(' ') === '1,1 10,0 9,9 0,10');
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
  const { createEmptyContact } = await import(`${R}/share/cardSchema.js`);
  ok('MOD07 empty card has no details (default country and address type do not count)', q.hasDetails(createEmptyContact()) === false);
  ok('MOD07 a name, company, phone or city counts as details', [{ firstName: 'A' }, { organization: 'B' }, { phones: [{ type: 'work', value: '555' }] }, { city: 'Boise' }].every(c => q.hasDetails(c)));
  ok('MOD07 blank rows and spaces do not count', q.hasDetails({ firstName: '  ', phones: [{ type: 'work', value: '' }] }) === false);
  const blank = makeCanvas();
  q.renderPlaceholder(blank, 320);
  const px = (x, y) => blank._px[(y * blank.width + x) * 4];
  ok('MOD07 placeholder is a white square on a black square', blank.width === 320 && px(5, 5) === 0 && px(160, 160) === 255 && px(314, 314) === 0);
  ok('MOD07 placeholder never decodes as a QR code', jsQR(blank._px, blank.width, blank.height) === null);
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
  ok('failed OCR publishes nothing to the form pipeline', evt === null);

  let created = 0, terminated = 0, psm = null, params = null, result = null, hold = false;
  const words = (n, conf) => Array.from({ length: n }, (_, i) => ({ text: `word${i}`, confidence: conf }));
  globalThis.Tesseract = { createWorker: async () => { created++; return {
    setParameters: async (p) => { params = p; psm = p.tessedit_pageseg_mode; },
    recognize: async () => (hold ? new Promise(() => {}) : { data: result }), terminate() { terminated++; } }; } };
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
  ok('deck: a sideways swipe of 80 px closes a sheet; 48 px edge kept for the browser back gesture', deck.SWIPE_PX === 80 && deck.EDGE_PX === 48);
  const deckCode = fs.readFileSync(`${R}/modules/mod01-shell/deck.js`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  ok('deck: stores nothing, imports only the bus, and publishes only CARD_CHANGED', !/localStorage|sessionStorage|indexedDB|document\.cookie|innerHTML|fetch\(/.test(deckCode)
    && (deckCode.match(/^import .* from '([^']+)'/gm) || []).every(l => l.includes('share/eventBus.js')) && (deckCode.match(/publish\(Events\.(\w+)/g) || []).every(m => m === 'publish(Events.CARD_CHANGED'));
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
  const icons = ['aperture', 'radar-2', 'lock', 'forms', 'id', 'qrcode', 'send', 'settings', 'trash', 'camera', 'upload', 'circle-check'];
  ok('ui: the twelve app icons are bundled as SVG with the Tabler MIT licence', icons.every(n => fs.readFileSync(`${R}/vendor/icons/app/${n}.svg`, 'utf8').includes('<svg')) && /MIT License/.test(fs.readFileSync(`${R}/vendor/icons/app/LICENSE-tabler.txt`, 'utf8')));
  ok('ui: icon stroke 2.3 and buttons at least 44 px with a 2 px outline', /--vcge-icon-stroke:\s*2\.3;/.test(css) && /--vcge-tap:\s*2\.75rem;/.test(css) && /border-width:\s*2px/.test(css));
  ok('ui: no font or icon comes from a host (only bundled files)', !/https?:/.test(css.replace(/\/\*[\s\S]*?\*\//g, '')));
}

// MOD01 saved settings (settings.js): the one localStorage entry, `name=number` pairs, preferences only
{
  const fs = await import('node:fs');
  const st = await import(`${R}/modules/mod01-shell/settings.js`);
  const ui = await import(`${R}/modules/mod01-shell/ui.js`);
  localStorage.clear();
  ok('settings: one key, defaults right hand, colour-blind off, dark theme, Inter', st.SETTINGS_KEY === 'vcge_settings' && JSON.stringify(st.DEFAULTS) === '{"hand":0,"cb":0,"theme":0,"font":0}' && st.fontFor(0) === 'Inter');
  ok('settings: every Settings font has its own fixed code, Inter 0, no code shared', ui.UI_FONTS.every(n => Number.isInteger(st.FONT_CODES[n])) && new Set(Object.values(st.FONT_CODES)).size === ui.UI_FONTS.length && Object.keys(st.FONT_CODES).length === ui.UI_FONTS.length);
  ok('settings: a line of name=number pairs reads back', JSON.stringify(st.parseSettings('hand=1;cb=1;theme=1;font=3')) === '{"hand":1,"cb":1,"theme":1,"font":3}');
  ok('settings: missing or unreadable means the defaults', JSON.stringify(st.parseSettings(null)) === JSON.stringify(st.DEFAULTS) && JSON.stringify(st.parseSettings('garbage')) === JSON.stringify(st.DEFAULTS) && JSON.stringify(st.parseSettings('')) === JSON.stringify(st.DEFAULTS));
  ok('settings: an unknown name, an out-of-range or non-numeric value falls back to its default, the rest is kept', JSON.stringify(st.parseSettings('hand=1;name=Maria;cb=7;theme=x;font=99')) === '{"hand":1,"cb":0,"theme":0,"font":0}');
  ok('settings: serialises every name in a fixed order and clamps', st.serializeSettings({ font: 2, hand: 1 }) === 'hand=1;cb=0;theme=0;font=2' && st.serializeSettings({ cb: 5 }) === 'hand=0;cb=0;theme=0;font=0');
  st.saveSettings({ hand: 1, font: 2 });
  ok('settings: save writes the one key and nothing else', localStorage.getItem('vcge_settings') === 'hand=1;cb=0;theme=0;font=2' && store.size === 1);
  ok('settings: load reads it back', JSON.stringify(st.loadSettings()) === '{"hand":1,"cb":0,"theme":0,"font":2}');
  st.clearSettings();
  ok('settings: clear removes it', store.size === 0 && JSON.stringify(st.loadSettings()) === JSON.stringify(st.DEFAULTS));
  localStorage.setItem('vcge_theme_preference', 'light');
  ok('settings: the old theme key is carried over once and removed', JSON.stringify(st.loadSettings()) === '{"hand":0,"cb":0,"theme":1,"font":0}' && localStorage.getItem('vcge_theme_preference') === null && store.size === 0);
  const code = fs.readFileSync(`${R}/modules/mod01-shell/settings.js`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  ok('settings: subscribes to SETTINGS_WIPE_REQUESTED, imports only the bus and ui.js, no network, cookies or markup', /subscribe\(Events\.SETTINGS_WIPE_REQUESTED/.test(code)
    && (code.match(/^import .* from '([^']+)'/gm) || []).every(l => l.includes('share/eventBus.js') || l.includes("'./ui.js'")) && !/fetch\(|document\.cookie|sessionStorage|indexedDB|innerHTML|publish\(/.test(code));
  ok('settings: the only storage key named in the code is the settings key (plus the old theme key it removes)', [...code.matchAll(/(?:getItem|setItem|removeItem)\((\w+)/g)].every(m => m[1] === 'SETTINGS_KEY' || m[1] === 'OLD_THEME_KEY'));
  ok('settings: the Settings sheet and the Welcome card carry the one-file disclaimer', fs.readFileSync(`${R}/../index.html`, 'utf8').includes('vCGE keeps one small settings file on this device (hand, colors, theme, font). Nothing you scan, upload or type is ever saved.')
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
