/**
 * vCard Generator Engine (vCGE) - vCGE-MOD06 3D Card ("Flipside")
 * Created by raven575, Gemini & Claude
 *
 * Owns the contact form, the card (3D spin, fall palettes, typography, logo) and the toasts.
 * Holds contact data in memory only; persistence is the vault's job (wired in src/main.js).
 * Redesign step 8: eight fall themes that colour the whole card face, the logo traced on the device into the theme's
 * ink colour (a white background removed first), every phone, email and site on the card, swipe-to-spin, toasts at the
 * top, and the nine Team vCGE pilots as sample contacts.
 */
import { CONTACT_FIELDS, createEmptyContact, normalizeContact } from '../../share/cardSchema.js';
import {
    NAME_PREFIXES, NAME_SUFFIXES, UNIT_TYPES, ADDRESS_TYPES, PHONE_TYPES, EMAIL_TYPES, WEBSITE_TYPES, COUNTRIES, REGIONS,
    regionLabels, splitStreetUnit, websiteTypeFor
} from '../../share/contactOptions.js';

// The fall palettes (raven575, redesign plan): a card colour, an ink colour for the text and an accent for the initials
// badge and the logo plate. Ink on card reads at 4.5:1 or better, card on accent at 3:1 or better (checked by the unit tests).
export const THEMES = {
    pumpkin:   { label: 'Pumpkin',      card: '#e8792b', ink: '#2a1407', accent: '#7a3309' },
    maple:     { label: 'Maple',        card: '#8f2318', ink: '#fff1e4', accent: '#f0b36a' },
    harvest:   { label: 'Harvest Gold', card: '#dea52c', ink: '#2b1f05', accent: '#6e4402' },
    cranberry: { label: 'Cranberry',    card: '#6a1030', ink: '#fde9f0', accent: '#f4a2bd' },
    spruce:    { label: 'Spruce',       card: '#1f4b3a', ink: '#e9f4ee', accent: '#9bd3b3' },
    sage:      { label: 'Sage',         card: '#b9c6a8', ink: '#1f2a1c', accent: '#3f5a36' },
    slateblue: { label: 'Slate Blue',   card: '#3e5572', ink: '#eef3f9', accent: '#a9c6e3' },
    twilight:  { label: 'Twilight',     card: '#2a2450', ink: '#ece8fa', accent: '#bba9f2' }
};
export const DEFAULT_THEME = 'slateblue';
// The five palettes before the redesign, so a card held through a lock or an Undo keeps a colour.
const LEGACY_THEMES = { ocean: 'slateblue', emerald: 'spruce', sunset: 'pumpkin', violet: 'twilight', slate: 'slateblue' };
export const themeKeyOf = (key) => (THEMES[key] ? key : (LEGACY_THEMES[key] || DEFAULT_THEME));

// Sample contacts, as data: the Fields card (MOD05) lists them under "Insert Fake Contact?" and calls loadSample().
// The nine pilots of Team vCGE, with the reserved fictional numbers (555-01xx) and example.com, and the roster's animal
// as the logo (bundled Noto Emoji, src/vendor/icons/animals/; where Noto has no such animal the nearest stands in).
const ANIMALS = 'src/vendor/icons/animals/';
const pilot = (n, firstName, lastName, jobTitle, logo, themePalette, extra = {}) => ({
    label: `MOD${n} ${firstName}`, firstName, lastName, organization: 'Team vCGE', jobTitle,
    phones: [{ type: 'mobile', value: `+1 (202) 555-01${n}` }, ...(extra.phones || [])],
    emails: [{ type: 'work', value: `${firstName.toLowerCase()}@example.com` }],
    websites: [{ type: 'work', value: `https://example.com/team-vcge/${firstName.toLowerCase()}` }, ...(extra.websites || [])],
    addressType: 'work', street: '8 Formation Way', unitType: 'Hangar', unitNumber: String(Number(n)), city: 'Hollowpoint City', state: 'OH', zip: '44101',
    country: 'United States', themePalette, logo: `${ANIMALS}${logo}.svg`, ...extra.fields
});
export const PRESETS = [
    pilot('01', 'Shutout', 'Box Turtle', 'Shell pilot: egress lock and theme', 'turtle', 'spruce',
        { phones: [{ type: 'work', value: '+1 (202) 555-0111' }] }),
    pilot('02', 'Ghost', 'Raccoon', 'Vault pilot: the temporary hub', 'raccoon', 'twilight'),
    pilot('03', 'Iris', 'Lynx', 'Camera pilot: one clean shot', 'cat', 'pumpkin',
        { websites: [{ type: 'instagram', value: 'https://instagram.com/example' }] }),
    pilot('04', 'Glyph', 'Owl', 'OCR pilot: photo to text, on the device', 'owl', 'harvest',
        { fields: { namePrefix: 'Dr.' } }),
    pilot('05', 'Pidge', 'Octopus', 'Field mapping pilot: every line in its slot', 'octopus', 'slateblue',
        { phones: [{ type: 'work', value: '+1 (202) 555-0155' }, { type: 'workFax', value: '+1 (202) 555-0156' }] }),
    pilot('06', 'Flipside', 'Chameleon', '3D Card pilot: colours, logo and sparkle', 'lizard', 'sage'),
    pilot('07', 'Checkers', 'Zebra', 'QR pilot: a whole person in a square', 'zebra', 'cranberry'),
    pilot('08', 'Airlock', 'Falcon', 'Export pilot: the one hatch out', 'eagle', 'maple',
        { phones: [{ type: 'main', value: '+1 (202) 555-0180' }] }),
    pilot('00', 'Cornerstone', 'Elephant', 'Project Manager: holds the formation', 'elephant', 'slateblue',
        { fields: { label: 'PM Cornerstone', nameSuffix: 'PM' } })
];

