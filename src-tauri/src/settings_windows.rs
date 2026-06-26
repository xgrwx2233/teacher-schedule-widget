use std::{thread, time::Duration};
use std::sync::{Mutex, OnceLock};

use crate::screenshot_tool::{capture_screenshot_screen, ScreenshotCapturePayload};
use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, Manager, Runtime, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
};
use windows::Win32::{
    Foundation::HWND,
    UI::WindowsAndMessaging::{SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE, WDA_NONE},
};

const SETTINGS_WINDOW_LABEL: &str = "settings";
const CARD_SETTINGS_WINDOW_LABEL: &str = "card-settings";
const PERIOD_CARD_SETTINGS_WINDOW_LABEL: &str = "period-card-settings";
const INTERACTION_PROXY_WINDOW_LABEL: &str = "interaction-proxy";
const WIDGET_MENU_WINDOW_LABEL: &str = "widget-menu";
const FLOATING_TOOLBAR_WINDOW_LABEL: &str = "floating-toolbar";
const AUTH_WINDOW_LABEL: &str = "auth";
const CHAT_WINDOW_LABEL: &str = "chat";
const CHAT_HISTORY_WINDOW_LABEL: &str = "chat-history";
const GROUP_ANNOUNCEMENT_WINDOW_LABEL: &str = "group-announcements";
const PROFILE_EDIT_WINDOW_LABEL: &str = "profile-edit";
const CLASS_ACCOUNT_EDIT_WINDOW_LABEL: &str = "class-account-edit";
const FRIEND_PROFILE_WINDOW_LABEL: &str = "friend-profile";
const PROFILE_SEARCH_WINDOW_LABEL: &str = "profile-search";
const FRIEND_REQUEST_WINDOW_LABEL: &str = "friend-request";
const IMAGE_PREVIEW_WINDOW_LABEL: &str = "image-preview";
const MEDIA_VIEWER_WINDOW_LABEL: &str = "media-viewer";
const SCREENSHOT_WINDOW_LABEL: &str = "screenshot";
const WIDGET_WINDOW_LABEL: &str = "widget";

const SETTINGS_WINDOW_CLOSE_EVENT: &str = "settings-window-close";
const CARD_SETTINGS_WINDOW_CLOSE_EVENT: &str = "card-settings-window-close";
const WIDGET_MENU_CLOSE_EVENT: &str = "widget-menu-close";
const FLOATING_TOOLBAR_CLOSE_EVENT: &str = "floating-toolbar-close";
const FRIEND_PROFILE_OPEN_EVENT: &str = "friend-profile-open";
const FRIEND_REQUEST_OPEN_EVENT: &str = "friend-request-open";
const IMAGE_PREVIEW_OPEN_EVENT: &str = "image-preview-open";
const MEDIA_VIEWER_OPEN_EVENT: &str = "media-viewer-open";
const CHAT_HISTORY_OPEN_EVENT: &str = "chat-history-open";
const GROUP_ANNOUNCEMENT_OPEN_EVENT: &str = "group-announcement-open";
const SCREENSHOT_OPEN_START_EVENT: &str = "screenshot-open-start";
const SCREENSHOT_OPEN_EVENT: &str = "screenshot-open";

static LAST_GROUP_ANNOUNCEMENT_OPEN_PAYLOAD: OnceLock<
    Mutex<Option<GroupAnnouncementOpenPayload>>,
> = OnceLock::new();
static LAST_SCREENSHOT_OPEN_PAYLOAD: OnceLock<Mutex<Option<ScreenshotOpenPayload>>> =
    OnceLock::new();
