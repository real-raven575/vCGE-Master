/**
 * vCGE (vCard Generator Engine) - vCard 3.0 / 4.0 Formatter (`vcardFormatter.js`)
 * Project Overseer Authorized Production Build
 * Attributions: Created by raven575, Gemini & Claude
 */

// RFC 2426 §4: escape backslash, comma, semicolon and newlines in text values.
export function escapeVCardText(value) {
    return String(value ?? '')
        .replace(/\\/g, '\\\\')
        .replace(/,/g, '\\,')
        .replace(/;/g, '\\;')
        .replace(/\r?\n/g, '\\n');
}

// vCard 3.0 TYPE parameters for each phone / email / website type (contactOptions.js).
const TEL_TYPES = {
    mobile: 'CELL,VOICE', work: 'WORK,VOICE', home: 'HOME,VOICE', main: 'MAIN', workFax: 'WORK,FAX', homeFax: 'HOME,FAX',
    pager: 'PAGER', other: 'VOICE'
};
const EMAIL_TYPES = { work: 'INTERNET,WORK', personal: 'INTERNET,HOME', other: 'INTERNET' };
const URL_TYPES = { work: 'WORK', personal: 'HOME' };
// Social profiles: X-SOCIALPROFILE (read by Apple Contacts) plus a plain URL line (kept by Google Contacts and others).
const SOCIAL_TYPES = { linkedin: 'linkedin', x: 'twitter', facebook: 'facebook', instagram: 'instagram', github: 'github', youtube: 'youtube', tiktok: 'tiktok', reddit: 'reddit' };

/** "Client, Plumber,, client" -> ['Client', 'Plumber']: trimmed, empty and repeated tags (any case) dropped. */
export function categoryTags(text) {
    const seen = new Set();
    return String(text || '').split(/[,;\n]/).map(t => t.trim().replace(/\s+/g, ' ')).filter(t => {
        const key = t.toLowerCase();
        if (!t || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/** "4120 Lakeshore Road" + Suite 405 -> "4120 Lakeshore Road, Suite 405" (PO Box goes in its own ADR slot). */
function streetLine(contact) {
    const unit = contact.unitType && contact.unitType !== 'PO Box' ? [contact.unitType, contact.unitNumber].filter(Boolean).join(' ') : '';
    return [contact.street, unit].filter(Boolean).join(', ');
}

export function formatVCard(contact) {
    const e = escapeVCardText;
    const nameParts = [contact.namePrefix, contact.firstName, contact.middleName, contact.lastName].filter(Boolean).join(' ');
    const fullName = (nameParts + (contact.nameSuffix ? (nameParts ? ', ' : '') + contact.nameSuffix : '')) || "New Contact";

    const lines = ["BEGIN:VCARD", "VERSION:3.0"];
    lines.push(`FN:${e(fullName)}`);
    lines.push(`N:${e(contact.lastName)};${e(contact.firstName)};${e(contact.middleName)};${e(contact.namePrefix)};${e(contact.nameSuffix)}`);
    if (contact.organization) lines.push(`ORG:${e(contact.organization)}`);
    if (contact.jobTitle) lines.push(`TITLE:${e(contact.jobTitle)}`);
    if (contact.nickname) lines.push(`NICKNAME:${e(contact.nickname)}`);
    if (contact.birthday) lines.push(`BDAY:${contact.birthday}`);
    (contact.phones || []).forEach(({ type, value }) => { if (value) lines.push(`TEL;TYPE=${TEL_TYPES[type] || 'VOICE'}:${value}`); });
    (contact.emails || []).forEach(({ type, value }) => { if (value) lines.push(`EMAIL;TYPE=${EMAIL_TYPES[type] || 'INTERNET'}:${value}`); });
    (contact.websites || []).forEach(({ type, value }) => {
        if (!value) return;
        if (SOCIAL_TYPES[type]) lines.push(`X-SOCIALPROFILE;TYPE=${SOCIAL_TYPES[type]}:${value}`);
        lines.push(URL_TYPES[type] ? `URL;TYPE=${URL_TYPES[type]}:${value}` : `URL:${value}`);
    });

    const street = streetLine(contact);
    const poBox = contact.unitType === 'PO Box' ? ['PO Box', contact.unitNumber].filter(Boolean).join(' ') : '';
    if (street || poBox || contact.city || contact.state || contact.zip) {
        const type = { work: ';TYPE=WORK', home: ';TYPE=HOME' }[contact.addressType] || '';
        lines.push(`ADR${type}:${e(poBox)};;${e(street)};${e(contact.city)};${e(contact.state)};${e(contact.zip)};${e(contact.country)}`);
    }

    if (contact.notes) lines.push(`NOTE:${e(contact.notes)}`);
    // Categories: each tag escaped on its own, joined by plain commas (RFC 2426 3.6.1). Google Contacts and Outlook
    // show them as labels; iPhone Contacts drops them (notes/vcard-categories.md).
    const tags = categoryTags(contact.categories);
    if (tags.length) lines.push(`CATEGORIES:${tags.map(e).join(',')}`);

    // Contact apps read JPEG, PNG and GIF photos; anything else (an SVG saved by an older build) is left out.
    const photo = /^data:image\/(jpeg|jpg|png|gif);base64,(.+)$/.exec(contact.avatarBase64 || '');
    if (photo) {
        lines.push(`PHOTO;TYPE=${photo[1] === 'jpg' ? 'JPEG' : photo[1].toUpperCase()};ENCODING=b:${photo[2]}`);
    }

    lines.push("END:VCARD");
    // RFC 2425 §5.8.1: content lines are delimited by CRLF.
    return lines.join("\r\n");
}

/**
 * RFC 2425 §5.8.1 / RFC 6350 §3.2: a vCard file folds each content line longer than 75 octets (CRLF plus one space
 * starts the continuation) and ends with CRLF. Folds never split a UTF-8 character. For files and shares only: the QR
 * keeps the unfolded text from formatVCard, which is shorter.
 */
export const VCARD_LINE_OCTETS = 75;
export function foldVCardLines(vcard) {
    const encoder = new TextEncoder();
    const folded = String(vcard ?? '').split(/\r?\n/).filter((line, i, all) => line || i < all.length - 1).map(line => {
        const parts = [];
        let part = '', octets = 0, limit = VCARD_LINE_OCTETS;
        for (const ch of line) {
            const size = encoder.encode(ch).length;
            if (octets + size > limit) {
                parts.push(part);
                part = '';
                octets = 0;
                limit = VCARD_LINE_OCTETS - 1;      // the leading space of a continuation counts
            }
            part += ch;
            octets += size;
        }
        parts.push(part);
        return parts.join('\r\n ');
    });
    return folded.length ? `${folded.join('\r\n')}\r\n` : '';
}
