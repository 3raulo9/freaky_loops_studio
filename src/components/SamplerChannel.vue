<template>
  <div class="smp" :class="{ 'smp-drag-over': isDragOver }"
    @dragover.prevent="onDragOver" @dragleave="onDragLeave" @drop.prevent="onDrop">

    <!-- ── Top bar ──────────────────────────────────────────────────────────── -->
    <div class="smp-topbar">
      <button class="smp-icon-btn" @click="fileInput?.click()" title="Load audio file">📂</button>
      <span class="smp-filename" :title="ch.sampleName">{{ ch.sampleName || 'Drop audio file here…' }}</span>
      <span v-if="buf" class="smp-duration">{{ durationLabel }}</span>

      <span v-if="ch.audioFileMissing" class="smp-missing-badge">⚠ MISSING</span>

      <!-- Channel select -->
      <div class="smp-group">
        <span class="smp-lbl">CH</span>
        <select class="smp-sel" v-model="displayChannel" title="Display channel">
          <option :value="0">L</option>
          <option v-if="isStereo" :value="1">R</option>
        </select>
      </div>

      <!-- Reverse toggle -->
      <button class="smp-mode-btn" :class="{ active: p.reverse }"
        @click="p.reverse = !p.reverse" title="Reverse playback">REV</button>

      <!-- Loop mode -->
      <div class="smp-group">
        <span class="smp-lbl">LOOP</span>
        <div class="smp-seg">
          <button v-for="m in LOOP_MODES" :key="m.v"
            :class="{ active: (p.loopMode ?? 'off') === m.v }"
            @click="p.loopMode = m.v">{{ m.l }}</button>
        </div>
      </div>

      <!-- Normalize -->
      <button class="smp-icon-btn" @click="onNormalize" title="Normalize to 0 dBFS">NORM</button>

      <input ref="fileInput" type="file" accept=".wav,.mp3,.ogg,.flac,.aiff,.aif"
        style="display:none" @change="onFileInput" />
    </div>

    <!-- ── Waveform ─────────────────────────────────────────────────────────── -->
    <div class="smp-wave-wrap" ref="waveWrap">
      <canvas ref="canvas" class="smp-canvas" />

      <!-- Start handle -->
      <div class="smp-handle smp-handle-start"
        :style="{ left: (p.startOffset ?? 0) * 100 + '%' }"
        title="Start" @mousedown.stop.prevent="startDrag('startOffset', $event)" />

      <!-- End handle -->
      <div class="smp-handle smp-handle-end"
        :style="{ left: (p.endOffset ?? 1) * 100 + '%' }"
        title="End" @mousedown.stop.prevent="startDrag('endOffset', $event)" />

      <!-- Loop region -->
      <template v-if="p.loopMode === 'fwd'">
        <div class="smp-loop-region"
          :style="{ left: (p.loopStart ?? 0) * 100 + '%', width: Math.max(0, ((p.loopEnd ?? 1) - (p.loopStart ?? 0))) * 100 + '%' }" />
        <div class="smp-handle smp-handle-loop-s"
          :style="{ left: (p.loopStart ?? 0) * 100 + '%' }"
          title="Loop start" @mousedown.stop.prevent="startDrag('loopStart', $event)" />
        <div class="smp-handle smp-handle-loop-e"
          :style="{ left: (p.loopEnd ?? 1) * 100 + '%' }"
          title="Loop end" @mousedown.stop.prevent="startDrag('loopEnd', $event)" />
      </template>
    </div>

    <!-- ── Loop tools (FWD only) ────────────────────────────────────────────── -->
    <div v-if="p.loopMode === 'fwd'" class="smp-loop-tools">
      <span class="smp-lbl">XFADE</span>
      <input type="range" class="smp-slider" min="0" max="0.5" step="0.001"
        :value="p.loopXfade ?? 0" @input="p.loopXfade = +$event.target.value" />
      <span class="smp-val">{{ Math.round((p.loopXfade ?? 0) * 100) }}%</span>
      <button class="smp-icon-btn smp-build-btn"
        @click="doBuildXfade" title="Pre-compute seamless crossfade for loop">BUILD</button>
      <span class="smp-loop-snap-lbl">SNAP:</span>
      <button class="smp-icon-btn" title="Snap loop start to nearest zero crossing"
        @click="doSnap('loopStart')">⊢ LS</button>
      <button class="smp-icon-btn" title="Snap loop end to nearest zero crossing"
        @click="doSnap('loopEnd')">LE ⊣</button>
      <button class="smp-icon-btn" title="Snap sample start to nearest zero crossing"
        @click="doSnap('startOffset')">⊢ S</button>
      <button class="smp-icon-btn" title="Snap sample end to nearest zero crossing"
        @click="doSnap('endOffset')">E ⊣</button>
      <span v-if="hasXfade" class="smp-xfade-badge">✓ XFADE READY</span>
    </div>

    <!-- ── Main controls ────────────────────────────────────────────────────── -->
    <div class="smp-controls">

      <!-- COL 1: Tuning + velocity ──────────────────────────────────────── -->
      <div class="smp-col">
        <div class="smp-col-header">TUNING</div>

        <div class="smp-row">
          <span class="smp-lbl">ROOT</span>
          <input type="number" class="smp-num" v-model.number="p.rootNote"
            min="0" max="127" @change="clampRoot" />
          <span class="smp-note-name">{{ noteLabel(p.rootNote ?? 60) }}</span>
        </div>

        <div class="smp-row">
          <span class="smp-lbl">FINE</span>
          <input type="range" class="smp-slider" min="-100" max="100" step="1"
            :value="p.fineTune ?? 0" @input="p.fineTune = +$event.target.value" />
          <span class="smp-val">{{ fineTuneLabel }}</span>
        </div>

        <div class="smp-row">
          <span class="smp-lbl">TRACK</span>
          <input type="range" class="smp-slider" min="0" max="1" step="0.01"
            :value="p.keyTrack ?? 1" @input="p.keyTrack = +$event.target.value" />
          <span class="smp-val">{{ Math.round((p.keyTrack ?? 1) * 100) }}%</span>
        </div>

        <div class="smp-row">
          <span class="smp-lbl">VEL</span>
          <input type="range" class="smp-slider" min="0" max="1" step="0.01"
            :value="p.velSens ?? 1" @input="p.velSens = +$event.target.value" />
          <span class="smp-val">{{ Math.round((p.velSens ?? 1) * 100) }}%</span>
        </div>
      </div>

      <!-- COL 2: Amplitude ADSR ─────────────────────────────────────────── -->
      <div class="smp-col">
        <div class="smp-col-header">AMPLITUDE</div>

        <div class="smp-adsr-vis">
          <svg :viewBox="`0 0 ${ADSR_W} ${ADSR_H}`" preserveAspectRatio="none">
            <polyline :points="adsrPoints" fill="none"
              :stroke="ch.color ?? '#ff9f43'" stroke-width="1.5" stroke-linejoin="round" />
            <polyline :points="adsrPoints"
              :fill="(ch.color ?? '#ff9f43') + '28'" stroke="none" />
          </svg>
        </div>

        <div class="smp-row">
          <span class="smp-lbl">DEL</span>
          <input type="range" class="smp-slider" min="0" max="1" step="0.001"
            :value="p.envDelay ?? 0" @input="p.envDelay = +$event.target.value" />
          <span class="smp-val">{{ msLabel(p.envDelay ?? 0) }}</span>
        </div>

        <div class="smp-row">
          <span class="smp-lbl">ATK</span>
          <input type="range" class="smp-slider" min="0.001" max="2" step="0.001"
            :value="p.envAttack ?? 0.005" @input="p.envAttack = +$event.target.value" />
          <span class="smp-val">{{ msLabel(p.envAttack ?? 0.005) }}</span>
        </div>

        <div class="smp-row smp-row-curve">
          <span class="smp-lbl">┗ CRV</span>
          <input type="range" class="smp-slider" min="-1" max="1" step="0.01"
            :value="p.envAttackCurve ?? 0" @input="p.envAttackCurve = +$event.target.value" />
          <span class="smp-val smp-crv-val">{{ curveLabel(p.envAttackCurve ?? 0) }}</span>
        </div>

        <div class="smp-row">
          <span class="smp-lbl">DCY</span>
          <input type="range" class="smp-slider" min="0.001" max="3" step="0.001"
            :value="p.envDecay ?? 0.1" @input="p.envDecay = +$event.target.value" />
          <span class="smp-val">{{ msLabel(p.envDecay ?? 0.1) }}</span>
        </div>

        <div class="smp-row smp-row-curve">
          <span class="smp-lbl">┗ CRV</span>
          <input type="range" class="smp-slider" min="-1" max="1" step="0.01"
            :value="p.envDecayCurve ?? -0.5" @input="p.envDecayCurve = +$event.target.value" />
          <span class="smp-val smp-crv-val">{{ curveLabel(p.envDecayCurve ?? -0.5) }}</span>
        </div>

        <div class="smp-row">
          <span class="smp-lbl">SUS</span>
          <input type="range" class="smp-slider" min="0" max="1" step="0.01"
            :value="p.envSustain ?? 0.8" @input="p.envSustain = +$event.target.value" />
          <span class="smp-val">{{ Math.round((p.envSustain ?? 0.8) * 100) }}%</span>
        </div>

        <div class="smp-row">
          <span class="smp-lbl">REL</span>
          <input type="range" class="smp-slider" min="0.001" max="5" step="0.001"
            :value="p.envRelease ?? 0.2" @input="p.envRelease = +$event.target.value" />
          <span class="smp-val">{{ msLabel(p.envRelease ?? 0.2) }}</span>
        </div>

        <div class="smp-row smp-row-curve">
          <span class="smp-lbl">┗ CRV</span>
          <input type="range" class="smp-slider" min="-1" max="1" step="0.01"
            :value="p.envReleaseCurve ?? -0.5" @input="p.envReleaseCurve = +$event.target.value" />
          <span class="smp-val smp-crv-val">{{ curveLabel(p.envReleaseCurve ?? -0.5) }}</span>
        </div>
      </div>

      <!-- COL 3: Filter ─────────────────────────────────────────────────── -->
      <div class="smp-col">
        <div class="smp-col-header">FILTER</div>

        <div class="smp-row">
          <span class="smp-lbl">TYPE</span>
          <div class="smp-seg smp-seg-sm">
            <button v-for="ft in FILTER_TYPES" :key="ft.v"
              :class="{ active: (p.filterType ?? 'off') === ft.v }"
              @click="p.filterType = ft.v">{{ ft.l }}</button>
          </div>
        </div>

        <div class="smp-row">
          <span class="smp-lbl">FREQ</span>
          <input type="range" class="smp-slider" min="0" max="1" step="0.001"
            :value="p.filterCutoff ?? 1" @input="p.filterCutoff = +$event.target.value" />
          <span class="smp-val">{{ freqLabel(p.filterCutoff ?? 1) }}</span>
        </div>

        <div class="smp-row">
          <span class="smp-lbl">RESO</span>
          <input type="range" class="smp-slider" min="0" max="1" step="0.01"
            :value="p.filterReso ?? 0" @input="p.filterReso = +$event.target.value" />
          <span class="smp-val">{{ Math.round((p.filterReso ?? 0) * 100) }}%</span>
        </div>

        <div class="smp-col-header smp-col-header-sub">FILTER ENV</div>

        <div class="smp-row">
          <span class="smp-lbl">AMT</span>
          <input type="range" class="smp-slider" min="-1" max="1" step="0.01"
            :value="p.fEnvAmount ?? 0" @input="p.fEnvAmount = +$event.target.value" />
          <span class="smp-val">{{ fenvAmtLabel }}</span>
        </div>

        <div class="smp-row">
          <span class="smp-lbl">ATK</span>
          <input type="range" class="smp-slider" min="0.001" max="2" step="0.001"
            :value="p.fEnvAttack ?? 0.01" @input="p.fEnvAttack = +$event.target.value" />
          <span class="smp-val">{{ msLabel(p.fEnvAttack ?? 0.01) }}</span>
        </div>

        <div class="smp-row">
          <span class="smp-lbl">DCY</span>
          <input type="range" class="smp-slider" min="0.001" max="3" step="0.001"
            :value="p.fEnvDecay ?? 0.2" @input="p.fEnvDecay = +$event.target.value" />
          <span class="smp-val">{{ msLabel(p.fEnvDecay ?? 0.2) }}</span>
        </div>

        <div class="smp-row">
          <span class="smp-lbl">SUS</span>
          <input type="range" class="smp-slider" min="0" max="1" step="0.01"
            :value="p.fEnvSustain ?? 0" @input="p.fEnvSustain = +$event.target.value" />
          <span class="smp-val">{{ Math.round((p.fEnvSustain ?? 0) * 100) }}%</span>
        </div>
      </div>

    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useStudio } from '../store/studio.js'

