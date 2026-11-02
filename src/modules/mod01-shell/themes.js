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
    { code: 0, id: 'dark', label: 'Dark', group: 'Basic', mode: 'dark',
      vars: { bg: '#18151f', surface: '#231f2e', text: '#eeeaf7', muted: '#b4acc9', accent: '#72d3ca', onAccent: '#0e2b29', border: '#3a3449',
        sunk: '#141119', soft: '#1d3b3a', softInk: '#9fe6de', good: '#7fd39e', warn: '#f2c060', stop: '#ff8a80' } },
    { code: 1, id: 'light', label: 'Light', group: 'Basic', mode: 'light',
      vars: { bg: '#f5f2fa', surface: '#ffffff', text: '#2a2440', muted: '#5e5776', accent: '#17736e', onAccent: '#ffffff', border: '#dcd5ea',
        sunk: '#ece7f5', soft: '#d5efec', softInk: '#0f4f4b', good: '#2e7d4f', warn: '#8a5800', stop: '#b3261e' } }
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
/** Creative's 0.8 themes (CRTV-0020, 2026-11-01): four more everyday palettes and seven seasonal ones, each a light and a
 *  dark. Herd, the fifth everyday palette, is Dark and Light above. Both editions list them (no characters in them). */
export const CREATIVE_THEMES = Object.freeze([
    { code: 28, id: 'signal-light', label: 'Signal (light)', group: 'Everyday', mode: 'light',
      vars: { bg: '#f4f5fb', surface: '#ffffff', text: '#141a3a', muted: '#4d5577', accent: '#b4177a', onAccent: '#ffffff', border: '#d6daec',
        sunk: '#e8eaf5', soft: '#fbe3f1', softInk: '#7a0f52', good: '#2e7d4f', warn: '#8a5800', stop: '#b3261e' } },
    { code: 29, id: 'signal-dark', label: 'Signal (dark)', group: 'Everyday', mode: 'dark',
      vars: { bg: '#0d1129', surface: '#171c3c', text: '#eef0ff', muted: '#a9b0d6', accent: '#ff7ac8', onAccent: '#3a0626', border: '#2c335e',
        sunk: '#0a0d20', soft: '#3a1638', softInk: '#ffb3df', good: '#7fd39e', warn: '#f2c060', stop: '#ff8a80' } },
    { code: 30, id: 'autumn-light', label: 'Autumn (light)', group: 'Everyday', mode: 'light',
      vars: { bg: '#f7f1ea', surface: '#fffdfa', text: '#2e2119', muted: '#6b5546', accent: '#a3431a', onAccent: '#ffffff', border: '#e2d5c6',
        sunk: '#eee5da', soft: '#f6dfd0', softInk: '#7a2f10', good: '#2e7d4f', warn: '#8a5800', stop: '#b3261e' } },
    { code: 31, id: 'autumn-dark', label: 'Autumn (dark)', group: 'Everyday', mode: 'dark',
      vars: { bg: '#1a1410', surface: '#251d17', text: '#f5ebe1', muted: '#c7b3a3', accent: '#f2a06b', onAccent: '#3a1a08', border: '#3e3128',
        sunk: '#130e0b', soft: '#4a2a18', softInk: '#ffc9a3', good: '#7fd39e', warn: '#f2c060', stop: '#ff8a80' } },
    { code: 32, id: 'evergreen-light', label: 'Evergreen (light)', group: 'Everyday', mode: 'light',
      vars: { bg: '#f1f6f3', surface: '#ffffff', text: '#14261c', muted: '#4a5e52', accent: '#15803d', onAccent: '#ffffff', border: '#d2e0d7',
        sunk: '#e2ece6', soft: '#dcf3e4', softInk: '#0e5a2a', good: '#2e7d4f', warn: '#8a5800', stop: '#b3261e' } },
    { code: 33, id: 'evergreen-dark', label: 'Evergreen (dark)', group: 'Everyday', mode: 'dark',
      vars: { bg: '#0b1220', surface: '#131c30', text: '#e8eef8', muted: '#a3b0c6', accent: '#4ade80', onAccent: '#06240f', border: '#26324d',
        sunk: '#080d18', soft: '#143224', softInk: '#8ef0b4', good: '#7fd39e', warn: '#f2c060', stop: '#ff8a80' } },
    { code: 34, id: 'graphite-light', label: 'Graphite (light)', group: 'Everyday', mode: 'light',
      vars: { bg: '#f4f4f5', surface: '#ffffff', text: '#18181b', muted: '#52525b', accent: '#2b4acb', onAccent: '#ffffff', border: '#dadadf',
        sunk: '#e8e8ea', soft: '#e2e7fa', softInk: '#1d338f', good: '#2e7d4f', warn: '#8a5800', stop: '#b3261e' } },
    { code: 35, id: 'graphite-dark', label: 'Graphite (dark)', group: 'Everyday', mode: 'dark',
      vars: { bg: '#111113', surface: '#1b1b1e', text: '#f2f2f3', muted: '#a8a8b0', accent: '#9db2ff', onAccent: '#0e1840', border: '#2f2f35',
        sunk: '#0b0b0c', soft: '#1e2547', softInk: '#c3d0ff', good: '#7fd39e', warn: '#f2c060', stop: '#ff8a80' } },
    { code: 36, id: 'snowfall-light', label: 'Snowfall (light)', group: 'Seasonal', mode: 'light', season: 'Jan',
      vars: { bg: '#f2f6fa', surface: '#ffffff', text: '#15233a', muted: '#4a5a72', accent: '#1f5fa8', onAccent: '#ffffff', border: '#d2ddea',
        sunk: '#e3ebf3', soft: '#ddeaf8', softInk: '#143f72', good: '#2e7d4f', warn: '#8a5800', stop: '#b3261e' } },
    { code: 37, id: 'snowfall-dark', label: 'Snowfall (dark)', group: 'Seasonal', mode: 'dark', season: 'Jan',
      vars: { bg: '#0e1622', surface: '#162132', text: '#eaf1fa', muted: '#a6b6cb', accent: '#8cc4ff', onAccent: '#0b2440', border: '#28374d',
        sunk: '#0a1019', soft: '#1a3048', softInk: '#bfddff', good: '#7fd39e', warn: '#f2c060', stop: '#ff8a80' } },
    { code: 38, id: 'lantern-light', label: 'Lantern (light)', group: 'Seasonal', mode: 'light', season: 'Lunar New Year',
      vars: { bg: '#fbf4ef', surface: '#ffffff', text: '#2e1612', muted: '#6b4a42', accent: '#b3161e', onAccent: '#ffffff', border: '#ebd6cb',
        sunk: '#f3e6dc', soft: '#fbebc8', softInk: '#6e4a00', good: '#2e7d4f', warn: '#8a5800', stop: '#b3261e' } },
    { code: 39, id: 'lantern-dark', label: 'Lantern (dark)', group: 'Seasonal', mode: 'dark', season: 'Lunar New Year',
      vars: { bg: '#1c0f0e', surface: '#2a1715', text: '#faede8', muted: '#d0afa6', accent: '#ffc24a', onAccent: '#3a2400', border: '#462824',
        sunk: '#140a09', soft: '#4a1c1a', softInk: '#ffb1a8', good: '#7fd39e', warn: '#f2c060', stop: '#ff8a80' } },
    { code: 40, id: 'heartfelt-light', label: 'Heartfelt (light)', group: 'Seasonal', mode: 'light', season: 'Feb',
      vars: { bg: '#fbf3f5', surface: '#ffffff', text: '#33161f', muted: '#6e4a55', accent: '#b0234f', onAccent: '#ffffff', border: '#ebd3da',
        sunk: '#f4e4e9', soft: '#fadce5', softInk: '#7e1337', good: '#2e7d4f', warn: '#8a5800', stop: '#b3261e' } },
    { code: 41, id: 'heartfelt-dark', label: 'Heartfelt (dark)', group: 'Seasonal', mode: 'dark', season: 'Feb',
      vars: { bg: '#1e1116', surface: '#2a1820', text: '#f8eaee', muted: '#cdaab4', accent: '#ff8fb1', onAccent: '#3d0919', border: '#442833',
        sunk: '#160c10', soft: '#4a1c2b', softInk: '#ffc4d5', good: '#7fd39e', warn: '#f2c060', stop: '#ff8a80' } },
    { code: 42, id: 'bloom-light', label: 'Bloom (light)', group: 'Seasonal', mode: 'light', season: 'Spring',
      vars: { bg: '#f6f4fa', surface: '#ffffff', text: '#2a2440', muted: '#5c5674', accent: '#6a3fb0', onAccent: '#ffffff', border: '#ded8ea',
        sunk: '#ece8f4', soft: '#e3f4ea', softInk: '#1f5e3a', good: '#2e7d4f', warn: '#8a5800', stop: '#b3261e' } },
    { code: 43, id: 'bloom-dark', label: 'Bloom (dark)', group: 'Seasonal', mode: 'dark', season: 'Spring',
      vars: { bg: '#17141f', surface: '#221e2d', text: '#f0ecf8', muted: '#b8b0cc', accent: '#c4a8ff', onAccent: '#26114a', border: '#3a3449',
        sunk: '#110f17', soft: '#1e3a2b', softInk: '#a8e6c1', good: '#7fd39e', warn: '#f2c060', stop: '#ff8a80' } },
    { code: 44, id: 'tidepool-light', label: 'Tidepool (light)', group: 'Seasonal', mode: 'light', season: 'Summer',
      vars: { bg: '#f1f7f8', surface: '#ffffff', text: '#0f2a30', muted: '#44626a', accent: '#c2410c', onAccent: '#ffffff', border: '#cfe1e4',
        sunk: '#e0edef', soft: '#d7eef1', softInk: '#0e5561', good: '#2e7d4f', warn: '#8a5800', stop: '#b3261e' } },
    { code: 45, id: 'tidepool-dark', label: 'Tidepool (dark)', group: 'Seasonal', mode: 'dark', season: 'Summer',
      vars: { bg: '#0b1a1e', surface: '#122529', text: '#e6f3f5', muted: '#9fbec4', accent: '#ff9a6b', onAccent: '#3a1405', border: '#23404a',
        sunk: '#071215', soft: '#16363d', softInk: '#9fe0ea', good: '#7fd39e', warn: '#f2c060', stop: '#ff8a80' } },
    { code: 46, id: 'pumpkin-light', label: 'Pumpkin (light)', group: 'Seasonal', mode: 'light', season: 'Oct',
      vars: { bg: '#f7f3ee', surface: '#ffffff', text: '#241a2e', muted: '#5d5068', accent: '#b8470c', onAccent: '#ffffff', border: '#e2d7ca',
        sunk: '#eee6dc', soft: '#ede3f7', softInk: '#4f2a7a', good: '#2e7d4f', warn: '#8a5800', stop: '#b3261e' } },
    { code: 47, id: 'pumpkin-dark', label: 'Pumpkin (dark)', group: 'Seasonal', mode: 'dark', season: 'Oct',
      vars: { bg: '#16111d', surface: '#211a2b', text: '#f4eef8', muted: '#bbadc8', accent: '#ff9b4a', onAccent: '#3a1600', border: '#3a2f47',
        sunk: '#0f0b14', soft: '#2f2142', softInk: '#d4b8ff', good: '#7fd39e', warn: '#f2c060', stop: '#ff8a80' } },
    { code: 48, id: 'holly-light', label: 'Holly (light)', group: 'Seasonal', mode: 'light', season: 'Dec',
      vars: { bg: '#f3f6f2', surface: '#ffffff', text: '#17261b', muted: '#4a5c4e', accent: '#a3172e', onAccent: '#ffffff', border: '#d3ded2',
        sunk: '#e4ece3', soft: '#f7dde1', softInk: '#7a0f22', good: '#2e7d4f', warn: '#8a5800', stop: '#b3261e' } },
    { code: 49, id: 'holly-dark', label: 'Holly (dark)', group: 'Seasonal', mode: 'dark', season: 'Dec',
      vars: { bg: '#0f1a14', surface: '#17261d', text: '#eef4ef', muted: '#a9bdae', accent: '#ff8a9a', onAccent: '#3a0710', border: '#2a3d31',
        sunk: '#0a120d', soft: '#3e1a20', softInk: '#ffc2cb', good: '#7fd39e', warn: '#f2c060', stop: '#ff8a80' } }
]);
export const THEMES = Object.freeze([...BASIC_THEMES, ...COLOUR_THEMES, ...CREATIVE_THEMES]);
/** The order the groups show in Settings: Creative's palettes first, then the card palettes and the characters. */
export const THEME_GROUPS = Object.freeze(['Basic', 'Everyday', 'Seasonal', 'Autumn', 'Team vCGE']);
export const THEME_VARS = Object.freeze({ bg: '--vcge-bg', surface: '--vcge-surface', text: '--vcge-text', muted: '--vcge-muted',
    accent: '--vcge-accent', onAccent: '--vcge-on-accent', border: '--vcge-border' });
