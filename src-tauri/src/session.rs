//! Tracks the running Steam game: current session length and total play time per game,
//! persisted in `playtime.json` under the app data dir.
use crate::library::{self, Game};
use serde::Serialize;
use std::{
    collections::HashMap,
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::Manager;

#[derive(Default)]
pub struct Playtime(Mutex<Inner>);

#[derive(Default)]
struct Inner {
    current: Option<(Game, Instant)>,
    /// Seconds per game id, finished sessions only.
    totals: HashMap<String, u64>,
    loaded: bool,
}

#[derive(Serialize, Clone)]
pub struct CurrentSession {
    pub game: Game,
    pub session_seconds: u64,
    pub total_seconds: u64,
}

fn file(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("playtime.json"))
}

fn load(app: &tauri::AppHandle, inner: &mut Inner) {
    if inner.loaded {
        return;
    }
    inner.loaded = true;
    if let Some(text) = file(app).and_then(|f| std::fs::read_to_string(f).ok()) {
        inner.totals = serde_json::from_str(&text).unwrap_or_default();
    }
}

fn save(app: &tauri::AppHandle, totals: &HashMap<String, u64>) {
    let Some(path) = file(app) else { return };
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(json) = serde_json::to_vec(totals) {
        let _ = std::fs::write(path, json);
    }
}

/// Polls the Steam client's RunningAppID; a change closes one session and opens the next.
pub fn watch(app: tauri::AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(5));
        let running = library::running_steam_app().map(|id| format!("steam:{id}"));
        let state = app.state::<Playtime>();
        let Ok(mut inner) = state.0.lock() else { continue };
        load(&app, &mut inner);
        if inner.current.as_ref().map(|(g, _)| &g.id) == running.as_ref() {
            continue;
        }
        if let Some((game, started)) = inner.current.take() {
            *inner.totals.entry(game.id).or_default() += started.elapsed().as_secs();
            save(&app, &inner.totals);
        }
        // Scanning only on change keeps the 5 s tick cheap.
        inner.current = running
            .and_then(|id| library::scan().into_iter().find(|g| g.id == id))
            .map(|game| (game, Instant::now()));
    });
}

#[tauri::command]
pub async fn current_session(
    app: tauri::AppHandle,
    state: tauri::State<'_, Playtime>,
) -> Result<Option<CurrentSession>, String> {
    let mut inner = state.0.lock().map_err(|_| "serviceUnavailable")?;
    load(&app, &mut inner);
    Ok(inner.current.as_ref().map(|(game, started)| {
        let session_seconds = started.elapsed().as_secs();
        CurrentSession {
            game: game.clone(),
            session_seconds,
            total_seconds: inner.totals.get(&game.id).copied().unwrap_or(0) + session_seconds,
        }
    }))
}

/// Finished play time per game id, in seconds (the running game's session isn't included).
#[tauri::command]
pub async fn playtimes(
    app: tauri::AppHandle,
    state: tauri::State<'_, Playtime>,
) -> Result<HashMap<String, u64>, String> {
    let mut inner = state.0.lock().map_err(|_| "serviceUnavailable")?;
    load(&app, &mut inner);
    Ok(inner.totals.clone())
}
