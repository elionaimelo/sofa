//! Catalog genres and user tags, never inferred from a game's title.
use crate::network;
use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{Manager, State};

#[derive(Clone, Default, Serialize, Deserialize)]
pub struct Entry {
    updated: u64,
    labels: Vec<String>,
}
/// One cache per store language: labels come localized from the store page.
#[derive(Default)]
pub struct CategoryCache(Mutex<Option<(String, BTreeMap<String, Entry>)>>);

/// Steam's `l` parameter for a UI language; anything else is rejected.
fn steam_locale(lang: &str) -> Result<&'static str, String> {
    match lang {
        "en" => Ok("english"),
        "pt-BR" => Ok("portuguese"),
        "es" => Ok("spanish"),
        _ => Err("invalidInput".into()),
    }
}
fn timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn cache_file(locale: &str) -> String {
    format!("categories-v1-{locale}.json")
}
fn load(app: &tauri::AppHandle, cache: &CategoryCache, locale: &str) -> Result<BTreeMap<String, Entry>, String> {
    let mut guard = cache.0.lock().map_err(|_| "serviceUnavailable")?;
    if guard.as_ref().is_none_or(|(l, _)| l != locale) {
        let entries = app
            .path()
            .app_cache_dir()
            .ok()
            .and_then(|p| std::fs::read(p.join(cache_file(locale))).ok())
            .filter(|bytes| bytes.len() <= 4 * 1024 * 1024)
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        *guard = Some((locale.to_owned(), entries));
    }
    Ok(guard.as_ref().map(|(_, e)| e.clone()).unwrap_or_default())
}
fn parse(html: &str) -> Vec<String> {
    let document = Html::parse_document(html);
    let selector = Selector::parse("a.app_tag, .details_block a[href*='/genre/']").unwrap();
    let mut labels = Vec::<String>::new();
    for node in document.select(&selector) {
        let label = node
            .text()
            .collect::<String>()
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ");
        if !label.is_empty()
            && label.chars().count() <= 60
            && !labels.iter().any(|v| v.eq_ignore_ascii_case(&label))
        {
            labels.push(label);
        }
        if labels.len() >= 40 {
            break;
        }
    }
    labels
}
#[tauri::command]
pub fn cached_categories(
    lang: String,
    app: tauri::AppHandle,
    cache: State<'_, CategoryCache>,
) -> Result<BTreeMap<String, Entry>, String> {
    load(&app, &cache, steam_locale(&lang)?)
}
#[tauri::command]
pub async fn game_categories(
    id: String,
    lang: String,
    app: tauri::AppHandle,
    cache: State<'_, CategoryCache>,
) -> Result<Vec<String>, String> {
    let app_id = crate::library::steam_app_id(&id).ok_or("invalidGame")?;
    let locale = steam_locale(&lang)?;
    let cached = load(&app, &cache, locale)?;
    if let Some(entry) = cached.get(&id) {
        let ttl = if entry.labels.is_empty() {
            86400
        } else {
            30 * 86400
        };
        if timestamp().saturating_sub(entry.updated) < ttl {
            return Ok(entry.labels.clone());
        }
    }
    // Fixed host, numeric identifier, no API key or user profile required.
    let html = network::text(
        network::client()?
            .get(format!("https://store.steampowered.com/app/{app_id}/"))
            // Adult birth date so age-gated titles answer with their page, not an /agecheck redirect.
            .header("cookie", "birthtime=470703601; lastagecheckage=1-January-1985; wants_mature_content=1")
            .query(&[("l", locale)]),
    )
    .await?;
    let labels = parse(&html);
    let mut guard = cache.0.lock().map_err(|_| "serviceUnavailable")?;
    // Another language may have been loaded meanwhile; this result belongs to `locale`.
    let entries = match guard.as_mut() {
        Some((l, entries)) if l == locale => entries,
        _ => &mut guard.insert((locale.to_owned(), BTreeMap::new())).1,
    };
    if entries.len() >= 5000 && !entries.contains_key(&id) {
        if let Some(oldest) = entries
            .iter()
            .min_by_key(|(_, v)| v.updated)
            .map(|(k, _)| k.clone())
        {
            entries.remove(&oldest);
        }
    }
    entries.insert(
        id,
        Entry {
            updated: timestamp(),
            labels: labels.clone(),
        },
    );
    if let Ok(path) = app.path().app_cache_dir() {
        if std::fs::create_dir_all(&path).is_ok() {
            if let Ok(json) = serde_json::to_vec(entries) {
                let temporary = path.join(format!("categories-v1-{locale}.tmp"));
                if std::fs::write(&temporary, json).is_ok() {
                    // Windows rename cannot replace an existing file; keep the last valid cache on failure.
                    let destination = path.join(cache_file(locale));
                    let _ = std::fs::remove_file(&destination);
                    let _ = std::fs::rename(temporary, destination);
                }
            }
        }
    }
    // Removed games and markup changes are unknown, not an empty classification.
    // Cached anyway (1-day TTL above) so the same title isn't fetched on every run.
    if labels.is_empty() {
        return Err("categoriesUnavailable".into());
    }
    Ok(labels)
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn store_language_follows_the_ui_language_only() {
        assert_eq!(steam_locale("pt-BR"), Ok("portuguese"));
        assert_eq!(steam_locale("es"), Ok("spanish"));
        assert_eq!(steam_locale("en"), Ok("english"));
        assert_eq!(steam_locale("fr"), Err("invalidInput".into()));
    }
    #[test]
    fn genres_and_styles_are_real_catalog_labels_not_breadcrumbs_or_features() {
        let labels = parse(
            r#"<a href='/genre/Action/'>Action Games</a><a class='app_tag'> Souls-like </a><a class='app_tag'>RPG</a><div class='details_block'><a href='/genre/RPG/'>RPG</a><a href='/genre/Action/'>Action</a><a href='/category/2'>Single-player</a></div>"#,
        );
        assert_eq!(labels, vec!["Souls-like", "RPG", "Action"]);
        assert!(parse("<h1>Age verification</h1>").is_empty());
    }
}
