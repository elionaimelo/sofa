#[cfg(not(windows))]
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
#[cfg(windows)]
fn show_hud(app: &tauri::AppHandle) -> Result<(), String> {
    crate::widget::open_game_bar(app)
}

// Desktop preview only. In Windows games, Game Bar owns the overlay surface.
#[cfg(not(windows))]
fn show_hud(app: &tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("hud") {
        window.show().map_err(|_| "openFailed")?;
        window.set_focus().map_err(|_| "openFailed")?;
        return Ok(());
    }
    WebviewWindowBuilder::new(app, "hud", WebviewUrl::App("index.html?hud=1".into()))
        .title("Sofa HUD")
        .inner_size(460.0, 640.0)
        .position(24.0, 24.0)
        .decorations(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .build()
        .map_err(|_| "openFailed")?
        .set_focus()
        .map_err(|_| "openFailed")?;
    Ok(())
}

#[tauri::command]
pub async fn open_hud(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || show_hud(&app))
        .await.map_err(|_| "openFailed")?
}

/// View + Menu opens Game Bar from Sofa or a game, just like Sofa's HUD buttons.
/// The Ally Command Center button is handled separately by `ally_input`.
#[cfg(windows)]
pub fn watch_controller(app: tauri::AppHandle) {
    use windows_sys::Win32::UI::Input::XboxController::*;
    std::thread::spawn(move || {
        let mut connected = [true; 4];
        let mut was_held = false;
        for tick in 0u32.. {
            std::thread::sleep(std::time::Duration::from_millis(50));
            let mut held = false;
            for (index, live) in connected.iter_mut().enumerate() {
                // Polling empty slots is slow in XInput; probe them every 2 s only.
                if !*live && tick % 40 != 0 {
                    continue;
                }
                let mut state = XINPUT_STATE::default();
                *live = unsafe { XInputGetState(index as u32, &mut state) } == 0;
                let chord = XINPUT_GAMEPAD_BACK | XINPUT_GAMEPAD_START;
                held |= *live && state.Gamepad.wButtons & chord == chord;
            }
            if held && !was_held {
                if let Err(error) = show_hud(&app) {
                    crate::log::info(&app, format!("hud: Game Bar launch failed: {error}"));
                }
            }
            was_held = held;
        }
    });
}
