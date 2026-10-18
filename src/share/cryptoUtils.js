/**
 * vCGE (vCard Generator Engine) - AES-256 / WebCrypto Encryption Helpers (`cryptoUtils.js`)
 * Project Overseer Authorized Production Build
 * Attributions: Created by raven575, Team vCGE (Claude) & Gemini
 */

const PBKDF2_ITERATIONS = 100000;

// Derives an AES-GCM-256 key from a caller-supplied passphrase (PBKDF2-HMAC-SHA256). There is no default key.
async function deriveKey(passphrase, salt, usages) {
    if (typeof passphrase !== 'string' || passphrase.length === 0) {
        throw new Error('[vCGE-Crypto] A non-empty passphrase is required.');
    }
    const baseKey = await window.crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(passphrase),
        { name: "PBKDF2" },
        false,
        ["deriveKey"]
    );
    return window.crypto.subtle.deriveKey(
        { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
        baseKey,
        { name: "AES-GCM", length: 256 },
        false,
        usages
    );
}

export const CryptoUtils = {
    async encryptVault(payload, passphrase) {
        const salt = window.crypto.getRandomValues(new Uint8Array(16));
        const iv = window.crypto.getRandomValues(new Uint8Array(12));
        const key = await deriveKey(passphrase, salt, ["encrypt"]);

        const encrypted = await window.crypto.subtle.encrypt(
            { name: "AES-GCM", iv },
            key,
            new TextEncoder().encode(JSON.stringify(payload))
        );

        return {
            cipher: Array.from(new Uint8Array(encrypted)),
            iv: Array.from(iv),
            salt: Array.from(salt)
        };
    },

    async decryptVault(encryptedObj, passphrase) {
        try {
            const key = await deriveKey(passphrase, new Uint8Array(encryptedObj.salt), ["decrypt"]);
            const decrypted = await window.crypto.subtle.decrypt(
                { name: "AES-GCM", iv: new Uint8Array(encryptedObj.iv) },
                key,
                new Uint8Array(encryptedObj.cipher)
            );
            return JSON.parse(new TextDecoder().decode(decrypted));
        } catch (e) {
            console.error("[vCGE-Crypto] Decryption failed:", e);
            return null;
        }
    }
};
