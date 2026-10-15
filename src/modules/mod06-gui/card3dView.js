/**
 * vCard Generator Engine (vCGE) - vCGE-MOD06 Virtual Business Card GUI
 * Created by raven575, Gemini & Claude
 *
 * Owns the contact form, card preview (3D flip, palettes, typography, avatar) and toasts.
 * Holds contact data in memory only; persistence is the vault's job (wired in src/main.js).
 */
import { CONTACT_FIELDS, createEmptyContact, normalizeContact } from '../../share/cardSchema.js';
import {
    NAME_PREFIXES, NAME_SUFFIXES, UNIT_TYPES, ADDRESS_TYPES, PHONE_TYPES, EMAIL_TYPES, WEBSITE_TYPES, COUNTRIES, REGIONS,
    regionLabels, splitStreetUnit, websiteTypeFor
} from '../../share/contactOptions.js';

export const THEMES = {
    ocean: { label: 'Ocean Blue', bg: 'from-indigo-500 to-blue-600', hex: '#6366f1' },
    emerald: { label: 'Emerald Forest', bg: 'from-emerald-500 to-teal-700', hex: '#10b981' },
    sunset: { label: 'Sunset Coral', bg: 'from-rose-500 to-orange-600', hex: '#f43f5e' },
    violet: { label: 'Royal Violet', bg: 'from-purple-600 to-indigo-800', hex: '#9333ea' },
    slate: { label: 'Monochrome Slate', bg: 'from-slate-700 to-slate-900', hex: '#334155' }
};

const PRESETS = [
    { label: '🤖 AI Research Lead', namePrefix: 'Dr.', firstName: 'Elena', lastName: 'Rostova', nameSuffix: 'PhD', organization: 'NeuralShift AI', jobTitle: 'Principal Research Scientist',
      phones: [{ type: 'work', value: '+1 (415) 888-0199' }, { type: 'mobile', value: '+1 (415) 888-0122' }], emails: [{ type: 'work', value: 'e.rostova@neuralshift.ai' }],
      websites: [{ type: 'work', value: 'https://neuralshift.ai' }, { type: 'linkedin', value: 'https://www.linkedin.com/in/elena-rostova' }],
      addressType: 'work', street: '100 Innovation Way', unitType: 'Suite', unitNumber: '800', city: 'Palo Alto', state: 'CA', zip: '94301', country: 'United States', themePalette: 'violet' },
    { label: '⚖️ Managing Attorney', firstName: 'Marcus', middleName: 'J.', lastName: 'Vance', nameSuffix: 'Esq.', organization: 'Vance & Partners LLP', jobTitle: 'Senior Managing Partner',
      phones: [{ type: 'main', value: '+1 (212) 555-9000' }, { type: 'mobile', value: '+1 (917) 555-4321' }, { type: 'workFax', value: '+1 (212) 555-9001' }],
      emails: [{ type: 'work', value: 'marcus.vance@vancelaw.com' }], websites: [{ type: 'work', value: 'https://vancelaw.com' }],
      addressType: 'work', street: '745 Fifth Avenue', unitType: 'Floor', unitNumber: '28', city: 'New York', state: 'NY', zip: '10151', country: 'United States', themePalette: 'slate' },
    { label: '🎨 UX Architect', firstName: 'Kai', lastName: 'Takahashi', organization: 'Studio Craft', jobTitle: 'Lead Design Architect',
      phones: [{ type: 'mobile', value: '+1 (206) 555-9876' }, { type: 'work', value: '+1 (206) 555-3400' }],
      emails: [{ type: 'work', value: 'kai@studiocraft.design' }, { type: 'personal', value: 'kai.takahashi@gmail.com' }],
      websites: [{ type: 'portfolio', value: 'https://studiocraft.design' }, { type: 'instagram', value: 'https://instagram.com/studiocraft' }],
      addressType: 'work', street: '1201 3rd Ave', unitType: 'Studio', unitNumber: '12', city: 'Seattle', state: 'WA', zip: '98101', country: 'United States', themePalette: 'ocean' }
];

