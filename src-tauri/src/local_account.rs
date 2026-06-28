use std::{
    collections::{HashMap, HashSet},
    fs,
    io::Read,
    os::windows::ffi::OsStrExt,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering as AtomicOrdering},
        Mutex, OnceLock,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use rand::{distributions::Alphanumeric, Rng};
use reqwest::blocking::{Client, Response};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager};
use windows::{
    core::PCWSTR,
    Win32::{Foundation::HWND, UI::Shell::ShellExecuteW},
};

const DEFAULT_USER_ID: &str = "default_local";
const CLOUD_API_BASE_URL: &str = "https://api.shiyuetech.com";
const DEFAULT_TERM_START: &str = "2026-03-05";
const DEFAULT_TERM_END: &str = "2026-06-30";
const SYNC_SERVER_CHANGE_EVENT: &str = "sync-server-change";
const CHAT_MESSAGE_NEW_EVENT: &str = "chat-message-new";
const CHAT_MESSAGE_REVOKED_EVENT: &str = "chat-message-revoked";
const CHAT_MESSAGE_DELETED_EVENT: &str = "chat-message-deleted";
const PROFILE_UPDATED_EVENT: &str = "profile-updated";
const FRIEND_REQUEST_EVENT: &str = "friend-request-event";
const CHAT_GROUP_EVENT: &str = "chat-group-event";
const CHAT_TRANSFER_EVENT: &str = "chat-transfer-event";
static REALTIME_SYNC_GENERATION: AtomicU64 = AtomicU64::new(0);
static CHAT_REALTIME_GENERATION: AtomicU64 = AtomicU64::new(0);
static CHAT_UPLOAD_CONTROLS: OnceLock<Mutex<HashMap<String, TransferControlState>>> =
    OnceLock::new();
const WEEKDAYS: [&str; 7] = [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
];

