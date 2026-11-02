// Piano roll batch tools. Pure functions over note objects
// ({ pitch, startTick, durationTicks, velocity, ... }) so they're easy to reason
// about and test. Tools either edit the given notes in place, or return
// { remove, add } when they replace notes (arpeggiate, chop, chordify).

import { CHORD_TYPES } from '../noteFx.js'

const MIN_LEN = 10

const len = n => n.durationTicks ?? 120
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

/** Pull note starts (and optionally lengths) toward the grid by `strength` (0..1). */
export function quantize(notes, { grid = 120, strength = 1, ends = false } = {}) {
  for (const n of notes) {
    const target = Math.round(n.startTick / grid) * grid
    n.startTick = Math.max(0, Math.round(n.startTick + (target - n.startTick) * strength))
    if (ends) {
      const end = n.startTick + len(n)
      const endTarget = Math.max(n.startTick + grid, Math.round(end / grid) * grid)
      n.durationTicks = Math.max(MIN_LEN, Math.round(len(n) + (endTarget - end) * strength))
    }
  }
}

/** Random timing / velocity / length variation, for a played-in feel. */
export function humanize(notes, { timing = 12, velocity = 0.1, length = 0.1 } = {}, rand = Math.random) {
  const jitter = amt => (rand() * 2 - 1) * amt
  for (const n of notes) {
    n.startTick = Math.max(0, Math.round(n.startTick + jitter(timing)))
    n.velocity = clamp((n.velocity ?? 0.8) + jitter(velocity), 0.05, 1)
    n.durationTicks = Math.max(MIN_LEN, Math.round(len(n) * (1 + jitter(length))))
  }
}

// Notes that start together (within `tol` ticks) form one chord.
function chords(notes, tol = 4) {
  const sorted = [...notes].sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch)
  const out = []
  for (const n of sorted) {
    const last = out[out.length - 1]
    if (last && n.startTick - last[0].startTick <= tol) last.push(n)
    else out.push([n])
  }
  return out
}

/** Offset each chord's notes in time like a strummed guitar. */
export function strum(notes, { step = 30, direction = 'up', velTilt = 0 } = {}) {
  chords(notes).forEach((chord, ci) => {
    if (chord.length < 2) return
    const down = direction === 'down' || (direction === 'alt' && ci % 2 === 1)
    const ordered = [...chord].sort((a, b) => down ? b.pitch - a.pitch : a.pitch - b.pitch)
    const start = Math.min(...chord.map(n => n.startTick))
    const end = Math.max(...chord.map(n => n.startTick + len(n)))
    ordered.forEach((n, i) => {
      n.startTick = start + i * step
      n.durationTicks = Math.max(MIN_LEN, end - n.startTick)
      if (velTilt) n.velocity = clamp((n.velocity ?? 0.8) * (1 - velTilt * i / ordered.length), 0.05, 1)
    })
  })
}

/** Turn each chord into a run of single notes across the chord's length. */
export function arpeggiate(notes, { rate = 120, pattern = 'up', gate = 0.9, range = 1 } = {}, rand = Math.random) {
  const remove = [], add = []
  for (const chord of chords(notes)) {
    const start = chord[0].startTick
    const span = Math.max(...chord.map(n => n.startTick + len(n))) - start
    const base = [...new Set(chord.map(n => n.pitch))].sort((a, b) => a - b)
    let ladder = []
    for (let o = 0; o < range; o++) ladder.push(...base.map(p => p + 12 * o))
    ladder = ladder.filter(p => p <= 127)
    if (pattern === 'down') ladder.reverse()
    else if (pattern === 'updown' && ladder.length > 2) ladder = [...ladder, ...ladder.slice(1, -1).reverse()]
    const proto = chord[0]
    const count = Math.max(1, Math.floor(span / rate))
    for (let i = 0; i < count; i++) {
      const pitch = pattern === 'random' ? ladder[Math.floor(rand() * ladder.length)] : ladder[i % ladder.length]
      add.push({ ...proto, pitch, startTick: start + i * rate, durationTicks: Math.max(MIN_LEN, Math.round(rate * gate)) })
    }
    remove.push(...chord)
  }
  return { remove, add }
}

/** Split every note into back-to-back pieces of `length` ticks. */
export function chop(notes, { length = 120 } = {}) {
  const remove = [], add = []
  for (const n of notes) {
    if (len(n) <= length) continue
    remove.push(n)
    for (let t = 0; t < len(n); t += length) {
      add.push({ ...n, startTick: n.startTick + t, durationTicks: Math.min(length, len(n) - t) })
    }
  }
  return { remove, add }
}

/** Mirror the notes in time within their own span. */
export function flipHorizontal(notes) {
  if (!notes.length) return
  const start = Math.min(...notes.map(n => n.startTick))
  const end = Math.max(...notes.map(n => n.startTick + len(n)))
  for (const n of notes) n.startTick = start + (end - (n.startTick + len(n)))
}

/** Mirror the notes in pitch around the middle of their range. */
export function flipVertical(notes) {
  if (!notes.length) return
  const lo = Math.min(...notes.map(n => n.pitch))
  const hi = Math.max(...notes.map(n => n.pitch))
  for (const n of notes) n.pitch = clamp(lo + hi - n.pitch, 0, 127)
}

/** Move every out-of-scale note to the nearest scale degree. */
export function fitToScale(notes, tonic = 0, intervals = [0, 2, 4, 5, 7, 9, 11]) {
  const inScale = p => intervals.includes(((p - tonic) % 12 + 12) % 12)
  for (const n of notes) {
    if (inScale(n.pitch)) continue
    for (let d = 1; d < 12; d++) {
      if (n.pitch - d >= 0 && inScale(n.pitch - d)) { n.pitch -= d; break }
      if (n.pitch + d <= 127 && inScale(n.pitch + d)) { n.pitch += d; break }
    }
  }
}

