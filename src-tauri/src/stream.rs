//! Playing a side while it is still arriving.
//!
//! The CDNs behind these sources answer a WebView with 403 unless the request
//! carries their Referer and User-Agent, and a WebView will not let anybody set
//! those. So the audio is served from a loopback server instead: the player's
//! Range requests are handed to the CDN untouched, which means playback starts
//! on the first chunk and a seek is a new range rather than a new download.
//! Bytes that pass through on their way to a whole file are kept in the cache,
//! so the next play of that side is a local read.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU16, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

/// A quarter of an hour of a big room, and far more than one song needs.
const HEAD_LIMIT: usize = 16 * 1024;
/// A side bigger than this is streamed but not kept.
const KEEP_LIMIT: usize = 64 * 1024 * 1024;
/// Anything smaller than this never reaches the cache; it is a clip or a stub.
const LEAST_AUDIO: usize = 32 * 1024;

/// What the proxy needs to fetch one song, and where a full pass should land.
struct Ticket {
    url: String,
    agent: String,
    referer: String,
    kind: String,
    cache: PathBuf,
}

static TICKETS: OnceLock<Mutex<HashMap<String, Arc<Ticket>>>> = OnceLock::new();
static KEEPING: OnceLock<Mutex<HashSet<PathBuf>>> = OnceLock::new();
static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
static PORT: AtomicU16 = AtomicU16::new(0);

fn tickets() -> &'static Mutex<HashMap<String, Arc<Ticket>>> {
    TICKETS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn keeping() -> &'static Mutex<HashSet<PathBuf>> {
    KEEPING.get_or_init(|| Mutex::new(HashSet::new()))
}

/// One connection to a CDN, with no total timeout: a side is allowed to take
/// as long as the listener lets it.
pub(crate) fn client() -> &'static reqwest::Client {
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .build()
            .unwrap_or_default()
    })
}

pub(crate) fn port() -> u16 {
    PORT.load(Ordering::Relaxed)
}

pub(crate) fn audio_directory(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("无法定位缓存目录：{error}"))?;
    Ok(base.join("audio"))
}

/// How a source names its files once they are on this machine.
pub(crate) fn cache_name(source: &str, id: &str) -> String {
    match source {
        "qq" => format!("qq-{id}"),
        "qishui" => format!("qishui-{id}"),
        _ => id.to_string(),
    }
}

fn kinds_of(source: &str) -> &'static [&'static str] {
    match source {
        "qq" => &["flac", "mp3", "m4a"],
        "qishui" => &["mp4"],
        _ => &["mp3", "flac", "ogg"],
    }
}

/// A complete copy of a song, whatever container the source handed back.
pub(crate) fn cached_file(
    directory: &Path,
    source: &str,
    id: &str,
) -> Option<(PathBuf, String)> {
    cached_with(directory, &cache_name(source, id), kinds_of(source), LEAST_AUDIO)
}

fn cached_with(directory: &Path, name: &str, kinds: &[&str], least: usize) -> Option<(PathBuf, String)> {
    for kind in kinds {
        let file = directory.join(format!("{name}.{kind}"));
        if std::fs::metadata(&file).map(|meta| meta.len() as usize > least).unwrap_or(false) {
            return Some((file, kind.to_string()));
        }
    }
    None
}

fn content_type(kind: &str) -> &'static str {
    match kind {
        "flac" => "audio/flac",
        "m4a" | "mp4" => "audio/mp4",
        "ogg" => "audio/ogg",
        _ => "audio/mpeg",
    }
}

/// Whether an address really plays, asked with two bytes rather than a whole
/// song. A quality the account cannot have fails here, and the source can walk
/// on to the next one.
pub(crate) async fn probe(url: &str, agent: &str, referer: &str) -> Result<(), String> {
    let mut request = client()
        .get(url)
        .header("Range", "bytes=0-1")
        .header("User-Agent", agent);
    if !referer.is_empty() {
        request = request.header("Referer", referer);
    }
    let response = request
        .send()
        .await
        .map_err(|error| format!("音频地址连不上：{error}"))?;
    let status = response.status().as_u16();
    if status >= 400 {
        return Err(format!("音频地址被拒绝（{status}）"));
    }
    Ok(())
}

