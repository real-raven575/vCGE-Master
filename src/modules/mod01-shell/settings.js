/**
 * vCGE-MOD01: saved settings (redesign step 4)
 * Created by raven575, Team vCGE (Claude) & Gemini
 *
 * The one thing vCGE keeps on the device: a single localStorage entry of preferences and nothing else (raven575,
 * 2026-10-17). One line of `name=number` pairs, for example `hand=0;cb=0;theme=0;font=0;size=0;wipe=0`. Missing or unreadable
 * means the defaults. Nothing scanned, uploaded or typed, and no contact detail, ever goes in here: the whole entry is
 * a few small numbers. It is written only when the person changes a setting, so a visit that touches nothing stores nothing.
 *
 *   hand   0 right (default), 1 left: `html[data-hand="right|left"]` for the header mirror, the
 *          Welcome buttons' thumb line and any module that places a control by hand (MOD03's shutter and fader).
 *   cb     0 off (default), 1 on: colour-blind mode, `html[data-cb="1"]` (MOD02's wipe dialog reads it).
 *   theme  the colour theme by its fixed code (themes.js; 0 Dark, the default, 1 Light (both in Creative's Herd colours),
 *          then the Autumn and Team vCGE themes, then Creative's Everyday and Seasonal ones from 28): its mode sets the `dark` class on <html> (Tailwind `darkMode: 'class'`), its colours the --vcge-*
 *          variables and html[data-app-theme]. Plain shows no branded theme and reads a saved one as Dark or Light.
 *   font   the UI font by its fixed code (FONT_CODES; Inter = 0): `html[data-font]` plus the --vcge-ui-font variable.
 *   size   the text size by its fixed code (TEXT_SIZES; Normal = 0): `html[data-size]` plus --vcge-size, the factor every
 *          rem-sized thing on the page grows by, except the header, which keeps its own size (deck.css, video #6).
 *   wipe   how long after a PIN lock the card is wiped (WIPE_TIMES; 0 = 7 minutes, the default, 1 = 10, 2 = 15):
 *          `html[data-wipe="7|10|15"]`. MOD02 reads only that attribute, never this storage. The 2-minute lock itself
 *          never changes (raven575, 2026-10-18, video #68).
 *   mode   Appearance (0.8 Settings sheet, CRTV-0020): 0 as the theme code says (Light or Dark, the default, and what every
 *          older entry means), 1 System: the theme's family (themes.js THEME_FAMILIES, its fixed light and dark codes)
 *          follows the device's light or dark setting. `theme` still holds a fixed code, so nothing is renumbered.
 *   style  the platform style (STYLES; 0 Herd, the default, 1 Material, 2 iOS, 3 Windows, 4 GNOME, 5 KDE): html[data-style].
 *   tex    the halftone background texture: 0 on (the default), 1 off: html[data-tex="on|off"].
 *          mode, style and tex are written only once they differ from their defaults, so older entries read the same.
 *
 * Each font and size keeps its number for good, so adding more later and re-sorting a list never changes a saved choice.
 * An entry saved before the size or wipe setting existed simply has none: Normal, 7 minutes.
 * The wipe dialog's "Also delete my saved settings" arrives as Events.SETTINGS_WIPE_REQUESTED on the bus and clears
 * the entry; Vault never touches this storage itself. The theme key saved before this step is read once and removed.
 */
import { globalEventBus, Events } from '../../share/eventBus.js';
import { UI_FONTS, DEFAULT_UI_FONT } from './ui.js';
import { THEMES, THEME_FAMILIES, themeFor, familyOf, familyCode, applyTheme } from './themes.js';

import { SETTINGS_KEY, isPlainLook } from './edition.js';
export { SETTINGS_KEY };
const OLD_THEME_KEY = 'vcge_theme_preference';

