use crate::state::AppState;
use std::sync::atomic::Ordering;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "显示 / 隐藏窗口", true, None::<&str>)?;
    let mute = MenuItem::with_id(app, "mute", "静音 / 取消静音", true, None::<&str>)?;
    let leave = MenuItem::with_id(app, "leave", "离开语音", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "设置…", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出 Nebula", true, None::<&str>)?;
    let separator_a = PredefinedMenuItem::separator(app)?;
    let separator_b = PredefinedMenuItem::separator(app)?;

    let menu = Menu::with_items(
        app,
        &[
            &show,
            &separator_a,
            &mute,
            &leave,
            &separator_b,
            &settings,
            &quit,
        ],
    )?;

    let mut builder = TrayIconBuilder::with_id("nebula-tray")
        .tooltip("Nebula")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => crate::windows::toggle_main_window(app),
            "mute" => crate::shortcuts::handle(app, crate::types::ShortcutAction::ToggleMute),
            "leave" => crate::shortcuts::handle(app, crate::types::ShortcutAction::LeaveVoice),
            "settings" => {
                let _ = crate::windows::open_settings(app, false);
            }
            "quit" => {
                let state = app.state::<AppState>();
                state.quitting.store(true, Ordering::SeqCst);
                crate::shortcuts::stop_all(app);
                if let Some(session) = state.capture.lock().ok().and_then(|mut value| value.take())
                {
                    session.request_stop();
                }
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                ..
            } = event
            {
                crate::windows::toggle_main_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    builder.build(app)?;
    if let Some(state) = app.try_state::<AppState>() {
        state.tray_available.store(true, Ordering::SeqCst);
    }
    Ok(())
}