const props = defineProps({ channel: Object })

const { loadAudioFileForChannel, getAudioFileBuf, audioFileVersions, normalizeAudioFile, buildLoopXfade, snapToZero } = useStudio()

// ── Constants ──────────────────────────────────────────────────────────────────
const LOOP_MODES   = [{ v: 'off', l: 'OFF' }, { v: 'fwd', l: 'FWD' }, { v: 'pingpong', l: 'PING' }]
const FILTER_TYPES = [{ v: 'off', l: 'OFF' }, { v: 'lowpass', l: 'LP' }, { v: 'highpass', l: 'HP' }, { v: 'bandpass', l: 'BP' }, { v: 'notch', l: 'NT' }]
const NOTE_NAMES   = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
const ADSR_W = 120, ADSR_H = 36

// ── Refs ───────────────────────────────────────────────────────────────────────
const canvas       = ref(null)
const waveWrap     = ref(null)
const fileInput    = ref(null)
const isDragOver   = ref(false)
const displayChannel = ref(0)

// ── Convenience accessors ──────────────────────────────────────────────────────
const ch = computed(() => props.channel)
const p  = computed(() => ch.value?.params ?? {})

const buf = computed(() => {
  const id = ch.value?.id
  if (!id) return null
  void audioFileVersions[id]
  return getAudioFileBuf(id)
})