/// Fetch a whole side into the cache, trying each address in turn. Used when a
/// source is asked to warm a track ahead of the hand, never for playback.
pub(crate) async fn download(
    directory: &Path,
    name: &str,
    urls: &[&str],
    agent: &str,
    referer: &str,
    kind: &str,
) -> Result<PathBuf, String> {
    tokio::fs::create_dir_all(directory)
        .await
        .map_err(|error| format!("无法建立缓存目录：{error}"))?;

    let mut last = "音频下载失败".to_string();
    for url in urls.iter().filter(|url| !url.is_empty()) {
        let mut request = client().get(*url).header("User-Agent", agent);
        if !referer.is_empty() {
            request = request.header("Referer", referer);
        }
        let bytes = match request.send().await {
            Ok(response) => match response.error_for_status() {
                Ok(response) => match response.bytes().await {
                    Ok(bytes) => bytes,
                    Err(error) => {
                        last = format!("音频读取失败：{error}");
                        continue;
                    }
                },
                Err(error) => {
                    last = format!("音频下载失败：{error}");
                    continue;
                }
            },
            Err(error) => {
                last = format!("音频下载失败：{error}");
                continue;
            }
        };
        if bytes.len() < LEAST_AUDIO {
            last = "只返回了空音频".into();
            continue;
        }
        let file = directory.join(format!("{name}.{kind}"));
        let partial = directory.join(format!("{name}.{kind}.part"));
        // Write beside the target first: a half download must not look cached.
        tokio::fs::write(&partial, &bytes)
            .await
            .map_err(|error| format!("无法写入缓存：{error}"))?;
        tokio::fs::rename(&partial, &file)
            .await
            .map_err(|error| format!("无法完成缓存：{error}"))?;
        return Ok(file);
    }
    Err(last)
}

/// Open the loopback server. The port is chosen by the system, so two copies of
/// the app never fight over one.
pub fn start(app: &AppHandle) -> Result<(), String> {
    let listener = std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
        .map_err(|error| format!("无法打开音频端口：{error}"))?;
    listener
        .set_nonblocking(true)
        .map_err(|error| format!("无法打开音频端口：{error}"))?;
    let port = listener
        .local_addr()
        .map_err(|error| format!("无法打开音频端口：{error}"))?
        .port();
    PORT.store(port, Ordering::Relaxed);

    let directory = audio_directory(app)?;
    tauri::async_runtime::spawn(async move {
        let Ok(listener) = TcpListener::from_std(listener) else {
            return;
        };
        serve(listener, directory).await;
    });
    Ok(())
}

/// One connection at a time is answered on its own task, so a seek never waits
/// behind the range that is still arriving.
async fn serve(listener: TcpListener, directory: PathBuf) {
    loop {
        let Ok((socket, _)) = listener.accept().await else {
            continue;
        };
        let directory = directory.clone();
        tokio::spawn(async move {
            let _ = answer(socket, directory).await;
        });
    }
}

/// The playable address for a song: a local file when one is already here, a
/// loopback stream when it has to come off the network.
#[tauri::command]
pub async fn audio_open(
    app: AppHandle,
    source: String,
    id: String,
    media: Option<String>,
    cookie: Option<String>,
) -> Result<Value, String> {
    let directory = audio_directory(&app)?;
    if let Some((file, kind)) = cached_file(&directory, &source, &id) {
        return Ok(json!({
            "path": file.to_string_lossy(),
            "kind": kind,
            "cached": true,
        }));
    }

    let cookie = cookie.as_deref().filter(|value| !value.trim().is_empty());
    let (url, kind, agent, referer) = match source.as_str() {
        "netease" => {
            let (url, kind) = crate::netease::resolve(&id, cookie).await?;
            (url, kind, crate::netease::UA.to_string(), crate::netease::referer())
        }
        "qq" => {
            let (url, kind) = crate::qq::resolve(&id, media.as_deref(), cookie).await?;
            (url, kind, crate::qq::UA.to_string(), crate::qq::YQQ.to_string())
        }
        "qishui" => {
            let (url, kind) = crate::qishui::resolve(&app, &id, cookie).await?;
            (url, kind, crate::qishui::UA_PC.to_string(), crate::qishui::REFERER.to_string())
        }
        other => return Err(format!("{other} 没有可播的地址")),
    };

    let ticket = Arc::new(Ticket {
        url,
        agent,
        referer,
        kind: kind.clone(),
        cache: directory.join(format!("{}.{kind}", cache_name(&source, &id))),
    });
    let token = issue(ticket);
    Ok(json!({
        "stream": format!("http://127.0.0.1:{}/s/{token}", port()),
        "kind": kind,
    }))
}

fn issue(ticket: Arc<Ticket>) -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|span| span.as_nanos())
        .unwrap_or_default();
    let token = format!("{nanos:x}");
    let mut store = tickets().lock().unwrap();
    // A ticket for a side that is already on this machine can never be asked
    // for again: `audio_open` answers with the file itself.
    if store.len() > 128 {
        store.retain(|_, ticket| !ticket.cache.exists());
    }
    store.insert(token.clone(), ticket);
    token
}

