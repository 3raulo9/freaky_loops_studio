// ── WT Strings Ensemble ───────────────────────────────────────────────────────
// Serum's "Hyper/Dimension" concept: 8 voices, each with slight detune AND
// a tiny random phase offset, simulating a real string section where each
// player starts slightly differently. The phase randomisation creates a
// natural, non-digital chorus effect without using a delay-based chorus.
//
// Serum features: Hyper/Dimension effect · spectral wavetable · slow attack
//                 stereo ensemble · polyphonic · velocity dynamics

let sampleRate = 44100
const PI2 = 2 * Math.PI

// Spectral wavetable: pos 0 = pure fundamental, pos 1 = 6-partial series
function wt(phase, pos) {
  const p  = phase - Math.floor(phase)
  const n  = Math.max(1, Math.round(1 + pos * 5))  // 1→6 harmonics
  let out  = 0, norm = 0
  for (let h = 1; h <= n; h++) {
    const a = 1 / h
    out  += Math.sin(PI2 * p * h) * a
    norm += a
  }
  return out / norm
}

// 8 voices — each has a unique random phase offset (the "Dimension" secret)
const U       = 8
const SPREAD  = 28  // cents
const detuneRatio = Array.from({ length: U }, (_, i) =>
  Math.pow(2, ((i / (U-1) - 0.5) * SPREAD) / 1200))
const phaseOffset = Array.from({ length: U }, () => Math.random())  // set at startup
const uPanL   = Array.from({ length: U }, (_, i) => Math.cos(i / (U-1) * Math.PI / 2))
const uPanR   = Array.from({ length: U }, (_, i) => Math.sin(i / (U-1) * Math.PI / 2))

const voices  = new Map()
let   lfoPhase = 0

function init(sr) { sampleRate = sr }
function midiFreq(m) { return 440 * Math.pow(2, (m - 69) / 12) }

function note_on(pitch, velocity) {
  voices.set(pitch, {
    f:   midiFreq(pitch),
    // Each voice starts at its unique offset (phase randomisation = Dimension effect)
    ph:  Float32Array.from({ length: U }, (_, u) => phaseOffset[u]),
    env: 0, tgt: velocity / 127 * 0.45,
    vel: velocity / 127,
    release: false,
  })
}

function note_off(pitch) {
  const v = voices.get(pitch)
  if (v) { v.release = true; v.tgt = 0 }
}

function process(L, R) {
  L.fill(0); R.fill(0)
  const lfoInc = (PI2 * 0.22) / sampleRate  // 0.22 Hz — slow evolving morph

  for (const [pitch, v] of [...voices]) {
    for (let i = 0; i < L.length; i++) {
      // LFO slowly morphs WT position 0.3→0.7 (mid-table for richness)
      const lfoVal = (Math.sin(lfoPhase + i * lfoInc) + 1) / 2
      const pos    = 0.3 + lfoVal * 0.4

      // Slow attack (250ms), medium release (300ms)
      v.env += (v.tgt - v.env) * (v.env < v.tgt ? 0.0012 : 0.0009)

      let sL = 0, sR = 0
      for (let u = 0; u < U; u++) {
        // Each of the 8 voices uses its own phase, including the random offset
        const s = wt(v.ph[u], pos) * v.env
        v.ph[u] += v.f * detuneRatio[u] / sampleRate

        sL += s * uPanL[u]
        sR += s * uPanR[u]
      }
      L[i] += sL / U * 0.5
      R[i] += sR / U * 0.5
    }
    if (v.release && v.env < 1e-4) voices.delete(pitch)
  }
  lfoPhase += lfoInc * L.length
  if (lfoPhase >= PI2) lfoPhase -= PI2
}
