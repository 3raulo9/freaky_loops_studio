<template>
  <div class="eqg" ref="wrap">
    <canvas ref="cv" class="eqg-cv"
      @mousedown="onDown" @dblclick="onDbl" @wheel.prevent="onWheel" @mousemove="onHover" @mouseleave="hover = null" />
    <div class="eqg-readout">
      <template v-if="active">
        {{ BAND_LABEL[active] }} · {{ fmtHz(eq[active + 'Freq'] ?? DEF_FREQ[active]) }} ·
        {{ (eq[active] ?? 0) > 0 ? '+' : '' }}{{ (eq[active] ?? 0).toFixed(1) }} dB
        <template v-if="active === 'mid'"> · Q {{ (eq.midQ ?? 1).toFixed(2) }}</template>
      </template>
      <template v-else>drag a band · wheel = Q · double-click = reset</template>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useStudio } from '../store/studio.js'

// Parametric EQ display for one mixer track: the summed response of its
// low-shelf / peak / high-shelf bands, draggable band handles, and the track's
// live spectrum behind it.
const props = defineProps({ trackIdx: { type: Number, required: true } })
const { mixerTracks, setMixerEqBand, getMixerAnalyser } = useStudio()

const BANDS = ['low', 'mid', 'high']
const BAND_LABEL = { low: 'LOW SHELF', mid: 'PEAK', high: 'HIGH SHELF' }
const DEF_FREQ = { low: 80, mid: 1000, high: 8000 }
const BAND_COLOR = { low: '#e8763c', mid: '#3ce896', high: '#4898e8' }
const F_MIN = 20, F_MAX = 20000, DB = 18

const wrap = ref(null)
const cv = ref(null)
const hover = ref(null)
const dragBand = ref(null)
const active = computed(() => dragBand.value ?? hover.value)
const eq = computed(() => mixerTracks[props.trackIdx]?.eq ?? {})

// A silent offline context just to borrow BiquadFilterNode.getFrequencyResponse,
// so the drawn curve matches the audio filters exactly.
const offCtx = new OfflineAudioContext(1, 1, 48000)
const filters = BANDS.map(() => offCtx.createBiquadFilter())
filters[0].type = 'lowshelf'; filters[1].type = 'peaking'; filters[2].type = 'highshelf'

const fmtHz = f => (f >= 1000 ? (f / 1000).toFixed(f >= 10000 ? 0 : 1) + 'k' : Math.round(f)) + ' Hz'

let W = 0, H = 0, dpr = 1
const xOf = f => Math.log(f / F_MIN) / Math.log(F_MAX / F_MIN) * W
const fOf = x => F_MIN * Math.pow(F_MAX / F_MIN, Math.max(0, Math.min(1, x / W)))
const yOf = db => H / 2 - (db / DB) * (H / 2 - 6)
const dbOf = y => -((y - H / 2) / (H / 2 - 6)) * DB

function handlePos(band) {
  const e = eq.value
  return { x: xOf(e[band + 'Freq'] ?? DEF_FREQ[band]), y: yOf(e[band] ?? 0) }
}

function bandAt(x, y) {
  let best = null, bestD = 14
  for (const b of BANDS) {
    const h = handlePos(b)
    const d = Math.hypot(h.x - x, h.y - y)
    if (d < bestD) { bestD = d; best = b }
  }
  return best
}

function localXY(e) {
  const r = cv.value.getBoundingClientRect()
  return { x: e.clientX - r.left, y: e.clientY - r.top }
}

