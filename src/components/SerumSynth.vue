<template>
  <div class="serum" v-if="ch">

    <!-- ── Header ─────────────────────────────────────────────────────────── -->
    <div class="sr-header">
      <span class="sr-title">◈ SERUM — {{ ch.name }}</span>
      <div class="sr-tabs">
        <button :class="['sr-tab', {active:tab==='osc'}]" @click="tab='osc'">OSC</button>
        <button :class="['sr-tab', {active:tab==='env'}]" @click="tab='env'">ENV/LFO</button>
        <button :class="['sr-tab', {active:tab==='fx'}]" @click="tab='fx'">FX</button>
        <button :class="['sr-tab', {active:tab==='mod'}]" @click="tab='mod'">MOD</button>
      </div>
      <div class="sr-macros-mini">
        <span class="sr-m-label">MACRO</span>
        <input v-for="(m,i) in macros" :key="i" type="range" min="0" max="1" step="0.01"
          class="sr-macro-mini" :value="m" @input="setMacro(i,$event.target.value)" :title="`Macro ${i+1}`" />
      </div>
    </div>

    <!-- ── OSC TAB ────────────────────────────────────────────────────────── -->
    <div v-if="tab==='osc'" class="sr-osc-tab">

      <!-- OSC A -->
      <div class="sr-osc-panel">
        <div class="sr-osc-head">
          <span class="sr-osc-label" style="color:#00d4ff">OSC A</span>
          <label class="sr-toggle"><input type="checkbox" v-model="S.oscA.on" @change="sp('oscA.on',$event.target.checked)"> ON</label>
        </div>
        <canvas ref="waveA" class="sr-wave" width="200" height="60" />
        <div class="sr-row">
          <span class="sr-lbl">TABLE</span>
          <select class="sr-sel" v-model="S.oscA.table" @change="sp('oscA.table',S.oscA.table);reqWave('A')">
            <option v-for="t in TABLES" :key="t" :value="t">{{ t }}</option>
          </select>
        </div>
        <div class="sr-row">
          <span class="sr-lbl">WT POS</span>
          <input type="range" min="0" max="1" step="0.01" class="sr-range" v-model.number="S.oscA.wtPos"
            @input="sp('oscA.wtPos',S.oscA.wtPos);reqWave('A')" />
          <span class="sr-val">{{ pct(S.oscA.wtPos) }}</span>
        </div>
        <div class="sr-row">
          <span class="sr-lbl">WARP</span>
          <select class="sr-sel sr-sel-sm" v-model="S.oscA.warp" @change="sp('oscA.warp',S.oscA.warp)">
            <option v-for="w in WARPS" :key="w.v" :value="w.v">{{ w.l }}</option>
          </select>
          <input type="range" min="0" max="1" step="0.01" class="sr-range sr-range-sm" v-model.number="S.oscA.warpAmt"
            @input="sp('oscA.warpAmt',S.oscA.warpAmt)" />
        </div>
        <div class="sr-row">
          <span class="sr-lbl">LEVEL</span>
          <input type="range" min="0" max="1" step="0.01" class="sr-range" v-model.number="S.oscA.level"
            @input="sp('oscA.level',S.oscA.level)" />
          <span class="sr-val">{{ pct(S.oscA.level) }}</span>
        </div>
        <div class="sr-row">
          <span class="sr-lbl">UNISON</span>
          <select class="sr-sel sr-sel-sm" v-model.number="S.oscA.unison" @change="sp('oscA.unison',S.oscA.unison)">
            <option v-for="n in 8" :key="n" :value="n">{{ n }}v</option>
          </select>
          <input type="range" min="0" max="1" step="0.01" class="sr-range sr-range-sm" v-model.number="S.oscA.detune"
            @input="sp('oscA.detune',S.oscA.detune)" title="Detune" />
        </div>
        <div class="sr-row">
          <span class="sr-lbl">PITCH</span>
          <select class="sr-sel sr-sel-xs" v-model.number="S.oscA.oct" @change="sp('oscA.oct',S.oscA.oct)">
            <option v-for="o in [-4,-3,-2,-1,0,1,2,3,4]" :key="o" :value="o">{{ o>0?'+'+o:o }}oct</option>
          </select>
          <input type="range" min="-12" max="12" step="1" class="sr-range" v-model.number="S.oscA.semi"
            @input="sp('oscA.semi',S.oscA.semi)" :title="`Semi: ${S.oscA.semi}`" />
          <span class="sr-val">{{ S.oscA.semi }}</span>
        </div>
      </div>

      <!-- OSC B -->
      <div class="sr-osc-panel">
        <div class="sr-osc-head">
          <span class="sr-osc-label" style="color:#ff9f43">OSC B</span>
          <label class="sr-toggle"><input type="checkbox" v-model="S.oscB.on" @change="sp('oscB.on',$event.target.checked)"> ON</label>
        </div>
        <canvas ref="waveB" class="sr-wave" width="200" height="60" />
        <div class="sr-row">
          <span class="sr-lbl">TABLE</span>
          <select class="sr-sel" v-model="S.oscB.table" @change="sp('oscB.table',S.oscB.table);reqWave('B')">
            <option v-for="t in TABLES" :key="t" :value="t">{{ t }}</option>
          </select>
        </div>
        <div class="sr-row">
          <span class="sr-lbl">WT POS</span>
          <input type="range" min="0" max="1" step="0.01" class="sr-range" v-model.number="S.oscB.wtPos"
            @input="sp('oscB.wtPos',S.oscB.wtPos);reqWave('B')" />
          <span class="sr-val">{{ pct(S.oscB.wtPos) }}</span>
        </div>
        <div class="sr-row">
          <span class="sr-lbl">WARP</span>
          <select class="sr-sel sr-sel-sm" v-model="S.oscB.warp" @change="sp('oscB.warp',S.oscB.warp)">
            <option v-for="w in WARPS" :key="w.v" :value="w.v">{{ w.l }}</option>
          </select>
          <input type="range" min="0" max="1" step="0.01" class="sr-range sr-range-sm" v-model.number="S.oscB.warpAmt"
            @input="sp('oscB.warpAmt',S.oscB.warpAmt)" />
        </div>
        <div class="sr-row">
          <span class="sr-lbl">LEVEL</span>
          <input type="range" min="0" max="1" step="0.01" class="sr-range" v-model.number="S.oscB.level"
            @input="sp('oscB.level',S.oscB.level)" />
          <span class="sr-val">{{ pct(S.oscB.level) }}</span>
        </div>
        <div class="sr-row">
          <span class="sr-lbl">UNISON</span>
          <select class="sr-sel sr-sel-sm" v-model.number="S.oscB.unison" @change="sp('oscB.unison',S.oscB.unison)">
            <option v-for="n in 8" :key="n" :value="n">{{ n }}v</option>
          </select>
          <input type="range" min="0" max="1" step="0.01" class="sr-range sr-range-sm" v-model.number="S.oscB.detune"
            @input="sp('oscB.detune',S.oscB.detune)" title="Detune" />
        </div>
        <div class="sr-row">
          <span class="sr-lbl">PITCH</span>
          <select class="sr-sel sr-sel-xs" v-model.number="S.oscB.oct" @change="sp('oscB.oct',S.oscB.oct)">
            <option v-for="o in [-4,-3,-2,-1,0,1,2,3,4]" :key="o" :value="o">{{ o>0?'+'+o:o }}oct</option>
          </select>
          <input type="range" min="-12" max="12" step="1" class="sr-range" v-model.number="S.oscB.semi"
            @input="sp('oscB.semi',S.oscB.semi)" :title="`Semi: ${S.oscB.semi}`" />
          <span class="sr-val">{{ S.oscB.semi }}</span>
        </div>
      </div>

      <!-- Sub + Noise + Filter -->
      <div class="sr-right-col">

        <!-- Sub + Noise -->
        <div class="sr-section">
          <div class="sr-sec-title">SUB / NOISE</div>
          <div class="sr-row">
            <label class="sr-toggle"><input type="checkbox" v-model="S.sub.on" @change="sp('sub.on',$event.target.checked)"> SUB</label>
            <input type="range" min="0" max="1" step="0.01" class="sr-range" v-model.number="S.sub.level"
              @input="sp('sub.level',S.sub.level)" />
            <select class="sr-sel sr-sel-xs" v-model.number="S.sub.oct" @change="sp('sub.oct',S.sub.oct)">
              <option v-for="o in [-3,-2,-1,0,1]" :key="o" :value="o">{{ o>0?'+':'' }}{{ o }}oct</option>
            </select>
          </div>
          <div class="sr-row">
            <label class="sr-toggle"><input type="checkbox" v-model="S.noise.on" @change="sp('noise.on',$event.target.checked)"> NOISE</label>
            <input type="range" min="0" max="1" step="0.01" class="sr-range" v-model.number="S.noise.level"
              @input="sp('noise.level',S.noise.level)" />
          </div>
        </div>

        <!-- Filter -->
        <div class="sr-section">
          <div class="sr-sec-title">
            FILTER
            <label class="sr-toggle" style="float:right">
              <input type="checkbox" v-model="S.filter.on" @change="sp('filter.on',$event.target.checked)"> ON
            </label>
          </div>
          <div class="sr-row">
            <span class="sr-lbl">TYPE</span>
            <select class="sr-sel" v-model="S.filter.type" @change="sp('filter.type',S.filter.type)">
              <option value="lowpass">Low Pass</option>
              <option value="highpass">High Pass</option>
              <option value="bandpass">Band Pass</option>
            </select>
          </div>
          <div class="sr-row">
            <span class="sr-lbl">CUTOFF</span>
            <input type="range" min="0" max="1" step="0.001" class="sr-range" v-model.number="S.filter.cutoff"
              @input="sp('filter.cutoff',S.filter.cutoff)" />
            <span class="sr-val">{{ Math.round(80*Math.pow(10,S.filter.cutoff*2.1)) }}Hz</span>
          </div>
          <div class="sr-row">
            <span class="sr-lbl">RES</span>
            <input type="range" min="0" max="0.98" step="0.01" class="sr-range" v-model.number="S.filter.reso"
              @input="sp('filter.reso',S.filter.reso)" />
            <span class="sr-val">{{ pct(S.filter.reso) }}</span>
          </div>
          <div class="sr-row">
            <span class="sr-lbl">DRIVE</span>
            <input type="range" min="0" max="1" step="0.01" class="sr-range" v-model.number="S.filter.drive"
              @input="sp('filter.drive',S.filter.drive)" />
            <span class="sr-val">{{ pct(S.filter.drive) }}</span>
          </div>
          <div class="sr-row">
            <label class="sr-toggle">
              <input type="checkbox" :checked="S.filter.keytrack>0"
                @change="S.filter.keytrack=$event.target.checked?1:0;sp('filter.keytrack',S.filter.keytrack)"> KEY TRACK
            </label>
          </div>
        </div>
      </div>
    </div>

    <!-- ── ENV / LFO TAB ──────────────────────────────────────────────────── -->
    <div v-if="tab==='env'" class="sr-env-tab">

      <!-- ENV 1 (amp) -->
      <div class="sr-section">
        <div class="sr-sec-title">ENV 1 — AMP</div>
        <canvas ref="envCanvas1" class="sr-env-canvas" width="220" height="50" />
        <div class="sr-adsr-row">
          <div class="sr-adsr-knob" v-for="(k,ki) in ['a','d','s','r']" :key="k">
            <span class="sr-lbl">{{ k.toUpperCase() }}</span>
            <input type="range" :min="k==='s'?0:0.001" :max="k==='s'?1:k==='a'?4:6" :step="k==='s'?0.01:0.001"
              class="sr-range-v" orient="vertical" v-model.number="S.env1[k]"
              @input="sp('env1.'+k,S.env1[k]);drawEnv(1)" />
            <span class="sr-val">{{ k==='s'?pct(S.env1[k]):S.env1[k].toFixed(2)+'s' }}</span>
          </div>
        </div>
      </div>

      <!-- ENV 2 (free) -->
      <div class="sr-section">
        <div class="sr-sec-title">ENV 2 — FREE</div>
        <canvas ref="envCanvas2" class="sr-env-canvas" width="220" height="50" />
        <div class="sr-adsr-row">
          <div class="sr-adsr-knob" v-for="k in ['a','d','s','r']" :key="k">
            <span class="sr-lbl">{{ k.toUpperCase() }}</span>
            <input type="range" :min="k==='s'?0:0.001" :max="k==='s'?1:k==='a'?4:6" :step="k==='s'?0.01:0.001"
              class="sr-range-v" orient="vertical" v-model.number="S.env2[k]"
              @input="sp('env2.'+k,S.env2[k]);drawEnv(2)" />
            <span class="sr-val">{{ k==='s'?pct(S.env2[k]):S.env2[k].toFixed(2)+'s' }}</span>
          </div>
        </div>
      </div>

      <!-- LFO 1 -->
      <div class="sr-section">
        <div class="sr-sec-title">LFO 1</div>
        <canvas ref="lfoCanvas1" class="sr-lfo-canvas" width="220" height="50" />
        <div class="sr-row">
          <span class="sr-lbl">SHAPE</span>
          <select class="sr-sel" v-model="S.lfo1.shape" @change="sp('lfo1.shape',S.lfo1.shape);drawLfo(1)">
            <option v-for="s in LFO_SHAPES" :key="s.v" :value="s.v">{{ s.l }}</option>
          </select>
        </div>
        <div class="sr-row">
          <span class="sr-lbl">RATE</span>
          <input type="range" min="0" max="1" step="0.01" class="sr-range" v-model.number="S.lfo1.rate"
            @input="sp('lfo1.rate',S.lfo1.rate)" />
          <span class="sr-val">{{ lfoRateLabel(S.lfo1.rate) }}</span>
        </div>
        <div class="sr-row">
          <span class="sr-lbl">AMT</span>
          <input type="range" min="-1" max="1" step="0.01" class="sr-range" v-model.number="S.lfo1.amt"
            @input="sp('lfo1.amt',S.lfo1.amt)" />
          <span class="sr-val">{{ S.lfo1.amt.toFixed(2) }}</span>
        </div>
        <div class="sr-row">
          <span class="sr-lbl">→</span>
          <select class="sr-sel" v-model="S.lfo1.dest" @change="sp('lfo1.dest',S.lfo1.dest)">
            <option v-for="d in MOD_DESTS" :key="d.v" :value="d.v">{{ d.l }}</option>
          </select>
        </div>
      </div>

      <!-- LFO 2 -->
      <div class="sr-section">
        <div class="sr-sec-title">LFO 2</div>
        <canvas ref="lfoCanvas2" class="sr-lfo-canvas" width="220" height="50" />
        <div class="sr-row">
          <span class="sr-lbl">SHAPE</span>
          <select class="sr-sel" v-model="S.lfo2.shape" @change="sp('lfo2.shape',S.lfo2.shape);drawLfo(2)">
            <option v-for="s in LFO_SHAPES" :key="s.v" :value="s.v">{{ s.l }}</option>
          </select>
        </div>
        <div class="sr-row">
          <span class="sr-lbl">RATE</span>
          <input type="range" min="0" max="1" step="0.01" class="sr-range" v-model.number="S.lfo2.rate"
            @input="sp('lfo2.rate',S.lfo2.rate)" />
          <span class="sr-val">{{ lfoRateLabel(S.lfo2.rate) }}</span>
        </div>
        <div class="sr-row">
          <span class="sr-lbl">AMT</span>
          <input type="range" min="-1" max="1" step="0.01" class="sr-range" v-model.number="S.lfo2.amt"
            @input="sp('lfo2.amt',S.lfo2.amt)" />
          <span class="sr-val">{{ S.lfo2.amt.toFixed(2) }}</span>
        </div>
        <div class="sr-row">
          <span class="sr-lbl">→</span>
          <select class="sr-sel" v-model="S.lfo2.dest" @change="sp('lfo2.dest',S.lfo2.dest)">
            <option v-for="d in MOD_DESTS" :key="d.v" :value="d.v">{{ d.l }}</option>
          </select>
        </div>
      </div>
    </div>

    <!-- ── FX TAB ──────────────────────────────────────────────────────────── -->
    <div v-if="tab==='fx'" class="sr-fx-tab">

      <div v-for="fx in FX_LIST" :key="fx.k" class="sr-section sr-fx-section">
        <div class="sr-sec-title">
          {{ fx.label }}
          <label class="sr-toggle" style="float:right">
            <input type="checkbox" v-model="S.fx[fx.k].on" @change="sp('fx.'+fx.k+'.on',$event.target.checked)"> ON
          </label>
        </div>
        <template v-for="p in fx.params" :key="p.k">
          <div class="sr-row">
            <span class="sr-lbl">{{ p.l }}</span>
            <input type="range" :min="p.min" :max="p.max" :step="p.step||0.01" class="sr-range"
              v-model.number="S.fx[fx.k][p.k]"
              @input="sp('fx.'+fx.k+'.'+p.k,S.fx[fx.k][p.k])" />
            <span class="sr-val">{{ S.fx[fx.k][p.k].toFixed(2) }}</span>
          </div>
        </template>
      </div>
    </div>

    <!-- ── MOD ROUTING TAB ────────────────────────────────────────────────── -->
    <div v-if="tab==='mod'" class="sr-mod-tab">
      <div class="sr-sec-title">MOD MATRIX — drag a source to a destination</div>

      <!-- Add route -->
      <div class="sr-mod-add">
        <select class="sr-sel" v-model="newRoute.src">
          <option v-for="s in MOD_SRCS" :key="s.v" :value="s.v">{{ s.l }}</option>
        </select>
        <span class="sr-arrow">→</span>
        <select class="sr-sel" v-model="newRoute.dest">
          <option v-for="d in MOD_DESTS.filter(d=>d.v!=='none')" :key="d.v" :value="d.v">{{ d.l }}</option>
        </select>
        <input type="range" min="-1" max="1" step="0.01" class="sr-range sr-range-sm" v-model.number="newRoute.amt" />
        <span class="sr-val">{{ newRoute.amt.toFixed(2) }}</span>
        <button class="sr-btn" @click="addRoute">+ ADD</button>
      </div>

      <!-- Route list -->
      <div class="sr-mod-list">
        <div v-for="(r,i) in modRoutes" :key="i" class="sr-mod-row">
          <span class="sr-mod-src">{{ r.src }}</span>
          <span class="sr-arrow">→</span>
          <span class="sr-mod-dest">{{ r.dest }}</span>
          <input type="range" min="-1" max="1" step="0.01" class="sr-range sr-range-sm"
            :value="r.amt" @input="r.amt=parseFloat($event.target.value);pushRoutes()" />
          <span class="sr-val">{{ r.amt.toFixed(2) }}</span>
          <button class="sr-btn sr-btn-del" @click="removeRoute(i)">×</button>
        </div>
        <div v-if="!modRoutes.length" class="sr-mod-empty">No modulation routes. Add one above.</div>
      </div>

      <!-- Macros -->
      <div class="sr-sec-title" style="margin-top:12px">MACROS</div>
      <div class="sr-macros">
        <div v-for="(m,i) in macros" :key="i" class="sr-macro-block">
          <span class="sr-lbl">M{{ i+1 }}</span>
          <input type="range" min="0" max="1" step="0.01" class="sr-range"
            :value="m" @input="setMacro(i,$event.target.value)" />
          <span class="sr-val">{{ Number(m).toFixed(2) }}</span>
        </div>
      </div>
    </div>

  </div>