#[derive(Clone, Debug)]
struct TransferControlState {
    paused: bool,
    canceled: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PickedLocalFile {
    path: String,
    name: String,
    size_bytes: u64,
    content_type: String,
    file_type: String,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
}

#[derive(Debug, Deserialize)]
struct SyncStatusResponse {
    #[serde(alias = "userId")]
    user_id: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncResponse {
    #[serde(alias = "latestServerSeq")]
    latest_server_seq: u32,
    #[serde(alias = "acceptedBatchIds")]
    accepted_batch_ids: Vec<String>,
    server_changes: Vec<ServerChange>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChangesResponse {
    #[serde(alias = "latestServerSeq")]
    latest_server_seq: u32,
    #[serde(default, alias = "serverChanges")]
    server_changes: Vec<ServerChange>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SnapshotResponse {
    #[serde(alias = "latestServerSeq")]
    latest_server_seq: u32,
    snapshot: ServerChange,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
struct ServerChange {
    #[serde(alias = "serverSeq")]
    server_seq: u32,
    #[serde(alias = "batchId")]
    batch_id: String,
    #[serde(alias = "originClientId")]
    origin_client_id: String,
    #[serde(default, alias = "entityDiffs")]
    entity_diffs: Vec<Value>,
    #[serde(default)]
    source_action: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicUser {
    pub id: String,
    pub phone: Option<String>,
    pub is_default: bool,
    pub cloud_user_id: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAccountState {
    pub owner_user_id: String,
    pub logged_in: bool,
    pub user: Option<PublicUser>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredSchedulePayload {
    pub owner_user_id: String,
    pub schedule: Option<Value>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSyncStatus {
    pub owner_user_id: String,
    pub dirty_count: u32,
    pub local_revision: u32,
    pub cloud_revision: Option<u32>,
    pub last_synced_cloud_revision: Option<u32>,
    pub last_synced_at: Option<String>,
    pub last_checked_at: Option<String>,
    pub last_sync_error: Option<String>,
    pub has_pending_changes: bool,
    pub has_remote_changes: bool,
    pub syncing: bool,
    pub online: bool,
    pub conflict: bool,
}

#[tauri::command]
pub fn load_local_account_state(app: AppHandle) -> Result<LocalAccountState, String> {
    let conn = open_db(&app)?;
    ensure_default_user(&conn)?;
    load_account_state_from_conn(&conn)
}

#[tauri::command]
pub fn load_current_schedule(app: AppHandle) -> Result<StoredSchedulePayload, String> {
    let conn = open_db(&app)?;
    ensure_default_user(&conn)?;
    let owner_user_id = active_user_id(&conn)?;
    let schedule = load_schedule_from_entities(&conn, &owner_user_id)?;

    Ok(StoredSchedulePayload {
        owner_user_id,
        schedule,
    })
}

#[tauri::command]
pub fn save_current_schedule(
    app: AppHandle,
    schedule: Value,
    source_action: Option<String>,
) -> Result<(), String> {
    let conn = open_db(&app)?;
    ensure_default_user(&conn)?;
    let owner_user_id = active_user_id(&conn)?;
    save_schedule_for_user(
        &conn,
        &owner_user_id,
        &schedule,
        source_action.as_deref().unwrap_or("desktop.schedule.save"),
    )?;
    if owner_user_id != DEFAULT_USER_ID && pending_ops_count(&conn, &owner_user_id)? > 0 {
        if let Ok(token) = session_token(&conn, &owner_user_id) {
            let _ = sync_current_user_with_cloud(&conn, &owner_user_id, &token);
        }
    }
    Ok(())
}

#[tauri::command]
pub fn load_local_sync_status(app: AppHandle) -> Result<LocalSyncStatus, String> {
    let conn = open_db(&app)?;
    ensure_default_user(&conn)?;
    let owner_user_id = active_user_id(&conn)?;
    load_sync_status_for_user(&conn, &owner_user_id)
}

#[tauri::command]
pub fn manual_sync_current_user(app: AppHandle) -> Result<LocalSyncStatus, String> {
    let conn = open_db(&app)?;
    ensure_default_user(&conn)?;
    let owner_user_id = active_user_id(&conn)?;
    if owner_user_id == DEFAULT_USER_ID {
        return Err("sign in before syncing".to_string());
    }

    let token = session_token(&conn, &owner_user_id)?;
    sync_current_user_with_cloud(&conn, &owner_user_id, &token)?;
    let now = now_string();
    upsert_sync_meta_synced(
        &conn,
        &owner_user_id,
        &now,
        load_sync_meta_revision(&conn, &owner_user_id, "last_synced_cloud_revision")?.unwrap_or(0),
    )?;

    load_sync_status_for_user(&conn, &owner_user_id)
}

#[tauri::command]
pub fn start_realtime_sync(app: AppHandle) -> Result<(), String> {
    let generation = REALTIME_SYNC_GENERATION.fetch_add(1, AtomicOrdering::SeqCst) + 1;
    let conn = open_db(&app)?;
    ensure_default_user(&conn)?;
    let owner_user_id = active_user_id(&conn)?;
    if owner_user_id == DEFAULT_USER_ID {
        return Ok(());
    }
    let token = session_token(&conn, &owner_user_id)?;
    let device_id = sync_client_id(&conn)?;
    drop(conn);
    tauri::async_runtime::spawn(async move {
        run_realtime_sync_loop(app, owner_user_id, token, device_id, generation).await;
    });
    Ok(())
}

#[tauri::command]
pub fn stop_realtime_sync() -> Result<(), String> {
    REALTIME_SYNC_GENERATION.fetch_add(1, AtomicOrdering::SeqCst);
    Ok(())
}

#[tauri::command]
pub fn start_chat_realtime(app: AppHandle) -> Result<(), String> {
    let generation = CHAT_REALTIME_GENERATION.fetch_add(1, AtomicOrdering::SeqCst) + 1;
    let conn = open_db(&app)?;
    ensure_default_user(&conn)?;
    let owner_user_id = active_user_id(&conn)?;
    if owner_user_id == DEFAULT_USER_ID {
        return Ok(());
    }
    let token = session_token(&conn, &owner_user_id)?;
    let device_id = sync_client_id(&conn)?;
    drop(conn);
    tauri::async_runtime::spawn(async move {
        run_chat_realtime_loop(app, token, device_id, generation).await;
    });
    Ok(())
}

#[tauri::command]
pub fn stop_chat_realtime() -> Result<(), String> {
    CHAT_REALTIME_GENERATION.fetch_add(1, AtomicOrdering::SeqCst);
    Ok(())
}

#[tauri::command]
pub fn list_chat_conversations(app: AppHandle) -> Result<Value, String> {
    let conn = open_db(&app)?;
    ensure_default_user(&conn)?;
    let owner_user_id = active_user_id(&conn)?;
    let token = session_token(&conn, &owner_user_id)?;
    cloud_get_json("/chat/conversations", &token)
}

#[tauri::command]
pub fn get_rtc_token(app: AppHandle, channel_id: String) -> Result<Value, String> {
    let conn = open_db(&app)?;
    ensure_default_user(&conn)?;
    let owner_user_id = active_user_id(&conn)?;
    let token = session_token(&conn, &owner_user_id)?;
    cloud_get_json(
        &format!("/rtc/token?channelId={}", urlencoding::encode(&channel_id)),
        &token,
    )
}

#[tauri::command]
pub fn list_chat_messages(
    app: AppHandle,
    conversation_id: String,
    after_seq: Option<u32>,
    before_seq: Option<u32>,
    limit: Option<u32>,
) -> Result<Value, String> {
    let conn = open_db(&app)?;
    ensure_default_user(&conn)?;
    let owner_user_id = active_user_id(&conn)?;
    let token = session_token(&conn, &owner_user_id)?;
    cloud_get_json(
        &format!(
            "/chat/conversations/{}/messages?afterSeq={}&beforeSeq={}&limit={}",
            urlencoding::encode(&conversation_id),
            after_seq.unwrap_or(0),
            before_seq.unwrap_or(0),
            limit.unwrap_or(50).clamp(1, 100)
        ),
        &token,
    )
}

#[tauri::command]
pub fn search_chat_history_messages(
    app: AppHandle,
    conversation_id: String,
    history_type: Option<String>,
    query: Option<String>,
    after_seq: Option<u32>,
    before_seq: Option<u32>,
    around_seq: Option<u32>,
    limit: Option<u32>,
    date_from: Option<String>,
    date_to: Option<String>,
) -> Result<Value, String> {
    let conn = open_db(&app)?;
    ensure_default_user(&conn)?;
    let owner_user_id = active_user_id(&conn)?;
    let token = session_token(&conn, &owner_user_id)?;
    let mut path = format!(
        "/chat/conversations/{}/history?type={}&query={}&afterSeq={}&beforeSeq={}&aroundSeq={}&limit={}",
        urlencoding::encode(&conversation_id),
        urlencoding::encode(history_type.as_deref().unwrap_or("all")),
        urlencoding::encode(query.as_deref().unwrap_or("")),
        after_seq.unwrap_or(0),
        before_seq.unwrap_or(0),
        around_seq.unwrap_or(0),
        limit.unwrap_or(80).clamp(1, 200)
    );
    if let Some(value) = date_from
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        path.push_str("&dateFrom=");
        path.push_str(&urlencoding::encode(value));
    }
    if let Some(value) = date_to.as_deref().filter(|value| !value.trim().is_empty()) {
        path.push_str("&dateTo=");
        path.push_str(&urlencoding::encode(value));
    }
    cloud_get_json(&path, &token)
}

#[tauri::command]
pub fn send_chat_message(
    app: AppHandle,
    conversation_id: String,
    client_msg_id: String,
    message_type: Option<String>,
    content: String,
    content_json: Option<Value>,
    quote_meta: Option<Value>,
    file_object_id: Option<String>,
) -> Result<Value, String> {
    let conn = open_db(&app)?;
    ensure_default_user(&conn)?;
    let owner_user_id = active_user_id(&conn)?;
    let token = session_token(&conn, &owner_user_id)?;
    let device_id = sync_client_id(&conn)?;
    cloud_post_json(
        &format!(
            "/chat/messages?clientId={}",
            urlencoding::encode(&device_id)
        ),
        &token,
        json!({
            "conversationId": conversation_id,
            "clientMsgId": client_msg_id,
            "messageType": message_type.unwrap_or_else(|| "text".to_string()),
            "content": content,
            "contentJson": content_json,
            "quoteMeta": quote_meta,
            "fileObjectId": file_object_id,
        }),
    )
}

#[tauri::command]
pub fn revoke_chat_message(app: AppHandle, message_id: String) -> Result<Value, String> {
    let conn = open_db(&app)?;
    ensure_default_user(&conn)?;
    let owner_user_id = active_user_id(&conn)?;
    let token = session_token(&conn, &owner_user_id)?;
    let device_id = sync_client_id(&conn)?;
    cloud_post_json(
        &format!(
            "/chat/messages/{}/revoke?clientId={}",
            urlencoding::encode(&message_id),
            urlencoding::encode(&device_id)
        ),
        &token,
        json!({}),
    )
}

#[tauri::command]
pub fn delete_chat_message_for_me(app: AppHandle, message_id: String) -> Result<Value, String> {
    let conn = open_db(&app)?;
    ensure_default_user(&conn)?;
    let owner_user_id = active_user_id(&conn)?;
    let token = session_token(&conn, &owner_user_id)?;
    let device_id = sync_client_id(&conn)?;
    let response = cloud_delete_json(
        &format!(
            "/chat/messages/{}?clientId={}",
            urlencoding::encode(&message_id),
            urlencoding::encode(&device_id)
        ),
        &token,
    )?;
    emit_chat_deleted_payload(&app, response.clone());
    Ok(response)
}

#[tauri::command]
pub fn create_direct_chat_conversation(app: AppHandle, peer_user_id: i64) -> Result<Value, String> {
    let conn = open_db(&app)?;
    ensure_default_user(&conn)?;
    let owner_user_id = active_user_id(&conn)?;
    let token = session_token(&conn, &owner_user_id)?;
    cloud_post_json(
        "/chat/conversations/direct",
        &token,
        json!({
            "peerUserId": peer_user_id,
        }),
    )
}

#[tauri::command]
pub fn create_chat_group(
    app: AppHandle,
    name: Option<String>,
    member_user_ids: Vec<i64>,
    group_type: Option<String>,
) -> Result<Value, String> {
    let conn = open_db(&app)?;
    ensure_default_user(&conn)?;
    let owner_user_id = active_user_id(&conn)?;
    let token = session_token(&conn, &owner_user_id)?;
    cloud_post_json(
        "/chat/groups",
        &token,
        json!({
            "name": name,
            "memberUserIds": member_user_ids,
            "groupType": group_type.unwrap_or_else(|| "normal".to_string()),
        }),
    )
}

#[tauri::command]
pub fn apply_class_account(
    app: AppHandle,
    nickname: String,
    avatar_url: Option<String>,
    avatar_object_key: Option<String>,
    bio: Option<String>,
    linked_phone: String,
) -> Result<Value, String> {
    let conn = open_db(&app)?;
    ensure_default_user(&conn)?;
    let owner_user_id = active_user_id(&conn)?;
    let token = session_token(&conn, &owner_user_id)?;
    cloud_post_json(
        "/class-accounts",
        &token,
        json!({
            "nickname": nickname,
            "avatarUrl": avatar_url,
            "avatarObjectKey": avatar_object_key,
            "bio": bio,
            "linkedPhone": linked_phone,
        }),
    )
}

#[tauri::command]
pub fn load_chat_group(app: AppHandle, group_id: String) -> Result<Value, String> {
    let conn = open_db(&app)?;
    ensure_default_user(&conn)?;
    let owner_user_id = active_user_id(&conn)?;
    let token = session_token(&conn, &owner_user_id)?;
    cloud_get_json(
        &format!("/chat/groups/{}", urlencoding::encode(&group_id)),
        &token,
    )
}

#[tauri::command]
pub fn update_chat_group(
    app: AppHandle,
    group_id: String,
    name: Option<String>,
    avatar_url: Option<String>,
    avatar_object_key: Option<String>,
    description: Option<String>,
    announcement: Option<String>,
) -> Result<Value, String> {
    let conn = open_db(&app)?;
    ensure_default_user(&conn)?;
    let owner_user_id = active_user_id(&conn)?;
    let token = session_token(&conn, &owner_user_id)?;
    cloud_put_json(
        &format!("/chat/groups/{}", urlencoding::encode(&group_id)),
        &token,
        json!({
            "name": name,
            "avatarUrl": avatar_url,
            "avatarObjectKey": avatar_object_key,
            "description": description,
            "announcement": announcement,
        }),
    )
}

#[tauri::command]
pub fn list_chat_group_announcements(app: AppHandle, group_id: String) -> Result<Value, String> {
    let conn = open_db(&app)?;
    ensure_default_user(&conn)?;
    let owner_user_id = active_user_id(&conn)?;
    let token = session_token(&conn, &owner_user_id)?;
    cloud_get_json(
        &format!(
            "/chat/groups/{}/announcements",
            urlencoding::encode(&group_id)
        ),
        &token,
    )
}

#[tauri::command]
pub fn create_chat_group_announcement(
    app: AppHandle,
    group_id: String,
    content: String,
) -> Result<Value, String> {
    let conn = open_db(&app)?;
    ensure_default_user(&conn)?;
    let owner_user_id = active_user_id(&conn)?;
    let token = session_token(&conn, &owner_user_id)?;
    cloud_post_json(
        &format!(
            "/chat/groups/{}/announcements",
            urlencoding::encode(&group_id)
        ),
        &token,
        json!({ "content": content }),
    )
}

#[tauri::command]
pub fn update_chat_group_announcement(
    app: AppHandle,
    group_id: String,
    announcement_id: i64,
    content: String,
) -> Result<Value, String> {
    let conn = open_db(&app)?;
    ensure_default_user(&conn)?;
    let owner_user_id = active_user_id(&conn)?;
    let token = session_token(&conn, &owner_user_id)?;
    cloud_put_json(
        &format!(
            "/chat/groups/{}/announcements/{}",
            urlencoding::encode(&group_id),
            announcement_id
        ),
        &token,
        json!({ "content": content }),
    )
}

#[tauri::command]
pub fn delete_chat_group_announcement(
    app: AppHandle,
    group_id: String,
    announcement_id: i64,
) -> Result<Value, String> {
    let conn = open_db(&app)?;
    ensure_default_user(&conn)?;
    let owner_user_id = active_user_id(&conn)?;
    let token = session_token(&conn, &owner_user_id)?;
    cloud_delete_json(
        &format!(
            "/chat/groups/{}/announcements/{}",
            urlencoding::encode(&group_id),
            announcement_id
        ),
        &token,
    )
}

#[tauri::command]
pub fn list_chat_group_members(app: AppHandle, group_id: String) -> Result<Value, String> {
    let conn = open_db(&app)?;
    ensure_default_user(&conn)?;
    let owner_user_id = active_user_id(&conn)?;
    let token = session_token(&conn, &owner_user_id)?;
    cloud_get_json(
        &format!("/chat/groups/{}/members", urlencoding::encode(&group_id)),
        &token,
    )
}

#[tauri::command]
pub fn update_my_chat_group_member(
    app: AppHandle,
    group_id: String,
    group_nickname: Option<String>,
) -> Result<Value, String> {
    let conn = open_db(&app)?;
    ensure_default_user(&conn)?;
    let owner_user_id = active_user_id(&conn)?;
    let token = session_token(&conn, &owner_user_id)?;
    cloud_patch_json(
        &format!("/chat/groups/{}/members/me", urlencoding::encode(&group_id)),
        &token,
        json!({
            "groupNickname": group_nickname,
        }),
    )
}

#[tauri::command]
pub fn invite_chat_group_members(
    app: AppHandle,
    group_id: String,
    member_user_ids: Vec<i64>,
    message: Option<String>,
) -> Result<Value, String> {
    let conn = open_db(&app)?;
    ensure_default_user(&conn)?;
    let owner_user_id = active_user_id(&conn)?;
    let token = session_token(&conn, &owner_user_id)?;
    cloud_post_json(
        &format!(
            "/chat/groups/{}/members/invite",
            urlencoding::encode(&group_id)
        ),
        &token,
        json!({
            "memberUserIds": member_user_ids,
            "message": message,
        }),
    )
}

#[tauri::command]
pub fn list_chat_group_notifications(app: AppHandle) -> Result<Value, String> {
    let conn = open_db(&app)?;
    ensure_default_user(&conn)?;
    let owner_user_id = active_user_id(&conn)?;
    let token = session_token(&conn, &owner_user_id)?;
    cloud_get_json("/chat/groups/notifications", &token)
}

#[tauri::command]
pub fn accept_chat_group_join_request(app: AppHandle, request_id: i64) -> Result<Value, String> {
    let conn = open_db(&app)?;
    ensure_default_user(&conn)?;
    let owner_user_id = active_user_id(&conn)?;
    let token = session_token(&conn, &owner_user_id)?;
    cloud_post_json(
        &format!("/chat/groups/join-requests/{request_id}/accept"),
        &token,
        json!({}),
    )
}

#[tauri::command]
pub fn reject_chat_group_join_request(app: AppHandle, request_id: i64) -> Result<Value, String> {
    let conn = open_db(&app)?;
    ensure_default_user(&conn)?;
    let owner_user_id = active_user_id(&conn)?;
    let token = session_token(&conn, &owner_user_id)?;
    cloud_post_json(
        &format!("/chat/groups/join-requests/{request_id}/reject"),
        &token,
        json!({}),
    )
}

#[tauri::command]
pub fn send_chat_group_join_request(
    app: AppHandle,
    group_id: String,
    message: Option<String>,
) -> Result<Value, String> {
    let conn = open_db(&app)?;
    ensure_default_user(&conn)?;
    let owner_user_id = active_user_id(&conn)?;
    let token = session_token(&conn, &owner_user_id)?;
    cloud_post_json(
        &format!(
            "/chat/groups/{}/join-requests",
            urlencoding::encode(&group_id)
        ),
        &token,
        json!({
            "message": message,
        }),
    )
}

#[tauri::command]
pub fn create_chat_group_invite(
    app: AppHandle,
    group_id: String,
    scene: Option<String>,
    expire_type: Option<String>,
) -> Result<Value, String> {
    let conn = open_db(&app)?;
    ensure_default_user(&conn)?;
    let owner_user_id = active_user_id(&conn)?;
    let token = session_token(&conn, &owner_user_id)?;
    cloud_post_json(
        &format!("/chat/groups/{}/invites", urlencoding::encode(&group_id)),
        &token,
        json!({
            "scene": scene.unwrap_or_else(|| "qr_modal".to_string()),
            "expireType": expire_type.unwrap_or_else(|| "default".to_string()),
        }),
    )
}

#[tauri::command]
pub fn get_chat_group_invite(app: AppHandle, invite_token: String) -> Result<Value, String> {
    let conn = open_db(&app)?;
    ensure_default_user(&conn)?;
    let owner_user_id = active_user_id(&conn)?;
    let token = session_token(&conn, &owner_user_id)?;
    cloud_get_json(
        &format!("/chat/group-invites/{}", urlencoding::encode(&invite_token)),
        &token,
    )
}

#[tauri::command]
pub fn apply_chat_group_invite(
    app: AppHandle,
    invite_token: String,
    reason: Option<String>,
) -> Result<Value, String> {
    let conn = open_db(&app)?;
    ensure_default_user(&conn)?;
    let owner_user_id = active_user_id(&conn)?;
    let token = session_token(&conn, &owner_user_id)?;
    cloud_post_json(
        &format!(
            "/chat/group-invites/{}/apply",
            urlencoding::encode(&invite_token)
        ),
        &token,
        json!({
            "reason": reason,
        }),
    )
}

#[tauri::command]
pub fn set_chat_group_admin(
    app: AppHandle,
    group_id: String,
    user_id: i64,
) -> Result<Value, String> {
    let conn = open_db(&app)?;
    ensure_default_user(&conn)?;
    let owner_user_id = active_user_id(&conn)?;
    let token = session_token(&conn, &owner_user_id)?;
    cloud_post_json(
        &format!(
            "/chat/groups/{}/admins/{}",
            urlencoding::encode(&group_id),
            user_id
        ),
        &token,
        json!({}),
    )
}

#[tauri::command]
pub fn unset_chat_group_admin(
    app: AppHandle,
    group_id: String,
    user_id: i64,
) -> Result<Value, String> {
    let conn = open_db(&app)?;
    ensure_default_user(&conn)?;
    let owner_user_id = active_user_id(&conn)?;
    let token = session_token(&conn, &owner_user_id)?;
    cloud_delete_json(
        &format!(
            "/chat/groups/{}/admins/{}",
            urlencoding::encode(&group_id),
            user_id
        ),
        &token,
    )
}

#[tauri::command]
pub fn transfer_chat_group_owner(
    app: AppHandle,
    group_id: String,
    user_id: i64,
) -> Result<Value, String> {
    let conn = open_db(&app)?;
    ensure_default_user(&conn)?;
    let owner_user_id = active_user_id(&conn)?;
    let token = session_token(&conn, &owner_user_id)?;
    cloud_post_json(
        &format!(
            "/chat/groups/{}/transfer-owner",
            urlencoding::encode(&group_id)
        ),
        &token,
        json!({
            "userId": user_id,
        }),
    )
}

#[tauri::command]
pub fn remove_chat_group_member(
    app: AppHandle,
    group_id: String,
    user_id: i64,
) -> Result<Value, String> {
    let conn = open_db(&app)?;
    ensure_default_user(&conn)?;
    let owner_user_id = active_user_id(&conn)?;
    let token = session_token(&conn, &owner_user_id)?;
    cloud_delete_json(
        &format!(
            "/chat/groups/{}/members/{}",
            urlencoding::encode(&group_id),
            user_id
        ),
        &token,
    )
}

#[tauri::command]
pub fn leave_chat_group(app: AppHandle, group_id: String) -> Result<Value, String> {
    let conn = open_db(&app)?;
    ensure_default_user(&conn)?;
    let owner_user_id = active_user_id(&conn)?;
    let token = session_token(&conn, &owner_user_id)?;
    cloud_post_json(
        &format!("/chat/groups/{}/leave", urlencoding::encode(&group_id)),
        &token,
        json!({}),
    )
}

#[tauri::command]
pub fn dissolve_chat_group(app: AppHandle, group_id: String) -> Result<Value, String> {
    let conn = open_db(&app)?;
    ensure_default_user(&conn)?;
    let owner_user_id = active_user_id(&conn)?;
    let token = session_token(&conn, &owner_user_id)?;
    cloud_post_json(
        &format!("/chat/groups/{}/dissolve", urlencoding::encode(&group_id)),
        &token,
        json!({}),
    )
}

#[tauri::command]
pub fn mark_chat_conversation_read(
    app: AppHandle,
    conversation_id: String,
    conversation_seq: u32,
) -> Result<Value, String> {
    let conn = open_db(&app)?;
    ensure_default_user(&conn)?;
    let owner_user_id = active_user_id(&conn)?;
    let token = session_token(&conn, &owner_user_id)?;
    cloud_post_json(
        &format!(
            "/chat/conversations/{}/read",
            urlencoding::encode(&conversation_id)
        ),
        &token,
        json!({
            "conversationSeq": conversation_seq,
        }),
    )
}

#[tauri::command]
pub fn set_chat_conversation_pinned(
    app: AppHandle,
    conversation_id: String,
    pinned: bool,
) -> Result<Value, String> {
    let conn = open_db(&app)?;
    ensure_default_user(&conn)?;
    let owner_user_id = active_user_id(&conn)?;
    let token = session_token(&conn, &owner_user_id)?;
    let action = if pinned { "pin" } else { "unpin" };
    cloud_post_json(
        &format!(
            "/chat/conversations/{}/{}",
            urlencoding::encode(&conversation_id),
            action
        ),
        &token,
        json!({}),
    )
}

#[tauri::command]
pub fn set_chat_conversation_muted(
    app: AppHandle,
    conversation_id: String,
    muted: bool,
) -> Result<Value, String> {
    let conn = open_db(&app)?;
    ensure_default_user(&conn)?;
    let owner_user_id = active_user_id(&conn)?;
    let token = session_token(&conn, &owner_user_id)?;
    let action = if muted { "mute" } else { "unmute" };
    cloud_post_json(
        &format!(
            "/chat/conversations/{}/{}",
            urlencoding::encode(&conversation_id),
            action
        ),
        &token,
        json!({}),
    )
}

#[tauri::command]
pub fn clear_chat_conversation_history(
    app: AppHandle,
    conversation_id: String,
) -> Result<Value, String> {
    let conn = open_db(&app)?;
    ensure_default_user(&conn)?;
    let owner_user_id = active_user_id(&conn)?;
    let token = session_token(&conn, &owner_user_id)?;
    cloud_post_json(
        &format!(
            "/chat/conversations/{}/clear-history",
            urlencoding::encode(&conversation_id)
        ),
        &token,
        json!({}),
    )
}

#[tauri::command]
pub fn archive_chat_conversation(app: AppHandle, conversation_id: String) -> Result<Value, String> {
    let conn = open_db(&app)?;
    ensure_default_user(&conn)?;
    let owner_user_id = active_user_id(&conn)?;
    let token = session_token(&conn, &owner_user_id)?;
    cloud_post_json(
        &format!(
            "/chat/conversations/{}/archive",
            urlencoding::encode(&conversation_id)
        ),
        &token,
        json!({}),
    )
}

#[tauri::command]
pub fn load_my_profile(app: AppHandle) -> Result<Value, String> {
    let conn = open_db(&app)?;
    ensure_default_user(&conn)?;
    let owner_user_id = active_user_id(&conn)?;
    let token = session_token(&conn, &owner_user_id)?;
    cloud_get_json("/profile/me", &token)
}

#[tauri::command]
pub fn save_my_profile(
    app: AppHandle,
    nickname: String,
    avatar_url: Option<String>,
    avatar_object_key: Option<String>,
    bio: Option<String>,
) -> Result<Value, String> {
    let conn = open_db(&app)?;
    ensure_default_user(&conn)?;
    let owner_user_id = active_user_id(&conn)?;
    let token = session_token(&conn, &owner_user_id)?;
    cloud_put_json(
        "/profile/me",
        &token,
        json!({
            "nickname": nickname,
            "avatarUrl": avatar_url,
            "avatarObjectKey": avatar_object_key,
            "bio": bio,
        }),
    )
}

#[tauri::command]
pub fn load_user_profile(app: AppHandle, user_id: i64) -> Result<Value, String> {
    let conn = open_db(&app)?;
    ensure_default_user(&conn)?;
    let owner_user_id = active_user_id(&conn)?;
    let token = session_token(&conn, &owner_user_id)?;
    cloud_get_json(&format!("/profile/users/{user_id}"), &token)
}

#[tauri::command]
pub fn search_profiles(app: AppHandle, keyword: String, scope: String) -> Result<Value, String> {
    let conn = open_db(&app)?;
    ensure_default_user(&conn)?;
    let owner_user_id = active_user_id(&conn)?;
    let token = session_token(&conn, &owner_user_id)?;
    cloud_get_json(
        &format!(
            "/profile/search?keyword={}&scope={}",
            urlencoding::encode(&keyword),
            urlencoding::encode(&scope)
        ),
        &token,
    )
}

#[tauri::command]
pub fn upload_profile_avatar(app: AppHandle, file_path: String) -> Result<Value, String> {
    let conn = open_db(&app)?;
    ensure_default_user(&conn)?;
    let owner_user_id = active_user_id(&conn)?;
    let token = session_token(&conn, &owner_user_id)?;
    cloud_upload_file("/files/upload?file_type=avatar", &token, &file_path)
}

#[tauri::command]
pub fn upload_profile_avatar_bytes(
    app: AppHandle,
    filename: String,
    content_type: Option<String>,
    bytes: Vec<u8>,
) -> Result<Value, String> {
    if bytes.is_empty() {
        return Err("empty file".to_string());
    }
    let conn = open_db(&app)?;
    ensure_default_user(&conn)?;
    let owner_user_id = active_user_id(&conn)?;
    let token = session_token(&conn, &owner_user_id)?;
    cloud_upload_bytes(
        "/files/upload?file_type=avatar",
        &token,
        &filename,
        content_type.as_deref(),
        bytes,
    )
}

#[tauri::command]
pub fn upload_chat_file_bytes(
    app: AppHandle,
    filename: String,
    content_type: Option<String>,
    bytes: Vec<u8>,
    file_type: String,
) -> Result<Value, String> {
    if bytes.is_empty() {
        return Err("empty file".to_string());
    }
    let upload_type = match file_type.as_str() {
        "image" => "image",
        "video" => "video",
        "file" => "file",
        "sticker" => "sticker",
        _ => return Err("unsupported chat upload type".to_string()),
    };
    let conn = open_db(&app)?;
    ensure_default_user(&conn)?;
    let owner_user_id = active_user_id(&conn)?;
    let token = session_token(&conn, &owner_user_id)?;
    cloud_upload_bytes(
        &format!("/files/upload?file_type={upload_type}"),
        &token,
        &filename,
        content_type.as_deref(),
        bytes,
    )
}

#[tauri::command]
pub fn reupload_cached_chat_file(
    app: AppHandle,
    file_object_id: String,
    file_name: String,
    content_type: Option<String>,
    file_type: String,
) -> Result<Value, String> {
    if file_object_id.trim().is_empty() {
        return Err("missing file object id".to_string());
    }
    let upload_type = match file_type.as_str() {
        "image" => "image",
        "video" => "video",
        "file" => "file",
        "sticker" => "sticker",
        _ => return Err("unsupported chat upload type".to_string()),
    };
    let filename = safe_download_filename(&file_name);
    let extension = Path::new(&filename)
        .extension()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("bin");
    let dir = chat_media_cache_dir(&app)?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let stable_id = safe_cache_segment(&file_object_id);
    let path = dir.join(format!("{stable_id}.{extension}"));
    if !path.exists() {
        download_chat_file_to_path(&app, &file_object_id, &path, None, None, None)?;
    }
    let bytes = fs::read(&path).map_err(|error| error.to_string())?;
    if bytes.is_empty() {
        return Err("empty file".to_string());
    }
    let conn = open_db(&app)?;
    ensure_default_user(&conn)?;
    let owner_user_id = active_user_id(&conn)?;
    let token = session_token(&conn, &owner_user_id)?;
    cloud_upload_bytes(
        &format!("/files/upload?file_type={upload_type}"),
        &token,
        &filename,
        content_type.as_deref(),
        bytes,
    )
}

#[tauri::command]
pub fn pick_chat_upload_files(
    kind: Option<String>,
    multiple: Option<bool>,
) -> Result<Value, String> {
    let upload_kind = kind.unwrap_or_else(|| "file".to_string());
    let mut dialog = rfd::FileDialog::new().set_title("选择要发送的文件");
    dialog = match upload_kind.as_str() {
        "media" => dialog.add_filter(
            "图片和视频",
            &[
                "png", "jpg", "jpeg", "webp", "gif", "bmp", "mp4", "mov", "webm", "avi", "mkv",
            ],
        ),
        "image" => dialog.add_filter("图片", &["png", "jpg", "jpeg", "webp", "gif", "bmp"]),
        "video" => dialog.add_filter("视频", &["mp4", "mov", "webm", "avi", "mkv"]),
        _ => dialog,
    };
    let paths = if multiple.unwrap_or(true) {
        dialog.pick_files().unwrap_or_default()
    } else {
        dialog
            .pick_file()
            .map(|path| vec![path])
            .unwrap_or_default()
    };
    let files: Vec<PickedLocalFile> = paths
        .into_iter()
        .filter_map(|path| picked_local_file(path).ok())
        .collect();
    Ok(json!({ "files": files }))
}

pub fn picked_chat_upload_files_from_paths(paths: Vec<PathBuf>) -> Value {
    let files: Vec<PickedLocalFile> = paths
        .into_iter()
        .filter_map(|path| picked_local_file(path).ok())
        .collect();
    json!({ "files": files })
}

#[tauri::command]
pub fn inspect_chat_upload_files(paths: Vec<String>) -> Result<Value, String> {
    let file_paths = paths.into_iter().map(PathBuf::from).collect();
    Ok(picked_chat_upload_files_from_paths(file_paths))
}

#[tauri::command]
pub async fn upload_chat_file_path_chunked(
    app: AppHandle,
    file_path: String,
    file_type: String,
    content_type: Option<String>,
    chunk_size: Option<u64>,
    task_id: Option<String>,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        upload_chat_file_path_chunked_blocking(
            app,
            file_path,
            file_type,
            content_type,
            chunk_size,
            task_id,
        )
    })
    .await
    .map_err(|error| format!("upload task failed: {error}"))?
}

fn upload_chat_file_path_chunked_blocking(
    app: AppHandle,
    file_path: String,
    file_type: String,
    content_type: Option<String>,
    chunk_size: Option<u64>,
    task_id: Option<String>,
) -> Result<Value, String> {
    let path = PathBuf::from(&file_path);
    if !path.exists() || !path.is_file() {
        return Err("file does not exist".to_string());
    }
    let upload_type = match file_type.as_str() {
        "image" => "image",
        "video" => "video",
        "file" => "file",
        "sticker" => "sticker",
        _ => return Err("unsupported chat upload type".to_string()),
    };
    let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;
    if metadata.len() == 0 {
        return Err("empty file".to_string());
    }
    let task_id = task_id
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| format!("transfer-{}-{}", now_millis(), random_token(6)));
    let filename = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("file")
        .to_string();
    let sha256 = sha256_file(&path)?;
    let requested_chunk_size = chunk_size
        .unwrap_or(4 * 1024 * 1024)
        .clamp(512 * 1024, 16 * 1024 * 1024);

    let conn = open_db(&app)?;
    ensure_default_user(&conn)?;
    let owner_user_id = active_user_id(&conn)?;
    let token = session_token(&conn, &owner_user_id)?;
    register_transfer_control(&task_id);
    emit_transfer_event(
        &app,
        &task_id,
        json!({
            "status": "hashing",
            "fileName": filename,
            "fileSize": metadata.len(),
            "uploadedBytes": 0,
        }),
    );
    let created = cloud_post_json(
        "/files/upload-sessions",
        &token,
        json!({
            "filename": filename,
            "sizeBytes": metadata.len(),
            "sha256": sha256,
            "fileType": upload_type,
            "contentType": content_type,
            "chunkSize": requested_chunk_size,
        }),
    )?;
    let upload = created
        .get("upload")
        .and_then(Value::as_object)
        .ok_or_else(|| "missing upload session".to_string())?;
    if upload
        .get("instant")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        unregister_transfer_control(&task_id);
        emit_transfer_event(
            &app,
            &task_id,
            json!({
                "status": "instant_completed",
                "uploadedBytes": metadata.len(),
                "fileSize": metadata.len(),
                "file": upload.get("file").cloned().unwrap_or(Value::Null),
            }),
        );
        return upload
            .get("file")
            .cloned()
            .map(|file| json!({ "file": file }))
            .ok_or_else(|| "missing instant file".to_string());
    }
    let upload_id = upload
        .get("uploadId")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "missing upload id".to_string())?
        .to_string();
    let chunk_size = upload
        .get("chunkSize")
        .and_then(Value::as_u64)
        .unwrap_or(requested_chunk_size)
        .clamp(512 * 1024, 16 * 1024 * 1024);
    let total_chunks = upload
        .get("totalChunks")
        .and_then(Value::as_u64)
        .unwrap_or_else(|| (metadata.len() + chunk_size - 1) / chunk_size);
    let completed_chunks: HashSet<u64> = upload
        .get("uploadedChunks")
        .and_then(Value::as_array)
        .map(|items| items.iter().filter_map(Value::as_u64).collect())
        .unwrap_or_default();
    let mut file = fs::File::open(&path).map_err(|error| error.to_string())?;
    let mut buffer = vec![0u8; chunk_size as usize];
    let mut uploaded_bytes = completed_chunks.len() as u64 * chunk_size;
    if uploaded_bytes > metadata.len() {
        uploaded_bytes = metadata.len();
    }
    let started_at = now_millis();
    emit_transfer_event(
        &app,
        &task_id,
        json!({
            "status": "uploading",
            "uploadId": upload_id,
            "uploadedBytes": uploaded_bytes,
            "fileSize": metadata.len(),
            "totalChunks": total_chunks,
        }),
    );
    for chunk_index in 0..total_chunks {
        let read = file.read(&mut buffer).map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        if completed_chunks.contains(&chunk_index) {
            continue;
        }
        wait_for_transfer_resume(&app, &task_id, &filename, metadata.len(), uploaded_bytes)?;
        cloud_upload_chunk(
            &format!(
                "/files/upload-sessions/{}/chunks/{}",
                urlencoding::encode(&upload_id),
                chunk_index,
            ),
            &token,
            &filename,
            content_type.as_deref(),
            buffer[..read].to_vec(),
        )?;
        uploaded_bytes = (uploaded_bytes + read as u64).min(metadata.len());
        let elapsed_ms = now_millis().saturating_sub(started_at).max(1);
        let speed = (uploaded_bytes as f64 / (elapsed_ms as f64 / 1000.0)) as u64;
        let remaining_seconds = if speed > 0 {
            Some(((metadata.len().saturating_sub(uploaded_bytes)) / speed).max(0))
        } else {
            None
        };
        emit_transfer_event(
            &app,
            &task_id,
            json!({
                "status": "uploading",
                "uploadId": upload_id,
                "uploadedBytes": uploaded_bytes,
                "fileSize": metadata.len(),
                "speedBytes": speed,
                "remainingSeconds": remaining_seconds,
                "chunkIndex": chunk_index,
                "totalChunks": total_chunks,
            }),
        );
    }
    let completed = cloud_post_json(
        &format!(
            "/files/upload-sessions/{}/complete",
            urlencoding::encode(&upload_id)
        ),
        &token,
        json!({}),
    );
    match &completed {
        Ok(value) => {
            unregister_transfer_control(&task_id);
            emit_transfer_event(
                &app,
                &task_id,
                json!({
                    "status": "completed",
                    "uploadedBytes": metadata.len(),
                    "fileSize": metadata.len(),
                    "file": value.get("file").cloned().unwrap_or(Value::Null),
                }),
            );
        }
        Err(error) => {
            unregister_transfer_control(&task_id);
            emit_transfer_event(
                &app,
                &task_id,
                json!({
                    "status": "failed",
                    "uploadedBytes": uploaded_bytes,
                    "fileSize": metadata.len(),
                    "errorMessage": error,
                }),
            );
        }
    }
    completed
}

#[tauri::command]
pub fn control_chat_upload_task(task_id: String, action: String) -> Result<Value, String> {
    let mut controls = chat_upload_controls()
        .lock()
        .map_err(|_| "upload control lock poisoned".to_string())?;
    let state = controls
        .entry(task_id.clone())
        .or_insert(TransferControlState {
            paused: false,
            canceled: false,
        });
    match action.as_str() {
        "pause" => state.paused = true,
        "resume" => {
            state.paused = false;
            state.canceled = false;
        }
        "cancel" => state.canceled = true,
        _ => return Err("unsupported upload control action".to_string()),
    }
    Ok(json!({
        "taskId": task_id,
        "paused": state.paused,
        "canceled": state.canceled,
    }))
}

#[tauri::command]
pub async fn get_chat_file_signed_url(
    app: AppHandle,
    file_object_id: String,
    source: Option<String>,
    message_id: Option<String>,
    drive_node_id: Option<String>,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        get_chat_file_signed_url_blocking(app, file_object_id, source, message_id, drive_node_id)
    })
    .await
    .map_err(|error| format!("signed url task failed: {error}"))?
}

fn get_chat_file_signed_url_blocking(
    app: AppHandle,
    file_object_id: String,
    source: Option<String>,
    message_id: Option<String>,
    drive_node_id: Option<String>,
) -> Result<Value, String> {
    let conn = open_db(&app)?;
    ensure_default_user(&conn)?;
    let owner_user_id = active_user_id(&conn)?;
    let token = session_token(&conn, &owner_user_id)?;
    cloud_get_json(
        &signed_url_path(
            &file_object_id,
            source.as_deref(),
            message_id.as_deref(),
            drive_node_id.as_deref(),
        ),
        &token,
    )
}

#[tauri::command]
pub fn media_debug_log(label: String, payload: Value) -> Result<(), String> {
    println!("[media-debug] {label} {}", payload);
    Ok(())
}

#[tauri::command]
pub async fn resolve_media_access(
    app: AppHandle,
    action: String,
    source: String,
    source_id: String,
    file_object_id: String,
) -> Result<Value, String> {
    println!(
        "[media-rust] resolve_media_access command start action={} source={} sourceId={} fileObjectId={}",
        action, source, source_id, file_object_id
    );
    tauri::async_runtime::spawn_blocking(move || {
        let started_at = Instant::now();
        let result = resolve_media_access_blocking(app, action, source, source_id, file_object_id);
        match &result {
            Ok(value) => println!(
                "[media-rust] resolve_media_access command end elapsedMs={} status={} message={}",
                started_at.elapsed().as_millis(),
                value.get("status").and_then(Value::as_str).unwrap_or(""),
                value.get("message").and_then(Value::as_str).unwrap_or("")
            ),
            Err(error) => eprintln!(
                "[media-rust] resolve_media_access command error elapsedMs={} error={}",
                started_at.elapsed().as_millis(),
                error
            ),
        }
        result
    })
    .await
    .map_err(|error| format!("media access task failed: {error}"))?
}

fn resolve_media_access_blocking(
    app: AppHandle,
    action: String,
    source: String,
    source_id: String,
    file_object_id: String,
) -> Result<Value, String> {
    let conn = open_db(&app)?;
    ensure_default_user(&conn)?;
    let owner_user_id = active_user_id(&conn)?;
    let token = session_token(&conn, &owner_user_id)?;
    println!(
        "[media-rust] resolve_media_access http request action={} source={} sourceId={} fileObjectId={}",
        action, source, source_id, file_object_id
    );
    cloud_post_json(
        "/media/access/resolve",
        &token,
        json!({
            "action": action,
            "source": source,
            "sourceId": source_id,
            "fileObjectId": file_object_id,
        }),
    )
}

#[tauri::command]
pub async fn cache_resolved_media_file(
    app: AppHandle,
    file_object_id: String,
    file_name: String,
    action: String,
    source: String,
    source_id: String,
) -> Result<Value, String> {
    println!(
        "[media-rust] cache_resolved_media_file command start action={} source={} sourceId={} fileObjectId={} fileName={}",
        action, source, source_id, file_object_id, file_name
    );
    tauri::async_runtime::spawn_blocking(move || {
        let started_at = Instant::now();
        let result = cache_resolved_media_file_blocking(
            app,
            file_object_id,
            file_name,
            action,
            source,
            source_id,
        );
        match &result {
            Ok(value) => println!(
                "[media-rust] cache_resolved_media_file command end elapsedMs={} path={}",
                started_at.elapsed().as_millis(),
                value.get("path").and_then(Value::as_str).unwrap_or("")
            ),
            Err(error) => eprintln!(
                "[media-rust] cache_resolved_media_file command error elapsedMs={} error={}",
                started_at.elapsed().as_millis(),
                error
            ),
        }
        result
    })
    .await
    .map_err(|error| format!("media cache task failed: {error}"))?
}

fn cache_resolved_media_file_blocking(
    app: AppHandle,
    file_object_id: String,
    file_name: String,
    action: String,
    source: String,
    source_id: String,
) -> Result<Value, String> {
    if file_object_id.trim().is_empty() {
        return Err("missing file object id".to_string());
    }
    println!(
        "[media-rust] cache_resolved_media_file resolve start source={} sourceId={} fileObjectId={}",
        source, source_id, file_object_id
    );
    let resolved = resolve_media_access_blocking(
        app.clone(),
        action,
        source,
        source_id.clone(),
        file_object_id.clone(),
    )?;
    let status = resolved
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("failed");
    if status != "allowed" {
        let message = resolved
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("media access denied");
        return Err(message.to_string());
    }
    let url = resolved
        .get("url")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "missing resolved media url".to_string())?;
    let path = media_cache_path(&app, &file_object_id, &file_name)?;
    if !path.exists() {
        println!(
            "[media-rust] cache_resolved_media_file download start target={}",
            path.to_string_lossy()
        );
        download_url_to_path(url, &path, "media cache")?;
    } else {
        println!(
            "[media-rust] cache_resolved_media_file cache hit target={}",
            path.to_string_lossy()
        );
    }
    if let Ok(conn) = open_db(&app) {
        if let Ok(owner_user_id) = active_user_id(&conn) {
            let _ = remember_local_file_candidate_for_user(
                &conn,
                &owner_user_id,
                &file_object_id,
                Some(&source_id),
                "local_preview_cache",
                &path.to_string_lossy(),
            );
        }
    }
    Ok(json!({ "path": path.to_string_lossy(), "access": resolved }))
}

