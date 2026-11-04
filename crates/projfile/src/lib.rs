//! Reader for `.flp` pattern-project files.
//!
//! The file is a flat event stream (see [`events`]); structure is implied by
//! order: a "new channel" event opens a channel and the events after it
//! describe that channel, "new pattern" does the same for patterns, mixer
//! inserts end with their output event, and so on. [`parse`] walks the stream
//! once and builds a [`Project`]; [`Project::to_json`] hands it to the UI.
//!
//! Version handling: strings switch from ANSI to UTF-16 at version 11.5,
//! playlist items grew from 32 to 60 bytes, the playlist track count went
//! from 199 to 500 at 12.9.1, tempo moved from two word events to one dword.
//! Each is decided from the version string or, where that is ambiguous, from
//! the data itself.

pub mod events;
pub mod model;
pub mod text;
pub mod write;

use events::{Event, Events, DATA, DWORD, TEXT, WORD};
pub use model::*;
use text::{base64, decode, embedded_paths, Json};

fn u16_at(b: &[u8], o: usize) -> Option<u16> {
    Some(u16::from_le_bytes(b.get(o..o + 2)?.try_into().ok()?))
}
fn u32_at(b: &[u8], o: usize) -> Option<u32> {
    Some(u32::from_le_bytes(b.get(o..o + 4)?.try_into().ok()?))
}
fn i32_at(b: &[u8], o: usize) -> Option<i32> {
    u32_at(b, o).map(|v| v as i32)
}
fn u64_at(b: &[u8], o: usize) -> Option<u64> {
    Some(u64::from_le_bytes(b.get(o..o + 8)?.try_into().ok()?))
}
fn f32_at(b: &[u8], o: usize) -> Option<f32> {
    u32_at(b, o).map(f32::from_bits)
}
fn f64_at(b: &[u8], o: usize) -> Option<f64> {
    u64_at(b, o).map(f64::from_bits)
}

// ── Event ids ────────────────────────────────────────────────────────────────
// Project
const E_LOOP_ACTIVE: u8 = 9;
const E_MAIN_VOL_BYTE: u8 = 12;
const E_TIMESIG_NUM: u8 = 17;
const E_TIMESIG_BEAT: u8 = 18;
const E_TEMPO_COARSE: u8 = WORD + 2;
const E_MAIN_PITCH: u8 = WORD + 16;
const E_TEMPO_FINE: u8 = WORD + 29;
const E_TEMPO: u8 = DWORD + 28;
const E_BUILD: u8 = DWORD + 31;
const E_TITLE: u8 = TEXT + 2;
const E_COMMENTS: u8 = TEXT + 3;
const E_URL: u8 = TEXT + 5;
const E_VERSION: u8 = TEXT + 7;
const E_DATA_PATH: u8 = TEXT + 10;
const E_GENRE: u8 = TEXT + 14;
const E_ARTISTS: u8 = TEXT + 15;
const E_CUR_PATTERN: u8 = WORD + 3;
// Channel
const E_CH_ENABLED: u8 = 0;
const E_CH_VOL_BYTE: u8 = 2;
const E_CH_PAN_BYTE: u8 = 3;
const E_CH_TYPE: u8 = 21;
const E_CH_ROUTED: u8 = 22;
const E_CH_NEW: u8 = WORD;
const E_CH_FX_FLAGS: u8 = WORD + 6;
const E_CH_VOL_WORD: u8 = WORD + 8;
const E_CH_PAN_WORD: u8 = WORD + 9;
const E_CH_TIME_SHIFT: u8 = WORD + 25;
const E_CH_CHILD: u8 = WORD + 30;
const E_CH_SWING: u8 = WORD + 33;
const E_CH_CUT_GROUP: u8 = DWORD + 4;
const E_CH_ROOT: u8 = DWORD + 7;
const E_CH_STRETCH_TIME: u8 = DWORD + 12;
const E_CH_FINE_TUNE: u8 = DWORD + 14;
const E_CH_GROUP: u8 = DWORD + 17;
const E_CH_LEGACY_NAME: u8 = TEXT;
const E_CH_SAMPLE: u8 = TEXT + 4;
const E_CH_LEVELS: u8 = DATA + 11;
const E_CH_AUTOMATION: u8 = DATA + 26;
// Plugin (channel generator or mixer slot)
const E_PL_COLOR: u8 = DWORD;
const E_PL_INTERNAL: u8 = TEXT + 9;
const E_PL_NAME: u8 = TEXT + 11;
const E_PL_WINDOW: u8 = DATA + 4;
const E_PL_STATE: u8 = DATA + 5;
// Pattern
const E_PAT_LOOPED: u8 = 26;
const E_PAT_NEW: u8 = WORD + 1;
const E_PAT_COLOR: u8 = DWORD + 22;
const E_PAT_LENGTH: u8 = DWORD + 36;
const E_PAT_NAME: u8 = TEXT + 1;
const E_PAT_NOTES: u8 = DATA + 16;
// Arrangement / playlist
const E_MK_NUM: u8 = 33;
const E_MK_DEN: u8 = 34;
const E_ARR_NEW: u8 = WORD + 35;
const E_ARR_CURRENT: u8 = WORD + 36;
const E_MK_POS: u8 = DWORD + 20;
const E_MK_NAME: u8 = TEXT + 13;
const E_TRACK_NAME: u8 = TEXT + 47;
const E_ARR_NAME: u8 = TEXT + 49;
const E_PLAYLIST: u8 = DATA + 25;
const E_TRACK_DATA: u8 = DATA + 30;
// Mixer
const E_INS_ICON: u8 = WORD + 31;
const E_SLOT_INDEX: u8 = WORD + 34;
const E_INS_OUTPUT: u8 = DWORD + 19;
const E_INS_COLOR: u8 = DWORD + 21;
const E_INS_INPUT: u8 = DWORD + 26;
const E_INS_NAME: u8 = TEXT + 12;
const E_MIXER_PARAMS: u8 = DATA + 17;
const E_INS_ROUTING: u8 = DATA + 27;
const E_INS_FLAGS: u8 = DATA + 28;
// Controllers
const E_REMOTE_CTRL: u8 = DATA + 19;

