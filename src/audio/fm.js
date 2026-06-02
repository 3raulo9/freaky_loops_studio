// FM Synthesis voices — all use Web Audio API oscillator FM technique.
// Modulator feeds into carrier.frequency AudioParam via a GainNode scaled to Hz.
// depth (Hz) = modIndex * modulatorFreq

import { buildProcessChain, makeNoiseSource, noiseOffset } from './audioUtils.js'

function midiToFreq(pitch) {
  return 440 * Math.pow(2, (pitch - 69) / 12)
}

// ─── FM BELL ─────────────────────────────────────────────────────────────────
export function playFMBell(ctx, time, {
  pitch = 60, decay = 1.8, mod = 6, velocity = 1,
  drive = null, crunch = 0, distMix = 0.5,
  lpCutoff = 20000, hpCutoff = 20, filterQ = 0.7,
  reverbSend = 0, delaySend = 0,
} = {}, dest) {
  dest = dest ?? ctx.destination
  const freq = midiToFreq(pitch)

  const carrier   = ctx.createOscillator()
  const modulator = ctx.createOscillator()
  const modDepth  = ctx.createGain()
  const env       = ctx.createGain()

  carrier.type = 'sine'; modulator.type = 'sine'
  carrier.frequency.value   = freq
  modulator.frequency.value = freq * 1.4

  const depth = mod * freq * 1.4
  modDepth.gain.setValueAtTime(depth, time)
  modDepth.gain.exponentialRampToValueAtTime(depth * 0.005, time + decay * 0.55)

  env.gain.setValueAtTime(velocity * 0.75, time)
  env.gain.exponentialRampToValueAtTime(0.001, time + decay)

  modulator.connect(modDepth); modDepth.connect(carrier.frequency)
  carrier.connect(env)

  const dur = decay + 0.1
  modulator.start(time); modulator.stop(time + dur)
  carrier.start(time);   carrier.stop(time + dur)

  buildProcessChain(ctx, env, dest, { drive, crunch, distMix, lpCutoff, hpCutoff, filterQ, reverbSend, delaySend })
}

// ─── FM RHODES ───────────────────────────────────────────────────────────────
export function playFMRhodes(ctx, time, {
  pitch = 60, decay = 1.0, bite = 0.6, velocity = 1,
  drive = null, crunch = 0, distMix = 0.5,
  lpCutoff = 20000, hpCutoff = 20, filterQ = 0.7,
  reverbSend = 0, delaySend = 0,
} = {}, dest) {
  dest = dest ?? ctx.destination
  const freq = midiToFreq(pitch)

  const carrier   = ctx.createOscillator()
  const modulator = ctx.createOscillator()
  const modDepth  = ctx.createGain()
  const env       = ctx.createGain()

  carrier.type = 'sine'; modulator.type = 'sine'
  carrier.frequency.value   = freq
  modulator.frequency.value = freq

  const peakDepth = bite * 14 * freq
  modDepth.gain.setValueAtTime(peakDepth, time)
  modDepth.gain.exponentialRampToValueAtTime(Math.max(peakDepth * 0.04, 1), time + 0.04)
  modDepth.gain.exponentialRampToValueAtTime(0.001, time + decay * 0.8)

  env.gain.setValueAtTime(0.001, time)
  env.gain.linearRampToValueAtTime(velocity * 0.7, time + 0.005)
  env.gain.exponentialRampToValueAtTime(0.001, time + decay)

  modulator.connect(modDepth); modDepth.connect(carrier.frequency)
  carrier.connect(env)

  const dur = decay + 0.1
  modulator.start(time); modulator.stop(time + dur)
  carrier.start(time);   carrier.stop(time + dur)

  buildProcessChain(ctx, env, dest, { drive, crunch, distMix, lpCutoff, hpCutoff, filterQ, reverbSend, delaySend })
}

// ─── FM BASS ─────────────────────────────────────────────────────────────────
export function playFMBass(ctx, time, {
  pitch = 36, decay = 0.5, fmDrive = 0.5, velocity = 1,
  drive = null, crunch = 0, distMix = 0.5,
  lpCutoff = 20000, hpCutoff = 20, filterQ = 0.7,
  reverbSend = 0, delaySend = 0,
} = {}, dest) {
  dest = dest ?? ctx.destination
  const freq = midiToFreq(pitch)

  const carrier   = ctx.createOscillator()
  const modulator = ctx.createOscillator()
  const modDepth  = ctx.createGain()
  const clickOsc  = ctx.createOscillator()
  const clickGain = ctx.createGain()
  const env       = ctx.createGain()

  carrier.type = 'sine'; modulator.type = 'sine'
  carrier.frequency.value   = freq
  modulator.frequency.value = freq

  const depth = fmDrive * 8 * freq
  modDepth.gain.setValueAtTime(depth * 2.5, time)
  modDepth.gain.exponentialRampToValueAtTime(depth, time + 0.02)
  modDepth.gain.exponentialRampToValueAtTime(0.001, time + decay * 0.9)

  clickOsc.type = 'triangle'
  clickOsc.frequency.value = freq * 3
  clickGain.gain.setValueAtTime(velocity * 0.4, time)
  clickGain.gain.exponentialRampToValueAtTime(0.001, time + 0.015)

  env.gain.setValueAtTime(velocity * 0.9, time)
  env.gain.exponentialRampToValueAtTime(0.001, time + decay)

  modulator.connect(modDepth); modDepth.connect(carrier.frequency)
  carrier.connect(env)
  clickOsc.connect(clickGain); clickGain.connect(env)

  const dur = decay + 0.1
  modulator.start(time); modulator.stop(time + dur)
  carrier.start(time);   carrier.stop(time + dur)
  clickOsc.start(time);  clickOsc.stop(time + 0.04)

  buildProcessChain(ctx, env, dest, { drive, crunch, distMix, lpCutoff, hpCutoff, filterQ, reverbSend, delaySend })
}

// ─── FM ORGAN ────────────────────────────────────────────────────────────────
export function playFMOrgan(ctx, time, {
  pitch = 60, decay = 0.6, draw = 0.5, velocity = 1, gate = null,
  drive = null, crunch = 0, distMix = 0.5,
  lpCutoff = 20000, hpCutoff = 20, filterQ = 0.7,
  reverbSend = 0, delaySend = 0,
} = {}, dest) {
  dest = dest ?? ctx.destination
  const freq = midiToFreq(pitch)

  const mix = ctx.createGain()
  mix.gain.value = velocity * 0.3

  const env = ctx.createGain()
  if (gate !== null) {
    env.gain.setValueAtTime(velocity * 0.8, time)
    const holdEnd = Math.max(time + gate - decay, time + 0.01)
    env.gain.setValueAtTime(velocity * 0.8, holdEnd)
    env.gain.linearRampToValueAtTime(0.001, time + gate + decay * 0.5)
  } else {
    env.gain.setValueAtTime(velocity * 0.8, time)
    env.gain.setValueAtTime(velocity * 0.8, time + Math.max(decay - 0.02, 0.01))
    env.gain.exponentialRampToValueAtTime(0.001, time + decay)
  }
  env.connect(mix)

  const partials = [
    { freqMult: 1, modRatio: 1, modIdx: 0.15, level: 1.0 },
    { freqMult: 2, modRatio: 2, modIdx: 0.1,  level: draw * 0.7 },
    { freqMult: 3, modRatio: 3, modIdx: 0.08, level: draw * 0.4 },
  ]

  const dur = gate !== null ? gate + decay + 0.1 : decay + 0.1
  partials.forEach(({ freqMult, modRatio, modIdx, level }) => {
    const carrier   = ctx.createOscillator()
    const modulator = ctx.createOscillator()
    const modDepth  = ctx.createGain()
    const partGain  = ctx.createGain()

    carrier.type = 'sine'; modulator.type = 'sine'
    carrier.frequency.value   = freq * freqMult
    modulator.frequency.value = freq * modRatio
    modDepth.gain.value = modIdx * freq * modRatio
    partGain.gain.value = level

    modulator.connect(modDepth); modDepth.connect(carrier.frequency)
    carrier.connect(partGain); partGain.connect(env)

    modulator.start(time); modulator.stop(time + dur)
    carrier.start(time);   carrier.stop(time + dur)
  })

  buildProcessChain(ctx, mix, dest, { drive, crunch, distMix, lpCutoff, hpCutoff, filterQ, reverbSend, delaySend })
}

// ─── FM BRASS ────────────────────────────────────────────────────────────────
export function playFMBrass(ctx, time, {
  pitch = 60, decay = 0.7, bright = 0.7, velocity = 1, gate = null,
  drive = null, crunch = 0, distMix = 0.5,
  lpCutoff = 20000, hpCutoff = 20, filterQ = 0.7,
  reverbSend = 0, delaySend = 0,
} = {}, dest) {
  dest = dest ?? ctx.destination
  const freq = midiToFreq(pitch)

  const carrier   = ctx.createOscillator()
  const modulator = ctx.createOscillator()
  const modDepth  = ctx.createGain()
  const env       = ctx.createGain()

  carrier.type = 'sine'; modulator.type = 'sine'
  carrier.frequency.value   = freq
  modulator.frequency.value = freq

  const peakDepth = (1 + bright * 9) * freq
  const bodyDepth = (0.5 + bright * 3) * freq
  modDepth.gain.setValueAtTime(0.001, time)
  modDepth.gain.linearRampToValueAtTime(peakDepth, time + 0.018)
  modDepth.gain.exponentialRampToValueAtTime(bodyDepth, time + 0.06)
  if (gate !== null) {
    const modHoldEnd = Math.max(time + gate - decay, time + 0.07)
    modDepth.gain.setValueAtTime(bodyDepth, modHoldEnd)
    modDepth.gain.exponentialRampToValueAtTime(0.001, time + gate + decay)
  } else {
    modDepth.gain.exponentialRampToValueAtTime(0.001, time + decay)
  }

  env.gain.setValueAtTime(0.001, time)
  env.gain.linearRampToValueAtTime(velocity * 0.8, time + 0.02)
  if (gate !== null) {
    const holdEnd = Math.max(time + gate - decay, time + 0.03)
    env.gain.setValueAtTime(velocity * 0.7, holdEnd)
    env.gain.linearRampToValueAtTime(0.001, time + gate + decay * 0.5)
  } else {
    env.gain.exponentialRampToValueAtTime(0.001, time + decay)
  }

  modulator.connect(modDepth); modDepth.connect(carrier.frequency)
  carrier.connect(env)

  const dur = gate !== null ? gate + decay + 0.1 : decay + 0.1
  modulator.start(time); modulator.stop(time + dur)
  carrier.start(time);   carrier.stop(time + dur)

  buildProcessChain(ctx, env, dest, { drive, crunch, distMix, lpCutoff, hpCutoff, filterQ, reverbSend, delaySend })
}