#[tauri::command]
pub fn validate_local_media_file(path: String) -> Result<Value, String> {
    println!(
        "[media-rust] validate_local_media_file command start path={}",
        path
    );
    let candidate = PathBuf::from(path.trim());
    if candidate.as_os_str().is_empty() {
        eprintln!("[media-rust] validate_local_media_file command error missing path");
        return Err("missing local media path".to_string());
    }
    if !candidate.is_file() {
        eprintln!(
            "[media-rust] validate_local_media_file command error missing file path={}",
            candidate.to_string_lossy()
        );
        return Err("local media file does not exist".to_string());
    }
    println!(
        "[media-rust] validate_local_media_file command end path={}",
        candidate.to_string_lossy()
    );
    Ok(json!({ "path": candidate.to_string_lossy() }))
}

#[tauri::command]
pub fn save_chat_video_poster(
    app: AppHandle,
    key: String,
    bytes: Vec<u8>,
) -> Result<Value, String> {
    if bytes.is_empty() {
        return Err("empty video poster".to_string());
    }
    let mut stable_key = safe_cache_segment(&key);
    if stable_key.is_empty() {
        stable_key = format!("poster_{}", now_millis());
    }
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?
        .join("chat_cache")
        .join("posters");
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let path = dir.join(format!("{stable_key}.jpg"));
    fs::write(&path, bytes).map_err(|error| error.to_string())?;
    Ok(json!({ "path": path.to_string_lossy() }))
}

#[tauri::command]
pub fn open_local_media_folder(path: String) -> Result<Value, String> {
    let candidate = PathBuf::from(path.trim());
    if !candidate.exists() {
        return Err("local media file does not exist".to_string());
    }
    let target = candidate.parent().unwrap_or_else(|| Path::new(&candidate));
    open_path_with_default_app(target)?;
    Ok(json!({ "path": target.to_string_lossy() }))
}

#[tauri::command]
pub async fn download_chat_file(
    app: AppHandle,
    file_object_id: String,
    file_name: String,
    source: Option<String>,
    message_id: Option<String>,
    drive_node_id: Option<String>,
) -> Result<Value, String> {
    println!(
        "[media-rust] download_chat_file command start source={:?} messageId={:?} driveNodeId={:?} fileObjectId={} fileName={}",
        source, message_id, drive_node_id, file_object_id, file_name
    );
    tauri::async_runtime::spawn_blocking(move || {
        let started_at = Instant::now();
        let result = download_chat_file_blocking(
            app,
            file_object_id,
            file_name,
            source,
            message_id,
            drive_node_id,
        );
        match &result {
            Ok(value) => println!(
                "[media-rust] download_chat_file command end elapsedMs={} path={} cancelled={}",
                started_at.elapsed().as_millis(),
                value.get("path").and_then(Value::as_str).unwrap_or(""),
                value
                    .get("cancelled")
                    .and_then(Value::as_bool)
                    .unwrap_or(false)
            ),
            Err(error) => eprintln!(
                "[media-rust] download_chat_file command error elapsedMs={} error={}",
                started_at.elapsed().as_millis(),
                error
            ),
        }
        result
    })
    .await
    .map_err(|error| format!("download task failed: {error}"))?
}

fn download_chat_file_blocking(
    app: AppHandle,
    file_object_id: String,
    file_name: String,
    source: Option<String>,
    message_id: Option<String>,
    drive_node_id: Option<String>,
) -> Result<Value, String> {
    let default_dir = app
        .path()
        .download_dir()
        .or_else(|_| app.path().app_data_dir())
        .map_err(|error| error.to_string())?;
    let Some(download_root) = rfd::FileDialog::new()
        .set_title("选择下载文件夹")
        .set_directory(&default_dir)
        .pick_folder()
    else {
        println!("[media-rust] download_chat_file folder picker cancelled");
        return Ok(json!({ "cancelled": true }));
    };
    fs::create_dir_all(&download_root).map_err(|error| error.to_string())?;
    let filename = safe_download_filename(&file_name);
    let target = unique_download_path(&download_root, &filename);
    download_chat_file_to_path(
        &app,
        &file_object_id,
        &target,
        source.as_deref(),
        message_id.as_deref(),
        drive_node_id.as_deref(),
    )?;
    if let Ok(conn) = open_db(&app) {
        if let Ok(owner_user_id) = active_user_id(&conn) {
            let _ = remember_local_file_candidate_for_user(
                &conn,
                &owner_user_id,
                &file_object_id,
                drive_node_id.as_deref(),
                "local_download",
                &target.to_string_lossy(),
            );
        }
    }
    Ok(json!({ "path": target.to_string_lossy(), "cancelled": false }))
}

#[tauri::command]
pub async fn cache_chat_file(
    app: AppHandle,
    file_object_id: String,
    file_name: String,
    source: Option<String>,
    message_id: Option<String>,
    drive_node_id: Option<String>,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        cache_chat_file_blocking(
            app,
            file_object_id,
            file_name,
            source,
            message_id,
            drive_node_id,
        )
    })
    .await
    .map_err(|error| format!("chat file cache task failed: {error}"))?
}

fn cache_chat_file_blocking(
    app: AppHandle,
    file_object_id: String,
    file_name: String,
    source: Option<String>,
    message_id: Option<String>,
    drive_node_id: Option<String>,
) -> Result<Value, String> {
    if file_object_id.trim().is_empty() {
        return Err("missing file object id".to_string());
    }
    let path = media_cache_path(&app, &file_object_id, &file_name)?;
    if !path.exists() {
        download_chat_file_to_path(
            &app,
            &file_object_id,
            &path,
            source.as_deref(),
            message_id.as_deref(),
            drive_node_id.as_deref(),
        )?;
    }
    if let Ok(conn) = open_db(&app) {
        if let Ok(owner_user_id) = active_user_id(&conn) {
            let _ = remember_local_file_candidate_for_user(
                &conn,
                &owner_user_id,
                &file_object_id,
                drive_node_id.as_deref(),
                "local_preview_cache",
                &path.to_string_lossy(),
            );
        }
    }
    Ok(json!({ "path": path.to_string_lossy() }))
}

#[tauri::command]
pub async fn open_cached_chat_file(
    app: AppHandle,
    file_object_id: String,
    file_name: String,
    source: Option<String>,
    message_id: Option<String>,
    drive_node_id: Option<String>,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        open_cached_chat_file_blocking(
            app,
            file_object_id,
            file_name,
            source,
            message_id,
            drive_node_id,
        )
    })
    .await
    .map_err(|error| format!("open cached file task failed: {error}"))?
}

fn open_cached_chat_file_blocking(
    app: AppHandle,
    file_object_id: String,
    file_name: String,
    source: Option<String>,
    message_id: Option<String>,
    drive_node_id: Option<String>,
) -> Result<Value, String> {
    let cached = cache_chat_file_blocking(
        app,
        file_object_id,
        file_name,
        source,
        message_id,
        drive_node_id,
    )?;
    let path = cached
        .get("path")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "missing cached file path".to_string())?;
    open_path_with_default_app(Path::new(path))?;
    Ok(json!({ "path": path }))
}

#[tauri::command]
pub fn remember_local_file_candidate(
    app: AppHandle,
    file_object_id: String,
    drive_node_id: Option<String>,
    source_type: String,
    local_path: String,
) -> Result<Value, String> {
    let conn = open_db(&app)?;
    ensure_default_user(&conn)?;
    let owner_user_id = active_user_id(&conn)?;
    remember_local_file_candidate_for_user(
        &conn,
        &owner_user_id,
        &file_object_id,
        drive_node_id.as_deref(),
        &source_type,
        &local_path,
    )?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
pub fn list_local_file_candidates(
    app: AppHandle,
    file_object_id: String,
    drive_node_id: Option<String>,
) -> Result<Value, String> {
    let conn = open_db(&app)?;
    ensure_default_user(&conn)?;
    let owner_user_id = active_user_id(&conn)?;
    let candidates = list_local_file_candidates_for_user(
        &conn,
        &owner_user_id,
        &file_object_id,
        drive_node_id.as_deref(),
    )?;
    Ok(json!({ "candidates": candidates }))
}

#[tauri::command]
pub async fn open_chat_file_local_first(
    app: AppHandle,
    file_object_id: String,
    file_name: String,
    source: Option<String>,
    message_id: Option<String>,
    drive_node_id: Option<String>,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        open_chat_file_local_first_blocking(
            app,
            file_object_id,
            file_name,
            source,
            message_id,
            drive_node_id,
        )
    })
    .await
    .map_err(|error| format!("open local-first file task failed: {error}"))?
}

fn open_chat_file_local_first_blocking(
    app: AppHandle,
    file_object_id: String,
    file_name: String,
    source: Option<String>,
    message_id: Option<String>,
    drive_node_id: Option<String>,
) -> Result<Value, String> {
    let conn = open_db(&app)?;
    ensure_default_user(&conn)?;
    let owner_user_id = active_user_id(&conn)?;
    let candidates = list_local_file_candidates_for_user(
        &conn,
        &owner_user_id,
        &file_object_id,
        drive_node_id.as_deref(),
    )?;
    drop(conn);

    for candidate in candidates {
        if let Some(path) = candidate.get("path").and_then(Value::as_str) {
            let local_path = Path::new(path);
            if local_path.is_file() {
                open_path_with_default_app(local_path)?;
                return Ok(json!({
                    "path": path,
                    "sourceType": candidate
                        .get("sourceType")
                        .and_then(Value::as_str)
                        .unwrap_or("local_original")
                }));
            }
        }
    }

    let cached = cache_chat_file_blocking(
        app,
        file_object_id,
        file_name,
        source,
        message_id,
        drive_node_id,
    )?;
    let path = cached
        .get("path")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "missing cached file path".to_string())?;
    open_path_with_default_app(Path::new(path))?;
    Ok(json!({ "path": path, "sourceType": "local_preview_cache" }))
}

#[tauri::command]
pub fn list_drive_nodes(
    app: AppHandle,
    drive_type: String,
    group_id: Option<String>,
    parent_id: Option<String>,
    keyword: Option<String>,
    file_type: Option<String>,
) -> Result<Value, String> {
    let conn = open_db(&app)?;
    ensure_default_user(&conn)?;
    let owner_user_id = active_user_id(&conn)?;
    let token = session_token(&conn, &owner_user_id)?;
    let mut path = format!(
        "/files/drive/nodes?driveType={}&keyword={}&fileType={}",
        urlencoding::encode(&drive_type),
        urlencoding::encode(keyword.as_deref().unwrap_or("")),
        urlencoding::encode(file_type.as_deref().unwrap_or("all"))
    );
    if let Some(value) = group_id.as_deref().filter(|value| !value.trim().is_empty()) {
        path.push_str("&groupId=");
        path.push_str(&urlencoding::encode(value));
    }
    if let Some(value) = parent_id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        path.push_str("&parentId=");
        path.push_str(&urlencoding::encode(value));
    }
    cloud_get_json(&path, &token)
}

#[tauri::command]
pub fn create_drive_folder(
    app: AppHandle,
    drive_type: String,
    group_id: Option<String>,
    parent_id: Option<String>,
    name: String,
) -> Result<Value, String> {
    let conn = open_db(&app)?;
    ensure_default_user(&conn)?;
    let owner_user_id = active_user_id(&conn)?;
    let token = session_token(&conn, &owner_user_id)?;
    cloud_post_json(
        "/files/drive/folders",
        &token,
        json!({
            "driveType": drive_type,
            "groupId": group_id,
            "parentId": parent_id,
            "name": name,
        }),
    )
}

#[tauri::command]
pub fn save_file_to_drive(
    app: AppHandle,
    drive_type: String,
    group_id: Option<String>,
    parent_id: Option<String>,
    file_object_id: String,
    source_message_id: Option<String>,
    name: Option<String>,
) -> Result<Value, String> {
    let conn = open_db(&app)?;
    ensure_default_user(&conn)?;
    let owner_user_id = active_user_id(&conn)?;
    let token = session_token(&conn, &owner_user_id)?;
    cloud_post_json(
        "/files/drive/files",
        &token,
        json!({
            "driveType": drive_type,
            "groupId": group_id,
            "parentId": parent_id,
            "fileObjectId": file_object_id,
            "sourceMessageId": source_message_id,
            "name": name,
        }),
    )
}

#[tauri::command]
pub fn forward_drive_node_to_chat(
    app: AppHandle,
    node_id: String,
    conversation_id: String,
) -> Result<Value, String> {
    let conn = open_db(&app)?;
    ensure_default_user(&conn)?;
    let owner_user_id = active_user_id(&conn)?;
    let token = session_token(&conn, &owner_user_id)?;
    let device_id = sync_client_id(&conn)?;
    cloud_post_json(
        &format!(
            "/chat/drive-nodes/{}/forward?clientId={}",
            urlencoding::encode(&node_id),
            urlencoding::encode(&device_id),
        ),
        &token,
        json!({
            "conversationId": conversation_id,
            "clientMsgId": format!("desktop-{}-{}", now_millis(), random_token(8)),
            "messageType": "file",
            "content": "",
            "contentJson": {},
            "fileObjectId": null,
        }),
    )
}

fn download_chat_file_to_path(
    app: &AppHandle,
    file_object_id: &str,
    target: &Path,
    source: Option<&str>,
    message_id: Option<&str>,
    drive_node_id: Option<&str>,
) -> Result<(), String> {
    if file_object_id.trim().is_empty() {
        return Err("missing file object id".to_string());
    }
    let conn = open_db(app)?;
    ensure_default_user(&conn)?;
    let owner_user_id = active_user_id(&conn)?;
    let token = session_token(&conn, &owner_user_id)?;
    let signed_path = signed_url_path(file_object_id, source, message_id, drive_node_id);
    println!("[media-rust] download_chat_file_to_path signed-url request path={signed_path}");
    let signed = cloud_get_json(&signed_path, &token)?;
    let url = signed
        .get("url")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "missing signed download url".to_string())?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    download_url_to_path(url, target, "download")
}

fn signed_url_path(
    file_object_id: &str,
    source: Option<&str>,
    message_id: Option<&str>,
    drive_node_id: Option<&str>,
) -> String {
    let mut path = format!("/files/{}/signed-url", urlencoding::encode(file_object_id));
    let normalized_source = source
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("legacy");
    path.push_str("?source=");
    path.push_str(&urlencoding::encode(normalized_source));
    if let Some(value) = message_id.map(str::trim).filter(|value| !value.is_empty()) {
        path.push_str("&messageId=");
        path.push_str(&urlencoding::encode(value));
    }
    if let Some(value) = drive_node_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        path.push_str("&driveNodeId=");
        path.push_str(&urlencoding::encode(value));
    }
    println!("[media-rust] signed_url_path built path={path}");
    path
}

fn media_cache_path(
    app: &AppHandle,
    file_object_id: &str,
    file_name: &str,
) -> Result<PathBuf, String> {
    let filename = safe_download_filename(file_name);
    let extension = Path::new(&filename)
        .extension()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("bin");
    let dir = chat_media_cache_dir(app)?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let stable_id = safe_cache_segment(file_object_id);
    Ok(dir.join(format!("{stable_id}.{extension}")))
}

fn chat_media_cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_cache_dir()
        .map_err(|error| error.to_string())
        .map(|path| path.join("chat_cache").join("media"))
}

fn open_path_with_default_app(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Err("file does not exist".to_string());
    }
    let wide_path: Vec<u16> = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let operation: Vec<u16> = "open".encode_utf16().chain(std::iter::once(0)).collect();
    let result = unsafe {
        ShellExecuteW(
            Some(HWND::default()),
            PCWSTR(operation.as_ptr()),
            PCWSTR(wide_path.as_ptr()),
            PCWSTR::null(),
            PCWSTR::null(),
            windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL,
        )
    };
    if result.0 as isize <= 32 {
        return Err(format!("failed to open file: {}", result.0 as isize));
    }
    Ok(())
}

fn download_url_to_path(url: &str, target: &Path, label: &str) -> Result<(), String> {
    let started_at = Instant::now();
    println!(
        "[media-rust] download_url_to_path start label={} target={}",
        label,
        target.to_string_lossy()
    );
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let client = Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|error| format!("{label} client failed: {error}"))?;
    let response = client
        .get(url)
        .send()
        .map_err(|error| format!("{label} failed: {error}"))?;
    let status = response.status();
    println!(
        "[media-rust] download_url_to_path response label={} status={} elapsedMs={}",
        label,
        status,
        started_at.elapsed().as_millis()
    );
    if !status.is_success() {
        return Err(format!("{label} failed: HTTP {status}"));
    }
    let bytes = response
        .bytes()
        .map_err(|error| format!("{label} failed: {error}"))?;
    fs::write(target, bytes).map_err(|error| error.to_string())?;
    println!(
        "[media-rust] download_url_to_path end label={} elapsedMs={} target={}",
        label,
        started_at.elapsed().as_millis(),
        target.to_string_lossy()
    );
    Ok(())
}

fn file_id_from_file_reference(value: &str) -> Option<String> {
    let filename = value
        .split('?')
        .next()
        .unwrap_or(value)
        .rsplit('/')
        .next()
        .unwrap_or(value);
    let stem = filename.split('.').next().unwrap_or(filename).trim();
    if stem.starts_with("file_") && stem.len() > "file_".len() {
        Some(stem.to_string())
    } else {
        None
    }
}

#[tauri::command]
pub fn cache_profile_avatar(
    app: AppHandle,
    account_key: String,
    avatar_key: String,
    avatar_url: String,
) -> Result<Value, String> {
    let account = safe_cache_segment(&account_key);
    let source = avatar_url.trim();
    if account.is_empty() || avatar_key.trim().is_empty() || source.is_empty() {
        return Err("invalid avatar cache input".to_string());
    }
    if source.starts_with("asset:") || Path::new(source).exists() {
        return Ok(json!({ "path": source }));
    }

    let extension = avatar_extension(if source.contains('.') {
        source
    } else {
        avatar_key.trim()
    });
    let mut stable_key = safe_cache_segment(&avatar_key);
    if stable_key.is_empty() {
        stable_key = "avatar".to_string();
    }
    let filename = format!("{stable_key}.{extension}");
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("chat_cache")
        .join(account)
        .join("avatars");
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let path = dir.join(filename);
    if !path.exists() {
        let mut last_error = None;
        if source.starts_with("http://") || source.starts_with("https://") {
            if let Err(error) = download_url_to_path(source, &path, "avatar") {
                last_error = Some(error);
            }
        }
        if !path.exists() {
            for reference in [avatar_key.trim(), source] {
                if let Some(file_id) = file_id_from_file_reference(reference) {
                    match download_chat_file_to_path(&app, &file_id, &path, None, None, None) {
                        Ok(()) => {
                            last_error = None;
                            break;
                        }
                        Err(error) => {
                            last_error = Some(error);
                        }
                    }
                }
            }
        }
        if !path.exists() {
            return Err(last_error.unwrap_or_else(|| "avatar download failed".to_string()));
        }
    }

    Ok(json!({ "path": path.to_string_lossy().to_string() }))
}

#[tauri::command]
pub fn send_friend_request(
    app: AppHandle,
    to_user_id: i64,
    message: Option<String>,
) -> Result<Value, String> {
    let conn = open_db(&app)?;
    ensure_default_user(&conn)?;
    let owner_user_id = active_user_id(&conn)?;
    let token = session_token(&conn, &owner_user_id)?;
    cloud_post_json(
        "/friends/requests",
        &token,
        json!({
            "toUserId": to_user_id,
            "message": message.unwrap_or_default(),
        }),
    )
}

#[tauri::command]
pub fn list_friend_requests(app: AppHandle) -> Result<Value, String> {
    let conn = open_db(&app)?;
    ensure_default_user(&conn)?;
    let owner_user_id = active_user_id(&conn)?;
    let token = session_token(&conn, &owner_user_id)?;
    cloud_get_json("/friends/requests", &token)
}

#[tauri::command]
pub fn accept_friend_request(app: AppHandle, request_id: i64) -> Result<Value, String> {
    let conn = open_db(&app)?;
    ensure_default_user(&conn)?;
    let owner_user_id = active_user_id(&conn)?;
    let token = session_token(&conn, &owner_user_id)?;
    cloud_post_json(
        &format!("/friends/requests/{request_id}/accept"),
        &token,
        json!({}),
    )
}

#[tauri::command]
pub fn reject_friend_request(app: AppHandle, request_id: i64) -> Result<Value, String> {
    let conn = open_db(&app)?;
    ensure_default_user(&conn)?;
    let owner_user_id = active_user_id(&conn)?;
    let token = session_token(&conn, &owner_user_id)?;
    cloud_post_json(
        &format!("/friends/requests/{request_id}/reject"),
        &token,
        json!({}),
    )
}

