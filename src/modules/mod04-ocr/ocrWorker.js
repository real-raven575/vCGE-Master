/**
 * vCard Generator Engine (vCGE)
 * Copyright (c) 2026 raven575, Team vCGE (Claude) & Gemini
 *
 * Repository: https://github.com/real-raven575/vCGE-Master
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */

import { globalEventBus, Events } from '../../share/eventBus.js';
import { loadIconTemplates, grayFromDataUrl, detectLineIcons } from './iconDetector.js';
import { refineLines, altsForText } from './glyphChoices.js';

const MODULE_ID = 'vCGE-MOD04';
const MODULE_NAME = 'OCR Engine Module';

// Bundled, pinned Tesseract.js assets (src/vendor/tesseract, see scripts/vendor.mjs). Nothing is fetched from a CDN.
// Resolved from the page URL (not import.meta.url) so the path survives Vite bundling into dist/assets/.
const vendorUrl = (file) => new URL(`src/vendor/tesseract/${file}`, document.baseURI).href;
// The Tesseract worker runs behind MOD01's worker network lock, which loads the real worker named after the '#'.
const guardedWorkerUrl = () => `${new URL('src/modules/mod01-shell/workerGuard.js', document.baseURI).href}#${encodeURIComponent(vendorUrl('worker.min.js'))}`;

let tesseractWorker = null;
// Bumped by every shutdown, so a scan or start-up that was running at the time ends instead of finishing.
let generation = 0;
let cancelRunning = null;

// How long the engine may take to start (core + English model, ~7 MB from local files) before we give up.
export const OCR_INIT_TIMEOUT_MS = 60000;

// How long reading one photo may take before the engine is restarted (a desktop reads a card in about 2 s). A phone
// can stop the engine mid-read when memory runs low; Tesseract.js then never answers, so without a limit the scan hangs.
// 55 s (raven575, 2026-10-17): the shimmer's wash on the Read card is full exactly when this runs out.
export const OCR_READ_TIMEOUT_MS = 55000;

/**
 * How far the read has come (0..1) `elapsedMs` into reading a photo, for the Read card's wash: fast at first, then
 * slower than real time, full exactly when the time limit runs out. Never shown as a number.
 */
export function readProgress(elapsedMs, limitMs = OCR_READ_TIMEOUT_MS) {
    const t = Math.min(1, Math.max(0, elapsedMs / limitMs));
    return 1 - (1 - t) * (1 - t);
}

// Page segmentation mode: 11 = sparse text (short lines scattered over the card), see setParameters below.
export const OCR_PAGE_SEG_MODE = '11';

// A photo is too blurry or unclear to use when the engine's mean confidence is below this (sharp cards score in
// the high 60s or more; 1 px of blur already drops a test card to 46 and turns its text to garbage), or when fewer
// than OCR_MIN_READABLE_WORDS words are read with confidence of at least 60.
export const OCR_MIN_CONFIDENCE = 55;
// Kept low on purpose: a sharp minimal card (name, phone, email) has only 3-4 words; blur shows in the confidence.
export const OCR_MIN_READABLE_WORDS = 3;
// A word read with confidence below this is passed on as unsure, so the review step can ask the user to check it.
export const OCR_UNSURE_WORD_CONFIDENCE = 50;

// Second look (raven575's yes, 2026-10-18): a line with unsure words is read again as one enlarged strip, straight and
// with its lean corrected both ways, and the surest reading is kept when it is clearly surer than the first. On a scan
// whose text leaned backwards, the web line went from "TeamLogic\T.com Kalamazoo" (12) to "...KalamazooM|" (87).
// Straight cards rarely have unsure lines, and a re-read that is not clearly surer changes nothing.
export const SECOND_LOOK_PAGE_SEG_MODE = '7';                  // one line of text
export const SECOND_LOOK_SCALE = 2;
// Shear of the strip (x moves by shear * y): negative straightens text that leans backwards ("\"), positive forwards.
export const SECOND_LOOK_SHEARS = [0, -0.15, -0.3, 0.15, 0.3];
export const SECOND_LOOK_MAX_LINES = 3;
// A new reading is kept only when its words average at least this, and this many points more than the first reading.
export const SECOND_LOOK_MIN_CONFIDENCE = 60;
export const SECOND_LOOK_MIN_GAIN = 15;
// A reading this sure ends the line's sweep early.
export const SECOND_LOOK_GOOD_ENOUGH = 85;
// The second look starts no new strip after this long, so it never makes a slow phone much slower.
export const SECOND_LOOK_BUDGET_MS = 12000;

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