/// Pattern clips reference patterns as `base + pattern id`.
const PATTERN_BASE: u16 = 20480;

#[derive(Clone, Copy, PartialEq, PartialOrd, Debug, Default)]
struct Ver(u32, u32, u32);

fn parse_version(s: &str) -> Ver {
    let mut it = s.trim_end_matches('\0').split('.').map(|p| p.trim().parse::<u32>().unwrap_or(0));
    Ver(it.next().unwrap_or(0), it.next().unwrap_or(0), it.next().unwrap_or(0))
}

/// Parse a whole project file.
pub fn parse(bytes: &[u8]) -> Result<Project, String> {
    let (hdr, body) = events::split(bytes)?;
    let mut p = Project { ppq: hdr.ppq, format: hdr.format, tempo: 0.0, time_sig: (4, 4), ..Default::default() };
    let mut ver = Ver::default();
    let mut unicode = false;
    let mut tempo_coarse: Option<u32> = None;
    let mut tempo_fine: Option<u32> = None;

    let mut cur_ch: Option<usize> = None;
    let mut cur_pat: Option<usize> = None;
    let mut cur_arr: Option<usize> = None;
    let mut cur_marker: Option<usize> = None;
    let mut loose_markers: Vec<Marker> = Vec::new();
    let mut in_mixer = false;
    let mut slot_plugin = Plugin::default();
    let mut slot_has_plugin = false;
    // Before slot-index events existed, a slot's position lived in its window record.
    let mut slot_hint: Option<u16> = None;
    let mut insert = Insert { output: -1, input: -1, ..Default::default() };
    let mut mixer_params: Vec<&[u8]> = Vec::new();
    let mut raw_controllers: Vec<(u16, u16, u16)> = Vec::new();

    let txt = |e: &Event, u: bool| decode(e.data(), u);

    for e in Events::new(body) {
        match e.id {
            E_VERSION => {
                p.version = text::ansi(e.data());
                ver = parse_version(&p.version);
                unicode = ver >= Ver(11, 5, 0);
            }
            E_BUILD => p.build = e.int(),
            E_TEMPO => p.tempo = e.int() as f64 / 1000.0,
            E_TEMPO_COARSE => tempo_coarse = Some(e.int()),
            E_TEMPO_FINE => tempo_fine = Some(e.int()),
            E_TIMESIG_NUM => p.time_sig.0 = (e.int() as u8).max(1),
            E_TIMESIG_BEAT => p.time_sig.1 = (e.int() as u8).max(1),
            E_MAIN_PITCH => p.main_pitch = e.int() as u16 as i16,
            E_MAIN_VOL_BYTE => p.main_volume = Some(e.int()),
            E_TITLE => p.title = txt(&e, unicode),
            E_COMMENTS => p.comments = txt(&e, unicode),
            E_URL => p.url = txt(&e, unicode),
            E_GENRE => p.genre = txt(&e, unicode),
            E_ARTISTS => p.artists = txt(&e, unicode),
            E_DATA_PATH => p.data_path = txt(&e, unicode),
            E_CUR_PATTERN => p.current_pattern = Some(e.int() as u16),
            E_LOOP_ACTIVE => {}

            // ── Channels ──
            E_CH_NEW => {
                let iid = e.int() as u16;
                cur_ch = Some(match p.channels.iter().position(|c| c.iid == iid) {
                    Some(i) => i,
                    None => {
                        p.channels.push(Channel::new(iid));
                        p.channels.len() - 1
                    }
                });
            }
            E_CH_TYPE => {
                if let Some(c) = cur_ch {
                    p.channels[c].kind = ChannelKind::from_code(e.int() as u8);
                }
            }
            E_CH_ENABLED if !in_mixer => {
                if let Some(c) = cur_ch {
                    p.channels[c].enabled = e.int() != 0;
                }
            }
            E_CH_ROUTED => {
                if let Some(c) = cur_ch {
                    let v = e.int() as u8 as i8 as i32;
                    p.channels[c].mixer = if v < 0 { None } else { Some(v) };
                }
            }
            E_CH_VOL_BYTE => with_ch(&mut p, cur_ch, |c| c.volume = e.int() as f64 / 128.0),
            E_CH_PAN_BYTE => with_ch(&mut p, cur_ch, |c| c.pan = (e.int() as f64 - 64.0) / 64.0),
            E_CH_VOL_WORD => with_ch(&mut p, cur_ch, |c| c.volume = e.int() as f64 / 12800.0),
            E_CH_PAN_WORD => with_ch(&mut p, cur_ch, |c| c.pan = (e.int() as f64 - 6400.0) / 6400.0),
            E_CH_FX_FLAGS => with_ch(&mut p, cur_ch, |c| c.reversed = e.int() & 2 != 0),
            E_CH_TIME_SHIFT => with_ch(&mut p, cur_ch, |c| c.time_shift = Some(e.int())),
            E_CH_SWING => with_ch(&mut p, cur_ch, |c| c.swing = Some(e.int())),
            E_CH_CHILD => with_ch(&mut p, cur_ch, |c| c.children.push(e.int() as u16)),
            E_CH_CUT_GROUP => with_ch(&mut p, cur_ch, |c| c.cut_group = ((e.int() & 0xffff) as u16, (e.int() >> 16) as u16)),
            E_CH_ROOT => with_ch(&mut p, cur_ch, |c| c.root_note = e.int()),
            E_CH_STRETCH_TIME => with_ch(&mut p, cur_ch, |c| c.stretch_time = Some(f32::from_bits(e.int()))),
            E_CH_FINE_TUNE => with_ch(&mut p, cur_ch, |c| c.fine_tune = e.int() as i32),
            E_CH_GROUP => with_ch(&mut p, cur_ch, |c| c.group = e.int() as i32),
            E_CH_LEGACY_NAME => with_ch(&mut p, cur_ch, |c| c.legacy_name = txt(&e, unicode)),
            E_CH_SAMPLE => with_ch(&mut p, cur_ch, |c| c.sample_path = txt(&e, unicode)),
            E_CH_LEVELS => {
                let d = e.data();
                with_ch(&mut p, cur_ch, |c| {
                    if let Some(pan) = i32_at(d, 0) {
                        c.pan = ((pan as f64 - 6400.0) / 6400.0).clamp(-1.0, 1.0);
                    }
                    if let Some(vol) = u32_at(d, 4) {
                        c.volume = vol as f64 / 12800.0;
                    }
                    if let Some(ps) = i32_at(d, 8) {
                        c.pitch_cents = ps;
                    }
                })
            }
            E_CH_AUTOMATION => {
                let pts = automation_points(e.data());
                with_ch(&mut p, cur_ch, |c| c.automation = pts)
            }

            // ── Plugins: a channel's generator, or the effect in the open mixer slot ──
            E_PL_WINDOW if in_mixer => {
                slot_has_plugin = true;
                slot_hint = u16_at(e.data(), 2);
            }
            E_PL_INTERNAL | E_PL_NAME | E_PL_STATE | E_PL_COLOR => {
                // Old files: a new plugin starting means the previous slot is complete.
                if in_mixer && e.id == E_PL_INTERNAL && (!slot_plugin.internal.is_empty() || slot_plugin.state_len > 0) {
                    let index = slot_hint.take().unwrap_or(insert.slots.len() as u16);
                    insert.slots.push(Slot { index, plugin: std::mem::take(&mut slot_plugin), enabled: true, mix: 1.0 });
                }
                let target: Option<&mut Plugin> = if in_mixer {
                    slot_has_plugin = true;
                    Some(&mut slot_plugin)
                } else {
                    cur_ch.map(|c| &mut p.channels[c].plugin)
                };
                if let Some(pl) = target {
                    match e.id {
                        E_PL_INTERNAL => pl.internal = txt(&e, unicode),
                        E_PL_NAME => pl.name = txt(&e, unicode),
                        E_PL_COLOR => pl.color = Some(e.int()),
                        _ => read_plugin_state(pl, e.data()),
                    }
                }
            }

            // ── Patterns ──
            E_PAT_NEW => {
                let iid = e.int() as u16;
                cur_pat = Some(match p.patterns.iter().position(|x| x.iid == iid) {
                    Some(i) => i,
                    None => {
                        p.patterns.push(Pattern { iid, ..Default::default() });
                        p.patterns.len() - 1
                    }
                });
            }
            E_PAT_NAME => with_pat(&mut p, cur_pat, |x| x.name = txt(&e, unicode)),
            E_PAT_COLOR => with_pat(&mut p, cur_pat, |x| x.color = Some(e.int())),
            E_PAT_LENGTH => with_pat(&mut p, cur_pat, |x| x.length = e.int()),
            E_PAT_LOOPED => with_pat(&mut p, cur_pat, |x| x.looped = e.int() != 0),
            E_PAT_NOTES => {
                let notes = read_notes(e.data());
                with_pat(&mut p, cur_pat, |x| x.notes.extend(notes))
            }

            // ── Arrangements ──
            E_ARR_NEW => {
                p.arrangements.push(Arrangement { iid: e.int() as u16, markers: std::mem::take(&mut loose_markers), ..Default::default() });
                cur_arr = Some(p.arrangements.len() - 1);
                cur_marker = None;
            }
            E_ARR_CURRENT => p.current_arrangement = Some(e.int() as u16),
            E_ARR_NAME => {
                if let Some(a) = cur_arr {
                    p.arrangements[a].name = txt(&e, unicode);
                }
            }
            E_PLAYLIST => {
                let a = ensure_arrangement(&mut p, &mut cur_arr);
                let items = read_playlist(e.data(), ver);
                p.arrangements[a].items.extend(items);
            }
            E_TRACK_DATA => {
                let a = ensure_arrangement(&mut p, &mut cur_arr);
                let d = e.data();
                let arr = &mut p.arrangements[a];
                arr.tracks.push(Track {
                    index: arr.tracks.len() as u16,
                    name: String::new(),
                    color: u32_at(d, 4),
                    enabled: d.get(12).map_or(true, |&b| b != 0),
                    height: f32_at(d, 13).unwrap_or(1.0),
                });
            }
            E_TRACK_NAME => {
                if let Some(t) = cur_arr.and_then(|a| p.arrangements[a].tracks.last_mut()) {
                    t.name = txt(&e, unicode);
                }
            }
            E_MK_POS => {
                let v = e.int();
                // Low 24 bits: position. High byte: kind (0 marker, 8 time
                // signature; others are loop/punch/pause points).
                let m = Marker { pos: v & 0x00ff_ffff, kind: (v >> 24) as u8, name: String::new(), signature: if v & 0x0800_0000 != 0 { Some((4, 4)) } else { None } };
                match cur_arr {
                    Some(a) => {
                        p.arrangements[a].markers.push(m);
                        cur_marker = Some(p.arrangements[a].markers.len() - 1);
                    }
                    None => {
                        loose_markers.push(m);
                        cur_marker = Some(usize::MAX);
                    }
                }
            }
            E_MK_NAME | E_MK_NUM | E_MK_DEN => {
                let m = match (cur_marker, cur_arr) {
                    (Some(usize::MAX), _) => loose_markers.last_mut(),
                    (Some(i), Some(a)) => p.arrangements[a].markers.get_mut(i),
                    _ => None,
                };
                if let Some(m) = m {
                    match e.id {
                        E_MK_NAME => m.name = txt(&e, unicode),
                        E_MK_NUM => m.signature = m.signature.map(|s| (e.int() as u8, s.1)),
                        _ => m.signature = m.signature.map(|s| (s.0, e.int() as u8)),
                    }
                }
            }

            // ── Mixer ── (an insert's events end with its output event)
            E_INS_FLAGS => {
                in_mixer = true;
                insert.flags = u32_at(e.data(), 4).unwrap_or(0);
            }
            E_INS_NAME => insert.name = txt(&e, unicode),
            E_INS_COLOR => insert.color = Some(e.int()),
            E_INS_ICON => {}
            E_INS_INPUT => insert.input = e.int() as i32,
            E_INS_ROUTING => insert.routes = e.data().iter().map(|&b| b != 0).collect(),
            E_SLOT_INDEX => {
                let index = e.int() as u16;
                if slot_has_plugin && !(slot_plugin.internal.is_empty() && slot_plugin.vst.is_none() && slot_plugin.state_len == 0) {
                    insert.slots.push(Slot { index, plugin: std::mem::take(&mut slot_plugin), enabled: true, mix: 1.0 });
                }
                slot_plugin = Plugin::default();
                slot_has_plugin = false;
                slot_hint = None;
            }
            E_INS_OUTPUT => {
                if !slot_plugin.internal.is_empty() || slot_plugin.state_len > 0 {
                    let index = slot_hint.take().unwrap_or(insert.slots.len() as u16);
                    insert.slots.push(Slot { index, plugin: std::mem::take(&mut slot_plugin), enabled: true, mix: 1.0 });
                }
                slot_hint = None;
                insert.output = e.int() as i32;
                insert.index = p.inserts.len() as u16;
                insert.volume = 1.0;
                p.inserts.push(std::mem::replace(&mut insert, Insert { output: -1, input: -1, ..Default::default() }));
                slot_plugin = Plugin::default();
                slot_has_plugin = false;
            }
            E_MIXER_PARAMS => mixer_params.push(e.data()),
            E_REMOTE_CTRL => {
                // `(flags u16, source u16, _, parameter u16, destination u16, …)`;
                // non-zero flags mean the source is a plugin, not an automation clip.
                let d = e.data();
                if let (Some(0), Some(source), Some(parameter), Some(dest)) = (u16_at(d, 0), u16_at(d, 2), u16_at(d, 8), u16_at(d, 10)) {
                    raw_controllers.push((source, parameter, dest));
                }
            }
            _ => {}
        }
    }

    if p.tempo <= 0.0 {
        p.tempo = match (tempo_coarse, tempo_fine) {
            (Some(c), f) => c as f64 + f.unwrap_or(0) as f64 / 1000.0,
            _ => 140.0,
        };
    }
    for d in mixer_params {
        apply_mixer_params(&mut p.inserts, d);
    }
    // Destinations: channels count up from 0, mixer slots are
    // `base + insert * 64 + slot`, project controls sit at 0x4000. Newer
    // versions moved the mixer base from 0x2000 to 0x7000 (more channels).
    let mixer_base: u16 = if ver >= Ver(24, 0, 0) || raw_controllers.iter().any(|c| c.2 >= 0x7000) { 0x7000 } else { 0x2000 };
    p.controllers = raw_controllers
        .into_iter()
        .map(|(source, parameter, d)| Controller {
            source,
            parameter,
            target: controller_target(d, mixer_base),
        })
        .collect();
    if p.patterns.iter().all(|x| x.notes.is_empty()) && p.channels.is_empty() && p.version.is_empty() {
        return Err("The file holds no recognisable project data.".into());
    }
    // Default patterns carry no "new pattern" event for empty slots; keep ids sorted.
    p.patterns.sort_by_key(|x| x.iid);
    Ok(p)
}

