//! One loaded VST2 plugin instance: load/open, MIDI in, audio out (live and
//! offline), editor plumbing and state chunks. [`Hosted`] is what the host
//! needs from any plugin format; VST3 lives in [`crate::vst3`].
//!
//! Threading model (standard for VST2 hosts): open/close/editor calls happen on
//! the UI thread; `process*` runs on the audio thread (or a render thread). All
//! processing state sits behind one mutex — the live audio callback only ever
//! `try_lock`s it, so an offline bounce simply mutes the live stream for that
//! plugin while it runs instead of racing it.

use crate::ffi::*;
use crate::host_callback::{host_callback, set_thread_process_level, ProcessLevel};
use crate::log;
use std::os::raw::c_void;
use std::path::Path;
use crate::sched::{Due, Inbox, NOW};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

pub const BLOCK_SIZE: usize = 512;

/// A loaded plugin of any format, as the host drives it.
pub trait Hosted: crate::engine::AudioSource {
    fn info(&self) -> &PluginInfo;
    fn path(&self) -> &str;
    fn note_on(&self, pitch: i32, velocity: i32);
    fn note_off(&self, pitch: i32);
    /// A MIDI message due at engine frame `at` (`sched::NOW` = right away).
    fn queue_midi(&self, at: u64, data: [u8; 3]);
    /// Silence: drop notes still waiting to start, release every voice.
    fn all_notes_off(&self);
    /// Run as an effect: `io` (interleaved stereo) goes in, the plugin's
    /// output replaces it. Audio thread; passes audio through if busy.
    fn process_effect(&self, io: &mut [f32], frames: usize, ctx: &crate::engine::RenderCtx);
    /// Peak output level since the last call (for UI meters).
    fn take_peak(&self) -> f32;
    fn render_offline(&self, notes: &[RenderNote], sample_rate: f32, total_frames: usize, live_rate: f32) -> Vec<f32>;
    fn set_live_sample_rate(&self, sample_rate: f32);
    fn save_state(&self) -> PluginState;
    fn load_state(&self, state: &PluginState);
    fn editor_rect(&self) -> Option<(i32, i32)>;
    /// Attach the editor to `parent` (an HWND); false when there is none.
    fn editor_open(&self, parent: isize) -> bool;
    fn editor_idle(&self);
    fn editor_close(&self);
    /// Identity the editor registry uses to route resize requests.
    fn editor_key(&self) -> usize;
}

/// Load a plugin by path: `.vst3` bundles/files as VST3, anything else as VST2.
/// `class_id` (32 hex chars) picks the class inside a multi-plugin VST3.
pub fn load_any(path: &str, sample_rate: f32, class_id: Option<&str>) -> Result<std::sync::Arc<dyn Hosted>, String> {
    if crate::vst3::is_vst3_path(path) {
        Ok(crate::vst3::Vst3Plugin::load(path, sample_rate, class_id)?)
    } else {
        Ok(Plugin::load(path, sample_rate)?)
    }
}

#[derive(Clone, Debug, Default)]
pub struct PluginInfo {
    pub name: String,
    pub vendor: String,
    pub inputs: i32,
    pub outputs: i32,
    pub can_replacing: bool,
    pub is_synth: bool,
    pub has_editor: bool,
    pub program_chunks: bool,
    pub num_params: i32,
    pub num_programs: i32,
    pub unique_id: i32,
}

/// A note for an offline bounce, frame-stamped against the render sample rate.
#[derive(Clone, Copy, Debug)]
pub struct RenderNote {
    pub pitch: i32,
    pub velocity: i32,
    pub start_frame: i64,
    pub end_frame: i64,
}

