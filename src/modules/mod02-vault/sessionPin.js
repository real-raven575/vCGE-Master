/**
 * vCGE-MOD02: session PIN (quick unlock after an idle lock)
 * Created by raven575, Gemini & Claude
 *
 * A short PIN or password chosen for this session only. After the idle timeout the card is hidden and held in the
 * temporary vault (memory only) for QUICK_UNLOCK_SECONDS, and the PIN brings it back. When that window ends, after
 * MAX_PIN_ATTEMPTS wrong tries, on leaving or reloading the page, the held card and the PIN are both wiped.
 * The PIN is never stored: only a salted PBKDF2 hash, in memory.
 */

export const QUICK_UNLOCK_SECONDS = 300;
export const MIN_PIN_LENGTH = 4;
export const MAX_PIN_ATTEMPTS = 5;
const PIN_ITERATIONS = 100000;

async function hashPin(pin, salt) {
    const key = await window.crypto.subtle.importKey('raw', new TextEncoder().encode(pin), { name: 'PBKDF2' }, false, ['deriveBits']);
    return new Uint8Array(await window.crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: PIN_ITERATIONS, hash: 'SHA-256' }, key, 256));
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
        if (typeof pin !== 'string' || pin.length < MIN_PIN_LENGTH) throw new Error('PIN_TOO_SHORT');
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
