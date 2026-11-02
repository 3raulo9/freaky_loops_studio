//! VST 2.4 binary interface: the C structs, opcodes and flags a host needs to
//! load a plugin `.dll`, drive it, and answer its callbacks. Written from the
//! publicly documented ABI; layouts are `repr(C)` with natural alignment, which
//! matches the SDK's `#pragma pack(8)` on both x86 and x64.

#![allow(non_camel_case_types, dead_code)]

use std::os::raw::{c_char, c_void};

pub const MAGIC: i32 = i32::from_be_bytes(*b"VstP");

pub type Dispatcher =
    unsafe extern "C" fn(effect: *mut AEffect, opcode: i32, index: i32, value: isize, ptr: *mut c_void, opt: f32) -> isize;
pub type ProcessProc = unsafe extern "C" fn(effect: *mut AEffect, inputs: *mut *mut f32, outputs: *mut *mut f32, frames: i32);
pub type ProcessDoubleProc =
    unsafe extern "C" fn(effect: *mut AEffect, inputs: *mut *mut f64, outputs: *mut *mut f64, frames: i32);
pub type SetParameterProc = unsafe extern "C" fn(effect: *mut AEffect, index: i32, value: f32);
pub type GetParameterProc = unsafe extern "C" fn(effect: *mut AEffect, index: i32) -> f32;
pub type HostCallback =
    unsafe extern "C" fn(effect: *mut AEffect, opcode: i32, index: i32, value: isize, ptr: *mut c_void, opt: f32) -> isize;
pub type PluginMain = unsafe extern "C" fn(host: HostCallback) -> *mut AEffect;

#[repr(C)]
pub struct AEffect {
    pub magic: i32,
    pub dispatcher: Option<Dispatcher>,
    pub process: Option<ProcessProc>,
    pub set_parameter: Option<SetParameterProc>,
    pub get_parameter: Option<GetParameterProc>,
    pub num_programs: i32,
    pub num_params: i32,
    pub num_inputs: i32,
    pub num_outputs: i32,
    pub flags: i32,
    pub resvd1: isize,
    pub resvd2: isize,
    pub initial_delay: i32,
    pub real_qualities: i32,
    pub off_qualities: i32,
    pub io_ratio: f32,
    pub object: *mut c_void,
    pub user: *mut c_void,
    pub unique_id: i32,
    pub version: i32,
    pub process_replacing: Option<ProcessProc>,
    pub process_double_replacing: Option<ProcessDoubleProc>,
    pub future: [c_char; 56],
}

// effFlags
pub const FLAG_HAS_EDITOR: i32 = 1 << 0;
pub const FLAG_CAN_REPLACING: i32 = 1 << 4;
pub const FLAG_PROGRAM_CHUNKS: i32 = 1 << 5;
pub const FLAG_IS_SYNTH: i32 = 1 << 8;
pub const FLAG_NO_SOUND_IN_STOP: i32 = 1 << 9;

// Plugin opcodes (host → plugin dispatcher)
pub const EFF_OPEN: i32 = 0;
pub const EFF_CLOSE: i32 = 1;
pub const EFF_SET_PROGRAM: i32 = 2;
pub const EFF_GET_PROGRAM: i32 = 3;
pub const EFF_GET_PROGRAM_NAME: i32 = 5;
pub const EFF_GET_PARAM_LABEL: i32 = 6;
pub const EFF_GET_PARAM_DISPLAY: i32 = 7;
pub const EFF_GET_PARAM_NAME: i32 = 8;
pub const EFF_SET_SAMPLE_RATE: i32 = 10;
pub const EFF_SET_BLOCK_SIZE: i32 = 11;
pub const EFF_MAINS_CHANGED: i32 = 12;
pub const EFF_EDIT_GET_RECT: i32 = 13;
pub const EFF_EDIT_OPEN: i32 = 14;
pub const EFF_EDIT_CLOSE: i32 = 15;
pub const EFF_EDIT_IDLE: i32 = 19;
pub const EFF_GET_CHUNK: i32 = 23;
pub const EFF_SET_CHUNK: i32 = 24;
pub const EFF_PROCESS_EVENTS: i32 = 25;
pub const EFF_GET_PLUG_CATEGORY: i32 = 35;
pub const EFF_GET_EFFECT_NAME: i32 = 45;
pub const EFF_GET_VENDOR_STRING: i32 = 47;
pub const EFF_GET_PRODUCT_STRING: i32 = 48;
pub const EFF_CAN_DO: i32 = 51;
pub const EFF_IDLE: i32 = 53;
pub const EFF_GET_VST_VERSION: i32 = 58;
pub const EFF_START_PROCESS: i32 = 71;
pub const EFF_STOP_PROCESS: i32 = 72;

