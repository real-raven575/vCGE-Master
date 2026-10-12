/**
 * vCard Generator Engine (vCGE)
 * Copyright (c) 2026 raven575 & Gemini
 *
 * Repository: https://github.com/real-raven575/vCGE-Master
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */

import { globalEventBus, Events } from '../../share/eventBus.js';

const MODULE_ID = 'vCGE-MOD04';
const MODULE_NAME = 'OCR Engine Module';

// Bundled, pinned Tesseract.js assets (src/vendor/tesseract, see scripts/vendor.mjs). Nothing is fetched from a CDN.
const VENDOR = new URL('../../vendor/tesseract/', import.meta.url);

let tesseractWorker = null;
let isWorkerInitialized = false;

/**
 * Initialize the Tesseract.js / WebAssembly offline worker pipeline
 */
async function initOCREngine() {
    if (isWorkerInitialized && tesseractWorker) return true;

    try {
        console.log(`[${MODULE_ID}] Initializing offline Tesseract WASM worker...`);
        
        if (typeof Tesseract === 'undefined') {
            console.warn(`[${MODULE_ID}] Tesseract library not loaded in global scope. Falling back to sample text.`);
            return false;
        }

        tesseractWorker = await Tesseract.createWorker('eng', 1, {
            workerPath: new URL('worker.min.js', VENDOR).href,
            corePath: new URL('core/', VENDOR).href,
            langPath: new URL('lang/', VENDOR).href,
            gzip: true,
            cacheMethod: 'none',      // keep language data out of IndexedDB
            workerBlobURL: false,     // same-origin worker script, so the page CSP needs no 'wasm-unsafe-eval'
            logger: m => {
                if (m && m.status) {
                    console.log(`[${MODULE_ID}] OCR Progress: ${m.status} (${Math.round((m.progress || 0) * 100)}%)`);
                }
            }
        });

        isWorkerInitialized = true;
        console.log(`[${MODULE_ID}] OCR Worker successfully initialized and locked for offline execution.`);
        return true;
    } catch (error) {
        console.error(`[${MODULE_ID}] Failed to initialize OCR worker:`, error);
        return false;
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
 * Runs OCR on an image (data URL). Returns { text, simulated }; mapping text to contact fields is MOD05's job.
 * When Tesseract.js is not loaded, sample text is returned and `simulated` is true so callers can say so.
 */
export async function executeOCRScan(imageSrc) {
    console.log(`[${MODULE_ID}] Starting OCR extraction pipeline...`);
    const processedImage = await preProcessImageBuffer(imageSrc);
    const workerReady = await initOCREngine();

    let text;
    let simulated = false;
    if (workerReady && tesseractWorker) {
        const result = await tesseractWorker.recognize(processedImage);
        text = result.data.text || '';
    } else {
        text = simulateHeuristicExtraction();
        simulated = true;
    }

    console.log(`[${MODULE_ID}] OCR extraction complete (${simulated ? 'simulated' : 'Tesseract'}). Raw text length: ${text.length}`);
    globalEventBus.publish(Events.OCR_TEXT_EXTRACTED, { sourceModule: MODULE_ID, text, simulated });
    return { text, simulated };
}

function simulateHeuristicExtraction() {
    return `Alex Morgan\nVP of Product Design\nApex Innovations\n+1 (415) 555-0199\nalex.m@apexinnovations.io\nhttps://apexinnovations.io\n500 Howard Street\nSan Francisco, CA 94105`;
}

export const getModuleName = () => MODULE_NAME;
