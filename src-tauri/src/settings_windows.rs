use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

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

pub fn create_hidden_auxiliary_windows(app: &AppHandle) -> Result<(), String> {
    create_settings_window(app)?;
    create_widget_menu_window(app)?;
    create_card_settings_window(app)?;
    Ok(())
}

pub fn ensure_settings_window(app: &AppHandle) -> Result<tauri::WebviewWindow, String> {
    if let Some(window) = app.get_webview_window("settings") {
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
        return Ok(window);
    }

    let window = create_settings_window(app)?;

    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    Ok(window)
}

pub fn ensure_widget_menu_window(app: &AppHandle) -> Result<tauri::WebviewWindow, String> {
    if let Some(window) = app.get_webview_window("widget-menu") {
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
        return Ok(window);
    }

    let window = create_widget_menu_window(app)?;

    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    Ok(window)
}

pub fn ensure_card_settings_window(app: &AppHandle) -> Result<tauri::WebviewWindow, String> {
    if let Some(window) = app.get_webview_window("card-settings") {
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
        return Ok(window);
    }

    let window = create_card_settings_window(app)?;

    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    Ok(window)
}

fn create_settings_window(app: &AppHandle) -> Result<tauri::WebviewWindow, String> {
    if let Some(window) = app.get_webview_window("settings") {
        return Ok(window);
    }

    WebviewWindowBuilder::new(
        app,
        "settings",
        WebviewUrl::App("index.html#settings".into()),
    )
    .title("设置")
    .devtools(true)
    .decorations(false)
    .transparent(false)
    .resizable(false)
    .skip_taskbar(true)
    .visible(false)
    .inner_size(680.0, 560.0)
    .build()
    .map_err(|error| error.to_string())
}

fn create_widget_menu_window(app: &AppHandle) -> Result<tauri::WebviewWindow, String> {
    if let Some(window) = app.get_webview_window("widget-menu") {
        return Ok(window);
    }

    WebviewWindowBuilder::new(
        app,
        "widget-menu",
        WebviewUrl::App("index.html#widget-menu".into()),
    )
    .title("Menu")
    .devtools(true)
    .decorations(false)
    .transparent(false)
    .resizable(false)
    .skip_taskbar(true)
    .always_on_top(true)
    .visible(false)
    .inner_size(132.0, 132.0)
    .build()
    .map_err(|error| error.to_string())
}

fn create_card_settings_window(app: &AppHandle) -> Result<tauri::WebviewWindow, String> {
    if let Some(window) = app.get_webview_window("card-settings") {
        return Ok(window);
    }

    WebviewWindowBuilder::new(
        app,
        "card-settings",
        WebviewUrl::App("index.html#card-settings".into()),
    )
    .title("卡片设置")
    .devtools(true)
    .decorations(false)
    .transparent(false)
    .resizable(false)
    .skip_taskbar(true)
    .visible(false)
    .inner_size(560.0, 620.0)
    .build()
    .map_err(|error| error.to_string())
}
