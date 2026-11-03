/**
 * vCard Generator Engine (vCGE)
 * Copyright (c) 2026 raven575, Team vCGE (Claude) & Gemini
 *
 * Repository: https://github.com/real-raven575/vCGE-Master
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * vCGE-MOD03: "Snap to card", the on-device card-edge finder (redesign step 5). Pure pixel maths, no library, no DOM.
 *
 * A business card in a photo is a bright (or dark) four-sided patch in the middle against a table or hand of another
 * shade around the edges. The finder works on a small copy of the photo: it reads the shade at the centre and the
 * shade along the border, splits the pixels between the two (by colour when the shades are too close), takes the patch connected to the centre, wraps it in
 * its convex hull, fits the tightest rotated rectangle around the hull and picks the hull points nearest that
 * rectangle's corners. A patch that is too small, runs off every edge, or is nothing like a card's shape gives null,
 * and the corners stay where they are. It runs when the person presses Snap to card, and on a small copy of the live
 * picture while the camera is open, so the viewfinder's corners can turn green when a card is in them (camera.js).
 */

export const SMALL_SIDE = 240;         // the photo is read at this many pixels along its longer side
export const MIN_CONTRAST = 20;        // centre and border shades must differ by this much (0 to 255)
export const MIN_AREA = 0.02;          // the patch must cover this share of the photo (2%: a card shot from farther away; 12% missed 3 of 6 on the edge bench)
export const ASPECT_RANGE = [1.15, 2.6]; // long side over short side allowed for a card seen in perspective (3.5 : 2 = 1.75)

/** The card's four corners in the photo's own pixels, ordered top-left, top-right, bottom-right, bottom-left, or null. */
export function findCardQuad(image) {
    const { data, width, height } = image;
    if (!data || !(width > 2) || !(height > 2)) return null;
    const step = Math.max(1, Math.ceil(Math.max(width, height) / SMALL_SIDE));
    const w = Math.floor(width / step), h = Math.floor(height / step);
    if (w < 8 || h < 8) return null;

    // The small copy's colours (nearest sample, no smoothing needed at this size)
    const rgb = new Float32Array(w * h * 3);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const o = ((y * step) * width + x * step) * 4, i = (y * w + x) * 3;
            rgb[i] = data[o]; rgb[i + 1] = data[o + 1]; rgb[i + 2] = data[o + 2];
        }
    }
    // The centre box (15 percent each way) and the border ring (4 percent in)
    const bx0 = Math.floor(w * 0.425), bx1 = Math.ceil(w * 0.575), by0 = Math.floor(h * 0.425), by1 = Math.ceil(h * 0.575);
    const ring = Math.max(1, Math.round(Math.min(w, h) * 0.04));
    const centreIdx = [], borderIdx = [];
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            if (x >= bx0 && x < bx1 && y >= by0 && y < by1) centreIdx.push(y * w + x);
            if (x < ring || y < ring || x >= w - ring || y >= h - ring) borderIdx.push(y * w + x);
        }
    }
    const small = { rgb, w, h, centreIdx, borderIdx };
    // Shade first (a white card on a dark table, a dark card on a light one). When the shades are too close, as for a
    // white card on a sunlit beige counter (raven575's first phone run of 0.8, 2026-11-03), try colour.
    for (const makeSplit of [shadeSplit, colourSplit]) {
        const split = makeSplit(small);
        if (!split) continue;
        const quad = quadFromSplit(small, split, image, step);
        if (quad) return quad;
    }
    return null;
}

const luma = (r, g, b) => (r * 299 + g * 587 + b * 114) / 1000;

/** Card pixels by brightness: halfway between the centre's mean shade and the border's. Null below MIN_CONTRAST. */
export function shadeSplit({ rgb, centreIdx, borderIdx }) {
    const mean = (idx) => idx.reduce((s, i) => s + luma(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]), 0) / idx.length;
    const centre = mean(centreIdx), border = mean(borderIdx);
    if (Math.abs(centre - border) < MIN_CONTRAST) return null;
    const threshold = (centre + border) / 2, bright = centre > border;
    return (r, g, b) => (bright ? luma(r, g, b) >= threshold : luma(r, g, b) <= threshold);
}

export const MIN_COLOUR_SEPARATION = 0.6;   // centre and border must sit this many of the border's own spreads apart

/**
 * Card pixels by colour: the one direction in RGB along which the centre stands furthest from the border, counted in
 * the border's own spread (a linear discriminant). A table's shadows and glare change its brightness a lot but its
 * hue only a little, so a white card on a beige counter of the same brightness still stands out along "less yellow".
 * Medians keep the card's printing and a strip of something else at the photo's edge from moving the two reference
 * colours. Null when the two colours are not far enough apart.
 */