</template>

<script setup>
import { ref, reactive, watch, onMounted, nextTick, onBeforeUnmount } from 'vue'
import { useStudio } from '../store/studio.js'

const { selectedChannel, getSerumNode } = useStudio()

const ch = selectedChannel  // computed ref

const TABLES     = ['basic','spectral','pwm','digital','formant']
const WARPS      = [
  {v:'none',l:'None'},{v:'sync',l:'Sync'},{v:'bend+',l:'Bend+'},
  {v:'bend-',l:'Bend−'},{v:'pwm',l:'PWM'},{v:'asym+',l:'Asym+'},
  {v:'asym-',l:'Asym−'},{v:'fmB',l:'FM from B'},
]
const LFO_SHAPES = [
  {v:'sine',l:'Sine'},{v:'triangle',l:'Triangle'},
  {v:'square',l:'Square'},{v:'sawtooth',l:'Sawtooth'},
]
const MOD_DESTS = [
  {v:'none',l:'—'},
  {v:'oscA.wtPos',l:'Osc A WT Pos'},{v:'oscB.wtPos',l:'Osc B WT Pos'},
  {v:'filter.cutoff',l:'Filter Cutoff'},{v:'filter.reso',l:'Filter Res'},
  {v:'oscA.level',l:'Osc A Level'},{v:'oscB.level',l:'Osc B Level'},
  {v:'sub.level',l:'Sub Level'},
]
const MOD_SRCS = [
  {v:'lfo1',l:'LFO 1'},{v:'lfo2',l:'LFO 2'},{v:'env2',l:'ENV 2'},
]
const FX_LIST = [
  { k:'dist',   label:'DISTORTION', params:[{k:'drive',l:'DRIVE',min:0,max:1},{k:'mix',l:'MIX',min:0,max:1}] },
  { k:'delay',  label:'DELAY',      params:[{k:'time',l:'TIME',min:0.01,max:2},{k:'fb',l:'FEEDBACK',min:0,max:0.95},{k:'mix',l:'MIX',min:0,max:1}] },
  { k:'reverb', label:'REVERB',     params:[{k:'size',l:'SIZE',min:0,max:1},{k:'mix',l:'MIX',min:0,max:1}] },
]

