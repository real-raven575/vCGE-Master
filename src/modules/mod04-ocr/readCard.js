/**
 * vCard Generator Engine (vCGE)
 * Copyright (c) 2026 raven575, Herd of Helpers (claude) & gemini
 *
 * Repository: https://github.com/real-raven575/vCGE-Master
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * vCGE-MOD04: the Read card's face (redesign step 6). Glyph's share of the screen, moved here out of main.js.
 *
 * - While the photo is read it fills the card and a soft shimmer sweeps across it like light on water (read.css,
 *   stepped at STEP_FPS). A pale wash creeps over it on the read curve (ocrWorker.js readProgress) and is full when the
 *   read limit runs out, so the eye sees that time is passing without ever seeing a number. Cancel stops the reader.
 * - Each line is one rounded box with a type chip you tap to change (0.8, Creative's mock-up); the photo stays in view
 *   as a thumbnail above them.
 * - Every line the reader was unsure of carries a flag that says what to check and a small "Looks right" box inside its text
 *   field. Ticking it turns the box green, then it fades out; a few frames before it is gone the note fades away and
 *   the field returns to normal. Editing the line clears the note at once, as before.
 * - On Proceed the text "blinks out" (a quick fade, no slide) before the deck leaves for Fields. The deck's
 *   beforeChange hook delays the move until the fade is done; the Vault padlock and the Fields pop-in follow from
 *   the deck's CARD_CHANGED signal, not from here.
 * Under "reduce motion" every animation is instant. Nothing here touches the bus with data: the module listens for
 * VAULT_WIPED and MEMORY_PURGED only to drop the photo it shows. The review lines (text and roles) belong to the
 * controller; this file only draws them.
 */
import { globalEventBus, Events } from '../../share/eventBus.js';
import { readProgress } from './ocrWorker.js';

export const STEP_FPS = 26;             // motion stepped at 24 to 30 frames a second (shared rule)
export const BLINK_MS = 220;            // the text fades out this fast before the deck moves to Fields
export const CHECK_HOLD_MS = 180;       // a ticked "Looks right" box stays green this long before it fades
export const CHECK_FADE_MS = 260;       // then fades out over this long; the note goes a few frames before the end
export const CHECK_NOTE_AT = 0.6;       // ...at this point of the box's fade

/** What a person who cannot load the reader's files is told (the app's own files could not be reached, not a bad photo). */
export const READER_UNAVAILABLE_MESSAGE = "The reader's files couldn't be reached, so nothing was read and your form was not changed. Check that the app still loads, then press OK again or type the details in.";

/** What a person is told when the reader's files loaded but it stopped while starting, twice (raven575, 2026-10-22). */
export const READER_STOPPED_MESSAGE = 'The reader stopped while starting. Press OK to try again.';

const $ = (id) => document.getElementById(id);
const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms) => new Promise(res => setTimeout(res, ms));

/** Quadratic ease in and out, clamped to [0, 1]. */
export function easeInOut(p) {
    p = Math.min(1, Math.max(0, p));
    return p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
}

/** Opacity of a fade from `from` to `to`, `elapsedMs` into `ms`, snapped to the STEP_FPS frame grid. */
export function fadeAt(from, to, elapsedMs, ms, fps = STEP_FPS) {
    if (!(ms > 0)) return to;
    const frames = Math.max(1, Math.round((ms / 1000) * fps));
    const p = Math.min(1, Math.floor(Math.min(1, elapsedMs / ms) * frames) / frames);
    return from + (to - from) * easeInOut(p);
}

/**
 * Fades `el` from one opacity to another over `ms` at STEP_FPS; resolves when it has landed. Instant (and resolved at
 * once) under reduce motion or when `instant` is set.
 */
export function fade(el, from, to, ms, { instant = reducedMotion(), now = () => Date.now() } = {}) {
    return new Promise(resolve => {
        if (instant || !(ms > 0)) { el.style.opacity = String(to); resolve(); return; }
        const t0 = now();
        el.style.opacity = String(from);
        const step = () => {
            const elapsed = now() - t0;
            el.style.opacity = String(fadeAt(from, to, elapsed, ms));
            if (elapsed >= ms) { el.style.opacity = String(to); resolve(); return; }
            setTimeout(step, 1000 / STEP_FPS);
        };
        setTimeout(step, 1000 / STEP_FPS);
    });
}

// ---- Reading: the photo under a shimmer, a pale wash on the read curve, Cancel --------------------------------------

/**
 * The reading indicator. `show(photo)` puts the cropped photo (a data URL) under the shimmer; `status('starting')`
 * says the reader is loading (the wash waits at the start), `status('reading')` starts the wash on the read curve;
 * `set(fraction)` places the wash by hand (full when the read ends); `hide()` stops everything and drops the photo.
 */
/** "Preparing the reader… 45%": the start-up label with how far it is, so a slow first load is seen moving. */
export function startLabel(fraction) {
    return typeof fraction === 'number' && fraction > 0 ? `Preparing the reader… ${Math.round(Math.min(1, fraction) * 100)}%` : 'Preparing the reader…';
}

