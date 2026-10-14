use reqwest::Client;
use serde::de::DeserializeOwned;
use std::time::Duration;

pub fn client() -> Result<Client, String> {
    Client::builder()
        .user_agent("Sofa/0.3.12 (https://github.com/elionaimelo/sofa)")
        .timeout(Duration::from_secs(15))
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "network".to_string())
}

// Never expose request URLs: Steam's API carries the user's key in the query.
pub async fn text(request: reqwest::RequestBuilder) -> Result<String, String> {
    let mut response = request.send().await.map_err(|_| "network".to_string())?;
    let status = response.status().as_u16();
    if status == 429 {
        return Err("rateLimit".into());
    }
    if status == 401 {
        return Err("authFailed".into());
    }
    if status == 403 {
        return Err("accessDenied".into());
    }
    if !(200..300).contains(&status) {
        // The UI shows the status; it's the only clue when a site changes behaviour.
        return Err(format!("http:{status}"));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "network".to_string())? {
        if bytes.len() + chunk.len() > 4 * 1024 * 1024 {
            return Err("invalidResponse".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    String::from_utf8(bytes).map_err(|_| "invalidResponse".into())
}

pub async fn json<T: DeserializeOwned>(request: reqwest::RequestBuilder) -> Result<T, String> {
    serde_json::from_str(&text(request).await?).map_err(|_| "invalidResponse".into())
}
