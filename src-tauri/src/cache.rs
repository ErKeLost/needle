//! The audio cache: one file per song, kept so a side replays without the
//! network. Settings shows its size and can empty it.

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

fn directory(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let base = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("无法定位缓存目录：{error}"))?;
    Ok(base.join("audio"))
}

fn size_of(path: &std::path::Path) -> u64 {
    let mut total = 0;
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                total += size_of(&path);
            } else if let Ok(meta) = entry.metadata() {
                total += meta.len();
            }
        }
    }
    total
}

#[tauri::command]
pub async fn cache_usage(app: AppHandle) -> Result<Value, String> {
    let directory = directory(&app)?;
    let files = std::fs::read_dir(&directory)
        .map(|entries| entries.flatten().count())
        .unwrap_or(0);
    Ok(json!({ "bytes": size_of(&directory), "files": files }))
}

#[tauri::command]
pub async fn cache_clear(app: AppHandle) -> Result<Value, String> {
    let directory = directory(&app)?;
    if directory.exists() {
        std::fs::remove_dir_all(&directory).map_err(|error| format!("无法清空缓存：{error}"))?;
    }
    Ok(json!({ "bytes": 0, "files": 0 }))
}
