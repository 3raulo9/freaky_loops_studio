// Web Audio look-ahead MIDI event scheduler.
//
// Events are pre-scheduled LOOKAHEAD seconds into the AudioContext timeline so
// Note On / Note Off land with sample-accurate timing regardless of setTimeout
// drift.  Control changes and program changes are applied immediately since they
// do not require audio-accurate scheduling.

import {
  getAudioContext,
  engineNoteOn, engineNoteOff,
  engineControlChange, engineProgramChange,
  enginePanic,
} from '../audio/midiSynthEngine.js'
import { buildTimeline, getMidiDuration } from './midiParser.js'

const LOOKAHEAD   = 0.12   // seconds of events to schedule ahead of "now"
const SCHEDULE_MS = 25     // scheduler poll interval in milliseconds

let _timeline     = []
let _pointer      = 0
let _playing      = false
let _startCtxTime = 0      // ctx.currentTime at the moment play() was called
let _startOffset  = 0      // file-time (seconds) that maps to _startCtxTime
let _duration     = 0
let _timerId      = null
let _onEnd        = null   // optional callback fired when the file finishes

/** Current playback position in file-seconds. */
export function getPlaybackTime() {
  if (!_playing) return _startOffset
  return _startOffset + (getAudioContext().currentTime - _startCtxTime)
}

export function getDuration()  { return _duration }
export function isPlaying()    { return _playing }

/**
 * Load a parsed MIDI file.  Pre-applies initial slot configuration (program,
 * volume, pan) derived from the first CC/PC events in each channel, then
 * builds the flat sorted event timeline.
 */
export function loadMidi(parsedMidi) {
  stop()
  _timeline = buildTimeline(parsedMidi)
  _duration = getMidiDuration(parsedMidi)

  // Prime each slot from the snapshot values captured by the parser
  const { channels } = parsedMidi
  for (let ch = 0; ch < 16; ch++) {
    const info = channels[ch]
    // bankMSB is 0 for standard GM files; non-zero triggers category fallback
    engineProgramChange(ch, info.program ?? 0, info.bankMSB ?? 0)
    engineControlChange(ch, 7,  info.volume ?? 100)
    engineControlChange(ch, 10, info.pan    ?? 64)
  }
}

function _scheduleLoop() {
  if (!_playing) return

  const ctx           = getAudioContext()
  const ctxNow        = ctx.currentTime
  const fileNow       = _startOffset + (ctxNow - _startCtxTime)
  const scheduleUntil = fileNow + LOOKAHEAD
  const ctxBase       = _startCtxTime - _startOffset  // file-t=0 → ctx time

  while (_pointer < _timeline.length) {
    const ev = _timeline[_pointer]
    if (ev.time > scheduleUntil) break
    _pointer++

    const when = ctxBase + ev.time  // absolute AudioContext time for this event

    // Skip events already in the past (can happen after a seek or startup lag)
    if (when < ctxNow - 0.02) continue

    switch (ev.type) {
      case 'noteOn':
        engineNoteOn(ev.channel, ev.note, ev.velocity, when)
        break
      case 'noteOff':
        engineNoteOff(ev.channel, ev.note, when)
        break
      case 'controlChange':
        // CC events don't need sample-accurate scheduling
        engineControlChange(ev.channel, ev.cc, ev.value)
        break
      case 'programChange':
        // Bank MSB is carried on the event from the parser so fallback logic works mid-song
        engineProgramChange(ev.channel, ev.program, ev.bankMSB ?? 0)
        break
    }
  }

  // All events dispatched — wait for the last note to decay, then fire onEnd
  if (_pointer >= _timeline.length) {
    const remaining = Math.max(0, _duration - fileNow)
    _timerId = setTimeout(() => {
      _playing = false
      enginePanic()
      if (_onEnd) _onEnd()
    }, (remaining + 0.5) * 1000)
    return
  }

  _timerId = setTimeout(_scheduleLoop, SCHEDULE_MS)
}

/**
 * Start playback from `offsetSeconds` into the file.
 * @param {number}   offsetSeconds  Starting position (default 0)
 * @param {Function} onEnd          Optional callback when the file finishes
 */
export function play(offsetSeconds = 0, onEnd = null) {
  stop()

  _playing      = true
  _startOffset  = Math.max(0, offsetSeconds)
  _startCtxTime = getAudioContext().currentTime
  _onEnd        = onEnd

  // Seek the event pointer to the first event at or after the start position
  _pointer = _timeline.findIndex(ev => ev.time >= _startOffset)
  if (_pointer < 0) _pointer = _timeline.length

  _scheduleLoop()
}

/** Stop playback and silence all voices immediately. */
export function stop() {
  _playing = false
  if (_timerId !== null) { clearTimeout(_timerId); _timerId = null }
  enginePanic()
}

/**
 * Pause playback and store the current position.
 * Call resume() to continue from the same position.
 * @returns {number} The file position in seconds where playback was paused.
 */
export function pause() {
  const pos = getPlaybackTime()
  stop()
  _startOffset = pos  // preserve position; enginePanic() is called inside stop()
  _playing     = false
  return pos
}

/** Resume from the position stored by the last pause(). */
export function resume() {
  play(_startOffset, _onEnd)
}
