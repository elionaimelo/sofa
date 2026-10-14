//! Epic Games account: sign-in on Epic's own page, owned games from the launcher's public
//! APIs. Same shape as `accounts` (Steam): the session lives in the webview cookie store.
use crate::{library, network};
use serde::Deserialize;
use std::{
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder, webview::PageLoadEvent};

const SITE: &str = "https://www.epicgames.com/";
/// The Epic Games Launcher's own OAuth client; public, used by Legendary and Heroic too.
const CLIENT_ID: &str = "34a02cf8f4414e29b15921876da36f9a";
const CLIENT_SECRET: &str = "daafbccc737745039dffe53d94fc76cf";
const TOKEN_URL: &str = "https://account-public-service-prod03.ol.epicgames.com/account/api/oauth/token";
const ASSETS_URL: &str = "https://launcher-public-service-prod06.ol.epicgames.com/launcher/api/public/assets/Windows";
const CATALOG_URL: &str = "https://catalog-public-service-prod06.ol.epicgames.com/catalog/api/shared/namespace";
/// Access tokens last eight hours; keep one for half of that so refreshes don't open Epic.
const TOKEN_REUSE: Duration = Duration::from_secs(4 * 60 * 60);
/// The redirect page's title once the script below has read its JSON.
const TITLE_PREFIX: &str = "sofa-epic:";
/// Runs in Epic's own page: copies the authorization code into the title, the only way a
/// remote page can hand data back (it never gets an IPC capability).
const READ_CODE: &str = r#"(() => { let c = ""; try { c = JSON.parse(document.body.innerText).authorizationCode || ""; } catch {} document.title = "sofa-epic:" + c; })()"#;
const NO_SESSION: &str = r#"document.title = "sofa-epic:""#;

#[derive(Default)]
pub struct EpicLibrarySession(Mutex<Session>);

#[derive(Default)]
struct Session {
    generation: u64,
    /// Owned games while connected; install requests are checked against it.
    games: Option<Vec<library::Game>>,
    token: Option<(String, Instant)>,
}

