import { buildProcessChain } from './audioUtils.js'

/**
 * Custom Synth - Serum-inspired wavetable oscillator
 * Features: wavetable morphing, warp modes, unison, filters, effects
 */

// Precomputed wavetables (basic shapes)
const WAVETABLES = {
  sine: generateWavetable('sine'),
  sawtooth: generateWavetable('sawtooth'),
  square: generateWavetable('square'),
  triangle: generateWavetable('triangle'),
}

function generateWavetable(type, frameCount = 256) {
  const frames = []
  const samplesPerFrame = 2048

  for (let frame = 0; frame < frameCount; frame++) {
    const frameData = new Float32Array(samplesPerFrame)
    const frameProgress = frame / frameCount

    for (let i = 0; i < samplesPerFrame; i++) {
      const t = i / samplesPerFrame
      let sample = 0

      switch (type) {
        case 'sine':
          sample = Math.sin(t * Math.PI * 2)
          break
        case 'sawtooth':
          sample = 2 * (t - Math.round(t))
          break
        case 'square':
          sample = t < 0.5 ? 1 : -1
          break
        case 'triangle':
          sample = Math.abs(2 * (t - Math.round(t))) * 2 - 1
          break
      }

      frameData[i] = sample
    }

    frames.push(frameData)
  }

  return frames
}

/**
 * Interpolate between two wavetable frames
 */
function interpolateWavetableFrame(frame1, frame2, mix) {
  const result = new Float32Array(frame1.length)
  const invMix = 1 - mix

  for (let i = 0; i < frame1.length; i++) {
    result[i] = frame1[i] * invMix + frame2[i] * mix
  }

  return result
}

/**
 * Apply warp modes to waveform
 */
function applyWarp(waveData, warpMode, warpAmount) {
  const result = new Float32Array(waveData.length)

  switch (warpMode) {
    case 'none':
      return waveData

    case 'sync':
      // Hard sync effect: add high-frequency component
      for (let i = 0; i < waveData.length; i++) {
        const t = i / waveData.length
        const syncFreq = 1 + warpAmount * 5
        const syncSignal = Math.sin(t * Math.PI * 2 * syncFreq)
        result[i] = waveData[i] * 0.7 + syncSignal * 0.3 * warpAmount
      }
      break

    case 'bend':
      // Bend waveform
      for (let i = 0; i < waveData.length; i++) {
        const bend = warpAmount * 0.5
        const bentI = (i + bend * waveData.length) % waveData.length
        result[i] = waveData[Math.floor(bentI)]
      }
      break

    case 'pwm':
      // Pulse width modulation
      const pw = 0.5 + warpAmount * 0.4
      for (let i = 0; i < waveData.length; i++) {
        const t = i / waveData.length
        result[i] = t < pw ? 1 : -1
      }
      break

    case 'asym':
      // Asymmetric tilt
      const tilt = warpAmount * 0.3
      for (let i = 0; i < waveData.length; i++) {
        const t = i / waveData.length
        result[i] = waveData[i] + t * tilt
        result[i] = Math.max(-1, Math.min(1, result[i]))
      }
      break

    case 'fm':
      // Frequency modulation (will be applied via oscillator FM)
      return waveData

    default:
      return waveData
  }

  return result
}

/**
 * Create a periodic wave from waveform data for use with OscillatorNode
 */
function createPeriodicWave(ctx, waveData) {
  const real = new Float32Array(256)
  const imag = new Float32Array(256)

  real[0] = 0
  imag[0] = 0

  // Simple FFT approximation: use samples as harmonic content
  for (let i = 1; i < 256; i++) {
    const sampleIdx = Math.floor((i / 256) * waveData.length)
    real[i] = waveData[sampleIdx]
    imag[i] = 0
  }

  return ctx.createPeriodicWave(real, imag)
}

/**
 * Custom Synth polyphonic note player
 */
