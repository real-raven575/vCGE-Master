/**
 * vCGE-MOD02: wipe policy (when the vault store is locked or wiped)
 * Created by raven575, Gemini & Claude
 *
 * The rules that today live in main.js, owned by the vault instead:
 *   - 2 minutes without activity: lock behind the session PIN if one is set, else wipe.
 *   - 5 minutes locked without the right PIN: wipe.
 *   - Leaving, closing or reloading the page (pagehide, back/forward cache included): wipe.
 *   - 30 seconds out of view: wipe. Phones freeze background timers, so the deadline is also checked as the page
 *     comes back. Going out of view within 5 s of expectExternalApp() (photo picker, share sheet) does not start it;
 *     the idle rule applies instead.
 * All deadlines follow the wall clock. The Back guard prompt stays with the UI; it calls store.wipe() on leave.
 */

import { QUICK_UNLOCK_SECONDS } from './sessionPin.js';

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
     * @param {{ env?: object, idleSeconds?: number, hiddenSeconds?: number, quickUnlockSeconds?: number, externalGraceMs?: number }} [options]
     */
    constructor(store, { env = browserEnv(), idleSeconds = IDLE_SECONDS, hiddenSeconds = HIDDEN_WIPE_SECONDS,
        quickUnlockSeconds = QUICK_UNLOCK_SECONDS, externalGraceMs = EXTERNAL_APP_GRACE_MS } = {}) {
        this.store = store;
        this.env = env;
        this.idleMs = idleSeconds * 1000;
        this.hiddenMs = hiddenSeconds * 1000;
        this.quickMs = quickUnlockSeconds * 1000;
        this.graceMs = externalGraceMs;
        this.idleDeadline = 0;
        this.hiddenDeadline = 0;
        this.quickDeadline = 0;
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
        this.idleDeadline = this.hiddenDeadline = this.quickDeadline = 0;
    }

    /** Call on any user activity (tap, key, typing). Restarts the idle deadline while the card is open. */
    activity() {
        if (this.store.state() === 'open') this.idleDeadline = this.env.now() + this.idleMs;
    }

    /** Call just before opening the photo picker, a download or a share action. */
    expectExternalApp() {
        this.externalUntil = this.env.now() + this.graceMs;
    }

    /** Seconds left before the next idle lock or wipe, and before a locked card is wiped (for countdowns). */
    remaining() {
        const left = (deadline) => (deadline ? Math.max(0, Math.ceil((deadline - this.env.now()) / 1000)) : 0);
        return { idle: left(this.idleDeadline), quickUnlock: left(this.quickDeadline) };
    }

    /** Checks every deadline. Runs every second, and as the page comes back into view. */
    tick() {
        const now = this.env.now();
        if (this.hiddenDeadline && now >= this.hiddenDeadline) {
            this.hiddenDeadline = 0;
            this.store.wipe(`out of view for ${this.hiddenMs / 1000} s`);
            return;
        }
        if (this.quickDeadline && now >= this.quickDeadline) {
            this.store.wipe('quick unlock expired');
            return;
        }
        if (this.idleDeadline && now >= this.idleDeadline) {
            this.idleDeadline = 0;
            if (!this.store.lock()) this.store.wipe('idle');
        }
    }

    #onVisibility() {
        if (this.env.isHidden()) {
            this.hiddenDeadline = this.env.now() < this.externalUntil ? 0 : this.env.now() + this.hiddenMs;
        } else {
            this.tick();
            this.hiddenDeadline = 0;
        }
    }

    #onState(state) {
        if (state === 'locked') {
            this.idleDeadline = 0;
            this.quickDeadline = this.env.now() + this.quickMs;
        } else {
            this.quickDeadline = 0;
            if (state === 'wiped') {
                // Nothing left to protect: the idle clock starts again with the next activity.
                this.idleDeadline = 0;
                this.hiddenDeadline = 0;
            } else {
                this.activity();
            }
        }
    }
}
