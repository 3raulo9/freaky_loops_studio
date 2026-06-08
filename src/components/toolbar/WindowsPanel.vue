<template>
  <div class="tb-windows">
    <!-- MDI window shortcuts: tri-state lifecycle + detach + hover-to-peek -->
    <button
      v-for="w in WINDOWS"
      :key="w.id"
      class="tb-win"
      :class="[w.accent, winClass(w.id)]"
      v-hint="w.hint"
      :title="`${w.title} (${w.key})`"
      @click="activateWindow(w.id)"
      @contextmenu.prevent.stop="openCtx(w.id, $event)"
      @dragover.prevent="onIconDragOver(w.id, $event)"
      @dragleave="onIconDragLeave"
      @drop="onIconDragLeave"
    >
      <span class="tb-win-icon">{{ w.icon }}</span>
      <span class="tb-win-lbl">{{ w.label }}</span>
      <span v-if="winClass(w.id).detached" class="tb-win-detach" title="Detached">⇱</span>
    </button>

    <!-- Modal shortcuts (no MDI lifecycle) -->
    <button class="tb-win tb-win-render" v-hint="'win.render'" title="Render / Export audio"
      @click="renderModalOpen = true">
      <span class="tb-win-icon">⬡</span><span class="tb-win-lbl">RENDER</span>
    </button>
    <button class="tb-win tb-win-theme" v-hint="'win.theme'" title="Theme settings"
      @click="themeModalOpen = true">
      <span class="tb-win-icon">◑</span><span class="tb-win-lbl">THEME</span>
    </button>
    <button class="tb-win tb-win-midi" v-hint="'win.midi'" title="MIDI Port Router / GM Renderer"
      @click="midiRouterOpen = true">
      <span class="tb-win-icon">♩</span><span class="tb-win-lbl">MIDI</span>
    </button>

    <!-- Arrangement / layout preset selector -->
    <button class="tb-win tb-win-layout" v-hint="'win.layout'" title="Workspace layout presets"
      @click.stop="layoutMenu = !layoutMenu">
      <span class="tb-win-icon">▦</span><span class="tb-win-lbl">LAYOUT</span>
    </button>

    <!-- ── Per-window context menu (detach etc.) ───────────────────────────────-->
    <div v-if="ctx.open" class="win-menu" :style="{ left: ctx.x + 'px', top: ctx.y + 'px' }" @click.stop>
      <div class="win-menu-title">{{ titleFor(ctx.id) }}</div>
      <div class="win-menu-item" @click="run(() => activateWindow(ctx.id))">
        {{ windowState(ctx.id) === 'focused' ? 'Hide' : 'Show / focus' }}
      </div>
      <div class="win-menu-sep" />
      <div class="win-menu-item" @click="run(() => toggleDetach(ctx.id))">
        <span class="win-menu-check">{{ winClass(ctx.id).detached ? '☑' : '☐' }}</span>Detached
      </div>
    </div>

    <!-- ── Layout preset menu ──────────────────────────────────────────────────-->
    <div v-if="layoutMenu" class="win-menu win-menu--layout" @click.stop>
      <div class="win-menu-title">WORKSPACE</div>
      <div
        v-for="a in ARRANGEMENTS"
        :key="a.id"
        class="win-menu-item"
        :class="{ on: activeArrangement === a.id }"
        @click="run(() => applyArrangement(a.id), 'layout')"
      >
        <span class="win-menu-check">{{ activeArrangement === a.id ? '●' : '○' }}</span>{{ a.label }}
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useStudio } from '../../store/studio.js'

const {
  renderModalOpen, themeModalOpen, midiRouterOpen,
  browserOpen, activeArrangement,
  windowState, activateWindow, toggleDetach, applyArrangement,
} = useStudio()

const WINDOWS = [
  { id: 'playlist', label: 'PLAYLIST', icon: '▤', title: 'Playlist / Song editor', key: 'F5',     hint: 'win.playlist', accent: '' },
  { id: 'rack',     label: 'RACK',     icon: '▦', title: 'Channel Rack',           key: 'F6',     hint: 'win.rack',     accent: '' },
  { id: 'piano',    label: 'PIANO',    icon: '𝅘𝅥𝅮', title: 'Piano Roll',              key: 'F7',     hint: 'win.piano',    accent: '' },
  { id: 'browser',  label: 'BROWSER',  icon: '☰', title: 'Browser',                key: 'Alt+F8', hint: 'win.browser',  accent: 'tb-win-browser' },
  { id: 'mixer',    label: 'MIXER',    icon: '⊟', title: 'Mixer',                  key: 'F9',     hint: 'win.mixer',    accent: 'tb-win-mixer' },
]
const ARRANGEMENTS = [
  { id: 'default',        label: 'Default' },
  { id: 'clean',          label: 'Clean' },
  { id: 'browser-mixer',  label: 'Left Browser / Right Mixer' },
]