// Typed list editors (phones, emails, websites): container, row id prefix, type choices, input type and the add button.
const LISTS = {
    phones: { container: 'phoneList', id: 'phone', noun: 'phone', types: PHONE_TYPES, input: 'tel', placeholder: 'Phone number', add: 'addPhoneBtn' },
    emails: { container: 'emailList', id: 'email', noun: 'email', types: EMAIL_TYPES, input: 'email', placeholder: 'name@example.com', add: 'addEmailBtn' },
    websites: { container: 'websiteList', id: 'website', noun: 'website', types: WEBSITE_TYPES, input: 'url', placeholder: 'example.com or a profile link', add: 'addWebsiteBtn' }
};
const digitsOrLower = (v) => (/\d{7}/.test(v.replace(/\D/g, '')) ? v.replace(/\D/g, '') : v.trim().toLowerCase());

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
        this.avatarBase64 = null;   // logo as the vCard PHOTO (square JPEG)
        this.logoDisplay = null;    // logo as shown on the card (trimmed, own shape, transparency kept)
        this.logoLook = null;       // { wide, transparent, tone } of logoDisplay, worked out when it is set
        this.themeKey = 'ocean';
        this.fontClass = 'font-sans';
        this.isFlipped = false;
        this.toastTimer = null;
        this.undoSnapshot = null;   // the card before the last preset / scan fill / clear (memory only)
    }

    init() {
        this.buildOptionLists();
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
        Object.keys(LISTS).forEach(key => { contact[key] = this.readList(key).filter(e => e.value); });
        contact.avatarBase64 = this.avatarBase64;
        contact.logoDisplay = this.logoDisplay;
        contact.themePalette = this.themeKey;
        contact.cardFont = this.fontClass;
        return contact;
    }

    setContact(contact = {}) {
        const c = normalizeContact(contact);
        CONTACT_FIELDS.forEach(field => {
            const el = $(field);
            if (el) el.value = c[field] || '';
        });
        this.ensureCountryOption(c.country);
        $('country').value = c.country;
        this.syncRegion();
        Object.keys(LISTS).forEach(key => this.renderList(key, c[key]));
        this.setAvatar(c.avatarBase64 || null, c.logoDisplay || null);
        this.applyTheme(c.themePalette in THEMES ? c.themePalette : 'ocean');
        this.applyFont(c.cardFont);
    }

    /**
     * Fills the fields that have a value (used for OCR results); a name or address in the result replaces the whole
     * name or address. For each list entry: a row with the same value is left alone, a row of the same type gets the
     * new value, else an empty row is used, else a row is added.
     */
    mergeContact(partial = {}) {
        const p = normalizeContact(partial);
        // A name or an address is replaced as a whole, so no part of the previous one (a prefix, a suite) is left behind.
        const groups = [
            ['namePrefix', 'firstName', 'middleName', 'lastName', 'nameSuffix'],
            ['street', 'unitType', 'unitNumber', 'city', 'state', 'zip', 'country']
        ];
        const replaceAll = new Set(groups.filter(g => g.some(f => partial[f] && f !== 'country')).flat());
        CONTACT_FIELDS.forEach(field => {
            const el = $(field);
            if (el && (partial[field] || replaceAll.has(field))) el.value = p[field] || '';
        });
        if (partial.country || replaceAll.has('country')) { this.ensureCountryOption(p.country); $('country').value = p.country; }
        this.syncRegion();
        Object.keys(LISTS).forEach(key => {
            const rows = this.readList(key), written = new Set();
            p[key].forEach(entry => {
                if (rows.some(r => r.value && digitsOrLower(r.value) === digitsOrLower(entry.value))) return;
                let i = rows.findIndex((r, n) => r.type === entry.type && !written.has(n));
                if (i < 0) i = rows.findIndex((r, n) => !r.value && !written.has(n));
                if (i < 0) { rows.push({ ...entry }); i = rows.length - 1; } else rows[i] = { ...entry };
                written.add(i);
            });
            this.renderList(key, rows);
        });
        this.changed();
    }

    // ---- Typed lists (phones, emails, websites) ---------------------------------------------------------------

    readList(key) {
        const { container, id } = LISTS[key];
        return Array.from($(container).children).map((row, i) => ({
            type: $(`${id}Type${i}`).value,
            value: $(`${id}Value${i}`).value.trim()
        }));
    }

    renderList(key, entries = []) {
        const cfg = LISTS[key];
        const rows = entries.length ? entries : [{ type: cfg.types[0][0], value: '' }];
        $(cfg.container).replaceChildren(...rows.map((entry, i) => {
            const row = document.createElement('div');
            row.className = 'flex gap-2 items-center';
            const type = document.createElement('select');
            type.id = `${cfg.id}Type${i}`;
            type.className = 'field-input w-36 shrink-0';
            type.setAttribute('aria-label', `${cfg.noun} ${i + 1} type`);
            cfg.types.forEach(([value, label]) => type.add(new Option(label, value, false, value === entry.type)));
            if (!cfg.types.some(([v]) => v === entry.type)) type.value = cfg.types.some(([v]) => v === 'other') ? 'other' : cfg.types[0][0];
            const value = document.createElement('input');
            value.id = `${cfg.id}Value${i}`;
            value.type = cfg.input;
            value.autocomplete = 'off';
            value.className = 'field-input flex-1 min-w-0';
            value.placeholder = cfg.placeholder;
            value.value = entry.value || '';
            value.setAttribute('aria-label', `${cfg.noun} ${i + 1}`);
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.id = `${cfg.id}Remove${i}`;
            remove.className = 'px-2 py-1 rounded-lg text-slate-400 hover:text-rose-500 transition';
            remove.textContent = '×';
            remove.setAttribute('aria-label', `Remove ${cfg.noun} ${i + 1}`);
            type.addEventListener('change', () => this.changed());
            value.addEventListener('input', () => this.changed());
            value.addEventListener('blur', () => this.tidyListValue(key, i));
            remove.addEventListener('click', () => {
                const list = this.readList(key);
                list.splice(i, 1);
                this.renderList(key, list);
                this.changed();
            });
            row.append(type, value, remove);
            return row;
        }));
    }

    addListRow(key) {
        const cfg = LISTS[key];
        const list = this.readList(key);
        const used = new Set(list.map(e => e.type));
        const type = (cfg.types.find(([v]) => !used.has(v)) || cfg.types[0])[0];
        list.push({ type, value: '' });
        this.renderList(key, list);
        $(`${cfg.id}Value${list.length - 1}`).focus();
    }

    // On leaving a value: format phone numbers for the country; recognise social-profile links.
    tidyListValue(key, i) {
        const input = $(`${LISTS[key].id}Value${i}`);
        if (!input || !input.value.trim()) return;
        if (key === 'phones' && this.formMapper) {
            const fmt = this.formMapper.countryFormats[$('country').value.trim()];
            const formatted = fmt ? this.formMapper.formatPhone(input.value, fmt) : input.value;
            if (formatted !== input.value) { input.value = formatted; this.changed(); }
        }
        if (key === 'websites') {
            const social = websiteTypeFor(input.value), type = $(`websiteType${i}`);
            // Only a generic type is replaced, never one the user picked deliberately (Blog, Portfolio, another network).
            if (social && ['work', 'personal', 'other'].includes(type.value)) { type.value = social; this.changed(); }
        }
    }

    // ---- Country, region and option lists -------------------------------------------------------------------

    buildOptionLists() {
        const fill = (id, values) => $(id).replaceChildren(...values.map(v => new Option(v, v)));
        fill('namePrefixOptions', NAME_PREFIXES);
        fill('nameSuffixOptions', NAME_SUFFIXES);
        fill('unitTypeOptions', UNIT_TYPES);
        $('addressType').replaceChildren(...ADDRESS_TYPES.map(([v, label]) => new Option(label, v)));
        $('country').replaceChildren(...COUNTRIES.map(c => new Option(c, c)));
        Object.keys(LISTS).forEach(key => this.renderList(key, []));
        this.setContact(createEmptyContact());
    }

    ensureCountryOption(country) {
        if (country && !Array.from($('country').options).some(o => o.value === country)) $('country').add(new Option(country, country));
    }

    /** Shows a region picker (countries with a region list) or a text box, with the country's labels. */
    syncRegion() {
        const country = $('country').value;
        const labels = regionLabels(country);
        $('stateLabel').textContent = labels.label;
        $('zipLabel').textContent = labels.postalLabel;
        const regions = REGIONS[country] && REGIONS[country].regions;
        $('stateSelect').classList.toggle('hidden', !regions);
        $('stateText').classList.toggle('hidden', !!regions);
        if (regions) {
            if (this.regionCountry !== country) {
                $('stateSelect').replaceChildren(new Option(`Choose ${labels.label.toLowerCase()}`, ''), ...regions.map(([code, name]) => new Option(name, code)));
                this.regionCountry = country;
            }
            const state = $('state').value.trim();
            const match = regions.find(([code, name]) => code.toLowerCase() === state.toLowerCase() || name.toLowerCase() === state.toLowerCase());
            $('state').value = match ? match[0] : '';
            $('stateSelect').value = $('state').value;
        } else {
            this.regionCountry = null;
            $('stateText').value = $('state').value;
        }
    }

    /** Empties the card, back to the default look: front side up, Ocean palette, Sans typeface. */
    clear() {
        this.setContact(createEmptyContact());
        this.setFlipped(false);
    }

    changed() {
        this.onChange(this.getContact());
    }

    // ---- Rendering -----------------------------------------------------------------------------------------

    render(contact) {
        const fullName = [contact.namePrefix, contact.firstName, contact.middleName, contact.lastName].filter(Boolean).join(' ')
            + (contact.nameSuffix ? `, ${contact.nameSuffix}` : '') || 'New Contact';
        const first = (key) => ((contact[key] || [])[0] || {}).value || '';
        const unit = contact.unitType ? [contact.unitType, contact.unitNumber].filter(Boolean).join(' ') : '';
        $('previewFullName').textContent = fullName;
        $('previewOrg').textContent = contact.organization || 'Company Name';
        $('previewTitle').textContent = contact.jobTitle || 'Job Title';
        $('previewPhone').textContent = first('phones') || 'No phone number';
        $('previewEmail').textContent = first('emails') || 'No email address';
        $('previewAddress').textContent = [contact.street, unit, contact.city, contact.state].filter(Boolean).join(', ') || 'No address provided';
        $('previewWebsite').textContent = first('websites') || 'No website';
        $('backCardName').textContent = fullName;

        const initials = (contact.firstName && contact.lastName)
            ? (contact.firstName[0] + contact.lastName[0]).toUpperCase() : 'VC';
        // A wide logo (a wordmark) gets a strip across the top of the card, where it is readable. The printed card has
        // no room for the strip, so there the logo stays in the badge.
        const wide = !!(this.logoDisplay && this.logoLook && this.logoLook.wide);
        this.renderLogoStrip($('previewLogoStrip'), wide);
        this.renderAvatarBox($('previewAvatar'), initials, `w-16 h-16 text-2xl${wide ? ' hidden print:flex' : ''}`);
        this.renderAvatarBox($('formAvatarPreview'), initials, 'w-14 h-14 text-xl');
    }

    renderAvatarBox(box, initials, sizeClasses) {
        if (!box) return;
        const t = THEMES[this.themeKey];
        const base = `${sizeClasses} rounded-2xl flex items-center justify-center overflow-hidden flex-shrink-0`;
        box.replaceChildren();
        const logo = this.logoDisplay || this.avatarBase64;
        if (!logo) {
            box.className = `${base} bg-gradient-to-tr ${t.bg} text-white font-bold shadow-lg`;
            box.textContent = initials;
            return;
        }
        box.className = `${base} ${this.logoBacking()}`;
        box.appendChild(logoImage(logo, 'w-full h-full object-contain'));
    }

    renderLogoStrip(strip, show) {
        if (!strip) return;
        if (!show) {
            strip.className = 'hidden';
            strip.replaceChildren();
            return;
        }
        // A line of its own in the card's top row; hidden when printing, which takes away its gap too.
        strip.className = 'basis-full print:hidden';
        const plate = document.createElement('div');
        plate.className = `h-12 w-fit max-w-full rounded-xl overflow-hidden ${this.logoBacking()}`;
        plate.appendChild(logoImage(this.logoDisplay, 'h-full w-auto max-w-full object-contain'));
        strip.replaceChildren(plate);
    }

    /**
     * What goes behind the logo. A transparent logo sits straight on the card, except: a mostly light one (it would
     * vanish on the white card) gets a plate in the palette colour, and a mostly dark one gets a white plate in dark
     * mode. An opaque logo brings its own background.
     */
    logoBacking() {
        const look = this.logoDisplay && this.logoLook;
        if (!look || !look.transparent) return 'shadow-lg';
        if (look.tone === 'light') return `bg-gradient-to-tr ${THEMES[this.themeKey].bg} p-1.5 shadow-lg`;
        if (look.tone === 'dark') return 'p-1.5 dark:bg-white';
        return '';
    }

    applyTheme(themeKey) {
        this.themeKey = THEMES[themeKey] ? themeKey : 'ocean';
        const t = THEMES[this.themeKey];
        $('currentPaletteLabel').textContent = t.label;
        $('paletteSwatch').style.background = t.hex;
    }

    applyFont(fontClass) {
        this.fontClass = FONT_CLASSES.includes(fontClass) ? fontClass : 'font-sans';
        $('cardFontSelect').value = this.fontClass;
        ['cardFront', 'cardBack'].forEach(id => {
            $(id).classList.remove(...FONT_CLASSES);
            $(id).classList.add(this.fontClass);
        });
    }

    /**
     * @param {string|null} photo    the square JPEG (vCard PHOTO)
     * @param {string|null} display  the trimmed logo for the card; without it the card shows the photo
     */
    setAvatar(photo, display = null) {
        this.avatarBase64 = photo;
        this.logoDisplay = photo ? display : null;
        this.logoLook = null;
        $('removeAvatarBtn').classList.toggle('hidden', !photo);
        if (!this.logoDisplay) return;
        // Its shape and tone take a moment to read; the card is drawn again once they are known.
        const shown = this.logoDisplay;
        describeLogo(shown).then(look => {
            if (this.logoDisplay !== shown) return;
            this.logoLook = look;
            this.render(this.getContact());
        }).catch(err => console.warn('[vCGE] Logo shape not readable:', err));
    }

    setFlipped(flipped) {
        this.isFlipped = flipped;
        $('card3DFlipper').style.transform = flipped ? 'rotateY(180deg)' : 'rotateY(0deg)';
    }

    toggleFlip() {
        this.setFlipped(!this.isFlipped);
    }

    /** @param {{ label: string, onClick: Function }} [action] a button in the toast (shown for 8 s instead of 3 s) */
    showToast(msg, action = null) {
        const t = $('toast');
        if (!t) return;
        $('toastMessage').textContent = msg;
        const button = $('toastAction');
        button.classList.toggle('hidden', !action);
        button.onclick = action ? () => { this.hideToast(); action.onClick(); } : null;
        if (action) button.textContent = action.label;
        t.classList.remove('translate-y-20', 'opacity-0', 'pointer-events-none');
        clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(() => this.hideToast(), action ? 8000 : 3000);
    }

    hideToast() {
        clearTimeout(this.toastTimer);
        $('toast').classList.add('translate-y-20', 'opacity-0', 'pointer-events-none');
        $('toastAction').onclick = null;
    }

    /**
     * Runs a change that replaces form contents (preset, scan fill, clear) and offers Undo in the toast.
     * The previous card is kept in memory only until the next such change, Undo, or forgetUndo().
     */
    changeWithUndo(message, apply) {
        this.undoSnapshot = this.getContact();
        apply();
        this.changed();
        this.showToast(message, {
            label: 'Undo',
            onClick: () => {
                if (!this.undoSnapshot) return;
                this.setContact(this.undoSnapshot);
                this.undoSnapshot = null;
                this.changed();
                this.showToast('Undone.');
            }
        });
    }

    /** Drops the Undo copy (on lock, idle purge and wipe). */
    forgetUndo() {
        this.undoSnapshot = null;
        this.hideToast();
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
                this.changeWithUndo(`Loaded sample: ${preset.firstName} ${preset.lastName}`,
                    () => this.setContact({ ...createEmptyContact(), ...preset, avatarBase64: this.avatarBase64, logoDisplay: this.logoDisplay, cardFont: this.fontClass }));
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

        Object.entries(LISTS).forEach(([key, cfg]) => $(cfg.add).addEventListener('click', () => { this.addListRow(key); this.changed(); }));
        $('country').addEventListener('change', () => { this.syncRegion(); this.changed(); });
        $('stateSelect').addEventListener('change', () => { $('state').value = $('stateSelect').value; this.changed(); });
        $('stateText').addEventListener('input', () => { $('state').value = $('stateText').value; this.changed(); });

        $('cardFontSelect').addEventListener('change', (e) => {
            this.applyFont(e.target.value);
            this.changed();
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
            reader.onload = async (evt) => {
                let logo;
                try {
                    logo = await prepareLogo(evt.target.result);
                } catch (err) {
                    console.warn('[vCGE] Avatar not readable:', err);
                    this.showToast('That file could not be read as an image.');
                    return;
                }
                this.setAvatar(logo.photo, logo.display);
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
                const { street, unitType, unitNumber } = splitStreetUnit(item.street);
                Object.assign(item, { street, unitType, unitNumber });
                ['street', 'unitType', 'unitNumber', 'city', 'state', 'zip'].forEach(f => { $(f).value = item[f]; });
                this.ensureCountryOption(item.country);
                $('country').value = item.country;
                this.syncRegion();
                list.classList.add('hidden');
                this.changed();
                this.showToast('Address filled in.');
            });
            list.appendChild(btn);
        });
        list.classList.remove('hidden');
    }
}

