/**
 * vCGE-MOD04: the logo finder (🦉 Glyph with 🦎 Flipside), moved from the lab's Paint Shop logo bench (vcge-lab
 * logo-bench/www/logoFinder.js, 2026-10-27) into the app: raven575, 2026-11-16 ("Glyph can save the logo that it guesses
 * into a specific file that Flipside can then specifically access").
 * Created by raven575, Herd of Helpers (claude) & gemini
 *
 * Pure functions, no page and no network: give it the card's pixels (RGBA, `w` x `h`) and the boxes of the lines the
 * reader read; it returns up to `max` places that look like the logo, best first, each with a score from 0 to 1 and
 * the reasons in plain words. logoGuess.js cuts the best one out of the photo for the card screen to offer.
 *
 * How: the card's own colour is its most common colour; everything far from it is ink. Contact lines that the
 * reader is sure of are blanked out; the rest is joined into blobs (a gap of about 1% of the card joins the letters of
 * a wordmark and the parts of a symbol) and every blob is scored on what logos usually are.
 */

// What a logo usually is. Weights add up to 1; the lab bench's results are what tune them (the same numbers as there).
export const LOGO_WEIGHTS = { tall: 0.30, colour: 0.25, size: 0.15, shape: 0.15, place: 0.10, solid: 0.05 };
export const INK_DISTANCE = 60;        // RGB distance (sum of the three channels) from the card colour that counts as ink
export const JOIN_GAP = 0.012;         // blobs closer than this share of the card's long side are one blob
export const MIN_INK = 0.0015;         // a blob with less ink than this share of the card is a speck
export const CONTACT_CONFIDENCE = 60;  // a line read at least this sure, and shaped like contact text, is text

/**
 * The card's own colour: the most common colour on the card (colours grouped in steps of 16), averaged within its
 * group. A coloured band along an edge does not fool it, as a border sample would be.
 */
export function backgroundOf(px, w, h) {
    const counts = new Uint32Array(4096), sums = new Float64Array(4096 * 3);
    for (let i = 0; i < w * h; i++) {
        const k = i * 4, bin = ((px[k] >> 4) << 8) | ((px[k + 1] >> 4) << 4) | (px[k + 2] >> 4);
        counts[bin]++; sums[bin * 3] += px[k]; sums[bin * 3 + 1] += px[k + 1]; sums[bin * 3 + 2] += px[k + 2];
    }
    let top = 0;
    for (let b = 1; b < 4096; b++) if (counts[b] > counts[top]) top = b;
    return counts[top] ? [0, 1, 2].map(c => Math.round(sums[top * 3 + c] / counts[top])) : [255, 255, 255];
}

/** 1 where a pixel is far from the card colour. */
export function inkMask(px, w, h, back, distance = INK_DISTANCE) {
    const mask = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
        const k = i * 4;
        if (Math.abs(px[k] - back[0]) + Math.abs(px[k + 1] - back[1]) + Math.abs(px[k + 2] - back[2]) > distance) mask[i] = 1;
    }
    return mask;
}

/**
 * Glyph's part: which of the reader's lines are contact text (not the logo). A line counts when the reader was sure of
 * it and it looks like a phone, email, web address, street address, or ordinary small print. A line that is much
 * taller than the card's usual line is kept as a possible wordmark, whatever it says.
 * @param {{ text: string, confidence?: number, bbox?: { x0: number, y0: number, x1: number, y1: number } }[]} lines
 * @param {number} scale  card pixels per reader pixel (the reader works on an enlarged copy)
 * @returns {{ x: number, y: number, w: number, h: number, text: string }[]}
 */
export function contactTextBoxes(lines, scale = 1) {
    const withBox = (lines || []).filter(l => l && l.bbox && l.text && l.text.trim());
    if (!withBox.length) return [];
    const heights = withBox.map(l => l.bbox.y1 - l.bbox.y0).sort((a, b) => a - b);
    const usual = heights[heights.length >> 1];
    const contactLike = /@|www\.|https?:|\.(com|net|org|io|co|us|uk|ca)\b|\d[\d\s().-]{5,}\d|\b(st|street|ave|avenue|rd|road|suite|ste|blvd|dr|drive|ln|lane|po box)\b/i;
    return withBox.filter(l => {
        const height = l.bbox.y1 - l.bbox.y0;
        if (height > usual * 1.6) return false;                       // big type: maybe a wordmark
        const sure = typeof l.confidence !== 'number' || l.confidence >= CONTACT_CONFIDENCE;
        return sure && (contactLike.test(l.text) || height <= usual * 1.15);
    }).map(l => ({ x: l.bbox.x0 * scale, y: l.bbox.y0 * scale, w: (l.bbox.x1 - l.bbox.x0) * scale, h: (l.bbox.y1 - l.bbox.y0) * scale, text: l.text }));
}

/** Grows the mask by `r` pixels in every direction (a square), so near neighbours touch. */
function dilate(mask, w, h, r) {
    if (r < 1) return mask;
    const rows = new Uint8Array(w * h), out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
        let run = -1;   // index of the last inked pixel seen in this row, left to right
        for (let x = 0; x < w; x++) { if (mask[y * w + x]) run = x; if (run >= 0 && x - run <= r) rows[y * w + x] = 1; }
        run = -1;
        for (let x = w - 1; x >= 0; x--) { if (mask[y * w + x]) run = x; if (run >= 0 && run - x <= r) rows[y * w + x] = 1; }
    }
    for (let x = 0; x < w; x++) {
        let run = -1;
        for (let y = 0; y < h; y++) { if (rows[y * w + x]) run = y; if (run >= 0 && y - run <= r) out[y * w + x] = 1; }
        run = -1;
        for (let y = h - 1; y >= 0; y--) { if (rows[y * w + x]) run = y; if (run >= 0 && run - y <= r) out[y * w + x] = 1; }
    }
    return out;
}

