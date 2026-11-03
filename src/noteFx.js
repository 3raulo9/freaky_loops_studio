// Note FX: per-channel note effects that sit between the sequencer and the
// instrument — chance, velocity, transpose, scale lock and chords (the
// arpeggiator then plays whatever this produces). Settings live in the
// channel's params (fx*), so they save and load with the project.

export const CHORD_TYPES = {
  major:  { label: 'Major',      steps: [0, 4, 7] },
  minor:  { label: 'Minor',      steps: [0, 3, 7] },
  dim:    { label: 'Diminished', steps: [0, 3, 6] },
  aug:    { label: 'Augmented',  steps: [0, 4, 8] },
  sus2:   { label: 'Sus 2',      steps: [0, 2, 7] },
  sus4:   { label: 'Sus 4',      steps: [0, 5, 7] },
  maj7:   { label: 'Major 7',    steps: [0, 4, 7, 11] },
  min7:   { label: 'Minor 7',    steps: [0, 3, 7, 10] },
  dom7:   { label: 'Dominant 7', steps: [0, 4, 7, 10] },
  add9:   { label: 'Add 9',      steps: [0, 4, 7, 14] },
  min9:   { label: 'Minor 9',    steps: [0, 3, 7, 10, 14] },
  power:  { label: 'Power (5)',  steps: [0, 7, 12] },
  octave: { label: 'Octaves',    steps: [0, 12] },
}

// Chords built from the channel's scale (stacked thirds of the scale), so every
// key you play gives an in-key chord.
export const DIATONIC_CHORDS = {
  triad:   { label: 'Diatonic triad', degrees: [0, 2, 4] },
  seventh: { label: 'Diatonic 7th',   degrees: [0, 2, 4, 6] },
  ninth:   { label: 'Diatonic 9th',   degrees: [0, 2, 4, 6, 8] },
}

const MAJOR = [0, 2, 4, 5, 7, 9, 11]

/** Nearest in-scale pitch (ties go down). */
export function snapToScale(pitch, root, intervals = MAJOR) {
  const inScale = p => intervals.includes(((p - root) % 12 + 12) % 12)
  if (inScale(pitch)) return pitch
  for (let d = 1; d < 12; d++) {
    if (inScale(pitch - d)) return pitch - d
    if (inScale(pitch + d)) return pitch + d
  }
  return pitch
}

function rotate(steps, inversion) {
  const out = [...steps]
  for (let i = 0; i < (inversion || 0) % out.length; i++) out.push(out.shift() + 12)
  return out
}

/** Semitone offsets of the chord `type` on `pitch` (diatonic types need a scale). */
export function chordOffsets(type, pitch, { inversion = 0, root = 0, intervals = MAJOR } = {}) {
  if (CHORD_TYPES[type]) return rotate(CHORD_TYPES[type].steps, inversion)
  const dia = DIATONIC_CHORDS[type]
  if (!dia) return [0]
  // Degree of the (scale-snapped) pitch, then stack scale degrees on it.
  const scale = [...intervals].sort((a, b) => a - b)
  const rel = ((pitch - root) % 12 + 12) % 12
  let deg = scale.indexOf(rel)
  if (deg < 0) deg = 0
  const offsets = dia.degrees.map(d => {
    const i = deg + d
    const oct = Math.floor(i / scale.length)
    return scale[i % scale.length] + 12 * oct - scale[deg]
  })
  return rotate(offsets, inversion)
}

/** True when any note effect would change what a channel plays. */
export function hasNoteFx(p) {
  return !!p && (
    (p.fxChance != null && p.fxChance < 1) ||
    (p.fxVelMode && p.fxVelMode !== 'off') || !!p.fxVelRandom ||
    !!p.fxTranspose ||
    (p.fxScale && p.fxScale !== 'off') ||
    (p.fxChord && p.fxChord !== 'off')
  )
}

/**
 * Apply a channel's note FX to one note. Returns the notes to play
 * ([{ pitch, velocity }]) — empty when the chance roll drops it.
 * `scales` is the SCALE_DEFS table (name → intervals).
 */
export function applyNoteFx(p, pitch, velocity, scales, rand = Math.random) {
  if (!hasNoteFx(p)) return [{ pitch, velocity }]
  if (p.fxChance != null && p.fxChance < 1 && rand() >= p.fxChance) return []

  let vel = velocity
  if (p.fxVelMode === 'fixed') vel = p.fxVel ?? 0.8
  else if (p.fxVelMode === 'scale') vel = vel * (p.fxVel ?? 1)
  if (p.fxVelRandom) vel *= 1 - rand() * p.fxVelRandom
  vel = Math.max(0.01, Math.min(1, vel))

  const root = p.fxScaleRoot ?? 0
  const intervals = (p.fxScale && p.fxScale !== 'off' && scales?.[p.fxScale]) || MAJOR
  let base = pitch + (p.fxTranspose ?? 0)
  // Scale lock — and diatonic chords need an in-scale root to build on.
  if ((p.fxScale && p.fxScale !== 'off') || DIATONIC_CHORDS[p.fxChord]) base = snapToScale(base, root, intervals)

  const offsets = p.fxChord && p.fxChord !== 'off'
    ? chordOffsets(p.fxChord, base, { inversion: p.fxChordInv ?? 0, root, intervals })
    : [0]
  return offsets
    .map(o => base + o)
    .filter(n => n >= 0 && n <= 127)
    .map(n => ({ pitch: n, velocity: vel }))
}
