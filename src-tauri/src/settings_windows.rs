use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::app_state::AppState;

const SETTINGS_WINDOW_LABEL: &str = "settings";
const CARD_SETTINGS_WINDOW_LABEL: &str = "card-settings";
const BLOCK_SETTINGS_WINDOW_LABEL: &str = "block-settings";
const BLOCK_TYPE_CONFIRM_WINDOW_LABEL: &str = "block-type-confirm";
const WIDGET_MENU_WINDOW_LABEL: &str = "widget-menu";

#[tauri::command]
pub fn open_settings_window(app: AppHandle) -> Result<(), String> {
    ensure_settings_window(&app).map(|_| ())
}

#[tauri::command]
pub fn open_card_settings_window(app: AppHandle) -> Result<(), String> {
    ensure_card_settings_window(&app).map(|_| ())
}

#[tauri::command]
pub fn open_widget_menu_window(app: AppHandle) -> Result<(), String> {
    ensure_widget_menu_window(&app).map(|_| ())
}

#[tauri::command]
pub fn open_block_settings_window(app: AppHandle) -> Result<(), String> {
    eprintln!("block settings window: open requested");
    let window = ensure_block_settings_window(&app)?;
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn open_block_type_confirm_window(app: AppHandle) -> Result<(), String> {
    ensure_block_type_confirm_window(&app).map(|_| ())
}

#[tauri::command]
pub fn hide_block_settings_window(app: AppHandle) -> Result<(), String> {
    eprintln!("block settings window: hide requested");
    if let Some(window) = app.get_webview_window(BLOCK_SETTINGS_WINDOW_LABEL) {
        window.hide().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn set_block_settings_window_state(
    state: State<'_, AppState>,
    payload: serde_json::Value,
) -> Result<(), String> {
    let payload = serde_json::to_string(&payload).map_err(|error| error.to_string())?;
    eprintln!("block settings window: state stored {payload}");
    state.set_block_settings_window_state(Some(payload));
    Ok(())
}

#[tauri::command]
pub fn get_block_settings_window_state(state: State<'_, AppState>) -> Option<serde_json::Value> {
    let payload = state
        .block_settings_window_state()
        .and_then(|payload| serde_json::from_str(&payload).ok());
    eprintln!("block settings window: state loaded {}", payload.is_some());
    payload
}

#[tauri::command]
pub fn set_block_type_confirm_window_state(
    state: State<'_, AppState>,
    payload: serde_json::Value,
) -> Result<(), String> {
    let payload = serde_json::to_string(&payload).map_err(|error| error.to_string())?;
    state.set_block_type_confirm_window_state(Some(payload));
    Ok(())
}

#[tauri::command]
pub fn get_block_type_confirm_window_state(state: State<'_, AppState>) -> Option<serde_json::Value> {
    state
        .block_type_confirm_window_state()
        .and_then(|payload| serde_json::from_str(&payload).ok())
}

pub fn create_hidden_auxiliary_windows(app: &AppHandle) -> Result<(), String> {
    create_settings_window(app)?;
    create_widget_menu_window(app)?;
    create_card_settings_window(app)?;
    create_block_settings_window(app)?;
    create_block_type_confirm_window(app)?;
    Ok(())
}

pub fn hide_auxiliary_windows(app: &AppHandle) -> Result<(), String> {
    for label in [
        SETTINGS_WINDOW_LABEL,
        CARD_SETTINGS_WINDOW_LABEL,
        BLOCK_SETTINGS_WINDOW_LABEL,
        BLOCK_TYPE_CONFIRM_WINDOW_LABEL,
        WIDGET_MENU_WINDOW_LABEL,
    ] {
        if let Some(window) = app.get_webview_window(label) {
            window.hide().map_err(|error| error.to_string())?;
        }
    }

    Ok(())
}

pub fn ensure_settings_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    show_existing_or_create(app, SETTINGS_WINDOW_LABEL, create_settings_window)
}

pub fn ensure_widget_menu_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    show_existing_or_create(app, WIDGET_MENU_WINDOW_LABEL, create_widget_menu_window)
}

pub fn ensure_card_settings_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    show_existing_or_create(app, CARD_SETTINGS_WINDOW_LABEL, create_card_settings_window)
}

