//! 32-bit helper process that hosts ONE 32-bit VST2 plugin on behalf of the
//! 64-bit desktop app (a process can only load DLLs of its own bitness).
//!
//! Protocol: one JSON object per line. Control comes in on stdin
//! (`{"t":"noteOn",...}`), status goes out on stdout (`{"t":"loaded",...}`).
//! The bridge plays the plugin's audio itself through its own engine; a crash
//! in the plugin takes down only this process, never the app.
//!
//! Args: `<plugin.dll> [owner-hwnd]` — the owner is the app's main window, so
//! the editor floats above it even though it lives in another process.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::Engine as _;
use fls_native::editor::EditorWindow;
use fls_native::{host_callback, log, AudioSource, Engine, Plugin, PluginState};
use serde_json::{json, Value};
use std::io::{BufRead, Write};
use std::sync::{Arc, Mutex};
use windows_sys::Win32::System::Threading::GetCurrentThreadId;
use windows_sys::Win32::UI::WindowsAndMessaging::*;

/// Work that must run on the UI thread (editor windows, state chunks).
enum UiCmd {
    ToggleEditor,
    CloseEditor,
    GetState(String),
    SetState(Vec<u8>),
    Device(Option<String>),
    Quit,
}

const WM_UI_CMD: u32 = WM_APP + 1;

static OUT: Mutex<()> = Mutex::new(());

fn send(v: Value) {
    let _g = OUT.lock();
    let mut out = std::io::stdout().lock();
    let _ = writeln!(out, "{v}");
    let _ = out.flush();
}

fn post(tid: u32, cmd: UiCmd) {
    let ptr = Box::into_raw(Box::new(cmd));
    if unsafe { PostThreadMessageW(tid, WM_UI_CMD, 0, ptr as isize) } == 0 {
        drop(unsafe { Box::from_raw(ptr) });
    }
}

