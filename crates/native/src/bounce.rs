//! Helpers for offline plugin bounces shared by the host and the bridge: the
//! note list wire format and the temp files PCM results travel through (a
//! bounce is far too large for a JSON line or a script string).

use crate::plugin::RenderNote;
use serde_json::Value;
use std::path::PathBuf;

/// Notes arrive as `[{p, v, s, e}]`: pitch, velocity, start/end frame.
pub fn parse_notes(v: &Value) -> Vec<RenderNote> {
    let int = |n: &Value, k: &str, d: i64| n.get(k).and_then(Value::as_f64).map(|x| x as i64).unwrap_or(d);
    v.as_array()
        .map(|a| {
            a.iter()
                .map(|n| RenderNote {
                    pitch: int(n, "p", 60) as i32,
                    velocity: int(n, "v", 100) as i32,
                    start_frame: int(n, "s", 0),
                    end_frame: int(n, "e", 0),
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Directory bounces are written to; the host serves files from it to the UI.
pub fn render_dir() -> PathBuf {
    let d = std::env::temp_dir().join("freakyloops-render");
    let _ = std::fs::create_dir_all(&d);
    d
}

/// Write interleaved stereo f32 PCM to a uniquely named file in `render_dir`
/// and return its file name.
pub fn write_pcm(tag: &str, pcm: &[f32]) -> std::io::Result<String> {
    let safe: String = tag.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').collect();
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let name = format!("{safe}-{}-{nanos}.f32", std::process::id());
    let mut bytes = Vec::with_capacity(pcm.len() * 4);
    for s in pcm {
        bytes.extend_from_slice(&s.to_le_bytes());
    }
    std::fs::write(render_dir().join(&name), bytes)?;
    Ok(name)
}

/// Interleaved stereo f32 PCM as a 32-bit float WAV file.
pub fn write_wav(path: &str, pcm: &[f32], rate: u32) -> std::io::Result<()> {
    let bytes = (pcm.len() * 4) as u32;
    let mut w = Vec::with_capacity(44 + bytes as usize);
    w.extend_from_slice(b"RIFF");
    w.extend_from_slice(&(36 + bytes).to_le_bytes());
    w.extend_from_slice(b"WAVEfmt ");
    w.extend_from_slice(&16u32.to_le_bytes());
    w.extend_from_slice(&3u16.to_le_bytes()); // IEEE float
    w.extend_from_slice(&2u16.to_le_bytes());
    w.extend_from_slice(&rate.to_le_bytes());
    w.extend_from_slice(&(rate * 8).to_le_bytes());
    w.extend_from_slice(&8u16.to_le_bytes());
    w.extend_from_slice(&32u16.to_le_bytes());
    w.extend_from_slice(b"data");
    w.extend_from_slice(&bytes.to_le_bytes());
    for v in pcm {
        w.extend_from_slice(&v.to_le_bytes());
    }
    std::fs::write(path, w)
}
