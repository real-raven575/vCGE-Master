/**
 * vCGE-MOD01: The app shell: one screen at a time, the head over it, the dock under it, and the sheets (0.8 redo, R1)
 * Created by raven575, Herd of Helpers (claude) & gemini
 *
 * Built to Team Creative's mock-up (CRTV-0020, vcge-0.6-preview.html). Six screens, one per step: Welcome, Capture
 * (MOD03), Read (MOD04), Details (MOD05), Card (MOD06, with the QR on its back, MOD07) and Share (MOD08). Only the
 * screen in view is shown; a new one slides in from the side it comes from (280 ms, `.enter-f` / `.enter-b`).
 * The head shows the screen's step, its pilot and its title (the data-* attributes on each section). The dock has the
 * five steps (done / now / todo), Back, and the primary button, which presses the screen's own next button
 * (data-next) so every module keeps its own handler, and shows that button's disabled state.
 * A sideways swipe on a screen goes one step on or back (pickCard), like the dock.
 *
 * Hooks for the other modules (set by main.js with `use`, never by importing another module here):
 *   toast(message)   MOD06's toast; wipe(cardName) the trash button (MOD02's hold-to-wipe); cancel() wipes the session
 *   for the Welcome card's CANCEL; showQr() flips the 3D card to its QR back, showFront() back to its front;
 *   startOver() opens vCGE afresh (the Thank You page's START OVER; MOD02's startFresh). setFace(face) tells the shell
 *   which side of the 3D card is up.
 * Signals: the bus carries CARD_CHANGED { from, to } when the screen in view changes, and `beforeChange` listeners run
 * before a programmatic move (MOD04's blink-out), never any data.
 */
import { globalEventBus, Events } from '../../share/eventBus.js';

export const CARDS = ['welcome', 'capture', 'read', 'fields', 'card', 'share'];
export const SWIPE_PX = 80;              // a sideways drag this long over a sheet closes it (same as Cancel)
export const INTENT_PX = 24;             // a sideways swipe on a screen longer than this goes one step on or back
export const EDGE_PX = 48;               // no swipe starts within this much of the screen edge (browser back gesture)
export const SLIDE_MS = 280;             // a new screen slides in over this long (the mock-up's inF / inB)
export const SHEET_MS = 380;             // a sheet slides up or down over this long (the mock-up's .sheet)

const $ = (id) => document.getElementById(id);
const hooks = { toast: null, wipe: null, cancel: null, showQr: null, showFront: null, startOver: null };
const beforeChange = [];
let currentName = null, track = null, cards = [], cardFace = 'front', slideTimer = null, watched = null, watcher = null;

export function use(h) { Object.assign(hooks, h); }
export function onBeforeChange(fn) { beforeChange.push(fn); return () => beforeChange.splice(beforeChange.indexOf(fn), 1); }
export function current() { return currentName; }
export function cardEl(name) { return $(`card${name[0].toUpperCase()}${name.slice(1)}`); }

// Which step a sideways swipe lands on. The screens are laid out side by side in thought (centres), the swipe moved
// `left` away from where the shell rested: a move shorter than INTENT_PX stays, a longer one goes one step on in the
// direction it moved, however far it was flung. A position on a screen's centre keeps that screen.
export function pickCard(names, centres, left, restedLeft) {
    const near = names.findIndex((_, i) => Math.abs(left - centres[i]) <= 2);
    if (near >= 0) return names[near];
    let from = centres.findIndex(c => Math.abs(c - restedLeft) <= 2);
    if (from < 0) from = centres.reduce((best, c, i) => Math.abs(c - restedLeft) < Math.abs(centres[best] - restedLeft) ? i : best, 0);
    const moved = left - restedLeft;
    if (Math.abs(moved) < INTENT_PX) return names[from];
    return names[Math.max(0, Math.min(names.length - 1, from + Math.sign(moved)))];
}

const reducedMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function setCurrent(name) {
    if (!name || name === currentName) return;
    const from = currentName, card = cardEl(name);
    const dir = from && CARDS.indexOf(name) < CARDS.indexOf(from) ? 'b' : 'f';
    currentName = name;
    cards.forEach(c => {
        const on = c === card;
        c.hidden = !on;
        c.classList.toggle('is-current', on);
        c.setAttribute('aria-hidden', on ? 'false' : 'true');
        c.classList.remove('enter-f', 'enter-b');
    });
    clearTimeout(slideTimer);
    if (from) {
        void card.offsetWidth;                     // restart the slide even when the same class comes back
        card.classList.add(dir === 'f' ? 'enter-f' : 'enter-b');
        track.dataset.deck = 'moving';             // read by the tests: moving while a screen slides in, then still
        slideTimer = setTimeout(() => { card.classList.remove('enter-f', 'enter-b'); track.dataset.deck = 'still'; }, reducedMotion() ? 150 : SLIDE_MS);
    } else track.dataset.deck = 'still';
    const body = card.querySelector('.deck-card-body');
    card.scrollTop = 0; if (body) body.scrollTop = 0;
    paintHead(card);
    markNav();
    watchNext(card);
    document.documentElement.dataset.card = name;
    globalEventBus.publish(Events.CARD_CHANGED, { from, to: name, timestamp: Date.now() });
}

