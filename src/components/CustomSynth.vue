<template>
  <div class="custom-synth">
    <!-- Tab navigation -->
    <div class="synth-tabs">
      <button
        v-for="tab in tabs"
        :key="tab"
        class="synth-tab"
        :class="{ active: activeTab === tab }"
        @click="activeTab = tab"
      >
        {{ tab }}
      </button>
    </div>

    <!-- Main tab: Oscillators & Core -->
    <div v-if="activeTab === 'Main'" class="synth-content main-tab">
      <div class="synth-main-grid">
        <!-- Left: Osc A -->
        <div class="osc-section">
          <div class="osc-header">OSC A</div>
          <OscillatorSection
            :osc="params.oscA"
            :color="color"
            @update="(key, val) => updateParam('oscA', key, val)"
          />
        </div>

        <!-- Center: Wavetable & Warp -->
        <div class="wt-warp-section">
          <WavetableDisplay
            :wt-pos="params.oscA.wtPos"
            :waveform="params.oscA.waveform"
            :mode="view3d ? '3d' : '2d'"
          />
          <div class="view-toggle">
            <button
              :style="{ opacity: view3d ? 0.3 : 1 }"
              @click="view3d = false"
              title="2D view"
            >2D</button>
            <button
              :style="{ opacity: view3d ? 1 : 0.3 }"
              @click="view3d = true"
              title="3D view"
            >3D</button>
          </div>
          <WarpModePanel
            :mode="params.oscA.warpMode"
            :warp="params.oscA.warp"
            :color="color"
            @update:mode="(val) => updateParam('oscA', 'warpMode', val)"
            @update:warp="(val) => updateParam('oscA', 'warp', val)"
          />
        </div>

        <!-- Right: Osc B -->
        <div class="osc-section">
          <div class="osc-header">OSC B</div>
          <OscillatorSection
            :osc="params.oscB"
            :color="color"
            @update="(key, val) => updateParam('oscB', key, val)"
          />
        </div>
      </div>

      <!-- Filter section below -->
      <div class="filter-fx-row">
        <FilterSection
          :params="params.filter"
          :color="color"
          @update="(key, val) => updateParam('filter', key, val)"
        />
        <MacroControls
          :macros="params.macros"
          :color="color"
          @update="(idx, key, val) => updateMacro(idx, key, val)"
        />
      </div>
    </div>

    <!-- FX tab -->
    <div v-else-if="activeTab === 'FX'" class="synth-content fx-tab">
      <FXRack
        :effects="params.effects"
        :color="color"
        @update="(idx, key, val) => updateEffect(idx, key, val)"
        @reorder="reorderEffects"
      />
    </div>

    <!-- Modulation tab -->
    <div v-else-if="activeTab === 'Modulation'" class="synth-content mod-tab">
      <ModulationSystem
        :lfos="params.lfo"
        :envelopes="params.envelopes"
        :modMatrix="params.modMatrix"
        :color="color"
        @update:lfo="(idx, key, val) => updateLFO(idx, key, val)"
        @update:envelope="(idx, key, val) => updateEnvelope(idx, key, val)"
      />
    </div>

    <!-- Global tab -->
    <div v-else-if="activeTab === 'Global'" class="synth-content global-tab">
      <div class="global-controls">
        <div class="global-group">
          <div class="global-label">QUALITY</div>
          <Knob
            v-model="params.global.oversampling"
            :min="1" :max="8"
            label="Oversampling" :color="color"
            :size="48" :decimals="0"
          />
        </div>
        <div class="global-group">
          <div class="global-label">MASTER</div>
          <Knob
            v-model="params.global.masterVolume"
            :min="0" :max="1"
            label="Volume" :color="color"
            :size="48" :decimals="2"
          />
          <Knob
            v-model="params.global.masterTune"
            :min="-24" :max="24"
            label="Tune" :color="color"
            :size="48" :decimals="0"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed } from 'vue'
import Knob from './Knob.vue'
import OscillatorSection from './OscillatorSection.vue'
import WavetableDisplay from './WavetableDisplay.vue'
import WarpModePanel from './WarpModePanel.vue'
import FilterSection from './FilterSection.vue'
import MacroControls from './MacroControls.vue'
import FXRack from './FXRack.vue'
import ModulationSystem from './ModulationSystem.vue'

const props = defineProps({
  color: { type: String, default: '#4ecdc4' },
})

const emit = defineEmits(['update:params'])

const tabs = ['Main', 'FX', 'Modulation', 'Global']
const activeTab = ref('Main')
const view3d = ref(false)