fn controller_target(d: u16, mixer_base: u16) -> Target {
    if mixer_base == 0x2000 && d >= 0x4000 {
        Target::Project
    } else if d >= mixer_base {
        Target::Mixer((d - mixer_base) >> 6, (d - mixer_base) & 0x3f)
    } else if d == 0x4000 {
        Target::Project
    } else {
        Target::Channel(d)
    }
}

fn with_ch(p: &mut Project, c: Option<usize>, f: impl FnOnce(&mut Channel)) {
    if let Some(i) = c {
        f(&mut p.channels[i]);
    }
}

fn with_pat(p: &mut Project, c: Option<usize>, f: impl FnOnce(&mut Pattern)) {
    if let Some(i) = c {
        f(&mut p.patterns[i]);
    }
}

fn ensure_arrangement(p: &mut Project, cur: &mut Option<usize>) -> usize {
    if let Some(a) = *cur {
        return a;
    }
    // Files from before multiple arrangements: one implicit playlist.
    p.arrangements.push(Arrangement { iid: 0, name: "Arrangement".into(), ..Default::default() });
    *cur = Some(p.arrangements.len() - 1);
    p.arrangements.len() - 1
}

fn read_notes(d: &[u8]) -> Vec<Note> {
    d.chunks_exact(24)
        .map(|r| {
            let flags = u16_at(r, 4).unwrap_or(0);
            Note {
                pos: u32_at(r, 0).unwrap_or(0),
                channel: u16_at(r, 6).unwrap_or(0),
                len: u32_at(r, 8).unwrap_or(0),
                key: u16_at(r, 12).unwrap_or(60),
                group: u16_at(r, 14).unwrap_or(0),
                fine_pitch: r[16],
                release: r[18],
                pan: r[20],
                velocity: r[21],
                mod_x: r[22],
                mod_y: r[23],
                slide: flags & 0x0008 != 0,
            }
        })
        .collect()
}