// The head: "Step 1 of 5 · Capture", the pilot chip and the big title, all from the screen's own data attributes.
function paintHead(card) {
    const set = (id, text) => { const el = $(id); if (el) el.textContent = text || ''; };
    set('hStep', card.dataset.step);
    set('hEmoji', card.dataset.pilotEmoji);
    set('hName', card.dataset.pilot);
    set('hTitle', card.dataset.title);
    const back = $('dockBack');
    if (back) back.disabled = currentName === CARDS[0];
}

// The dock's five steps: done before the screen in view, now on it, todo after it (none on Welcome).
function markNav() {
    const at = CARDS.indexOf(currentName);
    document.querySelectorAll('.vcge-steps [data-card]').forEach(b => {
        const i = CARDS.indexOf(b.dataset.card);
        const isQr = b.dataset.qr !== undefined;
        if (!isQr) b.dataset.state = i < at ? 'done' : i === at ? 'now' : 'todo';
        // The hidden QR shortcut is on only while the card shows its back; the Card step stays on for either side.
        const on = b.dataset.card === currentName && (!isQr || cardFace === 'back');
        b.classList.toggle('is-on', on);
        if (on) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
    });
}

/** @param {'front'|'back'} face  the side of the 3D card that is up */
export function setFace(face) {
    cardFace = face === 'back' ? 'back' : 'front';
    markNav();
}

// The primary button names the screen's next move and is pressable only when the screen's own button is.
function nextTarget(card) {
    const sel = card && card.dataset.next;
    return sel ? document.querySelector(sel) : null;
}
function watchNext(card) {
    const btn = $('dockNext');
    if (!btn) return;
    btn.textContent = card.dataset.nextLabel || 'Next';
    if (watcher) watcher.disconnect();
    watched = nextTarget(card);
    const sync = () => { btn.disabled = !!(watched && watched.disabled); };
    sync();
    if (watched && window.MutationObserver) {
        watcher = new MutationObserver(sync);
        watcher.observe(watched, { attributes: true, attributeFilter: ['disabled'] });
    }
}
function pressNext() {
    const card = cardEl(currentName), target = nextTarget(card);
    if (target && !target.disabled) { target.click(); return; }
    if (target) return;
    if (currentName === CARDS[CARDS.length - 1]) go('capture'); else next();
}

// Shows `name`. Listeners registered with onBeforeChange run first (they may delay).
export async function go(name, options = {}) {
    const card = cardEl(name);
    if (!card || !track) return;
    if (name === currentName && !options.force) return;
    if (!options.silent) for (const fn of beforeChange) { try { await fn({ from: currentName, to: name }); } catch (e) { console.error('[vCGE-MOD01] beforeChange listener failed:', e); } }
    setCurrent(name);
}

export function next() { const i = CARDS.indexOf(currentName); if (i >= 0 && i < CARDS.length - 1) go(CARDS[i + 1]); }
export function prev() { const i = CARDS.indexOf(currentName); if (i > 0) go(CARDS[i - 1]); }

// ---- Sheets: Vault, Settings and the export pickers slide up from the bottom over a scrim (deck.css) -------------

const sheetTimers = new Map();

export function openSheet(id) {
    const sheet = $(id);
    if (!sheet) return;
    clearTimeout(sheetTimers.get(id));
    sheet.classList.remove('hidden', 'is-closing');
    sheet.classList.add('is-open');
    const first = sheet.querySelector('[data-sheet-focus]') || sheet.querySelector('button, input, select');
    if (first) first.focus();
}

export function closeSheet(id) {
    const sheet = $(id);
    if (!sheet) return;
    if (sheet.classList.contains('hidden')) return;
    sheet.classList.remove('is-open');
    clearTimeout(sheetTimers.get(id));
    if (reducedMotion()) { sheet.classList.add('hidden'); return; }
    // (A sheet a module reopens itself mid-slide, by dropping is-closing, is left open when the slide's time is up.)
    // The sheet counts as closed at once (is-closing: hidden to pointers and screen readers) while its panel slides down
    sheet.classList.add('is-closing');
    sheetTimers.set(id, setTimeout(() => { if (!sheet.classList.contains('is-open') && sheet.classList.contains('is-closing')) { sheet.classList.add('hidden'); sheet.classList.remove('is-closing'); } }, SHEET_MS));
}

