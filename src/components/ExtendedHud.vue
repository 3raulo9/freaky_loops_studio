<template>
  <!-- Extended Hint Panel: a detachable, semi-transparent HUD that mirrors the
       global hint broker. A radial timer fills over 150 ms of dwell, then the
       metadata fades in; hovering the panel itself drops it to ~20% opacity. -->
  <div
    class="ehud"
    :style="{ left: pos.x + 'px', top: pos.y + 'px', opacity: hovered ? 0.2 : 0.94 }"
    @mouseenter="hovered = true"
    @mouseleave="hovered = false"
    @mousedown="startDrag"
  >
    <!-- Progress / status ring -->
    <svg class="ehud-ring" viewBox="0 0 40 40">
      <circle class="ehud-ring-bg" cx="20" cy="20" r="16" />
      <circle
        class="ehud-ring-fg"
        cx="20" cy="20" r="16"
        :stroke-dasharray="CIRC"
        :stroke-dashoffset="CIRC * (1 - progress)"
        :style="{ stroke: active ? '#2ecc71' : '#3a3a55' }"
      />
      <circle class="ehud-ring-dot" cx="20" cy="20" r="3" :style="{ fill: active ? '#2ecc71' : '#2a2a40' }" />
    </svg>

    <!-- Metadata, faded in once the ring completes -->
    <div class="ehud-meta" :style="{ opacity: revealed ? 1 : progress }">
      <div v-if="hintValue" class="ehud-value">{{ hintValue }}</div>
      <div class="ehud-label">{{ hintLabel || 'Hover a control' }}</div>
    </div>

    <button class="ehud-close" title="Close Extended Hint Panel" @click.stop="extendedHudOpen = false">✕</button>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, onBeforeUnmount } from 'vue'
import { useStudio } from '../store/studio.js'
import { hintText, hintLabel, hintValue, hintActive } from './toolbar/hintBus.js'

const { extendedHudOpen } = useStudio()

const CIRC = 2 * Math.PI * 16
const active = hintActive
const hovered = ref(false)

const pos = reactive({ x: window.innerWidth - 320, y: window.innerHeight - 130 })

// ── Look-ahead radial fill (150 ms dwell) ─────────────────────────────────────
const progress = ref(0)
const revealed = ref(false)
let raf = null, t0 = 0
const DWELL = 150

function animate(ts) {
  if (!t0) t0 = ts
  progress.value = Math.min(1, (ts - t0) / DWELL)
  if (progress.value < 1) { raf = requestAnimationFrame(animate) }
  else { revealed.value = true }
}
// Restart the fill whenever the hovered control (hint) changes.
watch(hintText, (txt) => {
  cancelAnimationFrame(raf)
  if (txt) { t0 = 0; progress.value = 0; revealed.value = false; raf = requestAnimationFrame(animate) }
  else     { progress.value = 0; revealed.value = false }
})

// ── Drag ──────────────────────────────────────────────────────────────────────
let sx = 0, sy = 0, ox = 0, oy = 0
function startDrag(e) {
  if (e.target.closest('.ehud-close')) return
  sx = e.clientX; sy = e.clientY; ox = pos.x; oy = pos.y
  window.addEventListener('mousemove', onDrag)
  window.addEventListener('mouseup', stopDrag)
}
function onDrag(e) {
  pos.x = Math.max(0, Math.min(window.innerWidth - 60, ox + e.clientX - sx))
  pos.y = Math.max(0, Math.min(window.innerHeight - 40, oy + e.clientY - sy))
}
function stopDrag() {
  window.removeEventListener('mousemove', onDrag)
  window.removeEventListener('mouseup', stopDrag)
}

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  window.removeEventListener('mousemove', onDrag)
  window.removeEventListener('mouseup', stopDrag)
})
</script>

<style scoped>
.ehud {
  position: fixed; z-index: 8000;
  display: flex; align-items: center; gap: 12px;
  width: 290px; padding: 12px 36px 12px 14px;
  background: rgba(10, 10, 18, 0.82);
  backdrop-filter: blur(6px);
  border: 1px solid var(--border); border-radius: 12px;
  box-shadow: 0 10px 36px #000000a0;
  cursor: grab; user-select: none;
  transition: opacity 0.18s ease;
}
.ehud:active { cursor: grabbing; }

.ehud-ring { width: 40px; height: 40px; flex-shrink: 0; transform: rotate(-90deg); }
.ehud-ring-bg { fill: none; stroke: #1a1a28; stroke-width: 3; }
.ehud-ring-fg { fill: none; stroke-width: 3; stroke-linecap: round; transition: stroke 0.2s; }
.ehud-ring-dot { transition: fill 0.2s; }

.ehud-meta { flex: 1; min-width: 0; transition: opacity 0.18s ease; }
.ehud-value {
  font-family: 'Share Tech Mono', monospace; font-size: 20px; color: #e8e8f4;
  line-height: 1.1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  filter: drop-shadow(0 0 6px #2ecc7133);
}
.ehud-label {
  font-family: 'Rajdhani', sans-serif; font-size: 11px; font-weight: 600;
  letter-spacing: 0.04em; color: #7a7aa0; margin-top: 2px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.ehud-close {
  position: absolute; top: 6px; right: 8px;
  background: transparent; border: none; color: #50506e;
  font-size: 12px; cursor: pointer; line-height: 1;
}
.ehud-close:hover { color: #e74c3c; }
</style>
