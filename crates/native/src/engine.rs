//! The native audio engine: one output stream that mixes every live source —
//! the UI's own audio (arriving over the web bus), hosted plugins (each
//! through a strip with gain, pan and a meter) and the test tone — into the
//! master bus.
//!
//! The audio thread never blocks and never allocates: the strip list is
//! swapped in whole (lock-free), every buffer is sized up front, and lists
//! that are swapped out are released later on the UI thread, so a plugin is
//! never torn down inside the callback. A failed stream (device unplugged,
//! driver error) is reopened by `poll`.

use crate::host_callback;
use crate::log;
use crate::rt;
use crate::webbus::{BusReader, WebBus};
use arc_swap::{ArcSwap, ArcSwapOption};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Where a block sits on the engine's timeline.
pub struct RenderCtx {
    /// Engine frame of the block's first sample.
    pub start: u64,
    pub rate: f32,
}

/// Anything that can add interleaved stereo audio into the master mix.
pub trait AudioSource: Send + Sync {
    fn render_add(&self, out: &mut [f32], frames: usize, ctx: &RenderCtx);
}

impl AudioSource for crate::plugin::Plugin {
    fn render_add(&self, out: &mut [f32], frames: usize, ctx: &RenderCtx) {
        crate::plugin::Plugin::render_add(self, out, frames, ctx)
    }
}

/// Largest callback the engine renders in one go; longer ones are split.
const MAX_FRAMES: usize = 4096;

/// One source on its way to the master: gain and pan (ramped per block, so
/// moves never click) and a peak meter.
pub struct Strip {
    src: Arc<dyn AudioSource>,
    target: [AtomicU32; 2],
    peak: AtomicU32,
    state: Mutex<StripState>,
}

struct StripState {
    buf: Vec<f32>,
    cur: [f32; 2],
}

impl Strip {
    fn new(src: Arc<dyn AudioSource>) -> Strip {
        Strip {
            src,
            target: [AtomicU32::new(1f32.to_bits()), AtomicU32::new(1f32.to_bits())],
            peak: AtomicU32::new(0),
            state: Mutex::new(StripState { buf: vec![0.0; MAX_FRAMES * 2], cur: [1.0, 1.0] }),
        }
    }

    /// Gain (linear) and pan (-1..1, balance: the far side is attenuated).
    pub fn set_mix(&self, gain: f32, pan: f32) {
        let (g, p) = (gain.clamp(0.0, 4.0), pan.clamp(-1.0, 1.0));
        self.target[0].store((g * (1.0 - p).min(1.0)).to_bits(), Ordering::Relaxed);
        self.target[1].store((g * (1.0 + p).min(1.0)).to_bits(), Ordering::Relaxed);
    }

    /// Peak level after gain since the last call (for meters).
    pub fn take_peak(&self) -> f32 {
        f32::from_bits(self.peak.swap(0, Ordering::Relaxed))
    }

    fn render_add(&self, out: &mut [f32], frames: usize, ctx: &RenderCtx) {
        let Ok(mut st) = self.state.try_lock() else { return };
        let st = &mut *st;
        let buf = &mut st.buf[..frames * 2];
        buf.fill(0.0);
        self.src.render_add(buf, frames, ctx);
        let to = [f32::from_bits(self.target[0].load(Ordering::Relaxed)), f32::from_bits(self.target[1].load(Ordering::Relaxed))];
        let step = [(to[0] - st.cur[0]) / frames as f32, (to[1] - st.cur[1]) / frames as f32];
        let mut g = st.cur;
        let mut peak = 0f32;
        for i in 0..frames {
            g[0] += step[0];
            g[1] += step[1];
            let (l, r) = (buf[i * 2] * g[0], buf[i * 2 + 1] * g[1]);
            out[i * 2] += l;
            out[i * 2 + 1] += r;
            peak = peak.max(l.abs()).max(r.abs());
        }
        st.cur = to;
        if peak > f32::from_bits(self.peak.load(Ordering::Relaxed)) {
            self.peak.store(peak.to_bits(), Ordering::Relaxed);
        }
    }
}

type Strips = Vec<Arc<Strip>>;

#[derive(Default)]
struct Stats {
    /// Callback time / buffer time, ×1000, smoothed and worst since the last read.
    load: AtomicU32,
    load_peak: AtomicU32,
    /// Callbacks that came much later than the buffer length — the device
    /// likely ran dry (an audible dropout).
    late: AtomicU32,
    period: AtomicU32,
}

