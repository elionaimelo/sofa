//! Append-only diagnostic log in the app data dir (`sofa.log`), for issues that only show on
//! the device. Never log secrets: cookie values, tokens, keys or request URLs.
use std::io::Write;
use tauri::Manager;

pub fn path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("sofa.log"))
}

pub fn info(app: &tauri::AppHandle, message: impl std::fmt::Display) {
    let Some(path) = path(app) else { return };
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    // ponytail: rotate once at 1 MB instead of a logging crate.
    if path.metadata().is_ok_and(|m| m.len() > 1_000_000) {
        let _ = std::fs::rename(&path, path.with_extension("old.log"));
    }
    let seconds = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{seconds} {message}");
    }
}

/// Opens the folder that holds the log, so it can be shared from the device.
#[tauri::command]
pub async fn open_log(app: tauri::AppHandle) -> Result<(), String> {
    let path = path(&app).ok_or("openFailed")?;
    if !path.exists() {
        info(&app, "log created");
    }
    tauri_plugin_opener::reveal_item_in_dir(&path).map_err(|_| "openFailed".to_string())
}
