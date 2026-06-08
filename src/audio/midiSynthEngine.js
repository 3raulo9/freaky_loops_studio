// MIDI synthesis engine — 16-channel virtual port router.
//
// Each channel slot (0-15) runs an oscillator-based polyphonic synth whose
// timbre is chosen from the General MIDI category for the active patch.
// Channel 9 (MIDI channel 10) is hard-wired to GM Percussion and routes note
// events through the project's existing synthesized drum voices.
//
// System synth routing: tryConnectSystemSynth() requests Web MIDI access and
// binds to the first available GM/GS output port (preferring Microsoft GS
// Wavetable Synth when present). When connected, every event is mirrored to
// the hardware port so the native DLS bank is used instead of the oscillator
// fallback. Call disconnectSystemSynth() to revert to the oscillator engine.

import { getCategoryForProgram, resolvePatch, resolveOutOfRangePatch } from '../midi/gmDictionary.js'
import { playKick, playSnare, playHiHat, playClash } from './synths.js'

const DRUM_CH   = 9    // 0-indexed MIDI channel 10

// ── Singleton AudioContext + master chain ────────────────────────────────────

let _ctx        = null
let _masterGain = null

export function getAudioContext() {
  if (!_ctx) {
    _ctx = new (window.AudioContext || window.webkitAudioContext)()
    _masterGain = _ctx.createGain()
    _masterGain.gain.value = 0.85
    _masterGain.connect(_ctx.destination)
  }
  if (_ctx.state === 'suspended') _ctx.resume().catch(() => {})
  return _ctx
}

/** Exported master gain node — bind a Knob component directly to this. */
export function getMasterGain() {
  getAudioContext()
  return _masterGain
}

/** Set master output volume (0 = silent, 1 = unity, 1.5 = +3 dB headroom). */
export function setMasterVolume(v) {
  getAudioContext()
  _masterGain.gain.linearRampToValueAtTime(
    Math.max(0, Math.min(1.5, v)),
    _ctx.currentTime + 0.010,
  )
}

// MIDI note number → Hz
function noteToHz(note) {
  return 440 * Math.pow(2, (note - 69) / 12)
}

// ── Oscillator-based polyphonic voice ────────────────────────────────────────
//
// Each voice consists of three oscillators (primary, slightly detuned copy,
// sub-octave) sharing a single ADSR gain envelope node. Voices support
// look-ahead scheduling: `startTime` is an AudioContext timestamp, not "now".

function makeVoice(ctx, dest, freq, waveform, env, velocity, startTime) {
  const t    = startTime
  const peak = Math.max(0.001, Math.min(1.2, velocity * 0.75))
  const atk  = Math.max(env.attack, 0.001)
  const sustainLevel = peak * Math.max(0.001, env.sustain)

  const master = ctx.createGain()
  master.gain.setValueAtTime(0.0001, t)
  master.gain.linearRampToValueAtTime(peak, t + atk)
  master.gain.setValueAtTime(peak, t + atk)
  // Smooth exponential decay toward sustain level
  master.gain.setTargetAtTime(sustainLevel, t + atk, Math.max(0.001, env.decay * 0.35))
  master.connect(dest)

  // Primary oscillator
  const osc = ctx.createOscillator()
  osc.type = waveform
  osc.frequency.value = freq
  osc.connect(master)

  // Detuned copy for width and warmth
  const osc2 = ctx.createOscillator()
  osc2.type = waveform
  osc2.frequency.value = freq
  osc2.detune.value = 8
  const osc2g = ctx.createGain()
  osc2g.gain.value = 0.38
  osc2.connect(osc2g); osc2g.connect(master)

  // Sub-oscillator one octave down for body
  const sub  = ctx.createOscillator()
  sub.type   = 'sine'
  sub.frequency.value = freq / 2
  const subG = ctx.createGain()
  subG.gain.value = waveform === 'sawtooth' ? 0.18 : 0.10
  sub.connect(subG); subG.connect(master)

  osc.start(t); osc2.start(t); sub.start(t)

  return { master, oscs: [osc, osc2, sub], env, sustainLevel, startTime: t }
}

/** Schedule a voice release at `when` (AudioContext time). */
function releaseVoice(voice, when) {
  const rel    = Math.max(0.015, voice.env.release)
  const stopAt = when + rel + 0.04
  voice.master.gain.cancelScheduledValues(when)
  voice.master.gain.setValueAtTime(voice.sustainLevel, when)
  voice.master.gain.exponentialRampToValueAtTime(0.0001, when + rel)
  for (const osc of voice.oscs) {
    try { osc.stop(stopAt) } catch (_) {}
  }
}

/** Hard-cut a voice immediately (for panic). */
function cutVoice(voice, when) {
  voice.master.gain.cancelScheduledValues(when)
  voice.master.gain.setValueAtTime(0, when)
  for (const osc of voice.oscs) {
    try { osc.stop(when + 0.005) } catch (_) {}
  }
}

// ── Channel slot ─────────────────────────────────────────────────────────────

