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
