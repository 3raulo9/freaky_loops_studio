//! ASIO output. Drivers register under HKLM\SOFTWARE\ASIO and are in-process
//! COM objects whose class id doubles as the interface id. Only one driver
//! can be open at a time (the callbacks carry no context), which matches how
//! ASIO is used anyway. 64-bit only: 32-bit drivers use thiscall.

use crate::log;
use std::ffi::c_void;
use std::sync::atomic::{AtomicBool, AtomicPtr, AtomicU32, Ordering};
use windows_sys::core::GUID;
use windows_sys::Win32::System::Com::{CLSIDFromString, CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED};
use windows_sys::Win32::System::Registry::*;

type AsioError = i32;
const ASE_OK: AsioError = 0;

// Sample types (output buffers are little endian on Windows).
const INT16_LSB: i32 = 16;
const INT24_LSB: i32 = 17;
const INT32_LSB: i32 = 18;
const FLOAT32_LSB: i32 = 19;
const FLOAT64_LSB: i32 = 20;
const INT32_LSB16: i32 = 24;
const INT32_LSB18: i32 = 25;
const INT32_LSB20: i32 = 26;
const INT32_LSB24: i32 = 27;

#[repr(C)]
struct Vtbl {
    query_interface: unsafe extern "system" fn(*mut c_void, *const GUID, *mut *mut c_void) -> i32,
    add_ref: unsafe extern "system" fn(*mut c_void) -> u32,
    release: unsafe extern "system" fn(*mut c_void) -> u32,
    init: unsafe extern "system" fn(*mut c_void, *mut c_void) -> i32,
    get_driver_name: unsafe extern "system" fn(*mut c_void, *mut u8),
    get_driver_version: unsafe extern "system" fn(*mut c_void) -> i32,
    get_error_message: unsafe extern "system" fn(*mut c_void, *mut u8),
    start: unsafe extern "system" fn(*mut c_void) -> AsioError,
    stop: unsafe extern "system" fn(*mut c_void) -> AsioError,
    get_channels: unsafe extern "system" fn(*mut c_void, *mut i32, *mut i32) -> AsioError,
    get_latencies: unsafe extern "system" fn(*mut c_void, *mut i32, *mut i32) -> AsioError,
    get_buffer_size: unsafe extern "system" fn(*mut c_void, *mut i32, *mut i32, *mut i32, *mut i32) -> AsioError,
    can_sample_rate: unsafe extern "system" fn(*mut c_void, f64) -> AsioError,
    get_sample_rate: unsafe extern "system" fn(*mut c_void, *mut f64) -> AsioError,
    set_sample_rate: unsafe extern "system" fn(*mut c_void, f64) -> AsioError,
    get_clock_sources: unsafe extern "system" fn(*mut c_void, *mut c_void, *mut i32) -> AsioError,
    set_clock_source: unsafe extern "system" fn(*mut c_void, i32) -> AsioError,
    get_sample_position: unsafe extern "system" fn(*mut c_void, *mut [u32; 2], *mut [u32; 2]) -> AsioError,
    get_channel_info: unsafe extern "system" fn(*mut c_void, *mut ChannelInfo) -> AsioError,
    create_buffers: unsafe extern "system" fn(*mut c_void, *mut BufferInfo, i32, i32, *const Callbacks) -> AsioError,
    dispose_buffers: unsafe extern "system" fn(*mut c_void) -> AsioError,
    control_panel: unsafe extern "system" fn(*mut c_void) -> AsioError,
    future: unsafe extern "system" fn(*mut c_void, i32, *mut c_void) -> AsioError,
    output_ready: unsafe extern "system" fn(*mut c_void) -> AsioError,
}

#[repr(C)]
struct ChannelInfo {
    channel: i32,
    is_input: i32,
    is_active: i32,
    group: i32,
    sample_type: i32,
    name: [u8; 32],
}

#[repr(C)]
#[derive(Clone, Copy)]
struct BufferInfo {
    is_input: i32,
    channel: i32,
    buffers: [*mut c_void; 2],
}

#[repr(C)]
struct Callbacks {
    buffer_switch: extern "C" fn(i32, i32),
    sample_rate_did_change: extern "C" fn(f64),
    asio_message: extern "C" fn(i32, i32, *mut c_void, *mut f64) -> i32,
    buffer_switch_time_info: extern "C" fn(*mut c_void, i32, i32) -> *mut c_void,
}

