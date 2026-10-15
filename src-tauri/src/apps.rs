//! Launchers and the user's own programs (emulators, tools): opened from Settings → Apps.
//! Custom entries are picked with a folder browser the controller can drive; the webview only
//! ever sees listing indexes and ids, and the paths live in `apps.json` (app data dir).
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

/// Custom programs join the library without exposing their executable paths to the webview.
pub(crate) fn custom_games(app: &tauri::AppHandle) -> Vec<crate::library::Game> {
    load(app)
        .into_iter()
        .filter(|entry| entry.path.is_file())
        .map(|entry| crate::library::Game {
            id: entry.id,
            title: entry.name,
            source: "custom",
            installed: true,
            ..crate::library::Game::default()
        })
        .collect()
}

/// Only a directly selected executable has a reliable process location. Shortcuts and
/// scripts may start a process elsewhere, so they cannot be used for game-exit detection.
pub(crate) fn custom_executable(app: &tauri::AppHandle, id: &str) -> Option<PathBuf> {
    load(app).into_iter().find(|entry| entry.id == id)
        .map(|entry| entry.path)
        .filter(|path| path.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("exe")))
        .filter(|path| path.is_file())
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

/// One folder listing at a time; the webview addresses entries by index, never by path.
#[derive(Default)]
pub struct Browser(std::sync::Mutex<Option<(Option<PathBuf>, Vec<PathBuf>)>>);

#[derive(Serialize)]
pub struct Listing {
    /// Folder name, or empty at the top level (drives and known folders).
    title: String,
    can_go_up: bool,
    entries: Vec<Entry>,
}

#[derive(Serialize)]
pub struct Entry {
    id: usize,
    name: String,
    dir: bool,
}

const PROGRAM_EXTENSIONS: [&str; 4] = ["exe", "bat", "cmd", "lnk"];

fn is_program(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| PROGRAM_EXTENSIONS.iter().any(|p| p.eq_ignore_ascii_case(e)))
}

/// Drives and the folders programs usually live in.
fn roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    #[cfg(windows)]
    {
        for letter in b'A'..=b'Z' {
            let drive = PathBuf::from(format!("{}:\\", letter as char));
            if drive.is_dir() {
                roots.push(drive);
            }
        }
        for var in ["ProgramFiles", "ProgramFiles(x86)"] {
            if let Some(dir) = std::env::var_os(var).map(PathBuf::from).filter(|d| d.is_dir()) {
                roots.push(dir);
            }
        }
        if let Some(home) = std::env::var_os("USERPROFILE").map(PathBuf::from) {
            for sub in ["Desktop", "Downloads", "Documents"] {
                let dir = home.join(sub);
                if dir.is_dir() {
                    roots.push(dir);
                }
            }
        }
    }
    #[cfg(not(windows))]
    {
        roots.push(PathBuf::from("/"));
        if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
            roots.push(home);
        }
    }
    roots
}

/// Sub-folders first, then programs; names starting with "$" or "." are system or hidden.
fn list_dir(dir: &Path) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    let mut files = Vec::new();
    for entry in std::fs::read_dir(dir).into_iter().flatten().flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('$') || name.starts_with('.') {
            continue;
        }
        if path.is_dir() {
            dirs.push(path);
        } else if is_program(&path) {
            files.push(path);
        }
    }
    let key = |p: &PathBuf| p.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
    dirs.sort_by_key(key);
    files.sort_by_key(key);
    dirs.truncate(400);
    files.truncate(400);
    dirs.extend(files);
    dirs
}

fn listing(current: Option<PathBuf>, browser: &Browser) -> Result<Listing, String> {
    let paths = match &current {
        None => roots(),
        Some(dir) => list_dir(dir),
    };
    let entries = paths
        .iter()
        .enumerate()
        .map(|(id, path)| Entry {
            id,
            name: match &current {
                None => path.display().to_string(),
                Some(_) => path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
            },
            dir: current.is_none() || path.is_dir(),
        })
        .collect();
    let title = current
        .as_ref()
        .map(|d| d.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| d.display().to_string()))
        .unwrap_or_default();
    *browser.0.lock().map_err(|_| "serviceUnavailable")? = Some((current.clone(), paths));
    Ok(Listing { title, can_go_up: current.is_some(), entries })
}

fn resolve(browser: &Browser, id: usize) -> Result<(Option<PathBuf>, PathBuf), String> {
    let guard = browser.0.lock().map_err(|_| "serviceUnavailable")?;
    let (current, paths) = guard.as_ref().ok_or("invalidInput")?;
    Ok((current.clone(), paths.get(id).cloned().ok_or("invalidInput")?))
}

/// `id: None` lists drives and known folders; a folder id lists that folder.
#[tauri::command]
pub async fn browse(id: Option<usize>, browser: tauri::State<'_, Browser>) -> Result<Listing, String> {
    let target = match id {
        None => None,
        Some(id) => {
            let (_, path) = resolve(&browser, id)?;
            if !path.is_dir() {
                return Err("invalidInput".into());
            }
            Some(path)
        }
    };
    listing(target, &browser)
}

/// A drive root has no parent, so going up from it shows the top level again.
#[tauri::command]
pub async fn browse_up(browser: tauri::State<'_, Browser>) -> Result<Listing, String> {
    let current = browser.0.lock().map_err(|_| "serviceUnavailable")?.as_ref().and_then(|(c, _)| c.clone());
    let parent = current.as_ref().and_then(|c| c.parent()).map(Path::to_path_buf);
    listing(parent, &browser)
}

/// Adds the program at `id` from the current listing.
#[tauri::command]
pub async fn add_app(id: usize, app: tauri::AppHandle, browser: tauri::State<'_, Browser>) -> Result<AppEntry, String> {
    let (_, path) = resolve(&browser, id)?;
    if !path.is_file() || !is_program(&path) {
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
    Ok(AppEntry { id, name, kind: "custom" })
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn listing_shows_folders_first_then_programs_only() {
        let dir = std::env::temp_dir().join(format!("sofa-apps-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("zeta")).unwrap();
        std::fs::create_dir_all(dir.join(".hidden")).unwrap();
        for name in ["Game.EXE", "notes.txt", "run.bat", "$Recycle.exe"] {
            std::fs::write(dir.join(name), b"").unwrap();
        }
        let names: Vec<String> = list_dir(&dir)
            .iter()
            .map(|p| p.file_name().unwrap().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, ["zeta", "Game.EXE", "run.bat"]);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
