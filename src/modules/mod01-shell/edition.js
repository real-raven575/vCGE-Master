/**
 * vCGE-MOD01: the edition switch (notes/plain-edition-plan.md)
 * Created by raven575, Team vCGE (Claude) & Gemini
 *
 * One code base, two editions. The branded edition (the default) carries the logo, the tagline, the pilots' names and
 * MOD tags, and the pilots as sample contacts. The plain edition keeps every feature and option and leaves all of
 * that out: <html data-edition="plain"> in index.html turns it on (the claude/plain-edition branch sets it). The logo
 * and the tags' Sixtyfour font are drawn only by CSS rules that never match in plain, so plain never fetches them.
 */

export const isPlain = (doc = typeof document !== 'undefined' ? document : null) =>
    !!(doc && doc.documentElement && doc.documentElement.dataset.edition === 'plain');

// The 0.8 shelf (raven575, 2026-11-02): the app looks and moves exactly like Creative's mock-up, so the earlier
// flourishes (the turtle walk, shell plates, padlock hand-off, Iris's wink, Pidge's pop and stamp, the QR stripe reveal,
// Airlock's hatch, falcon and light pop, the wipe sweep, the lock-screen dissolve, the splash zoom) are switched off by
// <html data-shelf="on"> in index.html. Nothing is deleted: removing that one attribute brings them all back.
export const isShelved = (doc = typeof document !== 'undefined' ? document : null) =>
    !!(doc && doc.documentElement && doc.documentElement.dataset.shelf === 'on');

// The dock's step names in plain (a button's span), and the "(Name)" of the pilot taken out of every top bar and dock label.
export const PLAIN_NAV = Object.freeze({
    navCapture: 'Capture', navRead: 'Read', navFields: 'Details', navCard: 'Card', navShare: 'Share', navQr: 'QR'
});
export const PLAIN_THANKS = 'Session ended.';

// Plain: the top bar and the dock name each step instead of its pilot, the Thank You page reads plainly, and the page is marked
// ready (ui.css keeps the header's names hidden until then, so a pilot's name never shows for a moment).
export function applyEdition(doc = document) {
    if (!isPlain(doc)) return;
    doc.querySelectorAll('.deck-header button[aria-label], .vcge-dock button[aria-label]').forEach(b => {
        for (const attr of ['aria-label', 'title']) {
            const v = b.getAttribute(attr);
            if (v) b.setAttribute(attr, v.replace(/ \([A-Z][a-z]+\)$/, ''));
        }
        const span = b.querySelector(':scope > span');
        if (span && PLAIN_NAV[b.id]) span.textContent = PLAIN_NAV[b.id];
    });
    const thanks = doc.getElementById('thankYouText');
    if (thanks) thanks.textContent = PLAIN_THANKS;
    doc.documentElement.classList.add('edition-ready');
}
