<template>
  <div class="channel-rack">

    <!-- ── Pattern navigator ─────────────────────────────────────────── -->
    <div class="pattern-nav">
      <button
        class="pat-nav-btn"
        :disabled="patternIndex === 0"
        @click="currentPatternId = patterns[patternIndex - 1].id"
        title="Previous pattern"
      >‹</button>

      <div class="pat-name-wrap" @contextmenu.prevent="showPatCtx($event)">
        <span class="pat-dot" :style="{ background: currentPattern.color }" />
        <span class="pat-name">{{ currentPattern.name }}</span>
      </div>

      <button
        class="pat-nav-btn"
        :disabled="patternIndex === patterns.length - 1"
        @click="currentPatternId = patterns[patternIndex + 1].id"
        title="Next pattern"
      >›</button>

      <button class="pat-add-btn" @click="addPattern" title="New pattern">+ PAT</button>
    </div>

    <!-- Pattern context menu -->
    <div v-if="patCtx.open" class="ctx-menu" :style="{ top: patCtx.y+'px', left: patCtx.x+'px' }" @mouseleave="patCtx.open=false">
      <div class="ctx-item" @click="startPatRename">Rename</div>
      <div class="ctx-item" @click="duplicatePattern(currentPatternId); patCtx.open=false">Duplicate</div>
      <div class="ctx-sep" />
      <div class="ctx-item danger" @click="removePattern(currentPatternId); patCtx.open=false">Delete Pattern</div>
    </div>

    <!-- Rename pattern overlay -->
    <div v-if="patRenaming" class="rename-overlay" @click.self="patRenaming=false">
      <div class="rename-box">
        <span class="rename-label">Rename pattern</span>
        <input ref="patRenameInput" v-model="patRenameName" class="rename-input"
               @keydown.enter="commitPatRename" @keydown.esc="patRenaming=false" maxlength="24" />
        <div class="rename-btns">
          <button class="rename-ok" @click="commitPatRename">OK</button>
          <button class="rename-cancel" @click="patRenaming=false">Cancel</button>
        </div>
      </div>
    </div>

    <!-- ── Rack toolbar ──────────────────────────────────────────────── -->
    <div class="rack-toolbar">
      <span class="rack-title">CHANNEL RACK</span>

      <select v-model="filterType" class="filter-select">
        <option value="all">All</option>
        <option value="drum">Drums</option>
        <option value="melodic">Synths</option>
      </select>

      <div class="rack-right">
        <span class="kb-badge">⌨ Z–M · {{ kbOctave }}</span>
        <div class="add-synth-wrap" ref="synthPickerRef">
          <button class="add-ch-btn" @click="showSynthPicker = !showSynthPicker" title="Add synth channel">
            + SYNTH ▾
          </button>
          <div v-if="showSynthPicker" class="synth-picker">
            <div class="synth-pick-section">BASIC</div>
            <div class="synth-pick-item" @click="addChannel(); showSynthPicker = false">
              <span class="synth-pick-dot" style="background:#4ecdc4" />SYNTH (SAW)
            </div>
            <div class="synth-pick-section">FM SYNTHS</div>
            <div
              v-for="(preset, key) in FM_PRESETS"
              :key="key"
              class="synth-pick-item"
              @click="addFMChannel(key); showSynthPicker = false"
            >
              <span class="synth-pick-dot" :style="{ background: preset.color }" />{{ preset.name }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ── Column header labels ──────────────────────────────────────── -->
    <div class="col-headers">
      <div class="col-led"  title="Mute (L-click) / Solo (R-click)">●</div>
      <div class="col-pan"  title="Pan">PAN</div>
      <div class="col-vol"  title="Volume">VOL</div>
      <div class="col-mix"  title="Mixer track">MX</div>
      <div class="col-name">INSTRUMENT</div>
      <div class="col-seq">PATTERN — <span class="steps-label">{{ totalSteps }} steps</span></div>
    </div>

    <!-- ── Channel rows ──────────────────────────────────────────────── -->
    <div class="channel-list">
      <div
        v-for="ch in visibleChannels"
        :key="ch.id"
        class="channel-row"
        :class="{ selected: ch.id === selectedChannelId, muted: ch.muted, soloed: ch._soloed }"
        :style="{ '--accent': ch.color }"
        @click="selectedChannelId = ch.id"
      >
        <!-- Green LED: left-click mute, right-click solo -->
        <div
          class="led"
          :class="{ active: !ch.muted, solo: ch._soloed }"
          @click.stop="ch.muted = !ch.muted"
          @contextmenu.prevent="soloChannel(ch.id)"
          title="L-click: mute / R-click: solo"
        />

        <!-- Pan knob (hides label via CSS) -->
        <div class="rack-knob-wrap" :title="`Pan: ${Math.round(ch.pan * 100)}%`">
          <Knob
            v-model="ch.pan"
            :min="-1" :max="1" :decimals="2"
            label="" :color="ch.color" :size="24"
          />
        </div>

        <!-- Vol knob -->
        <div class="rack-knob-wrap" :title="`Volume: ${Math.round(ch.volume * 100)}%`">
          <Knob
            v-model="ch.volume"
            :min="0" :max="1.25" :decimals="2"
            label="" :color="ch.color" :size="24"
          />
        </div>

        <!-- Mixer track number -->
        <div
          class="mix-num"
          :title="`Mixer track ${ch.mixerTrack}`"
          @click.stop
        >
          <input
            type="number" v-model.number="ch.mixerTrack"
            min="0" max="99" class="mix-input"
          />
        </div>

        <!-- Channel name button -->
        <button
          class="ch-name-btn"
          :class="{ 'piano-active': ch.type === 'melodic' && pianoRollOpen && selectedChannelId === ch.id }"
          :style="{ background: ch.color }"
          @click.stop="openOrSelectChannel(ch)"
          @contextmenu.prevent="showContextMenu($event, ch)"
          :title="ch.type === 'melodic' ? 'Click to open Piano Roll' : ch.name"
        >
          {{ ch.name }}
        </button>

        <!-- ── Sequencer area ─────────────────────────────────────── -->
        <div class="ch-seq" @click.stop>

          <!-- Step buttons (drum or melodic in step mode) -->
          <template v-if="ch.mode === 'steps'">
            <div class="inline-steps" :style="{ '--cols': totalSteps }">
              <button
                v-for="s in totalSteps"
                :key="s - 1"
                class="istep"
                :class="{
                  lit:     getSteps(ch.id)[s - 1],
                  playing: isPlaying && displayStep === s - 1,
                  beat:    (s - 1) % 4 === 0,
                }"
                @click="toggleStep(ch.id, s - 1)"
                @contextmenu.prevent="getSteps(ch.id)[s - 1] = false"
              />
            </div>
          </template>

          <!-- Mini piano-roll preview (melodic in piano mode) -->
          <template v-else>
            <div
              class="mini-pr"
              :style="{ '--cols': totalSteps }"
              @click="openOrSelectChannel(ch)"
              title="Click to open Piano Roll"
            >
              <!-- Note dots: one column per step -->
              <div
                v-for="s in totalSteps"
                :key="s - 1"
                class="mini-pr-col"
                :class="{
                  has:     channelHasNotesAtStep(ch, s - 1),
                  playing: isPlaying && displayStep === s - 1,
                  beat:    (s - 1) % 4 === 0,
                }"
              >
                <div
                  v-for="note in notesAtStep(ch, s - 1)"
                  :key="`${note.step}-${note.pitch}`"
                  class="mini-note"
                  :style="{ bottom: noteBottom(note.pitch) + '%' }"
                />
              </div>
              <span class="mini-pr-hint">PIANO ROLL</span>
            </div>
          </template>

        </div>
      </div>

      <!-- Empty state -->
      <div v-if="visibleChannels.length === 0" class="empty-state">
        No channels match this filter.
      </div>
    </div>

    <!-- Context menu -->
    <div
      v-if="ctxMenu.open"
      class="ctx-menu"
      :style="{ top: ctxMenu.y + 'px', left: ctxMenu.x + 'px' }"
      @mouseleave="ctxMenu.open = false"
    >
      <div class="ctx-item" @click="ctxAction('piano-roll')">Open Piano Roll</div>
      <div class="ctx-item" @click="ctxAction('rename')">Rename</div>
      <div class="ctx-item" @click="ctxAction('clear')">Clear Pattern</div>
      <div class="ctx-sep" />
      <div class="ctx-item" @click="ctxAction('move-up')">Move Up</div>
      <div class="ctx-item" @click="ctxAction('move-down')">Move Down</div>
      <div class="ctx-sep" />
      <div class="ctx-item danger" @click="ctxAction('delete')">Delete</div>
    </div>

    <!-- Rename inline prompt -->
    <div v-if="renaming" class="rename-overlay" @click.self="renaming = false">
      <div class="rename-box">
        <span class="rename-label">Rename "{{ renameTarget?.name }}"</span>
        <input
          ref="renameInput"
          v-model="renameName"
          class="rename-input"
          @keydown.enter="commitRename"
          @keydown.esc="renaming = false"
          maxlength="16"
        />
        <div class="rename-btns">
          <button class="rename-ok"  @click="commitRename">OK</button>
          <button class="rename-cancel" @click="renaming = false">Cancel</button>
        </div>
      </div>
    </div>

  </div>
