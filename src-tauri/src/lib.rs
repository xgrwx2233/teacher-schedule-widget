mod app_state;
mod config_store;
mod desktop_icons;
mod desktop_layer;
mod desktop_wallpaper;
mod input_forwarder;
mod interaction_proxy;
mod local_account;
mod settings_windows;
mod tray;
mod wallpaper_watcher;
mod widget_manager;
mod window_mode;

use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::{thread, time::Duration};

use app_state::AppState;
use desktop_layer::{
    attach_to_desktop_icon_layer, cleanup_desktop_layer_before_exit,
    is_attached_to_desktop_icon_layer,
};
use input_forwarder::start_input_forwarder;
use tauri::{Manager, Position, Size, WindowEvent};
use widget_manager::WidgetRegistryStore;
use window_mode::{
    apply_initial_attached_mode, get_window_mode, switch_to_attached, switch_to_detached,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let attached_mode = Arc::new(AtomicBool::new(true));
    let widget_visible = Arc::new(AtomicBool::new(true));
    let allow_exit = Arc::new(AtomicBool::new(false));
    let cleanup_done = Arc::new(AtomicBool::new(false));
    let proxy_hitboxes = Arc::new(Mutex::new(Vec::new()));
    let proxy_geometry = Arc::new(Mutex::new(interaction_proxy::ProxyGeometry::default()));
    let proxy_ui_state = Arc::new(Mutex::new(interaction_proxy::ProxyUiState::default()));
    let widget_registry = WidgetRegistryStore::new();

    tauri::Builder::default()
        .manage(AppState::new(
            Arc::clone(&attached_mode),
            Arc::clone(&widget_visible),
            Arc::clone(&allow_exit),
        ))
        .manage(Arc::clone(&proxy_hitboxes))
        .manage(Arc::clone(&proxy_geometry))
        .manage(Arc::clone(&proxy_ui_state))
        .manage(widget_registry.clone())
        .invoke_handler(tauri::generate_handler![
            switch_to_attached,
            switch_to_detached,
            get_window_mode,
            tray::hide_schedule_widget,
            config_store::load_widget_settings,
            widget_manager::load_widget_registry,
            widget_manager::sync_active_widget_bounds,
            desktop_wallpaper::get_desktop_wallpaper,
            desktop_wallpaper::get_desktop_wallpaper_signature,
            settings_windows::open_settings_window,
            settings_windows::open_card_settings_window,
            settings_windows::open_widget_menu_window,
            settings_windows::open_floating_toolbar_window,
            settings_windows::open_auth_window,
            settings_windows::open_chat_window,
            settings_windows::open_chat_history_window,
            settings_windows::open_group_announcement_window,
            settings_windows::get_group_announcement_open_payload,
            settings_windows::open_profile_edit_window,
            settings_windows::open_friend_profile_window,
            settings_windows::open_profile_search_window,
            settings_windows::open_friend_request_window,
            settings_windows::open_image_preview_window,
            settings_windows::hide_auth_window,
            settings_windows::toggle_auth_window,
            local_account::load_local_account_state,
            local_account::load_local_sync_status,
            local_account::manual_sync_current_user,
            local_account::start_realtime_sync,
            local_account::stop_realtime_sync,
            local_account::start_chat_realtime,
            local_account::stop_chat_realtime,
            local_account::list_chat_conversations,
            local_account::get_rtc_token,
            local_account::list_chat_messages,
            local_account::search_chat_history_messages,
            local_account::send_chat_message,
            local_account::revoke_chat_message,
            local_account::delete_chat_message_for_me,
            local_account::create_direct_chat_conversation,
            local_account::create_chat_group,
            local_account::load_chat_group,
            local_account::update_chat_group,
            local_account::list_chat_group_announcements,
            local_account::create_chat_group_announcement,
            local_account::update_chat_group_announcement,
            local_account::delete_chat_group_announcement,
            local_account::list_chat_group_members,
            local_account::update_my_chat_group_member,
            local_account::invite_chat_group_members,
            local_account::list_chat_group_notifications,
            local_account::accept_chat_group_join_request,
            local_account::reject_chat_group_join_request,
            local_account::send_chat_group_join_request,
            local_account::set_chat_group_admin,
            local_account::unset_chat_group_admin,
            local_account::transfer_chat_group_owner,
            local_account::remove_chat_group_member,
            local_account::leave_chat_group,
            local_account::dissolve_chat_group,
            local_account::mark_chat_conversation_read,
            local_account::set_chat_conversation_pinned,
            local_account::set_chat_conversation_muted,
            local_account::clear_chat_conversation_history,
            local_account::archive_chat_conversation,
            local_account::load_my_profile,
            local_account::save_my_profile,
            local_account::load_user_profile,
            local_account::search_profiles,
            local_account::upload_profile_avatar,
            local_account::upload_profile_avatar_bytes,
            local_account::upload_chat_file_bytes,
            local_account::reupload_cached_chat_file,
            local_account::get_chat_file_signed_url,
            local_account::download_chat_file,
            local_account::cache_chat_file,
            local_account::open_cached_chat_file,
            local_account::cache_profile_avatar,
            local_account::send_friend_request,
            local_account::list_friend_requests,
            local_account::accept_friend_request,
            local_account::reject_friend_request,
            local_account::list_friends,
            local_account::load_current_schedule,
            local_account::save_current_schedule,
            local_account::register_local_account,
            local_account::login_with_password,
            local_account::login_with_code,
            local_account::logout_local_account,
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
            window.set_min_size(Some(Size::Logical(tauri::LogicalSize {
                width: 248.0,
                height: 480.0,
            })))?;
            let state = app.state::<AppState>();
            let registry = app.state::<WidgetRegistryStore>();
            let registry_store = widget_registry.clone();
            let app_handle = app.handle().clone();
            let attached_flag = state.attached_flag();
            let visible_flag = state.widget_visible_flag();

            if let Some(bounds) = registry.active_widget_bounds() {
                window.set_position(Position::Physical(tauri::PhysicalPosition {
                    x: bounds.x,
                    y: bounds.y,
                }))?;
                window.set_size(Size::Physical(tauri::PhysicalSize {
                    width: bounds.width,
                    height: bounds.height,
                }))?;
            }

            let _ = wallpaper_watcher::install_wallpaper_change_listener(&window, app.handle());
            let initial_mode = apply_initial_attached_mode(&window, &state, &registry)?;
            window.show()?;
            let _ = settings_windows::create_hidden_auxiliary_windows(app.handle());
            if matches!(initial_mode.mode, window_mode::WindowMode::Attached) {
                let _ = interaction_proxy::show_proxy_for_widget(app.handle(), &window, &state);
            }
            let _ = tray::create_tray(app.handle());

            start_input_forwarder(
                window.clone(),
                state.attached_flag(),
                state.widget_visible_flag(),
            );
            interaction_proxy::start_proxy_input_manager(
                app.handle().clone(),
                window.clone(),
                Arc::clone(&proxy_hitboxes),
                Arc::clone(&proxy_geometry),
                Arc::clone(&proxy_ui_state),
                state.attached_flag(),
                state.widget_visible_flag(),
            );
            start_desktop_layer_guard(
                app.handle().clone(),
                window,
                state.attached_flag(),
                state.widget_visible_flag(),
            );

            let listener_window = app
                .get_webview_window("widget")
                .ok_or("widget window was not created")?;
            let listener_target = listener_window.clone();
            listener_window.on_window_event(move |event| match event {
                WindowEvent::Moved(_) | WindowEvent::Resized(_) => {
                    if !attached_flag.load(Ordering::Relaxed)
                        || !visible_flag.load(Ordering::Relaxed)
                    {
                        return;
                    }

                    if widget_manager::save_window_bounds(&listener_target, &registry_store)
                        .is_err()
                    {
                        return;
                    }

                    if let Some(proxy) =
                        app_handle.get_webview_window(interaction_proxy::PROXY_WINDOW_LABEL)
                    {
                        let _ = interaction_proxy::sync_proxy_bounds(&proxy, &listener_target);
                    }
                }
                _ => {}
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(move |_app_handle, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                if !allow_exit.load(Ordering::Relaxed) {
                    api.prevent_exit();
                } else if !cleanup_done.swap(true, Ordering::Relaxed) {
                    if let Some(widget) = _app_handle.get_webview_window("widget") {
                        let _ = cleanup_desktop_layer_before_exit(&widget);
                    }
                }
            }
        });
}

fn start_desktop_layer_guard(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    attached_mode: Arc<AtomicBool>,
    widget_visible: Arc<AtomicBool>,
) {
    thread::spawn(move || loop {
        if !widget_visible.load(Ordering::Relaxed) {
            thread::sleep(Duration::from_millis(500));
            continue;
        }

        if !attached_mode.load(Ordering::Relaxed) {
            thread::sleep(Duration::from_millis(500));
            continue;
        }

        let attached_and_visible = is_attached_to_desktop_icon_layer(&window).unwrap_or(false);
        if !attached_and_visible {
            let _ = attach_to_desktop_icon_layer(&window);

            let _ = window.show();
        }

        if let Some(proxy) = app.get_webview_window(interaction_proxy::PROXY_WINDOW_LABEL) {
            let _ = interaction_proxy::sync_proxy_bounds(&proxy, &window);
        }

        thread::sleep(Duration::from_millis(1000));
    });
}
