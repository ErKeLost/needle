//! NetEase sign-in by QR, the same three calls the official web login makes:
//! unikey, then poll client/login until 803, which answers with MUSIC_U.

use serde_json::{json, Value};

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
    let body: Value = client()?
        .get(format!("{SITE}/api/login/qrcode/unikey?type=3"))
        .header("Referer", format!("{SITE}/"))
        .send()
        .await
        .map_err(|error| format!("网易云连不上：{error}"))?
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
pub async fn netease_qr_poll(key: String) -> Result<Value, String> {
    let response = client()?
        .get(format!("{SITE}/api/login/qrcode/client/login"))
        .query(&[("key", key.as_str()), ("type", "3")])
        .header("Referer", format!("{SITE}/"))
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
    Ok(json!({ "code": code, "cookie": cookie, "message": body.get("message").cloned().unwrap_or(Value::Null) }))
}
