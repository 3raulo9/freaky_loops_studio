//! The parsed project, kept close to the file's own concepts. Positions are in
//! the file's ticks (`Project::ppq` per quarter note); the UI rescales.

#[derive(Debug, Default, Clone)]
pub struct Project {
    pub version: String,
    pub build: u32,
    pub ppq: u16,
    pub format: i16,
    pub tempo: f64,
    pub time_sig: (u8, u8),
    pub main_pitch: i16,
    pub main_volume: Option<u32>,
    pub title: String,
    pub artists: String,
    pub genre: String,
    pub comments: String,
    pub url: String,
    pub data_path: String,
    pub channels: Vec<Channel>,
    pub patterns: Vec<Pattern>,
    pub arrangements: Vec<Arrangement>,
    pub current_arrangement: Option<u16>,
    pub current_pattern: Option<u16>,
    pub inserts: Vec<Insert>,
    pub controllers: Vec<Controller>,
    pub warnings: Vec<String>,
}

/// A plugin instance (channel generator or mixer effect).
#[derive(Debug, Default, Clone)]
pub struct Plugin {
    /// The plugin's own (internal) name; empty for the built-in sampler.
    pub internal: String,
    /// The name the user gave the instance.
    pub name: String,
    pub color: Option<u32>,
    /// Hosted third-party plugin (VST) when the state is a wrapper record list.
    pub vst: Option<Vst>,
    /// File paths found in an opaque native state (samples, sound fonts).
    pub paths: Vec<String>,
    /// Program number for sound-font players (heuristic, see parser).
    pub program: Option<u32>,
    pub state_len: usize,
}

#[derive(Debug, Default, Clone)]
pub struct Vst {
    pub name: String,
    pub vendor: String,
    pub path: String,
    /// VST2 unique id as four characters.
    pub fourcc: String,
    /// VST3 class id (hex) when the plugin is a VST3.
    pub guid: String,
    pub state: VstState,
    pub inputs: u32,
    pub outputs: u32,
}

#[derive(Debug, Default, Clone)]
pub enum VstState {
    #[default]
    None,
    /// effGetChunk data.
    Chunk(Vec<u8>),
    /// Plain parameter values (plugins without chunk support).
    Params(Vec<f32>),
    /// Present but not understood (kept so nothing is silently dropped).
    Raw(Vec<u8>),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ChannelKind {
    #[default]
    Sampler,
    Generator,
    Layer,
    AudioClip,
    Automation,
    Other(u8),
}

impl ChannelKind {
    pub fn from_code(c: u8) -> Self {
        match c {
            0 => ChannelKind::Sampler,
            2 => ChannelKind::Generator,
            3 => ChannelKind::Layer,
            4 => ChannelKind::AudioClip,
            5 => ChannelKind::Automation,
            n => ChannelKind::Other(n),
        }
    }
    pub fn as_str(&self) -> &'static str {
        match self {
            ChannelKind::Sampler => "sampler",
            ChannelKind::Generator => "generator",
            ChannelKind::Layer => "layer",
            ChannelKind::AudioClip => "audioclip",
            ChannelKind::Automation => "automation",
            ChannelKind::Other(_) => "other",
        }
    }
}

#[derive(Debug, Clone)]
pub struct Channel {
    pub iid: u16,
    pub kind: ChannelKind,
    pub plugin: Plugin,
    pub legacy_name: String,
    pub sample_path: String,
    pub enabled: bool,
    /// 0..1 of the channel fader's full scale.
    pub volume: f64,
    /// -1..1.
    pub pan: f64,
    pub pitch_cents: i32,
    /// Mixer track (0 = master), or None when unrouted.
    pub mixer: Option<i32>,
    pub color: Option<u32>,
    pub root_note: u32,
    pub fine_tune: i32,
    pub cut_group: (u16, u16),
    pub reversed: bool,
    pub children: Vec<u16>,
    pub group: i32,
    pub automation: Vec<AutoPoint>,
    pub swing: Option<u32>,
    pub time_shift: Option<u32>,
    pub stretch_time: Option<f32>,
}