// ─── FM MARIMBA ──────────────────────────────────────────────────────────────
export function playFMMarimba(ctx, time, {
  pitch = 60, decay = 0.35, hardness = 0.5, velocity = 1,
  drive = null, crunch = 0, distMix = 0.5,
  lpCutoff = 20000, hpCutoff = 20, filterQ = 0.7,
  reverbSend = 0, delaySend = 0,
} = {}, dest) {
  dest = dest ?? ctx.destination
  const freq = midiToFreq(pitch)

  const masterEnv = ctx.createGain()
  masterEnv.gain.setValueAtTime(velocity * 0.85, time)
  masterEnv.gain.exponentialRampToValueAtTime(0.001, time + decay)

  const partials  = [
    { modRatio: 3.5, modIdx: 2 + hardness * 6, level: 1.0  },
    { modRatio: 3.5, modIdx: 1 + hardness * 3, level: 0.35 },
  ]
  const freqMults = [1, 1.975]

  const dur = decay + 0.08
  partials.forEach(({ modRatio, modIdx, level }, i) => {
    const carrier   = ctx.createOscillator()
    const modulator = ctx.createOscillator()
    const modDepth  = ctx.createGain()
    const partGain  = ctx.createGain()

    carrier.type = 'sine'; modulator.type = 'sine'
    const pFreq = freq * freqMults[i]
    carrier.frequency.value   = pFreq
    modulator.frequency.value = pFreq * modRatio
    partGain.gain.value = level

    const d = modIdx * pFreq * modRatio
    modDepth.gain.setValueAtTime(d, time)
    modDepth.gain.exponentialRampToValueAtTime(0.001, time + decay * 0.25)

    modulator.connect(modDepth); modDepth.connect(carrier.frequency)
    carrier.connect(partGain); partGain.connect(masterEnv)

    modulator.start(time); modulator.stop(time + dur)
    carrier.start(time);   carrier.stop(time + dur)
  })

  buildProcessChain(ctx, masterEnv, dest, { drive, crunch, distMix, lpCutoff, hpCutoff, filterQ, reverbSend, delaySend })
}

// ─── FM CLAV ─────────────────────────────────────────────────────────────────
export function playFMClav(ctx, time, {
  pitch = 60, decay = 0.25, edge = 0.6, velocity = 1,
  drive = null, crunch = 0, distMix = 0.5,
  lpCutoff = 20000, hpCutoff = 20, filterQ = 0.7,
  reverbSend = 0, delaySend = 0,
} = {}, dest) {
  dest = dest ?? ctx.destination
  const freq = midiToFreq(pitch)

  const carrier   = ctx.createOscillator()
  const modulator = ctx.createOscillator()
  const modDepth  = ctx.createGain()
  const env       = ctx.createGain()
  const hpf       = ctx.createBiquadFilter()

  carrier.type = 'sine'; modulator.type = 'sine'
  carrier.frequency.value   = freq
  modulator.frequency.value = freq * 2

  const depth = (1 + edge * 8) * freq * 2
  modDepth.gain.setValueAtTime(depth, time)
  modDepth.gain.exponentialRampToValueAtTime(depth * 0.06, time + 0.01)
  modDepth.gain.exponentialRampToValueAtTime(0.001, time + decay * 0.6)

  env.gain.setValueAtTime(velocity * 0.9, time)
  env.gain.exponentialRampToValueAtTime(0.001, time + decay)

  hpf.type = 'highpass'; hpf.frequency.value = 80

  modulator.connect(modDepth); modDepth.connect(carrier.frequency)
  carrier.connect(env); env.connect(hpf)

  const dur = decay + 0.08
  modulator.start(time); modulator.stop(time + dur)
  carrier.start(time);   carrier.stop(time + dur)

  buildProcessChain(ctx, hpf, dest, { drive, crunch, distMix, lpCutoff, hpCutoff, filterQ, reverbSend, delaySend })
}

// ─── FM PAD ──────────────────────────────────────────────────────────────────
export function playFMPad(ctx, time, {
  pitch = 60, decay = 2.5, depth: padDepth = 0.5, velocity = 1, gate = null,
  drive = null, crunch = 0, distMix = 0.5,
  lpCutoff = 20000, hpCutoff = 20, filterQ = 0.7,
  reverbSend = 0, delaySend = 0,
} = {}, dest) {
  dest = dest ?? ctx.destination
  const freq = midiToFreq(pitch)

  const masterGain = ctx.createGain()
  const attack = 0.25
  masterGain.gain.setValueAtTime(0.001, time)
  masterGain.gain.linearRampToValueAtTime(velocity * 0.55, time + attack)
  if (gate !== null) {
    const holdEnd = Math.max(time + gate - decay, time + attack)
    masterGain.gain.setValueAtTime(velocity * 0.55, holdEnd)
    masterGain.gain.linearRampToValueAtTime(0.001, time + gate + decay * 0.5)
  } else {
    masterGain.gain.setValueAtTime(velocity * 0.55, time + decay - 0.25)
    masterGain.gain.linearRampToValueAtTime(0.001, time + decay)
  }

  const dur = gate !== null ? gate + decay + 0.15 : decay + 0.15
  const detuneAmount = [0, 0.5, -0.5]

  detuneAmount.forEach((detune, i) => {
    const carrier   = ctx.createOscillator()
    const modulator = ctx.createOscillator()
    const modDepth  = ctx.createGain()
    const lfo       = ctx.createOscillator()
    const lfoGain   = ctx.createGain()
    const voiceGain = ctx.createGain()

    carrier.type = 'sine'; modulator.type = 'sine'
    carrier.frequency.value   = freq * Math.pow(2, detune / 1200)
    modulator.frequency.value = freq

    const baseDepth = padDepth * 4 * freq
    modDepth.gain.setValueAtTime(baseDepth * 0.3, time)
    modDepth.gain.linearRampToValueAtTime(baseDepth, time + attack + 0.1)

    lfo.type = 'sine'; lfo.frequency.value = 0.25 + i * 0.07
    lfoGain.gain.value = baseDepth * 0.5
    voiceGain.gain.value = 1 / detuneAmount.length

    lfo.connect(lfoGain); lfoGain.connect(modDepth.gain)
    modulator.connect(modDepth); modDepth.connect(carrier.frequency)
    carrier.connect(voiceGain); voiceGain.connect(masterGain)

    lfo.start(time);       lfo.stop(time + dur)
    modulator.start(time); modulator.stop(time + dur)
    carrier.start(time);   carrier.stop(time + dur)
  })

  buildProcessChain(ctx, masterGain, dest, { drive, crunch, distMix, lpCutoff, hpCutoff, filterQ, reverbSend, delaySend })
}

// ─── FM PLUCK ────────────────────────────────────────────────────────────────
export function playFMPluck(ctx, time, {
  pitch = 60, decay = 0.5, bright = 0.6, velocity = 1,
  drive = null, crunch = 0, distMix = 0.5,
  lpCutoff = 20000, hpCutoff = 20, filterQ = 0.7,
  reverbSend = 0, delaySend = 0,
} = {}, dest) {
  dest = dest ?? ctx.destination
  const freq = midiToFreq(pitch)

  const carrier   = ctx.createOscillator()
  const modulator = ctx.createOscillator()
  const modDepth  = ctx.createGain()
  const env       = ctx.createGain()

  carrier.type = 'sine'; modulator.type = 'sine'
  carrier.frequency.value   = freq
  modulator.frequency.value = freq

  const peakDepth = (1 + bright * 18) * freq
  modDepth.gain.setValueAtTime(peakDepth, time)
  modDepth.gain.exponentialRampToValueAtTime(peakDepth * 0.01, time + 0.008 + bright * 0.015)
  modDepth.gain.exponentialRampToValueAtTime(0.001, time + 0.06)

  env.gain.setValueAtTime(velocity * 0.85, time)
  env.gain.exponentialRampToValueAtTime(0.001, time + decay)

  modulator.connect(modDepth); modDepth.connect(carrier.frequency)
  carrier.connect(env)

  const dur = decay + 0.1
  modulator.start(time); modulator.stop(time + dur)
  carrier.start(time);   carrier.stop(time + dur)

  buildProcessChain(ctx, env, dest, { drive, crunch, distMix, lpCutoff, hpCutoff, filterQ, reverbSend, delaySend })
}