// ------------------------------------------------------------------ serving

async fn answer(mut socket: TcpStream, directory: PathBuf) -> std::io::Result<()> {
    let _ = socket.set_nodelay(true);
    let Some(head) = read_head(&mut socket).await? else {
        return Ok(());
    };
    let request = Request::parse(&head);

    if request.method.eq_ignore_ascii_case("OPTIONS") {
        return reply(
            &mut socket,
            204,
            "No Content",
            &[
                ("Access-Control-Allow-Origin", "*".into()),
                ("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS".into()),
                ("Access-Control-Allow-Headers", "Range".into()),
            ],
            &[],
        )
        .await;
    }

    let Some(token) = request.path.strip_prefix("/s/") else {
        return reply(&mut socket, 404, "Not Found", &[], b"song?").await;
    };
    let ticket = tickets().lock().unwrap().get(token).cloned();
    let Some(ticket) = ticket else {
        return reply(&mut socket, 404, "Not Found", &[], b"this side has closed").await;
    };

    let mut ask = client().get(&ticket.url).header("User-Agent", &ticket.agent);
    if !ticket.referer.is_empty() {
        ask = ask.header("Referer", &ticket.referer);
    }
    if let Some(range) = request.headers.get("range") {
        ask = ask.header("Range", range);
    }

    let response = match ask.send().await {
        Ok(response) => response,
        Err(error) => {
            return reply(
                &mut socket,
                502,
                "Bad Gateway",
                &[],
                format!("音频连不上：{error}").as_bytes(),
            )
            .await;
        }
    };

    relay(&mut socket, response, &ticket, &directory, &request).await
}

/// One request head, read until the blank line. `None` when the client simply
/// hung up, which the browser does all the time while probing.
async fn read_head(socket: &mut TcpStream) -> std::io::Result<Option<Vec<u8>>> {
    let mut head = Vec::with_capacity(1024);
    let mut chunk = [0u8; 2048];
    let read = tokio::time::timeout(Duration::from_secs(15), async {
        loop {
            let read = socket.read(&mut chunk).await?;
            if read == 0 {
                return std::io::Result::Ok(0);
            }
            head.extend_from_slice(&chunk[..read]);
            if find(&head, b"\r\n\r\n").is_some() || head.len() > HEAD_LIMIT {
                let end = find(&head, b"\r\n\r\n").map(|at| at + 4).unwrap_or(head.len());
                head.truncate(end);
                return std::io::Result::Ok(read);
            }
        }
    })
    .await;

    match read {
        Ok(Ok(0)) => Ok(None),
        Ok(Ok(_)) => Ok(Some(head)),
        Ok(Err(error)) => Err(error),
        Err(_) => Ok(None),
    }
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|window| window == needle)
}

struct Request {
    method: String,
    path: String,
    headers: HashMap<String, String>,
}

impl Request {
    fn parse(head: &[u8]) -> Request {
        let text = String::from_utf8_lossy(head);
        let mut lines = text.split("\r\n");
        let mut start = lines.next().unwrap_or_default().split_whitespace();
        let method = start.next().unwrap_or("GET").to_string();
        let path = start.next().unwrap_or("/").to_string();
        let mut headers = HashMap::new();
        for line in lines {
            let Some((name, value)) = line.split_once(':') else {
                continue;
            };
            headers.insert(name.trim().to_ascii_lowercase(), value.trim().to_string());
        }
        Request {
            method,
            path,
            headers,
        }
    }
}

async fn reply(
    socket: &mut TcpStream,
    status: u16,
    reason: &str,
    headers: &[(&str, String)],
    body: &[u8],
) -> std::io::Result<()> {
    let mut head = format!("HTTP/1.1 {status} {reason}\r\nConnection: close\r\n");
    head.push_str("Access-Control-Allow-Origin: *\r\n");
    for (name, value) in headers {
        head.push_str(&format!("{name}: {value}\r\n"));
    }
    head.push_str(&format!("Content-Length: {}\r\n\r\n", body.len()));
    socket.write_all(head.as_bytes()).await?;
    socket.write_all(body).await?;
    socket.flush().await
}

