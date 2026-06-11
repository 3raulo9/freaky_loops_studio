// ─── Per-channel insert FX engine ──────────────────────────────────────────────
//   Each effect is a small Web Audio sub-graph with a single `input` and `output`
//   node so the channel-rack effect chain can be wired linearly:
//
//     channel → panner → fx[0].input … fx[0].output → fx[1].input … → mixer/master
//
//   `createEffect(ctx, fx)` returns a live handle `{ input, output, update, dispose }`.
//   `update(key, value)` mutates a single parameter on the running graph (no
//   reconnection, so knob drags stay click-free); `dispose()` stops any running
//   oscillators and disconnects every node so a rebuilt chain can be GC'd.

// Effect catalogue: type → label + default parameter values. Drives the "add
// effect" menu and the parameter set stored on each channel's effects[] entry.
export const EFFECT_DEFS = {
  distortion: { label: 'Distortion', defaults: { drive: 0.35, tone: 0.5 } },
  reverb:     { label: 'Reverb',     defaults: { size: 0.5, decay: 0.5, mix: 0.3 } },
  delay:      { label: 'Delay',      defaults: { time: 0.3, feedback: 0.35, mix: 0.3 } },
  chorus:     { label: 'Chorus',     defaults: { rate: 0.3, depth: 0.45, mix: 0.5 } },
  flanger:    { label: 'Flanger',    defaults: { rate: 0.2, depth: 0.4, feedback: 0.3, mix: 0.5 } },
  phaser:     { label: 'Phaser',     defaults: { rate: 0.3, depth: 0.5, mix: 0.5 } },
  compressor: { label: 'Compressor', defaults: { threshold: 0.5, ratio: 4 } },
  dimension:  { label: 'Dimension',  defaults: { mix: 0.5, width: 0.6 } },
  volume:     { label: 'Volume',     defaults: { value: 0.8 } },
}

// Build a fresh effect data object (plain, reactive-friendly) for a given type.
export function makeEffect(type) {
  const def = EFFECT_DEFS[type]
  if (!def) return null
  return { type, enabled: true, ...def.defaults }
}

// ── DSP helpers ────────────────────────────────────────────────────────────────

// Decaying white-noise impulse response for the convolution reverb.
function makeImpulse(ctx, seconds, decay) {
  const rate = ctx.sampleRate
  const len  = Math.max(1, Math.floor(rate * seconds))
  const buf  = ctx.createBuffer(2, len, rate)
  for (let c = 0; c < 2; c++) {
    const data = buf.getChannelData(c)
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay)
    }
  }
  return buf
}

// Soft-clipping transfer curve for the waveshaper distortion.
function makeDistortionCurve(amount) {
  const k = Math.max(0, amount) * 100
  const n = 1024
  const curve = new Float32Array(n)
  const deg = Math.PI / 180
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1
    curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x))
  }
  return curve
}

function disconnectAll(nodes) {
  for (const n of nodes) { if (n) { try { n.disconnect() } catch (_) {} } }
}

