//! Rendering a 32-bit plugin for the 64-bit engine. The bridge process
//! (32-bit) owns the plugin; the app's audio thread asks it for each block
//! through a shared memory block and two events:
//!
//!   app:    write start frame, frame count, sequence → set "request"
//!   bridge: render that block into the shared buffer → set "done"
//!   app:    copy the block out (or, if the bridge is late, play silence)
//!
//! Layout is fixed byte offsets (the two sides differ in pointer width):
//!   0 magic u32 · 4 frames u32 · 8 rate u32 · 12 quit u32
//!   16 start u64 · 24 seq u64 · 32 done seq u64 · 64.. interleaved stereo f32

use std::sync::atomic::{AtomicU32, AtomicU64, Ordering::*};

pub const MAX_FRAMES: usize = 4096;
const MAGIC: u32 = u32::from_le_bytes(*b"FLSM");
const HEADER: usize = 64;
const SIZE: usize = HEADER + MAX_FRAMES * 2 * 4;

#[cfg(windows)]
mod sys {
    pub use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE, WAIT_OBJECT_0};
    pub use windows_sys::Win32::System::Memory::{CreateFileMappingW, MapViewOfFile, OpenFileMappingW, UnmapViewOfFile, FILE_MAP_ALL_ACCESS, MEMORY_MAPPED_VIEW_ADDRESS, PAGE_READWRITE};
    pub use windows_sys::Win32::System::Threading::{CreateEventW, OpenEventW, SetEvent, WaitForSingleObject, EVENT_ALL_ACCESS};
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain([0]).collect()
}

/// One side's view of the shared block.
pub struct Shm {
    #[cfg(windows)]
    map: sys::HANDLE,
    #[cfg(windows)]
    req: sys::HANDLE,
    #[cfg(windows)]
    done: sys::HANDLE,
    base: *mut u8,
}

unsafe impl Send for Shm {}
unsafe impl Sync for Shm {}

impl Shm {
    fn u32_at(&self, o: usize) -> &AtomicU32 {
        unsafe { &*(self.base.add(o) as *const AtomicU32) }
    }
    fn u64_at(&self, o: usize) -> &AtomicU64 {
        unsafe { &*(self.base.add(o) as *const AtomicU64) }
    }
    fn out_ptr(&self) -> *mut f32 {
        unsafe { self.base.add(HEADER) as *mut f32 }
    }

    /// App side: create the block and events under `name`.
    #[cfg(windows)]
    pub fn create(name: &str) -> Result<Shm, String> {
        use sys::*;
        unsafe {
            let n = wide(name);
            let map = CreateFileMappingW(INVALID_HANDLE_VALUE, std::ptr::null(), PAGE_READWRITE, 0, SIZE as u32, n.as_ptr());
            if map.is_null() {
                return Err("could not create shared memory".into());
            }
            let view = MapViewOfFile(map, FILE_MAP_ALL_ACCESS, 0, 0, SIZE);
            if view.Value.is_null() {
                CloseHandle(map);
                return Err("could not map shared memory".into());
            }
            let req = CreateEventW(std::ptr::null(), 0, 0, wide(&format!("{name}-req")).as_ptr());
            let done = CreateEventW(std::ptr::null(), 0, 0, wide(&format!("{name}-done")).as_ptr());
            let s = Shm { map, req, done, base: view.Value as *mut u8 };
            s.u32_at(0).store(MAGIC, SeqCst);
            Ok(s)
        }
    }

    /// Bridge side: open what the app created.
    #[cfg(windows)]
    pub fn open(name: &str) -> Result<Shm, String> {
        use sys::*;
        unsafe {
            let map = OpenFileMappingW(FILE_MAP_ALL_ACCESS, 0, wide(name).as_ptr());
            if map.is_null() {
                return Err("shared memory not found".into());
            }
            let view = MapViewOfFile(map, FILE_MAP_ALL_ACCESS, 0, 0, SIZE);
            if view.Value.is_null() {
                CloseHandle(map);
                return Err("could not map shared memory".into());
            }
            let req = OpenEventW(EVENT_ALL_ACCESS, 0, wide(&format!("{name}-req")).as_ptr());
            let done = OpenEventW(EVENT_ALL_ACCESS, 0, wide(&format!("{name}-done")).as_ptr());
            let s = Shm { map, req, done, base: view.Value as *mut u8 };
            if s.u32_at(0).load(SeqCst) != MAGIC || req.is_null() || done.is_null() {
                return Err("shared memory isn't the app's".into());
            }
            Ok(s)
        }
    }

