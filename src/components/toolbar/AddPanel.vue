<template>
  <div class="tb-add" v-hint="'add'">
    <button
      ref="btnRef"
      class="tb-add-btn"
      :class="{ open: menu }"
      title="Add channel / instrument"
      @click.stop="toggleMenu"
    >
      <span class="tb-add-plus">+</span>
      <span class="tb-add-lbl">ADD</span>
    </button>

    <Teleport to="body">
    <div v-if="menu" class="add-menu" :style="menuStyle" @click.stop>
      <div class="add-menu-title">ADD CHANNEL</div>

      <div class="add-menu-item" @click="run(addChannel)">
        <span class="add-dot" style="background:#4ecdc4" />SYNTH (Saw)
      </div>

      <!-- FM submenu trigger -->
      <div
        class="add-menu-item add-menu-sub-trigger"
        @mouseenter="fmOpen = true"
        @mouseleave="fmOpen = false"
      >
        <span class="add-dot" style="background:#f39c12" />FM Synths
        <span class="add-arrow">▶</span>
        <div v-if="fmOpen" class="add-submenu" @mouseenter="fmOpen = true" @mouseleave="fmOpen = false">
          <div
            v-for="(preset, key) in FM_PRESETS"
            :key="key"
            class="add-menu-item"
            @click="run(() => addFMChannel(key))"
          >
            <span class="add-dot" :style="{ background: preset.color }" />{{ preset.name }}
          </div>
        </div>
      </div>

      <!-- GM submenu trigger -->
      <div
        class="add-menu-item add-menu-sub-trigger"
        @mouseenter="gmOpen = true"
        @mouseleave="gmOpen = false"
      >
        <span class="add-dot" style="background:#3498db" />GM Instrument
        <span class="add-arrow">▶</span>
        <div v-if="gmOpen" class="add-submenu add-submenu--gm" @mouseenter="gmOpen = true" @mouseleave="gmOpen = false">
          <div
            v-for="(cat, ci) in GM_CATEGORIES"
            :key="cat"
            class="add-menu-item"
            @click="run(() => addGMChannel(ci * 8))"
          >
            <span class="add-dot" :style="{ background: GM_CAT_COLORS[ci] }" />{{ cat }}
          </div>
        </div>
      </div>

      <div class="add-menu-sep" />

      <div class="add-menu-item" @click="run(addCustomSynthChannel)">
        <span class="add-dot" style="background:#00d4ff" />◈ Custom Synth
      </div>
      <div class="add-menu-item" @click="run(addSubterraChannel)">
        <span class="add-dot" style="background:#ff5a3c" />▼ Subterra Bass
      </div>
      <div class="add-menu-item" @click="run(addWasmChannel)">
        <span class="add-dot" style="background:#7b2fff" />⬡ WASM Plugin
      </div>
    </div>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useStudio } from '../../store/studio.js'
import { FM_PRESETS } from '../../store/studio.js'

const {
  addChannel, addFMChannel, addGMChannel,
  addCustomSynthChannel, addSubterraChannel, addWasmChannel,
  GM_CATEGORIES, GM_CAT_COLORS,
} = useStudio()

const btnRef = ref(null)
const menu  = ref(false)
const fmOpen = ref(false)
const gmOpen = ref(false)

// The menu is teleported to <body> to escape the toolbar's overflow:hidden, so it
// is positioned fixed from the button's rect. Flip upward when the toolbar is
// docked near the bottom of the screen.
const menuPos = ref({ left: 0, top: 0 })
const menuStyle = computed(() => {
  const p = menuPos.value
  const s = { left: p.left + 'px' }
  if (p.top != null)    s.top    = p.top + 'px'
  if (p.bottom != null) s.bottom = p.bottom + 'px'
  return s
})

function toggleMenu() {
  if (menu.value) { menu.value = false; fmOpen.value = false; gmOpen.value = false; return }
  const r = btnRef.value?.getBoundingClientRect()
  if (r) {
    menuPos.value = r.bottom > window.innerHeight / 2
      ? { left: r.left, bottom: window.innerHeight - r.top + 4 }
      : { left: r.left, top: r.bottom + 4 }
  }
  menu.value = true
}

function run(fn) { fn(); menu.value = false; fmOpen.value = false; gmOpen.value = false }

function onGlobalDown(e) {
  if (!e.target.closest('.tb-add') && !e.target.closest('.add-menu')) {
    menu.value = false; fmOpen.value = false; gmOpen.value = false
  }
}
onMounted(() => window.addEventListener('pointerdown', onGlobalDown, true))
onBeforeUnmount(() => window.removeEventListener('pointerdown', onGlobalDown, true))
</script>

<style scoped>
.tb-add { position: relative; flex-shrink: 0; }

.tb-add-btn {
  display: flex; flex-direction: column; align-items: center; gap: 1px;
  padding: 0 10px; height: 100%; min-height: 34px;
  background: transparent; border: 1px solid var(--border-subtle); border-radius: 5px;
  cursor: pointer; transition: all 0.12s; outline: none;
}
.tb-add-btn:hover { border-color: #2ecc71; }
.tb-add-btn.open  { border-color: #2ecc71; background: #081a09; }

.tb-add-plus {
  font-size: 18px; line-height: 1; color: #2a6035;
  transition: color 0.12s;
}
.tb-add-btn:hover .tb-add-plus, .tb-add-btn.open .tb-add-plus { color: #2ecc71; }
.tb-add-lbl {
  font-family: 'Rajdhani', sans-serif; font-size: 8px; font-weight: 700;
  letter-spacing: 0.16em; color: #28382a; line-height: 1;
}
.tb-add-btn:hover .tb-add-lbl, .tb-add-btn.open .tb-add-lbl { color: #2ecc71; }

/* ── Dropdown menu ─────────────────────────────────────────────────────────── */
.add-menu {
  position: fixed; z-index: 100000;
  min-width: 190px;
  background: var(--bg-control); border: 1px solid var(--border);
  border-radius: 6px; padding: 4px; box-shadow: 0 8px 28px #000000b0;
}
.add-menu-title {
  padding: 4px 9px 5px;
  font-family: 'Rajdhani', sans-serif; font-size: 9px; font-weight: 700;
  letter-spacing: 0.18em; color: #2ecc71; border-bottom: 1px solid var(--border-subtle);
}
.add-menu-item {
  display: flex; align-items: center; gap: 8px; padding: 6px 10px;
  font-family: 'Rajdhani', sans-serif; font-size: 12px; font-weight: 600;
  letter-spacing: 0.03em; color: #8080a0; cursor: pointer; border-radius: 4px;
  position: relative;
}
.add-menu-item:hover { background: var(--bg-hover); color: var(--text-primary); }
.add-menu-sub-trigger { justify-content: flex-start; }
.add-arrow { margin-left: auto; font-size: 9px; color: #3a3a5a; }
.add-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.add-menu-sep { height: 1px; background: var(--border-subtle); margin: 4px 2px; }

/* ── Submenus ──────────────────────────────────────────────────────────────── */
.add-submenu {
  position: absolute; left: 100%; top: -4px; z-index: 10000;
  min-width: 180px; max-height: 320px; overflow-y: auto;
  background: var(--bg-control); border: 1px solid var(--border);
  border-radius: 6px; padding: 4px; box-shadow: 0 8px 28px #000000b0;
}
.add-submenu--gm { min-width: 160px; }
.add-submenu .add-menu-item { padding: 5px 10px; }
</style>
