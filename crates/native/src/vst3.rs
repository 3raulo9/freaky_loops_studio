//! VST3 plugin hosting.
//!
//! A `.vst3` is either a bundle folder (`Name.vst3/Contents/x86_64-win/Name.vst3`)
//! or a single DLL. Its factory hands out a processor (IComponent +
//! IAudioProcessor) and, usually as a separate object, an edit controller.
//! The host connects the two (IConnectionPoint), feeds note events and the
//! editor's parameter edits into every `process` call, and saves/restores
//! both state streams.
//!
//! Threading follows the VST3 rules: setup, state and editor calls happen on
//! the UI thread; `process` runs on the audio (or a render) thread. All
//! processing state sits behind one mutex — the live callback only
//! `try_lock`s it, exactly like the VST2 host.

use crate::engine::AudioSource;
use crate::host_callback::{self, set_thread_process_level, ProcessLevel};
use crate::log;
use crate::plugin::{Hosted, PluginInfo, PluginState, RenderNote, BLOCK_SIZE};
use std::cell::UnsafeCell;
use std::collections::HashMap;
use std::ffi::{c_void, CStr, CString};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use vst3::Steinberg::Vst::IAttributeList_::AttrID;
use vst3::Steinberg::Vst::*;
use vst3::Steinberg::*;
use vst3::{Class, ComPtr, ComRef, ComWrapper, Interface};

const AUDIO_MODULE_CLASS: &str = "Audio Module Class";
const MAX_EVENTS: usize = 512;

pub fn is_vst3_path(path: &str) -> bool {
    path.trim_end_matches(['\\', '/']).to_ascii_lowercase().ends_with(".vst3")
}

/// The DLL to load: the path itself for a single-file plugin, or the binary
/// for this CPU inside a bundle.
pub fn module_path(path: &str) -> Option<PathBuf> {
    let p = Path::new(path.trim_end_matches(['\\', '/']));
    if p.is_file() {
        return Some(p.to_path_buf());
    }
    if !p.is_dir() {
        return None;
    }
    let arch = if cfg!(target_arch = "x86") {
        "x86-win"
    } else if cfg!(target_arch = "aarch64") {
        "arm64-win"
    } else {
        "x86_64-win"
    };
    let dir = p.join("Contents").join(arch);
    let named = dir.join(p.file_name()?);
    if named.is_file() {
        return Some(named);
    }
    // A renamed bundle: take the binary that is there.
    std::fs::read_dir(&dir)
        .ok()?
        .flatten()
        .map(|e| e.path())
        .find(|f| f.is_file() && f.extension().map_or(false, |x| x.eq_ignore_ascii_case("vst3")))
}

/// Whether `path` is a loadable VST3 for this process (exports the factory).
pub fn is_vst3(path: &Path) -> bool {
    module_path(&path.to_string_lossy()).map_or(false, |m| crate::pe::exports(&m).iter().any(|e| e == "GetPluginFactory"))
}

// ── Small helpers ────────────────────────────────────────────────────────────

fn cstr(b: &[char8]) -> String {
    let bytes: Vec<u8> = b.iter().take_while(|&&c| c != 0).map(|&c| c as u8).collect();
    String::from_utf8_lossy(&bytes).trim().to_string()
}

fn tuid_bytes(t: &TUID) -> [u8; 16] {
    t.map(|c| c as u8)
}

fn parse_hex16(s: &str) -> Option<[u8; 16]> {
    let s = s.trim();
    if s.len() != 32 {
        return None;
    }
    let mut out = [0u8; 16];
    for (i, o) in out.iter_mut().enumerate() {
        *o = u8::from_str_radix(s.get(i * 2..i * 2 + 2)?, 16).ok()?;
    }
    Some(out)
}

/// The same 16 bytes with the first three GUID fields byte-swapped (COM vs.
/// plain ordering), so an id written either way still matches.
fn com_swapped(b: [u8; 16]) -> [u8; 16] {
    let mut o = b;
    o[..4].reverse();
    o[4..6].reverse();
    o[6..8].reverse();
    o
}

fn copy_wide(s: &str, out: &mut [TChar]) {
    let mut n = 0;
    for (d, c) in out.iter_mut().zip(s.encode_utf16()) {
        *d = c as TChar;
        n += 1;
    }
    if let Some(z) = out.get_mut(n.min(out.len().saturating_sub(1))) {
        *z = 0;
    }
}

// ── Host-side COM objects ────────────────────────────────────────────────────

/// A memory IBStream (state in and out).
struct MemStream {
    inner: Mutex<(Vec<u8>, usize)>,
}

impl MemStream {
    fn new(data: Vec<u8>) -> ComWrapper<MemStream> {
        ComWrapper::new(MemStream { inner: Mutex::new((data, 0)) })
    }
    fn take(&self) -> Vec<u8> {
        std::mem::take(&mut self.inner.lock().unwrap().0)
    }
    fn rewind(&self) {
        self.inner.lock().unwrap().1 = 0;
    }
}

impl Class for MemStream {
    type Interfaces = (IBStream,);
}

impl IBStreamTrait for MemStream {
    unsafe fn read(&self, buffer: *mut c_void, num_bytes: int32, num_read: *mut int32) -> tresult {
        let mut g = self.inner.lock().unwrap();
        let (data, pos) = &mut *g;
        let n = (num_bytes.max(0) as usize).min(data.len().saturating_sub(*pos));
        if n > 0 && !buffer.is_null() {
            std::ptr::copy_nonoverlapping(data.as_ptr().add(*pos), buffer as *mut u8, n);
        }
        *pos += n;
        if !num_read.is_null() {
            *num_read = n as int32;
        }
        kResultOk
    }

    unsafe fn write(&self, buffer: *mut c_void, num_bytes: int32, num_written: *mut int32) -> tresult {
        if buffer.is_null() || num_bytes < 0 {
            return kInvalidArgument;
        }
        let mut g = self.inner.lock().unwrap();
        let (data, pos) = &mut *g;
        let src = std::slice::from_raw_parts(buffer as *const u8, num_bytes as usize);
        let end = *pos + src.len();
        if data.len() < end {
            data.resize(end, 0);
        }
        data[*pos..end].copy_from_slice(src);
        *pos = end;
        if !num_written.is_null() {
            *num_written = num_bytes;
        }
        kResultOk
    }

