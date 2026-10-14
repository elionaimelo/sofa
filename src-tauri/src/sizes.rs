//! Expected install size of an owned, uninstalled game: Steam publishes it in the page's
//! system requirements. Epic and GOG titles use the Steam page of the same name, as the
//! categories do.
use crate::{network, store::StoreCache};

fn storage_bytes(requirements: &str) -> Option<u64> {
    // "<strong>Storage:</strong> 50 GB available space"; the page is requested in English.
    let text = requirements.replace("&nbsp;", " ");
    for part in text.split("<strong>").skip(1) {
        if !part.trim_start().to_ascii_lowercase().starts_with("storage") {
            continue;
        }
        let value = part.split_once("</strong>")?.1.trim_start();
        let number: String = value
            .chars()
            .take_while(|c| c.is_ascii_digit() || *c == '.' || *c == ',')
            .collect();
        let rest = value[number.len()..].trim_start().to_ascii_uppercase();
        let unit = if rest.starts_with("GB") {
            1024u64.pow(3)
        } else if rest.starts_with("MB") {
            1024u64.pow(2)
        } else {
            return None;
        };
        let amount: f64 = number.replace(',', ".").parse().ok()?;
        return Some((amount * unit as f64) as u64);
    }
    None
}

/// Storage a Steam title asks for. `appdetails` has no `pc_requirements` filter (it answers
/// with empty data); the requirements come with `basic`.
async fn steam_size(app_id: &str) -> Result<Option<u64>, String> {
    let details: serde_json::Value = network::json(
        network::client()?
            .get("https://store.steampowered.com/api/appdetails")
            .query(&[("appids", app_id), ("filters", "basic"), ("l", "english")]),
    )
    .await?;
    let requirements = &details[app_id]["data"]["pc_requirements"];
    Ok(["minimum", "recommended"]
        .iter()
        .filter_map(|key| requirements[key].as_str())
        .find_map(storage_bytes))
}

/// Cached for a day, unknown sizes too: requirements rarely change.
#[tauri::command]
pub async fn game_size_estimate(
    id: String,
    title: Option<String>,
    cache: tauri::State<'_, StoreCache>,
) -> Result<Option<u64>, String> {
    let key = format!("size:{id}");
    if let Some(size) = cache.fresh(&key, crate::store::DAY)? {
        return Ok(size.as_u64());
    }
    let size = match crate::categories::steam_app_for_game(&id, title.as_deref(), &cache).await? {
        Some(app_id) => steam_size(&app_id).await?,
        None => None,
    };
    cache.keep(key, size.into())?;
    Ok(size)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_storage_line_of_steam_requirements() {
        let html = "<strong>Minimum:</strong><br><ul class=\"bb_ul\"><li><strong>OS:</strong> Windows 10<br></li><li><strong>Memory:</strong> 8 GB RAM<br></li><li><strong>Storage:</strong> 50 GB available space<br></li></ul>";
        assert_eq!(storage_bytes(html), Some(50 * 1024u64.pow(3)));
        assert_eq!(storage_bytes("<strong>Storage:</strong> 1,5 GB available space"), Some(1610612736));
        assert_eq!(storage_bytes("<strong>Storage:</strong> 700 MB available space"), Some(700 * 1024u64.pow(2)));
        assert_eq!(storage_bytes("<strong>Memory:</strong> 8 GB RAM"), None);
        assert_eq!(storage_bytes(""), None);
    }

    #[test]
    #[ignore = "live provider integration"]
    fn steam_answers_with_the_storage_requirement() {
        let size = tauri::async_runtime::block_on(steam_size("1145360")).unwrap();
        assert!(size.is_some_and(|bytes| bytes > 1024u64.pow(3)), "{size:?}");
    }
}
