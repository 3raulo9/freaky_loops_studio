//! Synthetic files built event by event — no third-party project files are
//! checked in.

use super::*;

pub(crate) struct W {
    b: Vec<u8>,
    unicode: bool,
}

impl W {
    pub(crate) fn new(version: &str) -> W {
        let mut w = W { b: Vec::new(), unicode: parse_version(version) >= Ver(11, 5, 0) };
        w.data(E_VERSION, &[version.as_bytes(), b"\0"].concat());
        w
    }
    pub(crate) fn byte(&mut self, id: u8, v: u8) -> &mut Self {
        self.b.extend_from_slice(&[id, v]);
        self
    }
    pub(crate) fn word(&mut self, id: u8, v: u16) -> &mut Self {
        self.b.push(id);
        self.b.extend_from_slice(&v.to_le_bytes());
        self
    }
    pub(crate) fn dword(&mut self, id: u8, v: u32) -> &mut Self {
        self.b.push(id);
        self.b.extend_from_slice(&v.to_le_bytes());
        self
    }
    pub(crate) fn data(&mut self, id: u8, d: &[u8]) -> &mut Self {
        self.b.push(id);
        let mut n = d.len();
        loop {
            let mut c = (n & 0x7f) as u8;
            n >>= 7;
            if n > 0 {
                c |= 0x80;
            }
            self.b.push(c);
            if n == 0 {
                break;
            }
        }
        self.b.extend_from_slice(d);
        self
    }
    pub(crate) fn text(&mut self, id: u8, s: &str) -> &mut Self {
        let d: Vec<u8> = if self.unicode {
            s.encode_utf16().chain([0]).flat_map(|u| u.to_le_bytes()).collect()
        } else {
            s.chars().map(|c| c as u8).chain([0]).collect()
        };
        self.data(id, &d)
    }
    pub(crate) fn file(&self, ppq: u16) -> Vec<u8> {
        let mut f = b"FLhd".to_vec();
        f.extend_from_slice(&6u32.to_le_bytes());
        f.extend_from_slice(&0i16.to_le_bytes());
        f.extend_from_slice(&3u16.to_le_bytes());
        f.extend_from_slice(&ppq.to_le_bytes());
        f.extend_from_slice(b"FLdt");
        f.extend_from_slice(&(self.b.len() as u32).to_le_bytes());
        f.extend_from_slice(&self.b);
        f
    }
}

pub(crate) fn note(pos: u32, ch: u16, len: u32, key: u16, vel: u8, slide: bool) -> Vec<u8> {
    let mut r = Vec::new();
    r.extend_from_slice(&pos.to_le_bytes());
    r.extend_from_slice(&(0x4000u16 | if slide { 8 } else { 0 }).to_le_bytes());
    r.extend_from_slice(&ch.to_le_bytes());
    r.extend_from_slice(&len.to_le_bytes());
    r.extend_from_slice(&key.to_le_bytes());
    r.extend_from_slice(&0u16.to_le_bytes());
    r.extend_from_slice(&[120, 0, 64, 0, 64, vel, 128, 128]);
    r
}

pub(crate) fn item(pos: u32, len: u32, track: u16, max_track: u16, idx: u16, size: usize, muted: bool) -> Vec<u8> {
    let mut r = Vec::new();
    r.extend_from_slice(&pos.to_le_bytes());
    r.extend_from_slice(&PATTERN_BASE.to_le_bytes());
    r.extend_from_slice(&idx.to_le_bytes());
    r.extend_from_slice(&len.to_le_bytes());
    r.extend_from_slice(&(max_track - track).to_le_bytes());
    r.extend_from_slice(&0u16.to_le_bytes());
    r.extend_from_slice(&[120, 0]);
    r.extend_from_slice(&(64u16 | if muted { 0x2000 } else { 0 }).to_le_bytes());
    r.extend_from_slice(&[64, 100, 128, 128]);
    r.extend_from_slice(&(-1f32).to_le_bytes());
    r.extend_from_slice(&(-1f32).to_le_bytes());
    r.resize(size, 0);
    r
}

