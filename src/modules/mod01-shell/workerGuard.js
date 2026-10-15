/**
 * vCGE-MOD01: network lock for the OCR worker
 * Created by raven575, Gemini & Claude
 *
 * A worker has its own fetch and XMLHttpRequest, which the page's interceptor (shell.js) cannot reach, and on a web
 * server the page's CSP meta tag does not apply inside it either. MOD04 starts Tesseract through this classic worker
 * script: it installs the same same-origin rule, then loads the real Tesseract worker named after the '#'.
 * (A fragment, not a query string, so no server or Tauri asset lookup ever sees it.)
 */
(() => {
    const here = new URL(self.location.href);
    const isSameOrigin = (url) => {
        try {
            const u = new URL(url, here);
            return u.protocol === here.protocol && u.host === here.host;
        } catch (e) { return false; }
    };
    const block = (api, url) => {
        let target = 'invalid URL';
        try { const u = new URL(url, here); target = `${u.protocol}//${u.host}`; } catch (e) { /* keep the label */ }
        console.warn(`[Gatekeeper BLOCK] ${api} to ${target} blocked in the OCR worker: direct network egress is not permitted.`);
        return new Error('vCGE Gatekeeper: network egress blocked');
    };

    const nativeFetch = self.fetch;
    self.fetch = function (input, init) {
        const url = input instanceof Request ? input.url : String(input);
        if (!isSameOrigin(url)) return Promise.reject(new TypeError(block('fetch', url).message));
        return nativeFetch.call(this, input, init);
    };

    const nativeOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        if (!isSameOrigin(url)) throw block('XMLHttpRequest', url);
        return nativeOpen.call(this, method, url, ...rest);
    };

    const nativeImportScripts = self.importScripts.bind(self);
    self.importScripts = (...urls) => {
        const bad = urls.find(u => !isSameOrigin(u));
        if (bad !== undefined) throw block('importScripts', bad);
        return nativeImportScripts(...urls);
    };

    if (self.WebSocket) self.WebSocket = function (url) { throw block('WebSocket', url); };
    if (self.EventSource) self.EventSource = function (url) { throw block('EventSource', url); };

    const worker = decodeURIComponent(here.hash.slice(1));
    if (!worker || !isSameOrigin(worker)) throw block('importScripts', worker || '(no worker script)');
    self.importScripts(new URL(worker, here).href);
})();
