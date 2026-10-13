use crate::network;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashMap,
    sync::Mutex,
    time::{Duration, Instant},
};
const BASE: &str = "https://www.cheapshark.com/api/1.0";
#[derive(Default)]
pub struct StoreCache(Mutex<HashMap<String, (Instant, Value)>>);
#[derive(Deserialize, Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Deal {
    #[serde(rename = "gameID")]
    pub game_id: String,
    #[serde(rename = "dealID")]
    pub deal_id: String,
    #[serde(rename = "storeID")]
    pub store_id: String,
    pub title: String,
    pub sale_price: String,
    pub normal_price: String,
    pub savings: String,
    pub thumb: String,
    #[serde(rename = "steamAppID")]
    pub steam_app_id: Option<String>,
}
#[derive(Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Shop {
    #[serde(rename = "storeID")]
    pub store_id: String,
    pub store_name: String,
    pub is_active: u8,
}

#[derive(Deserialize, Serialize)]
pub struct GameInfo {
    pub title: String,
    pub thumb: String,
    #[serde(rename = "steamAppID")]
    pub steam_app_id: Option<String>,
}
#[derive(Deserialize, Serialize)]
pub struct Offer {
    #[serde(rename = "storeID")]
    pub store_id: String,
    #[serde(rename = "dealID")]
    pub deal_id: String,
    pub price: String,
    #[serde(rename = "retailPrice")]
    pub retail_price: String,
    pub savings: String,
}
#[derive(Deserialize, Serialize)]
pub struct History {
    pub price: String,
    pub date: u64,
}
#[derive(Deserialize, Serialize)]
pub struct GameDetails {
    pub info: GameInfo,
    pub deals: Vec<Offer>,
    #[serde(rename = "cheapestPriceEver")]
    pub cheapest_price_ever: Option<History>,
}

pub fn valid_game_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 16 && id.bytes().all(|b| b.is_ascii_digit())
}
async fn cached(
    cache: &StoreCache,
    key: &str,
    path: &str,
    params: &[(&str, &str)],
) -> Result<Value, String> {
    if let Some(value) = cache
        .0
        .lock()
        .map_err(|_| "serviceUnavailable")?
        .get(key)
        .filter(|(at, _)| at.elapsed() < Duration::from_secs(300))
        .map(|(_, v)| v.clone())
    {
        return Ok(value);
    }
    let value: Value = network::json(
        network::client()?
            .get(format!("{BASE}/{path}"))
            .query(params),
    )
    .await?;
    let mut entries = cache.0.lock().map_err(|_| "serviceUnavailable")?;
    if entries.len() >= 100 {
        entries.retain(|_, (at, _)| at.elapsed() < Duration::from_secs(300));
        if entries.len() >= 100 {
            entries.clear();
        }
    }
    entries.insert(key.into(), (Instant::now(), value.clone()));
    Ok(value)
}
#[tauri::command]
pub async fn store_deals(
    query: String,
    cache: tauri::State<'_, StoreCache>,
) -> Result<Vec<Deal>, String> {
    let query = query.trim();
    if query.chars().count() > 100 {
        return Err("invalidInput".into());
    }
    let value = cached(
        &cache,
        &format!("deals:{query}"),
        "deals",
        &[
            ("title", query),
            ("pageSize", "48"),
            ("sortBy", "Deal Rating"),
        ],
    )
    .await?;
    let deals: Vec<Deal> = serde_json::from_value(value).map_err(|_| "invalidResponse")?;
    // One tile per game; comparisons come from /games?id=….
    let mut seen = std::collections::HashSet::new();
    Ok(deals
        .into_iter()
        .filter(|d| seen.insert(d.game_id.clone()))
        .collect())
}
#[tauri::command]
pub async fn store_shops(cache: tauri::State<'_, StoreCache>) -> Result<Vec<Shop>, String> {
    serde_json::from_value(cached(&cache, "shops", "stores", &[]).await?)
        .map_err(|_| "invalidResponse".into())
}
#[tauri::command]
pub async fn store_game(
    id: String,
    cache: tauri::State<'_, StoreCache>,
) -> Result<GameDetails, String> {
    if !valid_game_id(&id) {
        return Err("invalidInput".into());
    }
    serde_json::from_value(cached(&cache, &format!("game:{id}"), "games", &[("id", &id)]).await?)
        .map_err(|_| "invalidResponse".into())
}
#[tauri::command]
pub fn open_deal(id: String) -> Result<(), String> {
    if id.is_empty()
        || id.len() > 256
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"%+=/_-".contains(&b))
    {
        return Err("invalidInput".into());
    }
    let mut url =
        reqwest::Url::parse("https://www.cheapshark.com/redirect").map_err(|_| "invalidInput")?;
    // IDs arrive percent-encoded from the API. Decode once before query encoding.
    let decoded: String = reqwest::Url::parse(&format!(
        "https://local.invalid/?id={}",
        id.replace('+', "%2B")
    ))
    .map_err(|_| "invalidInput")?
    .query_pairs()
    .find(|(k, _)| k == "id")
    .ok_or("invalidInput")?
    .1
    .into_owned();
    url.query_pairs_mut().append_pair("dealID", &decoded);
    tauri_plugin_opener::open_url(url.as_str(), None::<&str>).map_err(|_| "openFailed".into())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_non_numeric_game_ids() {
        assert!(valid_game_id("332562"));
        for id in ["", "../x", "1&key=secret", "12345678901234567"] {
            assert!(!valid_game_id(id));
        }
    }
    #[test]
    fn accepts_null_steam_id() {
        let d: Deal = serde_json::from_str(r#"{"gameID":"1","dealID":"x","storeID":"1","title":"Game","salePrice":"1.23","normalPrice":"9.99","savings":"87.6","thumb":"https://example.com/cover","steamAppID":null}"#).unwrap();
        assert_eq!(d.sale_price, "1.23");
        assert!(d.steam_app_id.is_none());
    }
}

#[cfg(test)]
mod live_tests {
    use super::*;
    #[test]
    #[ignore = "live provider integration"]
    fn cheapshark_live_contract() {
        tauri::async_runtime::block_on(async {
            let cache = StoreCache::default();
            let items = cached(&cache, "live", "deals", &[("pageSize", "2")])
                .await
                .unwrap();
            let deals: Vec<Deal> = serde_json::from_value(items).unwrap();
            assert!(!deals.is_empty());
            let game = cached(&cache, "detail", "games", &[("id", &deals[0].game_id)])
                .await
                .unwrap();
            let details: GameDetails = serde_json::from_value(game).unwrap();
            assert!(!details.info.title.is_empty());
            let shops = cached(&cache, "shops", "stores", &[]).await.unwrap();
            assert!(
                !serde_json::from_value::<Vec<Shop>>(shops)
                    .unwrap()
                    .is_empty()
            );
        });
    }
}
