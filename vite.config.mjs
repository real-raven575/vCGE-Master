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

// MOD01's browser gate loads the app itself, so index.html has no script tag for src/main.js, only
// <meta name="vcge-app" content="src/main.js">. For the build that meta becomes the module tag Vite bundles from, and
// Vite's tag for the bundle becomes the meta again, now naming the bundle: the browser never fetches it before the gate.
const APP_META = '<meta name="vcge-app" content="src/main.js">';
const gateEntry = {
    name: 'vcge-gate-entry',
    apply: 'build',
    transformIndexHtml: {
        order: 'pre',
        handler(html) {
            if (html.split(APP_META).length !== 2) throw new Error('index.html must name the app once: ' + APP_META);
            return html.replace(APP_META, '<script type="module" src="src/main.js"></script>');
        }
    }
};
const gateEntryOut = {
    name: 'vcge-gate-entry-out',
    apply: 'build',
    enforce: 'post',
    transformIndexHtml: {
        order: 'post',
        handler(html) {
            const tags = html.match(/<script type="module"[^>]*><\/script>/g) || [];
            const src = tags.length === 1 && /\ssrc="(\.\/assets\/[\w-]+\.js)"/.exec(tags[0]);
            if (!src || /rel="modulepreload"/.test(html)) throw new Error('expected exactly one bundled module tag and no preloads, got: ' + tags.join(' '));
            return html.replace(tags[0], `<meta name="vcge-app" content="${src[1]}">`);
        }
    }
};

export default defineConfig({
    base: './',
    clearScreen: false,
    plugins: [gateEntry, gateEntryOut, copyVendor],
    server: { port: 1420, strictPort: true },
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        target: 'es2021',
        // Never inline fonts (the CSP allows font-src 'self' only) or the icon sprite (a <use> needs a real URL) as data: URLs
        assetsInlineLimit: (file) => (/\.(woff2|svg)$/.test(file) ? false : undefined)
    }
});