// ── State ─────────────────────────────────────────────────────────────────────
const tab = ref('osc')
const S = reactive({
  oscA: { table:'basic',  wtPos:.3, level:1,  pan:0, oct:0, semi:0, fine:0, warp:'none', warpAmt:0, unison:1, detune:.3, blend:.5, on:true  },
  oscB: { table:'basic',  wtPos:.6, level:.6, pan:0, oct:0, semi:0, fine:0, warp:'none', warpAmt:0, unison:1, detune:.3, blend:.5, on:false },
  sub:   { level:.3, oct:-1, on:false },
  noise: { level:.2, on:false },
  filter:{ on:true, type:'lowpass', cutoff:.7, reso:.3, drive:0, keytrack:0 },
  env1:  { a:.01, d:.2, s:.7, r:.3 },
  env2:  { a:0,   d:.5, s:0,  r:.1 },
  lfo1:  { shape:'sine', rate:.4, amt:0, dest:'none' },
  lfo2:  { shape:'sine', rate:.6, amt:0, dest:'none' },
  fx:    { dist:{on:false,drive:.5,mix:.5}, delay:{on:false,time:.25,fb:.4,mix:.3}, reverb:{on:false,size:.5,mix:.3} },
})

const macros    = ref([0,0,0,0])
const modRoutes = ref([])
const newRoute  = reactive({ src:'lfo1', dest:'oscA.wtPos', amt:.3 })

