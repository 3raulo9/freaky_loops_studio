<template>
  <div class="mixer-panel" @click="closeMenus" @contextmenu.prevent>

    <!-- ── Header ─────────────────────────────────────────────────────────── -->
    <div class="mx-header">
      <span class="mx-title">MIXER</span>
      <span class="mx-hint">Route channels via the TRACK selector in the Channel Rack</span>
      <div class="mx-spacer" />
      <button class="mx-hdr-btn" :class="{ active: fxPanelOpen }"
        @click.stop="fxPanelOpen = !fxPanelOpen" title="Show/hide FX Inspector">
        FX
      </button>
      <div class="mx-master-vol-wrap">
        <span class="mx-mlabel">MASTER</span>
        <input type="range" class="mx-master-vol-slider"
          v-model.number="masterTrack.volume" min="0" max="1.25" step="0.005"
          @input="setMixerTrackVolume(0, masterTrack.volume)"
        />
        <span class="mx-master-db">{{ volToDb(masterTrack.volume) }}</span>
      </div>
    </div>

    <!-- ── Body: strips + FX panel ────────────────────────────────────────── -->
    <div class="mx-body">

      <!-- ── Strips ─────────────────────────────────────────────────────── -->
      <div class="mx-strips-scroll">
        <div class="mx-strips">

          <!-- Insert tracks -->
          <div
            v-for="(track, i) in insertTracks"
            :key="track.id"
            class="mx-strip"
            :class="{
              'mx-muted':    track.muted,
              'mx-soloed':   track._soloed,
              'mx-selected': selectedTrack === i + 1,
            }"
            :style="{ '--accent': track.color }"
            @mousedown="selectTrack(i + 1)"
            @contextmenu.stop="openCtxMenu($event, i + 1)"
          >
            <!-- Color accent bar -->
            <div class="mx-accent" :style="{ background: track.color }" />

            <!-- Channel routing dots -->
            <div class="mx-routes" :title="routeTitle(i + 1)">
              <span
                v-for="ch in getRoutedChannels(i + 1)"
                :key="ch.id"
                class="mx-dot"
                :style="{ background: ch.color }"
                :title="ch.name"
              />
              <span v-if="!getRoutedChannels(i + 1).length" class="mx-dot-empty" />
            </div>

            <!-- Name -->
            <div class="mx-name-area">
              <input
                v-if="renamingIdx === i + 1"
                class="mx-name-input"
                v-model="track.name"
                @blur="renamingIdx = -1"
                @keydown.enter.stop="renamingIdx = -1"
                @keydown.esc.stop="renamingIdx = -1"
                @click.stop
                maxlength="12"
                autofocus
              />
              <div v-else class="mx-name" @dblclick.stop="renamingIdx = i + 1"
                :style="{ color: track.color }"
                title="Double-click to rename">{{ track.name }}</div>
            </div>

            <!-- Dual stereo peak meter -->
            <div class="mx-meter">
              <div class="mx-meter-bars">
                <div class="mx-meter-col" @click.stop="clearClip(i + 1)"
                  :title="clipped[i + 1] ? 'Clipped — click to reset' : 'Peak meter'">
                  <div class="mx-meter-clip" :class="{ on: clipped[i + 1] }" />
                  <div class="mx-meter-fill"
                    :style="{ height: peakPct(i + 1) + '%', background: peakColor(peakLevels[i + 1]) }"
                  />
                  <div class="mx-meter-peak-hold"
                    :style="{ bottom: peakHoldPct(i + 1) + '%' }"
                  />
                </div>
                <div class="mx-meter-col mx-meter-col-r" @click.stop="clearClip(i + 1)">
                  <div class="mx-meter-fill"
                    :style="{ height: peakPct(i + 1) + '%', background: peakColor(peakLevels[i + 1]) }"
                  />
                </div>
              </div>
              <span class="mx-meter-db">{{ peakDb(i + 1) }}</span>
            </div>

            <!-- 3-band EQ -->
            <div class="mx-eq">
              <span class="mx-eq-label">EQ</span>
              <div class="mx-eq-bands">
                <div v-for="band in EQ_BANDS" :key="band.key" class="mx-eq-band">
                  <span class="mx-eq-bl">{{ band.label }}</span>
                  <div class="mx-eq-track">
                    <input type="range" class="mx-eq-slider"
                      v-model.number="track.eq[band.key]"
                      min="-12" max="12" step="0.5"
                      @input="setMixerEq(i + 1, band.key, track.eq[band.key])"
                      :title="`${band.label}: ${track.eq[band.key] > 0 ? '+' : ''}${Number(track.eq[band.key]).toFixed(1)} dB`"
                    />
                    <div class="mx-eq-zero" />
                  </div>
                  <span class="mx-eq-val"
                    :style="{ color: track.eq[band.key] !== 0 ? track.color : undefined }">
                    {{ track.eq[band.key] > 0 ? '+' : '' }}{{ Number(track.eq[band.key]).toFixed(0) }}
                  </span>
                </div>
              </div>
            </div>

            <!-- Strip controls row: phase invert + FX indicator -->
            <div class="mx-controls-row">
              <button
                class="mx-ctrl-btn"
                :class="{ active: track.phaseInvert }"
                @click.stop="toggleMixerPhaseInvert(i + 1)"
                title="Invert phase (Φ)"
              >Φ</button>
              <div class="mx-fx-indicator"
                :class="{ 'has-fx': (track.fxSlots ?? []).some(s => s && s.enabled) }"
                @click.stop="selectTrack(i + 1); fxPanelOpen = true"
                :title="fxSlotSummary(track)">
                FX<span v-if="activeFxCount(track) > 0" class="mx-fx-count">{{ activeFxCount(track) }}</span>
              </div>
            </div>

            <!-- Volume fader -->
            <div class="mx-fader-area">
              <div class="mx-fader-wrap">
                <div class="mx-fader-unity" />
                <input type="range" class="mx-fader"
                  v-model.number="track.volume"
                  min="0" max="1.25" step="0.005"
                  @input="setMixerTrackVolume(i + 1, track.volume)"
                  :title="`Volume: ${volToDb(track.volume)}`"
                />
              </div>
              <span class="mx-vol-db">{{ volToDb(track.volume) }}</span>
            </div>

            <!-- Pan -->
            <div class="mx-pan-area">
              <span class="mx-pan-lbl">PAN</span>
              <input type="range" class="mx-pan-slider"
                v-model.number="track.pan"
                min="-1" max="1" step="0.01"
                @input="setMixerTrackPan(i + 1, track.pan)"
                :title="`Pan: ${panLabel(track.pan)}`"
              />
              <span class="mx-pan-val"
                :style="{ color: track.pan !== 0 ? track.color : undefined }">
                {{ panLabel(track.pan) }}
              </span>
            </div>

            <!-- Mute / Solo -->
            <div class="mx-ms">
              <button class="mx-btn mx-mute-btn" :class="{ active: track.muted }"
                @click.stop="muteMixerTrack(i + 1)" title="Mute">M</button>
              <button class="mx-btn mx-solo-btn" :class="{ active: track._soloed }"
                @click.stop="soloMixerTrack(i + 1)" title="Solo">S</button>
            </div>

            <!-- Track number + reorder -->
            <div class="mx-track-num" :style="{ color: track.color }">
              <button class="mx-move-btn" @click.stop="moveTrack(i + 1, -1)" :disabled="i === 0" title="Move left (Alt+←)">◄</button>
              <span class="mx-num-txt">{{ String(i + 1).padStart(2, '0') }}</span>
              <button class="mx-move-btn" @click.stop="moveTrack(i + 1, 1)" :disabled="i === insertTracks.length - 1" title="Move right (Alt+→)">►</button>
            </div>
          </div>

          <!-- Master separator -->
          <div class="mx-sep" />

          <!-- Master strip -->
          <div class="mx-strip mx-master" :style="{ '--accent': '#e74c3c' }"
            @mousedown="selectTrack(0)"
            :class="{ 'mx-selected': selectedTrack === 0 }"
          >
            <div class="mx-accent" style="background:#e74c3c" />

            <div class="mx-routes" title="Channels routed to Master">
              <span
                v-for="ch in masterChannels"
                :key="ch.id"
                class="mx-dot"
                :style="{ background: ch.color }"
                :title="ch.name"
              />
              <span v-if="!masterChannels.length" class="mx-dot-empty" />
            </div>

            <div class="mx-name-area">
              <div class="mx-name mx-master-name">MASTER</div>
            </div>

            <!-- Master peak meter -->
            <div class="mx-meter">
              <div class="mx-meter-bars">
                <div class="mx-meter-col" @click.stop="clearClip(0)"
                  :title="clipped[0] ? 'Clipped — click to reset' : 'Master peak meter'">
                  <div class="mx-meter-clip" :class="{ on: clipped[0] }" />
                  <div class="mx-meter-fill"
                    :style="{ height: peakPct(0) + '%', background: peakColor(peakLevels[0]) }"
                  />
                  <div class="mx-meter-peak-hold"
                    :style="{ bottom: peakHoldPct(0) + '%' }"
                  />
                </div>
                <div class="mx-meter-col mx-meter-col-r" @click.stop="clearClip(0)">
                  <div class="mx-meter-fill"
                    :style="{ height: peakPct(0) + '%', background: peakColor(peakLevels[0]) }"
                  />
                </div>
              </div>
              <span class="mx-meter-db">{{ peakDb(0) }}</span>
            </div>

            <div class="mx-eq-spacer" />
            <div class="mx-controls-row" style="justify-content:center">
              <div class="mx-fx-indicator" style="opacity:0.3;cursor:default" title="Master FX chain not yet available">FX</div>
            </div>

            <div class="mx-fader-area">
              <div class="mx-fader-wrap">
                <div class="mx-fader-unity" />
                <input type="range" class="mx-fader"
                  v-model.number="masterTrack.volume"
                  min="0" max="1.25" step="0.005"
                  @input="setMixerTrackVolume(0, masterTrack.volume)"
                  :title="`Master Volume: ${volToDb(masterTrack.volume)}`"
                />
              </div>
              <span class="mx-vol-db">{{ volToDb(masterTrack.volume) }}</span>
            </div>

            <div class="mx-pan-area">
              <span class="mx-pan-lbl">PAN</span>
              <div class="mx-pan-center">C</div>
            </div>

            <div class="mx-ms">
              <button class="mx-btn mx-mute-btn" :class="{ active: masterTrack.muted }"
                @click.stop="muteMixerTrack(0)" title="Mute Master">M</button>
              <div class="mx-btn" style="opacity:0.2;cursor:default">S</div>
            </div>

            <div class="mx-track-num" style="color:#e74c3c">MST</div>
          </div>

        </div>
      </div>

      <!-- ── FX Inspector Panel ────────────────────────────────────────────── -->
      <div v-if="fxPanelOpen" class="mx-fx-panel" @click.stop>
        <div class="mx-fx-panel-header">
          <span class="mx-fx-panel-title">
            {{ selectedTrack === 0 ? 'MASTER' : (selectedInsert?.name ?? 'INSERT') }}
          </span>
          <span class="mx-fx-panel-sub">FX CHAIN</span>
          <button class="mx-fx-panel-close" @click="fxPanelOpen = false">✕</button>
        </div>

        <div class="mx-fx-list">
          <div
            v-for="(slot, si) in (currentFxTrack?.fxSlots ?? [])"
            :key="si"
            class="mx-fx-slot"
            :class="{ 'slot-disabled': slot && !slot.enabled, 'slot-expanded': expandedSlot === si }"
          >
            <div class="mx-fx-slot-row">
              <!-- Enable LED -->
              <button
                class="mx-fx-led"
                :class="{ active: slot?.enabled }"
                @click.stop="toggleMixerTrackFxEnabled(selectedTrack, si)"
                title="Enable/disable"
              />
              <!-- Slot name / click to expand -->
              <div class="mx-fx-slot-name" @click.stop="expandedSlot = expandedSlot === si ? -1 : si">
                {{ slot ? effectLabel(slot.type) : '— empty —' }}
              </div>
              <!-- Mix % for effects with mix param -->
              <span v-if="slot && hasMixParam(slot.type)" class="mx-fx-mix-val"
                :style="{ color: slot.mix > 0 ? '#a0c0ff' : undefined }">
                {{ Math.round((slot.mix ?? 1) * 100) }}%
              </span>
              <!-- Slot controls -->
              <div class="mx-fx-slot-btns">
                <button class="mx-fx-slot-btn" @click.stop="moveMixerTrackFxSlot(selectedTrack, si, -1)"
                  :disabled="si === 0" title="Move up">↑</button>
                <button class="mx-fx-slot-btn" @click.stop="moveMixerTrackFxSlot(selectedTrack, si, 1)"
                  :disabled="si === (currentFxTrack?.fxSlots?.length ?? 0) - 1" title="Move down">↓</button>
                <button class="mx-fx-slot-btn mx-fx-del" @click.stop="removeMixerTrackFx(selectedTrack, si)"
                  title="Remove effect">✕</button>
              </div>
            </div>

            <!-- Expanded params -->
            <div v-if="expandedSlot === si && slot" class="mx-fx-params">
              <div v-for="(defVal, key) in effectParamDefs(slot.type)" :key="key" class="mx-fx-param-row">
                <span class="mx-fx-param-lbl">{{ paramLabel(key) }}</span>
                <input type="range" class="mx-fx-param-slider"
                  v-model.number="slot[key]"
                  :min="paramMin(key)" :max="paramMax(key)" :step="paramStep(key)"
                  @input="updateMixerTrackFxParam(selectedTrack, si, key, slot[key])"
                />
                <span class="mx-fx-param-val">{{ fmtParam(key, slot[key]) }}</span>
              </div>
            </div>
          </div>

          <!-- Empty slots placeholder -->
          <div v-if="!(currentFxTrack?.fxSlots?.length)" class="mx-fx-empty">
            No effects loaded
          </div>
        </div>

        <!-- Add Effect button -->
        <div class="mx-fx-add-area">
          <button class="mx-fx-add-btn" @click.stop="showEffectPicker = !showEffectPicker">
            + Add Effect
          </button>
          <div v-if="showEffectPicker" class="mx-fx-picker" @click.stop>
            <div
              v-for="(def, type) in EFFECT_DEFS"
              :key="type"
              class="mx-fx-picker-item"
              @click.stop="pickEffect(type)"
            >{{ def.label }}</div>
          </div>
        </div>
      </div>

    </div>

    <!-- ── Context menu (rename / color) ─────────────────────────────────── -->
    <div v-if="ctxMenu.open" class="mx-ctx-menu"
      :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }"
      @click.stop
    >
      <div class="mx-ctx-item" @click="startRename(ctxMenu.trackIdx)">Rename...</div>
      <div class="mx-ctx-sep" />
      <div class="mx-ctx-colors">
        <div
          v-for="c in TRACK_COLORS"
          :key="c"
          class="mx-ctx-color"
          :style="{ background: c }"
          @click="pickColor(c)"
        />
      </div>
    </div>

  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount } from 'vue'
