//! Freaky Loops Studio desktop app.
//!
//! A native window hosts the Vue UI in a webview; this process runs the audio
//! engine and VST2/VST3 plugins. The UI and host exchange JSON control messages
//! (`{type, payload}`); the UI's own audio streams in over the web bus
//! (fls_native::webbus) so everything leaves through one native output.
//! 64-bit plugins load in-process; 32-bit plugins run in the bridge helper.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod assets;
mod bridge_client;
mod files;
mod locate;
mod sf2;

use base64::Engine as _;
use bridge_client::{BridgeClient, BridgeSource};
use fls_native::editor::EditorWindow;
use fls_native::pe::Arch;
use fls_native::webbus::WebBus;
use fls_native::{bounce, host_callback, log, AudioConfig, AudioSource, DriverKind, Engine, Hosted, PluginState, Strip};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;
use tao::dpi::LogicalSize;
use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoopBuilder, EventLoopProxy};
use tao::platform::windows::WindowExtWindows;
use tao::window::{Window, WindowBuilder};
use wry::{WebView, WebViewBuilder};

const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Injected before the UI loads: the JS end of the bridge (`src/desktop/ipc.js`).
const INIT_SCRIPT: &str = r#"
(() => {
  const listeners = new Set();
  window.__flsHost = {
    native: 'rust',
    post: (msg) => window.ipc.postMessage(JSON.stringify(msg)),
    on: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    _recv: (msg) => { for (const fn of listeners) { try { fn(msg); } catch (e) { console.error(e); } } },
  };
})();
"#;

enum UserEvent {
    Ipc(String),
    Bridge { id: String, gen: u64, line: Option<String> },
    EditorClosed(String),
    MeterTick,
    RenderDone { req_id: String, result: Result<(String, usize), String> },
    /// Second half of a driver switch (after the UI released the device).
    ApplyAudio { cfg: AudioConfig, req_id: Option<Value> },
    /// A reply computed off the UI thread (e.g. asset resolution).
    Reply { kind: &'static str, payload: Value },
}

enum Kind {
    /// In this process. Instruments have a source and strip in the engine;
    /// insert effects have neither (the insert runs them).
    InProc { plugin: Arc<dyn Hosted>, source: Option<Arc<dyn AudioSource>>, strip: Option<Arc<Strip>>, editor: Option<EditorWindow> },
    Bridge(BridgeClient),
}

struct Instance {
    path: String,
    gen: u64,
    kind: Kind,
    /// Export bounce in flight on a bridge (one at a time per plugin).
    pending_render: Option<String>,
    /// A bridged plugin rendered by the engine: its source and strip.
    bridge_audio: Option<(Arc<dyn AudioSource>, Arc<Strip>)>,
}

struct App {
    window: Window,
    engine: Engine,
    bus: Option<Arc<WebBus>>,
    proxy: EventLoopProxy<UserEvent>,
    instances: HashMap<String, Instance>,
    outbox: Vec<Value>,
    /// Effect instance ids per insert the engine runs.
    insert_fx: HashMap<u32, Vec<String>>,
    meter_ticks: u64,
    next_gen: u64,
    cascade: i32,
}

fn str_of<'a>(v: &'a Value, k: &str) -> Option<&'a str> {
    v.get(k).and_then(Value::as_str)
}

fn int_of(v: &Value, k: &str, d: i64) -> i64 {
    v.get(k).and_then(Value::as_f64).map(|x| x as i64).unwrap_or(d)
}

fn new_id() -> String {
    let n = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.subsec_nanos()).unwrap_or(0);
    format!("vst-{n:08x}")
}

fn render_url(file: &str) -> String {
    format!("{}/__render/{file}", assets::ORIGIN)
}

impl App {
    fn send(&mut self, kind: &str, payload: Value) {
        self.outbox.push(json!({ "type": kind, "payload": payload }));
    }

    fn vst_error(&mut self, id: Option<&str>, message: impl Into<String>) {
        let message = message.into();
        log::write(&format!("vstError {id:?}: {message}"));
        self.send("vstError", json!({ "id": id, "message": message }));
    }

