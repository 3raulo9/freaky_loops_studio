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
  autofilter: { label: 'Auto Filter', defaults: { cutoff: 0.65, reso: 0.25, rate: 0.5, depth: 0 } },
  highpass:   { label: 'High-pass',  defaults: { cutoff: 0.15, reso: 0.15 } },
  eq3:        { label: '3-Band EQ',  defaults: { low: 0.5, mid: 0.5, high: 0.5, midfreq: 0.5 } },
  bitcrusher: { label: 'Bitcrusher', defaults: { bits: 0.4, drive: 0.3, mix: 1 } },
  limiter:    { label: 'Limiter',    defaults: { threshold: 0.8, release: 0.3, gain: 0.5 } },
  gate:       { label: 'Trance Gate', defaults: { rate: 0.6, depth: 1, smooth: 0.3 } },
  autopan:    { label: 'Auto Pan',   defaults: { rate: 0.4, depth: 0.7 } },
  pingpong:   { label: 'Ping-Pong Delay', defaults: { division: 0.5, feedback: 0.4, mix: 0.3 } },
}

// ── Tempo source for tempo-synced effects ─────────────────────────────────────
//   Synced effects (gate, auto pan, ping-pong) read the song tempo from here and
//   re-tune their running nodes whenever it changes.
let _bpm = 120
const _tempoListeners = new Set()
export function setEffectsTempo(bpm) {
  if (!bpm || bpm === _bpm) return
  _bpm = bpm
  for (const fn of _tempoListeners) { try { fn(bpm) } catch (_) {} }
}

// 0..1 rate knob → note division (in beats), slowest to fastest.
const SYNC_DIVS = [4, 2, 1, 1 / 2, 1 / 3, 1 / 4, 1 / 6, 1 / 8, 1 / 16]
const syncBeats = v => SYNC_DIVS[Math.round(Math.max(0, Math.min(1, v)) * (SYNC_DIVS.length - 1))]
const syncHz = v => (_bpm / 60) / syncBeats(v)
// Delay times: 1/32 … 1 bar.
const DELAY_DIVS = [1 / 8, 1 / 6, 1 / 4, 1 / 3, 1 / 2, 2 / 3, 3 / 4, 1, 1.5, 2, 4]
const delaySec = v => DELAY_DIVS[Math.round(Math.max(0, Math.min(1, v)) * (DELAY_DIVS.length - 1))] * 60 / _bpm
const logFreq = v => 20 * Math.pow(1000, Math.max(0, Math.min(1, v)))   // 0..1 → 20 Hz..20 kHz

