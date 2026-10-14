mod library;
mod uninstall;
mod epic_uninstall;
mod categories;
mod network;
mod store;
mod hud;
mod power;
mod publisher;
mod publisher_config;
mod accounts;
mod epic;
mod ally;
#[cfg(any(windows, test))]
mod ally_input;
mod display;
mod xbox_mode;
mod hud_server;
mod session;
mod log;
mod game_settings;
mod widget;

use tauri::Manager;

/// Steam raises its main window when it launches a game; keep Sofa (or the game) in front.
/// Retries for a few seconds because the window appears after the launch call returns.
#[cfg(windows)]
fn minimize_steam_window() {
    use windows_sys::Win32::UI::WindowsAndMessaging::{FindWindowW, IsWindowVisible, ShowWindow, SW_MINIMIZE};
    std::thread::spawn(|| {
        let title: Vec<u16> = "Steam\0".encode_utf16().collect();
        for _ in 0..20 {
            std::thread::sleep(std::time::Duration::from_millis(500));
            // Null class, exact title; null-terminated UTF-16.
            let hwnd = unsafe { FindWindowW(std::ptr::null(), title.as_ptr()) };
            if !hwnd.is_null() && unsafe { IsWindowVisible(hwnd) } != 0 {
                unsafe { ShowWindow(hwnd, SW_MINIMIZE) };
                return;
            }
        }
    });
}
#[cfg(not(windows))]
fn minimize_steam_window() {}

/// `System32\<name>` resolved through Windows, so nothing planted on PATH runs instead.
#[cfg(windows)]
pub(crate) fn system_exe(name: &str) -> Option<std::path::PathBuf> {
    use windows_sys::Win32::System::SystemInformation::GetSystemDirectoryW;
    let mut buffer = [0u16; 32768];
    // Writes at most buffer.len() UTF-16 units and returns the length used.
    let length = unsafe { GetSystemDirectoryW(buffer.as_mut_ptr(), buffer.len() as u32) } as usize;
    (length != 0 && length < buffer.len())
        .then(|| std::path::PathBuf::from(String::from_utf16_lossy(&buffer[..length])).join(name))
}

#[tauri::command]
async fn scan_library() -> Vec<library::Game> {
    library::scan()
}

/// Takes a game id, never a raw path: the webview can only start things the scan found.
/// Steam on Windows uses its executable; other launchers use the OS opener.
// ponytail: rescans per launch (ms on a normal library); cache in app state if it shows up.
#[tauri::command]
async fn launch(id: String, app: tauri::AppHandle) -> Result<(), String> {
    let game_id = id.clone();
    let game = tauri::async_runtime::spawn_blocking(move || {
        library::scan().into_iter().find(|g| g.id == game_id)
    }).await.map_err(|_| "openFailed")?.ok_or("openFailed")?;
    game_settings::apply(&app, &id).await;
    let is_steam = game.source == "steam";
    log::info(&app, format!("launch: requesting {id}"));
    let r = tauri::async_runtime::spawn_blocking(move || library::launch_game(&game))
        .await.map_err(|_| "openFailed")?;
    if let Err(error) = r {
        log::info(&app, format!("launch: {id} failed: {error}"));
        return Err("openFailed".into());
    }
    log::info(&app, format!("launch: request dispatched for {id}"));
    if is_steam {
        minimize_steam_window();
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(uninstall::UninstallState::default())
        .manage(categories::CategoryCache::default())
        .manage(store::StoreCache::default())
        .manage(publisher::Publisher::default())
        .manage(accounts::SteamLibrarySession::default())
        .manage(epic::EpicLibrarySession::default())
        .manage(session::Playtime::default())
        .setup(|app| {
            #[cfg(windows)]
            {
                hud::watch_controller(app.handle().clone());
                ally_input::watch(app.handle().clone());
            }
            hud_server::start(app.handle().clone());
            session::watch(app.handle().clone());
            // Launched by the Xbox full screen experience (`--fse`, see packaging/AppxManifest.xml)
            // or opened while Xbox mode is on: Sofa is the console UI, so no window chrome.
            // Xbox mode re-lays out the window after activation; apply again once it settles.
            if std::env::args().any(|a| a == "--fse") || xbox_mode::active() == Some(true) {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    for delay in [0, 500, 2000] {
                        tokio::time::sleep(std::time::Duration::from_millis(delay)).await;
                        if let Some(w) = handle.get_webview_window("main") {
                            let _ = w.set_fullscreen(true);
                        }
                    }
                });
            }
            Ok(())
        })
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![scan_library, launch, uninstall::uninstall_game, categories::cached_categories, categories::game_categories, store::store_deals, store::store_shops, store::store_game, store::open_deal, hud::open_hud, session::current_session, session::playtimes, log::open_log, game_settings::game_settings, game_settings::set_game_settings, widget::widget_status, widget::install_widget, power::power_status, power::perform_power, ally::ally_status, ally::set_ally_profile, ally::set_tdp, publisher::publisher_status, publisher::partner_offers, publisher::open_partner_offer, accounts::connect_steam_library, accounts::disconnect_steam_library, accounts::install_owned_game, epic::connect_epic_library, epic::disconnect_epic_library, display::display_status, display::set_display_mode, display::set_brightness, display::set_cpu_boost, xbox_mode::xbox_mode_status, xbox_mode::set_xbox_mode_startup, xbox_mode::enter_xbox_mode])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