// ---- Logo preparation ----------------------------------------------------------------------------------------

const LOGO_SIZE = 256;          // the vCard PHOTO: a square JPEG
const LOGO_DISPLAY_MAX = 512;   // the card copy: longest side in px
const WIDE_LOGO = 2;            // width / height from which a logo is a wordmark and gets the strip across the card

function logoImage(src, className) {
    const img = document.createElement('img');
    img.src = src;
    img.alt = '';
    img.className = className;
    return img;
}

function canvasOf(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
}

/**
 * Any image the browser can draw (PNG, JPEG, GIF, WebP, SVG), made ready for the card:
 * - display: trimmed to the logo itself (empty or plain margins cut off), in its own shape, at most 512 px on the
 *   long side; PNG with its transparency when it has any, else JPEG. Shown on the card only.
 * - photo: the same trimmed logo fitted with a margin (never cropped) in a 256 px square JPEG on an opaque
 *   background: the logo's own edge colour, or for a transparent logo white, or dark slate when it is mostly light.
 *   This is the vCard PHOTO, which contact apps show square.
 * A canvas the page may not read back (a tainted SVG) throws, and the caller reports the file as unreadable.
 * @param {string} dataUrl
 * @returns {Promise<{ photo: string, display: string }>}
 */
export async function prepareLogo(dataUrl) {
    const { img, w, h, vector } = await loadLogo(dataUrl);
    // A drawing is redrawn at full size; a picture is only ever made smaller.
    const k = vector ? LOGO_DISPLAY_MAX / Math.max(w, h) : Math.min(1, LOGO_DISPLAY_MAX / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * k)), ch = Math.max(1, Math.round(h * k));
    const work = canvasOf(cw, ch);
    const wctx = work.getContext('2d', { willReadFrequently: true });
    wctx.drawImage(img, 0, 0, cw, ch);
    const px = wctx.getImageData(0, 0, cw, ch).data;
    const box = logoBounds(px, cw, ch);

    const display = canvasOf(box.w, box.h);
    display.getContext('2d').drawImage(work, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
    const displayUrl = box.transparent ? display.toDataURL('image/png') : display.toDataURL('image/jpeg', 0.92);

    const background = box.transparent ? (toneOf(px, cw, box) === 'light' ? '#1e293b' : '#ffffff') : box.edge;
    const margin = Math.round(LOGO_SIZE * 0.08), fit = Math.min((LOGO_SIZE - 2 * margin) / box.w, (LOGO_SIZE - 2 * margin) / box.h);
    const dw = Math.round(box.w * fit), dh = Math.round(box.h * fit);
    const out = canvasOf(LOGO_SIZE, LOGO_SIZE);
    const ctx = out.getContext('2d');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, LOGO_SIZE, LOGO_SIZE);
    ctx.drawImage(display, Math.round((LOGO_SIZE - dw) / 2), Math.round((LOGO_SIZE - dh) / 2), dw, dh);
    const photo = out.toDataURL('image/jpeg', 0.9);

    [work, display, out].forEach(c => { c.width = c.height = 0; });
    return { photo, display: displayUrl };
}

