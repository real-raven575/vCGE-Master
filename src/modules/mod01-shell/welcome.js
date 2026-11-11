/**
 * vCGE-MOD01: Welcome card, "Take a Tour" and the Thank You page
 * Created by raven575, Herd of Helpers (claude) & gemini
 *
 * The first card of the deck, every time vCGE opens (0.8 redo R2, Creative's CRTV-0020 mock-up; the markup is in
 * index.html): Shutout waving, "Scan a card. Keep the contact.", the privacy line, the tagline and "Made by". The primary
 * button, "Scan a card", is the dock's. Quiet buttons under the privacy line: Take a Tour, Set Up PIN/BIO Lock Now, Play
 * with sample fields and CANCEL. It greets every new session. On the very first start (raven575, 2026-11-11) the tour opens by
 * itself once the splash is gone, if the person is still on this card and has not moved on; finishing or skipping it saves tour=1 in vcge_settings,
 * so it never opens by itself again (Take a Tour still replays it). It touches no contact data and sends nothing on the bus. CANCEL wipes the session (through the
 * deck's cancel hook, which main.js points at the Vault's wipe) and shows the Thank You page.
 * The tour spotlights one card at a time and moves the deck as it goes; a sideways swipe anywhere goes to the next or the
 * previous step. It stays under the lock screen and every pop-up, and leaves their keys alone. No sound, no flashing;
 * the fade is off under reduced motion.
 */
import { isPlain } from './edition.js';
import { go, current, openSheet, closeSheet, sheetOpen, cardEl, requestCancel, requestStartOver, SWIPE_PX } from './deck.js';
import { tourSeen, rememberTourSeen } from './settings.js';
import { tourArtEl } from './tourArt.js';

// A step lights its card, or one part of it (spot) when that part is in view: on Capture, the viewfinder and the shutter row.
export const TOUR_STEPS = [
    { card: 'capture', spot: '#capCamera', pilot: 'iris', title: 'Scan a business card',
        body: 'Point the camera at a card and tap the shutter, or tap Photo to choose one. vCGE reads it right here on this device. The photo never leaves.' },
    { card: 'fields', pilot: 'pidge', title: 'Check the details',
        body: 'First you straighten the photo and check each line it read. Nothing fills these fields until you say so. You can also type or fix anything here.' },
    { card: 'card', pilot: 'flipside', title: 'Your 3D card',
        body: 'Pick colors and a font. Flip the card to see its QR code. A phone camera can scan it to save the contact.' },
    { card: 'share', pilot: 'airlock', title: 'Share when you choose',
        body: 'Save a .vcf file, show the QR, email, text or print. Nothing leaves vCGE until you press one of these.' },
    { sheet: 'vaultPage', pilot: 'ghost', title: 'Your card stays private',
        body: 'Nothing is saved. Step away and the card locks, then wipes. Set a 4-digit PIN to unlock it fast. Wipe and start over, at the bottom of this sheet, clears everything now.' },
    { header: true, pilot: 'cornerstone', title: 'You’re ready',
        body: 'The steps at the bottom jump to any screen. The lock at the top shows the time left before your card locks, and the cog opens Settings. That’s the tour.' }
];

const GAP = 16;
const BESIDE_MIN_PX = 352;
let layer = null, stepIndex = -1, onViewportChange = null;

function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    Object.entries(props).forEach(([k, v]) => (k === 'className' || k === 'id' || k === 'type' || k === 'textContent') ? (node[k] = v) : node.setAttribute(k, v));
    node.append(...children);
    return node;
}

// What a tour step points at: its part of the card when that is in view, else the card; the Vault page's panel; the header.
function targetOf(step) {
    if (step.header) return document.querySelector('header');
    if (step.sheet) return document.getElementById(step.sheet).querySelector('.vcge-sheet-panel');
    const part = step.spot ? document.querySelector(step.spot) : null;
    if (part && part.getClientRects().length) return part;
    return cardEl(step.card);
}

