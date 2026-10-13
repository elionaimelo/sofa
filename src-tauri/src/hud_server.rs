//! Local HTTP server for the Xbox Game Bar widget (`widget/`), which is a separate UWP
//! package and can't use Tauri IPC. It serves the HUD page (`/?hud=1`) from the bundled
//! frontend and exposes only the HUD commands as `POST /api/<command>`.
use std::{io::Read, path::PathBuf};
use tauri::Manager;
use tiny_http::{Header, Method, Request, Response, Server};

/// Fixed so the widget can find Sofa without discovery.
pub const PORT: u16 = 47811;

/// Where the built frontend lives: bundled resource in production, `../dist` in dev.
fn dist_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    let resources = app.path().resource_dir().ok();
    [
        resources.as_ref().map(|r| r.join("_up_").join("dist")),
        resources.as_ref().map(|r| r.join("dist")),
        Some(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../dist")),
    ]
    .into_iter()
    .flatten()
    .find(|p| p.join("index.html").is_file())
}

fn mime(path: &std::path::Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()) {
        Some("html") => "text/html; charset=utf-8",
        Some("js") => "text/javascript",
        Some("css") => "text/css",
        Some("json") => "application/json",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("woff2") => "font/woff2",
        _ => "application/octet-stream",
    }
}

fn json(status: u16, body: String) -> Response<std::io::Cursor<Vec<u8>>> {
    Response::from_string(body)
        .with_status_code(status)
        .with_header(Header::from_bytes("Content-Type", "application/json").unwrap())
}

/// Runs one HUD command. Same functions the Tauri commands use; only this allowlist is reachable.
async fn dispatch(app: &tauri::AppHandle, command: &str, args: serde_json::Value) -> Result<serde_json::Value, String> {
    use crate::{ally, display, game_settings, hud, power, session};
    fn parse<T: serde::de::DeserializeOwned>(value: serde_json::Value) -> Result<T, String> {
        serde_json::from_value(value).map_err(|_| "invalidInput".to_string())
    }
    fn out(value: impl serde::Serialize) -> Result<serde_json::Value, String> {
        serde_json::to_value(value).map_err(|_| "invalidResponse".to_string())
    }
    let arg = |name: &str| args.get(name).cloned().unwrap_or(serde_json::Value::Null);
    match command {
        "system_metrics" => out(hud::system_metrics(app.state()).await?),
        "current_session" => out(session::current_session(app.clone(), app.state()).await?),
        "power_status" => out(power::power_status().await?),
        "ally_status" => out(ally::ally_status().await),
        "set_ally_profile" => out(ally::set_ally_profile(parse(arg("profile"))?).await?),
        "set_tdp" => out(ally::set_tdp(parse(arg("watts"))?).await?),
        "display_status" => out(display::display_status().await),
        "set_display_mode" => out(display::set_display_mode(parse(arg("mode"))?).await?),
        "set_brightness" => out(display::set_brightness(parse(arg("percent"))?).await?),
        "set_cpu_boost" => out(display::set_cpu_boost(parse(arg("on"))?).await?),
        "game_settings" => out(game_settings::game_settings(parse(arg("id"))?, app.clone()).await),
        "set_game_settings" => out(
            game_settings::set_game_settings(parse(arg("id"))?, parse(arg("settings"))?, app.clone()).await?,
        ),
        _ => Err("invalidInput".into()),
    }
}

fn handle(app: &tauri::AppHandle, dist: Option<&PathBuf>, mut request: Request) {
    // Browsers send Origin on cross-site requests; only the HUD page itself may call the API.
    let foreign_origin = request.headers().iter().any(|h| {
        h.field.equiv("Origin") && !h.value.as_str().starts_with(&format!("http://127.0.0.1:{PORT}"))
    });
    let url = request.url().to_owned();
    let path = url.split('?').next().unwrap_or("/");
    let response = if let Some(command) = path.strip_prefix("/api/") {
        if foreign_origin || *request.method() != Method::Post {
            json(403, r#"{"error":"accessDenied"}"#.into())
        } else {
            let mut body = String::new();
            let _ = request.as_reader().take(64 * 1024).read_to_string(&mut body);
            let args: serde_json::Value = serde_json::from_str(&body).unwrap_or(serde_json::Value::Null);
            match tauri::async_runtime::block_on(dispatch(app, command, args)) {
                Ok(value) => json(200, value.to_string()),
                Err(key) => json(400, serde_json::json!({ "error": key }).to_string()),
            }
        }
    } else {
        // Static files, with `/` → index.html. Reject path traversal.
        let relative = path.trim_start_matches('/');
        let file = dist.and_then(|d| {
            let clean = relative.is_empty() || !relative.split('/').any(|s| s == ".." || s.is_empty());
            clean.then(|| d.join(if relative.is_empty() { "index.html" } else { relative }))
        });
        match file.filter(|f| f.is_file()).and_then(|f| std::fs::read(&f).ok().map(|b| (f, b))) {
            Some((f, bytes)) => Response::from_data(bytes)
                .with_header(Header::from_bytes("Content-Type", mime(&f)).unwrap()),
            None => Response::from_data(b"not found".to_vec()).with_status_code(404),
        }
    };
    let _ = request.respond(response);
}

/// Starts the server on 127.0.0.1 only; silently skips if the port is taken (another Sofa).
pub fn start(app: tauri::AppHandle) {
    let Ok(server) = Server::http(("127.0.0.1", PORT)) else { return };
    let dist = dist_dir(&app);
    std::thread::spawn(move || {
        for request in server.incoming_requests() {
            handle(&app, dist.as_ref(), request);
        }
    });
}
