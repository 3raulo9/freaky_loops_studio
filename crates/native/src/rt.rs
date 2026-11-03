//! Audio-thread setup: the scheduler class and floating-point mode a
//! real-time callback needs. Each is applied once per thread.

use std::cell::Cell;

thread_local! {
    static READY: Cell<bool> = const { Cell::new(false) };
}

/// Call at the top of every audio callback; does its work on the first call
/// on a given thread.
pub fn enter_audio_thread() {
    READY.with(|r| {
        if !r.get() {
            r.set(true);
            pro_audio_priority();
        }
    });
    // Drivers may reset the control word between callbacks; it's one register write.
    denormals_off();
}

/// Flush denormals to zero: decaying reverb tails and filter states otherwise
/// fall into denormal range, where every operation costs ~100× and a quiet
/// mix suddenly overloads the CPU.
#[allow(deprecated)]
pub fn denormals_off() {
    #[cfg(target_arch = "x86_64")]
    unsafe {
        use std::arch::x86_64::{_mm_getcsr, _mm_setcsr};
        _mm_setcsr(_mm_getcsr() | 0x8040);
    }
    #[cfg(all(target_arch = "x86", target_feature = "sse"))]
    unsafe {
        use std::arch::x86::{_mm_getcsr, _mm_setcsr};
        _mm_setcsr(_mm_getcsr() | 0x8040);
    }
}

/// Register the thread with the multimedia scheduler ("Pro Audio"), which
/// keeps it ahead of ordinary work even when the machine is busy.
pub fn pro_audio_priority() {
    #[cfg(windows)]
    unsafe {
        use windows_sys::Win32::System::Threading::{AvSetMmThreadCharacteristicsW, AvSetMmThreadPriority, GetCurrentThread, SetThreadPriority, AVRT_PRIORITY_HIGH, THREAD_PRIORITY_TIME_CRITICAL};
        let name: Vec<u16> = "Pro Audio\0".encode_utf16().collect();
        let mut index = 0u32;
        let h = AvSetMmThreadCharacteristicsW(name.as_ptr(), &mut index);
        if h.is_null() {
            SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_TIME_CRITICAL);
        } else {
            AvSetMmThreadPriority(h, AVRT_PRIORITY_HIGH);
        }
    }
}