// ---- Welcome card ----------------------------------------------------------------------------------------------

// The opening splash (index.html, ui.css) fades out by CSS alone; the first tap, click or key ends it sooner.
export function endSplashOnInput(doc = document) {
    const splash = doc.getElementById('vcgeSplash');
    if (!splash) return;
    const end = () => { splash.classList.add('vcge-splash-off'); for (const t of ['pointerdown', 'keydown']) doc.removeEventListener(t, end, true); };
    for (const t of ['pointerdown', 'keydown']) doc.addEventListener(t, end, true);
}

export function renderWelcomeCard() {
    endSplashOnInput();
    const host = document.getElementById('welcomeBody');
    if (!host) return;
    // Shutout's art and the tagline are the branded edition's (screens-r2.css also hides them in plain before this runs)
    if (isPlain()) ['welcomeArt', 'welcomeTagline'].forEach(id => { const n = document.getElementById(id); if (n) n.remove(); });
    const on = (id, fn) => { const b = document.getElementById(id); if (b) b.addEventListener('click', fn); };
    on('welcomePinBtn', () => openSheet('vaultPage'));
    on('welcomeTourBtn', () => startTour());
    on('welcomeCancelBtn', cancelSession);
    on('welcomeSampleBtn', () => go('fields'));
    host.dataset.wired = '1';    // the buttons answer from here on
    scheduleFirstRunTour();
    const thanks = document.getElementById('thankYouPage');
    if (thanks) {
        document.getElementById('thankYouStartOverBtn').addEventListener('click', () => requestStartOver());
        const closeBtn = document.getElementById('thankYouCloseBtn');
        closeBtn.textContent = isDesktopApp() ? 'EXIT PROGRAM' : 'CLOSE WINDOW';
        closeBtn.addEventListener('click', closeWindow);
    }
}

const isDesktopApp = () => !!(window.__TAURI__ && window.__TAURI__.core);

// CANCEL: the session is wiped (nothing is kept anyway) and the Thank You page takes the screen.
function cancelSession() {
    requestCancel();
    const page = document.getElementById('thankYouPage');
    if (!page) return;
    document.getElementById('thankYouNote').textContent = '';
    page.classList.remove('hidden');
    document.getElementById('thankYouStartOverBtn').focus();
}

// Browsers only let a page close a tab it opened itself; if the tab stays, say so. The desktop app really exits.
async function closeWindow() {
    const note = document.getElementById('thankYouNote');
    if (isDesktopApp()) {
        try {
            await window.__TAURI__.window.getCurrentWindow().close();
            return;
        } catch (e) {
            console.warn('[vCGE-MOD01] The window could not be closed:', e);
        }
    } else {
        window.close();
    }
    setTimeout(() => { if (!document.hidden) note.textContent = 'You can close this tab now.'; }, 300);
}

// ---- Tour ----------------------------------------------------------------------------------------------------------

export function tourOpen() { return !!layer; }

// The opening splash's length (ui.css: it fades from 1.8 s for 0.42 s; 0.7 s under reduced motion), so the first-run tour
// opens as it goes, never under it.
export const SPLASH_END_MS = 2250, SPLASH_END_REDUCED_MS = 750, NO_SPLASH_MS = 300;
export function firstRunDelay(splashOff, reducedMotion) {
    return splashOff ? NO_SPLASH_MS : reducedMotion ? SPLASH_END_REDUCED_MS : SPLASH_END_MS;
}
/** True when the tour should open by itself: never seen, still on the Welcome card, nothing else open over it. */
export function shouldAutoTour({ seen, card, busy }) { return !seen && card === 'welcome' && !busy; }