pub fn ensure_block_settings_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    show_existing_or_create(app, BLOCK_SETTINGS_WINDOW_LABEL, create_block_settings_window)
}

pub fn ensure_block_type_confirm_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    show_existing_or_create(app, BLOCK_TYPE_CONFIRM_WINDOW_LABEL, create_block_type_confirm_window)
}

fn show_existing_or_create(
    app: &AppHandle,
    label: &str,
    create: fn(&AppHandle) -> Result<WebviewWindow, String>,
) -> Result<WebviewWindow, String> {
    let window = if let Some(window) = app.get_webview_window(label) {
        window
    } else {
        create(app)?
    };

    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    Ok(window)
}

fn create_settings_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(SETTINGS_WINDOW_LABEL) {
        return Ok(window);
    }

    WebviewWindowBuilder::new(
        app,
        SETTINGS_WINDOW_LABEL,
        WebviewUrl::App("index.html#settings".into()),
    )
    .title("设置")
    .devtools(true)
    .decorations(true)
    .transparent(false)
    .resizable(false)
    .minimizable(false)
    .maximizable(false)
    .skip_taskbar(true)
    .visible(false)
    .inner_size(680.0, 560.0)
    .build()
    .map_err(|error| error.to_string())
}

fn create_widget_menu_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(WIDGET_MENU_WINDOW_LABEL) {
        return Ok(window);
    }

    WebviewWindowBuilder::new(
        app,
        WIDGET_MENU_WINDOW_LABEL,
        WebviewUrl::App("index.html#widget-menu".into()),
    )
    .title("课程表菜单")
    .devtools(true)
    .decorations(false)
    .transparent(false)
    .resizable(false)
    .minimizable(false)
    .maximizable(false)
    .skip_taskbar(true)
    .always_on_top(true)
    .visible(false)
    .inner_size(132.0, 132.0)
    .build()
    .map_err(|error| error.to_string())
}

fn create_card_settings_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(CARD_SETTINGS_WINDOW_LABEL) {
        return Ok(window);
    }

    WebviewWindowBuilder::new(
        app,
        CARD_SETTINGS_WINDOW_LABEL,
        WebviewUrl::App("index.html#card-settings".into()),
    )
    .title("卡片设置")
    .devtools(true)
    .decorations(true)
    .transparent(false)
    .resizable(false)
    .minimizable(false)
    .maximizable(false)
    .skip_taskbar(true)
    .visible(false)
    .inner_size(560.0, 620.0)
    .build()
    .map_err(|error| error.to_string())
}

fn create_block_settings_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(BLOCK_SETTINGS_WINDOW_LABEL) {
        return Ok(window);
    }

    WebviewWindowBuilder::new(
        app,
        BLOCK_SETTINGS_WINDOW_LABEL,
        WebviewUrl::App("index.html#block-settings".into()),
    )
    .title("块信息设置")
    .devtools(true)
    .decorations(true)
    .transparent(false)
    .resizable(false)
    .minimizable(false)
    .maximizable(false)
    .skip_taskbar(true)
    .always_on_top(true)
    .visible(false)
    .inner_size(176.0, 140.0)
    .build()
    .map_err(|error| error.to_string())
}

fn create_block_type_confirm_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(BLOCK_TYPE_CONFIRM_WINDOW_LABEL) {
        return Ok(window);
    }

    WebviewWindowBuilder::new(
        app,
        BLOCK_TYPE_CONFIRM_WINDOW_LABEL,
        WebviewUrl::App("index.html#block-type-confirm".into()),
    )
    .title("确认切换块类型")
    .devtools(true)
    .decorations(true)
    .transparent(false)
    .resizable(false)
    .minimizable(false)
    .maximizable(false)
    .skip_taskbar(true)
    .always_on_top(true)
    .visible(false)
    .inner_size(320.0, 180.0)
    .build()
    .map_err(|error| error.to_string())
}
