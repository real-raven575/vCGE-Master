/**
 * vCard Generator Engine (vCGE)
 * Copyright (c) 2026 raven575, Gemini & Claude
 *
 * Repository: https://github.com/real-raven575/vCGE-Master
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */

// The temporary vault: memory only. Nothing is ever written to browser storage. While the card is hidden behind the
// session PIN (an idle lock), the card and the scan in progress are held here, encrypted with a random AES-GCM key
// made for that lock alone. Unlocking releases them and drops the key; a wipe drops the key and the ciphertext.

// Key under which builds before the memory-only vault saved an encrypted card; deleted at startup.
export const LEGACY_VAULT_KEY = 'vCGE_secure_vault.dat';
const LEGACY_KEYCHAIN_KDF = 'pbkdf2-sha256+hkdf-device-key';

const subtle = () => window.crypto.subtle;

export class TemporaryVault {
    constructor() {
        this.key = null;      // non-extractable AES-GCM key, only while something is held
        this.sealed = null;   // { iv, ciphertext }
        this.generation = 0;  // bumped by every wipe, so a hold that finishes after a wipe is discarded
    }

    isHolding() {
        return this.sealed !== null;
    }

    /** Encrypts a payload under a fresh key and keeps it in memory. Replaces anything already held. */
    async hold(payload) {
        this.wipe();
        const generation = this.generation;
        const key = await subtle().generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
        const iv = window.crypto.getRandomValues(new Uint8Array(12));
        const ciphertext = await subtle().encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(payload)));
        if (generation !== this.generation) return false;
        this.key = key;
        this.sealed = { iv, ciphertext };
        return true;
    }

    /** Returns what hold() kept and empties the vault. Null when nothing is held. */
    async release() {
        if (!this.sealed) return null;
        const { key, sealed } = this;
        this.generation++;
        this.key = null;
        this.sealed = null;
        try {
            const plain = await subtle().decrypt({ name: 'AES-GCM', iv: sealed.iv }, key, sealed.ciphertext);
            return JSON.parse(new TextDecoder().decode(plain));
        } finally {
            new Uint8Array(sealed.ciphertext).fill(0);
        }
    }

    wipe() {
        this.generation++;
        if (this.sealed) new Uint8Array(this.sealed.ciphertext).fill(0);
        this.key = null;
        this.sealed = null;
        return { status: 'WIPED', code: '3001_CLEARED' };
    }
}

/**
 * Deletes a vault saved by an older build. Returns null when there was none, else { keychainBound } (true when that
 * vault was bound to a device key in the desktop app's OS keychain, which the caller then deletes too).
 */
export function deleteLegacyVault(storage = localStorage) {
    const raw = storage.getItem(LEGACY_VAULT_KEY);
    if (raw === null) return null;
    storage.removeItem(LEGACY_VAULT_KEY);
    let kdf = null;
    try { kdf = JSON.parse(raw).kdf; } catch (e) { /* unreadable: deleted all the same */ }
    return { keychainBound: kdf === LEGACY_KEYCHAIN_KDF };
}

export const temporaryVault = new TemporaryVault();
