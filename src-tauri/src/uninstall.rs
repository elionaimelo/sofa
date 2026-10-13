use crate::library;
use std::sync::atomic::{AtomicBool, Ordering};
#[derive(Default)]
pub struct UninstallState(AtomicBool);
struct Operation<'a>(&'a AtomicBool);
impl Drop for Operation<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

fn steam_target(id: &str) -> Result<String, String> {
    let app_id = id
        .strip_prefix("steam:")
        .filter(|v| !v.is_empty() && v.len() <= 10 && v.bytes().all(|b| b.is_ascii_digit()))
        .ok_or("uninstallUnavailable")?;
    Ok(format!("steam://uninstall/{app_id}"))
}
/// Re-resolve a scanned identifier; the webview cannot submit a command, path or uninstall URL.
#[tauri::command]
pub async fn uninstall_game(
    id: String,
    confirmed: bool,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, UninstallState>,
) -> Result<bool, String> {
    if window.label() != "main" || !confirmed {
        return Err("confirmationRequired".into());
    }
    if state
        .0
        .compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed)
        .is_err()
    {
        return Err("uninstallBusy".into());
    }
    let _operation = Operation(&state.0);
    let game = library::scan()
        .into_iter()
        .find(|g| g.id == id)
        .ok_or("gameNoLongerInstalled")?;
    match game.source {
        "steam" => {
            tauri_plugin_opener::open_url(&steam_target(&id)?, None::<&str>)
                .map_err(|_| "openFailed")?;
            Ok(false)
        }
        "epic" => {
            let app = id
                .strip_prefix("epic:")
                .ok_or("uninstallUnavailable")?
                .to_owned();
            tauri::async_runtime::spawn_blocking(move || crate::epic_uninstall::uninstall(&app))
                .await
                .map_err(|_| "uninstallFailed")??;
            Ok(true)
        }
        "gog" => {
            uninstall_gog(&id)?;
            Ok(false)
        }
        _ => Err("uninstallUnavailable".into()),
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn uninstall_only_accepts_a_numeric_steam_title_never_a_command_or_other_app() {
        assert_eq!(steam_target("steam:620").unwrap(), "steam://uninstall/620");
        for id in [
            "",
            "gog:620",
            "steam:620;shutdown",
            "steam://uninstall/620",
            "steam:",
            "steam:1/2",
            "steam:12345678901",
        ] {
            assert!(steam_target(id).is_err());
        }
    }
}

#[cfg(windows)]
fn uninstall_gog(id: &str) -> Result<(), String> {
    use std::{fs, path::PathBuf};
    use winreg::{RegKey, enums::HKEY_LOCAL_MACHINE};
    let product = id
        .strip_prefix("gog:")
        .filter(|v| !v.is_empty() && v.bytes().all(|b| b.is_ascii_digit()))
        .ok_or("uninstallUnavailable")?;
    let key = RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey(format!(r"SOFTWARE\WOW6432Node\GOG.com\Games\{product}"))
        .map_err(|_| "uninstallUnavailable")?;
    let path = key
        .get_value::<String, _>("path")
        .or_else(|_| key.get_value("PATH"))
        .map_err(|_| "uninstallUnavailable")?;
    let root = fs::canonicalize(PathBuf::from(path)).map_err(|_| "uninstallUnavailable")?;
    if root.components().count() < 3 {
        return Err("unsafeUninstallPath".into());
    }
    for name in ["unins000.exe", "unins001.exe", "unins002.exe"] {
        let candidate = root.join(name);
        let Ok(meta) = fs::symlink_metadata(&candidate) else {
            continue;
        };
        use std::os::windows::fs::MetadataExt;
        if !meta.is_file() || meta.file_attributes() & 0x400 != 0 {
            continue;
        }
        let executable = fs::canonicalize(candidate).map_err(|_| "uninstallUnavailable")?;
        if executable.parent() != Some(root.as_path()) {
            return Err("unsafeUninstallPath".into());
        }
        return tauri_plugin_opener::open_path(executable, None::<&str>)
            .map_err(|_| "openFailed".into());
    }
    Err("uninstallUnavailable".into())
}
#[cfg(not(windows))]
fn uninstall_gog(_: &str) -> Result<(), String> {
    Err("uninstallUnavailable".into())
}
