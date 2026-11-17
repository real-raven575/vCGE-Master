/**
 * vCGE-MOD04: the logo guess (raven575, 2026-11-16: "Glyph can save the logo that it guesses into a specific file that
 * Flipside can then specifically access, preferably in a higher resolution in color so that it is easier to make its
 * own contrast decisions to try to make the best logo").
 * Created by raven575, Herd of Helpers (claude) & gemini
 *
 * After a read, the finder (logoFinder.js) looks for the logo on a small copy of the straightened photo, with the
 * contact lines the reader is sure of blanked out. The best place, if it scores well enough, is cut out of the photo
 * itself: in colour, as it was photographed, up to LOGO_GUESS_MAX px on its long side, with a little of the card
 * around it. main.js puts it in the vault's logoGuess slot, which only the card screen reads; the card screen offers it
 * and makes its own trace and contrast choices when it is used. Nothing is stored.
 */
import { contactTextBoxes, findLogoCandidates } from './logoFinder.js';
import { readerScale } from './ocrWorker.js';

export const LOGO_GUESS_MIN_SCORE = 0.45;   // below this the best place is more likely a line of text than a logo
export const LOGO_GUESS_MAX = 1024;         // the cut-out's long side at most, in px (the card screen trims and scales it)
const FIND_SIDE = 640;                      // the finder works on a copy this long, which is plenty to place a logo
const PAD = 0.06;                           // card left around the logo, as a share of its long side

/**
 * The box to cut, in photo pixels, from a finder pick in finder pixels: scaled up, padded and kept on the photo.
 * @returns {{ x: number, y: number, w: number, h: number }}
 */
export function cutBox(pick, scale, width, height) {
    const pad = Math.round(Math.max(pick.w, pick.h) / scale * PAD);
    const x0 = Math.max(0, Math.floor(pick.x / scale) - pad), y0 = Math.max(0, Math.floor(pick.y / scale) - pad);
    const x1 = Math.min(width, Math.ceil((pick.x + pick.w) / scale) + pad), y1 = Math.min(height, Math.ceil((pick.y + pick.h) / scale) + pad);
    return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
}

function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('The photo could not be opened for the logo guess'));
        img.src = src;
    });
}

/**
 * The logo guess for one read: { image (PNG data URL, in colour), width, height, score, reasons, box (shares of the
 * photo) }, or null when nothing on the card looks enough like a logo.
 * @param {string} photoSrc  the straightened photo the reader read (data URL)
 * @param {{ text: string, confidence?: number, bbox: { x0: number, y0: number, x1: number, y1: number } }[]} boxes  the reader's line boxes
 */
export async function guessLogo(photoSrc, boxes = [], { minScore = LOGO_GUESS_MIN_SCORE, max = LOGO_GUESS_MAX } = {}) {
    if (!photoSrc) return null;
    const img = await loadImage(photoSrc);
    const width = img.naturalWidth || img.width, height = img.naturalHeight || img.height;
    if (!width || !height) return null;
    const scale = Math.min(1, FIND_SIDE / Math.max(width, height));
    const fw = Math.max(1, Math.round(width * scale)), fh = Math.max(1, Math.round(height * scale));
    const small = document.createElement('canvas');
    small.width = fw; small.height = fh;
    const sctx = small.getContext('2d', { willReadFrequently: true });
    sctx.drawImage(img, 0, 0, fw, fh);
    const px = sctx.getImageData(0, 0, fw, fh).data;
    // The reader's boxes are in its own pixels (the photo times readerScale); the finder's are the small copy's.
    const textBoxes = contactTextBoxes(boxes, scale / readerScale(Math.max(width, height)));
    const [best] = findLogoCandidates(px, fw, fh, { textBoxes, max: 1 });
    if (!best || best.score < minScore) return null;
    const cut = cutBox(best, scale, width, height);
    const out = Math.min(1, max / Math.max(cut.w, cut.h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(cut.w * out)); canvas.height = Math.max(1, Math.round(cut.h * out));
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, cut.x, cut.y, cut.w, cut.h, 0, 0, canvas.width, canvas.height);
    return {
        image: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height, score: best.score, reasons: best.reasons,
        box: { x: cut.x / width, y: cut.y / height, w: cut.w / width, h: cut.h / height }
    };
}
