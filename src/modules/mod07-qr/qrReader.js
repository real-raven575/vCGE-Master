/**
 * vCGE (vCard Generator Engine) - MOD07 QR: reading a QR code printed on a card (`qrReader.js`)
 * Copyright (c) 2026 raven575, Herd of Helpers (claude) & gemini
 * Repository: https://github.com/real-raven575/vCGE-Master
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Accuracy round 1 (raven575's yes, 2026-11-10): many cards carry a QR code with a vCard, a MECARD or a web address.
 * When the photo shows one, its data is exact, so it fills the fields it has and the lines the reader read for the same
 * fields are set to Ignore with a note. Decoding uses the bundled jsQR (src/vendor/jsqr, Apache-2.0) on the device;
 * nothing is fetched. The decoded text is contact data: it stays in memory with the readings and is never logged.
 */

// The photo is scaled down to this longer side before decoding: a card's QR stays well over 100 px, and a phone photo
// of 12 MP would take far longer to search.
export const QR_READ_MAX_SIDE = 1400;

export const QR_DUPLICATE_NOTE = 'The QR code on the card already gave this, so this line is set to Ignore.';

const TYPE_ROLE = [[/\b(?:cell|mobile|iphone)\b/i, 'phoneMobile'], [/\bfax\b/i, 'phoneFax'], [/\bhome\b/i, 'phoneHome']];

const ADDRESS_ROLES = new Set(['street', 'unit', 'cityStateZip', 'address']);

/** A vCard text value with its escapes undone (\n, \, \; \: \\). */
function unescapeVCard(value) {
    return String(value || '').replace(/\\([nN,;:\\])/g, (_, c) => (c === 'n' || c === 'N' ? ' ' : c)).replace(/\s+/g, ' ').trim();
}

/** `value` split at unescaped `sep` (vCard ; and , or MECARD ; and ,), each part unescaped. */
function splitUnescaped(value, sep) {
    const parts = [];
    let cur = '';
    for (let i = 0; i < value.length; i++) {
        const c = value[i];
        if (c === '\\' && i + 1 < value.length) { cur += c + value[i + 1]; i++; continue; }
        if (c === sep) { parts.push(cur); cur = ''; continue; }
        cur += c;
    }
    parts.push(cur);
    return parts.map(unescapeVCard);
}

function emptyContact() {
    return { name: '', jobTitle: '', organization: '', phones: [], emails: [], websites: [], street: '', cityStateZip: '', address: '' };
}

function setAddress(out, { street, city, region, zip, country }) {
    if (out.street || out.address) return;
    if (city && region && zip && (!country || /^(?:us|usa|united states|canada|ca)$/i.test(country))) {
        out.street = street;
        out.cityStateZip = `${city}, ${region} ${zip}`;
    } else {
        out.address = [street, city, [region, zip].filter(Boolean).join(' '), country].filter(Boolean).join(', ');
    }
}

function parseVCard(text) {
    // Folded lines (a line starting with a space or tab continues the one before) are joined first.
    const lines = text.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
    const out = emptyContact();
    let structured = '';
    for (const raw of lines) {
        const at = raw.indexOf(':');
        if (at < 0) continue;
        const head = raw.slice(0, at), value = raw.slice(at + 1);
        const [nameWithGroup, ...params] = head.split(';');
        const key = nameWithGroup.replace(/^[^.]*\./, '').toUpperCase();
        const types = params.join(';');
        if (key === 'FN') out.name = out.name || unescapeVCard(value);
        else if (key === 'N') structured = structured || value;
        else if (key === 'ORG') out.organization = out.organization || splitUnescaped(value, ';').filter(Boolean)[0] || '';
        else if (key === 'TITLE') out.jobTitle = out.jobTitle || unescapeVCard(value);
        else if (key === 'TEL') {
            const number = unescapeVCard(value).replace(/^tel:/i, '');
            if (number) out.phones.push({ role: (TYPE_ROLE.find(([re]) => re.test(types)) || [, 'phoneWork'])[1], value: number });
        } else if (key === 'EMAIL') { const e = unescapeVCard(value).replace(/^mailto:/i, ''); if (e) out.emails.push(e); }
        else if (key === 'URL') { const u = unescapeVCard(value); if (u) out.websites.push(u); }
        else if (key === 'ADR') {
            const [, , street, city, region, zip, country] = splitUnescaped(value, ';');
            setAddress(out, { street, city, region, zip, country });
        }
    }
    if (!out.name && structured) {
        const [last, first, middle, prefix, suffix] = splitUnescaped(structured, ';');
        out.name = [prefix, first, middle, last, suffix].filter(Boolean).join(' ');
    }
    return out;
}

function parseMeCard(text) {
    const out = emptyContact();
    for (const field of splitUnescapedRaw(text.replace(/^MECARD:/i, ''), ';')) {
        const at = field.indexOf(':');
        if (at < 0) continue;
        const key = field.slice(0, at).toUpperCase(), value = field.slice(at + 1);
        if (key === 'N') {
            const [last, first] = splitUnescaped(value, ',');
            out.name = out.name || [first, last].filter(Boolean).join(' ');
        } else if (key === 'TEL') { const v = unescapeVCard(value); if (v) out.phones.push({ role: 'phoneWork', value: v }); }
        else if (key === 'EMAIL') { const v = unescapeVCard(value); if (v) out.emails.push(v); }
        else if (key === 'URL') { const v = unescapeVCard(value); if (v) out.websites.push(v); }
        else if (key === 'ORG') out.organization = out.organization || unescapeVCard(value);
        else if (key === 'TITLE') out.jobTitle = out.jobTitle || unescapeVCard(value);
        else if (key === 'ADR') {
            // MECARD ADR is po box, extended, street, city, region, zip, country, comma separated.
            const parts = splitUnescaped(value, ',');
            if (parts.length >= 7) setAddress(out, { street: parts[2], city: parts[3], region: parts[4], zip: parts[5], country: parts[6] });
            else out.address = out.address || unescapeVCard(value);
        }
    }
    return out;
}

