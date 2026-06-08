// General MIDI instrument names, categories, and bank-aware fallback resolution.

export const GM_INSTRUMENTS = [
  // 0-7 Piano
  'Acoustic Grand Piano', 'Bright Acoustic Piano', 'Electric Grand Piano',
  'Honky-Tonk Piano', 'Electric Piano 1', 'Electric Piano 2', 'Harpsichord', 'Clavinet',
  // 8-15 Chromatic Percussion
  'Celesta', 'Glockenspiel', 'Music Box', 'Vibraphone', 'Marimba', 'Xylophone',
  'Tubular Bells', 'Dulcimer',
  // 16-23 Organ
  'Drawbar Organ', 'Percussive Organ', 'Rock Organ', 'Church Organ', 'Reed Organ',
  'Accordion', 'Harmonica', 'Tango Accordion',
  // 24-31 Guitar
  'Nylon String Guitar', 'Steel String Guitar', 'Electric Guitar (jazz)',
  'Electric Guitar (clean)', 'Electric Guitar (muted)', 'Overdriven Guitar',
  'Distortion Guitar', 'Guitar Harmonics',
  // 32-39 Bass
  'Acoustic Bass', 'Electric Bass (finger)', 'Electric Bass (pick)', 'Fretless Bass',
  'Slap Bass 1', 'Slap Bass 2', 'Synth Bass 1', 'Synth Bass 2',
  // 40-47 Strings
  'Violin', 'Viola', 'Cello', 'Contrabass', 'Tremolo Strings', 'Pizzicato Strings',
  'Orchestral Harp', 'Timpani',
  // 48-55 Ensemble
  'String Ensemble 1', 'String Ensemble 2', 'Synth Strings 1', 'Synth Strings 2',
  'Choir Aahs', 'Voice Oohs', 'Synth Voice', 'Orchestra Hit',
  // 56-63 Brass
  'Trumpet', 'Trombone', 'Tuba', 'Muted Trumpet', 'French Horn', 'Brass Section',
  'Synth Brass 1', 'Synth Brass 2',
  // 64-71 Reed
  'Soprano Sax', 'Alto Sax', 'Tenor Sax', 'Baritone Sax', 'Oboe', 'English Horn',
  'Bassoon', 'Clarinet',
  // 72-79 Pipe
  'Piccolo', 'Flute', 'Recorder', 'Pan Flute', 'Blown Bottle', 'Shakuhachi',
  'Whistle', 'Ocarina',
  // 80-87 Synth Lead
  'Lead 1 (square)', 'Lead 2 (sawtooth)', 'Lead 3 (calliope)', 'Lead 4 (chiff)',
  'Lead 5 (charang)', 'Lead 6 (voice)', 'Lead 7 (fifths)', 'Lead 8 (bass+lead)',
  // 88-95 Synth Pad
  'Pad 1 (new age)', 'Pad 2 (warm)', 'Pad 3 (polysynth)', 'Pad 4 (choir)',
  'Pad 5 (bowed)', 'Pad 6 (metallic)', 'Pad 7 (halo)', 'Pad 8 (sweep)',
  // 96-103 Synth FX
  'FX 1 (rain)', 'FX 2 (soundtrack)', 'FX 3 (crystal)', 'FX 4 (atmosphere)',
  'FX 5 (brightness)', 'FX 6 (goblins)', 'FX 7 (echoes)', 'FX 8 (sci-fi)',
  // 104-111 Ethnic
  'Sitar', 'Banjo', 'Shamisen', 'Koto', 'Kalimba', 'Bag Pipe', 'Fiddle', 'Shanai',
  // 112-119 Percussive
  'Tinkle Bell', 'Agogo', 'Steel Drums', 'Woodblock', 'Taiko Drum', 'Melodic Tom',
  'Synth Drum', 'Reverse Cymbal',
  // 120-127 Sound Effects
  'Guitar Fret Noise', 'Breath Noise', 'Seashore', 'Bird Tweet', 'Telephone Ring',
  'Helicopter', 'Applause', 'Gunshot',
]

// GM channel 10 percussion note names (MIDI note numbers 35-81)
export const GM_PERCUSSION = {
  35: 'Acoustic Bass Drum', 36: 'Bass Drum 1',   37: 'Side Stick',      38: 'Acoustic Snare',
  39: 'Hand Clap',          40: 'Electric Snare', 41: 'Low Floor Tom',   42: 'Closed Hi-Hat',
  43: 'High Floor Tom',     44: 'Pedal Hi-Hat',   45: 'Low Tom',         46: 'Open Hi-Hat',
  47: 'Low-Mid Tom',        48: 'Hi-Mid Tom',     49: 'Crash Cymbal 1',  50: 'High Tom',
  51: 'Ride Cymbal 1',      52: 'Chinese Cymbal', 53: 'Ride Bell',       54: 'Tambourine',
  55: 'Splash Cymbal',      56: 'Cowbell',        57: 'Crash Cymbal 2',  58: 'Vibraslap',
  59: 'Ride Cymbal 2',      60: 'Hi Bongo',       61: 'Low Bongo',       62: 'Mute Hi Conga',
  63: 'Open Hi Conga',      64: 'Low Conga',      65: 'High Timbale',    66: 'Low Timbale',
  67: 'High Agogo',         68: 'Low Agogo',      69: 'Cabasa',          70: 'Maracas',
  71: 'Short Whistle',      72: 'Long Whistle',   73: 'Short Guiro',     74: 'Long Guiro',
  75: 'Claves',             76: 'Hi Wood Block',  77: 'Low Wood Block',  78: 'Mute Cuica',
  79: 'Open Cuica',         80: 'Mute Triangle',  81: 'Open Triangle',
}

