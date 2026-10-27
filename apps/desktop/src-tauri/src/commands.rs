use crate::config::{
    describe_network_error, save_config, validate_server_url, DesktopConfig, ServerMode,
};
use crate::state::AppState;
use crate::types::{
    AudioOutputInfo, CaptureInfo, SaveSettingsResult, SettingsPayload, SettingsSnapshot,
    TestServerResult, UpdateState,
};
use crate::windows;
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;

pub fn snapshot(app: &AppHandle) -> SettingsSnapshot {
    let state = app.state::<AppState>();
    let config = state
        .config
        .lock()
        .map(|value| value.clone())
        .unwrap_or_default();
    let update = state
        .update
        .lock()
        .map(|value| value.clone())
        .unwrap_or_default();
    let shortcuts = state
        .shortcuts
        .lock()
        .map(|value| value.clone())
        .unwrap_or_default();

    SettingsSnapshot {
        version: config.version,
        configured: config.configured,
        mode: config.mode,
        remote_url: config.remote_url.clone(),
        local_url: config.local_url.clone(),
        auto_start: config.auto_start,
        start_minimized: config.start_minimized,
        close_to_tray: config.close_to_tray,
        notifications: config.notifications,
        shortcuts_enabled: config.shortcuts_enabled,
        app_version: app.package_info().version.to_string(),
        server_url: config.server_url(),
        update,
        shortcuts,
        platform: std::env::consts::OS.to_string(),
        packaged: !cfg!(debug_assertions),
    }
}

#[tauri::command]
pub fn settings_get(app: AppHandle) -> SettingsSnapshot {
    snapshot(&app)
}

#[tauri::command]
pub async fn settings_save(app: AppHandle, payload: SettingsPayload) -> SaveSettingsResult {
    let selected = match payload.mode {
        ServerMode::Remote => payload.remote_url.trim().trim_end_matches('/').to_string(),
        ServerMode::Local => payload.local_url.trim().trim_end_matches('/').to_string(),
    };
    if let Err(error) = validate_server_url(&selected) {
        return SaveSettingsResult {
            ok: false,
            error: Some(error),
            snapshot: None,
        };
    }

    let (previous, next) = {
        let state = app.state::<AppState>();
        let mut guard = match state.config.lock() {
            Ok(guard) => guard,
            Err(_) => {
                return SaveSettingsResult {
                    ok: false,
                    error: Some("配置状态已损坏".to_string()),
                    snapshot: None,
                }
            }
        };
        let previous = guard.clone();
        let next = DesktopConfig {
            version: crate::config::CONFIG_VERSION,
            configured: true,
            mode: payload.mode,
            remote_url: payload.remote_url.trim().trim_end_matches('/').to_string(),
            local_url: if payload.local_url.trim().is_empty() {
                previous.local_url.clone()
            } else {
                payload.local_url.trim().trim_end_matches('/').to_string()
            },
            auto_start: payload.auto_start,
            start_minimized: payload.start_minimized,
            close_to_tray: payload.close_to_tray,
            notifications: payload.notifications,
            shortcuts_enabled: payload.shortcuts_enabled,
        };
        *guard = next.clone();
        (previous, next)
    };

    if let Err(error) = save_config(&app, &next) {
        return SaveSettingsResult {
            ok: false,
            error: Some(error),
            snapshot: None,
        };
    }

    crate::autostart::apply(&app, next.auto_start);
    crate::shortcuts::register(&app);

    let needs_window =
        previous.server_url() != next.server_url() || app.get_webview_window("main").is_none();
    if needs_window {
        windows::create_main_window_async(&app, next.server_url(), true);
    }

    if let Some(settings) = app.get_webview_window("settings") {
        let _ = settings.hide();
    }

    SaveSettingsResult {
        ok: true,
        error: None,
        snapshot: Some(snapshot(&app)),
    }
}

#[tauri::command]
pub async fn settings_test_server(url: String) -> TestServerResult {
    let value = url.trim().trim_end_matches('/');
    if let Err(error) = validate_server_url(value) {
        return TestServerResult {
            ok: false,
            status: None,
            error: Some(error),
        };
    }

    let client = match reqwest::Client::builder()
        .user_agent("Nebula-Desktop")
        .timeout(Duration::from_secs(6))
        .build()
    {
        Ok(client) => client,
        Err(error) => {
            return TestServerResult {
                ok: false,
                status: None,
                error: Some(format!("无法初始化网络请求：{error}")),
            }
        }
    };

    match client.get(format!("{value}/api/health")).send().await {
        Ok(response) => {
            let status = response.status();
            if !status.is_success() {
                return TestServerResult {
                    ok: false,
                    status: Some(status.as_u16()),
                    error: Some(format!("服务器返回 HTTP {}", status.as_u16())),
                };
            }
            let payload: serde_json::Value = response.json().await.unwrap_or_default();
            if payload.get("status").and_then(|item| item.as_str()) != Some("ok") {
                return TestServerResult {
                    ok: false,
                    status: Some(status.as_u16()),
                    error: Some("服务器响应不是 Nebula API".to_string()),
                };
            }
            TestServerResult {
                ok: true,
                status: Some(status.as_u16()),
                error: None,
            }
        }
        Err(error) => TestServerResult {
            ok: false,
            status: None,
            error: Some(describe_network_error(&error)),
        },
    }
}

#[tauri::command]
pub fn settings_close(app: AppHandle) {
    if let Some(window) = app.get_webview_window("settings") {
        let _ = window.hide();
    }
}

#[tauri::command]
pub fn app_open_external(app: AppHandle, url: String) {
    if windows::is_safe_external_url(&url) {
        let _ = app.opener().open_url(&url, None::<&str>);
    }
}