static LAST_MEDIA_VIEWER_OPEN_PAYLOAD: OnceLock<Mutex<Option<MediaViewerOpenPayload>>> =
    OnceLock::new();

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WindowClosePayload {
    window_label: &'static str,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FriendProfileOpenPayload {
    user_id: i64,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImagePreviewItem {
    id: String,
    url: Option<String>,
    file_object_id: Option<String>,
    file_name: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImagePreviewOpenPayload {
    images: Vec<ImagePreviewItem>,
    active_id: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct MediaViewerItem {
    id: String,
    message_id: String,
    conversation_id: String,
    source_message_id: Option<String>,
    message_file_ref_id: Option<String>,
    source: String,
    source_id: String,
    #[serde(rename = "type")]
    media_type: String,
    local_poster_url: Option<String>,
    file_object_id: Option<String>,
    thumbnail_object_id: Option<String>,
    file_name: String,
    file_size: Option<i64>,
    width: Option<i64>,
    height: Option<i64>,
    duration: Option<f64>,
    sender_id: Option<i64>,
    sender_name: Option<String>,
    sent_at: Option<String>,
    seq: Option<i64>,
    local_candidates: Option<Vec<MediaViewerLocalCandidate>>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct MediaViewerLocalCandidate {
    path: String,
    label: Option<String>,
    source_type: Option<String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaViewerOpenPayload {
    conversation_id: String,
    conversation_title: Option<String>,
    active_id: String,
    current_index: i64,
    media_list: Vec<MediaViewerItem>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatHistoryOpenPayload {
    conversation_id: String,
    conversation_title: String,
    current_user_id: Option<i64>,
    peer_user_id: Option<i64>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupAnnouncementOpenPayload {
    group_id: String,
    group_name: String,
    current_user_role: Option<String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotOpenOptions {
    hide_current_window: Option<bool>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotOpenPayload {
    capture: ScreenshotCapturePayload,
    hidden_chat_window: bool,
}

#[tauri::command]
pub fn open_settings_window(app: AppHandle) -> Result<(), String> {
    ensure_settings_window(&app).map(|_| ())
}

#[tauri::command]
pub fn open_card_settings_window(
    app: AppHandle,
    title: Option<String>,
    window_label: Option<String>,
) -> Result<(), String> {
    let window = if window_label.as_deref() == Some(PERIOD_CARD_SETTINGS_WINDOW_LABEL) {
        ensure_period_card_settings_window(&app)?
    } else {
        ensure_card_settings_window(&app)?
    };

    if let Some(title) = title {
        window
            .set_title(&title)
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn open_widget_menu_window(app: AppHandle) -> Result<(), String> {
    ensure_widget_menu_window(&app).map(|_| ())
}

#[tauri::command]
pub fn open_floating_toolbar_window(app: AppHandle) -> Result<(), String> {
    ensure_floating_toolbar_window(&app).map(|_| ())
}

#[tauri::command]
pub fn open_auth_window(app: AppHandle) -> Result<(), String> {
    ensure_auth_window(&app).map(|_| ())
}

#[tauri::command]
pub fn open_chat_window(app: AppHandle) -> Result<(), String> {
    ensure_chat_window(&app).map(|_| ())
}

#[tauri::command]
pub fn open_chat_history_window(
    app: AppHandle,
    payload: ChatHistoryOpenPayload,
) -> Result<(), String> {
    let window = ensure_chat_history_window(&app)?;
    window
        .emit(CHAT_HISTORY_OPEN_EVENT, payload)
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn open_group_announcement_window(
    app: AppHandle,
    payload: GroupAnnouncementOpenPayload,
) -> Result<(), String> {
    set_last_group_announcement_open_payload(payload.clone())?;
    let window = ensure_group_announcement_window(&app)?;
    let _ = app.emit_to(
        GROUP_ANNOUNCEMENT_WINDOW_LABEL,
        GROUP_ANNOUNCEMENT_OPEN_EVENT,
        payload.clone(),
    );
    window
        .emit(GROUP_ANNOUNCEMENT_OPEN_EVENT, payload)
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_group_announcement_open_payload(
) -> Result<Option<GroupAnnouncementOpenPayload>, String> {
    get_last_group_announcement_open_payload()
}

#[tauri::command]
pub fn open_profile_edit_window(app: AppHandle) -> Result<(), String> {
    ensure_profile_edit_window(&app).map(|_| ())
}

#[tauri::command]
pub fn open_class_account_edit_window(app: AppHandle) -> Result<(), String> {
    ensure_class_account_edit_window(&app).map(|_| ())
}

#[tauri::command]
pub fn open_friend_profile_window(app: AppHandle, user_id: Option<i64>) -> Result<(), String> {
    let window = ensure_friend_profile_window(&app)?;
    if let Some(user_id) = user_id {
        window
            .emit(
                FRIEND_PROFILE_OPEN_EVENT,
                FriendProfileOpenPayload { user_id },
            )
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn open_profile_search_window(app: AppHandle) -> Result<(), String> {
    ensure_profile_search_window(&app).map(|_| ())
}

#[tauri::command]
pub fn open_friend_request_window(app: AppHandle, user_id: i64) -> Result<(), String> {
    let window = ensure_friend_request_window(&app)?;
    window
        .emit(
            FRIEND_REQUEST_OPEN_EVENT,
            FriendProfileOpenPayload { user_id },
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn open_image_preview_window(
    app: AppHandle,
    payload: ImagePreviewOpenPayload,
) -> Result<(), String> {
    let window = ensure_image_preview_window(&app)?;
    window
        .emit(IMAGE_PREVIEW_OPEN_EVENT, payload)
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn open_media_viewer_window(
    app: AppHandle,
    payload: MediaViewerOpenPayload,
) -> Result<(), String> {
    println!(
        "[media-rust] open_media_viewer_window start activeId={} currentIndex={} mediaListLength={}",
        payload.active_id,
        payload.current_index,
        payload.media_list.len()
    );
    if let Some(active) = payload
        .media_list
        .iter()
        .find(|item| item.id == payload.active_id)
        .or_else(|| payload.media_list.get(payload.current_index.max(0) as usize))
    {
        println!(
            "[media-rust] open_media_viewer_window active source={} sourceId={} messageFileRefId={:?} fileObjectId={:?} localCandidates={}",
            active.source,
            active.source_id,
            active.message_file_ref_id,
            active.file_object_id,
            active
                .local_candidates
                .as_ref()
                .map(|items| items.len())
                .unwrap_or(0)
        );
    }
    set_last_media_viewer_open_payload(payload.clone())?;
    let window = ensure_media_viewer_window(&app)?;
    let delayed_app = app.clone();
    let delayed_payload = payload.clone();
    let _ = app.emit_to(
        MEDIA_VIEWER_WINDOW_LABEL,
        MEDIA_VIEWER_OPEN_EVENT,
        payload.clone(),
    );
    window
        .emit(MEDIA_VIEWER_OPEN_EVENT, payload)
        .map_err(|error| error.to_string())?;
    thread::spawn(move || {
        for delay_ms in [120_u64, 420, 900] {
            thread::sleep(Duration::from_millis(delay_ms));
            let _ = delayed_app.emit_to(
                MEDIA_VIEWER_WINDOW_LABEL,
                MEDIA_VIEWER_OPEN_EVENT,
                delayed_payload.clone(),
            );
        }
    });
    Ok(())
}

#[tauri::command]
pub fn get_media_viewer_open_payload() -> Result<Option<MediaViewerOpenPayload>, String> {
    println!("[media-rust] get_media_viewer_open_payload");
    get_last_media_viewer_open_payload()
}

#[tauri::command]
pub fn open_screenshot_window(
    app: AppHandle,
    options: Option<ScreenshotOpenOptions>,
) -> Result<(), String> {
    let hide_current_window = options
        .as_ref()
        .and_then(|value| value.hide_current_window)
        .unwrap_or(false);
    if hide_current_window {
        if let Some(chat_window) = app.get_webview_window(CHAT_WINDOW_LABEL) {
            chat_window.hide().map_err(|error| error.to_string())?;
        }
        thread::sleep(Duration::from_millis(40));
    }
    clear_last_screenshot_open_payload()?;

    let window = if let Some(window) = app.get_webview_window(SCREENSHOT_WINDOW_LABEL) {
        window
    } else {
        create_screenshot_window(&app)?
    };
    let _ = window.emit(SCREENSHOT_OPEN_START_EVENT, ());
    let _ = window.set_always_on_top(true);
    let _ = window.set_fullscreen(true);
    let _ = set_window_capture_excluded(&window, true);
    window.show().map_err(|error| error.to_string())?;
    let _ = window.set_focus();
    let app_for_capture = app.clone();
    let window_for_capture = window.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(60));
        match capture_screenshot_screen(app_for_capture.clone()) {
            Ok(capture) => {
                let payload = ScreenshotOpenPayload {
                    capture,
                    hidden_chat_window: hide_current_window,
                };
                let _ = set_last_screenshot_open_payload(payload.clone());
                let _ = window_for_capture.show();
                let _ = window_for_capture.set_focus();
                let _ = app_for_capture.emit_to(
                    SCREENSHOT_WINDOW_LABEL,
                    SCREENSHOT_OPEN_EVENT,
                    payload.clone(),
                );
                if let Some(window) = app_for_capture.get_webview_window(SCREENSHOT_WINDOW_LABEL) {
                    let _ = window.emit(SCREENSHOT_OPEN_EVENT, payload);
                }
            }
            Err(error) => {
                let _ = set_window_capture_excluded(&window_for_capture, false);
                let _ = window_for_capture.hide();
                if hide_current_window {
                    if let Some(chat_window) =
                        app_for_capture.get_webview_window(CHAT_WINDOW_LABEL)
                    {
                        let _ = chat_window.show();
                        let _ = chat_window.set_focus();
                    }
                }
                let _ = app_for_capture.emit_to(
                    SCREENSHOT_WINDOW_LABEL,
                    SCREENSHOT_OPEN_ERROR_EVENT,
                    ScreenshotOpenErrorPayload { message: error },
                );
            }
        }
    });
    Ok(())
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScreenshotOpenErrorPayload {
    message: String,
}

const SCREENSHOT_OPEN_ERROR_EVENT: &str = "screenshot-open-error";

#[allow(dead_code)]
fn emit_screenshot_open_payload(
    app: &AppHandle,
    window: &WebviewWindow,
    payload: ScreenshotOpenPayload,
) -> Result<(), String> {
    let _ = app.emit_to(
        SCREENSHOT_WINDOW_LABEL,
        SCREENSHOT_OPEN_EVENT,
        payload.clone(),
    );
    window
        .emit(SCREENSHOT_OPEN_EVENT, payload)
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_screenshot_open_payload() -> Result<Option<ScreenshotOpenPayload>, String> {
    get_last_screenshot_open_payload()
}

#[tauri::command]
pub fn hide_screenshot_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(SCREENSHOT_WINDOW_LABEL) {
        let _ = set_window_capture_excluded(&window, false);
        window.hide().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn hide_auth_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(AUTH_WINDOW_LABEL) {
        window.hide().map_err(|error| error.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub fn toggle_auth_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(AUTH_WINDOW_LABEL) {
        if window.is_visible().map_err(|error| error.to_string())? {
            window.hide().map_err(|error| error.to_string())?;
            return Ok(());
        }
    }

    ensure_auth_window(&app).map(|_| ())
}

pub fn create_hidden_auxiliary_windows(app: &AppHandle) -> Result<(), String> {
    create_settings_window(app)?;
    create_widget_menu_window(app)?;
    create_card_settings_window(app)?;
    create_period_card_settings_window(app)?;
    create_floating_toolbar_window(app)?;
    create_auth_window(app)?;
    create_chat_window(app)?;
    create_chat_history_window(app)?;
    create_group_announcement_window(app)?;
    create_profile_edit_window(app)?;
    create_class_account_edit_window(app)?;
    create_friend_profile_window(app)?;
    create_profile_search_window(app)?;
    create_friend_request_window(app)?;
    create_image_preview_window(app)?;
    create_media_viewer_window(app)?;
    create_screenshot_window(app)?;
    Ok(())
}

pub fn hide_auxiliary_windows(app: &AppHandle) -> Result<(), String> {
    for label in [
        SETTINGS_WINDOW_LABEL,
        CARD_SETTINGS_WINDOW_LABEL,
        PERIOD_CARD_SETTINGS_WINDOW_LABEL,
        WIDGET_MENU_WINDOW_LABEL,
        FLOATING_TOOLBAR_WINDOW_LABEL,
        AUTH_WINDOW_LABEL,
        CHAT_HISTORY_WINDOW_LABEL,
        GROUP_ANNOUNCEMENT_WINDOW_LABEL,
        PROFILE_EDIT_WINDOW_LABEL,
        CLASS_ACCOUNT_EDIT_WINDOW_LABEL,
        FRIEND_PROFILE_WINDOW_LABEL,
        PROFILE_SEARCH_WINDOW_LABEL,
        FRIEND_REQUEST_WINDOW_LABEL,
        IMAGE_PREVIEW_WINDOW_LABEL,
        MEDIA_VIEWER_WINDOW_LABEL,
        SCREENSHOT_WINDOW_LABEL,
    ] {
        if let Some(window) = app.get_webview_window(label) {
            if label == SCREENSHOT_WINDOW_LABEL {
                let _ = set_window_capture_excluded(&window, false);
            }
            window.hide().map_err(|error| error.to_string())?;
        }
    }

    Ok(())
}

pub fn ensure_settings_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    show_existing_or_create(app, SETTINGS_WINDOW_LABEL, create_settings_window)
}

pub fn ensure_widget_menu_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    show_existing_or_create(app, WIDGET_MENU_WINDOW_LABEL, create_widget_menu_window)
}

pub fn ensure_card_settings_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    show_existing_or_create(app, CARD_SETTINGS_WINDOW_LABEL, create_card_settings_window)
}

pub fn ensure_period_card_settings_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    show_existing_or_create(
        app,
        PERIOD_CARD_SETTINGS_WINDOW_LABEL,
        create_period_card_settings_window,
    )
}

pub fn ensure_floating_toolbar_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    show_existing_or_create(
        app,
        FLOATING_TOOLBAR_WINDOW_LABEL,
        create_floating_toolbar_window,
    )
}

pub fn ensure_auth_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    show_existing_or_create(app, AUTH_WINDOW_LABEL, create_auth_window)
}

pub fn ensure_chat_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    show_existing_or_create(app, CHAT_WINDOW_LABEL, create_chat_window)
}

pub fn ensure_chat_history_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    show_existing_or_create(
        app,
        CHAT_HISTORY_WINDOW_LABEL,
        create_chat_history_window,
    )
}

pub fn ensure_group_announcement_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    show_existing_or_create(
        app,
        GROUP_ANNOUNCEMENT_WINDOW_LABEL,
        create_group_announcement_window,
    )
}

pub fn ensure_profile_edit_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    show_existing_or_create(
        app,
        PROFILE_EDIT_WINDOW_LABEL,
        create_profile_edit_window,
    )
}

pub fn ensure_class_account_edit_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    show_existing_or_create(
        app,
        CLASS_ACCOUNT_EDIT_WINDOW_LABEL,
        create_class_account_edit_window,
    )
}

pub fn ensure_friend_profile_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    show_existing_or_create(
        app,
        FRIEND_PROFILE_WINDOW_LABEL,
        create_friend_profile_window,
    )
}

pub fn ensure_profile_search_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    show_existing_or_create(
        app,
        PROFILE_SEARCH_WINDOW_LABEL,
        create_profile_search_window,
    )
}

pub fn ensure_friend_request_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    show_existing_or_create(
        app,
        FRIEND_REQUEST_WINDOW_LABEL,
        create_friend_request_window,
    )
}

pub fn ensure_image_preview_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    show_existing_or_create(
        app,
        IMAGE_PREVIEW_WINDOW_LABEL,
        create_image_preview_window,
    )
}

pub fn ensure_media_viewer_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    show_existing_or_create(
        app,
        MEDIA_VIEWER_WINDOW_LABEL,
        create_media_viewer_window,
    )
}

pub fn show_auth_window_if_hidden(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(AUTH_WINDOW_LABEL) {
        if window.is_visible().map_err(|error| error.to_string())? {
            return Ok(());
        }
    }

    ensure_auth_window(app).map(|_| ())
}

fn set_last_group_announcement_open_payload(
    payload: GroupAnnouncementOpenPayload,
) -> Result<(), String> {
    let store = LAST_GROUP_ANNOUNCEMENT_OPEN_PAYLOAD.get_or_init(|| Mutex::new(None));
    let mut guard = store.lock().map_err(|error| error.to_string())?;
    *guard = Some(payload);
    Ok(())
}

fn get_last_group_announcement_open_payload(
) -> Result<Option<GroupAnnouncementOpenPayload>, String> {
    let store = LAST_GROUP_ANNOUNCEMENT_OPEN_PAYLOAD.get_or_init(|| Mutex::new(None));
    let guard = store.lock().map_err(|error| error.to_string())?;
    Ok(guard.clone())
}

fn set_last_screenshot_open_payload(payload: ScreenshotOpenPayload) -> Result<(), String> {
    let store = LAST_SCREENSHOT_OPEN_PAYLOAD.get_or_init(|| Mutex::new(None));
    let mut guard = store.lock().map_err(|error| error.to_string())?;
    *guard = Some(payload);
    Ok(())
}

fn clear_last_screenshot_open_payload() -> Result<(), String> {
    let store = LAST_SCREENSHOT_OPEN_PAYLOAD.get_or_init(|| Mutex::new(None));
    let mut guard = store.lock().map_err(|error| error.to_string())?;
    *guard = None;
    Ok(())
}

fn get_last_screenshot_open_payload() -> Result<Option<ScreenshotOpenPayload>, String> {
    let store = LAST_SCREENSHOT_OPEN_PAYLOAD.get_or_init(|| Mutex::new(None));
    let guard = store.lock().map_err(|error| error.to_string())?;
    Ok(guard.clone())
}

fn set_last_media_viewer_open_payload(payload: MediaViewerOpenPayload) -> Result<(), String> {
    let store = LAST_MEDIA_VIEWER_OPEN_PAYLOAD.get_or_init(|| Mutex::new(None));
    let mut guard = store.lock().map_err(|error| error.to_string())?;
    *guard = Some(payload);
    Ok(())
}

fn get_last_media_viewer_open_payload() -> Result<Option<MediaViewerOpenPayload>, String> {
    let store = LAST_MEDIA_VIEWER_OPEN_PAYLOAD.get_or_init(|| Mutex::new(None));
    let guard = store.lock().map_err(|error| error.to_string())?;
    Ok(guard.clone())
}

fn set_window_capture_excluded<R: Runtime>(
    window: &WebviewWindow<R>,
    excluded: bool,
) -> Result<(), String> {
    let hwnd = HWND(window.hwnd().map_err(|error| error.to_string())?.0);
    let affinity = if excluded {
        WDA_EXCLUDEFROMCAPTURE
    } else {
        WDA_NONE
    };
    unsafe { SetWindowDisplayAffinity(hwnd, affinity).map_err(|error| error.to_string()) }
}

fn show_existing_or_create(
    app: &AppHandle,
    label: &str,
    create: fn(&AppHandle) -> Result<WebviewWindow, String>,
) -> Result<WebviewWindow, String> {
    let window = if let Some(window) = app.get_webview_window(label) {
        window
    } else {
        create(app)?
    };

    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    Ok(window)
}

fn create_settings_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(SETTINGS_WINDOW_LABEL) {
        return Ok(window);
    }

    let window = WebviewWindowBuilder::new(
        app,
        SETTINGS_WINDOW_LABEL,
        WebviewUrl::App("index.html?window=settings#settings".into()),
    )
    .title("设置")
    .devtools(false)
    .decorations(true)
    .transparent(false)
    .resizable(false)
    .minimizable(false)
    .maximizable(false)
    .skip_taskbar(true)
    .visible(false)
    .inner_size(680.0, 560.0)
    .build()
    .map_err(|error| error.to_string())?;

    install_hide_on_close(
        &window,
        app,
        Some(SETTINGS_WINDOW_CLOSE_EVENT),
        Some(SETTINGS_WINDOW_LABEL),
        false,
    );
    Ok(window)
}

fn create_widget_menu_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(WIDGET_MENU_WINDOW_LABEL) {
        return Ok(window);
    }

    let window = WebviewWindowBuilder::new(
        app,
        WIDGET_MENU_WINDOW_LABEL,
        WebviewUrl::App("index.html?window=widget-menu#widget-menu".into()),
    )
    .title("课程表菜单")
    .devtools(false)
    .decorations(false)
    .transparent(false)
    .resizable(false)
    .minimizable(false)
    .maximizable(false)
    .skip_taskbar(true)
    .always_on_top(true)
    .visible(false)
    .inner_size(132.0, 126.0)
    .build()
    .map_err(|error| error.to_string())?;

    install_hide_on_close(
        &window,
        app,
        Some(WIDGET_MENU_CLOSE_EVENT),
        Some(WIDGET_MENU_WINDOW_LABEL),
        true,
    );
    Ok(window)
}

fn create_card_settings_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(CARD_SETTINGS_WINDOW_LABEL) {
        return Ok(window);
    }

    let window = WebviewWindowBuilder::new(
        app,
        CARD_SETTINGS_WINDOW_LABEL,
        WebviewUrl::App("index.html?window=card-settings#card-settings".into()),
    )
    .title("课程卡片设置")
    .devtools(false)
    .decorations(true)
    .transparent(false)
    .resizable(false)
    .minimizable(false)
    .maximizable(false)
    .skip_taskbar(true)
    .visible(false)
    .inner_size(270.0, 380.0)
    .build()
    .map_err(|error| error.to_string())?;

    install_hide_on_close(
        &window,
        app,
        Some(CARD_SETTINGS_WINDOW_CLOSE_EVENT),
        Some(CARD_SETTINGS_WINDOW_LABEL),
        true,
    );
    Ok(window)
}