/// Playlist items grew over the years: 32 bytes, 60 (clip properties), 80
/// (version 25). The first 32 bytes keep their layout. Every record carries
/// the pattern base word at offset 4, so the true record size is the one
/// where all records line up on it; the version decides only if that fails.
fn playlist_record_size(d: &[u8], ver: Ver) -> usize {
    let valid = |size: usize| d.len() % size == 0 && d.chunks_exact(size).all(|r| u16_at(r, 4) == Some(PATTERN_BASE));
    let by_version = if ver >= Ver(25, 0, 0) {
        80
    } else if ver >= Ver(20, 99, 0) {
        60
    } else {
        32
    };
    [by_version, 80, 60, 32].into_iter().chain((36..=256).step_by(4)).find(|&s| valid(s)).unwrap_or(by_version)
}

fn read_playlist(d: &[u8], ver: Ver) -> Vec<Item> {
    let size = playlist_record_size(d, ver);
    let max_track: i32 = if ver >= Ver(12, 9, 1) || ver == Ver(0, 0, 0) { 499 } else { 198 };
    d.chunks_exact(size)
        .map(|r| {
            let idx = u16_at(r, 6).unwrap_or(0);
            let base = u16_at(r, 4).unwrap_or(PATTERN_BASE);
            let rv = u16_at(r, 12).unwrap_or(0) as i32;
            let flags = u16_at(r, 18).unwrap_or(0);
            Item {
                pos: u32_at(r, 0).unwrap_or(0),
                len: u32_at(r, 8).unwrap_or(0),
                track: (max_track - rv).clamp(0, 499) as u16,
                what: if idx > base { ItemRef::Pattern(idx - base) } else { ItemRef::Channel(idx) },
                start_offset: f32_at(r, 24).filter(|v| v.is_finite()).unwrap_or(-1.0),
                end_offset: f32_at(r, 28).filter(|v| v.is_finite()).unwrap_or(-1.0),
                muted: flags & 0x2000 != 0,
                group: u16_at(r, 14).unwrap_or(0),
                flags,
            }
        })
        .collect()
}

