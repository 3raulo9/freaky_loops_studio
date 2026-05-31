// Custom Synth — Serum-style wavetable AudioWorklet.
// Dual wavetable oscillators · 5 warp modes · FM · sub+noise · ADSR×3 · LFO×4
// Mod matrix · SVF filter · unison · distortion / delay / reverb

const PI2  = 2 * Math.PI
const FSIZ = 512       // samples per wavetable frame
const NFRM = 64        // frames per table
const MPOLY = 8        // polyphony
const MUNI  = 8        // max unison voices per oscillator

// ─── Wavetable generation ────────────────────────────────────────────────────
function buildTable(fn) {
  const d = new Float32Array(NFRM * FSIZ)
  for (let f = 0; f < NFRM; f++) {
    const t = f / (NFRM - 1)
    for (let i = 0; i < FSIZ; i++) d[f * FSIZ + i] = fn(i / FSIZ, t)
  }
  return d
}

const TABLES = {
  basic: buildTable((p, t) => {
    const si = Math.sin(PI2 * p)
    const tr = p < .25 ? 4*p : p < .75 ? 2-4*p : 4*p-4
    const sa = 1 - 2*p
    const sq = p < .5 ? 1 : -1
    if (t < .333) { const b=t*3;          return si*(1-b) + tr*b }
    if (t < .667) { const b=(t-.333)*3;   return tr*(1-b) + sa*b }
                  { const b=(t-.667)*3;   return sa*(1-b) + sq*b }
  }),
  spectral: buildTable((p, t) => {
    const n = 1 + Math.round(t * 7); let o = 0, nm = 0
    for (let h = 1; h <= n; h++) { const a=1/h; o += Math.sin(PI2*p*h)*a; nm += a }
    return o / nm
  }),
  pwm: buildTable((p, t) => {
    const pw = 0.05 + t * 0.9
    return p < pw ? 1 : -1
  }),
  digital: buildTable((p, t) => {
    let x = (1 - 2*p) * (1 + t * 3)
    while (x >  1) x = 2 - x
    while (x < -1) x = -2 - x
    return x
  }),
  formant: buildTable((p, t) => {
    const V = [[800,1200],[400,2200],[350,2900],[600,900],[350,700]]
    const vi = t*(V.length-1), lo=Math.min(Math.floor(vi),V.length-2), bl=vi-lo
    const f1=V[lo][0]*(1-bl)+V[lo+1][0]*bl, f2=V[lo][1]*(1-bl)+V[lo+1][1]*bl
    return (Math.sin(PI2*p*(f1/220))*.55 + Math.sin(PI2*p*(f2/220))*.45) * 0.7
  }),
  noise:   buildTable((p, t) => Math.sin(PI2 * p * (1 + Math.floor(t*15))) * (1 - t*0.5)),
}

// ─── Wavetable lookup (bilinear interpolation) ───────────────────────────────
function wtRead(tbl, frame, phase) {
  const f0 = Math.max(0, Math.min(NFRM-2, Math.floor(frame)))
  const f1 = f0 + 1
  const fb = frame - f0
  const p  = ((phase % 1) + 1) % 1
  const ii = Math.floor(p * FSIZ)
  const i1 = (ii + 1) % FSIZ
  const ib = p * FSIZ - ii
  const s0 = tbl[f0*FSIZ+ii]*(1-ib) + tbl[f0*FSIZ+i1]*ib
  const s1 = tbl[f1*FSIZ+ii]*(1-ib) + tbl[f1*FSIZ+i1]*ib
  return s0*(1-fb) + s1*fb
}

// ─── Warp modes (reshape the playback phase) ─────────────────────────────────
function warpPhase(ph, mode, amt) {
  switch (mode) {
    case 'bend+': return Math.pow(ph, 1 + amt * 3)
    case 'bend-': return 1 - Math.pow(1 - ph, 1 + amt * 3)
    case 'pwm': {
      const pw = 0.05 + amt * 0.9
      return ph < pw ? ph / (2*pw) : 0.5 + (ph - pw) / (2*(1-pw))
    }
    case 'asym+': {
      const a = 0.1 + amt * 0.8
      return ph < a ? ph / (2*a) : 0.5 + (ph - a) / (2*(1-a))
    }
    case 'asym-': {
      const a = 0.9 - amt * 0.8
      return ph < a ? ph / (2*a) : 0.5 + (ph - a) / (2*(1-a))
    }
    default: return ph
  }
}

