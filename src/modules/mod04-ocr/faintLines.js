/**
 * vCard Generator Engine (vCGE)
 * Copyright (c) 2026 raven575, Herd of Helpers (claude) & gemini
 *
 * Repository: https://github.com/real-raven575/vCGE-Master
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * vCGE-MOD04: faint lines. Light grey lettering on white (a name printed in pale grey) can vanish when the reader turns
 * the photo black and white, so the line never reaches the review (the lab's real card photos, 2026-11-21: the name was
 * missing from 6 photos of 6). These helpers find bands of the prepared photo that hold faint ink no reading covers, so
 * the reader can read each one again as a strip with its own contrast. Plain arrays in, boxes out: no DOM, no engine.
 */

// Ink: a pixel at least this much darker (0-255) than the paper around it, where that paper is light (not a coloured band).
export const FAINT_INK_STEP = 16;
export const FAINT_PAPER_MIN = 150;
// A band: rows with ink outside every reading, between these shares of a usual line's height.
export const FAINT_BAND_MIN = 0.5;
export const FAINT_BAND_MAX = 2.5;
// At most this many bands are read again.
export const FAINT_MAX_BANDS = 4;

/** Box blur over `r` pixels either side, rows then columns. */
function boxBlur(src, w, h, r) {
    const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
    for (let y = 0; y < h; y++) {
        let sum = 0, count = 0;
        for (let x = -r; x < w + r; x++) {
            if (x + r < w) { sum += src[y * w + x + r]; count++; }
            if (x - r - 1 >= 0) { sum -= src[y * w + x - r - 1]; count--; }
            if (x >= 0 && x < w) tmp[y * w + x] = sum / count;
        }
    }
    for (let x = 0; x < w; x++) {
        let sum = 0, count = 0;
        for (let y = -r; y < h + r; y++) {
            if (y + r < h) { sum += tmp[(y + r) * w + x]; count++; }
            if (y - r - 1 >= 0) { sum -= tmp[(y - r - 1) * w + x]; count--; }
            if (y >= 0 && y < h) out[y * w + x] = sum / count;
        }
    }
    return out;
}

/**
 * The paper's brightness around every pixel (`gray`, w x h): the mean within `r` pixels. Text is sparse on a card, so
 * the mean sits near the paper; the lightest value would not, as a phone photo's paper is speckled with bright noise.
 */
export function paperLevel(gray, w, h, r) {
    return boxBlur(gray, w, h, r);
}

/**
 * Clears from `ink` (1 = ink, w x h, changed in place) every blob that is not letter-sized for lines `lh` px high: a
 * blade of grass, a stripe or a card edge is taller or wider than a letter, and a speck of noise is smaller.
 */
export function keepLetterSized(ink, w, h, lh) {
    const label = new Int32Array(w * h).fill(-1);
    const stack = new Int32Array(w * h);
    const minPixels = Math.max(3, Math.round(lh * lh * 0.004));
    for (let start = 0; start < ink.length; start++) {
        if (!ink[start] || label[start] >= 0) continue;
        let top = 0, count = 0, x0 = w, x1 = 0, y0 = h, y1 = 0;
        stack[top++] = start; label[start] = start;
        const members = [];
        while (top) {
            const i = stack[--top], x = i % w, y = (i - x) / w;
            members.push(i); count++;
            if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
            if (x > 0 && ink[i - 1] && label[i - 1] < 0) { label[i - 1] = start; stack[top++] = i - 1; }
            if (x < w - 1 && ink[i + 1] && label[i + 1] < 0) { label[i + 1] = start; stack[top++] = i + 1; }
            if (y > 0 && ink[i - w] && label[i - w] < 0) { label[i - w] = start; stack[top++] = i - w; }
            if (y < h - 1 && ink[i + w] && label[i + w] < 0) { label[i + w] = start; stack[top++] = i + w; }
        }
        if (y1 - y0 + 1 > lh * 1.6 || x1 - x0 + 1 > lh * 3 || count < minPixels) for (const i of members) ink[i] = 0;
    }
}

/** The middle value of `values` (numbers), or 0 for none. */
function median(values) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Bands of faint ink no reading covers. `gray` is the prepared photo (one value 0-255 per pixel, w x h), `boxes` the
 * reading's line boxes ({ x0, y0, x1, y1 }, any text) and `lineHeight` a usual text line's height in pixels. Returns at
 * most FAINT_MAX_BANDS boxes, top first, each around one run of ink on one band of rows.
 */
