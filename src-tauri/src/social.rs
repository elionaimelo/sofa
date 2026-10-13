use crate::network;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
#[derive(Default)]
pub struct SocialSession(Mutex<SessionData>);
#[derive(Default)]
struct SessionData {
    generation: u64,
    credentials: Option<(String, String)>,
}
impl SessionData {
    fn clear(&mut self) {
        self.generation = self.generation.wrapping_add(1);
        self.credentials = None;
    }
    fn accept(&mut self, generation: u64, key: String, id: String) -> bool {
        if generation != self.generation {
            return false;
        }
        self.credentials = Some((key, id));
        true
    }
}
#[derive(Serialize, Deserialize, Clone)]
pub struct Friend {
    pub steamid: String,
    pub personaname: String,
    pub avatarfull: String,
    pub personastate: u8,
    pub gameextrainfo: Option<String>,
    pub gameid: Option<String>,
}
pub fn valid_id(id: &str) -> bool {
    id.len() == 17 && id.bytes().all(|b| b.is_ascii_digit())
}
#[derive(Deserialize)]
struct FriendList {
    friendslist: List,
}
#[derive(Deserialize)]
struct List {
    friends: Vec<FriendId>,
}
#[derive(Deserialize)]
struct FriendId {
    steamid: String,
}
#[derive(Deserialize)]
struct Players {
    response: Summaries,
}
#[derive(Deserialize)]
struct Summaries {
    players: Vec<Friend>,
}
async fn fetch(key: &str, id: &str) -> Result<Vec<Friend>, String> {
    let client = network::client()?;
    let list: FriendList = network::json(
        client
            .get("https://api.steampowered.com/ISteamUser/GetFriendList/v1/")
            .query(&[("key", key), ("steamid", id), ("relationship", "friend")]),
    )
    .await
    .map_err(|e| {
        if e == "accessDenied" {
            "privateProfile".into()
        } else {
            e
        }
    })?;
    let mut friends = Vec::new();
    let ids: Vec<_> = list
        .friendslist
        .friends
        .into_iter()
        .filter(|f| valid_id(&f.steamid))
        .map(|f| f.steamid)
        .collect();
    for chunk in ids.chunks(100) {
        let players: Players = network::json(
            client
                .get("https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/")
                .query(&[("key", key), ("steamids", &chunk.join(","))]),
        )
        .await
        .map_err(|e| {
            if e == "accessDenied" {
                "privateProfile".into()
            } else {
                e
            }
        })?;
        friends.extend(players.response.players);
    }
    friends.sort_by(|a, b| {
        (b.gameid.is_some(), b.personastate > 0)
            .cmp(&(a.gameid.is_some(), a.personastate > 0))
            .then_with(|| {
                a.personaname
                    .to_lowercase()
                    .cmp(&b.personaname.to_lowercase())
            })
    });
    Ok(friends)
}
#[tauri::command]
pub async fn connect_friends(
    key: String,
    steam_id: String,
    session: tauri::State<'_, SocialSession>,
) -> Result<Vec<Friend>, String> {
    if !valid_id(&steam_id) || key.len() != 32 || !key.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("invalidSteamAccount".into());
    }
    let generation = {
        let mut data = session.0.lock().map_err(|_| "serviceUnavailable")?;
        data.clear();
        data.generation
    };
    let friends = fetch(&key, &steam_id).await?;
    if !session
        .0
        .lock()
        .map_err(|_| "serviceUnavailable")?
        .accept(generation, key, steam_id)
    {
        return Err("notConnected".into());
    }
    Ok(friends)
}
#[tauri::command]
pub async fn refresh_friends(
    session: tauri::State<'_, SocialSession>,
) -> Result<Vec<Friend>, String> {
    let (generation, key, id) = {
        let data = session.0.lock().map_err(|_| "serviceUnavailable")?;
        let (key, id) = data.credentials.clone().ok_or("notConnected")?;
        (data.generation, key, id)
    };
    let friends = fetch(&key, &id).await?;
    if session
        .0
        .lock()
        .map_err(|_| "serviceUnavailable")?
        .generation
        != generation
    {
        return Err("notConnected".into());
    }
    Ok(friends)
}
#[tauri::command]
pub fn disconnect_friends(session: tauri::State<'_, SocialSession>) -> Result<(), String> {
    session.0.lock().map_err(|_| "serviceUnavailable")?.clear();
    Ok(())
}
#[tauri::command]
pub fn open_social(target: String, id: Option<String>) -> Result<(), String> {
    let url = match target.as_str() {
        "chat" => "https://steamcommunity.com/chat/".into(),
        "key" => "https://steamcommunity.com/dev/apikey".into(),
        "profile" => {
            let id = id.ok_or("invalidInput")?;
            if !valid_id(&id) {
                return Err("invalidInput".into());
            }
            format!("https://steamcommunity.com/profiles/{id}")
        }
        _ => return Err("invalidInput".into()),
    };
    tauri_plugin_opener::open_url(&url, None::<&str>).map_err(|_| "openFailed".into())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn steam_ids_cannot_be_urls_or_queries() {
        assert!(valid_id("76561198000000000"));
        for id in [
            "",
            "76561198&key=x",
            "https://example.com",
            "-7656119800000000",
        ] {
            assert!(!valid_id(id));
        }
    }
}

#[cfg(test)]
mod session_tests {
    use super::*;
    #[test]
    fn disconnect_invalidates_in_flight_login() {
        let mut state = SessionData::default();
        state.clear();
        let pending = state.generation;
        state.clear();
        assert!(!state.accept(pending, "secret".into(), "id".into()));
        assert!(state.credentials.is_none());
    }
}
