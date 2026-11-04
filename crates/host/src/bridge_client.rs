//! App side of the bit-bridge: spawns the 32-bit helper for one plugin, sends
//! it control lines over stdin and forwards its stdout lines to the event loop.

use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;

/// A 32-bit plugin as an engine source: each block is rendered by the bridge
/// through shared memory (fls_native::shm). A block the bridge can't deliver
/// in time plays as silence rather than holding up the whole mix.
pub struct BridgeSource {
    shm: fls_native::shm::Shm,
    /// Blocks missed in a row: a bridge that stopped answering gets only a
    /// short wait, so it can't stall the mix while it's gone.
    misses: std::sync::atomic::AtomicU32,
}

impl BridgeSource {
    pub fn new(shm: fls_native::shm::Shm) -> BridgeSource {
        BridgeSource { shm, misses: std::sync::atomic::AtomicU32::new(0) }
    }
}

impl fls_native::AudioSource for BridgeSource {
    fn render_add(&self, out: &mut [f32], frames: usize, ctx: &fls_native::RenderCtx) {
        use std::sync::atomic::Ordering::Relaxed;
        // Most of the block's own duration (at least 2 ms) — 1 ms once it has
        // missed several blocks in a row.
        let budget = if self.misses.load(Relaxed) > 8 { 1 } else { ((frames as f32 / ctx.rate.max(1.0)) * 800.0).ceil().max(2.0) as u32 };
        if self.shm.render_add(out, frames, ctx.start, ctx.rate as u32, budget) {
            self.misses.store(0, Relaxed);
        } else {
            self.misses.fetch_add(1, Relaxed);
        }
    }
}

impl Drop for BridgeSource {
    fn drop(&mut self) {
        self.shm.quit();
    }
}

pub struct BridgeClient {
    child: Mutex<Child>,
    stdin: Mutex<ChildStdin>,
}

pub fn locate_exe() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    let profile = dir.file_name()?.to_string_lossy().into_owned();
    let candidates = [
        dir.join("bridge").join("FreakyLoopsVstBridge.exe"),
        dir.join("FreakyLoopsVstBridge.exe"),
        // Running straight from the cargo target tree.
        dir.join("..").join("i686-pc-windows-msvc").join(&profile).join("FreakyLoopsVstBridge.exe"),
    ];
    // Must be the 32-bit build: a workspace build also leaves a 64-bit copy next to the app.
    candidates.into_iter().find(|p| p.exists() && fls_native::pe::detect(&p.to_string_lossy()) == fls_native::pe::Arch::X86)
}

impl BridgeClient {
    /// Spawn the helper for `plugin_path`. `on_line` receives each stdout line
    /// (on a reader thread) and `None` once the process has exited.
    /// `shared`: the shared-memory name and engine rate when the app renders
    /// the plugin itself (see `BridgeSource`).
    pub fn spawn(plugin_path: &str, owner_hwnd: isize, device: Option<String>, shared: Option<(&str, u32)>, on_line: impl Fn(Option<String>) + Send + 'static) -> Result<BridgeClient, String> {
        let exe = locate_exe().ok_or("32-bit bridge helper not found — build it with `npm run desktop:build`.")?;
        let mut cmd = Command::new(&exe);
        cmd.arg(plugin_path).arg(owner_hwnd.to_string()).arg(device.unwrap_or_default());
        if let Some((name, rate)) = shared {
            cmd.arg(name).arg(rate.to_string());
        }
        cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        }
        let mut child = cmd.spawn().map_err(|e| format!("Could not start the 32-bit bridge: {e}"))?;
        let stdin = child.stdin.take().ok_or("bridge stdin unavailable")?;
        let stdout = child.stdout.take().ok_or("bridge stdout unavailable")?;
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                match line {
                    Ok(l) if !l.is_empty() => on_line(Some(l)),
                    Ok(_) => {}
                    Err(_) => break,
                }
            }
            on_line(None);
        });
        fls_native::log::write(&format!("[bridge] spawned {} for {plugin_path}", exe.display()));
        Ok(BridgeClient { child: Mutex::new(child), stdin: Mutex::new(stdin) })
    }

    pub fn send(&self, v: serde_json::Value) {
        if let Ok(mut s) = self.stdin.lock() {
            if writeln!(s, "{v}").and_then(|_| s.flush()).is_err() {
                fls_native::log::write("[bridge] send failed (helper gone)");
            }
        }
    }
}

impl Drop for BridgeClient {
    fn drop(&mut self) {
        self.send(serde_json::json!({ "t": "quit" }));
        if let Ok(mut child) = self.child.lock() {
            for _ in 0..12 {
                if matches!(child.try_wait(), Ok(Some(_))) {
                    return;
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            let _ = child.kill();
        }
    }
}
