use crate::state::AppState;
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use tauri::webview::{PermissionKind, PermissionResponse};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

pub fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }
    let config = app
        .state::<AppState>()
        .config
        .lock()
        .map(|value| value.clone())
        .unwrap_or_default();
    if config.configured {
        if let Err(error) = create_main_window(app, &config.server_url(), true) {
            eprintln!("[window] failed to open main window: {error}");
        }
    } else {
        let _ = open_settings(app, true);
    }
}

pub fn toggle_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let visible = window.is_visible().unwrap_or(false);
        let focused = window.is_focused().unwrap_or(false);
        if visible && focused {
            let _ = window.hide();
        } else {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }
        return;
    }
    show_main_window(app);
}

pub fn create_main_window(app: &AppHandle, server_url: &str, show: bool) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window("main") {
        let _ = existing.destroy();
    }

    let parsed = url::Url::parse(server_url).map_err(|error| format!("服务器地址无效：{error}"))?;
    let allowed_origin = parsed.origin();
    let directory = data_directory(app, server_url)?;
    let app_handle = app.clone();

    let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(parsed))
        .title("Nebula")
        .inner_size(1360.0, 900.0)
        .min_inner_size(960.0, 640.0)
        .center()
        .visible(false)
        .data_directory(directory)
        .on_permission_request(|_webview, kind| match kind {
            PermissionKind::Microphone | PermissionKind::DisplayCapture => {
                PermissionResponse::Allow
            }
            _ => PermissionResponse::Default,
        })
        .on_navigation(move |target| {
            if target.origin() == allowed_origin {
                return true;
            }
            if is_safe_external_url(target.as_str()) {
                let _ = app_handle.opener().open_url(target.as_str(), None::<&str>);
            }
            false
        })
        .build()
        .map_err(|error| format!("无法创建主窗口：{error}"))?;

    if show {
        window.show().map_err(|error| error.to_string())?;
        let _ = window.set_focus();
    }
    Ok(())
}

pub fn open_settings(app: &AppHandle, first_run: bool) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("settings") {
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }

    let window =
        WebviewWindowBuilder::new(app, "settings", WebviewUrl::App("settings.html".into()))
            .title(if first_run {
                "欢迎使用 Nebula"
            } else {
                "Nebula 设置"
            })
            .inner_size(920.0, 920.0)
            .min_inner_size(760.0, 680.0)
            .center()
            .visible(false)
            .build()
            .map_err(|error| format!("无法创建设置窗口：{error}"))?;

    window.show().map_err(|error| error.to_string())?;
    let _ = window.set_focus();
    Ok(())
}

fn data_directory(app: &AppHandle, server_url: &str) -> Result<PathBuf, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位应用数据目录：{error}"))?
        .join("webview");
    let hash = Sha256::digest(server_url.trim_end_matches('/').as_bytes());
    let name: String = hash
        .iter()
        .take(8)
        .map(|byte| format!("{byte:02x}"))
        .collect();
    let directory = root.join(name);
    std::fs::create_dir_all(&directory)
        .map_err(|error| format!("无法创建 WebView 数据目录：{error}"))?;
    Ok(directory)
}

pub fn is_safe_external_url(raw: &str) -> bool {
    url::Url::parse(raw)
        .map(|url| matches!(url.scheme(), "http" | "https"))
        .unwrap_or(false)
}