fn create_period_card_settings_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(PERIOD_CARD_SETTINGS_WINDOW_LABEL) {
        return Ok(window);
    }

    let window = WebviewWindowBuilder::new(
        app,
        PERIOD_CARD_SETTINGS_WINDOW_LABEL,
        WebviewUrl::App("index.html?window=period-card-settings#period-card-settings".into()),
    )
    .title("课次卡片设置")
    .devtools(false)
    .decorations(true)
    .transparent(false)
    .resizable(false)
    .minimizable(false)
    .maximizable(false)
    .skip_taskbar(true)
    .visible(false)
    .inner_size(270.0, 272.0)
    .build()
    .map_err(|error| error.to_string())?;

    install_hide_on_close(
        &window,
        app,
        Some(CARD_SETTINGS_WINDOW_CLOSE_EVENT),
        Some(PERIOD_CARD_SETTINGS_WINDOW_LABEL),
        true,
    );
    Ok(window)
}

fn create_floating_toolbar_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(FLOATING_TOOLBAR_WINDOW_LABEL) {
        return Ok(window);
    }

    let window = WebviewWindowBuilder::new(
        app,
        FLOATING_TOOLBAR_WINDOW_LABEL,
        WebviewUrl::App("index.html?window=floating-toolbar#floating-toolbar".into()),
    )
    .title("浮动工具栏")
    .devtools(false)
    .decorations(false)
    .transparent(true)
    .resizable(false)
    .minimizable(false)
    .maximizable(false)
    .skip_taskbar(true)
    .visible(false)
    .inner_size(320.0, 48.0)
    .build()
    .map_err(|error| error.to_string())?;

    install_hide_on_close(
        &window,
        app,
        Some(FLOATING_TOOLBAR_CLOSE_EVENT),
        Some(FLOATING_TOOLBAR_WINDOW_LABEL),
        false,
    );
    Ok(window)
}

