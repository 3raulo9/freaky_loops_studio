<template>
  <!-- ── Root drop-zone grid ────────────────────────────────────────────────
       Two stacked rows of standalone micro-panels. In edit mode it becomes a
       live drag surface: panels quantize onto boundaries and can move freely
       between the primary and secondary rows. -->
  <header
    ref="barEl"
    class="topbar"
    :class="{ 'topbar--bottom': dock === 'bottom', 'topbar--edit': editMode }"
    @contextmenu.prevent="openMenu"
  >
    <div
      v-for="row in [0, 1]"
      :key="row"
      class="tb-line"
      :class="[
        row === 0 ? 'tb-line--primary' : 'tb-line--secondary',
        { 'tb-line--edit': editMode },
      ]"
      @dragover="onDragOver($event, row)"
      @drop.prevent="onDrop"
    >
      <template v-for="(slot, vi) in slotsByRow[row]" :key="slot.id">
        <!-- Ghost placeholder shows the quantized landing spot before commit -->
        <div v-if="editMode && ghostRow === row && ghostIndex === vi" class="tb-ghost" />

        <!-- Auto separator between two adjacent real panels -->
        <div
          v-if="vi > 0 && slot.id !== SPACER_ID && slotsByRow[row][vi - 1].id !== SPACER_ID"
          class="tb-sep"
        />

        <!-- Flex-filler pseudo-panel -->
        <div
          v-if="slot.id === SPACER_ID"
          class="tb-slot tb-slot--spacer tb-spacer-panel"
          :class="{ 'tb-slot--edit': editMode, 'tb-slot--dragging': dragId === slot.id }"
          :draggable="editMode"
          @dragstart="onDragStart(slot.id, $event)"
          @dragend="onDragEnd"
        >
          <span v-if="editMode" class="tb-slot-tag">⟷ flex</span>
          <span v-if="editMode" class="tb-slot-hide" @click.stop="hide(slot.id)" title="Hide">×</span>
        </div>

        <!-- Real micro-panel -->
        <div
          v-else
          class="tb-slot"
          :class="{
            'tb-slot--edit': editMode,
            'tb-slot--dragging': dragId === slot.id,
            'tb-slot--grow': PANELS[slot.id].grow,
          }"
          :draggable="editMode"
          @dragstart="onDragStart(slot.id, $event)"
          @dragend="onDragEnd"
        >
          <div class="tb-slot-content" :class="{ 'tb-slot-content--locked': editMode }">
            <component :is="PANELS[slot.id].component" />
          </div>
          <span v-if="editMode" class="tb-slot-tag">{{ PANELS[slot.id].label }}</span>
          <span v-if="editMode" class="tb-slot-hide" @click.stop="hide(slot.id)" title="Hide panel">×</span>
        </div>
      </template>

      <!-- Trailing ghost (drop at far end of this row) -->
      <div v-if="editMode && ghostRow === row && ghostIndex === slotsByRow[row].length" class="tb-ghost" />

      <!-- Empty-row drop hint -->
      <div v-if="editMode && !slotsByRow[row].length" class="tb-line-empty">
        drop a panel here · {{ row === 0 ? 'primary row' : 'secondary row' }}
      </div>
    </div>
  </header>

  <!-- ── Edit-mode tray ─────────────────────────────────────────────────────
       Re-mount hidden panels, reset, flip dock, or leave edit mode. -->
  <div v-if="editMode" class="tb-editbar" :class="{ 'tb-editbar--bottom': dock === 'bottom' }">
    <span class="tb-editbar-title">EDIT TOOLBAR</span>
    <span class="tb-editbar-hint">drag panels to rearrange or move between rows · drag toward the window edge to re-dock</span>
    <div class="tb-editbar-hidden" v-if="hiddenSlots.length">
      <span class="tb-editbar-lbl">HIDDEN</span>
      <button
        v-for="slot in hiddenSlots"
        :key="slot.id"
        class="tb-chip"
        @click="show(slot.id)"
        title="Re-add panel"
      >+ {{ slot.id === SPACER_ID ? 'Flex' : PANELS[slot.id].label }}</button>
    </div>
    <div class="tb-editbar-spacer" />
    <button class="tb-editbar-btn" @click="toggleDock">DOCK {{ dock === 'top' ? '▼ BOTTOM' : '▲ TOP' }}</button>
    <button class="tb-editbar-btn" @click="resetLayout">RESET</button>
    <button class="tb-editbar-btn tb-editbar-done" @click="editMode = false">DONE</button>
  </div>

  <!-- ── Context menu ───────────────────────────────────────────────────────-->
  <div
    v-if="menu.open"
    class="tb-menu"
    :style="{ left: menu.x + 'px', top: menu.y + 'px' }"
  >
    <div class="tb-menu-item" @click="editMode = !editMode; menu.open = false">
      {{ editMode ? '✓ ' : '' }}Edit…
    </div>
    <div class="tb-menu-item" @click="toggleDock(); menu.open = false">
      Dock to {{ dock === 'top' ? 'bottom' : 'top' }}
    </div>
    <div class="tb-menu-sep" />
    <div class="tb-menu-item" @click="resetLayout(); menu.open = false">Reset layout</div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { PANELS, DEFAULT_LAYOUT, SPACER_ID } from './toolbar/registry.js'
