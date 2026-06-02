// ── WT Supersaw ───────────────────────────────────────────────────────────────
// JP-8000 / Serum-style 7-voice supersaw. Each voice is a sawtooth wave
// detuned slightly — the beating between voices creates the "wall of sound."
//
// Serum features: unison (7 voices) · detune spread · stereo width
//                 resonant lowpass · velocity→brightness

let sampleRate = 44100

// 7 sawtooth voices — detune spread calibrated to JP-8000 spec (~40 cents total)
const N = 7
const SPREAD_CENTS = 40
const detune = Array.from({ length: N }, (_, i) =>
  Math.pow(2, ((i / (N-1) - 0.5) * SPREAD_CENTS) / 1200))
// Hard-panned: outer voices widest, centre mono
const panL = [1.00, 0.95, 0.80, 0.70, 0.55, 0.35, 0.00].map(Math.sqrt)
const panR = [0.00, 0.35, 0.55, 0.70, 0.80, 0.95, 1.00].map(Math.sqrt)

// Voice blending weight — centre voice slightly louder for body
const blend = [0.85, 0.90, 0.95, 1.00, 0.95, 0.90, 0.85]

const voices = new Map()

function init(sr) { sampleRate = sr }
function midiFreq(m) { return 440 * Math.pow(2, (m - 69) / 12) }

function note_on(pitch, velocity) {
  voices.set(pitch, {
    f: midiFreq(pitch),
    ph: new Float32Array(N),
    flp: new Float32Array(N), fbp: new Float32Array(N),
    env: 0, tgt: velocity / 127 * 0.55,
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
  for (const [pitch, v] of [...voices]) {
    // Filter opens with velocity — bright hits, dark holds
    const cfHz = 800 + v.vel * 9000
    const fc   = 2 * Math.sin(Math.PI * Math.min(cfHz / sampleRate, 0.499))
    const q    = 0.35   // low resonance = smooth supersaw

    for (let i = 0; i < L.length; i++) {
      v.env += (v.tgt - v.env) * (v.env < v.tgt ? 0.003 : 0.001)

      let sL = 0, sR = 0
      for (let u = 0; u < N; u++) {
        // Sawtooth: phase 0→1 maps to amplitude 1→−1
        const saw = (1 - 2 * v.ph[u]) * v.env * blend[u]
        v.ph[u] += v.f * detune[u] / sampleRate
        if (v.ph[u] >= 1) v.ph[u] -= 1

        // Per-voice lowpass
        v.flp[u] += fc * v.fbp[u]
        const hp = saw - v.flp[u] - q * v.fbp[u]
        v.fbp[u] += fc * hp

        sL += v.flp[u] * panL[u]
        sR += v.flp[u] * panR[u]
      }
      L[i] += sL / N * 0.55
      R[i] += sR / N * 0.55
    }
    if (v.release && v.env < 1e-4) voices.delete(pitch)
  }
}