/// Pass the CDN's answer through to the player, keeping the bytes as they go
/// when this request is the whole song.
async fn relay(
    socket: &mut TcpStream,
    mut response: reqwest::Response,
    ticket: &Ticket,
    directory: &Path,
    request: &Request,
) -> std::io::Result<()> {
    let status = response.status().as_u16();
    let reason = response.status().canonical_reason().unwrap_or("").to_string();

    let find = |name: &str| {
        response
            .headers()
            .get(name)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string)
    };
    let kind = find("content-type").unwrap_or_else(|| content_type(&ticket.kind).to_string());
    let length = find("content-length");
    let span = find("content-range").and_then(|value| Span::parse(&value));

    let mut head = format!("HTTP/1.1 {status} {reason}\r\nConnection: close\r\n");
    head.push_str("Access-Control-Allow-Origin: *\r\n");
    head.push_str("Access-Control-Expose-Headers: Content-Range, Content-Length, Accept-Ranges\r\n");
    head.push_str("Accept-Ranges: bytes\r\n");
    head.push_str(&format!("Content-Type: {kind}\r\n"));
    if let Some(length) = &length {
        head.push_str(&format!("Content-Length: {length}\r\n"));
    }
    if let Some(value) = find("content-range") {
        head.push_str(&format!("Content-Range: {value}\r\n"));
    }
    head.push_str("\r\n");
    socket.write_all(head.as_bytes()).await?;
    if request.method.eq_ignore_ascii_case("HEAD") {
        return socket.flush().await;
    }

    // Only a pass that starts at the first byte and ends at the last is the
    // whole song; anything else is a seek, and a seek is not a cache entry.
    let total = span
        .as_ref()
        .and_then(|span| span.total)
        .or_else(|| length.as_ref().and_then(|value| value.parse().ok()));
    let whole = match status {
        200 => Some(()),
        206 => span.as_ref().and_then(|span| {
            (span.start == 0 && total.map(|total| span.end + 1 == total).unwrap_or(false)).then_some(())
        }),
        _ => None,
    };
    let claimed = whole.and_then(|_| claim(&ticket.cache));
    let mut kept: Vec<u8> = Vec::new();
    let mut teeing = claimed.is_some();

    loop {
        match response.chunk().await {
            Ok(Some(bytes)) => {
                if teeing {
                    if kept.len() + bytes.len() > KEEP_LIMIT {
                        teeing = false;
                        kept = Vec::new();
                    } else {
                        kept.extend_from_slice(&bytes);
                    }
                }
                socket.write_all(&bytes).await?;
            }
            Ok(None) => break,
            Err(_) => {
                // A truncated body: the player will ask again, and nothing
                // half-arrived is allowed to look cached.
                teeing = false;
                break;
            }
        }
    }
    socket.flush().await?;

    if teeing && kept.len() >= LEAST_AUDIO {
        let complete = total.map(|total| total == kept.len() as u64).unwrap_or(true);
        if complete {
            let _ = keep(directory, &ticket.cache, &kept).await;
        }
    }
    Ok(())
}

async fn keep(directory: &Path, file: &Path, bytes: &[u8]) -> std::io::Result<()> {
    tokio::fs::create_dir_all(directory).await?;
    let partial = file.with_extension(format!(
        "{}.part",
        file.extension()
            .and_then(|value| value.to_str())
            .unwrap_or("audio")
    ));
    tokio::fs::write(&partial, bytes).await?;
    tokio::fs::rename(&partial, file).await
}

/// One pass at a time is allowed to write a given file.
struct Claim(PathBuf);

impl Drop for Claim {
    fn drop(&mut self) {
        keeping().lock().unwrap().remove(&self.0);
    }
}

fn claim(path: &Path) -> Option<Claim> {
    let mut set = keeping().lock().unwrap();
    if set.contains(path) {
        return None;
    }
    set.insert(path.to_path_buf());
    Some(Claim(path.to_path_buf()))
}

struct Span {
    start: u64,
    end: u64,
    total: Option<u64>,
}

