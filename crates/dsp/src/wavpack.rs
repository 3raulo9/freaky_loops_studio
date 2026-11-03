//! WavPack (lossless) decoder for sample libraries — browsers can't decode
//! `.wv`. Follows the published format: 32-byte `wvpk` block headers, then
//! metadata sub-blocks (decorrelation terms/weights/samples, entropy medians,
//! the bitstream). Each block is entropy-decoded with the adaptive median
//! coder and run back through its decorrelation passes.
//!
//! Supported: integer PCM, 8–32 bit, mono/stereo/multichannel, joint stereo,
//! false stereo. Not supported (returns an error): hybrid/lossy mode, float
//! and 32-bit-int extension data, DSD.

const MAX_TERM: usize = 8;
const LIMIT_ONES: u32 = 16;

const MONO_FLAG: u32 = 4;
const HYBRID_FLAG: u32 = 8;
const JOINT_STEREO: u32 = 0x10;
const FLOAT_DATA: u32 = 0x80;
const INITIAL_BLOCK: u32 = 0x800;
const FINAL_BLOCK: u32 = 0x1000;
const FALSE_STEREO: u32 = 0x4000_0000;
const DSD_FLAG: u32 = 0x8000_0000;
const MONO_DATA: u32 = MONO_FLAG | FALSE_STEREO;

const RATES: [u32; 15] = [6000, 8000, 9600, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000, 64000, 88200, 96000, 192000];

pub struct Decoded {
    pub channels: usize,
    pub sample_rate: u32,
    /// Planar, one Vec per channel, scaled to -1..1.
    pub data: Vec<Vec<f32>>,
}

fn exp2_table() -> [u32; 256] {
    let mut t = [0u32; 256];
    for (i, v) in t.iter_mut().enumerate() {
        *v = ((256.0 * (i as f64 / 256.0).exp2()).round() as u32).wrapping_sub(256) & 0xff;
    }
    t
}

fn exp2s(t: &[u32; 256], log: i32) -> i32 {
    if log < 0 {
        return -exp2s(t, -log);
    }
    let value = t[(log & 0xff) as usize] | 0x100;
    let e = log >> 8;
    if e <= 9 {
        (value >> (9 - e)) as i32
    } else {
        (value << (e - 9).min(31)) as i32
    }
}

#[derive(Clone, Copy, Default)]
struct Pass {
    term: i32,
    delta: i32,
    weight_a: i32,
    weight_b: i32,
    samples_a: [i32; MAX_TERM],
    samples_b: [i32; MAX_TERM],
}

struct Bits<'a> {
    d: &'a [u8],
    pos: usize,
    sr: u64,
    bc: u32,
}

impl<'a> Bits<'a> {
    fn new(d: &'a [u8]) -> Self {
        Bits { d, pos: 0, sr: 0, bc: 0 }
    }
    fn fill(&mut self, n: u32) {
        while self.bc < n {
            let b = if self.pos < self.d.len() { self.d[self.pos] } else { 0 };
            self.pos += 1;
            self.sr |= (b as u64) << self.bc;
            self.bc += 8;
        }
    }
    fn exhausted(&self) -> bool {
        self.pos > self.d.len() + 8
    }
    fn bit(&mut self) -> u32 {
        self.fill(1);
        let b = (self.sr & 1) as u32;
        self.sr >>= 1;
        self.bc -= 1;
        b
    }
    fn peek8(&mut self) -> u32 {
        self.fill(8);
        (self.sr & 0xff) as u32
    }
    fn skip(&mut self, n: u32) {
        self.fill(n);
        self.sr >>= n;
        self.bc -= n;
    }
    /// Read a value in 0..=maxcode with the near-uniform code.
    fn code(&mut self, maxcode: u32) -> u32 {
        if maxcode < 2 {
            return if maxcode == 1 { self.bit() } else { 0 };
        }
        let bitcount = 32 - maxcode.leading_zeros();
        let extras = ((1u64 << bitcount) - maxcode as u64 - 1) as u32;
        self.fill(bitcount);
        let mut code = (self.sr & ((1u64 << (bitcount - 1)) - 1)) as u32;
        let mut used = bitcount;
        if code >= extras {
            code = (code << 1) - extras + ((self.sr >> (bitcount - 1)) & 1) as u32;
        } else {
            used -= 1;
        }
        self.sr >>= used;
        self.bc -= used;
        code
    }
    /// The escape code used for long runs: unary length, then that many bits.
    fn elias(&mut self) -> Option<u32> {
        let mut cbits = 0;
        while cbits < 33 && self.bit() == 1 {
            cbits += 1;
        }
        if cbits == 33 {
            return None;
        }
        if cbits < 2 {
            return Some(cbits);
        }
        let mut v = 0u32;
        let mut mask = 1u32;
        for _ in 0..cbits - 1 {
            if self.bit() == 1 {
                v |= mask;
            }
            mask <<= 1;
        }
        Some(v | mask)
    }
}

