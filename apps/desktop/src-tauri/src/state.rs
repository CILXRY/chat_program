use crate::capture::CaptureSession;
use crate::config::DesktopConfig;
use crate::types::{ShortcutStatus, UpdateState};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::Mutex;
use std::time::Instant;
use tauri_plugin_global_shortcut::Shortcut;

pub struct AppState {
    pub config: Mutex<DesktopConfig>,
    pub shortcuts: Mutex<Vec<ShortcutStatus>>,
    pub shortcut_map: Mutex<HashMap<Shortcut, crate::types::ShortcutAction>>,
    pub update: Mutex<UpdateState>,
    pub update_download: Mutex<Option<PathBuf>>,
    pub last_update_check: Mutex<Option<Instant>>,
    pub capture: Mutex<Option<CaptureSession>>,
    pub quitting: AtomicBool,
    pub tray_available: AtomicBool,
}

impl AppState {
    pub fn new(config: DesktopConfig) -> Self {
        Self {
            config: Mutex::new(config),
            shortcuts: Mutex::new(Vec::new()),
            shortcut_map: Mutex::new(HashMap::new()),
            update: Mutex::new(UpdateState::default()),
            update_download: Mutex::new(None),
            last_update_check: Mutex::new(None),
            capture: Mutex::new(None),
            quitting: AtomicBool::new(false),
            tray_available: AtomicBool::new(false),
        }
    }
}
