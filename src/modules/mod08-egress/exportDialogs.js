/**
 * vCGE-MOD08: the Export QR pop-up and the Print / PDF choice (redesign step 10)
 * Created by raven575, Team vCGE (Claude) & Gemini
 *
 * Export QR: a small selector over the deck (markup in index.html, a Shell sheet: a sideways swipe, Esc or the X is
 * Cancel) with a live preview. Colours Themed or Black & White; dots Square or Round; frame None, Square, Rounded
 * square or Circle; centre logo Nothing (default), the scanned logo from the card, or an upload. The PNG is saved
 * exactly as previewed. The code itself is drawn by MOD07 through the `render` hook the controller sets here (this
 * module never imports another); an uploaded logo is made ready by the `prepareLogo` hook (MOD06's trace and white
 * removal, on the device) and is only ever drawn as an image, so a script inside an SVG never runs. "Also use this
 * logo on my card" hands the upload to the Vault's logo slot (egressController.offerLogoToCard), never to the card view.
 * A centre logo needs error-correction level H; when the contact no longer fits at that level the logo options are
 * greyed out with the reason MOD07 gives.
 *
 * Print / PDF: one question, Themed or Black & White, then the print route runs (egressController).
 */
import { egressController } from './egressController.js';

export const QR_COLOURS = ['themed', 'bw', 'navy', 'forest', 'plum', 'cocoa'];
// The extra colours: MOD07 tints them like a card theme (a very dark shade on a pale tint, contrast checked)
export const QR_INKS = Object.freeze({ navy: '#1e3a8a', forest: '#166534', plum: '#6b21a8', cocoa: '#7c4a1e' });
export const QR_DOTS = ['square', 'round', 'diamond'];
export const QR_FRAMES = ['none', 'square', 'rounded', 'circle', 'stripes', 'checkers', 'polka'];
export const QR_LOGOS = ['none', 'scanned', 'upload'];
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const PREVIEW_PX = 320;

const $ = (id) => document.getElementById(id);

/** The default choices: themed, square dots, no frame, no logo, the logo not put on the card. */
export function defaultChoices() {
    return { colour: 'themed', dots: 'square', frame: 'none', logo: 'none', useOnCard: false };
}

/** A choice set with every value checked against the lists (anything unknown falls back to the default). */
export function cleanChoices(c = {}) {
    const d = defaultChoices();
    return {
        colour: QR_COLOURS.includes(c.colour) ? c.colour : d.colour,
        dots: QR_DOTS.includes(c.dots) ? c.dots : d.dots,
        frame: QR_FRAMES.includes(c.frame) ? c.frame : d.frame,
        logo: QR_LOGOS.includes(c.logo) ? c.logo : d.logo,
        useOnCard: c.useOnCard === true
    };
}

/** The note under the preview, from what MOD07 drew. Empty when there is nothing to say. */
export function previewNote({ ok, themed }, choices) {
    if (!ok) return 'Too much contact data for one QR code: use .vcf or Share instead.';
    if (choices.colour !== 'bw' && !themed) return 'Those colours are not scannable here, so Black & White is used.';
    return '';
}

// Loads a data URL as an image the canvas can draw (an SVG goes through <img> too: nothing inside it runs).
function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('LOGO_NOT_DRAWABLE'));
        img.src = src;
    });
}

export class ExportQrDialog {
    /**
     * @param {Object} hooks  set by the controller (main.js)
     *   render(canvas, { themed, ink, dots, frame, logo, size })  draws the current contact's code (MOD07); returns { ok, themed }
     *                     (ink: one of QR_INKS to tint with instead of the card's theme)
     *   logoOption()      { ok, reason } whether a centre logo fits (MOD07 level H)
     *   scannedLogo()     the logo shown on the card (a data URL) or null
     *   prepareLogo(src)  MOD06's logo preparation: { photo, display, traced, whiteRemoved, reason }
     *   toast(message)    Shell's toast
     *   delivered()       after a PNG is saved (the falcon flies with Checkers' parcel)
     *   beforeExternal()  a download may bring another app to the front (the controller's grace period)
     */
    constructor(hooks = {}) {
        this.hooks = hooks;
        this.root = null;
        this.choices = defaultChoices();
        this.upload = null;        // { photo, display } of the uploaded logo, memory only
        this.images = new Map();   // data URL -> drawn image, for the preview; cleared with the upload
        this.last = { ok: false, themed: false };
        this.rendering = null;
    }

