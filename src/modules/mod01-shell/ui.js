/**
 * vCGE-MOD01: shared look and touch behaviour (redesign step 1)
 * Created by raven575, Gemini & Claude
 *
 * Size breakpoints for the three layouts, and the near-miss guard for buttons: a finger tap that lands on the outer
 * edge of a button (the outer 4 px) is ignored, so a tap meant for its neighbour does not press it. Mouse, pen and
 * keyboard presses are unchanged. The look itself (44 px buttons, 2 px outlines, the MOD-XX tag) is in ui.css.
 */

export const BREAKPOINTS = { tablet: 600, desktop: 1200 };
export const RIM_PX = 4;

// Settings > Font choices, alphabetical (raven575, 2026-10-17). Inter is the default. All are bundled in vendor/fonts.
export const UI_FONTS = ['Atkinson Hyperlegible', 'Comic Neue', 'Inter', 'Lexend', 'Macondo', 'OpenDyslexic', 'Tinos'];
export const DEFAULT_UI_FONT = 'Inter';

// 'phone' under 600 px, 'tablet' 600-1199 px, 'desktop' 1200 px and up (the same numbers as ui.css).
export function layoutFor(width) {
    return width < BREAKPOINTS.tablet ? 'phone' : width < BREAKPOINTS.desktop ? 'tablet' : 'desktop';
}

// True when the point is inside the box but within `rim` px of its edge.
export function onRim(rect, x, y, rim = RIM_PX) {
    const inside = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    return inside && (x - rect.left < rim || rect.right - x < rim || y - rect.top < rim || rect.bottom - y < rim);
}

// The button (or file-picker label) a tap landed on, if any. Crop corners are drag handles, not buttons.
function pressable(target) {
    if (!target || !target.closest) return null;
    const button = target.closest('button');
    if (button) return button.classList.contains('crop-handle') ? null : button;
    const label = target.closest('label');
    return label && label.querySelector(':scope > input[type="file"]') ? label : null;
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    let touching = false;
    document.addEventListener('pointerdown', (e) => { touching = e.pointerType === 'touch'; }, true);
    document.addEventListener('click', (e) => {
        if (!touching || e.detail === 0) return;   // not a finger, or a keyboard press
        const el = pressable(e.target);
        if (el && onRim(el.getBoundingClientRect(), e.clientX, e.clientY)) {
            e.preventDefault();
            e.stopImmediatePropagation();
        }
    }, true);
}
