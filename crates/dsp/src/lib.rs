//! Offline DSP for Freaky Loops Studio: pitch-preserving time-stretch (WSOLA and
//! granular) and tempo detection. Compiled to WebAssembly and called from
//! `src/audio/dsp.js`; the same functions are usable natively.
//!
//! The arithmetic deliberately mirrors the JavaScript reference implementation
//! (`src/audio/warp.js`): f32 storage with f64 intermediate sums, so results
//! match it sample for sample.

pub mod ffi;
pub mod transcribe;
pub mod wavpack;

use std::f64::consts::PI;

fn hann(n: usize) -> Vec<f32> {
    let d = (n.max(2) - 1) as f64;
    (0..n).map(|i| (0.5 - 0.5 * (2.0 * PI * i as f64 / d).cos()) as f32).collect()
}

/// Average planar channels into one (f32 storage, like a Float32Array).
fn mixdown(channels: &[&[f32]]) -> Vec<f32> {
    let len = channels[0].len();
    let mut out = vec![0f32; len];
    for ch in channels {
        for (o, &s) in out.iter_mut().zip(ch.iter()) {
            *o = (*o as f64 + s as f64) as f32;
        }
    }
    if channels.len() > 1 {
        let n = channels.len() as f64;
        for o in out.iter_mut() {
            *o = (*o as f64 / n) as f32;
        }
    }
    out
}

/// Output length of a stretch by `ratio` for a given frame size.
pub fn stretched_len(in_len: usize, ratio: f64, frame: usize) -> usize {
    frame.max((in_len as f64 * ratio).floor() as usize + frame)
}

/// Waveform-similarity overlap-add time-stretch. `input` holds planar channels;
/// returns planar output channels of `stretched_len(.., frame)` samples.
pub fn wsola(input: &[&[f32]], ratio: f64, frame: usize, overlap: usize, tol: i64) -> Vec<Vec<f32>> {
    let in_len = input[0].len();
    let mono_owned;
    let mono: &[f32] = if input.len() > 1 {
        mono_owned = mixdown(input);
        &mono_owned
    } else {
        input[0]
    };

    let syn_hop = (frame / overlap.max(1)).max(1);
    let ana_hop = ((syn_hop as f64 / ratio).round() as i64).max(1);
    let win = hann(frame);
    let out_len = stretched_len(in_len, ratio, frame);
    let mut out: Vec<Vec<f32>> = input.iter().map(|_| vec![0f32; out_len]).collect();
    let mut norm = vec![0f32; out_len];

    let in_len_i = in_len as i64;
    let corr = |a: i64, b: i64| -> f64 {
        let mut sum = 0f64;
        let mut i = 0i64;
        while i < frame as i64 {
            let (ia, ib) = (a + i, b + i);
            if ia >= 0 && ib >= 0 && ia < in_len_i && ib < in_len_i {
                sum += mono[ia as usize] as f64 * mono[ib as usize] as f64;
            }
            i += 2;
        }
        sum
    };

    let mut ana_idx: i64 = 0;
    let mut syn_pos: usize = 0;
    let mut delta: i64 = 0;
    while syn_pos + frame < out_len && ana_idx < in_len_i {
        let read_idx = ana_idx + delta;
        for i in 0..frame {
            let ri = read_idx + i as i64;
            if ri < 0 || ri >= in_len_i {
                continue;
            }
            let w = win[i] as f64;
            for (c, ch) in input.iter().enumerate() {
                let o = &mut out[c][syn_pos + i];
                *o = (*o as f64 + ch[ri as usize] as f64 * w) as f32;
            }
            norm[syn_pos + i] = (norm[syn_pos + i] as f64 + w) as f32;
        }
        let natural = read_idx + syn_hop as i64;
        ana_idx += ana_hop;
        let (mut best, mut best_delta) = (f64::NEG_INFINITY, 0i64);
        let mut d = -tol;
        while d <= tol {
            let score = corr(ana_idx + d, natural);
            if score > best {
                best = score;
                best_delta = d;
            }
            d += 2;
        }
        delta = best_delta;
        syn_pos += syn_hop;
    }
    normalize(&mut out, &norm);
    out
}

fn normalize(out: &mut [Vec<f32>], norm: &[f32]) {
    for ch in out.iter_mut() {
        for (s, &n) in ch.iter_mut().zip(norm.iter()) {
            if n > 1e-4 {
                *s = (*s as f64 / n as f64) as f32;
            }
        }
    }
}

/// Small deterministic PRNG for grain jitter (xorshift32).
struct Rng(u32);
impl Rng {
    fn next_f64(&mut self) -> f64 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        self.0 = x;
        x as f64 / u32::MAX as f64
    }
}

