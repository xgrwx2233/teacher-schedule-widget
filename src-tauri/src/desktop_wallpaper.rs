use serde::Serialize;
use std::{fs, path::Path};
use tauri::WebviewWindow;
use base64::{engine::general_purpose, Engine as _};
use windows::{
    core::{Error, PCWSTR, PWSTR, HRESULT},
    Win32::{
        Foundation::RECT,
        System::Com::{CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL, COINIT_APARTMENTTHREADED},
        UI::Shell::{DesktopWallpaper, IDesktopWallpaper, DWPOS_CENTER, DWPOS_FILL, DWPOS_FIT, DWPOS_SPAN, DWPOS_STRETCH, DWPOS_TILE},
    },
};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopWallpaperInfo {
    pub path: Option<String>,
    pub url: Option<String>,
    pub monitor_left: i32,
    pub monitor_top: i32,
    pub monitor_width: i32,
    pub monitor_height: i32,
    pub window_left: i32,
    pub window_top: i32,
    pub window_width: u32,
    pub window_height: u32,
    pub wallpaper_left: i32,
    pub wallpaper_top: i32,
    pub wallpaper_width: i32,
    pub wallpaper_height: i32,
}

struct ComApartment {
    initialized: bool,
}

impl ComApartment {
    fn init() -> Result<Self, String> {
        unsafe {
            let result: HRESULT = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
            if result.is_ok() {
                Ok(Self { initialized: true })
            } else if result.0 as u32 == 0x80010106 {
                Ok(Self { initialized: false })
            } else {
                Err(Error::from(result).to_string())
            }
        }
    }
}

impl Drop for ComApartment {
    fn drop(&mut self) {
        if self.initialized {
            unsafe {
                CoUninitialize();
            }
        }
    }
}

#[tauri::command]
pub fn get_desktop_wallpaper(window: WebviewWindow) -> Result<DesktopWallpaperInfo, String> {
    let window_position = window.outer_position().map_err(|error| error.to_string())?;
    let window_size = window.outer_size().map_err(|error| error.to_string())?;
    let window_center_x = window_position.x + (window_size.width as i32 / 2);
    let window_center_y = window_position.y + (window_size.height as i32 / 2);

    let _com = ComApartment::init()?;
    let wallpaper: IDesktopWallpaper =
        unsafe { CoCreateInstance(&DesktopWallpaper, None, CLSCTX_ALL) }
            .map_err(|error| error.to_string())?;

    let count = unsafe { wallpaper.GetMonitorDevicePathCount() }
        .map_err(|error| error.to_string())?;
    let position = unsafe { wallpaper.GetPosition() }.unwrap_or(DWPOS_FILL);

    let mut fallback: Option<(String, RECT)> = None;
    let mut selected: Option<(String, RECT)> = None;

    for index in 0..count {
        let monitor_id = unsafe { wallpaper.GetMonitorDevicePathAt(index) }
            .map_err(|error| error.to_string())?;
        let monitor_id_pcwstr = PCWSTR(monitor_id.as_ptr());

        let rect = unsafe { wallpaper.GetMonitorRECT(monitor_id_pcwstr) }
            .map_err(|error| {
                free_pwstr(monitor_id);
                error.to_string()
            })?;

        let path = unsafe {
            wallpaper
                .GetWallpaper(monitor_id_pcwstr)
                .ok()
                .map(pwstr_to_string_and_free)
                .unwrap_or_default()
        };
        free_pwstr(monitor_id);

        if fallback.is_none() {
            fallback = Some((path.clone(), rect));
        }

        let contains_window = window_center_x >= rect.left
            && window_center_x < rect.right
            && window_center_y >= rect.top
            && window_center_y < rect.bottom;

        if contains_window {
            selected = Some((path, rect));
            break;
        }
    }

    let (path, rect) = selected
        .or(fallback)
        .unwrap_or_else(|| (String::new(), RECT::default()));
    let wallpaper_rect = calculate_wallpaper_rect(&path, rect, position.0);

    Ok(DesktopWallpaperInfo {
        path: if path.trim().is_empty() { None } else { Some(path.clone()) },
        url: data_url_from_path(&path).or_else(|| file_url_from_path(&path)),
        monitor_left: rect.left,
        monitor_top: rect.top,
        monitor_width: rect.right - rect.left,
        monitor_height: rect.bottom - rect.top,
        window_left: window_position.x,
        window_top: window_position.y,
        window_width: window_size.width,
        window_height: window_size.height,
        wallpaper_left: wallpaper_rect.left,
        wallpaper_top: wallpaper_rect.top,
        wallpaper_width: wallpaper_rect.right - wallpaper_rect.left,
        wallpaper_height: wallpaper_rect.bottom - wallpaper_rect.top,
    })
}

