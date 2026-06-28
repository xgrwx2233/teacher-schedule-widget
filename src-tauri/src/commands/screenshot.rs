use std::{
    cell::RefCell,
    ffi::c_void,
    fs,
    mem::size_of,
    path::{Path, PathBuf},
    ptr::null_mut,
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use image::RgbaImage;
use serde::Serialize;
use tauri::{AppHandle, Manager};
use windows::core::{w, PCWSTR};
use windows::Win32::{
    Foundation::{COLORREF, HINSTANCE, HWND, LPARAM, LRESULT, POINT, RECT, SIZE, WPARAM},
    Graphics::Gdi::{
        BeginPaint, CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, DrawTextW,
        EndPaint, GetDC, ReleaseDC, SelectObject, SetBkMode, SetTextColor, AC_SRC_ALPHA,
        AC_SRC_OVER, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, BLENDFUNCTION, DIB_RGB_COLORS,
        DT_CENTER, DT_END_ELLIPSIS, DT_SINGLELINE, DT_VCENTER, HBITMAP, HDC, HGDIOBJ, PAINTSTRUCT,
        RGBQUAD, TRANSPARENT,
    },
    System::LibraryLoader::GetModuleHandleW,
    UI::{
        Input::KeyboardAndMouse::{ReleaseCapture, SetCapture, VK_ESCAPE},
        WindowsAndMessaging::{
            CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetMessageW,
            LoadCursorW, PostMessageW, PostQuitMessage, RegisterClassW, SetCursor,
            SetForegroundWindow, ShowWindow, TranslateMessage, UpdateLayeredWindow, CREATESTRUCTW,
            CS_HREDRAW, CS_VREDRAW, GWLP_USERDATA, IDC_ARROW, IDC_CROSS, IDC_HAND, IDC_SIZEALL,
            IDC_SIZENESW, IDC_SIZENS, IDC_SIZENWSE, IDC_SIZEWE, MSG, SW_SHOW, ULW_ALPHA, WM_APP,
            WM_CANCELMODE, WM_CREATE, WM_DESTROY, WM_ERASEBKGND, WM_KEYDOWN, WM_KILLFOCUS,
            WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MOUSEMOVE, WM_PAINT, WM_RBUTTONDOWN, WNDCLASSW,
            WS_EX_LAYERED, WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_POPUP,
        },
    },
};
use xcap::Monitor;

const MIN_SELECTION_SIZE: i32 = 8;
const WM_SCREENSHOT_RENDER: u32 = WM_APP + 77;
const SELECTION_ALPHA: u8 = 1;
const DIM_ALPHA: u8 = 155;
const HANDLE_DRAW_SIZE: i32 = 8;
const HANDLE_HIT_SIZE: i32 = 18;
const TOOLBAR_HEIGHT: i32 = 38;
const TOOLBAR_MARGIN: i32 = 10;
const TOOLBAR_PADDING_X: i32 = 8;
const TOOLBAR_BUTTON_GAP: i32 = 6;
const SCREEN_PADDING: i32 = 8;

#[derive(Clone, Copy, Debug)]
struct CaptureRegionRequest {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    scale_factor: f64,
}

#[derive(Clone, Copy, Debug)]
struct MonitorBounds {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

#[derive(Clone, Copy, Debug, Default)]
struct SelectionRect {
    left: i32,
    top: i32,
    width: u32,
    height: u32,
}

impl SelectionRect {
    fn right(self) -> i32 {
        self.left + self.width as i32
    }

    fn bottom(self) -> i32 {
        self.top + self.height as i32
    }

    fn is_valid(self) -> bool {
        self.width as i32 >= MIN_SELECTION_SIZE && self.height as i32 >= MIN_SELECTION_SIZE
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum OverlayMode {
    Selecting,
    Adjusting,
    Moving,
    Resizing(ResizeHandle),
    Editing,
    Confirmed,
    Cancelled,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ResizeHandle {
    TopLeft,
    Top,
    TopRight,
    Right,
    BottomRight,
    Bottom,
    BottomLeft,
    Left,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ToolButton {
    Pen,
    Cancel,
    Send,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum HitTarget {
    Handle(ResizeHandle),
    InsideSelection,
    ToolbarButton(ToolButton),
    Outside,
}

#[derive(Debug)]
enum NativeSelectionResult {
    Selected(SelectionRect),
    Cancelled,
}

#[derive(Debug)]
struct NativeSelectionState {
    monitor: MonitorBounds,
    mode: OverlayMode,
    pointer_down: bool,
    drag_start_x: i32,
    drag_start_y: i32,
    drag_origin: Option<SelectionRect>,
    selection: Option<SelectionRect>,
    active_tool: Option<ToolButton>,
    render_pending: bool,
    renderer: Option<OverlayRenderer>,
}

#[derive(Debug)]
struct OverlayRenderer {
    screen_dc: HDC,
    memory_dc: HDC,
    bitmap: HBITMAP,
    previous_bitmap: HGDIOBJ,
    bits: *mut u32,
    width: i32,
    height: i32,
}

impl OverlayRenderer {
    unsafe fn create(hwnd: HWND, width: i32, height: i32) -> Result<Self, String> {
        let screen_dc = GetDC(Some(hwnd));
        if screen_dc.0.is_null() {
            return Err("failed to get screenshot overlay device context".to_string());
        }

        let memory_dc = CreateCompatibleDC(Some(screen_dc));
        if memory_dc.0.is_null() {
            let _ = ReleaseDC(Some(hwnd), screen_dc);
            return Err("failed to create screenshot overlay memory context".to_string());
        }

        let mut bits = null_mut::<c_void>();
        let bitmap_info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width,
                biHeight: -height,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                biSizeImage: (width * height * 4).max(0) as u32,
                ..Default::default()
            },
            bmiColors: [RGBQUAD::default()],
        };
        let bitmap = CreateDIBSection(
            Some(screen_dc),
            &bitmap_info,
            DIB_RGB_COLORS,
            &mut bits,
            None,
            0,
        )
        .map_err(|error| format!("failed to create screenshot overlay buffer: {error}"))?;

        let previous_bitmap = SelectObject(memory_dc, HGDIOBJ(bitmap.0));
        if bits.is_null() {
            let _ = SelectObject(memory_dc, previous_bitmap);
            let _ = DeleteObject(HGDIOBJ(bitmap.0));
            let _ = DeleteDC(memory_dc);
            let _ = ReleaseDC(Some(hwnd), screen_dc);
            return Err("failed to map screenshot overlay buffer".to_string());
        }

        Ok(Self {
            screen_dc,
            memory_dc,
            bitmap,
            previous_bitmap,
            bits: bits.cast::<u32>(),
            width,
            height,
        })
    }

    unsafe fn destroy(&mut self, hwnd: HWND) {
        let _ = SelectObject(self.memory_dc, self.previous_bitmap);
        let _ = DeleteObject(HGDIOBJ(self.bitmap.0));
        let _ = DeleteDC(self.memory_dc);
        let _ = ReleaseDC(Some(hwnd), self.screen_dc);
        self.bits = null_mut();
    }

    unsafe fn render(&mut self, hwnd: HWND, state: &NativeSelectionState) -> Result<(), String> {
        let pixel_count = (self.width as usize).saturating_mul(self.height as usize);
        if pixel_count == 0 || self.bits.is_null() {
            return Ok(());
        }

        let pixels = std::slice::from_raw_parts_mut(self.bits, pixel_count);
        pixels.fill(rgba(0, 0, 0, 0));

        render_overlay_pixels(pixels, self.width, self.height, state);
        render_overlay_gdi(self.memory_dc, state);

        let position = POINT {
            x: state.monitor.x,
            y: state.monitor.y,
        };
        let size = SIZE {
            cx: self.width,
            cy: self.height,
        };
        let source = POINT { x: 0, y: 0 };
        let blend = BLENDFUNCTION {
            BlendOp: AC_SRC_OVER as u8,
            BlendFlags: 0,
            SourceConstantAlpha: 255,
            AlphaFormat: AC_SRC_ALPHA as u8,
        };

        UpdateLayeredWindow(
            hwnd,
            Some(self.screen_dc),
            Some(&position),
            Some(&size),
            Some(self.memory_dc),
            Some(&source),
            COLORREF(0),
            Some(&blend),
            ULW_ALPHA,
        )
        .map_err(|error| format!("failed to update screenshot overlay frame: {error}"))
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureRegionResult {
    file_path: String,
    width: u32,
    height: u32,
}

thread_local! {
    static ACTIVE_SELECTION_STATE: RefCell<*mut NativeSelectionState> = const { RefCell::new(null_mut()) };
}

#[tauri::command]
pub async fn capture_region_interactive(app: AppHandle) -> Result<CaptureRegionResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let monitor = primary_xcap_monitor()?;
        let bounds = monitor_bounds(&monitor)?;
        let selection = match run_native_selection(bounds)? {
            NativeSelectionResult::Selected(selection) => selection,
            NativeSelectionResult::Cancelled => {
                return Err("screenshot cancelled".to_string());
            }
        };
        thread::sleep(Duration::from_millis(100));

        let request = CaptureRegionRequest {
            x: selection.left,
            y: selection.top,
            width: selection.width,
            height: selection.height,
            scale_factor: 1.0,
        };
        capture_region_blocking(app, monitor, request)
    })
    .await
    .map_err(|error| format!("screenshot task failed: {error}"))?
}

#[tauri::command]
pub async fn capture_region(
    app: AppHandle,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    scale_factor: f64,
) -> Result<CaptureRegionResult, String> {
    let request = CaptureRegionRequest {
        x,
        y,
        width,
        height,
        scale_factor,
    };
    tauri::async_runtime::spawn_blocking(move || {
        let monitor = primary_xcap_monitor()?;
        capture_region_blocking(app, monitor, request)
    })
    .await
    .map_err(|error| format!("screenshot task failed: {error}"))?
}

fn capture_region_blocking(
    app: AppHandle,
    monitor: Monitor,
    request: CaptureRegionRequest,
) -> Result<CaptureRegionResult, String> {
    if request.width == 0 || request.height == 0 {
        return Err("screenshot region is empty".to_string());
    }

    let monitor_width = monitor
        .width()
        .map_err(|error| format!("failed to read monitor width: {error}"))?;
    let monitor_height = monitor
        .height()
        .map_err(|error| format!("failed to read monitor height: {error}"))?;

    let scale_factor = if request.scale_factor.is_finite() && request.scale_factor > 0.0 {
        request.scale_factor
    } else {
        1.0
    };

    // MVP: coordinates are monitor-local physical pixels.
    // TODO: carry monitor identity for full multi-monitor selection.
    let physical_x = ((request.x.max(0) as f64) * scale_factor).round() as u32;
    let physical_y = ((request.y.max(0) as f64) * scale_factor).round() as u32;
    let physical_width = ((request.width as f64) * scale_factor).round().max(1.0) as u32;
    let physical_height = ((request.height as f64) * scale_factor).round().max(1.0) as u32;

    if physical_x >= monitor_width || physical_y >= monitor_height {
        return Err("screenshot region is outside the primary monitor".to_string());
    }

    let safe_width = physical_width.min(monitor_width.saturating_sub(physical_x));
    let safe_height = physical_height.min(monitor_height.saturating_sub(physical_y));
    if safe_width == 0 || safe_height == 0 {
        return Err("screenshot region is outside the primary monitor".to_string());
    }

    let image = monitor
        .capture_region(physical_x, physical_y, safe_width, safe_height)
        .map_err(|error| format!("failed to capture screenshot region: {error}"))?;

    let target = screenshot_temp_path(&app, "screenshot")?;
    save_png(&image, &target)?;

    Ok(CaptureRegionResult {
        file_path: target.to_string_lossy().to_string(),
        width: image.width(),
        height: image.height(),
    })
}

fn run_native_selection(bounds: MonitorBounds) -> Result<NativeSelectionResult, String> {
    let mut state = Box::new(NativeSelectionState {
        monitor: bounds,
        mode: OverlayMode::Selecting,
        pointer_down: false,
        drag_start_x: 0,
        drag_start_y: 0,
        drag_origin: None,
        selection: None,
        active_tool: None,
        render_pending: false,
        renderer: None,
    });

    let state_ptr: *mut NativeSelectionState = &mut *state;
    ACTIVE_SELECTION_STATE.with(|slot| {
        *slot.borrow_mut() = state_ptr;
    });

    let hwnd = unsafe { create_selection_window(bounds, state_ptr)? };
    unsafe {
        let _ = ShowWindow(hwnd, SW_SHOW);
        let _ = SetForegroundWindow(hwnd);
    }

    let message_result = unsafe { run_selection_message_loop() };
    ACTIVE_SELECTION_STATE.with(|slot| {
        *slot.borrow_mut() = null_mut();
    });
    message_result?;

    if state.mode == OverlayMode::Confirmed {
        if let Some(selection) = state.selection.filter(|selection| selection.is_valid()) {
            return Ok(NativeSelectionResult::Selected(selection));
        }
    }

    Ok(NativeSelectionResult::Cancelled)
}

unsafe fn create_selection_window(
    bounds: MonitorBounds,
    state: *mut NativeSelectionState,
) -> Result<HWND, String> {
    let module =
        GetModuleHandleW(None).map_err(|error| format!("failed to get module handle: {error}"))?;
    let hinstance = HINSTANCE(module.0);
    let cursor = LoadCursorW(None, IDC_CROSS)
        .map_err(|error| format!("failed to load screenshot cursor: {error}"))?;
    let class_name = w!("TeacherScheduleScreenshotSelection");

    let class = WNDCLASSW {
        style: CS_HREDRAW | CS_VREDRAW,
        lpfnWndProc: Some(selection_wnd_proc),
        hInstance: hinstance,
        hCursor: cursor,
        lpszClassName: class_name,
        ..Default::default()
    };
    RegisterClassW(&class);

    let hwnd = CreateWindowExW(
        WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_LAYERED,
        class_name,
        w!("Screenshot"),
        WS_POPUP,
        bounds.x,
        bounds.y,
        bounds.width as i32,
        bounds.height as i32,
        None,
        None,
        Some(hinstance),
        Some(state.cast::<c_void>()),
    )
    .map_err(|error| format!("failed to create native screenshot overlay: {error}"))?;

    Ok(hwnd)
}

unsafe fn run_selection_message_loop() -> Result<(), String> {
    let mut message = MSG::default();
    loop {
        let result = GetMessageW(&mut message, None, 0, 0);
        let code = result.0;
        if code == -1 {
            return Err("native screenshot message loop failed".to_string());
        }
        if code == 0 {
            break;
        }
        let _ = TranslateMessage(&message);
        DispatchMessageW(&message);
    }
    Ok(())
}

unsafe extern "system" fn selection_wnd_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    match msg {
        WM_CREATE => {
            let create = lparam.0 as *const CREATESTRUCTW;
            if !create.is_null() {
                let state = (*create).lpCreateParams as *mut NativeSelectionState;
                windows::Win32::UI::WindowsAndMessaging::SetWindowLongPtrW(
                    hwnd,
                    GWLP_USERDATA,
                    state as isize,
                );
                if !state.is_null() {
                    match OverlayRenderer::create(
                        hwnd,
                        (*state).monitor.width as i32,
                        (*state).monitor.height as i32,
                    ) {
                        Ok(renderer) => {
                            (*state).renderer = Some(renderer);
                            request_overlay_render(hwnd, &mut *state);
                        }
                        Err(_) => {
                            (*state).mode = OverlayMode::Cancelled;
                            let _ = DestroyWindow(hwnd);
                        }
                    }
                }
            }
            LRESULT(0)
        }
        WM_LBUTTONDOWN => with_selection_state(hwnd, msg, wparam, lparam, |state| {
            let (x, y) = clamped_mouse_point(lparam, state.monitor);
            handle_left_button_down(hwnd, state, x, y);
            LRESULT(0)
        }),
        WM_MOUSEMOVE => with_selection_state(hwnd, msg, wparam, lparam, |state| {
            let (x, y) = clamped_mouse_point(lparam, state.monitor);
            handle_mouse_move(hwnd, state, x, y);
            LRESULT(0)
        }),
        WM_LBUTTONUP => with_selection_state(hwnd, msg, wparam, lparam, |state| {
            let (x, y) = clamped_mouse_point(lparam, state.monitor);
            handle_left_button_up(hwnd, state, x, y);
            LRESULT(0)
        }),
        WM_KEYDOWN => {
            if wparam.0 as u16 == VK_ESCAPE.0 {
                with_selection_state(hwnd, msg, wparam, lparam, |state| {
                    cancel_overlay(hwnd, state);
                    LRESULT(0)
                })
            } else {
                DefWindowProcW(hwnd, msg, wparam, lparam)
            }
        }
        WM_RBUTTONDOWN => with_selection_state(hwnd, msg, wparam, lparam, |state| {
            cancel_overlay(hwnd, state);
            LRESULT(0)
        }),
        WM_CANCELMODE | WM_KILLFOCUS => with_selection_state(hwnd, msg, wparam, lparam, |state| {
            state.pointer_down = false;
            if matches!(state.mode, OverlayMode::Moving | OverlayMode::Resizing(_)) {
                state.mode = OverlayMode::Adjusting;
            }
            let _ = ReleaseCapture();
            LRESULT(0)
        }),
        WM_ERASEBKGND => LRESULT(1),
        WM_PAINT => {
            validate_paint(hwnd);
            LRESULT(0)
        }
        WM_SCREENSHOT_RENDER => with_selection_state(hwnd, msg, wparam, lparam, |state| {
            state.render_pending = false;
            if let Some(mut renderer) = state.renderer.take() {
                let _ = renderer.render(hwnd, state);
                state.renderer = Some(renderer);
            }
            LRESULT(0)
        }),
        WM_DESTROY => {
            with_selection_state(hwnd, msg, wparam, lparam, |state| {
                if let Some(mut renderer) = state.renderer.take() {
                    renderer.destroy(hwnd);
                }
                LRESULT(0)
            });
            PostQuitMessage(0);
            LRESULT(0)
        }
        _ => DefWindowProcW(hwnd, msg, wparam, lparam),
    }
}

unsafe fn with_selection_state(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    callback: impl FnOnce(&mut NativeSelectionState) -> LRESULT,
) -> LRESULT {
    let state_ptr = windows::Win32::UI::WindowsAndMessaging::GetWindowLongPtrW(hwnd, GWLP_USERDATA)
        as *mut NativeSelectionState;
    if state_ptr.is_null() {
        return DefWindowProcW(hwnd, msg, wparam, lparam);
    }
    callback(&mut *state_ptr)
}

unsafe fn handle_left_button_down(hwnd: HWND, state: &mut NativeSelectionState, x: i32, y: i32) {
    match state.mode {
        OverlayMode::Selecting => {
            state.pointer_down = true;
            state.drag_start_x = x;
            state.drag_start_y = y;
            state.drag_origin = None;
            state.selection = Some(rect_from_points(x, y, x, y));
            state.active_tool = None;
            SetCapture(hwnd);
            set_system_cursor(IDC_CROSS);
            request_overlay_render(hwnd, state);
        }
        OverlayMode::Adjusting => match hit_test(state, x, y) {
            HitTarget::ToolbarButton(button) => activate_toolbar_button(hwnd, state, button),
            HitTarget::Handle(handle) => {
                if let Some(selection) = state.selection {
                    state.mode = OverlayMode::Resizing(handle);
                    state.pointer_down = true;
                    state.drag_start_x = x;
                    state.drag_start_y = y;
                    state.drag_origin = Some(selection);
                    SetCapture(hwnd);
                    set_cursor_for_handle(handle);
                }
            }
            HitTarget::InsideSelection => {
                if let Some(selection) = state.selection {
                    state.mode = OverlayMode::Moving;
                    state.pointer_down = true;
                    state.drag_start_x = x;
                    state.drag_start_y = y;
                    state.drag_origin = Some(selection);
                    SetCapture(hwnd);
                    set_system_cursor(IDC_SIZEALL);
                }
            }
            HitTarget::Outside => {}
        },
        OverlayMode::Editing => {
            if let HitTarget::ToolbarButton(button) = hit_test(state, x, y) {
                activate_toolbar_button(hwnd, state, button);
            }
        }
        OverlayMode::Moving
        | OverlayMode::Resizing(_)
        | OverlayMode::Confirmed
        | OverlayMode::Cancelled => {}
    }
}

unsafe fn handle_mouse_move(hwnd: HWND, state: &mut NativeSelectionState, x: i32, y: i32) {
    match state.mode {
        OverlayMode::Selecting => {
            if state.pointer_down {
                state.selection = Some(rect_from_points(
                    state.drag_start_x,
                    state.drag_start_y,
                    x,
                    y,
                ));
                request_overlay_render(hwnd, state);
            }
            set_system_cursor(IDC_CROSS);
        }
        OverlayMode::Moving => {
            if state.pointer_down {
                if let Some(origin) = state.drag_origin {
                    state.selection = Some(moved_rect(
                        origin,
                        x - state.drag_start_x,
                        y - state.drag_start_y,
                        state.monitor,
                    ));
                    request_overlay_render(hwnd, state);
                }
            }
            set_system_cursor(IDC_SIZEALL);
        }
        OverlayMode::Resizing(handle) => {
            if state.pointer_down {
                if let Some(origin) = state.drag_origin {
                    state.selection = Some(resized_rect(
                        origin,
                        handle,
                        x - state.drag_start_x,
                        y - state.drag_start_y,
                        state.monitor,
                    ));
                    request_overlay_render(hwnd, state);
                }
            }
            set_cursor_for_handle(handle);
        }
        OverlayMode::Adjusting | OverlayMode::Editing => update_hover_cursor(state, x, y),
        OverlayMode::Confirmed | OverlayMode::Cancelled => {}
    }
}

unsafe fn handle_left_button_up(hwnd: HWND, state: &mut NativeSelectionState, x: i32, y: i32) {
    match state.mode {
        OverlayMode::Selecting => {
            if state.pointer_down {
                state.selection = Some(rect_from_points(
                    state.drag_start_x,
                    state.drag_start_y,
                    x,
                    y,
                ));
                state.pointer_down = false;
                state.drag_origin = None;
                let _ = ReleaseCapture();

                if state
                    .selection
                    .is_some_and(|selection| selection.is_valid())
                {
                    state.mode = OverlayMode::Adjusting;
                } else {
                    state.mode = OverlayMode::Selecting;
                    state.selection = None;
                }
                request_overlay_render(hwnd, state);
            }
        }
        OverlayMode::Moving | OverlayMode::Resizing(_) => {
            state.pointer_down = false;
            state.drag_origin = None;
            state.mode = OverlayMode::Adjusting;
            let _ = ReleaseCapture();
            request_overlay_render(hwnd, state);
        }
        OverlayMode::Adjusting
        | OverlayMode::Editing
        | OverlayMode::Confirmed
        | OverlayMode::Cancelled => {}
    }
}

unsafe fn activate_toolbar_button(
    hwnd: HWND,
    state: &mut NativeSelectionState,
    button: ToolButton,
) {
    match button {
        ToolButton::Pen => {
            state.mode = OverlayMode::Editing;
            state.pointer_down = false;
            state.drag_origin = None;
            state.active_tool = Some(ToolButton::Pen);
            let _ = ReleaseCapture();
            request_overlay_render(hwnd, state);
        }
        ToolButton::Cancel => cancel_overlay(hwnd, state),
        ToolButton::Send => {
            if state
                .selection
                .is_some_and(|selection| selection.is_valid())
            {
                state.mode = OverlayMode::Confirmed;
                state.pointer_down = false;
                state.drag_origin = None;
                let _ = ReleaseCapture();
                let _ = DestroyWindow(hwnd);
            }
        }
    }
}

unsafe fn cancel_overlay(hwnd: HWND, state: &mut NativeSelectionState) {
    state.mode = OverlayMode::Cancelled;
    state.pointer_down = false;
    state.drag_origin = None;
    let _ = ReleaseCapture();
    let _ = DestroyWindow(hwnd);
}

unsafe fn update_hover_cursor(state: &NativeSelectionState, x: i32, y: i32) {
    match hit_test(state, x, y) {
        HitTarget::ToolbarButton(_) => set_system_cursor(IDC_HAND),
        HitTarget::Handle(handle) => set_cursor_for_handle(handle),
        HitTarget::InsideSelection => {
            if state.mode == OverlayMode::Editing {
                set_system_cursor(IDC_ARROW);
            } else {
                set_system_cursor(IDC_SIZEALL);
            }
        }
        HitTarget::Outside => {
            if state.mode == OverlayMode::Editing {
                set_system_cursor(IDC_ARROW);
            } else {
                set_system_cursor(IDC_CROSS);
            }
        }
    }
}

unsafe fn set_cursor_for_handle(handle: ResizeHandle) {
    let cursor = match handle {
        ResizeHandle::TopLeft | ResizeHandle::BottomRight => IDC_SIZENWSE,
        ResizeHandle::TopRight | ResizeHandle::BottomLeft => IDC_SIZENESW,
        ResizeHandle::Top | ResizeHandle::Bottom => IDC_SIZENS,
        ResizeHandle::Left | ResizeHandle::Right => IDC_SIZEWE,
    };
    set_system_cursor(cursor);
}

unsafe fn set_system_cursor(cursor: PCWSTR) {
    if let Ok(handle) = LoadCursorW(None, cursor) {
        let _ = SetCursor(Some(handle));
    }
}

fn hit_test(state: &NativeSelectionState, x: i32, y: i32) -> HitTarget {
    let Some(selection) = state.selection.filter(|selection| selection.is_valid()) else {
        return HitTarget::Outside;
    };

    for (button, rect) in toolbar_button_rects(selection, state.monitor) {
        if point_in_rect(x, y, rect) {
            return HitTarget::ToolbarButton(button);
        }
    }

    if state.mode == OverlayMode::Editing {
        return HitTarget::Outside;
    }

    for (handle, rect) in handle_hit_rects(selection) {
        if point_in_rect(x, y, rect) {
            return HitTarget::Handle(handle);
        }
    }

    if x >= selection.left
        && x <= selection.right()
        && y >= selection.top
        && y <= selection.bottom()
    {
        return HitTarget::InsideSelection;
    }

    HitTarget::Outside
}

unsafe fn validate_paint(hwnd: HWND) {
    let mut ps = PAINTSTRUCT::default();
    let _ = BeginPaint(hwnd, &mut ps);
    let _ = EndPaint(hwnd, &ps);
}

unsafe fn request_overlay_render(hwnd: HWND, state: &mut NativeSelectionState) {
    if state.render_pending {
        return;
    }
    state.render_pending = true;
    let _ = PostMessageW(Some(hwnd), WM_SCREENSHOT_RENDER, WPARAM(0), LPARAM(0));
}

fn render_overlay_pixels(
    pixels: &mut [u32],
    width: i32,
    height: i32,
    state: &NativeSelectionState,
) {
    if let Some(selection) = state.selection.filter(|selection| selection.is_valid()) {
        fill_rect_pixels(
            pixels,
            width,
            height,
            RECT {
                left: 0,
                top: 0,
                right: width,
                bottom: selection.top,
            },
            rgba(0, 0, 0, DIM_ALPHA),
        );
        fill_rect_pixels(
            pixels,
            width,
            height,
            RECT {
                left: 0,
                top: selection.bottom(),
                right: width,
                bottom: height,
            },
            rgba(0, 0, 0, DIM_ALPHA),
        );
        fill_rect_pixels(
            pixels,
            width,
            height,
            RECT {
                left: 0,
                top: selection.top,
                right: selection.left,
                bottom: selection.bottom(),
            },
            rgba(0, 0, 0, DIM_ALPHA),
        );
        fill_rect_pixels(
            pixels,
            width,
            height,
            RECT {
                left: selection.right(),
                top: selection.top,
                right: width,
                bottom: selection.bottom(),
            },
            rgba(0, 0, 0, DIM_ALPHA),
        );
        fill_rect_pixels(
            pixels,
            width,
            height,
            rect_from_selection(selection),
            rgba(255, 255, 255, SELECTION_ALPHA),
        );
        draw_selection_border_pixels(pixels, width, height, selection);
        draw_resize_handles_pixels(pixels, width, height, selection);
        draw_toolbar_pixels(pixels, width, height, state, selection);
    } else if let Some(selection) = state.selection {
        fill_rect_pixels(
            pixels,
            width,
            height,
            RECT {
                left: 0,
                top: 0,
                right: width,
                bottom: height,
            },
            rgba(0, 0, 0, DIM_ALPHA),
        );
        draw_selection_border_pixels(pixels, width, height, selection);
    } else {
        fill_rect_pixels(
            pixels,
            width,
            height,
            RECT {
                left: 0,
                top: 0,
                right: width,
                bottom: height,
            },
            rgba(0, 0, 0, DIM_ALPHA),
        );
    }
}

unsafe fn render_overlay_gdi(hdc: HDC, state: &NativeSelectionState) {
    if let Some(selection) = state.selection.filter(|selection| selection.is_valid()) {
        render_toolbar_text(hdc, state, selection);
    }
}

fn draw_selection_border_pixels(
    pixels: &mut [u32],
    width: i32,
    height: i32,
    selection: SelectionRect,
) {
    let color = rgba(42, 137, 255, 255);
    stroke_rect_pixels(
        pixels,
        width,
        height,
        rect_from_selection(selection),
        3,
        color,
    );
}

fn draw_resize_handles_pixels(
    pixels: &mut [u32],
    width: i32,
    height: i32,
    selection: SelectionRect,
) {
    for (_, rect) in handle_draw_rects(selection) {
        fill_rect_pixels(pixels, width, height, rect, rgba(255, 255, 255, 255));
        stroke_rect_pixels(pixels, width, height, rect, 1, rgba(42, 137, 255, 255));
    }
}

fn draw_toolbar_pixels(
    pixels: &mut [u32],
    width: i32,
    height: i32,
    state: &NativeSelectionState,
    selection: SelectionRect,
) {
    let buttons = toolbar_button_rects(selection, state.monitor);
    let toolbar = toolbar_bounds(&buttons);
    fill_rect_pixels(pixels, width, height, toolbar, rgba(28, 32, 39, 245));
    stroke_rect_pixels(pixels, width, height, toolbar, 1, rgba(58, 66, 78, 255));

    for (button, rect) in buttons {
        let active = state.active_tool == Some(ToolButton::Pen) && button == ToolButton::Pen;
        let bg = if active {
            rgba(42, 137, 255, 255)
        } else {
            rgba(39, 45, 54, 255)
        };
        fill_rect_pixels(pixels, width, height, rect, bg);
    }
}

unsafe fn render_toolbar_text(hdc: HDC, state: &NativeSelectionState, selection: SelectionRect) {
    for (button, rect) in toolbar_button_rects(selection, state.monitor) {
        let mut text_rect = rect;
        text_rect.left += 8;
        text_rect.right -= 8;
        let _ = SetBkMode(hdc, TRANSPARENT);
        let _ = SetTextColor(hdc, rgb(255, 255, 255));
        let mut label: Vec<u16> = tool_button_label(button).encode_utf16().collect();
        let _ = DrawTextW(
            hdc,
            &mut label,
            &mut text_rect,
            DT_CENTER | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS,
        );
    }
}

fn fill_rect_pixels(pixels: &mut [u32], width: i32, height: i32, rect: RECT, color: u32) {
    let left = clamp_i32(rect.left, 0, width);
    let top = clamp_i32(rect.top, 0, height);
    let right = clamp_i32(rect.right, 0, width);
    let bottom = clamp_i32(rect.bottom, 0, height);
    if right <= left || bottom <= top {
        return;
    }

    let stride = width as usize;
    for y in top..bottom {
        let start = y as usize * stride + left as usize;
        let end = y as usize * stride + right as usize;
        pixels[start..end].fill(color);
    }
}

fn stroke_rect_pixels(
    pixels: &mut [u32],
    width: i32,
    height: i32,
    rect: RECT,
    thickness: i32,
    color: u32,
) {
    let thickness = thickness.max(1);
    fill_rect_pixels(
        pixels,
        width,
        height,
        RECT {
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.top + thickness,
        },
        color,
    );
    fill_rect_pixels(
        pixels,
        width,
        height,
        RECT {
            left: rect.left,
            top: rect.bottom - thickness,
            right: rect.right,
            bottom: rect.bottom,
        },
        color,
    );
    fill_rect_pixels(
        pixels,
        width,
        height,
        RECT {
            left: rect.left,
            top: rect.top,
            right: rect.left + thickness,
            bottom: rect.bottom,
        },
        color,
    );
    fill_rect_pixels(
        pixels,
        width,
        height,
        RECT {
            left: rect.right - thickness,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
        },
        color,
    );
}

fn rect_from_selection(selection: SelectionRect) -> RECT {
    RECT {
        left: selection.left,
        top: selection.top,
        right: selection.right(),
        bottom: selection.bottom(),
    }
}

fn rgba(red: u8, green: u8, blue: u8, alpha: u8) -> u32 {
    let premultiply = |value: u8| ((value as u16 * alpha as u16 + 127) / 255) as u32;
    premultiply(blue)
        | (premultiply(green) << 8)
        | (premultiply(red) << 16)
        | ((alpha as u32) << 24)
}

fn toolbar_button_rects(
    selection: SelectionRect,
    monitor: MonitorBounds,
) -> [(ToolButton, RECT); 3] {
    let button_specs = [
        (ToolButton::Pen, 58),
        (ToolButton::Cancel, 58),
        (ToolButton::Send, 58),
    ];
    let buttons_width: i32 = button_specs.iter().map(|(_, width)| *width).sum();
    let total_width = buttons_width
        + TOOLBAR_PADDING_X * 2
        + TOOLBAR_BUTTON_GAP * (button_specs.len() as i32 - 1);
    let monitor_width = monitor.width as i32;
    let monitor_height = monitor.height as i32;

    let mut toolbar_left = selection.left + (selection.width as i32 - total_width) / 2;
    toolbar_left = clamp_i32(
        toolbar_left,
        SCREEN_PADDING,
        monitor_width - total_width - SCREEN_PADDING,
    );

    let below_top = selection.bottom() + TOOLBAR_MARGIN;
    let above_top = selection.top - TOOLBAR_MARGIN - TOOLBAR_HEIGHT;
    let toolbar_top = if below_top + TOOLBAR_HEIGHT <= monitor_height - SCREEN_PADDING {
        below_top
    } else {
        clamp_i32(
            above_top,
            SCREEN_PADDING,
            monitor_height - TOOLBAR_HEIGHT - SCREEN_PADDING,
        )
    };

    let mut cursor_left = toolbar_left + TOOLBAR_PADDING_X;
    let mut make_button = |button: ToolButton, width: i32| {
        let rect = RECT {
            left: cursor_left,
            top: toolbar_top + 5,
            right: cursor_left + width,
            bottom: toolbar_top + TOOLBAR_HEIGHT - 5,
        };
        cursor_left += width + TOOLBAR_BUTTON_GAP;
        (button, rect)
    };

    [
        make_button(button_specs[0].0, button_specs[0].1),
        make_button(button_specs[1].0, button_specs[1].1),
        make_button(button_specs[2].0, button_specs[2].1),
    ]
}

fn toolbar_bounds(buttons: &[(ToolButton, RECT); 3]) -> RECT {
    RECT {
        left: buttons[0].1.left - TOOLBAR_PADDING_X,
        top: buttons[0].1.top - 5,
        right: buttons[2].1.right + TOOLBAR_PADDING_X,
        bottom: buttons[0].1.bottom + 5,
    }
}

fn handle_draw_rects(selection: SelectionRect) -> [(ResizeHandle, RECT); 8] {
    handle_rects(selection, HANDLE_DRAW_SIZE)
}

fn handle_hit_rects(selection: SelectionRect) -> [(ResizeHandle, RECT); 8] {
    handle_rects(selection, HANDLE_HIT_SIZE)
}

fn handle_rects(selection: SelectionRect, size: i32) -> [(ResizeHandle, RECT); 8] {
    let left = selection.left;
    let top = selection.top;
    let right = selection.right();
    let bottom = selection.bottom();
    let center_x = left + selection.width as i32 / 2;
    let center_y = top + selection.height as i32 / 2;

    [
        (ResizeHandle::TopLeft, centered_rect(left, top, size)),
        (ResizeHandle::Top, centered_rect(center_x, top, size)),
        (ResizeHandle::TopRight, centered_rect(right, top, size)),
        (ResizeHandle::Right, centered_rect(right, center_y, size)),
        (
            ResizeHandle::BottomRight,
            centered_rect(right, bottom, size),
        ),
        (ResizeHandle::Bottom, centered_rect(center_x, bottom, size)),
        (ResizeHandle::BottomLeft, centered_rect(left, bottom, size)),
        (ResizeHandle::Left, centered_rect(left, center_y, size)),
    ]
}

fn centered_rect(x: i32, y: i32, size: i32) -> RECT {
    let half = size / 2;
    RECT {
        left: x - half,
        top: y - half,
        right: x - half + size,
        bottom: y - half + size,
    }
}

fn point_in_rect(x: i32, y: i32, rect: RECT) -> bool {
    x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
}

fn tool_button_label(button: ToolButton) -> &'static str {
    match button {
        ToolButton::Pen => "画笔",
        ToolButton::Cancel => "取消",
        ToolButton::Send => "发送",
    }
}

fn clamped_mouse_point(lparam: LPARAM, monitor: MonitorBounds) -> (i32, i32) {
    let (x, y) = mouse_point(lparam);
    (
        clamp_i32(x, 0, monitor.width as i32),
        clamp_i32(y, 0, monitor.height as i32),
    )
}

fn mouse_point(lparam: LPARAM) -> (i32, i32) {
    let value = lparam.0 as u32;
    let x = (value & 0xffff) as i16 as i32;
    let y = ((value >> 16) & 0xffff) as i16 as i32;
    (x, y)
}

fn rect_from_points(start_x: i32, start_y: i32, current_x: i32, current_y: i32) -> SelectionRect {
    let left = start_x.min(current_x);
    let top = start_y.min(current_y);
    SelectionRect {
        left,
        top,
        width: (start_x - current_x).unsigned_abs(),
        height: (start_y - current_y).unsigned_abs(),
    }
}

fn moved_rect(origin: SelectionRect, dx: i32, dy: i32, monitor: MonitorBounds) -> SelectionRect {
    let max_left = (monitor.width as i32 - origin.width as i32).max(0);
    let max_top = (monitor.height as i32 - origin.height as i32).max(0);
    SelectionRect {
        left: clamp_i32(origin.left + dx, 0, max_left),
        top: clamp_i32(origin.top + dy, 0, max_top),
        width: origin.width,
        height: origin.height,
    }
}

fn resized_rect(
    origin: SelectionRect,
    handle: ResizeHandle,
    dx: i32,
    dy: i32,
    monitor: MonitorBounds,
) -> SelectionRect {
    let mut left = origin.left;
    let mut top = origin.top;
    let mut right = origin.right();
    let mut bottom = origin.bottom();
    let max_right = monitor.width as i32;
    let max_bottom = monitor.height as i32;

    match handle {
        ResizeHandle::TopLeft => {
            left += dx;
            top += dy;
        }
        ResizeHandle::Top => {
            top += dy;
        }
        ResizeHandle::TopRight => {
            right += dx;
            top += dy;
        }
        ResizeHandle::Right => {
            right += dx;
        }
        ResizeHandle::BottomRight => {
            right += dx;
            bottom += dy;
        }
        ResizeHandle::Bottom => {
            bottom += dy;
        }
        ResizeHandle::BottomLeft => {
            left += dx;
            bottom += dy;
        }
        ResizeHandle::Left => {
            left += dx;
        }
    }

    left = clamp_i32(left, 0, max_right);
    right = clamp_i32(right, 0, max_right);
    top = clamp_i32(top, 0, max_bottom);
    bottom = clamp_i32(bottom, 0, max_bottom);

    if affects_left(handle) && right - left < MIN_SELECTION_SIZE {
        left = (right - MIN_SELECTION_SIZE).max(0);
    }
    if affects_right(handle) && right - left < MIN_SELECTION_SIZE {
        right = (left + MIN_SELECTION_SIZE).min(max_right);
    }
    if affects_top(handle) && bottom - top < MIN_SELECTION_SIZE {
        top = (bottom - MIN_SELECTION_SIZE).max(0);
    }
    if affects_bottom(handle) && bottom - top < MIN_SELECTION_SIZE {
        bottom = (top + MIN_SELECTION_SIZE).min(max_bottom);
    }

    SelectionRect {
        left,
        top,
        width: (right - left).max(0) as u32,
        height: (bottom - top).max(0) as u32,
    }
}

fn affects_left(handle: ResizeHandle) -> bool {
    matches!(
        handle,
        ResizeHandle::TopLeft | ResizeHandle::BottomLeft | ResizeHandle::Left
    )
}

fn affects_right(handle: ResizeHandle) -> bool {
    matches!(
        handle,
        ResizeHandle::TopRight | ResizeHandle::BottomRight | ResizeHandle::Right
    )
}

fn affects_top(handle: ResizeHandle) -> bool {
    matches!(
        handle,
        ResizeHandle::TopLeft | ResizeHandle::TopRight | ResizeHandle::Top
    )
}

fn affects_bottom(handle: ResizeHandle) -> bool {
    matches!(
        handle,
        ResizeHandle::BottomLeft | ResizeHandle::BottomRight | ResizeHandle::Bottom
    )
}

fn clamp_i32(value: i32, min: i32, max: i32) -> i32 {
    value.max(min).min(max)
}

fn rgb(red: u8, green: u8, blue: u8) -> COLORREF {
    COLORREF(red as u32 | ((green as u32) << 8) | ((blue as u32) << 16))
}

fn primary_xcap_monitor() -> Result<Monitor, String> {
    let mut monitors =
        Monitor::all().map_err(|error| format!("failed to list monitors: {error}"))?;
    if monitors.is_empty() {
        return Err("no monitor available for screenshot".to_string());
    }

    let index = monitors
        .iter()
        .position(|monitor| monitor.is_primary().unwrap_or(false))
        .unwrap_or(0);
    Ok(monitors.swap_remove(index))
}

fn monitor_bounds(monitor: &Monitor) -> Result<MonitorBounds, String> {
    Ok(MonitorBounds {
        x: monitor
            .x()
            .map_err(|error| format!("failed to read monitor x: {error}"))?,
        y: monitor
            .y()
            .map_err(|error| format!("failed to read monitor y: {error}"))?,
        width: monitor
            .width()
            .map_err(|error| format!("failed to read monitor width: {error}"))?,
        height: monitor
            .height()
            .map_err(|error| format!("failed to read monitor height: {error}"))?,
    })
}

fn save_png(image: &RgbaImage, target: &Path) -> Result<(), String> {
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create screenshot directory: {error}"))?;
    }
    image
        .save(target)
        .map_err(|error| format!("failed to save screenshot image: {error}"))
}

fn screenshot_temp_path(app: &AppHandle, prefix: &str) -> Result<PathBuf, String> {
    let mut dir = app
        .path()
        .app_cache_dir()
        .or_else(|_| app.path().temp_dir())
        .map_err(|error| format!("failed to resolve screenshot temp directory: {error}"))?;
    dir.push("screenshots");
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    dir.push(format!("{prefix}-{millis}.png"));
    Ok(dir)
}
