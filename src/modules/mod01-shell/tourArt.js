/**
 * vCGE-MOD01: the tour's pilot art (Creative's CRTV-0059, Plan A: one 160 px character per tour step)
 * Created by raven575, Herd of Helpers (claude) & gemini
 *
 * One slot per pilot, drawn by Creative (🐊 Crayon, CRTV-0059 finals, approved by raven575 2026-11-11). The drawings live in
 * tourArtSvgs.js and their styles in tour-art.css, both made by scripts/tour-art.mjs from Creative's files; a pilot without a
 * drawing (or one that fails safeSvg) shows its emoji. The soft disc behind each takes the theme's
 * --sh-soft. Colours go in fill/stroke attributes, never style="" (the page's CSP drops inline styles); gradients and filters
 * point only inside the drawing (#id). Nothing here is fetched: the art is part of the app's own code.
 * The plain edition shows no pilots, so the tour leaves the slot out there.
 */
import { TOUR_SVGS } from './tourArtSvgs.js';

export const TOUR_ART = Object.freeze({
    shutout:     { name: 'Shutout the Box Turtle',   emoji: '🐢', svg: TOUR_SVGS.shutout },
    iris:        { name: 'Iris the Lynx',            emoji: '🐈', svg: TOUR_SVGS.iris },
    pidge:       { name: 'Pidge the Octopus',        emoji: '🐙', svg: TOUR_SVGS.pidge },
    flipside:    { name: 'Flipside the Chameleon',   emoji: '🦎', svg: TOUR_SVGS.flipside },
    airlock:     { name: 'Airlock the Falcon',       emoji: '🦅', svg: TOUR_SVGS.airlock },
    ghost:       { name: 'Ghost the Raccoon',        emoji: '🦝', svg: TOUR_SVGS.ghost },
    cornerstone: { name: 'Cornerstone the Elephant', emoji: '🐘', svg: TOUR_SVGS.cornerstone }
});

/** Only plain drawing markup is let in: one <svg>, and no script, foreignObject, outside link, event handler, <style> or
 *  SMIL animation (the sway is in tour-art.css, off under reduced motion). */
export function safeSvg(markup) {
    if (typeof markup !== 'string') return false;
    const m = markup.trim();
    return /^<svg[\s>]/i.test(m) && /<\/svg>$/i.test(m)
        && !/<\s*(script|foreignObject|a|animate\w*|set|image|style)\b/i.test(m)
        && !/\son\w+\s*=/i.test(m)
        && !/href\s*=\s*["'](?!#)/i.test(m) && !/url\s*\(\s*(?!["']?#)/i.test(m);    // only links inside the drawing (#id)
}

/** The slot for a pilot (aria-hidden: the step's title and words say it all), or null for no pilot or in plain. */
export function tourArtEl(pilot, doc = document, plain = false) {
    const art = TOUR_ART[pilot];
    if (!art || plain) return null;
    const slot = doc.createElement('div');
    slot.className = 'vcge-tour-art';
    slot.dataset.pilot = pilot;
    slot.setAttribute('aria-hidden', 'true');
    if (safeSvg(art.svg)) { slot.innerHTML = art.svg.trim(); slot.dataset.art = 'svg'; }
    else { slot.textContent = art.emoji; slot.dataset.art = 'emoji'; }
    return slot;
}
