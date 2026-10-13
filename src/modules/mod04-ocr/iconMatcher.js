/**
 * vCard Generator Engine (vCGE)
 * Copyright (c) 2026 raven575, Gemini & Claude
 *
 * Repository: https://github.com/real-raven575/vCGE-Master
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * vCGE-MOD04: icon matching for business-card lines (pure functions, no DOM, unit-tested in Node).
 * An icon is cut out of a greyscale image, normalised to a 32x32 shape and described by histograms of edge
 * orientation (HOG) over overlapping 8 px and 16 px cells, which depend on the outline's shape far more than on stroke
 * weight or fill. Shapes are compared by cosine similarity with template shapes.
 */

export const ICON_SIZE = 32;

/** Pixels darker than `threshold` in a region of a greyscale buffer -> Uint8Array mask (1 = ink). */
export function inkMask(gray, width, region, threshold = 128) {
    const { x0, y0, x1, y1 } = region;
    const w = x1 - x0, h = y1 - y0;
    const mask = new Uint8Array(Math.max(0, w * h));
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) mask[y * w + x] = gray[(y0 + y) * width + x0 + x] < threshold ? 1 : 0;
    return { mask, width: w, height: h };
}

/** 8-connected components of a mask: [{ x0, y0, x1, y1, area }] (x1/y1 exclusive). */
export function connectedComponents({ mask, width, height }) {
    const label = new Int32Array(width * height);
    const out = [];
    const stack = [];
    for (let start = 0; start < mask.length; start++) {
        if (!mask[start] || label[start]) continue;
        const c = { x0: width, y0: height, x1: 0, y1: 0, area: 0 };
        label[start] = out.length + 1;
        stack.push(start);
        while (stack.length) {
            const i = stack.pop(), x = i % width, y = (i - x) / width;
            c.area++;
            if (x < c.x0) c.x0 = x; if (y < c.y0) c.y0 = y;
            if (x + 1 > c.x1) c.x1 = x + 1; if (y + 1 > c.y1) c.y1 = y + 1;
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
                const nx = x + dx, ny = y + dy;
                if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
                const j = ny * width + nx;
                if (mask[j] && !label[j]) { label[j] = out.length + 1; stack.push(j); }
            }
        }
        out.push(c);
    }
    return out;
}

/** Union bounding box of components. */
export function unionBox(components) {
    return components.reduce((b, c) => ({ x0: Math.min(b.x0, c.x0), y0: Math.min(b.y0, c.y0), x1: Math.max(b.x1, c.x1), y1: Math.max(b.y1, c.y1) }),
        { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
}

/**
 * Crops `box` out of a mask and scales it, aspect ratio kept and centred, into an ICON_SIZE x ICON_SIZE float grid
 * (area-averaged ink coverage 0..1).
 */
export function normaliseShape({ mask, width }, box) {
    const n = ICON_SIZE, bw = box.x1 - box.x0, bh = box.y1 - box.y0;
    const scale = (n - 2) / Math.max(bw, bh);
    const ox = (n - bw * scale) / 2, oy = (n - bh * scale) / 2;
    const grid = new Float32Array(n * n), weight = new Float32Array(n * n);
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
        const gx = Math.min(n - 1, Math.floor(ox + (x + 0.5) * scale)), gy = Math.min(n - 1, Math.floor(oy + (y + 0.5) * scale));
        grid[gy * n + gx] += mask[(box.y0 + y) * width + box.x0 + x];
        weight[gy * n + gx] += 1;
    }
    for (let i = 0; i < grid.length; i++) if (weight[i]) grid[i] /= weight[i];
    // Shapes smaller than the grid (upscaling) leave gaps between sampled cells: fill them from their neighbours.
    if (scale > 1) {
        const filled = Float32Array.from(grid);
        for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
            if (weight[y * n + x]) continue;
            let sum = 0, cnt = 0;
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
                const nx = x + dx, ny = y + dy;
                if (nx >= 0 && ny >= 0 && nx < n && ny < n && weight[ny * n + nx]) { sum += grid[ny * n + nx]; cnt++; }
            }
            if (cnt) filled[y * n + x] = sum / cnt;
        }
        return filled;
    }
    return grid;
}

