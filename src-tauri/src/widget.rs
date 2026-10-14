//! Xbox Game Bar activation. The widget package itself (`widget/`) is installed by the installer
//! through `packaging/widget.ps1`.

/// Win+G opens Game Bar; Win+Tab opens the task switcher of the Xbox full screen experience.
#[cfg(windows)]
pub fn open_game_bar(app: &tauri::AppHandle) -> Result<(), String> {
    shortcut(app, windows_sys::Win32::UI::Input::KeyboardAndMouse::VK_G, "G")
}
#[cfg(windows)]
pub fn open_task_switcher(app: &tauri::AppHandle) -> Result<(), String> {
    shortcut(app, windows_sys::Win32::UI::Input::KeyboardAndMouse::VK_TAB, "Tab")
}

/// Presses Win + `code`. A successful protocol launch does not show these overlays.
#[cfg(windows)]
fn shortcut(app: &tauri::AppHandle, code: u16, name: &str) -> Result<(), String> {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::*;
    let key = |code, flags| INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: code, dwFlags: flags, ..Default::default() } },
    };
    // Do not release keys the user is physically holding or turn the chord into another shortcut.
    for held in [VK_LWIN, VK_RWIN, VK_CONTROL, VK_MENU, VK_SHIFT, code] {
        // Each code is a valid virtual key; this only reads its current state.
        if unsafe { GetAsyncKeyState(held as i32) } < 0 {
            crate::log::info(app, format!("hud: Win+{name} blocked by held keyboard keys"));
            return Err("hudOpenFailed".into());
        }
    }
    let inputs = [key(VK_LWIN, 0), key(code, 0), key(code, KEYEVENTF_KEYUP), key(VK_LWIN, KEYEVENTF_KEYUP)];
    let size = std::mem::size_of::<INPUT>() as i32;
    // The array contains initialized keyboard inputs and remains alive for this call.
    let sent = unsafe { SendInput(inputs.len() as u32, inputs.as_ptr(), size) };
    crate::log::info(app, format!("hud: Win+{name} sent {sent}/{} inputs", inputs.len()));
    if sent != inputs.len() as u32 {
        if sent > 0 {
            let release = [key(code, KEYEVENTF_KEYUP), key(VK_LWIN, KEYEVENTF_KEYUP)];
            // Balance any key-down events inserted before a partial failure.
            unsafe { SendInput(release.len() as u32, release.as_ptr(), size) };
        }
        return Err("hudOpenFailed".into());
    }
    Ok(())
}
