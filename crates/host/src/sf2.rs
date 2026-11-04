//! SoundFont 2 presets for the sound-font channel: one preset is resolved into
//! flat zones (key/velocity range, root key, tuning, loop, level, pan,
//! volume envelope) plus the mono samples those zones play. Only the preset
//! tables and the needed sample ranges are read — a 250 MB sound font costs a
//! few megabytes.

use serde_json::{json, Value};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};

// Generator operators (SF2 2.01, section 8.1.3).
const START_OFS: u16 = 0;
const END_OFS: u16 = 1;
const LOOP_START_OFS: u16 = 2;
const LOOP_END_OFS: u16 = 3;
const START_COARSE: u16 = 4;
const END_COARSE: u16 = 12;
const PAN: u16 = 17;
const DELAY_VOL: u16 = 33;
const ATTACK_VOL: u16 = 34;
const HOLD_VOL: u16 = 35;
const DECAY_VOL: u16 = 36;
const SUSTAIN_VOL: u16 = 37;
const RELEASE_VOL: u16 = 38;
const INSTRUMENT: u16 = 41;
const KEY_RANGE: u16 = 43;
const VEL_RANGE: u16 = 44;
const LOOP_START_COARSE: u16 = 45;
const ATTENUATION: u16 = 48;
const LOOP_END_COARSE: u16 = 50;
const COARSE_TUNE: u16 = 51;
const FINE_TUNE: u16 = 52;
const SAMPLE_ID: u16 = 53;
const SAMPLE_MODES: u16 = 54;
const SCALE_TUNING: u16 = 56;
const EXCLUSIVE: u16 = 57;
const ROOT_KEY: u16 = 58;

fn default_of(op: u16) -> i32 {
    match op {
        DELAY_VOL | ATTACK_VOL | HOLD_VOL | DECAY_VOL | RELEASE_VOL => -12000,
        SCALE_TUNING => 100,
        ROOT_KEY => -1,
        KEY_RANGE | VEL_RANGE => 127 << 8,
        _ => 0,
    }
}

/// Generator values of one zone (raw 16-bit amounts, ranges packed lo | hi << 8).
#[derive(Clone, Default)]
struct Gens(Vec<(u16, i32)>);

impl Gens {
    fn get(&self, op: u16) -> Option<i32> {
        self.0.iter().rev().find(|(o, _)| *o == op).map(|(_, v)| *v)
    }
    fn set(&mut self, op: u16, v: i32) {
        self.0.push((op, v));
    }
    /// Zone values over the global zone's.
    fn over(&self, global: &Gens) -> Gens {
        let mut g = global.clone();
        g.0.extend(self.0.iter().copied());
        g
    }
}

fn range(v: Option<i32>) -> (u8, u8) {
    match v {
        Some(r) => ((r & 0xff) as u8, ((r >> 8) & 0xff) as u8),
        None => (0, 127),
    }
}

struct Riff {
    file: File,
}

impl Riff {
    fn u32_at(b: &[u8], o: usize) -> u32 {
        u32::from_le_bytes(b[o..o + 4].try_into().unwrap())
    }

    /// Chunks under a LIST/RIFF body: (id, data offset, size).
    fn chunks(&mut self, start: u64, end: u64) -> Result<Vec<([u8; 4], u64, u32)>, String> {
        let mut out = Vec::new();
        let mut pos = start;
        let mut hdr = [0u8; 8];
        while pos + 8 <= end {
            self.file.seek(SeekFrom::Start(pos)).map_err(|e| e.to_string())?;
            self.file.read_exact(&mut hdr).map_err(|e| e.to_string())?;
            let id: [u8; 4] = hdr[..4].try_into().unwrap();
            let size = Self::u32_at(&hdr, 4);
            out.push((id, pos + 8, size));
            pos += 8 + size as u64 + (size as u64 & 1);
        }
        Ok(out)
    }

    fn read(&mut self, at: u64, len: usize) -> Result<Vec<u8>, String> {
        let mut b = vec![0u8; len];
        self.file.seek(SeekFrom::Start(at)).map_err(|e| e.to_string())?;
        self.file.read_exact(&mut b).map_err(|e| format!("truncated sound font: {e}"))?;
        Ok(b)
    }
}