const isStereo = computed(() => (buf.value?.numberOfChannels ?? 0) > 1)

// ── Label helpers ──────────────────────────────────────────────────────────────
function noteLabel(midi) {
  const m = Math.max(0, Math.min(127, Math.round(midi)))
  return NOTE_NAMES[m % 12] + (Math.floor(m / 12) - 1)
}

function msLabel(sec) {
  const ms = sec * 1000
  return ms < 1000 ? Math.round(ms) + 'ms' : sec.toFixed(2) + 's'
}

function freqLabel(norm) {
  const hz = 20 * Math.pow(2, Math.log2(20000 / 20) * Math.max(0, Math.min(1, norm)))
  return hz >= 1000 ? (hz / 1000).toFixed(1) + 'k' : Math.round(hz) + 'Hz'
}

const durationLabel = computed(() => {
  const d = buf.value?.duration
  if (d == null) return ''
  return d < 1 ? Math.round(d * 1000) + ' ms' : d.toFixed(2) + ' s'
})

const fineTuneLabel = computed(() => {
  const c = p.value.fineTune ?? 0
  return (c > 0 ? '+' : '') + c + 'ct'
})

const fenvAmtLabel = computed(() => {
  const a = p.value.fEnvAmount ?? 0
  const oct = (a * 4).toFixed(1)
  return (a > 0 ? '+' : '') + oct + 'o'
})