#[derive(Default, Clone, Copy)]
struct Entropy {
    median: [u32; 3],
}

impl Entropy {
    fn get(&self, i: usize) -> u32 {
        (self.median[i] >> 4) + 1
    }
    fn inc(&mut self, i: usize) {
        let div = [128u32, 64, 32][i];
        self.median[i] = self.median[i].wrapping_add(((self.median[i] + div) / div) * 5);
    }
    fn dec(&mut self, i: usize) {
        let div = [128u32, 64, 32][i];
        self.median[i] = self.median[i].wrapping_sub(((self.median[i] + div - 2) / div) * 2);
    }
}

struct Words {
    c: [Entropy; 2],
    holding_zero: bool,
    holding_one: bool,
    zeros_acc: u32,
}

impl Words {
    /// One residual for channel `ch` (lossless mode), or None at end of data.
    fn get(&mut self, bs: &mut Bits, ch: usize) -> Option<i32> {
        if self.c[0].median[0] & !1 == 0 && !self.holding_zero && !self.holding_one && self.c[1].median[0] & !1 == 0 {
            if self.zeros_acc > 0 {
                self.zeros_acc -= 1;
                if self.zeros_acc > 0 {
                    return Some(0);
                }
            } else {
                self.zeros_acc = bs.elias()?;
                if self.zeros_acc > 0 {
                    self.c[0].median = [0; 3];
                    self.c[1].median = [0; 3];
                    return Some(0);
                }
            }
        }

        let ones: u32;
        if self.holding_zero {
            self.holding_zero = false;
            ones = 0;
        } else {
            let next8 = bs.peek8();
            let mut n;
            if next8 == 0xff {
                bs.skip(8);
                n = 8;
                while n < LIMIT_ONES + 1 && bs.bit() == 1 {
                    n += 1;
                }
                if n == LIMIT_ONES + 1 {
                    return None;
                }
                if n == LIMIT_ONES {
                    n = bs.elias()? + LIMIT_ONES;
                }
            } else {
                n = next8.trailing_ones();
                bs.skip(n + 1);
            }
            if self.holding_one {
                self.holding_one = n & 1 == 1;
                n = (n >> 1) + 1;
            } else {
                self.holding_one = n & 1 == 1;
                n >>= 1;
            }
            self.holding_zero = !self.holding_one;
            ones = n;
        }

        let c = &mut self.c[ch];
        let (low, high);
        if ones == 0 {
            low = 0;
            high = c.get(0) - 1;
            c.dec(0);
        } else {
            let mut l = c.get(0);
            c.inc(0);
            if ones == 1 {
                high = l + c.get(1) - 1;
                c.dec(1);
            } else {
                l += c.get(1);
                c.inc(1);
                if ones == 2 {
                    high = l + c.get(2) - 1;
                    c.dec(2);
                } else {
                    l = l.wrapping_add((ones - 2).wrapping_mul(c.get(2)));
                    high = l.wrapping_add(c.get(2) - 1);
                    c.inc(2);
                }
            }
            low = l;
        }
        let low = low & 0x7fff_ffff;
        let high = high & 0x7fff_ffff;
        let mid = bs.code(high.wrapping_sub(low)).wrapping_add(low);
        let sign = bs.bit();
        Some(if sign == 1 { !(mid as i32) } else { mid as i32 })
    }
}

#[inline]
fn apply_weight(w: i32, s: i32) -> i32 {
    // Same 32-bit arithmetic as the reference, wraparound included.
    if s != s as i16 as i32 {
        (((s & 0xffff).wrapping_mul(w) >> 9).wrapping_add(((s & !0xffff) >> 9).wrapping_mul(w)).wrapping_add(1)) >> 1
    } else {
        w.wrapping_mul(s).wrapping_add(512) >> 10
    }
}