export function colourSplit({ rgb, centreIdx, borderIdx }) {
    const median = (idx, k) => { const v = idx.map(i => rgb[i * 3 + k]).sort((a, b) => a - b); return v[v.length >> 1]; };
    const c = [0, 1, 2].map(k => median(centreIdx, k)), b = [0, 1, 2].map(k => median(borderIdx, k));
    const mu = [0, 0, 0];
    for (const i of borderIdx) for (let k = 0; k < 3; k++) mu[k] += rgb[i * 3 + k] / borderIdx.length;
    const S = [[25, 0, 0], [0, 25, 0], [0, 0, 25]];   // a little sensor noise, so a perfectly flat border still inverts
    for (const i of borderIdx) {
        const d = [rgb[i * 3] - mu[0], rgb[i * 3 + 1] - mu[1], rgb[i * 3 + 2] - mu[2]];
        for (let r = 0; r < 3; r++) for (let q = 0; q < 3; q++) S[r][q] += d[r] * d[q] / borderIdx.length;
    }
    const diff = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
    const dir = solve3(S, diff);
    if (!dir) return null;
    const spread = Math.sqrt(dir[0] * diff[0] + dir[1] * diff[1] + dir[2] * diff[2]);   // = separation in border spreads
    if (!(spread >= MIN_COLOUR_SEPARATION)) return null;
    const project = (r, g, bl) => r * dir[0] + g * dir[1] + bl * dir[2];
    const threshold = (project(c[0], c[1], c[2]) + project(b[0], b[1], b[2])) / 2;
    return (r, g, bl) => project(r, g, bl) >= threshold;
}

/** Solves the 3 x 3 system S x = v (Cramer's rule); null when S is singular. */
export function solve3(S, v) {
    const det3 = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    const d = det3(S);
    if (!(Math.abs(d) > 1e-9)) return null;
    return [0, 1, 2].map(k => det3(S.map((row, r) => row.map((x, q) => (q === k ? v[r] : x)))) / d);
}

// The patch of card pixels connected to the centre, wrapped in its hull and fitted with a rotated rectangle.
function quadFromSplit({ rgb, w, h }, isCardRGB, image, step) {
    const { width, height } = image;
    const isCard = (i) => isCardRGB(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]);

    // The patch connected to the centre (4-connected flood fill from the card pixel nearest the centre)
    const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
    let seed = -1;
    for (let r = 0; r < Math.min(w, h) / 2 && seed < 0; r++) {
        for (let dy = -r; dy <= r && seed < 0; dy++) {
            for (let dx = -r; dx <= r; dx++) {
                const x = cx + dx, y = cy + dy;
                if (x < 0 || y < 0 || x >= w || y >= h) continue;
                if (isCard(y * w + x)) { seed = y * w + x; break; }
            }
        }
    }
    if (seed < 0) return null;
    const inPatch = new Uint8Array(w * h);
    const queue = new Int32Array(w * h);
    let head = 0, tail = 0, count = 0;
    queue[tail++] = seed; inPatch[seed] = 1;
    let touchLeft = 0, touchRight = 0, touchTop = 0, touchBottom = 0;
    const points = [];
    while (head < tail) {
        const i = queue[head++];
        const x = i % w, y = (i - x) / w;
        count++;
        if (x === 0) touchLeft++; if (x === w - 1) touchRight++; if (y === 0) touchTop++; if (y === h - 1) touchBottom++;
        // Only edge pixels of the patch go into the hull (a pixel with a non-card neighbour or on the photo's edge)
        let edge = x === 0 || y === 0 || x === w - 1 || y === h - 1;
        const tryPush = (j) => { if (!inPatch[j] && isCard(j)) { inPatch[j] = 1; queue[tail++] = j; } else if (!isCard(j)) edge = true; };
        if (x > 0) tryPush(i - 1);
        if (x < w - 1) tryPush(i + 1);
        if (y > 0) tryPush(i - w);
        if (y < h - 1) tryPush(i + w);
        if (edge) points.push([x + 0.5, y + 0.5]);
    }
    if (count < MIN_AREA * w * h) return null;
    // Running off all four sides means the photo already is the card (or the split found nothing): no edges to snap to
    if (touchLeft > h * 0.5 && touchRight > h * 0.5 && touchTop > w * 0.5 && touchBottom > w * 0.5) return null;

    const hull = convexHull(points);
    if (hull.length < 4) return null;
    const corners = rectangleCorners(hull);
    if (!corners) return null;
    const quad = orderCorners(corners.map(([x, y]) => ({ x: x * step, y: y * step })));
    const sides = [0, 1, 2, 3].map(i => Math.hypot(quad[(i + 1) % 4].x - quad[i].x, quad[(i + 1) % 4].y - quad[i].y));
    const longSide = Math.max(sides[0], sides[1], sides[2], sides[3]), shortSide = Math.min(sides[0], sides[1], sides[2], sides[3]);
    if (!(shortSide > 0)) return null;
    const aspect = longSide / shortSide;
    if (aspect < ASPECT_RANGE[0] || aspect > ASPECT_RANGE[1]) return null;
    if (polygonArea(quad) < MIN_AREA * width * height) return null;
    return refineCorners(quad, image, step, isCardRGB);
}

