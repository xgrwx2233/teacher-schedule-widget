use serde::{Deserialize, Serialize};
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};
use windows::Win32::{
    Foundation::{HWND, POINT, RECT},
    UI::{
        Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON},
        WindowsAndMessaging::{
            GetAncestor, GetClassNameW, GetCursorPos, GetWindowRect, SetWindowPos, WindowFromPoint,
            GA_ROOT, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOOWNERZORDER,
        },
    },
};

use crate::{app_state::AppState, desktop_icons};

pub const PROXY_WINDOW_LABEL: &str = "interaction-proxy";
pub const PROXY_EVENT: &str = "proxy-hitbox-result";
pub const PROXY_TRIGGER_EVENT: &str = "proxy-trigger";
pub type ProxyHitboxStore = Arc<Mutex<Vec<ProxyRectHitbox>>>;
pub type ProxyGeometryStore = Arc<Mutex<ProxyGeometry>>;
pub type ProxyUiStateStore = Arc<Mutex<ProxyUiState>>;

#[derive(Clone, Debug, Default)]
pub struct ProxyUiState {
    pub menu_open: bool,
    pub active_card: Option<ProxyWidgetHit>,
}

#[derive(Clone, Debug, Default)]
pub struct ProxyGeometry {
    pub css_width: f64,
    pub css_height: f64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyRectHitbox {
    pub kind: String,
    pub id: Option<String>,
    pub left: f64,
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyHitboxUpdate {
    pub css_width: f64,
    pub css_height: f64,
    pub hitboxes: Vec<ProxyRectHitbox>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyHitboxProbe {
    pub screen_x: i32,
    pub screen_y: i32,
    pub local_x: f64,
    pub local_y: f64,
    pub widget_hit: Option<ProxyWidgetHit>,
}

#[tauri::command]
pub fn update_proxy_hitboxes(
    update: ProxyHitboxUpdate,
    hitbox_store: tauri::State<'_, ProxyHitboxStore>,
    geometry_store: tauri::State<'_, ProxyGeometryStore>,
) -> Result<(), String> {
    let mut hitboxes = hitbox_store.lock().map_err(|_| "proxy hitbox store poisoned".to_string())?;
    *hitboxes = update.hitboxes;

    let mut geometry = geometry_store.lock().map_err(|_| "proxy geometry store poisoned".to_string())?;
    geometry.css_width = update.css_width;
    geometry.css_height = update.css_height;
    Ok(())
}

#[tauri::command]
pub fn clear_proxy_active_card(
    ui_state: tauri::State<'_, ProxyUiStateStore>,
) -> Result<(), String> {
    let mut state = ui_state
        .lock()
        .map_err(|_| "proxy ui state store poisoned".to_string())?;
    state.active_card = None;
    Ok(())
}

#[tauri::command]
pub fn clear_proxy_menu_open(
    ui_state: tauri::State<'_, ProxyUiStateStore>,
) -> Result<(), String> {
    let mut state = ui_state
        .lock()
        .map_err(|_| "proxy ui state store poisoned".to_string())?;
    state.menu_open = false;
    Ok(())
}

pub fn clear_interaction_state(
    app: &AppHandle,
    hitbox_store: &ProxyHitboxStore,
    ui_state: &ProxyUiStateStore,
) -> Result<(), String> {
    if let Ok(mut hitboxes) = hitbox_store.lock() {
        hitboxes.clear();
    }

    if let Ok(mut state) = ui_state.lock() {
        state.menu_open = false;
        state.active_card = None;
    }

    set_proxy_click_through(app, true)?;
    hide_proxy(app)?;
    Ok(())
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyWidgetHit {
    pub kind: String,
    pub id: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyHitboxResult {
    pub screen_x: i32,
    pub screen_y: i32,
    pub local_x: f64,
    pub local_y: f64,
    pub can_interact: bool,
    pub desktop_icon_hit: bool,
    pub widget_hit: Option<ProxyWidgetHit>,
}

#[tauri::command]
pub fn proxy_hitbox_probe(app: AppHandle, probe: ProxyHitboxProbe) -> Result<ProxyHitboxResult, String> {
    let desktop_icon_hit = desktop_icons::is_desktop_icon_at_screen_point(probe.screen_x, probe.screen_y);
    let can_interact = !desktop_icon_hit && probe.widget_hit.is_some();
    let result = ProxyHitboxResult {
        screen_x: probe.screen_x,
        screen_y: probe.screen_y,
        local_x: probe.local_x,
        local_y: probe.local_y,
        can_interact,
        desktop_icon_hit,
        widget_hit: probe.widget_hit,
    };

    set_proxy_click_through(&app, !can_interact)?;
    let _ = app.emit(PROXY_EVENT, result.clone());
    Ok(result)
}

#[tauri::command]
pub fn set_proxy_passthrough(app: AppHandle, passthrough: bool) -> Result<(), String> {
    set_proxy_click_through(&app, passthrough)
}

pub fn ensure_proxy_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(PROXY_WINDOW_LABEL) {
        return Ok(window);
    }

    let window = WebviewWindowBuilder::new(
        app,
        PROXY_WINDOW_LABEL,
        WebviewUrl::App("index.html#interaction-proxy".into()),
    )
    .title("Teacher Schedule Interaction Proxy")
    .devtools(true)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .resizable(false)
    .skip_taskbar(true)
    .visible(false)
    .always_on_top(true)
    .inner_size(700.0, 760.0)
    .build()
    .map_err(|error| error.to_string())?;

    window.set_ignore_cursor_events(true).map_err(|error| error.to_string())?;
    Ok(window)
}

pub fn show_proxy_for_widget(app: &AppHandle, widget: &WebviewWindow, state: &AppState) -> Result<(), String> {
    if !state.is_attached() {
        hide_proxy(app)?;
        return Ok(());
    }

    let proxy = ensure_proxy_window(app)?;
    sync_proxy_bounds(&proxy, widget)?;
    proxy.show().map_err(|error| error.to_string())?;
    proxy.set_ignore_cursor_events(true).map_err(|error| error.to_string())?;
    keep_proxy_topmost(&proxy)?;
    Ok(())
}

pub fn start_proxy_input_manager(
    app: AppHandle,
    widget: WebviewWindow,
    hitboxes: ProxyHitboxStore,
    geometry: ProxyGeometryStore,
    ui_state: ProxyUiStateStore,
    widget_visible: Arc<AtomicBool>,
) {
    thread::spawn(move || {
        let mut was_left_down = false;
        let mut pressed_hit: Option<ProxyWidgetHit> = None;
        let mut pending_card_click: Option<(ProxyWidgetHit, Instant)> = None;
        let double_click_interval = Duration::from_millis(500);
        let mut passthrough = true;
        let mut last_debug_state = String::new();

        loop {
            if !widget_visible.load(Ordering::Relaxed) {
                if let Some(proxy) = app.get_webview_window(PROXY_WINDOW_LABEL) {
                    let _ = proxy.set_ignore_cursor_events(true);
                    let _ = proxy.hide();
                }
                passthrough = true;
                was_left_down = false;
                pressed_hit = None;
                pending_card_click = None;
                last_debug_state.clear();
                thread::sleep(Duration::from_millis(50));
                continue;
            }

            let proxy = match app.get_webview_window(PROXY_WINDOW_LABEL) {
                Some(window) => window,
                None => {
                    thread::sleep(Duration::from_millis(100));
                    continue;
                }
            };

            let mut rect = RECT::default();
            let mut cursor = POINT::default();
            let ok = unsafe {
                let hwnd = HWND(widget.hwnd().map(|hwnd| hwnd.0).unwrap_or_default());
                GetWindowRect(hwnd, &mut rect).is_ok() && GetCursorPos(&mut cursor).is_ok()
            };

            if !ok {
                thread::sleep(Duration::from_millis(50));
                continue;
            }

            let inside = cursor.x >= rect.left
                && cursor.x < rect.right
                && cursor.y >= rect.top
                && cursor.y < rect.bottom;

            if !inside {
                if !passthrough {
                    let _ = proxy.set_ignore_cursor_events(true);
                    passthrough = true;
                }
                was_left_down = false;
                pressed_hit = None;
                pending_card_click = None;
                thread::sleep(Duration::from_millis(16));
                continue;
            }

            let physical_local_x = (cursor.x - rect.left) as f64;
            let physical_local_y = (cursor.y - rect.top) as f64;
            let physical_width = (rect.right - rect.left).max(1) as f64;
            let physical_height = (rect.bottom - rect.top).max(1) as f64;
            let (local_x, local_y) = map_physical_to_css(
                &geometry,
                physical_local_x,
                physical_local_y,
                physical_width,
                physical_height,
            );
            let widget_hit = hit_test_rects(&hitboxes, local_x, local_y);
            let desktop_icon_hit = desktop_icons::is_desktop_icon_at_screen_point(cursor.x, cursor.y);
            let point_exposed = is_widget_point_exposed(&app, &widget, cursor.x, cursor.y);
            let can_interact = !desktop_icon_hit && widget_hit.is_some() && point_exposed;
            let debug_state = format!(
                "hit={:?}; icon={}; exposed={}; interact={}",
                widget_hit.as_ref().map(|hit| (&hit.kind, &hit.id)),
                desktop_icon_hit,
                point_exposed,
                can_interact,
            );
            if debug_state != last_debug_state {
                eprintln!("interaction proxy: {debug_state}");
                last_debug_state = debug_state;
            }

            if passthrough == can_interact {
                let _ = proxy.set_ignore_cursor_events(!can_interact);
                passthrough = !can_interact;
            }

            let key_state = unsafe { GetAsyncKeyState(VK_LBUTTON.0 as i32) as u16 };
            let left_down = (key_state & 0x8000) != 0;
            let pressed_since_last_poll = (key_state & 0x0001) != 0;

            // High bit: the button is down right now.
            // Low bit: Windows observed a press since our last GetAsyncKeyState call.
            //
            // The low bit is intentionally used as a fallback. A very quick click
            // can press and release between two 16 ms polling ticks; in that case
            // the high bit is already false, so a pure left_down edge would miss
            // the click entirely.
            let sampled_press = left_down && !was_left_down;
            let fast_click_between_polls = pressed_since_last_poll && !left_down && !was_left_down;
            let just_pressed = sampled_press || fast_click_between_polls;
            let just_released = (!left_down && was_left_down) || fast_click_between_polls;

            // GetAsyncKeyState only reports sampled button state. It does not
            // produce a native click event for us, so the previous sample is still
            // required to avoid treating a held button as repeated clicks.
            if just_pressed {
                // Store the element under the cursor at mouse-down time. Desktop
                // icon priority is already included in can_interact, so an icon
                // covering the widget records no widget target.
                pressed_hit = if can_interact { widget_hit.clone() } else { None };
                eprintln!(
                    "interaction proxy press: hit={:?}; fast_click={}",
                    pressed_hit.as_ref().map(|hit| (&hit.kind, &hit.id)),
                    fast_click_between_polls,
                );
            }

            // Treat the mouse-up edge as click confirmation for the element that
            // received mouse-down. Do not require another hit-test on mouse-up:
            // this proxy deliberately switches back to click-through after the
            // press, so the release sample can legitimately report no widget hit.
            if just_released {
                if let Some(hit) = pressed_hit.take() {
                    let _ = proxy.set_ignore_cursor_events(true);
                    passthrough = true;
                    last_debug_state.clear();
                    let _ = app.emit(PROXY_EVENT, ProxyHitboxResult {
                        screen_x: cursor.x,
                        screen_y: cursor.y,
                        local_x,
                        local_y,
                        can_interact,
                        desktop_icon_hit,
                        widget_hit: Some(hit.clone()),
                    });
                    eprintln!("interaction proxy click: {:?}", hit);
                    handle_proxy_click(
                        &app,
                        &ui_state,
                        hit,
                        &mut pending_card_click,
                        double_click_interval,
                    );
                }
            }

            was_left_down = left_down;
            thread::sleep(Duration::from_millis(16));
        }
    });
}

fn handle_proxy_click(
    app: &AppHandle,
    _ui_state: &ProxyUiStateStore,
    hit: ProxyWidgetHit,
    pending_card_click: &mut Option<(ProxyWidgetHit, Instant)>,
    double_click_interval: Duration,
) {
    if matches!(
        hit.kind.as_str(),
        "menu-button" | "header-toggle" | "layout-toggle" | "previous-week" | "next-week"
    ) {
        pending_card_click.take();
        let _ = app.emit(PROXY_TRIGGER_EVENT, hit.clone());
        return;
    }

    if !is_card_hit(&hit) {
        pending_card_click.take();
        return;
    }

    let now = Instant::now();
    let double_clicked = pending_card_click
        .as_ref()
        .map(|(previous_hit, previous_time)| {
            same_proxy_hit(previous_hit, &hit)
                && now.duration_since(*previous_time) <= double_click_interval
        })
        .unwrap_or(false);

    if double_clicked {
        pending_card_click.take();
        eprintln!("interaction proxy double click: {:?}", hit);
        let _ = app.emit(PROXY_TRIGGER_EVENT, hit.clone());
        return;
    }

    *pending_card_click = Some((hit, now));
}

fn is_card_hit(hit: &ProxyWidgetHit) -> bool {
    matches!(hit.kind.as_str(), "course" | "period")
}

fn same_proxy_hit(left: &ProxyWidgetHit, right: &ProxyWidgetHit) -> bool {
    left.kind == right.kind && left.id == right.id
}

pub fn hide_proxy(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(PROXY_WINDOW_LABEL) {
        window.set_ignore_cursor_events(true).map_err(|error| error.to_string())?;
        window.hide().map_err(|error| error.to_string())?;
    }

    Ok(())
}

pub fn sync_proxy_bounds(proxy: &WebviewWindow, widget: &WebviewWindow) -> Result<(), String> {
    let hwnd = HWND(widget.hwnd().map_err(|error| error.to_string())?.0);
    let mut rect = RECT::default();

    unsafe {
        GetWindowRect(hwnd, &mut rect).map_err(|error| error.to_string())?;
    }

    let width = (rect.right - rect.left).max(1) as u32;
    let height = (rect.bottom - rect.top).max(1) as u32;
    proxy
        .set_position(PhysicalPosition { x: rect.left, y: rect.top })
        .map_err(|error| error.to_string())?;
    proxy
        .set_size(PhysicalSize { width, height })
        .map_err(|error| error.to_string())?;
    keep_proxy_topmost(proxy)?;
    Ok(())
}

fn set_proxy_click_through(app: &AppHandle, passthrough: bool) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(PROXY_WINDOW_LABEL) {
        window
            .set_ignore_cursor_events(passthrough)
            .map_err(|error| error.to_string())?;
    }

    Ok(())
}

fn keep_proxy_topmost(window: &WebviewWindow) -> Result<(), String> {
    let hwnd = HWND(window.hwnd().map_err(|error| error.to_string())?.0);
    unsafe {
        SetWindowPos(
            hwnd,
            Some(HWND_TOPMOST),
            0,
            0,
            0,
            0,
            SWP_NOACTIVATE | SWP_NOOWNERZORDER,
        )
        .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn hit_test_rects(store: &ProxyHitboxStore, x: f64, y: f64) -> Option<ProxyWidgetHit> {
    let hitboxes = store.lock().ok()?;

    for hitbox in hitboxes.iter() {
        if x < hitbox.left || x > hitbox.right || y < hitbox.top || y > hitbox.bottom {
            continue;
        }

        return Some(ProxyWidgetHit {
            kind: hitbox.kind.clone(),
            id: hitbox.id.clone(),
        });
    }

    None
}

fn map_physical_to_css(
    geometry_store: &ProxyGeometryStore,
    physical_x: f64,
    physical_y: f64,
    physical_width: f64,
    physical_height: f64,
) -> (f64, f64) {
    let geometry = geometry_store.lock().ok();
    let css_width = geometry
        .as_ref()
        .map(|item| item.css_width)
        .filter(|value| *value > 0.0)
        .unwrap_or(physical_width);
    let css_height = geometry
        .as_ref()
        .map(|item| item.css_height)
        .filter(|value| *value > 0.0)
        .unwrap_or(physical_height);

    (
        (physical_x / physical_width) * css_width,
        (physical_y / physical_height) * css_height,
    )
}

fn is_widget_point_exposed(app: &AppHandle, widget: &WebviewWindow, screen_x: i32, screen_y: i32) -> bool {
    matches!(
        top_window_kind(app, widget, screen_x, screen_y),
        Some(TopWindowKind::Widget | TopWindowKind::Shell)
    )
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum TopWindowKind {
    Widget,
    Shell,
    Overlay,
    Other,
}

fn top_window_kind(app: &AppHandle, widget: &WebviewWindow, screen_x: i32, screen_y: i32) -> Option<TopWindowKind> {
    let top = unsafe { WindowFromPoint(POINT { x: screen_x, y: screen_y }) };
    if top.0.is_null() {
        return None;
    }

    let root = unsafe { GetAncestor(top, GA_ROOT) };
    let widget_hwnd = HWND(widget.hwnd().ok()?.0);

    if same_hwnd(root, widget_hwnd) || same_hwnd(top, widget_hwnd) {
        return Some(TopWindowKind::Widget);
    }

    if is_overlay_window(app, root) || is_overlay_window(app, top) {
        return Some(TopWindowKind::Overlay);
    }

    if is_shell_window(root) || is_shell_window(top) {
        return Some(TopWindowKind::Shell);
    }

    Some(TopWindowKind::Other)
}

fn is_overlay_window(app: &AppHandle, hwnd: HWND) -> bool {
    for label in ["settings", "card-settings", "widget-menu"] {
        if let Some(window) = app.get_webview_window(label) {
            if let Ok(raw) = window.hwnd() {
                if same_hwnd(hwnd, HWND(raw.0)) {
                    return true;
                }
            }
        }
    }

    false
}

fn is_shell_window(hwnd: HWND) -> bool {
    let class_name = window_class_name(hwnd);
    matches!(
        class_name.as_deref(),
        Some("Progman") | Some("WorkerW") | Some("SHELLDLL_DefView") | Some("SysListView32")
    )
}

fn window_class_name(hwnd: HWND) -> Option<String> {
    let mut buffer = [0u16; 128];
    let len = unsafe { GetClassNameW(hwnd, &mut buffer) };
    if len == 0 {
        return None;
    }

    Some(String::from_utf16_lossy(&buffer[..len as usize]))
}

fn same_hwnd(left: HWND, right: HWND) -> bool {
    left.0 == right.0
}
