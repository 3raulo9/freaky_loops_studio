//! WASAPI exclusive mode: the engine takes the device for itself and fills
//! the hardware buffer directly on each device event — no system mixer in
//! between, so buffers of a few milliseconds work. (Shared mode goes through
//! cpal; see engine.rs.)

use crate::log;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::thread::JoinHandle;
use windows::core::PWSTR;
use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
use windows::Win32::Foundation::{CloseHandle, WAIT_OBJECT_0};
use windows::Win32::Media::Audio::*;
use windows::Win32::Media::KernelStreaming::KSDATAFORMAT_SUBTYPE_PCM;
use windows::Win32::Media::Multimedia::KSDATAFORMAT_SUBTYPE_IEEE_FLOAT;
use windows::Win32::System::Com::*;
use windows::Win32::System::Threading::{CreateEventW, WaitForSingleObject};

/// What the device accepted.
#[derive(Debug, Clone)]
pub struct Opened {
    pub device: String,
    pub rate: u32,
    pub frames: u32,
    /// Seconds from rendering a sample to hearing it (buffer + device).
    pub latency: f64,
    pub format: String,
}

/// A running exclusive stream; dropping it stops the device.
pub struct Stream {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl Drop for Stream {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

pub type Render = Box<dyn FnMut(&mut [f32], usize) + Send>;
pub type OnError = Box<dyn Fn(String) + Send>;

#[derive(Clone, Copy, Debug, PartialEq)]
enum Sample {
    F32,
    I32,
    I24In32,
    I24,
    I16,
}

impl Sample {
    fn bytes(self) -> usize {
        match self {
            Sample::F32 | Sample::I32 | Sample::I24In32 => 4,
            Sample::I24 => 3,
            Sample::I16 => 2,
        }
    }
    fn name(self) -> &'static str {
        match self {
            Sample::F32 => "32-bit float",
            Sample::I32 => "32-bit",
            Sample::I24In32 => "24-bit (in 32)",
            Sample::I24 => "24-bit",
            Sample::I16 => "16-bit",
        }
    }
}

fn wave_format(rate: u32, channels: u16, s: Sample) -> WAVEFORMATEXTENSIBLE {
    let mut wf = WAVEFORMATEXTENSIBLE::default();
    let bits = (s.bytes() * 8) as u16;
    wf.Format.wFormatTag = 0xFFFE; // WAVE_FORMAT_EXTENSIBLE
    wf.Format.nChannels = channels;
    wf.Format.nSamplesPerSec = rate;
    wf.Format.wBitsPerSample = bits;
    wf.Format.nBlockAlign = channels * bits / 8;
    wf.Format.nAvgBytesPerSec = rate * (channels * bits / 8) as u32;
    wf.Format.cbSize = 22;
    wf.Samples = WAVEFORMATEXTENSIBLE_0 { wValidBitsPerSample: if s == Sample::I24In32 { 24 } else { bits } };
    wf.dwChannelMask = if channels == 1 { 4 } else { 3 }; // front centre / front left+right
    wf.SubFormat = if s == Sample::F32 { KSDATAFORMAT_SUBTYPE_IEEE_FLOAT } else { KSDATAFORMAT_SUBTYPE_PCM };
    wf
}

fn friendly_name(dev: &IMMDevice) -> String {
    unsafe {
        let Ok(store) = dev.OpenPropertyStore(STGM_READ) else { return String::new() };
        let Ok(pv) = store.GetValue(&PKEY_Device_FriendlyName) else { return String::new() };
        let p: PWSTR = pv.Anonymous.Anonymous.Anonymous.pwszVal;
        if p.is_null() {
            String::new()
        } else {
            p.to_string().unwrap_or_default()
        }
    }
}

fn enumerator() -> windows::core::Result<IMMDeviceEnumerator> {
    unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) }
}

/// Active output devices, default first.
pub fn devices() -> Vec<String> {
    let _com = ComScope::enter();
    let Ok(en) = enumerator() else { return Vec::new() };
    let mut out = Vec::new();
    unsafe {
        let default = en.GetDefaultAudioEndpoint(eRender, eConsole).ok().map(|d| friendly_name(&d));
        if let Ok(list) = en.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE) {
            for i in 0..list.GetCount().unwrap_or(0) {
                if let Ok(d) = list.Item(i) {
                    out.push(friendly_name(&d));
                }
            }
        }
        if let Some(def) = default {
            out.retain(|n| *n != def);
            out.insert(0, def);
        }
    }
    out
}

/// COM for the current thread, undone on drop if this call initialised it.
struct ComScope(bool);
impl ComScope {
    fn enter() -> ComScope {
        ComScope(unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }.is_ok())
    }
}
impl Drop for ComScope {
    fn drop(&mut self) {
        if self.0 {
            unsafe { CoUninitialize() };
        }
    }
}

fn find_device(en: &IMMDeviceEnumerator, name: Option<&str>) -> windows::core::Result<IMMDevice> {
    unsafe {
        if let Some(want) = name {
            let list = en.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE)?;
            for i in 0..list.GetCount()? {
                let d = list.Item(i)?;
                if friendly_name(&d) == want {
                    return Ok(d);
                }
            }
        }
        en.GetDefaultAudioEndpoint(eRender, eConsole)
    }
}

