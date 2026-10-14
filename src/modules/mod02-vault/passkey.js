/**
 * vCGE-MOD02: passkey quick unlock (WebAuthn PRF)
 * Created by raven575, Gemini & Claude
 *
 * A passkey unlocks the vault with whatever the device uses to verify its owner: Face ID or Touch ID (Apple),
 * Windows Hello (face, fingerprint or PIN), Android fingerprint or face unlock, or a security key. The PRF
 * extension makes the authenticator return 32 secret bytes for a given input, only after it has verified the user;
 * MOD02 derives the key that wraps the vault's data key from those bytes. There is no server: nothing is sent
 * anywhere, the challenge is random and only the PRF output matters. Passkeys are tied to the site's address
 * (a passkey made on one address does not appear on another) and need a secure context (https or localhost).
 */

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const random = (n) => window.crypto.getRandomValues(new Uint8Array(n));

export class PasskeyError extends Error {
    /** @param {'CANCELLED'|'PRF_UNSUPPORTED'|'UNSUPPORTED'|'FAILED'} code */
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}

/** True when this page can use passkeys at all (WebAuthn in a secure context). PRF support is only known after a try. */
export function isPasskeySupported() {
    return !!(window.isSecureContext && window.PublicKeyCredential && navigator.credentials && navigator.credentials.create);
}

function wrapError(e) {
    if (e instanceof PasskeyError) return e;
    if (e && (e.name === 'NotAllowedError' || e.name === 'AbortError')) return new PasskeyError('CANCELLED', 'The passkey request was cancelled or timed out.');
    if (e && e.name === 'NotSupportedError') return new PasskeyError('UNSUPPORTED', 'This device does not support passkeys here.');
    return new PasskeyError('FAILED', (e && e.message) || String(e));
}

const prfFirst = (credential) => {
    const prf = credential.getClientExtensionResults().prf;
    return prf && prf.results && prf.results.first ? new Uint8Array(prf.results.first) : null;
};

/**
 * Creates a passkey for this vault and evaluates its PRF.
 * @returns {Promise<{ id: string, prfSalt: number[], prfOutput: Uint8Array }>}
 * @throws {PasskeyError} PRF_UNSUPPORTED when the authenticator cannot produce the secret (it cannot unlock a vault)
 */
export async function createPasskey(label) {
    const prfSalt = random(32);
    let credential;
    try {
        credential = await navigator.credentials.create({
            publicKey: {
                rp: { name: 'vCGE' },
                user: { id: random(16), name: `vCGE vault (${label})`, displayName: `vCGE vault (${label})` },
                challenge: random(32),
                pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
                authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
                timeout: 120000,
                extensions: { prf: { eval: { first: prfSalt } } }
            }
        });
    } catch (e) {
        throw wrapError(e);
    }
    const prf = credential.getClientExtensionResults().prf;
    if (!prf || prf.enabled === false) {
        throw new PasskeyError('PRF_UNSUPPORTED', 'This passkey cannot unlock an encrypted vault (no PRF support).');
    }
    const id = b64url(credential.rawId);
    // Some platforms only return the PRF result when signing in, not at creation: ask once more.
    const prfOutput = prfFirst(credential) || (await getPasskeySecret({ [id]: prfSalt })).prfOutput;
    return { id, prfSalt: Array.from(prfSalt), prfOutput };
}

/**
 * Asks the user to verify with one of the enrolled passkeys and returns its PRF output.
 * @param {Object<string, Uint8Array>} saltsById PRF input per credential id (base64url)
 * @returns {Promise<{ id: string, prfOutput: Uint8Array }>}
 */
export async function getPasskeySecret(saltsById) {
    const ids = Object.keys(saltsById);
    let credential;
    try {
        credential = await navigator.credentials.get({
            publicKey: {
                challenge: random(32),
                allowCredentials: ids.map(id => ({ type: 'public-key', id: fromB64url(id) })),
                userVerification: 'required',
                timeout: 120000,
                extensions: { prf: { evalByCredential: Object.fromEntries(ids.map(id => [id, { first: saltsById[id] }])) } }
            }
        });
    } catch (e) {
        throw wrapError(e);
    }
    const prfOutput = prfFirst(credential);
    if (!prfOutput) throw new PasskeyError('PRF_UNSUPPORTED', 'This passkey did not return its unlock secret (no PRF support).');
    return { id: b64url(credential.rawId), prfOutput };
}
