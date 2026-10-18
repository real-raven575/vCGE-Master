/**
 * vCGE-MOD02: session PIN (quick unlock after a lock)
 * Created by raven575, Team vCGE (Claude) & Gemini
 *
 * A 4-digit PIN chosen for this session only. With a PIN set, the screen turning off (the page going out of view) or
 * 2 minutes without activity hide the card and hold it in the temporary vault (memory only), and the PIN brings it
 * back. After RESET_SECONDS without activity, after MAX_PIN_ATTEMPTS wrong tries, or on leaving or reloading the page,
 * the held card and the PIN are both wiped. The PIN is never stored: only a salted PBKDF2 hash, in memory.
 */

// 7 minutes without activity (open or locked) wipes everything and the app starts new. Settings can make it 10 or 15
// (raven575, 2026-10-18, video #68): Shell puts the choice on html[data-wipe] and Vault reads only that.
export const RESET_SECONDS = 420;
export const WIPE_MINUTES = Object.freeze([7, 10, 15]);

/** The wipe time in seconds for html[data-wipe]: 7, 10 or 15 minutes; anything else is the default 7. */
export function wipeSecondsFrom(attr) {
    const m = Number(attr);
    return WIPE_MINUTES.includes(m) ? m * 60 : RESET_SECONDS;
}
export const PIN_LENGTH = 4;
export const MAX_PIN_ATTEMPTS = 5;
const PIN_ITERATIONS = 100000;

async function hashPin(pin, salt) {
    const key = await window.crypto.subtle.importKey('raw', new TextEncoder().encode(pin), { name: 'PBKDF2' }, false, ['deriveBits']);
    return new Uint8Array(await window.crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: PIN_ITERATIONS, hash: 'SHA-256' }, key, 256));
}

/** True for exactly PIN_LENGTH digits. */
export function isValidPin(pin) {
    return typeof pin === 'string' && new RegExp(`^[0-9]{${PIN_LENGTH}}$`).test(pin);
}

export class SessionPin {
    constructor() {
        this.record = null;   // { salt, hash }
        this.attempts = 0;
    }

    isSet() {
        return this.record !== null;
    }

    async set(pin) {
        if (!isValidPin(pin)) throw new Error('PIN_INVALID');
        const salt = window.crypto.getRandomValues(new Uint8Array(16));
        this.record = { salt, hash: await hashPin(pin, salt) };
        this.attempts = 0;
    }

    /** @returns {Promise<{ result: 'ok' | 'wrong' | 'locked_out' | 'not_set', attemptsLeft: number }>} */
    async verify(pin) {
        if (!this.record) return { result: 'not_set', attemptsLeft: 0 };
        const hash = await hashPin(String(pin), this.record.salt);
        let diff = 0;
        for (let i = 0; i < hash.length; i++) diff |= hash[i] ^ this.record.hash[i];
        if (diff === 0) {
            this.attempts = 0;
            return { result: 'ok', attemptsLeft: MAX_PIN_ATTEMPTS };
        }
        this.attempts++;
        if (this.attempts >= MAX_PIN_ATTEMPTS) {
            this.clear();
            return { result: 'locked_out', attemptsLeft: 0 };
        }
        return { result: 'wrong', attemptsLeft: MAX_PIN_ATTEMPTS - this.attempts };
    }

    clear() {
        if (this.record) this.record.hash.fill(0);
        this.record = null;
        this.attempts = 0;
    }
}