struct ProcState {
    sample_rate: f32,
    ins: Vec<Vec<f32>>,
    outs: Vec<Vec<f32>>,
    in_ptrs: Vec<*mut f32>,
    out_ptrs: Vec<*mut f32>,
    events: Box<VstEvents>,
    event_store: Box<[VstMidiEvent; MAX_BLOCK_EVENTS]>,
    /// Live MIDI taken from the inbox, in due order (kept allocated).
    due: Due<[u8; 3]>,
    /// This block's events with their sample offsets.
    block: Vec<(i32, [u8; 3])>,
}

pub struct Plugin {
    // Field order matters for Drop: the effect must be closed (in Drop) before
    // the library that holds its code is unloaded.
    effect: *mut AEffect,
    pub info: PluginInfo,
    pub path: String,
    proc: Mutex<ProcState>,
    inbox: Inbox<[u8; 3]>,
    /// Set by all_notes_off: the audio thread drops queued note-ons.
    flush: AtomicBool,
    peak: AtomicU32,
    _lib: libloading::Library,
}

// The raw effect pointer is only touched through the dispatcher/process entry
// points, which VST2 plugins expect to be called from a UI thread and an audio
// thread concurrently. Processing is serialised by `proc`.
unsafe impl Send for Plugin {}
unsafe impl Sync for Plugin {}
unsafe impl Send for ProcState {}