function titleFor(id) { return WINDOWS.find(w => w.id === id)?.title ?? id }

// LED state → CSS class for the tri-state / detached illumination matrix.
function winClass(id) {
  const s = windowState(id)
  return { focused: s === 'focused', obscured: s === 'obscured', detached: s === 'detached' }
}

// ── Hover-to-peek: holding a drag over an icon 350 ms brings that window forward
let peekTimer = null, peekId = null
function onIconDragOver(id) {
  if (peekId === id) return
  clearTimeout(peekTimer)
  peekId = id
  peekTimer = setTimeout(() => { activateWindow(id); peekId = null }, 350)
}
function onIconDragLeave() { clearTimeout(peekTimer); peekId = null }

// ── Context + layout menus ────────────────────────────────────────────────────
const ctx = ref({ open: false, x: 0, y: 0, id: null })
const layoutMenu = ref(false)
function openCtx(id, e) { layoutMenu.value = false; ctx.value = { open: true, x: e.clientX, y: e.clientY, id } }
function run(fn, which) { fn(); if (which === 'layout') layoutMenu.value = false; else ctx.value.open = false }
function onGlobalDown(e) {
  if (ctx.value.open && !e.target.closest('.win-menu')) ctx.value.open = false
  if (layoutMenu.value && !e.target.closest('.win-menu--layout') && !e.target.closest('.tb-win-layout')) layoutMenu.value = false
}

// ── Function-key shortcuts (F5–F9, Alt+F8) ────────────────────────────────────
function onKey(e) {
  const t = e.target
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
  let id = null
  if      (e.key === 'F5') id = 'playlist'
  else if (e.key === 'F6') id = 'rack'
  else if (e.key === 'F7') id = 'piano'
  else if (e.key === 'F9') id = 'mixer'
  else if (e.key === 'F8' && e.altKey) id = 'browser'
  if (!id) return
  e.preventDefault()
  activateWindow(id)
}

onMounted(() => {
  window.addEventListener('keydown', onKey)
  window.addEventListener('pointerdown', onGlobalDown, true)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('pointerdown', onGlobalDown, true)
  clearTimeout(peekTimer)
})
</script>

<style scoped>
/* obscured = open but not focused (amber); detached = dual-color (cyan glow). */
.tb-win.obscured {
  border-color: #b9770e; color: #c98a1e; background: #140e02;
}
.tb-win.detached {
  border-color: #1abc9c; color: #1abc9c; background: #06201b;
  box-shadow: 0 0 8px #1abc9c55, inset 0 0 0 1px #9b59b633;
}
.tb-win-detach {
  position: absolute; top: 1px; right: 2px;
  font-size: 8px; color: #1abc9c; line-height: 1;
}
.tb-win { position: relative; }
.tb-win-browser:hover { border-color: #f1c40f; color: #f1c40f; }
.tb-win-browser.focused { border-color: #f1c40f; background: #161200; box-shadow: 0 0 8px #f1c40f33; }
.tb-win-browser.focused .tb-win-lbl { color: #f1c40f; }
.tb-win-layout:hover { border-color: #7b4dd6; color: #c8a0ff; }

.win-menu {
  position: fixed; z-index: 9999; min-width: 150px;
  background: var(--bg-control); border: 1px solid var(--border);
  border-radius: 6px; padding: 4px; box-shadow: 0 6px 24px #000000a0;
}
.win-menu--layout { position: absolute; top: 40px; right: 0; }
.win-menu-title {
  padding: 4px 9px 5px;
  font-family: 'Rajdhani', sans-serif; font-size: 9px; font-weight: 700;
  letter-spacing: 0.16em; color: #5a5a80; border-bottom: 1px solid var(--border-subtle);
}
.win-menu-item {
  display: flex; align-items: center; gap: 7px; padding: 6px 10px;
  font-family: 'Rajdhani', sans-serif; font-size: 12px; font-weight: 600;
  letter-spacing: 0.03em; color: #8080a0; cursor: pointer; border-radius: 4px;
}
.win-menu-item:hover { background: var(--bg-hover); color: var(--text-primary); }
.win-menu-item.on { color: #9b59b6; }
.win-menu-check { font-size: 11px; width: 12px; }
.win-menu-sep { height: 1px; background: var(--border-subtle); margin: 4px 2px; }
</style>
