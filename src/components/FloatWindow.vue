<template>
  <!-- A detached (WS_POPUP-style) window: floats free of the docked layout,
       draggable by its header and resizable, tracked in the window manager. -->
  <div
    class="float-win"
    :style="{ left: w.x + 'px', top: w.y + 'px', width: w.w + 'px', height: w.h + 'px', zIndex: w.z }"
    @mousedown="focusWindow(id)"
  >
    <div class="float-head" :style="{ '--accent': accent }" @mousedown.self="startDrag">
      <span class="float-dot" :style="{ background: accent }" />
      <span class="float-title">{{ title }}</span>
      <span class="float-badge">DETACHED</span>
      <button class="float-btn" title="Re-dock into the main layout" @click.stop="redockWindow(id)">⤓</button>
    </div>
    <div class="float-body"><slot /></div>
    <div class="float-resize" @mousedown.stop.prevent="startResize" title="Resize" />
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useStudio } from '../store/studio.js'

const props = defineProps({
  id:     { type: String, required: true },
  title:  { type: String, default: '' },
  accent: { type: String, default: '#9b59b6' },
})

const { detachedWindows, focusWindow, redockWindow } = useStudio()
const w = computed(() => detachedWindows[props.id])

// ── Drag ──────────────────────────────────────────────────────────────────────
let sx = 0, sy = 0, ox = 0, oy = 0
function startDrag(e) {
  focusWindow(props.id)
  sx = e.clientX; sy = e.clientY; ox = w.value.x; oy = w.value.y
  window.addEventListener('mousemove', onDrag)
  window.addEventListener('mouseup', stopDrag)
}
function onDrag(e) {
  w.value.x = Math.max(0, Math.min(window.innerWidth - 80, ox + (e.clientX - sx)))
  w.value.y = Math.max(40, Math.min(window.innerHeight - 40, oy + (e.clientY - sy)))
}
function stopDrag() {
  window.removeEventListener('mousemove', onDrag)
  window.removeEventListener('mouseup', stopDrag)
}

// ── Resize ────────────────────────────────────────────────────────────────────
let rw = 0, rh = 0, rsx = 0, rsy = 0
function startResize(e) {
  rsx = e.clientX; rsy = e.clientY; rw = w.value.w; rh = w.value.h
  window.addEventListener('mousemove', onResize)
  window.addEventListener('mouseup', stopResize)
}
function onResize(e) {
  w.value.w = Math.max(320, rw + (e.clientX - rsx))
  w.value.h = Math.max(200, rh + (e.clientY - rsy))
}
function stopResize() {
  window.removeEventListener('mousemove', onResize)
  window.removeEventListener('mouseup', stopResize)
}
</script>

<style scoped>
.float-win {
  position: fixed;
  display: flex; flex-direction: column;
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 12px 40px #000000b0;
  overflow: hidden;
}
.float-head {
  display: flex; align-items: center; gap: 8px;
  height: 26px; padding: 0 8px;
  background: linear-gradient(180deg, var(--bg-panel), var(--bg-deeper));
  border-bottom: 1px solid var(--border-subtle);
  cursor: grab; flex-shrink: 0;
}
.float-head:active { cursor: grabbing; }
.float-dot { width: 8px; height: 8px; border-radius: 50%; pointer-events: none; }
.float-title {
  font-family: 'Rajdhani', sans-serif; font-size: 12px; font-weight: 700;
  letter-spacing: 0.1em; color: #c8c8e0; pointer-events: none;
}
.float-badge {
  font-family: 'Share Tech Mono', monospace; font-size: 7px; letter-spacing: 0.15em;
  color: #1abc9c; border: 1px solid #1abc9c55; border-radius: 3px; padding: 1px 4px;
  pointer-events: none;
}
.float-btn {
  margin-left: auto; width: 22px; height: 18px;
  background: transparent; border: 1px solid var(--border-subtle); border-radius: 4px;
  color: #8080b0; cursor: pointer; font-size: 12px; line-height: 1;
}
.float-btn:hover { border-color: var(--accent); color: #fff; }
.float-body { flex: 1; overflow: auto; min-height: 0; position: relative; }
.float-resize {
  position: absolute; right: 0; bottom: 0; width: 14px; height: 14px;
  cursor: nwse-resize;
  background: linear-gradient(135deg, transparent 50%, var(--border) 50%, var(--border) 60%, transparent 60%, transparent 75%, var(--border) 75%);
}
</style>