// ── Canvas refs ───────────────────────────────────────────────────────────────
const waveA      = ref(null), waveB    = ref(null)
const envCanvas1 = ref(null), envCanvas2 = ref(null)
const lfoCanvas1 = ref(null), lfoCanvas2 = ref(null)

// ── Helpers ───────────────────────────────────────────────────────────────────
const pct = v => Math.round(v * 100) + '%'
const lfoRateLabel = r => {
  const hz = Math.pow(10, r * 4 - 2)
  return hz < 1 ? (hz * 1000).toFixed(0) + 'ms' : hz.toFixed(2) + 'Hz'
}

function getNode() {
  return ch.value?.type === 'serum' ? getSerumNode(ch.value.id) : null
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
  node.port.postMessage({ type:'modRoutes', routes: modRoutes.value.map(r=>({...r})) })
}

function addRoute() {
  modRoutes.value.push({ ...newRoute })
  pushRoutes()
}
function removeRoute(i) { modRoutes.value.splice(i,1); pushRoutes() }
function setMacro(i,v) { macros.value[i]=parseFloat(v) }

// ── Canvas drawing ────────────────────────────────────────────────────────────
function drawWave(canvas, samples) {
  if (!canvas) return
  const ctx = canvas.getContext('2d'), w=canvas.width, h=canvas.height
  ctx.clearRect(0,0,w,h)
  ctx.fillStyle='#0a0a1a'; ctx.fillRect(0,0,w,h)
  // Grid line
  ctx.strokeStyle='#1a1a3a'; ctx.lineWidth=1; ctx.beginPath()
  ctx.moveTo(0,h/2); ctx.lineTo(w,h/2); ctx.stroke()
  ctx.strokeStyle='#00d4ff'; ctx.lineWidth=1.5; ctx.beginPath()
  for(let i=0;i<samples.length;i++){
    const x=i/samples.length*w, y=h/2-samples[i]*h/2*.9
    i===0?ctx.moveTo(x,y):ctx.lineTo(x,y)
  }
  ctx.stroke()
}

