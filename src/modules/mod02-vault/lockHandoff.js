/**
 * vCGE-MOD02: the padlock hand-off (redesign step 3)
 * Created by raven575, Team vCGE (Claude) & Gemini
 *
 * Vault has no card of its own. Each time the deck hands off from one step card to the next, a small padlock plays in
 * the middle of the screen and says nothing: the shackle closes as the details go into the vault, the dial turns a
 * little and the glow goes from orange (unlocked) to green (locked); then the shackle opens again and the glow goes
 * back to orange as the next card takes over. The whole cycle takes HANDOFF_MS (about 1.4 s), drawn at HANDOFF_FPS so
 * it is not too crisp, with a small overshoot as the shackle lands. It cannot be tapped, asks nothing and carries no
 * data: it follows the deck's CARD_CHANGED signal (card names only). Screen readers hear one short announcement. Under
 * "reduce motion" the end state is shown with no movement. The shackle position carries the state, so colour is never
 * the only cue.
 */
import { globalEventBus, Events } from '../../share/eventBus.js';

export const HANDOFF_MS = 1400;          // unlocked -> locked -> unlocked (raven575: 1.25 to 1.5 s)
export const HANDOFF_FPS = 26;           // stepped at 24 to 30 frames a second
export const STILL_MS = 700;             // how long the still end state shows under reduce motion
export const OVERSHOOT = 0.05;           // the shackle lands 5 percent past its stop and settles back

const ORANGE = [249, 115, 22], GREEN = [34, 197, 94];
const SHACKLE_OPEN_PX = -7;              // the shackle sits this far up when the lock is open (viewBox units)
const DIAL_TURN_DEG = 150;               // each half of the cycle turns the dial this much

/** The deck moves between step cards: a hand-off. Nothing goes into the vault from or onto the Welcome card. */
export function isHandoff(from, to) {
    return !!from && !!to && from !== to && from !== 'welcome' && to !== 'welcome';
}

/** Ease in and out (quadratic) that lands OVERSHOOT past its stop and settles back, clamped to [0, 1] input. */
export function easeOvershoot(x) {
    x = Math.min(1, Math.max(0, x));
    const ease = x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
    const bump = x > 0.8 ? Math.sin(Math.PI * (x - 0.8) / 0.2) : 0;     // the landing: past the stop, then back
    return ease + OVERSHOOT * 1.3 * bump;
}

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Time progress p (0..1) snapped to the frame grid. */
export function quantize(p, fps = HANDOFF_FPS) {
    const frames = Math.round((HANDOFF_MS / 1000) * fps);
    return Math.min(1, Math.floor(p * frames) / frames);
}

/**
 * What the padlock looks like at progress p (0..1): where the shackle sits, how far the dial has turned, the colour
 * mix (0 orange, 1 green) and the opacity. Pure, so it is unit-tested.
 */
export function frameAt(p) {
    p = Math.min(1, Math.max(0, p));
    let shackle, dial, lock;
    if (p < 0.35) { lock = easeOvershoot(p / 0.35); shackle = SHACKLE_OPEN_PX * (1 - lock); dial = DIAL_TURN_DEG * smooth(0.05, 0.38, p); }
    else if (p < 0.62) { shackle = 0; dial = DIAL_TURN_DEG; }
    else { const open = easeOvershoot((p - 0.62) / 0.33); shackle = SHACKLE_OPEN_PX * open; dial = DIAL_TURN_DEG + DIAL_TURN_DEG * smooth(0.62, 0.95, p); }
    const colour = smooth(0.1, 0.38, p) * (1 - smooth(0.62, 0.9, p));
    const opacity = smooth(0, 0.08, p) * (1 - smooth(0.92, 1, p));
    return { shackle, dial, colour, opacity, locked: shackle > SHACKLE_OPEN_PX / 2 };
}

export const END_STATE = Object.freeze({ shackle: SHACKLE_OPEN_PX, dial: 0, colour: 0, opacity: 1, locked: false });

