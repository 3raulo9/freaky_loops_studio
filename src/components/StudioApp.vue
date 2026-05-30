<template>
  <div class="studio">

    <TopBar />

    <!-- ── Main body ──────────────────────────────────────────────────── -->
    <div class="studio-body">

      <!-- ── Left: Channel Rack / Playlist / Mixer ─────────────────── -->
      <div class="main-area">
        <ChannelRack v-if="mainView === 'sequencer'" />
        <Playlist    v-else-if="mainView === 'playlist'" />
        <Mixer       v-else-if="mainView === 'mixer'" />
      </div>

      <!-- ── Right: Properties panel (sequencer only) ────────────────── -->
      <aside class="props-panel" v-if="mainView === 'sequencer'" @click="showModulePicker = false">
        <div class="props-header" :style="{ borderColor: selectedChannel.color }">
          <span class="props-name" :style="{ color: selectedChannel.color }">{{ selectedChannel.name }}</span>
          <span class="props-type">{{ selectedChannel.type }}</span>
        </div>

        <!-- Wave select (melodic only) -->
        <div v-if="selectedChannel.type === 'melodic'" class="props-row">
          <span class="props-label">WAVE</span>
          <select v-model="selectedChannel.params.wave" class="props-select">
            <option value="sawtooth">Sawtooth</option>
            <option value="square">Square</option>
            <option value="sine">Sine</option>
            <option value="triangle">Triangle</option>
          </select>
        </div>

        <!-- Core knobs -->
        <div class="props-knobs">
          <Knob
            v-for="knob in selectedChannel.knobs"
            :key="knob.key"
            v-model="selectedChannel.params[knob.key]"
            :min="knob.min" :max="knob.max"
            :label="knob.label" :color="selectedChannel.color"
            :size="48" :decimals="knob.decimals ?? 2"
          />
        </div>

        <!-- ── Module tabs ───────────────────────────────────────────── -->
        <div class="module-section">

          <!-- Active module tabs + add button -->
          <div class="module-tabs-row">
            <button
              v-for="modId in selectedChannel.activeModules"
              :key="modId"
              class="mod-tab"
              :class="{ active: activeModuleTab === modId }"
              :style="{ '--acc': selectedChannel.color }"
              @click="activeModuleTab = activeModuleTab === modId ? null : modId"
            >
              {{ DRUM_MODULE_DEFS[modId]?.label }}
              <span class="mod-tab-x" @click.stop="onRemoveModule(modId)">×</span>
            </button>

            <!-- Add module picker -->
            <div class="mod-add-wrap" @click.stop>
              <button class="mod-add-btn" :style="{ color: selectedChannel.color }"
                @click="showModulePicker = !showModulePicker" title="Add module">+</button>
              <div v-if="showModulePicker" class="mod-picker">
                <div class="mod-picker-header">ADD MODULE</div>
                <template v-for="(mod, id) in DRUM_MODULE_DEFS" :key="id">
                  <div
                    v-if="isModuleAvailable(id)"
                    class="mod-picker-item"
                    :class="{ taken: selectedChannel.activeModules.includes(id) }"
                    @click="onAddModule(id)"
                  >
                    {{ mod.label }}
                    <span v-if="selectedChannel.activeModules.includes(id)" class="mod-picker-check">✓</span>
                  </div>
                </template>
              </div>
            </div>
          </div>

          <!-- Active tab knobs -->
          <div v-if="activeModuleTab && DRUM_MODULE_DEFS[activeModuleTab]" class="module-knobs">
            <div class="module-knobs-title" :style="{ color: selectedChannel.color }">
              {{ DRUM_MODULE_DEFS[activeModuleTab].label }}
            </div>
            <Knob
              v-for="knob in DRUM_MODULE_DEFS[activeModuleTab].knobs"
              :key="knob.key"
              v-model="selectedChannel.params[knob.key]"
              :min="knob.min" :max="knob.max"
              :label="knob.label" :color="selectedChannel.color"
              :size="48" :decimals="knob.decimals ?? 2"
            />
          </div>
        </div>

        <!-- Keyboard hint -->
        <div class="props-kb-hint">
          <div class="kb-row">⌨ Z–M&nbsp;&nbsp;Q–U</div>
          <div class="kb-row">[ ] octave: {{ kbOctave }}</div>
        </div>

        <!-- Clear button -->
        <button class="props-clr" @click="clearChannel(selectedChannel.id)">CLR PATTERN</button>
      </aside>

    </div>

    <!-- ── Render modal ──────────────────────────────────────────────── -->
    <RenderModal v-if="renderModalOpen" @close="renderModalOpen = false" />

    <!-- ── Bottom: Piano Roll panel ──────────────────────────────────── -->
    <div
      v-if="pianoRollOpen && mainView === 'sequencer'"
      class="piano-roll-panel"
      :style="{ height: prHeight + 'px' }"
    >
      <!-- Drag handle to resize -->
      <div class="pr-resize-handle" @mousedown="startResize" title="Drag to resize" />

      <!-- Piano Roll header -->
      <div class="pr-panel-header" :style="{ '--accent': selectedChannel.color }">
        <span class="pr-panel-title">PIANO ROLL</span>
        <span class="pr-panel-ch" :style="{ color: selectedChannel.color }">{{ selectedChannel.name }}</span>
        <div class="pr-mode-toggle" v-if="selectedChannel.type === 'melodic'">
          <button
            class="prm-btn"
            :class="{ active: selectedChannel.mode === 'steps' }"
            @click="selectedChannel.mode = 'steps'"
          >STEPS</button>
          <button
            class="prm-btn"
            :class="{ active: selectedChannel.mode === 'piano' }"
            @click="selectedChannel.mode = 'piano'"
          >PIANO ROLL</button>
        </div>
        <button class="pr-close" @click="pianoRollOpen = false">✕</button>
      </div>

      <!-- Piano Roll or Step Grid content -->
      <PianoRoll v-if="selectedChannel.mode === 'piano'" :ch="selectedChannel" />
      <StepGrid  v-else :ch="selectedChannel" />
    </div>

  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useStudio } from '../store/studio.js'
