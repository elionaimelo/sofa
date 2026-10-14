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
#[derive(Serialize, Deserialize)]
pub struct DealsPage {
    deals: Vec<Deal>,
    /// Total pages CheapShark reports for this query (`X-Total-Page-Count`).
    pages: u32,
}

#[tauri::command]
pub async fn store_deals(
    query: String,
    page: u32,
    cache: tauri::State<'_, StoreCache>,
) -> Result<DealsPage, String> {
    let query = query.trim();
    if query.chars().count() > 100 || page > 500 {
        return Err("invalidInput".into());
    }
    let key = format!("deals:{query}:{page}");
    let cached_page = cache
        .0
        .lock()
        .map_err(|_| "serviceUnavailable")?
        .get(&key)
        .filter(|(at, _)| at.elapsed() < Duration::from_secs(300))
        .map(|(_, v)| v.clone());
    let value = match cached_page {
        Some(value) => value,
        None => {
            let (body, pages) = network::text_with_header(
                network::client()?.get(format!("{BASE}/deals")).query(&[
                    ("title", query),
                    ("pageSize", "48"),
                    ("pageNumber", &page.to_string()),
                    ("sortBy", "Deal Rating"),
                ]),
                "x-total-page-count",
            )
            .await?;
            let deals: Vec<Deal> = serde_json::from_str(&body).map_err(|_| "invalidResponse")?;
            // One tile per game; comparisons come from /games?id=….
            let mut seen = std::collections::HashSet::new();
            let deals: Vec<Deal> = deals.into_iter().filter(|d| seen.insert(d.game_id.clone())).collect();
            let pages = pages.and_then(|p| p.trim().parse().ok()).unwrap_or(1).max(1);
            let value = serde_json::to_value(DealsPage { deals, pages }).map_err(|_| "invalidResponse")?;
            let mut entries = cache.0.lock().map_err(|_| "serviceUnavailable")?;
            if entries.len() >= 100 {
                entries.retain(|_, (at, _)| at.elapsed() < Duration::from_secs(300));
                if entries.len() >= 100 {
                    entries.clear();
                }
            }
            entries.insert(key, (Instant::now(), value.clone()));
            value
        }
    };
    serde_json::from_value(value).map_err(|_| "invalidResponse".into())
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
/// Steam regional prices for the deals that have a Steam id: CheapShark only knows US dollars.
pub const REGIONS: [&str; 6] = ["us", "br", "es", "mx", "ar", "pt"];

#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
pub struct RegionalPrice {
    currency: String,
    /// Minor units (cents, centavos), as Steam reports them.
    initial: u64,
    r#final: u64,
    discount: u8,
}

fn parse_prices(details: &Value) -> std::collections::HashMap<String, RegionalPrice> {
    let Some(apps) = details.as_object() else { return Default::default() };
    apps.iter()
        .filter_map(|(id, entry)| {
            let price = entry.get("data")?.get("price_overview")?;
            let currency = price.get("currency")?.as_str()?;
            if currency.len() != 3 || !currency.bytes().all(|b| b.is_ascii_uppercase()) {
                return None;
            }
            Some((
                id.clone(),
                RegionalPrice {
                    currency: currency.to_owned(),
                    initial: price.get("initial")?.as_u64()?,
                    r#final: price.get("final")?.as_u64()?,
                    discount: price.get("discount_percent")?.as_u64()?.min(100) as u8,
                },
            ))
        })
        .collect()
}

#[tauri::command]
pub async fn steam_prices(
    ids: Vec<String>,
    region: String,
) -> Result<std::collections::HashMap<String, RegionalPrice>, String> {
    if !REGIONS.contains(&region.as_str()) || ids.is_empty() || ids.len() > 60 {
        return Err("invalidInput".into());
    }
    if ids.iter().any(|id| id.is_empty() || id.len() > 10 || !id.bytes().all(|b| b.is_ascii_digit())) {
        return Err("invalidInput".into());
    }
    let details: Value = network::json(
        network::client()?
            .get("https://store.steampowered.com/api/appdetails")
            .query(&[("appids", ids.join(",").as_str()), ("cc", region.as_str()), ("filters", "price_overview")]),
    )
    .await?;
    Ok(parse_prices(&details))
}

/// A game Steam lists as similar to another, from its public "More like this" page.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Similar {
    app_id: String,
    /// From the store link's slug; the cover art carries the tile, this names it for screen readers.
    name: String,
}