impl Span {
    /// `bytes 0-1023/2048`, or `bytes 0-1023/*`.
    fn parse(value: &str) -> Option<Span> {
        let rest = value.trim().strip_prefix("bytes")?.trim();
        let (range, total) = rest.split_once('/')?;
        let (start, end) = range.trim().split_once('-')?;
        Some(Span {
            start: start.trim().parse().ok()?,
            end: end.trim().parse().ok()?,
            total: total.trim().parse().ok(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TOTAL: usize = 40 * 1024;

    fn body() -> Vec<u8> {
        (0..TOTAL).map(|i| (i % 251) as u8).collect()
    }

    /// A stand-in for a CDN: honest about byte ranges, and it wants a Referer
    /// the way the real ones do.
    async fn origin() -> (u16, tokio::task::JoinHandle<()>) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = tokio::spawn(async move {
            loop {
                let Ok((mut socket, _)) = listener.accept().await else { break };
                tokio::spawn(async move {
                    let Some(head) = read_head(&mut socket).await.unwrap_or(None) else { return };
                    let request = Request::parse(&head);
                    let mut start = 0;
                    let mut end = TOTAL - 1;
                    if let Some(value) = request.headers.get("range") {
                        let rest = value.trim_start_matches("bytes=");
                        let (from, to) = rest.split_once('-').unwrap();
                        start = from.parse().unwrap();
                        if !to.is_empty() {
                            end = to.parse::<usize>().unwrap().min(TOTAL - 1);
                        }
                    }
                    let slice = &body()[start..=end];
                    let head = format!(
                        "HTTP/1.1 206 Partial Content\r\nContent-Type: audio/mpeg\r\nContent-Range: bytes {start}-{end}/{TOTAL}\r\nContent-Length: {}\r\nAccept-Ranges: bytes\r\nConnection: close\r\n\r\n",
                        slice.len()
                    );
                    let _ = socket.write_all(head.as_bytes()).await;
                    let _ = socket.write_all(slice).await;
                    let _ = socket.flush().await;
                });
            }
        });
        (port, handle)
    }

    async fn serve_at(directory: PathBuf) -> u16 {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(serve(listener, directory));
        port
    }

    async fn fetch(port: u16, path: &str, range: Option<&str>) -> (String, Vec<u8>) {
        let mut socket = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        let mut request = format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\n");
        if let Some(range) = range {
            request.push_str(&format!("Range: {range}\r\n"));
        }
        request.push_str("\r\n");
        socket.write_all(request.as_bytes()).await.unwrap();

        let mut raw = Vec::new();
        socket.read_to_end(&mut raw).await.unwrap();
        let split = find(&raw, b"\r\n\r\n").unwrap() + 4;
        let head = String::from_utf8_lossy(&raw[..split]).to_string();
        (head, raw[split..].to_vec())
    }

    #[tokio::test]
    async fn streams_a_whole_side_and_keeps_it() {
        let (origin_port, origin_task) = origin().await;
        let directory = std::env::temp_dir().join(format!(
            "needle-stream-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&directory);
        let cache = directory.join("4242.mp3");
        let token = issue(Arc::new(Ticket {
            url: format!("http://127.0.0.1:{origin_port}/4242.mp3"),
            agent: "needle-test".into(),
            referer: "https://music.163.com/".into(),
            kind: "mp3".into(),
            cache: cache.clone(),
        }));
        let port = serve_at(directory.clone()).await;

        let (head, payload) = fetch(port, &format!("/s/{token}"), Some("bytes=0-")).await;
        assert!(head.starts_with("HTTP/1.1 206"), "{head}");
        assert!(head.to_lowercase().contains("accept-ranges: bytes"), "{head}");
        assert!(head.contains(&format!("Content-Range: bytes 0-{}/{TOTAL}", TOTAL - 1)), "{head}");
        assert_eq!(payload, body(), "the whole side arrived in order");

        // The pass was the whole song, so it is now a local file.
        let kept = std::fs::read(&cache).unwrap();
        assert_eq!(kept, body(), "the cache holds exactly what played");
        assert!(!directory.join("4242.mp3.part").exists(), "no stub left behind");
        origin_task.abort();
    }

    #[tokio::test]
    async fn a_seek_is_a_range_and_not_a_cache_entry() {
        let (origin_port, origin_task) = origin().await;
        let directory = std::env::temp_dir().join(format!(
            "needle-seek-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&directory);
        let cache = directory.join("7.mp3");
        let token = issue(Arc::new(Ticket {
            url: format!("http://127.0.0.1:{origin_port}/7.mp3"),
            agent: "needle-test".into(),
            referer: String::new(),
            kind: "mp3".into(),
            cache: cache.clone(),
        }));
        let port = serve_at(directory.clone()).await;

        let (head, payload) = fetch(port, &format!("/s/{token}"), Some("bytes=1000-1999")).await;
        assert!(head.starts_with("HTTP/1.1 206"), "{head}");
        assert_eq!(payload, &body()[1000..2000]);
        assert!(!cache.exists(), "half a song is not a cached song");
        origin_task.abort();
    }

    #[tokio::test]
    async fn an_unknown_side_is_not_found() {
        let directory = std::env::temp_dir().join("needle-empty");
        let port = serve_at(directory).await;
        let (head, _) = fetch(port, "/s/nothing", None).await;
        assert!(head.starts_with("HTTP/1.1 404"), "{head}");
    }
}