static CALLBACKS: Callbacks = Callbacks { buffer_switch, sample_rate_did_change, asio_message, buffer_switch_time_info };

/// An installed driver.
#[derive(Debug, Clone)]
pub struct Driver {
    pub name: String,
    clsid: String,
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain([0]).collect()
}

/// Drivers registered on this machine.
pub fn drivers() -> Vec<Driver> {
    let mut out = Vec::new();
    unsafe {
        let mut root: HKEY = std::ptr::null_mut();
        let path = wide(r"SOFTWARE\ASIO");
        if RegOpenKeyExW(HKEY_LOCAL_MACHINE, path.as_ptr(), 0, KEY_READ, &mut root) != 0 {
            return out;
        }
        for i in 0.. {
            let mut name = [0u16; 256];
            let mut len = name.len() as u32;
            if RegEnumKeyExW(root, i, name.as_mut_ptr(), &mut len, std::ptr::null(), std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null_mut()) != 0 {
                break;
            }
            let key_name = String::from_utf16_lossy(&name[..len as usize]);
            let mut sub: HKEY = std::ptr::null_mut();
            let kw = wide(&key_name);
            if RegOpenKeyExW(root, kw.as_ptr(), 0, KEY_READ, &mut sub) == 0 {
                let mut buf = [0u16; 128];
                let mut sz = (buf.len() * 2) as u32;
                let value = wide("CLSID");
                if RegQueryValueExW(sub, value.as_ptr(), std::ptr::null(), std::ptr::null_mut(), buf.as_mut_ptr() as *mut u8, &mut sz) == 0 {
                    let clsid = String::from_utf16_lossy(&buf[..(sz as usize / 2)]).trim_end_matches('\0').to_string();
                    out.push(Driver { name: key_name, clsid });
                }
                RegCloseKey(sub);
            }
        }
        RegCloseKey(root);
    }
    out
}

pub type Render = Box<dyn FnMut(&mut [f32], usize) + Send>;
pub type OnError = Box<dyn Fn(String) + Send + Sync>;

/// What the callbacks need; one at a time, reached through `ACTIVE`.
struct Runtime {
    driver: *mut c_void,
    vtbl: *const Vtbl,
    bufs: [BufferInfo; 2],
    sample_type: i32,
    frames: usize,
    render: Render,
    scratch: Vec<f32>,
    on_error: OnError,
    output_ready: bool,
}

static ACTIVE: AtomicPtr<Runtime> = AtomicPtr::new(std::ptr::null_mut());
static RESET: AtomicBool = AtomicBool::new(false);
static OVERLOADS: AtomicU32 = AtomicU32::new(0);

#[derive(Debug, Clone)]
pub struct Opened {
    pub device: String,
    pub rate: u32,
    pub frames: u32,
    pub latency: f64,
    pub format: String,
    pub buffer_sizes: Vec<u32>,
}

/// An open, running driver; dropping it stops and releases it.
pub struct Stream {
    rt: *mut Runtime,
}

impl Drop for Stream {
    fn drop(&mut self) {
        unsafe {
            let rt = &mut *self.rt;
            let v = &*rt.vtbl;
            (v.stop)(rt.driver);
            ACTIVE.store(std::ptr::null_mut(), Ordering::SeqCst);
            (v.dispose_buffers)(rt.driver);
            (v.release)(rt.driver);
            drop(Box::from_raw(self.rt));
        }
        log::write("ASIO driver closed");
    }
}

/// True when the driver asked to be reopened (settings changed in its panel).
pub fn take_reset_request() -> bool {
    RESET.swap(false, Ordering::SeqCst)
}

pub fn take_overloads() -> u32 {
    OVERLOADS.swap(0, Ordering::SeqCst)
}

fn error_text(driver: *mut c_void, v: &Vtbl) -> String {
    let mut msg = [0u8; 124];
    unsafe { (v.get_error_message)(driver, msg.as_mut_ptr()) };
    let n = msg.iter().position(|&b| b == 0).unwrap_or(msg.len());
    String::from_utf8_lossy(&msg[..n]).into_owned()
}