/** Thrown when a wipe shut the engine down while a scan was running; the caller should stay quiet. */
export class OcrCancelledError extends Error {
    constructor() {
        super('OCR stopped by a wipe');
        this.name = 'OcrCancelledError';
        this.code = 'OCR_CANCELLED';
    }
}

/** Thrown when reading a photo took too long; the engine has been restarted and the caller should offer a retry. */
export class OcrTimeoutError extends Error {
    constructor(timeoutMs) {
        super(`Reading the photo took longer than ${Math.round(timeoutMs / 1000)} s`);
        this.name = 'OcrTimeoutError';
        this.code = 'OCR_TIMEOUT';
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
    const started = generation;
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
        // lstm_choice_mode 2: each letter comes with the engine's other guesses (see glyphChoices.js). Still start-up: a
        // worker that never answers here (seen on WebKit) ends at the same time limit instead of hanging the scan.
        await Promise.race([worker.setParameters({ tessedit_pageseg_mode: OCR_PAGE_SEG_MODE, lstm_choice_mode: '2' }), failed]);
        if (generation !== started) throw new OcrCancelledError();
        tesseractWorker = worker;
        console.log(`[${MODULE_ID}] OCR Worker successfully initialized and locked for offline execution.`);
        return tesseractWorker;
    } catch (error) {
        // A worker that still finishes starting after a failure is not kept.
        created.then(w => w.terminate(), () => {});
        console.error(`[${MODULE_ID}] Failed to initialize OCR worker:`, error);
        throw error instanceof OcrUnavailableError || error instanceof OcrCancelledError ? error : new OcrUnavailableError(error && error.message || String(error));
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Stops the engine and drops it with whatever it last read; a scan still running ends with OcrCancelledError. The next
 * scan starts a fresh engine. Runs on every wipe and idle purge, so nothing from a photo outlives them.
 */
export function shutdownOCREngine() {
    generation++;
    if (cancelRunning) cancelRunning(new OcrCancelledError());
    const worker = tesseractWorker;
    tesseractWorker = null;
    if (worker) Promise.resolve().then(() => worker.terminate()).catch(() => {});
}
globalEventBus.subscribe(Events.VAULT_WIPED, shutdownOCREngine);
globalEventBus.subscribe(Events.MEMORY_PURGED, shutdownOCREngine);

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

// Unsure words of `text`: only words still in the line count, so icon debris dropped from the text does not.
const unsureWords = (text, words) => (words || []).filter(w => w.text.length > 1 && w.confidence < OCR_UNSURE_WORD_CONFIDENCE && text.split(' ').includes(w.text)).map(w => w.text);

/**
 * What a second look at `line` would re-read: from its first unsure word to the end of the line, with the words before
 * it (kept as read) and how sure the engine was of the words it re-reads. Null when the line has no unsure word.
 */
export function secondLookTarget(line, unsure) {
    const words = (line.words || []).filter(w => w.text && w.text.trim());
    const first = words.findIndex(w => unsure.includes(w.text));
    if (first < 0 || !line.bbox || !words[first].bbox) return null;
    const reread = words.slice(first);
    return {
        box: { x0: words[first].bbox.x0, y0: line.bbox.y0, x1: line.bbox.x1, y1: line.bbox.y1 },
        word: words[first].text,
        before: words.slice(0, first),
        confidence: reread.reduce((sum, w) => sum + (w.confidence || 0), 0) / reread.length
    };
}

/**
 * `text` with everything from the token `word` on replaced by `reread` (the second look's reading of that part), or
 * null when `word` is not a token of `text`.
 */
export function joinSecondLook(text, word, reread) {
    const tokens = String(text || '').split(' ');
    const at = tokens.indexOf(word);
    return at < 0 ? null : [...tokens.slice(0, at), reread].join(' ');
}

/**
 * Second guesses for `text` (a second look's reading, with its own `alts`) that also carry the first reading
 * (`firstText`, `firstAlts`): where the two readings line up letter for letter (a letter kept or swapped for one other),
 * the first reading's letter and its runner-ups join the new letter's runner-ups. When the readings disagree the field
 * mapper still sees both, and picks from the card's context as it does for any second guess (a straightened
 * "TeamLogiclT" with "TeamLogiciT", "I" as runner-up, in the first reading becomes TeamLogicIT).
 */
export function mergeReadingAlts(firstText, firstAlts, text, alts) {
    const a = String(firstText || ''), b = String(text || '');
    // Edit-distance table, then walk back to pair the letters of `b` with those of `a` they were kept or swapped from.
    const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i ? (j ? 0 : i) : j)));
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    const pairOf = new Map();
    for (let i = a.length, j = b.length; i > 0 && j > 0;) {
        if (d[i][j] === d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)) { pairOf.set(j - 1, i - 1); i--; j--; }
        else if (d[i][j] === d[i - 1][j] + 1) i--;
        else j--;
    }
    const firstAt = new Map((firstAlts || []).map(x => [x.at, x.chars]));
    const ownAt = new Map((alts || []).map(x => [x.at, x.chars]));
    const out = [];
    for (let at = 0; at < b.length; at++) {
        const from = pairOf.get(at);
        const others = [...(ownAt.get(at) || []), ...(from === undefined ? [] : [a[from], ...(firstAt.get(from) || [])])];
        const chars = [b[at], ...new Set(others.filter(c => c !== b[at] && c !== ' '))];
        if (chars.length > 1) out.push({ at, chars });
    }
    return out;
}