/** The extra colours Creative's palettes carry (deeper fill, soft tint and its ink, good/warn/stop); a theme without them
 *  falls back to colours mixed from its seven in deck.css. */
export const EXTRA_VARS = Object.freeze({ sunk: '--vcge-sunk', soft: '--vcge-soft', softInk: '--vcge-soft-ink', good: '--vcge-good', warn: '--vcge-warn', stop: '--vcge-stop' });

/** The themes a person can pick: plain leaves out the branded ones. */
export const themesFor = (plain) => THEMES.filter(t => !(plain && t.branded));

/** The theme for a code. An unknown code, or a branded one in plain, falls back to Dark or Light by its mode. */
export function themeFor(code, plain = false) {
    const t = THEMES.find(x => x.code === code);
    if (t && !(plain && t.branded)) return t;
    return t && t.mode === 'light' ? BASIC_THEMES[1] : BASIC_THEMES[0];
}

/** Put a theme on <html>: the dark class by its mode, and its colours (Dark and Light carry Creative's Herd colours since 0.8). */
export function applyTheme(root, code, plain = false) {
    const t = themeFor(code, plain);
    root.classList.toggle('dark', t.mode === 'dark');
    for (const [k, name] of Object.entries({ ...THEME_VARS, ...EXTRA_VARS })) {
        if (t.vars && t.vars[k]) root.style.setProperty(name, t.vars[k]); else root.style.removeProperty(name);
    }
    if (t.vars) root.dataset.appTheme = t.id; else delete root.dataset.appTheme;
    return t;
}

