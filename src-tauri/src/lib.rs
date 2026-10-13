mod library;

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
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![scan_library, launch])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
