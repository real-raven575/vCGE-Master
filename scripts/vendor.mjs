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
    ['@fontsource/fira-code/LICENSE', 'fonts/LICENSE-fira-code.txt']
];

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