function scheduleFirstRunTour() {
    if (tourSeen()) return;
    const root = document.documentElement;
    const reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    // Someone who moves on before the splash is gone (Scan a card, a swipe) is not stopped: the tour waits for the next start
    let moved = false;
    const watch = new MutationObserver(() => { if (root.dataset.card && root.dataset.card !== 'welcome') moved = true; });
    watch.observe(root, { attributes: true, attributeFilter: ['data-card'] });
    setTimeout(() => {
        watch.disconnect();
        const busy = moved || !!document.querySelector('.vcge-sheet:not(.hidden), .vcge-modal:not(.hidden), #thankYouPage:not(.hidden)') || !!layer;
        if (shouldAutoTour({ seen: tourSeen(), card: current(), busy })) startTour();
    }, firstRunDelay(root.dataset.splash === 'off', reduced));
}

// Ends the tour (Esc, its close button, and Back in main.js) and goes to Capture.
export function closeTour() { close(); }

function close() {
    if (!layer) return;
    if (onViewportChange) {
        window.removeEventListener('resize', onViewportChange);
        window.removeEventListener('scroll', onViewportChange, true);
        document.removeEventListener('transitionend', onViewportChange, true);
        document.removeEventListener('animationend', onViewportChange, true);
        onViewportChange = null;
    }
    document.removeEventListener('keydown', onKey, true);
    layer.remove();
    layer = null;
    stepIndex = -1;
    if (!tourSeen()) rememberTourSeen();    // finished or skipped: it will not open by itself again
    if (sheetOpen('vaultPage')) closeSheet('vaultPage');
    go('capture');
}

function onKey(e) {
    if (!layer) return;
    // Keys typed into something over the tour (the lock screen's PIN, a pop-up) are theirs, not the tour's.
    if (e.target && e.target !== document.body && !layer.contains(e.target)) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (stepIndex >= 0 && e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); goTo(stepIndex + 1); }
    else if (stepIndex > 0 && e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); goTo(stepIndex - 1); }
}

export function startTour() {
    if (layer) return;
    layer = el('div', { id: 'welcomeLayer', className: 'vcge-welcome' });
    document.body.append(layer);
    // A sideways swipe over the tour: right to left for the next step, left to right for the one before.
    let start = null;
    layer.addEventListener('pointerdown', (e) => { start = e.target.closest('button') ? null : { x: e.clientX, y: e.clientY }; });
    layer.addEventListener('pointerup', (e) => {
        if (!start || stepIndex < 0) return;
        const dx = e.clientX - start.x, dy = e.clientY - start.y;
        start = null;
        if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return;
        if (dx < 0) goTo(stepIndex + 1); else if (stepIndex > 0) goTo(stepIndex - 1);
    });
    document.addEventListener('keydown', onKey, true);
    goTo(0);
}

