/**
 * vCard Generator Engine (vCGE)
 * Copyright (c) 2026 raven575, Team vCGE (Claude) & Gemini
 *
 * Repository: https://github.com/real-raven575/vCGE-Master
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * vCGE-MOD04: is a line real text or garbage, what a reading still lacks, and up to three readings of one card put
 * together (pure functions, unit-tested in Node). raven575, 2026-10-20: a light green name shot at an angle passed the
 * whole-photo check (the other lines were sharp) and reached the form as garbage. Each line is now judged on its own;
 * when the name or a way to reach the person is missing, the app asks for one more photo (three at most), and the
 * readings are put together line by line. Only text lines are kept between photos, never the photos.
 */

import { mergeReadingAlts } from './ocrWorker.js';

export const MAX_PHOTOS = 3;

// A line is garbage when the engine was this unsure of it overall, whatever it looks like...
export const GARBAGE_CONFIDENCE = 30;
// ...or when it was unsure (below this) and a third or more of its words don't look like words...
export const GARBAGE_UNSURE_CONFIDENCE = 50;
// ...or when more than half of its words don't look like words, or under 60% of its characters are letters or digits.
export const GARBAGE_WORD_SHARE = 0.5;
export const GARBAGE_ALNUM_SHARE = 0.6;
// Two readings of a line are the same line when their letters and digits are at least this alike.
export const SAME_LINE = 0.6;
// A merged line whose readings disagree is passed on as unsure unless the kept reading was at least this sure.
export const AGREE_CONFIDENCE = 60;

const REACH_ROLES = new Set(['phone', 'phoneWork', 'phoneMobile', 'phoneHome', 'email']);

const EMAIL = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;
const WEB = /[a-z0-9-]{2,}\.(com|net|org|io|co|us|biz|info|app|edu|gov|me)\b/i;

/** Shaped like an email, a web address or a phone number: OCR slips inside such a line are the review's to fix. */
export function isFieldShaped(text) {
    const t = String(text || '');
    const digits = (t.match(/\d/g) || []).length;
    const chars = t.replace(/\s/g, '').length;
    return EMAIL.test(t) || WEB.test(t) || (digits >= 7 && digits <= 15 && digits >= 0.5 * chars);
}

// A word of 4+ letters doesn't look like a word: no vowel, 5 consonants in a row, or a capital after a small letter 3+
// times ("TeamLogicIT" has 2 and is a word; "lIlIlI" has 3). Shorter words (Mr, St, LLC, IT) always pass.
function oddWord(word) {
    const letters = word.replace(/[^A-Za-z]/g, '');
    if (letters.length < 4) return false;
    if (!/[aeiouyAEIOUY]/.test(letters)) return true;
    if (/[^aeiouyAEIOUY]{5,}/.test(letters)) return true;
    return (letters.match(/[a-z](?=[A-Z])/g) || []).length >= 3;
}

/**
 * Is `line` ({ text, confidence? }, confidence 0-100 for the line's words) garbage rather than text? Lines shaped like an
 * email, web address or phone number never are. With no confidence (an engine without word data) only the shape counts.
 */
export function isGarbage({ text, confidence }) {
    const t = String(text || '').trim();
    if (!t) return true;
    if (isFieldShaped(t)) return false;
    const chars = t.replace(/\s/g, '');
    const alnum = (chars.match(/[A-Za-z0-9]/g) || []).length;
    if (alnum < GARBAGE_ALNUM_SHARE * chars.length) return true;
    const words = t.split(/\s+/).filter(w => /[A-Za-z]/.test(w));
    const odd = words.length ? words.filter(oddWord).length / words.length : 0;
    if (odd > GARBAGE_WORD_SHARE) return true;
    if (typeof confidence !== 'number') return false;
    return confidence < GARBAGE_CONFIDENCE || (confidence < GARBAGE_UNSURE_CONFIDENCE && odd >= 1 / 3);
}

/**
 * What a reviewed reading ([{ text, role }], MOD05's classifyLines) still lacks: 'name' when no line is the name, 'reach'
 * when no line is a phone (other than a fax) or an email. Empty when the card has what it needs.
 */
export function missingParts(lines) {
    const has = (test) => (lines || []).some(l => l.text && l.text.trim() && test(l.role));
    return [...(has(r => r === 'name') ? [] : ['name']), ...(has(r => REACH_ROLES.has(r)) ? [] : ['reach'])];
}

/** "the name", "a phone number or email", or both: for "We got most of this card, but not ..." */
export function describeMissing(missing) {
    const words = { name: 'the name', reach: 'a phone number or email' };
    return missing.map(m => words[m]).join(' or ');
}

const key = (text) => String(text || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function alike(a, b) {
    const x = key(a), y = key(b);
    if (!x || !y) return 0;
    const d = Array.from({ length: x.length + 1 }, (_, i) => [i, ...Array(y.length).fill(0)]);
    for (let j = 1; j <= y.length; j++) d[0][j] = j;
    for (let i = 1; i <= x.length; i++) {
        for (let j = 1; j <= y.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    return 1 - d[x.length][y.length] / Math.max(x.length, y.length);
}

/**
 * Up to three readings of one card ([[{ text, icon, alts, unsure, confidence }]], oldest first) put together: lines that
 * are the same line in several readings (SAME_LINE alike) become one, in card order. For each, a reading that two photos
 * agree on wins, otherwise the surest; garbage never beats text. Where the readings disagree and the kept one isn't sure
 * (AGREE_CONFIDENCE), the line is passed on as unsure and the other reading's letters join its second guesses. Lines
 * that are garbage in every reading are kept only when the latest photo has them, marked `unreadable`.
 */
export function mergeReadings(readings) {
    const list = (readings || []).filter(Array.isArray);
    const groups = [];
    list.forEach((reading, r) => {
        let after = -1;
        reading.forEach((line) => {
            const member = { ...line, reading: r, garbage: isGarbage(line) };
            let best = -1, score = 0;
            groups.forEach((g, i) => {
                if (g.some(m => m.reading === r)) return;
                const s = Math.max(...g.map(m => alike(m.text, line.text)));
                if (s >= SAME_LINE && s > score) { best = i; score = s; }
            });
            if (best >= 0) { groups[best].push(member); after = best; }
            else { groups.splice(after + 1, 0, [member]); after += 1; }
        });
    });
    const latest = list.length - 1;
    return groups.flatMap((group) => {
        const good = group.filter(m => !m.garbage);
        if (!good.length) return group.some(m => m.reading === latest) ? [{ ...strip(group[group.length - 1]), unreadable: true }] : [];
        const votes = new Map();
        good.forEach(m => votes.set(key(m.text), (votes.get(key(m.text)) || 0) + 1));
        const top = Math.max(...votes.values());
        const sure = (m) => (typeof m.confidence === 'number' ? m.confidence : 0);
        const chosen = good.filter(m => votes.get(key(m.text)) === top).sort((a, b) => sure(b) - sure(a))[0];
        const others = good.filter(m => key(m.text) !== key(chosen.text));
        const out = strip(chosen);
        if (!others.length || (top > 1 && top > good.length / 2)) return [out];
        if (sure(chosen) >= AGREE_CONFIDENCE) return [out];
        out.alts = others.reduce((alts, m) => mergeReadingAlts(m.text, m.alts, out.text, alts), out.alts || []);
        out.unsure = out.text.split(' ').filter(w => w.length > 1);
        return [out];
    });
}

function strip({ reading, garbage, ...line }) {
    return line;
}