pub(crate) fn vst_blob(path: &str, chunk: &[u8]) -> Vec<u8> {
    let mut b = 12u32.to_le_bytes().to_vec();
    let mut rec = |id: u32, body: &[u8]| {
        b.extend_from_slice(&id.to_le_bytes());
        b.extend_from_slice(&(body.len() as u64).to_le_bytes());
        b.extend_from_slice(body);
    };
    rec(1, &[0xff; 20]);
    rec(51, b"Ab12");
    rec(54, b"Space Synth");
    rec(55, path.as_bytes());
    rec(56, b"Some Vendor");
    let mut st = (-9i32).to_le_bytes().to_vec();
    st.push(0x0d);
    st.extend_from_slice(&(-2i32).to_le_bytes());
    st.extend_from_slice(&(chunk.len() as u32).to_le_bytes());
    st.extend_from_slice(&[0; 8]);
    st.extend_from_slice(chunk);
    rec(53, &st);
    b
}

#[test]
fn reads_a_modern_project() {
    let mut w = W::new("25.1.6.4997");
    w.dword(E_TEMPO, 128_500).byte(E_TIMESIG_NUM, 3).byte(E_TIMESIG_BEAT, 4);
    w.text(E_TITLE, "Demo Ü");
    // Pattern 1 with a note and a step hit.
    w.word(E_PAT_NEW, 1).data(E_PAT_NOTES, &[note(0, 0, 0, 60, 100, false), note(96, 1, 48, 64, 90, true)].concat());
    w.word(E_PAT_NEW, 1).text(E_PAT_NAME, "Intro").dword(E_PAT_COLOR, 0x0033_2211);
    // Channel 0: sampler.
    w.word(E_CH_NEW, 0).byte(E_CH_TYPE, 0).text(E_PL_NAME, "Kick").text(E_CH_SAMPLE, "%Library%\\Drums\\Kick.wav").byte(E_CH_ROUTED, 3);
    let mut lv = Vec::new();
    for v in [3200i32, 12800, 100, 0, 0, 0] {
        lv.extend_from_slice(&v.to_le_bytes());
    }
    w.data(E_CH_LEVELS, &lv);
    // Channel 1: a hosted plugin.
    w.word(E_CH_NEW, 1).byte(E_CH_TYPE, 2).text(E_PL_INTERNAL, "Host").text(E_PL_NAME, "Lead");
    w.data(E_PL_STATE, &vst_blob("C:\\VST\\Space Synth.dll", b"CHUNKDATA"));
    // Arrangement with a muted and an unmuted clip.
    w.word(E_ARR_NEW, 0).text(E_ARR_NAME, "Song");
    w.data(E_PLAYLIST, &[item(0, 384, 0, 499, PATTERN_BASE + 1, 60, false), item(384, 384, 2, 499, PATTERN_BASE + 1, 60, true)].concat());
    w.dword(E_MK_POS, 0x0800_0000 | 768).byte(E_MK_NUM, 7).byte(E_MK_DEN, 8);
    w.dword(E_MK_POS, 0x0400_0000 | 33792).text(E_MK_NAME, "loop");
    w.data(E_TRACK_DATA, &[1, 0, 0, 0, 0x10, 0x20, 0x30, 0, 0, 0, 0, 0, 1]).text(E_TRACK_NAME, "Drums");
    // Mixer: master (one effect in slot 1), then insert 1.
    let mut flags = vec![0u8; 12];
    flags[4] = 0b1100;
    w.data(E_INS_FLAGS, &flags).word(E_SLOT_INDEX, 0).text(E_PL_INTERNAL, "Squash").data(E_PL_STATE, &[7, 0, 0, 0]).word(E_SLOT_INDEX, 1);
    w.dword(E_INS_OUTPUT, 0);
    w.text(E_INS_NAME, "Drum Bus").data(E_INS_FLAGS, &flags).data(E_INS_ROUTING, &[1, 0]).dword(E_INS_OUTPUT, u32::MAX);
    let mut mp = Vec::new();
    for (id, ins, val) in [(192u8, 1u16, 6400i32), (193, 1, -3200), (64, 1, 12800)] {
        mp.extend_from_slice(&[0, 0, 0, 0, id, 0]);
        mp.extend_from_slice(&(ins << 6).to_le_bytes());
        mp.extend_from_slice(&val.to_le_bytes());
    }
    w.data(E_MIXER_PARAMS, &mp);

    let p = parse(&w.file(96)).expect("parses");
    assert_eq!(p.version, "25.1.6.4997");
    assert_eq!(p.tempo, 128.5);
    assert_eq!(p.time_sig, (3, 4));
    assert_eq!(p.title, "Demo Ü");

    assert_eq!(p.patterns.len(), 1);
    let pt = &p.patterns[0];
    assert_eq!((pt.name.as_str(), pt.color, pt.notes.len()), ("Intro", Some(0x0033_2211), 2));
    assert!(pt.notes[1].slide && !pt.notes[0].slide);
    assert_eq!((pt.notes[1].pos, pt.notes[1].len, pt.notes[1].key, pt.notes[1].velocity), (96, 48, 64, 90));

    let kick = &p.channels[0];
    assert_eq!(kick.kind, ChannelKind::Sampler);
    assert_eq!(kick.sample_path, "%Library%\\Drums\\Kick.wav");
    assert_eq!(kick.mixer, Some(3));
    assert!((kick.pan + 0.5).abs() < 1e-9 && (kick.volume - 1.0).abs() < 1e-9);
    assert_eq!(kick.pitch_cents, 100);

    let vst = p.channels[1].plugin.vst.as_ref().expect("vst");
    assert_eq!((vst.name.as_str(), vst.vendor.as_str(), vst.fourcc.as_str()), ("Space Synth", "Some Vendor", "Ab12"));
    assert_eq!(vst.path, "C:\\VST\\Space Synth.dll");
    assert!(matches!(&vst.state, VstState::Chunk(c) if c == b"CHUNKDATA"));

    let a = &p.arrangements[0];
    assert_eq!(a.name, "Song");
    assert_eq!(a.items.len(), 2);
    assert!(matches!(a.items[0].what, ItemRef::Pattern(1)));
    assert_eq!((a.items[1].track, a.items[1].muted), (2, true));
    assert_eq!(a.markers[0].pos, 768);
    assert_eq!(a.markers[0].signature, Some((7, 8)));
    assert_eq!((a.markers[1].pos, a.markers[1].kind, a.markers[1].signature), (33792, 4, None));
    assert_eq!(a.tracks[0].name, "Drums");

    assert_eq!(p.inserts.len(), 2);
    assert_eq!(p.inserts[0].slots.len(), 1);
    assert_eq!(p.inserts[0].slots[0].index, 1);
    assert_eq!(p.inserts[0].slots[0].plugin.internal, "Squash");
    let bus = &p.inserts[1];
    assert_eq!(bus.name, "Drum Bus");
    assert_eq!((bus.volume, bus.pan), (0.5, -0.5));
    assert_eq!(bus.routes, vec![true, false]);
    assert_eq!(bus.sends, vec![(0, 1.0)]);
    assert!(!bus.muted());

    let json = p.to_json();
    assert!(json.contains("\"stateKind\":\"chunk\""));
    assert!(json.contains("\"state\":\"Q0NIVU5LREFUQQ==\"")); // "C" + "CHUNKDATA"
}

