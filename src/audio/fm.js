// FM Synthesis voices — all use Web Audio API oscillator FM technique.
// Modulator feeds into carrier.frequency AudioParam via a GainNode scaled to Hz.
// depth (Hz) = modIndex * modulatorFreq

function midiToFreq(pitch) {
  return 440 * Math.pow(2, (pitch - 69) / 12)
}

// ─── FM BELL ─────────────────────────────────────────────────────────────────
// Inharmonic 1:1.4 ratio — classic tubular bell / mallet shimmer.
// knobs: pitch (24–96), decay (0.3–4.0 s), mod (0.5–14 mod index)
export function playFMBell(ctx, time, { pitch = 60, decay = 1.8, mod = 6, velocity = 1 }, dest) {
  dest = dest ?? ctx.destination
  const freq = midiToFreq(pitch)
  const modRatio = 1.4

  const carrier   = ctx.createOscillator()
  const modulator = ctx.createOscillator()
  const modDepth  = ctx.createGain()
  const env       = ctx.createGain()

  carrier.type = 'sine'
  modulator.type = 'sine'
  carrier.frequency.value   = freq
  modulator.frequency.value = freq * modRatio

  const depth = mod * freq * modRatio
  modDepth.gain.setValueAtTime(depth, time)
  modDepth.gain.exponentialRampToValueAtTime(depth * 0.005, time + decay * 0.55)

  env.gain.setValueAtTime(velocity * 0.75, time)
  env.gain.exponentialRampToValueAtTime(0.001, time + decay)

  modulator.connect(modDepth)
  modDepth.connect(carrier.frequency)
  carrier.connect(env)
  env.connect(dest)

  const dur = decay + 0.1
  modulator.start(time); modulator.stop(time + dur)
  carrier.start(time);   carrier.stop(time + dur)
}

// ─── FM RHODES ───────────────────────────────────────────────────────────────
// Classic DX7-style electric piano. Hard bite decays to warm body.
// knobs: pitch (24–96), decay (0.2–3.0 s), bite (0–1 hammer hardness)
export function playFMRhodes(ctx, time, { pitch = 60, decay = 1.0, bite = 0.6, velocity = 1 }, dest) {
  dest = dest ?? ctx.destination
  const freq = midiToFreq(pitch)

  const carrier   = ctx.createOscillator()
  const modulator = ctx.createOscillator()
  const modDepth  = ctx.createGain()
  const env       = ctx.createGain()

  carrier.type = 'sine'
  modulator.type = 'sine'
  carrier.frequency.value   = freq
  modulator.frequency.value = freq  // 1:1 ratio

  // Mod index surges on attack then drops — gives the hammer "thunk"
  const peakDepth = bite * 14 * freq
  modDepth.gain.setValueAtTime(peakDepth, time)
  modDepth.gain.exponentialRampToValueAtTime(Math.max(peakDepth * 0.04, 1), time + 0.04)
  modDepth.gain.exponentialRampToValueAtTime(0.001, time + decay * 0.8)

  env.gain.setValueAtTime(0.001, time)
  env.gain.linearRampToValueAtTime(velocity * 0.7, time + 0.005)
  env.gain.exponentialRampToValueAtTime(0.001, time + decay)

  modulator.connect(modDepth)
  modDepth.connect(carrier.frequency)
  carrier.connect(env)
  env.connect(dest)

  const dur = decay + 0.1
  modulator.start(time); modulator.stop(time + dur)
  carrier.start(time);   carrier.stop(time + dur)
}