    fn handle_ipc(&mut self, raw: &str) {
        let Ok(msg) = serde_json::from_str::<Value>(raw) else { return };
        let kind = str_of(&msg, "type").unwrap_or("").to_string();
        let p = msg.get("payload").cloned().unwrap_or(Value::Null);
        let id = str_of(&p, "id").map(str::to_string);

        match kind.as_str() {
            "ping" => {
                // A freshly loaded page (reload, New project) owns no plugins yet:
                // whatever the previous page loaded would otherwise keep running.
                if p.get("fresh").and_then(Value::as_bool).unwrap_or(false) && !self.instances.is_empty() {
                    log::write(&format!("new UI page: releasing {} plugin(s) from the previous one", self.instances.len()));
                    for id in self.insert_fx.keys().copied().collect::<Vec<_>>() {
                        self.remove_insert(id);
                    }
                    self.shutdown();
                }
                let rate = self.engine.sample_rate();
                self.send("pong", json!({ "version": VERSION, "engine": "rust", "sampleRate": rate, "time": now_ms() }));
                // The injected startup info is from when the window opened; the
                // driver may have changed since (a reloaded page needs the truth).
                let sink = if self.engine.opened().0.driver.holds_device() { "none" } else { "device" };
                self.send("audioConfig", json!({ "rate": rate, "sink": sink }));
            }
            "testTone" => {
                let on = p.get("on").and_then(Value::as_bool).unwrap_or(true);
                let freq = p.get("freq").and_then(Value::as_f64).unwrap_or(440.0) as f32;
                self.engine.set_tone(on.then_some(freq));
            }
            "pickVst" => {
                let id = id.unwrap_or_else(new_id);
                let mut dlg = rfd::FileDialog::new()
                    .set_title("Select a plugin (.dll or .vst3)")
                    .add_filter("VST plugin", &["dll", "vst3"])
                    .set_parent(&self.window);
                if let Some(dir) = default_vst_dir() {
                    dlg = dlg.set_directory(dir);
                }
                match dlg.pick_file() {
                    Some(path) => self.load_vst(&id, &vst3_bundle_of(&path.to_string_lossy()), None, None),
                    None => self.send("vstCancelled", json!({ "id": id })),
                }
            }
            "loadVst" => match str_of(&p, "path").filter(|s| !s.trim().is_empty()) {
                Some(path) => {
                    let state = str_of(&p, "state").and_then(|s| base64::engine::general_purpose::STANDARD.decode(s).ok());
                    let class_id = str_of(&p, "classId").map(str::to_string);
                    self.load_vst(&id.unwrap_or_else(new_id), path, state, class_id.as_deref())
                }
                None => self.vst_error(id.as_deref(), "No plugin path provided."),
            },
            "vstNoteOn" | "vstNoteOff" => {
                let Some(inst) = id.as_ref().and_then(|i| self.instances.get(i)) else { return };
                let pitch = int_of(&p, "pitch", 60) as i32;
                let vel = int_of(&p, "velocity", 100) as i32;
                let on = kind == "vstNoteOn";
                match &inst.kind {
                    Kind::InProc { plugin, .. } if on => plugin.note_on(pitch, vel),
                    Kind::InProc { plugin, .. } => plugin.note_off(pitch),
                    Kind::Bridge(b) if on => b.send(json!({ "t": "noteOn", "pitch": pitch, "vel": vel })),
                    Kind::Bridge(b) => b.send(json!({ "t": "noteOff", "pitch": pitch })),
                }
            }
            "vstEvents" => self.on_vst_events(&p),
            // Diagnostics: record the master output to a WAV file.
            "captureStart" => {
                let secs = p.get("seconds").and_then(Value::as_f64).unwrap_or(10.0) as f32;
                self.engine.start_capture(secs, p.get("mute").and_then(Value::as_bool).unwrap_or(false));
            }
            "captureStop" => {
                let path = str_of(&p, "path").map(str::to_string).unwrap_or_else(|| std::env::temp_dir().join("fls-capture.wav").to_string_lossy().into_owned());
                let (frames, dropped) = match self.engine.stop_capture() {
                    Some((pcm, dropped)) => {
                        let _ = bounce::write_wav(&path, &pcm, self.engine.sample_rate());
                        (pcm.len() / 2, dropped)
                    }
                    None => (0, 0),
                };
                self.send("captureDone", json!({ "path": path, "frames": frames, "dropped": dropped }));
            }
            "vstMix" => {
                let Some(inst) = id.as_ref().and_then(|i| self.instances.get(i)) else { return };
                let gain = p.get("gain").and_then(Value::as_f64).unwrap_or(1.0) as f32;
                let pan = p.get("pan").and_then(Value::as_f64).unwrap_or(0.0) as f32;
                let dest = p.get("dest").and_then(Value::as_u64).unwrap_or(0) as u32;
                if let Some((_, strip)) = &inst.bridge_audio {
                    strip.set_mix(gain, pan);
                    strip.set_dest(dest);
                    return;
                }
                match &inst.kind {
                    Kind::InProc { strip: Some(strip), .. } => {
                        strip.set_mix(gain, pan);
                        strip.set_dest(dest);
                    }
                    Kind::InProc { .. } => {}
                    Kind::Bridge(b) => b.send(json!({ "t": "mix", "gain": gain, "pan": pan })),
                }
            }
            "insertSet" => self.on_insert_set(&p),
            "insertRemove" => {
                let ins = int_of(&p, "insert", 0) as u32;
                self.remove_insert(ins);
            }
            "vstAllNotesOff" => {
                for (iid, inst) in &self.instances {
                    if id.as_ref().is_some_and(|i| i != iid) {
                        continue;
                    }
                    match &inst.kind {
                        Kind::InProc { plugin, .. } => plugin.all_notes_off(),
                        Kind::Bridge(b) => b.send(json!({ "t": "allNotesOff" })),
                    }
                }
            }
            "transport" => {
                let bpm = p.get("bpm").and_then(Value::as_f64).unwrap_or(120.0);
                let playing = p.get("playing").and_then(Value::as_bool).unwrap_or(false);
                let (num, den) = (int_of(&p, "num", 4) as u16, int_of(&p, "den", 4) as u16);
                host_callback::set_transport(bpm, playing, num, den);
                for inst in self.instances.values() {
                    if let Kind::Bridge(b) = &inst.kind {
                        b.send(json!({ "t": "transport", "bpm": bpm, "playing": playing, "num": num, "den": den }));
                    }
                }
            }
            "vstUnload" => {
                if let Some(inst) = id.and_then(|i| self.instances.remove(&i)) {
                    self.teardown(inst);
                }
            }
            "openVstEditor" => {
                if let Some(id) = id {
                    self.toggle_editor(&id);
                }
            }
            "renderVst" => self.render_vst(&p),
            "vstGetState" => {
                let req_id = str_of(&p, "reqId").unwrap_or("").to_string();
                match id.as_ref().and_then(|i| self.instances.get(i)).map(|i| &i.kind) {
                    Some(Kind::InProc { plugin, .. }) => {
                        let data = base64::engine::general_purpose::STANDARD.encode(plugin.save_state().to_bytes());
                        self.send("vstState", json!({ "reqId": req_id, "id": id, "data": data }));
                    }
                    Some(Kind::Bridge(b)) => b.send(json!({ "t": "getState", "reqId": req_id })),
                    None => self.send("vstState", json!({ "reqId": req_id, "id": id, "data": null })),
                }
            }
            "vstSetState" => {
                let Some(bytes) = str_of(&p, "data").and_then(|s| base64::engine::general_purpose::STANDARD.decode(s).ok()) else { return };
                match id.as_ref().and_then(|i| self.instances.get(i)).map(|i| &i.kind) {
                    Some(Kind::InProc { plugin, .. }) => {
                        if let Some(state) = PluginState::from_bytes(&bytes) {
                            plugin.load_state(&state);
                        }
                    }
                    Some(Kind::Bridge(b)) => b.send(json!({ "t": "setState", "data": str_of(&p, "data") })),
                    None => {}
                }
            }
            "openLog" => {
                let _ = std::process::Command::new("notepad.exe").arg(log::path()).spawn();
            }
            "fileSave" => {
                let reply = files::save(&self.window, &p);
                self.send("fileSaved", reply);
            }
            "fileOpen" => {
                let reply = files::open(&self.window, &p);
                self.send("fileOpened", reply);
            }
            "resolveAssets" => {
                // Index walks can take a moment on a cold start: keep the UI thread free.
                let proxy = self.proxy.clone();
                std::thread::spawn(move || {
                    let mut reply = locate::resolve(&p);
                    reply["reqId"] = p.get("reqId").cloned().unwrap_or(Value::Null);
                    let _ = proxy.send_event(UserEvent::Reply { kind: "assetsResolved", payload: reply });
                });
            }
            // A sound-font preset for the sound-font channel: zones as JSON, samples as
            // a one-shot file. Read off the UI thread (a big font takes a moment).
            "sf2Preset" => {
                let proxy = self.proxy.clone();
                let req_id = p.get("reqId").cloned().unwrap_or(Value::Null);
                let path = str_of(&p, "path").unwrap_or("").to_string();
                let bank = int_of(&p, "bank", 0).clamp(0, 16383) as u16;
                let program = int_of(&p, "program", 0).clamp(0, 127) as u16;
                std::thread::spawn(move || {
                    let payload = match sf2::preset(&path, bank, program) {
                        Ok((info, data)) => match bounce::write_pcm("sf2", &data) {
                            Ok(file) => json!({ "reqId": req_id, "info": info, "url": render_url(&file) }),
                            Err(e) => json!({ "reqId": req_id, "error": e.to_string() }),
                        },
                        Err(e) => json!({ "reqId": req_id, "error": e }),
                    };
                    let _ = proxy.send_event(UserEvent::Reply { kind: "sf2Preset", payload });
                });
            }
            // Browser: start folders, one folder's contents, installed plugins.
            "browseRoots" => {
                let mut reply = locate::browse_roots();
                reply["reqId"] = p.get("reqId").cloned().unwrap_or(Value::Null);
                self.send("browseRoots", reply);
            }
            "listDir" => {
                let proxy = self.proxy.clone();
                std::thread::spawn(move || {
                    let mut reply = locate::list_dir(str_of(&p, "path").unwrap_or(""));
                    reply["reqId"] = p.get("reqId").cloned().unwrap_or(Value::Null);
                    let _ = proxy.send_event(UserEvent::Reply { kind: "listDir", payload: reply });
                });
            }
            "listPlugins" => {
                let proxy = self.proxy.clone();
                std::thread::spawn(move || {
                    let mut reply = locate::list_plugins();
                    reply["reqId"] = p.get("reqId").cloned().unwrap_or(Value::Null);
                    let _ = proxy.send_event(UserEvent::Reply { kind: "listPlugins", payload: reply });
                });
            }
            "pickFolder" => {
                let reply = files::pick_folder(&self.window, &p);
                self.send("folderPicked", reply);
            }
            "recentFiles" => {
                let req_id = p.get("reqId").cloned().unwrap_or(Value::Null);
                self.send("recentFiles", json!({ "reqId": req_id, "files": files::recent() }));
            }
            "audioDevices" => {
                let req_id = p.get("reqId").cloned().unwrap_or(Value::Null);
                let mut reply = self.audio_info();
                reply["reqId"] = req_id;
                self.send("audioDevices", reply);
            }
            // Old form: switch the shared-mode output device only.
            "setAudioDevice" => {
                let mut cfg = self.engine.config().clone();
                cfg.device = str_of(&p, "name").map(str::to_string);
                self.apply_audio_config(cfg, p.get("reqId").cloned());
            }
            "setAudioConfig" => {
                let cfg = AudioConfig {
                    driver: DriverKind::from_id(str_of(&p, "driver").unwrap_or("shared")),
                    device: str_of(&p, "device").filter(|s| !s.is_empty()).map(str::to_string),
                    buffer: p.get("buffer").and_then(Value::as_u64).map(|v| v as u32).filter(|&v| v > 0),
                    rate: p.get("rate").and_then(Value::as_u64).map(|v| v as u32).filter(|&v| v > 0),
                };
                self.apply_audio_config(cfg, p.get("reqId").cloned());
            }
            "asioPanel" => self.engine.asio_control_panel(),
            "setTitle" => {
                if let Some(t) = str_of(&p, "title") {
                    self.window.set_title(t);
                }
            }
            other => log::write(&format!("unhandled ipc message: {other}")),
        }
    }

