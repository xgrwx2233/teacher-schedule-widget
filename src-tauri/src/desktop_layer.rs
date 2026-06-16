use std::{thread, time::Duration};

use serde::Serialize;
use tauri::Runtime;
use windows::{
    core::{s, BOOL},
    Win32::{
        Foundation::{HWND, LPARAM, RECT, WPARAM},
        UI::WindowsAndMessaging::{
            EnumWindows, FindWindowA, FindWindowExA, GetParent, GetWindowLongPtrW, GetWindowRect,
            IsWindowVisible, MoveWindow, SendMessageTimeoutA, SetParent, SetWindowLongPtrW,
            SetWindowPos, ShowWindow, GWL_STYLE, HWND_BOTTOM, HWND_TOP, SMTO_NORMAL,
            SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOOWNERZORDER, SWP_NOSIZE,
            SWP_SHOWWINDOW, SW_SHOW, WS_CHILD, WS_POPUP,
        },
    },
};

type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;
const WORKERW_SPAWN_MESSAGE: u32 = 0x052C;

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopAttachDiagnostics {
    pub progman_found: bool,
    pub shell_view_host_found: bool,
    pub worker_w_found: bool,
    pub attached: bool,
    pub window_visible: bool,
    pub parent_is_worker_w: bool,
    pub error: Option<String>,
}

/// Finds the WorkerW desktop host behind SHELLDLL_DefView.
///
/// The app uses this WorkerW as a wallpaper-like host so the widget sits above
/// the wallpaper but below desktop icons.
fn find_wallpaper_worker_w() -> Result<HWND> {
    unsafe {
        spawn_worker_w();

        if let Some(worker_w) = find_worker_w_behind_shell_view()? {
            return Ok(worker_w);
        }

        Err("WorkerW not found".into())
    }
}

unsafe fn spawn_worker_w() {
    let progman = FindWindowA(s!("Progman"), None).unwrap_or_default();
    if progman.is_invalid() {
        return;
    }

    for (wparam, lparam) in [(0xD, 0x1), (0, 0)] {
        let _ = SendMessageTimeoutA(
            progman,
            WORKERW_SPAWN_MESSAGE,
            WPARAM(wparam),
            LPARAM(lparam),
            SMTO_NORMAL,
            1000,
            None,
        );
        thread::sleep(Duration::from_millis(80));
    }
}

fn find_worker_w_behind_shell_view() -> Result<Option<HWND>> {
    let mut state = DesktopHostSearch::default();
    unsafe {
        EnumWindows(
            Some(enum_windows_find_desktop_host),
            LPARAM(&mut state as *mut DesktopHostSearch as isize),
        )?;
    }
    Ok(state.worker_after_shell_view)
}

#[derive(Default)]
struct DesktopHostSearch {
    worker_after_shell_view: Option<HWND>,
}

extern "system" fn enum_windows_find_desktop_host(window: HWND, state: LPARAM) -> BOOL {
    unsafe {
        let shell_view =
            FindWindowExA(Some(window), None, s!("SHELLDLL_DefView"), None).unwrap_or_default();

        if shell_view.is_invalid() {
            return BOOL(1);
        }

        let search = &mut *(state.0 as *mut DesktopHostSearch);
        let worker_w = FindWindowExA(None, Some(window), s!("WorkerW"), None).unwrap_or_default();
        if !worker_w.is_invalid() {
            search.worker_after_shell_view = Some(worker_w);
            return BOOL(0);
        }

        BOOL(0)
    }
}