// ─── FM BASS ─────────────────────────────────────────────────────────────────
// Deep FM bass — high drive adds harmonic grit, low drive stays sub-clean.
// knobs: pitch (24–72), decay (0.1–1.5 s), drive (0–1 mod depth)
export function playFMBass(ctx, time, { pitch = 36, decay = 0.5, drive = 0.5, velocity = 1 }, dest) {
  dest = dest ?? ctx.destination
  const freq = midiToFreq(pitch)

  const carrier   = ctx.createOscillator()
  const modulator = ctx.createOscillator()
  const modDepth  = ctx.createGain()
  const clickOsc  = ctx.createOscillator()
  const clickGain = ctx.createGain()
  const env       = ctx.createGain()

  carrier.type = 'sine'
  modulator.type = 'sine'
  carrier.frequency.value   = freq
  modulator.frequency.value = freq  // 1:1

  const depth = drive * 8 * freq
  modDepth.gain.setValueAtTime(depth * 2.5, time)
  modDepth.gain.exponentialRampToValueAtTime(depth, time + 0.02)
  modDepth.gain.exponentialRampToValueAtTime(0.001, time + decay * 0.9)

  // Transient click for punch
  clickOsc.type = 'triangle'
  clickOsc.frequency.value = freq * 3
  clickGain.gain.setValueAtTime(velocity * 0.4, time)
  clickGain.gain.exponentialRampToValueAtTime(0.001, time + 0.015)

  env.gain.setValueAtTime(velocity * 0.9, time)
  env.gain.exponentialRampToValueAtTime(0.001, time + decay)

  modulator.connect(modDepth)
  modDepth.connect(carrier.frequency)
  carrier.connect(env)
  clickOsc.connect(clickGain)
  clickGain.connect(env)
  env.connect(dest)

  const dur = decay + 0.1
  modulator.start(time); modulator.stop(time + dur)
  carrier.start(time);   carrier.stop(time + dur)
  clickOsc.start(time);  clickOsc.stop(time + 0.04)
}

// ─── FM ORGAN ────────────────────────────────────────────────────────────────
// Three-operator stack mimicking Hammond drawbars (fundamental + 2nd + 3rd).
// knobs: pitch (24–96), decay (0.05–2.0 s), draw (0–1 upper harmonic mix)
export function playFMOrgan(ctx, time, { pitch = 60, decay = 0.6, draw = 0.5, velocity = 1 }, dest) {
  dest = dest ?? ctx.destination
  const freq = midiToFreq(pitch)

  const mix = ctx.createGain()
  mix.gain.value = velocity * 0.3
  mix.connect(dest)

  const env = ctx.createGain()
  env.gain.setValueAtTime(velocity * 0.8, time)
  env.gain.setValueAtTime(velocity * 0.8, time + Math.max(decay - 0.02, 0.01))
  env.gain.exponentialRampToValueAtTime(0.001, time + decay)
  env.connect(mix)

  // Three partial carriers each FM-modulated slightly for "air"
  const partials = [
    { freqMult: 1,   modRatio: 1,   modIdx: 0.15, level: 1.0 },
    { freqMult: 2,   modRatio: 2,   modIdx: 0.1,  level: draw * 0.7 },
    { freqMult: 3,   modRatio: 3,   modIdx: 0.08, level: draw * 0.4 },
  ]

  const dur = decay + 0.1
  partials.forEach(({ freqMult, modRatio, modIdx, level }) => {
    const carrier   = ctx.createOscillator()
    const modulator = ctx.createOscillator()
    const modDepth  = ctx.createGain()
    const partGain  = ctx.createGain()

    carrier.type = 'sine'
    modulator.type = 'sine'
    carrier.frequency.value   = freq * freqMult
    modulator.frequency.value = freq * modRatio
    modDepth.gain.value = modIdx * freq * modRatio
    partGain.gain.value = level

    modulator.connect(modDepth)
    modDepth.connect(carrier.frequency)
    carrier.connect(partGain)
    partGain.connect(env)

    modulator.start(time); modulator.stop(time + dur)
    carrier.start(time);   carrier.stop(time + dur)
  })
}

// ─── FM BRASS ────────────────────────────────────────────────────────────────
// Bright brass timbre — high initial mod index settles to buzzy body.
// knobs: pitch (24–96), decay (0.1–2.0 s), bright (0–1 initial mod peak)
export function playFMBrass(ctx, time, { pitch = 60, decay = 0.7, bright = 0.7, velocity = 1 }, dest) {
  dest = dest ?? ctx.destination
  const freq = midiToFreq(pitch)

  const carrier   = ctx.createOscillator()
  const modulator = ctx.createOscillator()
  const modDepth  = ctx.createGain()
  const env       = ctx.createGain()

  carrier.type = 'sine'
  modulator.type = 'sine'
  carrier.frequency.value   = freq
  modulator.frequency.value = freq  // 1:1 for harmonic richness

  const peakDepth = (1 + bright * 9) * freq
  const bodyDepth = (0.5 + bright * 3) * freq
  modDepth.gain.setValueAtTime(0.001, time)
  modDepth.gain.linearRampToValueAtTime(peakDepth, time + 0.018)
  modDepth.gain.exponentialRampToValueAtTime(bodyDepth, time + 0.06)
  modDepth.gain.exponentialRampToValueAtTime(0.001, time + decay)

  env.gain.setValueAtTime(0.001, time)
  env.gain.linearRampToValueAtTime(velocity * 0.8, time + 0.02)
  env.gain.exponentialRampToValueAtTime(0.001, time + decay)

  modulator.connect(modDepth)
  modDepth.connect(carrier.frequency)
  carrier.connect(env)
  env.connect(dest)

  const dur = decay + 0.1
  modulator.start(time); modulator.stop(time + dur)
  carrier.start(time);   carrier.stop(time + dur)
}

