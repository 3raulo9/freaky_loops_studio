//! Smoke test: load a VST2 plugin, bounce a short phrase offline and report
//! the output level.  `cargo run -p fls-native --example render -- <plugin.dll>`

use fls_native::{Plugin, RenderNote};

fn main() {
    let path = std::env::args().nth(1).expect("usage: render <plugin.dll>");
    println!("arch: {}", fls_native::pe::arch(&path));
    let plugin = Plugin::load(&path, 44100.0).unwrap_or_else(|e| panic!("load failed: {e}"));
    println!("{:?}", plugin.info);
    let notes: Vec<RenderNote> = [60, 64, 67, 72]
        .iter()
        .enumerate()
        .map(|(i, &p)| RenderNote { pitch: p, velocity: 100, start_frame: i as i64 * 11025, end_frame: i as i64 * 11025 + 9000 })
        .collect();
    let pcm = plugin.render_offline(&notes, 44100.0, 44100 * 2, 44100.0);
    let peak = pcm.iter().fold(0f32, |m, s| m.max(s.abs()));
    let rms = (pcm.iter().map(|s| s * s).sum::<f32>() / pcm.len() as f32).sqrt();
    println!("frames={} peak={peak:.4} rms={rms:.5}", pcm.len() / 2);
    let state = plugin.save_state();
    println!("state bytes: {}", state.to_bytes().len());
    plugin.load_state(&state);
}