// ─── FM FLUTE ────────────────────────────────────────────────────────────────
export function playFMFlute(ctx, time, {
  pitch = 72, decay = 1.2, breath = 0.4, velocity = 1, gate = null,
  drive = null, crunch = 0, distMix = 0.5,
  lpCutoff = 20000, hpCutoff = 20, filterQ = 0.7,
  reverbSend = 0, delaySend = 0,
} = {}, dest) {
  dest = dest ?? ctx.destination
  const freq = midiToFreq(pitch)

  const carrier   = ctx.createOscillator()
  const modulator = ctx.createOscillator()
  const modDepth  = ctx.createGain()
  const vibrato   = ctx.createOscillator()
  const vibratoG  = ctx.createGain()
  const env       = ctx.createGain()

  carrier.type = 'sine'; modulator.type = 'sine'
  carrier.frequency.value   = freq
  modulator.frequency.value = freq * 1.003

  modDepth.gain.value = breath * 0.6 * freq * 1.003

  vibrato.type = 'sine'; vibrato.frequency.value = 5.5
  vibratoG.gain.setValueAtTime(0, time + 0.1)
  vibratoG.gain.linearRampToValueAtTime(breath * freq * 0.007, time + 0.35)

  const attack = 0.08
  env.gain.setValueAtTime(0.001, time)
  env.gain.linearRampToValueAtTime(velocity * 0.65, time + attack)
  if (gate !== null) {
    const holdEnd = Math.max(time + gate - decay, time + attack)
    env.gain.setValueAtTime(velocity * 0.65, holdEnd)
    env.gain.linearRampToValueAtTime(0.001, time + gate + decay * 0.5)
  } else {
    env.gain.setValueAtTime(velocity * 0.65, time + decay - 0.08)
    env.gain.linearRampToValueAtTime(0.001, time + decay)
  }

  vibrato.connect(vibratoG); vibratoG.connect(carrier.frequency)
  modulator.connect(modDepth); modDepth.connect(carrier.frequency)
  carrier.connect(env)

  const dur = gate !== null ? gate + decay + 0.15 : decay + 0.15
  if (breath > 0.05) {
    const nLen = dur
    const noise  = makeNoiseSource(ctx)
    const nbpf   = ctx.createBiquadFilter()
    nbpf.type = 'bandpass'; nbpf.frequency.value = freq * 2; nbpf.Q.value = 2
    const noiseEnv = ctx.createGain()
    noiseEnv.gain.setValueAtTime(0.001, time)
    noiseEnv.gain.linearRampToValueAtTime(breath * 0.07 * velocity, time + attack)
    if (gate !== null) {
      const noiseHoldEnd = Math.max(time + gate - decay, time + attack)
      noiseEnv.gain.setValueAtTime(breath * 0.07 * velocity, noiseHoldEnd)
      noiseEnv.gain.linearRampToValueAtTime(0.001, time + gate + decay * 0.5)
    } else {
      noiseEnv.gain.exponentialRampToValueAtTime(0.001, time + decay)
    }
    noise.connect(nbpf); nbpf.connect(noiseEnv); noiseEnv.connect(env)
    noise.start(time, noiseOffset()); noise.stop(time + nLen)
  }

  vibrato.start(time);   vibrato.stop(time + dur)
  modulator.start(time); modulator.stop(time + dur)
  carrier.start(time);   carrier.stop(time + dur)

  buildProcessChain(ctx, env, dest, { drive, crunch, distMix, lpCutoff, hpCutoff, filterQ, reverbSend, delaySend })
}

// ─── FM GUITAR ───────────────────────────────────────────────────────────────
// Two FM pairs: (1) 1:3.5 ratio for the bright string-pluck "twang" attack,
// (2) 1:2 ratio for the warm body sustain. Amplitude tracks a fast pluck curve.
export function playFMGuitar(ctx, time, {
  pitch = 64, decay = 0.8, tone = 0.65, velocity = 1,
  drive = null, crunch = 0, distMix = 0.5,
  lpCutoff = 20000, hpCutoff = 20, filterQ = 0.7,
  reverbSend = 0, delaySend = 0,
} = {}, dest) {
  dest = dest ?? ctx.destination
  const freq = midiToFreq(pitch)

  const master = ctx.createGain()
  master.gain.value = 0.5

  // ── Voice 1: pluck twang  (mod ratio 3.5) ────────────────────────────────
  const c1 = ctx.createOscillator(); c1.type = 'sine'; c1.frequency.value = freq
  const m1 = ctx.createOscillator(); m1.type = 'sine'; m1.frequency.value = freq * 3.5
  const md1 = ctx.createGain()
  const g1  = ctx.createGain(); g1.gain.value = 0.72

  const pluck = (3 + tone * 10) * freq * 3.5
  md1.gain.setValueAtTime(pluck, time)
  md1.gain.exponentialRampToValueAtTime(pluck * 0.002, time + 0.012 + (1 - tone) * 0.03)
  md1.gain.exponentialRampToValueAtTime(0.001, time + 0.09)

  m1.connect(md1); md1.connect(c1.frequency); c1.connect(g1); g1.connect(master)

  // ── Voice 2: warm body sustain  (mod ratio 2) ────────────────────────────
  const c2 = ctx.createOscillator(); c2.type = 'sine'; c2.frequency.value = freq
  const m2 = ctx.createOscillator(); m2.type = 'sine'; m2.frequency.value = freq * 2
  const md2 = ctx.createGain()
  const g2  = ctx.createGain(); g2.gain.value = 0.55

  const body = (0.4 + tone * 2.5) * freq * 2
  md2.gain.setValueAtTime(body, time)
  md2.gain.exponentialRampToValueAtTime(0.001, time + decay * 0.85)

  m2.connect(md2); md2.connect(c2.frequency); c2.connect(g2); g2.connect(master)

  // ── Amplitude envelope ────────────────────────────────────────────────────
  const env = ctx.createGain()
  env.gain.setValueAtTime(velocity, time)
  env.gain.exponentialRampToValueAtTime(velocity * 0.18, time + 0.07)
  env.gain.exponentialRampToValueAtTime(0.001, time + decay)

  master.connect(env)

  const dur = decay + 0.1
  ;[m1, c1, m2, c2].forEach(n => { n.start(time); n.stop(time + dur) })

  buildProcessChain(ctx, env, dest, { drive, crunch, distMix, lpCutoff, hpCutoff, filterQ, reverbSend, delaySend })
}

// ─── FM BASS GUITAR ──────────────────────────────────────────────────────────
// 1:1.5 ratio gives the rubbery "slap/pluck" tone of a bass guitar string.
// Sub oscillator at half frequency adds low-end body.
// Pick click oscillator handles the initial transient attack.
export function playFMBassGuitar(ctx, time, {
  pitch = 40, decay = 1.0, pick = 0.55, velocity = 1,
  drive = null, crunch = 0, distMix = 0.5,
  lpCutoff = 20000, hpCutoff = 20, filterQ = 0.7,
  reverbSend = 0, delaySend = 0,
} = {}, dest) {
  dest = dest ?? ctx.destination
  const freq = midiToFreq(pitch)

  const env = ctx.createGain()
  env.gain.setValueAtTime(velocity * 0.9, time)
  env.gain.exponentialRampToValueAtTime(velocity * 0.35, time + 0.06)
  env.gain.exponentialRampToValueAtTime(0.001, time + decay)

  // ── Main FM body  (1 : 1.5 — perfect fifth) ──────────────────────────────
  const carrier   = ctx.createOscillator(); carrier.type = 'sine'
  const modulator = ctx.createOscillator(); modulator.type = 'sine'
  const modDepth  = ctx.createGain()
  const cGain     = ctx.createGain(); cGain.gain.value = 0.8

  carrier.frequency.value   = freq
  modulator.frequency.value = freq * 1.5

  const d = (1 + pick * 7) * freq * 1.5
  modDepth.gain.setValueAtTime(d * 2.2, time)
  modDepth.gain.exponentialRampToValueAtTime(d * 0.25, time + 0.025)
  modDepth.gain.exponentialRampToValueAtTime(0.001, time + decay * 0.65)

  modulator.connect(modDepth); modDepth.connect(carrier.frequency)
  carrier.connect(cGain); cGain.connect(env)

  // ── Sub oscillator for low-end depth ─────────────────────────────────────
  const sub     = ctx.createOscillator(); sub.type = 'triangle'
  const subGain = ctx.createGain()
  sub.frequency.value = freq * 0.5
  subGain.gain.setValueAtTime(velocity * 0.45, time)
  subGain.gain.exponentialRampToValueAtTime(0.001, time + decay * 0.7)
  sub.connect(subGain); subGain.connect(env)

  // ── Pick click transient ──────────────────────────────────────────────────
  const click     = ctx.createOscillator(); click.type = 'triangle'
  const clickGain = ctx.createGain()
  click.frequency.value = freq * 5
  clickGain.gain.setValueAtTime(velocity * pick * 0.5, time)
  clickGain.gain.exponentialRampToValueAtTime(0.001, time + 0.01)
  click.connect(clickGain); clickGain.connect(env)

  const dur = decay + 0.1
  modulator.start(time); modulator.stop(time + dur)
  carrier.start(time);   carrier.stop(time + dur)
  sub.start(time);       sub.stop(time + decay * 0.75)
  click.start(time);     click.stop(time + 0.02)

  buildProcessChain(ctx, env, dest, { drive, crunch, distMix, lpCutoff, hpCutoff, filterQ, reverbSend, delaySend })
}

// ─── FM VIBRAPHONE ───────────────────────────────────────────────────────────
export function playFMVibe(ctx, time, {
  pitch = 65, decay = 2.0, hardness = 0.4, velocity = 1,
  drive = null, crunch = 0, distMix = 0.5,
  lpCutoff = 20000, hpCutoff = 20, filterQ = 0.7,
  reverbSend = 0, delaySend = 0,
} = {}, dest) {
  dest = dest ?? ctx.destination
  const freq = midiToFreq(pitch)
  const dur = decay + 0.15

  const masterEnv = ctx.createGain()
  masterEnv.gain.setValueAtTime(velocity * 0.75, time)
  masterEnv.gain.exponentialRampToValueAtTime(0.001, time + decay)

  const vibrato  = ctx.createOscillator()
  const vibratoG = ctx.createGain()
  vibrato.type = 'sine'; vibrato.frequency.value = 5.2
  vibratoG.gain.setValueAtTime(0, time + 0.25)
  vibratoG.gain.linearRampToValueAtTime(freq * 0.009, time + 0.65)
  vibrato.connect(vibratoG)

  ;[
    { freqMult: 1,     modRatio: 3.5, modIdx: 1.5 + hardness * 4, level: 1.0 },
    { freqMult: 1.975, modRatio: 3.5, modIdx: 0.8 + hardness * 2, level: 0.3 },
  ].forEach(({ freqMult, modRatio, modIdx, level }) => {
    const carrier   = ctx.createOscillator()
    const modulator = ctx.createOscillator()
    const modDepth  = ctx.createGain()
    const partGain  = ctx.createGain()
    carrier.type = 'sine'; modulator.type = 'sine'
    const pFreq = freq * freqMult
    carrier.frequency.value   = pFreq
    modulator.frequency.value = pFreq * modRatio
    partGain.gain.value = level
    const d = modIdx * pFreq * modRatio
    modDepth.gain.setValueAtTime(d, time)
    modDepth.gain.exponentialRampToValueAtTime(0.001, time + decay * 0.25)
    vibratoG.connect(carrier.frequency)
    modulator.connect(modDepth); modDepth.connect(carrier.frequency)
    carrier.connect(partGain); partGain.connect(masterEnv)
    modulator.start(time); modulator.stop(time + dur)
    carrier.start(time);   carrier.stop(time + dur)
  })

  vibrato.start(time); vibrato.stop(time + dur)
  buildProcessChain(ctx, masterEnv, dest, { drive, crunch, distMix, lpCutoff, hpCutoff, filterQ, reverbSend, delaySend })
}

