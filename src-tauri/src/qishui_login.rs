//! 汽水音乐 sign-in: ByteDance passport, the same two calls the desktop app
//! makes (get_qrcode → check_qrconnect). The session is whatever cookies the
//! passport answers leave behind.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};
use tauri::Manager;

const API: &str = "https://api.qishui.com";
const UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

#[derive(Clone)]
struct Identity {
    device: String,
    install: String,
    portrait: String,
    ms_token: String,
}

static TOKEN: Mutex<Option<String>> = Mutex::new(None);
static IDENTITY: Mutex<Option<Identity>> = Mutex::new(None);
static JAR: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);

fn seed() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|time| time.as_nanos() as u64)
        .unwrap_or(0x9e3779b97f4a7c15)
}

fn bytes(count: usize) -> Vec<u8> {
    let mut state = seed();
    (0..count)
        .map(|_| {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            (state >> 24) as u8
        })
        .collect()
}

fn digits(count: usize, from: &[u8]) -> String {
    (0..count)
        .map(|i| {
            let value = from[i % from.len()];
            if i == 0 {
                ((1 + value % 9) as u8 + b'0') as char
            } else {
                ((value % 10) + b'0') as char
            }
        })
        .collect()
}

fn base64url(input: &[u8]) -> String {
    const TABLE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::new();
    let mut bits = 0u32;
    let mut value = 0u32;
    for byte in input {
        value = (value << 8) | *byte as u32;
        bits += 8;
        while bits >= 6 {
            bits -= 6;
            out.push(TABLE[((value >> bits) & 63) as usize] as char);
        }
    }
    if bits > 0 {
        out.push(TABLE[((value << (6 - bits)) & 63) as usize] as char);
    }
    out
}

/// The passport ties the QR to one device identity; every poll has to use the
/// same one, or the phone's confirmation is never seen.
fn current_identity() -> Identity {
    let mut slot = IDENTITY.lock().unwrap();
    slot.get_or_insert_with(identity).clone()
}

fn identity() -> Identity {
    let raw = bytes(16);
    let hex: String = raw.iter().map(|byte| format!("{byte:02x}")).collect();
    Identity {
        device: digits(16, &raw),
        install: digits(15, &bytes(15)),
        portrait: format!(
            "{}-{}-{}-{}-{}.login",
            &hex[0..8],
            &hex[8..12],
            &hex[12..16],
            &hex[16..20],
            &hex[20..32]
        ),
        ms_token: format!("{}==", base64url(&bytes(88))),
    }
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(UA)
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|error| error.to_string())
}

fn passport_query(id: &Identity, extra: &[(&str, String)]) -> String {
    let mut params: Vec<(String, String)> = [
        ("aid", "386088".to_string()),
        ("passport_jssdk_version", "2.4.13".to_string()),
        ("passport_jssdk_type", "normal".to_string()),
        ("is_from_ttaccountsdk", "1".to_string()),
        ("language", "zh".to_string()),
        ("account_sdk_source", "web".to_string()),
        ("p_js_v", "2.4.13".to_string()),
        ("p_js_t", "pro".to_string()),
        ("p_zt", "3.3.5".to_string()),
        ("p_ver", "1.0.29".to_string()),
        ("request_host", "app%3A%2F%2Fresources".to_string()),
        ("p_bd", "1.0.0.41".to_string()),
        ("is_new_login", "1".to_string()),
        ("is_from_iesaccountsaas", "1".to_string()),
        ("device_platform", "PC".to_string()),
        ("version_code", "3.5.2".to_string()),
        ("account_sdk_source_info", "00".to_string()),
        ("biz_trace_id", format!("{:x}", seed())),
        ("device_id", id.device.clone()),
        ("did", id.device.clone()),
        ("install_id", id.install.clone()),
        ("iid", id.install.clone()),
        ("msToken", id.ms_token.clone()),
    ]
    .iter()
    .map(|(key, value)| (key.to_string(), value.clone()))
    .collect();
    params.extend(extra.iter().map(|(key, value)| (key.to_string(), value.clone())));
    params.sort_by(|a, b| a.0.cmp(&b.0));
    params
        .iter()
        .map(|(key, value)| format!("{key}={}", urlencode(value)))
        .collect::<Vec<_>>()
        .join("&")
}