    /// Load `path` into channel `id`, routing by the DLL's architecture.
    /// Whatever was on that id is torn down first (replace in place).
    /// `class_id` picks the class inside a multi-plugin VST3.
    fn load_vst(&mut self, id: &str, path: &str, state: Option<Vec<u8>>, class_id: Option<&str>) {
        if let Some(old) = self.instances.remove(id) {
            self.teardown(old);
        }
        self.next_gen += 1;
        let gen = self.next_gen;
        let is_vst3 = fls_native::vst3::is_vst3_path(path);
        let binary = if is_vst3 { fls_native::vst3::module_path(path).map(|m| m.to_string_lossy().into_owned()).unwrap_or_default() } else { path.to_string() };
        let arch = fls_native::pe::detect(&binary);
        log::write(&format!("loadVst id={id} arch={arch:?} path={path}"));

        if arch == Arch::X86 && is_vst3 {
            self.vst_error(Some(id), "32-bit VST3 plugins aren't supported — use its 64-bit or VST2 version.");
            return;
        }
        if arch == Arch::X86 {
            let proxy = self.proxy.clone();
            let cid = id.to_string();
            let on_line = move |line| {
                let _ = proxy.send_event(UserEvent::Bridge { id: cid.clone(), gen, line });
            };
            let device = self.engine.device_name().map(str::to_string);
            // The engine renders the plugin through shared memory, so it plays in
            // the mix (strip, routing, meters) on the engine's driver and clock.
            let shm_name = format!("Local\\fls-bridge-{}-{gen}", std::process::id());
            let shm = fls_native::shm::Shm::create(&shm_name).map_err(|e| log::write(&format!("[bridge] {e}; it plays on its own"))).ok();
            let rate = self.engine.sample_rate();
            match BridgeClient::spawn(path, self.window.hwnd(), device, shm.as_ref().map(|_| (shm_name.as_str(), rate)), on_line) {
                Ok(b) => {
                    if let Some(bytes) = state {
                        b.send(json!({ "t": "setState", "data": base64::engine::general_purpose::STANDARD.encode(bytes) }));
                    }
                    let bridge_audio = shm.map(|shm| {
                        let source: Arc<dyn AudioSource> = Arc::new(BridgeSource::new(shm));
                        let strip = self.engine.add_source(source.clone());
                        (source, strip)
                    });
                    self.instances.insert(id.into(), Instance { path: path.into(), gen, kind: Kind::Bridge(b), pending_render: None, bridge_audio });
                }
                Err(e) => self.vst_error(Some(id), e),
            }
            return;
        }

        match fls_native::load_any(path, self.engine.sample_rate() as f32, class_id) {
            Ok(plugin) => {
                if let Some(s) = state.as_deref().and_then(PluginState::from_bytes) {
                    plugin.load_state(&s);
                }
                let source: Arc<dyn AudioSource> = plugin.clone();
                let strip = self.engine.add_source(source.clone());
                let i = plugin.info().clone();
                self.send(
                    "vstLoaded",
                    json!({ "id": id, "name": i.name, "vendor": i.vendor, "path": path, "inputs": i.inputs, "outputs": i.outputs,
                            "canReplacing": i.can_replacing, "isSynth": i.is_synth, "hasEditor": i.has_editor, "bits": 64,
                            "format": if is_vst3 { "vst3" } else { "vst2" } }),
                );
                self.instances.insert(id.into(), Instance { path: path.into(), gen, kind: Kind::InProc { plugin, source: Some(source), strip: Some(strip), editor: None }, pending_render: None, bridge_audio: None });
            }
            Err(e) => {
                let msg = if arch == Arch::Unknown { format!("{e} (not a Windows DLL?)") } else { e };
                self.vst_error(Some(id), msg)
            }
        }
    }