fn main() {
    let mut args = std::env::args().skip(1);
    let Some(path) = args.next() else {
        send(json!({ "t": "error", "message": "No plugin path given to bridge." }));
        std::process::exit(2);
    };
    let owner: isize = args.next().and_then(|s| s.parse().ok()).unwrap_or(0);
    let device: Option<String> = args.next().filter(|s| !s.is_empty());
    let ui_tid = unsafe { GetCurrentThreadId() };

    // Make sure this thread has a message queue before anyone posts to it.
    let mut msg: MSG = unsafe { std::mem::zeroed() };
    unsafe { PeekMessageW(&mut msg, std::ptr::null_mut(), 0, 0, PM_NOREMOVE) };

    fls_native::crash::install();
    fls_native::crash::preload_system_runtimes();
    let mut engine = Engine::start_on(device.as_deref());
    // Live sample rate, shared with the control thread (it restores it after bounces).
    let live_rate = Arc::new(std::sync::atomic::AtomicU32::new(engine.sample_rate()));
    let plugin = match Plugin::load(&path, engine.sample_rate() as f32) {
        Ok(p) => p,
        Err(e) => {
            log::write(&format!("[bridge] load failed: {e}"));
            send(json!({ "t": "error", "message": e }));
            std::process::exit(1);
        }
    };
    let source: Arc<dyn AudioSource> = plugin.clone();
    let strip = engine.add_source(source);
    let clock = engine.clock();
    let i = &plugin.info;
    send(json!({
        "t": "loaded", "name": i.name, "vendor": i.vendor, "inputs": i.inputs, "outputs": i.outputs,
        "canReplacing": i.can_replacing, "isSynth": i.is_synth, "hasEditor": i.has_editor,
    }));

    // Peak meter for the UI, ~3x per second while there's signal.
    {
        let plugin = plugin.clone();
        std::thread::spawn(move || loop {
            std::thread::sleep(std::time::Duration::from_millis(300));
            let p = plugin.take_peak();
            if p > 0.0001 {
                send(json!({ "t": "peak", "peak": (p * 10000.0).round() / 10000.0 }));
            }
        });
    }

    // Control lines. Note/transport/render calls are thread-safe and run here;
    // anything touching windows is marshalled to the UI thread.
    {
        let plugin = plugin.clone();
        let live_rate = live_rate.clone();
        std::thread::spawn(move || {
            for line in std::io::stdin().lock().lines() {
                let Ok(line) = line else { break };
                let Ok(m) = serde_json::from_str::<Value>(&line) else { continue };
                let int = |k: &str, d: i64| m.get(k).and_then(Value::as_f64).map(|x| x as i64).unwrap_or(d);
                match m.get("t").and_then(Value::as_str).unwrap_or("") {
                    "noteOn" => plugin.note_on(int("pitch", 60) as i32, int("vel", 100) as i32),
                    "noteOff" => plugin.note_off(int("pitch", 60) as i32),
                    // A timed MIDI message, `delay` engine frames from now.
                    "midi" => {
                        let d: Vec<u8> = m.get("d").and_then(Value::as_array).map(|a| a.iter().map(|v| v.as_u64().unwrap_or(0) as u8).collect()).unwrap_or_default();
                        if d.len() == 3 {
                            plugin.queue_midi(clock.now() + int("delay", 0).max(0) as u64, [d[0], d[1], d[2]]);
                        }
                    }
                    "mix" => strip.set_mix(
                        m.get("gain").and_then(Value::as_f64).unwrap_or(1.0) as f32,
                        m.get("pan").and_then(Value::as_f64).unwrap_or(0.0) as f32,
                    ),
                    "allNotesOff" => plugin.all_notes_off(),
                    "transport" => host_callback::set_transport(
                        m.get("bpm").and_then(Value::as_f64).unwrap_or(120.0),
                        m.get("playing").and_then(Value::as_bool).unwrap_or(false),
                        int("num", 4) as u16,
                        int("den", 4) as u16,
                    ),
                    "editor" => {
                        let open = m.get("open").and_then(Value::as_bool).unwrap_or(true);
                        post(ui_tid, if open { UiCmd::ToggleEditor } else { UiCmd::CloseEditor });
                    }
                    "render" => {
                        let notes = fls_native::bounce::parse_notes(m.get("notes").unwrap_or(&Value::Null));
                        let sr = int("sr", 44100) as f32;
                        let frames = int("frames", 0).max(0) as usize;
                        let pcm = plugin.render_offline(&notes, sr, frames, live_rate.load(std::sync::atomic::Ordering::Relaxed) as f32);
                        match fls_native::bounce::write_pcm("bridge", &pcm) {
                            Ok(file) => send(json!({ "t": "renderResult", "file": file, "frames": frames })),
                            Err(e) => send(json!({ "t": "renderError", "message": format!("Write bounce failed: {e}") })),
                        }
                    }
                    "device" => post(ui_tid, UiCmd::Device(m.get("name").and_then(Value::as_str).map(str::to_string))),
                    "getState" => post(ui_tid, UiCmd::GetState(m.get("reqId").and_then(Value::as_str).unwrap_or("").to_string())),
                    "setState" => {
                        if let Some(Ok(bytes)) = m.get("data").and_then(Value::as_str).map(|s| base64::engine::general_purpose::STANDARD.decode(s)) {
                            post(ui_tid, UiCmd::SetState(bytes));
                        }
                    }
                    "unload" | "quit" => break,
                    _ => {}
                }
            }
            // Parent closed our stdin (or asked us to quit): shut down.
            post(ui_tid, UiCmd::Quit);
        });
    }

    let mut editor: Option<EditorWindow> = None;
    loop {
        let r = unsafe { GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) };
        if r <= 0 {
            break;
        }
        if msg.hwnd.is_null() && msg.message == WM_UI_CMD {
            let cmd = *unsafe { Box::from_raw(msg.lParam as *mut UiCmd) };
            match cmd {
                UiCmd::ToggleEditor if editor.is_some() => editor = None,
                UiCmd::ToggleEditor => {
                    let tid = ui_tid;
                    match EditorWindow::open(plugin.clone() as Arc<dyn fls_native::Hosted>, owner, 160, 120, Box::new(move || post(tid, UiCmd::CloseEditor))) {
                        Ok(w) => editor = Some(w),
                        Err(e) => send(json!({ "t": "error", "message": e })),
                    }
                }
                UiCmd::CloseEditor => {
                    if editor.take().is_some() {
                        send(json!({ "t": "editorClosed" }));
                    }
                }
                UiCmd::GetState(req_id) => {
                    let data = base64::engine::general_purpose::STANDARD.encode(plugin.save_state().to_bytes());
                    send(json!({ "t": "state", "reqId": req_id, "data": data }));
                }
                UiCmd::SetState(bytes) => {
                    if let Some(state) = PluginState::from_bytes(&bytes) {
                        plugin.load_state(&state);
                    }
                }
                UiCmd::Device(name) => {
                    let rate = engine.switch_device(name.as_deref());
                    live_rate.store(rate, std::sync::atomic::Ordering::Relaxed);
                    plugin.set_live_sample_rate(rate as f32);
                }
                UiCmd::Quit => break,
            }
            continue;
        }
        unsafe {
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    }

    drop(editor);
    drop(engine);
    log::write("[bridge] exiting");
}