fn create_auth_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(AUTH_WINDOW_LABEL) {
        return Ok(window);
    }

    let window = WebviewWindowBuilder::new(
        app,
        AUTH_WINDOW_LABEL,
        WebviewUrl::App("index.html?window=auth#auth".into()),
    )
    .title("登录")
    .devtools(false)
    .decorations(true)
    .transparent(false)
    .resizable(false)
    .minimizable(false)
    .maximizable(false)
    .skip_taskbar(true)
    .visible(false)
    .inner_size(380.0, 420.0)
    .build()
    .map_err(|error| error.to_string())?;

    let auth_window = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = auth_window.hide();
        }
    });

    Ok(window)
}

fn create_chat_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(CHAT_WINDOW_LABEL) {
        return Ok(window);
    }

    let window = WebviewWindowBuilder::new(
        app,
        CHAT_WINDOW_LABEL,
        WebviewUrl::App("index.html?window=chat#chat".into()),
    )
    .title("教师助手")
    .devtools(false)
    .decorations(false)
    .transparent(false)
    .resizable(true)
    .minimizable(true)
    .maximizable(true)
    .skip_taskbar(false)
    .visible(false)
    .inner_size(960.0, 700.0)
    .min_inner_size(760.0, 540.0)
    .build()
    .map_err(|error| error.to_string())?;

    let chat_window = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = chat_window.hide();
        }
    });

    Ok(window)
}

