/**
 * vCGE-MOD02: OS keychain bridge
 * Created by raven575, Gemini & Claude
 *
 * In the Tauri desktop app, a random 256-bit device key lives in the OS credential store
 * (src-tauri/src/lib.rs). In a plain browser there is no keychain and these return null / false.
 */

function tauriInvoke() {
    return window.__TAURI__ && window.__TAURI__.core && typeof window.__TAURI__.core.invoke === 'function'
        ? window.__TAURI__.core.invoke
        : null;
}

export function isKeychainAvailable() {
    return tauriInvoke() !== null;
}

/**
 * @param {boolean} create true only when creating a new vault; unlocking never creates a key
 * @returns {Promise<Uint8Array|null>} the device key, or null outside Tauri
 * @throws 'DEVICE_KEY_MISSING' when unlocking and the keychain has no key for this app
 */
export async function getDeviceSecret(create = false) {
    const invoke = tauriInvoke();
    if (!invoke) return null;
    const b64 = await invoke('device_secret', { create });
    return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

/** Deletes the device key (wipe). Resolves even outside Tauri. */
export async function deleteDeviceSecret() {
    const invoke = tauriInvoke();
    if (invoke) await invoke('delete_device_secret');
}
