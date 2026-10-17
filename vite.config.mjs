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
        // MOD01's classic scripts (network lock, OCR worker lock, browser gate) and the bundled "cannot run in this
        // browser" page are loaded by URL too (index.html, the OCR worker, the gate), not imported.
        fs.mkdirSync(path.resolve('dist/src/modules/mod01-shell'), { recursive: true });
        ['netLock.js', 'workerGuard.js', 'browserGate.js'].forEach(file => fs.copyFileSync(
            path.resolve('src/modules/mod01-shell', file), path.resolve('dist/src/modules/mod01-shell', file)));
        fs.cpSync(path.resolve('src/modules/mod01-shell/unsupported'), path.resolve('dist/src/modules/mod01-shell/unsupported'), { recursive: true });
        // The logo (src/assets/brand): the Welcome card and the Thank You page draw it by URL at runtime, so it keeps its path.
        fs.cpSync(path.resolve('src/assets'), path.resolve('dist/src/assets'), { recursive: true });
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
        target: 'es2021',
        // Never inline fonts (the CSP allows font-src 'self' only) or the icon sprite (a <use> needs a real URL) as data: URLs
        assetsInlineLimit: (file) => (/\.(woff2|svg)$/.test(file) ? false : undefined)
    }
});
