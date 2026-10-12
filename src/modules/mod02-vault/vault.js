/**
 * vCard Generator Engine (vCGE)
 * Copyright (c) 2026 raven575 & Gemini
 *
 * Repository: https://github.com/real-raven575/vCGE-Master
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */

// Key-derivation schemes recorded in each vault blob.
export const KDF_PASSPHRASE = 'pbkdf2-sha256';                  // passphrase only (browser)
export const KDF_KEYCHAIN = 'pbkdf2-sha256+hkdf-device-key';    // passphrase + OS keychain device key (Tauri)
const PBKDF2_ITERATIONS = 100000;
const HKDF_INFO = new TextEncoder().encode('vCGE vault key v1');

export class SecureStorageVault {
    constructor(storageKey = 'vCGE_secure_vault.dat') {
        this.storageKey = storageKey;
        this.isUnlocked = false;
        this.masterKey = null;
        this.salt = null;
        this.kdf = null;
    }

    readBlob() {
        const raw = localStorage.getItem(this.storageKey);
        return raw ? JSON.parse(raw) : null;
    }

    // True when the stored vault was created with the OS keychain device key and cannot be opened without it.
    requiresDeviceKey() {
        const blob = this.readBlob();
        return !!blob && blob.kdf === KDF_KEYCHAIN;
    }

    /**
     * Derives the vault key. PBKDF2-SHA256 (100k iterations, stored salt) turns the passphrase into 256 bits.
     * With a device key (Tauri: OS keychain), those bits are mixed with it through HKDF-SHA256, so the vault
     * is bound to this device. Without one, the PBKDF2 bits are the AES-GCM-256 key (same bytes as before).
     * @param {string} passphrase
     * @param {Uint8Array|null} deviceSecret 32-byte device key, or null in a plain browser
     */
    async initialize(passphrase, deviceSecret = null) {
        try {
            const existing = this.readBlob();
            // Reuse the salt and scheme of an existing vault so the same inputs re-derive the same key after a restart.
            const kdf = existing ? (existing.kdf || KDF_PASSPHRASE) : (deviceSecret ? KDF_KEYCHAIN : KDF_PASSPHRASE);
            if (kdf === KDF_KEYCHAIN && !deviceSecret) {
                return { success: false, error: 'ERR_KEYCHAIN_REQUIRED' };
            }
            this.salt = existing && existing.salt ? new Uint8Array(existing.salt) : window.crypto.getRandomValues(new Uint8Array(16));

            const passKey = await window.crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), { name: 'PBKDF2' }, false, ['deriveBits']);
            const bits = await window.crypto.subtle.deriveBits(
                { name: 'PBKDF2', salt: this.salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
                passKey,
                256
            );

            if (kdf === KDF_KEYCHAIN) {
                const hkdfKey = await window.crypto.subtle.importKey('raw', bits, { name: 'HKDF' }, false, ['deriveKey']);
                this.masterKey = await window.crypto.subtle.deriveKey(
                    { name: 'HKDF', hash: 'SHA-256', salt: deviceSecret, info: HKDF_INFO },
                    hkdfKey,
                    { name: 'AES-GCM', length: 256 },
                    false,
                    ['encrypt', 'decrypt']
                );
            } else {
                this.masterKey = await window.crypto.subtle.importKey('raw', bits, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
            }

            this.kdf = kdf;
            this.isUnlocked = true;
            return { success: true, kdf, message: 'Vault initialized & derived successfully.' };
        } catch (error) {
            console.error('[ERR 2001] Vault derivation failed:', error);
            return { success: false, error: 'ERR_VAULT_DECRYPT_FAIL' };
        }
    }

    async encryptAndStore(payload) {
        if (!this.isUnlocked || !this.masterKey) {
            throw new Error('[ERR 1001] Keychain locked. Cannot write to storage.');
        }

        const encoder = new TextEncoder();
        const iv = window.crypto.getRandomValues(new Uint8Array(12));
        const encodedData = encoder.encode(JSON.stringify(payload));

        const ciphertext = await window.crypto.subtle.encrypt(
            { name: 'AES-GCM', iv: iv },
            this.masterKey,
            encodedData
        );

        const packageBlob = {
            kdf: this.kdf,
            iv: Array.from(iv),
            salt: Array.from(this.salt),
            ciphertext: Array.from(new Uint8Array(ciphertext))
        };

        localStorage.setItem(this.storageKey, JSON.stringify(packageBlob));
        return true;
    }

    async retrieveAndDecrypt() {
        const rawBlob = localStorage.getItem(this.storageKey);
        if (!rawBlob) return null;

        const packageBlob = JSON.parse(rawBlob);
        const iv = new Uint8Array(packageBlob.iv);
        const ciphertext = new Uint8Array(packageBlob.ciphertext);

        try {
            const decrypted = await window.crypto.subtle.decrypt(
                { name: 'AES-GCM', iv: iv },
                this.masterKey,
                ciphertext
            );

            const decoder = new TextDecoder();
            return JSON.parse(decoder.decode(decrypted));
        } catch (error) {
            console.error('[ERR 2001] Decryption failed:', error);
            throw new Error('ERR_VAULT_DECRYPT_FAIL');
        }
    }

    hasStoredVault() {
        return localStorage.getItem(this.storageKey) !== null;
    }

    // Drops the derived key from memory but keeps the encrypted vault on disk.
    lock() {
        this.masterKey = null;
        this.salt = null;
        this.kdf = null;
        this.isUnlocked = false;
        return { status: 'LOCKED' };
    }

    zeroFillWipe() {
        this.masterKey = null;
        this.salt = null;
        this.kdf = null;
        this.isUnlocked = false;
        localStorage.removeItem(this.storageKey);
        return { status: 'WIPED', code: '3001_CLEARED' };
    }
}

export const secureVault = new SecureStorageVault();