// Typed list editors (phones, emails, websites): container, row id prefix, type choices, input type and the add button.
const LISTS = {
    phones: { container: 'phoneList', id: 'phone', noun: 'phone', types: PHONE_TYPES, input: 'tel', placeholder: 'Phone number', add: 'addPhoneBtn', preview: 'previewPhones', empty: 'No phone number' },
    emails: { container: 'emailList', id: 'email', noun: 'email', types: EMAIL_TYPES, input: 'email', placeholder: 'name@example.com', add: 'addEmailBtn', preview: 'previewEmails', empty: 'No email address' },
    websites: { container: 'websiteList', id: 'website', noun: 'website', types: WEBSITE_TYPES, input: 'url', placeholder: 'example.com or a profile link', add: 'addWebsiteBtn', preview: 'previewWebsites', empty: 'No website' }
};
export const PRINT_LINES_EACH = 2;   // the printed card (3.5 x 2 in, MOD08) has room for this many of each list
const digitsOrLower = (v) => (/\d{7}/.test(v.replace(/\D/g, '')) ? v.replace(/\D/g, '') : v.trim().toLowerCase());

const FONT_CLASSES = ['font-sans', 'font-serif', 'font-mono'];
const $ = (id) => document.getElementById(id);

// Motion (shared rule, same numbers as mod03-camera/viewfinder.js): stepped at 26 fps, a 5 percent snap past the target.
export const STEP_FPS = 26;
export const OVERSHOOT = 0.05;
export const SPIN_MS = 420;              // a flip or the settle after a drag
const SPIN_TAP_PX = 8;                   // a drag shorter than this is a tap
export const EDGE_PX = 48;               // no drag within this much of the screen edge (browser back gesture)
const BACK = (() => { let lo = 0, hi = 4; for (let i = 0; i < 40; i++) { const c = (lo + hi) / 2; if (2 * c * c * c / (27 * (c + 1) * (c + 1)) < OVERSHOOT) lo = c; else hi = c; } return (lo + hi) / 2; })();
export function easeSnap(t) {
    const p = Math.max(0, Math.min(1, t));
    if (p < 0.5) return 2 * p * p;
    const q = (p - 0.5) / 0.5 - 1;
    return 0.5 + 0.5 * (1 + (BACK + 1) * q * q * q + BACK * q * q);
}
export function tween(from, to, ms, apply, { instant = false, now = () => Date.now(), schedule = setTimeout, cancel = clearTimeout } = {}) {
    if (instant || !(ms > 0) || from === to) { apply(to); return () => {}; }
    const t0 = now();
    let timer = null;
    const step = () => {
        const p = (now() - t0) / ms;
        if (p >= 1) { apply(to); timer = null; return; }
        apply(from + (to - from) * easeSnap(p));
        timer = schedule(step, 1000 / STEP_FPS);
    };
    timer = schedule(step, 1000 / STEP_FPS);
    return () => { if (timer !== null) { cancel(timer); timer = null; } };
}
const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const TOAST_MS = 3000;            // a plain toast; one with a button (Undo) stays 8 s
const TOAST_ACTION_MS = 8000;
export const TOAST_HOLD_MS = 400;  // a press this long is a hold, not a tap

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
        this.logoDisplay = null;    // logo as shown on the card: a two-colour trace (SVG) in the ink colour, else trimmed with its transparency
        this.logoLook = null;       // { wide, transparent, tone, traced } of logoDisplay, worked out when it is set
        this.themeKey = DEFAULT_THEME;
        this.fontClass = 'font-sans';
        this.isFlipped = false;
        this.angle = 0;             // the card's turn in degrees (0 front, 180 back)
        this.stopSpin = null;
        this.toastTimer = null;
        this.toastMs = TOAST_MS;
        this.undoSnapshot = null;   // the card before the last preset / scan fill / clear (memory only)
        this.undoWasSample = false;
        this.holdsSample = false;   // the card is a sample preset: the next scan fill replaces it instead of merging
        this.sampleLogoToken = 0;
    }

    init() {
        this.buildOptionLists();
        this.buildPaletteMenu();
        this.attachListeners();
        this.applyTheme(this.themeKey);
        this.setAngle(0);
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
        this.applyTheme(themeKeyOf(c.themePalette));
        this.applyFont(c.cardFont);
        this.holdsSample = false;
    }

    /**
     * Fills the fields that have a value (used for OCR results); a name or address in the result replaces the whole
     * name or address. For each list entry: a row with the same value is left alone, a row of the same type gets the
     * new value, else an empty row is used, else a row is added.
     * A sample preset is replaced as a whole instead (none of its data is left behind); the logo, palette and
     * typeface stay.
     */
    mergeContact(partial = {}) {
        if (this.holdsSample) {
            this.setContact({ ...createEmptyContact(), avatarBase64: this.avatarBase64, logoDisplay: this.logoDisplay,
                themePalette: this.themeKey, cardFont: this.fontClass });
        }
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

    /** Empties the card, back to the default look: front side up, the default palette, Sans typeface. */
    clear() {
        this.setContact(createEmptyContact());
        this.setFlipped(false, { instant: true });
    }

    changed() {
        this.onChange(this.getContact());
    }

    // ---- Rendering -----------------------------------------------------------------------------------------

    render(contact) {
        const fullName = [contact.namePrefix, contact.firstName, contact.middleName, contact.lastName].filter(Boolean).join(' ')
            + (contact.nameSuffix ? `, ${contact.nameSuffix}` : '') || 'New Contact';
        const unit = contact.unitType ? [contact.unitType, contact.unitNumber].filter(Boolean).join(' ') : '';
        $('previewFullName').textContent = fullName;
        $('previewOrg').textContent = contact.organization || 'Company Name';
        $('previewTitle').textContent = contact.jobTitle || 'Job Title';
        Object.entries(LISTS).forEach(([key, cfg]) => this.renderLines($(cfg.preview), contact[key] || [], cfg));
        $('previewAddress').textContent = [contact.street, unit, contact.city, contact.state].filter(Boolean).join(', ') || 'No address provided';
        $('backCardName').textContent = fullName;

        const initials = (contact.firstName && contact.lastName)
            ? (contact.firstName[0] + contact.lastName[0]).toUpperCase() : 'VC';
        // A wide logo (a wordmark) gets a strip across the top of the card, where it is readable. The printed card has
        // no room for the strip, so there the logo stays in the badge.
        const wide = !!(this.logoDisplay && this.logoLook && this.logoLook.wide);
        this.renderLogoStrip($('previewLogoStrip'), wide);
        this.renderAvatarBox($('previewAvatar'), initials, `w-16 h-16 text-2xl${wide ? ' hidden print:flex' : ''}`);
        this.renderAvatarBox($('formAvatarPreview'), initials, 'w-11 h-11 text-lg');
    }

    /** Every entry of a list on the card, each with its type label; past PRINT_LINES_EACH a line is left off the printed card. */
    renderLines(box, entries, cfg) {
        if (!box) return;
        const shown = entries.filter(e => e && e.value);
        if (!shown.length) {
            const p = document.createElement('p');
            p.className = 'card-line';
            p.textContent = cfg.empty;
            box.replaceChildren(p);
            return;
        }
        box.replaceChildren(...shown.map((entry, i) => {
            const p = document.createElement('p');
            p.className = `card-line${i >= PRINT_LINES_EACH ? ' print:hidden' : ''}`;
            const label = document.createElement('span');
            label.className = 'card-line-label';
            label.textContent = (cfg.types.find(([v]) => v === entry.type) || [])[1] || entry.type || '';
            const value = document.createElement('span');
            value.className = 'card-line-value';
            value.textContent = entry.value;
            p.append(label, value);
            return p;
        }));
    }

    renderAvatarBox(box, initials, sizeClasses) {
        if (!box) return;
        const t = THEMES[this.themeKey];
        const base = `${sizeClasses} rounded-2xl flex items-center justify-center overflow-hidden flex-shrink-0`;
        box.replaceChildren();
        box.removeAttribute('style');
        const logo = this.logoDisplay || this.avatarBase64;
        if (!logo) {
            box.className = `${base} font-bold shadow-lg`;
            box.style.background = t.accent;
            box.style.color = t.card;
            box.textContent = initials;
            return;
        }
        box.className = `${base} ${this.logoBacking()}`;
        this.plate(box);
        box.appendChild(logoElement(logo, 'w-full h-full object-contain'));
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
        this.plate(plate);
        plate.appendChild(logoElement(this.logoDisplay, 'h-full w-auto max-w-full object-contain'));
        strip.replaceChildren(plate);
    }

    /**
     * What goes behind the logo. A traced logo is drawn in the ink colour and needs nothing. A transparent logo sits
     * straight on the card, except one that would vanish on it: a mostly light logo on a light card gets a plate in
     * the accent colour, a mostly dark one on a dark card a plate in the ink colour. An opaque logo brings its own
     * background.
     */
    logoBacking() {
        const look = this.logoDisplay && this.logoLook;
        if (!look || look.traced) return '';
        if (!look.transparent) return 'shadow-lg';
        return this.plateColour() ? 'p-1.5 shadow-lg' : '';
    }

    plateColour() {
        const look = this.logoDisplay && this.logoLook;
        if (!look || look.traced || !look.transparent) return null;
        const t = THEMES[this.themeKey], lightCard = relativeLuminance(t.card) > 0.4;
        if (look.tone === 'light' && lightCard) return t.accent;
        if (look.tone === 'dark' && !lightCard) return t.ink;
        return null;
    }

    plate(el) {
        const colour = this.plateColour();
        if (colour) el.style.background = colour;
    }

    applyTheme(themeKey) {
        this.themeKey = themeKeyOf(themeKey);
        const t = THEMES[this.themeKey];
        $('currentPaletteLabel').textContent = t.label;
        $('paletteSwatch').style.background = `linear-gradient(135deg, ${t.card} 50%, ${t.accent} 50%)`;
        const flipper = $('card3DFlipper');
        flipper.style.setProperty('--card-bg', t.card);
        flipper.style.setProperty('--card-ink', t.ink);
        flipper.style.setProperty('--card-accent', t.accent);
        flipper.dataset.theme = this.themeKey;
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
     * @param {string|null} display  the logo for the card (a trace or the trimmed picture); without it the card shows the photo
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

    // ---- The spin: tap flips, a sideways drag on the card turns it, and it settles on the nearest face -------

    setAngle(deg) {
        this.angle = deg;
        const flipper = $('card3DFlipper');
        if (flipper) flipper.style.transform = `rotateY(${Number.isInteger(deg) ? deg : deg.toFixed(2)}deg)`;
    }

    /** Turns the card to `target` degrees with the shared ease (instant under reduce motion), then squares the record. */
    spinTo(target, { instant = false } = {}) {
        if (this.stopSpin) this.stopSpin();
        const flipper = $('card3DFlipper');
        const done = (end) => {
            // Back to the plain 0 or 180 so every full turn ends on the same number.
            const face = ((Math.round(end / 180) % 2) + 2) % 2;
            this.isFlipped = face === 1;
            this.setAngle(face * 180);
            if (flipper) flipper.dataset.spin = 'still';
            this.stopSpin = null;
        };
        if (instant || reducedMotion()) { done(target); return; }
        if (flipper) flipper.dataset.spin = 'moving';
        const stop = tween(this.angle, target, SPIN_MS, (a) => { if (a === target) done(target); else this.setAngle(a); });
        this.stopSpin = () => { stop(); this.stopSpin = null; if (flipper) flipper.dataset.spin = 'still'; };
    }

    setFlipped(flipped, options = {}) {
        this.isFlipped = flipped;
        // From wherever the card is, the shorter way round to the face asked for.
        const base = Math.round(this.angle / 360) * 360;
        let target = base + (flipped ? 180 : 0);
        if (target - this.angle > 180) target -= 360;
        if (this.angle - target > 180) target += 360;
        this.spinTo(target, options);
    }

    toggleFlip() {
        this.setFlipped(!this.isFlipped);
    }

    wireSpin() {
        const flipper = $('card3DFlipper');
        let start = null, dragging = false, suppressClick = false;
        flipper.addEventListener('pointerdown', (e) => {
            if (e.button !== undefined && e.button !== 0) return;
            // A drag that starts at the screen edge is the browser's (back or forward): left alone.
            if (e.clientX < EDGE_PX || e.clientX > window.innerWidth - EDGE_PX) { start = null; return; }
            if (this.stopSpin) this.stopSpin();
            start = { x: e.clientX, angle: this.angle, id: e.pointerId, width: Math.max(1, flipper.getBoundingClientRect().width) };
            dragging = false;
        });
        flipper.addEventListener('pointermove', (e) => {
            if (!start || e.pointerId !== start.id) return;
            const dx = e.clientX - start.x;
            if (!dragging) {
                if (Math.abs(dx) < SPIN_TAP_PX) return;
                dragging = true;
                flipper.dataset.spin = 'drag';
                if (flipper.setPointerCapture) { try { flipper.setPointerCapture(e.pointerId); } catch (err) { /* a pointer that is already gone */ } }
            }
            // Half a card width of drag is a quarter turn: a full swipe across turns it over.
            this.setAngle(start.angle + dx / start.width * 180);
        });
        const end = (e) => {
            if (!start || (e.pointerId !== undefined && e.pointerId !== start.id)) return;
            const wasDragging = dragging;
            start = null; dragging = false;
            if (!wasDragging) return;
            suppressClick = true;
            this.spinTo(Math.round(this.angle / 180) * 180);
        };
        flipper.addEventListener('pointerup', end);
        flipper.addEventListener('pointercancel', end);
        flipper.addEventListener('lostpointercapture', end);
        flipper.addEventListener('click', () => {
            if (suppressClick) { suppressClick = false; return; }
            this.toggleFlip();
        });
    }

    // ---- Toasts: at the top, 3 s; a tap dismisses, a hold keeps it until 3 s after the release ---------------

    /** @param {{ label: string, onClick: Function }} [action] a button in the toast (shown for 8 s instead of 3 s) */
    showToast(msg, action = null) {
        const t = $('toast');
        if (!t) return;
        $('toastMessage').textContent = msg;
        const button = $('toastAction');
        button.classList.toggle('hidden', !action);
        button.onclick = action ? (e) => { e.stopPropagation(); this.hideToast(); action.onClick(); } : null;
        if (action) button.textContent = action.label;
        t.classList.remove('-translate-y-24', 'opacity-0', 'pointer-events-none');
        this.toastMs = action ? TOAST_ACTION_MS : TOAST_MS;
        this.armToast();
    }

    armToast() {
        clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(() => this.hideToast(), this.toastMs);
    }

    hideToast() {
        clearTimeout(this.toastTimer);
        this.toastTimer = null;
        $('toast').classList.add('-translate-y-24', 'opacity-0', 'pointer-events-none');
        $('toastAction').onclick = null;
    }

    wireToast() {
        const t = $('toast');
        if (!t) return;
        let held = false, downAt = 0;
        t.addEventListener('pointerdown', () => { held = true; downAt = Date.now(); clearTimeout(this.toastTimer); });
        const release = () => { if (!held) return; held = false; if (!t.classList.contains('opacity-0')) this.armToast(); };
        document.addEventListener('pointerup', release, true);
        document.addEventListener('pointercancel', release, true);
        // A press let go within TOAST_HOLD_MS is a tap and dismisses; a longer one was a hold, and the toast stays its 3 s.
        t.addEventListener('click', (e) => { if (e.target.closest('#toastAction') || Date.now() - downAt >= TOAST_HOLD_MS) return; this.hideToast(); });
    }

    /**
     * Runs a change that replaces form contents (preset, scan fill, clear) and offers Undo in the toast.
     * The previous card is kept in memory only until the next such change, Undo, or forgetUndo().
     */
    changeWithUndo(message, apply) {
        this.undoSnapshot = this.getContact();
        this.undoWasSample = this.holdsSample;
        apply();
        this.changed();
        this.showToast(message, {
            label: 'Undo',
            onClick: () => {
                if (!this.undoSnapshot) return;
                this.sampleLogoToken++;
                this.setContact(this.undoSnapshot);
                this.holdsSample = this.undoWasSample;
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

    /**
     * Puts a sample contact (one of PRESETS) on the card as a whole, with Undo; the typeface stays. A sample with a
     * logo brings it (drawn on the device from the bundled file, kept in its own colours); the person's own logo stays
     * until it arrives.
     */
    loadSample(preset) {
        const { logo, ...fields } = preset;
        this.changeWithUndo(`Loaded sample: ${preset.firstName} ${preset.lastName}`,
            () => {
                this.setContact({ ...createEmptyContact(), ...fields, avatarBase64: this.avatarBase64, logoDisplay: this.logoDisplay, cardFont: this.fontClass });
                this.holdsSample = true;
            });
        if (!logo) return;
        const token = ++this.sampleLogoToken;
        prepareLogo(logo, { trace: false }).then(({ photo, display }) => {
            if (token !== this.sampleLogoToken || !this.holdsSample) return;
            this.setAvatar(photo, display);
            this.changed();
        }).catch(err => console.warn('[vCGE] Sample logo not readable:', err));
    }

    buildPaletteMenu() {
        const container = $('paletteListContainer');
        if (!container) return;
        Object.entries(THEMES).forEach(([key, t]) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.dataset.theme = key;
            btn.className = 'w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold transition';
            const swatch = document.createElement('span');
            swatch.className = 'w-5 h-5 rounded-full shrink-0 border border-black/10';
            swatch.style.background = `linear-gradient(135deg, ${t.card} 50%, ${t.accent} 50%)`;
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
        this.wireSpin();
        this.wireToast();

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
            if (file.size > 2 * 1024 * 1024) { this.showToast('The logo must be 2 MB or smaller.'); return; }
            const reader = new FileReader();
            reader.onload = async (evt) => {
                let logo;
                try {
                    logo = await prepareLogo(evt.target.result);
                } catch (err) {
                    console.warn('[vCGE] Logo not readable:', err);
                    this.showToast('That file could not be read as an image.');
                    return;
                }
                this.sampleLogoToken++;
                this.setAvatar(logo.photo, logo.display);
                this.changed();
                this.showToast(logoMessage(logo));
            };
            reader.readAsDataURL(file);
        });
        $('removeAvatarBtn').addEventListener('click', () => {
            this.sampleLogoToken++;
            this.setAvatar(null);
            this.changed();
            this.showToast('Logo removed.');
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

/** The toast after a logo upload: what was done to it. */
export function logoMessage({ traced, whiteRemoved, reason }) {
    if (traced) return whiteRemoved ? 'Logo attached: white background removed, traced in the card\'s ink colour.' : 'Logo attached, traced in the card\'s ink colour.';
    const why = reason === 'colours' ? 'it has more than two colours' : reason === 'faint' ? 'too little of it stands out' : reason === 'busy' ? 'it is too detailed' : 'it could not be traced';
    return whiteRemoved ? `Logo attached: white background removed, kept as is (${why}).` : `Logo attached, kept as is (${why}).`;
}

// ---- Colour helpers -----------------------------------------------------------------------------------------

export function hexToRgb(hex) {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function relativeLuminance(hex) {
    const [r, g, b] = hexToRgb(hex).map(v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** WCAG contrast ratio between two hex colours. */
export function contrastRatio(a, b) {
    const la = relativeLuminance(a), lb = relativeLuminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// ---- Logo preparation ----------------------------------------------------------------------------------------

const LOGO_SIZE = 256;          // the vCard PHOTO: a square JPEG
const LOGO_DISPLAY_MAX = 512;   // the card copy: longest side in px
const WIDE_LOGO = 2;            // width / height from which a logo is a wordmark and gets the strip across the card
const TRACE_MAX = 160;          // the trace works on a grid at most this wide or tall
const TRACE_MARK = 'data-vcge-trace';

/** The element that shows a logo: an inline drawing in the ink colour for a trace, else a picture. */
function logoElement(src, className) {
    const trace = traceSvg(src);
    if (trace) {
        trace.setAttribute('class', `card-trace ${className}`);
        trace.style.aspectRatio = `${trace.getAttribute('width')} / ${trace.getAttribute('height')}`;
        trace.removeAttribute('width');
        trace.removeAttribute('height');
        return trace;
    }
    const img = document.createElement('img');
    img.src = src;
    img.alt = '';
    img.className = className;
    return img;
}

/** The SVG element of a trace this module made (marked, paths only), else null. Never inlines anyone else's SVG. */
function traceSvg(src) {
    if (typeof src !== 'string' || !/^data:image\/svg\+xml;base64,/i.test(src) || typeof DOMParser === 'undefined') return null;
    try {
        const text = new TextDecoder().decode(Uint8Array.from(atob(src.slice(src.indexOf(',') + 1)), ch => ch.charCodeAt(0)));
        if (!text.includes(TRACE_MARK)) return null;
        const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
        const root = doc.documentElement;
        if (!root || root.localName !== 'svg' || !root.hasAttribute(TRACE_MARK) || doc.getElementsByTagName('parsererror').length) return null;
        if (!Array.from(root.children).every(c => c.localName === 'path')) return null;
        return document.importNode(root, true);
    } catch (e) {
        return null;
    }
}

function canvasOf(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
}

/**
 * Any image the browser can draw (PNG, JPEG, GIF, WebP, SVG), made ready for the card:
 * - A white background (a JPEG logo) is removed first: the white joined to the picture's edge goes see-through.
 * - display: the logo traced into a plain two-colour SVG that takes the card's ink colour (`traced`), when the trace
 *   is good; else the picture trimmed to the logo itself, in its own shape, at most 512 px on the long side, PNG with
 *   its transparency when it has any, else JPEG. Shown on the card only.
 * - photo: the trimmed logo fitted with a margin (never cropped) in a 256 px square JPEG on an opaque background: the
 *   logo's own edge colour, or for a transparent logo white, or dark slate when it is mostly light. This is the vCard
 *   PHOTO, which contact apps show square.
 * `source` is a data URL or the path of a bundled file. A canvas the page may not read back throws, and the caller
 * reports the file as unreadable.
 * @param {string} source
 * @param {{ trace?: boolean }} [options]  trace: false keeps the picture as it is (the samples' colour logos)
 * @returns {Promise<{ photo: string, display: string, traced: boolean, whiteRemoved: boolean, reason: string|null }>}
 */
export async function prepareLogo(source, { trace = true } = {}) {
    const { img, w, h, vector } = await loadLogo(source);
    // A drawing is redrawn at full size; a picture is only ever made smaller.
    const k = vector ? LOGO_DISPLAY_MAX / Math.max(w, h) : Math.min(1, LOGO_DISPLAY_MAX / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * k)), ch = Math.max(1, Math.round(h * k));
    const work = canvasOf(cw, ch);
    const wctx = work.getContext('2d', { willReadFrequently: true });
    wctx.drawImage(img, 0, 0, cw, ch);
    const image = wctx.getImageData(0, 0, cw, ch);
    let px = image.data;
    let box = logoBounds(px, cw, ch);
    let whiteRemoved = false;
    if (!box.transparent && isWhite(box.edge)) {
        whiteRemoved = removeWhite(px, cw, ch) > 0;
        if (whiteRemoved) { wctx.putImageData(image, 0, 0); box = logoBounds(px, cw, ch); }
    }

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

    let tracedUrl = null, reason = null;
    if (trace) {
        const t = traceLogo(px, cw, box);
        if (t.svg) tracedUrl = svgDataUrl(t.svg); else reason = t.reason;
    }
    [work, display, out].forEach(c => { c.width = c.height = 0; });
    return { photo, display: tracedUrl || displayUrl, traced: !!tracedUrl, whiteRemoved, reason };
}

/**
 * Shape and tone of a prepared display logo, for the card layout: { wide, transparent, tone, traced } where tone is
 * 'light' or 'dark' when most of the logo is, else null.
 * @param {string} displayUrl
 */
export async function describeLogo(displayUrl) {
    const { img, w, h } = await loadLogo(displayUrl);
    const traced = isTraceUrl(displayUrl);
    if (traced) return { wide: w / h >= WIDE_LOGO, transparent: true, tone: null, traced: true };
    const k = Math.min(1, 128 / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * k)), ch = Math.max(1, Math.round(h * k));
    const c = canvasOf(cw, ch);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, cw, ch);
    const px = ctx.getImageData(0, 0, cw, ch).data;
    c.width = c.height = 0;
    return { wide: w / h >= WIDE_LOGO, transparent: isTransparent(px, cw * ch), tone: toneOf(px, cw, { x: 0, y: 0, w: cw, h: ch }), traced: false };
}

const isTraceUrl = (url) => typeof url === 'string' && /^data:image\/svg\+xml;base64,/i.test(url) && decodeDataUrl(url).includes(TRACE_MARK);

async function loadLogo(source) {
    const dataUrl = /^data:/i.test(source);
    const vector = dataUrl ? /^data:image\/svg\+xml/i.test(source) : /\.svg$/i.test(source);
    const img = new Image();
    img.src = dataUrl && vector ? sizedSvg(source) : source;
    await img.decode();
    // Should a browser still report no size for an SVG, it is drawn as a square.
    return { img, w: img.naturalWidth || LOGO_SIZE, h: img.naturalHeight || LOGO_SIZE, vector };
}

function decodeDataUrl(dataUrl) {
    const comma = dataUrl.indexOf(',');
    const meta = dataUrl.slice(0, comma), body = dataUrl.slice(comma + 1);
    return /;base64/i.test(meta)
        ? new TextDecoder().decode(Uint8Array.from(atob(body), ch => ch.charCodeAt(0)))
        : decodeURIComponent(body);
}

export function svgDataUrl(text) {
    let bin = '';
    new TextEncoder().encode(text).forEach(b => { bin += String.fromCharCode(b); });
    return `data:image/svg+xml;base64,${btoa(bin)}`;
}

/**
 * The SVG with its width and height written in, taken from its viewBox. Browsers differ on an SVG that has only a
 * viewBox (some report no size, and it would be drawn square and squashed), so its own shape is made explicit.
 * Returns the SVG unchanged when it already has a size in pixels or cannot be read.
 */
function sizedSvg(dataUrl) {
    try {
        const text = decodeDataUrl(dataUrl);
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
        return svgDataUrl(new XMLSerializer().serializeToString(root));
    } catch (e) {
        return dataUrl;
    }
}

const isTransparent = (px, count) => {
    let clear = 0;
    for (let i = 3; i < px.length; i += 4) if (px[i] < 250) clear++;
    return clear > count / 100;
};

/** An edge colour (`rgb(r,g,b)`) that is white or nearly so: a scanned or exported logo on a white page. */
export function isWhite(rgb) {
    const m = /(\d+),\s*(\d+),\s*(\d+)/.exec(rgb || '');
    return !!m && Math.min(+m[1], +m[2], +m[3]) >= 235;
}

const WHITE_KEEP = 60;      // a pixel this far from white (max channel difference) or more is part of the logo
const WHITE_CLEAR = 12;     // a pixel this close to white or closer goes fully see-through

/**
 * Removes a white background in place: the near-white area joined to the picture's edge goes see-through, with a soft
 * edge where it meets the logo. White inside the logo (a letter's counter, white lettering on a dark badge) is kept,
 * so the logo's own white stays white. Returns how many pixels were cleared.
 */
export function removeWhite(px, w, h) {
    const n = w * h;
    const dist = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
        const k = i * 4;
        dist[i] = Math.min(255, 255 - Math.min(px[k], px[k + 1], px[k + 2]));
    }
    const seen = new Uint8Array(n), queue = new Int32Array(n);
    let head = 0, tail = 0, cleared = 0;
    const push = (i) => { if (!seen[i] && dist[i] < WHITE_KEEP) { seen[i] = 1; queue[tail++] = i; } };
    for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
    while (head < tail) {
        const i = queue[head++];
        const x = i % w, y = (i - x) / w;
        if (x > 0) push(i - 1);
        if (x < w - 1) push(i + 1);
        if (y > 0) push(i - w);
        if (y < h - 1) push(i + w);
    }
    for (let i = 0; i < n; i++) {
        if (!seen[i]) continue;
        const d = dist[i];
        const alpha = d <= WHITE_CLEAR ? 0 : Math.round(255 * (d - WHITE_CLEAR) / (WHITE_KEEP - WHITE_CLEAR));
        px[i * 4 + 3] = Math.min(px[i * 4 + 3], alpha);
        cleared++;
    }
    return cleared;
}

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
    const ink = inkTest(px, transparent, edge);
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

/** What counts as the logo: for a transparent image a solid pixel, for an opaque one a colour unlike the edge. */
function inkTest(px, transparent, edge) {
    return transparent
        ? (k) => px[k + 3] > 128
        : (k) => Math.abs(px[k] - edge[0]) + Math.abs(px[k + 1] - edge[1]) + Math.abs(px[k + 2] - edge[2]) > 60;
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

// ---- The trace: a two-colour SVG of the logo's shape --------------------------------------------------------

const TRACE_MIN_INK = 0.02;     // less of the box than this inked: too faint to trace
const TRACE_MAX_MIXED = 0.25;   // more of the ink than this far from the ink's average colour: not a two-colour logo
const TRACE_MAX_LOOPS = 300;    // more outlines than this: a photo or a texture, not a logo
const TRACE_MAX_OFF_LINE = 70;  // a pixel farther (RGB distance) than this from the ink-to-background line is another colour

/** The distance from colour `p` to the segment between colours `a` and `b` (RGB). */
export function distanceToSegment(p, a, b) {
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
    const len2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
    const t = len2 ? Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / len2)) : 0;
    return Math.hypot(ap[0] - ab[0] * t, ap[1] - ab[1] * t, ap[2] - ab[2] * t);
}

/**
 * Traces the logo inside `box` into closed outlines on a grid of at most TRACE_MAX cells a side. Returns { svg } with
 * a plain SVG (paths only, filled with currentColor) or { reason } when the trace would look poor: 'faint' (almost
 * nothing stands out), 'colours' (more than two colours: a photo or a full-colour logo), 'busy' (too many outlines).
 */
export function traceLogo(px, w, box, { max = TRACE_MAX } = {}) {
    const transparent = box.transparent;
    const edgeRgb = (/(\d+),\s*(\d+),\s*(\d+)/.exec(box.edge || '') || [0, 0, 0, 0]).slice(1).map(Number);
    const ink = inkTest(px, transparent, edgeRgb);
    // The ink's average colour, and how much of the ink is far from it (a second colour, a gradient, a photo).
    let count = 0, sr = 0, sg = 0, sb = 0;
    for (let y = box.y; y < box.y + box.h; y++) {
        for (let x = box.x; x < box.x + box.w; x++) {
            const k = (y * w + x) * 4;
            if (!ink(k)) continue;
            count++; sr += px[k]; sg += px[k + 1]; sb += px[k + 2];
        }
    }
    if (count < TRACE_MIN_INK * box.w * box.h) return { reason: 'faint' };
    const mean = [sr / count, sg / count, sb / count];
    // A two-colour logo's pixels lie between its ink and its background (the soft edges of lettering, JPEG ringing):
    // a pixel far from that line is a third colour. A transparent logo's background counts as white.
    const back = transparent ? [255, 255, 255] : edgeRgb;
    let mixed = 0;
    for (let y = box.y; y < box.y + box.h; y++) {
        for (let x = box.x; x < box.x + box.w; x++) {
            const k = (y * w + x) * 4;
            if (ink(k) && distanceToSegment([px[k], px[k + 1], px[k + 2]], mean, back) > TRACE_MAX_OFF_LINE) mixed++;
        }
    }
    if (mixed / count > TRACE_MAX_MIXED) return { reason: 'colours' };

    // The grid: each cell is inked when at least half of its pixels are.
    const scale = Math.max(1, Math.ceil(Math.max(box.w, box.h) / max));
    const gw = Math.ceil(box.w / scale), gh = Math.ceil(box.h / scale);
    const mask = new Uint8Array(gw * gh);
    for (let gy = 0; gy < gh; gy++) {
        for (let gx = 0; gx < gw; gx++) {
            let on = 0, all = 0;
            for (let y = box.y + gy * scale; y < Math.min(box.y + box.h, box.y + (gy + 1) * scale); y++) {
                for (let x = box.x + gx * scale; x < Math.min(box.x + box.w, box.x + (gx + 1) * scale); x++) {
                    all++;
                    if (ink((y * w + x) * 4)) on++;
                }
            }
            mask[gy * gw + gx] = all && on * 2 >= all ? 1 : 0;
        }
    }
    const loops = outlines(mask, gw, gh);
    if (!loops.length) return { reason: 'faint' };
    if (loops.length > TRACE_MAX_LOOPS) return { reason: 'busy' };
    const d = loops.map(loop => 'M' + soften(loop).map(([x, y]) => `${num(x)} ${num(y)}`).join('L') + 'Z').join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" ${TRACE_MARK}="1" width="${gw}" height="${gh}" viewBox="0 0 ${gw} ${gh}"><path fill="currentColor" fill-rule="evenodd" d="${d}"/></svg>`;
    return { svg };
}

const num = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.?0+$/, ''));

/**
 * The outlines of the inked cells of a `w` x `h` mask as closed loops of grid corners, each loop a list of [x, y]
 * with straight runs reduced to their ends. Outer edges run clockwise (ink on the right, y down) and holes the other
 * way, so an even-odd fill draws them with their holes.
 */
export function outlines(mask, w, h) {
    const at = (x, y) => (x >= 0 && y >= 0 && x < w && y < h ? mask[y * w + x] : 0);
    // Every boundary side of an inked cell as a directed edge from a corner, keyed by its start corner.
    const edges = new Map();   // "x,y" -> [[x2, y2], ...]
    const add = (x1, y1, x2, y2) => { const k = `${x1},${y1}`; if (!edges.has(k)) edges.set(k, []); edges.get(k).push([x2, y2]); };
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            if (!at(x, y)) continue;
            if (!at(x, y - 1)) add(x, y, x + 1, y);             // top: left to right
            if (!at(x + 1, y)) add(x + 1, y, x + 1, y + 1);     // right: top to bottom
            if (!at(x, y + 1)) add(x + 1, y + 1, x, y + 1);     // bottom: right to left
            if (!at(x - 1, y)) add(x, y + 1, x, y);             // left: bottom to top
        }
    }
    const loops = [];
    for (const [startKey, outs] of edges) {
        while (outs.length) {
            const [sx, sy] = startKey.split(',').map(Number);
            const loop = [[sx, sy]];
            let x = sx, y = sy, next = outs.pop(), px = sx, py = sy;
            while (true) {
                [px, py, x, y] = [x, y, next[0], next[1]];
                if (x === sx && y === sy) break;
                loop.push([x, y]);
                const options = edges.get(`${x},${y}`) || [];
                if (!options.length) break;   // cannot happen on a closed mask; guards a corrupt map
                let pick = 0;
                if (options.length > 1) {
                    // Two inked cells touch at this corner: turn right (towards the cell just passed) so the loops stay apart.
                    const dx = x - px, dy = y - py;
                    pick = options.findIndex(([nx, ny]) => (nx - x) === -dy && (ny - y) === dx);
                    if (pick < 0) pick = 0;
                }
                next = options.splice(pick, 1)[0];
            }
            loops.push(straighten(loop));
        }
    }
    return loops;
}

/** Drops the corners along a straight run. */
function straighten(loop) {
    const out = [];
    for (let i = 0; i < loop.length; i++) {
        const a = loop[(i + loop.length - 1) % loop.length], b = loop[i], c = loop[(i + 1) % loop.length];
        if ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) !== 0) out.push(b);
    }
    return out.length >= 3 ? out : loop;
}

/**
 * Softens the staircase of a grid outline: each corner is cut back by up to half a cell along both of its sides, so a
 * one-cell stair step becomes a slope while a long straight side stays straight.
 */
export function soften(loop, cut = 0.5) {
    if (loop.length < 3) return loop;
    const out = [];
    for (let i = 0; i < loop.length; i++) {
        const a = loop[(i + loop.length - 1) % loop.length], b = loop[i], c = loop[(i + 1) % loop.length];
        const ab = Math.hypot(b[0] - a[0], b[1] - a[1]), bc = Math.hypot(c[0] - b[0], c[1] - b[1]);
        const ta = Math.min(cut, ab / 2), tc = Math.min(cut, bc / 2);
        out.push([b[0] + (a[0] - b[0]) * ta / ab, b[1] + (a[1] - b[1]) * ta / ab]);
        out.push([b[0] + (c[0] - b[0]) * tc / bc, b[1] + (c[1] - b[1]) * tc / bc]);
    }
    return out;
}