// Each corner found on the small copy is within one sample step of the true one: at full size, the card pixel in
// that neighbourhood that sticks out furthest away from the card's centre is the corner.
function refineCorners(quad, { data, width, height }, step, isCardRGB) {
    const cx = quad.reduce((s, p) => s + p.x, 0) / 4, cy = quad.reduce((s, p) => s + p.y, 0) / 4;
    const reach = step + 2;
    return quad.map(c => {
        const len = Math.hypot(c.x - cx, c.y - cy) || 1, dx = (c.x - cx) / len, dy = (c.y - cy) / len;
        let best = { x: c.x, y: c.y }, bestScore = -Infinity;
        for (let y = Math.max(0, Math.round(c.y) - reach); y <= Math.min(height - 1, Math.round(c.y) + reach); y++) {
            for (let x = Math.max(0, Math.round(c.x) - reach); x <= Math.min(width - 1, Math.round(c.x) + reach); x++) {
                const o = (y * width + x) * 4;
                if (!isCardRGB(data[o], data[o + 1], data[o + 2])) continue;
                const score = (x + 0.5 - c.x) * dx + (y + 0.5 - c.y) * dy;
                if (score > bestScore) { bestScore = score; best = { x: x + 0.5, y: y + 0.5 }; }
            }
        }
        return { x: Math.max(0, Math.min(width, Math.round(best.x))), y: Math.max(0, Math.min(height, Math.round(best.y))) };
    });
}

/** Andrew's monotone chain: the convex hull of [x, y] points, counter-clockwise. */
export function convexHull(points) {
    const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (pts.length < 3) return pts;
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [];
    for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
    const upper = [];
    for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
    lower.pop(); upper.pop();
    return lower.concat(upper);
}

/**
 * The four hull points nearest the corners of the smallest rotated rectangle around the hull (one rectangle side lies
 * along a hull edge). Null when the hull is degenerate.
 */
export function rectangleCorners(hull) {
    let best = null;
    for (let i = 0; i < hull.length; i++) {
        const a = hull[i], b = hull[(i + 1) % hull.length];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len < 1e-6) continue;
        const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len;     // along the edge, and its normal (-uy, ux)
        let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
        for (const [x, y] of hull) {
            const u = x * ux + y * uy, v = -x * uy + y * ux;
            if (u < minU) minU = u; if (u > maxU) maxU = u; if (v < minV) minV = v; if (v > maxV) maxV = v;
        }
        const area = (maxU - minU) * (maxV - minV);
        if (!best || area < best.area) best = { area, ux, uy, minU, maxU, minV, maxV };
    }
    if (!best || !(best.area > 0)) return null;
    const { ux, uy, minU, maxU, minV, maxV } = best;
    const toXY = (u, v) => [u * ux - v * uy, u * uy + v * ux];
    const rect = [toXY(minU, minV), toXY(maxU, minV), toXY(maxU, maxV), toXY(minU, maxV)];
    const used = new Set();
    const picks = rect.map(([rx, ry]) => {
        let pick = null, dist = Infinity;
        hull.forEach((p, k) => { if (used.has(k)) return; const d = Math.hypot(p[0] - rx, p[1] - ry); if (d < dist) { dist = d; pick = k; } });
        used.add(pick);
        return { point: hull[pick], dist };
    });
    return picks.map((p, k) => (isCutCorner(picks.map(q => q.dist), k, rect) ? rect[k] : p.point));
}

/**
 * True when corner k of the patch is missing: its nearest hull point lies far inside the rectangle while the other
 * three sit on theirs. A card printed with a dark or coloured band across one corner (a diagonal stripe) loses that
 * corner from the patch; the rectangle around the rest of the card still reaches it, so the rectangle's corner is used.
 */
export function isCutCorner(dists, k, rect) {
    const others = dists.filter((_, i) => i !== k).sort((a, b) => a - b);
    const diag = Math.hypot(rect[2][0] - rect[0][0], rect[2][1] - rect[0][1]);
    return dists[k] > Math.max(4 * others[1], 0.04 * diag) && others[2] < 0.04 * diag;
}

/** Corners in the crop editor's order: top-left, top-right, bottom-right, bottom-left (clockwise on screen). */
export function orderCorners(points) {
    const cx = points.reduce((s, p) => s + p.x, 0) / points.length, cy = points.reduce((s, p) => s + p.y, 0) / points.length;
    const sorted = points.slice().sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));   // clockwise with y down
    let start = 0;
    sorted.forEach((p, i) => { if (p.x + p.y < sorted[start].x + sorted[start].y) start = i; });
    return sorted.slice(start).concat(sorted.slice(0, start));
}

export function polygonArea(quad) {
    let a = 0;
    for (let i = 0; i < quad.length; i++) { const p = quad[i], q = quad[(i + 1) % quad.length]; a += p.x * q.y - q.x * p.y; }
    return Math.abs(a) / 2;
}
