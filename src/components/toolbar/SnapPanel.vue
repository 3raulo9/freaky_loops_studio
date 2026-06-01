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
    <select v-model="gridSnap" class="tb-select" @change="pushHint">
      <option value="bar">Bar</option>
      <option value="1/2">1/2</option>
      <option value="1/4">1/4</option>
      <option value="1/8">1/8</option>
      <option value="1/16">1/16</option>
      <option value="none">None</option>
    </select>
  </div>
</template>

<script setup>
import { onMounted, onBeforeUnmount } from 'vue'
import { useStudio } from '../../store/studio.js'
import { setHintRaw, clearHint } from './hintBus.js'

const { gridSnap } = useStudio()

const LABELS = {
  bar: 'Bar', '1/2': '1/2 step', '1/4': '1/4 step',
  '1/8': '1/8 step', '1/16': '1/16 step', none: 'None (freeform)',
}
// In a real build this string would be assembled from the user's keybinding map.
const SNAP_SHORTCUT = 'Backspace'

// Dynamic-string hint: current mode + live keyboard shortcut.
function pushHint() {
  setHintRaw(`Global snap → ${LABELS[gridSnap.value]}  ·  toggle ${SNAP_SHORTCUT}`)
}

// Backspace toggles snapping on/off globally (remembering the last division).
let lastDivision = gridSnap.value === 'none' ? '1/4' : gridSnap.value
function onKey(e) {
  if (e.key !== 'Backspace') return
  const t = e.target
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
  e.preventDefault()
  if (gridSnap.value === 'none') {
    gridSnap.value = lastDivision
  } else {
    lastDivision = gridSnap.value
    gridSnap.value = 'none'
  }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<style scoped>
.tb-magnet { transition: filter 0.15s, opacity 0.15s; }
.tb-magnet.off { filter: grayscale(1); opacity: 0.4; }
</style>
