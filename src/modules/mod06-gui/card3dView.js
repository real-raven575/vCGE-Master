/**
 * vCard Generator Engine (vCGE) - vCGE-MOD06 3D Card ("Flipside")
 * Created by raven575, Team vCGE (Claude) & Gemini
 *
 * Owns the contact form, the card (3D spin, fall palettes, typography, logo) and the toasts.
 * Holds contact data in memory only; persistence is the vault's job (wired in src/main.js).
 * Redesign step 8: eight fall themes that colour the whole card face, the logo traced on the device into the theme's
 * ink colour (a white background removed first), every phone, email and site on the card, swipe-to-spin, toasts at the
 * top, and the nine Team vCGE pilots as sample contacts.
 */
import { CONTACT_FIELDS, createEmptyContact, normalizeContact } from '../../share/cardSchema.js';
import { isPlain } from '../mod01-shell/edition.js';
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

// The badge's initials: first name and last name, a leading "the" skipped so "Ghost the Raccoon" reads GR
// (raven575, 2026-10-22). No name gives VC.
export function initialsOf({ firstName = '', lastName = '' } = {}) {
    const first = String(firstName).trim(), last = String(lastName).trim().replace(/^the\s+(?=\S)/i, '');
    return first && last ? (first[0] + last[0]).toUpperCase() : 'VC';
}

// Sample contacts, as data: the Fields card (MOD05) lists them under "Insert Fake Contact?" and calls loadSample().
// The ten pilots of Team vCGE as "Name the Animal", with the reserved fictional numbers (555-01xx), a vCGE.APP Gmail
// plus-address each (so the inbox can filter by character), their future page on vcge.app, an address at their bench
// in Hangar 01 off the Flight Deck, and the roster's animal as the logo (bundled Noto Emoji, src/vendor/icons/animals/;
// where Noto has no such animal the nearest stands in). raven575, 2026-10-22.
const ANIMALS = 'src/vendor/icons/animals/';
const HQ = 'Herd of Helpers HEADQUARTERS';
const pilot = (callSign, n, firstName, animal, bench, jobTitle, logo, themePalette, extra = {}) => ({
    label: `${callSign} ${firstName}`, firstName, lastName: `the ${animal}`, organization: 'Team vCGE', jobTitle,
    phones: [{ type: 'mobile', value: `+1 (202) 555-01${n}` }, ...(extra.phones || [])],
    emails: [{ type: 'work', value: `vcge.app+${firstName.toLowerCase()}@gmail.com` }],
    websites: [{ type: 'work', value: `https://vcge.app/team_members/${callSign.toLowerCase()}-${firstName.toLowerCase()}` }, ...(extra.websites || [])],
    addressType: 'work', street: `${Number(n)} Flight Deck Way, ${bench}`, unitType: 'Hangar', unitNumber: '01', city: HQ, state: 'OH', zip: '44101',
    country: 'United States', themePalette, logo: `${ANIMALS}${logo}.svg`, ...extra.fields
});
export const PRESETS = [
    pilot('MOD01', '01', 'Shutout', 'Box Turtle', 'Lockout Gate', 'Shell pilot: egress lock and theme', 'turtle', 'spruce',
        { phones: [{ type: 'work', value: '+1 (202) 555-0111' }] }),
    pilot('MOD02', '02', 'Ghost', 'Raccoon', 'Wipe Trials', 'Vault pilot: the temporary hub', 'raccoon', 'twilight'),
    pilot('MOD03', '03', 'Iris', 'Lynx', 'Darkroom Edge Bench', 'Camera pilot: one clean shot', 'cat', 'pumpkin',
        { websites: [{ type: 'instagram', value: 'https://instagram.com/example' }] }),
    pilot('MOD04', '04', 'Glyph', 'Owl', 'Reading Room', 'OCR pilot: photo to text, on the device', 'owl', 'harvest',
        { fields: { namePrefix: 'Dr.' } }),
    pilot('MOD05', '05', 'Pidge', 'Octopus', 'Sorting Room', 'Field mapping pilot: every line in its slot', 'octopus', 'slateblue',
        { phones: [{ type: 'work', value: '+1 (202) 555-0155' }, { type: 'workFax', value: '+1 (202) 555-0156' }] }),
    pilot('MOD06', '06', 'Flipside', 'Chameleon', 'Paint Booth', '3D Card pilot: colours, logo and sparkle', 'lizard', 'sage'),
    pilot('MOD07', '07', 'Checkers', 'Zebra', 'Checkerboard Bay', 'QR pilot: a whole person in a square', 'zebra', 'cranberry'),
    pilot('MOD08', '08', 'Airlock', 'Falcon', 'Launch Hatch', 'Export pilot: the one hatch out', 'eagle', 'maple',
        { phones: [{ type: 'main', value: '+1 (202) 555-0180' }] }),
    pilot('BNK01', '09', 'Tally', 'Hamster', 'Counting House', 'Banker pilot: always knows the count', 'hamster', 'harvest'),
    pilot('PM-vCGE-00', '00', 'Cornerstone', 'Elephant', 'Control Tower', 'Project Manager: holds the formation', 'elephant', 'slateblue',
        { fields: { label: 'PM Cornerstone', nameSuffix: 'PM' } })
];

