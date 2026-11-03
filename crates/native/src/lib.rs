//! Native layer shared by the desktop host and the 32-bit plugin bridge:
//! VST2 and VST3 hosting, plugin editor windows, and the audio output engine.

pub mod bounce;
pub mod editor;
pub mod engine;
pub mod ffi;
pub mod host_callback;
pub mod log;
pub mod pe;
pub mod plugin;
pub mod vst3;

pub use engine::{output_devices, AudioSource, Engine};
pub use plugin::{load_any, Hosted, Plugin, PluginInfo, PluginState, RenderNote};