    unsafe fn seek(&self, pos: int64, mode: int32, result: *mut int64) -> tresult {
        let mut g = self.inner.lock().unwrap();
        let len = g.0.len() as i64;
        let base = match mode {
            IBStream_::IStreamSeekMode_::kIBSeekSet => 0,
            IBStream_::IStreamSeekMode_::kIBSeekCur => g.1 as i64,
            IBStream_::IStreamSeekMode_::kIBSeekEnd => len,
            _ => return kInvalidArgument,
        };
        let to = (base + pos).max(0);
        g.1 = to as usize;
        if !result.is_null() {
            *result = to;
        }
        kResultOk
    }

    unsafe fn tell(&self, pos: *mut int64) -> tresult {
        if pos.is_null() {
            return kInvalidArgument;
        }
        *pos = self.inner.lock().unwrap().1 as int64;
        kResultOk
    }
}

struct HostApp;

impl Class for HostApp {
    type Interfaces = (IHostApplication,);
}

impl IHostApplicationTrait for HostApp {
    unsafe fn getName(&self, name: *mut String128) -> tresult {
        if name.is_null() {
            return kInvalidArgument;
        }
        copy_wide("Freaky Loops Studio", &mut *name);
        kResultOk
    }

    unsafe fn createInstance(&self, cid: *mut TUID, iid: *mut TUID, obj: *mut *mut c_void) -> tresult {
        if cid.is_null() || iid.is_null() || obj.is_null() {
            return kInvalidArgument;
        }
        let (cid, iid) = (tuid_bytes(&*cid), tuid_bytes(&*iid));
        *obj = std::ptr::null_mut();
        if cid == IMessage::IID && iid == IMessage::IID {
            *obj = HostMessage::new().to_com_ptr::<IMessage>().unwrap().into_raw() as *mut c_void;
            return kResultOk;
        }
        if cid == IAttributeList::IID && iid == IAttributeList::IID {
            *obj = HostAttributes::new().to_com_ptr::<IAttributeList>().unwrap().into_raw() as *mut c_void;
            return kResultOk;
        }
        kResultFalse
    }
}

/// Messages the processor and controller send each other through the host.
struct HostMessage {
    id: Mutex<CString>,
    attrs: ComPtr<IAttributeList>,
}

impl HostMessage {
    fn new() -> ComWrapper<HostMessage> {
        ComWrapper::new(HostMessage { id: Mutex::new(CString::default()), attrs: HostAttributes::new().to_com_ptr::<IAttributeList>().unwrap() })
    }
}

impl Class for HostMessage {
    type Interfaces = (IMessage,);
}

impl IMessageTrait for HostMessage {
    unsafe fn getMessageID(&self) -> FIDString {
        self.id.lock().unwrap().as_ptr()
    }
    unsafe fn setMessageID(&self, id: FIDString) {
        *self.id.lock().unwrap() = if id.is_null() { CString::default() } else { CStr::from_ptr(id).to_owned() };
    }
    unsafe fn getAttributes(&self) -> *mut IAttributeList {
        // The message keeps ownership: no extra reference for the caller.
        self.attrs.as_ptr()
    }
}

enum Attr {
    Int(i64),
    Float(f64),
    Str(Vec<TChar>),
    Bin(Vec<u8>),
}

struct HostAttributes {
    map: Mutex<HashMap<String, Attr>>,
}

impl HostAttributes {
    fn new() -> ComWrapper<HostAttributes> {
        ComWrapper::new(HostAttributes { map: Mutex::new(HashMap::new()) })
    }
}

impl Class for HostAttributes {
    type Interfaces = (IAttributeList,);
}

unsafe fn attr_key(id: AttrID) -> Option<String> {
    (!id.is_null()).then(|| CStr::from_ptr(id).to_string_lossy().into_owned())
}

impl IAttributeListTrait for HostAttributes {
    unsafe fn setInt(&self, id: AttrID, value: int64) -> tresult {
        let Some(k) = attr_key(id) else { return kInvalidArgument };
        self.map.lock().unwrap().insert(k, Attr::Int(value));
        kResultOk
    }
    unsafe fn getInt(&self, id: AttrID, value: *mut int64) -> tresult {
        match (attr_key(id), value.is_null()) {
            (Some(k), false) => match self.map.lock().unwrap().get(&k) {
                Some(Attr::Int(v)) => {
                    *value = *v;
                    kResultOk
                }
                _ => kResultFalse,
            },
            _ => kInvalidArgument,
        }
    }
    unsafe fn setFloat(&self, id: AttrID, value: f64) -> tresult {
        let Some(k) = attr_key(id) else { return kInvalidArgument };
        self.map.lock().unwrap().insert(k, Attr::Float(value));
        kResultOk
    }
    unsafe fn getFloat(&self, id: AttrID, value: *mut f64) -> tresult {
        match (attr_key(id), value.is_null()) {
            (Some(k), false) => match self.map.lock().unwrap().get(&k) {
                Some(Attr::Float(v)) => {
                    *value = *v;
                    kResultOk
                }
                _ => kResultFalse,
            },
            _ => kInvalidArgument,
        }
    }
    unsafe fn setString(&self, id: AttrID, string: *const TChar) -> tresult {
        let Some(k) = attr_key(id) else { return kInvalidArgument };
        let mut v = Vec::new();
        if !string.is_null() {
            let mut i = 0;
            while *string.add(i) != 0 && i < 1 << 20 {
                v.push(*string.add(i));
                i += 1;
            }
        }
        self.map.lock().unwrap().insert(k, Attr::Str(v));
        kResultOk
    }
    unsafe fn getString(&self, id: AttrID, string: *mut TChar, size_in_bytes: uint32) -> tresult {
        let (Some(k), false) = (attr_key(id), string.is_null()) else { return kInvalidArgument };
        match self.map.lock().unwrap().get(&k) {
            Some(Attr::Str(v)) => {
                let cap = (size_in_bytes as usize / 2).saturating_sub(1);
                let n = v.len().min(cap);
                std::ptr::copy_nonoverlapping(v.as_ptr(), string, n);
                *string.add(n) = 0;
                kResultOk
            }
            _ => kResultFalse,
        }
    }
    unsafe fn setBinary(&self, id: AttrID, data: *const c_void, size_in_bytes: uint32) -> tresult {
        let Some(k) = attr_key(id) else { return kInvalidArgument };
        let v = if data.is_null() { Vec::new() } else { std::slice::from_raw_parts(data as *const u8, size_in_bytes as usize).to_vec() };
        self.map.lock().unwrap().insert(k, Attr::Bin(v));
        kResultOk
    }
    unsafe fn getBinary(&self, id: AttrID, data: *mut *const c_void, size_in_bytes: *mut uint32) -> tresult {
        let (Some(k), false, false) = (attr_key(id), data.is_null(), size_in_bytes.is_null()) else { return kInvalidArgument };
        match self.map.lock().unwrap().get(&k) {
            Some(Attr::Bin(v)) => {
                // Valid until the attribute is replaced, as the API promises.
                *data = v.as_ptr() as *const c_void;
                *size_in_bytes = v.len() as uint32;
                kResultOk
            }
            _ => kResultFalse,
        }
    }
}

