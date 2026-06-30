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
        BeginPaint, CreateCompatibleDC, CreateDIBSection, CreateFontW, CreateSolidBrush, DeleteDC,
        DeleteObject, DrawTextW, EndPaint, FillRect, GetDC, ReleaseDC, SelectObject, SetBkMode,
        SetTextColor, AC_SRC_ALPHA, AC_SRC_OVER, BITMAPINFO, BITMAPINFOHEADER, BI_RGB,
        BLENDFUNCTION, CLIP_DEFAULT_PRECIS, DEFAULT_CHARSET, DEFAULT_PITCH, DEFAULT_QUALITY,
        DIB_RGB_COLORS, DT_CENTER, DT_END_ELLIPSIS, DT_LEFT, DT_SINGLELINE, DT_VCENTER, FW_NORMAL,
        HBITMAP, HDC, HGDIOBJ, OUT_DEFAULT_PRECIS, PAINTSTRUCT, RGBQUAD, TRANSPARENT,
    },
    System::LibraryLoader::GetModuleHandleW,
    UI::{
        Input::KeyboardAndMouse::{
            GetKeyState, ReleaseCapture, SetCapture, VK_BACK, VK_CONTROL, VK_DELETE, VK_ESCAPE,
            VK_RETURN, VK_S, VK_Z,
        },
        WindowsAndMessaging::{
            CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetMessageW,
            LoadCursorW, PostMessageW, PostQuitMessage, RegisterClassW, SetCursor,
            SetForegroundWindow, ShowWindow, TranslateMessage, UpdateLayeredWindow, CREATESTRUCTW,
            CS_HREDRAW, CS_VREDRAW, GWLP_USERDATA, IDC_ARROW, IDC_CROSS, IDC_HAND, IDC_SIZEALL,
            IDC_SIZENESW, IDC_SIZENS, IDC_SIZENWSE, IDC_SIZEWE, MSG, SW_SHOW, ULW_ALPHA, WM_APP,
            WM_CANCELMODE, WM_CHAR, WM_CREATE, WM_DESTROY, WM_ERASEBKGND, WM_KEYDOWN, WM_KILLFOCUS,
            WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MOUSEMOVE, WM_PAINT, WM_RBUTTONDOWN, WNDCLASSW,
            WS_EX_LAYERED, WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_POPUP,
        },
    },
};
use xcap::Monitor;

const MIN_SELECTION_SIZE: i32 = 8;
const WM_SCREENSHOT_RENDER: u32 = WM_APP + 77;
const DIM_ALPHA: u8 = 155;
const HANDLE_DRAW_SIZE: i32 = 8;
const HANDLE_HIT_SIZE: i32 = 18;
const TOOLBAR_HEIGHT: i32 = 38;
const TOOLBAR_MARGIN: i32 = 10;
const TOOLBAR_PADDING_X: i32 = 8;
const TOOLBAR_BUTTON_GAP: i32 = 6;
const SCREEN_PADDING: i32 = 8;
const CONTEXT_TOOLBAR_HEIGHT: i32 = 38;
const HISTORY_LIMIT: usize = 40;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum OutputAction {
    Send,
    Save,
}