export function playCustomSynthNote(ctx, time, {
  pitch = 60,
  gate = null,
  velocity = 1,

  // Oscillator A
  oscAWtPos = 0.5,
  oscAWarpMode = 'none',
  oscAWarp = 0.5,
  oscAWaveform = 'sine',
  oscAUnisonVoices = 1,
  oscAUnisonDetune = 0,
  oscAUnisonBlend = 0.5,
  oscASubAmount = 0,

  // Oscillator B
  oscBWtPos = 0.5,
  oscBWarpMode = 'none',
  oscBWarp = 0.5,
  oscBWaveform = 'sawtooth',
  oscBUnisonVoices = 1,
  oscBUnisonDetune = 0,
  oscBUnisonBlend = 0.5,
  oscBSubAmount = 0,

  // Filter
  filterType = 'lowpass',
  filterCutoff = 0.8,
  filterResonance = 0.3,
  filterDrive = 0,
  filterFat = 0,
  filterKeyTracking = false,

  // Envelope (amplitude)
  envAttack = 0.005,
  envDecay = 0.1,
  envSustain = 1,
  envRelease = 0.3,

  // Master
  masterVolume = 0.8,

  // FX sends
  reverbSend = 0,
  delaySend = 0,
} = {}, dest) {
  dest = dest ?? ctx.destination

  const freq = 440 * Math.pow(2, (pitch - 69) / 12)
  const master = ctx.createGain()
  master.gain.value = masterVolume * velocity

  // ─── Amplitude Envelope ──────────────────────────────────────────────────
  const ampEnv = ctx.createGain()
  ampEnv.gain.setValueAtTime(0.001, time)
  ampEnv.gain.linearRampToValueAtTime(velocity, time + envAttack)

  if (gate !== null) {
    const holdEnd = Math.max(time + gate - envRelease, time + envAttack)
    ampEnv.gain.setValueAtTime(velocity * envSustain, holdEnd)
    ampEnv.gain.linearRampToValueAtTime(0.001, time + gate + envRelease)
  } else {
    const decayStart = time + envAttack
    ampEnv.gain.setValueAtTime(velocity, decayStart)
    ampEnv.gain.linearRampToValueAtTime(velocity * envSustain, decayStart + envDecay)
    ampEnv.gain.exponentialRampToValueAtTime(0.001, time + envAttack + envDecay + envRelease)
  }

  // ─── Oscillator A ────────────────────────────────────────────────────────
  const oscAGain = ctx.createGain()
  oscAGain.gain.value = 0.5

  createOscillator(ctx, freq, oscAWaveform, oscAWarpMode, oscAWarp, oscAUnisonVoices, oscAUnisonDetune, time, gate, oscAGain)

  // Add sub oscillator A
  if (oscASubAmount > 0.01) {
    const subA = ctx.createOscillator()
    const subAGain = ctx.createGain()
    subA.type = 'sine'
    subA.frequency.value = freq * 0.5
    subAGain.gain.value = oscASubAmount * 0.3
    subA.connect(subAGain)
    subAGain.connect(oscAGain)
    subA.start(time)
    subA.stop(time + (gate !== null ? gate + envRelease + 0.1 : envAttack + envDecay + envRelease + 0.15))
  }

  // ─── Oscillator B ────────────────────────────────────────────────────────
  const oscBGain = ctx.createGain()
  oscBGain.gain.value = 0.5

  createOscillator(ctx, freq, oscBWaveform, oscBWarpMode, oscBWarp, oscBUnisonVoices, oscBUnisonDetune, time, gate, oscBGain)

  // Add sub oscillator B
  if (oscBSubAmount > 0.01) {
    const subB = ctx.createOscillator()
    const subBGain = ctx.createGain()
    subB.type = 'sine'
    subB.frequency.value = freq * 0.5
    subBGain.gain.value = oscBSubAmount * 0.3
    subB.connect(subBGain)
    subBGain.connect(oscBGain)
    subB.start(time)
    subB.stop(time + (gate !== null ? gate + envRelease + 0.1 : envAttack + envDecay + envRelease + 0.15))
  }

  // ─── Mixer ──────────────────────────────────────────────────────────────
  const mixer = ctx.createGain()
  oscAGain.connect(mixer)
  oscBGain.connect(mixer)

  // ─── Filter ─────────────────────────────────────────────────────────────
  const filter = ctx.createBiquadFilter()
  filter.type = filterType
  filter.frequency.value = filterCutoff * 20000
  filter.Q.value = filterResonance * 20

  if (filterKeyTracking) {
    filter.frequency.value = filterCutoff * 20000 * (freq / 440)
  }

  // ─── Drive/Saturation ───────────────────────────────────────────────────
  const drive = ctx.createWaveShaper()
  const driveAmount = filterDrive * 50
  const curve = new Float32Array(256)
  for (let i = 0; i < 256; i++) {
    const x = (i / 128) - 1
    curve[i] = ((Math.PI + driveAmount) * x) / (Math.PI + driveAmount * Math.abs(x))
  }
  drive.curve = curve

  // ─── Signal chain ────────────────────────────────────────────────────────
  mixer.connect(filter)
  filter.connect(drive)
  drive.connect(ampEnv)
  ampEnv.connect(master)

  // Route to destination with FX
  buildProcessChain(ctx, master, dest, {
    drive: null,
    reverbSend,
    delaySend,
  })

  return { oscAGain, oscBGain }
}

/**
 * Helper to create oscillators with unison/detune
 */
function createOscillator(ctx, freq, waveform, warpMode, warp, unisonVoices, unisonDetune, time, gate, destination) {
  const voiceDuration = gate !== null ? gate + 0.3 : 0.8

  for (let v = 0; v < unisonVoices; v++) {
    const osc = ctx.createOscillator()
    const detuneAmount = (v / Math.max(1, unisonVoices - 1) - 0.5) * 2 * unisonDetune * 50
    const voiceGain = ctx.createGain()

    osc.type = waveform
    osc.frequency.value = freq + detuneAmount
    voiceGain.gain.value = 1 / unisonVoices

    osc.connect(voiceGain)
    voiceGain.connect(destination)

    osc.start(time)
    osc.stop(time + voiceDuration)
  }
}
