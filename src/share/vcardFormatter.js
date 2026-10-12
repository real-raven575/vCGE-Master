/**
 * vCGE (vCard Generator Engine) - vCard 3.0 / 4.0 Formatter (`vcardFormatter.js`)
 * Project Overseer Authorized Production Build
 * Attributions: Created by raven575 and Gemini
 */

// RFC 2426 §4: escape backslash, comma, semicolon and newlines in text values.
export function escapeVCardText(value) {
    return String(value ?? '')
        .replace(/\\/g, '\\\\')
        .replace(/,/g, '\\,')
        .replace(/;/g, '\\;')
        .replace(/\r?\n/g, '\\n');
}

export function formatVCard(contact) {
    const e = escapeVCardText;
    const fullName = [contact.firstName, contact.lastName].filter(Boolean).join(" ") || "New Contact";

    const lines = ["BEGIN:VCARD", "VERSION:3.0"];
    lines.push(`FN:${e(fullName)}`);
    lines.push(`N:${e(contact.lastName)};${e(contact.firstName)};;;`);
    if (contact.organization) lines.push(`ORG:${e(contact.organization)}`);
    if (contact.jobTitle) lines.push(`TITLE:${e(contact.jobTitle)}`);
    if (contact.nickname) lines.push(`NICKNAME:${e(contact.nickname)}`);
    if (contact.birthday) lines.push(`BDAY:${contact.birthday}`);
    if (contact.phoneWork) lines.push(`TEL;TYPE=WORK,VOICE:${contact.phoneWork}`);
    if (contact.phoneMobile) lines.push(`TEL;TYPE=CELL,VOICE:${contact.phoneMobile}`);
    if (contact.email) lines.push(`EMAIL;TYPE=INTERNET:${contact.email}`);
    if (contact.website) lines.push(`URL:${contact.website}`);

    if (contact.street || contact.city || contact.state || contact.zip || contact.country) {
        lines.push(`ADR;TYPE=WORK:;;${e(contact.street)};${e(contact.city)};${e(contact.state)};${e(contact.zip)};${e(contact.country)}`);
    }

    if (contact.notes) lines.push(`NOTE:${e(contact.notes)}`);

    if (contact.avatarBase64) {
        const cleanBase64 = contact.avatarBase64.replace(/^data:image\/(png|jpeg|jpg);base64,/, "");
        lines.push(`PHOTO;TYPE=JPEG;ENCODING=b:${cleanBase64}`);
    }

    lines.push("END:VCARD");
    // RFC 2425 §5.8.1: content lines are delimited by CRLF.
    return lines.join("\r\n");
}
