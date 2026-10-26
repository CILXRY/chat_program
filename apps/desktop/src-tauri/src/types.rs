use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy)]
pub enum ShortcutAction {
    ToggleMute,
    LeaveVoice,
    ToggleWindow,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutStatus {
    pub accelerator: String,
    pub label: String,
    pub action: String,
    pub registered: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum UpdateStatus {
    Idle,
    Checking,
    Available,
    Downloading,
    Downloaded,
    NotAvailable,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateState {
    pub status: UpdateStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub percent: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

impl Default for UpdateState {
    fn default() -> Self {
        Self {
            status: UpdateStatus::Idle,
            version: None,
            percent: None,
            message: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsSnapshot {
    pub version: u32,
    pub configured: bool,
    pub mode: crate::config::ServerMode,
    pub remote_url: String,
    pub local_url: String,
    pub auto_start: bool,
    pub start_minimized: bool,
    pub close_to_tray: bool,
    pub notifications: bool,
    pub shortcuts_enabled: bool,
    pub app_version: String,
    pub server_url: String,
    pub update: UpdateState,
    pub shortcuts: Vec<ShortcutStatus>,
    pub platform: String,
    pub packaged: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsPayload {
    pub mode: crate::config::ServerMode,
    pub remote_url: String,
    pub local_url: String,
    pub auto_start: bool,
    pub start_minimized: bool,
    pub close_to_tray: bool,
    pub notifications: bool,
    pub shortcuts_enabled: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveSettingsResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snapshot: Option<SettingsSnapshot>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestServerResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureInfo {
    pub ws_url: String,
    pub token: String,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub hdr: bool,
    pub audio: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioOutputInfo {
    pub label: String,
    pub is_headphones: bool,
    pub is_speakers: bool,
}
