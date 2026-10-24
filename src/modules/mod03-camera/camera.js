/**
 * vCGE-MOD03: Active Camera & Acquisition Subsystem (Iris)
 * Created by raven575, Team vCGE (Claude) & Gemini
 * Target: camera.js (Modular ES Implementation)
 *
 * The Capture card (redesign step 5): Take a photo or Upload a photo; a clean viewfinder with thin corner brackets
 * marking a business-card frame that turns with the phone; a vertical zoom fader that eases into each change; a
 * round green shutter that sinks when pressed. The shot is exactly what the viewfinder showed (the visible window of
 * the sensor frame, zoom included), never the whole frame. The photo is handed to the crop editor on this card; the
 * bus only ever gets a signal. Messages to the person go through the `toast` hook main.js hands in (Shell's toast).
 */
import { globalEventBus, Events } from '../../share/eventBus.js';
import { visibleSourceRect, cardFrameRect, tween } from './viewfinder.js';

// A web page cannot claim the camera for itself, so the camera is turned off and the user told whenever another app
// shows up: it holds the camera (start fails), takes it away mid-scan (the feed ends or stays muted), or sits in front of
// it as a virtual camera (software that sees every frame before any app does).
const CAMERA_IN_USE_ERRORS = ['NotReadableError', 'TrackStartError'];
const VIRTUAL_CAMERA = /\b(obs|manycam|snap camera|xsplit|virtual|droidcam|camo|mmhmm|ndi|splitcam|vcam|youcam|e2esoft)\b/i;
const MUTE_GRACE_MS = 1000;   // a feed muted this long while the app is in view counts as cut off
const PICKER_GRACE_MS = 5000; // after Upload opens the photo picker, a mute is the picker's (as main.js EXTERNAL_APP_GRACE_MS)
const IN_USE_MESSAGE = 'Another app is using or watching your camera, so vCGE turned it off. Close the other app and try again, or upload a photo instead.';
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const ZOOM_EASE_MS = 320;      // the fader eases into each change rather than snapping
export const SHUTTER_POP_MS = 260;    // the shutter pops back up after a press
export const IRIS_WINK_MS = 700;     // one wink when Iris is tapped on the empty Capture card (camera.css iris-wink)
export const ZOOM_MAX = 4;            // the most the fader or a pinch zooms, the camera's own zoom or the digital one
                                      // (raven575, 2026-10-24: a phone's 8x was too close to help)
export const FIRST_FRAME_WAIT_MS = 1500;   // how long a shutter press waits for the camera's first picture

export class VCGEActiveCamera {
    constructor(config = {}) {
        this.videoEl = config.videoEl || document.getElementById('cameraStream');
        this.canvasEl = config.canvasEl || document.getElementById('captureCanvas');
        this.zoomSlider = config.zoomSlider || document.getElementById('zoomSlider');
        this.zoomDisplay = config.zoomDisplay || document.getElementById('zoomDisplay');
        this.viewfinderArea = config.viewfinderArea || document.getElementById('viewfinderArea');
        this.cardFrame = config.cardFrame || document.getElementById('cardFrame');
        this.shutter = config.shutter || document.getElementById('captureBtn');
        this.reviewPanel = config.reviewPanel || document.getElementById('captureReview');
        this.reviewImage = config.reviewImage || document.getElementById('reviewImage');
        this.eventLog = config.eventLog || document.getElementById('eventLog');
        this.cameraPanel = config.cameraPanel || document.getElementById('cameraPanel');
        this.toast = typeof config.toast === 'function' ? config.toast : () => {};
        this.irisPeek = config.irisPeek || document.getElementById('capIris');
        this.uploadInput = config.uploadInput || document.getElementById('imageUpload');

        this.currentFacingMode = config.facingMode || 'environment';
        this.activeStream = null;
        this.zoomMode = 'css';        // 'hardware' when the camera zooms itself, else a CSS scale of the preview
        this.currentZoom = 1.0;       // the zoom in effect right now (eases towards targetZoom)
        this.targetZoom = 1.0;
        this.stopZoomTween = null;
        this.zoomInFlight = false;    // a zoom request the camera has not finished yet
        this.queuedZoom = null;       // the newest zoom asked for meanwhile (only the newest is sent)
        this.stopShutterTween = null;
        this.capturedImageDataUrl = null;
        this.lastSource = null;       // 'camera' or 'upload': what Retake goes back to
        this.waitingForFrame = false; // a shutter press is waiting for the camera's first picture
        this.pickerOpenUntil = 0;     // the photo picker was opened: a mute until then is the picker's, not another app's

        this.initListeners();
    }

