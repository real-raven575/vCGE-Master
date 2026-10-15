// Vite build for vCGE: bundles index.html + src/main.js (ES modules, CSS, fonts) into dist/ for Tauri.
// src/vendor/ and MOD01's two classic lock scripts are copied verbatim: the classic vendor scripts, the Tesseract
// worker/core/model and the lock scripts are loaded at runtime by URL, not imported, so Vite must not rename or bundle them.
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
        // MOD01's classic network-lock scripts are loaded by URL too (index.html and the OCR worker), not imported.
        fs.mkdirSync(path.resolve('dist/src/modules/mod01-shell'), { recursive: true });
        ['netLock.js', 'workerGuard.js'].forEach(file => fs.copyFileSync(
            path.resolve('src/modules/mod01-shell', file), path.resolve('dist/src/modules/mod01-shell', file)));
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
