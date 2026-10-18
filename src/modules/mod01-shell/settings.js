/**
 * vCGE-MOD01: saved settings (redesign step 4)
 * Created by raven575, Gemini & Claude
 *
 * The one thing vCGE keeps on the device: a single localStorage entry of preferences and nothing else (raven575,
 * 2026-10-17). One line of `name=number` pairs, for example `hand=0;cb=0;theme=0;font=0;size=0;wipe=0`. Missing or unreadable
 * means the defaults. Nothing scanned, uploaded or typed, and no contact detail, ever goes in here: the whole entry is
 * six small numbers. It is written only when the person changes a setting, so a visit that touches nothing stores nothing.
 *
 *   hand   0 right (default), 1 left: `html[data-hand="right|left"]` for the header mirror, the trash corner, the
 *          Welcome buttons' thumb line and any module that places a control by hand (MOD03's shutter and fader).
 *   cb     0 off (default), 1 on: colour-blind mode, `html[data-cb="1"]` (MOD02's wipe dialog reads it).
 *   theme  0 dark (default), 1 light: the `dark` class on <html> (Tailwind `darkMode: 'class'`).
 *   font   the UI font by its fixed code (FONT_CODES; Inter = 0): `html[data-font]` plus the --vcge-ui-font variable.
 *   size   the text size by its fixed code (TEXT_SIZES; Normal = 0): `html[data-size]` plus --vcge-size, the factor every
 *          rem-sized thing on the page grows by, except the header, which keeps its own size (deck.css, video #6).
 *   wipe   how long after a PIN lock the card is wiped (WIPE_TIMES; 0 = 7 minutes, the default, 1 = 10, 2 = 15):
 *          `html[data-wipe="7|10|15"]`. MOD02 reads only that attribute, never this storage. The 2-minute lock itself
 *          never changes (raven575, 2026-10-18, video #68).
 *
 * Each font and size keeps its number for good, so adding more later and re-sorting a list never changes a saved choice.
 * An entry saved before the size or wipe setting existed simply has none: Normal, 7 minutes.
 * The wipe dialog's "Also delete my saved settings" arrives as Events.SETTINGS_WIPE_REQUESTED on the bus and clears
 * the entry; Vault never touches this storage itself. The theme key saved before this step is read once and removed.
 */
import { globalEventBus, Events } from '../../share/eventBus.js';
import { UI_FONTS, DEFAULT_UI_FONT } from './ui.js';

export const SETTINGS_KEY = 'vcge_settings';
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
export const DEFAULTS = Object.freeze({ hand: 0, cb: 0, theme: 0, font: FONT_CODES[DEFAULT_UI_FONT], size: 0, wipe: 0 });
const RANGE = { hand: 1, cb: 1, theme: 1, font: Math.max(...Object.values(FONT_CODES)), size: Math.max(...TEXT_SIZES.map(t => t.code)),
    wipe: Math.max(...WIPE_TIMES.map(t => t.code)) };

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
const serializeRaw = (s) => Object.keys(DEFAULTS).map(k => `${k}=${k in s ? s[k] : DEFAULTS[k]}`).join(';');

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

/** Put the settings on <html>: the hand, colour-blind, font, size and wipe hooks and the dark class. */
export function applySettings(settings, root = document.documentElement) {
    const s = parseSettings(serializeRaw(settings));
    root.dataset.hand = s.hand === 1 ? 'left' : 'right';
    if (s.cb === 1) root.dataset.cb = '1'; else delete root.dataset.cb;
    root.classList.toggle('dark', s.theme !== 1);
    root.dataset.font = String(s.font);
    root.style.setProperty('--vcge-ui-font', `'${fontFor(s.font)}'`);
    root.dataset.size = String(s.size);
    root.style.setProperty('--vcge-size', String(scaleFor(s.size)));
    root.dataset.wipe = String(wipeMinutesFor(s.wipe));
    return s;
}

// ---- The Settings sheet ------------------------------------------------------------------------------------------

/**
 * Wire the sheet's controls (any of them may be missing), apply the saved settings and listen for the wipe signal.
 * Controls: #handRightBtn / #handLeftBtn, #cbToggle (checkbox), #themeToggle (button), #fontSelect, #sizeSelect and #wipeSelect (selects).
 */
export function initSettings(doc = document) {
    const $ = (id) => doc.getElementById(id);
    let s = applySettings(loadSettings());

    const set = (change) => { s = applySettings({ ...s, ...change }); saveSettings(s); reflect(); };
    const reflect = () => {
        const right = $('handRightBtn'), left = $('handLeftBtn'), cb = $('cbToggle'), theme = $('themeToggle'), font = $('fontSelect'), size = $('sizeSelect'), wipe = $('wipeSelect');
        if (right) right.setAttribute('aria-pressed', String(s.hand === 0));
        if (left) left.setAttribute('aria-pressed', String(s.hand === 1));
        if (cb) cb.checked = s.cb === 1;
        if (theme) { theme.textContent = s.theme === 1 ? '☀️' : '🌙'; theme.setAttribute('aria-pressed', String(s.theme === 1)); }
        if (font) font.value = String(s.font);
        if (size) size.value = String(s.size);
        if (wipe) wipe.value = String(s.wipe);
    };

    const font = $('fontSelect');
    if (font && !font.options.length) {
        for (const name of UI_FONTS) {                      // alphabetical, each with its fixed code
            const o = doc.createElement('option');
            o.value = String(FONT_CODES[name]); o.textContent = name; o.style.fontFamily = `'${name}'`;
            font.append(o);
        }
    }
    const size = $('sizeSelect');
    if (size && !size.options.length) {
        for (const t of TEXT_SIZES) {                       // smallest first, each with its fixed code
            const o = doc.createElement('option');
            o.value = String(t.code); o.textContent = t.name;
            size.append(o);
        }
    }
    const wipe = $('wipeSelect');
    if (wipe && !wipe.options.length) {
        for (const t of WIPE_TIMES) {                       // shortest first, each with its fixed code
            const o = doc.createElement('option');
            o.value = String(t.code); o.textContent = `${t.minutes} minutes`;
            wipe.append(o);
        }
    }
    $('handRightBtn')?.addEventListener('click', () => set({ hand: 0 }));
    $('handLeftBtn')?.addEventListener('click', () => set({ hand: 1 }));
    $('cbToggle')?.addEventListener('change', (e) => set({ cb: e.target.checked ? 1 : 0 }));
    $('themeToggle')?.addEventListener('click', () => set({ theme: s.theme === 1 ? 0 : 1 }));
    font?.addEventListener('change', (e) => set({ font: Number(e.target.value) }));
    size?.addEventListener('change', (e) => set({ size: Number(e.target.value) }));
    wipe?.addEventListener('change', (e) => set({ wipe: Number(e.target.value) }));
    reflect();

    globalEventBus.subscribe(Events.SETTINGS_WIPE_REQUESTED, () => clearSettings());
    return () => ({ ...s });
}