// ─── FM MARIMBA ──────────────────────────────────────────────────────────────
// Woody percussion — inharmonic 1:3.5 ratio, fast decay, dual partial.
// knobs: pitch (36–96), decay (0.08–1.2 s), hardness (0–1 attack brightness)
export function playFMMarimba(ctx, time, { pitch = 60, decay = 0.35, hardness = 0.5, velocity = 1 }, dest) {
  dest = dest ?? ctx.destination
  const freq = midiToFreq(pitch)

  const masterEnv = ctx.createGain()
  masterEnv.gain.setValueAtTime(velocity * 0.85, time)
  masterEnv.gain.exponentialRampToValueAtTime(0.001, time + decay)
  masterEnv.connect(dest)

  const partials = [
    { modRatio: 3.5, modIdx: 2 + hardness * 6, level: 1.0  },  // fundamental
    { modRatio: 3.5, modIdx: 1 + hardness * 3, level: 0.35 },  // ~1 octave up for mallet "click"
  ]
  const freqMults = [1, 1.975]  // realistic marimba partials

  const dur = decay + 0.08
  partials.forEach(({ modRatio, modIdx, level }, i) => {
    const carrier   = ctx.createOscillator()
    const modulator = ctx.createOscillator()
    const modDepth  = ctx.createGain()
    const partGain  = ctx.createGain()

    carrier.type = 'sine'
    modulator.type = 'sine'
    const pFreq = freq * freqMults[i]
    carrier.frequency.value   = pFreq
    modulator.frequency.value = pFreq * modRatio
    partGain.gain.value = level

    const d = modIdx * pFreq * modRatio
    modDepth.gain.setValueAtTime(d, time)
    modDepth.gain.exponentialRampToValueAtTime(0.001, time + decay * 0.25)

    modulator.connect(modDepth)
    modDepth.connect(carrier.frequency)
    carrier.connect(partGain)
    partGain.connect(masterEnv)

    modulator.start(time); modulator.stop(time + dur)
    carrier.start(time);   carrier.stop(time + dur)
  })
}

// ─── FM CLAV ─────────────────────────────────────────────────────────────────
// Clavinet-style — 1:2 ratio, sharp click attack, punchy decay.
// knobs: pitch (36–84), decay (0.05–0.8 s), edge (0–1 harmonic bite)
export function playFMClav(ctx, time, { pitch = 60, decay = 0.25, edge = 0.6, velocity = 1 }, dest) {
  dest = dest ?? ctx.destination
  const freq = midiToFreq(pitch)

  const carrier   = ctx.createOscillator()
  const modulator = ctx.createOscillator()
  const modDepth  = ctx.createGain()
  const env       = ctx.createGain()
  const hpf       = ctx.createBiquadFilter()

  carrier.type = 'sine'
  modulator.type = 'sine'
  carrier.frequency.value   = freq
  modulator.frequency.value = freq * 2  // 1:2 generates strong 2nd harmonic

  const depth = (1 + edge * 8) * freq * 2
  modDepth.gain.setValueAtTime(depth, time)
  modDepth.gain.exponentialRampToValueAtTime(depth * 0.06, time + 0.01)
  modDepth.gain.exponentialRampToValueAtTime(0.001, time + decay * 0.6)

  env.gain.setValueAtTime(velocity * 0.9, time)
  env.gain.exponentialRampToValueAtTime(0.001, time + decay)

  hpf.type = 'highpass'
  hpf.frequency.value = 80

  modulator.connect(modDepth)
  modDepth.connect(carrier.frequency)
  carrier.connect(env)
  env.connect(hpf)
  hpf.connect(dest)

  const dur = decay + 0.08
  modulator.start(time); modulator.stop(time + dur)
  carrier.start(time);   carrier.stop(time + dur)
}

