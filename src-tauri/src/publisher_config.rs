use serde::{Deserialize, Serialize};
#[derive(Deserialize, Serialize, Default)]
#[serde(deny_unknown_fields)]
pub struct PublisherConfig {
    pub publisher_id: Option<String>,
    pub program: Option<String>,
    #[serde(default)]
    pub allowed_tracking_hosts: Vec<String>,
    #[serde(default)]
    pub offers: Vec<ConfiguredOffer>,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ConfiguredOffer {
    pub id: String,
    pub steam_app_id: String,
    pub shop: String,
    pub url: String,
    pub quote: Option<Quote>,
}
#[derive(Deserialize, Serialize, Clone)]
#[serde(deny_unknown_fields)]
pub struct Quote {
    pub amount: String,
    pub currency: String,
    pub expires_at: u64,
}
