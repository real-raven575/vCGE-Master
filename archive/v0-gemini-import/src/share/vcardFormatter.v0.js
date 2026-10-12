/**
 * vCGE (vCard Generator Engine) - vCard 3.0 / 4.0 Formatter (`vcardFormatter.js`)
 * Project Overseer Authorized Production Build
 * Attributions: Created by raven575 and Gemini
 */

export function formatVCard(contact) {
    const fullName = [contact.firstName, contact.lastName].filter(Boolean).join(" ") || "New Contact";

    let vcard = "BEGIN:VCARD\nVERSION:3.0\n";
    vcard += `FN:${fullName}\n`;
    vcard += `N:${contact.lastName || ''};${contact.firstName || ''};;;\n`;
    if (contact.organization) vcard += `ORG:${contact.organization}\n`;
    if (contact.jobTitle) vcard += `TITLE:${contact.jobTitle}\n`;
    if (contact.nickname) vcard += `NICKNAME:${contact.nickname}\n`;
    if (contact.birthday) vcard += `BDAY:${contact.birthday}\n`;
    if (contact.phoneWork) vcard += `TEL;TYPE=WORK,VOICE:${contact.phoneWork}\n`;
    if (contact.phoneMobile) vcard += `TEL;TYPE=CELL,VOICE:${contact.phoneMobile}\n`;
    if (contact.email) vcard += `EMAIL;TYPE=INTERNET:${contact.email}\n`;
    if (contact.website) vcard += `URL:${contact.website}\n`;

    if (contact.street || contact.city || contact.state || contact.zip || contact.country) {
        vcard += `ADR;TYPE=WORK:;;${contact.street || ''};${contact.city || ''};${contact.state || ''};${contact.zip || ''};${contact.country || ''}\n`;
    }

    if (contact.notes) vcard += `NOTE:${contact.notes}\n`;

    if (contact.avatarBase64) {
        const cleanBase64 = contact.avatarBase64.replace(/^data:image\/(png|jpeg|jpg);base64,/, "");
        vcard += `PHOTO;TYPE=JPEG;ENCODING=b:${cleanBase64}\n`;
    }

    vcard += "END:VCARD";
    return vcard;
}