// ─── FM PAD ──────────────────────────────────────────────────────────────────
// Slow-attack evolving pad — LFO drifts mod depth for movement.
// knobs: pitch (24–96), decay (0.5–6.0 s), depth (0–1 modulation movement)
export function playFMPad(ctx, time, { pitch = 60, decay = 2.5, depth = 0.5, velocity = 1 }, dest) {
  dest = dest ?? ctx.destination
  const freq = midiToFreq(pitch)

  const masterGain = ctx.createGain()
  masterGain.connect(dest)

  const attack = 0.25
  masterGain.gain.setValueAtTime(0.001, time)
  masterGain.gain.linearRampToValueAtTime(velocity * 0.55, time + attack)
  masterGain.gain.setValueAtTime(velocity * 0.55, time + decay - 0.25)
  masterGain.gain.linearRampToValueAtTime(0.001, time + decay)

  const dur = decay + 0.15
  const detuneAmount = [0, 0.5, -0.5]  // gentle chorus spread

  detuneAmount.forEach((detune, i) => {
    const carrier   = ctx.createOscillator()
    const modulator = ctx.createOscillator()
    const modDepth  = ctx.createGain()
    const lfo       = ctx.createOscillator()
    const lfoGain   = ctx.createGain()
    const voiceGain = ctx.createGain()

    carrier.type = 'sine'
    modulator.type = 'sine'
    carrier.frequency.value   = freq * Math.pow(2, detune / 1200)
    modulator.frequency.value = freq

    const baseDepth = depth * 4 * freq
    modDepth.gain.setValueAtTime(baseDepth * 0.3, time)
    modDepth.gain.linearRampToValueAtTime(baseDepth, time + attack + 0.1)

    // LFO slowly sweeps mod depth for movement
    lfo.type = 'sine'
    lfo.frequency.value = 0.25 + i * 0.07
    lfoGain.gain.value = baseDepth * 0.5

    voiceGain.gain.value = 1 / detuneAmount.length

    lfo.connect(lfoGain)
    lfoGain.connect(modDepth.gain)
    modulator.connect(modDepth)
    modDepth.connect(carrier.frequency)
    carrier.connect(voiceGain)
    voiceGain.connect(masterGain)

    lfo.start(time);        lfo.stop(time + dur)
    modulator.start(time);  modulator.stop(time + dur)
    carrier.start(time);    carrier.stop(time + dur)
  })
}

// ─── FM PLUCK ────────────────────────────────────────────────────────────────
// String pluck — very high initial mod index decays in milliseconds.
// knobs: pitch (24–96), decay (0.1–2.0 s), bright (0–1 pluck brightness)
export function playFMPluck(ctx, time, { pitch = 60, decay = 0.5, bright = 0.6, velocity = 1 }, dest) {
  dest = dest ?? ctx.destination
  const freq = midiToFreq(pitch)

  const carrier   = ctx.createOscillator()
  const modulator = ctx.createOscillator()
  const modDepth  = ctx.createGain()
  const env       = ctx.createGain()

  carrier.type = 'sine'
  modulator.type = 'sine'
  carrier.frequency.value   = freq
  modulator.frequency.value = freq  // 1:1

  const peakDepth = (1 + bright * 18) * freq
  modDepth.gain.setValueAtTime(peakDepth, time)
  modDepth.gain.exponentialRampToValueAtTime(peakDepth * 0.01, time + 0.008 + bright * 0.015)
  modDepth.gain.exponentialRampToValueAtTime(0.001, time + 0.06)

  env.gain.setValueAtTime(velocity * 0.85, time)
  env.gain.exponentialRampToValueAtTime(0.001, time + decay)

  modulator.connect(modDepth)
  modDepth.connect(carrier.frequency)
  carrier.connect(env)
  env.connect(dest)

  const dur = decay + 0.1
  modulator.start(time); modulator.stop(time + dur)
  carrier.start(time);   carrier.stop(time + dur)
}