    /// App side, audio thread: have the bridge render `frames` starting at
    /// engine frame `start` and add them into `out`. Waits at most
    /// `timeout_ms`; a late block is skipped (silence).
    #[cfg(windows)]
    pub fn render_add(&self, out: &mut [f32], frames: usize, start: u64, rate: u32, timeout_ms: u32) -> bool {
        use sys::*;
        let frames = frames.min(MAX_FRAMES);
        let seq = self.u64_at(24).load(Relaxed) + 1;
        self.u32_at(4).store(frames as u32, Relaxed);
        self.u32_at(8).store(rate, Relaxed);
        self.u64_at(16).store(start, Relaxed);
        self.u64_at(24).store(seq, Release);
        unsafe {
            SetEvent(self.req);
            if WaitForSingleObject(self.done, timeout_ms) != WAIT_OBJECT_0 || self.u64_at(32).load(Acquire) != seq {
                return false;
            }
            let src = std::slice::from_raw_parts(self.out_ptr(), frames * 2);
            for (o, s) in out.iter_mut().zip(src) {
                *o += *s;
            }
        }
        true
    }

    /// Bridge side: wait for the next request (`None` on timeout or quit).
    /// Returns (sequence, start frame, frames, rate).
    #[cfg(windows)]
    pub fn wait_request(&self, timeout_ms: u32) -> Option<(u64, u64, usize, u32)> {
        use sys::*;
        if unsafe { WaitForSingleObject(self.req, timeout_ms) } != WAIT_OBJECT_0 || self.u32_at(12).load(Acquire) != 0 {
            return None;
        }
        let seq = self.u64_at(24).load(Acquire);
        Some((seq, self.u64_at(16).load(Relaxed), (self.u32_at(4).load(Relaxed) as usize).min(MAX_FRAMES), self.u32_at(8).load(Relaxed)))
    }

    /// Bridge side: the shared output buffer for `frames`.
    pub fn out(&self, frames: usize) -> &mut [f32] {
        unsafe { std::slice::from_raw_parts_mut(self.out_ptr(), frames.min(MAX_FRAMES) * 2) }
    }

    /// Bridge side: block `seq` is ready.
    #[cfg(windows)]
    pub fn finish(&self, seq: u64) {
        self.u64_at(32).store(seq, Release);
        unsafe { sys::SetEvent(self.done) };
    }

    /// Bridge side: has the app asked the render loop to stop?
    pub fn quitting(&self) -> bool {
        self.u32_at(12).load(Acquire) != 0
    }

    /// App side: tell the bridge's render loop to stop.
    #[cfg(windows)]
    pub fn quit(&self) {
        self.u32_at(12).store(1, SeqCst);
        unsafe { sys::SetEvent(self.req) };
    }
}

#[cfg(windows)]
impl Drop for Shm {
    fn drop(&mut self) {
        use sys::*;
        unsafe {
            UnmapViewOfFile(MEMORY_MAPPED_VIEW_ADDRESS { Value: self.base as *mut _ });
            CloseHandle(self.req);
            CloseHandle(self.done);
            CloseHandle(self.map);
        }
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn a_block_goes_round_trip() {
        let name = format!("Local\\fls-shm-test-{}", std::process::id());
        let app = Shm::create(&name).unwrap();
        let bridge = Shm::open(&name).unwrap();
        let t = std::thread::spawn(move || {
            for _ in 0..3 {
                let (seq, start, frames, rate) = bridge.wait_request(2000).unwrap();
                assert_eq!(rate, 48000);
                for (i, v) in bridge.out(frames).iter_mut().enumerate() {
                    *v = (start + i as u64) as f32;
                }
                bridge.finish(seq);
            }
        });
        for k in 0..3u64 {
            let mut out = vec![0f32; 256];
            assert!(app.render_add(&mut out, 128, 1000 * k, 48000, 2000));
            assert_eq!(out[0], (1000 * k) as f32);
            assert_eq!(out[255], (1000 * k + 255) as f32);
        }
        t.join().unwrap();
    }
}
