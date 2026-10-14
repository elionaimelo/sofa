//! Game Bar activation and installation of Sofa's widget package (`widget/`).
use tauri::Manager;

/// Use the Windows Game Bar shortcut. A successful protocol launch does not show the overlay.
#[cfg(windows)]
pub fn open_game_bar(app: &tauri::AppHandle) -> Result<(), String> {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::*;
    let key = |code, flags| INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: code, dwFlags: flags, ..Default::default() } },
    };
    // Do not release keys the user is physically holding or turn Win+G into another shortcut.
    for code in [VK_LWIN, VK_RWIN, VK_CONTROL, VK_MENU, VK_SHIFT, VK_G] {
        // Each code is a valid virtual key; this only reads its current state.
        if unsafe { GetAsyncKeyState(code as i32) } < 0 {
            crate::log::info(app, "hud: Game Bar shortcut blocked by held keyboard keys");
            return Err("hudOpenFailed".into());
        }
    }
    let inputs = [key(VK_LWIN, 0), key(VK_G, 0), key(VK_G, KEYEVENTF_KEYUP), key(VK_LWIN, KEYEVENTF_KEYUP)];
    let size = std::mem::size_of::<INPUT>() as i32;
    // The array contains initialized keyboard inputs and remains alive for this call.
    let sent = unsafe { SendInput(inputs.len() as u32, inputs.as_ptr(), size) };
    crate::log::info(app, format!("hud: Game Bar shortcut sent {sent}/{} inputs", inputs.len()));
    if sent != inputs.len() as u32 {
        if sent > 0 {
            let release = [key(VK_G, KEYEVENTF_KEYUP), key(VK_LWIN, KEYEVENTF_KEYUP)];
            // Balance any key-down events inserted before a partial failure.
            unsafe { SendInput(release.len() as u32, release.as_ptr(), size) };
        }
        return Err("hudOpenFailed".into());
    }
    Ok(())
}

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

/// Wait for UAC and the installer, then verify that this user has the widget registered.
#[tauri::command]
pub async fn install_widget(app: tauri::AppHandle) -> Result<(), String> {
    let script = app
        .path()
        .resource_dir()
        .map_err(|_| "hudWidgetInstallFailed")?
        .join("packaging")
        .join("widget.ps1");
    if !script.is_file() {
        crate::log::info(&app, "widget: install script missing");
        return Err("hudWidgetInstallFailed".into());
    }
    crate::log::info(&app, "widget: install requested");
    let result = tauri::async_runtime::spawn_blocking(move || {
        start_elevated(&script)?;
        installed_version().ok_or_else(|| "hudWidgetInstallFailed".to_string())
    }).await.map_err(|_| "hudWidgetInstallFailed")?;
    match result {
        Ok(version) => {
            crate::log::info(&app, format!("widget: installation verified {version}"));
            Ok(())
        }
        Err(error) => {
            crate::log::info(&app, "widget: installation failed, cancelled, or timed out; see script log");
            Err(error)
        }
    }
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
    let powershell = crate::system_exe(r"WindowsPowerShell\v1.0\powershell.exe").ok_or("hudWidgetInstallFailed")?;
    // Single-quoted PowerShell literal: double any quote in the path.
    let path = script.display().to_string().replace('\'', "''");
    let command = format!(
        "$ErrorActionPreference = 'Stop'; $process = Start-Process -FilePath '{}' -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -File \"' + '{path}' + '\"'); exit $process.ExitCode",
        powershell.display().to_string().replace('\'', "''"),
    );
    crate::ally::powershell_with_timeout(&command, std::time::Duration::from_secs(180))
        .map(|_| ())
        .map_err(|_| "hudWidgetInstallFailed".to_string())
}

#[cfg(not(windows))]
fn installed_version() -> Option<String> {
    None
}

#[cfg(not(windows))]
fn start_elevated(_script: &std::path::Path) -> Result<(), String> {
    Err("hudWidgetInstallFailed".into())
}