import { useStudio } from '../store/studio.js'

const {
  channels, mixerTracks, EFFECT_DEFS,
  setMixerTrackVolume, setMixerTrackPan, setMixerEq,
  muteMixerTrack, soloMixerTrack, getMixerAnalyser, moveMixerTrack,
  setMixerTrackColor, toggleMixerPhaseInvert,
  addMixerTrackFx, removeMixerTrackFx, updateMixerTrackFxParam,
  toggleMixerTrackFxEnabled, moveMixerTrackFxSlot,
} = useStudio()

const EQ_BANDS = [
  { key: 'low',  label: 'L' },
  { key: 'mid',  label: 'M' },
  { key: 'high', label: 'H' },
]

const TRACK_COLORS = [
  '#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#1abc9c',
  '#3498db', '#9b59b6', '#e91e8c', '#00bcd4', '#ff5722',
  '#8bc34a', '#607d8b', '#795548', '#ff9800', '#cddc39',
]

const masterTrack  = computed(() => mixerTracks[0])
const insertTracks = computed(() => mixerTracks.slice(1))

// ── Selection / rename ────────────────────────────────────────────────────
const selectedTrack = ref(-1)
const renamingIdx   = ref(-1)
const fxPanelOpen   = ref(false)
const expandedSlot  = ref(-1)
const showEffectPicker = ref(false)

