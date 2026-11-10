//! NetEase Cloud Music, without a helper server.
//!
//! Search and lyrics sit on the public web API. Playback needs the encrypted
//! `eapi` the desktop client uses: an AES-128-ECB payload whose digest covers
//! the requested path and JSON body. We ask for a URL, then fetch the audio
//! once into the app cache, because a WebView cannot send the Referer and
//! User-Agent the CDN expects.

use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use aes::cipher::{block_padding::Pkcs7, BlockEncryptMut, KeyInit};
use aes::Aes128;
use md5::{Digest, Md5};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

const SITE: &str = "https://music.163.com";
const EAPI: &str = "https://interfacepc.music.163.com";
/// The protocol key shipped inside the upstream desktop client, not a secret.
const EAPI_KEY: &str = "e82ckenh8dichen8";
const UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const EAPI_UA: &str = "NeteaseMusic 9.0.90/5038 (iPhone; iOS 16.2; zh_CN)";

static JAR: OnceLock<Mutex<Vec<(String, String)>>> = OnceLock::new();
static JAR_PATH: OnceLock<PathBuf> = OnceLock::new();
static CHART: OnceLock<Mutex<Option<(Instant, Value)>>> = OnceLock::new();

fn jar() -> &'static Mutex<Vec<(String, String)>> {
    JAR.get_or_init(|| Mutex::new(Vec::new()))
}

/// Load the cookie jar once, from the app config directory.
pub fn init(app: &tauri::AppHandle) {
    use tauri::Manager;
    let Ok(dir) = app.path().app_config_dir() else { return };
    let _ = std::fs::create_dir_all(&dir);
    let path = dir.join("netease.cookies");
    if let Ok(text) = std::fs::read_to_string(&path) {
        let mut store = jar().lock().unwrap();
        for pair in text.split(';') {
            if let Some((name, value)) = pair.trim().split_once('=') {
                store.push((name.to_string(), value.to_string()));
            }
        }
    }
    let _ = JAR_PATH.set(path);
}

fn save_jar() {
    if let Some(path) = JAR_PATH.get() {
        let store = jar().lock().unwrap();
        let text = store
            .iter()
            .map(|(name, value)| format!("{name}={value}"))
            .collect::<Vec<_>>()
            .join("; ");
        let _ = std::fs::write(path, text);
    }
}

fn jar_header() -> Option<String> {
    let store = jar().lock().unwrap();
    if store.is_empty() {
        return None;
    }
    Some(
        store
            .iter()
            .map(|(name, value)| format!("{name}={value}"))
            .collect::<Vec<_>>()
            .join("; "),
    )
}

/// Keep whatever the server set, so the next request looks like the same
/// client. NetEase hands out NMTID this way and treats a missing one as
/// suspicious.
fn absorb(headers: &reqwest::header::HeaderMap) {
    let mut changed = false;
    for value in headers.get_all(reqwest::header::SET_COOKIE) {
        let Ok(text) = value.to_str() else { continue };
        let Some(pair) = text.split(';').next() else { continue };
        let Some((name, val)) = pair.split_once('=') else { continue };
        if name.trim().is_empty() || val.trim().is_empty() {
            continue;
        }
        let mut store = jar().lock().unwrap();
        store.retain(|(seen, _)| seen != name.trim());
        store.push((name.trim().to_string(), val.trim().to_string()));
        changed = true;
    }
    if changed {
        save_jar();
    }
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(UA)
        .timeout(std::time::Duration::from_secs(25))
        .build()
        .map_err(|error| format!("无法建立网络连接：{error}"))
}

fn referer() -> String {
    format!("{SITE}/")
}

