/**
 * vCard Generator Engine (vCGE)
 * Copyright (c) 2026 raven575, Herd of Helpers (claude) & gemini
 *
 * Repository: https://github.com/real-raven575/vCGE-Master
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */

import { globalEventBus, Events } from '../../share/eventBus.js';
import { loadIconTemplates, grayFromDataUrl, detectLineIcons } from './iconDetector.js';
import { refineLines, altsForText } from './glyphChoices.js';
import { findFaintBands, usualLineHeight, trimStripText } from './faintLines.js';

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
// The last stopped reader, until its WebAssembly memory is given back. A new reader waits for it (up to
// RETIRE_WAIT_MS), so two readers' memory is never held at once. On WebKit the fresh reader started right after a
// crash crashed too, inside Recognize ("Out of bounds memory access"), and the read ended with nothing (iPhone CI job
// 137281776598, right after a wipe had stopped another reader); memory held by the old reader is the likely cause.
let retiring = null;
export const RETIRE_WAIT_MS = 3000;

/** Stops `worker` and notes it, so the next reader starts only once it is gone. */
function retire(worker) {
    const stopped = Promise.resolve().then(() => worker.terminate()).catch(() => {});
    retiring = stopped;
    stopped.then(() => { if (retiring === stopped) retiring = null; });
}

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
// A reading under OCR_MIN_CONFIDENCE that still has at least this many readable words is kept, with every line marked
// for the user to check (raven575's yes, 2026-11-20, OCR tuning): on the lab sets such reads scored 56% of characters
// on average and up to 96%, while reads with under 6 readable words scored 0-33%. Its lines carry `lowConfidence: true`.
export const OCR_CHECK_MIN_WORDS = 10;
// A photo that fails the check above but scores at most this on blurScore is sharp: its lettering, not the focus, beat
// the reader (raven575, 2026-10-22: a sharp card in a handwriting-style font was called "too blurry"). Prepared photos
// score about 0.28-0.35 sharp, 0.43-0.55 with 1 px of blur and 0.75 or more with 3 px.
export const OCR_SHARP_BLUR = 0.5;
// A word read with confidence below this is passed on as unsure, so the review step can ask the user to check it.
export const OCR_UNSURE_WORD_CONFIDENCE = 50;

// Second look (raven575's yes, 2026-10-18): a line with unsure words is read again as one enlarged strip, straight and
// with its lean corrected both ways, and the surest reading is kept when it is clearly surer than the first. On a scan
// whose text leaned backwards, the web line went from "PeakLogic\T.com Kalamazoo" (12) to "...KalamazooM|" (87).
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

// Digits look (raven575's yes, 2026-11-10, accuracy round 1): the phone number in a line is read once more as a strip
// that may hold only phone characters, so the reader cannot turn a 5 into an S or a 0 into an O. The new digits replace
// the first reading only when they make a whole phone number and the first reading did not, or are clearly surer.
export const DIGITS_LOOK_CHARS = '0123456789()+-.x';
export const DIGITS_LOOK_SHEARS = [0, -0.15, 0.15];
export const DIGITS_LOOK_MAX_LINES = 3;
export const DIGITS_LOOK_MIN_CONFIDENCE = 60;
export const DIGITS_LOOK_MIN_GAIN = 10;
// A number read this surely, all in digits already, is not read again.
export const DIGITS_LOOK_SURE = 90;
export const DIGITS_LOOK_GOOD_ENOUGH = 90;
export const DIGITS_LOOK_BUDGET_MS = 8000;
// Letters and marks the reader gives for digits in a phone number.
const DIGIT_LOOKALIKES = { O: '0', o: '0', D: '0', Q: '0', I: '1', l: '1', i: '1', '|': '1', '!': '1', Z: '2', z: '2', S: '5', s: '5', $: '5', G: '6', b: '6', T: '7', B: '8', g: '9', q: '9' };

// Second black-and-white (raven575's ask, 2026-11-21, OCR for the Monday testers): a first reading less sure than this is
// read again with the engine's local (Sauvola) black-and-white step instead of its whole-page one, and the surer reading
// is kept. The whole-page step loses text on shaded, soft or unevenly lit photos; the local one loses light text on dark
// bands, so neither alone. On the lab card bench (7 real photos, 32 made-up cards) fields right went from 70% to 88%,
// sharp made-up cards unchanged, and 18 of the 39 photos were read twice.
export const SECOND_BINARIZE_BELOW = 75;
const THRESHOLD_WHOLE_PAGE = '0', THRESHOLD_LOCAL = '2';

// Faint look (raven575's ask, 2026-11-21): light grey lettering the reading missed (faintLines.js) is read again as a
// strip with its own contrast. A strip's reading is added as a line only when it is sure and has a real word; its words
// are all marked unsure, so the review asks the user to check the line.
// 45: a pale name reads around 50 ("Nick Zarter", 49) and is still worth showing, marked for checking.
export const FAINT_LOOK_MIN_CONFIDENCE = 45;
export const FAINT_LOOK_BUDGET_MS = 6000;

