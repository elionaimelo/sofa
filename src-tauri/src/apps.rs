//! Launchers and the user's own programs (emulators, tools): opened from Settings → Apps.
//! Custom entries are picked with the native file dialog here, so the webview only ever
//! sees ids; their paths live in `apps.json` (app data dir).
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::Manager;

#[derive(Serialize, Clone)]
pub struct AppEntry {
    id: String,
    name: String,
    /// `steam`, `epic` or `custom`; only custom entries can be removed.
    kind: &'static str,
}

#[derive(Serialize, Deserialize, Clone)]
struct Custom {
    id: String,
    name: String,
    path: PathBuf,
}

fn file(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("apps.json"))
}

fn load(app: &tauri::AppHandle) -> Vec<Custom> {
    file(app)
        .and_then(|f| std::fs::read_to_string(f).ok())
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

fn save(app: &tauri::AppHandle, custom: &[Custom]) -> Result<(), String> {
    let path = file(app).ok_or("serviceUnavailable")?;
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let json = serde_json::to_vec(custom).map_err(|_| "serviceUnavailable")?;
    std::fs::write(path, json).map_err(|_| "serviceUnavailable".into())
}

fn epic_launcher() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        let program_files = std::env::var_os("ProgramFiles(x86)")?;
        let exe = PathBuf::from(program_files).join(r"Epic Games\Launcher\Portal\Binaries\Win64\EpicGamesLauncher.exe");
        exe.is_file().then_some(exe)
    }
    #[cfg(not(windows))]
    None
}

#[tauri::command]
pub fn apps_list(app: tauri::AppHandle) -> Vec<AppEntry> {
    let mut apps = Vec::new();
    if crate::library::steam_root().is_some() {
        apps.push(AppEntry { id: "steam".into(), name: "Steam".into(), kind: "steam" });
    }
    if epic_launcher().is_some() {
        apps.push(AppEntry { id: "epic".into(), name: "Epic Games".into(), kind: "epic" });
    }
    apps.extend(load(&app).into_iter().map(|c| AppEntry { id: c.id, name: c.name, kind: "custom" }));
    apps
}

/// Native file dialog; `None` when the user cancels.
#[tauri::command]
pub async fn add_app(app: tauri::AppHandle) -> Result<Option<AppEntry>, String> {
    use tauri_plugin_dialog::DialogExt;
    let dialog = app.dialog().file().add_filter("Programs", &["exe", "bat", "cmd", "lnk"]);
    let picked = tauri::async_runtime::spawn_blocking(move || dialog.blocking_pick_file())
        .await
        .map_err(|_| "serviceUnavailable".to_string())?;
    let Some(picked) = picked else { return Ok(None) };
    let path = picked.into_path().map_err(|_| "invalidInput")?;
    if !path.is_file() {
        return Err("invalidInput".into());
    }
    let name = path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .filter(|s| !s.is_empty())
        .ok_or("invalidInput")?;
    let id = format!(
        "custom:{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or_default()
    );
    let mut custom = load(&app);
    custom.retain(|c| c.path != path);
    custom.push(Custom { id: id.clone(), name: name.clone(), path });
    save(&app, &custom)?;
    crate::log::info(&app, format!("apps: added {name:?}"));
    Ok(Some(AppEntry { id, name, kind: "custom" }))
}

#[tauri::command]
pub fn remove_app(id: String, app: tauri::AppHandle) -> Result<(), String> {
    let mut custom = load(&app);
    let before = custom.len();
    custom.retain(|c| c.id != id);
    if custom.len() == before {
        return Err("invalidInput".into());
    }
    save(&app, &custom)
}

fn run(path: &Path) -> Result<(), String> {
    #[cfg(windows)]
    if path.extension().is_some_and(|e| e.eq_ignore_ascii_case("lnk")) {
        // Shortcuts resolve through the shell, like a double-click.
        return tauri_plugin_opener::open_path(path, None::<&str>).map_err(|_| "openFailed".into());
    }
    let mut command = std::process::Command::new(path);
    if let Some(dir) = path.parent() {
        command.current_dir(dir);
    }
    command.spawn().map(|_| ()).map_err(|_| "openFailed".into())
}

#[tauri::command]
pub fn launch_app(id: String, app: tauri::AppHandle) -> Result<(), String> {
    crate::log::info(&app, format!("apps: launching {id}"));
    match id.as_str() {
        "steam" => {
            let root = crate::library::steam_root().ok_or("openFailed")?;
            run(&root.join("steam.exe"))
        }
        "epic" => run(&epic_launcher().ok_or("openFailed")?),
        _ => {
            let custom = load(&app).into_iter().find(|c| c.id == id).ok_or("invalidInput")?;
            run(&custom.path)
        }
    }
}
