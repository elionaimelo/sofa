use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Serialize, Debug, PartialEq, Clone, Default)]
pub struct Game {
    pub id: String,
    pub title: String,
    pub source: &'static str,
    /// URI (steam://, com.epicgames.launcher://) or an executable path.
    pub launch: String,
    pub cover: Option<String>,
    pub installed: bool,
    /// Unix seconds of the last session the launcher recorded (Steam), for sorting.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_played: Option<u64>,
    /// Total minutes played, as Steam counts it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub playtime: Option<u32>,
    /// Bytes on disk, when the launcher's manifest records it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
}

pub fn scan() -> Vec<Game> {
    let mut games = steam();
    games.extend(epic());
    games.extend(gog());
    // The same Steam library can be listed twice with different spellings
    // (registry `c:/program files (x86)/steam` vs vdf `C:\Program Files (x86)\Steam`).
    games.sort_by(|a, b| a.id.cmp(&b.id));
    games.dedup_by(|a, b| a.id == b.id);
    games.sort_by_key(|g| g.title.to_lowercase());
    games
}

// ---------- Steam: libraryfolders.vdf + appmanifest_*.acf ----------

/// Pairs of quoted tokens per line: `"key"  "value"`. Enough for the flat parts of VDF/ACF we read.
fn vdf_pairs(text: &str) -> impl Iterator<Item = (&str, String)> {
    text.lines().filter_map(|line| {
        let t: Vec<&str> = line.split('"').collect();
        (t.len() >= 5).then(|| (t[1], t[3].replace("\\\\", "\\")))
    })
}

/// An installed Steam game from its appmanifest. Only the first value of each key counts:
/// nested sections (UserConfig) repeat names.
fn parse_acf(text: &str) -> Option<Game> {
    let (mut id, mut name, mut last_played, mut size) = (None, None, None, None);
    for (k, v) in vdf_pairs(text) {
        match k {
            "appid" if id.is_none() => id = Some(v),
            "name" if name.is_none() => name = Some(v),
            "LastPlayed" if last_played.is_none() => last_played = v.parse().ok().filter(|t| *t > 0),
            "SizeOnDisk" if size.is_none() => size = v.parse().ok().filter(|b| *b > 0),
            _ => {}
        }
    }
    Some(Game {
        last_played,
        size,
        ..steam_game(id?, name?, true)
    })
}

/// Numeric app id from a `steam:<appid>` game id; the webview only ever sends ids.
pub fn steam_app_id(id: &str) -> Option<&str> {
    id.strip_prefix("steam:")
        .filter(|v| !v.is_empty() && v.len() <= 10 && v.bytes().all(|b| b.is_ascii_digit()))
}

pub fn steam_game(app_id: impl std::fmt::Display, title: String, installed: bool) -> Game {
    Game {
        cover: Some(format!("https://cdn.cloudflare.steamstatic.com/steam/apps/{app_id}/library_600x900.jpg")),
        launch: format!("steam://rungameid/{app_id}"),
        id: format!("steam:{app_id}"),
        title,
        source: "steam",
        installed,
        ..Game::default()
    }
}

/// Use Steam's executable on Windows so launching does not depend on the URL association.
/// The client handles both a cold start and forwarding to an already running instance.
pub fn launch_game(game: &Game) -> Result<(), String> {
    #[cfg(windows)]
    if game.source == "steam" {
        let root = steam_root().ok_or("Steam installation not found")?;
        return steam_launch_command(&root, &game.id)?
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("Steam launch failed: {e}"));
    }
    if game.launch.contains("://") {
        tauri_plugin_opener::open_url(&game.launch, None::<&str>)
    } else {
        tauri_plugin_opener::open_path(&game.launch, None::<&str>)
    }
    .map_err(|e| e.to_string())
}

#[cfg(any(windows, test))]
fn steam_launch_command(root: &Path, id: &str) -> Result<std::process::Command, String> {
    let app_id = steam_app_id(id).ok_or("Invalid Steam app id")?;
    let mut command = std::process::Command::new(root.join("steam.exe"));
    // Client flags must precede -applaunch; subsequent arguments belong to the game.
    command.current_dir(root).args(["-silent", "-applaunch", app_id]);
    Ok(command)
}

