/**
 * vCGE-MOD01: screen languages (translation wave 1, raven575 2026-11-04; first pack Spanish, 2026-11-20)
 * Created by raven575, Herd of Helpers (claude) & gemini
 *
 * The words on vCGE's screens, in the language picked in Settings > Language. English stays in the HTML and the modules
 * exactly as before; a language pack is a bundled file (./lang/<id>.js, same origin, loaded only when picked) that maps
 * each English line to its translation. While a pack is on, every text node and every aria-label, title, placeholder and
 * alt on the page is swapped for its translation, and a MutationObserver does the same for anything a module draws or
 * changes later (toasts, tour steps, the On / Off words). A line the pack does not know stays in English, so a missing
 * entry is never a blank or broken screen. English back on puts every swapped line back as it was.
 *
 * Never translated: anything inside [translate="no"]; the contact itself (the vCard is built from the contact, never from
 * the screen, so a translated label can never reach the file); the tagline "Operation: Never Lose Contact" (Locked); and
 * <option> values (an option without a value keeps its English text as its value, so code reading .value sees no change).
 * Pilot names stay in English with the animal in the screen's language beside them, "Shutout (la Tortuga de caja)"
 * (raven575, 2026-11-20): a pack's names table builds those lines.
 *
 * The choice is `lang` in vcge_settings (settings.js): fixed codes, never reused. 0 follows the device's language when a
 * pack exists for it (else English), 1 English, 2 Español. Wave 1 reserves 3 Português (Brasil), 4 Français, 5 Deutsch,
 * 6 Bahasa Indonesia and 7 Hindi (screens only). Card reading (MOD04) still uses the English reader in every language.
 */

// Fixed codes. `name` is the language's own name, so it reads right whatever language the screens are in.
export const LANGUAGES = Object.freeze([
    { code: 0, id: 'device', name: 'Device language' },
    { code: 1, id: 'en', name: 'English' },
    { code: 2, id: 'es', name: 'Español' }
]);
export const DEFAULT_LANG = 0;
// The packs, loaded on first use. An explicit map (not a variable path) so the Vite build bundles each one.
const PACKS = { es: () => import('./lang/es.js') };
export const PACK_IDS = Object.freeze(Object.keys(PACKS));

/** The language id to show for a saved code: en, or a pack id. `device` reads the browser's language list. */
export function resolveLanguage(code, deviceLangs = typeof navigator !== 'undefined' ? (navigator.languages || [navigator.language]) : []) {
    const lang = LANGUAGES.find(l => l.code === code) || LANGUAGES[0];
    if (lang.id !== 'device') return lang.id;
    for (const tag of deviceLangs || []) {
        const base = String(tag || '').toLowerCase().split('-')[0];
        if (base === 'en') return 'en';
        if (PACKS[base]) return base;
    }
    return 'en';
}

/** One line as the pack keys it: runs of spaces and line breaks become one space, ends trimmed. */
export const normalize = (s) => String(s).replace(/\s+/g, ' ').trim();

/** The translation of one English line, or null when the pack has none. Exact lines first, then the pack's patterns. */
export function translateLine(pack, text) {
    if (!pack) return null;
    const key = normalize(text);
    if (!key) return null;
    if (Object.prototype.hasOwnProperty.call(pack.strings, key)) return pack.strings[key];
    // A pattern is [RegExp, 'replacement with $1'] or [RegExp, (match, line) => text or null]; `line` looks up one part,
    // so a pattern can say no (null) when a part is unknown and the whole line then stays in English.
    for (const [re, to] of pack.patterns || []) {
        const m = key.match(re);
        if (!m) continue;
        const out = typeof to === 'function' ? to(m, (part) => translateLine(pack, part)) : key.replace(re, to);
        if (out !== null && out !== undefined) return out;
    }
    return null;
}

// What has been swapped, so English can come back and the observer never translates its own writes twice.
const ATTRS = ['aria-label', 'title', 'placeholder', 'alt'];
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'NOSCRIPT']);
let current = { id: 'en', pack: null };
let observer = null;
const swapped = new Set();          // { node, attr|null, en, to }
const byNode = new WeakMap();       // node -> Map(attr|'#text' -> record)

