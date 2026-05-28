// All drum sounds are synthesized with Web Audio API — no sample files.
// Each function accepts an AudioNode `dest` so callers can route through
// per-track gain nodes for volume control.

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
// knobs: pitch (30–140 Hz), decay (0.15–1.6 s), punch (0–1 distortion drive)
export function playKick(ctx, time, { pitch, decay, punch }, dest) {
  dest = dest ?? ctx.destination
  const masterGain = ctx.createGain()
  masterGain.connect(dest)
  masterGain.gain.setValueAtTime(1.2, time)
  masterGain.gain.exponentialRampToValueAtTime(0.001, time + decay)

  // Main sine body with falling pitch envelope
  const body = ctx.createOscillator()
  const bodyGain = ctx.createGain()
  body.type = 'sine'
  body.frequency.setValueAtTime(pitch * 5.5, time)
  body.frequency.exponentialRampToValueAtTime(pitch, time + 0.055)
  bodyGain.gain.value = 1.0
  body.connect(bodyGain)

  // Second harmonic for warmth
  const sub = ctx.createOscillator()
  const subGain = ctx.createGain()
  sub.type = 'sine'
  sub.frequency.setValueAtTime(pitch * 2.5, time)
  sub.frequency.exponentialRampToValueAtTime(pitch * 0.5, time + 0.03)
  subGain.gain.value = 0.5
  sub.connect(subGain)

  // Click transient for attack snap
  const click = ctx.createOscillator()
  const clickGain = ctx.createGain()
  click.type = 'square'
  click.frequency.value = 1600
  clickGain.gain.setValueAtTime(punch * 0.6, time)
  clickGain.gain.exponentialRampToValueAtTime(0.001, time + 0.008)
  click.connect(clickGain)

  // Waveshaper for punch / saturation
  const dist = ctx.createWaveShaper()
  dist.curve = makeDistortionCurve(punch * 120)
  dist.oversample = '4x'

  bodyGain.connect(dist)
  subGain.connect(dist)
  clickGain.connect(masterGain)
  dist.connect(masterGain)

  body.start(time);  body.stop(time + decay + 0.1)
  sub.start(time);   sub.stop(time + decay + 0.1)
  click.start(time); click.stop(time + 0.05)
}

