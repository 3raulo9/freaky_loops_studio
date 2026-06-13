<template>
  <div class="frg">
    <!-- Deck tabs -->
    <div class="frg-deck-tabs">
      <button class="frg-dtab" :class="{ active: activeDeck === 'A' }" @click="activeDeck = 'A'">
        DECK A
      </button>
      <div class="frg-blend-wrap">
        <input type="range" class="frg-blend" min="0" max="1" step="0.01"
          :value="ch.params.deckBlend" @input="ch.params.deckBlend = +$event.target.value"
          title="Deck blend: left = A, right = B" />
        <span class="frg-blend-val">{{ blendLabel }}</span>
      </div>
      <button class="frg-dtab" :class="{ active: activeDeck === 'B' }" @click="activeDeck = 'B'">
        DECK B
      </button>
    </div>

    <!-- Active deck file row -->
    <div class="frg-file-row">
      <button class="frg-load-btn" @click="fileInput?.click()" :title="`Load Deck ${activeDeck}`">📂</button>
      <span class="frg-name" :title="deckName">{{ deckName || `No file — drop or click 📂` }}</span>
      <span v-if="activeBuf" class="frg-dur">{{ durationLabel }}</span>
      <input ref="fileInput" type="file" accept=".wav,.mp3,.ogg,.flac,.aiff,.aif"
        style="display:none" @change="onFileInput" />
    </div>

    <div v-if="deckMissing" class="frg-missing">
      ⚠ Deck {{ activeDeck }} sample missing — drop file here or click 📂
    </div>

    <!-- Slice count selector -->
    <div class="frg-slice-bar">
      <span class="frg-label">SLICES</span>
      <div class="frg-slice-btns">
        <button v-for="n in SLICE_COUNTS" :key="n"
          class="frg-sbtn" :class="{ active: ch.params.sliceCount === n }"
          @click="setSliceCount(n)">{{ n }}</button>
      </div>
      <button class="frg-reset-btn" @click="equalizeSlices" title="Equalize slices">⇌</button>
      <button class="frg-reset-btn" @click="sliceToMidi(ch.id)"
        title="Slice → MIDI: create a pattern that plays each slice in order">→SEQ</button>
    </div>

    <!-- Waveform + slice markers -->
    <div
      ref="waveWrap"
      class="frg-wave-wrap"
      :class="{ 'frg-drag-over': isDragOver }"
      @dragover.prevent="onDragOver"
      @dragleave="onDragLeave"
      @drop.prevent="onDrop"
      @mousedown="onWaveClick"
    >
      <canvas ref="canvas" class="frg-canvas" />

      <!-- Slice boundary handles -->
      <div
        v-for="(sl, i) in ch.params.slices.slice(0, -1)"
        :key="i"
        class="frg-slice-handle"
        :style="{ left: sl.end * 100 + '%' }"
        @mousedown.stop.prevent="startHandleDrag(i, $event)"
      />

      <!-- Selected-slice highlight -->
      <div
        v-if="selectedSlice !== null && ch.params.slices[selectedSlice]"
        class="frg-sel-highlight"
        :style="{
          left: ch.params.slices[selectedSlice].start * 100 + '%',
          width: ((ch.params.slices[selectedSlice].end - ch.params.slices[selectedSlice].start) * 100) + '%'
        }"
      />
    </div>

    <!-- Per-slice editor (visible when a slice is selected) -->
    <div v-if="selectedSlice !== null" class="frg-slice-editor">
      <div class="frg-se-title">
        SLICE {{ selectedSlice + 1 }}
        <button class="frg-se-close" @click="selectedSlice = null">✕</button>
      </div>
      <div class="frg-se-grid">
        <div class="frg-se-ctrl">
          <span class="frg-se-lbl">VOL</span>
          <input type="range" class="frg-se-slider" min="0" max="2" step="0.01"
            :value="editedSlice.vol ?? 1" @input="setSliceParam('vol', +$event.target.value)" />
          <span class="frg-se-val">{{ Math.round((editedSlice.vol ?? 1) * 100) }}%</span>
        </div>
        <div class="frg-se-ctrl">
          <span class="frg-se-lbl">PAN</span>
          <input type="range" class="frg-se-slider" min="-1" max="1" step="0.01"
            :value="editedSlice.pan ?? 0" @input="setSliceParam('pan', +$event.target.value)" />
          <span class="frg-se-val">{{ panLabel }}</span>
        </div>
        <div class="frg-se-ctrl">
          <span class="frg-se-lbl">PCH</span>
          <input type="range" class="frg-se-slider" min="-24" max="24" step="1"
            :value="editedSlice.pitch ?? 0" @input="setSliceParam('pitch', +$event.target.value)" />
          <span class="frg-se-val">{{ pitchLabel }}</span>
        </div>
        <div class="frg-se-ctrl">
          <span class="frg-se-lbl">ATK</span>
          <input type="range" class="frg-se-slider" min="0" max="0.5" step="0.001"
            :value="editedSlice.attack ?? 0" @input="setSliceParam('attack', +$event.target.value)" />
          <span class="frg-se-val">{{ Math.round((editedSlice.attack ?? 0) * 1000) }}ms</span>
        </div>
        <div class="frg-se-ctrl">
          <span class="frg-se-lbl">REL</span>
          <input type="range" class="frg-se-slider" min="0" max="1" step="0.001"
            :value="editedSlice.release ?? 0" @input="setSliceParam('release', +$event.target.value)" />
          <span class="frg-se-val">{{ Math.round((editedSlice.release ?? 0) * 1000) }}ms</span>
        </div>
        <div class="frg-se-ctrl">
          <span class="frg-se-lbl">DIR</span>
          <div class="frg-dir-btns">
            <button class="frg-dir-btn" :class="{ active: (editedSlice.dir ?? 'fwd') === 'fwd' }"
              @click="setSliceParam('dir', 'fwd')">FWD</button>
            <button class="frg-dir-btn" :class="{ active: editedSlice.dir === 'rev' }"
              @click="setSliceParam('dir', 'rev')">REV</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Velocity & deckBlend hint -->
    <div class="frg-footer-row">
      <div class="frg-ctrl">
        <span class="frg-ctrl-label">VEL</span>
        <input type="range" class="frg-slider" min="0" max="1" step="0.01"
          :value="ch.params.velocity" @input="ch.params.velocity = +$event.target.value" />
        <span class="frg-ctrl-val">{{ Math.round(ch.params.velocity * 100) }}%</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useStudio } from '../store/studio.js'

