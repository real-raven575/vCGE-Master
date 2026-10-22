/**
 * vCard Generator Engine (vCGE)
 * Copyright (c) 2026 raven575, Team vCGE (Claude) & Gemini
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
 * - Every line the reader was unsure of carries a "please check" note and a small "Looks right" box inside its text
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
    status(status) {
        $('ocrProgressLabel').textContent = status === 'starting' ? 'Preparing the reader…' : 'Extracting…';
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

// ---- The review lines: text, role picker, icon chip, and the "please check" note with its Looks right box ------------

/**
 * Builds one row per line: [{ text, role, icon, check }]. `roles` are the [value, label] pairs of the role picker,
 * `iconNames` the label for each icon the reader can recognise. `onEdit()` and `onRole()` are called after a line's
 * text or role changed (the line object is updated first). Built with DOM nodes, never HTML strings (OCR text is
 * untrusted). Returns the row elements in order.
 */
export function renderReviewRows(lines, { roles, iconNames, onEdit = () => {}, onRole = () => {} }) {
    return lines.map((line, i) => {
        const row = document.createElement('div');
        row.className = 'flex gap-2 items-center';
        const field = document.createElement('div');
        field.className = 'read-field flex-1 min-w-0';
        const text = document.createElement('input');
        text.type = 'text';
        text.id = `ocrLineText${i}`;
        text.className = 'field-input min-w-0';
        text.value = line.text;
        text.setAttribute('aria-label', `Line ${i + 1} text`);
        field.append(text);
        const role = document.createElement('select');
        role.id = `ocrLineRole${i}`;
        role.className = 'field-input w-44 shrink-0';
        role.setAttribute('aria-label', `Line ${i + 1} is`);
        roles.forEach(([value, label]) => role.add(new Option(label, value, false, value === line.role)));
        role.addEventListener('change', () => { line.role = role.value; onRole(line, i); });
        if (line.icon && iconNames[line.icon]) {
            const chip = document.createElement('span');
            chip.id = `ocrLineIcon${i}`;
            chip.className = 'shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400';
            chip.textContent = iconNames[line.icon];
            chip.title = 'Icon seen in front of this line';
            row.append(chip);
        }
        row.append(field, role);
        if (!line.check) {
            text.addEventListener('input', () => { line.text = text.value; onEdit(line, i); });
            return row;
        }

        // MOD05 asks for a check: a ZIP the state doesn't use, or letters the reader was unsure of.
        const note = document.createElement('p');
        note.id = `ocrLineCheck${i}`;
        note.className = 'read-note text-xs text-amber-600 dark:text-amber-400 pl-1';
        note.textContent = line.check;
        text.classList.add('border-amber-500', 'dark:border-amber-400', 'read-flagged');
        text.setAttribute('aria-describedby', note.id);
        const ok = document.createElement('input');
        ok.type = 'checkbox';
        ok.id = `ocrLineOk${i}`;
        ok.className = 'read-ok';
        ok.title = 'Looks right';
        ok.setAttribute('aria-label', `Line ${i + 1} looks right`);
        field.append(ok);
        const wrap = document.createElement('div');
        wrap.className = 'space-y-0.5';
        wrap.append(row, note);

        let cleared = false;
        const clearCaution = () => {
            if (cleared) return;
            cleared = true;
            delete line.check;
            text.classList.remove('border-amber-500', 'dark:border-amber-400', 'read-flagged');
            text.removeAttribute('aria-describedby');
            note.remove();
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
                await Promise.all([fade(note, 1, 0, CHECK_FADE_MS * (1 - CHECK_NOTE_AT)), boxFade]);
            }
            clearCaution();
            onEdit(line, i);
        });
        return wrap;
    });
}

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
