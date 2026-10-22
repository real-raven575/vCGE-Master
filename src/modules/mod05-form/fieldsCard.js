/**
 * vCGE-MOD05 Fields card (redesign step 7)
 * Created by raven575, Team vCGE (Claude) & Gemini
 *
 * The card where the details land after the Read card's hand-off: the form, the "Sample vCGE pilot contact" list (the
 * nine pilots, each with their animal; MOD06 supplies them as data), the phone style (how US and Canadian numbers are
 * written, memory only), and the green "Everything's correct" button that moves on to the 3D Card. On arrival the whole form pops in at once (a short scale and fade, stepped at 26 fps, never one box
 * after another); under "reduce motion" it is simply there.
 *
 * The pop-in follows the deck's own signals and carries no data: a programmatic move onto this card (Proceed on the
 * Read card, a header icon, the Welcome card's sample link) arms it through the deck's `beforeChange` hook, and the
 * CARD_CHANGED signal fires it. A swipe lands on the card without a pop, since the form was in view the whole way.
 * The form is filled right after CARD_CHANGED (main.js), before the browser paints, so the pop shows the text.
 *
 * Make it cute (raven575, 2026-10-21; notes/cute-ideas/mod05-pidge.md), branded edition only: each box's label carries
 * a pigeonhole tab with a small icon (F1), and the green button a FILED stamp that gives one soft press (F2).
 * Both editions: the lines of a scan that nothing claimed (Ignore in the review step) wait in the "Unknown" tray under
 * the form instead of being dropped (F4, video review #53). Tap a line, then tap the box it belongs in (or press Enter
 * in it). The tray is on-screen only: a lock, a wipe, a new photo, a sample or the scan's Undo empties it.
 */
import { globalEventBus, Events } from '../../share/eventBus.js';

export const POP_MS = 320;                      // the pop-in, start to rest
export const POP_FPS = 26;                      // stepped, like the padlock and the shimmer (never too crisp)
export const POP_STEPS = Math.round(POP_MS / 1000 * POP_FPS);
export const SAMPLE_PROMPT = 'Sample vCGE pilot contact';   // raven575, video review 2026-10-17 #61
export const PLAIN_SAMPLE_PROMPT = 'Sample contact';         // the plain edition (mod01-shell/edition.js)
export const DONE_LABEL = "Everything's correct";
export const STAMP_MS = 180;                    // the FILED stamp's press, start to rest
export const UNKNOWN_TITLE = 'Unknown: tap to file';
export const UNKNOWN_HELP = 'Lines the reader could not place. Tap one, then tap the box it belongs in.';

const $ = (id) => document.getElementById(id);
const reducedMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let armed = false;     // a move of the deck's own is heading for this card: pop on arrival
let isPlain = false;   // the plain edition (initFieldsCard's `plain`)

// The pilot's animal in front of their name: the same animal as the sample's bundled logo (src/vendor/icons/animals/),
// as the system's own emoji, since a list entry can carry text only.
export const ANIMAL_EMOJI = Object.freeze({ turtle: '🐢', raccoon: '🦝', cat: '🐈', owl: '🦉', octopus: '🐙', lizard: '🦎', zebra: '🦓', eagle: '🦅', hamster: '🐹', elephant: '🐘' });

/**
 * The list entry for a sample contact. A pilot (a sample with an animal logo): "🐙 Pidge the Octopus". Any other sample:
 * "Elena Rostova, NeuralShift AI" (the sample's own emoji label is never shown).
 */
export function sampleLabel(sample = {}) {
    const name = [sample.firstName, sample.lastName].filter(Boolean).join(' ');
    const animal = ANIMAL_EMOJI[String(sample.logo || '').split('/').pop().replace(/\.svg$/, '')];
    if (animal && name) return `${animal} ${name}`;
    const label = [name, sample.organization].filter(Boolean).join(', ');
    return label || String(sample.label || 'Sample contact').trim();
}

/** The lines of a reviewed scan that went nowhere (role Ignore), trimmed, each once, in card order (F4). */
export function unplacedLines(lines = []) {
    const out = [];
    for (const line of lines || []) {
        const text = String((line && line.text) || '').replace(/\s+/g, ' ').trim();
        if (text && (line.role || 'ignore') === 'ignore' && !out.includes(text)) out.push(text);
    }
    return out;
}

/** A tray line filed into a box: an empty box takes it, a filled one gets it added (a new line in Notes). */
export function fileText(current, text, multiline = false) {
    const now = String(current || '');
    return now.trim() ? `${now.replace(/\s+$/, '')}${multiline ? '\n' : ' '}${text}` : text;
}

/**
 * The form pops in: all boxes together, a small overshoot, 26 fps steps. `data-pops` counts the arrivals (read by
 * the tests); under reduce motion the count still grows and nothing moves.
 */
export function popIn() {
    const form = $('fieldsForm');
    if (!form) return;
    form.dataset.pops = String(Number(form.dataset.pops || 0) + 1);
    if (reducedMotion()) return;
    form.classList.remove('is-popping');
    void form.offsetWidth;                      // restart the animation when a pop is already running
    form.classList.add('is-popping');
}