export function sheetOpen(id) { const s = $(id); return !!s && !s.classList.contains('hidden') && !s.classList.contains('is-closing'); }

/** Closes the sheet opened last (Esc, and Back in main.js); false when none is open. */
export function closeTopSheet() {
    const open = Array.from(document.querySelectorAll('.vcge-sheet:not(.hidden):not(.is-closing)')).pop();
    if (!open) return false;
    closeSheet(open.id);
    return true;
}

function wireSheet(sheet) {
    sheet.querySelectorAll('[data-sheet-close]').forEach(b => b.addEventListener('click', () => closeSheet(sheet.id)));
    // A tap on the scrim (the sheet's own backdrop, outside its panel) closes it, like the mock-up's.
    sheet.addEventListener('click', (e) => { if (e.target === sheet) closeSheet(sheet.id); });
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

// ---- Swipe between screens -------------------------------------------------------------------------------------

function wireSwipe() {
    // Touch events, not pointer events: a browser that takes a finger for scrolling cancels its pointer events (with no
    // position), while touchend still says where the finger lifted.
    let start = null;
    track.addEventListener('touchstart', (e) => {
        start = null;
        if (e.touches.length !== 1) return;                   // a pinch is not a swipe
        const t = e.touches[0];
        if (t.clientX < EDGE_PX || t.clientX > window.innerWidth - EDGE_PX) return;
        if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable], .crop-stage, #card3DFlipper, [data-no-swipe]')) return;
        start = { x: t.clientX, y: t.clientY };
    }, { passive: true });
    track.addEventListener('touchend', (e) => {
        if (!start || e.touches.length) { if (!e.touches.length) start = null; return; }
        const t = e.changedTouches[0], dx = t.clientX - start.x, dy = t.clientY - start.y;
        start = null;
        if (Math.abs(dx) <= Math.abs(dy) * 1.5) return;       // a scroll up or down, not a swipe
        const w = track.clientWidth || 1, at = CARDS.indexOf(currentName);
        const to = pickCard(CARDS, CARDS.map((_, i) => i * w), at * w - dx, at * w);
        if (to !== currentName) go(to);
    }, { passive: true });
    track.addEventListener('touchcancel', () => { start = null; }, { passive: true });
}

// ---- Boot --------------------------------------------------------------------------------------------------------

export function initDeck() {
    track = $('deck');
    if (!track) return;
    cards = Array.from(track.querySelectorAll('.deck-card'));
    cards.forEach(card => {
        const trash = card.querySelector('.vcge-trash');
        if (trash) trash.addEventListener('click', () => { if (hooks.wipe) hooks.wipe(card.dataset.card); });
    });
    document.querySelectorAll('[data-card]').forEach(b => {
        if (b.tagName !== 'BUTTON') return;
        b.addEventListener('click', () => {
            go(b.dataset.card);
            if (b.dataset.card !== 'card') return;
            if (b.dataset.qr !== undefined) { if (hooks.showQr) hooks.showQr(); } else if (hooks.showFront) hooks.showFront();
            setFace(b.dataset.qr !== undefined ? 'back' : 'front');    // MOD06 confirms it, and reports its own Flip button
        });
    });
    const back = $('dockBack'), nextBtn = $('dockNext');
    if (back) back.addEventListener('click', () => prev());
    if (nextBtn) nextBtn.addEventListener('click', () => pressNext());
    document.querySelectorAll('.vcge-sheet').forEach(wireSheet);
    document.querySelectorAll('[data-open-sheet]').forEach(b => b.addEventListener('click', () => openSheet(b.dataset.openSheet)));
    wireSwipe();

    // Arrow keys move between screens when nothing is being typed and no sheet or dialog is open.
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        if (e.altKey || e.metaKey || e.ctrlKey) return;
        const t = e.target;
        if (t && t.closest && t.closest('input, textarea, select, [contenteditable], .vcge-sheet, [role="dialog"], [role="alertdialog"], .crop-handle')) return;
        if (document.querySelector('.vcge-sheet:not(.hidden):not(.is-closing), .vcge-modal:not(.hidden)')) return;
        e.preventDefault();
        if (e.key === 'ArrowRight') next(); else prev();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && closeTopSheet()) e.preventDefault();
    });

    setCurrent(CARDS[0]);
}

export function toast(message) { if (hooks.toast) hooks.toast(message); }
export function requestCancel() { if (hooks.cancel) hooks.cancel(); }
export function requestStartOver() { if (hooks.startOver) hooks.startOver(); else location.reload(); }