function drawEnv(n) {
  const canvas = n===1 ? envCanvas1.value : envCanvas2.value
  const p = n===1 ? S.env1 : S.env2
  if (!canvas) return
  const ctx=canvas.getContext('2d'), w=canvas.width, h=canvas.height
  ctx.clearRect(0,0,w,h)
  ctx.fillStyle='#0a0a1a'; ctx.fillRect(0,0,w,h)
  const tot=p.a+p.d+0.3+p.r, pad=4
  const aw=p.a/tot*w, dw=p.d/tot*w, sw=0.3/tot*w, rw=p.r/tot*w
  const sy=pad+(1-p.s)*(h-2*pad)
  ctx.strokeStyle='#ff6b6b'; ctx.lineWidth=1.5; ctx.beginPath()
  ctx.moveTo(0,h-pad)
  ctx.lineTo(aw,pad)
  ctx.lineTo(aw+dw,sy)
  ctx.lineTo(aw+dw+sw,sy)
  ctx.lineTo(w,h-pad)
  ctx.stroke()
}

function drawLfo(n) {
  const canvas=n===1?lfoCanvas1.value:lfoCanvas2.value
  const shape=n===1?S.lfo1.shape:S.lfo2.shape
  if(!canvas)return
  const ctx=canvas.getContext('2d'), w=canvas.width, h=canvas.height
  ctx.clearRect(0,0,w,h)
  ctx.fillStyle='#0a0a1a'; ctx.fillRect(0,0,w,h)
  const PI2=Math.PI*2
  ctx.strokeStyle='#4ecdc4'; ctx.lineWidth=1.5; ctx.beginPath()
  for(let i=0;i<=100;i++){
    const p=i/100
    let v
    switch(shape){
      case 'triangle': v=p<.5?4*p-1:3-4*p; break
      case 'square':   v=p<.5?1:-1; break
      case 'sawtooth': v=1-2*p; break
      default:         v=Math.sin(PI2*p)
    }
    const x=p*w, y=h/2-v*h/2*.85
    i===0?ctx.moveTo(x,y):ctx.lineTo(x,y)
  }
  ctx.stroke()
}