/** Is a second reading (`best`: { text, confidence }) clearly surer than the first (`firstConfidence`)? */
export function secondLookWins(firstConfidence, best) {
    return !!best && !!best.text && best.confidence >= SECOND_LOOK_MIN_CONFIDENCE && best.confidence >= firstConfidence + SECOND_LOOK_MIN_GAIN;
}

/** The strip of `page` (an image) inside `box`, padded, enlarged and sheared, as a PNG data URL. */
function stripImage(page, box, shear) {
    const h = box.y1 - box.y0;
    const x0 = Math.max(0, box.x0 - 0.15 * h), x1 = Math.min(page.naturalWidth, box.x1 + 0.35 * h);
    const y0 = Math.max(0, box.y0 - 0.35 * h), y1 = Math.min(page.naturalHeight, box.y1 + 0.35 * h);
    const width = Math.round((x1 - x0) * SECOND_LOOK_SCALE), height = Math.round((y1 - y0) * SECOND_LOOK_SCALE);
    const extra = Math.ceil(Math.abs(shear) * height);
    const canvas = document.createElement('canvas');
    canvas.width = width + extra;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(1, 0, shear, 1, shear < 0 ? extra : 0, 0);
    ctx.drawImage(page, x0, y0, x1 - x0, y1 - y0, 0, 0, width, height);
    return canvas.toDataURL('image/png');
}

/**
 * Second look at the lines with unsure words (at most SECOND_LOOK_MAX_LINES, least sure first): each is read again as a
 * strip at every SECOND_LOOK_SHEARS lean, and its text, second guesses and unsure words are replaced when the surest
 * reading wins (secondLookWins). Changes `lines` in place. Best effort: a failure keeps the first reading; only a wipe
 * (OcrCancelledError) ends the scan.
 */