/**
 * Shape and tone of a prepared display logo, for the card layout: { wide, transparent, tone } where tone is 'light'
 * or 'dark' when most of the logo is, else null.
 * @param {string} displayUrl
 */
export async function describeLogo(displayUrl) {
    const { img, w, h } = await loadLogo(displayUrl);
    const k = Math.min(1, 128 / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * k)), ch = Math.max(1, Math.round(h * k));
    const c = canvasOf(cw, ch);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, cw, ch);
    const px = ctx.getImageData(0, 0, cw, ch).data;
    c.width = c.height = 0;
    return { wide: w / h >= WIDE_LOGO, transparent: isTransparent(px, cw * ch), tone: toneOf(px, cw, { x: 0, y: 0, w: cw, h: ch }) };
}

async function loadLogo(dataUrl) {
    const vector = /^data:image\/svg\+xml/i.test(dataUrl);
    const img = new Image();
    img.src = vector ? sizedSvg(dataUrl) : dataUrl;
    await img.decode();
    // Should a browser still report no size for an SVG, it is drawn as a square.
    return { img, w: img.naturalWidth || LOGO_SIZE, h: img.naturalHeight || LOGO_SIZE, vector };
}

/**
 * The SVG with its width and height written in, taken from its viewBox. Browsers differ on an SVG that has only a
 * viewBox (some report no size, and it would be drawn square and squashed), so its own shape is made explicit.
 * Returns the SVG unchanged when it already has a size in pixels or cannot be read.
 */
