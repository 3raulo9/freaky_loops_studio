// All drum sounds are synthesized with Web Audio API — no sample files.
// Each function accepts an AudioNode `dest` so callers can route through
// per-track gain nodes for volume control.
//
// Optional module params (from drumModules.js) are destructured with defaults
// that reproduce the original behaviour when no module is attached.

import { buildProcessChain, makeNoiseSource, noiseOffset } from './audioUtils.js'

// Minimum onset fade. A drum's master gain ramps from silence to peak over this
// many seconds even when "attack" is 0, so the waveform never steps from 0 to
// full instantly (a DC discontinuity = an audible click). 0.6 ms is shorter
// than any percussive transient, so the attack still sounds instant.
const MIN_ATTACK = 0.0006

function makeDistortionCurve(amount) {
  const n = 256
  const curve = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1
    curve[i] = ((Math.PI + amount) * x) / (Math.PI + amount * Math.abs(x))
  }
  return curve
}

// ─── KICK ──────────────────────────────────────────────────────────────────
// Core knobs: pitch (30–140 Hz), decay (0.15–1.6 s), punch (0–1)
// Optional modules: envelope, pitchEnv, transient, distortion, filter, body, fx
export function playKick(ctx, time, {
  pitch = 60, decay = 0.55, punch = 0.65,
  // Envelope module
  attack = 0, sustain = 0, release = 0,
  // Pitch Env module (null = use pitch-derived defaults)
  pitchStart = null, pitchEnd = null, pitchDecay = null,
  // Transient module (null = use punch-derived defaults)
  clickLevel = null, clickTone = null, clickDecay = null,
  // Distortion module (null drive = use built-in punch distortion)
  drive = null, crunch = 0, distMix = 0.5,
  // Filter module
  lpCutoff = 20000, hpCutoff = 20, filterQ = 0.7,
  // Body module (null = built-in sub behaviour)
  subLevel = null, bodyTune = 1, bodyDecay = null,
  // FX module
  reverbSend = 0, delaySend = 0,
  velocity = 1,
} = {}, dest) {
  dest = dest ?? ctx.destination

  // ── Master gain with optional ADSR envelope ───────────────────────────────
  const master = ctx.createGain()
  const peak = 1.2 * velocity
  const atk  = Math.max(attack, MIN_ATTACK)
  master.gain.setValueAtTime(0.0001, time)
  master.gain.linearRampToValueAtTime(peak, time + atk)
  const decayStart = time + atk + sustain
  master.gain.setValueAtTime(peak, decayStart)
  master.gain.exponentialRampToValueAtTime(0.001, decayStart + decay)
  if (release > 0.001) {
    master.gain.exponentialRampToValueAtTime(0.0001, decayStart + decay + release)
  }

  // ── Pitch envelope ────────────────────────────────────────────────────────
  const pStart = pitchStart ?? pitch * 5.5
  const pEnd   = pitchEnd   ?? pitch
  const pDcy   = pitchDecay ?? 0.055

  // ── Main sine body ────────────────────────────────────────────────────────
  const body     = ctx.createOscillator()
  const bodyGain = ctx.createGain()
  body.type = 'sine'
  body.frequency.setValueAtTime(pStart, time)
  body.frequency.exponentialRampToValueAtTime(pEnd, time + pDcy)
  bodyGain.gain.value = 1.0
  body.connect(bodyGain)

  // ── Sub harmonic ──────────────────────────────────────────────────────────
  const sub     = ctx.createOscillator()
  const subGain = ctx.createGain()
  sub.type = 'sine'
  const sTune = bodyTune ?? 1
  sub.frequency.setValueAtTime(pitch * 2.5 * sTune, time)
  sub.frequency.exponentialRampToValueAtTime(pitch * 0.5 * sTune, time + 0.03)
  subGain.gain.value = subLevel ?? 0.5
  sub.connect(subGain)

  // ── Click transient ───────────────────────────────────────────────────────
  const click     = ctx.createOscillator()
  const clickGain = ctx.createGain()
  click.type = 'square'
  click.frequency.value = clickTone !== null ? 400 + clickTone * 3600 : 1600
  const cLevel = clickLevel ?? punch * 0.6
  const cDcy   = clickDecay ?? 0.008
  clickGain.gain.setValueAtTime(cLevel, time)
  clickGain.gain.exponentialRampToValueAtTime(0.001, time + cDcy)
  click.connect(clickGain)

  // ── Built-in distortion (bypassed when Distortion module is active) ───────
  // makeDistortionCurve(0) is an identity curve, so when there's no drive the
  // 4x-oversampled shaper is pure CPU cost for an unchanged signal — skip it.
  // Avoiding the per-voice WaveShaper on dense patterns reduces underrun crackle.
  const distAmt = drive === null ? punch * 120 : 0
  clickGain.connect(master)
  if (distAmt > 0) {
    const dist = ctx.createWaveShaper()
    dist.curve      = makeDistortionCurve(distAmt)
    dist.oversample = '4x'
    bodyGain.connect(dist)
    subGain.connect(dist)
    dist.connect(master)
  } else {
    bodyGain.connect(master)
    subGain.connect(master)
  }

  const bDcy = bodyDecay ?? decay
  const stopT = time + Math.max(bDcy, decay) + release + 0.2
  body.start(time);  body.stop(stopT)
  sub.start(time);   sub.stop(stopT)
  click.start(time); click.stop(time + cDcy + 0.05)

  buildProcessChain(ctx, master, dest, { drive, crunch, distMix, lpCutoff, hpCutoff, filterQ, reverbSend, delaySend })
}