export const readIndicator = {
    timer: null,
    set(fraction) {
        const pct = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
        $('ocrProgressFill').style.width = `${pct}%`;
        $('ocrProgressBar').setAttribute('aria-valuenow', String(pct));
        $('ocrProgress').style.setProperty('--read-progress', String(pct / 100));   // the owl's eyes follow the wash
    },
    /** The read finished well: the owl closes its eyes happily (read.css; nothing changes under reduce motion). */
    finish() { $('ocrProgress').classList.add('is-done'); },
    show(photo) {
        this.stop(); this.set(0);
        $('ocrProgress').classList.remove('is-done');
        const img = $('ocrReadPhoto');
        if (photo) img.setAttribute('src', photo); else img.removeAttribute('src');
        $('ocrProgressLabel').textContent = 'Extracting…';
        $('ocrProgressBar').classList.toggle('is-still', reducedMotion());
        $('ocrProgressBar').classList.add('is-reading');
        $('ocrProgress').classList.remove('hidden');
    },
    status(status, fraction = null) {
        $('ocrProgressLabel').textContent = status === 'starting' ? startLabel(fraction) : 'Extracting…';
        if (status !== 'reading' || this.timer) return;
        const started = Date.now();
        this.timer = setInterval(() => this.set(readProgress(Date.now() - started)), 100);
    },
    stop() { clearInterval(this.timer); this.timer = null; },
    hide() {
        this.stop();
        const box = $('ocrProgress');
        if (!box) return;
        box.classList.add('hidden');
        $('ocrProgressBar').classList.remove('is-reading');
        $('ocrReadPhoto').removeAttribute('src');     // the photo is contact data: nothing of it stays behind
    }
};
// A wipe or an idle purge while reading: the photo under the shimmer goes with everything else.
globalEventBus.subscribe(Events.VAULT_WIPED, () => readIndicator.hide());
globalEventBus.subscribe(Events.MEMORY_PURGED, () => readIndicator.hide());

// ---- The review lines: one rounded box per line with its type chip, and the flag that says what to check -----------

const SVG_NS = 'http://www.w3.org/2000/svg';
/** A small line icon (24 x 24, currentColor) built from path data, never from an HTML string. */
function lineIcon(className, paths, circle = null) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', className);
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    if (circle) {
        const c = document.createElementNS(SVG_NS, 'circle');
        c.setAttribute('cx', '12'); c.setAttribute('cy', '12'); c.setAttribute('r', String(circle));
        svg.append(c);
    }
    paths.forEach(d => { const path = document.createElementNS(SVG_NS, 'path'); path.setAttribute('d', d); svg.append(path); });
    return svg;
}