/// The Steam app currently running, as reported by the Steam client.
pub fn running_steam_app() -> Option<u32> {
    #[cfg(windows)]
    {
        use winreg::{RegKey, enums::HKEY_CURRENT_USER};
        RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey(r"Software\Valve\Steam")
            .and_then(|k| k.get_value::<u32, _>("RunningAppID"))
            .ok()
            .filter(|id| *id != 0)
    }
    #[cfg(not(windows))]
    None
}

// Redistributables / runtimes that show up as "installed apps" but aren't games.
const STEAM_SKIP: &[&str] = &["228980", "1070560", "1391110", "1628350", "1493710"];

fn steam_root() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        use winreg::{RegKey, enums::HKEY_CURRENT_USER};
        if let Ok(p) = RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey(r"Software\Valve\Steam")
            .and_then(|k| k.get_value::<String, _>("SteamPath"))
        {
            return Some(PathBuf::from(p));
        }
        return Some(PathBuf::from(r"C:\Program Files (x86)\Steam")).filter(|p| p.exists());
    }
    #[cfg(not(windows))]
    {
        let home = PathBuf::from(std::env::var_os("HOME")?);
        ["Library/Application Support/Steam", ".local/share/Steam", ".steam/steam"]
            .iter()
            .map(|p| home.join(p))
            .find(|p| p.exists())
    }
}

fn steam() -> Vec<Game> {
    let Some(root) = steam_root() else { return vec![] };
    let mut libs = vec![root.clone()];
    if let Ok(vdf) = fs::read_to_string(root.join("steamapps/libraryfolders.vdf")) {
        libs.extend(vdf_pairs(&vdf).filter(|(k, _)| *k == "path").map(|(_, v)| PathBuf::from(v)));
    }
    libs.sort();
    libs.dedup();

    libs.iter()
        .filter_map(|lib| fs::read_dir(lib.join("steamapps")).ok())
        .flatten()
        .flatten()
        .filter(|e| e.file_name().to_string_lossy().starts_with("appmanifest_"))
        .filter_map(|e| parse_acf(&fs::read_to_string(e.path()).ok()?))
        .filter(|game| !STEAM_SKIP.iter().any(|skip| game.id == format!("steam:{skip}")))
        .collect()
}

// ---------- Epic: launcher manifests (*.item JSON) ----------

fn parse_epic_item(text: &str) -> Option<Game> {
    let v: serde_json::Value = serde_json::from_str(text).ok()?;
    let s = |k: &str| v.get(k).and_then(|x| x.as_str()).map(str::to_owned);
    if v.get("bIsIncompleteInstall").and_then(|x| x.as_bool()) == Some(true) {
        return None;
    }
    let app = s("AppName")?;
    let launch = format!(
        "com.epicgames.launcher://apps/{}%3A{}%3A{}?action=launch&silent=true",
        s("CatalogNamespace")?,
        s("CatalogItemId")?,
        app
    );
    Some(Game {
        id: format!("epic:{app}"),
        title: s("DisplayName")?,
        source: "epic",
        launch,
        installed: true,
        size: v.get("InstallSize").and_then(|x| x.as_u64()).filter(|b| *b > 0),
        ..Game::default()
    })
}

pub(crate) fn epic_manifests_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    let dir = PathBuf::from(std::env::var_os("ProgramData")?).join(r"Epic\EpicGamesLauncher\Data\Manifests");
    #[cfg(not(windows))]
    let dir = PathBuf::from(std::env::var_os("HOME")?)
        .join("Library/Application Support/Epic/EpicGamesLauncher/Data/Manifests");
    Some(dir)
}

fn epic() -> Vec<Game> {
    let Some(dir) = epic_manifests_dir() else { return vec![] };
    read_files(&dir, "item").filter_map(|t| parse_epic_item(&t)).collect()
}

fn read_files<'a>(dir: &Path, ext: &'a str) -> impl Iterator<Item = String> + 'a {
    fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter(move |p| p.extension().is_some_and(|x| x == ext))
        .filter_map(|p| fs::read_to_string(p).ok())
}

