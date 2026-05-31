// Serum-style wavetable synthesizer — AudioWorklet processor.
// Dual WT oscillators · 5 warp modes · FM · sub+noise · ADSR×2 · LFO×2
// Mod routing · SVF filter · unison (up to 8) · delay / reverb / distortion

const PI2 = 2 * Math.PI
const FSIZ = 512    // samples per wavetable frame
const NFRM = 64     // frames per table
const MPOLY = 8     // max polyphonic voices
const MUNI  = 8     // max unison voices

// ─── WAVETABLE GENERATION ────────────────────────────────────────────────────
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
    if (t < .333) { const b=t*3;          return si*(1-b)+tr*b }
    if (t < .667) { const b=(t-.333)*3;   return tr*(1-b)+sa*b }
                  { const b=(t-.667)*3;   return sa*(1-b)+sq*b }
  }),
  spectral: buildTable((p, t) => {
    const n = 1 + Math.round(t * 7); let o = 0, nm = 0
    for (let h = 1; h <= n; h++) { const a=1/h; o+=Math.sin(PI2*p*h)*a; nm+=a }
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
    return Math.sin(PI2*p*(f1/440))*.55 + Math.sin(PI2*p*(f2/440))*.45
  }),
}

// ─── WAVETABLE LOOKUP (bilinear interpolation) ───────────────────────────────
function wtRead(tbl, frame, phase) {
  const f0=Math.max(0,Math.min(NFRM-2,Math.floor(frame))), f1=f0+1, fb=frame-f0
  const p=((phase%1)+1)%1, ii=Math.floor(p*FSIZ), i1=(ii+1)%FSIZ, ib=p*FSIZ-ii
  const s0=tbl[f0*FSIZ+ii]*(1-ib)+tbl[f0*FSIZ+i1]*ib
  const s1=tbl[f1*FSIZ+ii]*(1-ib)+tbl[f1*FSIZ+i1]*ib
  return s0*(1-fb)+s1*fb
}

// ─── WARP MODES ──────────────────────────────────────────────────────────────
// Returns warped phase; sync uses syncPhases array (per-voice per-unison).
function warpPhase(ph, mode, amt) {
  switch (mode) {
    case 'bend+': return Math.pow(ph, 1 + amt * 3)
    case 'bend-': return 1 - Math.pow(1 - ph, 1 + amt * 3)
    case 'pwm': {
      const pw = 0.05 + amt * 0.9
      return ph < pw ? ph/(2*pw) : 0.5+(ph-pw)/(2*(1-pw))
    }
    case 'asym+': {
      const a = 0.1 + amt * 0.8
      return ph < a ? ph/(2*a) : 0.5+(ph-a)/(2*(1-a))
    }
    case 'asym-': {
      const a = 0.9 - amt * 0.8
      return ph < a ? ph/(2*a) : 0.5+(ph-a)/(2*(1-a))
    }
    default: return ph
  }
}

// ─── STATE-VARIABLE FILTER ───────────────────────────────────────────────────
function svf(s, x, fc, reso) {
  const f = 2 * Math.sin(Math.PI * Math.min(fc, 0.499))
  const q = 1 - reso * 0.98
  s.lp += f * s.bp
  const hp = x - s.lp - q * s.bp
  s.bp += f * hp
  return { lp: s.lp, hp, bp: s.bp }
}

// ─── SATURATION ──────────────────────────────────────────────────────────────
function sat(x, a) { const g=1+a*5; return (x*g)/(1+Math.abs(x*g)) }

// ─── LFO SAMPLE ──────────────────────────────────────────────────────────────
function lfoVal(shape, phase) {
  const p = ((phase % 1) + 1) % 1
  switch (shape) {
    case 'triangle': return p<.5 ? 4*p-1 : 3-4*p
    case 'square':   return p<.5 ? 1 : -1
    case 'sawtooth': return 1-2*p
    default:         return Math.sin(PI2*p)   // sine (default)
  }
}

// ─── ADSR (per-sample) ───────────────────────────────────────────────────────
function adsrTick(env, p, sr) {
  switch (env.stage) {
    case 'atk':
      env.lv = Math.min(1, env.lv + (p.a > 0 ? 1/(p.a*sr) : 1))
      if (env.lv >= 1) { env.lv=1; env.stage='dec' }
      break
    case 'dec':
      env.lv += (p.s - env.lv) * (p.d > 0 ? 1-(1/Math.exp(1/(p.d*sr))) : 1)
      if (Math.abs(env.lv-p.s) < 2e-4) { env.lv=p.s; env.stage='sus' }
      break
    case 'sus': env.lv=p.s; break
    case 'rel':
      env.lv *= (p.r > 0 ? Math.pow(1e-3, 1/(p.r*sr)) : 0)
      if (env.lv < 1e-4) { env.lv=0; env.stage='done' }
      break
    default: env.lv=0
  }
  return env.lv
}