fn calculate_wallpaper_rect(path: &str, monitor: RECT, position: i32) -> RECT {
    let monitor_width = (monitor.right - monitor.left).max(1) as f64;
    let monitor_height = (monitor.bottom - monitor.top).max(1) as f64;
    let (image_width, image_height) = image::image_dimensions(path).unwrap_or((
        monitor_width as u32,
        monitor_height as u32,
    ));
    let image_width = image_width.max(1) as f64;
    let image_height = image_height.max(1) as f64;

    if position == DWPOS_STRETCH.0 {
        return monitor;
    }

    let scale = if position == DWPOS_FIT.0 {
        (monitor_width / image_width).min(monitor_height / image_height)
    } else {
        // Windows 11 defaults to Fill; Span and Tile are approximated as Fill
        // for the widget-local wallpaper material.
        (monitor_width / image_width).max(monitor_height / image_height)
    };

    let draw_width = (image_width * scale).round() as i32;
    let draw_height = (image_height * scale).round() as i32;
    let left = monitor.left + ((monitor_width as i32 - draw_width) / 2);
    let top = monitor.top + ((monitor_height as i32 - draw_height) / 2);

    if position == DWPOS_CENTER.0 {
        let centered_width = image_width.round() as i32;
        let centered_height = image_height.round() as i32;
        let centered_left = monitor.left + ((monitor_width as i32 - centered_width) / 2);
        let centered_top = monitor.top + ((monitor_height as i32 - centered_height) / 2);
        return RECT {
            left: centered_left,
            top: centered_top,
            right: centered_left + centered_width,
            bottom: centered_top + centered_height,
        };
    }

    if position == DWPOS_TILE.0 {
        return RECT {
            left: monitor.left,
            top: monitor.top,
            right: monitor.left + image_width.round() as i32,
            bottom: monitor.top + image_height.round() as i32,
        };
    }

    if position == DWPOS_SPAN.0 {
        return RECT {
            left,
            top,
            right: left + draw_width,
            bottom: top + draw_height,
        };
    }

    RECT {
        left,
        top,
        right: left + draw_width,
        bottom: top + draw_height,
    }
}

fn file_url_from_path(path: &str) -> Option<String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return None;
    }

    let normalized = trimmed.replace('\\', "/");
    let prefixed = if normalized.starts_with('/') {
        format!("file://{}", normalized)
    } else {
        format!("file:///{}", normalized)
    };

    Some(prefixed.replace(' ', "%20"))
}

fn data_url_from_path(path: &str) -> Option<String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return None;
    }

    let bytes = fs::read(trimmed).ok()?;
    let mime = match Path::new(trimmed)
        .extension()
        .and_then(|item| item.to_str())
        .map(|item| item.to_ascii_lowercase())
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("bmp") => "image/bmp",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        _ => "image/jpeg",
    };

    Some(format!(
        "data:{};base64,{}",
        mime,
        general_purpose::STANDARD.encode(bytes)
    ))
}

fn pwstr_to_string_and_free(value: PWSTR) -> String {
    if value.is_null() {
        return String::new();
    }

    let text = unsafe { value.to_string().unwrap_or_default() };
    free_pwstr(value);
    text
}

fn free_pwstr(value: PWSTR) {
    if !value.is_null() {
        unsafe {
            CoTaskMemFree(Some(value.as_ptr().cast()));
        }
    }
}