/**
 * Theme + Appearance (0.8, Creative's CRTV-0020 Settings sheet): the picker shows each palette once, as a swatch, and
 * Appearance (System / Light / Dark) picks its light or its dark version. The fixed codes above do not change: a family
 * is only the pair of codes it already had (Herd is Light 1 and Dark 0). The card palettes in Autumn have one version
 * each, so a family there carries a light or a dark code, not both.
 */
const shortLabel = (t) => t.label.replace(/ \((light|dark)\)$/, '').replace(/ the .*$/, '');
const familyKey = (t) => (t.group === 'Basic' ? 'herd' : t.group === 'Autumn' ? `card-${t.id}` : t.id.replace(/-(light|dark)$/, ''));
export const THEME_FAMILIES = Object.freeze((() => {
    const out = [], byKey = new Map();
    for (const t of THEMES) {
        const key = familyKey(t);
        let f = byKey.get(key);
        if (!f) {
            f = { id: key, label: t.group === 'Basic' ? 'Herd' : shortLabel(t), group: t.group === 'Basic' ? 'Everyday' : t.group,
                season: t.season || '', branded: !!t.branded, light: null, dark: null };
            byKey.set(key, f); out.push(f);
        }
        f[t.mode] = t.code;
    }
    // Herd leads the Everyday row (the mock-up's order); the rest keep the order their codes were added
    const order = (f) => (f.id === 'herd' ? -1 : THEME_GROUPS.indexOf(f.group));
    return out.map((f, i) => [f, i]).sort((a, b) => order(a[0]) - order(b[0]) || a[1] - b[1]).map(([f]) => Object.freeze(f));
})());

/** The family a theme code belongs to (Herd for an unknown code). */
export function familyOf(code) {
    return THEME_FAMILIES.find(f => f.light === code || f.dark === code) || THEME_FAMILIES[0];
}

/** The code to show for a family in a mode ('light' or 'dark'): its own version, or its only one. */
export function familyCode(family, mode) {
    return family[mode] !== null ? family[mode] : (family.light !== null ? family.light : family.dark);
}