/// A recording of the master output, for checking what the engine sends to
/// the device (tests, diagnostics). Preallocated: the audio thread only copies.
struct Capture {
    pcm: Mutex<Vec<f32>>,
    dropped: AtomicU32,
}

struct Shared {
    strips: ArcSwap<Strips>,
    capture: ArcSwapOption<Capture>,
    /// Send silence to the device (the capture still records the real mix).
    mute_output: AtomicBool,
    bus: ArcSwapOption<WebBus>,
    tone_hz: AtomicU32,
    master: AtomicU32,
    /// Engine frames rendered so far: the clock plugin events are stamped in.
    frame: AtomicU64,
    failed: AtomicBool,
    stats: Stats,
}

/// A snapshot for the UI's CPU / audio indicators.
#[derive(Debug, Clone, Default)]
pub struct EngineStats {
    pub device: String,
    pub rate: u32,
    pub period: u32,
    pub load: f32,
    pub load_peak: f32,
    pub late: u32,
    pub bus_connected: bool,
    pub bus_underruns: u32,
    pub bus_latency: f64,
    pub bus_max_gap: f64,
    pub output_latency: f64,
}

pub struct Engine {
    _stream: Option<cpal::Stream>,
    shared: Arc<Shared>,
    sample_rate: u32,
    device: Option<String>,
    wanted: Option<String>,
    retired: Vec<(Instant, Arc<Strips>)>,
    last_try: Instant,
}

fn device_name(d: &cpal::Device) -> String {
    d.description().map(|x| x.name().to_string()).unwrap_or_else(|_| "Unknown device".into())
}

/// Names of the available output devices (default device first).
pub fn output_devices() -> Vec<String> {
    let host = cpal::default_host();
    let default = host.default_output_device().map(|d| device_name(&d));
    let mut names: Vec<String> = host.output_devices().map(|it| it.map(|d| device_name(&d)).collect()).unwrap_or_default();
    names.dedup();
    if let Some(def) = default {
        names.retain(|n| *n != def);
        names.insert(0, def);
    }
    names
}

impl Engine {
    /// Open the default output device. If there is none (or it fails), the
    /// engine still works as a silent sink so plugins can load and render.
    pub fn start() -> Engine {
        Self::start_on(None)
    }

    /// Start on the named output device (`None` = system default; an unknown
    /// name also falls back to the default).
    pub fn start_on(device: Option<&str>) -> Engine {
        let shared = Arc::new(Shared {
            strips: ArcSwap::from_pointee(Vec::new()),
            capture: ArcSwapOption::empty(),
            mute_output: AtomicBool::new(false),
            bus: ArcSwapOption::empty(),
            tone_hz: AtomicU32::new(0),
            master: AtomicU32::new(1f32.to_bits()),
            frame: AtomicU64::new(0),
            failed: AtomicBool::new(false),
            stats: Stats::default(),
        });
        let mut e = Engine {
            _stream: None,
            shared,
            sample_rate: 44100,
            device: None,
            wanted: device.map(str::to_string),
            retired: Vec::new(),
            last_try: Instant::now(),
        };
        e.open();
        e
    }

    fn open(&mut self) {
        self._stream = None; // release the old device first
        self.shared.failed.store(false, Ordering::SeqCst);
        self.last_try = Instant::now();
        match open_stream(self.shared.clone(), self.wanted.as_deref()) {
            Ok((stream, rate, name)) => {
                host_callback::set_sample_rate(rate as f32);
                log::write(&format!("audio engine started on '{name}' @ {rate} Hz"));
                self._stream = Some(stream);
                self.sample_rate = rate;
                self.device = Some(name);
            }
            Err(e) => {
                log::write(&format!("audio engine failed to start: {e}"));
                host_callback::set_sample_rate(self.sample_rate as f32);
                self.device = None;
                self.shared.failed.store(true, Ordering::SeqCst);
            }
        }
    }

    /// Move the engine (and every live source) to another output device.
    /// Returns the new sample rate.
    pub fn switch_device(&mut self, device: Option<&str>) -> u32 {
        self.wanted = device.map(str::to_string);
        self.open();
        self.sample_rate
    }

    /// Housekeeping, called a few times a second from the UI thread: reopen a
    /// failed stream and free swapped-out strip lists.
    pub fn poll(&mut self) {
        if self.shared.failed.load(Ordering::SeqCst) && self.last_try.elapsed() > Duration::from_secs(2) {
            log::write("audio stream failed: reopening");
            self.open();
        }
        self.retired.retain(|(t, _)| t.elapsed() < Duration::from_secs(2));
    }

