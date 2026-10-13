use crate::{library, network};
use serde::Deserialize;
use std::sync::Mutex;

#[derive(Default)]
pub struct SteamLibrarySession(Mutex<Session>);

#[derive(Default)]
struct Session {
    generation: u64,
    account: Option<SteamAccount>,
}

struct SteamAccount {
    key: String,
    steam_id: String,
    games: Vec<library::Game>,
}

#[derive(Deserialize)]
struct OwnedResponse {
    response: OwnedGames,
}

#[derive(Deserialize, Default)]
struct OwnedGames {
    #[serde(default)]
    games: Vec<OwnedApp>,
}

#[derive(Deserialize)]
struct OwnedApp {
    appid: u32,
    name: Option<String>,
}

fn valid_credentials(key: &str, steam_id: &str) -> bool {
    key.len() == 32
        && key.bytes().all(|b| b.is_ascii_hexdigit())
        && steam_id.len() == 17
        && steam_id.bytes().all(|b| b.is_ascii_digit())
}

async fn fetch_owned(key: &str, steam_id: &str) -> Result<Vec<library::Game>, String> {
    let response: OwnedResponse = network::json(
        network::client()?
            .get("https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/")
            .header("x-webapi-key", key)
            .query(&[
                ("steamid", steam_id),
                ("include_appinfo", "1"),
                ("include_played_free_games", "1"),
            ]),
    )
    .await?;
    let mut games: Vec<_> = response
        .response
        .games
        .into_iter()
        .filter_map(|app| app.name.map(|name| (app.appid, name.trim().to_owned())))
        .filter(|(_, name)| !name.is_empty())
        .map(|(appid, name)| library::Game {
            id: format!("steam:{appid}"),
            title: name,
            source: "steam",
            launch: format!("steam://rungameid/{appid}"),
            cover: Some(format!(
                "https://cdn.cloudflare.steamstatic.com/steam/apps/{}/library_600x900.jpg",
                appid
            )),
            installed: false,
        })
        .collect();
    games.sort_by(|a, b| a.id.cmp(&b.id));
    games.dedup_by(|a, b| a.id == b.id);
    Ok(games)
}

#[tauri::command]
pub async fn connect_steam_library(
    key: String,
    steam_id: String,
    session: tauri::State<'_, SteamLibrarySession>,
) -> Result<Vec<library::Game>, String> {
    if !valid_credentials(&key, &steam_id) {
        return Err("invalidSteamAccount".into());
    }
    let generation = {
        let mut session = session.0.lock().map_err(|_| "serviceUnavailable")?;
        session.generation = session.generation.wrapping_add(1);
        session.account = None;
        session.generation
    };
    let games = fetch_owned(&key, &steam_id).await?;
    let mut session = session.0.lock().map_err(|_| "serviceUnavailable")?;
    if session.generation != generation {
        return Err("notConnected".into());
    }
    session.account = Some(SteamAccount {
        key,
        steam_id,
        games: games.clone(),
    });
    Ok(games)
}

#[tauri::command]
pub async fn refresh_steam_library(
    session: tauri::State<'_, SteamLibrarySession>,
) -> Result<Vec<library::Game>, String> {
    let (generation, key, steam_id) = {
        let session = session.0.lock().map_err(|_| "serviceUnavailable")?;
        let account = session.account.as_ref().ok_or("notConnected")?;
        (session.generation, account.key.clone(), account.steam_id.clone())
    };
    let games = fetch_owned(&key, &steam_id).await?;
    let mut session = session.0.lock().map_err(|_| "serviceUnavailable")?;
    if session.generation != generation {
        return Err("notConnected".into());
    }
    if let Some(account) = session.account.as_mut() {
        account.games = games.clone();
    }
    Ok(games)
}

#[tauri::command]
pub fn disconnect_steam_library(
    session: tauri::State<'_, SteamLibrarySession>,
) -> Result<(), String> {
    let mut session = session.0.lock().map_err(|_| "serviceUnavailable")?;
    session.generation = session.generation.wrapping_add(1);
    session.account = None;
    Ok(())
}

#[tauri::command]
pub fn install_owned_game(
    id: String,
    session: tauri::State<'_, SteamLibrarySession>,
) -> Result<(), String> {
    let app_id = id.strip_prefix("steam:").ok_or("installUnavailable")?;
    if app_id.is_empty() || !app_id.bytes().all(|b| b.is_ascii_digit()) {
        return Err("installUnavailable".into());
    }
    let session = session.0.lock().map_err(|_| "serviceUnavailable")?;
    let account = session.account.as_ref().ok_or("notConnected")?;
    if !account.games.iter().any(|game| game.id == id) {
        return Err("installUnavailable".into());
    }
    tauri_plugin_opener::open_url(&format!("steam://install/{app_id}"), None::<&str>)
        .map_err(|_| "openFailed".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_user_credentials() {
        assert!(valid_credentials("0123456789abcdef0123456789abcdef", "76561198000000000"));
        assert!(!valid_credentials("bad", "76561198000000000"));
        assert!(!valid_credentials("0123456789abcdef0123456789abcdef", "not-an-id"));
    }
}