fn automation_points(d: &[u8]) -> Vec<AutoPoint> {
    let Some(n) = u32_at(d, 17) else { return Vec::new() };
    let mut out = Vec::new();
    let mut pos = 0.0;
    for i in 0..n as usize {
        let o = 21 + i * 24;
        let (Some(dx), Some(v), Some(t)) = (f64_at(d, o), f64_at(d, o + 8), f32_at(d, o + 16)) else { break };
        pos += dx;
        out.push(AutoPoint { pos, value: v, tension: t });
    }
    out
}

/// Third-party plugins are stored as a record list: a kind word, then
/// `(id: u32, size: u64, bytes)` records. Anything else is a native plugin's
/// own state, which stays opaque — only file paths are lifted out of it.
fn read_plugin_state(pl: &mut Plugin, d: &[u8]) {
    pl.state_len = d.len();
    if let Some(v) = read_vst_records(d) {
        pl.vst = Some(v);
        return;
    }
    pl.paths = embedded_paths(d);
    pl.portable_state = portable_state(d).to_vec();
    if pl.internal.eq_ignore_ascii_case("MIDI Out") {
        pl.midi_out = midi_out(d);
    }
    // Sound-font players: the program number sits just before a fixed 7-byte tail.
    if pl.paths.iter().any(|p| p.to_ascii_lowercase().ends_with(".sf2")) && d.len() > 11 {
        if let Some(prog) = u32_at(d, d.len() - 11).filter(|&v| v < 128) {
            pl.program = Some(prog);
        }
    }
}

/// Plugins built on the common C++ plugin framework save their settings as
/// "VC2!", a u32 length, then that many bytes of XML and a NUL. A native build
/// wraps the blob in its own header; the VST builds of the same plugin take
/// the bare blob as their state.
fn portable_state(d: &[u8]) -> &[u8] {
    const MAGIC: &[u8; 4] = b"VC2!";
    let Some(at) = d.windows(4).take(64).position(|w| w == MAGIC) else { return &[] };
    let Some(len) = u32_at(d, at + 4).map(|n| n as usize) else { return &[] };
    let end = at + 8 + len + 1;
    if end > d.len() || d.get(at + 8) != Some(&b'<') {
        return &[];
    }
    &d[at..end]
}