// ─── FM XYLOPHONE ────────────────────────────────────────────────────────────
export function playFMXylophone(ctx, time, {
  pitch = 72, decay = 0.18, hardness = 0.6, velocity = 1,
  drive = null, crunch = 0, distMix = 0.5,
  lpCutoff = 20000, hpCutoff = 20, filterQ = 0.7,
  reverbSend = 0, delaySend = 0,
} = {}, dest) {
  dest = dest ?? ctx.destination
  const freq = midiToFreq(pitch)
  const dur = decay + 0.08

  const masterEnv = ctx.createGain()
  masterEnv.gain.setValueAtTime(velocity * 0.9, time)
  masterEnv.gain.exponentialRampToValueAtTime(0.001, time + decay)

  ;[
    { freqMult: 1,     modRatio: 5.5, modIdx: 2 + hardness * 7, level: 1.0 },
    { freqMult: 2.756, modRatio: 5.5, modIdx: 1 + hardness * 3, level: 0.25 },
  ].forEach(({ freqMult, modRatio, modIdx, level }) => {
    const carrier   = ctx.createOscillator()
    const modulator = ctx.createOscillator()
    const modDepth  = ctx.createGain()
    const partGain  = ctx.createGain()
    carrier.type = 'sine'; modulator.type = 'sine'
    const pFreq = freq * freqMult
    carrier.frequency.value   = pFreq
    modulator.frequency.value = pFreq * modRatio
    partGain.gain.value = level
    const d = modIdx * pFreq * modRatio
    modDepth.gain.setValueAtTime(d, time)
    modDepth.gain.exponentialRampToValueAtTime(0.001, time + 0.018)
    modulator.connect(modDepth); modDepth.connect(carrier.frequency)
    carrier.connect(partGain); partGain.connect(masterEnv)
    modulator.start(time); modulator.stop(time + dur)
    carrier.start(time);   carrier.stop(time + dur)
  })

  buildProcessChain(ctx, masterEnv, dest, { drive, crunch, distMix, lpCutoff, hpCutoff, filterQ, reverbSend, delaySend })
}

// ─── FM STRINGS ──────────────────────────────────────────────────────────────
export function playFMStrings(ctx, time, {
  pitch = 60, decay = 3.0, ensemble = 0.5, velocity = 1, gate = null,
  drive = null, crunch = 0, distMix = 0.5,
  lpCutoff = 20000, hpCutoff = 20, filterQ = 0.7,
  reverbSend = 0, delaySend = 0,
} = {}, dest) {
  dest = dest ?? ctx.destination
  const freq = midiToFreq(pitch)
  const attack = 0.2 + ensemble * 0.15
  const dur = gate !== null ? gate + decay + 0.2 : decay + 0.2

  const masterGain = ctx.createGain()
  masterGain.gain.setValueAtTime(0.001, time)
  masterGain.gain.linearRampToValueAtTime(velocity * 0.5, time + attack)
  if (gate !== null) {
    const holdEnd = Math.max(time + gate - decay, time + attack)
    masterGain.gain.setValueAtTime(velocity * 0.5, holdEnd)
    masterGain.gain.linearRampToValueAtTime(0.001, time + gate + decay * 0.5)
  } else {
    masterGain.gain.setValueAtTime(velocity * 0.5, time + decay - 0.2)
    masterGain.gain.linearRampToValueAtTime(0.001, time + decay)
  }

  ;[-8, -4, 0, 4, 8].forEach(cents => {
    const carrier   = ctx.createOscillator()
    const modulator = ctx.createOscillator()
    const modDepth  = ctx.createGain()
    const voiceGain = ctx.createGain()
    carrier.type = 'sine'; modulator.type = 'sine'
    const f = freq * Math.pow(2, (cents * ensemble) / 1200)
    carrier.frequency.value   = f
    modulator.frequency.value = f
    modDepth.gain.value = (0.3 + ensemble * 1.5) * f
    voiceGain.gain.value = 0.2
    modulator.connect(modDepth); modDepth.connect(carrier.frequency)
    carrier.connect(voiceGain); voiceGain.connect(masterGain)
    modulator.start(time); modulator.stop(time + dur)
    carrier.start(time);   carrier.stop(time + dur)
  })

  buildProcessChain(ctx, masterGain, dest, { drive, crunch, distMix, lpCutoff, hpCutoff, filterQ, reverbSend, delaySend })
}

// ─── FM CELLO ────────────────────────────────────────────────────────────────
export function playFMCello(ctx, time, {
  pitch = 48, decay = 1.5, bow = 0.5, velocity = 1, gate = null,
  drive = null, crunch = 0, distMix = 0.5,
  lpCutoff = 20000, hpCutoff = 20, filterQ = 0.7,
  reverbSend = 0, delaySend = 0,
} = {}, dest) {
  dest = dest ?? ctx.destination
  const freq = midiToFreq(pitch)
  const attack = 0.12 + bow * 0.1
  const dur = gate !== null ? gate + decay + 0.15 : decay + 0.15

  const carrier   = ctx.createOscillator()
  const modulator = ctx.createOscillator()
  const modDepth  = ctx.createGain()
  const vibrato   = ctx.createOscillator()
  const vibratoG  = ctx.createGain()
  const env       = ctx.createGain()

  carrier.type = 'sine'; modulator.type = 'sine'
  carrier.frequency.value   = freq
  modulator.frequency.value = freq

  const depth = (0.8 + bow * 3) * freq
  modDepth.gain.setValueAtTime(0.001, time)
  modDepth.gain.linearRampToValueAtTime(depth * 1.5, time + 0.02)
  modDepth.gain.linearRampToValueAtTime(depth, time + attack)
  if (gate !== null) {
    const modHoldEnd = Math.max(time + gate - decay, time + attack)
    modDepth.gain.setValueAtTime(depth, modHoldEnd)
    modDepth.gain.linearRampToValueAtTime(0.001, time + gate + decay * 0.5)
  } else {
    modDepth.gain.setValueAtTime(depth, time + decay - 0.1)
    modDepth.gain.linearRampToValueAtTime(0.001, time + decay)
  }

  vibrato.type = 'sine'; vibrato.frequency.value = 5.8
  vibratoG.gain.setValueAtTime(0, time + 0.3)
  vibratoG.gain.linearRampToValueAtTime(freq * 0.005, time + 0.7)

  env.gain.setValueAtTime(0.001, time)
  env.gain.linearRampToValueAtTime(velocity * 0.7, time + attack)
  if (gate !== null) {
    const holdEnd = Math.max(time + gate - decay, time + attack)
    env.gain.setValueAtTime(velocity * 0.7, holdEnd)
    env.gain.linearRampToValueAtTime(0.001, time + gate + decay * 0.5)
  } else {
    env.gain.setValueAtTime(velocity * 0.7, time + decay - 0.1)
    env.gain.linearRampToValueAtTime(0.001, time + decay)
  }

  vibrato.connect(vibratoG); vibratoG.connect(carrier.frequency)
  modulator.connect(modDepth); modDepth.connect(carrier.frequency)
  carrier.connect(env)

  vibrato.start(time);   vibrato.stop(time + dur)
  modulator.start(time); modulator.stop(time + dur)
  carrier.start(time);   carrier.stop(time + dur)

  buildProcessChain(ctx, env, dest, { drive, crunch, distMix, lpCutoff, hpCutoff, filterQ, reverbSend, delaySend })
}

// ─── FM TRUMPET ──────────────────────────────────────────────────────────────
export function playFMTrumpet(ctx, time, {
  pitch = 67, decay = 0.8, bright = 0.8, velocity = 1, gate = null,
  drive = null, crunch = 0, distMix = 0.5,
  lpCutoff = 20000, hpCutoff = 20, filterQ = 0.7,
  reverbSend = 0, delaySend = 0,
} = {}, dest) {
  dest = dest ?? ctx.destination
  const freq = midiToFreq(pitch)
  const dur = gate !== null ? gate + decay + 0.1 : decay + 0.1

  const carrier    = ctx.createOscillator()
  const modulator  = ctx.createOscillator()
  const modDepth   = ctx.createGain()
  const modulator2 = ctx.createOscillator()
  const modDepth2  = ctx.createGain()
  const env        = ctx.createGain()

  carrier.type = 'sine'; modulator.type = 'sine'; modulator2.type = 'sine'
  carrier.frequency.value    = freq
  modulator.frequency.value  = freq
  modulator2.frequency.value = freq * 2

  const peak1 = (2 + bright * 8) * freq
  const body1 = (0.8 + bright * 3) * freq
  modDepth.gain.setValueAtTime(0.001, time)
  modDepth.gain.linearRampToValueAtTime(peak1, time + 0.015)
  modDepth.gain.exponentialRampToValueAtTime(body1, time + 0.06)
  if (gate !== null) {
    const modHoldEnd = Math.max(time + gate - decay, time + 0.07)
    modDepth.gain.setValueAtTime(body1, modHoldEnd)
    modDepth.gain.exponentialRampToValueAtTime(0.001, time + gate + decay)
  } else {
    modDepth.gain.exponentialRampToValueAtTime(0.001, time + decay)
  }

  modDepth2.gain.setValueAtTime((1 + bright * 4) * freq * 2, time)
  modDepth2.gain.exponentialRampToValueAtTime(0.001, time + 0.05)

  env.gain.setValueAtTime(0.001, time)
  env.gain.linearRampToValueAtTime(velocity * 0.85, time + 0.018)
  if (gate !== null) {
    const holdEnd = Math.max(time + gate - decay, time + 0.02)
    env.gain.setValueAtTime(velocity * 0.75, holdEnd)
    env.gain.linearRampToValueAtTime(0.001, time + gate + decay * 0.5)
  } else {
    env.gain.exponentialRampToValueAtTime(0.001, time + decay)
  }

  modulator.connect(modDepth);   modDepth.connect(carrier.frequency)
  modulator2.connect(modDepth2); modDepth2.connect(carrier.frequency)
  carrier.connect(env)

  modulator.start(time);  modulator.stop(time + dur)
  modulator2.start(time); modulator2.stop(time + 0.1)
  carrier.start(time);    carrier.stop(time + dur)

  buildProcessChain(ctx, env, dest, { drive, crunch, distMix, lpCutoff, hpCutoff, filterQ, reverbSend, delaySend })
}

