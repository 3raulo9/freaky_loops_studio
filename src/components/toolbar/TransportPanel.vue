<template>
  <div class="tb-group">
    <div class="tb-group-label">TRANSPORT</div>
    <div class="tb-row">

      <!-- Stop — right-click for Remember Seek Time -->
      <button
        class="tb-btn tb-stop"
        v-hint="'transport.stop'"
        @click="stopPlay"
        @contextmenu.prevent.stop="openStopMenu"
      >■</button>

      <button
        class="tb-btn tb-play"
        :class="{ active: isPlaying, arming: transportState === 'arming' }"
        v-hint="'transport.play'"
        @click="togglePlay"
      >{{ playGlyph }}</button>

      <!-- Record — armed/warning states + right-click filter menu -->
      <button
        class="tb-btn tb-rec"
        :class="{
          armed: recordArmed,
          warn:  recordWarning,
          flash: flashOn,
          idlepulse: recordArmed && !isPlaying,
        }"
        :style="recordArmed && !isPlaying ? { animationDuration: beatSeconds + 's' } : null"
        v-hint="recordWarning ? 'transport.recwarn' : 'transport.rec'"
        @click="toggleRecordArm"
        @contextmenu.prevent.stop="openRecMenu"
      >⏺</button>

      <!-- Recording Blend toggle (Ctrl+B): overdub vs overwrite -->
      <button
        class="tb-btn tb-blend"
        :class="{ active: recordBlend }"
        v-hint="'transport.blend'"
        title="Recording Blend (Ctrl+B) — ON: overdub over existing notes · OFF: overwrite existing notes on record"
        @click="recordBlend = !recordBlend"
      >⊕</button>

      <!-- Loop Record toggle -->
      <button
        class="tb-btn tb-loop-rec"
        :class="{ active: loopRecord }"
        v-hint="'transport.looprec'"
        @click="loopRecord = !loopRecord"
        :title="loopRecord ? 'Loop Record ON — overdub within loop (click to disable)' : 'Loop Record OFF — infinite take (click to enable)'"
      >↺</button>
    </div>

    <!-- Stop button right-click menu -->
    <div
      v-if="stopMenu.open"
      class="rec-menu"
      :style="{ left: stopMenu.x + 'px', top: stopMenu.y + 'px' }"
      @click.stop
    >
      <div class="rec-menu-title">STOP OPTIONS</div>
      <div class="rec-menu-item" :class="{ on: rememberSeekTime }" @click="rememberSeekTime = !rememberSeekTime">
        <span class="rec-menu-box">{{ rememberSeekTime ? '☑' : '☐' }}</span>Remember seek time
      </div>
    </div>

    <!-- Record right-click filter + options menu -->
    <div
      v-if="recMenu.open"
      class="rec-menu"
      :style="{ left: recMenu.x + 'px', top: recMenu.y + 'px' }"
      @click.stop
    >
      <div class="rec-menu-title">RECORD FILTER</div>
      <div
        v-for="f in FILTER_LIST"
        :key="f.flag"
        class="rec-menu-item"
        :class="{ on: (recordFilters & f.flag) !== 0 }"
        @click="toggleRecordFilter(f.flag)"
      >
        <span class="rec-menu-box">{{ (recordFilters & f.flag) ? '☑' : '☐' }}</span>
        {{ f.label }}
      </div>
      <div v-if="recordFilters === 0" class="rec-menu-note">Arm at least one to record</div>

      <div class="rec-menu-sep" />
      <div class="rec-menu-title">OPTIONS</div>
      <div class="rec-menu-item" :class="{ on: recordStartsPlayback }" @click="recordStartsPlayback = !recordStartsPlayback">
        <span class="rec-menu-box">{{ recordStartsPlayback ? '☑' : '☐' }}</span>Recording starts playback
      </div>
      <div class="rec-menu-item" :class="{ on: disarmOnStop }" @click="disarmOnStop = !disarmOnStop">
        <span class="rec-menu-box">{{ disarmOnStop ? '☑' : '☐' }}</span>Disarm on stop
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useStudio } from '../../store/studio.js'

const {
  isPlaying, togglePlay, stopPlay,
  transportState, beatTick, bpm,
  RECORD_FLAGS, recordFilters, recordArmed, recordWarning,
  toggleRecordFilter, toggleRecordArm, loopRecord,
  recordBlend, disarmOnStop, recordStartsPlayback, rememberSeekTime,
} = useStudio()

const FILTER_LIST = [
  { flag: RECORD_FLAGS.NOTES,      label: 'Notes' },
  { flag: RECORD_FLAGS.AUDIO,      label: 'Audio' },
  { flag: RECORD_FLAGS.AUTOMATION, label: 'Automation' },
  { flag: RECORD_FLAGS.CLIPS,      label: 'Clips' },
]

const playGlyph = computed(() =>
  transportState.value === 'arming' ? '⋯' : isPlaying.value ? '⏸' : '▶'
)

