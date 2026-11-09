mod auth;
mod cache;
mod netease;
mod qishui;
mod netease_login;
mod qishui_login;
mod qq_login;
mod qq;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            netease::init(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            netease::netease_search,
            netease::netease_chart,
            netease::netease_lyric,
            netease::netease_stream,
            qq::qq_search,
            qq::qq_lyric,
            qq::qq_stream,
            qishui::qishui_search,
            qishui::qishui_track,
            qishui::qishui_stream,
            qq_login::qq_qr_create,
            qq_login::qq_qr_poll,
            qq_login::qq_qr_exchange,
            netease_login::netease_qr_create,
            netease_login::netease_qr_poll,
            netease_login::netease_profile,
            qishui_login::qishui_qr_create,
            qishui_login::qishui_qr_poll,
            cache::cache_usage,
            cache::cache_clear,
            auth::open_login
        ])
        .run(tauri::generate_context!())
        .expect("error while running Needle");
}