    fn teardown(&mut self, inst: Instance) {
        match inst.kind {
            Kind::InProc { plugin, source, strip, editor } => {
                drop(editor);
                if let Some(source) = &source {
                    self.engine.remove_source(source);
                }
                drop((strip, source));
                plugin.all_notes_off();
                drop(plugin);
            }
            Kind::Bridge(b) => {
                if let Some((source, _)) = &inst.bridge_audio {
                    self.engine.remove_source(source);
                }
                drop(b);
            }
        }
        log::write(&format!("unloaded {}", inst.path));
    }

    fn toggle_editor(&mut self, id: &str) {
        let (x, y) = {
            let n = self.cascade % 6;
            self.cascade += 1;
            let scale = self.window.scale_factor();
            let pos = self.window.outer_position().unwrap_or_default();
            (pos.x + ((120 + n * 28) as f64 * scale) as i32, pos.y + ((90 + n * 28) as f64 * scale) as i32)
        };
        let hwnd = self.window.hwnd();
        let proxy = self.proxy.clone();
        let Some(inst) = self.instances.get_mut(id) else { return };
        let err = match &mut inst.kind {
            Kind::Bridge(b) => {
                b.send(json!({ "t": "editor", "open": true }));
                None
            }
            Kind::InProc { editor, .. } if editor.is_some() => {
                *editor = None;
                None
            }
            Kind::InProc { plugin, editor, .. } => {
                let cid = id.to_string();
                let on_close = Box::new(move || {
                    let _ = proxy.send_event(UserEvent::EditorClosed(cid.clone()));
                });
                match EditorWindow::open(plugin.clone(), hwnd, x, y, on_close) {
                    Ok(w) => {
                        *editor = Some(w);
                        None
                    }
                    Err(e) => Some(e),
                }
            }
        };
        if let Some(e) = err {
            self.vst_error(Some(id), e);
        }
    }