// MECARD fields split at unescaped ";" with their escapes kept (each field's value is unescaped on its own).
function splitUnescapedRaw(value, sep) {
    const parts = [];
    let cur = '';
    for (let i = 0; i < value.length; i++) {
        const c = value[i];
        if (c === '\\' && i + 1 < value.length) { cur += c + value[i + 1]; i++; continue; }
        if (c === sep) { parts.push(cur); cur = ''; continue; }
        cur += c;
    }
    parts.push(cur);
    return parts.filter(Boolean);
}

const hasAny = (c) => !!(c.name || c.jobTitle || c.organization || c.phones.length || c.emails.length || c.websites.length || c.street || c.cityStateZip || c.address);

/**
 * The contact a QR code's text holds: a vCard (BEGIN:VCARD), a MECARD, or a bare web address (http, https or www).
 * Null for anything else (plain text, wifi, payments...) or a code with no usable field.
 */
export function parseQrPayload(text) {
    const t = String(text || '').trim();
    if (!t) return null;
    let contact = null;
    if (/^BEGIN:VCARD/i.test(t)) contact = parseVCard(t);
    else if (/^MECARD:/i.test(t)) contact = parseMeCard(t);
    else if (/^(?:https?:\/\/|www\.)\S+$/i.test(t)) contact = { ...emptyContact(), websites: [t] };
    return contact && hasAny(contact) ? contact : null;
}

/** Review lines for a parsed QR contact, with their roles already set (they come first, so they win every field). */
export function qrLines(contact) {
    if (!contact) return [];
    const line = (text, role) => ({ text, role, icon: null, qr: true });
    return [
        ...(contact.name ? [line(contact.name, 'name')] : []),
        ...(contact.jobTitle ? [line(contact.jobTitle, 'jobTitle')] : []),
        ...(contact.organization ? [line(contact.organization, 'organization')] : []),
        ...contact.phones.map(p => line(p.value, p.role)),
        ...contact.emails.map(e => line(e, 'email')),
        ...contact.websites.map(w => line(w, 'website')),
        ...(contact.street ? [line(contact.street, 'street')] : []),
        ...(contact.cityStateZip ? [line(contact.cityStateZip, 'cityStateZip')] : []),
        ...(contact.address ? [line(contact.address, 'address')] : [])
    ];
}

const digitsOf = (text) => String(text || '').replace(/\D/g, '').slice(-10);
const plainSite = (text) => String(text || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
// The part of a line after a label ("T ", "E: ", "Mobile ") for comparing values.
const bodyOf = (text) => String(text || '').replace(/^(?:[a-z]{1,6}\.?\s*[:.-]?\s+)(?=[\d+(@a-z])/i, '').trim();

/**
 * The review lines with the QR code's lines first: reader lines for a field the QR code gave once (name, title,
 * company, address) or for the same phone, email or web address are set to Ignore with QR_DUPLICATE_NOTE. Other reader
 * lines (a second phone, a tagline) stay as they were.
 */
export function withQrLines(lines, contact) {
    const fromQr = qrLines(contact);
    if (!fromQr.length) return lines;
    const single = new Set(fromQr.map(l => l.role).filter(r => ['name', 'jobTitle', 'organization'].includes(r)));
    const hasAddress = fromQr.some(l => ADDRESS_ROLES.has(l.role));
    const phones = new Set(contact.phones.map(p => digitsOf(p.value)));
    const emails = new Set(contact.emails.map(e => e.toLowerCase()));
    const sites = new Set(contact.websites.map(plainSite));
    const same = (line) => {
        const role = line.role || '';
        if (single.has(role) || (hasAddress && ADDRESS_ROLES.has(role))) return true;
        if (/^phone/.test(role)) return phones.has(digitsOf(line.text));
        if (role === 'email') return emails.has(bodyOf(line.text).toLowerCase());
        if (role === 'website') return sites.has(plainSite(bodyOf(line.text)));
        return false;
    };
    return [...fromQr, ...lines.map(l => (same(l) ? { ...l, role: 'ignore', check: QR_DUPLICATE_NOTE } : l))];
}

/**
 * The text of a QR code in a photo (a data URL), or null when there is none, the decoder is missing or anything fails.
 * Never throws: a card without a QR code is the usual case.
 */
export async function readCardQr(dataUrl, decode = (typeof window !== 'undefined' ? window.jsQR : null)) {
    if (!dataUrl || typeof decode !== 'function') return null;
    try {
        const img = new Image();
        img.src = dataUrl;
        await img.decode();
        const scale = Math.min(1, QR_READ_MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * scale)), h = Math.max(1, Math.round(img.naturalHeight * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, w, h);
        const found = decode(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'attemptBoth' });
        return found && found.data ? found.data : null;
    } catch (e) {
        console.warn('[vCGE-MOD07] QR search skipped:', e && e.message);
        return null;
    }
}
