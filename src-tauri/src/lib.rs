mod app_state;
mod config_store;
mod desktop_icons;
mod desktop_layer;
mod input_forwarder;
mod interaction_proxy;
mod settings_windows;
mod tray;
mod widget_manager;
mod window_mode;

use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::sync::Mutex;
use std::{thread, time::Duration};

use app_state::AppState;
use desktop_layer::{attach_to_desktop_icon_layer, is_attached_to_desktop_icon_layer};
use input_forwarder::start_input_forwarder;
use tauri::{Manager, Position, Size};
use window_mode::{
    apply_initial_attached_mode, get_window_mode, switch_to_attached, switch_to_detached,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let attached_mode = Arc::new(AtomicBool::new(true));
    let allow_exit = Arc::new(AtomicBool::new(false));
    let proxy_hitboxes = Arc::new(Mutex::new(Vec::new()));
    let proxy_geometry = Arc::new(Mutex::new(interaction_proxy::ProxyGeometry::default()));
    let proxy_ui_state = Arc::new(Mutex::new(interaction_proxy::ProxyUiState::default()));

    tauri::Builder::default()
        .manage(AppState::new(
            Arc::clone(&attached_mode),
            Arc::clone(&allow_exit),
        ))
        .manage(Arc::clone(&proxy_hitboxes))
        .manage(Arc::clone(&proxy_geometry))
        .manage(Arc::clone(&proxy_ui_state))
        .invoke_handler(tauri::generate_handler![
            switch_to_attached,
            switch_to_detached,
            get_window_mode,
            tray::hide_schedule_widget,
            config_store::load_widget_settings,
            widget_manager::load_widget_registry,
            settings_windows::open_settings_window,
            settings_windows::open_card_settings_window,
            settings_windows::open_widget_menu_window,
            interaction_proxy::proxy_hitbox_probe,
            interaction_proxy::set_proxy_passthrough,
            interaction_proxy::update_proxy_hitboxes,
            interaction_proxy::clear_proxy_active_card,
            interaction_proxy::clear_proxy_menu_open
        ])
        .setup(move |app| {
            let window = app
                .get_webview_window("widget")
                .ok_or("widget window was not created")?;
            let state = app.state::<AppState>();

            #[cfg(debug_assertions)]
            window.open_devtools();

            window.set_position(Position::Physical(tauri::PhysicalPosition {
                x: 520,
                y: 52,
            }))?;
            window.set_size(Size::Physical(tauri::PhysicalSize {
                width: 700,
                height: 760,
            }))?;

            apply_initial_attached_mode(&window, &state)?;
            window.show()?;
            settings_windows::create_hidden_auxiliary_windows(app.handle())?;
            interaction_proxy::show_proxy_for_widget(app.handle(), &window, &state)?;
            tray::create_tray(app.handle())?;

            start_input_forwarder(window.clone(), state.attached_flag());
            interaction_proxy::start_proxy_input_manager(
                app.handle().clone(),
                window.clone(),
                Arc::clone(&proxy_hitboxes),
                Arc::clone(&proxy_geometry),
                Arc::clone(&proxy_ui_state),
            );
            start_desktop_layer_guard(app.handle().clone(), window, state.attached_flag());

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(move |_app_handle, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                if !allow_exit.load(Ordering::Relaxed) {
                    api.prevent_exit();
                }
            }
        });
}

fn start_desktop_layer_guard(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    attached_mode: Arc<AtomicBool>,
) {
    thread::spawn(move || loop {
        if !attached_mode.load(Ordering::Relaxed) {
            thread::sleep(Duration::from_millis(500));
            continue;
        }

        let attached_and_visible = is_attached_to_desktop_icon_layer(&window).unwrap_or(false);
        if !attached_and_visible {
            if let Err(error) = attach_to_desktop_icon_layer(&window) {
                eprintln!("failed to restore widget desktop layer: {error}");
            }

            if let Err(error) = window.show() {
                eprintln!("failed to show widget window: {error}");
            }
        }

        if let Some(proxy) = app.get_webview_window(interaction_proxy::PROXY_WINDOW_LABEL) {
            if let Err(error) = interaction_proxy::sync_proxy_bounds(&proxy, &window) {
                eprintln!("failed to sync interaction proxy: {error}");
            }
        }

        thread::sleep(Duration::from_millis(1000));
    });
}