const props = defineProps({ channel: Object })
const { loadForgeDeck, getForgeBuf, forgeVersions, sliceToMidi } = useStudio()

const canvas     = ref(null)
const waveWrap   = ref(null)
const fileInput  = ref(null)
const isDragOver = ref(false)
const activeDeck = ref('A')
const selectedSlice = ref(null)

const SLICE_COUNTS = [4, 8, 12, 16, 24, 32]
const AUDIO_EXT = /\.(wav|mp3|ogg|flac|aiff?)$/i

const ch = computed(() => props.channel)

const activeBuf = computed(() => {
  const id = ch.value?.id
  if (!id) return null
  void forgeVersions[id + '_' + activeDeck.value]
  return getForgeBuf(id, activeDeck.value)
})

const deckName = computed(() => {
  if (activeDeck.value === 'A') return ch.value?.params?.deckAName ?? ''
  return ch.value?.params?.deckBName ?? ''
})

const deckMissing = computed(() => {
  if (activeDeck.value === 'A') return ch.value?.deckAMissing ?? false
  return ch.value?.deckBMissing ?? false
})

const durationLabel = computed(() => {
  const d = activeBuf.value?.duration
  if (d == null) return ''
  return d < 1 ? (d * 1000).toFixed(0) + ' ms' : d.toFixed(2) + ' s'
})

const blendLabel = computed(() => {
  const b = ch.value?.params?.deckBlend ?? 0
  if (b < 0.02) return '← A'
  if (b > 0.98) return 'B →'
  return `${Math.round(b * 100)}%`
})

