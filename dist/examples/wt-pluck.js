// ── WT Pluck ──────────────────────────────────────────────────────────────────
// Serum-style wavetable pluck. WT position starts at 1.0 (sawtooth — bright,
// complex) on note attack and decays rapidly to 0.0 (sine — pure, dark).
// The amplitude decays much more slowly, creating a pluck-style timbre shift.
//
// Serum features: WT position envelope · note_off is ignored (one-shot decay)
//                 filter tracks WT pos · polyphonic

let sampleRate = 44100
const PI2 = 2 * Math.PI

// Wavetable: pos 0 = sine, pos 1 = sawtooth
function wt(phase, pos) {
  const p = phase - Math.floor(phase)
  const sine = Math.sin(PI2 * p)
  const saw  = 1 - 2 * p
  return sine * (1 - pos) + saw * pos
}

const voices = new Map()

function init(sr) { sampleRate = sr }
function midiFreq(m) { return 440 * Math.pow(2, (m - 69) / 12) }

function note_on(pitch, velocity) {
  const vel = velocity / 127
  voices.set(pitch, {
    f:     midiFreq(pitch),
    ph:    0,
    env:   vel * 0.75,
    wtPos: 1.0,            // starts bright (sawtooth end of table)
    flp:   0, fbp: 0,
    // Decay rates: WT position decays fast (timbre shift), amplitude decays slow
    envDec:  Math.pow(0.001, 1 / (sampleRate * (0.4 + vel * 1.5))),
    wtDec:   Math.pow(0.001, 1 / (sampleRate * 0.08)),  // 80ms timbre decay
  })
}

function note_off(_pitch) { /* one-shot: ride out the natural decay */ }

function process(L, R) {
  L.fill(0); R.fill(0)
  for (const [pitch, v] of [...voices]) {
    // Filter cutoff follows WT position — bright at attack, dark as it decays
    const cfHz = 200 + v.wtPos * 6000
    const fc   = 2 * Math.sin(Math.PI * Math.min(cfHz / sampleRate, 0.499))
    const q    = 0.5

    for (let i = 0; i < L.length; i++) {
      const raw = wt(v.ph, v.wtPos) * v.env
      v.ph += v.f / sampleRate

      v.env  *= v.envDec
      v.wtPos = Math.max(0, v.wtPos * v.wtDec)  // fast timbre decay

      // State-variable lowpass
      v.flp += fc * v.fbp
      const hp = raw - v.flp - q * v.fbp
      v.fbp += fc * hp

      L[i] += v.flp * 0.5
      R[i] += v.flp * 0.5
    }
    if (v.env < 1e-5) voices.delete(pitch)
  }
}
