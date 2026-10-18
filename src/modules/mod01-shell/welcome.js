/**
 * vCGE-MOD01: Welcome card, "Take a Tour" and the Thank You page
 * Created by raven575, Team vCGE (Claude) & Gemini
 *
 * The first card of the deck, every time vCGE opens: Set Up PIN/BIO Lock Now, START (the big one), Take a Tour,
 * CANCEL, and a small "Play with sample fields" link. Nothing is stored (no "seen it" flag anywhere), so it greets
 * every new session. It touches no contact data and sends nothing on the bus. CANCEL wipes the session (through the
 * deck's cancel hook, which main.js points at the Vault's wipe) and shows the Thank You page.
 * The tour spotlights one card at a time and moves the deck as it goes; a sideways swipe anywhere goes to the next or the
 * previous step. It stays under the lock screen and every pop-up, and leaves their keys alone. No sound, no flashing;
 * the fade is off under reduced motion.
 */
import { go, openSheet, closeSheet, sheetOpen, cardEl, requestCancel, requestStartOver, SWIPE_PX } from './deck.js';

export const TOUR_STEPS = [
    { card: 'capture', title: 'Scan a business card',
        body: 'Take a photo or upload one. vCGE reads it right here on this device. The photo never leaves.' },
    { card: 'fields', title: 'Check the details',
        body: 'First you straighten the photo and check each line it read. Nothing fills these fields until you say so. You can also type or fix anything here.' },
    { card: 'card', title: 'Your 3D card',
        body: 'Pick colors and a font. Flip the card to see its QR code. A phone camera can scan it to save the contact.' },
    { card: 'share', title: 'Share when you choose',
        body: 'Save a .vcf file, show the QR, email, text or print. Nothing leaves vCGE until you press one of these.' },
    { sheet: 'vaultPage', title: 'Your card stays private',
        body: 'Nothing is saved. Step away and the card locks, then wipes. Set a 4-digit PIN to unlock it fast. The red trash button on any card clears everything now.' },
    { header: true, title: 'You’re ready',
        body: 'The icons at the top jump to any card. The lock shows whether your card is locked, and the cog opens Settings. That’s the tour.' }
];

const WELCOME_POINTS = [
    'Snap or upload a business card. It’s read right here on this device, with no internet.',
    'Check the details and see the contact as a 3D card with a QR code.',
    'Share it only when you choose. Nothing is saved, and the card is wiped when you leave.'
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

// What a tour step points at: the card, the Vault page's panel, or the header.
function targetOf(step) {
    if (step.header) return document.querySelector('header');
    if (step.sheet) return document.getElementById(step.sheet).querySelector('.vcge-sheet-panel');
    return cardEl(step.card);
}

// ---- Welcome card ----------------------------------------------------------------------------------------------

export function renderWelcomeCard() {
    const host = document.getElementById('welcomeBody');
    if (!host) return;
    const pin = el('button', { type: 'button', id: 'welcomePinBtn', className: 'welcome-pin' }, 'Set Up PIN/BIO Lock Now');
    const start = el('button', { type: 'button', id: 'welcomeStartBtn', className: 'welcome-start' }, 'START');
    const tour = el('button', { type: 'button', id: 'welcomeTourBtn', className: 'welcome-tour' }, 'Take a Tour');
    const cancel = el('button', { type: 'button', id: 'welcomeCancelBtn', className: 'welcome-cancel' }, 'CANCEL');
    const sample = el('button', { type: 'button', id: 'welcomeSampleBtn', className: 'welcome-sample' }, 'Play with sample fields');
    pin.addEventListener('click', () => openSheet('vaultPage'));
    start.addEventListener('click', () => go('capture'));
    tour.addEventListener('click', () => startTour());
    cancel.addEventListener('click', cancelSession);
    sample.addEventListener('click', () => go('fields'));
    const list = el('ol', { className: 'vcge-welcome-points' }, ...WELCOME_POINTS.map(t => el('li', {}, t)));
    host.replaceChildren(
        el('img', { className: 'vcge-welcome-logo', src: 'src/assets/brand/vcge-logo-192.png', alt: 'vCGE', width: 72, height: 72, decoding: 'async' }),
        el('h2', { id: 'welcomeTitle' }, 'Welcome to vCGE'),
        el('p', { id: 'welcomeTagline', className: 'vcge-welcome-tagline' }, 'Operation: Never Lose Contact'),
        list,
        el('div', { className: 'welcome-actions' }, pin, start, tour, cancel),
        sample,
        el('p', { className: 'welcome-fine' }, 'This greeting appears each time you open vCGE. vCGE remembers none of your sensitive data: it keeps one small settings file on this device (hand, colors, theme, font, text size, wipe time), and nothing you scan, upload or type is ever saved.'));
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

function close() {
    if (!layer) return;
    if (onViewportChange) {
        window.removeEventListener('resize', onViewportChange);
        window.removeEventListener('scroll', onViewportChange, true);
        document.removeEventListener('transitionend', onViewportChange, true);
        onViewportChange = null;
    }
    document.removeEventListener('keydown', onKey, true);
    layer.remove();
    layer = null;
    stepIndex = -1;
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
        document.addEventListener('transitionend', onViewportChange, true);   // the card grows as it becomes current
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