#[test]
fn reads_newest_playlist_records() {
    let mut w = W::new("25.2.3.5164");
    w.data(E_PLAYLIST, &[item(0, 96, 1, 499, PATTERN_BASE + 1, 80, false), item(96, 192, 2, 499, PATTERN_BASE + 3, 80, true)].concat());
    let p = parse(&w.file(96)).unwrap();
    let it = &p.arrangements[0].items;
    assert_eq!(it.len(), 2);
    assert_eq!((it[1].pos, it[1].len, it[1].track, it[1].muted), (96, 192, 2, true));
    assert!(matches!(it[1].what, ItemRef::Pattern(3)));
}

#[test]
fn reads_an_old_ansi_project() {
    let mut w = W::new("9.1.0");
    assert!(!w.unicode);
    w.word(E_TEMPO_COARSE, 95).word(E_TEMPO_FINE, 500);
    w.word(E_CH_NEW, 0).text(E_CH_LEGACY_NAME, "Caf\u{e9}").word(E_CH_VOL_WORD, 6400).word(E_CH_PAN_WORD, 12800);
    w.data(E_PLAYLIST, &item(96, 96, 5, 198, PATTERN_BASE + 2, 32, false));
    let p = parse(&w.file(96)).expect("parses");
    assert_eq!(p.tempo, 95.5);
    assert_eq!(p.channels[0].legacy_name, "Café");
    assert_eq!((p.channels[0].volume, p.channels[0].pan), (0.5, 1.0));
    let it = p.arrangements[0].items[0];
    assert_eq!(it.track, 5);
    assert!(matches!(it.what, ItemRef::Pattern(2)));
}

