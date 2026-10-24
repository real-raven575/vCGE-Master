/**
 * vCard Generator Engine (vCGE)
 * Copyright (c) 2026 raven575, Team vCGE (Claude) & Gemini
 *
 * Repository: https://github.com/real-raven575/vCGE-Master
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * vCGE-MOD03: crop & straighten editor on the Capture card.
 * Four draggable corner handles (mouse, touch, or arrow keys) over the photo, Rotate left and Rotate right (90° each,
 * so any photo is upright in two taps at most), and "Snap to card". The handles start at the full edge of the photo,
 * never pushed in (raven575, 2026-10-17): a shot already is what the viewfinder showed, and an upload is read whole
 * unless a corner is moved. Corners are kept in the photo's own pixels; handles and outline are positioned in percent,
 * so no layout code is needed when the card resizes. "Snap to card" runs the on-device edge finder only when pressed,
 * moves the handles only when it finds a card, and then zooms onto it. The part of the photo outside the corners is
 * dimmed, so the area that will be read has a clear edge. A pinch (or a trackpad pinch) on the photo zooms the photo,
 * not the page; one finger pans it while zoomed; a double tap goes back to the whole photo. The handles keep their size
 * at any zoom. The zoom is only a view: it never changes what is read.
 */
import { quadOutputSize, warpPerspective } from './perspective.js';
import { findCardQuad } from './cardFinder.js';
import { tween } from './viewfinder.js';
import { CROP_ZOOM_MAX, FIT_VIEW, clampView, zoomAbout, viewForCorners } from './cropView.js';

const INSET = 0;             // where the handles start, as a fraction of the photo: the full edge
const FINDER_MAX_SIDE = 1200; // the edge finder reads a copy no larger than this along its longer side
const CORNER_NAMES = ['Top-left', 'Top-right', 'Bottom-right', 'Bottom-left'];
export const SNAP_ZOOM_MS = 420;    // the zoom onto a snapped card eases in (at once under reduce motion)

export class CropEditor {
    constructor(config = {}) {
        this.image = config.image || document.getElementById('reviewImage');
        this.stage = config.stage || document.getElementById('cropStage');
        this.overlay = config.overlay || document.getElementById('cropOverlay');
        this.polygon = config.polygon || document.getElementById('cropPolygon');
        this.shade = config.shade || document.getElementById('cropShade');
        this.viewEl = config.view || document.getElementById('cropView');
        this.handles = Array.from(this.stage.querySelectorAll('[data-corner]'));
        this.corners = [];
        this.touched = false;
        this.view = { ...FIT_VIEW };
        this.stopViewTween = null;

        this.image.addEventListener('load', () => this.reset());
        this.wireZoom();
        this.handles.forEach((handle, i) => {
            handle.setAttribute('aria-label', `${CORNER_NAMES[i]} corner of the card`);
            handle.addEventListener('pointerdown', (e) => this.startDrag(e, i));
            handle.addEventListener('keydown', (e) => this.nudge(e, i));
        });
        if (this.image.complete && this.image.naturalWidth) this.reset();
    }

    /** Handles back to their starting place (the photo's full edges); the photo will be used uncropped. */
    reset() {
        const w = this.image.naturalWidth, h = this.image.naturalHeight;
        if (!w || !h) return;
        this.corners = [
            { x: w * INSET, y: h * INSET }, { x: w * (1 - INSET), y: h * INSET },
            { x: w * (1 - INSET), y: h * (1 - INSET) }, { x: w * INSET, y: h * (1 - INSET) }
        ];
        this.touched = false;
        this.overlay.setAttribute('viewBox', `0 0 ${w} ${h}`);
        this.setView(FIT_VIEW);
        this.render();
    }

    render() {
        const w = this.image.naturalWidth, h = this.image.naturalHeight;
        if (!w || !h || this.corners.length !== 4) return;
        this.corners.forEach((c, i) => {
            this.handles[i].style.left = `${(c.x / w) * 100}%`;
            this.handles[i].style.top = `${(c.y / h) * 100}%`;
        });
        this.polygon.setAttribute('points', this.corners.map(c => `${c.x},${c.y}`).join(' '));
        // The dimmed surround: the whole photo with the corners' area cut out of it
        if (this.shade) this.shade.setAttribute('d', `M0,0H${w}V${h}H0Z M${this.corners.map(c => `${c.x},${c.y}`).join('L')}Z`);
    }

    /** Puts all four corners (photo pixels, top-left first, clockwise) in place, as a drag would. */
    setCorners(corners) {
        if (!corners || corners.length !== 4) return;
        corners.forEach((c, i) => this.moveCorner(i, c.x, c.y));
    }