struct Setup {
    client: IAudioClient,
    render: IAudioRenderClient,
    event: windows::Win32::Foundation::HANDLE,
    frames: u32,
    channels: usize,
    sample: Sample,
    info: Opened,
}

/// Open the device exclusively: the first format it takes (float, then
/// integer depths; the wanted rate, then common ones), at the requested
/// buffer size or the nearest one it can align to.
fn setup(device: Option<&str>, want_rate: Option<u32>, want_frames: Option<u32>) -> Result<Setup, String> {
    let e = |what: &'static str| move |err: windows::core::Error| format!("{what}: {err}");
    unsafe {
        let en = enumerator().map_err(e("device list"))?;
        let dev = find_device(&en, device).map_err(e("no such device"))?;
        let name = friendly_name(&dev);
        let probe: IAudioClient = dev.Activate(CLSCTX_ALL, None).map_err(e("activate"))?;
        let mix = probe.GetMixFormat().map_err(e("mix format"))?;
        let mix_rate = (*mix).nSamplesPerSec;
        let mix_ch = (*mix).nChannels;
        CoTaskMemFree(Some(mix as *const _));

        let mut rates = vec![];
        rates.extend(want_rate);
        rates.extend([mix_rate, 48000, 44100, 96000, 88200]);
        rates.dedup();
        let mut chosen = None;
        'search: for &rate in &rates {
            for ch in [2u16, mix_ch] {
                for s in [Sample::F32, Sample::I24In32, Sample::I32, Sample::I24, Sample::I16] {
                    let wf = wave_format(rate, ch, s);
                    if probe.IsFormatSupported(AUDCLNT_SHAREMODE_EXCLUSIVE, &wf.Format, None).is_ok() {
                        chosen = Some((wf, rate, ch, s));
                        break 'search;
                    }
                }
            }
        }
        let (wf, rate, ch, sample) = chosen.ok_or("the device doesn't accept any exclusive-mode format (is exclusive mode allowed in its Windows settings?)")?;

        let (mut def, mut min) = (0i64, 0i64);
        probe.GetDevicePeriod(Some(&mut def), Some(&mut min)).map_err(e("device period"))?;
        drop(probe);
        let hns_for = |frames: u32| (frames as f64 * 10_000_000.0 / rate as f64).round() as i64;
        let mut period = want_frames.map(hns_for).unwrap_or(min).max(min);

        let mut client: IAudioClient = dev.Activate(CLSCTX_ALL, None).map_err(e("activate"))?;
        let mut r = client.Initialize(AUDCLNT_SHAREMODE_EXCLUSIVE, AUDCLNT_STREAMFLAGS_EVENTCALLBACK, period, period, &wf.Format, None);
        if let Err(err) = &r {
            if err.code() == AUDCLNT_E_BUFFER_SIZE_NOT_ALIGNED {
                // Use the size the device rounded to.
                let frames = client.GetBufferSize().map_err(e("buffer size"))?;
                period = hns_for(frames);
                client = dev.Activate(CLSCTX_ALL, None).map_err(e("activate"))?;
                r = client.Initialize(AUDCLNT_SHAREMODE_EXCLUSIVE, AUDCLNT_STREAMFLAGS_EVENTCALLBACK, period, period, &wf.Format, None);
            }
        }
        r.map_err(|err| {
            if err.code() == AUDCLNT_E_DEVICE_IN_USE {
                "another app is using the device exclusively".to_string()
            } else {
                format!("initialise: {err}")
            }
        })?;
        let event = CreateEventW(None, false, false, None).map_err(e("event"))?;
        client.SetEventHandle(event).map_err(e("event"))?;
        let frames = client.GetBufferSize().map_err(e("buffer size"))?;
        let render: IAudioRenderClient = client.GetService().map_err(e("render client"))?;
        let device_latency = client.GetStreamLatency().unwrap_or(0) as f64 / 10_000_000.0;
        let info = Opened {
            device: name,
            rate,
            frames,
            latency: frames as f64 / rate as f64 + device_latency,
            format: format!("{}, {} ch", sample.name(), ch),
        };
        Ok(Setup { client, render, event, frames, channels: ch as usize, sample, info })
    }
}

/// Write interleaved stereo f32 into the device buffer in its format.
fn convert(st: &[f32], frames: usize, channels: usize, sample: Sample, out: *mut u8) {
    let bytes = sample.bytes();
    let out = unsafe { std::slice::from_raw_parts_mut(out, frames * channels * bytes) };
    let mut k = 0;
    for f in 0..frames {
        for c in 0..channels {
            let v = match (channels, c) {
                (1, _) => (st[f * 2] + st[f * 2 + 1]) * 0.5,
                (_, 0) => st[f * 2],
                (_, 1) => st[f * 2 + 1],
                _ => 0.0,
            }
            .clamp(-1.0, 1.0);
            match sample {
                Sample::F32 => out[k..k + 4].copy_from_slice(&v.to_le_bytes()),
                Sample::I32 => out[k..k + 4].copy_from_slice(&((v as f64 * 2147483647.0) as i32).to_le_bytes()),
                Sample::I24In32 => out[k..k + 4].copy_from_slice(&(((v * 8388607.0) as i32) << 8).to_le_bytes()),
                Sample::I24 => out[k..k + 3].copy_from_slice(&((v * 8388607.0) as i32).to_le_bytes()[..3]),
                Sample::I16 => out[k..k + 2].copy_from_slice(&((v * 32767.0) as i16).to_le_bytes()),
            }
            k += bytes;
        }
    }
}