    fn render_vst(&mut self, p: &Value) {
        let Some(req_id) = str_of(p, "reqId").map(str::to_string) else { return };
        let channel = str_of(p, "channelId").unwrap_or("");
        let sr = int_of(p, "sampleRate", 44100) as f32;
        let frames = int_of(p, "totalFrames", 0).max(0) as usize;
        let notes_v = p.get("notes").cloned().unwrap_or(Value::Null);
        let live_rate = self.engine.sample_rate() as f32;

        let Some(inst) = self.instances.get_mut(channel) else {
            self.send("vstRenderError", json!({ "reqId": req_id, "message": "No plugin for channel." }));
            return;
        };
        match &inst.kind {
            Kind::Bridge(b) => {
                b.send(json!({ "t": "render", "sr": sr, "frames": frames, "notes": notes_v }));
                inst.pending_render = Some(req_id);
            }
            Kind::InProc { plugin, .. } => {
                let plugin = plugin.clone();
                let proxy = self.proxy.clone();
                std::thread::spawn(move || {
                    let notes = bounce::parse_notes(&notes_v);
                    let pcm = plugin.render_offline(&notes, sr, frames, live_rate);
                    let result = bounce::write_pcm("inproc", &pcm).map(|f| (f, frames)).map_err(|e| format!("Write bounce failed: {e}"));
                    let _ = proxy.send_event(UserEvent::RenderDone { req_id, result });
                });
            }
        }
    }

    fn on_bridge_line(&mut self, id: &str, gen: u64, line: Option<String>) {
        let Some(inst) = self.instances.get_mut(id).filter(|i| i.gen == gen) else { return };
        let Some(line) = line else {
            // The helper exited (crash, or the plugin failed to load).
            let path = inst.path.clone();
            let pending = inst.pending_render.take();
            if let Some(gone) = self.instances.remove(id) {
                if let Some((source, _)) = &gone.bridge_audio {
                    self.engine.remove_source(source);
                }
            }
            if let Some(req_id) = pending {
                self.send("vstRenderError", json!({ "reqId": req_id, "message": "The 32-bit bridge stopped during the bounce." }));
            }
            self.vst_error(Some(id), format!("The 32-bit plugin host stopped ({path})."));
            return;
        };
        let Ok(m) = serde_json::from_str::<Value>(&line) else { return };
        match str_of(&m, "t").unwrap_or("") {
            "loaded" => {
                let path = inst.path.clone();
                self.send(
                    "vstLoaded",
                    json!({ "id": id, "name": str_of(&m, "name").unwrap_or("VST"), "vendor": m.get("vendor"), "path": path,
                            "inputs": m.get("inputs"), "outputs": m.get("outputs"), "canReplacing": m.get("canReplacing"),
                            "isSynth": m.get("isSynth"), "hasEditor": m.get("hasEditor"), "bits": 32 }),
                );
            }
            "error" => {
                let message = str_of(&m, "message").unwrap_or("Bridge error.").to_string();
                self.vst_error(Some(id), message);
            }
            "peak" => self.send("meters", json!({ "strips": [[id, m.get("peak")]], "inserts": [] })),
            "renderResult" => {
                if let Some(req_id) = inst.pending_render.take() {
                    let file = str_of(&m, "file").unwrap_or("");
                    self.send("vstRenderResult", json!({ "reqId": req_id, "url": render_url(file), "frames": m.get("frames") }));
                }
            }
            "renderError" => {
                if let Some(req_id) = inst.pending_render.take() {
                    self.send("vstRenderError", json!({ "reqId": req_id, "message": m.get("message") }));
                }
            }
            "state" => self.send("vstState", json!({ "reqId": m.get("reqId"), "id": id, "data": m.get("data") })),
            "editorClosed" => self.send("vstEditorClosed", json!({ "id": id })),
            _ => {}
        }
    }

    /// Drivers, devices and what's running, for the audio settings window.
    fn audio_info(&self) -> Value {
        let (o, err) = self.engine.opened();
        let cfg = self.engine.config();
        json!({
            "drivers": [
                { "id": "shared", "name": "Windows audio", "devices": fls_native::output_devices() },
                { "id": "exclusive", "name": "Windows audio (exclusive, low latency)", "devices": fls_native::wasapi::devices() },
                { "id": "asio", "name": "ASIO", "devices": asio_drivers() },
            ],
            "config": { "driver": cfg.driver.id(), "device": cfg.device, "buffer": cfg.buffer, "rate": cfg.rate },
            "running": { "driver": o.driver.id(), "device": o.device, "rate": o.rate, "buffer": o.buffer,
                         "latency": o.latency, "format": o.format, "bufferSizes": o.buffer_sizes },
            "error": err,
            // Old fields, still read by older UI code.
            "devices": fls_native::output_devices(), "current": self.engine.device_name(), "sampleRate": self.engine.sample_rate(),
        })
    }

