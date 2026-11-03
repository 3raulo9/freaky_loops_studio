//! Writer tests on synthetic files (no third-party project files are checked
//! in), plus a machine test that round-trips a local corpus.

use super::*;
use crate::tests::{item, note, vst_blob, W};

fn levels(pan: i32, vol: i32) -> Vec<u8> {
    [pan, vol, 0, 0, 0, 0].iter().flat_map(|v| v.to_le_bytes()).collect()
}

/// Two patterns, three channels (sampler, plugin, sampler), one arrangement,
/// a mixer with two inserts and a controller from channel 2.
fn project() -> Vec<u8> {
    let mut w = W::new("25.1.6.4997");
    w.dword(E_TEMPO, 128_500).byte(E_TIMESIG_NUM, 4).byte(E_TIMESIG_BEAT, 4);
    w.word(E_PAT_NEW, 1).data(E_PAT_NOTES, &[note(0, 0, 0, 60, 100, false), note(96, 1, 48, 64, 90, true), note(192, 2, 0, 60, 80, false)].concat());
    w.word(E_PAT_NEW, 2).data(E_PAT_NOTES, &note(0, 2, 96, 67, 100, false));
    w.word(E_CH_NEW, 0).byte(E_CH_TYPE, 0).text(E_PL_NAME, "Kick").dword(E_PL_COLOR, 0x112233).data(E_CH_LEVELS, &levels(6400, 10000)).byte(E_CH_ROUTED, 1).text(E_CH_SAMPLE, "C:\\s\\kick.wav");
    w.word(E_PAT_NEW, 1).text(E_PAT_NAME, "Intro").dword(E_PAT_COLOR, 0x0033_2211);
    w.word(E_CH_NEW, 1).byte(E_CH_TYPE, 2).text(E_PL_INTERNAL, "Host").text(E_PL_NAME, "Lead").data(E_PL_STATE, &vst_blob("C:\\VST\\Space Synth.dll", b"CHUNKDATA"));
    w.data(E_CH_LEVELS, &levels(6400, 10000)).byte(E_CH_ROUTED, 2);
    w.word(E_CH_NEW, 2).byte(E_CH_TYPE, 0).text(E_PL_NAME, "Snare").data(E_CH_LEVELS, &levels(6400, 10000)).byte(E_CH_ROUTED, 0).text(E_CH_SAMPLE, "C:\\s\\snare.wav");
    w.word(E_ARR_NEW, 0).text(E_ARR_NAME, "Song");
    w.data(E_PLAYLIST, &[item(0, 384, 0, 499, PATTERN_BASE + 1, 60, false), item(384, 384, 1, 499, PATTERN_BASE + 2, 60, false), item(0, 768, 3, 499, 2, 60, false)].concat());
    let mut flags = vec![0u8; 12];
    flags[4] = 0b1100;
    w.data(E_INS_FLAGS, &flags).dword(E_INS_OUTPUT, u32::MAX);
    w.data(E_INS_FLAGS, &flags).text(E_INS_NAME, "Bus").dword(E_INS_OUTPUT, u32::MAX);
    let mut mp = Vec::new();
    for (id, ins, val) in [(192u8, 1u16, 10000i32), (193, 1, 0)] {
        mp.extend_from_slice(&[0, 0, 0, 0, id, 0]);
        mp.extend_from_slice(&(ins << 6).to_le_bytes());
        mp.extend_from_slice(&val.to_le_bytes());
    }
    w.data(E_MIXER_PARAMS, &mp);
    // Automation link: source channel 2 → channel 0 volume.
    let mut rc = vec![0u8; 20];
    rc[2..4].copy_from_slice(&2u16.to_le_bytes());
    rc[10..12].copy_from_slice(&0u16.to_le_bytes());
    w.data(E_REMOTE_CTRL, &rc);
    let mut f = w.file(96);
    f[10..12].copy_from_slice(&3u16.to_le_bytes());
    f
}

fn notes_of(p: &Project, iid: u16) -> Vec<(u16, u32, u32, u16, u8)> {
    p.patterns.iter().find(|x| x.iid == iid).map(|x| x.notes.iter().map(|n| (n.channel, n.pos, n.len, n.key, n.velocity)).collect()).unwrap_or_default()
}