    reducedMotion() {
        return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    }

    async initCamera() {
        if (this.activeStream) {
            this.activeStream.getTracks().forEach(track => track.stop());
        }
        if (this.cameraPanel) this.cameraPanel.classList.remove('hidden');
        this.layoutFrame();

        try {
            const constraints = {
                video: {
                    facingMode: { ideal: this.currentFacingMode },
                    width: { ideal: 1920 },
                    height: { ideal: 1080 }
                },
                audio: false
            };

            this.activeStream = await navigator.mediaDevices.getUserMedia(constraints);
            if (this.videoEl) {
                this.videoEl.srcObject = this.activeStream;
            }
            this.logEvent(`Camera stream established (${this.currentFacingMode} mode) - Zero disk cache policy enforced.`);

            const track = this.activeStream.getVideoTracks()[0];
            if (track && VIRTUAL_CAMERA.test(track.label || '')) {
                this.blockCamera(`virtual camera "${track.label}"`);
                return;
            }
            this.watchTrack(track);
            this.setupZoom(track);
        } catch (err) {
            if (err && CAMERA_IN_USE_ERRORS.includes(err.name)) this.blockCamera('the camera is held by another app');
            else {
                this.stopCamera();
                if (this.cameraPanel) this.cameraPanel.classList.add('hidden');
                this.logEvent(`Camera access unavailable: ${err.message}. Use "Upload a photo" instead.`);
                this.toast('The camera is not available here. Upload a photo instead.');
            }
        }
    }

    // The camera's own zoom when it has one (the fader takes its range, up to ZOOM_MAX), otherwise a digital zoom of the
    // preview.
    setupZoom(track) {
        const capabilities = track && track.getCapabilities ? track.getCapabilities() : {};
        const zoom = capabilities && capabilities.zoom;
        this.zoomMode = zoom && Math.min(zoom.max, ZOOM_MAX) > zoom.min && 'applyConstraints' in track ? 'hardware' : 'css';
        this.zoomInFlight = false; this.queuedZoom = null;
        if (this.zoomSlider) {
            if (this.zoomMode === 'hardware') {
                this.zoomSlider.min = zoom.min; this.zoomSlider.max = Math.min(zoom.max, ZOOM_MAX); this.zoomSlider.step = zoom.step || 0.1;
            } else {
                this.zoomSlider.min = 1; this.zoomSlider.max = ZOOM_MAX; this.zoomSlider.step = 0.1;
            }
            this.zoomSlider.value = this.zoomSlider.min;
        }
        this.currentZoom = this.targetZoom = Number(this.zoomSlider ? this.zoomSlider.min : 1) || 1;
        this.applyZoom(this.currentZoom);
    }

    // Another app taking the camera ends our feed (or mutes it, on some phones); stopping it ourselves fires neither.
    watchTrack(track) {
        if (!track) return;
        const isCurrent = () => !!this.activeStream && this.activeStream.getVideoTracks()[0] === track;
        track.addEventListener('ended', () => {
            if (isCurrent()) this.blockCamera('the camera was taken by another app');
        });
        track.addEventListener('mute', () => {
            setTimeout(() => {
                if (isCurrent() && track.muted && document.visibilityState === 'visible' && Date.now() >= this.pickerOpenUntil) this.blockCamera('the camera feed was cut off');
            }, MUTE_GRACE_MS);
        });
    }