const params = reactive({
  oscA: {
    wtPos: 0.5,
    warpMode: 'none',
    warp: 0.5,
    waveform: 'sine',
    unisonVoices: 1,
    unisonDetune: 0,
    unisonBlend: 0.5,
    subOsc: false,
    subAmount: 0,
  },
  oscB: {
    wtPos: 0.5,
    warpMode: 'none',
    warp: 0.5,
    waveform: 'sawtooth',
    unisonVoices: 1,
    unisonDetune: 0,
    unisonBlend: 0.5,
    subOsc: false,
    subAmount: 0,
  },
  filter: {
    type: 'lowpass',
    cutoff: 0.8,
    resonance: 0.3,
    drive: 0,
    fat: 0,
    keyTracking: false,
  },
  macros: [
    { name: 'MACRO 1', value: 0.5, mappings: [] },
    { name: 'MACRO 2', value: 0.5, mappings: [] },
    { name: 'MACRO 3', value: 0.5, mappings: [] },
    { name: 'MACRO 4', value: 0.5, mappings: [] },
  ],
  effects: [
    { type: 'distortion', enabled: false, drive: 0.3, tone: 0.5 },
    { type: 'reverb', enabled: false, size: 0.5, decay: 0.4, mix: 0.3 },
    { type: 'compressor', enabled: false, threshold: 0.5, ratio: 4, attack: 0.005, release: 0.1 },
    { type: 'delay', enabled: false, time: 0.5, feedback: 0.3, mix: 0.3 },
    { type: 'chorus', enabled: false, rate: 0.5, depth: 0.3, mix: 0.4 },
    { type: 'phaser', enabled: false, rate: 0.5, depth: 0.3, feedback: 0.5, mix: 0.3 },
    { type: 'flanger', enabled: false, rate: 0.5, depth: 0.3, feedback: 0.5, mix: 0.3 },
    { type: 'eq', enabled: false, low: 0.5, mid: 0.5, high: 0.5 },
    { type: 'volume', enabled: true, value: 1 },
    { type: 'dimension', enabled: false, mix: 0.3, width: 0.8 },
  ],
  lfo: [
    { id: 1, rate: 0.5, waveform: 'sine', phase: 0, retrig: true },
    { id: 2, rate: 0.5, waveform: 'sine', phase: 0, retrig: true },
    { id: 3, rate: 0.5, waveform: 'sine', phase: 0, retrig: true },
    { id: 4, rate: 0.5, waveform: 'sine', phase: 0, retrig: true },
  ],
  envelopes: [
    { id: 1, name: 'Amp', attack: 0.005, decay: 0.1, sustain: 1, release: 0.3 },
    { id: 2, name: 'Mod', attack: 0.01, decay: 0.2, sustain: 0, release: 0.5 },
    { id: 3, name: 'Mod', attack: 0.01, decay: 0.2, sustain: 0, release: 0.5 },
  ],
  modMatrix: [],
  global: {
    oversampling: 2,
    masterVolume: 0.8,
    masterTune: 0,
  },
})

function updateParam(section, key, value) {
  params[section][key] = value
  emit('update:params', params)
}

function updateMacro(idx, key, value) {
  params.macros[idx][key] = value
  emit('update:params', params)
}

function updateEffect(idx, key, value) {
  params.effects[idx][key] = value
  emit('update:params', params)
}

function updateLFO(idx, key, value) {
  params.lfo[idx][key] = value
  emit('update:params', params)
}

function updateEnvelope(idx, key, value) {
  params.envelopes[idx][key] = value
  emit('update:params', params)
}

function reorderEffects(fromIdx, toIdx) {
  const [removed] = params.effects.splice(fromIdx, 1)
  params.effects.splice(toIdx, 0, removed)
  emit('update:params', params)
}
</script>

<style scoped>
.custom-synth {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #1a1a1a;
  border: 1px solid #333;
  border-radius: 4px;
  overflow: hidden;
}

.synth-tabs {
  display: flex;
  gap: 2px;
  background: #0f0f0f;
  padding: 6px;
  border-bottom: 1px solid #333;
}

.synth-tab {
  flex: 1;
  padding: 6px 10px;
  background: #252525;
  color: #999;
  border: 1px solid #333;
  border-radius: 3px;
  cursor: pointer;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  transition: all 0.15s;
}

.synth-tab:hover {
  background: #2a2a2a;
  color: #aaa;
}

.synth-tab.active {
  background: #4ecdc4;
  color: #0a0a0a;
  border-color: #4ecdc4;
}

.synth-content {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}

.main-tab {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.synth-main-grid {
  display: grid;
  grid-template-columns: 1fr 1.5fr 1fr;
  gap: 12px;
  background: #151515;
  padding: 12px;
  border-radius: 4px;
  border: 1px solid #333;
}

.osc-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.osc-header {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  color: #666;
  letter-spacing: 0.1em;
  padding: 6px 0;
  border-bottom: 1px solid #333;
}

.wt-warp-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.view-toggle {
  display: flex;
  gap: 4px;
  background: #0f0f0f;
  border-radius: 3px;
  padding: 2px;
}

.view-toggle button {
  flex: 1;
  padding: 4px;
  background: #252525;
  border: 1px solid #333;
  color: #999;
  cursor: pointer;
  border-radius: 2px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  transition: all 0.15s;
}

.view-toggle button:hover {
  background: #2a2a2a;
  color: #aaa;
}

.filter-fx-row {
  display: grid;
  grid-template-columns: 1.5fr 1fr;
  gap: 12px;
}

.fx-tab,
.mod-tab,
.global-tab {
  overflow-y: auto;
}

.global-controls {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 20px;
  background: #151515;
  padding: 12px;
  border-radius: 4px;
  border: 1px solid #333;
}

.global-group {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.global-label {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  color: #666;
  letter-spacing: 0.1em;
}

/* Scrollbar styling */
.synth-content::-webkit-scrollbar {
  width: 6px;
}

.synth-content::-webkit-scrollbar-track {
  background: #0f0f0f;
}

.synth-content::-webkit-scrollbar-thumb {
  background: #333;
  border-radius: 3px;
}

.synth-content::-webkit-scrollbar-thumb:hover {
  background: #444;
}
</style>