import './toolbar/toolbar.css'

const LS_KEY = 'fl.toolbar.layout.v2'

// ── Layout state ──────────────────────────────────────────────────────────────
const layout   = ref(loadLayout())
const dock     = ref(loadDock())
const editMode = ref(false)
const barEl    = ref(null)

const visibleSlots = computed(() => layout.value.filter(s => s.visible))
const hiddenSlots  = computed(() => layout.value.filter(s => !s.visible))

// Visible slots bucketed by row, preserving their relative order.
const slotsByRow = computed(() => ({
  0: visibleSlots.value.filter(s => (s.row ?? 0) === 0),
  1: visibleSlots.value.filter(s => (s.row ?? 0) === 1),
}))

// ── Persistence (serialize coords + visibility + row, reconcile on load) ──────
function loadLayout() {
  let saved = null
  try { saved = JSON.parse(localStorage.getItem(LS_KEY))?.layout } catch {}
  const known  = new Set([...Object.keys(PANELS), SPACER_ID])
  const defRow = Object.fromEntries(DEFAULT_LAYOUT.map(d => [d.id, d.row ?? 0]))
  if (!Array.isArray(saved)) return DEFAULT_LAYOUT.map(s => ({ ...s }))
  // Keep saved order/row, drop unknown ids.
  const result = saved.filter(s => s && known.has(s.id)).map(s => ({
    id: s.id,
    visible: s.visible !== false,
    row: s.row === 1 ? 1 : (s.row === 0 ? 0 : (defRow[s.id] ?? 0)),
  }))
  const seen = new Set(result.map(s => s.id))
  // Splice panels added since the layout was saved in at their default index.
  DEFAULT_LAYOUT.forEach((def, i) => {
    if (!seen.has(def.id)) result.splice(Math.min(i, result.length), 0, { ...def })
  })
  return result
}
function loadDock() {
  try { return JSON.parse(localStorage.getItem(LS_KEY))?.dock === 'bottom' ? 'bottom' : 'top' }
  catch { return 'top' }
}
function persist() {
  try { localStorage.setItem(LS_KEY, JSON.stringify({ layout: layout.value, dock: dock.value })) } catch {}
}

// ── Show / hide panels ────────────────────────────────────────────────────────
function hide(id) {
  const s = layout.value.find(p => p.id === id)
  if (s) { s.visible = false; persist() }
}
function show(id) {
  const s = layout.value.find(p => p.id === id)
  if (s) { s.visible = true; persist() }
}

// ── Drag-to-reorder with quantized boundary snapping (row-aware) ──────────────
const dragId     = ref(null)
const ghostRow   = ref(-1)
const ghostIndex = ref(-1)

function onDragStart(id, e) {
  dragId.value = id
  e.dataTransfer.effectAllowed = 'move'
  // Firefox requires data to be set for a drag to start.
  try { e.dataTransfer.setData('text/plain', id) } catch {}
}

function onDragOver(e, row) {
  if (!editMode.value || !dragId.value) return
  e.preventDefault()
  e.dataTransfer.dropEffect = 'move'

  // Quantize the pointer X onto the nearest slot boundary within this row.
  const slots = [...e.currentTarget.querySelectorAll('.tb-slot')]
  let idx = slots.length
  for (let i = 0; i < slots.length; i++) {
    const r = slots[i].getBoundingClientRect()
    if (e.clientX < r.left + r.width / 2) { idx = i; break }
  }
  ghostRow.value   = row
  ghostIndex.value = idx

  // Boundary-collision re-docking: dragging into the window's top/bottom flips it.
  const h = window.innerHeight
  if (e.clientY > h * 0.9 && dock.value !== 'bottom') { dock.value = 'bottom' }
  else if (e.clientY < h * 0.1 && dock.value !== 'top') { dock.value = 'top' }
}