fn numeric_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 10 && id.bytes().all(|b| b.is_ascii_digit())
}

fn parse_similar(html: &str, own: &str) -> Vec<Similar> {
    let document = scraper::Html::parse_document(html);
    let selector = scraper::Selector::parse("a.similar_grid_capsule[data-ds-appid]").unwrap();
    let mut found: Vec<Similar> = Vec::new();
    for node in document.select(&selector) {
        let Some(id) = node.value().attr("data-ds-appid") else { continue };
        if id == own || !numeric_id(id) || found.iter().any(|s| s.app_id == id) {
            continue;
        }
        let href = node.value().attr("href").unwrap_or_default();
        let name = href
            .split(&format!("/app/{id}/"))
            .nth(1)
            .and_then(|rest| rest.split(['/', '?']).next())
            .map(|slug| slug.replace('_', " ").trim().to_owned())
            .filter(|name| !name.is_empty());
        if let Some(name) = name {
            found.push(Similar { app_id: id.to_owned(), name });
        }
        if found.len() >= 24 {
            break;
        }
    }
    found
}

/// Games similar to one Steam title. Cached for a day; the page needs no account or key.
#[tauri::command]
pub async fn store_similar(app_id: String, cache: tauri::State<'_, StoreCache>) -> Result<Vec<Similar>, String> {
    if !numeric_id(&app_id) {
        return Err("invalidInput".into());
    }
    let key = format!("similar:{app_id}");
    let cached_list = cache
        .0
        .lock()
        .map_err(|_| "serviceUnavailable")?
        .get(&key)
        .filter(|(at, _)| at.elapsed() < Duration::from_secs(24 * 3600))
        .map(|(_, v)| v.clone());
    if let Some(list) = cached_list {
        return serde_json::from_value(list).map_err(|_| "invalidResponse".into());
    }
    let html = network::text(
        network::client()?
            .get(format!("https://store.steampowered.com/recommended/morelike/app/{app_id}/"))
            .query(&[("l", "english")]),
    )
    .await?;
    let list = parse_similar(&html, &app_id);
    let value = serde_json::to_value(&list).map_err(|_| "invalidResponse")?;
    cache.0.lock().map_err(|_| "serviceUnavailable")?.insert(key, (Instant::now(), value));
    Ok(list)
}

#[derive(Deserialize)]
struct CheapSharkGame {
    #[serde(rename = "gameID")]
    game_id: String,
    cheapest: String,
    #[serde(rename = "cheapestDealID")]
    cheapest_deal_id: String,
    external: String,
    #[serde(default)]
    thumb: String,
}

/// The CheapShark entry of a Steam title, as a deal the comparison can open; None when
/// CheapShark doesn't list it.
#[tauri::command]
pub async fn store_lookup(app_id: String) -> Result<Option<Deal>, String> {
    if !numeric_id(&app_id) {
        return Err("invalidInput".into());
    }
    let games: Vec<CheapSharkGame> = network::json(
        network::client()?
            .get(format!("{BASE}/games"))
            .query(&[("steamAppID", app_id.as_str())]),
    )
    .await?;
    Ok(games.into_iter().find(|g| valid_game_id(&g.game_id)).map(|g| Deal {
        game_id: g.game_id,
        deal_id: g.cheapest_deal_id,
        store_id: String::new(),
        title: g.external,
        sale_price: g.cheapest.clone(),
        normal_price: g.cheapest,
        savings: "0".into(),
        thumb: g.thumb,
        steam_app_id: Some(app_id),
    }))
}