#[test]
fn no_edits_is_byte_identical() {
    let f = project();
    assert_eq!(write(&f, "").unwrap(), f);
    assert_eq!(write(&f, "{}").unwrap(), f);
}

#[test]
fn edits_channels_and_project_values() {
    let f = project();
    let out = write(&f, r##"{ "tempo": 140.25, "timeSig": [3, 4],
        "channels": { "0": { "name": "Big Kick", "volume": 0.5, "pan": -0.5, "mixer": 4, "color": "#ff0000", "enabled": false } } }"##).unwrap();
    let p = parse(&out).unwrap();
    assert_eq!(p.tempo, 140.25);
    assert_eq!(p.time_sig, (3, 4));
    let k = &p.channels[0];
    assert_eq!(k.plugin.name, "Big Kick");
    assert!((k.volume - 0.5).abs() < 1e-4 && (k.pan + 0.5).abs() < 1e-4);
    assert_eq!(k.mixer, Some(4));
    assert!(!k.enabled);
    assert_eq!(k.plugin.color, Some(0x0000ff));
    // Everything else is as it was.
    assert_eq!(p.channels[1].plugin.name, "Lead");
    assert_eq!(notes_of(&p, 1), notes_of(&parse(&f).unwrap(), 1));
}

#[test]
fn rewrites_one_channels_notes_and_keeps_the_rest() {
    let f = project();
    let out = write(&f, r#"{ "patterns": { "1": { "name": "Verse", "length": 384,
        "notes": { "keep": [0, 2], "rows": [[1, 48, 24, 72, 110, 64, 120, 64, 0, 128, 128]] } } } }"#).unwrap();
    let p = parse(&out).unwrap();
    assert_eq!(notes_of(&p, 1), vec![(0, 0, 0, 60, 100), (1, 48, 24, 72, 110), (2, 192, 0, 60, 80)]);
    let pt = p.patterns.iter().find(|x| x.iid == 1).unwrap();
    assert_eq!((pt.name.as_str(), pt.length), ("Verse", 384));
    assert_eq!(notes_of(&p, 2), vec![(2, 0, 96, 67, 100)]);
}

#[test]
fn adds_patterns_and_channels() {
    let f = project();
    let out = write(&f, r##"{
        "newChannels": [ { "kind": "sampler", "name": "Clap", "volume": 0.7, "pan": 0.25, "mixer": 3, "sample": "D:\\clap.wav", "color": "#00ff00" },
                         { "kind": "vst", "name": "Pad", "vst": { "name": "Pad Synth", "path": "C:\\VST3\\Pad.vst3", "state": "M0E=" } } ],
        "newPatterns": [ { "iid": 7, "name": "Fill", "rows": [[-1, 0, 0, 60, 100], [-2, 96, 96, 48, 100]] } ] }"##).unwrap();
    let p = parse(&out).unwrap();
    assert_eq!(u16::from_le_bytes([out[10], out[11]]), 5);
    let clap = p.channels.iter().find(|c| c.iid == 3).expect("clap");
    assert_eq!((clap.plugin.name.as_str(), clap.sample_path.as_str(), clap.mixer), ("Clap", "D:\\clap.wav", Some(3)));
    assert!((clap.volume - 0.7).abs() < 1e-4 && (clap.pan - 0.25).abs() < 1e-4);
    let pad = p.channels.iter().find(|c| c.iid == 4).expect("pad");
    let v = pad.plugin.vst.as_ref().expect("pad plugin");
    assert_eq!((v.name.as_str(), v.path.as_str()), ("Pad Synth", "C:\\VST3\\Pad.vst3"));
    // The template channel's plugin identity doesn't carry over.
    assert_eq!(v.fourcc, "");
    assert_eq!(notes_of(&p, 7), vec![(3, 0, 0, 60, 100), (4, 96, 96, 48, 100)]);
    assert_eq!(p.patterns.iter().find(|x| x.iid == 7).unwrap().name, "Fill");
    // New patterns sit with the other pattern blocks, ahead of the channels.
    let (_, body) = events::split(&out).unwrap();
    let (evs, _) = raw_events(body);
    let pat7 = evs.iter().position(|e| e.id == E_PAT_NEW && e.int == 7).unwrap();
    let ch0 = evs.iter().position(|e| e.id == E_CH_NEW && e.int == 0).unwrap();
    assert!(pat7 < ch0);
}