    blockCamera(reason) {
        this.stopCamera();
        if (this.cameraPanel) this.cameraPanel.classList.add('hidden');
        this.logEvent(`Camera turned off: ${reason}.`);
        this.showInUseNotice();
    }

    // The pop-up is built here on first use, so the camera module needs nothing from the page markup.
    showInUseNotice() {
        let notice = document.getElementById('cameraInUseModal');
        if (!notice) {
            notice = document.createElement('div');
            notice.id = 'cameraInUseModal';
            notice.className = 'hidden fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4';
            const box = document.createElement('div');
            box.className = 'bg-white dark:bg-slate-900 rounded-2xl p-6 max-w-sm w-full space-y-3 shadow-2xl';
            box.setAttribute('role', 'alertdialog');
            box.setAttribute('aria-labelledby', 'cameraInUseTitle');
            box.setAttribute('aria-describedby', 'cameraInUseMessage');
            const title = document.createElement('h2');
            title.id = 'cameraInUseTitle';
            title.className = 'text-lg font-bold';
            title.textContent = 'Camera turned off';
            const message = document.createElement('p');
            message.id = 'cameraInUseMessage';
            message.className = 'text-xs text-slate-500 dark:text-slate-400';
            message.textContent = IN_USE_MESSAGE;
            const row = document.createElement('div');
            row.className = 'flex justify-end';
            const ok = document.createElement('button');
            ok.id = 'cameraInUseOkBtn';
            ok.type = 'button';
            ok.className = 'px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-500 text-slate-950 font-semibold text-sm transition';
            ok.textContent = 'OK';
            ok.addEventListener('click', () => notice.classList.add('hidden'));
            row.append(ok);
            box.append(title, message, row);
            notice.append(box);
            document.body.append(notice);
        }
        notice.classList.remove('hidden');
        document.getElementById('cameraInUseOkBtn').focus();
    }

