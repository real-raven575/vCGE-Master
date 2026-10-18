/**
 * vCGE-MOD02: vault store (the hub every module goes through)
 * Created by raven575, Team vCGE (Claude) & Gemini
 *
 * One memory-only store for everything the pipeline holds while a card is being made: the photo, the OCR text, the
 * review lines, the contact, the last scan, the Undo copy and the logo Export hands to the card (wiped with the rest).
 * Each module gets a handle that may read and write only the slots it needs, so modules never hand data to each other
 * directly. Values are copied in and out, so no module holds a live reference into another's data. Change notices name the slot, never its contents.
 *
 * lock() seals every slot in the TemporaryVault (AES-GCM, a fresh key per lock) behind the session PIN; unlock(pin)
 * or unlockBiometric() puts them back. wipe() empties everything, the held copy, the PIN and the biometric enrolment.
 * Nothing is ever written to storage.
 */

import { TemporaryVault } from './vault.js';
import { SessionPin } from './sessionPin.js';
import { BiometricUnlock } from './biometric.js';

export const SLOTS = Object.freeze(['photo', 'ocr', 'review', 'contact', 'lastScan', 'undo', 'logo']);

// What each module may touch. `share` slots are readable only during a user gesture (a tap on a share button).
export const MODULE_RIGHTS = Object.freeze({
    mod03: { read: [], write: ['photo'] },                                  // camera / upload
    mod04: { read: ['photo'], write: ['ocr'] },                             // OCR
    mod05: { read: ['ocr', 'review'], write: ['review'] },                  // field mapping
    mod06: { read: ['review', 'contact', 'undo', 'logo'], write: ['contact', 'undo'] }, // card view (reads the logo Export put in)
    mod07: { read: ['contact'], write: [] },                                // vCard + QR
    mod08: { read: [], write: ['logo'], share: ['contact'] }                // egress: reads the contact only when the user shares; writes the QR centre logo
                                                                            // ("Also use this logo on my card"), which the card view reads
});

const copy = (value) => (value === undefined || value === null ? null : structuredClone(value));

function userGesture() {
    return typeof navigator !== 'undefined' && navigator.userActivation ? navigator.userActivation.isActive : false;
}

export class VaultStore {
    /**
     * @param {{ vault?: TemporaryVault, pin?: SessionPin, biometric?: BiometricUnlock, isUserGesture?: () => boolean }} [deps]
     */
    constructor({ vault = new TemporaryVault(), pin = new SessionPin(), biometric = new BiometricUnlock(), isUserGesture = userGesture } = {}) {
        this.vault = vault;
        this.pin = pin;
        this.biometric = biometric;
        this.isUserGesture = isUserGesture;
        this.slots = new Map(SLOTS.map((s) => [s, null]));
        this.mode = 'open';       // 'open' | 'locked'
        this.locking = null;      // Promise from vault.hold() while a lock seals the slots
        this.listeners = new Map(SLOTS.map((s) => [s, new Set()]));
        this.stateListeners = new Set();
    }

    // ---- Slots (for the controller; modules use handle()) ----

    get(slot) {
        this.#check(slot);
        return this.mode === 'open' ? copy(this.slots.get(slot)) : null;
    }

    /** Stores a copy. Refused while locked: nothing new goes in until the PIN brings the card back. */
    put(slot, value) {
        this.#check(slot);
        if (this.mode !== 'open') return false;
        this.slots.set(slot, copy(value));
        this.#notify(slot);
        return true;
    }

    clear(slot) {
        this.#check(slot);
        if (this.slots.get(slot) === null) return;
        this.slots.set(slot, null);
        this.#notify(slot);
    }

    /** True when there is nothing to lose: every slot empty and nothing held behind the PIN. */
    isEmpty() {
        return this.mode === 'open' && SLOTS.every((s) => this.slots.get(s) === null);
    }

    state() {
        return this.mode;
    }

    /** cb({ slot }) after a slot changes. No data is passed. Returns an unsubscribe function. */
    onChange(slot, cb) {
        this.#check(slot);
        this.listeners.get(slot).add(cb);
        return () => this.listeners.get(slot).delete(cb);
    }

    /** cb({ state, reason }) on lock, unlock and wipe. Returns an unsubscribe function. */
    onStateChange(cb) {
        this.stateListeners.add(cb);
        return () => this.stateListeners.delete(cb);
    }

    // ---- Module handles ----

