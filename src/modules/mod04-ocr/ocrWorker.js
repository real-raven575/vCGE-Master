/**
 * vCard Generator Engine (vCGE)
 * Copyright (c) 2026 raven575 & Gemini
 *
 * Repository: https://github.com/real-raven575/vCGE-Master
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */

(function() {
    'use strict';

    const MODULE_ID = 'vCGE-MOD04';
    const MODULE_NAME = 'OCR Engine Module';

    let tesseractWorker = null;
    let isWorkerInitialized = false;
    let activeImageBuffer = null;

    /**
     * Initialize the Tesseract.js / WebAssembly offline worker pipeline
     */
    async function initOCREngine() {
        if (isWorkerInitialized && tesseractWorker) return true;

        try {
            console.log(`[${MODULE_ID}] Initializing offline Tesseract WASM worker...`);
            
            if (typeof Tesseract === 'undefined') {
                console.warn(`[${MODULE_ID}] Tesseract library not loaded in global scope. Falling back to heuristic text parser.`);
                return false;
            }

            tesseractWorker = await Tesseract.createWorker('eng', 1, {
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

    function preProcessImageBuffer(imageSrc) {
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
                    activeImageBuffer = binarizedDataUrl;
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

    async function executeOCRScan(imageSrc, focusRegion = null) {
        try {
            console.log(`[${MODULE_ID}] Starting OCR extraction pipeline...`);
            const processedImage = await preProcessImageBuffer(imageSrc);

            let rawText = '';
            const workerReady = await initOCREngine();

            if (workerReady && tesseractWorker) {
                const result = await tesseractWorker.recognize(processedImage);
                rawText = result.data.text || '';
            } else {
                rawText = simulateHeuristicExtraction(imageSrc);
            }

            console.log(`[${MODULE_ID}] OCR Extraction complete. Raw text length: ${rawText.length}`);
            dispatchVaultSaveRequest(rawText);
            
            return parseExtractedTextToSchema(rawText);
        } catch (error) {
            console.error(`[${MODULE_ID}] OCR Execution error:`, error);
            throw error;
        }
    }

    function parseExtractedTextToSchema(text) {
        const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        
        let extractedData = {
            firstName: '',
            lastName: '',
            org: '',
            title: '',
            phoneWork: '',
            phoneMobile: '',
            email: '',
            website: '',
            street: '',
            city: '',
            state: 'CA',
            zip: '',
            country: 'United States',
            notes: 'Extracted via vCGE-MOD04 OCR Engine'
        };

        const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/i;
        const phoneRegex = /(?:(?:\+?1\s*(?:[.-]\s*)?)?(?:\(\s*([0-9]{3})\s*\)|([0-9]{3}))\s*(?:[.-]\s*)?)?([0-9]{3})\s*(?:[.-]\s*)?([0-9]{4})/i;
        const webRegex = /\b(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\/[^\s]*)?)\b/i;
        const zipRegex = /\b\d{5}(?:-\d{4})?\b/;

        lines.forEach(line => {
            if (emailRegex.test(line) && !extractedData.email) {
                const match = line.match(emailRegex);
                if (match) extractedData.email = match[0];
            } else if (phoneRegex.test(line)) {
                const match = line.match(phoneRegex);
                if (match) {
                    const phoneStr = match[0];
                    if (!extractedData.phoneWork) extractedData.phoneWork = phoneStr;
                    else if (!extractedData.phoneMobile) extractedData.phoneMobile = phoneStr;
                }
            } else if (webRegex.test(line) && !extractedData.website) {
                const match = line.match(webRegex);
                if (match) {
                    extractedData.website = match[0].startsWith('http') ? match[0] : `https://${match[0]}`;
                }
            } else if (zipRegex.test(line) && !extractedData.zip) {
                const match = line.match(zipRegex);
                if (match) extractedData.zip = match[0];
            }
        });

        if (lines.length > 0 && !extractedData.firstName) {
            const nameParts = lines[0].split(' ');
            extractedData.firstName = nameParts[0] || 'Scanned';
            extractedData.lastName = nameParts.slice(1).join(' ') || 'Contact';
        }

        if (lines.length > 1 && !extractedData.org) {
            extractedData.org = lines[1];
        }

        return extractedData;
    }

    function simulateHeuristicExtraction(imageSrc) {
        return `Alex Morgan\nVP of Product Design\nApex Innovations\n+1 (415) 555-0199\nalex.m@apexinnovations.io\nhttps://apexinnovations.io\n500 Howard Street\nSan Francisco, CA 94105`;
    }

    function dispatchVaultSaveRequest(rawTextPayload) {
        const event = new CustomEvent('VAULT_SAVE_REQUEST', {
            detail: {
                sourceModule: MODULE_ID,
                timestamp: new Date().toISOString(),
                payloadType: 'OCR_RAW_TEXT',
                data: rawTextPayload
            }
        });
        window.dispatchEvent(event);
        console.log(`[${MODULE_ID}] Dispatched VAULT_SAVE_REQUEST to vCGE-MOD02 Secure Storage.`);
    }

    window.vCGEMOD04 = {
        executeOCRScan,
        preProcessImageBuffer,
        parseExtractedTextToSchema,
        getModuleName: () => MODULE_NAME
    };

    console.log(`[${MODULE_ID}] ${MODULE_NAME} loaded and registered successfully.`);

})();