/**
 * vCGE-MOD01: Shutout's touches on the header (the "make it cute" round, raven575 approved 2026-10-21)
 * Created by raven575, Team vCGE (Claude) & Gemini
 *
 * S1: a small turtle on the header's bottom edge sits under the lit card icon and walks to the next one when the card
 * changes (deck.css: 0.4 s, none under reduced motion). S2: six shell plates, one per card, just above the cards: a card
 * you have been to is filled in, the one in view has a thick outline (shape, not only colour). Both are pictures only
 * (aria-hidden): the header icons already say where you are. Nothing is kept: the plates start fresh on every load.
 * The plain edition shows neither (deck.css), and this file does no work there.
 */
import { CARDS } from './deck.js';
import { isPlain } from './edition.js';

// Where the turtle sits (px from the header's left edge) to be centred under a button.
export const turtleX = (button, header, width) => Math.round(button.left + button.width / 2 - header.left - width / 2);

// Each plate's state, in card order: 'current', 'visited' or 'new'.
export const plateStates = (cards, visited, current) =>
    cards.map(c => (c === current ? 'current' : visited.has(c) ? 'visited' : 'new'));

export function initShellArt(doc = document) {
    if (!doc || typeof doc.querySelector !== 'function' || isPlain(doc)) return;
    const header = doc.querySelector('.deck-header'), nav = header && header.querySelector('.deck-nav');
    const turtle = doc.getElementById('deckTurtle'), plates = doc.getElementById('deckPlates');
    if (!nav || !turtle || !plates) return;
    const visited = new Set();
    let lastX = null, queued = false, still = false;
    const update = () => {
        queued = false;
        const button = nav.querySelector('button.is-on');
        if (!button) return;
        const card = button.dataset.card;
        visited.add(card);
        const states = plateStates(CARDS, visited, card);
        plates.querySelectorAll('[data-card]').forEach(p => { p.dataset.state = states[CARDS.indexOf(p.dataset.card)] || 'new'; });
        const b = button.getBoundingClientRect();
        if (!b.width) { turtle.classList.remove('is-placed'); lastX = null; return; }
        const x = turtleX(b, header.getBoundingClientRect(), turtle.getBoundingClientRect().width);
        if (lastX !== null && x !== lastX) turtle.dataset.dir = x < lastX ? 'left' : 'right';
        // A new window size or a scrolled header row moves it at once; only a change of card is walked
        if (still) { still = false; turtle.classList.add('is-still'); requestAnimationFrame(() => requestAnimationFrame(() => turtle.classList.remove('is-still'))); }
        turtle.style.setProperty('--turtle-x', `${x}px`);
        // The first place it takes is not walked to: it is just there (its style is settled before it can walk), and walks
        // from then on.
        if (lastX === null) { turtle.getBoundingClientRect(); turtle.classList.add('is-placed'); }
        lastX = x;
    };
    const queue = () => { if (!queued) { queued = true; requestAnimationFrame(update); } };
    const jump = () => { still = true; queue(); };
    new MutationObserver(queue).observe(nav, { subtree: true, attributes: true, attributeFilter: ['class'] });
    nav.addEventListener('scroll', jump, { passive: true });
    window.addEventListener('resize', jump);
    if (window.ResizeObserver) new ResizeObserver(jump).observe(header);
    queue();
}
