/**
 * vCard Generator Engine (vCGE)
 * Copyright (c) 2026 raven575, Team vCGE (Claude) & Gemini
 *
 * Repository: https://github.com/real-raven575/vCGE-Master
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * vCGE-MOD03: viewfinder geometry and the small stepped tween (redesign step 5). Pure functions, no DOM.
 *
 * The live video covers the viewfinder (CSS object-fit: cover) and a CSS zoom scales it about its centre, so the part of
 * the sensor frame a person sees is a centred window of it. The shot is taken from exactly that window, never the
 * whole frame (the Android finding of 2026-10-16). The card frame is a business-card shaped guide (3.5 : 2) that fills
 * most of the viewfinder and turns with the phone: landscape in a wide viewfinder, upright in a tall one.
 */

export const CARD_ASPECT = 3.5 / 2;      // a business card, long side over short side
export const FRAME_FILL = 0.88;          // how much of the viewfinder the card frame spans along its tighter side
export const STEP_FPS = 26;              // motion is stepped at 24 to 30 fps so it is not too crisp (shared rule)
export const OVERSHOOT = 0.05;           // the small snap past the target before settling (4 to 6 percent)

/**
 * The window of the video that a `viewW` x `viewH` viewfinder shows with the video covering it, scaled by `zoom`
 * about its centre. In the video's own pixels, rounded to whole pixels and kept inside the frame.
 */
export function visibleSourceRect(viewW, viewH, videoW, videoH, zoom = 1) {
    if (!(viewW > 0) || !(viewH > 0) || !(videoW > 0) || !(videoH > 0)) return { x: 0, y: 0, width: videoW || 0, height: videoH || 0 };
    const z = Math.max(1, Number(zoom) || 1);
    const cover = Math.max(viewW / videoW, viewH / videoH);         // object-fit: cover
    const width = Math.min(videoW, Math.round(viewW / (cover * z)));
    const height = Math.min(videoH, Math.round(viewH / (cover * z)));
    const x = Math.max(0, Math.round((videoW - width) / 2));
    const y = Math.max(0, Math.round((videoH - height) / 2));
    return { x, y, width, height };
}

/**
 * Where the card frame sits in a `viewW` x `viewH` viewfinder: a 3.5 : 2 rectangle, landscape when the viewfinder is
 * wider than it is tall and upright otherwise, centred, spanning FRAME_FILL of the viewfinder along the side that
 * limits it. Returned in viewfinder pixels plus the orientation.
 */
export function cardFrameRect(viewW, viewH) {
    if (!(viewW > 0) || !(viewH > 0)) return { x: 0, y: 0, width: 0, height: 0, orientation: 'landscape' };
    const orientation = viewW >= viewH ? 'landscape' : 'portrait';
    const aspect = orientation === 'landscape' ? CARD_ASPECT : 1 / CARD_ASPECT;   // width over height
    let width = viewW * FRAME_FILL, height = width / aspect;
    if (height > viewH * FRAME_FILL) { height = viewH * FRAME_FILL; width = height * aspect; }
    return { x: (viewW - width) / 2, y: (viewH - height) / 2, width, height, orientation };
}

// The "back" constant that makes the second half overshoot by exactly OVERSHOOT (its peak is 2c^3 / (27 (c + 1)^2)).
const BACK = (() => { let lo = 0, hi = 4; for (let i = 0; i < 40; i++) { const c = (lo + hi) / 2; if (2 * c * c * c / (27 * (c + 1) * (c + 1)) < OVERSHOOT) lo = c; else hi = c; } return (lo + hi) / 2; })();

/** Ease in, then out with a small snap past the target: 0 -> 1, peaking at 1 + OVERSHOOT about four fifths of the way, settling at 1. */
export function easeSnap(t) {
    const p = Math.max(0, Math.min(1, t));
    if (p < 0.5) return 2 * p * p;                                   // ease in
    const q = (p - 0.5) / 0.5 - 1;                                   // -1 -> 0 over the second half
    return 0.5 + 0.5 * (1 + (BACK + 1) * q * q * q + BACK * q * q);   // back-out: overshoots, then settles
}

/**
 * Moves a value from `from` to `to` over `ms`, calling `apply(value)` at STEP_FPS and `apply(to)` at the end.
 * Returns a cancel function. With `instant` (reduce motion) it applies the end value at once.
 */
export function tween(from, to, ms, apply, { instant = false, now = () => Date.now(), schedule = setTimeout, cancel = clearTimeout } = {}) {
    if (instant || !(ms > 0) || from === to) { apply(to); return () => {}; }
    const t0 = now();
    let timer = null;
    const step = () => {
        const p = (now() - t0) / ms;
        if (p >= 1) { apply(to); timer = null; return; }
        apply(from + (to - from) * easeSnap(p));
        timer = schedule(step, 1000 / STEP_FPS);
    };
    timer = schedule(step, 1000 / STEP_FPS);
    return () => { if (timer !== null) { cancel(timer); timer = null; } };
}
