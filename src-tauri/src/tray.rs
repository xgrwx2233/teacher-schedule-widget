use tauri::{
    menu::{Menu, MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
    AppHandle, Manager, Wry,
};

use crate::{app_state::AppState, interaction_proxy, settings_windows};

const TRAY_ID: &str = "teacher-schedule-widget";
const TOGGLE_SCHEDULE_ID: &str = "toggle-schedule-widget";
const SHOW_CALENDAR_ID: &str = "show-calendar-widget";
const OPEN_AUTH_ID: &str = "open-auth";
const OPEN_SETTINGS_ID: &str = "open-settings";
const EXIT_APP_ID: &str = "exit-app";

pub fn create_tray(app: &AppHandle) -> Result<(), String> {
    let menu = build_tray_menu(app, true)?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("教师课程表挂件")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().0.as_str() {
            TOGGLE_SCHEDULE_ID => {
                let _ = toggle_schedule_widget(app);
            }
            OPEN_AUTH_ID => {
                let _ = settings_windows::show_auth_window_if_hidden(app);
            }
            OPEN_SETTINGS_ID => {
                let _ = settings_windows::ensure_settings_window(app);
            }
            EXIT_APP_ID => exit_app(app),
            _ => {}
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }

    builder.build(app).map_err(|error| error.to_string())?;
    Ok(())
}

fn build_tray_menu(app: &AppHandle, widget_visible: bool) -> Result<Menu<Wry>, String> {
    let toggle_label = if widget_visible {
        "关闭课程表"
    } else {
        "显示课程表"
    };
    let toggle_schedule = MenuItemBuilder::with_id(TOGGLE_SCHEDULE_ID, toggle_label).build(app);
    let show_calendar = MenuItemBuilder::with_id(SHOW_CALENDAR_ID, "校历挂件（稍后）")
        .enabled(false)
        .build(app);
    let open_auth = MenuItemBuilder::with_id(OPEN_AUTH_ID, "登录 / 账号").build(app);
    let open_settings = MenuItemBuilder::with_id(OPEN_SETTINGS_ID, "设置").build(app);
    let exit_item = MenuItemBuilder::with_id(EXIT_APP_ID, "退出程序").build(app);

    MenuBuilder::new(app)
        .item(&toggle_schedule.map_err(|error| error.to_string())?)
        .item(&show_calendar.map_err(|error| error.to_string())?)
        .separator()
        .item(&open_auth.map_err(|error| error.to_string())?)
        .item(&open_settings.map_err(|error| error.to_string())?)
        .separator()
        .item(&exit_item.map_err(|error| error.to_string())?)
        .build()
        .map_err(|error| error.to_string())
}

fn refresh_schedule_toggle_menu(app: &AppHandle) -> Result<(), String> {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return Ok(());
    };

    let visible = app.state::<AppState>().is_widget_visible();
    let menu = build_tray_menu(app, visible)?;
    tray.set_menu(Some(menu)).map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn hide_schedule_widget(app: AppHandle) -> Result<(), String> {
    hide_schedule_widget_inner(&app)
}

fn hide_schedule_widget_inner(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    state.set_widget_visible(false);
    let hitboxes = app.state::<interaction_proxy::ProxyHitboxStore>();
    let ui_state = app.state::<interaction_proxy::ProxyUiStateStore>();
    interaction_proxy::clear_interaction_state(app, &hitboxes, &ui_state)?;

    settings_windows::hide_auxiliary_windows(app)?;

    if let Some(widget) = app.get_webview_window("widget") {
        widget.hide().map_err(|error| error.to_string())?;
    }

    refresh_schedule_toggle_menu(app)?;
    Ok(())
}

pub fn toggle_schedule_widget(app: &AppHandle) -> Result<(), String> {
    if app.state::<AppState>().is_widget_visible() {
        hide_schedule_widget_inner(app)
    } else {
        show_schedule_widget(app)
    }
}

pub fn show_schedule_widget(app: &AppHandle) -> Result<(), String> {
    let Some(widget) = app.get_webview_window("widget") else {
        return Ok(());
    };

    let state = app.state::<AppState>();
    state.set_widget_visible(true);
    widget.show().map_err(|error| error.to_string())?;

    if state.is_attached() {
        interaction_proxy::show_proxy_for_widget(app, &widget, &state)?;
    }

    refresh_schedule_toggle_menu(app)?;
    Ok(())
}

pub fn exit_app(app: &AppHandle) {
    let state = app.state::<AppState>();
    state.allow_exit();
    app.exit(0);
}
