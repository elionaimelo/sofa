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
mod ally;
mod display;

use tauri::Manager;

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
/// Goes through the OS opener, so the frontend opener scope needn't allow custom schemes.
// ponytail: rescans per launch (ms on a normal library); cache in app state if it shows up.
#[tauri::command]
async fn launch(id: String) -> Result<(), String> {
    let game = library::scan().into_iter().find(|g| g.id == id).ok_or("unknown game")?;
    let target = game.launch;
    let r = if target.contains("://") {
        tauri_plugin_opener::open_url(&target, None::<&str>)
    } else {
        tauri_plugin_opener::open_path(&target, None::<&str>)
    };
    r.map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(uninstall::UninstallState::default())
        .manage(categories::CategoryCache::default())
        .manage(store::StoreCache::default())
        .manage(hud::Telemetry::default())
        .manage(publisher::Publisher::default())
        .manage(accounts::SteamLibrarySession::default())
        .setup(|app| {
            #[cfg(windows)]
            hud::watch_controller(app.handle().clone());
            // Launched by the Xbox full screen experience (see packaging/AppxManifest.xml).
            if std::env::args().any(|a| a == "--fse") {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.set_fullscreen(true);
                }
            }
            Ok(())
        })
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![scan_library, launch, uninstall::uninstall_game, categories::cached_categories, categories::game_categories, store::store_deals, store::store_shops, store::store_game, store::open_deal, hud::system_metrics, hud::open_hud, hud::current_game, power::power_status, power::perform_power, ally::ally_status, ally::set_ally_profile, publisher::publisher_status, publisher::partner_offers, publisher::open_partner_offer, accounts::connect_steam_library, accounts::refresh_steam_library, accounts::disconnect_steam_library, accounts::install_owned_game, display::display_status, display::set_display_mode, display::set_brightness, display::set_cpu_boost])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
