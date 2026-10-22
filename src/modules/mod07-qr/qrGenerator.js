/**
 * vCard Generator Engine (vCGE)
 * Module: vCGE-MOD07 (QR Code & vCard Engine)
 * Attributions: Created by raven575, Team vCGE (Claude) & Gemini
 *
 * Scope:
 * - Builds vCard 3.0 payloads (RFC 2425/2426) via the shared formatter, so every module emits identical output.
 * - Renders QR codes onto an HTML5 canvas in RAM (bundled qrcode-generator, MIT).
 * - Until the card has details, draws a blank placeholder (a white square on a black square) that can never scan.
 * - Tints the code to the card's theme (very dark theme shade on a pale theme tint) when the contrast stays
 *   scannable, else black on white; and draws the export styles (dots, frame, centre logo) from the same matrix.
 * File exports (PNG, .vcf) are egress and live in vCGE-MOD08. The theme colours arrive as plain values; this module
 * never reads another module's elements or code.
 */
import { formatVCard } from '../../share/vcardFormatter.js';

export const QR_DOTS = ['square', 'round', 'diamond'];
export const QR_FRAMES = ['none', 'square', 'rounded', 'circle', 'stripes', 'checkers', 'polka'];
const BAND_FRAMES = ['stripes', 'checkers', 'polka'];   // patterned bands, wider than a line frame
export const QR_LOGO_LEVEL = 'H';          // a centre logo covers modules; the strongest correction recovers them
export const QR_LOGO_FRACTION = 0.22;      // the logo plate, as a share of the code's width (under level H's 30 percent)
export const QR_MIN_CONTRAST = 4;          // a themed code needs at least this ratio or it falls back to black on white
const DARK_MIX = 0.78;                     // how far the card colour moves toward black for the dark modules
const LIGHT_MIX = 0.9;                     // how far it moves toward white for the light modules
const QUIET = 4;                           // quiet zone, in modules, as scanners expect

// ---- Colour helpers (plain maths on hex strings) --------------------------------------------------------------

