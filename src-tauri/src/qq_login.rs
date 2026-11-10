//! QQ Music sign-in, ported from the mygo plugin (Guyu23/mygo-music-qqmusic):
//! ptqrshow for the code, hash33(qrsig) for the poll token, ptqrlogin for the
//! scan result. No webview and no cookie scraping.

use std::sync::Mutex;

use serde_json::{json, Value};

const UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const APPID: &str = "716027609";
const DAID: &str = "383";
const THIRD_AID: &str = "100497308";
const QR_REFERER: &str = "https://xui.ptlogin2.qq.com/";

static QRSIG: Mutex<Option<String>> = Mutex::new(None);

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(UA)
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|error| error.to_string())
}

/// The plugin's hash33: five shifts and a mask.
fn hash33(text: &str, seed: u32) -> u32 {
    let mut hash = seed;
    for byte in text.bytes() {
        hash = hash.wrapping_add(hash << 5).wrapping_add(byte as u32);
    }
    hash & 0x7fff_ffff
}

/// The QR image bytes and the cookie that has to accompany the poll.
#[tauri::command]
pub async fn qq_qr_create() -> Result<Value, String> {
    // The plain login code (a PNG), not QQ's quick-login page: scanning the
    // latter sends the phone to a download page instead of a confirmation.
    let url = format!(
        "https://ssl.ptlogin2.qq.com/ptqrshow?appid={APPID}&e=2&l=M&s=3&d=72&v=4&t={}&daid={DAID}&pt_3rd_aid={THIRD_AID}&u1={}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|time| time.as_nanos())
            .unwrap_or(1),
        urlencode("https://graph.qq.com/oauth2.0/login_jump")
    );
    let response = client()?
        .get(&url)
        .header("Referer", QR_REFERER)
        .send()
        .await
        .map_err(|error| format!("QQ 二维码取不到：{error}"))?;

    let mut qrsig = String::new();
    for value in response.headers().get_all(reqwest::header::SET_COOKIE) {
        let Ok(text) = value.to_str() else { continue };
        if let Some(rest) = text.strip_prefix("qrsig=") {
            qrsig = rest.split(';').next().unwrap_or("").to_string();
        }
    }
    let png = response
        .bytes()
        .await
        .map_err(|error| format!("QQ 二维码读取失败：{error}"))?;
    if qrsig.is_empty() || png.len() < 200 {
        return Err("QQ 没有给出二维码".into());
    }
    *QRSIG.lock().unwrap() = Some(qrsig);

    Ok(json!({ "png": png.to_vec() }))
}

/// 65 waiting, 66 scanned, 67 cancelled, 0 done (the url is the check_sig).
#[tauri::command]
pub async fn qq_qr_poll() -> Result<Value, String> {
    let qrsig = QRSIG
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "先取二维码".to_string())?;
    let url = format!(
        "https://ssl.ptlogin2.qq.com/ptqrlogin?u1={}&ptqrtoken={}&ptredirect=0&h=1&t=1&g=1&from_ui=1&ptlang=2052&action=0-0-{}&js_ver=20102616&js_type=1&pt_uistyle=40&aid={APPID}&daid={DAID}&pt_3rd_aid={THIRD_AID}&has_onekey=1",
        urlencode("https://graph.qq.com/oauth2.0/login_jump"),
        hash33(&qrsig, 0),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|time| time.as_millis())
            .unwrap_or(1)
    );
    let body = client()?
        .get(&url)
        .header("Referer", QR_REFERER)
        .header("Cookie", format!("qrsig={qrsig}"))
        .send()
        .await
        .map_err(|error| format!("QQ 登录轮询失败：{error}"))?
        .text()
        .await
        .map_err(|error| format!("QQ 登录轮询读取失败：{error}"))?;

    let args: Vec<String> = body
        .split('\'')
        .skip(1)
        .step_by(2)
        .map(|part| part.replace("\\/", "/").replace("\\x26", "&"))
        .collect();

    Ok(json!({
        "code": args.first().cloned().unwrap_or_default(),
        "url": args.get(2).cloned().unwrap_or_default(),
        "message": args.get(4).cloned().unwrap_or_default(),
    }))
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

fn jar_header(jar: &std::collections::HashMap<String, String>) -> String {
    jar.iter()
        .map(|(name, value)| format!("{name}={value}"))
        .collect::<Vec<_>>()
        .join("; ")
}

fn absorb(response: &reqwest::Response, jar: &mut std::collections::HashMap<String, String>) {
    for value in response.headers().get_all(reqwest::header::SET_COOKIE) {
        let Ok(text) = value.to_str() else { continue };
        let pair = text.split(';').next().unwrap_or("");
        let Some((name, val)) = pair.split_once('=') else { continue };
        let name = name.trim();
        let val = val.trim();
        if name.is_empty() || val.is_empty() {
            continue;
        }
        jar.insert(name.to_string(), val.to_string());
    }
}