#[derive(Deserialize)]
struct Token {
    access_token: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Asset {
    app_name: String,
    namespace: String,
    catalog_item_id: String,
}

fn redirect_url() -> String {
    format!("{SITE}id/api/redirect?clientId={CLIENT_ID}&responseType=code")
}

fn login_url() -> String {
    let encoded = redirect_url()
        .replace(':', "%3A")
        .replace('/', "%2F")
        .replace('?', "%3F")
        .replace('=', "%3D")
        .replace('&', "%26");
    format!("{SITE}id/login?redirectUrl={encoded}")
}

/// Epic keeps the web session in these cookies; every window shares one persistent store.
fn has_saved_session(app: &tauri::AppHandle) -> bool {
    let Some(cookies) = app
        .get_webview_window("main")
        .and_then(|w| w.cookies_for_url(SITE.parse().unwrap()).ok())
    else {
        return false;
    };
    let names: Vec<_> = cookies.iter().map(|c| c.name().to_owned()).collect();
    crate::log::info(app, format!("epic: site cookies {names:?}"));
    names.iter().any(|n| matches!(n.as_str(), "EPIC_SSO" | "EPIC_SSO_RM" | "EPIC_BEARER_TOKEN"))
}

/// Reads an authorization code from inside an Epic window. Hidden: the saved session answers
/// the redirect page. Visible: Epic's own login page first, so Sofa never sees the password.
/// `Ok(None)` when Epic has no usable session.
async fn auth_code(app: &tauri::AppHandle, visible: bool) -> Result<Option<String>, String> {
    let page = if visible { login_url() } else { redirect_url() };
    crate::log::info(app, format!("epic: code via {} window", if visible { "visible" } else { "hidden" }));
    let answer: Arc<Mutex<Option<String>>> = Arc::default();
    let sink = answer.clone();
    let mut builder = WebviewWindowBuilder::new(app, "epic-login", WebviewUrl::External(page.parse().unwrap()))
        .title("Epic Games")
        .inner_size(520.0, 760.0)
        .center()
        .visible(visible)
        .focused(visible)
        .on_page_load(move |window, payload| {
            if payload.event() != PageLoadEvent::Finished {
                return;
            }
            let path = payload.url().path();
            if path == "/id/api/redirect" {
                let _ = window.eval(READ_CODE);
            } else if !visible && path.starts_with("/id/login") {
                let _ = window.eval(NO_SESSION);
            }
        })
        .on_document_title_changed(move |_, title| {
            if let Some(code) = title.strip_prefix(TITLE_PREFIX) {
                if let Ok(mut slot) = sink.lock() {
                    *slot = Some(code.to_owned());
                }
            }
        });
    if let Some(main) = app.get_webview_window("main").filter(|_| visible) {
        builder = builder.parent(&main).map_err(|_| "openFailed")?;
    }
    let window = builder.build().map_err(|_| "openFailed")?;
    // Sign-in has no deadline (the user is typing); the hidden redirect page gets 30 s.
    let opened = Instant::now();
    loop {
        tokio::time::sleep(Duration::from_millis(300)).await;
        if app.get_webview_window("epic-login").is_none() {
            return Err("epicLoginCancelled".into());
        }
        if let Some(code) = answer.lock().ok().and_then(|mut slot| slot.take()) {
            let _ = window.close();
            crate::log::info(app, format!("epic: redirect page answered ({})", if code.is_empty() { "no session" } else { "ok" }));
            return Ok((!code.is_empty()).then_some(code));
        }
        if !visible && opened.elapsed() > Duration::from_secs(30) {
            let _ = window.close();
            crate::log::info(app, "epic: redirect page timed out");
            return Err("epicSessionExpired".into());
        }
    }
}

async fn exchange(app: &tauri::AppHandle, code: &str) -> Result<String, String> {
    let token: Token = network::json(
        network::client()?
            .post(TOKEN_URL)
            .basic_auth(CLIENT_ID, Some(CLIENT_SECRET))
            .header("Content-Type", "application/x-www-form-urlencoded")
            // The code is hexadecimal; nothing to percent-encode.
            .body(format!("grant_type=authorization_code&code={code}&token_type=eg1")),
    )
    .await
    .inspect_err(|e| crate::log::info(app, format!("epic: token exchange failed: {e}")))?;
    Ok(token.access_token)
}

/// Catalog entry for one asset: None for DLC, mods and anything the catalog doesn't know.
async fn catalog_game(token: String, asset: Asset) -> Option<library::Game> {
    let items: serde_json::Value = network::json(
        network::client()
            .ok()?
            .get(format!("{CATALOG_URL}/{}/bulk/items", asset.namespace))
            .bearer_auth(&token)
            .query(&[
                ("id", asset.catalog_item_id.as_str()),
                ("includeDLCDetails", "true"),
                ("includeMainGameDetails", "true"),
                ("country", "US"),
                ("locale", "en"),
            ]),
    )
    .await
    .ok()?;
    let item = items.get(&asset.catalog_item_id)?;
    let is_mod = item["categories"]
        .as_array()
        .is_some_and(|c| c.iter().any(|c| c["path"] == "mods"));
    if is_mod || item.get("mainGameItem").is_some() {
        return None;
    }
    let title = item["title"].as_str()?.trim().to_owned();
    let images = item["keyImages"].as_array();
    let cover = ["DieselGameBoxTall", "DieselGameBox", "Thumbnail"].iter().find_map(|kind| {
        images?
            .iter()
            .find(|i| i["type"] == *kind)
            .and_then(|i| i["url"].as_str())
            .map(str::to_owned)
    });
    (!title.is_empty()).then(|| library::Game {
        cover,
        ..library::epic_game(&asset.namespace, &asset.catalog_item_id, &asset.app_name, title, false)
    })
}

async fn fetch_owned(app: &tauri::AppHandle, token: &str) -> Result<Vec<library::Game>, String> {
    let mut assets: Vec<Asset> = network::json(
        network::client()?
            .get(ASSETS_URL)
            .bearer_auth(token)
            .query(&[("label", "Live")]),
    )
    .await
    .inspect_err(|e| crate::log::info(app, format!("epic: assets request failed: {e}")))?;
    // Unreal Engine content shares the account; one asset per app.
    assets.retain(|a| a.namespace != "ue");
    assets.sort_by(|a, b| a.app_name.cmp(&b.app_name));
    assets.dedup_by(|a, b| a.app_name == b.app_name);
    let total = assets.len();
    let mut games = Vec::with_capacity(total);
    // ponytail: eight catalog requests at a time; a stream would need the futures crate.
    for chunk in assets.chunks(8) {
        let mut tasks = Vec::new();
        for asset in chunk {
            let token = token.to_owned();
            let asset = Asset {
                app_name: asset.app_name.clone(),
                namespace: asset.namespace.clone(),
                catalog_item_id: asset.catalog_item_id.clone(),
            };
            tasks.push(tauri::async_runtime::spawn(catalog_game(token, asset)));
        }
        for task in tasks {
            if let Ok(Some(game)) = task.await {
                games.push(game);
            }
        }
    }
    games.sort_by(|a, b| a.id.cmp(&b.id));
    crate::log::info(app, format!("epic: {} owned games from {total} assets", games.len()));
    Ok(games)
}

/// Owned games for the saved session. Reuses a recent token, reads a new code from a hidden
/// Epic window otherwise, and with `sign_in` falls back to Epic's login page.
async fn owned_games(
    app: &tauri::AppHandle,
    session: &EpicLibrarySession,
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
                let saved = if has_saved_session(app) { auth_code(app, false).await? } else { None };
                let code = match saved {
                    Some(c) => c,
                    None if sign_in => auth_code(app, true).await?.ok_or("epicSessionExpired")?,
                    None if has_saved_session(app) => return Err("epicSessionExpired".into()),
                    None => return Err("notConnected".into()),
                };
                exchange(app, &code).await?
            }
        };
        match fetch_owned(app, &current).await {
            Ok(games) => {
                if let Ok(mut s) = session.0.lock() {
                    s.token = Some((current, Instant::now()));
                }
                return Ok(games);
            }
            // A cached token Epic no longer accepts: read a fresh one once.
            Err(e) if attempts == 1 && (e == "authFailed" || e == "accessDenied") => {
                if let Ok(mut s) = session.0.lock() {
                    s.token = None;
                }
            }
            Err(e) => return Err(e),
        }
    }
}