#[tauri::command]
pub fn list_friends(app: AppHandle) -> Result<Value, String> {
    let conn = open_db(&app)?;
    ensure_default_user(&conn)?;
    let owner_user_id = active_user_id(&conn)?;
    let token = session_token(&conn, &owner_user_id)?;
    cloud_get_json("/friends", &token)
}

#[tauri::command]
pub fn delete_friend(app: AppHandle, friend_user_id: i64) -> Result<Value, String> {
    let conn = open_db(&app)?;
    ensure_default_user(&conn)?;
    let owner_user_id = active_user_id(&conn)?;
    let token = session_token(&conn, &owner_user_id)?;
    cloud_delete_json(&format!("/friends/{friend_user_id}"), &token)
}

#[tauri::command]
pub fn register_local_account(
    app: AppHandle,
    phone: String,
    code: String,
    password: String,
) -> Result<LocalAccountState, String> {
    let normalized_phone = normalize_phone(&phone)?;
    validate_password(&password)?;
    let token = cloud_register(&normalized_phone, code.trim(), &password)?;
    let cloud_user_id = fetch_cloud_user_id(&token)?;
    let conn = open_db(&app)?;
    ensure_default_user(&conn)?;

    let existing_id: Option<String> = conn
        .query_row(
            "SELECT id FROM local_users WHERE phone = ?1 AND deleted_at IS NULL",
            params![normalized_phone],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let now = now_string();
    let user_id = if let Some(user_id) = existing_id {
        update_local_user_cloud_auth(
            &conn,
            &user_id,
            &normalized_phone,
            &password,
            &cloud_user_id,
            &now,
        )?;
        user_id
    } else {
        insert_local_cloud_user(&conn, &normalized_phone, &password, &cloud_user_id, &now)?
    };

    save_session_token(&conn, &user_id, &token)?;
    upsert_sync_meta_cloud_user(&conn, &user_id, &cloud_user_id)?;
    if !sync_current_user_with_cloud(&conn, &user_id, &token)? {
        copy_default_schedule_if_needed(&conn, &user_id)?;
    }
    activate_user(&conn, &user_id)?;
    load_account_state_from_conn(&conn)
}

#[tauri::command]
pub fn login_with_password(
    app: AppHandle,
    phone: String,
    password: String,
) -> Result<LocalAccountState, String> {
    let normalized_phone = normalize_phone(&phone)?;
    let token = cloud_login_password(&normalized_phone, &password)?;
    let cloud_user_id = fetch_cloud_user_id(&token)?;
    let conn = open_db(&app)?;
    ensure_default_user(&conn)?;

    let user_id: Option<String> = conn
        .query_row(
            "SELECT id FROM local_users WHERE phone = ?1 AND deleted_at IS NULL",
            params![normalized_phone],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let now = now_string();
    let user_id = if let Some(user_id) = user_id {
        update_local_user_cloud_auth(
            &conn,
            &user_id,
            &normalized_phone,
            &password,
            &cloud_user_id,
            &now,
        )?;
        user_id
    } else {
        insert_local_cloud_user(&conn, &normalized_phone, &password, &cloud_user_id, &now)?
    };

    save_session_token(&conn, &user_id, &token)?;
    upsert_sync_meta_cloud_user(&conn, &user_id, &cloud_user_id)?;
    if !sync_current_user_with_cloud(&conn, &user_id, &token)? {
        copy_default_schedule_if_needed(&conn, &user_id)?;
    }
    activate_user(&conn, &user_id)?;
    load_account_state_from_conn(&conn)
}

#[tauri::command]
pub fn login_with_code(
    app: AppHandle,
    phone: String,
    code: String,
) -> Result<LocalAccountState, String> {
    let normalized_phone = normalize_phone(&phone)?;
    let token = cloud_login_code(&normalized_phone, code.trim())?;
    let cloud_user_id = fetch_cloud_user_id(&token)?;
    let conn = open_db(&app)?;
    ensure_default_user(&conn)?;

    let user_id: Option<String> = conn
        .query_row(
            "SELECT id FROM local_users WHERE phone = ?1 AND deleted_at IS NULL",
            params![normalized_phone],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let now = now_string();
    let user_id = if let Some(user_id) = user_id {
        conn.execute(
            "UPDATE local_users SET cloud_user_id = ?2, updated_at = ?3 WHERE id = ?1",
            params![user_id, cloud_user_id, now],
        )
        .map_err(|error| error.to_string())?;
        user_id
    } else {
        let user_id = format!("local_user_{}", random_token(16));
        conn.execute(
            "INSERT INTO local_users (id, phone, password_hash, password_salt, cloud_user_id, created_at, updated_at)
             VALUES (?1, ?2, NULL, NULL, ?3, ?4, ?4)",
            params![user_id, normalized_phone, cloud_user_id, now],
        )
        .map_err(|error| error.to_string())?;
        user_id
    };

    save_session_token(&conn, &user_id, &token)?;
    upsert_sync_meta_cloud_user(&conn, &user_id, &cloud_user_id)?;
    if !sync_current_user_with_cloud(&conn, &user_id, &token)? {
        copy_default_schedule_if_needed(&conn, &user_id)?;
    }
    activate_user(&conn, &user_id)?;
    load_account_state_from_conn(&conn)
}

#[tauri::command]
pub fn request_class_login_code(class_no: String) -> Result<Value, String> {
    let clean_class_no = normalize_class_no(&class_no)?;
    let client = cloud_client()?;
    let response = client
        .post(cloud_url("/auth/class/request_code"))
        .json(&json!({ "classNo": clean_class_no }))
        .send()
        .map_err(|error| format!("cloud request failed: {error}"))?;
    read_cloud_json(response)
}

#[tauri::command]
pub fn login_class_with_code(
    app: AppHandle,
    class_no: String,
    code: String,
) -> Result<LocalAccountState, String> {
    let clean_class_no = normalize_class_no(&class_no)?;
    let token = cloud_login_class_code(&clean_class_no, code.trim())?;
    let cloud_user_id = fetch_cloud_user_id(&token)?;
    let conn = open_db(&app)?;
    ensure_default_user(&conn)?;
    let local_phone = format!("class:{clean_class_no}");

    let user_id: Option<String> = conn
        .query_row(
            "SELECT id FROM local_users WHERE phone = ?1 AND deleted_at IS NULL",
            params![local_phone],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let now = now_string();
    let user_id = if let Some(user_id) = user_id {
        conn.execute(
            "UPDATE local_users SET cloud_user_id = ?2, updated_at = ?3 WHERE id = ?1",
            params![user_id, cloud_user_id, now],
        )
        .map_err(|error| error.to_string())?;
        user_id
    } else {
        let user_id = format!("local_user_{}", random_token(16));
        conn.execute(
            "INSERT INTO local_users (id, phone, password_hash, password_salt, cloud_user_id, created_at, updated_at)
             VALUES (?1, ?2, NULL, NULL, ?3, ?4, ?4)",
            params![user_id, local_phone, cloud_user_id, now],
        )
        .map_err(|error| error.to_string())?;
        user_id
    };

    save_session_token(&conn, &user_id, &token)?;
    upsert_sync_meta_cloud_user(&conn, &user_id, &cloud_user_id)?;
    let _ = sync_current_user_with_cloud(&conn, &user_id, &token);
    activate_user(&conn, &user_id)?;
    load_account_state_from_conn(&conn)
}

#[tauri::command]
pub fn logout_local_account(app: AppHandle) -> Result<LocalAccountState, String> {
    let conn = open_db(&app)?;
    ensure_default_user(&conn)?;
    let owner_user_id = active_user_id(&conn)?;
    if owner_user_id != DEFAULT_USER_ID {
        clear_session_token(&conn, &owner_user_id)?;
    }
    activate_user(&conn, DEFAULT_USER_ID)?;
    load_account_state_from_conn(&conn)
}

fn cloud_register(phone: &str, code: &str, password: &str) -> Result<String, String> {
    post_cloud_token(
        "/auth/register",
        json!({
            "phone": phone,
            "code": code,
            "password": password,
            "password_confirm": password,
        }),
    )
}

fn cloud_login_password(phone: &str, password: &str) -> Result<String, String> {
    post_cloud_token(
        "/auth/login_password",
        json!({
            "phone": phone,
            "password": password,
        }),
    )
}

fn cloud_login_code(phone: &str, code: &str) -> Result<String, String> {
    post_cloud_token(
        "/auth/login_code",
        json!({
            "phone": phone,
            "code": code,
        }),
    )
}

fn cloud_login_class_code(class_no: &str, code: &str) -> Result<String, String> {
    post_cloud_token(
        "/auth/class/login_code",
        json!({
            "classNo": class_no,
            "code": code,
        }),
    )
}

fn normalize_class_no(value: &str) -> Result<String, String> {
    let class_no = value.trim();
    if class_no.len() == 8 && class_no.chars().all(|item| item.is_ascii_digit()) {
        Ok(class_no.to_string())
    } else {
        Err("class number must be 8 digits".to_string())
    }
}

fn fetch_cloud_user_id(token: &str) -> Result<String, String> {
    Ok(fetch_cloud_status(token)?.user_id.to_string())
}

fn fetch_cloud_status(token: &str) -> Result<SyncStatusResponse, String> {
    let client = cloud_client()?;
    let response = client
        .get(cloud_url("/sync/status"))
        .bearer_auth(token)
        .send()
        .map_err(|error| format!("cloud request failed: {error}"))?;
    read_cloud_json(response)
}

fn post_cloud_token(path: &str, body: Value) -> Result<String, String> {
    let client = cloud_client()?;
    let response = client
        .post(cloud_url(path))
        .json(&body)
        .send()
        .map_err(|error| format!("cloud request failed: {error}"))?;
    let token: TokenResponse = read_cloud_json(response)?;
    Ok(token.access_token)
}

fn cloud_post_json(path: &str, token: &str, body: Value) -> Result<Value, String> {
    let client = cloud_client()?;
    let response = client
        .post(cloud_url(path))
        .bearer_auth(token)
        .json(&body)
        .send()
        .map_err(|error| format!("cloud request failed: {error}"))?;
    read_cloud_json(response)
}

fn cloud_put_json(path: &str, token: &str, body: Value) -> Result<Value, String> {
    let client = cloud_client()?;
    let response = client
        .put(cloud_url(path))
        .bearer_auth(token)
        .json(&body)
        .send()
        .map_err(|error| format!("cloud request failed: {error}"))?;
    read_cloud_json(response)
}

fn cloud_patch_json(path: &str, token: &str, body: Value) -> Result<Value, String> {
    let client = cloud_client()?;
    let response = client
        .patch(cloud_url(path))
        .bearer_auth(token)
        .json(&body)
        .send()
        .map_err(|error| format!("cloud request failed: {error}"))?;
    read_cloud_json(response)
}

fn cloud_delete_json(path: &str, token: &str) -> Result<Value, String> {
    let client = cloud_client()?;
    let response = client
        .delete(cloud_url(path))
        .bearer_auth(token)
        .send()
        .map_err(|error| format!("cloud request failed: {error}"))?;
    read_cloud_json(response)
}

fn cloud_get_json(path: &str, token: &str) -> Result<Value, String> {
    let client = cloud_client()?;
    let response = client
        .get(cloud_url(path))
        .bearer_auth(token)
        .send()
        .map_err(|error| format!("cloud request failed: {error}"))?;
    read_cloud_json(response)
}

fn cloud_upload_file(path: &str, token: &str, file_path: &str) -> Result<Value, String> {
    let client = cloud_client()?;
    let file_name = PathBuf::from(file_path)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("avatar")
        .to_string();
    let form = reqwest::blocking::multipart::Form::new()
        .file("file", file_path)
        .map_err(|error| format!("cloud upload failed: {error}"))?
        .text("filename", file_name);
    let response = client
        .post(cloud_url(path))
        .bearer_auth(token)
        .multipart(form)
        .send()
        .map_err(|error| format!("cloud upload failed: {error}"))?;
    read_cloud_json(response)
}

fn cloud_upload_bytes(
    path: &str,
    token: &str,
    filename: &str,
    content_type: Option<&str>,
    bytes: Vec<u8>,
) -> Result<Value, String> {
    let client = cloud_client()?;
    let mut part = reqwest::blocking::multipart::Part::bytes(bytes).file_name(filename.to_string());
    if let Some(content_type) = content_type {
        part = part
            .mime_str(content_type)
            .map_err(|error| format!("cloud upload failed: {error}"))?;
    }
    let form = reqwest::blocking::multipart::Form::new().part("file", part);
    let response = client
        .post(cloud_url(path))
        .bearer_auth(token)
        .multipart(form)
        .send()
        .map_err(|error| format!("cloud upload failed: {error}"))?;
    read_cloud_json(response)
}

fn cloud_upload_chunk(
    path: &str,
    token: &str,
    filename: &str,
    content_type: Option<&str>,
    bytes: Vec<u8>,
) -> Result<Value, String> {
    let client = Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|error| format!("cloud upload client failed: {error}"))?;
    let mut part = reqwest::blocking::multipart::Part::bytes(bytes).file_name(filename.to_string());
    if let Some(content_type) = content_type {
        part = part
            .mime_str(content_type)
            .map_err(|error| format!("cloud upload failed: {error}"))?;
    }
    let form = reqwest::blocking::multipart::Form::new().part("file", part);
    let response = client
        .post(cloud_url(path))
        .bearer_auth(token)
        .multipart(form)
        .send()
        .map_err(|error| format!("cloud upload failed: {error}"))?;
    read_cloud_json(response)
}

fn picked_local_file(path: PathBuf) -> Result<PickedLocalFile, String> {
    let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;
    if !metadata.is_file() {
        return Err("not a file".to_string());
    }
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("file")
        .to_string();
    let content_type = infer_content_type_from_path(&path);
    let file_type = infer_chat_file_type(&name, &content_type);
    Ok(PickedLocalFile {
        path: path.to_string_lossy().to_string(),
        name,
        size_bytes: metadata.len(),
        content_type,
        file_type,
    })
}

fn infer_content_type_from_path(path: &Path) -> String {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match extension.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "mp4" => "video/mp4",
        "mov" => "video/quicktime",
        "webm" => "video/webm",
        "avi" => "video/x-msvideo",
        "mkv" => "video/x-matroska",
        "pdf" => "application/pdf",
        "doc" => "application/msword",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xls" => "application/vnd.ms-excel",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "ppt" => "application/vnd.ms-powerpoint",
        "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "txt" => "text/plain",
        "zip" => "application/zip",
        "rar" => "application/vnd.rar",
        "7z" => "application/x-7z-compressed",
        _ => "application/octet-stream",
    }
    .to_string()
}

fn infer_chat_file_type(name: &str, content_type: &str) -> String {
    let lower = name.to_ascii_lowercase();
    if content_type.starts_with("image/")
        || lower.ends_with(".png")
        || lower.ends_with(".jpg")
        || lower.ends_with(".jpeg")
        || lower.ends_with(".webp")
        || lower.ends_with(".gif")
        || lower.ends_with(".bmp")
    {
        return "image".to_string();
    }
    if content_type.starts_with("video/")
        || lower.ends_with(".mp4")
        || lower.ends_with(".mov")
        || lower.ends_with(".webm")
        || lower.ends_with(".avi")
        || lower.ends_with(".mkv")
    {
        return "video".to_string();
    }
    "file".to_string()
}

fn chat_upload_controls() -> &'static Mutex<HashMap<String, TransferControlState>> {
    CHAT_UPLOAD_CONTROLS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn register_transfer_control(task_id: &str) {
    if let Ok(mut controls) = chat_upload_controls().lock() {
        controls.insert(
            task_id.to_string(),
            TransferControlState {
                paused: false,
                canceled: false,
            },
        );
    }
}

fn unregister_transfer_control(task_id: &str) {
    if let Ok(mut controls) = chat_upload_controls().lock() {
        controls.remove(task_id);
    }
}

fn transfer_control_state(task_id: &str) -> TransferControlState {
    chat_upload_controls()
        .lock()
        .ok()
        .and_then(|controls| controls.get(task_id).cloned())
        .unwrap_or(TransferControlState {
            paused: false,
            canceled: false,
        })
}

fn wait_for_transfer_resume(
    app: &AppHandle,
    task_id: &str,
    file_name: &str,
    file_size: u64,
    uploaded_bytes: u64,
) -> Result<(), String> {
    loop {
        let state = transfer_control_state(task_id);
        if state.canceled {
            emit_transfer_event(
                app,
                task_id,
                json!({
                    "status": "canceled",
                    "fileName": file_name,
                    "fileSize": file_size,
                    "uploadedBytes": uploaded_bytes,
                }),
            );
            unregister_transfer_control(task_id);
            return Err("upload canceled".to_string());
        }
        if !state.paused {
            return Ok(());
        }
        emit_transfer_event(
            app,
            task_id,
            json!({
                "status": "paused",
                "fileName": file_name,
                "fileSize": file_size,
                "uploadedBytes": uploaded_bytes,
            }),
        );
        std::thread::sleep(Duration::from_millis(250));
    }
}

fn emit_transfer_event(app: &AppHandle, task_id: &str, payload: Value) {
    let mut event_payload = match payload {
        Value::Object(map) => map,
        _ => serde_json::Map::new(),
    };
    event_payload.insert("taskId".to_string(), Value::String(task_id.to_string()));
    let _ = app.emit(CHAT_TRANSFER_EVENT, Value::Object(event_payload));
}

fn cloud_client() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|error| format!("cloud client failed: {error}"))
}

fn cloud_url(path: &str) -> String {
    format!("{CLOUD_API_BASE_URL}{path}")
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|error| error.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 256 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

fn safe_cache_segment(value: &str) -> String {
    value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.') {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim_matches('_')
        .to_string()
}

fn safe_download_filename(value: &str) -> String {
    let name = value
        .trim()
        .chars()
        .map(|ch| {
            if ch.is_control() || matches!(ch, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*')
            {
                '_'
            } else {
                ch
            }
        })
        .collect::<String>()
        .trim_matches([' ', '.'])
        .to_string();
    if name.is_empty() {
        "download".to_string()
    } else {
        name
    }
}

fn unique_download_path(dir: &Path, filename: &str) -> PathBuf {
    let initial = dir.join(filename);
    if !initial.exists() {
        return initial;
    }
    let path = Path::new(filename);
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("download");
    let extension = path.extension().and_then(|value| value.to_str());
    for index in 1..1000 {
        let candidate_name = match extension {
            Some(extension) if !extension.is_empty() => {
                format!("{stem} ({index}).{extension}")
            }
            _ => format!("{stem} ({index})"),
        };
        let candidate = dir.join(candidate_name);
        if !candidate.exists() {
            return candidate;
        }
    }
    dir.join(format!("{stem}-{}", now_string()))
}

fn avatar_extension(value: &str) -> &'static str {
    let path = value
        .split('?')
        .next()
        .unwrap_or(value)
        .to_ascii_lowercase();
    if path.ends_with(".png") {
        "png"
    } else if path.ends_with(".webp") {
        "webp"
    } else if path.ends_with(".gif") {
        "gif"
    } else {
        "jpg"
    }
}

fn read_cloud_json<T: DeserializeOwned>(response: Response) -> Result<T, String> {
    let status = response.status();
    if !status.is_success() {
        let body = response.text().unwrap_or_default();
        let message = parse_cloud_error(&body).unwrap_or_else(|| {
            if body.trim().is_empty() {
                format!("cloud request failed: HTTP {status}")
            } else {
                format!("cloud request failed: {}", body.trim())
            }
        });
        return Err(message);
    }

    response
        .json::<T>()
        .map_err(|error| format!("cloud client failed: {error}"))
}

fn parse_cloud_error(body: &str) -> Option<String> {
    let value = serde_json::from_str::<Value>(body).ok()?;
    let detail = value.get("detail")?;
    match detail {
        Value::String(message) => Some(message.clone()),
        Value::Array(items) => Some(
            items
                .iter()
                .filter_map(|item| {
                    item.get("msg")
                        .and_then(Value::as_str)
                        .or_else(|| item.get("message").and_then(Value::as_str))
                })
                .collect::<Vec<_>>()
                .join("; "),
        )
        .filter(|message| !message.is_empty()),
        _ => Some(detail.to_string()),
    }
}

fn open_db(app: &AppHandle) -> Result<Connection, String> {
    let db_path = database_path(app)?;
    if let Some(parent) = db_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let conn = Connection::open(db_path).map_err(|error| error.to_string())?;
    init_schema(&conn)?;
    Ok(conn)
}

fn database_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    Ok(dir.join("teacher_schedule_widget.sqlite"))
}

fn init_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS app_meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS local_users (
          id TEXT PRIMARY KEY,
          phone TEXT UNIQUE,
          password_hash TEXT,
          password_salt TEXT,
          cloud_user_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          deleted_at TEXT
        );
        CREATE TABLE IF NOT EXISTS local_sessions (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          created_at TEXT NOT NULL,
          last_used_at TEXT NOT NULL,
          refresh_token TEXT
        );
        CREATE TABLE IF NOT EXISTS timetable_settings (
          id TEXT NOT NULL,
          owner_user_id TEXT NOT NULL,
          term_start_date TEXT NOT NULL,
          term_end_date TEXT NOT NULL,
          workday_mode TEXT NOT NULL,
          period_count INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          deleted_at TEXT,
          PRIMARY KEY (id, owner_user_id)
        );
        CREATE TABLE IF NOT EXISTS period_cards (
          id TEXT NOT NULL,
          owner_user_id TEXT NOT NULL,
          order_index INTEGER NOT NULL,
          label TEXT NOT NULL,
          start_time TEXT NOT NULL,
          end_time TEXT NOT NULL,
          style_json TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          deleted_at TEXT,
          PRIMARY KEY (id, owner_user_id)
        );
        CREATE TABLE IF NOT EXISTS course_cells (
          id TEXT NOT NULL,
          owner_user_id TEXT NOT NULL,
          period_id TEXT NOT NULL,
          weekday TEXT NOT NULL,
          title TEXT NOT NULL,
          secondary TEXT,
          hidden INTEGER NOT NULL DEFAULT 0,
          schedule_rule_json TEXT,
          base_color TEXT,
          style_json TEXT,
          col_span INTEGER,
          row_span INTEGER,
          merged_into TEXT,
          merge_direction TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          deleted_at TEXT,
          PRIMARY KEY (id, owner_user_id)
        );
        CREATE TABLE IF NOT EXISTS temporary_changes (
          id TEXT NOT NULL,
          owner_user_id TEXT NOT NULL,
          course_cell_id TEXT NOT NULL,
          type TEXT NOT NULL,
          dates_json TEXT NOT NULL,
          title TEXT,
          secondary TEXT,
          base_color TEXT,
          style_json TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          deleted_at TEXT,
          PRIMARY KEY (id, owner_user_id)
        );
        CREATE TABLE IF NOT EXISTS color_profiles (
          id TEXT NOT NULL,
          owner_user_id TEXT NOT NULL,
          color_name TEXT NOT NULL,
          color_value TEXT NOT NULL,
          sort_order INTEGER NOT NULL DEFAULT 0,
          is_preset INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL,
          deleted_at TEXT,
          PRIMARY KEY (id, owner_user_id)
        );
        CREATE TABLE IF NOT EXISTS device_preferences (
          device_id TEXT NOT NULL,
          owner_user_id TEXT NOT NULL,
          window_mode TEXT,
          widget_window_rect_json TEXT,
          settings_window_rect_json TEXT,
          auth_window_rect_json TEXT,
          card_settings_window_rect_json TEXT,
          toolbar_layout_mode TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (device_id, owner_user_id)
        );
        CREATE TABLE IF NOT EXISTS desktop_appearance_preferences (
          owner_user_id TEXT PRIMARY KEY,
          appearance_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sync_meta (
          owner_user_id TEXT PRIMARY KEY,
          cloud_user_id TEXT,
          device_id TEXT,
          last_synced_at TEXT,
          last_checked_at TEXT,
          last_synced_cloud_revision INTEGER,
          last_known_cloud_revision INTEGER,
          last_sync_error TEXT,
          sync_schema_version INTEGER NOT NULL DEFAULT 1
        );
        CREATE TABLE IF NOT EXISTS pending_sync_batches (
          batch_id TEXT PRIMARY KEY,
          owner_user_id TEXT NOT NULL,
          client_id TEXT NOT NULL,
          entity_diffs_json TEXT NOT NULL,
          source_action TEXT,
          client_created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sync_field_sequences (
          owner_user_id TEXT NOT NULL,
          entity TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          field_name TEXT NOT NULL,
          server_seq INTEGER NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (owner_user_id, entity, entity_id, field_name)
        );
        CREATE TABLE IF NOT EXISTS processed_server_changes (
          owner_user_id TEXT NOT NULL,
          client_id TEXT NOT NULL,
          server_seq INTEGER NOT NULL,
          processed_at TEXT NOT NULL,
          PRIMARY KEY (owner_user_id, client_id, server_seq)
        );
        CREATE TABLE IF NOT EXISTS local_file_candidates (
          owner_user_id TEXT NOT NULL,
          file_object_id TEXT NOT NULL,
          drive_node_id TEXT,
          source_type TEXT NOT NULL,
          local_path TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (owner_user_id, file_object_id, source_type, local_path)
        );
        INSERT OR IGNORE INTO app_meta (key, value) VALUES ('dataSchemaVersion', '1');
        INSERT OR IGNORE INTO app_meta (key, value) VALUES ('syncProtocolVersion', '1');
        ",
    )
    .map_err(|error| error.to_string())?;
    ensure_device_id(conn)?;
    migrate_desktop_entity_sync(conn)?;
    Ok(())
}

