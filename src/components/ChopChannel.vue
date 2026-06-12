<template>
  <div class="chp">
    <!-- File row -->
    <div class="chp-file-row">
      <button class="chp-load-btn" @click="fileInput?.click()" title="Load audio file">📂</button>
      <span class="chp-name" :title="ch.sampleName">{{ ch.sampleName || 'No file — drop or click 📂' }}</span>
      <span v-if="buf" class="chp-dur">{{ durationLabel }}</span>
      <input ref="fileInput" type="file" accept=".wav,.mp3,.ogg,.flac,.aiff,.aif"
        style="display:none" @change="onFileInput" />
    </div>

    <div v-if="ch.audioFileMissing" class="chp-missing">
      ⚠ Sample missing — drop file here or click 📂
    </div>

    <!-- Slice count selector -->
    <div class="chp-slice-bar">
      <span class="chp-label">SLICES</span>
      <div class="chp-slice-btns">
        <button v-for="n in SLICE_COUNTS" :key="n"
          class="chp-sbtn" :class="{ active: ch.params.sliceCount === n }"
          @click="setSliceCount(n)">{{ n }}</button>
      </div>
      <button class="chp-reset-btn" @click="equalizeSlices" title="Equalize all slices">⇌</button>
    </div>

    <!-- Transient detection row (only when file is loaded) -->
    <div v-if="buf" class="chp-transient-row">
      <span class="chp-label">AUTO</span>
      <input type="range" class="chp-sens-slider" min="1.1" max="3" step="0.05"
        v-model.number="transientSens" title="Sensitivity — lower = more slices" />
      <span class="chp-sens-val">{{ transientSens.toFixed(1) }}</span>
      <button class="chp-detect-btn" @click="detectChopTransients(ch.id, transientSens)"
        title="Auto-detect transients and set slice points">DETECT</button>
    </div>

    <!-- Waveform + slice markers -->
    <div
      ref="waveWrap"
      class="chp-wave-wrap"
      :class="{ 'chp-drag-over': isDragOver }"
      @dragover.prevent="onDragOver"
      @dragleave="onDragLeave"
      @drop.prevent="onDrop"
      @mousedown="onWaveMouseDown"
    >
      <canvas ref="canvas" class="chp-canvas" />

      <!-- Slice handles (all boundaries except 0 and 1) -->
      <div
        v-for="(sl, i) in ch.params.slices.slice(0, -1)"
        :key="i"
        class="chp-slice-handle"
        :style="{ left: sl.end * 100 + '%' }"
        :class="{ highlighted: highlightedSlice === i }"
        @mousedown.stop.prevent="startHandleDrag(i, $event)"
        :title="`Slice ${i + 1} boundary`"
      />

      <!-- Active slice highlight -->
      <div
        v-if="previewSlice !== null"
        class="chp-slice-highlight"
        :style="{
          left: ch.params.slices[previewSlice]?.start * 100 + '%',
          width: ((ch.params.slices[previewSlice]?.end - ch.params.slices[previewSlice]?.start) * 100) + '%'
        }"
      />
    </div>

    <!-- Controls -->
    <div class="chp-controls">
      <div class="chp-knob-row">
        <div class="chp-ctrl">
          <span class="chp-ctrl-label">SPEED</span>
          <input type="range" class="chp-slider" min="0.25" max="4" step="0.01"
            :value="ch.params.speed" @input="ch.params.speed = +$event.target.value" />
          <span class="chp-ctrl-val">{{ ch.params.speed.toFixed(2) }}×</span>
        </div>
        <div class="chp-ctrl">
          <span class="chp-ctrl-label">PITCH</span>
          <input type="range" class="chp-slider" min="-24" max="24" step="1"
            :value="ch.params.pitchOffset" @input="ch.params.pitchOffset = +$event.target.value" />
          <span class="chp-ctrl-val">{{ ch.params.pitchOffset > 0 ? '+' : '' }}{{ ch.params.pitchOffset }}st</span>
        </div>
        <div class="chp-ctrl">
          <span class="chp-ctrl-label">GATE</span>
          <input type="range" class="chp-slider" min="0.05" max="1" step="0.01"
            :value="ch.params.gate" @input="ch.params.gate = +$event.target.value" />
          <span class="chp-ctrl-val">{{ Math.round(ch.params.gate * 100) }}%</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useStudio } from '../store/studio.js'

