use std::mem::size_of;

use windows::core::BOOL;
use windows::{
    core::s,
    Win32::{
        Foundation::{CloseHandle, HWND, LPARAM, POINT, RECT},
        Graphics::Gdi::MapWindowPoints,
        System::{
            Diagnostics::Debug::{ReadProcessMemory, WriteProcessMemory},
            Memory::{
                VirtualAllocEx, VirtualFreeEx, MEM_COMMIT, MEM_RELEASE, MEM_RESERVE, PAGE_READWRITE,
            },
            Threading::{OpenProcess, PROCESS_VM_OPERATION, PROCESS_VM_READ, PROCESS_VM_WRITE},
        },
        UI::{
            Controls::{LVHITTESTINFO, LVHT_NOWHERE, LVM_HITTEST},
            WindowsAndMessaging::{
                EnumWindows, FindWindowA, FindWindowExA, GetWindowRect, GetWindowThreadProcessId,
                SendMessageW,
            },
        },
    },
};

type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;

pub fn is_desktop_icon_at_screen_point(screen_x: i32, screen_y: i32) -> bool {
    desktop_icon_hit_test(screen_x, screen_y).unwrap_or(false)
}

fn desktop_icon_hit_test(screen_x: i32, screen_y: i32) -> Result<bool> {
    let list_view = find_desktop_list_view()?;
    let mut list_point = POINT {
        x: screen_x,
        y: screen_y,
    };

    unsafe {
        let mut rect = RECT::default();
        GetWindowRect(list_view, &mut rect)?;
        if screen_x < rect.left
            || screen_x >= rect.right
            || screen_y < rect.top
            || screen_y >= rect.bottom
        {
            return Ok(false);
        }

        MapWindowPoints(None, Some(list_view), std::slice::from_mut(&mut list_point));

        let mut process_id = 0;
        GetWindowThreadProcessId(list_view, Some(&mut process_id));
        if process_id == 0 {
            return Ok(false);
        }

        let process = OpenProcess(
            PROCESS_VM_OPERATION | PROCESS_VM_READ | PROCESS_VM_WRITE,
            false,
            process_id,
        )?;

        let remote_info = VirtualAllocEx(
            process,
            None,
            size_of::<LVHITTESTINFO>(),
            MEM_RESERVE | MEM_COMMIT,
            PAGE_READWRITE,
        );

        if remote_info.is_null() {
            let _ = CloseHandle(process);
            return Ok(false);
        }

        let mut hit_info = LVHITTESTINFO::default();
        hit_info.pt = list_point;

        let mut bytes_written = 0;
        WriteProcessMemory(
            process,
            remote_info,
            &hit_info as *const LVHITTESTINFO as *const _,
            size_of::<LVHITTESTINFO>(),
            Some(&mut bytes_written),
        )?;

        let result = SendMessageW(
            list_view,
            LVM_HITTEST,
            None,
            Some(LPARAM(remote_info as isize)),
        );

        let mut bytes_read = 0;
        ReadProcessMemory(
            process,
            remote_info,
            &mut hit_info as *mut LVHITTESTINFO as *mut _,
            size_of::<LVHITTESTINFO>(),
            Some(&mut bytes_read),
        )?;

        let _ = VirtualFreeEx(process, remote_info, 0, MEM_RELEASE);
        let _ = CloseHandle(process);

        Ok(result.0 >= 0 && (hit_info.flags.0 & LVHT_NOWHERE.0) == 0)
    }
}

fn find_desktop_list_view() -> Result<HWND> {
    unsafe {
        let progman = FindWindowA(s!("Progman"), None)?;

        if let Some(list_view) = find_list_view_under(progman) {
            return Ok(list_view);
        }

        let mut found = HWND::default();
        EnumWindows(
            Some(enum_windows_find_desktop_list_view),
            LPARAM(&mut found as *mut HWND as isize),
        )?;

        if found.is_invalid() {
            Err("desktop SysListView32 not found".into())
        } else {
            Ok(found)
        }
    }
}

unsafe fn find_list_view_under(parent: HWND) -> Option<HWND> {
    let shell_view = FindWindowExA(Some(parent), None, s!("SHELLDLL_DefView"), None).ok()?;
    let list_view = FindWindowExA(Some(shell_view), None, s!("SysListView32"), None).ok()?;
    if list_view.is_invalid() {
        None
    } else {
        Some(list_view)
    }
}

extern "system" fn enum_windows_find_desktop_list_view(window: HWND, state: LPARAM) -> BOOL {
    unsafe {
        if let Some(list_view) = find_list_view_under(window) {
            *(state.0 as *mut HWND) = list_view;
            return BOOL(0);
        }

        BOOL(1)
    }
}