#[test]
fn deleting_a_channel_renumbers_every_reference() {
    let f = project();
    let out = write(&f, r#"{ "deleteChannels": [1] }"#).unwrap();
    let p = parse(&out).unwrap();
    assert_eq!(u16::from_le_bytes([out[10], out[11]]), 2);
    assert_eq!(p.channels.iter().map(|c| (c.iid, c.plugin.name.as_str())).collect::<Vec<_>>(), vec![(0, "Kick"), (1, "Snare")]);
    // Snare's notes (was 2) now point at 1; the deleted channel's are gone.
    assert_eq!(notes_of(&p, 1), vec![(0, 0, 0, 60, 100), (1, 192, 0, 60, 80)]);
    assert_eq!(notes_of(&p, 2), vec![(1, 0, 96, 67, 100)]);
    let items = &p.arrangements[0].items;
    assert!(matches!(items[2].what, ItemRef::Channel(1)));
    assert_eq!(p.controllers[0].source, 1);
}

#[test]
fn arrangement_keeps_untouched_items_and_writes_new_ones() {
    let f = project();
    let out = write(&f, r#"{ "arrangement": { "iid": 0, "items": [ { "o": 0 }, [768, 192, 5, 0, 2, 96, 288, 1, -1] ] } }"#).unwrap();
    let p = parse(&out).unwrap();
    let a = &p.arrangements[0];
    assert_eq!(a.items.len(), 2);
    assert_eq!((a.items[0].pos, a.items[0].len, a.items[0].track), (0, 384, 0));
    let n = &a.items[1];
    assert_eq!((n.pos, n.len, n.track, n.muted, n.start_offset, n.end_offset), (768, 192, 5, true, 96.0, 288.0));
    assert!(matches!(n.what, ItemRef::Pattern(2)));
    // The kept record is the original's bytes.
    let orig = parse(&f).unwrap();
    assert_eq!(orig.arrangements[0].items[0].flags, a.items[0].flags);
}

#[test]
fn replaces_plugin_states() {
    let f = project();
    // 'C' + new chunk, base64.
    let out = write(&f, r#"{ "channels": { "1": { "state": "Q05FV0NIVU5L" } } }"#).unwrap();
    let p = parse(&out).unwrap();
    let v = p.channels[1].plugin.vst.as_ref().unwrap();
    assert!(matches!(&v.state, VstState::Chunk(c) if c == b"NEWCHUNK"));
    assert_eq!(v.path, "C:\\VST\\Space Synth.dll");
    // A VST3 state keeps the layout: header + processor + controller.
    let tagged: Vec<u8> = [b"3".as_slice(), &4u32.to_le_bytes(), b"PROC", b"CTRL"].concat();
    let b64: String = crate::text::base64(&tagged);
    let out = write(&f, &format!(r#"{{ "channels": {{ "1": {{ "state": "{b64}" }} }} }}"#)).unwrap();
    let p = parse(&out).unwrap();
    match &p.channels[1].plugin.vst.as_ref().unwrap().state {
        VstState::Vst3 { component, controller } => assert_eq!((component.as_slice(), controller.as_slice()), (b"PROC".as_slice(), b"CTRL".as_slice())),
        other => panic!("{other:?}"),
    }
}

#[test]
fn mixer_insert_values() {
    let f = project();
    let out = write(&f, r##"{ "inserts": { "1": { "name": "Drums", "volume": 0.5, "pan": 0.5, "muted": true, "color": "#102030" } } }"##).unwrap();
    let p = parse(&out).unwrap();
    let b = &p.inserts[1];
    assert_eq!((b.name.as_str(), b.color), ("Drums", Some(0x302010)));
    assert!((b.volume - 0.5).abs() < 1e-4 && (b.pan - 0.5).abs() < 1e-4);
    assert!(b.muted());
}

/// `FLS_FLP_LIST=<file with one .flp path per line> cargo test -p fls-projfile -- --ignored --nocapture corpus`
///
/// For every file: no edits → identical bytes; rewriting every pattern's
/// notes, the whole playlist and every channel's levels from the parsed
/// values → a file that parses back to the same project.
#[test]
#[ignore]
fn corpus_round_trip() {
    let list = std::env::var("FLS_FLP_LIST").expect("FLS_FLP_LIST");
    let (mut ok, mut identical, mut failed) = (0, 0, Vec::new());
    for path in std::fs::read_to_string(list).unwrap().lines().filter(|l| !l.trim().is_empty()) {
        let Ok(f) = std::fs::read(path.trim()) else { continue };
        let Ok(orig) = parse(&f) else { continue };
        if write(&f, "{}").unwrap() == f {
            identical += 1;
        } else {
            failed.push(format!("not identical: {path}"));
            continue;
        }
        // Full rewrite from parsed values.
        let mut pats = serde_json::Map::new();
        for pt in &orig.patterns {
            let rows: Vec<Value> = pt
                .notes
                .iter()
                .map(|n| serde_json::json!([n.channel, n.pos, n.len, n.key, n.velocity, n.pan, n.fine_pitch, n.release, n.slide as u8, n.mod_x, n.mod_y]))
                .collect();
            pats.insert(pt.iid.to_string(), serde_json::json!({ "notes": { "keep": [], "rows": rows } }));
        }
        let mut chans = serde_json::Map::new();
        for c in &orig.channels {
            chans.insert(c.iid.to_string(), serde_json::json!({ "volume": c.volume, "pan": c.pan }));
        }
        let arr = orig.arrangements.iter().find(|a| !a.items.is_empty()).map(|a| {
            let items: Vec<Value> = a
                .items
                .iter()
                .enumerate()
                .map(|(k, it)| {
                    let (kind, r) = match it.what {
                        ItemRef::Pattern(x) => (0, x),
                        ItemRef::Channel(x) => (1, x),
                    };
                    serde_json::json!([it.pos, it.len, it.track, kind, r, it.start_offset, it.end_offset, it.muted as u8, k])
                })
                .collect();
            serde_json::json!({ "iid": a.iid, "items": items })
        });
        let edits = serde_json::json!({ "patterns": pats, "channels": chans, "arrangement": arr });
        let out = match write(&f, &edits.to_string()) {
            Ok(o) => o,
            Err(e) => {
                failed.push(format!("write error {e}: {path}"));
                continue;
            }
        };
        let back = match parse(&out) {
            Ok(b) => b,
            Err(e) => {
                failed.push(format!("re-parse error {e}: {path}"));
                continue;
            }
        };
        let mut problems = Vec::new();
        for pt in &orig.patterns {
            let mut a: Vec<_> = pt.notes.iter().map(|n| (n.pos, n.channel, n.len, n.key, n.velocity, n.slide)).collect();
            let mut b: Vec<_> = back.patterns.iter().find(|x| x.iid == pt.iid).map(|x| x.notes.iter().map(|n| (n.pos, n.channel, n.len, n.key, n.velocity, n.slide)).collect()).unwrap_or_default();
            a.sort();
            b.sort();
            if a != b {
                problems.push(format!("pattern {} notes", pt.iid));
            }
        }
        for (c, d) in orig.channels.iter().zip(&back.channels) {
            if (c.volume - d.volume).abs() > 1e-3 || (c.pan - d.pan).abs() > 1e-3 || c.plugin.name != d.plugin.name || c.sample_path != d.sample_path {
                problems.push(format!("channel {}", c.iid));
            }
        }
        if let (Some(a), Some(b)) = (orig.arrangements.iter().find(|a| !a.items.is_empty()), back.arrangements.iter().find(|a| !a.items.is_empty())) {
            let key = |it: &Item| (it.pos, it.len, it.track, it.muted, (it.start_offset * 100.0) as i64, (it.end_offset * 100.0) as i64);
            if a.items.iter().map(key).collect::<Vec<_>>() != b.items.iter().map(key).collect::<Vec<_>>() {
                problems.push("playlist".into());
            }
        }
        if back.inserts.len() != orig.inserts.len() || back.channels.len() != orig.channels.len() {
            problems.push("structure".into());
        }
        if problems.is_empty() {
            ok += 1;
        } else {
            failed.push(format!("{}: {path}", problems.join(", ")));
        }
    }
    for f in failed.iter().take(30) {
        println!("{f}");
    }
    println!("identical {identical}, full rewrite ok {ok}, failed {}", failed.len());
    assert!(failed.is_empty());
}
