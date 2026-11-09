//! 汽水音乐 (Soda Music). Search is a plain GET; a track needs the signed
//! `X-Helios` / `X-Medusa` headers, which come from ByteDance's `bdms.node`
//! driven by a small signer binary kept beside it (see docs/qishui.md).

use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

const API: &str = "https://api.qishui.com";
const UA_MOBILE: &str = "com.luna.music/100198030 (Linux; U; Android 15; zh_CN; ABR-AL80; Build/V417IR;tt-ok/3.12.13.19)";
const UA_PC: &str = "LunaPC/3.7.0(452316191)";

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(25))
        .build()
        .map_err(|error| format!("无法建立网络连接：{error}"))
}

/// A stable 16 digit install id, the shape the signer insists on.
fn device_id() -> String {
    use md5::{Digest, Md5};
    let seed = format!(
        "needle-qishui:{}:{}",
        std::env::var("USER").unwrap_or_default(),
        std::env::var("HOME").unwrap_or_default()
    );
    let digest = format!("{:x}", Md5::digest(seed.as_bytes()));
    digest
        .chars()
        .filter(|c| c.is_ascii_hexdigit())
        .map(|c| (c.to_digit(16).unwrap_or(0) % 10).to_string())
        .take(16)
        .collect()
}

fn catalog(did: &str) -> Vec<(String, String)> {
    [
        ("aid", "386088"),
        ("app_name", "luna_pc"),
        ("region", "cn"),
        ("geo_region", "cn"),
        ("os_region", "cn"),
        ("sim_region", ""),
        ("device_id", did),
        ("cdid", ""),
        ("iid", did),
        ("version_name", "3.7.0"),
        ("version_code", "30070000"),
        ("channel", "official"),
        ("build_mode", "master"),
        ("network_carrier", ""),
        ("ac", "wifi"),
        ("tz_name", "Asia/Shanghai"),
        ("resolution", ""),
        ("device_platform", "mac"),
        ("device_type", "Mac"),
        ("os_version", "darwin"),
        ("fp", did),
    ]
    .iter()
    .map(|(key, value)| (key.to_string(), value.to_string()))
    .collect()
}

fn signer_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(dir) = app.path().resource_dir() {
        candidates.push(dir.join("resources").join("qishui"));
        candidates.push(dir.join("qishui"));
    }
    candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources").join("qishui"));

    for dir in candidates {
        if dir.join("qishui-signer").exists() {
            return Ok(dir);
        }
    }
    Err("找不到汽水签名组件（resources/qishui）".into())
}

fn field(bytes: &mut Vec<u8>, text: &str) {
    bytes.extend_from_slice(&(text.len() as u32).to_be_bytes());
    bytes.extend_from_slice(text.as_bytes());
}

/// Runs the signer and returns its header pairs.
fn sign(app: &AppHandle, url: &str, headers: &str) -> Result<Vec<(String, String)>, String> {
    let dir = signer_dir(app)?;
    sign_at(&dir, url, headers)
}

