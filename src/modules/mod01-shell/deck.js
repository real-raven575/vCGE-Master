/**
 * vCGE-MOD01: Postcard deck, header and the sheets that open over it (redesign step 2)
 * Created by raven575, Team vCGE (Claude) & Gemini
 *
 * One horizontal track of cards, one card per step: Welcome, Capture (MOD03), Read (MOD04), Fields (MOD05),
 * 3D Card (MOD06, with the QR on its back, MOD07) and Share (MOD08). The track is a native scroll container that
 * settles on a card once scrolling stops (a swipe: as the finger lifts), so a swipe, a trackpad, the arrow keys or a header icon all move it. Only the card in view is
 * interactive: the others are hidden from screen readers and a tap on one brings it into view instead.
 *
 * Hooks for the other modules (set by main.js with `use`, never by importing another module here):
 *   toast(message)   MOD06's toast; wipe(cardName) the red trash button on each card (MOD02 replaces it with
 *   hold-to-wipe); cancel() wipes the session for the Welcome card's CANCEL; showQr() flips the 3D card to its QR
 *   back (header Checkers icon), showFront() back to its front (header Flipside icon); startOver() opens vCGE afresh
 *   (the Thank You page's START OVER; MOD02's startFresh). setFace(face) tells the header
 *   which side of the 3D card is up, so only Flipside (front) or Checkers (back) is lit, never both.
 * Signals: the bus carries CARD_CHANGED { from, to } when the card in view changes (a hand-off MOD02's padlock
 * can follow) and `beforeChange` listeners run before a programmatic move (MOD04's blink-out), never any data.
 */
import { globalEventBus, Events } from '../../share/eventBus.js';

export const CARDS = ['welcome', 'capture', 'read', 'fields', 'card', 'share'];
export const SWIPE_PX = 80;              // a sideways drag this long over a sheet closes it (same as Cancel)
export const INTENT_PX = 24;             // a swipe of the deck longer than this goes on to the next card; a shorter one goes back
export const EDGE_PX = 48;               // no drag control within this much of the screen edge (browser back gesture)

const $ = (id) => document.getElementById(id);
const hooks = { toast: null, wipe: null, cancel: null, showQr: null, showFront: null, startOver: null };
const beforeChange = [];
let currentName = null, track = null, cards = [], settleTimer = null, settlePending = false;
let settledLeft = 0;          // where the deck last came to rest (the direction of a later scroll is read from here)
let goTarget = null;          // where a smooth move of the deck's own is heading, until it arrives
let cardFace = 'front';       // which side of the 3D card is up (MOD06 reports it through setFace)

export function use(h) { Object.assign(hooks, h); }
export function onBeforeChange(fn) { beforeChange.push(fn); return () => beforeChange.splice(beforeChange.indexOf(fn), 1); }
export function current() { return currentName; }
export function cardEl(name) { return $(`card${name[0].toUpperCase()}${name.slice(1)}`); }

// Which card is nearest the middle of the track.
function nearest() {
    if (!track) return null;
    const mid = track.scrollLeft + track.clientWidth / 2;
    let best = null, bestDist = Infinity;
    cards.forEach(card => {
        const d = Math.abs(card.offsetLeft + card.offsetWidth / 2 - mid);
        if (d < bestDist) { bestDist = d; best = card; }
    });
    return best ? best.dataset.card : null;
}

// The scroll position that centres a card (as near as the track can scroll, at either end).
const centreOf = (card) => Math.max(0, Math.min(track.scrollWidth - track.clientWidth, card.offsetLeft + card.offsetWidth / 2 - track.clientWidth / 2));
function centre(name, behavior) {
    const left = centreOf(cardEl(name));
    const away = Math.abs(track.scrollLeft - left) > 1;
    stopTween();
    if (behavior === 'smooth' && away) { tweenTo(left); return; }
    goTarget = null;
    if (away) track.scrollTo({ left, behavior: 'auto' });
    settledLeft = left;
}

// The deck's own moves are animated here (an ease-out of up to 0.45 s) rather than by the browser's smooth scroll,
// which some webviews stall or cut short. A frame that does not come within 150 ms ends the move at its target.
let tween = null, tweenWatch = null;
function stopTween() {
    if (tween) cancelAnimationFrame(tween);
    clearTimeout(tweenWatch);
    tween = tweenWatch = null;
    if (track) track.style.overflowX = '';      // a fling stopped at the finger's lift (below) scrolls again
}
function tweenTo(left) {
    goTarget = left;
    const from = track.scrollLeft, dist = left - from, dur = Math.min(450, 200 + Math.abs(dist) / 4), t0 = performance.now();
    const end = () => { stopTween(); track.scrollLeft = left; goTarget = null; settledLeft = left; };
    const step = (now) => {
        clearTimeout(tweenWatch);
        const p = Math.min(1, (now - t0) / dur);
        track.scrollLeft = from + dist * (1 - Math.pow(1 - p, 3));
        if (p >= 1) { end(); return; }
        tween = requestAnimationFrame(step);
        tweenWatch = setTimeout(end, 150);
    };
    tween = requestAnimationFrame(step);
    tweenWatch = setTimeout(end, 150);
}