const skipped = (el) => !el || SKIP.has(el.tagName) || !!el.closest('[translate="no"], svg');

function swapText(node, pack) {
    const el = node.parentElement;
    if (skipped(el)) return;
    const recs = byNode.get(node);
    const rec = recs && recs.get('#text');
    if (rec && node.nodeValue === rec.to) return;                   // our own write
    const to = translateLine(pack, node.nodeValue);
    if (to === null || to === normalize(node.nodeValue)) { if (rec) { swapped.delete(rec); recs.delete('#text'); } return; }
    const v = node.nodeValue, lead = v.match(/^\s*/)[0], tail = v.match(/\s*$/)[0];
    if (el.tagName === 'OPTION' && !el.hasAttribute('value')) el.setAttribute('value', el.value);   // .value keeps the English
    const next = { node, attr: null, en: v, to: lead + to + tail };
    if (rec) swapped.delete(rec);
    swapped.add(next);
    (byNode.get(node) || byNode.set(node, new Map()).get(node)).set('#text', next);
    node.nodeValue = next.to;
}

function swapAttr(el, attr, pack) {
    if (skipped(el) || !el.hasAttribute(attr)) return;
    const recs = byNode.get(el), rec = recs && recs.get(attr), v = el.getAttribute(attr);
    if (rec && v === rec.to) return;
    const to = translateLine(pack, v);
    if (to === null || to === normalize(v)) { if (rec) { swapped.delete(rec); recs.delete(attr); } return; }
    const next = { node: el, attr, en: v, to };
    if (rec) swapped.delete(rec);
    swapped.add(next);
    (byNode.get(el) || byNode.set(el, new Map()).get(el)).set(attr, next);
    el.setAttribute(attr, to);
}

/** Translate everything under root with the pack (exported for the tests). */
export function translateTree(root, pack) {
    if (!root || !pack) return;
    const doc = root.ownerDocument || root;
    const walk = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) swapText(n, pack);
    const els = root.querySelectorAll ? root.querySelectorAll(ATTRS.map(a => `[${a}]`).join(',')) : [];
    for (const el of els) for (const a of ATTRS) swapAttr(el, a, pack);
    if (root.nodeType === 1) for (const a of ATTRS) swapAttr(root, a, pack);
}

/** Put every swapped line back in English (only where the screen still shows our translation). */
function restoreEnglish() {
    for (const rec of swapped) {
        if (rec.attr) { if (rec.node.getAttribute(rec.attr) === rec.to) rec.node.setAttribute(rec.attr, rec.en); }
        else if (rec.node.nodeValue === rec.to) rec.node.nodeValue = rec.en;
    }
    swapped.clear();
}

function watch(doc, pack) {
    const Obs = doc.defaultView && doc.defaultView.MutationObserver;
    if (!Obs) return;
    observer = new Obs((list) => {
        for (const m of list) {
            if (m.type === 'characterData') swapText(m.target, pack);
            else if (m.type === 'attributes') swapAttr(m.target, m.attributeName, pack);
            else m.addedNodes.forEach(n => (n.nodeType === 3 ? swapText(n, pack) : n.nodeType === 1 && translateTree(n, pack)));
        }
    });
    observer.observe(doc.body || doc.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}

/** Load a pack by id (null for English or an unknown id). */
export async function loadPack(id) {
    if (!PACKS[id]) return null;
    const mod = await PACKS[id]();
    return mod.default || mod;
}

/** Show the screens in a language id (en or a pack id): sets <html lang>, swaps the words, and watches for new ones. */
export async function setLanguage(id, doc = document) {
    const pack = await loadPack(id);
    if (observer) { observer.disconnect(); observer = null; }
    restoreEnglish();
    current = { id: pack ? id : 'en', pack };
    doc.documentElement.lang = pack ? (pack.htmlLang || id) : 'en';
    if (!pack) return current.id;
    translateTree(doc.body || doc.documentElement, pack);
    watch(doc, pack);
    return current.id;
}

/** The language showing now (en or a pack id). */
export const currentLanguage = () => current.id;
/** One line in the language showing now (for code that builds text itself); English when the pack has none. */
export const t = (english) => translateLine(current.pack, english) ?? english;
