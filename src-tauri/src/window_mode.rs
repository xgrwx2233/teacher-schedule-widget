use crate::{app_state::AppState, desktop_layer, interaction_proxy};
use serde::Serialize;
use tauri::{Manager, Runtime, State};

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum WindowMode {
    Attached,
    Detached,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowModeState {
    pub mode: WindowMode,
}

#[tauri::command]
pub fn get_window_mode(state: State<'_, AppState>) -> WindowModeState {
    WindowModeState {
        mode: if state.is_attached() {
            WindowMode::Attached
        } else {
            WindowMode::Detached
        },
    }
}

#[tauri::command]
pub fn switch_to_attached(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
) -> Result<WindowModeState, String> {
    apply_attached_mode(&window, &state)?;
    interaction_proxy::show_proxy_for_widget(&window.app_handle(), &window, &state)?;
    Ok(WindowModeState {
        mode: WindowMode::Attached,
    })
}

#[tauri::command]
pub fn switch_to_detached(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
) -> Result<WindowModeState, String> {
    interaction_proxy::hide_proxy(&window.app_handle())?;
    apply_detached_mode(&window, &state)?;
    Ok(WindowModeState {
        mode: WindowMode::Detached,
    })
}

pub fn apply_initial_attached_mode<R: Runtime>(
    window: &tauri::WebviewWindow<R>,
    state: &AppState,
) -> Result<(), String> {
    apply_attached_mode(window, state)
}

fn apply_attached_mode<R: Runtime>(
    window: &tauri::WebviewWindow<R>,
    state: &AppState,
) -> Result<(), String> {
    window.set_resizable(false).map_err(|error| error.to_string())?;
    window
        .set_skip_taskbar(true)
        .map_err(|error| error.to_string())?;
    desktop_layer::attach_to_desktop_icon_layer(window).map_err(|error| error.to_string())?;
    state.set_attached(true);
    Ok(())
}

fn apply_detached_mode<R: Runtime>(
    window: &tauri::WebviewWindow<R>,
    state: &AppState,
) -> Result<(), String> {
    state.set_attached(false);
    desktop_layer::detach_from_desktop_icon_layer(window).map_err(|error| error.to_string())?;
    window.set_resizable(true).map_err(|error| error.to_string())?;
    window
        .set_skip_taskbar(false)
        .map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    Ok(())
}
