/**
 * vCGE-MOD08 Export (Airlock): the small touches raven575 approved on 2026-10-21 (notes/cute-ideas/mod08-airlock.md).
 * Attributions: Created by raven575, Team vCGE (Claude) & Gemini
 *
 * E1 the hatch: each Share button's little door swings open for a moment when pressed, with air lines and a soft
 *    green ring round the button (export.css; reduce motion: no movement).
 * E2 the falcon: after a save or a print, a falcon swoops once over the toast, beating its wings three times; Q8: from
 *    QR PNG it carries a striped parcel (Checkers' code). It leaves with the toast's next message. Reduce motion: it
 *    just sits at the end.
 * E3 the runway lights: three dots on Ready to share, filled as the card gets a name, a way to reach them and a
 *    scannable code (filled vs outlined, so they never rely on colour alone), with the same words for screen readers.
 *    A light that comes on grows and settles once.
 * The bigger versions (raven575's test report, 2026-10-22: "a bit more noticeable") play once and never flash.
 * The hatch and the falcon are branding: the plain edition hides them (export.css). The lights are a hint, kept in both.
 * Nothing here reads or keeps contact data beyond the yes/no each light needs.
 */

export const HATCH_OPEN_MS = 400;
const $ = (id) => document.getElementById(id);

/** E1: wires every Share button's door. */
export function wireHatches(root = document) {
    root.querySelectorAll('button.share-btn').forEach((button) => {
        let timer = null;
        button.addEventListener('click', () => {
            const hatch = button.querySelector('.hatch');
            if (!hatch) return;
            hatch.classList.add('is-open');
            button.classList.add('is-launching');
            clearTimeout(timer);
            timer = setTimeout(() => { hatch.classList.remove('is-open'); button.classList.remove('is-launching'); }, HATCH_OPEN_MS);
        });
    });
}

let flownFor = null;
/** E2: watches the toast so the falcon leaves with the next message. */
export function wireFalcon() {
    const message = $('toastMessage');
    if (!message || typeof MutationObserver === 'undefined') return;
    new MutationObserver(() => { if (message.textContent !== flownFor) landFalcon(); }).observe(message, { childList: true, characterData: true, subtree: true });
}

/** E2 / Q8: the falcon glides once over the toast that is showing now; `parcel` adds Checkers' striped parcel. */
export function flyFalcon({ parcel = false } = {}) {
    const falcon = $('toastFalcon'), message = $('toastMessage');
    if (!falcon || !message) return;
    flownFor = message.textContent;
    falcon.classList.toggle('with-parcel', parcel);
    falcon.classList.remove('hidden', 'is-gliding');
    void falcon.getBoundingClientRect();
    falcon.classList.add('is-gliding');
}

export function landFalcon() {
    const falcon = $('toastFalcon');
    if (falcon) falcon.classList.add('hidden');
    flownFor = null;
}

/** E3: which lights are on for a contact. `qrReal` is MOD07's answer (a scannable code is drawn). */
export function readyLights(contact = {}, qrReal = false) {
    const filled = (v) => String(v ?? '').trim() !== '';
    const name = ['firstName', 'middleName', 'lastName', 'organization'].some((f) => filled(contact[f]));
    const reach = ['phones', 'emails', 'websites'].some((f) => (contact[f] || []).some((row) => row && filled(row.value)));
    return [name, reach, !!qrReal];
}

const LIGHT_WORDS = ['a name', 'a way to reach them', 'a scannable QR code'];
/** The words for screen readers, e.g. "Lit: a name, a scannable QR code." */
export function readyLightsText(lights) {
    const on = LIGHT_WORDS.filter((_, i) => lights[i]);
    return `Lit: ${on.length ? on.join(', ') : 'none yet'}.`;
}

export function showReadyLights(contact, qrReal) {
    const lights = readyLights(contact, qrReal);
    document.querySelectorAll('#readyToShareBtn .ready-light').forEach((dot, i) => {
        const was = dot.classList.contains('is-lit');
        dot.classList.toggle('is-lit', !!lights[i]);
        if (lights[i] && !was) {
            dot.classList.remove('is-popping');
            void dot.offsetWidth;
            dot.classList.add('is-popping');
        }
    });
    const text = $('readyLightsText');
    if (text) text.textContent = readyLightsText(lights);
}