// ─── SNARE ──────────────────────────────────────────────────────────────────
// knobs: snap (0–1 noise level), tone (80–700 Hz body), decay (0.04–0.9 s)
export function playSnare(ctx, time, { snap, tone, decay }, dest) {
  dest = dest ?? ctx.destination

  // White noise burst
  const noiseLen = Math.max(decay, 0.08)
  const buf = ctx.createBuffer(1, ctx.sampleRate * noiseLen, ctx.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1

  const noise = ctx.createBufferSource()
  noise.buffer = buf

  const noiseHPF = ctx.createBiquadFilter()
  noiseHPF.type = 'highpass'
  noiseHPF.frequency.value = tone * 3.5

  const noiseBPF = ctx.createBiquadFilter()
  noiseBPF.type = 'bandpass'
  noiseBPF.frequency.value = tone * 8
  noiseBPF.Q.value = 0.7

  const noiseGain = ctx.createGain()
  noiseGain.gain.setValueAtTime(snap, time)
  noiseGain.gain.exponentialRampToValueAtTime(0.001, time + decay)

  noise.connect(noiseHPF)
  noiseHPF.connect(noiseBPF)
  noiseBPF.connect(noiseGain)
  noiseGain.connect(dest)
  noise.start(time); noise.stop(time + noiseLen + 0.05)

  // Tonal body
  const osc = ctx.createOscillator()
  const oscGain = ctx.createGain()
  osc.type = 'triangle'
  osc.frequency.setValueAtTime(tone * 1.3, time)
  osc.frequency.exponentialRampToValueAtTime(tone * 0.7, time + decay * 0.35)
  oscGain.gain.setValueAtTime(0.85, time)
  oscGain.gain.exponentialRampToValueAtTime(0.001, time + decay * 0.4)
  osc.connect(oscGain)
  oscGain.connect(dest)
  osc.start(time); osc.stop(time + decay * 0.45)

  // Sub thump transient
  const thump = ctx.createOscillator()
  const thumpGain = ctx.createGain()
  thump.type = 'sine'
  thump.frequency.value = tone * 0.4
  thumpGain.gain.setValueAtTime(0.6, time)
  thumpGain.gain.exponentialRampToValueAtTime(0.001, time + 0.025)
  thump.connect(thumpGain)
  thumpGain.connect(dest)
  thump.start(time); thump.stop(time + 0.04)
}

// ─── HI-HAT ─────────────────────────────────────────────────────────────────
// knobs: decay (0.01–0.45 s), tone (0–1 filter brightness), mix (0–1 level)
export function playHiHat(ctx, time, { decay, tone, mix }, dest) {
  dest = dest ?? ctx.destination

  // Six square oscillators at TR-909 inharmonic cymbal ratios
  const BASE = 40
  const ratios = [1, 1.3420, 1.5905, 1.9053, 2.1383, 2.6416]

  const merger = ctx.createGain()
  merger.gain.value = (1 / ratios.length) * mix * 0.55

  ratios.forEach(r => {
    const osc = ctx.createOscillator()
    osc.type = 'square'
    osc.frequency.value = BASE * r * (80 + tone * 120)
    osc.connect(merger)
    osc.start(time); osc.stop(time + decay + 0.05)
  })

  const hpf = ctx.createBiquadFilter()
  hpf.type = 'highpass'
  hpf.frequency.value = 6000 + tone * 5000

  const bpf = ctx.createBiquadFilter()
  bpf.type = 'bandpass'
  bpf.frequency.value = 10000 + tone * 3000
  bpf.Q.value = 0.4

  const envGain = ctx.createGain()
  envGain.gain.setValueAtTime(1.0, time)
  envGain.gain.exponentialRampToValueAtTime(0.001, time + decay)

  merger.connect(hpf)
  hpf.connect(bpf)
  bpf.connect(envGain)
  envGain.connect(dest)
}

// ─── CLASH (CRASH CYMBAL) ────────────────────────────────────────────────────
// knobs: decay (0.2–4.0 s), tone (0–1 base pitch), ring (0–1 metallic ring)
export function playClash(ctx, time, { decay, tone, ring }, dest) {
  dest = dest ?? ctx.destination
  const base = 180 + tone * 380

  // TR-808 crash: 6 square oscillators at inharmonic cymbal ratios
  const ratios = [1, 1.3162, 1.4142, 1.7411, 2.0000, 2.5198]

  const oscMix = ctx.createGain()
  oscMix.gain.value = (1 / ratios.length) * 0.5

  ratios.forEach(r => {
    const osc = ctx.createOscillator()
    osc.type = 'square'
    osc.frequency.value = base * r

    if (ring > 0.02) {
      const rm = ctx.createOscillator()
      const rmGain = ctx.createGain()
      rm.frequency.value = base * r * (1 + ring * 0.07)
      rmGain.gain.value = ring * 0.6
      rm.connect(rmGain)
      rmGain.connect(oscMix)
      rm.start(time); rm.stop(time + decay + 0.1)
    }

    osc.connect(oscMix)
    osc.start(time); osc.stop(time + decay + 0.1)
  })

  // Noise layer for air / shimmer
  const nLen = Math.min(decay + 0.5, 4)
  const nbuf = ctx.createBuffer(1, ctx.sampleRate * nLen, ctx.sampleRate)
  const nd = nbuf.getChannelData(0)
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1

  const noiseNode = ctx.createBufferSource()
  noiseNode.buffer = nbuf

  const noiseBPF = ctx.createBiquadFilter()
  noiseBPF.type = 'bandpass'
  noiseBPF.frequency.value = 7000 + tone * 4000
  noiseBPF.Q.value = 0.5

  const noiseEnv = ctx.createGain()
  noiseEnv.gain.setValueAtTime(0.35, time)
  noiseEnv.gain.exponentialRampToValueAtTime(0.001, time + decay * 0.6)

  noiseNode.connect(noiseBPF)
  noiseBPF.connect(noiseEnv)
  noiseEnv.connect(dest)
  noiseNode.start(time); noiseNode.stop(time + nLen)

  const hpf = ctx.createBiquadFilter()
  hpf.type = 'highpass'
  hpf.frequency.value = 4000 + tone * 4500

  const envGain = ctx.createGain()
  envGain.gain.setValueAtTime(0.7, time)
  envGain.gain.exponentialRampToValueAtTime(0.001, time + decay)

  oscMix.connect(hpf)
  hpf.connect(envGain)
  envGain.connect(dest)
}