    pub fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    pub fn device_name(&self) -> Option<&str> {
        self.device.as_deref()
    }

    /// The engine's clock: frames rendered so far.
    pub fn frame_now(&self) -> u64 {
        self.shared.frame.load(Ordering::Relaxed)
    }

    /// Mix the UI's audio stream in.
    pub fn attach_bus(&self, bus: Arc<WebBus>) {
        self.shared.bus.store(Some(bus));
    }

    fn swap_strips(&mut self, f: impl FnOnce(&mut Strips)) -> Arc<Strips> {
        let mut next: Strips = (**self.shared.strips.load()).clone();
        f(&mut next);
        self.shared.strips.swap(Arc::new(next))
    }

    pub fn add_source(&mut self, src: Arc<dyn AudioSource>) -> Arc<Strip> {
        let strip = Arc::new(Strip::new(src));
        let s = strip.clone();
        // The audio thread may still be reading the old list: let it go later.
        let old = self.swap_strips(|v| v.push(s));
        self.retired.push((Instant::now(), old));
        strip
    }

    /// Take a source out of the mix. Returns once the audio thread has let go
    /// of it, so dropping the caller's handle frees it here, not mid-callback.
    pub fn remove_source(&mut self, src: &Arc<dyn AudioSource>) {
        let old = self.swap_strips(|v| v.retain(|s| !Arc::ptr_eq(&s.src, src)));
        if self._stream.is_some() && !self.shared.failed.load(Ordering::SeqCst) {
            let f0 = self.frame_now();
            let t = Instant::now();
            while self.frame_now() == f0 && t.elapsed() < Duration::from_millis(200) {
                std::thread::sleep(Duration::from_millis(1));
            }
        }
        drop(old);
        self.retired.clear();
    }

    /// Start recording the master output (up to `seconds`); `mute` keeps the
    /// device silent meanwhile.
    pub fn start_capture(&self, seconds: f32, mute: bool) {
        let n = (seconds.clamp(0.1, 600.0) * self.sample_rate as f32) as usize * 2;
        self.shared.capture.store(Some(Arc::new(Capture { pcm: Mutex::new(Vec::with_capacity(n)), dropped: AtomicU32::new(0) })));
        self.shared.mute_output.store(mute, Ordering::SeqCst);
    }

    /// Stop recording: the interleaved stereo PCM and how many blocks were missed.
    pub fn stop_capture(&self) -> Option<(Vec<f32>, u32)> {
        self.shared.mute_output.store(false, Ordering::SeqCst);
        let cap = self.shared.capture.swap(None)?;
        let pcm = std::mem::take(&mut *cap.pcm.lock().ok()?);
        Some((pcm, cap.dropped.load(Ordering::SeqCst)))
    }

    /// A handle to the engine's clock that other threads can keep.
    pub fn clock(&self) -> Clock {
        Clock(self.shared.clone())
    }

    /// Start (Some(freq)) or stop (None) the diagnostic sine tone.
    pub fn set_tone(&self, freq: Option<f32>) {
        self.shared.tone_hz.store(freq.unwrap_or(0.0).to_bits(), Ordering::Relaxed);
    }

    pub fn set_master_gain(&self, gain: f32) {
        self.shared.master.store(gain.clamp(0.0, 2.0).to_bits(), Ordering::Relaxed);
    }

    /// Load and dropout figures since the last call.
    pub fn stats(&self) -> EngineStats {
        let s = &self.shared.stats;
        let bus = self.shared.bus.load();
        let period = s.period.load(Ordering::Relaxed);
        EngineStats {
            device: self.device.clone().unwrap_or_default(),
            rate: self.sample_rate,
            period,
            load: s.load.load(Ordering::Relaxed) as f32 / 1000.0,
            load_peak: s.load_peak.swap(0, Ordering::Relaxed) as f32 / 1000.0,
            late: s.late.load(Ordering::Relaxed),
            bus_connected: bus.as_ref().is_some_and(|b| b.is_connected()),
            bus_underruns: bus.as_ref().map_or(0, |b| b.underruns.load(Ordering::Relaxed)),
            bus_latency: bus.as_ref().map_or(0.0, |b| b.latency()),
            bus_max_gap: bus.as_ref().map_or(0.0, |b| b.take_max_gap()),
            // Shared mode keeps about two periods queued in the device.
            output_latency: 2.2 * period as f64 / self.sample_rate.max(1) as f64,
        }
    }
}

/// The engine's frame counter, readable from any thread.
#[derive(Clone)]
pub struct Clock(Arc<Shared>);