fn urlencode(text: &str) -> String {
    let mut out = String::new();
    for byte in text.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(byte as char),
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

fn absorb(response: &reqwest::Response) {
    let mut jar = JAR.lock().unwrap();
    let jar = jar.get_or_insert_with(HashMap::new);
    for value in response.headers().get_all(reqwest::header::SET_COOKIE) {
        let Ok(text) = value.to_str() else { continue };
        let pair = text.split(';').next().unwrap_or("");
        let Some((name, val)) = pair.split_once('=') else { continue };
        if name.trim().is_empty() || val.trim().is_empty() {
            continue;
        }
        jar.insert(name.trim().to_string(), val.trim().to_string());
    }
}

fn cookie_header() -> String {
    let jar = JAR.lock().unwrap();
    jar.as_ref()
        .map(|cookies| {
            cookies
                .iter()
                .map(|(name, value)| format!("{name}={value}"))
                .collect::<Vec<_>>()
                .join("; ")
        })
        .unwrap_or_default()
}

#[tauri::command]
pub async fn qishui_qr_create() -> Result<Value, String> {
    let id = identity();
    *IDENTITY.lock().unwrap() = Some(id.clone());
    *JAR.lock().unwrap() = Some(HashMap::new());
    let query = passport_query(
        &id,
        &[
            ("next", API.to_string()),
            ("need_logo", "false".to_string()),
            ("need_short_url", "false".to_string()),
            ("is_new_login", "1".to_string()),
        ],
    );
    let response = client()?
        .get(format!("{API}/passport/web/get_qrcode/?{query}"))
        .header("Accept", "application/json, text/javascript")
        .header("x-tt-passport-verify-portrait", &id.portrait)
        .header("x-tt-passport-trace-id", format!("{:x}", seed()))
        .send()
        .await
        .map_err(|error| format!("汽水连不上：{error}"))?;
    absorb(&response);
    let body: Value = response
        .json()
        .await
        .map_err(|error| format!("汽水返回了无效数据：{error}"))?;
    let data = body.get("data").cloned().unwrap_or(Value::Null);
    let token = data.get("token").and_then(Value::as_str).unwrap_or("");
    let url = data.get("qrcode_index_url").and_then(Value::as_str).unwrap_or("");
    if token.is_empty() || url.is_empty() {
        return Err("汽水没有给出二维码".into());
    }
    *TOKEN.lock().unwrap() = Some(token.to_string());
    Ok(json!({ "qrcode": url }))
}

/// status: new / scanned / confirmed (or the numeric 1 / 2 / 3).
#[tauri::command]
pub async fn qishui_qr_poll(app: tauri::AppHandle) -> Result<Value, String> {
    let token = TOKEN.lock().unwrap().clone().ok_or_else(|| "先取二维码".to_string())?;
    let id = current_identity();
    let query = passport_query(
        &id,
        &[
            ("next", API.to_string()),
            ("need_logo", "false".to_string()),
            ("need_short_url", "false".to_string()),
            ("is_frontier", "false".to_string()),
            ("is_new_login", "1".to_string()),
        ],
    );
    let mut form: Vec<(&str, String)> = vec![
        ("token", token),
        ("next", API.to_string()),
        ("need_logo", "false".to_string()),
        ("need_short_url", "false".to_string()),
        ("is_frontier", "false".to_string()),
        ("is_new_login", "1".to_string()),
    ];
    form.sort_by(|a, b| a.0.cmp(b.0));
    let body = form
        .iter()
        .map(|(key, value)| format!("{key}={}", urlencode(value)))
        .collect::<Vec<_>>()
        .join("&");

    let mut request = client()?
        .post(format!("{API}/passport/web/check_qrconnect/?{query}"))
        .header("Accept", "application/json, text/javascript")
        .header("x-tt-passport-verify-portrait", &id.portrait)
        .header("x-tt-passport-trace-id", format!("{:x}", seed()))
        .header("Content-Type", "application/x-www-form-urlencoded")
        .header("x-ss-stub", md5_hex(&body).to_uppercase())
        .body(body);
    // The cookies set by get_qrcode are part of the session being polled; a
    // cookie-less check looks like a different client and gets throttled.
    let cookies = cookie_header();
    if !cookies.is_empty() {
        request = request.header("Cookie", cookies);
    }
    let response = request
        .send()
        .await
        .map_err(|error| format!("汽水轮询失败：{error}"))?;
    absorb(&response);
    let answer: Value = response
        .json()
        .await
        .map_err(|error| format!("汽水返回了无效数据：{error}"))?;
    let data = answer.get("data").cloned().unwrap_or(Value::Null);
    if let Ok(dir) = app.path().app_config_dir() {
        use tauri::Manager;
        let _ = std::fs::create_dir_all(&dir);
        let line = format!("{}\n", answer.to_string().replace('\n', " "));
        use std::io::Write;
        if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(dir.join("qishui-login.log")) {
            let _ = file.write_all(line.as_bytes());
        }
    }
    let status = data
        .get("status")
        .map(|value| value.to_string().trim_matches('"').to_lowercase())
        .unwrap_or_default();

    let redirect = data
        .get("redirect_url")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let signed = ["confirmed", "success", "3"].contains(&status.as_str()) || !redirect.is_empty();
    if signed {
        // The confirmation sometimes only hands out the session after the
        // redirect it returns; follow it once before reading the jar.
        if let Some(target) = data.get("redirect_url").and_then(Value::as_str) {
            if target.starts_with("https://") {
                if let Ok(response) = client()?.get(target).send().await {
                    absorb(&response);
                }
            }
        }
        let cookie = cookie_header();
        if cookie.is_empty() {
            return Err("汽水没有下发登录 Cookie".into());
        }
        return Ok(json!({ "status": "confirmed", "cookie": cookie }));
    }
    Ok(json!({
        "status": status,
        "redirect": redirect,
        "error": data.get("description").and_then(Value::as_str).unwrap_or(""),
        "errorCode": data.get("error_code").and_then(Value::as_i64).unwrap_or(0),
    }))
}

fn md5_hex(text: &str) -> String {
    use md5::{Digest, Md5};
    format!("{:x}", Md5::digest(text.as_bytes()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore]
    async fn creates_a_qr() {
        let answer = qishui_qr_create().await.unwrap();
        assert!(answer["qrcode"].as_str().unwrap().starts_with("http"));
    }
}
