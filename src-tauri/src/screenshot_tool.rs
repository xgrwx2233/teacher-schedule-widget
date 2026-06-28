use std::{
    fs,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use tauri::{AppHandle, Manager};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotSaveResult {
    pub path: Option<String>,
    pub cancelled: bool,
}

#[tauri::command]
pub fn save_group_share_poster_png(
    app: AppHandle,
    png_bytes: Vec<u8>,
    file_name: Option<String>,
) -> Result<ScreenshotSaveResult, String> {
    if png_bytes.is_empty() {
        return Err("empty group share poster image".to_string());
    }
    let default_dir = app
        .path()
        .picture_dir()
        .or_else(|_| app.path().download_dir())
        .or_else(|_| app.path().desktop_dir())
        .map_err(|error| error.to_string())?;
    let safe_name = sanitize_png_filename(
        file_name
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or("群聊邀请.png"),
    );
    let Some(path) = rfd::FileDialog::new()
        .set_title("保存群聊邀请")
        .set_directory(default_dir)
        .set_file_name(&safe_name)
        .add_filter("PNG 图片", &["png"])
        .save_file()
    else {
        return Ok(ScreenshotSaveResult {
            path: None,
            cancelled: true,
        });
    };
    let target = ensure_png_extension(path);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(&target, png_bytes).map_err(|error| error.to_string())?;
    Ok(ScreenshotSaveResult {
        path: Some(target.to_string_lossy().to_string()),
        cancelled: false,
    })
}

fn default_screenshot_filename() -> String {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    format!("教师助手_截图_{seconds}.png")
}

fn ensure_png_extension(path: PathBuf) -> PathBuf {
    if path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case("png"))
        .unwrap_or(false)
    {
        return path;
    }
    let mut next = path;
    next.set_extension("png");
    next
}

fn sanitize_png_filename(value: &str) -> String {
    let mut name: String = value
        .chars()
        .map(|ch| match ch {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            _ => ch,
        })
        .collect();
    name = name.trim().trim_matches('.').to_string();
    if name.is_empty() {
        name = default_screenshot_filename();
    }
    if !name.to_ascii_lowercase().ends_with(".png") {
        name.push_str(".png");
    }
    name
}