pub fn attach_to_desktop_icon_layer<R: Runtime>(window: &tauri::WebviewWindow<R>) -> Result<()> {
    let hwnd = HWND(window.hwnd()?.0);
    let worker_w = find_wallpaper_worker_w()?;

    unsafe {
        let mut screen_rect = RECT::default();
        GetWindowRect(hwnd, &mut screen_rect)?;

        set_child_window_style(hwnd);

        if GetParent(hwnd).ok() != Some(worker_w) {
            SetParent(hwnd, Some(worker_w))?;
        }

        let mut worker_rect = RECT::default();
        GetWindowRect(worker_w, &mut worker_rect)?;
        let x = screen_rect.left - worker_rect.left;
        let y = screen_rect.top - worker_rect.top;
        let width = (screen_rect.right - screen_rect.left).max(1);
        let height = (screen_rect.bottom - screen_rect.top).max(1);

        MoveWindow(hwnd, x, y, width, height, true)?;
        SetWindowPos(
            hwnd,
            Some(HWND_BOTTOM),
            0,
            0,
            0,
            0,
            SWP_NOACTIVATE
                | SWP_NOMOVE
                | SWP_NOSIZE
                | SWP_NOOWNERZORDER
                | SWP_FRAMECHANGED
                | SWP_SHOWWINDOW,
        )?;
        let _ = ShowWindow(hwnd, SW_SHOW);

        if is_attached_to_desktop_host(hwnd, worker_w) {
            return Ok(());
        }
    }

    Err("failed to attach window to desktop host".into())
}

pub fn attach_diagnostics<R: Runtime>(
    window: &tauri::WebviewWindow<R>,
) -> DesktopAttachDiagnostics {
    let mut diagnostics = DesktopAttachDiagnostics::default();

    unsafe {
        diagnostics.progman_found = !FindWindowA(s!("Progman"), None)
            .unwrap_or_default()
            .is_invalid();
    }

    match find_worker_w_behind_shell_view() {
        Ok(worker_w) => {
            diagnostics.worker_w_found = worker_w.is_some();
            diagnostics.shell_view_host_found = worker_w.is_some();
        }
        Err(error) => {
            diagnostics.error = Some(error.to_string());
        }
    }

    let hwnd = match window.hwnd() {
        Ok(raw) => HWND(raw.0),
        Err(error) => {
            diagnostics.error = Some(error.to_string());
            return diagnostics;
        }
    };

    if let Ok(worker_w) = find_wallpaper_worker_w() {
        unsafe {
            diagnostics.parent_is_worker_w = GetParent(hwnd).ok() == Some(worker_w);
            diagnostics.window_visible = IsWindowVisible(hwnd).as_bool();
            diagnostics.attached = diagnostics.parent_is_worker_w && diagnostics.window_visible;
        }
    }

    diagnostics
}

pub fn detach_from_desktop_icon_layer<R: Runtime>(window: &tauri::WebviewWindow<R>) -> Result<()> {
    let hwnd = HWND(window.hwnd()?.0);

    unsafe {
        set_top_level_window_style(hwnd);
        SetParent(hwnd, None)?;
        SetWindowPos(
            hwnd,
            Some(HWND_TOP),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOOWNERZORDER | SWP_SHOWWINDOW | SWP_FRAMECHANGED,
        )?;
    }

    Ok(())
}

pub fn is_attached_to_desktop_icon_layer<R: Runtime>(
    window: &tauri::WebviewWindow<R>,
) -> Result<bool> {
    let hwnd = HWND(window.hwnd()?.0);
    let worker_w = find_wallpaper_worker_w()?;

    unsafe { Ok(is_attached_to_desktop_host(hwnd, worker_w)) }
}

unsafe fn is_attached_to_desktop_host(hwnd: HWND, desktop_host: HWND) -> bool {
    GetParent(hwnd).ok() == Some(desktop_host) && IsWindowVisible(hwnd).as_bool()
}

unsafe fn set_child_window_style(hwnd: HWND) {
    let style = GetWindowLongPtrW(hwnd, GWL_STYLE);
    let next_style = (style as u32 | WS_CHILD.0) & !WS_POPUP.0;
    SetWindowLongPtrW(hwnd, GWL_STYLE, next_style as isize);
}

unsafe fn set_top_level_window_style(hwnd: HWND) {
    let style = GetWindowLongPtrW(hwnd, GWL_STYLE);
    let next_style = (style as u32 | WS_POPUP.0) & !WS_CHILD.0;
    SetWindowLongPtrW(hwnd, GWL_STYLE, next_style as isize);
}
