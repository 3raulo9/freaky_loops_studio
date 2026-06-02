// ── WT Wobble Bass ────────────────────────────────────────────────────────────
// Dubstep/Serum-style wobble bass. An LFO simultaneously drives:
//   • Wavetable position (timbre shift Sine→Saw)
//   • Filter cutoff (opens and closes the tone)
// The LFO rate and depth are tied to note velocity.
//
// Serum features: LFO on WT pos + filter simultaneously · sub oscillator
//                 monophonic portamento · wavetable interpolation

let sampleRate = 44100
const PI2 = 2 * Math.PI

function wt(phase, pos) {
  const p = phase - Math.floor(phase)
  const sine = Math.sin(PI2 * p)
  const saw  = 1 - 2 * p
  // Also blend in some square at high pos for extra bite
  const sq   = p < 0.5 ? 1 : -1
  return sine * Math.max(0, 1 - pos * 2) + saw * Math.min(pos * 2, 1) * Math.max(0, 1 - (pos-0.5)*2) + sq * Math.max(0, (pos - 0.5) * 2)
}

// Sub oscillator (pure sine, half pitch)
let mainFreq = 0, mainPhase = 0, subPhase = 0
let portaFreq = 0  // current (portamento) frequency
let env = 0, envTgt = 0
let flp = 0, fbp = 0  // main filter state
let lfoPhase = 0
let lfoRate = 4  // Hz — faster = more wobble

function init(sr) { sampleRate = sr }
function midiFreq(m) { return 440 * Math.pow(2, (m - 69) / 12) }

function note_on(pitch, velocity) {
  const vel = velocity / 127
  mainFreq = midiFreq(pitch)
  if (portaFreq === 0) portaFreq = mainFreq  // no glide on first note
  envTgt = vel * 0.75
  // Velocity: harder hit = faster wobble, wider filter range
  lfoRate = 2 + vel * 8
  lfoPhase = 0  // reset LFO phase on each note for rhythmic accuracy
}

function note_off(_pitch) { envTgt = 0 }

function process(L, R) {
  L.fill(0); R.fill(0)
  const lfoInc = (PI2 * lfoRate) / sampleRate

  for (let i = 0; i < L.length; i++) {
    // Portamento
    portaFreq += (mainFreq - portaFreq) * 0.004

    // Envelope
    env += (envTgt - env) * (env < envTgt ? 0.004 : 0.002)

    // LFO: sine wave 0→1 range
    const lfoVal = (Math.sin(lfoPhase) + 1) / 2
    lfoPhase += lfoInc
    if (lfoPhase >= PI2) lfoPhase -= PI2

    // WT position driven by LFO (0 = sine, 1 = saw/sq)
    const wtPos = lfoVal * 0.85

    // Filter cutoff driven by same LFO
    const cfHz = 80 + lfoVal * 2500
    const fc   = 2 * Math.sin(Math.PI * Math.min(cfHz / sampleRate, 0.499))
    const q    = 0.7  // resonant growl

    // Main oscillator (wavetable)
    const main = wt(mainPhase, wtPos) * env
    mainPhase += portaFreq / sampleRate

    // Sub oscillator (pure sine, one octave down)
    const sub = Math.sin(PI2 * subPhase) * env * 0.5
    subPhase += (portaFreq / 2) / sampleRate

    const raw = main * 0.6 + sub * 0.4

    // State-variable lowpass filter
    flp += fc * fbp
    const hp = raw - flp - q * fbp
    fbp += fc * hp

    L[i] = flp * 0.7
    R[i] = flp * 0.7
  }
}
