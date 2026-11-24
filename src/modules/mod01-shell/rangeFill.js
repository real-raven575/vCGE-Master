/**
 * MOD01 Shell: the filled part of the premium sliders (premium.css). WebKit and Blink have no "progress" part for a
 * range input, so the track draws its accent up to --ctl-fill and this keeps that number in step with the value.
 * Firefox draws its own (::-moz-range-progress). The sliders change by hand (input), by code after a tap (the card's
 * Paper picks, Settings' reflect), or on start, so it repaints on input and change, just after any click, and once now.
 */
export const RANGE_SELECTOR = '.r5-range input[type="range"], .r4-strength input[type="range"]';

/** The share of the track to fill, as a CSS percentage: 0% at min, 100% at max (min 0 and max 100 when unset). */
export function fillPercent(value, min, max) {
    const lo = Number.isFinite(+min) && min !== '' ? +min : 0, hi = Number.isFinite(+max) && max !== '' ? +max : 100;
    if (hi <= lo) return '0%';
    const p = Math.min(1, Math.max(0, (+value - lo) / (hi - lo)));
    return `${Math.round(p * 1000) / 10}%`;
}

export function paintRange(input) {
    input.style.setProperty('--ctl-fill', fillPercent(input.value, input.min, input.max));
}

export function paintRanges(root = document) {
    root.querySelectorAll(RANGE_SELECTOR).forEach(paintRange);
}

export function initRangeFill(doc = document) {
    const onValue = (e) => { if (e.target instanceof doc.defaultView.HTMLInputElement && e.target.matches(RANGE_SELECTOR)) paintRange(e.target); };
    doc.addEventListener('input', onValue, true);
    doc.addEventListener('change', onValue, true);
    doc.addEventListener('click', () => setTimeout(() => paintRanges(doc), 0), true);
    paintRanges(doc);
}
