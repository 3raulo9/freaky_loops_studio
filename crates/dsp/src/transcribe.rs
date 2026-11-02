//! Audio → MIDI transcription: onset detection, then either a pitch per note
//! (melody) or a drum class per hit (kick / snare / hat).

/// Onsets as sample positions: rectified energy rise over 10 ms frames, picked
/// as local peaks above an adaptive threshold, at least `min_gap_s` apart.
/// `sensitivity` 0..1 (higher finds quieter onsets).
pub fn detect_onsets(x: &[f32], sr: f64, sensitivity: f64, min_gap_s: f64) -> Vec<usize> {
    let hop = ((sr * 0.01) as usize).max(64);
    let n = x.len() / hop;
    if n < 3 {
        return Vec::new();
    }
    let energy: Vec<f64> = (0..n).map(|f| x[f * hop..(f + 1) * hop].iter().map(|&s| s as f64 * s as f64).sum::<f64>().sqrt()).collect();
    let flux: Vec<f64> = (0..n).map(|f| if f == 0 { energy[0] } else { (energy[f] - energy[f - 1]).max(0.0) }).collect();
    let peak = flux.iter().cloned().fold(0.0, f64::max);
    if peak <= 1e-9 {
        return Vec::new();
    }
    let floor = peak * (0.30 - 0.27 * sensitivity.clamp(0.0, 1.0));
    let min_gap = ((min_gap_s * sr) as usize / hop).max(1);
    let win = 6usize;
    let mut out: Vec<usize> = Vec::new();
    let mut last: Option<usize> = None;
    for f in 0..n - 1 {
        // Audio that starts loud has its onset in frame 0 (nothing before it).
        let prev = if f == 0 { 0.0 } else { flux[f - 1] };
        if flux[f] < floor || flux[f] < prev || flux[f] < flux[f + 1] {
            continue;
        }
        // Adaptive threshold: must stand out from the local average flux.
        let (lo, hi) = (f.saturating_sub(win), (f + win).min(n - 1));
        let local = flux[lo..=hi].iter().sum::<f64>() / (hi - lo + 1) as f64;
        if flux[f] < local * 1.5 {
            continue;
        }
        if let Some(l) = last {
            if f - l < min_gap {
                continue;
            }
        }
        // Step back to where the rise starts so the note isn't late — but not
        // into near-silence (resampler pre-ringing would pull the note early).
        let mut start = f;
        while start > 0 && energy[start - 1] < energy[start] && energy[start - 1] > energy[f] * 0.25 && f - start < 3 {
            start -= 1;
        }
        out.push(start * hop);
        last = Some(f);
    }
    out
}

/// Fundamental frequency of `x` by YIN (cumulative-mean-normalised difference),
/// searched between 40 Hz and 2 kHz. `None` when the frame isn't pitched.
pub fn yin_pitch(x: &[f32], sr: f64) -> Option<f64> {
    let max_lag = ((sr / 40.0) as usize).min(x.len() / 2);
    let min_lag = ((sr / 2000.0) as usize).max(2);
    if max_lag <= min_lag + 2 {
        return None;
    }
    let w = x.len() - max_lag;
    let mut d = vec![0f64; max_lag + 1];
    for tau in 1..=max_lag {
        let mut s = 0f64;
        for i in 0..w {
            let v = x[i] as f64 - x[i + tau] as f64;
            s += v * v;
        }
        d[tau] = s;
    }
    // Cumulative mean normalisation.
    let mut cmnd = vec![1f64; max_lag + 1];
    let mut running = 0f64;
    for tau in 1..=max_lag {
        running += d[tau];
        cmnd[tau] = if running > 0.0 { d[tau] * tau as f64 / running } else { 1.0 };
    }
    let threshold = 0.15;
    let mut tau = min_lag;
    while tau < max_lag {
        if cmnd[tau] < threshold {
            while tau + 1 < max_lag && cmnd[tau + 1] < cmnd[tau] {
                tau += 1;
            }
            break;
        }
        tau += 1;
    }
    if tau >= max_lag || cmnd[tau] >= threshold {
        return None;
    }
    // Parabolic interpolation around the minimum for sub-sample precision.
    let (a, b, c) = (cmnd[tau - 1], cmnd[tau], cmnd[tau + 1]);
    let denom = a - 2.0 * b + c;
    let shift = if denom.abs() > 1e-12 { 0.5 * (a - c) / denom } else { 0.0 };
    Some(sr / (tau as f64 + shift.clamp(-1.0, 1.0)))
}

fn rms(x: &[f32]) -> f64 {
    if x.is_empty() {
        return 0.0;
    }
    (x.iter().map(|&s| s as f64 * s as f64).sum::<f64>() / x.len() as f64).sqrt()
}

/// A transcribed note: sample positions, MIDI pitch (or drum class), velocity 0..1.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Note {
    pub start: usize,
    pub end: usize,
    pub key: i32,
    pub velocity: f32,
}

