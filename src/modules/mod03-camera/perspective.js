/**
 * vCard Generator Engine (vCGE)
 * Copyright (c) 2026 raven575, Gemini & Claude
 *
 * Repository: https://github.com/real-raven575/vCGE-Master
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * vCGE-MOD03: perspective correction for card photos.
 * Pure functions on plain pixel buffers (no DOM), so they run in Node tests as well as in the browser.
 * Quadrilaterals are four points in the order top-left, top-right, bottom-right, bottom-left.
 */

const MAX_OUTPUT_SIDE = 2400;

/**
 * 3x3 homography (row-major, h[8] = 1) that maps each point of `from` onto the matching point of `to`.
 * Solves the standard 8x8 linear system with Gaussian elimination and partial pivoting.
 */
export function computeHomography(from, to) {
    const a = [];
    for (let i = 0; i < 4; i++) {
        const { x, y } = from[i], { x: u, y: v } = to[i];
        a.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
        a.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
    }
    for (let col = 0; col < 8; col++) {
        let pivot = col;
        for (let row = col + 1; row < 8; row++) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
        if (Math.abs(a[pivot][col]) < 1e-12) throw new Error('Corners do not form a usable shape');
        [a[col], a[pivot]] = [a[pivot], a[col]];
        for (let row = 0; row < 8; row++) {
            if (row === col) continue;
            const f = a[row][col] / a[col][col];
            for (let k = col; k < 9; k++) a[row][k] -= f * a[col][k];
        }
    }
    const h = a.map((row, i) => row[8] / row[i]);
    h.push(1);
    return h;
}

export function applyHomography(h, x, y) {
    const w = h[6] * x + h[7] * y + h[8];
    return { x: (h[0] * x + h[1] * y + h[2]) / w, y: (h[3] * x + h[4] * y + h[5]) / w };
}

const distance = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);

/** Output size for a flattened quad: the longer of each pair of opposite edges, capped at 2400 px on the long side. */
export function quadOutputSize(quad) {
    let width = Math.max(distance(quad[0], quad[1]), distance(quad[3], quad[2]));
    let height = Math.max(distance(quad[0], quad[3]), distance(quad[1], quad[2]));
    const scale = Math.min(1, MAX_OUTPUT_SIDE / Math.max(width, height, 1));
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));
    return { width, height };
}

/**
 * Flattens the area inside `quad` of an RGBA image ({ data, width, height }) into a width x height rectangle.
 * Each output pixel is mapped back into the source and sampled bilinearly; points outside the source read as white.
 */
export function warpPerspective(src, quad, width, height) {
    const out = new Uint8ClampedArray(width * height * 4);
    const rect = [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }];
    const h = computeHomography(rect, quad);
    const { data, width: sw, height: sh } = src;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const p = applyHomography(h, x + 0.5, y + 0.5);
            const fx = p.x - 0.5, fy = p.y - 0.5;
            const x0 = Math.floor(fx), y0 = Math.floor(fy);
            const tx = fx - x0, ty = fy - y0;
            const o = (y * width + x) * 4;
            // Offsets of the four neighbouring source pixels (-1 = outside the image, read as white).
            const inX0 = x0 >= 0 && x0 < sw, inX1 = x0 + 1 >= 0 && x0 + 1 < sw;
            const inY0 = y0 >= 0 && y0 < sh, inY1 = y0 + 1 >= 0 && y0 + 1 < sh;
            const i00 = inX0 && inY0 ? (y0 * sw + x0) * 4 : -1, i10 = inX1 && inY0 ? (y0 * sw + x0 + 1) * 4 : -1;
            const i01 = inX0 && inY1 ? ((y0 + 1) * sw + x0) * 4 : -1, i11 = inX1 && inY1 ? ((y0 + 1) * sw + x0 + 1) * 4 : -1;
            for (let c = 0; c < 4; c++) {
                const top = (i00 < 0 ? 255 : data[i00 + c]) * (1 - tx) + (i10 < 0 ? 255 : data[i10 + c]) * tx;
                const bottom = (i01 < 0 ? 255 : data[i01 + c]) * (1 - tx) + (i11 < 0 ? 255 : data[i11 + c]) * tx;
                out[o + c] = Math.round(top * (1 - ty) + bottom * ty);
            }
        }
    }
    return { data: out, width, height };
}
