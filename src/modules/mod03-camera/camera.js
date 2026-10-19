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
const IN_USE_MESSAGE = 'Another app is using or watching your camera, so vCGE turned it off. Close the other app and try again, or upload a photo instead.';
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const ZOOM_EASE_MS = 320;      // the fader eases into each change rather than snapping
export const SHUTTER_POP_MS = 260;    // the shutter pops back up after a press
export const CSS_ZOOM_MAX = 4;        // digital zoom range when the camera has no zoom of its own
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

        this.currentFacingMode = config.facingMode || 'environment';
        this.activeStream = null;
        this.zoomMode = 'css';        // 'hardware' when the camera zooms itself, else a CSS scale of the preview
        this.currentZoom = 1.0;       // the zoom in effect right now (eases towards targetZoom)
        this.targetZoom = 1.0;
        this.stopZoomTween = null;
        this.stopShutterTween = null;
        this.capturedImageDataUrl = null;
        this.lastSource = null;       // 'camera' or 'upload': what Retake goes back to
        this.waitingForFrame = false; // a shutter press is waiting for the camera's first picture

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

    // The camera's own zoom when it has one (the fader takes its range), otherwise a digital zoom of the preview.
    setupZoom(track) {
        const capabilities = track && track.getCapabilities ? track.getCapabilities() : {};
        const zoom = capabilities && capabilities.zoom;
        this.zoomMode = zoom && zoom.max > zoom.min && 'applyConstraints' in track ? 'hardware' : 'css';
        if (this.zoomSlider) {
            if (this.zoomMode === 'hardware') {
                this.zoomSlider.min = zoom.min; this.zoomSlider.max = zoom.max; this.zoomSlider.step = zoom.step || 0.1;
            } else {
                this.zoomSlider.min = 1; this.zoomSlider.max = CSS_ZOOM_MAX; this.zoomSlider.step = 0.1;
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
                if (isCurrent() && track.muted && document.visibilityState === 'visible') this.blockCamera('the camera feed was cut off');
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
        if (this.shutter) {
            // Sinks on the press, pops back (with the shared overshoot) on the release; the shot is taken on the click.
            this.shutter.addEventListener('pointerdown', () => this.pressShutter(true));
            ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => this.shutter.addEventListener(t, () => this.pressShutter(false)));
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

    applyZoom(z) {
        this.currentZoom = z;
        if (this.zoomDisplay) this.zoomDisplay.textContent = `${z.toFixed(1)}x`;
        const track = this.activeStream ? this.activeStream.getVideoTracks()[0] : null;
        if (this.zoomMode === 'hardware' && track) {
            track.applyConstraints({ advanced: [{ zoom: z }] }).catch(() => { this.zoomMode = 'css'; this.applyZoom(z); });
            if (this.videoEl) this.videoEl.style.transform = '';
        } else if (this.videoEl) {
            this.videoEl.style.transform = z > 1 ? `scale(${z})` : '';
        }
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