import { DRUM_MODULE_DEFS } from '../audio/drumModules.js'
import TopBar      from './TopBar.vue'
import ChannelRack from './ChannelRack.vue'
import Playlist    from './Playlist.vue'
import Mixer       from './Mixer.vue'
import PianoRoll   from './PianoRoll.vue'
import StepGrid    from './StepGrid.vue'
import Knob        from './Knob.vue'
import RenderModal from './RenderModal.vue'

const {
  mainView, selectedChannel, kbOctave, pianoRollOpen, renderModalOpen,
  clearChannel, handleKeyDown, handleKeyUp,
  addDrumModule, removeDrumModule,
} = useStudio()

// ── Module panel state ────────────────────────────────────────────────────────
const activeModuleTab   = ref(null)
const showModulePicker  = ref(false)

function isModuleAvailable(moduleId) {
  return !!DRUM_MODULE_DEFS[moduleId]
}

function onAddModule(moduleId) {
  if (selectedChannel.value.activeModules.includes(moduleId)) return
  addDrumModule(selectedChannel.value.id, moduleId)
  activeModuleTab.value  = moduleId
  showModulePicker.value = false
}

function onRemoveModule(moduleId) {
  removeDrumModule(selectedChannel.value.id, moduleId)
  if (activeModuleTab.value === moduleId) activeModuleTab.value = null
}

// Reset module panel when switching to a different channel
watch(() => selectedChannel.value?.id, () => {
  activeModuleTab.value  = null
  showModulePicker.value = false
})

// ── Global keyboard listeners ────────────────────────────────────────────────
onMounted(() => {
  window.addEventListener('keydown', handleKeyDown)
  window.addEventListener('keyup',   handleKeyUp)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeyDown)
  window.removeEventListener('keyup',   handleKeyUp)
})

// ── Piano roll panel resize ──────────────────────────────────────────────────
const prHeight = ref(240)
let resizing = false
let resizeStartY = 0
let resizeStartH = 0

