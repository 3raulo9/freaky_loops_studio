// SUBTERRA — bass-first AudioWorklet synth.
//
// Built from the low end outward (see the design spec): the fundamental/sub
// region stays clean and MONO, and all character lives in the harmonics above
// it. The spine:
//   • Always-mono Sub engine (phase-reset on note for consistent punch).
//   • Two character oscillators (saw/square/tri/sine) with unison + FM growl.
//   • 808 / glide engine: pitch-envelope drop + legato portamento.
//   • Main multimode SVF filter (LP/BP/HP) with key-tracking + filter env.
//   • Harmonic-split DRIVE: distortion is applied ONLY above a crossover so the
//     sub never gets muddied / phase-wrecked in mono.
//   • 3-band stage with per-band gain, a low-band MONO-MAKER, and a phase-safe
//     stereo widener on the upper bands.
//   • Mono-compatibility metering: L/R correlation + low-band correlation
//     (the green/amber/red "bass-mono safety" light) pushed to the UI.

const PI2 = 2 * Math.PI
const MPOLY = 8   // max polyphony (poly mode)
const MUNI  = 7   // max unison voices per osc

const midiF = n => 440 * Math.pow(2, (n - 69) / 12)

// ─── Band-limited helpers (polyBLEP) ─────────────────────────────────────────
// Removes the worst of the aliasing on saw/square discontinuities. Bass plays
// low so aliasing is mild, but the harmonic-split drive lifts upper harmonics
// where it would otherwise show, so it's worth the few extra flops.
function polyBLEP(t, dt) {
  if (dt <= 0) return 0
  if (t < dt)        { const x = t / dt;       return x + x - x * x - 1 }
  if (t > 1 - dt)    { const x = (t - 1) / dt; return x * x + x + x + 1 }
  return 0
}

function oscShape(wave, ph, dt) {
  switch (wave) {
    case 'sine':     return Math.sin(PI2 * ph)
    case 'triangle': { const s = ph < .5 ? 4 * ph - 1 : 3 - 4 * ph; return s }
    case 'square': {
      let s = ph < .5 ? 1 : -1
      s += polyBLEP(ph, dt)
      s -= polyBLEP((ph + .5) % 1, dt)
      return s
    }
    default: { // saw
      let s = 2 * ph - 1
      s -= polyBLEP(ph, dt)
      return s
    }
  }
}

// ─── Soft-clip / waveshapers for the harmonic-split drive ────────────────────
function shape(type, x, amt) {
  const g = 1 + amt * 9
  switch (type) {
    case 'tube':   { const y = x * g; return (y >= 0 ? 1 : -1) * (1 - Math.exp(-Math.abs(y))) } // asymmetric, even harmonics
    case 'tape':   { const y = x * g; return Math.tanh(y) }                                      // soft odd
    case 'fuzz':   { const y = x * g; return Math.max(-1, Math.min(1, y * 1.6)) }                // hard clip
    case 'fold':   { let y = x * g; while (y > 1) y = 2 - y; while (y < -1) y = -2 - y; return y } // wavefolder
    case 'crush':  { const steps = Math.max(2, 64 - amt * 60); return Math.round(x * steps) / steps } // bitcrush
    default:       { const y = x * g; return y / (1 + Math.abs(y)) }
  }
}

// ─── ADSR (sample accurate) ──────────────────────────────────────────────────
function adsrTick(env, p, sr) {
  switch (env.stage) {
    case 'atk': {
      const rate = p.a > 0 ? 1 / (p.a * sr) : 1
      env.lv = Math.min(1, env.lv + rate)
      if (env.lv >= 1) { env.lv = 1; env.stage = 'dec' }
      break
    }
    case 'dec': {
      const f = p.d > 0 ? Math.pow(0.0008, 1 / (p.d * sr)) : 0
      env.lv += (p.s - env.lv) * (1 - f)
      if (Math.abs(env.lv - p.s) < 2e-4) { env.lv = p.s; env.stage = 'sus' }
      break
    }
    case 'sus': env.lv = p.s; break
    case 'rel': {
      const f = p.r > 0 ? Math.pow(0.0008, 1 / (p.r * sr)) : 0
      env.lv *= f
      if (env.lv < 1e-4) { env.lv = 0; env.stage = 'done' }
      break
    }
    default: env.lv = 0
  }
  return env.lv
}

function lfoVal(shapeName, p) {
  p = ((p % 1) + 1) % 1
  switch (shapeName) {
    case 'triangle': return p < .5 ? 4 * p - 1 : 3 - 4 * p
    case 'square':   return p < .5 ? 1 : -1
    case 'sawtooth': return 1 - 2 * p
    default:         return Math.sin(PI2 * p)
  }
}

