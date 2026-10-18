/**
 * vCard Generator Engine (vCGE)
 * Copyright (c) 2026 raven575, Team vCGE (Claude) & Gemini
 *
 * Repository: https://github.com/real-raven575/vCGE-Master
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * vCGE-MOD04: finds the icon printed in front of a card line (phone handset, envelope, globe, map pin, social logo...).
 * Tesseract reads such icons as a junk "word" ("Q", "B&", "©", "(»)") at the start of the line, which marks where the
 * icon is; otherwise the space just left of the text is searched. The shape found is matched against templates
 * rendered from src/vendor/icons/templates.json (Lucide, ISC; Simple Icons, CC0) plus a drawn LinkedIn "in".
 * Everything runs on the device; the result is only a hint for the field mapper (the text always wins).
 */
import { inkMask, connectedComponents, unionBox, describeShape, classifyShape } from './iconMatcher.js';

// Decision thresholds and the classes allowed to report. Chosen on Material and Tabler icons (never the templates'
// own sets); measured on held-out Font Awesome icons: 94% of reported icons right, 81% of icons found, no icon reported
// on icon-free lines (tests/icons.e2e.test.cjs, docs/spec.md).
export const ICON_MATCH = { minScore: 0.6, minMargin: 0.02 };
export const ENABLED_ICONS = new Set(['phone', 'mobile', 'email', 'web', 'address', 'home', 'fax',
    'linkedin', 'x', 'facebook', 'instagram', 'github', 'youtube', 'tiktok']);

// Single letters that are real line labels (E jdoe@..., T 555..., M 555...), never icon debris.
const LABEL_LETTERS = /^[ETMWFPCOHDetmwfpcohd][:.]?$/;
const RENDER = 96;

const vendorUrl = (file) => new URL(`src/vendor/icons/${file}`, document.baseURI).href;
let templatesPromise = null;

async function svgImage(svgText) {
    const img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText);
    await img.decode();
    return img;
}

/** Ink mask and box of whatever is drawn by `paint(ctx)` on a RENDER x RENDER canvas (null if blank). */
function shapeOf(paint) {
    const c = document.createElement('canvas');
    c.width = c.height = RENDER;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, RENDER, RENDER);
    paint(ctx);
    const rgba = ctx.getImageData(0, 0, RENDER, RENDER).data;
    const gray = new Uint8Array(RENDER * RENDER);
    for (let i = 0; i < gray.length; i++) gray[i] = rgba[i * 4];
    const ink = inkMask(gray, RENDER, { x0: 0, y0: 0, x1: RENDER, y1: RENDER });
    const comps = connectedComponents(ink);
    if (!comps.length) return null;
    return { ink, box: unionBox(comps) };
}