    /// Reopen the engine with `cfg`, remember it, and bring plugins and the
    /// UI's audio context along (rate, and whether the device is still theirs).
    fn apply_audio_config(&mut self, cfg: AudioConfig, req_id: Option<Value>) {
        // The UI's audio context must let go of the device before the engine
        // takes it exclusively: tell it now, switch a moment later.
        if cfg.driver.holds_device() && !self.engine.opened().0.driver.holds_device() {
            self.send("audioConfig", json!({ "rate": self.engine.sample_rate(), "sink": "none" }));
            let proxy = self.proxy.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(150));
                let _ = proxy.send_event(UserEvent::ApplyAudio { cfg, req_id });
            });
            return;
        }
        self.configure_audio(cfg, req_id);
    }

    fn configure_audio(&mut self, cfg: AudioConfig, req_id: Option<Value>) {
        let old_rate = self.engine.sample_rate();
        let rate = self.engine.configure(cfg.clone());
        files::set_setting("audioDriver", json!(cfg.driver.id()));
        files::set_setting("audioDevice", json!(cfg.device));
        files::set_setting("audioBuffer", json!(cfg.buffer));
        files::set_setting("audioRate", json!(cfg.rate));
        if rate != old_rate {
            for inst in self.instances.values() {
                if let Kind::InProc { plugin, .. } = &inst.kind {
                    plugin.set_live_sample_rate(rate as f32);
                }
            }
        }
        let running = self.engine.opened().0.driver;
        for inst in self.instances.values() {
            if let Kind::Bridge(b) = &inst.kind {
                b.send(json!({ "t": "device", "name": if running.holds_device() { None } else { self.engine.device_name() } }));
            }
        }
        self.send("audioConfig", json!({ "rate": rate, "sink": if running.holds_device() { "none" } else { "device" } }));
        let mut reply = self.audio_info();
        reply["reqId"] = req_id.unwrap_or(Value::Null);
        self.send("audioDevices", reply);
    }

    /// A mixer insert the engine runs: `{ insert, gain, pan, fx: [{ uid, path,
    /// state, classId, enabled }] }`. Effects are loaded once per uid (and
    /// again if their path changes); disabled ones stay loaded but out of the
    /// chain; ones no longer listed are released.
    fn on_insert_set(&mut self, p: &Value) {
        let ins_id = int_of(p, "insert", 0) as u32;
        if ins_id == 0 {
            return;
        }
        let gain = p.get("gain").and_then(Value::as_f64).unwrap_or(1.0) as f32;
        let pan = p.get("pan").and_then(Value::as_f64).unwrap_or(0.0) as f32;
        let rate = self.engine.sample_rate() as f32;
        let mut chain: Vec<Arc<dyn Hosted>> = Vec::new();
        let mut report = Vec::new();
        let mut uids = Vec::new();
        for f in p.get("fx").and_then(Value::as_array).cloned().unwrap_or_default() {
            let (Some(uid), Some(path)) = (str_of(&f, "uid").map(str::to_string), str_of(&f, "path").map(str::to_string)) else { continue };
            uids.push(uid.clone());
            let loaded = matches!(self.instances.get(&uid), Some(i) if i.path == path);
            if !loaded {
                if let Some(old) = self.instances.remove(&uid) {
                    self.teardown(old);
                }
                let binary = if fls_native::vst3::is_vst3_path(&path) { fls_native::vst3::module_path(&path).map(|m| m.to_string_lossy().into_owned()).unwrap_or_default() } else { path.clone() };
                if fls_native::pe::detect(&binary) == Arch::X86 {
                    report.push(json!({ "uid": uid, "error": "32-bit effects can't run on an insert yet" }));
                    continue;
                }
                match fls_native::load_any(&path, rate, str_of(&f, "classId")) {
                    Ok(plugin) => {
                        let state = str_of(&f, "state").and_then(|s| base64::engine::general_purpose::STANDARD.decode(s).ok());
                        if let Some(st) = state.as_deref().and_then(PluginState::from_bytes) {
                            plugin.load_state(&st);
                        }
                        self.next_gen += 1;
                        log::write(&format!("insert {ins_id}: effect {} loaded", plugin.info().name));
                        self.instances.insert(uid.clone(), Instance { path: path.clone(), gen: self.next_gen, kind: Kind::InProc { plugin, source: None, strip: None, editor: None }, pending_render: None, bridge_audio: None });
                    }
                    Err(e) => {
                        log::write(&format!("insert {ins_id}: effect {path} failed: {e}"));
                        report.push(json!({ "uid": uid, "error": e }));
                        continue;
                    }
                }
            }
            if let Some(Instance { kind: Kind::InProc { plugin, .. }, .. }) = self.instances.get(&uid) {
                if f.get("enabled").and_then(Value::as_bool).unwrap_or(true) {
                    chain.push(plugin.clone());
                }
                report.push(json!({ "uid": uid, "name": plugin.info().name, "hasEditor": plugin.info().has_editor }));
            }
        }
        let ins = self.engine.insert(ins_id);
        ins.set_mix(gain, pan);
        self.engine.set_insert_fx(&ins, chain);
        let before = self.insert_fx.insert(ins_id, uids.clone()).unwrap_or_default();
        for gone in before.into_iter().filter(|u| !uids.contains(u)) {
            if let Some(inst) = self.instances.remove(&gone) {
                self.teardown(inst);
            }
        }
        self.send("insertSet", json!({ "insert": ins_id, "fx": report }));
    }

    fn remove_insert(&mut self, ins_id: u32) {
        self.engine.remove_insert(ins_id);
        for uid in self.insert_fx.remove(&ins_id).unwrap_or_default() {
            if let Some(inst) = self.instances.remove(&uid) {
                self.teardown(inst);
            }
        }
    }

    /// Timed MIDI from the UI's scheduler: `{ now, rate, lat, ev: [[id, frame, status, d1, d2]] }`,
    /// frames on the UI audio context's clock. While the UI's audio streams in,
    /// its frames map exactly onto the engine's; otherwise each event keeps its
    /// distance from `now`, shifted so it lines up with the UI's own output.
    fn on_vst_events(&mut self, p: &Value) {
        let num = |k: &str| p.get(k).and_then(Value::as_f64).unwrap_or(0.0);
        let (now_web, web_rate, web_lat) = (num("now"), num("rate").max(1.0), num("lat"));
        let eng_rate = self.engine.sample_rate() as f64;
        let eng_now = self.engine.frame_now();
        let native_lat = self.engine.stats().output_latency;
        let Some(evs) = p.get("ev").and_then(Value::as_array) else { return };
        for ev in evs {
            let Some(a) = ev.as_array().filter(|a| a.len() == 5) else { continue };
            let Some(inst) = a[0].as_str().and_then(|id| self.instances.get(id)) else { continue };
            let web = a[1].as_f64().unwrap_or(0.0);
            let d = [a[2].as_u64().unwrap_or(0) as u8, a[3].as_u64().unwrap_or(0) as u8, a[4].as_u64().unwrap_or(0) as u8];
            let at = self.bus.as_ref().and_then(|b| b.engine_frame_for(web)).unwrap_or_else(|| {
                let delay = (web - now_web) / web_rate + web_lat - native_lat;
                eng_now + (delay.max(0.0) * eng_rate) as u64
            });
            match &inst.kind {
                Kind::InProc { plugin, .. } => plugin.queue_midi(at, d),
                Kind::Bridge(b) => b.send(json!({ "t": "midi", "d": d, "at": at, "delay": at.saturating_sub(eng_now) })),
            }
        }
    }

    /// ~16× a second: plugin and insert meters; every fifth tick, engine stats.
    fn on_meter_tick(&mut self) {
        self.meter_ticks += 1;
        let r4 = |p: f32| (p * 10000.0).round() / 10000.0;
        let strips: Vec<Value> = self
            .instances
            .iter()
            .filter_map(|(id, inst)| match (&inst.kind, &inst.bridge_audio) {
                (Kind::InProc { strip: Some(strip), .. }, _) | (Kind::Bridge(_), Some((_, strip))) => Some((id.clone(), strip.take_peak())),
                _ => None,
            })
            .filter(|(_, p)| *p > 0.0001)
            .map(|(id, p)| json!([id, r4(p)]))
            .collect();
        let inserts: Vec<Value> = self.engine.insert_peaks().into_iter().filter(|(_, p)| *p > 0.0001).map(|(id, p)| json!([id, r4(p)])).collect();
        if !strips.is_empty() || !inserts.is_empty() {
            self.send("meters", json!({ "strips": strips, "inserts": inserts }));
        }
        if self.meter_ticks % 5 != 0 {
            return;
        }
        self.engine.poll();
        let st = self.engine.stats();
        self.send("audioStats", json!({
            "device": st.device, "rate": st.rate, "period": st.period,
            "load": (st.load * 1000.0).round() / 1000.0, "loadPeak": (st.load_peak * 1000.0).round() / 1000.0,
            "late": st.late, "bus": st.bus_connected, "busUnderruns": st.bus_underruns,
            "busLatency": (st.bus_latency * 10000.0).round() / 10000.0, "busMaxGap": (st.bus_max_gap * 10000.0).round() / 10000.0, "outputLatency": (st.output_latency * 10000.0).round() / 10000.0,
        }));
    }

    fn shutdown(&mut self) {
        let ids: Vec<String> = self.instances.keys().cloned().collect();
        for id in ids {
            if let Some(inst) = self.instances.remove(&id) {
                self.teardown(inst);
            }
        }
    }
}

