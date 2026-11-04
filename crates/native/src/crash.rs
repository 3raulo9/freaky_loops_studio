//! When the process goes down, say where: a plugin that crashes takes the app
//! with it, and without this the log just stops. The handler writes the
//! faulting module (usually a plugin DLL), the offset and the thread to the
//! log before Windows ends the process.

#[cfg(windows)]
pub fn install() {
    use windows_sys::Win32::System::Diagnostics::Debug::SetUnhandledExceptionFilter;
    unsafe {
        SetUnhandledExceptionFilter(Some(on_crash));
    }
}

#[cfg(not(windows))]
pub fn install() {}

/// Load the system's C/C++ runtime before any plugin does. Plugins share one
/// copy per process (Windows reuses a loaded DLL by name), and some ship an
/// old private copy beside themselves (a portable sampler's engine folder):
/// whichever plugin loads first would otherwise decide the runtime for all,
/// and a newer plugin then crashes inside the old one.
#[cfg(windows)]
pub fn preload_system_runtimes() {
    use windows_sys::Win32::System::LibraryLoader::{LoadLibraryExW, LOAD_LIBRARY_SEARCH_SYSTEM32};
    for name in ["vcruntime140.dll", "vcruntime140_1.dll", "msvcp140.dll", "msvcp140_1.dll", "msvcp140_2.dll", "msvcp140_atomic_wait.dll", "concrt140.dll", "vcomp140.dll"] {
        let w: Vec<u16> = name.encode_utf16().chain([0]).collect();
        let h = unsafe { LoadLibraryExW(w.as_ptr(), std::ptr::null_mut(), LOAD_LIBRARY_SEARCH_SYSTEM32) };
        if h.is_null() {
            crate::log::write(&format!("runtime {name}: not in the system folder"));
        }
    }
}

#[cfg(not(windows))]
pub fn preload_system_runtimes() {}

/// The module containing `addr`, and the offset into it.
#[cfg(windows)]
pub fn module_of(addr: usize) -> Option<(String, usize)> {
    use windows_sys::Win32::Foundation::HMODULE;
    use windows_sys::Win32::System::LibraryLoader::{GetModuleFileNameW, GetModuleHandleExW, GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS, GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT};
    unsafe {
        let mut m: HMODULE = std::ptr::null_mut();
        if GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT, addr as *const u16, &mut m) == 0 {
            return None;
        }
        let mut buf = [0u16; 520];
        let n = GetModuleFileNameW(m, buf.as_mut_ptr(), buf.len() as u32) as usize;
        Some((String::from_utf16_lossy(&buf[..n]), addr - m as usize))
    }
}

#[cfg(windows)]
unsafe extern "system" fn on_crash(info: *const windows_sys::Win32::System::Diagnostics::Debug::EXCEPTION_POINTERS) -> i32 {
    let rec = &*(*info).ExceptionRecord;
    let addr = rec.ExceptionAddress as usize;
    let thread = std::thread::current().name().map(str::to_string).unwrap_or_else(|| format!("{:?}", std::thread::current().id()));
    let place = match module_of(addr) {
        Some((m, off)) => format!("{m} +0x{off:x}"),
        None => format!("0x{addr:x}"),
    };
    crate::log::write(&format!("CRASH: exception 0x{:08x} in {place} (thread {thread})", rec.ExceptionCode as u32));
    0 // EXCEPTION_CONTINUE_SEARCH: let Windows end the process as usual
}
