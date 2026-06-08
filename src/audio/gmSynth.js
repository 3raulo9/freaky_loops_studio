// GM sample-based synthesis via soundfont-player + FluidR3_GM (CDN).
// Loads real PCM instrument samples — same quality as the Windows GS Wavetable Synth.
// Each program's samples are fetched once and cached in the browser;
// subsequent page loads are instant (browser cache).
//
// Integration with the studio channel API:
//   makeGMPlayFn(program) → fn(audioCtx, time, params, dest)
// Compatible with the same fn signature used by all FM and drum channels.

import Soundfont from 'soundfont-player'

// Exact filenames used by the Gleitz FluidR3_GM soundfont CDN.
// Program index 0-127 matches the General MIDI spec.
const GM_SOUNDFONT_NAMES = [
  // 0-7   Piano
  'acoustic_grand_piano','bright_acoustic_piano','electric_grand_piano','honkytonk_piano',
  'electric_piano_1','electric_piano_2','harpsichord','clavinet',
  // 8-15  Chromatic Percussion
  'celesta','glockenspiel','music_box','vibraphone','marimba','xylophone',
  'tubular_bells','dulcimer',
  // 16-23 Organ
  'drawbar_organ','percussive_organ','rock_organ','church_organ','reed_organ',
  'accordion','harmonica','tango_accordion',
  // 24-31 Guitar
  'nylon_string_guitar','steel_string_guitar','electric_guitar_jazz',
  'electric_guitar_clean','electric_guitar_muted','overdriven_guitar',
  'distortion_guitar','guitar_harmonics',
  // 32-39 Bass
  'acoustic_bass','electric_bass_finger','electric_bass_pick','fretless_bass',
  'slap_bass_1','slap_bass_2','synth_bass_1','synth_bass_2',
  // 40-47 Strings
  'violin','viola','cello','contrabass','tremolo_strings','pizzicato_strings',
  'orchestral_harp','timpani',
  // 48-55 Ensemble
  'string_ensemble_1','string_ensemble_2','synth_strings_1','synth_strings_2',
  'choir_aahs','voice_oohs','synth_voice','orchestra_hit',
  // 56-63 Brass
  'trumpet','trombone','tuba','muted_trumpet','french_horn','brass_section',
  'synth_brass_1','synth_brass_2',
  // 64-71 Reed
  'soprano_sax','alto_sax','tenor_sax','baritone_sax','oboe','english_horn',
  'bassoon','clarinet',
  // 72-79 Pipe
  'piccolo','flute','recorder','pan_flute','blown_bottle','shakuhachi',
  'whistle','ocarina',
  // 80-87 Synth Lead
  'lead_1_square','lead_2_sawtooth','lead_3_calliope','lead_4_chiff',
  'lead_5_charang','lead_6_voice','lead_7_fifths','lead_8_bass_lead',
  // 88-95 Synth Pad
  'pad_1_new_age','pad_2_warm','pad_3_polysynth','pad_4_choir',
  'pad_5_bowed','pad_6_metallic','pad_7_halo','pad_8_sweep',
  // 96-103 Synth FX
  'fx_1_rain','fx_2_soundtrack','fx_3_crystal','fx_4_atmosphere',
  'fx_5_brightness','fx_6_goblins','fx_7_echoes','fx_8_sci_fi',
  // 104-111 Ethnic
  'sitar','banjo','shamisen','koto','kalimba','bagpipe','fiddle','shanai',
  // 112-119 Percussive
  'tinkle_bell','agogo','steel_drums','woodblock','taiko_drum','melodic_tom',
  'synth_drum','reverse_cymbal',
  // 120-127 Sound Effects
  'guitar_fret_noise','breath_noise','seashore','bird_tweet','telephone_ring',
  'helicopter','applause','gunshot',
]

// Per-AudioContext instrument cache: WeakMap<AudioContext, Map<program, Promise<Instrument>>>
// WeakMap lets GC clean up when the AudioContext is closed.
const _cache = new WeakMap()

function getCtxCache(ctx) {
  if (!_cache.has(ctx)) _cache.set(ctx, new Map())
  return _cache.get(ctx)
}

export function getSoundfontName(program) {
  return GM_SOUNDFONT_NAMES[Math.max(0, Math.min(127, program))] ?? 'acoustic_grand_piano'
}

// Start loading a GM instrument. Returns a Promise<Instrument>.
// Safe to call multiple times — results are cached per (audioCtx, program).
export function preloadGMInstrument(audioCtx, program) {
  const prog = Math.max(0, Math.min(127, program))
  const cache = getCtxCache(audioCtx)
  if (!cache.has(prog)) {
    cache.set(prog, Soundfont.instrument(audioCtx, GM_SOUNDFONT_NAMES[prog], {
      soundfont: 'FluidR3_GM',
      format:    'mp3',
    }))
  }
  return cache.get(prog)
}

// Returns a play function compatible with the studio channel fn API:
//   fn(audioCtx, time, { pitch, velocity, gate }, destNode)
//
// The instrument loads lazily on first call; notes are silent while loading
// (typically < 2 seconds on first visit, instant from cache on return).
export function makeGMPlayFn(program) {
  const prog = Math.max(0, Math.min(127, program))
  let _inst = null

  return function playGM(audioCtx, time, params, dest) {
    const { pitch = 60, velocity = 1, gate = 0.5 } = params

    if (!_inst) {
      preloadGMInstrument(audioCtx, prog).then(inst => { _inst = inst })
      return
    }

    _inst.play(pitch, time, {
      gain:        Math.min(1, velocity * 0.85),
      duration:    Math.max(0.05, gate),
      destination: dest ?? audioCtx.destination,
    })
  }
}
