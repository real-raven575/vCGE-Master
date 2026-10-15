/**
 * vCard Generator Engine (vCGE)
 * Copyright (c) 2026 raven575, Gemini & Claude
 *
 * Repository: https://github.com/real-raven575/vCGE-Master
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */

import { globalEventBus, Events } from '../../share/eventBus.js';
import { loadIconTemplates, grayFromDataUrl, detectLineIcons } from './iconDetector.js';

const MODULE_ID = 'vCGE-MOD04';
const MODULE_NAME = 'OCR Engine Module';

// Bundled, pinned Tesseract.js assets (src/vendor/tesseract, see scripts/vendor.mjs). Nothing is fetched from a CDN.
// Resolved from the page URL (not import.meta.url) so the path survives Vite bundling into dist/assets/.
const vendorUrl = (file) => new URL(`src/vendor/tesseract/${file}`, document.baseURI).href;
// The Tesseract worker runs behind MOD01's worker network lock, which loads the real worker named after the '#'.
const guardedWorkerUrl = () => `${new URL('src/modules/mod01-shell/workerGuard.js', document.baseURI).href}#${encodeURIComponent(vendorUrl('worker.min.js'))}`;

let tesseractWorker = null;

// How long the engine may take to start (core + English model, ~7 MB from local files) before we give up.
export const OCR_INIT_TIMEOUT_MS = 60000;

// Page segmentation mode: 11 = sparse text (short lines scattered over the card), see setParameters below.
export const OCR_PAGE_SEG_MODE = '11';

// A photo is too blurry or unclear to use when the engine's mean confidence is below this (sharp cards score in
// the high 60s or more; 1 px of blur already drops a test card to 46 and turns its text to garbage), or when fewer
// than OCR_MIN_READABLE_WORDS words are read with confidence of at least 60.
export const OCR_MIN_CONFIDENCE = 55;
// Kept low on purpose: a sharp minimal card (name, phone, email) has only 3-4 words; blur shows in the confidence.
export const OCR_MIN_READABLE_WORDS = 3;

/** Thrown when the photo is too blurry or unclear to read; the caller should ask for a new photo. */
export class OcrUnreadableError extends Error {
    constructor(confidence, readableWords) {
        super(`Image too blurry or unclear to read (confidence ${confidence}, ${readableWords} readable words)`);
        this.name = 'OcrUnreadableError';
        this.code = 'OCR_UNREADABLE';
        this.confidence = confidence;
        this.readableWords = readableWords;
    }
}

/** Thrown when the OCR engine cannot start; the caller should tell the user and leave the form untouched. */
export class OcrUnavailableError extends Error {
    constructor(reason) {
        super(`OCR engine could not start: ${reason}`);
        this.name = 'OcrUnavailableError';
        this.code = 'OCR_UNAVAILABLE';
    }
}

/**
 * Starts the bundled Tesseract.js worker once and reuses it. Rejects with OcrUnavailableError when the library is
 * missing, a start-up step fails (e.g. the language model cannot be fetched) or start-up exceeds the time limit.
 * Tesseract.js 5 swallows failures of its language/initialize steps inside createWorker, whose promise then never
 * settles, so errors are caught through `errorHandler` and raced against the returned promise.
 */
