/**
 * vCGE-MOD01: the screen tier (layout step 1, raven575 approved 2026-10-22; plan notes/layout/responsive-options.html)
 * Created by raven575, Team vCGE (Claude) & Gemini
 *
 * Names the kind of screen on <html data-tier>: phone, small-tablet, large-tablet, laptop, monitor or wide. It is the
 * window's width divided by the text size (Settings), so Larger text on a tablet lays out like a smaller tablet and
 * nothing gets squeezed. A very wide window (21:9 or wider, at least monitor-wide) counts as wide too. A window under
 * 500 px tall (a phone held sideways) also gets html[data-short]. Nothing is drawn from this step on its own: the
 * later layout steps hang their rules on these hooks. Nothing is stored.
 */

// Each tier and the width (in text-size px) it starts at, in order.
export const TIERS = Object.freeze([
    ['phone', 0], ['small-tablet', 600], ['large-tablet', 900], ['laptop', 1200], ['monitor', 1600], ['wide', 2200]
]);
export const SHORT_PX = 500;
const ULTRAWIDE = 21 / 9;

/** width and height in CSS px, size = the text-size factor (1 = Normal) -> the tier's name */
export function tierFor(width, height, size = 1) {
    const w = width / (size > 0 ? size : 1);
    if (w >= TIERS[4][1] && height > 0 && width / height >= ULTRAWIDE) return 'wide';
    let name = TIERS[0][0];
    for (const [tier, from] of TIERS) if (w >= from) name = tier;
    return name;
}

export function initTier(win = typeof window !== 'undefined' ? window : null) {
    const doc = win && win.document, root = doc && doc.documentElement;
    if (!root) return;
    let queued = false;
    const update = () => {
        queued = false;
        const size = parseFloat(root.style.getPropertyValue('--vcge-size')) || 1;
        const tier = tierFor(win.innerWidth, win.innerHeight, size);
        if (root.dataset.tier !== tier) root.dataset.tier = tier;
        const short = win.innerHeight > 0 && win.innerHeight < SHORT_PX;
        if (short) root.dataset.short = '1'; else delete root.dataset.short;
    };
    const queue = () => { if (!queued) { queued = true; win.requestAnimationFrame(update); } };
    win.addEventListener('resize', queue);
    // The page's own size as well, at once: in WebKit a new window size can reach the layout before the resize event does
    if (win.ResizeObserver) new win.ResizeObserver(update).observe(root);
    // A new text size (settings.js sets html[data-size]) changes the tier as well
    if (win.MutationObserver) new win.MutationObserver(queue).observe(root, { attributes: true, attributeFilter: ['data-size'] });
    update();   // at once, so the first frame already has its tier
}