fn text_of(value: &Value, pointer: &str) -> String {
    value
        .pointer(pointer)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

/// Search songs. The cloud search answers album covers the plain search does
/// not, and matches what the desktop client shows.
#[tauri::command]
pub async fn netease_search(query: String, limit: Option<u32>) -> Result<Value, String> {
    if query.trim().is_empty() {
        return Ok(json!({ "tracks": [] }));
    }
    let limit = limit.unwrap_or(24).clamp(1, 50).to_string();
    let response = client()?
        .post(format!("{SITE}/api/cloudsearch/pc"))
        .header("Referer", referer())
        .form(&[
            ("s", query.trim()),
            ("type", "1"),
            ("limit", limit.as_str()),
            ("offset", "0"),
        ])
        .send()
        .await
        .map_err(|error| format!("网易云连不上：{error}"))?;

    let status = response.status();
    let body: Value = response
        .json()
        .await
        .map_err(|error| format!("网易云返回了无效数据（{status}）：{error}"))?;
    if body.get("code").and_then(Value::as_i64) != Some(200) {
        return Err(format!(
            "网易云拒绝了这次搜索（{}）",
            body.get("code").map(Value::to_string).unwrap_or_default()
        ));
    }

    let songs = body
        .pointer("/result/songs")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let tracks: Vec<Value> = songs
        .iter()
        .filter_map(|song| {
            let id = song.get("id")?.as_i64()?;
            let artists = song
                .get("ar")
                .and_then(Value::as_array)
                .map(|list| {
                    list.iter()
                        .filter_map(|artist| artist.get("name").and_then(Value::as_str))
                        .collect::<Vec<_>>()
                        .join(" / ")
                })
                .unwrap_or_default();
            Some(json!({
                "id": id,
                "name": text_of(song, "/name"),
                "artist": artists,
                "album": text_of(song, "/al/name"),
                "cover": text_of(song, "/al/picUrl"),
                "duration": song.get("dt").and_then(Value::as_i64).unwrap_or(0),
            }))
        })
        .collect();

    Ok(json!({ "tracks": tracks }))
}

/// The signed entry point MyGo's NetEase plugin uses for the QR login: the
/// client profile is what keeps 8821 ("risky environment") away.
pub(crate) async fn eapi_login(path: &str, params: Value) -> Result<Value, String> {
    eapi(path, params, None).await
}

/// A cookie the jar has picked up, by name.
pub(crate) fn jar_cookie(name: &str) -> Option<String> {
    let store = jar().lock().unwrap();
    store
        .iter()
        .find(|(key, value)| key == name && !value.is_empty())
        .map(|(_, value)| value.clone())
}

/// The hot chart, the way the app opens on something that is actually
/// pressed and shipping this week.
#[tauri::command]
pub async fn netease_chart(limit: Option<u32>) -> Result<Value, String> {
    let limit = limit.unwrap_or(30).clamp(1, 100) as usize;
    let cache = CHART.get_or_init(|| Mutex::new(None));
    if let Some((at, body)) = cache.lock().unwrap().as_ref() {
        if at.elapsed() < std::time::Duration::from_secs(600) {
            return Ok(limit_tracks(body.clone(), limit));
        }
    }
    let response = client()?
        .get(format!("{SITE}/api/playlist/detail"))
        .query(&[("id", "3778678")])
        .header("Referer", referer())
        .send()
        .await
        .map_err(|error| format!("网易云连不上：{error}"))?;

    let body: Value = response
        .json()
        .await
        .map_err(|error| format!("网易云返回了无效数据：{error}"))?;
    if body.get("code").and_then(Value::as_i64) != Some(200) {
        return Err("网易云没有给出排行榜".into());
    }
    *cache.lock().unwrap() = Some((Instant::now(), body.clone()));

    let songs = body
        .pointer("/result/tracks")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let tracks: Vec<Value> = songs
        .iter()
        .take(limit)
        .filter_map(|song| {
            let id = song.get("id")?.as_i64()?;
            let artists = song
                .get("artists")
                .and_then(Value::as_array)
                .map(|list| {
                    list.iter()
                        .filter_map(|artist| artist.get("name").and_then(Value::as_str))
                        .collect::<Vec<_>>()
                        .join(" / ")
                })
                .unwrap_or_default();
            let album = song.get("album").cloned().unwrap_or(Value::Null);
            Some(json!({
                "id": id,
                "name": text_of(song, "/name"),
                "artist": artists,
                "album": text_of(&album, "/name"),
                "cover": text_of(&album, "/picUrl"),
                "duration": song.get("duration").and_then(Value::as_i64).unwrap_or(0),
            }))
        })
        .collect();

    Ok(json!({ "tracks": tracks }))
}

/// The chart answer is cached whole; each caller takes the slice it asked for.
fn limit_tracks(body: Value, limit: usize) -> Value {
    let mut tracks = body
        .pointer("/result/tracks")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    tracks.truncate(limit);
    json!({ "tracks": tracks })
}

/// The original lyric sheet and its translation, as timed LRC.
#[tauri::command]
pub async fn netease_lyric(id: String) -> Result<Value, String> {
    let response = client()?
        .get(format!("{SITE}/api/song/lyric"))
        .query(&[("id", id.as_str()), ("lv", "1"), ("kv", "1"), ("tv", "-1")])
        .header("Referer", referer())
        .send()
        .await
        .map_err(|error| format!("网易云连不上：{error}"))?;

    let body: Value = response
        .json()
        .await
        .map_err(|error| format!("网易云返回了无效歌词：{error}"))?;

    Ok(json!({
        "lrc": text_of(&body, "/lrc/lyric"),
        "translation": text_of(&body, "/tlyric/lyric"),
    }))
}

/// Asks the desktop endpoint for a playable URL and keeps one copy of the
/// audio in the app cache, so seeking is a local file read.
#[tauri::command]
pub async fn netease_stream(app: AppHandle, id: String, cookie: Option<String>) -> Result<Value, String> {
    let directory = cache_directory(&app)?;
    tokio::fs::create_dir_all(&directory)
        .await
        .map_err(|error| format!("无法建立缓存目录：{error}"))?;

    // A copy already on this machine plays without asking NetEase anything,
    // which also carries the app through the minutes its risk control refuses.
    if let Some((file, kind)) = cached(&directory, &id) {
        return Ok(json!({
            "path": file.to_string_lossy(),
            "kind": kind,
            "cached": true,
        }));
    }

    let (url, kind) = resolve_stream(&id, cookie.as_deref()).await?;
    let file = directory.join(format!("{id}.{kind}"));

    let bytes = client()?
        .get(&url)
        .header("Referer", referer())
        .send()
        .await
        .map_err(|error| format!("音频下载失败：{error}"))?
        .error_for_status()
        .map_err(|error| format!("音频下载失败：{error}"))?
        .bytes()
        .await
        .map_err(|error| format!("音频读取失败：{error}"))?;
    if bytes.len() < 32 * 1024 {
        return Err("网易云只返回了空音频".into());
    }
    // Write beside the target first: a half download must not look cached.
    let partial = file.with_extension(format!("{kind}.part"));
    tokio::fs::write(&partial, &bytes)
        .await
        .map_err(|error| format!("无法写入缓存：{error}"))?;
    tokio::fs::rename(&partial, &file)
        .await
        .map_err(|error| format!("无法完成缓存：{error}"))?;

    Ok(json!({
        "path": file.to_string_lossy(),
        "kind": kind,
        "bytes": std::fs::metadata(&file).map(|m| m.len()).unwrap_or(0),
    }))
}

/// A complete cached file for a song id, whatever container it came in.
fn cached(directory: &std::path::Path, id: &str) -> Option<(std::path::PathBuf, String)> {
    for kind in ["mp3", "flac", "ogg"] {
        let file = directory.join(format!("{id}.{kind}"));
        if std::fs::metadata(&file).map(|meta| meta.len() > 32 * 1024).unwrap_or(false) {
            return Some((file, kind.to_string()));
        }
    }
    None
}

/// The playable address and container for a song id. NetEase hands out
/// trial clips for some quality tiers and full files for others, and its risk
/// control can refuse a single tier for a moment, so each is tried in turn.
async fn resolve_stream(id: &str, cookie: Option<&str>) -> Result<(String, String), String> {
    let mut last = "网易云没有给出这首歌的播放地址".to_string();

    for level in ["exhigh", "higher", "standard"] {
        let answer = match eapi(
            "/api/song/enhance/player/url/v1",
            json!({
                "ids": format!("[{id}]"),
                "level": level,
                "encodeType": "mp3",
            }),
            cookie,
        )
        .await
        {
            Ok(answer) => answer,
            Err(error) => {
                last = error;
                continue;
            }
        };

        let item = answer
            .get("data")
            .and_then(Value::as_array)
            .and_then(|list| list.first())
            .cloned()
            .unwrap_or(Value::Null);

        let url = item.get("url").and_then(Value::as_str).unwrap_or_default();
        let trial = item.get("freeTrialInfo").map(Value::is_object).unwrap_or(false);
        if url.is_empty() || trial {
            last = "这首歌在网易云需要会员，或当前地区不可用".into();
            continue;
        }

        let kind = item
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or("mp3")
            .to_lowercase();
        return Ok((url.to_string(), kind));
    }

    Err(last)
}

fn cache_directory(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("无法定位缓存目录：{error}"))?;
    Ok(base.join("audio"))
}