const selectedInsert   = computed(() => selectedTrack.value >= 1 ? mixerTracks[selectedTrack.value] : null)
const currentFxTrack   = computed(() => selectedTrack.value >= 0 ? mixerTracks[selectedTrack.value] : null)

function selectTrack(i) { selectedTrack.value = i; expandedSlot.value = -1 }

function closeMenus() {
  renamingIdx.value = -1
  ctxMenu.open = false
  showEffectPicker.value = false
  expandedSlot.value = -1
}

// ── Context menu ──────────────────────────────────────────────────────────
const ctxMenu = reactive({ open: false, x: 0, y: 0, trackIdx: -1 })

function openCtxMenu(e, trackIdx) {
  ctxMenu.open = true
  ctxMenu.x = e.clientX
  ctxMenu.y = e.clientY
  ctxMenu.trackIdx = trackIdx
}

function startRename(trackIdx) {
  renamingIdx.value = trackIdx
  ctxMenu.open = false
}

function pickColor(c) {
  setMixerTrackColor(ctxMenu.trackIdx, c)
  ctxMenu.open = false
}

// ── Channel routing ───────────────────────────────────────────────────────
function getRoutedChannels(trackIdx) {
  return channels.filter(ch => ch.mixerTrack === trackIdx)
}
const masterChannels = computed(() => channels.filter(ch => !ch.mixerTrack))