/**
 * @param {Object}   opts
 * @param {Array}    opts.samples          sample contacts for the "Insert Fake Contact?" list (data only)
 * @param {string}   [opts.prompt]         the list's first line and name (the plain edition passes PLAIN_SAMPLE_PROMPT)
 * @param {Function} opts.onSample         called with the chosen sample
 * @param {Function} opts.onDone           "Everything's correct": the details go on to the 3D Card
 * @param {Function} [opts.onBeforeChange] the deck's hook for its own moves (arms the pop-in)
 * @param {Array}    [opts.phoneFormats]   [style, example] pairs for the phone style list (formMapper.js PHONE_FORMATS)
 * @param {Object}   [opts.phoneStyle]     the style in use: { format, countryCode }
 * @param {Function} [opts.onPhoneStyle]   called with the new { format, countryCode } when either control changes
 * @param {boolean}  [opts.plain]          the plain edition: no pigeonhole tabs, no stamp, no tray art
 */
export function initFieldsCard({ samples = [], prompt = SAMPLE_PROMPT, onSample = null, onDone = null, onBeforeChange = null, phoneFormats = [], phoneStyle = null, onPhoneStyle = null, plain = false } = {}) {
    isPlain = !!plain;
    const select = $('fakeContactSelect');
    if (select) {
        select.setAttribute('aria-label', prompt);
        select.replaceChildren(new Option(prompt, ''), ...samples.map((s, i) => new Option(sampleLabel(s), String(i))));
        select.addEventListener('change', () => {
            const sample = samples[Number(select.value)];
            select.value = '';                  // the list is a command, not a state: it reads the prompt again
            if (!sample || !onSample) return;
            clearUnknownLines();
            onSample(sample);
            popIn();
        });
    }
    // Phone style (video review #71): the format list and the +1 switch restyle every number on the card at once.
    const format = $('phoneFormatSelect'), code = $('phoneCountryCode');
    if (format && code) {
        format.replaceChildren(...phoneFormats.map(([value, example]) => new Option(example, value)));
        if (phoneStyle) { format.value = phoneStyle.format; code.checked = !!phoneStyle.countryCode; }
        const changed = () => { if (onPhoneStyle) onPhoneStyle({ format: format.value, countryCode: code.checked }); };
        format.addEventListener('change', changed);
        code.addEventListener('change', changed);
    }
    const done = $('fieldsDoneBtn');
    if (done) {
        done.textContent = '';
        done.append(okIcon(), Object.assign(document.createElement('span'), { textContent: DONE_LABEL }));
        if (!isPlain) {
            const stamp = Object.assign(document.createElement('span'), { className: 'fields-stamp', textContent: 'FILED' });
            stamp.setAttribute('aria-hidden', 'true');
            done.append(stamp);
            done.addEventListener('pointerdown', () => stampPress(done));
            done.addEventListener('animationend', () => done.classList.remove('is-stamping'));
        }
        done.addEventListener('click', () => { if (onDone) onDone(); });
    }
    if (onBeforeChange) onBeforeChange(({ to }) => { armed = to === 'fields'; });
    globalEventBus.subscribe(Events.CARD_CHANGED, (d) => {
        if (d && d.to === 'fields' && armed) popIn();
        armed = false;
    });
    const form = $('fieldsForm');
    if (form) {
        form.addEventListener('animationend', (e) => { if (e.target === form) form.classList.remove('is-popping'); });
        if (!isPlain) addSlotTabs(form);
        initUnknownTray(form);
    }
    // The tray holds contact text: it goes with everything else on a lock, a wipe or a new photo.
    [Events.VAULT_QUICK_LOCKED, Events.VAULT_WIPED, Events.MEMORY_PURGED, Events.IMAGE_CAPTURED].forEach(ev => globalEventBus.subscribe(ev, clearUnknownLines));
}


// ---- F2: the FILED stamp gives one soft press (not under reduce motion) ------------------------------------------
function stampPress(button) {
    if (reducedMotion()) return;
    button.classList.remove('is-stamping');
    void button.offsetWidth;
    button.classList.add('is-stamping');
}

// ---- F1: a pigeonhole tab on each box's label, with the icon of Pidge's vest pocket -----------------------------
// Hand-drawn 24 x 24 line icons (currentColor). Decorative: the label's own words stay what a screen reader reads.
const SLOT_ICONS = Object.freeze({
    name: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
    title: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
    co: '<path d="M4 21V5l8-2v18M12 9h8v12M7 8h2M7 12h2M7 16h2M15 13h2M15 17h2"/>',
    tel: '<path d="M5 4h4l2 5-3 2a11 11 0 0 0 5 5l2-3 5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
    web: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18"/>',
    addr: '<path d="M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/>',
    note: '<path d="M6 3h9l4 4v14H6zM9 11h7M9 15h7"/>',
    // The tray's empty pigeonhole, labelled "Unknown" on Pidge's wall
    hole: '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 12h18M9 4v16M15 4v16"/><path d="M17 15.5a1.5 1.5 0 1 1 1.5 1.5v.8"/>'
});
// Which box gets which tab: a box's own label, or the heading of its group (phones, emails, websites, address)
export const SLOT_OF = Object.freeze({
    namePrefix: 'name', firstName: 'name', middleName: 'name', lastName: 'name', nameSuffix: 'name', nickname: 'name',
    jobTitle: 'title', organization: 'co', notes: 'note', categories: 'note',
    phoneList: 'tel', emailList: 'mail', websiteList: 'web', street: 'addr'
});
const GROUPED = new Set(['phoneList', 'emailList', 'websiteList', 'street']);

