//! Per-game quick settings (power profile, display mode, brightness), saved from the HUD and
//! applied by `launch` before the game starts. Stored in `game-settings.json` (app data dir)
//! because the HUD runs in other windows and origins than the library.
use crate::{ally::AllyProfile, display::Mode};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::Manager;

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct GameSettings {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile: Option<AllyProfile>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mode: Option<Mode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub brightness: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tdp: Option<u8>,
}

type Store = HashMap<String, GameSettings>;

fn file(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("game-settings.json"))
}

fn load(app: &tauri::AppHandle) -> Store {
    file(app)
        .and_then(|f| std::fs::read_to_string(f).ok())
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

pub fn get(app: &tauri::AppHandle, id: &str) -> Option<GameSettings> {
    load(app).remove(id)
}

#[tauri::command]
pub async fn game_settings(id: String, app: tauri::AppHandle) -> Option<GameSettings> {
    get(&app, &id)
}

/// `settings: null` forgets the game.
#[tauri::command]
pub async fn set_game_settings(
    id: String,
    settings: Option<GameSettings>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    if crate::library::steam_app_id(&id).is_none() && !id.starts_with("epic:") && !id.starts_with("gog:") {
        return Err("invalidInput".into());
    }
    let mut store = load(&app);
    match settings {
        Some(s) => drop(store.insert(id, s)),
        None => drop(store.remove(&id)),
    }
    let path = file(&app).ok_or("serviceUnavailable")?;
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let json = serde_json::to_vec(&store).map_err(|_| "serviceUnavailable")?;
    std::fs::write(path, json).map_err(|_| "serviceUnavailable".to_string())
}

/// Applies a game's saved settings; each one is best effort and logged, never blocking the launch.
pub async fn apply(app: &tauri::AppHandle, id: &str) {
    let Some(s) = get(app, id) else { return };
    crate::log::info(app, format!("launch: applying saved settings for {id}"));
    if let Some(profile) = s.profile
        && let Err(e) = crate::ally::set_ally_profile(profile).await {
            crate::log::info(app, format!("launch: profile failed: {e}"));
        }
    if let Some(watts) = s.tdp
        && let Err(e) = crate::ally::set_tdp(watts).await {
            crate::log::info(app, format!("launch: tdp failed: {e}"));
        }
    if let Some(mode) = s.mode
        && let Err(e) = crate::display::set_display_mode(mode).await {
            crate::log::info(app, format!("launch: display mode failed: {e}"));
        }
    if let Some(percent) = s.brightness
        && let Err(e) = crate::display::set_brightness(percent).await {
            crate::log::info(app, format!("launch: brightness failed: {e}"));
        }
}