async function secondLook(worker, processedImage, lines, started) {
    const todo = lines.filter(l => l.look).sort((a, b) => a.look.confidence - b.look.confidence).slice(0, SECOND_LOOK_MAX_LINES);
    if (!todo.length) return;
    const until = Date.now() + SECOND_LOOK_BUDGET_MS;
    try {
        const page = new Image();
        page.src = processedImage;
        await page.decode();
        await worker.setParameters({ tessedit_pageseg_mode: SECOND_LOOK_PAGE_SEG_MODE });
        for (const line of todo) {
            let best = null;
            for (const shear of SECOND_LOOK_SHEARS) {
                if (Date.now() > until) break;
                const { data } = await readWithin(worker, stripImage(page, line.look.box, shear), OCR_READ_TIMEOUT_MS);
                if (generation !== started) throw new OcrCancelledError();
                const words = refineLines(data.lines || []).flatMap(l => l.words).filter(w => w.text && w.text.trim());
                if (!words.length) continue;
                const confidence = words.reduce((sum, w) => sum + (w.confidence || 0), 0) / words.length;
                if (!best || confidence > best.confidence) best = { text: words.map(w => w.text).join(' '), words, confidence };
                if (confidence >= SECOND_LOOK_GOOD_ENOUGH) break;
            }
            const text = secondLookWins(line.look.confidence, best) && joinSecondLook(line.text, line.look.word, best.text);
            if (!text) continue;
            console.log(`[${MODULE_ID}] Second look: a line read again with confidence ${Math.round(best.confidence)} (was ${Math.round(line.look.confidence)})`);
            line.alts = mergeReadingAlts(line.text, line.alts, text, altsForText(text, [...line.look.before, ...best.words]));
            line.text = text;
            line.unsure = unsureWords(text, best.words);
        }
    } catch (error) {
        if (error instanceof OcrCancelledError) throw error;
        console.warn(`[${MODULE_ID}] Second look stopped, first reading kept:`, error);
    } finally {
        if (tesseractWorker === worker) await worker.setParameters({ tessedit_pageseg_mode: OCR_PAGE_SEG_MODE }).catch(() => {});
    }
}

/**
 * Icons in front of each OCR line (phone handset, envelope, social logo...). Best effort: any failure means no icons,
 * never a failed scan. Returns [{ text, icon, alts, unsure, look? }] in card order (lines that were only an icon are dropped);
 * `alts` are the engine's close second guesses for letters of `text` ([{ at, chars }], see glyphChoices.js), `unsure`
 * the words of 2+ characters it read with confidence below OCR_UNSURE_WORD_CONFIDENCE, `look` what a second look would
 * re-read (secondLookTarget; dropped before the lines are returned).
 */
async function linesWithIcons(processedImage, data) {
    const lines = refineLines(data.lines || []);
    if (!lines.length) return String(data.text || '').split('\n').map(text => ({ text: text.trim(), icon: null, alts: [], unsure: [] })).filter(l => l.text);
    const withAlts = (found) => found.map((l, i) => {
        const out = { text: l.text, icon: l.icon, alts: altsForText(l.text, lines[i].words), unsure: unsureWords(l.text, lines[i].words) };
        const look = secondLookTarget(lines[i], out.unsure);
        return look ? { ...out, look } : out;
    }).filter(l => l.text);
    try {
        const [templates, image] = await Promise.all([loadIconTemplates(), grayFromDataUrl(processedImage)]);
        return withAlts(detectLineIcons(image.gray, image.width, image.height, lines, templates));
    } catch (e) {
        console.warn(`[${MODULE_ID}] Icon detection skipped:`, e);
        return withAlts(lines.map(l => ({ text: (l.text || '').trim(), icon: null })));
    }
}