function sizedSvg(dataUrl) {
    try {
        const comma = dataUrl.indexOf(',');
        const meta = dataUrl.slice(0, comma), body = dataUrl.slice(comma + 1);
        const text = /;base64/i.test(meta)
            ? new TextDecoder().decode(Uint8Array.from(atob(body), ch => ch.charCodeAt(0)))
            : decodeURIComponent(body);
        const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
        const root = doc.documentElement;
        if (!root || root.localName !== 'svg' || doc.getElementsByTagName('parsererror').length) return dataUrl;
        const px = (v) => (/^\s*\d*\.?\d+\s*(px)?\s*$/.test(v || '') ? parseFloat(v) : 0);
        let w = px(root.getAttribute('width')), h = px(root.getAttribute('height'));
        if (w && h) return dataUrl;
        const vb = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
        if (vb.length !== 4 || !(vb[2] > 0) || !(vb[3] > 0)) return dataUrl;
        if (w) h = w * vb[3] / vb[2];
        else if (h) w = h * vb[2] / vb[3];
        else { w = vb[2]; h = vb[3]; }
        root.setAttribute('width', String(w));
        root.setAttribute('height', String(h));
        let bin = '';
        new TextEncoder().encode(new XMLSerializer().serializeToString(root)).forEach(b => { bin += String.fromCharCode(b); });
        return `data:image/svg+xml;base64,${btoa(bin)}`;
    } catch (e) {
        return dataUrl;
    }
}

