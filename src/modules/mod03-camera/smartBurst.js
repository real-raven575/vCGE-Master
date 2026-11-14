/**
 * vCard Generator Engine (vCGE)
 * Copyright (c) 2026 raven575, Herd of Helpers (claude) & gemini
 *
 * Repository: https://github.com/real-raven575/vCGE-Master
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * vCGE-MOD03 Smart burst (🐈 Iris): the maths behind the shutter. Pure functions, no DOM, unit-tested in Node.
 *
 * One press of the shutter watches the camera for BURST_MS instead of taking one frame. Each frame is scored on a small
 * copy (sharp letter edges up, blown-out shine down), the best KEEP are held at full size, and the sharpest one becomes
 * the photo. Only when that frame shows shine are the kept frames lined up and blended pixel by pixel (the median), so
 * shine that moves between frames drops out; the blend softens text a little, so a clean frame is never blended.
 * Ported from the lab measure page (vcge-lab smart-burst, CAM-0028, phone runs 11-11 and 11-12). Everything stays in
 * memory and is cleared when the shot is made, like the single-frame shot before it.
 */

// How long one press watches the camera, and the size frames are scored at (the lab runs: 720p at 30 fps holds every frame)
export const BURST_MS = 900;
export const SCORE_WIDTH = 320;
// The best frame is blended with the others only with at least this much shine on it, and only when this many line up
export const BLEND_GLARE = 0.005;
export const BLEND_MIN = 3;

// A pixel counts as glare when all three channels are at or above this (blown-out white shine).
export const GLARE_LEVEL = 250;
// Glare costs a frame this much: 10% of the card blown out halves its score.
export const GLARE_WEIGHT = 5;
// How many frames the burst keeps at full size (each is one copy of the card window, freed once the shot is made).
export const KEEP = 4;

/** Luma (0-255) of every pixel in an RGBA buffer. */
export function toLuma(rgba, w, h) {
    const out = new Float32Array(w * h);
    for (let i = 0, p = 0; p < out.length; i += 4, p++) {
        out[p] = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
    }
    return out;
}

/** Sharpness = variance of the 4-neighbour Laplacian of luma. Blur lowers it; crisp letter edges raise it. */
export function sharpness(rgba, w, h) {
    if (w < 3 || h < 3) return 0;
    const y = toLuma(rgba, w, h);
    let sum = 0, sq = 0, n = 0;
    for (let r = 1; r < h - 1; r++) {
        for (let c = 1; c < w - 1; c++) {
            const p = r * w + c;
            const lap = y[p - w] + y[p + w] + y[p - 1] + y[p + 1] - 4 * y[p];
            sum += lap; sq += lap * lap; n++;
        }
    }
    const mean = sum / n;
    return sq / n - mean * mean;
}

/** Share (0-1) of pixels blown out to near-white. */
export function glareShare(rgba, level = GLARE_LEVEL) {
    let hot = 0;
    const px = rgba.length / 4;
    for (let i = 0; i < rgba.length; i += 4) {
        if (rgba[i] >= level && rgba[i + 1] >= level && rgba[i + 2] >= level) hot++;
    }
    return px ? hot / px : 0;
}

/** One number to rank frames: sharp is good, glare pulls it down. */
export function frameScore(sharp, glare) {
    return sharp / (1 + GLARE_WEIGHT * 10 * glare);
}

/**
 * Keep the best `n` items by score. Returns { kept, dropped } where dropped is the item pushed out
 * (or the new item itself when it did not make the cut), so the caller can free its memory at once.
 */
export function keepBest(kept, item, n = KEEP) {
    if (kept.length < n) {
        kept.push(item);
        kept.sort((a, b) => b.score - a.score);
        return { kept, dropped: null };
    }
    const worst = kept.at(-1);
    if (item.score <= worst.score) return { kept, dropped: item };
    kept[kept.length - 1] = item;
    kept.sort((a, b) => b.score - a.score);
    return { kept, dropped: worst };
}

/**
 * Step 3: how far frame `b` sits from frame `a` (luma arrays, same size), by trying every shift within `max`
 * pixels of (cx, cy) and keeping the one with the smallest mean squared difference.
 * Returns {dx, dy, err}: b(x+dx, y+dy) ~ a(x, y); err = that mean squared difference.
 */
export function estimateShift(a, b, w, h, max = 8, stride = 2, cx = 0, cy = 0) {
    const m = max + Math.max(Math.abs(cx), Math.abs(cy));
    let best = { dx: cx, dy: cy, err: Infinity };
    for (let dy = cy - max; dy <= cy + max; dy++) {
        for (let dx = cx - max; dx <= cx + max; dx++) {
            let err = 0, n = 0;
            for (let y = m; y < h - m; y += stride) {
                const ra = y * w, rb = (y + dy) * w + dx;
                for (let x = m; x < w - m; x += stride) {
                    const d = a[ra + x] - b[rb + x];
                    err += d * d; n++;
                }
            }
            err /= n || 1;
            if (err < best.err) best = { dx, dy, err };
        }
    }
    return best;
}

