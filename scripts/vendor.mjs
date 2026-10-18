// Copies the pinned third-party runtime files from node_modules into src/vendor/ (`npm run vendor`).
// src/vendor/ is committed so the app runs fully offline with no install step and no CDN.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NM = path.join(ROOT, 'node_modules');
const OUT = path.join(ROOT, 'src', 'vendor');

const FILES = [
    ['qrcode-generator/qrcode.js', 'qrcode-generator/qrcode.js'],
    ['tesseract.js/dist/tesseract.min.js', 'tesseract/tesseract.min.js'],
    ['tesseract.js/dist/worker.min.js', 'tesseract/worker.min.js'],
    ['tesseract.js/LICENSE.md', 'tesseract/LICENSE.md'],
    // LSTM-only cores (OEM 1); the worker picks the SIMD build when the CPU supports it.
    ['tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract/core/tesseract-core-simd-lstm.wasm.js'],
    ['tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract/core/tesseract-core-lstm.wasm.js'],
    ['tesseract.js-core/LICENSE', 'tesseract/core/LICENSE'],
    // "best_int" English model: integer-quantised, ~3 MB, the Tesseract.js default.
    ['@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'tesseract/lang/eng.traineddata.gz'],
    // Card typography (SIL OFL 1.1), Latin subset, weights 400/600/700; declared in mod06-gui/cardStyles.css.
    ['@fontsource/inter/files/inter-latin-400-normal.woff2', 'fonts/inter-latin-400.woff2'],
    ['@fontsource/inter/files/inter-latin-600-normal.woff2', 'fonts/inter-latin-600.woff2'],
    ['@fontsource/inter/files/inter-latin-700-normal.woff2', 'fonts/inter-latin-700.woff2'],
    ['@fontsource/inter/LICENSE', 'fonts/LICENSE-inter.txt'],
    ['@fontsource/playfair-display/files/playfair-display-latin-400-normal.woff2', 'fonts/playfair-display-latin-400.woff2'],
    ['@fontsource/playfair-display/files/playfair-display-latin-600-normal.woff2', 'fonts/playfair-display-latin-600.woff2'],
    ['@fontsource/playfair-display/files/playfair-display-latin-700-normal.woff2', 'fonts/playfair-display-latin-700.woff2'],
    ['@fontsource/playfair-display/LICENSE', 'fonts/LICENSE-playfair-display.txt'],
    ['@fontsource/fira-code/files/fira-code-latin-400-normal.woff2', 'fonts/fira-code-latin-400.woff2'],
    ['@fontsource/fira-code/files/fira-code-latin-600-normal.woff2', 'fonts/fira-code-latin-600.woff2'],
    ['@fontsource/fira-code/files/fira-code-latin-700-normal.woff2', 'fonts/fira-code-latin-700.woff2'],
    ['@fontsource/fira-code/LICENSE', 'fonts/LICENSE-fira-code.txt'],
    // MOD-XX tags (SIL OFL 1.1): Sixtyfour, Latin subset, variable "Bleed" axis (set to 100 for a bold look); mod01-shell/ui.css.
    ['@fontsource-variable/sixtyfour/files/sixtyfour-latin-bled-normal.woff2', 'fonts/sixtyfour-latin-bled.woff2'],
    ['@fontsource-variable/sixtyfour/LICENSE', 'fonts/LICENSE-sixtyfour.txt'],
    // UI font choices for Settings (SIL OFL 1.1), Latin subset, weights 400/700; declared in mod01-shell/ui.css.
    ['@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-400-normal.woff2', 'fonts/atkinson-hyperlegible-latin-400.woff2'],
    ['@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-700-normal.woff2', 'fonts/atkinson-hyperlegible-latin-700.woff2'],
    ['@fontsource/atkinson-hyperlegible/LICENSE', 'fonts/LICENSE-atkinson-hyperlegible.txt'],
    ['@fontsource/lexend/files/lexend-latin-400-normal.woff2', 'fonts/lexend-latin-400.woff2'],
    ['@fontsource/lexend/files/lexend-latin-700-normal.woff2', 'fonts/lexend-latin-700.woff2'],
    ['@fontsource/lexend/LICENSE', 'fonts/LICENSE-lexend.txt'],
    ['@fontsource/opendyslexic/files/opendyslexic-latin-400-normal.woff2', 'fonts/opendyslexic-latin-400.woff2'],
    ['@fontsource/opendyslexic/files/opendyslexic-latin-700-normal.woff2', 'fonts/opendyslexic-latin-700.woff2'],
    ['@fontsource/opendyslexic/LICENSE', 'fonts/LICENSE-opendyslexic.txt'],
    ['@fontsource/tinos/files/tinos-latin-400-normal.woff2', 'fonts/tinos-latin-400.woff2'],
    ['@fontsource/tinos/files/tinos-latin-700-normal.woff2', 'fonts/tinos-latin-700.woff2'],
    ['@fontsource/tinos/LICENSE', 'fonts/LICENSE-tinos.txt'],
    ['@fontsource/comic-neue/files/comic-neue-latin-400-normal.woff2', 'fonts/comic-neue-latin-400.woff2'],
    ['@fontsource/comic-neue/files/comic-neue-latin-700-normal.woff2', 'fonts/comic-neue-latin-700.woff2'],
    ['@fontsource/comic-neue/LICENSE', 'fonts/LICENSE-comic-neue.txt'],
    ['@fontsource/macondo/files/macondo-latin-400-normal.woff2', 'fonts/macondo-latin-400.woff2'],
    ['@fontsource/macondo/LICENSE', 'fonts/LICENSE-macondo.txt']
];

// App icons for the redesign's header and buttons: Tabler Icons outline set (MIT), copied as SVG files.
const APP_ICONS = ['aperture', 'radar-2', 'lock', 'forms', 'id', 'qrcode', 'send', 'settings', 'trash', 'camera', 'upload', 'circle-check', 'home-shield', 'rotate-2', 'rotate-clockwise-2'];

// Contact-icon templates for the OCR icon detector (mod04-ocr/iconDetector.js): generic shapes from Lucide (ISC),
// brand logos from Simple Icons (CC0). LinkedIn's logo is not in either set; the detector draws its own "in" template.
const ICON_TEMPLATES = {
    phone: ['lucide-static/icons/phone.svg', 'lucide-static/icons/phone-call.svg'],
    mobile: ['lucide-static/icons/smartphone.svg'],
    email: ['lucide-static/icons/mail.svg'],
    web: ['lucide-static/icons/globe.svg', 'lucide-static/icons/link.svg'],
    address: ['lucide-static/icons/map-pin.svg', 'lucide-static/icons/building-2.svg', 'lucide-static/icons/building.svg'],
    home: ['lucide-static/icons/house.svg'],
    fax: ['lucide-static/icons/printer.svg'],
    x: ['simple-icons/icons/x.svg'],
    facebook: ['simple-icons/icons/facebook.svg'],
    instagram: ['simple-icons/icons/instagram.svg'],
    github: ['simple-icons/icons/github.svg'],
    youtube: ['simple-icons/icons/youtube.svg'],
    tiktok: ['simple-icons/icons/tiktok.svg']
};

fs.rmSync(OUT, { recursive: true, force: true });
for (const [from, to] of FILES) {
    const src = path.join(NM, from);
    const dest = path.join(OUT, to);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    console.log(`${(fs.statSync(dest).size / 1024).toFixed(0).padStart(6)} KB  src/vendor/${to}`);
}

// One JSON file of icon SVGs (license comments stripped; the licences are copied next to it).
const templates = {};
for (const [cls, files] of Object.entries(ICON_TEMPLATES)) {
    templates[cls] = files.map(f => fs.readFileSync(path.join(NM, f), 'utf8').replace(/<!--[\s\S]*?-->/g, '').replace(/\s+/g, ' ').trim());
}
const iconsOut = path.join(OUT, 'icons');
fs.mkdirSync(iconsOut, { recursive: true });
fs.writeFileSync(path.join(iconsOut, 'templates.json'), JSON.stringify(templates) + '\n');
fs.copyFileSync(path.join(NM, 'lucide-static/LICENSE'), path.join(iconsOut, 'LICENSE-lucide.txt'));
fs.copyFileSync(path.join(NM, 'simple-icons/LICENSE.md'), path.join(iconsOut, 'LICENSE-simple-icons.md'));
console.log(`${(fs.statSync(path.join(iconsOut, 'templates.json')).size / 1024).toFixed(0).padStart(6)} KB  src/vendor/icons/templates.json`);
const appIconsOut = path.join(iconsOut, 'app');
fs.mkdirSync(appIconsOut, { recursive: true });
const symbols = [];
for (const name of APP_ICONS) {
    const svg = fs.readFileSync(path.join(NM, '@tabler/icons/icons/outline', `${name}.svg`), 'utf8');
    fs.writeFileSync(path.join(appIconsOut, `${name}.svg`), svg);
    // One sprite for the app's <use> references: each icon as a symbol without its own stroke width, so the page's
    // CSS (--vcge-icon-stroke) sets it.
    const inner = /<svg[^>]*>([\s\S]*?)<\/svg>/.exec(svg)[1].replace(/\s+/g, ' ').trim();
    symbols.push(`<symbol id="${name}" viewBox="0 0 24 24">${inner}</symbol>`);
}
fs.writeFileSync(path.join(appIconsOut, 'sprite.svg'), `<svg xmlns="http://www.w3.org/2000/svg" style="display:none">${symbols.join('')}</svg>\n`);
fs.copyFileSync(path.join(NM, '@tabler/icons/LICENSE'), path.join(appIconsOut, 'LICENSE-tabler.txt'));
console.log(`${String(APP_ICONS.length).padStart(6)} SVG src/vendor/icons/app/ (Tabler) + sprite.svg`);

// Logos for the "Insert Fake Contact?" samples (mod06-gui/card3dView.js PRESETS): the roster's animals from Noto Emoji
// (Apache-2.0, via @iconify-json/noto), written out as plain SVG files. Where Noto has no such animal, the nearest one
// stands in (lynx: cat, chameleon: lizard, falcon: eagle). The Apache licence text ships beside them (the npm package
// carries only the SPDX id, so the text is kept in scripts/licenses/).
const ANIMALS = ['turtle', 'raccoon', 'cat', 'owl', 'octopus', 'lizard', 'zebra', 'eagle', 'elephant'];
const noto = JSON.parse(fs.readFileSync(path.join(NM, '@iconify-json/noto/icons.json'), 'utf8'));
const animalsOut = path.join(iconsOut, 'animals');
fs.mkdirSync(animalsOut, { recursive: true });
for (const name of ANIMALS) {
    const icon = noto.icons[name];
    if (!icon) throw new Error(`Noto Emoji has no icon named ${name}`);
    const w = icon.width || noto.width, h = icon.height || noto.height;
    fs.writeFileSync(path.join(animalsOut, `${name}.svg`),
        `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${icon.body}</svg>\n`);
}
fs.copyFileSync(path.join(ROOT, 'scripts/licenses/LICENSE-noto-emoji.txt'), path.join(animalsOut, 'LICENSE-noto-emoji.txt'));
console.log(`${String(ANIMALS.length).padStart(6)} SVG src/vendor/icons/animals/ (Noto Emoji)`);
