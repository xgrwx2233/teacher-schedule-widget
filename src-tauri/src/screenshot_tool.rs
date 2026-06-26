use std::{
    ffi::c_void,
    fs::{self, File},
    mem::{size_of, zeroed},
    path::{Path, PathBuf},
    ptr::null_mut,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use image::{codecs::bmp::BmpEncoder, ColorType, ImageEncoder, RgbaImage};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use windows::Win32::{
    Foundation::HANDLE,
    Graphics::Gdi::{
        BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC,
        GetDIBits, ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
        HBITMAP, HGDIOBJ, SRCCOPY,
    },
    System::{
        DataExchange::{CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData},
        Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE},
    },
    UI::WindowsAndMessaging::{
        GetSystemMetrics, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN,
        SM_YVIRTUALSCREEN,
    },
};

const CF_DIB_FORMAT: u32 = 8;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotCapturePayload {
    pub image_path: String,
    pub width: u32,
    pub height: u32,
    pub screen_left: i32,
    pub screen_top: i32,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotSaveResult {
    pub path: Option<String>,
    pub cancelled: bool,
}

#[tauri::command]
pub fn capture_screenshot_screen(app: AppHandle) -> Result<ScreenshotCapturePayload, String> {
    let capture = capture_virtual_screen()?;
    let image_path = write_preview_bitmap(&app, &capture)?;
    Ok(ScreenshotCapturePayload {
        image_path: image_path.to_string_lossy().to_string(),
        width: capture.width,
        height: capture.height,
        screen_left: capture.left,
        screen_top: capture.top,
    })
}

#[tauri::command]
pub fn save_screenshot_png(app: AppHandle, png_bytes: Vec<u8>) -> Result<ScreenshotSaveResult, String> {
    if png_bytes.is_empty() {
        return Err("empty screenshot image".to_string());
    }
    let default_dir = app
        .path()
        .picture_dir()
        .or_else(|_| app.path().download_dir())
        .or_else(|_| app.path().desktop_dir())
        .map_err(|error| error.to_string())?;
    let Some(path) = rfd::FileDialog::new()
        .set_title("保存截图")
        .set_directory(default_dir)
        .set_file_name(default_screenshot_filename())
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

#[tauri::command]
pub fn copy_screenshot_png_to_clipboard(png_bytes: Vec<u8>) -> Result<(), String> {
    if png_bytes.is_empty() {
        return Err("empty screenshot image".to_string());
    }
    let image = image::load_from_memory(&png_bytes)
        .map_err(|error| format!("decode screenshot failed: {error}"))?
        .to_rgba8();
    write_rgba_to_clipboard(&image)
}

struct VirtualScreenCapture {
    width: u32,
    height: u32,
    left: i32,
    top: i32,
    pixels: Vec<u8>,
}

fn capture_virtual_screen() -> Result<VirtualScreenCapture, String> {
    unsafe {
        let left = GetSystemMetrics(SM_XVIRTUALSCREEN);
        let top = GetSystemMetrics(SM_YVIRTUALSCREEN);
        let width = GetSystemMetrics(SM_CXVIRTUALSCREEN);
        let height = GetSystemMetrics(SM_CYVIRTUALSCREEN);
        if width <= 0 || height <= 0 {
            return Err("invalid virtual screen size".to_string());
        }

        let screen_dc = GetDC(None);
        if screen_dc.0 == null_mut() {
            return Err("GetDC failed".to_string());
        }
        let memory_dc = CreateCompatibleDC(Some(screen_dc));
        if memory_dc.0 == null_mut() {
            let _ = ReleaseDC(None, screen_dc);
            return Err("CreateCompatibleDC failed".to_string());
        }
        let bitmap = CreateCompatibleBitmap(screen_dc, width, height);
        if bitmap.0 == null_mut() {
            let _ = DeleteDC(memory_dc);
            let _ = ReleaseDC(None, screen_dc);
            return Err("CreateCompatibleBitmap failed".to_string());
        }
        let previous = SelectObject(memory_dc, HGDIOBJ(bitmap.0));
        if BitBlt(
            memory_dc,
            0,
            0,
            width,
            height,
            Some(screen_dc),
            left,
            top,
            SRCCOPY,
        )
        .is_err()
        {
            let _ = SelectObject(memory_dc, previous);
            let _ = DeleteObject(HGDIOBJ(bitmap.0));
            let _ = DeleteDC(memory_dc);
            let _ = ReleaseDC(None, screen_dc);
            return Err("BitBlt failed".to_string());
        }

        let mut info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width,
                biHeight: -height,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..zeroed()
            },
            ..zeroed()
        };
        let mut bgra = vec![0u8; width as usize * height as usize * 4];
        let lines = GetDIBits(
            memory_dc,
            HBITMAP(bitmap.0),
            0,
            height as u32,
            Some(bgra.as_mut_ptr() as *mut c_void),
            &mut info,
            DIB_RGB_COLORS,
        );

        let _ = SelectObject(memory_dc, previous);
        let _ = DeleteObject(HGDIOBJ(bitmap.0));
        let _ = DeleteDC(memory_dc);
        let _ = ReleaseDC(None, screen_dc);

        if lines == 0 {
            return Err("GetDIBits failed".to_string());
        }

        for pixel in bgra.chunks_exact_mut(4) {
            pixel.swap(0, 2);
            pixel[3] = 255;
        }

        Ok(VirtualScreenCapture {
            width: width as u32,
            height: height as u32,
            left,
            top,
            pixels: bgra,
        })
    }
}