const props = defineProps({ channel: Object })
const { loadChopFile, getChopBuf, chopVersions, detectChopTransients } = useStudio()

const canvas   = ref(null)
const waveWrap = ref(null)
const fileInput = ref(null)
const isDragOver = ref(false)
const previewSlice = ref(null)
const highlightedSlice = ref(null)
const transientSens = ref(1.5)

const SLICE_COUNTS = [4, 8, 12, 16, 24, 32]
const AUDIO_EXT = /\.(wav|mp3|ogg|flac|aiff?)$/i

const ch = computed(() => props.channel)

const buf = computed(() => {
  const id = ch.value?.id
  if (!id) return null
  void chopVersions[id]
  return getChopBuf(id)
})

const durationLabel = computed(() => {
  const d = buf.value?.duration
  if (d == null) return ''
  return d < 1 ? (d * 1000).toFixed(0) + ' ms' : d.toFixed(2) + ' s'
})

// ── Slice count ───────────────────────────────────────────────────────────────
function makeEqualSlices(n) {
  return Array.from({ length: n }, (_, i) => ({ start: i / n, end: (i + 1) / n }))
}

function setSliceCount(n) {
  ch.value.params.sliceCount = n
  ch.value.params.slices = makeEqualSlices(n)
  nextTick(drawWaveform)
}

function equalizeSlices() {
  const n = ch.value.params.sliceCount ?? 16
  ch.value.params.slices = makeEqualSlices(n)
  nextTick(drawWaveform)
}

// ── Waveform drawing ─────────────────────────────────────────────────────────
function drawWaveform() {
  const cvs = canvas.value
  if (!cvs) return
  const wrap = waveWrap.value
  cvs.width  = wrap?.clientWidth  || 400
  cvs.height = wrap?.clientHeight || 72
  const ctx = cvs.getContext('2d')
  const W = cvs.width, H = cvs.height
  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = 'rgba(0,0,0,0.35)'
  ctx.fillRect(0, 0, W, H)

  const color = ch.value?.color ?? '#e67e22'

  if (!buf.value) {
    ctx.fillStyle = 'rgba(255,255,255,0.15)'
    ctx.font = '11px monospace'
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText('Drop audio file here', W / 2, H / 2)
    return
  }

  const data = buf.value.getChannelData(0)
  const N    = data.length
  const mid  = H / 2

  ctx.strokeStyle = color
  ctx.lineWidth = 1
  ctx.globalAlpha = 0.8
  ctx.beginPath()
  for (let x = 0; x < W; x++) {
    const s0 = Math.floor((x / W) * N)
    const s1 = Math.max(s0 + 1, Math.floor(((x + 1) / W) * N))
    let mn = 1, mx = -1
    for (let s = s0; s < s1 && s < N; s++) {
      if (data[s] < mn) mn = data[s]
      if (data[s] > mx) mx = data[s]
    }
    ctx.moveTo(x + 0.5, mid + mn * mid * 0.88)
    ctx.lineTo(x + 0.5, mid + mx * mid * 0.88)
  }
  ctx.stroke()
  ctx.globalAlpha = 1

  // Slice division lines
  const slices = ch.value?.params.slices ?? []
  ctx.strokeStyle = 'rgba(255,255,255,0.55)'
  ctx.lineWidth = 1
  slices.forEach((sl, i) => {
    if (i === 0) return
    const x = sl.start * W
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke()
  })

  // Slice index labels
  ctx.fillStyle = 'rgba(255,255,255,0.35)'
  ctx.font = '9px monospace'
  ctx.textAlign = 'center'; ctx.textBaseline = 'top'
  slices.forEach((sl, i) => {
    if ((sl.end - sl.start) * W < 14) return
    ctx.fillText(i + 1, ((sl.start + sl.end) / 2) * W, 3)
  })

  // Center line
  ctx.strokeStyle = 'rgba(255,255,255,0.1)'
  ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(W, mid); ctx.stroke()
}