/** Thrown when the photo is too blurry or unclear to read; the caller should ask for a new photo. */
export class OcrUnreadableError extends Error {
    /** `sharp`: the photo itself looked sharp (OCR_SHARP_BLUR), so the card's lettering is what could not be read. */
    constructor(confidence, readableWords, sharp = false) {
        super(`Image ${sharp ? 'sharp but its lettering could not be read' : 'too blurry or unclear to read'} (confidence ${confidence}, ${readableWords} readable words)`);
        this.name = 'OcrUnreadableError';
        this.code = 'OCR_UNREADABLE';
        this.confidence = confidence;
        this.readableWords = readableWords;
        this.sharp = sharp;
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

// The reader's start-up steps (Tesseract.js logger) and the share of the start each one ends at: the engine (about 4 MB)
// and the English model (about 3 MB) are the slow ones.
const START_STEPS = [['loading tesseract core', 0, 0.5], ['initializing tesseract', 0.5, 0.55], ['loading language traineddata', 0.55, 0.95], ['initializing api', 0.95, 1]];

/** How far start-up is (0 to 1) when the engine reports `step` at `progress` (0 to 1); unknown steps give null. */
export function startProgress(step, progress) {
    const found = START_STEPS.find(([name]) => name === step);
    if (!found) return null;
    const [, from, to] = found, p = Math.min(1, Math.max(0, Number(progress) || 0));
    return from + (to - from) * p;
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
 * Thrown when the reader's files all loaded but the engine stopped in its last start-up step (seen on WebKit, CI run
 * 39702174014: "initializing api"). Not a missing file: the caller says the reader stopped and to try again.
 */
export class OcrStartFailedError extends Error {
    constructor(reason) {
        super(`The reader stopped while starting: ${reason}`);
        this.name = 'OcrStartFailedError';
        this.code = 'OCR_START_FAILED';
    }
}

/**
 * Starts the bundled Tesseract.js worker once and reuses it. Rejects with OcrUnavailableError when the library is
 * missing, a start-up step fails (e.g. the language model cannot be fetched) or start-up exceeds the time limit, and
 * with OcrStartFailedError when the files loaded but the engine's own start-up step failed.
 * Tesseract.js 5 swallows failures of its language/initialize steps inside createWorker, whose promise then never
 * settles, so errors are caught through `errorHandler` and raced against the returned promise.
 */
async function initOCREngine(timeoutMs, onStep = () => {}) {
    if (tesseractWorker) return tesseractWorker;
    const started = generation;
    if (typeof Tesseract === 'undefined') throw new OcrUnavailableError('Tesseract.js is not loaded');
    if (retiring) {
        let wait;
        await Promise.race([retiring, new Promise(res => { wait = setTimeout(res, RETIRE_WAIT_MS); })]);
        clearTimeout(wait);
        if (generation !== started) throw new OcrCancelledError();
    }

    console.log(`[${MODULE_ID}] Initializing offline Tesseract WASM worker...`);
    let fail, filesLoaded = false;
    const failed = new Promise((_, reject) => { fail = reject; });
    const timer = setTimeout(() => fail(new OcrUnavailableError(`start-up took longer than ${Math.round(timeoutMs / 1000)} s`)), timeoutMs);
    const created = Promise.resolve().then(() => Tesseract.createWorker('eng', 1, {
        workerPath: guardedWorkerUrl(),
        corePath: vendorUrl('core/'),
        langPath: vendorUrl('lang/'),
        gzip: true,
        cacheMethod: 'none',      // keep language data out of IndexedDB
        workerBlobURL: false,     // same-origin worker script, so the page CSP needs no 'wasm-unsafe-eval'
        errorHandler: (err) => fail(filesLoaded ? new OcrStartFailedError(String(err)) : new OcrUnavailableError(String(err))),
        logger: m => {
            if (m && m.status) {
                if (m.status === 'initializing api') filesLoaded = true;
                onStep(m.status, m.progress);
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
        throw error instanceof OcrUnavailableError || error instanceof OcrStartFailedError || error instanceof OcrCancelledError ? error : new OcrUnavailableError(error && error.message || String(error));
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
    if (worker) retire(worker);
}
globalEventBus.subscribe(Events.VAULT_WIPED, shutdownOCREngine);
globalEventBus.subscribe(Events.MEMORY_PURGED, shutdownOCREngine);

/**
 * Prepares a photo for OCR: greyscale, resized so the longer side is about 1800 px (small photos are enlarged up to 3x,
 * large ones reduced to 2400 px), and contrast stretched between the 1st and 99th brightness percentiles.
 * There is deliberately no hard black/white threshold: Tesseract binarises adaptively, which copes with the shadows,
 * glare and coloured areas of phone photos far better than one global cut-off.
 */
/** How much the reader enlarges (or shrinks) a photo whose long side is `longest` px before reading it. */
export function readerScale(longest) {
    const l = Math.max(1, longest || 1);
    return l < 1200 ? Math.min(3, 1800 / l) : (l > 2400 ? 2400 / l : 1);
}

export function preProcessImageBuffer(imageSrc) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'Anonymous';

        img.onload = function() {
            try {
                const scale = readerScale(Math.max(img.width, img.height) || 1);
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
 * How blurry a greyscale picture (`gray`, one value 0-255 per pixel, `w` x `h`) is, 0 (sharp) to 1, without a sharp
 * copy to compare with (Crete et al., 2007): blurring it again by 9 pixels changes a sharp picture's neighbour steps a
 * lot and a blurry one's hardly at all. The blurrier of the two directions counts; a direction with no steps at all
 * (plain stripes) is left out, and a picture with no steps either way counts as blurry (1).
 */
export function blurScore(gray, w, h) {
    const R = 4, N = 2 * R + 1;
    const along = (count, len, at) => {           // `count` rows of `len` pixels; at(row, i) is a pixel
        let steps = 0, kept = 0;
        for (let r = 0; r < count; r++) {
            let sum = 0;
            for (let k = -R; k <= R; k++) sum += at(r, Math.min(len - 1, Math.max(0, k)));
            let prevF = at(r, 0), prevB = sum / N;
            for (let i = 1; i < len; i++) {
                sum += at(r, Math.min(len - 1, i + R)) - at(r, Math.max(0, i - R - 1));
                const f = at(r, i), b = sum / N, dF = Math.abs(f - prevF), dB = Math.abs(b - prevB);
                steps += dF; kept += Math.max(0, dF - dB);
                prevF = f; prevB = b;
            }
        }
        return steps ? 1 - kept / steps : null;
    };
    const scores = [along(h, w, (y, x) => gray[y * w + x]), along(w, h, (x, y) => gray[y * w + x])].filter(v => v !== null);
    return scores.length ? Math.max(...scores) : 1;
}

/** blurScore of a prepared photo (a data URL from preProcessImageBuffer, already grey). */
export function photoBlurScore(imageSrc) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            try {
                const w = img.width, h = img.height, canvas = document.createElement('canvas');
                canvas.width = w; canvas.height = h;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);
                const data = ctx.getImageData(0, 0, w, h).data, gray = new Uint8Array(w * h);
                for (let i = 0; i < gray.length; i++) gray[i] = data[i * 4];
                resolve(blurScore(gray, w, h));
            } catch (err) { reject(err); }
        };
        img.onerror = () => reject(new Error('Failed to load the prepared photo to measure its sharpness'));
        img.src = imageSrc;
    });
}

// How sure the engine was of a line: the mean of its words' confidence (0-100), or undefined with no words.
const meanConfidence = (words) => {
    const read = (words || []).filter(w => w.text && w.text.trim() && typeof w.confidence === 'number');
    return read.length ? Math.round(read.reduce((sum, w) => sum + w.confidence, 0) / read.length) : undefined;
};

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
 * "PeakLogiclT" with "PeakLogiciT", "I" as runner-up, in the first reading becomes PeakLogicIT).
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

/** `text` with every digit look-alike (O, S, l, B...) turned into the digit it stands for. */
export function asDigits(text) {
    return String(text || '').replace(/[OoDQIli|!ZzSs$GbTBgq]/g, c => DIGIT_LOOKALIKES[c]);
}

// One word of a phone number: phone characters only once look-alikes are digits, with at least one real digit.
const phoneWord = (text) => /\d/.test(text) && /^[+(]?[\d().\-x]*\d[\d().\-x]*[,;]?$/.test(asDigits(text));
const digitCount = (text) => String(text || '').replace(/x\d+$/i, '').replace(/\D/g, '').length;

/** Is `text` a whole phone number in phone characters: 10 digits, 11 starting with 1, or + and 8-15 digits (an x extension aside)? */
export function isPhoneDigits(text) {
    const t = String(text || '').trim();
    if (!t || !/^[\d()+\-.x ]+$/.test(t)) return false;
    const n = digitCount(t), digits = t.replace(/x\d+$/i, '').replace(/\D/g, '');
    return t.startsWith('+') ? n >= 8 && n <= 15 : n === 10 || (n === 11 && digits[0] === '1');
}

/**
 * What a digits look at `line` would re-read: its first run of phone words holding 7-15 digits (look-alikes counted),
 * at least half of them real digits. Null when the line has no such run, or the run is already sure, whole digits.
 */
export function digitsLookTarget(line) {
    const words = (line.words || []).filter(w => w.text && w.text.trim());
    if (!line.bbox) return null;
    for (let start = 0; start < words.length; start++) {
        if (!phoneWord(words[start].text)) continue;
        let end = start;
        while (end + 1 < words.length && phoneWord(words[end + 1].text)) end++;
        const run = words.slice(start, end + 1), text = run.map(w => w.text).join(' ');
        const n = digitCount(asDigits(text)), real = (text.match(/\d/g) || []).length;
        if (n >= 7 && n <= 15 && real * 2 >= n && run.every(w => w.bbox)) {
            const confidence = run.reduce((sum, w) => sum + (w.confidence || 0), 0) / run.length;
            if (asDigits(text) === text && isPhoneDigits(text) && run.every(w => w.confidence >= DIGITS_LOOK_SURE)) return null;
            return {
                box: { x0: run[0].bbox.x0, y0: line.bbox.y0, x1: run[run.length - 1].bbox.x1, y1: line.bbox.y1 },
                words: run.map(w => w.text), before: words.slice(0, start), after: words.slice(end + 1), text, confidence
            };
        }
        start = end;
    }
    return null;
}

/** Does a digits-only reading (`best`: { text, confidence }) replace the first reading of the run (`target`)? */
export function digitsLookWins(target, best) {
    if (!target || !best || !best.text || best.text === target.text || best.confidence < DIGITS_LOOK_MIN_CONFIDENCE || !isPhoneDigits(best.text)) return false;
    const was = digitCount(asDigits(target.text));
    if (digitCount(best.text) !== was && isPhoneDigits(asDigits(target.text))) return false;
    return !isPhoneDigits(target.text) || best.confidence >= target.confidence + DIGITS_LOOK_MIN_GAIN;
}

/** `text` with the run of tokens `words` replaced by `reread`, or null when the run is not in `text`. */
export function joinDigitsLook(text, words, reread) {
    const tokens = String(text || '').split(' ');
    for (let i = 0; i + words.length <= tokens.length; i++) {
        if (words.every((w, k) => tokens[i + k] === w)) return [...tokens.slice(0, i), reread, ...tokens.slice(i + words.length)].join(' ');
    }
    return null;
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
            line.confidence = meanConfidence([...line.look.before, ...best.words]);
        }
    } catch (error) {
        if (error instanceof OcrCancelledError) throw error;
        console.warn(`[${MODULE_ID}] Second look stopped, first reading kept:`, error);
    } finally {
        if (tesseractWorker === worker) await worker.setParameters({ tessedit_pageseg_mode: OCR_PAGE_SEG_MODE }).catch(() => {});
    }
}

/**
 * The words of a digits-only strip reading, as read: the echo clean-up of refineLines is skipped, because it takes the
 * real second digit of "55" or "66" for an echo (measured 2026-11-10: "555-0158" came back "55-0158"). With a
 * character list Tesseract can score a whole word 0 while every digit in it scores in the 90s, so a word's confidence is
 * the mean of its digits' when it has them.
 */
export function digitWords(data) {
    return (data.words || []).filter(w => w.text && w.text.trim()).map(w => {
        const symbols = (w.symbols || []).filter(y => typeof y.confidence === 'number');
        const confidence = symbols.length ? symbols.reduce((sum, y) => sum + y.confidence, 0) / symbols.length : (w.confidence || 0);
        return { ...w, confidence, alts: [] };
    });
}

/**
 * Digits look at the lines holding a phone number (at most DIGITS_LOOK_MAX_LINES, least sure first): the number is read
 * again as a strip that may hold only DIGITS_LOOK_CHARS, and replaces the first reading when digitsLookWins. Changes
 * `lines` in place. Best effort like the second look: a failure keeps the reading; only a wipe ends the scan.
 */
async function digitsLook(worker, processedImage, lines, started) {
    const todo = lines.filter(l => l.digits).sort((a, b) => a.digits.confidence - b.digits.confidence).slice(0, DIGITS_LOOK_MAX_LINES);
    if (!todo.length) return;
    const until = Date.now() + DIGITS_LOOK_BUDGET_MS;
    try {
        const page = new Image();
        page.src = processedImage;
        await page.decode();
        await worker.setParameters({ tessedit_pageseg_mode: SECOND_LOOK_PAGE_SEG_MODE, tessedit_char_whitelist: DIGITS_LOOK_CHARS });
        for (const line of todo) {
            let best = null;
            for (const shear of DIGITS_LOOK_SHEARS) {
                if (Date.now() > until) break;
                const { data } = await readWithin(worker, stripImage(page, line.digits.box, shear), OCR_READ_TIMEOUT_MS);
                if (generation !== started) throw new OcrCancelledError();
                const words = digitWords(data);
                if (!words.length) continue;
                const confidence = words.reduce((sum, w) => sum + w.confidence, 0) / words.length;
                if (!best || confidence > best.confidence) best = { text: words.map(w => w.text).join(' '), words, confidence };
                if (confidence >= DIGITS_LOOK_GOOD_ENOUGH && isPhoneDigits(best.text)) break;
            }
            const text = digitsLookWins(line.digits, best) && joinDigitsLook(line.text, line.digits.words, best.text);
            if (!text) continue;
            console.log(`[${MODULE_ID}] Digits look: a phone number read again in digits only, confidence ${Math.round(best.confidence)} (was ${Math.round(line.digits.confidence)})`);
            const all = [...line.digits.before, ...best.words, ...line.digits.after];
            line.alts = mergeReadingAlts(line.text, line.alts, text, altsForText(text, all));
            line.text = text;
            line.unsure = unsureWords(text, all);
            line.confidence = meanConfidence(all);
        }
    } catch (error) {
        if (error instanceof OcrCancelledError) throw error;
        console.warn(`[${MODULE_ID}] Digits look stopped, first reading kept:`, error);
    } finally {
        if (tesseractWorker === worker) await worker.setParameters({ tessedit_pageseg_mode: OCR_PAGE_SEG_MODE, tessedit_char_whitelist: '' }).catch(() => {});
    }
}

/** The strip of `page` (an image) inside `box`, padded by `pad` px, stretched between its darkest ink and its paper, enlarged. */
function faintStripImage(page, box, pad) {
    const x0 = Math.max(0, box.x0 - pad), x1 = Math.min(page.naturalWidth, box.x1 + pad);
    const y0 = Math.max(0, box.y0 - pad), y1 = Math.min(page.naturalHeight, box.y1 + pad);
    const width = Math.max(1, Math.round((x1 - x0) * SECOND_LOOK_SCALE)), height = Math.max(1, Math.round((y1 - y0) * SECOND_LOOK_SCALE));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(page, x0, y0, x1 - x0, y1 - y0, 0, 0, width, height);
    const img = ctx.getImageData(0, 0, width, height), d = img.data;
    const values = new Uint8Array(width * height);
    for (let i = 0; i < values.length; i++) values[i] = d[i * 4];
    const sorted = Uint8Array.from(values).sort();
    const low = sorted[Math.floor(sorted.length * 0.02)], high = sorted[Math.floor(sorted.length * 0.5)];
    const k = high - low > 4 ? 255 / (high - low) : 1;
    for (let i = 0; i < values.length; i++) d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = Math.max(0, Math.min(255, Math.round((values[i] - low) * k)));
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL('image/png');
}

/**
 * Faint look: bands of faint ink no line covers (findFaintBands) are read again one strip at a time, and a sure reading
 * with a real word is added to `found` in its place from the top. Changes `found` in place. Best effort like the other
 * looks: a failure adds nothing; only a wipe ends the scan.
 */
async function faintLook(worker, processedImage, data, found, started) {
    const lineHeight = usualLineHeight(data.lines);
    if (!lineHeight || !found.length || found.some(l => l.y === undefined)) return;
    const until = Date.now() + FAINT_LOOK_BUDGET_MS;
    try {
        const image = await grayFromDataUrl(processedImage);
        const boxes = (data.lines || []).filter(l => l && l.bbox).map(l => l.bbox);
        const bands = findFaintBands(image.gray, image.width, image.height, boxes, lineHeight);
        if (!bands.length) return;
        const page = new Image();
        page.src = processedImage;
        await page.decode();
        await worker.setParameters({ tessedit_pageseg_mode: SECOND_LOOK_PAGE_SEG_MODE });
        const known = new Set(found.map(l => l.text.toLowerCase()));
        for (const band of bands) {
            if (Date.now() > until) break;
            // A band found only on its letters' middles is read a line high, so the strip holds whole letters.
            const grow = Math.max(0, Math.round((lineHeight * 1.1 - (band.y1 - band.y0)) / 2));
            const strip0 = { ...band, y0: band.y0 - grow, y1: band.y1 + grow };
            const { data: strip } = await readWithin(worker, faintStripImage(page, strip0, Math.round(lineHeight * 0.3)), OCR_READ_TIMEOUT_MS);
            if (generation !== started) throw new OcrCancelledError();
            const words = (strip.words || []).filter(w => w.text && w.text.trim());
            const confidence = meanConfidence(words);
            const text = trimStripText(words.map(w => w.text).join(' '));
            const real = words.some(w => w.confidence >= 60 && (w.text.match(/[A-Za-z0-9]/g) || []).length >= 3);
            if (!text || !real || confidence < FAINT_LOOK_MIN_CONFIDENCE || known.has(text.toLowerCase())) continue;
            console.log(`[${MODULE_ID}] Faint look: a light line read with confidence ${confidence}`);
            known.add(text.toLowerCase());
            const at = found.findIndex(l => l.y > band.y0);
            const line = { text, icon: null, alts: [], unsure: text.split(' ').filter(t => t.length > 1), confidence, y: band.y0 };
            found.splice(at < 0 ? found.length : at, 0, line);
        }
    } catch (error) {
        if (error instanceof OcrCancelledError) throw error;
        console.warn(`[${MODULE_ID}] Faint look stopped, nothing added:`, error);
    } finally {
        if (tesseractWorker === worker) await worker.setParameters({ tessedit_pageseg_mode: OCR_PAGE_SEG_MODE }).catch(() => {});
    }
}

/**
 * Icons in front of each OCR line (phone handset, envelope, social logo...). Best effort: any failure means no icons,
 * never a failed scan. Returns [{ text, icon, alts, unsure, confidence, look? }] in card order (lines that were only an icon are dropped);
 * `alts` are the engine's close second guesses for letters of `text` ([{ at, chars }], see glyphChoices.js), `unsure`
 * the words of 2+ characters it read with confidence below OCR_UNSURE_WORD_CONFIDENCE, `look` what a second look would
 * re-read (secondLookTarget) and `digits` what a digits look would (digitsLookTarget); both dropped before the lines are returned.
 */
async function linesWithIcons(processedImage, data) {
    const lines = refineLines(data.lines || []);
    if (!lines.length) return String(data.text || '').split('\n').map(text => ({ text: text.trim(), icon: null, alts: [], unsure: [] })).filter(l => l.text);
    const withAlts = (found) => found.map((l, i) => {
        const out = { text: l.text, icon: l.icon, alts: altsForText(l.text, lines[i].words), unsure: unsureWords(l.text, lines[i].words), confidence: meanConfidence(lines[i].words), y: lines[i].bbox ? lines[i].bbox.y0 : undefined };
        const look = secondLookTarget(lines[i], out.unsure), digits = digitsLookTarget(lines[i]);
        return { ...out, ...(look ? { look } : {}), ...(digits ? { digits } : {}) };
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
 * Rejects with OcrUnavailableError when the engine cannot start, with OcrStartFailedError when it stopped while starting
 * twice, with OcrUnreadableError when the photo is too
 * blurry or unclear (`sharp` when the photo was sharp but its lettering beat the reader), so neither made-up nor garbage text ever reaches the form, with OcrTimeoutError when reading took
 * longer than `readTimeoutMs` (the engine is restarted), and with OcrCancelledError when a wipe stopped it.
 * A reading under OCR_MIN_CONFIDENCE with at least OCR_CHECK_MIN_WORDS readable words is not rejected: it comes back with
 * `lowConfidence: true`, on the result and on every line, so the review asks the user to check each line.
 * `gate: false` (lab use only) returns a reading that failed the unreadable check instead of rejecting it, with
 * `failedGate: { confidence, readableWords, sharp }`, so the lab can score what that check throws away.
 */
export async function executeOCRScan(imageSrc, { initTimeoutMs = OCR_INIT_TIMEOUT_MS, readTimeoutMs = OCR_READ_TIMEOUT_MS, onStatus = () => {}, gate = true } = {}) {
    console.log(`[${MODULE_ID}] Starting OCR extraction pipeline...`);
    const started = generation;
    let cancel;
    const cancelled = new Promise((_, reject) => { cancel = reject; });
    cancelled.catch(() => {});
    cancelRunning = cancel;
    try {
        return await Promise.race([scan(imageSrc, initTimeoutMs, readTimeoutMs, onStatus, started, gate), cancelled]);
    } finally {
        if (cancelRunning === cancel) cancelRunning = null;
    }
}

async function scan(imageSrc, initTimeoutMs, readTimeoutMs, onStatus, started, gate) {
    // Preparing the photo counts as start-up: a photo the browser never finishes decoding ends at the same time limit.
    let timer;
    const late = new Promise((_, reject) => { timer = setTimeout(() => reject(new OcrUnavailableError(`preparing the photo took longer than ${Math.round(initTimeoutMs / 1000)} s`)), initTimeoutMs); });
    let processedImage = await Promise.race([preProcessImageBuffer(imageSrc), late]).finally(() => clearTimeout(timer));
    // Each start-up step moves the "Preparing the reader" percentage, so a slow first load (about 7 MB) is seen moving
    // and not taken for a freeze (raven575's first phone run of 0.8, 2026-11-03).
    // Only start-up steps: the same logger also reports "recognizing text" while reading, which must not relabel the read.
    const onStep = (step, progress) => { const f = startProgress(step, progress); if (f !== null && !tesseractWorker) onStatus('starting', f); };
    // The engine stopping in its own start-up step (WebKit, CI run 39702174014) gets one fresh start (raven575, 2026-10-22).
    const startEngine = async () => {
        try { return await initOCREngine(initTimeoutMs, onStep); }
        catch (error) {
            if (!(error instanceof OcrStartFailedError) || generation !== started) throw error;
            console.warn(`[${MODULE_ID}] ${error.message}; starting a fresh reader once more`);
            return initOCREngine(initTimeoutMs, onStep);
        }
    };
    if (!tesseractWorker) onStatus('starting', 0);
    let worker = await startEngine();
    onStatus('reading');
    let result;
    try {
        result = await readWithin(worker, processedImage, readTimeoutMs);
    } catch (error) {
        // The engine itself crashed (seen on WebKit: "RuntimeError: Out of bounds memory access" inside Recognize on a
        // page's first read, CI run 160): a fresh reader reads the same photo once more (raven575, 2026-10-21).
        if (!isEngineCrash(error) || generation !== started) throw error;
        console.warn(`[${MODULE_ID}] The reader crashed (${error.message}); reading once more with a fresh reader`);
        if (tesseractWorker === worker) tesseractWorker = null;
        retire(worker);
        onStatus('starting', 0);
        worker = await startEngine();
        if (generation !== started) throw new OcrCancelledError();
        onStatus('reading');   // the fresh reader's start-up said "Preparing the reader"; the read is back on
        result = await readWithin(worker, processedImage, readTimeoutMs);
    }
    if (generation !== started) throw new OcrCancelledError();
    if (Math.round(result.data.confidence || 0) < SECOND_BINARIZE_BELOW) result = await secondBinarize(worker, processedImage, result, readTimeoutMs, started);
    // A card held the other way reads as near nothing: the photo is read turned a quarter each way and the best kept.
    const turn = await tryTurns(worker, processedImage, result, readTimeoutMs, started);
    if (generation !== started) throw new OcrCancelledError();
    processedImage = turn.image;
    result = turn.result;
    if (turn.quarter && Math.round(result.data.confidence || 0) < SECOND_BINARIZE_BELOW) result = await secondBinarize(worker, processedImage, result, readTimeoutMs, started);
    const text = result.data.text || '';
    const confidence = Math.round(result.data.confidence || 0);
    const readableWords = readableWordCount(result.data);

    console.log(`[${MODULE_ID}] OCR extraction complete. Confidence ${confidence}, ${readableWords} readable words, raw text length ${text.length}`);
    let failedGate = null;
    let lowConfidence = false;
    if (gate && confidence < OCR_MIN_CONFIDENCE && readableWords >= OCR_CHECK_MIN_WORDS) {
        // Unsure overall but with many readable words: kept, and every line goes to the review marked for checking.
        console.log(`[${MODULE_ID}] Low confidence with ${readableWords} readable words: kept, every line marked to check`);
        lowConfidence = true;
    } else if (confidence < OCR_MIN_CONFIDENCE || readableWords < OCR_MIN_READABLE_WORDS) {
        // Sharp or blurry decides the advice; if it can't be measured the photo is taken as blurry (the older advice).
        const blur = await photoBlurScore(processedImage).catch((err) => { console.warn(`[${MODULE_ID}] ${err.message}`); return 1; });
        if (generation !== started) throw new OcrCancelledError();
        console.log(`[${MODULE_ID}] Blur score ${blur.toFixed(2)}`);
        // The lab's Card Inbox reads with gate: false to measure what this check throws away; the app never does.
        if (gate) throw new OcrUnreadableError(confidence, readableWords, blur <= OCR_SHARP_BLUR);
        failedGate = { confidence, readableWords, sharp: blur <= OCR_SHARP_BLUR };
    }
    const found = await linesWithIcons(processedImage, result.data);
    if (generation !== started) throw new OcrCancelledError();
    await secondLook(worker, processedImage, found, started);
    if (generation !== started) throw new OcrCancelledError();
    await digitsLook(worker, processedImage, found, started);
    if (generation !== started) throw new OcrCancelledError();
    await faintLook(worker, processedImage, result.data, found, started);
    if (generation !== started) throw new OcrCancelledError();
    const lines = found.map(({ look, digits, y, ...line }) => (lowConfidence ? { ...line, lowConfidence: true } : line));
    // Where each line sits, in the reader's pixels (the photo times readerScale): the logo finder blanks out the contact
    // text with these (logoGuess.js). Boxes and text only, like the lines themselves. A turned reading's boxes are put
    // back on the upright photo, which is the one the logo finder looks at.
    const boxes = (result.data.lines || []).filter(l => l && l.bbox && String(l.text || '').trim())
        .map(l => ({ text: String(l.text).trim(), confidence: Math.round(l.confidence || 0), bbox: unturnBox({ x0: l.bbox.x0, y0: l.bbox.y0, x1: l.bbox.x1, y1: l.bbox.y1 }, turn.quarter, turn.width, turn.height) }));
    // A signal only: the text itself is contact data and goes back to the caller, never onto the bus.
    globalEventBus.publish(Events.OCR_TEXT_EXTRACTED, { sourceModule: MODULE_ID, confidence, icons: lines.filter(l => l.icon).length, timestamp: Date.now() });
    if (failedGate) return { text, confidence, lines, boxes, failedGate };
    return lowConfidence ? { text, confidence, lines, boxes, lowConfidence } : { text, confidence, lines, boxes };
}

/**
 * The photo read again with the local black-and-white step (SECOND_BINARIZE_BELOW); the surer of the two readings is
 * returned. Best effort: a failure keeps the first reading; only a wipe (OcrCancelledError) ends the scan.
 */
async function secondBinarize(worker, processedImage, first, timeoutMs, started) {
    try {
        await worker.setParameters({ thresholding_method: THRESHOLD_LOCAL });
        const second = await readWithin(worker, processedImage, timeoutMs);
        if (generation !== started) throw new OcrCancelledError();
        const was = Math.round(first.data.confidence || 0), now = Math.round(second.data.confidence || 0);
        console.log(`[${MODULE_ID}] Second black-and-white: confidence ${now} (was ${was})`);
        return now > was ? second : first;
    } catch (error) {
        if (error instanceof OcrCancelledError) throw error;
        console.warn(`[${MODULE_ID}] Second black-and-white stopped, first reading kept:`, error);
        return first;
    } finally {
        if (tesseractWorker === worker) await worker.setParameters({ thresholding_method: THRESHOLD_WHOLE_PAGE }).catch(() => {});
    }
}

/** Readable words in a reading: confidence 60+ and two letters or digits in a row (the same count the gate uses). */
export function readableWordCount(data) {
    return ((data && data.words) || []).filter(w => w.confidence >= 60 && /[A-Za-z0-9]{2,}/.test(w.text)).length;
}

/**
 * Whether a reading is weak enough to try the photo turned a quarter: under OCR_MIN_CONFIDENCE, or with fewer than
 * OCR_MIN_READABLE_WORDS readable words (the readings the gate would reject or mark to check; a sure short card is read
 * once). A card held the other way (portrait in a landscape frame, or the reverse) reads
 * as near nothing (raven575's Play 695 test, 2026-11-24: "It needs to work out which way the card is turned").
 */
export function shouldTryTurns(confidence, readableWords) {
    return confidence < OCR_MIN_CONFIDENCE || readableWords < OCR_MIN_READABLE_WORDS;
}

/** Whether a turned reading beats the upright one: at least 2 more readable words, and no less sure overall. */
export function turnedWins(first, turned) {
    return turned.readableWords >= first.readableWords + 2 && turned.confidence >= first.confidence;
}

/**
 * A box read on a picture turned `quarter` quarter-turns clockwise (1 or 3), put back on the upright picture
 * (`width` x `height`, the upright size), so the logo finder blanks the right spots (logoGuess.js).
 */
export function unturnBox(box, quarter, width, height) {
    if (quarter === 1) return { x0: box.y0, y0: height - box.x1, x1: box.y1, y1: height - box.x0 };
    if (quarter === 3) return { x0: width - box.y1, y0: box.x0, x1: width - box.y0, y1: box.x1 };
    return { ...box };
}

/** A prepared photo (data URL) turned `quarter` quarter-turns clockwise, as { image, width, height } of the upright one. */
function turnImage(imageSrc, quarter) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            try {
                const w = img.width, h = img.height, canvas = document.createElement('canvas');
                canvas.width = h; canvas.height = w;
                const ctx = canvas.getContext('2d');
                ctx.translate(h / 2, w / 2);
                ctx.rotate(quarter * Math.PI / 2);
                ctx.drawImage(img, -w / 2, -h / 2);
                resolve({ image: canvas.toDataURL('image/png'), width: w, height: h });
            } catch (err) { reject(err); }
        };
        img.onerror = (err) => reject(new Error(`Failed to load the photo to turn it: ${err}`));
        img.src = imageSrc;
    });
}

/**
 * The photo read turned a quarter each way when the upright reading is weak (shouldTryTurns); the best reading
 * (turnedWins) is returned with the picture it came from. Best effort: a failure keeps the upright reading; only a
 * wipe (OcrCancelledError) ends the scan. `quarter` is 0 when the upright reading stays.
 */
async function tryTurns(worker, processedImage, first, timeoutMs, started) {
    let best = { result: first, image: processedImage, quarter: 0, confidence: Math.round(first.data.confidence || 0), readableWords: readableWordCount(first.data) };
    if (!shouldTryTurns(best.confidence, best.readableWords)) return best;
    for (const quarter of [1, 3]) {
        try {
            const turned = await turnImage(processedImage, quarter);
            const result = await readWithin(worker, turned.image, timeoutMs);
            if (generation !== started) throw new OcrCancelledError();
            const next = { result, image: turned.image, quarter, width: turned.width, height: turned.height, confidence: Math.round(result.data.confidence || 0), readableWords: readableWordCount(result.data) };
            console.log(`[${MODULE_ID}] Turned ${quarter * 90}°: confidence ${next.confidence}, ${next.readableWords} readable words (best so far ${best.confidence}, ${best.readableWords})`);
            if (turnedWins(best, next)) best = next;
        } catch (error) {
            if (error instanceof OcrCancelledError) throw error;
            console.warn(`[${MODULE_ID}] Reading the photo turned ${quarter * 90}° stopped, kept the best so far:`, error);
            // A read past its time limit retired the worker: no more turns with it.
            if (error instanceof OcrTimeoutError) break;
        }
    }
    return best;
}

/** A crash inside the engine's WebAssembly (not a timeout, a cancel or a photo it could not read). */
export function isEngineCrash(error) {
    if (!error || error instanceof OcrTimeoutError || error instanceof OcrCancelledError || error instanceof OcrUnavailableError || error instanceof OcrStartFailedError) return false;
    return (typeof WebAssembly !== 'undefined' && WebAssembly.RuntimeError && error instanceof WebAssembly.RuntimeError)
        || /RuntimeError|memory access|unreachable|abort\(/i.test(`${error.name || ''} ${error.message || error}`);
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
            retire(worker);
        }
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

export const getModuleName = () => MODULE_NAME;
