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

// Synchronously-resolved instruments per context. A play call needs the live
// Instrument object *now* (no awaiting), and an instrument is bound to the exact
// AudioContext it was decoded on — so live and offline (render) contexts each get
// their own entry. WeakMap<AudioContext, Map<program, Instrument>>.
const _resolved = new WeakMap()

function getCtxCache(ctx) {
  if (!_cache.has(ctx)) _cache.set(ctx, new Map())
  return _cache.get(ctx)
}

function getResolved(ctx, prog) {
  return _resolved.get(ctx)?.get(prog) ?? null
}

export function getSoundfontName(program) {
  return GM_SOUNDFONT_NAMES[Math.max(0, Math.min(127, program))] ?? 'acoustic_grand_piano'
}

// Whether a GM program is a *continuous* voice (organ, strings, winds, pads…) that
// should sustain for as long as a key is held, versus a naturally-decaying / plucked
// voice (piano, guitar, mallets, percussion) that rings out on its own. Used to
// decide whether held live notes loop-sustain until note-off.
export function gmSustains(program) {
  const p = Math.max(0, Math.min(127, program | 0))
  // Decaying exceptions that fall inside otherwise-sustaining ranges:
  // 45 pizzicato strings · 46 orchestral harp · 47 timpani · 55 orchestra hit
  if (p === 45 || p === 46 || p === 47 || p === 55) return false
  if (p >= 16 && p <= 23)  return true   // Organ
  if (p >= 40 && p <= 54)  return true   // Strings + Ensemble (minus exceptions)
  if (p >= 56 && p <= 79)  return true   // Brass + Reed + Pipe
  if (p >= 80 && p <= 103) return true   // Synth Lead + Pad + FX
  if (p === 109 || p === 110 || p === 111) return true  // bagpipe, fiddle, shanai
  return false
}

// Start loading a GM instrument. Returns a Promise<Instrument>.
// Safe to call multiple times — results are cached per (audioCtx, program).
export function preloadGMInstrument(audioCtx, program) {
  const prog = Math.max(0, Math.min(127, program))
  const cache = getCtxCache(audioCtx)
  if (!cache.has(prog)) {
    const promise = Soundfont.instrument(audioCtx, GM_SOUNDFONT_NAMES[prog], {
      soundfont: 'FluidR3_GM',
      format:    'mp3',
    }).then(inst => {
      // Record the resolved instrument for synchronous lookup during playback.
      let m = _resolved.get(audioCtx)
      if (!m) { m = new Map(); _resolved.set(audioCtx, m) }
      m.set(prog, inst)
      return inst
    })
    cache.set(prog, promise)
  }
  return cache.get(prog)
}

// Returns a play function compatible with the studio channel fn API:
//   fn(audioCtx, time, { pitch, velocity, gate, attack, decay, sustain, release, level }, destNode)
//
// Beyond pitch/velocity/gate, the channel's editable knobs feed a full ADSR
// amplitude envelope + output level so GM voices can be sound-shaped like any
// other instrument in the rack (sample-player applies the envelope on top of
// the PCM sample). The envelope is passed as an `adsr` array because that path
// honours exact zero values, whereas the individual options fall back to the
// library defaults on a falsy `0`.
//
// The instrument loads lazily on first call; notes are silent while loading
// (typically < 2 seconds on first visit, instant from cache on return). Playback
// resolves the instrument for the *call's* audioCtx, so the same channel renders
// correctly on both the live context and an offline render context.
export function makeGMPlayFn(program) {
  const prog      = Math.max(0, Math.min(127, program))
  const _sustains = gmSustains(prog)

  // Returns the playing voice node (with a `.stop(when)` that runs the release
  // envelope) when started in `hold` mode on a sustaining program, so the caller
  // can release it on note-off. Otherwise returns undefined (fire-and-forget).
  return function playGM(audioCtx, time, params, dest) {
    const {
      pitch = 60, velocity = 1, gate = 0.5, hold = false,
      attack = 0, decay = 0.4, sustain = 0.9, release = 0.3, level = 1,
    } = params

    const inst = getResolved(audioCtx, prog)
    if (!inst) {
      // Not yet decoded for this context — kick off the load; this note is silent.
      preloadGMInstrument(audioCtx, prog)
      return
    }

    const adsr = [
      Math.max(0,     attack),
      Math.max(0.001, decay),
      Math.max(0, Math.min(1, sustain)),
      Math.max(0.001, release),
    ]
    const gain        = Math.max(0.0001, Math.min(2, velocity * 0.85 * level))
    const destination = dest ?? audioCtx.destination

    // Held live note on a continuous voice: loop the sample so it sustains until
    // the key is released (no fixed duration). The returned node's .stop(when)
    // applies the ADSR release tail.
    if (hold && _sustains) {
      return inst.play(pitch, time, { gain, adsr, loop: true, destination })
    }

    inst.play(pitch, time, {
      gain,
      duration: Math.max(0.05, gate),
      adsr,
      destination,
    })
  }
}