/// Receives the editor's parameter edits; they reach the processor through
/// the next `process` call's input parameter changes.
struct Handler {
    edits: Arc<Mutex<Vec<(ParamID, ParamValue)>>>,
}

impl Class for Handler {
    type Interfaces = (IComponentHandler,);
}

impl IComponentHandlerTrait for Handler {
    unsafe fn beginEdit(&self, _id: ParamID) -> tresult {
        kResultOk
    }
    unsafe fn performEdit(&self, id: ParamID, value: ParamValue) -> tresult {
        if let Ok(mut e) = self.edits.lock() {
            if let Some(slot) = e.iter_mut().find(|(i, _)| *i == id) {
                slot.1 = value;
            } else if e.len() < 4096 {
                e.push((id, value));
            }
        }
        kResultOk
    }
    unsafe fn endEdit(&self, _id: ParamID) -> tresult {
        kResultOk
    }
    unsafe fn restartComponent(&self, _flags: int32) -> tresult {
        kResultOk
    }
}

/// Note events for one process call (input), or the plugin's output events.
struct EventList {
    events: UnsafeCell<Vec<Event>>,
}

impl EventList {
    fn new() -> ComWrapper<EventList> {
        ComWrapper::new(EventList { events: UnsafeCell::new(Vec::with_capacity(MAX_EVENTS)) })
    }
    /// Only called under the processing lock.
    #[allow(clippy::mut_from_ref)]
    unsafe fn list(&self) -> &mut Vec<Event> {
        &mut *self.events.get()
    }
}

impl Class for EventList {
    type Interfaces = (IEventList,);
}

impl IEventListTrait for EventList {
    unsafe fn getEventCount(&self) -> int32 {
        self.list().len() as int32
    }
    unsafe fn getEvent(&self, index: int32, e: *mut Event) -> tresult {
        match (self.list().get(index.max(0) as usize), e.is_null()) {
            (Some(ev), false) => {
                *e = *ev;
                kResultOk
            }
            _ => kInvalidArgument,
        }
    }
    unsafe fn addEvent(&self, e: *mut Event) -> tresult {
        if e.is_null() {
            return kInvalidArgument;
        }
        let l = self.list();
        if l.len() < MAX_EVENTS {
            l.push(*e);
        }
        kResultOk
    }
}

struct ParamQueue {
    id: UnsafeCell<ParamID>,
    points: UnsafeCell<Vec<(int32, ParamValue)>>,
}

impl Class for ParamQueue {
    type Interfaces = (IParamValueQueue,);
}

impl IParamValueQueueTrait for ParamQueue {
    unsafe fn getParameterId(&self) -> ParamID {
        *self.id.get()
    }
    unsafe fn getPointCount(&self) -> int32 {
        (&*self.points.get()).len() as int32
    }
    unsafe fn getPoint(&self, index: int32, offset: *mut int32, value: *mut ParamValue) -> tresult {
        match ((&*self.points.get()).get(index.max(0) as usize), offset.is_null() || value.is_null()) {
            (Some(&(o, v)), false) => {
                *offset = o;
                *value = v;
                kResultOk
            }
            _ => kInvalidArgument,
        }
    }
    unsafe fn addPoint(&self, offset: int32, value: ParamValue, index: *mut int32) -> tresult {
        let p = &mut *self.points.get();
        p.push((offset, value));
        if !index.is_null() {
            *index = p.len() as int32 - 1;
        }
        kResultOk
    }
}

/// Parameter changes for one process call. Queues are reused between calls.
struct ParamChanges {
    queues: UnsafeCell<Vec<ComWrapper<ParamQueue>>>,
    used: UnsafeCell<usize>,
}

impl ParamChanges {
    fn new() -> ComWrapper<ParamChanges> {
        ComWrapper::new(ParamChanges { queues: UnsafeCell::new(Vec::new()), used: UnsafeCell::new(0) })
    }
    unsafe fn clear(&self) {
        *self.used.get() = 0;
    }
    unsafe fn queue(&self, id: ParamID) -> (usize, *mut IParamValueQueue) {
        let qs = &mut *self.queues.get();
        let used = &mut *self.used.get();
        if let Some(i) = qs[..*used].iter().position(|q| *q.id.get() == id) {
            return (i, qs[i].as_com_ref::<IParamValueQueue>().unwrap().as_ptr());
        }
        if *used == qs.len() {
            qs.push(ComWrapper::new(ParamQueue { id: UnsafeCell::new(id), points: UnsafeCell::new(Vec::with_capacity(4)) }));
        }
        let q = &qs[*used];
        *q.id.get() = id;
        (&mut *q.points.get()).clear();
        *used += 1;
        (*used - 1, q.as_com_ref::<IParamValueQueue>().unwrap().as_ptr())
    }
    unsafe fn add(&self, id: ParamID, offset: i32, value: f64) {
        let (i, _) = self.queue(id);
        (&mut *(&*self.queues.get())[i].points.get()).push((offset, value));
    }
}

impl Class for ParamChanges {
    type Interfaces = (IParameterChanges,);
}

impl IParameterChangesTrait for ParamChanges {
    unsafe fn getParameterCount(&self) -> int32 {
        *self.used.get() as int32
    }
    unsafe fn getParameterData(&self, index: int32) -> *mut IParamValueQueue {
        let i = index.max(0) as usize;
        if i >= *self.used.get() {
            return std::ptr::null_mut();
        }
        (&*self.queues.get())[i].as_com_ref::<IParamValueQueue>().unwrap().as_ptr()
    }
    unsafe fn addParameterData(&self, id: *const ParamID, index: *mut int32) -> *mut IParamValueQueue {
        if id.is_null() {
            return std::ptr::null_mut();
        }
        let (i, q) = self.queue(*id);
        if !index.is_null() {
            *index = i as int32;
        }
        q
    }
}