// Fixed, never reused: the order the fonts were added, not the alphabetical order shown in Settings.
export const FONT_CODES = Object.freeze({
    'Inter': 0, 'Atkinson Hyperlegible': 1, 'Lexend': 2, 'OpenDyslexic': 3, 'Tinos': 4, 'Comic Neue': 5, 'Macondo': 6
});
// Text sizes: fixed codes, shown smallest first. Normal is the size vCGE has always had.
export const TEXT_SIZES = Object.freeze([
    { code: 3, name: 'Small', scale: 0.875 }, { code: 0, name: 'Normal', scale: 1 },
    { code: 1, name: 'Large', scale: 1.125 }, { code: 2, name: 'Larger', scale: 1.25 }
]);
// Wipe after the lock: fixed codes, shortest first. 7 minutes is the time vCGE has always had; 15 is the longest.
export const WIPE_TIMES = Object.freeze([{ code: 0, minutes: 7 }, { code: 1, minutes: 10 }, { code: 2, minutes: 15 }]);
// Platform styles (0.8, CRTV-0020): Herd is vCGE's own; the others follow Android (Material), iPhone (iOS), Windows 11,
// GNOME and KDE Plasma. html[data-style] carries the id; the look itself is CSS only (screens-r5.css).
export const STYLES = Object.freeze([
    { code: 0, id: 'herd', name: 'Herd' }, { code: 1, id: 'material', name: 'Material' }, { code: 2, id: 'ios', name: 'iOS' },
    { code: 3, id: 'windows', name: 'Windows' }, { code: 4, id: 'gnome', name: 'GNOME' }, { code: 5, id: 'kde', name: 'KDE' }
]);
export const DEFAULTS = Object.freeze({ hand: 0, cb: 0, theme: 0, font: FONT_CODES[DEFAULT_UI_FONT], size: 0, wipe: 0, mode: 0, style: 0, tex: 0, look: 0 });
// The names every entry has carried since step 4; the 0.8 ones (mode, style, tex) are written only once they differ from
// their defaults, so an entry nobody changed them in reads exactly as before.
const CORE = ['hand', 'cb', 'theme', 'font', 'size', 'wipe'];
const RANGE = { hand: 1, cb: 1, theme: Math.max(...THEMES.map(t => t.code)), font: Math.max(...Object.values(FONT_CODES)), size: Math.max(...TEXT_SIZES.map(t => t.code)),
    wipe: Math.max(...WIPE_TIMES.map(t => t.code)), mode: 1, style: Math.max(...STYLES.map(t => t.code)), tex: 1, look: 1 };

/** The text-size factor for a code (1 when the code is unknown). */
export function scaleFor(code) {
    const size = TEXT_SIZES.find(t => t.code === code);
    return size ? size.scale : 1;
}

/** The wipe time in minutes for a code (7 when the code is unknown). */
export function wipeMinutesFor(code) {
    const wipe = WIPE_TIMES.find(t => t.code === code);
    return wipe ? wipe.minutes : 7;
}

/** The font name for a code, or the default font when the code is unknown. */
export function fontFor(code) {
    return Object.keys(FONT_CODES).find(name => FONT_CODES[name] === code) || DEFAULT_UI_FONT;
}

/** `hand=0;cb=0;theme=0;font=0;size=0;wipe=0` -> settings. Unknown names are dropped; a missing or bad value is its default. */
export function parseSettings(line) {
    const out = { ...DEFAULTS };
    if (typeof line !== 'string') return out;
    for (const pair of line.split(';')) {
        const [name, value] = pair.split('=');
        if (!(name in DEFAULTS) || !/^\d{1,3}$/.test(value || '')) continue;
        const n = Number(value);
        if (n <= RANGE[name]) out[name] = n;
    }
    return out;
}

/** settings -> `hand=0;cb=0;theme=0;font=0;size=0;wipe=0`, always every name in the same order. */
export function serializeSettings(settings) {
    const s = parseSettings(serializeRaw(settings));   // clamps and fills in defaults
    return serializeRaw(s);
}
const serializeRaw = (s) => Object.keys(DEFAULTS).filter(k => CORE.includes(k) || (k in s && s[k] !== DEFAULTS[k]))
    .map(k => `${k}=${k in s ? s[k] : DEFAULTS[k]}`).join(';');

/** True when the device asks for dark (prefers-color-scheme); false where it cannot say. */
export function systemDark(win = typeof window !== 'undefined' ? window : null) {
    try { return !!(win && win.matchMedia && win.matchMedia('(prefers-color-scheme: dark)').matches); } catch { return false; }
}

/** The theme code to show: the saved one, or with Appearance on System its family's light or dark version. */
export function effectiveTheme(settings, dark = systemDark()) {
    if (settings.mode !== 1) return settings.theme;
    return familyCode(familyOf(settings.theme), dark ? 'dark' : 'light');
}

/** The style for a code (Herd when the code is unknown). */
export function styleFor(code) {
    return STYLES.find(t => t.code === code) || STYLES[0];
}