// ── Metronome flash ───────────────────────────────────────────────────────────
const beatSeconds = computed(() => 60 / bpm.value)
const flashOn = ref(false)
let flashTimer = null
watch(beatTick, () => {
  if (!recordArmed.value) return
  flashOn.value = true
  clearTimeout(flashTimer)
  flashTimer = setTimeout(() => { flashOn.value = false }, 90)
})

// ── Keyboard shortcuts ────────────────────────────────────────────────────────
function onKey(e) {
  const t = e.target
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
  if (e.ctrlKey && e.key === 'b') { e.preventDefault(); recordBlend.value = !recordBlend.value }
}

// ── Context menus ─────────────────────────────────────────────────────────────
const stopMenu = ref({ open: false, x: 0, y: 0 })
const recMenu  = ref({ open: false, x: 0, y: 0 })

function openStopMenu(e) {
  recMenu.value.open = false
  stopMenu.value = { open: true, x: e.clientX, y: e.clientY }
}
function openRecMenu(e) {
  stopMenu.value.open = false
  recMenu.value = { open: true, x: e.clientX, y: e.clientY }
}
function onGlobalDown(e) {
  if (stopMenu.value.open && !e.target.closest('.rec-menu')) stopMenu.value.open = false
  if (recMenu.value.open  && !e.target.closest('.rec-menu')) recMenu.value.open  = false
}

onMounted(() => {
  window.addEventListener('pointerdown', onGlobalDown, true)
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', onGlobalDown, true)
  window.removeEventListener('keydown', onKey)
  clearTimeout(flashTimer)
})
</script>

<style scoped>
.tb-play.arming {
  border-color: #f39c12 !important;
  color: #f39c12 !important;
  animation: tb-arming 0.5s ease-in-out infinite;
}
@keyframes tb-arming {
  0%, 100% { box-shadow: 0 0 4px #f39c1233; }
  50%      { box-shadow: 0 0 11px #f39c12aa; }
}

/* ── Record button ─────────────────────────────────────────────────────────── */
.tb-rec { cursor: pointer; opacity: 1; }
.tb-rec:hover { border-color: #e74c3c; color: #c0392b; }
.tb-rec.armed { background: #200a0a; border-color: #e74c3c; color: #e74c3c; }
.tb-rec.flash {
  background: #e74c3c; color: #fff;
  box-shadow: 0 0 12px #e74c3ccc;
}
.tb-rec.idlepulse { animation: tb-rec-pulse 1s ease-in-out infinite; }
@keyframes tb-rec-pulse {
  0%, 100% { box-shadow: 0 0 3px #e74c3c44; color: #e74c3c; }
  50%      { box-shadow: 0 0 12px #e74c3ccc; color: #ff6f5e; }
}
.tb-rec.warn { animation: tb-rec-warn 0.4s; }
@keyframes tb-rec-warn {
  0%, 100% { transform: translateX(0); }
  25%      { transform: translateX(-3px); border-color: #e74c3c; }
  75%      { transform: translateX(3px);  border-color: #e74c3c; }
}

/* ── Blend button ──────────────────────────────────────────────────────────── */
.tb-blend { font-size: 14px; opacity: 0.35; transition: all 0.15s; }
.tb-blend:hover { opacity: 0.7; border-color: #9b59b655; }
.tb-blend.active { opacity: 1; color: #9b59b6; border-color: #9b59b688; background: #160b1e; }

/* ── Loop Record button ────────────────────────────────────────────────────── */
.tb-loop-rec { font-size: 14px; opacity: 0.35; transition: all 0.15s; }
.tb-loop-rec:hover { opacity: 0.7; border-color: #e74c3c55; }
.tb-loop-rec.active { opacity: 1; color: #e74c3c; border-color: #e74c3c88; background: #200a0a; }

/* ── Menus ─────────────────────────────────────────────────────────────────── */
.rec-menu {
  position: fixed; z-index: 9999; min-width: 200px;
  background: var(--bg-control); border: 1px solid var(--border);
  border-radius: 6px; padding: 4px; box-shadow: 0 6px 24px #000000a0;
}
.rec-menu-title {
  padding: 4px 9px 5px;
  font-family: 'Rajdhani', sans-serif; font-size: 9px; font-weight: 700;
  letter-spacing: 0.18em; color: #e74c3c; border-bottom: 1px solid var(--border-subtle);
}
.rec-menu-item {
  display: flex; align-items: center; gap: 7px; padding: 6px 10px;
  font-family: 'Rajdhani', sans-serif; font-size: 12px; font-weight: 600;
  letter-spacing: 0.04em; color: #7070a0; cursor: pointer; border-radius: 4px;
}
.rec-menu-item:hover { background: var(--bg-hover); color: var(--text-primary); }
.rec-menu-item.on { color: #e74c3c; }
.rec-menu-box { font-size: 13px; line-height: 1; }
.rec-menu-sep { height: 1px; background: var(--border-subtle); margin: 3px 2px; }
.rec-menu-note {
  padding: 5px 10px 3px;
  font-family: 'Share Tech Mono', monospace; font-size: 8px; color: #6a4a20;
  border-top: 1px solid var(--border-subtle); margin-top: 3px;
}
</style>