async function initOCREngine(timeoutMs) {
    if (tesseractWorker) return tesseractWorker;
    if (typeof Tesseract === 'undefined') throw new OcrUnavailableError('Tesseract.js is not loaded');

    console.log(`[${MODULE_ID}] Initializing offline Tesseract WASM worker...`);
    let fail;
    const failed = new Promise((_, reject) => { fail = reject; });
    const timer = setTimeout(() => fail(new OcrUnavailableError(`start-up took longer than ${Math.round(timeoutMs / 1000)} s`)), timeoutMs);
    const created = Promise.resolve().then(() => Tesseract.createWorker('eng', 1, {
        workerPath: guardedWorkerUrl(),
        corePath: vendorUrl('core/'),
        langPath: vendorUrl('lang/'),
        gzip: true,
        cacheMethod: 'none',      // keep language data out of IndexedDB
        workerBlobURL: false,     // same-origin worker script, so the page CSP needs no 'wasm-unsafe-eval'
        errorHandler: (err) => fail(new OcrUnavailableError(String(err))),
        logger: m => {
            if (m && m.status) {
                console.log(`[${MODULE_ID}] OCR Progress: ${m.status} (${Math.round((m.progress || 0) * 100)}%)`);
            }
        }
    }));

    try {
        const worker = await Promise.race([created, failed]);
        await worker.setParameters({ tessedit_pageseg_mode: OCR_PAGE_SEG_MODE });
        tesseractWorker = worker;
        console.log(`[${MODULE_ID}] OCR Worker successfully initialized and locked for offline execution.`);
        return tesseractWorker;
    } catch (error) {
        // A worker that still finishes starting after a failure is not kept.
        created.then(w => w.terminate(), () => {});
        console.error(`[${MODULE_ID}] Failed to initialize OCR worker:`, error);
        throw error instanceof OcrUnavailableError ? error : new OcrUnavailableError(error && error.message || String(error));
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Prepares a photo for OCR: greyscale, resized so the longer side is about 1800 px (small photos are enlarged up to 3x,
 * large ones reduced to 2400 px), and contrast stretched between the 1st and 99th brightness percentiles.
 * There is deliberately no hard black/white threshold: Tesseract binarises adaptively, which copes with the shadows,
 * glare and coloured areas of phone photos far better than one global cut-off.
 */
export function preProcessImageBuffer(imageSrc) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'Anonymous';

        img.onload = function() {
            try {
                const longest = Math.max(img.width, img.height) || 1;
                const scale = longest < 1200 ? Math.min(3, 1800 / longest) : (longest > 2400 ? 2400 / longest : 1);
                const width = Math.max(1, Math.round(img.width * scale));
                const height = Math.max(1, Math.round(img.height * scale));

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(img, 0, 0, width, height);

                const imgData = ctx.getImageData(0, 0, width, height);
                const data = imgData.data;
                const histogram = new Uint32Array(256);
                for (let i = 0; i < data.length; i += 4) {
                    const gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
                    data[i] = data[i + 1] = data[i + 2] = gray;
                    histogram[gray]++;
                }

                // Contrast stretch: map the 1st..99th percentile of brightness onto 0..255.
                const pixels = data.length / 4;
                let low = 0, high = 255, seen = 0;
                for (let v = 0; v < 256; v++) { seen += histogram[v]; if (seen >= pixels * 0.01) { low = v; break; } }
                seen = 0;
                for (let v = 255; v >= 0; v--) { seen += histogram[v]; if (seen >= pixels * 0.01) { high = v; break; } }
                if (high - low > 10) {
                    const k = 255 / (high - low);
                    for (let i = 0; i < data.length; i += 4) {
                        const v = Math.max(0, Math.min(255, Math.round((data[i] - low) * k)));
                        data[i] = data[i + 1] = data[i + 2] = v;
                    }
                }

                ctx.putImageData(imgData, 0, 0);
                resolve(canvas.toDataURL('image/png'));
            } catch (err) {
                reject(err);
            }
        };

        img.onerror = function(err) {
            reject(new Error(`Failed to load image buffer for pre-processing: ${err}`));
        };

        img.src = imageSrc;
    });
}

/**
 * Icons in front of each OCR line (phone handset, envelope, social logo...). Best effort: any failure means no icons,
 * never a failed scan. Returns [{ text, icon }] in card order (lines that were only an icon are dropped).
 */
async function linesWithIcons(processedImage, data) {
    const lines = data.lines || [];
    if (!lines.length) return String(data.text || '').split('\n').map(text => ({ text: text.trim(), icon: null })).filter(l => l.text);
    try {
        const [templates, image] = await Promise.all([loadIconTemplates(), grayFromDataUrl(processedImage)]);
        return detectLineIcons(image.gray, image.width, image.height, lines, templates)
            .filter(l => l.text).map(({ text, icon }) => ({ text, icon }));
    } catch (e) {
        console.warn(`[${MODULE_ID}] Icon detection skipped:`, e);
        return lines.map(l => ({ text: (l.text || '').trim(), icon: null })).filter(l => l.text);
    }
}

/**
 * Runs OCR on an image (data URL) and returns { text, confidence, lines }; `lines` is [{ text, icon }] with the icon
 * found in front of each line (or null). Mapping lines to contact fields is MOD05's job.
 * Rejects with OcrUnavailableError when the engine cannot start, and with OcrUnreadableError when the photo is too
 * blurry or unclear, so neither made-up nor garbage text ever reaches the form.
 */
export async function executeOCRScan(imageSrc, { initTimeoutMs = OCR_INIT_TIMEOUT_MS } = {}) {
    console.log(`[${MODULE_ID}] Starting OCR extraction pipeline...`);
    const processedImage = await preProcessImageBuffer(imageSrc);
    const worker = await initOCREngine(initTimeoutMs);
    const result = await worker.recognize(processedImage);
    const text = result.data.text || '';
    const confidence = Math.round(result.data.confidence || 0);
    const readableWords = (result.data.words || []).filter(w => w.confidence >= 60 && /[A-Za-z0-9]{2,}/.test(w.text)).length;

    console.log(`[${MODULE_ID}] OCR extraction complete. Confidence ${confidence}, ${readableWords} readable words, raw text length ${text.length}`);
    if (confidence < OCR_MIN_CONFIDENCE || readableWords < OCR_MIN_READABLE_WORDS) {
        throw new OcrUnreadableError(confidence, readableWords);
    }
    const lines = await linesWithIcons(processedImage, result.data);
    // A signal only: the text itself is contact data and goes back to the caller, never onto the bus.
    globalEventBus.publish(Events.OCR_TEXT_EXTRACTED, { sourceModule: MODULE_ID, confidence, icons: lines.filter(l => l.icon).length, timestamp: Date.now() });
    return { text, confidence, lines };
}

export const getModuleName = () => MODULE_NAME;