watch([buf, () => ch.value?.id, () => ch.value?.color], () => nextTick(drawWaveform))
watch(() => ch.value?.params.slices, () => nextTick(drawWaveform), { deep: true })

onMounted(() => { drawWaveform(); window.addEventListener('resize', drawWaveform) })
onBeforeUnmount(() => { window.removeEventListener('resize', drawWaveform); stopHandleDrag() })

// ── Slice handle dragging ─────────────────────────────────────────────────────
let _dragSliceIdx = null

function fracFromX(e) {
  const rect = waveWrap.value?.getBoundingClientRect()
  if (!rect || rect.width === 0) return 0
  return Math.max(0.01, Math.min(0.99, (e.clientX - rect.left) / rect.width))
}

function startHandleDrag(idx, e) {
  _dragSliceIdx = idx
  highlightedSlice.value = idx
  window.addEventListener('mousemove', onHandleMove)
  window.addEventListener('mouseup',   onHandleUp)
}

function onHandleMove(e) {
  if (_dragSliceIdx === null || !ch.value) return
  const f = fracFromX(e)
  const slices = ch.value.params.slices
  const prev = slices[_dragSliceIdx]
  const next = slices[_dragSliceIdx + 1]
  const minGap = 0.02
  const clampedF = Math.max((prev?.start ?? 0) + minGap, Math.min((next?.end ?? 1) - minGap, f))
  slices[_dragSliceIdx].end     = clampedF
  slices[_dragSliceIdx + 1].start = clampedF
  nextTick(drawWaveform)
}

function onHandleUp() { stopHandleDrag() }

function stopHandleDrag() {
  _dragSliceIdx = null
  highlightedSlice.value = null
  window.removeEventListener('mousemove', onHandleMove)
  window.removeEventListener('mouseup',   onHandleUp)
}

// Click waveform to preview which slice is at that position
function onWaveMouseDown(e) {
  if (_dragSliceIdx !== null) return
  const rect = waveWrap.value?.getBoundingClientRect()
  if (!rect) return
  const f = (e.clientX - rect.left) / rect.width
  const slices = ch.value?.params.slices ?? []
  const idx = slices.findIndex(s => f >= s.start && f < s.end)
  previewSlice.value = idx >= 0 ? idx : null
}

// ── File drop / input ─────────────────────────────────────────────────────────
function onDragOver(e) {
  if ([...(e.dataTransfer?.items ?? [])].some(i => i.kind === 'file')) isDragOver.value = true
}
function onDragLeave() { isDragOver.value = false }
async function onDrop(e) {
  isDragOver.value = false
  const file = [...(e.dataTransfer?.files ?? [])].find(f => AUDIO_EXT.test(f.name))
  if (file && ch.value) await loadChopFile(ch.value.id, file)
}
async function onFileInput(e) {
  const file = e.target.files?.[0]; e.target.value = ''
  if (file && ch.value) await loadChopFile(ch.value.id, file)
}
</script>

<style scoped>
.chp { display: flex; flex-direction: column; gap: 6px; padding: 8px 0 4px; }

