<template>
  <div class="st" v-if="ch">

    <!-- ── Header / tabs / meters ──────────────────────────────────────── -->
    <div class="st-header">
      <span class="st-brand">▼ SUBTERRA</span>
      <span class="st-name">— {{ ch.name }} · bass engine</span>
      <div class="st-tabs">
        <button v-for="t in TABS" :key="t.k" :class="['st-tab',{active:tab===t.k}]" @click="tab=t.k">{{ t.l }}</button>
      </div>
      <div class="st-hdr-meters">
        <!-- bass-mono safety light -->
        <span class="st-safety" :class="safetyClass" :title="safetyTitle">BASS MONO</span>
        <span class="st-meter-label">VOX</span>
        <span class="st-meter-val">{{ voiceCount }}</span>
      </div>
      <div class="st-mode">
        <button v-for="m in ['mono','poly']" :key="m" :class="['st-mode-btn',{active:S.voiceMode===m}]"
          @click="S.voiceMode=m;sp('voiceMode',m)">{{ m.toUpperCase() }}</button>
      </div>
    </div>

    <!-- ── OSC TAB ─────────────────────────────────────────────────────── -->
    <div v-if="tab==='osc'" class="st-pane">
      <div class="st-osc-rows">
        <!-- OSC 1 -->
        <div class="st-row" :style="{ '--c':'#ff5a3c' }">
          <div class="st-row-head">
            <span class="st-row-label">OSC 1</span>
            <label class="st-toggle"><input type="checkbox" v-model="S.osc1.on" @change="sp('osc1.on',$event.target.checked)"> ON</label>
            <select class="st-sel" v-model="S.osc1.wave" @change="sp('osc1.wave',S.osc1.wave)">
              <option v-for="w in WAVES" :key="w" :value="w">{{ w }}</option>
            </select>
          </div>
          <div class="st-knobs">
            <Knob v-model="S.osc1.level"  :min="0" :max="1"   :decimals="2" label="LEVEL"  color="#ff5a3c" :size="44" @update:modelValue="sp('osc1.level',$event)" />
            <Knob v-model="S.osc1.unison" :min="1" :max="7"   :decimals="0" label="UNISON" color="#ff5a3c" :size="44" @update:modelValue="sp('osc1.unison',Math.round($event))" />
            <Knob v-model="S.osc1.detune" :min="0" :max="1"   :decimals="2" label="DETUNE" color="#ff5a3c" :size="44" @update:modelValue="sp('osc1.detune',$event)" />
            <Knob v-model="S.osc1.oct"    :min="-3" :max="2"  :decimals="0" label="OCT"    color="#ff5a3c" :size="44" @update:modelValue="sp('osc1.oct',Math.round($event))" />
            <Knob v-model="S.osc1.semi"   :min="-12" :max="12" :decimals="0" label="SEMI"  color="#ff5a3c" :size="44" @update:modelValue="sp('osc1.semi',Math.round($event))" />
            <Knob v-model="S.osc1.fine"   :min="-50" :max="50" :decimals="0" label="FINE"  color="#ff5a3c" :size="44" @update:modelValue="sp('osc1.fine',Math.round($event))" />
          </div>
        </div>

        <!-- OSC 2 -->
        <div class="st-row" :style="{ '--c':'#ffa23c' }">
          <div class="st-row-head">
            <span class="st-row-label">OSC 2</span>
            <label class="st-toggle"><input type="checkbox" v-model="S.osc2.on" @change="sp('osc2.on',$event.target.checked)"> ON</label>
            <select class="st-sel" v-model="S.osc2.wave" @change="sp('osc2.wave',S.osc2.wave)">
              <option v-for="w in WAVES" :key="w" :value="w">{{ w }}</option>
            </select>
            <span class="st-hint">FM → OSC1</span>
          </div>
          <div class="st-knobs">
            <Knob v-model="S.osc2.level"  :min="0" :max="1"   :decimals="2" label="LEVEL"  color="#ffa23c" :size="44" @update:modelValue="sp('osc2.level',$event)" />
            <Knob v-model="S.fm.amount"   :min="0" :max="1"   :decimals="2" label="FM"     color="#ffa23c" :size="44" @update:modelValue="sp('fm.amount',$event)" />
            <Knob v-model="S.osc2.unison" :min="1" :max="7"   :decimals="0" label="UNISON" color="#ffa23c" :size="44" @update:modelValue="sp('osc2.unison',Math.round($event))" />
            <Knob v-model="S.osc2.detune" :min="0" :max="1"   :decimals="2" label="DETUNE" color="#ffa23c" :size="44" @update:modelValue="sp('osc2.detune',$event)" />
            <Knob v-model="S.osc2.oct"    :min="-3" :max="2"  :decimals="0" label="OCT"    color="#ffa23c" :size="44" @update:modelValue="sp('osc2.oct',Math.round($event))" />
            <Knob v-model="S.osc2.semi"   :min="-12" :max="12" :decimals="0" label="SEMI"  color="#ffa23c" :size="44" @update:modelValue="sp('osc2.semi',Math.round($event))" />
          </div>
        </div>
      </div>

      <div class="st-block-row">
        <!-- SUB (always mono) -->
        <div class="st-block" :style="{ '--c':'#4ecdc4' }">
          <div class="st-block-head">
            <span>SUB · mono</span>
            <label class="st-toggle"><input type="checkbox" v-model="S.sub.on" @change="sp('sub.on',$event.target.checked)"> ON</label>
            <select class="st-sel st-sel-sm" v-model="S.sub.wave" @change="sp('sub.wave',S.sub.wave)">
              <option value="sine">sine</option><option value="triangle">tri</option>
            </select>
          </div>
          <div class="st-knobs">
            <Knob v-model="S.sub.level" :min="0" :max="1"  :decimals="2" label="LEVEL" color="#4ecdc4" :size="44" @update:modelValue="sp('sub.level',$event)" />
            <Knob v-model="S.sub.oct"   :min="-2" :max="0" :decimals="0" label="OCT"   color="#4ecdc4" :size="44" @update:modelValue="sp('sub.oct',Math.round($event))" />
          </div>
        </div>

        <!-- NOISE attack click -->
        <div class="st-block" :style="{ '--c':'#9b59b6' }">
          <div class="st-block-head">
            <span>CLICK</span>
            <label class="st-toggle"><input type="checkbox" v-model="S.noise.on" @change="sp('noise.on',$event.target.checked)"> ON</label>
          </div>
          <div class="st-knobs">
            <Knob v-model="S.noise.level" :min="0" :max="1"    :decimals="2" label="AMT"   color="#9b59b6" :size="44" @update:modelValue="sp('noise.level',$event)" />
            <Knob v-model="S.noise.decay" :min="0.005" :max="0.2" :decimals="3" label="DECAY" color="#9b59b6" :size="44" @update:modelValue="sp('noise.decay',$event)" />
          </div>
        </div>

        <!-- 808 / GLIDE engine -->
        <div class="st-block st-block-wide" :style="{ '--c':'#e74c3c' }">
          <div class="st-block-head">
            <span>808 / GLIDE</span>
            <label class="st-toggle"><input type="checkbox" v-model="S.glide.on" @change="sp('glide.on',$event.target.checked)"> GLIDE</label>
          </div>
          <div class="st-knobs">
            <Knob v-model="S.glide.time"     :min="0" :max="0.5"  :decimals="3" label="GLIDE"   color="#e74c3c" :size="44" @update:modelValue="sp('glide.time',$event)" />
            <Knob v-model="S.pitchEnv.amount" :min="0" :max="48"  :decimals="0" label="DROP st" color="#e74c3c" :size="44" @update:modelValue="sp('pitchEnv.amount',Math.round($event))" />
            <Knob v-model="S.pitchEnv.time"   :min="0.01" :max="1" :decimals="2" label="DROP T"  color="#e74c3c" :size="44" @update:modelValue="sp('pitchEnv.time',$event)" />
          </div>
        </div>
      </div>

      <p class="st-philosophy">▼ Sub stays clean &amp; mono — push the personality into OSC1/2 + DRIVE above the sub.</p>
    </div>

    <!-- ── FILTER TAB ──────────────────────────────────────────────────── -->
    <div v-if="tab==='filter'" class="st-pane">
      <div class="st-block-row">
        <div class="st-block st-block-wide" :style="{ '--c':'#3498db' }">
          <div class="st-block-head">
            <span>MAIN FILTER</span>
            <label class="st-toggle"><input type="checkbox" v-model="S.filter.on" @change="sp('filter.on',$event.target.checked)"> ON</label>
            <select class="st-sel" v-model="S.filter.type" @change="sp('filter.type',S.filter.type)">
              <option value="lowpass">Low Pass</option>
              <option value="bandpass">Band Pass</option>
              <option value="highpass">High Pass</option>
            </select>
          </div>
          <div class="st-knobs">
            <Knob v-model="S.filter.cutoff"   :min="0" :max="1" :decimals="2" label="CUTOFF" color="#3498db" :size="46" @update:modelValue="sp('filter.cutoff',$event)" />
            <Knob v-model="S.filter.reso"     :min="0" :max="0.97" :decimals="2" label="RES" color="#3498db" :size="46" @update:modelValue="sp('filter.reso',$event)" />
            <Knob v-model="S.filter.keytrack" :min="0" :max="1" :decimals="2" label="KEY TRK" color="#3498db" :size="46" @update:modelValue="sp('filter.keytrack',$event)" />
            <Knob v-model="S.fenv.amount"     :min="-1" :max="1" :decimals="2" label="ENV→CUT" color="#3498db" :size="46" @update:modelValue="sp('fenv.amount',$event)" />
          </div>
        </div>
      </div>

      <div class="st-block-row">
        <div class="st-block st-block-wide" :style="{ '--c':'#ff6b6b' }">
          <div class="st-block-head"><span>AMP ENVELOPE</span></div>
          <canvas ref="ampEnvC" class="st-env-canvas" width="280" height="64" />
          <div class="st-knobs">
            <Knob v-model="S.amp.a" :min="0.001" :max="2" :decimals="3" label="A" color="#ff6b6b" :size="44" @update:modelValue="sp('amp.a',$event);drawEnv()" />
            <Knob v-model="S.amp.d" :min="0.001" :max="3" :decimals="2" label="D" color="#ff6b6b" :size="44" @update:modelValue="sp('amp.d',$event);drawEnv()" />
            <Knob v-model="S.amp.s" :min="0" :max="1"     :decimals="2" label="S" color="#ff6b6b" :size="44" @update:modelValue="sp('amp.s',$event);drawEnv()" />
            <Knob v-model="S.amp.r" :min="0.001" :max="3" :decimals="2" label="R" color="#ff6b6b" :size="44" @update:modelValue="sp('amp.r',$event);drawEnv()" />
          </div>
        </div>
        <div class="st-block st-block-wide" :style="{ '--c':'#f39c12' }">
          <div class="st-block-head"><span>FILTER ENVELOPE</span></div>
          <div class="st-knobs">
            <Knob v-model="S.fenv.a" :min="0.001" :max="2" :decimals="3" label="A" color="#f39c12" :size="44" @update:modelValue="sp('fenv.a',$event)" />
            <Knob v-model="S.fenv.d" :min="0.001" :max="3" :decimals="2" label="D" color="#f39c12" :size="44" @update:modelValue="sp('fenv.d',$event)" />
            <Knob v-model="S.fenv.s" :min="0" :max="1"     :decimals="2" label="S" color="#f39c12" :size="44" @update:modelValue="sp('fenv.s',$event)" />
            <Knob v-model="S.fenv.r" :min="0.001" :max="3" :decimals="2" label="R" color="#f39c12" :size="44" @update:modelValue="sp('fenv.r',$event)" />
          </div>
        </div>
      </div>
    </div>

    <!-- ── DRIVE / MULTIBAND TAB ───────────────────────────────────────── -->
    <div v-if="tab==='band'" class="st-pane">
      <div class="st-block-row">
        <div class="st-block st-block-wide" :style="{ '--c':'#e67e22' }">
          <div class="st-block-head">
            <span>HARMONIC-SPLIT DRIVE</span>
            <label class="st-toggle"><input type="checkbox" v-model="S.drive.on" @change="sp('drive.on',$event.target.checked)"> ON</label>
            <select class="st-sel" v-model="S.drive.type" @change="sp('drive.type',S.drive.type)">
              <option v-for="d in DRIVE_TYPES" :key="d" :value="d">{{ d }}</option>
            </select>
          </div>
          <div class="st-knobs">
            <Knob v-model="S.drive.amount"    :min="0" :max="1" :decimals="2" label="DRIVE"  color="#e67e22" :size="46" @update:modelValue="sp('drive.amount',$event)" />
            <Knob v-model="S.drive.crossover" :min="0" :max="1" :decimals="2" label="X-OVER" color="#e67e22" :size="46" @update:modelValue="sp('drive.crossover',$event)" />
          </div>
          <span class="st-hint">Drives only ABOVE the crossover — the sub stays pristine &amp; mono-safe.</span>
        </div>
      </div>

      <div class="st-block-row">
        <div class="st-block st-block-wide" :style="{ '--c':'#1abc9c' }">
          <div class="st-block-head"><span>3-BAND</span></div>
          <div class="st-knobs">
            <Knob v-model="S.band.lowGain"   :min="0" :max="2" :decimals="2" label="LOW"    color="#1abc9c" :size="44" @update:modelValue="sp('band.lowGain',$event)" />
            <Knob v-model="S.band.midGain"   :min="0" :max="2" :decimals="2" label="MID"    color="#1abc9c" :size="44" @update:modelValue="sp('band.midGain',$event)" />
            <Knob v-model="S.band.highGain"  :min="0" :max="2" :decimals="2" label="HIGH"   color="#1abc9c" :size="44" @update:modelValue="sp('band.highGain',$event)" />
            <Knob v-model="S.band.crossLow"  :min="0" :max="1" :decimals="2" label="LO/MID" color="#1abc9c" :size="44" @update:modelValue="sp('band.crossLow',$event)" />
            <Knob v-model="S.band.crossHigh" :min="0" :max="1" :decimals="2" label="MID/HI" color="#1abc9c" :size="44" @update:modelValue="sp('band.crossHigh',$event)" />
          </div>
        </div>
        <div class="st-block" :style="{ '--c':'#2ecc71' }">
          <div class="st-block-head"><span>STEREO</span></div>
          <div class="st-knobs">
            <Knob v-model="S.band.monoFreq" :min="0" :max="1" :decimals="2" label="MONO<" color="#2ecc71" :size="44" @update:modelValue="sp('band.monoFreq',$event)" />
            <Knob v-model="S.band.width"    :min="0" :max="1" :decimals="2" label="WIDTH" color="#2ecc71" :size="44" @update:modelValue="sp('band.width',$event)" />
          </div>
          <span class="st-hint">MONO&lt; collapses lows to mono. WIDTH only spreads above it.</span>
        </div>
      </div>
    </div>

    <!-- ── MOD TAB ─────────────────────────────────────────────────────── -->
    <div v-if="tab==='mod'" class="st-pane">
      <div class="st-block-row">
        <div v-for="(lfo,li) in S.lfos" :key="li" class="st-block st-block-wide" :style="{ '--c':'#4ecdc4' }">
          <div class="st-block-head">
            <span>LFO {{ li+1 }}</span>
            <select class="st-sel st-sel-sm" v-model="lfo.shape" @change="sp('lfos.'+li+'.shape',lfo.shape)">
              <option v-for="sh in LFO_SHAPES" :key="sh" :value="sh">{{ sh }}</option>
            </select>
            <select class="st-sel" v-model="lfo.dest" @change="sp('lfos.'+li+'.dest',lfo.dest)">
              <option v-for="d in MOD_DESTS" :key="d.v" :value="d.v">{{ d.l }}</option>
            </select>
          </div>
          <div class="st-knobs">
            <Knob v-model="lfo.rate" :min="0" :max="1"  :decimals="2" label="RATE" color="#4ecdc4" :size="44" @update:modelValue="sp('lfos.'+li+'.rate',$event)" />
            <Knob v-model="lfo.amt"  :min="-1" :max="1" :decimals="2" label="AMT"  color="#4ecdc4" :size="44" @update:modelValue="sp('lfos.'+li+'.amt',$event)" />
            <span class="st-val">{{ lfoRateLabel(lfo.rate) }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- ── METER TAB ───────────────────────────────────────────────────── -->
    <div v-if="tab==='meter'" class="st-pane">
      <div class="st-block-row">
        <div class="st-block st-block-wide" :style="{ '--c':'#00d4ff' }">
          <div class="st-block-head"><span>OSCILLOSCOPE</span></div>
          <canvas ref="scopeC" class="st-scope" width="420" height="120" />
        </div>
        <div class="st-block" :style="{ '--c':'#00d4ff' }">
          <div class="st-block-head"><span>CORRELATION</span></div>
          <canvas ref="corrC" class="st-corr" width="160" height="120" />
          <div class="st-readout">
            <span>Σ {{ corr.toFixed(2) }}</span>
            <span :class="safetyClass">LOW {{ loCorr.toFixed(2) }}</span>
          </div>
        </div>
      </div>
      <div class="st-block-row">
        <div class="st-block st-block-wide" :style="{ '--c':'#f1c40f' }">
          <div class="st-block-head"><span>SUB ENERGY</span></div>
          <div class="st-readout-big">
            <span class="st-big-note">{{ domNote }}</span>
            <span class="st-big-hz">{{ domF > 0 ? domF.toFixed(1) + ' Hz' : '—' }}</span>
            <span class="st-big-rms">RMS {{ (rms).toFixed(3) }}</span>
          </div>
          <p class="st-philosophy">The bass-mono light goes amber/red when low-frequency stereo content
            would cancel on a club PA / phone speaker. Keep LOW correlation near +1.</p>
        </div>
        <div class="st-block" :style="{ '--c':'#f39c12' }">
          <div class="st-block-head"><span>OUTPUT</span></div>
          <div class="st-knobs">
            <Knob v-model="S.output.gain" :min="0" :max="1.5" :decimals="2" label="GAIN" color="#f39c12" :size="46" @update:modelValue="sp('output.gain',$event)" />
          </div>
          <label class="st-toggle"><input type="checkbox" v-model="S.output.limit" @change="sp('output.limit',$event.target.checked)"> LIMITER</label>
        </div>
      </div>
    </div>

  </div>
</template>

<script setup>
import { ref, reactive, watch, onMounted, onBeforeUnmount, nextTick, computed } from 'vue'
import { useStudio } from '../store/studio.js'
import Knob from './Knob.vue'

const { selectedChannel, getSubterraNode } = useStudio()
const ch = selectedChannel

const TABS = [
  { k:'osc',    l:'OSC'    },
  { k:'filter', l:'FILTER' },
  { k:'band',   l:'DRIVE/BAND' },
  { k:'mod',    l:'MOD'    },
  { k:'meter',  l:'METER'  },
]
const WAVES = ['saw','square','triangle','sine']
const DRIVE_TYPES = ['tube','tape','fuzz','fold','crush']
const LFO_SHAPES = ['sine','triangle','square','sawtooth']
const MOD_DESTS = [
  { v:'none',   l:'—' },
  { v:'cutoff', l:'Filter Cutoff' },
  { v:'pitch',  l:'Pitch' },
  { v:'level',  l:'Amp Level' },
]

const tab = ref('osc')
const voiceCount = ref(0)
const corr = ref(1)
const loCorr = ref(1)
const domF = ref(0)
const rms = ref(0)
let scopeData = null

// ── Patch state (mirrors the worklet defaults) ───────────────────────────────
const S = reactive({
  osc1: { wave:'saw',    level:0.9, oct:0,  semi:0, fine:0, unison:1, detune:0.18, on:true },
  osc2: { wave:'square', level:0.0, oct:0,  semi:0, fine:0, unison:1, detune:0.18, on:false },
  fm:   { amount:0 },
  sub:  { wave:'sine',   level:0.6, oct:-1, on:true },
  noise:{ level:0.0, decay:0.03, on:false },
  glide:{ on:true, time:0.06 },
  pitchEnv:{ amount:0, time:0.08 },
  amp:  { a:0.003, d:0.25, s:0.85, r:0.12 },
  fenv: { a:0.003, d:0.18, s:0.20, r:0.12, amount:0 },
  filter:{ type:'lowpass', cutoff:0.65, reso:0.18, keytrack:0.25, on:true },
  drive:{ on:false, type:'tube', amount:0.4, crossover:0.18 },
  band: { lowGain:1, midGain:1, highGain:1, crossLow:0.12, crossHigh:0.5, monoFreq:0.16, width:0 },
  lfos: [
    { shape:'sine',     rate:0.35, amt:0, dest:'none' },
    { shape:'triangle', rate:0.5,  amt:0, dest:'none' },
  ],
  voiceMode:'mono',
  output:{ gain:0.85, limit:true },
})

// ── Canvas refs ──────────────────────────────────────────────────────────────
const ampEnvC = ref(null)
const scopeC  = ref(null)
const corrC   = ref(null)

// ── Derived UI ───────────────────────────────────────────────────────────────
const safetyClass = computed(() =>
  loCorr.value > 0.6 ? 'safe-ok' : loCorr.value > 0.1 ? 'safe-warn' : 'safe-bad')
const safetyTitle = computed(() =>
  loCorr.value > 0.6 ? 'Low end is mono-safe'
  : loCorr.value > 0.1 ? 'Some low-frequency stereo — check in mono'
  : 'Low end may cancel in mono!')
const domNote = computed(() => {
  if (domF.value <= 0) return '—'
  const m = Math.round(69 + 12 * Math.log2(domF.value / 440))
  const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
  return names[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1)
})
const lfoRateLabel = r => {
  const hz = Math.pow(10, r * 4 - 2)
  return hz < 1 ? (hz * 1000).toFixed(0) + 'ms' : hz.toFixed(2) + 'Hz'
}

// ── Worklet messaging ────────────────────────────────────────────────────────
function getNode() {
  return ch.value?.type === 'subterra' ? getSubterraNode(ch.value.id) : null
}
function sp(path, value) {
  const node = getNode(); if (!node) return
  node.port.postMessage({ type:'param', path, value })
}

// ── Canvas drawing ───────────────────────────────────────────────────────────
function themeColors() {
  const cs = getComputedStyle(document.documentElement)
  return {
    bg:   cs.getPropertyValue('--bg-deeper').trim()     || '#0a0a14',
    grid: cs.getPropertyValue('--border-subtle').trim() || '#1a1a28',
  }
}

function drawEnv() {
  const c = ampEnvC.value; if (!c) return
  const ctx = c.getContext('2d'), w = c.width, h = c.height, t = themeColors()
  const p = S.amp, pad = 6
  ctx.clearRect(0,0,w,h); ctx.fillStyle = t.bg; ctx.fillRect(0,0,w,h)
  const tot = p.a + p.d + 0.5 + p.r
  const aw = p.a/tot*(w-pad*2), dw = p.d/tot*(w-pad*2), sw = 0.5/tot*(w-pad*2)
  const sy = pad + (1-p.s)*(h-pad*2)
  ctx.strokeStyle = '#ff6b6b'; ctx.lineWidth = 2; ctx.shadowColor = '#ff6b6b'; ctx.shadowBlur = 4
  ctx.beginPath()
  ctx.moveTo(pad, h-pad)
  ctx.lineTo(pad+aw, pad)
  ctx.lineTo(pad+aw+dw, sy)
  ctx.lineTo(pad+aw+dw+sw, sy)
  ctx.lineTo(w-pad, h-pad)
  ctx.stroke(); ctx.shadowBlur = 0
}

function drawScope() {
  const c = scopeC.value; if (!c || !scopeData) return
  const ctx = c.getContext('2d'), w = c.width, h = c.height, t = themeColors()
  ctx.clearRect(0,0,w,h); ctx.fillStyle = t.bg; ctx.fillRect(0,0,w,h)
  ctx.strokeStyle = t.grid; ctx.beginPath(); ctx.moveTo(0,h/2); ctx.lineTo(w,h/2); ctx.stroke()
  ctx.strokeStyle = '#00d4ff'; ctx.lineWidth = 2; ctx.shadowColor = '#00d4ff'; ctx.shadowBlur = 5
  ctx.beginPath()
  for (let i = 0; i < scopeData.length; i++) {
    const x = i/scopeData.length*w
    const y = h/2 - Math.max(-1,Math.min(1,scopeData[i])) * h/2 * 0.9
    if (i === 0) ctx.moveTo(x,y); else ctx.lineTo(x,y)
  }
  ctx.stroke(); ctx.shadowBlur = 0
}

function drawCorr() {
  const c = corrC.value; if (!c) return
  const ctx = c.getContext('2d'), w = c.width, h = c.height, t = themeColors()
  ctx.clearRect(0,0,w,h); ctx.fillStyle = t.bg; ctx.fillRect(0,0,w,h)
  // scale -1..+1 across width, marker for full + low correlation
  ctx.strokeStyle = t.grid; ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(w/2,0); ctx.lineTo(w/2,h); ctx.stroke()
  const bar = (val, y, col) => {
    const cx = (val * 0.5 + 0.5) * w
    ctx.fillStyle = col; ctx.fillRect(Math.min(w/2,cx), y, Math.abs(cx-w/2), 14)
  }
  bar(corr.value, h*0.28, '#00d4ff')
  bar(loCorr.value, h*0.58,
    loCorr.value > 0.6 ? '#2ecc71' : loCorr.value > 0.1 ? '#f39c12' : '#e74c3c')
  ctx.fillStyle = '#888'; ctx.font = '9px monospace'
  ctx.fillText('-1', 2, h-4); ctx.fillText('+1', w-16, h-4)
}

// ── Worklet → UI ─────────────────────────────────────────────────────────────
function onMsg({ data }) {
  if (data.type !== 'meters') return
  voiceCount.value = data.voices
  corr.value = data.corr
  loCorr.value = data.loCorr
  domF.value = data.domF
  rms.value = data.rms
  scopeData = data.scope
  if (tab.value === 'meter') { drawScope(); drawCorr() }
}

let _attached = null
let _retry = null
function attach() {
  const node = getNode()
  if (!node) {
    if (ch.value?.type === 'subterra') { clearTimeout(_retry); _retry = setTimeout(attach, 120) }
    return
  }
  if (_attached === node) return
  if (_attached) _attached.port.onmessage = null
  _attached = node
  node.port.onmessage = onMsg
  node.port.postMessage({ type:'fullState', state: JSON.parse(JSON.stringify(S)) })
}

watch(() => ch.value?.id, () => nextTick(() => { attach(); if (tab.value === 'filter') drawEnv() }), { immediate:true })
watch(tab, () => nextTick(() => { if (tab.value === 'filter') drawEnv() }))

onMounted(() => nextTick(() => { attach(); drawEnv() }))
onBeforeUnmount(() => {
  clearTimeout(_retry)
  if (_attached) { _attached.port.onmessage = null; _attached = null }
})
</script>

<style scoped>
.st {
  display:flex; flex-direction:column; height:100%;
  background:var(--bg-base); color:var(--text-primary);
  font-family:'Share Tech Mono', monospace; overflow:hidden;
}

/* Header */
.st-header {
  display:flex; align-items:center; gap:12px;
  padding:8px 14px; background:var(--bg-header); border-bottom:1px solid var(--border-subtle);
  flex-shrink:0;
}
.st-brand {
  font-family:'Rajdhani',sans-serif; font-size:14px; font-weight:700;
  color:#ff5a3c; letter-spacing:.12em;
}
.st-name { color:var(--text-muted); font-size:11px; flex:1 }
.st-tabs { display:flex; gap:2px }
.st-tab {
  background:var(--bg-panel); border:1px solid var(--border); color:var(--text-muted);
  font-size:11px; padding:5px 12px; cursor:pointer; border-radius:3px;
  font-family:'Rajdhani',sans-serif; font-weight:700; letter-spacing:.08em; transition:all .12s;
}
.st-tab:hover { color:var(--text-primary); background:var(--bg-hover) }
.st-tab.active { background:var(--bg-control); border-color:#ff5a3c; color:#ff5a3c }
.st-hdr-meters { display:flex; align-items:center; gap:8px }
.st-meter-label { font-size:9px; color:var(--text-muted); letter-spacing:.12em }
.st-meter-val { font-size:11px; color:#ff5a3c; font-weight:700 }
.st-safety {
  font-size:9px; font-weight:700; letter-spacing:.1em; padding:3px 7px; border-radius:3px;
  border:1px solid currentColor;
}
.safe-ok   { color:#2ecc71 }
.safe-warn { color:#f39c12 }
.safe-bad  { color:#e74c3c; animation:st-blink 0.8s steps(2,start) infinite }
@keyframes st-blink { 50% { opacity:.35 } }
.st-mode { display:flex; gap:2px }
.st-mode-btn {
  background:var(--bg-panel); border:1px solid var(--border); color:var(--text-muted);
  font-size:9px; padding:4px 8px; cursor:pointer; border-radius:3px; font-weight:700; letter-spacing:.1em;
}
.st-mode-btn.active { border-color:#ff5a3c; color:#ff5a3c; background:var(--bg-control) }

/* Panes */
.st-pane { display:flex; flex-direction:column; gap:10px; padding:10px; overflow-y:auto; flex:1 }
.st-osc-rows { display:flex; flex-direction:column; gap:8px }
.st-row {
  background:var(--bg-panel); border:1px solid var(--c, var(--border));
  border-radius:6px; padding:8px 10px; display:flex; flex-direction:column; gap:6px;
}
.st-row-head { display:flex; align-items:center; gap:10px; flex-wrap:wrap }
.st-row-label {
  font-family:'Rajdhani',sans-serif; font-size:14px; font-weight:700;
  letter-spacing:.15em; color:var(--c); min-width:50px;
}
.st-knobs { display:flex; flex-wrap:wrap; gap:10px; align-items:flex-end; padding:2px 0 }

.st-block-row { display:flex; gap:10px; flex-wrap:wrap }
.st-block {
  background:var(--bg-panel); border:1px solid var(--c, var(--border));
  border-radius:6px; padding:8px 10px; display:flex; flex-direction:column; gap:6px;
  flex:1; min-width:150px;
}
.st-block-wide { min-width:260px }
.st-block-head {
  display:flex; align-items:center; gap:8px; flex-wrap:wrap;
  font-family:'Rajdhani',sans-serif; font-size:11px; font-weight:700;
  letter-spacing:.13em; color:var(--c);
}

/* Controls */
.st-toggle { display:flex; align-items:center; gap:4px; font-size:9px; color:var(--text-muted); cursor:pointer; user-select:none }
.st-toggle input { accent-color:#ff5a3c; cursor:pointer }
.st-sel {
  background:var(--bg-control); border:1px solid var(--border); color:var(--text-primary);
  font-size:10px; padding:3px 6px; border-radius:3px; font-family:inherit; cursor:pointer; outline:none;
}
.st-sel-sm { font-size:9px; padding:2px 4px }
.st-sel:focus { border-color:#ff5a3c }
.st-hint { font-size:9px; color:var(--text-muted); letter-spacing:.04em }
.st-val { font-size:9px; color:var(--text-muted); align-self:center }
.st-philosophy { font-size:9px; color:var(--text-muted); line-height:1.5; margin:2px 0 0; letter-spacing:.02em }

/* Canvases */
.st-env-canvas, .st-scope, .st-corr {
  width:100%; background:var(--bg-deeper); border:1px solid var(--border-subtle); border-radius:3px; display:block;
}
.st-env-canvas { height:64px }
.st-scope { height:120px }
.st-corr { height:120px }
.st-readout { display:flex; justify-content:space-between; font-size:10px; color:var(--text-muted); padding-top:2px }
.st-readout-big { display:flex; align-items:baseline; gap:16px; padding:6px 0 }
.st-big-note { font-size:30px; font-weight:700; color:#f1c40f; font-family:'Rajdhani',sans-serif }
.st-big-hz   { font-size:14px; color:var(--text-primary) }
.st-big-rms  { font-size:10px; color:var(--text-muted) }
</style>
