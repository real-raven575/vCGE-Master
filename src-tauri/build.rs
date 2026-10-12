fn main() {
    // Declare the app's commands so they are gated by capabilities (least privilege) instead of open to every window.
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&["device_secret", "delete_device_secret"]),
        ),
    )
    .expect("failed to run tauri-build");
}
