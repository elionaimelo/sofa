use crate::{library, network};
use serde::Deserialize;
use std::{
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

const STORE: &str = "https://store.steampowered.com/";

#[derive(Default)]
pub struct SteamLibrarySession(Mutex<Session>);

#[derive(Default)]
struct Session {
    generation: u64,
    /// Owned games while connected; install requests are checked against it.
    games: Option<Vec<library::Game>>,
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

// steamLoginSecure is "<SteamID64>%7C%7C<token>".
fn steam_id_from_cookie(cookie: &str) -> Option<String> {
    let id = cookie.split(['%', '|']).next()?;
    (id.len() == 17 && id.bytes().all(|b| b.is_ascii_digit())).then(|| id.to_owned())
}

/// Every window shares one persistent cookie store, so a Steam login survives restarts.
fn saved_cookie(app: &tauri::AppHandle) -> Option<String> {
    app.get_webview_window("main")?
        .cookies_for_url(STORE.parse().unwrap())
        .ok()?
        .into_iter()
        .find(|c| c.name() == "steamLoginSecure")
        .map(|c| c.value().to_owned())
}

/// Opens a Steam page and waits for a new session cookie.
/// Visible: Steam's own login page, so Sofa never sees the password.
/// Hidden: Steam renews an expired session from the refresh token it saved at login.
async fn new_cookie(app: &tauri::AppHandle, visible: bool) -> Result<String, String> {
    let stale = saved_cookie(app);
    let page = if visible { "https://store.steampowered.com/login/" } else { STORE };
    let mut builder = WebviewWindowBuilder::new(app, "steam-login", WebviewUrl::External(page.parse().unwrap()))
        .title("Steam")
        .inner_size(520.0, 760.0)
        .center()
        .visible(visible)
        .focused(visible);
    if let Some(main) = app.get_webview_window("main").filter(|_| visible) {
        builder = builder.parent(&main).map_err(|_| "openFailed")?;
    }
    let window = builder.build().map_err(|_| "openFailed")?;
    let started = Instant::now();
    loop {
        tokio::time::sleep(Duration::from_millis(500)).await;
        if app.get_webview_window("steam-login").is_none() {
            return Err("steamLoginCancelled".into());
        }
        if !visible && started.elapsed() > Duration::from_secs(20) {
            let _ = window.close();
            return Err("steamSessionExpired".into());
        }
        // Fails while the window is closing; the next tick reports the cancel.
        let Ok(cookies) = window.cookies_for_url(STORE.parse().unwrap()) else { continue };
        let fresh = cookies
            .into_iter()
            .find(|c| c.name() == "steamLoginSecure")
            .map(|c| c.value().to_owned())
            .filter(|value| Some(value) != stale.as_ref());
        if let Some(value) = fresh {
            let _ = window.close();
            return Ok(value);
        }
    }
}

async fn fetch_owned(cookie: &str) -> Result<Vec<library::Game>, String> {
    let steam_id = steam_id_from_cookie(cookie).ok_or("invalidResponse")?;
    let client = network::client()?;
    let config: serde_json::Value = network::json(
        client
            .get("https://store.steampowered.com/pointssummary/ajaxgetasyncconfig")
            .header("cookie", format!("steamLoginSecure={cookie}")),
    )
    .await?;
    let token = config["data"]["webapi_token"]
        .as_str()
        .ok_or("steamSessionExpired")?;
    let response: OwnedResponse = network::json(
        client
            .get("https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/")
            .query(&[
                ("access_token", token),
                ("steamid", &steam_id),
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
        .map(|(appid, name)| library::steam_game(appid, name, false))
        .collect();
    games.sort_by(|a, b| a.id.cmp(&b.id));
    games.dedup_by(|a, b| a.id == b.id);
    Ok(games)
}

/// Uses the saved session, renewing it when expired; `sign_in` falls back to Steam's login page.
async fn owned_games(app: &tauri::AppHandle, sign_in: bool) -> Result<Vec<library::Game>, String> {
    if let Some(cookie) = saved_cookie(app) {
        match fetch_owned(&cookie).await {
            Err(e) if e == "steamSessionExpired" => {}
            result => return result,
        }
        match new_cookie(app, false).await {
            Ok(cookie) => return fetch_owned(&cookie).await,
            Err(e) if !sign_in => return Err(e),
            Err(_) => {}
        }
    } else if !sign_in {
        return Err("notConnected".into());
    }
    fetch_owned(&new_cookie(app, true).await?).await
}

fn store_games(
    session: &SteamLibrarySession,
    generation: u64,
    games: &[library::Game],
) -> Result<(), String> {
    let mut session = session.0.lock().map_err(|_| "serviceUnavailable")?;
    if session.generation != generation {
        return Err("notConnected".into());
    }
    session.games = Some(games.to_vec());
    Ok(())
}

/// `sign_in: false` only restores a saved session (used at startup).
#[tauri::command]
pub async fn connect_steam_library(
    sign_in: bool,
    app: tauri::AppHandle,
    session: tauri::State<'_, SteamLibrarySession>,
) -> Result<Vec<library::Game>, String> {
    let generation = {
        let mut session = session.0.lock().map_err(|_| "serviceUnavailable")?;
        session.generation = session.generation.wrapping_add(1);
        session.games = None;
        session.generation
    };
    let games = owned_games(&app, sign_in).await?;
    store_games(&session, generation, &games)?;
    Ok(games)
}

#[tauri::command]
pub async fn refresh_steam_library(
    app: tauri::AppHandle,
    session: tauri::State<'_, SteamLibrarySession>,
) -> Result<Vec<library::Game>, String> {
    let generation = {
        let session = session.0.lock().map_err(|_| "serviceUnavailable")?;
        session.games.as_ref().ok_or("notConnected")?;
        session.generation
    };
    let games = owned_games(&app, false).await?;
    store_games(&session, generation, &games)?;
    Ok(games)
}

/// Signs out for real: forgets the games and deletes Steam's cookies, refresh token included.
#[tauri::command]
pub async fn disconnect_steam_library(
    app: tauri::AppHandle,
    session: tauri::State<'_, SteamLibrarySession>,
) -> Result<(), String> {
    {
        let mut session = session.0.lock().map_err(|_| "serviceUnavailable")?;
        session.generation = session.generation.wrapping_add(1);
        session.games = None;
    }
    let main = app.get_webview_window("main").ok_or("serviceUnavailable")?;
    for cookie in main.cookies().map_err(|_| "serviceUnavailable")? {
        let steam = cookie
            .domain()
            .is_some_and(|d| d.ends_with("steampowered.com") || d.ends_with("steamcommunity.com"));
        if steam {
            main.delete_cookie(cookie).map_err(|_| "serviceUnavailable")?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn install_owned_game(
    id: String,
    session: tauri::State<'_, SteamLibrarySession>,
) -> Result<(), String> {
    let app_id = library::steam_app_id(&id).ok_or("installUnavailable")?;
    let session = session.0.lock().map_err(|_| "serviceUnavailable")?;
    let games = session.games.as_ref().ok_or("notConnected")?;
    if !games.iter().any(|game| game.id == id) {
        return Err("installUnavailable".into());
    }
    tauri_plugin_opener::open_url(&format!("steam://install/{app_id}"), None::<&str>)
        .map_err(|_| "openFailed".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_steam_id_from_login_cookie() {
        assert_eq!(steam_id_from_cookie("76561198000000000%7C%7Ctoken").as_deref(), Some("76561198000000000"));
        assert_eq!(steam_id_from_cookie("76561198000000000||token").as_deref(), Some("76561198000000000"));
        assert_eq!(steam_id_from_cookie("bad%7C%7Ctoken"), None);
        assert_eq!(steam_id_from_cookie(""), None);
    }
}