fn migrate_desktop_entity_sync(conn: &Connection) -> Result<(), String> {
    let current_version = get_meta(conn, "desktopEntitySyncVersion")?;
    if current_version.as_deref() == Some("6") {
        return Ok(());
    }

    conn.execute("DROP TABLE IF EXISTS pending_sync_ops", [])
        .map_err(|error| error.to_string())?;
    conn.execute("DROP TABLE IF EXISTS schedule_snapshots", [])
        .map_err(|error| error.to_string())?;
    conn.execute("DROP TABLE IF EXISTS sync_state", [])
        .map_err(|error| error.to_string())?;
    migrate_account_scoped_desktop_tables(conn)?;
    migrate_desktop_color_profiles_primary_key(conn)?;
    set_meta(conn, "desktopEntitySyncVersion", "6")
}

fn migrate_account_scoped_desktop_tables(conn: &Connection) -> Result<(), String> {
    migrate_timetable_settings_primary_key(conn)?;
    migrate_period_cards_primary_key(conn)?;
    migrate_course_cells_primary_key(conn)?;
    migrate_temporary_changes_primary_key(conn)
}

fn table_has_owner_scoped_primary_key(conn: &Connection, table_name: &str) -> Result<bool, String> {
    let current_sql: Option<String> = conn
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?1",
            params![table_name],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    Ok(current_sql
        .as_deref()
        .is_some_and(|sql| sql.contains("PRIMARY KEY (id, owner_user_id)")))
}