    init(hooks = {}) {
        Object.assign(this.hooks, hooks);
        if (this.root) return;
        const root = $('exportQrSheet');
        if (!root) return;
        this.root = root;
        this.el = {
            canvas: $('exportQrPreview'), note: $('exportQrNote'), save: $('exportQrSaveBtn'), file: $('exportQrLogoFile'),
            logoReason: $('exportQrLogoReason'), useOnCard: $('exportQrUseOnCard'), useOnCardRow: $('exportQrUseOnCardRow'),
            fileName: $('exportQrFileName')
        };
        root.querySelectorAll('input[name="qrColour"], input[name="qrDots"], input[name="qrLogo"]').forEach(input => {
            input.addEventListener('change', () => this.onChoice(input.name, input.value));
        });
        this.el.frame = $('qrFrameSelect');
        this.el.frame.addEventListener('change', () => this.onChoice('qrFrame', this.el.frame.value));
        this.el.useOnCard.addEventListener('change', () => { this.choices.useOnCard = this.el.useOnCard.checked; });
        this.el.file.addEventListener('change', (e) => { const file = e.target.files[0]; e.target.value = ''; if (file) this.loadUpload(file); });
        this.el.save.addEventListener('click', () => this.save());
        $('exportQrCancelBtn').addEventListener('click', () => this.close());
    }

    isOpen() { return !!this.root && !this.root.classList.contains('hidden'); }

    /** Opens with fresh choices (an upload from an earlier opening is dropped). */
    async open() {
        if (!this.root) return;
        this.reset();
        const option = this.hooks.logoOption ? this.hooks.logoOption() : { ok: true, reason: '' };
        const scanned = this.hooks.scannedLogo ? this.hooks.scannedLogo() : null;
        this.setLogoOptions(option, !!scanned);
        this.paintChoices();
        this.el.fileName.textContent = egressController.fileName(' QR.png');
        this.root.classList.remove('hidden');
        await this.preview();
        const first = this.root.querySelector('input[name="qrColour"]:checked');
        if (first) first.focus();
    }

    close() {
        if (!this.root) return;
        this.root.classList.add('hidden');
        this.reset();
    }

    /** Drops the upload, the preview and the choices (a wipe calls this too). */
    reset() {
        this.choices = defaultChoices();
        this.upload = null;
        this.images.clear();
        this.last = { ok: false, themed: false };
        if (!this.el) return;
        this.el.canvas.width = this.el.canvas.height = 0;
        this.el.note.textContent = '';
        this.el.useOnCard.checked = false;
        this.el.useOnCardRow.classList.add('hidden');
        this.el.save.disabled = true;
    }

    // The logo radios: greyed out with MOD07's reason when the contact no longer fits at level H; "scanned" needs a logo on the card.
    setLogoOptions(option, hasScanned) {
        const scanned = this.root.querySelector('input[name="qrLogo"][value="scanned"]');
        const upload = this.root.querySelector('input[name="qrLogo"][value="upload"]');
        scanned.disabled = !option.ok || !hasScanned;
        upload.disabled = !option.ok;
        this.el.file.disabled = !option.ok;
        this.el.logoReason.textContent = !option.ok ? option.reason : (!hasScanned ? 'No logo on the card yet: upload one, or trace one on the 3D Card.' : '');
        if ((this.choices.logo === 'scanned' && scanned.disabled) || (this.choices.logo === 'upload' && upload.disabled)) this.choices.logo = 'none';
    }

    paintChoices() {
        const set = (name, value) => { const input = this.root.querySelector(`input[name="${name}"][value="${value}"]`); if (input) input.checked = true; };
        set('qrColour', this.choices.colour); set('qrDots', this.choices.dots); set('qrLogo', this.choices.logo);
        this.el.frame.value = this.choices.frame;
        this.el.useOnCard.checked = this.choices.useOnCard;
        this.el.useOnCardRow.classList.toggle('hidden', !this.upload);
    }

    onChoice(name, value) {
        const key = { qrColour: 'colour', qrDots: 'dots', qrFrame: 'frame', qrLogo: 'logo' }[name];
        if (!key) return;
        this.choices = cleanChoices({ ...this.choices, [key]: value });
        if (key === 'logo' && value === 'upload' && !this.upload) { this.el.file.click(); return; }
        this.preview();
    }

