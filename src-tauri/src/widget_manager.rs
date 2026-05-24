use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{PhysicalPosition, PhysicalSize, Position, Size, State, WebviewWindow};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum WidgetType {
    Schedule,
    Calendar,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum WidgetWindowMode {
    Attached,
    Detached,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WidgetBounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WidgetInstance {
    pub id: String,
    pub widget_type: WidgetType,
    pub title: String,
    pub mode: WidgetWindowMode,
    pub bounds: WidgetBounds,
    pub skin_id: String,
    pub visible: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WidgetRegistryState {
    pub active_widget_id: String,
    pub widgets: Vec<WidgetInstance>,
}

#[derive(Clone)]
pub struct WidgetRegistryStore {
    inner: Arc<Mutex<WidgetRegistryState>>,
}

impl WidgetRegistryStore {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(default_widget_registry())),
        }
    }

    pub fn snapshot(&self) -> WidgetRegistryState {
        self.inner
            .lock()
            .map(|state| state.clone())
            .unwrap_or_else(|_| default_widget_registry())
    }

    pub fn active_widget_bounds(&self) -> Option<WidgetBounds> {
        self.inner.lock().ok().and_then(|state| {
            state
                .widgets
                .iter()
                .find(|widget| widget.id == state.active_widget_id)
                .map(|widget| widget.bounds.clone())
        })
    }

    pub fn apply_active_widget_mode(&self, mode: WidgetWindowMode) -> Result<(), String> {
        self.update_active_widget(|widget| {
            widget.mode = mode;
        })
    }

    pub fn apply_active_widget_bounds(&self, bounds: WidgetBounds) -> Result<(), String> {
        self.update_active_widget(|widget| {
            widget.bounds = bounds;
        })
    }

    fn update_active_widget<F>(&self, updater: F) -> Result<(), String>
    where
        F: FnOnce(&mut WidgetInstance),
    {
        let mut state = self
            .inner
            .lock()
            .map_err(|_| "widget registry store poisoned".to_string())?;
        let active_widget_id = state.active_widget_id.clone();

        if let Some(widget) = state
            .widgets
            .iter_mut()
            .find(|widget| widget.id == active_widget_id)
        {
            updater(widget);
        }

        Ok(())
    }
}

#[tauri::command]
pub fn load_widget_registry(store: State<'_, WidgetRegistryStore>) -> WidgetRegistryState {
    store.snapshot()
}

#[tauri::command]
pub fn sync_active_widget_bounds(
    window: WebviewWindow,
    store: State<'_, WidgetRegistryStore>,
) -> Result<WidgetRegistryState, String> {
    let position = window.outer_position().map_err(|error| error.to_string())?;
    let size = window.outer_size().map_err(|error| error.to_string())?;

    store.apply_active_widget_bounds(WidgetBounds {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    })?;

    Ok(store.snapshot())
}

pub fn apply_registry_geometry<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
    store: &WidgetRegistryStore,
) -> Result<(), String> {
    if let Some(bounds) = store.active_widget_bounds() {
        apply_bounds_to_window(window, &bounds)?;
    }

    Ok(())
}

pub fn set_active_widget_mode(
    store: &WidgetRegistryStore,
    mode: WidgetWindowMode,
) -> Result<(), String> {
    store.apply_active_widget_mode(mode)
}

pub fn save_window_bounds<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
    store: &WidgetRegistryStore,
) -> Result<(), String> {
    let position = window.outer_position().map_err(|error| error.to_string())?;
    let size = window.outer_size().map_err(|error| error.to_string())?;

    store.apply_active_widget_bounds(WidgetBounds {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    })
}

pub fn apply_bounds_to_window<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
    bounds: &WidgetBounds,
) -> Result<(), String> {
    window
        .set_position(Position::Physical(PhysicalPosition {
            x: bounds.x,
            y: bounds.y,
        }))
        .map_err(|error| error.to_string())?;
    window
        .set_size(Size::Physical(PhysicalSize {
            width: bounds.width,
            height: bounds.height,
        }))
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn default_widget_registry() -> WidgetRegistryState {
    WidgetRegistryState {
        active_widget_id: "schedule-main".into(),
        widgets: vec![WidgetInstance {
            id: "schedule-main".into(),
            widget_type: WidgetType::Schedule,
            title: "教师课程表".into(),
            mode: WidgetWindowMode::Attached,
            bounds: WidgetBounds {
                x: 520,
                y: 52,
                width: 700,
                height: 760,
            },
            skin_id: "midnight-coral".into(),
            visible: true,
        }],
    }
}