function routeTitle(idx) {
  const chs = getRoutedChannels(idx)
  return chs.length ? chs.map(c => c.name).join(', ') : 'No channels routed here'
}

// ── FX helpers ────────────────────────────────────────────────────────────
function effectLabel(type) {
  return EFFECT_DEFS[type]?.label ?? type
}

function activeFxCount(track) {
  return (track?.fxSlots ?? []).filter(s => s && s.enabled).length
}

function fxSlotSummary(track) {
  const active = activeFxCount(track)
  if (!active) return 'No active effects — click to open FX panel'
  const names = (track?.fxSlots ?? []).filter(s => s?.enabled).map(s => effectLabel(s.type))
  return names.join(', ')
}

function hasMixParam(type) {
  return 'mix' in (EFFECT_DEFS[type]?.defaults ?? {})
}

function effectParamDefs(type) {
  return EFFECT_DEFS[type]?.defaults ?? {}
}

const PARAM_LABELS = {
  drive: 'Drive', tone: 'Tone', size: 'Size', decay: 'Decay',
  mix: 'Mix', time: 'Time', feedback: 'Feedback', rate: 'Rate',
  depth: 'Depth', threshold: 'Threshold', ratio: 'Ratio', value: 'Gain',
  width: 'Width',
}
function paramLabel(key) { return PARAM_LABELS[key] ?? key }

function paramMin(key) {
  if (key === 'ratio') return 1
  if (key === 'value') return 0
  return 0
}
function paramMax(key) {
  if (key === 'ratio') return 20
  if (key === 'value') return 1.25
  if (key === 'time')  return 2
  return 1
}
function paramStep(key) {
  if (key === 'ratio') return 0.5
  if (key === 'time')  return 0.01
  return 0.01
}
function fmtParam(key, val) {
  if (key === 'mix' || key === 'drive' || key === 'depth' || key === 'width')
    return Math.round(val * 100) + '%'
  if (key === 'tone') return Math.round(val * 100) + '%'
  if (key === 'size' || key === 'decay') return Math.round(val * 100) + '%'
  if (key === 'rate') return (val * 5 + 0.1).toFixed(1) + 'Hz'
  if (key === 'feedback') return Math.round(val * 100) + '%'
  if (key === 'threshold') return (val * 60 - 60).toFixed(0) + 'dB'
  if (key === 'ratio') return val.toFixed(1) + ':1'
  if (key === 'time') return (val * 1000).toFixed(0) + 'ms'
  if (key === 'value') return volToDb(val)
  return Number(val).toFixed(2)
}

function pickEffect(type) {
  addMixerTrackFx(selectedTrack.value, type)
  showEffectPicker.value = false
}

// ── Track re-ordering ─────────────────────────────────────────────────────
function moveTrack(i, dir) { if (moveMixerTrack(i, dir)) selectedTrack.value = i + dir }

function onKey(e) {
  if (selectedTrack.value < 1) return
  if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    e.preventDefault()
    moveTrack(selectedTrack.value, e.key === 'ArrowLeft' ? -1 : 1)
  }
}

// ── Peak meters ───────────────────────────────────────────────────────────
const NUM_TRACKS = mixerTracks.length
const peakLevels = ref(Array(NUM_TRACKS).fill(0))
const peakHolds  = ref(Array(NUM_TRACKS).fill(0))
const clipped    = ref(Array(NUM_TRACKS).fill(false))
const holdTimers = Array(NUM_TRACKS).fill(0)
const clipTimers = Array(NUM_TRACKS).fill(0)

const DECAY_DB_S = 20
const HOLD_MS    = 1500
const CLIP_MS    = 1500

let meterBufs = null
let meterRaf  = null
let lastT     = performance.now()