/** Read the entry (defaults when missing or unreadable). */
export function loadSettings(storage = localStorage) {
    try {
        let line = storage.getItem(SETTINGS_KEY);
        const oldTheme = storage.getItem(OLD_THEME_KEY);
        if (oldTheme !== null) {            // the key themeManager.js kept before step 4: carry the choice over, once
            storage.removeItem(OLD_THEME_KEY);
            if (line === null) line = `theme=${oldTheme === 'light' ? 1 : 0}`;
        }
        return parseSettings(line);
    } catch { return { ...DEFAULTS }; }
}

/** Write the whole entry (one key, one line). */
export function saveSettings(settings, storage = localStorage) {
    try { storage.setItem(SETTINGS_KEY, serializeSettings(settings)); } catch { /* storage blocked: the choice lasts this visit */ }
}

/** Remove the entry: the wipe dialog's "Also delete my saved settings". */
export function clearSettings(storage = localStorage) {
    try { storage.removeItem(SETTINGS_KEY); storage.removeItem(OLD_THEME_KEY); } catch { /* nothing to remove */ }
}

/** Put the settings on <html>: the hand, colour-blind, font, size and wipe hooks, the theme (the dark class and its
 *  colours, through Appearance), the platform style (html[data-style]) and the background texture (html[data-tex]). */
export function applySettings(settings, root = document.documentElement, dark = systemDark()) {
    const s = parseSettings(serializeRaw(settings));
    root.dataset.hand = s.hand === 1 ? 'left' : 'right';
    if (s.cb === 1) root.dataset.cb = '1'; else delete root.dataset.cb;
    applyTheme(root, effectiveTheme(s, dark), root.dataset.edition === 'plain');
    root.dataset.style = styleFor(s.style).id;
    root.dataset.tex = s.tex === 1 ? 'off' : 'on';
    root.dataset.font = String(s.font);
    root.style.setProperty('--vcge-ui-font', `'${fontFor(s.font)}'`);
    root.dataset.size = String(s.size);
    root.style.setProperty('--vcge-size', String(scaleFor(s.size)));
    root.dataset.wipe = String(wipeMinutesFor(s.wipe));
    return s;
}

// ---- The Settings sheet (0.8, Creative's CRTV-0020 mock-up) ---------------------------------------------------------

/** The quick picks in the theme box (raven575, 2026-11-03): one tap after opening it. Every other palette is under More themes. */
export const QUICK_THEMES = Object.freeze(['herd', 'signal', 'graphite']);
/** The swatch groups: the quick picks in view once the box is open; the rest of Everyday, Seasonal, the card colours and
 *  the Team under More themes. */
export const SWATCH_GROUPS = Object.freeze([
    { group: 'Quick', label: 'Quick picks', more: false }, { group: 'Everyday', label: 'Everyday', more: true },
    { group: 'Seasonal', label: 'Seasonal', more: true }, { group: 'Autumn', label: 'Card colours', more: true },
    { group: 'Team vCGE', label: 'Team vCGE', more: true }
]);
/** The palettes a swatch group shows: Quick is QUICK_THEMES in that order; the others leave the quick picks out. */
export function swatchFamilies(families, group) {
    if (group === 'Quick') return QUICK_THEMES.map(id => families.find(f => f.id === id)).filter(Boolean);
    return families.filter(f => f.group === group && !QUICK_THEMES.includes(f.id));
}
/** The font code the Dyslexia-friendly switch sets: OpenDyslexic on, Inter (the default) off. */
export const DYSLEXIA_FONT = FONT_CODES['OpenDyslexic'];
export const dyslexiaFont = (on) => (on ? DYSLEXIA_FONT : FONT_CODES[DEFAULT_UI_FONT]);

/**
 * Wire the sheets' controls (any of them may be missing), apply the saved settings and listen for the wipe signal.
 * Settings: #themePicker (the closed theme box; #themeSummary shows the theme in use), #appThemes (the quick-pick
 * swatches, built here; #moreThemes holds the other groups), #appearanceChips (System / Light / Dark), #styleChips (the six
 * platform styles), #sizeRange (text size), #fontSelect, and the switches #dyslexiaToggle, #cbToggle, #handToggle and #texToggle. The Vault sheet: #wipeChips (7, 10 or 15 minutes after the lock).
 */