#[inline]
fn update_weight(w: &mut i32, delta: i32, source: i32, result: i32) {
    if source != 0 && result != 0 {
        let s = (source ^ result) >> 31;
        *w = (delta ^ s).wrapping_add(w.wrapping_sub(s));
    }
}

#[inline]
fn update_weight_clip(w: &mut i32, delta: i32, source: i32, result: i32) {
    if source != 0 && result != 0 {
        let s = (source ^ result) >> 31;
        let mut x = (*w ^ s).wrapping_add(delta.wrapping_sub(s));
        if x > 1024 {
            x = 1024;
        }
        *w = (x ^ s).wrapping_sub(s);
    }
}

fn rotate(samples: &mut [i32; MAX_TERM], m: usize) {
    if m != 0 {
        let t = *samples;
        for k in 0..MAX_TERM {
            samples[k] = t[(m + k) & (MAX_TERM - 1)];
        }
    }
}

fn mono_pass(p: &mut Pass, buf: &mut [i32]) {
    match p.term {
        17 | 18 => {
            for x in buf.iter_mut() {
                let sam = if p.term == 17 { 2 * p.samples_a[0] - p.samples_a[1] } else { (3 * p.samples_a[0] - p.samples_a[1]) >> 1 };
                p.samples_a[1] = p.samples_a[0];
                p.samples_a[0] = apply_weight(p.weight_a, sam).wrapping_add(*x);
                update_weight(&mut p.weight_a, p.delta, sam, *x);
                *x = p.samples_a[0];
            }
        }
        t if t > 0 => {
            let (mut m, mut k) = (0usize, (t as usize) & (MAX_TERM - 1));
            for x in buf.iter_mut() {
                let sam = p.samples_a[m];
                p.samples_a[k] = apply_weight(p.weight_a, sam).wrapping_add(*x);
                update_weight(&mut p.weight_a, p.delta, sam, *x);
                *x = p.samples_a[k];
                m = (m + 1) & (MAX_TERM - 1);
                k = (k + 1) & (MAX_TERM - 1);
            }
            rotate(&mut p.samples_a, m);
        }
        _ => {}
    }
}

fn stereo_pass(p: &mut Pass, buf: &mut [i32]) {
    match p.term {
        17 | 18 => {
            let term = p.term;
            let pred = move |s: &[i32; MAX_TERM]| if term == 17 { 2 * s[0] - s[1] } else { (3 * s[0] - s[1]) >> 1 };
            for f in buf.chunks_exact_mut(2) {
                let sam = pred(&p.samples_a);
                p.samples_a[1] = p.samples_a[0];
                p.samples_a[0] = apply_weight(p.weight_a, sam).wrapping_add(f[0]);
                update_weight(&mut p.weight_a, p.delta, sam, f[0]);
                f[0] = p.samples_a[0];
                let sam = pred(&p.samples_b);
                p.samples_b[1] = p.samples_b[0];
                p.samples_b[0] = apply_weight(p.weight_b, sam).wrapping_add(f[1]);
                update_weight(&mut p.weight_b, p.delta, sam, f[1]);
                f[1] = p.samples_b[0];
            }
        }
        t if t > 0 => {
            let (mut m, mut k) = (0usize, (t as usize) & (MAX_TERM - 1));
            for f in buf.chunks_exact_mut(2) {
                let sam = p.samples_a[m];
                p.samples_a[k] = apply_weight(p.weight_a, sam).wrapping_add(f[0]);
                update_weight(&mut p.weight_a, p.delta, sam, f[0]);
                f[0] = p.samples_a[k];
                let sam = p.samples_b[m];
                p.samples_b[k] = apply_weight(p.weight_b, sam).wrapping_add(f[1]);
                update_weight(&mut p.weight_b, p.delta, sam, f[1]);
                f[1] = p.samples_b[k];
                m = (m + 1) & (MAX_TERM - 1);
                k = (k + 1) & (MAX_TERM - 1);
            }
            rotate(&mut p.samples_a, m);
            rotate(&mut p.samples_b, m);
        }
        -1 => {
            for f in buf.chunks_exact_mut(2) {
                let sam_a = f[0].wrapping_add(apply_weight(p.weight_a, p.samples_a[0]));
                update_weight_clip(&mut p.weight_a, p.delta, p.samples_a[0], f[0]);
                f[0] = sam_a;
                p.samples_a[0] = f[1].wrapping_add(apply_weight(p.weight_b, sam_a));
                update_weight_clip(&mut p.weight_b, p.delta, sam_a, f[1]);
                f[1] = p.samples_a[0];
            }
        }
        -2 => {
            for f in buf.chunks_exact_mut(2) {
                let sam_b = f[1].wrapping_add(apply_weight(p.weight_b, p.samples_b[0]));
                update_weight_clip(&mut p.weight_b, p.delta, p.samples_b[0], f[1]);
                f[1] = sam_b;
                p.samples_b[0] = f[0].wrapping_add(apply_weight(p.weight_a, sam_b));
                update_weight_clip(&mut p.weight_a, p.delta, sam_b, f[0]);
                f[0] = p.samples_b[0];
            }
        }
        -3 => {
            for f in buf.chunks_exact_mut(2) {
                let sam_a = f[0].wrapping_add(apply_weight(p.weight_a, p.samples_a[0]));
                update_weight_clip(&mut p.weight_a, p.delta, p.samples_a[0], f[0]);
                let sam_b = f[1].wrapping_add(apply_weight(p.weight_b, p.samples_b[0]));
                update_weight_clip(&mut p.weight_b, p.delta, p.samples_b[0], f[1]);
                p.samples_b[0] = sam_a;
                f[0] = sam_a;
                p.samples_a[0] = sam_b;
                f[1] = sam_b;
            }
        }
        _ => {}
    }
}

