use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt;

pub fn apply(app: &AppHandle, enabled: bool) {
    let manager = app.autolaunch();
    if enabled {
        if let Err(error) = manager.enable() {
            eprintln!("[autostart] enable failed: {error}");
        }
    } else if let Err(error) = manager.disable() {
        eprintln!("[autostart] disable failed: {error}");
    }
}
