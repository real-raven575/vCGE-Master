/**
 * vCard Generator Engine (vCGE)
 * Copyright (c) 2026 raven575, Gemini & Claude
 *
 * Repository: https://github.com/real-raven575/vCGE-Master
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */

import { globalEventBus, Events } from '../../share/eventBus.js';

const MODULE_ID = 'vCGE-MOD04';
const MODULE_NAME = 'OCR Engine Module';

// Bundled, pinned Tesseract.js assets (src/vendor/tesseract, see scripts/vendor.mjs). Nothing is fetched from a CDN.
// Resolved from the page URL (not import.meta.url) so the path survives Vite bundling into dist/assets/.
const vendorUrl = (file) => new URL(`src/vendor/tesseract/${file}`, document.baseURI).href;

let tesseractWorker = null;

// How long the engine may take to start (core + English model, ~7 MB from local files) before we give up.
export const OCR_INIT_TIMEOUT_MS = 60000;

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
        workerPath: vendorUrl('worker.min.js'),
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
        tesseractWorker = await Promise.race([created, failed]);
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

export function preProcessImageBuffer(imageSrc) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'Anonymous';
        
        img.onload = function() {
            try {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                
                let width = img.width;
                let height = img.height;
                const maxDim = 1600;

                if (width > maxDim || height > maxDim) {
                    if (width > height) {
                        height = Math.round((height * maxDim) / width);
                        width = maxDim;
                    } else {
                        width = Math.round((width * maxDim) / height);
                        height = maxDim;
                    }
                } else if (width < 800) {
                    const scale = 800 / width;
                    width = 800;
                    height = Math.round(height * scale);
                }

                canvas.width = width;
                canvas.height = height;
                ctx.drawImage(img, 0, 0, width, height);

                const imgData = ctx.getImageData(0, 0, width, height);
                const data = imgData.data;

                let totalLuminance = 0;
                for (let i = 0; i < data.length; i += 4) {
                    const gray = 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
                    data[i] = gray;
                    data[i+1] = gray;
                    data[i+2] = gray;
                    totalLuminance += gray;
                }

                const avgLuminance = totalLuminance / (data.length / 4);

                for (let i = 0; i < data.length; i += 4) {
                    let gray = data[i];
                    gray = ((gray - 128) * 1.5) + 128;
                    gray = Math.max(0, Math.min(255, gray));

                    if (gray > avgLuminance * 0.90) {
                        gray = 255;
                    } else {
                        gray = 0;
                    }

                    data[i] = gray;
                    data[i+1] = gray;
                    data[i+2] = gray;
                }

                ctx.putImageData(imgData, 0, 0);
                const binarizedDataUrl = canvas.toDataURL('image/png');
                resolve(binarizedDataUrl);
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
 * Runs OCR on an image (data URL) and returns { text }; mapping text to contact fields is MOD05's job.
 * Rejects with OcrUnavailableError when the engine cannot start, so no made-up text ever reaches the form.
 */
export async function executeOCRScan(imageSrc, { initTimeoutMs = OCR_INIT_TIMEOUT_MS } = {}) {
    console.log(`[${MODULE_ID}] Starting OCR extraction pipeline...`);
    const processedImage = await preProcessImageBuffer(imageSrc);
    const worker = await initOCREngine(initTimeoutMs);
    const result = await worker.recognize(processedImage);
    const text = result.data.text || '';

    console.log(`[${MODULE_ID}] OCR extraction complete. Raw text length: ${text.length}`);
    globalEventBus.publish(Events.OCR_TEXT_EXTRACTED, { sourceModule: MODULE_ID, text });
    return { text };
}

export const getModuleName = () => MODULE_NAME;
