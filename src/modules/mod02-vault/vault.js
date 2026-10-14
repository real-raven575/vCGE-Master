/**
 * vCard Generator Engine (vCGE)
 * Copyright (c) 2026 raven575, Gemini & Claude
 *
 * Repository: https://github.com/real-raven575/vCGE-Master
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */

// Key-derivation schemes recorded in each vault blob.
export const KDF_PASSPHRASE = 'pbkdf2-sha256';                  // passphrase only (browser)
export const KDF_KEYCHAIN = 'pbkdf2-sha256+hkdf-device-key';    // passphrase + OS keychain device key (Tauri)
// Format 2: the card is encrypted with a random data key, and the data key is stored wrapped once per unlock
// method ("slot"): always the passphrase, plus one slot per enrolled passkey. Format 1 (no `v` field) encrypted
// the card with the passphrase key directly; it is converted the first time it is unlocked.
export const VAULT_FORMAT = 2;
const PBKDF2_ITERATIONS = 100000;
const HKDF_INFO = new TextEncoder().encode('vCGE vault key v1');
const PASSKEY_INFO = new TextEncoder().encode('vCGE passkey slot v1');
const DATA_KEY = { name: 'AES-GCM', length: 256 };

const subtle = () => window.crypto.subtle;
const random = (n) => window.crypto.getRandomValues(new Uint8Array(n));

export class SecureStorageVault {
    constructor(storageKey = 'vCGE_secure_vault.dat') {
        this.storageKey = storageKey;
        this.isUnlocked = false;
        this.masterKey = null;   // the data key (non-extractable AES-GCM key) while unlocked
        this.kdf = null;
    }

    readBlob() {
        const raw = localStorage.getItem(this.storageKey);
        return raw ? JSON.parse(raw) : null;
    }

    writeBlob(blob) {
        localStorage.setItem(this.storageKey, JSON.stringify(blob));
    }

    // True when the stored vault was created with the OS keychain device key and cannot be opened without it.
    requiresDeviceKey() {
        const blob = this.readBlob();
        return !!blob && blob.kdf === KDF_KEYCHAIN;
    }

    hasStoredVault() {
        return localStorage.getItem(this.storageKey) !== null;
    }

    /** Enrolled passkeys: [{ id, label, created }] (ids are base64url credential ids). */
    passkeySlots() {
        const blob = this.readBlob();
        return blob && blob.v === VAULT_FORMAT ? (blob.passkeys || []).map(({ id, label, created }) => ({ id, label, created })) : [];
    }

    /**
     * Key-encryption key from the passphrase. PBKDF2-SHA256 (100k iterations, stored salt) turns the passphrase into
     * 256 bits. With a device key (Tauri: OS keychain), those bits are mixed with it through HKDF-SHA256, so the vault
     * is bound to this device. `usages` is ['wrapKey', 'unwrapKey'] for format 2 and ['encrypt', 'decrypt'] for format 1
     * (where this key encrypted the card itself; same bytes either way).
     */
    async passphraseKey(passphrase, salt, kdf, deviceSecret, usages) {
        const passKey = await subtle().importKey('raw', new TextEncoder().encode(passphrase), { name: 'PBKDF2' }, false, ['deriveBits']);
        const bits = await subtle().deriveBits({ name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' }, passKey, 256);
        if (kdf !== KDF_KEYCHAIN) return subtle().importKey('raw', bits, { name: 'AES-GCM' }, false, usages);
        const hkdfKey = await subtle().importKey('raw', bits, { name: 'HKDF' }, false, ['deriveKey']);
        return subtle().deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: deviceSecret, info: HKDF_INFO }, hkdfKey, DATA_KEY, false, usages);
    }

