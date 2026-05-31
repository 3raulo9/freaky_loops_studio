import { buildProcessChain } from './audioUtils.js'

// Polyphonic sawtooth synth with ADSR envelope — used for melodic channels.
// gate (seconds): note duration from piano roll. When provided, the sound sustains
// at full level until gate closes, then releases over `decay` seconds.
// Without gate (step mode), decay = total duration as before.
export function playMelodicNote(ctx, time, {
  pitch = 60, decay = 0.4, attack = 0.01, wave = 'sawtooth', velocity = 1, gate = null,
  drive = null, crunch = 0, distMix = 0.5,
  lpCutoff = 20000, hpCutoff = 20, filterQ = 0.7,
  reverbSend = 0, delaySend = 0,
} = {}, dest) {
  dest = dest ?? ctx.destination
  const freq = 440 * Math.pow(2, (pitch - 69) / 12)

  const osc = ctx.createOscillator()
  const env = ctx.createGain()

  osc.type = wave
  osc.frequency.value = freq

  env.gain.setValueAtTime(0.001, time)
  env.gain.linearRampToValueAtTime(velocity * 0.7, time + Math.max(attack, 0.001))

  if (gate !== null) {
    // Piano-roll mode: sustain until note-off, then release over `decay` seconds
    const holdEnd = Math.max(time + gate - decay, time + attack)
    env.gain.setValueAtTime(velocity * 0.7, holdEnd)
    env.gain.linearRampToValueAtTime(0.001, time + gate + decay * 0.5)
  } else {
    env.gain.exponentialRampToValueAtTime(0.001, time + Math.max(decay, 0.06))
  }

  osc.connect(env)
  osc.start(time)
  osc.stop(time + (gate !== null ? gate + decay + 0.1 : decay + 0.15))

  buildProcessChain(ctx, env, dest, { drive, crunch, distMix, lpCutoff, hpCutoff, filterQ, reverbSend, delaySend })
}