#[tauri::command]
pub fn app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

#[tauri::command]
pub fn desktop_notify(app: AppHandle, title: String, body: String) {
    let enabled = app
        .state::<AppState>()
        .config
        .lock()
        .map(|config| config.notifications)
        .unwrap_or(false);
    if !enabled {
        return;
    }
    let _ = app.notification().builder().title(title).body(body).show();
}

#[tauri::command]
pub async fn desktop_open_settings(app: AppHandle) -> Result<(), String> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let window_app = app.clone();
    tauri::async_runtime::spawn(async move {
        let result = windows::open_settings(&window_app, false);
        let _ = sender.send(result);
    });
    match tokio::time::timeout(Duration::from_secs(5), receiver).await {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => Err("设置窗口任务已取消".to_string()),
        Err(_) => Err("打开设置窗口超时".to_string()),
    }
}

/// Clears the session cookie natively and sends the main window to /login.
/// This is the reliable fallback for the logout button: even if the HTTP
/// logout request or a page navigation is stuck, the HttpOnly cookie disappears.
#[tauri::command]
pub async fn desktop_logout(app: AppHandle) -> Result<bool, String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "主窗口不存在".to_string())?;
    let current = window.url().map_err(|error| error.to_string())?;
    if let Ok(cookies) = window.cookies_for_url(current.clone()) {
        for cookie in cookies {
            if cookie.name() == "nebula_token" {
                let _ = window.delete_cookie(cookie);
            }
        }
    }
    let login = current
        .join("/login")
        .map_err(|error| format!("无法构造登录地址：{error}"))?;
    window
        .navigate(login)
        .map_err(|error| format!("无法跳转登录页：{error}"))?;
    Ok(true)
}

#[tauri::command]
pub async fn updater_check(app: AppHandle) -> UpdateState {
    crate::updater::check(app).await
}

#[tauri::command]
pub fn updater_install(app: AppHandle) -> bool {
    crate::updater::install(&app)
}

#[tauri::command]
pub fn updater_state(app: AppHandle) -> UpdateState {
    app.state::<AppState>()
        .update
        .lock()
        .map(|value| value.clone())
        .unwrap_or_default()
}

#[tauri::command]
pub fn window_toggle(app: AppHandle) {
    windows::toggle_main_window_async(&app);
}

#[tauri::command]
pub fn audio_output_info() -> AudioOutputInfo {
    use ::windows::Win32::Media::Audio::PKEY_AudioEndpoint_FormFactor;
    use ::windows::Win32::System::Com::StructuredStorage::PropVariantClear;
    use ::windows::Win32::System::Com::STGM_READ;

    let _ = wasapi::initialize_mta();
    let mut label = String::new();
    let mut form_factor: Option<u32> = None;
    if let Ok(enumerator) = wasapi::DeviceEnumerator::new() {
        if let Ok(device) = enumerator.get_default_device(&wasapi::Direction::Render) {
            if let Ok(name) = device.get_friendlyname() {
                label = name;
            }
            if let Ok(store) = unsafe { device.as_immdevice().OpenPropertyStore(STGM_READ) } {
                if let Ok(mut value) = unsafe { store.GetValue(&PKEY_AudioEndpoint_FormFactor) } {
                    form_factor = Some(unsafe { value.Anonymous.Anonymous.Anonymous.ulVal });
                    let _ = unsafe { PropVariantClear(&mut value) };
                }
            }
        }
    }

    let lower = label.to_lowercase();
    let label_headphones = [
        "headphone",
        "headset",
        "earbud",
        "earphone",
        "airpod",
        "耳机",
        "耳麦",
        "耳麥",
        "头戴",
        "耳塞",
    ]
    .iter()
    .any(|marker| lower.contains(marker));
    let label_speakers = [
        "speaker",
        "扬声器",
        "揚聲器",
        "音箱",
        "display",
        "hdmi",
        "monitor",
        "显示器",
        "顯示器",
    ]
    .iter()
    .any(|marker| lower.contains(marker));

    // EndpointFormFactor: 3 headphones, 5 headset, 6 handset.
    // 1 speakers, 2 line level, 8 S/PDIF, 9 HDMI/display audio.
    let is_headphones = matches!(form_factor, Some(3 | 5 | 6)) || label_headphones;
    let is_speakers =
        !is_headphones && (matches!(form_factor, Some(1 | 2 | 7 | 8 | 9)) || label_speakers);

    AudioOutputInfo {
        label,
        is_headphones,
        is_speakers,
    }
}

#[tauri::command]
pub async fn capture_start(
    app: AppHandle,
    hdr: bool,
    source: Option<crate::capture::CaptureSource>,
    quality: Option<String>,
) -> Result<Option<CaptureInfo>, String> {
    if let Some(previous) = app
        .state::<AppState>()
        .capture
        .lock()
        .ok()
        .and_then(|mut value| value.take())
    {
        previous.request_stop();
    }

    let max_size = crate::capture::quality_size(quality.as_deref());
    let Some((info, session)) =
        crate::capture::start_capture(hdr, source.unwrap_or_default(), max_size).await?
    else {
        return Ok(None);
    };
    if let Ok(mut target) = app.state::<AppState>().capture.lock() {
        *target = Some(session);
    }
    Ok(Some(info))
}

#[tauri::command]
pub fn capture_stop(app: AppHandle) {
    if let Some(session) = app
        .state::<AppState>()
        .capture
        .lock()
        .ok()
        .and_then(|mut value| value.take())
    {
        session.request_stop();
    }
}
