/**
 * vCard Generator Engine (vCGE)
 * Module: vCGE-MOD07 (QR Code & vCard Engine)
 * Attributions: Created by raven575 & Gemini
 *
 * Scope:
 * - Builds vCard 3.0 payloads (RFC 2425/2426) via the shared formatter, so every module emits identical output.
 * - Renders QR codes onto an HTML5 canvas in RAM (bundled qrcode-generator, MIT).
 * File exports (PNG, .vcf) are egress and live in vCGE-MOD08.
 */
import { formatVCard } from '../../share/vcardFormatter.js';

export class VCGEQREngine {
    constructor() {
        this.version = "3.0";
        this.defaultErrorCorrectionLevel = "M"; // Recovers ~15% damage; good balance for mobile camera scans
        this.defaultCanvasSize = 320;
    }

    /**
     * Converts a contact (canonical schema, share/cardSchema.js) into a vCard 3.0 string.
     * @param {Object} contact
     * @returns {string} vCard 3.0 text with CRLF line endings
     */
    generateVCard30(contact = {}) {
        return formatVCard(contact);
    }

    /**
     * Renders a scannable QR code on a canvas with the bundled qrcode-generator library (MIT, src/vendor/).
     * Modules are drawn at a whole-pixel scale with a 4-module quiet zone, as scanners expect.
     * @returns {boolean} true when a real QR matrix was drawn, false when the labelled fallback was used
     */
    renderQRCode(canvas, text, options = {}) {
        if (!canvas) {
            console.error('[vCGE-MOD07] Error: Canvas element not provided.');
            return false;
        }

        const size = options.size || this.defaultCanvasSize;
        const level = options.level || this.defaultErrorCorrectionLevel;

        if (typeof qrcode !== 'function') {
            this.renderFallbackQR(canvas, size, ['QR library not loaded', '(not scannable)']);
            return false;
        }

        let qr;
        try {
            if (qrcode.stringToBytesFuncs && qrcode.stringToBytesFuncs['UTF-8']) {
                qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
            }
            qr = qrcode(0, level); // type 0 = smallest version that fits
            qr.addData(text, 'Byte');
            qr.make();
        } catch (e) {
            console.warn('[vCGE-MOD07] QR encoding failed:', e);
            this.renderFallbackQR(canvas, size, ['Too much data', 'for one QR code']);
            return false;
        }

        const quiet = 4;
        const cells = qr.getModuleCount() + quiet * 2;
        const scale = Math.max(2, Math.floor(size / cells));
        canvas.width = canvas.height = cells * scale;

        const ctx = canvas.getContext('2d');
        ctx.fillStyle = options.background || '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = options.foreground || '#000000';
        for (let row = 0; row < qr.getModuleCount(); row++) {
            for (let col = 0; col < qr.getModuleCount(); col++) {
                if (qr.isDark(row, col)) ctx.fillRect((col + quiet) * scale, (row + quiet) * scale, scale, scale);
            }
        }
        return true;
    }

    // Labelled placeholder used when no QR can be drawn. It is NOT scannable and says so.
    renderFallbackQR(canvas, size, lines) {
        const ctx = canvas.getContext('2d');
        canvas.width = size;
        canvas.height = size;

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, size, size);

        ctx.fillStyle = '#1e293b';
        ctx.font = `${Math.round(size / 13)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(lines[0], size / 2, size / 2 - size / 20);
        ctx.fillText(lines[1], size / 2, size / 2 + size / 14);
    }
}

export const vcgeQREngine = new VCGEQREngine();