/// Possible buffer sizes for a driver's reported range.
fn sizes(min: i32, max: i32, pref: i32, gran: i32) -> Vec<u32> {
    let mut v = Vec::new();
    if gran == -1 {
        let mut s = min.max(1);
        while s <= max {
            v.push(s as u32);
            s *= 2;
        }
    } else if gran > 0 {
        let mut s = min;
        while s <= max && v.len() < 64 {
            v.push(s as u32);
            s += gran;
        }
    } else {
        v.push(pref as u32);
    }
    if !v.contains(&(pref as u32)) {
        v.push(pref as u32);
        v.sort();
    }
    v
}

/// Open the named driver (None = the first installed) and start it.
/// Call on the UI thread (drivers expect their control calls on one thread).
pub fn open(name: Option<&str>, want_rate: Option<u32>, want_frames: Option<u32>, render: Render, on_error: OnError) -> Result<(Stream, Opened), String> {
    if !ACTIVE.load(Ordering::SeqCst).is_null() {
        return Err("another ASIO driver is still open".into());
    }
    let list = drivers();
    let d = match name {
        Some(n) => list.iter().find(|d| d.name == n),
        None => list.first(),
    }
    .ok_or("no such ASIO driver")?
    .clone();
    unsafe {
        CoInitializeEx(std::ptr::null(), COINIT_APARTMENTTHREADED as u32);
        let wclsid = wide(&d.clsid);
        let mut clsid: GUID = std::mem::zeroed();
        if CLSIDFromString(wclsid.as_ptr(), &mut clsid) != 0 {
            return Err("bad driver id in the registry".into());
        }
        // The class id is also the interface id.
        let mut obj: *mut c_void = std::ptr::null_mut();
        let hr = CoCreateInstance(&clsid, std::ptr::null_mut(), CLSCTX_INPROC_SERVER, &clsid, &mut obj);
        if hr != 0 || obj.is_null() {
            return Err(format!("could not load the driver (0x{:08x})", hr as u32));
        }
        let vtbl = *(obj as *const *const Vtbl);
        let v = &*vtbl;
        if (v.init)(obj, std::ptr::null_mut()) == 0 {
            let msg = error_text(obj, v);
            (v.release)(obj);
            return Err(format!("the driver refused to start{}", if msg.is_empty() { String::new() } else { format!(": {msg}") }));
        }
        let fail = |what: &str| -> String {
            let msg = error_text(obj, v);
            (v.release)(obj);
            format!("{what}{}", if msg.is_empty() { String::new() } else { format!(": {msg}") })
        };
        let (mut ins, mut outs) = (0, 0);
        if (v.get_channels)(obj, &mut ins, &mut outs) != ASE_OK || outs < 1 {
            return Err(fail("the driver has no outputs"));
        }
        if let Some(r) = want_rate {
            if (v.can_sample_rate)(obj, r as f64) == ASE_OK {
                (v.set_sample_rate)(obj, r as f64);
            }
        }
        let mut rate = 0f64;
        (v.get_sample_rate)(obj, &mut rate);
        if rate <= 0.0 {
            rate = 48000.0;
            (v.set_sample_rate)(obj, rate);
        }
        let (mut min, mut max, mut pref, mut gran) = (0, 0, 0, 0);
        if (v.get_buffer_size)(obj, &mut min, &mut max, &mut pref, &mut gran) != ASE_OK {
            return Err(fail("buffer sizes"));
        }
        let options = sizes(min, max, pref, gran);
        let frames = want_frames.filter(|f| options.contains(f)).unwrap_or(pref as u32) as i32;

        let mut bufs = [BufferInfo { is_input: 0, channel: 0, buffers: [std::ptr::null_mut(); 2] }; 2];
        let n_out = outs.min(2);
        for (i, b) in bufs.iter_mut().enumerate().take(n_out as usize) {
            b.channel = i as i32;
        }
        let mut info = ChannelInfo { channel: 0, is_input: 0, is_active: 0, group: 0, sample_type: 0, name: [0; 32] };
        (v.get_channel_info)(obj, &mut info);
        let sample_type = info.sample_type;
        if !matches!(sample_type, INT16_LSB | INT24_LSB | INT32_LSB | FLOAT32_LSB | FLOAT64_LSB | INT32_LSB16 | INT32_LSB18 | INT32_LSB20 | INT32_LSB24) {
            return Err(fail(&format!("unsupported sample format {sample_type}")));
        }

        let rt = Box::into_raw(Box::new(Runtime {
            driver: obj,
            vtbl,
            bufs,
            sample_type,
            frames: frames as usize,
            render,
            scratch: vec![0.0; frames as usize * 2],
            on_error,
            output_ready: false,
        }));
        ACTIVE.store(rt, Ordering::SeqCst);
        if (v.create_buffers)(obj, (*rt).bufs.as_mut_ptr(), n_out, frames, &CALLBACKS) != ASE_OK {
            ACTIVE.store(std::ptr::null_mut(), Ordering::SeqCst);
            drop(Box::from_raw(rt));
            return Err(fail("could not create buffers"));
        }
        if n_out == 1 {
            (*rt).bufs[1] = (*rt).bufs[0];
        }
        (*rt).output_ready = (v.output_ready)(obj) == ASE_OK;
        let (mut lin, mut lout) = (0, 0);
        (v.get_latencies)(obj, &mut lin, &mut lout);
        let mut name_buf = [0u8; 32];
        (v.get_driver_name)(obj, name_buf.as_mut_ptr());
        let format = match sample_type {
            INT16_LSB => "16-bit",
            INT24_LSB => "24-bit",
            FLOAT32_LSB => "32-bit float",
            FLOAT64_LSB => "64-bit float",
            _ => "32-bit",
        };
        if (v.start)(obj) != ASE_OK {
            let stream = Stream { rt };
            drop(stream);
            return Err("the driver wouldn't start".into());
        }
        let opened = Opened {
            device: d.name.clone(),
            rate: rate as u32,
            frames: frames as u32,
            latency: if lout > 0 { lout as f64 / rate } else { 2.0 * frames as f64 / rate },
            format: format.into(),
            buffer_sizes: options,
        };
        log::write(&format!("ASIO: '{}' {} Hz, {} frames ({:.1} ms), {}, output latency {:.1} ms", d.name, opened.rate, frames, frames as f64 * 1000.0 / rate, format, opened.latency * 1000.0));
        Ok((Stream { rt }, opened))
    }
}

