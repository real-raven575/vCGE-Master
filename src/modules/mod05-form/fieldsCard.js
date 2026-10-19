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
 */
import { globalEventBus, Events } from '../../share/eventBus.js';

export const POP_MS = 320;                      // the pop-in, start to rest
export const POP_FPS = 26;                      // stepped, like the padlock and the shimmer (never too crisp)
export const POP_STEPS = Math.round(POP_MS / 1000 * POP_FPS);
export const SAMPLE_PROMPT = 'Sample vCGE pilot contact';   // raven575, video review 2026-10-17 #61
export const PLAIN_SAMPLE_PROMPT = 'Sample contact';         // the plain edition (mod01-shell/edition.js)
export const DONE_LABEL = "Everything's correct";

const $ = (id) => document.getElementById(id);
const reducedMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let armed = false;     // a move of the deck's own is heading for this card: pop on arrival

// The pilot's animal in front of their name: the same animal as the sample's bundled logo (src/vendor/icons/animals/),
// as the system's own emoji, since a list entry can carry text only.
export const ANIMAL_EMOJI = Object.freeze({ turtle: '🐢', raccoon: '🦝', cat: '🐈', owl: '🦉', octopus: '🐙', lizard: '🦎', zebra: '🦓', eagle: '🦅', elephant: '🐘' });

/**
 * The list entry for a sample contact. A pilot (a sample with an animal logo): "🐙 Pidge Octopus". Any other sample:
 * "Elena Rostova, NeuralShift AI" (the sample's own emoji label is never shown).
 */
export function sampleLabel(sample = {}) {
    const name = [sample.firstName, sample.lastName].filter(Boolean).join(' ');
    const animal = ANIMAL_EMOJI[String(sample.logo || '').split('/').pop().replace(/\.svg$/, '')];
    if (animal && name) return `${animal} ${name}`;
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
 * @param {string}   [opts.prompt]         the list's first line and name (the plain edition passes PLAIN_SAMPLE_PROMPT)
 * @param {Function} opts.onSample         called with the chosen sample
 * @param {Function} opts.onDone           "Everything's correct": the details go on to the 3D Card
 * @param {Function} [opts.onBeforeChange] the deck's hook for its own moves (arms the pop-in)
 * @param {Array}    [opts.phoneFormats]   [style, example] pairs for the phone style list (formMapper.js PHONE_FORMATS)
 * @param {Object}   [opts.phoneStyle]     the style in use: { format, countryCode }
 * @param {Function} [opts.onPhoneStyle]   called with the new { format, countryCode } when either control changes
 */
export function initFieldsCard({ samples = [], prompt = SAMPLE_PROMPT, onSample = null, onDone = null, onBeforeChange = null, phoneFormats = [], phoneStyle = null, onPhoneStyle = null } = {}) {
    const select = $('fakeContactSelect');
    if (select) {
        select.setAttribute('aria-label', prompt);
        select.replaceChildren(new Option(prompt, ''), ...samples.map((s, i) => new Option(sampleLabel(s), String(i))));
        select.addEventListener('change', () => {
            const sample = samples[Number(select.value)];
            select.value = '';                  // the list is a command, not a state: it reads the prompt again
            if (!sample || !onSample) return;
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
