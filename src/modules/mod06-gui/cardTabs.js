/**
 * vCGE-MOD06: the card maker's category buttons and the mini card (easy + premium plan, step 2; raven575 approved
 * 2026-11-13 03:48 UTC)
 * Created by raven575, Herd of Helpers (claude) & gemini
 *
 * Colour, Logo, Style and Paper: one picture button per category over one box that shows only that category
 * (.r4-card[data-tab], screens-r4.css). Logo and Paper live in the "Paper & logo" panel, which opens with them.
 * On a phone, when the box is long enough to scroll, the card shrinks to a mini card in the top corner and keeps
 * showing every change, over a band the choices scroll away under; a tap on the mini card scrolls back to the full
 * card. Nothing is stored.
 */

export const CARD_TABS = Object.freeze(['colour', 'logo', 'style', 'paper']);
const LOOK_TABS = new Set(['logo', 'paper']);   // the tabs shown from inside the Paper & logo panel

/** Show one category. Returns the tab now shown. */
export function showCardTab(doc, tab) {
    const body = doc.querySelector('#cardCard .r4-card');
    if (!body || !CARD_TABS.includes(tab)) return body ? body.dataset.tab : null;
    body.dataset.tab = tab;
    for (const b of doc.querySelectorAll('#cardTabs .r4-tab')) b.setAttribute('aria-pressed', String(b.dataset.tab === tab));
    const look = doc.getElementById('cardLookPanel');
    if (look) look.open = LOOK_TABS.has(tab);
    return tab;
}

/** How small the mini card is drawn (the scale in screens-r4.css, .r4-card[data-mini="on"] > .r4-stage). */
export const MINI_SCALE = 0.42;

/** The band behind the mini card, in px: the shrunk card and a small gap under it (the choices scroll away under it). */
export function miniBandHeight(stageHeight) {
    return stageHeight > 0 ? Math.ceil(stageHeight * MINI_SCALE) + 8 : 0;
}

/** The mini card: on once the box has scrolled more than 40% of the card's height (the card stays pinned at the top). */
export function miniWanted(scrollTop, stageHeight) {
    return stageHeight > 0 && scrollTop > stageHeight * 0.4;
}

export function initCardTabs(doc = document, win = window) {
    const bar = doc.getElementById('cardTabs'), body = doc.querySelector('#cardCard .r4-card');
    if (!bar || !body) return;
    const spacer = () => body.querySelector(':scope > .r4-keep') || body.appendChild(Object.assign(doc.createElement('div'), { className: 'r4-keep' }));
    bar.addEventListener('click', (e) => {
        const b = e.target.closest('.r4-tab');
        if (!b) return;
        // The box changes where it is: no jump back to the top and no full-size card (raven575's phone run, 2026-11-14);
        // the mini card in the corner keeps showing each change. A shorter category would pull the box up (and the card
        // back to full size), so a spacer at the end keeps the old length until the next category button.
        const top = body.scrollTop, keep = spacer();
        const was = body.scrollHeight - keep.offsetHeight;
        keep.style.height = '0px';
        showCardTab(doc, b.dataset.tab);
        if (top > 0) {
            keep.style.height = `${Math.max(0, was - body.scrollHeight)}px`;
            body.scrollTop = top;
        }
    });
    // Arrow keys move along the row, as in any row of picture buttons
    bar.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        const tabs = [...bar.querySelectorAll('.r4-tab')], i = tabs.indexOf(doc.activeElement);
        if (i < 0) return;
        const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
        next.focus(); showCardTab(doc, next.dataset.tab); e.preventDefault();
    });
    // The look panel's own opener is not shown any more; if anything still closes it while Logo or Paper is up,
    // the category follows (back to Colour)
    const look = doc.getElementById('cardLookPanel');
    if (look) look.addEventListener('toggle', () => { if (!look.open && LOOK_TABS.has(body.dataset.tab)) showCardTab(doc, 'colour'); });
    showCardTab(doc, body.dataset.tab || 'colour');

    // Mini card (phones and tablets; a wide screen keeps the card beside the tools, layout-wide.css). The card is pinned
    // to the top of its screen (screens-r4.css) and shrinks into the corner once the box below has scrolled.
    const stage = body.querySelector('.r4-stage');
    if (!stage) return;
    let queued = false;
    const isMini = () => body.dataset.mini === 'on';
    const isWide = () => ['laptop', 'monitor', 'wide'].includes(doc.documentElement.dataset.tier);
    const sync = () => {
        queued = false;
        const on = !isWide() && miniWanted(body.scrollTop, stage.offsetHeight);
        if (on !== isMini()) { if (on) body.dataset.mini = 'on'; else delete body.dataset.mini; }
        // The choices scroll away under a band as tall as the mini card, so none sits half under it (raven575's Play
        // build 562 run, 2026-11-23: the mini card hid the Dots picker, Style and Paper buttons, Icons and the hint)
        if (on) body.style.setProperty('--r4-mini-band', `${miniBandHeight(stage.offsetHeight)}px`);
    };
    const queue = () => { if (!queued) { queued = true; win.requestAnimationFrame(sync); } };
    body.addEventListener('scroll', queue, { passive: true });
    if (win.ResizeObserver) { const watch = new win.ResizeObserver(queue); watch.observe(body); watch.observe(stage); }
    // A tap on the mini card brings the whole card back (scrolls up) instead of spinning it
    const reduce = () => !!(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches);
    for (const type of ['pointerdown', 'pointermove', 'click']) stage.addEventListener(type, (e) => { if (isMini()) e.stopPropagation(); }, true);
    const fullCard = () => body.scrollTo({ top: 0, behavior: reduce() ? 'auto' : 'smooth' });
    stage.addEventListener('pointerup', (e) => {
        if (!isMini()) return;
        e.stopPropagation();
        fullCard();
    }, true);
    // Flip card turns the card where it is, mini or not, and stays under the finger (raven575's Android run, 2026-11-16:
    // scrolling back up to the whole card pushed the choices down out of reach). The other side has its own choices
    // (Checkers' QR picks), so the box is scrolled by however far the button moved, before the frame is drawn, with the
    // spacer making room when the new choices are shorter.
    const flip = doc.getElementById('flipCardBtn');
    if (flip) flip.addEventListener('click', () => {
        if (isWide() || body.scrollTop <= 0) return;
        const before = flip.getBoundingClientRect().top;
        win.requestAnimationFrame(() => {
            if (!flip.getClientRects().length) return;
            const keep = spacer(), want = body.scrollTop + flip.getBoundingClientRect().top - before;
            const short = want - (body.scrollHeight - body.clientHeight);
            if (short > 0) keep.style.height = `${keep.offsetHeight + Math.ceil(short)}px`;
            body.scrollTop = Math.max(0, want);
        });
    }, true);   // (capture: measured before the card's own Flip card handler swaps the choices)
}