</template>

<script setup>
import { ref, reactive, computed, nextTick, onMounted, onUnmounted } from 'vue'
import { useStudio, FM_PRESETS } from '../store/studio.js'
import Knob from './Knob.vue'

const {
  channels, selectedChannelId, totalSteps, isPlaying, displayStep,
  pianoRollOpen, kbOctave,
  patterns, currentPatternId, getSteps,
  addPattern, removePattern, duplicatePattern,
  toggleStep, soloChannel, clearChannel, addChannel, addFMChannel, removeChannel, moveChannel,
} = useStudio()

// ── Synth picker popup ────────────────────────────────────────────────────────
const showSynthPicker = ref(false)
const synthPickerRef  = ref(null)

function onDocClick(e) {
  if (showSynthPicker.value && synthPickerRef.value && !synthPickerRef.value.contains(e.target)) {
    showSynthPicker.value = false
  }
}
onMounted(()  => document.addEventListener('click', onDocClick, true))
onUnmounted(() => document.removeEventListener('click', onDocClick, true))

// Pattern navigator helpers
const patternIndex  = computed(() => patterns.findIndex(p => p.id === currentPatternId.value))
const currentPattern = computed(() => patterns.find(p => p.id === currentPatternId.value) ?? patterns[0])

// Pattern context + rename
const patCtx = reactive({ open: false, x: 0, y: 0 })
function showPatCtx(e) { patCtx.open = true; patCtx.x = e.clientX; patCtx.y = e.clientY }

