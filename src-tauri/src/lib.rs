mod auth;
mod cache;
mod netease;
mod qishui;
mod qq;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
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
            cache::cache_usage,
            cache::cache_clear,
            auth::open_login
        ])
        .run(tauri::generate_context!())
        .expect("error while running Needle");
}