/// Open the driver's own settings window (buffer size, device, …).
pub fn control_panel(stream: &Stream) {
    unsafe {
        let rt = &*stream.rt;
        ((*rt.vtbl).control_panel)(rt.driver);
    }
}

extern "C" fn buffer_switch(index: i32, _direct: i32) {
    let p = ACTIVE.load(Ordering::Acquire);
    if p.is_null() {
        return;
    }
    let rt = unsafe { &mut *p };
    let n = rt.frames;
    (rt.render)(&mut rt.scratch, n);
    let idx = (index & 1) as usize;
    for ch in 0..2 {
        let dst = rt.bufs[ch].buffers[idx];
        if dst.is_null() {
            continue;
        }
        write_channel(&rt.scratch, ch, n, rt.sample_type, dst);
    }
    if rt.output_ready {
        unsafe { ((*rt.vtbl).output_ready)(rt.driver) };
    }
}

fn write_channel(st: &[f32], ch: usize, n: usize, ty: i32, dst: *mut c_void) {
    unsafe {
        match ty {
            FLOAT32_LSB => {
                let d = std::slice::from_raw_parts_mut(dst as *mut f32, n);
                for i in 0..n {
                    d[i] = st[i * 2 + ch];
                }
            }
            FLOAT64_LSB => {
                let d = std::slice::from_raw_parts_mut(dst as *mut f64, n);
                for i in 0..n {
                    d[i] = st[i * 2 + ch] as f64;
                }
            }
            INT16_LSB => {
                let d = std::slice::from_raw_parts_mut(dst as *mut i16, n);
                for i in 0..n {
                    d[i] = (st[i * 2 + ch].clamp(-1.0, 1.0) * 32767.0) as i16;
                }
            }
            INT24_LSB => {
                let d = std::slice::from_raw_parts_mut(dst as *mut u8, n * 3);
                for i in 0..n {
                    let v = (st[i * 2 + ch].clamp(-1.0, 1.0) * 8388607.0) as i32;
                    d[i * 3..i * 3 + 3].copy_from_slice(&v.to_le_bytes()[..3]);
                }
            }
            _ => {
                // 32-bit containers holding 16/18/20/24/32 significant bits.
                let bits = match ty {
                    INT32_LSB16 => 16,
                    INT32_LSB18 => 18,
                    INT32_LSB20 => 20,
                    INT32_LSB24 => 24,
                    _ => 32,
                };
                let scale = ((1i64 << (bits - 1)) - 1) as f64;
                let d = std::slice::from_raw_parts_mut(dst as *mut i32, n);
                for i in 0..n {
                    d[i] = (st[i * 2 + ch].clamp(-1.0, 1.0) as f64 * scale) as i32;
                }
            }
        }
    }
}