/** The words on a line's type chip: the role's own label, without the picker's explanation in brackets. */
export function chipLabel(label) {
    return String(label || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
}

/** The flag's lead: it says in words what to check, before MOD05's own note (0.8 redo R3, Creative's mock-up). */
export const CHECK_LEAD = 'Check this line.';

/**
 * Builds one row per line: [{ text, role, icon, check }]. `roles` are the [value, label] pairs of the role picker,
 * `iconNames` the label for each icon the reader can recognise. `onEdit()` and `onRole()` are called after a line's
 * text or role changed (the line object is updated first). Built with DOM nodes, never HTML strings (OCR text is
 * untrusted). Returns the row elements in order.
 *
 * 0.8 (Creative's mock-up): each line is one rounded box you can edit, with a type chip beside it. The chip is the
 * role picker itself (a native list laid over the chip), so a tap opens the system's own list and the roles stay
 * MOD05's LINE_ROLES. A flagged line says in words what to check, under its box.
 */
export function renderReviewRows(lines, { roles, iconNames, onEdit = () => {}, onRole = () => {} }) {
    return lines.map((line, i) => {
        const item = document.createElement('div');
        item.className = 'read-line';
        const row = document.createElement('div');
        row.className = 'read-line-row';
        const field = document.createElement('div');
        field.className = 'read-field';
        const text = document.createElement('input');
        text.type = 'text';
        text.id = `ocrLineText${i}`;
        text.className = 'read-input';
        text.value = line.text;
        text.autocomplete = 'off';
        text.setAttribute('aria-label', `Line ${i + 1} text`);
        field.append(text);

        // The type chip: what the line is, and a tap to change it
        const chip = document.createElement('label');
        chip.className = 'read-type';
        const chipText = document.createElement('span');
        chipText.className = 'read-type-label';
        chipText.setAttribute('aria-hidden', 'true');
        const role = document.createElement('select');
        role.id = `ocrLineRole${i}`;
        role.className = 'read-type-select';
        role.setAttribute('aria-label', `Line ${i + 1} is`);
        roles.forEach(([value, label]) => role.add(new Option(label, value, false, value === line.role)));
        const showRole = () => {
            const picked = roles.find(([value]) => value === role.value);
            chipText.textContent = chipLabel(picked ? picked[1] : role.value);
            chip.classList.toggle('is-ignored', role.value === 'ignore');
        };
        showRole();
        role.addEventListener('change', () => { line.role = role.value; showRole(); onRole(line, i); });
        chip.append(chipText, lineIcon('read-type-chev', ['M7 10l5 5 5-5']), role);
        row.append(field, chip);
        item.append(row);

        if (line.icon && iconNames[line.icon]) {
            const seen = document.createElement('span');
            seen.id = `ocrLineIcon${i}`;
            seen.className = 'read-line-icon';
            seen.textContent = iconNames[line.icon];
            seen.title = 'Icon seen in front of this line';
            item.append(seen);
        }
        if (!line.check) {
            text.addEventListener('input', () => { line.text = text.value; onEdit(line, i); });
            return item;
        }

        // MOD05 asks for a check: a ZIP the state doesn't use, or letters the reader was unsure of. The flag says so
        // in words (a lead and MOD05's note), with an icon, never by colour alone.
        item.classList.add('is-flagged');
        const flag = document.createElement('div');
        flag.className = 'read-flag';
        const words = document.createElement('p');
        const lead = document.createElement('b');
        lead.textContent = CHECK_LEAD;
        const note = document.createElement('span');
        note.id = `ocrLineCheck${i}`;
        note.className = 'read-note';
        note.textContent = line.check;
        words.append(lead, ' ', note);
        flag.append(lineIcon('read-flag-icon', ['M12 7v6', 'M12 16.5v.5'], 9), words);
        item.append(flag);
        text.classList.add('border-amber-500', 'dark:border-amber-400', 'read-flagged');
        text.setAttribute('aria-describedby', note.id);
        const ok = document.createElement('input');
        ok.type = 'checkbox';
        ok.id = `ocrLineOk${i}`;
        ok.className = 'read-ok';
        ok.title = 'Looks right';
        ok.setAttribute('aria-label', `Line ${i + 1} looks right`);
        field.append(ok);

        let cleared = false;
        const clearCaution = () => {
            if (cleared) return;
            cleared = true;
            delete line.check;
            item.classList.remove('is-flagged');
            text.classList.remove('border-amber-500', 'dark:border-amber-400', 'read-flagged');
            text.removeAttribute('aria-describedby');
            flag.remove();
            ok.remove();
        };
        // Edited means checked: the note goes away at once.
        text.addEventListener('input', () => { line.text = text.value; clearCaution(); onEdit(line, i); });
        // Ticked means "this is right": green, a short hold, then the box fades; the note goes a few frames before it.
        ok.addEventListener('change', async () => {
            if (!ok.checked || cleared) return;
            ok.disabled = true;
            ok.classList.add('is-ok');
            const instant = reducedMotion();
            if (!instant) {
                await wait(CHECK_HOLD_MS);
                if (cleared) return;
                const boxFade = fade(ok, 1, 0, CHECK_FADE_MS);
                await wait(CHECK_FADE_MS * CHECK_NOTE_AT);
                if (cleared) return;
                text.classList.remove('border-amber-500', 'dark:border-amber-400', 'read-flagged');
                const rest = CHECK_FADE_MS * (1 - CHECK_NOTE_AT);
                await Promise.all([fade(note, 1, 0, rest), fade(flag, 1, 0, rest), boxFade]);
            }
            clearCaution();
            onEdit(line, i);
        });
        return item;
    });
}

// ---- The photo thumbnail: stays in view above the lines while they are checked -------------------------------------

/**
 * `show(photo)` puts the photo being checked (a data URL) in the thumbnail beside the hint; `hide()` drops it. The
 * photo is contact data: it is never kept anywhere else, and a wipe or an idle purge drops it too.
 */
export const readThumb = {
    show(photo) {
        const img = $('ocrThumb');
        if (!img) return;
        if (photo) img.setAttribute('src', photo); else img.removeAttribute('src');
        img.classList.toggle('hidden', !photo);
    },
    hide() { this.show(null); }
};
globalEventBus.subscribe(Events.VAULT_WIPED, () => readThumb.hide());
globalEventBus.subscribe(Events.MEMORY_PURGED, () => readThumb.hide());

// ---- Hand-off: the text blinks out before the deck leaves for Fields ------------------------------------------------

/**
 * Hooks the blink-out into the deck: `onBeforeChange` is the deck's own registration call, handed over by the
 * controller so this module imports nothing of MOD01. Returns the deck's unsubscribe.
 */
export function initReadCard({ onBeforeChange }) {
    return onBeforeChange(async ({ from, to }) => {
        if (from !== 'read' || to !== 'fields') return;
        const step = $('ocrStepText');
        if (!step || step.classList.contains('hidden')) return;
        await fade(step, 1, 0, BLINK_MS);
    });
}

/** The text step is shown again (a new read, Back, Reopen last scan): undo the blink-out. */
export function resetBlink() {
    const step = $('ocrStepText');
    if (step) step.style.opacity = '';
}
