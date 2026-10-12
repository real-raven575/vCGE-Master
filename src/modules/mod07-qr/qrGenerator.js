/**
 * vCard Generator Engine (vCGE)
 * Module: vCGE-MOD07 (QR Code & vCard Engine)
 * Attributions: Created by raven575 & Gemini
 *
 * Scope:
 * - Builds vCard 3.0 payloads (RFC 2425/2426) via the shared formatter, so every module emits identical output.
 * - Renders QR codes onto an HTML5 canvas in RAM.
 * File exports (PNG, .vcf) are egress and live in vCGE-MOD08.
 */
import { formatVCard } from '../../share/vcardFormatter.js';

export class VCGEQREngine {
    constructor() {
        this.version = "3.0";
        this.defaultErrorCorrectionLevel = "M"; // Recovers ~15% damage; good balance for mobile camera scans
        this.defaultCanvasSize = 256;
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
     * Renders a scannable QR code on a canvas using QRious when it is loaded.
     * @returns {boolean} true when a real QR matrix was drawn, false when the placeholder fallback was used
     */
    renderQRCode(canvas, text, options = {}) {
        if (!canvas) {
            console.error('[vCGE-MOD07] Error: Canvas element not provided.');
            return false;
        }

        const size = options.size || this.defaultCanvasSize;
        const level = options.level || this.defaultErrorCorrectionLevel;

        if (typeof QRious !== 'undefined') {
            new QRious({
                element: canvas,
                value: text,
                size,
                level,
                foreground: options.foreground || '#000000',
                background: options.background || '#ffffff'
            });
            return true;
        }
        this.renderFallbackQR(canvas, size);
        return false;
    }

    // Placeholder drawn when no QR library is bundled. It is NOT scannable and says so.
    renderFallbackQR(canvas, size) {
        const ctx = canvas.getContext('2d');
        canvas.width = size;
        canvas.height = size;

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, size, size);

        ctx.fillStyle = '#1e293b';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('QR library not bundled', size / 2, size / 2 - 8);
        ctx.fillText('(not scannable)', size / 2, size / 2 + 10);
    }
}

export const vcgeQREngine = new VCGEQREngine();
