// ── Sine Poly ─────────────────────────────────────────────────────────────────
// 8-voice polyphonic sine oscillator with smooth release.
// API: init(sr) · note_on(pitch, vel 0-127) · note_off(pitch) · process(L, R)

let sampleRate = 44100
const PI2 = 2 * Math.PI
const voices = new Map()  // pitch -> { freq, phase, gain, target }

function init(sr) {
  sampleRate = sr
}

function midiFreq(pitch) {
  return 440 * Math.pow(2, (pitch - 69) / 12)
}

function note_on(pitch, velocity) {
  voices.set(pitch, { freq: midiFreq(pitch), phase: 0, gain: 0, target: velocity / 127 })
}

function note_off(pitch) {
  const v = voices.get(pitch)
  if (v) v.target = 0
}

function process(L, R) {
  L.fill(0); R.fill(0)
  for (const [pitch, v] of voices) {
    const inc = (PI2 * v.freq) / sampleRate
    // Smooth gain towards target (attack + release)
    const rate = v.target > v.gain ? 0.003 : 0.0015
    for (let i = 0; i < L.length; i++) {
      v.gain += (v.target - v.gain) * rate
      const s = Math.sin(v.phase) * v.gain * 0.2
      L[i] += s; R[i] += s
      v.phase += inc
      if (v.phase >= PI2) v.phase -= PI2
    }
    if (v.target === 0 && v.gain < 0.0001) voices.delete(pitch)
  }
}