fn query_of(url: &str, key: &str) -> String {
    let query = url.split('?').nth(1).unwrap_or("").split('#').next().unwrap_or("");
    for part in query.split('&') {
        if let Some((name, value)) = part.split_once('=') {
            if name == key {
                return value.to_string();
            }
        }
    }
    String::new()
}

/// The signed-in listener as a Cookie header our player can use.
#[tauri::command]
pub async fn qq_qr_exchange(url: String) -> Result<Value, String> {
    let uin = query_of(&url, "uin");
    let ptsigx = query_of(&url, "ptsigx");
    if uin.is_empty() || ptsigx.is_empty() {
        return Err("QQ 回调里没有 uin / ptsigx".into());
    }

    let check = format!(
        "https://ssl.ptlogin2.graph.qq.com/check_sig?uin={uin}&pttype=1&service=ptqrlogin&nodirect=0&ptsigx={ptsigx}&s_url={}&ptlang=2052&ptredirect=100&aid={APPID}&daid={DAID}&j_later=0&low_login_hour=0&regmaster=0&pt_login_type=3&pt_aid=0&pt_aaid=16&pt_light=0&pt_3rd_aid={THIRD_AID}",
        urlencode("https://graph.qq.com/oauth2.0/login_jump")
    );

    let client = reqwest::Client::builder()
        .user_agent(UA)
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|error| error.to_string())?;

    let mut jar = std::collections::HashMap::new();
    let mut current = check;
    let mut referer = QR_REFERER.to_string();
    for _ in 0..5 {
        let mut request = client.get(&current).header("Referer", &referer);
        if !jar.is_empty() {
            request = request.header("Cookie", jar_header(&jar));
        }
        let response = request
            .send()
            .await
            .map_err(|error| format!("QQ 换票失败：{error}"))?;
        absorb(&response, &mut jar);
        let location = response
            .headers()
            .get(reqwest::header::LOCATION)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string);
        match location {
            Some(next) => {
                referer = current;
                current = if next.starts_with("http") {
                    next
                } else if next.starts_with('/') {
                    format!("https://ssl.ptlogin2.qq.com{next}")
                } else {
                    format!("https://ssl.ptlogin2.qq.com/{next}")
                };
            }
            None => break,
        }
    }

    let p_skey = jar.get("p_skey").cloned().unwrap_or_default();
    qq_log(&format!(
        "check_sig cookies={:?} p_skey={}",
        jar.keys().collect::<Vec<_>>(),
        if p_skey.is_empty() { "none" } else { "ok" }
    ));
    if p_skey.is_empty() {
        return Err("QQ 没有下发 p_skey".into());
    }

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|time| time.as_millis())
        .unwrap_or(0);
    let form = [
        ("response_type", "code".to_string()),
        ("client_id", THIRD_AID.to_string()),
        ("redirect_uri", "https://y.qq.com/portal/wx_redirect.html?login_type=1&surl=https://y.qq.com/".to_string()),
        ("scope", "get_user_info,get_app_friends".to_string()),
        ("state", "state".to_string()),
        ("switch", String::new()),
        ("from_ptlogin", "1".to_string()),
        ("src", "1".to_string()),
        ("update_auth", "1".to_string()),
        ("openapi", "1010_1030".to_string()),
        ("g_tk", hash33(&p_skey, 5381).to_string()),
        ("auth_time", now.to_string()),
        ("ui", format!("{now:x}")),
    ];
    let response = client
        .post("https://graph.qq.com/oauth2.0/authorize")
        .header("Referer", "https://graph.qq.com/oauth2.0/authorize")
        .header("Origin", "https://graph.qq.com")
        .header("Cookie", jar_header(&jar))
        .form(&form)
        .send()
        .await
        .map_err(|error| format!("QQ 授权失败：{error}"))?;
    let location = response
        .headers()
        .get(reqwest::header::LOCATION)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_string();
    let code = query_of(&location, "code");
    qq_log(&format!("authorize location={} code={}", location, if code.is_empty() { "none" } else { "ok" }));
    if code.is_empty() {
        return Err("QQ 授权没有返回 code".into());
    }

    let device = device_id();
    let payload = json!({
        "comm": {
            "ct": "11", "cv": "13020508", "v": "13020508", "tmeAppID": "qqmusic",
            "format": "json", "inCharset": "utf-8", "outCharset": "utf-8",
            "uid": device, "tmeLoginType": "2"
        },
        "QQConnectLogin.LoginServer.QQLogin": {
            "module": "QQConnectLogin.LoginServer",
            "method": "QQLogin",
            "param": { "code": code }
        }
    });
    let answer: Value = client
        .post("https://u.y.qq.com/cgi-bin/musicu.fcg")
        .header("Referer", "https://y.qq.com/")
        .header("Origin", "https://y.qq.com")
        .header("Content-Type", "application/json")
        .header("Cookie", jar_header(&jar))
        .body(payload.to_string())
        .send()
        .await
        .map_err(|error| format!("QQ 登录换票失败：{error}"))?
        .json()
        .await
        .map_err(|error| format!("QQ 登录返回了无效数据：{error}"))?;

    let data = answer
        .pointer("/QQConnectLogin.LoginServer.QQLogin/data")
        .cloned()
        .unwrap_or(Value::Null);
    let musicid = data
        .get("musicid")
        .or_else(|| data.get("str_musicid"))
        .map(|value| value.to_string().trim_matches('"').to_string())
        .unwrap_or_default();
    let musickey = data
        .get("musickey")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    qq_log(&format!(
        "login musicid={} musickey={} answer={}",
        musicid,
        if musickey.is_empty() { "none" } else { "ok" },
        answer.to_string().chars().take(300).collect::<String>()
    ));
    if musicid.is_empty() || musickey.is_empty() {
        return Err("QQ 登录没有拿到 musickey".into());
    }
    let name = data.get("nick").and_then(Value::as_str).unwrap_or("QQ 音乐");
    let login_type = if musickey.starts_with("W_X") { 1 } else { 2 };

    // What playback needs is the pair, exactly like the plugin's session.
    let session = json!({
        "musicid": musicid,
        "musickey": musickey,
        "loginType": login_type,
        "name": name,
    });
    Ok(json!({
        "cookie": session.to_string(),
        "name": name,
        "musicid": musicid,
    }))
}

