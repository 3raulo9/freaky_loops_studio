//! Native project / export files: Save, Save As and Open through the system
//! dialogs (instead of browser downloads), plus a recent-projects list kept in
//! %APPDATA%\FreakyLoopsStudio\recent.json.

use base64::Engine as _;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

const MAX_RECENT: usize = 10;

fn config_dir() -> PathBuf {
    let base = std::env::var_os("APPDATA").map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
    let dir = base.join("FreakyLoopsStudio");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

fn recent_path() -> PathBuf {
    config_dir().join("recent.json")
}

pub fn recent() -> Vec<String> {
    std::fs::read_to_string(recent_path())
        .ok()
        .and_then(|s| serde_json::from_str::<Vec<String>>(&s).ok())
        .unwrap_or_default()
        .into_iter()
        .filter(|p| Path::new(p).exists())
        .collect()
}

pub fn remember(path: &str) {
    let mut list = recent();
    list.retain(|p| !p.eq_ignore_ascii_case(path));
    list.insert(0, path.to_string());
    list.truncate(MAX_RECENT);
    let _ = std::fs::write(recent_path(), serde_json::to_string_pretty(&list).unwrap_or_default());
}

fn file_name(path: &Path) -> String {
    path.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default()
}

fn dialog(window: &tao::window::Window, filter: &Value) -> rfd::FileDialog {
    let name = filter.get("name").and_then(Value::as_str).unwrap_or("Files");
    let exts: Vec<String> = filter
        .get("ext")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(|e| e.as_str().map(str::to_string)).collect())
        .unwrap_or_default();
    let mut d = rfd::FileDialog::new().set_parent(window);
    if !exts.is_empty() {
        d = d.add_filter(name, &exts);
    }
    d
}

/// `fileSave`: write `data` (text) or `base64` (binary) to `path`, or to a path
/// picked in the Save dialog when none is given (Save As). Projects (`.freak`)
/// go on the recent list.
pub fn save(window: &tao::window::Window, p: &Value) -> Value {
    let req_id = p.get("reqId").cloned().unwrap_or(Value::Null);
    let target = match p.get("path").and_then(Value::as_str).filter(|s| !s.is_empty()) {
        Some(path) => Some(PathBuf::from(path)),
        None => {
            let suggested = p.get("suggestedName").and_then(Value::as_str).unwrap_or("untitled");
            dialog(window, p.get("filter").unwrap_or(&Value::Null)).set_title("Save").set_file_name(suggested).save_file()
        }
    };
    let Some(path) = target else {
        return json!({ "reqId": req_id, "cancelled": true });
    };
    let bytes = match (p.get("data").and_then(Value::as_str), p.get("base64").and_then(Value::as_str)) {
        (Some(text), _) => text.as_bytes().to_vec(),
        (None, Some(b64)) => match base64::engine::general_purpose::STANDARD.decode(b64) {
            Ok(b) => b,
            Err(e) => return json!({ "reqId": req_id, "error": format!("Bad data: {e}") }),
        },
        _ => Vec::new(),
    };
    if let Err(e) = std::fs::write(&path, bytes) {
        return json!({ "reqId": req_id, "error": format!("Could not write {}: {e}", path.display()) });
    }
    let path_s = path.to_string_lossy().into_owned();
    if path_s.to_ascii_lowercase().ends_with(".freak") {
        remember(&path_s);
    }
    json!({ "reqId": req_id, "path": path_s, "name": file_name(&path) })
}

/// `fileOpen`: pick (or, with `path`, directly read) a text file.
pub fn open(window: &tao::window::Window, p: &Value) -> Value {
    let req_id = p.get("reqId").cloned().unwrap_or(Value::Null);
    let target = match p.get("path").and_then(Value::as_str).filter(|s| !s.is_empty()) {
        Some(path) => Some(PathBuf::from(path)),
        None => dialog(window, p.get("filter").unwrap_or(&Value::Null)).set_title("Open").pick_file(),
    };
    let Some(path) = target else {
        return json!({ "reqId": req_id, "cancelled": true });
    };
    // Binary project formats aren't sent through the bridge: the UI fetches
    // them from `/__file/` (fast, no base64), which this unlocks.
    let ext = path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    if matches!(ext.as_str(), "flp" | "zip") {
        let path_s = path.to_string_lossy().into_owned();
        if !path.is_file() {
            return json!({ "reqId": req_id, "error": format!("{} was not found.", path.display()) });
        }
        crate::locate::allow(&path);
        remember(&path_s);
        return json!({ "reqId": req_id, "path": path_s, "name": file_name(&path), "binary": true });
    }
    match std::fs::read_to_string(&path) {
        Ok(data) => {
            let path_s = path.to_string_lossy().into_owned();
            if path_s.to_ascii_lowercase().ends_with(".freak") {
                remember(&path_s);
            }
            json!({ "reqId": req_id, "path": path_s, "name": file_name(&path), "data": data })
        }
        Err(e) => json!({ "reqId": req_id, "error": format!("Could not read {}: {e}", path.display()) }),
    }
}

/// `pickFolder`: choose a folder (e.g. where an imported project's samples live).
pub fn pick_folder(window: &tao::window::Window, p: &Value) -> Value {
    let req_id = p.get("reqId").cloned().unwrap_or(Value::Null);
    let title = p.get("title").and_then(Value::as_str).unwrap_or("Choose a folder");
    match rfd::FileDialog::new().set_parent(window).set_title(title).pick_folder() {
        Some(path) => json!({ "reqId": req_id, "path": path.to_string_lossy() }),
        None => json!({ "reqId": req_id, "cancelled": true }),
    }
}

// ── App settings (%APPDATA%\FreakyLoopsStudio\settings.json) ──────────────────

fn settings_path() -> PathBuf {
    config_dir().join("settings.json")
}

pub fn setting(key: &str) -> Option<Value> {
    let s = std::fs::read_to_string(settings_path()).ok()?;
    serde_json::from_str::<Value>(&s).ok()?.get(key).cloned()
}

pub fn set_setting(key: &str, value: Value) {
    let mut all = std::fs::read_to_string(settings_path())
        .ok()
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .filter(Value::is_object)
        .unwrap_or_else(|| json!({}));
    all[key] = value;
    let _ = std::fs::write(settings_path(), serde_json::to_string_pretty(&all).unwrap_or_default());
}

/// Autosave (desktop): a file in the app's data folder — browser storage holds
/// a few megabytes, and a project with plugin states easily needs more. Not
/// put on the recent list.
fn autosave_path() -> PathBuf {
    config_dir().join("autosave.freak")
}

pub fn autosave_write(p: &Value) -> Value {
    let data = p.get("data").and_then(Value::as_str).unwrap_or("");
    let tmp = autosave_path().with_extension("tmp");
    // Write aside, then swap in: a crash mid-write never leaves half an autosave.
    let r = std::fs::write(&tmp, data).and_then(|_| std::fs::rename(&tmp, autosave_path()));
    json!({ "reqId": p.get("reqId").cloned().unwrap_or(Value::Null), "ok": r.is_ok(), "error": r.err().map(|e| e.to_string()) })
}

pub fn autosave_read(p: &Value) -> Value {
    let req_id = p.get("reqId").cloned().unwrap_or(Value::Null);
    match std::fs::read_to_string(autosave_path()) {
        Ok(data) => json!({ "reqId": req_id, "data": data }),
        Err(_) => json!({ "reqId": req_id, "data": null }),
    }
}
