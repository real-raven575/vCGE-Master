//! vCGE desktop shell (Tauri v2).
//! Created by raven575, Gemini & Claude.
//!
//! Native side of the MOD02 vault: a random 256-bit device key kept in the OS credential store
//! (macOS Keychain, Windows Credential Manager/DPAPI, Linux Secret Service). The web vault mixes it
//! into its key derivation, so a copied vault file cannot be opened on another machine with the
//! passphrase alone. The key never leaves this device except to the app's own webview.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use keyring::Entry;

const SERVICE: &str = "com.vcge.app";
const ACCOUNT: &str = "vault-device-key";
const SECRET_LEN: usize = 32;

fn device_entry() -> Result<Entry, String> {
    Entry::new(SERVICE, ACCOUNT).map_err(|e| format!("keychain unavailable: {e}"))
}

/// Returns the device key stored in `entry`. When `create` is true (new vault) and none exists, a fresh
/// random key is stored first; when false (unlocking), a missing key is an error rather than silently replaced.
fn get_secret(entry: &Entry, create: bool) -> Result<Vec<u8>, String> {
    match entry.get_secret() {
        Ok(secret) if secret.len() == SECRET_LEN => Ok(secret),
        Ok(_) => Err("keychain entry has an unexpected length".into()),
        Err(keyring::Error::NoEntry) if !create => Err("DEVICE_KEY_MISSING".into()),
        Err(keyring::Error::NoEntry) => {
            let mut secret = vec![0u8; SECRET_LEN];
            getrandom::fill(&mut secret).map_err(|e| format!("no secure randomness: {e}"))?;
            entry
                .set_secret(&secret)
                .map_err(|e| format!("could not store device key: {e}"))?;
            Ok(secret)
        }
        Err(e) => Err(format!("could not read device key: {e}")),
    }
}

fn delete_secret(entry: &Entry) -> Result<(), String> {
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("could not delete device key: {e}")),
    }
}

/// Base64 device key for the vault's HKDF step. `create` is true only when a new vault is being created.
#[tauri::command]
fn device_secret(create: bool) -> Result<String, String> {
    get_secret(&device_entry()?, create).map(|secret| STANDARD.encode(secret))
}

/// Removes the device key (used by "Wipe vault"); missing keys are not an error.
#[tauri::command]
fn delete_device_secret() -> Result<(), String> {
    delete_secret(&device_entry()?)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![device_secret, delete_device_secret])
        .run(tauri::generate_context!())
        .expect("error while running vCGE");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mock_entry() -> Entry {
        keyring::set_default_credential_builder(keyring::mock::default_credential_builder());
        Entry::new(SERVICE, ACCOUNT).expect("mock entry")
    }

    #[test]
    fn creates_a_32_byte_secret_once_and_reuses_it() {
        let entry = mock_entry();
        let first = get_secret(&entry, true).expect("create");
        assert_eq!(first.len(), SECRET_LEN);
        let second = get_secret(&entry, true).expect("reuse");
        assert_eq!(first, second, "an existing device key must be returned unchanged");
    }

    #[test]
    fn secrets_are_random() {
        let a = get_secret(&mock_entry(), true).unwrap();
        let b = get_secret(&mock_entry(), true).unwrap();
        assert_ne!(a, b);
        assert!(a.iter().any(|&byte| byte != 0));
    }

    #[test]
    fn delete_is_idempotent_and_forces_a_new_key() {
        let entry = mock_entry();
        let first = get_secret(&entry, true).unwrap();
        delete_secret(&entry).expect("delete");
        delete_secret(&entry).expect("delete again is fine");
        let fresh = get_secret(&entry, true).unwrap();
        assert_ne!(first, fresh);
    }

    #[test]
    fn unlocking_never_creates_a_key() {
        let entry = mock_entry();
        assert_eq!(get_secret(&entry, false).unwrap_err(), "DEVICE_KEY_MISSING");
        let created = get_secret(&entry, true).unwrap();
        assert_eq!(get_secret(&entry, false).unwrap(), created);
    }

    #[test]
    fn rejects_a_corrupted_entry() {
        let entry = mock_entry();
        entry.set_secret(&[1, 2, 3]).unwrap();
        assert!(get_secret(&entry, true).is_err());
    }
}