/// The MIDI-out generator's settings: version, MIDI channel at 4, the port
/// at 24 and the program number at 30.
fn midi_out(d: &[u8]) -> Option<MidiOut> {
    if d.len() < 32 {
        return None;
    }
    Some(MidiOut {
        channel: (u32_at(d, 4)? & 15) as u8,
        port: u32_at(d, 24)? as i32,
        program: (u16::from_le_bytes([d[30], d[31]]) & 127) as u8,
    })
}

const VST_IDS: [u32; 13] = [1, 2, 30, 31, 32, 50, 51, 52, 53, 54, 55, 56, 57];

fn read_vst_records(d: &[u8]) -> Option<Vst> {
    let kind = u32_at(d, 0)?;
    if !(1..=64).contains(&kind) || d.len() < 16 {
        return None;
    }
    let mut v = Vst { midi_in: -1, ..Vst::default() };
    let mut i = 4;
    let mut known = 0;
    while i < d.len() {
        let id = u32_at(d, i)?;
        let n = usize::try_from(u64_at(d, i + 4)?).ok()?;
        let body = d.get(i + 12..(i + 12).checked_add(n)?)?;
        i += 12 + n;
        if !VST_IDS.contains(&id) && id > 64 {
            return None;
        }
        known += VST_IDS.contains(&id) as usize;
        let s = || String::from_utf8_lossy(body).trim_end_matches('\0').to_string();
        match id {
            // MIDI input port, then output port (-1 = none).
            1 => v.midi_in = u32_at(body, 0).map_or(-1, |p| p as i32),
            31 => v.inputs = u32_at(body, 0).unwrap_or(0),
            32 => v.outputs = u32_at(body, 0).unwrap_or(0),
            51 => v.fourcc = s(),
            52 => v.guid = body.iter().map(|b| format!("{b:02x}")).collect(),
            53 => v.state = vst_state(body),
            54 => v.name = s(),
            55 => v.path = s(),
            56 => v.vendor = s(),
            _ => {}
        }
    }
    (known > 0 && (!v.path.is_empty() || !v.name.is_empty())).then_some(v)
}

/// VST3 instances keep an 80-byte header, then `(id u32, size u64, bytes)`
/// records: 3 = the processor's state, 2 = the controller's, 4 = the
/// parameter-id table the file uses for automation.
fn vst3_state(b: &[u8]) -> Option<VstState> {
    if b.len() < 80 || u32_at(b, 0)? != 1 || u32_at(b, 8)? != 64 {
        return None;
    }
    let (mut component, mut controller) = (None, Vec::new());
    let mut i = 80;
    while i < b.len() {
        let id = u32_at(b, i)?;
        let n = usize::try_from(u64_at(b, i + 4)?).ok()?;
        let body = b.get(i + 12..(i + 12).checked_add(n)?)?;
        match id {
            3 => component = Some(body.to_vec()),
            2 => controller = body.to_vec(),
            _ => {}
        }
        i += 12 + n;
    }
    Some(VstState::Vst3 { component: component?, controller })
}

/// The host keeps a short header in front of the plugin's own data:
/// `marker i32 (<0), flags u8, program i32, chunk size u32, …`. Flag bit 3
/// means the plugin saved a chunk (it ends the record); otherwise a count and
/// that many f32 parameter values follow (at offset 21, or 13 in older files).
/// Anything that doesn't add up exactly is kept raw and never sent to a plugin.
fn vst_state(b: &[u8]) -> VstState {
    if b.is_empty() {
        return VstState::None;
    }
    if let Some(s) = vst3_state(b) {
        return s;
    }
    if b.len() >= 13 && i32_at(b, 0).map_or(false, |m| m < 0) {
        if b[4] & 0x08 != 0 {
            let size = u32_at(b, 9).unwrap_or(u32::MAX) as usize;
            if size <= b.len() && matches!(b.len() - size, 13 | 21) {
                return VstState::Chunk(b[b.len() - size..].to_vec());
            }
        } else {
            for off in [21usize, 13] {
                let Some(n) = u32_at(b, off).map(|n| n as usize) else { continue };
                let end = off + 4 + n * 4;
                if n > 0 && n < 65_536 && end <= b.len() {
                    return VstState::Params(b[off + 4..end].chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect());
                }
            }
        }
    }
    VstState::Raw(b.to_vec())
}

/// Mixer parameters: 12-byte records `(_, id, _, track/slot, value)`.
fn apply_mixer_params(inserts: &mut [Insert], d: &[u8]) {
    for r in d.chunks_exact(12) {
        let id = r[4];
        let cd = u16_at(r, 6).unwrap_or(0);
        let msg = i32_at(r, 8).unwrap_or(0);
        let ins = ((cd >> 6) & 0x7f) as usize;
        let slot = cd & 0x3f;
        let Some(t) = inserts.get_mut(ins) else { continue };
        match id {
            0 | 1 => {
                if let Some(s) = t.slots.iter_mut().find(|s| s.index == slot) {
                    if id == 0 {
                        s.enabled = msg != 0;
                    } else {
                        s.mix = msg as f64 / 12800.0;
                    }
                }
            }
            64..=191 => {
                let to = (id - 64) as u16;
                t.sends.retain(|s| s.0 != to);
                t.sends.push((to, msg as f64 / 12800.0));
            }
            192 => t.volume = msg as f64 / 12800.0,
            193 => t.pan = (msg as f64 / 6400.0).clamp(-1.0, 1.0),
            194 => t.stereo_sep = msg as f64 / 64.0,
            208..=210 => t.eq.gain[(id - 208) as usize] = msg,
            216..=218 => t.eq.freq[(id - 216) as usize] = msg,
            224..=226 => t.eq.q[(id - 224) as usize] = msg,
            _ => {}
        }
    }
}

