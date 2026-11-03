//! Writer: the original file, re-emitted with the app's edits applied.
//!
//! An imported project keeps its original bytes. Saving back walks that
//! event stream and copies every event verbatim unless an edit names it, so
//! everything the app doesn't model — built-in plugin presets, effect slots,
//! window layouts, controllers — comes back untouched, and a project saved
//! without edits is byte-for-byte the file that was opened.
//!
//! Edits (JSON) name entities by the file's own ids — channels and patterns
//! by iid, mixer inserts by index, arrangements by iid — and carry values in
//! the file's units (ticks at the file's PPQ, 0..1 levels, -1..1 pan):
//!
//! ```text
//! { tempo, timeSig: [n, d],
//!   channels:       { "<iid>": { name, color, volume, pan, mixer, enabled, sample, state } },
//!   deleteChannels: [iid],
//!   newChannels:    [{ kind: "sampler" | "vst", name, color, volume, pan, mixer, sample,
//!                      vst: { path, name, vendor, fourcc, guid, state } }],
//!   patterns:       { "<iid>": { name, color, length, notes: { keep: [iid], rows: [row] } } },
//!   newPatterns:    [{ iid, name, color, length, rows: [row] }],
//!   deletePatterns: [iid],
//!   arrangement:    { iid, items: [ { o: k } | [pos, len, track, kind, ref, start, end, muted, o] ] },
//!   inserts:        { "<index>": { name, color, volume, pan, muted } } }
//! ```
//!
//! A note row is `[channel, pos, len, key, velocity, pan, fine, release, slide,
//! modX, modY]`; `channel` is a file iid, or `-1 - k` for `newChannels[k]`.
//! States are the host's tagged form (`C` chunk / `P` params / `3` VST3).
//! In an arrangement, `{ o: k }` keeps original item `k` as it was.

use super::*;
use crate::events::{DATA, DWORD, TEXT, WORD};
use serde_json::Value;
use std::collections::{HashMap, HashSet};

// Events only the writer needs.
const E_PAT_CTRL: u8 = DATA + 15;
const E_PAT_CHANNEL: u8 = DWORD + 32;
const E_PAT_CHANNEL_NEXT: u8 = DWORD + 33;

/// One event as it sits in the file: `raw` is its full encoding.
struct Raw<'a> {
    id: u8,
    raw: &'a [u8],
    data: &'a [u8],
    int: u32,
}

/// The event stream with each event's encoding, plus any bytes after the
/// last complete event (kept as they are).
fn raw_events(b: &[u8]) -> (Vec<Raw<'_>>, &[u8]) {
    let mut out = Vec::new();
    let mut i = 0;
    loop {
        let start = i;
        let Some(&id) = b.get(i) else { break };
        i += 1;
        let (data, int): (&[u8], u32) = if id < WORD {
            let Some(&v) = b.get(i) else { i = start; break };
            i += 1;
            (&[], v as u32)
        } else if id < DWORD {
            let Some(v) = u16_at(b, i) else { i = start; break };
            i += 2;
            (&[], v as u32)
        } else if id < TEXT {
            let Some(v) = u32_at(b, i) else { i = start; break };
            i += 4;
            (&[], v)
        } else {
            let mut n: usize = 0;
            let mut shift = 0;
            let mut ok = true;
            loop {
                let Some(&c) = b.get(i) else { ok = false; break };
                i += 1;
                n |= ((c & 0x7f) as usize) << shift;
                shift += 7;
                if c & 0x80 == 0 || shift > 28 {
                    break;
                }
            }
            match (ok, i.checked_add(n).and_then(|end| b.get(i..end))) {
                (true, Some(d)) => {
                    i += n;
                    (d, 0)
                }
                _ => {
                    i = start;
                    break;
                }
            }
        };
        out.push(Raw { id, raw: &b[start..i], data, int });
    }
    (out, &b[i..])
}

fn enc_int(id: u8, v: u32) -> Vec<u8> {
    let mut o = vec![id];
    if id < WORD {
        o.push(v as u8);
    } else if id < DWORD {
        o.extend_from_slice(&(v as u16).to_le_bytes());
    } else {
        o.extend_from_slice(&v.to_le_bytes());
    }
    o
}

fn enc_data(id: u8, d: &[u8]) -> Vec<u8> {
    let mut o = vec![id];
    let mut n = d.len();
    loop {
        let mut c = (n & 0x7f) as u8;
        n >>= 7;
        if n > 0 {
            c |= 0x80;
        }
        o.push(c);
        if n == 0 {
            break;
        }
    }
    o.extend_from_slice(d);
    o
}

fn enc_text(id: u8, s: &str, unicode: bool) -> Vec<u8> {
    let d: Vec<u8> = if unicode {
        s.encode_utf16().chain([0]).flat_map(|u| u.to_le_bytes()).collect()
    } else {
        s.chars().map(|c| if (c as u32) < 256 { c as u8 } else { b'?' }).chain([0]).collect()
    };
    enc_data(id, &d)
}

/// `#rrggbb` → the file's 0x00BBGGRR.
fn color_value(v: &Value) -> Option<u32> {
    let s = v.as_str()?.trim_start_matches('#');
    if s.len() != 6 {
        return None;
    }
    let n = u32::from_str_radix(s, 16).ok()?;
    Some(((n & 0xff) << 16) | (n & 0xff00) | ((n >> 16) & 0xff))
}

fn b64(s: &str) -> Option<Vec<u8>> {
    let val = |c: u8| -> Option<u32> {
        Some(match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            _ => return None,
        } as u32)
    };
    let clean: Vec<u8> = s.bytes().filter(|c| !c.is_ascii_whitespace() && *c != b'=').collect();
    let mut out = Vec::with_capacity(clean.len() * 3 / 4);
    for chunk in clean.chunks(4) {
        let mut acc = 0u32;
        for (k, &c) in chunk.iter().enumerate() {
            acc |= val(c)? << (18 - 6 * k);
        }
        let bytes = acc.to_be_bytes();
        out.extend_from_slice(&bytes[1..chunk.len()]);
    }
    Some(out)
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Owner {
    Global,
    Channel(u16),
    Pattern(u16),
    Arr(u16),
    Insert(usize),
}