function goTo(i) {
    if (i >= TOUR_STEPS.length) return close();
    stepIndex = i;
    const step = TOUR_STEPS[i], last = i === TOUR_STEPS.length - 1;
    const next = el('button', { type: 'button', id: 'tourNextBtn', className: 'vcge-tour-next' }, last ? 'START NOW' : 'Next');
    next.addEventListener('click', () => goTo(i + 1));
    const nav = el('div', { className: 'vcge-tour-nav' });
    if (!last) {
        const skip = el('button', { type: 'button', id: 'tourSkipBtn', className: 'vcge-tour-skip' }, 'Skip tour');
        skip.addEventListener('click', close);
        nav.append(skip);
    }
    if (i > 0) {
        const back = el('button', { type: 'button', id: 'tourBackBtn', className: 'vcge-tour-back' }, 'Back');
        back.addEventListener('click', () => goTo(i - 1));
        nav.append(back);
    }
    nav.append(next);
    const dots = el('div', { className: 'vcge-tour-dots', 'aria-hidden': 'true' },
        ...TOUR_STEPS.map((_, k) => el('i', { className: k === i ? 'on' : '' })));
    const tip = el('div', { id: 'tourTip', className: 'vcge-tour-tip', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'tourTitle', 'aria-describedby': 'tourBody' },
        ...[tourArtEl(step.pilot, document, isPlain())].filter(Boolean),
        dots,
        el('p', { id: 'tourStep', className: 'vcge-tour-step' }, `Step ${i + 1} of ${TOUR_STEPS.length}`),
        el('h3', { id: 'tourTitle' }, step.title),
        el('p', { id: 'tourBody', className: 'vcge-tour-body' }, step.body),
        nav);
    const spot = el('div', { id: 'tourSpot', className: 'vcge-tour-spot' });
    const blocker = el('div', { className: 'vcge-tour-blocker' });
    layer.replaceChildren(blocker, spot, tip);

    // Bring the step's card into view (the Vault page opens for its step and closes after it).
    if (step.sheet) openSheet(step.sheet);
    else if (sheetOpen('vaultPage')) closeSheet('vaultPage');
    if (step.card) go(step.card, { silent: true });

    if (!onViewportChange) {
        let queued = false;
        onViewportChange = () => {
            if (queued) return;
            queued = true;
            requestAnimationFrame(() => { queued = false; placeStep(); });
        };
        window.addEventListener('resize', onViewportChange);
        window.addEventListener('scroll', onViewportChange, true);
        document.addEventListener('transitionend', onViewportChange, true);
        document.addEventListener('animationend', onViewportChange, true);    // a screen slides in, the Vault sheet slides up
    }
    placeStep();
    next.focus();
}

// Positions the spotlight on the step's area and the card beside it (wide screens) or above/below it (phones).
export function placeTip(r, tipW, tipH, vw, vh) {
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));
    if (vw >= 900) {
        const top = clamp(r.top, GAP, vh - tipH - GAP);
        if (r.right + GAP + tipW <= vw - GAP) return { left: r.right + GAP, top, side: 'right' };
        if (r.left - GAP - tipW >= GAP) return { left: r.left - GAP - tipW, top, side: 'left' };
    }
    const left = clamp(r.left, GAP, Math.max(GAP, vw - tipW - GAP));
    if (r.bottom + GAP + tipH <= vh - GAP) return { left, top: r.bottom + GAP, side: 'below' };
    if (r.top - GAP - tipH >= GAP) return { left, top: r.top - GAP - tipH, side: 'above' };
    return { left, top: Math.max(GAP, vh - tipH - GAP), side: 'over' };
}

function placeStep() {
    if (!layer || stepIndex < 0) return;
    const r = targetOf(TOUR_STEPS[stepIndex]).getBoundingClientRect();
    const vw = document.documentElement.clientWidth, vh = window.innerHeight;
    // The outline sits just outside the area, kept on screen when the area touches the edge (the header).
    const pad = 6;
    const left = Math.max(4, r.left - pad), top = Math.max(4, r.top - pad);
    const right = Math.min(vw - 4, r.right + pad), bottom = Math.min(vh - 4, r.bottom + pad);
    const spot = layer.querySelector('#tourSpot'), tip = layer.querySelector('#tourTip');
    Object.assign(spot.style, { left: `${left}px`, top: `${top}px`, width: `${Math.max(0, right - left)}px`, height: `${Math.max(0, bottom - top)}px` });
    // On a wide screen a small area (the Vault page) keeps the tour card beside it: the card narrows to the room
    // there, down to BESIDE_MIN_PX, rather than covering what it talks about.
    tip.style.width = '';
    const room = Math.max(left, vw - right) - 2 * GAP;
    if (vw >= 900 && room < tip.offsetWidth && room >= BESIDE_MIN_PX) tip.style.width = `${room}px`;
    const pos = placeTip({ left, top, right, bottom }, tip.offsetWidth, tip.offsetHeight, vw, vh);
    Object.assign(tip.style, { left: `${pos.left}px`, top: `${pos.top}px` });
    tip.dataset.side = pos.side;
}
