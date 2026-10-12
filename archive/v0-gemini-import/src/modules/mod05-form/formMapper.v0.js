/**
 * vCard Generator Engine (vCGE)
 * Copyright (c) 2026 raven575 & Gemini
 *
 * Repository: https://github.com/real-raven575/vCGE-Master
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * vCGE-MOD05: Contact Form & Auto-Mapper
 * Scope: Regex heuristics, OCR text parsing, field mapping, and international phone formatting.
 */

export class ContactFormMapper {
    constructor() {
        this.countryFormats = {
            'United States': 'US',
            'Canada': 'US',
            'United Kingdom': 'UK',
            'Germany': 'DE',
            'France': 'FR',
            'Japan': 'JP',
            'Australia': 'AU',
            'India': 'IN',
            'Brazil': 'BR',
            'Mexico': 'MX'
        };
    }

    /**
     * Parses raw OCR text lines and maps them to structured vCard schema fields.
     * @param {string} rawText - Raw text extracted from OCR.
     * @returns {Object} Mapped contact fields.
     */
    parseOCRText(rawText) {
        const rawLines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        let data = {
            firstName: '',
            lastName: '',
            phoneWork: '',
            phoneMobile: '',
            email: '',
            website: '',
            org: '',
            title: '',
            street: '',
            city: '',
            state: '',
            zip: '',
            country: 'United States'
        };

        const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/i;
        const phoneRegex = /(?:(?:\+?1\s*(?:[.-]\s*)?)?(?:\(\s*([2-9]1[02-9]|[2-9][02-8]1|[2-9][02-8][02-9])\s*\)|([2-9]1[02-9]|[2-9][02-8]1|[2-9][02-8][02-9]))\s*(?:[.-]\s*)?)?([2-9]1[02-9]|[2-9][02-9]1|[2-9][02-9]{2})\s*(?:[.-]\s*)?([0-9]{4})(?:\s*(?:#|x\.?|ext\.?)\s*(\d+))?/i;
        const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+\.[^\s]+)/i;
        const zipRegex = /\b\d{5}(?:-\d{4})?\b/;

        rawLines.forEach(line => {
            if (emailRegex.test(line) && !data.email) {
                const match = line.match(emailRegex);
                if (match) data.email = match[0];
            } else if (phoneRegex.test(line) && !data.phoneMobile) {
                const match = line.match(phoneRegex);
                if (match) data.phoneMobile = match[0];
            } else if (urlRegex.test(line) && !data.website) {
                const match = line.match(urlRegex);
                if (match) data.website = match[0];
            } else if (zipRegex.test(line) && !data.zip) {
                const match = line.match(zipRegex);
                if (match) data.zip = match[0];
            } else if (/VP|Director|Manager|Engineer|Designer|Chief|Consultant|Founder|CEO|CTO|Partner/i.test(line) && !data.title) {
                data.title = line;
            } else if (!data.firstName && line.split(' ').length === 2 && !/[@0-9]/.test(line)) {
                const parts = line.split(' ');
                data.firstName = parts[0];
                data.lastName = parts[1];
            } else if (!data.org && line.length > 3 && !/[@0-9]/.test(line) && !data.title.includes(line)) {
                data.org = line;
            }
        });

        if (!data.firstName && rawLines.length > 0) {
            const firstLineParts = rawLines[0].split(' ');
            data.firstName = firstLineParts[0] || 'Scanned';
            data.lastName = firstLineParts[1] || 'Contact';
        }

        return data;
    }

    /**
     * Formats phone numbers according to the selected country standard.
     * @param {string} rawNumber - Raw phone string.
     * @param {string} formatType - Format key ('US', 'UK', 'DE', etc.).
     * @returns {string} Formatted phone string.
     */
    formatPhone(rawNumber, formatType = 'US') {
        let digits = rawNumber.replace(/\D/g, '');
        if (!digits) return rawNumber;

        if (formatType === 'US') {
            if (digits.length === 10) {
                return `+1 (${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`;
            } else if (digits.length === 11 && digits.startsWith('1')) {
                return `+1 (${digits.slice(1,4)}) ${digits.slice(4,7)}-${digits.slice(7)}`;
            }
        } else if (formatType === 'UK') {
            if (digits.startsWith('44')) digits = digits.slice(2);
            if (digits.length >= 10) {
                return `+44 ${digits.slice(0,2)} ${digits.slice(2,6)} ${digits.slice(6)}`;
            }
        } else if (formatType === 'DE') {
            if (digits.startsWith('49')) digits = digits.slice(2);
            return `+49 ${digits.slice(0,3)} ${digits.slice(3)}`;
        }
        return rawNumber;
    }
}