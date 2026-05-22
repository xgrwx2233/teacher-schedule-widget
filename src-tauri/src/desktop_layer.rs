use tauri::Runtime;
use windows::{
    core::{s, BOOL},
    Win32::{
        Foundation::{HWND, LPARAM, WPARAM},
        UI::WindowsAndMessaging::{
            EnumWindows, FindWindowA, FindWindowExA, GetParent, GetWindowLongPtrW,
            IsWindowVisible, SendMessageTimeoutA, SetParent, SetWindowLongPtrW, SetWindowPos,
            ShowWindow, GWL_STYLE, HWND_BOTTOM, HWND_TOP, SMTO_NORMAL, SWP_FRAMECHANGED,
            SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOOWNERZORDER, SWP_NOSIZE, SWP_SHOWWINDOW, SW_SHOW,
            WS_CHILD, WS_POPUP,
        },
    },
};

type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;

/// Finds the WorkerW desktop host behind SHELLDLL_DefView.
///
/// The app uses this WorkerW as a wallpaper-like host so the widget sits above
/// the wallpaper but below desktop icons.
fn find_worker_w() -> Result<HWND> {
    unsafe {
        let progman = FindWindowA(s!("Progman"), None)?;

        let _ = SendMessageTimeoutA(
            progman,
            0x052C,
            WPARAM(0xD),
            LPARAM(0x1),
            SMTO_NORMAL,
            1000,
            None,
        );

        let mut worker_w = HWND::default();
        EnumWindows(
            Some(enum_windows_find_worker_w),
            LPARAM(&mut worker_w as *mut HWND as isize),
        )?;

        if worker_w.is_invalid() {
            worker_w =
                FindWindowExA(Some(progman), None, s!("WorkerW"), None).unwrap_or(HWND::default());
        }

        if worker_w.is_invalid() {
            Err("WorkerW not found".into())
        } else {
            Ok(worker_w)
        }
    }
}

extern "system" fn enum_windows_find_worker_w(window: HWND, state: LPARAM) -> BOOL {
    unsafe {
        let shell_view =
            FindWindowExA(Some(window), None, s!("SHELLDLL_DefView"), None).unwrap_or_default();

        if !shell_view.is_invalid() {
            let worker_w =
                FindWindowExA(None, Some(window), s!("WorkerW"), None).unwrap_or_default();
            if !worker_w.is_invalid() {
                *(state.0 as *mut HWND) = worker_w;
                return BOOL(0);
            }
        }

        BOOL(1)
    }
}

pub fn attach_to_desktop_icon_layer<R: Runtime>(window: &tauri::WebviewWindow<R>) -> Result<()> {
    let hwnd = HWND(window.hwnd()?.0);
    let worker_w = find_worker_w()?;

    unsafe {
        set_child_window_style(hwnd);

        if GetParent(hwnd).ok() != Some(worker_w) {
            SetParent(hwnd, Some(worker_w))?;
        }

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
    }

    Ok(())
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
    let worker_w = find_worker_w()?;

    unsafe {
        let parent_ok = GetParent(hwnd).ok() == Some(worker_w);
        let visible = IsWindowVisible(hwnd).as_bool();
        Ok(parent_ok && visible)
    }
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
