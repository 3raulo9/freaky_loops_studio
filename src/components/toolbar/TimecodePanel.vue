<template>
  <div
    class="tb-timecode"
    v-hint="'timecode'"
    @click="cycleMode"
    @contextmenu.prevent.stop="openMenu"
    :title="MODE_META[mode].label + ' — click to cycle, right-click for options'"
  >
    <div class="tb-timecode-val">{{ timecodeDisplay }}</div>
    <div class="tb-timecode-mode">{{ MODE_META[mode].tag }}</div>

    <!-- Right-click mode selector -->
    <div
      v-if="menu.open"
      class="tc-menu"
      :style="{ left: menu.x + 'px', top: menu.y + 'px' }"
      @click.stop
    >
      <div class="tc-menu-title">MODE</div>
      <div
        v-for="m in MODES"
        :key="m"
        class="tc-menu-item"
        :class="{ on: mode === m }"
        @click="setMode(m)"
      >
        <span class="tc-menu-dot">{{ mode === m ? '●' : '○' }}</span>{{ MODE_META[m].label }}
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useStudio } from '../../store/studio.js'

const { bpm, totalSteps, getTimecodeSeconds } = useStudio()

const MODES = ['bars', 'time', 'smpte30', 'smpte25']
const MODE_META = {
  bars:    { label: 'Bar : Beat : Tick',         tag: 'BAR · BEAT · TICK' },
  time:    { label: 'Minute : Second : Centisec', tag: 'MIN · SEC · CS' },
  smpte30: { label: 'SMPTE 30 fps',              tag: 'SMPTE 30' },
  smpte25: { label: 'SMPTE 25 fps',              tag: 'SMPTE 25' },
}

const LS_KEY = 'fl.timecode.mode.v1'
const mode = ref(localStorage.getItem(LS_KEY) || 'bars')

function setMode(m) { mode.value = m; try { localStorage.setItem(LS_KEY, m) } catch {} menu.value.open = false }
function cycleMode() {
  const idx = MODES.indexOf(mode.value)
  setMode(MODES[(idx + 1) % MODES.length])
}

const currentTimeSec = ref(0)
let raf = null
function tick() {
  currentTimeSec.value = getTimecodeSeconds()
  raf = requestAnimationFrame(tick)
}

const timecodeDisplay = computed(() => {
  const t = currentTimeSec.value
  if (mode.value === 'time') {
    const min = Math.floor(t / 60)
    const sec = Math.floor(t % 60)
    const cs  = Math.floor((t % 1) * 100)
    return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}:${String(cs).padStart(2, '0')}`
  }
  if (mode.value === 'smpte30') {
    const frames = Math.floor(t * 30)
    const ff = frames % 30
    const ss = Math.floor(frames / 30) % 60
    const mm = Math.floor(frames / 1800) % 60
    const hh = Math.floor(frames / 108000)
    return `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}:${String(ff).padStart(2,'0')}`
  }
  if (mode.value === 'smpte25') {
    const frames = Math.floor(t * 25)
    const ff = frames % 25
    const ss = Math.floor(frames / 25) % 60
    const mm = Math.floor(frames / 1500) % 60
    const hh = Math.floor(frames / 90000)
    return `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}:${String(ff).padStart(2,'0')}`
  }
  // Default: bars mode
  const spb   = 60 / bpm.value
  const spbar = 4 * spb
  const bar  = Math.floor(t / spbar) + 1
  const beat = Math.floor((t % spbar) / spb) + 1
  const tick = Math.floor(((t % spb) / spb) * totalSteps.value) + 1
  return `${String(bar).padStart(3, '0')}:${beat}:${String(tick).padStart(2, '0')}`
})

const menu = ref({ open: false, x: 0, y: 0 })
function openMenu(e) { menu.value = { open: true, x: e.clientX, y: e.clientY } }
function onGlobalDown(e) {
  if (menu.value.open && !e.target.closest('.tc-menu')) menu.value.open = false
}

onMounted(() => {
  tick()
  window.addEventListener('pointerdown', onGlobalDown, true)
})
onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  window.removeEventListener('pointerdown', onGlobalDown, true)
})
</script>

<style scoped>
.tb-timecode {
  display: flex; flex-direction: column; align-items: flex-end; justify-content: center;
  padding: 0 8px; cursor: pointer; user-select: none; position: relative;
  border: 1px solid var(--border-subtle); border-radius: 4px;
  background: var(--bg-deeper); min-width: 90px;
  transition: border-color 0.1s;
}
.tb-timecode:hover { border-color: #404068; }
.tb-timecode-val {
  font-family: 'Share Tech Mono', monospace; font-size: 16px; font-weight: 700;
  color: #c0c0e8; letter-spacing: 0.04em; line-height: 1.1;
}
.tb-timecode-mode {
  font-family: 'Rajdhani', sans-serif; font-size: 7px; font-weight: 700;
  letter-spacing: 0.18em; color: #2a2a40; text-transform: uppercase;
}

/* ── Mode menu ───────────────────────────────────────────────────────────────── */
.tc-menu {
  position: fixed; z-index: 9999; min-width: 200px;
  background: var(--bg-control); border: 1px solid var(--border);
  border-radius: 6px; padding: 4px; box-shadow: 0 6px 24px #000000a0;
}
.tc-menu-title {
  padding: 4px 9px 5px;
  font-family: 'Rajdhani', sans-serif; font-size: 9px; font-weight: 700;
  letter-spacing: 0.18em; color: #5a5a80; border-bottom: 1px solid var(--border-subtle);
}
.tc-menu-item {
  display: flex; align-items: center; gap: 7px; padding: 6px 10px;
  font-family: 'Rajdhani', sans-serif; font-size: 12px; font-weight: 600;
  letter-spacing: 0.04em; color: #8080a0; cursor: pointer; border-radius: 4px;
}
.tc-menu-item:hover { background: var(--bg-hover); color: var(--text-primary); }
.tc-menu-item.on { color: #c0c0e8; }
.tc-menu-dot { font-size: 11px; width: 12px; }
</style>