function updateMeters() {
  const now = performance.now()
  const dt  = Math.min(0.1, (now - lastT) / 1000); lastT = now
  const decay = Math.pow(10, -(DECAY_DB_S * dt) / 20)
  if (!meterBufs) meterBufs = Array(NUM_TRACKS).fill(null)

  for (let i = 0; i < NUM_TRACKS; i++) {
    const an = getMixerAnalyser(i)
    if (!an) continue
    if (!meterBufs[i] || meterBufs[i].length !== an.fftSize) meterBufs[i] = new Float32Array(an.fftSize)
    an.getFloatTimeDomainData(meterBufs[i])
    const buf = meterBufs[i]
    let peak = 0
    for (let s = 0; s < buf.length; s++) { const a = Math.abs(buf[s]); if (a > peak) peak = a }

    peakLevels.value[i] = Math.max(peak, peakLevels.value[i] * decay)
    if (peak >= peakHolds.value[i]) { peakHolds.value[i] = peak; holdTimers[i] = now }
    else if (now - holdTimers[i] > HOLD_MS) peakHolds.value[i] = Math.max(0, peakHolds.value[i] * decay)
    if (peak > 1.0) { clipped.value[i] = true; clipTimers[i] = now }
    else if (clipped.value[i] && now - clipTimers[i] > CLIP_MS) clipped.value[i] = false
  }
  meterRaf = requestAnimationFrame(updateMeters)
}
function clearClip(idx) { clipped.value[idx] = false }

onMounted(() => {
  meterRaf = requestAnimationFrame(updateMeters)
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  cancelAnimationFrame(meterRaf)
  window.removeEventListener('keydown', onKey)
})

// ── Meter geometry ────────────────────────────────────────────────────────
const DB_MIN = -48, DB_MAX = 6
function dbToPct(v) {
  if (v <= 0) return 0
  const db = 20 * Math.log10(v)
  return Math.max(0, Math.min(100, (db - DB_MIN) / (DB_MAX - DB_MIN) * 100))
}
function peakPct(idx)     { return dbToPct(peakLevels.value[idx]).toFixed(1) }
function peakHoldPct(idx) { return dbToPct(peakHolds.value[idx]).toFixed(1) }
function peakColor(level) {
  if (level > 0.9)  return '#e74c3c'
  if (level > 0.55) return '#f39c12'
  return '#2ecc71'
}
function peakDb(idx) {
  const v = peakLevels.value[idx]
  if (v <= 0.001) return '-∞'
  return (20 * Math.log10(v)).toFixed(1)
}

// ── Volume / Pan ──────────────────────────────────────────────────────────
function volToDb(v) {
  if (v <= 0.001) return '-∞'
  const db = 20 * Math.log10(v)
  return (db >= 0 ? '+' : '') + db.toFixed(1) + ' dB'
}
function panLabel(p) {
  if (Math.abs(p) < 0.01) return 'C'
  const pct = Math.round(Math.abs(p) * 100)
  return p < 0 ? `L${pct}` : `R${pct}`
}
</script>

<style scoped>
/* ── Panel ──────────────────────────────────────────────────────────────── */
.mixer-panel {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: var(--bg-base);
  overflow: hidden;
  user-select: none;
}