impl Plugin {
    /// Load a VST2 `.dll`, open it and start processing at `sample_rate`.
    pub fn load(path: &str, sample_rate: f32) -> Result<Arc<Plugin>, String> {
        log::write(&format!("loading VST {path} (dll arch {})", crate::pe::arch(path)));
        let lib = unsafe { libloading::Library::new(path) }.map_err(|e| format!("Could not load the DLL: {e}"))?;
        let main: PluginMain = unsafe {
            match lib.get::<PluginMain>(b"VSTPluginMain\0") {
                Ok(f) => *f,
                Err(_) => *lib
                    .get::<PluginMain>(b"main\0")
                    .map_err(|_| "Not a VST2 plugin (no VSTPluginMain entry point).".to_string())?,
            }
        };

        let effect = unsafe { main(host_callback) };
        if effect.is_null() {
            return Err("The plugin refused to initialise.".into());
        }
        if unsafe { (*effect).magic } != MAGIC {
            return Err("The DLL returned an invalid plugin (bad magic).".into());
        }

        let mut plugin = Plugin {
            effect,
            info: PluginInfo::default(),
            path: path.to_string(),
            proc: Mutex::new(ProcState::new(sample_rate, 0, 2)),
            inbox: Inbox::new(),
            flush: AtomicBool::new(false),
            peak: AtomicU32::new(0),
            _lib: lib,
        };

        plugin.dispatch(EFF_OPEN, 0, 0, std::ptr::null_mut(), 0.0);
        plugin.resume(sample_rate);

        let e = unsafe { &*effect };
        let stem = Path::new(path).file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "VST".into());
        let name = plugin.get_string(EFF_GET_EFFECT_NAME).or_else(|| plugin.get_string(EFF_GET_PRODUCT_STRING)).unwrap_or(stem);
        plugin.info = PluginInfo {
            name,
            vendor: plugin.get_string(EFF_GET_VENDOR_STRING).unwrap_or_default(),
            inputs: e.num_inputs,
            outputs: e.num_outputs,
            can_replacing: e.flags & FLAG_CAN_REPLACING != 0,
            is_synth: e.flags & FLAG_IS_SYNTH != 0,
            has_editor: e.flags & FLAG_HAS_EDITOR != 0,
            program_chunks: e.flags & FLAG_PROGRAM_CHUNKS != 0,
            num_params: e.num_params,
            num_programs: e.num_programs,
            unique_id: e.unique_id,
        };
        *plugin.proc.get_mut().unwrap() = ProcState::new(sample_rate, e.num_inputs.max(0) as usize, e.num_outputs.max(2) as usize);
        log::write(&format!(
            "VST ready: {} in={} out={} synth={} editor={}",
            plugin.info.name, plugin.info.inputs, plugin.info.outputs, plugin.info.is_synth, plugin.info.has_editor
        ));
        Ok(Arc::new(plugin))
    }

    pub fn effect_ptr(&self) -> *mut AEffect {
        self.effect
    }

    pub(crate) fn dispatch(&self, opcode: i32, index: i32, value: isize, ptr: *mut c_void, opt: f32) -> isize {
        unsafe {
            match (*self.effect).dispatcher {
                Some(d) => d(self.effect, opcode, index, value, ptr, opt),
                None => 0,
            }
        }
    }

    fn get_string(&self, opcode: i32) -> Option<String> {
        let mut buf = [0u8; 256];
        self.dispatch(opcode, 0, 0, buf.as_mut_ptr() as *mut c_void, 0.0);
        let len = buf.iter().position(|&b| b == 0).unwrap_or(buf.len());
        let s = String::from_utf8_lossy(&buf[..len]).trim().to_string();
        (!s.is_empty()).then_some(s)
    }

    fn suspend(&self) {
        self.dispatch(EFF_STOP_PROCESS, 0, 0, std::ptr::null_mut(), 0.0);
        self.dispatch(EFF_MAINS_CHANGED, 0, 0, std::ptr::null_mut(), 0.0);
    }

    fn resume(&self, sample_rate: f32) {
        self.dispatch(EFF_SET_SAMPLE_RATE, 0, 0, std::ptr::null_mut(), sample_rate);
        self.dispatch(EFF_SET_BLOCK_SIZE, 0, BLOCK_SIZE as isize, std::ptr::null_mut(), 0.0);
        self.dispatch(EFF_MAINS_CHANGED, 0, 1, std::ptr::null_mut(), 0.0);
        self.dispatch(EFF_START_PROCESS, 0, 0, std::ptr::null_mut(), 0.0);
    }

    // ── MIDI ────────────────────────────────────────────────────────────────

    pub fn note_on(&self, pitch: i32, velocity: i32) {
        self.push_midi([0x90, pitch.clamp(0, 127) as u8, velocity.clamp(1, 127) as u8]);
    }

    pub fn note_off(&self, pitch: i32) {
        self.push_midi([0x80, pitch.clamp(0, 127) as u8, 0]);
    }

    /// Release everything: all-sound-off + all-notes-off on every MIDI channel.
    pub fn all_notes_off(&self) {
        self.inbox.retain(|(_, d)| d[0] & 0xF0 != 0x90);
        self.flush.store(true, Ordering::Release);
        for ch in 0..16u8 {
            self.push_midi([0xB0 | ch, 120, 0]);
            self.push_midi([0xB0 | ch, 123, 0]);
        }
    }

    pub fn push_midi(&self, data: [u8; 3]) {
        self.inbox.push(NOW, data);
    }

    pub fn queue_midi(&self, at: u64, data: [u8; 3]) {
        self.inbox.push(at, data);
    }

    // ── Live audio ──────────────────────────────────────────────────────────

    /// Runs on the callback's own frame count in chunks of at most one block;
    /// each event lands on its own sample. Called from the audio thread;
    /// never blocks or allocates.
    pub fn render_add(&self, out: &mut [f32], frames: usize, ctx: &crate::engine::RenderCtx) {
        let Ok(mut guard) = self.proc.try_lock() else { return };
        let st = &mut *guard;
        set_thread_process_level(ProcessLevel::Realtime);
        st.due.take(&self.inbox);
        if self.flush.swap(false, Ordering::Acquire) {
            st.due.retain(|(_, d)| d[0] & 0xF0 != 0x90);
        }
        let mut peak = 0f32;
        let mut done = 0;
        while done < frames {
            let n = (frames - done).min(BLOCK_SIZE);
            let at = ctx.start + done as u64;
            st.block.clear();
            let (due, block) = (&mut st.due, &mut st.block);
            due.split(at, at + n as u64, MAX_BLOCK_EVENTS, |off, d| block.push((off as i32, d)));
            self.process_block(st, n);
            let (l_buf, r_buf) = (&st.outs[0], st.outs.get(1).unwrap_or(&st.outs[0]));
            for i in 0..n {
                let (l, r) = (l_buf[i], r_buf[i]);
                out[(done + i) * 2] += l;
                out[(done + i) * 2 + 1] += r;
                peak = peak.max(l.abs()).max(r.abs());
            }
            done += n;
        }
        if peak > f32::from_bits(self.peak.load(Ordering::Relaxed)) {
            self.peak.store(peak.to_bits(), Ordering::Relaxed);
        }
    }

    /// Peak output level since the last call (for UI meters).
    pub fn take_peak(&self) -> f32 {
        f32::from_bits(self.peak.swap(0, Ordering::Relaxed))
    }

    /// As an effect: process `io` in place (see `Hosted::process_effect`).
    pub fn process_effect(&self, io: &mut [f32], frames: usize, ctx: &crate::engine::RenderCtx) {
        let Ok(mut guard) = self.proc.try_lock() else { return };
        let st = &mut *guard;
        set_thread_process_level(ProcessLevel::Realtime);
        st.due.take(&self.inbox);
        let mut done = 0;
        while done < frames {
            let n = (frames - done).min(BLOCK_SIZE);
            let at = ctx.start + done as u64;
            st.block.clear();
            let (due, block) = (&mut st.due, &mut st.block);
            due.split(at, at + n as u64, MAX_BLOCK_EVENTS, |off, d| block.push((off as i32, d)));
            let chunk = &mut io[done * 2..(done + n) * 2];
            self.process_block_io(st, n, Some(chunk));
            let (l_buf, r_buf) = (&st.outs[0], st.outs.get(1).unwrap_or(&st.outs[0]));
            for i in 0..n {
                chunk[i * 2] = l_buf[i];
                chunk[i * 2 + 1] = r_buf[i];
            }
            done += n;
        }
    }

    /// Process one block with the events in `st.block`.
    fn process_block(&self, st: &mut ProcState, frames: usize) {
        self.process_block_io(st, frames, None)
    }

    /// One block; `input` (interleaved stereo) feeds the plugin's inputs.
    fn process_block_io(&self, st: &mut ProcState, frames: usize, input: Option<&[f32]>) {
        let n = st.block.len().min(MAX_BLOCK_EVENTS);
        for i in 0..n {
            let (delta, data) = st.block[i];
            st.event_store[i] = VstMidiEvent::new(delta.min(frames as i32 - 1).max(0), data);
        }
        if n > 0 {
            let store = st.event_store.as_mut_ptr();
            for i in 0..n {
                st.events.events[i] = unsafe { store.add(i) };
            }
            st.events.num_events = n as i32;
            let ptr = &mut *st.events as *mut VstEvents as *mut c_void;
            self.dispatch(EFF_PROCESS_EVENTS, 0, 0, ptr, 0.0);
        }

        for buf in st.outs.iter_mut() {
            buf[..frames].fill(0.0);
        }
        for buf in st.ins.iter_mut() {
            buf[..frames].fill(0.0);
        }
        if let Some(inp) = input {
            match st.ins.len() {
                0 => {}
                1 => {
                    for i in 0..frames {
                        st.ins[0][i] = (inp[i * 2] + inp[i * 2 + 1]) * 0.5;
                    }
                }
                _ => {
                    for i in 0..frames {
                        st.ins[0][i] = inp[i * 2];
                        st.ins[1][i] = inp[i * 2 + 1];
                    }
                }
            }
        }
        unsafe {
            let e = &*self.effect;
            let f = if e.flags & FLAG_CAN_REPLACING != 0 { e.process_replacing.or(e.process) } else { e.process.or(e.process_replacing) };
            if let Some(f) = f {
                f(self.effect, st.in_ptrs.as_mut_ptr(), st.out_ptrs.as_mut_ptr(), frames as i32);
            }
        }
    }

    // ── Offline bounce ──────────────────────────────────────────────────────

    /// Render `notes` faster than real time to interleaved stereo PCM, reusing
    /// this (single) plugin instance — never a second instance of the same DLL,
    /// since many VST2s keep global state and crash on double instantiation.
    /// The live stream for this plugin is muted for the duration (it can't take
    /// the lock) and the live sample rate is restored afterwards.
    pub fn render_offline(&self, notes: &[RenderNote], sample_rate: f32, total_frames: usize, live_rate: f32) -> Vec<f32> {
        let mut pcm = vec![0f32; total_frames * 2];
        if total_frames == 0 {
            return pcm;
        }
        let mut st = self.proc.lock().unwrap_or_else(|p| p.into_inner());
        set_thread_process_level(ProcessLevel::Offline);
        crate::host_callback::set_thread_sample_rate(Some(sample_rate));
        self.inbox.retain(|_| false);
        st.due.clear();

        self.suspend();
        self.resume(sample_rate);
        st.sample_rate = sample_rate;

        let mut events: Vec<(i64, [u8; 3])> = Vec::with_capacity(notes.len() * 2);
        for n in notes {
            let on = n.start_frame.clamp(0, total_frames as i64 - 1);
            let off = n.end_frame.clamp(on + 1, total_frames as i64);
            let p = n.pitch.clamp(0, 127) as u8;
            events.push((on, [0x90, p, n.velocity.clamp(1, 127) as u8]));
            events.push((off, [0x80, p, 0]));
        }
        // Note-offs before note-ons on the same frame so retriggers aren't eaten.
        events.sort_by_key(|(f, d)| (*f, d[0] == 0x90));

        let mut ev = 0;
        let mut frame = 0usize;
        while frame < total_frames {
            let n = BLOCK_SIZE.min(total_frames - frame);
            let start = ev;
            while ev < events.len() && events[ev].0 < (frame + n) as i64 {
                ev += 1;
            }
            st.block.clear();
            st.block.extend(events[start..ev].iter().map(|(f, d)| ((*f - frame as i64).max(0) as i32, *d)));
            self.process_block(&mut st, n);
            let outs = &st.outs;
            for i in 0..n {
                pcm[(frame + i) * 2] = outs[0][i];
                pcm[(frame + i) * 2 + 1] = if outs.len() > 1 { outs[1][i] } else { outs[0][i] };
            }
            frame += n;
        }
        // Flush note-offs that landed on the final frame so no voice keeps
        // sounding on the live instance afterwards.
        if ev < events.len() {
            st.block.clear();
            st.block.extend(events[ev..].iter().map(|(_, d)| (0, *d)));
            self.process_block(&mut st, BLOCK_SIZE);
        }

        self.suspend();
        self.resume(live_rate);
        st.sample_rate = live_rate;
        crate::host_callback::set_thread_sample_rate(None);
        set_thread_process_level(ProcessLevel::User);
        log::write(&format!("offline render {}: {} notes -> {} frames @ {} Hz", self.info.name, notes.len(), total_frames, sample_rate));
        pcm
    }

    /// Re-initialise for a new live sample rate (audio device change).
    pub fn set_live_sample_rate(&self, sample_rate: f32) {
        let mut st = self.proc.lock().unwrap_or_else(|p| p.into_inner());
        if (st.sample_rate - sample_rate).abs() < 0.5 {
            return;
        }
        self.suspend();
        self.resume(sample_rate);
        st.sample_rate = sample_rate;
    }

    // ── Editor ──────────────────────────────────────────────────────────────

    pub fn editor_rect(&self) -> Option<(i32, i32)> {
        let mut rect: *mut ERect = std::ptr::null_mut();
        self.dispatch(EFF_EDIT_GET_RECT, 0, 0, &mut rect as *mut *mut ERect as *mut c_void, 0.0);
        if rect.is_null() {
            return None;
        }
        let r = unsafe { *rect };
        let (w, h) = ((r.right - r.left) as i32, (r.bottom - r.top) as i32);
        (w > 0 && h > 0).then_some((w, h))
    }

    pub fn editor_open(&self, parent: isize) {
        self.dispatch(EFF_EDIT_OPEN, 0, 0, parent as *mut c_void, 0.0);
    }

    pub fn editor_idle(&self) {
        self.dispatch(EFF_EDIT_IDLE, 0, 0, std::ptr::null_mut(), 0.0);
    }

    pub fn editor_close(&self) {
        self.dispatch(EFF_EDIT_CLOSE, 0, 0, std::ptr::null_mut(), 0.0);
    }

    // ── State (so projects can save and restore a plugin's sound) ───────────

    /// The plugin's full state: its opaque bank chunk when it supports chunks,
    /// otherwise every parameter value packed as little-endian f32s.
    pub fn save_state(&self) -> PluginState {
        if self.info.program_chunks {
            let mut data: *mut c_void = std::ptr::null_mut();
            let len = self.dispatch(EFF_GET_CHUNK, 0, 0, &mut data as *mut *mut c_void as *mut c_void, 0.0);
            if len > 0 && !data.is_null() {
                let bytes = unsafe { std::slice::from_raw_parts(data as *const u8, len as usize) }.to_vec();
                return PluginState::Chunk(bytes);
            }
        }
        let mut params = Vec::with_capacity(self.info.num_params.max(0) as usize);
        unsafe {
            if let Some(get) = (*self.effect).get_parameter {
                for i in 0..self.info.num_params {
                    params.push(get(self.effect, i));
                }
            }
        }
        PluginState::Params(params)
    }

    pub fn load_state(&self, state: &PluginState) {
        let _guard = self.proc.lock().unwrap_or_else(|p| p.into_inner());
        match state {
            PluginState::Chunk(bytes) if !bytes.is_empty() => {
                self.dispatch(EFF_SET_CHUNK, 0, bytes.len() as isize, bytes.as_ptr() as *mut c_void, 0.0);
            }
            PluginState::Params(values) => unsafe {
                if let Some(set) = (*self.effect).set_parameter {
                    for (i, v) in values.iter().enumerate().take(self.info.num_params.max(0) as usize) {
                        set(self.effect, i as i32, *v);
                    }
                }
            },
            _ => {}
        }
    }
}

