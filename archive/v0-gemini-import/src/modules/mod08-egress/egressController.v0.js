/**
 * vCGE-MOD08: Outbound Sharing & Export Controller (egressController.js)
 * Created by raven575 and Gemini
 * 
 * Manages secure outbound communications including Web Share API triggers,
 * native vCard downloads, SMS/Email mailto links, and physical card printing.
 */

/* STREAMING_CHUNK:Defining EgressController class... */
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
                    return { success: true, method: 'native_file' };
                }

                await navigator.share({
                    title: 'Digital vCard',
                    text: this.currentVCard
                });
                return { success: true, method: 'native_text' };
            } catch (error) {
                if (error.name === 'AbortError') return { success: false, reason: 'cancelled' };
            }
        }

        // Fallback to clipboard
        await navigator.clipboard.writeText(this.currentVCard);
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
     * Triggers email client with pre-filled vCard attachment body.
     */
    triggerEmailShare() {
        const name = `${this.contactData.firstName || ''} ${this.contactData.lastName || ''}`.trim() || 'Contact';
        const subject = encodeURIComponent(`Digital vCard: ${name}`);
        const body = encodeURIComponent(`Here is the digital vCard contact information for ${name}:\n\n${this.currentVCard}`);
        window.location.href = `mailto:?subject=${subject}&body=${body}`;
        return true;
    }

    /**
     * Triggers SMS client with vCard summary.
     */
    triggerSmsShare() {
        const name = `${this.contactData.firstName || ''} ${this.contactData.lastName || ''}`.trim() || 'Contact';
        const body = encodeURIComponent(`Digital vCard for ${name}: ${this.contactData.website || 'Contact Attached'}`);
        window.location.href = `sms:?body=${body}`;
        return true;
    }

    /**
     * Invokes the browser print pipeline for physical 3.5" x 2" cards.
     */
    triggerPhysicalPrint() {
        window.print();
        return true;
    }
}

// Instantiate and export default singleton
export const egressController = new EgressController();