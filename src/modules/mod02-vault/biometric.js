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
 * Same passkey every time (raven575's iPad run, 2026-11-20): enrolling always uses one fixed account id for this site, so
 * the device's password manager replaces the vCGE passkey it already has instead of adding another entry each time
 * the switch is turned on. The id names no person and holds no contact data.
 *
 * Per device (raven575's idea, same run): passkeyProfile() reads the kind of device. On an iPhone or iPad every
 * passkey check is a separate system sheet, so enrolling there does not ask a second time straight away (Chrome showed
 * "Passkey saved" and then a second "Sign In"); other devices still confirm once after enrolling.
 */

const subtle = () => window.crypto.subtle;
const random = (n) => window.crypto.getRandomValues(new Uint8Array(n));
const TIMEOUT_MS = 60000;
const ES256 = -7;
const RS256 = -257;
const FLAG_USER_PRESENT = 0x01;
const FLAG_USER_VERIFIED = 0x04;
/** The one account id every vCGE passkey uses on this site, so a new enrolment replaces the old passkey. */
export const PASSKEY_USER_ID = Object.freeze([...'vcge-session-unlock'].map((c) => c.charCodeAt(0)));

/**
 * The kind of device, from the browser's own description (nothing is stored):
 * 'apple-mobile' (iPhone, iPad, and an iPad that asks for desktop sites), 'android', 'windows', 'mac' or 'other'.
 * @param {{ userAgent?: string, platform?: string, maxTouchPoints?: number }} [nav]
 */
export function deviceKind(nav = typeof navigator !== 'undefined' ? navigator : {}) {
    const ua = String(nav.userAgent || ''), platform = String(nav.platform || '');
    if (/iPhone|iPad|iPod/.test(ua) || /iPhone|iPad|iPod/.test(platform)) return 'apple-mobile';
    if (/Macintosh|MacIntel/.test(ua + platform) && (nav.maxTouchPoints || 0) > 1) return 'apple-mobile';   // iPadOS desktop mode
    if (/Android/.test(ua)) return 'android';
    if (/Windows/.test(ua) || /^Win/.test(platform)) return 'windows';
    if (/Macintosh|MacIntel/.test(ua + platform)) return 'mac';
    return 'other';
}

/**
 * How passkeys are asked for on this kind of device.
 * confirmAfterEnroll: ask the device once more right after enrolling, so a device that enrols but cannot sign is not
 *   shown as "on". Off on iPhone and iPad, where that second ask is a second sheet to tap through.
 * hints: WebAuthn hints (browsers that do not know them ignore them): this device's own screen lock, not a phone or key.
 * tip: one line shown when the check fails, for where the passkey hides on that device.
 */
export function passkeyProfile(kind = deviceKind()) {
    const base = { kind, confirmAfterEnroll: true, hints: ['client-device'], tip: '' };
    if (kind === 'apple-mobile') {
        return { ...base, confirmAfterEnroll: false, tip: 'In Chrome, if the sheet says no passkeys are saved, tap "More from Chrome" and pick vCGE session.' };
    }
    return base;
}

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

/** True when this device can check a face or fingerprint for web pages (a platform authenticator). */
export async function biometricAvailable() {
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
    constructor(profile = passkeyProfile()) {
        this.credential = null;   // { id, publicKey, algorithm } for this session only
        this.lastError = null;    // why the last check failed (an error name such as NotAllowedError), never any data
        this.profile = profile;
        this.busy = null;         // the device sheet that is open now: a second tap waits for it instead of opening another
    }

    isEnrolled() {
        return this.credential !== null;
    }

    /** True when enrolling should be followed by one check (see passkeyProfile). */
    confirmAfterEnroll() {
        return this.profile.confirmAfterEnroll;
    }

    // One device sheet at a time: a second tap while one is open gets the same answer instead of a second sheet.
    #once(run) {
        if (!this.busy) this.busy = run().finally(() => { this.busy = null; });
        return this.busy;
    }

    /** Asks the device to create a credential (the user confirms with face or fingerprint). Throws if cancelled. */
    enroll() {
        return this.#once(() => this.#enroll());
    }

    async #enroll() {
        const created = await navigator.credentials.create({
            publicKey: {
                rp: { name: 'vCGE' },
                user: { id: Uint8Array.from(PASSKEY_USER_ID), name: 'vCGE session', displayName: 'vCGE session unlock' },
                challenge: random(32),
                pubKeyCredParams: [{ type: 'public-key', alg: ES256 }, { type: 'public-key', alg: RS256 }],
                authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged', requireResidentKey: false },
                attestation: 'none',
                hints: this.profile.hints,
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
    verify() {
        return this.#once(() => this.#verify());
    }

    async #verify() {
        this.lastError = null;
        if (!this.credential) { this.lastError = 'not set up'; return false; }
        const challenge = random(32);
        let assertion;
        try {
            assertion = await navigator.credentials.get({
                publicKey: {
                    challenge,
                    allowCredentials: [{ type: 'public-key', id: this.credential.id }],
                    userVerification: 'required',
                    hints: this.profile.hints,
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
        this.credential = null;
    }
}
