use std::{
    fs,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

use rand::{distributions::Alphanumeric, Rng};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

const DEFAULT_USER_ID: &str = "default_local";
const MOCK_CODE: &str = "1234";

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
    pub last_sync_error: Option<String>,
    pub has_pending_changes: bool,
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
    let schedule_json: Option<String> = conn
        .query_row(
            "SELECT schedule_json FROM schedule_snapshots WHERE owner_user_id = ?1",
            params![owner_user_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let schedule = schedule_json
        .map(|raw| serde_json::from_str::<Value>(&raw).map_err(|error| error.to_string()))
        .transpose()?;

    Ok(StoredSchedulePayload {
        owner_user_id,
        schedule,
    })
}

#[tauri::command]
pub fn save_current_schedule(app: AppHandle, schedule: Value) -> Result<(), String> {
    let conn = open_db(&app)?;
    ensure_default_user(&conn)?;
    let owner_user_id = active_user_id(&conn)?;
    save_schedule_for_user(&conn, &owner_user_id, &schedule)
}

#[tauri::command]
pub fn load_local_sync_status(app: AppHandle) -> Result<LocalSyncStatus, String> {
    let conn = open_db(&app)?;
    ensure_default_user(&conn)?;
    let owner_user_id = active_user_id(&conn)?;
    load_sync_status_for_user(&conn, &owner_user_id)
}

#[tauri::command]
pub fn register_local_account(
    app: AppHandle,
    phone: String,
    code: String,
    password: String,
) -> Result<LocalAccountState, String> {
    if code.trim() != MOCK_CODE {
        return Err("验证码不正确".to_string());
    }

    let normalized_phone = normalize_phone(&phone)?;
    validate_password(&password)?;
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
    if existing_id.is_some() {
        return Err("该手机号已注册".to_string());
    }

    let user_id = format!("local_user_{}", random_token(16));
    let salt = random_token(24);
    let password_hash = hash_password(&password, &salt);
    let now = now_string();

    conn.execute(
        "INSERT INTO local_users (id, phone, password_hash, password_salt, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
        params![user_id, normalized_phone, password_hash, salt, now],
    )
    .map_err(|error| error.to_string())?;

    copy_default_schedule_if_needed(&conn, &user_id)?;
    activate_user(&conn, &user_id)?;
    load_account_state_from_conn(&conn)
}

#[tauri::command]
pub fn login_with_password(app: AppHandle, phone: String, password: String) -> Result<LocalAccountState, String> {
    let normalized_phone = normalize_phone(&phone)?;
    let conn = open_db(&app)?;
    ensure_default_user(&conn)?;

    let user: Option<(String, String, String)> = conn
        .query_row(
            "SELECT id, password_hash, password_salt FROM local_users WHERE phone = ?1 AND deleted_at IS NULL",
            params![normalized_phone],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let Some((user_id, password_hash, salt)) = user else {
        return Err("手机号或密码不正确".to_string());
    };

    if hash_password(&password, &salt) != password_hash {
        return Err("手机号或密码不正确".to_string());
    }

    copy_default_schedule_if_needed(&conn, &user_id)?;
    activate_user(&conn, &user_id)?;
    load_account_state_from_conn(&conn)
}

#[tauri::command]
pub fn login_with_code(app: AppHandle, phone: String, code: String) -> Result<LocalAccountState, String> {
    if code.trim() != MOCK_CODE {
        return Err("验证码不正确".to_string());
    }

    let normalized_phone = normalize_phone(&phone)?;
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
    let Some(user_id) = user_id else {
        return Err("该手机号尚未注册".to_string());
    };

    copy_default_schedule_if_needed(&conn, &user_id)?;
    activate_user(&conn, &user_id)?;
    load_account_state_from_conn(&conn)
}

#[tauri::command]
pub fn logout_local_account(app: AppHandle) -> Result<LocalAccountState, String> {
    let conn = open_db(&app)?;
    ensure_default_user(&conn)?;
    activate_user(&conn, DEFAULT_USER_ID)?;
    load_account_state_from_conn(&conn)
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
    let dir = app.path().app_data_dir().map_err(|error| error.to_string())?;
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
          id TEXT PRIMARY KEY,
          owner_user_id TEXT NOT NULL,
          term_start_date TEXT NOT NULL,
          term_end_date TEXT NOT NULL,
          workday_mode TEXT NOT NULL,
          period_count INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          deleted_at TEXT
        );
        CREATE TABLE IF NOT EXISTS period_cards (
          id TEXT PRIMARY KEY,
          owner_user_id TEXT NOT NULL,
          order_index INTEGER NOT NULL,
          label TEXT NOT NULL,
          start_time TEXT NOT NULL,
          end_time TEXT NOT NULL,
          style_json TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          deleted_at TEXT
        );
        CREATE TABLE IF NOT EXISTS course_cells (
          id TEXT PRIMARY KEY,
          owner_user_id TEXT NOT NULL,
          period_id TEXT NOT NULL,
          weekday TEXT NOT NULL,
          title TEXT NOT NULL,
          secondary TEXT,
          note TEXT,
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
          deleted_at TEXT
        );
        CREATE TABLE IF NOT EXISTS temporary_changes (
          id TEXT PRIMARY KEY,
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
          deleted_at TEXT
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
        CREATE TABLE IF NOT EXISTS sync_state (
          owner_user_id TEXT NOT NULL,
          entity_type TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          dirty INTEGER NOT NULL DEFAULT 0,
          last_synced_at TEXT,
          last_sync_error TEXT,
          local_revision INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (owner_user_id, entity_type, entity_id)
        );
        CREATE TABLE IF NOT EXISTS schedule_snapshots (
          owner_user_id TEXT PRIMARY KEY,
          schedule_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT OR IGNORE INTO app_meta (key, value) VALUES ('dataSchemaVersion', '1');
        INSERT OR IGNORE INTO app_meta (key, value) VALUES ('syncProtocolVersion', '1');
        ",
    )
    .map_err(|error| error.to_string())?;
    ensure_device_id(conn)?;
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

fn copy_default_schedule_if_needed(conn: &Connection, user_id: &str) -> Result<(), String> {
    if user_id == DEFAULT_USER_ID {
        return Ok(());
    }

    let existing: Option<String> = conn
        .query_row(
            "SELECT schedule_json FROM schedule_snapshots WHERE owner_user_id = ?1",
            params![user_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    if existing.is_some() {
        return Ok(());
    }

    let default_schedule: Option<String> = conn
        .query_row(
            "SELECT schedule_json FROM schedule_snapshots WHERE owner_user_id = ?1",
            params![DEFAULT_USER_ID],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    if let Some(schedule_json) = default_schedule {
        conn.execute(
            "INSERT INTO schedule_snapshots (owner_user_id, schedule_json, updated_at) VALUES (?1, ?2, ?3)",
            params![user_id, schedule_json, now_string()],
        )
        .map_err(|error| error.to_string())?;
        mark_schedule_snapshot_dirty(conn, user_id)?;
    }

    Ok(())
}

fn save_schedule_for_user(conn: &Connection, owner_user_id: &str, schedule: &Value) -> Result<(), String> {
    let raw = serde_json::to_string(schedule).map_err(|error| error.to_string())?;
    let now = now_string();
    conn.execute(
        "INSERT INTO schedule_snapshots (owner_user_id, schedule_json, updated_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(owner_user_id) DO UPDATE SET schedule_json = excluded.schedule_json, updated_at = excluded.updated_at",
        params![owner_user_id, raw, now],
    )
    .map_err(|error| error.to_string())?;
    mark_schedule_snapshot_dirty(conn, owner_user_id)?;
    Ok(())
}

fn mark_schedule_snapshot_dirty(conn: &Connection, owner_user_id: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO sync_state (owner_user_id, entity_type, entity_id, dirty, local_revision)
         VALUES (?1, 'schedule_snapshot', ?1, 1, 1)
         ON CONFLICT(owner_user_id, entity_type, entity_id)
         DO UPDATE SET dirty = 1, local_revision = local_revision + 1, last_sync_error = NULL",
        params![owner_user_id],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

fn load_sync_status_for_user(conn: &Connection, owner_user_id: &str) -> Result<LocalSyncStatus, String> {
    let (dirty_count, local_revision): (i64, i64) = conn
        .query_row(
            "SELECT COUNT(*), COALESCE(MAX(local_revision), 0)
             FROM sync_state
             WHERE owner_user_id = ?1 AND dirty = 1",
            params![owner_user_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|error| error.to_string())?;
    let last_sync_error = conn
        .query_row(
            "SELECT last_sync_error
             FROM sync_state
             WHERE owner_user_id = ?1 AND last_sync_error IS NOT NULL
             ORDER BY local_revision DESC
             LIMIT 1",
            params![owner_user_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;

    Ok(LocalSyncStatus {
        owner_user_id: owner_user_id.to_string(),
        dirty_count: dirty_count.max(0) as u32,
        local_revision: local_revision.max(0) as u32,
        last_sync_error,
        has_pending_changes: dirty_count > 0,
    })
}

fn get_meta(conn: &Connection, key: &str) -> Result<Option<String>, String> {
    conn.query_row("SELECT value FROM app_meta WHERE key = ?1", params![key], |row| row.get(0))
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
        return Err("请输入 11 位手机号".to_string());
    }

    Ok(normalized)
}

fn validate_password(password: &str) -> Result<(), String> {
    if password.chars().count() < 6 {
        return Err("密码至少需要 6 位".to_string());
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
