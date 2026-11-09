//! QQ Music, anonymously: the public search and lyric endpoints and the
//! `vkey` handshake that turns a song mid into a playable file. Songs that
//! need a subscription come back without a URL, and are reported as such
//! rather than played as a preview of something else.

use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

const UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const YQQ: &str = "https://y.qq.com/";
const SEARCH: &str = "https://c.y.qq.com/soso/fcgi-bin/client_search_cp";
const LYRIC: &str = "https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg";
const MUSICU: &str = "https://u.y.qq.com/cgi-bin/musicu.fcg";

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(UA)
        .timeout(std::time::Duration::from_secs(25))
        .build()
        .map_err(|error| format!("无法建立网络连接：{error}"))
}

fn text(value: &Value, key: &str) -> String {
    value.get(key).and_then(Value::as_str).unwrap_or_default().to_string()
}

fn mid_of(id: &str) -> String {
    id.trim_start_matches("qq-").to_string()
}

#[tauri::command]
pub async fn qq_search(query: String, limit: Option<u32>) -> Result<Value, String> {
    if query.trim().is_empty() {
        return Ok(json!({ "tracks": [] }));
    }
    let limit = limit.unwrap_or(24).clamp(1, 50).to_string();
    let response = client()?
        .get(SEARCH)
        .query(&[
            ("format", "json"),
            ("p", "1"),
            ("n", limit.as_str()),
            ("w", query.trim()),
        ])
        .header("Referer", YQQ)
        .send()
        .await
        .map_err(|error| format!("QQ 音乐连不上：{error}"))?;

    let body: Value = response
        .json()
        .await
        .map_err(|error| format!("QQ 音乐返回了无效数据：{error}"))?;

    let songs = body
        .pointer("/data/song/list")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let tracks: Vec<Value> = songs
        .iter()
        .filter_map(|song| {
            let mid = song.get("songmid")?.as_str()?;
            let album_mid = text(song, "albummid");
            let singer = song
                .get("singer")
                .and_then(Value::as_array)
                .map(|list| {
                    list.iter()
                        .filter_map(|artist| artist.get("name").and_then(Value::as_str))
                        .collect::<Vec<_>>()
                        .join(" / ")
                })
                .unwrap_or_default();
            Some(json!({
                "id": mid,
                "name": text(song, "songname"),
                "artist": singer,
                "album": text(song, "albumname"),
                "cover": if album_mid.is_empty() {
                    String::new()
                } else {
                    format!("https://y.gtimg.cn/music/photo_new/T002R300x300M000{album_mid}.jpg")
                },
                "duration": song.get("interval").and_then(Value::as_i64).unwrap_or(0) * 1000,
                "pay": song.pointer("/pay/payplay").and_then(Value::as_i64).unwrap_or(0),
            }))
        })
        .collect();

    Ok(json!({ "tracks": tracks }))
}

#[tauri::command]
pub async fn qq_lyric(id: String) -> Result<Value, String> {
    let mid = mid_of(&id);
    let response = client()?
        .get(LYRIC)
        .query(&[("songmid", mid.as_str()), ("format", "json"), ("nobase64", "1")])
        .header("Referer", YQQ)
        .send()
        .await
        .map_err(|error| format!("QQ 音乐连不上：{error}"))?;

    let body: Value = response
        .json()
        .await
        .map_err(|error| format!("QQ 音乐返回了无效歌词：{error}"))?;

    Ok(json!({
        "lrc": text(&body, "lyric"),
        "translation": text(&body, "trans"),
    }))
}

#[tauri::command]
pub async fn qq_stream(app: AppHandle, id: String) -> Result<Value, String> {
    let (url, kind) = resolve_stream(&mid_of(&id)).await?;
    let file = cache_file(&app, &mid_of(&id), &kind)?;

    if !file.exists() {
        let bytes = client()?
            .get(&url)
            .header("Referer", YQQ)
            .send()
            .await
            .map_err(|error| format!("音频下载失败：{error}"))?
            .error_for_status()
            .map_err(|error| format!("音频下载失败：{error}"))?
            .bytes()
            .await
            .map_err(|error| format!("音频读取失败：{error}"))?;
        if bytes.len() < 16 * 1024 {
            return Err("QQ 音乐只返回了空音频".into());
        }
        let partial = file.with_extension(format!("{kind}.part"));
        tokio::fs::write(&partial, &bytes)
            .await
            .map_err(|error| format!("无法写入缓存：{error}"))?;
        tokio::fs::rename(&partial, &file)
            .await
            .map_err(|error| format!("无法完成缓存：{error}"))?;
    }

    Ok(json!({ "path": file.to_string_lossy(), "kind": kind }))
}

/// The playable address and container for a song mid.
async fn resolve_stream(mid: &str) -> Result<(String, String), String> {
    let guid = format!(
        "{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|time| time.as_millis() % 10_000_000_000)
            .unwrap_or(1)
    );
    let payload = json!({
        "req_0": {
            "module": "vkey.GetVkeyServer",
            "method": "CgiGetVkey",
            "param": {
                "guid": guid,
                "songmid": [mid],
                "songtype": [0],
                "uin": "0",
                "loginflag": 1,
                "platform": "20"
            }
        }
    });

    let response = client()?
        .get(MUSICU)
        .query(&[("format", "json"), ("data", payload.to_string().as_str())])
        .header("Referer", YQQ)
        .send()
        .await
        .map_err(|error| format!("QQ 音乐连不上：{error}"))?;

    let body: Value = response
        .json()
        .await
        .map_err(|error| format!("QQ 音乐返回了无效数据：{error}"))?;

    let info = body
        .pointer("/req_0/data/midurlinfo/0")
        .cloned()
        .unwrap_or(Value::Null);
    let purl = text(&info, "purl");
    if purl.is_empty() {
        return Err("这首歌在 QQ 音乐需要会员，暂时放不了".into());
    }
    let sip = body
        .pointer("/req_0/data/sip/0")
        .and_then(Value::as_str)
        .unwrap_or("https://dl.stream.qqmusic.qq.com/");

    let url = format!("{sip}{purl}");
    let kind = if purl.contains(".flac") { "flac" } else { "m4a" }.to_string();
    Ok((url, kind))
}

fn cache_file(app: &AppHandle, mid: &str, kind: &str) -> Result<std::path::PathBuf, String> {
    let base = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("无法定位缓存目录：{error}"))?;
    let directory = base.join("audio");
    std::fs::create_dir_all(&directory).map_err(|error| format!("无法建立缓存目录：{error}"))?;
    Ok(directory.join(format!("qq-{mid}.{kind}")))
}