// ─── FM CLARINET ─────────────────────────────────────────────────────────────
// 1:2 ratio emphasises odd harmonics, giving the hollow clarinet timbre.
export function playFMClarinet(ctx, time, {
  pitch = 60, decay = 1.0, reedy = 0.5, velocity = 1, gate = null,
  drive = null, crunch = 0, distMix = 0.5,
  lpCutoff = 20000, hpCutoff = 20, filterQ = 0.7,
  reverbSend = 0, delaySend = 0,
} = {}, dest) {
  dest = dest ?? ctx.destination
  const freq = midiToFreq(pitch)
  const attack = 0.06
  const dur = gate !== null ? gate + decay + 0.1 : decay + 0.1

  const carrier   = ctx.createOscillator()
  const modulator = ctx.createOscillator()
  const modDepth  = ctx.createGain()
  const env       = ctx.createGain()

  carrier.type = 'sine'; modulator.type = 'sine'
  carrier.frequency.value   = freq
  modulator.frequency.value = freq * 2

  const depth = (0.5 + reedy * 3) * freq * 2
  modDepth.gain.setValueAtTime(0.001, time)
  modDepth.gain.linearRampToValueAtTime(depth, time + attack)
  if (gate !== null) {
    const modHoldEnd = Math.max(time + gate - decay, time + attack)
    modDepth.gain.setValueAtTime(depth, modHoldEnd)
    modDepth.gain.linearRampToValueAtTime(0.001, time + gate + decay * 0.5)
  } else {
    modDepth.gain.setValueAtTime(depth, time + decay - 0.1)
    modDepth.gain.linearRampToValueAtTime(0.001, time + decay)
  }

  env.gain.setValueAtTime(0.001, time)
  env.gain.linearRampToValueAtTime(velocity * 0.65, time + attack)
  if (gate !== null) {
    const holdEnd = Math.max(time + gate - decay, time + attack)
    env.gain.setValueAtTime(velocity * 0.65, holdEnd)
    env.gain.linearRampToValueAtTime(0.001, time + gate + decay * 0.5)
  } else {
    env.gain.setValueAtTime(velocity * 0.65, time + decay - 0.08)
    env.gain.linearRampToValueAtTime(0.001, time + decay)
  }

  modulator.connect(modDepth); modDepth.connect(carrier.frequency)
  carrier.connect(env)

  modulator.start(time); modulator.stop(time + dur)
  carrier.start(time);   carrier.stop(time + dur)

  buildProcessChain(ctx, env, dest, { drive, crunch, distMix, lpCutoff, hpCutoff, filterQ, reverbSend, delaySend })
}

// ─── FM SITAR ────────────────────────────────────────────────────────────────
export function playFMSitar(ctx, time, {
  pitch = 60, decay = 1.2, jivari = 0.5, velocity = 1,
  drive = null, crunch = 0, distMix = 0.5,
  lpCutoff = 20000, hpCutoff = 20, filterQ = 0.7,
  reverbSend = 0, delaySend = 0,
} = {}, dest) {
  dest = dest ?? ctx.destination
  const freq = midiToFreq(pitch)
  const dur = decay + 0.15

  const mix = ctx.createGain(); mix.gain.value = 1

  const carrier   = ctx.createOscillator()
  const modulator = ctx.createOscillator()
  const modDepth  = ctx.createGain()
  const env1      = ctx.createGain()
  carrier.type = 'sine'; modulator.type = 'sine'
  carrier.frequency.value   = freq
  modulator.frequency.value = freq * 3.5
  const pluck = (2 + jivari * 8) * freq * 3.5
  modDepth.gain.setValueAtTime(pluck, time)
  modDepth.gain.exponentialRampToValueAtTime(pluck * 0.01, time + 0.012 + jivari * 0.02)
  modDepth.gain.exponentialRampToValueAtTime(0.001, time + 0.12)
  env1.gain.setValueAtTime(velocity * 0.8, time)
  env1.gain.exponentialRampToValueAtTime(0.001, time + decay)
  modulator.connect(modDepth); modDepth.connect(carrier.frequency)
  carrier.connect(env1); env1.connect(mix)
  modulator.start(time); modulator.stop(time + dur)
  carrier.start(time);   carrier.stop(time + dur)

  // Sympathetic string buzz (jivari)
  const sym    = ctx.createOscillator()
  const symMod = ctx.createOscillator()
  const symMD  = ctx.createGain()
  const symEnv = ctx.createGain()
  const symG   = ctx.createGain()
  sym.type = 'sine'; symMod.type = 'sine'
  sym.frequency.value    = freq * 1.003
  symMod.frequency.value = freq * 6.7
  symMD.gain.setValueAtTime(jivari * 1.8 * freq * 6.7 * 0.3, time)
  symMD.gain.exponentialRampToValueAtTime(0.001, time + decay * 0.6)
  symEnv.gain.setValueAtTime(velocity * 0.15, time + 0.01)
  symEnv.gain.exponentialRampToValueAtTime(0.001, time + decay * 0.8)
  symG.gain.value = jivari * 0.35
  symMod.connect(symMD); symMD.connect(sym.frequency)
  sym.connect(symEnv); symEnv.connect(symG); symG.connect(mix)
  symMod.start(time); symMod.stop(time + dur)
  sym.start(time);    sym.stop(time + dur)

  buildProcessChain(ctx, mix, dest, { drive, crunch, distMix, lpCutoff, hpCutoff, filterQ, reverbSend, delaySend })
}

// ─── FM STEEL DRUM ───────────────────────────────────────────────────────────
export function playFMSteelDrum(ctx, time, {
  pitch = 60, decay = 1.0, ring = 0.5, velocity = 1,
  drive = null, crunch = 0, distMix = 0.5,
  lpCutoff = 20000, hpCutoff = 20, filterQ = 0.7,
  reverbSend = 0, delaySend = 0,
} = {}, dest) {
  dest = dest ?? ctx.destination
  const freq = midiToFreq(pitch)
  const dur = decay + 0.1

  const masterEnv = ctx.createGain()
  masterEnv.gain.setValueAtTime(velocity * 0.8, time)
  masterEnv.gain.exponentialRampToValueAtTime(0.001, time + decay)

  ;[
    { freqMult: 1,     modRatio: 2.756, modIdx: 1.5 + ring * 4, level: 1.0 },
    { freqMult: 2,     modRatio: 1.383, modIdx: 0.8 + ring * 2, level: 0.5 },
    { freqMult: 3.515, modRatio: 1.0,   modIdx: 0.4 + ring,     level: 0.25 },
  ].forEach(({ freqMult, modRatio, modIdx, level }) => {
    const carrier   = ctx.createOscillator()
    const modulator = ctx.createOscillator()
    const modDepth  = ctx.createGain()
    const partGain  = ctx.createGain()
    carrier.type = 'sine'; modulator.type = 'sine'
    const pFreq = freq * freqMult
    carrier.frequency.value   = pFreq
    modulator.frequency.value = pFreq * modRatio
    partGain.gain.value = level
    const d = modIdx * pFreq * modRatio
    modDepth.gain.setValueAtTime(d, time)
    modDepth.gain.exponentialRampToValueAtTime(0.001, time + decay * 0.2)
    modulator.connect(modDepth); modDepth.connect(carrier.frequency)
    carrier.connect(partGain); partGain.connect(masterEnv)
    modulator.start(time); modulator.stop(time + dur)
    carrier.start(time);   carrier.stop(time + dur)
  })

  buildProcessChain(ctx, masterEnv, dest, { drive, crunch, distMix, lpCutoff, hpCutoff, filterQ, reverbSend, delaySend })
}

// ─── FM GLOCKENSPIEL ─────────────────────────────────────────────────────────
export function playFMGlocken(ctx, time, {
  pitch = 72, decay = 1.5, brightness = 0.7, velocity = 1,
  drive = null, crunch = 0, distMix = 0.5,
  lpCutoff = 20000, hpCutoff = 20, filterQ = 0.7,
  reverbSend = 0, delaySend = 0,
} = {}, dest) {
  dest = dest ?? ctx.destination
  const freq = midiToFreq(pitch)
  const dur = decay + 0.1

  const masterEnv = ctx.createGain()
  masterEnv.gain.setValueAtTime(velocity * 0.85, time)
  masterEnv.gain.exponentialRampToValueAtTime(0.001, time + decay)

  ;[
    { freqMult: 1,     modRatio: 7.1, modIdx: 1 + brightness * 3,   level: 1.0  },
    { freqMult: 2.756, modRatio: 7.1, modIdx: 0.5 + brightness,     level: 0.35 },
    { freqMult: 5.404, modRatio: 7.1, modIdx: 0.3,                  level: 0.15 },
  ].forEach(({ freqMult, modRatio, modIdx, level }) => {
    const carrier   = ctx.createOscillator()
    const modulator = ctx.createOscillator()
    const modDepth  = ctx.createGain()
    const partGain  = ctx.createGain()
    carrier.type = 'sine'; modulator.type = 'sine'
    const pFreq = freq * freqMult
    carrier.frequency.value   = pFreq
    modulator.frequency.value = pFreq * modRatio
    partGain.gain.value = level
    const d = modIdx * pFreq * modRatio
    modDepth.gain.setValueAtTime(d, time)
    modDepth.gain.exponentialRampToValueAtTime(0.001, time + 0.015)
    modulator.connect(modDepth); modDepth.connect(carrier.frequency)
    carrier.connect(partGain); partGain.connect(masterEnv)
    modulator.start(time); modulator.stop(time + dur)
    carrier.start(time);   carrier.stop(time + dur)
  })

  buildProcessChain(ctx, masterEnv, dest, { drive, crunch, distMix, lpCutoff, hpCutoff, filterQ, reverbSend, delaySend })
}