fn write_preview_bitmap(
    app: &AppHandle,
    capture: &VirtualScreenCapture,
) -> Result<PathBuf, String> {
    let mut cache_dir = app
        .path()
        .app_cache_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("teacher-schedule-widget"));
    cache_dir.push("screenshots");
    fs::create_dir_all(&cache_dir).map_err(|error| error.to_string())?;
    cleanup_old_preview_bitmaps(&cache_dir);

    let path = cache_dir.join(format!(
        "screenshot-preview-{}-{}x{}.bmp",
        timestamp_millis(),
        capture.width,
        capture.height,
    ));
    let mut file = File::create(&path).map_err(|error| error.to_string())?;
    let encoder = BmpEncoder::new(&mut file);
    encoder
        .write_image(
            &capture.pixels,
            capture.width,
            capture.height,
            ColorType::Rgba8.into(),
        )
        .map_err(|error| error.to_string())?;
    Ok(path)
}

fn cleanup_old_preview_bitmaps(cache_dir: &Path) {
    let cutoff = SystemTime::now()
        .checked_sub(Duration::from_secs(10 * 60))
        .unwrap_or(UNIX_EPOCH);
    let Ok(entries) = fs::read_dir(cache_dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let should_remove = path
            .file_name()
            .and_then(|value| value.to_str())
            .map(|name| {
                name.starts_with("screenshot-preview-")
                    && name.to_ascii_lowercase().ends_with(".bmp")
            })
            .unwrap_or(false)
            && entry
                .metadata()
                .and_then(|metadata| metadata.modified())
                .map(|modified| modified < cutoff)
                .unwrap_or(false);
        if should_remove {
            let _ = fs::remove_file(path);
        }
    }
}

fn timestamp_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

fn write_rgba_to_clipboard(image: &RgbaImage) -> Result<(), String> {
    let width = image.width();
    let height = image.height();
    if width == 0 || height == 0 {
        return Err("empty screenshot image".to_string());
    }
    let row_stride = width as usize * 4;
    let pixel_bytes = row_stride * height as usize;
    let header_size = size_of::<BITMAPINFOHEADER>();
    let total_size = header_size + pixel_bytes;

    unsafe {
        let memory = GlobalAlloc(GMEM_MOVEABLE, total_size)
            .map_err(|error| format!("GlobalAlloc failed: {error}"))?;
        let locked = GlobalLock(memory);
        if locked.is_null() {
            return Err("GlobalLock failed".to_string());
        }

        let header = locked as *mut BITMAPINFOHEADER;
        *header = BITMAPINFOHEADER {
            biSize: header_size as u32,
            biWidth: width as i32,
            biHeight: height as i32,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            biSizeImage: pixel_bytes as u32,
            ..zeroed()
        };

        let destination = (locked as *mut u8).add(header_size);
        let pixels = image.as_raw();
        for row in 0..height as usize {
            let source_row = height as usize - 1 - row;
            let source_offset = source_row * row_stride;
            let target_offset = row * row_stride;
            for column in 0..width as usize {
                let source = source_offset + column * 4;
                let target = target_offset + column * 4;
                *destination.add(target) = pixels[source + 2];
                *destination.add(target + 1) = pixels[source + 1];
                *destination.add(target + 2) = pixels[source];
                *destination.add(target + 3) = pixels[source + 3];
            }
        }

        let _ = GlobalUnlock(memory);

        OpenClipboard(None).map_err(|error| format!("OpenClipboard failed: {error}"))?;
        EmptyClipboard().map_err(|error| format!("EmptyClipboard failed: {error}"))?;
        let clipboard_result =
            SetClipboardData(CF_DIB_FORMAT, Some(HANDLE(memory.0)));
        let _ = CloseClipboard();
        clipboard_result.map_err(|error| format!("SetClipboardData failed: {error}"))?;
    }

    Ok(())
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
        name = "群聊邀请.png".to_string();
    }
    if !name.to_lowercase().ends_with(".png") {
        name.push_str(".png");
    }
    name
}
