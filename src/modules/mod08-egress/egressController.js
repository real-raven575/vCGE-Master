/**
 * vCGE-MOD08: Export ("Airlock") controller (egressController.js)
 * Created by raven575, Team vCGE (Claude) & Gemini
 *
 * The one hatch out. Every outbound action starts with a button press on the Share card: the .vcf file, the share sheet,
 * Copy, the QR PNG (styled in the Export QR pop-up, exportDialogs.js), Print / PDF (the 6 x 3.5 in sheet, print.css),
 * Email and SMS. Nothing goes to the clipboard unless the user taps Copy: the system clipboard outlives the app's wipes.
 * Files are named after the contact: the full name, else the company, else "Contact" ("Jane Doe.vcf", "Jane Doe QR.png").
 * A logo chosen for the QR can go onto the card too: it is written to the Vault's logo slot (the card view reads it
 * there), never handed to another module.
 */

import { globalEventBus, Events } from '../../share/eventBus.js';
import { PHONE_TYPES, EMAIL_TYPES, WEBSITE_TYPES } from '../../share/contactOptions.js';
import { foldVCardLines } from '../../share/vcardFormatter.js';

export const FILE_NAME_MAX = 80;         // characters of the name part, before the suffix
export const PRINT_QR_PX = 600;          // the QR drawn for the print sheet (1.5 in on paper)
export const PRINT_PAGE_IN = { width: 6, height: 3.5, margin: 0.3 };   // print.css's @page; the height grows to fit

/** The page height (inches) for a print sheet this tall (CSS px, 96 per inch): 3.5 in, or more when the card grows. */
export function printPageHeight(sheetPx) {
    const needed = Math.ceil((sheetPx / 96 + 2 * PRINT_PAGE_IN.margin) * 100) / 100;
    return Math.max(PRINT_PAGE_IN.height, needed);
}

const typeLabel = (types, type) => (types.find(([value]) => value === type) || [, type || 'Other'])[1];

// Labels for the readable summary (SMS, email body, text share): what each line is, in plain words.
const phoneLabel = (type) => ({ workFax: 'Work fax', homeFax: 'Home fax', pager: 'Pager' })[type] || `${typeLabel(PHONE_TYPES, type)} phone`;
const emailLabel = (type) => `${typeLabel(EMAIL_TYPES, type)} email`;
const websiteLabel = (type) => ({ work: 'Work website', personal: 'Personal website', other: 'Website' })[type] || typeLabel(WEBSITE_TYPES, type);
const addressLabel = (type) => ({ work: 'Work address', home: 'Home address' })[type] || 'Address';
// Two spaces after each colon leave room to start a touch selection on the value alone.
const SUMMARY_GAP = ':  ';

/**
 * A file name part safe on every system: path separators, the characters Windows forbids and control characters are
 * dropped, runs of spaces become one, leading and trailing dots and spaces go, and it is cut to FILE_NAME_MAX. Spaces
 * stay ("Jane Doe"). Empty after all that gives the fallback.
 */
export function safeFileName(name, fallback = 'Contact') {
    const cleaned = String(name || '')
        .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^[. ]+|[. ]+$/g, '')
        .slice(0, FILE_NAME_MAX)
        .trim();
    return cleaned || fallback;
}

// Every outbound action is announced on the bus so the shell can show a complete egress audit trail. Signals only
// (Commandment 6): the method and flags, never a file name, name, number or any other part of the contact.
function audit(method, detail = {}) {
    globalEventBus.publish(Events.EXPORT_DISPATCHED, { module: 'vCGE-MOD08', method, timestamp: Date.now(), ...detail });
}