// ── Worklet → UI message handler ──────────────────────────────────────────────
function onWorkletMsg({ data }) {
  if (data.type==='waveform') {
    const canvas = data.osc==='A' ? waveA.value : waveB.value
    drawWave(canvas, data.samples)
  }
}

let _msgTarget = null
function attachMsgHandler() {
  const node = getNode(); if (!node) return
  if (_msgTarget === node) return
  if (_msgTarget) _msgTarget.port.onmessage = null
  _msgTarget = node
  node.port.onmessage = onWorkletMsg
  // Request initial waveforms
  reqWave('A'); reqWave('B')
}

// ── Watch for channel changes → re-attach ────────────────────────────────────
watch(() => ch.value?.id, () => {
  nextTick(() => {
    attachMsgHandler()
    drawEnv(1); drawEnv(2); drawLfo(1); drawLfo(2)
  })
}, { immediate: true })

watch(() => [S.env1, S.env2], () => { drawEnv(1); drawEnv(2) }, { deep:true })
watch(() => [S.lfo1.shape, S.lfo2.shape], () => { drawLfo(1); drawLfo(2) })

onMounted(() => {
  nextTick(() => {
    attachMsgHandler()
    drawEnv(1); drawEnv(2); drawLfo(1); drawLfo(2)
  })
})

