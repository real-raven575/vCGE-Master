/**
 * vCGE-MOD06: the card maker's category buttons and the mini card (easy + premium plan, step 2; raven575 approved
 * 2026-11-13 03:48 UTC)
 * Created by raven575, Herd of Helpers (claude) & gemini
 *
 * Colour, Logo, Style and Paper: one picture button per category over one box that shows only that category
 * (.r4-card[data-tab], screens-r4.css). Logo and Paper live in the "Paper & logo" panel, which opens with them.
 * On a phone, when the box is long enough to scroll, the card shrinks to a mini card in the top corner and keeps
 * showing every change; a tap on the mini card scrolls back to the full card. Nothing is stored.
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

/** The mini card: on once the box has scrolled more than 40% of the card's height (the card stays pinned at the top). */
export function miniWanted(scrollTop, stageHeight) {
    return stageHeight > 0 && scrollTop > stageHeight * 0.4;
}

export function initCardTabs(doc = document, win = window) {
    const bar = doc.getElementById('cardTabs'), body = doc.querySelector('#cardCard .r4-card');
    if (!bar || !body) return;
    bar.addEventListener('click', (e) => {
        const b = e.target.closest('.r4-tab');
        if (b) showCardTab(doc, b.dataset.tab);
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
    const sync = () => {
        queued = false;
        const wide = ['laptop', 'monitor', 'wide'].includes(doc.documentElement.dataset.tier);
        const on = !wide && miniWanted(body.scrollTop, stage.offsetHeight);
        if (on !== isMini()) { if (on) body.dataset.mini = 'on'; else delete body.dataset.mini; }
    };
    const queue = () => { if (!queued) { queued = true; win.requestAnimationFrame(sync); } };
    body.addEventListener('scroll', queue, { passive: true });
    if (win.ResizeObserver) new win.ResizeObserver(queue).observe(body);
    // A tap on the mini card brings the whole card back (scrolls up) instead of spinning it
    const reduce = () => !!(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches);
    for (const type of ['pointerdown', 'pointermove', 'click']) stage.addEventListener(type, (e) => { if (isMini()) e.stopPropagation(); }, true);
    stage.addEventListener('pointerup', (e) => {
        if (!isMini()) return;
        e.stopPropagation();
        body.scrollTo({ top: 0, behavior: reduce() ? 'auto' : 'smooth' });
    }, true);
}