/// Who each event belongs to, following the reader's rules: "new channel",
/// "new pattern" and "new arrangement" open their entity; a mixer insert runs
/// from its flags event to its output event.
fn owners(evs: &[Raw]) -> Vec<Owner> {
    let mut cur = Owner::Global;
    let mut ins = 0usize;
    let mut out = Vec::with_capacity(evs.len());
    for e in evs {
        match e.id {
            E_CH_NEW => cur = Owner::Channel(e.int as u16),
            E_PAT_NEW => cur = Owner::Pattern(e.int as u16),
            E_ARR_NEW => cur = Owner::Arr(e.int as u16),
            E_INS_FLAGS => cur = Owner::Insert(ins),
            _ => {}
        }
        out.push(cur);
        if e.id == E_INS_OUTPUT {
            ins += 1;
            cur = Owner::Global;
        }
    }
    out
}

/// What the output does with each original event.
#[derive(Default)]
struct Plan {
    replace: HashMap<usize, Vec<u8>>,
    drop: HashSet<usize>,
    /// Bytes inserted right after an event (several inserts keep their order).
    after: HashMap<usize, Vec<u8>>,
    /// Bytes inserted before the first event.
    head: Vec<u8>,
}

impl Plan {
    fn insert_after(&mut self, i: Option<usize>, bytes: &[u8]) {
        match i {
            Some(i) => self.after.entry(i).or_default().extend_from_slice(bytes),
            None => self.head.extend_from_slice(bytes),
        }
    }
}

fn num(v: &Value, k: &str) -> Option<f64> {
    v.get(k).and_then(Value::as_f64)
}

fn row_f(r: &[Value], i: usize, d: f64) -> f64 {
    r.get(i).and_then(Value::as_f64).unwrap_or(d)
}

/// A 24-byte note record from a row (see the module docs).
fn note_record(r: &[Value], channel: u16) -> [u8; 24] {
    let mut b = [0u8; 24];
    let pos = row_f(r, 1, 0.0).max(0.0).round() as u32;
    let slide = row_f(r, 8, 0.0) != 0.0;
    b[0..4].copy_from_slice(&pos.to_le_bytes());
    b[4..6].copy_from_slice(&(0x4000u16 | if slide { 0x0008 } else { 0 }).to_le_bytes());
    b[6..8].copy_from_slice(&channel.to_le_bytes());
    b[8..12].copy_from_slice(&(row_f(r, 2, 0.0).max(0.0).round() as u32).to_le_bytes());
    b[12..14].copy_from_slice(&(row_f(r, 3, 60.0).clamp(0.0, 131.0) as u16).to_le_bytes());
    b[16] = row_f(r, 6, 120.0).clamp(0.0, 240.0) as u8;
    b[18] = row_f(r, 7, 64.0).clamp(0.0, 128.0) as u8;
    b[20] = row_f(r, 5, 64.0).clamp(0.0, 128.0) as u8;
    b[21] = row_f(r, 4, 100.0).clamp(0.0, 128.0) as u8;
    b[22] = row_f(r, 9, 128.0).clamp(0.0, 255.0) as u8;
    b[23] = row_f(r, 10, 128.0).clamp(0.0, 255.0) as u8;
    b
}

/// Channel references after deletions: old iid → new iid (None = deleted).
struct Remap {
    map: HashMap<u16, Option<u16>>,
    active: bool,
    /// iids given to `newChannels[k]`.
    new_iids: Vec<u16>,
}

impl Remap {
    fn get(&self, iid: u16) -> Option<u16> {
        if !self.active {
            return Some(iid);
        }
        self.map.get(&iid).copied().unwrap_or(Some(iid))
    }
    /// A note row's channel: a file iid or `-1 - k` for a new channel.
    fn row_channel(&self, v: f64) -> Option<u16> {
        if v < 0.0 {
            self.new_iids.get((-v - 1.0) as usize).copied()
        } else {
            self.get(v as u16)
        }
    }
}

/// Records that say which plugin it is (info, ids, state, extra id): a new
/// channel built from another channel's records must not inherit them.
const IDENTITY_RECORDS: [u32; 5] = [50, 51, 52, 53, 57];

/// Rewrite a third-party plugin's record list with a new name/path/state.
/// `fresh`: the template is another plugin — keep only its generic records.
fn vst_blob(template: Option<&[u8]>, v: &Value, fresh: bool) -> Option<Vec<u8>> {
    let state = v.get("state").and_then(Value::as_str).and_then(b64);
    let mut records: Vec<(u32, Vec<u8>)> = Vec::new();
    let kind = template.and_then(|t| u32_at(t, 0)).unwrap_or(10);
    if let Some(t) = template {
        let mut i = 4;
        while i + 12 <= t.len() {
            let id = u32_at(t, i)?;
            let n = usize::try_from(u64_at(t, i + 4)?).ok()?;
            if !(fresh && IDENTITY_RECORDS.contains(&id)) {
                records.push((id, t.get(i + 12..i + 12 + n)?.to_vec()));
            }
            i += 12 + n;
        }
    }
    let set = |records: &mut Vec<(u32, Vec<u8>)>, id: u32, body: Vec<u8>| match records.iter_mut().find(|r| r.0 == id) {
        Some(r) => r.1 = body,
        None => records.push((id, body)),
    };
    let s = |k: &str| v.get(k).and_then(Value::as_str).map(|x| x.as_bytes().to_vec());
    if let Some(x) = s("name") {
        set(&mut records, 54, x);
    }
    if let Some(x) = s("path") {
        set(&mut records, 55, x);
    }
    if let Some(x) = s("vendor") {
        set(&mut records, 56, x);
    }
    if let Some(x) = s("fourcc").filter(|x| x.len() == 4) {
        set(&mut records, 51, x);
    }
    if let Some(g) = v.get("guid").and_then(Value::as_str).filter(|g| g.len() == 32) {
        let bytes: Option<Vec<u8>> = (0..16).map(|i| u8::from_str_radix(&g[i * 2..i * 2 + 2], 16).ok()).collect();
        if let Some(b) = bytes {
            set(&mut records, 52, b);
        }
    }
    if let Some(tagged) = state {
        let old = records.iter().find(|r| r.0 == 53).map(|r| r.1.clone());
        if let Some(body) = state_record(old.as_deref(), &tagged) {
            set(&mut records, 53, body);
        }
    }
    let mut out = kind.to_le_bytes().to_vec();
    for (id, body) in records {
        out.extend_from_slice(&id.to_le_bytes());
        out.extend_from_slice(&(body.len() as u64).to_le_bytes());
        out.extend_from_slice(&body);
    }
    Some(out)
}

