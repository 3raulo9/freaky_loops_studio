<template>
  <!-- System Monitor: a multi-mode visualizer (oscilloscope / spectrum / CPU)
       plus numeric telemetry — memory, active voices, buffer dropouts. -->
  <div class="tb-sysmon" v-hint="'sysmon'">
    <canvas
      ref="scopeCanvas"
      class="tb-spark"
      :width="SCOPE_W"
      :height="SCOPE_H"
      :title="modeTitle + ' — right-click for options'"
      @contextmenu.prevent.stop="openMenu"
    />

    <div class="tb-sysmon-stats">
      <div class="sm-row">
        <span class="sm-lbl">CPU</span>
        <span class="sm-val" :style="{ color: cpuColor }">{{ audioLoad }}%</span>
      </div>
      <div class="sm-row">
        <span class="sm-lbl">MEM</span>
        <span class="sm-val sm-mem">{{ memDisplay }}</span>
      </div>
      <div class="sm-row">
        <span class="sm-lbl">VOX</span>
        <span class="sm-val sm-vox">{{ voices }}</span>
        <span
          class="sm-under"
          :class="{ flash: underFlash }"
          :title="underruns + ' buffer underrun(s)'"
        >⚠{{ underruns }}</span>
      </div>
    </div>

    <!-- Right-click visualizer menu -->
    <div
      v-if="menu.open"
      class="scope-menu"
      :style="{ left: menu.x + 'px', top: menu.y + 'px' }"
      @click.stop
    >
      <div class="scope-menu-title">MODE</div>
      <div
        v-for="m in MODES"
        :key="m.id"
        class="scope-menu-item"
        :class="{ on: mode === m.id }"
        @click="setMode(m.id)"
      >
        <span class="scope-menu-dot">{{ mode === m.id ? '●' : '○' }}</span>{{ m.label }}
      </div>

      <template v-if="mode === 'osc'">
        <div class="scope-menu-sep" />
        <div class="scope-menu-title">OSCILLOSCOPE</div>
        <div class="scope-menu-item" @click="toggle('stereo')">
          <span class="scope-menu-dot">{{ stereo ? '☑' : '☐' }}</span>Stereo
        </div>
        <div class="scope-menu-item" @click="toggle('long')">
          <span class="scope-menu-dot">{{ long ? '☑' : '☐' }}</span>Long
        </div>
        <div class="scope-menu-item" @click="toggle('fill')">
          <span class="scope-menu-dot">{{ fill ? '☑' : '☐' }}</span>Fill
        </div>
      </template>

      <template v-else-if="mode === 'spectrum'">
        <div class="scope-menu-sep" />
        <div class="scope-menu-title">SPECTRUM</div>
        <div class="scope-menu-item" @click="toggle('log')">
          <span class="scope-menu-dot">{{ log ? '☑' : '☐' }}</span>Logarithmic
        </div>
        <div class="scope-menu-item" @click="toggle('peaks')">
          <span class="scope-menu-dot">{{ peaks ? '☑' : '☐' }}</span>Peak hold
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useStudio } from '../../store/studio.js'

const { audioLoad, audioUnderruns, getVoiceCount, getScopeAnalysers } = useStudio()

const SCOPE_W = 96
const SCOPE_H = 34

const MODES = [
  { id: 'osc',      label: 'Oscilloscope' },
  { id: 'spectrum', label: 'Spectrum' },
  { id: 'cpu',      label: 'CPU Load' },
]
const modeTitle = computed(() => MODES.find(m => m.id === opts.mode)?.label ?? '')

// ── Persisted visualizer options ──────────────────────────────────────────────
const LS_KEY = 'fl.scope.v1'
const opts = reactive(Object.assign(
  { mode: 'osc', stereo: false, long: false, fill: true, log: true, peaks: false },
  loadOpts(),
))
function loadOpts() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || {} } catch { return {} }
}
function persist() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(opts)) } catch {}
}
// Convenience refs read by the template
const mode   = computed(() => opts.mode)
const stereo = computed(() => opts.stereo)
const long   = computed(() => opts.long)
const fill   = computed(() => opts.fill)
const log    = computed(() => opts.log)
const peaks  = computed(() => opts.peaks)

function setMode(id) { opts.mode = id; persist() }
function toggle(key) { opts[key] = !opts[key]; persist() }

// ── Right-click menu ──────────────────────────────────────────────────────────
const menu = ref({ open: false, x: 0, y: 0 })
function openMenu(e) { menu.value = { open: true, x: e.clientX, y: e.clientY } }
function onGlobalDown(e) {
  if (menu.value.open && !e.target.closest('.scope-menu')) menu.value.open = false
}

// ── Drawing ───────────────────────────────────────────────────────────────────
const scopeCanvas = ref(null)
let bufL = null, bufR = null, freqBuf = null, peakHold = null
const history = new Array(SCOPE_W).fill(0)