// Staircase transfer curve: quantises amplitude to 2^bits levels.
function makeCrushCurve(bits) {
  const steps = Math.pow(2, bits)
  const n = 4096
  const curve = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1
    curve[i] = Math.round(x * steps) / steps
  }
  return curve
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

    // ── Resonant low-pass with an optional tempo-synced LFO sweep ───────────
    case 'autofilter': {
      const f = ctx.createBiquadFilter()
      f.type = 'lowpass'
      const lfo = ctx.createOscillator(); lfo.type = 'sine'
      const lfoGain = ctx.createGain()
      const st = { cutoff: fx.cutoff ?? 0.65, depth: fx.depth ?? 0, rate: fx.rate ?? 0.5 }
      const apply = () => {
        const base = logFreq(st.cutoff)
        f.frequency.value = base
        // Sweep ±depth of the cutoff (in Hz, around the base frequency).
        lfoGain.gain.value = base * 0.9 * st.depth
        lfo.frequency.value = syncHz(st.rate)
      }
      f.Q.value = 0.5 + (fx.reso ?? 0.25) * 18
      apply()
      lfo.connect(lfoGain); lfoGain.connect(f.frequency); lfo.start()
      const onTempo = () => apply()
      _tempoListeners.add(onTempo)
      return {
        input: f, output: f,
        update: (k, v) => {
          if (k === 'reso') f.Q.value = 0.5 + v * 18
          else if (k in st) { st[k] = v; apply() }
        },
        dispose: () => { _tempoListeners.delete(onTempo); try { lfo.stop() } catch (_) {}; disconnectAll([f, lfo, lfoGain]) },
      }
    }

    // ── High-pass (DJ-style low cut) ─────────────────────────────────────────
    case 'highpass': {
      const f = ctx.createBiquadFilter()
      f.type = 'highpass'
      f.frequency.value = logFreq(fx.cutoff ?? 0.15)
      f.Q.value = 0.5 + (fx.reso ?? 0.15) * 12
      return {
        input: f, output: f,
        update: (k, v) => {
          if (k === 'cutoff') f.frequency.value = logFreq(v)
          else if (k === 'reso') f.Q.value = 0.5 + v * 12
        },
        dispose: () => disconnectAll([f]),
      }
    }

    // ── 3-band EQ (0.5 = flat, ±15 dB) with a sweepable mid ─────────────────
    case 'eq3': {
      const lo = ctx.createBiquadFilter(), mid = ctx.createBiquadFilter(), hi = ctx.createBiquadFilter()
      lo.type = 'lowshelf'; lo.frequency.value = 120
      mid.type = 'peaking'; mid.Q.value = 0.9
      hi.type = 'highshelf'; hi.frequency.value = 6000
      const db = v => (v - 0.5) * 30
      lo.gain.value = db(fx.low ?? 0.5); mid.gain.value = db(fx.mid ?? 0.5); hi.gain.value = db(fx.high ?? 0.5)
      mid.frequency.value = 200 * Math.pow(25, fx.midfreq ?? 0.5)   // 200 Hz..5 kHz
      lo.connect(mid); mid.connect(hi)
      return {
        input: lo, output: hi,
        update: (k, v) => {
          if (k === 'low') lo.gain.value = db(v)
          else if (k === 'mid') mid.gain.value = db(v)
          else if (k === 'high') hi.gain.value = db(v)
          else if (k === 'midfreq') mid.frequency.value = 200 * Math.pow(25, v)
        },
        dispose: () => disconnectAll([lo, mid, hi]),
      }
    }

    // ── Bit-depth reduction (staircase waveshaper) ───────────────────────────
    case 'bitcrusher': {
      const input = ctx.createGain(), out = ctx.createGain()
      const drive = ctx.createGain(), ws = ctx.createWaveShaper(), dry = ctx.createGain(), wet = ctx.createGain()
      const bits = v => 1 + (1 - v) * 11   // 0 → 12 bits (clean) … 1 → 1 bit (destroyed)
      ws.curve = makeCrushCurve(bits(fx.bits ?? 0.4))
      drive.gain.value = 1 + (fx.drive ?? 0.3) * 4
      const mix = fx.mix ?? 1
      dry.gain.value = 1 - mix; wet.gain.value = mix
      input.connect(dry); dry.connect(out)
      input.connect(drive); drive.connect(ws); ws.connect(wet); wet.connect(out)
      return {
        input, output: out,
        update: (k, v) => {
          if (k === 'bits') ws.curve = makeCrushCurve(bits(v))
          else if (k === 'drive') drive.gain.value = 1 + v * 4
          else if (k === 'mix') { dry.gain.value = 1 - v; wet.gain.value = v }
        },
        dispose: () => disconnectAll([input, out, drive, ws, dry, wet]),
      }
    }

    // ── Brickwall limiter with makeup gain ───────────────────────────────────
    case 'limiter': {
      const c = ctx.createDynamicsCompressor()
      const makeup = ctx.createGain()
      c.knee.value = 0; c.ratio.value = 20; c.attack.value = 0.001
      c.threshold.value = -24 + (fx.threshold ?? 0.8) * 24       // -24..0 dB
      c.release.value = 0.01 + (fx.release ?? 0.3) * 0.5
      makeup.gain.value = Math.pow(10, ((fx.gain ?? 0.5) - 0.5) * 24 / 20)   // ±12 dB
      c.connect(makeup)
      return {
        input: c, output: makeup,
        update: (k, v) => {
          if (k === 'threshold') c.threshold.value = -24 + v * 24
          else if (k === 'release') c.release.value = 0.01 + v * 0.5
          else if (k === 'gain') makeup.gain.value = Math.pow(10, (v - 0.5) * 24 / 20)
        },
        dispose: () => disconnectAll([c, makeup]),
      }
    }

    // ── Tempo-synced volume gate (rhythmic chop) ─────────────────────────────
    case 'gate': {
      const vca = ctx.createGain()
      const osc = ctx.createOscillator(); osc.type = 'square'
      const smooth = ctx.createBiquadFilter(); smooth.type = 'lowpass'
      const depthG = ctx.createGain()
      const st = { rate: fx.rate ?? 0.6, depth: fx.depth ?? 1 }
      // Square LFO (±1) → smoothed → scaled by depth/2, riding on a 1 - depth/2 base.
      const apply = () => {
        osc.frequency.value = syncHz(st.rate)
        depthG.gain.value = st.depth / 2
        vca.gain.value = 1 - st.depth / 2
      }
      smooth.frequency.value = 20 + (1 - (fx.smooth ?? 0.3)) * 400
      apply()
      osc.connect(smooth); smooth.connect(depthG); depthG.connect(vca.gain); osc.start()
      const onTempo = () => apply()
      _tempoListeners.add(onTempo)
      return {
        input: vca, output: vca,
        update: (k, v) => {
          if (k === 'smooth') smooth.frequency.value = 20 + (1 - v) * 400
          else if (k in st) { st[k] = v; apply() }
        },
        dispose: () => { _tempoListeners.delete(onTempo); try { osc.stop() } catch (_) {}; disconnectAll([vca, osc, smooth, depthG]) },
      }
    }

    // ── Tempo-synced auto pan ────────────────────────────────────────────────
    case 'autopan': {
      const pan = ctx.createStereoPanner()
      const lfo = ctx.createOscillator(); lfo.type = 'sine'
      const depthG = ctx.createGain()
      const st = { rate: fx.rate ?? 0.4, depth: fx.depth ?? 0.7 }
      const apply = () => { lfo.frequency.value = syncHz(st.rate); depthG.gain.value = st.depth }
      apply()
      lfo.connect(depthG); depthG.connect(pan.pan); lfo.start()
      const onTempo = () => apply()
      _tempoListeners.add(onTempo)
      return {
        input: pan, output: pan,
        update: (k, v) => { if (k in st) { st[k] = v; apply() } },
        dispose: () => { _tempoListeners.delete(onTempo); try { lfo.stop() } catch (_) {}; disconnectAll([pan, lfo, depthG]) },
      }
    }

    // ── Tempo-synced ping-pong delay (echoes bounce left ↔ right) ────────────
    case 'pingpong': {
      const input = ctx.createGain(), out = ctx.createGain(), dry = ctx.createGain(), wet = ctx.createGain()
      const mono = ctx.createGain()
      const dL = ctx.createDelay(4), dR = ctx.createDelay(4)
      const fbL = ctx.createGain(), fbR = ctx.createGain()
      const merger = ctx.createChannelMerger(2)
      const st = { division: fx.division ?? 0.5 }
      const apply = () => { const t = delaySec(st.division); dL.delayTime.value = t; dR.delayTime.value = t }
      apply()
      const fb = v => Math.min(0.92, v)
      fbL.gain.value = fbR.gain.value = fb(fx.feedback ?? 0.4)
      const mix = fx.mix ?? 0.3
      dry.gain.value = 1; wet.gain.value = mix
      input.connect(dry); dry.connect(out)
      input.connect(mono); mono.connect(dL)
      dL.connect(merger, 0, 0); dL.connect(fbL); fbL.connect(dR)
      dR.connect(merger, 0, 1); dR.connect(fbR); fbR.connect(dL)
      merger.connect(wet); wet.connect(out)
      const onTempo = () => apply()
      _tempoListeners.add(onTempo)
      return {
        input, output: out,
        update: (k, v) => {
          if (k === 'division') { st.division = v; apply() }
          else if (k === 'feedback') { fbL.gain.value = fbR.gain.value = fb(v) }
          else if (k === 'mix') wet.gain.value = v
        },
        dispose: () => { _tempoListeners.delete(onTempo); disconnectAll([input, out, dry, wet, mono, dL, dR, fbL, fbR, merger]) },
      }
    }

    // ── Unknown type → transparent pass-through ──────────────────────────────
    default: {
      const g = ctx.createGain()
      return { input: g, output: g, update: () => {}, dispose: () => disconnectAll([g]) }
    }
  }
}
