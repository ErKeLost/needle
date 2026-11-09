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

fn hash33(value: &str, init: u32) -> u32 {
    let mut hash = init;
    for ch in value.chars() {
        hash = hash.wrapping_add((hash << 5).wrapping_add(ch as u32));
    }
    hash & 0x7fff_ffff
}

fn guid() -> String {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    std::env::var("USER").unwrap_or_default().hash(&mut hasher);
    format!("{:016X}{:016X}", hasher.finish(), hasher.finish() ^ 0x9e37_79b9_7f4a_7c15)
}

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
            let media = song
                .pointer("/file/media_mid")
                .and_then(Value::as_str)
                .or_else(|| song.get("media_mid").and_then(Value::as_str))
                .unwrap_or(mid);
            Some(json!({
                "id": mid,
                "media": media,
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
pub async fn qq_stream(
    app: AppHandle,
    id: String,
    media: Option<String>,
    session: Option<String>,
) -> Result<Value, String> {
    let directory = cache_file(&app, &id, "m4a")?
        .parent()
        .map(|path| path.to_path_buf())
        .ok_or_else(|| "无法定位缓存目录".to_string())?;
    for kind in ["flac", "mp3", "m4a"] {
        let file = directory.join(format!("qq-{id}.{kind}"));
        if std::fs::metadata(&file).map(|meta| meta.len() > 16 * 1024).unwrap_or(false) {
            return Ok(json!({ "path": file.to_string_lossy(), "kind": kind, "cached": true }));
        }
    }

    let session: Value = serde_json::from_str(
        session.as_deref().filter(|value| !value.trim().is_empty()).ok_or_else(|| {
            "QQ 音乐要登录才给音频：点 QQ 音乐扫一次码".to_string()
        })?,
    )
    .map_err(|_| "QQ 登录信息读不出来，重新登录一次".to_string())?;

    let uin = session
        .get("musicid")
        .map(|value| value.to_string().trim_matches('"').to_string())
        .unwrap_or_default();
    let key = session
        .get("musickey")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let login_type = session
        .get("loginType")
        .and_then(Value::as_u64)
        .unwrap_or(2);
    if uin.is_empty() || key.is_empty() {
        return Err("QQ 音乐登录已失效，重新扫一次".into());
    }

    let uid = media.filter(|value| !value.is_empty()).unwrap_or_else(|| id.clone());
    let g_tk = hash33(&key, 5381);
    let mut last = "QQ 音乐没有给出播放地址".to_string();

    // The exact chain the MyGo plugin walks: lossless, 320, 128, m4a.
    for (prefix, ext, kind) in [
        ("F000", "flac", "flac"),
        ("M800", "mp3", "mp3"),
        ("M500", "mp3", "mp3"),
        ("C400", "m4a", "m4a"),
    ] {
        let filename = format!("{prefix}{uid}{uid}.{ext}");
        let payload = json!({
            "comm": {
                "cv": 4747474, "ct": 24, "format": "json",
                "inCharset": "utf-8", "outCharset": "utf-8", "notice": 0,
                "platform": "yqq.json", "needNewCode": 1, "uin": uin,
                "g_tk": g_tk, "g_tk_new_20200303": g_tk,
                "authst": key, "tmeLoginType": login_type,
            },
            "req_0": {
                "module": "music.vkey.GetVkey",
                "method": "UrlGetVkey",
                "param": {
                    "guid": guid(), "songmid": [id.clone()], "songtype": [0],
                    "uin": uin, "loginflag": 1, "platform": "20",
                    "filename": [filename],
                }
            }
        });

        let answer: Value = client()?
            .post(MUSICU)
            .header("Referer", YQQ)
            .header("Origin", "https://y.qq.com")
            .header("Content-Type", "application/json")
            .body(payload.to_string())
            .send()
            .await
            .map_err(|error| format!("QQ 音乐连不上：{error}"))?
            .json()
            .await
            .map_err(|error| format!("QQ 音乐返回了无效数据：{error}"))?;

        let info = answer
            .pointer("/req_0/data/midurlinfo/0")
            .cloned()
            .unwrap_or(Value::Null);
        let purl = text(&info, "purl");
        let result = info.get("result").and_then(Value::as_i64).unwrap_or(0);
        if purl.is_empty() || result != 0 {
            continue;
        }
        let sip = answer
            .pointer("/req_0/data/sip")
            .and_then(Value::as_array)
            .map(|list| {
                list.iter()
                    .filter_map(Value::as_str)
                    .find(|value| value.starts_with("https://"))
                    .or_else(|| list.first().and_then(Value::as_str))
                    .unwrap_or("https://aqqmusic.tc.qq.com/")
                    .to_string()
            })
            .unwrap_or_else(|| "https://aqqmusic.tc.qq.com/".into());
        let url = format!(
            "{}/{}",
            sip.trim_end_matches('/'),
            purl.trim_start_matches('/')
        );
        let file = cache_file(&app, &id, kind)?;
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
            last = "QQ 音乐只返回了空音频".into();
            continue;
        }
        let partial = file.with_extension(format!("{kind}.part"));
        tokio::fs::write(&partial, &bytes)
            .await
            .map_err(|error| format!("无法写入缓存：{error}"))?;
        tokio::fs::rename(&partial, &file)
            .await
            .map_err(|error| format!("无法完成缓存：{error}"))?;
        return Ok(json!({ "path": file.to_string_lossy(), "kind": kind }));
    }

    Err(last)
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