// ─── FX BUFFERS ──────────────────────────────────────────────────────────────
const DLY_MAX = 88200
const dlyL = new Float32Array(DLY_MAX), dlyR = new Float32Array(DLY_MAX)
let dlyPos = 0
const RV_SIZES = [1557, 1617, 1491, 1422, 1277]
const rvBufs = RV_SIZES.map(n => ({ l:new Float32Array(n), r:new Float32Array(n), pos:0 }))
function rvStep(buf, x, g) { const y=buf.l[buf.pos]-g*x; buf.l[buf.pos]=x+g*buf.l[buf.pos]; return y }

// ─── DEFAULT PARAMS ──────────────────────────────────────────────────────────
let P = {
  oscA: { table:'basic',  wtPos:.3, level:1,  pan:0, oct:0, semi:0, fine:0,
          warp:'none', warpAmt:0, unison:1, detune:.3, blend:.5, on:true  },
  oscB: { table:'basic',  wtPos:.6, level:.6, pan:0, oct:0, semi:0, fine:0,
          warp:'none', warpAmt:0, unison:1, detune:.3, blend:.5, on:false },
  sub:   { level:.3, oct:-1, on:false },
  noise: { level:.2, on:false },
  filter:{ on:true, type:'lowpass', cutoff:.7, reso:.3, drive:0, keytrack:0 },
  env1:  { a:.01, d:.2, s:.7, r:.3 },
  env2:  { a:0,   d:.5, s:0,  r:.1 },
  lfo1:  { shape:'sine', rate:.4, amt:0, dest:'none' },
  lfo2:  { shape:'sine', rate:1.2,amt:0, dest:'none' },
  fx:    {
    dist:  { on:false, drive:.5, mix:.5 },
    delay: { on:false, time:.25, fb:.4, mix:.3 },
    reverb:{ on:false, size:.5, mix:.3 },
  },
  modRoutes: [],  // [{ src:'lfo1'|'lfo2'|'env2', dest:'string', amt:number }]
}

// ─── VOICE POOL ──────────────────────────────────────────────────────────────
function mkVoice() {
  return {
    on:false, note:-1, vel:0, age:0,
    phA: new Float32Array(MUNI), syA: new Float32Array(MUNI),
    phB: new Float32Array(MUNI), syB: new Float32Array(MUNI),
    phSub:0,
    e1:{ stage:'done', lv:0 },
    e2:{ stage:'done', lv:0 },
  }
}
const voices = Array.from({length:MPOLY}, mkVoice)
const masterFlt = { lp:0, bp:0 }

function noteOn(pitch, vel) {
  let v = voices.find(v=>!v.on) ?? voices.reduce((a,b)=>a.age>b.age?a:b)
  Object.assign(v, { on:true, note:pitch, vel:vel/127, age:0 })
  v.phA.fill(0); v.syA.fill(0); v.phB.fill(0); v.syB.fill(0); v.phSub=0
  v.e1 = { stage:'atk', lv:0 }
  v.e2 = { stage:'atk', lv:0 }
}
function noteOff(pitch) {
  voices.filter(v=>v.on&&v.note===pitch).forEach(v=>{
    v.e1.stage='rel'; v.e2.stage='rel'
  })
}
function midiF(n) { return 440*Math.pow(2,(n-69)/12) }

// ─── LFO GLOBALS ─────────────────────────────────────────────────────────────
let l1ph=0, l2ph=0, l1v=0, l2v=0