// ── Effect factory ──────────────────────────────────────────────────────────────
export function createEffect(ctx, fx) {
  switch (fx.type) {
    // ── Output trim ──────────────────────────────────────────────────────────
    case 'volume': {
      const g = ctx.createGain()
      g.gain.value = fx.value ?? 0.8
      return {
        input: g, output: g,
        update: (k, v) => { if (k === 'value') g.gain.value = v },
        dispose: () => disconnectAll([g]),
      }
    }

    // ── Waveshaper distortion + tone lowpass ─────────────────────────────────
    case 'distortion': {
      const inGain = ctx.createGain()
      const ws     = ctx.createWaveShaper()
      const tone   = ctx.createBiquadFilter()
      ws.curve = makeDistortionCurve(fx.drive ?? 0.35)
      ws.oversample = '2x'
      tone.type = 'lowpass'
      tone.frequency.value = 500 + (fx.tone ?? 0.5) * 7500
      inGain.connect(ws); ws.connect(tone)
      return {
        input: inGain, output: tone,
        update: (k, v) => {
          if (k === 'drive')     ws.curve = makeDistortionCurve(v)
          else if (k === 'tone') tone.frequency.value = 500 + v * 7500
        },
        dispose: () => disconnectAll([inGain, ws, tone]),
      }
    }

    // ── Convolution reverb (generated IR) with wet/dry mix ───────────────────
    case 'reverb': {
      const input = ctx.createGain()
      const out   = ctx.createGain()
      const dry   = ctx.createGain()
      const wet   = ctx.createGain()
      const conv  = ctx.createConvolver()
      const params = { size: fx.size ?? 0.5, decay: fx.decay ?? 0.5 }
      const mix = fx.mix ?? 0.3
      conv.buffer  = makeImpulse(ctx, 0.1 + params.size * 3, 1 + params.decay * 4)
      dry.gain.value = 1 - mix
      wet.gain.value = mix
      input.connect(dry); dry.connect(out)
      input.connect(conv); conv.connect(wet); wet.connect(out)
      return {
        input, output: out,
        update: (k, v) => {
          if (k === 'mix') { dry.gain.value = 1 - v; wet.gain.value = v }
          else if (k === 'size' || k === 'decay') {
            params[k] = v
            conv.buffer = makeImpulse(ctx, 0.1 + params.size * 3, 1 + params.decay * 4)
          }
        },
        dispose: () => disconnectAll([input, out, dry, wet, conv]),
      }
    }

    // ── Dynamics compressor ──────────────────────────────────────────────────
    case 'compressor': {
      const c = ctx.createDynamicsCompressor()
      c.threshold.value = -60 + (fx.threshold ?? 0.5) * 60   // 0→-60 dB, 1→0 dB
      c.ratio.value     = fx.ratio ?? 4
      c.knee.value      = 6
      c.attack.value    = 0.005
      c.release.value   = 0.12
      return {
        input: c, output: c,
        update: (k, v) => {
          if (k === 'threshold')  c.threshold.value = -60 + v * 60
          else if (k === 'ratio') c.ratio.value = v
        },
        dispose: () => disconnectAll([c]),
      }
    }

    // ── Feedback delay with wet/dry mix ──────────────────────────────────────
    case 'delay': {
      const input = ctx.createGain()
      const out   = ctx.createGain()
      const dry   = ctx.createGain()
      const wet   = ctx.createGain()
      const delay = ctx.createDelay(2.0)
      const fb    = ctx.createGain()
      const mix   = fx.mix ?? 0.3
      delay.delayTime.value = (fx.time ?? 0.3)
      fb.gain.value   = Math.min(0.95, fx.feedback ?? 0.35)
      dry.gain.value  = 1 - mix
      wet.gain.value  = mix
      input.connect(dry); dry.connect(out)
      input.connect(delay); delay.connect(fb); fb.connect(delay)
      delay.connect(wet); wet.connect(out)
      return {
        input, output: out,
        update: (k, v) => {
          if (k === 'time')          delay.delayTime.value = v
          else if (k === 'feedback') fb.gain.value = Math.min(0.95, v)
          else if (k === 'mix')      { dry.gain.value = 1 - v; wet.gain.value = v }
        },
        dispose: () => disconnectAll([input, out, dry, wet, delay, fb]),
      }
    }

    // ── Chorus / Flanger (LFO-modulated delay) ───────────────────────────────
    case 'chorus':
    case 'flanger': {
      const isFlanger = fx.type === 'flanger'
      const input = ctx.createGain()
      const out   = ctx.createGain()
      const dry   = ctx.createGain()
      const wet   = ctx.createGain()
      const delay = ctx.createDelay(0.1)
      const base  = isFlanger ? 0.003 : 0.025
      delay.delayTime.value = base
      const lfo     = ctx.createOscillator()
      const lfoGain = ctx.createGain()
      const sweep   = isFlanger ? 0.002 : 0.008
      lfo.type = 'sine'
      lfo.frequency.value = 0.1 + (fx.rate ?? 0.3) * 5
      lfoGain.gain.value  = (fx.depth ?? 0.4) * sweep
      lfo.connect(lfoGain); lfoGain.connect(delay.delayTime)
      lfo.start()
      let fb = null
      if (isFlanger) {
        fb = ctx.createGain()
        fb.gain.value = Math.min(0.9, fx.feedback ?? 0.3)
        delay.connect(fb); fb.connect(delay)
      }
      const mix = fx.mix ?? 0.5
      dry.gain.value = 1 - mix * 0.5
      wet.gain.value = mix
      input.connect(dry); dry.connect(out)
      input.connect(delay); delay.connect(wet); wet.connect(out)
      return {
        input, output: out,
        update: (k, v) => {
          if (k === 'rate')          lfo.frequency.value = 0.1 + v * 5
          else if (k === 'depth')    lfoGain.gain.value = v * sweep
          else if (k === 'feedback' && fb) fb.gain.value = Math.min(0.9, v)
          else if (k === 'mix')      { dry.gain.value = 1 - v * 0.5; wet.gain.value = v }
        },
        dispose: () => { try { lfo.stop() } catch (_) {}; disconnectAll([input, out, dry, wet, delay, lfoGain, fb]) },
      }
    }

    // ── Phaser (cascaded all-pass filters swept by an LFO) ───────────────────
    case 'phaser': {
      const input = ctx.createGain()
      const out   = ctx.createGain()
      const dry   = ctx.createGain()
      const wet   = ctx.createGain()
      const STAGES = 4
      const filters = []
      for (let i = 0; i < STAGES; i++) {
        const f = ctx.createBiquadFilter()
        f.type = 'allpass'
        f.frequency.value = 300 + i * 450
        filters.push(f)
      }
      for (let i = 0; i < STAGES - 1; i++) filters[i].connect(filters[i + 1])
      const lfo     = ctx.createOscillator()
      const lfoGain = ctx.createGain()
      lfo.type = 'sine'
      lfo.frequency.value = 0.1 + (fx.rate ?? 0.3) * 4
      lfoGain.gain.value  = (fx.depth ?? 0.5) * 800
      filters.forEach(f => lfoGain.connect(f.frequency))
      lfo.connect(lfoGain); lfo.start()
      const mix = fx.mix ?? 0.5
      dry.gain.value = 1
      wet.gain.value = mix
      input.connect(dry); dry.connect(out)
      input.connect(filters[0]); filters[STAGES - 1].connect(wet); wet.connect(out)
      return {
        input, output: out,
        update: (k, v) => {
          if (k === 'rate')       lfo.frequency.value = 0.1 + v * 4
          else if (k === 'depth') lfoGain.gain.value = v * 800
          else if (k === 'mix')   wet.gain.value = v
        },
        dispose: () => { try { lfo.stop() } catch (_) {}; disconnectAll([input, out, dry, wet, lfoGain, ...filters]) },
      }
    }

    // ── Dimension (stereo widener: two short delays panned L/R) ──────────────
    case 'dimension': {
      const input = ctx.createGain()
      const out   = ctx.createGain()
      const dry   = ctx.createGain()
      const wet   = ctx.createGain()
      const width = fx.width ?? 0.6
      const dL = ctx.createDelay(0.05)
      const dR = ctx.createDelay(0.05)
      dL.delayTime.value = 0.011
      dR.delayTime.value = 0.018
      const pL = ctx.createStereoPanner(); pL.pan.value = -width
      const pR = ctx.createStereoPanner(); pR.pan.value =  width
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.3
      const lg  = ctx.createGain();  lg.gain.value = 0.002
      lfo.connect(lg); lg.connect(dL.delayTime); lg.connect(dR.delayTime); lfo.start()
      dry.gain.value = 1
      wet.gain.value = fx.mix ?? 0.5
      input.connect(dry); dry.connect(out)
      input.connect(dL); dL.connect(pL); pL.connect(wet)
      input.connect(dR); dR.connect(pR); pR.connect(wet)
      wet.connect(out)
      return {
        input, output: out,
        update: (k, v) => {
          if (k === 'mix')        wet.gain.value = v
          else if (k === 'width') { pL.pan.value = -v; pR.pan.value = v }
        },
        dispose: () => { try { lfo.stop() } catch (_) {}; disconnectAll([input, out, dry, wet, dL, dR, pL, pR, lg]) },
      }
    }

    // ── Unknown type → transparent pass-through ──────────────────────────────
    default: {
      const g = ctx.createGain()
      return { input: g, output: g, update: () => {}, dispose: () => disconnectAll([g]) }
    }
  }
}