fn create_chat_history_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(CHAT_HISTORY_WINDOW_LABEL) {
        return Ok(window);
    }

    let window = WebviewWindowBuilder::new(
        app,
        CHAT_HISTORY_WINDOW_LABEL,
        WebviewUrl::App("index.html?window=chat-history#chat-history".into()),
    )
    .title("聊天记录")
    .devtools(false)
    .decorations(false)
    .transparent(false)
    .resizable(true)
    .minimizable(true)
    .maximizable(false)
    .skip_taskbar(false)
    .visible(false)
    .inner_size(560.0, 640.0)
    .min_inner_size(460.0, 520.0)
    .build()
    .map_err(|error| error.to_string())?;

    let history_window = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = history_window.hide();
        }
    });

    Ok(window)
}

fn create_group_announcement_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(GROUP_ANNOUNCEMENT_WINDOW_LABEL) {
        return Ok(window);
    }

    let window = WebviewWindowBuilder::new(
        app,
        GROUP_ANNOUNCEMENT_WINDOW_LABEL,
        WebviewUrl::App("index.html?window=group-announcements#group-announcements".into()),
    )
    .title("群公告")
    .devtools(false)
    .decorations(true)
    .transparent(false)
    .resizable(true)
    .minimizable(true)
    .maximizable(true)
    .skip_taskbar(false)
    .visible(false)
    .inner_size(620.0, 640.0)
    .min_inner_size(500.0, 460.0)
    .build()
    .map_err(|error| error.to_string())?;

    let announcement_window = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = announcement_window.hide();
        }
    });

    Ok(window)
}