// Which card a scroll was heading for. A scroll that ended on a card's centre (a move of the deck's own, a card scrolled
// into view) wanted that card. Anything else is a swipe, or one element brought into view (a focused field, a button
// being pressed): it goes one card on from where the deck last rested, in the direction it moved, however far a fling
// carried it, and a move shorter than INTENT_PX goes back (a finger that drifted while scrolling a card up and down).
export function pickCard(names, centres, left, restedLeft) {
    const near = names.findIndex((_, i) => Math.abs(left - centres[i]) <= 2);
    if (near >= 0) return names[near];
    let from = centres.findIndex(c => Math.abs(c - restedLeft) <= 2);
    if (from < 0) from = centres.reduce((best, c, i) => Math.abs(c - restedLeft) < Math.abs(centres[best] - restedLeft) ? i : best, 0);
    const moved = left - restedLeft;
    if (Math.abs(moved) < INTENT_PX) return names[from];
    return names[Math.max(0, Math.min(names.length - 1, from + Math.sign(moved)))];
}
const pick = () => pickCard(cards.map(c => c.dataset.card), cards.map(centreOf), track.scrollLeft, settledLeft);

function setCurrent(name) {
    if (!name || name === currentName) return;
    const from = currentName;
    currentName = name;
    cards.forEach(card => {
        const on = card.dataset.card === name;
        card.classList.toggle('is-current', on);
        card.setAttribute('aria-hidden', on ? 'false' : 'true');
    });
    markNav();
    document.documentElement.dataset.card = name;
    globalEventBus.publish(Events.CARD_CHANGED, { from, to: name, timestamp: Date.now() });
}