// Host opcodes (plugin → host callback)
pub const AM_AUTOMATE: i32 = 0;
pub const AM_VERSION: i32 = 1;
pub const AM_CURRENT_ID: i32 = 2;
pub const AM_IDLE: i32 = 3;
pub const AM_GET_TIME: i32 = 7;
pub const AM_PROCESS_EVENTS: i32 = 8;
pub const AM_IO_CHANGED: i32 = 13;
pub const AM_SIZE_WINDOW: i32 = 15;
pub const AM_GET_SAMPLE_RATE: i32 = 16;
pub const AM_GET_BLOCK_SIZE: i32 = 17;
pub const AM_GET_INPUT_LATENCY: i32 = 18;
pub const AM_GET_OUTPUT_LATENCY: i32 = 19;
pub const AM_GET_CURRENT_PROCESS_LEVEL: i32 = 23;
pub const AM_GET_AUTOMATION_STATE: i32 = 24;
pub const AM_GET_VENDOR_STRING: i32 = 32;
pub const AM_GET_PRODUCT_STRING: i32 = 33;
pub const AM_GET_VENDOR_VERSION: i32 = 34;
pub const AM_CAN_DO: i32 = 37;
pub const AM_GET_LANGUAGE: i32 = 38;
pub const AM_UPDATE_DISPLAY: i32 = 42;
pub const AM_BEGIN_EDIT: i32 = 43;
pub const AM_END_EDIT: i32 = 44;

#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct ERect {
    pub top: i16,
    pub left: i16,
    pub bottom: i16,
    pub right: i16,
}

pub const MIDI_TYPE: i32 = 1;

#[repr(C)]
#[derive(Clone, Copy)]
pub struct VstMidiEvent {
    pub kind: i32,
    pub byte_size: i32,
    pub delta_frames: i32,
    pub flags: i32,
    pub note_length: i32,
    pub note_offset: i32,
    pub midi_data: [u8; 4],
    pub detune: i8,
    pub note_off_velocity: u8,
    pub reserved1: u8,
    pub reserved2: u8,
}

impl VstMidiEvent {
    pub fn new(delta_frames: i32, data: [u8; 3]) -> Self {
        Self {
            kind: MIDI_TYPE,
            byte_size: std::mem::size_of::<Self>() as i32,
            delta_frames,
            flags: 1, // kVstMidiEventIsRealtime
            note_length: 0,
            note_offset: 0,
            midi_data: [data[0], data[1], data[2], 0],
            detune: 0,
            note_off_velocity: 0,
            reserved1: 0,
            reserved2: 0,
        }
    }
}

/// Fixed-capacity `VstEvents` block. The SDK declares `events[2]` and expects
/// hosts to over-allocate; a fixed array of pointers does the same job.
pub const MAX_BLOCK_EVENTS: usize = 512;

#[repr(C)]
pub struct VstEvents {
    pub num_events: i32,
    pub reserved: isize,
    pub events: [*mut VstMidiEvent; MAX_BLOCK_EVENTS],
}

// VstTimeInfo flags
pub const TT_CHANGED: i32 = 1;
pub const TT_PLAYING: i32 = 1 << 1;
pub const TT_NANOS_VALID: i32 = 1 << 8;
pub const TT_PPQ_POS_VALID: i32 = 1 << 9;
pub const TT_TEMPO_VALID: i32 = 1 << 10;
pub const TT_BARS_VALID: i32 = 1 << 11;
pub const TT_TIME_SIG_VALID: i32 = 1 << 13;

#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct VstTimeInfo {
    pub sample_pos: f64,
    pub sample_rate: f64,
    pub nano_seconds: f64,
    pub ppq_pos: f64,
    pub tempo: f64,
    pub bar_start_pos: f64,
    pub cycle_start_pos: f64,
    pub cycle_end_pos: f64,
    pub time_sig_numerator: i32,
    pub time_sig_denominator: i32,
    pub smpte_offset: i32,
    pub smpte_frame_rate: i32,
    pub samples_to_next_clock: i32,
    pub flags: i32,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::mem::size_of;

    #[test]
    fn layouts_match_the_sdk() {
        assert_eq!(size_of::<VstMidiEvent>(), 32);
        assert_eq!(size_of::<ERect>(), 8);
        assert_eq!(size_of::<VstTimeInfo>(), 8 * 8 + 6 * 4);
        #[cfg(target_pointer_width = "64")]
        assert_eq!(size_of::<AEffect>(), 192);
        #[cfg(target_pointer_width = "32")]
        assert_eq!(size_of::<AEffect>(), 144);
    }
}
