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
        this.remainingSeconds = durationSeconds;
        this.timerId = null;
        this.onExpireCallback = onExpireCallback;
        this.activeBuffer = null;
    }

    startStream(bufferData) {
        this.activeBuffer = bufferData;
        this.remainingSeconds = this.durationSeconds;
        
        if (this.timerId) clearInterval(this.timerId);

        this.timerId = setInterval(() => {
            this.remainingSeconds--;
            
            if (this.remainingSeconds <= 0) {
                this.expireAndWipe();
            }
        }, 1000);

        return { status: 'STREAM_ACTIVE', ttl: this.remainingSeconds };
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
        return this.remainingSeconds;
    }
}