// Per-category ADSR presets and waveform types for the Web Audio fallback synth.
// `fallback` is the canonical GM program number to use when a non-GM bank is detected.
export const GM_CATEGORIES = [
  { name: 'Piano',          range: [0,   7],   fallback: 0,   waveform: 'triangle', attack: 0.002, decay: 0.5,  sustain: 0.4,  release: 1.2  },
  { name: 'Chromatic Perc', range: [8,  15],   fallback: 11,  waveform: 'sine',     attack: 0.002, decay: 0.35, sustain: 0.2,  release: 0.6  },
  { name: 'Organ',          range: [16, 23],   fallback: 16,  waveform: 'sawtooth', attack: 0.012, decay: 0.0,  sustain: 1.0,  release: 0.06 },
  { name: 'Guitar',         range: [24, 31],   fallback: 25,  waveform: 'sawtooth', attack: 0.002, decay: 0.28, sustain: 0.35, release: 0.35 },
  { name: 'Bass',           range: [32, 39],   fallback: 32,  waveform: 'sawtooth', attack: 0.010, decay: 0.12, sustain: 0.8,  release: 0.18 },
  { name: 'Strings',        range: [40, 47],   fallback: 40,  waveform: 'sawtooth', attack: 0.08,  decay: 0.1,  sustain: 0.9,  release: 0.45 },
  { name: 'Ensemble',       range: [48, 55],   fallback: 48,  waveform: 'sawtooth', attack: 0.14,  decay: 0.1,  sustain: 0.85, release: 0.55 },
  { name: 'Brass',          range: [56, 63],   fallback: 56,  waveform: 'square',   attack: 0.04,  decay: 0.12, sustain: 0.8,  release: 0.22 },
  { name: 'Reed',           range: [64, 71],   fallback: 65,  waveform: 'sawtooth', attack: 0.05,  decay: 0.1,  sustain: 0.85, release: 0.28 },
  { name: 'Pipe',           range: [72, 79],   fallback: 73,  waveform: 'sine',     attack: 0.06,  decay: 0.05, sustain: 0.9,  release: 0.32 },
  { name: 'Synth Lead',     range: [80, 87],   fallback: 81,  waveform: 'sawtooth', attack: 0.008, decay: 0.05, sustain: 0.9,  release: 0.12 },
  { name: 'Synth Pad',      range: [88, 95],   fallback: 89,  waveform: 'sine',     attack: 0.22,  decay: 0.1,  sustain: 0.8,  release: 0.9  },
  { name: 'Synth FX',       range: [96, 103],  fallback: 99,  waveform: 'sine',     attack: 0.3,   decay: 0.2,  sustain: 0.6,  release: 1.0  },
  { name: 'Ethnic',         range: [104, 111], fallback: 104, waveform: 'triangle', attack: 0.010, decay: 0.32, sustain: 0.5,  release: 0.42 },
  { name: 'Percussive',     range: [112, 119], fallback: 112, waveform: 'sine',     attack: 0.002, decay: 0.22, sustain: 0.1,  release: 0.22 },
  { name: 'Sound FX',       range: [120, 127], fallback: 123, waveform: 'triangle', attack: 0.1,   decay: 0.5,  sustain: 0.3,  release: 0.55 },
]

/** Map program number (0-127) to its GM instrument name. */
export function resolveGMName(program) {
  return GM_INSTRUMENTS[Math.max(0, Math.min(127, program))]
}

/** Return the category descriptor for a given program number (0-127). */
export function getCategoryForProgram(program) {
  const n = Math.max(0, Math.min(127, program))
  return GM_CATEGORIES.find(c => n >= c.range[0] && n <= c.range[1]) ?? GM_CATEGORIES[0]
}

/**
 * Bank-aware patch resolver.
 *
 * Standard MIDI uses Bank Select (CC#0 = MSB, CC#32 = LSB) to address sounds
 * outside the base GM bank.  When bankMSB == 0 the sound is in the standard GM
 * bank and the program number is used directly.  Any other bank value signals a
 * GS / XG / proprietary extension bank; we fall back to the canonical GM program
 * for that category so our Web Audio synth always has a playable approximation.
 *
 * Examples from the original spec:
 *   custom synth-lead (bank > 0, prog 80-87) → GM Lead 2 Sawtooth (prog 81)
 *   custom string layer (bank > 0, prog 40-47) → GM String Ensemble 1 (prog 48) fallback
 *
 * @param {number} program  0-127 MIDI program number
 * @param {number} bankMSB  Bank Select MSB (CC#0), default 0 = standard GM
 * @returns {number} resolved GM program number 0-127
 */
export function resolvePatch(program, bankMSB = 0) {
  const prog = Math.max(0, Math.min(127, program))
  // Standard GM bank — program is valid as-is
  if (bankMSB === 0) return prog
  // Non-standard bank: route to the canonical fallback for the same GM category
  // (e.g. a GS Sawtooth Lead extension maps to GM Lead 2 Sawtooth)
  return getCategoryForProgram(prog).fallback
}

/**
 * Handle out-of-range program numbers (>127) that can appear in malformed or
 * proprietary files by wrapping to 0-127 and then applying the category fallback.
 */
export function resolveOutOfRangePatch(program) {
  const wrapped = ((program % 128) + 128) % 128
  return getCategoryForProgram(wrapped).fallback
}