struct Hydra {
    phdr: Vec<u8>,
    pbag: Vec<u8>,
    pgen: Vec<u8>,
    inst: Vec<u8>,
    ibag: Vec<u8>,
    igen: Vec<u8>,
    shdr: Vec<u8>,
}

fn u16_at(b: &[u8], o: usize) -> u16 {
    u16::from_le_bytes([b[o], b[o + 1]])
}

impl Hydra {
    /// Generators of each bag in `[from, to)` of a bag/gen table pair.
    fn zones(bags: &[u8], gens: &[u8], from: usize, to: usize) -> Vec<Gens> {
        (from..to)
            .filter_map(|bi| {
                let g0 = u16_at(bags, bi * 4) as usize;
                let g1 = if (bi + 1) * 4 + 2 <= bags.len() { u16_at(bags, (bi + 1) * 4) as usize } else { g0 };
                let mut z = Gens::default();
                for gi in g0..g1 {
                    if gi * 4 + 4 > gens.len() {
                        return None;
                    }
                    let op = u16_at(gens, gi * 4);
                    let raw = u16_at(gens, gi * 4 + 2);
                    let v = if op == KEY_RANGE || op == VEL_RANGE || op == INSTRUMENT || op == SAMPLE_ID { raw as i32 } else { raw as i16 as i32 };
                    z.set(op, v);
                }
                Some(z)
            })
            .collect()
    }

    fn presets(&self) -> Vec<(String, u16, u16, usize)> {
        let n = self.phdr.len() / 38;
        (0..n.saturating_sub(1))
            .map(|i| {
                let r = &self.phdr[i * 38..i * 38 + 38];
                let end = r[..20].iter().position(|&b| b == 0).unwrap_or(20);
                let name = String::from_utf8_lossy(&r[..end]).trim().to_string();
                (name, u16_at(r, 22), u16_at(r, 20), i)
            })
            .collect()
    }
}

/// One playable region, in the units the UI's player uses.
struct Zone {
    key: (u8, u8),
    vel: (u8, u8),
    sample: usize,
    root: i32,
    tune: i32,
    scale: i32,
    looping: bool,
    loop_start: u32,
    loop_end: u32,
    attenuation: i32,
    pan: i32,
    env: [i32; 6],
    exclusive: i32,
}

