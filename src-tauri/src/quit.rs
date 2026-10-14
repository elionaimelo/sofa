//! Closes the running game from the HUD, in Sofa's panel and in the Xbox Game Bar widget:
//! the title Steam reports as running, or else the last game Sofa launched (Epic and GOG
//! don't report one). Only processes whose executable sits inside that game's install
//! folder are touched; the caller never names a process or a path.
use crate::library::{self, Game};
use serde::Serialize;
use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::Manager;

/// The last game Sofa launched.
#[derive(Default)]
pub struct LastLaunch(pub Mutex<Option<String>>);

#[derive(Serialize, Debug, PartialEq)]
pub struct Running {
    id: String,
    title: String,
}

/// Install folder of an installed game, from its launcher's own records.
fn install_folder(game: &Game) -> Option<PathBuf> {
    let folder = if let Some(app_id) = library::steam_app_id(&game.id) {
        let manifest = format!("appmanifest_{app_id}.acf");
        let lib = library::steam_libraries()
            .into_iter()
            .find(|lib| lib.join("steamapps").join(&manifest).is_file())?;
        crate::steam_uninstall::removal(&lib, app_id).ok()?.folder?
    } else if let Some(app) = game.id.strip_prefix("epic:") {
        library::epic_install_location(app)?
    } else {
        // GOG records the game's executable; its folder holds the install.
        Path::new(&game.launch).parent()?.to_path_buf()
    };
    let folder = std::fs::canonicalize(folder).ok()?;
    // A drive root would match every program on it.
    (folder.components().count() >= 3).then_some(folder)
}

#[cfg_attr(not(any(windows, test)), expect(dead_code, reason = "processes are only read on Windows"))]
/// Whether an executable lies inside a folder. Windows paths compare case-insensitively,
/// with either separator and with or without the `\\?\` prefix `canonicalize` adds.
fn inside(exe: &Path, folder: &Path) -> bool {
    let plain = |p: &Path| {
        let text = p.to_string_lossy().to_lowercase().replace('/', "\\");
        text.strip_prefix(r"\\?\").unwrap_or(&text).trim_end_matches('\\').to_owned()
    };
    let (exe, folder) = (plain(exe), plain(folder));
    !folder.is_empty() && exe.strip_prefix(&folder).is_some_and(|rest| rest.starts_with('\\'))
}

/// The running game and its folder: Steam's running app first, then Sofa's last launch,
/// whichever still has a process inside its install folder.
fn target(app: &tauri::AppHandle) -> Option<(Game, PathBuf)> {
    let steam = library::running_steam_app().map(|id| format!("steam:{id}"));
    let last = app.state::<LastLaunch>().0.lock().ok().and_then(|id| id.clone());
    let ids: Vec<String> = steam.into_iter().chain(last).collect();
    if ids.is_empty() {
        return None;
    }
    let games = library::scan();
    ids.iter().find_map(|id| {
        let game = games.iter().find(|g| &g.id == id)?;
        let folder = install_folder(game)?;
        (!processes_in(&folder).is_empty()).then(|| (game.clone(), folder))
    })
}

#[cfg(windows)]
fn processes_in(folder: &Path) -> Vec<u32> {
    use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
    let mut system = System::new();
    system.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing().with_exe(UpdateKind::Always),
    );
    system
        .processes()
        .values()
        .filter(|p| p.exe().is_some_and(|exe| inside(exe, folder)))
        .map(|p| p.pid().as_u32())
        .collect()
}
#[cfg(not(windows))]
fn processes_in(_folder: &Path) -> Vec<u32> {
    Vec::new()
}