const editedSlice = computed(() => {
  if (selectedSlice.value === null) return {}
  return ch.value?.params?.slices?.[selectedSlice.value] ?? {}
})

const panLabel = computed(() => {
  const p = editedSlice.value.pan ?? 0
  if (Math.abs(p) < 0.02) return 'C'
  return (p > 0 ? 'R' : 'L') + Math.round(Math.abs(p) * 100)
})

const pitchLabel = computed(() => {
  const p = editedSlice.value.pitch ?? 0
  return (p > 0 ? '+' : '') + p + ' st'
})

function setSliceParam(key, val) {
  if (selectedSlice.value === null) return
  const sl = ch.value?.params?.slices?.[selectedSlice.value]
  if (sl) sl[key] = val
}

// ── Slice count ───────────────────────────────────────────────────────────────
function makeForgeSlices(n) {
  return Array.from({ length: n }, (_, i) => ({
    start: i / n, end: (i + 1) / n,
    vol: 1, pan: 0, pitch: 0, dir: 'fwd'
  }))
}

function setSliceCount(n) {
  ch.value.params.sliceCount = n
  ch.value.params.slices = makeForgeSlices(n)
  selectedSlice.value = null
  nextTick(drawWaveform)
}

function equalizeSlices() {
  const n = ch.value.params.sliceCount ?? 16
  ch.value.params.slices = makeForgeSlices(n)
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

  const color = ch.value?.color ?? '#9b59b6'

  if (!activeBuf.value) {
    ctx.fillStyle = 'rgba(255,255,255,0.15)'
    ctx.font = '11px monospace'
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(`Drop audio file for Deck ${activeDeck.value}`, W / 2, H / 2)
    return
  }

  const data = activeBuf.value.getChannelData(0)
  const N = data.length
  const mid = H / 2

  ctx.strokeStyle = color
  ctx.lineWidth = 1
  ctx.globalAlpha = 0.82
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

  // Slice lines
  const slices = ch.value?.params.slices ?? []
  ctx.strokeStyle = 'rgba(255,255,255,0.5)'
  ctx.lineWidth = 1
  slices.forEach((sl, i) => {
    if (i === 0) return
    const x = sl.start * W
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke()
  })

  // Selected slice shading
  if (selectedSlice.value !== null) {
    const sel = slices[selectedSlice.value]
    if (sel) {
      ctx.fillStyle = 'rgba(155,89,182,0.22)'
      ctx.fillRect(sel.start * W, 0, (sel.end - sel.start) * W, H)
    }
  }

  // Slice labels
  ctx.fillStyle = 'rgba(255,255,255,0.3)'
  ctx.font = '9px monospace'
  ctx.textAlign = 'center'; ctx.textBaseline = 'top'
  slices.forEach((sl, i) => {
    if ((sl.end - sl.start) * W < 14) return
    ctx.fillText(i + 1, ((sl.start + sl.end) / 2) * W, 3)
  })

  // Center line
  ctx.strokeStyle = 'rgba(255,255,255,0.08)'
  ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(W, mid); ctx.stroke()
}

watch([activeBuf, activeDeck, () => ch.value?.id, () => ch.value?.color], () => nextTick(drawWaveform))
watch(() => ch.value?.params.slices, () => nextTick(drawWaveform), { deep: true })
watch(selectedSlice, () => nextTick(drawWaveform))

onMounted(() => { drawWaveform(); window.addEventListener('resize', drawWaveform) })
onBeforeUnmount(() => { window.removeEventListener('resize', drawWaveform); stopHandleDrag() })

// ── Slice handle dragging ─────────────────────────────────────────────────────
let _dragIdx = null

function fracFromX(e) {
  const rect = waveWrap.value?.getBoundingClientRect()
  if (!rect || rect.width === 0) return 0
  return Math.max(0.01, Math.min(0.99, (e.clientX - rect.left) / rect.width))
}

function startHandleDrag(idx, e) {
  _dragIdx = idx
  window.addEventListener('mousemove', onHandleMove)
  window.addEventListener('mouseup',   onHandleUp)
}

