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

fs.rmSync(OUT, { recursive: true, force: true });
for (const [from, to] of FILES) {
    const src = path.join(NM, from);
    const dest = path.join(OUT, to);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    console.log(`${(fs.statSync(dest).size / 1024).toFixed(0).padStart(6)} KB  src/vendor/${to}`);
}
