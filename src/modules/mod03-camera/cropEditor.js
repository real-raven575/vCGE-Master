/**
 * vCard Generator Engine (vCGE)
 * Copyright (c) 2026 raven575, Gemini & Claude
 *
 * Repository: https://github.com/real-raven575/vCGE-Master
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * vCGE-MOD03: crop & straighten editor on the Capture card.
 * Four draggable corner handles (mouse, touch, or arrow keys) over the photo, plus 90° rotation and "Snap to card".
 * The handles start at the full edge of the photo, never pushed in (raven575, 2026-10-17): a shot already is what the
 * viewfinder showed, and an upload is read whole unless a corner is moved. Corners are kept in the photo's own pixels;
 * handles and outline are positioned in percent, so no layout code is needed when the card resizes. "Snap to card"
 * runs the on-device edge finder only when pressed and moves the handles only when it finds a card.
 */
import { quadOutputSize, warpPerspective } from './perspective.js';
import { findCardQuad } from './cardFinder.js';

const INSET = 0;             // where the handles start, as a fraction of the photo: the full edge
const FINDER_MAX_SIDE = 1200; // the edge finder reads a copy no larger than this along its longer side
const CORNER_NAMES = ['Top-left', 'Top-right', 'Bottom-right', 'Bottom-left'];

export class CropEditor {
    constructor(config = {}) {
        this.image = config.image || document.getElementById('reviewImage');
        this.stage = config.stage || document.getElementById('cropStage');
        this.overlay = config.overlay || document.getElementById('cropOverlay');
        this.polygon = config.polygon || document.getElementById('cropPolygon');
        this.handles = Array.from(this.stage.querySelectorAll('[data-corner]'));
        this.corners = [];
        this.touched = false;

        this.image.addEventListener('load', () => this.reset());
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
    }

    /** Puts all four corners (photo pixels, top-left first, clockwise) in place, as a drag would. */
    setCorners(corners) {
        if (!corners || corners.length !== 4) return;
        corners.forEach((c, i) => this.moveCorner(i, c.x, c.y));
    }

    /**
     * "Snap to card": looks for the card's edges in the photo and moves the handles onto them. Returns true when a
     * card was found; otherwise the handles stay where they are. The copy it reads is emptied afterwards.
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
        return true;
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

    /** Rotates the photo 90° clockwise (the corners reset once the rotated photo has loaded). */
    rotate() {
        const img = this.image;
        if (!img.naturalWidth) return;
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalHeight;
        canvas.height = img.naturalWidth;
        const ctx = canvas.getContext('2d');
        ctx.translate(canvas.width, 0);
        ctx.rotate(Math.PI / 2);
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
