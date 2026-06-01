<template>
  <div class="tb-metro" v-hint="'metro'">
    <div class="tb-ctrl-label">METRO</div>
    <button
      class="tb-metro-btn"
      :class="{ active: metronomeOn, flash: flashOn, accent: flashAccent }"
      @click="metronomeOn = !metronomeOn"
      @contextmenu.prevent.stop="openMenu"
      title="Metronome — right-click for click sound"
    >
      <span class="tb-metro-glyph">△</span>
      <span class="tb-metro-pend" />
    </button>

    <!-- Right-click cascade: swap the click asset / toggle accent -->
    <div
      v-if="menu.open"
      class="metro-menu"
      :style="{ left: menu.x + 'px', top: menu.y + 'px' }"
      @click.stop
    >
      <div class="metro-menu-title">CLICK SOUND</div>
      <div
        v-for="s in SOUNDS"
        :key="s.id"
        class="metro-menu-item"
        :class="{ on: metronomeSound === s.id }"
        @click="metronomeSound = s.id"
      >
        <span class="metro-menu-dot">{{ metronomeSound === s.id ? '●' : '○' }}</span>{{ s.label }}
      </div>
      <div class="metro-menu-sep" />
      <div class="metro-menu-item" @click="metroAccent = !metroAccent">
        <span class="metro-menu-dot">{{ metroAccent ? '☑' : '☐' }}</span>Accent downbeat
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { useStudio } from '../../store/studio.js'

const { metronomeOn, metronomeSound, metroAccent, beatTick, beatAccent } = useStudio()

const SOUNDS = [
  { id: 'beep',    label: 'Beep' },
  { id: 'tick',    label: 'Tick' },
  { id: 'cowbell', label: 'Cowbell' },
  { id: 'hat',     label: 'Hi-hat' },
]

// ── Look-ahead visual flash ───────────────────────────────────────────────────
//  beatTick is emitted off the latency-compensated look-ahead queue, so the
//  flash lands together with the audible click — not a buffer-length late.
const flashOn = ref(false)
const flashAccent = ref(false)
let flashTimer = null
watch(beatTick, () => {
  if (!metronomeOn.value) return
  flashAccent.value = beatAccent.value
  flashOn.value = true
  clearTimeout(flashTimer)
  flashTimer = setTimeout(() => { flashOn.value = false }, 80)
})

// ── Sound cascade menu ────────────────────────────────────────────────────────
const menu = ref({ open: false, x: 0, y: 0 })
function openMenu(e) { menu.value = { open: true, x: e.clientX, y: e.clientY } }
function onGlobalDown(e) {
  if (menu.value.open && !e.target.closest('.metro-menu')) menu.value.open = false
}
onMounted(() => window.addEventListener('pointerdown', onGlobalDown, true))
onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', onGlobalDown, true)
  clearTimeout(flashTimer)
})
</script>

<style scoped>
.tb-metro {
  display: flex; flex-direction: column; align-items: center; gap: 2px;
  flex-shrink: 0; padding: 0 5px; position: relative;
}
.tb-ctrl-label {
  font-family: 'Rajdhani', sans-serif;
  font-size: 8px; font-weight: 700; letter-spacing: 0.18em;
  color: #28283c; text-transform: uppercase; line-height: 1;
}
.tb-metro-btn {
  position: relative;
  width: 30px; height: 26px;
  display: flex; align-items: center; justify-content: center;
  border: 1px solid var(--border-subtle); border-radius: 5px;
  background: transparent; color: #35354a; cursor: pointer;
  transition: all 0.1s; outline: none;
}
.tb-metro-btn:hover { border-color: #404068; color: #8080b0; }
.tb-metro-btn.active {
  border-color: #f39c12; color: #f39c12; background: #140e00;
  box-shadow: 0 0 7px #f39c1233;
}
.tb-metro-glyph { font-size: 14px; line-height: 1; }
/* Swinging pendulum dot at the apex of the triangle. */
.tb-metro-pend {
  position: absolute; top: 4px; left: 50%;
  width: 3px; height: 3px; border-radius: 50%;
  background: currentColor; opacity: 0.6;
  transform: translateX(-50%);
}
.tb-metro-btn.active .tb-metro-pend { animation: metro-swing 0.5s ease-in-out infinite alternate; }
@keyframes metro-swing {
  from { transform: translateX(-7px); }
  to   { transform: translateX(5px); }
}
/* Beat flash — brighter + larger glow on the accented downbeat. */
.tb-metro-btn.flash {
  border-color: #f5b041; color: #ffcf6b; background: #2a1d00;
  box-shadow: 0 0 9px #f39c1288;
}
.tb-metro-btn.flash.accent {
  border-color: #2ecc71; color: #2ecc71; background: #06210f;
  box-shadow: 0 0 13px #2ecc71aa;
}

/* ── Cascade menu ───────────────────────────────────────────────────────────── */
.metro-menu {
  position: fixed; z-index: 9999; min-width: 140px;
  background: var(--bg-control); border: 1px solid var(--border);
  border-radius: 6px; padding: 4px; box-shadow: 0 6px 24px #000000a0;
}
.metro-menu-title {
  padding: 4px 9px 5px;
  font-family: 'Rajdhani', sans-serif; font-size: 9px; font-weight: 700;
  letter-spacing: 0.18em; color: #f39c12; border-bottom: 1px solid var(--border-subtle);
}
.metro-menu-item {
  display: flex; align-items: center; gap: 7px;
  padding: 6px 10px;
  font-family: 'Rajdhani', sans-serif; font-size: 12px; font-weight: 600;
  letter-spacing: 0.04em; color: #8080a0; cursor: pointer; border-radius: 4px;
}
.metro-menu-item:hover { background: var(--bg-hover); color: var(--text-primary); }
.metro-menu-item.on { color: #f39c12; }
.metro-menu-dot { font-size: 11px; width: 12px; }
.metro-menu-sep { height: 1px; background: var(--border-subtle); margin: 4px 2px; }
</style>
