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
pub(crate) const DAY: Duration = Duration::from_secs(24 * 3600);
impl StoreCache {
    /// The value kept under `key`, when it is younger than `ttl`.
    pub(crate) fn fresh(&self, key: &str, ttl: Duration) -> Result<Option<Value>, String> {
        let entries = self.0.lock().map_err(|_| "serviceUnavailable")?;
        Ok(entries.get(key).filter(|(at, _)| at.elapsed() < ttl).map(|(_, v)| v.clone()))
    }
    pub(crate) fn keep(&self, key: String, value: Value) -> Result<(), String> {
        self.0.lock().map_err(|_| "serviceUnavailable")?.insert(key, (Instant::now(), value));
        Ok(())
    }
}
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
    if let Some(list) = cache.fresh(&key, DAY)? {
        return serde_json::from_value(list).map_err(|_| "invalidResponse".into());
    }
    let html = network::text(
        network::client()?
            .get(format!("https://store.steampowered.com/recommended/morelike/app/{app_id}/"))
            .query(&[("l", "english")]),
    )
    .await?;
    let list = parse_similar(&html, &app_id);
    cache.keep(key, serde_json::to_value(&list).map_err(|_| "invalidResponse")?)?;
    Ok(list)
}

/// A screenshot or trailer from a game's Steam page.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Shot {
    /// The 600×338 screenshot, or a trailer's poster. The strip and the stage share it, as on
    /// Steam's own page, so picking a shot downloads nothing new.
    image: String,
    /// The trailer's HLS stream.
    video: Option<String>,
}

/// What Steam's page says about a game: its short description, its gallery and the facts a
/// controller player checks before installing or buying it.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct Media {
    description: String,
    /// Trailers first, then screenshots, in Steam's order.
    gallery: Vec<Shot>,
    /// "full" or "partial", as the store page lists it; None when it lists nothing.
    controller: Option<String>,
    /// Steam Deck compatibility: 1 unsupported, 2 playable, 3 verified.
    deck: Option<u8>,
    reviews: Option<Reviews>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Reviews {
    positive: u64,
    total: u64,
}

fn parse_deck(report: &Value) -> Option<u8> {
    let category = report["results"]["resolved_category"].as_u64()?;
    (1..=3).contains(&category).then_some(category as u8)
}

fn parse_reviews(response: &Value) -> Option<Reviews> {
    let summary = &response["query_summary"];
    let (positive, total) = (summary["total_positive"].as_u64()?, summary["total_reviews"].as_u64()?);
    (total > 0 && positive <= total).then_some(Reviews { positive, total })
}
/// Store pages barely change: media stays on disk for 30 days, one file per title and language.
const MEDIA_TTL: Duration = Duration::from_secs(30 * 24 * 3600);

fn read_media(path: &std::path::Path) -> Option<Media> {
    let meta = std::fs::metadata(path).ok()?;
    if meta.len() > 256 * 1024 || meta.modified().ok()?.elapsed().ok()? > MEDIA_TTL {
        return None;
    }
    // A torn write fails to parse and is fetched again.
    serde_json::from_slice(&std::fs::read(path).ok()?).ok()
}

/// Steam's name for an interface language.
fn steam_language(lang: &str) -> Option<&'static str> {
    match lang {
        "en" => Some("english"),
        "pt-BR" => Some("brazilian"),
        "es" => Some("spanish"),
        _ => None,
    }
}

/// Only HTTPS addresses on Steam's own CDN reach an image or a video in the webview.
fn steam_cdn(url: Option<&str>) -> Option<String> {
    let url = reqwest::Url::parse(url?).ok()?;
    (url.scheme() == "https" && url.host_str()?.ends_with(".steamstatic.com")).then(|| url.into())
}

