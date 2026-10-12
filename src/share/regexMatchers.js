/**
 * vCGE (vCard Generator Engine) - Universal RegEx Heuristics (`regexMatchers.js`)
 * Project Overseer Authorized Production Build
 * Attributions: Created by raven575 and Gemini
 */

import { createEmptyContact } from './cardSchema.js';

export const RegexMatchers = {
    email: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    phone: /(?:\+?(\d{1,3}))?[-. (]*(\d{3})[-. )]*(\d{3})[-. ]*(\d{4})(?: *x(\d+))?/g,
    url: /https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_\+.~#?&//=]*)/g,
    zipCode: /\b\d{5}(?:-\d{4})?\b|[A-Z]\d[A-Z] \d[A-Z]\d/g,

    parseOCRText(rawText) {
        const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
        const contact = createEmptyContact();

        const emails = rawText.match(this.email);
        if (emails && emails.length > 0) contact.email = emails[0];

        const urls = rawText.match(this.url);
        if (urls && urls.length > 0) contact.website = urls[0];

        const phones = rawText.match(this.phone);
        if (phones && phones.length > 0) {
            contact.phoneWork = phones[0];
            if (phones.length > 1) contact.phoneMobile = phones[1];
        }

        const zips = rawText.match(this.zipCode);
        if (zips && zips.length > 0) contact.zip = zips[0];

        if (lines.length > 0) {
            const nameParts = lines[0].split(' ');
            contact.firstName = nameParts[0] || '';
            contact.lastName = nameParts.slice(1).join(' ') || '';
        }
        if (lines.length > 1) {
            contact.jobTitle = lines[1];
        }
        if (lines.length > 2) {
            contact.organization = lines[2];
        }

        return contact;
    }
};