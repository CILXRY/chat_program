mod autostart;
mod capture;
mod commands;
mod config;
mod shortcuts;
mod state;
mod tray;
mod types;
mod updater;
mod windows;

use state::AppState;
use std::sync::atomic::Ordering;
use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            windows::show_main_window(app);
        }))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    shortcuts::plugin_handler(app, shortcut, event);
                })
                .build(),
        )
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::new(config::DesktopConfig::default()))
        .setup(|app| {
            let handle = app.handle().clone();
            let config = config::load_config(&handle);
            if let Ok(mut target) = app.state::<AppState>().config.lock() {
                *target = config.clone();
            }

            if let Err(error) = tray::create(&handle) {
                eprintln!("[tray] failed to create tray icon: {error}");
            }
            autostart::apply(&handle, config.auto_start);
            shortcuts::register(&handle);

            let hidden = std::env::args().any(|argument| argument == "--hidden")
                || (config.start_minimized && config.configured);
            if config.configured {
                windows::create_main_window(&handle, &config.server_url(), !hidden)?;
            } else {
                windows::open_settings(&handle, true)?;
            }

            updater::start_background(handle);
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                let state = app.state::<AppState>();
                if state.quitting.load(Ordering::SeqCst) {
                    return;
                }
                if window.label() == "main" {
                    let close_to_tray = state
                        .config
                        .lock()
                        .map(|config| config.close_to_tray)
                        .unwrap_or(false);
                    if close_to_tray && state.tray_available.load(Ordering::SeqCst) {
                        api.prevent_close();
                        let _ = window.hide();
                    } else {
                        state.quitting.store(true, Ordering::SeqCst);
                        app.exit(0);
                    }
                } else if window.label() == "settings" {
                    let has_main = app.get_webview_window("main").is_some();
                    if has_main || state.tray_available.load(Ordering::SeqCst) {
                        api.prevent_close();
                        let _ = window.hide();
                    } else {
                        state.quitting.store(true, Ordering::SeqCst);
                        app.exit(0);
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::settings_get,
            commands::settings_save,
            commands::settings_test_server,
            commands::settings_close,
            commands::app_open_external,
            commands::app_version,
            commands::desktop_notify,
            commands::desktop_open_settings,
            commands::window_toggle,
            commands::audio_output_info,
            commands::capture_start,
            commands::capture_stop,
            commands::updater_check,
            commands::updater_install,
            commands::updater_state,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build Nebula desktop")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                let state = app.state::<AppState>();
                if !state.quitting.load(Ordering::SeqCst)
                    && state.tray_available.load(Ordering::SeqCst)
                {
                    api.prevent_exit();
                }
            }
        });
}
