//! The native audio engine: one output stream on the default device that mixes
//! every live source (loaded plugins, the test tone) into the master bus.

use crate::host_callback;
use crate::log;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

/// Anything that can add interleaved stereo audio into the master mix.
pub trait AudioSource: Send + Sync {
    fn render_add(&self, out: &mut [f32], frames: usize);
}

impl AudioSource for crate::plugin::Plugin {
    fn render_add(&self, out: &mut [f32], frames: usize) {
        crate::plugin::Plugin::render_add(self, out, frames)
    }
}

struct Shared {
    sources: Mutex<Vec<Arc<dyn AudioSource>>>,
    tone_hz: AtomicU32,
    master: AtomicU32,
}

pub struct Engine {
    _stream: Option<cpal::Stream>,
    shared: Arc<Shared>,
    sample_rate: u32,
    device: Option<String>,
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
            sources: Mutex::new(Vec::new()),
            tone_hz: AtomicU32::new(0),
            master: AtomicU32::new(1f32.to_bits()),
        });
        let mut e = Engine { _stream: None, shared, sample_rate: 44100, device: None };
        e.open(device);
        e
    }

    fn open(&mut self, device: Option<&str>) {
        self._stream = None; // release the old device first
        match open_stream(self.shared.clone(), device) {
            Ok((stream, rate, name)) => {
                host_callback::set_sample_rate(rate as f32);
                log::write(&format!("audio engine started on '{name}' @ {rate} Hz"));
                self._stream = Some(stream);
                self.sample_rate = rate;
                self.device = Some(name);
            }
            Err(e) => {
                log::write(&format!("audio engine failed to start: {e}"));
                host_callback::set_sample_rate(44100.0);
                self.sample_rate = 44100;
                self.device = None;
            }
        }
    }

    /// Move the engine (and every live source) to another output device.
    /// Returns the new sample rate.
    pub fn switch_device(&mut self, device: Option<&str>) -> u32 {
        self.open(device);
        self.sample_rate
    }

    pub fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    pub fn device_name(&self) -> Option<&str> {
        self.device.as_deref()
    }

    pub fn add_source(&self, src: Arc<dyn AudioSource>) {
        self.shared.sources.lock().unwrap().push(src);
    }

    pub fn remove_source(&self, src: &Arc<dyn AudioSource>) {
        self.shared.sources.lock().unwrap().retain(|s| !Arc::ptr_eq(s, src));
    }

    /// Start (Some(freq)) or stop (None) the diagnostic sine tone.
    pub fn set_tone(&self, freq: Option<f32>) {
        self.shared.tone_hz.store(freq.unwrap_or(0.0).to_bits(), Ordering::Relaxed);
    }

    pub fn set_master_gain(&self, gain: f32) {
        self.shared.master.store(gain.clamp(0.0, 2.0).to_bits(), Ordering::Relaxed);
    }
}

fn open_stream(shared: Arc<Shared>, wanted: Option<&str>) -> Result<(cpal::Stream, u32, String), String> {
    let host = cpal::default_host();
    let named = wanted.and_then(|w| host.output_devices().ok()?.find(|d| device_name(d) == w));
    let device = named.or_else(|| host.default_output_device()).ok_or("no output device")?;
    let name = device_name(&device);
    let supported = device.default_output_config().map_err(|e| e.to_string())?;
    let rate = supported.sample_rate();
    let mut config = supported.config();
    let channels = config.channels.max(1) as usize;
    config.buffer_size = cpal::BufferSize::Default;

    let mut mix: Vec<f32> = Vec::new();
    let mut phase = 0f64;
    let stream = device
        .build_output_stream::<f32, _, _>(
            config,
            move |data: &mut [f32], _| {
                let frames = data.len() / channels;
                if mix.len() < frames * 2 {
                    mix.resize(frames * 2, 0.0);
                }
                let mix = &mut mix[..frames * 2];
                mix.fill(0.0);

                let tone = f32::from_bits(shared.tone_hz.load(Ordering::Relaxed));
                if tone > 0.0 {
                    let step = tone as f64 / rate as f64 * std::f64::consts::TAU;
                    for f in 0..frames {
                        let s = (phase.sin() * 0.2) as f32;
                        mix[f * 2] += s;
                        mix[f * 2 + 1] += s;
                        phase = (phase + step) % std::f64::consts::TAU;
                    }
                }

                if let Ok(sources) = shared.sources.try_lock() {
                    for s in sources.iter() {
                        s.render_add(mix, frames);
                    }
                }
                host_callback::advance_transport(frames);

                let g = f32::from_bits(shared.master.load(Ordering::Relaxed));
                for f in 0..frames {
                    let (l, r) = ((mix[f * 2] * g).clamp(-1.0, 1.0), (mix[f * 2 + 1] * g).clamp(-1.0, 1.0));
                    let frame = &mut data[f * channels..(f + 1) * channels];
                    match channels {
                        1 => frame[0] = (l + r) * 0.5,
                        _ => {
                            frame[0] = l;
                            frame[1] = r;
                            frame[2..].fill(0.0);
                        }
                    }
                }
            },
            |e| log::write(&format!("audio stream error: {e}")),
            None,
        )
        .map_err(|e| e.to_string())?;
    stream.play().map_err(|e| e.to_string())?;
    Ok((stream, rate, name))
}