// ─── SNARE ──────────────────────────────────────────────────────────────────
// Core knobs: snap (0–1), tone (80–700 Hz), decay (0.04–0.9 s)
export function playSnare(ctx, time, {
  snap = 0.7, tone = 210, decay = 0.28,
  attack = 0, sustain = 0, release = 0,
  pitchStart = null, pitchEnd = null, pitchDecay = null,
  clickLevel = null, clickTone = null, clickDecay = null,
  drive = null, crunch = 0, distMix = 0.5,
  lpCutoff = 20000, hpCutoff = 20, filterQ = 0.7,
  subLevel = null, bodyTune = 1, bodyDecay = null,
  reverbSend = 0, delaySend = 0,
  velocity = 1,
} = {}, dest) {
  dest = dest ?? ctx.destination

  const bDcy  = bodyDecay ?? decay
  const sTune = bodyTune  ?? 1

  // ── Pitch envelope ────────────────────────────────────────────────────────
  const pStart = pitchStart ?? tone * 1.3
  const pEnd   = pitchEnd   ?? tone * 0.7
  const pDcy   = pitchDecay ?? decay * 0.35

  // ── White noise burst (shared buffer, shaped by noiseGain) ────────────────
  const noise    = makeNoiseSource(ctx)
  const noiseHPF = ctx.createBiquadFilter()
  noiseHPF.type  = 'highpass'; noiseHPF.frequency.value = tone * 3.5
  const noiseBPF = ctx.createBiquadFilter()
  noiseBPF.type  = 'bandpass'; noiseBPF.frequency.value = tone * 8; noiseBPF.Q.value = 0.7
  const noiseGain = ctx.createGain()
  noiseGain.gain.setValueAtTime(snap, time)
  noiseGain.gain.exponentialRampToValueAtTime(0.001, time + bDcy)
  noise.connect(noiseHPF); noiseHPF.connect(noiseBPF); noiseBPF.connect(noiseGain)

  // ── Tonal body ────────────────────────────────────────────────────────────
  const osc     = ctx.createOscillator()
  const oscGain = ctx.createGain()
  osc.type = 'triangle'
  osc.frequency.setValueAtTime(pStart, time)
  osc.frequency.exponentialRampToValueAtTime(pEnd, time + pDcy)
  oscGain.gain.setValueAtTime(0.85, time)
  oscGain.gain.exponentialRampToValueAtTime(0.001, time + bDcy * 0.4)
  osc.connect(oscGain)

  // ── Sub thump ─────────────────────────────────────────────────────────────
  const thump     = ctx.createOscillator()
  const thumpGain = ctx.createGain()
  thump.type = 'sine'
  thump.frequency.value = tone * 0.4 * sTune
  thumpGain.gain.setValueAtTime(subLevel ?? 0.6, time)
  thumpGain.gain.exponentialRampToValueAtTime(0.001, time + 0.025)
  thump.connect(thumpGain)

  // ── Click transient ───────────────────────────────────────────────────────
  const clickOsc  = ctx.createOscillator()
  const clickGain = ctx.createGain()
  clickOsc.type = 'square'
  clickOsc.frequency.value = clickTone !== null ? 400 + clickTone * 3600 : 800
  const cLevel = clickLevel ?? 0.3
  const cDcy   = clickDecay ?? 0.006
  clickGain.gain.setValueAtTime(cLevel, time)
  clickGain.gain.exponentialRampToValueAtTime(0.001, time + cDcy)
  clickOsc.connect(clickGain)

  // ── Master gain with optional ADSR ───────────────────────────────────────
  const master = ctx.createGain()
  const peak   = velocity
  const atk    = Math.max(attack, MIN_ATTACK)
  master.gain.setValueAtTime(0.0001, time)
  master.gain.linearRampToValueAtTime(peak, time + atk)
  const decayStart = time + atk + sustain
  master.gain.setValueAtTime(peak, decayStart)
  master.gain.exponentialRampToValueAtTime(0.001, decayStart + bDcy)
  if (release > 0.001) {
    master.gain.exponentialRampToValueAtTime(0.0001, decayStart + bDcy + release)
  }

  noiseGain.connect(master)
  oscGain.connect(master)
  thumpGain.connect(master)
  clickGain.connect(master)

  const stopT = time + bDcy + release + 0.2
  noise.start(time, noiseOffset());    noise.stop(stopT)
  osc.start(time);      osc.stop(stopT)
  thump.start(time);    thump.stop(time + 0.04)
  clickOsc.start(time); clickOsc.stop(time + cDcy + 0.05)

  buildProcessChain(ctx, master, dest, { drive, crunch, distMix, lpCutoff, hpCutoff, filterQ, reverbSend, delaySend })
}