function onDown(e) {
  const { x, y } = localXY(e)
  const band = bandAt(x, y)
  if (!band) return
  dragBand.value = band
  const move = ev => {
    const p = localXY(ev)
    setMixerEqBand(props.trackIdx, band, { freq: fOf(p.x), gain: Math.round(dbOf(p.y) * 2) / 2 })
  }
  const up = () => { dragBand.value = null; window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
  window.addEventListener('mousemove', move)
  window.addEventListener('mouseup', up)
}
function onDbl(e) {
  const { x, y } = localXY(e)
  const band = bandAt(x, y)
  if (band) setMixerEqBand(props.trackIdx, band, { gain: 0, freq: DEF_FREQ[band], ...(band === 'mid' ? { q: 1 } : {}) })
}
function onWheel(e) {
  const band = hover.value ?? 'mid'
  if (band !== 'mid') return
  const q = (eq.value.midQ ?? 1) * (e.deltaY < 0 ? 1.12 : 1 / 1.12)
  setMixerEqBand(props.trackIdx, 'mid', { q })
}
function onHover(e) {
  if (dragBand.value) return
  const { x, y } = localXY(e)
  hover.value = bandAt(x, y)
}

const N = 160
const freqs = new Float32Array(N)
const mags = new Float32Array(N)
const phases = new Float32Array(N)
let spec = null
let raf = 0

function draw() {
  raf = requestAnimationFrame(draw)
  const c = cv.value
  if (!c) return
  const rw = wrap.value.clientWidth
  if (Math.round(rw * dpr) !== c.width) resize()
  const g = c.getContext('2d')
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  g.clearRect(0, 0, W, H)
  g.fillStyle = '#0b0e13'
  g.fillRect(0, 0, W, H)

  // Grid
  g.strokeStyle = 'rgba(255,255,255,0.06)'
  g.lineWidth = 1
  g.beginPath()
  for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) { const x = Math.round(xOf(f)) + 0.5; g.moveTo(x, 0); g.lineTo(x, H) }
  for (const d of [-12, -6, 6, 12]) { const y = Math.round(yOf(d)) + 0.5; g.moveTo(0, y); g.lineTo(W, y) }
  g.stroke()
  g.strokeStyle = 'rgba(255,255,255,0.14)'
  g.beginPath(); g.moveTo(0, Math.round(yOf(0)) + 0.5); g.lineTo(W, Math.round(yOf(0)) + 0.5); g.stroke()
  g.fillStyle = 'rgba(255,255,255,0.28)'
  g.font = '8px "Share Tech Mono", monospace'
  for (const [f, l] of [[100, '100'], [1000, '1k'], [10000, '10k']]) g.fillText(l, xOf(f) + 2, H - 3)

  // Live spectrum of the track (post-fader).
  const an = getMixerAnalyser(props.trackIdx)
  if (an) {
    if (!spec || spec.length !== an.frequencyBinCount) spec = new Uint8Array(an.frequencyBinCount)
    an.getByteFrequencyData(spec)
    const nyq = an.context.sampleRate / 2
    g.beginPath()
    g.moveTo(0, H)
    for (let i = 1; i < spec.length; i++) {
      const f = (i / spec.length) * nyq
      if (f < F_MIN) continue
      g.lineTo(xOf(f), H - (spec[i] / 255) * H * 0.9)
    }
    g.lineTo(W, H)
    g.closePath()
    g.fillStyle = 'rgba(120,160,255,0.16)'
    g.fill()
  }

  // Summed EQ response.
  const e = eq.value
  filters[0].frequency.value = e.lowFreq ?? 80;   filters[0].gain.value = e.low ?? 0
  filters[1].frequency.value = e.midFreq ?? 1000; filters[1].gain.value = e.mid ?? 0; filters[1].Q.value = e.midQ ?? 1
  filters[2].frequency.value = e.highFreq ?? 8000; filters[2].gain.value = e.high ?? 0
  const total = new Float32Array(N)
  for (const f of filters) {
    f.getFrequencyResponse(freqs, mags, phases)
    for (let i = 0; i < N; i++) total[i] += 20 * Math.log10(Math.max(1e-6, mags[i]))
  }
  g.beginPath()
  for (let i = 0; i < N; i++) {
    const x = xOf(freqs[i]), y = yOf(Math.max(-DB, Math.min(DB, total[i])))
    i ? g.lineTo(x, y) : g.moveTo(x, y)
  }
  g.strokeStyle = '#f0a030'
  g.lineWidth = 2
  g.stroke()
  g.lineTo(W, yOf(0)); g.lineTo(0, yOf(0)); g.closePath()
  g.fillStyle = 'rgba(240,160,48,0.12)'
  g.fill()

  // Band handles.
  for (const b of BANDS) {
    const h = handlePos(b)
    g.beginPath()
    g.arc(h.x, h.y, active.value === b ? 7 : 5.5, 0, Math.PI * 2)
    g.fillStyle = BAND_COLOR[b]
    g.fill()
    g.strokeStyle = active.value === b ? '#fff' : 'rgba(0,0,0,0.6)'
    g.lineWidth = 1.5
    g.stroke()
  }
}

function resize() {
  dpr = window.devicePixelRatio || 1
  W = wrap.value.clientWidth
  H = 120
  cv.value.width = Math.round(W * dpr)
  cv.value.height = Math.round(H * dpr)
  cv.value.style.height = H + 'px'
}

onMounted(() => {
  for (let i = 0; i < N; i++) freqs[i] = F_MIN * Math.pow(F_MAX / F_MIN, i / (N - 1))
  resize()
  draw()
})
onBeforeUnmount(() => cancelAnimationFrame(raf))
</script>

<style scoped>
.eqg { padding: 6px 8px 4px; border-bottom: 1px solid var(--border-subtle); }
.eqg-cv { display: block; width: 100%; border-radius: 3px; cursor: crosshair; border: 1px solid rgba(255,255,255,0.08); }
.eqg-readout { margin-top: 3px; font-family: 'Share Tech Mono', monospace; font-size: 9px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