    /**
     * "Snap to card": looks for the card's edges in the photo, moves the handles onto them and zooms onto the card.
     * Returns true when a card was found; otherwise the handles and the zoom stay as they are. The copy it reads is
     * emptied afterwards.
     */
    snapToCard() {
        const img = this.image;
        if (!img.naturalWidth || !img.naturalHeight) return false;
        const scale = Math.min(1, FINDER_MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        let quad = null;
        try {
            quad = findCardQuad(ctx.getImageData(0, 0, canvas.width, canvas.height));
        } finally {
            canvas.width = canvas.height = 0;
        }
        if (!quad) return false;
        this.setCorners(quad.map(p => ({ x: p.x / scale, y: p.y / scale })));
        const { w, h } = this.viewSize();
        this.setView(viewForCorners(this.corners, img.naturalWidth, img.naturalHeight, w, h, this.stage.clientWidth, this.stage.clientHeight), { animate: true });
        return true;
    }

    // ---- The zoom of the photo (a view only: the corners and the photo are untouched) ---------------------------

    viewSize() {
        return { w: this.viewEl ? this.viewEl.offsetWidth : 0, h: this.viewEl ? this.viewEl.offsetHeight : 0 };
    }

    reducedMotion() {
        return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    }

    /** Shows the photo at `view` ({ scale, x, y }, kept inside the rules), easing there when `animate` is set. */
    setView(view, { animate = false } = {}) {
        if (this.stopViewTween) { this.stopViewTween(); this.stopViewTween = null; }
        const { w, h } = this.viewSize();
        const to = w && h ? clampView(view, w, h) : { ...FIT_VIEW };
        if (!animate) { this.applyView(to); return; }
        const from = { ...this.view };
        this.stopViewTween = tween(0, 1, SNAP_ZOOM_MS, (t) => this.applyView(t === 1 ? to : {
            scale: from.scale + (to.scale - from.scale) * t, x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t
        }), { instant: this.reducedMotion() });
    }

    applyView(view) {
        this.view = { ...view };
        if (!this.viewEl) return;
        const fit = view.scale === 1 && view.x === 0 && view.y === 0;
        this.viewEl.style.transform = fit ? '' : `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
        this.viewEl.style.setProperty('--crop-scale', String(view.scale));
        // Zoomed in, one finger pans the photo; at the whole photo a swipe still moves the deck and scrolls the page
        if (view.scale > 1) this.stage.dataset.zoomed = '1'; else delete this.stage.dataset.zoomed;
    }

    // Pinch (two fingers, or a trackpad pinch) zooms about the fingers; one finger pans while zoomed; a double tap or
    // double click goes back to the whole photo. Presses on a handle are the handle's own (a drag of that corner).
    wireZoom() {
        if (!this.viewEl) return;
        const points = new Map();
        let start = null, touchPinch = false;
        const local = (e) => { const r = this.viewEl.getBoundingClientRect(); return { x: e.clientX - (r.left - this.view.x), y: e.clientY - (r.top - this.view.y) }; };
        const begin = (p = Array.from(points.values())) => {
            start = { view: { ...this.view }, p };
            if (p.length >= 2) start.dist = Math.max(1, Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y));
        };
        // Two fingers zoom about where they started and move the photo with their middle. A pinch past 6x or past the
        // whole photo starts again from where it stopped, so turning back zooms back at once (raven575, 2026-10-22: a
        // fast pinch "won't let you zoom all the way back out").
        const pinchTo = (p) => {
            const { w, h } = this.viewSize();
            const mid0 = { x: (start.p[0].x + start.p[1].x) / 2, y: (start.p[0].y + start.p[1].y) / 2 };
            const mid = { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 };
            const factor = Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y) / start.dist, want = start.view.scale * factor;
            const z = zoomAbout(start.view, factor, mid0.x, mid0.y, w, h);
            this.applyView(clampView({ scale: z.scale, x: z.x + mid.x - mid0.x, y: z.y + mid.y - mid0.y }, w, h));
            if (want > CROP_ZOOM_MAX || want < 1) begin(p);
        };
        this.stage.addEventListener('pointerdown', (e) => {
            if (e.target.closest('[data-corner]')) return;
            if (e.pointerType === 'mouse' && this.view.scale === 1) return;     // nothing to pan at the whole photo
            if (this.stopViewTween) { this.stopViewTween(); this.stopViewTween = null; }
            touchPinch = false;
            points.set(e.pointerId, local(e));
            if (this.stage.setPointerCapture) { try { this.stage.setPointerCapture(e.pointerId); } catch (_) { /* a synthetic pointer */ } }
            begin();
        });
        this.stage.addEventListener('pointermove', (e) => {
            if (!points.has(e.pointerId) || !start || touchPinch) return;
            points.set(e.pointerId, local(e));
            const p = Array.from(points.values()), { w, h } = this.viewSize();
            if (p.length >= 2 && start.p.length >= 2) {
                pinchTo(p);
            } else if (p.length === 1 && start.view.scale > 1) {
                this.applyView(clampView({ ...start.view, x: start.view.x + p[0].x - start.p[0].x, y: start.view.y + p[0].y - start.p[0].y }, w, h));
            }
        });
        const end = (e) => { if (points.delete(e.pointerId)) begin(); };
        ['pointerup', 'pointercancel'].forEach(t => this.stage.addEventListener(t, end));
        // At the whole photo a finger that moves before the second one lands is taken by Chrome as a scroll: its pointer
        // is cancelled and the second finger gets no pointer at all (raven575, Chrome on Android, 2026-10-22: a fast
        // pinch "breaks the zoom"). Their touches still come, so that pinch is followed from the touches instead.
        const touchPoints = (e) => [e.touches[0], e.touches[1]].map(t => local(t));
        this.stage.addEventListener('touchstart', (e) => {
            if (e.touches.length !== 2 || points.size >= 2) return;
            if (this.stopViewTween) { this.stopViewTween(); this.stopViewTween = null; }
            touchPinch = true;
            begin(touchPoints(e));
        }, { passive: true });
        this.stage.addEventListener('touchmove', (e) => {
            if (!touchPinch || e.touches.length < 2 || points.size >= 2 || !start) return;
            pinchTo(touchPoints(e));
        }, { passive: true });
        ['touchend', 'touchcancel'].forEach(t => this.stage.addEventListener(t, (e) => {
            if (!touchPinch || e.touches.length >= 2) return;
            touchPinch = false;
            begin();
        }, { passive: true }));
        // A trackpad pinch arrives as a wheel with Ctrl held; a plain wheel still scrolls the page
        this.stage.addEventListener('wheel', (e) => {
            if (!e.ctrlKey) return;
            e.preventDefault();
            const at = local(e), { w, h } = this.viewSize();
            this.applyView(zoomAbout(this.view, Math.exp(-e.deltaY / 100), at.x, at.y, w, h));
        }, { passive: false });
        // Safari's own pinch events: the page must not zoom from a pinch that started on the photo
        ['gesturestart', 'gesturechange'].forEach(t => this.stage.addEventListener(t, (e) => e.preventDefault()));
        this.stage.addEventListener('dblclick', (e) => { if (!e.target.closest('[data-corner]')) this.setView(FIT_VIEW, { animate: true }); });
        // A new size for the photo (rotation, a turned phone, a narrower window) starts again from the whole photo
        let size = '';
        if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => {
            const { w, h } = this.viewSize(), now = `${w}x${h}`;
            if (now !== size) { size = now; this.setView(FIT_VIEW); }
        }).observe(this.viewEl);
    }

    moveCorner(i, x, y) {
        const w = this.image.naturalWidth, h = this.image.naturalHeight;
        this.corners[i] = { x: Math.max(0, Math.min(w, x)), y: Math.max(0, Math.min(h, y)) };
        this.touched = true;
        this.render();
    }

    startDrag(e, i) {
        e.preventDefault();
        const handle = this.handles[i];
        handle.setPointerCapture(e.pointerId);
        handle.focus();
        const move = (ev) => {
            const r = this.image.getBoundingClientRect();
            if (!r.width || !r.height) return;
            this.moveCorner(i, ((ev.clientX - r.left) / r.width) * this.image.naturalWidth,
                ((ev.clientY - r.top) / r.height) * this.image.naturalHeight);
        };
        const end = () => {
            handle.removeEventListener('pointermove', move);
            handle.removeEventListener('pointerup', end);
            handle.removeEventListener('pointercancel', end);
        };
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', end);
        handle.addEventListener('pointercancel', end);
    }

    // Arrow keys move the focused handle by 0.5% of the photo (Shift: 2.5%).
    nudge(e, i) {
        const step = Math.max(1, Math.max(this.image.naturalWidth, this.image.naturalHeight) * (e.shiftKey ? 0.025 : 0.005));
        const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
        if (!d) return;
        e.preventDefault();
        this.moveCorner(i, this.corners[i].x + d[0], this.corners[i].y + d[1]);
    }

    /**
     * Rotates the photo 90°: clockwise (`direction` 1, Rotate right) or counter-clockwise (-1, Rotate left). The
     * corners and the zoom reset once the rotated photo has loaded.
     */
    rotate(direction = 1) {
        const img = this.image;
        if (!img.naturalWidth) return;
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalHeight;
        canvas.height = img.naturalWidth;
        const ctx = canvas.getContext('2d');
        if (direction < 0) { ctx.translate(0, canvas.height); ctx.rotate(-Math.PI / 2); }
        else { ctx.translate(canvas.width, 0); ctx.rotate(Math.PI / 2); }
        ctx.drawImage(img, 0, 0);
        img.src = canvas.toDataURL('image/png');
        canvas.width = canvas.height = 0;        // no copy of the photo left behind
    }

    /** The photo to read: flattened to the corners if any corner was moved, otherwise the photo unchanged. */
    getCroppedImage() {
        const img = this.image;
        if (!this.touched || !img.naturalWidth) return img.src;
        const source = document.createElement('canvas');
        source.width = img.naturalWidth;
        source.height = img.naturalHeight;
        const sctx = source.getContext('2d');
        sctx.drawImage(img, 0, 0);
        const { width, height } = quadOutputSize(this.corners);
        const flat = warpPerspective(sctx.getImageData(0, 0, source.width, source.height), this.corners, width, height);
        const out = document.createElement('canvas');
        out.width = width;
        out.height = height;
        out.getContext('2d').putImageData(new ImageData(flat.data, width, height), 0, 0);
        source.width = source.height = 0;
        const url = out.toDataURL('image/png');
        out.width = out.height = 0;              // no copy of the photo left behind
        return url;
    }
}
