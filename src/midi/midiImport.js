// Convert a parsed MIDI file into channel-rack track descriptors.
//
// Each MIDI channel becomes a track with:
//   - fmKey:    key into FM_PRESETS (closest matching synth sound)
//   - drumType: 'kick'|'snare'|'hihat'|'clash' (only for channel 9 groups)
//   - notes:    pianoNotes-format array ready for patternData
//
// Tick conversion: MIDI ticks → project ticks at 480 PPQ
//   projTick = round(midiTick × 480 / midiTicksPerBeat)

import { GM_INSTRUMENTS, getCategoryForProgram } from './gmDictionary.js'

const PROJ_TPB = 480 // TICKS_PER_STEP (120) × 4 steps per beat

// ── GM program (0–127) → FM_PRESETS key ─────────────────────────────────────
// Maps each General MIDI program to the closest synthesized equivalent
// available in FM_PRESETS.
const GM_TO_FM_KEY = [
  // 0-7   Piano
  'rhodes','rhodes','wurly','clav','rhodes','wurly','clav','clav',
  // 8-15  Chromatic Percussion
  'celeste','glocken','bell','vibe','marimba','xylophone','bell','kalimba',
  // 16-23 Organ
  'organ','organ','organ','organ','organ','organ','harmonica','organ',
  // 24-31 Guitar
  'guitar','guitar','guitar','guitar','distgtr','distgtr','distgtr','guitar',
  // 32-39 Bass
  'bass','bass','bass','bass','bass','bass','moog','moog',
  // 40-47 Strings
  'strings','strings','cello','cello','strings','strings','pluck','timpani',
  // 48-55 Ensemble
  'strings','strings','strings','strings','choir','choir','pad','brass',
  // 56-63 Brass
  'trumpet','brass','brass','trumpet','brass','brass','brass','brass',
  // 64-71 Reed
  'clarinet','clarinet','clarinet','clarinet','oboe','oboe','oboe','clarinet',
  // 72-79 Pipe
  'flute','flute','flute','flute','flute','flute','flute','flute',
  // 80-87 Synth Lead
  'moog','moog','flute','moog','moog','choir','moog','moog',
  // 88-95 Synth Pad
  'pad','pad','pad','choir','pad','pad','pad','pad',
  // 96-103 Synth FX
  'pad','pad','pad','pad','pad','wobble','wobble','wobble',
  // 104-111 Ethnic
  'sitar','pluck','pluck','koto','kalimba','organ','strings','oboe',
  // 112-119 Percussive
  'bell','bell','steeldrum','marimba','marimba','marimba','bass','pad',
  // 120-127 Sound Effects
  'pad','pad','pad','pad','bell','pad','pad','pad',
]

// MIDI channel 9 percussion notes → drum channel group
const DRUM_GROUPS = [
  { name: 'KICK',  drumType: 'kick',  notes: new Set([35, 36]) },
  { name: 'SNARE', drumType: 'snare', notes: new Set([37, 38, 39, 40]) },
  { name: 'HIHAT', drumType: 'hihat', notes: new Set([42, 44, 46]) },
  { name: 'CLASH', drumType: 'clash', notes: new Set([49, 52, 55, 57]) },
]

// Pair raw noteOn/noteOff events into pianoNotes format.
// fixedPitch: override pitch for all notes (used for drum channels).
function pairNotes(events, ticksPerBeat, fixedPitch = null) {
  const ratio  = PROJ_TPB / ticksPerBeat
  const active = new Map() // note → { startTick, velocity }
  const notes  = []

  for (const ev of events) {
    const projTick = Math.round(ev.tick * ratio)

    if (ev.type === 'noteOn' && ev.velocity > 0) {
      active.set(ev.note, { startTick: projTick, velocity: ev.velocity / 127 })
    } else if (ev.type === 'noteOff' || (ev.type === 'noteOn' && ev.velocity === 0)) {
      const start = active.get(ev.note)
      if (start) {
        notes.push({
          startTick:     start.startTick,
          pitch:         fixedPitch ?? ev.note,
          velocity:      Math.round(start.velocity * 100) / 100,
          durationTicks: Math.max(60, projTick - start.startTick),
        })
        active.delete(ev.note)
      }
    }
  }

  // Close notes with no matching noteOff (truncated files)
  for (const [note, start] of active) {
    notes.push({
      startTick:     start.startTick,
      pitch:         fixedPitch ?? note,
      velocity:      Math.round(start.velocity * 100) / 100,
      durationTicks: PROJ_TPB,
    })
  }

  return notes.sort((a, b) => a.startTick - b.startTick)
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Convert a `parseMidi()` result into channel-rack track descriptors.
 *
 * Returns:
 *   { bpm, patternName, tracks: Array<TrackDescriptor> }
 *
 * TrackDescriptor:
 *   { name, fmKey, drumType?, notes }
 *
 * `fmKey`    — key into FM_PRESETS for melodic tracks
 * `drumType` — 'kick'|'snare'|'hihat'|'clash' (only on drum group tracks)
 * `notes`    — pianoNotes array (startTick, pitch, velocity, durationTicks)
 */
export function convertMidiToTracks(parsed, filename = 'MIDI IMPORT') {
  const primaryUs = parsed.tempoMap[0]?.us ?? 500_000
  const bpm = Math.max(40, Math.min(300, Math.round(60_000_000 / primaryUs)))
  const { ticksPerBeat, channels, activeChannels } = parsed
  const tracks = []

  for (const ch of channels) {
    if (!activeChannels.has(ch.index)) continue

    const noteEvents = ch.events.filter(e => e.type === 'noteOn' || e.type === 'noteOff')
    if (noteEvents.length === 0) continue

    if (ch.index === 9) {
      // Drum channel — split into per-family tracks
      const usedNotes = new Set()

      for (const grp of DRUM_GROUPS) {
        const evs = noteEvents.filter(e => grp.notes.has(e.note))
        if (evs.length === 0) continue
        const notes = pairNotes(evs, ticksPerBeat, 60) // fixed pitch = neutral drum tuning
        if (notes.length === 0) continue
        grp.notes.forEach(n => usedNotes.add(n))
        tracks.push({ name: grp.name, drumType: grp.drumType, notes })
      }

      // Remaining percussion → PERC (melodic, uses marimba as closest GM perc)
      const remaining = noteEvents.filter(e => !usedNotes.has(e.note))
      if (remaining.length > 0) {
        const notes = pairNotes(remaining, ticksPerBeat)
        if (notes.length > 0) tracks.push({ name: 'PERC', fmKey: 'marimba', notes })
      }
    } else {
      // Melodic channel
      const prog   = Math.max(0, Math.min(127, ch.program ?? 0))
      const fmKey  = GM_TO_FM_KEY[prog] ?? 'pad'
      // Short display name: first word of GM instrument name
      const name = (GM_INSTRUMENTS[prog] ?? 'SYNTH')
        .split(/[\s(]/)[0]
        .toUpperCase()
        .slice(0, 10)

      const notes = pairNotes(noteEvents, ticksPerBeat)
      if (notes.length > 0) tracks.push({ name, fmKey, notes })
    }
  }

  const patternName = filename
    .replace(/\.(mid|midi)$/i, '')
    .slice(0, 20)
    .toUpperCase()
    || 'MIDI IMPORT'

  return { bpm, patternName, tracks }
}