    /**
     * Key-encryption key from a passkey's PRF output (32 bytes the authenticator computes only after verifying the
     * user: Face ID, Touch ID, Windows Hello, Android biometrics or the device PIN). Mixed with the device key when the
     * vault is bound to the OS keychain, so a passkey slot is no weaker than the passphrase slot.
     */
    async passkeyKey(prfOutput, deviceSecret) {
        const hkdfKey = await subtle().importKey('raw', prfOutput, { name: 'HKDF' }, false, ['deriveKey']);
        return subtle().deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: deviceSecret || new Uint8Array(32), info: PASSKEY_INFO },
            hkdfKey, DATA_KEY, false, ['wrapKey', 'unwrapKey']);
    }

    async unwrapDataKey(slot, kek, extractable = false) {
        return subtle().unwrapKey('raw', new Uint8Array(slot.wrapped), kek, { name: 'AES-GCM', iv: new Uint8Array(slot.iv) },
            DATA_KEY, extractable, ['encrypt', 'decrypt']);
    }

    async wrapDataKey(dataKey, kek) {
        const iv = random(12);
        const wrapped = await subtle().wrapKey('raw', dataKey, kek, { name: 'AES-GCM', iv });
        return { iv: Array.from(iv), wrapped: Array.from(new Uint8Array(wrapped)) };
    }

    async useDataKey(dataKey, kdf) {
        // Re-import as non-extractable for day-to-day use: the raw key cannot be read back out of the page.
        const raw = await subtle().exportKey('raw', dataKey);
        this.masterKey = await subtle().importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
        new Uint8Array(raw).fill(0);
        this.kdf = kdf;
        this.isUnlocked = true;
    }

    /**
     * Creates the vault (no stored vault yet) or unlocks it with the passphrase. A wrong passphrase is detected here
     * (the passphrase slot will not unwrap). A format-1 vault is converted to format 2 on its first unlock.
     * @param {string} passphrase
     * @param {Uint8Array|null} deviceSecret 32-byte device key, or null in a plain browser
     */
    async initialize(passphrase, deviceSecret = null) {
        try {
            const existing = this.readBlob();
            const kdf = existing ? (existing.kdf || KDF_PASSPHRASE) : (deviceSecret ? KDF_KEYCHAIN : KDF_PASSPHRASE);
            if (kdf === KDF_KEYCHAIN && !deviceSecret) {
                return { success: false, error: 'ERR_KEYCHAIN_REQUIRED' };
            }
            const salt = existing && existing.salt ? new Uint8Array(existing.salt) : random(16);

            if (!existing) {
                const dataKey = await subtle().generateKey(DATA_KEY, true, ['encrypt', 'decrypt']);
                const kek = await this.passphraseKey(passphrase, salt, kdf, deviceSecret, ['wrapKey', 'unwrapKey']);
                this.writeBlob({ v: VAULT_FORMAT, kdf, salt: Array.from(salt), passphrase: await this.wrapDataKey(dataKey, kek), passkeys: [] });
                await this.useDataKey(dataKey, kdf);
                return { success: true, kdf, created: true };
            }

            if (existing.v === VAULT_FORMAT) {
                const kek = await this.passphraseKey(passphrase, salt, kdf, deviceSecret, ['wrapKey', 'unwrapKey']);
                let dataKey;
                try {
                    dataKey = await this.unwrapDataKey(existing.passphrase, kek, true);
                } catch (e) {
                    console.error('[ERR 2001] Decryption failed: wrong passphrase.');
                    return { success: false, error: 'ERR_VAULT_DECRYPT_FAIL' };
                }
                await this.useDataKey(dataKey, kdf);
                return { success: true, kdf };
            }

            // Format 1: the passphrase key encrypted the card directly. Decrypt, then re-save under a new data key.
            const oldKey = await this.passphraseKey(passphrase, salt, kdf, deviceSecret, ['encrypt', 'decrypt']);
            let payload;
            try {
                const plain = await subtle().decrypt({ name: 'AES-GCM', iv: new Uint8Array(existing.iv) }, oldKey, new Uint8Array(existing.ciphertext));
                payload = JSON.parse(new TextDecoder().decode(plain));
            } catch (e) {
                console.error('[ERR 2001] Decryption failed: wrong passphrase.');
                return { success: false, error: 'ERR_VAULT_DECRYPT_FAIL' };
            }
            const dataKey = await subtle().generateKey(DATA_KEY, true, ['encrypt', 'decrypt']);
            const kek = await this.passphraseKey(passphrase, salt, kdf, deviceSecret, ['wrapKey', 'unwrapKey']);
            this.writeBlob({ v: VAULT_FORMAT, kdf, salt: Array.from(salt), passphrase: await this.wrapDataKey(dataKey, kek), passkeys: [] });
            await this.useDataKey(dataKey, kdf);
            await this.encryptAndStore(payload);
            return { success: true, kdf, migrated: true };
        } catch (error) {
            console.error('[ERR 2001] Vault derivation failed:', error);
            return { success: false, error: 'ERR_VAULT_DECRYPT_FAIL' };
        }
    }

    /**
     * Checks the passphrase and returns the raw data key (extractable copy) so a new passkey slot can wrap it.
     * Adding an unlock method always needs the passphrase. The caller must zero the bytes when done.
     * @returns {Promise<{ success: true, dataKey: Uint8Array } | { success: false, error: string }>}
     */
    async exportDataKey(passphrase, deviceSecret = null) {
        const blob = this.readBlob();
        if (!blob || blob.v !== VAULT_FORMAT) return { success: false, error: 'ERR_NO_VAULT' };
        if (blob.kdf === KDF_KEYCHAIN && !deviceSecret) return { success: false, error: 'ERR_KEYCHAIN_REQUIRED' };
        try {
            const kek = await this.passphraseKey(passphrase, new Uint8Array(blob.salt), blob.kdf, deviceSecret, ['wrapKey', 'unwrapKey']);
            const dataKey = await this.unwrapDataKey(blob.passphrase, kek, true);
            return { success: true, dataKey: new Uint8Array(await subtle().exportKey('raw', dataKey)) };
        } catch (e) {
            return { success: false, error: 'ERR_VAULT_DECRYPT_FAIL' };
        }
    }

    /**
     * Stores a passkey slot: the data key wrapped with a key derived from the passkey's PRF output.
     * @param {Uint8Array} rawDataKey from exportDataKey
     * @param {{ id: string, label: string, prfSalt: number[] }} passkey credential id (base64url), name, PRF input
     * @param {Uint8Array} prfOutput
     */
    async addPasskeySlot(rawDataKey, passkey, prfOutput, deviceSecret = null) {
        const blob = this.readBlob();
        const dataKey = await subtle().importKey('raw', rawDataKey, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
        const slot = await this.wrapDataKey(dataKey, await this.passkeyKey(prfOutput, deviceSecret));
        blob.passkeys = (blob.passkeys || []).filter(p => p.id !== passkey.id)
            .concat({ id: passkey.id, label: passkey.label, created: Date.now(), prfSalt: passkey.prfSalt, ...slot });
        this.writeBlob(blob);
    }

    removePasskeySlot(id) {
        const blob = this.readBlob();
        if (!blob || blob.v !== VAULT_FORMAT) return;
        blob.passkeys = (blob.passkeys || []).filter(p => p.id !== id);
        this.writeBlob(blob);
    }

    /** PRF inputs per enrolled passkey, for the WebAuthn request: { [credentialId]: Uint8Array }. */
    passkeyPrfSalts() {
        const blob = this.readBlob();
        if (!blob || blob.v !== VAULT_FORMAT) return {};
        return Object.fromEntries((blob.passkeys || []).map(p => [p.id, new Uint8Array(p.prfSalt)]));
    }

    /** Unlocks with an enrolled passkey's PRF output. */
    async unlockWithPasskey(credentialId, prfOutput, deviceSecret = null) {
        const blob = this.readBlob();
        const slot = blob && blob.v === VAULT_FORMAT && (blob.passkeys || []).find(p => p.id === credentialId);
        if (!slot) return { success: false, error: 'ERR_PASSKEY_UNKNOWN' };
        if (blob.kdf === KDF_KEYCHAIN && !deviceSecret) return { success: false, error: 'ERR_KEYCHAIN_REQUIRED' };
        try {
            const dataKey = await this.unwrapDataKey(slot, await this.passkeyKey(prfOutput, deviceSecret), true);
            await this.useDataKey(dataKey, blob.kdf);
            return { success: true, kdf: blob.kdf };
        } catch (e) {
            console.error('[ERR 2001] Decryption failed: passkey did not match.');
            return { success: false, error: 'ERR_VAULT_DECRYPT_FAIL' };
        }
    }

    async encryptAndStore(payload) {
        if (!this.isUnlocked || !this.masterKey) {
            throw new Error('[ERR 1001] Keychain locked. Cannot write to storage.');
        }
        const iv = random(12);
        const ciphertext = await subtle().encrypt({ name: 'AES-GCM', iv }, this.masterKey, new TextEncoder().encode(JSON.stringify(payload)));
        const blob = this.readBlob();
        blob.iv = Array.from(iv);
        blob.ciphertext = Array.from(new Uint8Array(ciphertext));
        this.writeBlob(blob);
        return true;
    }

    async retrieveAndDecrypt() {
        const blob = this.readBlob();
        if (!blob || !blob.ciphertext) return null;
        try {
            const decrypted = await subtle().decrypt({ name: 'AES-GCM', iv: new Uint8Array(blob.iv) }, this.masterKey, new Uint8Array(blob.ciphertext));
            return JSON.parse(new TextDecoder().decode(decrypted));
        } catch (error) {
            console.error('[ERR 2001] Decryption failed:', error);
            throw new Error('ERR_VAULT_DECRYPT_FAIL');
        }
    }

    /** Encrypts a payload with the data key for keeping in memory only (nothing is written to storage). */
    async seal(payload) {
        if (!this.isUnlocked || !this.masterKey) throw new Error('[ERR 1001] Keychain locked. Cannot seal.');
        const iv = random(12);
        const ciphertext = await subtle().encrypt({ name: 'AES-GCM', iv }, this.masterKey, new TextEncoder().encode(JSON.stringify(payload)));
        return { iv, ciphertext };
    }

    /** Opens a payload from seal() with the data key (the same key after any unlock of this vault). */
    async unseal(sealed) {
        if (!this.isUnlocked || !this.masterKey) throw new Error('[ERR 1001] Keychain locked. Cannot unseal.');
        const plain = await subtle().decrypt({ name: 'AES-GCM', iv: sealed.iv }, this.masterKey, sealed.ciphertext);
        return JSON.parse(new TextDecoder().decode(plain));
    }

    // Drops the data key from memory but keeps the encrypted vault on disk.
    lock() {
        this.masterKey = null;
        this.kdf = null;
        this.isUnlocked = false;
        return { status: 'LOCKED' };
    }

    zeroFillWipe() {
        this.lock();
        localStorage.removeItem(this.storageKey);
        return { status: 'WIPED', code: '3001_CLEARED' };
    }
}

export const secureVault = new SecureStorageVault();