export function findFaintBands(gray, w, h, boxes, lineHeight) {
    const lh = Math.max(4, lineHeight || 0);
    if (!lineHeight || w < 8 || h < 8) return [];
    const paper = paperLevel(gray, w, h, Math.max(4, Math.round(lh * 1.5)));
    // Every reading's box, with room around it, is taken as covered; a box much taller than a line is the reader's
    // guess over a logo or a picture (one such box hid a pale name under it), so the ink under it is looked at too.
    const covered = new Uint8Array(w * h);
    for (const b of (boxes || []).filter(b => b.y1 - b.y0 <= lh * FAINT_BAND_MAX)) {
        const bh = Math.max(1, b.y1 - b.y0), padY = Math.round(bh * 0.1), padX = Math.round(bh * 0.3);
        for (let y = Math.max(0, b.y0 - padY); y < Math.min(h, b.y1 + padY); y++) covered.fill(1, y * w + Math.max(0, b.x0 - padX), y * w + Math.min(w, b.x1 + padX));
    }
    const ink = new Uint8Array(w * h);
    for (let i = 0; i < ink.length; i++) if (!covered[i] && paper[i] >= FAINT_PAPER_MIN && gray[i] <= paper[i] - FAINT_INK_STEP) ink[i] = 1;
    keepLetterSized(ink, w, h, lh);
    const rowInk = new Int32Array(h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rowInk[y] += ink[y * w + x];
    // Rows with ink, joined across gaps of 2 rows, kept when as tall as a line of text.
    const minRow = Math.max(4, Math.round(w * 0.004));
    const bands = [];
    for (let y = 0, start = -1, gap = 0; y <= h; y++) {
        const inky = y < h && rowInk[y] >= minRow;
        if (inky) { if (start < 0) start = y; gap = 0; continue; }
        if (start < 0) continue;
        if (++gap <= 2 && y < h) continue;
        const end = y - gap + 1;
        if (end - start >= lh * FAINT_BAND_MIN && end - start <= lh * FAINT_BAND_MAX) bands.push({ y0: start, y1: end });
        start = -1; gap = 0;
    }
    // Each band's widest run of ink columns, joined across gaps of one and a half line heights (the space between words).
    const out = [];
    for (const band of bands) {
        const colInk = new Int32Array(w);
        for (let y = band.y0; y < band.y1; y++) for (let x = 0; x < w; x++) colInk[x] += ink[y * w + x];
        let best = null;
        for (let x = 0, start = -1, gap = 0, mass = 0; x <= w; x++) {
            const inky = x < w && colInk[x] >= 2;
            if (inky) { if (start < 0) { start = x; mass = 0; } gap = 0; mass += colInk[x]; continue; }
            if (start < 0) continue;
            if (++gap <= lh * 1.5 && x < w) continue;
            const run = { x0: start, x1: x - gap + 1, mass };
            if (run.x1 - run.x0 >= lh * 1.5 && (!best || run.mass > best.mass)) best = run;
            start = -1; gap = 0;
        }
        if (best) out.push({ x0: best.x0, y0: band.y0, x1: best.x1, y1: band.y1, mass: best.mass });
    }
    return out.sort((a, b) => b.mass - a.mass).slice(0, FAINT_MAX_BANDS).sort((a, b) => a.y0 - b.y0).map(({ mass, ...box }) => box);
}

/** A usual line's height: the middle height of the reading's sure lines (confidence 60+), or 0 when there are none. */
export function usualLineHeight(lines) {
    return median((lines || []).filter(l => l && l.bbox && (l.confidence || 0) >= 60).map(l => l.bbox.y1 - l.bbox.y0));
}

/** Marks with no letters at either end of a strip's reading ("\\N ck Zafer" -> "N ck Zafer"). */
export function trimStripText(text) {
    return String(text || '').trim().split(/\s+/).filter(Boolean)
        .filter((t, i, all) => /[A-Za-z0-9]/.test(t) || (i > 0 && i < all.length - 1))
        .map(t => t.replace(/^[^A-Za-z0-9@(+]+|[^A-Za-z0-9).]+$/g, '')).filter(Boolean).join(' ');
}
