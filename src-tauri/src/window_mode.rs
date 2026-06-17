use crate::{
    app_state::AppState,
    desktop_layer::{self, DesktopAttachDiagnostics},
    interaction_proxy,
    widget_manager::{self, WidgetRegistryStore, WidgetWindowMode},
};
use serde::Serialize;
use tauri::{Manager, Runtime, State};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum WindowMode {
    Attached,
    Detached,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowModeState {
    pub mode: WindowMode,
    pub attach_diagnostics: Option<DesktopAttachDiagnostics>,
}

#[tauri::command]
pub fn get_window_mode(state: State<'_, AppState>) -> WindowModeState {
    WindowModeState {
        mode: if state.is_attached() {
            WindowMode::Attached
        } else {
            WindowMode::Detached
        },
        attach_diagnostics: None,
    }
}

#[tauri::command]
pub fn switch_to_attached(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    registry: State<'_, WidgetRegistryStore>,
) -> Result<WindowModeState, String> {
    apply_attached_mode(&window, &state, &registry)?;
    interaction_proxy::show_proxy_for_widget(&window.app_handle(), &window, &state)?;
    Ok(WindowModeState {
        mode: WindowMode::Attached,
        attach_diagnostics: Some(desktop_layer::attach_diagnostics(&window)),
    })
}

#[tauri::command]
pub fn switch_to_detached(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    registry: State<'_, WidgetRegistryStore>,
) -> Result<WindowModeState, String> {
    interaction_proxy::hide_proxy(&window.app_handle())?;
    apply_detached_mode(&window, &state, &registry)?;
    Ok(WindowModeState {
        mode: WindowMode::Detached,
        attach_diagnostics: None,
    })
}

pub fn apply_initial_attached_mode<R: Runtime>(
    window: &tauri::WebviewWindow<R>,
    state: &AppState,
    registry: &WidgetRegistryStore,
) -> Result<WindowModeState, String> {
    match apply_attached_mode(window, state, registry) {
        Ok(()) => Ok(WindowModeState {
            mode: WindowMode::Attached,
            attach_diagnostics: Some(desktop_layer::attach_diagnostics(window)),
        }),
        Err(error) => {
            let mut diagnostics = desktop_layer::attach_diagnostics(window);
            diagnostics.error = Some(error);
            Ok(WindowModeState {
                mode: WindowMode::Attached,
                attach_diagnostics: Some(diagnostics),
            })
        }
    }
}

fn apply_attached_mode<R: Runtime>(
    window: &tauri::WebviewWindow<R>,
    state: &AppState,
    registry: &WidgetRegistryStore,
) -> Result<(), String> {
    if !state.is_attached() {
        widget_manager::save_window_bounds(window, registry)?;
    }

    widget_manager::apply_registry_geometry(window, registry)?;
    state.set_attached(true);
    widget_manager::set_active_widget_mode(registry, WidgetWindowMode::Attached)?;
    window
        .set_resizable(false)
        .map_err(|error| error.to_string())?;
    window
        .set_skip_taskbar(true)
        .map_err(|error| error.to_string())?;
    desktop_layer::attach_to_desktop_icon_layer(window).map_err(|error| error.to_string())?;
    Ok(())
}

fn apply_detached_mode<R: Runtime>(
    window: &tauri::WebviewWindow<R>,
    state: &AppState,
    registry: &WidgetRegistryStore,
) -> Result<(), String> {
    widget_manager::save_window_bounds(window, registry)?;
    state.set_attached(false);
    widget_manager::set_active_widget_mode(registry, WidgetWindowMode::Detached)?;
    desktop_layer::detach_from_desktop_icon_layer(window).map_err(|error| error.to_string())?;
    widget_manager::apply_registry_geometry(window, registry)?;
    window
        .set_focusable(true)
        .map_err(|error| error.to_string())?;
    window
        .set_resizable(true)
        .map_err(|error| error.to_string())?;
    window
        .set_skip_taskbar(false)
        .map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    Ok(())
}
