//! Native layer shared by the desktop host and the 32-bit plugin bridge:
//! VST2 hosting, plugin editor windows, and the audio output engine.

pub mod bounce;
pub mod editor;
pub mod engine;
pub mod ffi;
pub mod host_callback;
pub mod log;
pub mod pe;
pub mod plugin;

pub use engine::{AudioSource, Engine};
pub use plugin::{Plugin, PluginInfo, PluginState, RenderNote};
