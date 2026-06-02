<template>
  <!-- Global Snap = the master quantization state every editor window reads. -->
  <div
    class="tb-ctrl tb-snap"
    @mouseenter="pushHint"
    @mouseleave="clearHint()"
  >
    <div class="tb-ctrl-label">
      <span class="tb-magnet" :class="{ off: gridSnap === 'none' }">🧲</span> SNAP
    </div>
    <div class="tb-snap-row">
      <select v-model="gridSnap" class="tb-select" @change="pushHint">
        <option value="line">Line</option>
        <option value="cell">Cell</option>
        <option value="bar">Bar</option>
        <option value="1/2">1/2</option>
        <option value="1/3">1/3 (triplet)</option>
        <option value="1/4">1/4 (beat)</option>
        <option value="1/8">1/8</option>
        <option value="1/16">1/16</option>
        <option value="1/32">1/32</option>
        <option value="none">None</option>
      </select>
      <button class="tb-ppq" title="Time base — Pulses Per Quarter note (click to cycle)" @click="cyclePpq" @mouseenter.stop="pushHint">{{ ppq }}</button>
    </div>
  </div>
</template>

<script setup>
import { onMounted, onBeforeUnmount } from 'vue'
import { useStudio } from '../../store/studio.js'
import { setHintRich, clearHint } from './hintBus.js'

const { gridSnap, ppq, ticksPerGridCell, tickDurationSec } = useStudio()

const LABELS = {
  line: 'Line', cell: 'Cell', bar: 'Bar', '1/2': '1/2 beat', '1/3': '1/3 triplet',
  '1/4': '1/4 beat', '1/8': '1/8', '1/16': '1/16', '1/32': '1/32', none: 'None (freeform)',
}
const SNAP_SHORTCUT = 'Backspace'
const PPQ_STEPS = [96, 192, 480, 960]

function cyclePpq() {
  ppq.value = PPQ_STEPS[(PPQ_STEPS.indexOf(ppq.value) + 1) % PPQ_STEPS.length]
  pushHint()
}

// Dynamic hint: mode + exact grid math (τ ticks @ PPQ) + tick duration + shortcut.
function pushHint() {
  if (gridSnap.value === 'none') {
    setHintRich({ label: 'Global snap', value: `None · freeform (1 tick) @ ${ppq.value} PPQ`, shortcut: SNAP_SHORTCUT })
    return
  }
  const tau = Math.round(ticksPerGridCell())
  const tickMs = (tickDurationSec() * 1000).toFixed(2)
  setHintRich({
    label: 'Global snap',
    value: `${LABELS[gridSnap.value]} · τ=${tau} ticks @ ${ppq.value} PPQ (${tickMs} ms/tick) · Alt=freeform`,
    shortcut: SNAP_SHORTCUT,
  })
}

// Backspace toggles snapping on/off globally (remembering the last division).
let lastDivision = gridSnap.value === 'none' ? '1/4' : gridSnap.value
function onKey(e) {
  if (e.key !== 'Backspace') return
  const t = e.target
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
  e.preventDefault()
  if (gridSnap.value === 'none') gridSnap.value = lastDivision
  else { lastDivision = gridSnap.value; gridSnap.value = 'none' }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<style scoped>
.tb-magnet { transition: filter 0.15s, opacity 0.15s; }
.tb-magnet.off { filter: grayscale(1); opacity: 0.4; }
.tb-snap-row { display: flex; align-items: center; gap: 3px; }
.tb-ppq {
  height: 22px; padding: 0 5px;
  background: var(--bg-control); border: 1px solid var(--border-subtle); border-radius: 4px;
  color: #6a6a90; font-family: 'Share Tech Mono', monospace; font-size: 10px;
  cursor: pointer; outline: none; transition: all 0.12s;
}
.tb-ppq:hover { border-color: #e74c3c; color: #e74c3c; }
</style>
