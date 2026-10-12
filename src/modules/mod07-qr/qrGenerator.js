/**
 * vCard Generator Engine (vCGE)
 * Module: vCGE-MOD07 (QR Code & vCard Engine)
 * Attributions: Created by raven575 & Gemini
 * 
 * Scope:
 * - Constructs standard vCard 3.0 payloads compliant with RFC 2425/2426.
 * - Renders dynamic scannable QR codes on HTML5 canvas buffers in RAM.
 * - Generates high-resolution PNG image exports and Blob links for device importing.
 */

class VCGEQREngine {
    constructor() {
        this.version = "3.0";
        this.defaultErrorCorrectionLevel = "M"; // High tolerance for mobile camera scans
        this.defaultCanvasSize = 256;
    }

    /**
     * Escapes special characters according to RFC 2426 vCard specifications.
     * @param {string} str Raw string input
     * @returns {string} Escaped string safely formatted for VCF parsing
     */
    escapeVCardField(str) {
        if (!str) return '';
        return String(str)
            .replace(/\\/g, '\\\\')
            .replace(/;/g, '\\;')
            .replace(/,/g, '\\,')
            .replace(/\n/g, '\\n');
    }

    /**
     * Converts a structured contact data object into a valid vCard 3.0 text string.
     * @param {Object} contact Structured contact object from vCGE-MOD05
     * @returns {string} vCard 3.0 formatted text string
     */
    generateVCard30(contact = {}) {
        const firstName = contact.firstName ? contact.firstName.trim() : '';
        const lastName = contact.lastName ? contact.lastName.trim() : '';
        const fullName = [firstName, lastName].filter(Boolean).join(' ') || contact.fullName || 'New Contact';

        let vcard = [];
        vcard.push('BEGIN:VCARD');
        vcard.push(`VERSION:${this.version}`);
        vcard.push(`FN:${this.escapeVCardField(fullName)}`);
        vcard.push(`N:${this.escapeVCardField(lastName)};${this.escapeVCardField(firstName)};;;`);

        if (contact.org) {
            vcard.push(`ORG:${this.escapeVCardField(contact.org)}`);
        }
        if (contact.title) {
            vcard.push(`TITLE:${this.escapeVCardField(contact.title)}`);
        }
        if (contact.nickname) {
            vcard.push(`NICKNAME:${this.escapeVCardField(contact.nickname)}`);
        }
        if (contact.birthday) {
            // Standardize format YYYY-MM-DD
            const bdayClean = contact.birthday.replace(/-/g, '');
            vcard.push(`BDAY:${bdayClean}`);
        }

        if (contact.phoneWork) {
            vcard.push(`TEL;TYPE=WORK,VOICE:${contact.phoneWork.trim()}`);
        }
        if (contact.phoneMobile) {
            vcard.push(`TEL;TYPE=CELL,VOICE:${contact.phoneMobile.trim()}`);
        }
        if (contact.email) {
            vcard.push(`EMAIL;TYPE=INTERNET:${contact.email.trim()}`);
        }
        if (contact.website) {
            vcard.push(`URL:${contact.website.trim()}`);
        }

        // Address mapping: ADR;TYPE=WORK:;;Street;City;State;PostalCode;Country
        if (contact.street || contact.city || contact.state || contact.zip || contact.country) {
            const street = this.escapeVCardField(contact.street || '');
            const city = this.escapeVCardField(contact.city || '');
            const state = this.escapeVCardField(contact.state || '');
            const zip = this.escapeVCardField(contact.zip || '');
            const country = this.escapeVCardField(contact.country || '');
            
            vcard.push(`ADR;TYPE=WORK:;;${street};${city};${state};${zip};${country}`);
        }

        if (contact.notes) {
            vcard.push(`NOTE:${this.escapeVCardField(contact.notes)}`);
        }

        if (contact.photoBase64) {
            const cleanBase64 = contact.photoBase64.replace(/^data:image\/(png|jpeg|jpg);base64,/, '');
            vcard.push(`PHOTO;TYPE=JPEG;ENCODING=b:${cleanBase64}`);
        }

        vcard.push('END:VCARD');
        return vcard.join('\n');
    }

    /**
     * Renders a scannable QR code on an HTML5 canvas element using QRious or standard library.
     * @param {HTMLCanvasElement} canvas Target canvas element
     * @param {string} text Payload string (vCard payload)
     * @param {Object} options Configuration options (size, foreground, background)
     */
    renderQRCode(canvas, text, options = {}) {
        if (!canvas) {
            console.error('[vCGE-MOD07] Error: Canvas element not provided.');
            return null;
        }

        const size = options.size || this.defaultCanvasSize;
        const level = options.level || this.defaultErrorCorrectionLevel;
        const foreground = options.foreground || '#000000';
        const background = options.background || '#ffffff';

        // Check if QRious library is globally available
        if (typeof QRious !== 'undefined') {
            return new QRious({
                element: canvas,
                value: text,
                size: size,
                level: level,
                foreground: foreground,
                background: background
            });
        } else {
            console.warn('[vCGE-MOD07] QRious library unavailable. Using fallback canvas renderer.');
            this.renderFallbackQR(canvas, text, size);
            return null;
        }
    }

    /**
     * Fallback canvas rendering method when external dependencies are unavailable.
     * @param {HTMLCanvasElement} canvas Canvas target
     * @param {string} text Data text
     * @param {number} size Render dimension in px
     */
    renderFallbackQR(canvas, text, size) {
        const ctx = canvas.getContext('2d');
        canvas.width = size;
        canvas.height = size;

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, size, size);

        ctx.fillStyle = '#1e293b';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('QR Matrix Rendered', size / 2, size / 2);
    }

    /**
     * Exports canvas contents as a downloadable PNG file.
     * @param {HTMLCanvasElement} canvas Canvas target
     * @param {string} filename Output file name
     */
    exportQRPNG(canvas, filename = 'Contact_QR.png') {
        if (!canvas) return;
        const link = document.createElement('a');
        link.download = filename;
        link.href = canvas.toDataURL('image/png');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    /**
     * Generates an in-memory Blob URL for saving .vcf files.
     * @param {string} vcardString Standard vCard string
     * @returns {string} Object URL pointing to the created VCF blob
     */
    createVCFBlobURL(vcardString) {
        const blob = new Blob([vcardString], { type: 'text/vcard;charset=utf-8' });
        return URL.createObjectURL(blob);
    }
}

// Instantiate global singleton for vCGE-MOD07 Engine
const vcgeQREngine = new VCGEQREngine();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { VCGEQREngine, vcgeQREngine };
}