const cpuColor = computed(() => {
  const l = audioLoad.value
  return l > 75 ? '#e74c3c' : l > 45 ? '#f39c12' : '#2ecc71'
})
function waveColor(peak) {
  return peak > 0.8 ? '#e74c3c' : peak > 0.5 ? '#f39c12' : '#2ecc71'
}

function draw() {
  const c = scopeCanvas.value
  if (!c) { raf = requestAnimationFrame(draw); return }
  const ctx = c.getContext('2d')
  const style = getComputedStyle(document.documentElement)
  ctx.fillStyle = style.getPropertyValue('--bg-deeper').trim() || '#07070f'
  ctx.fillRect(0, 0, SCOPE_W, SCOPE_H)
  const subtle = style.getPropertyValue('--border-subtle').trim() || '#1a1a28'

  if (opts.mode === 'cpu') { drawCpu(ctx, subtle); raf = requestAnimationFrame(draw); return }

  const an = getScopeAnalysers()
  if (!an.L) {                               // no audio engine yet → flat baseline
    ctx.beginPath(); ctx.moveTo(0, SCOPE_H / 2); ctx.lineTo(SCOPE_W, SCOPE_H / 2)
    ctx.strokeStyle = subtle; ctx.lineWidth = 1; ctx.stroke()
    raf = requestAnimationFrame(draw); return
  }
  if (opts.mode === 'spectrum') drawSpectrum(ctx, an)
  else                          drawOsc(ctx, an)
  raf = requestAnimationFrame(draw)
}

function drawOsc(ctx, an) {
  const L = an.L, R = an.R
  if (!bufL || bufL.length !== L.fftSize) { bufL = new Float32Array(L.fftSize); bufR = new Float32Array(R.fftSize) }
  L.getFloatTimeDomainData(bufL)
  if (opts.stereo) R.getFloatTimeDomainData(bufR)

  const want = opts.long ? L.fftSize : Math.min(640, L.fftSize)   // Long = wider time window

  const trace = (buf, yTop, yH, color) => {
    const start = buf.length - want
    let peak = 0
    for (let i = 0; i < want; i++) peak = Math.max(peak, Math.abs(buf[start + i]))
    const col = color || waveColor(peak)
    if (opts.fill) {
      ctx.beginPath(); ctx.moveTo(0, yTop + yH)
      for (let i = 0; i < want; i++) {
        const x = (i / want) * SCOPE_W
        ctx.lineTo(x, yTop + (1 - (buf[start + i] + 1) / 2) * yH)
      }
      ctx.lineTo(SCOPE_W, yTop + yH); ctx.closePath()
      ctx.fillStyle = col + '22'; ctx.fill()
    }
    ctx.beginPath()
    for (let i = 0; i < want; i++) {
      const x = (i / want) * SCOPE_W
      const y = yTop + (1 - (buf[start + i] + 1) / 2) * yH
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)
    }
    ctx.strokeStyle = col; ctx.lineWidth = 1.2; ctx.stroke()
  }

  if (opts.stereo) {
    // Faint divider between the L (top) and R (bottom) lanes.
    ctx.strokeStyle = 'rgba(120,120,160,0.18)'; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(0, SCOPE_H / 2); ctx.lineTo(SCOPE_W, SCOPE_H / 2); ctx.stroke()
    trace(bufL, 0, SCOPE_H / 2)
    trace(bufR, SCOPE_H / 2, SCOPE_H / 2)
  } else {
    trace(bufL, 0, SCOPE_H)
  }
}

function drawSpectrum(ctx, an) {
  const L = an.L
  const bins = L.frequencyBinCount
  if (!freqBuf || freqBuf.length !== bins) { freqBuf = new Uint8Array(bins); peakHold = new Float32Array(SCOPE_W) }
  L.getByteFrequencyData(freqBuf)
  for (let x = 0; x < SCOPE_W; x++) {
    const t = x / SCOPE_W
    const idx = opts.log ? Math.floor(Math.pow(bins, t)) - 1 : Math.floor(t * bins)
    const v = freqBuf[Math.max(0, Math.min(bins - 1, idx))] / 255
    const h = v * (SCOPE_H - 1)
    ctx.fillStyle = v > 0.75 ? '#e74c3c' : v > 0.45 ? '#f39c12' : '#2ecc71'
    ctx.fillRect(x, SCOPE_H - h, 1, h)
    if (opts.peaks) {
      peakHold[x] = Math.max(v, (peakHold[x] || 0) - 0.012)
      const py = SCOPE_H - peakHold[x] * (SCOPE_H - 1)
      ctx.fillStyle = '#c8c8e0'; ctx.fillRect(x, py, 1, 1)
    }
  }
}

