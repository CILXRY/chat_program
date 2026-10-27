use crate::state::AppState;
use crate::types::{ShortcutAction, ShortcutStatus};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

struct Group {
    action: ShortcutAction,
    action_id: &'static str,
    label: &'static str,
    candidates: &'static [&'static str],
}

const GROUPS: &[Group] = &[
    Group {
        action: ShortcutAction::ToggleMute,
        action_id: "toggle-mute",
        label: "静音 / 取消静音",
        candidates: &["Ctrl+Shift+M", "Ctrl+Alt+M", "Ctrl+Shift+U"],
    },
    Group {
        action: ShortcutAction::ToggleWindow,
        action_id: "toggle-window",
        label: "显示 / 隐藏窗口",
        candidates: &["Ctrl+Shift+H", "Ctrl+Alt+H"],
    },
    Group {
        action: ShortcutAction::LeaveVoice,
        action_id: "leave-voice",
        label: "离开语音",
        candidates: &["Ctrl+Shift+E", "Ctrl+Alt+E"],
    },
];

pub fn register(app: &AppHandle) -> Vec<ShortcutStatus> {
    let state = app.state::<AppState>();
    let enabled = state
        .config
        .lock()
        .map(|value| value.shortcuts_enabled)
        .unwrap_or(false);

    let previous: Vec<Shortcut> = state
        .shortcut_map
        .lock()
        .map(|map| map.keys().cloned().collect())
        .unwrap_or_default();
    for shortcut in previous {
        let _ = app.global_shortcut().unregister(shortcut);
    }
    if let Ok(mut map) = state.shortcut_map.lock() {
        map.clear();
    }

    let mut statuses = Vec::new();
    if !enabled {
        if let Ok(mut target) = state.shortcuts.lock() {
            *target = statuses.clone();
        }
        return statuses;
    }

    for group in GROUPS {
        let mut registered = false;
        for candidate in group.candidates {
            let Ok(shortcut) = candidate.parse::<Shortcut>() else {
                continue;
            };
            if app.global_shortcut().register(shortcut.clone()).is_ok() {
                if let Ok(mut map) = state.shortcut_map.lock() {
                    map.insert(shortcut, group.action);
                }
                statuses.push(ShortcutStatus {
                    accelerator: (*candidate).to_string(),
                    label: group.label.to_string(),
                    action: group.action_id.to_string(),
                    registered: true,
                });
                registered = true;
                break;
            }
        }
        if !registered {
            statuses.push(ShortcutStatus {
                accelerator: group.candidates.first().copied().unwrap_or("").to_string(),
                label: group.label.to_string(),
                action: group.action_id.to_string(),
                registered: false,
            });
        }
    }

    if let Ok(mut target) = state.shortcuts.lock() {
        *target = statuses.clone();
    }
    statuses
}

pub fn handle(app: &AppHandle, action: ShortcutAction) {
    match action {
        ShortcutAction::ToggleWindow => crate::windows::toggle_main_window_async(app),
        ShortcutAction::ToggleMute | ShortcutAction::LeaveVoice => {
            let payload = match action {
                ShortcutAction::ToggleMute => "toggle-mute",
                ShortcutAction::LeaveVoice => "leave-voice",
                ShortcutAction::ToggleWindow => unreachable!(),
            };
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.emit("desktop:shortcut", payload);
            }
        }
    }
}

pub fn plugin_handler(
    app: &AppHandle,
    shortcut: &Shortcut,
    event: tauri_plugin_global_shortcut::ShortcutEvent,
) {
    if event.state() != ShortcutState::Pressed {
        return;
    }
    let action = app
        .state::<AppState>()
        .shortcut_map
        .lock()
        .ok()
        .and_then(|map| map.get(shortcut).copied());
    if let Some(action) = action {
        handle(app, action);
    }
}

pub fn stop_all(app: &AppHandle) {
    let state = app.state::<AppState>();
    let shortcuts: Vec<Shortcut> = state
        .shortcut_map
        .lock()
        .map(|map| map.keys().cloned().collect())
        .unwrap_or_default();
    for shortcut in shortcuts {
        let _ = app.global_shortcut().unregister(shortcut);
    }
    {
        let locked = state.shortcut_map.lock();
        if let Ok(mut map) = locked {
            map.clear();
        }
    }
}
