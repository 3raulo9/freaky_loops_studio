//! C ABI for the WebAssembly build. JS allocates buffers in linear memory with
//! `fls_alloc`, writes planar f32 channels, calls a function, reads the result
//! and frees everything with `fls_free`. No bindings generator needed.

use std::alloc::{alloc, dealloc, Layout};

fn layout(n: usize) -> Layout {
    Layout::array::<f32>(n.max(1)).expect("buffer too large")
}

#[no_mangle]
pub extern "C" fn fls_alloc(n_floats: usize) -> *mut f32 {
    unsafe { alloc(layout(n_floats)) as *mut f32 }
}

/// # Safety
/// `ptr` must come from `fls_alloc(n_floats)` with the same count.
#[no_mangle]
pub unsafe extern "C" fn fls_free(ptr: *mut f32, n_floats: usize) {
    if !ptr.is_null() {
        dealloc(ptr as *mut u8, layout(n_floats));
    }
}

#[no_mangle]
pub extern "C" fn fls_stretched_len(in_len: usize, ratio: f64, frame: usize) -> usize {
    crate::stretched_len(in_len, ratio, frame)
}

unsafe fn channels<'a>(ptr: *const f32, n_ch: usize, len: usize) -> Vec<&'a [f32]> {
    (0..n_ch).map(|c| std::slice::from_raw_parts(ptr.add(c * len), len)).collect()
}

unsafe fn write_out(out_ptr: *mut f32, out_len: usize, result: &[Vec<f32>]) {
    for (c, ch) in result.iter().enumerate() {
        let dst = std::slice::from_raw_parts_mut(out_ptr.add(c * out_len), out_len);
        let n = ch.len().min(out_len);
        dst[..n].copy_from_slice(&ch[..n]);
        dst[n..].fill(0.0);
    }
}

/// # Safety
/// `in_ptr` holds `n_ch * in_len` floats; `out_ptr` holds `n_ch * out_len`.
#[no_mangle]
pub unsafe extern "C" fn fls_wsola(
    in_ptr: *const f32, n_ch: usize, in_len: usize, ratio: f64, frame: usize, overlap: usize, tol: i32,
    out_ptr: *mut f32, out_len: usize,
) {
    let input = channels(in_ptr, n_ch, in_len);
    let result = crate::wsola(&input, ratio, frame, overlap, tol as i64);
    write_out(out_ptr, out_len, &result);
}

/// # Safety
/// Same buffer contract as `fls_wsola`.
#[no_mangle]
pub unsafe extern "C" fn fls_granular(
    in_ptr: *const f32, n_ch: usize, in_len: usize, ratio: f64, grain: usize, jitter: f64, seed: u32,
    out_ptr: *mut f32, out_len: usize,
) {
    let input = channels(in_ptr, n_ch, in_len);
    let result = crate::granular(&input, ratio, grain, jitter, seed);
    write_out(out_ptr, out_len, &result);
}

/// Returns the tempo, or 0 when none was found.
///
/// # Safety
/// `in_ptr` holds `n_ch * len` floats.
#[no_mangle]
pub unsafe extern "C" fn fls_detect_bpm(in_ptr: *const f32, n_ch: usize, len: usize, sample_rate: f64, min_bpm: f64, max_bpm: f64) -> f64 {
    let input = channels(in_ptr, n_ch, len);
    crate::detect_bpm(&input, sample_rate, min_bpm, max_bpm).unwrap_or(0.0)
}

/// Transcribe mono audio to notes. `mode` 0 = melody (key = MIDI pitch),
/// 1 = drums (key = 0 kick / 1 snare / 2 hat). Writes up to `max_notes` records
/// of 4 floats [start_sample, end_sample, key, velocity] and returns the count.
///
/// # Safety
/// `in_ptr` holds `len` floats; `out_ptr` holds `max_notes * 4` floats.
#[no_mangle]
pub unsafe extern "C" fn fls_transcribe(
    in_ptr: *const f32, len: usize, sample_rate: f64, mode: u32, sensitivity: f64, out_ptr: *mut f32, max_notes: usize,
) -> usize {
    let x = std::slice::from_raw_parts(in_ptr, len);
    let notes = if mode == 1 {
        crate::transcribe::drums(x, sample_rate, sensitivity)
    } else {
        crate::transcribe::melody(x, sample_rate, sensitivity)
    };
    let out = std::slice::from_raw_parts_mut(out_ptr, max_notes * 4);
    let n = notes.len().min(max_notes);
    for (i, note) in notes.iter().take(n).enumerate() {
        out[i * 4] = note.start as f32;
        out[i * 4 + 1] = note.end as f32;
        out[i * 4 + 2] = note.key as f32;
        out[i * 4 + 3] = note.velocity;
    }
    n
}

// ── Project import ───────────────────────────────────────────────────────────

fn byte_layout(n: usize) -> Layout {
    Layout::array::<u8>(n.max(1)).expect("buffer too large")
}

#[no_mangle]
pub extern "C" fn fls_alloc_bytes(n: usize) -> *mut u8 {
    unsafe { alloc(byte_layout(n)) }
}

/// # Safety
/// `ptr` must come from `fls_alloc_bytes(n)` with the same count.
#[no_mangle]
pub unsafe extern "C" fn fls_free_bytes(ptr: *mut u8, n: usize) {
    if !ptr.is_null() {
        dealloc(ptr, byte_layout(n));
    }
}

static RESULT: std::sync::Mutex<Vec<u8>> = std::sync::Mutex::new(Vec::new());

/// Parse a pattern-project file held in `len` bytes at `ptr`. The JSON result
/// (or `{"error": …}`) is kept until the next call; read it through
/// `fls_result_ptr` and the returned length.
///
/// # Safety
/// `ptr` holds `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn fls_parse_project(ptr: *const u8, len: usize) -> usize {
    let bytes = std::slice::from_raw_parts(ptr, len);
    let json = match fls_projfile::parse(bytes) {
        Ok(p) => p.to_json(),
        Err(e) => format!("{{\"error\":{:?}}}", e),
    };
    let mut r = RESULT.lock().unwrap_or_else(|e| e.into_inner());
    *r = json.into_bytes();
    r.len()
}

#[no_mangle]
pub extern "C" fn fls_result_ptr() -> *const u8 {
    RESULT.lock().map(|r| r.as_ptr()).unwrap_or(std::ptr::null())
}

/// Decode a WavPack file. On success the result buffer holds
/// `[channels u32, sample rate u32, frames u32, planar f32 samples…]` and the
/// return value is its length in bytes; 0 means unsupported/corrupt.
///
/// # Safety
/// `ptr` holds `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn fls_decode_wavpack(ptr: *const u8, len: usize) -> usize {
    let bytes = std::slice::from_raw_parts(ptr, len);
    let mut r = RESULT.lock().unwrap_or_else(|e| e.into_inner());
    r.clear();
    let Ok(d) = crate::wavpack::decode(bytes) else { return 0 };
    let frames = d.data.first().map_or(0, Vec::len);
    r.reserve(12 + d.channels * frames * 4);
    r.extend_from_slice(&(d.channels as u32).to_le_bytes());
    r.extend_from_slice(&d.sample_rate.to_le_bytes());
    r.extend_from_slice(&(frames as u32).to_le_bytes());
    for ch in &d.data {
        for x in ch {
            r.extend_from_slice(&x.to_le_bytes());
        }
    }
    r.len()
}
