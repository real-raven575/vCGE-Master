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
    ['@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'tesseract/lang/eng.traineddata.gz']
];

fs.rmSync(OUT, { recursive: true, force: true });
for (const [from, to] of FILES) {
    const src = path.join(NM, from);
    const dest = path.join(OUT, to);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    console.log(`${(fs.statSync(dest).size / 1024).toFixed(0).padStart(6)} KB  src/vendor/${to}`);
}