// The header icon of the card in view is lit. The 3D card has two (Flipside for its front, Checkers for its QR back):
// only the one for the side that is up.
function markNav() {
    document.querySelectorAll('.deck-nav [data-card]').forEach(b => {
        const on = b.dataset.card === currentName && (b.dataset.card !== 'card' || (b.dataset.qr !== undefined) === (cardFace === 'back'));
        b.classList.toggle('is-on', on);
        if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
}

/** @param {'front'|'back'} face  the side of the 3D card that is up */
export function setFace(face) {
    cardFace = face === 'back' ? 'back' : 'front';
    markNav();
}

// Scrolls the track so `name` is in view. Listeners registered with onBeforeChange run first (they may delay).
export async function go(name, options = {}) {
    const card = cardEl(name);
    if (!card || !track) return;
    if (name === currentName && !options.force) return;
    if (!options.silent) for (const fn of beforeChange) { try { await fn({ from: currentName, to: name }); } catch (e) { console.error('[vCGE-MOD01] beforeChange listener failed:', e); } }
    clearTimeout(settleTimer); settlePending = false;      // a settle left over from the last move must not undo this one
    centre(name, options.instant || reducedMotion() ? 'auto' : 'smooth');
    setCurrent(name);
}

export function next() { const i = CARDS.indexOf(currentName); if (i >= 0 && i < CARDS.length - 1) go(CARDS[i + 1]); }
export function prev() { const i = CARDS.indexOf(currentName); if (i > 0) go(CARDS[i - 1]); }

const reducedMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---- Sheets: pages that open over the deck (Vault page, Settings). Esc, the close button or a sideways swipe closes. --

export function openSheet(id) {
    const sheet = $(id);
    if (!sheet) return;
    sheet.classList.remove('hidden');
    const first = sheet.querySelector('[data-sheet-focus]') || sheet.querySelector('button, input, select');
    if (first) first.focus();
}

export function closeSheet(id) {
    const sheet = $(id);
    if (sheet) sheet.classList.add('hidden');
}

export function sheetOpen(id) { const s = $(id); return !!s && !s.classList.contains('hidden'); }

function wireSheet(sheet) {
    sheet.querySelectorAll('[data-sheet-close]').forEach(b => b.addEventListener('click', () => closeSheet(sheet.id)));
    // A sideways swipe anywhere on the sheet closes it, like Cancel. Drags on sliders and text keep working.
    let start = null;
    sheet.addEventListener('pointerdown', (e) => {
        if (e.pointerType !== 'touch' || e.target.closest('input, textarea, select, [data-no-swipe]')) { start = null; return; }
        start = { x: e.clientX, y: e.clientY };
    });
    sheet.addEventListener('pointerup', (e) => {
        if (!start) return;
        const dx = e.clientX - start.x, dy = e.clientY - start.y;
        start = null;
        if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > Math.abs(dy) * 1.5) closeSheet(sheet.id);
    });
}

// ---- Boot --------------------------------------------------------------------------------------------------------

export function initDeck() {
    track = $('deck');
    if (!track) return;
    cards = Array.from(track.querySelectorAll('.deck-card'));
    cards.forEach(card => {
        // The cover sits over a card that is not in view: a tap on it brings the card in, nothing underneath is pressed.
        const cover = document.createElement('div');
        cover.className = 'deck-cover';
        cover.addEventListener('click', () => go(card.dataset.card));
        card.append(cover);
        const trash = card.querySelector('.vcge-trash');
        if (trash) trash.addEventListener('click', () => { if (hooks.wipe) hooks.wipe(card.dataset.card); });
    });
    document.querySelectorAll('.deck-nav [data-card]').forEach(b => b.addEventListener('click', () => {
        go(b.dataset.card);
        if (b.dataset.card !== 'card') return;
        if (b.dataset.qr !== undefined) { if (hooks.showQr) hooks.showQr(); } else if (hooks.showFront) hooks.showFront();
        setFace(b.dataset.qr !== undefined ? 'back' : 'front');    // MOD06 confirms it, and reports its own Flip button
    }));
    document.querySelectorAll('.vcge-sheet').forEach(wireSheet);
    document.querySelectorAll('[data-open-sheet]').forEach(b => b.addEventListener('click', () => openSheet(b.dataset.openSheet)));

    // The card in view follows the scroll position (a swipe, a trackpad, a focused field scrolled into view), settled a
    // moment after scrolling stops: the deck picks a card and eases it into the middle. Nothing moves while a finger or
    // mouse button is down (a press would land on the wrong spot, and a finger that pauses mid-swipe would have the deck
    // pulled out from under it): that settle waits for the release. A finger is counted by its touch events, because a
    // browser that takes a touch over for scrolling cancels its pointer events while the finger is still down.
    // A finger that moved the deck settles it the moment it lifts: the fling it leaves behind is stopped and the deck
    // eases to its card at once, instead of coasting first and settling only when the fling runs out (on the iPad a
    // fling kept the deck sliding for a beat, then it turned back to the card).
    let pointerHeld = false, touchesDown = 0, holdTimer = null, swiped = false;
    const held = () => pointerHeld || touchesDown > 0;
    const settle = () => {
        if (held()) { settlePending = true; track.dataset.deck = 'held'; return; }
        // A move of the deck's own is still running: its next frame, or the 150 ms watchdog, ends it at the target.
        // Settling here would jump ahead and then let that frame drag the deck back between cards, and the settle
        // after it would pick the card in between (a slow webview showed this: Capture to Fields ended on Read).
        if (tween) { settleTimer = setTimeout(settle, 80); return; }
        track.dataset.deck = 'still';
        if (goTarget !== null) {
            // A move of the deck's own: arrived, or its animation stalled (a slow frame, a headless webview) and the
            // deck sat between cards. Either way it ends where it was heading.
            if (Math.abs(track.scrollLeft - goTarget) > 2) track.scrollTo({ left: goTarget, behavior: 'auto' });
            settledLeft = goTarget; goTarget = null;
            setCurrent(nearest());
            return;
        }
        const name = pick();
        setCurrent(name);
        centre(name, reducedMotion() ? 'auto' : 'smooth');
    };
    const onScroll = () => {
        // A move of the deck's own that reaches its target is over at once, so a scroll that follows it is read as new.
        if (goTarget !== null && Math.abs(track.scrollLeft - goTarget) <= 2) { settledLeft = goTarget; goTarget = null; }
        track.dataset.deck = 'moving';      // read by the tests: moving, held (a press is down) or still
        if (held()) armHold();              // a finger still moving the deck is not a hold
        if (touchesDown > 0) swiped = true;
        clearTimeout(settleTimer); settleTimer = setTimeout(settle, 80);
    };
    const release = () => {
        if (touchesDown > 0) return;        // a finger is still down (its pointer was only cancelled for scrolling)
        clearTimeout(holdTimer); pointerHeld = false;
        const lift = swiped; swiped = false;
        if (settlePending || lift) { settlePending = false; clearTimeout(settleTimer); settle(); }
        if (lift) stopFling();
    };
    // The fling stops when the track briefly cannot be scrolled by the user. The deck's own move still runs (it sets
    // scrollLeft) and puts the track back when it ends or a finger takes over; with no move to run, it is back next frame.
    function stopFling() {
        track.style.overflowX = 'hidden';
        requestAnimationFrame(() => { if (!tween) track.style.overflowX = ''; });
    }
    // A press still down a second and a half after the deck last moved is a hold, not a swipe: the deck settles anyway
    // (and a webview that never reports the release cannot keep the deck from settling).
    function armHold() { clearTimeout(holdTimer); holdTimer = setTimeout(() => { touchesDown = 0; release(); }, 1500); }
    document.addEventListener('pointerdown', () => { pointerHeld = true; armHold(); }, true);
    document.addEventListener('touchstart', (e) => { touchesDown = e.touches.length; armHold(); }, { capture: true, passive: true });
    ['touchend', 'touchcancel'].forEach(t => document.addEventListener(t, (e) => { touchesDown = e.touches.length; }, { capture: true, passive: true }));
    // A finger or a wheel on the track takes over from a move in flight.
    const takeOver = () => { stopTween(); goTarget = null; };
    track.addEventListener('pointerdown', takeOver, { passive: true });
    track.addEventListener('wheel', takeOver, { passive: true });
    // Every way a press can end (some webviews send only the mouse or touch form of it).
    // (The touch counter above runs first: both listen on the document in the capture phase, in the order added.)
    ['pointerup', 'pointercancel', 'mouseup', 'touchend', 'touchcancel', 'click', 'dragend'].forEach(t => document.addEventListener(t, release, true));
    window.addEventListener('blur', release);
    track.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', () => { if (currentName) go(currentName, { force: true, instant: true, silent: true }); });

    // Arrow keys move the deck when nothing is being typed and no sheet or dialog is open.
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        if (e.altKey || e.metaKey || e.ctrlKey) return;
        const t = e.target;
        if (t && t.closest && t.closest('input, textarea, select, [contenteditable], .vcge-sheet, [role="dialog"], [role="alertdialog"], .crop-handle')) return;
        if (document.querySelector('.vcge-sheet:not(.hidden), .vcge-modal:not(.hidden)')) return;
        e.preventDefault();
        if (e.key === 'ArrowRight') next(); else prev();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        const open = Array.from(document.querySelectorAll('.vcge-sheet:not(.hidden)')).pop();
        if (open) { e.preventDefault(); closeSheet(open.id); }
    });

    fitHeader();
    setCurrent(nearest() || CARDS[0]);
}