#[derive(Clone, Debug)]
pub enum PluginState {
    Chunk(Vec<u8>),
    Params(Vec<f32>),
    /// VST3: the processor's and the controller's own state streams.
    Vst3 { component: Vec<u8>, controller: Vec<u8> },
}

impl PluginState {
    /// Tagged byte form: `C` + chunk, `P` + packed f32 parameters, or
    /// `3` + component length (u32 LE) + component + controller.
    pub fn to_bytes(&self) -> Vec<u8> {
        match self {
            PluginState::Chunk(b) => [b"C".as_slice(), b].concat(),
            PluginState::Vst3 { component, controller } => {
                let mut out = Vec::with_capacity(5 + component.len() + controller.len());
                out.push(b'3');
                out.extend_from_slice(&(component.len() as u32).to_le_bytes());
                out.extend_from_slice(component);
                out.extend_from_slice(controller);
                out
            }
            PluginState::Params(p) => {
                let mut out = Vec::with_capacity(1 + p.len() * 4);
                out.push(b'P');
                for v in p {
                    out.extend_from_slice(&v.to_le_bytes());
                }
                out
            }
        }
    }

    pub fn from_bytes(bytes: &[u8]) -> Option<PluginState> {
        match bytes.split_first()? {
            (b'C', rest) => Some(PluginState::Chunk(rest.to_vec())),
            (b'P', rest) => Some(PluginState::Params(rest.chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect())),
            (b'3', rest) => {
                let n = u32::from_le_bytes(rest.get(..4)?.try_into().ok()?) as usize;
                let component = rest.get(4..4 + n)?.to_vec();
                Some(PluginState::Vst3 { component, controller: rest[4 + n..].to_vec() })
            }
            _ => None,
        }
    }
}

