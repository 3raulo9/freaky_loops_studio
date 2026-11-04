//! Native layer shared by the desktop host and the 32-bit plugin bridge:
//! VST2 and VST3 hosting, plugin editor windows, and the audio output engine.

#[cfg(all(windows, target_arch = "x86_64"))]
pub mod asio;
pub mod bounce;
pub mod editor;
pub mod engine;
pub mod ffi;
pub mod host_callback;
pub mod log;
pub mod pe;
pub mod plugin;
pub mod rt;
pub mod sched;
pub mod vst3;
#[cfg(windows)]
pub mod wasapi;
pub mod webbus;

pub use engine::{output_devices, AudioConfig, AudioSource, Clock, DriverKind, Engine, EngineStats, Opened, RenderCtx, Strip};
pub use plugin::{load_any, Hosted, Plugin, PluginInfo, PluginState, RenderNote};
