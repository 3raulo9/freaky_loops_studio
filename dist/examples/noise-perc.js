// ── Noise Percussion ──────────────────────────────────────────────────────────
// White noise burst — pitch controls decay length:
//   pitch > 70 → hi-hat (short, ~50ms)
//   pitch 50-70 → snare (mid, ~150ms)
//   pitch < 50 → kick-style (long, ~350ms) with sine-tone body
// API: init(sr) · note_on(pitch, vel 0-127) · note_off(pitch) · process(L, R)

let sampleRate = 44100
let env       = 0
let toneEnv   = 0
let decayRate = 0.999
let toneDecay = 0.999
let tonePhase = 0
let toneFreq  = 0
let lastPitch = 60

function init(sr) {
  sampleRate = sr
}

function note_on(pitch, velocity) {
  const vel = velocity / 127
  lastPitch = pitch
  env = vel

  let decayMs
  if (pitch > 70)      { decayMs = 0.04 }   // hi-hat
  else if (pitch > 50) { decayMs = 0.15 }   // snare
  else                 { decayMs = 0.35 }   // low boom

  decayRate = Math.pow(0.001, 1 / (sampleRate * decayMs))

  // Low sine body for pitches below 50
  toneFreq  = pitch < 50 ? 440 * Math.pow(2, (pitch - 69) / 12) : 0
  toneEnv   = pitch < 50 ? vel * 0.6 : 0
  toneDecay = pitch < 50 ? Math.pow(0.001, 1 / (sampleRate * 0.25)) : 1
  tonePhase = 0
}

function note_off(_pitch) { /* one-shot, ignore */ }

function process(L, R) {
  const PI2 = 2 * Math.PI
  const toneInc = toneFreq ? (PI2 * toneFreq) / sampleRate : 0

  for (let i = 0; i < L.length; i++) {
    // White noise
    const noise = (Math.random() * 2 - 1) * env * 0.45

    // Sine body (for bass percussion)
    const tone = toneFreq ? Math.sin(tonePhase) * toneEnv * 0.55 : 0
    tonePhase += toneInc
    if (tonePhase >= PI2) tonePhase -= PI2

    const s = noise + tone
    L[i] = s; R[i] = s

    env     *= decayRate
    toneEnv *= toneDecay
  }
}