impl Hosted for Plugin {
    fn info(&self) -> &PluginInfo {
        &self.info
    }
    fn path(&self) -> &str {
        &self.path
    }
    fn note_on(&self, pitch: i32, velocity: i32) {
        Plugin::note_on(self, pitch, velocity)
    }
    fn note_off(&self, pitch: i32) {
        Plugin::note_off(self, pitch)
    }
    fn queue_midi(&self, at: u64, data: [u8; 3]) {
        Plugin::queue_midi(self, at, data)
    }
    fn process_effect(&self, io: &mut [f32], frames: usize, ctx: &crate::engine::RenderCtx) {
        Plugin::process_effect(self, io, frames, ctx)
    }
    fn all_notes_off(&self) {
        Plugin::all_notes_off(self)
    }
    fn take_peak(&self) -> f32 {
        Plugin::take_peak(self)
    }
    fn render_offline(&self, notes: &[RenderNote], sample_rate: f32, total_frames: usize, live_rate: f32) -> Vec<f32> {
        Plugin::render_offline(self, notes, sample_rate, total_frames, live_rate)
    }
    fn set_live_sample_rate(&self, sample_rate: f32) {
        Plugin::set_live_sample_rate(self, sample_rate)
    }
    fn save_state(&self) -> PluginState {
        Plugin::save_state(self)
    }
    fn load_state(&self, state: &PluginState) {
        Plugin::load_state(self, state)
    }
    fn editor_rect(&self) -> Option<(i32, i32)> {
        Plugin::editor_rect(self)
    }
    fn editor_open(&self, parent: isize) -> bool {
        if !self.info.has_editor {
            return false;
        }
        Plugin::editor_open(self, parent);
        true
    }
    fn editor_idle(&self) {
        Plugin::editor_idle(self)
    }
    fn editor_close(&self) {
        Plugin::editor_close(self)
    }
    fn editor_key(&self) -> usize {
        self.effect as usize
    }
}

