/**
 * vCard Generator Engine (vCGE) - vCGE-MOD06 Virtual Business Card GUI
 * Created by raven575, Gemini & Claude
 *
 * Owns the contact form, card preview (3D flip, palettes, typography, avatar) and toasts.
 * Holds contact data in memory only; persistence is the vault's job (wired in src/main.js).
 */
import { CONTACT_FIELDS, createEmptyContact } from '../../share/cardSchema.js';

export const THEMES = {
    ocean: { label: 'Ocean Blue', bg: 'from-indigo-500 to-blue-600', hex: '#6366f1' },
    emerald: { label: 'Emerald Forest', bg: 'from-emerald-500 to-teal-700', hex: '#10b981' },
    sunset: { label: 'Sunset Coral', bg: 'from-rose-500 to-orange-600', hex: '#f43f5e' },
    violet: { label: 'Royal Violet', bg: 'from-purple-600 to-indigo-800', hex: '#9333ea' },
    slate: { label: 'Monochrome Slate', bg: 'from-slate-700 to-slate-900', hex: '#334155' }
};

const PRESETS = [
    { label: '🤖 AI Research Lead', firstName: 'Elena', lastName: 'Rostova', organization: 'NeuralShift AI', jobTitle: 'Principal Research Scientist', phoneWork: '+1 (415) 888-0199', phoneMobile: '+1 (415) 888-0122', email: 'e.rostova@neuralshift.ai', website: 'https://neuralshift.ai', street: '100 Innovation Way, Suite 800', city: 'Palo Alto', state: 'CA', zip: '94301', country: 'United States', themePalette: 'violet' },
    { label: '⚖️ Managing Attorney', firstName: 'Marcus', lastName: 'Vance', organization: 'Vance & Partners LLP', jobTitle: 'Senior Managing Partner', phoneWork: '+1 (212) 555-9000', phoneMobile: '+1 (917) 555-4321', email: 'marcus.vance@vancelaw.com', website: 'https://vancelaw.com', street: '745 Fifth Avenue, 28th Floor', city: 'New York', state: 'NY', zip: '10151', country: 'United States', themePalette: 'slate' },
    { label: '🎨 UX Architect', firstName: 'Kai', lastName: 'Takahashi', organization: 'Studio Craft', jobTitle: 'Lead Design Architect', phoneWork: '+1 (206) 555-3400', phoneMobile: '+1 (206) 555-9876', email: 'kai@studiocraft.design', website: 'https://studiocraft.design', street: '1201 3rd Ave, Studio 12', city: 'Seattle', state: 'WA', zip: '98101', country: 'United States', themePalette: 'ocean' }
];

const FONT_CLASSES = ['font-sans', 'font-serif', 'font-mono'];
const $ = (id) => document.getElementById(id);

export class CardView {
    /**
     * @param {Object} opts
     * @param {Function} opts.onChange   called with the current contact after any edit
     * @param {Object}   [opts.addressEngine]  MOD05 AddressAutocompleteEngine (local lookup)
     * @param {Object}   [opts.formMapper]     MOD05 ContactFormMapper (phone formatting)
     */
    constructor({ onChange, addressEngine = null, formMapper = null }) {
        this.onChange = onChange || (() => {});
        this.addressEngine = addressEngine;
        this.formMapper = formMapper;
        this.avatarBase64 = null;
        this.themeKey = 'ocean';
        this.isFlipped = false;
        this.toastTimer = null;
    }

    init() {
        this.buildPresetButtons();
        this.buildPaletteMenu();
        this.attachListeners();
        this.applyTheme(this.themeKey);
    }

    // ---- Contact state -------------------------------------------------------------------------------------

    getContact() {
        const contact = createEmptyContact();
        CONTACT_FIELDS.forEach(field => {
            const el = $(field);
            if (el) contact[field] = el.value.trim();
        });
        contact.avatarBase64 = this.avatarBase64;
        contact.themePalette = this.themeKey;
        return contact;
    }

    setContact(contact = {}) {
        CONTACT_FIELDS.forEach(field => {
            const el = $(field);
            if (el) el.value = contact[field] || '';
        });
        this.setAvatar(contact.avatarBase64 || null);
        this.applyTheme(contact.themePalette in THEMES ? contact.themePalette : 'ocean');
    }

    // Fills only the fields that have a value (used for OCR results).
    mergeContact(partial = {}) {
        CONTACT_FIELDS.forEach(field => {
            const el = $(field);
            if (el && partial[field]) el.value = partial[field];
        });
        this.changed();
    }

    clear() {
        this.setContact(createEmptyContact());
    }

    changed() {
        this.onChange(this.getContact());
    }

    // ---- Rendering -----------------------------------------------------------------------------------------

    render(contact) {
        const fullName = [contact.firstName, contact.lastName].filter(Boolean).join(' ') || 'New Contact';
        $('previewFullName').textContent = fullName;
        $('previewOrg').textContent = contact.organization || 'Company Name';
        $('previewTitle').textContent = contact.jobTitle || 'Job Title';
        $('previewPhone').textContent = contact.phoneWork || contact.phoneMobile || 'No phone number';
        $('previewEmail').textContent = contact.email || 'No email address';
        $('previewAddress').textContent = [contact.street, contact.city, contact.state].filter(Boolean).join(', ') || 'No address provided';
        $('previewWebsite').textContent = contact.website || 'No website';
        $('backCardName').textContent = fullName;

        const initials = (contact.firstName && contact.lastName)
            ? (contact.firstName[0] + contact.lastName[0]).toUpperCase() : 'VC';
        this.renderAvatarBox($('previewAvatar'), initials, 'w-16 h-16 text-2xl');
        this.renderAvatarBox($('formAvatarPreview'), initials, 'w-14 h-14 text-xl');
    }