/// Open `device` (None = default) exclusively and start calling `render`.
pub fn open(device: Option<&str>, rate: Option<u32>, frames: Option<u32>, mut render: Render, on_error: OnError) -> Result<(Stream, Opened), String> {
    let stop = Arc::new(AtomicBool::new(false));
    let (tx, rx) = mpsc::channel::<Result<Opened, String>>();
    let device = device.map(str::to_string);
    let stop2 = stop.clone();
    let thread = std::thread::Builder::new()
        .name("wasapi-exclusive".into())
        .spawn(move || {
            let _com = ComScope::enter();
            crate::rt::pro_audio_priority();
            let s = match setup(device.as_deref(), rate, frames) {
                Ok(s) => s,
                Err(err) => {
                    let _ = tx.send(Err(err));
                    return;
                }
            };
            let n = s.frames as usize;
            let mut stereo = vec![0f32; n * 2];
            unsafe {
                // Start with one buffer of silence queued.
                if let Ok(p) = s.render.GetBuffer(s.frames) {
                    std::ptr::write_bytes(p, 0, n * s.channels * s.sample.bytes());
                    let _ = s.render.ReleaseBuffer(s.frames, 0);
                }
                if let Err(err) = s.client.Start() {
                    let _ = tx.send(Err(format!("start: {err}")));
                    return;
                }
            }
            log::write(&format!("WASAPI exclusive: '{}' {} Hz, {} frames ({:.1} ms), {}", s.info.device, s.info.rate, n, n as f64 * 1000.0 / s.info.rate as f64, s.info.format));
            let _ = tx.send(Ok(s.info.clone()));
            while !stop2.load(Ordering::SeqCst) {
                let w = unsafe { WaitForSingleObject(s.event, 500) };
                if w != WAIT_OBJECT_0 {
                    if !stop2.load(Ordering::SeqCst) {
                        on_error("the device stopped asking for audio".into());
                    }
                    break;
                }
                let buf = match unsafe { s.render.GetBuffer(s.frames) } {
                    Ok(p) => p,
                    Err(err) => {
                        on_error(format!("device buffer: {err}"));
                        break;
                    }
                };
                render(&mut stereo, n);
                convert(&stereo, n, s.channels, s.sample, buf);
                if let Err(err) = unsafe { s.render.ReleaseBuffer(s.frames, 0) } {
                    on_error(format!("device buffer: {err}"));
                    break;
                }
            }
            unsafe {
                let _ = s.client.Stop();
                let _ = CloseHandle(s.event);
            }
        })
        .map_err(|e| e.to_string())?;
    match rx.recv() {
        Ok(Ok(info)) => Ok((Stream { stop, thread: Some(thread) }, info)),
        Ok(Err(e)) => {
            let _ = thread.join();
            Err(e)
        }
        Err(_) => Err("the audio thread ended during setup".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_to_device_formats() {
        let st = [0.5f32, -1.0, 2.0, 0.0];
        let mut b = vec![0u8; 2 * 2 * 4];
        convert(&st, 2, 2, Sample::F32, b.as_mut_ptr());
        assert_eq!(f32::from_le_bytes(b[0..4].try_into().unwrap()), 0.5);
        assert_eq!(f32::from_le_bytes(b[8..12].try_into().unwrap()), 1.0); // clamped
        let mut b = vec![0u8; 2 * 2 * 3];
        convert(&st, 2, 2, Sample::I24, b.as_mut_ptr());
        let s0 = i32::from_le_bytes([b[0], b[1], b[2], if b[2] & 0x80 != 0 { 0xff } else { 0 }]);
        assert_eq!(s0, (0.5f32 * 8388607.0) as i32);
        let mut b = vec![0u8; 2 * 1 * 2];
        convert(&st, 2, 1, Sample::I16, b.as_mut_ptr());
        assert_eq!(i16::from_le_bytes([b[0], b[1]]), (-0.25f32 * 32767.0) as i16);
    }

    /// `cargo test -p fls-native -- --ignored --nocapture exclusive_real`:
    /// open the default device exclusively for a second and count callbacks.
    #[test]
    #[ignore]
    fn exclusive_real() {
        println!("devices: {:?}", devices());
        let count = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let c = count.clone();
        let r = open(None, None, std::env::var("FLS_FRAMES").ok().and_then(|v| v.parse().ok()), Box::new(move |out, n| {
            out[..n * 2].fill(0.0);
            c.fetch_add(1, Ordering::SeqCst);
        }), Box::new(|e| println!("error: {e}")));
        match r {
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
