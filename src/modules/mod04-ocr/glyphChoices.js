/**
 * vCard Generator Engine (vCGE)
 * Copyright (c) 2026 raven575, Team vCGE (Claude) & Gemini
 *
 * Repository: https://github.com/real-raven575/vCGE-Master
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * vCGE-MOD04: the engine's close second guesses for each letter, and letters it read twice (pure functions, unit-tested
 * in Node). Many card fonts draw a capital I and a lowercase l or i as the same plain bar, so the photo alone cannot say
 * which it is; the engine's runner-up letters are passed on with each line and the field mapper (MOD05) decides from the
 * card's context. Needs Tesseract's `lstm_choice_mode` 2, which fills `symbol.choices`.
 */

// A runner-up letter is passed on when the engine scored it at least ALT_MIN and within ALT_MARGIN points of its pick.
export const ALT_MARGIN = 20;
export const ALT_MIN = 50;

/**
 * Is `a` the same ink as its neighbour `b` read a second time? Its box lies (80% or more of its width) inside b's,
 * the engine was no surer of it than of b, and one of its own guesses was b's letter: the "r" inside the "m" of
 * "Kalamazoo" read as "Kalarmazoo".
 */
export function isEcho(a, b) {
    if (!a.bbox || !b.bbox) return false;
    const width = a.bbox.x1 - a.bbox.x0;
    const inside = Math.min(a.bbox.x1, b.bbox.x1) - Math.max(a.bbox.x0, b.bbox.x0);
    return width > 0 && inside >= 0.8 * width && a.confidence <= b.confidence && (a.choices || []).some(c => c.text === b.text);
}

/** [pick, ...close runner-ups] for one letter, or null when the engine had no close second guess. */
export function closeChoices(symbol) {
    const choices = (symbol.choices || []).filter(c => c.text && c.text.length === 1);
    if (choices.length < 2) return null;
    const best = Math.max(...choices.map(c => c.confidence));
    const close = choices.filter(c => c.text !== symbol.text && c.confidence >= ALT_MIN && best - c.confidence <= ALT_MARGIN).map(c => c.text);
    return close.length ? [symbol.text, ...new Set(close)] : null;
}

/**
 * One Tesseract word ({ text, symbols }) with letters read twice dropped and its close second guesses:
 * { ...word, text, alts: [{ at, chars }] } where `at` indexes `text`. A word whose letters do not spell its text is
 * left as it is.
 */
export function refineWord(word) {
    const symbols = word.symbols || [];
    if (!symbols.length || symbols.map(s => s.text).join('') !== word.text) return { ...word, alts: [] };
    const kept = [];
    for (const s of symbols) {
        const prev = kept[kept.length - 1];
        if (prev && isEcho(prev, s)) kept[kept.length - 1] = s;
        else if (!(prev && isEcho(s, prev))) kept.push(s);
    }
    const alts = kept.map((s, at) => ({ at, chars: closeChoices(s) })).filter(a => a.chars);
    return { ...word, text: kept.map(s => s.text).join(''), alts };
}

/** Tesseract lines with every word refined; a line keeps its own text unless a letter read twice was dropped. */
export function refineLines(lines) {
    return lines.map(line => {
        const words = (line.words || []).map(refineWord);
        const changed = words.some((w, i) => w.text !== line.words[i].text);
        return { ...line, words, text: changed ? words.map(w => w.text).join(' ') : line.text };
    });
}

/**
 * Second guesses of `words` as positions in `text` (the line as finally returned, which may have lost icon debris
 * or gained a label letter): each word is matched to the next space-separated token equal to it.
 */
export function altsForText(text, words) {
    const tokens = [];
    let offset = 0;
    for (const token of String(text || '').split(' ')) { tokens.push({ token, offset }); offset += token.length + 1; }
    const out = [];
    let next = 0;
    for (const word of words || []) {
        const i = tokens.findIndex((t, k) => k >= next && t.token === word.text);
        if (i < 0) continue;
        next = i + 1;
        (word.alts || []).forEach(({ at, chars }) => out.push({ at: tokens[i].offset + at, chars }));
    }
    return out;
}