// ─── HI-HAT ─────────────────────────────────────────────────────────────────
// Core knobs: decay (0.01–0.45 s), tone (0–1), mix (0–1)
export function playHiHat(ctx, time, {
  decay = 0.07, tone = 0.5, mix = 0.75,
  attack = 0, sustain = 0, release = 0,
  drive = null, crunch = 0, distMix = 0.5,
  lpCutoff = 20000, hpCutoff = 20, filterQ = 0.7,
  reverbSend = 0, delaySend = 0,
  velocity = 1,
} = {}, dest) {
  dest = dest ?? ctx.destination

  const BASE   = 40
  const ratios = [1, 1.3420, 1.5905, 1.9053, 2.1383, 2.6416]

  const oscMix = ctx.createGain()
  oscMix.gain.value = (1 / ratios.length) * mix * 0.55

  ratios.forEach(r => {
    const osc = ctx.createOscillator()
    osc.type = 'square'
    osc.frequency.value = BASE * r * (80 + tone * 120)
    osc.connect(oscMix)
    osc.start(time); osc.stop(time + decay + release + 0.1)
  })

  const hpf = ctx.createBiquadFilter()
  hpf.type = 'highpass'; hpf.frequency.value = 6000 + tone * 5000
  const bpf = ctx.createBiquadFilter()
  bpf.type = 'bandpass'; bpf.frequency.value = 10000 + tone * 3000; bpf.Q.value = 0.4

  // ── Master gain with optional ADSR ───────────────────────────────────────
  const master = ctx.createGain()
  const peak   = velocity
  const atk    = Math.max(attack, MIN_ATTACK)
  master.gain.setValueAtTime(0.0001, time)
  master.gain.linearRampToValueAtTime(peak, time + atk)
  const decayStart = time + atk + sustain
  master.gain.setValueAtTime(peak, decayStart)
  master.gain.exponentialRampToValueAtTime(0.001, decayStart + decay)
  if (release > 0.001) {
    master.gain.exponentialRampToValueAtTime(0.0001, decayStart + decay + release)
  }

  oscMix.connect(hpf); hpf.connect(bpf); bpf.connect(master)

  buildProcessChain(ctx, master, dest, { drive, crunch, distMix, lpCutoff, hpCutoff, filterQ, reverbSend, delaySend })
}