// The header shows the pilot names beside the icons only while every name fits in its button; otherwise (a narrow or
// portrait window, a wide UI font, the Lock button showing) it is icons only, so no button ever runs into the next.
function fitHeader() {
    const header = document.querySelector('.deck-header'), nav = header && header.querySelector('.deck-nav');
    if (!nav) return;
    const buttons = Array.from(nav.querySelectorAll('button'));
    let queued = false;
    const fit = () => {
        queued = false;
        header.classList.remove('is-compact');
        // Measured by where the buttons are, not only by scrollWidth: in WebKit (Safari, iPad) a mirrored nav (left hand,
        // row-reverse) spills to its left, and scrollWidth does not count overflow on that side.
        const box = nav.getBoundingClientRect();
        const spills = nav.scrollWidth > nav.clientWidth + 0.5 || buttons.some(b => {
            const r = b.getBoundingClientRect();
            return b.scrollWidth > b.clientWidth + 0.5 || r.left < box.left - 0.5 || r.right > box.right + 0.5;
        });
        header.classList.toggle('is-compact', spills);
    };
    const refit = () => { if (!queued) { queued = true; requestAnimationFrame(fit); } };
    fit();
    if (window.ResizeObserver) {
        const ro = new ResizeObserver(refit);
        ro.observe(header);
        header.querySelectorAll('.deck-brand, .deck-tools').forEach(el => ro.observe(el));
    }
    window.addEventListener('resize', refit);
    // A new UI font (Settings) changes how wide the names are; so does a font file finishing loading.
    new MutationObserver(refit).observe(document.documentElement, { attributes: true, attributeFilter: ['data-font', 'data-hand'] });
    if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', refit);

}

export function toast(message) { if (hooks.toast) hooks.toast(message); }
export function requestCancel() { if (hooks.cancel) hooks.cancel(); }
export function requestStartOver() { if (hooks.startOver) hooks.startOver(); else location.reload(); }
