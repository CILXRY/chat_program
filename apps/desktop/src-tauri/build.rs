fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "settings_get",
            "settings_save",
            "settings_test_server",
            "settings_close",
            "app_open_external",
            "app_version",
            "desktop_notify",
            "desktop_open_settings",
            "window_toggle",
            "audio_output_info",
            "capture_start",
            "capture_stop",
            "updater_check",
            "updater_install",
            "updater_state",
        ]),
    ))
    .expect("failed to run tauri-build");
}