/* ── Header ─────────────────────────────────────────────────────────────── */
.mx-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 5px 12px;
  background: var(--bg-header);
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}
.mx-title {
  font-family: 'Rajdhani', sans-serif;
  font-size: 11px; font-weight: 700; letter-spacing: 0.2em;
  color: var(--text-muted); text-transform: uppercase;
}
.mx-hint {
  font-family: 'Share Tech Mono', monospace;
  font-size: 8px; color: var(--text-muted);
}
.mx-spacer { flex: 1; }
.mx-hdr-btn {
  font-family: 'Rajdhani', sans-serif;
  font-size: 9px; font-weight: 700; letter-spacing: 0.1em;
  padding: 2px 8px;
  border: 1px solid var(--border-subtle);
  background: transparent;
  color: var(--text-muted);
  border-radius: 3px; cursor: pointer;
  transition: all 0.1s;
}
.mx-hdr-btn:hover { border-color: #5080c0; color: #5080c0; }
.mx-hdr-btn.active { border-color: #5080c0; color: #5080c0; background: #0d1520; box-shadow: 0 0 6px #5080c044; }

.mx-master-vol-wrap {
  display: flex; align-items: center; gap: 6px;
}
.mx-mlabel {
  font-family: 'Rajdhani', sans-serif;
  font-size: 8px; font-weight: 700; letter-spacing: 0.1em;
  color: var(--text-muted); text-transform: uppercase;
}
.mx-master-vol-slider { width: 80px; accent-color: #e74c3c; cursor: pointer; }
.mx-master-db {
  font-family: 'Share Tech Mono', monospace;
  font-size: 9px; color: #e74c3c; min-width: 54px;
}

/* ── Body ───────────────────────────────────────────────────────────────── */
.mx-body {
  display: flex;
  flex: 1;
  overflow: hidden;
  min-height: 0;
}

/* ── Strips scroll ──────────────────────────────────────────────────────── */
.mx-strips-scroll {
  flex: 1;
  overflow-x: auto;
  overflow-y: hidden;
  min-width: 0;
}
.mx-strips {
  display: flex;
  height: 100%;
  align-items: stretch;
  padding: 0 6px;
  gap: 2px;
  min-width: max-content;
}

/* ── Strip ──────────────────────────────────────────────────────────────── */
.mx-strip {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 78px;
  min-width: 78px;
  background: var(--bg-panel);
  border: 1px solid var(--border-subtle);
  border-top: none;
  padding: 0 4px 6px;
  gap: 4px;
  transition: background 0.1s;
  position: relative;
  cursor: pointer;
}
.mx-strip:hover { background: var(--bg-hover); }
.mx-strip.mx-muted { opacity: 0.4; }
.mx-strip.mx-soloed { background: var(--bg-hover); }
.mx-strip.mx-selected {
  background: var(--bg-hover);
  box-shadow: inset 0 0 0 1px var(--accent, #5060a0);
}

.mx-master {
  width: 84px; min-width: 84px;
  background: #0f0909;
  border-color: #2a1010;
}
.mx-master:hover { background: #120b0b; }

/* ── Accent bar ─────────────────────────────────────────────────────────── */
.mx-accent { width: 100%; height: 3px; flex-shrink: 0; }

/* ── Routing dots ───────────────────────────────────────────────────────── */
.mx-routes {
  display: flex; flex-wrap: wrap; justify-content: center;
  gap: 2px; min-height: 10px; padding: 2px 0;
}
.mx-dot {
  width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0;
}
.mx-dot-empty {
  width: 7px; height: 7px; border-radius: 50%; background: var(--bg-track);
}

/* ── Name ───────────────────────────────────────────────────────────────── */
.mx-name-area { width: 100%; display: flex; justify-content: center; }
.mx-name {
  font-family: 'Rajdhani', sans-serif;
  font-size: 9px; font-weight: 700; letter-spacing: 0.1em;
  color: var(--accent, #5050a0);
  text-transform: uppercase;
  text-align: center; cursor: pointer;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; width: 100%;
}
.mx-master-name { color: #e74c3c; cursor: default; }
.mx-name-input {
  font-family: 'Rajdhani', sans-serif;
  font-size: 9px; font-weight: 700; letter-spacing: 0.08em;
  background: var(--bg-deeper); border: 1px solid var(--border);
  color: var(--accent, #7070c0);
  width: 100%; text-align: center; padding: 1px 2px; border-radius: 2px; outline: none;
}

/* ── Peak meter ─────────────────────────────────────────────────────────── */
.mx-meter {
  display: flex; flex-direction: column; align-items: center; gap: 2px; width: 100%;
}
.mx-meter-bars {
  display: flex; gap: 2px; justify-content: center;
}
.mx-meter-col {
  width: 10px; height: 96px;
  background: var(--bg-deeper);
  border: 1px solid var(--border-subtle);
  border-radius: 2px;
  overflow: hidden;
  position: relative;
  display: flex; flex-direction: column; justify-content: flex-end;
  cursor: pointer;
}
.mx-meter-col-r { border-left: none; border-radius: 0 2px 2px 0; }
.mx-meter-fill {
  width: 100%;
  transition: height 0.06s ease-out;
}
.mx-meter-peak-hold {
  position: absolute; left: 0; right: 0; height: 2px;
  background: rgba(255,255,255,0.5);
}
.mx-meter-clip {
  position: absolute; top: 0; left: 0; right: 0; height: 5px; z-index: 2;
  background: #1a0505; border-bottom: 1px solid var(--border-subtle);
  transition: background 0.15s, box-shadow 0.15s;
}
.mx-meter-clip.on {
  background: #ff2222;
  box-shadow: 0 0 7px #ff2222cc, inset 0 0 2px #fff6;
}
.mx-meter-db {
  font-family: 'Share Tech Mono', monospace;
  font-size: 7px; color: var(--text-muted); text-align: center;
}

/* ── EQ section ─────────────────────────────────────────────────────────── */
.mx-eq { width: 100%; display: flex; flex-direction: column; align-items: center; gap: 2px; }
.mx-eq-label {
  font-family: 'Rajdhani', sans-serif;
  font-size: 7px; font-weight: 700; letter-spacing: 0.15em; color: var(--text-muted);
}
.mx-eq-bands { display: flex; flex-direction: column; gap: 2px; width: 100%; }
.mx-eq-band { display: flex; align-items: center; gap: 2px; }
.mx-eq-bl {
  font-family: 'Rajdhani', sans-serif;
  font-size: 8px; font-weight: 700; color: var(--text-muted); width: 9px; text-align: center;
}
.mx-eq-track { flex: 1; position: relative; }
.mx-eq-zero {
  position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
  width: 1px; height: 8px; background: var(--border-subtle); pointer-events: none;
}
.mx-eq-slider { width: 100%; height: 3px; accent-color: var(--accent, #6060a0); cursor: pointer; }
.mx-eq-val {
  font-family: 'Share Tech Mono', monospace;
  font-size: 7px; color: var(--text-muted); min-width: 14px; text-align: right;
}
.mx-eq-spacer { height: 78px; }

/* ── Controls row (phase invert, FX indicator) ──────────────────────────── */
.mx-controls-row {
  display: flex; align-items: center; gap: 4px; width: 100%;
}
.mx-ctrl-btn {
  width: 22px; height: 16px;
  font-family: 'Rajdhani', sans-serif; font-size: 10px; font-weight: 700;
  border: 1px solid var(--border-subtle); border-radius: 2px;
  background: transparent; color: var(--text-muted); cursor: pointer;
  transition: all 0.1s;
}
.mx-ctrl-btn:hover { border-color: #a0c0ff; color: #a0c0ff; }
.mx-ctrl-btn.active {
  border-color: #a0c0ff; color: #a0c0ff; background: #0d1520;
  box-shadow: 0 0 5px #a0c0ff44;
}
.mx-fx-indicator {
  flex: 1; height: 16px;
  display: flex; align-items: center; justify-content: center; gap: 2px;
  font-family: 'Rajdhani', sans-serif; font-size: 8px; font-weight: 700;
  letter-spacing: 0.08em;
  border: 1px solid var(--border-subtle); border-radius: 2px;
  color: var(--text-muted); cursor: pointer; transition: all 0.1s;
}
.mx-fx-indicator:hover { border-color: #5080c0; color: #5080c0; }
.mx-fx-indicator.has-fx {
  border-color: #5080c0; color: #5080c0; background: #0d1520;
}
.mx-fx-count {
  font-family: 'Share Tech Mono', monospace;
  font-size: 8px; background: #5080c0; color: #fff;
  border-radius: 8px; padding: 0 3px; min-width: 12px; text-align: center;
}

/* ── Volume fader ───────────────────────────────────────────────────────── */
.mx-fader-area {
  display: flex; flex-direction: column; align-items: center; gap: 2px; width: 100%; flex: 1;
}
.mx-fader-wrap {
  position: relative; width: 36px; display: flex; align-items: center;
  justify-content: center; flex: 1;
}
.mx-fader-unity {
  position: absolute; width: 30px; height: 1px; background: var(--border-subtle);
  top: calc(100% - (80% * 1)); pointer-events: none;
}
.mx-fader {
  width: 100%; writing-mode: vertical-lr; direction: rtl;
  height: 100%; min-height: 70px; accent-color: var(--accent, #6060a0); cursor: pointer;
}
.mx-vol-db {
  font-family: 'Share Tech Mono', monospace;
  font-size: 8px; color: var(--text-muted); text-align: center; min-width: 54px;
}

/* ── Pan ────────────────────────────────────────────────────────────────── */
.mx-pan-area { display: flex; align-items: center; gap: 3px; width: 100%; }
.mx-pan-lbl {
  font-family: 'Rajdhani', sans-serif; font-size: 7px; font-weight: 700;
  color: var(--text-muted); flex-shrink: 0;
}
.mx-pan-slider { flex: 1; height: 3px; accent-color: var(--accent, #6060a0); cursor: pointer; }
.mx-pan-val {
  font-family: 'Share Tech Mono', monospace;
  font-size: 7px; color: var(--text-muted); min-width: 22px; text-align: right;
}
.mx-pan-center {
  font-family: 'Share Tech Mono', monospace;
  font-size: 8px; color: var(--text-muted); flex: 1; text-align: center;
}

/* ── Mute / Solo ────────────────────────────────────────────────────────── */
.mx-ms { display: flex; gap: 3px; }
.mx-btn {
  width: 24px; height: 18px;
  font-family: 'Rajdhani', sans-serif; font-size: 9px; font-weight: 700;
  border-radius: 3px; border: 1px solid var(--border-subtle);
  background: transparent; color: var(--text-muted); cursor: pointer;
  transition: all 0.1s; outline: none;
  display: flex; align-items: center; justify-content: center;
}
.mx-mute-btn:hover { border-color: #e74c3c; color: #e74c3c; }
.mx-mute-btn.active { border-color: #e74c3c; color: #e74c3c; background: #1a0505; box-shadow: 0 0 6px #e74c3c44; }
.mx-solo-btn:hover { border-color: #f39c12; color: #f39c12; }
.mx-solo-btn.active { border-color: #f39c12; color: #f39c12; background: #1a0e00; box-shadow: 0 0 6px #f39c1244; }

/* ── Track number ───────────────────────────────────────────────────────── */
.mx-track-num {
  display: flex; align-items: center; justify-content: center; gap: 3px;
  font-family: 'Share Tech Mono', monospace; font-size: 9px; letter-spacing: 0.05em;
}
.mx-num-txt { min-width: 16px; text-align: center; }
.mx-move-btn {
  width: 13px; height: 13px;
  display: flex; align-items: center; justify-content: center;
  background: transparent; border: 1px solid var(--border-subtle); border-radius: 2px;
  color: var(--text-muted); font-size: 7px; cursor: pointer; padding: 0;
  transition: all 0.1s;
}
.mx-move-btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.mx-move-btn:disabled { opacity: 0.25; cursor: default; }

/* ── Master separator ───────────────────────────────────────────────────── */
.mx-sep {
  width: 1px; align-self: stretch; background: var(--border-subtle); margin: 8px 4px; flex-shrink: 0;
}

/* ── FX Inspector Panel ─────────────────────────────────────────────────── */
.mx-fx-panel {
  width: 220px;
  min-width: 220px;
  background: #0c0f14;
  border-left: 1px solid var(--border-subtle);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.mx-fx-panel-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: #0f1218;
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}
.mx-fx-panel-title {
  font-family: 'Rajdhani', sans-serif;
  font-size: 10px; font-weight: 700; letter-spacing: 0.12em;
  color: #a0c0ff; text-transform: uppercase;
  flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.mx-fx-panel-sub {
  font-family: 'Rajdhani', sans-serif;
  font-size: 8px; letter-spacing: 0.1em; color: var(--text-muted);
}
.mx-fx-panel-close {
  background: transparent; border: none; color: var(--text-muted);
  cursor: pointer; font-size: 10px; padding: 0 2px; line-height: 1;
}
.mx-fx-panel-close:hover { color: #e74c3c; }

.mx-fx-list {
  flex: 1; overflow-y: auto; overflow-x: hidden;
  padding: 4px 0;
}
.mx-fx-slot {
  border-bottom: 1px solid #161b24;
  transition: background 0.1s;
}
.mx-fx-slot:hover { background: #111620; }
.mx-fx-slot.slot-disabled { opacity: 0.45; }

.mx-fx-slot-row {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 8px;
}
.mx-fx-led {
  width: 10px; height: 10px;
  border-radius: 50%;
  border: 1px solid #334;
  background: #1a1a22;
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.1s;
}
.mx-fx-led.active {
  background: #2ecc71;
  border-color: #2ecc71;
  box-shadow: 0 0 5px #2ecc7166;
}
.mx-fx-slot-name {
  flex: 1;
  font-family: 'Share Tech Mono', monospace;
  font-size: 9px; color: var(--text-dim, #888);
  cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  transition: color 0.1s;
}
.mx-fx-slot-name:hover { color: #c0d8ff; }
.mx-fx-mix-val {
  font-family: 'Share Tech Mono', monospace;
  font-size: 8px; color: var(--text-muted); min-width: 28px; text-align: right;
}
.mx-fx-slot-btns {
  display: flex; gap: 2px;
}
.mx-fx-slot-btn {
  width: 16px; height: 16px;
  display: flex; align-items: center; justify-content: center;
  background: transparent; border: 1px solid #2a2e38; border-radius: 2px;
  color: var(--text-muted); font-size: 9px; cursor: pointer;
  transition: all 0.1s;
}
.mx-fx-slot-btn:hover:not(:disabled) { border-color: #5080c0; color: #5080c0; }
.mx-fx-slot-btn:disabled { opacity: 0.2; cursor: default; }
.mx-fx-del:hover:not(:disabled) { border-color: #e74c3c !important; color: #e74c3c !important; }

/* Expanded params */
.mx-fx-params {
  padding: 4px 8px 8px;
  background: #090c11;
  border-top: 1px solid #161b24;
}
.mx-fx-param-row {
  display: flex; align-items: center; gap: 5px; margin-bottom: 4px;
}
.mx-fx-param-lbl {
  font-family: 'Rajdhani', sans-serif;
  font-size: 8px; font-weight: 700; letter-spacing: 0.08em;
  color: var(--text-muted); width: 54px; text-align: right; flex-shrink: 0;
}
.mx-fx-param-slider {
  flex: 1; height: 3px; accent-color: #5080c0; cursor: pointer;
}
.mx-fx-param-val {
  font-family: 'Share Tech Mono', monospace;
  font-size: 8px; color: #a0c0ff; min-width: 38px; text-align: right;
}

.mx-fx-empty {
  font-family: 'Share Tech Mono', monospace;
  font-size: 9px; color: var(--text-muted);
  text-align: center; padding: 16px 0; opacity: 0.5;
}

/* Add effect button + picker */
.mx-fx-add-area {
  flex-shrink: 0; padding: 8px; border-top: 1px solid var(--border-subtle);
  position: relative;
}
.mx-fx-add-btn {
  width: 100%;
  font-family: 'Rajdhani', sans-serif; font-size: 9px; font-weight: 700; letter-spacing: 0.1em;
  padding: 5px 0;
  border: 1px dashed #334455; border-radius: 3px;
  background: transparent; color: #5080c0; cursor: pointer;
  transition: all 0.15s;
}
.mx-fx-add-btn:hover { border-color: #5080c0; background: #0d1520; color: #a0c0ff; }
.mx-fx-picker {
  position: absolute; bottom: calc(100% - 2px); left: 8px; right: 8px;
  background: #0e1420; border: 1px solid #334; border-radius: 4px;
  overflow: hidden; z-index: 100; box-shadow: 0 -4px 16px #00000066;
}
.mx-fx-picker-item {
  font-family: 'Share Tech Mono', monospace; font-size: 9px;
  padding: 6px 10px; color: var(--text-muted); cursor: pointer;
  transition: all 0.1s; border-bottom: 1px solid #161b24;
}
.mx-fx-picker-item:last-child { border-bottom: none; }
.mx-fx-picker-item:hover { background: #1a2030; color: #a0c0ff; }

/* ── Context menu ───────────────────────────────────────────────────────── */
.mx-ctx-menu {
  position: fixed; z-index: 9999;
  background: #0e1420; border: 1px solid #334;
  border-radius: 4px; padding: 4px 0;
  box-shadow: 0 4px 20px #00000080;
  min-width: 140px;
}
.mx-ctx-item {
  font-family: 'Rajdhani', sans-serif; font-size: 10px; font-weight: 600;
  letter-spacing: 0.06em; color: var(--text-dim, #888); padding: 5px 12px;
  cursor: pointer; transition: all 0.1s;
}
.mx-ctx-item:hover { background: #1a2030; color: #c0d8ff; }
.mx-ctx-sep { height: 1px; background: #1e2535; margin: 3px 0; }
.mx-ctx-colors {
  display: flex; flex-wrap: wrap; gap: 4px; padding: 6px 8px;
}
.mx-ctx-color {
  width: 16px; height: 16px; border-radius: 3px;
  cursor: pointer; transition: transform 0.1s;
  border: 1px solid transparent;
}
.mx-ctx-color:hover { transform: scale(1.2); border-color: #fff4; }
</style>