/// `sign_in: false` restores or refreshes the saved session without opening Epic's login page.
#[tauri::command]
pub async fn connect_epic_library(
    sign_in: bool,
    app: tauri::AppHandle,
    session: tauri::State<'_, EpicLibrarySession>,
) -> Result<Vec<library::Game>, String> {
    let generation = {
        let mut session = session.0.lock().map_err(|_| "serviceUnavailable")?;
        session.generation = session.generation.wrapping_add(1);
        if sign_in {
            session.games = None;
            session.token = None;
        }
        session.generation
    };
    let games = owned_games(&app, &session, sign_in).await?;
    let mut current = session.0.lock().map_err(|_| "serviceUnavailable")?;
    if current.generation != generation {
        return Err("notConnected".into());
    }
    current.games = Some(games.clone());
    Ok(games)
}

/// Signs out for real: forgets the games and deletes Epic's cookies.
#[tauri::command]
pub async fn disconnect_epic_library(
    app: tauri::AppHandle,
    session: tauri::State<'_, EpicLibrarySession>,
) -> Result<(), String> {
    {
        let mut session = session.0.lock().map_err(|_| "serviceUnavailable")?;
        session.generation = session.generation.wrapping_add(1);
        session.games = None;
        session.token = None;
    }
    let main = app.get_webview_window("main").ok_or("serviceUnavailable")?;
    for cookie in main.cookies().map_err(|_| "serviceUnavailable")? {
        if cookie.domain().is_some_and(|d| d.ends_with("epicgames.com")) {
            main.delete_cookie(cookie).map_err(|_| "serviceUnavailable")?;
        }
    }
    Ok(())
}

/// Install URI for an owned, uninstalled game; the launcher takes over from there.
pub fn install_uri(session: &EpicLibrarySession, id: &str) -> Result<String, String> {
    let session = session.0.lock().map_err(|_| "serviceUnavailable")?;
    let games = session.games.as_ref().ok_or("notConnected")?;
    let game = games.iter().find(|game| game.id == id).ok_or("installUnavailable")?;
    Ok(game.launch.replace("action=launch&silent=true", "action=install"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn login_page_redirects_back_to_the_code_page() {
        assert_eq!(
            login_url(),
            "https://www.epicgames.com/id/login?redirectUrl=https%3A%2F%2Fwww.epicgames.com%2Fid%2Fapi%2Fredirect%3FclientId%3D34a02cf8f4414e29b15921876da36f9a%26responseType%3Dcode"
        );
    }

    #[test]
    fn install_uri_only_for_owned_games() {
        let session = EpicLibrarySession::default();
        assert_eq!(install_uri(&session, "epic:Min"), Err("notConnected".into()));
        session.0.lock().unwrap().games = Some(vec![library::epic_game("ns", "cid", "Min", "Minimal".into(), false)]);
        assert_eq!(
            install_uri(&session, "epic:Min").as_deref(),
            Ok("com.epicgames.launcher://apps/ns%3Acid%3AMin?action=install")
        );
        assert_eq!(install_uri(&session, "epic:Other"), Err("installUnavailable".into()));
    }
}