/// Record 53 for a new state, keeping the original's header fields.
fn state_record(old: Option<&[u8]>, tagged: &[u8]) -> Option<Vec<u8>> {
    let (&tag, rest) = tagged.split_first()?;
    match tag {
        b'3' => {
            let n = u32_at(rest, 0)? as usize;
            let component = rest.get(4..4 + n)?;
            let controller = &rest[4 + n..];
            // Original header and extra records (parameter table…) stay.
            let (header, extras) = match old.filter(|o| matches!(vst_state(o), VstState::Vst3 { .. })) {
                Some(o) => {
                    let mut extras = Vec::new();
                    let mut i = 80;
                    while i + 12 <= o.len() {
                        let id = u32_at(o, i)?;
                        let len = usize::try_from(u64_at(o, i + 4)?).ok()?;
                        if id != 3 && id != 2 {
                            extras.push((id, o.get(i + 12..i + 12 + len)?.to_vec()));
                        }
                        i += 12 + len;
                    }
                    (o[..80].to_vec(), extras)
                }
                None => {
                    let mut h = vec![0u8; 80];
                    h[0] = 1;
                    h[4] = 1;
                    h[8] = 64;
                    h[16] = 1;
                    (h, Vec::new())
                }
            };
            let mut out = header;
            let mut rec = |id: u32, body: &[u8]| {
                out.extend_from_slice(&id.to_le_bytes());
                out.extend_from_slice(&(body.len() as u64).to_le_bytes());
                out.extend_from_slice(body);
            };
            rec(3, component);
            rec(2, controller);
            for (id, body) in &extras {
                rec(*id, body);
            }
            Some(out)
        }
        b'C' => {
            // marker i32 (<0), flags u8 (bit 3 = chunk), program i32, size u32, [8 more]
            let mut head = match old {
                Some(o) if o.len() >= 13 && i32_at(o, 0).map_or(false, |m| m < 0) => {
                    let size = u32_at(o, 9).unwrap_or(0) as usize;
                    let hl = if o[4] & 0x08 != 0 && size <= o.len() && matches!(o.len() - size, 13 | 21) { o.len() - size } else { 21 };
                    o[..hl.min(o.len())].to_vec()
                }
                _ => {
                    let mut h = (-9i32).to_le_bytes().to_vec();
                    h.push(0x0d);
                    h.extend_from_slice(&(-2i32).to_le_bytes());
                    h.extend_from_slice(&[0; 12]);
                    h
                }
            };
            head[4] |= 0x08;
            head[9..13].copy_from_slice(&(rest.len() as u32).to_le_bytes());
            head.extend_from_slice(rest);
            Some(head)
        }
        b'P' => {
            let mut head = match old {
                Some(o) if o.len() >= 21 && i32_at(o, 0).map_or(false, |m| m < 0) && o[4] & 0x08 == 0 => o[..21].to_vec(),
                _ => {
                    let mut h = (-9i32).to_le_bytes().to_vec();
                    h.push(0x05);
                    h.extend_from_slice(&(-2i32).to_le_bytes());
                    h.extend_from_slice(&[0; 12]);
                    h
                }
            };
            head[4] &= !0x08;
            let n = rest.len() / 4;
            head.extend_from_slice(&(n as u32).to_le_bytes());
            head.extend_from_slice(&rest[..n * 4]);
            // The program-info tail the original carried after the values.
            if let Some(o) = old {
                if let Some(on) = u32_at(o, 21) {
                    let end = 25 + on as usize * 4;
                    if end <= o.len() {
                        head.extend_from_slice(&o[end..]);
                    }
                }
            }
            Some(head)
        }
        _ => None,
    }
}

