/**
 * vCGE (vCard Generator Engine) - AES-256 / WebCrypto Encryption Helpers (`cryptoUtils.js`)
 * Project Overseer Authorized Production Build
 * Attributions: Created by raven575 and Gemini
 */

export const CryptoUtils = {
    async encryptVault(payload, secretKey = 'vCGE-Secure-Vault-Master') {
        const encoder = new TextEncoder();
        const data = encoder.encode(JSON.stringify(payload));

        const iv = window.crypto.getRandomValues(new Uint8Array(12));
        const keyMaterial = await window.crypto.subtle.importKey(
            "raw",
            encoder.encode(secretKey.padEnd(32, '0').slice(0, 32)),
            { name: "AES-GCM" },
            false,
            ["encrypt"]
        );

        const encrypted = await window.crypto.subtle.encrypt(
            { name: "AES-GCM", iv },
            keyMaterial,
            data
        );

        return {
            cipher: Array.from(new Uint8Array(encrypted)),
            iv: Array.from(iv)
        };
    },

    async decryptVault(encryptedObj, secretKey = 'vCGE-Secure-Vault-Master') {
        try {
            const encoder = new TextEncoder();
            const keyMaterial = await window.crypto.subtle.importKey(
                "raw",
                encoder.encode(secretKey.padEnd(32, '0').slice(0, 32)),
                { name: "AES-GCM" },
                false,
                ["decrypt"]
            );

            const decrypted = await window.crypto.subtle.decrypt(
                { name: "AES-GCM", iv: new Uint8Array(encryptedObj.iv) },
                keyMaterial,
                new Uint8Array(encryptedObj.cipher)
            );

            const decoder = new TextDecoder();
            return JSON.parse(decoder.decode(decrypted));
        } catch (e) {
            console.error("[vCGE-Crypto] Decryption failed:", e);
            return null;
        }
    }
};