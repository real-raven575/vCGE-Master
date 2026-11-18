/**
 * vCGE-MOD02: biometric unlock (Face ID, Touch ID, fingerprint, Windows Hello)
 * Created by raven575, Herd of Helpers (claude) & gemini
 *
 * A second way to unlock the card after a lock, next to the session PIN. It uses the device's own authenticator through
 * WebAuthn, on the device only: no network, no server. Enrolling creates a credential for this site on the device; the
 * app keeps its id and public key in memory for this session only, so each session enrolls afresh and nothing about
 * it is saved by vCGE. (The device may keep the credential in its own password manager; it holds no contact data.)
 * Unlocking asks the device to sign a fresh random challenge after it has checked the user's face or fingerprint, and
 * the signature is verified here against the public key from enrolment.
 *
 * In the Android app the WebView offers pages no WebAuthn (raven575's Android run, 2026-11-16: a PIN was set, but no
 * fingerprint option showed), so there the app's own bridge (MainActivity.kt's vcgeAndroid.fingerprint*) stands in: a
 * key pair made in the phone's secure hardware for this session, whose private half signs only after a strong
 * fingerprint (or face) check. The public half comes here, and each unlock signs a fresh random challenge that is
 * verified here, as with WebAuthn. The key is deleted when this is cleared and at every app start.
 */

const subtle = () => window.crypto.subtle;
const random = (n) => window.crypto.getRandomValues(new Uint8Array(n));
const TIMEOUT_MS = 60000;
const ES256 = -7;
const RS256 = -257;
const FLAG_USER_PRESENT = 0x01;
const FLAG_USER_VERIFIED = 0x04;

export function base64url(bytes) {
    let s = '';
    new Uint8Array(bytes).forEach((b) => { s += String.fromCharCode(b); });
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** ECDSA signatures from authenticators are DER-encoded; WebCrypto wants the raw 64-byte r || s. */
export function derToRaw(der) {
    const d = new Uint8Array(der);
    if (d[0] !== 0x30) throw new Error('BIOMETRIC_BAD_SIGNATURE');
    let i = 2;
    const part = () => {
        if (d[i] !== 0x02) throw new Error('BIOMETRIC_BAD_SIGNATURE');
        const len = d[i + 1];
        let v = d.slice(i + 2, i + 2 + len);
        i += 2 + len;
        while (v.length > 32 && v[0] === 0) v = v.slice(1);
        if (v.length > 32) throw new Error('BIOMETRIC_BAD_SIGNATURE');
        const out = new Uint8Array(32);
        out.set(v, 32 - v.length);
        return out;
    };
    const r = part(), s = part();
    const raw = new Uint8Array(64);
    raw.set(r, 0);
    raw.set(s, 32);
    return raw;
}

const concat = (a, b) => {
    const out = new Uint8Array(a.byteLength + b.byteLength);
    out.set(new Uint8Array(a), 0);
    out.set(new Uint8Array(b), a.byteLength);
    return out;
};

const sameBytes = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/** The Android app's fingerprint bridge, or null in a browser or the desktop app. */
export function nativeFingerprint() {
    const bridge = typeof window !== 'undefined' ? window.vcgeAndroid : null;
    return bridge && ['fingerprintStatus', 'fingerprintSetUp', 'fingerprintSign', 'fingerprintClear'].every((f) => typeof bridge[f] === 'function')
        ? bridge : null;
}

const toBase64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const fromBase64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

/** Checks the Android bridge's signature (DER ECDSA P-256 over the raw challenge). Pure apart from WebCrypto. */
export async function verifyNativeSignature(publicKey, challenge, der) {
    try {
        return await subtle().verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, derToRaw(der), challenge);
    } catch (e) {
        return false;
    }
}

// Answers from the Android prompt arrive later, through window.__vcgeFingerprintDone(id, status, signature).
const pendingSigns = new Map();
function signWithBridge(bridge, challenge) {
    return new Promise((resolve) => {
        const id = base64url(random(9));
        const finish = (status, signature = '') => {
            if (!pendingSigns.has(id)) return;
            pendingSigns.delete(id);
            clearTimeout(timer);
            resolve({ status, signature });
        };
        const timer = setTimeout(() => finish('timed out'), TIMEOUT_MS);
        pendingSigns.set(id, finish);
        window.__vcgeFingerprintDone = (doneId, status, signature) => { const f = pendingSigns.get(doneId); if (f) f(status, signature); };
        let started = false;
        try { started = bridge.fingerprintSign(id, toBase64(challenge), 'Unlock vCGE') === true; } catch (e) { started = false; }
        if (!started) finish('unavailable');
    });
}

/** True when this device can check a face or fingerprint for web pages (a platform authenticator), or, in the Android
 * app, when the phone has a strong fingerprint check set up. */
