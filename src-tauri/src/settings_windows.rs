use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

const SETTINGS_WINDOW_LABEL: &str = "settings";
const CARD_SETTINGS_WINDOW_LABEL: &str = "card-settings";
const WIDGET_MENU_WINDOW_LABEL: &str = "widget-menu";
const FLOATING_TOOLBAR_WINDOW_LABEL: &str = "floating-toolbar";

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
pub fn open_floating_toolbar_window(app: AppHandle) -> Result<(), String> {
    ensure_floating_toolbar_window(&app).map(|_| ())
}

pub fn create_hidden_auxiliary_windows(app: &AppHandle) -> Result<(), String> {
    create_settings_window(app)?;
    create_widget_menu_window(app)?;
    create_card_settings_window(app)?;
    create_floating_toolbar_window(app)?;
    Ok(())
}

pub fn hide_auxiliary_windows(app: &AppHandle) -> Result<(), String> {
    for label in [
        SETTINGS_WINDOW_LABEL,
        CARD_SETTINGS_WINDOW_LABEL,
        WIDGET_MENU_WINDOW_LABEL,
        FLOATING_TOOLBAR_WINDOW_LABEL,
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

pub fn ensure_floating_toolbar_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    show_existing_or_create(app, FLOATING_TOOLBAR_WINDOW_LABEL, create_floating_toolbar_window)
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

    WebviewWindowBuilder::new(app, SETTINGS_WINDOW_LABEL, WebviewUrl::App("index.html#settings".into()))
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

    WebviewWindowBuilder::new(app, WIDGET_MENU_WINDOW_LABEL, WebviewUrl::App("index.html#widget-menu".into()))
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

    WebviewWindowBuilder::new(app, CARD_SETTINGS_WINDOW_LABEL, WebviewUrl::App("index.html#card-settings".into()))
        .title("课程卡片设置")
        .devtools(true)
        .decorations(false)
        .transparent(false)
        .resizable(false)
        .minimizable(false)
        .maximizable(false)
        .skip_taskbar(true)
        .visible(false)
        .inner_size(360.0, 430.0)
        .build()
        .map_err(|error| error.to_string())
}

fn create_floating_toolbar_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(FLOATING_TOOLBAR_WINDOW_LABEL) {
        return Ok(window);
    }

    WebviewWindowBuilder::new(app, FLOATING_TOOLBAR_WINDOW_LABEL, WebviewUrl::App("index.html#floating-toolbar".into()))
        .title("浮动工具栏")
        .devtools(true)
        .decorations(false)
        .transparent(true)
        .resizable(false)
        .minimizable(false)
        .maximizable(false)
        .skip_taskbar(true)
        .visible(false)
        .inner_size(320.0, 48.0)
        .build()
        .map_err(|error| error.to_string())
}
