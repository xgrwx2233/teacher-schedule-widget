use serde::{Deserialize, Serialize};

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

#[tauri::command]
pub fn load_widget_registry() -> WidgetRegistryState {
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
