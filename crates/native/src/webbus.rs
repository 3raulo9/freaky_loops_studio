//! The UI's own audio — built-in instruments, the sampler, its effects and
//! mixer — streams in from the webview over a local WebSocket and is mixed
//! into the native output, so everything plays through one device, one
//! driver and one clock.
//!
//! Wire format (little endian), one binary message per chunk:
//!   u32 magic "FLSB", u32 kind (1 = audio), u32 sample rate, u32 frames,
//!   u64 first frame (the audio context's frame counter), u32 flags
//!   (1 = silent: no samples follow), u32 reserved, then frames × 2 f32.
//!
//! The context's clock isn't the engine's, so the reader resamples by a ratio
//! steered to hold the buffer at its target fill (a few hundred ppm at most —
//! inaudible). The target follows how unevenly chunks actually arrive (the
//! worst gap of recent seconds, ignoring a one-off), plus an extra margin
//! that grows after an underrun and creeps back down while steady.

use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering::*};
use std::sync::{Arc, Mutex};

const MAGIC: u32 = u32::from_le_bytes(*b"FLSB");
const HEADER: usize = 32;
const KIND_AUDIO: u32 = 1;
const FLAG_SILENT: u32 = 1;
/// Frames the ring holds (~1.4 s at 48 kHz).
const CAP: usize = 1 << 16;
/// Jitter allowance bounds, in seconds.
const MIN_JITTER: f64 = 0.004;
const MAX_JITTER: f64 = 0.080;
/// Margin over the measured arrival jitter.
const JITTER_MARGIN: f64 = 0.003;
/// Until a few seconds of arrivals are measured.
const START_JITTER: f64 = 0.015;
/// One-second windows of arrival gaps remembered.
const GAP_WINDOWS: usize = 8;

pub struct WebBus {
    pub port: u16,
    pub token: String,
    ring: Box<[AtomicU32]>,
    /// Web frame after the last one written.
    write: AtomicU64,
    /// First frame of the current stream.
    origin: AtomicU64,
    /// Bumped whenever the stream restarts, so the reader re-primes.
    epoch: AtomicU32,
    reset_pending: AtomicBool,
    rate: AtomicU32,
    connected: AtomicBool,
    conn: AtomicU64,
    map: Mutex<Map>,
    pub underruns: AtomicU32,
    /// Current buffering, in frames of the context's rate.
    pub target_frames: AtomicU32,
    /// Longest wait between two chunks since the last read, in µs — a stall
    /// upstream (the UI's audio thread or its worker) shows up here.
    max_gap_us: AtomicU32,
    /// Arrival jitter to plan for, in µs (0 = not measured yet).
    jitter_us: AtomicU32,
}

/// Where the reader is: web frame `web` is heard at engine frame `engine`.
#[derive(Default, Clone, Copy)]
struct Map {
    engine: u64,
    web: f64,
    ratio: f64,
    valid: bool,
}

/// The reader's state, owned by the audio callback.
pub struct BusReader {
    epoch: u32,
    primed: bool,
    pos: f64,
    fill_avg: f64,
    /// Extra allowance on top of the measured jitter, grown by underruns.
    extra: f64,
    calm_frames: usize,
    /// Engine frame of the last underrun (a burst of them is one stall).
    last_underrun: Option<u64>,
}

impl Default for BusReader {
    fn default() -> Self {
        BusReader { epoch: u32::MAX, primed: false, pos: 0.0, fill_avg: 0.0, extra: 0.0, calm_frames: 0, last_underrun: None }
    }
}

fn random_token() -> String {
    use std::hash::{BuildHasher, Hasher};
    let mut h = std::collections::hash_map::RandomState::new().build_hasher();
    h.write_u128(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0));
    format!("{:016x}", h.finish())
}