// ── JSON ─────────────────────────────────────────────────────────────────────

fn color(j: &mut Json, k: &str, c: Option<u32>) {
    match c {
        // Stored as 0x00BBGGRR.
        Some(v) => j.str(k, &format!("#{:02x}{:02x}{:02x}", v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff)),
        None => j.null(k),
    }
}

fn plugin_json(j: &mut Json, k: &str, pl: &Plugin) {
    j.obj_k(k);
    j.str("internal", &pl.internal);
    j.str("name", &pl.name);
    color(j, "color", pl.color);
    j.num("stateLen", pl.state_len as f64);
    j.arr_k("paths");
    for s in &pl.paths {
        j.str_item(s);
    }
    j.end_arr();
    match pl.program {
        Some(v) => j.num("program", v as f64),
        None => j.null("program"),
    }
    match pl.midi_out {
        Some(m) => {
            j.obj_k("midiOut");
            j.num("channel", m.channel as f64);
            j.num("port", m.port as f64);
            j.num("program", m.program as f64);
            j.end_obj();
        }
        None => j.null("midiOut"),
    }
    if pl.portable_state.is_empty() {
        j.null("portableState");
    } else {
        j.str("portableState", &base64(&pl.portable_state));
    }
    match &pl.vst {
        None => j.null("vst"),
        Some(v) => {
            j.obj_k("vst");
            j.str("name", &v.name);
            j.str("vendor", &v.vendor);
            j.str("path", &v.path);
            j.str("fourcc", &v.fourcc);
            j.str("guid", &v.guid);
            j.num("inputs", v.inputs as f64);
            j.num("outputs", v.outputs as f64);
            j.num("midiIn", v.midi_in as f64);
            // Same tagged form the desktop host saves: 'C' + chunk / 'P' + f32s.
            match &v.state {
                VstState::None => j.null("state"),
                VstState::Chunk(c) => {
                    let mut b = Vec::with_capacity(c.len() + 1);
                    b.push(b'C');
                    b.extend_from_slice(c);
                    j.str("state", &base64(&b));
                }
                VstState::Params(p) => {
                    let mut b = vec![b'P'];
                    for x in p {
                        b.extend_from_slice(&x.to_le_bytes());
                    }
                    j.str("state", &base64(&b));
                }
                VstState::Vst3 { component, controller } => {
                    // Same tagged form as the desktop host: '3' + u32 length + both streams.
                    let mut b = Vec::with_capacity(5 + component.len() + controller.len());
                    b.push(b'3');
                    b.extend_from_slice(&(component.len() as u32).to_le_bytes());
                    b.extend_from_slice(component);
                    b.extend_from_slice(controller);
                    j.str("state", &base64(&b));
                }
                VstState::Raw(_) => j.null("state"),
            }
            j.str("format", if v.path.trim_end_matches(['\\', '/']).to_ascii_lowercase().ends_with(".vst3") || matches!(v.state, VstState::Vst3 { .. }) { "vst3" } else { "vst2" });
            j.str(
                "stateKind",
                match v.state {
                    VstState::None => "none",
                    VstState::Chunk(_) => "chunk",
                    VstState::Params(_) => "params",
                    VstState::Vst3 { .. } => "vst3",
                    VstState::Raw(_) => "unknown",
                },
            );
            j.end_obj();
        }
    }
    j.end_obj();
}