impl OutputAction {
    fn as_str(self) -> &'static str {
        match self {
            OutputAction::Send => "send",
            OutputAction::Save => "save",
        }
    }
}

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
    Drawing,
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
    Select,
    Arrow,
    Pen,
    Text,
    Shape,
    Undo,
    Save,
    Cancel,
    Send,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ContextButton {
    Rectangle,
    Ellipse,
    Line,
    StrokeDown,
    StrokeUp,
    TextDown,
    TextUp,
    ColorRed,
    ColorBlue,
    ColorBlack,
    Fill,
    Delete,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum EditorTool {
    Select,
    Arrow,
    Pen,
    Text,
    Shape(ShapeKind),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ShapeKind {
    Rectangle,
    Ellipse,
    Line,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum HitTarget {
    Handle(ResizeHandle),
    InsideSelection,
    ToolbarButton(ToolButton),
    ContextButton(ContextButton),
    Annotation(usize),
    Outside,
}

#[derive(Clone, Debug)]
enum Annotation {
    Pen {
        points: Vec<PointI>,
        color: DrawColor,
        stroke: i32,
    },
    Arrow {
        start: PointI,
        end: PointI,
        color: DrawColor,
        stroke: i32,
    },
    Shape {
        kind: ShapeKind,
        start: PointI,
        end: PointI,
        color: DrawColor,
        stroke: i32,
        fill: bool,
    },
    Text {
        pos: PointI,
        text: String,
        color: DrawColor,
        size: i32,
    },
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct PointI {
    x: i32,
    y: i32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum DrawColor {
    Red,
    Blue,
    Black,
}

impl DrawColor {
    fn rgba(self) -> u32 {
        match self {
            DrawColor::Red => rgba(239, 68, 68, 255),
            DrawColor::Blue => rgba(42, 137, 255, 255),
            DrawColor::Black => rgba(17, 24, 39, 255),
        }
    }

    fn colorref(self) -> COLORREF {
        match self {
            DrawColor::Red => rgb(239, 68, 68),
            DrawColor::Blue => rgb(42, 137, 255),
            DrawColor::Black => rgb(17, 24, 39),
        }
    }
}

#[derive(Debug)]
enum NativeSelectionResult {
    Selected(SelectionRect, OutputAction, Vec<Annotation>),
    Cancelled,
}

#[derive(Debug)]
struct NativeSelectionState {
    monitor: MonitorBounds,
    frozen_image: Option<RgbaImage>,
    mode: OverlayMode,
    pointer_down: bool,
    drag_start_x: i32,
    drag_start_y: i32,
    drag_origin: Option<SelectionRect>,
    selection: Option<SelectionRect>,
    active_tool: EditorTool,
    active_color: DrawColor,
    stroke_width: i32,
    text_size: i32,
    shape_fill: bool,
    annotations: Vec<Annotation>,
    history: Vec<Vec<Annotation>>,
    selected_annotation: Option<usize>,
    draft_annotation: Option<Annotation>,
    text_draft_index: Option<usize>,
    moving_annotation: Option<(usize, PointI, Annotation)>,
    output_action: Option<OutputAction>,
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
    action: String,
}

thread_local! {
    static ACTIVE_SELECTION_STATE: RefCell<*mut NativeSelectionState> = const { RefCell::new(null_mut()) };
}

#[tauri::command]
pub async fn capture_region_interactive(app: AppHandle) -> Result<CaptureRegionResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let monitor = primary_xcap_monitor()?;
        let bounds = monitor_bounds(&monitor)?;
        thread::sleep(Duration::from_millis(100));
        let frozen_image = monitor
            .capture_image()
            .map_err(|error| format!("failed to freeze screenshot screen image: {error}"))?;
        let (selection, output_action, annotations) =
            match run_native_selection(bounds, frozen_image.clone())? {
                NativeSelectionResult::Selected(selection, output_action, annotations) => {
                    (selection, output_action, annotations)
                }
                NativeSelectionResult::Cancelled => {
                    return Err("screenshot cancelled".to_string());
                }
            };

        let image = compose_selection_image(&frozen_image, selection, &annotations)?;
        let target = match output_action {
            OutputAction::Send => screenshot_temp_path(&app, "screenshot")?,
            OutputAction::Save => choose_screenshot_save_path(&app)?,
        };
        save_png(&image, &target)?;

        Ok(CaptureRegionResult {
            file_path: target.to_string_lossy().to_string(),
            width: image.width(),
            height: image.height(),
            action: output_action.as_str().to_string(),
        })
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
        action: "send".to_string(),
    })
}

fn run_native_selection(
    bounds: MonitorBounds,
    frozen_image: RgbaImage,
) -> Result<NativeSelectionResult, String> {
    let mut state = Box::new(NativeSelectionState {
        monitor: bounds,
        frozen_image: Some(frozen_image),
        mode: OverlayMode::Selecting,
        pointer_down: false,
        drag_start_x: 0,
        drag_start_y: 0,
        drag_origin: None,
        selection: None,
        active_tool: EditorTool::Select,
        active_color: DrawColor::Red,
        stroke_width: 4,
        text_size: 28,
        shape_fill: false,
        annotations: Vec::new(),
        history: Vec::new(),
        selected_annotation: None,
        draft_annotation: None,
        text_draft_index: None,
        moving_annotation: None,
        output_action: None,
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
            return Ok(NativeSelectionResult::Selected(
                selection,
                state.output_action.unwrap_or(OutputAction::Send),
                state.annotations,
            ));
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
        WM_KEYDOWN => with_selection_state(hwnd, msg, wparam, lparam, |state| {
            handle_key_down(hwnd, state, wparam.0 as i32);
            LRESULT(0)
        }),
        WM_CHAR => with_selection_state(hwnd, msg, wparam, lparam, |state| {
            handle_char_input(hwnd, state, wparam.0 as u32);
            LRESULT(0)
        }),
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
            state.active_tool = EditorTool::Select;
            state.selected_annotation = None;
            SetCapture(hwnd);
            set_system_cursor(IDC_CROSS);
            request_overlay_render(hwnd, state);
        }
        OverlayMode::Adjusting => match hit_test(state, x, y) {
            HitTarget::ToolbarButton(button) => activate_toolbar_button(hwnd, state, button),
            HitTarget::ContextButton(button) => activate_context_button(hwnd, state, button),
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
            HitTarget::Annotation(_) => {}
            HitTarget::Outside => {}
        },
        OverlayMode::Editing => match hit_test(state, x, y) {
            HitTarget::ToolbarButton(button) => activate_toolbar_button(hwnd, state, button),
            HitTarget::ContextButton(button) => activate_context_button(hwnd, state, button),
            HitTarget::Annotation(index) if state.active_tool == EditorTool::Select => {
                state.selected_annotation = Some(index);
                if let Some(annotation) = state.annotations.get(index).cloned() {
                    push_history(state);
                    state.moving_annotation = Some((index, PointI { x, y }, annotation));
                    state.mode = OverlayMode::Moving;
                    state.pointer_down = true;
                    SetCapture(hwnd);
                }
                request_overlay_render(hwnd, state);
            }
            HitTarget::InsideSelection => {
                if let Some(selection) = state.selection {
                    let local = screen_to_local_point(PointI { x, y }, selection);
                    begin_annotation(hwnd, state, local);
                }
            }
            HitTarget::Outside => {
                commit_active_text_annotation(state);
                state.selected_annotation = None;
                request_overlay_render(hwnd, state);
            }
            HitTarget::Handle(_) | HitTarget::Annotation(_) => {}
        },
        OverlayMode::Drawing
        | OverlayMode::Moving
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
                if let Some((index, start, original)) = state.moving_annotation.clone() {
                    let delta = PointI {
                        x: x - start.x,
                        y: y - start.y,
                    };
                    if let Some(slot) = state.annotations.get_mut(index) {
                        *slot = moved_annotation(&original, delta);
                    }
                    request_overlay_render(hwnd, state);
                } else if let Some(origin) = state.drag_origin {
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
        OverlayMode::Drawing => {
            if state.pointer_down {
                if let Some(selection) = state.selection {
                    update_draft_annotation(
                        state,
                        screen_to_local_point(PointI { x, y }, selection),
                    );
                    request_overlay_render(hwnd, state);
                }
            }
        }
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
            let moved_annotation = state.moving_annotation.is_some();
            state.pointer_down = false;
            state.drag_origin = None;
            state.moving_annotation = None;
            state.mode = if moved_annotation {
                OverlayMode::Editing
            } else {
                OverlayMode::Adjusting
            };
            let _ = ReleaseCapture();
            request_overlay_render(hwnd, state);
        }
        OverlayMode::Drawing => {
            state.pointer_down = false;
            let _ = ReleaseCapture();
            commit_draft_annotation(state);
            state.mode = OverlayMode::Editing;
            request_overlay_render(hwnd, state);
        }
        OverlayMode::Adjusting
        | OverlayMode::Editing
        | OverlayMode::Confirmed
        | OverlayMode::Cancelled => {}
    }
}

unsafe fn handle_key_down(hwnd: HWND, state: &mut NativeSelectionState, key: i32) {
    let ctrl_down = (GetKeyState(VK_CONTROL.0 as i32) as u16 & 0x8000) != 0;
    if key == VK_ESCAPE.0 as i32 {
        if state.draft_annotation.is_some() || state.text_draft_index.is_some() {
            state.draft_annotation = None;
            cancel_active_text_annotation(state);
            state.mode = OverlayMode::Editing;
            request_overlay_render(hwnd, state);
        } else {
            cancel_overlay(hwnd, state);
        }
        return;
    }

    if ctrl_down && key == VK_Z.0 as i32 {
        undo_annotations(state);
        request_overlay_render(hwnd, state);
        return;
    }

    if ctrl_down && key == VK_S.0 as i32 {
        confirm_overlay(hwnd, state, OutputAction::Save);
        return;
    }

    if key == VK_DELETE.0 as i32 {
        delete_selected_annotation(state);
        request_overlay_render(hwnd, state);
        return;
    }

    if key == VK_BACK.0 as i32 {
        if remove_text_draft_char(state) {
            request_overlay_render(hwnd, state);
        }
        return;
    }

    if key == VK_RETURN.0 as i32 {
        if state.text_draft_index.is_some() {
            commit_active_text_annotation(state);
            request_overlay_render(hwnd, state);
        } else {
            confirm_overlay(hwnd, state, OutputAction::Send);
        }
    }
}

unsafe fn handle_char_input(hwnd: HWND, state: &mut NativeSelectionState, value: u32) {
    if value < 0x20 || value == 0x7f {
        return;
    }
    let Some(ch) = char::from_u32(value) else {
        return;
    };
    if append_text_draft_char(state, ch) {
        request_overlay_render(hwnd, state);
    }
}

unsafe fn activate_toolbar_button(
    hwnd: HWND,
    state: &mut NativeSelectionState,
    button: ToolButton,
) {
    match button {
        ToolButton::Select => {
            state.mode = OverlayMode::Editing;
            state.pointer_down = false;
            state.drag_origin = None;
            state.active_tool = EditorTool::Select;
            state.draft_annotation = None;
            state.text_draft_index = None;
            state.moving_annotation = None;
            let _ = ReleaseCapture();
            request_overlay_render(hwnd, state);
        }
        ToolButton::Arrow => set_editor_tool(hwnd, state, EditorTool::Arrow),
        ToolButton::Pen => set_editor_tool(hwnd, state, EditorTool::Pen),
        ToolButton::Text => set_editor_tool(hwnd, state, EditorTool::Text),
        ToolButton::Shape => set_editor_tool(hwnd, state, EditorTool::Shape(ShapeKind::Rectangle)),
        ToolButton::Undo => {
            undo_annotations(state);
            request_overlay_render(hwnd, state);
        }
        ToolButton::Save => confirm_overlay(hwnd, state, OutputAction::Save),
        ToolButton::Cancel => cancel_overlay(hwnd, state),
        ToolButton::Send => confirm_overlay(hwnd, state, OutputAction::Send),
    }
}

unsafe fn set_editor_tool(hwnd: HWND, state: &mut NativeSelectionState, tool: EditorTool) {
    state.mode = OverlayMode::Editing;
    state.pointer_down = false;
    state.drag_origin = None;
    state.active_tool = tool;
    state.draft_annotation = None;
    state.text_draft_index = None;
    state.moving_annotation = None;
    state.selected_annotation = None;
    let _ = ReleaseCapture();
    request_overlay_render(hwnd, state);
}

unsafe fn activate_context_button(
    hwnd: HWND,
    state: &mut NativeSelectionState,
    button: ContextButton,
) {
    match button {
        ContextButton::Rectangle => state.active_tool = EditorTool::Shape(ShapeKind::Rectangle),
        ContextButton::Ellipse => state.active_tool = EditorTool::Shape(ShapeKind::Ellipse),
        ContextButton::Line => state.active_tool = EditorTool::Shape(ShapeKind::Line),
        ContextButton::StrokeDown => state.stroke_width = (state.stroke_width - 1).max(1),
        ContextButton::StrokeUp => state.stroke_width = (state.stroke_width + 1).min(18),
        ContextButton::TextDown => state.text_size = (state.text_size - 2).max(14),
        ContextButton::TextUp => state.text_size = (state.text_size + 2).min(72),
        ContextButton::ColorRed => state.active_color = DrawColor::Red,
        ContextButton::ColorBlue => state.active_color = DrawColor::Blue,
        ContextButton::ColorBlack => state.active_color = DrawColor::Black,
        ContextButton::Fill => state.shape_fill = !state.shape_fill,
        ContextButton::Delete => delete_selected_annotation(state),
    }
    request_overlay_render(hwnd, state);
}

unsafe fn confirm_overlay(hwnd: HWND, state: &mut NativeSelectionState, action: OutputAction) {
    if !state
        .selection
        .is_some_and(|selection| selection.is_valid())
    {
        return;
    }
    commit_active_text_annotation(state);
    state.mode = OverlayMode::Confirmed;
    state.output_action = Some(action);
    state.pointer_down = false;
    state.drag_origin = None;
    state.draft_annotation = None;
    state.text_draft_index = None;
    state.moving_annotation = None;
    let _ = ReleaseCapture();
    let _ = DestroyWindow(hwnd);
}

unsafe fn cancel_overlay(hwnd: HWND, state: &mut NativeSelectionState) {
    state.mode = OverlayMode::Cancelled;
    state.pointer_down = false;
    state.drag_origin = None;
    state.draft_annotation = None;
    state.text_draft_index = None;
    state.moving_annotation = None;
    let _ = ReleaseCapture();
    let _ = DestroyWindow(hwnd);
}

unsafe fn update_hover_cursor(state: &NativeSelectionState, x: i32, y: i32) {
    match hit_test(state, x, y) {
        HitTarget::ToolbarButton(_) | HitTarget::ContextButton(_) => set_system_cursor(IDC_HAND),
        HitTarget::Annotation(_) => set_system_cursor(IDC_SIZEALL),
        HitTarget::Handle(handle) => set_cursor_for_handle(handle),
        HitTarget::InsideSelection => {
            if state.mode == OverlayMode::Editing {
                if matches!(state.active_tool, EditorTool::Text) {
                    set_system_cursor(IDC_CROSS);
                } else if matches!(state.active_tool, EditorTool::Select) {
                    set_system_cursor(IDC_ARROW);
                } else {
                    set_system_cursor(IDC_CROSS);
                }
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

unsafe fn begin_annotation(hwnd: HWND, state: &mut NativeSelectionState, local: PointI) {
    commit_active_text_annotation(state);
    state.selected_annotation = None;
    match state.active_tool {
        EditorTool::Select => {}
        EditorTool::Pen => {
            state.draft_annotation = Some(Annotation::Pen {
                points: vec![local],
                color: state.active_color,
                stroke: state.stroke_width,
            });
            state.mode = OverlayMode::Drawing;
            state.pointer_down = true;
            SetCapture(hwnd);
        }
        EditorTool::Arrow => {
            state.draft_annotation = Some(Annotation::Arrow {
                start: local,
                end: local,
                color: state.active_color,
                stroke: state.stroke_width,
            });
            state.mode = OverlayMode::Drawing;
            state.pointer_down = true;
            SetCapture(hwnd);
        }
        EditorTool::Text => {
            push_history(state);
            state.annotations.push(Annotation::Text {
                pos: local,
                text: String::new(),
                color: state.active_color,
                size: state.text_size,
            });
            state.text_draft_index = state.annotations.len().checked_sub(1);
            state.mode = OverlayMode::Editing;
            request_overlay_render(hwnd, state);
        }
        EditorTool::Shape(kind) => {
            state.draft_annotation = Some(Annotation::Shape {
                kind,
                start: local,
                end: local,
                color: state.active_color,
                stroke: state.stroke_width,
                fill: state.shape_fill,
            });
            state.mode = OverlayMode::Drawing;
            state.pointer_down = true;
            SetCapture(hwnd);
        }
    }
}

fn update_draft_annotation(state: &mut NativeSelectionState, local: PointI) {
    match state.draft_annotation.as_mut() {
        Some(Annotation::Pen { points, .. }) => {
            if points
                .last()
                .map(|last| (last.x - local.x).abs() + (last.y - local.y).abs() >= 2)
                .unwrap_or(true)
            {
                points.push(local);
            }
        }
        Some(Annotation::Arrow { end, .. }) | Some(Annotation::Shape { end, .. }) => {
            *end = local;
        }
        Some(Annotation::Text { .. }) | None => {}
    }
}

fn commit_draft_annotation(state: &mut NativeSelectionState) {
    let Some(annotation) = state.draft_annotation.take() else {
        return;
    };
    if !annotation_is_meaningful(&annotation) {
        return;
    }
    push_history(state);
    state.annotations.push(annotation);
}

fn annotation_is_meaningful(annotation: &Annotation) -> bool {
    match annotation {
        Annotation::Pen { points, .. } => points.len() >= 2,
        Annotation::Arrow { start, end, .. } | Annotation::Shape { start, end, .. } => {
            (start.x - end.x).abs() >= 4 || (start.y - end.y).abs() >= 4
        }
        Annotation::Text { text, .. } => !text.trim().is_empty(),
    }
}

fn push_history(state: &mut NativeSelectionState) {
    state.history.push(state.annotations.clone());
    if state.history.len() > HISTORY_LIMIT {
        state.history.remove(0);
    }
}

fn undo_annotations(state: &mut NativeSelectionState) {
    if let Some(previous) = state.history.pop() {
        state.annotations = previous;
        state.selected_annotation = None;
        state.draft_annotation = None;
        state.text_draft_index = None;
        state.moving_annotation = None;
        state.mode = if state.selection.is_some() {
            OverlayMode::Editing
        } else {
            OverlayMode::Selecting
        };
    }
}

fn delete_selected_annotation(state: &mut NativeSelectionState) {
    let Some(index) = state.selected_annotation else {
        return;
    };
    if index >= state.annotations.len() {
        state.selected_annotation = None;
        return;
    }
    push_history(state);
    state.annotations.remove(index);
    state.selected_annotation = None;
    state.text_draft_index = None;
    state.moving_annotation = None;
}

fn append_text_draft_char(state: &mut NativeSelectionState, ch: char) -> bool {
    let Some(index) = state.text_draft_index else {
        return false;
    };
    let Some(Annotation::Text { text, .. }) = state.annotations.get_mut(index) else {
        return false;
    };
    text.push(ch);
    true
}

fn remove_text_draft_char(state: &mut NativeSelectionState) -> bool {
    let Some(index) = state.text_draft_index else {
        return false;
    };
    let Some(Annotation::Text { text, .. }) = state.annotations.get_mut(index) else {
        return false;
    };
    text.pop().is_some()
}

fn commit_active_text_annotation(state: &mut NativeSelectionState) {
    let Some(index) = state.text_draft_index.take() else {
        return;
    };
    if index >= state.annotations.len() {
        return;
    }
    if !annotation_is_meaningful(&state.annotations[index]) {
        state.annotations.remove(index);
    }
}

fn cancel_active_text_annotation(state: &mut NativeSelectionState) {
    let Some(index) = state.text_draft_index.take() else {
        return;
    };
    if index < state.annotations.len() {
        state.annotations.remove(index);
    }
    let _ = state.history.pop();
}

fn moved_annotation(annotation: &Annotation, delta: PointI) -> Annotation {
    let move_point = |point: PointI| PointI {
        x: point.x + delta.x,
        y: point.y + delta.y,
    };
    match annotation {
        Annotation::Pen {
            points,
            color,
            stroke,
        } => Annotation::Pen {
            points: points.iter().copied().map(move_point).collect(),
            color: *color,
            stroke: *stroke,
        },
        Annotation::Arrow {
            start,
            end,
            color,
            stroke,
        } => Annotation::Arrow {
            start: move_point(*start),
            end: move_point(*end),
            color: *color,
            stroke: *stroke,
        },
        Annotation::Shape {
            kind,
            start,
            end,
            color,
            stroke,
            fill,
        } => Annotation::Shape {
            kind: *kind,
            start: move_point(*start),
            end: move_point(*end),
            color: *color,
            stroke: *stroke,
            fill: *fill,
        },
        Annotation::Text {
            pos,
            text,
            color,
            size,
        } => Annotation::Text {
            pos: move_point(*pos),
            text: text.clone(),
            color: *color,
            size: *size,
        },
    }
}

fn screen_to_local_point(point: PointI, selection: SelectionRect) -> PointI {
    PointI {
        x: clamp_i32(point.x - selection.left, 0, selection.width as i32),
        y: clamp_i32(point.y - selection.top, 0, selection.height as i32),
    }
}

fn to_screen_point(point: PointI, selection: SelectionRect) -> PointI {
    PointI {
        x: selection.left + point.x,
        y: selection.top + point.y,
    }
}

fn hit_test_annotation(
    state: &NativeSelectionState,
    selection: SelectionRect,
    local: PointI,
) -> Option<usize> {
    state
        .annotations
        .iter()
        .enumerate()
        .rev()
        .find_map(|(index, annotation)| {
            let bounds = annotation_local_bounds(annotation);
            let padding = annotation_hit_padding(annotation);
            let rect = RECT {
                left: bounds.left - padding,
                top: bounds.top - padding,
                right: bounds.right + padding,
                bottom: bounds.bottom + padding,
            };
            if point_in_rect(local.x, local.y, rect)
                && rect_intersects(rect, local_selection_rect(selection))
            {
                Some(index)
            } else {
                None
            }
        })
}

fn annotation_hit_padding(annotation: &Annotation) -> i32 {
    match annotation {
        Annotation::Pen { stroke, .. }
        | Annotation::Arrow { stroke, .. }
        | Annotation::Shape { stroke, .. } => (*stroke + 8).max(10),
        Annotation::Text { size, .. } => (*size / 3).max(8),
    }
}

fn annotation_screen_bounds(annotation: &Annotation, selection: SelectionRect) -> RECT {
    let local = annotation_local_bounds(annotation);
    RECT {
        left: selection.left + local.left,
        top: selection.top + local.top,
        right: selection.left + local.right,
        bottom: selection.top + local.bottom,
    }
}

fn annotation_local_bounds(annotation: &Annotation) -> RECT {
    match annotation {
        Annotation::Pen { points, stroke, .. } => {
            let Some(first) = points.first().copied() else {
                return empty_rect();
            };
            let mut left = first.x;
            let mut right = first.x;
            let mut top = first.y;
            let mut bottom = first.y;
            for point in points {
                left = left.min(point.x);
                right = right.max(point.x);
                top = top.min(point.y);
                bottom = bottom.max(point.y);
            }
            let pad = (*stroke).max(1);
            RECT {
                left: left - pad,
                top: top - pad,
                right: right + pad,
                bottom: bottom + pad,
            }
        }
        Annotation::Arrow {
            start, end, stroke, ..
        }
        | Annotation::Shape {
            start, end, stroke, ..
        } => {
            let mut rect = rect_from_screen_points(*start, *end);
            let pad = (*stroke).max(1) * 2;
            rect.left -= pad;
            rect.top -= pad;
            rect.right += pad;
            rect.bottom += pad;
            rect
        }
        Annotation::Text {
            pos, text, size, ..
        } => {
            let width = (text.chars().count() as i32 * (*size / 2).max(8)).max(*size);
            RECT {
                left: pos.x,
                top: pos.y,
                right: pos.x + width + 8,
                bottom: pos.y + size + 8,
            }
        }
    }
}

fn empty_rect() -> RECT {
    RECT {
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
    }
}

fn local_selection_rect(selection: SelectionRect) -> RECT {
    RECT {
        left: 0,
        top: 0,
        right: selection.width as i32,
        bottom: selection.height as i32,
    }
}

fn rect_intersects(a: RECT, b: RECT) -> bool {
    a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
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
    for (button, rect) in context_button_rects(selection, state) {
        if point_in_rect(x, y, rect) {
            return HitTarget::ContextButton(button);
        }
    }

    if state.mode == OverlayMode::Editing {
        if matches!(state.active_tool, EditorTool::Select) {
            if let Some(index) = hit_test_annotation(
                state,
                selection,
                screen_to_local_point(PointI { x, y }, selection),
            ) {
                return HitTarget::Annotation(index);
            }
        }
        if x >= selection.left
            && x <= selection.right()
            && y >= selection.top
            && y <= selection.bottom()
        {
            return HitTarget::InsideSelection;
        }
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
    if let Some(image) = &state.frozen_image {
        copy_image_to_overlay_pixels(pixels, width, height, image);
    }

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
        draw_annotations_pixels(pixels, width, height, state, selection);
        draw_selection_border_pixels(pixels, width, height, selection);
        if matches!(
            state.mode,
            OverlayMode::Adjusting | OverlayMode::Moving | OverlayMode::Resizing(_)
        ) {
            draw_resize_handles_pixels(pixels, width, height, selection);
        }
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
        render_annotation_text(hdc, state, selection);
        render_toolbar_text(hdc, state, selection);
    }
}

fn copy_image_to_overlay_pixels(pixels: &mut [u32], width: i32, height: i32, image: &RgbaImage) {
    let copy_width = width.min(image.width() as i32).max(0);
    let copy_height = height.min(image.height() as i32).max(0);
    for y in 0..copy_height {
        let row_start = y as usize * width as usize;
        for x in 0..copy_width {
            let source = image.get_pixel(x as u32, y as u32).0;
            pixels[row_start + x as usize] = rgba(source[0], source[1], source[2], 255);
        }
    }
}

fn draw_annotations_pixels(
    pixels: &mut [u32],
    width: i32,
    height: i32,
    state: &NativeSelectionState,
    selection: SelectionRect,
) {
    for (index, annotation) in state.annotations.iter().enumerate() {
        draw_annotation_pixels(pixels, width, height, annotation, selection);
        if state.selected_annotation == Some(index) {
            stroke_rect_pixels(
                pixels,
                width,
                height,
                annotation_screen_bounds(annotation, selection),
                1,
                rgba(255, 255, 255, 255),
            );
        }
    }
    if let Some(annotation) = &state.draft_annotation {
        draw_annotation_pixels(pixels, width, height, annotation, selection);
    }
}

fn draw_annotation_pixels(
    pixels: &mut [u32],
    width: i32,
    height: i32,
    annotation: &Annotation,
    selection: SelectionRect,
) {
    match annotation {
        Annotation::Pen {
            points,
            color,
            stroke,
        } => {
            for pair in points.windows(2) {
                draw_line_pixels(
                    pixels,
                    width,
                    height,
                    to_screen_point(pair[0], selection),
                    to_screen_point(pair[1], selection),
                    *stroke,
                    color.rgba(),
                );
            }
        }
        Annotation::Arrow {
            start,
            end,
            color,
            stroke,
        } => draw_arrow_pixels(
            pixels,
            width,
            height,
            to_screen_point(*start, selection),
            to_screen_point(*end, selection),
            *stroke,
            color.rgba(),
        ),
        Annotation::Shape {
            kind,
            start,
            end,
            color,
            stroke,
            fill,
        } => draw_shape_pixels(
            pixels,
            width,
            height,
            *kind,
            to_screen_point(*start, selection),
            to_screen_point(*end, selection),
            *stroke,
            color.rgba(),
            *fill,
        ),
        Annotation::Text { .. } => {}
    }
}

unsafe fn render_annotation_text(hdc: HDC, state: &NativeSelectionState, selection: SelectionRect) {
    for annotation in &state.annotations {
        render_text_annotation(hdc, annotation, selection, false);
    }
    if let Some(annotation) = &state.draft_annotation {
        render_text_annotation(hdc, annotation, selection, true);
    }
}

unsafe fn render_text_annotation(
    hdc: HDC,
    annotation: &Annotation,
    selection: SelectionRect,
    draft: bool,
) {
    let Annotation::Text {
        pos,
        text,
        color,
        size,
    } = annotation
    else {
        return;
    };
    let font = CreateFontW(
        -*size,
        0,
        0,
        0,
        FW_NORMAL.0 as i32,
        0,
        0,
        0,
        DEFAULT_CHARSET,
        OUT_DEFAULT_PRECIS,
        CLIP_DEFAULT_PRECIS,
        DEFAULT_QUALITY,
        DEFAULT_PITCH.0 as u32,
        w!("Microsoft YaHei UI"),
    );
    let previous_font = SelectObject(hdc, HGDIOBJ(font.0));
    let _ = SetBkMode(hdc, TRANSPARENT);
    let _ = SetTextColor(hdc, color.colorref());
    let screen = to_screen_point(*pos, selection);
    let mut text_rect = RECT {
        left: screen.x,
        top: screen.y,
        right: selection.right(),
        bottom: selection.bottom(),
    };
    let mut label: Vec<u16> = if text.is_empty() {
        Vec::new()
    } else {
        text.encode_utf16().collect()
    };
    if !label.is_empty() {
        let _ = DrawTextW(
            hdc,
            &mut label,
            &mut text_rect,
            DT_LEFT | DT_SINGLELINE | DT_END_ELLIPSIS,
        );
    }
    if draft {
        let caret_x = text_rect.left + text.len() as i32 * (*size / 2).max(8) + 2;
        fill_gdi_text_caret(hdc, caret_x, screen.y, *size);
    }
    SelectObject(hdc, previous_font);
    let _ = DeleteObject(HGDIOBJ(font.0));
}

unsafe fn fill_gdi_text_caret(hdc: HDC, x: i32, y: i32, height: i32) {
    let rect = RECT {
        left: x,
        top: y,
        right: x + 2,
        bottom: y + height.max(12),
    };
    let brush = CreateSolidBrush(rgb(42, 137, 255));
    let _ = FillRect(hdc, &rect, brush);
    let _ = DeleteObject(HGDIOBJ(brush.0));
}

fn draw_shape_pixels(
    pixels: &mut [u32],
    width: i32,
    height: i32,
    kind: ShapeKind,
    start: PointI,
    end: PointI,
    stroke: i32,
    color: u32,
    fill: bool,
) {
    match kind {
        ShapeKind::Rectangle => {
            let rect = rect_from_screen_points(start, end);
            if fill {
                fill_rect_pixels(pixels, width, height, rect, color);
            }
            stroke_rect_pixels(pixels, width, height, rect, stroke, color);
        }
        ShapeKind::Ellipse => {
            draw_ellipse_pixels(pixels, width, height, start, end, stroke, color, fill)
        }
        ShapeKind::Line => draw_line_pixels(pixels, width, height, start, end, stroke, color),
    }
}

fn draw_line_pixels(
    pixels: &mut [u32],
    width: i32,
    height: i32,
    start: PointI,
    end: PointI,
    stroke: i32,
    color: u32,
) {
    let mut x0 = start.x;
    let mut y0 = start.y;
    let x1 = end.x;
    let y1 = end.y;
    let dx = (x1 - x0).abs();
    let sx = if x0 < x1 { 1 } else { -1 };
    let dy = -(y1 - y0).abs();
    let sy = if y0 < y1 { 1 } else { -1 };
    let mut err = dx + dy;
    loop {
        draw_disc_pixels(pixels, width, height, x0, y0, stroke.max(1), color);
        if x0 == x1 && y0 == y1 {
            break;
        }
        let e2 = 2 * err;
        if e2 >= dy {
            err += dy;
            x0 += sx;
        }
        if e2 <= dx {
            err += dx;
            y0 += sy;
        }
    }
}

fn draw_arrow_pixels(
    pixels: &mut [u32],
    width: i32,
    height: i32,
    start: PointI,
    end: PointI,
    stroke: i32,
    color: u32,
) {
    draw_line_pixels(pixels, width, height, start, end, stroke, color);
    let angle = ((end.y - start.y) as f64).atan2((end.x - start.x) as f64);
    let head_len = (stroke.max(2) * 5) as f64;
    for offset in [2.6_f64, -2.6_f64] {
        let a = angle + offset;
        let point = PointI {
            x: end.x - (head_len * a.cos()).round() as i32,
            y: end.y - (head_len * a.sin()).round() as i32,
        };
        draw_line_pixels(pixels, width, height, end, point, stroke, color);
    }
}

fn draw_ellipse_pixels(
    pixels: &mut [u32],
    width: i32,
    height: i32,
    start: PointI,
    end: PointI,
    stroke: i32,
    color: u32,
    fill: bool,
) {
    let rect = rect_from_screen_points(start, end);
    let rx = ((rect.right - rect.left).abs() / 2).max(1);
    let ry = ((rect.bottom - rect.top).abs() / 2).max(1);
    let cx = rect.left + rx;
    let cy = rect.top + ry;
    let stroke = stroke.max(1);
    for y in (cy - ry)..=(cy + ry) {
        for x in (cx - rx)..=(cx + rx) {
            let nx = (x - cx) as f64 / rx as f64;
            let ny = (y - cy) as f64 / ry as f64;
            let v = nx * nx + ny * ny;
            if (fill && v <= 1.0)
                || (!fill && v >= 1.0 - stroke as f64 / rx.max(ry) as f64 && v <= 1.08)
            {
                set_pixel(pixels, width, height, x, y, color);
            }
        }
    }
}

fn draw_disc_pixels(
    pixels: &mut [u32],
    width: i32,
    height: i32,
    x: i32,
    y: i32,
    size: i32,
    color: u32,
) {
    let radius = ((size + 1) / 2).max(1);
    for py in (y - radius)..=(y + radius) {
        for px in (x - radius)..=(x + radius) {
            if (px - x) * (px - x) + (py - y) * (py - y) <= radius * radius {
                set_pixel(pixels, width, height, px, py, color);
            }
        }
    }
}

fn set_pixel(pixels: &mut [u32], width: i32, height: i32, x: i32, y: i32, color: u32) {
    if x < 0 || y < 0 || x >= width || y >= height {
        return;
    }
    pixels[y as usize * width as usize + x as usize] = color;
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
        let active = toolbar_button_active(state, button);
        let bg = if active {
            rgba(42, 137, 255, 255)
        } else {
            rgba(39, 45, 54, 255)
        };
        fill_rect_pixels(pixels, width, height, rect, bg);
    }

    let context_buttons = context_button_rects(selection, state);
    if !context_buttons.is_empty() {
        let context_toolbar = context_toolbar_bounds(&context_buttons);
        fill_rect_pixels(
            pixels,
            width,
            height,
            context_toolbar,
            rgba(248, 250, 252, 245),
        );
        stroke_rect_pixels(
            pixels,
            width,
            height,
            context_toolbar,
            1,
            rgba(210, 216, 224, 255),
        );
    }
    for (button, rect) in context_buttons {
        let active = context_button_active(state, button);
        fill_rect_pixels(
            pixels,
            width,
            height,
            rect,
            if active {
                rgba(42, 137, 255, 255)
            } else {
                rgba(245, 247, 250, 245)
            },
        );
        stroke_rect_pixels(pixels, width, height, rect, 1, rgba(220, 225, 232, 255));
        if matches!(
            button,
            ContextButton::ColorRed | ContextButton::ColorBlue | ContextButton::ColorBlack
        ) {
            let color = match button {
                ContextButton::ColorRed => DrawColor::Red,
                ContextButton::ColorBlue => DrawColor::Blue,
                ContextButton::ColorBlack => DrawColor::Black,
                _ => DrawColor::Red,
            };
            fill_rect_pixels(
                pixels,
                width,
                height,
                RECT {
                    left: rect.left + 11,
                    top: rect.top + 8,
                    right: rect.right - 11,
                    bottom: rect.bottom - 8,
                },
                color.rgba(),
            );
        }
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
    for (button, rect) in context_button_rects(selection, state) {
        if matches!(
            button,
            ContextButton::ColorRed | ContextButton::ColorBlue | ContextButton::ColorBlack
        ) {
            continue;
        }
        let mut text_rect = rect;
        text_rect.left += 5;
        text_rect.right -= 5;
        let _ = SetBkMode(hdc, TRANSPARENT);
        let _ = SetTextColor(
            hdc,
            if context_button_active(state, button) {
                rgb(255, 255, 255)
            } else {
                rgb(22, 27, 34)
            },
        );
        let mut label: Vec<u16> = context_button_label(button, state).encode_utf16().collect();
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

fn rect_from_screen_points(start: PointI, end: PointI) -> RECT {
    RECT {
        left: start.x.min(end.x),
        top: start.y.min(end.y),
        right: start.x.max(end.x),
        bottom: start.y.max(end.y),
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
) -> Vec<(ToolButton, RECT)> {
    let button_specs = [
        (ToolButton::Select, 48),
        (ToolButton::Arrow, 48),
        (ToolButton::Pen, 48),
        (ToolButton::Text, 48),
        (ToolButton::Shape, 48),
        (ToolButton::Undo, 48),
        (ToolButton::Save, 48),
        (ToolButton::Cancel, 48),
        (ToolButton::Send, 48),
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
        (monitor_width - total_width - SCREEN_PADDING).max(SCREEN_PADDING),
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
    button_specs
        .iter()
        .map(|(button, button_width)| {
            let rect = RECT {
                left: cursor_left,
                top: toolbar_top + 5,
                right: cursor_left + *button_width,
                bottom: toolbar_top + TOOLBAR_HEIGHT - 5,
            };
            cursor_left += *button_width + TOOLBAR_BUTTON_GAP;
            (*button, rect)
        })
        .collect()
}

fn toolbar_bounds(buttons: &[(ToolButton, RECT)]) -> RECT {
    let Some((_, first)) = buttons.first() else {
        return empty_rect();
    };
    let Some((_, last)) = buttons.last() else {
        return empty_rect();
    };
    RECT {
        left: first.left - TOOLBAR_PADDING_X,
        top: first.top - 5,
        right: last.right + TOOLBAR_PADDING_X,
        bottom: first.bottom + 5,
    }
}

fn context_button_rects(
    selection: SelectionRect,
    state: &NativeSelectionState,
) -> Vec<(ContextButton, RECT)> {
    let specs: Vec<(ContextButton, i32)> = match state.active_tool {
        EditorTool::Pen | EditorTool::Arrow => vec![
            (ContextButton::StrokeDown, 34),
            (ContextButton::StrokeUp, 34),
            (ContextButton::ColorRed, 34),
            (ContextButton::ColorBlue, 34),
            (ContextButton::ColorBlack, 34),
            (ContextButton::Delete, 44),
        ],
        EditorTool::Text => vec![
            (ContextButton::TextDown, 34),
            (ContextButton::TextUp, 34),
            (ContextButton::ColorRed, 34),
            (ContextButton::ColorBlue, 34),
            (ContextButton::ColorBlack, 34),
            (ContextButton::Delete, 44),
        ],
        EditorTool::Shape(_) => vec![
            (ContextButton::Rectangle, 44),
            (ContextButton::Ellipse, 44),
            (ContextButton::Line, 44),
            (ContextButton::StrokeDown, 34),
            (ContextButton::StrokeUp, 34),
            (ContextButton::ColorRed, 34),
            (ContextButton::ColorBlue, 34),
            (ContextButton::ColorBlack, 34),
            (ContextButton::Fill, 44),
            (ContextButton::Delete, 44),
        ],
        EditorTool::Select => {
            if state.selected_annotation.is_some() {
                vec![(ContextButton::Delete, 44)]
            } else {
                Vec::new()
            }
        }
    };
    if specs.is_empty() {
        return Vec::new();
    }

    let total_width: i32 = specs.iter().map(|(_, width)| *width).sum::<i32>()
        + TOOLBAR_PADDING_X * 2
        + TOOLBAR_BUTTON_GAP * (specs.len() as i32 - 1);
    let monitor_width = state.monitor.width as i32;
    let monitor_height = state.monitor.height as i32;
    let main_toolbar = toolbar_bounds(&toolbar_button_rects(selection, state.monitor));
    let mut left = selection.left + (selection.width as i32 - total_width) / 2;
    left = clamp_i32(
        left,
        SCREEN_PADDING,
        (monitor_width - total_width - SCREEN_PADDING).max(SCREEN_PADDING),
    );

    let above_main_top = main_toolbar.top - CONTEXT_TOOLBAR_HEIGHT - 6;
    let below_main_top = main_toolbar.bottom + 6;
    let top = if above_main_top >= SCREEN_PADDING {
        above_main_top
    } else {
        clamp_i32(
            below_main_top,
            SCREEN_PADDING,
            (monitor_height - CONTEXT_TOOLBAR_HEIGHT - SCREEN_PADDING).max(SCREEN_PADDING),
        )
    };

    let mut cursor_left = left + TOOLBAR_PADDING_X;
    specs
        .iter()
        .map(|(button, button_width)| {
            let rect = RECT {
                left: cursor_left,
                top: top + 5,
                right: cursor_left + *button_width,
                bottom: top + CONTEXT_TOOLBAR_HEIGHT - 5,
            };
            cursor_left += *button_width + TOOLBAR_BUTTON_GAP;
            (*button, rect)
        })
        .collect()
}

fn context_toolbar_bounds(buttons: &[(ContextButton, RECT)]) -> RECT {
    let Some((_, first)) = buttons.first() else {
        return empty_rect();
    };
    let Some((_, last)) = buttons.last() else {
        return empty_rect();
    };
    RECT {
        left: first.left - TOOLBAR_PADDING_X,
        top: first.top - 5,
        right: last.right + TOOLBAR_PADDING_X,
        bottom: first.bottom + 5,
    }
}

fn toolbar_button_active(state: &NativeSelectionState, button: ToolButton) -> bool {
    match button {
        ToolButton::Select => matches!(state.active_tool, EditorTool::Select),
        ToolButton::Arrow => matches!(state.active_tool, EditorTool::Arrow),
        ToolButton::Pen => matches!(state.active_tool, EditorTool::Pen),
        ToolButton::Text => matches!(state.active_tool, EditorTool::Text),
        ToolButton::Shape => matches!(state.active_tool, EditorTool::Shape(_)),
        ToolButton::Undo => !state.history.is_empty(),
        ToolButton::Save | ToolButton::Cancel | ToolButton::Send => false,
    }
}

fn context_button_active(state: &NativeSelectionState, button: ContextButton) -> bool {
    match button {
        ContextButton::Rectangle => {
            matches!(state.active_tool, EditorTool::Shape(ShapeKind::Rectangle))
        }
        ContextButton::Ellipse => {
            matches!(state.active_tool, EditorTool::Shape(ShapeKind::Ellipse))
        }
        ContextButton::Line => matches!(state.active_tool, EditorTool::Shape(ShapeKind::Line)),
        ContextButton::ColorRed => state.active_color == DrawColor::Red,
        ContextButton::ColorBlue => state.active_color == DrawColor::Blue,
        ContextButton::ColorBlack => state.active_color == DrawColor::Black,
        ContextButton::Fill => state.shape_fill,
        ContextButton::StrokeDown
        | ContextButton::StrokeUp
        | ContextButton::TextDown
        | ContextButton::TextUp
        | ContextButton::Delete => false,
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
        ToolButton::Select => "选择",
        ToolButton::Arrow => "箭头",
        ToolButton::Pen => "画笔",
        ToolButton::Text => "文字",
        ToolButton::Shape => "形状",
        ToolButton::Undo => "撤销",
        ToolButton::Save => "保存",
        ToolButton::Cancel => "取消",
        ToolButton::Send => "发送",
    }
}

fn context_button_label(button: ContextButton, state: &NativeSelectionState) -> String {
    match button {
        ContextButton::Rectangle => "矩形".to_string(),
        ContextButton::Ellipse => "圆形".to_string(),
        ContextButton::Line => "直线".to_string(),
        ContextButton::StrokeDown => format!("-{}", state.stroke_width),
        ContextButton::StrokeUp => format!("+{}", state.stroke_width),
        ContextButton::TextDown => format!("-{}", state.text_size),
        ContextButton::TextUp => format!("+{}", state.text_size),
        ContextButton::ColorRed | ContextButton::ColorBlue | ContextButton::ColorBlack => {
            String::new()
        }
        ContextButton::Fill => "填充".to_string(),
        ContextButton::Delete => "删除".to_string(),
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

fn compose_selection_image(
    frozen_image: &RgbaImage,
    selection: SelectionRect,
    annotations: &[Annotation],
) -> Result<RgbaImage, String> {
    if !selection.is_valid() {
        return Err("screenshot selection is too small".to_string());
    }
    let image_width = frozen_image.width() as i32;
    let image_height = frozen_image.height() as i32;
    let left = clamp_i32(selection.left, 0, image_width);
    let top = clamp_i32(selection.top, 0, image_height);
    let right = clamp_i32(selection.right(), left, image_width);
    let bottom = clamp_i32(selection.bottom(), top, image_height);
    if right <= left || bottom <= top {
        return Err("screenshot selection is outside the captured screen".to_string());
    }

    let width = (right - left) as u32;
    let height = (bottom - top) as u32;
    let mut image = RgbaImage::new(width, height);
    for y in 0..height {
        for x in 0..width {
            let pixel = *frozen_image.get_pixel(left as u32 + x, top as u32 + y);
            image.put_pixel(x, y, pixel);
        }
    }

    draw_annotations_on_image(&mut image, annotations);
    draw_text_annotations_on_image(&mut image, annotations)?;
    Ok(image)
}

fn draw_annotations_on_image(image: &mut RgbaImage, annotations: &[Annotation]) {
    let width = image.width() as i32;
    let height = image.height() as i32;
    let pixel_count = image.width() as usize * image.height() as usize;
    let mut pixels = vec![0_u32; pixel_count];
    for y in 0..image.height() {
        for x in 0..image.width() {
            let source = image.get_pixel(x, y).0;
            pixels[y as usize * image.width() as usize + x as usize] =
                rgba(source[0], source[1], source[2], source[3]);
        }
    }

    let selection = SelectionRect {
        left: 0,
        top: 0,
        width: image.width(),
        height: image.height(),
    };
    for annotation in annotations {
        draw_annotation_pixels(&mut pixels, width, height, annotation, selection);
    }

    for y in 0..image.height() {
        for x in 0..image.width() {
            let value = pixels[y as usize * image.width() as usize + x as usize];
            image.put_pixel(x, y, bgra_pixel_to_rgba(value));
        }
    }
}

fn draw_text_annotations_on_image(
    image: &mut RgbaImage,
    annotations: &[Annotation],
) -> Result<(), String> {
    if !annotations
        .iter()
        .any(|annotation| matches!(annotation, Annotation::Text { text, .. } if !text.is_empty()))
    {
        return Ok(());
    }

    unsafe {
        let width = image.width() as i32;
        let height = image.height() as i32;
        let screen_dc = GetDC(None);
        if screen_dc.0.is_null() {
            return Err("failed to get text render device context".to_string());
        }
        let memory_dc = CreateCompatibleDC(Some(screen_dc));
        if memory_dc.0.is_null() {
            let _ = ReleaseDC(None, screen_dc);
            return Err("failed to create text render device context".to_string());
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
        let bitmap = match CreateDIBSection(
            Some(screen_dc),
            &bitmap_info,
            DIB_RGB_COLORS,
            &mut bits,
            None,
            0,
        ) {
            Ok(bitmap) => bitmap,
            Err(error) => {
                let _ = DeleteDC(memory_dc);
                let _ = ReleaseDC(None, screen_dc);
                return Err(format!("failed to create text render buffer: {error}"));
            }
        };
        let previous_bitmap = SelectObject(memory_dc, HGDIOBJ(bitmap.0));
        if bits.is_null() {
            let _ = SelectObject(memory_dc, previous_bitmap);
            let _ = DeleteObject(HGDIOBJ(bitmap.0));
            let _ = DeleteDC(memory_dc);
            let _ = ReleaseDC(None, screen_dc);
            return Err("failed to map text render buffer".to_string());
        }

        let pixels = std::slice::from_raw_parts_mut(bits.cast::<u32>(), image.len() / 4);
        for y in 0..image.height() {
            for x in 0..image.width() {
                let source = image.get_pixel(x, y).0;
                pixels[y as usize * image.width() as usize + x as usize] =
                    rgba(source[0], source[1], source[2], source[3]);
            }
        }

        let selection = SelectionRect {
            left: 0,
            top: 0,
            width: image.width(),
            height: image.height(),
        };
        for annotation in annotations {
            render_text_annotation(memory_dc, annotation, selection, false);
        }

        for y in 0..image.height() {
            for x in 0..image.width() {
                let value = pixels[y as usize * image.width() as usize + x as usize];
                image.put_pixel(x, y, bgra_pixel_to_rgba(value));
            }
        }

        let _ = SelectObject(memory_dc, previous_bitmap);
        let _ = DeleteObject(HGDIOBJ(bitmap.0));
        let _ = DeleteDC(memory_dc);
        let _ = ReleaseDC(None, screen_dc);
    }

    Ok(())
}

fn bgra_pixel_to_rgba(value: u32) -> image::Rgba<u8> {
    let alpha = ((value >> 24) & 0xff) as u8;
    let red_premultiplied = ((value >> 16) & 0xff) as u8;
    let green_premultiplied = ((value >> 8) & 0xff) as u8;
    let blue_premultiplied = (value & 0xff) as u8;
    if alpha == 0 || alpha == 255 {
        return image::Rgba([
            red_premultiplied,
            green_premultiplied,
            blue_premultiplied,
            alpha,
        ]);
    }
    let unpremultiply =
        |value: u8| ((value as u32 * 255 + alpha as u32 / 2) / alpha as u32).min(255) as u8;
    image::Rgba([
        unpremultiply(red_premultiplied),
        unpremultiply(green_premultiplied),
        unpremultiply(blue_premultiplied),
        alpha,
    ])
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

fn choose_screenshot_save_path(app: &AppHandle) -> Result<PathBuf, String> {
    let default_dir = app
        .path()
        .picture_dir()
        .or_else(|_| app.path().download_dir())
        .or_else(|_| app.path().desktop_dir())
        .map_err(|error| format!("failed to resolve screenshot save directory: {error}"))?;
    let Some(path) = rfd::FileDialog::new()
        .set_title("保存截图")
        .set_directory(default_dir)
        .set_file_name(default_screenshot_filename())
        .add_filter("PNG 图片", &["png"])
        .save_file()
    else {
        return Err("screenshot save cancelled".to_string());
    };
    Ok(ensure_png_extension(path))
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
