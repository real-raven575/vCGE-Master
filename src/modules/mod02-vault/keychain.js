/**
 * vCGE-MOD02: OS keychain clean-up
 * Created by raven575, Team vCGE (Claude) & Gemini
 *
 * Desktop builds before the memory-only vault kept a random device key in the OS credential store
 * (src-tauri/src/lib.rs) to bind the saved vault to the device. Nothing is saved now, so the key is only deleted:
 * at startup, when an old keychain-bound vault is found. In a plain browser this does nothing.
 */

function tauriInvoke() {
    return window.__TAURI__ && window.__TAURI__.core && typeof window.__TAURI__.core.invoke === 'function'
        ? window.__TAURI__.core.invoke
        : null;
}

/** Deletes the old device key. Resolves even outside Tauri or when there is no key. */
export async function deleteDeviceSecret() {
    const invoke = tauriInvoke();
    if (invoke) await invoke('delete_device_secret');
}