onBeforeUnmount(() => {
  if (_msgTarget) { _msgTarget.port.onmessage = null; _msgTarget = null }
})
</script>

<style scoped>
.serum {
  display: flex; flex-direction: column; height: 100%;
  background: #080818; color: #c0c0e0; font-family: 'Share Tech Mono', monospace;
  overflow: hidden;
}

/* Header */
.sr-header {
  display: flex; align-items: center; gap: 12px;
  padding: 6px 12px; background: #10102a; border-bottom: 1px solid #1e1e3e;
  flex-shrink: 0;
}
.sr-title { font-family: 'Rajdhani',sans-serif; font-size:13px; font-weight:700; color:#00d4ff; letter-spacing:.1em; flex:1 }
.sr-tabs  { display:flex; gap:2px }
.sr-tab   { background:#1a1a30; border:1px solid #2a2a50; color:#707090; font-size:10px; padding:3px 10px; cursor:pointer; border-radius:3px; font-family:inherit }
.sr-tab.active { background:#00d4ff22; border-color:#00d4ff; color:#00d4ff }
.sr-macros-mini { display:flex; align-items:center; gap:6px }
.sr-m-label { font-size:8px; color:#40405a; letter-spacing:.1em }
.sr-macro-mini { width:60px; accent-color:#9b59b6 }

/* Layout */
.sr-osc-tab { display:flex; gap:8px; padding:8px; overflow-y:auto; flex:1 }
.sr-env-tab { display:flex; gap:8px; padding:8px; overflow-y:auto; flex:1; flex-wrap:wrap }
.sr-fx-tab  { display:flex; gap:8px; padding:8px; overflow-y:auto; flex:1; flex-wrap:wrap }
.sr-mod-tab { display:flex; flex-direction:column; gap:8px; padding:8px; overflow-y:auto; flex:1 }

/* Osc panel */
.sr-osc-panel {
  flex:1; min-width:200px; background:#0f0f28; border:1px solid #1e1e40;
  border-radius:6px; padding:8px; display:flex; flex-direction:column; gap:6px;
}
.sr-osc-head { display:flex; align-items:center; justify-content:space-between }
.sr-osc-label { font-family:'Rajdhani',sans-serif; font-size:13px; font-weight:700; letter-spacing:.1em }
.sr-right-col { display:flex; flex-direction:column; gap:8px; min-width:200px }

/* Section */
.sr-section { background:#0f0f28; border:1px solid #1e1e40; border-radius:6px; padding:8px; display:flex; flex-direction:column; gap:5px }
.sr-sec-title { font-size:9px; font-weight:700; letter-spacing:.15em; color:#40405a; text-transform:uppercase; margin-bottom:2px }
.sr-fx-section { min-width:200px }

/* Canvas */
.sr-wave, .sr-env-canvas, .sr-lfo-canvas { border:1px solid #1a1a3a; border-radius:3px; display:block; width:100%; height:auto }
.sr-env-canvas, .sr-lfo-canvas { height:50px }

/* Controls */
.sr-row { display:flex; align-items:center; gap:5px; min-height:22px }
.sr-lbl { font-size:8px; letter-spacing:.1em; color:#50507a; width:40px; flex-shrink:0; text-transform:uppercase }
.sr-val { font-size:8px; color:#8080a0; width:44px; text-align:right; flex-shrink:0 }
.sr-sel { background:#0a0a20; border:1px solid #2a2a50; color:#c0c0e0; font-size:9px; padding:2px 4px; border-radius:3px; font-family:inherit; flex:1 }
.sr-sel-sm { max-width:90px }
.sr-sel-xs { max-width:70px }
.sr-range { flex:1; accent-color:#00d4ff; cursor:pointer }
.sr-range-sm { max-width:70px }
.sr-range-v { writing-mode:vertical-lr; direction:rtl; width:22px; height:60px; accent-color:#00d4ff }
.sr-toggle { display:flex; align-items:center; gap:4px; font-size:9px; color:#8080a0; cursor:pointer }
.sr-toggle input { accent-color:#00d4ff; cursor:pointer }

/* ADSR knob row */
.sr-adsr-row { display:flex; gap:8px; justify-content:space-around }
.sr-adsr-knob { display:flex; flex-direction:column; align-items:center; gap:3px }

/* Mod tab */
.sr-mod-add { display:flex; align-items:center; gap:6px; background:#0f0f28; border:1px solid #1e1e40; border-radius:5px; padding:7px }
.sr-arrow { color:#00d4ff; font-size:12px }
.sr-mod-list { display:flex; flex-direction:column; gap:4px }
.sr-mod-row { display:flex; align-items:center; gap:6px; background:#0f0f28; border:1px solid #1a1a38; border-radius:4px; padding:5px 7px }
.sr-mod-src  { font-size:9px; color:#00d4ff; width:42px; flex-shrink:0 }
.sr-mod-dest { font-size:9px; color:#ff9f43; flex:1 }
.sr-mod-empty { font-size:9px; color:#30305a; padding:8px; text-align:center }
.sr-btn { background:#1a1a35; border:1px solid #2a2a55; color:#a0a0cc; font-size:9px; padding:3px 8px; border-radius:3px; cursor:pointer; font-family:inherit }
.sr-btn:hover { border-color:#00d4ff; color:#00d4ff }
.sr-btn-del { color:#e74c3c; border-color:#3a1a1a }
.sr-btn-del:hover { border-color:#e74c3c }

/* Macros */
.sr-macros { display:flex; flex-direction:column; gap:5px }
.sr-macro-block { display:flex; align-items:center; gap:6px }
</style>