export function hexToRgb(hex) {
    const h = String(hex || '').trim().replace('#', '');
    if (!/^([0-9a-f]{3}|[0-9a-f]{6})$/i.test(h)) return null;
    const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const toHex = (rgb) => '#' + rgb.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
/** Moves a colour toward a target: amount 0 keeps it, 1 is the target. */
export function mix(hex, targetHex, amount) {
    const a = hexToRgb(hex), b = hexToRgb(targetHex);
    return toHex(a.map((v, i) => v + (b[i] - v) * amount));
}
export function relativeLuminance(hex) {
    const rgb = hexToRgb(hex);
    if (!rgb) return 0;
    const [r, g, b] = rgb.map(v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** WCAG contrast ratio between two hex colours. */
export function contrastRatio(a, b) {
    const la = relativeLuminance(a), lb = relativeLuminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * The two module colours for a theme: a very dark shade of the card colour and a pale tint of it. When their
 * contrast is under QR_MIN_CONTRAST (or the theme is missing or malformed) the result is black on white and
 * `themed` is false, so the caller can say so.
 * @param {{card?: string}|null} theme  the card's theme colours (only `card` is used)
 * @returns {{dark: string, light: string, themed: boolean, ratio: number}}
 */
export function qrPalette(theme, { darkMix = DARK_MIX, lightMix = LIGHT_MIX } = {}) {
    const plain = { dark: '#000000', light: '#ffffff', themed: false, ratio: 21 };
    if (!theme || !hexToRgb(theme.card)) return plain;
    const dark = mix(theme.card, '#000000', darkMix);
    const light = mix(theme.card, '#ffffff', lightMix);
    const ratio = contrastRatio(dark, light);
    return ratio >= QR_MIN_CONTRAST ? { dark, light, themed: true, ratio } : { ...plain, ratio };
}

export class VCGEQREngine {
    constructor() {
        this.version = "3.0";
        this.defaultErrorCorrectionLevel = "M"; // Recovers ~15% damage; good balance for mobile camera scans
        this.defaultCanvasSize = 320;
        /** What the last renderQRCode drew: colours, whether the theme was used, level, style. Counts only, no data. */
        this.lastRender = null;
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
     * True once the card holds something worth sharing: a name, company, phone, email, website or address.
     * The default country and address type alone do not count.
     */
    hasDetails(contact = {}) {
        const filled = (v) => String(v ?? '').trim() !== '';
        const fields = ['namePrefix', 'firstName', 'middleName', 'lastName', 'nameSuffix', 'organization',
            'street', 'unitNumber', 'city', 'state', 'zip'];
        return fields.some((f) => filled(contact[f]))
            || ['phones', 'emails', 'websites'].some((f) => (contact[f] || []).some((row) => row && filled(row.value)));
    }

    /**
     * Blank placeholder for an empty card: a white square centred on a slightly larger black square.
     * It has no finder patterns or data, so no scanner can read it. Corner rounding and the soft edge effect come from page CSS, so they never reach the saved PNG.
     */
    renderPlaceholder(canvas, size = this.defaultCanvasSize) {
        if (!canvas) return;
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d');
        const border = Math.round(size * 0.12);
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, size, size);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(border, border, size - border * 2, size - border * 2);
        this.lastRender = null;
    }

    /** Encodes text at a level; null when it does not fit one QR code (version 40) or the library is missing. */
    encode(text, level = this.defaultErrorCorrectionLevel) {
        if (typeof qrcode !== 'function') return null;
        try {
            if (qrcode.stringToBytesFuncs && qrcode.stringToBytesFuncs['UTF-8']) {
                qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
            }
            const qr = qrcode(0, level); // type 0 = smallest version that fits
            qr.addData(text, 'Byte');
            qr.make();
            return qr;
        } catch (e) {
            return null;
        }
    }

    /** True when the text fits one QR code at that level. */
    fits(text, level = this.defaultErrorCorrectionLevel) {
        return this.encode(text, level) !== null;
    }

    /**
     * Whether a centre logo is possible for this payload: it needs level H, which holds less data.
     * @returns {{ok: boolean, reason: string}} reason is a short line for a greyed-out option
     */
    logoOption(text) {
        if (typeof qrcode !== 'function') return { ok: false, reason: 'QR library not loaded' };
        return this.fits(text, QR_LOGO_LEVEL)
            ? { ok: true, reason: '' }
            : { ok: false, reason: 'Too much contact data for a QR code with a logo' };
    }

    /**
     * Renders a scannable QR code on a canvas with the bundled qrcode-generator library (MIT, src/vendor/).
     * Modules are drawn at a whole-pixel scale with a 4-module quiet zone, as scanners expect.
     * @param {Object} options
     *   size        canvas size target in px (default 320)
     *   level       error correction L/M/Q/H (default M; a logo forces H)
     *   theme       {card} theme colours; tinted when the contrast allows, else black on white
     *   foreground/background  explicit colours (override the theme)
     *   dots        'square' | 'round' | 'diamond' (finder patterns stay square so phones lock on)
     *   frame       'none' | 'square' | 'rounded' | 'circle', or a patterned band: 'stripes' (diagonal zebra stripes),
 *               'checkers' (a checkerboard) or 'polka' (dots); all drawn outside the quiet zone in the dark colour
     *   logo        an image or canvas drawn at the centre on a light plate (needs level H), keeping its own shape
     * @returns {boolean} true when a real QR matrix was drawn, false when the labelled fallback was used
     */
    renderQRCode(canvas, text, options = {}) {
        if (!canvas) {
            console.error('[vCGE-MOD07] Error: Canvas element not provided.');
            return false;
        }

        const size = options.size || this.defaultCanvasSize;
        const logo = options.logo || null;
        const level = logo ? QR_LOGO_LEVEL : (options.level || this.defaultErrorCorrectionLevel);
        const dots = QR_DOTS.includes(options.dots) ? options.dots : 'square';
        const frame = QR_FRAMES.includes(options.frame) ? options.frame : 'none';

        if (typeof qrcode !== 'function') {
            this.renderFallbackQR(canvas, size, ['QR library not loaded', '(not scannable)']);
            return false;
        }

        const qr = this.encode(text, level);
        if (!qr) {
            console.warn('[vCGE-MOD07] QR encoding failed: the data does not fit one code at level', level);
            this.renderFallbackQR(canvas, size, ['Too much data', 'for one QR code']);
            return false;
        }

        const palette = qrPalette(options.theme);
        const dark = options.foreground || palette.dark;
        const light = options.background || palette.light;

        const n = qr.getModuleCount();
        const cells = n + QUIET * 2;
        const scale = Math.max(2, Math.floor(size / cells));
        const code = cells * scale;                       // the code with its quiet zone
        const frameWidth = frame === 'none' ? 0 : BAND_FRAMES.includes(frame) ? scale * 2 : scale;  // stroke width (a patterned band is wider)
        const pad = frame === 'none' ? 0 : scale * 2;     // space between the quiet zone and the frame
        // A circle has to clear the code's corners, so it needs a larger canvas than the square frames.
        const outer = frame === 'circle'
            ? Math.ceil(code * Math.SQRT2) + (pad + frameWidth) * 2
            : code + (pad + frameWidth) * 2;
        canvas.width = canvas.height = outer;
        const origin = Math.round((outer - code) / 2);

        const ctx = canvas.getContext('2d');
        ctx.fillStyle = light;
        if (frame === 'circle') {
            ctx.beginPath();
            ctx.arc(outer / 2, outer / 2, outer / 2 - frameWidth / 2, 0, Math.PI * 2);
            ctx.fill();
        } else {
            ctx.fillRect(0, 0, outer, outer);
        }

        ctx.fillStyle = dark;
        const isFinder = (row, col) => (row < 7 && col < 7) || (row < 7 && col >= n - 7) || (row >= n - 7 && col < 7);
        const r = scale * 0.46;
        for (let row = 0; row < n; row++) {
            for (let col = 0; col < n; col++) {
                if (!qr.isDark(row, col)) continue;
                const x = origin + (col + QUIET) * scale, y = origin + (row + QUIET) * scale;
                if (dots === 'round' && !isFinder(row, col)) {
                    ctx.beginPath();
                    ctx.arc(x + scale / 2, y + scale / 2, r, 0, Math.PI * 2);
                    ctx.fill();
                } else if (dots === 'diamond' && !isFinder(row, col)) {
                    const cx = x + scale / 2, cy = y + scale / 2, d = scale * 0.62;
                    ctx.beginPath();
                    ctx.moveTo(cx, cy - d); ctx.lineTo(cx + d, cy); ctx.lineTo(cx, cy + d); ctx.lineTo(cx - d, cy);
                    ctx.closePath();
                    ctx.fill();
                } else {
                    ctx.fillRect(x, y, scale, scale);
                }
            }
        }

        if (BAND_FRAMES.includes(frame)) {
            // A pattern clipped to the band outside the quiet zone, so the code itself is untouched.
            ctx.save();
            ctx.beginPath();
            ctx.rect(0, 0, outer, outer);
            ctx.rect(frameWidth, frameWidth, outer - frameWidth * 2, outer - frameWidth * 2);
            ctx.clip('evenodd');
            ctx.fillStyle = dark;
            ctx.strokeStyle = dark;
            if (frame === 'stripes') {
                ctx.lineWidth = scale * 0.8;
                ctx.beginPath();
                for (let x = -outer; x < outer; x += scale * 2) { ctx.moveTo(x, 0); ctx.lineTo(x + outer, outer); }
                ctx.stroke();
            } else if (frame === 'checkers') {
                for (let y = 0, j = 0; y < outer; y += scale, j++) for (let x = 0, i = 0; x < outer; x += scale, i++) if ((i + j) % 2 === 0) ctx.fillRect(x, y, scale, scale);
            } else {
                ctx.beginPath();
                for (let y = scale, j = 0; y < outer; y += scale * 2, j++) for (let x = j % 2 ? scale * 2 : scale; x < outer; x += scale * 2) { ctx.moveTo(x + scale * 0.45, y); ctx.arc(x, y, scale * 0.45, 0, Math.PI * 2); }
                ctx.fill();
            }
            ctx.restore();
        } else if (frame !== 'none') {
            ctx.strokeStyle = dark;
            ctx.lineWidth = frameWidth;
            ctx.beginPath();
            const inset = frameWidth / 2;
            if (frame === 'circle') ctx.arc(outer / 2, outer / 2, outer / 2 - inset, 0, Math.PI * 2);
            else if (frame === 'rounded' && typeof ctx.roundRect === 'function') ctx.roundRect(inset, inset, outer - frameWidth, outer - frameWidth, scale * 3);
            else ctx.rect(inset, inset, outer - frameWidth, outer - frameWidth);
            ctx.stroke();
        }

        if (logo) {
            // A light plate under the logo so it reads on any theme; the plate plus logo stay inside level H's budget.
            const plate = Math.round(n * scale * QR_LOGO_FRACTION / scale) * scale;
            const px = origin + Math.round((code - plate) / 2), py = px;
            ctx.fillStyle = light;
            ctx.fillRect(px, py, plate, plate);
            // The logo keeps its own shape: fitted inside the plate's inner square, centred, never stretched.
            const inner = Math.round(plate * 0.82);
            const lw = logo.naturalWidth || logo.width || inner, lh = logo.naturalHeight || logo.height || inner;
            const fit = inner / Math.max(lw, lh), w = Math.max(1, Math.round(lw * fit)), h = Math.max(1, Math.round(lh * fit));
            try { ctx.drawImage(logo, px + Math.round((plate - w) / 2), py + Math.round((plate - h) / 2), w, h); } catch (e) { console.warn('[vCGE-MOD07] logo not drawable'); }
        }

        this.lastRender = { themed: !options.foreground && !options.background && palette.themed, ratio: palette.ratio,
            dark, light, level, dots, frame, logo: !!logo, modules: n };
        return true;
    }

    /**
     * The calm reveal: the code fills in once, top to bottom in stripes (qr.css), when the card's first real code
     * replaces the placeholder. Restarted only by that change, never by each keystroke. Reduce motion shows it at once.
     */
    reveal(canvas) {
        if (!canvas || !canvas.classList) return;
        canvas.classList.remove('qr-reveal');
        void canvas.offsetWidth;
        canvas.classList.add('qr-reveal');
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
        this.lastRender = null;
    }
}

export const vcgeQREngine = new VCGEQREngine();
