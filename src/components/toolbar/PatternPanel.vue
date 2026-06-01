<template>
  <!-- Pattern Selector: a text field, a vertical-drag encoder, and an index
       picker in one. Drag/scroll changes the active pattern; right-click / F2
       opens the name+color dialog; the ▾ menu holds the transform macros. -->
  <div class="tb-pattern" v-hint="'pattern'">
    <div class="tb-pat-row">
      <button class="tb-pat-step" title="Previous pattern" @click="step(-1)">‹</button>

      <div
        class="tb-pat-display"
        :class="{ dragging }"
        :style="{ borderColor: cur.color }"
        title="Drag ↕ or scroll to change · right-click / F2 to rename"
        @pointerdown="startDrag"
        @wheel.prevent="onWheel"
        @contextmenu.prevent.stop="openDialog"
        @dblclick="openDialog"
      >
        <span class="tb-pat-dot" :style="{ background: cur.color }" />
        <span class="tb-pat-num" :style="{ color: cur.color }">{{ index + 1 }}</span>
        <span class="tb-pat-name">{{ cur.name }}</span>
      </div>

      <button class="tb-pat-step" title="Next pattern" @click="step(1)">›</button>
      <button class="tb-pat-add" title="New pattern" @click="onNew">+</button>
      <button class="tb-pat-menu" v-hint="'pattern.menu'" title="Pattern menu" @click.stop="openMenu">▾</button>
    </div>

    <!-- ── Transform / macro dropdown ─────────────────────────────────────────-->
    <div v-if="menu.open" class="pat-menu" @click.stop>
      <div class="pat-menu-item" @click="run(onNew)">New pattern</div>
      <div class="pat-menu-item" @click="run(() => duplicatePattern(cur.id))">Duplicate</div>
      <div class="pat-menu-item" @click="run(openDialog)">Rename / recolor…</div>
      <div class="pat-menu-sep" />
      <div class="pat-menu-item" @click="run(() => splitByChannel(cur.id))">Split by channel</div>
      <div class="pat-menu-sep" />
      <div class="pat-menu-item danger" :class="{ disabled: patterns.length <= 1 }"
           @click="patterns.length > 1 && run(() => removePattern(cur.id))">Delete pattern</div>
    </div>

    <!-- ── Name & color dialog ────────────────────────────────────────────────-->
    <div v-if="dialog.open" class="pat-dialog" @click.stop>
      <div class="pat-dialog-title">PATTERN {{ index + 1 }}</div>
      <input
        ref="nameInput"
        v-model="cur.name"
        class="pat-dialog-input"
        :style="{ borderColor: cur.color }"
        @keydown.enter="closeDialog"
        @keydown.esc="closeDialog"
        @keydown.f2.prevent="randomizeColor"
      />
      <div class="pat-dialog-swatches">
        <button
          v-for="c in PALETTE"
          :key="c"
          class="pat-swatch"
          :class="{ on: cur.color === c }"
          :style="{ background: c }"
          @click="cur.color = c"
        />
      </div>
      <div class="pat-dialog-actions">
        <button class="pat-dialog-btn" @click="randomizeColor">⟳ Random (F2)</button>
        <button class="pat-dialog-btn ok" @click="closeDialog">Done</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useStudio } from '../../store/studio.js'

const {
  patterns, currentPatternId,
  addPattern, removePattern, duplicatePattern, splitByChannel,
} = useStudio()

const index = computed(() => Math.max(0, patterns.findIndex(p => p.id === currentPatternId.value)))
const cur   = computed(() => patterns[index.value] ?? patterns[0])

function setIndex(i) {
  const clamped = Math.max(0, Math.min(patterns.length - 1, i))
  currentPatternId.value = patterns[clamped].id
}
function step(d) { setIndex(index.value + d) }

function onNew() { addPattern() }   // store appends + selects the new pattern