/** Template shapes: outline icons at three stroke weights plus filled; logos as drawn. [{ cls, ink, box }] */
export async function renderTemplateShapes() {
    const res = await fetch(vendorUrl('templates.json'));
    if (!res.ok) throw new Error(`icon templates: HTTP ${res.status}`);
    const sources = await res.json();
    const templates = [];
    for (const [cls, svgs] of Object.entries(sources)) {
        for (const svg of svgs) {
            const variants = /stroke="currentColor"/.test(svg)
                ? ['1.5', '2', '2.75'].map(w => svg.replace(/stroke-width="[^"]*"/, `stroke-width="${w}"`).replace(/currentColor/g, '#000'))
                    .concat(svg.replace('fill="none"', 'fill="#000"').replace(/currentColor/g, '#000'))
                : [svg.replace('<svg ', '<svg fill="#000" ')];
            for (const v of variants) {
                const img = await svgImage(v.replace(/width="24" height="24"/, `width="${RENDER}" height="${RENDER}"`));
                const shape = shapeOf(ctx => ctx.drawImage(img, 8, 8, RENDER - 16, RENDER - 16));
                if (shape) templates.push({ cls, ...shape });
            }
        }
    }
    // Logos often printed as a bare letter: LinkedIn "in" (its logo is not in the bundled sets), Facebook "f", X "X";
    // each alone, and knocked out of a rounded square or circle.
    const glyph = (ctx, text, color) => {
        ctx.fillStyle = color; ctx.font = `bold ${RENDER * 0.62}px Arial, Helvetica, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, RENDER / 2, RENDER * 0.56);
    };
    const square = (ctx) => { ctx.fillStyle = '#000'; ctx.beginPath(); ctx.roundRect(8, 8, RENDER - 16, RENDER - 16, RENDER * 0.12); ctx.fill(); };
    const circle = (ctx) => { ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(RENDER / 2, RENDER / 2, RENDER / 2 - 8, 0, Math.PI * 2); ctx.fill(); };
    // Label letters (E jdoe@..., T 555...) that Tesseract did not read: matched as 'label:E' etc., so a letter is
    // never taken for an icon and its label is recovered.
    for (const letter of 'ETMWFPCOHD') {
        for (const font of ['bold 64px Arial, Helvetica, sans-serif', '64px Arial, Helvetica, sans-serif', 'bold 64px Georgia, serif', '64px Georgia, serif']) {
            const shape = shapeOf(ctx => { ctx.fillStyle = '#000'; ctx.font = font; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(letter, RENDER / 2, RENDER / 2); });
            if (shape) templates.push({ cls: `label:${letter}`, ...shape });
        }
    }
    for (const [cls, text] of [['linkedin', 'in'], ['facebook', 'f'], ['x', 'X']]) {
        for (const paint of [(ctx) => glyph(ctx, text, '#000'), (ctx) => { square(ctx); glyph(ctx, text, '#fff'); }, (ctx) => { circle(ctx); glyph(ctx, text, '#fff'); }]) {
            const shape = shapeOf(paint);
            if (shape) templates.push({ cls, ...shape });
        }
    }
    return templates;
}

async function buildTemplates() {
    return (await renderTemplateShapes()).map(({ cls, ink, box }) => ({ cls, descriptor: describeShape(ink, box) }));
}

export function loadIconTemplates() {
    if (!templatesPromise) templatesPromise = buildTemplates().catch(e => { templatesPromise = null; throw e; });
    return templatesPromise;
}

const alnumCount = (t) => (t.match(/[A-Za-z0-9]/g) || []).length;

/** Is a line's first word icon debris (short, symbol-heavy or unsure, set apart from the text)? */
function isIconDebris(word, next, h) {
    if (!next || LABEL_LETTERS.test(word.text)) return false;
    const t = word.text.trim();
    const gap = next.bbox.x0 - word.bbox.x1;
    const short = t.length <= 3 && (alnumCount(t) < t.length || t.length === 1 || word.confidence < 60);
    return short && gap > 0.35 * h;
}

/** Matches the ink inside region `r` (clamped to the image); null when nothing icon-sized is there. */
function matchRegion(gray, width, height, region, h, templates, opts) {
    const r = {
        x0: Math.max(0, Math.round(region.x0)), x1: Math.min(width, Math.round(region.x1)),
        y0: Math.max(0, Math.round(region.y0)), y1: Math.min(height, Math.round(region.y1))
    };
    if (r.x1 - r.x0 < 0.3 * h || r.y1 - r.y0 < 0.3 * h) return null;
    const ink = inkMask(gray, width, r);
    // Ignore specks; keep parts of a plausible icon (icons can be several pieces: a phone with signal waves).
    const parts = connectedComponents(ink).filter(c => c.area >= Math.max(4, h * h * 0.004));
    if (!parts.length) return null;
    const shape = unionBox(parts);
    const size = Math.max(shape.x1 - shape.x0, shape.y1 - shape.y0);
    if (size < 0.45 * h || size > 2.6 * h) return null;
    const result = classifyShape(describeShape(ink, shape), templates, opts);
    const label = result.ranked[0] && result.ranked[0][0].startsWith('label:') ? result.ranked[0][0].slice(6) : null;
    const found = {
        icon: !label && result.cls && ENABLED_ICONS.has(result.cls) ? result.cls : null,
        label,
        score: Math.round(result.score * 100) / 100, margin: Math.round(result.margin * 100) / 100, best: result.ranked[0] && result.ranked[0][0]
    };
    if (opts.keepShape) found.shape = { ink, box: shape };   // measurement only (tests and tuning)
    return found;
}

const lineHeight = (line, words) => {
    const heights = words.filter(w => alnumCount(w.text) >= 2).map(w => w.bbox.y1 - w.bbox.y0).sort((a, b) => a - b);
    return heights.length ? heights[Math.floor(heights.length / 2)] : (line.bbox.y1 - line.bbox.y0);
};

/**
 * For each Tesseract line ({ text, bbox, words }) of the image `gray` (Uint8Array, `width` wide), returns
 * { text, icon, score, margin }: `text` without icon debris, `icon` the matched class (or null). Tesseract sometimes
 * puts an icon on a line of its own ("8", "@", "in"); such a line is matched, its icon given to the text line on the
 * same row to its right, and its own text emptied.
 */
export function detectLineIcons(gray, width, height, lines, templates, opts = ICON_MATCH) {
    const out = lines.map(line => ({ line, words: (line.words || []).filter(w => w.text && w.text.trim()), text: (line.text || '').trim(), icon: null, score: 0, margin: 0, best: null }));
    const iconOnly = (o) => o.words.length === 1 && o.text.length <= 3 && !LABEL_LETTERS.test(o.text);
    const labelOnly = (o) => o.words.length === 1 && LABEL_LETTERS.test(o.text) && o.words[0].confidence >= 70;
    // The text line on the same row, to the right of `b` (a box on its left).
    const rightNeighbour = (o, b) => out.filter(t => t !== o && t.words.length && !iconOnly(t) && !labelOnly(t) && t.line.bbox.x0 >= b.x1 - 2
        && Math.min(t.line.bbox.y1, b.y1) - Math.max(t.line.bbox.y0, b.y0) > 0.4 * (b.y1 - b.y0))
        .sort((p, q) => p.line.bbox.x0 - q.line.bbox.x0)[0];

    // A label letter Tesseract put on a line of its own ("E" ... "jane@...") goes back in front of its text,
    // and its space is not searched for an icon.
    const labelled = new Set();
    out.forEach(o => {
        if (!labelOnly(o)) return;
        const target = rightNeighbour(o, o.line.bbox);
        if (!target) return;
        target.text = `${o.text} ${target.text}`;
        target.labelBox = o.line.bbox;
        labelled.add(target);
        o.text = '';
    });

    out.forEach(o => {
        if (!o.words.length || iconOnly(o) || labelOnly(o) || labelled.has(o)) return;
        const h = lineHeight(o.line, o.words);
        const debris = isIconDebris(o.words[0], o.words[1], h);
        const textStart = (debris ? o.words[1] : o.words[0]).bbox.x0;
        const region = debris
            ? { x0: o.words[0].bbox.x0 - 0.3 * h, x1: textStart - 0.1 * h }
            : { x0: textStart - 2.2 * h, x1: textStart - 0.15 * h };
        region.y0 = o.line.bbox.y0 - 0.35 * h;
        region.y1 = o.line.bbox.y1 + 0.35 * h;
        if (debris) o.text = o.words.slice(1).map(w => w.text).join(' ');
        if (!debris && LABEL_LETTERS.test(o.words[0].text)) return;   // starts with its own label: no icon expected
        const m = matchRegion(gray, width, height, region, h, templates, opts);
        if (m && m.label) { o.text = `${m.label} ${o.text}`; m.best = null; }   // an unread label letter, not an icon
        Object.assign(o, m || {});
    });

    // Icon-only lines: give their icon to the nearest text line on the same row, to the right.
    out.forEach(o => {
        if (!iconOnly(o)) return;
        const b = o.line.bbox;
        const target = rightNeighbour(o, b);
        if (!target) return;
        const h = lineHeight(target.line, target.words);
        const m = matchRegion(gray, width, height, { x0: b.x0 - 0.3 * h, x1: b.x1 + 0.3 * h, y0: b.y0 - 0.35 * h, y1: b.y1 + 0.35 * h }, h, templates, opts);
        o.text = '';
        if (m && m.label) { if (!target.label) { target.text = `${m.label} ${target.text}`; target.label = m.label; } return; }
        if (m && (!target.best || m.score > target.score)) Object.assign(target, m);
    });
    return out.map(({ text, icon, score, margin, best, shape }) => ({ text, icon, score, margin, best, ...(opts.keepShape ? { shape } : {}) }));
}

/** Loads a data-URL image into a greyscale buffer (same pixels Tesseract read). */
export async function grayFromDataUrl(dataUrl) {
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const rgba = ctx.getImageData(0, 0, c.width, c.height).data;
    const gray = new Uint8Array(c.width * c.height);
    for (let i = 0; i < gray.length; i++) gray[i] = rgba[i * 4];
    return { gray, width: c.width, height: c.height };
}