class MidiSynthChannel {
  constructor(index, ctx, masterDest) {
    this.index   = index
    this.isDrum  = index === DRUM_CH
    this.program = 0
    this.volume  = 100   // CC#7 value 0-127
    this.pan     = 64    // CC#10 value 0-127
    this.muted   = false
    this.soloed  = false
    this._voices = new Map()  // note number → voice

    // Per-slot signal chain: gain → analyser → panner → master
    this.gainNode     = ctx.createGain()
    this.analyserNode = ctx.createAnalyser()
    this.pannerNode   = ctx.createStereoPanner()
    this.analyserNode.fftSize = 256

    this.gainNode.gain.value  = this.volume / 127
    this.pannerNode.pan.value = (this.pan - 64) / 64

    this.gainNode.connect(this.analyserNode)
    this.analyserNode.connect(this.pannerNode)
    this.pannerNode.connect(masterDest)
  }

  _category() { return getCategoryForProgram(this.program) }
  _waveform()  { return this._category().waveform }

  /** Trigger a note on. `when` = AudioContext time for look-ahead scheduling. */
  noteOn(ctx, note, velocity, when) {
    if (this.muted) return
    const t = when ?? ctx.currentTime

    // Steal any existing voice on this note before allocating a new one
    if (this._voices.has(note)) {
      releaseVoice(this._voices.get(note), t)
      this._voices.delete(note)
    }

    if (this.isDrum) {
      this._triggerDrum(ctx, note, velocity, t)
      return
    }

    const voice = makeVoice(
      ctx, this.gainNode,
      noteToHz(note),
      this._waveform(),
      this._category(),
      velocity / 127,
      t,
    )
    this._voices.set(note, voice)
  }

  /** Release a held note. `when` = AudioContext time for look-ahead scheduling. */
  noteOff(note, when) {
    const voice = this._voices.get(note)
    if (!voice) return
    releaseVoice(voice, when ?? voice.master.context.currentTime)
    this._voices.delete(note)
  }

  /** Smooth release of all held notes. */
  allNotesOff(when) {
    const t = when ?? this.gainNode.context.currentTime
    for (const note of [...this._voices.keys()]) this.noteOff(note, t)
  }

  /** Instant hard-cut of all held notes (panic). */
  cutAllNotes(when) {
    const t = when ?? this.gainNode.context.currentTime
    for (const voice of this._voices.values()) cutVoice(voice, t)
    this._voices.clear()
  }

  // GM Percussion routing — reuses the project's synthesized drum voices so
  // channel 9 produces the same quality as the main sequencer's drum tracks.
  _triggerDrum(ctx, note, velocity, when) {
    const vel  = velocity / 127
    const dest = this.gainNode

    if      (note === 35 || note === 36)               playKick(ctx, when, { pitch: 55, decay: 0.52, punch: 0.7,  velocity: vel }, dest)
    else if (note === 38 || note === 40)               playSnare(ctx, when, { snap: 0.65, decay: 0.27,             velocity: vel }, dest)
    else if (note === 37 || note === 39)               playSnare(ctx, when, { snap: 0.4, tone: 300, decay: 0.18,  velocity: vel * 0.75 }, dest)
    else if ([41,43,45,47,48,50].includes(note)) {
      // Floor/mid/high toms as pitched kick variants
      const pitch = 40 + (note - 41) * 4
      playKick(ctx, when, { pitch, decay: 0.25, punch: 0.5, velocity: vel }, dest)
    }
    else if (note === 42 || note === 44)               playHiHat(ctx, when, { decay: 0.06,  velocity: vel }, dest)
    else if (note === 46)                              playHiHat(ctx, when, { decay: 0.35,  velocity: vel }, dest)
    else if ([49,52,55,57].includes(note))             playClash(ctx, when, {               velocity: vel }, dest)
    else if ([51,53,59].includes(note))                playClash(ctx, when, { decay: 1.4,   velocity: vel * 0.45 }, dest)
    else {
      // Unrecognised percussion note → short sine ping at appropriate pitch
      const osc = ctx.createOscillator()
      const g   = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = noteToHz(note)
      g.gain.setValueAtTime(vel * 0.5, when)
      g.gain.exponentialRampToValueAtTime(0.0001, when + 0.3)
      osc.connect(g); g.connect(dest)
      osc.start(when); osc.stop(when + 0.35)
    }
  }

  /** Set channel volume from a CC#7 value (0-127). */
  setVolume(val) {
    this.volume = Math.max(0, Math.min(127, val))
    if (!this.muted) this.gainNode.gain.value = this.volume / 127
  }

  /** Set stereo pan from a CC#10 value (0-127, 64 = centre). */
  setPan(val) {
    this.pan = Math.max(0, Math.min(127, val))
    this.pannerNode.pan.value = (this.pan - 64) / 64
  }

  setMuted(muted) {
    this.muted = muted
    this.gainNode.gain.value = muted ? 0 : this.volume / 127
    if (muted) this.allNotesOff()
  }