/// Apply `edits_json` to the project in `original` and return the new file.
pub fn write(original: &[u8], edits_json: &str) -> Result<Vec<u8>, String> {
    let edits: Value = if edits_json.trim().is_empty() { Value::Null } else { serde_json::from_str(edits_json).map_err(|e| format!("Bad edits: {e}"))? };
    let (_hdr, body) = events::split(original)?;
    let body_start = body.as_ptr() as usize - original.as_ptr() as usize;
    let (evs, tail) = raw_events(body);
    let own = owners(&evs);

    let mut ver = Ver::default();
    for e in &evs {
        if e.id == E_VERSION {
            ver = parse_version(&text::ansi(e.data));
            break;
        }
    }
    let unicode = ver >= Ver(11, 5, 0);
    let mut plan = Plan::default();
    let idx_of = |pred: &dyn Fn(usize, &Raw) -> bool| -> Option<usize> { evs.iter().enumerate().position(|(i, e)| pred(i, e)) };

    // ── Channel ids after deletions ──
    let deleted: HashSet<u16> = edits.get("deleteChannels").and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_u64).map(|v| v as u16).collect();
    let mut orig_iids: Vec<u16> = evs.iter().filter(|e| e.id == E_CH_NEW).map(|e| e.int as u16).collect();
    orig_iids.sort_unstable();
    orig_iids.dedup();
    let mut remap = Remap { map: HashMap::new(), active: !deleted.is_empty(), new_iids: Vec::new() };
    let mut next = 0u16;
    for &iid in &orig_iids {
        if deleted.contains(&iid) {
            remap.map.insert(iid, None);
        } else if remap.active {
            remap.map.insert(iid, Some(next));
            next += 1;
        }
    }
    let first_new = if remap.active { next } else { orig_iids.last().map_or(0, |m| m + 1) };
    let new_channels: Vec<Value> = edits.get("newChannels").and_then(Value::as_array).cloned().unwrap_or_default();
    remap.new_iids = (0..new_channels.len() as u16).map(|k| first_new + k).collect();

    // ── Project-wide values ──
    if let Some(t) = num(&edits, "tempo") {
        let mut done = false;
        for (i, e) in evs.iter().enumerate() {
            match e.id {
                E_TEMPO => {
                    plan.replace.insert(i, enc_int(E_TEMPO, (t * 1000.0).round() as u32));
                    done = true;
                }
                E_TEMPO_COARSE => {
                    plan.replace.insert(i, enc_int(E_TEMPO_COARSE, t.floor() as u32));
                    done = true;
                }
                E_TEMPO_FINE => {
                    plan.replace.insert(i, enc_int(E_TEMPO_FINE, ((t - t.floor()) * 1000.0).round() as u32));
                }
                _ => {}
            }
        }
        if !done {
            let after = idx_of(&|_, e| e.id == E_VERSION);
            plan.insert_after(after, &enc_int(E_TEMPO, (t * 1000.0).round() as u32));
        }
    }
    if let Some(sig) = edits.get("timeSig").and_then(Value::as_array) {
        let (n, d) = (sig.first().and_then(Value::as_u64).unwrap_or(4), sig.get(1).and_then(Value::as_u64).unwrap_or(4));
        for (i, e) in evs.iter().enumerate() {
            if own[i] == Owner::Global && e.id == E_TIMESIG_NUM {
                plan.replace.insert(i, enc_int(E_TIMESIG_NUM, n as u32));
            }
            if own[i] == Owner::Global && e.id == E_TIMESIG_BEAT {
                plan.replace.insert(i, enc_int(E_TIMESIG_BEAT, d as u32));
            }
        }
    }

    // ── Deleted channels and patterns: their events go ──
    let deleted_pats: HashSet<u16> = edits.get("deletePatterns").and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_u64).map(|v| v as u16).collect();
    for (i, o) in own.iter().enumerate() {
        match o {
            Owner::Channel(c) if deleted.contains(c) => {
                plan.drop.insert(i);
            }
            Owner::Pattern(p) if deleted_pats.contains(p) => {
                plan.drop.insert(i);
            }
            _ => {}
        }
    }

    // ── Channel edits ──
    if let Some(chs) = edits.get("channels").and_then(Value::as_object) {
        for (k, ed) in chs {
            let Ok(iid) = k.parse::<u16>() else { continue };
            if deleted.contains(&iid) {
                continue;
            }
            let mine: Vec<usize> = (0..evs.len()).filter(|&i| own[i] == Owner::Channel(iid)).collect();
            if mine.is_empty() {
                continue;
            }
            apply_channel_edit(&mut plan, &evs, &mine, ed, unicode);
        }
    }

    // ── Channel renumbering ──
    if remap.active {
        for (i, e) in evs.iter().enumerate() {
            if plan.drop.contains(&i) {
                continue;
            }
            match e.id {
                E_CH_NEW => match remap.get(e.int as u16) {
                    Some(n) => {
                        plan.replace.insert(i, enc_int(E_CH_NEW, n as u32));
                    }
                    None => {
                        plan.drop.insert(i);
                    }
                },
                E_CH_CHILD => match remap.get(e.int as u16) {
                    Some(n) => {
                        plan.replace.insert(i, enc_int(e.id, n as u32));
                    }
                    None => {
                        plan.drop.insert(i);
                    }
                },
                E_PAT_CHANNEL => match remap.get(e.int as u16) {
                    Some(n) => {
                        plan.replace.insert(i, enc_int(e.id, n as u32));
                    }
                    None => {
                        plan.drop.insert(i);
                        if evs.get(i + 1).map_or(false, |n| n.id == E_PAT_CHANNEL_NEXT) {
                            plan.drop.insert(i + 1);
                        }
                    }
                },
                E_PAT_NOTES if !plan.replace.contains_key(&i) => {
                    let d = remap_notes(e.data, &remap);
                    plan.replace.insert(i, enc_data(e.id, &d));
                }
                E_PAT_CTRL => {
                    let mut d = Vec::with_capacity(e.data.len());
                    for r in e.data.chunks(12) {
                        if r.len() == 12 {
                            match remap.get(r[6] as u16) {
                                Some(n) => {
                                    let mut r = r.to_vec();
                                    r[6] = n as u8;
                                    d.extend_from_slice(&r);
                                }
                                None => {}
                            }
                        } else {
                            d.extend_from_slice(r);
                        }
                    }
                    plan.replace.insert(i, enc_data(e.id, &d));
                }
                E_REMOTE_CTRL => {
                    let d = e.data;
                    let mixer_base: u16 = if ver >= Ver(24, 0, 0) { 0x7000 } else { 0x2000 };
                    let src_is_ch = u16_at(d, 0) == Some(0);
                    let src = u16_at(d, 2);
                    let dst = u16_at(d, 10);
                    let mut nd = d.to_vec();
                    let mut keep = true;
                    if let (true, Some(s)) = (src_is_ch, src) {
                        match remap.get(s) {
                            Some(n) => nd[2..4].copy_from_slice(&n.to_le_bytes()),
                            None => keep = false,
                        }
                    }
                    if let Some(t) = dst.filter(|&t| t < mixer_base && t < 0x4000) {
                        match remap.get(t) {
                            Some(n) => nd[10..12].copy_from_slice(&n.to_le_bytes()),
                            None => keep = false,
                        }
                    }
                    if keep {
                        plan.replace.insert(i, enc_data(e.id, &nd));
                    } else {
                        plan.drop.insert(i);
                    }
                }
                _ => {}
            }
        }
    }

    // ── Patterns ──
    if let Some(pats) = edits.get("patterns").and_then(Value::as_object) {
        for (k, ed) in pats {
            let Ok(iid) = k.parse::<u16>() else { continue };
            let mine: Vec<usize> = (0..evs.len()).filter(|&i| own[i] == Owner::Pattern(iid) && !plan.drop.contains(&i)).collect();
            if mine.is_empty() {
                continue;
            }
            let news: Vec<usize> = mine.iter().copied().filter(|&i| evs[i].id == E_PAT_NEW).collect();
            let meta_at = news.get(1).or(news.first()).copied();
            if let Some(notes) = ed.get("notes") {
                let keep: HashSet<u16> = notes.get("keep").and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_u64).map(|v| v as u16).collect();
                let mut recs: Vec<[u8; 24]> = Vec::new();
                let note_evs: Vec<usize> = mine.iter().copied().filter(|&i| evs[i].id == E_PAT_NOTES).collect();
                for &i in &note_evs {
                    for r in evs[i].data.chunks_exact(24) {
                        let ch = u16_at(r, 6).unwrap_or(0);
                        if keep.contains(&ch) {
                            if let Some(n) = remap.get(ch) {
                                let mut r: [u8; 24] = r.try_into().unwrap();
                                r[6..8].copy_from_slice(&n.to_le_bytes());
                                recs.push(r);
                            }
                        }
                    }
                }
                for row in notes.get("rows").and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_array) {
                    if let Some(ch) = remap.row_channel(row_f(row, 0, 0.0)) {
                        recs.push(note_record(row, ch));
                    }
                }
                recs.sort_by_key(|r| u32_at(r, 0).unwrap_or(0));
                let data: Vec<u8> = recs.concat();
                match note_evs.first() {
                    Some(&first) => {
                        if data.is_empty() {
                            plan.drop.insert(first);
                        } else {
                            plan.replace.insert(first, enc_data(E_PAT_NOTES, &data));
                        }
                        for &i in &note_evs[1..] {
                            plan.drop.insert(i);
                        }
                    }
                    None if !data.is_empty() => plan.insert_after(news.first().copied(), &enc_data(E_PAT_NOTES, &data)),
                    None => {}
                }
            }
            if let Some(name) = ed.get("name").and_then(Value::as_str) {
                set_or_insert(&mut plan, &evs, &mine, E_PAT_NAME, enc_text(E_PAT_NAME, name, unicode), meta_at);
            }
            if let Some(c) = ed.get("color").and_then(color_value) {
                set_or_insert(&mut plan, &evs, &mine, E_PAT_COLOR, enc_int(E_PAT_COLOR, c), meta_at);
            }
            if let Some(len) = num(ed, "length") {
                set_or_insert(&mut plan, &evs, &mine, E_PAT_LENGTH, enc_int(E_PAT_LENGTH, len.max(0.0).round() as u32), meta_at);
            }
        }
    }

    // ── New patterns: after the last pattern-notes block, before the channels ──
    if let Some(list) = edits.get("newPatterns").and_then(Value::as_array).filter(|l| !l.is_empty()) {
        let first_ch = own.iter().position(|o| matches!(o, Owner::Channel(_)));
        let last_pat = (0..first_ch.unwrap_or(evs.len())).rev().find(|&i| matches!(own[i], Owner::Pattern(_)));
        let mut bytes = Vec::new();
        for p in list {
            let Some(iid) = p.get("iid").and_then(Value::as_u64) else { continue };
            bytes.extend(enc_int(E_PAT_NEW, iid as u32));
            let mut recs: Vec<[u8; 24]> = p
                .get("rows")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(Value::as_array)
                .filter_map(|row| remap.row_channel(row_f(row, 0, 0.0)).map(|ch| note_record(row, ch)))
                .collect();
            recs.sort_by_key(|r| u32_at(r, 0).unwrap_or(0));
            if !recs.is_empty() {
                bytes.extend(enc_data(E_PAT_NOTES, &recs.concat()));
            }
            if let Some(name) = p.get("name").and_then(Value::as_str).filter(|s| !s.is_empty()) {
                bytes.extend(enc_text(E_PAT_NAME, name, unicode));
            }
            if let Some(c) = p.get("color").and_then(color_value) {
                bytes.extend(enc_int(E_PAT_COLOR, c));
            }
            if let Some(len) = num(p, "length") {
                bytes.extend(enc_int(E_PAT_LENGTH, len.max(0.0).round() as u32));
            }
        }
        match (last_pat, first_ch) {
            (Some(i), _) => plan.insert_after(Some(i), &bytes),
            (None, Some(c)) if c > 0 => plan.insert_after(Some(c - 1), &bytes),
            _ => plan.insert_after(None, &bytes),
        }
    }

    // ── New channels: after the last channel block ──
    if !new_channels.is_empty() {
        let section_end = own.iter().position(|o| matches!(o, Owner::Arr(_) | Owner::Insert(_))).unwrap_or(evs.len());
        let last_ch = (0..section_end).rev().find(|&i| matches!(own[i], Owner::Channel(_)));
        let mut bytes = Vec::new();
        for (k, ch) in new_channels.iter().enumerate() {
            bytes.extend(new_channel_block(&evs, &own, &deleted, ch, remap.new_iids[k], unicode));
        }
        match last_ch {
            Some(i) => plan.insert_after(Some(i), &bytes),
            None if section_end > 0 => plan.insert_after(Some(section_end - 1), &bytes),
            None => plan.insert_after(None, &bytes),
        }
    }

    // ── Arrangement ──
    if let Some(arr) = edits.get("arrangement") {
        let aid = arr.get("iid").and_then(Value::as_u64).unwrap_or(0) as u16;
        let has_arrs = own.iter().any(|o| matches!(o, Owner::Arr(_)));
        let in_arr = |i: usize| if has_arrs { own[i] == Owner::Arr(aid) } else { true };
        let pl_evs: Vec<usize> = (0..evs.len()).filter(|&i| evs[i].id == E_PLAYLIST && in_arr(i)).collect();
        let orig: Vec<u8> = pl_evs.iter().flat_map(|&i| evs[i].data.iter().copied()).collect();
        let size = playlist_record_size(&orig, ver);
        let orig_recs: Vec<&[u8]> = orig.chunks_exact(size).collect();
        let max_track: i32 = if ver >= Ver(12, 9, 1) || ver == Ver(0, 0, 0) { 499 } else { 198 };
        let mut next_item_id = orig_recs.iter().filter_map(|r| u32_at(r, 32)).max().map_or(1, |m| m + 1);
        let template_pat = orig_recs.iter().find(|r| u16_at(r, 6).zip(u16_at(r, 4)).map_or(false, |(i, b)| i > b)).copied();
        let mut data = Vec::new();
        for it in arr.get("items").and_then(Value::as_array).into_iter().flatten() {
            if let Some(k) = it.get("o").and_then(Value::as_u64) {
                if let Some(r) = orig_recs.get(k as usize) {
                    let mut r = r.to_vec();
                    if !item_remap(&mut r, &remap) {
                        continue;
                    }
                    data.extend(r);
                }
                continue;
            }
            let Some(a) = it.as_array() else { continue };
            let o = a.get(8).and_then(Value::as_i64).filter(|&o| o >= 0).and_then(|o| orig_recs.get(o as usize)).copied();
            let kind = row_f(a, 3, 0.0) as u8;
            let mut r = match o.or(if kind == 0 { template_pat } else { None }).or(orig_recs.first().copied()) {
                Some(t) => t.to_vec(),
                None => {
                    let mut t = vec![0u8; size];
                    if size >= 24 {
                        t[16] = 0x78;
                        t[18] = 0x40;
                        t[20..24].copy_from_slice(&[0x40, 0x64, 0x80, 0x80]);
                    }
                    t
                }
            };
            let base = PATTERN_BASE;
            let reference = row_f(a, 4, 0.0);
            let idx = if kind == 0 {
                base + reference as u16
            } else {
                match remap.row_channel(reference) {
                    Some(c) => c,
                    None => continue,
                }
            };
            r[0..4].copy_from_slice(&(row_f(a, 0, 0.0).max(0.0).round() as u32).to_le_bytes());
            r[4..6].copy_from_slice(&base.to_le_bytes());
            r[6..8].copy_from_slice(&idx.to_le_bytes());
            r[8..12].copy_from_slice(&(row_f(a, 1, 0.0).max(0.0).round() as u32).to_le_bytes());
            r[12..14].copy_from_slice(&((max_track - row_f(a, 2, 0.0) as i32).clamp(0, max_track) as u16).to_le_bytes());
            if o.is_none() {
                r[14..16].copy_from_slice(&0u16.to_le_bytes());
            }
            let mut flags = u16_at(&r, 18).unwrap_or(0x40);
            if row_f(a, 7, 0.0) != 0.0 {
                flags |= 0x2000;
            } else {
                flags &= !0x2000;
            }
            r[18..20].copy_from_slice(&flags.to_le_bytes());
            if r.len() >= 32 {
                r[24..28].copy_from_slice(&(row_f(a, 5, -1.0) as f32).to_le_bytes());
                r[28..32].copy_from_slice(&(row_f(a, 6, -1.0) as f32).to_le_bytes());
            }
            if r.len() >= 36 && o.is_none() {
                r[32..36].copy_from_slice(&next_item_id.to_le_bytes());
                next_item_id += 1;
            }
            data.extend(r);
        }
        match pl_evs.first() {
            Some(&first) => {
                plan.replace.insert(first, enc_data(E_PLAYLIST, &data));
                for &i in &pl_evs[1..] {
                    plan.drop.insert(i);
                }
            }
            None if !data.is_empty() => {
                let at = (0..evs.len()).filter(|&i| own[i] == Owner::Arr(aid) && matches!(evs[i].id, E_ARR_NEW | E_ARR_NAME)).last();
                plan.insert_after(at, &enc_data(E_PLAYLIST, &data));
            }
            None => {}
        }
    } else if remap.active {
        // Untouched playlists still reference channels by iid.
        for (i, e) in evs.iter().enumerate().filter(|(_, e)| e.id == E_PLAYLIST) {
            let size = playlist_record_size(e.data, ver);
            let mut d = Vec::with_capacity(e.data.len());
            for r in e.data.chunks_exact(size) {
                let mut r = r.to_vec();
                if item_remap(&mut r, &remap) {
                    d.extend(r);
                }
            }
            plan.replace.insert(i, enc_data(E_PLAYLIST, &d));
        }
    }

    // ── Mixer inserts ──
    if let Some(ins) = edits.get("inserts").and_then(Value::as_object) {
        let mut params: Vec<(usize, Vec<u8>)> = (0..evs.len()).filter(|&i| evs[i].id == E_MIXER_PARAMS).map(|i| (i, evs[i].data.to_vec())).collect();
        for (k, ed) in ins {
            let Ok(n) = k.parse::<usize>() else { continue };
            let mine: Vec<usize> = (0..evs.len()).filter(|&i| own[i] == Owner::Insert(n)).collect();
            if let Some(&flags_at) = mine.first().filter(|&&i| evs[i].id == E_INS_FLAGS) {
                if let Some(m) = ed.get("muted").and_then(Value::as_bool) {
                    let mut d = evs[flags_at].data.to_vec();
                    if let Some(f) = u32_at(&d, 4) {
                        let f = if m { f & !0x08 } else { f | 0x08 };
                        d[4..8].copy_from_slice(&f.to_le_bytes());
                        plan.replace.insert(flags_at, enc_data(E_INS_FLAGS, &d));
                    }
                }
                if let Some(name) = ed.get("name").and_then(Value::as_str) {
                    set_or_insert(&mut plan, &evs, &mine, E_INS_NAME, enc_text(E_INS_NAME, name, unicode), Some(flags_at));
                }
                if let Some(c) = ed.get("color").and_then(color_value) {
                    set_or_insert(&mut plan, &evs, &mine, E_INS_COLOR, enc_int(E_INS_COLOR, c), Some(flags_at));
                }
            }
            for (key, id, scale) in [("volume", 192u8, 12800.0), ("pan", 193u8, 6400.0)] {
                let Some(v) = num(ed, key) else { continue };
                let msg = (v * scale).round() as i32;
                let mut found = false;
                for (_, d) in params.iter_mut() {
                    for r in d.chunks_exact_mut(12) {
                        let cd = u16_at(r, 6).unwrap_or(0);
                        if r[4] == id && ((cd >> 6) & 0x7f) as usize == n {
                            r[8..12].copy_from_slice(&msg.to_le_bytes());
                            found = true;
                        }
                    }
                }
                if !found {
                    if let Some((_, d)) = params.first_mut() {
                        let mut r = [0u8; 12];
                        r[4] = id;
                        r[6..8].copy_from_slice(&((n as u16) << 6).to_le_bytes());
                        r[8..12].copy_from_slice(&msg.to_le_bytes());
                        d.extend_from_slice(&r);
                    }
                }
            }
        }
        for (i, d) in params {
            if d.as_slice() != evs[i].data {
                plan.replace.insert(i, enc_data(E_MIXER_PARAMS, &d));
            }
        }
    }

    // ── Emit ── (nothing changed: the original, even a damaged one, as it was)
    if plan.replace.is_empty() && plan.drop.is_empty() && plan.after.is_empty() && plan.head.is_empty() {
        return Ok(original.to_vec());
    }
    let mut out_ev = Vec::with_capacity(body.len() + 4096);
    out_ev.extend_from_slice(&plan.head);
    for (i, e) in evs.iter().enumerate() {
        if !plan.drop.contains(&i) {
            match plan.replace.get(&i) {
                Some(b) => out_ev.extend_from_slice(b),
                None => out_ev.extend_from_slice(e.raw),
            }
        }
        if let Some(b) = plan.after.get(&i) {
            out_ev.extend_from_slice(b);
        }
    }
    out_ev.extend_from_slice(tail);

    let mut f = original[..body_start - 8].to_vec();
    // The header's channel count follows additions and deletions.
    if f.len() >= 12 {
        let count = u16_at(&f, 10).unwrap_or(0) as i32 - deleted.iter().filter(|d| orig_iids.contains(d)).count() as i32 + new_channels.len() as i32;
        f[10..12].copy_from_slice(&(count.max(0) as u16).to_le_bytes());
    }
    f.extend_from_slice(b"FLdt");
    f.extend_from_slice(&(out_ev.len() as u32).to_le_bytes());
    f.extend_from_slice(&out_ev);
    f.extend_from_slice(&original[body_start + body.len()..]);
    Ok(f)
}