// ─── Default patch ───────────────────────────────────────────────────────────
let P = {
  osc1: { wave:'saw',    level:0.9, oct:0,  semi:0, fine:0, unison:1, detune:0.18, on:true },
  osc2: { wave:'square', level:0.0, oct:0,  semi:0, fine:0, unison:1, detune:0.18, on:false },
  fm:   { amount:0 },                       // osc2 → osc1 phase-modulation depth
  sub:  { wave:'sine',   level:0.6, oct:-1, on:true },     // ALWAYS mono, phase-reset
  noise:{ level:0.0, decay:0.03, on:false },               // note-on attack click
  glide:{ on:true, time:0.06 },             // legato portamento (mono mode)
  pitchEnv:{ amount:0, time:0.08 },          // 808 pitch drop (semitones)
  amp:  { a:0.003, d:0.25, s:0.85, r:0.12 },
  fenv: { a:0.003, d:0.18, s:0.20, r:0.12, amount:0 },     // → filter cutoff
  filter:{ type:'lowpass', cutoff:0.65, reso:0.18, keytrack:0.25, on:true },
  drive:{ on:false, type:'tube', amount:0.4, crossover:0.18 },  // only ABOVE crossover
  band: { lowGain:1, midGain:1, highGain:1, crossLow:0.12, crossHigh:0.5, monoFreq:0.16, width:0 },
  lfos: [
    { shape:'sine',     rate:0.35, amt:0, dest:'none' },
    { shape:'triangle', rate:0.5,  amt:0, dest:'none' },
  ],
  voiceMode:'mono',
  output:{ gain:0.85, limit:true },
}

// ─── Voice state ─────────────────────────────────────────────────────────────
function mkVoice() {
  return {
    on:false, note:-1, vel:0, age:0,
    freqCur:0, freqTgt:0,            // glide
    penv:0,                          // 808 pitch-env offset (semitones), decays → 0
    ph1:new Float32Array(MUNI), ph2:new Float32Array(MUNI),
    phSub:0, noiseLv:0,
    fL:{ lp:0, bp:0 }, fR:{ lp:0, bp:0 },
    e1:{ stage:'done', lv:0 }, ef:{ stage:'done', lv:0 },
  }
}
const voices = Array.from({ length: MPOLY }, mkVoice)
const held = []   // mono-mode held-note stack (last-note priority)

function startVoice(v, pitch, vel, glideFrom) {
  v.on = true; v.note = pitch; v.vel = vel / 127; v.age = 0
  const tgt = midiF(pitch)
  v.freqTgt = tgt
  v.freqCur = glideFrom != null ? glideFrom : tgt
  v.penv = P.pitchEnv.amount
  v.ph1.fill(0); v.ph2.fill(0); v.phSub = 0          // phase reset → consistent punch
  v.noiseLv = P.noise.on ? 1 : 0
  v.fL.lp = v.fL.bp = v.fR.lp = v.fR.bp = 0
  v.e1 = { stage:'atk', lv:0 }
  v.ef = { stage:'atk', lv:0 }
}

function noteOn(pitch, vel) {
  if (P.voiceMode === 'mono') {
    const v = voices[0]
    const wasOn = v.on && v.e1.stage !== 'rel' && v.e1.stage !== 'done'
    held.push(pitch)
    if (wasOn && P.glide.on) {
      // legato: glide pitch, keep envelopes & phase running
      v.note = pitch; v.freqTgt = midiF(pitch); v.penv = P.pitchEnv.amount
    } else {
      startVoice(v, pitch, vel, P.glide.on && v.freqCur > 0 ? v.freqCur : null)
    }
    return
  }
  // poly: free voice, else steal oldest non-releasing/oldest
  let v = voices.find(x => !x.on)
  if (!v) v = voices.reduce((a, b) => (a.age > b.age ? a : b))
  startVoice(v, pitch, vel)
}

function noteOff(pitch) {
  if (P.voiceMode === 'mono') {
    const i = held.lastIndexOf(pitch)
    if (i >= 0) held.splice(i, 1)
    const v = voices[0]
    if (held.length) {
      // fall back to the previous held note (glide back)
      const prev = held[held.length - 1]
      v.note = prev; v.freqTgt = midiF(prev)
    } else {
      v.e1.stage = 'rel'; v.ef.stage = 'rel'
    }
    return
  }
  voices.filter(v => v.on && v.note === pitch).forEach(v => { v.e1.stage = 'rel'; v.ef.stage = 'rel' })
}

