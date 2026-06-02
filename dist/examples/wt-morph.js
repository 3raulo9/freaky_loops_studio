// ── WT Morph ──────────────────────────────────────────────────────────────────
// Serum-style wavetable synthesis. Table morphs across 4 shapes:
//   pos 0.0 → Sine  |  pos 0.33 → Triangle  |  pos 0.66 → Sawtooth  |  pos 1.0 → Square
//
// Serum features: wavetable interpolation · 5-voice unison · LFO on WT pos
//                 resonant SVF lowpass · velocity→timbre mapping

let sampleRate = 44100
const PI2 = 2 * Math.PI

// Parametric wavetable — blends between 4 shapes across pos 0→1
function wt(phase, pos) {
  const p = phase - Math.floor(phase)
  const sine = Math.sin(PI2 * p)
  const tri  = p < 0.25 ? 4*p : p < 0.75 ? 2 - 4*p : 4*p - 4
  const saw  = 1 - 2*p
  const sq   = p < 0.5 ? 1 : -1

  if (pos < 0.333) { const t = pos * 3;            return sine*(1-t) + tri*t }
  if (pos < 0.667) { const t = (pos - 0.333) * 3;  return tri*(1-t)  + saw*t }
                   { const t = (pos - 0.667) * 3;  return saw*(1-t)  + sq*t  }
}

// 5-voice unison with equal-power stereo spread
const U = 5
const DET = 20  // total detune spread in cents
const detuneRatio = Array.from({ length: U }, (_, i) =>
  Math.pow(2, ((i / (U-1) - 0.5) * DET) / 1200))
const uPanL = Array.from({ length: U }, (_, i) => Math.cos(i / (U-1) * Math.PI / 2))
const uPanR = Array.from({ length: U }, (_, i) => Math.sin(i / (U-1) * Math.PI / 2))

const voices = new Map()
let lfoPhase = 0

function init(sr) { sampleRate = sr }
function midiFreq(m) { return 440 * Math.pow(2, (m - 69) / 12) }

function note_on(pitch, velocity) {
  voices.set(pitch, {
    f: midiFreq(pitch),
    ph: new Float32Array(U),
    flp: new Float32Array(U), fbp: new Float32Array(U),
    env: 0, tgt: velocity / 127 * 0.6,
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
  const lfoInc = (PI2 * 0.35) / sampleRate   // 0.35 Hz LFO

  for (const [pitch, v] of [...voices]) {
    // Filter cutoff tracks velocity (soft = dark, hard = bright)
    const cfHz = 300 + v.vel * 6000
    const fc   = 2 * Math.sin(Math.PI * Math.min(cfHz / sampleRate, 0.499))
    const q    = 1 - 0.6

    for (let i = 0; i < L.length; i++) {
      // LFO slowly wobbles WT position
      const lfo = Math.sin(lfoPhase + i * lfoInc) * 0.1
      const pos = Math.max(0, Math.min(1, v.vel * 0.8 + lfo))

      v.env += (v.tgt - v.env) * (v.env < v.tgt ? 0.002 : 0.001)

      let sL = 0, sR = 0
      for (let u = 0; u < U; u++) {
        const raw = wt(v.ph[u], pos) * v.env
        v.ph[u] += v.f * detuneRatio[u] / sampleRate

        // Per-voice state-variable lowpass filter
        v.flp[u] += fc * v.fbp[u]
        const hp = raw - v.flp[u] - q * v.fbp[u]
        v.fbp[u] += fc * hp

        sL += v.flp[u] * uPanL[u]
        sR += v.flp[u] * uPanR[u]
      }
      L[i] += sL / U * 0.5
      R[i] += sR / U * 0.5
    }
    if (v.release && v.env < 1e-4) voices.delete(pitch)
  }
  lfoPhase += lfoInc * L.length
  if (lfoPhase >= PI2) lfoPhase -= PI2
}