fn remap_notes(d: &[u8], remap: &Remap) -> Vec<u8> {
    let mut out = Vec::with_capacity(d.len());
    for r in d.chunks(24) {
        if r.len() < 24 {
            out.extend_from_slice(r);
            continue;
        }
        if let Some(n) = remap.get(u16_at(r, 6).unwrap_or(0)) {
            let mut r = r.to_vec();
            r[6..8].copy_from_slice(&n.to_le_bytes());
            out.extend(r);
        }
    }
    out
}

/// Remap a playlist record's channel reference; false = it pointed at a deleted channel.
fn item_remap(r: &mut [u8], remap: &Remap) -> bool {
    let (Some(base), Some(idx)) = (u16_at(r, 4), u16_at(r, 6)) else { return true };
    if idx > base || !remap.active {
        return true;
    }
    match remap.get(idx) {
        Some(n) => {
            r[6..8].copy_from_slice(&n.to_le_bytes());
            true
        }
        None => false,
    }
}

/// Replace the first `id` event among `mine`, or insert a new one after `at`.
fn set_or_insert(plan: &mut Plan, evs: &[Raw], mine: &[usize], id: u8, bytes: Vec<u8>, at: Option<usize>) {
    match mine.iter().copied().find(|&i| evs[i].id == id) {
        Some(i) => {
            plan.replace.insert(i, bytes);
        }
        None => plan.insert_after(at, &bytes),
    }
}