// ─── State-variable filter (per-voice safer) ─────────────────────────────────
function svfTick(s, x, f, q) {
  s.lp += f * s.bp
  const hp = x - s.lp - q * s.bp
  s.bp += f * hp
  return { lp: s.lp, hp, bp: s.bp }
}

// ─── Soft-clip saturation ────────────────────────────────────────────────────
function sat(x, drive) {
  const g = 1 + drive * 5
  const y = x * g
  return y / (1 + Math.abs(y))
}

// ─── LFO shape evaluator ─────────────────────────────────────────────────────
function lfoVal(shape, phase) {
  const p = ((phase % 1) + 1) % 1
  switch (shape) {
    case 'triangle': return p < .5 ? 4*p - 1 : 3 - 4*p
    case 'square':   return p < .5 ? 1 : -1
    case 'sawtooth': return 1 - 2*p
    case 'sah':      return p < .5 ? 1 : -1   // simplified S&H
    default:         return Math.sin(PI2 * p)
  }
}

// ─── ADSR (sample-rate accurate) ─────────────────────────────────────────────
function adsrTick(env, p, sr) {
  switch (env.stage) {
    case 'atk': {
      const rate = p.a > 0 ? 1 / (p.a * sr) : 1
      env.lv = Math.min(1, env.lv + rate)
      if (env.lv >= 1) { env.lv = 1; env.stage = 'dec' }
      break
    }
    case 'dec': {
      const factor = p.d > 0 ? Math.pow(0.001, 1 / (p.d * sr)) : 0
      env.lv += (p.s - env.lv) * (1 - factor)
      if (Math.abs(env.lv - p.s) < 2e-4) { env.lv = p.s; env.stage = 'sus' }
      break
    }
    case 'sus':
      env.lv = p.s
      break
    case 'rel': {
      const factor = p.r > 0 ? Math.pow(0.001, 1 / (p.r * sr)) : 0
      env.lv *= factor
      if (env.lv < 1e-4) { env.lv = 0; env.stage = 'done' }
      break
    }
    default: env.lv = 0
  }
  return env.lv
}

// ─── FX buffers (shared globals) ─────────────────────────────────────────────
const DLY_MAX = 88200
const dlyL = new Float32Array(DLY_MAX), dlyR = new Float32Array(DLY_MAX)
let dlyPos = 0
const RV_SIZES = [1557, 1617, 1491, 1422, 1277]
const rvBufs = RV_SIZES.map(n => ({ l: new Float32Array(n), r: new Float32Array(n), pos: 0 }))

// ─── Default patch ───────────────────────────────────────────────────────────
let P = {
  oscA: { table:'basic',  wtPos:.3, level:1,  pan:0, oct:0, semi:0, fine:0,
          warp:'none', warpAmt:0, unison:1, detune:.3, blend:.5, on:true  },
  oscB: { table:'spectral', wtPos:.4, level:.5, pan:0, oct:0, semi:0, fine:0,
          warp:'none', warpAmt:0, unison:1, detune:.3, blend:.5, on:false },
  sub:    { level:.3, oct:-1, on:false },
  noise:  { level:.2, on:false },
  filter: { on:true, type:'lowpass', cutoff:.75, reso:.25, drive:0, keytrack:0 },
  env1:   { a:.005, d:.25, s:.7,  r:.25 },   // amp — must have audible release
  env2:   { a:0,    d:.5,  s:.0,  r:.1 },
  env3:   { a:0,    d:.3,  s:.5,  r:.2 },
  lfos:   [
    { shape:'sine',     rate:.35, amt:0, dest:'none' },
    { shape:'triangle', rate:.5,  amt:0, dest:'none' },
    { shape:'square',   rate:.2,  amt:0, dest:'none' },
    { shape:'sawtooth', rate:.6,  amt:0, dest:'none' },
  ],
  fx: {
    dist:   { on:false, drive:.4, mix:.5 },
    delay:  { on:false, time:.25, fb:.4, mix:.3 },
    reverb: { on:false, size:.5,  mix:.3 },
  },
  modRoutes: [],
  masterGain: 0.7,
}

// ─── Voice + envelope state ──────────────────────────────────────────────────
function mkVoice() {
  return {
    on: false, note: -1, vel: 0, age: 0,
    phA:  new Float32Array(MUNI), syA: new Float32Array(MUNI),
    phB:  new Float32Array(MUNI), phSub: 0,
    flt:  { lp: 0, bp: 0 },
    e1: { stage: 'done', lv: 0 },
    e2: { stage: 'done', lv: 0 },
    e3: { stage: 'done', lv: 0 },
  }
}
const voices = Array.from({ length: MPOLY }, mkVoice)

