<template>
  <div class="tb-ctrl tb-tempo" v-hint="'bpm'">
    <div class="tb-ctrl-label">TEMPO</div>
    <div
      class="tb-tempo-readout tb-red"
      :class="{ dragging, fine: fineActive }"
      title="Drag to change · Ctrl-drag fine · scroll to nudge · right-click to tap"
      @pointerdown="onPointerDown"
      @wheel.prevent="onWheel"
      @contextmenu.prevent="onTap"
      @dblclick="onTap"
    >{{ bpmDisplay }}</div>
    <button class="tb-tap" v-hint="'bpm.tap'" @click="onTap">TAP</button>
  </div>
</template>

<script setup>
import { ref, computed, onBeforeUnmount } from 'vue'
import { useStudio } from '../../store/studio.js'

const { bpm } = useStudio()

const MIN = 20
const MAX = 400

// Show integers plainly; reveal 3 decimals while fine-tuning a fractional value.
const fineActive = ref(false)
const bpmDisplay = computed(() => {
  const v = bpm.value
  return (fineActive.value || !Number.isInteger(v)) ? v.toFixed(3) : String(v)
})

function clamp(v) { return Math.max(MIN, Math.min(MAX, v)) }

// ── Virtual rotary encoder: relative pixel-delta dragging ─────────────────────
const dragging = ref(false)
let acc = 0

function onPointerDown(e) {
  e.preventDefault()
  dragging.value = true
  acc = bpm.value
  // Pointer lock turns the readout into a true relative encoder (cursor hidden,
  // raw movement deltas), so a drag never runs out of screen.
  e.currentTarget.requestPointerLock?.()
  window.addEventListener('pointermove', onDrag)
  window.addEventListener('pointerup', onPointerUp)
}

function onDrag(e) {
  const fine = e.ctrlKey || e.metaKey
  fineActive.value = fine
  // Up = faster. Standard ≈ 1 BPM / 2px (integers); fine ≈ 0.01 BPM/px (3dp).
  acc = clamp(acc - e.movementY * (fine ? 0.01 : 0.5))
  bpm.value = fine ? Math.round(acc * 1000) / 1000 : Math.round(acc)
}

function onPointerUp() {
  dragging.value = false
  fineActive.value = false
  document.exitPointerLock?.()
  window.removeEventListener('pointermove', onDrag)
  window.removeEventListener('pointerup', onPointerUp)
}

function onWheel(e) {
  const fine = e.ctrlKey || e.metaKey
  const step = fine ? 0.01 : 1
  const next = clamp(bpm.value + (e.deltaY < 0 ? step : -step))
  bpm.value = fine ? Math.round(next * 1000) / 1000 : Math.round(next)
}

// ── Tap tempo: rolling average of the last few inter-tap deltas ───────────────
let taps = []
function onTap() {
  const now = performance.now()
  // Reset if it's been a while since the last tap.
  if (taps.length && now - taps[taps.length - 1] > 2500) taps = []
  taps.push(now)
  if (taps.length > 8) taps = taps.slice(-8)
  if (taps.length >= 2) {
    let sum = 0
    for (let i = 1; i < taps.length; i++) sum += taps[i] - taps[i - 1]
    const avg = sum / (taps.length - 1)
    bpm.value = clamp(Math.round(60000 / avg))
  }
}

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onDrag)
  window.removeEventListener('pointerup', onPointerUp)
})
</script>

<style scoped>
.tb-tempo { padding: 0 6px; }
.tb-tempo-readout {
  font-family: 'Share Tech Mono', monospace;
  font-size: 16px; line-height: 1; min-width: 56px; text-align: center;
  padding: 2px 4px; border-radius: 4px;
  cursor: ns-resize; user-select: none;
  border: 1px solid transparent;
  transition: border-color 0.1s, background 0.1s;
}
.tb-tempo-readout:hover { border-color: var(--border-subtle); background: var(--bg-deeper); }
.tb-tempo-readout.dragging {
  border-color: #e74c3c; background: #1a0808;
  box-shadow: 0 0 9px #e74c3c55;
}
.tb-tempo-readout.fine { font-size: 13px; }   /* 3-decimal string fits the slot */

.tb-tap {
  margin-top: 2px;
  font-family: 'Rajdhani', sans-serif; font-size: 8px; font-weight: 700;
  letter-spacing: 0.12em; padding: 1px 8px;
  border: 1px solid var(--border-subtle); border-radius: 3px;
  background: transparent; color: #50506e; cursor: pointer; transition: all 0.12s;
}
.tb-tap:hover  { border-color: #e74c3c; color: #e74c3c; }
.tb-tap:active { background: #1a0808; }
</style>
