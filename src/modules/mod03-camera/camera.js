/**
 * vCGE-MOD03: Active Camera & Acquisition Subsystem
 * Created by raven575, Gemini & Claude
 * Target: camera.js (Modular ES Implementation)
 */
import { globalEventBus, Events } from '../../share/eventBus.js';

// A web page cannot claim the camera for itself, so the camera is turned off and the user told whenever another app
// shows up: it holds the camera (start fails), takes it away mid-scan (the feed ends or stays muted), or sits in front of
// it as a virtual camera (software that sees every frame before any app does).
const CAMERA_IN_USE_ERRORS = ['NotReadableError', 'TrackStartError'];
const VIRTUAL_CAMERA = /\b(obs|manycam|snap camera|xsplit|virtual|droidcam|camo|mmhmm|ndi|splitcam|vcam|youcam|e2esoft)\b/i;
const MUTE_GRACE_MS = 1000;   // a feed muted this long while the app is in view counts as cut off
const IN_USE_MESSAGE = 'Another app is using or watching your camera, so vCGE turned it off. Close the other app and try again, or upload a photo instead.';

export class VCGEActiveCamera {
    constructor(config = {}) {
        this.videoEl = config.videoEl || document.getElementById('cameraStream');
        this.canvasEl = config.canvasEl || document.getElementById('captureCanvas');
        this.zoomSlider = config.zoomSlider || document.getElementById('zoomSlider');
        this.zoomDisplay = config.zoomDisplay || document.getElementById('zoomDisplay');
        this.focusRing = config.focusRing || document.getElementById('focusRing');
        this.viewfinderArea = config.viewfinderArea || document.getElementById('viewfinderArea');
        this.cropReviewModal = config.cropReviewModal || document.getElementById('cropReviewModal');
        this.reviewImage = config.reviewImage || document.getElementById('reviewImage');
        this.eventLog = config.eventLog || document.getElementById('eventLog');
        this.cameraPanel = config.cameraPanel || document.getElementById('cameraPanel');

        this.currentFacingMode = config.facingMode || 'environment';
        this.activeStream = null;
        this.currentZoom = 1.0;
        this.focusPoint = { x: 0.50, y: 0.50 };
        this.capturedImageDataUrl = null;

        this.initListeners();
    }

    async initCamera() {
        if (this.activeStream) {
            this.activeStream.getTracks().forEach(track => track.stop());
        }

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
            const capabilities = track.getCapabilities ? track.getCapabilities() : {};
            if (capabilities.zoom && this.zoomSlider) {
                this.zoomSlider.min = capabilities.zoom.min;
                this.zoomSlider.max = capabilities.zoom.max;
                this.zoomSlider.step = capabilities.zoom.step;
            }
        } catch (err) {
            if (err && CAMERA_IN_USE_ERRORS.includes(err.name)) this.blockCamera('the camera is held by another app');
            else this.logEvent(`Camera access unavailable: ${err.message}. Use "Upload card image" instead.`);
        }
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
        if (this.viewfinderArea) {
            this.viewfinderArea.addEventListener('click', (e) => {
                const rect = this.viewfinderArea.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;

                this.focusPoint = {
                    x: (x / rect.width).toFixed(2),
                    y: (y / rect.height).toFixed(2)
                };

                if (this.focusRing) {
                    this.focusRing.style.left = `${x}px`;
                    this.focusRing.style.top = `${y}px`;
                    this.focusRing.classList.remove('hidden');

                    setTimeout(() => {
                        this.focusRing.classList.add('hidden');
                    }, 800);
                }

                this.logEvent(`Focus region prioritized at relative coords (${this.focusPoint.x}, ${this.focusPoint.y}) for OCR weighting.`);
            });
        }

        if (this.zoomSlider) {
            this.zoomSlider.addEventListener('input', (e) => {
                this.currentZoom = parseFloat(e.target.value);
                if (this.zoomDisplay) this.zoomDisplay.innerText = `${this.currentZoom.toFixed(1)}x`;

                const track = this.activeStream ? this.activeStream.getVideoTracks()[0] : null;
                if (track && 'applyConstraints' in track) {
                    track.applyConstraints({ advanced: [{ zoom: this.currentZoom }] }).catch(() => {
                        if (this.videoEl) this.videoEl.style.transform = `scale(${this.currentZoom})`;
                    });
                } else if (this.videoEl) {
                    this.videoEl.style.transform = `scale(${this.currentZoom})`;
                }
            });
        }
    }

    stopCamera() {
        if (this.activeStream) {
            this.activeStream.getTracks().forEach(track => track.stop());
            this.activeStream = null;
        }
        if (this.videoEl) this.videoEl.srcObject = null;
    }

    switchCamera() {
        this.currentFacingMode = this.currentFacingMode === 'environment' ? 'user' : 'environment';
        this.initCamera();
    }

    handleGalleryUpload(file) {
        if (!file) return;
        if (file.size > 10 * 1024 * 1024) {
            alert('Error: File size exceeds the strict 10MB payload limit.');
            return;
        }
        const reader = new FileReader();
        reader.onload = (event) => {
            this.capturedImageDataUrl = event.target.result;
            this.publishCapture(this.capturedImageDataUrl, 'GALLERY_IMPORT');
        };
        reader.readAsDataURL(file);
    }

    captureFrame() {
        if (!this.canvasEl || !this.videoEl) return;
        const ctx = this.canvasEl.getContext('2d');
        this.canvasEl.width = this.videoEl.videoWidth || 1280;
        this.canvasEl.height = this.videoEl.videoHeight || 720;

        ctx.drawImage(this.videoEl, 0, 0, this.canvasEl.width, this.canvasEl.height);
        this.capturedImageDataUrl = this.canvasEl.toDataURL('image/png');
        this.publishCapture(this.capturedImageDataUrl, 'HARDWARE_STREAM_SNAP');
    }

    // The captured image stays in memory and is handed only to the review modal; the bus gets a signal, never the photo.
    publishCapture(dataUrl, sourceMode) {
        this.logEvent(`Image captured (${sourceMode}). Review it, then run OCR.`);
        globalEventBus.publish(Events.IMAGE_CAPTURED, { sourceMode, timestamp: Date.now() });
        this.openCropReviewModal(dataUrl);
    }

    openCropReviewModal(dataUrl) {
        if (this.reviewImage) this.reviewImage.src = dataUrl;
        const priorityCoord = document.getElementById('priorityCoord');
        if (priorityCoord) priorityCoord.innerText = `(${this.focusPoint.x}, ${this.focusPoint.y})`;
        if (this.cropReviewModal) this.cropReviewModal.classList.remove('hidden');
    }

    logEvent(msg) {
        if (this.eventLog) this.eventLog.innerText = `> ${msg}`;
    }
}