const patRenaming    = ref(false)
const patRenameName  = ref('')
const patRenameInput = ref(null)

function startPatRename() {
  patCtx.open      = false
  patRenameName.value = currentPattern.value.name
  patRenaming.value   = true
  nextTick(() => patRenameInput.value?.select())
}
function commitPatRename() {
  if (patRenameName.value.trim()) currentPattern.value.name = patRenameName.value.trim()
  patRenaming.value = false
}

const filterType = ref('all')
const visibleChannels = computed(() =>
  filterType.value === 'all' ? channels : channels.filter(c => c.type === filterType.value)
)

// ── Piano roll open/select ────────────────────────────────────────────────────
function openOrSelectChannel(ch) {
  selectedChannelId.value = ch.id
  if (ch.type === 'melodic') {
    pianoRollOpen.value = true
  }
}

// ── Mini piano-roll preview helpers ──────────────────────────────────────────
function notesAtStep(ch, step) {
  return getSteps ? getPianoNotes(ch.id).filter(n => n.step === step) : []
}
function channelHasNotesAtStep(ch, step) {
  return getPianoNotes(ch.id).some(n => n.step === step)
}

const { getPianoNotes } = useStudio()
// Map MIDI pitch to vertical % (PIANO_LOW=36 bottom, PIANO_HIGH=84 top)
function noteBottom(pitch) {
  return ((pitch - 36) / (84 - 36)) * 100
}

// ── Context menu ──────────────────────────────────────────────────────────────
const ctxMenu = reactive({ open: false, x: 0, y: 0, channel: null })
function showContextMenu(e, ch) {
  selectedChannelId.value = ch.id
  ctxMenu.open = true
  ctxMenu.x    = e.clientX
  ctxMenu.y    = e.clientY
  ctxMenu.channel = ch
}
function ctxAction(action) {
  const ch = ctxMenu.channel
  ctxMenu.open = false
  if (!ch) return
  if (action === 'piano-roll')  { openOrSelectChannel(ch) }
  if (action === 'rename')      { startRename(ch) }
  if (action === 'clear')       { clearChannel(ch.id) }
  if (action === 'move-up')     { moveChannel(ch.id, -1) }
  if (action === 'move-down')   { moveChannel(ch.id, +1) }
  if (action === 'delete')      { removeChannel(ch.id) }
}

// ── Rename ────────────────────────────────────────────────────────────────────
const renaming     = ref(false)
const renameTarget = ref(null)
const renameName   = ref('')
const renameInput  = ref(null)

