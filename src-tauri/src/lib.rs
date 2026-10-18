//! vCGE desktop shell (Tauri v2).
//! Created by raven575, Team vCGE (Claude) & Gemini.
//!
//! The vault is memory only, so nothing is kept in the OS credential store. Builds before that bound the saved
//! vault to a random device key in the macOS Keychain, Windows Credential Manager or Linux Secret Service; the web
//! side calls `delete_device_secret` at startup when it finds such an old vault, so the key is removed too.

use keyring::Entry;

const SERVICE: &str = "com.vcge.app";
const ACCOUNT: &str = "vault-device-key";

fn device_entry() -> Result<Entry, String> {
    Entry::new(SERVICE, ACCOUNT).map_err(|e| format!("keychain unavailable: {e}"))
}

fn delete_secret(entry: &Entry) -> Result<(), String> {
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("could not delete device key: {e}")),
    }
}

/// Removes the old device key; a missing key is not an error.
#[tauri::command]
fn delete_device_secret() -> Result<(), String> {
    delete_secret(&device_entry()?)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![delete_device_secret])
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
    fn deletes_an_old_device_key() {
        let entry = mock_entry();
        entry.set_secret(&[7u8; 32]).unwrap();
        delete_secret(&entry).expect("delete");
        assert!(matches!(entry.get_secret(), Err(keyring::Error::NoEntry)));
    }

    #[test]
    fn delete_without_a_key_is_fine() {
        let entry = mock_entry();
        delete_secret(&entry).expect("delete with nothing stored");
        delete_secret(&entry).expect("and again");
    }
}