/// The editor's frame: forwards the plugin's resize requests to its window.
struct Frame {
    key: usize,
}

impl Class for Frame {
    type Interfaces = (IPlugFrame,);
}

impl IPlugFrameTrait for Frame {
    unsafe fn resizeView(&self, view: *mut IPlugView, new_size: *mut ViewRect) -> tresult {
        if view.is_null() || new_size.is_null() {
            return kInvalidArgument;
        }
        let r = *new_size;
        crate::editor::resize_for(self.key, r.right - r.left, r.bottom - r.top);
        if let Some(v) = ComRef::from_raw(view) {
            v.onSize(new_size);
        }
        kResultOk
    }
}

// ── The plugin ───────────────────────────────────────────────────────────────

/// A dynamically loaded VST3 module; `ExitDll` runs before the library unloads.
struct Module {
    exit: Option<unsafe extern "system" fn() -> u8>,
    _lib: libloading::Library,
}

impl Drop for Module {
    fn drop(&mut self) {
        if let Some(f) = self.exit {
            unsafe { f() };
        }
    }
}

#[derive(Clone, Copy)]
struct NoteEv {
    on: bool,
    channel: i16,
    pitch: i16,
    velocity: f32,
}

struct Bus {
    bufs: Vec<Vec<f32>>,
    ptrs: Vec<*mut f32>,
}

impl Bus {
    fn new(channels: usize) -> Bus {
        let mut bufs: Vec<Vec<f32>> = (0..channels).map(|_| vec![0f32; BLOCK_SIZE]).collect();
        let ptrs = bufs.iter_mut().map(|b| b.as_mut_ptr()).collect();
        Bus { bufs, ptrs }
    }
    fn buffers(&mut self) -> AudioBusBuffers {
        AudioBusBuffers { numChannels: self.bufs.len() as int32, silenceFlags: 0, __field0: AudioBusBuffers__type0 { channelBuffers32: self.ptrs.as_mut_ptr() } }
    }
}

struct Proc {
    sample_rate: f32,
    ins: Vec<Bus>,
    outs: Vec<Bus>,
    in_bufs: Vec<AudioBusBuffers>,
    out_bufs: Vec<AudioBusBuffers>,
    events: ComWrapper<EventList>,
    out_events: ComWrapper<EventList>,
    params: ComWrapper<ParamChanges>,
    out_params: ComWrapper<ParamChanges>,
    ctx: ProcessContext,
    /// Live notes taken from the queue for the next call (kept allocated).
    pending: Vec<(i32, NoteEv)>,
}

impl Proc {
    fn new(sample_rate: f32, ins: &[usize], outs: &[usize]) -> Proc {
        Proc {
            sample_rate,
            ins: ins.iter().map(|&c| Bus::new(c)).collect(),
            outs: outs.iter().map(|&c| Bus::new(c)).collect(),
            in_bufs: Vec::with_capacity(ins.len()),
            out_bufs: Vec::with_capacity(outs.len()),
            events: EventList::new(),
            out_events: EventList::new(),
            params: ParamChanges::new(),
            out_params: ParamChanges::new(),
            ctx: unsafe { std::mem::zeroed() },
            pending: Vec::with_capacity(MAX_EVENTS),
        }
    }
}

static NEXT_KEY: AtomicUsize = AtomicUsize::new(1);

pub struct Vst3Plugin {
    pub info: PluginInfo,
    pub path: String,
    key: usize,
    view: Mutex<Option<ComPtr<IPlugView>>>,
    frame: ComWrapper<Frame>,
    proc: Mutex<Proc>,
    notes: Mutex<Vec<NoteEv>>,
    edits: Arc<Mutex<Vec<(ParamID, ParamValue)>>>,
    peak: AtomicU32,
    // COM objects, released in this order after Drop has shut the plugin down;
    // the module (and its code) goes last.
    conn: Option<(ComPtr<IConnectionPoint>, ComPtr<IConnectionPoint>)>,
    controller: Option<ComPtr<IEditController>>,
    separate_controller: bool,
    processor: ComPtr<IAudioProcessor>,
    component: ComPtr<IComponent>,
    _handler: ComWrapper<Handler>,
    _host: ComWrapper<HostApp>,
    _factory: ComPtr<IPluginFactory>,
    _module: Module,
}

// VST3 objects are called from the UI thread and the audio thread, as the API
// intends; processing is serialised by `proc`.
unsafe impl Send for Vst3Plugin {}
unsafe impl Sync for Vst3Plugin {}