/// One `eapi` call: the path and the JSON body are joined with a fixed
/// separator, hashed, AES-ECB encrypted and posted as `params`.
async fn eapi(path: &str, params: Value, cookie_in: Option<&str>) -> Result<Value, String> {
    eapi_with(path, params, cookie_in, &[200]).await
}

/// Login answers 800/801/802/803 as ordinary states, not failures.
pub(crate) async fn eapi_login_poll(path: &str, params: Value) -> Result<Value, String> {
    eapi_with(path, params, None, &[800, 801, 802, 803]).await
}

async fn eapi_with(
    path: &str,
    params: Value,
    cookie_in: Option<&str>,
    allowed: &[i64],
) -> Result<Value, String> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis();

    let device = device_id();

    let header = json!({
        "osver": "Microsoft-Windows-10-Professional-build-19045-64bit",
        "deviceId": device,
        "os": "pc",
        "appver": "3.1.17.204416",
        "versioncode": "140",
        "mobilename": "",
        "buildver": (now / 1000).to_string(),
        "resolution": "1920x1080",
        "channel": "netease",
        "requestId": format!("{now}_0001"),
        "__csrf": "",
    });

    let mut body = params;
    if let Value::Object(map) = &mut body {
        map.insert("header".into(), header.clone());
        map.insert("e_r".into(), Value::Bool(false));
    }
    let text = body.to_string();

    let digest = format!(
        "{:x}",
        Md5::digest(format!("nobody{path}use{text}md5forencrypt").as_bytes())
    );
    let plain = format!("{path}-36cd479b6b5-{text}-36cd479b6b5-{digest}");
    let cipher = Aes128::new_from_slice(EAPI_KEY.as_bytes()).map_err(|error| error.to_string())?;
    let encrypted = cipher.encrypt_padded_vec_mut::<Pkcs7>(plain.as_bytes());
    let params = hex::encode_upper(encrypted);

    let mut cookie = header
        .as_object()
        .map(|fields| {
            fields
                .iter()
                .map(|(key, value)| {
                    format!(
                        "{key}={}",
                        value.as_str().map(str::to_string).unwrap_or_else(|| value.to_string())
                    )
                })
                .collect::<Vec<_>>()
                .join("; ")
        })
        .unwrap_or_default();
    if let Some(signed) = cookie_in.as_deref().filter(|value| !value.trim().is_empty()) {
        cookie.push_str("; ");
        cookie.push_str(signed.trim());
    }

    let url = format!("{EAPI}{}", path.replacen("/api/", "/eapi/", 1));
    // -460 is NetEase's risk control, usually brief. The plugin retries once
    // with the same device and account, so we do too.
    for attempt in 0..3 {
        let mut jar = jar_header().unwrap_or_default();
        if !cookie.is_empty() {
            if !jar.is_empty() {
                jar.push_str("; ");
            }
            jar.push_str(&cookie);
        }
        let mut request = client()?
            .post(&url)
            .header("User-Agent", EAPI_UA)
            .header("Referer", referer())
            .header("Content-Type", "application/x-www-form-urlencoded");
        if !jar.is_empty() {
            request = request.header("Cookie", jar);
        }
        let response = request
            .body(format!("params={params}"))
            .send()
            .await
            .map_err(|error| format!("网易云连不上：{error}"))?;
        absorb(response.headers());
        let status = response.status();
        let answer: Value = response
            .json()
            .await
            .map_err(|error| format!("网易云返回了无效数据（{status}）：{error}"))?;

        let code = answer
            .get("code")
            .and_then(Value::as_i64)
            .unwrap_or(status.as_u16() as i64);
        if allowed.contains(&code) {
            return Ok(answer);
        }
        if code == -460 && attempt < 2 {
            // 1s → 4s → 12s, each with ±30% jitter so retries do not arrive
            // as a burst.
            let base = [1000u64, 4000, 12000][attempt];
            let spread = (base as f64 * 0.3) as u64;
            let seed = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|time| time.subsec_nanos() as u64)
                .unwrap_or(7);
            let wait = base.saturating_sub(spread) + seed % (spread * 2 + 1);
            tokio::time::sleep(std::time::Duration::from_millis(wait)).await;
            continue;
        }
        return Err(match code {
            -460 => "网易云暂时限制了请求，过一会儿再试".to_string(),
            301 | 302 | 401 => "网易云登录已失效，设置 → 账号里更新 Cookie".to_string(),
            _ => format!("网易云拒绝了播放请求（{code}）"),
        });
    }
    Err("网易云没有给出播放地址".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    // These reach the network; run with `cargo test -- --ignored`.
    #[tokio::test]
    #[ignore]
    async fn searches_and_reads_a_lyric() {
        let answer = netease_search("晴天 周杰伦".into(), Some(3)).await.unwrap();
        let tracks = answer["tracks"].as_array().unwrap();
        assert!(!tracks.is_empty());
        assert!(tracks[0]["name"].as_str().is_some());

        let id = tracks[0]["id"].to_string();
        let lyric = netease_lyric(id).await.unwrap();
        assert!(lyric["lrc"].as_str().unwrap().contains("[00:"));
    }

    #[tokio::test]
    #[ignore]
    async fn resolves_and_downloads_a_playable_file() {
        let (url, kind) = resolve_stream("2668397359", None).await.unwrap();
        assert!(url.starts_with("http"));
        assert!(kind == "mp3" || kind == "flac");
        let response = client().unwrap().get(&url).header("Referer", referer()).send().await.unwrap();
        assert!(response.status().is_success());
        let bytes = response.bytes().await.unwrap();
        assert!(bytes.len() > 1_000_000, "only got {} bytes", bytes.len());
        assert_eq!(&bytes[0..3], b"ID3");
    }
}

