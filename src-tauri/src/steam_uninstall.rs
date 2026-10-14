//! Removes an installed Steam title without Steam's dialog: Steam is closed in the background,
//! the title's folder under `steamapps/common` and its manifest are deleted, and Steam starts
//! again minimised. Only paths derived from the requested app id's own manifest, inside a known
//! Steam library, are touched; anything else refuses before Steam is closed.
// The removal itself runs only on Windows; elsewhere the helpers serve the tests.
#![cfg_attr(not(windows), allow(dead_code))]
use crate::library;
use std::{
    fs,
    path::{Path, PathBuf},
};

/// What gets deleted for one app id.
#[derive(Debug, PartialEq)]
pub(crate) struct Removal {
    /// `steamapps/common/<installdir>`; absent when the folder is already gone.
    folder: Option<PathBuf>,
    manifest: PathBuf,
}

/// `installdir` as Steam writes it: one plain folder name.
fn plain_name(name: &str) -> bool {
    !name.is_empty()
        && name != "."
        && name != ".."
        && name.len() <= 255
        && !name.contains(['/', '\\', ':', '\0'])
}

/// Validates the removal for `app_id` inside `library_dir` (a Steam library root).
pub(crate) fn removal(library_dir: &Path, app_id: &str) -> Result<Removal, String> {
    let steamapps = library_dir.join("steamapps");
    let manifest = steamapps.join(format!("appmanifest_{app_id}.acf"));
    let text = fs::read_to_string(&manifest).map_err(|_| "gameNoLongerInstalled")?;
    let name = library::steam_install_dir(&text).ok_or("invalidUninstallManifest")?;
    if !plain_name(&name) {
        return Err("unsafeUninstallPath".into());
    }
    let common = steamapps.join("common");
    let folder = common.join(&name);
    let Ok(meta) = fs::symlink_metadata(&folder) else {
        return Ok(Removal { folder: None, manifest });
    };
    // A link or junction would send the deletion somewhere else.
    if meta.file_type().is_symlink() || !meta.is_dir() {
        return Err("unsafeUninstallPath".into());
    }
    let inside = fs::canonicalize(&folder)
        .ok()
        .zip(fs::canonicalize(&common).ok())
        .is_some_and(|(folder, common)| folder.parent() == Some(common.as_path()));
    if !inside {
        return Err("unsafeUninstallPath".into());
    }
    Ok(Removal { folder: Some(folder), manifest })
}

impl Removal {
    /// Folder first: if a file is locked the manifest stays, so Steam can still repair it.
    fn apply(&self) -> Result<(), String> {
        if let Some(folder) = &self.folder {
            fs::remove_dir_all(folder).map_err(|_| "uninstallFailed")?;
        }
        fs::remove_file(&self.manifest).map_err(|_| "uninstallFailed".into())
    }
}

#[cfg(windows)]
fn steam_running() -> bool {
    sysinfo::System::new_all()
        .processes_by_exact_name("steam.exe".as_ref())
        .next()
        .is_some()
}

#[cfg(windows)]
pub fn uninstall(app: &tauri::AppHandle, id: &str) -> Result<(), String> {
    use std::time::{Duration, Instant};
    let app_id = library::steam_app_id(id).ok_or("uninstallUnavailable")?;
    // Closing Steam would also close whatever game it is running.
    if library::running_steam_app().is_some() {
        return Err("uninstallSteamRunning".into());
    }
    let root = library::steam_root().ok_or("uninstallUnavailable")?;
    let library_dir = library::steam_libraries()
        .into_iter()
        .find(|lib| lib.join("steamapps").join(format!("appmanifest_{app_id}.acf")).is_file())
        .ok_or("gameNoLongerInstalled")?;
    let removal = removal(&library_dir, app_id)?;
    let was_running = steam_running();
    if was_running {
        crate::log::info(app, "uninstall: closing Steam in the background");
        std::process::Command::new(root.join("steam.exe"))
            .arg("-shutdown")
            .spawn()
            .map_err(|_| "steamCloseFailed")?;
        let started = Instant::now();
        while steam_running() {
            if started.elapsed() > Duration::from_secs(40) {
                return Err("steamCloseFailed".into());
            }
            std::thread::sleep(Duration::from_millis(500));
        }
    }
    let result = removal.apply();
    crate::log::info(app, format!("uninstall: steam:{app_id} removed: {}", result.is_ok()));
    if was_running {
        // Back to the tray, never on screen.
        let _ = std::process::Command::new(root.join("steam.exe")).arg("-silent").spawn();
    }
    result
}

#[cfg(not(windows))]
pub fn uninstall(_app: &tauri::AppHandle, _id: &str) -> Result<(), String> {
    Err("uninstallUnavailable".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn library_with(installdir: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "sofa-steam-{}-{}",
            std::process::id(),
            installdir.len()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("steamapps/common/Portal 2")).unwrap();
        fs::write(
            root.join("steamapps/appmanifest_620.acf"),
            format!("\"AppState\"\n{{\n\t\"appid\"\t\t\"620\"\n\t\"installdir\"\t\t\"{installdir}\"\n}}"),
        )
        .unwrap();
        root
    }

    #[test]
    fn removes_only_the_titles_own_folder_and_manifest() {
        let root = library_with("Portal 2");
        let plan = removal(&root, "620").unwrap();
        assert!(plan.folder.as_ref().unwrap().ends_with("steamapps/common/Portal 2"));
        plan.apply().unwrap();
        assert!(!root.join("steamapps/common/Portal 2").exists());
        assert!(!root.join("steamapps/appmanifest_620.acf").exists());
        assert!(root.join("steamapps/common").exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn refuses_names_that_leave_the_common_folder() {
        for name in ["..", "../..", "..\\\\Windows", "C:\\\\Games", ""] {
            let root = library_with(name);
            assert!(removal(&root, "620").is_err(), "{name}");
            assert!(root.join("steamapps/common/Portal 2").exists());
            let _ = fs::remove_dir_all(root);
        }
    }

    #[cfg(unix)]
    #[test]
    fn refuses_a_linked_folder() {
        let root = library_with("Linked");
        std::os::unix::fs::symlink(root.join("steamapps/common/Portal 2"), root.join("steamapps/common/Linked")).unwrap();
        assert_eq!(removal(&root, "620"), Err("unsafeUninstallPath".into()));
        let _ = fs::remove_dir_all(root);
    }
}
