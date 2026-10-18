/**
 * vCGE-MOD01: "cannot run in this browser" page
 * Created by raven575, Team vCGE (Claude) & Gemini
 *
 * Lists what is missing, from the reason codes browserGate.js put after the '#' (it never leaves the device).
 * ES5 only, so it runs in the oldest browsers. Unknown codes are ignored; text is set as text, never as HTML.
 */
(function () {
    'use strict';
    var REASONS = {
        modules: 'Modern JavaScript, which vCGE is written in.',
        csp: 'Content Security Policy, the lock that keeps vCGE offline.',
        https: 'A secure (https://) connection. Open vCGE from its https:// address.',
        crypto: 'Web Crypto, which protects your card behind the PIN.',
        wasm: 'WebAssembly, which reads the business card on this device.',
        worker: 'Web Workers, which read the business card on this device.',
        netlock: 'vCGE’s own network lock could not start.',
        script: 'This browser could not read vCGE’s code.'
    };
    var codes = decodeURIComponent((window.location.hash || '').replace(/^#/, '')).split(',');
    var list = document.getElementById('reasonList');
    var shown = 0;
    for (var i = 0; i < codes.length; i++) {
        if (!Object.prototype.hasOwnProperty.call(REASONS, codes[i])) continue;
        var li = document.createElement('li');
        li.setAttribute('data-reason', codes[i]);
        li.appendChild(document.createTextNode(REASONS[codes[i]]));
        list.appendChild(li);
        shown++;
    }
    if (shown) {
        var section = document.getElementById('reasons');
        section.className = section.className.replace(/\s*\bhidden\b/, '');
    }
})();
