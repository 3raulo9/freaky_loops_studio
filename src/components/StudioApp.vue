<template>
  <div class="studio">

    <TopBar />

    <!-- ── Main body ──────────────────────────────────────────────────── -->
    <div class="studio-body">

      <!-- ── Browser sidebar (docked: W_main = W_total − W_browser) ──── -->
      <Transition name="slideleft">
        <aside
          v-if="browserOpen && !detachedWindows.browser"
          class="browser-sidebar"
          :style="{ width: browserWidth + 'px', minWidth: browserWidth + 'px' }"
        >
          <BrowserPanel />
          <div class="browser-resize" @mousedown.prevent="startBrowserResize" title="Drag to resize" />
        </aside>
      </Transition>

      <!-- ── Left: Channel Rack / Playlist / Mixer ─────────────────── -->
      <div class="main-area">
        <Transition name="view" mode="out-in">
          <ChannelRack v-if="mainView === 'sequencer' && !detachedWindows.rack" key="rack" />
          <Playlist    v-else-if="mainView === 'playlist' && !detachedWindows.playlist" key="playlist" />
          <Mixer       v-else-if="mainView === 'mixer' && !detachedWindows.mixer" key="mixer" />
          <div v-else class="detached-placeholder" key="placeholder">
            <span class="dp-icon">⇱</span>
            <span class="dp-text">{{ mainViewTitle }} is detached</span>
            <button class="dp-btn" @click="redockWindow(detachedIdForView)">Re-dock</button>
          </div>
        </Transition>
      </div>

      <!-- ── Right: Properties panel (sequencer only) ────────────────── -->
      <Transition name="slideright">
      <aside class="props-panel" v-if="mainView === 'sequencer' && !detachedWindows.rack" @click="showModulePicker = false; showFxPicker = false">
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

        <!-- WASM Plugin panel -->
        <div v-if="selectedChannel.type === 'wasm'" class="wasm-panel">
          <div class="wasm-status-row">
            <span class="wasm-dot" :class="'wasm-dot--' + selectedChannel.wasmStatus" />
            <span class="wasm-status-label">{{ wasmStatusLabel }}</span>
          </div>
          <div v-if="selectedChannel.wasmName" class="wasm-filename" :title="selectedChannel.wasmName">
            {{ selectedChannel.wasmName }}
          </div>
          <div v-if="selectedChannel.wasmError" class="wasm-error">
            {{ selectedChannel.wasmError }}
          </div>
          <label class="wasm-upload-btn" :style="{ borderColor: selectedChannel.color, color: selectedChannel.color }">
            {{ selectedChannel.wasmStatus === 'idle' ? '⬡ LOAD PLUGIN' : '⬡ CHANGE PLUGIN' }}
            <input type="file" accept=".wasm,.js" @change="onWasmFile" style="display:none" />
          </label>

          <!-- Built-in example plugins -->
          <div class="wasm-examples-title">EXAMPLES</div>
          <div class="wasm-examples">
            <button v-for="ex in WASM_EXAMPLES" :key="ex.file"
              class="wasm-ex-btn"
              :disabled="selectedChannel.wasmStatus === 'loading'"
              @click="loadExample(ex.file)"
            >{{ ex.label }}</button>
          </div>

          <div class="wasm-api-hint">
            <div class="wasm-hint-title">JS plugin exports:</div>
            <code>init(sampleRate)</code>
            <code>note_on(pitch, vel)</code>
            <code>note_off(pitch)</code>
            <code>process(L, R)</code>
          </div>
          <div class="wasm-compat-note">
            Accepts .js (JS AudioWorklet) or .wasm. .dll / .vst cannot run in a browser.
          </div>
        </div>

        <!-- Sampler Channel → shown in full-width bottom panel, not here -->

        <!-- CHOP slicer panel -->
        <ChopChannel
          v-if="selectedChannel.type === 'chop'"
          :channel="selectedChannel"
        />

        <!-- FORGE deep slicer panel -->
        <ForgeChannel
          v-if="selectedChannel.type === 'forge'"
          :channel="selectedChannel"
        />

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

        <!-- ── Insert FX rack ────────────────────────────────────────── -->
        <div class="fx-section" @click.stop>
          <div class="fx-section-head">
            <span class="fx-section-title">EFFECTS</span>
            <div class="fx-add-wrap">
              <button class="fx-add-btn" :style="{ color: selectedChannel.color }"
                @click="showFxPicker = !showFxPicker" title="Add effect">+</button>
              <div v-if="showFxPicker" class="fx-picker">
                <div class="fx-picker-header">ADD EFFECT</div>
                <div v-for="(def, type) in EFFECT_DEFS" :key="type"
                  class="fx-picker-item" @click="onAddFx(type)">{{ def.label }}</div>
              </div>
            </div>
          </div>
          <FXRack
            v-if="selectedChannel.effects && selectedChannel.effects.length"
            :effects="selectedChannel.effects"
            :color="selectedChannel.color"
            :style="{ '--accent': selectedChannel.color }"
            @update="onFxUpdate" @reorder="onFxReorder" @remove="onFxRemove"
          />
          <div v-else class="fx-empty">No effects — click + to add one</div>
        </div>

        <!-- Keyboard hint -->
        <div class="props-kb-hint">
          <div class="kb-row">⌨ Z–/&nbsp;&nbsp;Q–]</div>
          <div class="kb-row">- = octave: {{ kbOctave }}</div>
        </div>

        <!-- Clear button -->
        <button class="props-clr" @click="clearChannel(selectedChannel.id)">CLR PATTERN</button>
      </aside>
      </Transition>

    </div>

    <!-- ── Render modal ──────────────────────────────────────────────── -->
    <Transition name="modal">
      <RenderModal v-if="renderModalOpen" @close="renderModalOpen = false" />
    </Transition>

    <!-- ── Theme modal ───────────────────────────────────────────────── -->
    <Transition name="modal">
      <ThemeModal v-if="themeModalOpen" @close="themeModalOpen = false" />
    </Transition>

    <!-- ── MIDI Port Router ──────────────────────────────────────────── -->
    <Transition name="popin">
      <MidiPortRouter v-if="midiRouterOpen" @close="midiRouterOpen = false" />
    </Transition>

    <!-- ── Bottom: Custom Synth panel (when custom synth selected + piano roll closed) ── -->
    <Transition name="slideup">
    <div
      v-if="selectedChannel.type === 'custom' && mainView === 'sequencer' && !pianoRollOpen"
      class="custom-synth-panel"
      :style="{ height: customSynthHeight + 'px' }"
    >
      <div class="pr-resize-handle" @mousedown="startCustomSynthResize" title="Drag to resize" />
      <CustomSynth />
    </div>
    </Transition>

    <!-- ── Bottom: SUBTERRA bass panel (when subterra channel selected + piano roll closed) ── -->
    <Transition name="slideup">
    <div
      v-if="selectedChannel.type === 'subterra' && mainView === 'sequencer' && !pianoRollOpen"
      class="custom-synth-panel"
      :style="{ height: customSynthHeight + 'px' }"
    >
      <div class="pr-resize-handle" @mousedown="startCustomSynthResize" title="Drag to resize" />
      <Subterra />
    </div>
    </Transition>

    <!-- ── Bottom: Sampler panel (audiofile type) ──────────────────────── -->
    <Transition name="slideup">
    <div
      v-if="selectedChannel.type === 'audiofile' && mainView === 'sequencer' && !pianoRollOpen"
      class="custom-synth-panel"
      :style="{ height: customSynthHeight + 'px' }"
    >
      <div class="pr-resize-handle" @mousedown="startCustomSynthResize" title="Drag to resize" />
      <SamplerChannel :channel="selectedChannel" />
    </div>
    </Transition>

    <!-- ── Bottom: Piano Roll panel ──────────────────────────────────── -->
    <Transition name="slideup">
    <div
      v-if="pianoRollOpen && mainView === 'sequencer' && !detachedWindows.piano"
      class="piano-roll-panel"
      :style="{ height: prHeight + 'px' }"
    >
      <!-- Drag handle to resize -->
      <div class="pr-resize-handle" @mousedown="startResize" title="Drag to resize" />

      <!-- Piano Roll header -->
      <div class="pr-panel-header" :style="{ '--accent': selectedChannel.color }">
        <span class="pr-panel-title">PIANO ROLL</span>
        <span class="pr-panel-ch" :style="{ color: selectedChannel.color }">{{ selectedChannel.name }}</span>
        <div class="pr-mode-toggle" v-if="selectedChannel.type === 'melodic' || selectedChannel.type === 'gm'">
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
    </Transition>

    <!-- ── Detached (floating) windows layer ─────────────────────────── -->
    <Transition name="popin"><FloatWindow v-if="detachedWindows.rack"     id="rack"     title="CHANNEL RACK" accent="#9b59b6"><ChannelRack /></FloatWindow></Transition>
    <Transition name="popin"><FloatWindow v-if="detachedWindows.playlist" id="playlist" title="PLAYLIST"     accent="#3498db"><Playlist /></FloatWindow></Transition>
    <Transition name="popin"><FloatWindow v-if="detachedWindows.mixer"    id="mixer"    title="MIXER"        accent="#3498db"><Mixer /></FloatWindow></Transition>
    <Transition name="popin"><FloatWindow v-if="detachedWindows.piano"    id="piano"    title="PIANO ROLL"   :accent="selectedChannel.color"><PianoRoll :ch="selectedChannel" /></FloatWindow></Transition>
    <Transition name="popin"><FloatWindow v-if="detachedWindows.browser"  id="browser"  title="BROWSER"      accent="#f1c40f"><BrowserPanel /></FloatWindow></Transition>

    <!-- ── Extended Hint Panel (floating HUD) ────────────────────────── -->
    <Transition name="hud">
      <ExtendedHud v-if="extendedHudOpen" />
    </Transition>

    <!-- ── Instrument drag ghost (follows the cursor) ────────────────── -->
    <Teleport to="body">
      <div v-if="instrumentDrag.active" class="drag-ghost"
        :style="{ left: instrumentDrag.x + 'px', top: instrumentDrag.y + 'px', '--gc': instrumentDrag.color }">
        <span class="drag-ghost-dot" :style="{ background: instrumentDrag.color }" />
        <span class="drag-ghost-label">{{ instrumentDrag.label }}</span>
      </div>
    </Teleport>

  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useStudio } from '../store/studio.js'