fn create_profile_edit_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(PROFILE_EDIT_WINDOW_LABEL) {
        return Ok(window);
    }

    let window = WebviewWindowBuilder::new(
        app,
        PROFILE_EDIT_WINDOW_LABEL,
        WebviewUrl::App("index.html?window=profile-edit#profile-edit".into()),
    )
    .title("个人资料")
    .devtools(false)
    .decorations(true)
    .transparent(false)
    .resizable(false)
    .minimizable(false)
    .maximizable(false)
    .skip_taskbar(false)
    .visible(false)
    .inner_size(420.0, 560.0)
    .build()
    .map_err(|error| error.to_string())?;

    let profile_window = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = profile_window.hide();
        }
    });

    Ok(window)
}

fn create_class_account_edit_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(CLASS_ACCOUNT_EDIT_WINDOW_LABEL) {
        return Ok(window);
    }

    let window = WebviewWindowBuilder::new(
        app,
        CLASS_ACCOUNT_EDIT_WINDOW_LABEL,
        WebviewUrl::App("index.html?window=class-account-edit#class-account-edit".into()),
    )
    .title("班级资料")
    .devtools(false)
    .decorations(true)
    .transparent(false)
    .resizable(false)
    .minimizable(false)
    .maximizable(false)
    .skip_taskbar(false)
    .visible(false)
    .inner_size(420.0, 590.0)
    .build()
    .map_err(|error| error.to_string())?;

    let class_window = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = class_window.hide();
        }
    });

    Ok(window)
}

