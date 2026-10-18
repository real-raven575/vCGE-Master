/**
 * vCGE-MOD01: network lock for the page
 * Created by raven575, Team vCGE (Claude) & Gemini
 *
 * A classic script loaded by index.html at the top of <head>, so it runs before the bundled libraries and every module
 * (module scripts are deferred). Sub-modules may not reach any non-local host: same-origin requests (local assets) are
 * allowed, everything else is blocked. Outbound sharing goes through MOD08 (share sheet, downloads, mailto/sms, print),
 * none of which uses these APIs. The CSP in index.html enforces the same rule; workerGuard.js does it for the OCR worker.
 * Each block is announced as a 'vcge:egress-blocked' window event with the API and the scheme + host only (a URL's path
 * or query could carry the data it tried to send); shell.js puts it on the event bus for the audit log.
 */
(() => {
    const LOCK = Symbol.for('vcge.netLock');
    if (window.fetch && window.fetch[LOCK]) return;

    // Compares scheme + host rather than `origin`, which is the opaque "null" for custom schemes like tauri://.
    // Tauri's own IPC endpoints (ipc://localhost, http://ipc.localhost on Windows) are local and allowed.
    function isSameOrigin(url) {
        try {
            const u = new URL(url, window.location.href);
            if (u.protocol === 'ipc:' || u.hostname === 'ipc.localhost') return true;
            return u.protocol === window.location.protocol && u.host === window.location.host;
        } catch (e) { return false; }
    }
    function blockEgress(api, url) {
        let target = 'invalid URL';
        try { const u = new URL(url, window.location.href); target = `${u.protocol}//${u.host}`; } catch (e) { /* keep the label */ }
        console.warn(`[Gatekeeper BLOCK] ${api} to ${target} blocked: direct network egress is not permitted.`);
        window.dispatchEvent(new CustomEvent('vcge:egress-blocked', { detail: { api, url: target, timestamp: Date.now() } }));
    }

    const nativeFetch = window.fetch;
    if (nativeFetch) {
        window.fetch = function (input, init) {
            const url = input instanceof Request ? input.url : String(input);
            if (!isSameOrigin(url)) {
                blockEgress('fetch', url);
                return Promise.reject(new TypeError('vCGE Gatekeeper: network egress blocked'));
            }
            return nativeFetch.call(this, input, init);
        };
        Object.defineProperty(window.fetch, LOCK, { value: true });
    }

    if (window.XMLHttpRequest) {
        const nativeOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function (method, url, ...rest) {
            if (!isSameOrigin(url)) {
                blockEgress('XMLHttpRequest', url);
                throw new Error('vCGE Gatekeeper: network egress blocked');
            }
            return nativeOpen.call(this, method, url, ...rest);
        };
    }

    if (navigator.sendBeacon) {
        const nativeBeacon = navigator.sendBeacon.bind(navigator);
        navigator.sendBeacon = function (url, data) {
            if (!isSameOrigin(url)) { blockEgress('sendBeacon', url); return false; }
            return nativeBeacon(url, data);
        };
    }

    if (window.WebSocket) {
        window.WebSocket = function (url) {
            blockEgress('WebSocket', url);
            throw new Error('vCGE Gatekeeper: network egress blocked');
        };
    }

    if (window.EventSource) {
        const NativeEventSource = window.EventSource;
        window.EventSource = function (url, config) {
            if (!isSameOrigin(url)) {
                blockEgress('EventSource', url);
                throw new Error('vCGE Gatekeeper: network egress blocked');
            }
            return new NativeEventSource(url, config);
        };
    }
})();