    async loadUpload(file) {
        if (!/^image\//.test(file.type)) { this.say('That is not an image file.'); this.backToNoLogo(); return; }
        if (file.size > LOGO_MAX_BYTES) { this.say('The logo must be 2 MB or smaller.'); this.backToNoLogo(); return; }
        let prepared = null;
        try {
            const dataUrl = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(r.error); r.readAsDataURL(file); });
            prepared = this.hooks.prepareLogo ? await this.hooks.prepareLogo(dataUrl) : { photo: dataUrl, display: dataUrl };
        } catch (e) {
            console.warn('[vCGE-MOD08] Logo not readable:', e);
        }
        if (!prepared || !prepared.display) { this.say('Could not read that logo.'); this.backToNoLogo(); return; }
        this.upload = { photo: prepared.photo, display: prepared.display };
        this.images.clear();
        this.choices.logo = 'upload';
        this.paintChoices();
        await this.preview();
    }

    backToNoLogo() {
        this.choices.logo = 'none';
        this.paintChoices();
        this.preview();
    }

    say(message) { if (this.hooks.toast) this.hooks.toast(message); }

    /** The logo image for the centre, or null for none. */
    async logoImage() {
        const src = this.choices.logo === 'upload' ? (this.upload && this.upload.display)
            : this.choices.logo === 'scanned' ? (this.hooks.scannedLogo ? this.hooks.scannedLogo() : null) : null;
        if (!src) return null;
        if (!this.images.has(src)) {
            try { this.images.set(src, await loadImage(src)); } catch (e) { console.warn('[vCGE-MOD08] Logo not drawable'); return null; }
        }
        return this.images.get(src);
    }

    /** Draws the preview from the current choices (one at a time: a choice made while drawing is drawn next). */
    async preview() {
        if (!this.root || !this.hooks.render) return;
        if (this.rendering) { this.queued = true; return; }
        this.rendering = (async () => {
            const logo = await this.logoImage();
            const c = this.choices;
            const result = this.hooks.render(this.el.canvas, { themed: c.colour === 'themed', ink: QR_INKS[c.colour] || null, dots: c.dots, frame: c.frame, logo, size: PREVIEW_PX }) || { ok: false, themed: false };
            this.last = { ok: !!result.ok, themed: !!result.themed };
            if (!this.last.ok) this.el.canvas.width = this.el.canvas.height = 0;
            this.el.note.textContent = previewNote(this.last, c);
            this.el.save.disabled = !this.last.ok;
            this.el.useOnCardRow.classList.toggle('hidden', !this.upload);
        })();
        try { await this.rendering; } finally { this.rendering = null; }
        if (this.queued) { this.queued = false; await this.preview(); }
    }

    /** Save PNG: the preview as drawn; then, if asked, the uploaded logo goes to the card through the Vault. */
    save() {
        if (!this.last.ok) return;
        if (this.hooks.beforeExternal) this.hooks.beforeExternal();
        const result = egressController.exportQRPNG(this.el.canvas, { real: true });
        if (!result.success) { this.say(result.reason === 'empty' ? 'Add a contact first.' : 'Too much information for one QR code: use .vcf or Share instead.'); return; }
        let onCard = false;
        if (this.choices.useOnCard && this.upload) onCard = egressController.offerLogoToCard(this.upload);
        this.say(`Saved ${result.filename}.${onCard ? ' The logo is on your card too.' : ''}`);
        if (this.hooks.delivered) this.hooks.delivered();
        this.close();
    }
}

export class PrintChoiceDialog {
    /** @param {{ onChoose: (themed: boolean, options: { nameFile: boolean }) => void }} hooks */
    constructor(hooks = {}) {
        this.hooks = hooks;
        this.root = null;
    }

    init(hooks = {}) {
        Object.assign(this.hooks, hooks);
        if (this.root) return;
        const root = $('printChoiceSheet');
        if (!root) return;
        this.root = root;
        $('printThemedBtn').addEventListener('click', () => this.choose(true));
        $('printBwBtn').addEventListener('click', () => this.choose(false));
        $('printCancelBtn').addEventListener('click', () => this.close());
    }

    isOpen() { return !!this.root && !this.root.classList.contains('hidden'); }

    open() {
        if (!this.root) return;
        this.root.classList.remove('hidden');
        // Naming the PDF after the contact is asked for each print: the box always starts unticked (raven575, 2026-10-18)
        const box = $('printNameFile');
        if (box) box.checked = false;
        $('printThemedBtn').focus();
    }

    close() { if (this.root) this.root.classList.add('hidden'); }

    choose(themed) {
        const box = $('printNameFile');
        const nameFile = !!(box && box.checked);
        this.close();
        if (this.hooks.onChoose) this.hooks.onChoose(themed, { nameFile });
    }
}

export const exportQrDialog = new ExportQrDialog();
export const printChoiceDialog = new PrintChoiceDialog();
