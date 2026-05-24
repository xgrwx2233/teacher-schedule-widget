use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
    AppHandle, Manager,
};

use crate::{app_state::AppState, interaction_proxy, settings_windows};

const SHOW_SCHEDULE_ID: &str = "show-schedule-widget";
const SHOW_CALENDAR_ID: &str = "show-calendar-widget";
const OPEN_SETTINGS_ID: &str = "open-settings";
const EXIT_APP_ID: &str = "exit-app";

pub fn create_tray(app: &AppHandle) -> Result<(), String> {
    let show_schedule = MenuItemBuilder::with_id(SHOW_SCHEDULE_ID, "显示课程表").build(app);
    let show_calendar = MenuItemBuilder::with_id(SHOW_CALENDAR_ID, "校历挂件（稍后）")
        .enabled(false)
        .build(app);
    let open_settings = MenuItemBuilder::with_id(OPEN_SETTINGS_ID, "设置").build(app);
    let exit_item = MenuItemBuilder::with_id(EXIT_APP_ID, "退出程序").build(app);

    let menu = MenuBuilder::new(app)
        .item(&show_schedule.map_err(|error| error.to_string())?)
        .item(&show_calendar.map_err(|error| error.to_string())?)
        .separator()
        .item(&open_settings.map_err(|error| error.to_string())?)
        .separator()
        .item(&exit_item.map_err(|error| error.to_string())?)
        .build()
        .map_err(|error| error.to_string())?;

    let mut builder = TrayIconBuilder::with_id("teacher-schedule-widget")
        .tooltip("教师课程表挂件")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().0.as_str() {
            SHOW_SCHEDULE_ID => {
                if let Err(error) = show_schedule_widget(app) {
                    eprintln!("failed to show schedule widget from tray: {error}");
                }
            }
            OPEN_SETTINGS_ID => {
                if let Err(error) = settings_windows::ensure_settings_window(app) {
                    eprintln!("failed to open settings from tray: {error}");
                }
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

#[tauri::command]
pub fn hide_schedule_widget(app: AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    state.set_widget_visible(false);
    let hitboxes = app.state::<interaction_proxy::ProxyHitboxStore>();
    let ui_state = app.state::<interaction_proxy::ProxyUiStateStore>();
    interaction_proxy::clear_interaction_state(&app, &hitboxes, &ui_state)?;

    settings_windows::hide_auxiliary_windows(&app)?;

    if let Some(widget) = app.get_webview_window("widget") {
        widget.hide().map_err(|error| error.to_string())?;
    }

    Ok(())
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

    Ok(())
}

pub fn exit_app(app: &AppHandle) {
    let state = app.state::<AppState>();
    state.allow_exit();
    app.exit(0);
}
