// Polyphonic sawtooth synth with ADSR envelope — used for melodic channels.
export function playMelodicNote(ctx, time, { pitch = 60, decay = 0.4, attack = 0.01, wave = 'sawtooth', velocity = 1 }, dest) {
  dest = dest ?? ctx.destination
  const freq = 440 * Math.pow(2, (pitch - 69) / 12)

  const osc = ctx.createOscillator()
  const env = ctx.createGain()

  osc.type = wave
  osc.frequency.value = freq

  env.gain.setValueAtTime(0.001, time)
  env.gain.linearRampToValueAtTime(velocity * 0.7, time + Math.max(attack, 0.001))
  env.gain.exponentialRampToValueAtTime(0.001, time + Math.max(decay, 0.06))

  osc.connect(env)
  env.connect(dest)
  osc.start(time)
  osc.stop(time + decay + 0.15)
}
