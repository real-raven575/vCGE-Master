//! vCGE desktop shell (Tauri v2).
//! Created by raven575, Herd of Helpers (claude) & gemini.
//!
//! The vault is memory only, so nothing is kept in the OS credential store. Builds before that bound the saved
//! vault to a random device key in the macOS Keychain, Windows Credential Manager or Linux Secret Service; the web
//! side calls `delete_device_secret` at startup when it finds such an old vault, so the key is removed too.

use keyring::Entry;
use std::sync::atomic::{AtomicBool, Ordering};

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

/// Quick Scan (raven575, 2026-11-24): vCGE started with --quick-scan (the Windows "vCGE Quick Scan" Start entry, the
/// Linux right-click "Quick Scan" action) opens straight into Quick Scan. The page asks once as it starts.
static QUICK_SCAN: AtomicBool = AtomicBool::new(false);
const QUICK_SCAN_ARG: &str = "--quick-scan";

/// True when the command line (after the program's own name) asks for Quick Scan.
fn quick_requested<I: IntoIterator<Item = String>>(args: I) -> bool {
    args.into_iter().skip(1).any(|a| a == QUICK_SCAN_ARG)
}

/// True once if vCGE was started for Quick Scan; false after that and otherwise.
#[tauri::command]
fn quick_launch() -> bool {
    QUICK_SCAN.swap(false, Ordering::SeqCst)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    QUICK_SCAN.store(quick_requested(std::env::args()), Ordering::SeqCst);
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![delete_device_secret, quick_launch])
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
    fn quick_scan_only_from_its_own_word_after_the_program_name() {
        let args = |list: &[&str]| list.iter().map(|a| a.to_string()).collect::<Vec<_>>();
        assert!(quick_requested(args(&["vcge", "--quick-scan"])));
        assert!(!quick_requested(args(&["vcge"])));
        assert!(!quick_requested(args(&["--quick-scan"])));
        assert!(!quick_requested(args(&["vcge", "--quick-scan=1"])));
    }

    #[test]
    fn quick_launch_answers_true_once() {
        QUICK_SCAN.store(true, Ordering::SeqCst);
        assert!(quick_launch());
        assert!(!quick_launch());
    }

    #[test]
    fn delete_without_a_key_is_fine() {
        let entry = mock_entry();
        delete_secret(&entry).expect("delete with nothing stored");
        delete_secret(&entry).expect("and again");
    }
}