fn sign_at(dir: &std::path::Path, url: &str, headers: &str) -> Result<Vec<(String, String)>, String> {
    let mut input = Vec::with_capacity(url.len() + headers.len() + 64);
    field(&mut input, &device_id());
    field(&mut input, url);
    field(&mut input, headers);

    let mut child = Command::new(dir.join("qishui-signer"))
        .current_dir(dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("签名组件启动失败：{error}"))?;
    child
        .stdin
        .as_mut()
        .ok_or("签名组件没有输入")?
        .write_all(&input)
        .map_err(|error| format!("签名输入失败：{error}"))?;

    let output = child
        .wait_with_output()
        .map_err(|error| format!("签名失败：{error}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    let text = String::from_utf8_lossy(&output.stdout).to_string();
    let mut parts = text.split("\r\n");
    let mut pairs = Vec::new();
    while let (Some(name), Some(value)) = (parts.next(), parts.next()) {
        if name.is_empty() {
            break;
        }
        pairs.push((name.to_string(), value.to_string()));
    }
    Ok(pairs)
}

fn signed_url(path: &str, extra: &[(&str, String)], did: &str) -> String {
    let mut params = catalog(did);
    params.extend(extra.iter().map(|(k, v)| (k.to_string(), v.clone())));
    params.sort_by(|a, b| a.0.cmp(&b.0));
    let query = params
        .iter()
        .map(|(k, v)| format!("{}={}", urlencode(k), urlencode(v)))
        .collect::<Vec<_>>()
        .join("&");
    format!("{API}{path}?{query}")
}

fn urlencode(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for byte in text.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char)
            }
            b' ' => out.push_str("%20"),
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

/// The chart-free way in: search by words.
#[tauri::command]
pub async fn qishui_search(query: String, limit: Option<u32>) -> Result<Value, String> {
    if query.trim().is_empty() {
        return Ok(json!({ "tracks": [] }));
    }
    let did = device_id();
    let mut params = catalog(&did);
    params.push(("q".into(), query.trim().to_string()));
    params.push(("cursor".into(), "0".into()));
    params.push(("count".into(), limit.unwrap_or(20).clamp(1, 30).to_string()));
    params.sort_by(|a, b| a.0.cmp(&b.0));
    let url = format!(
        "{API}/luna/search/track?{}",
        params
            .iter()
            .map(|(k, v)| format!("{}={}", urlencode(k), urlencode(v)))
            .collect::<Vec<_>>()
            .join("&")
    );

    let body: Value = client()?
        .get(&url)
        .header("User-Agent", UA_MOBILE)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|error| format!("汽水连不上：{error}"))?
        .json()
        .await
        .map_err(|error| format!("汽水返回了无效数据：{error}"))?;

    let groups = body
        .get("result_groups")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut tracks = Vec::new();
    for group in groups {
        for row in group.get("data").and_then(Value::as_array).cloned().unwrap_or_default() {
            let Some(track) = row.pointer("/entity/track") else { continue };
            let Some(id) = track.get("id").and_then(Value::as_str) else { continue };
            let artists = track
                .get("artists")
                .and_then(Value::as_array)
                .map(|list| {
                    list.iter()
                        .filter_map(|artist| artist.get("name").and_then(Value::as_str))
                        .collect::<Vec<_>>()
                        .join(" / ")
                })
                .unwrap_or_default();
            tracks.push(json!({
                "id": id,
                "name": track.get("name").and_then(Value::as_str).unwrap_or(""),
                "artist": artists,
                "album": track.pointer("/album/name").and_then(Value::as_str).unwrap_or(""),
                "cover": cover(track),
                "duration": track.get("duration").and_then(Value::as_i64).unwrap_or(0),
            }));
        }
    }
    Ok(json!({ "tracks": tracks }))
}

fn cover(track: &Value) -> String {
    let Some(cover) = track.pointer("/album/url_cover") else {
        return String::new();
    };
    let base = cover
        .get("urls")
        .and_then(Value::as_array)
        .and_then(|urls| urls.first())
        .and_then(Value::as_str)
        .unwrap_or("");
    let uri = cover.get("uri").and_then(Value::as_str).unwrap_or("");
    let prefix = cover
        .get("template_prefix")
        .and_then(Value::as_str)
        .unwrap_or("tplv-b829550vbb");
    if base.is_empty() || uri.is_empty() {
        return String::new();
    }
    format!("{base}{uri}~{prefix}-300:300.jpeg")
}