impl Vst3Plugin {
    /// Load the plugin at `path` (bundle or file). `class_id` selects one class
    /// of a multi-plugin module; otherwise the first audio class is used.
    pub fn load(path: &str, sample_rate: f32, class_id: Option<&str>) -> Result<Arc<Vst3Plugin>, String> {
        let dll = module_path(path).ok_or_else(|| "This VST3 has no Windows binary for this computer.".to_string())?;
        log::write(&format!("loading VST3 {path} -> {} (arch {})", dll.display(), crate::pe::arch(&dll.to_string_lossy())));
        let lib: libloading::Library = unsafe {
            // Bundles keep their own DLLs beside the binary.
            libloading::os::windows::Library::load_with_flags(&dll, libloading::os::windows::LOAD_WITH_ALTERED_SEARCH_PATH)
        }
        .map_err(|e| format!("Could not load the plugin: {e}"))?
        .into();
        let (init, exit, get_factory) = unsafe {
            let init = lib.get::<unsafe extern "system" fn() -> u8>(b"InitDll\0").ok().map(|f| *f);
            let exit = lib.get::<unsafe extern "system" fn() -> u8>(b"ExitDll\0").ok().map(|f| *f);
            let gf = *lib
                .get::<unsafe extern "system" fn() -> *mut IPluginFactory>(b"GetPluginFactory\0")
                .map_err(|_| "Not a VST3 plugin (no GetPluginFactory).".to_string())?;
            (init, exit, gf)
        };
        if let Some(f) = init {
            unsafe { f() };
        }
        let module = Module { exit, _lib: lib };
        let factory = unsafe { ComPtr::from_raw(get_factory()) }.ok_or("The plugin returned no factory.")?;

        // Pick the class.
        let mut classes: Vec<(i32, PClassInfo)> = Vec::new();
        unsafe {
            for i in 0..factory.countClasses() {
                let mut ci: PClassInfo = std::mem::zeroed();
                if factory.getClassInfo(i, &mut ci) == kResultOk && cstr(&ci.category) == AUDIO_MODULE_CLASS {
                    classes.push((i, ci));
                }
            }
        }
        let want = class_id.and_then(parse_hex16);
        let (index, ci) = want
            .and_then(|w| classes.iter().find(|(_, c)| tuid_bytes(&c.cid) == w || tuid_bytes(&c.cid) == com_swapped(w)))
            .or_else(|| classes.first())
            .copied()
            .ok_or("The plugin has no audio classes.")?;
        let mut vendor = String::new();
        let mut sub = String::new();
        unsafe {
            if let Some(f2) = factory.cast::<IPluginFactory2>() {
                let mut c2: PClassInfo2 = std::mem::zeroed();
                if f2.getClassInfo2(index, &mut c2) == kResultOk {
                    vendor = cstr(&c2.vendor);
                    sub = cstr(&c2.subCategories);
                }
            }
            if vendor.is_empty() {
                let mut fi: PFactoryInfo = std::mem::zeroed();
                if factory.getFactoryInfo(&mut fi) == kResultOk {
                    vendor = cstr(&fi.vendor);
                }
            }
        }

        let host = ComWrapper::new(HostApp);
        let host_ptr = host.as_com_ref::<IHostApplication>().unwrap().as_ptr() as *mut FUnknown;
        let component = unsafe {
            let mut obj: *mut c_void = std::ptr::null_mut();
            let r = factory.createInstance(ci.cid.as_ptr(), IComponent::IID.as_ptr() as FIDString, &mut obj);
            if r != kResultOk {
                return Err(format!("The plugin could not create its processor (error {r})."));
            }
            ComPtr::from_raw(obj as *mut IComponent).ok_or("The plugin could not create its processor.")?
        };
        if unsafe { component.initialize(host_ptr) } != kResultOk {
            return Err("The plugin failed to initialise.".into());
        }
        let processor = component.cast::<IAudioProcessor>().ok_or("The plugin has no audio processor.")?;

        // The edit controller: a separate class, or the component itself.
        let mut ctrl_id: TUID = [0; 16];
        let separate = unsafe { component.getControllerClassId(&mut ctrl_id) } == kResultOk && ctrl_id != [0; 16];
        let controller = if separate {
            unsafe {
                let mut obj: *mut c_void = std::ptr::null_mut();
                factory.createInstance(ctrl_id.as_ptr(), IEditController::IID.as_ptr() as FIDString, &mut obj);
                ComPtr::from_raw(obj as *mut IEditController).filter(|c| c.initialize(host_ptr) == kResultOk)
            }
        } else {
            component.cast::<IEditController>()
        };
        let separate = separate && controller.is_some();
        let edits = Arc::new(Mutex::new(Vec::new()));
        let handler = ComWrapper::new(Handler { edits: edits.clone() });
        let conn = unsafe {
            if let Some(c) = &controller {
                c.setComponentHandler(handler.as_com_ref::<IComponentHandler>().unwrap().as_ptr());
            }
            match (separate, component.cast::<IConnectionPoint>(), controller.as_ref().and_then(|c| c.cast::<IConnectionPoint>())) {
                (true, Some(a), Some(b)) => {
                    a.connect(b.as_ptr());
                    b.connect(a.as_ptr());
                    Some((a, b))
                }
                _ => None,
            }
        };

        // Buses: stereo main in/out where offered; others as the plugin reports.
        let (n_in, n_out, n_ev) = unsafe {
            (
                component.getBusCount(MediaTypes_::kAudio, BusDirections_::kInput).max(0) as usize,
                component.getBusCount(MediaTypes_::kAudio, BusDirections_::kOutput).max(0) as usize,
                component.getBusCount(MediaTypes_::kEvent, BusDirections_::kInput).max(0),
            )
        };
        let arrangement = |dir: BusDirection, i: usize| -> SpeakerArrangement {
            let mut a: SpeakerArrangement = SpeakerArr::kStereo;
            if i > 0 {
                unsafe { processor.getBusArrangement(dir, i as int32, &mut a) };
            }
            a
        };
        let mut in_arr: Vec<SpeakerArrangement> = (0..n_in).map(|i| arrangement(BusDirections_::kInput, i)).collect();
        let mut out_arr: Vec<SpeakerArrangement> = (0..n_out).map(|i| arrangement(BusDirections_::kOutput, i)).collect();
        unsafe {
            processor.setBusArrangements(in_arr.as_mut_ptr(), n_in as int32, out_arr.as_mut_ptr(), n_out as int32);
        }
        let channels = |dir: BusDirection, n: usize| -> Vec<usize> {
            (0..n)
                .map(|i| unsafe {
                    let mut b: BusInfo = std::mem::zeroed();
                    if component.getBusInfo(MediaTypes_::kAudio, dir, i as int32, &mut b) == kResultOk {
                        b.channelCount.max(0) as usize
                    } else {
                        2
                    }
                })
                .collect()
        };
        let in_ch = channels(BusDirections_::kInput, n_in);
        let out_ch = channels(BusDirections_::kOutput, n_out);
        unsafe {
            if n_out > 0 {
                component.activateBus(MediaTypes_::kAudio, BusDirections_::kOutput, 0, 1);
            }
            if n_in > 0 {
                component.activateBus(MediaTypes_::kAudio, BusDirections_::kInput, 0, 1);
            }
            if n_ev > 0 {
                component.activateBus(MediaTypes_::kEvent, BusDirections_::kInput, 0, 1);
            }
        }

        let name = cstr(&ci.name);
        let name = if name.is_empty() { Path::new(path).file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "VST3".into()) } else { name };
        let num_params = controller.as_ref().map_or(0, |c| unsafe { c.getParameterCount() });
        let key = usize::MAX - NEXT_KEY.fetch_add(1, Ordering::Relaxed);
        let plugin = Vst3Plugin {
            info: PluginInfo {
                name,
                vendor,
                inputs: in_ch.first().copied().unwrap_or(0) as i32,
                outputs: out_ch.first().copied().unwrap_or(2).max(1) as i32,
                can_replacing: true,
                is_synth: sub.split('|').any(|s| s.eq_ignore_ascii_case("Instrument")) || (n_in == 0 && n_ev > 0),
                has_editor: controller.is_some(),
                program_chunks: true,
                num_params,
                num_programs: 0,
                unique_id: 0,
            },
            path: path.to_string(),
            key,
            view: Mutex::new(None),
            frame: ComWrapper::new(Frame { key }),
            proc: Mutex::new(Proc::new(sample_rate, &in_ch, &out_ch)),
            notes: Mutex::new(Vec::with_capacity(64)),
            edits,
            peak: AtomicU32::new(0),
            conn,
            controller,
            separate_controller: separate,
            processor,
            component,
            _handler: handler,
            _host: host,
            _factory: factory,
            _module: module,
        };
        // Let the controller reflect the processor's initial state.
        plugin.sync_controller(None);
        plugin.start(sample_rate, ProcessModes_::kRealtime);
        log::write(&format!(
            "VST3 ready: {} [{}] in={:?} out={:?} events={} synth={} separate controller={}",
            plugin.info.name, sub, in_ch, out_ch, n_ev, plugin.info.is_synth, separate
        ));
        Ok(Arc::new(plugin))
    }

    fn start(&self, sample_rate: f32, mode: i32) {
        let mut setup = ProcessSetup { processMode: mode, symbolicSampleSize: SymbolicSampleSizes_::kSample32, maxSamplesPerBlock: BLOCK_SIZE as int32, sampleRate: sample_rate as f64 };
        unsafe {
            self.processor.setupProcessing(&mut setup);
            self.component.setActive(1);
            self.processor.setProcessing(1);
        }
    }

    fn stop(&self) {
        unsafe {
            self.processor.setProcessing(0);
            self.component.setActive(0);
        }
    }

    /// Hand the processor's state (given, or read from it) to the controller.
    fn sync_controller(&self, state: Option<&[u8]>) {
        let Some(c) = &self.controller else { return };
        unsafe {
            let s = match state {
                Some(b) => MemStream::new(b.to_vec()),
                None => {
                    let s = MemStream::new(Vec::new());
                    if self.component.getState(s.as_com_ref::<IBStream>().unwrap().as_ptr()) != kResultOk {
                        return;
                    }
                    s.rewind();
                    s
                }
            };
            c.setComponentState(s.as_com_ref::<IBStream>().unwrap().as_ptr());
        }
    }

    fn push_note(&self, ev: NoteEv) {
        if let Ok(mut q) = self.notes.lock() {
            if q.len() < MAX_EVENTS {
                q.push(ev);
            }
        }
    }

    /// One `process` call of `frames` frames. `pos` = project position in
    /// samples for offline renders (live renders follow the host transport).
    fn process_block(&self, st: &mut Proc, frames: usize, events: &[(i32, NoteEv)], pos: Option<u64>) {
        unsafe {
            let list = st.events.list();
            list.clear();
            for &(offset, n) in events.iter().take(MAX_EVENTS) {
                let mut e: Event = std::mem::zeroed();
                e.busIndex = 0;
                e.sampleOffset = offset;
                e.flags = Event_::EventFlags_::kIsLive as uint16;
                if n.on {
                    e.r#type = Event_::EventTypes_::kNoteOnEvent as uint16;
                    e.__field0.noteOn = NoteOnEvent { channel: n.channel, pitch: n.pitch, tuning: 0.0, velocity: n.velocity, length: 0, noteId: -1 };
                } else {
                    e.r#type = Event_::EventTypes_::kNoteOffEvent as uint16;
                    e.__field0.noteOff = NoteOffEvent { channel: n.channel, pitch: n.pitch, velocity: 0.0, noteId: -1, tuning: 0.0 };
                }
                list.push(e);
            }
            st.out_events.list().clear();
            st.params.clear();
            st.out_params.clear();
            if let Ok(mut e) = self.edits.try_lock() {
                for (id, v) in e.drain(..) {
                    st.params.add(id, 0, v);
                }
            }
        }
        for bus in st.outs.iter_mut().chain(st.ins.iter_mut()) {
            for b in bus.bufs.iter_mut() {
                b[..frames].fill(0.0);
            }
        }
        st.in_bufs.clear();
        st.out_bufs.clear();
        for b in st.ins.iter_mut() {
            let x = b.buffers();
            st.in_bufs.push(x);
        }
        for b in st.outs.iter_mut() {
            let x = b.buffers();
            st.out_bufs.push(x);
        }

        let (tempo, playing, live_pos, num, den) = host_callback::transport();
        let (samples, playing) = match pos {
            Some(p) => (p, true),
            None => (live_pos, playing),
        };
        let rate = st.sample_rate as f64;
        let ppq = samples as f64 / rate * tempo / 60.0;
        let quarters_per_bar = num.max(1) as f64 * 4.0 / den.max(1) as f64;
        use ProcessContext_::StatesAndFlags_ as F;
        st.ctx.state = (F::kTempoValid | F::kTimeSigValid | F::kProjectTimeMusicValid | F::kBarPositionValid | if playing { F::kPlaying } else { 0 }) as uint32;
        st.ctx.sampleRate = rate;
        st.ctx.projectTimeSamples = samples as i64;
        st.ctx.continousTimeSamples = samples as i64;
        st.ctx.projectTimeMusic = ppq;
        st.ctx.barPositionMusic = (ppq / quarters_per_bar).floor() * quarters_per_bar;
        st.ctx.tempo = tempo;
        st.ctx.timeSigNumerator = num;
        st.ctx.timeSigDenominator = den;

        let mut data = ProcessData {
            processMode: if pos.is_some() { ProcessModes_::kOffline } else { ProcessModes_::kRealtime },
            symbolicSampleSize: SymbolicSampleSizes_::kSample32,
            numSamples: frames as int32,
            numInputs: st.in_bufs.len() as int32,
            numOutputs: st.out_bufs.len() as int32,
            inputs: if st.in_bufs.is_empty() { std::ptr::null_mut() } else { st.in_bufs.as_mut_ptr() },
            outputs: if st.out_bufs.is_empty() { std::ptr::null_mut() } else { st.out_bufs.as_mut_ptr() },
            inputParameterChanges: st.params.as_com_ref::<IParameterChanges>().unwrap().as_ptr(),
            outputParameterChanges: st.out_params.as_com_ref::<IParameterChanges>().unwrap().as_ptr(),
            inputEvents: st.events.as_com_ref::<IEventList>().unwrap().as_ptr(),
            outputEvents: st.out_events.as_com_ref::<IEventList>().unwrap().as_ptr(),
            processContext: &mut st.ctx,
        };
        unsafe { self.processor.process(&mut data) };
    }

    fn stereo_at(st: &Proc, i: usize) -> (f32, f32) {
        match st.outs.first() {
            Some(b) if b.bufs.len() >= 2 => (b.bufs[0][i], b.bufs[1][i]),
            Some(b) if b.bufs.len() == 1 => (b.bufs[0][i], b.bufs[0][i]),
            _ => (0.0, 0.0),
        }
    }

    fn with_view<R>(&self, f: impl FnOnce(&ComPtr<IPlugView>) -> R) -> Option<R> {
        let mut g = self.view.lock().ok()?;
        if g.is_none() {
            let c = self.controller.as_ref()?;
            let v = unsafe { ComPtr::from_raw(c.createView(ViewType::kEditor)) }?;
            if unsafe { v.isPlatformTypeSupported(kPlatformTypeHWND) } != kResultTrue {
                return None;
            }
            unsafe { v.setFrame(self.frame.as_com_ref::<IPlugFrame>().unwrap().as_ptr()) };
            *g = Some(v);
        }
        g.as_ref().map(f)
    }
}

