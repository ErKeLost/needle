//! NetEase Cloud Music, without a helper server.
//!
//! Search and lyrics sit on the public web API. Playback needs the encrypted
//! `eapi` the desktop client uses: an AES-128-ECB payload whose digest covers
//! the requested path and JSON body. We ask for a URL, then fetch the audio
//! once into the app cache, because a WebView cannot send the Referer and
//! User-Agent the CDN expects.

use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

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

/// The hot chart, the way the app opens on something that is actually
/// pressed and shipping this week.
#[tauri::command]
pub async fn netease_chart(limit: Option<u32>) -> Result<Value, String> {
    let limit = limit.unwrap_or(30).clamp(1, 100) as usize;
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
    for attempt in 0..2 {
        let response = client()?
            .post(&url)
            .header("User-Agent", EAPI_UA)
            .header("Referer", referer())
            .header("Content-Type", "application/x-www-form-urlencoded")
            .header("Cookie", &cookie)
            .body(format!("params={params}"))
            .send()
            .await
            .map_err(|error| format!("网易云连不上：{error}"))?;

        let status = response.status();
        let answer: Value = response
            .json()
            .await
            .map_err(|error| format!("网易云返回了无效数据（{status}）：{error}"))?;

        let code = answer
            .get("code")
            .and_then(Value::as_i64)
            .unwrap_or(status.as_u16() as i64);
        if code == 200 {
            return Ok(answer);
        }
        if code == -460 && attempt == 0 {
            tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
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
