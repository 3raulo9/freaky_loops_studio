//! Plugin editor windows (Win32). Each editor is a small tool window OWNED by
//! the app window: no taskbar entry, always above the app, with a native title
//! bar for dragging and closing. The webview composites above embedded child
//! HWNDs, so an owned top-level window is the reliable way to show a plugin GUI.
//!
//! The window never activates (WS_EX_NOACTIVATE + MA_NOACTIVATE): plugin knobs
//! take mouse input while keyboard focus stays in the DAW, so QWERTY note entry
//! and transport keys keep working while you tweak a sound.

use crate::plugin::Hosted;
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};

/// Plugin editor key → editor HWND, for resize requests from the plugin
/// (`audioMasterSizeWindow` in VST2, `IPlugFrame::resizeView` in VST3).
fn registry() -> &'static Mutex<HashMap<usize, isize>> {
    static R: OnceLock<Mutex<HashMap<usize, isize>>> = OnceLock::new();
    R.get_or_init(|| Mutex::new(HashMap::new()))
}

pub(crate) fn forget(key: usize) {
    if let Ok(mut r) = registry().lock() {
        r.remove(&key);
    }
}

#[cfg(windows)]
pub use win::EditorWindow;

pub(crate) fn resize_for_effect(effect: *mut crate::ffi::AEffect, width: i32, height: i32) -> bool {
    resize_for(effect as usize, width, height)
}

#[cfg(windows)]
pub(crate) fn resize_for(key: usize, width: i32, height: i32) -> bool {
    let hwnd = registry().lock().ok().and_then(|r| r.get(&key).copied());
    match hwnd {
        Some(h) if width > 0 && height > 0 => {
            win::resize_client(h as _, width, height);
            true
        }
        _ => false,
    }
}

#[cfg(not(windows))]
pub(crate) fn resize_for(_: usize, _: i32, _: i32) -> bool {
    false
}

#[cfg(windows)]
mod win {
    use super::*;
    use windows_sys::Win32::Foundation::*;
    use windows_sys::Win32::Graphics::Gdi::{GetStockObject, BLACK_BRUSH, HBRUSH};
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::UI::WindowsAndMessaging::*;

    const CLASS: &str = "FreakyLoopsPluginEditor";
    const IDLE_TIMER: usize = 1;
    const STYLE: u32 = WS_POPUP | WS_CAPTION | WS_SYSMENU | WS_CLIPCHILDREN;
    const EX_STYLE: u32 = WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE;

    struct Ctx {
        plugin: Arc<dyn Hosted>,
        on_close: Box<dyn Fn()>,
    }

    pub struct EditorWindow {
        hwnd: HWND,
        ctx: *mut Ctx,
        plugin: Arc<dyn Hosted>,
    }

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn ensure_class() {
        static ONCE: OnceLock<()> = OnceLock::new();
        ONCE.get_or_init(|| unsafe {
            let name = wide(CLASS);
            let wc = WNDCLASSW {
                style: CS_HREDRAW | CS_VREDRAW,
                lpfnWndProc: Some(wnd_proc),
                cbClsExtra: 0,
                cbWndExtra: 0,
                hInstance: GetModuleHandleW(std::ptr::null()),
                hIcon: std::ptr::null_mut(),
                hCursor: LoadCursorW(std::ptr::null_mut(), IDC_ARROW),
                hbrBackground: GetStockObject(BLACK_BRUSH) as HBRUSH,
                lpszMenuName: std::ptr::null(),
                lpszClassName: name.as_ptr(),
            };
            RegisterClassW(&wc);
            // The class name must stay alive for the life of the class.
            std::mem::forget(name);
        });
    }

    fn outer_size(w: i32, h: i32) -> (i32, i32) {
        let mut r = RECT { left: 0, top: 0, right: w, bottom: h };
        unsafe { AdjustWindowRectEx(&mut r, STYLE, 0, EX_STYLE) };
        (r.right - r.left, r.bottom - r.top)
    }

    pub(super) fn resize_client(hwnd: HWND, w: i32, h: i32) {
        let (ow, oh) = outer_size(w, h);
        unsafe { SetWindowPos(hwnd, std::ptr::null_mut(), 0, 0, ow, oh, SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE) };
    }

    unsafe extern "system" fn wnd_proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        let ctx = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as usize as *mut Ctx;
        match msg {
            WM_MOUSEACTIVATE => return MA_NOACTIVATE as LRESULT,
            WM_TIMER if wparam == IDLE_TIMER && !ctx.is_null() => {
                (*ctx).plugin.editor_idle();
                return 0;
            }
            WM_CLOSE => {
                // The owner tears the editor down (plugin first, then window).
                if !ctx.is_null() {
                    ((*ctx).on_close)();
                }
                return 0;
            }
            _ => {}
        }
        DefWindowProcW(hwnd, msg, wparam, lparam)
    }

    impl EditorWindow {
        /// Open `plugin`'s editor in a new window owned by `owner` (may belong
        /// to another process), placed at screen position (`x`, `y`).
        pub fn open(plugin: Arc<dyn Hosted>, owner: isize, x: i32, y: i32, on_close: Box<dyn Fn()>) -> Result<EditorWindow, String> {
            let name = plugin.info().name.clone();
            if !plugin.info().has_editor {
                return Err(format!("{name} has no custom UI."));
            }
            ensure_class();
            let (w, h) = plugin.editor_rect().unwrap_or((480, 320));
            let (ow, oh) = outer_size(w.max(120), h.max(60));
            let class = wide(CLASS);
            let title = wide(&name);
            let hwnd = unsafe {
                CreateWindowExW(
                    EX_STYLE,
                    class.as_ptr(),
                    title.as_ptr(),
                    STYLE,
                    x,
                    y,
                    ow,
                    oh,
                    owner as HWND,
                    std::ptr::null_mut(),
                    GetModuleHandleW(std::ptr::null()),
                    std::ptr::null(),
                )
            };
            if hwnd.is_null() {
                return Err("Could not create the editor window.".into());
            }
            let ctx = Box::into_raw(Box::new(Ctx { plugin: plugin.clone(), on_close }));
            unsafe {
                SetWindowLongPtrW(hwnd, GWLP_USERDATA, ctx as _);
                ShowWindow(hwnd, SW_SHOWNOACTIVATE);
            }
            if let Ok(mut r) = registry().lock() {
                r.insert(plugin.editor_key(), hwnd as isize);
            }
            if !plugin.editor_open(hwnd as isize) {
                super::forget(plugin.editor_key());
                unsafe {
                    SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0);
                    DestroyWindow(hwnd);
                    drop(Box::from_raw(ctx));
                }
                return Err(format!("{name} could not open its UI."));
            }
            // Many plugins only know their size once the editor is open.
            if let Some((w, h)) = plugin.editor_rect() {
                resize_client(hwnd, w, h);
            }
            unsafe { SetTimer(hwnd, IDLE_TIMER, 30, None) };
            crate::log::write(&format!("editor opened: {name} ({w}x{h})"));
            Ok(EditorWindow { hwnd, ctx, plugin })
        }

        pub fn hwnd(&self) -> isize {
            self.hwnd as isize
        }
    }

    impl Drop for EditorWindow {
        fn drop(&mut self) {
            unsafe {
                KillTimer(self.hwnd, IDLE_TIMER);
                self.plugin.editor_close();
                super::forget(self.plugin.editor_key());
                SetWindowLongPtrW(self.hwnd, GWLP_USERDATA, 0);
                DestroyWindow(self.hwnd);
                drop(Box::from_raw(self.ctx));
            }
        }
    }
}