// The plain edition's samples (mod01-shell/edition.js): ten made-up people with the same fields and extras as the
// pilots (a second phone, a fax, Instagram, a prefix, an unlisted unit type and suffix), so every feature still has a
// sample, and no logo.
const person = (n, firstName, lastName, organization, jobTitle, themePalette, extra = {}) => ({
    label: `${firstName} ${lastName}`, firstName, lastName, organization, jobTitle,
    phones: [{ type: 'mobile', value: `+1 (202) 555-01${n}` }, ...(extra.phones || [])],
    emails: [{ type: 'work', value: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@example.com` }],
    websites: [{ type: 'work', value: `https://example.com/${firstName.toLowerCase()}-${lastName.toLowerCase()}` }, ...(extra.websites || [])],
    addressType: 'work', street: '100 Main Street', unitType: 'Office', unitNumber: String(Number(n)), city: 'Springfield', state: 'OH', zip: '45501',
    country: 'United States', themePalette, ...extra.fields
});
export const PLAIN_PRESETS = [
    person('01', 'Avery', 'Collins', 'Northwind Design', 'Office Manager', 'spruce',
        { phones: [{ type: 'work', value: '+1 (202) 555-0111' }] }),
    person('02', 'Jordan', 'Patel', 'Brightline Legal', 'Paralegal', 'twilight'),
    person('03', 'Maya', 'Rivera', 'Rivera Photography', 'Photographer', 'pumpkin',
        { websites: [{ type: 'instagram', value: 'https://instagram.com/example' }] }),
    person('04', 'Samuel', 'Okafor', 'Lakeside Clinic', 'Physician', 'harvest',
        { fields: { namePrefix: 'Dr.' } }),
    person('05', 'Priya', 'Nair', 'Harbor Logistics', 'Operations Lead', 'slateblue',
        { phones: [{ type: 'work', value: '+1 (202) 555-0155' }, { type: 'workFax', value: '+1 (202) 555-0156' }] }),
    person('06', 'Lena', 'Fischer', 'Fischer and Co.', 'Graphic Designer', 'sage'),
    person('07', 'Marcus', 'Chen', 'Summit Realty', 'Real Estate Agent', 'cranberry'),
    person('08', 'Grace', 'Thompson', 'Oakridge Bank', 'Branch Manager', 'maple',
        { phones: [{ type: 'main', value: '+1 (202) 555-0180' }] }),
    person('09', 'Rosa', 'Delgado', 'Delgado Bookkeeping', 'Bookkeeper', 'harvest'),
    person('00', 'Daniel', 'Brooks', 'Brooks Consulting', 'Principal Consultant', 'slateblue',
        { fields: { nameSuffix: 'MBA' } })
];

// Typed list editors (phones, emails, websites): container, row id prefix, type choices, input type and the add button.
const LISTS = {
    phones: { container: 'phoneList', id: 'phone', noun: 'phone', types: PHONE_TYPES, input: 'tel', placeholder: 'Phone number', add: 'addPhoneBtn', preview: 'previewPhones', empty: 'No phone number' },
    emails: { container: 'emailList', id: 'email', noun: 'email', types: EMAIL_TYPES, input: 'email', placeholder: 'name@example.com', add: 'addEmailBtn', preview: 'previewEmails', empty: 'No email address' },
    websites: { container: 'websiteList', id: 'website', noun: 'website', types: WEBSITE_TYPES, input: 'url', placeholder: 'example.com or a profile link', add: 'addWebsiteBtn', preview: 'previewWebsites', empty: 'No website' }
};

// Line icons on the card (Tabler, the header's own set: src/vendor/icons/app/sprite.svg), by the kind of line.
const SPRITE = 'src/vendor/icons/app/sprite.svg';
const PHONE_ICONS = { mobile: 'device-mobile', pager: 'device-mobile', workFax: 'printer', homeFax: 'printer' };
/** The icon for a line: `kind` is phones, emails, websites or address; `type` the entry's type (address: its addressType). */
export function lineIcon(kind, type) {
    if (kind === 'phones') return PHONE_ICONS[type] || 'phone';
    if (kind === 'emails') return 'mail';
    if (kind === 'websites') return 'world';
    return type === 'home' ? 'home' : 'building';
}
// Without icons a bare "Work" says nothing about the line, so a plain type takes its noun ("Work phone"); a type that
// already names the line (Work fax, LinkedIn) stays as it is.
const PLAIN_TYPES = new Set(['work', 'home', 'mobile', 'main', 'personal', 'other']);
const LINE_NOUNS = { phones: 'phone', emails: 'email', websites: 'website', address: 'address' };
/** The label in front of a line: its type's name, with the line's noun added when the card shows no icons. */
export function lineLabel(kind, type, typeLabel, icons = true) {
    if (icons || !PLAIN_TYPES.has(type) || !typeLabel) return typeLabel;
    return type === 'mobile' && kind === 'phones' ? 'Mobile phone' : `${typeLabel} ${LINE_NOUNS[kind]}`;
}
export const PRINT_LINES_EACH = 2;   // the printed card (3.5 x 2 in, MOD08) has room for this many of each list
const digitsOrLower = (v) => (/\d{7}/.test(v.replace(/\D/g, '')) ? v.replace(/\D/g, '') : v.trim().toLowerCase());

// Card typefaces: [class, label]. The first three are the original choices (Sans, Serif, Mono, kept so a card held
// through a lock or an Undo keeps its look); then the bundled fonts the app setting already loads and the device's own
// system fonts (cardStyles.css), so no font file is added.
export const CARD_FONTS = [
    ['font-sans', 'Sans (Inter)'], ['font-serif', 'Serif (Playfair)'], ['font-mono', 'Mono (Fira Code)'],
    ['card-font-atkinson', 'Atkinson Hyperlegible'], ['card-font-lexend', 'Lexend'], ['card-font-tinos', 'Tinos'],
    ['card-font-comic', 'Comic Neue'], ['card-font-macondo', 'Macondo'], ['card-font-dyslexic', 'OpenDyslexic'],
    ['card-font-system', 'System sans'], ['card-font-system-serif', 'System serif']
];
const FONT_CLASSES = CARD_FONTS.map(([c]) => c);
// Card text size on screen: [key, label]; the class on each face is card-size-<key>.
export const CARD_SIZES = [['sm', 'Small text'], ['md', 'Medium text'], ['lg', 'Large text'], ['xl', 'Extra large text']];
export const DEFAULT_CARD_SIZE = 'md';
const SIZE_CLASSES = CARD_SIZES.map(([k]) => `card-size-${k}`);

// The logo's look and the card's finish (raven575 test report, 2026-10-22), memory only like the rest of the card.
// The logo's size on screen (cardStyles.css; the printed card keeps its own); Medium is a step up from the old size.
export const LOGO_SIZES = [['sm', 'Small logo'], ['md', 'Medium logo'], ['lg', 'Large logo']];
export const DEFAULT_LOGO_SIZE = 'md';
const LOGO_SIZE_CLASSES = LOGO_SIZES.map(([k]) => `logo-size-${k}`);
// Quick picks for the colour behind a logo, with a colour wheel for any other: never pure white or black, which make a
// picture look cut out. Auto is the card's own choice (a plate only where the logo would vanish).
export const LOGO_BACKS = [['auto', 'Auto', null], ['white', 'Mostly white', '#f8fafc'], ['light', 'Light gray', '#e2e8f0'],
    ['dark', 'Dark gray', '#334155'], ['charcoal', 'Charcoal', '#1e293b']];
// A texture laid over the card colour in its ink colour, at a strength from 5 to 35 per cent (cardStyles.css).
export const CARD_FINISHES = [['flat', 'Flat finish'], ['gradient', 'Soft gradient'], ['linen', 'Linen'], ['dots', 'Dots'], ['stripes', 'Stripes']];
export const DEFAULT_FINISH_STRENGTH = 15;

// Ready-made logos to match each palette, hand-drawn (no stock art), in their own colours.
const grains = () => [0, 1, 2, 3, 4].map(i => { const y = 14 + i * 8;
    return `<ellipse cx="25" cy="${y}" rx="4" ry="7" transform="rotate(-30 25 ${y})" fill="#eab308"/><ellipse cx="39" cy="${y}" rx="4" ry="7" transform="rotate(30 39 ${y})" fill="#eab308"/>`; }).join('');
const THEME_LOGO_ART = {
    pumpkin: '<path d="M32 16c-1-6 2-10 7-11" stroke="#3f6212" stroke-width="4" fill="none" stroke-linecap="round"/><ellipse cx="20" cy="38" rx="13" ry="18" fill="#ea7a1f"/><ellipse cx="44" cy="38" rx="13" ry="18" fill="#ea7a1f"/><ellipse cx="32" cy="38" rx="12" ry="20" fill="#f59a3c"/>',
    maple: '<path d="M32 4l5 11 7-4-2 13 10-5-3 9 9 3-13 9 3 6-12-2v6h-8v-6l-12 2 3-6-13-9 9-3-3-9 10 5-2-13 7 4z" fill="#c2410c"/><path d="M32 30v30" stroke="#7c2d12" stroke-width="3" stroke-linecap="round"/>',
    harvest: '<path d="M32 60V8" stroke="#a16207" stroke-width="3" stroke-linecap="round"/>' + grains() + '<ellipse cx="32" cy="8" rx="4" ry="7" fill="#eab308"/>',
    cranberry: '<path d="M30 22c4-12 16-14 22-10-4 8-12 12-22 10z" fill="#4d7c0f"/><circle cx="22" cy="38" r="11" fill="#9f1239"/><circle cx="42" cy="40" r="12" fill="#be123c"/><circle cx="31" cy="52" r="9" fill="#881337"/><circle cx="19" cy="34" r="2.5" fill="#fecdd3"/><circle cx="38" cy="35" r="2.5" fill="#fecdd3"/>',
    spruce: '<path d="M32 4L14 28h8L10 44h10L8 56h48L44 44h10L42 28h8z" fill="#166534"/><rect x="28" y="56" width="8" height="6" fill="#78350f"/>',
    sage: '<path d="M12 52C12 24 32 8 54 10c2 22-14 42-42 42z" fill="#84a07a"/><path d="M12 52L44 20" stroke="#3f5a36" stroke-width="2.5" fill="none" stroke-linecap="round"/>',
    slateblue: '<circle cx="46" cy="16" r="7" fill="#a9c6e3"/><path d="M2 56L22 22l10 14 8-10 22 30z" fill="#3e5572"/><path d="M22 22l-5 8 5-2 4 3z" fill="#eef3f9"/>',
    twilight: '<path d="M40 8a24 24 0 1 0 16 40A20 20 0 0 1 40 8z" fill="#f5e6a8"/><circle cx="50" cy="14" r="2" fill="#bba9f2"/><circle cx="56" cy="26" r="1.5" fill="#bba9f2"/><circle cx="12" cy="12" r="1.5" fill="#bba9f2"/>'
};
const themeLogoUrl = (key) => svgDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="256" height="256">${THEME_LOGO_ART[key]}</svg>`);
const $ = (id) => document.getElementById(id);

// Motion (shared rule, same numbers as mod03-camera/viewfinder.js): stepped at 26 fps, a 5 percent snap past the target.
export const STEP_FPS = 26;
export const OVERSHOOT = 0.05;
export const SPIN_MS = 420;              // a flip or the settle after a drag
const SPIN_TAP_PX = 8;                   // a drag shorter than this is a tap
const CLICK_AFTER_LIFT_MS = 600;         // a click this soon after a lift belongs to that press
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
     * @param {Function} [opts.onFace]   called with 'front' or 'back' when the side that is up changes (the header lights
     *                                   Flipside or Checkers from it)
     * @param {Object}   [opts.addressEngine]  MOD05 AddressAutocompleteEngine (local lookup)
     * @param {Object}   [opts.formMapper]     MOD05 ContactFormMapper (phone formatting)
     */
    constructor({ onChange, onFace = null, addressEngine = null, formMapper = null }) {
        this.onChange = onChange || (() => {});
        this.onFace = onFace || (() => {});
        this.face = null;           // the side last reported to onFace
        this.addressEngine = addressEngine;
        this.formMapper = formMapper;
        this.avatarBase64 = null;   // logo as the vCard PHOTO (square JPEG)
        this.logoDisplay = null;    // logo as shown on the card: a two-colour trace (SVG) in the ink colour, else trimmed with its transparency
        this.logoLook = null;       // { wide, transparent, tone, traced, edge } of logoDisplay, worked out when it is set
        this.rimPhoto = null;       // the photo the rim's tint was read from (D1)
        this.themeKey = DEFAULT_THEME;
        this.fontClass = 'font-sans';
        this.cardSize = DEFAULT_CARD_SIZE;
        this.cardIcons = true;      // line icons on the card (phone, mobile, email, website, address)
        this.isFlipped = false;
        this.angle = 0;             // the card's turn in degrees (0 front, 180 back)
        this.stopSpin = null;
        this.toastTimer = null;
        this.toastMs = TOAST_MS;
        this.undoSnapshot = null;   // the card before the last preset / scan fill / clear (memory only)
        this.undoWasSample = false;
        this.holdsSample = false;   // the card is a sample preset: the next scan fill replaces it instead of merging
        this.sampleLogoToken = 0;
        this.logoSize = DEFAULT_LOGO_SIZE;
        this.logoBack = null;       // the colour behind the logo the person picked, else null (Auto)
        this.finish = 'flat';
        this.finishStrength = DEFAULT_FINISH_STRENGTH;
    }

    init() {
        this.buildOptionLists();
        this.buildPaletteMenu();
        this.attachListeners();
        this.applyTheme(this.themeKey);
        this.applyLogoSize(this.logoSize);
        this.applyFinish(this.finish, this.finishStrength);
        this.setAngle(0);
        this.reportFace();
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
        contact.cardSize = this.cardSize;
        contact.cardIcons = this.cardIcons;
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
        this.applySize(c.cardSize);
        this.applyIcons(c.cardIcons !== false);
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
                themePalette: this.themeKey, cardFont: this.fontClass, cardSize: this.cardSize, cardIcons: this.cardIcons });
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
        $('cardFontSelect').replaceChildren(...CARD_FONTS.map(([v, label]) => new Option(label, v)));
        $('cardSizeSelect').replaceChildren(...CARD_SIZES.map(([v, label]) => new Option(label, v)));
        $('logoSizeSelect').replaceChildren(...LOGO_SIZES.map(([v, label]) => new Option(label, v)));
        $('cardFinishSelect').replaceChildren(...CARD_FINISHES.map(([v, label]) => new Option(label, v)));
        this.buildLogoPresets();
        this.buildLogoBacks();
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

    /** Empties the card, back to the default look: front side up, the default palette, Sans typeface, medium text. */
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
        Object.entries(LISTS).forEach(([key, cfg]) => this.renderLines($(cfg.preview), contact[key] || [], cfg, key));
        const address = [contact.street, unit, contact.city, contact.state].filter(Boolean).join(', ');
        const addressType = (ADDRESS_TYPES.find(([v]) => v === contact.addressType) || [])[1] || '';
        $('previewAddress').replaceChildren(...this.lineCells('address', contact.addressType, address ? addressType : '', address || 'No address provided'));
        $('backCardName').textContent = fullName;

        const initials = initialsOf(contact);
        // A wide logo (a wordmark) gets a strip across the top of the card, where it is readable. The printed card has
        // no room for the strip, so there the logo stays in the badge.
        const wide = !!(this.logoDisplay && this.logoLook && this.logoLook.wide);
        this.renderLogoStrip($('previewLogoStrip'), wide);
        this.renderAvatarBox($('previewAvatar'), initials, `w-16 h-16 text-2xl${wide ? ' hidden print:flex' : ''}`);
        this.renderAvatarBox($('formAvatarPreview'), initials, 'w-11 h-11 text-lg');
    }

    /**
     * Every entry of a list on the card, each with its icon and type label; past PRINT_LINES_EACH a line is left off the
     * printed card. An empty list is one line saying so, with the list's icon.
     */
    renderLines(box, entries, cfg, kind) {
        if (!box) return;
        const shown = entries.filter(e => e && e.value);
        const line = (cells, extra = '') => {
            const p = document.createElement('p');
            p.className = `card-line${extra}`;
            p.append(...cells);
            return p;
        };
        if (!shown.length) {
            box.replaceChildren(line(this.lineCells(kind, '', '', cfg.empty)));
            return;
        }
        box.replaceChildren(...shown.map((entry, i) => {
            const typeLabel = (cfg.types.find(([v]) => v === entry.type) || [])[1] || entry.type || '';
            return line(this.lineCells(kind, entry.type, typeLabel, entry.value), i >= PRINT_LINES_EACH ? ' print:hidden' : '');
        }));
    }

    /** The three cells of a detail line: icon, label and value (the card's grid lines every value up, cardStyles.css). */
    lineCells(kind, type, typeLabel, text) {
        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        icon.setAttribute('class', 'vcge-icon card-line-icon');
        icon.setAttribute('aria-hidden', 'true');
        const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
        use.setAttribute('href', `${SPRITE}#${lineIcon(kind, type)}`);
        icon.appendChild(use);
        const label = document.createElement('span');
        label.className = 'card-line-label';
        label.textContent = lineLabel(kind, type, typeLabel, this.cardIcons);
        const value = document.createElement('span');
        value.className = 'card-line-value';
        value.textContent = text;
        return [icon, label, value];
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
        // Inset by more than the corner rounding takes off (0.29 of its 16 px radius), so no part of the logo is clipped.
        box.className = `${base} ${LOGO_INSET} ${this.logoBacking()}`;
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
        plate.className = `h-12 w-fit max-w-full rounded-xl overflow-hidden ${LOGO_INSET_STRIP} ${this.logoBacking()}`;
        this.plate(plate);
        plate.appendChild(logoElement(this.logoDisplay, 'h-full w-auto max-w-full object-contain'));
        strip.replaceChildren(plate);
    }

    /**
     * What goes behind the logo. A traced logo is drawn in the ink colour and needs nothing. A transparent logo sits
     * straight on the card, except one that would vanish on it: a mostly light logo on a light card gets a plate in
     * the accent colour, a mostly dark one on a dark card a plate in the ink colour. An opaque logo brings its own
     * background, carried out to the tile's edge in its own edge colour (the inset around it is that colour too).
     */
    logoBacking() {
        if (this.logoBack && this.avatarBase64) return 'shadow-lg';
        const look = this.logoDisplay && this.logoLook;
        if (!look || look.traced) return '';
        if (!look.transparent) return 'shadow-lg';
        return this.plateColour() ? 'shadow-lg' : '';
    }

    plateColour() {
        if (this.logoBack && this.avatarBase64) return this.logoBack;
        const look = this.logoDisplay && this.logoLook;
        if (!look || look.traced) return null;
        if (!look.transparent) return look.edge || null;
        const t = THEMES[this.themeKey], lightCard = relativeLuminance(t.card) > 0.4;
        if (look.tone === 'light' && lightCard) return t.accent;
        if (look.tone === 'dark' && !lightCard) return t.ink;
        return null;
    }

    plate(el) {
        const colour = this.plateColour();
        if (colour) el.style.background = colour;
        // A traced logo is drawn in the ink colour; on a picked colour it takes whichever of slate or near-white shows.
        if (this.logoBack && this.logoLook && this.logoLook.traced) el.style.color = relativeLuminance(this.logoBack) > 0.4 ? '#1e293b' : '#f8fafc';
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

    /** The logo's size on the card (screen only): one of LOGO_SIZES, else the default. */
    applyLogoSize(size) {
        this.logoSize = LOGO_SIZES.some(([k]) => k === size) ? size : DEFAULT_LOGO_SIZE;
        $('logoSizeSelect').value = this.logoSize;
        $('cardFront').classList.remove(...LOGO_SIZE_CLASSES);
        $('cardFront').classList.add(`logo-size-${this.logoSize}`);
    }

    /** The colour behind the logo: a #rrggbb colour, or null for Auto. The card is drawn again with it. */
    applyLogoBack(colour) {
        this.logoBack = /^#[0-9a-f]{6}$/i.test(colour || '') ? colour.toLowerCase() : null;
        const pick = LOGO_BACKS.find(([, , c]) => c === this.logoBack);
        $('logoBgGroup').querySelectorAll('button[data-back]').forEach(b => b.setAttribute('aria-pressed', String(!!pick && b.dataset.back === pick[0])));
        $('logoBgPicker').classList.toggle('is-on', !pick);
        if (this.logoBack) $('logoBgPicker').value = this.logoBack;
        this.render(this.getContact());
    }

    /** The card's finish (one of CARD_FINISHES, else flat) and its strength in per cent (5 to 35). */
    applyFinish(finish, strength = this.finishStrength) {
        this.finish = CARD_FINISHES.some(([k]) => k === finish) ? finish : 'flat';
        this.finishStrength = Math.min(35, Math.max(5, Math.round(Number(strength)) || DEFAULT_FINISH_STRENGTH));
        const flipper = $('card3DFlipper');
        flipper.dataset.finish = this.finish;
        flipper.style.setProperty('--finish-a', String(this.finishStrength / 100));
        $('cardFinishSelect').value = this.finish;
        $('cardFinishStrength').value = String(this.finishStrength);
        $('cardFinishStrength').disabled = this.finish === 'flat';
    }

    /** The ready-made logos: the Team vCGE characters (branded edition only) and one to match each palette. */
    buildLogoPresets() {
        const select = $('logoPresetSelect');
        const group = (label, items) => { const g = document.createElement('optgroup'); g.label = label; items.forEach(([v, text]) => g.appendChild(new Option(text, v))); return g; };
        select.replaceChildren(new Option('Ready-made logo…', ''));
        if (!isPlain()) select.appendChild(group('Team vCGE', PRESETS.map(p => [`pilot:${p.firstName}`, `${p.firstName} the ${p.lastName}`])));
        select.appendChild(group('To match a palette', Object.keys(THEME_LOGO_ART).map(k => [`theme:${k}`, THEMES[k].label])));
    }

    buildLogoBacks() {
        const picker = $('logoBgPicker');
        LOGO_BACKS.forEach(([key, label, colour]) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.dataset.back = key;
            btn.className = 'logo-bg-swatch';
            btn.title = label;
            btn.setAttribute('aria-label', label);
            btn.setAttribute('aria-pressed', String(key === 'auto'));
            if (colour) btn.style.background = colour;
            btn.addEventListener('click', () => { this.applyLogoBack(colour); this.changed(); });
            picker.before(btn);
        });
    }

    /** Puts a ready-made logo on the card, as an upload would (kept in its own colours, not traced). */
    useLogoPreset(value) {
        const [kind, key] = String(value).split(':');
        const pilot = kind === 'pilot' && !isPlain() ? PRESETS.find(p => p.firstName === key) : null;
        const url = pilot ? pilot.logo : (kind === 'theme' && THEME_LOGO_ART[key] ? themeLogoUrl(key) : null);
        if (!url) return Promise.resolve();
        const name = pilot ? `${pilot.firstName} the ${pilot.lastName}` : THEMES[key].label;
        const token = ++this.sampleLogoToken;
        return prepareLogo(url, { trace: false }).then(({ photo, display }) => {
            if (token !== this.sampleLogoToken) return;
            this.setAvatar(photo, display);
            this.changed();
            this.showToast(`Logo: ${name}`);
        }).catch(err => { console.warn('[vCGE] Ready-made logo not readable:', err); this.showToast('That logo could not be drawn.'); });
    }

    applyFont(fontClass) {
        this.fontClass = FONT_CLASSES.includes(fontClass) ? fontClass : 'font-sans';
        $('cardFontSelect').value = this.fontClass;
        ['cardFront', 'cardBack'].forEach(id => {
            $(id).classList.remove(...FONT_CLASSES);
            $(id).classList.add(this.fontClass);
        });
    }

    /** Line icons on the card, on or off (the labels then name the line: "Work phone"). */
    applyIcons(on) {
        this.cardIcons = on !== false;
        const btn = $('cardIconsBtn');
        btn.setAttribute('aria-pressed', String(this.cardIcons));
        btn.textContent = this.cardIcons ? 'Icons: on' : 'Icons: off';
        document.querySelectorAll('.card-lines').forEach(el => el.classList.toggle('card-no-icons', !this.cardIcons));
    }

    /** Text size on the card (screen only): one of CARD_SIZES, else the default. */
    applySize(size) {
        this.cardSize = CARD_SIZES.some(([k]) => k === size) ? size : DEFAULT_CARD_SIZE;
        $('cardSizeSelect').value = this.cardSize;
        ['cardFront', 'cardBack'].forEach(id => {
            $(id).classList.remove(...SIZE_CLASSES);
            $(id).classList.add(`card-size-${this.cardSize}`);
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
        this.askRemoveLogo(false);
        this.tintRim(photo);
        if (!this.logoDisplay) return;
        // Its shape and tone take a moment to read; the card is drawn again once they are known.
        const shown = this.logoDisplay;
        describeLogo(shown).then(look => {
            if (this.logoDisplay !== shown) return;
            this.logoLook = look;
            this.render(this.getContact());
        }).catch(err => console.warn('[vCGE] Logo shape not readable:', err));
    }

    /**
     * The card's rim (D1, the chameleon blending in): a soft tint taken once from the logo's own colours, read from
     * the vCard photo (a trace has lost them). The card is drawn again on every edit, so only a new logo reads it
     * again; with no logo there is no rim. The plain edition and colour-blind mode style it (cardStyles.css).
     */
    tintRim(photo) {
        if (photo === this.rimPhoto) return;
        this.rimPhoto = photo;
        const flipper = $('card3DFlipper');
        delete flipper.dataset.rim;
        flipper.style.removeProperty('--card-rim');
        if (!photo) return;
        logoTintOf(photo).then(tint => {
            if (this.rimPhoto !== photo || !tint) return;
            flipper.style.setProperty('--card-rim', tint);
            flipper.dataset.rim = '1';
        }).catch(err => console.warn('[vCGE] Logo colours not readable:', err));
    }

    /** Shows the "Remove the logo?" question in place of the Remove logo button (asking), or the button (a logo is on). */
    askRemoveLogo(asking) {
        const has = !!this.avatarBase64;
        $('removeAvatarBtn').classList.toggle('hidden', !has || asking);
        $('removeLogoConfirm').classList.toggle('hidden', !has || !asking);
        if (has && asking) $('removeLogoNo').focus();
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
            this.reportFace();
        };
        if (instant || reducedMotion()) { done(target); return; }
        if (flipper) flipper.dataset.spin = 'moving';
        const stop = tween(this.angle, target, SPIN_MS, (a) => { if (a === target) done(target); else this.setAngle(a); });
        this.stopSpin = () => { stop(); this.stopSpin = null; if (flipper) flipper.dataset.spin = 'still'; };
    }

    /** Tells onFace which side is up (or is on its way up), once per change; the flipper carries it as data-face. */
    reportFace() {
        const face = this.isFlipped ? 'back' : 'front';
        const flipper = $('card3DFlipper');
        if (flipper) flipper.dataset.face = face;
        if (face === this.face) return;
        this.face = face;
        this.onFace(face);
    }

    setFlipped(flipped, options = {}) {
        this.isFlipped = flipped;
        this.reportFace();
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

    /**
     * A tap on the card turns it the way a push there would: on its right half the right edge goes away (a turn to
     * the right), on its left half the left edge does. `side` is 'right' or 'left'.
     */
    flipFrom(side) {
        this.isFlipped = !this.isFlipped;
        this.reportFace();
        this.spinTo(Math.round(this.angle / 180) * 180 + (side === 'left' ? -180 : 180));
    }

    wireSpin() {
        const flipper = $('card3DFlipper');
        // When a press last turned the card or ended a drag: its own click, if the browser sends one, is then left alone.
        let start = null, dragging = false, handledAt = -Infinity;
        flipper.addEventListener('pointerdown', (e) => {
            if (e.button !== undefined && e.button !== 0) return;
            if (this.stopSpin) this.stopSpin();
            // A drag that starts at the screen edge is the browser's (back or forward): it never turns the card, but a
            // tap there still does.
            const edge = e.clientX < EDGE_PX || e.clientX > window.innerWidth - EDGE_PX;
            start = { x: e.clientX, angle: this.angle, id: e.pointerId, width: Math.max(1, flipper.getBoundingClientRect().width), edge };
            dragging = false;
        });
        flipper.addEventListener('pointermove', (e) => {
            if (!start || e.pointerId !== start.id) return;
            const dx = e.clientX - start.x;
            if (!dragging) {
                if (Math.abs(dx) < SPIN_TAP_PX) return;
                if (start.edge) { start = null; return; }
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
            if (wasDragging) { handledAt = performance.now(); this.spinTo(Math.round(this.angle / 180) * 180); return; }
            // A tap is taken here, on the lift, not only from the click that follows: WebKit sends no click on the card after
            // a drag there has taken the pointer, so a click-based tap would go missing.
            if (e.type !== 'pointerup' || !flipper.contains(e.target)) return;
            handledAt = performance.now();
            const r = flipper.getBoundingClientRect();
            this.flipFrom(e.clientX < r.left + r.width / 2 ? 'left' : 'right');
        };
        flipper.addEventListener('pointerup', end);
        flipper.addEventListener('pointercancel', end);
        // A finger's pointer starts captured by the element under it (a line of text on the card); taking the capture for
        // the card makes that element report lostpointercapture, which bubbles up here. Only the card's own loss ends the drag.
        flipper.addEventListener('lostpointercapture', (e) => { if (e.target === flipper) end(e); });
        // A press's own click is left alone when its lift already turned the card or ended a drag. A click with no pointer
        // events before it (an older browser) turns the card from where it landed; one with no press behind it at all
        // (assistive tech, el.click()) takes the short way, as the Flip card button does.
        flipper.addEventListener('click', (e) => {
            if (!e.detail) { this.toggleFlip(); return; }
            if (performance.now() - handledAt < CLICK_AFTER_LIFT_MS) return;
            const r = flipper.getBoundingClientRect();
            this.flipFrom(e.clientX < r.left + r.width / 2 ? 'left' : 'right');
        });
        // iOS WebKit hands a sideways finger drag to the deck's scroll (the card would only ever turn on a tap) unless
        // the touch's first move is held back. Only a drag that starts sideways is kept; an upright one still scrolls.
        let touch = null;
        flipper.addEventListener('touchstart', (e) => {
            const t = e.touches[0];
            touch = e.touches.length === 1 && t.clientX >= EDGE_PX && t.clientX <= window.innerWidth - EDGE_PX
                ? { x: t.clientX, y: t.clientY, sideways: null } : null;
        }, { passive: true });
        flipper.addEventListener('touchmove', (e) => {
            if (!touch || e.touches.length !== 1) return;
            if (touch.sideways === null) {
                const dx = Math.abs(e.touches[0].clientX - touch.x), dy = Math.abs(e.touches[0].clientY - touch.y);
                if (dx === dy) return;
                touch.sideways = dx > dy;
            }
            if (touch.sideways && e.cancelable) e.preventDefault();
        }, { passive: false });
        flipper.addEventListener('touchend', () => { touch = null; }, { passive: true });
        flipper.addEventListener('touchcancel', () => { touch = null; }, { passive: true });
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
     * @param {Object} [opts] `undone`: the toast after Undo; `after`: called once the card is back (the scan fill
     *        reopens its lines on the Read card, so Undo never ends on an empty form)
     */
    changeWithUndo(message, apply, { undone = 'Undone.', after = null } = {}) {
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
                this.showToast(undone);
                if (after) after();
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
                this.setContact({ ...createEmptyContact(), ...fields, avatarBase64: this.avatarBase64, logoDisplay: this.logoDisplay, cardFont: this.fontClass, cardSize: this.cardSize, cardIcons: this.cardIcons });
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
        $('cardSizeSelect').addEventListener('change', (e) => {
            this.applySize(e.target.value);
            this.changed();
        });
        $('logoSizeSelect').addEventListener('change', (e) => { this.applyLogoSize(e.target.value); this.changed(); });
        $('logoBgPicker').addEventListener('input', (e) => { this.applyLogoBack(e.target.value); this.changed(); });
        $('cardFinishSelect').addEventListener('change', (e) => { this.applyFinish(e.target.value); this.changed(); });
        $('cardFinishStrength').addEventListener('input', (e) => { this.applyFinish(this.finish, e.target.value); this.changed(); });
        $('logoPresetSelect').addEventListener('change', (e) => { const v = e.target.value; e.target.value = ''; if (v) this.useLogoPreset(v); });
        $('cardIconsBtn').addEventListener('click', () => {
            this.applyIcons(!this.cardIcons);
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
        // Remove logo asks first; the question takes the button's place until it is answered.
        $('removeAvatarBtn').addEventListener('click', () => this.askRemoveLogo(true));
        $('removeLogoNo').addEventListener('click', () => { this.askRemoveLogo(false); $('removeAvatarBtn').focus(); });
        $('removeLogoYes').addEventListener('click', () => {
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
// The logo tile (rounded-2xl, 16 px corners) and the wordmark strip (rounded-xl, 12 px) clip anything nearer a corner
// than 0.29 of its radius; the logo is inset by more than that (6 px and 4 px), so the rounding never cuts it.
export const LOGO_INSET = 'p-1.5';
export const LOGO_INSET_STRIP = 'p-1';

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
 * Shape and tone of a prepared display logo, for the card layout: { wide, transparent, tone, traced, edge } where tone
 * is 'light' or 'dark' when most of the logo is, else null, and edge is an opaque logo's edge colour (`rgb(r,g,b)`).
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
    const transparent = isTransparent(px, cw * ch);
    // An opaque logo's edge colour fills the tile around it, so its own background reaches the rounded edge.
    const edge = transparent ? null : logoBounds(px, cw, ch).edge;
    return { wide: w / h >= WIDE_LOGO, transparent, tone: toneOf(px, cw, { x: 0, y: 0, w: cw, h: ch }), traced: false, edge };
}

/** The rim's tint (D1) from a logo's vCard photo: `rgb(r, g, b)`, or null when the photo is its background only. */
export async function logoTintOf(photoUrl) {
    const { img, w, h } = await loadLogo(photoUrl);
    const k = Math.min(1, 48 / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * k)), ch = Math.max(1, Math.round(h * k));
    const c = canvasOf(cw, ch);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, cw, ch);
    const px = ctx.getImageData(0, 0, cw, ch).data;
    c.width = c.height = 0;
    return logoTint(px, cw * ch);
}

const TINT_OFF_BACK = 48;     // RGB distance from the photo's corner (the background it is laid on) to count as the logo
const TINT_SATURATED = 0.25;  // a pixel this colourful (chroma over its brightest channel) counts as a colour
const TINT_MIN_COLOUR = 0.05; // less of the logo than this in colour: a grey logo, and its average grey is the tint

/**
 * The logo's colour from the photo's pixels: the photo's corner is the background it was laid on, so the pixels far
 * from it are the logo. Its colourful pixels give the tint when there are enough of them, else a colourful
 * background (an opaque logo's own), else the logo's average grey.
 * @param {Uint8ClampedArray} px  RGBA
 * @param {number} n  pixel count
 */
export function logoTint(px, n) {
    const back = [px[0], px[1], px[2]];
    const all = [0, 0, 0], colour = [0, 0, 0];
    let logo = 0, colourful = 0;
    for (let i = 0; i < n; i++) {
        const k = i * 4, r = px[k], g = px[k + 1], b = px[k + 2];
        if (px[k + 3] <= 128 || Math.hypot(r - back[0], g - back[1], b - back[2]) <= TINT_OFF_BACK) continue;
        logo++;
        all[0] += r; all[1] += g; all[2] += b;
        const max = Math.max(r, g, b);
        if (max && (max - Math.min(r, g, b)) / max >= TINT_SATURATED) { colourful++; colour[0] += r; colour[1] += g; colour[2] += b; }
    }
    const rgb = (sum, count) => `rgb(${sum.map(v => Math.round(v / count)).join(', ')})`;
    if (logo && colourful / logo >= TINT_MIN_COLOUR) return rgb(colour, colourful);
    // An opaque logo is laid on its own edge colour: a colourful one (white lettering on red) is the logo's colour.
    const backMax = Math.max(...back);
    if (backMax && (backMax - Math.min(...back)) / backMax >= TINT_SATURATED) return rgb(back, 1);
    return logo ? rgb(all, logo) : null;
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

/**
 * The distance from colour `p` to the line from the background colour `back` through the ink colour `ink` (RGB), open
 * past the ink: `ink` is the ink's average, which its soft edges pull towards the background, so the solid ink lies
 * beyond it on the same line.
 */
export function distanceToInkLine(p, ink, back) {
    const bi = [ink[0] - back[0], ink[1] - back[1], ink[2] - back[2]], bp = [p[0] - back[0], p[1] - back[1], p[2] - back[2]];
    const len2 = bi[0] * bi[0] + bi[1] * bi[1] + bi[2] * bi[2];
    const t = len2 ? Math.max(0, (bp[0] * bi[0] + bp[1] * bi[1] + bp[2] * bi[2]) / len2) : 0;
    return Math.hypot(bp[0] - bi[0] * t, bp[1] - bi[1] * t, bp[2] - bi[2] * t);
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
    // A two-colour logo's pixels lie on the line from its background through its ink (the soft edges of lettering, JPEG
    // ringing, and the solid ink past the average): a pixel far from that line is a third colour. A transparent logo's background counts as white.
    const back = transparent ? [255, 255, 255] : edgeRgb;
    let mixed = 0;
    for (let y = box.y; y < box.y + box.h; y++) {
        for (let x = box.x; x < box.x + box.w; x++) {
            const k = (y * w + x) * 4;
            if (ink(k) && distanceToInkLine([px[k], px[k + 1], px[k + 2]], mean, back) > TRACE_MAX_OFF_LINE) mixed++;
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