#[test]
fn reads_parameter_states() {
    // Newer layout: 21-byte header, then count + floats, then program info.
    let mut st = (-9i32).to_le_bytes().to_vec();
    st.push(0x05);
    st.extend_from_slice(&(-2i32).to_le_bytes());
    st.extend_from_slice(&[0; 12]);
    st.extend_from_slice(&2u32.to_le_bytes());
    st.extend_from_slice(&0.25f32.to_le_bytes());
    st.extend_from_slice(&0.5f32.to_le_bytes());
    st.extend_from_slice(&[1, 0, 0, 0, 0]);
    assert!(matches!(vst_state(&st), VstState::Params(p) if p == vec![0.25, 0.5]));
    // Older layout: count at offset 13.
    let mut old = (-9i32).to_le_bytes().to_vec();
    old.push(0x05);
    old.extend_from_slice(&[0; 8]);
    old.extend_from_slice(&1u32.to_le_bytes());
    old.extend_from_slice(&0.75f32.to_le_bytes());
    old.extend_from_slice(&[1, 0, 0, 0]);
    assert!(matches!(vst_state(&old), VstState::Params(p) if p == vec![0.75]));
}

/// VST3 state as the file stores it: 80-byte header, then records.
fn vst3_blob(component: &[u8], controller: Option<&[u8]>) -> Vec<u8> {
    let mut b = vec![0u8; 80];
    b[0] = 1;
    b[4] = 1;
    b[8] = 64;
    b[16] = 1;
    let mut rec = |id: u32, body: &[u8]| {
        b.extend_from_slice(&id.to_le_bytes());
        b.extend_from_slice(&(body.len() as u64).to_le_bytes());
        b.extend_from_slice(body);
    };
    rec(3, component);
    if let Some(c) = controller {
        rec(2, c);
    }
    rec(4, &[1, 0, 0, 0, 7, 0, 0, 0]);
    b
}

#[test]
fn reads_vst3_states() {
    match vst_state(&vst3_blob(b"proc", Some(b"ctl"))) {
        VstState::Vst3 { component, controller } => {
            assert_eq!(component, b"proc");
            assert_eq!(controller, b"ctl");
        }
        other => panic!("{other:?}"),
    }
    assert!(matches!(vst_state(&vst3_blob(b"only", None)), VstState::Vst3 { controller, .. } if controller.is_empty()));
    // A record running past the end is not a VST3 state.
    let mut bad = vst3_blob(b"proc", None);
    bad.truncate(bad.len() - 3);
    assert!(matches!(vst_state(&bad), VstState::Raw(_)));
}

#[test]
fn rejects_and_survives_garbage() {
    assert!(parse(b"RIFF....").is_err());
    let mut w = W::new("25.0.0");
    w.word(E_CH_NEW, 0).text(E_CH_SAMPLE, "x");
    let good = w.file(96);
    // Every truncation and a pile of random corruptions must not panic.
    for cut in 0..good.len() {
        let _ = parse(&good[..cut]);
    }
    let mut seed = 0x1234_5678u32;
    for _ in 0..2000 {
        let mut f = good.clone();
        for _ in 0..4 {
            seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            let i = 22 + (seed as usize % (f.len() - 22));
            f[i] = (seed >> 24) as u8;
        }
        let _ = parse(&f).map(|p| p.to_json());
    }
}

#[test]
fn decodes_automation_targets() {
    let rec = |src: u16, par: u16, dst: u16| -> Vec<u8> {
        let mut r = vec![0, 0];
        r.extend_from_slice(&src.to_le_bytes());
        r.extend_from_slice(&[0; 4]);
        r.extend_from_slice(&par.to_le_bytes());
        r.extend_from_slice(&dst.to_le_bytes());
        r.extend_from_slice(&[8, 0, 0, 0, 0xd5, 1, 0, 0]);
        r
    };
    let mut w = W::new("20.8.0.1377");
    w.data(E_REMOTE_CTRL, &rec(5, 0x11, 3)).data(E_REMOTE_CTRL, &rec(6, 0x1fc0, 0x2000 + (14 << 6))).data(E_REMOTE_CTRL, &rec(7, 5, 0x4000));
    let p = parse(&w.file(96)).unwrap();
    let t: Vec<Target> = p.controllers.iter().map(|c| c.target).collect();
    assert_eq!(t, vec![Target::Channel(3), Target::Mixer(14, 0), Target::Project]);

    let mut w = W::new("25.1.0.4858");
    w.data(E_REMOTE_CTRL, &rec(5, 0x1f01, 0x7000 + (3 << 6) + 1)).data(E_REMOTE_CTRL, &rec(6, 0x10, 0x8d));
    let p = parse(&w.file(96)).unwrap();
    let t: Vec<Target> = p.controllers.iter().map(|c| c.target).collect();
    assert_eq!(t, vec![Target::Mixer(3, 1), Target::Channel(0x8d)]);
}
