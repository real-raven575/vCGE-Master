/**
 * vCGE-MOD01: Welcome pop-up and "Show me around" tour
 * Created by raven575, Gemini & Claude
 *
 * Every time vCGE opens: START NOW, or a short tour that spotlights each part of the page. Nothing is stored (no
 * "seen it" flag anywhere), so it greets every new session. It touches no contact data and sends nothing on the bus.
 * The rest of the page is inert while it is open. No sound, no flashing; the fade is off under reduced motion.
 */

export const TOUR_STEPS = [
    { target: () => document.getElementById('imageUpload').closest('.rounded-2xl'), title: 'Scan a business card',
        body: 'Upload a photo or use the camera. vCGE reads it right here on this device. The photo never leaves.' },
    { target: () => document.getElementById('firstName').closest('section'), title: 'Check the details',
        body: 'First you straighten the photo and check each line it read. Nothing fills this form until you say so. You can also type or fix anything here.' },
    { target: () => document.getElementById('card3DFlipper').closest('.rounded-2xl'), title: 'Your 3D card',
        body: 'Pick colors and a font. Flip the card to see its QR code. A phone camera can scan it to save the contact.' },
    { target: () => document.getElementById('downloadVcfBtn').closest('.rounded-2xl'), title: 'Share when you choose',
        body: 'Save a .vcf file, show the QR, email, text or print. Nothing leaves vCGE until you press one of these.' },
    { target: () => document.getElementById('wipeVaultBtn').closest('.rounded-2xl'), title: 'Your card stays private',
        body: 'Nothing is saved. Step away and the card locks, then wipes. Set a 4-digit PIN to unlock it fast. Wipe clears everything now.' },
    { target: () => document.querySelector('header'), title: 'You’re ready',
        body: 'The Vault badge shows if the card is locked. The moon switches light and dark. That’s the tour.' }
];

const WELCOME_POINTS = [
    'Snap or upload a business card. It’s read right here on this device, with no internet.',
    'Check the details and see the contact as a 3D card with a QR code.',
    'Share it only when you choose. Nothing is saved, and the card is wiped when you leave.'
];

const GAP = 16;
let layer = null, inerted = [], stepIndex = -1, onViewportChange = null;

function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    Object.entries(props).forEach(([k, v]) => (k === 'className' || k === 'id' || k === 'type' || k === 'textContent') ? (node[k] = v) : node.setAttribute(k, v));
    node.append(...children);
    return node;
}

// Everything on the page except the welcome layer stops taking clicks, keys and focus while it is open.
function setPageInert(on) {
    if (on) {
        inerted = Array.from(document.body.children).filter(n => n !== layer && !n.inert && n.tagName !== 'SCRIPT');
        inerted.forEach(n => { n.inert = true; });
    } else {
        inerted.forEach(n => { n.inert = false; });
        inerted = [];
    }
}

function close() {
    if (!layer) return;
    if (onViewportChange) {
        window.removeEventListener('resize', onViewportChange);
        window.removeEventListener('scroll', onViewportChange, true);
        onViewportChange = null;
    }
    document.removeEventListener('keydown', onKey, true);
    setPageInert(false);
    layer.remove();
    layer = null;
    stepIndex = -1;
    window.scrollTo(0, 0);
}

function onKey(e) {
    if (!layer) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (stepIndex >= 0 && e.key === 'ArrowRight') { e.preventDefault(); goTo(stepIndex + 1); }
    else if (stepIndex > 0 && e.key === 'ArrowLeft') { e.preventDefault(); goTo(stepIndex - 1); }
}

function renderWelcome() {
    const start = el('button', { type: 'button', id: 'welcomeStartBtn', className: 'vcge-welcome-go' }, 'START NOW');
    const tour = el('button', { type: 'button', id: 'welcomeTourBtn', className: 'vcge-welcome-alt' }, 'Show me around');
    start.addEventListener('click', close);
    tour.addEventListener('click', () => goTo(0));
    const list = el('ol', { className: 'vcge-welcome-points' }, ...WELCOME_POINTS.map(t => el('li', {}, t)));
    const card = el('div', { id: 'welcomeDialog', className: 'vcge-welcome-card', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'welcomeTitle', 'aria-describedby': 'welcomeTagline' },
        el('div', { className: 'mod-tag mod-tag-inset', 'aria-hidden': 'true' }, el('span', {}, 'MOD-01')),
        el('span', { className: 'vcge-welcome-tag' }, 'vCGE'),
        el('h2', { id: 'welcomeTitle' }, 'Welcome to vCGE'),
        el('p', { id: 'welcomeTagline', className: 'vcge-welcome-tagline' }, 'Operation: Never Lose Contact'),
        list,
        el('div', { className: 'vcge-welcome-row' }, start, tour),
        el('p', { className: 'vcge-welcome-fine' }, 'This greeting appears each time you open vCGE, because vCGE remembers nothing.'));
    const backdrop = el('div', { className: 'vcge-welcome-backdrop' });
    backdrop.addEventListener('click', close);
    layer.replaceChildren(backdrop, card);
    start.focus();
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

    // Bring the area into view without animation; a tall area starts just under the sticky header.
    const target = step.target();
    const header = document.querySelector('header');
    const room = window.innerHeight - (header && target !== header ? header.offsetHeight : 0) - 2 * GAP;
    if (target === header) window.scrollTo(0, 0);
    else if (target.getBoundingClientRect().height > room) {
        target.scrollIntoView({ block: 'start' });
        window.scrollBy(0, -((header ? header.offsetHeight : 0) + GAP));
    } else target.scrollIntoView({ block: 'center' });

    if (!onViewportChange) {
        let queued = false;
        onViewportChange = () => {
            if (queued) return;
            queued = true;
            requestAnimationFrame(() => { queued = false; placeStep(); });
        };
        window.addEventListener('resize', onViewportChange);
        window.addEventListener('scroll', onViewportChange, true);
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
    const r = TOUR_STEPS[stepIndex].target().getBoundingClientRect();
    const vw = document.documentElement.clientWidth, vh = window.innerHeight;
    // The outline sits just outside the area, kept on screen when the area touches the edge (the header).
    const pad = 6;
    const left = Math.max(4, r.left - pad), top = Math.max(4, r.top - pad);
    const right = Math.min(vw - 4, r.right + pad), bottom = Math.min(vh - 4, r.bottom + pad);
    const spot = layer.querySelector('#tourSpot'), tip = layer.querySelector('#tourTip');
    Object.assign(spot.style, { left: `${left}px`, top: `${top}px`, width: `${Math.max(0, right - left)}px`, height: `${Math.max(0, bottom - top)}px` });
    const pos = placeTip({ left, top, right, bottom }, tip.offsetWidth, tip.offsetHeight, vw, vh);
    Object.assign(tip.style, { left: `${pos.left}px`, top: `${pos.top}px` });
    tip.dataset.side = pos.side;
}

export function showWelcome() {
    if (layer) return;
    layer = el('div', { id: 'welcomeLayer', className: 'vcge-welcome' });
    document.body.append(layer);
    setPageInert(true);
    document.addEventListener('keydown', onKey, true);
    renderWelcome();
}
