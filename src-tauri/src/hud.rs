use serde::Serialize;
use std::{
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
pub struct Telemetry(Mutex<Sample>);
struct Sample {
    system: sysinfo::System,
    started: Option<Instant>,
    cached: Metrics,
}
#[derive(Serialize, Clone, Default)]
pub struct Metrics {
    cpu: Option<f32>,
    used_memory: u64,
    total_memory: u64,
}
impl Default for Telemetry {
    fn default() -> Self {
        Self(Mutex::new(Sample {
            system: sysinfo::System::new(),
            started: None,
            cached: Metrics::default(),
        }))
    }
}
fn read_metrics(state: &Telemetry) -> Result<Metrics, String> {
    let mut sample = state.0.lock().map_err(|_| "serviceUnavailable")?;
    if sample
        .started
        .is_some_and(|at| at.elapsed() < Duration::from_secs(1))
    {
        return Ok(sample.cached.clone());
    }
    let warmed_up = sample.started.is_some();
    sample.system.refresh_cpu_usage();
    sample.system.refresh_memory();
    sample.cached = Metrics {
        cpu: warmed_up.then(|| sample.system.global_cpu_usage()),
        used_memory: sample.system.used_memory(),
        total_memory: sample.system.total_memory(),
    };
    sample.started = Some(Instant::now());
    Ok(sample.cached.clone())
}
#[tauri::command]
pub async fn system_metrics(state: tauri::State<'_, Telemetry>) -> Result<Metrics, String> {
    read_metrics(&state)
}
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
    show_hud(&app)
}

/// Holding View + Menu on any XInput pad toggles the HUD, even while a game has focus.
/// Game Bar owns the Xbox/Command Center buttons; Sofa can't claim them without a UWP widget.
#[cfg(windows)]
pub fn watch_controller(app: tauri::AppHandle) {
    use windows_sys::Win32::UI::Input::XboxController::*;
    std::thread::spawn(move || {
        let mut connected = [true; 4];
        let mut was_held = false;
        for tick in 0u32.. {
            std::thread::sleep(Duration::from_millis(50));
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
                match app.get_webview_window("hud") {
                    Some(window) => drop(window.close()),
                    None => drop(show_hud(&app)),
                }
            }
            was_held = held;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore = "native telemetry integration"]
    fn native_metrics_warmup_and_cache() {
        let state = Telemetry::default();
        let first = read_metrics(&state).unwrap();
        assert!(first.total_memory > 0);
        assert!(first.cpu.is_none());
        assert!(read_metrics(&state).unwrap().cpu.is_none());
        std::thread::sleep(Duration::from_millis(1100));
        let next = read_metrics(&state).unwrap();
        assert!((0.0..=100.0).contains(&next.cpu.unwrap()));
        assert!(next.used_memory <= next.total_memory);
    }
}
