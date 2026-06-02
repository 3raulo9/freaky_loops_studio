// ── WT Vowel Synth ────────────────────────────────────────────────────────────
// Formant wavetable synthesiser. Bandpass filter pairs tuned to human vowel
// resonances morph continuously through A → E → I → O → U.
// A slow LFO drives the vowel position automatically — every note "talks."
//
// Serum features: formant/vowel filter mode · LFO on filter position
//                 polyphonic · velocity dynamics

let sampleRate = 44100
const PI2 = 2 * Math.PI

// Vowel formant pairs [F1 Hz, F2 Hz] — International Phonetics
const VOWELS = [
  [800, 1200],  // A (ah)
  [400, 2200],  // E (eh)
  [350, 2900],  // I (ee)
  [600,  900],  // O (oh)
  [350,  700],  // U (oo)
]

// Interpolate between adjacent vowels at position 0-1
function getFormants(pos) {
  const idx   = pos * (VOWELS.length - 1)
  const lo    = Math.min(Math.floor(idx), VOWELS.length - 2)
  const hi    = lo + 1
  const blend = idx - lo
  return [
    VOWELS[lo][0] * (1 - blend) + VOWELS[hi][0] * blend,
    VOWELS[lo][1] * (1 - blend) + VOWELS[hi][1] * blend,
  ]
}

// Resonant bandpass (state-variable filter, BP output)
function makeSvf() { return { lp: 0, bp: 0 } }
function svfBP(s, f, q) {
  s.lp += f * s.bp
  const hp = s.bp - s.lp - (1 - q) * s.bp  // careful SVF form
  s.bp += f * hp
  return s.bp
}

const voices = new Map()
let lfoPhase = 0

function init(sr) { sampleRate = sr }
function midiFreq(m) { return 440 * Math.pow(2, (m - 69) / 12) }

function note_on(pitch, velocity) {
  voices.set(pitch, {
    f:    midiFreq(pitch),
    ph:   0,
    env:  0, tgt: velocity / 127 * 0.6,
    vel:  velocity / 127,
    svf1: makeSvf(), svf2: makeSvf(),  // two formant filters
    release: false,
  })
}

function note_off(pitch) {
  const v = voices.get(pitch)
  if (v) { v.release = true; v.tgt = 0 }
}

function process(L, R) {
  L.fill(0); R.fill(0)
  const lfoInc = (PI2 * 0.25) / sampleRate   // 0.25 Hz — slow vowel cycle

  for (const [pitch, v] of [...voices]) {
    for (let i = 0; i < L.length; i++) {
      // Vowel LFO: slowly sweeps 0→1→0 through the vowel table
      const lfoVal = (Math.sin(lfoPhase + i * lfoInc) + 1) / 2
      const [f1Hz, f2Hz] = getFormants(lfoVal)

      // Bandpass coefficients for each formant
      const fc1 = 2 * Math.sin(Math.PI * Math.min(f1Hz / sampleRate, 0.499))
      const fc2 = 2 * Math.sin(Math.PI * Math.min(f2Hz / sampleRate, 0.499))
      const bpQ = 0.85  // narrow bandpass = stronger vowel character

      v.env += (v.tgt - v.env) * (v.env < v.tgt ? 0.002 : 0.001)

      // Sawtooth source — rich in harmonics for formants to carve
      const saw = (1 - 2 * v.ph) * v.env
      v.ph += v.f / sampleRate
      if (v.ph >= 1) v.ph -= 1

      // Two formant bandpass filters summed
      const bpSvfHelper = (s, fc) => {
        s.lp += fc * s.bp
        const hp = saw - s.lp - (1 - bpQ) * s.bp
        s.bp += fc * hp
        return s.bp
      }

      const out = bpSvfHelper(v.svf1, fc1) * 0.55 + bpSvfHelper(v.svf2, fc2) * 0.45

      L[i] += out * 0.5
      R[i] += out * 0.5
    }
    if (v.release && v.env < 1e-4) voices.delete(pitch)
  }
  lfoPhase += lfoInc * L.length
  if (lfoPhase >= PI2) lfoPhase -= PI2
}