fn create_friend_profile_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(FRIEND_PROFILE_WINDOW_LABEL) {
        return Ok(window);
    }

    let window = WebviewWindowBuilder::new(
        app,
        FRIEND_PROFILE_WINDOW_LABEL,
        WebviewUrl::App("index.html?window=friend-profile#friend-profile".into()),
    )
    .title("好友资料")
    .devtools(false)
    .decorations(true)
    .transparent(false)
    .resizable(false)
    .minimizable(false)
    .maximizable(false)
    .skip_taskbar(false)
    .visible(false)
    .inner_size(420.0, 520.0)
    .build()
    .map_err(|error| error.to_string())?;

    let profile_window = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = profile_window.hide();
        }
    });

    Ok(window)
}

fn create_profile_search_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(PROFILE_SEARCH_WINDOW_LABEL) {
        return Ok(window);
    }

    let window = WebviewWindowBuilder::new(
        app,
        PROFILE_SEARCH_WINDOW_LABEL,
        WebviewUrl::App("index.html?window=profile-search#profile-search".into()),
    )
    .title("添加好友/群")
    .devtools(false)
    .decorations(true)
    .transparent(false)
    .resizable(false)
    .minimizable(false)
    .maximizable(false)
    .skip_taskbar(false)
    .visible(false)
    .inner_size(720.0, 560.0)
    .build()
    .map_err(|error| error.to_string())?;

    let profile_window = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = profile_window.hide();
        }
    });

    Ok(window)
}