/// Granular smear stretch (texture mode): 75%-overlapping Hann grains read
/// around the mapped position with random `jitter` (in samples).
pub fn granular(input: &[&[f32]], ratio: f64, grain: usize, jitter: f64, seed: u32) -> Vec<Vec<f32>> {
    let in_len = input[0].len();
    let syn_hop = (grain / 4).max(1);
    let win = hann(grain);
    let out_len = stretched_len(in_len, ratio, grain);
    let mut out: Vec<Vec<f32>> = input.iter().map(|_| vec![0f32; out_len]).collect();
    let mut norm = vec![0f32; out_len];
    let mut rng = Rng(seed.max(1));
    let mut syn_pos = 0usize;
    while syn_pos + grain < out_len {
        let base = syn_pos as f64 / ratio;
        let jit = (rng.next_f64() * 2.0 - 1.0) * jitter;
        let mut read = (base + jit).floor() as i64;
        if read < 0 {
            read = 0;
        }
        if read + grain as i64 >= in_len as i64 {
            read = (in_len as i64 - grain as i64 - 1).max(0);
        }
        for i in 0..grain {
            let ri = read as usize + i;
            if ri >= in_len {
                continue;
            }
            let w = win[i] as f64;
            for (c, ch) in input.iter().enumerate() {
                let o = &mut out[c][syn_pos + i];
                *o = (*o as f64 + ch[ri] as f64 * w) as f32;
            }
            norm[syn_pos + i] = (norm[syn_pos + i] as f64 + w) as f32;
        }
        syn_pos += syn_hop;
    }
    normalize(&mut out, &norm);
    out
}

/// Tempo from onset-envelope autocorrelation, octave-folded into 80..170 BPM.
/// Returns `None` when the material has no clear pulse.
pub fn detect_bpm(input: &[&[f32]], sample_rate: f64, min_bpm: f64, max_bpm: f64) -> Option<f64> {
    let len = input[0].len();
    let mono_owned;
    let mono: &[f32] = if input.len() > 1 {
        mono_owned = mixdown(input);
        &mono_owned
    } else {
        input[0]
    };
    let (hop, frame) = (512usize, 1024usize);
    if len < frame {
        return None;
    }
    let n_frames = (len - frame) / hop;
    if n_frames < 8 {
        return None;
    }
    let mut env = vec![0f32; n_frames];
    let mut prev_e = 0f64;
    for (f, e_out) in env.iter_mut().enumerate() {
        let start = f * hop;
        let mut e = 0f64;
        for &s in &mono[start..start + frame] {
            e += s as f64 * s as f64;
        }
        *e_out = (e - prev_e).max(0.0) as f32;
        prev_e = e;
    }
    // High-pass the envelope against its local mean (computed back to front,
    // in place, exactly like the reference).
    let win = 16usize;
    for f in (0..n_frames).rev() {
        let (lo, hi) = (f.saturating_sub(win), (f + win).min(n_frames - 1));
        let mut m = 0f64;
        for &v in &env[lo..=hi] {
            m += v as f64;
        }
        let cnt = (hi - lo + 1) as f64;
        env[f] = (env[f] as f64 - m / cnt).max(0.0) as f32;
    }

    let fps = sample_rate / hop as f64;
    let min_lag = (fps * 60.0 / max_bpm).floor() as usize;
    let max_lag = (fps * 60.0 / min_bpm).ceil() as usize;
    if max_lag <= min_lag || max_lag >= n_frames {
        return None;
    }
    let (mut best_lag, mut best_score) = (min_lag, f64::NEG_INFINITY);
    for lag in min_lag..=max_lag {
        let mut sum = 0f64;
        for f in 0..n_frames - lag {
            sum += env[f] as f64 * env[f + lag] as f64;
        }
        if sum > best_score {
            best_score = sum;
            best_lag = lag;
        }
    }
    if best_score <= 0.0 {
        return None;
    }
    let mut bpm = fps * 60.0 / best_lag as f64;
    while bpm < 80.0 {
        bpm *= 2.0;
    }
    while bpm > 170.0 {
        bpm /= 2.0;
    }
    Some((bpm * 10.0).round() / 10.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn click_track(bpm: f64, sr: f64, secs: f64) -> Vec<f32> {
        let len = (sr * secs) as usize;
        let period = (60.0 / bpm * sr) as usize;
        (0..len).map(|i| if i % period < 200 { ((i % 50) as f32 / 25.0 - 1.0) * 0.8 } else { 0.0 }).collect()
    }

    #[test]
    fn detects_a_click_track_tempo() {
        let x = click_track(120.0, 44100.0, 8.0);
        let bpm = detect_bpm(&[&x], 44100.0, 70.0, 180.0).unwrap();
        assert!((bpm - 120.0).abs() < 2.0, "got {bpm}");
    }

    #[test]
    fn stretch_changes_length_not_level() {
        let x: Vec<f32> = (0..44100).map(|i| (i as f32 * 0.05).sin() * 0.5).collect();
        let y = wsola(&[&x], 1.5, 2048, 4, 512);
        assert_eq!(y[0].len(), stretched_len(x.len(), 1.5, 2048));
        let peak = y[0][4096..y[0].len() - 4096].iter().fold(0f32, |m, s| m.max(s.abs()));
        assert!((peak - 0.5).abs() < 0.05, "peak {peak}");
        let g = granular(&[&x, &x], 0.75, 4096, 882.0, 7);
        assert_eq!(g.len(), 2);
    }
}