function onHandleMove(e) {
  if (_dragIdx === null) return
  const f = fracFromX(e)
  const slices = ch.value.params.slices
  const minGap = 0.02
  const clamped = Math.max(
    (slices[_dragIdx]?.start ?? 0) + minGap,
    Math.min((slices[_dragIdx + 1]?.end ?? 1) - minGap, f)
  )
  slices[_dragIdx].end          = clamped
  slices[_dragIdx + 1].start    = clamped
  nextTick(drawWaveform)
}

function onHandleUp() { stopHandleDrag() }
function stopHandleDrag() {
  _dragIdx = null
  window.removeEventListener('mousemove', onHandleMove)
  window.removeEventListener('mouseup',   onHandleUp)
}

function onWaveClick(e) {
  if (_dragIdx !== null) return
  const rect = waveWrap.value?.getBoundingClientRect()
  if (!rect) return
  const f = (e.clientX - rect.left) / rect.width
  const slices = ch.value?.params.slices ?? []
  const idx = slices.findIndex(s => f >= s.start && f < s.end)
  selectedSlice.value = idx >= 0 ? (selectedSlice.value === idx ? null : idx) : null
}

// ── File drop / input ─────────────────────────────────────────────────────────
function onDragOver(e) {
  if ([...(e.dataTransfer?.items ?? [])].some(i => i.kind === 'file')) isDragOver.value = true
}
function onDragLeave() { isDragOver.value = false }
async function onDrop(e) {
  isDragOver.value = false
  const file = [...(e.dataTransfer?.files ?? [])].find(f => AUDIO_EXT.test(f.name))
  if (file && ch.value) await loadForgeDeck(ch.value.id, activeDeck.value, file)
}
async function onFileInput(e) {
  const file = e.target.files?.[0]; e.target.value = ''
  if (file && ch.value) await loadForgeDeck(ch.value.id, activeDeck.value, file)
}
</script>

<style scoped>
.frg { display: flex; flex-direction: column; gap: 5px; padding: 8px 0 4px; }