  /** Peak signal level 0-1, read from the slot's AnalyserNode (for VU meter). */
  getPeakLevel() {
    const buf = new Uint8Array(this.analyserNode.frequencyBinCount)
    this.analyserNode.getByteTimeDomainData(buf)
    let peak = 0
    for (const s of buf) {
      const v = Math.abs((s - 128) / 128)
      if (v > peak) peak = v
    }
    return peak
  }
}

// ── Web MIDI system synth hook ───────────────────────────────────────────────

let _midiOutput = null

/**
 * Request Web MIDI access and bind to the Microsoft GS Wavetable Synth or
 * the first available GM/GS output.  When bound, note events are mirrored to
 * the hardware port so the native DLS bank is used as the primary voice source.
 * Returns the port name on success, null when unavailable.
 */
export async function tryConnectSystemSynth() {
  if (!navigator.requestMIDIAccess) return null
  try {
    const access  = await navigator.requestMIDIAccess({ sysex: false })
    const outputs = [...access.outputs.values()]
    const port    = outputs.find(o =>
      /wavetable|microsoft\s*gs|general\s*midi|gm\s*synth|gs\s*synth/i.test(o.name)
    ) ?? outputs[0] ?? null
    _midiOutput = port
    if (port) console.info('[MIDI-SYNTH] System synth connected:', port.name)
    return port?.name ?? null
  } catch (e) {
    console.warn('[MIDI-SYNTH] Web MIDI unavailable:', e.message)
    return null
  }
}

/** Revert to the oscillator engine exclusively. */
export function disconnectSystemSynth() {
  _midiOutput = null
}

function _sendMidi(bytes) {
  if (_midiOutput) { try { _midiOutput.send(bytes) } catch (_) {} }
}

// ── Singleton slot array ──────────────────────────────────────────────────────

let _slots = null

function ensureSlots() {
  if (_slots) return _slots
  const ctx = getAudioContext()
  const mg  = getMasterGain()
  _slots = Array.from({ length: 16 }, (_, i) => new MidiSynthChannel(i, ctx, mg))
  return _slots
}

export function getSlots()  { return ensureSlots() }
export function getSlot(ch) { return ensureSlots()[Math.max(0, Math.min(15, ch))] }

// ── Public event API ──────────────────────────────────────────────────────────

/** Trigger a Note On. `when` = AudioContext time (optional; defaults to now). */
export function engineNoteOn(channel, note, velocity, when) {
  getSlot(channel).noteOn(getAudioContext(), note, velocity, when)
  _sendMidi([0x90 | (channel & 0xF), note & 0x7F, velocity & 0x7F])
}

/** Trigger a Note Off. `when` = AudioContext time (optional; defaults to now). */
export function engineNoteOff(channel, note, when) {
  getSlot(channel).noteOff(note, when)
  _sendMidi([0x80 | (channel & 0xF), note & 0x7F, 0])
}

/** Process a Control Change event. Applied immediately (no look-ahead). */
export function engineControlChange(channel, cc, value) {
  const slot = getSlot(channel)
  if (cc === 7)  slot.setVolume(value)
  if (cc === 10) slot.setPan(value)
  _sendMidi([0xB0 | (channel & 0xF), cc & 0x7F, value & 0x7F])
}

/**
 * Set the active patch for a channel slot.
 *
 * `bankMSB` is the Bank Select MSB (CC#0) value active at the time of the
 * Program Change.  If bankMSB != 0 the patch is in a non-standard GS/XG bank;
 * the resolver maps it to the canonical GM fallback for that instrument category
 * (e.g. a GS Sawtooth Lead extension → GM Lead 2 Sawtooth, prog 81).
 *
 * Channel 9 (MIDI ch 10) ignores program changes — it is always GM Percussion.
 */
export function engineProgramChange(channel, program, bankMSB = 0) {
  if (channel === DRUM_CH) return  // percussion slot is fixed
  const resolved = program > 127
    ? resolveOutOfRangePatch(program)
    : resolvePatch(program, bankMSB)
  getSlot(channel).program = resolved
  _sendMidi([0xC0 | (channel & 0xF), resolved & 0x7F])
}

/**
 * Manually overwrite a channel's patch from the 128 standard GM programs.
 * This is the user-facing configuration method — bypasses bank fallback logic.
 */
export function setChannelPatch(channel, program) {
  const prog = Math.max(0, Math.min(127, program))
  if (channel !== DRUM_CH) getSlot(channel).program = prog
  _sendMidi([0xC0 | (channel & 0xF), prog & 0x7F])
}

/**
 * Instant MIDI panic — hard-cuts all active voices on all channels and resets
 * each slot's gain node. Safe to call during playback or on transport stop.
 */
export function enginePanic() {
  if (!_slots) return
  const ctx = getAudioContext()
  const now = ctx.currentTime
  for (const slot of _slots) {
    slot.cutAllNotes(now)
    // Momentary gain-to-zero then restore so any lingering reverb tails are killed
    slot.gainNode.gain.cancelScheduledValues(now)
    slot.gainNode.gain.setValueAtTime(0, now)
    slot.gainNode.gain.linearRampToValueAtTime(
      slot.muted ? 0 : slot.volume / 127,
      now + 0.04,
    )
  }
}
