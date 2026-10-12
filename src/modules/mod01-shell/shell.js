/**
 * vCGE-MOD01: Container Shell & Security Gatekeeper
 * Created by raven575, Gemini & Claude
 *
 * Imported first by src/main.js so the network interceptor is installed before any other module runs.
 */
import { globalEventBus, Events } from '../../share/eventBus.js';

window.vCGE = window.vCGE || {};
window.vCGE.bus = globalEventBus;

// Action-level gatekeeper: outbound intents must be dispatched by vCGE-MOD08.
export function enforceGatekeeper(sourceModule, action) {
    const unauthorizedDirectEgress = ['FETCH_EXTERNAL_API', 'SOCKET_CONNECT', 'UNAUTHORIZED_FILE_DROP'];
    if (unauthorizedDirectEgress.includes(action)) {
        console.warn(`[Gatekeeper BLOCK] Unauthorized egress attempt blocked from ${sourceModule} performing ${action}`);
        return false;
    }
    return true;
}

// Network interceptor: sub-modules may not reach any non-local host. Same-origin requests (local assets) are allowed;
// everything else is blocked and reported on the bus. Outbound sharing goes through MOD08 (share sheet,
// downloads, mailto/sms, print), none of which uses these APIs. The CSP in index.html enforces the same rule.
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
    console.warn(`[Gatekeeper BLOCK] ${api} to ${url} blocked: direct network egress is not permitted.`);
    globalEventBus.publish(Events.EGRESS_BLOCKED, { api, url: String(url), timestamp: Date.now() });
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