.frg-deck-tabs { display: flex; align-items: center; gap: 4px; }
.frg-dtab {
  background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.15); border-radius: 3px;
  color: rgba(255,255,255,0.4); font-size: 9px; font-weight: 700; letter-spacing: 0.06em;
  cursor: pointer; padding: 2px 6px; transition: all 0.1s;
}
.frg-dtab.active { background: rgba(155,89,182,0.2); color: #c084e0; border-color: #9b59b6; }
.frg-dtab:hover:not(.active) { color: rgba(255,255,255,0.6); }
.frg-blend-wrap { flex: 1; display: flex; align-items: center; gap: 4px; }
.frg-blend { flex: 1; height: 3px; accent-color: #9b59b6; cursor: pointer; }
.frg-blend-val { font-size: 9px; color: rgba(255,255,255,0.35); white-space: nowrap; min-width: 24px; text-align: center; }

.frg-file-row { display: flex; align-items: center; gap: 6px; }
.frg-load-btn {
  background: none; border: 1px solid rgba(255,255,255,0.18); border-radius: 3px;
  color: rgba(255,255,255,0.7); cursor: pointer; font-size: 13px; line-height: 1; padding: 2px 5px;
}
.frg-load-btn:hover { background: rgba(255,255,255,0.08); }
.frg-name { flex: 1; font-size: 11px; color: rgba(255,255,255,0.6); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.frg-dur  { font-size: 10px; color: rgba(255,255,255,0.35); white-space: nowrap; }

.frg-missing { font-size: 10px; color: #f39c12; padding: 4px 6px; background: rgba(243,156,18,0.1); border-radius: 3px; border: 1px solid rgba(243,156,18,0.25); }

.frg-slice-bar { display: flex; align-items: center; gap: 6px; }
.frg-label { font-size: 9px; font-weight: 700; letter-spacing: 0.06em; color: rgba(255,255,255,0.35); flex-shrink: 0; }
.frg-slice-btns { display: flex; gap: 2px; }
.frg-sbtn {
  background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.15); border-radius: 2px;
  color: rgba(255,255,255,0.45); font-size: 9px; cursor: pointer; padding: 1px 4px;
  transition: all 0.1s;
}
.frg-sbtn.active, .frg-sbtn:hover { background: rgba(155,89,182,0.2); color: #c084e0; border-color: #9b59b6; }
.frg-reset-btn {
  margin-left: auto; background: none; border: 1px solid rgba(255,255,255,0.15); border-radius: 3px;
  color: rgba(255,255,255,0.45); font-size: 11px; cursor: pointer; padding: 1px 5px;
}
.frg-reset-btn:hover { background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.8); }

.frg-wave-wrap {
  position: relative; height: 72px; border-radius: 4px; overflow: hidden;
  border: 1px solid rgba(255,255,255,0.1); cursor: pointer; transition: border-color 0.15s;
}
.frg-wave-wrap.frg-drag-over { border-color: #9b59b6; box-shadow: 0 0 0 1px #9b59b6 inset; }
.frg-canvas { display: block; width: 100%; height: 100%; }

.frg-slice-handle {
  position: absolute; top: 0; bottom: 0; width: 3px; background: rgba(255,255,255,0.6);
  cursor: ew-resize; transform: translateX(-50%); z-index: 4; border-radius: 1px;
}
.frg-slice-handle::after { content: ''; position: absolute; top: 0; bottom: 0; left: -5px; right: -5px; }

.frg-sel-highlight {
  position: absolute; top: 0; bottom: 0; background: rgba(155,89,182,0.22);
  pointer-events: none; z-index: 2;
  border-left: 1px solid rgba(155,89,182,0.6);
  border-right: 1px solid rgba(155,89,182,0.6);
}

.frg-slice-editor {
  background: rgba(155,89,182,0.08); border: 1px solid rgba(155,89,182,0.25);
  border-radius: 4px; padding: 6px 8px; display: flex; flex-direction: column; gap: 4px;
}
.frg-se-title {
  display: flex; align-items: center; justify-content: space-between;
  font-size: 9px; font-weight: 700; letter-spacing: 0.1em; color: #c084e0;
}
.frg-se-close {
  background: none; border: none; color: rgba(255,255,255,0.3); font-size: 11px; cursor: pointer;
}
.frg-se-close:hover { color: #e74c3c; }
.frg-se-grid { display: flex; flex-direction: column; gap: 3px; }
.frg-se-ctrl { display: flex; align-items: center; gap: 5px; }
.frg-se-lbl { font-size: 9px; font-weight: 700; color: rgba(255,255,255,0.35); width: 26px; flex-shrink: 0; }
.frg-se-slider { flex: 1; height: 3px; accent-color: #9b59b6; cursor: pointer; }
.frg-se-val { font-size: 10px; color: rgba(255,255,255,0.5); width: 38px; text-align: right; flex-shrink: 0; }

.frg-dir-btns { display: flex; gap: 2px; flex: 1; }
.frg-dir-btn {
  flex: 1; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.15);
  border-radius: 2px; color: rgba(255,255,255,0.4); font-size: 8px; font-weight: 700;
  letter-spacing: 0.05em; cursor: pointer; padding: 2px 0; transition: all 0.1s;
}
.frg-dir-btn.active { background: rgba(155,89,182,0.3); color: #c084e0; border-color: #9b59b6; }
.frg-dir-btn:hover:not(.active) { color: rgba(255,255,255,0.6); }

.frg-footer-row { padding: 2px 0; }
.frg-ctrl { display: flex; align-items: center; gap: 6px; }
.frg-ctrl-label { font-size: 9px; font-weight: 700; letter-spacing: 0.06em; color: rgba(255,255,255,0.35); width: 26px; flex-shrink: 0; }
.frg-slider { flex: 1; height: 3px; accent-color: #9b59b6; cursor: pointer; }
.frg-ctrl-val { font-size: 10px; color: rgba(255,255,255,0.55); width: 36px; text-align: right; flex-shrink: 0; }
</style>