function curveLabel(v) {
  if (v < -0.6) return 'EXP'
  if (v > 0.6)  return 'LOG'
  if (Math.abs(v) < 0.12) return 'LIN'
  return v < 0 ? 'exp' : 'log'
}

// Whether a precomputed xfade buffer exists for the current channel
const hasXfade = computed(() => {
  const id = ch.value?.id
  if (!id) return false
  void audioFileVersions[id]  // reactive dependency
  // We can only know indirectly — if loopXfade > 0 and buf exists, treat as "ready after BUILD"
  return (p.value.loopXfade ?? 0) > 0.001 && !!buf.value
})

// ── ADSR visualizer (includes DEL stage) ──────────────────────────────────────
const adsrPoints = computed(() => {
  const del = Math.max(0,     p.value.envDelay   ?? 0)
  const atk = Math.max(0.001, p.value.envAttack  ?? 0.005)
  const dec = Math.max(0.001, p.value.envDecay   ?? 0.1)
  const sus = Math.max(0,     p.value.envSustain ?? 0.8)
  const rel = Math.max(0.001, p.value.envRelease ?? 0.2)
  const sus_hold = Math.max(0.1, (atk + dec) * 0.5)
  const total = del + atk + dec + sus_hold + rel
  const W = ADSR_W, H = ADSR_H
  const t = v => (v / total) * (W - 4) + 2
  const a = v => H - 2 - v * (H - 4)
  const pts = [
    `${t(0)},${a(0)}`,
    `${t(del)},${a(0)}`,           // delay hold at 0
    `${t(del + atk)},${a(1)}`,    // attack peak
    `${t(del + atk + dec)},${a(sus)}`,   // decay to sustain
    `${t(del + atk + dec + sus_hold)},${a(sus)}`,  // sustain hold
    `${t(total)},${a(0)}`,         // release to 0
    `${t(0)},${a(0)}`,             // close for fill
  ]
  return pts.join(' ')
})