fn create_friend_request_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(FRIEND_REQUEST_WINDOW_LABEL) {
        return Ok(window);
    }

    let window = WebviewWindowBuilder::new(
        app,
        FRIEND_REQUEST_WINDOW_LABEL,
        WebviewUrl::App("index.html?window=friend-request#friend-request".into()),
    )
    .title("添加好友")
    .devtools(false)
    .decorations(true)
    .transparent(false)
    .resizable(false)
    .minimizable(false)
    .maximizable(false)
    .skip_taskbar(false)
    .visible(false)
    .inner_size(420.0, 420.0)
    .build()
    .map_err(|error| error.to_string())?;

    let request_window = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = request_window.hide();
        }
    });

    Ok(window)
}

fn create_image_preview_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(IMAGE_PREVIEW_WINDOW_LABEL) {
        return Ok(window);
    }

    let window = WebviewWindowBuilder::new(
        app,
        IMAGE_PREVIEW_WINDOW_LABEL,
        WebviewUrl::App("index.html?window=image-preview#image-preview".into()),
    )
    .title("图片预览")
    .devtools(false)
    .decorations(false)
    .transparent(false)
    .resizable(true)
    .minimizable(true)
    .maximizable(true)
    .skip_taskbar(false)
    .visible(false)
    .inner_size(920.0, 680.0)
    .min_inner_size(640.0, 420.0)
    .build()
    .map_err(|error| error.to_string())?;

    let preview_window = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = preview_window.hide();
        }
    });

    Ok(window)
}

fn create_media_viewer_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(MEDIA_VIEWER_WINDOW_LABEL) {
        return Ok(window);
    }

    let window = WebviewWindowBuilder::new(
        app,
        MEDIA_VIEWER_WINDOW_LABEL,
        WebviewUrl::App("index.html?window=media-viewer#media-viewer".into()),
    )
    .title("媒体浏览")
    .devtools(false)
    .decorations(false)
    .transparent(false)
    .resizable(true)
    .minimizable(true)
    .maximizable(true)
    .skip_taskbar(false)
    .visible(false)
    .inner_size(1040.0, 720.0)
    .min_inner_size(720.0, 480.0)
    .build()
    .map_err(|error| error.to_string())?;

    let viewer_window = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = viewer_window.hide();
        }
    });

    Ok(window)
}

fn create_screenshot_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(SCREENSHOT_WINDOW_LABEL) {
        return Ok(window);
    }

    let window = WebviewWindowBuilder::new(
        app,
        SCREENSHOT_WINDOW_LABEL,
        WebviewUrl::App("index.html?window=screenshot#screenshot".into()),
    )
    .title("截图")
    .devtools(false)
    .decorations(false)
    .transparent(false)
    .resizable(false)
    .minimizable(false)
    .maximizable(false)
    .skip_taskbar(true)
    .always_on_top(true)
    .visible(false)
    .inner_size(1280.0, 720.0)
    .build()
    .map_err(|error| error.to_string())?;

    let screenshot_window = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = set_window_capture_excluded(&screenshot_window, false);
            let _ = screenshot_window.hide();
        }
    });

    Ok(window)
}

fn install_hide_on_close(
    window: &WebviewWindow,
    app: &AppHandle,
    close_event: Option<&'static str>,
    payload_window_label: Option<&'static str>,
    release_proxy: bool,
) {
    let app = app.clone();
    let close_window = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            if release_proxy {
                if let Some(proxy) = app.get_webview_window(INTERACTION_PROXY_WINDOW_LABEL) {
                    let _ = proxy.set_ignore_cursor_events(true);
                }
            }

            if let Some(close_event) = close_event {
                if let Some(window_label) = payload_window_label {
                    let _ = app.emit_to(
                        WIDGET_WINDOW_LABEL,
                        close_event,
                        WindowClosePayload { window_label },
                    );
                } else {
                    let _ = app.emit_to(WIDGET_WINDOW_LABEL, close_event, ());
                }
            }

            let _ = close_window.hide();
        }
    });
}
