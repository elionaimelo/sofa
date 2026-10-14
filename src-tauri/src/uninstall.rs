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

/// Re-resolve a scanned identifier; the webview cannot submit a command, path or uninstall URL.
#[tauri::command]
pub async fn uninstall_game(
    id: String,
    confirmed: bool,
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, UninstallState>,
) -> Result<(), String> {
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
        "steam" => tauri::async_runtime::spawn_blocking(move || crate::steam_uninstall::uninstall(&app, &id))
            .await
            .map_err(|_| "uninstallFailed")?,
        "epic" => {
            let name = id
                .strip_prefix("epic:")
                .ok_or("uninstallUnavailable")?
                .to_owned();
            tauri::async_runtime::spawn_blocking(move || crate::epic_uninstall::uninstall(&name))
                .await
                .map_err(|_| "uninstallFailed")?
        }
        _ => Err("uninstallUnavailable".into()),
    }
}