impl WebBus {
    /// Listen on a free localhost port. Only a client that knows the token
    /// (handed to the UI at startup) can connect.
    pub fn start() -> std::io::Result<Arc<WebBus>> {
        let listener = TcpListener::bind("127.0.0.1:0")?;
        let bus = Arc::new(WebBus {
            port: listener.local_addr()?.port(),
            token: random_token(),
            ring: (0..CAP * 2).map(|_| AtomicU32::new(0)).collect(),
            write: AtomicU64::new(0),
            origin: AtomicU64::new(0),
            epoch: AtomicU32::new(0),
            reset_pending: AtomicBool::new(true),
            rate: AtomicU32::new(0),
            connected: AtomicBool::new(false),
            conn: AtomicU64::new(0),
            map: Mutex::new(Map::default()),
            underruns: AtomicU32::new(0),
            target_frames: AtomicU32::new(0),
            max_gap_us: AtomicU32::new(0),
            jitter_us: AtomicU32::new(0),
        });
        let b = bus.clone();
        std::thread::Builder::new()
            .name("web-bus".into())
            .spawn(move || {
                for stream in listener.incoming().flatten() {
                    let b = b.clone();
                    let _ = std::thread::Builder::new().name("web-bus-conn".into()).spawn(move || b.serve(stream));
                }
            })
            .ok();
        Ok(bus)
    }

    pub fn is_connected(&self) -> bool {
        self.connected.load(Relaxed)
    }

    fn serve(&self, stream: TcpStream) {
        let _ = stream.set_nodelay(true);
        let path = format!("/{}", self.token);
        let check = |req: &tungstenite::handshake::server::Request, resp| {
            if req.uri().path() == path {
                Ok(resp)
            } else {
                Err(tungstenite::http::Response::builder().status(403).body(None).unwrap())
            }
        };
        let Ok(mut ws) = tungstenite::accept_hdr(stream, check) else { return };
        // This thread feeds the audio callback: keep it ahead of ordinary work.
        crate::rt::pro_audio_priority();
        let mut last = std::time::Instant::now();
        let mut window_start = last;
        let mut window_max = 0u32;
        let mut windows: Vec<u32> = Vec::with_capacity(GAP_WINDOWS);
        self.jitter_us.store(0, SeqCst);
        // The newest connection wins (a reloaded UI reconnects before the old socket times out).
        let me = self.conn.fetch_add(1, SeqCst) + 1;
        self.reset_pending.store(true, SeqCst);
        self.connected.store(true, SeqCst);
        crate::log::write("web bus: UI audio connected");
        while self.conn.load(SeqCst) == me {
            match ws.read() {
                Ok(tungstenite::Message::Binary(b)) => {
                    let gap = last.elapsed().as_micros().min(u32::MAX as u128) as u32;
                    last = std::time::Instant::now();
                    self.max_gap_us.fetch_max(gap, Relaxed);
                    window_max = window_max.max(gap);
                    if last.duration_since(window_start).as_secs_f64() >= 1.0 {
                        // Plan for the second-worst second of the last few: one
                        // hiccup (a page load) shouldn't keep latency up.
                        if windows.len() == GAP_WINDOWS {
                            windows.remove(0);
                        }
                        windows.push(window_max);
                        window_max = 0;
                        window_start = last;
                        if windows.len() >= 3 {
                            let mut w = windows.clone();
                            w.sort_unstable();
                            self.jitter_us.store(w[w.len() - 2], Relaxed);
                        }
                    }
                    self.on_message(&b)
                }
                Ok(tungstenite::Message::Close(_)) | Err(_) => break,
                _ => {}
            }
        }
        if self.conn.load(SeqCst) == me {
            self.connected.store(false, SeqCst);
            crate::log::write("web bus: UI audio disconnected");
        }
    }

    fn on_message(&self, b: &[u8]) {
        let u32_at = |o: usize| u32::from_le_bytes(b[o..o + 4].try_into().unwrap());
        if b.len() < HEADER || u32_at(0) != MAGIC || u32_at(4) != KIND_AUDIO {
            return;
        }
        let rate = u32_at(8);
        let frames = u32_at(12) as usize;
        let start = u64::from_le_bytes(b[16..24].try_into().unwrap());
        let silent = u32_at(24) & FLAG_SILENT != 0;
        if frames == 0 || frames > CAP / 4 || (!silent && b.len() < HEADER + frames * 8) {
            return;
        }
        self.write_frames(rate, start, frames, if silent { None } else { Some(&b[HEADER..HEADER + frames * 8]) });
    }