/// Asks every visible window of these processes to close, as its close button would.
#[cfg(windows)]
fn post_close(pids: &[u32]) -> usize {
    use windows_sys::{
        Win32::{
            Foundation::{HWND, LPARAM},
            UI::WindowsAndMessaging::{EnumWindows, GetWindowThreadProcessId, IsWindowVisible, PostMessageW, WM_CLOSE},
        },
        core::BOOL,
    };
    struct Search<'a> {
        pids: &'a [u32],
        closed: usize,
    }
    unsafe extern "system" fn each(hwnd: HWND, lparam: LPARAM) -> BOOL {
        // `lparam` is the `Search` below, alive for the whole EnumWindows call.
        let search = unsafe { &mut *(lparam as *mut Search) };
        let mut pid = 0u32;
        // `hwnd` comes from EnumWindows; `pid` is a valid out pointer.
        unsafe { GetWindowThreadProcessId(hwnd, &mut pid) };
        // Same window handle, still valid during the enumeration.
        if search.pids.contains(&pid) && unsafe { IsWindowVisible(hwnd) } != 0 {
            // Posting returns at once; the game handles WM_CLOSE like its own close button.
            unsafe { PostMessageW(hwnd, WM_CLOSE, 0, 0) };
            search.closed += 1;
        }
        1
    }
    let mut search = Search { pids, closed: 0 };
    // The callback only touches `search` and the window handles it is given.
    unsafe { EnumWindows(Some(each), &mut search as *mut Search as LPARAM) };
    search.closed
}

#[cfg(windows)]
fn close(folder: &Path, force: bool) -> Result<(), String> {
    use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
    let pids = processes_in(folder);
    if pids.is_empty() {
        return Err("noGameRunning".into());
    }
    if !force {
        return if post_close(&pids) > 0 { Ok(()) } else { Err("closeGameFailed".into()) };
    }
    // Like Task Manager's End task: unsaved progress is lost, so the HUD asks first.
    let mut system = System::new();
    let list: Vec<Pid> = pids.iter().map(|&pid| Pid::from_u32(pid)).collect();
    system.refresh_processes_specifics(ProcessesToUpdate::Some(&list), true, ProcessRefreshKind::nothing().with_exe(UpdateKind::Always));
    // Re-checked: a pid freed and reused since the first look must not be killed.
    let killed = list
        .iter()
        .filter_map(|pid| system.process(*pid))
        .filter(|p| p.exe().is_some_and(|exe| inside(exe, folder)))
        .filter(|p| p.kill())
        .count();
    if killed > 0 { Ok(()) } else { Err("closeGameFailed".into()) }
}
#[cfg(not(windows))]
fn close(_folder: &Path, _force: bool) -> Result<(), String> {
    Err("desktopRequired".into())
}

/// The game a close would act on, for the HUD to offer it.
#[tauri::command]
pub async fn running_game(app: tauri::AppHandle) -> Result<Option<Running>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        target(&app).map(|(game, _)| Running { id: game.id, title: game.title })
    })
    .await
    .map_err(|_| "serviceUnavailable".into())
}

/// Closes the running game: its windows are asked to close, or with `force` its processes
/// end at once.
#[tauri::command]
pub async fn close_game(force: bool, app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (game, folder) = target(&app).ok_or("noGameRunning")?;
        let result = close(&folder, force);
        crate::log::info(&app, format!("quit: {} force={force} ok={}", game.id, result.is_ok()));
        result
    })
    .await
    .map_err(|_| "serviceUnavailable")?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_executables_inside_the_game_folder_count() {
        let folder = Path::new(r"\\?\C:\Program Files\Epic Games\Hades");
        assert!(inside(Path::new(r"C:\Program Files\Epic Games\Hades\x64\Hades.exe"), folder));
        assert!(inside(Path::new(r"c:\program files\epic games\HADES\Hades.exe"), folder));
        assert!(inside(Path::new("C:/Program Files/Epic Games/Hades/Hades.exe"), folder));
        assert!(!inside(Path::new(r"C:\Program Files\Epic Games\Hades II\Hades2.exe"), folder));
        assert!(!inside(Path::new(r"C:\Program Files\Epic Games\Launcher.exe"), folder));
        assert!(!inside(Path::new(r"C:\Windows\explorer.exe"), Path::new("")));
    }
}
