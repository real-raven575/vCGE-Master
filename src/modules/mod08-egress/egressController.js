/**
 * vCGE-MOD08: Outbound Sharing & Export Controller (egressController.js)
 * Created by raven575, Gemini & Claude
 * 
 * Manages secure outbound communications including Web Share API triggers,
 * native vCard downloads, SMS/Email mailto links, and physical card printing.
 */

import { globalEventBus, Events } from '../../share/eventBus.js';
import { PHONE_TYPES, EMAIL_TYPES, WEBSITE_TYPES } from '../../share/contactOptions.js';

const typeLabel = (types, type) => (types.find(([value]) => value === type) || [, type || 'Other'])[1];

// Every outbound action is announced on the bus so the shell can show a complete egress audit trail.
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
    }

    /**
     * Updates the active vCard payload and associated contact details.
     */
    setPayload(vcardString, contactAttributes) {
        this.currentVCard = vcardString;
        this.contactData = contactAttributes || {};
    }

    /**
     * Triggers the native OS Share Sheet or falls back to clipboard.
     */
    async triggerQuickShare() {
        if (!this.currentVCard) return false;

        if (navigator.share) {
            try {
                const blob = new Blob([this.currentVCard], { type: 'text/vcard' });
                const file = new File([blob], `${this.contactData.firstName || 'Contact'}.vcf`, { type: 'text/vcard' });
                
                if (navigator.canShare && navigator.canShare({ files: [file] })) {
                    await navigator.share({
                        title: `${this.contactData.firstName || ''} ${this.contactData.lastName || ''}`.trim() || 'Digital vCard',
                        text: 'Digital Business Card Contact',
                        files: [file]
                    });
                    audit('share_file');
                    return { success: true, method: 'native_file' };
                }

                await navigator.share({
                    title: 'Digital vCard',
                    text: this.currentVCard
                });
                audit('share_text');
                return { success: true, method: 'native_text' };
            } catch (error) {
                if (error.name === 'AbortError') return { success: false, reason: 'cancelled' };
            }
        }

        // Fallback to clipboard
        try {
            await navigator.clipboard.writeText(this.currentVCard);
        } catch (e) {
            return { success: false, reason: 'clipboard_unavailable' };
        }
        audit('clipboard');
        return { success: true, method: 'clipboard_fallback' };
    }

    /**
     * Generates a direct .vcf file download blob URL.
     */
    generateDownloadBlob() {
        const blob = new Blob([this.currentVCard], { type: 'text/vcard;charset=utf-8' });
        const filename = `${this.contactData.firstName || 'Contact'}_${this.contactData.lastName || 'Card'}.vcf`;
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
        audit('download_vcf', { filename });
        return true;
    }

    /**
     * Saves a canvas (the QR code) as a PNG file.
     */
    exportQRPNG(canvas, filename = `${this.contactData.firstName || 'Contact'}_QR.png`) {
        if (!canvas) return false;
        clickDownload(canvas.toDataURL('image/png'), filename);
        audit('export_png', { filename });
        return true;
    }

    displayName() {
        const c = this.contactData;
        const name = [c.namePrefix, c.firstName, c.middleName, c.lastName].filter(Boolean).join(' ');
        return (name + (c.nameSuffix ? `, ${c.nameSuffix}` : '')) || 'Contact';
    }

    /** The contact as readable lines (for SMS and the email body): name, title and company, typed details, address. */
    contactSummary() {
        const c = this.contactData;
        const street = [c.street, [c.unitType, c.unitNumber].filter(Boolean).join(' ')].filter(Boolean).join(', ');
        const address = [street, c.city, [c.state, c.zip].filter(Boolean).join(' '), c.country].filter(Boolean).join(', ');
        return [
            this.displayName(),
            [c.jobTitle, c.organization].filter(Boolean).join(', '),
            ...(c.phones || []).filter(p => p.value).map(p => `${typeLabel(PHONE_TYPES, p.type)}: ${p.value}`),
            ...(c.emails || []).filter(e => e.value).map(e => `${typeLabel(EMAIL_TYPES, e.type)} email: ${e.value}`),
            ...(c.websites || []).filter(w => w.value).map(w => `${typeLabel(WEBSITE_TYPES, w.type)}: ${w.value}`),
            address
        ].filter(Boolean).join('\n');
    }

    vcfFile() {
        const filename = `${(this.contactData.firstName || 'Contact')}_${(this.contactData.lastName || 'Card')}.vcf`.replace(/[^\w.-]+/g, '_');
        return new File([this.currentVCard], filename, { type: 'text/vcard' });
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
     * Prints (or saves as PDF) one page with the card front and back (QR code) at 3.5" x 2".
     * The copies are rebuilt on each print and kept in the hidden #printSheet until the next print, idle purge or lock:
     * clearing them on 'afterprint' is unsafe, as some browsers (Android) fire it before the PDF is rendered.
     */
    triggerPhysicalPrint(qrCanvas) {
        const sheet = document.getElementById('printSheet'), front = document.getElementById('cardFront');
        if (sheet && front) {
            const frontCopy = front.cloneNode(true);
            [frontCopy, ...frontCopy.querySelectorAll('[id]')].forEach(el => el.removeAttribute('id'));
            frontCopy.classList.add('print-card');
            const back = document.createElement('div');
            back.className = 'print-card print-back';
            if (qrCanvas) {
                const qr = document.createElement('img');
                qr.src = qrCanvas.toDataURL('image/png');
                qr.alt = 'vCard QR code';
                back.append(qr);
            }
            const name = document.createElement('p');
            name.textContent = this.displayName();
            back.append(name);
            sheet.replaceChildren(frontCopy, back);
        }
        audit('print');
        window.print();
        return true;
    }

    clearPrintSheet() {
        const sheet = document.getElementById('printSheet');
        if (sheet) sheet.replaceChildren();
    }
}

// Instantiate and export default singleton
export const egressController = new EgressController();