    fn write_frames(&self, rate: u32, start: u64, frames: usize, data: Option<&[u8]>) {
        self.rate.store(rate, Relaxed);
        let mut w = self.write.load(Relaxed);
        let gap_ok = start > w && start - w < (CAP / 4) as u64;
        if self.reset_pending.swap(false, SeqCst) || (start != w && !gap_ok) {
            // A new stream (or the context restarted / jumped): start over here.
            self.origin.store(start, SeqCst);
            w = start;
            self.write.store(w, SeqCst);
            self.epoch.fetch_add(1, SeqCst);
        }
        // A small gap (a dropped message): keep time with silence.
        while w < start {
            let i = (w as usize % CAP) * 2;
            self.ring[i].store(0, Relaxed);
            self.ring[i + 1].store(0, Relaxed);
            w += 1;
        }
        for f in 0..frames {
            let i = ((start as usize + f) % CAP) * 2;
            let (l, r) = match data {
                Some(d) => (u32::from_le_bytes(d[f * 8..f * 8 + 4].try_into().unwrap()), u32::from_le_bytes(d[f * 8 + 4..f * 8 + 8].try_into().unwrap())),
                None => (0, 0),
            };
            self.ring[i].store(l, Relaxed);
            self.ring[i + 1].store(r, Relaxed);
        }
        self.write.store(start + frames as u64, Release);
    }

    #[inline]
    fn sample(&self, frame: u64, ch: usize) -> f32 {
        f32::from_bits(self.ring[(frame as usize % CAP) * 2 + ch].load(Relaxed))
    }

    /// Add the next `frames` (at the engine's rate) into `out`. Runs on the
    /// audio thread: no locks held, no allocation.
    pub fn read_add(&self, r: &mut BusReader, out: &mut [f32], frames: usize, engine_rate: f32, engine_start: u64) {
        let web_rate = self.rate.load(Relaxed) as f64;
        if !self.connected.load(Relaxed) || web_rate <= 0.0 || frames == 0 {
            r.primed = false;
            return;
        }
        let nominal = web_rate / engine_rate as f64;
        let w = self.write.load(Acquire) as f64;
        let epoch = self.epoch.load(Acquire);
        if epoch != r.epoch {
            r.epoch = epoch;
            r.primed = false;
        }
        // What one callback consumes (with interpolation taps), plus the jitter allowance.
        let need = frames as f64 * nominal * 1.005 + 3.0;
        let measured = self.jitter_us.load(Relaxed);
        let jitter = if measured == 0 { START_JITTER } else { measured as f64 / 1e6 + JITTER_MARGIN };
        let target = need + (jitter + r.extra).clamp(MIN_JITTER, MAX_JITTER) * web_rate;
        self.target_frames.store(target as u32, Relaxed);
        if !r.primed {
            if w - (self.origin.load(Acquire) as f64) < target {
                return; // still filling
            }
            r.pos = w - target;
            r.fill_avg = target;
            r.primed = true;
        }
        let mut fill = w - r.pos;
        if fill > target + 0.1 * web_rate || fill > CAP as f64 * 0.5 {
            // Fell far behind (the engine stalled): skip ahead rather than lag.
            r.pos = w - target;
            r.fill_avg = target;
            fill = target;
        }
        if fill < need {
            self.underruns.fetch_add(1, Relaxed);
            r.primed = false;
            // One stall (e.g. while a project loads) shows up as several underruns
            // in a row: widen the allowance once per stall, not once per callback.
            if r.last_underrun.map_or(true, |t| engine_start.saturating_sub(t) > 2 * engine_rate as u64) {
                r.extra = (r.extra + 0.003).min(MAX_JITTER);
            }
            r.last_underrun = Some(engine_start);
            r.calm_frames = 0;
            return;
        }
        // Steer: a buffer 1 ms over target plays ~250 ppm faster until it's back.
        let alpha = (frames as f64 / engine_rate as f64 / 0.5).min(1.0);
        r.fill_avg += (fill - r.fill_avg) * alpha;
        let corr = ((r.fill_avg - target) / web_rate * 0.25).clamp(-0.004, 0.004);
        let ratio = nominal * (1.0 + corr);
        if let Ok(mut m) = self.map.try_lock() {
            *m = Map { engine: engine_start, web: r.pos, ratio, valid: true };
        }
        let mut p = r.pos;
        for i in 0..frames {
            let ip = p.floor();
            let t = (p - ip) as f32;
            let i0 = ip as u64;
            for c in 0..2 {
                let (y0, y1, y2, y3) = (self.sample(i0.wrapping_sub(1), c), self.sample(i0, c), self.sample(i0 + 1, c), self.sample(i0 + 2, c));
                out[i * 2 + c] += hermite(y0, y1, y2, y3, t);
            }
            p += ratio;
        }
        r.pos = p;
        r.calm_frames += frames;
        if r.calm_frames > engine_rate as usize * 15 {
            r.calm_frames = 0;
            r.extra = (r.extra - 0.001).max(0.0);
        }
    }