import { DRUM_MODULE_DEFS } from '../audio/drumModules.js'
import { EFFECT_DEFS } from '../audio/effects.js'
import TopBar      from './TopBar.vue'
import ChannelRack from './ChannelRack.vue'
import Playlist    from './Playlist.vue'
import Mixer       from './Mixer.vue'
import PianoRoll   from './PianoRoll.vue'
import StepGrid    from './StepGrid.vue'
import Knob        from './Knob.vue'
import RenderModal    from './RenderModal.vue'
import ThemeModal     from './ThemeModal.vue'
import MidiPortRouter from './MidiPortRouter.vue'
import CustomSynth     from './CustomSynth.vue'
import Subterra        from './Subterra.vue'
import FloatWindow     from './FloatWindow.vue'
import BrowserPanel    from './BrowserPanel.vue'
import ExtendedHud     from './ExtendedHud.vue'
import FXRack          from './FXRack.vue'
import SamplerChannel  from './SamplerChannel.vue'
import ChopChannel    from './ChopChannel.vue'
import ForgeChannel   from './ForgeChannel.vue'

const {
  mainView, selectedChannel, kbOctave, pianoRollOpen, renderModalOpen, themeModalOpen, midiRouterOpen,
  clearChannel, handleKeyDown, handleKeyUp,
  addDrumModule, removeDrumModule,
  browserOpen, detachedWindows, redockWindow, extendedHudOpen, browserWidth,
  loadWasmForChannel,
  addChannelEffect, removeChannelEffect, reorderChannelEffects, updateChannelEffect,
  instrumentDrag,
} = useStudio()