/**
 * The ink joined into blobs: each blob's box (around its own ink, not the joining gap), ink count and the colour
 * statistics the score needs.
 */
export function blobsOf(px, mask, w, h, gap) {
    const joined = dilate(mask, w, h, gap);
    const label = new Int32Array(w * h).fill(-1), queue = new Int32Array(w * h);
    const blobs = [];
    for (let start = 0; start < w * h; start++) {
        if (!joined[start] || label[start] >= 0) continue;
        const b = { x0: w, y0: h, x1: -1, y1: -1, ink: 0, sat: 0, rows: new Set() };
        const id = blobs.length;
        let head = 0, tail = 0;
        label[start] = id; queue[tail++] = start;
        while (head < tail) {
            const i = queue[head++], x = i % w, y = (i - x) / w;
            if (mask[i]) {
                b.ink++;
                if (x < b.x0) b.x0 = x; if (x > b.x1) b.x1 = x; if (y < b.y0) b.y0 = y; if (y > b.y1) b.y1 = y;
                const k = i * 4, max = Math.max(px[k], px[k + 1], px[k + 2]);
                b.sat += max ? (max - Math.min(px[k], px[k + 1], px[k + 2])) / max : 0;
            }
            const near = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
            for (const n of near) if (n >= 0 && joined[n] && label[n] < 0) { label[n] = id; queue[tail++] = n; }
        }
        if (b.ink) blobs.push(b);
    }
    return blobs.map(b => ({ x: b.x0, y: b.y0, w: b.x1 - b.x0 + 1, h: b.y1 - b.y0 + 1, ink: b.ink, saturation: b.sat / b.ink }));
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/**
 * Scores one blob from 0 to 1 and says why. `usual` is the card's usual line height in pixels (from the reader, or
 * the median blob height when the reader did not run).
 */
export function scoreBlob(blob, w, h, usual, weights = LOGO_WEIGHTS) {
    const area = (blob.w * blob.h) / (w * h);
    const aspect = blob.w / blob.h;
    const tallness = blob.h / Math.max(1, usual);
    const cx = (blob.x + blob.w / 2) / w, cy = (blob.y + blob.h / 2) / h;
    const parts = {
        tall: clamp01((tallness - 1) / 2),                                           // 3x the usual line or more: full marks
        colour: clamp01((blob.saturation - 0.1) / 0.4),                             // grey ink 0, a clear colour 1
        size: area < 0.004 ? 0 : area <= 0.25 ? clamp01(area / 0.03) : clamp01(1 - (area - 0.25) / 0.35),
        shape: aspect > 12 || aspect < 1 / 12 ? 0 : aspect > 6 || aspect < 1 / 4 ? 0.4 : 1,  // a rule or border is not a logo
        place: clamp01(1 - Math.min(cy, Math.abs(cx - 0.5) < 0.2 ? 1 : Math.min(cx, 1 - cx)) * 2.2),  // near the top or a side
        solid: clamp01(blob.ink / (blob.w * blob.h) / 0.5),
    };
    let score = 0;
    for (const k of Object.keys(weights)) score += weights[k] * parts[k];
    const reasons = [];
    if (parts.tall >= 0.5) reasons.push(`${tallness.toFixed(1)}x taller than the usual line`);
    if (parts.colour >= 0.5) reasons.push('in colour');
    if (parts.place >= 0.6) reasons.push(cy < 0.35 ? 'near the top' : 'near a side');
    if (parts.solid >= 0.8) reasons.push('solid shape');
    if (parts.shape === 0) reasons.push('a thin line, probably a rule or border');
    if (parts.size === 0) reasons.push(area < 0.004 ? 'very small' : 'covers most of the card');
    return { score: Math.round(score * 1000) / 1000, parts, reasons };
}

/**
 * Up to `max` likely logo boxes on the card, best first: [{ x, y, w, h, score, reasons }] in card pixels.
 * `textBoxes` (from contactTextBoxes) are blanked out first; with none, the finder still works on shapes and colour.
 */
export function findLogoCandidates(px, w, h, { textBoxes = [], max = 3, weights = LOGO_WEIGHTS } = {}) {
    const back = backgroundOf(px, w, h);
    const mask = inkMask(px, w, h, back);
    for (const t of textBoxes) {
        const pad = Math.round(t.h * 0.15);
        for (let y = Math.max(0, Math.floor(t.y - pad)); y < Math.min(h, Math.ceil(t.y + t.h + pad)); y++)
            mask.fill(0, y * w + Math.max(0, Math.floor(t.x - pad)), y * w + Math.min(w, Math.ceil(t.x + t.w + pad)));
    }
    const gap = Math.max(1, Math.round(Math.max(w, h) * JOIN_GAP));
    const blobs = blobsOf(px, mask, w, h, gap).filter(b => b.ink >= MIN_INK * w * h && !(b.w > 0.92 * w && b.h > 0.92 * h));
    if (!blobs.length) return [];
    const heights = textBoxes.length ? textBoxes.map(t => t.h) : blobs.map(b => b.h);
    heights.sort((a, b) => a - b);
    const usual = heights[heights.length >> 1];
    return blobs.map(b => ({ x: b.x, y: b.y, w: b.w, h: b.h, ...scoreBlob(b, w, h, usual, weights) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, max)
        .map(({ parts, ...c }) => c);
}

/** Overlap of two boxes (intersection over union), 0 to 1. */
export function overlap(a, b) {
    const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
    const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    const inter = ix * iy, union = a.w * a.h + b.w * b.h - inter;
    return union > 0 ? inter / union : 0;
}
