/**
 * vCGE-MOD01: Shutout's touches on the header (the "make it cute" round, raven575 approved 2026-10-21)
 * Created by raven575, Team vCGE (Claude) & Gemini
 *
 * S1: Shutout's comic medal sits tucked in behind the lit card icon. When the card changes (or Left/Right mirrors the
 * header) he steps down onto the header's bottom edge and walks to the new icon on a spring (raven575's test report,
 * 2026-10-22): he gains speed slowly, has a top speed (flip through cards fast and he falls behind, then catches up),
 * runs a little past the icon and eases back, then tucks in again. Under reduced motion he is simply there.
 * S2: six shell plates, one per card, just above the cards: a card you have been to is filled in, the one in view has a
 * thick outline (shape, not only colour). Both are pictures only (aria-hidden): the header icons already say where you are. Nothing is kept: the plates start fresh on every load.
 * The plain edition shows neither (deck.css), and this file does no work there.
 */
import { CARDS } from './deck.js';
import { isPlain } from './edition.js';

// Where the turtle sits (px from the header's left edge) to be centred under a button.
export const turtleX = (button, header, width) => Math.round(button.left + button.width / 2 - header.left - width / 2);

// Each plate's state, in card order: 'current', 'visited' or 'new'.
export const plateStates = (cards, visited, current) =>
    cards.map(c => (c === current ? 'current' : visited.has(c) ? 'visited' : 'new'));

// The walk, in px and seconds: a spring (stiffness, damping) whose push is capped (maxAccel: he gains speed slowly) and
// whose speed is capped (maxSpeed: he can fall behind). Damped below critical, so he overshoots by about a tenth.
export const WALK = Object.freeze({ stiffness: 90, damping: 11, maxAccel: 1500, maxSpeed: 450 });
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** One step of the walk: { x, v } -> { x, v, settled }. Settled means at the target and still (snapped there). */
export function stepWalk(state, target, dt, walk = WALK) {
    const a = clamp(walk.stiffness * (target - state.x) - walk.damping * state.v, -walk.maxAccel, walk.maxAccel);
    const v = clamp(state.v + a * dt, -walk.maxSpeed, walk.maxSpeed);
    const x = state.x + v * dt;
    if (Math.abs(target - x) < 0.5 && Math.abs(v) < 8) return { x: target, v: 0, settled: true };
    return { x, v, settled: false };
}

export function initShellArt(doc = document) {
    if (!doc || typeof doc.querySelector !== 'function' || isPlain(doc)) return;
    const header = doc.querySelector('.deck-header'), nav = header && header.querySelector('.deck-nav');
    const turtle = doc.getElementById('deckTurtle'), plates = doc.getElementById('deckPlates');
    if (!nav || !turtle || !plates) return;
    const visited = new Set();
    const calm = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
    let target = null, state = null, walking = 0, last = 0, queued = false, jumpNext = false;
    const place = (x) => turtle.style.setProperty('--turtle-x', `${Math.round(x * 10) / 10}px`);
    const settle = () => {
        if (walking) cancelAnimationFrame(walking);
        walking = 0; state = { x: target, v: 0 };
        place(target);
        turtle.classList.add('is-tucked');
    };
    const tick = (now) => {
        const dt = Math.min(Math.max((now - last) / 1000, 0), 1 / 30);   // a slow or hidden frame never makes a leap
        last = now;
        state = stepWalk(state, target, dt);
        if (Math.abs(state.v) > 20) turtle.dataset.dir = state.v > 0 ? 'right' : 'left';
        place(state.x);
        if (state.settled) settle(); else walking = requestAnimationFrame(tick);
    };
    const update = () => {
        queued = false;
        const button = nav.querySelector('button.is-on');
        if (!button) return;
        const card = button.dataset.card;
        visited.add(card);
        const states = plateStates(CARDS, visited, card);
        plates.querySelectorAll('[data-card]').forEach(p => { p.dataset.state = states[CARDS.indexOf(p.dataset.card)] || 'new'; });
        const b = button.getBoundingClientRect();
        if (!b.width) { turtle.classList.remove('is-placed'); target = null; return; }
        const x = turtleX(b, header.getBoundingClientRect(), turtle.getBoundingClientRect().width);
        const first = target === null, jump = jumpNext;
        jumpNext = false;
        if (x === target && !walking) return;
        target = x;
        // The first place, a new window size, a scrolled header row and reduced motion: he is simply there, tucked in
        if (first || jump || calm.matches || !state) {
            settle();
            if (first) { turtle.getBoundingClientRect(); turtle.classList.add('is-placed'); }
            return;
        }
        turtle.classList.remove('is-tucked');
        if (!walking) { last = performance.now(); walking = requestAnimationFrame(tick); }
    };
    const queue = () => { if (!queued) { queued = true; requestAnimationFrame(update); } };
    const jump = () => { jumpNext = true; queue(); };
    new MutationObserver(queue).observe(nav, { subtree: true, attributes: true, attributeFilter: ['class'] });
    // Left/Right mirrors the header: he walks over to the lit icon's new place
    new MutationObserver(queue).observe(doc.documentElement, { attributes: true, attributeFilter: ['data-hand'] });
    nav.addEventListener('scroll', jump, { passive: true });
    window.addEventListener('resize', jump);
    if (window.ResizeObserver) new ResizeObserver(jump).observe(header);
    queue();
}