// ─── FM WOBBLE BASS ──────────────────────────────────────────────────────────
export function playFMWobble(ctx, time, {
  pitch = 36, decay = 0.6, rate = 0.5, velocity = 1, gate = null,
  drive = null, crunch = 0, distMix = 0.5,
  lpCutoff = 20000, hpCutoff = 20, filterQ = 0.7,
  reverbSend = 0, delaySend = 0,
} = {}, dest) {
  dest = dest ?? ctx.destination
  const freq = midiToFreq(pitch)
  const dur = gate !== null ? gate + decay + 0.1 : decay + 0.1

  const carrier   = ctx.createOscillator()
  const modulator = ctx.createOscillator()
  const lfo       = ctx.createOscillator()
  const lfoGain   = ctx.createGain()
  const modDepth  = ctx.createGain()
  const env       = ctx.createGain()

  carrier.type = 'sine'; modulator.type = 'sine'; lfo.type = 'sine'
  carrier.frequency.value   = freq
  modulator.frequency.value = freq
  lfo.frequency.value = 1 + rate * 8

  modDepth.gain.value = 3 * freq
  lfoGain.gain.value  = 5 * freq * rate

  env.gain.setValueAtTime(velocity * 0.85, time)
  if (gate !== null) {
    const holdEnd = Math.max(time + gate - decay, time + 0.01)
    env.gain.setValueAtTime(velocity * 0.85, holdEnd)
    env.gain.linearRampToValueAtTime(0.001, time + gate + decay * 0.5)
  } else {
    env.gain.exponentialRampToValueAtTime(0.001, time + decay)
  }

  lfo.connect(lfoGain); lfoGain.connect(modDepth.gain)
  modulator.connect(modDepth); modDepth.connect(carrier.frequency)
  carrier.connect(env)

  lfo.start(time);       lfo.stop(time + dur)
  modulator.start(time); modulator.stop(time + dur)
  carrier.start(time);   carrier.stop(time + dur)

  buildProcessChain(ctx, env, dest, { drive, crunch, distMix, lpCutoff, hpCutoff, filterQ, reverbSend, delaySend })
}

// ─── FM CHOIR ────────────────────────────────────────────────────────────────
export function playFMChoir(ctx, time, {
  pitch = 60, decay = 2.5, vowel = 0.5, velocity = 1, gate = null,
  drive = null, crunch = 0, distMix = 0.5,
  lpCutoff = 20000, hpCutoff = 20, filterQ = 0.7,
  reverbSend = 0, delaySend = 0,
} = {}, dest) {
  dest = dest ?? ctx.destination
  const freq = midiToFreq(pitch)
  const attack = 0.3
  const dur = gate !== null ? gate + decay + 0.2 : decay + 0.2

  const masterGain = ctx.createGain()
  masterGain.gain.setValueAtTime(0.001, time)
  masterGain.gain.linearRampToValueAtTime(velocity * 0.5, time + attack)
  if (gate !== null) {
    const holdEnd = Math.max(time + gate - decay, time + attack)
    masterGain.gain.setValueAtTime(velocity * 0.5, holdEnd)
    masterGain.gain.linearRampToValueAtTime(0.001, time + gate + decay * 0.5)
  } else {
    masterGain.gain.setValueAtTime(velocity * 0.5, time + decay - 0.2)
    masterGain.gain.linearRampToValueAtTime(0.001, time + decay)
  }

  ;[-8, -4, 0, 4, 8].forEach(cents => {
    const carrier   = ctx.createOscillator()
    const modulator = ctx.createOscillator()
    const modDepth  = ctx.createGain()
    const voiceGain = ctx.createGain()
    carrier.type = 'sine'; modulator.type = 'sine'
    const f = freq * Math.pow(2, (cents * vowel) / 1200)
    carrier.frequency.value   = f
    modulator.frequency.value = f * 2
    modDepth.gain.value = (0.5 + vowel * 2.5) * f * 2
    voiceGain.gain.value = 0.2
    modulator.connect(modDepth); modDepth.connect(carrier.frequency)
    carrier.connect(voiceGain); voiceGain.connect(masterGain)
    modulator.start(time); modulator.stop(time + dur)
    carrier.start(time);   carrier.stop(time + dur)
  })

  buildProcessChain(ctx, masterGain, dest, { drive, crunch, distMix, lpCutoff, hpCutoff, filterQ, reverbSend, delaySend })
}

// ─── FM WURLITZER ────────────────────────────────────────────────────────────
export function playFMWurly(ctx, time, {
  pitch = 60, decay = 1.2, bark = 0.5, velocity = 1,
  drive = null, crunch = 0, distMix = 0.5,
  lpCutoff = 20000, hpCutoff = 20, filterQ = 0.7,
  reverbSend = 0, delaySend = 0,
} = {}, dest) {
  dest = dest ?? ctx.destination
  const freq = midiToFreq(pitch)
  const dur = decay + 0.1

  const carrier   = ctx.createOscillator()
  const modulator = ctx.createOscillator()
  const modDepth  = ctx.createGain()
  const env       = ctx.createGain()
  const lpf       = ctx.createBiquadFilter()

  carrier.type = 'sine'; modulator.type = 'sine'
  carrier.frequency.value   = freq
  modulator.frequency.value = freq * 2

  const peak = (3 + bark * 12) * freq * 2
  const body = Math.max(bark * 1.5 * freq * 2, 1)
  modDepth.gain.setValueAtTime(peak, time)
  modDepth.gain.exponentialRampToValueAtTime(peak * 0.08, time + 0.01)
  modDepth.gain.exponentialRampToValueAtTime(body, time + 0.08)
  modDepth.gain.exponentialRampToValueAtTime(0.001, time + decay * 0.85)

  env.gain.setValueAtTime(0.001, time)
  env.gain.linearRampToValueAtTime(velocity * 0.75, time + 0.003)
  env.gain.exponentialRampToValueAtTime(0.001, time + decay)

  lpf.type = 'lowpass'; lpf.frequency.value = 3500 + bark * 3000

  modulator.connect(modDepth); modDepth.connect(carrier.frequency)
  carrier.connect(env); env.connect(lpf)

  modulator.start(time); modulator.stop(time + dur)
  carrier.start(time);   carrier.stop(time + dur)

  buildProcessChain(ctx, lpf, dest, { drive, crunch, distMix, lpCutoff, hpCutoff, filterQ, reverbSend, delaySend })
}

// ─── FM KALIMBA ──────────────────────────────────────────────────────────────
export function playFMKalimba(ctx, time, {
  pitch = 60, decay = 0.8, tone = 0.5, velocity = 1,
  drive = null, crunch = 0, distMix = 0.5,
  lpCutoff = 20000, hpCutoff = 20, filterQ = 0.7,
  reverbSend = 0, delaySend = 0,
} = {}, dest) {
  dest = dest ?? ctx.destination
  const freq = midiToFreq(pitch)
  const dur = decay + 0.1

  const carrier   = ctx.createOscillator()
  const modulator = ctx.createOscillator()
  const modDepth  = ctx.createGain()
  const env       = ctx.createGain()

  carrier.type = 'sine'; modulator.type = 'sine'
  carrier.frequency.value   = freq
  modulator.frequency.value = freq * 3.5

  const depth = (1 + tone * 5) * freq * 3.5
  modDepth.gain.setValueAtTime(depth, time)
  modDepth.gain.exponentialRampToValueAtTime(0.001, time + 0.008 + tone * 0.01)

  env.gain.setValueAtTime(velocity * 0.8, time)
  env.gain.exponentialRampToValueAtTime(0.001, time + decay)

  modulator.connect(modDepth); modDepth.connect(carrier.frequency)
  carrier.connect(env)

  if (tone > 0.1) {
    const noise    = makeNoiseSource(ctx)
    const nFilter  = ctx.createBiquadFilter()
    const noiseEnv = ctx.createGain()
    nFilter.type = 'bandpass'; nFilter.frequency.value = freq * 3; nFilter.Q.value = 2
    noiseEnv.gain.setValueAtTime(tone * 0.05 * velocity, time)
    noiseEnv.gain.exponentialRampToValueAtTime(0.001, time + 0.04)
    noise.connect(nFilter); nFilter.connect(noiseEnv); noiseEnv.connect(env)
    noise.start(time, noiseOffset()); noise.stop(time + 0.05)
  }

  modulator.start(time); modulator.stop(time + dur)
  carrier.start(time);   carrier.stop(time + dur)

  buildProcessChain(ctx, env, dest, { drive, crunch, distMix, lpCutoff, hpCutoff, filterQ, reverbSend, delaySend })
}

