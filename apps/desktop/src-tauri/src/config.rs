use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

pub const CONFIG_VERSION: u32 = 2;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ServerMode {
    Remote,
    Local,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopConfig {
    pub version: u32,
    pub configured: bool,
    pub mode: ServerMode,
    pub remote_url: String,
    pub local_url: String,
    pub auto_start: bool,
    pub start_minimized: bool,
    pub close_to_tray: bool,
    pub notifications: bool,
    pub shortcuts_enabled: bool,
}

impl Default for DesktopConfig {
    fn default() -> Self {
        Self {
            version: CONFIG_VERSION,
            configured: false,
            mode: ServerMode::Local,
            remote_url: String::new(),
            local_url: "http://localhost:8080".to_string(),
            auto_start: false,
            start_minimized: false,
            close_to_tray: true,
            notifications: true,
            shortcuts_enabled: true,
        }
    }
}

impl DesktopConfig {
    pub fn server_url(&self) -> String {
        match self.mode {
            ServerMode::Remote => self.remote_url.trim_end_matches('/').to_string(),
            ServerMode::Local => self.local_url.trim_end_matches('/').to_string(),
        }
    }
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("无法定位配置目录：{error}"))?;
    std::fs::create_dir_all(&dir).map_err(|error| format!("无法创建配置目录：{error}"))?;
    Ok(dir.join("config.json"))
}

pub fn load_config(app: &AppHandle) -> DesktopConfig {
    let Ok(path) = config_path(app) else {
        return DesktopConfig::default();
    };
    let Ok(raw) = std::fs::read_to_string(path) else {
        return DesktopConfig::default();
    };
    let mut config: DesktopConfig = serde_json::from_str(&raw).unwrap_or_default();
    config.version = CONFIG_VERSION;
    config
}

pub fn save_config(app: &AppHandle, config: &DesktopConfig) -> Result<(), String> {
    let path = config_path(app)?;
    let raw =
        serde_json::to_string_pretty(config).map_err(|error| format!("配置序列化失败：{error}"))?;
    let temporary = path.with_extension("json.tmp");
    std::fs::write(&temporary, raw).map_err(|error| format!("无法写入配置：{error}"))?;
    std::fs::rename(&temporary, &path).map_err(|error| format!("无法保存配置：{error}"))?;
    Ok(())
}

pub fn validate_server_url(raw: &str) -> Result<String, String> {
    let value = raw.trim().trim_end_matches('/');
    if value.is_empty() {
        return Err("请填写服务器地址".to_string());
    }
    let parsed = url::Url::parse(value).map_err(|_| "服务器地址格式不正确".to_string())?;
    match parsed.scheme() {
        "http" | "https" => {}
        _ => return Err("服务器地址必须以 http:// 或 https:// 开头".to_string()),
    }
    if parsed.host_str().unwrap_or_default().is_empty() {
        return Err("服务器地址缺少主机名".to_string());
    }
    Ok(value.to_string())
}

pub fn describe_network_error(error: &reqwest::Error) -> String {
    let text = error.to_string();
    let lower = text.to_lowercase();
    if lower.contains("certificate") || lower.contains("cert") {
        return "证书不受信任：请安装服务器根证书，或使用受信任的 HTTPS 证书".to_string();
    }
    if lower.contains("connection refused") || lower.contains("connect") {
        return "连接被拒绝：请确认服务已启动、端口正确".to_string();
    }
    if lower.contains("dns") || lower.contains("name") {
        return "无法解析服务器地址".to_string();
    }
    if lower.contains("timed out") || lower.contains("timeout") {
        return "连接超时：请检查服务器地址和网络".to_string();
    }
    text.chars().take(240).collect()
}