function startRename(ch) {
  renameTarget.value = ch
  renameName.value   = ch.name
  renaming.value     = true
  nextTick(() => renameInput.value?.select())
}
function commitRename() {
  if (renameTarget.value && renameName.value.trim()) {
    renameTarget.value.name = renameName.value.trim().toUpperCase()
  }
  renaming.value = false
}

</script>

<style scoped>
/* ── Pattern navigator ───────────────────────────────────────────── */
.pattern-nav {
  display: flex; align-items: center; gap: 6px; padding: 6px 10px;
  background: #080810; border-bottom: 1px solid #1a1a28; flex-shrink: 0;
}
.pat-nav-btn {
  width: 22px; height: 22px; border-radius: 4px; border: 1px solid #252535;
  background: transparent; color: #60608a; font-size: 16px; line-height: 1;
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  transition: all 0.1s; padding: 0;
}
.pat-nav-btn:hover:not(:disabled) { border-color: #4a4a6a; color: #a0a0c0; }
.pat-nav-btn:disabled { opacity: 0.25; cursor: default; }
.pat-name-wrap {
  flex: 1; display: flex; align-items: center; gap: 6px;
  padding: 3px 8px; border: 1px solid #1e1e2c; border-radius: 4px;
  cursor: pointer; transition: border-color 0.1s;
}
.pat-name-wrap:hover { border-color: #3a3a5a; }
.pat-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.pat-name {
  font-family: 'Rajdhani', sans-serif; font-size: 12px; font-weight: 700;
  letter-spacing: 0.1em; color: #b0b0d0; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis;
}
.pat-add-btn {
  font-family: 'Rajdhani', sans-serif; font-size: 10px; font-weight: 700;
  letter-spacing: 0.08em; padding: 3px 8px; border: 1px dashed #252535;
  border-radius: 4px; background: transparent; color: #404058; cursor: pointer;
  white-space: nowrap; transition: all 0.12s;
}
.pat-add-btn:hover { border-color: #4ecdc4; color: #4ecdc4; }

.channel-rack {
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
  background: #0e0e18;
  position: relative;
}

/* ── Toolbar ─────────────────────────────────────────────────────── */
.rack-toolbar {
  display: flex; align-items: center; gap: 10px;
  padding: 7px 12px;
  background: #0a0a12; border-bottom: 1px solid #1a1a28;
  flex-shrink: 0;
}
.rack-title {
  font-family: 'Rajdhani', sans-serif; font-size: 11px; font-weight: 700;
  letter-spacing: 0.18em; color: #40405a; text-transform: uppercase;
}
.filter-select {
  background: #141420; border: 1px solid #252535; color: #8080a0;
  padding: 3px 8px; border-radius: 4px; font-family: 'Rajdhani', sans-serif;
  font-size: 11px; font-weight: 600; letter-spacing: 0.08em; cursor: pointer; outline: none;
}
.filter-select:focus { border-color: #4a4a6a; }
.rack-right { margin-left: auto; display: flex; align-items: center; gap: 10px; }
.kb-badge {
  font-family: 'Share Tech Mono', monospace; font-size: 10px; color: #30304a;
}
.add-synth-wrap { position: relative; }
.add-ch-btn {
  font-family: 'Rajdhani', sans-serif; font-size: 11px; font-weight: 700;
  letter-spacing: 0.1em; padding: 4px 10px; border: 1px dashed #252535;
  border-radius: 5px; background: transparent; color: #404058; cursor: pointer; transition: all 0.15s;
}
.add-ch-btn:hover { border-color: #4ecdc4; color: #4ecdc4; }

.synth-picker {
  position: absolute; right: 0; top: calc(100% + 5px); z-index: 2000;
  background: #141422; border: 1px solid #2a2a3c; border-radius: 7px;
  padding: 5px 0; min-width: 170px;
  box-shadow: 0 10px 36px rgba(0,0,0,0.75);
  max-height: 340px; overflow-y: auto;
}
.synth-pick-section {
  padding: 5px 14px 3px;
  font-family: 'Rajdhani', sans-serif; font-size: 9px; font-weight: 700;
  letter-spacing: 0.18em; color: #303048; text-transform: uppercase;
}
.synth-pick-item {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 14px;
  font-family: 'Rajdhani', sans-serif; font-size: 12px; font-weight: 600;
  letter-spacing: 0.08em; color: #8080a8; cursor: pointer;
  transition: background 0.08s, color 0.08s;
}
.synth-pick-item:hover { background: #1c1c2e; color: #d0d0ee; }
.synth-pick-dot {
  width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
}

/* ── Column headers ──────────────────────────────────────────────── */
.col-headers {
  display: grid;
  grid-template-columns: 20px 34px 34px 38px 130px 1fr;
  padding: 4px 0 4px 4px;
  background: #080810; border-bottom: 1px solid #141420;
  flex-shrink: 0;
}
.col-headers > div {
  font-family: 'Rajdhani', sans-serif; font-size: 9px; font-weight: 700;
  letter-spacing: 0.15em; color: #252540; text-transform: uppercase;
  display: flex; align-items: center; justify-content: center;
}
.col-name { justify-content: flex-start; padding-left: 6px; }
.col-seq  { justify-content: flex-start; padding-left: 8px; }
.steps-label { color: #303050; font-weight: 400; margin-left: 4px; }

/* ── Channel list ────────────────────────────────────────────────── */
.channel-list { flex: 1; overflow-y: auto; }

.channel-row {
  display: grid;
  grid-template-columns: 20px 34px 34px 38px 130px 1fr;
  align-items: center;
  min-height: 40px;
  border-bottom: 1px solid #0b0b14;
  background: #0e0e18;
  cursor: pointer;
  transition: background 0.08s;
  padding-left: 4px;
  position: relative;
}
.channel-row:hover    { background: #121220; }
.channel-row.selected { background: #161626; }
.channel-row.muted    { opacity: 0.45; }
.channel-row.selected::before {
  content: ''; position: absolute; left: 0; top: 0; bottom: 0;
  width: 3px; background: var(--accent);
}

/* ── LED ─────────────────────────────────────────────────────────── */
.led {
  width: 10px; height: 10px; border-radius: 50%;
  background: #1a1a28; border: 1px solid #252535;
  cursor: pointer; transition: all 0.12s; justify-self: center;
  box-shadow: none;
}
.led.active {
  background: #2ecc71;
  border-color: #2ecc71;
  box-shadow: 0 0 6px #2ecc7188;
}
.led.solo {
  background: #f39c12;
  border-color: #f39c12;
  box-shadow: 0 0 6px #f39c1288;
}
.led:hover { filter: brightness(1.3); }

/* ── Knobs (hide label area) ─────────────────────────────────────── */
.rack-knob-wrap {
  display: flex; align-items: center; justify-content: center;
  height: 28px; overflow: hidden; cursor: pointer;
}
.rack-knob-wrap :deep(.knob-label-area) { display: none; }
.rack-knob-wrap :deep(.knob-svg) { cursor: ns-resize; }

/* ── Mixer track number ──────────────────────────────────────────── */
.mix-num {
  display: flex; align-items: center; justify-content: center; height: 100%;
}
.mix-input {
  width: 28px; background: #141422; border: 1px solid #252535;
  color: #7070a0; font-family: 'Share Tech Mono', monospace; font-size: 10px;
  text-align: center; border-radius: 3px; outline: none; padding: 2px 0;
  -moz-appearance: textfield;
}
.mix-input::-webkit-inner-spin-button,
.mix-input::-webkit-outer-spin-button { -webkit-appearance: none; }
.mix-input:focus { border-color: #4a4a6a; color: #b0b0d0; }

/* ── Channel name button ─────────────────────────────────────────── */
.ch-name-btn {
  height: 28px; margin: 0 4px;
  font-family: 'Rajdhani', sans-serif; font-size: 12px; font-weight: 700;
  letter-spacing: 0.12em; color: #fff; text-shadow: 0 1px 3px rgba(0,0,0,0.6);
  border: none; border-radius: 4px; cursor: pointer;
  transition: filter 0.1s, box-shadow 0.1s;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  padding: 0 8px;
}
.ch-name-btn:hover     { filter: brightness(1.12); }
.ch-name-btn.piano-active { box-shadow: 0 0 0 2px #fff4, 0 0 10px var(--accent); }

/* ── Step grid ───────────────────────────────────────────────────── */
.ch-seq { padding: 0 8px; }

.inline-steps {
  display: grid;
  grid-template-columns: repeat(var(--cols), 1fr);
  gap: 2px;
}
.istep {
  height: 24px;
  border: 1px solid #1e1e32;
  border-radius: 3px;
  background: #0e0e22;
  cursor: pointer;
  transition: background 0.07s, box-shadow 0.07s;
  padding: 0;
}
.istep.beat    { background: #111128; border-color: #222238; }
.istep.lit     {
  background: var(--accent);
  border-color: var(--accent);
  box-shadow: 0 0 5px color-mix(in srgb, var(--accent) 50%, transparent);
}
.istep.playing {
  border-color: #fff !important;
  box-shadow: 0 0 8px #ffffffaa !important;
}
.istep:hover:not(.lit) {
  background: color-mix(in srgb, var(--accent) 20%, #1a1a32);
}

/* ── Mini piano-roll preview ─────────────────────────────────────── */
.mini-pr {
  display: grid;
  grid-template-columns: repeat(var(--cols), 1fr);
  gap: 2px;
  height: 28px;
  background: #0a0a18;
  border: 1px solid #1a1a2c;
  border-radius: 3px;
  cursor: pointer;
  position: relative;
  overflow: hidden;
  transition: border-color 0.1s;
}
.mini-pr:hover { border-color: #3a3a5a; }
.mini-pr-col {
  height: 100%; position: relative;
  border-right: 1px solid #0e0e1a;
  transition: background 0.05s;
}
.mini-pr-col.beat    { border-left: 1px solid #141428; }
.mini-pr-col.playing { background: rgba(255,255,255,0.08); }
.mini-note {
  position: absolute;
  left: 1px; right: 1px;
  height: 3px;
  background: var(--accent);
  border-radius: 1px;
  box-shadow: 0 0 3px color-mix(in srgb, var(--accent) 60%, transparent);
}
.mini-pr-hint {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  font-family: 'Rajdhani', sans-serif; font-size: 9px; font-weight: 700;
  letter-spacing: 0.15em; color: #252540; pointer-events: none;
}
.mini-pr:hover .mini-pr-hint { color: #4a4a6a; }

/* ── Empty state ─────────────────────────────────────────────────── */
.empty-state {
  padding: 20px; text-align: center;
  font-family: 'Rajdhani', sans-serif; font-size: 12px; color: #303048;
}

/* ── Context menu ────────────────────────────────────────────────── */
.ctx-menu {
  position: fixed; z-index: 1000;
  background: #181828; border: 1px solid #2a2a3c; border-radius: 6px;
  padding: 4px 0; min-width: 160px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.7);
}
.ctx-item {
  padding: 7px 16px;
  font-family: 'Rajdhani', sans-serif; font-size: 13px; font-weight: 600;
  letter-spacing: 0.08em; color: #a0a0c0; cursor: pointer;
  transition: background 0.1s, color 0.1s;
}
.ctx-item:hover  { background: #20203a; color: #e0e0ee; }
.ctx-item.danger { color: #e74c3c44; }
.ctx-item.danger:hover { color: #e74c3c; background: #1a0a0a; }
.ctx-sep { height: 1px; background: #1e1e2c; margin: 3px 0; }

/* ── Rename overlay ──────────────────────────────────────────────── */
.rename-overlay {
  position: fixed; inset: 0; z-index: 2000;
  background: rgba(0,0,0,0.55);
  display: flex; align-items: center; justify-content: center;
}
.rename-box {
  background: #181828; border: 1px solid #2a2a3c; border-radius: 8px;
  padding: 20px 24px; display: flex; flex-direction: column; gap: 10px;
  min-width: 280px; box-shadow: 0 12px 40px rgba(0,0,0,0.8);
}
.rename-label {
  font-family: 'Rajdhani', sans-serif; font-size: 12px; font-weight: 600;
  letter-spacing: 0.1em; color: #606080; text-transform: uppercase;
}
.rename-input {
  background: #0e0e1c; border: 1px solid #3a3a5a; color: #e0e0ee;
  padding: 7px 10px; border-radius: 5px; font-family: 'Rajdhani', sans-serif;
  font-size: 16px; font-weight: 700; letter-spacing: 0.1em; outline: none;
}
.rename-input:focus { border-color: #e74c3c; }
.rename-btns { display: flex; gap: 8px; justify-content: flex-end; }
.rename-ok {
  padding: 6px 18px; background: #e74c3c22; border: 1px solid #e74c3c; color: #e74c3c;
  border-radius: 5px; cursor: pointer; font-family: 'Rajdhani', sans-serif;
  font-size: 13px; font-weight: 700; transition: all 0.1s;
}
.rename-ok:hover { background: #e74c3c; color: #fff; }
.rename-cancel {
  padding: 6px 14px; background: transparent; border: 1px solid #252535; color: #606080;
  border-radius: 5px; cursor: pointer; font-family: 'Rajdhani', sans-serif; font-size: 13px;
}
.rename-cancel:hover { border-color: #4a4a6a; color: #a0a0c0; }
</style>
