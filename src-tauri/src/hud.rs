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
#[tauri::command]
pub async fn open_hud(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("hud") {
        window.show().map_err(|_| "openFailed")?;
        window.set_focus().map_err(|_| "openFailed")?;
        return Ok(());
    }
    WebviewWindowBuilder::new(&app, "hud", WebviewUrl::App("index.html?hud=1".into()))
        .title("Sofa HUD")
        .inner_size(430.0, 350.0)
        .position(24.0, 24.0)
        .decorations(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .build()
        .map_err(|_| "openFailed")?;
    Ok(())
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