fn qq_log(line: &str) {
    let home = std::env::var("HOME").unwrap_or_default();
    let dir = std::path::PathBuf::from(home)
        .join("Library/Application Support/app.needle.player");
    let _ = std::fs::create_dir_all(&dir);
    use std::io::Write;
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join("qq-login.log"))
    {
        let _ = writeln!(file, "{line}");
    }
}

fn device_id() -> String {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    std::env::var("USER").unwrap_or_default().hash(&mut hasher);
    let value = hasher.finish() % 10_000_000_000;
    format!("{value:010}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore]
    async fn creates_and_polls_a_qr() {
        let created = qq_qr_create().await.unwrap();
        assert!(created["png"].as_array().map(|bytes| bytes.len() > 200).unwrap_or(false));
        let status = qq_qr_poll().await.unwrap();
        assert!(matches!(status["code"].as_str().unwrap_or(""), "65" | "66" | "67" | "0"));
    }
}

/// Who the musicid belongs to, for the corner of the player.
#[tauri::command]
pub async fn qq_profile(app: tauri::AppHandle, cookie: String) -> Result<Value, String> {
    let uin = serde_json::from_str::<Value>(&cookie)
        .ok()
        .and_then(|session| {
            session
                .get("musicid")
                .map(|value| value.to_string().trim_matches('"').to_string())
        })
        .or_else(|| {
            cookie.split(';').find_map(|part| {
                let (key, value) = part.trim().split_once('=')?;
                (key == "uin").then(|| value.trim_start_matches('o').to_string())
            })
        })
        .ok_or_else(|| "登录信息里没有 uin".to_string())?;

    let url = format!(
        "https://c.y.qq.com/rsc/fcgi-bin/fcg_get_profile_homepage.fcg?format=json&cid=205360838&userid={uin}&reqfrom=1"
    );
    let body: Value = reqwest::Client::builder()
        .user_agent(UA)
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|error| error.to_string())?
        .get(url)
        .header("Referer", "https://y.qq.com/")
        .send()
        .await
        .map_err(|error| format!("QQ 连不上：{error}"))?
        .json()
        .await
        .map_err(|error| format!("QQ 返回了无效数据：{error}"))?;

    if let Ok(dir) = tauri::Manager::path(&app).app_config_dir() {
        use std::io::Write;
        let _ = std::fs::create_dir_all(&dir);
        if let Ok(mut file) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(dir.join("qq-profile.log"))
        {
            let _ = writeln!(file, "body={body}");
        }
    }

    if body.get("code").and_then(Value::as_i64) == Some(1000) {
        return Err("QQ 登录已失效，重新扫一次".into());
    }
    let creator = body.pointer("/data/creator").cloned().unwrap_or(Value::Null);
    let name = creator
        .get("nick")
        .or_else(|| creator.get("name"))
        .and_then(Value::as_str)
        .unwrap_or("");
    if name.is_empty() {
        return Err("QQ 没有返回账号信息".into());
    }
    Ok(json!({
        "name": name,
        "avatar": creator.get("headpic").and_then(Value::as_str).unwrap_or(""),
    }))
}