function clickDownload(href, filename) {
    const link = document.createElement('a');
    link.href = href;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

export class EgressController {
    constructor() {
        this.currentVCard = "";
        this.contactData = {};
        this.qrReal = false;
        this.hasDetails = false;
        this.vault = null;          // this module's Vault handle (write: logo), set by the controller
    }

    /** The Vault handle for this module (mod08 rights). The logo for the card goes through it. */
    setVault(handle) {
        this.vault = handle;
    }

    /**
     * Updates the active vCard payload and associated contact details.
     * qrReal: false when the QR canvas holds a placeholder (MOD07), so it is never exported or printed.
     * hasDetails: MOD07's test for a card worth sharing; false for an empty card, which is not printed or saved as a QR.
     */
    setPayload(vcardString, contactAttributes, { qrReal = false, hasDetails = false } = {}) {
        // Files and shares carry the folded text (long lines such as PHOTO wrapped at 75 octets, CRLF at the end).
        this.currentVCard = vcardString ? foldVCardLines(vcardString) : '';
        this.contactData = contactAttributes || {};
        this.qrReal = qrReal;
        this.hasDetails = hasDetails;
        this.renderFileHint();
    }

    /** True when the card has nothing worth sharing yet (the same test that gives the QR its blank placeholder). */
    isEmpty() {
        return !this.currentVCard || !this.hasDetails;
    }

    // ---- Names ----------------------------------------------------------------------------------------------------

    /** The contact's name as people read it: prefix, first, middle, last, then ", suffix". "Contact" when there is none. */
    displayName() {
        const c = this.contactData;
        const name = [c.namePrefix, c.firstName, c.middleName, c.lastName].filter(Boolean).join(' ');
        return (name + (c.nameSuffix ? `, ${c.nameSuffix}` : '')) || 'Contact';
    }

    /** What files are named after: the full name, else the company, else "Contact". */
    baseName() {
        const c = this.contactData;
        const hasName = [c.namePrefix, c.firstName, c.middleName, c.lastName, c.nameSuffix].some(v => String(v || '').trim());
        if (hasName) return this.displayName();
        return String(c.organization || '').trim() || 'Contact';
    }

    /** A file name for this contact: the safe base name plus a suffix, for example ".vcf" or " QR.png". */
    fileName(suffix) {
        return `${safeFileName(this.baseName())}${suffix}`;
    }

    // The Share card shows what the files will be called.
    renderFileHint() {
        if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
        const el = document.getElementById('shareFileExample');
        if (el) el.textContent = `${this.fileName('.vcf')}, ${this.fileName(' QR.png')}`;
    }

    // ---- The hatch ------------------------------------------------------------------------------------------------

    /**
     * Triggers the native OS Share Sheet. There is no automatic clipboard fallback: copying is its own button (copyVCard).
     * Where the browser shares files (iPhone, iPad, Mac Safari) the .vcf goes alone: a text alongside it arrives as a
     * second file ("….txt") in Files, Drive and mail. Android Chrome and desktop browsers refuse .vcf files, so there
     * the readable summary is shared as text (the raw vCard is no use in a message) and the caller says how to get the
     * contact file instead.
     */
    async triggerQuickShare() {
        if (!this.currentVCard) return false;

        if (navigator.share) {
            try {
                const file = this.vcfFile();

                if (navigator.canShare && navigator.canShare({ files: [file] })) {
                    await navigator.share({ title: this.baseName(), files: [file] });
                    audit('share_file');
                    return { success: true, method: 'native_file' };
                }

                await navigator.share({ title: `Contact: ${this.displayName()}`, text: this.contactSummary() });
                audit('share_text');
                return { success: true, method: 'native_text' };
            } catch (error) {
                if (error.name === 'AbortError') return { success: false, reason: 'cancelled' };
                return { success: false, reason: 'share_failed' };
            }
        }
        return { success: false, reason: 'share_unavailable' };
    }

    /**
     * Copies the vCard text to the system clipboard, only when the user taps Copy. The clipboard is outside the app,
     * so the wipe cannot clear it: the caller tells the user so.
     */
    async copyVCard() {
        if (!this.currentVCard) return { success: false, reason: 'empty' };
        try {
            await navigator.clipboard.writeText(this.currentVCard);
        } catch (e) {
            return { success: false, reason: 'clipboard_unavailable' };
        }
        audit('clipboard');
        return { success: true, method: 'clipboard' };
    }

    /**
     * Generates a direct .vcf file download blob URL.
     */
    generateDownloadBlob() {
        const blob = new Blob([this.currentVCard], { type: 'text/vcard;charset=utf-8' });
        const filename = this.fileName('.vcf');
        const url = URL.createObjectURL(blob);
        return { url, filename };
    }

    /**
     * Saves the current vCard as a .vcf file.
     */
    downloadVcf() {
        if (!this.currentVCard) return false;
        const { url, filename } = this.generateDownloadBlob();
        clickDownload(url, filename);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        audit('download_vcf');
        return true;
    }

    /**
     * Saves a canvas (the QR code, styled in the pop-up) as a PNG file. Refused for a blank card and for a canvas that
     * holds no scannable code.
     * @param {HTMLCanvasElement} canvas
     * @param {{ real?: boolean, filename?: string }} [options]  real: whether the canvas holds a real code (default: the on-screen QR's state)
     * @returns {{ success: boolean, reason?: 'empty' | 'qr_too_large', filename?: string }}
     */
    exportQRPNG(canvas, { real = this.qrReal, filename = this.fileName(' QR.png') } = {}) {
        if (this.isEmpty()) return { success: false, reason: 'empty' };
        if (!canvas || !real) return { success: false, reason: 'qr_too_large' };
        clickDownload(canvas.toDataURL('image/png'), filename);
        audit('export_png');
        return { success: true, filename };
    }

    /**
     * "Also use this logo on my card": the logo chosen for the QR goes into the Vault's logo slot, where the card view
     * picks it up. Nothing is handed to another module. False when there is no Vault handle or the Vault refused it.
     * @param {{ photo: string, display: string }} logo  the prepared logo: the square JPEG for the vCard and the card copy
     */
    offerLogoToCard(logo) {
        if (!this.vault || !logo || !logo.photo) return false;
        return this.vault.put('logo', { photo: logo.photo, display: logo.display || logo.photo }) === true;
    }

    /**
     * The contact as readable lines (for SMS, the email body and a text share): name, title and company each on a line,
     * then labelled details ("Work phone:  …", "Work email:  …", "Work website:  …", "Work address:  …").
     */
    contactSummary() {
        const c = this.contactData;
        const street = [c.street, [c.unitType, c.unitNumber].filter(Boolean).join(' ')].filter(Boolean).join(', ');
        const address = [street, c.city, [c.state, c.zip].filter(Boolean).join(' '), c.country].filter(Boolean).join(', ');
        const line = (label, value) => `${label}${SUMMARY_GAP}${value}`;
        return [
            this.displayName(),
            c.jobTitle,
            c.organization,
            ...(c.phones || []).filter(p => p.value).map(p => line(phoneLabel(p.type), p.value)),
            ...(c.emails || []).filter(e => e.value).map(e => line(emailLabel(e.type), e.value)),
            ...(c.websites || []).filter(w => w.value).map(w => line(websiteLabel(w.type), w.value)),
            address && line(addressLabel(c.addressType), address)
        ].filter(Boolean).join('\n');
    }

    vcfFile() {
        return new File([this.currentVCard], this.fileName('.vcf'), { type: 'text/vcard' });
    }

    mailtoUrl() {
        const subject = encodeURIComponent(`Contact: ${this.displayName()}`);
        const body = encodeURIComponent(`${this.contactSummary()}\n\nTo add this contact, save the text below as a .vcf file (or use the .vcf button in vCGE):\n\n${this.currentVCard}`);
        return `mailto:?subject=${subject}&body=${body}`;
    }

    smsUrl() {
        return `sms:?body=${encodeURIComponent(this.contactSummary())}`;
    }

    navigate(url) {
        window.location.href = url;
    }

    /**
     * Email. Where the device can share files (iPhone, iPad, Mac Safari), the share sheet sends the .vcf as an attachment
     * the recipient can tap to import; otherwise (Android Chrome and desktop browsers do not share .vcf files) the mail app
     * opens with a readable summary and the vCard text. A mailto: link cannot carry attachments.
     */
    async triggerEmailShare() {
        if (!this.currentVCard) return false;
        const file = this.vcfFile();
        if (navigator.canShare && navigator.share && navigator.canShare({ files: [file] })) {
            try {
                await navigator.share({ title: `Contact: ${this.displayName()}`, text: this.contactSummary(), files: [file] });
                audit('email_attachment');
                return { success: true, method: 'attachment' };
            } catch (error) {
                if (error.name === 'AbortError') return { success: false, reason: 'cancelled' };
            }
        }
        this.navigate(this.mailtoUrl());
        audit('email');
        return { success: true, method: 'mailto' };
    }

    /** SMS with the readable summary (every phone, email, website and the address). */
    triggerSmsShare() {
        this.navigate(this.smsUrl());
        audit('sms');
        return true;
    }

    /**
     * Print / Save as PDF: one 6 x 3.5 in page (print.css) with the card front at business-card size (3.5 x 2 in or taller)
     * on the left and the QR code (1.5 in) to its right. Themed keeps the card's colours (copied from the card onto
     * the print copy, which inherits nothing once it leaves the card); Black & White is white paper and dark ink.
     * When the contact is too big for a QR code the right side says so instead of showing an unscannable code.
     * A card with more lines than 2 in holds grows taller instead of cutting them off: the sheet is measured off screen
     * with the print layout and the page is made tall enough (an @page rule in a constructed style sheet, which the
     * CSP allows). Browsers that ignore @page sizes (iOS prints on letter paper) still get the whole card.
     * The copies are rebuilt on each print and kept in the hidden #printSheet until the next print, idle purge or lock:
     * clearing them on 'afterprint' is unsafe, as some browsers (Android) fire it before the PDF is rendered.
     * A blank card is not printed.
     * Only when the user ticks "Name the PDF after the contact" (nameFile) is the PDF named like the other files
     * ("Jane Doe.pdf"): browsers take the PDF's name from the page title, so the title holds the file name while printing
     * and goes back on 'afterprint', the next tap or key, or the next clear (idle purge, lock, wipe). The browser may keep
     * the title in its history, which is why it is opt-in each time. (Android fires 'afterprint' early: its PDF may keep
     * the app's name.)
     * @param {{ themed?: boolean, qrCanvas?: HTMLCanvasElement|null, nameFile?: boolean }} [options]
     *   qrCanvas: the code drawn in the chosen colours (null when none fits); the themed one falls back to black on
     *   white inside MOD07 when the theme's contrast is too low, which the caller reports.
     * @returns {{ success: boolean, reason?: 'empty', pageHeightIn?: number }}
     */
    triggerPhysicalPrint({ themed = false, qrCanvas = null, nameFile = false } = {}) {
        if (this.isEmpty()) return { success: false, reason: 'empty' };
        const sheet = document.getElementById('printSheet'), front = document.getElementById('cardFront');
        if (sheet && front) {
            const frontCopy = front.cloneNode(true);
            [frontCopy, ...frontCopy.querySelectorAll('[id]')].forEach(el => el.removeAttribute('id'));
            frontCopy.classList.add('print-card', themed ? 'print-themed' : 'print-bw');
            if (themed) {
                // The card's theme lives in variables on its flipper; the copy stands alone, so it carries its own.
                const style = getComputedStyle(front);
                ['--card-bg', '--card-ink', '--card-accent'].forEach(v => {
                    const value = style.getPropertyValue(v).trim();
                    if (value) frontCopy.style.setProperty(v, value);
                });
                const flipper = front.parentElement;
                if (flipper && flipper.dataset && flipper.dataset.theme) frontCopy.dataset.theme = flipper.dataset.theme;
            }
            const side = document.createElement('div');
            side.className = `print-qr${themed ? ' print-themed' : ' print-bw'}`;
            if (qrCanvas) {
                const qr = document.createElement('img');
                qr.src = qrCanvas.toDataURL('image/png');
                qr.alt = 'vCard QR code';
                side.append(qr);
            } else {
                const note = document.createElement('p');
                note.className = 'print-qr-note';
                note.textContent = 'Too much information for one QR code';
                side.append(note);
            }
            const name = document.createElement('p');
            name.textContent = this.displayName();
            side.append(name);
            sheet.replaceChildren(frontCopy, side);
        }
        const pageHeightIn = sheet ? this.fitPrintPage(sheet) : PRINT_PAGE_IN.height;
        audit('print', { themed });
        if (nameFile) this.setPrintTitle(this.fileName(''));
        window.print();
        return { success: true, pageHeightIn };
    }

    /** Measures the filled sheet with the print layout (off screen) and sizes the page to it. Returns the page height. */
    fitPrintPage(sheet) {
        sheet.classList.add('print-measure');
        const height = printPageHeight(sheet.getBoundingClientRect().height);
        sheet.classList.remove('print-measure');
        this.setPrintPageHeight(height);
        return height;
    }

    setPrintPageHeight(height) {
        if (typeof CSSStyleSheet === 'undefined' || !('adoptedStyleSheets' in document)) return;
        if (!this.pageSheet) {
            this.pageSheet = new CSSStyleSheet();
            document.adoptedStyleSheets = [...document.adoptedStyleSheets, this.pageSheet];
        }
        this.pageSheet.replaceSync(height > PRINT_PAGE_IN.height
            ? `@media print { @page { size: ${PRINT_PAGE_IN.width}in ${height}in; margin: ${PRINT_PAGE_IN.margin}in; } }` : '');
    }

    /** The page title becomes the PDF's name until printing ends (afterprint), the next tap or key, or the next clear. */
    setPrintTitle(name) {
        this.restorePrintTitle();
        this.savedTitle = document.title;
        document.title = name;
        this.titleRestorer = () => this.restorePrintTitle();
        window.addEventListener('afterprint', this.titleRestorer);
        ['pointerdown', 'keydown'].forEach(type => window.addEventListener(type, this.titleRestorer, true));
    }

    restorePrintTitle() {
        if (this.savedTitle == null) return;
        document.title = this.savedTitle;
        this.savedTitle = null;
        window.removeEventListener('afterprint', this.titleRestorer);
        ['pointerdown', 'keydown'].forEach(type => window.removeEventListener(type, this.titleRestorer, true));
    }

    clearPrintSheet() {
        this.restorePrintTitle();
        const sheet = document.getElementById('printSheet');
        if (sheet) sheet.replaceChildren();
        if (this.pageSheet) this.pageSheet.replaceSync('');
    }
}

// Instantiate and export default singleton
export const egressController = new EgressController();