function onDrop() {
  if (!dragId.value || ghostIndex.value < 0) return onDragEnd()
  const item = layout.value.find(s => s.id === dragId.value)
  if (!item) return onDragEnd()

  const targetRow = ghostRow.value
  const fromRow   = item.row ?? 0

  // The target row as the user saw it (still includes the dragged item).
  const rendered = visibleSlots.value.filter(s => (s.row ?? 0) === targetRow)
  let idx = Math.max(0, Math.min(rendered.length, ghostIndex.value))
  const curPos = rendered.findIndex(s => s.id === item.id)
  if (fromRow === targetRow && curPos !== -1 && curPos < idx) idx--   // account for self-removal

  const target = rendered.filter(s => s.id !== item.id)
  item.row = targetRow
  target.splice(Math.max(0, Math.min(target.length, idx)), 0, item)

  const otherRow = targetRow === 0 ? 1 : 0
  const other  = visibleSlots.value.filter(s => (s.row ?? 0) === otherRow && s.id !== item.id)
  const hidden = layout.value.filter(s => !s.visible)
  layout.value = targetRow === 0 ? [...target, ...other, ...hidden] : [...other, ...target, ...hidden]
  persist()
  onDragEnd()
}

function onDragEnd() {
  dragId.value = null
  ghostRow.value = -1
  ghostIndex.value = -1
}

// ── Docking ───────────────────────────────────────────────────────────────────
function toggleDock() {
  dock.value = dock.value === 'top' ? 'bottom' : 'top'
  persist()
}

// ── Reset ─────────────────────────────────────────────────────────────────────
function resetLayout() {
  layout.value = DEFAULT_LAYOUT.map(s => ({ ...s }))
  dock.value = 'top'
  persist()
}

// ── Context menu ──────────────────────────────────────────────────────────────
const menu = ref({ open: false, x: 0, y: 0 })
function openMenu(e) {
  menu.value = { open: true, x: e.clientX, y: e.clientY }
}
function closeMenu() { menu.value.open = false }

onMounted(() => window.addEventListener('pointerdown', onGlobalDown, true))
onBeforeUnmount(() => window.removeEventListener('pointerdown', onGlobalDown, true))
function onGlobalDown(e) {
  if (menu.value.open && !e.target.closest('.tb-menu')) closeMenu()
}
</script>

