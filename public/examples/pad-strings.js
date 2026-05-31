// ── Pad Strings ───────────────────────────────────────────────────────────────
// Lush 8-voice detuned sawtooth pad with slow attack and chorus.
// Responds to note length (note_off triggers smooth release).
// API: init(sr) · note_on(pitch, vel 0-127) · note_off(pitch) · process(L, R)

let sampleRate = 44100
const PI2 = 2 * Math.PI
const DETUNES = [-8, -4, -1, 0, 1, 4, 8, 12]  // cents
const voices  = new Map()  // pitch -> { saws, gain, target, lfoPhase }

let lfoPhase = 0

function init(sr) {
  sampleRate = sr
}

function midiFreq(pitch) {
  return 440 * Math.pow(2, (pitch - 69) / 12)
}

function note_on(pitch, velocity) {
  const baseFreq = midiFreq(pitch)
  const saws = DETUNES.map(cents => ({
    freq:  baseFreq * Math.pow(2, cents / 1200),
    phase: Math.random(),  // random start phase for chorus
  }))
  voices.set(pitch, { saws, gain: 0, target: (velocity / 127) * 0.7 })
}

function note_off(pitch) {
  const v = voices.get(pitch)
  if (v) v.target = 0
}

function process(L, R) {
  L.fill(0); R.fill(0)

  // Global LFO for subtle chorus modulation
  lfoPhase += (PI2 * 0.3) / sampleRate  // 0.3 Hz
  if (lfoPhase >= PI2) lfoPhase -= PI2
  const lfo = Math.sin(lfoPhase) * 0.0005  // ±0.05% pitch mod

  for (const [pitch, v] of voices) {
    // Slow attack (200ms), medium release (300ms)
    const rate = v.target > v.gain ? 0.0015 : 0.001

    for (let i = 0; i < L.length; i++) {
      v.gain += (v.target - v.gain) * rate

      let sumL = 0, sumR = 0
      for (let j = 0; j < v.saws.length; j++) {
        const saw = v.saws[j]
        // Sawtooth: phase 0→1 → amplitude -1→1
        const sample = (saw.phase * 2 - 1) * v.gain / v.saws.length
        // Alternate voices left/right for width
        if (j % 2 === 0) sumL += sample; else sumR += sample

        saw.phase += (saw.freq / sampleRate) * (1 + lfo * (j % 2 === 0 ? 1 : -1))
        if (saw.phase >= 1) saw.phase -= 1
      }
      L[i] += sumL; R[i] += sumR
    }
    if (v.target === 0 && v.gain < 0.0001) voices.delete(pitch)
  }
}
