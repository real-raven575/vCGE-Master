/**
 * vCard Generator Engine (vCGE)
 * Copyright (c) 2026 raven575, Herd of Helpers (claude) & gemini
 *
 * Repository: https://github.com/real-raven575/vCGE-Master
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * vCGE-MOD04: colour bands (HQ-0427, the Herd's ideas for Glyph, 2026-11-27). The reader sees the photo in grey only
 * (30% red, 59% green, 11% blue), so lettering on a coloured band can vanish when its colour is as bright as the band's
 * (red on blue: both turn the same grey), and light lettering on a dark band reads as a negative. These helpers find
 * wide bands of colour that no reading covers, and turn one band into a strip the reader can see: the one colour
 * channel (red, green or blue) where its lettering stands out most, flipped so the lettering is dark on light.
 * Plain arrays in, boxes and pixels out: no DOM, no engine.
 */

// A pixel is off the paper when one of its channels is this far (0-255) from the paper's colour.
export const BAND_COLOUR_STEP = 40;
// A row is part of a band when at least this share of its width is off the paper.
export const BAND_ROW_SHARE = 0.5;
// A band is at least this many usual line heights tall, and at most this share of the photo's height.
export const BAND_MIN_LINES = 0.8;
export const BAND_MAX_SHARE = 0.6;
// At most this many bands are read again.
export const BAND_MAX = 3;

/** The paper's colour: the most common colour of `rgba` (w x h), counted in steps of 16 per channel. */
export function paperColour(rgba, w, h) {
    const counts = new Map();
    const step = Math.max(1, Math.floor((w * h) / 40000));
    for (let i = 0; i < w * h; i += step) {
        const k = ((rgba[i * 4] >> 4) << 8) | ((rgba[i * 4 + 1] >> 4) << 4) | (rgba[i * 4 + 2] >> 4);
        counts.set(k, (counts.get(k) || 0) + 1);
    }
    let best = 0, bestN = -1;
    for (const [k, n] of counts) if (n > bestN) { best = k; bestN = n; }
    return [((best >> 8) & 15) * 16 + 8, ((best >> 4) & 15) * 16 + 8, (best & 15) * 16 + 8];
}

/**
 * Wide bands of colour no reading covers: [{ x0, y0, x1, y1 }] in the photo's pixels, top first. `rgba` is the colour
 * photo at the reader's size, `boxes` the reading's line boxes there and `lineHeight` a usual line's height.
 */
export function findColourBands(rgba, w, h, boxes, lineHeight) {
    if (!lineHeight || w < 8 || h < 8) return [];
    const paper = paperColour(rgba, w, h);
    const rowOff = new Int32Array(h);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            if (Math.abs(rgba[i] - paper[0]) >= BAND_COLOUR_STEP || Math.abs(rgba[i + 1] - paper[1]) >= BAND_COLOUR_STEP
                || Math.abs(rgba[i + 2] - paper[2]) >= BAND_COLOUR_STEP) rowOff[y]++;
        }
    }
    const bands = [];
    for (let y = 0, start = -1; y <= h; y++) {
        const on = y < h && rowOff[y] >= w * BAND_ROW_SHARE;
        if (on) { if (start < 0) start = y; continue; }
        if (start < 0) continue;
        if (y - start >= lineHeight * BAND_MIN_LINES && y - start <= h * BAND_MAX_SHARE) bands.push({ x0: 0, y0: start, x1: w, y1: y });
        start = -1;
    }
    // A band holding the middle of a line the reader already read is one it could see.
    const seen = (b) => (boxes || []).some(l => { const mid = (l.y0 + l.y1) / 2; return mid >= b.y0 && mid <= b.y1; });
    return bands.filter(b => !seen(b)).slice(0, BAND_MAX);
}

/**
 * One band of `rgba` (w x h) as grey lettering-dark-on-light: the channel with the widest spread inside the band
 * (2nd to 98th percentile), stretched to full range, and flipped when the band's own colour (its middle value) is
 * darker than mid-grey. Returns { gray, width, height, channel, flipped }.
 */
export function bandStrip(rgba, w, box) {
    const width = box.x1 - box.x0, height = box.y1 - box.y0;
    const spread = (c) => {
        const v = new Uint8Array(width * height);
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) v[y * width + x] = rgba[((box.y0 + y) * w + box.x0 + x) * 4 + c];
        const s = Uint8Array.from(v).sort();
        const lo = s[Math.floor(s.length * 0.02)], hi = s[Math.floor(s.length * 0.98)], mid = s[Math.floor(s.length * 0.5)];
        return { v, lo, hi, mid, spread: hi - lo };
    };
    let best = null, channel = 0;
    for (let c = 0; c < 3; c++) { const s = spread(c); if (!best || s.spread > best.spread) { best = s; channel = c; } }
    const flipped = best.mid < 128;
    const k = best.spread > 4 ? 255 / best.spread : 1;
    const gray = new Uint8Array(width * height);
    for (let i = 0; i < gray.length; i++) {
        const v = Math.max(0, Math.min(255, Math.round((best.v[i] - best.lo) * k)));
        gray[i] = flipped ? 255 - v : v;
    }
    return { gray, width, height, channel: 'RGB'[channel], flipped };
}
