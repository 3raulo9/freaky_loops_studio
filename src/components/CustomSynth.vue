<template>
  <div class="cs" v-if="ch">

    <!-- ── Header tabs ──────────────────────────────────────────────────── -->
    <div class="cs-header">
      <span class="cs-brand">◈ CUSTOM SYNTH</span>
      <span class="cs-name">— {{ ch.name }}</span>
      <div class="cs-tabs">
        <button v-for="t in TABS" :key="t.k" :class="['cs-tab',{active:tab===t.k}]" @click="tab=t.k">{{ t.l }}</button>
      </div>
      <div class="cs-meters">
        <span class="cs-meter-label">VOICES</span>
        <span class="cs-meter-val">{{ voiceCount }}/8</span>
      </div>
    </div>

    <!-- ── OSC TAB ──────────────────────────────────────────────────────── -->
    <div v-if="tab==='osc'" class="cs-osc-tab">

      <!-- BIG central wavetable display -->
      <div class="cs-wave-stage">
        <div class="cs-wave-box">
          <span class="cs-wave-title" style="color:#00d4ff">OSC A — {{ S.oscA.table }} · POS {{ pct(S.oscA.wtPos) }}</span>
          <canvas ref="waveA" class="cs-wave-canvas" width="540" height="120" />
        </div>
        <div class="cs-wave-box">
          <span class="cs-wave-title" style="color:#ff9f43">OSC B — {{ S.oscB.table }} · POS {{ pct(S.oscB.wtPos) }}</span>
          <canvas ref="waveB" class="cs-wave-canvas" width="540" height="120" />
        </div>
      </div>

      <!-- OSC A and B knob banks -->
      <div class="cs-osc-rows">
        <div class="cs-osc-row" :style="{ '--c': '#00d4ff' }">
          <div class="cs-osc-head">
            <span class="cs-osc-label">OSC A</span>
            <label class="cs-toggle"><input type="checkbox" v-model="S.oscA.on" @change="sp('oscA.on',$event.target.checked)"> ON</label>
            <select class="cs-sel" v-model="S.oscA.table" @change="sp('oscA.table',S.oscA.table);reqWave('A')">
              <option v-for="t in TABLES" :key="t" :value="t">{{ t }}</option>
            </select>
            <select class="cs-sel" v-model="S.oscA.warp" @change="sp('oscA.warp',S.oscA.warp)">
              <option v-for="w in WARPS" :key="w.v" :value="w.v">{{ w.l }}</option>
            </select>
          </div>
          <div class="cs-knobs">
            <Knob v-model="S.oscA.wtPos"   :min="0" :max="1"  :decimals="2" label="WT POS"  color="#00d4ff" :size="44" @update:modelValue="sp('oscA.wtPos',$event);reqWave('A')" />
            <Knob v-model="S.oscA.warpAmt" :min="0" :max="1"  :decimals="2" label="WARP"    color="#00d4ff" :size="44" @update:modelValue="sp('oscA.warpAmt',$event)" />
            <Knob v-model="S.oscA.level"   :min="0" :max="1"  :decimals="2" label="LEVEL"   color="#00d4ff" :size="44" @update:modelValue="sp('oscA.level',$event)" />
            <Knob v-model="S.oscA.unison"  :min="1" :max="8"  :decimals="0" label="UNISON"  color="#00d4ff" :size="44" @update:modelValue="sp('oscA.unison',Math.round($event))" />
            <Knob v-model="S.oscA.detune"  :min="0" :max="1"  :decimals="2" label="DETUNE"  color="#00d4ff" :size="44" @update:modelValue="sp('oscA.detune',$event)" />
            <Knob v-model="S.oscA.blend"   :min="0" :max="1"  :decimals="2" label="BLEND"   color="#00d4ff" :size="44" @update:modelValue="sp('oscA.blend',$event)" />
            <Knob v-model="S.oscA.pan"     :min="-1" :max="1" :decimals="2" label="PAN"     color="#00d4ff" :size="44" @update:modelValue="sp('oscA.pan',$event)" />
            <Knob v-model="S.oscA.semi"    :min="-24" :max="24" :decimals="0" label="SEMI"  color="#00d4ff" :size="44" @update:modelValue="sp('oscA.semi',Math.round($event))" />
            <Knob v-model="S.oscA.oct"     :min="-4" :max="4" :decimals="0" label="OCT"     color="#00d4ff" :size="44" @update:modelValue="sp('oscA.oct',Math.round($event))" />
          </div>
        </div>

        <div class="cs-osc-row" :style="{ '--c': '#ff9f43' }">
          <div class="cs-osc-head">
            <span class="cs-osc-label">OSC B</span>
            <label class="cs-toggle"><input type="checkbox" v-model="S.oscB.on" @change="sp('oscB.on',$event.target.checked)"> ON</label>
            <select class="cs-sel" v-model="S.oscB.table" @change="sp('oscB.table',S.oscB.table);reqWave('B')">
              <option v-for="t in TABLES" :key="t" :value="t">{{ t }}</option>
            </select>
            <select class="cs-sel" v-model="S.oscB.warp" @change="sp('oscB.warp',S.oscB.warp)">
              <option v-for="w in WARPS" :key="w.v" :value="w.v">{{ w.l }}</option>
            </select>
          </div>
          <div class="cs-knobs">
            <Knob v-model="S.oscB.wtPos"   :min="0" :max="1"  :decimals="2" label="WT POS"  color="#ff9f43" :size="44" @update:modelValue="sp('oscB.wtPos',$event);reqWave('B')" />
            <Knob v-model="S.oscB.warpAmt" :min="0" :max="1"  :decimals="2" label="WARP"    color="#ff9f43" :size="44" @update:modelValue="sp('oscB.warpAmt',$event)" />
            <Knob v-model="S.oscB.level"   :min="0" :max="1"  :decimals="2" label="LEVEL"   color="#ff9f43" :size="44" @update:modelValue="sp('oscB.level',$event)" />
            <Knob v-model="S.oscB.unison"  :min="1" :max="8"  :decimals="0" label="UNISON"  color="#ff9f43" :size="44" @update:modelValue="sp('oscB.unison',Math.round($event))" />
            <Knob v-model="S.oscB.detune"  :min="0" :max="1"  :decimals="2" label="DETUNE"  color="#ff9f43" :size="44" @update:modelValue="sp('oscB.detune',$event)" />
            <Knob v-model="S.oscB.blend"   :min="0" :max="1"  :decimals="2" label="BLEND"   color="#ff9f43" :size="44" @update:modelValue="sp('oscB.blend',$event)" />
            <Knob v-model="S.oscB.pan"     :min="-1" :max="1" :decimals="2" label="PAN"     color="#ff9f43" :size="44" @update:modelValue="sp('oscB.pan',$event)" />
            <Knob v-model="S.oscB.semi"    :min="-24" :max="24" :decimals="0" label="SEMI"  color="#ff9f43" :size="44" @update:modelValue="sp('oscB.semi',Math.round($event))" />
            <Knob v-model="S.oscB.oct"     :min="-4" :max="4" :decimals="0" label="OCT"     color="#ff9f43" :size="44" @update:modelValue="sp('oscB.oct',Math.round($event))" />
          </div>
        </div>
      </div>

      <!-- Sub + Noise + Filter + Master -->
      <div class="cs-bottom-row">
        <div class="cs-block" :style="{ '--c':'#4ecdc4' }">
          <div class="cs-block-head">
            <span>SUB</span>
            <label class="cs-toggle"><input type="checkbox" v-model="S.sub.on" @change="sp('sub.on',$event.target.checked)"> ON</label>
          </div>
          <div class="cs-knobs">
            <Knob v-model="S.sub.level" :min="0" :max="1" :decimals="2" label="LEVEL" color="#4ecdc4" :size="44" @update:modelValue="sp('sub.level',$event)" />
            <Knob v-model="S.sub.oct"   :min="-3" :max="1" :decimals="0" label="OCT"  color="#4ecdc4" :size="44" @update:modelValue="sp('sub.oct',Math.round($event))" />
          </div>
        </div>

        <div class="cs-block" :style="{ '--c':'#9b59b6' }">
          <div class="cs-block-head">
            <span>NOISE</span>
            <label class="cs-toggle"><input type="checkbox" v-model="S.noise.on" @change="sp('noise.on',$event.target.checked)"> ON</label>
          </div>
          <div class="cs-knobs">
            <Knob v-model="S.noise.level" :min="0" :max="1" :decimals="2" label="LEVEL" color="#9b59b6" :size="44" @update:modelValue="sp('noise.level',$event)" />
          </div>
        </div>

        <div class="cs-block cs-block-wide" :style="{ '--c':'#e74c3c' }">
          <div class="cs-block-head">
            <span>FILTER</span>
            <label class="cs-toggle"><input type="checkbox" v-model="S.filter.on" @change="sp('filter.on',$event.target.checked)"> ON</label>
            <select class="cs-sel" v-model="S.filter.type" @change="sp('filter.type',S.filter.type)">
              <option value="lowpass">Low Pass</option>
              <option value="highpass">High Pass</option>
              <option value="bandpass">Band Pass</option>
            </select>
            <label class="cs-toggle"><input type="checkbox" :checked="S.filter.keytrack>0"
              @change="S.filter.keytrack=$event.target.checked?1:0;sp('filter.keytrack',S.filter.keytrack)"> KEY</label>
          </div>
          <div class="cs-knobs">
            <Knob v-model="S.filter.cutoff" :min="0" :max="1" :decimals="2" label="CUTOFF" color="#e74c3c" :size="44" @update:modelValue="sp('filter.cutoff',$event)" />
            <Knob v-model="S.filter.reso"   :min="0" :max="0.98" :decimals="2" label="RES" color="#e74c3c" :size="44" @update:modelValue="sp('filter.reso',$event)" />
            <Knob v-model="S.filter.drive"  :min="0" :max="1" :decimals="2" label="DRIVE" color="#e74c3c" :size="44" @update:modelValue="sp('filter.drive',$event)" />
          </div>
        </div>

        <div class="cs-block" :style="{ '--c':'#f39c12' }">
          <div class="cs-block-head"><span>MASTER</span></div>
          <div class="cs-knobs">
            <Knob v-model="S.masterGain" :min="0" :max="1.5" :decimals="2" label="GAIN" color="#f39c12" :size="44" @update:modelValue="sp('masterGain',$event)" />
          </div>
        </div>
      </div>
    </div>

    <!-- ── ENV / LFO TAB ────────────────────────────────────────────────── -->
    <div v-if="tab==='env'" class="cs-env-tab">

      <div class="cs-env-grid">
        <div v-for="ei in [1,2,3]" :key="ei" class="cs-block" :style="{ '--c':'#ff6b6b' }">
          <div class="cs-block-head">
            <span>ENV {{ ei }} {{ ei===1 ? '— AMP' : '— FREE' }}</span>
          </div>
          <canvas :ref="el => envCanvasRefs[ei] = el" class="cs-env-canvas" width="200" height="60" />
          <div class="cs-knobs">
            <Knob v-model="S['env'+ei].a" :min="0.001" :max="4" :decimals="2" label="A" color="#ff6b6b" :size="42" @update:modelValue="sp('env'+ei+'.a',$event);drawEnv(ei)" />
            <Knob v-model="S['env'+ei].d" :min="0.001" :max="6" :decimals="2" label="D" color="#ff6b6b" :size="42" @update:modelValue="sp('env'+ei+'.d',$event);drawEnv(ei)" />
            <Knob v-model="S['env'+ei].s" :min="0" :max="1" :decimals="2" label="S" color="#ff6b6b" :size="42" @update:modelValue="sp('env'+ei+'.s',$event);drawEnv(ei)" />
            <Knob v-model="S['env'+ei].r" :min="0.001" :max="6" :decimals="2" label="R" color="#ff6b6b" :size="42" @update:modelValue="sp('env'+ei+'.r',$event);drawEnv(ei)" />
          </div>
        </div>
      </div>

      <div class="cs-lfo-grid">
        <div v-for="(lfo,li) in S.lfos" :key="li" class="cs-block" :style="{ '--c':'#4ecdc4' }">
          <div class="cs-block-head">
            <span>LFO {{ li + 1 }}</span>
            <select class="cs-sel cs-sel-sm" v-model="lfo.shape" @change="sp('lfos.'+li+'.shape',lfo.shape);drawLfo(li)">
              <option v-for="sh in LFO_SHAPES" :key="sh.v" :value="sh.v">{{ sh.l }}</option>
            </select>
          </div>
          <canvas :ref="el => lfoCanvasRefs[li] = el" class="cs-lfo-canvas" width="200" height="50" />
          <div class="cs-knobs">
            <Knob v-model="lfo.rate" :min="0" :max="1" :decimals="2" label="RATE" color="#4ecdc4" :size="42"
              @update:modelValue="sp('lfos.'+li+'.rate',$event)" />
            <Knob v-model="lfo.amt"  :min="-1" :max="1" :decimals="2" label="AMT" color="#4ecdc4" :size="42"
              @update:modelValue="sp('lfos.'+li+'.amt',$event)" />
          </div>
          <div class="cs-mod-target">
            <span class="cs-lbl">→</span>
            <select class="cs-sel" v-model="lfo.dest" @change="sp('lfos.'+li+'.dest',lfo.dest)">
              <option v-for="d in MOD_DESTS" :key="d.v" :value="d.v">{{ d.l }}</option>
            </select>
            <span class="cs-val">{{ lfoRateLabel(lfo.rate) }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- ── FX TAB ────────────────────────────────────────────────────────── -->
    <div v-if="tab==='fx'" class="cs-fx-tab">
      <div v-for="fx in FX_LIST" :key="fx.k" class="cs-block" :style="{ '--c': fx.color }">
        <div class="cs-block-head">
          <span>{{ fx.label }}</span>
          <label class="cs-toggle"><input type="checkbox" v-model="S.fx[fx.k].on" @change="sp('fx.'+fx.k+'.on',$event.target.checked)"> ON</label>
        </div>
        <div class="cs-knobs">
          <Knob v-for="p in fx.params" :key="p.k"
            v-model="S.fx[fx.k][p.k]"
            :min="p.min" :max="p.max" :decimals="2" :label="p.l"
            :color="fx.color" :size="46"
            @update:modelValue="sp('fx.'+fx.k+'.'+p.k,$event)" />
        </div>
      </div>
    </div>

    <!-- ── MOD MATRIX TAB ────────────────────────────────────────────────── -->
    <div v-if="tab==='mod'" class="cs-mod-tab">
      <div class="cs-block">
        <div class="cs-block-head"><span>MOD MATRIX</span></div>

        <div class="cs-mod-add">
          <select class="cs-sel" v-model="newRoute.src">
            <option v-for="s in MOD_SRCS" :key="s.v" :value="s.v">{{ s.l }}</option>
          </select>
          <span class="cs-arrow">→</span>
          <select class="cs-sel" v-model="newRoute.dest">
            <option v-for="d in MOD_DESTS.filter(d=>d.v!=='none')" :key="d.v" :value="d.v">{{ d.l }}</option>
          </select>
          <input type="range" min="-1" max="1" step="0.01" class="cs-range" v-model.number="newRoute.amt" />
          <span class="cs-val">{{ newRoute.amt.toFixed(2) }}</span>
          <button class="cs-btn" @click="addRoute">+ ADD</button>
        </div>

        <div class="cs-mod-list">
          <div v-for="(r,i) in modRoutes" :key="i" class="cs-mod-row">
            <span class="cs-mod-src">{{ r.src.toUpperCase() }}</span>
            <span class="cs-arrow">→</span>
            <span class="cs-mod-dest">{{ destLabel(r.dest) }}</span>
            <input type="range" min="-1" max="1" step="0.01" class="cs-range"
              :value="r.amt" @input="r.amt=parseFloat($event.target.value);pushRoutes()" />
            <span class="cs-val">{{ r.amt.toFixed(2) }}</span>
            <button class="cs-btn cs-btn-del" @click="removeRoute(i)">×</button>
          </div>
          <div v-if="!modRoutes.length" class="cs-mod-empty">
            No modulation routes — add one above to make LFOs move parameters automatically.
          </div>
        </div>
      </div>
    </div>

  </div>
</template>

<script setup>
import { ref, reactive, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useStudio } from '../store/studio.js'
import Knob from './Knob.vue'

const { selectedChannel, getCustomSynthNode } = useStudio()
const ch = selectedChannel

const TABS = [
  { k:'osc', l:'OSC'     },
  { k:'env', l:'ENV/LFO' },
  { k:'fx',  l:'FX'      },
  { k:'mod', l:'MOD'     },
]
const TABLES = ['basic','spectral','pwm','digital','formant','noise']
const WARPS = [
  {v:'none', l:'None'},
  {v:'sync', l:'Sync'},
  {v:'bend+',l:'Bend+'},
  {v:'bend-',l:'Bend−'},
  {v:'pwm',  l:'PWM'},
  {v:'asym+',l:'Asym+'},
  {v:'asym-',l:'Asym−'},
  {v:'fmB',  l:'FM from B'},
]
const LFO_SHAPES = [
  {v:'sine',     l:'Sine'},
  {v:'triangle', l:'Triangle'},
  {v:'square',   l:'Square'},
  {v:'sawtooth', l:'Saw'},
  {v:'sah',      l:'S&H'},
]
const MOD_DESTS = [
  {v:'none',          l:'—'},
  {v:'oscA.wtPos',    l:'Osc A WT Pos'},
  {v:'oscB.wtPos',    l:'Osc B WT Pos'},
  {v:'oscA.level',    l:'Osc A Level'},
  {v:'oscB.level',    l:'Osc B Level'},
  {v:'sub.level',     l:'Sub Level'},
  {v:'filter.cutoff', l:'Filter Cutoff'},
  {v:'filter.reso',   l:'Filter Res'},
]
const MOD_SRCS = [
  {v:'lfo1', l:'LFO 1'},
  {v:'lfo2', l:'LFO 2'},
  {v:'lfo3', l:'LFO 3'},
  {v:'lfo4', l:'LFO 4'},
]
const FX_LIST = [
  { k:'dist',   label:'DISTORTION', color:'#e74c3c', params:[
    {k:'drive', l:'DRIVE', min:0, max:1}, {k:'mix', l:'MIX', min:0, max:1} ] },
  { k:'delay',  label:'DELAY',      color:'#9b59b6', params:[
    {k:'time', l:'TIME', min:0.01, max:2}, {k:'fb', l:'F.BACK', min:0, max:0.95}, {k:'mix', l:'MIX', min:0, max:1} ] },
  { k:'reverb', label:'REVERB',     color:'#4ecdc4', params:[
    {k:'size', l:'SIZE', min:0, max:1}, {k:'mix', l:'MIX', min:0, max:1} ] },
]

// ── State ────────────────────────────────────────────────────────────────────
const tab = ref('osc')
const voiceCount = ref(0)

const S = reactive({
  oscA: { table:'basic',    wtPos:.3, level:1,  pan:0, oct:0, semi:0, fine:0, warp:'none', warpAmt:0, unison:1, detune:.3, blend:.5, on:true  },
  oscB: { table:'spectral', wtPos:.4, level:.5, pan:0, oct:0, semi:0, fine:0, warp:'none', warpAmt:0, unison:1, detune:.3, blend:.5, on:false },
  sub:   { level:.3, oct:-1, on:false },
  noise: { level:.2, on:false },
  filter:{ on:true, type:'lowpass', cutoff:.75, reso:.25, drive:0, keytrack:0 },
  env1:  { a:.005, d:.25, s:.7, r:.25 },
  env2:  { a:0,    d:.5,  s:.0, r:.1  },
  env3:  { a:0,    d:.3,  s:.5, r:.2  },
  lfos:  [
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
  masterGain: 0.7,
})

const modRoutes = ref([])
const newRoute  = reactive({ src:'lfo1', dest:'oscA.wtPos', amt:.3 })

// ── Canvas refs ──────────────────────────────────────────────────────────────
const waveA = ref(null)
const waveB = ref(null)
const envCanvasRefs = reactive({})
const lfoCanvasRefs = reactive({})

// ── Helpers ──────────────────────────────────────────────────────────────────
const pct = v => Math.round(v * 100) + '%'
const destLabel = v => MOD_DESTS.find(d => d.v === v)?.l ?? v
const lfoRateLabel = r => {
  const hz = Math.pow(10, r * 4 - 2)
  return hz < 1 ? (hz * 1000).toFixed(0) + 'ms' : hz.toFixed(2) + 'Hz'
}

function getNode() {
  return ch.value?.type === 'custom' ? getCustomSynthNode(ch.value.id) : null
}

function sp(path, value) {
  const node = getNode(); if (!node) return
  node.port.postMessage({ type:'param', path, value })
}

function reqWave(osc) {
  const node = getNode(); if (!node) return
  node.port.postMessage({ type:'getWave', osc })
}

function pushRoutes() {
  const node = getNode(); if (!node) return
  node.port.postMessage({ type:'modRoutes', routes: modRoutes.value.map(r => ({ ...r })) })
}

function addRoute() {
  modRoutes.value.push({ ...newRoute })
  pushRoutes()
}
function removeRoute(i) {
  modRoutes.value.splice(i, 1)
  pushRoutes()
}

// ── Canvas drawing ───────────────────────────────────────────────────────────
// Read live theme colors from CSS so canvases match whatever theme is active.
function themeColors() {
  const cs = getComputedStyle(document.documentElement)
  return {
    bg:     cs.getPropertyValue('--bg-deeper').trim()    || '#0a0a14',
    grid:   cs.getPropertyValue('--border-subtle').trim()|| '#1a1a28',
    text:   cs.getPropertyValue('--text-muted').trim()   || '#666680',
  }
}

function drawWave(canvas, samples, color) {
  if (!canvas) return
  const ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height
  const t = themeColors()
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = t.bg; ctx.fillRect(0, 0, w, h)
  // Grid lines
  ctx.strokeStyle = t.grid; ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(0, h/2); ctx.lineTo(w, h/2); ctx.stroke()
  // Waveform line with glow
  ctx.shadowColor = color; ctx.shadowBlur = 6
  ctx.strokeStyle = color; ctx.lineWidth = 2
  ctx.beginPath()
  for (let i = 0; i < samples.length; i++) {
    const x = (i / samples.length) * w
    const y = h/2 - samples[i] * h/2 * 0.88
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
  }
  ctx.stroke()
  ctx.shadowBlur = 0
}

function drawEnv(n) {
  const canvas = envCanvasRefs[n]
  const p = S['env' + n]
  if (!canvas) return
  const ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height
  const t = themeColors()
  ctx.clearRect(0, 0, w, h); ctx.fillStyle = t.bg; ctx.fillRect(0, 0, w, h)
  const pad = 6
  const tot = p.a + p.d + 0.4 + p.r
  const aw = p.a / tot * (w - pad*2)
  const dw = p.d / tot * (w - pad*2)
  const sw = 0.4 / tot * (w - pad*2)
  const sy = pad + (1 - p.s) * (h - pad*2)
  ctx.strokeStyle = '#ff6b6b'; ctx.lineWidth = 2
  ctx.shadowColor = '#ff6b6b'; ctx.shadowBlur = 4
  ctx.beginPath()
  ctx.moveTo(pad,                 h - pad)
  ctx.lineTo(pad + aw,            pad)
  ctx.lineTo(pad + aw + dw,       sy)
  ctx.lineTo(pad + aw + dw + sw,  sy)
  ctx.lineTo(w - pad,             h - pad)
  ctx.stroke()
  ctx.shadowBlur = 0
}

function drawLfo(idx) {
  const canvas = lfoCanvasRefs[idx]
  const shape = S.lfos[idx].shape
  if (!canvas) return
  const ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height
  const t = themeColors()
  ctx.clearRect(0, 0, w, h); ctx.fillStyle = t.bg; ctx.fillRect(0, 0, w, h)
  ctx.strokeStyle = t.grid; ctx.beginPath()
  ctx.moveTo(0, h/2); ctx.lineTo(w, h/2); ctx.stroke()
  ctx.strokeStyle = '#4ecdc4'; ctx.lineWidth = 2
  ctx.shadowColor = '#4ecdc4'; ctx.shadowBlur = 4
  ctx.beginPath()
  for (let i = 0; i <= 200; i++) {
    const p = i / 200
    let v
    switch (shape) {
      case 'triangle': v = p < .5 ? 4*p - 1 : 3 - 4*p; break
      case 'square':   v = p < .5 ? 1 : -1; break
      case 'sawtooth': v = 1 - 2*p; break
      case 'sah':      v = p < .5 ? 1 : -1; break
      default:         v = Math.sin(2 * Math.PI * p)
    }
    const x = p * w, y = h/2 - v * h/2 * 0.85
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
  }
  ctx.stroke()
  ctx.shadowBlur = 0
}

// ── Worklet → UI ─────────────────────────────────────────────────────────────
function onWorkletMsg({ data }) {
  if (data.type === 'waveform') {
    drawWave(data.osc === 'A' ? waveA.value : waveB.value, data.samples,
             data.osc === 'A' ? '#00d4ff' : '#ff9f43')
  } else if (data.type === 'meters') {
    voiceCount.value = data.voices
  }
}

let _attached = null
let _attachRetry = null
let _wavePolling = null

function attach() {
  const node = getNode()
  if (!node) {
    // Node is created asynchronously — retry until it's ready
    if (ch.value?.type === 'custom') {
      clearTimeout(_attachRetry)
      _attachRetry = setTimeout(attach, 120)
    }
    return
  }
  if (_attached === node) return
  if (_attached) _attached.port.onmessage = null
  _attached = node
  node.port.onmessage = onWorkletMsg
  // Push complete state in case node was just created
  node.port.postMessage({ type:'fullState', state: JSON.parse(JSON.stringify(S)) })
  // Fire initial waveform fetch + start polling fallback (worklet also sends them
  // periodically from inside process(), but only when the audio thread is active)
  reqWave('A'); reqWave('B')
  clearInterval(_wavePolling)
  _wavePolling = setInterval(() => {
    if (tab.value === 'osc') { reqWave('A'); reqWave('B') }
  }, 250)
}

// ── Watchers ─────────────────────────────────────────────────────────────────
watch(() => ch.value?.id, () => {
  nextTick(() => {
    attach()
    if (tab.value === 'env') {
      [1,2,3].forEach(drawEnv)
      ;[0,1,2,3].forEach(drawLfo)
    }
  })
}, { immediate: true })

watch(tab, () => {
  nextTick(() => {
    if (tab.value === 'env') {
      [1,2,3].forEach(drawEnv)
      ;[0,1,2,3].forEach(drawLfo)
    } else if (tab.value === 'osc') {
      reqWave('A'); reqWave('B')
    }
  })
})

watch(() => [S.lfos[0].shape, S.lfos[1].shape, S.lfos[2].shape, S.lfos[3].shape],
  () => [0,1,2,3].forEach(drawLfo))

onMounted(() => {
  nextTick(() => {
    attach()
    if (tab.value === 'env') {
      [1,2,3].forEach(drawEnv)
      ;[0,1,2,3].forEach(drawLfo)
    }
  })
})

onBeforeUnmount(() => {
  clearTimeout(_attachRetry)
  clearInterval(_wavePolling)
  if (_attached) { _attached.port.onmessage = null; _attached = null }
})
</script>

<style scoped>
.cs {
  display:flex; flex-direction:column; height:100%;
  background:var(--bg-base);
  color:var(--text-primary); font-family:'Share Tech Mono', monospace;
  overflow:hidden;
}

/* Header */
.cs-header {
  display:flex; align-items:center; gap:12px;
  padding:8px 14px; background:var(--bg-header); border-bottom:1px solid var(--border-subtle);
  flex-shrink:0;
}
.cs-brand {
  font-family:'Rajdhani',sans-serif; font-size:14px; font-weight:700;
  color:var(--accent, #00d4ff); letter-spacing:.12em;
}
.cs-name  { color:var(--text-muted); font-size:11px; flex:1 }
.cs-tabs  { display:flex; gap:2px }
.cs-tab {
  background:var(--bg-panel); border:1px solid var(--border); color:var(--text-muted);
  font-size:11px; padding:5px 14px; cursor:pointer; border-radius:3px;
  font-family:'Rajdhani',sans-serif; font-weight:700; letter-spacing:.1em;
  transition:all .12s;
}
.cs-tab:hover { color:var(--text-primary); background:var(--bg-hover) }
.cs-tab.active {
  background:var(--bg-control); border-color:var(--accent, #00d4ff);
  color:var(--accent, #00d4ff);
}
.cs-meters { display:flex; align-items:center; gap:6px }
.cs-meter-label { font-size:9px; color:var(--text-muted); letter-spacing:.12em }
.cs-meter-val { font-size:11px; color:var(--accent, #00d4ff); font-weight:700 }

/* OSC tab */
.cs-osc-tab { display:flex; flex-direction:column; gap:10px; padding:10px; overflow-y:auto; flex:1 }

.cs-wave-stage { display:flex; gap:10px; }
.cs-wave-box {
  flex:1; background:var(--bg-deeper); border:1px solid var(--border-subtle); border-radius:6px;
  padding:6px; position:relative; min-height:140px;
}
.cs-wave-title {
  position:absolute; top:6px; left:10px; font-size:9px; letter-spacing:.12em;
  font-family:'Rajdhani',sans-serif; font-weight:700; z-index:2;
}
.cs-wave-canvas { width:100%; height:120px; display:block; margin-top:14px }

.cs-osc-rows { display:flex; flex-direction:column; gap:8px }
.cs-osc-row {
  background:var(--bg-panel); border:1px solid var(--c, var(--border));
  border-radius:6px; padding:8px 10px; display:flex; flex-direction:column; gap:6px;
}
.cs-osc-head { display:flex; align-items:center; gap:10px; flex-wrap:wrap }
.cs-osc-label {
  font-family:'Rajdhani',sans-serif; font-size:14px; font-weight:700;
  letter-spacing:.15em; color:var(--c); min-width:50px;
}
.cs-knobs { display:flex; flex-wrap:wrap; gap:10px; align-items:flex-end; padding:2px 0 }

.cs-bottom-row { display:flex; gap:10px; flex-wrap:wrap }
.cs-block {
  background:var(--bg-panel); border:1px solid var(--c, var(--border));
  border-radius:6px; padding:8px 10px; display:flex; flex-direction:column; gap:6px;
  flex:1; min-width:140px;
}
.cs-block-wide { min-width:240px }
.cs-block-head {
  display:flex; align-items:center; gap:8px; flex-wrap:wrap;
  font-family:'Rajdhani',sans-serif; font-size:11px; font-weight:700;
  letter-spacing:.15em; color:var(--c);
}

/* ENV/LFO tab */
.cs-env-tab { display:flex; flex-direction:column; gap:10px; padding:10px; overflow-y:auto; flex:1 }
.cs-env-grid { display:grid; grid-template-columns:repeat(3, 1fr); gap:10px }
.cs-lfo-grid { display:grid; grid-template-columns:repeat(2, 1fr); gap:10px }
.cs-env-canvas, .cs-lfo-canvas {
  width:100%; height:60px; display:block;
  background:var(--bg-deeper); border:1px solid var(--border-subtle); border-radius:3px;
}
.cs-lfo-canvas { height:50px }
.cs-mod-target { display:flex; align-items:center; gap:6px }
.cs-mod-target .cs-sel { flex:1 }

/* FX tab */
.cs-fx-tab { display:flex; flex-wrap:wrap; gap:10px; padding:10px; overflow-y:auto; flex:1 }
.cs-fx-tab .cs-block { min-width:280px }

/* MOD tab */
.cs-mod-tab { display:flex; flex-direction:column; padding:10px; overflow-y:auto; flex:1 }
.cs-mod-add { display:flex; align-items:center; gap:6px; margin-bottom:8px }
.cs-mod-list { display:flex; flex-direction:column; gap:4px }
.cs-mod-row {
  display:flex; align-items:center; gap:8px;
  background:var(--bg-deeper); border:1px solid var(--border-subtle); border-radius:4px; padding:6px 8px;
}
.cs-mod-src  { font-size:10px; color:var(--accent, #00d4ff); min-width:54px; font-weight:700 }
.cs-mod-dest { font-size:10px; color:var(--text-primary); flex:1 }
.cs-arrow    { color:var(--accent, #00d4ff); font-size:13px }
.cs-mod-empty { font-size:9px; color:var(--text-muted); padding:10px; text-align:center }

/* Controls */
.cs-toggle {
  display:flex; align-items:center; gap:4px; font-size:9px;
  color:var(--text-muted); cursor:pointer; user-select:none;
}
.cs-toggle input { accent-color:var(--accent, #00d4ff); cursor:pointer }
.cs-sel {
  background:var(--bg-control); border:1px solid var(--border);
  color:var(--text-primary); font-size:10px; padding:3px 6px; border-radius:3px;
  font-family:inherit; cursor:pointer; outline:none;
}
.cs-sel-sm { font-size:9px; padding:2px 4px }
.cs-sel:focus { border-color:var(--accent, #00d4ff) }
.cs-range { flex:1; accent-color:var(--accent, #00d4ff); cursor:pointer; min-width:80px }
.cs-val { font-size:9px; color:var(--text-muted); min-width:36px; text-align:right }
.cs-lbl { font-size:9px; color:var(--text-muted); letter-spacing:.1em }
.cs-btn {
  background:var(--bg-panel); border:1px solid var(--border);
  color:var(--text-primary); font-size:10px; padding:4px 10px; border-radius:3px;
  cursor:pointer; font-family:inherit; font-weight:700; letter-spacing:.05em;
}
.cs-btn:hover { border-color:var(--accent, #00d4ff); color:var(--accent, #00d4ff) }
.cs-btn-del { color:#e74c3c; border-color:#3a1a1a; padding:2px 6px }
.cs-btn-del:hover { border-color:#e74c3c }
</style>
