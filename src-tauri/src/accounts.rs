use crate::{library, network};
use serde::Deserialize;
use std::{sync::Mutex, time::Duration};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

#[derive(Default)]
pub struct SteamLibrarySession(Mutex<Session>);

#[derive(Default)]
struct Session {
    generation: u64,
    account: Option<SteamAccount>,
}

struct SteamAccount {
    // ponytail: Steam's web session lasts about a day; persist a refresh token if reconnecting gets annoying.
    cookie: String,
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

// steamLoginSecure is "<SteamID64>%7C%7C<token>".
fn steam_id_from_cookie(cookie: &str) -> Option<String> {
    let id = cookie.split(['%', '|']).next()?;
    (id.len() == 17 && id.bytes().all(|b| b.is_ascii_digit())).then(|| id.to_owned())
}

// Steam's own login page in a private window: Sofa never sees the password, only the session cookie.
async fn sign_in(app: &tauri::AppHandle) -> Result<String, String> {
    let store: tauri::Url = "https://store.steampowered.com/".parse().unwrap();
    let mut builder = WebviewWindowBuilder::new(
        app,
        "steam-login",
        WebviewUrl::External("https://store.steampowered.com/login/".parse().unwrap()),
    )
    .title("Steam")
    .inner_size(520.0, 760.0)
    .center()
    .incognito(true);
    if let Some(main) = app.get_webview_window("main") {
        builder = builder.parent(&main).map_err(|_| "openFailed")?;
    }
    let window = builder.build().map_err(|_| "openFailed")?;
    loop {
        tokio::time::sleep(Duration::from_millis(500)).await;
        if app.get_webview_window("steam-login").is_none() {
            return Err("steamLoginCancelled".into());
        }
        // Fails while the window is closing; the next tick reports the cancel.
        let Ok(cookies) = window.cookies_for_url(store.clone()) else { continue };
        if let Some(cookie) = cookies.iter().find(|c| c.name() == "steamLoginSecure") {
            let value = cookie.value().to_owned();
            let _ = window.close();
            return Ok(value);
        }
    }
}

async fn fetch_owned(cookie: &str, steam_id: &str) -> Result<Vec<library::Game>, String> {
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
    app: tauri::AppHandle,
    session: tauri::State<'_, SteamLibrarySession>,
) -> Result<Vec<library::Game>, String> {
    let cookie = sign_in(&app).await?;
    let steam_id = steam_id_from_cookie(&cookie).ok_or("invalidResponse")?;
    let generation = {
        let mut session = session.0.lock().map_err(|_| "serviceUnavailable")?;
        session.generation = session.generation.wrapping_add(1);
        session.account = None;
        session.generation
    };
    let games = fetch_owned(&cookie, &steam_id).await?;
    let mut session = session.0.lock().map_err(|_| "serviceUnavailable")?;
    if session.generation != generation {
        return Err("notConnected".into());
    }
    session.account = Some(SteamAccount {
        cookie,
        steam_id,
        games: games.clone(),
    });
    Ok(games)
}

#[tauri::command]
pub async fn refresh_steam_library(
    session: tauri::State<'_, SteamLibrarySession>,
) -> Result<Vec<library::Game>, String> {
    let (generation, cookie, steam_id) = {
        let session = session.0.lock().map_err(|_| "serviceUnavailable")?;
        let account = session.account.as_ref().ok_or("notConnected")?;
        (session.generation, account.cookie.clone(), account.steam_id.clone())
    };
    let games = fetch_owned(&cookie, &steam_id).await?;
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
    fn reads_steam_id_from_login_cookie() {
        assert_eq!(steam_id_from_cookie("76561198000000000%7C%7Ctoken").as_deref(), Some("76561198000000000"));
        assert_eq!(steam_id_from_cookie("76561198000000000||token").as_deref(), Some("76561198000000000"));
        assert_eq!(steam_id_from_cookie("bad%7C%7Ctoken"), None);
        assert_eq!(steam_id_from_cookie(""), None);
    }
}