    /// The engine frame at which the UI's frame `web` is heard (`None` until
    /// the stream is running).
    pub fn engine_frame_for(&self, web: f64) -> Option<u64> {
        if !self.is_connected() {
            return None;
        }
        let m = *self.map.lock().ok()?;
        m.valid.then(|| (m.engine as f64 + (web - m.web) / m.ratio).max(0.0) as u64)
    }

    /// Longest gap between chunks since the last call, in seconds.
    pub fn take_max_gap(&self) -> f64 {
        self.max_gap_us.swap(0, Relaxed) as f64 / 1e6
    }

    /// Buffering between the UI's render and the engine, in seconds.
    pub fn latency(&self) -> f64 {
        let rate = self.rate.load(Relaxed);
        if rate == 0 {
            0.0
        } else {
            self.target_frames.load(Relaxed) as f64 / rate as f64
        }
    }
}

/// 4-point, 3rd-order Hermite interpolation between y1 and y2.
#[inline]
fn hermite(y0: f32, y1: f32, y2: f32, y3: f32, t: f32) -> f32 {
    let c1 = 0.5 * (y2 - y0);
    let c2 = y0 - 2.5 * y1 + 2.0 * y2 - 0.5 * y3;
    let c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
    ((c3 * t + c2) * t + c1) * t + y1
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn chunk(start: u64, frames: usize, f: impl Fn(u64) -> f32) -> Vec<u8> {
        let mut b = Vec::new();
        for v in [MAGIC, KIND_AUDIO, 48000, frames as u32] {
            b.extend_from_slice(&v.to_le_bytes());
        }
        b.extend_from_slice(&start.to_le_bytes());
        b.extend_from_slice(&[0; 8]);
        for i in 0..frames as u64 {
            let v = f(start + i);
            b.extend_from_slice(&v.to_le_bytes());
            b.extend_from_slice(&(-v).to_le_bytes());
        }
        b
    }

    #[test]
    fn hermite_passes_through_samples() {
        assert_eq!(hermite(0.0, 1.0, 2.0, 3.0, 0.0), 1.0);
        assert!((hermite(0.0, 1.0, 2.0, 3.0, 0.5) - 1.5).abs() < 1e-6);
    }

    /// Steady stream in, steady stream out: after priming, a sine survives the
    /// trip (no gaps, no underruns), and the frame mapping is consistent.
    #[test]
    fn streams_through_the_ring() {
        let bus = WebBus::start().unwrap();
        bus.connected.store(true, SeqCst);
        let sine = |f: u64| (f as f32 * 0.01).sin() * 0.5;
        let mut r = BusReader::default();
        let mut out = vec![0f32; 256 * 2];
        let mut web = 1_000_000u64;
        let mut engine = 0u64;
        let mut heard = Vec::new();
        for _ in 0..400 {
            bus.on_message(&chunk(web, 128, sine));
            web += 128;
            out.fill(0.0);
            bus.read_add(&mut r, &mut out, 128, 48000.0, engine);
            engine += 128;
            heard.extend(out[..256].chunks(2).map(|c| c[0]));
        }
        assert_eq!(bus.underruns.load(SeqCst), 0);
        let first = heard.iter().position(|v| *v != 0.0).expect("audio comes out");
        let tail = &heard[first + 100..];
        // Consecutive samples of a slow sine: never a jump.
        assert!(tail.windows(2).all(|w| (w[0] - w[1]).abs() < 0.02), "glitch in output");
        assert!(bus.engine_frame_for(web as f64).is_some());
    }

    #[test]
    fn only_the_token_holder_connects() {
        let bus = WebBus::start().unwrap();
        let mut s = TcpStream::connect(("127.0.0.1", bus.port)).unwrap();
        s.write_all(b"GET /wrong HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n").unwrap();
        let mut buf = [0u8; 64];
        let n = std::io::Read::read(&mut s, &mut buf).unwrap_or(0);
        assert!(String::from_utf8_lossy(&buf[..n]).contains("403"));
        assert!(!bus.is_connected());
    }
}