fn parse_media(details: &Value, app_id: &str) -> Media {
    let data = &details[app_id]["data"];
    // Plain text, but Steam escapes it as HTML (`&quot;`).
    let description = scraper::Html::parse_fragment(data["short_description"].as_str().unwrap_or_default())
        .root_element()
        .text()
        .collect::<String>()
        .trim()
        .to_owned();
    let trailers = data["movies"].as_array().into_iter().flatten().filter_map(|m| {
        Some(Shot { image: steam_cdn(m["thumbnail"].as_str())?, video: Some(steam_cdn(m["hls_h264"].as_str())?) })
    });
    let screenshots = data["screenshots"].as_array().into_iter().flatten().filter_map(|s| {
        Some(Shot { image: steam_cdn(s["path_thumbnail"].as_str())?, video: None })
    });
    let controller =
        data["controller_support"].as_str().filter(|c| ["full", "partial"].contains(c)).map(str::to_owned);
    Media {
        description,
        gallery: trailers.take(3).chain(screenshots.take(12)).collect(),
        controller,
        deck: None,
        reviews: None,
    }
}

/// A Steam title's short description, trailers and screenshots in the interface language,
/// from the public `appdetails` API.
#[tauri::command]
pub async fn store_media(
    app_id: String,
    lang: String,
    app: tauri::AppHandle,
    cache: tauri::State<'_, StoreCache>,
) -> Result<Media, String> {
    let language = steam_language(&lang).ok_or("invalidInput")?;
    if !numeric_id(&app_id) {
        return Err("invalidInput".into());
    }
    media(&app_id, language, &app, &cache).await
}

/// The same for a library game; Epic and GOG titles borrow the Steam page of the same name.
#[tauri::command]
pub async fn game_media(
    id: String,
    title: Option<String>,
    lang: String,
    app: tauri::AppHandle,
    cache: tauri::State<'_, StoreCache>,
) -> Result<Media, String> {
    let language = steam_language(&lang).ok_or("invalidInput")?;
    match crate::categories::steam_app_for_game(&id, title.as_deref(), &cache).await? {
        Some(app_id) => media(&app_id, language, &app, &cache).await,
        None => Ok(Media::default()),
    }
}