<style scoped>
/* ── Root drop-zone grid (two stacked rows) ────────────────────────────────── */
.topbar {
  display: flex;
  flex-direction: column;
  background: linear-gradient(180deg, var(--bg-panel) 0%, var(--bg-deeper) 100%);
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
  overflow: hidden;
  user-select: none;
  position: relative;
  z-index: 50;            /* toolbar keeps z-index supremacy over the body */
}
/* Re-docked to the floor: flip border + flex ordering. */
.topbar--bottom {
  order: 99;
  border-bottom: none;
  border-top: 1px solid var(--border-subtle);
  background: linear-gradient(0deg, var(--bg-panel) 0%, var(--bg-deeper) 100%);
}
.topbar--edit {
  background: linear-gradient(180deg, #14101e 0%, #0c0a14 100%);
  overflow: visible;
}

/* ── Rows ──────────────────────────────────────────────────────────────────── */
.tb-line {
  display: flex;
  align-items: center;
  gap: 0;
  padding: 0 10px;
  position: relative;
}
.tb-line--primary   { min-height: 48px; }
.tb-line--secondary {
  min-height: 30px;
  border-top: 1px solid var(--border-subtle);   /* the FL inter-row divider */
  background: linear-gradient(180deg, var(--bg-deeper) 0%, var(--bg-base) 100%);
}
.topbar--bottom .tb-line--secondary { background: linear-gradient(0deg, var(--bg-deeper) 0%, var(--bg-base) 100%); }
.tb-line--edit { padding-top: 4px; padding-bottom: 4px; }
.tb-line-empty {
  font-family: 'Share Tech Mono', monospace; font-size: 9px; color: #3a3a55;
  padding: 6px 4px; pointer-events: none;
}

/* ── Slots (panel wrappers) ────────────────────────────────────────────────── */
.tb-slot {
  position: relative;
  display: flex;
  align-items: center;
  flex-shrink: 0;
}
.tb-slot--spacer { flex: 1; min-width: 8px; }
.tb-slot--grow { flex: 1; min-width: 160px; max-width: 520px; }
.tb-slot--grow .tb-slot-content { width: 100%; display: flex; }

.tb-slot--edit {
  cursor: grab;
  border: 1px dashed #3a2f55;
  border-radius: 6px;
  padding: 2px 4px;
  margin: 0 2px;
  transition: border-color 0.12s, background 0.12s;
}
.tb-slot--edit:hover { border-color: #7b4dd6; background: #16102444; }
.tb-slot--spacer.tb-slot--edit {
  justify-content: center;
  min-height: 30px;
  background: repeating-linear-gradient(45deg, #140e22, #140e22 6px, #0e0a18 6px, #0e0a18 12px);
}
.tb-slot--dragging { opacity: 0.35; }

/* Panel contents are inert while editing so drags don't trigger controls. */
.tb-slot-content--locked { pointer-events: none; }

/* Slot chrome (only visible in edit mode) */
.tb-slot-tag {
  position: absolute;
  left: 50%;
  top: -11px;
  transform: translateX(-50%);
  font-family: 'Rajdhani', sans-serif;
  font-size: 7px; font-weight: 700; letter-spacing: 0.1em;
  color: #7b4dd6; white-space: nowrap; pointer-events: none;
  text-transform: uppercase;
}
.tb-slot-hide {
  position: absolute;
  top: -8px; right: -6px;
  width: 15px; height: 15px;
  display: flex; align-items: center; justify-content: center;
  background: #2a1010; border: 1px solid #e74c3c; border-radius: 50%;
  color: #e74c3c; font-size: 12px; line-height: 1; cursor: pointer; z-index: 2;
  transition: background 0.1s;
}
.tb-slot-hide:hover { background: #e74c3c; color: #fff; }

/* Quantized drop placeholder */
.tb-ghost {
  width: 4px;
  align-self: stretch;
  margin: 8px 3px;
  border-radius: 3px;
  background: #7b4dd6;
  box-shadow: 0 0 10px #7b4dd6aa;
  flex-shrink: 0;
}

/* ── Edit-mode tray ────────────────────────────────────────────────────────── */
.tb-editbar {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 30px;
  padding: 0 12px;
  background: #0c0a14;
  border-bottom: 1px solid #2a2040;
  flex-shrink: 0;
  z-index: 49;
}
.tb-editbar--bottom { order: 98; border-bottom: none; border-top: 1px solid #2a2040; }
.tb-editbar-title {
  font-family: 'Rajdhani', sans-serif; font-size: 10px; font-weight: 700;
  letter-spacing: 0.2em; color: #7b4dd6;
}
.tb-editbar-hint {
  font-family: 'Share Tech Mono', monospace; font-size: 9px; color: #3a3a55;
}
.tb-editbar-hidden { display: flex; align-items: center; gap: 5px; }
.tb-editbar-lbl {
  font-family: 'Rajdhani', sans-serif; font-size: 8px; font-weight: 700;
  letter-spacing: 0.15em; color: #40405a;
}
.tb-editbar-spacer { flex: 1; }
.tb-chip {
  font-family: 'Rajdhani', sans-serif; font-size: 10px; font-weight: 700;
  letter-spacing: 0.05em; padding: 2px 8px; border-radius: 10px;
  border: 1px solid #4a2a88; background: #1a0a30; color: #b080ff;
  cursor: pointer; transition: all 0.1s;
}
.tb-chip:hover { background: #2a1048; border-color: #7b2fff; color: #d0a0ff; }
.tb-editbar-btn {
  font-family: 'Rajdhani', sans-serif; font-size: 10px; font-weight: 700;
  letter-spacing: 0.08em; padding: 3px 10px; border-radius: 4px;
  border: 1px solid var(--border); background: transparent; color: var(--text-muted);
  cursor: pointer; transition: all 0.12s;
}
.tb-editbar-btn:hover { border-color: #7b4dd6; color: #c8a0ff; }
.tb-editbar-done { border-color: #2ecc71; color: #2ecc71; }
.tb-editbar-done:hover { background: #081a09; border-color: #2ecc71; color: #2ecc71; }

/* ── Context menu ──────────────────────────────────────────────────────────── */
.tb-menu {
  position: fixed;
  z-index: 9999;
  min-width: 150px;
  background: var(--bg-control);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px;
  box-shadow: 0 6px 24px #000000a0;
}
.tb-menu-item {
  padding: 6px 10px;
  font-family: 'Rajdhani', sans-serif; font-size: 12px; font-weight: 600;
  letter-spacing: 0.04em; color: #9090b0; cursor: pointer; border-radius: 4px;
}
.tb-menu-item:hover { background: var(--bg-hover); color: var(--text-primary); }
.tb-menu-sep { height: 1px; background: var(--border-subtle); margin: 4px 2px; }
</style>