// ── Vertical-drag encoder (raw dy → floored integer index) ────────────────────
const dragging = ref(false)
let dragFloat = 0
function startDrag(e) {
  if (e.button !== 0) return
  e.preventDefault()
  dragging.value = true
  dragFloat = index.value + 0.5            // center so a half-step in either dir flips
  e.currentTarget.requestPointerLock?.()
  window.addEventListener('pointermove', onDrag)
  window.addEventListener('pointerup', stopDrag)
}
function onDrag(e) {
  // Up (negative movementY) increments the pattern ID; ~12px per step.
  dragFloat += -e.movementY / 12
  setIndex(Math.floor(dragFloat))          // floor to nearest clean integer
}
function stopDrag() {
  dragging.value = false
  document.exitPointerLock?.()
  window.removeEventListener('pointermove', onDrag)
  window.removeEventListener('pointerup', stopDrag)
}
function onWheel(e) { step(e.deltaY < 0 ? 1 : -1) }

// ── Dropdown menu ─────────────────────────────────────────────────────────────
const menu = ref({ open: false })
function openMenu() { menu.value.open = true }
function run(fn) { fn(); menu.value.open = false }

// ── Name & color dialog (F2 macro) ────────────────────────────────────────────
const PALETTE = [
  '#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#1abc9c', '#3498db',
  '#9b59b6', '#e84393', '#4ecdc4', '#a0d911', '#fa8231', '#778beb',
]
const dialog = ref({ open: false })
const nameInput = ref(null)
function openDialog() {
  menu.value.open = false
  dialog.value.open = true
  nextTick(() => nameInput.value?.select())
}
function closeDialog() { dialog.value.open = false }

// Cycle a pseudo-random color, kept mid-lightness so the label stays legible.
function hslToHex(h, s, l) {
  const a = s * Math.min(l, 1 - l)
  const f = n => {
    const k = (n + h / 30) % 12
    const c = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)
    return Math.round(255 * c).toString(16).padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}
function randomizeColor() {
  const h = Math.floor(Math.random() * 360)
  cur.value.color = hslToHex(h, 0.62 + Math.random() * 0.14, 0.5 + Math.random() * 0.1)
}

// ── Global key + outside-click handling ───────────────────────────────────────
function onKey(e) {
  if (e.key !== 'F2') return
  const t = e.target
  // While the dialog input is focused, its own handler cycles the color.
  if (dialog.value.open) return
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
  e.preventDefault()
  openDialog()
}
function onGlobalDown(e) {
  if (menu.value.open && !e.target.closest('.pat-menu') && !e.target.closest('.tb-pat-menu')) menu.value.open = false
  if (dialog.value.open && !e.target.closest('.pat-dialog') && !e.target.closest('.tb-pat-display')) dialog.value.open = false
}
onMounted(() => {
  window.addEventListener('keydown', onKey)
  window.addEventListener('pointerdown', onGlobalDown, true)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('pointerdown', onGlobalDown, true)
  window.removeEventListener('pointermove', onDrag)
  window.removeEventListener('pointerup', stopDrag)
})
</script>

<style scoped>
.tb-pattern { position: relative; display: flex; align-items: center; flex-shrink: 0; }
.tb-pat-row { display: flex; align-items: center; gap: 3px; }

