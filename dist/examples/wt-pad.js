// ── WT Spectral Pad ───────────────────────────────────────────────────────────
// Spectral wavetable pad. Table frame 0 = pure fundamental; frame 1 = full
// harmonic series (sawtooth). A slow LFO on WT position makes the pad "breathe"
// as harmonics fade in and out. 6 detuned voices provide thickness.
//
// Serum features: spectral wavetable · slow LFO modulation · unison ensemble
//                 slow attack · long release · stereo width

let sampleRate = 44100
const PI2 = 2 * Math.PI

// Spectral wavetable via additive synthesis per frame.
// pos 0 = sine only; pos 1 = 8 harmonics (sawtooth-like spectrum)
function wt(phase, pos) {
  const p = phase - Math.floor(phase)
  const maxHarm = 1 + Math.round(pos * 7)  // 1 harmonic at pos=0, 8 at pos=1
  let out = 0
  for (let h = 1; h <= maxHarm; h++) {
    const amp = (h === 1 ? 1.0 : pos * (1.0 / h))
    out += Math.sin(PI2 * p * h) * amp
  }
  return out / (1 + pos * 2.5)  // normalise so it doesn't blow up
}

// 6-voice unison ensemble
const U = 6
const SPREAD = 25  // cents
const detuneRatio = Array.from({ length: U }, (_, i) =>
  Math.pow(2, ((i / (U-1) - 0.5) * SPREAD) / 1200))
const uPanL = Array.from({ length: U }, (_, i) => Math.cos(i / (U-1) * Math.PI / 2))
const uPanR = Array.from({ length: U }, (_, i) => Math.sin(i / (U-1) * Math.PI / 2))

const voices = new Map()
let lfoPhase = 0

function init(sr) { sampleRate = sr }
function midiFreq(m) { return 440 * Math.pow(2, (m - 69) / 12) }

function note_on(pitch, velocity) {
  voices.set(pitch, {
    f:   midiFreq(pitch),
    ph:  new Float32Array(U),
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
  const lfoInc = (PI2 * 0.18) / sampleRate  // very slow 0.18 Hz LFO (breathe)

  for (const [pitch, v] of [...voices]) {
    for (let i = 0; i < L.length; i++) {
      // Slow LFO sweeps WT position 0.2→0.8 → harmonics breathe in and out
      const lfoVal = (Math.sin(lfoPhase + i * lfoInc) + 1) / 2  // 0→1
      const pos    = 0.2 + lfoVal * 0.6

      // Slow attack (300ms), slow release (500ms)
      v.env += (v.tgt - v.env) * (v.env < v.tgt ? 0.0010 : 0.0006)

      let sL = 0, sR = 0
      for (let u = 0; u < U; u++) {
        const s = wt(v.ph[u], pos) * v.env
        v.ph[u] += v.f * detuneRatio[u] / sampleRate
        sL += s * uPanL[u]
        sR += s * uPanR[u]
      }
      L[i] += sL / U * 0.45
      R[i] += sR / U * 0.45
    }
    if (v.release && v.env < 1e-4) voices.delete(pitch)
  }
  lfoPhase += lfoInc * L.length
  if (lfoPhase >= PI2) lfoPhase -= PI2
}