impl Clock {
    pub fn now(&self) -> u64 {
        self.0.frame.load(Ordering::Relaxed)
    }
}

/// Per-stream render state, owned by the audio callback.
struct Renderer {
    shared: Arc<Shared>,
    reader: BusReader,
    mix: Vec<f32>,
    rate: u32,
    phase: f64,
    last_start: Option<Instant>,
    callbacks: u64,
    load_avg: f32,
}

impl Renderer {
    fn new(shared: Arc<Shared>, rate: u32) -> Renderer {
        Renderer { shared, reader: BusReader::default(), mix: vec![0.0; MAX_FRAMES * 2], rate, phase: 0.0, last_start: None, callbacks: 0, load_avg: 0.0 }
    }

    /// Render `frames` of interleaved stereo into `out`.
    fn render(&mut self, out: &mut [f32], frames: usize) {
        rt::enter_audio_thread();
        let t0 = Instant::now();
        let period = frames as f64 / self.rate as f64;
        if let Some(prev) = self.last_start {
            // A callback far later than the buffer it fills means the device ran dry.
            if self.callbacks > 16 && t0.duration_since(prev).as_secs_f64() > period * 2.5 + 0.004 {
                self.shared.stats.late.fetch_add(1, Ordering::Relaxed);
            }
        }
        self.last_start = Some(t0);
        self.callbacks += 1;
        self.shared.stats.period.store(frames as u32, Ordering::Relaxed);

        let mut done = 0;
        while done < frames {
            let n = (frames - done).min(MAX_FRAMES);
            self.render_block(&mut out[done * 2..(done + n) * 2], n);
            done += n;
        }

        let load = (t0.elapsed().as_secs_f64() / period) as f32;
        self.load_avg += (load - self.load_avg) * 0.05;
        let st = &self.shared.stats;
        st.load.store((self.load_avg * 1000.0) as u32, Ordering::Relaxed);
        if (load * 1000.0) as u32 > st.load_peak.load(Ordering::Relaxed) {
            st.load_peak.store((load * 1000.0) as u32, Ordering::Relaxed);
        }
    }

    fn render_block(&mut self, out: &mut [f32], frames: usize) {
        let start = self.shared.frame.load(Ordering::Relaxed);
        let ctx = RenderCtx { start, rate: self.rate as f32 };
        let mix = &mut self.mix[..frames * 2];
        mix.fill(0.0);

        if let Some(bus) = self.shared.bus.load().as_ref() {
            bus.read_add(&mut self.reader, mix, frames, self.rate as f32, start);
        }

        let tone = f32::from_bits(self.shared.tone_hz.load(Ordering::Relaxed));
        if tone > 0.0 {
            let step = tone as f64 / self.rate as f64 * std::f64::consts::TAU;
            for f in 0..frames {
                let s = (self.phase.sin() * 0.2) as f32;
                mix[f * 2] += s;
                mix[f * 2 + 1] += s;
                self.phase = (self.phase + step) % std::f64::consts::TAU;
            }
        }

        for s in self.shared.strips.load().iter() {
            s.render_add(mix, frames, &ctx);
        }
        host_callback::advance_transport(frames);
        self.shared.frame.store(start + frames as u64, Ordering::Relaxed);

        let g = f32::from_bits(self.shared.master.load(Ordering::Relaxed));
        for (o, m) in out.iter_mut().zip(mix.iter()) {
            *o = soft_clip(*m * g);
        }
        if let Some(cap) = self.shared.capture.load().as_ref() {
            match cap.pcm.try_lock() {
                Ok(mut pcm) if pcm.capacity() - pcm.len() >= out.len() => pcm.extend_from_slice(out),
                Ok(_) => {}
                Err(_) => {
                    cap.dropped.fetch_add(1, Ordering::Relaxed);
                }
            }
        }
        if self.shared.mute_output.load(Ordering::Relaxed) {
            out.fill(0.0);
        }
    }
}

/// Transparent below 0.9, then bends smoothly towards ±1 instead of
/// squaring off — a summed peak becomes mild saturation, not a crackle.
#[inline]
fn soft_clip(x: f32) -> f32 {
    const KNEE: f32 = 0.9;
    let a = x.abs();
    if a <= KNEE {
        x
    } else {
        let over = (a - KNEE) / (1.0 - KNEE);
        (KNEE + (1.0 - KNEE) * (over / (1.0 + over * over).sqrt())).copysign(x)
    }
}

