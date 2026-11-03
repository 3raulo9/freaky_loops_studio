//! Append-only file log at %TEMP%\freakyloops.log for the native audio/VST
//! path. Logging must never fail the caller.

use std::io::Write;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

static GATE: Mutex<()> = Mutex::new(());

pub fn path() -> std::path::PathBuf {
    std::env::temp_dir().join("freakyloops.log")
}

pub fn write(msg: &str) {
    let _g = GATE.lock();
    let ms = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let secs = (ms / 1000) % 86_400;
    let line = format!("{:02}:{:02}:{:02}.{:03}  [{}] {msg}\n", secs / 3600, (secs / 60) % 60, secs % 60, ms % 1000, std::process::id());
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path()) {
        let _ = f.write_all(line.as_bytes());
    }
}