.tb-pat-step, .tb-pat-add, .tb-pat-menu {
  height: 22px; min-width: 18px;
  display: flex; align-items: center; justify-content: center;
  background: transparent; border: 1px solid var(--border-subtle); border-radius: 4px;
  color: #50506e; font-family: 'Share Tech Mono', monospace; font-size: 13px;
  cursor: pointer; transition: all 0.1s; outline: none; padding: 0 4px;
}
.tb-pat-step:hover, .tb-pat-menu:hover { border-color: #404068; color: #9090c0; }
.tb-pat-add { color: #2a7035; }
.tb-pat-add:hover { border-color: #2ecc71; color: #2ecc71; }

.tb-pat-display {
  display: flex; align-items: center; gap: 6px;
  height: 22px; padding: 0 9px; min-width: 110px;
  border: 1px solid var(--border-subtle); border-radius: 4px;
  background: var(--bg-deeper); cursor: ns-resize; user-select: none;
  transition: box-shadow 0.1s;
}
.tb-pat-display.dragging { box-shadow: 0 0 9px currentColor; }
.tb-pat-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.tb-pat-num {
  font-family: 'Share Tech Mono', monospace; font-size: 12px; font-weight: 700;
  min-width: 14px; text-align: right;
}
.tb-pat-name {
  font-family: 'Rajdhani', sans-serif; font-size: 12px; font-weight: 600;
  letter-spacing: 0.03em; color: #b0b0d0;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 130px;
}

/* ── Dropdown menu ─────────────────────────────────────────────────────────── */
.pat-menu {
  position: absolute; top: 26px; right: 0; z-index: 9999; min-width: 150px;
  background: var(--bg-control); border: 1px solid var(--border);
  border-radius: 6px; padding: 4px; box-shadow: 0 6px 24px #000000a0;
}
.pat-menu-item {
  padding: 6px 10px;
  font-family: 'Rajdhani', sans-serif; font-size: 12px; font-weight: 600;
  letter-spacing: 0.03em; color: #8080a0; cursor: pointer; border-radius: 4px;
}
.pat-menu-item:hover { background: var(--bg-hover); color: var(--text-primary); }
.pat-menu-item.danger:hover { background: #2a0e0e; color: #e74c3c; }
.pat-menu-item.disabled { color: #34344a; cursor: not-allowed; }
.pat-menu-item.disabled:hover { background: transparent; color: #34344a; }
.pat-menu-sep { height: 1px; background: var(--border-subtle); margin: 4px 2px; }

/* ── Name & color dialog ───────────────────────────────────────────────────── */
.pat-dialog {
  position: absolute; top: 26px; left: 0; z-index: 9999; width: 200px;
  background: var(--bg-control); border: 1px solid var(--border);
  border-radius: 8px; padding: 10px; box-shadow: 0 8px 28px #000000b0;
}
.pat-dialog-title {
  font-family: 'Rajdhani', sans-serif; font-size: 9px; font-weight: 700;
  letter-spacing: 0.18em; color: #5a5a80; margin-bottom: 6px;
}
.pat-dialog-input {
  width: 100%; box-sizing: border-box;
  background: var(--bg-base); border: 1px solid var(--border); border-radius: 4px;
  color: var(--text-primary); padding: 5px 7px;
  font-family: 'Rajdhani', sans-serif; font-size: 13px; font-weight: 600;
  outline: none; margin-bottom: 8px;
}
.pat-dialog-swatches {
  display: grid; grid-template-columns: repeat(6, 1fr); gap: 5px; margin-bottom: 9px;
}
.pat-swatch {
  height: 18px; border-radius: 4px; border: 1px solid #00000040; cursor: pointer;
  transition: transform 0.08s; outline: none;
}
.pat-swatch:hover { transform: scale(1.12); }
.pat-swatch.on { box-shadow: 0 0 0 2px var(--bg-control), 0 0 0 3px #fff; }
.pat-dialog-actions { display: flex; gap: 6px; }
.pat-dialog-btn {
  flex: 1; padding: 5px 0; border-radius: 4px;
  border: 1px solid var(--border); background: transparent; color: var(--text-muted);
  font-family: 'Rajdhani', sans-serif; font-size: 11px; font-weight: 700;
  letter-spacing: 0.05em; cursor: pointer; transition: all 0.12s;
}
.pat-dialog-btn:hover { border-color: #7b4dd6; color: #c8a0ff; }
.pat-dialog-btn.ok { border-color: #2ecc71; color: #2ecc71; }
.pat-dialog-btn.ok:hover { background: #081a09; }
</style>