fn apply_channel_edit(plan: &mut Plan, evs: &[Raw], mine: &[usize], ed: &Value, unicode: bool) {
    let find = |id: u8| mine.iter().copied().find(|&i| evs[i].id == id);
    let anchor = find(E_PL_NAME).or_else(|| find(E_PL_INTERNAL)).or_else(|| find(E_CH_TYPE)).or(mine.first().copied());
    if let Some(name) = ed.get("name").and_then(Value::as_str) {
        match (find(E_PL_NAME), find(E_CH_LEGACY_NAME)) {
            (Some(i), _) => {
                plan.replace.insert(i, enc_text(E_PL_NAME, name, unicode));
            }
            (None, Some(i)) => {
                plan.replace.insert(i, enc_text(E_CH_LEGACY_NAME, name, unicode));
            }
            _ => plan.insert_after(find(E_PL_INTERNAL).or_else(|| find(E_CH_TYPE)).or(mine.first().copied()), &enc_text(E_PL_NAME, name, unicode)),
        }
    }
    if let Some(c) = ed.get("color").and_then(color_value) {
        set_or_insert(plan, evs, mine, E_PL_COLOR, enc_int(E_PL_COLOR, c), anchor);
    }
    let vol = num(ed, "volume");
    let pan = num(ed, "pan");
    if vol.is_some() || pan.is_some() {
        if let Some(i) = find(E_CH_LEVELS) {
            let mut d = evs[i].data.to_vec();
            if d.len() >= 8 {
                if let Some(p) = pan {
                    d[0..4].copy_from_slice(&((6400.0 + p * 6400.0).round().clamp(0.0, 12800.0) as i32).to_le_bytes());
                }
                if let Some(v) = vol {
                    d[4..8].copy_from_slice(&((v * 12800.0).round().max(0.0) as u32).to_le_bytes());
                }
                plan.replace.insert(i, enc_data(E_CH_LEVELS, &d));
            }
        } else {
            if let Some(v) = vol {
                let w = (v * 12800.0).round().clamp(0.0, 65535.0) as u32;
                match find(E_CH_VOL_WORD) {
                    Some(i) => {
                        plan.replace.insert(i, enc_int(E_CH_VOL_WORD, w));
                    }
                    None => {
                        if let Some(i) = find(E_CH_VOL_BYTE) {
                            plan.replace.insert(i, enc_int(E_CH_VOL_BYTE, (v * 128.0).round().clamp(0.0, 255.0) as u32));
                        }
                    }
                }
            }
            if let Some(p) = pan {
                match find(E_CH_PAN_WORD) {
                    Some(i) => {
                        plan.replace.insert(i, enc_int(E_CH_PAN_WORD, (6400.0 + p * 6400.0).round().clamp(0.0, 12800.0) as u32));
                    }
                    None => {
                        if let Some(i) = find(E_CH_PAN_BYTE) {
                            plan.replace.insert(i, enc_int(E_CH_PAN_BYTE, (64.0 + p * 64.0).round().clamp(0.0, 128.0) as u32));
                        }
                    }
                }
            }
        }
    }
    if let Some(m) = ed.get("mixer").and_then(Value::as_i64) {
        set_or_insert(plan, evs, mine, E_CH_ROUTED, enc_int(E_CH_ROUTED, (m.clamp(-1, 255) as i8) as u8 as u32), anchor);
    }
    if let Some(on) = ed.get("enabled").and_then(Value::as_bool) {
        set_or_insert(plan, evs, mine, E_CH_ENABLED, enc_int(E_CH_ENABLED, on as u32), anchor);
    }
    if let Some(s) = ed.get("sample").and_then(Value::as_str) {
        set_or_insert(plan, evs, mine, E_CH_SAMPLE, enc_text(E_CH_SAMPLE, s, unicode), mine.last().copied());
    }
    if let Some(state) = ed.get("state").and_then(Value::as_str) {
        if let Some(i) = find(E_PL_STATE) {
            let old = evs[i].data;
            if read_vst_records(old).is_some() {
                let v = serde_json::json!({ "state": state });
                if let Some(b) = vst_blob(Some(old), &v, false) {
                    plan.replace.insert(i, enc_data(E_PL_STATE, &b));
                }
            }
        }
    }
}