// ─── FM DIST GUITAR ──────────────────────────────────────────────────────────
// Power-chord (root + fifth) with heavy FM depth for a thick distorted tone.
export function playFMDistGtr(ctx, time, {
  pitch = 52, decay = 1.0, gain = 0.7, velocity = 1,
  drive = null, crunch = 0, distMix = 0.5,
  lpCutoff = 20000, hpCutoff = 20, filterQ = 0.7,
  reverbSend = 0, delaySend = 0,
} = {}, dest) {
  dest = dest ?? ctx.destination
  const freq = midiToFreq(pitch)
  const dur = decay + 0.1

  const master = ctx.createGain(); master.gain.value = 0.55

  ;[1, 1.498].forEach(mult => {
    const carrier   = ctx.createOscillator()
    const modulator = ctx.createOscillator()
    const modDepth  = ctx.createGain()
    const vGain     = ctx.createGain()
    carrier.type = 'sine'; modulator.type = 'sine'
    const f = freq * mult
    carrier.frequency.value   = f
    modulator.frequency.value = f
    const depth = (3 + gain * 15) * f
    modDepth.gain.setValueAtTime(depth * 2, time)
    modDepth.gain.exponentialRampToValueAtTime(depth, time + 0.015)
    modDepth.gain.exponentialRampToValueAtTime(0.001, time + decay)
    vGain.gain.value = 0.5
    modulator.connect(modDepth); modDepth.connect(carrier.frequency)
    carrier.connect(vGain); vGain.connect(master)
    modulator.start(time); modulator.stop(time + dur)
    carrier.start(time);   carrier.stop(time + dur)
  })

  const env = ctx.createGain()
  env.gain.setValueAtTime(0.001, time)
  env.gain.linearRampToValueAtTime(velocity, time + 0.005)
  env.gain.exponentialRampToValueAtTime(0.001, time + decay)
  master.connect(env)

  const effectiveDrive = drive ?? (0.4 + gain * 0.4)
  buildProcessChain(ctx, env, dest, { drive: effectiveDrive, crunch: crunch || gain * 0.25, distMix: Math.max(distMix, 0.6), lpCutoff, hpCutoff, filterQ, reverbSend, delaySend })
}

// ─── FM MOOG ─────────────────────────────────────────────────────────────────
// Sawtooth carrier with sub-octave FM and resonant filter sweep.
export function playFMMoog(ctx, time, {
  pitch = 48, decay = 0.7, cutoff = 0.5, velocity = 1, gate = null,
  drive = null, crunch = 0, distMix = 0.5,
  lpCutoff = 20000, hpCutoff = 20, filterQ = 0.7,
  reverbSend = 0, delaySend = 0,
} = {}, dest) {
  dest = dest ?? ctx.destination
  const freq = midiToFreq(pitch)
  const dur = gate !== null ? gate + decay + 0.1 : decay + 0.1

  const carrier   = ctx.createOscillator()
  const modulator = ctx.createOscillator()
  const modDepth  = ctx.createGain()
  const env       = ctx.createGain()
  const lpFilter  = ctx.createBiquadFilter()

  carrier.type = 'sawtooth'; modulator.type = 'sine'
  carrier.frequency.value   = freq
  modulator.frequency.value = freq * 0.5

  const depth = (1 + cutoff * 3) * freq * 0.5
  modDepth.gain.setValueAtTime(depth * 3, time)
  modDepth.gain.exponentialRampToValueAtTime(depth, time + 0.015)
  modDepth.gain.exponentialRampToValueAtTime(0.001, time + (gate !== null ? gate * 0.8 + decay : decay * 0.8))

  env.gain.setValueAtTime(0.001, time)
  env.gain.linearRampToValueAtTime(velocity * 0.8, time + 0.01)
  if (gate !== null) {
    const holdEnd = Math.max(time + gate - decay, time + 0.01)
    env.gain.setValueAtTime(velocity * 0.7, holdEnd)
    env.gain.linearRampToValueAtTime(0.001, time + gate + decay * 0.5)
  } else {
    env.gain.exponentialRampToValueAtTime(0.001, time + decay)
  }

  lpFilter.type = 'lowpass'; lpFilter.Q.value = 5 + cutoff * 8
  lpFilter.frequency.setValueAtTime(freq * (2 + cutoff * 8), time)
  lpFilter.frequency.exponentialRampToValueAtTime(freq * (0.5 + cutoff * 2), time + 0.15 + cutoff * 0.2)

  modulator.connect(modDepth); modDepth.connect(carrier.frequency)
  carrier.connect(env); env.connect(lpFilter)

  modulator.start(time); modulator.stop(time + dur)
  carrier.start(time);   carrier.stop(time + dur)

  buildProcessChain(ctx, lpFilter, dest, { drive, crunch, distMix, lpCutoff, hpCutoff, filterQ, reverbSend, delaySend })
}

// ─── FM TIMPANI ──────────────────────────────────────────────────────────────
// Downward pitch bend from slightly above target, resonant body.
export function playFMTimpani(ctx, time, {
  pitch = 48, decay = 1.5, tension = 0.5, velocity = 1,
  drive = null, crunch = 0, distMix = 0.5,
  lpCutoff = 20000, hpCutoff = 20, filterQ = 0.7,
  reverbSend = 0, delaySend = 0,
} = {}, dest) {
  dest = dest ?? ctx.destination
  const freq = midiToFreq(pitch)
  const dur = decay + 0.1

  const carrier   = ctx.createOscillator()
  const modulator = ctx.createOscillator()
  const modDepth  = ctx.createGain()
  const env       = ctx.createGain()

  carrier.type = 'sine'; modulator.type = 'sine'
  carrier.frequency.setValueAtTime(freq * (1.15 + tension * 0.3), time)
  carrier.frequency.exponentialRampToValueAtTime(freq, time + 0.04 + tension * 0.06)
  modulator.frequency.value = freq * 1.5

  const depth = (2 + tension * 6) * freq * 1.5
  modDepth.gain.setValueAtTime(depth * 2.5, time)
  modDepth.gain.exponentialRampToValueAtTime(depth * 0.2, time + 0.05)
  modDepth.gain.exponentialRampToValueAtTime(0.001, time + decay * 0.5)

  env.gain.setValueAtTime(velocity * 0.9, time)
  env.gain.exponentialRampToValueAtTime(0.001, time + decay)

  modulator.connect(modDepth); modDepth.connect(carrier.frequency)
  carrier.connect(env)

  modulator.start(time); modulator.stop(time + dur)
  carrier.start(time);   carrier.stop(time + dur)

  buildProcessChain(ctx, env, dest, { drive, crunch, distMix, lpCutoff, hpCutoff, filterQ, reverbSend, delaySend })
}

// ─── FM CELESTE ──────────────────────────────────────────────────────────────
export function playFMCeleste(ctx, time, {
  pitch = 72, decay = 1.5, softness = 0.5, velocity = 1,
  drive = null, crunch = 0, distMix = 0.5,
  lpCutoff = 20000, hpCutoff = 20, filterQ = 0.7,
  reverbSend = 0, delaySend = 0,
} = {}, dest) {
  dest = dest ?? ctx.destination
  const freq = midiToFreq(pitch)
  const dur = decay + 0.1

  const masterEnv = ctx.createGain()
  masterEnv.gain.setValueAtTime(velocity * 0.6, time)
  masterEnv.gain.exponentialRampToValueAtTime(0.001, time + decay)

  ;[
    { freqMult: 1,     modRatio: 5.0, modIdx: 0.5 + (1 - softness) * 2.5, level: 1.0 },
    { freqMult: 2.756, modRatio: 5.0, modIdx: 0.3 + (1 - softness),       level: 0.2 },
  ].forEach(({ freqMult, modRatio, modIdx, level }) => {
    const carrier   = ctx.createOscillator()
    const modulator = ctx.createOscillator()
    const modDepth  = ctx.createGain()
    const partGain  = ctx.createGain()
    carrier.type = 'sine'; modulator.type = 'sine'
    const pFreq = freq * freqMult
    carrier.frequency.value   = pFreq
    modulator.frequency.value = pFreq * modRatio
    partGain.gain.value = level
    const d = modIdx * pFreq * modRatio
    modDepth.gain.setValueAtTime(d, time)
    modDepth.gain.exponentialRampToValueAtTime(0.001, time + decay * 0.15)
    modulator.connect(modDepth); modDepth.connect(carrier.frequency)
    carrier.connect(partGain); partGain.connect(masterEnv)
    modulator.start(time); modulator.stop(time + dur)
    carrier.start(time);   carrier.stop(time + dur)
  })

  buildProcessChain(ctx, masterEnv, dest, { drive, crunch, distMix, lpCutoff, hpCutoff, filterQ, reverbSend, delaySend })
}

// ─── FM KOTO ─────────────────────────────────────────────────────────────────
// Two FM pairs: twang pluck (1:1.5) + resonant body (1:4), pitch slides up.
export function playFMKoto(ctx, time, {
  pitch = 60, decay = 1.0, snap = 0.6, velocity = 1,
  drive = null, crunch = 0, distMix = 0.5,
  lpCutoff = 20000, hpCutoff = 20, filterQ = 0.7,
  reverbSend = 0, delaySend = 0,
} = {}, dest) {
  dest = dest ?? ctx.destination
  const freq = midiToFreq(pitch)
  const dur = decay + 0.12

  const master = ctx.createGain(); master.gain.value = 0.75

  const c1 = ctx.createOscillator(); c1.type = 'sine'
  const m1 = ctx.createOscillator(); m1.type = 'sine'; m1.frequency.value = freq * 1.5
  const md1 = ctx.createGain()
  c1.frequency.setValueAtTime(freq * (1 - snap * 0.04), time)
  c1.frequency.exponentialRampToValueAtTime(freq, time + 0.04)
  const pluck = (2 + snap * 9) * freq * 1.5
  md1.gain.setValueAtTime(pluck, time)
  md1.gain.exponentialRampToValueAtTime(pluck * 0.002, time + 0.006 + snap * 0.012)
  md1.gain.exponentialRampToValueAtTime(0.001, time + 0.08)
  m1.connect(md1); md1.connect(c1.frequency); c1.connect(master)

  const c2 = ctx.createOscillator(); c2.type = 'sine'; c2.frequency.value = freq
  const m2 = ctx.createOscillator(); m2.type = 'sine'; m2.frequency.value = freq * 4
  const md2 = ctx.createGain()
  const body = (0.3 + snap * 1.5) * freq * 4
  md2.gain.setValueAtTime(body, time)
  md2.gain.exponentialRampToValueAtTime(0.001, time + decay * 0.4)
  m2.connect(md2); md2.connect(c2.frequency); c2.connect(master)

  const env = ctx.createGain()
  env.gain.setValueAtTime(velocity, time)
  env.gain.exponentialRampToValueAtTime(velocity * 0.2, time + 0.06)
  env.gain.exponentialRampToValueAtTime(0.001, time + decay)
  master.connect(env)

  ;[m1, c1, m2, c2].forEach(n => { n.start(time); n.stop(time + dur) })

  buildProcessChain(ctx, env, dest, { drive, crunch, distMix, lpCutoff, hpCutoff, filterQ, reverbSend, delaySend })
}