export { CHORD_TYPES }

/** Build a chord on every note (it becomes the root), with optional inversion. */
export function chordify(notes, { type = 'major', inversion = 0 } = {}) {
  const steps = [...(CHORD_TYPES[type]?.steps ?? CHORD_TYPES.major.steps)]
  for (let i = 0; i < inversion % steps.length; i++) steps.push(steps.shift() + 12)
  const add = []
  for (const n of notes) {
    // The original note becomes the lowest chord tone; the rest are added.
    const root = n.pitch
    n.pitch = clamp(root + steps[0], 0, 127)
    for (const s of steps.slice(1)) {
      if (root + s <= 127) add.push({ ...n, pitch: root + s })
    }
  }
  return { remove: [], add }
}

/** Velocity ramp from `from` to `to` across the notes in time order. */
export function velocityRamp(notes, { from = 0.3, to = 1, curve = 1 } = {}) {
  const sorted = [...notes].sort((a, b) => a.startTick - b.startTick)
  const n = sorted.length
  sorted.forEach((note, i) => {
    const t = n > 1 ? Math.pow(i / (n - 1), curve) : 1
    note.velocity = clamp(from + (to - from) * t, 0.01, 1)
  })
}

/** Probability (0..1) that each note plays on a given pass. */
export function setChance(notes, { chance = 1 } = {}) {
  for (const n of notes) {
    if (chance >= 1) delete n.chance
    else n.chance = clamp(chance, 0, 1)
  }
}

// Dialog definitions for the piano roll Tools menu: each tool's parameters.
export const TOOL_DEFS = [
  { id: 'quantize', label: 'Quantize…', params: [
    { key: 'grid', label: 'Grid', type: 'grid', def: 120 },
    { key: 'strength', label: 'Strength', type: 'pct', def: 1 },
    { key: 'ends', label: 'Also quantize note ends', type: 'bool', def: false },
  ] },
  { id: 'humanize', label: 'Humanize…', params: [
    { key: 'timing', label: 'Timing ± (ticks)', type: 'range', min: 0, max: 60, step: 1, def: 12 },
    { key: 'velocity', label: 'Velocity ±', type: 'pct', def: 0.1 },
    { key: 'length', label: 'Length ±', type: 'pct', def: 0.1 },
  ] },
  { id: 'strum', label: 'Strum…', params: [
    { key: 'step', label: 'Delay per note (ticks)', type: 'range', min: 5, max: 240, step: 5, def: 30 },
    { key: 'direction', label: 'Direction', type: 'select', options: { up: 'Up', down: 'Down', alt: 'Alternate' }, def: 'up' },
    { key: 'velTilt', label: 'Velocity fall-off', type: 'pct', def: 0.2 },
  ] },
  { id: 'arpeggiate', label: 'Arpeggiate…', params: [
    { key: 'rate', label: 'Rate', type: 'grid', def: 120 },
    { key: 'pattern', label: 'Pattern', type: 'select', options: { up: 'Up', down: 'Down', updown: 'Up & down', random: 'Random' }, def: 'up' },
    { key: 'gate', label: 'Gate', type: 'pct', def: 0.9 },
    { key: 'range', label: 'Octaves', type: 'range', min: 1, max: 4, step: 1, def: 1 },
  ] },
  { id: 'chop', label: 'Chop…', params: [
    { key: 'length', label: 'Piece length', type: 'grid', def: 120 },
  ] },
  { id: 'chordify', label: 'Make chords…', params: [
    { key: 'type', label: 'Chord', type: 'select', options: Object.fromEntries(Object.entries(CHORD_TYPES).map(([k, v]) => [k, v.label])), def: 'major' },
    { key: 'inversion', label: 'Inversion', type: 'range', min: 0, max: 3, step: 1, def: 0 },
  ] },
  { id: 'velocityRamp', label: 'Velocity ramp…', params: [
    { key: 'from', label: 'Start velocity', type: 'pct', def: 0.3 },
    { key: 'to', label: 'End velocity', type: 'pct', def: 1 },
    { key: 'curve', label: 'Curve', type: 'range', min: 0.25, max: 4, step: 0.25, def: 1 },
  ] },
  { id: 'chance', label: 'Note chance…', params: [
    { key: 'chance', label: 'Chance to play', type: 'pct', def: 0.5 },
  ] },
  { sep: true },
  { id: 'fitToScale', label: 'Fit to scale' },
  { id: 'flipH', label: 'Flip horizontally' },
  { id: 'flipV', label: 'Flip vertically' },
]

/** Run tool `id` over `notes`; returns { remove, add } (possibly empty). */
export function runTool(id, notes, opts = {}, scale = { tonic: 0, intervals: undefined }) {
  const none = { remove: [], add: [] }
  switch (id) {
    case 'quantize': quantize(notes, opts); return none
    case 'humanize': humanize(notes, opts); return none
    case 'strum': strum(notes, opts); return none
    case 'arpeggiate': return arpeggiate(notes, opts)
    case 'chop': return chop(notes, opts)
    case 'chordify': return chordify(notes, opts)
    case 'velocityRamp': velocityRamp(notes, opts); return none
    case 'chance': setChance(notes, opts); return none
    case 'fitToScale': fitToScale(notes, scale.tonic, scale.intervals); return none
    case 'flipH': flipHorizontal(notes); return none
    case 'flipV': flipVertical(notes); return none
    default: return none
  }
}