function allNotesOff() {
  held.length = 0
  voices.forEach(v => { v.e1.stage = 'rel'; v.ef.stage = 'rel' })
}

// ─── Bus-level filter states (one-pole, cheap) ───────────────────────────────
// Used for the harmonic-split drive crossover, the 3-band split, and the
// low-band mono-maker. Operate on the summed stereo bus, not per-voice, so the
// cost is fixed regardless of polyphony.
const oneL = { driveLo:0, b1:0, b2:0, mono:0 }
const oneR = { driveLo:0, b1:0, b2:0, mono:0 }

// map a 0..1 knob to a log frequency
const knobHz = (k, lo, hi) => lo * Math.pow(hi / lo, Math.max(0, Math.min(1, k)))
const onePoleA = (hz, sr) => 1 - Math.exp(-PI2 * Math.min(hz, sr * 0.49) / sr)

// LFO phases (global, sample-advanced)
const lfoPh = [0, 0]
const lfoV  = [0, 0]

class SubterraProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this._tick = 0
    this._corrA = 0; this._corrB = 0; this._corrAB = 0   // correlation accumulators
    this._loA = 0; this._loB = 0; this._loAB = 0          // low-band correlation
    this._scope = new Float32Array(256); this._sci = 0
    this.port.onmessage = ({ data }) => {
      switch (data.type) {
        case 'noteOn':      noteOn(data.pitch, data.velocity * 127); break
        case 'noteOff':     noteOff(data.pitch); break
        case 'allNotesOff': allNotesOff(); break
        case 'param':       this._setP(data.path, data.value); break
        case 'fullState':   this._merge(data.state); break
      }
    }
  }

  _setP(path, val) {
    const k = path.split('.')
    let o = P
    for (let i = 0; i < k.length - 1; i++) {
      const key = /^\d+$/.test(k[i]) ? Number(k[i]) : k[i]
      o = o[key]; if (o === undefined) return
    }
    const last = k[k.length - 1]
    o[/^\d+$/.test(last) ? Number(last) : last] = val
  }

  _merge(s) {
    if (!s || typeof s !== 'object') return
    const m = (dst, src) => {
      for (const k in src) {
        if (src[k] && typeof src[k] === 'object' && !Array.isArray(src[k])) {
          if (!dst[k]) dst[k] = {}
          m(dst[k], src[k])
        } else dst[k] = src[k]
      }
    }
    m(P, s)
  }

  process(_in, outs) {
    const out = outs[0]
    if (!out?.length) return true
    const L = out[0], R = out[1] || out[0]
    const sr = sampleRate, n = L.length
    L.fill(0); R.fill(0)

    // ── LFO block setup ──
    const lfoInc = P.lfos.map(l => Math.pow(10, l.rate * 4 - 2) / sr) // 0.01..100 Hz
    for (let i = 0; i < 2; i++) lfoV[i] = lfoVal(P.lfos[i].shape, lfoPh[i])
    const mod = { cutoff:0, pitch:0, level:0 }
    for (let i = 0; i < 2; i++) {
      const d = P.lfos[i].dest
      if (d && d !== 'none') mod[d] = (mod[d] || 0) + lfoV[i] * P.lfos[i].amt
    }

    // ── Pre-block oscillator constants ──
    const nu1 = Math.max(1, Math.min(MUNI, Math.round(P.osc1.unison)))
    const nu2 = Math.max(1, Math.min(MUNI, Math.round(P.osc2.unison)))
    const fmAmt = P.fm.amount
    const o1det = P.osc1.semi + P.osc1.fine / 100 + P.osc1.oct * 12
    const o2det = P.osc2.semi + P.osc2.fine / 100 + P.osc2.oct * 12
    const glideCoef = (P.glide.on && P.glide.time > 0)
      ? Math.exp(-1 / (P.glide.time * sr)) : 0
    const penvCoef = P.pitchEnv.time > 0 ? Math.exp(-1 / (P.pitchEnv.time * sr)) : 0
    const noiseCoef = P.noise.decay > 0 ? Math.exp(-1 / (P.noise.decay * sr)) : 0

    // ── Filter base ──
    const cutMod = mod.cutoff
    const fEnvAmt = P.fenv.amount

    // ── PER-SAMPLE ──
    for (let i = 0; i < n; i++) {
      let mixL = 0, mixR = 0

      for (const v of voices) {
        if (!v.on) continue
        const e1 = adsrTick(v.e1, P.amp,  sr)
        const ef = adsrTick(v.ef, P.fenv, sr)
        if (v.e1.stage === 'done') { v.on = false; continue }

        // glide + 808 pitch envelope
        if (glideCoef > 0) v.freqCur = v.freqTgt + (v.freqCur - v.freqTgt) * glideCoef
        else v.freqCur = v.freqTgt
        v.penv *= penvCoef
        const penvMul = Math.pow(2, (v.penv + mod.pitch * 12) / 12)
        const baseF = v.freqCur * penvMul

        const f1 = baseF * Math.pow(2, o1det / 12)
        const f2 = baseF * Math.pow(2, o2det / 12)

        // OSC2 first (it can FM osc1). Single voice of osc2 used as the FM source.
        let o2 = 0
        if (P.osc2.on || fmAmt > 0) {
          for (let u = 0; u < nu2; u++) {
            const dc = nu2 < 2 ? 0 : (u / (nu2 - 1) - .5) * P.osc2.detune
            const fr = f2 * Math.pow(2, dc)
            const dt = fr / sr
            o2 += oscShape(P.osc2.wave, v.ph2[u], dt) / nu2
            v.ph2[u] += dt; if (v.ph2[u] >= 1) v.ph2[u] -= 1
          }
        }

        let vL = 0, vR = 0

        // OSC1 (+ optional FM from osc2) with unison spread.
        // Normalise by 1/sqrt(N): detuned copies sum incoherently, so this keeps
        // perceived level roughly constant as unison rises (no hard clip into the limiter).
        if (P.osc1.on) {
          const uNorm = P.osc1.level / Math.sqrt(nu1)
          for (let u = 0; u < nu1; u++) {
            const dc = nu1 < 2 ? 0 : (u / (nu1 - 1) - .5) * P.osc1.detune
            const fr = f1 * Math.pow(2, dc)
            const dt = fr / sr
            const ph = ((v.ph1[u] + (fmAmt > 0 ? o2 * fmAmt : 0)) % 1 + 1) % 1
            const s = oscShape(P.osc1.wave, ph, dt) * uNorm
            // unison stereo spread (upper voices panned out)
            const pan = nu1 < 2 ? 0 : (u / (nu1 - 1)) * 2 - 1
            vL += s * Math.cos((pan + 1) * Math.PI / 4)
            vR += s * Math.sin((pan + 1) * Math.PI / 4)
            v.ph1[u] += dt; if (v.ph1[u] >= 1) v.ph1[u] -= 1
          }
        }

        // OSC2 as an audible layer (mono-center) when not purely an FM source
        if (P.osc2.on) {
          const s = o2 * P.osc2.level
          vL += s; vR += s
        }

        // Per-voice filter (state-variable, LP/BP/HP) with key-track + env
        if (P.filter.on) {
          const kt = P.filter.keytrack * ((v.note - 36) / 60)
          let cut = P.filter.cutoff + cutMod + fEnvAmt * ef + kt
          cut = Math.max(0.001, Math.min(1, cut))
          const cutHz = knobHz(cut, 30, 16000)
          const fc = 2 * Math.sin(Math.PI * Math.min(0.49, cutHz / sr))
          const q  = 1 - Math.min(0.97, P.filter.reso) * 0.97
          // L
          v.fL.lp += fc * v.fL.bp
          const hpL = vL - v.fL.lp - q * v.fL.bp
          v.fL.bp += fc * hpL
          // R
          v.fR.lp += fc * v.fR.bp
          const hpR = vR - v.fR.lp - q * v.fR.bp
          v.fR.bp += fc * hpR
          if (P.filter.type === 'highpass')      { vL = hpL; vR = hpR }
          else if (P.filter.type === 'bandpass') { vL = v.fL.bp; vR = v.fR.bp }
          else                                    { vL = v.fL.lp; vR = v.fR.lp }
        }

        // SUB — always summed in mono, never filtered (kept pristine)
        if (P.sub.on) {
          const sf = midiF(v.note) * Math.pow(2, P.sub.oct)
          const ss = oscShape(P.sub.wave === 'triangle' ? 'triangle' : 'sine', v.phSub, sf / sr) * P.sub.level
          vL += ss; vR += ss
          v.phSub += sf / sr; if (v.phSub >= 1) v.phSub -= 1
        }

        // Noise attack click (mono, fast decay, gated at note-on)
        if (v.noiseLv > 1e-3) {
          const nn = (Math.random() * 2 - 1) * P.noise.level * v.noiseLv
          vL += nn; vR += nn
          v.noiseLv *= noiseCoef
        }

        const amp = e1 * v.vel * (1 + mod.level) * 0.5
        mixL += vL * amp
        mixR += vR * amp
        v.age++
      }

      // ── BUS: harmonic-split DRIVE (distort only above the crossover) ──
      if (P.drive.on) {
        const aHz = onePoleA(knobHz(P.drive.crossover, 30, 600), sr)
        oneL.driveLo += aHz * (mixL - oneL.driveLo)
        oneR.driveLo += aHz * (mixR - oneR.driveLo)
        const hiL = mixL - oneL.driveLo
        const hiR = mixR - oneR.driveLo
        mixL = oneL.driveLo + shape(P.drive.type, hiL, P.drive.amount)
        mixR = oneR.driveLo + shape(P.drive.type, hiR, P.drive.amount)
      }

      // ── BUS: 3-band gain (low / mid / high) ──
      const aLo = onePoleA(knobHz(P.band.crossLow, 40, 400), sr)
      const aHi = onePoleA(knobHz(P.band.crossHigh, 300, 5000), sr)
      oneL.b1 += aLo * (mixL - oneL.b1); const loL = oneL.b1
      oneR.b1 += aLo * (mixR - oneR.b1); const loR = oneR.b1
      oneL.b2 += aHi * (mixL - oneL.b2)
      oneR.b2 += aHi * (mixR - oneR.b2)
      const hiBL = mixL - oneL.b2, hiBR = mixR - oneR.b2
      const midL = oneL.b2 - loL, midR = oneR.b2 - loR
      let bL = loL * P.band.lowGain + midL * P.band.midGain + hiBL * P.band.highGain
      let bR = loR * P.band.lowGain + midR * P.band.midGain + hiBR * P.band.highGain

      // ── BUS: low-band MONO-MAKER (collapse everything below monoFreq to mono) ──
      const aMono = onePoleA(knobHz(P.band.monoFreq, 50, 400), sr)
      oneL.mono += aMono * (bL - oneL.mono); const mLoL = oneL.mono
      oneR.mono += aMono * (bR - oneR.mono); const mLoR = oneR.mono
      const monoLo = (mLoL + mLoR) * 0.5
      let oL = (bL - mLoL) + monoLo
      let oR = (bR - mLoR) + monoLo

      // ── BUS: phase-safe stereo widener (upper content only — low is mono) ──
      if (P.band.width > 0) {
        const mid = (oL + oR) * 0.5
        const sideL = oL - mid, sideR = oR - mid
        const w = 1 + P.band.width
        oL = mid + sideL * w
        oR = mid + sideR * w
      }

      // ── Output: soft limiter + gain ──
      oL *= P.output.gain
      oR *= P.output.gain
      if (P.output.limit) { oL = Math.tanh(oL); oR = Math.tanh(oR) }

      L[i] = oL; R[i] = oR

      // metering accumulators
      this._corrA += oL * oL; this._corrB += oR * oR; this._corrAB += oL * oR
      this._loA += mLoL * mLoL; this._loB += mLoR * mLoR; this._loAB += mLoL * mLoR
      this._scope[this._sci] = (oL + oR) * 0.5
      this._sci = (this._sci + 1) % this._scope.length

      // advance LFOs
      for (let k = 0; k < 2; k++) { lfoPh[k] += lfoInc[k]; if (lfoPh[k] >= 1) lfoPh[k] -= 1 }
    }

    // ── Push meters to the UI (~15 fps) ──
    this._tick += n
    if (this._tick > sr * 0.066) {
      const denom  = Math.sqrt(this._corrA * this._corrB) || 1e-9
      const corr   = Math.max(-1, Math.min(1, this._corrAB / denom))
      const loDen  = Math.sqrt(this._loA * this._loB) || 1e-9
      const loCorr = Math.max(-1, Math.min(1, this._loAB / loDen))
      // dominant sub note = lowest active voice's fundamental
      let domF = 0
      for (const v of voices) if (v.on && (domF === 0 || v.freqCur < domF)) domF = v.freqCur
      this.port.postMessage({
        type:'meters',
        corr, loCorr,
        voices: voices.filter(v => v.on).length,
        domF,
        rms: Math.sqrt((this._corrA + this._corrB) / (2 * this._tick)) || 0,
        lfos: lfoV.slice(),
        scope: this._scope.slice(),
      })
      this._tick = 0
      this._corrA = this._corrB = this._corrAB = 0
      this._loA = this._loB = this._loAB = 0
    }
    return true
  }
}

registerProcessor('subterra', SubterraProcessor)