/// The currency shoppers in a store region pay in.
fn region_currency(region: &str) -> Option<&'static str> {
    match region {
        "us" => Some("USD"),
        "br" => Some("BRL"),
        "es" | "pt" => Some("EUR"),
        "mx" => Some("MXN"),
        "ar" => Some("ARS"),
        _ => None,
    }
}

#[derive(Serialize)]
pub struct UsdRate {
    currency: &'static str,
    /// Units of `currency` per US dollar; None when the reference rates don't cover it.
    per_usd: Option<f64>,
}

/// CheapShark only knows US dollars; ECB reference rates (Frankfurter, no key) let the store
/// show them converted, marked as approximate. Cached for six hours.
#[tauri::command]
pub async fn usd_rate(region: String, cache: tauri::State<'_, StoreCache>) -> Result<UsdRate, String> {
    let currency = region_currency(&region).ok_or("invalidInput")?;
    if currency == "USD" {
        return Ok(UsdRate { currency, per_usd: Some(1.0) });
    }
    let key = format!("fx:{currency}");
    let cached_rate = cache
        .0
        .lock()
        .map_err(|_| "serviceUnavailable")?
        .get(&key)
        .filter(|(at, _)| at.elapsed() < Duration::from_secs(6 * 3600))
        .map(|(_, v)| v.clone());
    let rates = match cached_rate {
        Some(rates) => rates,
        None => {
            let rates: Value = network::json(
                network::client()?
                    .get("https://api.frankfurter.dev/v1/latest")
                    .query(&[("base", "USD"), ("symbols", currency)]),
            )
            .await?;
            cache
                .0
                .lock()
                .map_err(|_| "serviceUnavailable")?
                .insert(key, (Instant::now(), rates.clone()));
            rates
        }
    };
    let per_usd = rates["rates"][currency].as_f64().filter(|r| r.is_finite() && *r > 0.0);
    Ok(UsdRate { currency, per_usd })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn similar_games_come_from_the_capsule_links_without_the_game_itself() {
        let html = r#"<div><a class="similar_grid_capsule" data-ds-appid="1145360" href="https://store.steampowered.com/app/1145360/Hades/">x</a>
            <a class="similar_grid_capsule" data-ds-appid="1280930" href="https://store.steampowered.com/app/1280930/Astral_Ascent/?snr=1">x</a>
            <a class="similar_grid_capsule" data-ds-appid="1280930" href="https://store.steampowered.com/app/1280930/Astral_Ascent/">dup</a>
            <a class="similar_grid_capsule" data-ds-appid="bad" href="https://store.steampowered.com/app/bad/X/">x</a>
            <a class="other" data-ds-appid="7" href="https://store.steampowered.com/app/7/Other/">x</a></div>"#;
        assert_eq!(
            parse_similar(html, "1145360"),
            vec![Similar { app_id: "1280930".into(), name: "Astral Ascent".into() }]
        );
    }

    #[test]
    fn every_store_region_has_a_currency() {
        for region in REGIONS {
            assert!(region_currency(region).is_some(), "{region}");
        }
        assert_eq!(region_currency("br"), Some("BRL"));
        assert_eq!(region_currency("xx"), None);
    }

    #[test]
    fn regional_prices_keep_only_priced_apps_with_a_currency_code() {
        let details = serde_json::json!({
            "10": {"success": true, "data": {"price_overview": {"currency": "BRL", "initial": 5999, "final": 2999, "discount_percent": 50}}},
            "20": {"success": true, "data": {}},
            "30": {"success": false},
            "40": {"success": true, "data": {"price_overview": {"currency": "r$", "initial": 1, "final": 1, "discount_percent": 0}}}
        });
        let prices = parse_prices(&details);
        assert_eq!(prices.len(), 1);
        assert_eq!(prices["10"], RegionalPrice { currency: "BRL".into(), initial: 5999, r#final: 2999, discount: 50 });
    }
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

