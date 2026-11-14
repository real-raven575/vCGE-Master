/**
 * vCard Generator Engine (vCGE)
 * Copyright (c) 2026 raven575, Herd of Helpers (claude) & gemini
 *
 * Repository: https://github.com/real-raven575/vCGE-Master
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * vCGE-MOD04: two or three guesses for a line the reader was unsure of (easy + premium plan, step 3; raven575 approved
 * 2026-11-13 03:48 UTC: "if there are problems, give a do-over or two or three options"). Pure functions.
 *
 * The reader keeps, for each letter it hesitated over, the other letters it nearly read (glyphChoices.js `alts`:
 * [{ at, chars }], chars[0] being the one it chose). Each such letter gives a word swap: the word as read, and the same
 * word with the other letter. The swaps are made on the raw reading and applied later to the line as the review shows
 * it, which may have lost a label or had its spaces tidied, so a swap whose word is no longer there is dropped.
 */

export const MAX_GUESSES = 3;

const tokenAt = (text, at) => {
    const start = text.lastIndexOf(' ', at) + 1, end = text.indexOf(' ', at);
    return { start, end: end < 0 ? text.length : end };
};

/**
 * The word swaps one reading offers: [{ from, to }], each `to` being `from` with one letter the reader nearly read in
 * its place, the letters it was surest of first (the order of `chars`), then one swap with every word's first other
 * letter at once. `text` is the raw line and `alts` index into it.
 */
export function wordSwaps(text, alts) {
    const src = String(text || '');
    if (!Array.isArray(alts) || !alts.length) return [];
    const swaps = [];
    const byWord = new Map();
    for (const { at, chars } of alts) {
        if (!Array.isArray(chars) || chars.length < 2 || src[at] !== chars[0] || src[at] === ' ') continue;
        const { start, end } = tokenAt(src, at);
        const from = src.slice(start, end);
        for (const c of chars.slice(1)) {
            if (!c || c === ' ') continue;
            swaps.push({ from, to: from.slice(0, at - start) + c + from.slice(at - start + 1) });
        }
        const w = byWord.get(start) || { from, out: from.split('') };
        w.out[at - start] = chars[1];
        byWord.set(start, w);
    }
    for (const { from, out } of byWord.values()) {
        const to = out.join('');
        if (!swaps.some(s => s.from === from && s.to === to)) swaps.push({ from, to });
    }
    return swaps.filter(s => s.to !== s.from);
}

/**
 * Up to `max` guesses for `shown` (the line as the review shows it): each swap whose word is still there, applied to
 * its first appearance, in the order of `swaps`, never the line itself and never twice the same text.
 */
export function guessesFor(shown, swaps, max = MAX_GUESSES) {
    const line = String(shown || '');
    const out = [];
    for (const { from, to } of swaps || []) {
        if (out.length >= max) break;
        if (!from || !line.includes(from)) continue;
        const guess = line.replace(from, to);
        if (guess !== line && !out.includes(guess)) out.push(guess);
    }
    return out;
}