/// Monophonic melody: one note per onset, pitched by YIN on the body of the
/// note (skipping the attack), ended where the level falls away.
pub fn melody(x: &[f32], sr: f64, sensitivity: f64) -> Vec<Note> {
    let onsets = detect_onsets(x, sr, sensitivity, 0.06);
    let mut notes = Vec::new();
    let hop = (sr * 0.01) as usize;
    let mut peaks = Vec::new();
    for (i, &on) in onsets.iter().enumerate() {
        let next = onsets.get(i + 1).copied().unwrap_or(x.len());
        let body_start = (on + (sr * 0.025) as usize).min(next);
        let win = ((sr * 0.09) as usize).max(2048);
        let body_end = (body_start + win).min(next).min(x.len());
        if body_end <= body_start + 1024 {
            continue;
        }
        let Some(f0) = yin_pitch(&x[body_start..body_end], sr) else { continue };
        let key = (69.0 + 12.0 * (f0 / 440.0).log2()).round() as i32;
        if !(0..=127).contains(&key) {
            continue;
        }
        let level = rms(&x[on..body_end]);
        // Note end: first 10 ms frame below 15% of the note's level.
        let mut end = next;
        let mut p = body_start;
        while p + hop < next {
            if rms(&x[p..p + hop]) < level * 0.15 {
                end = p;
                break;
            }
            p += hop;
        }
        peaks.push(level);
        notes.push(Note { start: on, end: end.max(on + hop), key, velocity: level as f32 });
    }
    let loudest = peaks.iter().cloned().fold(1e-9, f64::max) as f32;
    for n in notes.iter_mut() {
        n.velocity = (0.35 + 0.65 * n.velocity / loudest).clamp(0.05, 1.0);
    }
    notes
}

pub const KICK: i32 = 0;
pub const SNARE: i32 = 1;
pub const HAT: i32 = 2;

/// Drum hits: each onset classified by where its first 60 ms of energy sits —
/// lows (kick), mids with noise (snare) or highs (hat).
pub fn drums(x: &[f32], sr: f64, sensitivity: f64) -> Vec<Note> {
    let onsets = detect_onsets(x, sr, sensitivity, 0.05);
    let span = (sr * 0.06) as usize;
    // One-pole coefficients for ~150 Hz and ~4 kHz splits.
    let a_lo = (-2.0 * std::f64::consts::PI * 150.0 / sr).exp();
    let a_hi = (-2.0 * std::f64::consts::PI * 4000.0 / sr).exp();
    let mut notes = Vec::new();
    let mut levels = Vec::new();
    for &on in &onsets {
        let end = (on + span).min(x.len());
        let (mut lp_lo, mut lp_hi) = (0f64, 0f64);
        let (mut e_lo, mut e_mid, mut e_hi) = (0f64, 0f64, 0f64);
        for &s in &x[on..end] {
            let s = s as f64;
            lp_lo = a_lo * lp_lo + (1.0 - a_lo) * s;
            lp_hi = a_hi * lp_hi + (1.0 - a_hi) * s;
            let (low, mid, high) = (lp_lo, lp_hi - lp_lo, s - lp_hi);
            e_lo += low * low;
            e_mid += mid * mid;
            e_hi += high * high;
        }
        let total = e_lo + e_mid + e_hi + 1e-12;
        let key = if e_lo / total > 0.45 {
            KICK
        } else if e_hi / total > 0.5 {
            HAT
        } else {
            SNARE
        };
        levels.push(total.sqrt());
        notes.push(Note { start: on, end, key, velocity: total.sqrt() as f32 });
    }
    let loudest = levels.iter().cloned().fold(1e-9, f64::max) as f32;
    for n in notes.iter_mut() {
        n.velocity = (0.3 + 0.7 * n.velocity / loudest).clamp(0.05, 1.0);
    }
    notes
}

#[cfg(test)]
mod tests {
    use super::*;
    const SR: f64 = 44100.0;

    fn tone(freq: f64, secs: f64) -> Vec<f32> {
        let n = (SR * secs) as usize;
        (0..n).map(|i| {
            let env = (1.0 - i as f64 / n as f64).max(0.0);
            ((2.0 * std::f64::consts::PI * freq * i as f64 / SR).sin() * 0.6 * env) as f32
        }).collect()
    }

    #[test]
    fn yin_finds_a440() {
        let x = tone(440.0, 0.2);
        let f = yin_pitch(&x[1000..5000], SR).unwrap();
        assert!((f - 440.0).abs() < 2.0, "{f}");
    }

    #[test]
    fn transcribes_a_three_note_melody() {
        let mut x = Vec::new();
        for f in [261.63, 329.63, 392.0] {
            x.extend(tone(f, 0.4));
            x.extend(vec![0f32; (SR * 0.1) as usize]);
        }
        let notes = melody(&x, SR, 0.5);
        let keys: Vec<i32> = notes.iter().map(|n| n.key).collect();
        assert_eq!(keys, vec![60, 64, 67], "{notes:?}");
    }

    #[test]
    fn classifies_kick_and_hat() {
        let mut x = vec![0f32; (SR * 1.0) as usize];
        // Kick: 55 Hz thump at 0.1 s. Hat: bright noise burst at 0.6 s.
        for i in 0..4000 {
            let t = i as f64 / SR;
            x[4410 + i] = ((2.0 * std::f64::consts::PI * 55.0 * t).sin() * (1.0 - i as f64 / 4000.0)) as f32 * 0.9;
        }
        let mut seed = 1u32;
        for i in 0..2000 {
            seed ^= seed << 13; seed ^= seed >> 17; seed ^= seed << 5;
            let noise = seed as f64 / u32::MAX as f64 * 2.0 - 1.0;
            let hp = if i % 2 == 0 { noise } else { -noise };
            x[26460 + i] = (hp * (1.0 - i as f64 / 2000.0) * 0.5) as f32;
        }
        let hits = drums(&x, SR, 0.5);
        let keys: Vec<i32> = hits.iter().map(|n| n.key).collect();
        assert_eq!(keys, vec![KICK, HAT], "{hits:?}");
    }
}
