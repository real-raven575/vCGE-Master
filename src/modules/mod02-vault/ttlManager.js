/**
 * vCard Generator Engine (vCGE)
 * Copyright (c) 2026 raven575 & Gemini
 *
 * Repository: https://github.com/real-raven575/vCGE-Master
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */

export class TTLMemoryStreamManager {
    constructor(durationSeconds = 120, onExpireCallback = null) {
        this.durationSeconds = durationSeconds;
        this.expiresAt = 0;
        this.timerId = null;
        this.onExpireCallback = onExpireCallback;
        this.activeBuffer = null;
    }

    // Deadline-based: expiry follows the wall clock, so throttled timers (background tabs) cannot extend the TTL.
    startStream(bufferData) {
        this.activeBuffer = bufferData;
        this.expiresAt = Date.now() + this.durationSeconds * 1000;

        if (this.timerId) clearInterval(this.timerId);

        this.timerId = setInterval(() => {
            if (Date.now() >= this.expiresAt) {
                this.expireAndWipe();
            }
        }, 1000);

        return { status: 'STREAM_ACTIVE', ttl: this.getRemainingTime() };
    }

    expireAndWipe() {
        this.stop();
        this.zeroFillBuffer();

        if (typeof this.onExpireCallback === 'function') {
            this.onExpireCallback({
                code: '3001',
                message: 'TTL expired. Volatile RAM buffer zero-filled.'
            });
        }
    }

    zeroFillBuffer() {
        if (this.activeBuffer) {
            for (let key in this.activeBuffer) {
                if (typeof this.activeBuffer[key] === 'string') {
                    this.activeBuffer[key] = '0x000000_WIPED';
                }
            }
        }
        this.activeBuffer = null;
    }

    stop() {
        if (this.timerId) {
            clearInterval(this.timerId);
            this.timerId = null;
        }
    }

    getRemainingTime() {
        if (!this.timerId) return 0;
        return Math.max(0, Math.ceil((this.expiresAt - Date.now()) / 1000));
    }
}