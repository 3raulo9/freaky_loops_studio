// ── WT Hard / Wave Folder ─────────────────────────────────────────────────────
// Implements Serum's "Warp → Fold" mode. A wave folder reflects amplitude back
// when it exceeds a threshold — each fold creates a new set of harmonics.
// The fold amount is driven by an LFO for an evolving, metallic texture.
//
// Serum features: wave folding (Warp mode) · LFO on fold depth · polyphonic
//                 drive before filter · resonant highpass for aggression

let sampleRate = 44100
const PI2 = 2 * Math.PI

// Wave folder: folds the signal back when |x| > threshold
// Creates sharp additional harmonics — classic analog wavefolder behaviour
function fold(x, amount) {
  // amount 1-4: higher = more folds, more harmonics
  const a = 1 + amount * 1.5
  x *= a
  // Iterative folding
  while (Math.abs(x) > 1) {
    x = x > 1 ? 2 - x : x < -1 ? -2 - x : x
  }
  return x
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
    // Highpass filter for bite
    fhp:  0, fbp: 0,
    release: false,
  })
}

function note_off(pitch) {
  const v = voices.get(pitch)
  if (v) { v.release = true; v.tgt = 0 }
}

function process(L, R) {
  L.fill(0); R.fill(0)
  const lfoInc = (PI2 * 0.9) / sampleRate  // 0.9 Hz LFO — medium speed wobble

  for (const [pitch, v] of [...voices]) {
    // Highpass filter — removes sub, leaves metallic mid/high
    const hpHz = 150 + v.vel * 300
    const fc   = 2 * Math.sin(Math.PI * Math.min(hpHz / sampleRate, 0.499))
    const q    = 0.5

    for (let i = 0; i < L.length; i++) {
      // LFO drives fold depth — 1.0 (gentle) to 3.5 (extreme harmonics)
      const lfoVal   = (Math.sin(lfoPhase + i * lfoInc) + 1) / 2
      const foldAmt  = 1.0 + lfoVal * (1.5 + v.vel * 1.5)

      v.env += (v.tgt - v.env) * (v.env < v.tgt ? 0.003 : 0.001)

      // Sawtooth source going into wave folder
      const saw  = 1 - 2 * v.ph
      v.ph += v.f / sampleRate
      if (v.ph >= 1) v.ph -= 1

      // Apply wave folding
      const folded = fold(saw, foldAmt) * v.env

      // State-variable highpass filter (takes hp output)
      v.fhp += fc * v.fbp
      const lp = folded - v.fhp - q * v.fbp
      v.fbp += fc * lp
      const out = folded - v.fhp - v.fbp  // highpass output

      L[i] += out * 0.4
      R[i] += out * 0.4
    }
    if (v.release && v.env < 1e-4) voices.delete(pitch)
  }
  lfoPhase += lfoInc * L.length
  if (lfoPhase >= PI2) lfoPhase -= PI2
}