/// One track, with the signed play address and the timed lyric sheet.
#[tauri::command]
pub async fn qishui_track(app: AppHandle, id: String, cookie: Option<String>) -> Result<Value, String> {
    let did = device_id();
    let url = signed_url(
        "/luna/pc/track_v2",
        &[("track_id", id.clone())],
        &did,
    );
    let headers = format!("accept\r\napplication/json\r\nuser-agent\r\n{UA_PC}");
    let sign_url = url.clone();
    let pairs = tauri::async_runtime::spawn_blocking(move || sign(&app, &sign_url, &headers))
        .await
        .map_err(|error| format!("签名线程失败：{error}"))??;

    let mut request = client()?.get(&url).header("Accept", "application/json");
    for (name, value) in pairs {
        request = request.header(&name, value);
    }
    if let Some(cookie) = cookie.as_deref().filter(|value| !value.trim().is_empty()) {
        request = request.header("Cookie", cookie.trim());
    }
    let body: Value = request
        .send()
        .await
        .map_err(|error| format!("汽水连不上：{error}"))?
        .json()
        .await
        .map_err(|error| format!("汽水返回了无效数据：{error}"))?;

    let model = body
        .pointer("/track_player/video_model")
        .and_then(Value::as_str)
        .and_then(|text| serde_json::from_str::<Value>(text).ok())
        .unwrap_or(Value::Null);

    Ok(json!({
        "url": model.pointer("/video_list/0/main_url").and_then(Value::as_str).unwrap_or(""),
        "backup": model.pointer("/video_list/0/backup_url").and_then(Value::as_str).unwrap_or(""),
        "lyric": body.pointer("/lyric/content").and_then(Value::as_str).unwrap_or(""),
        "duration": model.get("video_duration").and_then(Value::as_f64).unwrap_or(0.0),
        "name": body.pointer("/track/name").and_then(Value::as_str).unwrap_or(""),
    }))
}

#[tauri::command]
pub async fn qishui_stream(app: AppHandle, id: String, cookie: Option<String>) -> Result<Value, String> {
    let directory = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("无法定位缓存目录：{error}"))?
        .join("audio");
    tokio::fs::create_dir_all(&directory)
        .await
        .map_err(|error| format!("无法建立缓存目录：{error}"))?;
    let file = directory.join(format!("qishui-{id}.mp4"));

    if !file.exists() {
        let answer = qishui_track(app.clone(), id.clone(), cookie).await?;
        let url = answer.get("url").and_then(Value::as_str).unwrap_or("");
        if url.is_empty() {
            return Err("这首歌在汽水需要会员或已下架".into());
        }
        let bytes = match client()?
            .get(url)
            .header("User-Agent", UA_PC)
            .send()
            .await
            .and_then(|response| response.error_for_status())
        {
            Ok(response) => response
                .bytes()
                .await
                .map_err(|error| format!("音频读取失败：{error}"))?,
            Err(first) => {
                // The VOD host hands out a backup address in the same payload.
                let backup = answer.get("backup").and_then(Value::as_str).unwrap_or("");
                if backup.is_empty() {
                    return Err(format!("音频下载失败：{first}"));
                }
                client()?
                    .get(backup)
                    .header("User-Agent", UA_PC)
                    .send()
                    .await
                    .map_err(|error| format!("音频下载失败：{error}"))?
                    .error_for_status()
                    .map_err(|error| format!("音频下载失败：{error}"))?
                    .bytes()
                    .await
                    .map_err(|error| format!("音频读取失败：{error}"))?
            }
        };
        if bytes.len() < 16 * 1024 {
            return Err("汽水只返回了空音频".into());
        }
        let partial = file.with_extension("mp4.part");
        tokio::fs::write(&partial, &bytes)
            .await
            .map_err(|error| format!("无法写入缓存：{error}"))?;
        tokio::fs::rename(&partial, &file)
            .await
            .map_err(|error| format!("无法完成缓存：{error}"))?;
    }

    Ok(json!({ "path": file.to_string_lossy(), "kind": "mp4" }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signs_a_track_url() {
        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources").join("qishui");
        let did = device_id();
        let url = signed_url("/luna/pc/track_v2", &[("track_id", "7676337516358617115".into())], &did);
        let pairs = sign_at(&dir, &url, &format!("accept\r\napplication/json\r\nuser-agent\r\n{UA_PC}")).unwrap();
        assert!(pairs.iter().any(|(name, _)| name.eq_ignore_ascii_case("x-helios")));
        assert!(pairs.iter().any(|(name, _)| name.eq_ignore_ascii_case("x-medusa")));
    }
}