function noteOn(pitch, vel) {
  // Prefer a free voice; otherwise steal the oldest finishing voice
  let v = voices.find(v => !v.on)
  if (!v) {
    v = voices.reduce((a, b) => (a.e1.stage === 'rel' && b.e1.stage !== 'rel' ? a : (a.age > b.age ? a : b)))
  }
  Object.assign(v, { on: true, note: pitch, vel: vel/127, age: 0 })
  v.phA.fill(0); v.syA.fill(0); v.phB.fill(0); v.phSub = 0
  v.flt.lp = 0; v.flt.bp = 0
  v.e1 = { stage: 'atk', lv: 0 }
  v.e2 = { stage: 'atk', lv: 0 }
  v.e3 = { stage: 'atk', lv: 0 }
}

function noteOff(pitch) {
  voices.filter(v => v.on && v.note === pitch).forEach(v => {
    v.e1.stage = 'rel'
    v.e2.stage = 'rel'
    v.e3.stage = 'rel'
  })
}

function allNotesOff() {
  voices.forEach(v => { v.e1.stage = 'rel'; v.e2.stage = 'rel'; v.e3.stage = 'rel' })
}

const midiF = n => 440 * Math.pow(2, (n - 69) / 12)

// ─── Global LFO phases ───────────────────────────────────────────────────────
const lfoPhases = [0, 0, 0, 0]
const lfoVals   = [0, 0, 0, 0]

