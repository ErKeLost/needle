//! NetEase sign-in by QR, the same three calls the official web login makes:
//! unikey, then poll client/login until 803, which answers with MUSIC_U.

use std::sync::Mutex;

use serde_json::{json, Value};

/// NMTID and friends from the unikey call; the poll belongs to that session.
static JAR: Mutex<Option<String>> = Mutex::new(None);

const SITE: &str = "https://music.163.com";
const UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(UA)
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn netease_qr_create() -> Result<Value, String> {
    let response = client()?
        .get(format!("{SITE}/api/login/qrcode/unikey?type=3"))
        .header("Referer", format!("{SITE}/"))
        .send()
        .await
        .map_err(|error| format!("网易云连不上：{error}"))?;

    let mut jar = Vec::new();
    for value in response.headers().get_all(reqwest::header::SET_COOKIE) {
        let Ok(text) = value.to_str() else { continue };
        if let Some((name, rest)) = text.split_once('=') {
            jar.push(format!("{name}={}", rest.split(';').next().unwrap_or("")));
        }
    }
    *JAR.lock().unwrap() = Some(jar.join("; "));

    let body: Value = response
        .json()
        .await
        .map_err(|error| format!("网易云返回了无效数据：{error}"))?;

    let key = body.get("unikey").and_then(Value::as_str).unwrap_or("");
    if key.is_empty() {
        return Err("网易云没有给出二维码".into());
    }
    Ok(json!({
        "key": key,
        "url": format!("https://music.163.com/login?codekey={key}"),
    }))
}

/// 800 expired, 801 waiting, 802 scanned, 803 signed in.
#[tauri::command]
pub async fn netease_qr_poll(app: tauri::AppHandle, key: String) -> Result<Value, String> {
    let mut request = client()?
        .get(format!("{SITE}/api/login/qrcode/client/login"))
        .query(&[("key", key.as_str()), ("type", "3")])
        .header("Referer", format!("{SITE}/"));
    if let Some(jar) = JAR.lock().unwrap().as_deref().filter(|value| !value.is_empty()) {
        request = request.header("Cookie", jar);
    }
    let response = request
        .send()
        .await
        .map_err(|error| format!("网易云连不上：{error}"))?;

    let mut cookie = String::new();
    for value in response.headers().get_all(reqwest::header::SET_COOKIE) {
        let Ok(text) = value.to_str() else { continue };
        if let Some(rest) = text.strip_prefix("MUSIC_U=") {
            cookie = format!("MUSIC_U={}", rest.split(';').next().unwrap_or(""));
        }
    }

    let body: Value = response
        .json()
        .await
        .map_err(|error| format!("网易云返回了无效数据：{error}"))?;
    let code = body.get("code").and_then(Value::as_i64).unwrap_or(-1);

    // 803 answers with the session in `cookie`, and only sometimes in
    // Set-Cookie; both are the same MUSIC_U header.
    if code == 803 {
        if let Some(text) = body.get("cookie").and_then(Value::as_str) {
            if text.starts_with("MUSIC_U=") {
                cookie = text.to_string();
            } else if text.contains("MUSIC_U=") {
                cookie = text
                    .split(';')
                    .map(str::trim)
                    .find(|part| part.starts_with("MUSIC_U="))
                    .unwrap_or("")
                    .to_string();
            }
        }
    }
    if let Ok(dir) = tauri::Manager::path(&app).app_config_dir() {
        use std::io::Write;
        let _ = std::fs::create_dir_all(&dir);
        if let Ok(mut file) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(dir.join("netease-login.log"))
        {
            let _ = writeln!(file, "code={code} cookie={} body={}", cookie.len(), body);
        }
    }
    Ok(json!({ "code": code, "cookie": cookie, "message": body.get("message").cloned().unwrap_or(Value::Null) }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore]
    async fn creates_a_qr() {
        let answer = netease_qr_create().await.unwrap();
        assert!(answer["key"].as_str().unwrap().len() > 10);
        assert!(answer["url"].as_str().unwrap().contains("codekey="));
    }
}

/// Who the cookie belongs to, for the corner of the player.
#[tauri::command]
pub async fn netease_profile(cookie: String) -> Result<Value, String> {
    let body: Value = client()?
        .get(format!("{SITE}/api/user/account"))
        .header("Referer", format!("{SITE}/"))
        .header("Cookie", cookie)
        .send()
        .await
        .map_err(|error| format!("网易云连不上：{error}"))?
        .json()
        .await
        .map_err(|error| format!("网易云返回了无效数据：{error}"))?;

    let profile = body.get("profile").cloned().unwrap_or(Value::Null);
    let name = profile.get("nickname").and_then(Value::as_str).unwrap_or("");
    if name.is_empty() {
        return Err("网易云没有返回账号信息".into());
    }
    Ok(json!({
        "name": name,
        "avatar": profile.get("avatarUrl").and_then(Value::as_str).unwrap_or(""),
        "id": profile.get("userId").cloned().unwrap_or(Value::Null),
    }))
}
