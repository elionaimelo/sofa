use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Serialize, Debug, PartialEq)]
pub struct Game {
    pub id: String,
    pub title: String,
    pub source: &'static str,
    /// URI (steam://, com.epicgames.launcher://) or an executable path.
    pub launch: String,
    pub cover: Option<String>,
}

pub fn scan() -> Vec<Game> {
    let mut games = steam();
    games.extend(epic());
    games.extend(gog());
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

fn parse_acf(text: &str) -> Option<(String, String)> {
    let (mut id, mut name) = (None, None);
    for (k, v) in vdf_pairs(text) {
        match k {
            "appid" if id.is_none() => id = Some(v),
            "name" if name.is_none() => name = Some(v),
            _ => {}
        }
    }
    Some((id?, name?))
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
        .filter(|(id, _)| !STEAM_SKIP.contains(&id.as_str()))
        .map(|(id, title)| Game {
            cover: Some(format!("https://cdn.cloudflare.steamstatic.com/steam/apps/{id}/library_600x900.jpg")),
            launch: format!("steam://rungameid/{id}"),
            id: format!("steam:{id}"),
            title,
            source: "steam",
        })
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
    Some(Game { id: format!("epic:{app}"), title: s("DisplayName")?, source: "epic", launch, cover: None })
}

fn epic_manifests_dir() -> Option<PathBuf> {
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
                cover: None,
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
    fn parses_acf() {
        let acf = "\"AppState\"\n{\n\t\"appid\"\t\t\"1245620\"\n\t\"name\"\t\t\"ELDEN RING\"\n\t\"UserConfig\"\n\t{\n\t\t\"name\"\t\t\"x\"\n\t}\n}";
        assert_eq!(parse_acf(acf), Some(("1245620".into(), "ELDEN RING".into())));
    }

    #[test]
    fn parses_library_paths_with_escapes() {
        let vdf = "\"libraryfolders\"\n{\n\t\"0\"\n\t{\n\t\t\"path\"\t\t\"D:\\\\SteamLibrary\"\n\t}\n}";
        let paths: Vec<_> = vdf_pairs(vdf).filter(|(k, _)| *k == "path").map(|(_, v)| v).collect();
        assert_eq!(paths, vec![r"D:\SteamLibrary".to_string()]);
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