fn u32_at(b: &[u8], o: usize) -> Option<u32> {
    Some(u32::from_le_bytes(b.get(o..o + 4)?.try_into().ok()?))
}

/// Decode one block's samples: returns (interleaved ints, channels in block).
fn decode_block(t: &[u32; 256], block: &[u8], flags: u32, n: usize) -> Result<(Vec<i32>, usize), String> {
    if flags & HYBRID_FLAG != 0 {
        return Err("hybrid (lossy) WavPack is not supported".into());
    }
    if flags & (FLOAT_DATA | DSD_FLAG) != 0 {
        return Err("float/DSD WavPack is not supported".into());
    }
    let mono = flags & MONO_DATA != 0;
    let mut passes: Vec<Pass> = Vec::new();
    let mut words = Words { c: [Entropy::default(); 2], holding_zero: false, holding_one: false, zeros_acc: 0 };
    let mut bitstream: Option<&[u8]> = None;
    let mut have_entropy = false;

    let mut o = 32;
    while o + 2 <= block.len() {
        let id = block[o];
        let (mut size, hdr) = if id & 0x80 != 0 {
            let s = *block.get(o + 1).ok_or("truncated")? as usize | (*block.get(o + 2).ok_or("truncated")? as usize) << 8 | (*block.get(o + 3).ok_or("truncated")? as usize) << 16;
            (s * 2, 4)
        } else {
            (block[o + 1] as usize * 2, 2)
        };
        let data_start = o + hdr;
        let padded = size;
        if id & 0x40 != 0 {
            size = size.saturating_sub(1);
        }
        let d = block.get(data_start..data_start + size).ok_or("truncated sub-block")?;
        match id & 0x3f {
            0x2 => {
                // Terms: first byte belongs to the last pass.
                passes = vec![Pass::default(); d.len()];
                for (i, &b) in d.iter().enumerate() {
                    let p = &mut passes[d.len() - 1 - i];
                    p.term = (b & 0x1f) as i32 - 5;
                    p.delta = ((b >> 5) & 7) as i32;
                    if p.term == 0 || p.term < -3 || (p.term > MAX_TERM as i32 && p.term < 17) || p.term > 18 {
                        return Err("bad decorrelation term".into());
                    }
                }
            }
            0x3 => {
                let per = if mono { 1 } else { 2 };
                let count = d.len() / per;
                let restore = |w: u8| {
                    let mut r = (w as i8 as i32) << 3;
                    if r > 0 {
                        r += (r + 64) >> 7;
                    }
                    r
                };
                for (j, p) in passes.iter_mut().rev().take(count).enumerate() {
                    p.weight_a = restore(d[j * per]);
                    if !mono {
                        p.weight_b = restore(d[j * per + 1]);
                    }
                }
            }
            0x4 => {
                let mut i = 0;
                let rd = |i: &mut usize| -> i32 {
                    let v = if *i + 1 < d.len() { i16::from_le_bytes([d[*i], d[*i + 1]]) as i32 } else { 0 };
                    *i += 2;
                    exp2s(t, v)
                };
                for p in passes.iter_mut().rev() {
                    if i >= d.len() {
                        break;
                    }
                    if p.term > MAX_TERM as i32 {
                        p.samples_a[0] = rd(&mut i);
                        p.samples_a[1] = rd(&mut i);
                        if !mono {
                            p.samples_b[0] = rd(&mut i);
                            p.samples_b[1] = rd(&mut i);
                        }
                    } else if p.term < 0 {
                        p.samples_a[0] = rd(&mut i);
                        p.samples_b[0] = rd(&mut i);
                    } else {
                        for m in 0..p.term as usize {
                            p.samples_a[m] = rd(&mut i);
                            if !mono {
                                p.samples_b[m] = rd(&mut i);
                            }
                        }
                    }
                }
            }
            0x5 => {
                let rd = |i: usize| d.get(i..i + 2).map(|x| exp2s(t, u16::from_le_bytes([x[0], x[1]]) as i32) as u32).unwrap_or(0);
                for k in 0..3 {
                    words.c[0].median[k] = rd(k * 2);
                }
                if !mono {
                    for k in 0..3 {
                        words.c[1].median[k] = rd(6 + k * 2);
                    }
                }
                have_entropy = true;
            }
            0xa => bitstream = Some(d),
            0x9 if flags & 0x100 != 0 => return Err("32-bit integer WavPack is not supported".into()),
            _ => {}
        }
        o = data_start + padded;
    }

    let chans = if mono { 1 } else { 2 };
    let Some(bits) = bitstream else {
        // A block of silence carries no bitstream.
        return Ok((vec![0; n * chans], chans));
    };
    if !have_entropy {
        return Err("missing entropy data".into());
    }
    let mut bs = Bits::new(bits);
    let mut buf = vec![0i32; n * chans];
    for (i, x) in buf.iter_mut().enumerate() {
        let ch = if mono { 0 } else { i & 1 };
        match words.get(&mut bs, ch) {
            Some(v) => *x = v,
            None => break,
        }
        if bs.exhausted() {
            break;
        }
    }
    for p in passes.iter_mut() {
        if mono {
            mono_pass(p, &mut buf);
        } else {
            stereo_pass(p, &mut buf);
        }
    }
    if !mono && flags & JOINT_STEREO != 0 {
        for f in buf.chunks_exact_mut(2) {
            f[1] = f[1].wrapping_sub(f[0] >> 1);
            f[0] = f[0].wrapping_add(f[1]);
        }
    }
    let shift = (flags >> 13) & 0x1f;
    if shift > 0 {
        for x in buf.iter_mut() {
            *x = x.wrapping_shl(shift);
        }
    }
    Ok((buf, chans))
}

