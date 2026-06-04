use std::{mem::transmute, sync::OnceLock};
use tauri::{AppHandle, Emitter, WebviewWindow};
use windows::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, WPARAM},
    UI::WindowsAndMessaging::{
        CallWindowProcW, DefWindowProcW, SetWindowLongPtrW, GWLP_WNDPROC, WNDPROC,
    },
};

pub const DESKTOP_WALLPAPER_CHANGED_EVENT: &str = "desktop-wallpaper-changed";

const WM_SETTINGCHANGE: u32 = 0x001A;
const SPI_SETDESKWALLPAPER: usize = 0x0014;

static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();
static ORIGINAL_WNDPROC: OnceLock<isize> = OnceLock::new();

pub fn install_wallpaper_change_listener(window: &WebviewWindow, app: &AppHandle) -> Result<(), String> {
    if ORIGINAL_WNDPROC.get().is_some() {
        return Ok(());
    }

    let hwnd = HWND(window.hwnd().map_err(|error| error.to_string())?.0);
    let _ = APP_HANDLE.set(app.clone());

    let previous = unsafe {
        SetWindowLongPtrW(hwnd, GWLP_WNDPROC, wallpaper_wnd_proc as *const () as isize)
    };
    ORIGINAL_WNDPROC
        .set(previous)
        .map_err(|_| "wallpaper watcher already installed".to_string())?;

    Ok(())
}

unsafe extern "system" fn wallpaper_wnd_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if is_wallpaper_setting_change(msg, wparam, lparam) {
        if let Some(app) = APP_HANDLE.get() {
            let _ = app.emit(DESKTOP_WALLPAPER_CHANGED_EVENT, ());
        }
    }

    call_original_wnd_proc(hwnd, msg, wparam, lparam)
}

fn is_wallpaper_setting_change(msg: u32, wparam: WPARAM, lparam: LPARAM) -> bool {
    if msg != WM_SETTINGCHANGE {
        return false;
    }

    if wparam.0 == SPI_SETDESKWALLPAPER {
        return true;
    }

    read_lparam_string(lparam)
        .map(|section| {
            let normalized = section.to_ascii_lowercase();
            normalized.contains("desktop") || normalized.contains("wallpaper")
        })
        .unwrap_or(false)
}

fn read_lparam_string(lparam: LPARAM) -> Option<String> {
    let ptr = lparam.0 as *const u16;
    if ptr.is_null() {
        return None;
    }

    let mut len = 0usize;
    while len < 256 {
        let value = unsafe { *ptr.add(len) };
        if value == 0 {
            break;
        }
        len += 1;
    }

    if len == 0 {
        return None;
    }

    let slice = unsafe { std::slice::from_raw_parts(ptr, len) };
    Some(String::from_utf16_lossy(slice))
}

fn call_original_wnd_proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if let Some(previous) = ORIGINAL_WNDPROC.get().copied().filter(|value| *value != 0) {
        let previous_proc: WNDPROC = unsafe { transmute(previous) };
        return unsafe { CallWindowProcW(previous_proc, hwnd, msg, wparam, lparam) };
    }

    unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) }
}