// ─── FM HARMONICA ────────────────────────────────────────────────────────────
export function playFMHarmonica(ctx, time, {
  pitch = 60, decay = 0.9, reedy = 0.6, velocity = 1,
  drive = null, crunch = 0, distMix = 0.5,
  lpCutoff = 20000, hpCutoff = 20, filterQ = 0.7,
  reverbSend = 0, delaySend = 0,
} = {}, dest) {
  dest = dest ?? ctx.destination
  const freq = midiToFreq(pitch)
  const attack = 0.04
  const dur = decay + 0.1

  const mix = ctx.createGain(); mix.gain.value = velocity * 0.65

  // Three harmonics: fundamental, octave, quint — typical harmonica partials
  ;[1, 2, 3].forEach((harmonic, i) => {
    const carrier   = ctx.createOscillator()
    const modulator = ctx.createOscillator()
    const modDepth  = ctx.createGain()
    const hGain     = ctx.createGain()
    carrier.type = 'sine'; modulator.type = 'sine'
    const f = freq * harmonic
    carrier.frequency.value   = f
    modulator.frequency.value = f * 2
    const depth = (0.4 + reedy * 2) * f * 2
    modDepth.gain.setValueAtTime(0.001, time)
    modDepth.gain.linearRampToValueAtTime(depth, time + attack)
    modDepth.gain.setValueAtTime(depth, time + decay - 0.05)
    modDepth.gain.linearRampToValueAtTime(0.001, time + decay)
    hGain.gain.value = 1 / (1 + i * 0.7)
    modulator.connect(modDepth); modDepth.connect(carrier.frequency)
    carrier.connect(hGain); hGain.connect(mix)
    modulator.start(time); modulator.stop(time + dur)
    carrier.start(time);   carrier.stop(time + dur)
  })

  const env = ctx.createGain()
  env.gain.setValueAtTime(0.001, time)
  env.gain.linearRampToValueAtTime(1, time + attack)
  env.gain.setValueAtTime(1, time + decay - 0.05)
  env.gain.linearRampToValueAtTime(0.001, time + decay)
  mix.connect(env)

  buildProcessChain(ctx, env, dest, { drive, crunch, distMix, lpCutoff, hpCutoff, filterQ, reverbSend, delaySend })
}

// ─── FM OBOE ─────────────────────────────────────────────────────────────────
// Double-reed nasal tone: 1:3 ratio with moderate depth for a bright, nasal quality.
export function playFMOboe(ctx, time, {
  pitch = 65, decay = 1.0, nasal = 0.6, velocity = 1,
  drive = null, crunch = 0, distMix = 0.5,
  lpCutoff = 20000, hpCutoff = 20, filterQ = 0.7,
  reverbSend = 0, delaySend = 0,
} = {}, dest) {
  dest = dest ?? ctx.destination
  const freq = midiToFreq(pitch)
  const attack = 0.07
  const dur = decay + 0.1

  const carrier    = ctx.createOscillator()
  const modulator  = ctx.createOscillator()
  const modulator2 = ctx.createOscillator()
  const modDepth   = ctx.createGain()
  const modDepth2  = ctx.createGain()
  const env        = ctx.createGain()

  carrier.type = 'sine'; modulator.type = 'sine'; modulator2.type = 'sine'
  carrier.frequency.value    = freq
  modulator.frequency.value  = freq * 3
  modulator2.frequency.value = freq * 6

  const depth1 = (1 + nasal * 4) * freq * 3
  const depth2 = nasal * 0.5 * freq * 6
  modDepth.gain.setValueAtTime(0.001, time)
  modDepth.gain.linearRampToValueAtTime(depth1, time + attack)
  modDepth.gain.setValueAtTime(depth1, time + decay - 0.07)
  modDepth.gain.linearRampToValueAtTime(0.001, time + decay)
  modDepth2.gain.setValueAtTime(depth2, time)
  modDepth2.gain.exponentialRampToValueAtTime(0.001, time + attack + 0.1)

  env.gain.setValueAtTime(0.001, time)
  env.gain.linearRampToValueAtTime(velocity * 0.6, time + attack)
  env.gain.setValueAtTime(velocity * 0.6, time + decay - 0.07)
  env.gain.linearRampToValueAtTime(0.001, time + decay)

  modulator.connect(modDepth);   modDepth.connect(carrier.frequency)
  modulator2.connect(modDepth2); modDepth2.connect(carrier.frequency)
  carrier.connect(env)

  modulator.start(time);  modulator.stop(time + dur)
  modulator2.start(time); modulator2.stop(time + dur)
  carrier.start(time);    carrier.stop(time + dur)

  buildProcessChain(ctx, env, dest, { drive, crunch, distMix, lpCutoff, hpCutoff, filterQ, reverbSend, delaySend })
}

// ─── FM TABLA ────────────────────────────────────────────────────────────────
// Pitched membrane drum: inharmonic partials with sharp pitch-bend transient.
export function playFMTabla(ctx, time, {
  pitch = 55, decay = 0.6, resonance = 0.5, velocity = 1,
  drive = null, crunch = 0, distMix = 0.5,
  lpCutoff = 20000, hpCutoff = 20, filterQ = 0.7,
  reverbSend = 0, delaySend = 0,
} = {}, dest) {
  dest = dest ?? ctx.destination
  const freq = midiToFreq(pitch)
  const dur = decay + 0.1

  const masterEnv = ctx.createGain()
  masterEnv.gain.setValueAtTime(velocity * 0.85, time)
  masterEnv.gain.exponentialRampToValueAtTime(0.001, time + decay)

  ;[
    { freqMult: 1,     modRatio: 1.5,  modIdx: 2 + resonance * 5, pitchBend: 1.08, level: 1.0 },
    { freqMult: 1.502, modRatio: 1.0,  modIdx: 1 + resonance * 2, pitchBend: 1.0,  level: 0.5 },
    { freqMult: 2.0,   modRatio: 2.0,  modIdx: 0.5 + resonance,   pitchBend: 1.0,  level: 0.25 },
  ].forEach(({ freqMult, modRatio, modIdx, pitchBend, level }) => {
    const carrier   = ctx.createOscillator()
    const modulator = ctx.createOscillator()
    const modDepth  = ctx.createGain()
    const partGain  = ctx.createGain()
    carrier.type = 'sine'; modulator.type = 'sine'
    const pFreq = freq * freqMult
    carrier.frequency.setValueAtTime(pFreq * pitchBend, time)
    carrier.frequency.exponentialRampToValueAtTime(pFreq, time + 0.025)
    modulator.frequency.value = pFreq * modRatio
    partGain.gain.value = level
    const d = modIdx * pFreq * modRatio
    modDepth.gain.setValueAtTime(d * 2, time)
    modDepth.gain.exponentialRampToValueAtTime(d * 0.15, time + 0.03)
    modDepth.gain.exponentialRampToValueAtTime(0.001, time + decay * 0.4)
    modulator.connect(modDepth); modDepth.connect(carrier.frequency)
    carrier.connect(partGain); partGain.connect(masterEnv)
    modulator.start(time); modulator.stop(time + dur)
    carrier.start(time);   carrier.stop(time + dur)
  })

  buildProcessChain(ctx, masterEnv, dest, { drive, crunch, distMix, lpCutoff, hpCutoff, filterQ, reverbSend, delaySend })
}

// ─── FM METAL ────────────────────────────────────────────────────────────────
export function playFMMetal(ctx, time, {
  pitch = 60, decay = 0.6, grit = 0.6, velocity = 1,
  drive = null, crunch = 0, distMix = 0.5,
  lpCutoff = 20000, hpCutoff = 20, filterQ = 0.7,
  reverbSend = 0, delaySend = 0,
} = {}, dest) {
  dest = dest ?? ctx.destination
  const freq = midiToFreq(pitch)

  const masterEnv = ctx.createGain()
  masterEnv.gain.setValueAtTime(velocity * 0.8, time)
  masterEnv.gain.exponentialRampToValueAtTime(0.001, time + decay)

  const inharmonicRatios = [1, 1.483, 2.756, 3.981]
  const dur = decay + 0.1

  inharmonicRatios.forEach((ratio, i) => {
    const carrier   = ctx.createOscillator()
    const modulator = ctx.createOscillator()
    const modDepth  = ctx.createGain()
    const partGain  = ctx.createGain()

    carrier.type = 'sine'; modulator.type = 'sine'
    const cf = freq * ratio
    const mf = freq * ratio * (1 + grit * 0.37)
    carrier.frequency.value   = cf
    modulator.frequency.value = mf

    const depth = grit * (3 + i) * cf
    modDepth.gain.setValueAtTime(depth, time)
    modDepth.gain.exponentialRampToValueAtTime(0.001, time + decay * 0.4)

    partGain.gain.value = 1 / (1 + i * 0.8)

    modulator.connect(modDepth); modDepth.connect(carrier.frequency)
    carrier.connect(partGain); partGain.connect(masterEnv)

    modulator.start(time); modulator.stop(time + dur)
    carrier.start(time);   carrier.stop(time + dur)
  })

  buildProcessChain(ctx, masterEnv, dest, { drive, crunch, distMix, lpCutoff, hpCutoff, filterQ, reverbSend, delaySend })
}
