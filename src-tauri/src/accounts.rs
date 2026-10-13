use crate::{library, network};
use serde::Deserialize;
use std::{
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder, webview::PageLoadEvent};

const STORE: &str = "https://store.steampowered.com/";

#[derive(Default)]
pub struct SteamLibrarySession(Mutex<Session>);

#[derive(Default)]
struct Session {
    generation: u64,
    /// Owned games while connected; install requests are checked against it.
    games: Option<Vec<library::Game>>,
    /// Web API token and when it was read; reused for a while so refreshes don't open Steam.
    token: Option<(String, Instant)>,
}

const TOKEN_URL: &str = "https://store.steampowered.com/pointssummary/ajaxgetasyncconfig";
const TOKEN_REUSE: Duration = Duration::from_secs(30 * 60);
/// The token page's title once the script below has read its JSON.
const TITLE_PREFIX: &str = "sofa-token:";
/// Runs in Steam's own page: copies the web API token into the title, the only way a remote
/// page can hand data back (it never gets an IPC capability).
const READ_TOKEN: &str = r#"(() => { let t = ""; try { t = JSON.parse(document.body.innerText).data.webapi_token || ""; } catch {} document.title = "sofa-token:" + t; })()"#;

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
    let cookies = app
        .get_webview_window("main")?
        .cookies_for_url(STORE.parse().unwrap())
        .ok()?;
    let names: Vec<_> = cookies.iter().map(|c| c.name().to_owned()).collect();
    crate::log::info(app, format!("steam: store cookies {names:?}"));
    cookies
        .into_iter()
        .find(|c| c.name() == "steamLoginSecure")
        .map(|c| c.value().to_owned())
}

/// Reads a web API token from inside a Steam window, so Steam's redirects, session renewal
/// and bot checks see a real browser (a direct request from Sofa got HTTP 302).
/// Hidden: uses the saved session. Visible: Steam's own login page first, so Sofa never sees
/// the password. `Ok(None)` when Steam has no usable session.
async fn steam_token(app: &tauri::AppHandle, visible: bool) -> Result<Option<String>, String> {
    let stale = saved_cookie(app);
    let page = if visible { "https://store.steampowered.com/login/" } else { TOKEN_URL };
    crate::log::info(app, format!("steam: token via {} window", if visible { "visible" } else { "hidden" }));
    let answer: Arc<Mutex<Option<String>>> = Arc::default();
    let sink = answer.clone();
    let mut builder = WebviewWindowBuilder::new(app, "steam-login", WebviewUrl::External(page.parse().unwrap()))
        .title("Steam")
        .inner_size(520.0, 760.0)
        .center()
        .visible(visible)
        .focused(visible)
        .on_page_load(|window, payload| {
            if payload.event() == PageLoadEvent::Finished
                && payload.url().path() == "/pointssummary/ajaxgetasyncconfig"
            {
                let _ = window.eval(READ_TOKEN);
            }
        })
        .on_document_title_changed(move |_, title| {
            if let Some(token) = title.strip_prefix(TITLE_PREFIX) {
                if let Ok(mut slot) = sink.lock() {
                    *slot = Some(token.to_owned());
                }
            }
        });
    if let Some(main) = app.get_webview_window("main").filter(|_| visible) {
        builder = builder.parent(&main).map_err(|_| "openFailed")?;
    }
    let window = builder.build().map_err(|_| "openFailed")?;
    // Sign-in has no deadline (the user is typing); the token page gets 30 s once it loads.
    let mut token_page_since = (!visible).then(Instant::now);
    loop {
        tokio::time::sleep(Duration::from_millis(300)).await;
        if app.get_webview_window("steam-login").is_none() {
            return Err("steamLoginCancelled".into());
        }
        if let Some(token) = answer.lock().ok().and_then(|mut slot| slot.take()) {
            let _ = window.close();
            crate::log::info(app, format!("steam: token page answered ({})", if token.is_empty() { "no session" } else { "ok" }));
            return Ok((!token.is_empty()).then_some(token));
        }
        match token_page_since {
            Some(since) if since.elapsed() > Duration::from_secs(30) => {
                let _ = window.close();
                crate::log::info(app, "steam: token page timed out");
                return Err("steamSessionExpired".into());
            }
            Some(_) => {}
            None => {
                // Fails while the window is closing; the next tick reports the cancel.
                let Ok(cookies) = window.cookies_for_url(STORE.parse().unwrap()) else { continue };
                let signed_in = cookies
                    .iter()
                    .find(|c| c.name() == "steamLoginSecure")
                    .is_some_and(|c| Some(c.value()) != stale.as_deref());
                if signed_in {
                    crate::log::info(app, "steam: signed in, reading token");
                    let _ = window.hide();
                    let _ = window.navigate(TOKEN_URL.parse().unwrap());
                    token_page_since = Some(Instant::now());
                }
            }
        }
    }
}

