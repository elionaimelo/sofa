//! Expected install size of an owned, uninstalled game: Steam publishes it in the page's
//! system requirements. Epic's catalog carries no size, so only Steam ids answer.
use crate::network;

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

#[tauri::command]
pub async fn game_size_estimate(id: String) -> Result<Option<u64>, String> {
    let app_id = crate::library::steam_app_id(&id).ok_or("invalidGame")?;
    let details: serde_json::Value = network::json(
        network::client()?
            .get("https://store.steampowered.com/api/appdetails")
            .query(&[("appids", app_id), ("filters", "pc_requirements"), ("l", "english")]),
    )
    .await?;
    let requirements = &details[app_id]["data"]["pc_requirements"];
    Ok(["minimum", "recommended"]
        .iter()
        .filter_map(|key| requirements[key].as_str())
        .find_map(storage_bytes))
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
}
