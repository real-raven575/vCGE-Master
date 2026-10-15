/**
 * vCGE-MOD02: wipe policy (when the vault store is locked or wiped)
 * Created by raven575, Gemini & Claude
 *
 * The rules that today live in main.js, owned by the vault instead:
 *   - 2 minutes without activity: lock behind the session PIN if one is set, else wipe.
 *   - Out of view (screen off, another app): with a PIN, lock at once; without one, wipe after 30 seconds.
 *   - 7 minutes without activity, whether the card is open, locked or out of view: wipe.
 *   - Leaving, closing or reloading the page (pagehide, back/forward cache included): wipe.
 *   Phones freeze background timers, so the deadlines are also checked as the page comes back. Going out of view within
 *   5 s of expectExternalApp() (photo picker, share sheet) neither locks nor starts the 30 s; the idle rule applies.
 * All deadlines follow the wall clock. The Back guard prompt stays with the UI; it calls store.wipe() on leave.
 */

import { RESET_SECONDS } from './sessionPin.js';

export const IDLE_SECONDS = 120;
export const HIDDEN_WIPE_SECONDS = 30;
export const EXTERNAL_APP_GRACE_MS = 5000;

/** The browser hooks the policy needs; tests pass their own. */
export function browserEnv() {
    return {
        now: () => Date.now(),
        on: (target, type, fn) => (target === 'window' ? window : document).addEventListener(type, fn),
        off: (target, type, fn) => (target === 'window' ? window : document).removeEventListener(type, fn),
        isHidden: () => document.visibilityState === 'hidden',
        setInterval: (fn, ms) => setInterval(fn, ms),
        clearInterval: (id) => clearInterval(id)
    };
}

export class WipePolicy {
    /**
     * @param {import('./vaultStore.js').VaultStore} store
     * @param {{ env?: object, idleSeconds?: number, hiddenSeconds?: number, resetSeconds?: number, externalGraceMs?: number }} [options]
     */
    constructor(store, { env = browserEnv(), idleSeconds = IDLE_SECONDS, hiddenSeconds = HIDDEN_WIPE_SECONDS,
        resetSeconds = RESET_SECONDS, externalGraceMs = EXTERNAL_APP_GRACE_MS } = {}) {
        this.store = store;
        this.env = env;
        this.idleMs = idleSeconds * 1000;
        this.hiddenMs = hiddenSeconds * 1000;
        this.resetMs = resetSeconds * 1000;
        this.graceMs = externalGraceMs;
        this.idleDeadline = 0;
        this.hiddenDeadline = 0;
        this.resetDeadline = 0;
        this.externalUntil = 0;
        this.timer = null;
        this.unsubscribe = null;
        this.handlers = {
            pagehide: () => this.store.wipe('left the page'),
            visibilitychange: () => this.#onVisibility()
        };
    }

    start() {
        if (this.timer) return;
        this.env.on('window', 'pagehide', this.handlers.pagehide);
        this.env.on('document', 'visibilitychange', this.handlers.visibilitychange);
        this.unsubscribe = this.store.onStateChange(({ state }) => this.#onState(state));
        this.timer = this.env.setInterval(() => this.tick(), 1000);
        this.activity();
    }

    stop() {
        if (!this.timer) return;
        this.env.off('window', 'pagehide', this.handlers.pagehide);
        this.env.off('document', 'visibilitychange', this.handlers.visibilitychange);
        if (this.unsubscribe) this.unsubscribe();
        this.env.clearInterval(this.timer);
        this.timer = null;
        this.unsubscribe = null;
        this.idleDeadline = this.hiddenDeadline = this.resetDeadline = 0;
    }

    /** Call on any user activity (tap, key, typing). Restarts the idle lock and the 7-minute reset while the card is open. */
    activity() {
        if (this.store.state() !== 'open') return;
        this.idleDeadline = this.env.now() + this.idleMs;
        this.resetDeadline = this.env.now() + this.resetMs;
    }

    /** Call just before opening the photo picker, a download or a share action. */
    expectExternalApp() {
        this.externalUntil = this.env.now() + this.graceMs;
    }

    /** Seconds left before the next idle lock or wipe, and before the 7-minute reset (for countdowns). */
    remaining() {
        const left = (deadline) => (deadline ? Math.max(0, Math.ceil((deadline - this.env.now()) / 1000)) : 0);
        return { idle: left(this.idleDeadline), reset: left(this.resetDeadline) };
    }

    /** Checks every deadline. Runs every second, and as the page comes back into view. */
    tick() {
        const now = this.env.now();
        if (this.hiddenDeadline && now >= this.hiddenDeadline) {
            this.hiddenDeadline = 0;
            this.store.wipe(`out of view for ${this.hiddenMs / 1000} s`);
            return;
        }
        if (this.resetDeadline && now >= this.resetDeadline) {
            this.resetDeadline = 0;
            if (this.store.state() === 'locked' || !this.store.isEmpty()) this.store.wipe(`${this.resetMs / 60000} minutes without activity`);
            return;
        }
        if (this.idleDeadline && now >= this.idleDeadline) {
            this.idleDeadline = 0;
            if (!this.store.lock()) this.store.wipe('idle');
        }
    }

    #onVisibility() {
        if (this.env.isHidden()) {
            this.hiddenDeadline = 0;
            if (this.env.now() < this.externalUntil) return;
            if (this.store.hasPin()) {
                if (this.store.state() === 'open' && !this.store.isEmpty()) this.store.lock();
            } else {
                this.hiddenDeadline = this.env.now() + this.hiddenMs;
            }
        } else {
            this.tick();
            this.hiddenDeadline = 0;
        }
    }

    #onState(state) {
        if (state === 'locked') {
            this.idleDeadline = 0;   // the 7-minute reset keeps running from the last activity
        } else if (state === 'wiped') {
            // Nothing left to protect: the clocks start again with the next activity.
            this.idleDeadline = this.hiddenDeadline = this.resetDeadline = 0;
        } else {
            this.activity();   // unlocked
        }
    }
}