/** `passes` rounds of a 3x3 box blur on an ICON_SIZE grid. */
function blur(grid, passes) {
    const n = ICON_SIZE;
    let a = grid;
    for (let p = 0; p < passes; p++) {
        const b = new Float32Array(n * n);
        for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
            let sum = 0, cnt = 0;
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
                const nx = x + dx, ny = y + dy;
                if (nx >= 0 && ny >= 0 && nx < n && ny < n) { sum += a[ny * n + nx]; cnt++; }
            }
            b[y * n + x] = sum / cnt;
        }
        a = b;
    }
    return a;
}

/**
 * Histogram of oriented gradients of a (blurred) grid: Sobel gradients, unsigned orientation in 9 bins, cells of
 * `cell` px overlapping by half; optionally each cell normalised on its own; the whole vector has unit length.
 */
export function orientationHistogram(grid, { cell, perCell = false, blurPasses = 2, bins = 9 }) {
    const n = ICON_SIZE, g = blur(grid, blurPasses);
    const at = (x, y) => g[Math.min(n - 1, Math.max(0, y)) * n + Math.min(n - 1, Math.max(0, x))];
    const mag = new Float32Array(n * n), bin = new Uint8Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const gx = at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1);
        const gy = at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1);
        mag[y * n + x] = Math.hypot(gx, gy);
        let a = Math.atan2(gy, gx);
        if (a < 0) a += Math.PI;
        bin[y * n + x] = Math.min(bins - 1, Math.floor(a / Math.PI * bins));
    }
    const out = [], stride = cell / 2;
    for (let cy = 0; cy + cell <= n; cy += stride) for (let cx = 0; cx + cell <= n; cx += stride) {
        const h = new Float32Array(bins);
        for (let y = cy; y < cy + cell; y++) for (let x = cx; x < cx + cell; x++) h[bin[y * n + x]] += mag[y * n + x];
        if (perCell) {
            let s2 = 0;
            for (const v of h) s2 += v * v;
            const d = Math.sqrt(s2) + 1e-3;
            for (let i = 0; i < bins; i++) h[i] /= d;
        }
        out.push(...h);
    }
    const f = Float32Array.from(out);
    let norm = 0;
    for (const v of f) norm += v * v;
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < f.length; i++) f[i] /= norm;
    return f;
}

/** Shape descriptor of the ink inside `box`: orientation histograms at two cell sizes. */
export function describeShape(ink, box) {
    const grid = normaliseShape(ink, box);
    return [orientationHistogram(grid, { cell: 8, perCell: true }), orientationHistogram(grid, { cell: 16 })];
}

/** Similarity of two descriptors (mean cosine over the two histograms). */
export function similarity(a, b) {
    return (correlation(a[0], b[0]) + correlation(a[1], b[1])) / 2;
}

/** Normalised cross-correlation of two feature vectors (-1..1). */
export function correlation(a, b) {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i] * b[i];
    return s;
}

/**
 * Best-matching icon class for a shape descriptor. `templates` is [{ cls, descriptor }] (several variants per class).
 * Returns { cls, score, margin } where margin is the lead over the best other class; cls is null when the best score
 * is below `minScore` or the lead is below `minMargin`.
 */
export function classifyShape(descriptor, templates, { minScore, minMargin } = { minScore: 0.6, minMargin: 0.05 }) {
    const best = new Map();
    for (const t of templates) {
        const s = similarity(descriptor, t.descriptor);
        if (!best.has(t.cls) || s > best.get(t.cls)) best.set(t.cls, s);
    }
    const ranked = [...best.entries()].sort((a, b) => b[1] - a[1]);
    if (!ranked.length) return { cls: null, score: 0, margin: 0, ranked };
    const [cls, score] = ranked[0];
    const margin = score - (ranked[1] ? ranked[1][1] : -1);
    return { cls: score >= minScore && margin >= minMargin ? cls : null, score, margin, ranked };
}
