/**
 * vCard Generator Engine (vCGE)
 * Copyright (c) 2026 raven575 & Gemini
 *
 * Repository: https://github.com/real-raven575/vCGE-Master
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */

export class SecureStorageVault {
    constructor(storageKey = 'vCGE_secure_vault.dat') {
        this.storageKey = storageKey;
        this.isUnlocked = false;
        this.masterKey = null;
        this.salt = null;
    }

    async initialize(passphrase) {
        try {
            const encoder = new TextEncoder();
            // Reuse the salt of an existing vault so the same passphrase re-derives the same key after a restart.
            const existing = localStorage.getItem(this.storageKey);
            const storedSalt = existing ? JSON.parse(existing).salt : null;
            this.salt = storedSalt ? new Uint8Array(storedSalt) : window.crypto.getRandomValues(new Uint8Array(16));
            
            const baseKey = await window.crypto.subtle.importKey(
                'raw',
                encoder.encode(passphrase),
                { name: 'PBKDF2' },
                false,
                ['deriveKey']
            );

            this.masterKey = await window.crypto.subtle.deriveKey(
                {
                    name: 'PBKDF2',
                    salt: this.salt,
                    iterations: 100000,
                    hash: 'SHA-256'
                },
                baseKey,
                { name: 'AES-GCM', length: 256 },
                true,
                ['encrypt', 'decrypt']
            );

            this.isUnlocked = true;
            return { success: true, message: 'Vault initialized & derived successfully.' };
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

    zeroFillWipe() {
        this.masterKey = null;
        this.salt = null;
        this.isUnlocked = false;
        localStorage.removeItem(this.storageKey);
        return { status: 'WIPED', code: '3001_CLEARED' };
    }
}

export const secureVault = new SecureStorageVault();