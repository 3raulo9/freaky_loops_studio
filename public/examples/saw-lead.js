// ── Saw Lead ──────────────────────────────────────────────────────────────────
// Monophonic sawtooth lead with portamento and 2-pole resonant lowpass filter.
// API: init(sr) · note_on(pitch, vel 0-127) · note_off(pitch) · process(L, R)

let sampleRate = 44100
let freq = 0
let targetFreq = 0
let phase = 0
let gain = 0
let targetGain = 0

// State-variable filter state
let fLP = 0, fBP = 0

function init(sr) {
  sampleRate = sr
}

function midiFreq(pitch) {
  return 440 * Math.pow(2, (pitch - 69) / 12)
}

function note_on(pitch, velocity) {
  targetFreq = midiFreq(pitch)
  if (freq === 0) freq = targetFreq  // no glide on first note
  targetGain = velocity / 127
}

function note_off(pitch) {
  targetGain = 0
  targetFreq = 0
}

function process(L, R) {
  // Cutoff sweeps open on note-on, closes with envelope
  const cutoffBase = 1200 + gain * 3000  // 1200–4200 Hz
  const resonance  = 0.55
  const f = 2 * Math.sin(Math.PI * cutoffBase / sampleRate)
  const q = 1 - resonance

  for (let i = 0; i < L.length; i++) {
    // Portamento
    freq  += (targetFreq  - freq)  * 0.004
    gain  += (targetGain  - gain)  * 0.005

    // Sawtooth oscillator: phase 0→1 maps to amplitude -1→1
    const saw = (phase * 2 - 1) * gain * 0.6
    phase += freq / sampleRate
    if (phase >= 1) phase -= 1

    // State-variable lowpass filter
    fLP += f * fBP
    const hp = saw - fLP - q * fBP
    fBP += f * hp
    const s = fLP

    L[i] = s; R[i] = s
  }
}
