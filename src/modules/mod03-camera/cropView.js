/**
 * vCard Generator Engine (vCGE)
 * Copyright (c) 2026 raven575, Team vCGE (Claude) & Gemini
 *
 * Repository: https://github.com/real-raven575/vCGE-Master
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * vCGE-MOD03: the zoom of the photo inside the crop step. Pure functions, no DOM.
 *
 * A pinch on the photo zooms the photo like a camera, not the page (iPad finding 52, 2026-10-17): the buttons and the
 * rest of the card keep their size. After "Snap to card" the view zooms onto the card it found (finding 51). A view is
 * { scale, x, y }: the photo, shown at its fitted size, is scaled by `scale` about its top-left corner and then moved by
 * (x, y) screen pixels. It never zooms out past the fitted size and never leaves a gap at an edge.
 */

export const CROP_ZOOM_MAX = 4;        // as far as a pinch or a snap zooms in
export const SNAP_MARGIN = 0.08;       // room left around the card after a snap, as a fraction of its size

export const FIT_VIEW = Object.freeze({ scale: 1, x: 0, y: 0 });

/** Keeps a view inside the rules: scale between 1 and CROP_ZOOM_MAX, and the photo covering the whole `w` x `h` view. */
export function clampView(view, w, h) {
    const scale = Math.min(CROP_ZOOM_MAX, Math.max(1, Number(view && view.scale) || 1));
    const x = Math.min(0, Math.max(w - w * scale, Number(view && view.x) || 0));
    const y = Math.min(0, Math.max(h - h * scale, Number(view && view.y) || 0));
    return { scale, x, y };
}

/** A view zoomed by `factor` about the screen point (px, py) of the view: that point stays under the fingers. */
export function zoomAbout(view, factor, px, py, w, h) {
    const scale = Math.min(CROP_ZOOM_MAX, Math.max(1, view.scale * factor));
    const k = scale / view.scale;
    return clampView({ scale, x: px - (px - view.x) * k, y: py - (py - view.y) * k }, w, h);
}

/**
 * The view that shows the box of `corners` (photo pixels) as large as it fits, with SNAP_MARGIN around it, centred.
 * `natW` x `natH` is the photo's own size, `w` x `h` the size it is shown at when fitted.
 */
export function viewForCorners(corners, natW, natH, w, h) {
    if (!corners || corners.length !== 4 || !(natW > 0) || !(natH > 0) || !(w > 0) || !(h > 0)) return { ...FIT_VIEW };
    const k = w / natW;                          // photo pixels to fitted screen pixels (the photo keeps its shape)
    const xs = corners.map(c => c.x * k), ys = corners.map(c => c.y * k);
    const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys);
    const bw = Math.max(1, right - left) * (1 + 2 * SNAP_MARGIN), bh = Math.max(1, bottom - top) * (1 + 2 * SNAP_MARGIN);
    const scale = Math.min(CROP_ZOOM_MAX, Math.max(1, Math.min(w / bw, h / bh)));
    const cx = (left + right) / 2, cy = (top + bottom) / 2;
    return clampView({ scale, x: w / 2 - cx * scale, y: h / 2 - cy * scale }, w, h);
}