// ── Waveform drawing ───────────────────────────────────────────────────────────
function drawWaveform() {
  const cvs = canvas.value
  if (!cvs) return
  const wrap = waveWrap.value
  cvs.width  = wrap?.clientWidth  || 600
  cvs.height = wrap?.clientHeight || 96
  const ctx2d = cvs.getContext('2d')
  const W = cvs.width, H = cvs.height
  ctx2d.clearRect(0, 0, W, H)
  ctx2d.fillStyle = 'rgba(0,0,0,0.35)'
  ctx2d.fillRect(0, 0, W, H)

  const color = ch.value?.color ?? '#ff9f43'

  if (!buf.value) {
    ctx2d.fillStyle = 'rgba(255,255,255,0.15)'
    ctx2d.font = '11px monospace'
    ctx2d.textAlign = 'center'
    ctx2d.textBaseline = 'middle'
    ctx2d.fillText('Drop audio file here or click 📂', W / 2, H / 2)
    return
  }

  const chIdx = Math.min(displayChannel.value, buf.value.numberOfChannels - 1)
  const data  = buf.value.getChannelData(chIdx)
  const N     = data.length
  const mid   = H / 2

  ctx2d.strokeStyle = color
  ctx2d.lineWidth = 1
  ctx2d.globalAlpha = 0.75
  ctx2d.beginPath()
  for (let x = 0; x < W; x++) {
    const s0 = Math.floor((x / W) * N)
    const s1 = Math.max(s0 + 1, Math.floor(((x + 1) / W) * N))
    let mn = 1, mx = -1
    for (let s = s0; s < s1 && s < N; s++) {
      if (data[s] < mn) mn = data[s]
      if (data[s] > mx) mx = data[s]
    }
    ctx2d.moveTo(x + 0.5, mid + mn * mid * 0.88)
    ctx2d.lineTo(x + 0.5, mid + mx * mid * 0.88)
  }
  ctx2d.stroke()
  ctx2d.globalAlpha = 1

  // Dim before start
  const sx = (p.value.startOffset ?? 0) * W
  if (sx > 1) {
    ctx2d.fillStyle = 'rgba(0,0,0,0.5)'
    ctx2d.fillRect(0, 0, sx, H)
  }
  // Dim after end
  const ex = (p.value.endOffset ?? 1) * W
  if (ex < W - 1) {
    ctx2d.fillStyle = 'rgba(0,0,0,0.5)'
    ctx2d.fillRect(ex, 0, W - ex, H)
  }

  // Centre line
  ctx2d.strokeStyle = 'rgba(255,255,255,0.1)'
  ctx2d.lineWidth = 1
  ctx2d.beginPath(); ctx2d.moveTo(0, mid); ctx2d.lineTo(W, mid); ctx2d.stroke()
}

watch([buf, () => ch.value?.id, () => ch.value?.color, displayChannel], () => nextTick(drawWaveform))
watch(() => [p.value.startOffset, p.value.endOffset, p.value.loopStart, p.value.loopEnd],
  () => nextTick(drawWaveform))

onMounted(() => { drawWaveform(); window.addEventListener('resize', drawWaveform) })
onBeforeUnmount(() => { window.removeEventListener('resize', drawWaveform); stopDrag() })

// ── Marker dragging ────────────────────────────────────────────────────────────
let _dragParam = null

function startDrag(param, e) {
  _dragParam = param
  window.addEventListener('mousemove', onDragMove)
  window.addEventListener('mouseup', onDragUp)
}

function fracFromEvent(e) {
  const rect = waveWrap.value?.getBoundingClientRect()
  if (!rect || rect.width === 0) return 0
  return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
}