    /** A handle limited to one module's rights. Unknown modules get no access at all. */
    handle(moduleId) {
        const rights = MODULE_RIGHTS[moduleId];
        if (!rights) throw new Error(`VAULT_UNKNOWN_MODULE: ${moduleId}`);
        const can = (kind, slot) => (rights[kind] || []).includes(slot);
        const deny = (action, slot) => { throw new Error(`VAULT_DENIED: ${moduleId} may not ${action} ${slot}`); };
        return Object.freeze({
            module: moduleId,
            get: (slot) => (can('read', slot) ? this.get(slot) : deny('read', slot)),
            put: (slot, value) => (can('write', slot) ? this.put(slot, value) : deny('write', slot)),
            clear: (slot) => (can('write', slot) ? this.clear(slot) : deny('write', slot)),
            onChange: (slot, cb) => (can('read', slot) || can('share', slot) ? this.onChange(slot, cb) : deny('watch', slot)),
            /** Egress only: the slot's value, during a user gesture. Null otherwise. */
            readForShare: (slot) => {
                if (!can('share', slot)) return deny('share', slot);
                return this.isUserGesture() ? this.get(slot) : null;
            }
        });
    }

    // ---- Session PIN ----

    hasPin() {
        return this.pin.isSet();
    }

    setPin(pin) {
        return this.pin.set(pin);
    }

    clearPin() {
        this.pin.clear();
        this.biometric.clear();   // biometric needs the PIN as its fallback
    }

    // ---- Lock, unlock, wipe ----

    /** Seals every slot behind the session PIN. Returns false (and changes nothing) without a PIN. */
    lock() {
        if (this.mode !== 'open' || !this.pin.isSet()) return false;
        const payload = Object.fromEntries(SLOTS.map((s) => [s, this.slots.get(s)]));
        this.mode = 'locked';
        this.locking = this.vault.hold(payload).catch((e) => { console.error('[vCGE] Could not hold the card:', e); return false; });
        SLOTS.forEach((s) => this.clear(s));
        this.#emit('locked', 'lock');
        return true;
    }

    /**
     * Checks the PIN and puts the slots back.
     * @returns {Promise<{ result: 'ok' | 'lost' | 'wrong' | 'locked_out' | 'not_set' | 'not_locked', attemptsLeft: number }>}
     *   'lost': the PIN was right but the sealed copy could not be kept or read, so everything was wiped.
     */
    async unlock(pin) {
        if (this.mode !== 'locked') return { result: 'not_locked', attemptsLeft: 0 };
        const check = await this.pin.verify(pin);
        if (check.result === 'locked_out' || check.result === 'not_set') {
            this.wipe(check.result === 'locked_out' ? 'too many wrong PINs' : 'session PIN missing');
            return check;
        }
        if (check.result !== 'ok') return check;
        return this.#release(check.attemptsLeft);
    }

    /** Asks the device to check the user's face or fingerprint (enrolled for this session) and puts the slots back. */
    async unlockBiometric() {
        if (this.mode !== 'locked') return { result: 'not_locked', attemptsLeft: 0 };
        if (!this.biometric.isEnrolled() || !(await this.biometric.verify())) return { result: 'not_confirmed', attemptsLeft: 0 };
        return this.#release(0);
    }

    // Puts the sealed slots back after a successful check. A seal that failed or cannot be read wipes everything.
    async #release(attemptsLeft) {
        if (this.mode !== 'locked') return { result: 'not_locked', attemptsLeft: 0 };
        const held = await this.locking;
        let payload = null;
        try {
            payload = held ? await this.vault.release() : null;
        } catch (e) {
            console.error('[vCGE] Held card unreadable:', e);
        }
        this.locking = null;
        if (this.mode !== 'locked') return { result: 'not_locked', attemptsLeft: 0 };   // wiped while unlocking
        if (!payload) {
            this.wipe('held card lost');
            return { result: 'lost', attemptsLeft: 0 };
        }
        this.mode = 'open';
        SLOTS.forEach((s) => { if (payload[s] !== undefined && payload[s] !== null) this.put(s, payload[s]); });
        this.#emit('open', 'unlock');
        return { result: 'ok', attemptsLeft };
    }

    /** Empties every slot, the copy held behind the PIN, the PIN itself and the biometric enrolment. */
    wipe(reason = 'wipe') {
        this.vault.wipe();
        this.pin.clear();
        this.biometric.clear();
        this.locking = null;
        this.mode = 'open';
        SLOTS.forEach((s) => this.clear(s));
        this.#emit('wiped', reason);
    }

    // ---- Internals ----

    #check(slot) {
        if (!this.slots.has(slot)) throw new Error(`VAULT_UNKNOWN_SLOT: ${slot}`);
    }

    #notify(slot) {
        this.listeners.get(slot).forEach((cb) => {
            try { cb({ slot }); } catch (e) { console.error('[vCGE] Vault listener failed:', e); }
        });
    }

    #emit(state, reason) {
        this.stateListeners.forEach((cb) => {
            try { cb({ state, reason }); } catch (e) { console.error('[vCGE] Vault listener failed:', e); }
        });
    }
}