/// Resolve `program` (in `bank`, else any bank) of the sound font at `path`.
/// Returns the zones (JSON) and the samples, concatenated mono f32.
pub fn preset(path: &str, bank: u16, program: u16) -> Result<(Value, Vec<f32>), String> {
    let file = File::open(path).map_err(|e| format!("can't open {path}: {e}"))?;
    let len = file.metadata().map_err(|e| e.to_string())?.len();
    let mut r = Riff { file };
    let head = r.read(0, 12)?;
    if &head[..4] != b"RIFF" || &head[8..12] != b"sfbk" {
        return Err("not a SoundFont 2 file".into());
    }
    let mut smpl: Option<(u64, u32)> = None;
    let mut pdta: Option<(u64, u32)> = None;
    for (id, at, size) in r.chunks(12, len)? {
        if &id != b"LIST" {
            continue;
        }
        let kind = r.read(at, 4)?;
        if &kind == b"sdta" {
            for (cid, cat, csize) in r.chunks(at + 4, at + size as u64)? {
                if &cid == b"smpl" {
                    smpl = Some((cat, csize));
                }
            }
        } else if &kind == b"pdta" {
            pdta = Some((at + 4, size - 4));
        }
    }
    let (smpl_at, smpl_size) = smpl.ok_or("the sound font has no samples")?;
    let (pdta_at, pdta_size) = pdta.ok_or("the sound font has no presets")?;
    let mut tables = std::collections::HashMap::new();
    for (id, at, size) in r.chunks(pdta_at, pdta_at + pdta_size as u64)? {
        tables.insert(id, r.read(at, size as usize)?);
    }
    let take = |k: &[u8; 4]| tables.get(k).cloned().unwrap_or_default();
    let h = Hydra { phdr: take(b"phdr"), pbag: take(b"pbag"), pgen: take(b"pgen"), inst: take(b"inst"), ibag: take(b"ibag"), igen: take(b"igen"), shdr: take(b"shdr") };

    let presets = h.presets();
    if presets.is_empty() {
        return Err("the sound font has no presets".into());
    }
    // The preset asked for; the same program in another bank; else the first one.
    let pick = presets
        .iter()
        .find(|p| p.1 == bank && p.2 == program)
        .or_else(|| presets.iter().find(|p| p.2 == program))
        .or_else(|| presets.iter().min_by_key(|p| (p.1, p.2)))
        .unwrap();
    let (name, pbank, pprog, pi) = (pick.0.clone(), pick.1, pick.2, pick.3);
    let bag0 = u16_at(&h.phdr, pi * 38 + 24) as usize;
    let bag1 = u16_at(&h.phdr, (pi + 1) * 38 + 24) as usize;
    let pzones = Hydra::zones(&h.pbag, &h.pgen, bag0, bag1);
    let (pglobal, pzones): (Gens, Vec<Gens>) = match pzones.first() {
        Some(z) if z.get(INSTRUMENT).is_none() => (z.clone(), pzones[1..].to_vec()),
        _ => (Gens::default(), pzones),
    };

    let n_inst = h.inst.len() / 22;
    let n_shdr = h.shdr.len() / 46;
    let mut zones: Vec<Zone> = Vec::new();
    // (shdr index, start, end) → index into `samples`
    let mut sample_keys: Vec<(usize, u32, u32)> = Vec::new();
    for pz in &pzones {
        let Some(ii) = pz.get(INSTRUMENT).map(|v| v as usize).filter(|&i| i + 1 < n_inst) else { continue };
        let pz = pz.over(&pglobal);
        let ib0 = u16_at(&h.inst, ii * 22 + 20) as usize;
        let ib1 = u16_at(&h.inst, (ii + 1) * 22 + 20) as usize;
        let izones = Hydra::zones(&h.ibag, &h.igen, ib0, ib1);
        let (iglobal, izones): (Gens, Vec<Gens>) = match izones.first() {
            Some(z) if z.get(SAMPLE_ID).is_none() => (z.clone(), izones[1..].to_vec()),
            _ => (Gens::default(), izones),
        };
        for iz in &izones {
            let Some(si) = iz.get(SAMPLE_ID).map(|v| v as usize).filter(|&s| s + 1 < n_shdr) else { continue };
            let iz = iz.over(&iglobal);
            let (pk, iv) = (range(pz.get(KEY_RANGE)), range(iz.get(KEY_RANGE)));
            let (pv, ivv) = (range(pz.get(VEL_RANGE)), range(iz.get(VEL_RANGE)));
            let key = (pk.0.max(iv.0), pk.1.min(iv.1));
            let vel = (pv.0.max(ivv.0), pv.1.min(ivv.1));
            if key.0 > key.1 || vel.0 > vel.1 {
                continue;
            }
            // Instrument value (or default) plus the preset's offset.
            let g = |op: u16| iz.get(op).unwrap_or_else(|| default_of(op)) + pz.get(op).unwrap_or(0);
            let s = &h.shdr[si * 46..si * 46 + 46];
            let u32s = |o: usize| u32::from_le_bytes(s[o..o + 4].try_into().unwrap());
            let (start, end, lstart, lend, rate) = (u32s(20), u32s(24), u32s(28), u32s(32), u32s(36));
            let orig = s[40] as i32;
            let corr = s[41] as i8 as i32;
            let st = (start as i64 + g(START_OFS) as i64 + g(START_COARSE) as i64 * 32768).max(0) as u32;
            let en = (end as i64 + g(END_OFS) as i64 + g(END_COARSE) as i64 * 32768).max(st as i64 + 1) as u32;
            let ls = (lstart as i64 + g(LOOP_START_OFS) as i64 + g(LOOP_START_COARSE) as i64 * 32768).clamp(st as i64, en as i64) as u32;
            let le = (lend as i64 + g(LOOP_END_OFS) as i64 + g(LOOP_END_COARSE) as i64 * 32768).clamp(ls as i64, en as i64) as u32;
            if en as u64 * 2 > smpl_size as u64 || rate == 0 {
                continue;
            }
            let k = sample_keys.iter().position(|x| *x == (si, st, en)).unwrap_or_else(|| {
                sample_keys.push((si, st, en));
                sample_keys.len() - 1
            });
            let root_gen = g(ROOT_KEY);
            zones.push(Zone {
                key,
                vel,
                sample: k,
                root: if root_gen >= 0 && root_gen < 128 { root_gen } else { orig.clamp(0, 127) },
                tune: g(COARSE_TUNE) * 100 + g(FINE_TUNE) + corr,
                scale: g(SCALE_TUNING),
                looping: matches!(iz.get(SAMPLE_MODES).unwrap_or(0) & 3, 1 | 3),
                loop_start: ls - st,
                loop_end: le - st,
                attenuation: g(ATTENUATION).max(0),
                pan: g(PAN).clamp(-500, 500),
                env: [g(DELAY_VOL), g(ATTACK_VOL), g(HOLD_VOL), g(DECAY_VOL), g(SUSTAIN_VOL).clamp(0, 1440), g(RELEASE_VOL)],
                exclusive: g(EXCLUSIVE),
            });
        }
    }
    if zones.is_empty() {
        return Err(format!("preset \"{name}\" has no playable zones"));
    }

    let mut data: Vec<f32> = Vec::new();
    let mut samples = Vec::new();
    for &(si, st, en) in &sample_keys {
        let raw = r.read(smpl_at + st as u64 * 2, (en - st) as usize * 2)?;
        let off = data.len();
        data.extend(raw.chunks_exact(2).map(|b| i16::from_le_bytes([b[0], b[1]]) as f32 / 32768.0));
        let rate = u32::from_le_bytes(h.shdr[si * 46 + 36..si * 46 + 40].try_into().unwrap());
        samples.push(json!({ "offset": off, "frames": en - st, "rate": rate }));
    }
    let tc = |t: i32| if t <= -12000 { 0.0 } else { (2f64.powf(t as f64 / 1200.0) * 10000.0).round() / 10000.0 };
    let zj: Vec<Value> = zones
        .iter()
        .map(|z| {
            json!({
                "key": [z.key.0, z.key.1], "vel": [z.vel.0, z.vel.1], "sample": z.sample,
                "root": z.root, "tune": z.tune, "scale": z.scale,
                "loop": z.looping, "loopStart": z.loop_start, "loopEnd": z.loop_end,
                "attenuation": z.attenuation, "pan": z.pan, "exclusive": z.exclusive,
                // Seconds; sustain is an attenuation in centibels.
                "env": { "delay": tc(z.env[0]), "attack": tc(z.env[1]), "hold": tc(z.env[2]), "decay": tc(z.env[3]), "sustain": z.env[4], "release": tc(z.env[5]) },
            })
        })
        .collect();
    let info = json!({
        "name": name, "bank": pbank, "program": pprog,
        "presets": presets.len(), "zones": zj, "samples": samples,
    });
    Ok((info, data))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chunk(id: &[u8; 4], body: &[u8]) -> Vec<u8> {
        let mut b = id.to_vec();
        b.extend_from_slice(&(body.len() as u32).to_le_bytes());
        b.extend_from_slice(body);
        if body.len() % 2 == 1 {
            b.push(0);
        }
        b
    }
    fn list(kind: &[u8; 4], parts: &[Vec<u8>]) -> Vec<u8> {
        let mut body = kind.to_vec();
        for p in parts {
            body.extend_from_slice(p);
        }
        chunk(b"LIST", &body)
    }
    fn name20(s: &str) -> Vec<u8> {
        let mut b = s.as_bytes().to_vec();
        b.resize(20, 0);
        b
    }
    fn gen(op: u16, v: u16) -> Vec<u8> {
        [op.to_le_bytes(), v.to_le_bytes()].concat()
    }

    /// A one-preset font: global attenuation at the instrument level, two key
    /// ranges on one looping sample, a preset-level tuning offset.
    fn tiny_font() -> Vec<u8> {
        let pcm: Vec<u8> = (0..100i16).flat_map(|i| (i * 300).to_le_bytes()).collect();
        let mut phdr = Vec::new();
        for (name, prog, bag) in [("Lead", 5u16, 0u16), ("EOP", 0, 1)] {
            phdr.extend(name20(name));
            phdr.extend(prog.to_le_bytes());
            phdr.extend(0u16.to_le_bytes());
            phdr.extend(bag.to_le_bytes());
            phdr.extend([0u8; 12]);
        }
        let pbag = [0u16, 0, 2, 0].iter().flat_map(|v| v.to_le_bytes()).collect::<Vec<_>>();
        let pgen = [gen(COARSE_TUNE, 1), gen(INSTRUMENT, 0)].concat();
        let mut inst = Vec::new();
        for (name, bag) in [("Inst", 0u16), ("EOI", 3)] {
            inst.extend(name20(name));
            inst.extend(bag.to_le_bytes());
        }
        // bags: global (gen 0..1), zone A (1..4), zone B (4..7), terminal
        let ibag = [0u16, 0, 1, 0, 4, 0, 7, 0].iter().flat_map(|v| v.to_le_bytes()).collect::<Vec<_>>();
        let igen = [
            gen(ATTENUATION, 60),
            gen(KEY_RANGE, 0 | (59 << 8)), gen(SAMPLE_MODES, 1), gen(SAMPLE_ID, 0),
            gen(KEY_RANGE, 60 | (127 << 8)), gen(ROOT_KEY, 72), gen(SAMPLE_ID, 0),
        ]
        .concat();
        let mut shdr = Vec::new();
        for (name, start, end, ls, le) in [("S", 0u32, 100u32, 10u32, 90u32), ("EOS", 0, 0, 0, 0)] {
            shdr.extend(name20(name));
            for v in [start, end, ls, le, 44100] {
                shdr.extend(v.to_le_bytes());
            }
            shdr.extend([60u8, 0]);
            shdr.extend([0u8; 4]);
        }
        let body = [
            b"sfbk".to_vec(),
            list(b"INFO", &[chunk(b"ifil", &[2, 0, 1, 0])]),
            list(b"sdta", &[chunk(b"smpl", &pcm)]),
            list(b"pdta", &[chunk(b"phdr", &phdr), chunk(b"pbag", &pbag), chunk(b"pgen", &pgen), chunk(b"inst", &inst), chunk(b"ibag", &ibag), chunk(b"igen", &igen), chunk(b"shdr", &shdr)]),
        ]
        .concat();
        chunk(b"RIFF", &body)
    }

    #[test]
    fn resolves_a_preset_into_zones() {
        let path = std::env::temp_dir().join(format!("fls-sf2-test-{}.sf2", std::process::id()));
        std::fs::write(&path, tiny_font()).unwrap();
        let (info, data) = preset(path.to_str().unwrap(), 0, 5).unwrap();
        let _ = std::fs::remove_file(&path);
        assert_eq!(info["name"], "Lead");
        let z = info["zones"].as_array().unwrap();
        assert_eq!(z.len(), 2);
        assert_eq!(z[0]["key"], json!([0, 59]));
        assert_eq!(z[0]["loop"], true);
        assert_eq!(z[0]["attenuation"], 60, "instrument global zone applies");
        assert_eq!(z[0]["tune"], 100, "preset coarse tune adds a semitone");
        assert_eq!(z[0]["loopStart"], 10);
        assert_eq!(z[1]["root"], 72);
        // Both zones share the one sample.
        assert_eq!(info["samples"].as_array().unwrap().len(), 1);
        assert_eq!(data.len(), 100);
        assert!((data[1] - 300.0 / 32768.0).abs() < 1e-6);
        // Unknown program → falls back to the font's first preset.
        let path2 = std::env::temp_dir().join(format!("fls-sf2-test2-{}.sf2", std::process::id()));
        std::fs::write(&path2, tiny_font()).unwrap();
        assert_eq!(preset(path2.to_str().unwrap(), 0, 99).unwrap().0["name"], "Lead");
        let _ = std::fs::remove_file(&path2);
    }

    /// `FLS_SF2=<file> cargo test -p fls-host -- --ignored --nocapture sf2_real`
    #[test]
    #[ignore]
    fn sf2_real() {
        let p = std::env::var("FLS_SF2").expect("FLS_SF2");
        let prog: u16 = std::env::var("FLS_SF2_PROG").ok().and_then(|v| v.parse().ok()).unwrap_or(0);
        let t = std::time::Instant::now();
        let (info, data) = preset(&p, 0, prog).unwrap();
        println!("{} (bank {} prog {}) of {} presets: {} zones, {} samples, {:.1} MB, {:?}", info["name"], info["bank"], info["program"], info["presets"], info["zones"].as_array().unwrap().len(), info["samples"].as_array().unwrap().len(), data.len() as f64 * 4.0 / 1e6, t.elapsed());
    }
}