function startResize(e) {
  resizing      = true
  resizeStartY  = e.clientY
  resizeStartH  = prHeight.value
  window.addEventListener('mousemove', onResize)
  window.addEventListener('mouseup',   stopResize)
}
function onResize(e) {
  if (!resizing) return
  const dy = resizeStartY - e.clientY
  prHeight.value = Math.max(120, Math.min(520, resizeStartH + dy))
}
function stopResize() {
  resizing = false
  window.removeEventListener('mousemove', onResize)
  window.removeEventListener('mouseup',   stopResize)
}
</script>

<style scoped>
.studio {
  display: flex; flex-direction: column;
  width: 100%; height: 100vh;
  background: #0e0e14; color: #e0e0ee;
  overflow: hidden;
}

/* ── Body ────────────────────────────────────────────────────────── */
.studio-body {
  display: flex;
  flex: 1;
  overflow: hidden;
  min-height: 0;
}
.main-area {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* ── Properties panel ────────────────────────────────────────────── */
.props-panel {
  width: 160px;
  min-width: 160px;
  background: #0c0c16;
  border-left: 1px solid #1a1a28;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  padding-bottom: 10px;
}
.props-header {
  padding: 10px 12px 8px;
  border-bottom: 2px solid;
  border-left: none;
  margin-bottom: 8px;
}
.props-name {
  font-family: 'Rajdhani', sans-serif; font-size: 14px; font-weight: 700;
  letter-spacing: 0.12em; display: block;
}
.props-type {
  font-family: 'Share Tech Mono', monospace; font-size: 9px; color: #303048;
  text-transform: uppercase;
}

.props-row {
  display: flex; flex-direction: column; gap: 4px; padding: 0 10px 8px;
}
.props-label {
  font-family: 'Rajdhani', sans-serif; font-size: 9px; font-weight: 600;
  letter-spacing: 0.15em; color: #40405a; text-transform: uppercase;
}
.props-select {
  background: #141422; border: 1px solid #252535; color: #a0a0c0;
  padding: 4px 6px; border-radius: 4px;
  font-family: 'Share Tech Mono', monospace; font-size: 11px;
  cursor: pointer; outline: none; width: 100%;
}
.props-select:focus { border-color: #4a4a7a; }

.props-knobs {
  display: flex; flex-direction: column; align-items: center; gap: 10px;
  padding: 6px 8px;
}

.props-kb-hint {
  margin: auto 0 0; padding: 10px 10px 0;
  font-family: 'Share Tech Mono', monospace; font-size: 9px; color: #25253a;
  line-height: 1.7;
}
.kb-row { white-space: nowrap; }

.props-clr {
  margin: 10px 10px 0;
  font-family: 'Rajdhani', sans-serif; font-size: 11px; font-weight: 700;
  letter-spacing: 0.1em; padding: 5px 0;
  border: 1px solid #252535; border-radius: 5px;
  background: transparent; color: #404058; cursor: pointer; transition: all 0.12s;
}
.props-clr:hover { border-color: #9b59b6; color: #c084e0; }

/* ── Drum module panel ───────────────────────────────────────────── */
.module-section {
  border-top: 1px solid #1a1a28;
  margin-top: 4px;
  padding-top: 6px;
}

.module-tabs-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 0 8px 6px;
  align-items: center;
}

.mod-tab {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 7px 3px 8px;
  background: #111120;
  border: 1px solid #252535;
  border-radius: 4px;
  color: #4a4a6a;
  font-family: 'Rajdhani', sans-serif;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  cursor: pointer;
  transition: border-color 0.12s, color 0.12s;
  white-space: nowrap;
}
.mod-tab:hover  { border-color: var(--acc, #4ecdc4); color: #a0a0c0; }
.mod-tab.active { border-color: var(--acc, #4ecdc4); color: var(--acc, #4ecdc4); background: #0d0d1c; }
.mod-tab-x {
  font-size: 12px;
  line-height: 1;
  color: #30304a;
  cursor: pointer;
  margin-left: 2px;
  transition: color 0.1s;
}
.mod-tab-x:hover { color: #e74c3c; }

.mod-add-wrap { position: relative; }
.mod-add-btn {
  width: 22px; height: 22px;
  background: #111120; border: 1px solid #252535; border-radius: 4px;
  font-size: 16px; line-height: 1; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: border-color 0.12s;
}
.mod-add-btn:hover { border-color: currentColor; }

.mod-picker {
  position: absolute;
  top: 26px; left: 0;
  background: #0e0e1c;
  border: 1px solid #252535;
  border-radius: 6px;
  min-width: 130px;
  z-index: 200;
  overflow: hidden;
  box-shadow: 0 4px 16px #00000080;
}
.mod-picker-header {
  padding: 5px 10px 4px;
  font-family: 'Rajdhani', sans-serif; font-size: 9px; font-weight: 700;
  letter-spacing: 0.15em; color: #303048; border-bottom: 1px solid #1a1a28;
}
.mod-picker-item {
  display: flex; align-items: center; justify-content: space-between;
  padding: 6px 10px;
  font-family: 'Rajdhani', sans-serif; font-size: 11px; font-weight: 600;
  letter-spacing: 0.06em; color: #8080a0; cursor: pointer;
  transition: background 0.1s, color 0.1s;
}
.mod-picker-item:hover       { background: #161628; color: #c0c0e0; }
.mod-picker-item.taken       { color: #3a3a55; cursor: default; }
.mod-picker-item.taken:hover { background: transparent; color: #3a3a55; }
.mod-picker-check            { color: #4ecdc4; font-size: 11px; }

.module-knobs {
  display: flex; flex-direction: column; align-items: center; gap: 10px;
  padding: 4px 8px 8px;
  border-top: 1px solid #131320;
}
.module-knobs-title {
  font-family: 'Rajdhani', sans-serif; font-size: 9px; font-weight: 700;
  letter-spacing: 0.15em; align-self: flex-start; padding-left: 4px;
  margin-bottom: -4px;
}

/* ── Piano Roll bottom panel ─────────────────────────────────────── */
.piano-roll-panel {
  display: flex; flex-direction: column;
  background: #0e0e1a;
  border-top: 1px solid #1a1a2c;
  flex-shrink: 0;
  overflow: hidden;
  position: relative;
}

.pr-resize-handle {
  height: 5px; cursor: ns-resize;
  background: #0a0a12;
  border-bottom: 1px solid #1a1a28;
  flex-shrink: 0;
  transition: background 0.1s;
}
.pr-resize-handle:hover { background: #1e1e32; }

.pr-panel-header {
  display: flex; align-items: center; gap: 10px;
  padding: 5px 12px;
  background: #0a0a12; border-bottom: 1px solid #1a1a28;
  flex-shrink: 0;
}
.pr-panel-title {
  font-family: 'Rajdhani', sans-serif; font-size: 10px; font-weight: 700;
  letter-spacing: 0.2em; color: #30304a; text-transform: uppercase;
}
.pr-panel-ch {
  font-family: 'Rajdhani', sans-serif; font-size: 13px; font-weight: 700;
  letter-spacing: 0.12em;
}

.pr-mode-toggle { display: flex; gap: 3px; margin-left: 6px; }
.prm-btn {
  font-family: 'Rajdhani', sans-serif; font-size: 10px; font-weight: 700;
  letter-spacing: 0.08em; padding: 3px 8px;
  border: 1px solid #252535; border-radius: 3px;
  background: transparent; color: #404058; cursor: pointer; transition: all 0.1s;
}
.prm-btn.active { border-color: var(--accent); color: var(--accent); }
.prm-btn:hover:not(.active) { border-color: #4a4a6a; color: #7070a0; }

.pr-close {
  margin-left: auto; background: transparent; border: none; color: #404058;
  font-size: 14px; cursor: pointer; padding: 2px 6px; border-radius: 3px;
  transition: color 0.1s;
}
.pr-close:hover { color: #e74c3c; }
</style>