function drawCpu(ctx, subtle) {
  ctx.strokeStyle = subtle; ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(0, SCOPE_H - 0.5); ctx.lineTo(SCOPE_W, SCOPE_H - 0.5); ctx.stroke()
  const col = cpuColor.value
  ctx.beginPath(); ctx.moveTo(0, SCOPE_H)
  for (let x = 0; x < SCOPE_W; x++) ctx.lineTo(x, SCOPE_H - (history[x] / 100) * (SCOPE_H - 2))
  ctx.lineTo(SCOPE_W - 1, SCOPE_H); ctx.closePath()
  ctx.fillStyle = col + '22'; ctx.fill()
  ctx.beginPath()
  for (let x = 0; x < SCOPE_W; x++) {
    const y = SCOPE_H - (history[x] / 100) * (SCOPE_H - 2)
    x ? ctx.lineTo(x, y) : ctx.moveTo(x, y)
  }
  ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.stroke()
}

// ── Memory readout (working-set, MB→GB auto-switch) ───────────────────────────
const memBytes = ref(0)
const memDisplay = computed(() => {
  if (!memBytes.value) return '—'
  const mb = memBytes.value / (1024 * 1024)
  return mb >= 1024 ? (mb / 1024).toFixed(2) + 'GB' : Math.round(mb) + 'MB'
})

// ── Voice counter (throttled text) + underrun shock/decay ─────────────────────
const voices = ref(0)
const underruns = ref(0)
const underFlash = ref(false)
let underTimer = null
watch(audioUnderruns, (n) => {
  underruns.value = n
  underFlash.value = true
  clearTimeout(underTimer)
  underTimer = setTimeout(() => { underFlash.value = false }, 500)
})

// ── Telemetry polling loop ────────────────────────────────────────────────────
let raf = null
let lastTextMs = 0
function poll(ts) {
  history.push(audioLoad.value); history.shift()
  if (ts - lastTextMs >= 50) {        // ≤ 20 read-out redraws / second
    lastTextMs = ts
    voices.value = getVoiceCount()
    if (performance.memory) memBytes.value = performance.memory.usedJSHeapSize
  }
  raf2 = requestAnimationFrame(poll)
}

let raf2 = null
onMounted(() => {
  window.addEventListener('pointerdown', onGlobalDown, true)
  raf = requestAnimationFrame(draw)
  raf2 = requestAnimationFrame(poll)
})
onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', onGlobalDown, true)
  cancelAnimationFrame(raf); cancelAnimationFrame(raf2); clearTimeout(underTimer)
})
</script>

<style scoped>
.tb-sysmon {
  display: flex; align-items: center; gap: 7px;
  flex-shrink: 0; padding: 0 2px; position: relative;
}
.tb-spark {
  display: block; cursor: context-menu;
  border: 1px solid var(--border-subtle); border-radius: 3px;
  background: var(--bg-deeper);
}
.tb-sysmon-stats {
  display: flex; flex-direction: column; gap: 1px;
  min-width: 78px;
}
.sm-row { display: flex; align-items: center; gap: 5px; line-height: 1.15; }
.sm-lbl {
  font-family: 'Rajdhani', sans-serif; font-size: 7px; font-weight: 700;
  letter-spacing: 0.14em; color: #2a2a40; width: 20px; flex-shrink: 0;
}
.sm-val {
  font-family: 'Share Tech Mono', monospace; font-size: 11px; color: #6a6a98;
  min-width: 36px;
}
.sm-mem { color: #5a7a9a; }
.sm-vox { color: #9b59b6; min-width: 22px; }
.sm-under {
  font-family: 'Share Tech Mono', monospace; font-size: 8px;
  color: #33334a; padding: 0 3px; border-radius: 3px;
  border: 1px solid var(--border-subtle); margin-left: auto;
  transition: background 0.5s ease, color 0.5s ease, border-color 0.5s ease;
}
.sm-under.flash {
  background: #e74c3c; color: #fff; border-color: #e74c3c;
  box-shadow: 0 0 8px #e74c3caa;
  transition: none;
}

/* ── Visualizer menu ───────────────────────────────────────────────────────── */
.scope-menu {
  position: fixed; z-index: 9999; min-width: 150px;
  background: var(--bg-control); border: 1px solid var(--border);
  border-radius: 6px; padding: 4px; box-shadow: 0 6px 24px #000000a0;
}
.scope-menu-title {
  padding: 4px 9px 4px;
  font-family: 'Rajdhani', sans-serif; font-size: 9px; font-weight: 700;
  letter-spacing: 0.16em; color: #5a5a80;
}
.scope-menu-item {
  display: flex; align-items: center; gap: 7px;
  padding: 5px 10px;
  font-family: 'Rajdhani', sans-serif; font-size: 12px; font-weight: 600;
  letter-spacing: 0.03em; color: #8080a0; cursor: pointer; border-radius: 4px;
}
.scope-menu-item:hover { background: var(--bg-hover); color: var(--text-primary); }
.scope-menu-item.on { color: #2ecc71; }
.scope-menu-dot { font-size: 11px; width: 12px; }
.scope-menu-sep { height: 1px; background: var(--border-subtle); margin: 3px 2px; }
</style>