fn migrate_timetable_settings_primary_key(conn: &Connection) -> Result<(), String> {
    if table_has_owner_scoped_primary_key(conn, "timetable_settings")? {
        return Ok(());
    }

    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS timetable_settings_next (
          id TEXT NOT NULL,
          owner_user_id TEXT NOT NULL,
          term_start_date TEXT NOT NULL,
          term_end_date TEXT NOT NULL,
          workday_mode TEXT NOT NULL,
          period_count INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          deleted_at TEXT,
          PRIMARY KEY (id, owner_user_id)
        );
        ",
    )
    .map_err(|error| error.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO timetable_settings_next (
           id, owner_user_id, term_start_date, term_end_date, workday_mode,
           period_count, created_at, updated_at, deleted_at
         )
         SELECT id, owner_user_id, term_start_date, term_end_date, workday_mode,
                period_count, created_at, updated_at, deleted_at
         FROM timetable_settings",
        [],
    )
    .map_err(|error| error.to_string())?;
    conn.execute("DROP TABLE timetable_settings", [])
        .map_err(|error| error.to_string())?;
    conn.execute(
        "ALTER TABLE timetable_settings_next RENAME TO timetable_settings",
        [],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

fn migrate_period_cards_primary_key(conn: &Connection) -> Result<(), String> {
    if table_has_owner_scoped_primary_key(conn, "period_cards")? {
        return Ok(());
    }

    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS period_cards_next (
          id TEXT NOT NULL,
          owner_user_id TEXT NOT NULL,
          order_index INTEGER NOT NULL,
          label TEXT NOT NULL,
          start_time TEXT NOT NULL,
          end_time TEXT NOT NULL,
          style_json TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          deleted_at TEXT,
          PRIMARY KEY (id, owner_user_id)
        );
        ",
    )
    .map_err(|error| error.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO period_cards_next (
           id, owner_user_id, order_index, label, start_time, end_time,
           style_json, created_at, updated_at, deleted_at
         )
         SELECT id, owner_user_id, order_index, label, start_time, end_time,
                style_json, created_at, updated_at, deleted_at
         FROM period_cards",
        [],
    )
    .map_err(|error| error.to_string())?;
    conn.execute("DROP TABLE period_cards", [])
        .map_err(|error| error.to_string())?;
    conn.execute("ALTER TABLE period_cards_next RENAME TO period_cards", [])
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn migrate_course_cells_primary_key(conn: &Connection) -> Result<(), String> {
    if table_has_owner_scoped_primary_key(conn, "course_cells")? {
        return Ok(());
    }

    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS course_cells_next (
          id TEXT NOT NULL,
          owner_user_id TEXT NOT NULL,
          period_id TEXT NOT NULL,
          weekday TEXT NOT NULL,
          title TEXT NOT NULL,
          secondary TEXT,
          hidden INTEGER NOT NULL DEFAULT 0,
          schedule_rule_json TEXT,
          base_color TEXT,
          style_json TEXT,
          col_span INTEGER,
          row_span INTEGER,
          merged_into TEXT,
          merge_direction TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          deleted_at TEXT,
          PRIMARY KEY (id, owner_user_id)
        );
        ",
    )
    .map_err(|error| error.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO course_cells_next (
           id, owner_user_id, period_id, weekday, title, secondary, hidden,
           schedule_rule_json, base_color, style_json, col_span, row_span,
           merged_into, merge_direction, created_at, updated_at, deleted_at
         )
         SELECT id, owner_user_id, period_id, weekday, title, secondary, hidden,
                schedule_rule_json, base_color, style_json, col_span, row_span,
                merged_into, merge_direction, created_at, updated_at, deleted_at
         FROM course_cells",
        [],
    )
    .map_err(|error| error.to_string())?;
    conn.execute("DROP TABLE course_cells", [])
        .map_err(|error| error.to_string())?;
    conn.execute("ALTER TABLE course_cells_next RENAME TO course_cells", [])
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn migrate_temporary_changes_primary_key(conn: &Connection) -> Result<(), String> {
    if table_has_owner_scoped_primary_key(conn, "temporary_changes")? {
        return Ok(());
    }

    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS temporary_changes_next (
          id TEXT NOT NULL,
          owner_user_id TEXT NOT NULL,
          course_cell_id TEXT NOT NULL,
          type TEXT NOT NULL,
          dates_json TEXT NOT NULL,
          title TEXT,
          secondary TEXT,
          base_color TEXT,
          style_json TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          deleted_at TEXT,
          PRIMARY KEY (id, owner_user_id)
        );
        ",
    )
    .map_err(|error| error.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO temporary_changes_next (
           id, owner_user_id, course_cell_id, type, dates_json, title,
           secondary, base_color, style_json, created_at, updated_at, deleted_at
         )
         SELECT id, owner_user_id, course_cell_id, type, dates_json, title,
                secondary, base_color, style_json, created_at, updated_at, deleted_at
         FROM temporary_changes",
        [],
    )
    .map_err(|error| error.to_string())?;
    conn.execute("DROP TABLE temporary_changes", [])
        .map_err(|error| error.to_string())?;
    conn.execute(
        "ALTER TABLE temporary_changes_next RENAME TO temporary_changes",
        [],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

fn migrate_desktop_color_profiles_primary_key(conn: &Connection) -> Result<(), String> {
    if table_has_owner_scoped_primary_key(conn, "color_profiles")? {
        return Ok(());
    }

    let now = now_string();
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS color_profiles_next (
          id TEXT NOT NULL,
          owner_user_id TEXT NOT NULL,
          color_name TEXT NOT NULL,
          color_value TEXT NOT NULL,
          sort_order INTEGER NOT NULL DEFAULT 0,
          is_preset INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL,
          deleted_at TEXT,
          PRIMARY KEY (id, owner_user_id)
        );
        ",
    )
    .map_err(|error| error.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO color_profiles_next (
           id, owner_user_id, color_name, color_value, sort_order, is_preset, updated_at, deleted_at
         )
         SELECT id, owner_user_id, color_name, color_value, sort_order, is_preset, updated_at, deleted_at
         FROM color_profiles",
        [],
    )
    .map_err(|error| error.to_string())?;
    conn.execute("DROP TABLE color_profiles", [])
        .map_err(|error| error.to_string())?;
    conn.execute(
        "ALTER TABLE color_profiles_next RENAME TO color_profiles",
        [],
    )
    .map_err(|error| error.to_string())?;
    conn.execute(
        "UPDATE color_profiles SET updated_at = ?1 WHERE updated_at IS NULL OR updated_at = ''",
        params![now],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

fn ensure_default_user(conn: &Connection) -> Result<(), String> {
    let now = now_string();
    conn.execute(
        "INSERT OR IGNORE INTO local_users (id, phone, password_hash, password_salt, created_at, updated_at)
         VALUES (?1, NULL, NULL, NULL, ?2, ?2)",
        params![DEFAULT_USER_ID, now],
    )
    .map_err(|error| error.to_string())?;
    let active = get_meta(conn, "activeUserId")?;
    if active.is_none() {
        set_meta(conn, "activeUserId", DEFAULT_USER_ID)?;
    }
    Ok(())
}

fn ensure_device_id(conn: &Connection) -> Result<(), String> {
    if get_meta(conn, "deviceId")?.is_some() {
        return Ok(());
    }

    set_meta(conn, "deviceId", &format!("device_{}", random_token(20)))
}

fn load_account_state_from_conn(conn: &Connection) -> Result<LocalAccountState, String> {
    let owner_user_id = active_user_id(conn)?;
    update_last_used(conn, &owner_user_id)?;

    let user = conn
        .query_row(
            "SELECT id, phone, cloud_user_id FROM local_users WHERE id = ?1 AND deleted_at IS NULL",
            params![owner_user_id],
            |row| {
                let id: String = row.get(0)?;
                Ok(PublicUser {
                    is_default: id == DEFAULT_USER_ID,
                    id,
                    phone: row.get(1)?,
                    cloud_user_id: row.get(2)?,
                })
            },
        )
        .optional()
        .map_err(|error| error.to_string())?;

    let logged_in = user.as_ref().is_some_and(|item| !item.is_default);
    Ok(LocalAccountState {
        owner_user_id,
        logged_in,
        user: if logged_in { user } else { None },
    })
}

fn active_user_id(conn: &Connection) -> Result<String, String> {
    Ok(get_meta(conn, "activeUserId")?.unwrap_or_else(|| DEFAULT_USER_ID.to_string()))
}

fn activate_user(conn: &Connection, user_id: &str) -> Result<(), String> {
    set_meta(conn, "activeUserId", user_id)?;
    update_last_used(conn, user_id)
}

fn update_last_used(conn: &Connection, user_id: &str) -> Result<(), String> {
    let now = now_string();
    let session_id = format!("session_{}", user_id);
    conn.execute(
        "INSERT INTO local_sessions (id, user_id, created_at, last_used_at)
         VALUES (?1, ?2, ?3, ?3)
         ON CONFLICT(id) DO UPDATE SET user_id = excluded.user_id, last_used_at = excluded.last_used_at",
        params![session_id, user_id, now],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

fn insert_local_cloud_user(
    conn: &Connection,
    phone: &str,
    password: &str,
    cloud_user_id: &str,
    now: &str,
) -> Result<String, String> {
    let user_id = format!("local_user_{}", random_token(16));
    let (password_hash, password_salt) = password_hash_pair(password);
    conn.execute(
        "INSERT INTO local_users (id, phone, password_hash, password_salt, cloud_user_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
        params![
            user_id,
            phone,
            password_hash,
            password_salt,
            cloud_user_id,
            now
        ],
    )
    .map_err(|error| error.to_string())?;
    Ok(user_id)
}

fn update_local_user_cloud_auth(
    conn: &Connection,
    user_id: &str,
    phone: &str,
    password: &str,
    cloud_user_id: &str,
    now: &str,
) -> Result<(), String> {
    let (password_hash, password_salt) = password_hash_pair(password);
    conn.execute(
        "UPDATE local_users
         SET phone = ?2,
             password_hash = ?3,
             password_salt = ?4,
             cloud_user_id = ?5,
             updated_at = ?6
         WHERE id = ?1",
        params![
            user_id,
            phone,
            password_hash,
            password_salt,
            cloud_user_id,
            now
        ],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

fn password_hash_pair(password: &str) -> (Option<String>, Option<String>) {
    if password.is_empty() {
        return (None, None);
    }

    let salt = random_token(24);
    let hash = hash_password(password, &salt);
    (Some(hash), Some(salt))
}

fn save_session_token(conn: &Connection, user_id: &str, token: &str) -> Result<(), String> {
    let now = now_string();
    let session_id = format!("session_{}", user_id);
    conn.execute(
        "INSERT INTO local_sessions (id, user_id, created_at, last_used_at, refresh_token)
         VALUES (?1, ?2, ?3, ?3, ?4)
         ON CONFLICT(id) DO UPDATE SET
           user_id = excluded.user_id,
           last_used_at = excluded.last_used_at,
           refresh_token = excluded.refresh_token",
        params![session_id, user_id, now, token],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

fn clear_session_token(conn: &Connection, user_id: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE local_sessions SET refresh_token = NULL, last_used_at = ?2 WHERE user_id = ?1",
        params![user_id, now_string()],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

fn remember_local_file_candidate_for_user(
    conn: &Connection,
    owner_user_id: &str,
    file_object_id: &str,
    drive_node_id: Option<&str>,
    source_type: &str,
    local_path: &str,
) -> Result<(), String> {
    let file_object_id = file_object_id.trim();
    let source_type = source_type.trim();
    let local_path = local_path.trim();
    if file_object_id.is_empty() || source_type.is_empty() || local_path.is_empty() {
        return Ok(());
    }
    let drive_node_id = drive_node_id
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let now = now_string();
    conn.execute(
        "INSERT INTO local_file_candidates
           (owner_user_id, file_object_id, drive_node_id, source_type, local_path, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(owner_user_id, file_object_id, source_type, local_path)
         DO UPDATE SET drive_node_id = excluded.drive_node_id, updated_at = excluded.updated_at",
        params![
            owner_user_id,
            file_object_id,
            drive_node_id,
            source_type,
            local_path,
            now
        ],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

fn list_local_file_candidates_for_user(
    conn: &Connection,
    owner_user_id: &str,
    file_object_id: &str,
    drive_node_id: Option<&str>,
) -> Result<Vec<Value>, String> {
    let file_object_id = file_object_id.trim();
    if file_object_id.is_empty() {
        return Ok(Vec::new());
    }
    let drive_node_id = drive_node_id
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let mut statement = conn
        .prepare(
            "SELECT drive_node_id, source_type, local_path, updated_at
             FROM local_file_candidates
             WHERE owner_user_id = ?1
               AND file_object_id = ?2
               AND (?3 IS NULL OR drive_node_id IS NULL OR drive_node_id = ?3)
             ORDER BY
               CASE source_type
                 WHEN 'local_download' THEN 0
                 WHEN 'local_original' THEN 1
                 WHEN 'local_preview_cache' THEN 2
                 ELSE 3
               END,
               updated_at DESC",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(
            params![owner_user_id, file_object_id, drive_node_id],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            },
        )
        .map_err(|error| error.to_string())?;

    let mut candidates = Vec::new();
    for row in rows {
        let (drive_node_id, source_type, path, updated_at) =
            row.map_err(|error| error.to_string())?;
        if !Path::new(&path).is_file() {
            continue;
        }
        candidates.push(json!({
            "path": path,
            "sourceType": source_type,
            "driveNodeId": drive_node_id,
            "updatedAt": updated_at,
        }));
    }
    Ok(candidates)
}

fn upsert_sync_meta_cloud_user(
    conn: &Connection,
    owner_user_id: &str,
    cloud_user_id: &str,
) -> Result<(), String> {
    ensure_device_id(conn)?;
    let device_id = get_meta(conn, "deviceId")?.unwrap_or_else(|| {
        let fallback = format!("device_{}", random_token(20));
        let _ = set_meta(conn, "deviceId", &fallback);
        fallback
    });
    conn.execute(
        "INSERT INTO sync_meta (owner_user_id, cloud_user_id, device_id, sync_schema_version)
         VALUES (?1, ?2, ?3, 1)
         ON CONFLICT(owner_user_id) DO UPDATE SET
           cloud_user_id = excluded.cloud_user_id,
           device_id = COALESCE(device_id, excluded.device_id),
           sync_schema_version = 1",
        params![owner_user_id, cloud_user_id, device_id],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

fn copy_default_schedule_if_needed(conn: &Connection, user_id: &str) -> Result<(), String> {
    if user_id == DEFAULT_USER_ID {
        return Ok(());
    }

    if user_has_schedule_entities(conn, user_id)? {
        return Ok(());
    }

    if let Some(default_schedule) = load_schedule_from_entities(conn, DEFAULT_USER_ID)? {
        save_schedule_entities_without_pending(conn, user_id, &default_schedule)?;
        enqueue_schedule_bootstrap_ops(conn, user_id)?;
    }

    Ok(())
}

fn save_schedule_for_user(
    conn: &Connection,
    owner_user_id: &str,
    schedule: &Value,
    source_action: &str,
) -> Result<(), String> {
    let previous = load_schedule_from_entities(conn, owner_user_id)?;
    if owner_user_id != DEFAULT_USER_ID {
        enqueue_schedule_entity_diff_ops(
            conn,
            owner_user_id,
            previous.as_ref(),
            schedule,
            source_action,
        )?;
    }
    save_schedule_entities_without_pending(conn, owner_user_id, schedule)
}

fn load_sync_status_for_user(
    conn: &Connection,
    owner_user_id: &str,
) -> Result<LocalSyncStatus, String> {
    let pending_count = pending_ops_count(conn, owner_user_id)? as i64;
    let local_revision = pending_count;
    let last_sync_error: Option<String> = None;
    let sync_meta: Option<(
        Option<String>,
        Option<String>,
        Option<i64>,
        Option<i64>,
        Option<String>,
    )> = conn
        .query_row(
            "SELECT last_synced_at,
                    last_checked_at,
                    last_synced_cloud_revision,
                    last_known_cloud_revision,
                    last_sync_error
             FROM sync_meta
             WHERE owner_user_id = ?1",
            params![owner_user_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )
        .optional()
        .map_err(|error| error.to_string())?;

    let (
        last_synced_at,
        last_checked_at,
        last_synced_cloud_revision,
        last_known_cloud_revision,
        meta_sync_error,
    ) = sync_meta.unwrap_or((None, None, None, None, None));
    let cloud_revision = last_known_cloud_revision.map(|value| value.max(0) as u32);
    let last_synced_cloud_revision_u32 =
        last_synced_cloud_revision.map(|value| value.max(0) as u32);
    let has_remote_changes = false;
    let last_sync_error = last_sync_error.or(meta_sync_error);
    let has_pending_changes = pending_count > 0;

    Ok(LocalSyncStatus {
        owner_user_id: owner_user_id.to_string(),
        dirty_count: pending_count.max(0) as u32,
        local_revision: local_revision.max(0) as u32,
        cloud_revision,
        last_synced_cloud_revision: last_synced_cloud_revision_u32,
        last_synced_at,
        last_checked_at,
        last_sync_error,
        has_pending_changes,
        has_remote_changes,
        syncing: false,
        online: true,
        conflict: has_pending_changes && has_remote_changes,
    })
}

fn session_token(conn: &Connection, owner_user_id: &str) -> Result<String, String> {
    let token: Option<String> = conn
        .query_row(
            "SELECT refresh_token
             FROM local_sessions
             WHERE user_id = ?1 AND refresh_token IS NOT NULL
             ORDER BY last_used_at DESC
             LIMIT 1",
            params![owner_user_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    token.ok_or_else(|| "login expired, please sign in again".to_string())
}

fn sync_current_user_with_cloud(
    conn: &Connection,
    owner_user_id: &str,
    token: &str,
) -> Result<bool, String> {
    let device_id = sync_client_id(conn)?;
    let pending_ops = load_pending_ops(conn, owner_user_id)?;
    let last_revision =
        load_sync_meta_revision(conn, owner_user_id, "last_synced_cloud_revision")?.unwrap_or(0);
    let mut accepted = Vec::<String>::new();
    let mut changes = Vec::<ServerChange>::new();
    let mut latest_server_seq = last_revision;

    for batch in &pending_ops {
        let response = cloud_post_json("/sync/batch", token, batch.clone())?;
        let sync_response: SyncResponse = serde_json::from_value(response)
            .map_err(|error| format!("cloud request failed: {error}"))?;
        accepted.extend(sync_response.accepted_batch_ids);
        latest_server_seq = latest_server_seq.max(sync_response.latest_server_seq);
        changes.extend(sync_response.server_changes);
    }
    remove_accepted_ops(conn, owner_user_id, &accepted)?;

    let has_local_pending = pending_ops_count(conn, owner_user_id)? > 0;
    if last_revision == 0 && pending_ops.is_empty() {
        let snapshot = cloud_get_json("/sync/snapshot", token)?;
        let snapshot: SnapshotResponse = serde_json::from_value(snapshot)
            .map_err(|error| format!("cloud request failed: {error}"))?;
        latest_server_seq = latest_server_seq.max(snapshot.latest_server_seq);
        let has_remote_data = server_change_has_remote_data(&snapshot.snapshot);
        if has_remote_data {
            apply_server_changes_to_schedule(conn, owner_user_id, &[snapshot.snapshot])?;
        } else {
            enqueue_schedule_bootstrap_ops(conn, owner_user_id)?;
            if pending_ops_count(conn, owner_user_id)? > 0 {
                return sync_current_user_with_cloud(conn, owner_user_id, token);
            }
        }
    }

    let pulled = cloud_get_json(
        &format!(
            "/sync/changes?clientId={}&afterSeq={}",
            urlencoding::encode(&device_id),
            last_revision
        ),
        token,
    )?;
    let pulled: ChangesResponse =
        serde_json::from_value(pulled).map_err(|error| format!("cloud request failed: {error}"))?;
    latest_server_seq = latest_server_seq.max(pulled.latest_server_seq);
    changes.extend(pulled.server_changes);

    let applied = apply_server_changes_to_schedule(conn, owner_user_id, &changes)?;
    if !applied.is_empty() {
        ack_server_changes(conn, owner_user_id, token, &device_id, &applied)?;
    }
    let now = now_string();
    upsert_sync_meta_synced(conn, owner_user_id, &now, latest_server_seq)?;
    Ok(!changes.is_empty() || !has_local_pending)
}

fn sync_client_id(conn: &Connection) -> Result<String, String> {
    ensure_device_id(conn)?;
    get_meta(conn, "deviceId")?.ok_or_else(|| "missing device id".to_string())
}

fn pending_ops_count(conn: &Connection, owner_user_id: &str) -> Result<u32, String> {
    let value: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM pending_sync_batches WHERE owner_user_id = ?1",
            params![owner_user_id],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    Ok(value.max(0) as u32)
}

fn load_pending_ops(conn: &Connection, owner_user_id: &str) -> Result<Vec<Value>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT batch_id,
                    client_id,
                    entity_diffs_json,
                    source_action,
                    client_created_at
             FROM pending_sync_batches
             WHERE owner_user_id = ?1
             ORDER BY client_created_at ASC",
        )
        .map_err(|error| error.to_string())?;
    let rows = stmt
        .query_map(params![owner_user_id], |row| {
            let payload_raw: String = row.get(2)?;
            let payload = serde_json::from_str::<Value>(&payload_raw).unwrap_or(Value::Null);
            Ok(json!({
                "batchId": row.get::<_, String>(0)?,
                "clientId": row.get::<_, String>(1)?,
                "entityDiffs": payload,
                "sourceAction": row.get::<_, Option<String>>(3)?,
            }))
        })
        .map_err(|error| error.to_string())?;
    let mut ops = Vec::<Value>::new();
    let current_client_id = sync_client_id(conn)?;
    for row in rows {
        let mut op = row.map_err(|error| error.to_string())?;
        op["clientId"] = json!(current_client_id);
        ops.push(op);
    }
    Ok(ops)
}

async fn run_realtime_sync_loop(
    app: AppHandle,
    owner_user_id: String,
    token: String,
    device_id: String,
    generation: u64,
) {
    use futures_util::StreamExt;
    use tokio_tungstenite::{connect_async, tungstenite::Message};

    let mut attempt = 0usize;
    loop {
        if REALTIME_SYNC_GENERATION.load(AtomicOrdering::SeqCst) != generation {
            return;
        }

        let url = format!(
            "{}/ws/sync?token={}&clientId={}",
            CLOUD_API_BASE_URL
                .replace("https://", "wss://")
                .replace("http://", "ws://"),
            urlencoding::encode(&token),
            urlencoding::encode(&device_id)
        );

        match connect_async(&url).await {
            Ok((mut stream, response)) => {
                println!(
                    "sync websocket connected owner_user_id={owner_user_id} client_id={device_id} status={}",
                    response.status()
                );
                attempt = 0;
                run_blocking_sync(
                    app.clone(),
                    owner_user_id.clone(),
                    token.clone(),
                    "websocket-connect",
                )
                .await;
                while let Some(message) = stream.next().await {
                    if REALTIME_SYNC_GENERATION.load(AtomicOrdering::SeqCst) != generation {
                        return;
                    }
                    let Ok(message) = message else {
                        break;
                    };
                    match message {
                        Message::Text(text) => {
                            let Ok(value) = serde_json::from_str::<Value>(&text) else {
                                continue;
                            };
                            if value.get("type").and_then(Value::as_str) != Some("serverChange") {
                                continue;
                            }
                            let Some(change_value) = value.get("change").cloned() else {
                                continue;
                            };
                            if let Ok(change) = serde_json::from_value::<ServerChange>(change_value)
                            {
                                println!(
                                    "sync websocket received serverSeq={} client_id={device_id}",
                                    change.server_seq
                                );
                                run_blocking_apply_pushed_change(
                                    app.clone(),
                                    owner_user_id.clone(),
                                    token.clone(),
                                    device_id.clone(),
                                    change,
                                )
                                .await;
                            }
                        }
                        Message::Close(frame) => {
                            println!("sync websocket close frame={frame:?}");
                            break;
                        }
                        _ => {}
                    }
                }
                println!("sync websocket disconnected owner_user_id={owner_user_id}");
                run_blocking_sync(
                    app.clone(),
                    owner_user_id.clone(),
                    token.clone(),
                    "websocket-disconnect",
                )
                .await;
            }
            Err(error) => {
                println!("sync websocket connect failed: {error}");
            }
        }

        let delay = realtime_retry_delay(attempt);
        attempt = attempt.saturating_add(1);
        tokio::time::sleep(delay).await;
    }
}

async fn run_blocking_sync(
    app: AppHandle,
    owner_user_id: String,
    token: String,
    reason: &'static str,
) {
    match tauri::async_runtime::spawn_blocking(move || {
        let conn = open_db(&app)?;
        sync_current_user_with_cloud(&conn, &owner_user_id, &token)
    })
    .await
    {
        Ok(Ok(changed)) => {
            println!("sync blocking pull completed reason={reason} changed={changed}");
        }
        Ok(Err(error)) => {
            println!("sync blocking pull failed reason={reason} error={error}");
        }
        Err(error) => {
            println!("sync blocking pull task failed reason={reason} error={error}");
        }
    }
}

async fn run_blocking_apply_pushed_change(
    app: AppHandle,
    owner_user_id: String,
    token: String,
    device_id: String,
    change: ServerChange,
) {
    let server_seq = change.server_seq;
    match tauri::async_runtime::spawn_blocking(move || {
        apply_pushed_server_change(&app, &owner_user_id, &token, &device_id, change)
    })
    .await
    {
        Ok(Ok(())) => {
            println!("sync pushed change applied serverSeq={server_seq}");
        }
        Ok(Err(error)) => {
            println!("sync pushed change failed serverSeq={server_seq} error={error}");
        }
        Err(error) => {
            println!("sync pushed change task failed serverSeq={server_seq} error={error}");
        }
    }
}

async fn run_chat_realtime_loop(app: AppHandle, token: String, device_id: String, generation: u64) {
    use futures_util::StreamExt;
    use tokio_tungstenite::{connect_async, tungstenite::Message};

    let mut attempt = 0usize;
    loop {
        if CHAT_REALTIME_GENERATION.load(AtomicOrdering::SeqCst) != generation {
            return;
        }

        let url = format!(
            "{}/ws/chat?token={}&clientId={}",
            CLOUD_API_BASE_URL
                .replace("https://", "wss://")
                .replace("http://", "ws://"),
            urlencoding::encode(&token),
            urlencoding::encode(&device_id)
        );

        match connect_async(&url).await {
            Ok((mut stream, response)) => {
                println!(
                    "chat websocket connected client_id={device_id} status={}",
                    response.status()
                );
                attempt = 0;
                while let Some(message) = stream.next().await {
                    if CHAT_REALTIME_GENERATION.load(AtomicOrdering::SeqCst) != generation {
                        return;
                    }
                    let Ok(message) = message else {
                        break;
                    };
                    match message {
                        Message::Text(text) => {
                            let Ok(value) = serde_json::from_str::<Value>(&text) else {
                                continue;
                            };
                            match value.get("event").and_then(Value::as_str) {
                                Some("message.new") => emit_chat_event(&app, value),
                                Some("message.revoked") => emit_chat_revoked_event(&app, value),
                                Some("message.deleted") => emit_chat_deleted_event(&app, value),
                                Some("profile.updated") => emit_profile_event(&app, value),
                                Some("friend.request.created")
                                | Some("friend.request.accepted")
                                | Some("friend.request.rejected") => {
                                    emit_friend_request_event(&app, value)
                                }
                                Some("group.created")
                                | Some("group.updated")
                                | Some("group.announcement.updated")
                                | Some("group.member.added")
                                | Some("group.member.removed")
                                | Some("group.member.role_changed")
                                | Some("group.join_request.created")
                                | Some("group.join_request.handled")
                                | Some("group.dissolved") => emit_group_event(&app, value),
                                _ => {}
                            }
                        }
                        Message::Close(frame) => {
                            println!("chat websocket close frame={frame:?}");
                            break;
                        }
                        _ => {}
                    }
                }
                println!("chat websocket disconnected client_id={device_id}");
            }
            Err(error) => {
                println!("chat websocket connect failed: {error}");
            }
        }

        let delay = realtime_retry_delay(attempt);
        attempt = attempt.saturating_add(1);
        tokio::time::sleep(delay).await;
    }
}

fn emit_chat_event(app: &AppHandle, payload: Value) {
    if let Some(window) = app.get_webview_window("chat") {
        let _ = window.emit(CHAT_MESSAGE_NEW_EVENT, payload.clone());
    }
    let _ = app.emit(CHAT_MESSAGE_NEW_EVENT, payload);
}

fn emit_chat_revoked_event(app: &AppHandle, payload: Value) {
    if let Some(window) = app.get_webview_window("chat") {
        let _ = window.emit(CHAT_MESSAGE_REVOKED_EVENT, payload.clone());
    }
    let _ = app.emit(CHAT_MESSAGE_REVOKED_EVENT, payload);
}

fn emit_chat_deleted_event(app: &AppHandle, value: Value) {
    let payload = value.get("payload").cloned().unwrap_or_else(|| json!({}));
    emit_chat_deleted_payload(app, payload);
}

fn emit_chat_deleted_payload(app: &AppHandle, payload: Value) {
    if let Some(window) = app.get_webview_window("chat") {
        let _ = window.emit(CHAT_MESSAGE_DELETED_EVENT, payload.clone());
    }
    if let Some(window) = app.get_webview_window("chat-history") {
        let _ = window.emit(CHAT_MESSAGE_DELETED_EVENT, payload.clone());
    }
    let _ = app.emit(CHAT_MESSAGE_DELETED_EVENT, payload);
}

fn emit_profile_event(app: &AppHandle, value: Value) {
    let payload = value.get("payload").cloned().unwrap_or_else(|| json!({}));
    if let Some(window) = app.get_webview_window("chat") {
        let _ = window.emit(PROFILE_UPDATED_EVENT, payload.clone());
    }
    if let Some(window) = app.get_webview_window("profile-edit") {
        let _ = window.emit(PROFILE_UPDATED_EVENT, payload.clone());
    }
    if let Some(window) = app.get_webview_window("friend-profile") {
        let _ = window.emit(PROFILE_UPDATED_EVENT, payload.clone());
    }
    let _ = app.emit(PROFILE_UPDATED_EVENT, payload);
}

fn emit_friend_request_event(app: &AppHandle, value: Value) {
    let event_name = value
        .get("event")
        .and_then(Value::as_str)
        .unwrap_or("friend.request.updated")
        .to_string();
    let payload = value.get("payload").cloned().unwrap_or_else(|| json!({}));
    let event_payload = json!({
        "event": event_name,
        "payload": payload,
    });
    if let Some(window) = app.get_webview_window("chat") {
        let _ = window.emit(FRIEND_REQUEST_EVENT, event_payload.clone());
    }
    if let Some(window) = app.get_webview_window("profile-search") {
        let _ = window.emit(FRIEND_REQUEST_EVENT, event_payload.clone());
    }
    if let Some(window) = app.get_webview_window("friend-profile") {
        let _ = window.emit(FRIEND_REQUEST_EVENT, event_payload.clone());
    }
    let _ = app.emit(FRIEND_REQUEST_EVENT, event_payload);
}

fn emit_group_event(app: &AppHandle, value: Value) {
    let event_name = value
        .get("event")
        .and_then(Value::as_str)
        .unwrap_or("group.updated")
        .to_string();
    let payload = value.get("payload").cloned().unwrap_or_else(|| json!({}));
    let event_payload = json!({
        "event": event_name,
        "payload": payload,
    });
    if let Some(window) = app.get_webview_window("chat") {
        let _ = window.emit(CHAT_GROUP_EVENT, event_payload.clone());
    }
    if let Some(window) = app.get_webview_window("group-announcements") {
        let _ = window.emit(CHAT_GROUP_EVENT, event_payload.clone());
    }
    let _ = app.emit(CHAT_GROUP_EVENT, event_payload);
}

fn realtime_retry_delay(attempt: usize) -> Duration {
    match attempt {
        0 => Duration::from_secs(5),
        1 => Duration::from_secs(15),
        2 => Duration::from_secs(30),
        3 => Duration::from_secs(60),
        _ => Duration::from_secs(300),
    }
}

fn apply_pushed_server_change(
    app: &AppHandle,
    owner_user_id: &str,
    token: &str,
    device_id: &str,
    change: ServerChange,
) -> Result<(), String> {
    let conn = open_db(app)?;
    let last_revision =
        load_sync_meta_revision(&conn, owner_user_id, "last_synced_cloud_revision")?.unwrap_or(0);
    if change.server_seq <= last_revision {
        return Ok(());
    }
    let server_seq = change.server_seq;
    let applied = apply_server_changes_to_schedule(&conn, owner_user_id, &[change])?;
    ack_server_changes(&conn, owner_user_id, token, device_id, &applied)?;
    let now = now_string();
    upsert_sync_meta_synced(&conn, owner_user_id, &now, server_seq)?;
    let payload = json!({ "serverSeq": server_seq });
    if let Some(window) = app.get_webview_window("widget") {
        let _ = window.emit(SYNC_SERVER_CHANGE_EVENT, payload.clone());
    }
    let _ = app.emit(SYNC_SERVER_CHANGE_EVENT, payload);
    println!("sync websocket applied serverSeq={server_seq}");
    Ok(())
}

fn server_change_has_remote_data(change: &ServerChange) -> bool {
    change.entity_diffs.iter().any(|diff| {
        let entity = diff.get("entity").and_then(Value::as_str).unwrap_or("");
        if !matches!(
            entity,
            "courseCard" | "periodCard" | "termSettings" | "temporaryChange" | "reminder"
        ) {
            return false;
        }
        let values = diff.get("values").unwrap_or(&Value::Null);
        if values
            .get("deleted")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            return false;
        }
        if entity == "periodCard" {
            let has_name = get_str_multi(values, &["periodName", "name"])
                .is_some_and(|value| !value.trim().is_empty());
            let has_start = get_i64_any(values, "startMinutes", "start_minutes").unwrap_or(0) > 0;
            let has_end = get_i64_any(values, "endMinutes", "end_minutes").unwrap_or(0) > 0;
            return has_name || has_start || has_end;
        }
        true
    })
}

fn remove_accepted_ops(
    conn: &Connection,
    owner_user_id: &str,
    accepted: &[String],
) -> Result<(), String> {
    for batch_id in accepted {
        conn.execute(
            "DELETE FROM pending_sync_batches WHERE owner_user_id = ?1 AND batch_id = ?2",
            params![owner_user_id, batch_id],
        )
        .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[derive(Default)]
struct ScheduleSyncEntities {
    schedule: Option<Value>,
    periods: HashMap<String, Value>,
    colors: HashMap<String, Value>,
    courses: HashMap<String, Value>,
    layout_preserved_course_ids: HashSet<String>,
    temporary_changes: HashMap<String, Value>,
}

fn enqueue_schedule_bootstrap_ops(conn: &Connection, owner_user_id: &str) -> Result<(), String> {
    let Some(schedule) = load_schedule_from_entities(conn, owner_user_id)? else {
        return Ok(());
    };
    let previous = ScheduleSyncEntities::default();
    let next = extract_schedule_sync_entities(&schedule);
    enqueue_schedule_entity_ops(conn, owner_user_id, &previous, &next, "desktop.bootstrap")
}

fn enqueue_schedule_entity_diff_ops(
    conn: &Connection,
    owner_user_id: &str,
    previous_schedule: Option<&Value>,
    next_schedule: &Value,
    source_action: &str,
) -> Result<(), String> {
    let previous = previous_schedule
        .map(extract_schedule_sync_entities)
        .unwrap_or_default();
    let next = extract_schedule_sync_entities(next_schedule);
    enqueue_schedule_entity_ops(conn, owner_user_id, &previous, &next, source_action)
}

fn enqueue_schedule_entity_ops(
    conn: &Connection,
    owner_user_id: &str,
    previous: &ScheduleSyncEntities,
    next: &ScheduleSyncEntities,
    source_action: &str,
) -> Result<(), String> {
    let device_id = sync_client_id(conn)?;
    let mut diffs = Vec::<Value>::new();

    if previous.schedule != next.schedule {
        if let Some(payload) = &next.schedule {
            diffs.push(entity_diff("termSettings", "default", payload.clone()));
        }
    }

    enqueue_entity_map_diff(
        &mut diffs,
        "periodCard",
        &previous.periods,
        &next.periods,
        |entity_id| {
            let period_id = entity_id.parse::<i64>().unwrap_or(0);
            json!({
                "periodId": period_id,
                "deleted": true,
            })
        },
        |_| false,
    )?;
    enqueue_entity_map_diff(
        &mut diffs,
        "colorProfile",
        &previous.colors,
        &next.colors,
        |entity_id| json!({ "colorId": entity_id, "deleted": true }),
        |_| false,
    )?;
    enqueue_entity_map_diff(
        &mut diffs,
        "courseCard",
        &previous.courses,
        &next.courses,
        |entity_id| empty_course_cloud_payload(entity_id),
        |entity_id| next.layout_preserved_course_ids.contains(entity_id),
    )?;
    enqueue_entity_map_diff(
        &mut diffs,
        "temporaryChange",
        &previous.temporary_changes,
        &next.temporary_changes,
        |entity_id| json!({ "temporaryChangeId": entity_id, "deleted": true }),
        |_| false,
    )?;

    if !diffs.is_empty() {
        enqueue_batch(conn, owner_user_id, &device_id, diffs, source_action)?;
    }

    Ok(())
}

fn enqueue_entity_map_diff<F, S>(
    diffs: &mut Vec<Value>,
    entity: &str,
    previous: &HashMap<String, Value>,
    next: &HashMap<String, Value>,
    delete_payload: F,
    skip_delete: S,
) -> Result<(), String>
where
    F: Fn(&str) -> Value,
    S: Fn(&str) -> bool,
{
    for (entity_id, payload) in next {
        if previous.get(entity_id) != Some(payload) {
            diffs.push(entity_diff(entity, entity_id, payload.clone()));
        }
    }

    for entity_id in previous.keys() {
        if !next.contains_key(entity_id) && !skip_delete(entity_id) {
            diffs.push(entity_diff(entity, entity_id, delete_payload(entity_id)));
        }
    }

    Ok(())
}

fn extract_schedule_sync_entities(schedule: &Value) -> ScheduleSyncEntities {
    let (term_start, term_end) = infer_term_range(schedule);
    let visible_days = schedule
        .get("days")
        .and_then(Value::as_array)
        .map(|items| items.len().clamp(1, 7))
        .unwrap_or(5);
    let mut entities = ScheduleSyncEntities {
        schedule: Some(json!({
            "termStartDate": term_start.clone(),
            "termEndDate": term_end.clone(),
            "visibleDays": visible_days,
            "workdayMode": workday_mode_from_visible_days(visible_days),
            "termUserDefined": true,
            "schemaVersion": 1,
        })),
        ..ScheduleSyncEntities::default()
    };

    for (row_index, row) in schedule_rows(schedule).iter().enumerate() {
        let period_id = period_id_from_row(row, row_index);
        let period = row.get("period").unwrap_or(&Value::Null);
        let (start_minutes, end_minutes) =
            parse_time_range(period.get("time").and_then(Value::as_str).unwrap_or(""));
        entities.periods.insert(
            period_id.to_string(),
            json!({
                "periodId": period_id,
                "periodName": period.get("label").and_then(Value::as_str).unwrap_or(""),
                "startMinutes": start_minutes,
                "endMinutes": end_minutes,
                "sortOrder": period_id,
            }),
        );

        let Some(courses) = row.get("courses").and_then(Value::as_object) else {
            continue;
        };
        for (weekday, course) in courses {
            let Some(week_day) = weekday_to_number(weekday) else {
                continue;
            };
            let course_id = course_card_id(week_day, period_id);
            if course.get("mergedInto").and_then(Value::as_str).is_some() {
                entities
                    .layout_preserved_course_ids
                    .insert(course_id.clone());
                continue;
            }
            if !is_syncable_course(course) {
                continue;
            }
            entities.courses.insert(
                course_id.clone(),
                course_to_cloud_payload(
                    course,
                    &course_id,
                    week_day,
                    period_id,
                    &term_start,
                    &term_end,
                ),
            );
            if let Some(color) = course
                .get("style")
                .and_then(|style| style.get("baseColor"))
                .and_then(Value::as_str)
            {
                insert_color_profile_entity(&mut entities.colors, color);
            }

            for change in course
                .get("temporaryChanges")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                for payload in
                    temporary_change_to_cloud_payloads(change, &course_id, week_day, period_id)
                {
                    if let Some(entity_id) = payload.get("id").and_then(Value::as_str) {
                        if let Some(color) = get_str_any(
                            &payload,
                            "replacementColorValue",
                            "replacement_color_value",
                        ) {
                            insert_argb_color_profile_entity(&mut entities.colors, color);
                        }
                        entities
                            .temporary_changes
                            .insert(entity_id.to_string(), payload);
                    }
                }
            }
        }
    }

    entities
}

fn period_id_from_row(row: &Value, row_index: usize) -> i64 {
    row.get("id")
        .and_then(Value::as_str)
        .and_then(|id| id.trim_start_matches('p').parse::<i64>().ok())
        .unwrap_or((row_index + 1) as i64)
}

fn course_card_id(week_day: i64, period_id: i64) -> String {
    format!("courseCard_{week_day}_{period_id}")
}

fn parse_course_card_id(entity_id: &str) -> Option<(i64, i64)> {
    let mut parts = entity_id.split('_');
    if parts.next()? != "courseCard" {
        return None;
    }
    let week_day = parts.next()?.parse::<i64>().ok()?;
    let period_id = parts.next()?.parse::<i64>().ok()?;
    Some((week_day, period_id))
}

fn insert_color_profile_entity(colors: &mut HashMap<String, Value>, hex_color: &str) {
    let color_value = hex_color_to_argb(hex_color);
    insert_argb_color_profile_entity(colors, &color_value);
}

fn insert_argb_color_profile_entity(colors: &mut HashMap<String, Value>, color_value: &str) {
    let normalized = hex_color_to_argb(color_value);
    if preset_color_id_from_argb(&normalized).is_some() {
        return;
    }
    let id = format!("custom_{normalized}");
    colors.entry(id.clone()).or_insert_with(|| {
        json!({
            "id": id,
            "colorName": format!("Custom {normalized}"),
            "colorValue": normalized,
            "sortOrder": 0,
            "isPreset": false,
        })
    });
}

fn entity_diff(entity: &str, entity_id: &str, values: Value) -> Value {
    json!({
        "entity": entity,
        "id": entity_id,
        "values": values,
    })
}

fn empty_course_cloud_payload(entity_id: &str) -> Value {
    let (week_day, period_id) = parse_course_card_id(entity_id).unwrap_or((1, 1));
    json!({
        "courseCardId": entity_id,
        "courseName": "",
        "auxiliaryInfo": "",
        "weekDay": week_day,
        "periodId": period_id,
        "colorId": "red",
        "colorValue": "FFFF3B30",
        "weekParity": "all",
        "startDate": Value::Null,
        "endDate": Value::Null,
    })
}

fn enqueue_batch(
    conn: &Connection,
    owner_user_id: &str,
    device_id: &str,
    entity_diffs: Vec<Value>,
    source_action: &str,
) -> Result<(), String> {
    let now = now_string();
    let batch_id = make_batch_id(device_id);
    conn.execute(
        "INSERT OR IGNORE INTO pending_sync_batches (
           batch_id,
           owner_user_id,
           client_id,
           entity_diffs_json,
           source_action,
           client_created_at
         )
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            batch_id,
            owner_user_id,
            device_id,
            serde_json::to_string(&entity_diffs).map_err(|error| error.to_string())?,
            source_action,
            now
        ],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

fn make_batch_id(device_id: &str) -> String {
    format!("{device_id}_batch_{}_{}", now_string(), random_token(12))
}

fn user_has_schedule_entities(conn: &Connection, owner_user_id: &str) -> Result<bool, String> {
    let count: i64 = conn
        .query_row(
            "SELECT
               (SELECT COUNT(*) FROM timetable_settings WHERE owner_user_id = ?1 AND deleted_at IS NULL) +
               (SELECT COUNT(*) FROM period_cards WHERE owner_user_id = ?1 AND deleted_at IS NULL) +
               (SELECT COUNT(*) FROM course_cells WHERE owner_user_id = ?1 AND deleted_at IS NULL)",
            params![owner_user_id],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    Ok(count > 0)
}

fn save_schedule_entities_without_pending(
    conn: &Connection,
    owner_user_id: &str,
    schedule: &Value,
) -> Result<(), String> {
    let now = now_string();
    conn.execute(
        "DELETE FROM temporary_changes WHERE owner_user_id = ?1",
        params![owner_user_id],
    )
    .map_err(|error| error.to_string())?;
    conn.execute(
        "DELETE FROM course_cells WHERE owner_user_id = ?1",
        params![owner_user_id],
    )
    .map_err(|error| error.to_string())?;
    conn.execute(
        "DELETE FROM period_cards WHERE owner_user_id = ?1",
        params![owner_user_id],
    )
    .map_err(|error| error.to_string())?;
    conn.execute(
        "DELETE FROM timetable_settings WHERE owner_user_id = ?1",
        params![owner_user_id],
    )
    .map_err(|error| error.to_string())?;

    let (term_start, term_end) = infer_term_range(schedule);
    let visible_days = schedule
        .get("days")
        .and_then(Value::as_array)
        .map(|items| items.len().clamp(1, 7))
        .unwrap_or(5);
    conn.execute(
        "INSERT INTO timetable_settings (
           id, owner_user_id, term_start_date, term_end_date, workday_mode,
           period_count, created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
        params![
            "schedule",
            owner_user_id,
            term_start,
            term_end,
            workday_mode_from_visible_days(visible_days),
            schedule_rows(schedule).len() as i64,
            now
        ],
    )
    .map_err(|error| error.to_string())?;

    for (row_index, row) in schedule_rows(schedule).iter().enumerate() {
        let period_id = period_id_from_row(row, row_index);
        let period = row.get("period").unwrap_or(&Value::Null);
        let (start_minutes, end_minutes) =
            parse_time_range(period.get("time").and_then(Value::as_str).unwrap_or(""));
        conn.execute(
            "INSERT INTO period_cards (
               id, owner_user_id, order_index, label, start_time, end_time,
               style_json, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
            params![
                format!("p{period_id}"),
                owner_user_id,
                period_id,
                period.get("label").and_then(Value::as_str).unwrap_or(""),
                format_time_minutes(start_minutes),
                format_time_minutes(end_minutes),
                serde_json::to_string(period.get("style").unwrap_or(&Value::Null))
                    .map_err(|error| error.to_string())?,
                now
            ],
        )
        .map_err(|error| error.to_string())?;

        let Some(courses) = row.get("courses").and_then(Value::as_object) else {
            continue;
        };
        for (weekday, course) in courses {
            let course_id = course
                .get("id")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .unwrap_or_else(|| {
                    course_card_id(weekday_to_number(weekday).unwrap_or(1), period_id)
                });
            let style = course.get("style").unwrap_or(&Value::Null);
            conn.execute(
                "INSERT INTO course_cells (
                   id, owner_user_id, period_id, weekday, title, secondary,
                   hidden, schedule_rule_json, base_color, style_json,
                   col_span, row_span, merged_into, merge_direction,
                   created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?15)",
                params![
                    course_id,
                    owner_user_id,
                    format!("p{period_id}"),
                    weekday,
                    course.get("title").and_then(Value::as_str).unwrap_or(""),
                    course.get("room").and_then(Value::as_str).unwrap_or(""),
                    if course
                        .get("hidden")
                        .and_then(Value::as_bool)
                        .unwrap_or(false)
                    {
                        1
                    } else {
                        0
                    },
                    serde_json::to_string(course.get("scheduleRule").unwrap_or(&Value::Null))
                        .map_err(|error| error.to_string())?,
                    style.get("baseColor").and_then(Value::as_str).unwrap_or(""),
                    serde_json::to_string(style).map_err(|error| error.to_string())?,
                    course.get("colSpan").and_then(Value::as_i64).unwrap_or(1),
                    course.get("rowSpan").and_then(Value::as_i64).unwrap_or(1),
                    course.get("mergedInto").and_then(Value::as_str),
                    course.get("mergeDirection").and_then(Value::as_str),
                    now
                ],
            )
            .map_err(|error| error.to_string())?;

            for change in course
                .get("temporaryChanges")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                let change_id = change.get("id").and_then(Value::as_str).unwrap_or("");
                if change_id.is_empty() {
                    continue;
                }
                conn.execute(
                    "INSERT INTO temporary_changes (
                       id, owner_user_id, course_cell_id, type, dates_json,
                       title, secondary, base_color, style_json, created_at, updated_at
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)",
                    params![
                        change_id,
                        owner_user_id,
                        course.get("id").and_then(Value::as_str).unwrap_or(""),
                        change
                            .get("type")
                            .and_then(Value::as_str)
                            .unwrap_or("cancel"),
                        serde_json::to_string(change.get("dates").unwrap_or(&Value::Array(vec![])))
                            .map_err(|error| error.to_string())?,
                        change
                            .get("replaceTitle")
                            .or_else(|| change.get("title"))
                            .and_then(Value::as_str)
                            .unwrap_or(""),
                        change
                            .get("replaceSecondary")
                            .or_else(|| change.get("subtitle"))
                            .and_then(Value::as_str)
                            .unwrap_or(""),
                        change
                            .get("replaceColor")
                            .or_else(|| change.get("color"))
                            .and_then(Value::as_str)
                            .unwrap_or(""),
                        serde_json::to_string(change.get("style").unwrap_or(&Value::Null))
                            .map_err(|error| error.to_string())?,
                        now
                    ],
                )
                .map_err(|error| error.to_string())?;
            }
        }
    }
    Ok(())
}

fn load_schedule_from_entities(
    conn: &Connection,
    owner_user_id: &str,
) -> Result<Option<Value>, String> {
    let settings: Option<(String, String, String)> = conn
        .query_row(
            "SELECT term_start_date, term_end_date, workday_mode
             FROM timetable_settings
             WHERE owner_user_id = ?1 AND deleted_at IS NULL
             ORDER BY updated_at DESC
             LIMIT 1",
            params![owner_user_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let (term_start, term_end, workday_mode) = settings.unwrap_or_else(|| {
        (
            DEFAULT_TERM_START.to_string(),
            DEFAULT_TERM_END.to_string(),
            "MON_FRI".to_string(),
        )
    });
    let visible_days = visible_days_from_workday_mode(&workday_mode);

    let mut stmt = conn
        .prepare(
            "SELECT id, order_index, label, start_time, end_time, style_json
             FROM period_cards
             WHERE owner_user_id = ?1 AND deleted_at IS NULL
             ORDER BY start_time ASC, order_index ASC",
        )
        .map_err(|error| error.to_string())?;
    let period_rows = stmt
        .query_map(params![owner_user_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, Option<String>>(5)?,
            ))
        })
        .map_err(|error| error.to_string())?;

    let mut rows = Vec::<Value>::new();
    for row in period_rows {
        let (period_pk, order_index, label, start_time, end_time, style_raw) =
            row.map_err(|error| error.to_string())?;
        let period_id = period_pk
            .trim_start_matches('p')
            .parse::<i64>()
            .unwrap_or(order_index);
        let style = style_raw
            .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
            .unwrap_or_else(|| cloud_style_from_color_id(None, &HashMap::new()));
        rows.push(json!({
            "id": period_pk,
            "period": {
                "id": format!("p{period_id}"),
                "label": label,
                "time": format!("{start_time}-{end_time}"),
                "style": style,
            },
            "courses": default_course_map(period_id),
        }));
    }

    if rows.is_empty() && !user_has_schedule_entities(conn, owner_user_id)? {
        return Ok(None);
    }

    let mut stmt = conn
        .prepare(
            "SELECT id, period_id, weekday, title, secondary, hidden,
                    schedule_rule_json, style_json, col_span, row_span,
                    merged_into, merge_direction
             FROM course_cells
             WHERE owner_user_id = ?1 AND deleted_at IS NULL",
        )
        .map_err(|error| error.to_string())?;
    let courses = stmt
        .query_map(params![owner_user_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, Option<String>>(7)?,
                row.get::<_, Option<i64>>(8)?,
                row.get::<_, Option<i64>>(9)?,
                row.get::<_, Option<String>>(10)?,
                row.get::<_, Option<String>>(11)?,
            ))
        })
        .map_err(|error| error.to_string())?;

    let mut changes = load_desktop_temporary_changes(conn, owner_user_id)?;
    for course in courses {
        let (
            id,
            period_id,
            weekday,
            title,
            secondary,
            hidden,
            rule_raw,
            style_raw,
            col_span,
            row_span,
            merged_into,
            merge_direction,
        ) = course.map_err(|error| error.to_string())?;
        let Some(row) = rows
            .iter_mut()
            .find(|item| item.get("id").and_then(Value::as_str) == Some(period_id.as_str()))
        else {
            continue;
        };
        let rule = rule_raw
            .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
            .unwrap_or_else(|| {
                json!({
                    "weekPattern": "all",
                    "applyWholeTerm": true,
                    "startDate": term_start,
                    "endDate": term_end,
                })
            });
        let style = style_raw
            .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
            .unwrap_or_else(|| cloud_style_from_color_id(None, &HashMap::new()));
        let course_changes = changes.remove(&id).unwrap_or_default();
        row["courses"][weekday] = json!({
            "id": id,
            "title": title,
            "room": secondary.unwrap_or_default(),
            "hidden": hidden != 0,
            "colSpan": col_span.unwrap_or(1),
            "rowSpan": row_span.unwrap_or(1),
            "mergedInto": merged_into,
            "mergeDirection": merge_direction,
            "scheduleRule": rule,
            "style": style,
            "temporaryChanges": course_changes,
        });
    }

    Ok(Some(json!({
        "id": "desktop-entity-schedule",
        "teacherName": "",
        "weekNumber": 1,
        "termLabel": format!("{term_start} - {term_end}"),
        "activeWeekday": "monday",
        "days": default_desktop_days(visible_days),
        "rows": rows,
        "syncMeta": {
            "termStart": term_start,
            "termEnd": term_end,
            "visibleDays": visible_days,
        },
    })))
}

fn load_desktop_temporary_changes(
    conn: &Connection,
    owner_user_id: &str,
) -> Result<HashMap<String, Vec<Value>>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, course_cell_id, type, dates_json, title, secondary, base_color, style_json, created_at, updated_at
             FROM temporary_changes
             WHERE owner_user_id = ?1 AND deleted_at IS NULL",
        )
        .map_err(|error| error.to_string())?;
    let rows = stmt
        .query_map(params![owner_user_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, Option<String>>(7)?,
                row.get::<_, String>(8)?,
                row.get::<_, String>(9)?,
            ))
        })
        .map_err(|error| error.to_string())?;
    let mut result = HashMap::<String, Vec<Value>>::new();
    for row in rows {
        let (
            id,
            course_id,
            change_type,
            dates_raw,
            title,
            secondary,
            color,
            style_raw,
            created_at,
            updated_at,
        ) = row.map_err(|error| error.to_string())?;
        let dates = serde_json::from_str::<Value>(&dates_raw).unwrap_or_else(|_| json!([]));
        let style = style_raw
            .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
            .unwrap_or(Value::Null);
        let color = color.unwrap_or_else(|| "#ff3b30".to_string());
        result.entry(course_id).or_default().push(json!({
            "id": id,
            "type": if change_type == "swap" { "replace" } else { change_type.as_str() },
            "dates": dates,
            "replaceTitle": title.unwrap_or_default(),
            "replaceSecondary": secondary.unwrap_or_default(),
            "replaceColor": color,
            "color": color,
            "style": style,
            "createdAt": created_at,
            "updatedAt": updated_at,
        }));
    }
    Ok(result)
}

fn apply_server_changes_to_schedule(
    conn: &Connection,
    owner_user_id: &str,
    changes: &[ServerChange],
) -> Result<Vec<u32>, String> {
    let mut processed = Vec::<u32>::new();
    for change in changes {
        if change.server_seq == 0 {
            continue;
        }
        for diff in &change.entity_diffs {
            let entity = diff.get("entity").and_then(Value::as_str).unwrap_or("");
            let entity_id = diff.get("id").and_then(Value::as_str).unwrap_or("");
            let values = diff.get("values").cloned().unwrap_or(Value::Null);
            let accepted = filter_values_by_field_seq(
                conn,
                owner_user_id,
                entity,
                entity_id,
                &values,
                change.server_seq,
            )?;
            if accepted.as_object().is_none_or(|item| item.is_empty()) {
                continue;
            }
            match entity {
                "termSettings" => apply_cloud_term_settings(conn, owner_user_id, &accepted)?,
                "periodCard" => apply_cloud_period_card(conn, owner_user_id, entity_id, &accepted)?,
                "courseCard" => apply_cloud_course_card(conn, owner_user_id, entity_id, &accepted)?,
                "temporaryChange" => {
                    apply_cloud_temporary_change_entity(conn, owner_user_id, entity_id, &accepted)?
                }
                "colorProfile" => {
                    apply_cloud_color_profile(conn, owner_user_id, entity_id, &accepted)?
                }
                "reminder" => {}
                _ => {}
            }
        }
        processed.push(change.server_seq);
    }
    Ok(processed)
}

fn filter_values_by_field_seq(
    conn: &Connection,
    owner_user_id: &str,
    entity: &str,
    entity_id: &str,
    values: &Value,
    server_seq: u32,
) -> Result<Value, String> {
    let Some(object) = values.as_object() else {
        return Ok(Value::Null);
    };
    let now = now_string();
    let mut accepted = serde_json::Map::new();
    for (field_name, value) in object {
        let current: Option<i64> = conn
            .query_row(
                "SELECT server_seq
                 FROM sync_field_sequences
                 WHERE owner_user_id = ?1 AND entity = ?2 AND entity_id = ?3 AND field_name = ?4",
                params![owner_user_id, entity, entity_id, field_name],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        if server_seq as i64 <= current.unwrap_or(0) {
            continue;
        }
        conn.execute(
            "INSERT INTO sync_field_sequences (
               owner_user_id, entity, entity_id, field_name, server_seq, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(owner_user_id, entity, entity_id, field_name) DO UPDATE SET
               server_seq = excluded.server_seq,
               updated_at = excluded.updated_at",
            params![
                owner_user_id,
                entity,
                entity_id,
                field_name,
                server_seq as i64,
                now
            ],
        )
        .map_err(|error| error.to_string())?;
        accepted.insert(field_name.clone(), value.clone());
    }
    Ok(Value::Object(accepted))
}

fn apply_cloud_term_settings(
    conn: &Connection,
    owner_user_id: &str,
    values: &Value,
) -> Result<(), String> {
    let current = load_schedule_from_entities(conn, owner_user_id)?;
    let (current_start, current_end) = current
        .as_ref()
        .map(infer_term_range)
        .unwrap_or_else(|| (DEFAULT_TERM_START.to_string(), DEFAULT_TERM_END.to_string()));
    let term_start = get_str_any(values, "termStartDate", "term_start")
        .unwrap_or(&current_start)
        .to_string();
    let term_end = get_str_any(values, "termEndDate", "term_end")
        .unwrap_or(&current_end)
        .to_string();
    let visible_days = get_any(values, "visibleDays", "visible_days")
        .and_then(Value::as_i64)
        .map(|value| value.clamp(1, 7) as usize)
        .unwrap_or_else(|| {
            values
                .get("workdayMode")
                .and_then(Value::as_str)
                .map(visible_days_from_workday_mode)
                .unwrap_or(5)
        });
    let now = now_string();
    conn.execute(
        "INSERT INTO timetable_settings (
           id, owner_user_id, term_start_date, term_end_date, workday_mode,
           period_count, created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, COALESCE((SELECT period_count FROM timetable_settings WHERE id = ?1 AND owner_user_id = ?2), 8), ?6, ?6)
         ON CONFLICT(id, owner_user_id) DO UPDATE SET
           term_start_date = excluded.term_start_date,
           term_end_date = excluded.term_end_date,
           workday_mode = excluded.workday_mode,
           updated_at = excluded.updated_at,
           deleted_at = NULL",
        params![
            "schedule",
            owner_user_id,
            term_start,
            term_end,
            workday_mode_from_visible_days(visible_days),
            now,
        ],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

fn apply_cloud_period_card(
    conn: &Connection,
    owner_user_id: &str,
    entity_id: &str,
    values: &Value,
) -> Result<(), String> {
    let period_id = get_i64_any(values, "periodId", "period_id")
        .or_else(|| parse_period_card_id(entity_id))
        .unwrap_or(1);
    let row_id = format!("p{period_id}");
    if values
        .get("deleted")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        let now = now_string();
        conn.execute(
            "INSERT INTO period_cards (
               id, owner_user_id, order_index, label, start_time, end_time,
               style_json, created_at, updated_at, deleted_at
             ) VALUES (?1, ?2, ?3, '', '00:00', '00:00', ?4, ?5, ?5, ?5)
             ON CONFLICT(id, owner_user_id) DO UPDATE SET
               updated_at = excluded.updated_at,
               deleted_at = excluded.deleted_at",
            params![
                row_id,
                owner_user_id,
                period_id,
                serde_json::to_string(&cloud_style_from_color_id(None, &HashMap::new()))
                    .map_err(|error| error.to_string())?,
                now
            ],
        )
        .map_err(|error| error.to_string())?;
        conn.execute(
            "UPDATE course_cells SET deleted_at = ?3, updated_at = ?3
             WHERE period_id = ?1 AND owner_user_id = ?2",
            params![format!("p{period_id}"), owner_user_id, now],
        )
        .map_err(|error| error.to_string())?;
        return Ok(());
    }
    let start_minutes = get_i64_any(values, "startMinutes", "start_minutes").unwrap_or(0);
    let end_minutes = get_i64_any(values, "endMinutes", "end_minutes").unwrap_or(0);
    let now = now_string();
    conn.execute(
        "INSERT INTO period_cards (
           id, owner_user_id, order_index, label, start_time, end_time,
           style_json, created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6,
           COALESCE((SELECT style_json FROM period_cards WHERE id = ?1 AND owner_user_id = ?2), ?7),
           ?8, ?8)
         ON CONFLICT(id, owner_user_id) DO UPDATE SET
           order_index = excluded.order_index,
           label = excluded.label,
           start_time = excluded.start_time,
           end_time = excluded.end_time,
           updated_at = excluded.updated_at,
           deleted_at = NULL",
        params![
            row_id,
            owner_user_id,
            get_i64_any(values, "sortOrder", "sort_order").unwrap_or(period_id),
            get_str_multi(values, &["periodName", "name"]).unwrap_or(""),
            format_time_minutes(start_minutes),
            format_time_minutes(end_minutes),
            serde_json::to_string(&cloud_style_from_color_id(None, &HashMap::new()))
                .map_err(|error| error.to_string())?,
            now,
        ],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

fn apply_cloud_course_card(
    conn: &Connection,
    owner_user_id: &str,
    entity_id: &str,
    values: &Value,
) -> Result<(), String> {
    let (fallback_week_day, fallback_period_id) = parse_course_card_id(entity_id).unwrap_or((1, 1));
    let week_day = get_i64_any(values, "weekDay", "week_day").unwrap_or(fallback_week_day);
    let period_id = get_i64_any(values, "periodId", "period_id").unwrap_or(fallback_period_id);
    let weekday = weekday_from_number(week_day);
    let row_id = format!("p{period_id}");
    let course_id = course_card_id(week_day, period_id);
    let title = get_str_multi(values, &["courseName", "name"]).unwrap_or("");
    let secondary = get_str_any(values, "auxiliaryInfo", "auxiliary_info").unwrap_or("");
    let hidden = title.trim().is_empty();
    ensure_local_period_row(conn, owner_user_id, period_id)?;
    let start_date = get_str_any(values, "startDate", "start_date").unwrap_or(DEFAULT_TERM_START);
    let end_date = get_str_any(values, "endDate", "end_date").unwrap_or(DEFAULT_TERM_END);
    let rule = json!({
        "weekPattern": get_str_any(values, "weekParity", "week_parity").unwrap_or("all"),
        "applyWholeTerm": start_date == DEFAULT_TERM_START && end_date == DEFAULT_TERM_END,
        "startDate": start_date,
        "endDate": end_date,
    });
    let color_value = get_str_any(values, "colorValue", "color_value")
        .map(argb_to_hex_color)
        .unwrap_or_else(|| {
            cloud_color_id_to_hex(get_str_any(values, "colorId", "color_id"), &HashMap::new())
        });
    let default_style = cloud_style_from_color_id(
        Some(&argb_color_to_cloud_id(&hex_color_to_argb(&color_value))),
        &HashMap::new(),
    );
    let now = now_string();
    conn.execute(
        "INSERT INTO course_cells (
           id, owner_user_id, period_id, weekday, title, secondary, hidden,
           schedule_rule_json, base_color, style_json,
           col_span, row_span, merged_into, merge_direction,
           created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
           1, 1, NULL, NULL, ?11, ?11)
         ON CONFLICT(id, owner_user_id) DO UPDATE SET
           period_id = excluded.period_id,
           weekday = excluded.weekday,
           title = excluded.title,
           secondary = excluded.secondary,
           hidden = excluded.hidden,
           schedule_rule_json = excluded.schedule_rule_json,
           base_color = excluded.base_color,
           updated_at = excluded.updated_at,
           deleted_at = NULL",
        params![
            course_id,
            owner_user_id,
            row_id,
            weekday,
            title,
            secondary,
            if hidden { 1 } else { 0 },
            serde_json::to_string(&rule).map_err(|error| error.to_string())?,
            color_value,
            serde_json::to_string(&default_style).map_err(|error| error.to_string())?,
            now,
        ],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

fn apply_cloud_temporary_change_entity(
    conn: &Connection,
    owner_user_id: &str,
    entity_id: &str,
    values: &Value,
) -> Result<(), String> {
    let deleted = values
        .get("deleted")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let now = now_string();
    if deleted {
        conn.execute(
            "UPDATE temporary_changes SET deleted_at = ?3, updated_at = ?3
             WHERE owner_user_id = ?1 AND id = ?2",
            params![owner_user_id, entity_id, now],
        )
        .map_err(|error| error.to_string())?;
        return Ok(());
    }
    let date = values.get("date").and_then(Value::as_str).unwrap_or("");
    let course_id = get_str_multi(values, &["sourceCourseId", "courseId"]).unwrap_or("");
    conn.execute(
        "INSERT INTO temporary_changes (
           id, owner_user_id, course_cell_id, type, dates_json,
           title, secondary, base_color, style_json, created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL, ?9, ?9)
         ON CONFLICT(id, owner_user_id) DO UPDATE SET
           course_cell_id = excluded.course_cell_id,
           type = excluded.type,
           dates_json = excluded.dates_json,
           title = excluded.title,
           secondary = excluded.secondary,
           base_color = excluded.base_color,
           updated_at = excluded.updated_at,
           deleted_at = NULL",
        params![
            entity_id,
            owner_user_id,
            course_id,
            match values
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or("cancel")
            {
                "swap" | "replace" => "replace",
                _ => "cancel",
            },
            serde_json::to_string(&json!([date])).map_err(|error| error.to_string())?,
            get_str_any(values, "replacementName", "replacement_name").unwrap_or(""),
            get_str_any(
                values,
                "replacementAuxiliaryInfo",
                "replacement_auxiliary_info"
            )
            .unwrap_or(""),
            get_str_any(values, "replacementColorValue", "replacement_color_value")
                .map(argb_to_hex_color)
                .unwrap_or_else(|| "#FF3B30".to_string()),
            now,
        ],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

fn apply_cloud_color_profile(
    conn: &Connection,
    owner_user_id: &str,
    entity_id: &str,
    values: &Value,
) -> Result<(), String> {
    let deleted = values
        .get("deleted")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let now = now_string();
    if deleted {
        conn.execute(
            "UPDATE color_profiles SET deleted_at = ?3, updated_at = ?3
             WHERE owner_user_id = ?1 AND id = ?2",
            params![owner_user_id, entity_id, now],
        )
        .map_err(|error| error.to_string())?;
        return Ok(());
    }
    let color_value = get_str_any(values, "colorValue", "color_value")
        .or_else(|| get_str_any(values, "color", "color"))
        .unwrap_or("FFFF3B30");
    conn.execute(
        "INSERT INTO color_profiles (
           id, owner_user_id, color_name, color_value, sort_order, is_preset, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(id, owner_user_id) DO UPDATE SET
           color_name = excluded.color_name,
           color_value = excluded.color_value,
           sort_order = excluded.sort_order,
           is_preset = excluded.is_preset,
           updated_at = excluded.updated_at,
           deleted_at = NULL",
        params![
            entity_id,
            owner_user_id,
            get_str_any(values, "colorName", "name").unwrap_or(""),
            hex_color_to_argb(color_value),
            get_i64_any(values, "sortOrder", "sort_order").unwrap_or(0),
            if values
                .get("isPreset")
                .or_else(|| values.get("is_preset"))
                .and_then(Value::as_bool)
                .unwrap_or(false)
            {
                1
            } else {
                0
            },
            now,
        ],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

fn ensure_local_period_row(
    conn: &Connection,
    owner_user_id: &str,
    period_id: i64,
) -> Result<(), String> {
    let existing_deleted_at: Option<Option<String>> = conn
        .query_row(
            "SELECT deleted_at FROM period_cards WHERE owner_user_id = ?1 AND id = ?2",
            params![owner_user_id, format!("p{period_id}")],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    if existing_deleted_at.is_some() {
        return Ok(());
    }
    let now = now_string();
    conn.execute(
        "INSERT INTO period_cards (
           id, owner_user_id, order_index, label, start_time, end_time,
           style_json, created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, '00:00', '00:00', ?5, ?6, ?6)
         ON CONFLICT(id, owner_user_id) DO NOTHING",
        params![
            format!("p{period_id}"),
            owner_user_id,
            period_id,
            format!("Period {period_id}"),
            serde_json::to_string(&cloud_style_from_color_id(None, &HashMap::new()))
                .map_err(|error| error.to_string())?,
            now,
        ],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

fn parse_period_card_id(entity_id: &str) -> Option<i64> {
    if let Some(value) = entity_id.strip_prefix("periodCard_") {
        return value.parse::<i64>().ok();
    }
    if let Some(value) = entity_id.strip_prefix("period_") {
        return value.parse::<i64>().ok();
    }
    if let Some(value) = entity_id.strip_prefix('p') {
        return value.parse::<i64>().ok();
    }
    entity_id.parse::<i64>().ok()
}

fn ack_server_changes(
    conn: &Connection,
    owner_user_id: &str,
    token: &str,
    client_id: &str,
    server_seqs: &[u32],
) -> Result<(), String> {
    if server_seqs.is_empty() {
        return Ok(());
    }
    let unique = server_seqs.iter().copied().collect::<HashSet<_>>();
    let now = now_string();
    for seq in &unique {
        conn.execute(
            "INSERT OR IGNORE INTO processed_server_changes (
               owner_user_id, client_id, server_seq, processed_at
             ) VALUES (?1, ?2, ?3, ?4)",
            params![owner_user_id, client_id, *seq as i64, now],
        )
        .map_err(|error| error.to_string())?;
    }
    let mut processed = unique.into_iter().collect::<Vec<_>>();
    processed.sort_unstable();
    cloud_post_json(
        "/sync/ack",
        token,
        json!({
            "clientId": client_id,
            "processedSeqs": processed,
        }),
    )?;
    Ok(())
}

fn schedule_rows(schedule: &Value) -> Vec<&Value> {
    schedule
        .get("rows")
        .and_then(Value::as_array)
        .map(|rows| rows.iter().collect())
        .unwrap_or_default()
}

fn infer_term_range(schedule: &Value) -> (String, String) {
    let mut start: Option<String> = None;
    let mut end: Option<String> = None;
    for row in schedule_rows(schedule) {
        let Some(courses) = row.get("courses").and_then(Value::as_object) else {
            continue;
        };
        for course in courses.values() {
            let Some(rule) = course.get("scheduleRule") else {
                continue;
            };
            if let Some(value) = rule.get("startDate").and_then(Value::as_str) {
                if start.as_deref().is_none_or(|current| value < current) {
                    start = Some(value.to_string());
                }
            }
            if let Some(value) = rule.get("endDate").and_then(Value::as_str) {
                if end.as_deref().is_none_or(|current| value > current) {
                    end = Some(value.to_string());
                }
            }
        }
    }

    (
        start.unwrap_or_else(|| DEFAULT_TERM_START.to_string()),
        end.unwrap_or_else(|| DEFAULT_TERM_END.to_string()),
    )
}

fn is_syncable_course(course: &Value) -> bool {
    if course.get("mergedInto").and_then(Value::as_str).is_some() {
        return false;
    }
    let is_hidden = course
        .get("hidden")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let has_title = course
        .get("title")
        .and_then(Value::as_str)
        .is_some_and(|value| !value.trim().is_empty());
    let has_room = course
        .get("room")
        .and_then(Value::as_str)
        .is_some_and(|value| !value.trim().is_empty());
    let has_temporary_changes = course
        .get("temporaryChanges")
        .and_then(Value::as_array)
        .is_some_and(|items| !items.is_empty());
    if is_hidden && !has_title && !has_room && !has_temporary_changes {
        return false;
    }
    true
}

fn weekday_to_number(weekday: &str) -> Option<i64> {
    WEEKDAYS
        .iter()
        .position(|item| *item == weekday)
        .map(|index| (index + 1) as i64)
}

fn weekday_from_number(week_day: i64) -> &'static str {
    WEEKDAYS
        .get((week_day - 1).max(0) as usize)
        .copied()
        .unwrap_or("monday")
}

fn course_to_cloud_payload(
    course: &Value,
    course_id: &str,
    week_day: i64,
    period_id: i64,
    term_start: &str,
    term_end: &str,
) -> Value {
    let rule = course.get("scheduleRule").unwrap_or(&Value::Null);
    let color_value = course
        .get("style")
        .and_then(|style| style.get("baseColor"))
        .and_then(Value::as_str)
        .map(hex_color_to_argb)
        .unwrap_or_else(|| "FFFF3B30".to_string());
    json!({
        "id": course_id,
        "courseName": course.get("title").and_then(Value::as_str).unwrap_or(""),
        "auxiliaryInfo": course.get("room").and_then(Value::as_str).unwrap_or(""),
        "weekDay": week_day,
        "periodId": period_id,
        "startDate": rule.get("startDate").and_then(Value::as_str).unwrap_or(term_start),
        "endDate": rule.get("endDate").and_then(Value::as_str).unwrap_or(term_end),
        "weekParity": rule.get("weekPattern").and_then(Value::as_str).unwrap_or("all"),
        "colorId": argb_color_to_cloud_id(&color_value),
        "colorValue": color_value,
    })
}

fn temporary_change_to_cloud_payloads(
    change: &Value,
    course_id: &str,
    week_day: i64,
    period_id: i64,
) -> Vec<Value> {
    let change_id = change.get("id").and_then(Value::as_str).unwrap_or("change");
    let change_type = match change
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or("cancel")
    {
        "swap" | "replace" => "replace",
        value => value,
    };
    let replacement_color = change
        .get("replaceColor")
        .or_else(|| change.get("color"))
        .and_then(Value::as_str)
        .unwrap_or("#ff3b30");
    let dates = change
        .get("dates")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .collect::<Vec<_>>();
    let date_count = dates.len();

    dates
        .into_iter()
        .map(|date| {
            let id = temporary_change_cloud_id(change_id, date, date_count);
            json!({
                "id": id,
                "sourceCourseId": course_id,
                "date": date,
                "weekDay": week_day,
                "periodId": period_id,
                "type": change_type,
                "replacementName": change.get("replaceTitle").or_else(|| change.get("title")).and_then(Value::as_str).unwrap_or(""),
                "replacementAuxiliaryInfo": change.get("replaceSecondary").or_else(|| change.get("subtitle")).and_then(Value::as_str).unwrap_or(""),
                "replacementColorId": hex_color_to_cloud_id(replacement_color),
                "replacementColorValue": hex_color_to_argb(replacement_color),
                "updatedAt": change.get("updatedAt").cloned().unwrap_or(Value::Null),
                "deletedAt": Value::Null,
            })
        })
        .collect()
}

fn temporary_change_cloud_id(change_id: &str, date: &str, date_count: usize) -> String {
    let base = strip_repeated_date_suffix(change_id, date);
    if date_count <= 1 {
        return base;
    }
    format!("{base}-{date}")
}

fn strip_repeated_date_suffix(change_id: &str, date: &str) -> String {
    let suffix = format!("-{date}");
    let mut value = change_id.to_string();
    while value.ends_with(&suffix) {
        let next_len = value.len().saturating_sub(suffix.len());
        value.truncate(next_len);
    }
    if value.is_empty() {
        change_id.to_string()
    } else {
        value
    }
}

fn default_desktop_days(visible_days: usize) -> Vec<Value> {
    let labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    WEEKDAYS
        .iter()
        .zip(labels.iter())
        .take(visible_days)
        .map(|(id, label)| json!({ "id": id, "label": label, "dateLabel": "" }))
        .collect()
}

fn default_course_map(period_id: i64) -> Value {
    let mut map = serde_json::Map::new();
    for weekday in WEEKDAYS {
        map.insert(
            weekday.to_string(),
            default_empty_course(period_id, weekday),
        );
    }
    Value::Object(map)
}

fn default_empty_course(period_id: i64, weekday: &str) -> Value {
    json!({
        "id": course_card_id(weekday_to_number(weekday).unwrap_or(1), period_id),
        "title": "",
        "room": "",
        "hidden": true,
        "colSpan": 1,
        "rowSpan": 1,
        "scheduleRule": {
            "weekPattern": "all",
            "applyWholeTerm": true,
        },
        "style": cloud_style_from_color_id(None, &HashMap::new()),
        "temporaryChanges": [],
    })
}

fn get_any<'a>(item: &'a Value, primary: &str, fallback: &str) -> Option<&'a Value> {
    item.get(primary).or_else(|| item.get(fallback))
}

fn get_str_any<'a>(item: &'a Value, primary: &str, fallback: &str) -> Option<&'a str> {
    get_any(item, primary, fallback).and_then(Value::as_str)
}

fn get_str_multi<'a>(item: &'a Value, keys: &[&str]) -> Option<&'a str> {
    keys.iter()
        .find_map(|key| item.get(*key).and_then(Value::as_str))
}

fn get_i64_any(item: &Value, primary: &str, fallback: &str) -> Option<i64> {
    get_any(item, primary, fallback).and_then(Value::as_i64)
}

fn cloud_style_from_color_id(color_id: Option<&str>, colors: &HashMap<String, String>) -> Value {
    let base = cloud_color_id_to_hex(color_id, colors);
    let (background, foreground) = compute_desktop_course_palette(&base);
    json!({
        "baseColor": base,
        "backgroundColor": background,
        "color": foreground,
        "iconColor": foreground,
        "fontFamily": "Microsoft YaHei",
        "fontWeight": "medium",
        "displayMode": "auto",
    })
}

fn cloud_color_id_to_hex(color_id: Option<&str>, colors: &HashMap<String, String>) -> String {
    let Some(id) = color_id else {
        return "#FF3B30".to_string();
    };
    colors.get(id).cloned().unwrap_or_else(|| match id {
        "red" | "red_01" => "#FF3B30".to_string(),
        "orange" | "orange_01" => "#FF9500".to_string(),
        "yellow" | "yellow_01" => "#FFCC00".to_string(),
        "green" | "green_01" => "#34C759".to_string(),
        "blue" | "blue_01" => "#007AFF".to_string(),
        "purple" | "purple_01" => "#AF52DE".to_string(),
        "brown" | "brown_01" => "#A2845E".to_string(),
        _ => "#FF3B30".to_string(),
    })
}

fn compute_desktop_course_palette(base_color: &str) -> (String, String) {
    let (r, g, b) = parse_hex_rgb(base_color).unwrap_or((255, 255, 255));
    let luminance = 0.299 * r as f64 + 0.587 * g as f64 + 0.114 * b as f64;
    let max_channel = r.max(g).max(b) as f64;
    let min_channel = r.min(g).min(b) as f64;
    let saturation = (max_channel - min_channel) / 255.0;
    let foreground = derive_readable_accent_color(r, g, b, luminance, saturation);
    let background = blend_with_white_hex(
        r,
        g,
        b,
        if luminance > 205.0 && saturation < 0.22 {
            0.9
        } else {
            0.84
        },
    );
    (background, foreground)
}

fn derive_readable_accent_color(r: u8, g: u8, b: u8, luminance: f64, saturation: f64) -> String {
    if luminance > 205.0 && saturation < 0.22 {
        return rgb_to_hex(
            (r as f64 * 0.45).round() as u8,
            (g as f64 * 0.42).round() as u8,
            (b as f64 * 0.38).round() as u8,
        );
    }

    let mix_with_black = if luminance > 185.0 {
        0.48
    } else if luminance > 145.0 {
        0.38
    } else {
        0.24
    };
    rgb_to_hex(
        (r as f64 * (1.0 - mix_with_black)).round() as u8,
        (g as f64 * (1.0 - mix_with_black)).round() as u8,
        (b as f64 * (1.0 - mix_with_black)).round() as u8,
    )
}

fn blend_with_white_hex(r: u8, g: u8, b: u8, white_weight: f64) -> String {
    let ratio = white_weight.clamp(0.0, 1.0);
    rgb_to_hex(
        (r as f64 * (1.0 - ratio) + 255.0 * ratio).round() as u8,
        (g as f64 * (1.0 - ratio) + 255.0 * ratio).round() as u8,
        (b as f64 * (1.0 - ratio) + 255.0 * ratio).round() as u8,
    )
}

fn parse_hex_rgb(value: &str) -> Option<(u8, u8, u8)> {
    let normalized = value.trim().trim_start_matches('#');
    let rgb = if normalized.len() == 8 {
        &normalized[2..]
    } else {
        normalized
    };
    if rgb.len() != 6 {
        return None;
    }
    Some((
        u8::from_str_radix(&rgb[0..2], 16).ok()?,
        u8::from_str_radix(&rgb[2..4], 16).ok()?,
        u8::from_str_radix(&rgb[4..6], 16).ok()?,
    ))
}

fn rgb_to_hex(r: u8, g: u8, b: u8) -> String {
    format!("#{r:02x}{g:02x}{b:02x}")
}

fn workday_mode_from_visible_days(value: usize) -> &'static str {
    match value {
        7 => "MON_SUN",
        6 => "MON_SAT",
        _ => "MON_FRI",
    }
}

fn visible_days_from_workday_mode(value: &str) -> usize {
    match value {
        "MON_SUN" => 7,
        "MON_SAT" => 6,
        _ => 5,
    }
}

fn hex_color_to_cloud_id(color: &str) -> String {
    argb_color_to_cloud_id(&hex_color_to_argb(color))
}

fn argb_color_to_cloud_id(color: &str) -> String {
    let normalized = hex_color_to_argb(color);
    preset_color_id_from_argb(&normalized)
        .map(str::to_string)
        .unwrap_or_else(|| format!("custom_{normalized}"))
}

fn preset_color_id_from_argb(color: &str) -> Option<&'static str> {
    match hex_color_to_argb(color).as_str() {
        "FFFF3B30" => Some("red"),
        "FFFF9500" => Some("orange"),
        "FFFFCC00" => Some("yellow"),
        "FF34C759" => Some("green"),
        "FF007AFF" => Some("blue"),
        "FFAF52DE" => Some("purple"),
        "FFA2845E" => Some("brown"),
        // Legacy desktop preset colors mapped to the closest mobile preset.
        "FFFF6B35" | "FFFF6B5F" => Some("orange"),
        "FFFFD166" => Some("yellow"),
        "FF06D6A0" | "FF22C55E" => Some("green"),
        "FF118AB2" => Some("blue"),
        "FF9B5DE5" | "FFF15BB5" => Some("purple"),
        "FFF0E5CF" => Some("brown"),
        _ => None,
    }
}

fn hex_color_to_argb(color: &str) -> String {
    let normalized = color.trim().trim_start_matches('#');
    if normalized.len() == 8 {
        normalized.to_uppercase()
    } else if normalized.len() == 6 {
        format!("FF{}", normalized.to_uppercase())
    } else {
        "FFFF3B30".to_string()
    }
}

fn argb_to_hex_color(color: &str) -> String {
    let normalized = color
        .trim()
        .trim_start_matches('#')
        .trim_start_matches("0x");
    let rgb = if normalized.len() == 8 {
        &normalized[2..]
    } else {
        normalized
    };
    format!("#{}", rgb.to_uppercase())
}

fn parse_time_range(value: &str) -> (i64, i64) {
    let mut parts = value.split('-');
    (
        parse_time_minutes(parts.next().unwrap_or("")),
        parse_time_minutes(parts.next().unwrap_or("")),
    )
}

fn parse_time_minutes(value: &str) -> i64 {
    let mut parts = value.trim().split(':');
    let hour = parts
        .next()
        .and_then(|part| part.parse::<i64>().ok())
        .unwrap_or(0);
    let minute = parts
        .next()
        .and_then(|part| part.parse::<i64>().ok())
        .unwrap_or(0);
    hour * 60 + minute
}

fn format_time_minutes(value: i64) -> String {
    let hour = (value / 60).clamp(0, 23);
    let minute = (value % 60).clamp(0, 59);
    format!("{hour:02}:{minute:02}")
}

fn load_sync_meta_revision(
    conn: &Connection,
    owner_user_id: &str,
    column: &str,
) -> Result<Option<u32>, String> {
    let sql = match column {
        "last_known_cloud_revision" => {
            "SELECT last_known_cloud_revision FROM sync_meta WHERE owner_user_id = ?1"
        }
        "last_synced_cloud_revision" => {
            "SELECT last_synced_cloud_revision FROM sync_meta WHERE owner_user_id = ?1"
        }
        _ => return Err("unsupported sync meta revision column".to_string()),
    };
    conn.query_row(sql, params![owner_user_id], |row| {
        row.get::<_, Option<i64>>(0)
    })
    .optional()
    .map(|value| value.flatten().map(|item| item.max(0) as u32))
    .map_err(|error| error.to_string())
}

fn upsert_sync_meta_synced(
    conn: &Connection,
    owner_user_id: &str,
    synced_at: &str,
    cloud_revision: u32,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO sync_meta (
           owner_user_id,
           last_synced_at,
           last_checked_at,
           last_synced_cloud_revision,
           last_known_cloud_revision,
           last_sync_error,
           sync_schema_version
         )
         VALUES (?1, ?2, ?2, ?3, ?3, NULL, 1)
         ON CONFLICT(owner_user_id) DO UPDATE SET
           last_synced_at = excluded.last_synced_at,
           last_checked_at = excluded.last_checked_at,
           last_synced_cloud_revision = excluded.last_synced_cloud_revision,
           last_known_cloud_revision = excluded.last_known_cloud_revision,
           last_sync_error = NULL",
        params![owner_user_id, synced_at, cloud_revision],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

fn get_meta(conn: &Connection, key: &str) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT value FROM app_meta WHERE key = ?1",
        params![key],
        |row| row.get(0),
    )
    .optional()
    .map_err(|error| error.to_string())
}

fn set_meta(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO app_meta (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

fn normalize_phone(phone: &str) -> Result<String, String> {
    let normalized: String = phone.chars().filter(|ch| ch.is_ascii_digit()).collect();
    if normalized.len() != 11 {
        return Err("sign in before syncing".to_string());
    }

    Ok(normalized)
}

fn validate_password(password: &str) -> Result<(), String> {
    if password.chars().count() < 6 {
        return Err("sign in before syncing".to_string());
    }

    Ok(())
}

fn hash_password(password: &str, salt: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(salt.as_bytes());
    hasher.update(password.as_bytes());
    bytes_to_hex(&hasher.finalize())
}

fn bytes_to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn random_token(length: usize) -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(length)
        .map(char::from)
        .collect()
}

fn now_string() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    millis.to_string()
}
