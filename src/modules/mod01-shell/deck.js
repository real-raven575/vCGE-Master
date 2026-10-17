/**
 * vCGE-MOD01: Postcard deck, header and the sheets that open over it (redesign step 2)
 * Created by raven575, Gemini & Claude
 *
 * One horizontal track of cards, one card per step: Welcome, Capture (MOD03), Read (MOD04), Fields (MOD05),
 * 3D Card (MOD06, with the QR on its back, MOD07) and Share (MOD08). The track is a native scroll container that
 * settles on a card once scrolling stops, so a swipe, a trackpad, the arrow keys or a header icon all move it. Only the card in view is
 * interactive: the others are hidden from screen readers and a tap on one brings it into view instead.
 *
 * Hooks for the other modules (set by main.js with `use`, never by importing another module here):
 *   toast(message)   MOD06's toast; wipe(cardName) the red trash button on each card (MOD02 replaces it with
 *   hold-to-wipe); cancel() wipes the session for the Welcome card's CANCEL; showQr() flips the 3D card to its QR
 *   back (header Checkers icon).
 * Signals: the bus carries CARD_CHANGED { from, to } when the card in view changes (a hand-off MOD02's padlock
 * can follow) and `beforeChange` listeners run before a programmatic move (MOD04's blink-out), never any data.
 */
import { globalEventBus, Events } from '../../share/eventBus.js';

export const CARDS = ['welcome', 'capture', 'read', 'fields', 'card', 'share'];
export const SWIPE_PX = 80;              // a sideways drag this long over a sheet closes it (same as Cancel)
export const EDGE_PX = 48;               // no drag control within this much of the screen edge (browser back gesture)

const $ = (id) => document.getElementById(id);
const hooks = { toast: null, wipe: null, cancel: null, showQr: null };
const beforeChange = [];
let currentName = null, track = null, cards = [], settleTimer = null, settlePending = false;
let settledLeft = 0;          // where the deck last came to rest (the direction of a later scroll is read from here)
let goTarget = null;          // where a smooth move of the deck's own is heading, until it arrives

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

// The scroll position that centres a card.
const centreOf = (card) => card.offsetLeft + card.offsetWidth / 2 - track.clientWidth / 2;
function centre(name, behavior) {
    const left = centreOf(cardEl(name));
    const away = Math.abs(track.scrollLeft - left) > 1;
    if (behavior === 'smooth' && away) { goTarget = left; track.scrollTo({ left, behavior }); return; }
    goTarget = null;
    if (away) track.scrollTo({ left, behavior: 'auto' });
    settledLeft = left;
}

// Which card a scroll was heading for. A swipe or a move of the deck's own ends on a card's centre: the nearest card.
// A scroll that stopped off centre only brought one element into view (a focused field, a button being pressed), just
// inside the edge of the middle card slot the deck moved towards (deck.css scroll-padding): the card under that edge is
// the one wanted, even when only a sliver of it shows.
function pick() {
    const name = nearest();
    if (Math.abs(track.scrollLeft - centreOf(cardEl(name))) <= 2) return name;
    const pad = Math.max(0, (track.clientWidth - cards[0].offsetWidth) / 2);
    const x = track.scrollLeft > settledLeft ? track.scrollLeft + track.clientWidth - pad - 1 : track.scrollLeft + pad + 1;
    const under = cards.find(c => c.offsetLeft <= x && x < c.offsetLeft + c.offsetWidth);
    return under ? under.dataset.card : name;
}

function setCurrent(name) {
    if (!name || name === currentName) return;
    const from = currentName;
    currentName = name;
    cards.forEach(card => {
        const on = card.dataset.card === name;
        card.classList.toggle('is-current', on);
        card.setAttribute('aria-hidden', on ? 'false' : 'true');
    });
    document.querySelectorAll('.deck-nav [data-card]').forEach(b => {
        const on = b.dataset.card === name;
        b.classList.toggle('is-on', on);
        if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    document.documentElement.dataset.card = name;
    globalEventBus.publish(Events.CARD_CHANGED, { from, to: name, timestamp: Date.now() });
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
        if (b.dataset.card === 'card' && b.dataset.qr !== undefined && hooks.showQr) hooks.showQr();
    }));
    document.querySelectorAll('.vcge-sheet').forEach(wireSheet);
    document.querySelectorAll('[data-open-sheet]').forEach(b => b.addEventListener('click', () => openSheet(b.dataset.openSheet)));

    // The card in view follows the scroll position (a swipe, a trackpad, a focused field scrolled into view), settled a
    // moment after scrolling stops: the deck picks a card and centres it. Nothing moves while a finger or mouse button
    // is down (a press would land on the wrong spot): that settle waits for the release.
    let pointerHeld = false;
    const settle = () => {
        if (pointerHeld) { settlePending = true; return; }
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
        centre(name, 'auto');
    };
    const onScroll = () => {
        // A move of the deck's own that reaches its target is over at once, so a scroll that follows it is read as new.
        if (goTarget !== null && Math.abs(track.scrollLeft - goTarget) <= 2) { settledLeft = goTarget; goTarget = null; }
        clearTimeout(settleTimer); settleTimer = setTimeout(settle, 80);
    };
    const release = () => { pointerHeld = false; if (settlePending) { settlePending = false; settle(); } };
    document.addEventListener('pointerdown', () => { pointerHeld = true; }, true);
    // A finger or a wheel on the track takes over from a move in flight.
    track.addEventListener('pointerdown', () => { goTarget = null; }, { passive: true });
    track.addEventListener('wheel', () => { goTarget = null; }, { passive: true });
    document.addEventListener('pointerup', release, true);
    document.addEventListener('pointercancel', release, true);
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

    setCurrent(nearest() || CARDS[0]);
}

export function toast(message) { if (hooks.toast) hooks.toast(message); }
export function requestCancel() { if (hooks.cancel) hooks.cancel(); }