// ── Detached main-view placeholder ────────────────────────────────────────────
const VIEW_ID    = { sequencer: 'rack', playlist: 'playlist', mixer: 'mixer' }
const VIEW_TITLE = { sequencer: 'Channel Rack', playlist: 'Playlist', mixer: 'Mixer' }
const detachedIdForView = computed(() => VIEW_ID[mainView.value])
const mainViewTitle     = computed(() => VIEW_TITLE[mainView.value] ?? 'Window')

// ── Browser dock resize ───────────────────────────────────────────────────────
function startBrowserResize(e) {
  const sx = e.clientX, sw = browserWidth.value
  const move = ev => { browserWidth.value = Math.max(160, Math.min(480, sw + ev.clientX - sx)) }
  const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
  window.addEventListener('mousemove', move)
  window.addEventListener('mouseup', up)
}

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

// ── Per-channel insert FX ───────────────────────────────────────────────────────
const showFxPicker = ref(false)
function onAddFx(type) {
  addChannelEffect(selectedChannel.value.id, type)
  showFxPicker.value = false
}
function onFxUpdate(idx, key, value) { updateChannelEffect(selectedChannel.value.id, idx, key, value) }
function onFxReorder(from, to)       { reorderChannelEffects(selectedChannel.value.id, from, to) }
function onFxRemove(idx)             { removeChannelEffect(selectedChannel.value.id, idx) }