/// A file picked inside a VST3 bundle (`X.vst3/Contents/x86_64-win/X.vst3`)
/// stands for the bundle itself.
fn vst3_bundle_of(picked: &str) -> String {
    let p = std::path::Path::new(picked);
    p.ancestors()
        .skip(1)
        .find(|a| a.is_dir() && a.extension().map_or(false, |e| e.eq_ignore_ascii_case("vst3")))
        .map(|a| a.to_string_lossy().into_owned())
        .unwrap_or_else(|| picked.to_string())
}

/// Installed ASIO drivers (64-bit only).
fn asio_drivers() -> Vec<String> {
    #[cfg(target_arch = "x86_64")]
    {
        fls_native::asio::drivers().into_iter().map(|d| d.name).collect()
    }
    #[cfg(not(target_arch = "x86_64"))]
    {
        Vec::new()
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn default_vst_dir() -> Option<std::path::PathBuf> {
    ["C:\\Program Files\\Common Files\\VST2", "C:\\Program Files\\VSTPlugins", "C:\\Program Files\\Steinberg\\VSTPlugins"]
        .iter()
        .map(std::path::PathBuf::from)
        .find(|p| p.is_dir())
}

/// Debug builds load the Vite dev server when it's running (hot reload);
/// otherwise — and always in release — the bundled UI is served locally.
fn start_url() -> String {
    if let Ok(u) = std::env::var("FLS_URL") {
        return u;
    }
    if cfg!(debug_assertions) {
        // Vite may bind IPv4 or IPv6 localhost depending on the Node version.
        let up = ["127.0.0.1:5173", "[::1]:5173"].iter().filter_map(|a| a.parse::<std::net::SocketAddr>().ok()).any(|addr| {
            std::net::TcpStream::connect_timeout(&addr, std::time::Duration::from_millis(300)).is_ok()
        });
        if up {
            return "http://localhost:5173/".into();
        }
    }
    format!("{}/index.html", assets::ORIGIN)
}

fn main() {
    log::write(&format!("Freaky Loops Studio {VERSION} starting"));
    fls_native::crash::install();
    fls_native::crash::preload_system_runtimes();
    let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
    let proxy = event_loop.create_proxy();

    let window = WindowBuilder::new()
        .with_title("Freaky Loops Studio")
        .with_inner_size(LogicalSize::new(1440.0, 900.0))
        .with_min_inner_size(LogicalSize::new(960.0, 600.0))
        .with_maximized(true)
        .build(&event_loop)
        .expect("failed to create the main window");

    // The engine and the web bus come first: the UI needs the bus address and
    // the engine's rate before its first line runs.
    let setting_str = |k: &str| files::setting(k).and_then(|v| v.as_str().map(str::to_string));
    let setting_u32 = |k: &str| files::setting(k).and_then(|v| v.as_u64()).map(|v| v as u32);
    let engine = Engine::start_with(AudioConfig {
        driver: DriverKind::from_id(setting_str("audioDriver").as_deref().unwrap_or("shared")),
        device: setting_str("audioDevice"),
        buffer: setting_u32("audioBuffer"),
        rate: setting_u32("audioRate"),
    });
    let bus = match WebBus::start() {
        Ok(b) => {
            engine.attach_bus(b.clone());
            Some(b)
        }
        Err(e) => {
            log::write(&format!("web bus unavailable ({e}); the UI plays through its own output"));
            None
        }
    };
    let audio_info = match &bus {
        Some(b) => json!({ "port": b.port, "token": b.token, "rate": engine.sample_rate(),
                           "sink": if engine.opened().0.driver.holds_device() { "none" } else { "device" } }),
        None => json!({ "rate": engine.sample_rate() }),
    };
    let init_script = format!("{INIT_SCRIPT}
window.__flsHost.audio = {audio_info};
");

    let ipc_proxy = proxy.clone();
    let url = start_url();
    log::write(&format!("loading UI from {url}"));
    let webview: WebView = WebViewBuilder::new()
        .with_url(&url)
        .with_initialization_script(&init_script)
        .with_ipc_handler(move |req| {
            let _ = ipc_proxy.send_event(UserEvent::Ipc(req.body().clone()));
        })
        .with_custom_protocol("fls".into(), |_id, req| assets::handle(req))
        .with_devtools(true)
        .build(&window)
        .expect("failed to create the webview (is the WebView2 runtime installed?)");

    let meter_proxy = proxy.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(60));
        if meter_proxy.send_event(UserEvent::MeterTick).is_err() {
            break;
        }
    });

    // Load (or build) the sample/plugin index in the background for fast imports.
    locate::prewarm();
    let mut app = App { window, engine, bus, proxy, instances: HashMap::new(), outbox: Vec::new(), insert_fx: HashMap::new(), meter_ticks: 0, next_gen: 0, cascade: 0 };

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;
        match event {
            Event::UserEvent(UserEvent::Ipc(raw)) => app.handle_ipc(&raw),
            Event::UserEvent(UserEvent::Bridge { id, gen, line }) => app.on_bridge_line(&id, gen, line),
            Event::UserEvent(UserEvent::EditorClosed(id)) => {
                if let Some(Instance { kind: Kind::InProc { editor, .. }, .. }) = app.instances.get_mut(&id) {
                    *editor = None;
                }
                app.send("vstEditorClosed", json!({ "id": id }));
            }
            Event::UserEvent(UserEvent::MeterTick) => app.on_meter_tick(),
            Event::UserEvent(UserEvent::Reply { kind, payload }) => app.send(kind, payload),
            Event::UserEvent(UserEvent::ApplyAudio { cfg, req_id }) => app.configure_audio(cfg, req_id),
            Event::UserEvent(UserEvent::RenderDone { req_id, result }) => match result {
                Ok((file, frames)) => app.send("vstRenderResult", json!({ "reqId": req_id, "url": render_url(&file), "frames": frames })),
                Err(e) => app.send("vstRenderError", json!({ "reqId": req_id, "message": e })),
            },
            Event::WindowEvent { event: WindowEvent::CloseRequested, .. } => {
                app.shutdown();
                *control_flow = ControlFlow::Exit;
            }
            _ => {}
        }
        for msg in app.outbox.drain(..) {
            let _ = webview.evaluate_script(&format!("window.__flsHost && window.__flsHost._recv({msg})"));
        }
    });
}
