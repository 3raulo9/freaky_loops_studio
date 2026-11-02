//! The `fls://` custom protocol (served as `http://fls.localhost/` on Windows):
//! the built UI from `dist`, plus offline-bounce PCM files under `/__render/`.

use std::borrow::Cow;
use std::path::{Component, Path, PathBuf};
use wry::http::{header, Request, Response, StatusCode};

pub const ORIGIN: &str = "http://fls.localhost";

/// Where the built UI lives: `wwwroot` next to the exe (packaged app), else the
/// repo's `dist` (running from the cargo target tree).
pub fn dist_dir() -> PathBuf {
    if let Ok(d) = std::env::var("FLS_DIST") {
        return PathBuf::from(d);
    }
    if let Some(dir) = std::env::current_exe().ok().and_then(|e| e.parent().map(Path::to_path_buf)) {
        let www = dir.join("wwwroot");
        if www.join("index.html").exists() {
            return www;
        }
    }
    Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("..").join("dist")
}

fn mime(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase().as_str() {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" | "map" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "ico" => "image/x-icon",
        "webp" => "image/webp",
        "wasm" => "application/wasm",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "wav" => "audio/wav",
        "mp3" => "audio/mpeg",
        "ogg" => "audio/ogg",
        "mid" | "midi" => "audio/midi",
        _ => "application/octet-stream",
    }
}

fn respond(status: StatusCode, ctype: &str, body: Vec<u8>) -> Response<Cow<'static, [u8]>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, ctype)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::CACHE_CONTROL, "no-cache")
        .body(Cow::Owned(body))
        .unwrap()
}

/// Reject `..` and absolute components so a request can't escape its root.
fn safe_join(root: &Path, rel: &str) -> Option<PathBuf> {
    let rel = Path::new(rel.trim_start_matches('/'));
    rel.components().all(|c| matches!(c, Component::Normal(_))).then(|| root.join(rel))
}

pub fn handle(req: Request<Vec<u8>>) -> Response<Cow<'static, [u8]>> {
    let path = req.uri().path().to_string();
    let path = percent_decode(&path);

    if let Some(name) = path.strip_prefix("/__render/") {
        // One-shot: a bounce is read once by the UI, then deleted.
        let Some(file) = safe_join(&fls_native::bounce::render_dir(), name) else {
            return respond(StatusCode::BAD_REQUEST, "text/plain", b"bad path".to_vec());
        };
        return match std::fs::read(&file) {
            Ok(bytes) => {
                let _ = std::fs::remove_file(&file);
                respond(StatusCode::OK, "application/octet-stream", bytes)
            }
            Err(_) => respond(StatusCode::NOT_FOUND, "text/plain", b"render not found".to_vec()),
        };
    }

    let root = dist_dir();
    let rel = if path == "/" || path.is_empty() { "index.html" } else { path.as_str() };
    let Some(file) = safe_join(&root, rel) else {
        return respond(StatusCode::BAD_REQUEST, "text/plain", b"bad path".to_vec());
    };
    match std::fs::read(&file) {
        Ok(bytes) => respond(StatusCode::OK, mime(&file), bytes),
        Err(_) => respond(StatusCode::NOT_FOUND, "text/plain", format!("not found: {rel}").into_bytes()),
    }
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(b) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}