// Reset module + FX panels when switching to a different channel
watch(() => selectedChannel.value?.id, () => {
  activeModuleTab.value  = null
  showModulePicker.value = false
  showFxPicker.value     = false
})

// ── WASM / JS plugin ──────────────────────────────────────────────────────────
const WASM_EXAMPLES = [
  // ── Wavetable synths (Serum-style) ─────────────────────────────────────────
  { label: 'WT Morph',    file: 'wt-morph.js'    },
  { label: 'WT Supersaw', file: 'wt-super.js'    },
  { label: 'WT Pluck',    file: 'wt-pluck.js'    },
  { label: 'WT Pad',      file: 'wt-pad.js'      },
  { label: 'WT Wobble',   file: 'wt-wobble.js'   },
  { label: 'WT Vowel',    file: 'wt-vowel.js'    },
  { label: 'WT Hard',     file: 'wt-hard.js'     },
  { label: 'WT Strings',  file: 'wt-strings.js'  },
  // ── Basic synths ────────────────────────────────────────────────────────────
  { label: 'Sine Poly',   file: 'sine-poly.js'   },
  { label: 'Saw Lead',    file: 'saw-lead.js'     },
  { label: 'FM Bell',     file: 'fm-bell.js'      },
  { label: 'Acid Bass',   file: 'acid-bass.js'    },
  { label: 'Noise Perc',  file: 'noise-perc.js'   },
  { label: 'Pad Strings', file: 'pad-strings.js'  },
]

const wasmStatusLabel = computed(() => {
  const s = selectedChannel.value?.wasmStatus
  return s === 'idle'    ? 'No plugin loaded'
       : s === 'loading' ? 'Loading…'
       : s === 'ready'   ? 'Plugin ready'
       : s === 'error'   ? 'Load failed'
       : ''
})

function onWasmFile(e) {
  const file = e.target.files?.[0]
  if (!file) return
  e.target.value = ''
  const isJs = file.name.endsWith('.js')
  const reader = new FileReader()
  reader.onload = ev => {
    loadWasmForChannel(selectedChannel.value.id, ev.target.result, file.name)
  }
  if (isJs) reader.readAsText(file)
  else       reader.readAsArrayBuffer(file)
}