export async function biometricAvailable(bridge = nativeFingerprint()) {
    if (bridge) {
        try { return bridge.fingerprintStatus() === 'ok'; } catch (e) { return false; }
    }
    try {
        return typeof PublicKeyCredential !== 'undefined'
            && typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function'
            && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch (e) {
        return false;
    }
}

/**
 * Checks one WebAuthn assertion against the enrolled credential. Pure apart from WebCrypto, so it is unit-tested.
 * @returns {Promise<boolean>}
 */
export async function verifyAssertion({ publicKey, algorithm, challenge, origin, rpId, authenticatorData, clientDataJSON, signature }) {
    let client;
    try {
        client = JSON.parse(new TextDecoder().decode(clientDataJSON));
    } catch (e) {
        return false;
    }
    if (client.type !== 'webauthn.get' || client.challenge !== base64url(challenge) || client.origin !== origin) return false;
    const auth = new Uint8Array(authenticatorData);
    if (auth.length < 37) return false;
    const rpIdHash = new Uint8Array(await subtle().digest('SHA-256', new TextEncoder().encode(rpId)));
    if (!sameBytes(auth.slice(0, 32), rpIdHash)) return false;
    const flags = auth[32];
    if (!(flags & FLAG_USER_PRESENT) || !(flags & FLAG_USER_VERIFIED)) return false;
    const signed = concat(auth, await subtle().digest('SHA-256', clientDataJSON));
    try {
        if (algorithm === ES256) {
            return await subtle().verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, derToRaw(signature), signed);
        }
        return await subtle().verify({ name: 'RSASSA-PKCS1-v1_5' }, publicKey, signature, signed);
    } catch (e) {
        return false;
    }
}

export class BiometricUnlock {
    /** @param {{ bridge?: object|null }} [options] the Android bridge (found on the page when left out; null = none) */
    constructor({ bridge } = {}) {
        this.credential = null;   // { id, publicKey, algorithm, native } for this session only
        this.lastError = null;    // why the last check failed (an error name such as NotAllowedError), never any data
        this.fixedBridge = bridge;
    }

    get bridge() {
        return this.fixedBridge !== undefined ? this.fixedBridge : nativeFingerprint();
    }

    isEnrolled() {
        return this.credential !== null;
    }

    /** Asks the device to create a credential (the user confirms with face or fingerprint). Throws if cancelled. */
    async enroll() {
        const bridge = this.bridge;
        if (bridge) {
            let spki = '';
            try { spki = bridge.fingerprintSetUp(); } catch (e) { spki = ''; }
            if (!spki) throw new Error('BIOMETRIC_UNSUPPORTED');
            const publicKey = await subtle().importKey('spki', fromBase64(spki), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
            this.credential = { id: null, publicKey, algorithm: ES256, native: true };
            return;
        }
        const created = await navigator.credentials.create({
            publicKey: {
                rp: { name: 'vCGE' },
                user: { id: random(16), name: 'vCGE session', displayName: 'vCGE session unlock' },
                challenge: random(32),
                pubKeyCredParams: [{ type: 'public-key', alg: ES256 }, { type: 'public-key', alg: RS256 }],
                authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged', requireResidentKey: false },
                attestation: 'none',
                timeout: TIMEOUT_MS
            }
        });
        const response = created && created.response;
        if (!response || typeof response.getPublicKey !== 'function') throw new Error('BIOMETRIC_UNSUPPORTED');
        const algorithm = response.getPublicKeyAlgorithm();
        const params = algorithm === ES256 ? { name: 'ECDSA', namedCurve: 'P-256' }
            : algorithm === RS256 ? { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' } : null;
        if (!params) throw new Error('BIOMETRIC_UNSUPPORTED');
        const publicKey = await subtle().importKey('spki', response.getPublicKey(), params, false, ['verify']);
        this.credential = { id: new Uint8Array(created.rawId), publicKey, algorithm };
    }

    /** Asks the device to check the user; true only for a valid signature from the enrolled credential. */
    async verify() {
        this.lastError = null;
        if (!this.credential) { this.lastError = 'not set up'; return false; }
        const challenge = random(32);
        if (this.credential.native) {
            const bridge = this.bridge;
            if (!bridge) { this.lastError = 'unavailable'; return false; }
            const { status, signature } = await signWithBridge(bridge, challenge);
            if (status !== 'ok') {
                this.lastError = status === 'changed' ? 'fingerprints changed, add it again' : status;
                if (status === 'changed') this.credential = null;
                return false;
            }
            const valid = await verifyNativeSignature(this.credential.publicKey, challenge, fromBase64(signature));
            if (!valid) this.lastError = 'signature not valid';
            return valid;
        }
        let assertion;
        try {
            assertion = await navigator.credentials.get({
                publicKey: {
                    challenge,
                    allowCredentials: [{ type: 'public-key', id: this.credential.id }],
                    userVerification: 'required',
                    timeout: TIMEOUT_MS
                }
            });
        } catch (e) {
            this.lastError = (e && e.name) || 'unknown error';   // cancelled, timed out or not recognised
            return false;
        }
        if (!assertion || !sameBytes(new Uint8Array(assertion.rawId), this.credential.id)) { this.lastError = 'other passkey'; return false; }
        const valid = await verifyAssertion({
            publicKey: this.credential.publicKey,
            algorithm: this.credential.algorithm,
            challenge,
            origin: window.location.origin,
            rpId: window.location.hostname,
            authenticatorData: assertion.response.authenticatorData,
            clientDataJSON: assertion.response.clientDataJSON,
            signature: assertion.response.signature
        });
        if (!valid) this.lastError = 'signature not valid';
        return valid;
    }

    clear() {
        if (this.credential && this.credential.native) {
            try { const bridge = this.bridge; if (bridge) bridge.fingerprintClear(); } catch (e) { /* the key also goes at the next start */ }
        }
        this.credential = null;
    }
}