impl AudioSource for Vst3Plugin {
    /// Runs on the callback's own frame count (chunks of at most one block),
    /// so a note played now sounds in this callback. No allocation, no blocking.
    fn render_add(&self, out: &mut [f32], frames: usize) {
        let Ok(mut st) = self.proc.try_lock() else { return };
        set_thread_process_level(ProcessLevel::Realtime);
        let mut pending = std::mem::take(&mut st.pending);
        if let Ok(mut q) = self.notes.try_lock() {
            pending.extend(q.drain(..).map(|n| (0, n)));
        }
        let mut peak = 0f32;
        let mut done = 0;
        while done < frames {
            let n = (frames - done).min(BLOCK_SIZE);
            self.process_block(&mut st, n, &pending, None);
            pending.clear();
            for i in 0..n {
                let (l, r) = Self::stereo_at(&st, i);
                out[(done + i) * 2] += l;
                out[(done + i) * 2 + 1] += r;
                peak = peak.max(l.abs()).max(r.abs());
            }
            done += n;
        }
        st.pending = pending;
        if peak > f32::from_bits(self.peak.load(Ordering::Relaxed)) {
            self.peak.store(peak.to_bits(), Ordering::Relaxed);
        }
    }
}

impl Hosted for Vst3Plugin {
    fn info(&self) -> &PluginInfo {
        &self.info
    }
    fn path(&self) -> &str {
        &self.path
    }
    fn note_on(&self, pitch: i32, velocity: i32) {
        self.push_note(NoteEv { on: true, channel: 0, pitch: pitch.clamp(0, 127) as i16, velocity: velocity.clamp(1, 127) as f32 / 127.0 });
    }
    fn note_off(&self, pitch: i32) {
        self.push_note(NoteEv { on: false, channel: 0, pitch: pitch.clamp(0, 127) as i16, velocity: 0.0 });
    }
    /// VST3 has no all-notes-off message: release every key.
    fn all_notes_off(&self) {
        if let Ok(mut q) = self.notes.lock() {
            q.retain(|n| !n.on);
            for p in 0..128 {
                q.push(NoteEv { on: false, channel: 0, pitch: p, velocity: 0.0 });
            }
        }
    }
    fn take_peak(&self) -> f32 {
        f32::from_bits(self.peak.swap(0, Ordering::Relaxed))
    }

