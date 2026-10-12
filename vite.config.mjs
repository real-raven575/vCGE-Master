// Vite build for vCGE: bundles index.html + src/main.js (ES modules, CSS, fonts) into dist/ for Tauri.
// src/vendor/ is copied verbatim: the classic vendor scripts and the Tesseract worker/core/model are
// loaded at runtime by URL, not imported, so Vite must not rename or bundle them.
import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

const copyVendor = {
    name: 'vcge-copy-vendor',
    apply: 'build',
    closeBundle() {
        // Fonts are referenced from CSS, so Vite already emits them (hashed) into dist/assets/.
        fs.cpSync(path.resolve('src/vendor'), path.resolve('dist/src/vendor'), {
            recursive: true,
            filter: (src) => !src.includes(`${path.sep}vendor${path.sep}fonts`)
        });
    }
};

export default defineConfig({
    base: './',
    clearScreen: false,
    plugins: [copyVendor],
    server: { port: 1420, strictPort: true },
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        target: 'es2021'
    }
});