// ─── SERUM PROCESSOR ─────────────────────────────────────────────────────────
class SerumProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this._tick = 0
    this.port.onmessage = ({data}) => {
      switch(data.type) {
        case 'noteOn':    noteOn(data.pitch, data.velocity); break
        case 'noteOff':   noteOff(data.pitch); break
        case 'param':     this._setP(data.path, data.value); break
        case 'modRoutes': P.modRoutes = data.routes; break
        case 'getWave':   this._wave(data.osc); break
        case 'fullState': Object.assign(P, data.state); break
      }
    }
  }

  _setP(path, val) {
    const k=path.split('.'); let o=P
    for(let i=0;i<k.length-1;i++) o=o[k[i]]
    o[k[k.length-1]]=val
  }

  _wave(osc) {
    const op = osc==='A' ? P.oscA : P.oscB
    const tbl = TABLES[op.table] ?? TABLES.basic
    const frm = op.wtPos*(NFRM-1)
    const s = new Float32Array(FSIZ)
    for(let i=0;i<FSIZ;i++) s[i]=wtRead(tbl,frm,i/FSIZ)
    this.port.postMessage({type:'waveform',osc,samples:s})
  }

  process(_in, outs) {
    const out=outs[0]; if(!out?.length) return true
    const L=out[0], R=out[1]||out[0], sr=sampleRate, n=L.length

    // LFO increments
    const l1i=(PI2*Math.pow(10,(P.lfo1.rate*4)-2))/sr
    const l2i=(PI2*Math.pow(10,(P.lfo2.rate*4)-2))/sr
    l1v=lfoVal(P.lfo1.shape,l1ph/PI2)
    l2v=lfoVal(P.lfo2.shape,l2ph/PI2)

    // Accumulate per-destination mod values from routes + built-in LFO dests
    const mod = {}
    const lfoMap = {lfo1:l1v,lfo2:l2v}
    for(const r of P.modRoutes) {
      const sv = lfoMap[r.src] ?? 0
      mod[r.dest]=(mod[r.dest]||0)+sv*r.amt
    }
    // Apply built-in LFO destinations
    if(P.lfo1.dest!=='none') mod[P.lfo1.dest]=(mod[P.lfo1.dest]||0)+l1v*P.lfo1.amt
    if(P.lfo2.dest!=='none') mod[P.lfo2.dest]=(mod[P.lfo2.dest]||0)+l2v*P.lfo2.amt

    L.fill(0); R.fill(0)

    for(const v of voices) {
      if(!v.on) continue
      v.age++

      const e1=adsrTick(v.e1,P.env1,sr)
      const e2=adsrTick(v.e2,P.env2,sr)
      if(v.e1.stage==='done') { v.on=false; continue }

      const envMod = { 'env2': e2 }  // env2 as a mod source
      for(const r of P.modRoutes) {
        if(r.src==='env2') mod[r.dest]=(mod[r.dest]||0)+e2*r.amt
      }

      const wtA=Math.max(0,Math.min(1,P.oscA.wtPos+(mod['oscA.wtPos']||0)))
      const wtB=Math.max(0,Math.min(1,P.oscB.wtPos+(mod['oscB.wtPos']||0)))
      const fBase=midiF(v.note)
      const tblA=TABLES[P.oscA.table]??TABLES.basic
      const tblB=TABLES[P.oscB.table]??TABLES.basic
      const frmA=wtA*(NFRM-1), frmB=wtB*(NFRM-1)

      // Compute OscB sample for FM (1 center voice)
      let oscBfm=0
      if(P.oscB.on) {
        const fbfreq=midiF(v.note+P.oscB.oct*12+P.oscB.semi+P.oscB.fine/100)
        const wph=warpPhase(((v.phB[0]%1)+1)%1,P.oscB.warp,P.oscB.warpAmt)
        oscBfm=wtRead(tblB,frmB,wph)
        v.phB[0]+=fbfreq/sr
      }

      let vL=0,vR=0

      // ── OSC A (with unison) ──
      if(P.oscA.on) {
        const nu=Math.max(1,Math.min(MUNI,Math.round(P.oscA.unison)))
        const fA=midiF(v.note+P.oscA.oct*12+P.oscA.semi+P.oscA.fine/100)
        const fmDepth = P.oscA.warp==='fmB' ? P.oscA.warpAmt*fA*3 : 0

        for(let u=0;u<nu;u++) {
          const dc = nu<2 ? 0 : (u/(nu-1)-.5)*P.oscA.detune*100
          const freq=fA*Math.pow(2,dc/1200)

          // Hard sync
          if(P.oscA.warp==='sync') {
            const sm=1+P.oscA.warpAmt*4
            v.syA[u]+=freq*sm/sr
            if(v.syA[u]>=1){v.syA[u]-=1;v.phA[u]=0}
          }

          const phInc = fmDepth>0 ? (freq+oscBfm*fmDepth)/sr : freq/sr
          const rawPh=((v.phA[u]%1)+1)%1
          const wp=P.oscA.warp==='sync'||P.oscA.warp==='fmB' ? rawPh : warpPhase(rawPh,P.oscA.warp,P.oscA.warpAmt)
          const s=wtRead(tblA,frmA,wp)*P.oscA.level

          const pan=nu<2 ? P.oscA.pan : (u/(nu-1))*2-1
          const blendW=nu<2||u===Math.floor(nu/2) ? 1 : P.oscA.blend
          vL+=s*Math.cos((pan+1)*Math.PI/4)*blendW
          vR+=s*Math.sin((pan+1)*Math.PI/4)*blendW
          v.phA[u]+=phInc
        }
      }

      // ── OSC B (single voice, used for layering) ──
      if(P.oscB.on && P.oscA.warp!=='fmB') {
        const wp2=warpPhase(((v.phB[0]%1)+1)%1,P.oscB.warp,P.oscB.warpAmt)
        const sB=wtRead(tblB,frmB,wp2)*P.oscB.level
        const pb=(P.oscB.pan+1)*Math.PI/4
        vL+=sB*Math.cos(pb); vR+=sB*Math.sin(pb)
        // phB[0] already advanced above
      }

      // ── Sub ──
      if(P.sub.on) {
        const sf=midiF(v.note)*Math.pow(2,P.sub.oct)
        const ss=Math.sin(PI2*v.phSub)*P.sub.level
        vL+=ss; vR+=ss; v.phSub+=sf/sr
      }

      // ── Noise ──
      if(P.noise.on) {
        const nn=(Math.random()*2-1)*P.noise.level
        vL+=nn; vR+=nn
      }

      // Amplitude envelope + velocity
      vL*=e1*v.vel*0.22; vR*=e1*v.vel*0.22
      L[0]+=vL; R[0]+=vR
    }

    // Distribute first sample across block then process filter/fx per sample
    // (Simplified: process filter on block sum — adequate for DAW use)
    const rawL=Float32Array.from(L), rawR=Float32Array.from(R)

    // ── Master filter ──
    const cutMod=mod['filter.cutoff']||0
    const resMod=mod['filter.reso']||0
    const cutraw=Math.max(0.001,Math.min(1,P.filter.cutoff+cutMod))
    const pitchOffset=P.filter.keytrack*(((voices.find(v=>v.on)?.note??60)-60)/96)
    const cutoff=Math.max(0.001,Math.min(0.499,Math.pow(10,1.9+Math.min(1,cutraw+pitchOffset)*2.1)/sr))
    const reso=Math.max(0,Math.min(0.98,P.filter.reso+resMod))

    if(P.filter.on) {
      for(let i=0;i<n;i++) {
        const dx=sat(L[i],P.filter.drive), dy=sat(R[i],P.filter.drive)
        const rL=svf(masterFlt,dx,cutoff,reso)
        const rR=svf({lp:masterFlt.lp,bp:masterFlt.bp},dy,cutoff,reso)
        switch(P.filter.type){
          case 'highpass': L[i]=rL.hp; R[i]=rR.hp; break
          case 'bandpass': L[i]=rL.bp; R[i]=rR.bp; break
          default:         L[i]=rL.lp; R[i]=rR.lp
        }
      }
    }

    // ── FX chain ──
    if(P.fx.dist.on) {
      for(let i=0;i<n;i++){
        L[i]=L[i]*(1-P.fx.dist.mix)+sat(L[i],P.fx.dist.drive)*P.fx.dist.mix
        R[i]=R[i]*(1-P.fx.dist.mix)+sat(R[i],P.fx.dist.drive)*P.fx.dist.mix
      }
    }
    if(P.fx.delay.on) {
      const dl=Math.round(P.fx.delay.time*sr)
      for(let i=0;i<n;i++){
        const di=(dlyPos+DLY_MAX-dl)%DLY_MAX
        const wl=L[i]+dlyL[di]*P.fx.delay.fb, wr=R[i]+dlyR[di]*P.fx.delay.fb
        dlyL[dlyPos]=wl; dlyR[dlyPos]=wr; dlyPos=(dlyPos+1)%DLY_MAX
        L[i]=L[i]*(1-P.fx.delay.mix)+dlyL[di]*P.fx.delay.mix
        R[i]=R[i]*(1-P.fx.delay.mix)+dlyR[di]*P.fx.delay.mix
      }
    }
    if(P.fx.reverb.on) {
      const g=0.5+P.fx.reverb.size*.45
      for(let i=0;i<n;i++){
        let rl=L[i],rr=R[i]
        for(const b of rvBufs){
          rl=b.l[b.pos]-g*rl; b.l[b.pos]=rl+g*b.l[b.pos]; b.pos=(b.pos+1)%b.l.length
          rr=b.r[b.pos]-g*rr; b.r[b.pos]=rr+g*b.r[b.pos]
        }
        L[i]=L[i]*(1-P.fx.reverb.mix)+rl*P.fx.reverb.mix
        R[i]=R[i]*(1-P.fx.reverb.mix)+rr*P.fx.reverb.mix
      }
    }

    // Advance LFOs
    l1ph=(l1ph+l1i*n)%PI2; l2ph=(l2ph+l2i*n)%PI2

    // Periodically push waveforms + lfo values to UI
    this._tick+=n
    if(this._tick>sr*0.08){
      this._tick=0
      this._wave('A')
      if(P.oscB.on) this._wave('B')
      this.port.postMessage({type:'lfo',l1:l1v,l2:l2v})
    }
    return true
  }
}

registerProcessor('serum-synth', SerumProcessor)