impl Channel {
    pub fn new(iid: u16) -> Self {
        Channel {
            iid,
            kind: ChannelKind::Sampler,
            plugin: Plugin::default(),
            legacy_name: String::new(),
            sample_path: String::new(),
            enabled: true,
            volume: 10000.0 / 12800.0,
            pan: 0.0,
            pitch_cents: 0,
            mixer: None,
            color: None,
            root_note: 60,
            fine_tune: 0,
            cut_group: (0, 0),
            reversed: false,
            children: Vec::new(),
            group: -1,
            automation: Vec::new(),
            swing: None,
            time_shift: None,
            stretch_time: None,
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct AutoPoint {
    /// Position in quarter notes from the clip start.
    pub pos: f64,
    pub value: f64,
    pub tension: f32,
}

#[derive(Debug, Clone, Copy)]
pub struct Note {
    pub channel: u16,
    pub pos: u32,
    /// 0 = a step-sequencer hit (plays the sound's natural length).
    pub len: u32,
    pub key: u16,
    pub velocity: u8,
    pub pan: u8,
    pub fine_pitch: u8,
    pub release: u8,
    pub mod_x: u8,
    pub mod_y: u8,
    pub slide: bool,
    pub group: u16,
}

#[derive(Debug, Default, Clone)]
pub struct Pattern {
    pub iid: u16,
    pub name: String,
    pub color: Option<u32>,
    pub length: u32,
    pub looped: bool,
    pub notes: Vec<Note>,
}

#[derive(Debug, Clone, Copy)]
pub enum ItemRef {
    Pattern(u16),
    Channel(u16),
}

#[derive(Debug, Clone, Copy)]
pub struct Item {
    pub pos: u32,
    pub len: u32,
    pub track: u16,
    pub what: ItemRef,
    /// Clip trims in ticks (patterns) or seconds-ish units (audio); < 0 = unset.
    pub start_offset: f32,
    pub end_offset: f32,
    pub muted: bool,
    pub group: u16,
    pub flags: u16,
}

#[derive(Debug, Default, Clone)]
pub struct Track {
    pub index: u16,
    pub name: String,
    pub color: Option<u32>,
    pub enabled: bool,
    pub height: f32,
}

#[derive(Debug, Default, Clone)]
pub struct Marker {
    pub pos: u32,
    pub kind: u8,
    pub name: String,
    /// Set when the marker is a time-signature change.
    pub signature: Option<(u8, u8)>,
}

#[derive(Debug, Default, Clone)]
pub struct Arrangement {
    pub iid: u16,
    pub name: String,
    pub items: Vec<Item>,
    pub tracks: Vec<Track>,
    pub markers: Vec<Marker>,
}

#[derive(Debug, Default, Clone)]
pub struct Slot {
    pub index: u16,
    pub plugin: Plugin,
    pub enabled: bool,
    pub mix: f64,
}

#[derive(Debug, Default, Clone)]
pub struct Eq3 {
    pub gain: [i32; 3],
    pub freq: [i32; 3],
    pub q: [i32; 3],
}

#[derive(Debug, Default, Clone)]
pub struct Insert {
    pub index: u16,
    pub name: String,
    pub color: Option<u32>,
    pub flags: u32,
    pub volume: f64,
    pub pan: f64,
    pub stereo_sep: f64,
    /// Inserts this one sends to (index, 0..1 level).
    pub sends: Vec<(u16, f64)>,
    pub routes: Vec<bool>,
    pub output: i32,
    pub input: i32,
    pub slots: Vec<Slot>,
    pub eq: Eq3,
}

impl Insert {
    pub fn muted(&self) -> bool {
        self.flags & (1 << 3) == 0 && self.flags != 0
    }
    pub fn fx_bypassed(&self) -> bool {
        self.flags & (1 << 2) == 0 && self.flags != 0
    }
    pub fn polarity(&self) -> bool {
        self.flags & 1 != 0
    }
}

/// Link from an automation clip (a channel) to what it moves.
#[derive(Debug, Default, Clone, Copy)]
pub struct Controller {
    pub source: u16,
    /// Bit 15 set: a plugin parameter index; else a built-in control id.
    pub parameter: u16,
    pub target: Target,
}

#[derive(Debug, Default, Clone, Copy, PartialEq)]
pub enum Target {
    #[default]
    Unknown,
    Channel(u16),
    /// Mixer insert and effect slot.
    Mixer(u16, u16),
    Project,
}