extern "C" fn sample_rate_did_change(_rate: f64) {
    RESET.store(true, Ordering::SeqCst);
}

extern "C" fn asio_message(selector: i32, value: i32, _msg: *mut c_void, _opt: *mut f64) -> i32 {
    const SELECTOR_SUPPORTED: i32 = 1;
    const ENGINE_VERSION: i32 = 2;
    const RESET_REQUEST: i32 = 3;
    const BUFFER_SIZE_CHANGE: i32 = 4;
    const RESYNC_REQUEST: i32 = 5;
    const LATENCIES_CHANGED: i32 = 6;
    const OVERLOAD: i32 = 15;
    match selector {
        SELECTOR_SUPPORTED => matches!(value, ENGINE_VERSION | RESET_REQUEST | BUFFER_SIZE_CHANGE | RESYNC_REQUEST | LATENCIES_CHANGED | OVERLOAD) as i32,
        ENGINE_VERSION => 2,
        RESET_REQUEST | BUFFER_SIZE_CHANGE => {
            RESET.store(true, Ordering::SeqCst);
            let p = ACTIVE.load(Ordering::Acquire);
            if !p.is_null() {
                unsafe { ((*p).on_error)("the ASIO driver asked to be restarted".into()) };
            }
            1
        }
        RESYNC_REQUEST | LATENCIES_CHANGED => 1,
        OVERLOAD => {
            OVERLOADS.fetch_add(1, Ordering::Relaxed);
            1
        }
        _ => 0,
    }
}

extern "C" fn buffer_switch_time_info(params: *mut c_void, index: i32, direct: i32) -> *mut c_void {
    buffer_switch(index, direct);
    params
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn buffer_size_options() {
        assert_eq!(sizes(64, 2048, 256, -1), vec![64, 128, 256, 512, 1024, 2048]);
        assert_eq!(sizes(64, 128, 96, 32), vec![64, 96, 128]);
        assert_eq!(sizes(480, 480, 480, 0), vec![480]);
    }

    #[test]
    fn writes_sample_formats() {
        let st = [0.5f32, -0.5, 1.5, 0.0];
        let mut d = [0i16; 2];
        write_channel(&st, 0, 2, INT16_LSB, d.as_mut_ptr() as *mut c_void);
        assert_eq!(d, [16383, 32767]);
        let mut d = [0i32; 2];
        write_channel(&st, 1, 2, INT32_LSB24, d.as_mut_ptr() as *mut c_void);
        assert_eq!(d[0], (-0.5 * 8388607.0) as i32);
    }

    /// `cargo test -p fls-native -- --ignored --nocapture asio_real` (FLS_ASIO=<driver name>).
    #[test]
    #[ignore]
    fn asio_real() {
        println!("drivers: {:?}", drivers().iter().map(|d| &d.name).collect::<Vec<_>>());
        let count = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let c = count.clone();
        let name = std::env::var("FLS_ASIO").ok();
        match open(name.as_deref(), None, None, Box::new(move |out, n| {
            out[..n * 2].fill(0.0);
            c.fetch_add(1, Ordering::SeqCst);
        }), Box::new(|e| println!("error: {e}"))) {
            Ok((stream, info)) => {
                println!("{info:?}");
                std::thread::sleep(std::time::Duration::from_secs(1));
                drop(stream);
                println!("callbacks in 1 s: {}", count.load(Ordering::SeqCst));
            }
            Err(e) => println!("could not open: {e}"),
        }
    }
}