/// Kept in memory and for 30 days on disk; an empty answer stays in memory only, so a title
/// Steam lists later shows up the next day. `app_id` must be numeric: it names the file.
async fn media(app_id: &str, language: &str, app: &tauri::AppHandle, cache: &StoreCache) -> Result<Media, String> {
    use tauri::Manager;
    let key = format!("media:{app_id}:{language}");
    if let Some(media) = cache.fresh(&key, DAY)? {
        return serde_json::from_value(media).map_err(|_| "invalidResponse".into());
    }
    let file = app.path().app_cache_dir().ok().map(|dir| dir.join("store-media-v2").join(format!("{app_id}-{language}.json")));
    let media = match file.as_deref().and_then(read_media) {
        Some(media) => media,
        None => {
            let details: Value = network::json(
                network::client()?
                    .get("https://store.steampowered.com/api/appdetails")
                    .query(&[("appids", app_id), ("l", language), ("filters", "basic,screenshots,movies")]),
            )
            .await?;
            let mut media = parse_media(&details, app_id);
            // Extras: a failure here leaves the badge out, not the description and gallery.
            media.deck = network::json::<Value>(
                network::client()?
                    .get("https://store.steampowered.com/saleaction/ajaxgetdeckappcompatibilityreport")
                    .query(&[("nAppID", app_id)]),
            )
            .await
            .ok()
            .as_ref()
            .and_then(parse_deck);
            media.reviews = network::json::<Value>(
                network::client()?
                    .get(format!("https://store.steampowered.com/appreviews/{app_id}"))
                    .query(&[("json", "1"), ("language", "all"), ("purchase_type", "all"), ("num_per_page", "0")]),
            )
            .await
            .ok()
            .as_ref()
            .and_then(parse_reviews);
            if let Some(file) = &file
                && !(media.description.is_empty() && media.gallery.is_empty())
                && let (Some(dir), Ok(json)) = (file.parent(), serde_json::to_vec(&media))
            {
                let _ = std::fs::create_dir_all(dir);
                let _ = std::fs::write(file, json);
            }
            media
        }
    };
    cache.keep(key, serde_json::to_value(&media).map_err(|_| "invalidResponse")?)?;
    Ok(media)
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
pub async fn store_lookup(app_id: String, cache: tauri::State<'_, StoreCache>) -> Result<Option<Deal>, String> {
    if !numeric_id(&app_id) {
        return Err("invalidInput".into());
    }
    lookup(&app_id, &cache).await
}

/// Cached for a day, misses too. `app_id` must be numeric.
async fn lookup(app_id: &str, cache: &StoreCache) -> Result<Option<Deal>, String> {
    let key = format!("lookup:{app_id}");
    if let Some(deal) = cache.fresh(&key, DAY)? {
        return serde_json::from_value(deal).map_err(|_| "invalidResponse".into());
    }
    let games: Vec<CheapSharkGame> =
        network::json(network::client()?.get(format!("{BASE}/games")).query(&[("steamAppID", app_id)])).await?;
    let deal = games.into_iter().find(|g| valid_game_id(&g.game_id)).map(|g| Deal {
        game_id: g.game_id,
        deal_id: g.cheapest_deal_id,
        store_id: String::new(),
        title: g.external,
        sale_price: g.cheapest.clone(),
        normal_price: g.cheapest,
        savings: "0".into(),
        thumb: g.thumb,
        steam_app_id: Some(app_id.to_owned()),
    });
    cache.keep(key, serde_json::to_value(&deal).map_err(|_| "invalidResponse")?)?;
    Ok(deal)
}

/// The connected account's Steam wishlist as deals the store can compare, highest priority
/// first. Titles CheapShark doesn't list are left out; at most 60, and uncached lookups are
/// paced so CheapShark isn't flooded.
#[tauri::command]
pub async fn import_steam_wishlist(
    app: tauri::AppHandle,
    session: tauri::State<'_, crate::accounts::SteamLibrarySession>,
    cache: tauri::State<'_, StoreCache>,
) -> Result<Vec<Deal>, String> {
    let app_ids = crate::accounts::wishlist(&app, &session).await?;
    let mut deals = Vec::new();
    for app_id in app_ids.iter().take(60).map(u32::to_string) {
        let known = cache.fresh(&format!("lookup:{app_id}"), DAY)?.is_some();
        if let Ok(Some(deal)) = lookup(&app_id, &cache).await {
            deals.push(deal);
        }
        if !known {
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
    }
    crate::log::info(&app, format!("store: imported {} of {} wishlist games", deals.len(), app_ids.len()));
    Ok(deals)
}

/// The cheapest offer per CheapShark game in a `/games?ids=` answer.
fn parse_cheapest(value: &Value) -> HashMap<String, Offer> {
    let price = |o: &Offer| o.price.parse::<f64>().unwrap_or(f64::MAX);
    value
        .as_object()
        .into_iter()
        .flatten()
        .filter_map(|(id, game)| {
            let deals: Vec<Offer> = serde_json::from_value(game["deals"].clone()).ok()?;
            Some((id.clone(), deals.into_iter().min_by(|a, b| price(a).total_cmp(&price(b)))?))
        })
        .collect()
}

/// Today's cheapest offer for each wishlist game, in batches of 25 (CheapShark's limit).
#[tauri::command]
pub async fn wishlist_prices(
    ids: Vec<String>,
    cache: tauri::State<'_, StoreCache>,
) -> Result<HashMap<String, Offer>, String> {
    if ids.len() > 200 || ids.iter().any(|id| !valid_game_id(id)) {
        return Err("invalidInput".into());
    }
    let mut found = HashMap::new();
    for chunk in ids.chunks(25) {
        let joined = chunk.join(",");
        found.extend(parse_cheapest(&cached(&cache, &format!("prices:{joined}"), "games", &[("ids", &joined)]).await?));
    }
    Ok(found)
}

/// A game Epic gives away this week.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct FreeGame {
    id: String,
    title: String,
    image: Option<String>,
    /// When the offer ends, as Epic writes it (ISO 8601).
    ends: String,
    slug: String,
}

fn epic_slug(slug: &str) -> Option<String> {
    let slug = slug.trim_end_matches("/home");
    (!slug.is_empty() && slug.len() <= 120 && slug.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-'))
        .then(|| slug.to_owned())
}

fn parse_free(feed: &Value) -> Vec<FreeGame> {
    let list = |v: &Value| v.as_array().cloned().unwrap_or_default();
    list(&feed["data"]["Catalog"]["searchStore"]["elements"])
        .iter()
        .filter_map(|game| {
            let offer = list(&game["promotions"]["promotionalOffers"])
                .iter()
                .flat_map(|group| list(&group["promotionalOffers"]))
                .find(|o| o["discountSetting"]["discountPercentage"] == 0)?;
            if game["price"]["totalPrice"]["discountPrice"] != 0 {
                return None;
            }
            let id = game["id"].as_str().filter(|id| id.len() <= 64 && id.bytes().all(|b| b.is_ascii_alphanumeric()))?;
            let slug = [&game["offerMappings"][0]["pageSlug"], &game["catalogNs"]["mappings"][0]["pageSlug"], &game["productSlug"]]
                .into_iter()
                .find_map(|s| s.as_str().and_then(epic_slug))?;
            let image = ["OfferImageWide", "Thumbnail"].iter().find_map(|kind| {
                list(&game["keyImages"]).iter().find(|i| i["type"] == *kind).and_then(|i| {
                    let url = reqwest::Url::parse(i["url"].as_str()?).ok()?;
                    (url.scheme() == "https" && url.host_str()?.ends_with(".epicgames.com")).then(|| url.into())
                })
            });
            Some(FreeGame {
                id: id.to_owned(),
                title: game["title"].as_str()?.trim().to_owned(),
                image,
                ends: offer["endDate"].as_str()?.to_owned(),
                slug,
            })
        })
        .collect()
}

/// Epic's free games this week, from the store's public promotions feed. Cached for an hour.
#[tauri::command]
pub async fn epic_free_games(
    region: String,
    lang: String,
    cache: tauri::State<'_, StoreCache>,
) -> Result<Vec<FreeGame>, String> {
    if !REGIONS.contains(&region.as_str()) {
        return Err("invalidInput".into());
    }
    let country = region.to_ascii_uppercase();
    let locale = match lang.as_str() {
        "pt-BR" => "pt-BR",
        "es" => "es-ES",
        _ => "en-US",
    };
    let key = format!("epicfree:{country}:{locale}");
    if let Some(games) = cache.fresh(&key, Duration::from_secs(3600))? {
        return serde_json::from_value(games).map_err(|_| "invalidResponse".into());
    }
    let feed: Value = network::json(
        network::client()?
            .get("https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions")
            .query(&[("locale", locale), ("country", country.as_str()), ("allowCountries", country.as_str())]),
    )
    .await?;
    let games = parse_free(&feed);
    for game in &games {
        cache.keep(format!("epicslug:{}", game.id), game.slug.clone().into())?;
    }
    cache.keep(key, serde_json::to_value(&games).map_err(|_| "invalidResponse")?)?;
    Ok(games)
}

/// Opens a free game's Epic store page; the page is looked up from the feed by id.
#[tauri::command]
pub fn open_epic_free(id: String, cache: tauri::State<'_, StoreCache>) -> Result<(), String> {
    let slug = cache.fresh(&format!("epicslug:{id}"), DAY)?.and_then(|s| s.as_str().and_then(epic_slug)).ok_or("invalidInput")?;
    tauri_plugin_opener::open_url(format!("https://store.epicgames.com/p/{slug}"), None::<&str>)
        .map_err(|_| "openFailed".into())
}

/// One of a Steam title's user tags and how strongly players applied it.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct TagWeight {
    tagid: u32,
    weight: u32,
}

fn parse_tags(response: &Value) -> Vec<(String, Vec<TagWeight>)> {
    response["response"]["store_items"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|item| {
            let id = item["appid"].as_u64()?.to_string();
            let tags = item["tags"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|t| {
                    Some(TagWeight {
                        tagid: u32::try_from(t["tagid"].as_u64()?).ok()?,
                        weight: u32::try_from(t["weight"].as_u64()?).ok()?,
                    })
                })
                .collect();
            Some((id, tags))
        })
        .collect()
}

/// Weighted user tags of Steam titles, in one batch from the store's public item API (no
/// key). Each title is cached for a week; titles Steam doesn't return are cached as untagged.
#[tauri::command]
pub async fn steam_tags(
    ids: Vec<String>,
    cache: tauri::State<'_, StoreCache>,
) -> Result<HashMap<String, Vec<TagWeight>>, String> {
    if ids.len() > 100 || ids.iter().any(|id| !numeric_id(id)) {
        return Err("invalidInput".into());
    }
    let mut found = HashMap::new();
    let mut missing = Vec::new();
    {
        let entries = cache.0.lock().map_err(|_| "serviceUnavailable")?;
        for id in &ids {
            match entries
                .get(&format!("tags:{id}"))
                .filter(|(at, _)| at.elapsed() < Duration::from_secs(7 * 24 * 3600))
                .and_then(|(_, v)| serde_json::from_value::<Vec<TagWeight>>(v.clone()).ok())
            {
                Some(tags) => drop(found.insert(id.clone(), tags)),
                None => missing.push(id.clone()),
            }
        }
    }
    if missing.is_empty() {
        return Ok(found);
    }
    let request = serde_json::json!({
        "ids": missing.iter().filter_map(|id| id.parse::<u64>().ok()).map(|appid| serde_json::json!({ "appid": appid })).collect::<Vec<_>>(),
        "context": { "language": "english", "country_code": "US" },
        "data_request": { "include_tag_count": 20 },
    });
    let response: Value = network::json(
        network::client()?
            .get("https://api.steampowered.com/IStoreBrowseService/GetItems/v1/")
            .query(&[("input_json", request.to_string())]),
    )
    .await?;
    let mut fetched: HashMap<String, Vec<TagWeight>> = parse_tags(&response).into_iter().collect();
    let mut entries = cache.0.lock().map_err(|_| "serviceUnavailable")?;
    for id in missing {
        let tags = fetched.remove(&id).unwrap_or_default();
        if let Ok(value) = serde_json::to_value(&tags) {
            entries.insert(format!("tags:{id}"), (Instant::now(), value));
        }
        found.insert(id, tags);
    }
    Ok(found)
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
    let rates = match cache.fresh(&key, Duration::from_secs(6 * 3600))? {
        Some(rates) => rates,
        None => {
            let rates: Value = network::json(
                network::client()?
                    .get("https://api.frankfurter.dev/v1/latest")
                    .query(&[("base", "USD"), ("symbols", currency)]),
            )
            .await?;
            cache.keep(key, rates.clone())?;
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
    fn media_keeps_steam_cdn_items_trailers_first_and_unescapes_the_description() {
        let cdn = "https://shared.akamai.steamstatic.com/a";
        let details = serde_json::json!({"10": {"success": true, "data": {
            "short_description": " Escape the &quot;Underworld&quot; &amp; more ",
            "screenshots": [
                {"path_thumbnail": format!("{cdn}/1t.jpg"), "path_full": format!("{cdn}/1.jpg")},
                {"path_thumbnail": "http://shared.akamai.steamstatic.com/a/2t.jpg", "path_full": format!("{cdn}/2.jpg")},
                {"path_thumbnail": "https://evil.example/3t.jpg", "path_full": format!("{cdn}/3.jpg")},
                {"path_thumbnail": "https://steamstatic.com.evil.example/4t.jpg", "path_full": format!("{cdn}/4.jpg")}
            ],
            "movies": [
                {"thumbnail": format!("{cdn}/m.jpg"), "hls_h264": "https://video.akamai.steamstatic.com/m.m3u8"},
                {"thumbnail": format!("{cdn}/n.jpg")}
            ]
        }}});
        let media = parse_media(&details, "10");
        assert_eq!(media.description, "Escape the \"Underworld\" & more");
        assert_eq!(media.controller, None);
        assert_eq!(
            media.gallery,
            vec![
                Shot { image: format!("{cdn}/m.jpg"), video: Some("https://video.akamai.steamstatic.com/m.m3u8".into()) },
                Shot { image: format!("{cdn}/1t.jpg"), video: None },
            ]
        );
        assert_eq!(parse_media(&serde_json::json!({"10": {"success": false}}), "10").gallery, vec![]);
        assert_eq!(steam_language("pt-BR"), Some("brazilian"));
        let full = serde_json::json!({"10": {"data": {"controller_support": "full"}}});
        assert_eq!(parse_media(&full, "10").controller.as_deref(), Some("full"));
        let odd = serde_json::json!({"10": {"data": {"controller_support": "<b>"}}});
        assert_eq!(parse_media(&odd, "10").controller, None);
        assert_eq!(parse_deck(&serde_json::json!({"results": {"resolved_category": 3}})), Some(3));
        assert_eq!(parse_deck(&serde_json::json!({"results": {"resolved_category": 0}})), None);
        assert_eq!(
            parse_reviews(&serde_json::json!({"query_summary": {"total_positive": 90, "total_reviews": 100}})),
            Some(Reviews { positive: 90, total: 100 })
        );
        assert_eq!(parse_reviews(&serde_json::json!({"query_summary": {"total_positive": 0, "total_reviews": 0}})), None);
        assert_eq!(steam_language("de"), None);
    }

    #[test]
    fn wishlist_prices_keep_the_cheapest_offer_per_game() {
        let answer = serde_json::json!({
            "612": {"deals": [
                {"storeID": "1", "dealID": "a", "price": "9.99", "retailPrice": "19.99", "savings": "50"},
                {"storeID": "7", "dealID": "b", "price": "7.49", "retailPrice": "19.99", "savings": "62"}
            ]},
            "613": {"deals": []},
            "614": {}
        });
        let prices = parse_cheapest(&answer);
        assert_eq!(prices.len(), 1);
        assert_eq!(prices["612"].deal_id, "b");
    }

    #[test]
    fn free_games_are_the_current_full_discounts_with_a_safe_page() {
        let offer = |percent: u32| serde_json::json!([{"promotionalOffers": [{"endDate": "2026-10-15T15:00:00.000Z", "discountSetting": {"discountPercentage": percent}}]}]);
        let feed = serde_json::json!({"data": {"Catalog": {"searchStore": {"elements": [
            {"id": "abc123", "title": " Out of Sight ", "price": {"totalPrice": {"discountPrice": 0}},
             "promotions": {"promotionalOffers": offer(0)},
             "offerMappings": [{"pageSlug": "out-of-sight-b96ca8"}],
             "keyImages": [{"type": "Thumbnail", "url": "https://cdn1.epicgames.com/x.jpg"}, {"type": "OfferImageWide", "url": "https://evil.example/w.jpg"}]},
            {"id": "def456", "title": "Half off", "price": {"totalPrice": {"discountPrice": 1999}},
             "promotions": {"promotionalOffers": offer(50)}, "productSlug": "half-off"},
            {"id": "ghi789", "title": "Bad page", "price": {"totalPrice": {"discountPrice": 0}},
             "promotions": {"promotionalOffers": offer(0)}, "productSlug": "../../x"},
            {"id": "jkl012", "title": "Upcoming", "price": {"totalPrice": {"discountPrice": 0}},
             "promotions": {"promotionalOffers": []}, "productSlug": "upcoming"}
        ]}}}});
        assert_eq!(
            parse_free(&feed),
            vec![FreeGame {
                id: "abc123".into(),
                title: "Out of Sight".into(),
                image: Some("https://cdn1.epicgames.com/x.jpg".into()),
                ends: "2026-10-15T15:00:00.000Z".into(),
                slug: "out-of-sight-b96ca8".into(),
            }]
        );
        assert_eq!(epic_slug("thems-fightin-herds/home").as_deref(), Some("thems-fightin-herds"));
    }

    #[test]
    fn tags_come_with_their_weights_per_title() {
        let response = serde_json::json!({"response": {"store_items": [
            {"appid": 1145360, "tags": [{"tagid": 42804, "weight": 1051}, {"tagid": 3959, "weight": 766}]},
            {"appid": 620},
            {"id": 7, "tags": [{"tagid": 1, "weight": 1}]}
        ]}});
        assert_eq!(
            parse_tags(&response),
            vec![
                ("1145360".to_string(), vec![TagWeight { tagid: 42804, weight: 1051 }, TagWeight { tagid: 3959, weight: 766 }]),
                ("620".to_string(), vec![]),
            ]
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

