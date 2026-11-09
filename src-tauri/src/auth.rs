//! Signing in the way MyGo Music's plugins do: a window of our own on the
//! service's page, and the cookies it leaves behind. The window is separate
//! from the player, is remembered by the system's web data store, and is read
//! by Rust — the page never sees the cookie string.

use std::time::Duration;

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

/// What each service needs before we consider the listener signed in.
fn service(name: &str) -> Option<(&'static str, &'static str)> {
    match name {
        "netease" => Some(("https://music.163.com/", "登录网易云音乐")),
        "qq" => Some(("https://y.qq.com/", "登录 QQ 音乐")),
        _ => None,
    }
}

/// What "signed in" means for each service. QQ writes its music key under
/// different names depending on where the login came from, so any of them
/// counts once `uin` is there.
fn signed_in(service_name: &str, cookies: &[String]) -> bool {
    let has = |name: &str| cookies.iter().any(|cookie| cookie.split('=').next() == Some(name));
    match service_name {
        "netease" => has("MUSIC_U"),
        "qq" => has("uin") && (has("qm_keystones") || has("qqmusic_key") || has("psrf_qqunionid")),
        _ => false,
    }
}

#[tauri::command]
pub async fn open_login(app: AppHandle, service_name: String) -> Result<String, String> {
    let (address, title) = service(&service_name).ok_or_else(|| "未知音源".to_string())?;
    let url = tauri::Url::parse(address).map_err(|error| format!("地址无效：{error}"))?;

    if let Some(existing) = app.get_webview_window("login") {
        let _ = existing.close();
        tokio::time::sleep(Duration::from_millis(200)).await;
    }

    let window = WebviewWindowBuilder::new(&app, "login", WebviewUrl::External(url.clone()))
        .title(title)
        .inner_size(520.0, 720.0)
        .min_inner_size(420.0, 560.0)
        .center()
        .build()
        .map_err(|error| format!("打不开登录窗口：{error}"))?;

    // Wait for the login to leave its cookies behind, or for the listener to
    // close the window, for up to five minutes.
    for _ in 0..600 {
        if app.get_webview_window("login").is_none() {
            break;
        }

        if let Ok(cookies) = window.cookies_for_url(url.clone()) {
            let all: Vec<String> = cookies
                .iter()
                .map(|cookie| format!("{}={}", cookie.name(), cookie.value()))
                .collect();
            if signed_in(&service_name, &all) {
                let _ = window.close();
                return Ok(all.join("; "));
            }
        }

        tokio::time::sleep(Duration::from_millis(500)).await;
    }

    let _ = window.close();
    Err("登录窗口关掉了，没有拿到 Cookie".into())
}