    /// Offline render on this instance (switched to offline processing for the
    /// duration; the live stream for it is muted meanwhile, as with VST2).
    fn render_offline(&self, notes: &[RenderNote], sample_rate: f32, total_frames: usize, live_rate: f32) -> Vec<f32> {
        let mut pcm = vec![0f32; total_frames * 2];
        if total_frames == 0 {
            return pcm;
        }
        let mut st = self.proc.lock().unwrap_or_else(|p| p.into_inner());
        set_thread_process_level(ProcessLevel::Offline);
        if let Ok(mut q) = self.notes.lock() {
            q.clear();
        }
        self.stop();
        self.start(sample_rate, ProcessModes_::kOffline);
        st.sample_rate = sample_rate;

        let mut events: Vec<(i64, NoteEv)> = Vec::with_capacity(notes.len() * 2);
        for n in notes {
            let on = n.start_frame.clamp(0, total_frames as i64 - 1);
            let off = n.end_frame.clamp(on + 1, total_frames as i64);
            let p = n.pitch.clamp(0, 127) as i16;
            events.push((on, NoteEv { on: true, channel: 0, pitch: p, velocity: n.velocity.clamp(1, 127) as f32 / 127.0 }));
            events.push((off, NoteEv { on: false, channel: 0, pitch: p, velocity: 0.0 }));
        }
        events.sort_by_key(|(f, e)| (*f, e.on));

        let mut ev = 0;
        let mut frame = 0usize;
        while frame < total_frames {
            let n = BLOCK_SIZE.min(total_frames - frame);
            let start = ev;
            while ev < events.len() && events[ev].0 < (frame + n) as i64 {
                ev += 1;
            }
            let block: Vec<(i32, NoteEv)> = events[start..ev].iter().map(|(f, e)| ((*f - frame as i64).max(0) as i32, *e)).collect();
            self.process_block(&mut st, n, &block, Some(frame as u64));
            for i in 0..n {
                let (l, r) = Self::stereo_at(&st, i);
                pcm[(frame + i) * 2] = l;
                pcm[(frame + i) * 2 + 1] = r;
            }
            frame += n;
        }
        let tail: Vec<(i32, NoteEv)> = events[ev..].iter().map(|(_, e)| (0, *e)).collect();
        if !tail.is_empty() {
            self.process_block(&mut st, BLOCK_SIZE, &tail, Some(frame as u64));
        }

        self.stop();
        self.start(live_rate, ProcessModes_::kRealtime);
        st.sample_rate = live_rate;
        set_thread_process_level(ProcessLevel::User);
        log::write(&format!("offline render {} (VST3): {} notes -> {} frames @ {} Hz", self.info.name, notes.len(), total_frames, sample_rate));
        pcm
    }

