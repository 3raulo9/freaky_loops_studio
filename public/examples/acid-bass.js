// ── Acid Bass ─────────────────────────────────────────────────────────────────
// Monophonic square wave bass with resonant filter sweep (303-style).
// Cutoff sweeps from bright → dark over ~200ms on each note trigger.
// API: init(sr) · note_on(pitch, vel 0-127) · note_off(pitch) · process(L, R)

let sampleRate = 44100
let freq = 0
let targetFreq = 0
let phase = 0
let gain = 0
let targetGain = 0

// Filter state
let fLP = 0, fBP = 0
let cutoff = 300       // current cutoff Hz
let cutoffTarget = 300 // target cutoff Hz

function init(sr) {
  sampleRate = sr
}

function midiFreq(pitch) {
  return 440 * Math.pow(2, (pitch - 69) / 12)
}

function note_on(pitch, velocity) {
  targetFreq  = midiFreq(pitch)
  if (freq === 0) freq = targetFreq
  targetGain  = velocity / 127
  // Cutoff bursts open on new note, then sweeps down
  cutoff      = Math.min(sampleRate / 2 - 1, targetFreq * 12)
  cutoffTarget = targetFreq * 1.2
}

function note_off(pitch) {
  targetGain  = 0
  targetFreq  = 0
  cutoffTarget = 200
}

function process(L, R) {
  const resonance = 0.78

  for (let i = 0; i < L.length; i++) {
    freq    += (targetFreq - freq)    * 0.005
    gain    += (targetGain - gain)    * 0.006
    cutoff  += (cutoffTarget - cutoff) * 0.002

    // Square wave (50% duty cycle)
    phase += Math.max(0, freq) / sampleRate
    if (phase >= 1) phase -= 1
    const raw = (phase < 0.5 ? 1 : -1) * gain * 0.7

    // State-variable lowpass filter
    const f   = 2 * Math.sin(Math.PI * Math.min(cutoff, sampleRate * 0.48) / sampleRate)
    const q   = 1 - resonance
    fLP += f * fBP
    const hp  = raw - fLP - q * fBP
    fBP += f * hp

    L[i] = fLP; R[i] = fLP
  }
}