/// Decode a whole `.wv` file.
pub fn decode(file: &[u8]) -> Result<Decoded, String> {
    let t = exp2_table();
    let mut out: Vec<Vec<f32>> = Vec::new();
    let mut rate = 44100u32;
    let mut bits = 16u32;
    let mut frame: Vec<Vec<f32>> = Vec::new();
    let mut o = 0usize;
    let mut total: Option<usize> = None;
    while o + 32 <= file.len() {
        if &file[o..o + 4] != b"wvpk" {
            // Resync to the next block header.
            match file[o + 1..].windows(4).position(|w| w == b"wvpk") {
                Some(p) => {
                    o += 1 + p;
                    continue;
                }
                None => break,
            }
        }
        let size = u32_at(file, o + 4).ok_or("bad header")? as usize + 8;
        let block = file.get(o..o + size).ok_or("truncated block")?;
        let version = u16::from_le_bytes([block[8], block[9]]);
        if !(0x402..=0x410).contains(&version) {
            return Err(format!("unsupported WavPack version {version:#x}"));
        }
        if total.is_none() {
            let ts = u32_at(block, 12).unwrap_or(u32::MAX);
            if ts != u32::MAX {
                total = Some(ts as usize);
            }
        }
        let n = u32_at(block, 20).unwrap_or(0) as usize;
        let flags = u32_at(block, 24).unwrap_or(0);
        if n > 0 {
            // Only audio blocks carry the format (trailing metadata blocks have no flags).
            let ri = (flags >> 23) & 0xf;
            if (ri as usize) < RATES.len() {
                rate = RATES[ri as usize];
            } else if let Some(r) = custom_rate(block) {
                rate = r;
            }
            bits = ((flags & 3) + 1) * 8;
            let (pcm, chans) = decode_block(&t, block, flags, n)?;
            let scale = 1.0 / (1u64 << (bits - 1)) as f32;
            if flags & INITIAL_BLOCK != 0 {
                frame.clear();
            }
            for c in 0..chans {
                frame.push((0..n).map(|i| pcm[i * chans + c] as f32 * scale).collect());
            }
            if flags & FALSE_STEREO != 0 {
                let dup = frame.last().cloned().unwrap_or_default();
                frame.push(dup);
            }
            if flags & FINAL_BLOCK != 0 {
                if out.is_empty() {
                    out = vec![Vec::new(); frame.len()];
                }
                for (dst, src) in out.iter_mut().zip(frame.drain(..)) {
                    dst.extend_from_slice(&src);
                }
            }
        }
        o += size;
    }
    if out.is_empty() {
        return Err("no audio in WavPack file".into());
    }
    if let Some(t) = total {
        for c in out.iter_mut() {
            c.truncate(t);
        }
    }
    let _ = bits;
    Ok(Decoded { channels: out.len(), sample_rate: rate, data: out })
}