/// A new channel's events: a copy of a similar channel in the same file when
/// there is one (so every setting the format expects is present), with the
/// new identity and values; a minimal block otherwise.
fn new_channel_block(evs: &[Raw], own: &[Owner], deleted: &HashSet<u16>, ch: &Value, iid: u16, unicode: bool) -> Vec<u8> {
    let is_vst = ch.get("kind").and_then(Value::as_str) == Some("vst");
    // Candidate templates: each channel's first contiguous block.
    let mut template: Option<(usize, usize)> = None;
    let mut i = 0;
    while i < evs.len() {
        if evs[i].id == E_CH_NEW {
            if let Owner::Channel(c) = own[i] {
                let end = (i + 1..evs.len()).find(|&j| own[j] != Owner::Channel(c) || evs[j].id == E_CH_NEW).unwrap_or(evs.len());
                let block = &evs[i..end];
                let kind = block.iter().find(|e| e.id == E_CH_TYPE).map(|e| e.int);
                let state = block.iter().find(|e| e.id == E_PL_STATE);
                let wrapper = state.map_or(false, |e| read_vst_records(e.data).is_some());
                let fits = !deleted.contains(&c) && if is_vst { wrapper } else { kind == Some(0) && state.is_none() };
                if fits && template.is_none() {
                    template = Some((i, end));
                }
                i = end;
                continue;
            }
        }
        i += 1;
    }
    let s = |k: &str| ch.get(k).and_then(Value::as_str);
    let mut out = Vec::new();
    let name = s("name").unwrap_or("Channel");
    let color = ch.get("color").and_then(color_value);
    let levels = |old: Option<&[u8]>| {
        let mut d = old.map(<[u8]>::to_vec).filter(|d| d.len() >= 12).unwrap_or_else(|| vec![0u8; 24]);
        d[0..4].copy_from_slice(&((6400.0 + num(ch, "pan").unwrap_or(0.0) * 6400.0).round().clamp(0.0, 12800.0) as i32).to_le_bytes());
        d[4..8].copy_from_slice(&((num(ch, "volume").unwrap_or(0.78) * 12800.0).round().max(0.0) as u32).to_le_bytes());
        d[8..12].copy_from_slice(&0i32.to_le_bytes());
        d
    };
    let mixer = ch.get("mixer").and_then(Value::as_i64).unwrap_or(0).clamp(-1, 255);
    let vst = ch.get("vst").cloned().unwrap_or(Value::Null);
    match template {
        Some((a, b)) => {
            let mut seen_name = false;
            for e in &evs[a..b] {
                match e.id {
                    E_CH_NEW => out.extend(enc_int(E_CH_NEW, iid as u32)),
                    E_PL_NAME => {
                        out.extend(enc_text(E_PL_NAME, name, unicode));
                        seen_name = true;
                    }
                    E_CH_LEGACY_NAME => {}
                    E_PL_COLOR => out.extend(enc_int(E_PL_COLOR, color.unwrap_or(e.int))),
                    E_CH_LEVELS => out.extend(enc_data(E_CH_LEVELS, &levels(Some(e.data)))),
                    E_CH_ROUTED => out.extend(enc_int(E_CH_ROUTED, (mixer as i8) as u8 as u32)),
                    E_CH_ENABLED => out.extend(enc_int(E_CH_ENABLED, 1)),
                    E_CH_SAMPLE => {
                        if !is_vst {
                            out.extend(enc_text(E_CH_SAMPLE, s("sample").unwrap_or(""), unicode));
                        }
                    }
                    E_PL_STATE if is_vst => {
                        if let Some(bl) = vst_blob(Some(e.data), &vst, true) {
                            out.extend(enc_data(E_PL_STATE, &bl));
                        }
                    }
                    E_CH_AUTOMATION | E_CH_CHILD => {}
                    _ => out.extend_from_slice(e.raw),
                }
                if e.id == E_PL_INTERNAL && !evs[a..b].iter().any(|x| x.id == E_PL_NAME) && !seen_name {
                    out.extend(enc_text(E_PL_NAME, name, unicode));
                    seen_name = true;
                }
            }
            if !seen_name {
                out.extend(enc_text(E_PL_NAME, name, unicode));
            }
            if !is_vst && !evs[a..b].iter().any(|e| e.id == E_CH_SAMPLE) {
                if let Some(p) = s("sample") {
                    out.extend(enc_text(E_CH_SAMPLE, p, unicode));
                }
            }
        }
        None => {
            out.extend(enc_int(E_CH_NEW, iid as u32));
            out.extend(enc_int(E_CH_TYPE, if is_vst { 2 } else { 0 }));
            out.extend(enc_text(E_PL_INTERNAL, if is_vst { "Fruity Wrapper" } else { "" }, unicode));
            out.extend(enc_text(E_PL_NAME, name, unicode));
            if is_vst {
                if let Some(bl) = vst_blob(None, &vst, true) {
                    out.extend(enc_data(E_PL_STATE, &bl));
                }
            }
            if let Some(c) = color {
                out.extend(enc_int(E_PL_COLOR, c));
            }
            out.extend(enc_int(E_CH_ENABLED, 1));
            out.extend(enc_data(E_CH_LEVELS, &levels(None)));
            out.extend(enc_int(E_CH_ROUTED, (mixer as i8) as u8 as u32));
            if !is_vst {
                out.extend(enc_text(E_CH_SAMPLE, s("sample").unwrap_or(""), unicode));
            }
        }
    }
    out
}

#[cfg(test)]
#[path = "write_tests.rs"]
mod tests;
