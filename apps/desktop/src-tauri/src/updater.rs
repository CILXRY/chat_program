use crate::config::describe_network_error;
use crate::state::AppState;
use crate::types::{UpdateState, UpdateStatus};
use futures_util::StreamExt;
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

const RELEASES_API: &str = "https://api.github.com/repos/CILXRY/chat_program/releases/latest";

fn publish(app: &AppHandle, state: UpdateState) {
    if let Some(shared) = app.try_state::<AppState>() {
        if let Ok(mut target) = shared.update.lock() {
            *target = state.clone();
        }
    }
    let _ = app.emit("updater:state", &state);
}

pub async fn check(app: AppHandle) -> UpdateState {
    let current = app.package_info().version.to_string();
    let checking = UpdateState {
        status: UpdateStatus::Checking,
        version: None,
        percent: None,
        message: None,
    };
    publish(&app, checking);

    let client = match reqwest::Client::builder()
        .user_agent(format!("Nebula-Desktop/{current}"))
        .timeout(Duration::from_secs(30))
        .build()
    {
        Ok(client) => client,
        Err(error) => {
            let state = error_state(format!("无法初始化网络请求：{error}"));
            publish(&app, state.clone());
            return state;
        }
    };

    let response = match client.get(RELEASES_API).send().await {
        Ok(response) => response,
        Err(error) => {
            let state = error_state(describe_network_error(&error));
            publish(&app, state.clone());
            return state;
        }
    };

    if !response.status().is_success() {
        let state = error_state(format!("更新服务器返回 HTTP {}", response.status()));
        publish(&app, state.clone());
        return state;
    }

    let json: serde_json::Value = match response.json().await {
        Ok(json) => json,
        Err(error) => {
            let state = error_state(format!("无法解析更新信息：{error}"));
            publish(&app, state.clone());
            return state;
        }
    };

    let tag = json
        .get("tag_name")
        .and_then(|value| value.as_str())
        .unwrap_or("");
    let latest = tag.trim_start_matches('v').trim();
    if latest.is_empty() || !is_newer(latest, &current) {
        let state = UpdateState {
            status: UpdateStatus::NotAvailable,
            version: Some(current),
            percent: None,
            message: Some("当前已是最新版本".to_string()),
        };
        publish(&app, state.clone());
        return state;
    }

    let asset_url = json
        .get("assets")
        .and_then(|value| value.as_array())
        .and_then(|assets| {
            assets.iter().find_map(|asset| {
                let name = asset.get("name").and_then(|value| value.as_str())?;
                let lower = name.to_lowercase();
                if lower.ends_with(".exe") && lower.contains("setup") {
                    asset
                        .get("browser_download_url")
                        .and_then(|value| value.as_str())
                        .map(|value| value.to_string())
                } else {
                    None
                }
            })
        });

    let Some(asset_url) = asset_url else {
        let state = error_state(format!("版本 {latest} 没有找到 Windows 安装包"));
        publish(&app, state.clone());
        return state;
    };

    publish(
        &app,
        UpdateState {
            status: UpdateStatus::Available,
            version: Some(latest.to_string()),
            percent: None,
            message: None,
        },
    );

    let download = match client.get(&asset_url).send().await {
        Ok(response) if response.status().is_success() => response,
        Ok(response) => {
            let state = error_state(format!("下载更新失败：HTTP {}", response.status()));
            publish(&app, state.clone());
            return state;
        }
        Err(error) => {
            let state = error_state(describe_network_error(&error));
            publish(&app, state.clone());
            return state;
        }
    };

    let total = download.content_length().unwrap_or(0);
    let mut downloaded = 0u64;
    let mut bytes = Vec::with_capacity(total as usize);
    let mut stream = download.bytes_stream();
    let mut last_percent = 0u8;
    while let Some(chunk) = stream.next().await {
        let chunk = match chunk {
            Ok(chunk) => chunk,
            Err(error) => {
                let state = error_state(format!("下载更新中断：{error}"));
                publish(&app, state.clone());
                return state;
            }
        };
        downloaded += chunk.len() as u64;
        bytes.extend_from_slice(&chunk);
        if total > 0 {
            let percent = ((downloaded.saturating_mul(100) / total).min(100)) as u8;
            if percent >= last_percent.saturating_add(5) {
                last_percent = percent;
                publish(
                    &app,
                    UpdateState {
                        status: UpdateStatus::Downloading,
                        version: Some(latest.to_string()),
                        percent: Some(percent),
                        message: None,
                    },
                );
            }
        }
    }

    let path = std::env::temp_dir().join(format!("Nebula-{latest}-Setup.exe"));
    if let Err(error) = std::fs::write(&path, bytes) {
        let state = error_state(format!("无法写入更新安装包：{error}"));
        publish(&app, state.clone());
        return state;
    }

    if let Some(shared) = app.try_state::<AppState>() {
        if let Ok(mut target) = shared.update_download.lock() {
            *target = Some(path);
        }
        if let Ok(mut checked) = shared.last_update_check.lock() {
            *checked = Some(Instant::now());
        }
    }

    let state = UpdateState {
        status: UpdateStatus::Downloaded,
        version: Some(latest.to_string()),
        percent: Some(100),
        message: None,
    };
    publish(&app, state.clone());
    state
}

pub fn install(app: &AppHandle) -> bool {
    let path = app.try_state::<AppState>().and_then(|state| {
        state
            .update_download
            .lock()
            .ok()
            .and_then(|value| value.clone())
    });
    let Some(path) = path else {
        return false;
    };
    if !path.exists() {
        return false;
    }

    if let Some(state) = app.try_state::<AppState>() {
        state.quitting.store(true, Ordering::SeqCst);
    }

    match std::process::Command::new(&path).arg("/S").spawn() {
        Ok(_) => {
            std::thread::sleep(Duration::from_millis(400));
            app.exit(0);
            true
        }
        Err(error) => {
            eprintln!("[updater] failed to launch installer: {error}");
            false
        }
    }
}

pub fn start_background(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(25)).await;
        loop {
            let should_check = app
                .try_state::<AppState>()
                .and_then(|state| {
                    let last = state.last_update_check.lock().ok().and_then(|value| *value);
                    let downloaded = state
                        .update
                        .lock()
                        .map(|value| value.status == UpdateStatus::Downloaded)
                        .unwrap_or(false);
                    Some(
                        downloaded
                            || last
                                .is_some_and(|time| time.elapsed() < Duration::from_secs(6 * 3600)),
                    )
                })
                .unwrap_or(false);
            if !should_check {
                let _ = check(app.clone()).await;
            }
            tokio::time::sleep(Duration::from_secs(6 * 3600)).await;
        }
    });
}

fn error_state(message: String) -> UpdateState {
    UpdateState {
        status: UpdateStatus::Error,
        version: None,
        percent: None,
        message: Some(message),
    }
}

fn is_newer(latest: &str, current: &str) -> bool {
    let parse = |value: &str| -> Vec<u64> {
        value
            .trim_start_matches('v')
            .split(['-', '+'])
            .next()
            .unwrap_or("")
            .split('.')
            .map(|part| part.parse::<u64>().unwrap_or(0))
            .collect()
    };
    let latest = parse(latest);
    let current = parse(current);
    for index in 0..3 {
        let left = *latest.get(index).unwrap_or(&0);
        let right = *current.get(index).unwrap_or(&0);
        if left > right {
            return true;
        }
        if left < right {
            return false;
        }
    }
    false
}
