use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredWidgetSettings {
    pub schema_version: u32,
    pub preferred_mode: String,
    pub active_skin_id: String,
    pub schedule_id: String,
}

#[tauri::command]
pub fn load_widget_settings() -> StoredWidgetSettings {
    StoredWidgetSettings {
        schema_version: 1,
        preferred_mode: "attached".to_string(),
        active_skin_id: "midnight-coral".to_string(),
        schedule_id: "mock-teacher-week".to_string(),
    }
}