// ─── CLASH (CRASH CYMBAL) ────────────────────────────────────────────────────
// Core knobs: decay (0.2–4.0 s), tone (0–1), ring (0–1)
export function playClash(ctx, time, {
  decay = 1.2, tone = 0.45, ring = 0.4,
  attack = 0, sustain = 0, release = 0,
  drive = null, crunch = 0, distMix = 0.5,
  lpCutoff = 20000, hpCutoff = 20, filterQ = 0.7,
  reverbSend = 0, delaySend = 0,
  velocity = 1,
} = {}, dest) {
  dest = dest ?? ctx.destination

  const base   = 180 + tone * 380
  const ratios = [1, 1.3162, 1.4142, 1.7411, 2.0000, 2.5198]
  const totalDur = decay + release

  const oscMix = ctx.createGain()
  oscMix.gain.value = (1 / ratios.length) * 0.5

  ratios.forEach(r => {
    const osc = ctx.createOscillator()
    osc.type = 'square'
    osc.frequency.value = base * r

    if (ring > 0.02) {
      const rm     = ctx.createOscillator()
      const rmGain = ctx.createGain()
      rm.frequency.value = base * r * (1 + ring * 0.07)
      rmGain.gain.value  = ring * 0.6
      rm.connect(rmGain); rmGain.connect(oscMix)
      rm.start(time); rm.stop(time + totalDur + 0.1)
    }

    osc.connect(oscMix)
    osc.start(time); osc.stop(time + totalDur + 0.1)
  })

  // Noise shimmer layer (shared buffer, shaped by noiseEnv)
  const nLen  = Math.min(decay + 0.5, 4)
  const noiseNode = makeNoiseSource(ctx)
  const noiseBPF  = ctx.createBiquadFilter()
  noiseBPF.type = 'bandpass'; noiseBPF.frequency.value = 7000 + tone * 4000; noiseBPF.Q.value = 0.5
  const noiseEnv  = ctx.createGain()
  noiseEnv.gain.setValueAtTime(0.35, time)
  noiseEnv.gain.exponentialRampToValueAtTime(0.001, time + decay * 0.6)
  noiseNode.connect(noiseBPF); noiseBPF.connect(noiseEnv)

  const hpf = ctx.createBiquadFilter()
  hpf.type = 'highpass'; hpf.frequency.value = 4000 + tone * 4500

  // ── Master gain with optional ADSR ───────────────────────────────────────
  const master = ctx.createGain()
  const peak   = 0.7 * velocity
  const atk    = Math.max(attack, MIN_ATTACK)
  master.gain.setValueAtTime(0.0001, time)
  master.gain.linearRampToValueAtTime(peak, time + atk)
  const decayStart = time + atk + sustain
  master.gain.setValueAtTime(peak, decayStart)
  master.gain.exponentialRampToValueAtTime(0.001, decayStart + decay)
  if (release > 0.001) {
    master.gain.exponentialRampToValueAtTime(0.0001, decayStart + decay + release)
  }

  oscMix.connect(hpf); hpf.connect(master)
  noiseEnv.connect(master)
  noiseNode.start(time, noiseOffset()); noiseNode.stop(time + nLen)

  buildProcessChain(ctx, master, dest, { drive, crunch, distMix, lpCutoff, hpCutoff, filterQ, reverbSend, delaySend })
}