export function mixColour(c) {
    const ch = (i) => Math.round(ORANGE[i] + (GREEN[i] - ORANGE[i]) * c);
    return `rgb(${ch(0)}, ${ch(1)}, ${ch(2)})`;
}

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export class LockHandoff {
    constructor({ now = () => performance.now(), reduceMotion = reducedMotion } = {}) {
        this.now = now;
        this.reduceMotion = reduceMotion;
        this.root = null; this.live = null;
        this.raf = 0; this.timer = 0; this.started = 0;
    }

    /** Builds the overlay once and follows the deck's hand-off signal. */
    init(doc = document) {
        if (this.root) return;
        const root = doc.createElement('div');
        root.id = 'vaultHandoff';
        root.className = 'vault-handoff hidden';
        root.setAttribute('aria-hidden', 'true');
        // The glow is a layer of its own behind the lock (vault.css), never a filter on the moving SVG.
        root.innerHTML = `<span class="vault-handoff-glow"></span><svg viewBox="0 0 64 64" class="vault-handoff-lock" focusable="false">
            <path class="vh-shackle" d="M21 30 V21 a11 11 0 0 1 22 0 V30" fill="none" stroke-width="5" stroke-linecap="round"></path>
            <rect class="vh-body" x="12" y="28" width="40" height="28" rx="7"></rect>
            <g class="vh-dial"><circle cx="32" cy="42" r="7.5" fill="none" stroke-width="2.5"></circle><line x1="32" y1="36.5" x2="32" y2="40" stroke-width="2.5" stroke-linecap="round"></line></g>
        </svg>`;
        const live = doc.createElement('p');
        live.id = 'vaultHandoffLive';
        live.className = 'vault-sr-only';
        live.setAttribute('role', 'status');
        live.setAttribute('aria-live', 'polite');
        doc.body.append(root, live);
        this.root = root; this.live = live;
        this.parts = { shackle: root.querySelector('.vh-shackle'), body: root.querySelector('.vh-body'), dial: root.querySelector('.vh-dial') };
        globalEventBus.subscribe(Events.CARD_CHANGED, (d) => { if (d && isHandoff(d.from, d.to)) this.play(); });
    }

    paint(f) {
        const { shackle, body, dial } = this.parts;
        shackle.style.transform = `translateY(${shackle ? f.shackle.toFixed(2) : 0}px)`;
        const colour = mixColour(f.colour);
        body.style.fill = colour;
        shackle.style.stroke = colour;
        dial.style.stroke = f.colour > 0.5 ? '#052e16' : '#431407';
        dial.style.transform = `rotate(${f.dial.toFixed(1)}deg)`;
        this.root.style.setProperty('--vh-glow', colour);
        this.root.style.opacity = f.opacity.toFixed(3);
        this.root.dataset.state = f.locked ? 'locked' : 'unlocked';
    }

    /** Plays one cycle (restarts if one is running). */
    play() {
        if (!this.root || (typeof document !== 'undefined' && document.hidden)) return;   // nobody is looking
        this.stop();
        this.root.classList.remove('hidden');
        this.live.textContent = 'Details locked in the vault, moving on.';
        if (this.reduceMotion()) {
            this.paint(END_STATE);
            this.root.dataset.playing = 'still';
            this.timer = setTimeout(() => this.stop(), STILL_MS);
            return;
        }
        this.root.dataset.playing = 'cycle';
        this.started = this.now();
        let lastFrame = -1;
        const step = () => {
            const p = (this.now() - this.started) / HANDOFF_MS;
            if (p >= 1) { this.stop(); return; }
            const q = quantize(p);
            if (q !== lastFrame) { lastFrame = q; this.paint(frameAt(q)); }
            this.raf = requestAnimationFrame(step);
        };
        this.paint(frameAt(0));
        this.raf = requestAnimationFrame(step);
        // A webview that stalls animation frames must not leave the lock on screen: the clock ends the cycle regardless.
        this.timer = setTimeout(() => this.stop(), HANDOFF_MS + 150);
    }

    stop() {
        if (!this.root) return;
        cancelAnimationFrame(this.raf); clearTimeout(this.timer);
        this.raf = 0; this.timer = 0;
        this.root.classList.add('hidden');
        delete this.root.dataset.playing;
        this.live.textContent = '';
    }

    playing() { return !!(this.root && this.root.dataset.playing); }
}
