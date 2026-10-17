/**
 * vCGE-MOD05 Fields card (redesign step 7)
 * Created by raven575, Gemini & Claude
 *
 * The card where the details land after the Read card's hand-off: the form, the "Insert Fake Contact?" list (the
 * sample contacts; MOD06 supplies them as data), and the green "Everything's correct" button that moves on to the
 * 3D Card. On arrival the whole form pops in at once (a short scale and fade, stepped at 26 fps, never one box
 * after another); under "reduce motion" it is simply there.
 *
 * The pop-in follows the deck's own signals and carries no data: a programmatic move onto this card (Proceed on the
 * Read card, a header icon, the Welcome card's sample link) arms it through the deck's `beforeChange` hook, and the
 * CARD_CHANGED signal fires it. A swipe lands on the card without a pop, since the form was in view the whole way.
 * The form is filled right after CARD_CHANGED (main.js), before the browser paints, so the pop shows the text.
 */
import { globalEventBus, Events } from '../../share/eventBus.js';

export const POP_MS = 320;                      // the pop-in, start to rest
export const POP_FPS = 26;                      // stepped, like the padlock and the shimmer (never too crisp)
export const POP_STEPS = Math.round(POP_MS / 1000 * POP_FPS);
export const FAKE_CONTACT_PROMPT = 'Insert Fake Contact?';
export const DONE_LABEL = "Everything's correct";

const $ = (id) => document.getElementById(id);
const reducedMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let armed = false;     // a move of the deck's own is heading for this card: pop on arrival

/** The list entry for a sample contact: "Elena Rostova, NeuralShift AI" (the label's emoji is not read aloud). */
export function sampleLabel(sample = {}) {
    const name = [sample.firstName, sample.lastName].filter(Boolean).join(' ');
    const label = [name, sample.organization].filter(Boolean).join(', ');
    return label || String(sample.label || 'Sample contact').trim();
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
 * @param {Function} opts.onSample         called with the chosen sample
 * @param {Function} opts.onDone           "Everything's correct": the details go on to the 3D Card
 * @param {Function} [opts.onBeforeChange] the deck's hook for its own moves (arms the pop-in)
 */
export function initFieldsCard({ samples = [], onSample = null, onDone = null, onBeforeChange = null } = {}) {
    const select = $('fakeContactSelect');
    if (select) {
        select.replaceChildren(new Option(FAKE_CONTACT_PROMPT, ''), ...samples.map((s, i) => new Option(sampleLabel(s), String(i))));
        select.addEventListener('change', () => {
            const sample = samples[Number(select.value)];
            select.value = '';                  // the list is a command, not a state: it reads the prompt again
            if (!sample || !onSample) return;
            onSample(sample);
            popIn();
        });
    }
    const done = $('fieldsDoneBtn');
    if (done) {
        done.textContent = '';
        done.append(okIcon(), Object.assign(document.createElement('span'), { textContent: DONE_LABEL }));
        done.addEventListener('click', () => { if (onDone) onDone(); });
    }
    if (onBeforeChange) onBeforeChange(({ to }) => { armed = to === 'fields'; });
    globalEventBus.subscribe(Events.CARD_CHANGED, (d) => {
        if (d && d.to === 'fields' && armed) popIn();
        armed = false;
    });
    const form = $('fieldsForm');
    if (form) form.addEventListener('animationend', () => form.classList.remove('is-popping'));
}

function okIcon() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'vcge-icon');
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', 'src/vendor/icons/app/sprite.svg#circle-check');
    svg.append(use);
    return svg;
}
