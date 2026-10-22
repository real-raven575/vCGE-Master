/**
 * vCGE-MOD01: app themes (theme step 1, raven575's test report 2026-10-22; approved 2026-10-22 19:01 UTC)
 * Created by raven575, Team vCGE (Claude) & Gemini
 *
 * The colour themes in Settings. Dark and Light are the app's own look and set no colours here. Every other theme is
 * one set of seven colours, put on <html> as CSS variables (--vcge-bg, --vcge-surface, --vcge-text, --vcge-muted,
 * --vcge-accent, --vcge-on-accent, --vcge-border) with html[data-app-theme] naming it; its mode (dark or light) still
 * sets the `dark` class, so everything not yet themed keeps working. Step 1 colours the frame (page, header, cards,
 * sheets: deck.css); each module follows in its own step. The eight Autumn themes come from the card palettes
 * (MOD06); the Team vCGE themes (one dark, one light per character) are branded only, so plain never lists them.
 * Text reads at 4.5:1 or better on its surface and page, the lit accent at 3:1 on the surface (unit tests).
 * The codes are fixed for good: the saved settings line keeps the number.
 */

export const BASIC_THEMES = Object.freeze([
    { code: 0, id: 'dark', label: 'Dark', group: 'Basic', mode: 'dark' },
    { code: 1, id: 'light', label: 'Light', group: 'Basic', mode: 'light' }
]);
export const COLOUR_THEMES = Object.freeze([
    { code: 2, id: 'pumpkin', label: 'Pumpkin', group: 'Autumn', mode: 'light',
      vars: { bg: '#f3ddce', surface: '#faf4f0', text: '#2b1c12', muted: '#665447', accent: '#e16b18', onAccent: '#0b0b0f', border: '#d5beae' } },
    { code: 3, id: 'maple', label: 'Maple', group: 'Autumn', mode: 'dark',
      vars: { bg: '#240c0a', surface: '#3d1814', text: '#f4edec', muted: '#c2afad', accent: '#f0b36a', onAccent: '#0b0b0f', border: '#683631' } },
    { code: 4, id: 'harvest', label: 'Harvest Gold', group: 'Autumn', mode: 'light',
      vars: { bg: '#f2e7cf', surface: '#f9f6f0', text: '#2a2313', muted: '#665c47', accent: '#b07a10', onAccent: '#0b0b0f', border: '#d4c8b0' } },
    { code: 5, id: 'cranberry', label: 'Cranberry', group: 'Autumn', mode: 'dark',
      vars: { bg: '#240913', surface: '#3e1423', text: '#f4ecef', muted: '#c2adb5', accent: '#f4a2bd', onAccent: '#0b0b0f', border: '#693044' } },
    { code: 6, id: 'spruce', label: 'Spruce', group: 'Autumn', mode: 'dark',
      vars: { bg: '#0f1f19', surface: '#1d352b', text: '#ecf4f1', muted: '#adc2ba', accent: '#9bd3b3', onAccent: '#0b0b0f', border: '#3d5c50' } },
    { code: 7, id: 'sage', label: 'Sage', group: 'Autumn', mode: 'light',
      vars: { bg: '#e1e5db', surface: '#f5f6f4', text: '#1f221b', muted: '#596647', accent: '#3f5a36', onAccent: '#ffffff', border: '#c2c7bd' } },
    { code: 8, id: 'slateblue', label: 'Slate Blue', group: 'Autumn', mode: 'dark',
      vars: { bg: '#12161c', surface: '#202831', text: '#eceff4', muted: '#adb6c2', accent: '#a9c6e3', onAccent: '#0b0b0f', border: '#414b58' } },
    { code: 9, id: 'twilight', label: 'Twilight', group: 'Autumn', mode: 'dark',
      vars: { bg: '#12101e', surface: '#211e34', text: '#edecf4', muted: '#b0adc2', accent: '#bba9f2', onAccent: '#0b0b0f', border: '#423e5b' } },
    { code: 10, id: 'cornerstone-dark', label: 'Cornerstone the Elephant (dark)', group: 'Team vCGE', mode: 'dark', branded: true,
      vars: { bg: '#15141a', surface: '#26242e', text: '#eeecf4', muted: '#b2adc2', accent: '#f2b33d', onAccent: '#0b0b0f', border: '#494653' } },
    { code: 11, id: 'cornerstone-light', label: 'Cornerstone the Elephant (light)', group: 'Team vCGE', mode: 'light', branded: true,
      vars: { bg: '#dedce5', surface: '#f4f4f6', text: '#1d1c21', muted: '#4f4766', accent: '#bc7f0d', onAccent: '#0b0b0f', border: '#c0bdc6' } },
    { code: 12, id: 'shutout-dark', label: 'Shutout the Box Turtle (dark)', group: 'Team vCGE', mode: 'dark', branded: true,
      vars: { bg: '#1c200e', surface: '#30371b', text: '#f2f4ec', muted: '#bdc2ad', accent: '#e0a526', onAccent: '#0b0b0f', border: '#576039' } },
    { code: 13, id: 'shutout-light', label: 'Shutout the Box Turtle (light)', group: 'Team vCGE', mode: 'light', branded: true,
      vars: { bg: '#e7edd4', surface: '#f6f8f2', text: '#232617', muted: '#5f6647', accent: '#b9861a', onAccent: '#0b0b0f', border: '#c8ceb6' } },
    { code: 14, id: 'ghost-dark', label: 'Ghost the Raccoon (dark)', group: 'Team vCGE', mode: 'dark', branded: true,
      vars: { bg: '#11101e', surface: '#1f1e33', text: '#ececf4', muted: '#aeadc2', accent: '#2ec4b6', onAccent: '#0b0b0f', border: '#3f3e5b' } },
    { code: 15, id: 'ghost-light', label: 'Ghost the Raccoon (light)', group: 'Team vCGE', mode: 'light', branded: true,
      vars: { bg: '#d8d7e9', surface: '#f3f3f7', text: '#191924', muted: '#484766', accent: '#249b90', onAccent: '#0b0b0f', border: '#b9b9cb' } },
    { code: 16, id: 'iris-dark', label: 'Iris the Lynx (dark)', group: 'Team vCGE', mode: 'dark', branded: true,
      vars: { bg: '#091f25', surface: '#14353e', text: '#ecf2f4', muted: '#adbec2', accent: '#ffb627', onAccent: '#0b0b0f', border: '#305d69' } },
    { code: 17, id: 'iris-light', label: 'Iris the Lynx (light)', group: 'Team vCGE', mode: 'light', branded: true,
      vars: { bg: '#ceebf3', surface: '#f0f8f9', text: '#13252a', muted: '#476066', accent: '#c07f00', onAccent: '#0b0b0f', border: '#b0cdd4' } },
    { code: 18, id: 'glyph-dark', label: 'Glyph the Owl (dark)', group: 'Team vCGE', mode: 'dark', branded: true,
      vars: { bg: '#0f131f', surface: '#1d2335', text: '#eceef4', muted: '#adb2c2', accent: '#f5b841', onAccent: '#0b0b0f', border: '#3c445d' } },
    { code: 19, id: 'glyph-light', label: 'Glyph the Owl (light)', group: 'Team vCGE', mode: 'light', branded: true,
      vars: { bg: '#d6dbeb', surface: '#f2f3f7', text: '#181b25', muted: '#474f66', accent: '#bc800a', onAccent: '#0b0b0f', border: '#b7bdcc' } },
    { code: 20, id: 'pidge-dark', label: 'Pidge the Octopus (dark)', group: 'Team vCGE', mode: 'dark', branded: true,
      vars: { bg: '#0e201f', surface: '#1b3735', text: '#ecf4f3', muted: '#adc2c1', accent: '#c9a227', onAccent: '#0b0b0f', border: '#39605d' } },
    { code: 21, id: 'pidge-light', label: 'Pidge the Octopus (light)', group: 'Team vCGE', mode: 'light', branded: true,
      vars: { bg: '#d4edeb', surface: '#f2f8f7', text: '#172625', muted: '#476664', accent: '#ab8a21', onAccent: '#0b0b0f', border: '#b6cecc' } },
    { code: 22, id: 'flipside-dark', label: 'Flipside the Chameleon (dark)', group: 'Team vCGE', mode: 'dark', branded: true,
      vars: { bg: '#0c221a', surface: '#183a2d', text: '#ecf4f1', muted: '#adc2ba', accent: '#ff6f59', onAccent: '#0b0b0f', border: '#366353' } },
    { code: 23, id: 'flipside-light', label: 'Flipside the Chameleon (light)', group: 'Team vCGE', mode: 'light', branded: true,
      vars: { bg: '#d2efe4', surface: '#f1f8f6', text: '#152821', muted: '#47665b', accent: '#ff5035', onAccent: '#0b0b0f', border: '#b3d0c6' } },
    { code: 24, id: 'checkers-dark', label: 'Checkers the Zebra (dark)', group: 'Team vCGE', mode: 'dark', branded: true,
      vars: { bg: '#171618', surface: '#29272b', text: '#f0ecf4', muted: '#b8adc2', accent: '#8b5cf6', onAccent: '#0b0b0f', border: '#4c4a4f' } },
    { code: 25, id: 'checkers-light', label: 'Checkers the Zebra (light)', group: 'Team vCGE', mode: 'light', branded: true,
      vars: { bg: '#e0dfe2', surface: '#f5f4f5', text: '#1f1e20', muted: '#574766', accent: '#8b5cf6', onAccent: '#0b0b0f', border: '#c2c0c3' } },
    { code: 26, id: 'airlock-dark', label: 'Airlock the Falcon (dark)', group: 'Team vCGE', mode: 'dark', branded: true,
      vars: { bg: '#151719', surface: '#25292d', text: '#ecf0f4', muted: '#adb8c2', accent: '#ff7a1a', onAccent: '#0b0b0f', border: '#484c51' } },
    { code: 27, id: 'airlock-light', label: 'Airlock the Falcon (light)', group: 'Team vCGE', mode: 'light', branded: true,
      vars: { bg: '#dde0e4', surface: '#f4f5f6', text: '#1d1f21', muted: '#475766', accent: '#eb6300', onAccent: '#0b0b0f', border: '#bfc2c5' } }
]);
export const THEMES = Object.freeze([...BASIC_THEMES, ...COLOUR_THEMES]);
export const THEME_VARS = Object.freeze({ bg: '--vcge-bg', surface: '--vcge-surface', text: '--vcge-text', muted: '--vcge-muted',
    accent: '--vcge-accent', onAccent: '--vcge-on-accent', border: '--vcge-border' });

/** The themes a person can pick: plain leaves out the branded ones. */
export const themesFor = (plain) => THEMES.filter(t => !(plain && t.branded));

/** The theme for a code. An unknown code, or a branded one in plain, falls back to Dark or Light by its mode. */
export function themeFor(code, plain = false) {
    const t = THEMES.find(x => x.code === code);
    if (t && !(plain && t.branded)) return t;
    return t && t.mode === 'light' ? BASIC_THEMES[1] : BASIC_THEMES[0];
}

/** Put a theme on <html>: the dark class by its mode, and its colours (none for Dark and Light). */
export function applyTheme(root, code, plain = false) {
    const t = themeFor(code, plain);
    root.classList.toggle('dark', t.mode === 'dark');
    for (const [k, name] of Object.entries(THEME_VARS)) {
        if (t.vars) root.style.setProperty(name, t.vars[k]); else root.style.removeProperty(name);
    }
    if (t.vars) root.dataset.appTheme = t.id; else delete root.dataset.appTheme;
    return t;
}