    renderAvatarBox(box, initials, sizeClasses) {
        if (!box) return;
        const t = THEMES[this.themeKey];
        box.className = `${sizeClasses} rounded-2xl bg-gradient-to-tr ${t.bg} text-white flex items-center justify-center font-bold shadow-lg overflow-hidden flex-shrink-0`;
        box.replaceChildren();
        if (this.avatarBase64) {
            const img = document.createElement('img');
            img.src = this.avatarBase64;
            img.alt = '';
            img.className = 'w-full h-full object-cover';
            box.appendChild(img);
        } else {
            box.textContent = initials;
        }
    }

    applyTheme(themeKey) {
        this.themeKey = THEMES[themeKey] ? themeKey : 'ocean';
        const t = THEMES[this.themeKey];
        $('currentPaletteLabel').textContent = t.label;
        $('paletteSwatch').style.background = t.hex;
    }

    setAvatar(dataUrl) {
        this.avatarBase64 = dataUrl;
        $('removeAvatarBtn').classList.toggle('hidden', !dataUrl);
    }

    toggleFlip() {
        this.isFlipped = !this.isFlipped;
        $('card3DFlipper').style.transform = this.isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)';
    }

    showToast(msg) {
        const t = $('toast');
        if (!t) return;
        $('toastMessage').textContent = msg;
        t.classList.remove('translate-y-20', 'opacity-0');
        clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(() => t.classList.add('translate-y-20', 'opacity-0'), 3000);
    }

    // ---- UI construction & listeners -----------------------------------------------------------------------

    buildPresetButtons() {
        const container = $('presetButtonsContainer');
        if (!container) return;
        PRESETS.forEach(preset => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'px-2.5 py-1 bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-lg font-semibold text-[11px] transition';
            btn.textContent = preset.label;
            btn.addEventListener('click', () => {
                this.setContact({ ...preset, avatarBase64: this.avatarBase64 });
                this.changed();
                this.showToast(`Loaded preset: ${preset.firstName} ${preset.lastName}`);
            });
            container.appendChild(btn);
        });
    }

    buildPaletteMenu() {
        const container = $('paletteListContainer');
        if (!container) return;
        Object.entries(THEMES).forEach(([key, t]) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold transition';
            const swatch = document.createElement('span');
            swatch.className = `w-4 h-4 rounded-full bg-gradient-to-r ${t.bg}`;
            const label = document.createElement('span');
            label.textContent = t.label;
            btn.append(swatch, label);
            btn.addEventListener('click', () => {
                this.applyTheme(key);
                $('paletteMenu').classList.add('hidden');
                this.changed();
                this.showToast(`Applied palette: ${t.label}`);
            });
            container.appendChild(btn);
        });
    }

    attachListeners() {
        CONTACT_FIELDS.forEach(field => {
            const el = $(field);
            if (!el) return;
            el.addEventListener('input', () => {
                if (field === 'street') this.suggestAddresses(el.value);
                this.changed();
            });
        });

        ['phoneWork', 'phoneMobile'].forEach(id => {
            $(id).addEventListener('blur', () => {
                if (!this.formMapper || !$(id).value.trim()) return;
                const fmt = this.formMapper.countryFormats[$('country').value.trim()];
                if (!fmt) return;
                const formatted = this.formMapper.formatPhone($(id).value, fmt);
                if (formatted !== $(id).value) { $(id).value = formatted; this.changed(); }
            });
        });

        $('cardFontSelect').addEventListener('change', (e) => {
            ['cardFront', 'cardBack'].forEach(id => {
                $(id).classList.remove(...FONT_CLASSES);
                $(id).classList.add(e.target.value);
            });
        });

        $('flipCardBtn').addEventListener('click', () => this.toggleFlip());
        $('card3DFlipper').addEventListener('click', () => this.toggleFlip());

        $('paletteDropdownBtn').addEventListener('click', (e) => {
            e.stopPropagation();
            $('paletteMenu').classList.toggle('hidden');
        });
        document.addEventListener('click', () => {
            $('paletteMenu').classList.add('hidden');
            $('addressAutocompleteList').classList.add('hidden');
        });

        $('avatarUpload').addEventListener('change', (e) => {
            const file = e.target.files[0];
            e.target.value = '';
            if (!file) return;
            if (file.size > 2 * 1024 * 1024) { this.showToast('Avatar must be 2 MB or smaller.'); return; }
            const reader = new FileReader();
            reader.onload = (evt) => {
                this.setAvatar(evt.target.result);
                this.changed();
                this.showToast('Avatar attached.');
            };
            reader.readAsDataURL(file);
        });
        $('removeAvatarBtn').addEventListener('click', () => {
            this.setAvatar(null);
            this.changed();
            this.showToast('Avatar removed.');
        });
    }

    async suggestAddresses(query) {
        const list = $('addressAutocompleteList');
        const items = this.addressEngine ? await this.addressEngine.search(query) : [];
        list.replaceChildren();
        if (!items.length) { list.classList.add('hidden'); return; }
        items.forEach(item => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'w-full text-left px-4 py-2.5 text-xs hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors';
            const line1 = document.createElement('div');
            line1.className = 'font-bold';
            line1.textContent = item.street;
            const line2 = document.createElement('div');
            line2.className = 'text-[10px] text-slate-400';
            line2.textContent = `${item.city}, ${item.country}`;
            btn.append(line1, line2);
            btn.addEventListener('click', () => {
                ['street', 'city', 'state', 'zip', 'country'].forEach(f => { $(f).value = item[f]; });
                list.classList.add('hidden');
                this.changed();
                this.showToast('Address filled in.');
            });
            list.appendChild(btn);
        });
        list.classList.remove('hidden');
    }
}