fn open_stream(shared: Arc<Shared>, wanted: Option<&str>) -> Result<(cpal::Stream, u32, String), String> {
    let host = cpal::default_host();
    let named = wanted.and_then(|w| host.output_devices().ok()?.find(|d| device_name(d) == w));
    let device = named.or_else(|| host.default_output_device()).ok_or("no output device")?;
    let name = device_name(&device);
    let supported = device.default_output_config().map_err(|e| e.to_string())?;
    let rate = supported.sample_rate();
    let config = supported.config();
    let channels = config.channels.max(1) as usize;
    // Ask for a short ring buffer (the driver rounds up to what it can do):
    // the default one can add tens of milliseconds between a key press and
    // the sound. Fall back to the default if the device refuses.
    let low = cpal::StreamConfig { buffer_size: cpal::BufferSize::Fixed(LOW_LATENCY_FRAMES), ..config.clone() };
    match build(&device, low, shared.clone(), rate, channels) {
        Ok(stream) => {
            stream.play().map_err(|e| e.to_string())?;
            Ok((stream, rate, name))
        }
        Err(e) => {
            log::write(&format!("low-latency buffer refused ({e}); using the device default"));
            let stream = build(&device, cpal::StreamConfig { buffer_size: cpal::BufferSize::Default, ..config }, shared, rate, channels)?;
            stream.play().map_err(|e| e.to_string())?;
            Ok((stream, rate, name))
        }
    }
}

/// Requested ring-buffer size in frames (~5 ms at 48 kHz).
const LOW_LATENCY_FRAMES: u32 = 256;

fn build(device: &cpal::Device, config: cpal::StreamConfig, shared: Arc<Shared>, rate: u32, channels: usize) -> Result<cpal::Stream, String> {
    let failed = shared.clone();
    let mut r = Renderer::new(shared, rate);
    let mut stereo: Vec<f32> = vec![0.0; MAX_FRAMES * 2];
    let mut logged = 0u8;
    device
        .build_output_stream::<f32, _, _>(
            config,
            move |data: &mut [f32], _| {
                let frames = data.len() / channels;
                if logged < 2 {
                    logged += 1;
                    log::write(&format!("audio callback: {frames} frames ({:.1} ms)", frames as f64 * 1000.0 / rate as f64));
                }
                let mut done = 0;
                while done < frames {
                    let n = (frames - done).min(MAX_FRAMES);
                    let st = &mut stereo[..n * 2];
                    r.render(st, n);
                    for f in 0..n {
                        let frame = &mut data[(done + f) * channels..(done + f + 1) * channels];
                        match channels {
                            1 => frame[0] = (st[f * 2] + st[f * 2 + 1]) * 0.5,
                            _ => {
                                frame[0] = st[f * 2];
                                frame[1] = st[f * 2 + 1];
                                frame[2..].fill(0.0);
                            }
                        }
                    }
                    done += n;
                }
            },
            move |e| {
                log::write(&format!("audio stream error: {e}"));
                failed.failed.store(true, Ordering::SeqCst);
            },
            None,
        )
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn soft_clip_is_transparent_then_bounded() {
        assert_eq!(soft_clip(0.5), 0.5);
        assert_eq!(soft_clip(-0.9), -0.9);
        for x in [1.0f32, 2.0, 10.0, 1000.0] {
            let y = soft_clip(x);
            assert!(y > 0.9 && y <= 1.0, "{x} -> {y}");
            assert_eq!(soft_clip(-x), -y);
        }
        // Monotonic through the knee.
        let mut prev = 0.0;
        for i in 0..2000 {
            let y = soft_clip(i as f32 * 0.001);
            assert!(y >= prev);
            prev = y;
        }
    }

    struct Dc(f32);
    impl AudioSource for Dc {
        fn render_add(&self, out: &mut [f32], frames: usize, _: &RenderCtx) {
            for v in &mut out[..frames * 2] {
                *v += self.0;
            }
        }
    }

    #[test]
    fn strips_apply_gain_and_pan() {
        let s = Strip::new(Arc::new(Dc(0.5)));
        s.set_mix(0.5, -1.0);
        let ctx = RenderCtx { start: 0, rate: 48000.0 };
        let mut out = vec![0f32; 64 * 2];
        s.render_add(&mut out, 64, &ctx); // ramps from unity to the new gains
        s.take_peak();
        out.fill(0.0);
        s.render_add(&mut out, 64, &ctx);
        assert!((out[0] - 0.25).abs() < 1e-6 && out[1].abs() < 1e-6, "{:?}", &out[..2]);
        assert!((s.take_peak() - 0.25).abs() < 1e-6);
    }
}
