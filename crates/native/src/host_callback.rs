//! The `audioMaster` callback every VST2 plugin calls back into: version and
//! capability queries, sample rate / block size, transport time info, and
//! editor resize requests.

use crate::ffi::*;
use std::cell::{Cell, UnsafeCell};
use std::os::raw::c_void;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};

static SAMPLE_RATE: AtomicU32 = AtomicU32::new(0x472c_4400); // 44100.0f32
static TEMPO: AtomicU64 = AtomicU64::new(0x405e_0000_0000_0000); // 120.0f64
static PLAYING: AtomicBool = AtomicBool::new(false);
static SAMPLE_POS: AtomicU64 = AtomicU64::new(0);
static TIME_SIG: AtomicU32 = AtomicU32::new((4 << 16) | 4);

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum ProcessLevel {
    User = 1,
    Realtime = 2,
    Offline = 4,
}

thread_local! {
    static LEVEL: Cell<ProcessLevel> = const { Cell::new(ProcessLevel::User) };
    static RATE_OVERRIDE: Cell<Option<f32>> = const { Cell::new(None) };
    // getTime returns a pointer that must outlive the call; one per thread keeps
    // the audio and render threads from sharing (and racing on) the struct.
    static TIME_INFO: UnsafeCell<VstTimeInfo> = UnsafeCell::new(VstTimeInfo::default());
}

pub fn set_sample_rate(rate: f32) {
    SAMPLE_RATE.store(rate.to_bits(), Ordering::Relaxed);
}

pub fn sample_rate() -> f32 {
    RATE_OVERRIDE.with(|r| r.get()).unwrap_or_else(|| f32::from_bits(SAMPLE_RATE.load(Ordering::Relaxed)))
}

/// Tempo / play state / meter the UI's transport reports, exposed to plugins
/// through `getTime` so tempo-synced LFOs and delays follow the song.
pub fn set_transport(tempo: f64, playing: bool, numerator: u16, denominator: u16) {
    TEMPO.store(tempo.clamp(10.0, 999.0).to_bits(), Ordering::Relaxed);
    if playing && !PLAYING.load(Ordering::Relaxed) {
        SAMPLE_POS.store(0, Ordering::Relaxed);
    }
    PLAYING.store(playing, Ordering::Relaxed);
    TIME_SIG.store(((numerator.max(1) as u32) << 16) | denominator.max(1) as u32, Ordering::Relaxed);
}

/// Current transport: (tempo, playing, sample position, numerator, denominator).
pub fn transport() -> (f64, bool, u64, i32, i32) {
    let sig = TIME_SIG.load(Ordering::Relaxed);
    (
        f64::from_bits(TEMPO.load(Ordering::Relaxed)),
        PLAYING.load(Ordering::Relaxed),
        SAMPLE_POS.load(Ordering::Relaxed),
        (sig >> 16) as i32,
        (sig & 0xffff) as i32,
    )
}

/// Advance the transport clock by one audio callback's worth of frames.
pub fn advance_transport(frames: usize) {
    if PLAYING.load(Ordering::Relaxed) {
        SAMPLE_POS.fetch_add(frames as u64, Ordering::Relaxed);
    }
}

pub fn set_thread_process_level(level: ProcessLevel) {
    LEVEL.with(|l| l.set(level));
}

pub fn set_thread_sample_rate(rate: Option<f32>) {
    RATE_OVERRIDE.with(|r| r.set(rate));
}

fn copy_cstr(ptr: *mut c_void, s: &str, cap: usize) {
    if ptr.is_null() {
        return;
    }
    let bytes = s.as_bytes();
    let n = bytes.len().min(cap - 1);
    unsafe {
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), ptr as *mut u8, n);
        *(ptr as *mut u8).add(n) = 0;
    }
}

fn time_info() -> *mut VstTimeInfo {
    let rate = sample_rate() as f64;
    let tempo = f64::from_bits(TEMPO.load(Ordering::Relaxed));
    let playing = PLAYING.load(Ordering::Relaxed);
    let pos = SAMPLE_POS.load(Ordering::Relaxed) as f64;
    let sig = TIME_SIG.load(Ordering::Relaxed);
    let (num, den) = ((sig >> 16) as i32, (sig & 0xffff) as i32);
    let ppq = pos / rate * tempo / 60.0;
    let quarters_per_bar = num as f64 * 4.0 / den as f64;
    TIME_INFO.with(|t| {
        let p = t.get();
        unsafe {
            *p = VstTimeInfo {
                sample_pos: pos,
                sample_rate: rate,
                ppq_pos: ppq,
                tempo,
                bar_start_pos: (ppq / quarters_per_bar).floor() * quarters_per_bar,
                time_sig_numerator: num,
                time_sig_denominator: den,
                flags: TT_TEMPO_VALID | TT_PPQ_POS_VALID | TT_BARS_VALID | TT_TIME_SIG_VALID | if playing { TT_PLAYING } else { 0 },
                ..VstTimeInfo::default()
            };
        }
        p
    })
}

pub unsafe extern "C" fn host_callback(effect: *mut AEffect, opcode: i32, _index: i32, value: isize, ptr: *mut c_void, _opt: f32) -> isize {
    match opcode {
        AM_VERSION => 2400,
        AM_CURRENT_ID => 0,
        AM_IDLE => 0,
        AM_GET_TIME => time_info() as isize,
        AM_PROCESS_EVENTS => 0,
        AM_IO_CHANGED => 0,
        AM_SIZE_WINDOW => crate::editor::resize_for_effect(effect, _index, value as i32) as isize,
        AM_GET_SAMPLE_RATE => sample_rate() as isize,
        AM_GET_BLOCK_SIZE => crate::plugin::BLOCK_SIZE as isize,
        AM_GET_INPUT_LATENCY | AM_GET_OUTPUT_LATENCY => 0,
        AM_GET_CURRENT_PROCESS_LEVEL => LEVEL.with(|l| l.get()) as isize,
        AM_GET_AUTOMATION_STATE => 1, // off
        AM_GET_VENDOR_STRING => {
            copy_cstr(ptr, "Freaky Loops", 64);
            1
        }
        AM_GET_PRODUCT_STRING => {
            copy_cstr(ptr, "Freaky Loops Studio", 64);
            1
        }
        AM_GET_VENDOR_VERSION => 300,
        AM_CAN_DO => {
            if ptr.is_null() {
                return 0;
            }
            let s = unsafe { std::ffi::CStr::from_ptr(ptr as *const std::os::raw::c_char) }.to_string_lossy();
            match s.as_ref() {
                "sendVstEvents" | "sendVstMidiEvent" | "sendVstTimeInfo" | "receiveVstEvents" | "receiveVstMidiEvent"
                | "sizeWindow" | "supplyIdle" => 1,
                _ => 0,
            }
        }
        AM_GET_LANGUAGE => 1, // English
        AM_UPDATE_DISPLAY => 1,
        AM_AUTOMATE | AM_BEGIN_EDIT | AM_END_EDIT => 0,
        _ => 0,
    }
}