async fn fetch_owned(app: &tauri::AppHandle, token: &str, steam_id: &str) -> Result<Vec<library::Game>, String> {
    let client = network::client()?;
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
    .await
    .inspect_err(|e| crate::log::info(app, format!("steam: owned games request failed: {e}")))?;
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
    crate::log::info(app, format!("steam: {} owned games", games.len()));
    Ok(games)
}

/// Owned games for the saved session. Reuses a recent token, reads a new one from a hidden
/// Steam window otherwise, and with `sign_in` falls back to Steam's login page.
async fn owned_games(
    app: &tauri::AppHandle,
    session: &SteamLibrarySession,
    sign_in: bool,
) -> Result<Vec<library::Game>, String> {
    let cached = session
        .0
        .lock()
        .map_err(|_| "serviceUnavailable")?
        .token
        .clone()
        .filter(|(_, at)| at.elapsed() < TOKEN_REUSE);
    let mut attempts = 0;
    let mut token = cached.map(|(t, _)| t);
    loop {
        attempts += 1;
        let current = match token.take() {
            Some(t) => t,
            None => {
                let saved = if saved_cookie(app).is_some() { steam_token(app, false).await? } else { None };
                match saved {
                    Some(t) => t,
                    None if sign_in => steam_token(app, true).await?.ok_or("steamSessionExpired")?,
                    None if saved_cookie(app).is_some() => return Err("steamSessionExpired".into()),
                    None => return Err("notConnected".into()),
                }
            }
        };
        let steam_id = saved_cookie(app)
            .as_deref()
            .and_then(steam_id_from_cookie)
            .ok_or("invalidResponse")?;
        match fetch_owned(app, &current, &steam_id).await {
            Ok(games) => {
                if let Ok(mut s) = session.0.lock() {
                    s.token = Some((current, Instant::now()));
                }
                return Ok(games);
            }
            // A cached token Steam no longer accepts: read a fresh one once.
            Err(e) if attempts == 1 && (e == "authFailed" || e == "accessDenied") => {
                if let Ok(mut s) = session.0.lock() {
                    s.token = None;
                }
            }
            Err(e) => return Err(e),
        }
    }
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

/// `sign_in: false` restores or refreshes the saved session without opening Steam's login page.
#[tauri::command]
pub async fn connect_steam_library(
    sign_in: bool,
    app: tauri::AppHandle,
    session: tauri::State<'_, SteamLibrarySession>,
) -> Result<Vec<library::Game>, String> {
    let generation = {
        let mut session = session.0.lock().map_err(|_| "serviceUnavailable")?;
        session.generation = session.generation.wrapping_add(1);
        // A new sign-in may be another account; a refresh keeps the games installable meanwhile.
        if sign_in {
            session.games = None;
            session.token = None;
        }
        session.generation
    };
    let games = owned_games(&app, &session, sign_in).await?;
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
        session.token = None;
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