impl ProcState {
    fn new(sample_rate: f32, inputs: usize, outputs: usize) -> Self {
        let mut ins: Vec<Vec<f32>> = (0..inputs.max(1)).map(|_| vec![0f32; BLOCK_SIZE]).collect();
        let mut outs: Vec<Vec<f32>> = (0..outputs.max(2)).map(|_| vec![0f32; BLOCK_SIZE]).collect();
        let in_ptrs = ins.iter_mut().map(|b| b.as_mut_ptr()).collect();
        let out_ptrs = outs.iter_mut().map(|b| b.as_mut_ptr()).collect();
        ProcState {
            sample_rate,
            ins,
            outs,
            in_ptrs,
            out_ptrs,
            events: Box::new(VstEvents { num_events: 0, reserved: 0, events: [std::ptr::null_mut(); MAX_BLOCK_EVENTS] }),
            event_store: Box::new([VstMidiEvent::new(0, [0, 0, 0]); MAX_BLOCK_EVENTS]),
            due: Due::with_capacity(4096),
            block: Vec::with_capacity(MAX_BLOCK_EVENTS * 4),
        }
    }
}

impl Drop for Plugin {
    fn drop(&mut self) {
        crate::editor::forget(self.effect as usize);
        let _guard = self.proc.lock().unwrap_or_else(|p| p.into_inner());
        self.suspend();
        self.dispatch(EFF_CLOSE, 0, 0, std::ptr::null_mut(), 0.0);
        log::write(&format!("VST closed: {}", self.info.name));
    }
}