fn custom_rate(block: &[u8]) -> Option<u32> {
    let mut o = 32;
    while o + 2 <= block.len() {
        let id = block[o];
        let (size, hdr) = if id & 0x80 != 0 { ((block[o + 1] as usize | (block[o + 2] as usize) << 8 | (block[o + 3] as usize) << 16) * 2, 4) } else { (block[o + 1] as usize * 2, 2) };
        if id & 0x3f == 0x27 {
            let d = block.get(o + hdr..o + hdr + 3)?;
            return Some(d[0] as u32 | (d[1] as u32) << 8 | (d[2] as u32) << 16);
        }
        o += hdr + size;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exp2_matches_reference_points() {
        let t = exp2_table();
        assert_eq!(&t[..16], &[0x00, 0x01, 0x01, 0x02, 0x03, 0x03, 0x04, 0x05, 0x06, 0x06, 0x07, 0x08, 0x08, 0x09, 0x0a, 0x0b]);
        assert_eq!(t[255], 0xff);
        assert_eq!(exp2s(&t, 0), 0);
        assert_eq!(exp2s(&t, 9 << 8), 256);
        assert_eq!(exp2s(&t, -(9 << 8)), -256);
    }

    #[test]
    fn weights_and_codes() {
        assert_eq!(apply_weight(1024, 100), 100);
        assert_eq!(apply_weight(512, 100), 50);
        let d = [0b1010_1101u8, 0xff];
        let mut b = Bits::new(&d);
        assert_eq!(b.bit(), 1);
        assert_eq!(b.bit(), 0);
        assert_eq!(b.code(1), 1);
    }

    /// Bit-exact check against a reference decode (FLS_WV=<file.wv> and
    /// FLS_WV_PCM=<same, as raw s16le/s24le/s32le> made with any decoder).
    #[test]
    #[ignore]
    fn matches_reference_decode() {
        let wv = std::fs::read(std::env::var("FLS_WV").unwrap()).unwrap();
        let reference = std::fs::read(std::env::var("FLS_WV_PCM").unwrap()).unwrap();
        let bytes: usize = std::env::var("FLS_WV_BYTES").ok().and_then(|s| s.parse().ok()).unwrap_or(2);
        let d = decode(&wv).unwrap();
        let ch = d.channels;
        let frames = d.data[0].len();
        println!("{} ch, {} Hz, {} frames", ch, d.sample_rate, frames);
        let scale = (1u64 << (bytes * 8 - 1)) as f32;
        let mut mismatches = 0;
        for i in 0..frames.min(reference.len() / (bytes * ch)) {
            for c in 0..ch {
                let o = (i * ch + c) * bytes;
                let mut v: i32 = 0;
                for k in 0..bytes {
                    v |= (reference[o + k] as i32) << (8 * k);
                }
                v = (v << (32 - 8 * bytes)) >> (32 - 8 * bytes);
                let mine = (d.data[c][i] * scale).round() as i32;
                if mine != v {
                    if mismatches < 5 {
                        println!("frame {i} ch {c}: mine {mine} ref {v}");
                    }
                    mismatches += 1;
                }
            }
        }
        assert_eq!(reference.len() / (bytes * ch), frames, "frame count");
        assert_eq!(mismatches, 0);
    }
}
