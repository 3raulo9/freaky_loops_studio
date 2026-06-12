<template>
  <div class="tb-ctrl tb-tempo" v-hint="'bpm'">
    <div class="tb-ctrl-label">TEMPO</div>
    <div
      class="tb-tempo-readout tb-red"
      :class="{ dragging, fine: fineActive, half: halfSpeed }"
      title="Drag to change · Ctrl-drag fine · scroll to nudge · right-click for options"
      @pointerdown="onPointerDown"
      @wheel.prevent="onWheel"
      @contextmenu.prevent.stop="openMenu"
      @dblclick="openMenu"
    >{{ bpmDisplay }}<span v-if="halfSpeed" class="tb-half-badge">½</span></div>
    <button class="tb-tap" v-hint="'bpm.tap'" @click="onTap">TAP</button>

    <!-- Right-click menu: tap, half speed, presets -->
    <div
      v-if="menu.open"
      class="bpm-menu"
      :style="{ left: menu.x + 'px', top: menu.y + 'px' }"
      @click.stop
    >
      <div class="bpm-menu-item" @click="run(onTap)">Tap tempo</div>
      <div class="bpm-menu-sep" />
      <div class="bpm-menu-item" :class="{ on: halfSpeed }" @click="halfSpeed = !halfSpeed; menu.open = false">
        <span class="bpm-menu-check">{{ halfSpeed ? '☑' : '☐' }}</span>Half speed
      </div>
      <div class="bpm-menu-sep" />
      <div class="bpm-menu-title">PRESETS</div>
      <div
        v-for="p in PRESETS"
        :key="p"
        class="bpm-menu-item bpm-menu-preset"
        :class="{ on: bpm === p }"
        @click="run(() => { bpm = p })"
      >{{ p }} BPM</div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useStudio } from '../../store/studio.js'

const { bpm, halfSpeed } = useStudio()

const MIN = 20
const MAX = 400
const PRESETS = [70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180]

const fineActive = ref(false)
const bpmDisplay = computed(() => {
  const v = bpm.value
  return (fineActive.value || !Number.isInteger(v)) ? v.toFixed(3) : String(v)
})

function clamp(v) { return Math.max(MIN, Math.min(MAX, v)) }

// ── Virtual rotary encoder ────────────────────────────────────────────────────
const dragging = ref(false)
let acc = 0
function onPointerDown(e) {
  if (e.button !== 0) return
  e.preventDefault()
  dragging.value = true
  acc = bpm.value
  e.currentTarget.requestPointerLock?.()
  window.addEventListener('pointermove', onDrag)
  window.addEventListener('pointerup', onPointerUp)
}
function onDrag(e) {
  const fine = e.ctrlKey || e.metaKey
  fineActive.value = fine
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

// ── Tap tempo ─────────────────────────────────────────────────────────────────
let taps = []
function onTap() {
  const now = performance.now()
  if (taps.length && now - taps[taps.length - 1] > 2500) taps = []
  taps.push(now)
  if (taps.length > 8) taps = taps.slice(-8)
  if (taps.length >= 2) {
    let sum = 0
    for (let i = 1; i < taps.length; i++) sum += taps[i] - taps[i - 1]
    bpm.value = clamp(Math.round(60000 / (sum / (taps.length - 1))))
  }
}

// ── Right-click menu ──────────────────────────────────────────────────────────
const menu = ref({ open: false, x: 0, y: 0 })
function openMenu(e) { menu.value = { open: true, x: e.clientX, y: e.clientY } }
function run(fn) { fn(); menu.value.open = false }
function onGlobalDown(e) {
  if (menu.value.open && !e.target.closest('.bpm-menu')) menu.value.open = false
}

onMounted(() => window.addEventListener('pointerdown', onGlobalDown, true))
onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', onGlobalDown, true)
  window.removeEventListener('pointermove', onDrag)
  window.removeEventListener('pointerup', onPointerUp)
})
</script>

<style scoped>
.tb-tempo { padding: 0 6px; position: relative; }
.tb-tempo-readout {
  font-family: 'Share Tech Mono', monospace;
  font-size: 16px; line-height: 1; min-width: 56px; text-align: center;
  padding: 2px 4px; border-radius: 4px;
  cursor: ns-resize; user-select: none; position: relative;
  border: 1px solid transparent;
  transition: border-color 0.1s, background 0.1s;
}
.tb-tempo-readout:hover { border-color: var(--border-subtle); background: var(--bg-deeper); }
.tb-tempo-readout.dragging {
  border-color: #e74c3c; background: #1a0808;
  box-shadow: 0 0 9px #e74c3c55;
}
.tb-tempo-readout.fine { font-size: 13px; }
.tb-tempo-readout.half { color: #f39c12; }

.tb-half-badge {
  position: absolute; top: -3px; right: -3px;
  font-size: 8px; font-weight: 700; color: #f39c12;
  background: #1a1000; border: 1px solid #f39c1266;
  border-radius: 3px; padding: 0 2px; line-height: 1.4;
}

.tb-tap {
  margin-top: 2px;
  font-family: 'Rajdhani', sans-serif; font-size: 8px; font-weight: 700;
  letter-spacing: 0.12em; padding: 1px 8px;
  border: 1px solid var(--border-subtle); border-radius: 3px;
  background: transparent; color: #50506e; cursor: pointer; transition: all 0.12s;
}
.tb-tap:hover  { border-color: #e74c3c; color: #e74c3c; }
.tb-tap:active { background: #1a0808; }

/* ── Right-click menu ────────────────────────────────────────────────────────── */
.bpm-menu {
  position: fixed; z-index: 9999; min-width: 160px;
  background: var(--bg-control); border: 1px solid var(--border);
  border-radius: 6px; padding: 4px; box-shadow: 0 6px 24px #000000a0;
}
.bpm-menu-title {
  padding: 4px 9px 4px;
  font-family: 'Rajdhani', sans-serif; font-size: 9px; font-weight: 700;
  letter-spacing: 0.16em; color: #5a5a80;
}
.bpm-menu-item {
  display: flex; align-items: center; gap: 7px; padding: 5px 10px;
  font-family: 'Rajdhani', sans-serif; font-size: 12px; font-weight: 600;
  letter-spacing: 0.03em; color: #8080a0; cursor: pointer; border-radius: 4px;
}
.bpm-menu-item:hover { background: var(--bg-hover); color: var(--text-primary); }
.bpm-menu-item.on { color: #e74c3c; }
.bpm-menu-preset.on { color: #2ecc71; }
.bpm-menu-check { font-size: 11px; width: 14px; }
.bpm-menu-sep { height: 1px; background: var(--border-subtle); margin: 3px 2px; }
</style>