function onDragMove(e) {
  if (!_dragParam || !ch.value) return
  const f = fracFromEvent(e)
  const q = p.value
  if (_dragParam === 'startOffset')  q.startOffset = Math.min(f, (q.endOffset ?? 1) - 0.002)
  if (_dragParam === 'endOffset')    q.endOffset   = Math.max(f, (q.startOffset ?? 0) + 0.002)
  if (_dragParam === 'loopStart')    q.loopStart   = Math.min(f, (q.loopEnd ?? 1) - 0.002)
  if (_dragParam === 'loopEnd')      q.loopEnd     = Math.max(f, (q.loopStart ?? 0) + 0.002)
  nextTick(drawWaveform)
}

function onDragUp() { stopDrag() }
function stopDrag() {
  _dragParam = null
  window.removeEventListener('mousemove', onDragMove)
  window.removeEventListener('mouseup', onDragUp)
}

// ── Root note clamp ────────────────────────────────────────────────────────────
function clampRoot() {
  if (!ch.value) return
  p.value.rootNote = Math.max(0, Math.min(127, Math.round(p.value.rootNote ?? 60)))
}

// ── File loading ───────────────────────────────────────────────────────────────
const AUDIO_EXT = /\.(wav|mp3|ogg|flac|aiff?)$/i

function onDragOver(e) {
  if ([...(e.dataTransfer?.items ?? [])].some(i => i.kind === 'file')) isDragOver.value = true
}
function onDragLeave() { isDragOver.value = false }

async function onDrop(e) {
  isDragOver.value = false
  const file = [...(e.dataTransfer?.files ?? [])].find(f => AUDIO_EXT.test(f.name))
  if (file && ch.value) { await loadAudioFileForChannel(ch.value.id, file); nextTick(drawWaveform) }
}

async function onFileInput(e) {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (file && ch.value) { await loadAudioFileForChannel(ch.value.id, file); nextTick(drawWaveform) }
}

function onNormalize() {
  if (ch.value) { normalizeAudioFile(ch.value.id); nextTick(drawWaveform) }
}

function doBuildXfade() {
  if (ch.value) { buildLoopXfade(ch.value.id) }
}

function doSnap(paramName) {
  if (ch.value) { snapToZero(ch.value.id, paramName); nextTick(drawWaveform) }
}
</script>

