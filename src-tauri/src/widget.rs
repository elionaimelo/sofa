//! The Xbox Game Bar widget package (`widget/`): whether it's installed, and a repair that
//! re-runs `packaging/widget.ps1` elevated (UAC) when the installer couldn't add it.
use tauri::Manager;

/// Installed widget version, or None.
#[tauri::command]
pub async fn widget_status(app: tauri::AppHandle) -> Option<String> {
    let version = tauri::async_runtime::spawn_blocking(installed_version)
        .await
        .ok()
        .flatten();
    crate::log::info(&app, format!("widget: installed {version:?}"));
    version
}

/// Opens an elevated PowerShell for `widget.ps1`; returns once it's started (UAC may still be
/// pending). The script logs every step to sofa.log.
#[tauri::command]
pub async fn install_widget(app: tauri::AppHandle) -> Result<(), String> {
    let script = app
        .path()
        .resource_dir()
        .map_err(|_| "settingUnavailable")?
        .join("packaging")
        .join("widget.ps1");
    if !script.is_file() {
        return Err("settingUnavailable".into());
    }
    crate::log::info(&app, "widget: install requested");
    start_elevated(&script)
}

#[cfg(windows)]
fn installed_version() -> Option<String> {
    let out = crate::ally::powershell(
        "(Get-AppxPackage -Name Sofa.Widget | Select-Object -First 1).Version.ToString()",
    )
    .ok()?;
    Some(out.trim().to_owned()).filter(|v| !v.is_empty())
}

#[cfg(windows)]
fn start_elevated(script: &std::path::Path) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    let powershell = crate::system_exe(r"WindowsPowerShell\v1.0\powershell.exe").ok_or("settingUnavailable")?;
    // Single-quoted PowerShell literal: double any quote in the path.
    let path = script.display().to_string().replace('\'', "''");
    let command = format!(
        "Start-Process -FilePath '{}' -Verb RunAs -WindowStyle Hidden -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -File \"' + '{path}' + '\"')",
        powershell.display().to_string().replace('\'', "''"),
    );
    std::process::Command::new(&powershell)
        .args(["-NoProfile", "-NonInteractive", "-Command", &command])
        .creation_flags(0x08000000)
        .spawn()
        .map(|_| ())
        .map_err(|_| "settingUnavailable".to_string())
}

#[cfg(not(windows))]
fn installed_version() -> Option<String> {
    None
}

#[cfg(not(windows))]
fn start_elevated(_script: &std::path::Path) -> Result<(), String> {
    Err("settingUnavailable".into())
}