const isTransparent = (px, count) => {
    let clear = 0;
    for (let i = 3; i < px.length; i += 4) if (px[i] < 250) clear++;
    return clear > count / 100;
};

/**
 * The part of the image that is the logo: for a transparent image what is not see-through, for an opaque one what
 * differs from the colour of its edges; with a small margin. Also says if the image is transparent and, if not, its
 * edge colour (the background for the square photo).
 */
export function logoBounds(px, w, h) {
    const transparent = isTransparent(px, w * h);
    const edge = [0, 0, 0];
    if (!transparent) {
        let n = 0;
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                if (y !== 0 && y !== h - 1 && x !== 0 && x !== w - 1) continue;
                const k = (y * w + x) * 4;
                edge[0] += px[k]; edge[1] += px[k + 1]; edge[2] += px[k + 2]; n++;
            }
        }
        for (let i = 0; i < 3; i++) edge[i] = Math.round(edge[i] / n);
    }
    const ink = transparent
        ? (k) => px[k + 3] > 16
        : (k) => Math.abs(px[k] - edge[0]) + Math.abs(px[k + 1] - edge[1]) + Math.abs(px[k + 2] - edge[2]) > 60;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            if (!ink((y * w + x) * 4)) continue;
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
        }
    }
    const result = { transparent, edge: `rgb(${edge.join(',')})` };
    if (x1 < 0) return { ...result, x: 0, y: 0, w, h };
    const pad = Math.max(2, Math.round(Math.max(x1 - x0 + 1, y1 - y0 + 1) * 0.04));
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
    x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
    return { ...result, x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** 'light' or 'dark' when more than 60% of the logo's solid pixels are, else null. */
export function toneOf(px, w, box) {
    let solid = 0, light = 0, dark = 0;
    for (let y = box.y; y < box.y + box.h; y++) {
        for (let x = box.x; x < box.x + box.w; x++) {
            const k = (y * w + x) * 4;
            if (px[k + 3] <= 128) continue;
            solid++;
            const luma = 0.2126 * px[k] + 0.7152 * px[k + 1] + 0.0722 * px[k + 2];
            if (luma > 160) light++;
            else if (luma < 90) dark++;
        }
    }
    if (!solid) return null;
    return light / solid > 0.6 ? 'light' : dark / solid > 0.6 ? 'dark' : null;
}