/// A stable install id, derived from this machine and user rather than a
/// random number each call, which NetEase's risk control finds suspicious.
fn device_id() -> String {
    let seed = format!(
        "needle:{}:{}",
        std::env::var("USER").unwrap_or_default(),
        std::env::var("HOME").unwrap_or_default()
    );
    let digest = format!("{:x}", Md5::digest(seed.as_bytes())).to_uppercase();
    digest.repeat(2).chars().take(52).collect()
}

/// The listener's own shelves: the playlists they made, the ones they saved,
/// and the liked songs, which NetEase keeps as a playlist of its own.
#[tauri::command]
pub async fn netease_library(cookie: String) -> Result<Value, String> {
    let http = client()?;
    let account: Value = http
        .get(format!("{SITE}/api/nuser/account/get"))
        .header("Referer", referer())
        .header("Cookie", &cookie)
        .send()
        .await
        .map_err(|error| format!("网易云连不上：{error}"))?
        .json()
        .await
        .map_err(|error| format!("网易云返回了无效数据：{error}"))?;

    let uid = account
        .pointer("/profile/userId")
        .map(|value| value.to_string().trim_matches('"').to_string())
        .unwrap_or_default();
    if uid.is_empty() {
        return Err("登录已失效，重新扫一次码".into());
    }

    let body: Value = http
        .get(format!("{SITE}/api/user/playlist"))
        .query(&[("uid", uid.as_str()), ("limit", "100"), ("offset", "0")])
        .header("Referer", referer())
        .header("Cookie", &cookie)
        .send()
        .await
        .map_err(|error| format!("网易云连不上：{error}"))?
        .json()
        .await
        .map_err(|error| format!("网易云返回了无效数据：{error}"))?;

    let playlists = body
        .get("playlist")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|item| {
            let id = item.get("id")?.as_i64()?;
            let creator = item
                .pointer("/creator/userId")
                .map(|value| value.to_string().trim_matches('"').to_string())
                .unwrap_or_default();
            let special = item.get("specialType").and_then(Value::as_i64).unwrap_or(0);
            Some(json!({
                "id": id,
                "name": item.get("name").and_then(Value::as_str).unwrap_or(""),
                "cover": item.get("coverImgUrl").and_then(Value::as_str).unwrap_or(""),
                "count": item.get("trackCount").and_then(Value::as_i64).unwrap_or(0),
                "mine": creator == uid,
                "liked": special == 5,
            }))
        })
        .collect::<Vec<_>>();

    Ok(json!({
        "user": {
            "id": uid,
            "name": account.pointer("/profile/nickname").and_then(Value::as_str).unwrap_or(""),
            "avatar": account.pointer("/profile/avatarUrl").and_then(Value::as_str).unwrap_or(""),
        },
        "playlists": playlists,
    }))
}