impl Project {
    pub fn to_json(&self) -> String {
        let mut j = Json::default();
        j.obj();
        j.str("format", "pattern-project");
        j.str("version", &self.version);
        j.num("build", self.build as f64);
        j.num("ppq", self.ppq as f64);
        j.num("tempo", self.tempo);
        j.arr_k("timeSig");
        j.num_item(self.time_sig.0 as f64);
        j.num_item(self.time_sig.1 as f64);
        j.end_arr();
        j.num("mainPitch", self.main_pitch as f64);
        j.str("title", &self.title);
        j.str("artists", &self.artists);
        j.str("genre", &self.genre);
        j.str("comments", &self.comments);
        j.str("dataPath", &self.data_path);
        match self.current_arrangement {
            Some(v) => j.num("currentArrangement", v as f64),
            None => j.null("currentArrangement"),
        }

        j.arr_k("channels");
        for c in &self.channels {
            j.obj();
            j.num("iid", c.iid as f64);
            j.str("kind", c.kind.as_str());
            j.str("name", if c.plugin.name.is_empty() { &c.legacy_name } else { &c.plugin.name });
            plugin_json(&mut j, "plugin", &c.plugin);
            j.str("sample", &c.sample_path);
            j.bool("enabled", c.enabled);
            j.num("volume", c.volume);
            j.num("pan", c.pan);
            j.num("pitchCents", c.pitch_cents as f64);
            match c.mixer {
                Some(m) => j.num("mixer", m as f64),
                None => j.null("mixer"),
            }
            color(&mut j, "color", c.color.or(c.plugin.color));
            j.num("rootNote", c.root_note as f64);
            j.num("fineTune", c.fine_tune as f64);
            j.arr_k("cutGroup");
            j.num_item(c.cut_group.0 as f64);
            j.num_item(c.cut_group.1 as f64);
            j.end_arr();
            j.bool("reversed", c.reversed);
            j.arr_k("children");
            for &k in &c.children {
                j.num_item(k as f64);
            }
            j.end_arr();
            j.arr_k("automation");
            for a in &c.automation {
                j.obj();
                j.num("pos", a.pos);
                j.num("value", a.value);
                j.num("tension", a.tension as f64);
                j.end_obj();
            }
            j.end_arr();
            j.end_obj();
        }
        j.end_arr();

        j.arr_k("patterns");
        for pt in &self.patterns {
            j.obj();
            j.num("iid", pt.iid as f64);
            j.str("name", &pt.name);
            color(&mut j, "color", pt.color);
            j.num("length", pt.length as f64);
            j.bool("looped", pt.looped);
            // Notes as flat rows keep the payload small:
            // [channel, pos, len, key, velocity, pan, finePitch, release, slide, modX, modY]
            j.arr_k("notes");
            for n in &pt.notes {
                j.sep_raw();
                j.s.push_str(&format!(
                    "[{},{},{},{},{},{},{},{},{},{},{}]",
                    n.channel, n.pos, n.len, n.key, n.velocity, n.pan, n.fine_pitch, n.release, n.slide as u8, n.mod_x, n.mod_y
                ));
            }
            j.end_arr();
            j.end_obj();
        }
        j.end_arr();

        j.arr_k("arrangements");
        for a in &self.arrangements {
            j.obj();
            j.num("iid", a.iid as f64);
            j.str("name", &a.name);
            // [pos, len, track, kind (0 pattern / 1 channel), ref, startOffset, endOffset, muted, group]
            j.arr_k("items");
            for it in &a.items {
                let (k, r) = match it.what {
                    ItemRef::Pattern(x) => (0, x),
                    ItemRef::Channel(x) => (1, x),
                };
                j.sep_raw();
                j.s.push_str(&format!(
                    "[{},{},{},{},{},{},{},{},{}]",
                    it.pos,
                    it.len,
                    it.track,
                    k,
                    r,
                    fnum(it.start_offset),
                    fnum(it.end_offset),
                    it.muted as u8,
                    it.group
                ));
            }
            j.end_arr();
            j.arr_k("tracks");
            for t in &a.tracks {
                if t.name.is_empty() && t.color.is_none() {
                    continue;
                }
                j.obj();
                j.num("index", t.index as f64);
                j.str("name", &t.name);
                color(&mut j, "color", t.color);
                j.bool("enabled", t.enabled);
                j.end_obj();
            }
            j.end_arr();
            j.arr_k("markers");
            for m in &a.markers {
                j.obj();
                j.num("pos", m.pos as f64);
                j.num("kind", m.kind as f64);
                j.str("name", &m.name);
                match m.signature {
                    Some((n, d)) => {
                        j.arr_k("signature");
                        j.num_item(n as f64);
                        j.num_item(d as f64);
                        j.end_arr();
                    }
                    None => j.null("signature"),
                }
                j.end_obj();
            }
            j.end_arr();
            j.end_obj();
        }
        j.end_arr();

        j.arr_k("inserts");
        for t in &self.inserts {
            j.obj();
            j.num("index", t.index as f64);
            j.str("name", &t.name);
            color(&mut j, "color", t.color);
            j.num("volume", t.volume);
            j.num("pan", t.pan);
            j.bool("muted", t.muted());
            j.bool("fxBypassed", t.fx_bypassed());
            j.bool("polarity", t.polarity());
            j.num("output", t.output as f64);
            j.arr_k("routes");
            for (i, &r) in t.routes.iter().enumerate() {
                if r {
                    j.num_item(i as f64);
                }
            }
            j.end_arr();
            j.arr_k("sends");
            for &(to, lvl) in &t.sends {
                j.sep_raw();
                j.s.push_str(&format!("[{},{}]", to, fnum(lvl as f32)));
            }
            j.end_arr();
            j.arr_k("slots");
            for s in &t.slots {
                j.obj();
                j.num("index", s.index as f64);
                j.bool("enabled", s.enabled);
                j.num("mix", s.mix);
                plugin_json(&mut j, "plugin", &s.plugin);
                j.end_obj();
            }
            j.end_arr();
            j.obj_k("eq");
            for (k, v) in [("gain", t.eq.gain), ("freq", t.eq.freq), ("q", t.eq.q)] {
                j.arr_k(k);
                for x in v {
                    j.num_item(x as f64);
                }
                j.end_arr();
            }
            j.end_obj();
            j.end_obj();
        }
        j.end_arr();

        // [source channel, parameter, kind (0 unknown / 1 channel / 2 mixer / 3 project), a, b]
        j.arr_k("controllers");
        for c in &self.controllers {
            let (k, a, b) = match c.target {
                Target::Unknown => (0, 0, 0),
                Target::Channel(x) => (1, x, 0),
                Target::Mixer(i, s) => (2, i, s),
                Target::Project => (3, 0, 0),
            };
            j.sep_raw();
            j.s.push_str(&format!("[{},{},{},{},{}]", c.source, c.parameter, k, a, b));
        }
        j.end_arr();

        j.arr_k("warnings");
        for w in &self.warnings {
            j.str_item(w);
        }
        j.end_arr();
        j.end_obj();
        j.s
    }
}

fn fnum(v: f32) -> String {
    if !v.is_finite() {
        "null".into()
    } else if v == v.trunc() {
        format!("{}", v as i64)
    } else {
        format!("{}", (v as f64 * 1e4).round() / 1e4)
    }
}

#[cfg(test)]
pub(crate) mod tests;