// ─── FM FLUTE ────────────────────────────────────────────────────────────────
// Breathy flute — near-pure tone with slight noise breath and vibrato.
// knobs: pitch (48–96), decay (0.2–3.0 s), breath (0–1 noise + vibrato amount)
export function playFMFlute(ctx, time, { pitch = 72, decay = 1.2, breath = 0.4, velocity = 1 }, dest) {
  dest = dest ?? ctx.destination
  const freq = midiToFreq(pitch)

  const carrier   = ctx.createOscillator()
  const modulator = ctx.createOscillator()
  const modDepth  = ctx.createGain()
  const vibrato   = ctx.createOscillator()
  const vibratoG  = ctx.createGain()
  const env       = ctx.createGain()

  carrier.type = 'sine'
  modulator.type = 'sine'
  carrier.frequency.value   = freq
  modulator.frequency.value = freq * 1.003  // near-unison for subtle FM color

  const depth = breath * 0.6 * freq * 1.003
  modDepth.gain.value = depth

  // Vibrato LFO kicks in gradually
  vibrato.type = 'sine'
  vibrato.frequency.value = 5.5
  vibratoG.gain.setValueAtTime(0, time + 0.1)
  vibratoG.gain.linearRampToValueAtTime(breath * freq * 0.007, time + 0.35)

  const attack = 0.08
  env.gain.setValueAtTime(0.001, time)
  env.gain.linearRampToValueAtTime(velocity * 0.65, time + attack)
  env.gain.setValueAtTime(velocity * 0.65, time + decay - 0.08)
  env.gain.linearRampToValueAtTime(0.001, time + decay)

  vibrato.connect(vibratoG)
  vibratoG.connect(carrier.frequency)
  modulator.connect(modDepth)
  modDepth.connect(carrier.frequency)
  carrier.connect(env)

  // Breath noise
  if (breath > 0.05) {
    const nLen = decay + 0.2
    const buf  = ctx.createBuffer(1, ctx.sampleRate * nLen, ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    const noise  = ctx.createBufferSource()
    noise.buffer = buf
    const nbpf   = ctx.createBiquadFilter()
    nbpf.type = 'bandpass'
    nbpf.frequency.value = freq * 2
    nbpf.Q.value = 2
    const noiseEnv = ctx.createGain()
    noiseEnv.gain.setValueAtTime(0.001, time)
    noiseEnv.gain.linearRampToValueAtTime(breath * 0.07 * velocity, time + attack)
    noiseEnv.gain.exponentialRampToValueAtTime(0.001, time + decay)
    noise.connect(nbpf)
    nbpf.connect(noiseEnv)
    noiseEnv.connect(env)
    noise.start(time); noise.stop(time + nLen)
  }

  env.connect(dest)

  const dur = decay + 0.15
  vibrato.start(time);   vibrato.stop(time + dur)
  modulator.start(time); modulator.stop(time + dur)
  carrier.start(time);   carrier.stop(time + dur)
}

// ─── FM METAL ────────────────────────────────────────────────────────────────
// Industrial metallic hit — two inharmonic carriers with ring-like intermod.
// knobs: pitch (24–84), decay (0.1–2.5 s), grit (0–1 harmonic complexity)
export function playFMMetal(ctx, time, { pitch = 60, decay = 0.6, grit = 0.6, velocity = 1 }, dest) {
  dest = dest ?? ctx.destination
  const freq = midiToFreq(pitch)

  const masterEnv = ctx.createGain()
  masterEnv.gain.setValueAtTime(velocity * 0.8, time)
  masterEnv.gain.exponentialRampToValueAtTime(0.001, time + decay)
  masterEnv.connect(dest)

  const inharmonicRatios = [1, 1.483, 2.756, 3.981]  // metallic inharmonic series
  const dur = decay + 0.1

  inharmonicRatios.forEach((ratio, i) => {
    const carrier   = ctx.createOscillator()
    const modulator = ctx.createOscillator()
    const modDepth  = ctx.createGain()
    const partGain  = ctx.createGain()

    carrier.type = 'sine'
    modulator.type = 'sine'
    const cf = freq * ratio
    const mf = freq * ratio * (1 + grit * 0.37)
    carrier.frequency.value   = cf
    modulator.frequency.value = mf

    const depth = grit * (3 + i) * cf
    modDepth.gain.setValueAtTime(depth, time)
    modDepth.gain.exponentialRampToValueAtTime(0.001, time + decay * 0.4)

    partGain.gain.value = 1 / (1 + i * 0.8)

    modulator.connect(modDepth)
    modDepth.connect(carrier.frequency)
    carrier.connect(partGain)
    partGain.connect(masterEnv)

    modulator.start(time); modulator.stop(time + dur)
    carrier.start(time);   carrier.stop(time + dur)
  })
}
