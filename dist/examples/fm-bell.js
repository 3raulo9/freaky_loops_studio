// ── FM Bell ───────────────────────────────────────────────────────────────────
// Polyphonic FM bell — carrier:modulator ratio 1:1.4, naturally decaying.
// Note-off is ignored; each note rings out on its own (one-shot style).
// API: init(sr) · note_on(pitch, vel 0-127) · note_off(pitch) · process(L, R)

let sampleRate = 44100
const PI2 = 2 * Math.PI
const voices = new Map()  // pitch -> { cPhase, mPhase, env, freq }

// Exponential decay constant for ~1.8 second ring
let decayRate = 1

function init(sr) {
  sampleRate = sr
  decayRate  = Math.pow(0.001, 1 / (sr * 1.8))
}

function midiFreq(pitch) {
  return 440 * Math.pow(2, (pitch - 69) / 12)
}

function note_on(pitch, velocity) {
  const freq = midiFreq(pitch)
  voices.set(pitch, { freq, cPhase: 0, mPhase: 0, env: velocity / 127 })
}

function note_off(_pitch) { /* bells ring out naturally */ }

function process(L, R) {
  L.fill(0); R.fill(0)
  for (const [pitch, v] of voices) {
    const modRatio  = 1.4
    const modIndex  = 5 * v.env          // mod depth proportional to envelope
    const cInc      = (PI2 * v.freq) / sampleRate
    const mInc      = cInc * modRatio

    for (let i = 0; i < L.length; i++) {
      // FM: modulator drives carrier frequency
      const mod = Math.sin(v.mPhase) * v.freq * modRatio * modIndex / sampleRate
      const s   = Math.sin(v.cPhase + mod) * v.env * 0.3

      L[i] += s; R[i] += s

      v.cPhase += cInc; v.mPhase += mInc
      if (v.cPhase >= PI2) v.cPhase -= PI2
      if (v.mPhase >= PI2) v.mPhase -= PI2
      v.env *= decayRate
    }
    if (v.env < 0.0001) voices.delete(pitch)
  }
}