/**
 * Runs OCR on an image (data URL) and returns { text, confidence, lines }; `lines` is [{ text, icon, alts }] with the
 * icon found in front of each line (or null) and the engine's close second guesses. Mapping lines to contact fields is
 * MOD05's job. `onStatus('starting')` is called when the engine has to start first (the first scan, or after a wipe:
 * about 7 MB of bundled files to load), then `onStatus('reading')`.
 * Rejects with OcrUnavailableError when the engine cannot start, with OcrUnreadableError when the photo is too
 * blurry or unclear, so neither made-up nor garbage text ever reaches the form, with OcrTimeoutError when reading took
 * longer than `readTimeoutMs` (the engine is restarted), and with OcrCancelledError when a wipe stopped it.
 */
export async function executeOCRScan(imageSrc, { initTimeoutMs = OCR_INIT_TIMEOUT_MS, readTimeoutMs = OCR_READ_TIMEOUT_MS, onStatus = () => {} } = {}) {
    console.log(`[${MODULE_ID}] Starting OCR extraction pipeline...`);
    const started = generation;
    let cancel;
    const cancelled = new Promise((_, reject) => { cancel = reject; });
    cancelled.catch(() => {});
    cancelRunning = cancel;
    try {
        return await Promise.race([scan(imageSrc, initTimeoutMs, readTimeoutMs, onStatus, started), cancelled]);
    } finally {
        if (cancelRunning === cancel) cancelRunning = null;
    }
}

async function scan(imageSrc, initTimeoutMs, readTimeoutMs, onStatus, started) {
    // Preparing the photo counts as start-up: a photo the browser never finishes decoding ends at the same time limit.
    let timer;
    const late = new Promise((_, reject) => { timer = setTimeout(() => reject(new OcrUnavailableError(`preparing the photo took longer than ${Math.round(initTimeoutMs / 1000)} s`)), initTimeoutMs); });
    const processedImage = await Promise.race([preProcessImageBuffer(imageSrc), late]).finally(() => clearTimeout(timer));
    if (!tesseractWorker) onStatus('starting');
    const worker = await initOCREngine(initTimeoutMs);
    onStatus('reading');
    const result = await readWithin(worker, processedImage, readTimeoutMs);
    if (generation !== started) throw new OcrCancelledError();
    const text = result.data.text || '';
    const confidence = Math.round(result.data.confidence || 0);
    const readableWords = (result.data.words || []).filter(w => w.confidence >= 60 && /[A-Za-z0-9]{2,}/.test(w.text)).length;

    console.log(`[${MODULE_ID}] OCR extraction complete. Confidence ${confidence}, ${readableWords} readable words, raw text length ${text.length}`);
    if (confidence < OCR_MIN_CONFIDENCE || readableWords < OCR_MIN_READABLE_WORDS) {
        throw new OcrUnreadableError(confidence, readableWords);
    }
    const found = await linesWithIcons(processedImage, result.data);
    if (generation !== started) throw new OcrCancelledError();
    await secondLook(worker, processedImage, found, started);
    if (generation !== started) throw new OcrCancelledError();
    const lines = found.map(({ look, ...line }) => line);
    // A signal only: the text itself is contact data and goes back to the caller, never onto the bus.
    globalEventBus.publish(Events.OCR_TEXT_EXTRACTED, { sourceModule: MODULE_ID, confidence, icons: lines.filter(l => l.icon).length, timestamp: Date.now() });
    return { text, confidence, lines };
}

/** worker.recognize, or OcrTimeoutError after `timeoutMs`; a worker that ran out of time is stopped, so the next scan starts a fresh one. */
async function readWithin(worker, image, timeoutMs) {
    let timer;
    const late = new Promise((_, reject) => { timer = setTimeout(() => reject(new OcrTimeoutError(timeoutMs)), timeoutMs); });
    try {
        return await Promise.race([worker.recognize(image), late]);
    } catch (error) {
        if (error instanceof OcrTimeoutError) {
            console.error(`[${MODULE_ID}] ${error.message}: restarting the engine`);
            if (tesseractWorker === worker) tesseractWorker = null;
            Promise.resolve().then(() => worker.terminate()).catch(() => {});
        }
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

export const getModuleName = () => MODULE_NAME;