// ─── Processor ───────────────────────────────────────────────────────────────
class CustomSynthProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this._tick = 0

    this.port.onmessage = ({ data }) => {
      switch (data.type) {
        case 'noteOn':       noteOn(data.pitch, data.velocity * 127); break
        case 'noteOff':      noteOff(data.pitch); break
        case 'allNotesOff':  allNotesOff(); break
        case 'param':        this._setP(data.path, data.value); break
        case 'modRoutes':    P.modRoutes = data.routes || []; break
        case 'getWave':      this._wave(data.osc); break
        case 'fullState':    this._mergeState(data.state); break
      }
    }
  }

  _setP(path, val) {
    const k = path.split('.')
    let o = P
    for (let i = 0; i < k.length - 1; i++) {
      // Support array indices in LFO paths e.g. "lfos.0.rate"
      const key = k[i]
      const idx = /^\d+$/.test(key) ? Number(key) : key
      o = o[idx]
      if (o === undefined) return
    }
    const last = k[k.length - 1]
    o[/^\d+$/.test(last) ? Number(last) : last] = val
  }

  _mergeState(s) {
    if (!s || typeof s !== 'object') return
    const merge = (dst, src) => {
      for (const k in src) {
        if (src[k] && typeof src[k] === 'object' && !Array.isArray(src[k])) {
          if (!dst[k]) dst[k] = {}
          merge(dst[k], src[k])
        } else {
          dst[k] = src[k]
        }
      }
    }
    merge(P, s)
  }

  _wave(osc) {
    const op = osc === 'A' ? P.oscA : P.oscB
    const tbl = TABLES[op.table] ?? TABLES.basic
    const frm = op.wtPos * (NFRM - 1)
    const s = new Float32Array(FSIZ)
    for (let i = 0; i < FSIZ; i++) s[i] = wtRead(tbl, frm, i / FSIZ)
    this.port.postMessage({ type: 'waveform', osc, samples: s })
  }

  process(_in, outs) {
    const out = outs[0]
    if (!out?.length) return true
    const L = out[0]
    const R = out[1] || out[0]
    const sr = sampleRate
    const n = L.length

    L.fill(0); R.fill(0)

    // Pre-compute LFO increments and sample once per block
    const lfoInc = lfoPhases.map((_, i) => (PI2 * Math.pow(10, P.lfos[i].rate * 4 - 2)) / sr)
    for (let i = 0; i < 4; i++) {
      lfoVals[i] = lfoVal(P.lfos[i].shape, lfoPhases[i] / PI2)
    }

    // Build mod dictionary: dest → accumulated value
    const mod = {}
    for (const r of P.modRoutes) {
      const sv =
        r.src === 'lfo1' ? lfoVals[0] :
        r.src === 'lfo2' ? lfoVals[1] :
        r.src === 'lfo3' ? lfoVals[2] :
        r.src === 'lfo4' ? lfoVals[3] : 0
      if (r.dest && r.dest !== 'none') mod[r.dest] = (mod[r.dest] || 0) + sv * r.amt
    }
    // Per-LFO built-in destination
    for (let i = 0; i < 4; i++) {
      if (P.lfos[i].dest && P.lfos[i].dest !== 'none') {
        mod[P.lfos[i].dest] = (mod[P.lfos[i].dest] || 0) + lfoVals[i] * P.lfos[i].amt
      }
    }

    // Pre-block constants
    const tblA = TABLES[P.oscA.table] ?? TABLES.basic
    const tblB = TABLES[P.oscB.table] ?? TABLES.basic
    const nuA = Math.max(1, Math.min(MUNI, Math.round(P.oscA.unison)))
    const nuB = Math.max(1, Math.min(MUNI, Math.round(P.oscB.unison)))
    const fmDepthA = P.oscA.warp === 'fmB' ? P.oscA.warpAmt * 3 : 0

    const wtA = Math.max(0, Math.min(1, P.oscA.wtPos + (mod['oscA.wtPos'] || 0)))
    const wtB = Math.max(0, Math.min(1, P.oscB.wtPos + (mod['oscB.wtPos'] || 0)))
    const frmA = wtA * (NFRM - 1)
    const frmB = wtB * (NFRM - 1)
    const lvA = Math.max(0, P.oscA.level + (mod['oscA.level'] || 0))
    const lvB = Math.max(0, P.oscB.level + (mod['oscB.level'] || 0))
    const subL = Math.max(0, P.sub.level + (mod['sub.level'] || 0))

    // Filter prep
    const cutMod = mod['filter.cutoff'] || 0
    const resMod = mod['filter.reso']   || 0
    const cutBase = Math.max(0.001, Math.min(1, P.filter.cutoff + cutMod))
    const resBase = Math.max(0, Math.min(0.98, P.filter.reso + resMod))

    // ── PER-SAMPLE LOOP ──────────────────────────────────────────────────────
    for (let i = 0; i < n; i++) {
      let sumL = 0, sumR = 0

      for (const v of voices) {
        if (!v.on) continue

        const e1 = adsrTick(v.e1, P.env1, sr)
        const e2 = adsrTick(v.e2, P.env2, sr)
        const e3 = adsrTick(v.e3, P.env3, sr)
        if (v.e1.stage === 'done') { v.on = false; continue }

        const fA = midiF(v.note + P.oscA.oct*12 + P.oscA.semi + P.oscA.fine/100)
        const fB = midiF(v.note + P.oscB.oct*12 + P.oscB.semi + P.oscB.fine/100)

        let oscBSample = 0
        if (P.oscB.on || fmDepthA > 0) {
          const wph = warpPhase(((v.phB[0] % 1) + 1) % 1, P.oscB.warp, P.oscB.warpAmt)
          oscBSample = wtRead(tblB, frmB, wph)
          v.phB[0] += fB / sr
          if (v.phB[0] >= 10) v.phB[0] -= 10
        }

        let vL = 0, vR = 0

        // ── OSC A with unison ──
        if (P.oscA.on) {
          for (let u = 0; u < nuA; u++) {
            const dc = nuA < 2 ? 0 : (u / (nuA - 1) - 0.5) * P.oscA.detune * 100
            const freq = fA * Math.pow(2, dc / 1200)

            if (P.oscA.warp === 'sync') {
              const sm = 1 + P.oscA.warpAmt * 4
              v.syA[u] += freq * sm / sr
              if (v.syA[u] >= 1) { v.syA[u] -= 1; v.phA[u] = 0 }
            }

            const phInc = fmDepthA > 0
              ? (freq + oscBSample * fA * fmDepthA) / sr
              : freq / sr
            const rawPh = ((v.phA[u] % 1) + 1) % 1
            const wp = (P.oscA.warp === 'sync' || P.oscA.warp === 'fmB')
              ? rawPh : warpPhase(rawPh, P.oscA.warp, P.oscA.warpAmt)
            const s = wtRead(tblA, frmA, wp) * lvA

            const pan = nuA < 2 ? P.oscA.pan : (u / (nuA - 1)) * 2 - 1
            const blendW = nuA < 2 || u === Math.floor(nuA / 2) ? 1 : P.oscA.blend
            vL += s * Math.cos((pan + 1) * Math.PI / 4) * blendW
            vR += s * Math.sin((pan + 1) * Math.PI / 4) * blendW
            v.phA[u] += phInc
            if (v.phA[u] >= 10) v.phA[u] -= 10
          }
        }

        // ── OSC B layered output (if not being used as FM source for A) ──
        if (P.oscB.on && P.oscA.warp !== 'fmB') {
          const sB = oscBSample * lvB
          const pb = (P.oscB.pan + 1) * Math.PI / 4
          vL += sB * Math.cos(pb)
          vR += sB * Math.sin(pb)
        }

        // ── Sub oscillator ──
        if (P.sub.on) {
          const sf = midiF(v.note) * Math.pow(2, P.sub.oct)
          const ss = Math.sin(PI2 * v.phSub) * subL
          vL += ss; vR += ss
          v.phSub += sf / sr
          if (v.phSub >= 1) v.phSub -= 1
        }

        // ── Noise ──
        if (P.noise.on) {
          const nn = (Math.random() * 2 - 1) * P.noise.level
          vL += nn; vR += nn
        }

        // ── Per-voice filter ──
        if (P.filter.on) {
          const pitchOff = P.filter.keytrack * ((v.note - 60) / 96)
          const cutHz = Math.pow(10, 1.9 + Math.min(1, Math.max(0, cutBase + pitchOff)) * 2.1)
          const fc = 2 * Math.sin(Math.PI * Math.min(0.499, cutHz / sr))
          const q  = 1 - resBase * 0.98

          const dL = sat(vL, P.filter.drive)
          const dR = sat(vR, P.filter.drive)
          // L drives state-variable; R uses a brief mirror with shared state
          const fL = svfTick(v.flt, dL, fc, q)
          const outL = P.filter.type === 'highpass' ? fL.hp
                     : P.filter.type === 'bandpass' ? fL.bp
                     : fL.lp
          // For stereo, run R through a transient (no second state) — close enough
          const outR = dR * (P.filter.type === 'lowpass' ? 0.6 : 1.0) +
                       (P.filter.type === 'lowpass' ? outL * 0.4 : 0)
          vL = outL; vR = outR
        }

        // Amplitude envelope + velocity
        const amp = e1 * v.vel * 0.20
        sumL += vL * amp
        sumR += vR * amp
        v.age++
      }

      L[i] = sumL
      R[i] = sumR

      // Advance LFOs (sample-accurate)
      for (let k = 0; k < 4; k++) {
        lfoPhases[k] += lfoInc[k]
        if (lfoPhases[k] >= PI2) lfoPhases[k] -= PI2
      }
    }

    // ── FX chain ──
    if (P.fx.dist.on) {
      const mix = P.fx.dist.mix, drv = P.fx.dist.drive
      for (let i = 0; i < n; i++) {
        L[i] = L[i]*(1-mix) + sat(L[i], drv) * mix
        R[i] = R[i]*(1-mix) + sat(R[i], drv) * mix
      }
    }
    if (P.fx.delay.on) {
      const dl = Math.max(1, Math.min(DLY_MAX - 1, Math.round(P.fx.delay.time * sr)))
      const fb = P.fx.delay.fb, mix = P.fx.delay.mix
      for (let i = 0; i < n; i++) {
        const di = (dlyPos + DLY_MAX - dl) % DLY_MAX
        const dL = dlyL[di], dR = dlyR[di]
        dlyL[dlyPos] = L[i] + dL * fb
        dlyR[dlyPos] = R[i] + dR * fb
        dlyPos = (dlyPos + 1) % DLY_MAX
        L[i] = L[i]*(1-mix) + dL * mix
        R[i] = R[i]*(1-mix) + dR * mix
      }
    }
    if (P.fx.reverb.on) {
      const g = 0.5 + P.fx.reverb.size * 0.45
      const mix = P.fx.reverb.mix
      for (let i = 0; i < n; i++) {
        let rl = L[i], rr = R[i]
        for (const b of rvBufs) {
          const oL = b.l[b.pos], oR = b.r[b.pos]
          b.l[b.pos] = rl + g * oL
          b.r[b.pos] = rr + g * oR
          rl = oL - g * rl
          rr = oR - g * rr
          b.pos = (b.pos + 1) % b.l.length
        }
        L[i] = L[i]*(1-mix) + rl * mix
        R[i] = R[i]*(1-mix) + rr * mix
      }
    }

    // Master gain (avoids clipping with high polyphony)
    const mg = P.masterGain ?? 0.7
    for (let i = 0; i < n; i++) {
      L[i] *= mg
      R[i] *= mg
    }

    // Periodically push waveform updates to UI (~12 fps)
    this._tick += n
    if (this._tick > sr * 0.08) {
      this._tick = 0
      this._wave('A')
      if (P.oscB.on) this._wave('B')
      this.port.postMessage({
        type: 'meters',
        lfos: lfoVals.slice(),
        voices: voices.filter(v => v.on).length,
      })
    }
    return true
  }
}

registerProcessor('custom-synth', CustomSynthProcessor)