/** Half-size copy of a luma array (2x2 average). */
export function halve(l, w, h) {
    const hw = w >> 1, hh = h >> 1, out = new Float32Array(hw * hh);
    for (let y = 0; y < hh; y++) for (let x = 0; x < hw; x++) {
        const p = 2 * y * w + 2 * x;
        out[y * hw + x] = (l[p] + l[p + 1] + l[p + w] + l[p + w + 1]) / 4;
    }
    return { data: out, w: hw, h: hh };
}

/**
 * Coarse-to-fine alignment (raven575's first phone run, 11-11: hands moved past the old 8 px reach).
 * Searches up to `reach` px on a half-size copy, then refines +-2 px at full size.
 * `edge` = the answer sits at the edge of the reach, so the true move may be bigger: don't trust it.
 */
export function alignShift(a, b, w, h, reach = 24) {
    const A = halve(a, w, h), B = halve(b, w, h);
    const coarse = estimateShift(A.data, B.data, A.w, A.h, Math.ceil(reach / 2), 1);
    const fine = estimateShift(a, b, w, h, 2, 1, coarse.dx * 2, coarse.dy * 2);
    const edge = Math.abs(fine.dx) >= reach - 1 || Math.abs(fine.dy) >= reach - 1;
    return { ...fine, edge };
}

/** Which aligned frames to blend: drop any whose shift hit the edge, or whose leftover error is over twice the middle one. */
export function pickAligned(shifts, factor = 2) {
    const errs = shifts.filter((s) => !s.ref && !s.edge).map((s) => s.err).sort((p, q) => p - q);
    const mid = errs.length ? errs.at((errs.length - 1) >> 1) : 0;
    return shifts.map((s) => s.ref || (!s.edge && s.err <= factor * mid + 1e-9));
}

/**
 * Step 3: blend aligned frames by taking each pixel's median across them. Shine that sits in a different place
 * in most frames, and camera grain, both drop out. frames = [{data: RGBA, dx, dy}] (shift of each frame from the
 * first, as estimateShift gives). Pixels a shifted frame does not cover are left out of that pixel's median.
 */
export function medianBlend(frames, w, h) {
    const out = new Uint8ClampedArray(w * h * 4);
    const n = frames.length, v = new Uint8Array(n);   // one small scratch list, sorted in place (no garbage per pixel)
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const o = (y * w + x) * 4;
            for (let c = 0; c < 3; c++) {
                let k = 0;
                for (let f = 0; f < n; f++) {
                    const fr = frames[f], sx = x + fr.dx, sy = y + fr.dy;
                    if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
                    let val = fr.data[(sy * w + sx) * 4 + c], at = k++;
                    while (at > 0 && v[at - 1] > val) { v[at] = v[at - 1]; at--; }
                    v[at] = val;
                }
                out[o + c] = k ? v[(k - 1) >> 1] : 0;
            }
            out[o + 3] = 255;
        }
    }
    return out;
}

// Shine on the best frame above this share of the card makes the reading unreliable (phone runs 11-12:
// light on gave 34-39%, light off 0.2-0.8%).
export const GLARE_BAD = 0.05;
export const GLARE_TILT = 0.02;
// Washout (11-12 phone run: the torch made the card faint at glare 0.02%): share of pixels with every channel
// at or above WASH_LEVEL. With the light on, WASH_BAD or more counts as too much light. First guess, to tune.
export const WASH_LEVEL = 230;
export const WASH_BAD = 0.10;

// A card this dark on average (luma 0-255) is too dim to read well.
export const TOO_DARK = 70;
// Under this the card is a bit dim: the light could help (softer prompt).
export const A_BIT_DARK = 100;

/** Average brightness (luma 0-255) of an RGBA buffer, every 4th pixel. */
export function meanLuma(rgba) {
    let s = 0, n = 0;
    for (let i = 0; i < rgba.length; i += 16) { s += 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]; n++; }
    return n ? s / n : 0;
}

/**
 * What to tell the person after a burst (raven575 17:07 + 17:08 UTC 11-12: keep the light as an option; when
 * the result is bad with it on, suggest turning it off and trying again, and the other way round when too dark).
 * Returns null when the shot is fine.
 */
export function glareAdvice(glare, lightOn, brightness = 128, hasLight = true, wash = 0) {
    if (lightOn && (glare >= GLARE_TILT || wash >= WASH_BAD)) return { kind: 'light-off', text: 'Too much shine from the light. Turn off the light and try again.' };
    if (glare >= GLARE_BAD) return { kind: 'tilt', text: 'Too much shine on the card. Tilt it a little away from the light and try again.' };
    if (brightness < TOO_DARK && !lightOn && hasLight) return { kind: 'light-on', text: 'It is too dark to read well. Would you like to turn on the light?' };
    if (brightness < TOO_DARK) return { kind: 'dark', text: 'It is too dark to read well. Move somewhere brighter and try again.' };
    if (brightness < A_BIT_DARK && !lightOn && hasLight) return { kind: 'light-on', text: 'A bit dark. The light could help. Turn it on?' };
    return null;
}

/** The 11-12 rule: blend only when the best frame shows shine and enough kept frames line up with it. */
export function shouldBlend(bestGlare, aligned) {
    return bestGlare >= BLEND_GLARE && aligned >= BLEND_MIN;
}