    fn set_live_sample_rate(&self, sample_rate: f32) {
        let mut st = self.proc.lock().unwrap_or_else(|p| p.into_inner());
        if (st.sample_rate - sample_rate).abs() < 0.5 {
            return;
        }
        self.stop();
        self.start(sample_rate, ProcessModes_::kRealtime);
        st.sample_rate = sample_rate;
    }

    fn save_state(&self) -> PluginState {
        let read = |f: &dyn Fn(*mut IBStream) -> tresult| -> Vec<u8> {
            let s = MemStream::new(Vec::new());
            if f(s.as_com_ref::<IBStream>().unwrap().as_ptr()) == kResultOk {
                s.take()
            } else {
                Vec::new()
            }
        };
        let component = read(&|s| unsafe { self.component.getState(s) });
        let controller = match &self.controller {
            Some(c) => read(&|s| unsafe { c.getState(s) }),
            None => Vec::new(),
        };
        PluginState::Vst3 { component, controller }
    }

    fn load_state(&self, state: &PluginState) {
        let PluginState::Vst3 { component, controller } = state else {
            log::write(&format!("{}: ignoring a non-VST3 state", self.info.name));
            return;
        };
        let _guard = self.proc.lock().unwrap_or_else(|p| p.into_inner());
        unsafe {
            if !component.is_empty() {
                let s = MemStream::new(component.clone());
                let r = self.component.setState(s.as_com_ref::<IBStream>().unwrap().as_ptr());
                log::write(&format!("{}: processor state {} bytes -> {r}", self.info.name, component.len()));
                self.sync_controller(Some(component));
            }
            if let (Some(c), false) = (&self.controller, controller.is_empty()) {
                let s = MemStream::new(controller.clone());
                c.setState(s.as_com_ref::<IBStream>().unwrap().as_ptr());
            }
        }
    }

    fn editor_rect(&self) -> Option<(i32, i32)> {
        self.with_view(|v| unsafe {
            let mut r: ViewRect = std::mem::zeroed();
            (v.getSize(&mut r) == kResultOk).then(|| (r.right - r.left, r.bottom - r.top))
        })
        .flatten()
        .filter(|&(w, h)| w > 0 && h > 0)
    }

    fn editor_open(&self, parent: isize) -> bool {
        self.with_view(|v| unsafe { v.attached(parent as *mut c_void, kPlatformTypeHWND) == kResultOk }).unwrap_or(false)
    }

    fn editor_idle(&self) {}

    fn editor_close(&self) {
        let view = self.view.lock().ok().and_then(|mut g| g.take());
        if let Some(v) = view {
            unsafe {
                v.removed();
                v.setFrame(std::ptr::null_mut());
            }
        }
    }

    fn editor_key(&self) -> usize {
        self.key
    }
}

impl Drop for Vst3Plugin {
    fn drop(&mut self) {
        crate::editor::forget(self.key);
        self.editor_close();
        let _guard = self.proc.lock().unwrap_or_else(|p| p.into_inner());
        self.stop();
        unsafe {
            if let Some((a, b)) = &self.conn {
                a.disconnect(b.as_ptr());
                b.disconnect(a.as_ptr());
            }
            if let Some(c) = &self.controller {
                c.setComponentHandler(std::ptr::null_mut());
                if self.separate_controller {
                    c.terminate();
                }
            }
            self.component.terminate();
        }
        log::write(&format!("VST3 closed: {}", self.info.name));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_and_paths() {
        let id = parse_hex16("58455356736673506572756d20320000").unwrap();
        assert_eq!(&id[..4], b"XESV");
        assert_eq!(com_swapped(com_swapped(id)), id);
        assert!(is_vst3_path("C:/x/Serum2.vst3"));
        assert!(is_vst3_path("C:\\x\\Serum2.VST3\\"));
        assert!(!is_vst3_path("C:/x/Serum.dll"));
    }

    #[test]
    fn state_bytes_round_trip() {
        let s = PluginState::Vst3 { component: vec![1, 2, 3], controller: vec![9] };
        match PluginState::from_bytes(&s.to_bytes()) {
            Some(PluginState::Vst3 { component, controller }) => {
                assert_eq!(component, vec![1, 2, 3]);
                assert_eq!(controller, vec![9]);
            }
            other => panic!("{other:?}"),
        }
    }

    /// `FLS_VST3=<path> cargo test -p fls-native -- --ignored --nocapture vst3_real`
    #[test]
    #[ignore]
    fn vst3_real() {
        let path = std::env::var("FLS_VST3").expect("FLS_VST3");
        let p = Vst3Plugin::load(&path, 48000.0, None).expect("load");
        println!("{:?}", p.info);
        let st = p.save_state();
        if let PluginState::Vst3 { component, controller } = &st {
            println!("state: component {} bytes, controller {} bytes", component.len(), controller.len());
        }
        p.load_state(&st);
        let notes = [RenderNote { pitch: 60, velocity: 100, start_frame: 0, end_frame: 24000 }];
        let rms = |pcm: &[f32]| (pcm.iter().map(|v| v * v).sum::<f32>() / pcm.len() as f32).sqrt();
        let default_rms = rms(&p.render_offline(&notes, 48000.0, 48000, 48000.0));
        // A saved state in the tagged form (e.g. lifted from a project file).
        if let Ok(f) = std::env::var("FLS_VST3_STATE") {
            let bytes = std::fs::read(f).expect("state file");
            p.load_state(&PluginState::from_bytes(&bytes).expect("tagged state"));
            let after = p.save_state();
            if let PluginState::Vst3 { component, .. } = &after {
                println!("after load: component {} bytes", component.len());
            }
            println!("rms default {default_rms:.4} -> with saved state {:.4}", rms(&p.render_offline(&notes, 48000.0, 48000, 48000.0)));
        }
        let notes = [RenderNote { pitch: 60, velocity: 100, start_frame: 0, end_frame: 24000 }];
        let pcm = p.render_offline(&notes, 48000.0, 48000, 48000.0);
        let peak = pcm.iter().fold(0f32, |m, v| m.max(v.abs()));
        println!("rendered peak {peak}");
        println!("editor size {:?}", p.editor_rect());
        p.editor_close();
    }
}
