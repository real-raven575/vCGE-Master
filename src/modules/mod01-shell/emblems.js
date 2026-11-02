/**
 * vCGE-MOD01: background texture and pilot emblems (0.8 redesign, Creative's CRTV-0020 mock-up, raven575 2026-11-01)
 * Created by raven575, Team vCGE (Claude) & Gemini
 *
 * Each card carries one large line-art emblem for its pilot's job, in the theme's accent at low opacity, behind the
 * card's content (Creative's default spots: percent of the card for the centre, px for the size, degrees). They are
 * shapes, not characters, so both editions show them. A soft halftone dot texture sits behind the whole deck. Both are
 * inline SVG put in once at start (no files to fetch, no style attributes: positions go through CSSOM), hidden from
 * screen readers, take no taps, and forced-colours mode hides them.
 */
export const EMBLEMS = Object.freeze({
    welcome: { pilot: 'shutout', title: "Shutout the Box turtle: honeycomb", at: {x:94.8,y:59.1,s:488,r:0},
        art: '<path d="M128 100L114 124.2M114 124.2L86 124.2M86 124.2L72 100M72 100L86 75.8M86 75.8L114 75.8M114 75.8L128 100M170 124.2L156 148.5M156 148.5L128 148.5M128 148.5L114 124.2M128 100L156 100M156 100L170 124.2M128 148.5L114 172.7M114 172.7L86 172.7M86 172.7L72 148.5M72 148.5L86 124.2M72 148.5L44 148.5M44 148.5L30 124.2M30 124.2L44 100M44 100L72 100M44 100L30 75.8M30 75.8L44 51.5M44 51.5L72 51.5M72 51.5L86 75.8M128 51.5L114 75.8M72 51.5L86 27.3M86 27.3L114 27.3M114 27.3L128 51.5M170 75.8L156 100M128 51.5L156 51.5M156 51.5L170 75.8"/>' },
    capture: { pilot: 'iris', title: "Iris the Lynx: aperture", at: {x:94.2,y:87.3,s:340,r:67},
        art: '<circle cx="100" cy="100" r="74"/><path d="M107.8 71L167.4 130.6"/><path d="M129 92.2L107.2 173.7"/><path d="M121.2 121.2L39.8 143"/><path d="M92.2 129L32.6 69.4"/><path d="M71 107.8L92.8 26.3"/><path d="M78.8 78.8L160.2 57"/>' },
    read: { pilot: 'glyph', title: "Glyph the Owl: open book", at: {x:87.1,y:38.9,s:508,r:0},
        art: '<path d="M100 54C80 42 50 40 26 48V150C50 142 80 144 100 156Z"/><path d="M100 54C120 42 150 40 174 48V150C150 142 120 144 100 156"/><path d="M42 74H84M42 92H84M42 110H76M42 128H82M116 74H158M116 92H150M116 110H158M116 128H140"/>' },
    fields: { pilot: 'pidge', title: "Pidge the Octopus: sorting rack", at: {x:85.5,y:61.8,s:412,r:0},
        art: '<rect x="70" y="18" width="60" height="40" rx="7"/><path d="M77 18L100 38L123 18"/><rect x="28" y="74" width="144" height="96" rx="12"/><path d="M28 106H172M28 138H172M76 74V106M124 74V106M100 106V138M76 138V170M124 138V170"/>' },
    card: { pilot: 'flipside', title: "Flipside the Chameleon: palette", at: {x:27.7,y:86.4,s:348,r:67},
        art: '<path d="M100 26C150 26 178 62 176 100C174 130 152 142 134 136C118 131 110 142 114 156C118 172 104 178 90 176C50 172 24 142 24 100C24 58 54 26 100 26Z"/><circle cx="64" cy="82" r="11"/><circle cx="100" cy="60" r="11"/><circle cx="138" cy="74" r="11"/><circle cx="56" cy="122" r="11"/><circle cx="84" cy="140" r="8" fill="currentColor" stroke="none"/>' },
    share: { pilot: 'airlock', title: "Airlock the Peregrine falcon: paper plane", at: {x:75.3,y:-9,s:120,r:18},
        art: '<path d="M22 98L178 34L128 158L106 136L90 126Z"/><path d="M90 126L155.1 57.9"/><path d="M90 126L90 162L106 136"/><path d="M22 136L46 126M30 160L58 148M56 180L80 170"/>' }
});

