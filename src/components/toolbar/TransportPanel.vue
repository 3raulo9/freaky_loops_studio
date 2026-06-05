<template>
  <div class="tb-group">
    <div class="tb-group-label">TRANSPORT</div>
    <div class="tb-row">
      <button
        class="tb-btn tb-stop"
        v-hint="'transport.stop'"
        @click="stopPlay"
      >■</button>

      <button
        class="tb-btn tb-play"
        :class="{ active: isPlaying, arming: transportState === 'arming' }"
        v-hint="'transport.play'"
        @click="togglePlay"
      >{{ playGlyph }}</button>

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

      <!-- Loop Record toggle — OFF = infinite take, ON = overdub inside fixed loop -->
      <button
        class="tb-btn tb-loop-rec"
        :class="{ active: loopRecord }"
        v-hint="'transport.looprec'"
        @click="loopRecord = !loopRecord"
        :title="loopRecord ? 'Loop Record ON — overdub within loop (click to disable for infinite take)' : 'Loop Record OFF — playhead runs freely past pattern end (click to enable overdub)'"
      >↺</button>
    </div>

    <!-- Right-click capture-filter menu (bitmask of what gets recorded) -->
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
} = useStudio()

const FILTER_LIST = [
  { flag: RECORD_FLAGS.NOTES,      label: 'Notes' },
  { flag: RECORD_FLAGS.AUDIO,      label: 'Audio' },
  { flag: RECORD_FLAGS.AUTOMATION, label: 'Automation' },
  { flag: RECORD_FLAGS.CLIPS,      label: 'Clips' },
]

// Play glyph reflects the full handshake: intent → arming → engine running.
const playGlyph = computed(() =>
  transportState.value === 'arming' ? '⋯' : isPlaying.value ? '⏸' : '▶'
)

// ── Metronome flash ───────────────────────────────────────────────────────────
//  While playing, pulse the armed Record button on each audio-locked beat.
//  While stopped+armed, a steady CSS pulse runs at the project tempo instead.
const beatSeconds = computed(() => 60 / bpm.value)
const flashOn = ref(false)
let flashTimer = null
watch(beatTick, () => {
  if (!recordArmed.value) return
  flashOn.value = true
  clearTimeout(flashTimer)
  flashTimer = setTimeout(() => { flashOn.value = false }, 90)
})

// ── Record filter context menu ────────────────────────────────────────────────
const recMenu = ref({ open: false, x: 0, y: 0 })
function openRecMenu(e) {
  recMenu.value = { open: true, x: e.clientX, y: e.clientY }
}
function onGlobalDown(e) {
  if (recMenu.value.open && !e.target.closest('.rec-menu')) recMenu.value.open = false
}
onMounted(() => window.addEventListener('pointerdown', onGlobalDown, true))
onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', onGlobalDown, true)
  clearTimeout(flashTimer)
})
</script>

<style scoped>
/* Arming handshake: dim amber pulse until the engine acknowledges. */
.tb-play.arming {
  border-color: #f39c12 !important;
  color: #f39c12 !important;
  animation: tb-arming 0.5s ease-in-out infinite;
}
@keyframes tb-arming {
  0%, 100% { box-shadow: 0 0 4px #f39c1233; }
  50%      { box-shadow: 0 0 11px #f39c12aa; }
}

/* ── Record button states ──────────────────────────────────────────────────── */
.tb-rec {
  cursor: pointer;
  opacity: 1;
}
.tb-rec:hover { border-color: #e74c3c; color: #c0392b; }
.tb-rec.armed { background: #200a0a; border-color: #e74c3c; color: #e74c3c; }
.tb-rec.flash {
  background: #e74c3c; color: #fff;
  box-shadow: 0 0 12px #e74c3ccc;
}
/* Steady tempo-synced pulse while armed but not playing. */
.tb-rec.idlepulse { animation: tb-rec-pulse 1s ease-in-out infinite; }
@keyframes tb-rec-pulse {
  0%, 100% { box-shadow: 0 0 3px #e74c3c44; color: #e74c3c; }
  50%      { box-shadow: 0 0 12px #e74c3ccc; color: #ff6f5e; }
}
/* Refused to arm — angry shake. */
.tb-rec.warn { animation: tb-rec-warn 0.4s; }
@keyframes tb-rec-warn {
  0%, 100% { transform: translateX(0); }
  25%      { transform: translateX(-3px); border-color: #e74c3c; }
  75%      { transform: translateX(3px);  border-color: #e74c3c; }
}

/* ── Loop Record button ────────────────────────────────────────────────────── */
.tb-loop-rec { font-size: 14px; opacity: 0.35; transition: all 0.15s; }
.tb-loop-rec:hover { opacity: 0.7; border-color: #e74c3c55; }
.tb-loop-rec.active { opacity: 1; color: #e74c3c; border-color: #e74c3c88; background: #200a0a; }

/* ── Capture-filter menu ───────────────────────────────────────────────────── */
.rec-menu {
  position: fixed;
  z-index: 9999;
  min-width: 150px;
  background: var(--bg-control);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px;
  box-shadow: 0 6px 24px #000000a0;
}
.rec-menu-title {
  padding: 4px 9px 5px;
  font-family: 'Rajdhani', sans-serif; font-size: 9px; font-weight: 700;
  letter-spacing: 0.18em; color: #e74c3c; border-bottom: 1px solid var(--border-subtle);
}
.rec-menu-item {
  display: flex; align-items: center; gap: 7px;
  padding: 6px 10px;
  font-family: 'Rajdhani', sans-serif; font-size: 12px; font-weight: 600;
  letter-spacing: 0.04em; color: #7070a0; cursor: pointer; border-radius: 4px;
}
.rec-menu-item:hover { background: var(--bg-hover); color: var(--text-primary); }
.rec-menu-item.on { color: #e74c3c; }
.rec-menu-box { font-size: 13px; line-height: 1; }
.rec-menu-note {
  padding: 5px 10px 3px;
  font-family: 'Share Tech Mono', monospace; font-size: 8px; color: #6a4a20;
  border-top: 1px solid var(--border-subtle); margin-top: 3px;
}
</style>
