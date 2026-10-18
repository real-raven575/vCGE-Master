/**
 * vCGE-MOD01: browser gate
 * Created by raven575, Gemini & Claude
 *
 * A classic script loaded by index.html right after netLock.js, before every other script. It only checks features:
 * nothing is sent, stored or fetched. It is written in ES5 so that even very old browsers (Internet Explorer 11)
 * can run it and show a clear page instead of a blank one.
 *
 * Block: when a protection vCGE relies on is missing, the app never starts and the "cannot run in this browser" page
 * opens (unsupported/index.html, with the reasons after the '#', which never leaves the device).
 * Start: only when nothing blocks does the gate load the app (src/main.js) itself, once the page has been read. The
 * page has no script tag for it, so the browser cannot fetch it ahead of the checks (decision: raven575, 2026-10-18).
 * Warn: when vCGE's own protections hold but something outside the app is weak (an out-of-support system or browser
 * engine) or a feature is missing (camera, 3D flip), the app runs and a banner says so.
 * Decision: raven575, 2026-10-15 (see /mnt/project-files/notes/legacy-browser-support.md).
 */
(function () {
    'use strict';
    var UNSUPPORTED_PAGE = 'src/modules/mod01-shell/unsupported/index.html';
    // The app's entry: src/main.js in the source; the Vite build names its bundle in <meta name="vcge-app">.
    var APP_ENTRY = 'src/main.js';

    // Returns the codes of missing protections. `env` is the window (or a test double).
    function blockReasons(env) {
        var reasons = [];
        var doc = env.document;
        var script = doc && doc.createElement ? doc.createElement('script') : {};
        if (!('noModule' in script)) reasons.push('modules');
        // Browsers that enforce a Content-Security-Policy (the offline lock) also report violations with this event.
        if (typeof env.SecurityPolicyViolationEvent !== 'function') reasons.push('csp');
        if (env.isSecureContext === false) reasons.push('https');
        if (!env.crypto || !env.crypto.subtle) reasons.push('crypto');
        if (typeof env.WebAssembly !== 'object' || !env.WebAssembly) reasons.push('wasm');
        if (typeof env.Worker !== 'function') reasons.push('worker');
        // netLock.js marks its fetch wrapper; without it vCGE's own network lock is not in place (fail closed).
        var hasSymbol = typeof env.Symbol === 'function' && typeof env.Symbol['for'] === 'function';
        if (!hasSymbol || !env.fetch || !env.fetch[env.Symbol['for']('vcge.netLock')]) reasons.push('netlock');
        return reasons;
    }

    // Returns the codes of things to warn about while the app runs.
    function warnReasons(env) {
        var reasons = [];
        var ua = (env.navigator && env.navigator.userAgent) || '';
        // Windows 7, 8 and 8.1 (NT 6.1 to 6.3) no longer get security updates.
        if (/Windows NT 6\.[123]\b/.test(ua)) reasons.push('oldos');
        // Chromium 109 is the last release for those systems (also the desktop app's frozen WebView2 there).
        var chromium = /(?:Chrome|Chromium|Edg)\/(\d+)\./.exec(ua);
        if (chromium && parseInt(chromium[1], 10) <= 109) reasons.push('oldengine');
        var media = env.navigator && env.navigator.mediaDevices;
        if (!media || typeof media.getUserMedia !== 'function') reasons.push('nocamera');
        var css = env.CSS;
        if (!css || typeof css.supports !== 'function' || !css.supports('transform-style', 'preserve-3d')) reasons.push('no3d');
        return reasons;
    }

    var WARNINGS = {
        oldos: 'This computer’s operating system no longer gets security updates.',
        oldengine: 'This browser engine no longer gets security updates.',
        nocamera: 'The camera isn’t available here. Use Upload image instead.',
        no3d: 'The 3D card flip isn’t supported here, so the card shows flat.'
    };

    function showUnsupported(env, reasons) {
        if (env.__vcgeGateBlocked) return;
        env.__vcgeGateBlocked = true;
        // Stop loading the rest of the page so no app code starts, then open the bundled page.
        try {
            if (typeof env.stop === 'function') env.stop();
            else if (env.document && env.document.execCommand) env.document.execCommand('Stop');
        } catch (e) { /* keep going */ }
        env.location.replace(UNSUPPORTED_PAGE + '#' + reasons.join(','));
    }

    function showBanner(env, reasons) {
        var doc = env.document;
        var banner = doc.createElement('div');
        banner.id = 'browserGateBanner';
        banner.className = 'vcge-gate-banner';
        banner.setAttribute('role', 'status');
        var title = doc.createElement('p');
        title.className = 'vcge-gate-banner-title';
        title.appendChild(doc.createTextNode('vCGE is running with its protections on. Heads up:'));
        banner.appendChild(title);
        var list = doc.createElement('ul');
        for (var i = 0; i < reasons.length; i++) {
            var li = doc.createElement('li');
            li.appendChild(doc.createTextNode(WARNINGS[reasons[i]]));
            list.appendChild(li);
        }
        banner.appendChild(list);
        var ok = doc.createElement('button');
        ok.type = 'button';
        ok.id = 'browserGateDismiss';
        ok.className = 'vcge-gate-banner-dismiss';
        ok.appendChild(doc.createTextNode('OK'));
        // Dismissed for this visit only: nothing is stored.
        ok.addEventListener('click', function () { if (banner.parentNode) banner.parentNode.removeChild(banner); });
        banner.appendChild(ok);
        doc.body.insertBefore(banner, doc.body.firstChild);
    }

    // Returns the URL of the app's code: the build's bundle when the page names one, else the source entry.
    function appEntry(doc) {
        var meta = doc.querySelector ? doc.querySelector('meta[name="vcge-app"]') : null;
        return (meta && meta.getAttribute('content')) || APP_ENTRY;
    }

    // Loads the app as an ES module after the page has been read (as the old deferred module tag did), never once
    // the "cannot run" page is opening.
    function startApp(env) {
        var doc = env.document;
        function load() {
            if (env.__vcgeGateBlocked) return;
            var script = doc.createElement('script');
            script.type = 'module';
            script.src = appEntry(doc);
            doc.body.appendChild(script);
        }
        if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', load);
        else load();
    }

    function run(env) {
        var blocked = blockReasons(env);
        if (blocked.length) { showUnsupported(env, blocked); return; }
        // An engine that cannot read vCGE's code (a SyntaxError while its scripts load) must not leave a blank page.
        // Only until the page has loaded: scripts are parsed by then, and a later error must never wipe a card.
        function onError(e) {
            var err = e && e.error;
            var syntax = (err && err.name === 'SyntaxError') || /SyntaxError/.test(String(e && e.message));
            if (syntax) showUnsupported(env, ['script']);
        }
        env.addEventListener('error', onError, true);
        env.addEventListener('load', function () { env.removeEventListener('error', onError, true); });
        startApp(env);
        var warn = warnReasons(env);
        if (!warn.length) return;
        if (env.document.readyState === 'loading') env.document.addEventListener('DOMContentLoaded', function () { showBanner(env, warn); });
        else showBanner(env, warn);
    }

    if (typeof module === 'object' && module.exports) {
        module.exports = { blockReasons: blockReasons, warnReasons: warnReasons, WARNINGS: WARNINGS, UNSUPPORTED_PAGE: UNSUPPORTED_PAGE,
            APP_ENTRY: APP_ENTRY, appEntry: appEntry, startApp: startApp };
    } else {
        run(window);
    }
})();