<style scoped>
.smp {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background: var(--bg-base);
  padding: 6px 8px 4px;
  gap: 5px;
  user-select: none;
}
.smp.smp-drag-over { outline: 2px solid #ff9f43; outline-offset: -2px; }

/* ── Top bar ─────────────────────────────────────────────────────────────── */
.smp-topbar {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: nowrap;
  flex-shrink: 0;
}
.smp-icon-btn {
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.14);
  border-radius: 3px;
  color: rgba(255,255,255,0.7);
  cursor: pointer;
  font-size: 11px;
  padding: 2px 6px;
  white-space: nowrap;
}
.smp-icon-btn:hover { background: rgba(255,255,255,0.12); }
.smp-filename {
  flex: 1;
  font-size: 11px;
  color: rgba(255,255,255,0.55);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.smp-duration {
  font-size: 10px;
  color: rgba(255,255,255,0.3);
  white-space: nowrap;
  flex-shrink: 0;
}
.smp-missing-badge {
  font-size: 10px;
  color: #f39c12;
  background: rgba(243,156,18,0.12);
  border: 1px solid rgba(243,156,18,0.3);
  border-radius: 3px;
  padding: 1px 5px;
  white-space: nowrap;
}

/* ── Waveform ────────────────────────────────────────────────────────────── */
.smp-wave-wrap {
  position: relative;
  height: 80px;
  flex-shrink: 0;
  border-radius: 4px;
  overflow: hidden;
  border: 1px solid rgba(255,255,255,0.1);
  cursor: crosshair;
}
.smp-canvas {
  display: block;
  width: 100%;
  height: 100%;
}

/* Handles */
.smp-handle {
  position: absolute;
  top: 0; bottom: 0;
  width: 3px;
  cursor: ew-resize;
  transform: translateX(-50%);
  z-index: 4;
  border-radius: 1px;
}
.smp-handle::after {
  content: '';
  position: absolute;
  top: 0; bottom: 0;
  left: -5px; right: -5px;
}
.smp-handle-start  { background: rgba(255,255,255,0.85); }
.smp-handle-end    { background: rgba(255,120,50,0.9); }
.smp-handle-loop-s { background: #2ecc71; }
.smp-handle-loop-e { background: #e74c3c; }

/* Loop region */
.smp-loop-region {
  position: absolute;
  top: 0; bottom: 0;
  background: rgba(46,204,113,0.12);
  border-left:  1px solid rgba(46,204,113,0.45);
  border-right: 1px solid rgba(231,76,60,0.45);
  pointer-events: none;
  z-index: 2;
}

/* ── Controls (3 columns) ────────────────────────────────────────────────── */
.smp-controls {
  display: flex;
  gap: 12px;
  flex: 1;
  overflow: hidden;
  min-height: 0;
}
.smp-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  overflow: hidden;
}
.smp-col-header {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: rgba(255,255,255,0.25);
  margin-bottom: 1px;
  text-transform: uppercase;
}
.smp-col-header-sub {
  margin-top: 4px;
  color: rgba(255,255,255,0.18);
}

/* Row layout */
.smp-row {
  display: flex;
  align-items: center;
  gap: 5px;
  min-height: 18px;
}
.smp-lbl {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: rgba(255,255,255,0.32);
  width: 32px;
  flex-shrink: 0;
  text-transform: uppercase;
}
.smp-slider {
  flex: 1;
  height: 3px;
  accent-color: #ff9f43;
  cursor: pointer;
  min-width: 0;
}
.smp-val {
  font-size: 9px;
  color: rgba(255,255,255,0.5);
  width: 36px;
  text-align: right;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}

/* Root note number input */
.smp-num {
  width: 36px;
  background: rgba(0,0,0,0.4);
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 3px;
  color: rgba(255,255,255,0.8);
  font-size: 10px;
  text-align: center;
  padding: 1px 2px;
}
.smp-note-name {
  font-size: 10px;
  color: rgba(255,255,255,0.4);
  width: 26px;
}

/* Segmented buttons */
.smp-group {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}
.smp-seg {
  display: flex;
}
.smp-seg button {
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.14);
  border-radius: 0;
  color: rgba(255,255,255,0.45);
  cursor: pointer;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.04em;
  padding: 2px 6px;
  transition: background 0.1s;
}
.smp-seg button:first-child { border-radius: 3px 0 0 3px; }
.smp-seg button:last-child  { border-radius: 0 3px 3px 0; }
.smp-seg button + button    { border-left: none; }
.smp-seg button:hover       { background: rgba(255,255,255,0.1); }
.smp-seg button.active      { background: rgba(255,159,67,0.25); color: #ff9f43; border-color: #ff9f43; }

.smp-seg-sm button { padding: 2px 4px; font-size: 8px; }

/* Mode button (REV) */
.smp-mode-btn {
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.14);
  border-radius: 3px;
  color: rgba(255,255,255,0.45);
  cursor: pointer;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 2px 7px;
  transition: background 0.12s;
  flex-shrink: 0;
}
.smp-mode-btn:hover  { background: rgba(255,255,255,0.1); }
.smp-mode-btn.active { background: rgba(255,159,67,0.25); color: #ff9f43; border-color: #ff9f43; }

/* ADSR mini visualizer */
.smp-adsr-vis {
  height: 36px;
  background: rgba(0,0,0,0.3);
  border-radius: 3px;
  overflow: hidden;
  flex-shrink: 0;
  margin-bottom: 2px;
}
.smp-adsr-vis svg {
  width: 100%;
  height: 100%;
}

/* Curve sub-rows */
.smp-row-curve {
  opacity: 0.65;
  min-height: 14px !important;
}
.smp-row-curve:hover { opacity: 1; }
.smp-crv-val {
  font-size: 8px !important;
  color: rgba(255,180,80,0.7) !important;
}

/* Loop tools bar */
.smp-loop-tools {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
  padding: 2px 0;
  border-top: 1px solid rgba(255,255,255,0.06);
  flex-wrap: wrap;
}
.smp-loop-snap-lbl {
  font-size: 9px;
  font-weight: 700;
  color: rgba(255,255,255,0.25);
  margin-left: 4px;
}
.smp-build-btn {
  color: #2ecc71 !important;
  border-color: rgba(46,204,113,0.3) !important;
}
.smp-xfade-badge {
  font-size: 8px;
  color: #2ecc71;
  background: rgba(46,204,113,0.1);
  border: 1px solid rgba(46,204,113,0.25);
  border-radius: 3px;
  padding: 1px 5px;
  white-space: nowrap;
}
</style>
