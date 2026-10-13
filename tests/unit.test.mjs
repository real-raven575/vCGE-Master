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

  // Keychain-bound vault (Tauri): passphrase + OS keychain device key via HKDF
  const { KDF_KEYCHAIN, KDF_PASSPHRASE } = await import(`${R}/modules/mod02-vault/vault.js`);
  const device = crypto.getRandomValues(new Uint8Array(32));
  const k1 = new SecureStorageVault('kc');
  ok('keychain vault initializes with device key', (await k1.initialize('pw-123456', device)).kdf === KDF_KEYCHAIN);
  await k1.encryptAndStore({ name: 'Bound' });
  ok('keychain vault records its KDF', JSON.parse(localStorage.getItem('kc')).kdf === KDF_KEYCHAIN && k1.requiresDeviceKey());
  const k2 = new SecureStorageVault('kc');
  ok('keychain vault refuses to open without the device key', (await k2.initialize('pw-123456')).error === 'ERR_KEYCHAIN_REQUIRED' && !k2.isUnlocked);
  const k3 = new SecureStorageVault('kc'); await k3.initialize('pw-123456', crypto.getRandomValues(new Uint8Array(32)));
  let otherDevice = null; console.error = () => {};
  try { await k3.retrieveAndDecrypt(); otherDevice = 'OPENED'; } catch (e) { otherDevice = e.message; }
  console.error = origErr;
  ok('keychain vault cannot be opened with another device key', otherDevice === 'ERR_VAULT_DECRYPT_FAIL', otherDevice);
  const k4 = new SecureStorageVault('kc'); await k4.initialize('pw-123456', device);
  ok('keychain vault opens with passphrase + same device key', (await k4.retrieveAndDecrypt()).name === 'Bound');
  ok('vault key is not extractable', k4.masterKey.extractable === false);

  // Backward compatibility: a passphrase-only blob written by the previous derivation (deriveKey, no kdf field)
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode('legacy-pass'), { name: 'PBKDF2' }, false, ['deriveKey']);
  const oldKey = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, oldKey, new TextEncoder().encode(JSON.stringify({ name: 'Legacy' })));
  localStorage.setItem('legacy', JSON.stringify({ iv: Array.from(iv), salt: Array.from(salt), ciphertext: Array.from(new Uint8Array(ct)) }));
  const lv = new SecureStorageVault('legacy');
  ok('legacy vault (no kdf field) still opens', (await lv.initialize('legacy-pass')).kdf === KDF_PASSPHRASE && (await lv.retrieveAndDecrypt()).name === 'Legacy');
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
  ok('classifyLines roles for a labelled card', JSON.stringify(lines.map(l => l.role)) === JSON.stringify(['ignore', 'ignore', 'name', 'jobTitle', 'street', 'cityStateZip', 'email', 'phone', 'phone', 'website']), lines.map(l => l.role).join());
  const built = fm.buildFields(lines);
  ok('buildFields equals parseOCRText', JSON.stringify(built.fields) === JSON.stringify(fm.parseOCRText(text)));
  ok('company derived from the web address is marked as derived', built.fields.organization === 'BrightPathIT' && built.derived.organization === 'web address', JSON.stringify(built.derived));
  const asCompany = lines.map(l => l.text === 'Your Technology Partner' ? { ...l, role: 'organization' } : l);
  const overridden = fm.buildFields(asCompany);
  ok('choosing a line as Company overrides the derived company', overridden.fields.organization === 'Your Technology Partner' && !overridden.derived.organization);
  const edited = fm.buildFields(lines.map(l => l.role === 'email' ? { ...l, text: 'E dana@brightpathit.com' } : l));
  ok('edited line text is used', edited.fields.emails[0].value === 'dana@brightpathit.com', JSON.stringify(edited.fields.emails));
  const swapped = fm.buildFields(lines.map(l => l.text.startsWith('M ') ? { ...l, role: 'phoneWork' } : l.text.startsWith('T ') ? { ...l, role: 'phoneMobile' } : l));
  const ph = (type) => (swapped.fields.phones.find(p => p.type === type) || {}).value;
  ok('explicit Work/Mobile phone roles win over labels', ph('work') === '+1 (616) 555-0187' && ph('mobile') === '+1 (616) 555-0142', JSON.stringify(swapped.fields.phones));
  const noted = fm.buildFields([{ text: 'Call after 3pm', role: 'notes' }, { text: 'Gate code 42', role: 'notes' }, { text: 'junk', role: 'ignore' }]);
  ok('notes lines are kept in order; ignored lines are dropped', noted.fields.notes === 'Call after 3pm\nGate code 42' && !Object.values(noted.fields).includes('junk'));
  const whole = fm.buildFields([{ text: '88 Elm Avenue, Burlington, VT 05401', role: 'address' }]);
  ok('Whole address role splits street and City/State/ZIP', whole.fields.street === '88 Elm Avenue' && whole.fields.city === 'Burlington' && whole.fields.zip === '05401');
  ok('no name line means no invented name', fm.parseOCRText('+1 (555) 201-3344').firstName === '');
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

// OCR worker (ESM): returns raw text, publishes on the shared bus, and fails loudly (never with made-up text)
{
  globalThis.document = { baseURI: 'http://localhost/', createElement: () => ({ getContext: () => ({ drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray(4) }), putImageData() {} }), toDataURL: () => 'data:image/png;base64,' }) };
  globalThis.Image = class { set src(v) { this.width = 10; this.height = 10; setTimeout(() => this.onload(), 0); } };
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

  let created = 0, psm = null, result = null;
  const words = (n, conf) => Array.from({ length: n }, (_, i) => ({ text: `word${i}`, confidence: conf }));
  globalThis.Tesseract = { createWorker: async () => { created++; return {
    setParameters: async (p) => { psm = p.tessedit_pageseg_mode; }, recognize: async () => ({ data: result }), terminate() {} }; } };
  result = { text: 'Jane Doe\njane@example.com', confidence: 88, words: words(8, 90) };
  const r = await ocr.executeOCRScan('data:image/png;base64,x');
  ok('OCR returns raw text and confidence, publishes OCR_TEXT_EXTRACTED', r.text === 'Jane Doe\njane@example.com' && r.confidence === 88 && evt && evt.text === r.text && !('simulated' in r));
  ok('OCR uses sparse-text page segmentation', psm === ocr.OCR_PAGE_SEG_MODE && psm === '11', String(psm));
  evt = null;
  result = { text: 'py A Year op WW es', confidence: 46, words: words(12, 70) };
  const blurry = await failure(ocr.executeOCRScan('data:image/png;base64,x'));
  ok('low-confidence photo rejected as unreadable (retake)', blurry && blurry.code === 'OCR_UNREADABLE' && blurry.confidence === 46 && evt === null, blurry && blurry.message);
  result = { text: 'Jo', confidence: 80, words: words(3, 90) };
  const sparse = await failure(ocr.executeOCRScan('data:image/png;base64,x'));
  ok('photo with too few readable words rejected as unreadable', sparse && sparse.code === 'OCR_UNREADABLE' && sparse.readableWords === 3, sparse && sparse.message);
  ok('OCR worker is started once and reused after a failure', created === 1, String(created));
  ok('OCR no longer exposes a duplicate parser', !('parseExtractedTextToSchema' in ocr));
  console.log = origLog; console.error = origErr; delete globalThis.Tesseract;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