// ---------- GOG: Galaxy/offline installers register under HKLM (Windows only) ----------

#[cfg(windows)]
fn gog() -> Vec<Game> {
    use winreg::{RegKey, enums::HKEY_LOCAL_MACHINE};
    let Ok(root) = RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey(r"SOFTWARE\WOW6432Node\GOG.com\Games") else {
        return vec![];
    };
    root.enum_keys()
        .flatten()
        .filter_map(|id| {
            let k = root.open_subkey(&id).ok()?;
            let get = |n: &str| k.get_value::<String, _>(n).ok();
            Some(Game {
                title: get("gameName").or_else(|| get("GAMENAME"))?,
                launch: get("exe").or_else(|| get("EXE"))?,
                id: format!("gog:{id}"),
                source: "gog",
                installed: true,
                ..Game::default()
            })
        })
        .collect()
}

#[cfg(not(windows))]
fn gog() -> Vec<Game> {
    vec![]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn launches_steam_with_separate_app_id_and_install_directory() {
        let root = Path::new("C:/Program Files (x86)/Steam");
        let command = steam_launch_command(root, "steam:1245620").unwrap();
        assert_eq!(command.get_program(), root.join("steam.exe"));
        assert_eq!(command.get_current_dir(), Some(root));
        assert_eq!(command.get_args().collect::<Vec<_>>(), ["-silent", "-applaunch", "1245620"]);
    }

    #[test]
    fn rejects_invalid_steam_launch_ids() {
        for id in ["steam:", "steam:620 -shutdown", "steam:1/2", "steam:12345678901", "epic:620", "steam://rungameid/620"] {
            assert!(steam_launch_command(Path::new("Steam"), id).is_err());
        }
    }

    #[test]
    fn parses_acf() {
        let acf = "\"AppState\"\n{\n\t\"appid\"\t\t\"1245620\"\n\t\"name\"\t\t\"ELDEN RING\"\n\t\"LastPlayed\"\t\t\"1700000000\"\n\t\"SizeOnDisk\"\t\t\"52000000000\"\n\t\"UserConfig\"\n\t{\n\t\t\"name\"\t\t\"x\"\n\t}\n}";
        let game = parse_acf(acf).unwrap();
        assert_eq!((game.id.as_str(), game.title.as_str()), ("steam:1245620", "ELDEN RING"));
        assert_eq!((game.last_played, game.size), (Some(1_700_000_000), Some(52_000_000_000)));
    }

    #[test]
    fn parses_library_paths_with_escapes() {
        let vdf = "\"libraryfolders\"\n{\n\t\"0\"\n\t{\n\t\t\"path\"\t\t\"D:\\\\SteamLibrary\"\n\t}\n}";
        let paths: Vec<_> = vdf_pairs(vdf).filter(|(k, _)| *k == "path").map(|(_, v)| v).collect();
        assert_eq!(paths, vec![r"D:\SteamLibrary".to_string()]);
    }

    #[test]
    fn dedupes_same_game_from_two_library_paths() {
        let mut games: Vec<Game> = ["steam:1", "steam:1", "epic:a"]
            .iter()
            .map(|id| Game { id: id.to_string(), title: "x".into(), source: "steam", installed: true, ..Game::default() })
            .collect();
        games.sort_by(|a, b| a.id.cmp(&b.id));
        games.dedup_by(|a, b| a.id == b.id);
        assert_eq!(games.iter().map(|g| g.id.as_str()).collect::<Vec<_>>(), ["epic:a", "steam:1"]);
    }

    #[test]
    fn parses_epic_item() {
        let item = r#"{"DisplayName":"Hades","AppName":"Min","CatalogNamespace":"ns","CatalogItemId":"cid","bIsIncompleteInstall":false}"#;
        let g = parse_epic_item(item).unwrap();
        assert_eq!(g.title, "Hades");
        assert_eq!(g.launch, "com.epicgames.launcher://apps/ns%3Acid%3AMin?action=launch&silent=true");
        assert!(parse_epic_item(&item.replace("false", "true")).is_none());
    }
}