// The two sheets carry one each too (gap list row 8): Ghost's vault dial behind the Vault, Shutout's honeycomb behind
// Settings, at Creative's spots for them (percent of the sheet, px).
export const SHEET_EMBLEMS = Object.freeze({
    vaultPage: { pilot: 'ghost', title: 'Ghost the Raccoon: vault dial', at: {x:50.3,y:8.9,s:120,r:0},
        art: '<circle cx="100" cy="100" r="74"/><circle cx="100" cy="100" r="36"/><path d="M93 102A11 11 0 1 1 107 102L111 122H89Z"/><path d="M164 100L152 100M161.8 116.6L156 115M155.4 132L145 126M145.3 145.3L141 141M132 155.4L126 145M116.6 161.8L115 156M100 164L100 152M83.4 161.8L85 156M68 155.4L74 145M54.7 145.3L59 141M44.6 132L55 126M38.2 116.6L44 115M36 100L48 100M38.2 83.4L44 85M44.6 68L55 74M54.7 54.7L59 59M68 44.6L74 55M83.4 38.2L85 44M100 36L100 48M116.6 38.2L115 44M132 44.6L126 55M145.3 54.7L141 59M155.4 68L145 74M161.8 83.4L156 85"/>' },
    settingsSheet: { pilot: 'shutout', title: EMBLEMS.welcome.title, at: {x:96.3,y:62.3,s:320,r:0}, art: EMBLEMS.welcome.art }
});

const NS = 'http://www.w3.org/2000/svg';

/** The emblem's SVG markup (stroke in currentColor). */
export const emblemSvg = (e) => `<svg xmlns="${NS}" viewBox="0 0 200 200" fill="none" stroke="currentColor" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${e.art}</svg>`;

// One emblem into its host, at its spot (positions go through CSSOM: the CSP allows no style attributes)
function placeEmblem(doc, host, e) {
    if (!host || host.querySelector(':scope > .vcge-emblem')) return;
    const el = doc.createElement('div');
    el.className = 'vcge-emblem'; el.setAttribute('aria-hidden', 'true'); el.dataset.pilot = e.pilot;
    el.innerHTML = emblemSvg(e);
    const { x, y, s, r } = e.at;
    el.style.setProperty('--em-x', `${x}%`); el.style.setProperty('--em-y', `${y}%`);
    el.style.setProperty('--em-s', `${s}px`); el.style.setProperty('--em-r', `${r}deg`);
    host.prepend(el);
}

/** Put one emblem in each deck card and in the Vault and Settings sheets (once), and the dot texture behind the deck. */
export function paintEmblems(doc = document) {
    for (const [card, e] of Object.entries(EMBLEMS)) placeEmblem(doc, doc.querySelector(`.deck-card[data-card="${card}"]`), e);
    for (const [id, e] of Object.entries(SHEET_EMBLEMS)) placeEmblem(doc, doc.querySelector(`#${id} > .vcge-sheet-panel`), e);
    if (!doc.querySelector('.vcge-tex')) {
        const tex = doc.createElementNS(NS, 'svg');
        tex.setAttribute('class', 'vcge-tex'); tex.setAttribute('aria-hidden', 'true'); tex.setAttribute('focusable', 'false');
        tex.innerHTML = '<defs><pattern id="vcgeTexDots" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(30)"><circle cx="3" cy="3" r="1.25" fill="currentColor"/></pattern>'
            + '<filter id="vcgeTexGrain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".011" numOctaves="3" seed="7"/><feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 2.2 -.55"/></filter>'
            + '<mask id="vcgeTexMask"><rect width="100%" height="100%" filter="url(#vcgeTexGrain)"/></mask></defs>'
            + '<rect width="100%" height="100%" fill="url(#vcgeTexDots)" mask="url(#vcgeTexMask)"/>';
        doc.body.prepend(tex);
    }
}