/** hasContacts: true while anything is held in memory (MOD02's vault); restart: starts vCGE fresh (main.js passes startFresh). */
export function initSettings(doc = document, { hasContacts = () => false, restart = () => {} } = {}) {
    const $ = (id) => doc.getElementById(id);
    const win = doc.defaultView || (typeof window !== 'undefined' ? window : null);
    const dark = () => systemDark(win);
    let s = applySettings(loadSettings(), doc.documentElement, dark());
    const plain = doc.documentElement && doc.documentElement.dataset.edition === 'plain';
    const families = THEME_FAMILIES.filter(f => !(plain && f.branded));

    const set = (change) => { s = applySettings({ ...s, ...change }, doc.documentElement, dark()); saveSettings(s); reflect(); };
    // The theme in view (a branded one reads as Dark or Light in plain) and its family
    const shown = () => themeFor(effectiveTheme(s, dark()), plain);
    const pressAll = (root, sel, test) => root && root.querySelectorAll(sel).forEach(b => b.setAttribute('aria-pressed', String(test(b))));

    const reflect = () => {
        const t = shown(), fam = familyOf(t.code), both = fam.light !== null && fam.dark !== null;
        pressAll($('appThemes'), '[data-family]', b => b.dataset.family === fam.id);
        const more = $('moreThemes');
        if (more && !QUICK_THEMES.includes(fam.id) && families.some(f => f.id === fam.id)) more.open = true;
        const sumName = $('themeSummaryName'), sumSw = $('themeSummarySwatch');
        if (sumName) sumName.textContent = fam.label;
        if (sumSw) { sumSw.style.setProperty('--sw-a', t.vars ? t.vars.accent : ''); sumSw.style.setProperty('--sw-b', t.vars ? t.vars.bg : ''); }
        const chips = $('appearanceChips');
        pressAll(chips, '[data-v]', b => b.dataset.v === (s.mode === 1 && both ? 'system' : t.mode));
        chips?.querySelectorAll('[data-v]').forEach(b => { b.disabled = !both && b.dataset.v !== t.mode; });
        const one = $('appearanceOne');
        if (one) one.classList.toggle('hidden', both);
        pressAll($('styleChips'), '[data-style]', b => b.dataset.style === styleFor(s.style).id);
        pressAll($('wipeChips'), '[data-wipe]', b => Number(b.dataset.wipe) === s.wipe);
        const size = $('sizeRange');
        if (size) {
            const i = Math.max(0, TEXT_SIZES.findIndex(x => x.code === s.size));
            size.value = String(i); size.setAttribute('aria-valuetext', TEXT_SIZES[i].name);
        }
        const hand = $('handToggle'), cb = $('cbToggle'), tex = $('texToggle'), font = $('fontSelect'), dys = $('dyslexiaToggle');
        if (dys) dys.checked = s.font === DYSLEXIA_FONT;
        if (hand) hand.checked = s.hand === 1;
        if (cb) cb.checked = s.cb === 1;
        if (tex) tex.checked = s.tex === 0;
        if (font) font.value = String(s.font);
    };

    // Theme swatches: one per palette, its light accent over its dark page (the mock-up), grouped as in the mock-up
    const themes = $('appThemes');
    if (themes && !themes.querySelector('[data-family]')) {
        const more = $('moreThemesGrid');
        for (const g of SWATCH_GROUPS) {
            const list = swatchFamilies(families, g.group);
            const host = g.more ? more : themes;
            if (!list.length || !host) continue;
            const head = doc.createElement('span');
            head.className = 'r5-tgroup'; head.textContent = g.label;
            host.append(head);
            for (const f of list) {
                const light = f.light !== null ? themeFor(f.light) : null, darkT = f.dark !== null ? themeFor(f.dark) : null;
                const b = doc.createElement('button');
                b.type = 'button'; b.className = 'r5-swatch'; b.dataset.family = f.id;
                if (f.light !== null) b.dataset.light = String(f.light);
                if (f.dark !== null) b.dataset.dark = String(f.dark);
                b.setAttribute('aria-label', `${f.label} theme${f.season ? `, ${f.season}` : ''}${g.more ? ` (${g.label})` : ''}`);
                const i = doc.createElement('i');
                i.setAttribute('aria-hidden', 'true');
                i.style.setProperty('--sw-a', (light || darkT).vars.accent);
                i.style.setProperty('--sw-b', (darkT || light).vars.bg);
                const name = doc.createElement('span');
                name.textContent = f.label;
                b.append(i, name);
                if (f.season) { const when = doc.createElement('small'); when.textContent = f.season; b.append(when); }
                b.addEventListener('click', () => pickFamily(f));
                host.append(b);
            }
        }
        if (more && !more.querySelector('[data-family]')) $('moreThemes')?.classList.add('hidden');
    }
    // A palette keeps the Appearance chosen: System follows the device, Light or Dark takes that version (or its only one)
    const pickFamily = (f) => {
        const both = f.light !== null && f.dark !== null;
        if (s.mode === 1 && both) return set({ theme: familyCode(f, dark() ? 'dark' : 'light'), mode: 1 });
        const m = s.mode === 1 ? (dark() ? 'dark' : 'light') : shown().mode;
        set({ theme: familyCode(f, m), mode: 0 });
    };
    const pickAppearance = (v) => {
        const f = familyOf(shown().code);
        if (v === 'system') { if (f.light !== null && f.dark !== null) set({ mode: 1, theme: familyCode(f, dark() ? 'dark' : 'light') }); return; }
        set({ mode: 0, theme: familyCode(f, v) });
    };
    $('appearanceChips')?.querySelectorAll('[data-v]').forEach(b => b.addEventListener('click', () => pickAppearance(b.dataset.v)));
    $('styleChips')?.querySelectorAll('[data-style]').forEach(b => b.addEventListener('click', () => set({ style: STYLES.find(t => t.id === b.dataset.style)?.code ?? 0 })));
    $('wipeChips')?.querySelectorAll('[data-wipe]').forEach(b => b.addEventListener('click', () => set({ wipe: Number(b.dataset.wipe) })));

    const font = $('fontSelect');
    if (font && !font.options.length) {
        for (const name of UI_FONTS) {                      // alphabetical, each with its fixed code
            const o = doc.createElement('option');
            o.value = String(FONT_CODES[name]); o.textContent = name; o.style.fontFamily = `'${name}'`;
            font.append(o);
        }
    }
    const size = $('sizeRange');                            // the slider walks the fixed sizes, smallest first
    if (size) { size.min = '0'; size.max = String(TEXT_SIZES.length - 1); size.step = '1'; }
    size?.addEventListener('input', (e) => set({ size: (TEXT_SIZES[Number(e.target.value)] || TEXT_SIZES[1]).code }));
    $('handToggle')?.addEventListener('change', (e) => set({ hand: e.target.checked ? 1 : 0 }));
    $('cbToggle')?.addEventListener('change', (e) => set({ cb: e.target.checked ? 1 : 0 }));
    $('dyslexiaToggle')?.addEventListener('change', (e) => set({ font: dyslexiaFont(e.target.checked) }));
    $('texToggle')?.addEventListener('change', (e) => set({ tex: e.target.checked ? 0 : 1 }));
    font?.addEventListener('change', (e) => set({ font: Number(e.target.value) }));
    // Plain look: in the Plain download the switch is on and fixed (that build is plain by its html line). In the Herd build it
    // is live: look=1 is saved and vCGE starts fresh in the Plain look (applySavedLook, edition.js); with contacts in memory it
    // asks first, because starting fresh clears them.
    const plainSw = $('plainToggle');
    if (plainSw) {
        const note = $('plainNote'), ask = $('plainConfirm');
        if (plain && !isPlainLook(doc)) {
            plainSw.disabled = true; plainSw.checked = true;
            if (note) note.textContent = 'This is the Plain edition: no Herd pilots or art';
        } else {
            plainSw.disabled = false; plainSw.checked = s.look === 1;
            const switchLook = () => { s = { ...s, look: plainSw.checked ? 1 : 0 }; saveSettings(s); restart(); };
            const hideAsk = () => ask?.classList.add('hidden');
            plainSw.addEventListener('change', () => {
                if (!hasContacts() || !ask) return switchLook();
                ask.classList.remove('hidden');
            });
            $('plainYesBtn')?.addEventListener('click', () => { hideAsk(); switchLook(); });
            $('plainNoBtn')?.addEventListener('click', () => { hideAsk(); plainSw.checked = s.look === 1; });
        }
    }
    // Appearance on System follows the device as it changes (nothing is written)
    try {
        win?.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', () => {
            if (s.mode !== 1) return;
            s = applySettings(s, doc.documentElement, dark()); reflect();
        });
    } catch { /* an old browser without change events: System applies at the next start */ }
    reflect();

    globalEventBus.subscribe(Events.SETTINGS_WIPE_REQUESTED, () => clearSettings());
    return () => ({ ...s });
}