async function loadExample(fileName) {
  const ch = selectedChannel.value
  if (!ch) return
  try {
    const res  = await fetch(`/examples/${fileName}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const code = await res.text()
    loadWasmForChannel(ch.id, code, fileName)
  } catch (err) {
    console.error('[FreakyLoops] Failed to load example plugin:', err)
  }
}

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
const prHeight    = ref(240)
const customSynthHeight = ref(500)
let resizing = false
let resizeStartY = 0
let resizeStartH = 0
let resizeTarget = null

function startResize(e) {
  resizing      = true
  resizeStartY  = e.clientY
  resizeStartH  = prHeight.value
  resizeTarget  = 'pr'
  window.addEventListener('mousemove', onResize)
  window.addEventListener('mouseup',   stopResize)
}
function startCustomSynthResize(e) {
  resizing      = true
  resizeStartY  = e.clientY
  resizeStartH  = customSynthHeight.value
  resizeTarget  = 'custom'
  window.addEventListener('mousemove', onResize)
  window.addEventListener('mouseup',   stopResize)
}
function onResize(e) {
  if (!resizing) return
  const dy = resizeStartY - e.clientY
  if (resizeTarget === 'custom') {
    customSynthHeight.value = Math.max(280, Math.min(720, resizeStartH + dy))
  } else {
    prHeight.value = Math.max(120, Math.min(520, resizeStartH + dy))
  }
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
  background: var(--bg-base); color: var(--text-primary);
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

/* ── Browser sidebar ─────────────────────────────────────────────── */
.browser-sidebar {
  position: relative;
  border-right: 1px solid var(--border-subtle);
  overflow: hidden;
  flex-shrink: 0;
}
.browser-resize {
  position: absolute; top: 0; right: 0; bottom: 0; width: 5px;
  cursor: ew-resize; background: transparent; transition: background 0.1s;
}
.browser-resize:hover { background: #f1c40f55; }

/* ── Detached-window placeholder ─────────────────────────────────── */
.detached-placeholder {
  flex: 1;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 12px; color: #3a3a55;
}
.dp-icon { font-size: 40px; color: #1abc9c88; }
.dp-text {
  font-family: 'Rajdhani', sans-serif; font-size: 14px; font-weight: 600;
  letter-spacing: 0.08em;
}
.dp-btn {
  font-family: 'Rajdhani', sans-serif; font-size: 11px; font-weight: 700;
  letter-spacing: 0.1em; padding: 6px 16px;
  border: 1px solid #1abc9c; border-radius: 5px;
  background: transparent; color: #1abc9c; cursor: pointer; transition: all 0.12s;
}
.dp-btn:hover { background: #06201b; box-shadow: 0 0 9px #1abc9c44; }

/* ── Properties panel ────────────────────────────────────────────── */
.props-panel {
  width: 184px;
  min-width: 184px;
  background: var(--bg-header);
  border-left: 1px solid var(--border-subtle);
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
  background: var(--bg-control); border: 1px solid var(--border); color: var(--text-primary);
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
  border: 1px solid var(--border); border-radius: 5px;
  background: transparent; color: var(--text-muted); cursor: pointer; transition: all 0.12s;
}
.props-clr:hover { border-color: #9b59b6; color: #c084e0; }

/* ── WASM plugin panel ───────────────────────────────────────────── */
.wasm-panel {
  display: flex; flex-direction: column; gap: 7px;
  padding: 8px 10px; border-top: 1px solid var(--border-subtle);
}
.wasm-status-row {
  display: flex; align-items: center; gap: 6px;
}
.wasm-dot {
  width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0;
}
.wasm-dot--idle    { background: #404060; }
.wasm-dot--loading { background: #f39c12; }
.wasm-dot--ready   { background: #2ecc71; }
.wasm-dot--error   { background: #e74c3c; }
.wasm-status-label {
  font-family: 'Share Tech Mono', monospace; font-size: 9px; color: var(--text-muted);
}
.wasm-filename {
  font-family: 'Share Tech Mono', monospace; font-size: 9px; color: var(--text-primary);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.wasm-error {
  font-family: 'Share Tech Mono', monospace; font-size: 8px; color: #e74c3c;
  word-break: break-word; line-height: 1.4;
}
.wasm-upload-btn {
  display: block; text-align: center; padding: 5px 0;
  border: 1px solid; border-radius: 4px; cursor: pointer;
  font-family: 'Rajdhani', sans-serif; font-size: 11px; font-weight: 700;
  letter-spacing: 0.08em; transition: opacity 0.12s;
}
.wasm-upload-btn:hover { opacity: 0.75; }
.wasm-api-hint {
  display: flex; flex-direction: column; gap: 1px;
}
.wasm-hint-title {
  font-family: 'Rajdhani', sans-serif; font-size: 8px; font-weight: 700;
  color: #40405a; letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 2px;
}
.wasm-api-hint code {
  font-family: 'Share Tech Mono', monospace; font-size: 8px; color: #5a5a80;
  background: var(--bg-base); padding: 1px 3px; border-radius: 2px;
}
.wasm-compat-note {
  font-family: 'Share Tech Mono', monospace; font-size: 8px;
  color: #6a4a20; line-height: 1.45;
}
.wasm-examples-title {
  font-family: 'Rajdhani', sans-serif; font-size: 8px; font-weight: 700;
  letter-spacing: 0.15em; color: #40405a; text-transform: uppercase;
  margin-top: 2px;
}
.wasm-examples {
  display: flex; flex-wrap: wrap; gap: 4px;
}
.wasm-ex-btn {
  font-family: 'Rajdhani', sans-serif; font-size: 9px; font-weight: 700;
  letter-spacing: 0.05em; padding: 3px 6px; border-radius: 4px;
  border: 1px solid #4a2a88; background: #1a0a30; color: #b080ff;
  cursor: pointer; transition: all 0.1s; white-space: nowrap;
}
.wasm-ex-btn:hover:not(:disabled) { background: #2a1048; border-color: #7b2fff; color: #d0a0ff; }
.wasm-ex-btn:disabled { opacity: 0.4; cursor: not-allowed; }

/* ── Drum module panel ───────────────────────────────────────────── */
.module-section {
  border-top: 1px solid var(--border-subtle);
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
  background: var(--bg-deeper);
  border: 1px solid var(--border);
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
.mod-tab.active { border-color: var(--acc, #4ecdc4); color: var(--acc, #4ecdc4); background: var(--bg-deeper); }
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
  background: var(--bg-deeper); border: 1px solid var(--border); border-radius: 4px;
  font-size: 16px; line-height: 1; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: border-color 0.12s;
}
.mod-add-btn:hover { border-color: currentColor; }

.mod-picker {
  position: absolute;
  top: 26px; left: 0;
  background: var(--bg-control);
  border: 1px solid var(--border);
  border-radius: 6px;
  min-width: 130px;
  z-index: 200;
  overflow: hidden;
  box-shadow: 0 4px 16px #00000080;
}
.mod-picker-header {
  padding: 5px 10px 4px;
  font-family: 'Rajdhani', sans-serif; font-size: 9px; font-weight: 700;
  letter-spacing: 0.15em; color: var(--text-muted); border-bottom: 1px solid var(--border-subtle);
}
.mod-picker-item {
  display: flex; align-items: center; justify-content: space-between;
  padding: 6px 10px;
  font-family: 'Rajdhani', sans-serif; font-size: 11px; font-weight: 600;
  letter-spacing: 0.06em; color: #8080a0; cursor: pointer;
  transition: background 0.1s, color 0.1s;
}
.mod-picker-item:hover       { background: var(--bg-hover); color: var(--text-primary); }
.mod-picker-item.taken       { color: #3a3a55; cursor: default; }
.mod-picker-item.taken:hover { background: transparent; color: #3a3a55; }
.mod-picker-check            { color: #4ecdc4; font-size: 11px; }

.module-knobs {
  display: flex; flex-direction: column; align-items: center; gap: 10px;
  padding: 4px 8px 8px;
  border-top: 1px solid var(--border-subtle);
}
.module-knobs-title {
  font-family: 'Rajdhani', sans-serif; font-size: 9px; font-weight: 700;
  letter-spacing: 0.15em; align-self: flex-start; padding-left: 4px;
  margin-bottom: -4px;
}

/* ── Insert FX section ───────────────────────────────────────────── */
.fx-section {
  border-top: 1px solid var(--border-subtle);
  margin-top: 4px;
  padding: 8px 8px 4px;
}
.fx-section-head {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 6px;
}
.fx-section-title {
  font-family: 'Rajdhani', sans-serif; font-size: 9px; font-weight: 700;
  letter-spacing: 0.18em; color: #40405a; text-transform: uppercase;
}
.fx-add-wrap { position: relative; }
.fx-add-btn {
  width: 20px; height: 20px;
  background: var(--bg-deeper); border: 1px solid var(--border); border-radius: 4px;
  font-size: 15px; line-height: 1; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: border-color 0.12s;
}
.fx-add-btn:hover { border-color: currentColor; }
.fx-picker {
  position: absolute; top: 24px; right: 0; z-index: 200;
  background: var(--bg-control); border: 1px solid var(--border); border-radius: 6px;
  min-width: 124px; overflow: hidden;
  box-shadow: 0 6px 20px #000000aa;
}
.fx-picker-header {
  padding: 5px 10px 4px;
  font-family: 'Rajdhani', sans-serif; font-size: 9px; font-weight: 700;
  letter-spacing: 0.15em; color: var(--text-muted); border-bottom: 1px solid var(--border-subtle);
}
.fx-picker-item {
  padding: 6px 10px;
  font-family: 'Rajdhani', sans-serif; font-size: 11px; font-weight: 600;
  letter-spacing: 0.06em; color: #8080a0; cursor: pointer;
  transition: background 0.1s, color 0.1s;
}
.fx-picker-item:hover { background: var(--bg-hover); color: var(--text-primary); }
.fx-empty {
  font-family: 'Rajdhani', sans-serif; font-size: 10px; font-weight: 500;
  letter-spacing: 0.04em; color: #3a3a52; text-align: center; padding: 8px 4px;
}

/* ── Instrument drag ghost (teleported to <body>, follows the cursor) ── */
.drag-ghost {
  position: fixed; z-index: 99999; pointer-events: none;
  transform: translate(14px, 10px);
  display: flex; align-items: center; gap: 7px;
  padding: 6px 12px 6px 10px;
  background: var(--bg-panel, #181826);
  border: 1px solid var(--gc, #4ecdc4);
  border-radius: 6px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.6), 0 0 14px color-mix(in srgb, var(--gc, #4ecdc4) 45%, transparent);
  font-family: 'Rajdhani', sans-serif; font-size: 12px; font-weight: 700;
  letter-spacing: 0.08em; color: #fff; white-space: nowrap;
}
.drag-ghost-dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
.drag-ghost-label { text-shadow: 0 1px 3px rgba(0,0,0,0.7); }

/* ── Piano Roll bottom panel ─────────────────────────────────────── */
.piano-roll-panel, .custom-synth-panel {
  display: flex; flex-direction: column;
  background: var(--bg-base);
  border-top: 1px solid var(--border-subtle);
  flex-shrink: 0;
  overflow: hidden;
  position: relative;
}
.custom-synth-panel { height: 480px; }

.pr-resize-handle {
  height: 5px; cursor: ns-resize;
  background: var(--bg-deeper);
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
  transition: background 0.1s;
}
.pr-resize-handle:hover { background: #1e1e32; }

.pr-panel-header {
  display: flex; align-items: center; gap: 10px;
  padding: 5px 12px;
  background: var(--bg-deeper); border-bottom: 1px solid var(--border-subtle);
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
  border: 1px solid var(--border); border-radius: 3px;
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