    initListeners() {
        if (this.zoomSlider) {
            this.zoomSlider.addEventListener('input', (e) => this.zoomTo(parseFloat(e.target.value)));
        }
        this.wirePinch();
        if (this.shutter) {
            // Sinks on the press, pops back (with the shared overshoot) on the release; the shot is taken on the click.
            this.shutter.addEventListener('pointerdown', () => this.pressShutter(true));
            ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => this.shutter.addEventListener(t, () => this.pressShutter(false)));
        }
        if (this.uploadInput) {
            // Upload turns the camera off before the picker opens. Left running, the picker pauses the feed while the page
            // is still in view (Android Chrome), which read as another app taking the camera: the viewfinder closed and the
            // in-use notice popped up under the picker. A feed we stop ourselves sends no mute or ended event.
            this.uploadInput.addEventListener('click', () => { this.pickerOpenUntil = Date.now() + PICKER_GRACE_MS; this.closeCamera(); });
        }
        if (this.irisPeek) {
            // A hidden delight: one slow wink per tap, never repeated on its own, and skipped under reduce motion.
            this.irisPeek.addEventListener('click', () => this.wink());
        }
        if (this.viewfinderArea && typeof ResizeObserver !== 'undefined') {
            new ResizeObserver(() => this.layoutFrame()).observe(this.viewfinderArea);
        }
        window.addEventListener('resize', () => this.layoutFrame());
    }

    // The card frame: a 3.5 : 2 guide that fills most of the viewfinder, landscape or upright to match it.
    layoutFrame() {
        if (!this.viewfinderArea || !this.cardFrame) return;
        const w = this.viewfinderArea.clientWidth, h = this.viewfinderArea.clientHeight;
        const r = cardFrameRect(w, h);
        if (!r.width) return;
        this.cardFrame.style.left = `${r.x}px`;
        this.cardFrame.style.top = `${r.y}px`;
        this.cardFrame.style.width = `${r.width}px`;
        this.cardFrame.style.height = `${r.height}px`;
        this.cardFrame.dataset.orientation = r.orientation;
    }

    // The fader sets a target; the zoom in effect eases there over ZOOM_EASE_MS (at once under reduce motion).
    zoomTo(value) {
        const target = Number(value);
        if (!Number.isFinite(target)) return;
        this.targetZoom = target;
        if (this.stopZoomTween) this.stopZoomTween();
        this.stopZoomTween = tween(this.currentZoom, target, ZOOM_EASE_MS, (z) => this.applyZoom(z), { instant: this.reducedMotion() });
    }

    // A pinch follows the fingers: the zoom changes at once, and the fader moves with it.
    setZoomNow(value) {
        const min = Number(this.zoomSlider ? this.zoomSlider.min : 1) || 1, max = Number(this.zoomSlider ? this.zoomSlider.max : ZOOM_MAX) || ZOOM_MAX;
        const z = Math.min(max, Math.max(min, Number(value) || min));
        if (this.stopZoomTween) { this.stopZoomTween(); this.stopZoomTween = null; }
        this.targetZoom = z;
        if (this.zoomSlider) this.zoomSlider.value = String(z);
        this.applyZoom(z);
    }

    applyZoom(z) {
        this.currentZoom = z;
        if (this.zoomDisplay) this.zoomDisplay.textContent = `${z.toFixed(1)}x`;
        const track = this.activeStream ? this.activeStream.getVideoTracks()[0] : null;
        if (this.zoomMode === 'hardware' && track) {
            this.sendHardwareZoom(track, z);
            if (this.videoEl) this.videoEl.style.transform = '';
        } else if (this.videoEl) {
            this.videoEl.style.transform = z > 1 ? `scale(${z})` : '';
        }
    }

    // The camera's own zoom takes a moment per change. A request for every step of the ease (or of a pinch) piled up,
    // and they finished out of order: the picture jumped back and forth and could stop at an old zoom (raven575, Chrome
    // on Android, 2026-10-24). So one request at a time, and while it runs only the newest zoom is kept, sent next: the
    // last zoom asked for is always the last one the camera gets.
    sendHardwareZoom(track, z) {
        this.queuedZoom = z;
        if (this.zoomInFlight) return;
        // A camera stopped or restarted meanwhile has its own requests (setupZoom starts them afresh): leave them be
        const current = () => !!this.activeStream && this.activeStream.getVideoTracks()[0] === track;
        const next = () => {
            if (!current()) return;
            const want = this.queuedZoom;
            this.queuedZoom = null;
            this.zoomInFlight = want !== null;
            if (want === null) return;
            track.applyConstraints({ advanced: [{ zoom: want }] }).then(next, () => {
                if (!current()) return;
                this.zoomInFlight = false; this.queuedZoom = null;
                this.zoomMode = 'css'; this.applyZoom(this.currentZoom);
            });
        };
        next();
    }

    // Pinch on the viewfinder zooms the camera, not the page (raven575, 2026-10-24: the page zoomed instead). Two fingers
    // scale the zoom they started from; past the fader's ends the pinch starts again from there, so turning back zooms
    // back at once. A finger that moves before the second lands is taken by Chrome as a scroll (its pointer is cancelled,
    // and the second finger gets none), so that pinch is followed from the touches. Presses on the fader or the shutter
    // are theirs.
    wirePinch() {
        const area = this.viewfinderArea;
        if (!area) return;
        const points = new Map();
        let start = null, touchPinch = false;
        const span = (p) => Math.max(1, Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y));
        const begin = (p) => { start = p.length >= 2 ? { zoom: this.targetZoom, dist: span(p) } : null; };
        const pinchTo = (p) => {
            if (!start || !this.activeStream) return;
            const want = start.zoom * span(p) / start.dist;
            this.setZoomNow(want);
            if (want !== this.targetZoom) begin(p);
        };
        const own = (e) => !e.target.closest || !e.target.closest('.cap-fader, button, input, label');
        area.addEventListener('pointerdown', (e) => {
            if (e.pointerType === 'mouse' || !own(e)) return;
            touchPinch = false;
            points.set(e.pointerId, { x: e.clientX, y: e.clientY });
            begin(Array.from(points.values()));
        });
        area.addEventListener('pointermove', (e) => {
            if (!points.has(e.pointerId) || touchPinch) return;
            points.set(e.pointerId, { x: e.clientX, y: e.clientY });
            const p = Array.from(points.values());
            if (p.length >= 2) pinchTo(p);
        });
        ['pointerup', 'pointercancel'].forEach(t => area.addEventListener(t, (e) => { if (points.delete(e.pointerId)) begin(Array.from(points.values())); }));
        const touchPoints = (e) => [e.touches[0], e.touches[1]].map(t => ({ x: t.clientX, y: t.clientY }));
        area.addEventListener('touchstart', (e) => {
            if (e.touches.length !== 2 || points.size >= 2 || !own(e)) return;
            touchPinch = true;
            begin(touchPoints(e));
        }, { passive: true });
        area.addEventListener('touchmove', (e) => { if (touchPinch && e.touches.length >= 2 && points.size < 2) pinchTo(touchPoints(e)); }, { passive: true });
        ['touchend', 'touchcancel'].forEach(t => area.addEventListener(t, (e) => { if (touchPinch && e.touches.length < 2) { touchPinch = false; start = null; } }, { passive: true }));
        // A trackpad pinch arrives as a wheel with Ctrl held; Safari's own pinch events must not zoom the page
        area.addEventListener('wheel', (e) => {
            if (!e.ctrlKey || !this.activeStream) return;
            e.preventDefault();
            this.setZoomNow(this.targetZoom * Math.exp(-e.deltaY / 100));
        }, { passive: false });
        ['gesturestart', 'gesturechange'].forEach(t => area.addEventListener(t, (e) => e.preventDefault()));
    }

    wink() {
        if (!this.irisPeek || this.reducedMotion() || this.irisPeek.classList.contains('wink')) return;
        this.irisPeek.classList.add('wink');
        setTimeout(() => this.irisPeek.classList.remove('wink'), IRIS_WINK_MS);
    }

    pressShutter(down) {
        if (!this.shutter) return;
        if (down) {
            if (this.stopShutterTween) this.stopShutterTween();
            this.shutter.dataset.pressed = '1';
            this.shutter.style.transform = 'scale(0.9)';
            return;
        }
        // A release while pressed starts the pop; a later pointerleave (the viewfinder closing) must not cut it short.
        if (this.shutter.dataset.pressed !== '1') return;
        delete this.shutter.dataset.pressed;
        if (this.stopShutterTween) this.stopShutterTween();
        this.stopShutterTween = tween(0.9, 1, SHUTTER_POP_MS, (s) => { this.shutter.style.transform = s === 1 ? '' : `scale(${s})`; }, { instant: this.reducedMotion() });
    }

    stopCamera() {
        if (this.stopZoomTween) { this.stopZoomTween(); this.stopZoomTween = null; }
        this.queuedZoom = null;
        if (this.activeStream) {
            this.activeStream.getTracks().forEach(track => track.stop());
            this.activeStream = null;
        }
        if (this.videoEl) { this.videoEl.srcObject = null; this.videoEl.style.transform = ''; }
    }

    closeCamera() {
        this.stopCamera();
        if (this.cameraPanel) this.cameraPanel.classList.add('hidden');
    }

    switchCamera() {
        this.currentFacingMode = this.currentFacingMode === 'environment' ? 'user' : 'environment';
        this.initCamera();
    }

    // Upload: the standard image picker; anything that is not an image, or is over 10 MB, is turned away with a toast.
    handleGalleryUpload(file) {
        if (!file) return;
        if (!/^image\//.test(file.type || '')) {
            this.toast('That file is not a photo. Choose an image file.');
            return;
        }
        if (file.size > MAX_UPLOAD_BYTES) {
            this.toast('That photo is over 10 MB. Choose a smaller one.');
            return;
        }
        const reader = new FileReader();
        reader.onload = (event) => {
            this.capturedImageDataUrl = event.target.result;
            this.lastSource = 'upload';
            this.publishCapture(this.capturedImageDataUrl, 'GALLERY_IMPORT');
        };
        reader.readAsDataURL(file);
    }

    // The shot is the window of the sensor frame the viewfinder showed (object-fit: cover plus the digital zoom), so
    // what is on the screen is what is read. With the camera's own zoom the frame already is the zoomed view.
    // The first picture can come a moment after the viewfinder opens: a press before it waits for it instead of taking a
    // black photo, and says so if none comes.
    captureFrame() {
        if (!this.canvasEl || !this.videoEl) return;
        const video = this.videoEl;
        if (video.videoWidth && video.videoHeight) { this.takeShot(); return; }
        if (this.waitingForFrame) return;
        this.waitingForFrame = true;
        let timer = null;
        const done = (gotFrame) => {
            video.removeEventListener('loadeddata', onFrame);
            video.removeEventListener('resize', onFrame);
            clearTimeout(timer);
            this.waitingForFrame = false;
            if (!this.activeStream) return;                 // the camera was closed meanwhile (Close, a lock, a wipe)
            if (gotFrame) this.takeShot();
            else this.toast('The camera is still starting. Try again in a moment.');
        };
        const onFrame = () => { if (video.videoWidth && video.videoHeight) done(true); };
        video.addEventListener('loadeddata', onFrame);
        video.addEventListener('resize', onFrame);
        timer = setTimeout(() => done(false), FIRST_FRAME_WAIT_MS);
    }

    takeShot() {
        const videoW = this.videoEl.videoWidth || 1280, videoH = this.videoEl.videoHeight || 720;
        const viewW = this.viewfinderArea ? this.viewfinderArea.clientWidth : videoW;
        const viewH = this.viewfinderArea ? this.viewfinderArea.clientHeight : videoH;
        const r = visibleSourceRect(viewW, viewH, videoW, videoH, this.zoomMode === 'css' ? this.currentZoom : 1);
        const ctx = this.canvasEl.getContext('2d');
        this.canvasEl.width = r.width;
        this.canvasEl.height = r.height;
        ctx.drawImage(this.videoEl, r.x, r.y, r.width, r.height, 0, 0, r.width, r.height);
        this.capturedImageDataUrl = this.canvasEl.toDataURL('image/png');
        this.canvasEl.width = this.canvasEl.height = 0;     // no second copy of the photo left in the canvas
        this.lastSource = 'camera';
        this.closeCamera();                                 // the shot is taken; Retake opens the camera again
        this.publishCapture(this.capturedImageDataUrl, 'HARDWARE_STREAM_SNAP');
    }

    // The captured image stays in memory and is handed only to the crop editor; the bus gets a signal, never the photo.
    publishCapture(dataUrl, sourceMode) {
        this.logEvent(`Image captured (${sourceMode}). Check the crop, then press OK.`);
        globalEventBus.publish(Events.IMAGE_CAPTURED, { sourceMode, timestamp: Date.now() });
        this.openReview(dataUrl);
    }

    openReview(dataUrl) {
        if (this.reviewImage) this.reviewImage.src = dataUrl;
        if (this.reviewPanel) this.reviewPanel.classList.remove('hidden');
    }

    // Drops the photo: the review closes and the card goes back to Take or Upload.
    discardPhoto() {
        this.capturedImageDataUrl = null;
        this.lastSource = null;
        if (this.reviewImage) this.reviewImage.removeAttribute('src');
        if (this.reviewPanel) this.reviewPanel.classList.add('hidden');
    }

    logEvent(msg) {
        if (this.eventLog) this.eventLog.innerText = `> ${msg}`;
    }
}
