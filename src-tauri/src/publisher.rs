use super::publisher_config::{PublisherConfig, Quote};
use serde::Serialize;
use std::time::{SystemTime, UNIX_EPOCH};
#[derive(Serialize)]
pub struct PartnerOffer {
    pub id: String,
    pub shop: String,
    pub quote: Option<Quote>,
}
#[derive(Serialize)]
pub struct PublisherStatus {
    pub configured: bool,
    pub program: Option<String>,
}
pub struct Publisher(pub PublisherConfig);
impl Default for Publisher {
    fn default() -> Self {
        Self(
            serde_json::from_str(include_str!(concat!(env!("OUT_DIR"), "/publisher.json")))
                .expect("invalid publisher configuration"),
        )
    }
}
impl PublisherConfig {
    fn active(&self) -> bool {
        self.publisher_id
            .as_ref()
            .is_some_and(|id| !id.trim().is_empty())
            && self.program.as_ref().is_some_and(|p| !p.trim().is_empty())
    }
    fn valid_url(&self, raw: &str) -> bool {
        let Ok(url) = reqwest::Url::parse(raw) else {
            return false;
        };
        url.scheme() == "https"
            && url.username().is_empty()
            && url.password().is_none()
            && url.host_str().is_some_and(|host| {
                self.allowed_tracking_hosts
                    .iter()
                    .any(|allowed| allowed.eq_ignore_ascii_case(host))
            })
            && !raw.chars().any(char::is_control)
    }
    fn offers_for(&self, steam_app_id: &str, now: u64) -> Vec<PartnerOffer> {
        if !self.active() || !crate::store::valid_game_id(steam_app_id) {
            return vec![];
        }
        self.offers
            .iter()
            .filter(|o| {
                o.steam_app_id == steam_app_id
                    && !o.id.is_empty()
                    && !o.shop.trim().is_empty()
                    && self.valid_url(&o.url)
            })
            .map(|o| PartnerOffer {
                id: o.id.clone(),
                shop: o.shop.clone(),
                quote: o
                    .quote
                    .as_ref()
                    .filter(|q| {
                        q.expires_at > now
                            && q.currency.len() == 3
                            && q.currency.bytes().all(|c| c.is_ascii_uppercase())
                            && q.amount
                                .parse::<f64>()
                                .is_ok_and(|p| p.is_finite() && p >= 0.0)
                    })
                    .cloned(),
            })
            .collect()
    }
    fn link_for(&self, id: &str) -> Result<&str, String> {
        if !self.active() {
            return Err("affiliateNotConfigured".into());
        }
        let offer = self
            .offers
            .iter()
            .find(|o| o.id == id)
            .ok_or("invalidInput")?;
        if !self.valid_url(&offer.url) {
            return Err("invalidInput".into());
        }
        Ok(&offer.url)
    }
}
#[tauri::command]
pub fn publisher_status(publisher: tauri::State<'_, Publisher>) -> PublisherStatus {
    PublisherStatus {
        configured: publisher.0.active(),
        program: publisher.0.program.clone(),
    }
}
#[tauri::command]
pub fn partner_offers(
    steam_app_id: String,
    publisher: tauri::State<'_, Publisher>,
) -> Vec<PartnerOffer> {
    publisher.0.offers_for(
        &steam_app_id,
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
    )
}
#[tauri::command]
pub fn open_partner_offer(
    id: String,
    publisher: tauri::State<'_, Publisher>,
) -> Result<(), String> {
    let url = publisher.0.link_for(&id)?;
    tauri_plugin_opener::open_url(url, None::<&str>).map_err(|_| "openFailed".into())
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::publisher_config::ConfiguredOffer;
    fn config() -> PublisherConfig {
        PublisherConfig {
            publisher_id: Some("test-publisher".into()),
            program: Some("test-program".into()),
            allowed_tracking_hosts: vec!["tracking.example.com".into()],
            offers: vec![ConfiguredOffer {
                id: "offer-1".into(),
                steam_app_id: "620".into(),
                shop: "Partner store".into(),
                url: "https://tracking.example.com/product?publisher=test".into(),
                quote: Some(Quote {
                    amount: "12.50".into(),
                    currency: "USD".into(),
                    expires_at: 200,
                }),
            }],
        }
    }
    #[test]
    fn missing_publisher_never_claims_monetization() {
        assert!(PublisherConfig::default().offers_for("620", 100).is_empty());
        assert_eq!(
            PublisherConfig::default().link_for("offer-1").unwrap_err(),
            "affiliateNotConfigured"
        );
    }
    #[test]
    fn expired_prices_are_not_displayed() {
        let c = config();
        assert!(c.offers_for("620", 100)[0].quote.is_some());
        assert!(c.offers_for("620", 300)[0].quote.is_none());
        assert!(c.offers_for("999", 100).is_empty());
    }
    #[test]
    fn only_approved_https_tracking_domains_are_opened() {
        let c = config();
        assert!(c.valid_url("https://tracking.example.com/product?publisher=test"));
        for url in [
            "javascript:alert(1)",
            "http://tracking.example.com/x",
            "https://tracking.example.com.evil.test/x",
            "https://evil.test/x",
            "https://user:pass@tracking.example.com/x",
        ] {
            assert!(!c.valid_url(url));
        }
    }
}