.chp-file-row { display: flex; align-items: center; gap: 6px; padding: 0 2px; }
.chp-load-btn {
  background: none; border: 1px solid rgba(255,255,255,0.18); border-radius: 3px;
  color: rgba(255,255,255,0.7); cursor: pointer; font-size: 13px; line-height: 1; padding: 2px 5px;
}
.chp-load-btn:hover { background: rgba(255,255,255,0.08); }
.chp-name { flex: 1; font-size: 11px; color: rgba(255,255,255,0.6); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chp-dur  { font-size: 10px; color: rgba(255,255,255,0.35); white-space: nowrap; }

.chp-missing { font-size: 10px; color: #f39c12; padding: 4px 6px; background: rgba(243,156,18,0.1); border-radius: 3px; border: 1px solid rgba(243,156,18,0.25); }

.chp-slice-bar { display: flex; align-items: center; gap: 6px; }
.chp-label { font-size: 9px; font-weight: 700; letter-spacing: 0.06em; color: rgba(255,255,255,0.35); flex-shrink: 0; }
.chp-slice-btns { display: flex; gap: 2px; }
.chp-sbtn {
  background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.15); border-radius: 2px;
  color: rgba(255,255,255,0.45); font-size: 9px; cursor: pointer; padding: 1px 4px;
  transition: all 0.1s;
}
.chp-sbtn.active, .chp-sbtn:hover { background: rgba(255,255,255,0.12); color: rgba(255,255,255,0.9); border-color: rgba(255,255,255,0.4); }
.chp-reset-btn {
  margin-left: auto; background: none; border: 1px solid rgba(255,255,255,0.15); border-radius: 3px;
  color: rgba(255,255,255,0.45); font-size: 11px; cursor: pointer; padding: 1px 5px;
}
.chp-reset-btn:hover { background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.8); }

.chp-transient-row { display: flex; align-items: center; gap: 5px; }
.chp-sens-slider { flex: 1; height: 3px; accent-color: #e67e22; cursor: pointer; }
.chp-sens-val { font-size: 10px; color: rgba(255,255,255,0.4); width: 26px; flex-shrink: 0; }
.chp-detect-btn {
  background: rgba(230,126,34,0.15); border: 1px solid rgba(230,126,34,0.4); border-radius: 3px;
  color: #e67e22; font-size: 9px; font-weight: 700; letter-spacing: 0.06em;
  cursor: pointer; padding: 2px 7px; transition: all 0.1s; flex-shrink: 0;
}
.chp-detect-btn:hover { background: rgba(230,126,34,0.3); border-color: #e67e22; }

.chp-wave-wrap {
  position: relative; height: 72px; border-radius: 4px; overflow: hidden;
  border: 1px solid rgba(255,255,255,0.1); cursor: crosshair; transition: border-color 0.15s;
}
.chp-wave-wrap.chp-drag-over { border-color: #e67e22; box-shadow: 0 0 0 1px #e67e22 inset; }
.chp-canvas { display: block; width: 100%; height: 100%; }

.chp-slice-handle {
  position: absolute; top: 0; bottom: 0; width: 3px; background: rgba(255,255,255,0.7);
  cursor: ew-resize; transform: translateX(-50%); z-index: 4; border-radius: 1px;
}
.chp-slice-handle::after { content: ''; position: absolute; top: 0; bottom: 0; left: -5px; right: -5px; }
.chp-slice-handle.highlighted { background: #f39c12; }

.chp-slice-highlight {
  position: absolute; top: 0; bottom: 0; background: rgba(255,255,255,0.12);
  pointer-events: none; z-index: 2;
}

.chp-controls { padding: 2px 0; }
.chp-knob-row { display: flex; flex-direction: column; gap: 4px; }
.chp-ctrl { display: flex; align-items: center; gap: 6px; }
.chp-ctrl-label { font-size: 9px; font-weight: 700; letter-spacing: 0.06em; color: rgba(255,255,255,0.35); width: 36px; flex-shrink: 0; }
.chp-slider { flex: 1; height: 3px; accent-color: #e67e22; cursor: pointer; }
.chp-ctrl-val { font-size: 10px; color: rgba(255,255,255,0.55); width: 42px; text-align: right; flex-shrink: 0; }
</style>