/// One shelf, as tracks the player can queue. The detail answer carries the
/// name; the songs come from track/all, because detail no longer lists them.
#[tauri::command]
pub async fn netease_playlist(cookie: String, id: String) -> Result<Value, String> {
    let http = client()?;
    let detail: Value = http
        .get(format!("{SITE}/api/playlist/detail"))
        .query(&[("id", id.as_str()), ("n", "1000")])
        .header("Referer", referer())
        .header("Cookie", &cookie)
        .send()
        .await
        .map_err(|error| format!("网易云连不上：{error}"))?
        .json()
        .await
        .map_err(|error| format!("网易云返回了无效数据：{error}"))?;

    let songs: Vec<Value> = match http
        .get(format!("{SITE}/api/playlist/track/all"))
        .query(&[("id", id.as_str()), ("limit", "1000"), ("offset", "0")])
        .header("Referer", referer())
        .header("Cookie", &cookie)
        .send()
        .await
    {
        Ok(response) => match response.json::<Value>().await {
            Ok(body) => body
                .get("songs")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default(),
            Err(_) => Vec::new(),
        },
        Err(_) => Vec::new(),
    };

    let songs = if songs.is_empty() {
        detail
            .pointer("/playlist/tracks")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
    } else {
        songs
    };

    let tracks = songs
        .iter()
        .filter_map(|song| {
            let id = song.get("id")?.as_i64()?;
            let artists = song
                .get("ar")
                .or_else(|| song.get("artists"))
                .and_then(Value::as_array)
                .map(|list| {
                    list.iter()
                        .filter_map(|artist| artist.get("name").and_then(Value::as_str))
                        .collect::<Vec<_>>()
                        .join(" / ")
                })
                .unwrap_or_default();
            let album = song.get("al").or_else(|| song.get("album")).cloned().unwrap_or(Value::Null);
            Some(json!({
                "id": id,
                "name": song.get("name").and_then(Value::as_str).unwrap_or(""),
                "artist": artists,
                "album": text_of(&album, "/name"),
                "cover": text_of(&album, "/picUrl"),
                "duration": song.get("dt").or_else(|| song.get("duration")).and_then(Value::as_i64).unwrap_or(0),
            }))
        })
        .collect::<Vec<_>>();

    Ok(json!({
        "name": detail.pointer("/playlist/name").and_then(Value::as_str).unwrap_or(""),
        "tracks": tracks,
    }))
}