function slotIcon(slot) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = SLOT_ICONS[slot];
    return svg;
}

function addSlotTabs(form) {
    for (const [id, slot] of Object.entries(SLOT_OF)) {
        const el = $(id);
        if (!el || !form.contains(el)) continue;
        const label = GROUPED.has(id) ? el.closest('fieldset') && el.closest('fieldset').querySelector(':scope > legend')
            : el.closest('label') && el.closest('label').querySelector('.field-label');
        if (!label || label.querySelector('.fields-slot')) continue;
        const tab = Object.assign(document.createElement('span'), { className: 'fields-slot' });
        tab.dataset.slot = slot;
        tab.setAttribute('aria-hidden', 'true');
        tab.append(slotIcon(slot));
        label.prepend(tab);
    }
}

// ---- F4: the "Unknown" tray -----------------------------------------------------------------------------------
const FILEABLE = 'input:not([type="hidden"]):not([type="checkbox"]):not([type="date"]), textarea';
let waiting = null;   // the tray line waiting for a box: its button

function boxName(box) {
    const own = box.closest('label') && box.closest('label').querySelector('.field-label');
    const group = box.closest('fieldset') && box.closest('fieldset').querySelector(':scope > legend');
    return ((own || group || {}).textContent || 'the box').trim();
}

function setHelp(text) { const help = $('fieldsUnknownHelp'); if (help) help.textContent = text; }

function arm(button) {
    if (waiting) waiting.setAttribute('aria-pressed', 'false');
    waiting = waiting === button ? null : button;
    if (waiting) waiting.setAttribute('aria-pressed', 'true');
    setHelp(waiting ? `Now tap the box for "${waiting.dataset.line}", or tap the line again to cancel.` : UNKNOWN_HELP);
}

function fileInto(box) {
    const text = waiting.dataset.line;
    box.value = fileText(box.value, text, box.tagName === 'TEXTAREA');
    box.dispatchEvent(new Event('input', { bubbles: true }));
    waiting.closest('li').remove();
    waiting = null;
    const left = $('fieldsUnknownList') ? $('fieldsUnknownList').children.length : 0;
    if (!left) $('fieldsUnknown').classList.add('hidden');
    setHelp(`Filed in ${boxName(box)}.`);
}

function initUnknownTray(form) {
    const tray = $('fieldsUnknown');
    if (!tray) return;
    if (!isPlain) $('fieldsUnknownTitle').prepend(Object.assign(document.createElement('span'), { className: 'fields-slot fields-hole' }), ' ');
    const hole = tray.querySelector('.fields-hole');
    if (hole) { hole.setAttribute('aria-hidden', 'true'); hole.append(slotIcon('hole')); }
    form.addEventListener('click', (e) => {
        const box = waiting && e.target.closest && e.target.closest(FILEABLE);
        if (box && !tray.contains(box)) fileInto(box);
    });
    form.addEventListener('keydown', (e) => {
        if (!waiting) return;
        if (e.key === 'Escape') { arm(waiting); return; }
        if (e.key === 'Enter' && e.target.matches && e.target.matches('input') && e.target.matches(FILEABLE) && !tray.contains(e.target)) { e.preventDefault(); fileInto(e.target); }
    });
}

/** Shows the scan's unplaced lines in the tray (an empty list hides it). */
export function showUnknownLines(lines = []) {
    const tray = $('fieldsUnknown'), list = $('fieldsUnknownList');
    if (!tray || !list) return;
    waiting = null;
    list.replaceChildren(...lines.map(text => {
        const li = document.createElement('li');
        li.className = 'fields-unknown-item';
        const line = Object.assign(document.createElement('button'), { type: 'button', className: 'fields-unknown-line', textContent: text });
        line.dataset.line = text;
        line.setAttribute('aria-pressed', 'false');
        line.addEventListener('click', () => arm(line));
        const leave = Object.assign(document.createElement('button'), { type: 'button', className: 'fields-unknown-leave', textContent: 'Leave out' });
        leave.setAttribute('aria-label', `Leave out: ${text}`);
        leave.addEventListener('click', () => {
            if (waiting === line) waiting = null;
            li.remove();
            if (!list.children.length) tray.classList.add('hidden');
            setHelp(UNKNOWN_HELP);
        });
        li.append(line, leave);
        return li;
    }));
    setHelp(UNKNOWN_HELP);
    tray.classList.toggle('hidden', !lines.length);
}

/** Empties the tray (contact text, so it never outlives the card). */
export function clearUnknownLines() { showUnknownLines([]); }

function okIcon() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'vcge-icon');
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', 'src/vendor/icons/app/sprite.svg#circle-check');
    svg.append(use);
    return svg;
}
