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
    let body = crate::netease::eapi_login("/api/login/qrcode/unikey", json!({ "type": 3 })).await?;
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
    let body = crate::netease::eapi_login_poll(
        "/api/login/qrcode/client/login",
        json!({ "key": key, "type": 3 }),
    )
    .await?;

    let code = body.get("code").and_then(Value::as_i64).unwrap_or(-1);
    let cookie = if code == 803 {
        crate::netease::jar_cookie("MUSIC_U")
            .map(|value| format!("MUSIC_U={value}"))
            .or_else(|| {
                body.get("cookie")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .unwrap_or_default()
    } else {
        String::new()
    };

    if let Ok(dir) = tauri::Manager::path(&app).app_config_dir() {
        use std::io::Write;
        let _ = std::fs::create_dir_all(&dir);
        if let Ok(mut file) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(dir.join("netease-login.log"))
        {
            let _ = writeln!(file, "eapi code={code} cookie={} body={}", cookie.len(), body);
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
pub async fn netease_profile(app: tauri::AppHandle, cookie: String) -> Result<Value, String> {
    let body: Value = client()?
        .get(format!("{SITE}/api/nuser/account/get"))
        .header("Referer", format!("{SITE}/"))
        .header("Cookie", cookie)
        .send()
        .await
        .map_err(|error| format!("网易云连不上：{error}"))?
        .json()
        .await
        .map_err(|error| format!("网易云返回了无效数据：{error}"))?;

    if let Ok(dir) = tauri::Manager::path(&app).app_config_dir() {
        use std::io::Write;
        let _ = std::fs::create_dir_all(&dir);
        if let Ok(mut file) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(dir.join("netease-profile.log"))
        {
            let _ = writeln!(file, "profile body={body}");
        }
    }

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
